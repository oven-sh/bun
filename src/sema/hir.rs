//! The syntax stored in a file's HIR: declarations, type syntax, and the bodies of functions as
//! lazy expressions.
//!
//! The parser fills a [`FileBuilder`] while it still has the source; nothing here is resolved. Nodes live
//! in per-kind vectors and refer to each other by index, so a file is a handful of allocations, can
//! be built on any thread, and is immutable from then on. Positions are byte offsets into the
//! source.

use crate::atom::Atom;
pub use crate::node::{Kind, Node, NodeBases, NodeData, Part, Places, ToNode};
use crate::session::{Arena, ArenaBox, ArenaHashMap, ArenaHashSet, ArenaVec, Session};
use crate::util::{FxHashMap, FxHashSet};
use std::borrow::Cow;
use std::marker::PhantomData;
use std::ops::{Deref, DerefMut};
use std::sync::OnceLock;

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
        impl Default for $name { #[inline] fn default() -> Self { Self::NONE } }
        impl From<u32> for $name { #[inline] fn from(v: u32) -> Self { $name(v) } }
        impl From<$name> for u32 { #[inline] fn from(v: $name) -> u32 { v.0 } }
    )*};
}
pub(crate) use define_id;

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
    /// `node.Pos()`: the end of the token before the node.
    pub pos: u32,
    /// `node.End()`: the end of the last token of the node.
    pub end: u32,
}

/// A list of ids that are not contiguous: a range of [`File::ids`].
pub struct IdList<T> {
    pub start: u32,
    pub len: u32,
    _of: PhantomData<T>,
}

/// A contiguous range of nodes in their vector.
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

/// A list that is empty in most files, at its final size in an arena. One word, not three: a file
/// has 66 of these, which as three words each are 42 MB more on 40,000 files.
pub struct ArenaFew<'s, T>(Option<&'s mut ArenaVec<'s, T>>);

impl<'s, T> ArenaFew<'s, T> {
    /// Moves the elements of `list` to `arena`.
    pub fn from_iter_in(list: impl ExactSizeIterator<Item = T>, arena: &'s Arena) -> Self {
        if list.len() == 0 {
            return ArenaFew(None);
        }
        let mut exact = ArenaVec::new_in(arena);
        exact.reserve_exact(list.len());
        exact.extend(list);
        ArenaFew(Some(arena.alloc(exact)))
    }
}

impl<T> Default for ArenaFew<'_, T> {
    #[inline]
    fn default() -> Self {
        ArenaFew(None)
    }
}

impl<T> Drop for ArenaFew<'_, T> {
    /// Frees the elements. The three words of the list header stay in the arena.
    fn drop(&mut self) {
        if let Some(list) = self.0.take() {
            *list = ArenaVec::new_in(list.allocator());
        }
    }
}

impl<T> Deref for ArenaFew<'_, T> {
    type Target = [T];
    #[inline]
    fn deref(&self) -> &[T] {
        match &self.0 {
            Some(list) => list,
            None => &[],
        }
    }
}

impl<T> DerefMut for ArenaFew<'_, T> {
    #[inline]
    fn deref_mut(&mut self) -> &mut [T] {
        match &mut self.0 {
            Some(list) => list,
            None => &mut [],
        }
    }
}

impl<'a, T> IntoIterator for &'a ArenaFew<'_, T> {
    type Item = &'a T;
    type IntoIter = std::slice::Iter<'a, T>;
    #[inline]
    fn into_iter(self) -> Self::IntoIter {
        self.iter()
    }
}

impl<T: std::fmt::Debug> std::fmt::Debug for ArenaFew<'_, T> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        std::fmt::Debug::fmt(&**self, f)
    }
}

/// Where the lists of a `FileIn` or a `BoundIn` are stored.
pub trait Storage {
    type List<T>: DerefMut<Target = [T]>;
    /// A list that is empty in most files.
    type Few<T: 'static>: DerefMut<Target = [T]>;
    type Map<K, V>;
    type Set<K>;
    /// A list whose elements own memory on the regular heap.
    type Kept<T: Clone + 'static>: Deref<Target = [T]>;
    /// `FileIn::text`
    type Text: Deref<Target = [u8]> + Default;
    /// `FileIn::lazy`
    type Lazy;
}

/// While a file is parsed or bound: on the global heap, with room to grow.
#[derive(Default)]
pub struct Growable;

impl Storage for Growable {
    type List<T> = Vec<T>;
    type Few<T: 'static> = Vec<T>;
    type Map<K, V> = FxHashMap<K, V>;
    type Set<K> = FxHashSet<K>;
    type Kept<T: Clone + 'static> = Vec<T>;
    type Text = Cow<'static, [u8]>;
    type Lazy = ();
}

/// From then on: at their final size, in the arena of the thread that loaded the file.
pub struct InArena<'s>(PhantomData<&'s Arena>);

impl<'s> Storage for InArena<'s> {
    type List<T> = ArenaVec<'s, T>;
    type Few<T: 'static> = ArenaFew<'s, T>;
    type Map<K, V> = ArenaHashMap<'s, K, V>;
    type Set<K> = ArenaHashSet<'s, K>;
    /// Owned until the program is loaded. Nothing drops a file of a program, so `Files::load` hands
    /// the list to `Session::keep` and borrows it from there.
    type Kept<T: Clone + 'static> = Cow<'s, [T]>;
    /// The same.
    type Text = Cow<'s, [u8]>;
    type Lazy = Lazy<'s>;
}

/// What is computed from a loaded file on demand, by the first thread that needs it, in the arena of
/// that thread.
pub struct Lazy<'s> {
    pub(crate) session: &'s Session,
    /// `node.Parent`, by `Node`: `File::parent`.
    pub(crate) parents: OnceLock<crate::node::Parents<'s>>,
    /// `File::is_in_ambient_or_type_node`
    pub(crate) ambient_or_type_places: OnceLock<Places<ArenaBox<'s, [TextRange]>>>,
    /// `File::keyword_identifiers`
    pub(crate) keyword_identifiers: OnceLock<ArenaBox<'s, [Node]>>,
}

/// Copies `list` to a block of exactly its size in `arena`, and empties it. It retains its capacity.
pub(crate) fn copy_to_arena<'s, T: Copy>(list: &mut Vec<T>, arena: &'s Arena) -> ArenaVec<'s, T> {
    let mut exact = ArenaVec::new_in(arena);
    exact.reserve_exact(list.len());
    exact.extend_from_slice(list);
    list.clear();
    exact
}

/// The same for elements that are not `Copy`.
pub(crate) fn move_to_arena<'s, T>(list: &mut Vec<T>, arena: &'s Arena) -> ArenaVec<'s, T> {
    let mut exact = ArenaVec::new_in(arena);
    exact.reserve_exact(list.len());
    exact.extend(list.drain(..));
    exact
}

pub(crate) fn few_to_arena<'s, T>(list: Vec<T>, arena: &'s Arena) -> ArenaFew<'s, T> {
    ArenaFew::from_iter_in(list.into_iter(), arena)
}

bitflags::bitflags! {
    /// Modifiers, for every kind of node that can have them.
    #[derive(Copy, Clone, PartialEq, Eq, Debug, Default)]
    pub struct Flags: u32 {
        const EXPORT = 1 << 0;
        const DEFAULT = 1 << 1;
        /// `declare`, or inside a `declare` declaration, or in a declaration file.
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
        /// A member whose name is a string or numeric literal: `"a": T`, `0: T`.
        const LITERAL_NAME = 1 << 21;
        /// A member whose name is a string literal: `"0": T`, `["0"]: T`.
        const STRING_NAME = 1 << 23;
        /// A function whose `{` is missing. tsgo gives it a zero-width block
        /// (`NodeIsMissing(body)`, but `body != nil`): `body` is `None` here, it returns `any` and
        /// is not an implementation, yet no missing implementation is reported (2391, 2390).
        const MISSING_BODY = 1 << 24;
        /// `NodeFlagsReparsed`: a declaration, or the `?` of a parameter, that is synthesized from
        /// a JSDoc tag in JavaScript.
        const REPARSED = 1 << 25;
        /// A member whose name is in brackets.
        const COMPUTED_NAME = 1 << 26;
        /// A namespace that is synthesized from a JSDoc tag of a class element. In tsgo it is an
        /// element of that class (`parseListIndex`). Here it is a statement before the class.
        const CLASS_ELEMENT = 1 << 27;
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
    /// `node.End()`, excluding enclosing parentheses.
    pub end: u32,
}

#[derive(Copy, Clone, Debug)]
pub enum ExprKind {
    Missing,
    Ident(Atom),
    /// `#x` that is an expression of its own: the left operand of `in`, or misplaced. The name of
    /// `a.#x` is in `Dot`.
    PrivateIdentifier(Atom),
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
    /// The substitutions. The texts between them, one more than the substitutions, follow them
    /// directly in [`File::ids`]: [`File::template_texts`].
    Template {
        exprs: IdList<ExprId>,
    },
    /// The tag is the callee, the substitutions are the arguments.
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
    /// `new.target`, and the name in the source: any word forms a meta property.
    NewTarget(Atom),
}

/// The kind of an expression, without its payload.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum ExprTag {
    Missing,
    Ident,
    PrivateIdentifier,
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
    pub const COUNT: usize = 38;
}

impl ExprKind {
    #[inline]
    pub fn tag(&self) -> ExprTag {
        match self {
            ExprKind::Missing => ExprTag::Missing,
            ExprKind::Ident(..) => ExprTag::Ident,
            ExprKind::PrivateIdentifier(..) => ExprTag::PrivateIdentifier,
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

/// The expressions of a file, grouped by kind. Within a kind they keep the order of the file's
/// list.
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
    /// Position of the `)`. `u32::MAX` for `new C`. A tagged template has `u32::MAX` or
    /// [`INCOMPLETE_TEMPLATE`].
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
    /// An identifier, a string, or a number formatted as `String(n)` formats it. Also `["a"]` and
    /// `[0]`.
    Name(Atom),
    Private(Atom),
    /// `[e]`, unless `e` is a bare string or numeric literal. `IsDynamicName`: `[("a")]` and `["a"
    /// as T]` are evaluated. `[-1]` is stored like this too, though it is not a dynamic name.
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

/// The syntactic form of a name whose text is in `PropKey::Name`.
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
    /// The name of a JSX attribute: `a`, `a-b`, `a:b`. A spread attribute has this kind too.
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
    /// Position of its first token: a modifier, `get`, `set`, `*`, `...`, or `pos`.
    pub start: u32,
    /// `node.End()`. 0 if the parser did not record it.
    pub end: u32,
    /// Position of `PostfixToken`, the `?` or the `!` after the name. 0: there is none.
    pub postfix_token: u32,
}

/// `IsIntrinsicJsxName`
pub fn is_intrinsic_jsx_name(name: &[u8]) -> bool {
    name.first().is_some_and(u8::is_ascii_lowercase) || bun_core::strings::contains_char(name, b'-')
}

#[derive(Copy, Clone, Debug)]
pub struct Jsx {
    /// `TagName` of the opening element. `NONE` for a fragment. A name that is not an identifier
    /// outside JSX is a `String`: `a-b`, `a:b`.
    pub tag: ExprId,
    /// `TagName` of the `JsxClosingElement`. `NONE` for `<tag />` and for a fragment. A missing
    /// expression if the name or the whole tag is missing. After a syntax error the two names may
    /// differ.
    pub close_tag: ExprId,
    pub attrs: Span<PropId>,
    pub children: IdList<ExprId>,
    pub type_args: IdList<TypeNodeId>,
    /// `End()` of the `JsxOpeningElement`, the `JsxOpeningFragment` or the `JsxSelfClosingElement`.
    pub opening_end: u32,
    /// Start of `</tag>`, or the position where it is missing. `u32::MAX` for `<tag />`.
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
    /// Position of its first token: the name of the property, or the `...`.
    pub pos: u32,
    /// Position of the property name. After `...` a name is an error (2566).
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
    /// Position of its first token: the `...`, or `pat`.
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

impl ModifierKind {
    /// `ModifierToFlag`. There is no `ModifierFlagsDecorator`.
    #[inline]
    pub fn flag(self) -> Flags {
        match self {
            ModifierKind::Keyword(flag) => flag,
            ModifierKind::Decorator(_) => Flags::empty(),
        }
    }
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
    /// An `end` that makes the range empty. An explicit end cannot express that at offset 0.
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

/// One element of a `ModifierList`, which is in source order.
#[derive(Copy, Clone, Debug)]
pub struct Modifier {
    pub kind: ModifierKind,
    pub pos: u32,
}

#[derive(Copy, Clone, Debug)]
pub struct Stmt {
    pub kind: StmtKind,
    /// Position of its first token, including decorators and modifiers.
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
        /// `NONE` if it is not a string literal.
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
    /// The remaining kinds never have a body: members of interfaces and type literals, and function
    /// types.
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
    /// `GetThisParameter`: the first parameter, if it is named `this`. It is not among `params`.
    /// The reparser synthesizes one from a `@this` tag (`Flags::REPARSED`), positioned at the tag
    /// name and with a missing name (`NewIdentifier("this")` has no range); in a `@callback`,
    /// positioned at the tag and with the text of the tag as its name (`thisIdent.Loc =
    /// thisTag.Loc`).
    pub this_param: ParamId,
    pub ret: TypeNodeId,
    pub body: FnBody,
    /// The `(` of the parameters; the `=>` of an arrow function.
    pub anchor: u32,
    /// Position of its first token, including decorators and modifiers. For a method or an
    /// accessor, that of the member.
    pub start: u32,
}

impl Func {
    /// The type annotation of the `this` parameter.
    #[inline]
    pub fn this_ty<S: Storage>(&self, hir: &FileIn<S>) -> TypeNodeId {
        let this = hir.params.get(self.this_param.idx());
        this.map_or(TypeNodeId::NONE, |this| this.ty)
    }

    /// `getAccessorThisParameter`: the `this` parameter of an accessor that has, with it, as many
    /// parameters as its kind takes: one for a getter, two for a setter.
    pub fn accessor_this_parameter(&self) -> ParamId {
        if self.params.len() == usize::from(self.kind != FnKind::Getter) {
            self.this_param
        } else {
            ParamId::NONE
        }
    }

    /// `GetSetAccessorValueParameter`: the first parameter, which can be the `this` parameter. That
    /// is skipped only where it is the first of two. `NONE`: there is no parameter.
    pub fn set_accessor_value_parameter(&self) -> ParamId {
        match self.params.iter().next() {
            Some(value) if self.this_param.is_none() || self.params.len() == 1 => value,
            _ => self.this_param,
        }
    }

    /// `getEffectiveSetAccessorTypeAnnotationNode`
    pub fn effective_set_accessor_type_annotation_node<S: Storage>(
        &self,
        hir: &FileIn<S>,
    ) -> TypeNodeId {
        let value = hir.params.get(self.set_accessor_value_parameter().idx());
        value.map_or(TypeNodeId::NONE, |value| value.ty)
    }
}

#[derive(Copy, Clone, Debug)]
pub struct Param {
    pub pat: PatId,
    pub ty: TypeNodeId,
    pub default: ExprId,
    pub flags: Flags,
    /// Start position, including modifiers and `...`.
    pub pos: u32,
    /// `end` is 0 if the parser did not record it.
    pub loc: TextRange,
}

#[derive(Copy, Clone, Debug)]
pub struct TypeParam {
    pub name: Atom,
    pub pos: u32,
    /// Position of its first token: a modifier, or `pos`.
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
    /// Position of its first token: a decorator, a modifier, `get`, `set`, `*`, or `name_pos`.
    pub start: u32,
    /// Its `;` or `,` is part of it.
    pub loc: TextRange,
    /// `node.Modifiers()`. The `static` of `static { }` is not a modifier.
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
    /// The other elements of `extends` clauses, which are an error and which the checker never
    /// visits: `extends A, B`, `extends A extends B`.
    pub other_extends: IdList<ExprId>,
    pub implements: IdList<TypeNodeId>,
    /// The elements of `implements` clauses after the first, which are an error and which the
    /// checker never visits.
    pub other_implements: IdList<TypeNodeId>,
    pub members: Span<MemberId>,
    /// Position of its first token, including decorators and modifiers.
    pub start: u32,
    /// `node.Modifiers()`. For a declaration, the list of its statement.
    pub modifiers: Span<ModifierId>,
}

#[derive(Copy, Clone, Debug)]
pub struct Interface {
    pub name: Atom,
    pub name_pos: u32,
    pub flags: Flags,
    pub type_params: Span<TypeParamId>,
    pub extends: IdList<TypeNodeId>,
    /// The elements of its other heritage clauses, which are an error and which the checker never
    /// visits: `extends` after the first, and `implements`.
    pub other_heritage: IdList<TypeNodeId>,
    pub members: Span<MemberId>,
    /// The statement node of this declaration.
    pub stmt: StmtId,
}

#[derive(Copy, Clone, Debug)]
pub struct Alias {
    pub name: Atom,
    pub name_pos: u32,
    pub flags: Flags,
    pub type_params: Span<TypeParamId>,
    pub ty: TypeNodeId,
    /// The statement node of this declaration.
    pub stmt: StmtId,
}

#[derive(Copy, Clone, Debug)]
pub struct Enum {
    pub name: Atom,
    pub name_pos: u32,
    pub flags: Flags,
    pub members: Span<EnumMemberId>,
    /// The statement node of this declaration.
    pub stmt: StmtId,
}

#[derive(Copy, Clone, Debug)]
pub struct EnumMember {
    pub name: Atom,
    pub name_kind: NameKind,
    /// The `e` of `[e]` (`HasDynamicName`). `name` is `NONE` then. The checker reports such a name
    /// as an error and never checks `e`.
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
    /// `ModuleDeclaration.Keyword` is `module`. The `b` of `module a.b` has the same value as the
    /// `a`.
    pub specifies_module: bool,
    /// The statement node of this declaration.
    pub stmt: StmtId,
}

/// `core.ResolutionMode`. `None`: not specified; it is determined by the file and the syntax.
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

    /// `ForEachDynamicImportOrRequireCall`: in `file.Imports()` these come after the specifiers of
    /// the statements.
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
    /// `getModeForUsageLocation`: the value of `resolution-mode`, where it applies: after `import
    /// type` and `export type`, and in the import type `import("m", { with: { .. } })`.
    pub mode: ResolutionMode,
}

#[derive(Copy, Clone, Debug)]
pub struct Import {
    pub spec: Atom,
    pub default: Atom,
    pub default_pos: u32,
    pub namespace: Atom,
    pub namespace_pos: u32,
    /// Position of the token after `import`: the first token of the import clause.
    pub clause_start: u32,
    /// `importClause.End()`
    pub clause_end: u32,
    /// Position of the `*` of `* as namespace`.
    pub namespace_start: u32,
    pub named: Span<ImportSpecId>,
    pub type_only: bool,
    /// `importClause.PhaseModifier` is `defer`.
    pub is_deferred: bool,
    /// As in [`SpecifierUse`].
    pub mode: ResolutionMode,
    /// The statement node of this declaration.
    pub stmt: StmtId,
}

#[derive(Copy, Clone, Debug)]
pub struct ImportSpec {
    /// Position of its first token: `type`, or `imported_pos`.
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
    /// `parseImportSpecifier`: an identifier with empty text replaces a string that is not followed
    /// by `as`.
    pub fn is_name_missing(&self) -> bool {
        self.imported == crate::atom::known::empty && self.imported_pos == self.pos
    }
}

#[derive(Copy, Clone, Debug)]
pub enum ImportEqualsTarget {
    Require(Atom),
    Entity(Span<NameId>),
}

impl ImportEqualsTarget {
    /// The module specifier. `NONE`: this is an entity name, or the argument of `require` is not a
    /// string literal.
    #[inline]
    pub fn spec(self) -> Atom {
        match self {
            ImportEqualsTarget::Require(spec) => spec,
            ImportEqualsTarget::Entity(_) => Atom::NONE,
        }
    }
}

#[derive(Copy, Clone, Debug)]
pub struct ImportEquals {
    pub name: Atom,
    pub name_pos: u32,
    pub target: ImportEqualsTarget,
    /// The `e` of `require(e)` that is not a string literal, which is an error. `target` is
    /// `Require(NONE)` then.
    pub expression: ExprId,
    pub flags: Flags,
    /// The statement node of this declaration.
    pub stmt: StmtId,
}

#[derive(Copy, Clone, Debug)]
pub struct Export {
    /// `NONE` without `from`, and after `from` if it is not a string literal.
    pub spec: Atom,
    /// `node.ModuleSpecifier != nil`: it has `from`.
    pub has_module_specifier: bool,
    pub items: Span<ExportSpecId>,
    pub type_only: bool,
    /// As in [`SpecifierUse`].
    pub mode: ResolutionMode,
    /// The statement node of this declaration.
    pub stmt: StmtId,
}

#[derive(Copy, Clone, Debug)]
pub struct ExportSpec {
    /// Position of its first token: `type`, or `local_pos`.
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
    /// `node.End()`, excluding enclosing parentheses.
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
    /// `ReadonlyToken` is `+`: `+readonly`. It means what `readonly` means.
    pub is_readonly_with_plus: bool,
    /// `QuestionToken` is `+`: `+?`
    pub is_optional_with_plus: bool,
    /// The members after `[K in T]: X`, which are an error and which the checker never visits.
    pub members: Span<MemberId>,
}

impl Mapped {
    /// `ReadonlyToken` as the node builder prints it, which copies the token of the declaration.
    pub fn readonly_text(&self) -> &'static [u8] {
        match self.readonly {
            MappedModifier::None => b"",
            MappedModifier::Add if self.is_readonly_with_plus => b"+readonly ",
            MappedModifier::Add => b"readonly ",
            MappedModifier::Remove => b"-readonly ",
        }
    }

    /// `QuestionToken`, likewise.
    pub fn question_text(&self) -> &'static [u8] {
        match self.optional {
            MappedModifier::None => b"",
            MappedModifier::Add if self.is_optional_with_plus => b"+?",
            MappedModifier::Add => b"?",
            MappedModifier::Remove => b"-?",
        }
    }
}

/// An `Identifier` of an entity name that is not an expression: of `A.B.C` in a type reference, in
/// a heritage clause, after `import("m")`, in `import x = A.B.C`. The names of one entity name are
/// contiguous.
#[derive(Copy, Clone, Debug)]
pub struct Name {
    pub text: Atom,
    /// Its position. The top bit: it is preceded by a name and a dot.
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

/// `Type.Kind` of a `NamedTupleMember`.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum TupleMemberType {
    /// `name: T`
    Plain,
    /// `name: ...T`, a `RestType`, which is an error (`checkNamedTupleMember`).
    Rest,
    /// `name: T?`, an `OptionalType`, which is an error too.
    Optional,
}

#[derive(Copy, Clone, Debug)]
pub struct TupleElem {
    pub ty: TypeNodeId,
    /// `T` as it is written. It is `ty`, except in a `NamedTupleMember` that is an error, where `ty`
    /// is what the element means: `T | undefined` for `name: T?`, and the element type of an array
    /// type `T` for `name: ...T` and `...name?: T`.
    pub written: TypeNodeId,
    pub member_type: TupleMemberType,
    pub name: Atom,
    pub optional: bool,
    pub rest: bool,
    /// It starts with `...`. `...name?: T` does and is not `rest` (`getTupleElementFlags`).
    pub has_dots: bool,
    /// Position of its first token: the `...`, the name, or the type.
    pub start: u32,
    /// `node.End()`
    pub end: u32,
}

/// `Attributes` of an `ImportTypeNode`, by their `Token`.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum ImportAttributesToken {
    /// `Attributes == nil`
    None,
    /// `{ with: { .. } }`, or any other token in place of `with`, which is an error.
    With,
    /// `{ assert: { .. } }`
    Assert,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum JSDocTypeKind {
    /// `?T`, `T?`: a `JSDocNullableType`
    Nullable,
    /// `!T`, `T!`: a `JSDocNonNullableType`
    NonNullable,
    /// `T=`: a `JSDocOptionalType`. Only in a comment.
    Optional,
    /// `...T`: a `JSDocVariadicType`. Only in a comment.
    Variadic,
}

#[derive(Copy, Clone, Debug)]
pub enum TypeNodeKind {
    /// Syntax the type parser failed on.
    Error,
    /// An element of a heritage clause of an interface, or of an `implements` clause of a class,
    /// whose expression is not an entity name, which is an error: `extends f()`.
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
    /// `unique T`, where `T` is not the keyword `symbol`, which is an error.
    Unique(TypeNodeId),
    JSDoc {
        ty: TypeNodeId,
        kind: JSDocTypeKind,
        is_postfix: bool,
    },
    /// `typeof a.b.c<Args>`
    /// `expr` is `name` as an expression: its type at that position depends on narrowing by the
    /// preceding tests.
    Typeof {
        /// These HIR nodes are not tsgo nodes: `expr` is.
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
        /// See [`FileIn::attributes_of_import_type`].
        attributes: ImportAttributesToken,
    },
    /// `x is T`, `asserts x`, `asserts x is T`, `this is T`. `param` is `this` for the last.
    Predicate {
        param: Atom,
        ty: TypeNodeId,
        asserts: bool,
    },
}

/// The target of a JSDoc `@type` tag, where the HIR has no field for a type.
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

/// A node with `NodeFlagsHasJSDoc`.
#[derive(Copy, Clone, Debug)]
pub struct JsDocHost {
    /// The position of its first token.
    pub token: u32,
    /// From the start of the first of its JSDoc comments to the end of the last.
    pub comments: TextRange,
    /// The position of the name of its first `@satisfies` tag. `u32::MAX`: it has none.
    pub first_satisfies_tag: u32,
}

/// `ast.CommentDirective`
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct CommentDirective {
    /// `Loc`. For a `/* */` comment it starts at the start of the comment's last line.
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

/// The parser's output for one source file.
#[derive(Default)]
pub struct FileIn<S: Storage> {
    pub kind: FileKind,
    /// `.js`, `.jsx`, `.mjs`, `.cjs`. Parsed like `.tsx`: TypeScript-only syntax is accepted, and
    /// reported as an error afterwards.
    pub is_js: bool,
    /// `// @ts-check` (true) or `// @ts-nocheck` among the leading comments. The last one wins.
    pub check_directive: Option<bool>,
    /// A module even without module syntax: by its extension, or because the options force every
    /// file to be a module. Such a file can still be a CommonJS module.
    pub is_module_by_decree: bool,
    /// Has a top-level `import` or `export`.
    pub has_module_syntax: bool,
    /// The parser rejected the file: the HIR is partial or empty. Only parse errors are reported
    /// for it.
    pub has_errors: bool,
    /// The parser, the lowering pass or the binder ran out of stack: the HIR is partial or empty.
    /// The file is reported as not fully checked and the exit code is 1.
    pub ran_out_of_stack: bool,
    /// `@d`: the decorated node, and the expression. In source order.
    pub decorators: S::Few<(DecoratorOwner, ExprId)>,
    /// `experimentalDecorators`
    pub legacy_decorators: bool,
    /// Diagnostics produced while parsing and lowering the file.
    pub diagnostics: S::Kept<Diagnostic>,
    /// `hasParseDiagnostics`: the parser or the scanner reported an error. `grammarErrorOnNode` and the binder's checks of
    /// reserved names then report nothing.
    pub has_parse_diagnostics: bool,
    /// The number of pieces of type syntax the parser failed on.
    pub syntax_errors: u32,
    /// The position where the first of either was detected.
    pub error_pos: u32,
    pub source_len: u32,
    /// The source text, byte for byte: every position in here is an offset into it. Used for purely
    /// syntactic questions (which modifier, the position of a token), and to display error
    /// locations. Empty for the default library.
    /// The reader of the file retains it or transfers ownership (`Host::read`): it is not copied.
    pub text: S::Text,
    pub body: IdList<StmtId>,
    /// `/// <reference ... />`. The last field is the value of `resolution-mode=`, for a `types`
    /// reference only.
    pub references: S::Few<(ReferenceKind, Atom, u32, ResolutionMode)>,
    /// `CommentDirectives`, in order.
    pub comment_directives: S::Few<CommentDirective>,
    /// The span of the statement of each `with (e) statement`, from right after the `)` to its end.
    pub with_bodies: S::Few<(u32, u32)>,
    /// The position of the `{` of each function whose body is a block, except for a static block,
    /// where it is the `anchor`. Sorted.
    pub body_starts: S::List<(FnId, u32)>,
    /// The start of each token that follows a token the parser skipped in a list (`abortParsingListOrMoveToNextToken`). Sorted.
    pub after_skipped: S::Few<u32>,
    /// `node.Modifiers()` of a parameter, indexed by `ParamId`: see `param_modifiers`. Only as long
    /// as the last parameter with modifiers requires, and empty in most files. Deliberately a
    /// separate column and not a field of `Param`: few parameters have a modifier, and a field
    /// would cost every parameter.
    pub modifiers_of_params: S::List<Span<ModifierId>>,
    /// `node.Modifiers()` of the members of object literals that have any: see `prop_modifiers`.
    /// Sorted.
    pub modifiers_of_props: S::Few<(PropId, Span<ModifierId>)>,
    /// The array and object literals whose closing bracket is missing: their start, and their end,
    /// which is the end of the last token they consumed (`finishNode`). Sorted.
    pub unclosed_literals: S::Few<(u32, u32)>,
    /// The decorators of missing declarations and of `this` parameters, which `checkDecorators`
    /// never visits: the span from the start of the expression to the start of what follows the
    /// decorators. The expressions are separate statements.
    pub stray_decorators: S::Few<(u32, u32)>,
    /// The occurrences of module specifiers, except those of `import()`, which are expressions.
    pub specifier_uses: S::List<SpecifierUse>,

    /// The specifier of each `import.defer(..)`, and the position of the `)` of the call.
    pub deferred_import_calls: S::Few<(ExprId, u32)>,
    /// The specifier of each `import<T>(..)`, and the type arguments.
    pub import_call_type_args: S::Few<(ExprId, IdList<TypeNodeId>)>,
    /// `with { .. }` of imports, exports and import types, in source order: the start of `with` or
    /// of the token in its place, and the attributes as an `ExprKind::Object`.
    pub import_attributes: S::Few<(u32, ExprId)>,
    /// The module specifiers of imports and exports that are not string literals. They are bound,
    /// and nothing in them is checked.
    pub specifier_expressions: S::Few<ExprId>,
    /// Those of `ExportDeclaration`s, each with its statement, whose `spec` is `NONE`.
    pub exports_from_expressions: S::Few<(StmtId, ExprId)>,
    /// `ParenthesizedExpression`: the inner expression, the start and the end of the parentheses.
    /// Ordered by expression, and for nested parentheses around one expression innermost first.
    pub parens: S::List<(ExprId, u32, u32)>,
    /// `JsxExpression`: the inner expression, the start and the end of the braces. Ordered by
    /// expression.
    pub jsx_expressions: S::List<(ExprId, u32, u32)>,
    /// The JSX pragmas from the leading comments of this file.
    pub jsx_pragmas: JsxPragmas,
    /// The spans of the JSDoc comments of a JavaScript file. Sorted. A node whose position is
    /// inside one is synthesized from a tag.
    pub jsdoc_comments: S::Few<(u32, u32)>,
    /// The nodes that have JSDoc comments, in a JavaScript file in which one has a `@satisfies`
    /// tag. Sorted by `token`.
    pub jsdoc_hosts: S::Few<JsDocHost>,
    /// The types of `@type` tags on nodes that have no field for a type. Sorted by owner.
    pub jsdoc_types: S::Few<(JsDocTypeOwner, TypeNodeId)>,
    /// `@public`, `@private`, `@protected`, `@readonly` and `@override` on an assignment: the assignment and the modifiers. Sorted.
    pub jsdoc_modifiers: S::Few<(ExprId, Flags)>,
    /// `reparseJSDocComment`: the comment of the `@property` or `@param` tag that a member of a
    /// type literal is synthesized from (`GetTextOfJSDocComment`). Sorted.
    pub jsdoc_member_comments: S::Kept<(MemberId, Box<[u8]>)>,
    /// `checkUnmatchedJSDocParameters`, the part that only needs syntax: the function and the diagnostic for the name in its
    /// `@param` tag. 8024 and 8032 apply unless the function references `arguments`. 8029 applies if it does.
    pub jsdoc_param_errors: S::Kept<(FnId, Diagnostic)>,
    /// The functions whose JSDoc comment has a `@param` tag with a name: for each of them
    /// `checkUnmatchedJSDocParameters` calls `containsArgumentsReference`. Those of
    /// `jsdoc_param_errors` are among them, in the same order.
    pub functions_with_param_tags: S::Few<FnId>,

    pub ids: S::List<u32>,
    pub numbers: S::List<f64>,
    pub exprs: S::List<Expr>,
    pub stmts: S::List<Stmt>,
    pub types: S::List<TypeNode>,
    pub pats: S::List<Pat>,
    pub pat_props: S::List<PatProp>,
    pub pat_elems: S::List<PatElem>,
    pub fns: S::List<Func>,
    pub params: S::List<Param>,
    pub type_params: S::List<TypeParam>,
    pub classes: S::List<Class>,
    pub interfaces: S::List<Interface>,
    pub aliases: S::List<Alias>,
    pub enums: S::Few<Enum>,
    pub enum_members: S::Few<EnumMember>,
    pub modules: S::Few<Module>,
    pub members: S::List<Member>,
    pub props: S::List<Prop>,
    pub var_decls: S::List<VarDecl>,
    pub calls: S::List<Call>,
    pub cases: S::List<Case>,
    pub jsx: S::Few<Jsx>,
    pub imports: S::List<Import>,
    pub import_specs: S::List<ImportSpec>,
    pub import_equals: S::Few<ImportEquals>,
    pub exports: S::List<Export>,
    pub export_specs: S::List<ExportSpec>,
    pub tuple_elems: S::Few<TupleElem>,
    pub mapped: S::Few<Mapped>,
    pub modifiers: S::List<Modifier>,
    pub names: S::List<Name>,
    /// See node.rs. Set by `finish_nodes`.
    pub bases: NodeBases,
    pub fn_nodes: S::List<Node>,
    pub class_nodes: S::List<Node>,
    pub lazy: S::Lazy,
    /// The position of each `Identifier` whose text is one of `Atom::is_keyword_identifier`, or the
    /// start of its parent node.
    /// In the order the parser encountered them, including those in syntax it abandoned.
    pub keyword_identifier_positions: S::Few<u32>,
}

/// The HIR of a file that has been loaded.
pub type File<'s> = FileIn<InArena<'s>>;
/// The HIR of a file that is being parsed.
pub type FileBuilder = FileIn<Growable>;

macro_rules! arenas {
    ($($field:ident: $node:ident => $id:ident, $add:ident, $add_all:ident;)*) => {
        impl FileBuilder {
            $(
                #[inline]
                pub fn $add(&mut self, node: $node) -> $id {
                    let id = $id(self.$field.len() as u32);
                    self.$field.push(node);
                    id
                }
                /// Nodes that must be contiguous are collected first and appended together.
                #[inline]
                pub fn $add_all(&mut self, nodes: &[$node]) -> Span<$id> {
                    let start = self.$field.len() as u32;
                    self.$field.extend_from_slice(nodes);
                    Span::new(start, nodes.len() as u32)
                }
            )*
        }
        $(
            impl<S: Storage> std::ops::Index<$id> for FileIn<S> {
                type Output = $node;
                #[inline]
                fn index(&self, id: $id) -> &$node {
                    &self.$field[id.idx()]
                }
            }
            impl<S: Storage> std::ops::IndexMut<$id> for FileIn<S> {
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

impl<S: Storage> FileIn<S> {
    /// `node.Modifiers()` of the parameter `p`: keywords and decorators, in source order.
    #[inline]
    pub fn param_modifiers(&self, p: ParamId) -> Span<ModifierId> {
        self.modifiers_of_params
            .get(p.idx())
            .copied()
            .unwrap_or(Span::EMPTY)
    }
    /// `node.Modifiers()` of the member `p` of an object literal.
    pub fn prop_modifiers(&self, p: PropId) -> Span<ModifierId> {
        let found = self
            .modifiers_of_props
            .binary_search_by_key(&p.0, |of| of.0.0);
        found.map_or(Span::EMPTY, |at| self.modifiers_of_props[at].1)
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
    /// `Attributes` of the `ImportTypeNode` `node`, an `ExprKind::Object`: the first ones after its
    /// argument.
    pub fn attributes_of_import_type(&self, node: TypeNodeId) -> Option<ExprId> {
        let TypeNodeKind::Import {
            spec,
            args,
            attributes,
            ..
        } = self[node].kind
        else {
            return None;
        };
        if attributes == ImportAttributesToken::None {
            return None;
        }
        // An argument that is not a string is in `args`.
        let argument_end = match self.ids(args).next() {
            Some(argument) if spec.is_none() => self[argument].end,
            _ => self[node].pos,
        };
        let mut all = self.import_attributes.iter();
        all.find(|of| of.0 > argument_end).map(|of| of.1)
    }
    /// Sets the kind of `stmt` to `kind`, and records `stmt` in the declaration it holds.
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
    /// `ModifiersToFlags`
    pub fn modifiers_to_flags(&self, list: Span<ModifierId>) -> Flags {
        let mut flags = Flags::empty();
        for modifier in self.modifier_list(list) {
            flags |= modifier.kind.flag();
        }
        flags
    }
    /// The position of the first `flag` in `list`.
    pub fn find_modifier(&self, list: Span<ModifierId>, flag: Flags) -> Option<u32> {
        self.modifier_list(list)
            .iter()
            .find(|modifier| modifier.kind == ModifierKind::Keyword(flag))
            .map(|modifier| modifier.pos)
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
    /// `NodeFlagsInWithStatement` for the node at `pos`.
    pub fn is_in_with(&self, pos: u32) -> bool {
        self.with_bodies
            .iter()
            .any(|&(start, end)| (start..end).contains(&pos))
    }

    /// `NodeFlagsJSDoc`, `NodeFlagsReparsed` for the node at `pos`: it is in a JSDoc comment of a
    /// JavaScript file.
    pub fn is_in_jsdoc(&self, pos: u32) -> bool {
        let after = self.jsdoc_comments.partition_point(|c| c.0 <= pos);
        after > 0 && pos < self.jsdoc_comments[after - 1].1
    }

    /// `NodeFlagsHasJSDoc` for a node whose first token is at `token`. See `jsdoc_hosts`.
    pub fn jsdoc_host_at(&self, token: u32) -> Option<&JsDocHost> {
        let index = self
            .jsdoc_hosts
            .binary_search_by_key(&token, |host| host.token);
        index.ok().map(|index| &self.jsdoc_hosts[index])
    }

    /// The type that a `@type` tag assigns to `owner`. `NONE` if there is none.
    pub fn jsdoc_type(&self, owner: JsDocTypeOwner) -> TypeNodeId {
        match self.jsdoc_types.binary_search_by_key(&owner, |t| t.0) {
            Ok(index) => self.jsdoc_types[index].1,
            Err(_) => TypeNodeId::NONE,
        }
    }

    /// The modifiers that JSDoc tags add to the assignment `e`.
    pub fn jsdoc_comment_of_member(&self, m: MemberId) -> &[u8] {
        match self
            .jsdoc_member_comments
            .binary_search_by_key(&m, |it| it.0)
        {
            Ok(index) => &self.jsdoc_member_comments[index].1,
            Err(_) => b"",
        }
    }

    pub fn jsdoc_modifiers_of(&self, e: ExprId) -> Flags {
        match self.jsdoc_modifiers.binary_search_by_key(&e, |m| m.0) {
            Ok(index) => self.jsdoc_modifiers[index].1,
            Err(_) => Flags::empty(),
        }
    }

    #[inline]
    pub fn ids<T: From<u32>>(
        &self,
        list: IdList<T>,
    ) -> impl DoubleEndedIterator<Item = T> + ExactSizeIterator + Clone + '_ {
        self.ids[list.range()].iter().map(|&i| T::from(i))
    }

    /// The texts of the names of an entity name.
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
}

impl FileBuilder {
    pub fn set_param_modifiers(&mut self, p: ParamId, list: Span<ModifierId>) {
        if list.is_empty() {
            return;
        }
        if self.modifiers_of_params.len() <= p.idx() {
            self.modifiers_of_params.resize(p.idx() + 1, Span::EMPTY);
        }
        self.modifiers_of_params[p.idx()] = list;
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
    #[inline]
    pub fn ty(&mut self, kind: TypeNodeKind, pos: u32, end: u32) -> TypeNodeId {
        self.add_type_node(TypeNode { kind, pos, end })
    }
    #[inline]
    pub fn pat(&mut self, kind: PatKind, pos: u32, end: u32) -> PatId {
        self.add_pat_node(Pat { kind, pos, end })
    }
    pub fn number(&mut self, value: f64) -> u32 {
        self.numbers.push(value);
        self.numbers.len() as u32 - 1
    }
    pub fn list<T: Copy + Into<u32>>(&mut self, items: &[T]) -> IdList<T> {
        let start = self.ids.len() as u32;
        self.ids.extend(items.iter().map(|&i| i.into()));
        IdList::new(start, items.len() as u32)
    }
    /// `A.B.C`: each name with its position.
    pub fn entity_name(&mut self, names: impl Iterator<Item = (Atom, u32)>) -> Span<NameId> {
        let start = self.names.len();
        self.names
            .extend(names.map(|(text, place)| Name { text, place }));
        for name in self.names.iter_mut().skip(start + 1) {
            name.place |= Name::QUALIFIED;
        }
        Span::new(start as u32, (self.names.len() - start) as u32)
    }
    /// `before.text`, appended as the parser reaches it.
    pub fn append_to_entity_name(
        &mut self,
        before: Span<NameId>,
        text: Atom,
        place: u32,
    ) -> Span<NameId> {
        let mut start = before.start;
        // Other names have been added since.
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

impl FileBuilder {
    /// Adds a diagnostic without arguments for the range `start..end`.
    pub fn error(&mut self, kind: DiagnosticKind, start: u32, end: u32, code: u32) {
        let diagnostic = Diagnostic::new(kind, (start, end), code, &[]);
        self.diagnostics.push(diagnostic);
    }

    /// The file with every list at its final size in `arena`, which is one of `session`. Also
    /// returns the long lists, emptied: the next file that the thread parses reuses their capacity.
    pub fn into_arena<'s>(
        mut self,
        arena: &'s Arena,
        session: &'s Session,
    ) -> (File<'s>, FileBuilder) {
        let file = File {
            kind: self.kind,
            is_js: self.is_js,
            check_directive: self.check_directive,
            is_module_by_decree: self.is_module_by_decree,
            has_module_syntax: self.has_module_syntax,
            has_errors: self.has_errors,
            ran_out_of_stack: self.ran_out_of_stack,
            decorators: few_to_arena(self.decorators, arena),
            legacy_decorators: self.legacy_decorators,
            diagnostics: Cow::Owned(self.diagnostics),
            has_parse_diagnostics: self.has_parse_diagnostics,
            syntax_errors: self.syntax_errors,
            error_pos: self.error_pos,
            source_len: self.source_len,
            text: self.text,
            body: self.body,
            references: few_to_arena(self.references, arena),
            comment_directives: few_to_arena(self.comment_directives, arena),
            with_bodies: few_to_arena(self.with_bodies, arena),
            body_starts: copy_to_arena(&mut self.body_starts, arena),
            after_skipped: few_to_arena(self.after_skipped, arena),
            modifiers_of_params: copy_to_arena(&mut self.modifiers_of_params, arena),
            modifiers_of_props: few_to_arena(self.modifiers_of_props, arena),
            unclosed_literals: few_to_arena(self.unclosed_literals, arena),
            stray_decorators: few_to_arena(self.stray_decorators, arena),
            specifier_uses: copy_to_arena(&mut self.specifier_uses, arena),
            deferred_import_calls: few_to_arena(self.deferred_import_calls, arena),
            import_call_type_args: few_to_arena(self.import_call_type_args, arena),
            import_attributes: few_to_arena(self.import_attributes, arena),
            specifier_expressions: few_to_arena(self.specifier_expressions, arena),
            exports_from_expressions: few_to_arena(self.exports_from_expressions, arena),
            parens: copy_to_arena(&mut self.parens, arena),
            jsx_expressions: copy_to_arena(&mut self.jsx_expressions, arena),
            jsx_pragmas: self.jsx_pragmas,
            jsdoc_comments: few_to_arena(self.jsdoc_comments, arena),
            jsdoc_hosts: few_to_arena(self.jsdoc_hosts, arena),
            jsdoc_types: few_to_arena(self.jsdoc_types, arena),
            jsdoc_modifiers: few_to_arena(self.jsdoc_modifiers, arena),
            jsdoc_member_comments: Cow::Owned(self.jsdoc_member_comments),
            jsdoc_param_errors: Cow::Owned(self.jsdoc_param_errors),
            functions_with_param_tags: few_to_arena(self.functions_with_param_tags, arena),
            ids: copy_to_arena(&mut self.ids, arena),
            numbers: copy_to_arena(&mut self.numbers, arena),
            exprs: copy_to_arena(&mut self.exprs, arena),
            stmts: copy_to_arena(&mut self.stmts, arena),
            types: copy_to_arena(&mut self.types, arena),
            pats: copy_to_arena(&mut self.pats, arena),
            pat_props: copy_to_arena(&mut self.pat_props, arena),
            pat_elems: copy_to_arena(&mut self.pat_elems, arena),
            fns: copy_to_arena(&mut self.fns, arena),
            params: copy_to_arena(&mut self.params, arena),
            type_params: copy_to_arena(&mut self.type_params, arena),
            classes: copy_to_arena(&mut self.classes, arena),
            interfaces: copy_to_arena(&mut self.interfaces, arena),
            aliases: copy_to_arena(&mut self.aliases, arena),
            enums: few_to_arena(self.enums, arena),
            enum_members: few_to_arena(self.enum_members, arena),
            modules: few_to_arena(self.modules, arena),
            members: copy_to_arena(&mut self.members, arena),
            props: copy_to_arena(&mut self.props, arena),
            var_decls: copy_to_arena(&mut self.var_decls, arena),
            calls: copy_to_arena(&mut self.calls, arena),
            cases: copy_to_arena(&mut self.cases, arena),
            jsx: few_to_arena(self.jsx, arena),
            imports: copy_to_arena(&mut self.imports, arena),
            import_specs: copy_to_arena(&mut self.import_specs, arena),
            import_equals: few_to_arena(self.import_equals, arena),
            exports: copy_to_arena(&mut self.exports, arena),
            export_specs: copy_to_arena(&mut self.export_specs, arena),
            tuple_elems: few_to_arena(self.tuple_elems, arena),
            mapped: few_to_arena(self.mapped, arena),
            modifiers: copy_to_arena(&mut self.modifiers, arena),
            names: copy_to_arena(&mut self.names, arena),
            bases: self.bases,
            fn_nodes: copy_to_arena(&mut self.fn_nodes, arena),
            class_nodes: copy_to_arena(&mut self.class_nodes, arena),
            lazy: Lazy {
                session,
                parents: OnceLock::new(),
                ambient_or_type_places: OnceLock::new(),
                keyword_identifiers: OnceLock::new(),
            },
            keyword_identifier_positions: few_to_arena(self.keyword_identifier_positions, arena),
        };
        let mut emptied = FileBuilder::default();
        macro_rules! each {
            ($($f:ident),*) => { $(emptied.$f = self.$f;)* };
        }
        long_lists!(each);
        (file, emptied)
    }
}

impl<'s> File<'s> {
    /// A file without nodes.
    pub fn empty_in(arena: &'s Arena, session: &'s Session) -> File<'s> {
        FileBuilder::default().into_arena(arena, session).0
    }

    /// The arena that the lists are in.
    pub fn arena(&self) -> &'s Arena {
        self.exprs.allocator()
    }
}

/// `IsParenthesizedExpression` for the immediate parent of `e`.
#[inline]
pub fn is_parenthesized(hir: &File, e: ExprId) -> bool {
    open_parenthesis(hir, e).is_some()
}

/// The start of the outermost parentheses around `e`, if any.
#[inline]
pub fn open_parenthesis(hir: &File, e: ExprId) -> Option<u32> {
    parentheses_around(hir, e).last().map(|p| p.1)
}

/// The parentheses around `e`, the innermost first.
#[inline]
pub fn parentheses_around<S: Storage>(hir: &FileIn<S>, e: ExprId) -> &[(ExprId, u32, u32)] {
    let first = hir.parens.partition_point(|p| p.0.0 < e.0);
    let count = hir.parens[first..].partition_point(|p| p.0 == e);
    &hir.parens[first..first + count]
}

/// `node.End()` of `e`, including enclosing parentheses.
pub fn end_of_expr<S: Storage>(hir: &FileIn<S>, e: ExprId) -> u32 {
    parentheses_around(hir, e)
        .last()
        .map_or(hir[e].end, |outermost| outermost.2)
}

/// The span of the `JsxExpression` whose entire content is `e`.
pub fn jsx_expression_around(hir: &File, e: ExprId) -> Option<(u32, u32)> {
    let found = hir
        .jsx_expressions
        .binary_search_by_key(&e.0, |braces| braces.0.0);
    found
        .ok()
        .map(|i| (hir.jsx_expressions[i].1, hir.jsx_expressions[i].2))
}

/// The start of `e`, including enclosing parentheses.
pub fn start_of(hir: &File, e: ExprId) -> u32 {
    open_parenthesis(hir, e).unwrap_or_else(|| start_inside_parentheses(hir, e))
}

/// `GetTokenPosOfNode`: the start of `e`, excluding parentheses around the whole of it.
#[inline]
pub fn start_inside_parentheses(hir: &File, e: ExprId) -> u32 {
    match hir[e].kind {
        // Its decorators are part of it.
        ExprKind::Class(c) => hir[c].start,
        _ => hir[e].pos,
    }
}

/// `IsPrivateIdentifier` for the name at `pos`.
#[inline]
pub fn is_private_name_at(hir: &File, pos: u32) -> bool {
    hir.text.get(pos as usize) == Some(&b'#')
}

/// `IsBigIntLiteral` for the token at `pos`: a number that ends in `n`.
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

/// `IsEntityNameExpression`: `a`, `a.b.c`. A missing expression is an Identifier with empty text
/// (`createMissingIdentifier`).
pub fn is_entity_name_expression(hir: &File, e: ExprId) -> bool {
    !is_parenthesized(hir, e)
        && (matches!(hir[e].kind, ExprKind::Ident(_) | ExprKind::Missing)
            || is_property_access_entity_name_expression(hir, e))
}

/// `IsPropertyAccessEntityNameExpression` for `e` itself, ignoring enclosing parentheses.
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

/// `IsDynamicName` for the name `[e]`.
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

/// `isNarrowableReference`
pub fn is_narrowable_reference(hir: &File, e: ExprId) -> bool {
    match hir[e].kind {
        ExprKind::Ident(_)
        | ExprKind::This
        | ExprKind::Super
        | ExprKind::NewTarget(_)
        | ExprKind::ImportMeta => true,
        ExprKind::Dot { obj, .. } => is_narrowable_reference(hir, obj),
        ExprKind::NonNull(x) => is_narrowable_reference(hir, x),
        // With a literal key the object is not checked.
        ExprKind::Index { obj, index, .. } => {
            is_string_or_numeric_literal_like(hir, index)
                || is_entity_name_expression(hir, index) && is_narrowable_reference(hir, obj)
        }
        ExprKind::Binary {
            op: BinOp::Comma,
            right,
            ..
        } => is_narrowable_reference(hir, right),
        ExprKind::Assign { target, .. } => is_left_hand_side_expression(hir, target),
        _ => false,
    }
}

/// `IsLeftHandSideExpression`
pub fn is_left_hand_side_expression(hir: &File, e: ExprId) -> bool {
    is_parenthesized(hir, e)
        || match hir[e].kind {
            ExprKind::Fn(f) => hir[f].kind != FnKind::Arrow,
            ExprKind::Unary { .. }
            | ExprKind::Binary { .. }
            | ExprKind::Assign { .. }
            | ExprKind::Cond { .. }
            | ExprKind::Spread(_)
            | ExprKind::Await(_)
            | ExprKind::Yield { .. }
            | ExprKind::As { .. }
            | ExprKind::Satisfies { .. }
            | ExprKind::AsConst(_) => false,
            _ => true,
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

/// The names `pat` binds, each with its identifier pattern.
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
