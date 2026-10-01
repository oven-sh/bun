//! The syntax a file's summary keeps: declarations, type syntax, and the bodies of functions as lazy expressions.
//!
//! The parser fills a [`File`] while it still has the source; nothing here is resolved. Nodes live in per-kind vectors and
//! name each other by index, so a file is a handful of allocations, can be built on any thread, and is immutable
//! from then on. Positions are byte offsets into the source.

use crate::atom::Atom;
use std::marker::PhantomData;

macro_rules! define_id {
    ($($name:ident),* $(,)?) => {$(
        #[derive(Copy, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Debug)]
        pub struct $name(pub u32);
        impl $name {
            pub const NONE: $name = $name(u32::MAX);
            #[inline]
            pub fn is_none(self) -> bool { self.0 == u32::MAX }
            #[inline]
            pub fn is_some(self) -> bool { self.0 != u32::MAX }
            #[inline]
            pub fn idx(self) -> usize { self.0 as usize }
            #[inline]
            pub fn some(self) -> Option<$name> { if self.is_none() { None } else { Some(self) } }
        }
        impl From<u32> for $name { #[inline] fn from(v: u32) -> Self { $name(v) } }
        impl From<$name> for u32 { #[inline] fn from(v: $name) -> u32 { v.0 } }
    )*};
}

define_id!(
    ExprId,
    StmtId,
    TypeNodeId,
    PatId,
    FnId,
    ClassId,
    InterfaceId,
    AliasId,
    EnumId,
    ModuleId,
    MemberId,
    PropId,
    ParamId,
    TypeParamId,
    VarDeclId,
    CallId,
    ImportId,
    ExportId,
    JsxId,
    CaseId,
    EnumMemberId,
    PatPropId,
    PatElemId,
    ImportSpecId,
    ExportSpecId,
    TupleElemId,
    MappedId,
    ImportEqualsId,
);

impl From<Atom> for u32 {
    #[inline]
    fn from(v: Atom) -> u32 {
        v.0
    }
}
impl From<u32> for Atom {
    #[inline]
    fn from(v: u32) -> Atom {
        Atom(v)
    }
}

/// Ids that are not next to each other: a run of [`File::ids`].
pub struct IdList<T> {
    pub start: u32,
    pub len: u32,
    _of: PhantomData<T>,
}

/// Nodes that are next to each other in their vector.
pub struct Span<T> {
    pub start: u32,
    pub len: u32,
    _of: PhantomData<T>,
}

macro_rules! impl_run {
    ($name:ident) => {
        impl<T> Copy for $name<T> {}
        impl<T> Clone for $name<T> {
            #[inline]
            fn clone(&self) -> Self {
                *self
            }
        }
        impl<T> Default for $name<T> {
            #[inline]
            fn default() -> Self {
                Self::EMPTY
            }
        }
        impl<T> std::fmt::Debug for $name<T> {
            fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                write!(f, "{}..+{}", self.start, self.len)
            }
        }
        impl<T> $name<T> {
            pub const EMPTY: Self = Self {
                start: 0,
                len: 0,
                _of: PhantomData,
            };
            #[inline]
            pub fn new(start: u32, len: u32) -> Self {
                Self {
                    start,
                    len,
                    _of: PhantomData,
                }
            }
            #[inline]
            pub fn is_empty(self) -> bool {
                self.len == 0
            }
            #[inline]
            pub fn len(self) -> usize {
                self.len as usize
            }
            #[inline]
            pub fn range(self) -> std::ops::Range<usize> {
                self.start as usize..(self.start + self.len) as usize
            }
        }
    };
}
impl_run!(IdList);
impl_run!(Span);

impl<T: From<u32>> Span<T> {
    #[inline]
    pub fn iter(self) -> impl DoubleEndedIterator<Item = T> + ExactSizeIterator + Clone {
        (self.start..self.start + self.len).map(T::from)
    }
    #[inline]
    pub fn at(self, i: usize) -> T {
        debug_assert!(i < self.len());
        T::from(self.start + i as u32)
    }
}

bitflags::bitflags! {
    /// Modifiers, on whatever they can be written on.
    #[derive(Copy, Clone, PartialEq, Eq, Debug, Default)]
    pub struct Flags: u32 {
        const EXPORT = 1 << 0;
        const DEFAULT = 1 << 1;
        /// `declare`, or inside something that is, or in a declaration file.
        const AMBIENT = 1 << 2;
        const ABSTRACT = 1 << 3;
        const ASYNC = 1 << 4;
        const GENERATOR = 1 << 5;
        const STATIC = 1 << 6;
        const READONLY = 1 << 7;
        const OPTIONAL = 1 << 8;
        const PRIVATE = 1 << 9;
        const PROTECTED = 1 << 10;
        const PUBLIC = 1 << 11;
        const OVERRIDE = 1 << 12;
        const ACCESSOR = 1 << 13;
        /// `const enum`, `<const T>`.
        const CONST = 1 << 14;
        const REST = 1 << 15;
        /// `x!: T`
        const DEFINITE = 1 << 16;
        const TYPE_ONLY = 1 << 17;
        const IN = 1 << 18;
        const OUT = 1 << 19;
        /// A parameter that also declares a property of the class.
        const PARAMETER_PROPERTY = 1 << 20;
        /// A member whose name is written as a string or a number: `"a": T`, `0: T`.
        const LITERAL_NAME = 1 << 21;
        /// A function whose body was written where none belongs (`declare function f() { .. }`) and is not kept: `body` is `None` all the same.
        const BODY_DROPPED = 1 << 22;
        /// A member whose name is written as a string: `"0": T`, `["0"]: T`.
        const STRING_NAME = 1 << 23;
        /// A function whose `{` is missing. tsgo gives it a zero-width block (`NodeIsMissing(body)`, but `body != nil`): `body` is
        /// `None` here, it returns `any` and is no implementation, yet no missing implementation is reported (2391, 2390).
        const MISSING_BODY = 1 << 24;
        /// `NodeFlagsReparsed`: a declaration, or the `?` of a parameter, that is made from a tag of a JSDoc comment in JavaScript.
        const REPARSED = 1 << 25;
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Chain {
    No,
    /// `a?.b`
    Start,
    /// The `.c` of `a?.b.c`
    Continue,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum UnOp {
    Plus,
    Minus,
    BitNot,
    Not,
    Typeof,
    Void,
    Delete,
    PreInc,
    PreDec,
    PostInc,
    PostDec,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum BinOp {
    Add,
    Sub,
    Mul,
    Div,
    Rem,
    Pow,
    Shl,
    Shr,
    UShr,
    BitAnd,
    BitOr,
    BitXor,
    Lt,
    Le,
    Gt,
    Ge,
    EqEq,
    NotEq,
    EqEqEq,
    NotEqEq,
    In,
    Instanceof,
    And,
    Or,
    Nullish,
    Comma,
}

#[derive(Copy, Clone, Debug)]
pub struct Expr {
    pub kind: ExprKind,
    pub pos: u32,
}

#[derive(Copy, Clone, Debug)]
pub enum ExprKind {
    Missing,
    Ident(Atom),
    This,
    Super,
    Null,
    True,
    False,
    /// An index into [`File::numbers`].
    Number(u32),
    String(Atom),
    BigInt(Atom),
    Regex,
    /// The substitutions; `texts` has one more element than there are of them.
    Template {
        exprs: IdList<ExprId>,
        texts: IdList<Atom>,
    },
    /// The tag is the callee, what is substituted the arguments.
    TaggedTemplate(CallId),
    /// Holes are `Missing`.
    Array(IdList<ExprId>),
    Object(Span<PropId>),
    Fn(FnId),
    Class(ClassId),
    /// `name` starts with `#` for a private name.
    Dot {
        obj: ExprId,
        name: Atom,
        name_pos: u32,
        chain: Chain,
    },
    Index {
        obj: ExprId,
        index: ExprId,
        chain: Chain,
    },
    Call(CallId),
    New(CallId),
    Unary {
        op: UnOp,
        operand: ExprId,
    },
    Binary {
        op: BinOp,
        left: ExprId,
        right: ExprId,
    },
    /// `op` is `None` for plain `=`.
    Assign {
        op: Option<BinOp>,
        target: ExprId,
        value: ExprId,
    },
    Cond {
        test: ExprId,
        yes: ExprId,
        no: ExprId,
    },
    Spread(ExprId),
    Await(ExprId),
    Yield {
        value: ExprId,
        star: bool,
    },
    As {
        expr: ExprId,
        ty: TypeNodeId,
    },
    Satisfies {
        expr: ExprId,
        ty: TypeNodeId,
    },
    AsConst(ExprId),
    NonNull(ExprId),
    /// `f<T>` that is not called.
    Instantiation {
        expr: ExprId,
        type_args: IdList<TypeNodeId>,
    },
    Jsx(JsxId),
    ImportCall(ExprId),
    ImportMeta,
    NewTarget,
}

/// Which kind of expression, without what is in it.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum ExprTag {
    Missing,
    Ident,
    This,
    Super,
    Null,
    True,
    False,
    Number,
    String,
    BigInt,
    Regex,
    Template,
    TaggedTemplate,
    Array,
    Object,
    Fn,
    Class,
    Dot,
    Index,
    Call,
    New,
    Unary,
    Binary,
    Assign,
    Cond,
    Spread,
    Await,
    Yield,
    As,
    Satisfies,
    AsConst,
    NonNull,
    Instantiation,
    Jsx,
    ImportCall,
    ImportMeta,
    NewTarget,
}

impl ExprTag {
    pub const COUNT: usize = 37;
}

impl ExprKind {
    #[inline]
    pub fn tag(&self) -> ExprTag {
        match self {
            ExprKind::Missing => ExprTag::Missing,
            ExprKind::Ident(..) => ExprTag::Ident,
            ExprKind::This => ExprTag::This,
            ExprKind::Super => ExprTag::Super,
            ExprKind::Null => ExprTag::Null,
            ExprKind::True => ExprTag::True,
            ExprKind::False => ExprTag::False,
            ExprKind::Number(..) => ExprTag::Number,
            ExprKind::String(..) => ExprTag::String,
            ExprKind::BigInt(..) => ExprTag::BigInt,
            ExprKind::Regex => ExprTag::Regex,
            ExprKind::Template { .. } => ExprTag::Template,
            ExprKind::TaggedTemplate(..) => ExprTag::TaggedTemplate,
            ExprKind::Array(..) => ExprTag::Array,
            ExprKind::Object(..) => ExprTag::Object,
            ExprKind::Fn(..) => ExprTag::Fn,
            ExprKind::Class(..) => ExprTag::Class,
            ExprKind::Dot { .. } => ExprTag::Dot,
            ExprKind::Index { .. } => ExprTag::Index,
            ExprKind::Call(..) => ExprTag::Call,
            ExprKind::New(..) => ExprTag::New,
            ExprKind::Unary { .. } => ExprTag::Unary,
            ExprKind::Binary { .. } => ExprTag::Binary,
            ExprKind::Assign { .. } => ExprTag::Assign,
            ExprKind::Cond { .. } => ExprTag::Cond,
            ExprKind::Spread(..) => ExprTag::Spread,
            ExprKind::Await(..) => ExprTag::Await,
            ExprKind::Yield { .. } => ExprTag::Yield,
            ExprKind::As { .. } => ExprTag::As,
            ExprKind::Satisfies { .. } => ExprTag::Satisfies,
            ExprKind::AsConst(..) => ExprTag::AsConst,
            ExprKind::NonNull(..) => ExprTag::NonNull,
            ExprKind::Instantiation { .. } => ExprTag::Instantiation,
            ExprKind::Jsx(..) => ExprTag::Jsx,
            ExprKind::ImportCall(..) => ExprTag::ImportCall,
            ExprKind::ImportMeta => ExprTag::ImportMeta,
            ExprKind::NewTarget => ExprTag::NewTarget,
        }
    }
}

/// The expressions of a file, kind by kind. Those of one kind are in the order they have in the file's list.
pub struct ExprsByKind {
    ids: Vec<ExprId>,
    starts: [u32; ExprTag::COUNT + 1],
}

impl ExprsByKind {
    pub fn new(file: &File) -> ExprsByKind {
        let mut starts = [0u32; ExprTag::COUNT + 1];
        for e in &file.exprs {
            starts[e.kind.tag() as usize + 1] += 1;
        }
        for i in 0..ExprTag::COUNT {
            starts[i + 1] += starts[i];
        }
        let mut next = starts;
        let mut ids = vec![ExprId::NONE; file.exprs.len()];
        for (i, e) in file.exprs.iter().enumerate() {
            let at = &mut next[e.kind.tag() as usize];
            ids[*at as usize] = ExprId(i as u32);
            *at += 1;
        }
        ExprsByKind { ids, starts }
    }

    #[inline]
    pub fn of(&self, tag: ExprTag) -> &[ExprId] {
        &self.ids[self.starts[tag as usize] as usize..self.starts[tag as usize + 1] as usize]
    }
}

#[derive(Copy, Clone, Debug)]
pub struct Call {
    pub callee: ExprId,
    pub args: IdList<ExprId>,
    pub type_args: IdList<TypeNodeId>,
    /// Where the `)` is. `u32::MAX` for `new C`. A tagged template has `u32::MAX` or [`INCOMPLETE_TEMPLATE`].
    pub close_pos: u32,
    pub chain: Chain,
}

/// [`Call::close_pos`] of a tagged template whose last piece of text is missing or unterminated (`callIsIncomplete`).
pub const INCOMPLETE_TEMPLATE: u32 = u32::MAX - 1;

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum PropKey {
    None,
    /// An identifier, a string, or a number in the spelling `String(n)` gives it. `["a"]` and `[0]` as well.
    Name(Atom),
    Private(Atom),
    /// `[e]`, unless `e` is a string or a number by itself. `IsDynamicName`: `[("a")]` and `["a" as T]` are worked out. `[-1]` is
    /// kept like this too, though it is not.
    Computed(ExprId),
}

impl PropKey {
    #[inline]
    pub fn name(self) -> Option<Atom> {
        match self {
            PropKey::Name(a) | PropKey::Private(a) => Some(a),
            _ => None,
        }
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum PropKind {
    Init,
    Shorthand,
    Spread,
    Method,
    Getter,
    Setter,
}

/// A property of an object literal, or an attribute of a JSX element.
#[derive(Copy, Clone, Debug)]
pub struct Prop {
    pub kind: PropKind,
    pub key: PropKey,
    pub value: ExprId,
    pub pos: u32,
}

#[derive(Copy, Clone, Debug)]
pub struct Jsx {
    /// The name in the opening tag. `NONE` for a fragment. An intrinsic element's is a `String`.
    pub tag: ExprId,
    /// The name in `</tag>`, an expression of its own. `NONE` for `<tag />`, a fragment, a missing closing tag, and an intrinsic
    /// name that repeats the opening one. After a syntax error the two names may differ.
    pub close_tag: ExprId,
    pub attrs: Span<PropId>,
    pub children: IdList<ExprId>,
    pub type_args: IdList<TypeNodeId>,
    /// Where `</tag>` starts. `u32::MAX` for `<tag />`.
    pub close_pos: u32,
}

#[derive(Copy, Clone, Debug)]
pub struct Pat {
    pub kind: PatKind,
    pub pos: u32,
}

#[derive(Copy, Clone, Debug)]
pub enum PatKind {
    Missing,
    Ident(Atom),
    Object(Span<PatPropId>),
    Array(Span<PatElemId>),
}

#[derive(Copy, Clone, Debug)]
pub struct PatProp {
    pub key: PropKey,
    pub value: PatId,
    pub default: ExprId,
    pub is_rest: bool,
    /// Where the name of the property is.
    pub pos: u32,
}

#[derive(Copy, Clone, Debug)]
pub struct PatElem {
    /// `Missing` for a hole.
    pub pat: PatId,
    pub default: ExprId,
    pub is_rest: bool,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum VarKind {
    Var,
    Let,
    Const,
    Using,
    AwaitUsing,
}

#[derive(Copy, Clone, Debug)]
pub struct VarDecl {
    pub pat: PatId,
    pub ty: TypeNodeId,
    pub init: ExprId,
    pub kind: VarKind,
    pub flags: Flags,
}

#[derive(Copy, Clone, Debug)]
pub struct Stmt {
    pub kind: StmtKind,
    pub pos: u32,
}

#[derive(Copy, Clone, Debug)]
pub enum StmtKind {
    Empty,
    Expr(ExprId),
    Var(Span<VarDeclId>),
    Fn(FnId),
    Class(ClassId),
    Interface(InterfaceId),
    TypeAlias(AliasId),
    Enum(EnumId),
    Module(ModuleId),
    Return(ExprId),
    If {
        test: ExprId,
        yes: StmtId,
        no: StmtId,
    },
    For {
        init: StmtId,
        test: ExprId,
        update: ExprId,
        body: StmtId,
    },
    /// `left` is a `Var` with one declaration, or an `Expr`.
    ForIn {
        left: StmtId,
        expr: ExprId,
        body: StmtId,
    },
    ForOf {
        left: StmtId,
        expr: ExprId,
        body: StmtId,
        is_await: bool,
    },
    While {
        test: ExprId,
        body: StmtId,
    },
    DoWhile {
        body: StmtId,
        test: ExprId,
    },
    Block(IdList<StmtId>),
    Switch {
        expr: ExprId,
        cases: Span<CaseId>,
    },
    /// `param` has no initializer.
    Try {
        block: StmtId,
        param: VarDeclId,
        handler: StmtId,
        finalizer: StmtId,
    },
    Throw(ExprId),
    Break(Atom),
    Continue(Atom),
    Labeled {
        label: Atom,
        body: StmtId,
    },
    Import(ImportId),
    ImportEquals(ImportEqualsId),
    /// `export { a as b }`, with or without `from`.
    ExportNamed(ExportId),
    /// `export * from spec`, `export * as alias from spec`, and the same after `export type`
    ExportStar {
        spec: Atom,
        alias: Atom,
        type_only: bool,
        mode: ResolutionMode,
    },
    ExportDefault(ExprId),
    /// `export = e`
    ExportAssign(ExprId),
    ExportAsNamespace(Atom),
}

#[derive(Copy, Clone, Debug)]
pub struct Case {
    /// `NONE` for `default`.
    pub test: ExprId,
    pub body: IdList<StmtId>,
    pub pos: u32,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum FnKind {
    Decl,
    Expr,
    Arrow,
    Method,
    Getter,
    Setter,
    Constructor,
    StaticBlock,
    /// The rest have no body, ever: members of interfaces and type literals, and function types.
    CallSignature,
    ConstructSignature,
    FunctionType,
    ConstructorType,
    IndexSignature,
}

#[derive(Copy, Clone, Debug)]
pub enum FnBody {
    None,
    Block(IdList<StmtId>),
    Expr(ExprId),
}

/// Anything with parameters and a return type.
#[derive(Copy, Clone, Debug)]
pub struct Func {
    pub kind: FnKind,
    pub flags: Flags,
    pub name: Atom,
    pub name_pos: u32,
    pub type_params: Span<TypeParamId>,
    pub params: Span<ParamId>,
    /// The type of a leading `this` parameter.
    pub this_ty: TypeNodeId,
    pub ret: TypeNodeId,
    pub body: FnBody,
    /// The `(` of the parameters; the `=>` of an arrow function.
    pub anchor: u32,
    pub pos: u32,
}

#[derive(Copy, Clone, Debug)]
pub struct Param {
    pub pat: PatId,
    pub ty: TypeNodeId,
    pub default: ExprId,
    pub flags: Flags,
    /// Where it starts, modifiers and `...` included.
    pub pos: u32,
}

#[derive(Copy, Clone, Debug)]
pub struct TypeParam {
    pub name: Atom,
    pub pos: u32,
    pub constraint: TypeNodeId,
    pub default: TypeNodeId,
    pub flags: Flags,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum MemberKind {
    Property,
    Method,
    Getter,
    Setter,
    Constructor,
    CallSignature,
    ConstructSignature,
    IndexSignature,
    StaticBlock,
}

/// A member of a class, an interface or a type literal.
#[derive(Copy, Clone, Debug)]
pub struct Member {
    pub kind: MemberKind,
    pub key: PropKey,
    pub flags: Flags,
    pub ty: TypeNodeId,
    pub init: ExprId,
    pub func: FnId,
    pub pos: u32,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum DecoratorOwner {
    Class(ClassId),
    Member(MemberId),
    Param(ParamId),
}

#[derive(Copy, Clone, Debug)]
pub struct Class {
    pub name: Atom,
    pub name_pos: u32,
    pub flags: Flags,
    pub type_params: Span<TypeParamId>,
    pub extends: ExprId,
    pub extends_args: IdList<TypeNodeId>,
    pub implements: IdList<TypeNodeId>,
    pub members: Span<MemberId>,
    pub pos: u32,
}

#[derive(Copy, Clone, Debug)]
pub struct Interface {
    pub name: Atom,
    pub name_pos: u32,
    pub flags: Flags,
    pub type_params: Span<TypeParamId>,
    pub extends: IdList<TypeNodeId>,
    pub members: Span<MemberId>,
}

#[derive(Copy, Clone, Debug)]
pub struct Alias {
    pub name: Atom,
    pub name_pos: u32,
    pub flags: Flags,
    pub type_params: Span<TypeParamId>,
    pub ty: TypeNodeId,
}

#[derive(Copy, Clone, Debug)]
pub struct Enum {
    pub name: Atom,
    pub name_pos: u32,
    pub flags: Flags,
    pub members: Span<EnumMemberId>,
}

#[derive(Copy, Clone, Debug)]
pub struct EnumMember {
    pub name: Atom,
    pub init: ExprId,
    pub pos: u32,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum ModuleName {
    /// `namespace N`
    Ident(Atom),
    /// `declare module "m"`
    String(Atom),
    /// `declare global`
    Global,
}

#[derive(Copy, Clone, Debug)]
pub struct Module {
    pub name: ModuleName,
    pub name_pos: u32,
    pub flags: Flags,
    pub body: IdList<StmtId>,
    /// `declare module "m";` has none.
    pub has_body: bool,
}

/// `core.ResolutionMode`. `None`: not said; it goes by the file and the syntax.
#[derive(Copy, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Debug, Default)]
pub enum ResolutionMode {
    #[default]
    None,
    Import,
    Require,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum SpecifierKind {
    /// `import x from "m"`, `export x from "m"`, `import("m").T`
    Import,
    /// `import x = require("m")`
    Require,
    /// `import "m"`
    SideEffect,
}

#[derive(Copy, Clone, Debug)]
pub struct SpecifierUse {
    pub spec: Atom,
    pub pos: u32,
    pub kind: SpecifierKind,
    /// `getModeForUsageLocation`: what `resolution-mode` says, where that counts: after `import type` and `export type`, and in
    /// `import("m", { with: { .. } })` the type.
    pub mode: ResolutionMode,
}

#[derive(Copy, Clone, Debug)]
pub struct Import {
    pub spec: Atom,
    pub default: Atom,
    pub default_pos: u32,
    pub namespace: Atom,
    pub namespace_pos: u32,
    pub named: Span<ImportSpecId>,
    pub type_only: bool,
    /// As in [`SpecifierUse`].
    pub mode: ResolutionMode,
}

#[derive(Copy, Clone, Debug)]
pub struct ImportSpec {
    pub imported: Atom,
    pub local: Atom,
    /// Where `local` is.
    pub pos: u32,
    pub type_only: bool,
    pub imported_pos: u32,
}

#[derive(Copy, Clone, Debug)]
pub enum ImportEqualsTarget {
    Require(Atom),
    Entity(IdList<Atom>),
}

#[derive(Copy, Clone, Debug)]
pub struct ImportEquals {
    pub name: Atom,
    pub name_pos: u32,
    pub target: ImportEqualsTarget,
    pub flags: Flags,
}

#[derive(Copy, Clone, Debug)]
pub struct Export {
    /// `NONE` without `from`.
    pub spec: Atom,
    pub items: Span<ExportSpecId>,
    pub type_only: bool,
    /// As in [`SpecifierUse`].
    pub mode: ResolutionMode,
}

#[derive(Copy, Clone, Debug)]
pub struct ExportSpec {
    pub local: Atom,
    pub exported: Atom,
    /// Where `exported` is.
    pub pos: u32,
    pub type_only: bool,
    pub local_pos: u32,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Keyword {
    Any,
    Unknown,
    Never,
    Void,
    Undefined,
    Null,
    String,
    Number,
    Boolean,
    BigInt,
    Symbol,
    Object,
    This,
    Intrinsic,
}

#[derive(Copy, Clone, Debug)]
pub struct TypeNode {
    pub kind: TypeNodeKind,
    pub pos: u32,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum MappedModifier {
    None,
    Add,
    Remove,
}

#[derive(Copy, Clone, Debug)]
pub struct Mapped {
    pub param: TypeParamId,
    pub name_ty: TypeNodeId,
    pub ty: TypeNodeId,
    pub readonly: MappedModifier,
    pub optional: MappedModifier,
}

#[derive(Copy, Clone, Debug)]
pub struct TupleElem {
    pub ty: TypeNodeId,
    pub name: Atom,
    pub optional: bool,
    pub rest: bool,
}

#[derive(Copy, Clone, Debug)]
pub enum TypeNodeKind {
    /// Syntax the type parser gave up on.
    Error,
    Keyword(Keyword),
    /// `A.B.C<Args>`
    Ref {
        name: IdList<Atom>,
        args: IdList<TypeNodeId>,
    },
    StringLit(Atom),
    /// An index into [`File::numbers`].
    NumberLit(u32),
    BigIntLit {
        text: Atom,
        negative: bool,
    },
    BoolLit(bool),
    Template {
        types: IdList<TypeNodeId>,
        texts: IdList<Atom>,
    },
    Array(TypeNodeId),
    Tuple(Span<TupleElemId>),
    Union(IdList<TypeNodeId>),
    Intersection(IdList<TypeNodeId>),
    Fn(FnId),
    Object(Span<MemberId>),
    Cond {
        check: TypeNodeId,
        extends: TypeNodeId,
        yes: TypeNodeId,
        no: TypeNodeId,
    },
    Infer(TypeParamId),
    Mapped(MappedId),
    IndexedAccess {
        obj: TypeNodeId,
        index: TypeNodeId,
    },
    Keyof(TypeNodeId),
    Readonly(TypeNodeId),
    UniqueSymbol,
    /// `typeof a.b.c<Args>`
    /// `expr` is `name` as an expression: what it is where it is written depends on the tests made on the way there.
    Typeof {
        name: IdList<Atom>,
        args: IdList<TypeNodeId>,
        expr: ExprId,
    },
    /// `import("spec").A.B<Args>`, `typeof import("spec")`
    Import {
        spec: Atom,
        name: IdList<Atom>,
        args: IdList<TypeNodeId>,
        is_typeof: bool,
        mode: ResolutionMode,
    },
    /// `x is T`, `asserts x`, `asserts x is T`, `this is T`. `param` is `this` for the last.
    Predicate {
        param: Atom,
        ty: TypeNodeId,
        asserts: bool,
    },
}

/// What a JSDoc `@type` tag gives a type to, where the tree has no place for one.
#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
pub enum JsDocTypeOwner {
    /// `FullSignature`: the type is that of the function as a whole.
    Fn(FnId),
    /// A property of an object literal: `name: value`, or `name` by itself.
    Prop(PropId),
    /// An assignment that declares something (`GetAssignmentDeclarationKind`).
    Assign(ExprId),
    /// `export default e`, `export = e`
    Export(StmtId),
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum ReferenceKind {
    Path,
    Types,
    Lib,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug, Default)]
pub enum FileKind {
    #[default]
    Ts,
    Tsx,
    /// `.d.ts`, `.d.mts`, `.d.cts`, `.d.*.ts`
    Declaration,
    Json,
}

/// `/* @jsxRuntime classic */`, `/* @jsx h */`, `/* @jsxImportSource preact */`
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub struct JsxPragmas {
    /// `Some(true)`: classic. `Some(false)`: automatic.
    pub classic: Option<bool>,
    pub factory: Atom,
    /// `@jsxFrag`
    pub fragment_factory: Atom,
    pub import_source: Atom,
}

impl Default for JsxPragmas {
    fn default() -> Self {
        JsxPragmas {
            classic: None,
            factory: Atom::NONE,
            fragment_factory: Atom::NONE,
            import_source: Atom::NONE,
        }
    }
}

impl JsxPragmas {
    /// `getCommentPragmas`, `extractPragmas`: what the `/* */` comments before the first token of `text` say. Of two that say the
    /// same thing the last counts (`GetPragmaFromSourceFile`).
    pub fn scan(text: &[u8], atoms: &crate::atom::Interner) -> JsxPragmas {
        let mut pragmas = JsxPragmas::default();
        let is_blank = |c: &u8| matches!(c, b' ' | b'\t');
        let is_line_break = |c: &u8| matches!(c, b'\n' | b'\r');
        let mut rest = text;
        if rest.starts_with(b"#!") {
            rest = &rest[rest.iter().position(is_line_break).unwrap_or(rest.len())..];
        }
        loop {
            rest = rest.trim_ascii_start();
            if rest.starts_with(b"//") {
                rest = &rest[rest.iter().position(is_line_break).unwrap_or(rest.len())..];
                continue;
            }
            if !rest.starts_with(b"/*") {
                break;
            }
            let end = rest[2..]
                .windows(2)
                .position(|w| w == b"*/")
                .map_or(rest.len(), |at| at + 2);
            let comment = &rest[2..end];
            rest = &rest[(end + 2).min(rest.len())..];
            for line in comment.split(is_line_break) {
                // Of a line, the first `@name` counts, and the word after it.
                let Some(at) = line
                    .windows(2)
                    .position(|w| w[0] == b'@' && !is_blank(&w[1]))
                else {
                    continue;
                };
                let mut words = line[at + 1..].split(is_blank).filter(|w| !w.is_empty());
                let (Some(name), Some(argument)) = (words.next(), words.next()) else {
                    continue;
                };
                if name.eq_ignore_ascii_case(b"jsx") {
                    pragmas.factory = atoms.intern(argument);
                } else if name.eq_ignore_ascii_case(b"jsxFrag") {
                    pragmas.fragment_factory = atoms.intern(argument);
                } else if name.eq_ignore_ascii_case(b"jsxImportSource") {
                    pragmas.import_source = atoms.intern(argument);
                } else if name.eq_ignore_ascii_case(b"jsxRuntime") {
                    // `GetJSXImplicitImportBase`
                    pragmas.classic = match argument {
                        b"classic" => Some(true),
                        b"automatic" => Some(false),
                        _ => None,
                    };
                }
            }
        }
        pragmas
    }
}

/// What the parser hands over for one source file.
#[derive(Default)]
pub struct File {
    pub kind: FileKind,
    /// `.js`, `.jsx`, `.mjs`, `.cjs`. Parsed like `.tsx`: what only TypeScript can say is taken in, and objected to afterwards.
    pub is_js: bool,
    /// `// @ts-check` (true) or `// @ts-nocheck` among the comments at the top. The last one counts.
    pub check_directive: Option<bool>,
    /// A module though nothing in it says so: by its extension, or because the options make one of every file. Such a file can
    /// still be a CommonJS module.
    pub is_module_by_decree: bool,
    /// Has a top-level `import` or `export`.
    pub has_module_syntax: bool,
    /// The parser could not make sense of the file; whatever is here is partial.
    pub has_errors: bool,
    /// `@d`: what is decorated, and the expression. In the order they are written.
    pub decorators: Vec<(DecoratorOwner, ExprId)>,
    /// `experimentalDecorators`
    pub legacy_decorators: bool,
    /// What the parser objected to and went on from, the tree being whole: where, and the code it goes by.
    pub early_errors: Vec<(u32, u32)>,
    /// `hasParseDiagnostics`: the parser or the scanner reported an error. `grammarErrorOnNode` and the binder's checks of
    /// reserved names then report nothing.
    pub has_parse_diagnostics: bool,
    /// Errors about syntax that tsgo reports with a plain `c.error`, so parse errors do not silence them: start and code.
    pub checker_errors: Vec<(u32, u32)>,
    /// Pieces of type syntax that were given up on.
    pub syntax_errors: u32,
    /// Where the first of either was noticed.
    pub error_pos: u32,
    pub source_len: u32,
    /// What the file says, byte for byte: every position in here is an offset into it. For what is only a matter of how something
    /// is written (which modifier, where a token is), and to show where an error is. Empty for the default library.
    /// Whoever read the file keeps it or hands it over (`Host::read`): it is not copied.
    pub text: std::borrow::Cow<'static, [u8]>,
    pub body: IdList<StmtId>,
    /// `/// <reference ... />`. The last is what `resolution-mode=` says, of a `types` reference only.
    pub references: Vec<(ReferenceKind, Atom, u32, ResolutionMode)>,
    /// The lines `// @ts-ignore` and `// @ts-expect-error` are about: from where to where. In order.
    pub suppressed: Vec<(u32, u32)>,
    /// The statement of each `with (e) statement`, from right after the `)` to where it ends.
    pub with_bodies: Vec<(u32, u32)>,
    /// The start of each token that follows a token the parser skipped in a list (`abortParsingListOrMoveToNextToken`). Sorted.
    pub after_skipped: Vec<u32>,
    /// The decorators of missing declarations and of `this` parameters, which `checkDecorators` never looks at: from where the
    /// expression starts to where what comes after the decorators starts. The expressions are statements of their own.
    pub stray_decorators: Vec<(u32, u32)>,
    /// Where module specifiers are written, but for those of `import()`, which are expressions.
    pub specifier_uses: Vec<SpecifierUse>,
    /// The specifier of an `import()` that has a second argument, and that argument.
    pub import_options: Vec<(ExprId, ExprId)>,
    /// The specifier of each `import.defer(..)`, and where the `)` of the call is.
    pub deferred_import_calls: Vec<(ExprId, u32)>,
    /// `with { .. }` of imports and exports: the start of `with`, and the attributes as an `ExprKind::Object`.
    pub import_attributes: Vec<(u32, ExprId)>,
    /// The expressions written in parentheses, in order, and where the parentheses open. Nothing else is kept of them.
    pub parens: Vec<(ExprId, u32)>,
    /// What comments at the top say about JSX in this file.
    pub jsx_pragmas: JsxPragmas,
    /// The JSDoc comments of a JavaScript file, from where to where. Sorted. A node whose position is in one is made from a tag.
    pub jsdoc_comments: Vec<(u32, u32)>,
    /// `JSDocDiagnostics`: what the parser objects to in the JSDoc comments that belong to a node, start and code. Only reported if
    /// the file is checked (`IsCheckJSEnabledForFile`), and no parse diagnostics as far as `hasParseDiagnostics` goes.
    pub jsdoc_errors: Vec<(u32, u32)>,
    /// The types of `@type` tags on what has no place for a type. Sorted by owner.
    pub jsdoc_types: Vec<(JsDocTypeOwner, TypeNodeId)>,
    /// `@public`, `@private`, `@protected`, `@readonly` and `@override` on an assignment: the assignment and the modifiers. Sorted.
    pub jsdoc_modifiers: Vec<(ExprId, Flags)>,
    /// `checkUnmatchedJSDocParameters`, as far as the syntax tells: the function, where the name in the `@param` tag is, and the
    /// code. 8024 and 8032 hold unless the function refers to `arguments`, 8029 holds if it does.
    pub jsdoc_param_errors: Vec<(FnId, u32, u32)>,

    pub ids: Vec<u32>,
    pub numbers: Vec<f64>,
    pub exprs: Vec<Expr>,
    pub stmts: Vec<Stmt>,
    pub types: Vec<TypeNode>,
    pub pats: Vec<Pat>,
    pub pat_props: Vec<PatProp>,
    pub pat_elems: Vec<PatElem>,
    pub fns: Vec<Func>,
    pub params: Vec<Param>,
    pub type_params: Vec<TypeParam>,
    pub classes: Vec<Class>,
    pub interfaces: Vec<Interface>,
    pub aliases: Vec<Alias>,
    pub enums: Vec<Enum>,
    pub enum_members: Vec<EnumMember>,
    pub modules: Vec<Module>,
    pub members: Vec<Member>,
    pub props: Vec<Prop>,
    pub var_decls: Vec<VarDecl>,
    pub calls: Vec<Call>,
    pub cases: Vec<Case>,
    pub jsx: Vec<Jsx>,
    pub imports: Vec<Import>,
    pub import_specs: Vec<ImportSpec>,
    pub import_equals: Vec<ImportEquals>,
    pub exports: Vec<Export>,
    pub export_specs: Vec<ExportSpec>,
    pub tuple_elems: Vec<TupleElem>,
    pub mapped: Vec<Mapped>,
}

macro_rules! arenas {
    ($($field:ident: $node:ident => $id:ident, $add:ident, $add_all:ident;)*) => {
        impl File {
            $(
                #[inline]
                pub fn $add(&mut self, node: $node) -> $id {
                    let id = $id(self.$field.len() as u32);
                    self.$field.push(node);
                    id
                }
                /// Nodes that have to be next to each other are collected first and added together.
                #[inline]
                pub fn $add_all(&mut self, nodes: &[$node]) -> Span<$id> {
                    let start = self.$field.len() as u32;
                    self.$field.extend_from_slice(nodes);
                    Span::new(start, nodes.len() as u32)
                }
            )*
        }
        $(
            impl std::ops::Index<$id> for File {
                type Output = $node;
                #[inline]
                fn index(&self, id: $id) -> &$node {
                    &self.$field[id.idx()]
                }
            }
            impl std::ops::IndexMut<$id> for File {
                #[inline]
                fn index_mut(&mut self, id: $id) -> &mut $node {
                    &mut self.$field[id.idx()]
                }
            }
        )*
    };
}

arenas! {
    exprs: Expr => ExprId, add_expr_node, add_expr_nodes;
    stmts: Stmt => StmtId, add_stmt_node, add_stmt_nodes;
    types: TypeNode => TypeNodeId, add_type_node, add_type_nodes;
    pats: Pat => PatId, add_pat_node, add_pat_nodes;
    pat_props: PatProp => PatPropId, add_pat_prop, add_pat_props;
    pat_elems: PatElem => PatElemId, add_pat_elem, add_pat_elems;
    fns: Func => FnId, add_fn, add_fns;
    params: Param => ParamId, add_param, add_params;
    type_params: TypeParam => TypeParamId, add_type_param, add_type_params;
    classes: Class => ClassId, add_class, add_classes;
    interfaces: Interface => InterfaceId, add_interface, add_interfaces;
    aliases: Alias => AliasId, add_alias, add_aliases;
    enums: Enum => EnumId, add_enum, add_enums;
    enum_members: EnumMember => EnumMemberId, add_enum_member, add_enum_members;
    modules: Module => ModuleId, add_module, add_modules;
    members: Member => MemberId, add_member, add_members;
    props: Prop => PropId, add_prop, add_props;
    var_decls: VarDecl => VarDeclId, add_var_decl, add_var_decls;
    calls: Call => CallId, add_call, add_calls;
    cases: Case => CaseId, add_case, add_cases;
    jsx: Jsx => JsxId, add_jsx, add_jsxs;
    imports: Import => ImportId, add_import, add_imports;
    import_specs: ImportSpec => ImportSpecId, add_import_spec, add_import_specs;
    import_equals: ImportEquals => ImportEqualsId, add_import_equals, add_import_equalses;
    exports: Export => ExportId, add_export, add_exports;
    export_specs: ExportSpec => ExportSpecId, add_export_spec, add_export_specs;
    tuple_elems: TupleElem => TupleElemId, add_tuple_elem, add_tuple_elems;
    mapped: Mapped => MappedId, add_mapped, add_mappeds;
}

impl File {
    #[inline]
    pub fn expr(&mut self, kind: ExprKind, pos: u32) -> ExprId {
        self.add_expr_node(Expr { kind, pos })
    }
    #[inline]
    pub fn stmt(&mut self, kind: StmtKind, pos: u32) -> StmtId {
        self.add_stmt_node(Stmt { kind, pos })
    }
    #[inline]
    pub fn ty(&mut self, kind: TypeNodeKind, pos: u32) -> TypeNodeId {
        self.add_type_node(TypeNode { kind, pos })
    }
    #[inline]
    pub fn pat(&mut self, kind: PatKind, pos: u32) -> PatId {
        self.add_pat_node(Pat { kind, pos })
    }
    pub fn number(&mut self, value: f64) -> u32 {
        self.numbers.push(value);
        self.numbers.len() as u32 - 1
    }

    /// `NodeFlagsInWithStatement`, of what is written at `pos`.
    pub fn is_in_with(&self, pos: u32) -> bool {
        self.with_bodies
            .iter()
            .any(|&(start, end)| (start..end).contains(&pos))
    }

    /// `NodeFlagsJSDoc`, `NodeFlagsReparsed`, of what is written at `pos`: it is in a JSDoc comment of a JavaScript file.
    pub fn is_in_jsdoc(&self, pos: u32) -> bool {
        let after = self.jsdoc_comments.partition_point(|c| c.0 <= pos);
        after > 0 && pos < self.jsdoc_comments[after - 1].1
    }

    /// The type a `@type` tag gives `owner`. `NONE` if there is none.
    pub fn jsdoc_type(&self, owner: JsDocTypeOwner) -> TypeNodeId {
        match self.jsdoc_types.binary_search_by_key(&owner, |t| t.0) {
            Ok(index) => self.jsdoc_types[index].1,
            Err(_) => TypeNodeId::NONE,
        }
    }

    /// The modifiers JSDoc tags give the assignment `e`.
    pub fn jsdoc_modifiers_of(&self, e: ExprId) -> Flags {
        match self.jsdoc_modifiers.binary_search_by_key(&e, |m| m.0) {
            Ok(index) => self.jsdoc_modifiers[index].1,
            Err(_) => Flags::empty(),
        }
    }

    pub fn list<T: Copy + Into<u32>>(&mut self, items: &[T]) -> IdList<T> {
        let start = self.ids.len() as u32;
        self.ids.extend(items.iter().map(|&i| i.into()));
        IdList::new(start, items.len() as u32)
    }

    #[inline]
    pub fn ids<T: From<u32>>(
        &self,
        list: IdList<T>,
    ) -> impl DoubleEndedIterator<Item = T> + ExactSizeIterator + Clone + '_ {
        self.ids[list.range()].iter().map(|&i| T::from(i))
    }

    #[inline]
    pub fn id_at<T: From<u32>>(&self, list: IdList<T>, i: usize) -> T {
        debug_assert!(i < list.len());
        T::from(self.ids[list.start as usize + i])
    }

    /// Bytes held, for reporting.
    pub fn heap_size(&self) -> usize {
        macro_rules! sum {
            ($($f:ident),*) => { 0 $(+ self.$f.capacity() * std::mem::size_of_val(&self.$f[..]).checked_div(self.$f.len()).unwrap_or(0))* };
        }
        sum!(
            ids,
            numbers,
            exprs,
            stmts,
            types,
            pats,
            pat_props,
            pat_elems,
            fns,
            params,
            type_params,
            classes,
            interfaces,
            aliases,
            enums,
            enum_members,
            modules,
            members,
            props,
            var_decls,
            calls,
            cases,
            jsx,
            imports,
            import_specs,
            import_equals,
            exports,
            export_specs,
            tuple_elems,
            mapped
        )
    }

    pub fn shrink_to_fit(&mut self) {
        macro_rules! each {
            ($($f:ident),*) => { $(self.$f.shrink_to_fit();)* };
        }
        each!(
            ids,
            numbers,
            exprs,
            stmts,
            types,
            pats,
            pat_props,
            pat_elems,
            fns,
            params,
            type_params,
            classes,
            interfaces,
            aliases,
            enums,
            enum_members,
            modules,
            members,
            props,
            var_decls,
            calls,
            cases,
            jsx,
            imports,
            import_specs,
            import_equals,
            exports,
            export_specs,
            tuple_elems,
            mapped,
            references,
            parens,
            with_bodies,
            import_options,
            deferred_import_calls,
            import_attributes,
            checker_errors,
            after_skipped,
            stray_decorators,
            jsdoc_comments,
            jsdoc_errors,
            jsdoc_types,
            jsdoc_modifiers,
            jsdoc_param_errors
        );
    }
}

const _: () = assert!(std::mem::size_of::<Expr>() <= 24);
const _: () = assert!(std::mem::size_of::<TypeNode>() <= 28);
