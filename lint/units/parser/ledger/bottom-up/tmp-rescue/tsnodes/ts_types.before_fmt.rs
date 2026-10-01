use crate::bun_alloc::{Arena, ArenaVec};

use super::{Binding, E, Expr, G, Loc, Range, StoreRef, StoreSlice, StoreStr};

const fn is_unicode_space_separator(cp: u32) -> bool {
    matches!(cp, 0x0020 | 0x00A0 | 0x1680 | 0x2000..=0x200A | 0x202F | 0x205F | 0x3000)
}

/// A node of type syntax: `start` is the offset of its first token, `end` the offset after its last token.
pub trait Node {
    fn start(&self) -> u32;
    fn end(&self) -> u32;

    #[inline]
    fn loc(&self) -> Loc {
        Loc {
            start: self.start() as i32,
        }
    }

    #[inline]
    fn range(&self) -> Range {
        Range {
            loc: self.loc(),
            len: self.end().saturating_sub(self.start()) as i32,
        }
    }
}

macro_rules! impl_node_by_fields {
    ($($ty:ident),* $(,)?) => {
        $(
            impl Node for $ty {
                #[inline]
                fn start(&self) -> u32 {
                    self.start
                }
                #[inline]
                fn end(&self) -> u32 {
                    self.end
                }
            }
        )*
    };
}

/// The elements of a list and the offset after its last token, which is a separator when one trails.
pub struct List<T> {
    pub items: StoreSlice<T>,
    pub end: u32,
}

impl<T> Copy for List<T> {}
impl<T> Clone for List<T> {
    #[inline]
    fn clone(&self) -> Self {
        *self
    }
}

impl<T> List<T> {
    #[inline]
    pub fn new(items: ArenaVec<'_, T>, end: u32) -> List<T> {
        List {
            items: StoreSlice::from_bump(items),
            end,
        }
    }

    /// A list without elements: `end` is the offset after the token that opens it.
    #[inline]
    pub const fn empty(end: u32) -> List<T> {
        List {
            items: StoreSlice::EMPTY,
            end,
        }
    }

    #[inline]
    pub fn slice<'a>(self) -> &'a [T] {
        self.items.slice()
    }
}

impl<T: Node> List<T> {
    /// True when a separator follows the last element.
    pub fn has_trailing_separator(self) -> bool {
        self.slice().last().is_some_and(|last| last.end() < self.end)
    }
}

/// The kinds of token that the reference keeps as a node of its own.
#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum TokenKind {
    DotDotDot,
    Question,
    Exclamation,
    Plus,
    Minus,
    Abstract,
    Accessor,
    Asserts,
    Async,
    Const,
    Declare,
    Default,
    Export,
    In,
    Out,
    Override,
    Private,
    Protected,
    Public,
    Readonly,
    Static,
}

impl TokenKind {
    pub const fn text(self) -> &'static str {
        match self {
            TokenKind::DotDotDot => "...",
            TokenKind::Question => "?",
            TokenKind::Exclamation => "!",
            TokenKind::Plus => "+",
            TokenKind::Minus => "-",
            TokenKind::Abstract => "abstract",
            TokenKind::Accessor => "accessor",
            TokenKind::Asserts => "asserts",
            TokenKind::Async => "async",
            TokenKind::Const => "const",
            TokenKind::Declare => "declare",
            TokenKind::Default => "default",
            TokenKind::Export => "export",
            TokenKind::In => "in",
            TokenKind::Out => "out",
            TokenKind::Override => "override",
            TokenKind::Private => "private",
            TokenKind::Protected => "protected",
            TokenKind::Public => "public",
            TokenKind::Readonly => "readonly",
            TokenKind::Static => "static",
        }
    }

    /// The bit of `ModifierFlags` that a modifier of this kind sets.
    pub const fn modifier_flag(self) -> ModifierFlags {
        match self {
            TokenKind::Public => ModifierFlags::PUBLIC,
            TokenKind::Private => ModifierFlags::PRIVATE,
            TokenKind::Protected => ModifierFlags::PROTECTED,
            TokenKind::Readonly => ModifierFlags::READONLY,
            TokenKind::Override => ModifierFlags::OVERRIDE,
            TokenKind::Export => ModifierFlags::EXPORT,
            TokenKind::Abstract => ModifierFlags::ABSTRACT,
            TokenKind::Declare => ModifierFlags::AMBIENT,
            TokenKind::Static => ModifierFlags::STATIC,
            TokenKind::Accessor => ModifierFlags::ACCESSOR,
            TokenKind::Async => ModifierFlags::ASYNC,
            TokenKind::Default => ModifierFlags::DEFAULT,
            TokenKind::Const => ModifierFlags::CONST,
            TokenKind::In => ModifierFlags::IN,
            TokenKind::Out => ModifierFlags::OUT,
            TokenKind::DotDotDot
            | TokenKind::Question
            | TokenKind::Exclamation
            | TokenKind::Plus
            | TokenKind::Minus
            | TokenKind::Asserts => ModifierFlags::empty(),
        }
    }
}

/// A token without escape sequences, so `kind` gives its length.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Token {
    pub start: u32,
    pub kind: TokenKind,
}

impl Token {
    #[inline]
    pub const fn new(kind: TokenKind, start: u32) -> Token {
        Token { start, kind }
    }

    #[inline]
    pub const fn end(self) -> u32 {
        self.start + self.kind.text().len() as u32
    }
}

bitflags::bitflags! {
    /// The syntactic bits of the reference's `ModifierFlags`, with the same values.
    #[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
    #[repr(transparent)]
    pub struct ModifierFlags: u32 {
        const PUBLIC = 1 << 0;
        const PRIVATE = 1 << 1;
        const PROTECTED = 1 << 2;
        const READONLY = 1 << 3;
        const OVERRIDE = 1 << 4;
        const EXPORT = 1 << 5;
        const ABSTRACT = 1 << 6;
        const AMBIENT = 1 << 7;
        const STATIC = 1 << 8;
        const ACCESSOR = 1 << 9;
        const ASYNC = 1 << 10;
        const DEFAULT = 1 << 11;
        const CONST = 1 << 12;
        const IN = 1 << 13;
        const OUT = 1 << 14;
        const DECORATOR = 1 << 15;
    }
}

pub struct Decorator {
    pub start: u32,
    pub end: u32,
    pub expression: Expr,
}

#[derive(Clone, Copy)]
pub enum ModifierLike {
    Modifier(Token),
    Decorator(StoreRef<Decorator>),
}

impl Node for ModifierLike {
    #[inline]
    fn start(&self) -> u32 {
        match self {
            ModifierLike::Modifier(token) => token.start,
            ModifierLike::Decorator(decorator) => decorator.start,
        }
    }
    #[inline]
    fn end(&self) -> u32 {
        match self {
            ModifierLike::Modifier(token) => token.end(),
            ModifierLike::Decorator(decorator) => decorator.end,
        }
    }
}

/// The modifiers and decorators before a declaration, in source order. It is never empty.
pub struct ModifierList {
    pub items: StoreSlice<ModifierLike>,
    pub flags: ModifierFlags,
}

pub type Modifiers = Option<StoreRef<ModifierList>>;

impl ModifierList {
    /// `None` for no items, as the reference has no list then.
    pub fn alloc(arena: &Arena, items: ArenaVec<'_, ModifierLike>) -> Modifiers {
        if items.is_empty() {
            return None;
        }
        let mut flags = ModifierFlags::empty();
        for item in items.iter() {
            flags = flags.union(match item {
                ModifierLike::Modifier(token) => token.kind.modifier_flag(),
                ModifierLike::Decorator(_) => ModifierFlags::DECORATOR,
            });
        }
        Some(StoreRef::from_bump(arena.alloc(ModifierList {
            items: StoreSlice::from_bump(items),
            flags,
        })))
    }
}

/// `text` is the name with escape sequences decoded.
#[derive(Clone, Copy)]
pub struct Identifier {
    pub start: u32,
    pub end: u32,
    pub text: StoreStr,
}

/// `text` starts with "#".
#[derive(Clone, Copy)]
pub struct PrivateIdentifier {
    pub start: u32,
    pub end: u32,
    pub text: StoreStr,
}

#[derive(Clone, Copy)]
pub struct StringLiteral {
    pub start: u32,
    pub end: u32,
    pub value: StoreRef<E::EString>,
}

#[derive(Clone, Copy)]
pub struct NoSubstitutionTemplateLiteral {
    pub start: u32,
    pub end: u32,
    pub value: StoreRef<E::EString>,
}

#[derive(Clone, Copy)]
pub struct NumericLiteral {
    pub start: u32,
    pub end: u32,
    pub value: E::Number,
}

/// `text` is what `E::BigInt::value` holds: the digits as written, without the "n".
#[derive(Clone, Copy)]
pub struct BigIntLiteral {
    pub start: u32,
    pub end: u32,
    pub text: StoreStr,
}

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum KeywordExpressionKind {
    True,
    False,
    Null,
}

#[derive(Clone, Copy)]
pub struct KeywordExpression {
    pub start: u32,
    pub end: u32,
    pub kind: KeywordExpressionKind,
}

#[derive(Clone, Copy)]
pub enum PrefixUnaryOperand {
    NumericLiteral(NumericLiteral),
    BigIntLiteral(BigIntLiteral),
}

/// "-" before a numeric or bigint literal. The reference has no other operator in a type.
pub struct PrefixUnaryExpression {
    pub start: u32,
    pub end: u32,
    pub operand: PrefixUnaryOperand,
}

#[derive(Clone, Copy)]
pub enum Literal {
    StringLiteral(StringLiteral),
    NoSubstitutionTemplateLiteral(NoSubstitutionTemplateLiteral),
    NumericLiteral(NumericLiteral),
    BigIntLiteral(BigIntLiteral),
    KeywordExpression(KeywordExpression),
    PrefixUnaryExpression(StoreRef<PrefixUnaryExpression>),
}

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum TemplateKind {
    Head,
    Middle,
    Tail,
}

/// `text` is the cooked text. The raw text is the source between the delimiters.
#[derive(Clone, Copy)]
pub struct TemplateLiteralLike {
    pub start: u32,
    pub end: u32,
    pub kind: TemplateKind,
    pub text: StoreRef<E::EString>,
}

#[derive(Clone, Copy)]
pub enum MemberName {
    Identifier(Identifier),
    PrivateIdentifier(PrivateIdentifier),
}

#[derive(Clone, Copy)]
pub enum EntityName {
    Identifier(Identifier),
    QualifiedName(StoreRef<QualifiedName>),
}

pub struct QualifiedName {
    pub start: u32,
    pub end: u32,
    pub left: EntityName,
    pub right: MemberName,
}

pub struct ComputedPropertyName {
    pub start: u32,
    pub end: u32,
    pub expression: Expr,
}

#[derive(Clone, Copy)]
pub enum PropertyName {
    Identifier(Identifier),
    PrivateIdentifier(PrivateIdentifier),
    StringLiteral(StringLiteral),
    NumericLiteral(NumericLiteral),
    BigIntLiteral(BigIntLiteral),
    ComputedPropertyName(StoreRef<ComputedPropertyName>),
}

/// The name of a parameter. A pattern is a `B::BArray` or a `B::BObject` whose names are not declared.
#[derive(Clone, Copy)]
pub enum BindingName {
    Identifier(Identifier),
    BindingPattern(Binding),
}

#[derive(Clone, Copy)]
pub struct ThisTypeNode {
    pub start: u32,
    pub end: u32,
}

#[derive(Clone, Copy)]
pub enum TypePredicateParameterName {
    Identifier(Identifier),
    ThisType(ThisTypeNode),
}

#[derive(Clone, Copy)]
pub enum ImportAttributeName {
    Identifier(Identifier),
    StringLiteral(StringLiteral),
}

impl_node_by_fields!(
    Decorator,
    Identifier,
    PrivateIdentifier,
    StringLiteral,
    NoSubstitutionTemplateLiteral,
    NumericLiteral,
    BigIntLiteral,
    KeywordExpression,
    PrefixUnaryExpression,
    TemplateLiteralLike,
    QualifiedName,
    ComputedPropertyName,
    ThisTypeNode,
);

pub struct TypeParameter {
    pub start: u32,
    pub end: u32,
    pub modifiers: Modifiers,
    pub name: Identifier,
    pub constraint: Option<Type>,
    /// What follows `extends` when it is an expression and not a type.
    pub expression: Option<Expr>,
    pub default_type: Option<Type>,
}

pub struct Parameter {
    pub start: u32,
    pub end: u32,
    pub modifiers: Modifiers,
    pub dot_dot_dot_token: Option<Token>,
    pub name: BindingName,
    pub question_token: Option<Token>,
    pub type_node: Option<Type>,
    pub initializer: Option<Expr>,
}

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum HeritageToken {
    Extends,
    Implements,
}

/// Each of `types` is a `TypeReference` or an `ExpressionWithTypeArguments`.
pub struct HeritageClause {
    pub start: u32,
    pub end: u32,
    pub token: HeritageToken,
    pub types: List<Type>,
}

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ImportAttributesToken {
    With,
    Assert,
}

pub struct ImportAttribute {
    pub start: u32,
    pub end: u32,
    pub name: ImportAttributeName,
    pub value: Expr,
}

pub struct ImportAttributes {
    pub start: u32,
    pub end: u32,
    pub token: ImportAttributesToken,
    pub multi_line: bool,
    pub attributes: List<ImportAttribute>,
}

impl_node_by_fields!(
    TypeParameter,
    Parameter,
    HeritageClause,
    ImportAttribute,
    ImportAttributes,
);

pub struct PropertySignature {
    pub modifiers: Modifiers,
    pub name: PropertyName,
    pub postfix_token: Option<Token>,
    pub type_node: Option<Type>,
    pub initializer: Option<Expr>,
}

pub struct MethodSignature {
    pub modifiers: Modifiers,
    pub name: PropertyName,
    pub postfix_token: Option<Token>,
    pub type_parameters: Option<List<TypeParameter>>,
    pub parameters: List<Parameter>,
    pub type_node: Option<Type>,
}

pub struct CallSignature {
    pub type_parameters: Option<List<TypeParameter>>,
    pub parameters: List<Parameter>,
    pub type_node: Option<Type>,
}

pub struct ConstructSignature {
    pub type_parameters: Option<List<TypeParameter>>,
    pub parameters: List<Parameter>,
    pub type_node: Option<Type>,
}

pub struct IndexSignature {
    pub modifiers: Modifiers,
    pub parameters: List<Parameter>,
    pub type_node: Option<Type>,
}

pub struct GetAccessor {
    pub modifiers: Modifiers,
    pub name: PropertyName,
    pub type_parameters: Option<List<TypeParameter>>,
    pub parameters: List<Parameter>,
    pub type_node: Option<Type>,
    pub body: Option<G::FnBody>,
}

pub struct SetAccessor {
    pub modifiers: Modifiers,
    pub name: PropertyName,
    pub type_parameters: Option<List<TypeParameter>>,
    pub parameters: List<Parameter>,
    pub type_node: Option<Type>,
    pub body: Option<G::FnBody>,
}

#[derive(Clone, Copy)]
pub enum TypeElementData {
    PropertySignature(StoreRef<PropertySignature>),
    MethodSignature(StoreRef<MethodSignature>),
    CallSignature(StoreRef<CallSignature>),
    ConstructSignature(StoreRef<ConstructSignature>),
    IndexSignature(StoreRef<IndexSignature>),
    GetAccessor(StoreRef<GetAccessor>),
    SetAccessor(StoreRef<SetAccessor>),
}

/// A member of a type literal or of an interface. `end` is after the ";" or "," when the member has one.
#[derive(Clone, Copy)]
pub struct TypeElement {
    pub start: u32,
    pub end: u32,
    pub data: TypeElementData,
}

pub trait IntoTypeElementData: Sized {
    fn into_type_element_data(self, arena: &Arena) -> TypeElementData;
}

macro_rules! impl_into_type_element_data {
    ($($ty:ident),* $(,)?) => {
        $(
            impl IntoTypeElementData for $ty {
                #[inline]
                fn into_type_element_data(self, arena: &Arena) -> TypeElementData {
                    TypeElementData::$ty(StoreRef::from_bump(arena.alloc(self)))
                }
            }
        )*
    };
}

impl_into_type_element_data!(
    PropertySignature,
    MethodSignature,
    CallSignature,
    ConstructSignature,
    IndexSignature,
    GetAccessor,
    SetAccessor,
);

impl TypeElement {
    #[inline]
    pub fn alloc(arena: &Arena, t: impl IntoTypeElementData, start: u32, end: u32) -> TypeElement {
        TypeElement {
            start,
            end,
            data: t.into_type_element_data(arena),
        }
    }
}

/// The keyword of a `KeywordTypeNode`: the reference gives the node the kind of the keyword.
#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum KeywordTypeKind {
    Any,
    BigInt,
    Boolean,
    Intrinsic,
    Never,
    Number,
    Object,
    String,
    Symbol,
    Undefined,
    Unknown,
    Void,
}

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum TypeOperatorKind {
    KeyOf,
    Unique,
    Readonly,
}

pub struct TypePredicate {
    pub asserts_modifier: Option<Token>,
    pub parameter_name: TypePredicateParameterName,
    pub type_node: Option<Type>,
}

pub struct TypeReference {
    pub type_name: EntityName,
    pub type_arguments: Option<List<Type>>,
}

pub struct FunctionType {
    pub type_parameters: Option<List<TypeParameter>>,
    pub parameters: List<Parameter>,
    pub type_node: Option<Type>,
}

pub struct ConstructorType {
    pub modifiers: Modifiers,
    pub type_parameters: Option<List<TypeParameter>>,
    pub parameters: List<Parameter>,
    pub type_node: Option<Type>,
}

pub struct TypeQuery {
    pub expr_name: EntityName,
    pub type_arguments: Option<List<Type>>,
}

pub struct TypeLiteral {
    pub members: List<TypeElement>,
}

pub struct ArrayType {
    pub element_type: Type,
}

pub struct TupleType {
    pub elements: List<Type>,
}

pub struct OptionalType {
    pub type_node: Type,
}

pub struct RestType {
    pub type_node: Type,
}

pub struct UnionType {
    pub types: List<Type>,
}

pub struct IntersectionType {
    pub types: List<Type>,
}

pub struct ConditionalType {
    pub check_type: Type,
    pub extends_type: Type,
    pub true_type: Type,
    pub false_type: Type,
}

pub struct InferType {
    pub type_parameter: TypeParameter,
}

pub struct ParenthesizedType {
    pub type_node: Type,
}

pub struct TypeOperator {
    pub operator: TypeOperatorKind,
    pub type_node: Type,
}

pub struct IndexedAccessType {
    pub object_type: Type,
    pub index_type: Type,
}

pub struct MappedType {
    pub readonly_token: Option<Token>,
    pub type_parameter: TypeParameter,
    pub name_type: Option<Type>,
    pub question_token: Option<Token>,
    pub type_node: Option<Type>,
    pub members: List<TypeElement>,
}

pub struct LiteralType {
    pub literal: Literal,
}

pub struct NamedTupleMember {
    pub dot_dot_dot_token: Option<Token>,
    pub name: Identifier,
    pub question_token: Option<Token>,
    pub type_node: Type,
}

pub struct TemplateLiteralTypeSpan {
    pub start: u32,
    pub end: u32,
    pub type_node: Type,
    pub literal: TemplateLiteralLike,
}

pub struct TemplateLiteralType {
    pub head: TemplateLiteralLike,
    pub template_spans: List<TemplateLiteralTypeSpan>,
}

pub struct ImportType {
    pub is_type_of: bool,
    pub argument: Type,
    pub attributes: Option<StoreRef<ImportAttributes>>,
    pub qualifier: Option<EntityName>,
    pub type_arguments: Option<List<Type>>,
}

pub struct ExpressionWithTypeArguments {
    pub expression: Expr,
    pub type_arguments: Option<List<Type>>,
}

/// "?" before or after a type. It is after the type when the two nodes start at the same offset.
pub struct JSDocNullableType {
    pub type_node: Type,
}

/// "!" before or after a type. It is after the type when the two nodes start at the same offset.
pub struct JSDocNonNullableType {
    pub type_node: Type,
}

#[derive(Clone, Copy)]
pub enum TypeData {
    Keyword(KeywordTypeKind),
    TypePredicate(StoreRef<TypePredicate>),
    TypeReference(StoreRef<TypeReference>),
    FunctionType(StoreRef<FunctionType>),
    ConstructorType(StoreRef<ConstructorType>),
    TypeQuery(StoreRef<TypeQuery>),
    TypeLiteral(StoreRef<TypeLiteral>),
    ArrayType(StoreRef<ArrayType>),
    TupleType(StoreRef<TupleType>),
    OptionalType(StoreRef<OptionalType>),
    RestType(StoreRef<RestType>),
    UnionType(StoreRef<UnionType>),
    IntersectionType(StoreRef<IntersectionType>),
    ConditionalType(StoreRef<ConditionalType>),
    InferType(StoreRef<InferType>),
    ParenthesizedType(StoreRef<ParenthesizedType>),
    ThisType,
    TypeOperator(StoreRef<TypeOperator>),
    IndexedAccessType(StoreRef<IndexedAccessType>),
    MappedType(StoreRef<MappedType>),
    LiteralType(StoreRef<LiteralType>),
    NamedTupleMember(StoreRef<NamedTupleMember>),
    TemplateLiteralType(StoreRef<TemplateLiteralType>),
    ImportType(StoreRef<ImportType>),
    ExpressionWithTypeArguments(StoreRef<ExpressionWithTypeArguments>),
    JSDocAllType,
    JSDocNullableType(StoreRef<JSDocNullableType>),
    JSDocNonNullableType(StoreRef<JSDocNonNullableType>),
}

/// A type. `data` names its kind and points to the fields of that kind in the arena.
#[derive(Clone, Copy)]
pub struct Type {
    pub start: u32,
    pub end: u32,
    pub data: TypeData,
}

pub trait IntoTypeData: Sized {
    fn into_type_data(self, arena: &Arena) -> TypeData;
}

macro_rules! impl_into_type_data {
    ($($ty:ident),* $(,)?) => {
        $(
            impl IntoTypeData for $ty {
                #[inline]
                fn into_type_data(self, arena: &Arena) -> TypeData {
                    TypeData::$ty(StoreRef::from_bump(arena.alloc(self)))
                }
            }
        )*
    };
}

impl_into_type_data!(
    TypePredicate,
    TypeReference,
    FunctionType,
    ConstructorType,
    TypeQuery,
    TypeLiteral,
    ArrayType,
    TupleType,
    OptionalType,
    RestType,
    UnionType,
    IntersectionType,
    ConditionalType,
    InferType,
    ParenthesizedType,
    TypeOperator,
    IndexedAccessType,
    MappedType,
    LiteralType,
    NamedTupleMember,
    TemplateLiteralType,
    ImportType,
    ExpressionWithTypeArguments,
    JSDocNullableType,
    JSDocNonNullableType,
);

impl Type {
    #[inline]
    pub fn alloc(arena: &Arena, t: impl IntoTypeData, start: u32, end: u32) -> Type {
        Type {
            start,
            end,
            data: t.into_type_data(arena),
        }
    }

    #[inline]
    pub const fn keyword(kind: KeywordTypeKind, start: u32, end: u32) -> Type {
        Type {
            start,
            end,
            data: TypeData::Keyword(kind),
        }
    }

    #[inline]
    pub const fn this_type(start: u32, end: u32) -> Type {
        Type {
            start,
            end,
            data: TypeData::ThisType,
        }
    }

    #[inline]
    pub const fn jsdoc_all_type(start: u32, end: u32) -> Type {
        Type {
            start,
            end,
            data: TypeData::JSDocAllType,
        }
    }

    /// The element of a tuple that this type is: `T?` becomes an optional type, as in the reference.
    pub fn into_tuple_element(self, arena: &Arena) -> Type {
        if let TypeData::JSDocNullableType(nullable) = self.data {
            if nullable.type_node.start == self.start {
                let type_node = nullable.type_node;
                return Type::alloc(arena, OptionalType { type_node }, self.start, self.end);
            }
        }
        self
    }
}

impl_node_by_fields!(Type, TypeElement, TemplateLiteralTypeSpan);

macro_rules! impl_node_by_variants {
    ($($ty:ident { $($variant:ident),* $(,)? })*) => {
        $(
            impl Node for $ty {
                #[inline]
                fn start(&self) -> u32 {
                    match self {
                        $( $ty::$variant(node) => node.start(), )*
                    }
                }
                #[inline]
                fn end(&self) -> u32 {
                    match self {
                        $( $ty::$variant(node) => node.end(), )*
                    }
                }
            }
        )*
    };
}

impl_node_by_variants! {
    MemberName { Identifier, PrivateIdentifier }
    EntityName { Identifier, QualifiedName }
    PropertyName { Identifier, PrivateIdentifier, StringLiteral, NumericLiteral, BigIntLiteral, ComputedPropertyName }
    TypePredicateParameterName { Identifier, ThisType }
    ImportAttributeName { Identifier, StringLiteral }
    PrefixUnaryOperand { NumericLiteral, BigIntLiteral }
    Literal { StringLiteral, NoSubstitutionTemplateLiteral, NumericLiteral, BigIntLiteral, KeywordExpression, PrefixUnaryExpression }
}

impl Identifier {
    #[inline]
    pub const fn new(text: &[u8], start: u32, end: u32) -> Identifier {
        Identifier {
            start,
            end,
            text: StoreStr::new(text),
        }
    }
}

impl PrivateIdentifier {
    #[inline]
    pub const fn new(text: &[u8], start: u32, end: u32) -> PrivateIdentifier {
        PrivateIdentifier {
            start,
            end,
            text: StoreStr::new(text),
        }
    }
}

impl StringLiteral {
    #[inline]
    pub fn alloc(arena: &Arena, value: E::EString, start: u32, end: u32) -> StringLiteral {
        StringLiteral {
            start,
            end,
            value: StoreRef::from_bump(arena.alloc(value)),
        }
    }
}

impl NoSubstitutionTemplateLiteral {
    #[inline]
    pub fn alloc(arena: &Arena, value: E::EString, start: u32, end: u32) -> NoSubstitutionTemplateLiteral {
        NoSubstitutionTemplateLiteral {
            start,
            end,
            value: StoreRef::from_bump(arena.alloc(value)),
        }
    }
}

impl TemplateLiteralLike {
    #[inline]
    pub fn alloc(arena: &Arena, kind: TemplateKind, text: E::EString, start: u32, end: u32) -> TemplateLiteralLike {
        TemplateLiteralLike {
            start,
            end,
            kind,
            text: StoreRef::from_bump(arena.alloc(text)),
        }
    }
}

impl Literal {
    /// "-" at `start` before `operand`.
    pub fn negative(arena: &Arena, operand: PrefixUnaryOperand, start: u32) -> Literal {
        let end = operand.end();
        Literal::PrefixUnaryExpression(StoreRef::from_bump(arena.alloc(PrefixUnaryExpression {
            start,
            end,
            operand,
        })))
    }
}

impl EntityName {
    /// `left.right`
    pub fn qualified(arena: &Arena, left: EntityName, right: MemberName) -> EntityName {
        EntityName::QualifiedName(StoreRef::from_bump(arena.alloc(QualifiedName {
            start: left.start(),
            end: right.end(),
            left,
            right,
        })))
    }
}

impl PropertyName {
    /// `[expression]` from the "[" at `start` to after the "]" at `end`.
    pub fn computed(arena: &Arena, expression: Expr, start: u32, end: u32) -> PropertyName {
        PropertyName::ComputedPropertyName(StoreRef::from_bump(arena.alloc(ComputedPropertyName {
            start,
            end,
            expression,
        })))
    }
}

impl ModifierLike {
    /// `@expression` from the "@" at `start`.
    pub fn decorator(arena: &Arena, expression: Expr, start: u32, end: u32) -> ModifierLike {
        ModifierLike::Decorator(StoreRef::from_bump(arena.alloc(Decorator {
            start,
            end,
            expression,
        })))
    }
}

impl BindingName {
    #[inline]
    pub fn start(&self) -> u32 {
        match self {
            BindingName::Identifier(identifier) => identifier.start,
            BindingName::BindingPattern(binding) => binding.loc.start.max(0) as u32,
        }
    }
}

fn is_trivia_code_point(cp: u32) -> bool {
    matches!(cp, 0x09..=0x0D | 0x2028 | 0x2029 | 0xFEFF) || is_unicode_space_separator(cp)
}

/// The offset before the white space that ends at `pos`.
fn skip_white_space_back(source: &[u8], mut pos: usize) -> usize {
    while pos > 0 {
        let mut first = pos - 1;
        while first > 0 && pos - first < 4 && source[first] & 0xC0 == 0x80 {
            first -= 1;
        }
        let cp = match core::str::from_utf8(&source[first..pos]) {
            Ok(text) => text.chars().next().map_or(0, |c| c as u32),
            Err(_) => return pos,
        };
        if !is_trivia_code_point(cp) {
            return pos;
        }
        pos = first;
    }
    pos
}

/// Where the trivia before the token at `start` begins: the reference's `pos` of a node that starts there.
pub fn full_start(source: &[u8], comments: &[Range], start: u32) -> u32 {
    let mut pos = (start as usize).min(source.len());
    loop {
        pos = skip_white_space_back(source, pos);
        let Ok(at) = comments.binary_search_by_key(&(pos as i64), |comment| {
            i64::from(comment.loc.start) + i64::from(comment.len)
        }) else {
            break;
        };
        pos = comments[at].loc.start.max(0) as usize;
    }
    // The first line is trivia when it is a hashbang.
    if pos > 0 && source.starts_with(b"#!") && !source[..pos].iter().any(|&b| b == b'\n' || b == b'\r') {
        return 0;
    }
    pos as u32
}

const _: () = assert!(size_of::<Type>() == 20);
const _: () = assert!(align_of::<Type>() == 4);
const _: () = assert!(size_of::<Option<Type>>() == 20);


#[cfg(test)]
mod tests {
    use super::*;

    fn r(start: i32, len: i32) -> Range {
        Range { loc: Loc { start }, len }
    }

    #[test]
    fn full_start_skips_white_space_and_comments() {
        let source = b"let x: /* a */ // b\n  \xc2\xa0 string";
        let a = 7;
        let b = 15;
        let comments = [r(a, 7), r(b, 4)];
        let token = source.len() as u32 - 6;
        assert_eq!(&source[token as usize..], b"string");
        assert_eq!(full_start(source, &comments, token), 6);
        assert_eq!(full_start(source, &comments, 4), 3);
        assert_eq!(full_start(source, &comments, 0), 0);
        assert_eq!(full_start(b"#!/x\nfoo", &[], 5), 0);
        assert_eq!(full_start(b"#!/x foo", &[], 0), 0);
    }

    #[test]
    fn tuple_element() {
        let arena = Arena;
        let inner = Type::keyword(KeywordTypeKind::String, 1, 7);
        let postfix = Type::alloc(&arena, JSDocNullableType { type_node: inner }, 1, 8);
        assert!(matches!(postfix.into_tuple_element(&arena).data, TypeData::OptionalType(_)));
        let inner = Type::keyword(KeywordTypeKind::String, 2, 8);
        let prefix = Type::alloc(&arena, JSDocNullableType { type_node: inner }, 1, 8);
        assert!(matches!(prefix.into_tuple_element(&arena).data, TypeData::JSDocNullableType(_)));
    }

    #[test]
    fn token_end() {
        assert_eq!(Token::new(TokenKind::Readonly, 10).end(), 18);
        assert_eq!(Token::new(TokenKind::DotDotDot, 10).end(), 13);
    }
}
