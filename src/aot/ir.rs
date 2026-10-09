//! The program as the front end hands it over: layouts, variables, functions in SSA form, every value with its type. What an operation
//! means and how anything is stored is for the compiler behind it. What type anything has is not: it takes the types as they are.

use crate::declared::DeclaredTable;
use crate::id::{BlockId, FuncId, GlobalId, LayoutId, ModuleId, StrId, TyId, V};
use rustc_hash::FxHashMap;
use smallvec::SmallVec;

pub type Args = SmallVec<[V; 4]>;

#[derive(Default)]
pub struct Strs {
    list: Vec<Box<[u8]>>,
    ids: FxHashMap<Box<[u8]>, StrId>,
}

impl Strs {
    pub fn intern(&mut self, bytes: &[u8]) -> StrId {
        if let Some(&id) = self.ids.get(bytes) {
            return id;
        }
        let id = StrId::new(self.list.len());
        self.list.push(bytes.into());
        self.ids.insert(bytes.into(), id);
        id
    }
    pub fn find(&self, bytes: &[u8]) -> Option<StrId> {
        self.ids.get(bytes).copied()
    }
    #[inline]
    pub fn get(&self, id: StrId) -> &[u8] {
        &self.list[id.idx()]
    }
    pub fn len(&self) -> usize {
        self.list.len()
    }
    pub fn is_empty(&self) -> bool {
        self.list.is_empty()
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum LayoutKind {
    /// Of an object type of the program that is no class: an interface, an alias, a type literal, the type of an object literal, what
    /// the parts of a union have in common. Object literals and `new` on what is no class make objects of it, or nothing does and it
    /// only says how objects are looked at.
    Record,
    /// Of a class of the program, every one of which has one: what its objects are made of if the program makes them, and what the
    /// class object and the prototype object are made from.
    Instance,
    /// The captured variables of one activation of a function or a block.
    Environment,
}

pub mod field_flags {
    /// May be absent.
    pub const OPTIONAL: u16 = 1;
    /// The numbers that the program stores under its name are expected to be int32s (`bun_sema::check::expected_int32`). It goes by the
    /// name, like `NEVER_STORED`. It is a prediction, which may be wrong: it is for choosing how the field is kept, so that an int32 takes
    /// little room and anything else still has a place. It takes the whole program to say so: no code that is translated depends on it.
    pub const EXPECTED_INT32: u16 = 1 << 1;
    /// Only stored while the object is made.
    pub const IMMUTABLE: u16 = 1 << 2;
    /// Declared the way a method is: an object of a class has it on its prototype, not among its fields.
    pub const METHOD: u16 = 1 << 3;
    /// Its type is written down: what is stored to it is held to the type as `as` holds it.
    pub const ANNOTATED: u16 = 1 << 4;
    /// A variable in an environment: no read comes before the first store.
    pub const NEVER_SEEN_UNINITIALIZED: u16 = 1 << 5;
    /// A variable in an environment: there is one store, that of its declaration.
    pub const STORED_ONCE: u16 = 1 << 6;
    /// No code of the program stores a property by its name, in whatever object. So no object has it, unless by a computed key, and it
    /// needs no room. It goes by the name: every field of the name has the flag, in every layout but an environment, or none has. It
    /// takes the whole program to say so: no code that is translated depends on it.
    pub const NEVER_STORED: u16 = 1 << 7;
    /// An object of the layout gets it right after its allocation, at every creation point, on every path: `bun_sema::check`, creation.rs. A
    /// prediction, which may be wrong: it is for choosing which fields are kept inline. It takes the whole program to say so: no code
    /// that is translated depends on it.
    pub const SET_AT_CREATION: u16 = 1 << 8;
    /// The same, at some creation point, on some path.
    pub const MAY_BE_SET_AT_CREATION: u16 = 1 << 9;
    /// Of a class: no constructor defines it. The object has no such property until one is stored. Every other field of a class is
    /// defined while the object is constructed, an optional one as `undefined`. A fact.
    pub const ABSENT_AT_BIRTH: u16 = 1 << 10;
    /// Of a required field of a layout that is allocated: between the moment an object has the layout and the first store to the field,
    /// nobody reads the field, asks whether it is there, or gets hold of the object. A FACT, by layout and not by name: the field is kept
    /// without a marker for "absent". It rests on `bun_sema::check`, first_stores.rs: literals and classes have it from the start, a
    /// constructor function stores it first (the operation `Initialize`), and no shape transition adds it. It takes the whole program
    /// to say so: the link sets it, and no code that is translated depends on it.
    pub const NEVER_SEEN_ABSENT: u16 = 1 << 11;
    /// `undefined` is not of the type that is declared for it: `s: string`, `inner: Flat`, and not `x: T | undefined`, `brand: any`, `unknown`, `void`. The type of
    /// the field does not tell: a reference may be nil as it is kept. So an object that is not laid out and lacks the property lacks what
    /// the layout requires. A fact about the declaration, not about what the field holds.
    pub const DECLARED_WITHOUT_UNDEFINED: u16 = 1 << 12;
}

/// In the variable of a static field that is a module variable: the same as `field_flags::ANNOTATED`.
pub const STATIC_FIELD_IS_ANNOTATED: u32 = 1 << 31;

/// A string or a number that a type names.
#[derive(Copy, Clone, PartialEq, Debug)]
pub enum Literal {
    Str(StrId),
    Num(f64),
}

pub struct Field {
    pub name: StrId,
    /// What it holds. `NONE`: anything.
    pub declared: TyId,
    pub flags: u16,
    /// The strings it can hold, if its type names them all, and likewise the numbers: `kind: "a" | "b"`, `code: 1`. `declared` says less.
    /// Plain data that enters a union is made the part whose fields can hold what it has. Nothing else goes by this.
    pub literals: Vec<Literal>,
    /// The type of the property as the checker prints it, cut short if it is long. For messages alone. `NONE`: there is none, as in
    /// every fragment: the link puts it there.
    pub type_text: StrId,
    /// The one function whose closures are stored to it. `NONE`: nothing is known.
    pub only_function: FuncId,
    /// `only_function_flags`
    pub only_function_flags: u8,
}

impl Field {
    pub fn new(name: StrId, declared: TyId, flags: u16) -> Field {
        Field { name, declared, flags, literals: Vec::new(), type_text: StrId::NONE, only_function: FuncId::NONE, only_function_flags: 0 }
    }
}

pub mod only_function_flags {
    /// It holds a closure of the function whenever it is read. Otherwise that is a prediction.
    pub const IS_FACT: u8 = 1;
    /// Of a variable, of a module or in an environment: every store to it is seen, and it holds a closure of the function, `undefined` or
    /// `null` whenever it is read. A fact. Not together with `IS_FACT`.
    pub const OR_NIL: u8 = 1 << 2;
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum MethodKind {
    Method,
    Getter,
    Setter,
}

pub mod method_flags {
    /// Of the class object, not of the prototype.
    pub const STATIC: u8 = 1;
    /// Its name is computed, and the checker says that what comes of that is a symbol.
    pub const KEY_IS_SYMBOL: u8 = 1 << 1;
    /// The program is seen to put something else in its place, in an object or in what the class declares it on. So what an object finds
    /// by the name, where this is the first declaration of it up the classes it is of, is looked for when the program runs. It takes the
    /// whole program to say so: no code that is translated depends on it.
    pub const MAY_BE_REPLACED: u8 = 1 << 2;
}

pub struct Method {
    /// `NONE`: the name is computed.
    pub name: StrId,
    pub func: FuncId,
    pub kind: MethodKind,
    pub flags: u8,
    /// The variable of the class that holds the computed name, as a property key, from the declaration on. `NO_VARIABLE`: the name is
    /// not computed.
    pub key: u32,
}

/// In the place of a variable of a class, see `Layout::environment`.
pub const NO_VARIABLE: u32 = u32::MAX;

pub mod class_flags {
    /// The objects of the class have the layout. Otherwise they are ordinary objects, or what a class makes that is not of the program:
    /// the layout has no fields, nothing is allocated with it, and no type names it.
    pub const IS_LAID_OUT: u32 = 1 << 2;
    /// The declaration is evaluated at most once, so there is one class object.
    pub const IS_EVALUATED_ONCE: u32 = 1 << 3;
    /// It is not laid out and extends something, which makes the object: a class that is not of the program, one that is not laid out,
    /// `null`. What that is, is evaluated at the declaration.
    pub const HAS_FOREIGN_ROOT: u32 = 1 << 4;
    /// Written in TypeScript. The static methods and accessors it declares cannot be replaced, redefined or deleted, the class object
    /// keeps its prototype, and gets no property of its own by the name of a static method or accessor it inherits.
    pub const HAS_FIXED_MEMBERS: u32 = 1 << 5;
    /// It is laid out, and a class that is not extends it. What that class constructs has this layout and the prototype object of that
    /// class, which may have anything by the name of a method.
    pub const MAY_HAVE_OTHER_PROTOTYPE: u32 = 1 << 6;
    /// It declares a static member whose name is computed and may be any string. A field of that kind is in no list of the layout.
    pub const HAS_STATIC_MEMBER_OF_UNKNOWN_NAME: u32 = 1 << 8;
}

pub struct Layout {
    pub kind: LayoutKind,
    pub name: StrId,
    /// Its fields come first in this one: of a class that is laid out, the layout of the class it extends. `NONE`: none.
    pub base: LayoutId,
    /// Those of `base` included.
    pub fields: Vec<Field>,
    /// Of a class, in the order of the declaration: the methods and accessors, also the static ones and those named `#name`.
    pub methods: Vec<Method>,
    /// Of a class: its constructor, which as a closure is the class object. `NONE`: any other layout, and a class whose declaration the
    /// build leaves out.
    pub constructor: FuncId,
    /// Of a class: `class_flags`.
    pub class_flags: u32,
    /// Of a class that is not evaluated once: the layout of the environment the class object closes over. A variable of the class is a
    /// field of that, by its index. `NONE`: a variable of the class is a module variable, by its number.
    pub environment: LayoutId,
    /// Of a class with fixed members: the static fields by name, each with the variable of the class it is. The class object shows them
    /// as properties. `static #name` is not among them. See `STATIC_FIELD_IS_ANNOTATED`.
    pub static_fields: Vec<(StrId, u32)>,
    /// Something makes objects of it: an allocation, or a cast that turns an object into one.
    pub is_allocated: bool,
    /// The program is seen to freeze or seal objects that are looked at as a type this is a member of.
    pub may_be_frozen: bool,
    /// The layout as a way to look at objects: a place of this type may also hold an object that is not laid out, an array, a function,
    /// what the host or a package has made.
    pub admits_foreign: bool,
    /// The layout as a way to look at objects: the allocated layouts whose type is assignable to this type, itself among them if it is
    /// allocated. No other object of the program is in a place of this type. Sorted.
    pub members: Vec<LayoutId>,
    /// What a cast may turn an object into that was allocated with this layout: layouts that have all its fields. Sorted.
    pub specializations: Vec<LayoutId>,
    /// Where the type or the class is declared, for messages: the path, as `Module::display_path` has it, and the line, from 1. `NONE` and
    /// 0: nothing declares it, as in every fragment: the link puts them there.
    pub declared_path: StrId,
    pub declared_line: u32,
}

impl Layout {
    pub fn field(&self, name: StrId) -> Option<u32> {
        self.fields.iter().position(|f| f.name == name).map(|i| i as u32)
    }
}

pub struct Global {
    pub name: StrId,
    pub module: ModuleId,
    pub declared: TyId,
    pub initialization: Initialization,
    /// As `Field::only_function`.
    pub only_function: FuncId,
    pub only_function_flags: u8,
}

/// What a module variable holds before anything is stored to it.
#[derive(Copy, Clone, PartialEq, Eq)]
#[repr(u32)]
pub enum Initialization {
    /// Nothing: it is in its temporal dead zone.
    Uninitialized = 0,
    /// `undefined`, from before any code runs: a `var`, and what the compiler keeps to itself and makes on first use.
    Undefined = 1,
    /// Nothing, and no read comes before the first store: none has to test for that.
    NeverSeen = 2,
    /// The same, and there is one store, that of its declaration: a read yields the same whenever it is made.
    NeverSeenAndStoredOnce = 3,
}

pub struct Module {
    pub path: StrId,
    /// Runs its top-level statements.
    pub init: FuncId,
    /// The path for messages and stack traces: from where the program is built (`Constants::root`), with `/` between the names.
    pub display_path: StrId,
    /// `format::line_table` of its text: from the positions in it to lines and columns.
    pub line_table: Vec<u8>,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum FuncKind {
    Plain,
    Arrow,
    Method,
    /// Of a class. It makes no object: for `this` it is handed the one whoever constructs has made, or `undefined` where what the class
    /// extends makes it. It yields `undefined`, or the object that takes the place of the one it was handed.
    Constructor,
    Module,
}

pub mod func_flags {
    pub const ASYNC: u16 = 1;
    pub const GENERATOR: u16 = 1 << 1;
    /// Used as a value, so it can be called by a caller that does not know it.
    pub const IS_VALUE: u16 = 1 << 2;
    pub const HAS_REST: u16 = 1 << 3;
    /// Its entry block takes `this`, after the environment and before the parameters.
    pub const HAS_THIS: u16 = 1 << 4;
    /// A generator that runs up to its first `yield` when it is called: the front end has put one after the binding of the parameters,
    /// which happens in the call and may throw there.
    pub const STARTS_EAGERLY: u16 = 1 << 5;
    /// Written in TypeScript: the checker has held it to its types.
    pub const IS_TYPED: u16 = 1 << 6;
    /// A constructor whose first parameter is `new.target`. Its `length` does not count that. A plain function: it asks for it, with
    /// `GetNewTarget`, and has no such parameter.
    pub const HAS_NEW_TARGET: u16 = 1 << 7;
    /// Of the prelude: it implements a built-in.
    pub const IS_BUILTIN: u16 = 1 << 8;
    /// Written in a builtin module.
    pub const IS_OF_BUILTIN_MODULE: u16 = 1 << 9;
    /// Its frames only exist because of how the code is compiled. Stack traces leave them out.
    pub const IS_HIDDEN_IN_STACK_TRACES: u16 = 1 << 10;
}

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum BinOp {
    Add,
    Sub,
    Mul,
    Div,
    Mod,
    Exp,
    BitAnd,
    BitOr,
    BitXor,
    Shl,
    Shr,
    UShr,
}

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum UnOp {
    Neg,
    /// `+x`
    ToNumber,
    /// What `++` and `--` convert with.
    ToNumeric,
    BitNot,
}

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum RelOp {
    Lt,
    Le,
    Gt,
    Ge,
}

/// Why a value is held to a type. One that does not fit is turned into one that does if the source names the type, with `as` or the
/// annotation of the place that the value enters, and it can be done. Otherwise a TypeError is thrown, but by `as`.
#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum Why {
    /// It enters a place whose type nobody has written down.
    Store,
    /// What enters a place whose type is written down: `const a: T = x`, a parameter, a result, a field. Plain data is made what the type
    /// says, and an object that was made as less and has what is missing becomes one of the type where it is.
    Cast,
    /// `x!` asserts: neither `undefined` nor `null`, and the type has neither. The text of `x`, for the message. `NONE`: it is long, or
    /// more than a name and properties of it.
    NonNull(StrId),
    /// It comes from where nothing vouches for it: an element, what a call by someone who does not know the function came back with,
    /// `await`, `yield`, `catch`.
    Claim,
    /// The checker has narrowed the type of the expression: by a test, a type predicate, an assignment.
    Flow,
    /// It is of the type already, and is looked at as that from here on. Nothing is tested and nothing is done.
    Upcast,
    /// `x as T`, `<T>x` coerce, as `ToObject` does. A primitive is converted as the language converts to the primitives of `T`. With an
    /// object it does what `Cast` does, and an object that nothing can be done with stays what it is. So what it yields need not be a
    /// `T`: `to` is `T`, and the type of the value is what is known of it afterwards.
    Coerce,
}

#[derive(Clone, PartialEq, Eq, Hash, Debug)]
pub enum Op {
    Undefined,
    Null,
    Bool(bool),
    Int(i64),
    Double(u64),
    Str(StrId),
    BigInt(StrId),
    /// A function that captures nothing, as a value.
    FuncRef(FuncId),

    GlobalGet(GlobalId),
    GlobalSet(GlobalId, V),
    /// A variable that no declaration of the program binds.
    FreeGet { name: StrId, is_typeof: bool },
    FreeSet { name: StrId, value: V },

    /// An object of a shape, with nothing stored in it yet.
    New(LayoutId),
    /// The same, with its discriminant: whoever initializes it stores `value` to the property `name` before anybody else sees it, and no
    /// code of the program stores to the property by its name after that. See `Checker::discriminant_of_new` and
    /// `Checker::discriminant_of_object_literal` for what is not ruled out. What the object is made as may go by the value.
    NewWith { layout: LayoutId, name: StrId, value: V },
    /// Of an environment only. What the language sees as an object is read by name.
    FieldGet { obj: V, layout: LayoutId, field: u32 },
    /// Of an environment, or of an object right after its `New`, before anything else has got hold of it. Any other store is by name.
    FieldSet { obj: V, layout: LayoutId, field: u32, value: V },
    /// A new function object. `captures`: as the entry block of `func` takes them. Of the constructor of a class that is not evaluated
    /// once, the class object: the environment of the class, whether or not the constructor takes it.
    Closure { func: FuncId, captures: Args },
    /// The closure of a function declaration, made the first time it is asked for and kept in the field of the environment. The field holds
    /// `undefined` until then, and nothing else reads it or stores to it.
    ClosureOnce { func: FuncId, captures: Args, env: V, field: u32 },

    PropGet { obj: V, name: StrId },
    PropSet { obj: V, name: StrId, value: V },
    PropHas { obj: V, name: StrId },
    PropDelete { obj: V, name: StrId },
    ElemGet { obj: V, key: V },
    ElemSet { obj: V, key: V, value: V },
    ElemHas { obj: V, key: V },
    ElemDelete { obj: V, key: V },

    NewArray(Args),
    NewObject,

    Binary { op: BinOp, a: V, b: V },
    Unary { op: UnOp, a: V },
    Relational { op: RelOp, a: V, b: V },
    StrictEq { a: V, b: V },
    LooseEq { a: V, b: V },
    Not(V),
    Truthy(V),
    TypeOf(V),
    InstanceOf { value: V, of: V },
    ToStr(V),
    ToKey(V),
    IsNullish(V),
    /// Made by the class of this layout or by a class that extends it. The class is laid out and evaluated once.
    IsInstance { value: V, layout: LayoutId },
    /// The strings, joined.
    StrConcat(Args),

    /// What `for of` steps through.
    IterOpen(V),
    /// Advances. `index` counts the steps so far. False at the end.
    IterHas { iter: V, index: V },
    /// What the last step yielded.
    IterGet { iter: V, index: V },
    /// On leaving the loop early.
    IterClose(V),
    /// IteratorClose with a throw completion: what `return` does or throws is ignored.
    IterCloseForThrow(V),

    Call { callee: V, this: V, args: Args },
    Construct { callee: V, args: Args },
    CallMethod { obj: V, name: StrId, args: Args },
    /// `args` as the entry block of `func` takes them.
    CallDirect { func: FuncId, args: Args },

    /// The value, held to a type.
    Coerce { value: V, to: TyId, why: Why },
    /// The exception being handled. First in a handler.
    Caught,
    /// Once around a loop.
    Poll,
    /// What the language does without having syntax for it, by the name the compiler behind the front end knows it by.
    Operation { name: StrId, args: Args },
    /// `yield value`: a suspension point of a generator. Its result is the value the generator is resumed with, whatever the mode.
    Yield(V),
    /// How the generator was last resumed: 0 by `next`, 1 by `throw`, 2 by `return`.
    ResumeMode,
    /// The namespace object of a module that is not compiled with the program, by its specifier.
    ExternalModule(StrId),
    /// `await value`: a suspension point of an async function. The engine splits the function there.
    Await(V),
}

#[derive(Clone, PartialEq, Debug)]
pub struct Target {
    pub block: BlockId,
    pub args: Args,
}

impl Target {
    pub fn new(block: BlockId) -> Target {
        Target { block, args: Args::new() }
    }
}

#[derive(Clone, PartialEq, Debug)]
pub enum Term {
    Jump(Target),
    Branch { cond: V, then: Target, otherwise: Target },
    Switch { value: V, cases: Vec<(i64, Target)>, default: Target },
    Return(V),
    /// `unwind`: the handler in this function.
    Throw { value: V, unwind: Option<Target> },
    /// The last operation of the block may throw: control goes to `unwind` then.
    Invoke { normal: Target, unwind: Target },
    Unreachable,
}

#[derive(Clone, Debug)]
pub enum Def {
    Param(BlockId, u32),
    Op(Op),
}

/// What a value probably is, where its type says less: what the checker infers and the program is not held to. Nothing relies on it. The
/// engine tests for it, does what it does best for such a value, and does the general thing for any other.
#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug, Default)]
pub enum Prediction {
    #[default]
    None,
    /// Of the type.
    Ty(TyId),
    /// A closure of the function.
    Closure(FuncId),
    /// Of what is read under a key from the dictionary that is held under the property of this name: a closure of the function that `Program::functions_by_key` has for the name and the
    /// key, once the key is known for a constant.
    ByKey(StrId),
    /// Of the type that the view it is read through gives the property. Only until the link: where the view takes no foreign object that is a
    /// fact, and becomes the type of the value. Where it does, it becomes a `Ty`.
    Field(TyId),
}

#[derive(Clone, Debug)]
pub struct Value {
    pub def: Def,
    /// Offset in the source of the module. 0: none.
    pub pos: u32,
    /// What it is.
    pub ty: TyId,
    pub prediction: Prediction,
}

#[derive(Default, Clone)]
pub struct Block {
    pub params: Vec<V>,
    pub ops: Vec<V>,
    pub term: Option<Term>,
}

pub struct Func {
    pub name: StrId,
    pub module: ModuleId,
    pub pos: u32,
    pub kind: FuncKind,
    pub flags: u16,
    /// Its `length` property: the parameters before the first one with an initializer or the rest parameter.
    pub length: u16,
    /// What it is handed ahead of `this` and its arguments: the type of each capture. An environment, or a copy of a variable that nothing
    /// stores to once an inner function can have seen it.
    pub captures: Vec<TyId>,
    /// The checker's type of `this` in it: for a method, an object of its class. `NONE`: it says nothing.
    pub this_declared: TyId,
    /// The checker's type of each parameter. `NONE`: it says nothing.
    pub params: Vec<TyId>,
    /// By parameter: its type is written down, so an argument is held to it as by `as`. Where this ends, none is.
    pub annotated: Vec<bool>,
    /// The checker's type of what a call yields: of an async function the promise, of a generator the generator. `NONE`: it says nothing.
    pub result: TyId,
    pub blocks: Vec<Block>,
    pub values: Vec<Value>,
}

impl Func {
    pub const ENTRY: BlockId = BlockId(0);

    #[inline]
    pub fn op(&self, v: V) -> Option<&Op> {
        match &self.values[v.idx()].def {
            Def::Op(op) => Some(op),
            Def::Param(..) => None,
        }
    }
    pub fn has(&self, flag: u16) -> bool {
        self.flags & flag != 0
    }
    /// Why an argument for the parameter is held to its type.
    pub fn why_of_param(&self, index: usize) -> Why {
        if self.annotated.get(index) == Some(&true) { Why::Cast } else { Why::Store }
    }
    #[inline]
    pub fn ty(&self, v: V) -> TyId {
        self.values[v.idx()].ty
    }
    #[inline]
    pub fn prediction(&self, v: V) -> Prediction {
        self.values[v.idx()].prediction
    }
    pub fn add_block(&mut self) -> BlockId {
        self.blocks.push(Block::default());
        BlockId::new(self.blocks.len() - 1)
    }
    pub fn add_param(&mut self, block: BlockId, ty: TyId) -> V {
        let index = self.blocks[block.idx()].params.len() as u32;
        let v = V::new(self.values.len());
        self.values.push(Value { def: Def::Param(block, index), pos: 0, ty, prediction: Prediction::None });
        self.blocks[block.idx()].params.push(v);
        v
    }
    pub fn add_value(&mut self, op: Op, pos: u32, ty: TyId) -> V {
        let v = V::new(self.values.len());
        self.values.push(Value { def: Def::Op(op), pos, ty, prediction: Prediction::None });
        v
    }
    pub fn append(&mut self, block: BlockId, op: Op, pos: u32, ty: TyId) -> V {
        let v = self.add_value(op, pos, ty);
        self.blocks[block.idx()].ops.push(v);
        v
    }
}

impl Op {
    /// Every value that the operation takes. `NONE` is passed too.
    pub fn for_each_operand(&self, mut f: impl FnMut(V)) {
        match self {
            Op::Undefined
            | Op::Null
            | Op::Bool(_)
            | Op::Int(_)
            | Op::Double(_)
            | Op::Str(_)
            | Op::BigInt(_)
            | Op::FuncRef(_)
            | Op::GlobalGet(_)
            | Op::FreeGet { .. }
            | Op::New(_)
            | Op::NewObject
            | Op::Caught
            | Op::Poll
            | Op::ResumeMode
            | Op::ExternalModule(_) => {}
            Op::GlobalSet(_, a)
            | Op::FreeSet { value: a, .. }
            | Op::NewWith { value: a, .. }
            | Op::Coerce { value: a, .. }
            | Op::IsInstance { value: a, .. }
            | Op::FieldGet { obj: a, .. }
            | Op::PropGet { obj: a, .. }
            | Op::PropHas { obj: a, .. }
            | Op::PropDelete { obj: a, .. }
            | Op::Unary { a, .. }
            | Op::Not(a)
            | Op::Truthy(a)
            | Op::TypeOf(a)
            | Op::ToStr(a)
            | Op::ToKey(a)
            | Op::IsNullish(a)
            | Op::IterOpen(a)
            | Op::IterClose(a)
            | Op::IterCloseForThrow(a)
            | Op::Yield(a)
            | Op::Await(a) => f(*a),
            Op::FieldSet { obj: a, value: b, .. }
            | Op::PropSet { obj: a, value: b, .. }
            | Op::ElemGet { obj: a, key: b }
            | Op::ElemHas { obj: a, key: b }
            | Op::ElemDelete { obj: a, key: b }
            | Op::Binary { a, b, .. }
            | Op::Relational { a, b, .. }
            | Op::StrictEq { a, b }
            | Op::LooseEq { a, b }
            | Op::InstanceOf { value: a, of: b }
            | Op::IterHas { iter: a, index: b }
            | Op::IterGet { iter: a, index: b } => {
                f(*a);
                f(*b);
            }
            Op::ElemSet { obj, key, value } => {
                f(*obj);
                f(*key);
                f(*value);
            }
            Op::Closure { captures: args, .. } | Op::NewArray(args) | Op::StrConcat(args) | Op::Operation { args, .. } | Op::CallDirect { args, .. } => args.iter().copied().for_each(f),
            Op::ClosureOnce { captures, env, .. } => {
                captures.iter().copied().for_each(&mut f);
                f(*env);
            }
            Op::Call { callee, this, args } => {
                f(*callee);
                f(*this);
                args.iter().copied().for_each(f);
            }
            Op::Construct { callee: a, args } | Op::CallMethod { obj: a, args, .. } => {
                f(*a);
                args.iter().copied().for_each(f);
            }
        }
    }
}

impl Term {
    /// Every value that it takes or passes on. `NONE` is passed too.
    pub fn for_each_operand(&self, mut f: impl FnMut(V)) {
        match self {
            Term::Branch { cond: value, .. } | Term::Switch { value, .. } | Term::Return(value) | Term::Throw { value, .. } => f(*value),
            Term::Jump(_) | Term::Invoke { .. } | Term::Unreachable => {}
        }
        self.for_each_target(|target| target.args.iter().copied().for_each(&mut f));
    }

    pub fn for_each_target(&self, mut f: impl FnMut(&Target)) {
        match self {
            Term::Return(_) | Term::Unreachable => {}
            Term::Throw { unwind, .. } => {
                if let Some(t) = unwind {
                    f(t);
                }
            }
            Term::Jump(t) => f(t),
            Term::Branch { then, otherwise, .. } => {
                f(then);
                f(otherwise);
            }
            Term::Switch { cases, default, .. } => {
                for (_, t) in cases {
                    f(t);
                }
                f(default);
            }
            Term::Invoke { normal, unwind } => {
                f(normal);
                f(unwind);
            }
        }
    }
    pub fn for_each_target_mut(&mut self, mut f: impl FnMut(&mut Target)) {
        match self {
            Term::Return(_) | Term::Unreachable => {}
            Term::Throw { unwind, .. } => {
                if let Some(t) = unwind {
                    f(t);
                }
            }
            Term::Jump(t) => f(t),
            Term::Branch { then, otherwise, .. } => {
                f(then);
                f(otherwise);
            }
            Term::Switch { cases, default, .. } => {
                for (_, t) in cases {
                    f(t);
                }
                f(default);
            }
            Term::Invoke { normal, unwind } => {
                f(normal);
                f(unwind);
            }
        }
    }
}

#[derive(Default)]
pub struct Program {
    pub strs: Strs,
    pub tys: DeclaredTable,
    pub layouts: Vec<Layout>,
    pub funcs: Vec<Func>,
    pub globals: Vec<Global>,
    pub modules: Vec<Module>,
    /// By name: the classes of the engine that a class of the program extends, going by the checker's type of what stands after
    /// `extends`, and `console` if the program does anything with it but read and call its properties. Sorted.
    pub extended_globals: Vec<StrId>,
    /// The names that the modules of the program define on an object written as `E.prototype` (`Checker::prototype_property_names_in`).
    /// The run time lets no other name of a field be defined on the `prototype` object of a function. Sorted.
    pub prototype_property_names: Vec<StrId>,
    /// By registry id, ascending: the function that evaluates a builtin module and returns its value.
    pub builtin_modules: Vec<(u32, FuncId)>,
    /// By id, ascending: a builtin function of the runtime that is compiled with the program, and its `ImplementationVisibility` as a number.
    pub builtin_functions: Vec<(u32, FuncId, u32)>,
    /// A property, a key, and the one function of the program whose closures are stored under the key in the dictionaries that are held under the property: `e.on("x", listener)`. Ascending.
    /// A prediction.
    pub functions_by_key: Vec<(StrId, StrId, FuncId)>,
    /// Runs the program.
    /// What is run first, by entry point, in their order. The first is that of the executable itself. One of them is run in an instance of the program, once.
    pub entries: Vec<FuncId>,
}

impl Default for FuncId {
    fn default() -> FuncId {
        FuncId::NONE
    }
}
