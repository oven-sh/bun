//! Syntax-only TypeScript nodes.
//!
//! By default the parser skips TypeScript types. In keep mode the same code builds these nodes instead. They record what was written
//! and nothing else: no symbols, no scopes, no resolved types. A later pass clones them into the type checker's own tree.
//!
//! Nodes live in typed arrays allocated with `AstAlloc`, like the rest of the AST, and refer to each other by 4-byte ids. Names are
//! slices of the source. Expressions and statements written inside types are ordinary `Expr` and `Stmt` values.
//!
//! A speculative parse that is abandoned leaves unreachable nodes behind. Nothing iterates over the arrays, so that is harmless.

use core::marker::PhantomData;

use bun_alloc::{AstAlloc, AstVec};

use crate::{Expr, Loc, Stmt, StoreSlice, StoreStr};

/// A 4-byte handle to a node in one of the arrays of [`Syntax`].
#[repr(transparent)]
pub struct Id<T>(u32, PhantomData<fn() -> T>);

impl<T> Id<T> {
    pub const NONE: Self = Id(u32::MAX, PhantomData);

    #[inline]
    pub const fn is_none(self) -> bool {
        self.0 == u32::MAX
    }

    #[inline]
    pub const fn is_some(self) -> bool {
        self.0 != u32::MAX
    }

    #[inline]
    pub const fn index(self) -> usize {
        self.0 as usize
    }
}

impl<T> Copy for Id<T> {}
impl<T> Clone for Id<T> {
    #[inline]
    fn clone(&self) -> Self {
        *self
    }
}
impl<T> PartialEq for Id<T> {
    #[inline]
    fn eq(&self, other: &Self) -> bool {
        self.0 == other.0
    }
}
impl<T> Eq for Id<T> {}
impl<T> Default for Id<T> {
    #[inline]
    fn default() -> Self {
        Self::NONE
    }
}

/// Consecutive nodes in the array that holds `T`.
pub struct Span<T> {
    start: u32,
    len: u32,
    marker: PhantomData<fn() -> T>,
}

impl<T> Span<T> {
    pub const EMPTY: Self = Span {
        start: 0,
        len: 0,
        marker: PhantomData,
    };

    #[inline]
    pub const fn len(self) -> usize {
        self.len as usize
    }

    #[inline]
    pub const fn is_empty(self) -> bool {
        self.len == 0
    }

    #[inline]
    pub fn iter(self) -> impl ExactSizeIterator<Item = Id<T>> {
        (self.start..self.start + self.len).map(|index| Id(index, PhantomData))
    }

    #[inline]
    pub fn get(self, index: usize) -> Option<Id<T>> {
        (index < self.len()).then(|| Id(self.start + index as u32, PhantomData))
    }
}

impl<T> Copy for Span<T> {}
impl<T> Clone for Span<T> {
    #[inline]
    fn clone(&self) -> Self {
        *self
    }
}
impl<T> Default for Span<T> {
    #[inline]
    fn default() -> Self {
        Self::EMPTY
    }
}

/// A list of ids, for children that were not created one after the other. Stored in [`Syntax::ids`].
pub struct IdList<T> {
    start: u32,
    len: u32,
    marker: PhantomData<fn() -> T>,
}

impl<T> IdList<T> {
    pub const EMPTY: Self = IdList {
        start: 0,
        len: 0,
        marker: PhantomData,
    };

    #[inline]
    pub const fn len(self) -> usize {
        self.len as usize
    }

    #[inline]
    pub const fn is_empty(self) -> bool {
        self.len == 0
    }
}

impl<T> Copy for IdList<T> {}
impl<T> Clone for IdList<T> {
    #[inline]
    fn clone(&self) -> Self {
        *self
    }
}
impl<T> Default for IdList<T> {
    #[inline]
    fn default() -> Self {
        Self::EMPTY
    }
}

pub type TypeId = Id<Type>;
pub type NameId = Id<Name>;
pub type MemberId = Id<Member>;
pub type SignatureId = Id<Signature>;
pub type TypeParamId = Id<TypeParam>;
pub type PatternId = Id<Pattern>;
pub type MappedTypeId = Id<MappedType>;
pub type ImportTypeId = Id<ImportType>;
pub type StatementId = Id<Statement>;

bitflags::bitflags! {
    /// Modifiers and other one-bit facts about a declaration, on whatever they can be written on.
    #[derive(Copy, Clone, PartialEq, Eq, Debug, Default)]
    pub struct Flags: u32 {
        const EXPORT = 1 << 0;
        const DEFAULT = 1 << 1;
        /// `declare`
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
        /// `const enum`, `<const T>`
        const CONST = 1 << 14;
        const REST = 1 << 15;
        /// `x!: T`
        const DEFINITE = 1 << 16;
        const TYPE_ONLY = 1 << 17;
        const IN = 1 << 18;
        const OUT = 1 << 19;
        /// The name is written as a string: `"0": T`
        const STRING_NAME = 1 << 23;
    }
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
    /// Directly after the `=` of a type alias.
    Intrinsic,
}

#[derive(Copy, Clone)]
pub struct Name {
    pub text: StoreStr,
    pub loc: Loc,
}

#[derive(Copy, Clone)]
pub struct Type {
    pub data: TypeData,
    pub loc: Loc,
    /// `node.End()`. `EMPTY` until the type is finished.
    pub end: Loc,
}

#[derive(Copy, Clone)]
pub enum TypeData {
    Keyword(Keyword),
    /// `A.B.C<Args>`. Where a type must be and none starts, the one name is empty.
    Reference {
        name: Span<Name>,
        args: IdList<Type>,
    },
    StringLiteral(StoreStr),
    /// An index into [`Syntax::numbers`].
    NumberLiteral(u32),
    BigIntLiteral {
        text: StoreStr,
        negative: bool,
    },
    BooleanLiteral(bool),
    /// `` `a${T}b` ``. There is one more text than there are types.
    TemplateLiteral {
        types: IdList<Type>,
        texts: Span<StoreStr>,
    },
    Array(TypeId),
    Tuple(Span<TupleElement>),
    Union(IdList<Type>),
    Intersection(IdList<Type>),
    /// `(a: A) => R`, `new (a: A) => R`
    Function(SignatureId),
    Object(Span<Member>),
    Conditional {
        check: TypeId,
        extends: TypeId,
        when_true: TypeId,
        when_false: TypeId,
    },
    Infer(TypeParamId),
    Mapped(MappedTypeId),
    IndexedAccess {
        object: TypeId,
        index: TypeId,
    },
    Keyof(TypeId),
    Readonly(TypeId),
    UniqueSymbol,
    /// `unique T` where `T` is not `symbol`, which is an error.
    UniqueOperator(TypeId),
    /// `typeof a.b.c<Args>`
    Typeof {
        name: Span<Name>,
        args: IdList<Type>,
    },
    /// `import("specifier").A.B<Args>`, `typeof import("specifier")`
    Import(ImportTypeId),
    /// `x is T`, `asserts x`, `asserts x is T`, `this is T`. `ty` is `NONE` for the second.
    Predicate {
        param: NameId,
        ty: TypeId,
        asserts: bool,
    },
    /// `T?`, `?T`: JSDoc syntax, which is an error.
    JsDocNullable {
        operand: TypeId,
        is_postfix: bool,
    },
    /// `T!`, `!T`: JSDoc syntax, which is an error.
    JsDocNonNullable {
        operand: TypeId,
        is_postfix: bool,
    },
    /// `*`: JSDoc syntax, which is an error.
    JsDocAll,
    /// `[label: T?]`, which is an error. Only as the type of a labeled tuple element.
    Optional(TypeId),
    /// `[label: ...T]`, which is an error. Only as the type of a labeled tuple element.
    Rest(TypeId),
    /// `interface A extends f()`: a base that is not an entity name, which is an error. The expression is not kept.
    HeritageExpression,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug, Default)]
pub enum ResolutionMode {
    #[default]
    None,
    Import,
    Require,
}

#[derive(Copy, Clone)]
pub struct ImportType {
    pub specifier: StoreStr,
    pub specifier_loc: Loc,
    /// `import(T)`: the argument when it is not a string literal, which is an error. `NONE` otherwise.
    pub argument: TypeId,
    pub name: Span<Name>,
    pub args: IdList<Type>,
    pub is_typeof: bool,
    /// From `{ with: { "resolution-mode": "import" } }`.
    pub mode: ResolutionMode,
    /// Where `assert` is written instead of `with`.
    pub assert_keyword_loc: Option<Loc>,
}

#[derive(Copy, Clone)]
pub struct TupleElement {
    pub ty: TypeId,
    pub label: Option<StoreStr>,
    pub is_optional: bool,
    pub is_rest: bool,
    pub loc: Loc,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum MappedModifier {
    None,
    Add,
    Remove,
}

/// `{ readonly [K in T as N]?: X }`
#[derive(Copy, Clone)]
pub struct MappedType {
    pub param: TypeParamId,
    pub name_type: TypeId,
    pub ty: TypeId,
    pub readonly: MappedModifier,
    pub optional: MappedModifier,
    /// Where the first member after `[K in T]: X` is reported.
    pub extra_member_loc: Option<Loc>,
    /// The members after `[K in T]: X`, which are an error.
    pub members: Span<Member>,
}

#[derive(Copy, Clone)]
pub struct TypeParam {
    pub name: StoreStr,
    pub loc: Loc,
    /// Of its first token: a modifier, or the name.
    pub start: Loc,
    /// `node.End()`
    pub end: Loc,
    pub constraint: TypeId,
    pub default: TypeId,
    /// `const`, `in`, `out`
    pub flags: Flags,
}

#[derive(Copy, Clone)]
pub enum PropertyKey {
    None,
    /// An identifier, a keyword or a string.
    Name(StoreStr),
    /// An index into [`Syntax::numbers`].
    Number(u32),
    /// `1n`, which is an error. It names nothing.
    BigInt,
    Private(StoreStr),
    /// `[expression]`
    Computed(Expr),
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum MemberKind {
    Property,
    Method,
    Getter,
    Setter,
    CallSignature,
    ConstructSignature,
    IndexSignature,
}

#[derive(Copy, Clone)]
pub struct Modifier {
    /// Exactly one flag.
    pub flag: Flags,
    pub loc: Loc,
}

/// A member of an object type or an interface.
#[derive(Copy, Clone)]
pub struct Member {
    pub kind: MemberKind,
    pub key: PropertyKey,
    pub flags: Flags,
    /// In source order.
    pub modifiers: Span<Modifier>,
    pub ty: TypeId,
    /// `name: T = expression`, which is an error.
    pub initializer: Option<Expr>,
    /// `[key: K,]: T`: where the comma is, which is an error.
    pub trailing_comma_loc: Option<Loc>,
    pub signature: SignatureId,
    pub loc: Loc,
    /// Of its first token: a modifier, `get`, `set`, or `loc`.
    pub start: Loc,
    /// `node.Pos()`
    pub full_start: Loc,
    /// `node.End()`
    pub end: Loc,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum SignatureKind {
    Method,
    Getter,
    Setter,
    CallSignature,
    ConstructSignature,
    FunctionType,
    ConstructorType,
    IndexSignature,
}

#[derive(Copy, Clone)]
pub struct FunctionBody {
    /// Of the `{`.
    pub loc: Loc,
    pub stmts: StoreSlice<Stmt>,
}

/// `<T>(this: A, b: B): R`
#[derive(Copy, Clone)]
pub struct Signature {
    pub kind: SignatureKind,
    pub flags: Flags,
    pub type_params: Span<TypeParam>,
    pub params: Span<Param>,
    pub return_type: TypeId,
    /// `get name() { .. }` in a type, which is an error.
    pub body: Option<FunctionBody>,
    pub open_paren_loc: Loc,
    pub loc: Loc,
}

#[derive(Copy, Clone)]
pub struct Param {
    pub pattern: PatternId,
    pub ty: TypeId,
    /// `name = expression`, which is an error in a signature without a body.
    pub default: Option<Expr>,
    /// `?`, `...`, and the modifiers.
    pub flags: Flags,
    /// `public name`, which is an error outside a constructor. In source order.
    pub modifiers: Span<Modifier>,
    /// Of the `...` and of the `?`, if `flags` has them. Only error messages need them.
    pub rest_loc: Loc,
    pub question_loc: Loc,
    pub loc: Loc,
    /// `node.End()`
    pub end: Loc,
}

impl Param {
    /// The parameter whose first token is at `loc`, before anything of it is read.
    pub fn at(loc: Loc) -> Param {
        Param {
            pattern: PatternId::NONE,
            ty: TypeId::NONE,
            default: None,
            flags: Flags::empty(),
            modifiers: Span::EMPTY,
            rest_loc: Loc::EMPTY,
            question_loc: Loc::EMPTY,
            loc,
            end: Loc::EMPTY,
        }
    }
}

/// A binding in the parameter list of a signature. It declares nothing, so it is not a `Binding`.
#[derive(Copy, Clone)]
pub struct Pattern {
    pub data: PatternData,
    pub loc: Loc,
}

#[derive(Copy, Clone)]
pub enum PatternData {
    /// An elided array element.
    Missing,
    Identifier(StoreStr),
    Object(Span<PatternProperty>),
    Array(Span<PatternElement>),
}

#[derive(Copy, Clone)]
pub struct PatternProperty {
    pub key: PropertyKey,
    pub value: PatternId,
    pub default: Option<Expr>,
    pub is_rest: bool,
    pub loc: Loc,
}

#[derive(Copy, Clone)]
pub struct PatternElement {
    pub pattern: PatternId,
    pub default: Option<Expr>,
    pub is_rest: bool,
    /// Of its first token: the `...`, or the pattern.
    pub loc: Loc,
}

/// A statement that only exists in TypeScript. The parser leaves an `S::TypeScript` placeholder in the statement list, which refers to
/// this node.
#[derive(Copy, Clone)]
pub struct Statement {
    pub data: StatementData,
    /// `export`, `default`, `declare`, in source order.
    pub modifiers: Span<Modifier>,
    /// Of the keyword after the modifiers.
    pub loc: Loc,
}

#[derive(Copy, Clone)]
pub enum StatementData {
    Interface(Id<Interface>),
    TypeAlias(Id<TypeAlias>),
}

#[derive(Copy, Clone)]
pub struct Interface {
    pub name: Name,
    pub type_params: Span<TypeParam>,
    /// The types of the first `extends` clause.
    pub extends: IdList<Type>,
    /// The types of its other heritage clauses.
    pub other_heritage: IdList<Type>,
    /// `interface A implements B`, which is an error.
    pub has_implements_clause: bool,
    /// Where the heritage clauses break a grammar rule, and TypeScript's error code: an empty list or a trailing comma in the first
    /// `extends` clause, then a second `extends` clause.
    pub heritage_errors: [Option<(Loc, u32)>; 2],
    pub members: Span<Member>,
}

#[derive(Copy, Clone)]
pub struct TypeAlias {
    pub name: Name,
    pub type_params: Span<TypeParam>,
    pub ty: TypeId,
}

macro_rules! define_syntax {
    ($($array:ident: $node:ty, $add_one:ident, $add_many:ident;)*) => {
        /// Every TypeScript syntax node of one file.
        pub struct Syntax {
            /// Backing storage for [`IdList`].
            pub ids: AstVec<u32>,
            pub numbers: AstVec<f64>,
            $(pub $array: AstVec<$node>,)*
        }

        impl Syntax {
            pub fn new() -> Self {
                Syntax { ids: AstAlloc::vec(), numbers: AstAlloc::vec(), $($array: AstAlloc::vec(),)* }
            }

            $(
                #[inline]
                pub fn $add_one(&mut self, node: $node) -> Id<$node> {
                    self.$array.push(node);
                    Id((self.$array.len() - 1) as u32, PhantomData)
                }

                #[inline]
                pub fn $add_many(&mut self, nodes: &[$node]) -> Span<$node> {
                    let start = self.$array.len() as u32;
                    self.$array.extend_from_slice(nodes);
                    Span { start, len: nodes.len() as u32, marker: PhantomData }
                }
            )*
        }

        $(
            impl core::ops::Index<Id<$node>> for Syntax {
                type Output = $node;
                #[inline]
                fn index(&self, id: Id<$node>) -> &$node {
                    &self.$array[id.index()]
                }
            }

            impl core::ops::IndexMut<Id<$node>> for Syntax {
                #[inline]
                fn index_mut(&mut self, id: Id<$node>) -> &mut $node {
                    &mut self.$array[id.index()]
                }
            }

            impl core::ops::Index<Span<$node>> for Syntax {
                type Output = [$node];
                #[inline]
                fn index(&self, span: Span<$node>) -> &[$node] {
                    &self.$array[span.start as usize..(span.start + span.len) as usize]
                }
            }
        )*
    };
}

define_syntax! {
    types: Type, add_type_node, add_type_nodes;
    names: Name, add_name, add_names;
    strings: StoreStr, add_string, add_strings;
    tuple_elements: TupleElement, add_tuple_element, add_tuple_elements;
    members: Member, add_member, add_members;
    modifiers: Modifier, add_modifier, add_modifiers;
    signatures: Signature, add_signature, add_signatures;
    params: Param, add_param, add_params;
    type_params: TypeParam, add_type_param, add_type_params;
    patterns: Pattern, add_pattern_node, add_pattern_nodes;
    pattern_properties: PatternProperty, add_pattern_property, add_pattern_properties;
    pattern_elements: PatternElement, add_pattern_element, add_pattern_elements;
    mapped_types: MappedType, add_mapped_type, add_mapped_types;
    import_types: ImportType, add_import_type, add_import_types;
    statements: Statement, add_statement, add_statements;
    interfaces: Interface, add_interface, add_interfaces;
    type_aliases: TypeAlias, add_type_alias, add_type_aliases;
}

impl Default for Syntax {
    fn default() -> Self {
        Self::new()
    }
}

impl Syntax {
    #[inline]
    pub fn add_type(&mut self, data: TypeData, loc: Loc) -> TypeId {
        self.add_type_node(Type {
            data,
            loc,
            end: Loc::EMPTY,
        })
    }

    #[inline]
    pub fn add_pattern(&mut self, data: PatternData, loc: Loc) -> PatternId {
        self.add_pattern_node(Pattern { data, loc })
    }

    #[inline]
    pub fn add_number(&mut self, value: f64) -> u32 {
        self.numbers.push(value);
        (self.numbers.len() - 1) as u32
    }

    pub fn add_id_list<T>(&mut self, ids: &[Id<T>]) -> IdList<T> {
        let start = self.ids.len() as u32;
        self.ids.extend(ids.iter().map(|id| id.0));
        IdList {
            start,
            len: ids.len() as u32,
            marker: PhantomData,
        }
    }

    #[inline]
    pub fn id_list<T>(&self, list: IdList<T>) -> impl ExactSizeIterator<Item = Id<T>> + '_ {
        self.ids[list.start as usize..(list.start + list.len) as usize]
            .iter()
            .map(|&index| Id(index, PhantomData))
    }
}
