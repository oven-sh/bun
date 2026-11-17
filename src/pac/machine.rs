use std::net::IpAddr;
use std::sync::Arc;
use std::time::{Duration, Instant};

use bun_collections::StringArrayHashMap;
use bun_core::StackCheck;
use bun_core::fmt::{FormatDouble, parse_f64};

use crate::syntax::{
    Block, Defines, Expr, Function, Logical, Loop, Operator, Stmt, Suffix, Symbol, Symbols, Try,
    Unary, parse,
};
use crate::{Failed, Host};

/// A step leaves a few dozen bytes behind at most.
const MAX_STEPS: usize = 20_000_000;
const MAX_TIME: Duration = Duration::from_secs(10);
const STEPS_FOR_AN_OBJECT: usize = 16;
const MAX_DEPTH: u32 = 400;
const MAX_KEPT_BYTES: usize = 128 << 20;
pub(crate) const MAX_LENGTH: usize = 1 << 24;

pub(crate) type Text = Arc<[u8]>;
pub(crate) type Id = u32;

#[derive(Clone, Default)]
pub(crate) enum Value {
    #[default]
    Undefined,
    Null,
    Bool(bool),
    Number(f64),
    String(Text),
    Object(Id),
}

impl From<bool> for Value {
    fn from(it: bool) -> Value {
        Value::Bool(it)
    }
}

impl From<f64> for Value {
    fn from(it: f64) -> Value {
        Value::Number(it)
    }
}

impl From<usize> for Value {
    fn from(it: usize) -> Value {
        Value::Number(it as f64)
    }
}

/// An index, or -1.
impl From<Option<usize>> for Value {
    fn from(it: Option<usize>) -> Value {
        Value::Number(it.map_or(-1.0, |it| it as f64))
    }
}

impl From<&[u8]> for Value {
    fn from(it: &[u8]) -> Value {
        Value::String(it.into())
    }
}

impl Value {
    pub(crate) fn is_nullish(&self) -> bool {
        matches!(self, Value::Undefined | Value::Null)
    }

    pub(crate) fn is_truthy(&self) -> bool {
        match self {
            Value::Undefined | Value::Null => false,
            Value::Bool(it) => *it,
            Value::Number(it) => *it != 0.0 && !it.is_nan(),
            Value::String(it) => !it.is_empty(),
            Value::Object(_) => true,
        }
    }

    pub(crate) fn is_same(&self, other: &Value) -> bool {
        match (self, other) {
            (Value::Undefined, Value::Undefined) | (Value::Null, Value::Null) => true,
            (Value::Bool(a), Value::Bool(b)) => a == b,
            (Value::Number(a), Value::Number(b)) => a == b,
            (Value::String(a), Value::String(b)) => a == b,
            (Value::Object(a), Value::Object(b)) => a == b,
            _ => false,
        }
    }

    pub(crate) fn given(&self) -> Option<&Value> {
        Some(self).filter(|it| !matches!(it, Value::Undefined))
    }
}

pub(crate) fn trim(text: &[u8]) -> &[u8] {
    bun_core::strings::trim(text, SPACES)
}

pub(crate) const SPACES: &[u8] = b"\t\n\x0b\x0c\r \xa0";

pub(crate) fn number_of_text(text: &[u8]) -> f64 {
    let digits = |digits: &[u8], radix: u32| {
        digits.iter().try_fold(0.0, |all, it| {
            Some(all * f64::from(radix) + f64::from(char::from(*it).to_digit(radix)?))
        })
    };
    match trim(text) {
        [] => Some(0.0),
        [b'0', b'x' | b'X', rest @ ..] if !rest.is_empty() => digits(rest, 16),
        [b'0', b'o' | b'O', rest @ ..] if !rest.is_empty() => digits(rest, 8),
        [b'0', b'b' | b'B', rest @ ..] if !rest.is_empty() => digits(rest, 2),
        b"Infinity" | b"+Infinity" => Some(f64::INFINITY),
        b"-Infinity" => Some(f64::NEG_INFINITY),
        text @ [.., b'0'..=b'9' | b'.'] => parse_f64(text),
        _ => None,
    }
    .unwrap_or(f64::NAN)
}

pub(crate) fn text_of_number(number: f64) -> Text {
    FormatDouble::dtoa(&mut [0; 124], number).into()
}

pub(crate) fn int32_of(number: f64) -> i32 {
    if number.is_finite() {
        (number.trunc() % 4_294_967_296.0) as i64 as i32
    } else {
        0
    }
}

pub(crate) enum Abrupt {
    Throw(Value),
    /// A script cannot catch it.
    Abort,
}

pub(crate) type Outcome<T = Value> = Result<T, Abrupt>;
pub(crate) type Native = fn(&mut Machine<'_>, &str, &Value, &[Value]) -> Outcome;

pub(crate) struct Pattern {
    pub(crate) compiled: Arc<bun_yarr::Compiled>,
    pub(crate) source: Text,
    pub(crate) flags: Text,
    pub(crate) last_index: usize,
    pub(crate) steps: usize,
}

pub(crate) enum Kind {
    Plain,
    Array(Vec<Value>),
    Function(Arc<Function>, Id),
    Native(Native, &'static str),
    Pattern(Box<Pattern>),
    Date(f64),
    /// Of a `Map` or a `Set`.
    Entries(StringArrayHashMap<[Value; 2]>),
    Scope {
        variables: Vec<(Symbol, Value)>,
        parent: Id,
        this: Value,
    },
    Free,
}

#[derive(Clone, Default)]
struct Property {
    value: Value,
    /// With it, `value` is the getter.
    setter: Option<Value>,
}

pub(crate) struct Object {
    pub(crate) kind: Kind,
    pub(crate) prototype: Option<Id>,
    properties: StringArrayHashMap<Property>,
}

/// The objects that are made first.
pub(crate) const GLOBAL: Id = 0;
pub(crate) const OBJECTS: Id = 1;
pub(crate) const STRINGS: Id = 2;
pub(crate) const ARRAYS: Id = 3;
pub(crate) const PATTERNS: Id = 4;
pub(crate) const NUMBERS: Id = 5;
pub(crate) const DATES: Id = 6;
pub(crate) const FUNCTIONS: Id = 7;
pub(crate) const MAPS: Id = 8;
pub(crate) const SETS: Id = 9;
pub(crate) const BUILT_IN: Id = 10;

#[derive(Default)]
struct Heap {
    objects: Vec<Object>,
    free: Vec<Id>,
    globals: Vec<Option<Value>>,
    steps_since_collection: usize,
}

impl Heap {
    /// While nothing runs. Returns about how many bytes are in use.
    fn collect(&mut self) -> usize {
        let (mut is_marked, mut bytes, mut owned) = (vec![false; self.objects.len()], 0, 0);
        let size_of_keys = |keys: &[Box<[u8]>]| {
            keys.iter()
                .map(|it| it.len() + 2 * size_of_val(it))
                .sum::<usize>()
        };
        let mut pending: Vec<Id> = (0..BUILT_IN).collect();
        let mut visit = |value: &Value, pending: &mut Vec<Id>| match value {
            Value::Object(id) => pending.push(*id),
            Value::String(text) => bytes += text.len() + size_of::<Value>(),
            _ => bytes += size_of::<Value>(),
        };
        self.globals
            .iter()
            .flatten()
            .for_each(|it| visit(it, &mut pending));
        while let Some(id) = pending.pop() {
            if core::mem::replace(&mut is_marked[id as usize], true) {
                continue;
            }
            let object = &self.objects[id as usize];
            pending.extend(object.prototype);
            owned += size_of_keys(object.properties.keys());
            for property in object.properties.values() {
                [Some(&property.value), property.setter.as_ref()]
                    .into_iter()
                    .flatten()
                    .for_each(|it| visit(it, &mut pending));
            }
            match &object.kind {
                Kind::Array(items) => items.iter().for_each(|it| visit(it, &mut pending)),
                Kind::Entries(entries) => {
                    owned += size_of_keys(entries.keys());
                    entries
                        .values()
                        .iter()
                        .flatten()
                        .for_each(|it| visit(it, &mut pending));
                }
                Kind::Pattern(pattern) => owned += pattern.steps * size_of::<Value>(),
                Kind::Function(_, scope) => pending.push(*scope),
                Kind::Scope {
                    variables,
                    parent,
                    this,
                } => {
                    pending.push(*parent);
                    variables
                        .iter()
                        .map(|it| &it.1)
                        .chain([this])
                        .for_each(|it| visit(it, &mut pending));
                }
                _ => {}
            }
        }
        self.free.clear();
        for (id, object) in self
            .objects
            .iter_mut()
            .enumerate()
            .filter(|it| !is_marked[it.0])
        {
            *object = Object {
                kind: Kind::Free,
                prototype: None,
                properties: Default::default(),
            };
            self.free.push(id as Id);
        }
        self.steps_since_collection = 0;
        bytes + owned + (self.objects.len() - self.free.len()) * size_of::<Object>()
    }
}

pub struct Script {
    symbols: Symbols,
    heap: Heap,
    entry_points: [Symbol; 2],
    arguments: Symbol,
}

impl Script {
    pub fn load(source: &[u8], host: &dyn Host) -> Result<Script, Failed> {
        let mut symbols = Symbols::default();
        let entry_points = [
            symbols.of(b"FindProxyForURLEx"),
            symbols.of(b"FindProxyForURL"),
        ];
        let (arguments, program) = (symbols.of(b"arguments"), parse(source, &mut symbols)?);
        let mut script = Script {
            symbols,
            heap: Heap::default(),
            entry_points,
            arguments,
        };
        script.run(host, |machine| {
            crate::globals::install(machine);
            machine.run_in(&program, GLOBAL).map(|_| ())
        })?;
        Ok(script)
    }

    /// `FindProxyForURL()`
    pub fn find(&mut self, url: &[u8], name: &[u8], host: &dyn Host) -> Result<Text, Failed> {
        let entry_points = self.entry_points;
        self.run(host, |machine| {
            let find = entry_points
                .iter()
                .find_map(|it| machine.look_up(*it, GLOBAL))
                .unwrap_or_default();
            let answer = machine.call(&find, &Value::Undefined, &[url.into(), name.into()])?;
            machine.text(&answer)
        })
    }

    fn run<T>(
        &mut self,
        host: &dyn Host,
        run: impl FnOnce(&mut Machine<'_>) -> Outcome<T>,
    ) -> Result<T, Failed> {
        let mut machine = Machine {
            script: self,
            host,
            steps: 0,
            ticks: 0,
            deadline: Instant::now() + MAX_TIME,
            depth: 0,
            resolved: Vec::new(),
            stack: StackCheck::init(),
        };
        let result = run(&mut machine);
        let steps = machine.steps;
        self.heap.steps_since_collection += steps;
        if self.heap.steps_since_collection > MAX_STEPS / 200
            && self.heap.collect() > MAX_KEPT_BYTES
        {
            self.heap.globals.clear();
            self.heap.collect();
        }
        result.map_err(|_| Failed)
    }
}

enum Flow {
    Normal,
    Break(Option<Symbol>),
    Continue(Option<Symbol>),
    Return(Value),
}

enum Place {
    Variable(Symbol),
    Member(Value, Value),
}

pub(crate) struct Machine<'m> {
    script: &'m mut Script,
    pub(crate) host: &'m dyn Host,
    steps: usize,
    ticks: u8,
    pub(crate) deadline: Instant,
    depth: u32,
    pub(crate) resolved: Vec<(Text, Vec<IpAddr>)>,
    stack: StackCheck,
}

fn index_of_key(key: &Value) -> Option<usize> {
    match key {
        Value::Number(it) => Some(*it as usize).filter(|index| *index as f64 == *it),
        Value::String(text) if matches!(**text, [b'0'] | [b'1'..=b'9', ..]) => {
            bun_core::fmt::parse_unsigned(text, 10).ok()
        }
        _ => None,
    }
}

/// Objects
impl Machine<'_> {
    pub(crate) fn spend(&mut self, steps: usize) -> Outcome<()> {
        self.steps = self.steps.saturating_add(steps);
        if self.steps > MAX_STEPS {
            Err(Abrupt::Abort)
        } else {
            self.tick()
        }
    }

    fn tick(&mut self) -> Outcome<()> {
        self.ticks = self.ticks.wrapping_add(1);
        if self.ticks == 0 {
            self.check_time()
        } else {
            Ok(())
        }
    }

    pub(crate) fn check_time(&self) -> Outcome<()> {
        if Instant::now() > self.deadline {
            Err(Abrupt::Abort)
        } else {
            Ok(())
        }
    }

    pub(crate) fn object(&mut self, id: Id) -> &mut Object {
        &mut self.script.heap.objects[id as usize]
    }

    pub(crate) fn kind(&self, value: &Value) -> Option<&Kind> {
        match value {
            Value::Object(id) => Some(&self.script.heap.objects[*id as usize].kind),
            _ => None,
        }
    }

    pub(crate) fn allocate(&mut self, kind: Kind, prototype: Option<Id>) -> Id {
        self.steps += STEPS_FOR_AN_OBJECT;
        let (heap, object) = (
            &mut self.script.heap,
            Object {
                kind,
                prototype,
                properties: Default::default(),
            },
        );
        match heap.free.pop() {
            Some(id) => {
                heap.objects[id as usize] = object;
                id
            }
            None => {
                heap.objects.push(object);
                (heap.objects.len() - 1) as Id
            }
        }
    }

    pub(crate) fn new_array(&mut self, items: Vec<Value>) -> Outcome {
        self.check_length(items.len(), 1)?;
        Ok(Value::Object(
            self.allocate(Kind::Array(items), Some(ARRAYS)),
        ))
    }

    pub(crate) fn new_string(&mut self, text: &[u8]) -> Outcome {
        self.check_length(text.len(), 8)?;
        Ok(text.into())
    }

    pub(crate) fn check_length(&mut self, length: usize, for_a_step: usize) -> Outcome<()> {
        if length > MAX_LENGTH {
            Err(Abrupt::Abort)
        } else {
            self.spend(length / for_a_step)
        }
    }

    pub(crate) fn new_error(&mut self, name: &str, message: Value) -> Value {
        let error = self.allocate(Kind::Plain, Some(OBJECTS));
        self.define(error, b"name", name.as_bytes().into());
        self.define(error, b"message", message);
        self.define_natives(error, crate::builtins::error_method, &["toString"]);
        Value::Object(error)
    }

    pub(crate) fn throw<T>(&mut self, name: &str, message: &str) -> Outcome<T> {
        Err(Abrupt::Throw(
            self.new_error(name, message.as_bytes().into()),
        ))
    }

    pub(crate) fn define(&mut self, object: Id, key: &[u8], value: Value) {
        self.object(object).properties.insert(
            key,
            Property {
                value,
                setter: None,
            },
        );
    }

    pub(crate) fn new_native(&mut self, run: Native, name: &'static str) -> Id {
        self.allocate(Kind::Native(run, name), Some(FUNCTIONS))
    }

    pub(crate) fn define_natives(&mut self, object: Id, run: Native, names: &[&'static str]) {
        for name in names {
            let native = self.new_native(run, name);
            self.define(object, name.as_bytes(), Value::Object(native));
        }
    }

    pub(crate) fn define_global(&mut self, name: &str, value: Value) {
        let symbol = self.script.symbols.of(name.as_bytes());
        self.assign(symbol, GLOBAL, value);
    }

    pub(crate) fn items(&mut self, value: &Value) -> Option<&mut Vec<Value>> {
        match value {
            Value::Object(id) => match &mut self.object(*id).kind {
                Kind::Array(items) => Some(items),
                _ => None,
            },
            _ => None,
        }
    }

    pub(crate) fn is_callable(&self, value: &Value) -> bool {
        matches!(
            self.kind(value),
            Some(Kind::Function(..) | Kind::Native(..))
        )
    }

    pub(crate) fn own_keys(&mut self, value: &Value) -> Outcome<Vec<Value>> {
        let indices = |len: usize| (0..len).map(|it| Value::String(text_of_number(it as f64)));
        Ok(match value {
            Value::String(text) => {
                self.spend(2 * text.len())?;
                indices(text.len()).collect()
            }
            Value::Object(id) if *id >= BUILT_IN => {
                let len = self.items(value).map_or(0, |it| it.len());
                let steps = 2 * len
                    + self
                        .object(*id)
                        .properties
                        .keys()
                        .iter()
                        .map(|it| 2 + it.len() / 8)
                        .sum::<usize>();
                self.spend(steps)?;
                indices(len)
                    .chain(
                        self.object(*id)
                            .properties
                            .keys()
                            .iter()
                            .map(|it| Value::from(&**it)),
                    )
                    .collect()
            }
            _ => Vec::new(),
        })
    }

    pub(crate) fn has_own(&mut self, value: &Value, key: &Value) -> Outcome<bool> {
        let name = self.name(key)?;
        let len = match value {
            Value::String(text) => Some(text.len()),
            _ => self.items(value).map(|it| it.len()),
        };
        Ok(len
            .is_some_and(|len| *name == *b"length" || index_of_key(key).is_some_and(|it| it < len))
            || matches!(value, Value::Object(id) if self.object(*id).properties.contains(&name)))
    }

    fn chain(&self, first: Option<Id>) -> impl Iterator<Item = Id> {
        core::iter::successors(first, |it| self.script.heap.objects[*it as usize].prototype)
            .take(2 * MAX_DEPTH as usize)
    }

    fn find(&self, first: Id, name: &[u8]) -> Option<&Property> {
        self.chain(Some(first))
            .find_map(|it| self.script.heap.objects[it as usize].properties.get(name))
    }

    pub(crate) fn get(&mut self, value: &Value, key: &Value) -> Outcome {
        match (value, index_of_key(key)) {
            (Value::String(text), Some(index)) => {
                return Ok(text
                    .get(index..=index)
                    .map_or(Value::Undefined, Value::from));
            }
            (_, Some(index)) if let Some(items) = self.items(value) => {
                return Ok(items.get(index).cloned().unwrap_or_default());
            }
            _ => {}
        }
        let name = self.name(key)?;
        self.get_named(value, &name)
    }

    pub(crate) fn get_named(&mut self, value: &Value, name: &[u8]) -> Outcome {
        let first = match value {
            Value::Undefined | Value::Null => {
                return self.throw("TypeError", "Cannot read properties of null or undefined");
            }
            Value::String(text) if name == b"length" => return Ok(text.len().into()),
            Value::String(_) => STRINGS,
            Value::Number(_) => NUMBERS,
            Value::Bool(_) => OBJECTS,
            Value::Object(id) => *id,
        };
        let object = &self.script.heap.objects[first as usize];
        match (&object.kind, name) {
            (Kind::Array(items), b"length") => return Ok(items.len().into()),
            (Kind::Entries(entries), b"size") => return Ok(entries.len().into()),
            (Kind::Pattern(pattern), _) if let Some(found) = pattern.property(name) => {
                return Ok(found);
            }
            (Kind::Plain, b"__proto__") => {
                return Ok(object.prototype.map_or(Value::Null, Value::Object));
            }
            (Kind::Function(..), b"prototype") if !object.properties.contains(name) => {
                let prototype = self.allocate(Kind::Plain, Some(OBJECTS));
                self.define(prototype, b"constructor", value.clone());
                self.define(first, name, Value::Object(prototype));
            }
            _ => {}
        }
        match self.find(first, name).cloned() {
            Some(Property {
                value: getter @ Value::Object(_),
                setter: Some(_),
            }) => self.call(&getter, value, &[]),
            found => Ok(found.unwrap_or_default().value),
        }
    }

    pub(crate) fn set(&mut self, target: &Value, key: &Value, value: Value) -> Outcome<()> {
        let id = match target {
            Value::Undefined | Value::Null => {
                return self.throw("TypeError", "Cannot set properties of null or undefined");
            }
            Value::Object(id) => *id,
            _ => return Ok(()),
        };
        if let (Some(index), Some(len)) = (index_of_key(key), self.items(target).map(|it| it.len()))
        {
            if index >= len {
                self.resize(target, index.saturating_add(1))?;
            }
            self.items(target)
                .into_iter()
                .for_each(|it| it[index] = value.clone());
            return Ok(());
        }
        let name = self.name(key)?;
        match (&self.object(id).kind, &*name) {
            (Kind::Array(_), b"length") => {
                let len = self.number(&value)? as usize;
                return self.resize(target, len);
            }
            (Kind::Pattern(_), b"lastIndex") => {
                let index = self.number(&value)? as usize;
                self.set_last_index(id, index);
            }
            (_, b"__proto__") => self.set_prototype(id, &value),
            _ => match self.find(id, &name).and_then(|it| it.setter.clone()) {
                Some(Value::Undefined) => {}
                Some(setter) => _ = self.call(&setter, target, &[value])?,
                None => {
                    self.spend(4)?;
                    self.define(id, &name, value);
                }
            },
        }
        Ok(())
    }

    fn resize(&mut self, array: &Value, len: usize) -> Outcome<()> {
        let old = self.items(array).map_or(0, |it| it.len());
        self.check_length(len, usize::MAX)?;
        self.spend(len.saturating_sub(old))?;
        self.items(array)
            .into_iter()
            .for_each(|it| it.resize(len, Value::Undefined));
        Ok(())
    }

    fn set_prototype(&mut self, id: Id, value: &Value) {
        match value {
            Value::Null => self.object(id).prototype = None,
            Value::Object(prototype)
                if self
                    .chain(Some(*prototype))
                    .enumerate()
                    .all(|it| it.0 < MAX_DEPTH as usize && it.1 != id) =>
            {
                self.object(id).prototype = Some(*prototype);
            }
            _ => {}
        }
    }

    pub(crate) fn new_object_like(&mut self, prototype: &Value) -> Value {
        let id = self.allocate(Kind::Plain, Some(OBJECTS));
        self.set_prototype(id, prototype);
        Value::Object(id)
    }

    fn delete(&mut self, target: &Value, key: &Value) -> Outcome<()> {
        if let (Some(index), Some(items)) = (index_of_key(key), self.items(target)) {
            items
                .get_mut(index)
                .into_iter()
                .for_each(|it| *it = Value::Undefined);
        } else if let Value::Object(id) = target {
            let name = self.name(key)?;
            let len = self.object(*id).properties.len();
            self.spend(len / 8)?;
            self.object(*id)
                .properties
                .ordered_remove(&Box::from(&*name));
        }
        Ok(())
    }
}

/// Conversions
impl Machine<'_> {
    pub(crate) fn primitive(&mut self, value: &Value) -> Outcome {
        let order: [&[u8]; 2] = match self.kind(value) {
            None => return Ok(value.clone()),
            Some(Kind::Function(..) | Kind::Native(..)) => return Ok(b"function"[..].into()),
            Some(Kind::Date(_)) => [b"toString", b"valueOf"],
            _ => [b"valueOf", b"toString"],
        };
        for name in order {
            let method = self.get_named(value, name)?;
            if self.is_callable(&method) {
                let result = self.call(&method, value, &[])?;
                if !matches!(result, Value::Object(_)) {
                    return Ok(result);
                }
            }
        }
        self.throw("TypeError", "Cannot convert object to primitive value")
    }

    pub(crate) fn number(&mut self, value: &Value) -> Outcome<f64> {
        Ok(match value {
            Value::Undefined => f64::NAN,
            Value::Null => 0.0,
            Value::Bool(it) => f64::from(*it),
            Value::Number(it) => *it,
            Value::String(it) => self.spend(it.len() / 16).map(|()| number_of_text(it))?,
            Value::Object(_) if let Some(Kind::Date(time)) = self.kind(value) => *time,
            Value::Object(_) => {
                let primitive = self.primitive(value)?;
                self.number(&primitive)?
            }
        })
    }

    pub(crate) fn text(&mut self, value: &Value) -> Outcome<Text> {
        Ok(match value {
            Value::Undefined => b"undefined"[..].into(),
            Value::Null => b"null"[..].into(),
            Value::Bool(it) => if *it { &b"true"[..] } else { b"false" }.into(),
            Value::Number(it) => text_of_number(*it),
            Value::String(it) => Arc::clone(it),
            Value::Object(_) => {
                let primitive = self.primitive(value)?;
                self.text(&primitive)?
            }
        })
    }

    fn name(&mut self, key: &Value) -> Outcome<Text> {
        let name = self.text(key)?;
        self.spend(name.len() / 8).map(|()| name)
    }

    fn is_loosely_equal(&mut self, a: &Value, b: &Value) -> Outcome<bool> {
        Ok(match (a, b) {
            _ if a.is_nullish() || b.is_nullish() => a.is_nullish() && b.is_nullish(),
            _ if core::mem::discriminant(a) == core::mem::discriminant(b) => a.is_same(b),
            (Value::Object(_), other) | (other, Value::Object(_)) => {
                let primitive =
                    self.primitive(if matches!(a, Value::Object(_)) { a } else { b })?;
                self.is_loosely_equal(&primitive, other)?
            }
            _ => self.number(a)? == self.number(b)?,
        })
    }

    fn operate(&mut self, operator: Operator, a: &Value, b: &Value) -> Outcome {
        use Operator::*;
        match operator {
            Same | NotSame => return Ok((a.is_same(b) == (operator == Same)).into()),
            Equal | NotEqual => {
                return Ok((self.is_loosely_equal(a, b)? == (operator == Equal)).into());
            }
            In => {
                let (Value::Object(id), name) = (b, self.text(a)?) else {
                    return self.throw("TypeError", "Not an object");
                };
                return Ok((self.has_own(b, a)? || self.find(*id, &name).is_some()).into());
            }
            InstanceOf => {
                let (Value::Object(id), Value::Object(wanted)) =
                    (a, self.get_named(b, b"prototype")?)
                else {
                    return Ok(false.into());
                };
                return Ok(self.chain(Some(*id)).skip(1).any(|it| it == wanted).into());
            }
            _ => {}
        }
        let keeps_dates = operator != Add;
        let mut convert = |it: &Value| match self.kind(it) {
            Some(Kind::Date(time)) if keeps_dates => Ok(Value::Number(*time)),
            _ => self.primitive(it),
        };
        let (a, b) = (convert(a)?, convert(b)?);
        let order = match (&a, &b) {
            (Value::String(_), _) | (_, Value::String(_)) if operator == Add => {
                let joined = [self.text(&a)?, self.text(&b)?].concat();
                return self.new_string(&joined);
            }
            (Value::String(a), Value::String(b)) => Some(a.cmp(b)),
            _ => None,
        };
        let (a, b) = (self.number(&a)?, self.number(&b)?);
        let (order, x, y) = (
            order.or_else(|| a.partial_cmp(&b)),
            int32_of(a),
            int32_of(b),
        );
        Ok(Value::Number(match operator {
            Less => return Ok(order.is_some_and(|it| it.is_lt()).into()),
            Greater => return Ok(order.is_some_and(|it| it.is_gt()).into()),
            LessOrEqual => return Ok(order.is_some_and(|it| it.is_le()).into()),
            GreaterOrEqual => return Ok(order.is_some_and(|it| it.is_ge()).into()),
            BitOr => (x | y).into(),
            BitXor => (x ^ y).into(),
            BitAnd => (x & y).into(),
            ShiftLeft => x.wrapping_shl(y as u32).into(),
            ShiftRight => x.wrapping_shr(y as u32).into(),
            ShiftRightUnsigned => (x as u32).wrapping_shr(y as u32).into(),
            Add => a + b,
            Subtract => a - b,
            Multiply => a * b,
            Divide => a / b,
            Power => a.powf(b),
            _ => a % b,
        }))
    }
}

/// Code
impl Machine<'_> {
    fn variable(&mut self, name: Symbol, mut scope: Id) -> Option<&mut Value> {
        let heap = &mut self.script.heap;
        while let Kind::Scope {
            variables, parent, ..
        } = &heap.objects[scope as usize].kind
        {
            if let Some(index) = variables.iter().position(|it| it.0 == name) {
                let Kind::Scope { variables, .. } = &mut heap.objects[scope as usize].kind else {
                    break;
                };
                return Some(&mut variables[index].1);
            }
            scope = *parent;
        }
        heap.globals.get_mut(name as usize)?.as_mut()
    }

    fn look_up(&mut self, name: Symbol, scope: Id) -> Option<Value> {
        self.variable(name, scope).cloned()
    }

    fn assign(&mut self, name: Symbol, scope: Id, value: Value) {
        if let Some(variable) = self.variable(name, scope) {
            *variable = value;
        } else {
            self.script
                .heap
                .globals
                .resize(self.script.symbols.len(), None);
            self.script.heap.globals[name as usize] = Some(value);
        }
    }

    fn hoist(&mut self, code: &Block, scope: Id) -> Outcome<()> {
        let len = code.variables.len() + code.functions.len();
        self.spend(len + if scope == GLOBAL { 0 } else { len * len / 256 })?;
        for name in &code.variables {
            match &mut self.object(scope).kind {
                Kind::Scope { variables, .. } if variables.iter().any(|it| it.0 == *name) => {}
                Kind::Scope { variables, .. } => variables.push((*name, Value::Undefined)),
                _ => {
                    let known = self.look_up(*name, scope).unwrap_or_default();
                    self.assign(*name, scope, known);
                }
            }
        }
        for (name, function) in &code.functions {
            let function =
                self.allocate(Kind::Function(Arc::clone(function), scope), Some(FUNCTIONS));
            self.assign(*name, scope, Value::Object(function));
        }
        Ok(())
    }

    fn this(&mut self, scope: Id) -> Value {
        match &self.object(scope).kind {
            Kind::Scope { this, .. } => this.clone(),
            _ => Value::Undefined,
        }
    }

    pub(crate) fn call(&mut self, callee: &Value, this: &Value, arguments: &[Value]) -> Outcome {
        self.spend(1)?;
        if self.depth == MAX_DEPTH {
            return Err(Abrupt::Abort);
        }
        self.depth += 1;
        let result = match self.kind(callee) {
            Some(Kind::Native(run, name)) => {
                let (run, name): (Native, &'static str) = (*run, name);
                run(self, name, this, arguments)
            }
            Some(Kind::Function(code, outer)) => {
                let (code, outer) = (Arc::clone(code), *outer);
                self.enter(&code, outer, callee, this, arguments)
            }
            _ => self.throw("TypeError", "Not a function"),
        };
        self.depth -= 1;
        result
    }

    fn enter(
        &mut self,
        code: &Function,
        outer: Id,
        callee: &Value,
        this: &Value,
        arguments: &[Value],
    ) -> Outcome {
        let mut variables = Vec::with_capacity(code.code.variables.len());
        if code.uses_arguments && !code.is_arrow {
            variables.push((self.script.arguments, self.new_array(arguments.to_vec())?));
        }
        variables.extend(
            code.own_name
                .filter(|it| !code.code.variables.contains(it))
                .map(|it| (it, callee.clone())),
        );
        let this = if code.is_arrow {
            self.this(outer)
        } else {
            this.clone()
        };
        let scope = self.allocate(
            Kind::Scope {
                variables,
                parent: outer,
                this,
            },
            None,
        );
        let bound = self
            .hoist(&code.code, scope)
            .and_then(|()| self.bind_all(&code.parameters, arguments, scope));
        let result = bound.and_then(|()| self.run_all(&code.code.body, scope));
        self.leave(&code.code, scope);
        match result? {
            Flow::Return(value) => Ok(value),
            _ => Ok(Value::Undefined),
        }
    }

    fn leave(&mut self, code: &Block, scope: Id) {
        if !code.has_closures {
            self.object(scope).kind = Kind::Free;
            self.script.heap.free.push(scope);
            self.steps -= STEPS_FOR_AN_OBJECT;
        }
    }

    fn run_in(&mut self, code: &Block, scope: Id) -> Outcome<Flow> {
        self.hoist(code, scope)?;
        self.run_all(&code.body, scope)
    }

    fn run_block(&mut self, code: &Block, outer: Id) -> Outcome<Flow> {
        if code.variables.is_empty() {
            return self.run_in(code, outer);
        }
        let this = self.this(outer);
        let scope = self.allocate(
            Kind::Scope {
                variables: Vec::with_capacity(code.variables.len()),
                parent: outer,
                this,
            },
            None,
        );
        let result = self.run_in(code, scope);
        self.leave(code, scope);
        result
    }

    fn copy_of_scope(&mut self, scope: Id) -> Id {
        let Kind::Scope {
            variables,
            parent,
            this,
        } = &self.object(scope).kind
        else {
            return scope;
        };
        let (len, copy) = (
            variables.len(),
            Kind::Scope {
                variables: variables.clone(),
                parent: *parent,
                this: this.clone(),
            },
        );
        self.steps += len;
        self.allocate(copy, None)
    }

    fn bind_all(&mut self, patterns: &[Expr], values: &[Value], scope: Id) -> Outcome<()> {
        for (at, pattern) in patterns.iter().enumerate() {
            let value = match pattern {
                Expr::Spread(_) => self.new_array(values.get(at..).unwrap_or_default().to_vec())?,
                _ => values.get(at).cloned().unwrap_or_default(),
            };
            self.bind(pattern, value, scope)?;
        }
        Ok(())
    }

    fn bind(&mut self, pattern: &Expr, value: Value, scope: Id) -> Outcome<()> {
        match pattern {
            Expr::Value(_) => Ok(()),
            Expr::Spread(rest) => self.bind(rest, value, scope),
            Expr::Assign(parts, None) => {
                let value = if value.given().is_some() {
                    value
                } else {
                    self.evaluate(&parts[1], scope)?
                };
                self.bind(&parts[0], value, scope)
            }
            Expr::Array(patterns) => {
                let items = self.iterate(&value)?;
                self.bind_all(patterns, &items, scope)
            }
            Expr::Object(properties) => {
                let mut taken = Vec::new();
                properties.iter().try_for_each(|(key, defines, pattern)| {
                    let member = if let Defines::Spread = defines {
                        let rest = self.new_object(&[], scope)?;
                        self.copy_properties(&value, &rest)?;
                        taken.iter().try_for_each(|it| self.delete(&rest, it))?;
                        rest
                    } else {
                        taken.push(self.evaluate(key, scope)?);
                        self.get(&value, &taken[taken.len() - 1])?
                    };
                    self.bind(pattern, member, scope)
                })
            }
            _ => {
                let place = self.place(pattern, scope)?;
                self.write(&place, scope, value)
            }
        }
    }

    pub(crate) fn iterate(&mut self, value: &Value) -> Outcome<Vec<Value>> {
        let items = match (value, self.kind(value)) {
            (Value::String(text), _) => {
                return self
                    .spend(2 * text.len())
                    .map(|()| text.chunks(1).map(Value::from).collect());
            }
            (_, Some(Kind::Array(items))) => items.clone(),
            (_, Some(Kind::Entries(_))) => {
                return crate::builtins::items_of_collection(self, value);
            }
            _ => return self.throw("TypeError", "Not iterable"),
        };
        self.spend(items.len()).map(|()| items)
    }

    fn evaluate_all(&mut self, all: &[Expr], scope: Id) -> Outcome<Vec<Value>> {
        let mut values = Vec::with_capacity(all.len());
        for each in all {
            let value = self.evaluate(each, scope)?;
            if let Expr::Spread(_) = each {
                values.extend(self.iterate(&value)?)
            } else {
                values.push(value)
            }
        }
        Ok(values)
    }

    fn follow(&mut self, base: &Expr, suffixes: &[Suffix], scope: Id) -> Outcome {
        let (mut value, mut this) = (self.evaluate(base, scope)?, Value::Undefined);
        for suffix in suffixes {
            (value, this) = match suffix {
                Suffix::Member(key) => {
                    let key = self.evaluate(key, scope)?;
                    (self.get(&value, &key)?, value)
                }
                Suffix::Call(arguments) => {
                    let arguments = self.evaluate_all(arguments, scope)?;
                    (self.call(&value, &this, &arguments)?, Value::Undefined)
                }
                Suffix::Optional if value.is_nullish() => return Ok(Value::Undefined),
                Suffix::Optional => continue,
            };
        }
        Ok(value)
    }

    fn place(&mut self, target: &Expr, scope: Id) -> Outcome<Place> {
        match target {
            Expr::Name(name) => Ok(Place::Variable(*name)),
            Expr::Suffixed(base, suffixes)
                if let [before @ .., Suffix::Member(key)] = &suffixes[..] =>
            {
                Ok(Place::Member(
                    self.follow(base, before, scope)?,
                    self.evaluate(key, scope)?,
                ))
            }
            _ => Err(Abrupt::Abort),
        }
    }

    fn read(&mut self, place: &Place, scope: Id) -> Outcome {
        match place {
            Place::Member(object, key) => self.get(object, key),
            Place::Variable(name) => self.look_up(*name, scope).map_or_else(
                || {
                    let message = [self.script.symbols.name(*name), b" is not defined"].concat();
                    let message = self.new_string(&message)?;
                    Err(Abrupt::Throw(self.new_error("ReferenceError", message)))
                },
                Ok,
            ),
        }
    }

    fn write(&mut self, place: &Place, scope: Id, value: Value) -> Outcome<()> {
        match place {
            Place::Member(object, key) => self.set(object, key, value)?,
            Place::Variable(name) => self.assign(*name, scope, value),
        }
        Ok(())
    }

    fn unary(&mut self, operator: Unary, operand: &Expr, scope: Id) -> Outcome {
        let value = match (operator, operand) {
            (Unary::Delete, _) => {
                let Place::Member(object, key) = self.place(operand, scope)? else {
                    return Ok(false.into());
                };
                return self.delete(&object, &key).map(|()| true.into());
            }
            (Unary::TypeOf, Expr::Name(name)) => self.look_up(*name, scope).unwrap_or_default(),
            _ => self.evaluate(operand, scope)?,
        };
        Ok(match operator {
            Unary::Not => (!value.is_truthy()).into(),
            Unary::Minus => (-self.number(&value)?).into(),
            Unary::Plus => self.number(&value)?.into(),
            Unary::BitNot => f64::from(!int32_of(self.number(&value)?)).into(),
            Unary::Void | Unary::Delete => Value::Undefined,
            Unary::TypeOf => match value {
                Value::Undefined => &b"undefined"[..],
                Value::Bool(_) => b"boolean",
                Value::Number(_) => b"number",
                Value::String(_) => b"string",
                _ if self.is_callable(&value) => b"function",
                _ => b"object",
            }
            .into(),
        })
    }

    pub(crate) fn copy_properties(&mut self, from: &Value, to: &Value) -> Outcome<()> {
        self.own_keys(from)?.iter().try_for_each(|key| {
            self.spend(1)?;
            let value = self.get(from, key)?;
            self.set(to, key, value)
        })
    }

    fn new_object(&mut self, properties: &[(Expr, Defines, Expr)], scope: Id) -> Outcome {
        let object = self.allocate(Kind::Plain, Some(OBJECTS));
        for (key, defines, value) in properties {
            let (key, value) = (self.evaluate(key, scope)?, self.evaluate(value, scope)?);
            let key = &self.name(&key)?;
            self.spend(4)?;
            let known = self
                .object(object)
                .properties
                .get(key)
                .filter(|it| it.setter.is_some())
                .cloned()
                .unwrap_or_default();
            let property = match defines {
                Defines::Value if **key == *b"__proto__" => {
                    self.set_prototype(object, &value);
                    continue;
                }
                Defines::Spread => {
                    self.copy_properties(&value, &Value::Object(object))?;
                    continue;
                }
                Defines::Value => Property {
                    value,
                    setter: None,
                },
                Defines::Getter => Property {
                    value,
                    setter: Some(known.setter.unwrap_or_default()),
                },
                Defines::Setter => Property {
                    value: known.value,
                    setter: Some(value),
                },
            };
            self.object(object).properties.insert(key, property);
        }
        Ok(Value::Object(object))
    }

    fn construct(&mut self, callee: &Value, arguments: &[Value]) -> Outcome {
        if matches!(self.kind(callee), Some(Kind::Native(..))) {
            return self.call(callee, &Value::Undefined, arguments);
        }
        let prototype = self.get_named(callee, b"prototype")?;
        let this = self.new_object_like(&prototype);
        let result = self.call(callee, &this, arguments)?;
        Ok(if matches!(result, Value::Object(_)) {
            result
        } else {
            this
        })
    }

    fn evaluate(&mut self, expr: &Expr, scope: Id) -> Outcome {
        if !self.stack.is_safe_to_recurse() {
            return Err(Abrupt::Abort);
        }
        self.tick()?;
        match expr {
            Expr::Value(value) => Ok(value.clone()),
            Expr::Pattern(source, flags) => self.new_pattern(source, flags),
            Expr::Name(name) => self.read(&Place::Variable(*name), scope),
            Expr::This => Ok(self.this(scope)),
            Expr::Array(items) => {
                let items = self.evaluate_all(items, scope)?;
                self.new_array(items)
            }
            Expr::Object(properties) => self.new_object(properties, scope),
            Expr::Spread(spread) => self.evaluate(spread, scope),
            Expr::Function(code) => Ok(Value::Object(
                self.allocate(Kind::Function(Arc::clone(code), scope), Some(FUNCTIONS)),
            )),
            Expr::New(callee, arguments) => {
                let (callee, arguments) = (
                    self.evaluate(callee, scope)?,
                    self.evaluate_all(arguments, scope)?,
                );
                self.construct(&callee, &arguments)
            }
            Expr::Suffixed(base, suffixes) => self.follow(base, suffixes, scope),
            Expr::Unary(operator, operand) => self.unary(*operator, operand, scope),
            Expr::Update {
                target,
                by,
                gives_old,
            } => {
                let place = self.place(target, scope)?;
                let old = self.read(&place, scope)?;
                let old = self.number(&old)?;
                self.write(&place, scope, (old + by).into())?;
                Ok(if *gives_old { old } else { old + by }.into())
            }
            Expr::Binary(first, rest) => {
                let mut left = self.evaluate(first, scope)?;
                for (operator, right) in rest {
                    let right = self.evaluate(right, scope)?;
                    left = self.operate(*operator, &left, &right)?;
                }
                Ok(left)
            }
            Expr::Logical(operator, all) => {
                let mut value = Value::Undefined;
                for each in all {
                    value = self.evaluate(each, scope)?;
                    let decides = match operator {
                        Logical::And => !value.is_truthy(),
                        Logical::Or => value.is_truthy(),
                        Logical::Coalesce => !value.is_nullish(),
                    };
                    if decides {
                        break;
                    }
                }
                Ok(value)
            }
            Expr::Conditional(parts) => {
                let branch = if self.evaluate(&parts[0], scope)?.is_truthy() {
                    1
                } else {
                    2
                };
                self.evaluate(&parts[branch], scope)
            }
            Expr::Assign(parts, None) if matches!(parts[0], Expr::Array(_) | Expr::Object(_)) => {
                let value = self.evaluate(&parts[1], scope)?;
                self.bind(&parts[0], value.clone(), scope).map(|()| value)
            }
            Expr::Assign(parts, operator) => {
                let place = self.place(&parts[0], scope)?;
                let old = operator.map(|_| self.read(&place, scope)).transpose()?;
                let mut value = self.evaluate(&parts[1], scope)?;
                if let Some((operator, old)) = operator.zip(old) {
                    value = self.operate(operator, &old, &value)?;
                }
                self.write(&place, scope, value.clone())?;
                Ok(value)
            }
            Expr::Sequence(all) => all
                .iter()
                .try_fold(Value::Undefined, |_, it| self.evaluate(it, scope)),
        }
    }

    fn run_all(&mut self, all: &[Stmt], scope: Id) -> Outcome<Flow> {
        for each in all {
            match self.run(each, scope)? {
                Flow::Normal => {}
                jump => return Ok(jump),
            }
        }
        Ok(Flow::Normal)
    }

    /// `None` if the loop goes on.
    fn run_turn(&mut self, labels: &[Symbol], body: &Stmt, scope: Id) -> Outcome<Option<Flow>> {
        self.spend(1)?;
        Ok(match self.run(body, scope)? {
            Flow::Normal | Flow::Continue(None) => None,
            Flow::Continue(Some(label)) if labels.contains(&label) => None,
            Flow::Break(None) => Some(Flow::Normal),
            jump => Some(jump),
        })
    }

    fn inherited_keys(&mut self, value: &Value) -> Outcome<Vec<Value>> {
        let Value::Object(id) = value else {
            return self.own_keys(value);
        };
        let (chain, mut seen) = (
            self.chain(Some(*id)).collect::<Vec<_>>(),
            StringArrayHashMap::<()>::default(),
        );
        let keys = chain
            .into_iter()
            .map(|it| self.own_keys(&Value::Object(it)))
            .collect::<Outcome<Vec<_>>>()?
            .into_iter()
            .flatten();
        Ok(keys.filter(|it| matches!(it, Value::String(key) if **key != *b"constructor" && seen.insert(key, ()).is_none())).collect())
    }

    fn run_loop(
        &mut self,
        labels: &[Symbol],
        how: &Loop,
        body: &Stmt,
        renews_scope: bool,
        mut scope: Id,
    ) -> Outcome<Flow> {
        match how {
            Loop::Counting {
                start,
                test,
                update,
                tests_first,
            } => {
                let mut tests = *tests_first;
                start
                    .iter()
                    .try_for_each(|it| self.evaluate(it, scope).map(|_| ()))?;
                loop {
                    if let Some(test) = test.as_ref().filter(|_| tests)
                        && !self.evaluate(test, scope)?.is_truthy()
                    {
                        return Ok(Flow::Normal);
                    }
                    if let Some(end) = self.run_turn(labels, body, scope)? {
                        return Ok(end);
                    }
                    scope = if renews_scope {
                        self.copy_of_scope(scope)
                    } else {
                        scope
                    };
                    update
                        .iter()
                        .try_for_each(|it| self.evaluate(it, scope).map(|_| ()))?;
                    tests = true;
                }
            }
            Loop::Each {
                target,
                subject,
                wants_keys,
            } => {
                let subject = self.evaluate(subject, scope)?;
                for item in if *wants_keys {
                    self.inherited_keys(&subject)?
                } else {
                    self.iterate(&subject)?
                } {
                    scope = if renews_scope {
                        self.copy_of_scope(scope)
                    } else {
                        scope
                    };
                    self.bind(target, item, scope)?;
                    if let Some(end) = self.run_turn(labels, body, scope)? {
                        return Ok(end);
                    }
                }
                Ok(Flow::Normal)
            }
        }
    }

    fn run_switch(
        &mut self,
        subject: &Expr,
        cases: &[(Option<Expr>, Vec<Stmt>)],
        scope: Id,
    ) -> Outcome<Flow> {
        let (value, mut first) = (
            self.evaluate(subject, scope)?,
            cases.iter().position(|it| it.0.is_none()),
        );
        for (index, case) in cases.iter().enumerate() {
            if let Some(test) = &case.0
                && self.evaluate(test, scope)?.is_same(&value)
            {
                first = Some(index);
                break;
            }
        }
        for case in &cases[first.unwrap_or(cases.len())..] {
            match self.run_all(&case.1, scope)? {
                Flow::Normal => {}
                Flow::Break(None) => break,
                jump => return Ok(jump),
            }
        }
        Ok(Flow::Normal)
    }

    fn run(&mut self, statement: &Stmt, scope: Id) -> Outcome<Flow> {
        if !self.stack.is_safe_to_recurse() {
            return Err(Abrupt::Abort);
        }
        match statement {
            Stmt::Expr(expr) => self.evaluate(expr, scope).map(|_| Flow::Normal),
            Stmt::Block(block) => self.run_block(block, scope),
            Stmt::If(branches, otherwise) => {
                for (test, branch) in branches {
                    if self.evaluate(test, scope)?.is_truthy() {
                        return self.run(branch, scope);
                    }
                }
                otherwise
                    .as_ref()
                    .map_or(Ok(Flow::Normal), |it| self.run(it, scope))
            }
            Stmt::Loop {
                labels,
                how,
                body,
                renews_scope,
            } => self.run_loop(labels, how, body, *renews_scope, scope),
            Stmt::Switch(subject, cases) => self.run_switch(subject, cases, scope),
            Stmt::Try(parts) => {
                let Try {
                    body,
                    caught,
                    handler,
                    last,
                } = &**parts;
                let result = match (self.run_block(body, scope), handler) {
                    (Err(Abrupt::Throw(error)), Some(handler)) => {
                        caught
                            .iter()
                            .for_each(|it| self.assign(*it, scope, error.clone()));
                        self.run_block(handler, scope)
                    }
                    (result, _) => result,
                };
                match last {
                    Some(last) if !matches!(result, Err(Abrupt::Abort)) => {
                        match self.run_block(last, scope)? {
                            Flow::Normal => result,
                            jump => Ok(jump),
                        }
                    }
                    _ => result,
                }
            }
            Stmt::Labeled(label, body) => match self.run(body, scope)? {
                Flow::Break(Some(target)) if target == *label => Ok(Flow::Normal),
                flow => Ok(flow),
            },
            Stmt::Break(label) => Ok(Flow::Break(*label)),
            Stmt::Continue(label) => Ok(Flow::Continue(*label)),
            Stmt::Return(value) => value
                .as_ref()
                .map_or(Ok(Value::Undefined), |it| self.evaluate(it, scope))
                .map(Flow::Return),
            Stmt::Throw(value) => Err(Abrupt::Throw(self.evaluate(value, scope)?)),
        }
    }
}
