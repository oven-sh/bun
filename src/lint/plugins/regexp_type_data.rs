#![allow(dead_code)] // until every rule of the plugin is written
//! The classes of eslint-plugin-regexp's type tracker (`lib/utils/type-tracker/type-data`), as lazy
//! as upstream: what `getType` answers depends on when it is asked, so nothing is asked earlier.

use crate::regexp_type_builtins::{Class, Proto, property};
use bun_core::strings;
use bun_lint::prelude::{BinOp, Expr, UnOp};
use bun_lint::utils::sort;
use rustc_hash::{FxHashMap, FxHashSet};
use std::borrow::Cow;
use std::cell::Cell;
use std::hash::{Hash, Hasher};
use std::rc::Rc;

const MAX_DEPTH: u32 = 200;
const MAX_STEPS: u32 = 100_000;
const MAX_NESTING: u32 = 100;

const NULL: &[u8] = b"null";
const UNDEFINED: &[u8] = b"undefined";

/// What a question may cost. Upstream's limit is the stack: `const a = [[], a]` has no end, and
/// `getType` catches the error. Each `.concat()` of a chain doubles the work, without a limit.
#[derive(Default)]
pub(crate) struct Budget {
    depth: Cell<u32>,
    steps: Cell<u32>,
    /// The error is on its way: whatever is asked is unknown.
    failed: Cell<bool>,
}

/// While it lives the question is one level deeper.
pub(crate) struct Entered<'b>(&'b Budget);

impl Budget {
    /// At the head of each question of a rule.
    pub(crate) fn refill(&self) {
        self.steps.set(0);
        self.failed.set(false);
    }

    /// `None`: too deep or too much.
    pub(crate) fn enter(&self) -> Option<Entered<'_>> {
        if self.failed.get() {
            return None;
        }
        if self.depth.get() >= MAX_DEPTH || self.steps.get() >= MAX_STEPS {
            self.failed.set(true);
            return None;
        }
        self.depth.set(self.depth.get() + 1);
        self.steps.set(self.steps.get() + 1);
        Some(Entered(self))
    }

    /// The `catch` of `getType`: whether there was an error. What was computed does not count then.
    pub(crate) fn caught(&self) -> bool {
        self.failed.replace(false)
    }
}

impl Drop for Entered<'_> {
    fn drop(&mut self) {
        self.0.depth.set(self.0.depth.get() - 1);
    }
}

/// The tracker.
pub(crate) trait TypeOf<'a> {
    /// upstream's `getType`
    fn get_type(&self, e: Expr<'a>) -> Option<TypeInfo<'a>>;
    fn budget(&self) -> &Budget;
}

/// A `(() => TypeInfo | null) | null` that a closure has caught.
type Kept<'a> = Option<Rc<Thunk<'a>>>;

fn keep<'a>(get_type: Option<&Thunk<'a>>) -> Kept<'a> {
    get_type.map(|it| Rc::new(it.clone()))
}

/// `const type = getType?.()`, if `isTypeClass(type)`
fn class_of<'a>(get_type: Option<&Thunk<'a>>, types: &dyn TypeOf<'a>) -> Option<TypeInfo<'a>> {
    get_type?.get(types).filter(TypeInfo::is_type_class)
}

/// upstream's `() => TypeInfo | null`
#[derive(Clone)]
pub(crate) enum Thunk<'a> {
    /// `() => type`
    Known(Option<TypeInfo<'a>>),
    /// `() => getType(node)`
    Expr(Expr<'a>),
    /// Any other closure of the tracker. One that makes an object makes a new one at each call.
    Lazy(Rc<dyn Fn(&dyn TypeOf<'a>) -> Option<TypeInfo<'a>> + 'a>),
    /// `() => { const s = selfType?.(); return isTypeClass(s) ? s.iterateType() : null }`
    IterateType(Kept<'a>),
    /// The same with `s.paramType(index)`.
    ParamType(Kept<'a>, usize),
    /// `() => iterateType.at(index)` of `mapConstructor`
    At(Rc<TypeArray<'a>>, usize),
    /// `() => new TypeArray(function* () { .. })` of the `RETURN_ENTRIES` of array, map or set.
    Entries(Class, Kept<'a>),
    /// What the generator of `RETURN_MAP` yields.
    MapCallback {
        self_type: Kept<'a>,
        arg_type: Kept<'a>,
    },
}

impl<'a> Thunk<'a> {
    pub(crate) fn get(&self, types: &dyn TypeOf<'a>) -> Option<TypeInfo<'a>> {
        match self {
            Thunk::Known(known) => known.clone(),
            Thunk::Expr(e) => types.get_type(*e),
            Thunk::Lazy(get_type) => get_type(types),
            Thunk::IterateType(self_type) => {
                class_of(self_type.as_deref(), types)?.iterate_type(types)
            }
            Thunk::ParamType(self_type, index) => {
                class_of(self_type.as_deref(), types)?.param_type(*index, types)
            }
            Thunk::At(array, index) => array.at(*index, types),
            Thunk::Entries(Class::Array, self_type) => TypeArray::new(
                vec![
                    ArrayItem::Type(Thunk::Known(Some(TypeInfo::Number))),
                    ArrayItem::Type(Thunk::IterateType(self_type.clone())),
                ],
                false,
            ),
            Thunk::Entries(Class::Map, self_type) => TypeArray::new(
                vec![
                    ArrayItem::Type(Thunk::ParamType(self_type.clone(), 0)),
                    ArrayItem::Type(Thunk::ParamType(self_type.clone(), 1)),
                ],
                true,
            ),
            Thunk::Entries(_, self_type) => TypeArray::new(
                vec![
                    ArrayItem::Type(Thunk::IterateType(self_type.clone())),
                    ArrayItem::Type(Thunk::IterateType(self_type.clone())),
                ],
                true,
            ),
            Thunk::MapCallback {
                self_type,
                arg_type,
            } => class_of(arg_type.as_deref(), types)?.return_type(
                self_type.as_deref(),
                &[
                    Some(Thunk::IterateType(self_type.clone())),
                    Some(Thunk::Known(Some(TypeInfo::Number))),
                ],
                false,
                types,
            ),
        }
    }

    fn nesting(&self) -> u32 {
        let of = |kept: &Kept<'a>| kept.as_deref().map_or(0, Thunk::nesting);
        match self {
            Thunk::Known(known) => known.as_ref().map_or(0, TypeInfo::nesting),
            Thunk::Expr(_) | Thunk::Lazy(_) => 0,
            Thunk::IterateType(kept) | Thunk::ParamType(kept, _) | Thunk::Entries(_, kept) => {
                of(kept)
            }
            Thunk::At(array, _) => array.collection.nesting,
            Thunk::MapCallback {
                self_type,
                arg_type,
            } => of(self_type).max(of(arg_type)),
        }
    }
}

/// upstream's `TypeInfo`. The first three are strings there.
#[derive(Clone)]
pub(crate) enum TypeInfo<'a> {
    Null,
    Undefined,
    /// A name that TypeScript gave: `typeName as TypeInfo`.
    Named(Cow<'a, [u8]>),
    String,
    Number,
    Boolean,
    BigInt,
    RegExp,
    Global,
    Array(Rc<TypeArray<'a>>),
    Object(Rc<TypeObject<'a>>),
    Map(Rc<TypeMap<'a>>),
    Set(Rc<TypeSet<'a>>),
    Iterable(Rc<TypeIterable<'a>>),
    Function(Rc<TypeFunction<'a>>),
    Union(Rc<TypeUnionOrIntersection<'a>>),
}

/// An object of which upstream has one.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Constant {
    String,
    Number,
    Boolean,
    BigInt,
    RegExp,
    Global,
    UnknownArray,
    StringArray,
    UnknownObject,
    UnknownMap,
    UnknownSet,
    UnknownIterable,
    Function(Proto),
}

/// What `===` compares.
#[derive(PartialEq, Eq)]
enum Identity<'t> {
    Name(&'t [u8]),
    Constant(Constant),
    Object(usize),
}

/// A member of a `Set` of types. It keeps the type, so that no later one gets its address.
struct ById<'a>(TypeInfo<'a>);

impl PartialEq for ById<'_> {
    fn eq(&self, other: &Self) -> bool {
        self.0.is_same(&other.0)
    }
}

impl Eq for ById<'_> {}

impl Hash for ById<'_> {
    fn hash<H: Hasher>(&self, state: &mut H) {
        match self.0.identity() {
            Identity::Name(name) => name.hash(state),
            // There are few, and `Proto` has no hash.
            Identity::Constant(_) => {}
            Identity::Object(address) => address.hash(state),
        }
    }
}

impl<'a> TypeInfo<'a> {
    /// What the entry of a table stands for.
    fn from_proto(proto: Proto) -> TypeInfo<'a> {
        match proto {
            Proto::String => TypeInfo::String,
            Proto::Number => TypeInfo::Number,
            Proto::Boolean => TypeInfo::Boolean,
            Proto::Undefined => TypeInfo::Undefined,
            Proto::Global => TypeInfo::Global,
            _ => TypeInfo::Function(Rc::new(TypeFunction {
                function: FunctionArg::Proto(proto),
                nesting: 0,
            })),
        }
    }

    /// upstream's `isTypeClass`
    pub(crate) fn is_type_class(&self) -> bool {
        self.as_name().is_none()
    }

    /// The type, if it is a string upstream.
    fn as_name(&self) -> Option<&[u8]> {
        match self {
            TypeInfo::Null => Some(NULL),
            TypeInfo::Undefined => Some(UNDEFINED),
            TypeInfo::Named(name) => Some(&**name),
            _ => None,
        }
    }

    /// `if (type)`
    fn is_truthy(&self) -> bool {
        self.as_name().is_none_or(|name| !name.is_empty())
    }

    fn identity(&self) -> Identity<'_> {
        let (constant, address) = match self {
            TypeInfo::Null => return Identity::Name(NULL),
            TypeInfo::Undefined => return Identity::Name(UNDEFINED),
            TypeInfo::Named(name) => return Identity::Name(&**name),
            TypeInfo::String => return Identity::Constant(Constant::String),
            TypeInfo::Number => return Identity::Constant(Constant::Number),
            TypeInfo::Boolean => return Identity::Constant(Constant::Boolean),
            TypeInfo::BigInt => return Identity::Constant(Constant::BigInt),
            TypeInfo::RegExp => return Identity::Constant(Constant::RegExp),
            TypeInfo::Global => return Identity::Constant(Constant::Global),
            TypeInfo::Array(it) => (it.constant, Rc::as_ptr(it).addr()),
            TypeInfo::Object(it) => (it.constant, Rc::as_ptr(it).addr()),
            TypeInfo::Map(it) => (it.constant, Rc::as_ptr(it).addr()),
            TypeInfo::Set(it) => (it.constant, Rc::as_ptr(it).addr()),
            TypeInfo::Iterable(it) => (it.constant, Rc::as_ptr(it).addr()),
            TypeInfo::Function(it) => (it.constant(), Rc::as_ptr(it).addr()),
            TypeInfo::Union(it) => (None, Rc::as_ptr(it).addr()),
        };
        match constant {
            Some(constant) => Identity::Constant(constant),
            None => Identity::Object(address),
        }
    }

    /// `this === other`
    pub(crate) fn is_same(&self, other: &TypeInfo<'a>) -> bool {
        self.identity() == other.identity()
    }

    /// How many levels of types it owns.
    fn nesting(&self) -> u32 {
        match self {
            TypeInfo::Array(it) => it.collection.nesting,
            TypeInfo::Object(it) => it.nesting,
            TypeInfo::Map(it) => it.nesting,
            TypeInfo::Set(it) => it.nesting,
            TypeInfo::Iterable(it) => it.nesting,
            TypeInfo::Function(it) => it.nesting,
            TypeInfo::Union(it) => it.collection.nesting,
            _ => 0,
        }
    }

    /// `None`: it owns so many levels that dropping it would recurse too deep. It is unknown.
    fn shallow(self) -> Option<TypeInfo<'a>> {
        (self.nesting() <= MAX_NESTING).then_some(self)
    }

    /// `has(type)` of a class. Of a string: `this === type`, as `hasType` has it.
    pub(crate) fn has(&self, name: &str, types: &dyn TypeOf<'a>) -> bool {
        match self {
            TypeInfo::Null | TypeInfo::Undefined | TypeInfo::Named(_) => {
                self.as_name().is_some_and(|it| it == name.as_bytes())
            }
            TypeInfo::String => name == "String",
            TypeInfo::Number => name == "Number",
            TypeInfo::Boolean => name == "Boolean",
            TypeInfo::BigInt => name == "BigInt",
            TypeInfo::RegExp => name == "RegExp",
            TypeInfo::Array(_) => name == "Array",
            TypeInfo::Object(_) => name == "Object",
            TypeInfo::Map(_) => name == "Map",
            TypeInfo::Set(_) => name == "Set",
            TypeInfo::Function(_) => name == "Function",
            TypeInfo::Global | TypeInfo::Iterable(_) => false,
            TypeInfo::Union(it) => it.collection.has(name, types),
        }
    }

    pub(crate) fn param_type(&self, index: usize, types: &dyn TypeOf<'a>) -> Option<TypeInfo<'a>> {
        let _entered = types.budget().enter()?;
        match self {
            TypeInfo::Array(it) => it.param_type(index, types),
            TypeInfo::Map(it) => it.param_type(index, types),
            TypeInfo::Set(it) => it.param_type(index, types),
            TypeInfo::Iterable(it) => it.param_type(index, types),
            _ => None,
        }
    }

    pub(crate) fn iterate_type(&self, types: &dyn TypeOf<'a>) -> Option<TypeInfo<'a>> {
        let _entered = types.budget().enter()?;
        match self {
            TypeInfo::String => Some(TypeInfo::String),
            TypeInfo::Array(it) => it.iterate_type(types),
            TypeInfo::Map(it) => it.iterate_type(),
            TypeInfo::Set(it) => it.iterate_type(types),
            TypeInfo::Iterable(it) => it.iterate_type(types),
            TypeInfo::Union(it) => it.iterate_type(types),
            _ => None,
        }
    }

    pub(crate) fn property_type(
        &self,
        name: &[u8],
        types: &dyn TypeOf<'a>,
    ) -> Option<TypeInfo<'a>> {
        let _entered = types.budget().enter()?;
        let class = match self {
            TypeInfo::Null | TypeInfo::Undefined | TypeInfo::Named(_) => return None,
            // `"0"` is `this`, which is what the table has.
            TypeInfo::String => Class::String,
            TypeInfo::Number => Class::Number,
            TypeInfo::Boolean => Class::Boolean,
            TypeInfo::BigInt => Class::BigInt,
            TypeInfo::RegExp => Class::RegExp,
            TypeInfo::Global => Class::Global,
            TypeInfo::Array(it) => return it.property_type(name, types),
            TypeInfo::Object(it) => return it.property_type(name, types),
            TypeInfo::Map(_) => Class::Map,
            TypeInfo::Set(_) => Class::Set,
            TypeInfo::Iterable(_) => Class::Iterable,
            TypeInfo::Function(it) => return it.property_type(name),
            TypeInfo::Union(it) => return it.property_type(name, types),
        };
        property(class, name).map(TypeInfo::from_proto)
    }

    pub(crate) fn return_type(
        &self,
        this_type: Option<&Thunk<'a>>,
        arg_types: &[Option<Thunk<'a>>],
        is_constructor: bool,
        types: &dyn TypeOf<'a>,
    ) -> Option<TypeInfo<'a>> {
        let _entered = types.budget().enter()?;
        match self {
            TypeInfo::Function(it) => it.return_type(this_type, arg_types, is_constructor, types),
            TypeInfo::Union(it) => it.return_type(this_type, arg_types, types),
            _ => None,
        }
    }

    /// `typeNames()` of a class. Of a string: itself, as the tracker's `getTypes` has it.
    pub(crate) fn type_names(&self, types: &dyn TypeOf<'a>) -> Vec<Vec<u8>> {
        let Some(_entered) = types.budget().enter() else {
            return Vec::new();
        };
        let name: &[u8] = match self {
            TypeInfo::Null => NULL,
            TypeInfo::Undefined => UNDEFINED,
            TypeInfo::Named(name) => &**name,
            TypeInfo::String => b"String",
            TypeInfo::Number => b"Number",
            TypeInfo::Boolean => b"Boolean",
            TypeInfo::BigInt => b"BigInt",
            TypeInfo::RegExp => b"RegExp",
            TypeInfo::Global => b"Global",
            TypeInfo::Object(_) => b"Object",
            TypeInfo::Function(_) => b"Function",
            TypeInfo::Array(it) => return it.type_names(types),
            TypeInfo::Map(it) => return it.type_names(types),
            TypeInfo::Set(it) => return it.type_names(types),
            TypeInfo::Iterable(it) => return it.type_names(types),
            TypeInfo::Union(it) => return it.type_names(types),
        };
        vec![name.to_vec()]
    }

    /// Of two classes.
    pub(crate) fn equals(&self, o: &TypeInfo<'a>, types: &dyn TypeOf<'a>) -> bool {
        let Some(_entered) = types.budget().enter() else {
            return false;
        };
        match self {
            TypeInfo::Null | TypeInfo::Undefined | TypeInfo::Named(_) | TypeInfo::Function(_) => {
                false
            }
            TypeInfo::String => matches!(o, TypeInfo::String),
            TypeInfo::Number => matches!(o, TypeInfo::Number),
            TypeInfo::Boolean => matches!(o, TypeInfo::Boolean),
            TypeInfo::BigInt => matches!(o, TypeInfo::BigInt),
            TypeInfo::RegExp => matches!(o, TypeInfo::RegExp),
            TypeInfo::Global => matches!(o, TypeInfo::Global),
            TypeInfo::Array(it) => it.equals(o, types),
            TypeInfo::Object(it) => it.equals(o, types),
            TypeInfo::Map(it) => it.equals(o, types),
            TypeInfo::Set(it) => it.equals(o, types),
            TypeInfo::Iterable(it) => it.equals(o, types),
            TypeInfo::Union(it) => it.equals(o, types),
        }
    }
}

/// upstream's `isEquals`
pub(crate) fn is_equals<'a>(
    t1: Option<&TypeInfo<'a>>,
    t2: Option<&TypeInfo<'a>>,
    types: &dyn TypeOf<'a>,
) -> bool {
    match (t1, t2) {
        (None, None) => true,
        (Some(t1), Some(t2)) => {
            t1.is_same(t2) || (t1.is_type_class() && t2.is_type_class() && t1.equals(t2, types))
        }
        _ => false,
    }
}

/// upstream's `hasType`
pub(crate) fn has_type<'a>(
    result: Option<&TypeInfo<'a>>,
    name: &str,
    types: &dyn TypeOf<'a>,
) -> bool {
    result.is_some_and(|it| it.has(name, types))
}

/// upstream's `getTypeName`
pub(crate) fn get_type_name<'a>(
    type_info: Option<&TypeInfo<'a>>,
    types: &dyn TypeOf<'a>,
) -> Option<Vec<u8>> {
    Some(type_info?.type_names(types).join(&b'|'))
}

/// `` `${name}<${params.join(",")}>` ``
fn generic(name: &str, params: &[Vec<u8>]) -> Vec<u8> {
    let mut result = name.as_bytes().to_vec();
    result.push(b'<');
    result.extend_from_slice(&params.join(&b','));
    result.push(b'>');
    result
}

/// What a generator function of a `TypeArray` or of `buildType` does between two `yield`s.
pub(crate) enum ArrayItem<'a> {
    /// `yield null`
    Unknown,
    /// `yield getType()`
    Type(Thunk<'a>),
    /// `const t = getType(); yield isTypeClass(t) ? t.iterateType() : null`
    Spread(Thunk<'a>),
}

impl<'a> ArrayItem<'a> {
    fn get(&self, types: &dyn TypeOf<'a>) -> Option<TypeInfo<'a>> {
        match self {
            ArrayItem::Unknown => None,
            ArrayItem::Type(get_type) => get_type.get(types),
            ArrayItem::Spread(get_type) => class_of(Some(get_type), types)?.iterate_type(types),
        }
    }

    fn nesting(&self) -> u32 {
        match self {
            ArrayItem::Unknown => 0,
            ArrayItem::Type(get_type) | ArrayItem::Spread(get_type) => get_type.nesting(),
        }
    }
}

/// What the generators of index.ts yield.
#[derive(Copy, Clone)]
enum Primitive {
    String,
    Number,
    BigInt,
}

impl Primitive {
    fn name(self) -> &'static str {
        match self {
            Primitive::String => "String",
            Primitive::Number => "Number",
            Primitive::BigInt => "BigInt",
        }
    }

    fn type_info<'a>(self) -> TypeInfo<'a> {
        match self {
            Primitive::String => TypeInfo::String,
            Primitive::Number => TypeInfo::Number,
            Primitive::BigInt => TypeInfo::BigInt,
        }
    }
}

/// `hasType(t1, ..) || hasType(t2, ..)`, or `&&`
#[derive(Copy, Clone)]
enum Operands {
    Either,
    Both,
}

#[derive(Copy, Clone)]
enum Operator {
    /// `binaryNumOp`
    BinaryNum,
    /// `"+"`
    Plus,
    /// `unaryNumOp`: there is no `t2`.
    UnaryNum,
}

impl Operator {
    /// What the generator asks for, in its order. If there is none of it, it yields all.
    fn candidates(self) -> &'static [(Primitive, Operands)] {
        match self {
            Operator::BinaryNum => &[
                (Primitive::Number, Operands::Either),
                (Primitive::BigInt, Operands::Both),
            ],
            Operator::Plus => &[
                (Primitive::String, Operands::Either),
                (Primitive::Number, Operands::Both),
                (Primitive::BigInt, Operands::Both),
            ],
            Operator::UnaryNum => &[
                (Primitive::Number, Operands::Either),
                (Primitive::BigInt, Operands::Either),
            ],
        }
    }
}

/// What a generator of `TypeUnionOrIntersection` makes of each of `baseCollection.all()`.
enum Each<'a> {
    /// `() => collection.all()`
    Same,
    PropertyType(Box<[u8]>),
    IterateType,
    ReturnType(Kept<'a>, Rc<[Option<Thunk<'a>>]>),
}

/// upstream's `() => IterableIterator<TypeInfo | null>`
enum Generator<'a> {
    Items(Rc<[ArrayItem<'a>]>),
    Each(Rc<TypeCollection<'a>>, Each<'a>),
    Operator(Operator, Box<[Option<TypeInfo<'a>>; 2]>),
}

impl Generator<'_> {
    fn nesting(&self) -> u32 {
        match self {
            Generator::Items(items) => items.iter().map(ArrayItem::nesting).max().unwrap_or(0),
            Generator::Each(base, Each::ReturnType(this_type, arg_types)) => arg_types
                .iter()
                .flatten()
                .chain(this_type.as_deref())
                .map(Thunk::nesting)
                .fold(base.nesting, u32::max),
            Generator::Each(base, _) => base.nesting,
            Generator::Operator(_, operands) => operands
                .iter()
                .flatten()
                .map(TypeInfo::nesting)
                .max()
                .unwrap_or(0),
        }
    }
}

struct TypeCollection<'a> {
    generator: Generator<'a>,
    unknown_index: Cell<Option<usize>>,
    nesting: u32,
}

impl<'a> TypeCollection<'a> {
    fn new(generator: Generator<'a>) -> Rc<Self> {
        Rc::new(TypeCollection {
            nesting: generator.nesting() + 1,
            generator,
            unknown_index: Cell::new(None),
        })
    }

    fn generator(self: &Rc<Self>) -> Generated<'a> {
        Generated {
            collection: Rc::clone(self),
            at: 0,
            is_known: false,
            base: None,
            index: 0,
        }
    }

    fn has(self: &Rc<Self>, name: &str, types: &dyn TypeOf<'a>) -> bool {
        let Some(_entered) = types.budget().enter() else {
            return false;
        };
        let mut generated = self.generator();
        while let Some(t) = generated.next(types) {
            if t.has(name, types) {
                return true;
            }
        }
        false
    }

    fn is_one_type(self: &Rc<Self>, types: &dyn TypeOf<'a>) -> bool {
        let mut all = self.all();
        let Some(first) = all.next(types) else {
            return true;
        };
        while let Some(t) = all.next(types) {
            if !is_equals(Some(&first), Some(&t), types) {
                return false;
            }
        }
        true
    }

    fn tuple(self: &Rc<Self>) -> Tuple<'a> {
        Tuple {
            generated: self.generator(),
            index: 0,
        }
    }

    fn all(self: &Rc<Self>) -> All<'a> {
        All {
            generated: self.generator(),
            set: FxHashSet::default(),
        }
    }

    fn strings(self: &Rc<Self>, types: &dyn TypeOf<'a>) -> Vec<Vec<u8>> {
        // Upstream adds a class as itself, which no string equals: only the names count.
        let mut set = FxHashSet::<Vec<u8>>::default();
        let mut result = Vec::new();
        let mut all = self.all();
        while let Some(t) = all.next(types) {
            if let Some(name) = t.as_name() {
                if set.insert(name.to_vec()) {
                    result.push(name.to_vec());
                }
            } else {
                result.extend(
                    t.type_names(types)
                        .into_iter()
                        .filter(|name| !set.contains(name)),
                );
            }
        }
        result
    }
}

/// One run of `collection.generator()`.
struct Generated<'a> {
    collection: Rc<TypeCollection<'a>>,
    /// How far the generator function that the collection was made with has come.
    at: usize,
    /// `!unknown` of an operator's.
    is_known: bool,
    /// `baseCollection.all()`
    base: Option<Box<All<'a>>>,
    index: usize,
}

impl<'a> Generated<'a> {
    fn next(&mut self, types: &dyn TypeOf<'a>) -> Option<TypeInfo<'a>> {
        loop {
            let t = self.resume(types)?;
            let index = self.index;
            self.index += 1;
            if t.is_some() {
                return t;
            }
            let unknown_index = &self.collection.unknown_index;
            if unknown_index.get().is_none() {
                unknown_index.set(Some(index));
            }
        }
    }

    /// The generator function that the collection was made with, up to its next `yield`.
    fn resume(&mut self, types: &dyn TypeOf<'a>) -> Option<Option<TypeInfo<'a>>> {
        let _entered = types.budget().enter()?;
        match &self.collection.generator {
            Generator::Items(items) => {
                let item = items.get(self.at)?;
                self.at += 1;
                Some(item.get(types))
            }
            Generator::Each(base, each) => {
                let all = self.base.get_or_insert_with(|| Box::new(base.all()));
                loop {
                    let t = all.next(types)?;
                    let made = match each {
                        Each::Same => return Some(Some(t)),
                        _ if !t.is_type_class() => None,
                        Each::PropertyType(name) => t.property_type(name, types),
                        Each::IterateType => t.iterate_type(types),
                        Each::ReturnType(this_type, arg_types) => {
                            t.return_type(this_type.as_deref(), arg_types, false, types)
                        }
                    };
                    if let Some(made) = made.filter(TypeInfo::is_truthy) {
                        return Some(Some(made));
                    }
                }
            }
            Generator::Operator(operator, operands) => {
                let [t1, t2] = &**operands;
                let candidates = operator.candidates();
                loop {
                    let at = self.at;
                    self.at += 1;
                    let Some(&(primitive, needed)) = candidates.get(at) else {
                        if self.is_known {
                            return None;
                        }
                        let (primitive, _) = candidates.get(at - candidates.len())?;
                        return Some(Some(primitive.type_info()));
                    };
                    let has =
                        |t: &Option<TypeInfo<'a>>| has_type(t.as_ref(), primitive.name(), types);
                    let found = match needed {
                        Operands::Either => has(t1) || has(t2),
                        Operands::Both => has(t1) && has(t2),
                    };
                    if found {
                        self.is_known = true;
                        return Some(Some(primitive.type_info()));
                    }
                }
            }
        }
    }
}

/// One run of `collection.all()`.
struct All<'a> {
    generated: Generated<'a>,
    set: FxHashSet<ById<'a>>,
}

impl<'a> All<'a> {
    fn next(&mut self, types: &dyn TypeOf<'a>) -> Option<TypeInfo<'a>> {
        loop {
            let t = self.generated.next(types)?;
            if self.set.insert(ById(t.clone())) {
                return Some(t);
            }
        }
    }
}

/// One run of `collection.tuple()`.
struct Tuple<'a> {
    generated: Generated<'a>,
    index: usize,
}

impl<'a> Tuple<'a> {
    fn next(&mut self, types: &dyn TypeOf<'a>) -> Option<TypeInfo<'a>> {
        let t = self.generated.next(types)?;
        let unknown_index = self.generated.collection.unknown_index.get();
        if unknown_index.is_some_and(|unknown_index| self.index < unknown_index) {
            return None;
        }
        self.index += 1;
        Some(t)
    }
}

pub(crate) struct TypeUnionOrIntersection<'a> {
    collection: Rc<TypeCollection<'a>>,
}

impl<'a> TypeUnionOrIntersection<'a> {
    /// `buildType(function* () { .. })`
    pub(crate) fn build_type(
        items: Vec<ArrayItem<'a>>,
        types: &dyn TypeOf<'a>,
    ) -> Option<TypeInfo<'a>> {
        Self::build(Generator::Items(items.into()), types)
    }

    fn build(generator: Generator<'a>, types: &dyn TypeOf<'a>) -> Option<TypeInfo<'a>> {
        let collection = TypeCollection::new(generator);
        if collection.is_one_type(types) {
            return collection.all().next(types);
        }
        let collection = TypeCollection::new(Generator::Each(collection, Each::Same));
        TypeInfo::Union(Rc::new(TypeUnionOrIntersection { collection })).shallow()
    }

    fn build_each(&self, each: Each<'a>, types: &dyn TypeOf<'a>) -> Option<TypeInfo<'a>> {
        Self::build(Generator::Each(Rc::clone(&self.collection), each), types)
    }

    fn property_type(&self, name: &[u8], types: &dyn TypeOf<'a>) -> Option<TypeInfo<'a>> {
        self.build_each(Each::PropertyType(name.into()), types)
    }

    fn iterate_type(&self, types: &dyn TypeOf<'a>) -> Option<TypeInfo<'a>> {
        self.build_each(Each::IterateType, types)
    }

    fn return_type(
        &self,
        this_type: Option<&Thunk<'a>>,
        arg_types: &[Option<Thunk<'a>>],
        types: &dyn TypeOf<'a>,
    ) -> Option<TypeInfo<'a>> {
        self.build_each(Each::ReturnType(keep(this_type), arg_types.into()), types)
    }

    fn type_names(&self, types: &dyn TypeOf<'a>) -> Vec<Vec<u8>> {
        let mut names = self.collection.strings(types);
        sort::sort_by(&mut names, |a, b| strings::order_utf16(a, b));
        names
    }

    fn equals(&self, o: &TypeInfo<'a>, types: &dyn TypeOf<'a>) -> bool {
        let TypeInfo::Union(o) = o else {
            return false;
        };
        let mut itr1 = self.collection.all();
        let mut itr2 = o.collection.all();
        loop {
            let e1 = itr1.next(types);
            let e2 = itr2.next(types);
            if e1.is_none() || e2.is_none() {
                return e1.is_none() == e2.is_none();
            }
            if !is_equals(e1.as_ref(), e2.as_ref(), types) {
                return false;
            }
        }
    }
}

pub(crate) struct TypeArray<'a> {
    collection: Rc<TypeCollection<'a>>,
    maybe_tuple: bool,
    constant: Option<Constant>,
}

impl<'a> TypeArray<'a> {
    /// `new TypeArray(function* () { .. }, maybeTuple)`. `None`: see [`TypeInfo::shallow`].
    pub(crate) fn new(items: Vec<ArrayItem<'a>>, maybe_tuple: bool) -> Option<TypeInfo<'a>> {
        Self::with(items, maybe_tuple, None).shallow()
    }

    fn with(
        items: Vec<ArrayItem<'a>>,
        maybe_tuple: bool,
        constant: Option<Constant>,
    ) -> TypeInfo<'a> {
        TypeInfo::Array(Rc::new(TypeArray {
            collection: TypeCollection::new(Generator::Items(items.into())),
            maybe_tuple,
            constant,
        }))
    }

    fn param_type(&self, index: usize, types: &dyn TypeOf<'a>) -> Option<TypeInfo<'a>> {
        if index == 0 {
            let generator = Generator::Each(Rc::clone(&self.collection), Each::Same);
            return TypeUnionOrIntersection::build(generator, types);
        }
        None
    }

    fn at(&self, index: usize, types: &dyn TypeOf<'a>) -> Option<TypeInfo<'a>> {
        if !self.maybe_tuple {
            return None;
        }
        let mut tuple = self.collection.tuple();
        let mut i = 0;
        while let Some(t) = tuple.next(types) {
            if i == index {
                return Some(t);
            }
            i += 1;
        }
        None
    }

    fn property_type(&self, name: &[u8], types: &dyn TypeOf<'a>) -> Option<TypeInfo<'a>> {
        if name == b"0" {
            return self.param_type(0, types);
        }
        property(Class::Array, name).map(TypeInfo::from_proto)
    }

    fn iterate_type(&self, types: &dyn TypeOf<'a>) -> Option<TypeInfo<'a>> {
        self.param_type(0, types)
    }

    fn type_names(&self, types: &dyn TypeOf<'a>) -> Vec<Vec<u8>> {
        let param0 = get_type_name(self.iterate_type(types).as_ref(), types);
        vec![match param0.filter(|it| !it.is_empty()) {
            Some(param0) => generic("Array", &[param0]),
            None => b"Array".to_vec(),
        }]
    }

    fn equals(&self, o: &TypeInfo<'a>, types: &dyn TypeOf<'a>) -> bool {
        let TypeInfo::Array(o) = o else {
            return false;
        };
        is_equals(
            self.iterate_type(types).as_ref(),
            o.iterate_type(types).as_ref(),
            types,
        )
    }
}

/// What the generator function of a `TypeObject` does between two `yield`s.
pub(crate) enum ObjectItem<'a> {
    /// `yield [name, getValue]`
    Property(Cow<'a, [u8]>, Thunk<'a>),
    /// `const t = getType(); if (isTypeClass(t) && t.type === "Object") yield* t.allProperties()`
    Spread(Thunk<'a>),
}

pub(crate) struct TypeObject<'a> {
    properties_generator: Rc<[ObjectItem<'a>]>,
    nesting: u32,
    constant: Option<Constant>,
}

impl<'a> TypeObject<'a> {
    /// `new TypeObject(function* () { .. })`. `None`: see [`TypeInfo::shallow`].
    pub(crate) fn new(properties: Vec<ObjectItem<'a>>) -> Option<TypeInfo<'a>> {
        Self::with(properties, None).shallow()
    }

    fn with(properties: Vec<ObjectItem<'a>>, constant: Option<Constant>) -> TypeInfo<'a> {
        let nesting = properties.iter().map(|item| match item {
            ObjectItem::Property(_, get_type) | ObjectItem::Spread(get_type) => get_type.nesting(),
        });
        TypeInfo::Object(Rc::new(TypeObject {
            nesting: nesting.max().unwrap_or(0) + 1,
            properties_generator: properties.into(),
            constant,
        }))
    }

    fn all_properties(&self) -> AllProperties<'a> {
        AllProperties {
            properties_generator: Rc::clone(&self.properties_generator),
            at: 0,
            spread: None,
            set: FxHashSet::default(),
        }
    }

    fn property_type(&self, name: &[u8], types: &dyn TypeOf<'a>) -> Option<TypeInfo<'a>> {
        let mut all_properties = self.all_properties();
        while let Some((key, get_value)) = all_properties.next(types) {
            if *key == *name {
                return get_value.get(types);
            }
        }
        property(Class::Object, name).map(TypeInfo::from_proto)
    }

    fn equals(&self, o: &TypeInfo<'a>, types: &dyn TypeOf<'a>) -> bool {
        let TypeInfo::Object(o) = o else {
            return false;
        };
        let mut itr2 = o.all_properties();
        let mut props2 = FxHashMap::<Cow<'a, [u8]>, Thunk<'a>>::default();
        let mut itr1 = self.all_properties();
        while let Some((key1, get1)) = itr1.next(types) {
            if let Some(get2) = props2.get(&key1) {
                if !is_equals(get1.get(types).as_ref(), get2.get(types).as_ref(), types) {
                    return false;
                }
                continue;
            }
            loop {
                let Some((key2, get2)) = itr2.next(types) else {
                    return false;
                };
                if key1 != key2 {
                    props2.insert(key2, get2);
                    continue;
                }
                if !is_equals(get1.get(types).as_ref(), get2.get(types).as_ref(), types) {
                    return false;
                }
                props2.insert(key2, get2);
                break;
            }
        }
        itr2.next(types).is_none()
    }
}

/// One run of `object.allProperties()`.
struct AllProperties<'a> {
    properties_generator: Rc<[ObjectItem<'a>]>,
    at: usize,
    /// The `yield*` that is running.
    spread: Option<Box<AllProperties<'a>>>,
    set: FxHashSet<Cow<'a, [u8]>>,
}

impl<'a> AllProperties<'a> {
    fn next(&mut self, types: &dyn TypeOf<'a>) -> Option<(Cow<'a, [u8]>, Thunk<'a>)> {
        let _entered = types.budget().enter()?;
        loop {
            let t = self.resume(types)?;
            if self.set.insert(t.0.clone()) {
                return Some(t);
            }
        }
    }

    /// `propertiesGenerator`, up to its next `yield`.
    fn resume(&mut self, types: &dyn TypeOf<'a>) -> Option<(Cow<'a, [u8]>, Thunk<'a>)> {
        loop {
            if let Some(spread) = &mut self.spread {
                let t = spread.next(types);
                if t.is_some() {
                    return t;
                }
                self.spread = None;
            }
            let item = self.properties_generator.get(self.at)?;
            self.at += 1;
            match item {
                ObjectItem::Property(name, get_value) => {
                    return Some((name.clone(), get_value.clone()));
                }
                ObjectItem::Spread(get_type) => {
                    if let Some(TypeInfo::Object(object)) = get_type.get(types) {
                        self.spread = Some(Box::new(object.all_properties()));
                    }
                }
            }
        }
    }
}

pub(crate) struct TypeMap<'a> {
    param0: Thunk<'a>,
    param1: Thunk<'a>,
    nesting: u32,
    constant: Option<Constant>,
}

impl<'a> TypeMap<'a> {
    /// `None`: see [`TypeInfo::shallow`].
    pub(crate) fn new(param0: Thunk<'a>, param1: Thunk<'a>) -> Option<TypeInfo<'a>> {
        Self::with(param0, param1, None).shallow()
    }

    fn with(param0: Thunk<'a>, param1: Thunk<'a>, constant: Option<Constant>) -> TypeInfo<'a> {
        TypeInfo::Map(Rc::new(TypeMap {
            nesting: param0.nesting().max(param1.nesting()) + 1,
            param0,
            param1,
            constant,
        }))
    }

    fn param_type(&self, index: usize, types: &dyn TypeOf<'a>) -> Option<TypeInfo<'a>> {
        match index {
            0 => self.param0.get(types),
            1 => self.param1.get(types),
            _ => None,
        }
    }

    fn iterate_type(&self) -> Option<TypeInfo<'a>> {
        TypeArray::new(
            vec![
                ArrayItem::Type(self.param0.clone()),
                ArrayItem::Type(self.param1.clone()),
            ],
            true,
        )
    }

    fn type_names(&self, types: &dyn TypeOf<'a>) -> Vec<Vec<u8>> {
        let param0 = get_type_name(self.param_type(0, types).as_ref(), types);
        let param1 = get_type_name(self.param_type(1, types).as_ref(), types);
        vec![match (param0, param1) {
            (Some(param0), Some(param1)) => generic("Map", &[param0, param1]),
            _ => b"Map".to_vec(),
        }]
    }

    fn equals(&self, o: &TypeInfo<'a>, types: &dyn TypeOf<'a>) -> bool {
        let TypeInfo::Map(o) = o else {
            return false;
        };
        (0..2).all(|index| {
            is_equals(
                self.param_type(index, types).as_ref(),
                o.param_type(index, types).as_ref(),
                types,
            )
        })
    }
}

/// upstream's `mapConstructor`
fn map_constructor<'a>(
    arg_types: &[Option<Thunk<'a>>],
    is_constructor: bool,
    types: &dyn TypeOf<'a>,
) -> Option<TypeInfo<'a>> {
    if !is_constructor {
        return None;
    }
    let arg = arg_types.first().and_then(Option::as_ref);
    if let Some(TypeInfo::Array(arg)) = arg.and_then(|it| it.get(types))
        && let Some(TypeInfo::Array(iterate_type)) = arg.iterate_type(types)
    {
        return TypeMap::new(
            Thunk::At(Rc::clone(&iterate_type), 0),
            Thunk::At(iterate_type, 1),
        );
    }
    Some(unknown_map())
}

pub(crate) struct TypeSet<'a> {
    param0: Thunk<'a>,
    nesting: u32,
    constant: Option<Constant>,
}

impl<'a> TypeSet<'a> {
    /// `None`: see [`TypeInfo::shallow`].
    pub(crate) fn new(param0: Thunk<'a>) -> Option<TypeInfo<'a>> {
        Self::with(param0, None).shallow()
    }

    fn with(param0: Thunk<'a>, constant: Option<Constant>) -> TypeInfo<'a> {
        TypeInfo::Set(Rc::new(TypeSet {
            nesting: param0.nesting() + 1,
            param0,
            constant,
        }))
    }

    fn param_type(&self, index: usize, types: &dyn TypeOf<'a>) -> Option<TypeInfo<'a>> {
        if index == 0 {
            return self.param0.get(types);
        }
        None
    }

    fn iterate_type(&self, types: &dyn TypeOf<'a>) -> Option<TypeInfo<'a>> {
        self.param_type(0, types)
    }

    fn type_names(&self, types: &dyn TypeOf<'a>) -> Vec<Vec<u8>> {
        vec![
            match get_type_name(self.iterate_type(types).as_ref(), types) {
                Some(param0) => generic("Set", &[param0]),
                None => b"Set".to_vec(),
            },
        ]
    }

    fn equals(&self, o: &TypeInfo<'a>, types: &dyn TypeOf<'a>) -> bool {
        let TypeInfo::Set(o) = o else {
            return false;
        };
        is_equals(
            self.iterate_type(types).as_ref(),
            o.iterate_type(types).as_ref(),
            types,
        )
    }
}

/// upstream's `setConstructor`
fn set_constructor<'a>(
    arg_types: &[Option<Thunk<'a>>],
    is_constructor: bool,
    types: &dyn TypeOf<'a>,
) -> Option<TypeInfo<'a>> {
    if !is_constructor {
        return None;
    }
    match class_of(arg_types.first().and_then(Option::as_ref), types) {
        Some(arg) => TypeSet::new(Thunk::IterateType(Some(Rc::new(Thunk::Known(Some(arg)))))),
        None => Some(unknown_set()),
    }
}

pub(crate) struct TypeIterable<'a> {
    param0: Thunk<'a>,
    nesting: u32,
    constant: Option<Constant>,
}

impl<'a> TypeIterable<'a> {
    /// `None`: see [`TypeInfo::shallow`].
    pub(crate) fn new(param0: Thunk<'a>) -> Option<TypeInfo<'a>> {
        Self::with(param0, None).shallow()
    }

    fn with(param0: Thunk<'a>, constant: Option<Constant>) -> TypeInfo<'a> {
        TypeInfo::Iterable(Rc::new(TypeIterable {
            nesting: param0.nesting() + 1,
            param0,
            constant,
        }))
    }

    fn param_type(&self, index: usize, types: &dyn TypeOf<'a>) -> Option<TypeInfo<'a>> {
        if index == 0 {
            return self.param0.get(types);
        }
        None
    }

    fn iterate_type(&self, types: &dyn TypeOf<'a>) -> Option<TypeInfo<'a>> {
        self.param_type(0, types)
    }

    fn type_names(&self, types: &dyn TypeOf<'a>) -> Vec<Vec<u8>> {
        vec![
            match get_type_name(self.iterate_type(types).as_ref(), types) {
                Some(param0) => generic("Iterable", &[param0]),
                None => b"Iterable".to_vec(),
            },
        ]
    }

    fn equals(&self, o: &TypeInfo<'a>, types: &dyn TypeOf<'a>) -> bool {
        let TypeInfo::Iterable(o) = o else {
            return false;
        };
        is_equals(
            self.iterate_type(types).as_ref(),
            o.iterate_type(types).as_ref(),
            types,
        )
    }
}

/// upstream's `FunctionArg`
enum FunctionArg<'a> {
    /// A function of the tables, a `TypeGlobalFunction` among them.
    Proto(Proto),
    /// `() => getType()`
    Returning(Thunk<'a>),
}

pub(crate) struct TypeFunction<'a> {
    function: FunctionArg<'a>,
    nesting: u32,
}

impl<'a> TypeFunction<'a> {
    /// `new TypeFunction(() => getType())`. `None`: see [`TypeInfo::shallow`].
    pub(crate) fn returning(get_type: Thunk<'a>) -> Option<TypeInfo<'a>> {
        TypeInfo::Function(Rc::new(TypeFunction {
            nesting: get_type.nesting() + 1,
            function: FunctionArg::Returning(get_type),
        }))
        .shallow()
    }

    fn constant(&self) -> Option<Constant> {
        match self.function {
            FunctionArg::Proto(proto) => Some(Constant::Function(proto)),
            FunctionArg::Returning(_) => None,
        }
    }

    fn return_type(
        &self,
        this_type: Option<&Thunk<'a>>,
        arg_types: &[Option<Thunk<'a>>],
        is_constructor: bool,
        types: &dyn TypeOf<'a>,
    ) -> Option<TypeInfo<'a>> {
        let proto = match &self.function {
            FunctionArg::Proto(proto) => *proto,
            FunctionArg::Returning(get_type) => return get_type.get(types),
        };
        let first_arg = || arg_types.first()?.as_ref()?.get(types);
        match proto {
            Proto::String
            | Proto::Number
            | Proto::Boolean
            | Proto::Undefined
            | Proto::Global
            | Proto::UnknownFunction => None,
            Proto::ReturnVoid => Some(TypeInfo::Undefined),
            Proto::ReturnString => Some(TypeInfo::String),
            Proto::ReturnNumber => Some(TypeInfo::Number),
            Proto::ReturnBoolean => Some(TypeInfo::Boolean),
            Proto::ReturnUnknownArray => Some(unknown_array()),
            Proto::ReturnStringArray => Some(string_array()),
            Proto::ReturnUnknownObject => Some(unknown_object()),
            Proto::ReturnRegExp => Some(TypeInfo::RegExp),
            Proto::ReturnBigInt => Some(TypeInfo::BigInt),
            Proto::ReturnSelf
            | Proto::ReturnArraySelf
            | Proto::ReturnMapSelf
            | Proto::ReturnSetSelf => this_type?.get(types),
            Proto::ReturnArrayElement => class_of(this_type, types)?.param_type(0, types),
            Proto::ReturnConcat => TypeArray::new(
                std::iter::once(this_type)
                    .chain(arg_types.iter().map(Option::as_ref))
                    .map(|get_type| ArrayItem::Type(Thunk::IterateType(keep(get_type))))
                    .collect(),
                false,
            ),
            Proto::ReturnEntries => {
                TypeIterable::new(Thunk::Entries(Class::Array, keep(this_type)))
            }
            Proto::ReturnKeys => TypeIterable::new(Thunk::Known(Some(TypeInfo::Number))),
            Proto::ReturnValues | Proto::ReturnSetKeys | Proto::ReturnSetValues => {
                TypeIterable::new(Thunk::IterateType(keep(this_type)))
            }
            Proto::ReturnMap => TypeArray::new(
                vec![ArrayItem::Type(Thunk::MapCallback {
                    self_type: keep(this_type),
                    arg_type: keep(arg_types.first().and_then(Option::as_ref)),
                })],
                false,
            ),
            Proto::ReturnMapValue => class_of(this_type, types)?.param_type(1, types),
            Proto::ReturnMapEntries => {
                TypeIterable::new(Thunk::Entries(Class::Map, keep(this_type)))
            }
            Proto::ReturnMapKeys => TypeIterable::new(Thunk::ParamType(keep(this_type), 0)),
            Proto::ReturnMapValues => TypeIterable::new(Thunk::ParamType(keep(this_type), 1)),
            Proto::ReturnSetEntries => {
                TypeIterable::new(Thunk::Entries(Class::Set, keep(this_type)))
            }
            Proto::ReturnArg => first_arg(),
            Proto::ReturnAssign => TypeObject::new(
                arg_types
                    .iter()
                    .rev()
                    .map(Option::as_ref)
                    .chain(std::iter::once(this_type))
                    .flatten()
                    .map(|get_type| ObjectItem::Spread(get_type.clone()))
                    .collect(),
            ),
            Proto::Constructor(Class::StringConstructor) => Some(TypeInfo::String),
            Proto::Constructor(Class::NumberConstructor) => Some(TypeInfo::Number),
            Proto::Constructor(Class::BooleanConstructor) => Some(TypeInfo::Boolean),
            Proto::Constructor(Class::RegExpConstructor) => Some(TypeInfo::RegExp),
            Proto::Constructor(Class::BigIntConstructor) => Some(TypeInfo::BigInt),
            Proto::Constructor(Class::ArrayConstructor) => Some(unknown_array()),
            Proto::Constructor(Class::ObjectConstructor) => {
                Some(first_arg().unwrap_or_else(unknown_object))
            }
            Proto::Constructor(Class::FunctionConstructor) => Some(unknown_function()),
            Proto::Constructor(Class::MapConstructor) => {
                map_constructor(arg_types, is_constructor, types)
            }
            Proto::Constructor(Class::SetConstructor) => {
                set_constructor(arg_types, is_constructor, types)
            }
            Proto::Constructor(_) => None,
        }
    }

    /// With `TypeGlobalFunction.propertyType`.
    fn property_type(&self, name: &[u8]) -> Option<TypeInfo<'a>> {
        let props = match self.function {
            FunctionArg::Proto(Proto::Constructor(class)) => property(class, name),
            _ => None,
        };
        props
            .or_else(|| property(Class::Function, name))
            .map(TypeInfo::from_proto)
    }
}

/// `UNKNOWN_ARRAY`
pub(crate) fn unknown_array<'a>() -> TypeInfo<'a> {
    TypeArray::with(Vec::new(), false, Some(Constant::UnknownArray))
}

/// `STRING_ARRAY`
pub(crate) fn string_array<'a>() -> TypeInfo<'a> {
    let items = vec![ArrayItem::Type(Thunk::Known(Some(TypeInfo::String)))];
    TypeArray::with(items, false, Some(Constant::StringArray))
}

/// `UNKNOWN_OBJECT`
pub(crate) fn unknown_object<'a>() -> TypeInfo<'a> {
    TypeObject::with(Vec::new(), Some(Constant::UnknownObject))
}

/// `UNKNOWN_FUNCTION`
pub(crate) fn unknown_function<'a>() -> TypeInfo<'a> {
    TypeInfo::from_proto(Proto::UnknownFunction)
}

/// `UNKNOWN_MAP`
pub(crate) fn unknown_map<'a>() -> TypeInfo<'a> {
    let constant = Some(Constant::UnknownMap);
    TypeMap::with(Thunk::Known(None), Thunk::Known(None), constant)
}

/// `UNKNOWN_SET`
pub(crate) fn unknown_set<'a>() -> TypeInfo<'a> {
    TypeSet::with(Thunk::Known(None), Some(Constant::UnknownSet))
}

/// `UNKNOWN_ITERABLE`
pub(crate) fn unknown_iterable<'a>() -> TypeInfo<'a> {
    TypeIterable::with(Thunk::Known(None), Some(Constant::UnknownIterable))
}

/// `BI_OPERATOR_TYPES[op]?.(() => [left(), right()])`
pub(crate) fn bi_operator_type<'a>(
    op: BinOp,
    left: &Thunk<'a>,
    right: &Thunk<'a>,
    types: &dyn TypeOf<'a>,
) -> Option<TypeInfo<'a>> {
    let operator = match op {
        BinOp::EqEq
        | BinOp::NotEq
        | BinOp::EqEqEq
        | BinOp::NotEqEq
        | BinOp::Lt
        | BinOp::Le
        | BinOp::Gt
        | BinOp::Ge
        | BinOp::In
        | BinOp::Instanceof => return Some(TypeInfo::Boolean),
        BinOp::Sub
        | BinOp::Mul
        | BinOp::Div
        | BinOp::Rem
        | BinOp::BitXor
        | BinOp::Pow
        | BinOp::BitAnd
        | BinOp::BitOr => Operator::BinaryNum,
        BinOp::Shl | BinOp::Shr | BinOp::UShr => return Some(TypeInfo::Number),
        BinOp::Add => Operator::Plus,
        // No `BinaryExpression`.
        BinOp::And | BinOp::Or | BinOp::Nullish | BinOp::Comma => return None,
    };
    let operands = Box::new([left.get(types), right.get(types)]);
    TypeUnionOrIntersection::build(Generator::Operator(operator, operands), types)
}

/// `UN_OPERATOR_TYPES[op]?.(operand)`
pub(crate) fn un_operator_type<'a>(
    op: UnOp,
    operand: &Thunk<'a>,
    types: &dyn TypeOf<'a>,
) -> Option<TypeInfo<'a>> {
    match op {
        UnOp::Not | UnOp::Delete => Some(TypeInfo::Boolean),
        UnOp::Plus | UnOp::Minus | UnOp::BitNot => {
            let operands = Box::new([operand.get(types), None]);
            TypeUnionOrIntersection::build(Generator::Operator(Operator::UnaryNum, operands), types)
        }
        UnOp::Void => Some(TypeInfo::Undefined),
        UnOp::Typeof => Some(TypeInfo::String),
        // No `UnaryExpression`.
        UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec => None,
    }
}
