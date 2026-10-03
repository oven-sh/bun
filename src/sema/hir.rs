//! The syntax a file's summary keeps: declarations, type syntax, and the bodies of functions as lazy expressions.
//!
//! The parser fills a [`File`] while it still has the source; nothing here is resolved. Nodes live in per-kind vectors and
//! name each other by index, so a file is a handful of allocations, can be built on any thread, and is immutable
//! from then on. Positions are byte offsets into the source.

use crate::atom::Atom;
pub use crate::node::{Kind, Node, NodeBases, NodeData, Part, Places, ToNode};
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
    ModifierId,
    NameId,
    ParenId,
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

/// `core.TextRange`, the `Loc` of a node.
#[derive(Copy, Clone, PartialEq, Eq, Default, Debug)]
pub struct TextRange {
    /// `node.Pos()`: where the token before the node ends.
    pub pos: u32,
    /// `node.End()`: where the last token of the node ends.
    pub end: u32,
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

/// A list most files have nothing in. It takes one word, not three, until something is put in. Otherwise it is a `Vec`.
pub struct Few<T>(
    #[expect(
        clippy::box_collection,
        reason = "one word, not three: a file has 66 of these, nearly all empty; as `Vec`s they are 42 MB more on 40,000 files"
    )]
    Option<Box<Vec<T>>>,
);

impl<T: 'static> Few<T> {
    const NOTHING: &'static Vec<T> = &Vec::new();

    /// Leaves it no room it does not use. The allocator does not make a block smaller that is half used: what is in it has to move.
    pub fn shrink_to_fit(&mut self) {
        if self.is_empty() {
            self.0 = None;
        } else if let Some(list) = &mut self.0
            && list.capacity() > list.len()
        {
            let mut exact = Vec::with_capacity(list.len());
            exact.append(list);
            **list = exact;
        }
    }

    /// What is in it, to be put in order. Through `DerefMut` that would make the box of a list that is empty.
    pub fn as_mut_slice(&mut self) -> &mut [T] {
        match &mut self.0 {
            Some(list) => list.as_mut_slice(),
            None => &mut [],
        }
    }
}

impl<T> Default for Few<T> {
    #[inline]
    fn default() -> Self {
        Few(None)
    }
}

impl<T: Clone> Clone for Few<T> {
    fn clone(&self) -> Self {
        Few(self.0.clone())
    }
}

impl<T: 'static> std::ops::Deref for Few<T> {
    type Target = Vec<T>;
    #[inline]
    fn deref(&self) -> &Vec<T> {
        match &self.0 {
            Some(list) => &**list,
            None => Self::NOTHING,
        }
    }
}

impl<T: 'static> std::ops::DerefMut for Few<T> {
    #[inline]
    fn deref_mut(&mut self) -> &mut Vec<T> {
        &mut **self.0.get_or_insert_with(Box::default)
    }
}

impl<T> From<Vec<T>> for Few<T> {
    fn from(list: Vec<T>) -> Self {
        Few((!list.is_empty()).then(|| Box::new(list)))
    }
}

impl<T> FromIterator<T> for Few<T> {
    fn from_iter<I: IntoIterator<Item = T>>(items: I) -> Self {
        Vec::from_iter(items).into()
    }
}

impl<T> IntoIterator for Few<T> {
    type Item = T;
    type IntoIter = std::vec::IntoIter<T>;
    fn into_iter(self) -> Self::IntoIter {
        self.0.map_or_else(Vec::new, |list| *list).into_iter()
    }
}

impl<'a, T: 'static> IntoIterator for &'a Few<T> {
    type Item = &'a T;
    type IntoIter = std::slice::Iter<'a, T>;
    #[inline]
    fn into_iter(self) -> Self::IntoIter {
        self.iter()
    }
}

impl<T: std::fmt::Debug + 'static> std::fmt::Debug for Few<T> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        std::fmt::Debug::fmt(&**self, f)
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
        /// A member whose name is written as a string: `"0": T`, `["0"]: T`.
        const STRING_NAME = 1 << 23;
        /// A function whose `{` is missing. tsgo gives it a zero-width block (`NodeIsMissing(body)`, but `body != nil`): `body` is
        /// `None` here, it returns `any` and is no implementation, yet no missing implementation is reported (2391, 2390).
        const MISSING_BODY = 1 << 24;
        /// `NodeFlagsReparsed`: a declaration, or the `?` of a parameter, that is made from a tag of a JSDoc comment in JavaScript.
        const REPARSED = 1 << 25;
        /// A member whose name is written in brackets.
        const COMPUTED_NAME = 1 << 26;
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
    /// `node.End()`, not counting parentheses around it.
    pub end: u32,
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
    /// The substitutions. The texts between them, one more than there are of them, come right after them in [`File::ids`]:
    /// [`File::template_texts`].
    Template {
        exprs: IdList<ExprId>,
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
    /// `import(specifier, ..)`. `args` is never empty: the first is the specifier, a missing expression if there is none.
    /// Type arguments are an error (1326): [`File::type_args_of_import_call`].
    ImportCall {
        args: IdList<ExprId>,
    },
    ImportMeta,
    /// `new.target`, and the name as it is written: any word makes a meta property.
    NewTarget(Atom),
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
            ExprKind::ImportCall { .. } => ExprTag::ImportCall,
            ExprKind::ImportMeta => ExprTag::ImportMeta,
            ExprKind::NewTarget(_) => ExprTag::NewTarget,
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
    /// `TaggedTemplateExpression.Template`. Its substitutions are `args`.
    pub template: ExprId,
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

/// How a name is written that `PropKey::Name` has the text of.
#[derive(Copy, Clone, PartialEq, Eq, Debug, Default)]
pub enum NameKind {
    #[default]
    Identifier,
    StringLiteral,
    NumericLiteral,
    /// `["a"]`
    ComputedString,
    /// `[0]`
    ComputedNumber,
    /// Of a JSX attribute: `a`, `a-b`, `a:b`. A spread attribute has it too.
    Jsx,
}

/// A property of an object literal, or an attribute of a JSX element.
#[derive(Copy, Clone, Debug)]
pub struct Prop {
    pub kind: PropKind,
    pub key: PropKey,
    pub name_kind: NameKind,
    pub value: ExprId,
    pub pos: u32,
    /// Where its first token is: a modifier, `get`, `set`, `*`, `...`, or `pos`.
    pub start: u32,
    /// `node.End()`. 0 where the parser did not say.
    pub end: u32,
    /// Where `PostfixToken` is, the `?` or the `!` after the name. 0: there is none.
    pub postfix_token: u32,
}

/// `IsIntrinsicJsxName`
pub fn is_intrinsic_jsx_name(name: &[u8]) -> bool {
    name.first().is_some_and(u8::is_ascii_lowercase) || name.contains(&b'-')
}

#[derive(Copy, Clone, Debug)]
pub struct Jsx {
    /// `TagName` of the opening element. `NONE` for a fragment. What is no identifier to the rest of the language is a `String`:
    /// `a-b`, `a:b`.
    pub tag: ExprId,
    /// `TagName` of the `JsxClosingElement`. `NONE` for `<tag />` and for a fragment. A missing expression where the name or the
    /// whole tag is missed. After a syntax error the two names may differ.
    pub close_tag: ExprId,
    pub attrs: Span<PropId>,
    pub children: IdList<ExprId>,
    pub type_args: IdList<TypeNodeId>,
    /// `End()` of the `JsxOpeningElement`, the `JsxOpeningFragment` or the `JsxSelfClosingElement`.
    pub opening_end: u32,
    /// Where `</tag>` starts, or is missed. `u32::MAX` for `<tag />`.
    pub close_pos: u32,
    /// `End()` of the element or fragment.
    pub end: u32,
}

#[derive(Copy, Clone, Debug)]
pub struct Pat {
    pub kind: PatKind,
    pub pos: u32,
    /// `node.End()`
    pub end: u32,
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
    pub name_kind: NameKind,
    pub value: PatId,
    pub default: ExprId,
    pub is_rest: bool,
    /// Where its first token is: the name of the property, or the `...`.
    pub pos: u32,
    /// Where the name of the property is. After `...` a name is an error (2566).
    pub key_pos: u32,
    /// `node.End()`
    pub end: u32,
}

#[derive(Copy, Clone, Debug)]
pub struct PatElem {
    /// `Missing` for a hole.
    pub pat: PatId,
    pub default: ExprId,
    pub is_rest: bool,
    /// Where its first token is: the `...`, or `pat`.
    pub start: u32,
    /// `node.End()`
    pub end: u32,
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
    pub loc: TextRange,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum ModifierKind {
    /// Exactly one flag (`ModifierToFlag`).
    Keyword(Flags),
    Decorator(ExprId),
}

/// `scanner.TokenToString(modifier.Kind)`
pub fn modifier_text(modifier: Flags) -> &'static str {
    const TEXTS: [(Flags, &str); 15] = [
        (Flags::ABSTRACT, "abstract"),
        (Flags::ACCESSOR, "accessor"),
        (Flags::ASYNC, "async"),
        (Flags::CONST, "const"),
        (Flags::AMBIENT, "declare"),
        (Flags::DEFAULT, "default"),
        (Flags::EXPORT, "export"),
        (Flags::IN, "in"),
        (Flags::OUT, "out"),
        (Flags::OVERRIDE, "override"),
        (Flags::PRIVATE, "private"),
        (Flags::PROTECTED, "protected"),
        (Flags::PUBLIC, "public"),
        (Flags::READONLY, "readonly"),
        (Flags::STATIC, "static"),
    ];
    TEXTS
        .iter()
        .find(|text| text.0 == modifier)
        .map_or("", |text| text.1)
}

/// The TypeScript component that reports a [`Diagnostic`]. It determines when the checker reports it.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum DiagnosticKind {
    /// `SourceFile.Diagnostics()`: parser.go and scanner.go. `hasParseDiagnostics` counts only these.
    Parse,
    /// `SourceFile.JSDiagnostics()`
    Js,
    /// `SourceFile.JSDocDiagnostics()`. Reported only if the file is checked (`IsCheckJSEnabledForFile`).
    JsDoc,
    /// `grammarErrorOnNode` and similar, and the binder's identifier checks. Suppressed in a file that has parse diagnostics.
    Grammar,
    /// `c.error`. Not suppressed by parse diagnostics.
    Checker,
}

/// `ast.Diagnostic`
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Diagnostic {
    pub kind: DiagnosticKind,
    pub start: u32,
    /// 0: the end of the token at `start`. [`Diagnostic::NO_LENGTH`]: `start`.
    pub end: u32,
    pub code: u32,
    /// The message arguments: `{0}`, `{1}`, ...
    pub args: Box<[Box<[u8]>]>,
    /// `AddRelatedInfo`
    pub related: Vec<Diagnostic>,
}

impl Diagnostic {
    /// An `end` that makes the range empty. An explicit end cannot say so at offset 0.
    pub const NO_LENGTH: u32 = u32::MAX;

    pub fn new(kind: DiagnosticKind, at: (u32, u32), code: u32, args: &[&[u8]]) -> Diagnostic {
        Diagnostic {
            kind,
            start: at.0,
            end: at.1,
            code,
            args: args.iter().map(|&arg| arg.into()).collect(),
            related: Vec::new(),
        }
    }
}

/// One of a `ModifierList`, which is in source order.
#[derive(Copy, Clone, Debug)]
pub struct Modifier {
    pub kind: ModifierKind,
    pub pos: u32,
}

#[derive(Copy, Clone, Debug)]
pub struct Stmt {
    pub kind: StmtKind,
    /// Where its first token is, decorators and modifiers included.
    pub start: u32,
    pub loc: TextRange,
    /// `node.Modifiers()`
    pub modifiers: Span<ModifierId>,
}

#[derive(Copy, Clone, Debug)]
pub enum StmtKind {
    Empty,
    Debugger,
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
    /// An initializer of `param` is an error (1197).
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
        star_pos: u32,
        /// Where `alias` is.
        alias_pos: u32,
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
    /// `node.End()`
    pub end: u32,
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
    /// `GetThisParameter`: the first parameter, if it is named `this`. It is not among `params`. The reparser makes one of a `@this`
    /// tag (`Flags::REPARSED`), where the name of the tag is and with a name that is missing (`NewIdentifier("this")` has no range);
    /// in a `@callback`, where the tag is and with the text of the tag for a name (`thisIdent.Loc = thisTag.Loc`).
    pub this_param: ParamId,
    pub ret: TypeNodeId,
    pub body: FnBody,
    /// The `(` of the parameters; the `=>` of an arrow function.
    pub anchor: u32,
    /// Where its first token is, decorators and modifiers included. That of the member, for a method or an accessor.
    pub start: u32,
}

impl Func {
    /// The type that is written on the `this` parameter.
    #[inline]
    pub fn this_ty(&self, hir: &File) -> TypeNodeId {
        let this = hir.params.get(self.this_param.idx());
        this.map_or(TypeNodeId::NONE, |this| this.ty)
    }
}

#[derive(Copy, Clone, Debug)]
pub struct Param {
    pub pat: PatId,
    pub ty: TypeNodeId,
    pub default: ExprId,
    pub flags: Flags,
    /// Where it starts, modifiers and `...` included.
    pub pos: u32,
    /// `end` is 0 where the parser did not say.
    pub loc: TextRange,
}

#[derive(Copy, Clone, Debug)]
pub struct TypeParam {
    pub name: Atom,
    pub pos: u32,
    /// Where its first token is: a modifier, or `pos`.
    pub start: u32,
    /// `node.End()`
    pub end: u32,
    pub constraint: TypeNodeId,
    pub default: TypeNodeId,
    pub flags: Flags,
    /// `node.Modifiers()`
    pub modifiers: Span<ModifierId>,
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
    /// `node.Name()`: the `[` of a computed name, the keyword of a constructor. A signature without a name: its `start`. A static block:
    /// its `{`.
    pub name_pos: u32,
    /// Where its first token is: a decorator, a modifier, `get`, `set`, `*`, or `name_pos`.
    pub start: u32,
    /// Its `;` or `,` is part of it.
    pub loc: TextRange,
    /// `node.Modifiers()`. The `static` of `static { }` is none.
    pub modifiers: Span<ModifierId>,
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
    /// `GetExtendsHeritageClauseElement`: the first element of the first `extends` clause.
    pub extends: ExprId,
    pub extends_args: IdList<TypeNodeId>,
    /// The other elements of `extends` clauses, which are an error and which the checker never looks at: `extends A, B`,
    /// `extends A extends B`.
    pub other_extends: IdList<ExprId>,
    pub implements: IdList<TypeNodeId>,
    /// The elements of `implements` clauses after the first, which are an error and which the checker never looks at.
    pub other_implements: IdList<TypeNodeId>,
    pub members: Span<MemberId>,
    /// Where its first token is, decorators and modifiers included.
    pub start: u32,
    /// `node.Modifiers()`. Of a declaration, the list of its statement.
    pub modifiers: Span<ModifierId>,
}

#[derive(Copy, Clone, Debug)]
pub struct Interface {
    pub name: Atom,
    pub name_pos: u32,
    pub flags: Flags,
    pub type_params: Span<TypeParamId>,
    pub extends: IdList<TypeNodeId>,
    /// The elements of its other heritage clauses, which are an error and which the checker never looks at: `extends` after the
    /// first, and `implements`.
    pub other_heritage: IdList<TypeNodeId>,
    pub members: Span<MemberId>,
    /// The statement it is.
    pub stmt: StmtId,
}

#[derive(Copy, Clone, Debug)]
pub struct Alias {
    pub name: Atom,
    pub name_pos: u32,
    pub flags: Flags,
    pub type_params: Span<TypeParamId>,
    pub ty: TypeNodeId,
    /// The statement it is.
    pub stmt: StmtId,
}

#[derive(Copy, Clone, Debug)]
pub struct Enum {
    pub name: Atom,
    pub name_pos: u32,
    pub flags: Flags,
    pub members: Span<EnumMemberId>,
    /// The statement it is.
    pub stmt: StmtId,
}

#[derive(Copy, Clone, Debug)]
pub struct EnumMember {
    pub name: Atom,
    pub name_kind: NameKind,
    /// The `e` of `[e]` (`HasDynamicName`). `name` is `NONE` then. The checker objects to such a name and never looks at `e`.
    pub computed_name: ExprId,
    pub init: ExprId,
    pub pos: u32,
    pub loc: TextRange,
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
    /// `ModuleDeclaration.Keyword` is `module`. What holds for the `a` of `module a.b` holds for `b`.
    pub says_module: bool,
    /// The statement it is.
    pub stmt: StmtId,
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
    /// `import x from "m"`, `export x from "m"`
    Import,
    /// `import x = require("m")`
    Require,
    /// `import "m"`
    SideEffect,
    /// `import("m").T`
    ImportType,
    /// `import("m")`
    ImportCall,
    /// `require("m")`, in JavaScript
    RequireCall,
}

impl SpecifierKind {
    /// Whether it is the argument of a call expression.
    #[inline]
    pub fn is_call(self) -> bool {
        matches!(self, SpecifierKind::ImportCall | SpecifierKind::RequireCall)
    }

    /// `ForEachDynamicImportOrRequireCall`: in `file.Imports()` these come after what the statements name.
    #[inline]
    pub fn is_dynamic(self) -> bool {
        self.is_call() || self == SpecifierKind::ImportType
    }
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
    /// Where the token after `import` is: the first of the import clause.
    pub clause_start: u32,
    /// `importClause.End()`
    pub clause_end: u32,
    /// Where the `*` of `* as namespace` is.
    pub namespace_start: u32,
    pub named: Span<ImportSpecId>,
    pub type_only: bool,
    /// `importClause.PhaseModifier` is `defer`.
    pub is_deferred: bool,
    /// As in [`SpecifierUse`].
    pub mode: ResolutionMode,
    /// The statement it is.
    pub stmt: StmtId,
}

#[derive(Copy, Clone, Debug)]
pub struct ImportSpec {
    /// Where its first token is: `type`, or `imported_pos`.
    pub start: u32,
    pub imported: Atom,
    pub local: Atom,
    /// Where `local` is.
    pub pos: u32,
    pub type_only: bool,
    pub imported_pos: u32,
    /// `node.End()`
    pub end: u32,
    /// `node.Parent.Parent.Parent`
    pub import: ImportId,
}

impl ImportSpec {
    /// `parseImportSpecifier`: an identifier without text stands where a string is that no `as` follows.
    pub fn is_name_missing(&self) -> bool {
        self.imported == crate::atom::known::empty && self.imported_pos == self.pos
    }
}

#[derive(Copy, Clone, Debug)]
pub enum ImportEqualsTarget {
    Require(Atom),
    Entity(Span<NameId>),
}

#[derive(Copy, Clone, Debug)]
pub struct ImportEquals {
    pub name: Atom,
    pub name_pos: u32,
    pub target: ImportEqualsTarget,
    /// The `e` of `require(e)` that is no string literal, which is an error. `target` is `Require(NONE)` then.
    pub expression: ExprId,
    pub flags: Flags,
    /// The statement it is.
    pub stmt: StmtId,
}

#[derive(Copy, Clone, Debug)]
pub struct Export {
    /// `NONE` without `from`.
    pub spec: Atom,
    pub items: Span<ExportSpecId>,
    pub type_only: bool,
    /// As in [`SpecifierUse`].
    pub mode: ResolutionMode,
    /// The statement it is.
    pub stmt: StmtId,
}

#[derive(Copy, Clone, Debug)]
pub struct ExportSpec {
    /// Where its first token is: `type`, or `local_pos`.
    pub start: u32,
    pub local: Atom,
    pub exported: Atom,
    /// Where `exported` is.
    pub pos: u32,
    pub type_only: bool,
    pub local_pos: u32,
    /// `node.End()`
    pub end: u32,
    /// `node.Parent.Parent`
    pub export: ExportId,
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

impl Keyword {
    /// `TokenToString`
    pub fn text(self) -> &'static [u8] {
        match self {
            Keyword::Any => b"any",
            Keyword::Unknown => b"unknown",
            Keyword::Never => b"never",
            Keyword::Void => b"void",
            Keyword::Undefined => b"undefined",
            Keyword::Null => b"null",
            Keyword::String => b"string",
            Keyword::Number => b"number",
            Keyword::Boolean => b"boolean",
            Keyword::BigInt => b"bigint",
            Keyword::Symbol => b"symbol",
            Keyword::Object => b"object",
            Keyword::This => b"this",
            Keyword::Intrinsic => b"intrinsic",
        }
    }
}

#[derive(Copy, Clone, Debug)]
pub struct TypeNode {
    pub kind: TypeNodeKind,
    pub pos: u32,
    /// `node.End()`, not counting parentheses around it.
    pub end: u32,
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
    /// The members after `[K in T]: X`, which are an error and which the checker never looks at.
    pub members: Span<MemberId>,
}

/// An `Identifier` of an entity name that is no expression: of `A.B.C` in a type reference, in a heritage clause, after `import("m")`,
/// in `import x = A.B.C`. The names of one entity name are next to each other.
#[derive(Copy, Clone, Debug)]
pub struct Name {
    pub text: Atom,
    /// Where it is written. The top bit: a dot and a name stand before it.
    place: u32,
}

impl Name {
    const QUALIFIED: u32 = 1 << 31;

    #[inline]
    pub fn pos(self) -> u32 {
        self.place & !Name::QUALIFIED
    }

    /// Whether it is the `Right` of a `QualifiedName`.
    #[inline]
    pub fn is_qualified(self) -> bool {
        self.place & Name::QUALIFIED != 0
    }
}

#[derive(Copy, Clone, Debug)]
pub struct TupleElem {
    pub ty: TypeNodeId,
    pub name: Atom,
    pub optional: bool,
    pub rest: bool,
    /// Where its first token is: the `...`, the name, or the type.
    pub start: u32,
    /// `node.End()`
    pub end: u32,
}

#[derive(Copy, Clone, Debug)]
pub enum TypeNodeKind {
    /// Syntax the type parser gave up on.
    Error,
    /// An element of a heritage clause of an interface whose expression is no entity name, which is an error: `extends f()`.
    Heritage(ExprId),
    Keyword(Keyword),
    /// `A.B.C<Args>`
    Ref {
        name: Span<NameId>,
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
    /// `?T`, `T?`: a `JSDocNullableType`. `!T`, `T!`: a `JSDocNonNullableType`.
    JSDoc {
        ty: TypeNodeId,
        is_nullable: bool,
        is_postfix: bool,
    },
    /// `typeof a.b.c<Args>`
    /// `expr` is `name` as an expression: what it is where it is written depends on the tests made on the way there.
    Typeof {
        /// These rows are no nodes: `expr` is.
        name: Span<NameId>,
        args: IdList<TypeNodeId>,
        /// `TypeArguments != nil`: `typeof f<>` has a list, which is empty.
        has_type_arguments: bool,
        expr: ExprId,
    },
    /// `import("spec").A.B<Args>`, `typeof import("spec")`
    Import {
        spec: Atom,
        name: Span<NameId>,
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

/// `ast.CommentDirective`
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct CommentDirective {
    /// `Loc`. Of a `/* */` comment it starts where the last line of the comment does.
    pub start: u32,
    pub end: u32,
    pub kind: CommentDirectiveKind,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum CommentDirectiveKind {
    /// `@ts-expect-error`
    ExpectError,
    /// `@ts-ignore`
    Ignore,
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
    /// The parser rejected the file: the tree is partial or empty. Only parse errors are reported for it.
    pub has_errors: bool,
    /// The parser, the lowering or the binder ran out of stack: the tree is partial or empty. The file is reported as not fully checked
    /// and the exit code is 1.
    pub ran_out_of_stack: bool,
    /// `@d`: what is decorated, and the expression. In the order they are written.
    pub decorators: Few<(DecoratorOwner, ExprId)>,
    /// `experimentalDecorators`
    pub legacy_decorators: bool,
    /// Diagnostics produced while parsing and lowering the file.
    pub diagnostics: Vec<Diagnostic>,
    /// `hasParseDiagnostics`: the parser or the scanner reported an error. `grammarErrorOnNode` and the binder's checks of
    /// reserved names then report nothing.
    pub has_parse_diagnostics: bool,
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
    pub references: Few<(ReferenceKind, Atom, u32, ResolutionMode)>,
    /// `CommentDirectives`, in order.
    pub comment_directives: Few<CommentDirective>,
    /// The statement of each `with (e) statement`, from right after the `)` to where it ends.
    pub with_bodies: Few<(u32, u32)>,
    /// Where the `{` is of each function whose body is a block, but for a static block, whose `anchor` it is. Sorted.
    pub body_starts: Vec<(FnId, u32)>,
    /// The start of each token that follows a token the parser skipped in a list (`abortParsingListOrMoveToNextToken`). Sorted.
    pub after_skipped: Few<u32>,
    /// `node.Modifiers()` of a parameter, by `ParamId`: see `param_modifiers`. No longer than the last parameter that has any needs,
    /// and empty in most files. A column and not a field of `Param`, on purpose: few parameters have a modifier, and a field is paid
    /// by all of them.
    pub modifiers_of_params: Vec<Span<ModifierId>>,
    /// The array and object literals whose closing bracket the parser missed: where they open, and where they end, which is where the
    /// last token they took does (`finishNode`). Sorted.
    pub unclosed_literals: Few<(u32, u32)>,
    /// The decorators of missing declarations and of `this` parameters, which `checkDecorators` never looks at: from where the
    /// expression starts to where what comes after the decorators starts. The expressions are statements of their own.
    pub stray_decorators: Few<(u32, u32)>,
    /// Where module specifiers are written, but for those of `import()`, which are expressions.
    pub specifier_uses: Vec<SpecifierUse>,

    /// The specifier of each `import.defer(..)`, and where the `)` of the call is.
    pub deferred_import_calls: Few<(ExprId, u32)>,
    /// The specifier of each `import<T>(..)`, and the type arguments.
    pub import_call_type_args: Few<(ExprId, IdList<TypeNodeId>)>,
    /// `with { .. }` of imports and exports: the start of `with`, and the attributes as an `ExprKind::Object`.
    pub import_attributes: Few<(u32, ExprId)>,
    /// The module specifiers of imports and exports that are no string literals. They are bound, and nothing in them is checked.
    pub specifier_expressions: Few<ExprId>,
    /// `ParenthesizedExpression`: what is in the parentheses, where they open and where they end. In the order of the expressions, and
    /// of those around one expression the innermost first.
    pub parens: Vec<(ExprId, u32, u32)>,
    /// `JsxExpression`: what is in the braces, where they open and where they end. In the order of the expressions.
    pub jsx_expressions: Vec<(ExprId, u32, u32)>,
    /// What comments at the top say about JSX in this file.
    pub jsx_pragmas: JsxPragmas,
    /// The JSDoc comments of a JavaScript file, from where to where. Sorted. A node whose position is in one is made from a tag.
    pub jsdoc_comments: Few<(u32, u32)>,
    /// The types of `@type` tags on what has no place for a type. Sorted by owner.
    pub jsdoc_types: Few<(JsDocTypeOwner, TypeNodeId)>,
    /// `@public`, `@private`, `@protected`, `@readonly` and `@override` on an assignment: the assignment and the modifiers. Sorted.
    pub jsdoc_modifiers: Few<(ExprId, Flags)>,
    /// `checkUnmatchedJSDocParameters`, the part that only needs syntax: the function and the diagnostic for the name in its
    /// `@param` tag. 8024 and 8032 apply unless the function references `arguments`. 8029 applies if it does.
    pub jsdoc_param_errors: Few<(FnId, Diagnostic)>,

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
    pub enums: Few<Enum>,
    pub enum_members: Few<EnumMember>,
    pub modules: Few<Module>,
    pub members: Vec<Member>,
    pub props: Vec<Prop>,
    pub var_decls: Vec<VarDecl>,
    pub calls: Vec<Call>,
    pub cases: Vec<Case>,
    pub jsx: Few<Jsx>,
    pub imports: Vec<Import>,
    pub import_specs: Vec<ImportSpec>,
    pub import_equals: Few<ImportEquals>,
    pub exports: Vec<Export>,
    pub export_specs: Vec<ExportSpec>,
    pub tuple_elems: Few<TupleElem>,
    pub mapped: Few<Mapped>,
    pub modifiers: Vec<Modifier>,
    pub names: Vec<Name>,
    /// See node.rs. Set by `finish_nodes`.
    pub bases: NodeBases,
    pub fn_nodes: Vec<Node>,
    pub class_nodes: Vec<Node>,
    /// `node.Parent`, by `Node`: `File::parent`.
    pub parents: std::sync::OnceLock<crate::node::Parents>,
    /// `File::is_in_ambient_or_type_node`
    pub ambient_or_type_places: std::sync::OnceLock<Places>,
    /// Where an `Identifier` is whose text is one of `Atom::is_keyword_identifier`, or where the node starts that it is a child of.
    /// As the parser came to them, what it gave up on too.
    pub keyword_identifier_positions: Few<u32>,
    /// `File::keyword_identifiers`
    pub keyword_identifiers: std::sync::OnceLock<Box<[Node]>>,
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
    modifiers: Modifier => ModifierId, add_modifier, add_modifiers;
    names: Name => NameId, add_name, add_names;
}

impl File {
    /// `node.Modifiers()` of the parameter `p`: keywords and decorators, in source order.
    #[inline]
    pub fn param_modifiers(&self, p: ParamId) -> Span<ModifierId> {
        self.modifiers_of_params
            .get(p.idx())
            .copied()
            .unwrap_or(Span::EMPTY)
    }
    pub fn set_param_modifiers(&mut self, p: ParamId, list: Span<ModifierId>) {
        if list.is_empty() {
            return;
        }
        if self.modifiers_of_params.len() <= p.idx() {
            self.modifiers_of_params.resize(p.idx() + 1, Span::EMPTY);
        }
        self.modifiers_of_params[p.idx()] = list;
    }
    /// The texts of the template whose substitutions are `exprs`.
    #[inline]
    pub fn template_texts(&self, exprs: IdList<ExprId>) -> IdList<Atom> {
        IdList::new(exprs.start + exprs.len, exprs.len + 1)
    }
    /// The type arguments of the import call whose arguments are `args`.
    pub fn type_args_of_import_call(&self, args: IdList<ExprId>) -> IdList<TypeNodeId> {
        let specifier = self.id_at(args, 0);
        let mut written = self.import_call_type_args.iter();
        written
            .find(|of| of.0 == specifier)
            .map_or(IdList::EMPTY, |of| of.1)
    }
    #[inline]
    pub fn expr(&mut self, kind: ExprKind, pos: u32, end: u32) -> ExprId {
        self.add_expr_node(Expr { kind, pos, end })
    }
    #[inline]
    pub fn stmt(&mut self, kind: StmtKind, pos: u32) -> StmtId {
        let stmt = self.add_stmt_node(Stmt {
            kind: StmtKind::Empty,
            start: pos,
            loc: TextRange::default(),
            modifiers: Span::EMPTY,
        });
        self.set_stmt_kind(stmt, kind);
        stmt
    }
    /// Makes `stmt` a statement of `kind`, and tells what that declares.
    pub fn set_stmt_kind(&mut self, stmt: StmtId, kind: StmtKind) {
        self[stmt].kind = kind;
        match kind {
            StmtKind::Interface(interface) => self[interface].stmt = stmt,
            StmtKind::TypeAlias(alias) => self[alias].stmt = stmt,
            StmtKind::Enum(enumeration) => self[enumeration].stmt = stmt,
            StmtKind::Module(module) => self[module].stmt = stmt,
            StmtKind::ImportEquals(import) => self[import].stmt = stmt,
            StmtKind::Import(import) => self[import].stmt = stmt,
            StmtKind::ExportNamed(export) => self[export].stmt = stmt,
            _ => {}
        }
    }
    #[inline]
    pub fn modifier_list(&self, list: Span<ModifierId>) -> &[Modifier] {
        &self.modifiers[list.range()]
    }
    /// Where the first `flag` of `list` is written.
    pub fn find_modifier(&self, list: Span<ModifierId>, flag: Flags) -> Option<u32> {
        self.modifier_list(list)
            .iter()
            .find(|modifier| modifier.kind == ModifierKind::Keyword(flag))
            .map(|modifier| modifier.pos)
    }
    /// Adds a diagnostic without arguments for the range `start..end`.
    pub fn error(&mut self, kind: DiagnosticKind, start: u32, end: u32, code: u32) {
        let diagnostic = Diagnostic::new(kind, (start, end), code, &[]);
        self.diagnostics.push(diagnostic);
    }
    /// Whether the file has a `Parse` or a `Grammar` diagnostic.
    pub fn has_parse_or_grammar_diagnostics(&self) -> bool {
        use DiagnosticKind::{Grammar, Parse};
        (self.diagnostics.iter()).any(|d| matches!(d.kind, Parse | Grammar))
    }
    /// Whether a diagnostic with `code` starts at `start`.
    pub fn has_diagnostic(&self, start: u32, code: u32) -> bool {
        (self.diagnostics.iter()).any(|d| d.start == start && d.code == code)
    }
    #[inline]
    pub fn ty(&mut self, kind: TypeNodeKind, pos: u32, end: u32) -> TypeNodeId {
        self.add_type_node(TypeNode { kind, pos, end })
    }
    #[inline]
    pub fn pat(&mut self, kind: PatKind, pos: u32, end: u32) -> PatId {
        self.add_pat_node(Pat { kind, pos, end })
    }
    /// `GetThisParameter`: the first of `params` if it is named `this`, and the others.
    pub fn split_this_parameter(&self, params: Span<ParamId>) -> (ParamId, Span<ParamId>) {
        match params.iter().next() {
            Some(first)
                if matches!(
                    self[self[first].pat].kind,
                    PatKind::Ident(crate::atom::known::this)
                ) =>
            {
                (first, Span::new(params.start + 1, params.len - 1))
            }
            _ => (ParamId::NONE, params),
        }
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

    /// `A.B.C`: each name, and where it is written.
    pub fn entity_name(&mut self, names: impl Iterator<Item = (Atom, u32)>) -> Span<NameId> {
        let start = self.names.len();
        self.names
            .extend(names.map(|(text, place)| Name { text, place }));
        for name in self.names.iter_mut().skip(start + 1) {
            name.place |= Name::QUALIFIED;
        }
        Span::new(start as u32, (self.names.len() - start) as u32)
    }

    /// `before.text`, as the parser comes to it.
    pub fn append_to_entity_name(
        &mut self,
        before: Span<NameId>,
        text: Atom,
        place: u32,
    ) -> Span<NameId> {
        let mut start = before.start;
        // Something else was named since.
        if before.range().end != self.names.len() {
            start = self.names.len() as u32;
            self.names.extend_from_within(before.range());
        }
        let place = match before.is_empty() {
            true => place,
            false => place | Name::QUALIFIED,
        };
        self.names.push(Name { text, place });
        Span::new(start, before.len + 1)
    }

    /// What the names of an entity name say.
    #[inline]
    pub fn texts(
        &self,
        names: Span<NameId>,
    ) -> impl DoubleEndedIterator<Item = Atom> + ExactSizeIterator + Clone + '_ {
        self.names[names.range()].iter().map(|name| name.text)
    }

    #[inline]
    pub fn id_at<T: From<u32>>(&self, list: IdList<T>, i: usize) -> T {
        debug_assert!(i < list.len());
        T::from(self.ids[list.start as usize + i])
    }

    /// Of the short lists. The long ones are left to `fit`.
    pub fn shrink_to_fit(&mut self) {
        macro_rules! each {
            ($($f:ident),*) => { $(self.$f.shrink_to_fit();)* };
        }
        each!(
            enums,
            enum_members,
            modules,
            jsx,
            import_equals,
            tuple_elems,
            mapped,
            references,
            with_bodies,
            deferred_import_calls,
            import_attributes,
            specifier_expressions,
            after_skipped,
            stray_decorators,
            jsdoc_comments,
            jsdoc_types,
            jsdoc_modifiers,
            jsdoc_param_errors,
            diagnostics,
            decorators,
            comment_directives
        );
    }
}

macro_rules! long_lists {
    ($each:ident) => {
        $each!(
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
            members,
            props,
            var_decls,
            calls,
            cases,
            imports,
            import_specs,
            exports,
            export_specs,
            specifier_uses,
            parens,
            jsx_expressions,
            modifiers,
            names,
            body_starts
        );
    };
}

/// Leaves `list` no room it does not use. `shrink_to_fit` will not do: the allocator leaves a block that is at least half used as it is,
/// and that is every list that has grown by doubling. So what is in it moves to a block of its size.
pub(crate) fn fit<T>(list: &mut Vec<T>) {
    if list.capacity() > list.len() {
        let mut exact = Vec::with_capacity(list.len());
        exact.append(list);
        *list = exact;
    }
}

impl File {
    /// `fit`, for a file that is kept.
    pub fn fit(&mut self) {
        macro_rules! each {
            ($($f:ident),*) => { $(fit(&mut self.$f);)* };
        }
        long_lists!(each);
    }

    /// The same for a file that was made in vectors that serve again: `room` gets them, empty.
    pub fn fit_leaving_room(&mut self, room: &mut File) {
        macro_rules! each {
            ($($f:ident),*) => { $(
                let exact = self.$f.as_slice().to_vec();
                room.$f = std::mem::replace(&mut self.$f, exact);
                room.$f.clear();
            )* };
        }
        long_lists!(each);
    }
}

/// `IsParenthesizedExpression`, of what is right around `e`.
#[inline]
pub fn is_parenthesized(hir: &File, e: ExprId) -> bool {
    open_parenthesis(hir, e).is_some()
}

/// Where the outermost parenthesis around `e` opens, if it is in any.
#[inline]
pub fn open_parenthesis(hir: &File, e: ExprId) -> Option<u32> {
    parentheses_around(hir, e).last().map(|p| p.1)
}

/// The parentheses around `e`, the innermost first.
#[inline]
pub fn parentheses_around(hir: &File, e: ExprId) -> &[(ExprId, u32, u32)] {
    let first = hir.parens.partition_point(|p| p.0.0 < e.0);
    let count = hir.parens[first..].partition_point(|p| p.0 == e);
    &hir.parens[first..first + count]
}

/// `node.End()` of `e` as it is written: after the parentheses around it.
pub fn end_of_expr(hir: &File, e: ExprId) -> u32 {
    parentheses_around(hir, e)
        .last()
        .map_or(hir[e].end, |outermost| outermost.2)
}

/// From where to where the `JsxExpression` goes that `e` is all there is in.
pub fn jsx_expression_around(hir: &File, e: ExprId) -> Option<(u32, u32)> {
    let found = hir
        .jsx_expressions
        .binary_search_by_key(&e.0, |braces| braces.0.0);
    found
        .ok()
        .map(|i| (hir.jsx_expressions[i].1, hir.jsx_expressions[i].2))
}

/// Where `e` starts as it is written.
pub fn start_of(hir: &File, e: ExprId) -> u32 {
    open_parenthesis(hir, e).unwrap_or_else(|| start_inside_parentheses(hir, e))
}

/// `GetTokenPosOfNode`: where `e` starts, not counting parentheses around the whole of it.
#[inline]
pub fn start_inside_parentheses(hir: &File, e: ExprId) -> u32 {
    match hir[e].kind {
        // Its decorators are part of it.
        ExprKind::Class(c) => hir[c].start,
        _ => hir[e].pos,
    }
}

/// `IsPrivateIdentifier`, of the name written at `pos`.
#[inline]
pub fn is_private_name_at(hir: &File, pos: u32) -> bool {
    hir.text.get(pos as usize) == Some(&b'#')
}

/// `IsBigIntLiteral`, of what is written at `pos`: a number that ends in `n`.
pub fn is_bigint_literal_at(hir: &File, pos: u32) -> bool {
    let written = hir.text.get(pos as usize..).unwrap_or_default();
    let end = written
        .iter()
        .position(|b| !b.is_ascii_alphanumeric() && *b != b'_')
        .unwrap_or(written.len());
    written.first().is_some_and(u8::is_ascii_digit) && written[..end].ends_with(b"n")
}

/// `GetFirstIdentifier`: `a` of `a.b.c`.
pub fn first_identifier(hir: &File, mut e: ExprId) -> ExprId {
    while let ExprKind::Dot { obj, .. } = hir[e].kind {
        e = obj;
    }
    e
}

/// `IsEntityNameExpression`: `a`, `a.b.c`. What is missing is an Identifier without a text (`createMissingIdentifier`).
pub fn is_entity_name_expression(hir: &File, e: ExprId) -> bool {
    !is_parenthesized(hir, e)
        && (matches!(hir[e].kind, ExprKind::Ident(_) | ExprKind::Missing)
            || is_property_access_entity_name_expression(hir, e))
}

/// `IsPropertyAccessEntityNameExpression`, of `e` itself, whatever parentheses it is in.
pub fn is_property_access_entity_name_expression(hir: &File, e: ExprId) -> bool {
    matches!(hir[e].kind, ExprKind::Dot { obj, name_pos, .. }
        if !is_private_name_at(hir, name_pos) && is_entity_name_expression(hir, obj))
}

/// `ExpressionIsAlias`
pub fn expression_is_alias(hir: &File, e: ExprId) -> bool {
    is_entity_name_expression(hir, e)
        || matches!(hir[e].kind, ExprKind::Class(_)) && !is_parenthesized(hir, e)
}

/// `IsStringLiteralLike`
pub fn is_string_literal_like(hir: &File, e: ExprId) -> bool {
    !is_parenthesized(hir, e)
        && match hir[e].kind {
            ExprKind::String(_) => true,
            ExprKind::Template { exprs, .. } => exprs.is_empty(),
            _ => false,
        }
}

/// `IsStringOrNumericLiteralLike`
pub fn is_string_or_numeric_literal_like(hir: &File, e: ExprId) -> bool {
    is_string_literal_like(hir, e)
        || matches!(hir[e].kind, ExprKind::Number(_)) && !is_parenthesized(hir, e)
}

/// `IsSignedNumericLiteral`
pub fn is_signed_numeric_literal(hir: &File, e: ExprId) -> bool {
    !is_parenthesized(hir, e)
        && matches!(hir[e].kind, ExprKind::Unary { op: UnOp::Plus | UnOp::Minus, operand }
            if matches!(hir[operand].kind, ExprKind::Number(_)) && !is_parenthesized(hir, operand))
}

/// `IsDynamicName`, of the name `[e]`.
pub fn is_dynamic_name(hir: &File, e: ExprId) -> bool {
    !is_string_or_numeric_literal_like(hir, e) && !is_signed_numeric_literal(hir, e)
}

/// `IsDottedName`
pub fn is_dotted_name(hir: &File, e: ExprId) -> bool {
    match hir[e].kind {
        ExprKind::Ident(_)
        | ExprKind::This
        | ExprKind::Super
        | ExprKind::NewTarget(_)
        | ExprKind::ImportMeta => true,
        ExprKind::Dot { obj, .. } => is_dotted_name(hir, obj),
        _ => false,
    }
}

/// `NodeIsPresent(node.Body())`
pub fn has_body(func: &Func) -> bool {
    !matches!(func.body, FnBody::None)
}

/// `node.Body() != nil`: a block whose `{` is missing is a body node, though not a present one.
pub fn has_body_node(func: &Func) -> bool {
    has_body(func) || func.flags.contains(Flags::MISSING_BODY)
}

/// `hasExportDeclarations`
pub fn has_export_declarations(hir: &File, list: IdList<StmtId>) -> bool {
    hir.ids(list).any(|s| {
        matches!(
            hir[s].kind,
            StmtKind::ExportNamed(_)
                | StmtKind::ExportStar { .. }
                | StmtKind::ExportAssign(_)
                | StmtKind::ExportDefault(_)
        )
    })
}

/// The names `pat` binds, each with the pattern that is the name.
pub fn names_bound_by(hir: &File, pat: PatId, into: &mut Vec<(Atom, PatId)>) {
    match hir[pat].kind {
        PatKind::Missing => {}
        PatKind::Ident(name) => into.push((name, pat)),
        PatKind::Object(props) => props
            .iter()
            .for_each(|p| names_bound_by(hir, hir[p].value, into)),
        PatKind::Array(elems) => elems
            .iter()
            .for_each(|e| names_bound_by(hir, hir[e].pat, into)),
    }
}

/// `NodeFlagsNestedNamespace`: the statement `s` is the `B` of `namespace A.B`. It starts with its name.
pub fn is_nested_namespace(hir: &File, s: StmtId) -> bool {
    matches!(hir[s].kind, StmtKind::Module(m) if hir[s].start == hir[m].name_pos)
}

const _: () = assert!(std::mem::size_of::<Expr>() <= 24);
const _: () = assert!(std::mem::size_of::<TypeNode>() <= 32);
