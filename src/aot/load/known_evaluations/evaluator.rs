use std::rc::Rc;

use bun_paths::platform::Posix;
use bun_paths::resolve_path::dirname;
use bun_sema::atom::{Atom, Interner, known};
use bun_sema::hir::{
    BinOp, Call, CallId, Chain, ClassId, ExprId, ExprKind, File, Flags, FnBody, FnId, FnKind,
    IdList, MemberKind, PatId, PatKind, PropKey, PropKind, StmtId, StmtKind, UnOp, VarKind,
};
use bun_sema_driver::host::from_argument;
use rustc_hash::{FxHashMap, FxHashSet};

use super::strings;
use super::values::{EnvironmentId, Global, Matcher, Object, ObjectId, Value};
use super::{CodeBeside, EvaluatingCall, EvaluatingKind};

const ALLOWANCE: u32 = 1 << 18;
pub(super) const TEXT_PER_SOURCE: usize = 8;
const MAX_DEPTH: u32 = 256;
const GLOBAL_ENVIRONMENT: EnvironmentId = EnvironmentId(1);

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
enum Completion {
    Normal,
    Break(Atom),
    Continue(Atom),
    Return,
    Throw,
}

#[derive(Copy, Clone)]
enum Alternative {
    Nothing,
    Statement(StmtId),
    Statements(IdList<StmtId>),
    Expression(ExprId),
    Iteration(StmtId, ExprId),
}

#[derive(Copy, Clone, PartialEq, Eq, Hash)]
enum Place {
    Variable(EnvironmentId, Atom),
    Object(ObjectId),
}

#[derive(Clone, PartialEq)]
enum Contents {
    Variable(Option<Value>),
    Object(Object),
}

#[derive(Default)]
struct Environment {
    parent: Option<EnvironmentId>,
    is_of_function: bool,
    variables: FxHashMap<Atom, Value>,
}

pub(super) struct Evaluator<'a, 's> {
    hir: &'a File<'s>,
    atoms: &'a Interner<'s>,
    beside: &'a CodeBeside<'a>,
    first_call: CallId,
    files: FxHashMap<Rc<[u8]>, Option<Rc<[u8]>>>,
    appended: u32,
    evals: FxHashSet<CallId>,
    calls_of_function: FxHashSet<CallId>,
    indirect_evals: FxHashSet<CallId>,
    texts: Vec<(CallId, Vec<Rc<[u8]>>)>,
    noted: FxHashSet<(CallId, Vec<Rc<[u8]>>)>,
    text_allowance: usize,
    environments: Vec<Environment>,
    current: EnvironmentId,
    closures: FxHashMap<FnId, EnvironmentId>,
    ends: FxHashMap<FnId, u32>,
    prototypes: FxHashMap<FnId, FxHashMap<Rc<[u8]>, Value>>,
    properties_of_globals: FxHashMap<(Global, Rc<[u8]>), Value>,
    evaluating: FxHashSet<FnId>,
    evaluating_methods: Vec<(FnId, FnId)>,
    receiver: Value,
    entered: FxHashSet<FnId>,
    objects: Vec<Object>,
    journal: Vec<(Place, Contents)>,
    alternatives: u32,
    returned: Option<Value>,
    allowance: u32,
    repetitions: u32,
    depth: u32,
}

impl<'a, 's> Evaluator<'a, 's> {
    pub(super) fn new(
        hir: &'a File<'s>,
        atoms: &'a Interner<'s>,
        beside: &'a CodeBeside<'a>,
        calls: &[EvaluatingCall],
        first_call: CallId,
        text_allowance: usize,
    ) -> Self {
        let appended = hir.text.len() as u32 - hir.written_text_end();
        let calls_of = |kind: EvaluatingKind| {
            let calls = calls.iter().filter(|it| it.kind == kind);
            calls.map(|it| it.call).collect()
        };
        Evaluator {
            hir,
            atoms,
            beside,
            first_call,
            files: FxHashMap::default(),
            appended,
            evals: calls_of(EvaluatingKind::DirectEval),
            calls_of_function: calls_of(EvaluatingKind::Function),
            indirect_evals: calls_of(EvaluatingKind::IndirectEval),
            texts: Vec::new(),
            noted: FxHashSet::default(),
            text_allowance,
            environments: vec![
                Environment {
                    parent: Some(GLOBAL_ENVIRONMENT),
                    is_of_function: true,
                    ..Environment::default()
                },
                Environment {
                    is_of_function: true,
                    ..Environment::default()
                },
            ],
            current: EnvironmentId(0),
            closures: FxHashMap::default(),
            ends: FxHashMap::default(),
            prototypes: FxHashMap::default(),
            properties_of_globals: FxHashMap::default(),
            evaluating: calls
                .iter()
                .flat_map(|it| it.functions.iter().copied())
                .collect(),
            evaluating_methods: Vec::new(),
            receiver: Value::Unknown,
            entered: FxHashSet::default(),
            objects: Vec::new(),
            journal: Vec::new(),
            alternatives: 0,
            returned: None,
            allowance: ALLOWANCE.saturating_add(appended),
            repetitions: 0,
            depth: 0,
        }
    }

    fn renew_allowance(&mut self) {
        self.allowance = ALLOWANCE.saturating_add(self.appended);
    }

    fn declare_module_names(&mut self) {
        let exports = self.create(Object::unseen());
        let mut module = Object::unseen();
        module.set(b"exports", exports.clone());
        let module = self.create(module);
        let folder = Value::Path(dirname::<Posix>(self.beside.path).into());
        let names = [
            (known::require, Value::Global(Global::Require)),
            (known::exports, exports),
            (known::module, module),
            (self.atoms.intern(b"__dirname"), folder),
            (
                self.atoms.intern(b"__filename"),
                Value::Path(self.beside.path.into()),
            ),
        ];
        for (name, value) in names {
            self.declare(EnvironmentId(0), name, value);
        }
        let hir = self.hir;
        for import in hir.imports.iter().filter(|it| !it.type_only) {
            let Some(module) = Global::of_module(self.atoms.bytes(import.spec)) else {
                continue;
            };
            for whole in [import.default, import.namespace] {
                if whole.is_some() {
                    self.declare(EnvironmentId(0), whole, Value::Global(module));
                }
            }
            for spec in import.named.iter() {
                let spec = hir[spec];
                if let Some(value) = module.property(self.atoms.bytes(spec.imported)) {
                    self.declare(EnvironmentId(0), spec.local, Value::Global(value));
                }
            }
        }
    }

    pub(super) fn find_texts(
        mut self,
        calls: &[EvaluatingCall],
    ) -> (Vec<(CallId, Vec<Rc<[u8]>>)>, usize) {
        self.declare_module_names();
        self.hoist(self.hir.body);
        self.statements(self.hir.body);
        self.call_methods_of_globals();
        for call in calls {
            let mut around = EnvironmentId(0);
            for &function in &call.functions {
                let own = self.closures.get(&function).copied();
                around = own.unwrap_or(around);
                if !self.entered.contains(&function) {
                    self.renew_allowance();
                    around = self.run(function, around, &[], Value::Unknown).0;
                }
            }
        }
        self.construct_with_constants();
        (self.texts, self.text_allowance)
    }

    fn call_methods_of_globals(&mut self) {
        let hir = self.hir;
        let mut added = self.properties_of_globals.values();
        if !added.any(|it| matches!(it, Value::Function(it, _) if self.evaluating.contains(it))) {
            return;
        }
        self.renew_allowance();
        type Arguments = Vec<(bool, Option<Rc<[u8]>>)>;
        let mut called: FxHashSet<(FnId, Arguments)> = FxHashSet::default();
        for expression in hir.exprs.iter() {
            let ExprKind::Call(call) = expression.kind else {
                continue;
            };
            let site = hir[call];
            let ExprKind::Dot { obj, name, .. } = hir[hir.skip_type_assertions(site.callee)].kind
            else {
                continue;
            };
            let holder = match hir[hir.skip_type_assertions(obj)].kind {
                ExprKind::Ident(name) => self.read(name),
                _ => Value::Unknown,
            };
            let method = match holder {
                Value::Global(_) => self.property(&holder, self.atoms.bytes(name)),
                _ => self.method_of_global(self.atoms.bytes(name)),
            };
            let Value::Function(function, around) = method else {
                continue;
            };
            let args: Vec<Value> = hir.ids(site.args).map(|it| self.constant(it)).collect();
            let key = args
                .iter()
                .map(|it| (it.as_string().is_some(), it.to_text()));
            if args.iter().any(Value::is_known) && called.insert((function, key.collect())) {
                self.call_function(function, around, &args, holder);
            }
        }
    }

    fn method_of_global(&self, name: &[u8]) -> Value {
        let mut methods = (self.properties_of_globals.iter())
            .filter(|((holder, key), _)| holder.is_prototype_of_class() && **key == *name);
        match (methods.next(), methods.next()) {
            (Some((_, method @ Value::Function(..))), None) => method.clone(),
            _ => Value::Unknown,
        }
    }

    fn construct_with_constants(&mut self) {
        let hir = self.hir;
        let methods = self.evaluating_methods.iter();
        let mut constructors: Vec<FnId> = methods.map(|it| it.0).collect();
        constructors.sort_unstable_by_key(|it| it.0);
        constructors.dedup();
        if constructors.is_empty() {
            return;
        }
        self.renew_allowance();
        let outer = self.current;
        type Arguments = Vec<(bool, Option<Rc<[u8]>>)>;
        let mut constructed: FxHashSet<(FnId, Arguments)> = FxHashSet::default();
        for expression in hir.exprs.iter() {
            let ExprKind::New(call) = expression.kind else {
                continue;
            };
            let site = hir[call];
            let ExprKind::Ident(name) = hir[hir.skip_type_assertions(site.callee)].kind else {
                continue;
            };
            for &constructor in &constructors {
                let Some(&around) = self.closures.get(&constructor) else {
                    continue;
                };
                self.current = around;
                if self.read(name) != Value::Function(constructor, around) {
                    continue;
                }
                let args: Vec<Value> = hir.ids(site.args).map(|it| self.constant(it)).collect();
                let key = args
                    .iter()
                    .map(|it| (it.as_string().is_some(), it.to_text()));
                if constructed.insert((constructor, key.collect())) {
                    let instance = self.construct(constructor, around, &args);
                    self.call_evaluating_methods(constructor, &instance);
                }
            }
        }
        self.current = outer;
    }

    fn call_evaluating_methods(&mut self, constructor: FnId, instance: &Value) {
        for index in 0..self.evaluating_methods.len() {
            let (owner, method) = self.evaluating_methods[index];
            let around = self.closures.get(&method).copied();
            if let Some(around) = around.filter(|_| owner == constructor) {
                let args = vec![Value::Unknown; self.hir[method].params.len()];
                self.call_function(method, around, &args, instance.clone());
            }
        }
    }

    fn constant(&self, expression: ExprId) -> Value {
        let hir = self.hir;
        match hir[hir.skip_type_assertions(expression)].kind {
            ExprKind::Null => Value::Null,
            ExprKind::True => Value::Boolean(true),
            ExprKind::False => Value::Boolean(false),
            ExprKind::Number(number) => Value::Number(hir.numbers[number as usize]),
            ExprKind::String(text) => Value::string(self.atoms.bytes(text)),
            _ => Value::Unknown,
        }
    }

    fn construct(&mut self, function: FnId, around: EnvironmentId, args: &[Value]) -> Value {
        let instance = self.create(Object::instance(function));
        match self.call_function(function, around, args, instance.clone()) {
            object @ Value::Object(_) => object,
            _ => instance,
        }
    }

    fn has_evaluating_methods(&self, constructor: FnId) -> bool {
        let mut methods = self.evaluating_methods.iter();
        methods.any(|it| it.0 == constructor)
    }

    fn set_on_prototype(&mut self, constructor: FnId, key: &[u8], value: Value) {
        if let Value::Function(method, _) = value
            && self.evaluating.contains(&method)
        {
            self.evaluating_methods.push((constructor, method));
        }
        let properties = self.prototypes.entry(constructor).or_default();
        properties.insert(key.into(), value);
    }

    fn class(&mut self, class: ClassId) -> Value {
        let hir = self.hir;
        let current = self.current;
        let mut constructor = None;
        for member in hir[class].members.iter() {
            let function = hir[member].func;
            if function.is_none() || matches!(hir[function].body, FnBody::None) {
                continue;
            }
            self.closures.insert(function, current);
            if hir.runtime_member_kind(member) == MemberKind::Constructor {
                constructor = Some(function);
            }
        }
        let Some(constructor) = constructor else {
            return Value::Unknown;
        };
        for member in hir[class].members.iter() {
            let it = hir[member];
            if hir.runtime_member_kind(member) == MemberKind::Method
                && !it.flags.contains(Flags::STATIC)
                && let PropKey::Name(name) = it.key
                && self.closures.contains_key(&it.func)
            {
                let key = self.atoms.bytes(name);
                self.set_on_prototype(constructor, key, Value::Function(it.func, current));
            }
        }
        Value::Function(constructor, current)
    }

    fn pays(&mut self, cost: usize) -> bool {
        if self.repetitions == 0 {
            return true;
        }
        let cost = u32::try_from(cost).unwrap_or(u32::MAX);
        match self.allowance.checked_sub(cost) {
            Some(left) => {
                self.allowance = left;
                true
            }
            None => {
                self.allowance = 0;
                false
            }
        }
    }

    fn pays_for_text(&mut self, length: usize) -> bool {
        self.repetitions += 1;
        let pays = self.pays(length / 16 + 1);
        self.repetitions -= 1;
        pays
    }

    fn string(&mut self, text: Vec<u8>) -> Value {
        match self.pays_for_text(text.len()) {
            true => Value::String(text.into()),
            false => Value::Unknown,
        }
    }

    fn create(&mut self, object: Object) -> Value {
        if !self.pays(object.size() + 1) {
            return Value::Unknown;
        }
        self.objects.push(object);
        Value::Object(ObjectId(self.objects.len() - 1))
    }

    fn create_array(&mut self, elements: Vec<Value>) -> Value {
        self.create(Object::array(elements))
    }

    fn elements_of(&self, value: &Value) -> Option<Vec<Value>> {
        match value {
            Value::Object(id) => {
                let object = &self.objects[id.0];
                (object.is_array && !object.is_open).then(|| object.elements.clone())
            }
            Value::String(text) if text.is_ascii() => {
                Some(text.chunks(1).map(Value::string).collect())
            }
            _ => None,
        }
    }

    fn contents(&self, place: Place) -> Contents {
        match place {
            Place::Variable(environment, name) => {
                let variables = &self.environments[environment.0].variables;
                Contents::Variable(variables.get(&name).cloned())
            }
            Place::Object(id) => Contents::Object(self.objects[id.0].clone()),
        }
    }

    fn restore(&mut self, place: Place, contents: Contents) {
        match (place, contents) {
            (Place::Variable(environment, name), Contents::Variable(value)) => {
                let variables = &mut self.environments[environment.0].variables;
                match value {
                    Some(value) => variables.insert(name, value),
                    None => variables.remove(&name),
                };
            }
            (Place::Object(id), Contents::Object(object)) => self.objects[id.0] = object,
            (Place::Variable(..), Contents::Object(_))
            | (Place::Object(_), Contents::Variable(_)) => {
                unreachable!("a place keeps its kind")
            }
        }
    }

    fn note_write(&mut self, place: Place) {
        if self.alternatives > 0 {
            if let Place::Object(id) = place {
                let size = self.objects[id.0].size();
                self.pays(size);
            }
            let before = self.contents(place);
            self.journal.push((place, before));
        }
    }

    fn declare(&mut self, environment: EnvironmentId, name: Atom, value: Value) {
        self.note_write(Place::Variable(environment, name));
        self.environments[environment.0]
            .variables
            .insert(name, value);
    }

    fn environment_of(&self, name: Atom) -> Option<EnvironmentId> {
        let mut at = Some(self.current);
        while let Some(environment) = at {
            let it = &self.environments[environment.0];
            if it.variables.contains_key(&name) {
                return Some(environment);
            }
            at = it.parent;
        }
        None
    }

    fn function_environment(&self) -> EnvironmentId {
        let mut at = self.current;
        while !self.environments[at.0].is_of_function {
            at = self.environments[at.0].parent.unwrap_or(EnvironmentId(0));
        }
        at
    }

    fn enter_block(&mut self) -> EnvironmentId {
        let outer = self.current;
        self.environments.push(Environment {
            parent: Some(outer),
            ..Environment::default()
        });
        self.current = EnvironmentId(self.environments.len() - 1);
        outer
    }

    fn read(&self, name: Atom) -> Value {
        if let Some(environment) = self.environment_of(name) {
            let value = self.environments[environment.0].variables.get(&name);
            return value.cloned().unwrap_or(Value::Unknown);
        }
        match self.atoms.bytes(name) {
            b"undefined" => Value::Undefined,
            b"NaN" => Value::Number(f64::NAN),
            b"Infinity" => Value::Number(f64::INFINITY),
            b"Object" => Value::Global(Global::Object),
            b"Array" => Value::Global(Global::Array),
            b"Date" => Value::Global(Global::Date),
            b"Number" => Value::Global(Global::Number),
            b"String" => Value::Global(Global::String),
            b"RegExp" => Value::Global(Global::RegExp),
            b"URL" => Value::Global(Global::Url),
            _ => Value::Unknown,
        }
    }

    fn assign(&mut self, name: Atom, value: Value) {
        let environment = self.environment_of(name).unwrap_or(GLOBAL_ENVIRONMENT);
        self.declare(environment, name, value);
    }

    fn change_object(&mut self, id: ObjectId, change: impl FnOnce(&mut Object)) {
        self.note_write(Place::Object(id));
        change(&mut self.objects[id.0]);
    }

    fn run_alternatives(&mut self, alternatives: &[Alternative]) -> (Completion, Value) {
        type Finals = FxHashMap<Place, Contents>;
        let first = self.journal.len();
        self.alternatives += 1;
        let mut results: Vec<(Completion, Value, Finals)> = Vec::new();
        for &alternative in alternatives {
            let (completion, value) = match alternative {
                Alternative::Nothing => (Completion::Normal, Value::Undefined),
                Alternative::Statement(statement) => (self.statement(statement), Value::Undefined),
                Alternative::Statements(list) => (self.statements(list), Value::Undefined),
                Alternative::Expression(expression) => {
                    (Completion::Normal, self.expression(expression))
                }
                Alternative::Iteration(body, update) => {
                    let completion = self.statement(body);
                    if update.is_some() {
                        self.expression(update);
                    }
                    (completion, Value::Undefined)
                }
            };
            let written = self.journal[first..].iter().map(|it| it.0);
            let finals: Finals = written.map(|place| (place, self.contents(place))).collect();
            while self.journal.len() > first {
                let Some((place, before)) = self.journal.pop() else {
                    break;
                };
                self.restore(place, before);
            }
            results.push((completion, value, finals));
        }
        self.alternatives -= 1;
        let completion = match results.iter().any(|it| it.0 == Completion::Normal) {
            true => Completion::Normal,
            false => results.first().map_or(Completion::Normal, |it| it.0),
        };
        results.retain(|it| it.0 == completion);
        let places: FxHashSet<Place> = results.iter().flat_map(|it| it.2.keys().copied()).collect();
        for place in places {
            let finals = |result: &(Completion, Value, Finals)| {
                let written = result.2.get(&place).cloned();
                written.unwrap_or_else(|| self.contents(place))
            };
            let mut all = results.iter().map(finals);
            let Some(merged) = all.next() else {
                continue;
            };
            let merged = all.fold(merged, merge);
            self.note_write(place);
            self.restore(place, merged);
        }
        let mut values = results.into_iter().map(|it| it.1);
        let first = values.next().unwrap_or(Value::Undefined);
        let value = match values.all(|it| it == first) {
            true => first,
            false => Value::Unknown,
        };
        (completion, value)
    }

    fn run(
        &mut self,
        function: FnId,
        around: EnvironmentId,
        args: &[Value],
        receiver: Value,
    ) -> (EnvironmentId, Value) {
        let hir = self.hir;
        let func = hir[function];
        let returned = self.returned.take();
        let outer = self.current;
        let receiver = match func.kind {
            FnKind::Arrow => self.receiver.clone(),
            _ => receiver,
        };
        let outer_receiver = std::mem::replace(&mut self.receiver, receiver);
        self.entered.insert(function);
        self.environments.push(Environment {
            parent: Some(around),
            is_of_function: true,
            ..Environment::default()
        });
        let own = EnvironmentId(self.environments.len() - 1);
        self.current = own;
        if func.name != Atom::NONE && func.name != known::empty {
            self.declare(own, func.name, Value::Function(function, around));
        }
        let names_arguments = known::arguments;
        self.declare(own, names_arguments, Value::Unknown);
        for (index, param) in func.params.iter().enumerate() {
            let param = hir[param];
            if param.flags.contains(Flags::REST) {
                let rest = match args.is_empty() {
                    true => Value::Unknown,
                    false => self.create_array(args.get(index..).unwrap_or_default().to_vec()),
                };
                self.bind(param.pat, rest, None);
                break;
            }
            let given = match args.get(index) {
                Some(value) => value.clone(),
                None if args.is_empty() => Value::Unknown,
                None => Value::Undefined,
            };
            let value = match given == Value::Undefined && param.default.is_some() {
                true => self.expression(param.default),
                false => given,
            };
            self.bind(param.pat, value, None);
        }
        let result = match func.body {
            FnBody::None => Value::Unknown,
            FnBody::Expr(expression) => self.expression(expression),
            FnBody::Block(body) => {
                self.hoist(body);
                let completion = self.statements(body);
                let returned = self.returned.take();
                match (completion, returned) {
                    (Completion::Return, Some(value)) => value,
                    (Completion::Normal, None) => Value::Undefined,
                    _ => Value::Unknown,
                }
            }
        };
        self.current = outer;
        self.returned = returned;
        self.receiver = outer_receiver;
        (own, result)
    }

    fn call_function(
        &mut self,
        function: FnId,
        around: EnvironmentId,
        args: &[Value],
        receiver: Value,
    ) -> Value {
        let func = self.hir[function];
        if func.flags.intersects(Flags::ASYNC | Flags::GENERATOR) {
            return Value::Unknown;
        }
        let is_instance = match &receiver {
            Value::Object(id) => self.objects[id.0].constructor.is_some(),
            _ => false,
        };
        if !args.is_empty() && !is_instance && !args.iter().any(Value::is_known) {
            return Value::Unknown;
        }
        let handed = match args.is_empty() {
            true => &[Value::Undefined][..],
            false => args,
        };
        if self.depth + 4 >= MAX_DEPTH || self.allowance == 0 {
            return Value::Unknown;
        }
        let share = (self.allowance / 4).max(1).min(self.allowance);
        let rest = self.allowance - share;
        self.allowance = share;
        self.repetitions += 1;
        self.depth += 4;
        let (_, result) = self.run(function, around, handed, receiver);
        self.depth -= 4;
        self.repetitions -= 1;
        let is_exhausted = self.allowance == 0;
        self.allowance += rest;
        match is_exhausted {
            true => Value::Unknown,
            false => result,
        }
    }

    fn call_value(&mut self, callee: &Value, args: &[Value], receiver: Value) -> Value {
        match callee {
            Value::Function(function, around) => {
                self.call_function(*function, *around, args, receiver)
            }
            Value::Global(Global::String) => match args.first() {
                Some(value @ Value::Function(..)) => {
                    let source = self.text_of(value);
                    source.map_or(Value::Unknown, Value::String)
                }
                Some(value) => value.to_text().map_or(Value::Unknown, Value::String),
                None => Value::string(b""),
            },
            Value::Global(Global::RegExp) => self.create_pattern(args),
            Value::Global(Global::Array) => self.create_array_of(args.to_vec()),
            Value::Global(Global::Require) => {
                let module = args.first().and_then(Value::as_string);
                let module = module.and_then(|it| Global::of_module(it));
                module.map_or(Value::Unknown, Value::Global)
            }
            Value::Global(Global::RequireResolve) => match args {
                [Value::String(specifier)] if is_relative(specifier) => {
                    self.join_path(&dirname::<Posix>(self.beside.path).into(), specifier)
                }
                _ => Value::Unknown,
            },
            Value::Global(Global::ReadFileSync) => self.read_file(args),
            Value::Global(Global::PathDirname) => match args {
                [Value::Path(path)] => Value::Path(dirname::<Posix>(path).into()),
                _ => Value::Unknown,
            },
            Value::Global(Global::PathJoin) => {
                let Some((Value::Path(path), rest)) = args.split_first() else {
                    return Value::Unknown;
                };
                let mut joined = Rc::clone(path);
                for part in rest {
                    let Value::String(part) = part else {
                        return Value::Unknown;
                    };
                    match self.join_path(&joined, part) {
                        Value::Path(path) => joined = path,
                        _ => return Value::Unknown,
                    }
                }
                Value::Path(joined)
            }
            Value::Global(Global::FileUrlToPath) => match args {
                [path @ Value::Path(_)] => path.clone(),
                _ => Value::Unknown,
            },
            Value::Evaluated => self.create(Object::unseen()),
            _ => Value::Unknown,
        }
    }

    fn join_path(&self, folder: &Rc<[u8]>, relative: &[u8]) -> Value {
        match relative.first() {
            Some(b'/') | None => Value::Unknown,
            Some(_) => Value::Path(from_argument(folder, relative).into()),
        }
    }

    fn read_file(&mut self, args: &[Value]) -> Value {
        let Some(Value::Path(path)) = args.first() else {
            return Value::Unknown;
        };
        let encoding = match args.get(1) {
            Some(Value::Object(id)) => self.objects[id.0].get(b"encoding"),
            Some(value) => value.clone(),
            None => Value::Undefined,
        };
        let is_text = match &encoding {
            Value::Undefined | Value::Null => false,
            Value::String(name) if matches!(&name[..], b"utf8" | b"utf-8" | b"UTF-8" | b"UTF8") => {
                true
            }
            _ => return Value::Unknown,
        };
        let contents = match self.files.get(path) {
            Some(contents) => contents.clone(),
            None => {
                let contents = (self.beside.read_file)(path);
                let contents = contents.filter(|it| std::str::from_utf8(it).is_ok());
                let contents: Option<Rc<[u8]>> = contents.map(Rc::from);
                let length = contents.as_ref().map_or(0, |it| it.len());
                self.text_allowance += length * TEXT_PER_SOURCE;
                let added = u32::try_from(4 * length).unwrap_or(u32::MAX);
                self.allowance = self.allowance.saturating_add(added);
                self.files.insert(Rc::clone(path), contents.clone());
                contents
            }
        };
        match contents {
            Some(contents) if is_text => Value::String(contents),
            Some(contents) => Value::Contents(contents),
            None => Value::Unknown,
        }
    }

    fn has_own_property(&self, object: Option<&Value>, key: Option<&Value>) -> Value {
        let (Some(Value::Object(id)), Some(Value::String(key))) = (object, key) else {
            return Value::Unknown;
        };
        match self.objects[id.0].keys() {
            Some(keys) => Value::Boolean(keys.iter().any(|it| it == key)),
            None => Value::Unknown,
        }
    }

    fn create_array_of(&mut self, args: Vec<Value>) -> Value {
        match args[..] {
            [Value::Number(length)] if (0.0..1024.0).contains(&length) && length.fract() == 0.0 => {
                self.create_array(vec![Value::Undefined; length as usize])
            }
            [Value::Number(_) | Value::Unknown] => Value::Unknown,
            _ => self.create_array(args),
        }
    }

    fn create_pattern(&self, args: &[Value]) -> Value {
        let Some(source) = args.first().and_then(Value::as_string) else {
            return Value::Unknown;
        };
        let flags = match args.get(1) {
            None | Some(Value::Undefined) => &b""[..],
            Some(Value::String(flags)) => flags,
            Some(_) => return Value::Unknown,
        };
        pattern_of(source, flags)
    }

    fn hoist(&mut self, list: IdList<StmtId>) {
        let hir = self.hir;
        for statement in hir.ids(list) {
            self.hoist_vars(statement, 0);
        }
        self.hoist_functions(list);
    }

    fn hoist_functions(&mut self, list: IdList<StmtId>) {
        let hir = self.hir;
        for statement in hir.ids(list) {
            if let StmtKind::Fn(function) = hir[statement].kind
                && !matches!(hir[function].body, FnBody::None)
            {
                let current = self.current;
                self.closures.insert(function, current);
                self.ends.insert(function, hir[statement].loc.end);
                self.declare(
                    current,
                    hir[function].name,
                    Value::Function(function, current),
                );
            }
        }
    }

    fn hoist_vars(&mut self, statement: StmtId, depth: u32) {
        let hir = self.hir;
        if statement.is_none() || depth > MAX_DEPTH || !self.pays(1) {
            return;
        }
        match hir[statement].kind {
            StmtKind::Var(declarations) => {
                for declaration in declarations.iter() {
                    let declaration = hir[declaration];
                    if declaration.kind == VarKind::Var
                        && let PatKind::Ident(name) = hir[declaration.pat].kind
                    {
                        let current = self.current;
                        let variables = &self.environments[current.0].variables;
                        if !variables.contains_key(&name) {
                            self.declare(current, name, Value::Undefined);
                        }
                    }
                }
            }
            StmtKind::If { yes, no, .. } => {
                self.hoist_vars(yes, depth + 1);
                self.hoist_vars(no, depth + 1);
            }
            StmtKind::For { init, body, .. } => {
                self.hoist_vars(init, depth + 1);
                self.hoist_vars(body, depth + 1);
            }
            StmtKind::ForIn { left, body, .. } | StmtKind::ForOf { left, body, .. } => {
                self.hoist_vars(left, depth + 1);
                self.hoist_vars(body, depth + 1);
            }
            StmtKind::While { body, .. }
            | StmtKind::DoWhile { body, .. }
            | StmtKind::Labeled { body, .. }
            | StmtKind::With { body, .. } => self.hoist_vars(body, depth + 1),
            StmtKind::Block(list) => {
                for statement in hir.ids(list) {
                    self.hoist_vars(statement, depth + 1);
                }
            }
            StmtKind::Switch { cases, .. } => {
                for case in cases.iter() {
                    for statement in hir.ids(hir[case].body) {
                        self.hoist_vars(statement, depth + 1);
                    }
                }
            }
            StmtKind::Try {
                block,
                handler,
                finalizer,
                ..
            } => {
                self.hoist_vars(block, depth + 1);
                self.hoist_vars(handler, depth + 1);
                self.hoist_vars(finalizer, depth + 1);
            }
            _ => {}
        }
    }

    fn bind(&mut self, pat: PatId, value: Value, kind: Option<VarKind>) {
        let hir = self.hir;
        match hir[pat].kind {
            PatKind::Missing => {}
            PatKind::Ident(name) => {
                let environment = match kind {
                    Some(VarKind::Var) => self.function_environment(),
                    _ => self.current,
                };
                self.declare(environment, name, value);
            }
            PatKind::Object(props) => {
                for prop in props.iter() {
                    let prop = hir[prop];
                    let own = match prop.key {
                        PropKey::Name(name) if !prop.is_rest => {
                            self.property(&value, self.atoms.bytes(name))
                        }
                        _ => Value::Unknown,
                    };
                    let own = match own == Value::Undefined && prop.default.is_some() {
                        true => self.expression(prop.default),
                        false => own,
                    };
                    self.bind(prop.value, own, kind);
                }
            }
            PatKind::Array(elems) => {
                let elements = self.elements_of(&value);
                for (index, elem) in elems.iter().enumerate() {
                    let elem = hir[elem];
                    if elem.pat.is_none() {
                        continue;
                    }
                    let own = match &elements {
                        Some(elements) if elem.is_rest => {
                            let rest = elements.get(index..).unwrap_or_default().to_vec();
                            self.create_array(rest)
                        }
                        Some(elements) => elements.get(index).cloned().unwrap_or(Value::Undefined),
                        None => Value::Unknown,
                    };
                    let own = match own == Value::Undefined && elem.default.is_some() {
                        true => self.expression(elem.default),
                        false => own,
                    };
                    self.bind(elem.pat, own, kind);
                }
            }
        }
    }

    fn statements(&mut self, list: IdList<StmtId>) -> Completion {
        let hir = self.hir;
        for statement in hir.ids(list) {
            let completion = self.statement(statement);
            if completion != Completion::Normal {
                return completion;
            }
        }
        Completion::Normal
    }

    fn block(&mut self, list: IdList<StmtId>) -> Completion {
        let hir = self.hir;
        let has_own_names = hir.ids(list).any(|statement| {
            matches!(
                hir[statement].kind,
                StmtKind::Var(_) | StmtKind::Fn(_) | StmtKind::Class(_)
            )
        });
        if !has_own_names {
            return self.statements(list);
        }
        let outer = self.enter_block();
        self.hoist_functions(list);
        let completion = self.statements(list);
        self.current = outer;
        completion
    }

    fn statement(&mut self, statement: StmtId) -> Completion {
        if statement.is_none() {
            return Completion::Normal;
        }
        if self.depth >= MAX_DEPTH || !self.pays(1) {
            return Completion::Throw;
        }
        self.depth += 1;
        let completion = self.statement_of_kind(statement);
        self.depth -= 1;
        completion
    }

    fn statement_of_kind(&mut self, statement: StmtId) -> Completion {
        let hir = self.hir;
        match hir[statement].kind {
            StmtKind::Expr(expression) | StmtKind::ExportDefault(expression) => {
                self.expression(expression);
                Completion::Normal
            }
            StmtKind::Var(declarations) => {
                for declaration in declarations.iter() {
                    let declaration = hir[declaration];
                    if declaration.init.is_none() {
                        if declaration.kind != VarKind::Var {
                            self.bind(declaration.pat, Value::Undefined, Some(declaration.kind));
                        }
                        continue;
                    }
                    let value = self.expression(declaration.init);
                    self.bind(declaration.pat, value, Some(declaration.kind));
                }
                Completion::Normal
            }
            StmtKind::Class(class) => {
                let (name, current) = (hir[class].name, self.current);
                let value = self.class(class);
                self.declare(current, name, value);
                Completion::Normal
            }
            StmtKind::Return(expression) => {
                let value = match expression.is_some() {
                    true => self.expression(expression),
                    false => Value::Undefined,
                };
                self.returned = match self.returned.take() {
                    Some(earlier) if earlier != value => Some(Value::Unknown),
                    _ => Some(value),
                };
                Completion::Return
            }
            StmtKind::Throw(expression) => {
                self.expression(expression);
                Completion::Throw
            }
            StmtKind::Break(label) => Completion::Break(label),
            StmtKind::Continue(label) => Completion::Continue(label),
            StmtKind::Block(list) => self.block(list),
            StmtKind::If { test, yes, no } => match self.expression(test).to_boolean() {
                Some(true) => self.statement(yes),
                Some(false) => self.statement(no),
                None => {
                    let no = match no.is_some() {
                        true => Alternative::Statement(no),
                        false => Alternative::Nothing,
                    };
                    self.run_alternatives(&[Alternative::Statement(yes), no]).0
                }
            },
            StmtKind::Labeled { label, body } => match self.statement(body) {
                Completion::Break(left) if left == label => Completion::Normal,
                completion => completion,
            },
            StmtKind::For {
                init,
                test,
                update,
                body,
            } => {
                let outer = self.enter_block();
                self.statement(init);
                let completion = self.repeat(test, body, update, true);
                self.current = outer;
                completion
            }
            StmtKind::While { test, body } => self.repeat(test, body, ExprId::NONE, true),
            StmtKind::DoWhile { body, test } => self.repeat(test, body, ExprId::NONE, false),
            StmtKind::ForOf {
                left, expr, body, ..
            } => {
                let iterated = self.expression(expr);
                let values = self.elements_of(&iterated);
                self.for_each(left, values, body)
            }
            StmtKind::ForIn { left, expr, body } => {
                let keys = match self.expression(expr) {
                    Value::Object(id) => self.objects[id.0].keys(),
                    Value::Undefined | Value::Null => Some(Vec::new()),
                    _ => None,
                };
                let values = keys.map(|it| it.into_iter().map(Value::String).collect());
                self.for_each(left, values, body)
            }
            StmtKind::Switch { expr, cases } => {
                let value = self.expression(expr);
                let mut first = None;
                for (index, case) in cases.iter().enumerate() {
                    let test = hir[case].test;
                    if test.is_none() {
                        continue;
                    }
                    let candidate = self.expression(test);
                    match candidate.is_identical(&value) {
                        Some(true) => {
                            first = Some(index);
                            break;
                        }
                        Some(false) => {}
                        None => {
                            for case in cases.iter() {
                                let body = Alternative::Statements(hir[case].body);
                                self.run_alternatives(&[body, Alternative::Nothing]);
                            }
                            return Completion::Normal;
                        }
                    }
                }
                let first =
                    first.or_else(|| cases.iter().position(|case| hir[case].test.is_none()));
                for case in cases.iter().skip(first.unwrap_or(usize::MAX)) {
                    match self.statements(hir[case].body) {
                        Completion::Normal => {}
                        Completion::Break(Atom::NONE) => return Completion::Normal,
                        completion => return completion,
                    }
                }
                Completion::Normal
            }
            StmtKind::Try {
                block,
                handler,
                finalizer,
                ..
            } => {
                let completion = match self.statement(block) {
                    Completion::Throw if handler.is_some() => Completion::Normal,
                    completion => completion,
                };
                if handler.is_some() {
                    let handler = Alternative::Statement(handler);
                    self.run_alternatives(&[Alternative::Nothing, handler]);
                }
                match self.statement(finalizer) {
                    Completion::Normal => completion,
                    completion => completion,
                }
            }
            _ => Completion::Normal,
        }
    }

    fn repeat(
        &mut self,
        test: ExprId,
        body: StmtId,
        update: ExprId,
        tests_first: bool,
    ) -> Completion {
        self.repetitions += 1;
        let mut is_tested = tests_first;
        let completion = loop {
            if !self.pays(1) {
                break Completion::Throw;
            }
            if std::mem::replace(&mut is_tested, true) && test.is_some() {
                match self.expression(test).to_boolean() {
                    Some(true) => {}
                    Some(false) => break Completion::Normal,
                    None => {
                        let iteration = Alternative::Iteration(body, update);
                        self.run_alternatives(&[Alternative::Nothing, iteration]);
                        break Completion::Normal;
                    }
                }
            }
            match self.statement(body) {
                Completion::Normal | Completion::Continue(Atom::NONE) => {}
                Completion::Break(Atom::NONE) => break Completion::Normal,
                completion => break completion,
            }
            if update.is_some() {
                self.expression(update);
            }
        };
        self.repetitions -= 1;
        completion
    }

    fn for_each(&mut self, left: StmtId, values: Option<Vec<Value>>, body: StmtId) -> Completion {
        let Some(values) = values else {
            let outer = self.enter_block();
            self.bind_left(left, Value::Unknown);
            let iteration = Alternative::Statement(body);
            self.run_alternatives(&[Alternative::Nothing, iteration]);
            self.current = outer;
            return Completion::Normal;
        };
        self.repetitions += 1;
        let mut result = Completion::Normal;
        for value in values {
            let outer = self.enter_block();
            self.bind_left(left, value);
            let completion = self.statement(body);
            self.current = outer;
            match completion {
                Completion::Normal | Completion::Continue(Atom::NONE) => {}
                Completion::Break(Atom::NONE) => break,
                completion => {
                    result = completion;
                    break;
                }
            }
        }
        self.repetitions -= 1;
        result
    }

    fn bind_left(&mut self, left: StmtId, value: Value) {
        let hir = self.hir;
        match hir[left].kind {
            StmtKind::Var(declarations) => {
                for declaration in declarations.iter() {
                    let declaration = hir[declaration];
                    self.bind(declaration.pat, value.clone(), Some(declaration.kind));
                }
            }
            StmtKind::Expr(target) => self.store(target, value),
            _ => {}
        }
    }

    fn expression(&mut self, expression: ExprId) -> Value {
        if expression.is_none() || self.depth >= MAX_DEPTH || !self.pays(1) {
            return Value::Unknown;
        }
        self.depth += 1;
        let value = self.expression_of_kind(self.hir.skip_type_assertions(expression));
        self.depth -= 1;
        value
    }

    fn expression_of_kind(&mut self, expression: ExprId) -> Value {
        let hir = self.hir;
        match hir[expression].kind {
            ExprKind::Ident(name) => self.read(name),
            ExprKind::This => self.receiver.clone(),
            ExprKind::Class(class) => self.class(class),
            ExprKind::Null => Value::Null,
            ExprKind::True => Value::Boolean(true),
            ExprKind::False => Value::Boolean(false),
            ExprKind::Number(number) => Value::Number(hir.numbers[number as usize]),
            ExprKind::String(text) => {
                let text = self.atoms.bytes(text);
                match self.pays(text.len() / 16) {
                    true => Value::string(text),
                    false => Value::Unknown,
                }
            }
            ExprKind::Regex { pattern, flags } => {
                pattern_of(self.atoms.bytes(pattern), self.atoms.bytes(flags))
            }
            ExprKind::Template { exprs } => {
                let mut texts = hir.ids(hir.template_texts(exprs));
                let mut joined = Vec::new();
                let mut is_known = true;
                let mut path = None;
                joined.extend(texts.next().map_or(&[][..], |it| self.atoms.bytes(it)));
                for substitution in hir.ids(exprs) {
                    match self.expression(substitution) {
                        Value::Path(start) if joined.is_empty() && path.is_none() => {
                            path = Some(start);
                        }
                        value if !is_known || !value.is_known() => is_known = false,
                        value => match self.text_of(&value) {
                            Some(text) => joined.extend_from_slice(&text),
                            None => is_known = false,
                        },
                    }
                    joined.extend(texts.next().map_or(&[][..], |it| self.atoms.bytes(it)));
                }
                match path {
                    _ if !is_known => Value::Unknown,
                    Some(path) => append_to_path(&path, &joined),
                    None => self.string(joined),
                }
            }
            ExprKind::ImportMeta => Value::Global(Global::ImportMeta),
            ExprKind::Array(list) => {
                let mut array = Object::array(Vec::new());
                for element in hir.ids(list) {
                    match hir[element].kind {
                        ExprKind::Spread(operand) => {
                            let value = self.expression(operand);
                            match self.elements_of(&value) {
                                Some(elements) => array.elements.extend(elements),
                                None => array.is_open = true,
                            }
                        }
                        ExprKind::Missing => array.elements.push(Value::Undefined),
                        _ => {
                            let value = self.expression(element);
                            array.elements.push(value);
                        }
                    }
                }
                self.create(array)
            }
            ExprKind::Object(props) => {
                let mut object = Object::default();
                for prop in props.iter() {
                    let prop = hir[prop];
                    match prop.kind {
                        PropKind::Spread => {
                            let value = self.expression(prop.value);
                            let keys = match &value {
                                Value::Object(id) => self.objects[id.0].keys(),
                                _ => None,
                            };
                            match keys {
                                Some(keys) => {
                                    for key in keys {
                                        let value = self.property(&value, &key);
                                        object.set(&key, value);
                                    }
                                }
                                None => object.is_open = true,
                            }
                            continue;
                        }
                        PropKind::Getter | PropKind::Setter => {
                            self.expression(prop.value);
                            object.is_open = true;
                            continue;
                        }
                        PropKind::Init | PropKind::Shorthand | PropKind::Method => {}
                    }
                    let key = match prop.key {
                        PropKey::Name(name) => Some(Rc::from(self.atoms.bytes(name))),
                        PropKey::Computed(key) => {
                            let key = self.expression(key);
                            self.text_of(&key)
                        }
                        PropKey::None | PropKey::Private(_) => None,
                    };
                    let value = self.expression(prop.value);
                    match key {
                        Some(key) => object.set(&key, value),
                        None => object.is_open = true,
                    }
                }
                self.create(object)
            }
            ExprKind::Fn(function) => {
                let current = self.current;
                self.closures.insert(function, current);
                self.ends.insert(function, hir[expression].end);
                Value::Function(function, current)
            }
            ExprKind::Dot { obj, name, .. } => {
                let object = self.expression(obj);
                self.property(&object, self.atoms.bytes(name))
            }
            ExprKind::Index { obj, index, .. } => {
                let object = self.expression(obj);
                let index = self.expression(index);
                match self.text_of(&index) {
                    Some(key) => self.property(&object, &key),
                    None => Value::Unknown,
                }
            }
            ExprKind::Call(call) => self.call(call, hir[call]),
            ExprKind::New(call) if self.calls_of_function.contains(&call) => {
                self.evaluate_function(call)
            }
            ExprKind::New(call) => {
                let callee = self.expression(hir[call].callee);
                let args = self.arguments(hir[call]);
                match (callee, args) {
                    (Value::Global(Global::RegExp), Some(args)) => self.create_pattern(&args),
                    (Value::Global(Global::Array), Some(args)) => self.create_array_of(args),
                    (Value::Global(Global::Url), Some(args)) => match &args[..] {
                        [Value::String(relative), Value::Path(path)] if is_relative(relative) => {
                            self.join_path(&dirname::<Posix>(path).into(), relative)
                        }
                        _ => Value::Unknown,
                    },
                    (Value::Evaluated, Some(_)) => self.create(Object::unseen()),
                    (Value::Function(function, around), Some(args))
                        if self.has_evaluating_methods(function) =>
                    {
                        self.construct(function, around, &args)
                    }
                    _ => Value::Unknown,
                }
            }
            ExprKind::Unary { op, operand } => self.unary(op, operand),
            ExprKind::Binary { op: BinOp::Add, .. } => self.addition(expression),
            ExprKind::Binary { op, left, right } => self.binary(op, left, right),
            ExprKind::Assign { op, target, value } => self.assignment(op, target, value),
            ExprKind::Cond { test, branches } => {
                let branches = hir.branches(branches);
                match self.expression(test).to_boolean() {
                    Some(true) => self.expression(branches.yes),
                    Some(false) => self.expression(branches.no),
                    None => {
                        let yes = Alternative::Expression(branches.yes);
                        let no = Alternative::Expression(branches.no);
                        self.run_alternatives(&[yes, no]).1
                    }
                }
            }
            ExprKind::Await(operand) | ExprKind::Spread(operand) => {
                self.expression(operand);
                Value::Unknown
            }
            _ => Value::Unknown,
        }
    }

    fn text_of(&mut self, value: &Value) -> Option<Rc<[u8]>> {
        match value {
            Value::Object(_) => self.join(value, b","),
            Value::Function(function, _) => self.source_of(*function),
            _ => value.to_text(),
        }
    }

    fn source_of(&mut self, function: FnId) -> Option<Rc<[u8]>> {
        let hir = self.hir;
        let end = *self.ends.get(&function)?;
        let source = match hir.is_js {
            true => hir
                .text
                .get(hir[function].text_start as usize..end as usize)?,
            false => return None,
        };
        match self.string(source.to_vec()) {
            Value::String(source) => Some(source),
            _ => None,
        }
    }

    fn join(&mut self, array: &Value, separator: &[u8]) -> Option<Rc<[u8]>> {
        let Value::Object(_) = array else {
            return None;
        };
        let elements = self.elements_of(array)?;
        let mut joined = Vec::new();
        for (index, element) in elements.iter().enumerate() {
            if index > 0 {
                joined.extend_from_slice(separator);
            }
            match element {
                Value::Undefined | Value::Null => {}
                element => joined.extend_from_slice(&element.to_text()?),
            }
        }
        match self.string(joined) {
            Value::String(text) => Some(text),
            _ => None,
        }
    }

    fn property(&self, object: &Value, key: &[u8]) -> Value {
        match object {
            Value::Object(id) => {
                let object = &self.objects[id.0];
                match (object.get(key), object.constructor, object.parent) {
                    (Value::Undefined, Some(constructor), _) => {
                        self.property_of_prototype(constructor, key)
                    }
                    (Value::Undefined, None, Some(parent)) if parent.0 < id.0 => {
                        self.property(&Value::Object(parent), key)
                    }
                    (value, ..) => value,
                }
            }
            Value::Global(Global::ImportMeta) => match key {
                b"url" | b"filename" | b"path" => Value::Path(self.beside.path.into()),
                b"dirname" | b"dir" => Value::Path(dirname::<Posix>(self.beside.path).into()),
                _ => Value::Unknown,
            },
            Value::Global(global) => {
                let added = self.properties_of_globals.get(&(*global, key.into()));
                let own = || global.property(key).map(Value::Global);
                added.cloned().or_else(own).unwrap_or(Value::Unknown)
            }
            Value::Path(path) if key == b"pathname" => Value::Path(Rc::clone(path)),
            Value::Function(function, _) if key == b"prototype" => Value::Prototype(*function),
            Value::Prototype(constructor) => self.property_of_prototype(*constructor, key),
            Value::String(text) if text.is_ascii() => {
                if key == b"length" {
                    return Value::Number(text.len() as f64);
                }
                match Object::index_of_key(key) {
                    Some(index) => match text.get(index) {
                        Some(byte) => Value::string(std::slice::from_ref(byte)),
                        None => Value::Undefined,
                    },
                    None => Value::Unknown,
                }
            }
            Value::Function(function, _) if key == b"length" => {
                let hir = self.hir;
                let params = hir[*function].params.iter();
                let counted = params.take_while(|&param| {
                    hir[param].default.is_none() && !hir[param].flags.contains(Flags::REST)
                });
                Value::Number(counted.count() as f64)
            }
            _ => Value::Unknown,
        }
    }

    fn property_of_prototype(&self, constructor: FnId, key: &[u8]) -> Value {
        let properties = self.prototypes.get(&constructor);
        let value = properties.and_then(|it| it.get(key));
        value.cloned().unwrap_or(Value::Unknown)
    }

    fn unary(&mut self, op: UnOp, operand: ExprId) -> Value {
        if let UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec = op {
            let before = self.expression(operand);
            let Some(number) = before.as_number() else {
                self.store(operand, Value::Unknown);
                return Value::Unknown;
            };
            let step = match op {
                UnOp::PreInc | UnOp::PostInc => 1.0,
                _ => -1.0,
            };
            let after = Value::Number(number + step);
            self.store(operand, after.clone());
            return match op {
                UnOp::PreInc | UnOp::PreDec => after,
                _ => before,
            };
        }
        let value = self.expression(operand);
        match op {
            UnOp::Not => (value.to_boolean()).map_or(Value::Unknown, |it| Value::Boolean(!it)),
            UnOp::Minus => value
                .as_number()
                .map_or(Value::Unknown, |it| Value::Number(-it)),
            UnOp::Plus => value.as_number().map_or(Value::Unknown, Value::Number),
            UnOp::Void => Value::Undefined,
            UnOp::Typeof => match value {
                Value::Unknown => Value::Unknown,
                Value::Undefined => Value::string(b"undefined"),
                Value::Boolean(_) => Value::string(b"boolean"),
                Value::Number(_) => Value::string(b"number"),
                Value::String(_) => Value::string(b"string"),
                Value::Global(global) if !global.is_function() => Value::string(b"object"),
                Value::Function(..) | Value::Evaluated | Value::Global(_) => {
                    Value::string(b"function")
                }
                Value::Path(_) => Value::Unknown,
                Value::Null
                | Value::Object(_)
                | Value::Pattern(_)
                | Value::Matcher(_)
                | Value::Contents(_)
                | Value::Prototype(_) => Value::string(b"object"),
            },
            _ => Value::Unknown,
        }
    }

    fn addition(&mut self, expression: ExprId) -> Value {
        let hir = self.hir;
        let mut operands = Vec::new();
        let mut at = expression;
        while let ExprKind::Binary {
            op: BinOp::Add,
            left,
            right,
        } = hir[at].kind
        {
            operands.push(right);
            at = hir.skip_type_assertions(left);
        }
        let mut sum = self.expression(at);
        let mut text: Option<Vec<u8>> = None;
        for &operand in operands.iter().rev() {
            let value = self.expression(operand);
            if let Some(joined) = &mut text {
                match self.text_of(&value) {
                    Some(added) => joined.extend_from_slice(&added),
                    None => {
                        text = None;
                        sum = Value::Unknown;
                    }
                }
                continue;
            }
            sum = match (&sum, &value) {
                (Value::Unknown, _) | (_, Value::Unknown) => Value::Unknown,
                (Value::Number(left), Value::Number(right)) => Value::Number(left + right),
                (Value::Path(path), Value::String(added)) => append_to_path(path, added),
                (
                    Value::String(_) | Value::Contents(_) | Value::Object(_) | Value::Function(..),
                    _,
                )
                | (
                    _,
                    Value::String(_) | Value::Contents(_) | Value::Object(_) | Value::Function(..),
                ) => {
                    let (left, right) = (self.text_of(&sum), self.text_of(&value));
                    if let (Some(left), Some(right)) = (left, right) {
                        text = Some([&left[..], &right[..]].concat());
                    }
                    Value::Unknown
                }
                _ => Value::Unknown,
            };
        }
        match text {
            Some(text) => self.string(text),
            None => sum,
        }
    }

    fn binary(&mut self, op: BinOp, left: ExprId, right: ExprId) -> Value {
        match op {
            BinOp::Comma => {
                self.expression(left);
                return self.expression(right);
            }
            BinOp::And | BinOp::Or | BinOp::Nullish => {
                let value = self.expression(left);
                let goes_on = match op {
                    BinOp::And => value.to_boolean(),
                    BinOp::Or => value.to_boolean().map(|it| !it),
                    _ if value.is_known() => Some(matches!(value, Value::Undefined | Value::Null)),
                    _ => None,
                };
                return match goes_on {
                    Some(true) => self.expression(right),
                    Some(false) => value,
                    None => {
                        let right = Alternative::Expression(right);
                        self.run_alternatives(&[Alternative::Nothing, right]);
                        Value::Unknown
                    }
                };
            }
            _ => {}
        }
        let left = self.expression(left);
        let right = self.expression(right);
        let identity = |is_equal: bool| {
            let answer = left.is_identical(&right);
            answer.map_or(Value::Unknown, |it| Value::Boolean(it == is_equal))
        };
        if let (Some(left), Some(right)) = (left.as_number(), right.as_number()) {
            return match op {
                BinOp::Sub => Value::Number(left - right),
                BinOp::Mul => Value::Number(left * right),
                BinOp::Div => Value::Number(left / right),
                BinOp::Rem => Value::Number(left % right),
                BinOp::BitOr => Value::Number(f64::from(to_int32(left) | to_int32(right))),
                BinOp::BitAnd => Value::Number(f64::from(to_int32(left) & to_int32(right))),
                BinOp::BitXor => Value::Number(f64::from(to_int32(left) ^ to_int32(right))),
                BinOp::Lt => Value::Boolean(left < right),
                BinOp::Le => Value::Boolean(left <= right),
                BinOp::Gt => Value::Boolean(left > right),
                BinOp::Ge => Value::Boolean(left >= right),
                BinOp::EqEq | BinOp::EqEqEq => Value::Boolean(left == right),
                BinOp::NotEq | BinOp::NotEqEq => Value::Boolean(left != right),
                _ => Value::Unknown,
            };
        }
        match op {
            BinOp::EqEqEq => identity(true),
            BinOp::NotEqEq => identity(false),
            BinOp::EqEq | BinOp::NotEq
                if left.is_known()
                    && right.is_known()
                    && (is_nullish(&left) || is_nullish(&right)) =>
            {
                let are_equal = is_nullish(&left) && is_nullish(&right);
                Value::Boolean(are_equal == (op == BinOp::EqEq))
            }
            BinOp::EqEq if std::mem::discriminant(&left) == std::mem::discriminant(&right) => {
                identity(true)
            }
            BinOp::NotEq if std::mem::discriminant(&left) == std::mem::discriminant(&right) => {
                identity(false)
            }
            _ => Value::Unknown,
        }
    }

    fn assignment(&mut self, op: Option<BinOp>, target: ExprId, value: ExprId) -> Value {
        let value = match op {
            None => self.expression(value),
            Some(BinOp::Add) => {
                let before = self.expression(target);
                let added = self.expression(value);
                match (&before, &added) {
                    (Value::Unknown, _) | (_, Value::Unknown) => Value::Unknown,
                    (Value::Number(left), Value::Number(right)) => Value::Number(left + right),
                    (Value::String(_), _) | (_, Value::String(_)) => {
                        match (self.text_of(&before), self.text_of(&added)) {
                            (Some(left), Some(right)) => {
                                self.string([&left[..], &right[..]].concat())
                            }
                            _ => Value::Unknown,
                        }
                    }
                    _ => Value::Unknown,
                }
            }
            Some(op @ (BinOp::And | BinOp::Or | BinOp::Nullish)) => self.binary(op, target, value),
            Some(op) => self.binary(op, target, value),
        };
        self.store(target, value.clone());
        value
    }

    fn store(&mut self, target: ExprId, value: Value) {
        let hir = self.hir;
        match hir[hir.skip_type_assertions(target)].kind {
            ExprKind::Ident(name) => self.assign(name, value),
            ExprKind::Dot { obj, name, .. } => {
                let key = self.atoms.bytes(name);
                match self.expression(obj) {
                    Value::Object(id) => {
                        self.change_object(id, |object| object.set(key, value));
                    }
                    Value::Prototype(constructor) => {
                        self.set_on_prototype(constructor, key, value);
                    }
                    Value::Global(global) if global.takes_properties() => {
                        self.properties_of_globals
                            .insert((global, key.into()), value);
                    }
                    Value::Function(constructor, _) if key == b"prototype" => {
                        if let Value::Object(id) = value {
                            let properties = self.objects[id.0].properties.clone();
                            for (key, value) in properties {
                                self.set_on_prototype(constructor, &key, value);
                            }
                        }
                    }
                    _ => {}
                }
            }
            ExprKind::Index { obj, index, .. } => {
                let object = self.expression(obj);
                let index = self.expression(index);
                let key = self.text_of(&index);
                if let Value::Object(id) = object {
                    self.change_object(id, |object| match key {
                        Some(key) => object.set(&key, value),
                        None => object.is_open = true,
                    });
                }
            }
            _ => {}
        }
    }

    fn arguments(&mut self, site: Call) -> Option<Vec<Value>> {
        let hir = self.hir;
        let mut args = Vec::new();
        let mut is_known = true;
        for arg in hir.ids(site.args) {
            match hir[arg].kind {
                ExprKind::Spread(operand) => {
                    let value = self.expression(operand);
                    match self.elements_of(&value) {
                        Some(elements) => args.extend(elements),
                        None => is_known = false,
                    }
                }
                _ => {
                    let value = self.expression(arg);
                    args.push(value);
                }
            }
        }
        is_known.then_some(args)
    }

    fn call(&mut self, call: CallId, site: Call) -> Value {
        let hir = self.hir;
        if self.evals.contains(&call) {
            let args = self.arguments(self.written_site(call));
            let Some(Value::String(text)) = args.iter().flatten().next() else {
                return Value::Unknown;
            };
            let text = [Rc::clone(text)];
            let current = self.current;
            return match self.known_function(call, &text, current) {
                Some(function) => function,
                None => {
                    self.note_texts(call, text.to_vec());
                    Value::Unknown
                }
            };
        }
        if self.calls_of_function.contains(&call) {
            return self.evaluate_function(call);
        }
        if self.indirect_evals.contains(&call) {
            let args = self.arguments(self.written_site(call));
            if let Some(Value::String(text)) = args.iter().flatten().next() {
                let text = Rc::clone(text);
                self.note_texts(call, vec![text]);
            }
            return Value::Unknown;
        }
        let callee = hir.skip_type_assertions(site.callee);
        let method = match hir[callee].kind {
            ExprKind::Dot { obj, name, .. } => {
                let name: Rc<[u8]> = self.atoms.bytes(name).into();
                Some((self.expression(obj), Some(name)))
            }
            ExprKind::Index { obj, index, .. } => {
                let object = self.expression(obj);
                let index = self.expression(index);
                let name = self.text_of(&index);
                Some((object, name))
            }
            _ => None,
        };
        if let Some((receiver, name)) = method {
            let args = self.arguments(site);
            return match (name, args) {
                (Some(name), Some(args)) if site.chain == Chain::No => {
                    self.call_method(&receiver, &name, &args)
                }
                _ => Value::Unknown,
            };
        }
        let callee = self.expression(callee);
        match self.arguments(site) {
            Some(args) if site.chain == Chain::No => {
                self.call_value(&callee, &args, Value::Unknown)
            }
            _ => Value::Unknown,
        }
    }

    fn note_texts(&mut self, call: CallId, arguments: Vec<Rc<[u8]>>) {
        let length = arguments.iter().map(|it| it.len()).sum::<usize>();
        if call.0 >= self.first_call.0
            && self.noted.insert((call, arguments.clone()))
            && self.pays_for_text(length * 16)
            && let Some(left) = self.text_allowance.checked_sub(length)
        {
            self.text_allowance = left;
            self.texts.push((call, arguments));
        }
    }

    fn written_site(&self, call: CallId) -> Call {
        let args = self.hir.written_args(call);
        Call {
            args,
            ..self.hir[call]
        }
    }

    fn evaluate_function(&mut self, call: CallId) -> Value {
        let site = self.written_site(call);
        let args = self.arguments(site);
        let texts = args.iter().flatten().map(|it| it.as_string().cloned());
        let Some(texts) = texts.collect::<Option<Vec<Rc<[u8]>>>>() else {
            return Value::Unknown;
        };
        if texts.len() != site.args.len() {
            return Value::Unknown;
        }
        if let Some(function) = self.known_function(call, &texts, GLOBAL_ENVIRONMENT) {
            return function;
        }
        self.note_texts(call, texts);
        Value::Evaluated
    }

    fn known_function(
        &mut self,
        call: CallId,
        texts: &[Rc<[u8]>],
        around: EnvironmentId,
    ) -> Option<Value> {
        let hir = self.hir;
        let mut known = hir.known_evaluations_of(call).iter();
        let evaluation = known.find(|it| {
            let arguments = hir.ids(it.arguments);
            it.arguments.len as usize == texts.len()
                && (arguments.zip(texts)).all(|(atom, text)| *self.atoms.bytes(atom) == **text)
        })?;
        let root = hir.skip_type_assertions(evaluation.function);
        if let ExprKind::Assign { .. } = hir[root].kind {
            let current = std::mem::replace(&mut self.current, around);
            let assigned = self.expression(root);
            self.current = current;
            return Some(assigned);
        }
        let ExprKind::Fn(function) = hir[root].kind else {
            return None;
        };
        if evaluation.is_called()
            && let FnBody::Expr(body) = hir[function].body
        {
            let current = std::mem::replace(&mut self.current, around);
            let returned = self.expression(body);
            self.current = current;
            return Some(returned);
        }
        self.closures.insert(function, around);
        self.ends.insert(function, hir[root].end);
        Some(Value::Function(function, around))
    }

    fn call_method(&mut self, receiver: &Value, name: &[u8], args: &[Value]) -> Value {
        match receiver {
            Value::String(text) => self.call_string_method(text, name, args),
            Value::Object(id) if self.objects[id.0].is_array => {
                self.call_array_method(*id, name, args)
            }
            Value::Matcher(matcher) if name == b"test" => match args {
                [Value::String(text)] => {
                    let is_match = strings::is_match(text, matcher);
                    is_match.map_or(Value::Unknown, Value::Boolean)
                }
                _ => Value::Unknown,
            },
            Value::Contents(text) if name == b"toString" => match args {
                [] => Value::String(Rc::clone(text)),
                [Value::String(encoding)] if matches!(&encoding[..], b"utf8" | b"utf-8") => {
                    Value::String(Rc::clone(text))
                }
                _ => Value::Unknown,
            },
            Value::Global(Global::HasOwnProperty) if name == b"call" => {
                self.has_own_property(args.first(), args.get(1))
            }
            Value::Object(_) if name == b"hasOwnProperty" => {
                self.has_own_property(Some(receiver), args.first())
            }
            Value::Object(_) => {
                let method = self.property(receiver, name);
                self.call_value(&method, args, receiver.clone())
            }
            Value::Function(function, around) if name == b"call" => {
                let receiver = args.first().cloned().unwrap_or(Value::Unknown);
                let args = args.get(1..).unwrap_or_default();
                self.call_function(*function, *around, args, receiver)
            }
            Value::Function(function, _) if name == b"toString" => {
                let source = self.source_of(*function);
                source.map_or(Value::Unknown, Value::String)
            }
            Value::Function(function, around) if name == b"apply" => {
                let receiver = args.first().cloned().unwrap_or(Value::Unknown);
                match args.get(1).and_then(|it| self.elements_of(it)) {
                    Some(args) => self.call_function(*function, *around, &args, receiver),
                    None => Value::Unknown,
                }
            }
            Value::Global(Global::Object) => self.call_static_of_object(name, args),
            Value::Global(Global::Array) if name == b"isArray" => match args.first() {
                Some(Value::Object(id)) => Value::Boolean(self.objects[id.0].is_array),
                Some(Value::Unknown) => Value::Unknown,
                _ => Value::Boolean(false),
            },
            Value::Global(_) => {
                let method = self.property(receiver, name);
                self.call_value(&method, args, receiver.clone())
            }
            Value::Unknown => {
                let method = self.method_of_global(name);
                self.call_value(&method, args, Value::Unknown)
            }
            _ => Value::Unknown,
        }
    }

    fn call_static_of_object(&mut self, name: &[u8], args: &[Value]) -> Value {
        if name == b"create" && args.len() == 1 {
            let parent = match &args[0] {
                Value::Object(id) => Some(*id),
                Value::Null => None,
                _ => return Value::Unknown,
            };
            return self.create(Object {
                parent,
                ..Object::default()
            });
        }
        let Some(Value::Object(id)) = args.first() else {
            return Value::Unknown;
        };
        let object = Value::Object(*id);
        if name == b"freeze" {
            return object;
        }
        let Some(keys) = self.objects[id.0].keys() else {
            return Value::Unknown;
        };
        let elements = match name {
            b"keys" => keys.into_iter().map(Value::String).collect(),
            b"values" => keys.iter().map(|key| self.property(&object, key)).collect(),
            b"entries" => {
                let mut entries = Vec::with_capacity(keys.len());
                for key in keys {
                    let value = self.property(&object, &key);
                    entries.push(self.create_array(vec![Value::String(key), value]));
                }
                entries
            }
            _ => return Value::Unknown,
        };
        self.create_array(elements)
    }

    fn call_string_method(&mut self, text: &Rc<[u8]>, name: &[u8], args: &[Value]) -> Value {
        match name {
            b"replace" | b"replaceAll" => self.replace(text, name == b"replaceAll", args),
            b"split" if args.len() == 1 => {
                let parts = match &args[0] {
                    Value::String(separator) => strings::split(text, separator),
                    Value::Pattern(pattern) => strings::split(text, &pattern.literal),
                    Value::Matcher(it) if **it == Matcher::Blanks => strings::split_at_blanks(text),
                    _ => None,
                };
                match parts {
                    Some(parts) if self.pays_for_text(text.len() + 16 * parts.len()) => {
                        self.create_array(parts)
                    }
                    _ => Value::Unknown,
                }
            }
            _ => match strings::call_method(text, name, args) {
                Some(Value::String(given)) => match self.pays_for_text(given.len()) {
                    true => Value::String(given),
                    false => Value::Unknown,
                },
                Some(value) => value,
                None => Value::Unknown,
            },
        }
    }

    fn replace(&mut self, text: &Rc<[u8]>, replaces_all: bool, args: &[Value]) -> Value {
        let (literal, is_global) = match args.first() {
            Some(Value::String(literal)) if !literal.is_empty() => {
                (Rc::clone(literal), replaces_all)
            }
            Some(Value::Pattern(pattern)) if pattern.is_global || !replaces_all => {
                (Rc::clone(&pattern.literal), pattern.is_global)
            }
            Some(Value::Matcher(matcher)) => {
                let Matcher::Characters(pattern) = &**matcher else {
                    return Value::Unknown;
                };
                let replacement = args.get(1).and_then(Value::as_string);
                let replaced = match replacement {
                    Some(replacement) if pattern.is_global || !replaces_all => {
                        strings::replace_characters(text, pattern, replacement)
                    }
                    _ => None,
                };
                return match replaced {
                    Some(replaced) => self.string(replaced),
                    None => Value::Unknown,
                };
            }
            _ => return Value::Unknown,
        };
        let matches = strings::find_matches(text, &literal, is_global);
        if !self.pays_for_text(text.len()) {
            return Value::Unknown;
        }
        let mut replaced = Vec::with_capacity(text.len());
        let mut from = 0;
        for at in matches {
            replaced.extend_from_slice(&text[from..at]);
            let replacement = match args.get(1) {
                Some(Value::Function(function, around)) if text.is_ascii() => {
                    let args = [
                        Value::String(Rc::clone(&literal)),
                        Value::Number(at as f64),
                        Value::String(Rc::clone(text)),
                    ];
                    let value = self.call_function(*function, *around, &args, Value::Unknown);
                    self.text_of(&value)
                }
                Some(Value::Function(..)) => None,
                Some(value) => {
                    let value = self.text_of(value);
                    let expanded = value.and_then(|it| strings::expand_replacement(&it, &literal));
                    expanded.map(Rc::from)
                }
                None => None,
            };
            let Some(replacement) = replacement else {
                return Value::Unknown;
            };
            replaced.extend_from_slice(&replacement);
            from = at + literal.len();
        }
        replaced.extend_from_slice(&text[from..]);
        self.string(replaced)
    }

    fn call_array_method(&mut self, id: ObjectId, name: &[u8], args: &[Value]) -> Value {
        let array = Value::Object(id);
        if name == b"push" {
            let added = args.to_vec();
            self.change_object(id, |object| object.elements.extend(added));
            return self.property(&array, b"length");
        }
        let Some(elements) = self.elements_of(&array) else {
            return Value::Unknown;
        };
        if !self.pays(elements.len() + 1) {
            return Value::Unknown;
        }
        match name {
            b"join" => {
                let separator = match args.first() {
                    None | Some(Value::Undefined) => Some(Rc::from(&b","[..])),
                    Some(value) => value.to_text(),
                };
                let joined = separator.and_then(|it| self.join(&array, &it));
                joined.map_or(Value::Unknown, Value::String)
            }
            b"toString" => self
                .join(&array, b",")
                .map_or(Value::Unknown, Value::String),
            b"concat" => {
                let mut all = elements;
                for arg in args {
                    match (arg, self.elements_of(arg)) {
                        (Value::Object(_), Some(more)) => all.extend(more),
                        (Value::Object(id), None) if !self.objects[id.0].is_array => {
                            all.push(arg.clone())
                        }
                        (Value::Unknown | Value::Object(_), _) => return Value::Unknown,
                        _ => all.push(arg.clone()),
                    }
                }
                self.create_array(all)
            }
            b"slice" if args.len() <= 1 => {
                let start = match args.first() {
                    None | Some(Value::Undefined) => 0.0,
                    Some(Value::Number(start)) if *start < 0.0 => elements.len() as f64 + start,
                    Some(Value::Number(start)) => *start,
                    Some(_) => return Value::Unknown,
                };
                let start = (start.max(0.0) as usize).min(elements.len());
                self.create_array(elements[start..].to_vec())
            }
            b"reverse" => {
                let reversed: Vec<Value> = elements.into_iter().rev().collect();
                self.change_object(id, |object| object.elements = reversed);
                array
            }
            b"includes" | b"indexOf" if args.len() == 1 => {
                let answers = elements.iter().map(|it| it.is_identical(&args[0]));
                let Some(answers) = answers.collect::<Option<Vec<bool>>>() else {
                    return Value::Unknown;
                };
                let found = answers.iter().position(|&it| it);
                match name {
                    b"includes" => Value::Boolean(found.is_some()),
                    _ => Value::Number(found.map_or(-1.0, |at| at as f64)),
                }
            }
            b"forEach" | b"map" | b"filter" | b"some" | b"every" => {
                let Some(Value::Function(function, around)) = args.first() else {
                    return Value::Unknown;
                };
                let mut results = Vec::with_capacity(elements.len());
                for (index, element) in elements.iter().enumerate() {
                    let args = [element.clone(), Value::Number(index as f64), array.clone()];
                    results.push(self.call_function(*function, *around, &args, Value::Unknown));
                }
                match name {
                    b"forEach" => Value::Undefined,
                    b"map" => self.create_array(results),
                    b"filter" => {
                        let kept = results.iter().map(Value::to_boolean);
                        let Some(kept) = kept.collect::<Option<Vec<bool>>>() else {
                            return Value::Unknown;
                        };
                        let kept = elements.into_iter().zip(kept).filter(|it| it.1);
                        let kept = kept.map(|it| it.0).collect();
                        self.create_array(kept)
                    }
                    _ => Value::Unknown,
                }
            }
            b"reduce" if args.len() == 2 => {
                let Value::Function(function, around) = args[0] else {
                    return Value::Unknown;
                };
                let mut sum = args[1].clone();
                for (index, element) in elements.iter().enumerate() {
                    let args = [
                        sum,
                        element.clone(),
                        Value::Number(index as f64),
                        array.clone(),
                    ];
                    sum = self.call_function(function, around, &args, Value::Unknown);
                }
                sum
            }
            _ => Value::Unknown,
        }
    }
}

fn is_nullish(value: &Value) -> bool {
    matches!(value, Value::Undefined | Value::Null)
}

fn is_relative(specifier: &[u8]) -> bool {
    specifier.starts_with(b"./") || specifier.starts_with(b"../")
}

fn append_to_path(folder: &[u8], added: &[u8]) -> Value {
    match added.strip_prefix(b"/") {
        Some(relative) => Value::Path(from_argument(folder, relative).into()),
        None => Value::Unknown,
    }
}

fn pattern_of(source: &[u8], flags: &[u8]) -> Value {
    if let Some(pattern) = strings::parse_pattern(source, flags) {
        return Value::Pattern(Rc::new(pattern));
    }
    let matcher = strings::parse_matcher(source, flags);
    matcher.map_or(Value::Unknown, |it| Value::Matcher(Rc::new(it)))
}

fn to_int32(number: f64) -> i32 {
    match number.is_finite() {
        true => number.trunc().rem_euclid(4_294_967_296.0) as u32 as i32,
        false => 0,
    }
}

fn merge(left: Contents, right: Contents) -> Contents {
    if left == right {
        return left;
    }
    match (left, right) {
        (Contents::Object(left), Contents::Object(right)) => Contents::Object(left.merge(&right)),
        _ => Contents::Variable(Some(Value::Unknown)),
    }
}
