//! TypeScript type syntax as a lint parse keeps it: one node kind for each kind that the type grammar of typescript-go builds.

use bun_alloc::{Arena, ArenaVec};

use crate::{Binding, E, Expr, Loc, Range, Stmt, StoreRef, StoreSlice, StoreStr};

/// A type. `start` is the offset of its first token, `end` the offset after its last token.
#[derive(Clone, Copy)]
pub struct Type {
    pub start: u32,
    pub end: u32,
    pub data: TypeData,
}

/// The kind of a type, with its payload in the arena of the lint parse.
#[derive(Clone, Copy)]
pub enum TypeData {
    /// `KeywordTypeNode`: its kind is the kind of the keyword.
    Keyword(KeywordKind),
    /// `ThisTypeNode`.
    This,
    /// `JSDocAllType`, the type `*`.
    JSDocAll,
    Literal(StoreRef<LiteralType>),
    TypeReference(StoreRef<TypeReference>),
    /// An entry of a heritage clause that is not a plain entity name, and every entry of a class `extends`.
    ExpressionWithTypeArguments(StoreRef<ExpressionWithTypeArguments>),
    Array(StoreRef<ArrayType>),
    Tuple(StoreRef<TupleType>),
    NamedTupleMember(StoreRef<NamedTupleMember>),
    Optional(StoreRef<OptionalType>),
    Rest(StoreRef<RestType>),
    Union(StoreRef<UnionType>),
    Intersection(StoreRef<IntersectionType>),
    Conditional(StoreRef<ConditionalType>),
    Infer(StoreRef<InferType>),
    Mapped(StoreRef<MappedType>),
    IndexedAccess(StoreRef<IndexedAccessType>),
    TypeOperator(StoreRef<TypeOperator>),
    TypeQuery(StoreRef<TypeQuery>),
    Function(StoreRef<FunctionType>),
    Constructor(StoreRef<ConstructorType>),
    TypeLiteral(StoreRef<TypeLiteral>),
    TemplateLiteral(StoreRef<TemplateLiteralType>),
    Import(StoreRef<ImportType>),
    Parenthesized(StoreRef<ParenthesizedType>),
    TypePredicate(StoreRef<TypePredicate>),
    /// `?T` and `T?`: the postfix form starts where its operand starts.
    JSDocNullable(StoreRef<JSDocNullableType>),
    /// `!T` and `T!`: the postfix form starts where its operand starts.
    JSDocNonNullable(StoreRef<JSDocNonNullableType>),
}

/// A payload of [`TypeData`].
pub trait IntoTypeData: Sized {
    /// The variant that holds a payload of this kind.
    fn type_data(payload: StoreRef<Self>) -> TypeData;

    /// Puts `self` in `arena`.
    #[inline]
    fn into_type_data(self, arena: &Arena) -> TypeData {
        Self::type_data(StoreRef::from_bump(arena.alloc(self)))
    }
}

macro_rules! impl_into_type_data {
    ($($ty:ident => $variant:ident),* $(,)?) => {
        $(
            impl IntoTypeData for $ty {
                #[inline]
                fn type_data(payload: StoreRef<Self>) -> TypeData {
                    TypeData::$variant(payload)
                }
            }
        )*
    };
}

impl_into_type_data! {
    LiteralType => Literal,
    TypeReference => TypeReference,
    ExpressionWithTypeArguments => ExpressionWithTypeArguments,
    ArrayType => Array,
    TupleType => Tuple,
    NamedTupleMember => NamedTupleMember,
    OptionalType => Optional,
    RestType => Rest,
    UnionType => Union,
    IntersectionType => Intersection,
    ConditionalType => Conditional,
    InferType => Infer,
    MappedType => Mapped,
    IndexedAccessType => IndexedAccess,
    TypeOperator => TypeOperator,
    TypeQuery => TypeQuery,
    FunctionType => Function,
    ConstructorType => Constructor,
    TypeLiteral => TypeLiteral,
    TemplateLiteralType => TemplateLiteral,
    ImportType => Import,
    ParenthesizedType => Parenthesized,
    TypePredicate => TypePredicate,
    JSDocNullableType => JSDocNullable,
    JSDocNonNullableType => JSDocNonNullable,
}

impl Type {
    #[inline]
    pub const fn keyword(kind: KeywordKind, start: u32, end: u32) -> Type {
        Type {
            start,
            end,
            data: TypeData::Keyword(kind),
        }
    }

    #[inline]
    pub const fn this(start: u32, end: u32) -> Type {
        Type {
            start,
            end,
            data: TypeData::This,
        }
    }

    #[inline]
    pub const fn jsdoc_all(start: u32, end: u32) -> Type {
        Type {
            start,
            end,
            data: TypeData::JSDocAll,
        }
    }

    /// Puts `payload` in `arena`.
    #[inline]
    pub fn alloc<T: IntoTypeData>(arena: &Arena, payload: T, start: u32, end: u32) -> Type {
        Type {
            start,
            end,
            data: payload.into_type_data(arena),
        }
    }

    #[inline]
    pub const fn loc(&self) -> Loc {
        Loc {
            start: self.start as i32,
        }
    }

    #[inline]
    pub const fn range(&self) -> Range {
        range(self.start, self.end)
    }
}

impl TypeData {
    /// The name that `ts.SyntaxKind` has for the kind.
    pub const fn kind_name(&self) -> &'static str {
        match self {
            TypeData::Keyword(kind) => kind.kind_name(),
            TypeData::This => "ThisType",
            TypeData::JSDocAll => "JSDocAllType",
            TypeData::Literal(_) => "LiteralType",
            TypeData::TypeReference(_) => "TypeReference",
            TypeData::ExpressionWithTypeArguments(_) => "ExpressionWithTypeArguments",
            TypeData::Array(_) => "ArrayType",
            TypeData::Tuple(_) => "TupleType",
            TypeData::NamedTupleMember(_) => "NamedTupleMember",
            TypeData::Optional(_) => "OptionalType",
            TypeData::Rest(_) => "RestType",
            TypeData::Union(_) => "UnionType",
            TypeData::Intersection(_) => "IntersectionType",
            TypeData::Conditional(_) => "ConditionalType",
            TypeData::Infer(_) => "InferType",
            TypeData::Mapped(_) => "MappedType",
            TypeData::IndexedAccess(_) => "IndexedAccessType",
            TypeData::TypeOperator(_) => "TypeOperator",
            TypeData::TypeQuery(_) => "TypeQuery",
            TypeData::Function(_) => "FunctionType",
            TypeData::Constructor(_) => "ConstructorType",
            TypeData::TypeLiteral(_) => "TypeLiteral",
            TypeData::TemplateLiteral(_) => "TemplateLiteralType",
            TypeData::Import(_) => "ImportType",
            TypeData::Parenthesized(_) => "ParenthesizedType",
            TypeData::TypePredicate(_) => "TypePredicate",
            TypeData::JSDocNullable(_) => "JSDocNullableType",
            TypeData::JSDocNonNullable(_) => "JSDocNonNullableType",
        }
    }
}

/// `start..end` as the range that a diagnostic takes.
#[inline]
pub const fn range(start: u32, end: u32) -> Range {
    Range {
        loc: Loc {
            start: start as i32,
        },
        len: end.saturating_sub(start) as i32,
    }
}

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum KeywordKind {
    Any,
    Unknown,
    String,
    Number,
    BigInt,
    Symbol,
    Boolean,
    Undefined,
    Never,
    Object,
    Void,
    /// Only as the whole right side of a type alias.
    Intrinsic,
}

impl KeywordKind {
    pub const fn kind_name(self) -> &'static str {
        match self {
            KeywordKind::Any => "AnyKeyword",
            KeywordKind::Unknown => "UnknownKeyword",
            KeywordKind::String => "StringKeyword",
            KeywordKind::Number => "NumberKeyword",
            KeywordKind::BigInt => "BigIntKeyword",
            KeywordKind::Symbol => "SymbolKeyword",
            KeywordKind::Boolean => "BooleanKeyword",
            KeywordKind::Undefined => "UndefinedKeyword",
            KeywordKind::Never => "NeverKeyword",
            KeywordKind::Object => "ObjectKeyword",
            KeywordKind::Void => "VoidKeyword",
            KeywordKind::Intrinsic => "IntrinsicKeyword",
        }
    }
}

/// A list and its range.
pub struct List<T> {
    pub items: StoreSlice<T>,
    /// The end of the token that opens the list, or the start of its first token when none opens it.
    pub start: u32,
    /// The end of the last item or of the comma after it, or `start` when the list is empty.
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
    pub const fn empty(start: u32, end: u32) -> List<T> {
        List {
            items: StoreSlice::EMPTY,
            start,
            end,
        }
    }

    /// Leaves `items` in the arena it grew in.
    #[inline]
    pub fn from_bump(items: ArenaVec<'_, T>, start: u32, end: u32) -> List<T> {
        List {
            items: StoreSlice::from_bump(items),
            start,
            end,
        }
    }

    /// Copies `items` to `arena`.
    #[inline]
    pub fn from_slice(arena: &Arena, items: &[T], start: u32, end: u32) -> List<T>
    where
        T: Copy,
    {
        List {
            items: StoreSlice::new_mut(arena.alloc_slice_copy(items)),
            start,
            end,
        }
    }
}

impl<T> core::ops::Deref for List<T> {
    type Target = [T];
    #[inline]
    fn deref(&self) -> &[T] {
        self.items.slice()
    }
}

/// A token that TypeScript keeps as a node.
#[derive(Clone, Copy)]
pub struct Token {
    pub start: u32,
    pub end: u32,
    pub kind: TokenKind,
}

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum TokenKind {
    DotDotDot,
    Question,
    Exclamation,
    Plus,
    Minus,
    Readonly,
    Asserts,
}

/// An identifier, a keyword read as a name, or a private name with its `#`.
#[derive(Clone, Copy)]
pub struct Name {
    pub start: u32,
    pub end: u32,
    /// The name without escapes.
    pub text: StoreStr,
}

impl Name {
    #[inline]
    pub const fn new(text: &[u8], start: u32, end: u32) -> Name {
        Name {
            start,
            end,
            text: StoreStr::new(text),
        }
    }

    /// A `PrivateIdentifier`, where every other name is an `Identifier`.
    #[inline]
    pub fn is_private(&self) -> bool {
        self.text.first() == Some(&b'#')
    }
}

#[derive(Clone, Copy)]
pub enum EntityName {
    Identifier(Name),
    QualifiedName(StoreRef<QualifiedName>),
}

#[derive(Clone, Copy)]
pub struct QualifiedName {
    pub start: u32,
    pub end: u32,
    pub left: EntityName,
    pub right: Name,
}

impl EntityName {
    /// `left.right`, with the `QualifiedName` in `arena`.
    #[inline]
    pub fn qualified(arena: &Arena, left: EntityName, right: Name) -> EntityName {
        EntityName::QualifiedName(StoreRef::from_bump(arena.alloc(QualifiedName {
            start: left.start(),
            end: right.end,
            left,
            right,
        })))
    }

    #[inline]
    pub fn start(&self) -> u32 {
        match self {
            EntityName::Identifier(name) => name.start,
            EntityName::QualifiedName(name) => name.start,
        }
    }

    #[inline]
    pub fn end(&self) -> u32 {
        match self {
            EntityName::Identifier(name) => name.end,
            EntityName::QualifiedName(name) => name.end,
        }
    }
}

/// A literal as a literal type, a property name or the name of an import attribute holds it.
#[derive(Clone, Copy)]
pub struct Literal {
    pub start: u32,
    pub end: u32,
    pub data: LiteralData,
}

#[derive(Clone, Copy)]
pub enum LiteralData {
    Null,
    True,
    False,
    Number(E::Number),
    /// The digits without separators and without the `n`, with the radix prefix if the source has one.
    BigInt(StoreRef<E::BigInt>),
    String(StoreRef<E::EString>),
    NoSubstitutionTemplate(StoreRef<E::EString>),
}

impl LiteralData {
    #[inline]
    pub const fn number(value: f64) -> LiteralData {
        LiteralData::Number(E::Number::new(value))
    }

    /// Puts the `E::BigInt` in `arena`: `digits` stay where they are.
    #[inline]
    pub fn bigint(arena: &Arena, digits: &[u8]) -> LiteralData {
        LiteralData::BigInt(StoreRef::from_bump(arena.alloc(E::BigInt {
            value: StoreStr::new(digits),
        })))
    }

    /// `NoSubstitutionTemplate` when the lexer read `value` between backticks.
    #[inline]
    pub fn string(arena: &Arena, value: E::EString, is_template: bool) -> LiteralData {
        let value = StoreRef::from_bump(arena.alloc(value));
        if is_template {
            LiteralData::NoSubstitutionTemplate(value)
        } else {
            LiteralData::String(value)
        }
    }

    /// The name that `ts.SyntaxKind` has for the kind.
    pub const fn kind_name(&self) -> &'static str {
        match self {
            LiteralData::Null => "NullKeyword",
            LiteralData::True => "TrueKeyword",
            LiteralData::False => "FalseKeyword",
            LiteralData::Number(_) => "NumericLiteral",
            LiteralData::BigInt(_) => "BigIntLiteral",
            LiteralData::String(_) => "StringLiteral",
            LiteralData::NoSubstitutionTemplate(_) => "NoSubstitutionTemplateLiteral",
        }
    }
}

/// `negative` puts a `PrefixUnaryExpression` with the range of the type around `literal`.
#[derive(Clone, Copy)]
pub struct LiteralType {
    pub literal: Literal,
    pub negative: bool,
}

#[derive(Clone, Copy)]
pub struct TypeReference {
    pub type_name: EntityName,
    pub type_arguments: Option<List<Type>>,
}

#[derive(Clone, Copy)]
pub struct ExpressionWithTypeArguments {
    pub expression: Expr,
    pub type_arguments: Option<List<Type>>,
}

#[derive(Clone, Copy)]
pub struct ArrayType {
    pub element_type: Type,
}

#[derive(Clone, Copy)]
pub struct TupleType {
    pub elements: List<Type>,
}

#[derive(Clone, Copy)]
pub struct NamedTupleMember {
    pub dot_dot_dot_token: Option<Token>,
    pub name: Name,
    pub question_token: Option<Token>,
    pub type_node: Type,
}

/// `T?` as an element of a tuple.
#[derive(Clone, Copy)]
pub struct OptionalType {
    pub type_node: Type,
}

/// `...T` as an element of a tuple.
#[derive(Clone, Copy)]
pub struct RestType {
    pub type_node: Type,
}

/// `types` starts at the leading `|` when the source has one.
#[derive(Clone, Copy)]
pub struct UnionType {
    pub types: List<Type>,
}

/// `types` starts at the leading `&` when the source has one.
#[derive(Clone, Copy)]
pub struct IntersectionType {
    pub types: List<Type>,
}

#[derive(Clone, Copy)]
pub struct ConditionalType {
    pub check_type: Type,
    pub extends_type: Type,
    pub true_type: Type,
    pub false_type: Type,
}

#[derive(Clone, Copy)]
pub struct InferType {
    pub type_parameter: TypeParameter,
}

#[derive(Clone, Copy)]
pub struct MappedType {
    /// `Readonly`, or the `Plus` or `Minus` before `readonly`.
    pub readonly_token: Option<Token>,
    /// The name and, as its constraint, the type after `in`.
    pub type_parameter: TypeParameter,
    /// The type after `as`.
    pub name_type: Option<Type>,
    /// `Question`, or the `Plus` or `Minus` before `?`.
    pub question_token: Option<Token>,
    pub type_node: Option<Type>,
    /// What follows the mapping before `}`: the checker rejects a list that is not empty.
    pub members: List<Member>,
}

#[derive(Clone, Copy)]
pub struct IndexedAccessType {
    pub object_type: Type,
    pub index_type: Type,
}

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum TypeOperatorKind {
    KeyOf,
    Unique,
    Readonly,
}

#[derive(Clone, Copy)]
pub struct TypeOperator {
    pub operator: TypeOperatorKind,
    pub type_node: Type,
}

#[derive(Clone, Copy)]
pub struct TypeQuery {
    pub expr_name: EntityName,
    pub type_arguments: Option<List<Type>>,
}

#[derive(Clone, Copy)]
pub struct FunctionType {
    pub type_parameters: Option<List<TypeParameter>>,
    pub parameters: List<Parameter>,
    pub type_node: Option<Type>,
}

#[derive(Clone, Copy)]
pub struct ConstructorType {
    /// `abstract`, or nothing.
    pub modifiers: StoreSlice<Modifier>,
    pub type_parameters: Option<List<TypeParameter>>,
    pub parameters: List<Parameter>,
    pub type_node: Option<Type>,
}

#[derive(Clone, Copy)]
pub struct TypeLiteral {
    pub members: List<Member>,
}

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum TemplatePieceKind {
    Head,
    Middle,
    Tail,
}

impl TemplatePieceKind {
    /// The name that `ts.SyntaxKind` has for the kind.
    pub const fn kind_name(self) -> &'static str {
        match self {
            TemplatePieceKind::Head => "TemplateHead",
            TemplatePieceKind::Middle => "TemplateMiddle",
            TemplatePieceKind::Tail => "TemplateTail",
        }
    }
}

/// `TemplateHead`, `TemplateMiddle` or `TemplateTail`, from its `` ` `` or `}` to its `${` or `` ` ``.
#[derive(Clone, Copy)]
pub struct TemplatePiece {
    pub start: u32,
    pub end: u32,
    pub kind: TemplatePieceKind,
    /// The text without escapes.
    pub text: StoreRef<E::EString>,
}

#[derive(Clone, Copy)]
pub struct TemplateLiteralType {
    pub head: TemplatePiece,
    pub template_spans: List<TemplateLiteralTypeSpan>,
}

#[derive(Clone, Copy)]
pub struct TemplateLiteralTypeSpan {
    pub start: u32,
    pub end: u32,
    pub type_node: Type,
    pub literal: TemplatePiece,
}

#[derive(Clone, Copy)]
pub struct ImportType {
    pub is_type_of: bool,
    pub argument: Type,
    pub attributes: Option<StoreRef<ImportAttributes>>,
    pub qualifier: Option<EntityName>,
    pub type_arguments: Option<List<Type>>,
}

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ImportAttributesToken {
    With,
    Assert,
}

#[derive(Clone, Copy)]
pub struct ImportAttributes {
    pub start: u32,
    pub end: u32,
    pub token: ImportAttributesToken,
    pub attributes: List<ImportAttribute>,
    pub multi_line: bool,
}

#[derive(Clone, Copy)]
pub struct ImportAttribute {
    pub start: u32,
    pub end: u32,
    pub name: ImportAttributeName,
    pub value: Expr,
}

#[derive(Clone, Copy)]
pub enum ImportAttributeName {
    Identifier(Name),
    String(Literal),
}

impl ImportAttributeName {
    #[inline]
    pub const fn start(&self) -> u32 {
        match self {
            ImportAttributeName::Identifier(name) => name.start,
            ImportAttributeName::String(literal) => literal.start,
        }
    }

    #[inline]
    pub const fn end(&self) -> u32 {
        match self {
            ImportAttributeName::Identifier(name) => name.end,
            ImportAttributeName::String(literal) => literal.end,
        }
    }
}

#[derive(Clone, Copy)]
pub struct ParenthesizedType {
    pub type_node: Type,
}

#[derive(Clone, Copy)]
pub struct TypePredicate {
    pub asserts_modifier: Option<Token>,
    pub parameter_name: TypePredicateParameterName,
    pub type_node: Option<Type>,
}

#[derive(Clone, Copy)]
pub enum TypePredicateParameterName {
    Identifier(Name),
    /// A `ThisTypeNode` with this range.
    This {
        start: u32,
        end: u32,
    },
}

impl TypePredicateParameterName {
    #[inline]
    pub const fn start(&self) -> u32 {
        match self {
            TypePredicateParameterName::Identifier(name) => name.start,
            TypePredicateParameterName::This { start, .. } => *start,
        }
    }

    #[inline]
    pub const fn end(&self) -> u32 {
        match self {
            TypePredicateParameterName::Identifier(name) => name.end,
            TypePredicateParameterName::This { end, .. } => *end,
        }
    }
}

#[derive(Clone, Copy)]
pub struct JSDocNullableType {
    pub type_node: Type,
}

#[derive(Clone, Copy)]
pub struct JSDocNonNullableType {
    pub type_node: Type,
}

/// A modifier keyword or a decorator, in the order of the source.
#[derive(Clone, Copy)]
pub struct Modifier {
    pub start: u32,
    pub end: u32,
    pub data: ModifierData,
}

#[derive(Clone, Copy)]
pub enum ModifierData {
    Keyword(ModifierKind),
    Decorator(Expr),
}

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ModifierKind {
    Abstract,
    Accessor,
    Async,
    Const,
    Declare,
    Default,
    Export,
    In,
    Private,
    Protected,
    Public,
    Readonly,
    Out,
    Override,
    Static,
}

impl Modifier {
    #[inline]
    pub const fn keyword(kind: ModifierKind, start: u32, end: u32) -> Modifier {
        Modifier {
            start,
            end,
            data: ModifierData::Keyword(kind),
        }
    }

    #[inline]
    pub const fn decorator(expression: Expr, start: u32, end: u32) -> Modifier {
        Modifier {
            start,
            end,
            data: ModifierData::Decorator(expression),
        }
    }
}

#[derive(Clone, Copy)]
pub struct TypeParameter {
    pub start: u32,
    pub end: u32,
    /// `in`, `out` and `const`.
    pub modifiers: StoreSlice<Modifier>,
    pub name: Name,
    pub constraint: Option<Type>,
    /// What follows `extends` when it starts an expression and cannot start a type.
    pub expression: Option<Expr>,
    pub default_type: Option<Type>,
}

#[derive(Clone, Copy)]
pub struct Parameter {
    pub start: u32,
    pub end: u32,
    pub modifiers: StoreSlice<Modifier>,
    pub dot_dot_dot_token: Option<Token>,
    /// Not declared: each name is a `Ref` to its text. A `this` parameter is a `B::Identifier` that names `this`.
    pub name: Binding,
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
#[derive(Clone, Copy)]
pub struct HeritageClause {
    pub start: u32,
    pub end: u32,
    pub token: HeritageToken,
    pub types: List<Type>,
}

#[derive(Clone, Copy)]
pub enum PropertyName {
    Identifier(Name),
    /// `String`, `Number` or `BigInt`.
    Literal(Literal),
    Computed(StoreRef<ComputedPropertyName>),
}

#[derive(Clone, Copy)]
pub struct ComputedPropertyName {
    pub start: u32,
    pub end: u32,
    pub expression: Expr,
}

impl PropertyName {
    /// `[expression]`, with the `ComputedPropertyName` in `arena`.
    #[inline]
    pub fn computed(arena: &Arena, expression: Expr, start: u32, end: u32) -> PropertyName {
        PropertyName::Computed(StoreRef::from_bump(arena.alloc(ComputedPropertyName {
            start,
            end,
            expression,
        })))
    }

    #[inline]
    pub fn start(&self) -> u32 {
        match self {
            PropertyName::Identifier(name) => name.start,
            PropertyName::Literal(literal) => literal.start,
            PropertyName::Computed(name) => name.start,
        }
    }

    #[inline]
    pub fn end(&self) -> u32 {
        match self {
            PropertyName::Identifier(name) => name.end,
            PropertyName::Literal(literal) => literal.end,
            PropertyName::Computed(name) => name.end,
        }
    }
}

/// A member of a type literal, of a mapped type or of an interface. Its range takes the `;` or `,` after it.
#[derive(Clone, Copy)]
pub struct Member {
    pub start: u32,
    pub end: u32,
    pub data: MemberData,
}

#[derive(Clone, Copy)]
pub enum MemberData {
    PropertySignature(StoreRef<PropertySignature>),
    MethodSignature(StoreRef<MethodSignature>),
    CallSignature(StoreRef<CallSignature>),
    ConstructSignature(StoreRef<ConstructSignature>),
    IndexSignature(StoreRef<IndexSignature>),
    GetAccessor(StoreRef<GetAccessor>),
    SetAccessor(StoreRef<SetAccessor>),
}

/// A payload of [`MemberData`].
pub trait IntoMemberData: Sized {
    /// The variant that holds a payload of this kind.
    fn member_data(payload: StoreRef<Self>) -> MemberData;

    /// Puts `self` in `arena`.
    #[inline]
    fn into_member_data(self, arena: &Arena) -> MemberData {
        Self::member_data(StoreRef::from_bump(arena.alloc(self)))
    }
}

macro_rules! impl_into_member_data {
    ($($ty:ident),* $(,)?) => {
        $(
            impl IntoMemberData for $ty {
                #[inline]
                fn member_data(payload: StoreRef<Self>) -> MemberData {
                    MemberData::$ty(payload)
                }
            }
        )*
    };
}

impl_into_member_data! {
    PropertySignature,
    MethodSignature,
    CallSignature,
    ConstructSignature,
    IndexSignature,
    GetAccessor,
    SetAccessor,
}

impl Member {
    /// Puts `payload` in `arena`.
    #[inline]
    pub fn alloc<T: IntoMemberData>(arena: &Arena, payload: T, start: u32, end: u32) -> Member {
        Member {
            start,
            end,
            data: payload.into_member_data(arena),
        }
    }
}

impl MemberData {
    /// The name that `ts.SyntaxKind` has for the kind.
    pub const fn kind_name(&self) -> &'static str {
        match self {
            MemberData::PropertySignature(_) => "PropertySignature",
            MemberData::MethodSignature(_) => "MethodSignature",
            MemberData::CallSignature(_) => "CallSignature",
            MemberData::ConstructSignature(_) => "ConstructSignature",
            MemberData::IndexSignature(_) => "IndexSignature",
            MemberData::GetAccessor(_) => "GetAccessor",
            MemberData::SetAccessor(_) => "SetAccessor",
        }
    }
}

#[derive(Clone, Copy)]
pub struct PropertySignature {
    pub modifiers: StoreSlice<Modifier>,
    pub name: PropertyName,
    /// `Question`.
    pub postfix_token: Option<Token>,
    pub type_node: Option<Type>,
    /// The checker rejects it.
    pub initializer: Option<Expr>,
}

#[derive(Clone, Copy)]
pub struct MethodSignature {
    pub modifiers: StoreSlice<Modifier>,
    pub name: PropertyName,
    /// `Question`.
    pub postfix_token: Option<Token>,
    pub type_parameters: Option<List<TypeParameter>>,
    pub parameters: List<Parameter>,
    pub type_node: Option<Type>,
}

#[derive(Clone, Copy)]
pub struct CallSignature {
    pub type_parameters: Option<List<TypeParameter>>,
    pub parameters: List<Parameter>,
    pub type_node: Option<Type>,
}

#[derive(Clone, Copy)]
pub struct ConstructSignature {
    pub type_parameters: Option<List<TypeParameter>>,
    pub parameters: List<Parameter>,
    pub type_node: Option<Type>,
}

#[derive(Clone, Copy)]
pub struct IndexSignature {
    pub modifiers: StoreSlice<Modifier>,
    pub parameters: List<Parameter>,
    pub type_node: Option<Type>,
}

#[derive(Clone, Copy)]
pub struct GetAccessor {
    pub modifiers: StoreSlice<Modifier>,
    pub name: PropertyName,
    pub type_parameters: Option<List<TypeParameter>>,
    pub parameters: List<Parameter>,
    pub type_node: Option<Type>,
    /// The checker rejects it.
    pub body: Option<Body>,
}

#[derive(Clone, Copy)]
pub struct SetAccessor {
    pub modifiers: StoreSlice<Modifier>,
    pub name: PropertyName,
    pub type_parameters: Option<List<TypeParameter>>,
    pub parameters: List<Parameter>,
    pub type_node: Option<Type>,
    /// The checker rejects it.
    pub body: Option<Body>,
}

/// The block of an accessor, from `{` to `}`.
#[derive(Clone, Copy)]
pub struct Body {
    pub start: u32,
    pub end: u32,
    pub stmts: StoreSlice<Stmt>,
}

const _: () = assert!(core::mem::size_of::<Type>() == 20);
const _: () = assert!(core::mem::size_of::<TypeData>() == 12);
const _: () = assert!(core::mem::size_of::<Option<Type>>() == 20);
const _: () = assert!(core::mem::size_of::<Member>() == 20);
const _: () = assert!(core::mem::size_of::<MemberData>() == 12);
const _: () = assert!(core::mem::size_of::<List<Type>>() == 20);
const _: () = assert!(core::mem::size_of::<Option<List<Type>>>() == 20);
const _: () = assert!(core::mem::size_of::<Token>() == 12);
const _: () = assert!(core::mem::size_of::<Option<Token>>() == 12);
const _: () = assert!(core::mem::size_of::<Name>() == 20);
const _: () = assert!(core::mem::size_of::<EntityName>() == 20);
const _: () = assert!(core::mem::size_of::<QualifiedName>() == 48);
const _: () = assert!(core::mem::size_of::<Literal>() == 20);
const _: () = assert!(core::mem::size_of::<LiteralData>() == 12);
const _: () = assert!(core::mem::size_of::<PropertyName>() == 24);
const _: () = assert!(core::mem::size_of::<ComputedPropertyName>() == 24);
const _: () = assert!(core::mem::size_of::<Modifier>() == 24);
const _: () = assert!(core::mem::size_of::<ModifierData>() == 16);
const _: () = assert!(core::mem::size_of::<TypeParameter>() == 96);
const _: () = assert!(core::mem::size_of::<Parameter>() == 96);
const _: () = assert!(core::mem::size_of::<HeritageClause>() == 32);
const _: () = assert!(core::mem::size_of::<LiteralType>() == 24);
const _: () = assert!(core::mem::size_of::<TypeReference>() == 40);
const _: () = assert!(core::mem::size_of::<ExpressionWithTypeArguments>() == 36);
const _: () = assert!(core::mem::size_of::<ArrayType>() == 20);
const _: () = assert!(core::mem::size_of::<TupleType>() == 20);
const _: () = assert!(core::mem::size_of::<NamedTupleMember>() == 64);
const _: () = assert!(core::mem::size_of::<OptionalType>() == 20);
const _: () = assert!(core::mem::size_of::<RestType>() == 20);
const _: () = assert!(core::mem::size_of::<UnionType>() == 20);
const _: () = assert!(core::mem::size_of::<IntersectionType>() == 20);
const _: () = assert!(core::mem::size_of::<ConditionalType>() == 80);
const _: () = assert!(core::mem::size_of::<InferType>() == 96);
const _: () = assert!(core::mem::size_of::<MappedType>() == 180);
const _: () = assert!(core::mem::size_of::<IndexedAccessType>() == 40);
const _: () = assert!(core::mem::size_of::<TypeOperator>() == 24);
const _: () = assert!(core::mem::size_of::<TypeQuery>() == 40);
const _: () = assert!(core::mem::size_of::<FunctionType>() == 60);
const _: () = assert!(core::mem::size_of::<ConstructorType>() == 72);
const _: () = assert!(core::mem::size_of::<TypeLiteral>() == 20);
const _: () = assert!(core::mem::size_of::<TemplatePiece>() == 20);
const _: () = assert!(core::mem::size_of::<TemplateLiteralType>() == 40);
const _: () = assert!(core::mem::size_of::<TemplateLiteralTypeSpan>() == 48);
const _: () = assert!(core::mem::size_of::<ImportType>() == 76);
const _: () = assert!(core::mem::size_of::<ImportAttributes>() == 32);
const _: () = assert!(core::mem::size_of::<ImportAttribute>() == 48);
const _: () = assert!(core::mem::size_of::<ImportAttributeName>() == 24);
const _: () = assert!(core::mem::size_of::<ParenthesizedType>() == 20);
const _: () = assert!(core::mem::size_of::<TypePredicate>() == 52);
const _: () = assert!(core::mem::size_of::<TypePredicateParameterName>() == 20);
const _: () = assert!(core::mem::size_of::<JSDocNullableType>() == 20);
const _: () = assert!(core::mem::size_of::<JSDocNonNullableType>() == 20);
const _: () = assert!(core::mem::size_of::<PropertySignature>() == 84);
const _: () = assert!(core::mem::size_of::<MethodSignature>() == 108);
const _: () = assert!(core::mem::size_of::<CallSignature>() == 60);
const _: () = assert!(core::mem::size_of::<ConstructSignature>() == 60);
const _: () = assert!(core::mem::size_of::<IndexSignature>() == 52);
const _: () = assert!(core::mem::size_of::<GetAccessor>() == 116);
const _: () = assert!(core::mem::size_of::<SetAccessor>() == 116);
const _: () = assert!(core::mem::size_of::<Body>() == 20);
const _: () = assert!(core::mem::align_of::<Type>() == 4);

/// The `pos` that TypeScript gives a node, a token or a list that starts at `start`: the end of the token before it. `comments` has every comment of `source`, in the order of the source.
pub fn full_start(source: &[u8], comments: &[Range], start: u32) -> u32 {
    let mut pos = (start as usize).min(source.len());
    let mut before = comments.partition_point(|comment| comment.end_i() <= pos);
    loop {
        let comment = before.checked_sub(1).and_then(|last| comments.get(last));
        let floor = comment.map_or(0, |comment| comment.end_i());
        pos = skip_whitespace_before(source, pos, floor);
        let Some(comment) = comment else {
            break;
        };
        if pos != floor {
            break;
        }
        pos = pos.min(comment.loc.i());
        before -= 1;
    }
    if hashbang_end(source).is_some_and(|end| pos <= end) {
        return 0;
    }
    pos as u32
}

/// Steps back from `pos` over white space and line breaks, not past `floor`.
fn skip_whitespace_before(source: &[u8], mut pos: usize, floor: usize) -> usize {
    while pos > floor {
        let Some((at, rune)) = rune_before(source, pos, floor) else {
            break;
        };
        let is_space = matches!(rune, 0x09..=0x0D | 0x2028 | 0x2029 | 0xFEFF)
            || bun_core::strings::is_unicode_space_separator(rune);
        if !is_space {
            break;
        }
        pos = at;
    }
    pos
}

/// The code point that ends at `pos` and where it starts, as the lexer reads it: a byte that no lead byte claims is a code point.
fn rune_before(source: &[u8], pos: usize, floor: usize) -> Option<(usize, u32)> {
    let last = pos.checked_sub(1)?;
    let mut at = last;
    while at > floor && pos - at < 4 && source.get(at).is_some_and(|byte| byte & 0xC0 == 0x80) {
        at -= 1;
    }
    let lead = *source.get(at)?;
    if usize::from(bun_core::strings::wtf8_byte_sequence_length(lead)) != pos - at {
        return Some((last, u32::from(*source.get(last)?)));
    }
    let encoded = source.get(at..pos)?;
    let mut bytes = [0u8; 4];
    bytes.get_mut(..encoded.len())?.copy_from_slice(encoded);
    let rune = bun_core::strings::decode_wtf8_rune_t::<u32>(bytes, encoded.len() as u8, u32::MAX);
    Some((at, rune))
}

/// The end of the `#!` line that starts `source`: the lexer reads that line as one token and TypeScript as trivia.
fn hashbang_end(source: &[u8]) -> Option<usize> {
    if !source.starts_with(b"#!") {
        return None;
    }
    let line_end = bun_core::strings::index_of_any(source, b"\r\n").unwrap_or(source.len());
    let line = source.get(..line_end)?;
    let separator = ["\u{2028}", "\u{2029}"]
        .iter()
        .filter_map(|separator| bun_core::strings::index_of(line, separator.as_bytes()))
        .min();
    Some(separator.unwrap_or(line_end))
}

#[cfg(test)]
mod tests {
    use core::any::Any;
    use core::fmt::Write as _;

    use super::*;

    /// Owns what the nodes of a test point to: a test binary has no mimalloc to back an `Arena`.
    #[derive(Default)]
    struct Kept(Vec<Box<dyn Any>>);

    impl Kept {
        fn put<T: 'static>(&mut self, value: T) -> StoreRef<T> {
            self.0.push(Box::new(value));
            let kept = self.0.last_mut().and_then(|kept| kept.downcast_mut::<T>());
            StoreRef::from_bump(kept.expect("the value that was pushed"))
        }

        fn ty<T: IntoTypeData + 'static>(&mut self, payload: T, (start, end): (u32, u32)) -> Type {
            Type {
                start,
                end,
                data: T::type_data(self.put(payload)),
            }
        }

        fn member<T: IntoMemberData + 'static>(
            &mut self,
            payload: T,
            (start, end): (u32, u32),
        ) -> Member {
            Member {
                start,
                end,
                data: T::member_data(self.put(payload)),
            }
        }

        fn list<T: Copy + 'static>(&mut self, items: &[T], (start, end): (u32, u32)) -> List<T> {
            self.0.push(Box::new(items.to_vec()));
            let kept = self
                .0
                .last_mut()
                .and_then(|kept| kept.downcast_mut::<Vec<T>>());
            List {
                items: StoreSlice::new_mut(kept.expect("the list that was pushed")),
                start,
                end,
            }
        }

        fn reference(&mut self, source: &[u8], name: &'static str) -> Type {
            let (start, end) = span(source, name);
            let type_name = EntityName::Identifier(Name::new(name.as_bytes(), start, end));
            self.ty(
                TypeReference {
                    type_name,
                    type_arguments: None,
                },
                (start, end),
            )
        }
    }

    /// The offsets of the first `text` in `source`.
    fn span(source: &[u8], text: &str) -> (u32, u32) {
        let start = (0..source.len())
            .find(|&at| source[at..].starts_with(text.as_bytes()))
            .expect("the text is in the source");
        (start as u32, (start + text.len()) as u32)
    }

    fn text_of(source: &[u8], start: u32, end: u32) -> &str {
        core::str::from_utf8(&source[start as usize..end as usize]).expect("offsets of characters")
    }

    fn range_of(source: &[u8], text: &str) -> Range {
        let (start, end) = span(source, text);
        range(start, end)
    }

    fn of_signature(
        type_parameters: Option<List<TypeParameter>>,
        parameters: List<Parameter>,
        type_node: Option<Type>,
        out: &mut Vec<Type>,
    ) {
        for type_parameter in type_parameters.iter().flat_map(|list| list.iter()) {
            of_type_parameter(type_parameter, out);
        }
        for parameter in parameters.iter() {
            out.extend(parameter.type_node);
        }
        out.extend(type_node);
    }

    fn of_type_parameter(type_parameter: &TypeParameter, out: &mut Vec<Type>) {
        out.extend(type_parameter.constraint);
        out.extend(type_parameter.default_type);
    }

    fn of_members(members: &[Member], out: &mut Vec<Type>) {
        for member in members {
            match member.data {
                MemberData::PropertySignature(node) => out.extend(node.type_node),
                MemberData::MethodSignature(node) => {
                    of_signature(node.type_parameters, node.parameters, node.type_node, out);
                }
                MemberData::CallSignature(node) => {
                    of_signature(node.type_parameters, node.parameters, node.type_node, out);
                }
                MemberData::ConstructSignature(node) => {
                    of_signature(node.type_parameters, node.parameters, node.type_node, out);
                }
                MemberData::IndexSignature(node) => {
                    of_signature(None, node.parameters, node.type_node, out);
                }
                MemberData::GetAccessor(node) => {
                    of_signature(node.type_parameters, node.parameters, node.type_node, out);
                }
                MemberData::SetAccessor(node) => {
                    of_signature(node.type_parameters, node.parameters, node.type_node, out);
                }
            }
        }
    }

    /// The types directly under `ty`, in the order of the source.
    fn children(ty: &Type) -> Vec<Type> {
        let mut out = Vec::new();
        let arguments = |list: Option<List<Type>>, out: &mut Vec<Type>| {
            out.extend(list.iter().flat_map(|list| list.iter().copied()));
        };
        match ty.data {
            TypeData::Keyword(_) | TypeData::This | TypeData::JSDocAll | TypeData::Literal(_) => {}
            TypeData::TypeReference(node) => arguments(node.type_arguments, &mut out),
            TypeData::ExpressionWithTypeArguments(node) => arguments(node.type_arguments, &mut out),
            TypeData::Array(node) => out.push(node.element_type),
            TypeData::Tuple(node) => out.extend_from_slice(&node.elements),
            TypeData::NamedTupleMember(node) => out.push(node.type_node),
            TypeData::Optional(node) => out.push(node.type_node),
            TypeData::Rest(node) => out.push(node.type_node),
            TypeData::Union(node) => out.extend_from_slice(&node.types),
            TypeData::Intersection(node) => out.extend_from_slice(&node.types),
            TypeData::Conditional(node) => out.extend([
                node.check_type,
                node.extends_type,
                node.true_type,
                node.false_type,
            ]),
            TypeData::Infer(node) => of_type_parameter(&node.type_parameter, &mut out),
            TypeData::Mapped(node) => {
                of_type_parameter(&node.type_parameter, &mut out);
                out.extend(node.name_type);
                out.extend(node.type_node);
                of_members(&node.members, &mut out);
            }
            TypeData::IndexedAccess(node) => out.extend([node.object_type, node.index_type]),
            TypeData::TypeOperator(node) => out.push(node.type_node),
            TypeData::TypeQuery(node) => arguments(node.type_arguments, &mut out),
            TypeData::Function(node) => {
                of_signature(
                    node.type_parameters,
                    node.parameters,
                    node.type_node,
                    &mut out,
                );
            }
            TypeData::Constructor(node) => {
                of_signature(
                    node.type_parameters,
                    node.parameters,
                    node.type_node,
                    &mut out,
                );
            }
            TypeData::TypeLiteral(node) => of_members(&node.members, &mut out),
            TypeData::TemplateLiteral(node) => {
                out.extend(node.template_spans.iter().map(|span| span.type_node));
            }
            TypeData::Import(node) => {
                out.push(node.argument);
                arguments(node.type_arguments, &mut out);
            }
            TypeData::Parenthesized(node) => out.push(node.type_node),
            TypeData::TypePredicate(node) => out.extend(node.type_node),
            TypeData::JSDocNullable(node) => out.push(node.type_node),
            TypeData::JSDocNonNullable(node) => out.push(node.type_node),
        }
        out
    }

    /// One line for `ty` and for each type under it: the name of its kind and the text of its range.
    fn outline(source: &[u8], ty: &Type, depth: usize, out: &mut String) {
        let text = text_of(source, ty.start, ty.end);
        writeln!(out, "{:depth$}{} {text}", "", ty.data.kind_name()).expect("a String takes it");
        for child in children(ty) {
            outline(source, &child, depth + 1, out);
        }
    }

    #[test]
    fn every_payload_picks_its_kind() {
        let mut kept = Kept::default();
        let at = (0, 0);
        let any = Type::keyword(KeywordKind::Any, 0, 3);
        let name = Name::new(b"T", 0, 1);
        let entity = EntityName::Identifier(name);
        let type_parameter = TypeParameter {
            start: 0,
            end: 1,
            modifiers: StoreSlice::EMPTY,
            name,
            constraint: Some(any),
            expression: None,
            default_type: None,
        };
        let head = TemplatePiece {
            start: 0,
            end: 3,
            kind: TemplatePieceKind::Head,
            text: kept.put(E::EString::from_static(b"")),
        };
        let literal = Literal {
            start: 0,
            end: 4,
            data: LiteralData::Null,
        };
        let this = TypePredicateParameterName::This { start: 0, end: 4 };
        let types = [
            any,
            Type::this(0, 4),
            Type::jsdoc_all(0, 1),
            kept.ty(
                LiteralType {
                    literal,
                    negative: false,
                },
                at,
            ),
            kept.ty(
                TypeReference {
                    type_name: entity,
                    type_arguments: None,
                },
                at,
            ),
            kept.ty(
                ExpressionWithTypeArguments {
                    expression: Expr::EMPTY,
                    type_arguments: None,
                },
                at,
            ),
            kept.ty(ArrayType { element_type: any }, at),
            kept.ty(
                TupleType {
                    elements: List::empty(0, 0),
                },
                at,
            ),
            kept.ty(
                NamedTupleMember {
                    dot_dot_dot_token: None,
                    name,
                    question_token: None,
                    type_node: any,
                },
                at,
            ),
            kept.ty(OptionalType { type_node: any }, at),
            kept.ty(RestType { type_node: any }, at),
            kept.ty(
                UnionType {
                    types: List::empty(0, 0),
                },
                at,
            ),
            kept.ty(
                IntersectionType {
                    types: List::empty(0, 0),
                },
                at,
            ),
            kept.ty(
                ConditionalType {
                    check_type: any,
                    extends_type: any,
                    true_type: any,
                    false_type: any,
                },
                at,
            ),
            kept.ty(InferType { type_parameter }, at),
            kept.ty(
                MappedType {
                    readonly_token: None,
                    type_parameter,
                    name_type: Some(any),
                    question_token: None,
                    type_node: Some(any),
                    members: List::empty(0, 0),
                },
                at,
            ),
            kept.ty(
                IndexedAccessType {
                    object_type: any,
                    index_type: any,
                },
                at,
            ),
            kept.ty(
                TypeOperator {
                    operator: TypeOperatorKind::Unique,
                    type_node: any,
                },
                at,
            ),
            kept.ty(
                TypeQuery {
                    expr_name: entity,
                    type_arguments: None,
                },
                at,
            ),
            kept.ty(
                FunctionType {
                    type_parameters: None,
                    parameters: List::empty(0, 0),
                    type_node: Some(any),
                },
                at,
            ),
            kept.ty(
                ConstructorType {
                    modifiers: StoreSlice::EMPTY,
                    type_parameters: None,
                    parameters: List::empty(0, 0),
                    type_node: Some(any),
                },
                at,
            ),
            kept.ty(
                TypeLiteral {
                    members: List::empty(0, 0),
                },
                at,
            ),
            kept.ty(
                TemplateLiteralType {
                    head,
                    template_spans: List::empty(0, 0),
                },
                at,
            ),
            kept.ty(
                ImportType {
                    is_type_of: true,
                    argument: any,
                    attributes: None,
                    qualifier: Some(entity),
                    type_arguments: None,
                },
                at,
            ),
            kept.ty(ParenthesizedType { type_node: any }, at),
            kept.ty(
                TypePredicate {
                    asserts_modifier: None,
                    parameter_name: this,
                    type_node: Some(any),
                },
                at,
            ),
            kept.ty(JSDocNullableType { type_node: any }, at),
            kept.ty(JSDocNonNullableType { type_node: any }, at),
        ];
        let kinds: Vec<&str> = types.iter().map(|ty| ty.data.kind_name()).collect();
        assert_eq!(
            kinds,
            [
                "AnyKeyword",
                "ThisType",
                "JSDocAllType",
                "LiteralType",
                "TypeReference",
                "ExpressionWithTypeArguments",
                "ArrayType",
                "TupleType",
                "NamedTupleMember",
                "OptionalType",
                "RestType",
                "UnionType",
                "IntersectionType",
                "ConditionalType",
                "InferType",
                "MappedType",
                "IndexedAccessType",
                "TypeOperator",
                "TypeQuery",
                "FunctionType",
                "ConstructorType",
                "TypeLiteral",
                "TemplateLiteralType",
                "ImportType",
                "ParenthesizedType",
                "TypePredicate",
                "JSDocNullableType",
                "JSDocNonNullableType",
            ]
        );
        let under: Vec<usize> = types.iter().map(|ty| children(ty).len()).collect();
        assert_eq!(
            under,
            [
                0, 0, 0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 0, 4, 1, 3, 2, 1, 0, 1, 1, 0, 0, 1, 1, 1, 1, 1
            ]
        );

        let name = PropertyName::Identifier(name);
        let body = Body {
            start: 0,
            end: 2,
            stmts: StoreSlice::EMPTY,
        };
        let members = [
            kept.member(
                PropertySignature {
                    modifiers: StoreSlice::EMPTY,
                    name,
                    postfix_token: None,
                    type_node: Some(any),
                    initializer: None,
                },
                at,
            ),
            kept.member(
                MethodSignature {
                    modifiers: StoreSlice::EMPTY,
                    name,
                    postfix_token: None,
                    type_parameters: None,
                    parameters: List::empty(0, 0),
                    type_node: Some(any),
                },
                at,
            ),
            kept.member(
                CallSignature {
                    type_parameters: None,
                    parameters: List::empty(0, 0),
                    type_node: Some(any),
                },
                at,
            ),
            kept.member(
                ConstructSignature {
                    type_parameters: None,
                    parameters: List::empty(0, 0),
                    type_node: Some(any),
                },
                at,
            ),
            kept.member(
                IndexSignature {
                    modifiers: StoreSlice::EMPTY,
                    parameters: List::empty(0, 0),
                    type_node: Some(any),
                },
                at,
            ),
            kept.member(
                GetAccessor {
                    modifiers: StoreSlice::EMPTY,
                    name,
                    type_parameters: None,
                    parameters: List::empty(0, 0),
                    type_node: Some(any),
                    body: None,
                },
                at,
            ),
            kept.member(
                SetAccessor {
                    modifiers: StoreSlice::EMPTY,
                    name,
                    type_parameters: None,
                    parameters: List::empty(0, 0),
                    type_node: None,
                    body: Some(body),
                },
                at,
            ),
        ];
        let kinds: Vec<&str> = members
            .iter()
            .map(|member| member.data.kind_name())
            .collect();
        assert_eq!(
            kinds,
            [
                "PropertySignature",
                "MethodSignature",
                "CallSignature",
                "ConstructSignature",
                "IndexSignature",
                "GetAccessor",
                "SetAccessor",
            ]
        );
        let mut under = Vec::new();
        of_members(&members, &mut under);
        assert_eq!(under.len(), 6);
    }

    #[test]
    fn kinds_have_the_names_of_syntax_kind() {
        let mut kept = Kept::default();
        let keywords = [
            KeywordKind::Any,
            KeywordKind::Unknown,
            KeywordKind::String,
            KeywordKind::Number,
            KeywordKind::BigInt,
            KeywordKind::Symbol,
            KeywordKind::Boolean,
            KeywordKind::Undefined,
            KeywordKind::Never,
            KeywordKind::Object,
            KeywordKind::Void,
            KeywordKind::Intrinsic,
        ];
        assert_eq!(
            keywords.map(KeywordKind::kind_name),
            [
                "AnyKeyword",
                "UnknownKeyword",
                "StringKeyword",
                "NumberKeyword",
                "BigIntKeyword",
                "SymbolKeyword",
                "BooleanKeyword",
                "UndefinedKeyword",
                "NeverKeyword",
                "ObjectKeyword",
                "VoidKeyword",
                "IntrinsicKeyword",
            ]
        );
        let string = kept.put(E::EString::init(b"s"));
        let literals = [
            LiteralData::Null,
            LiteralData::True,
            LiteralData::False,
            LiteralData::number(1.5),
            LiteralData::BigInt(kept.put(E::BigInt {
                value: StoreStr::new(b"0x1f"),
            })),
            LiteralData::String(string),
            LiteralData::NoSubstitutionTemplate(string),
        ];
        assert_eq!(
            literals.map(|literal| literal.kind_name()),
            [
                "NullKeyword",
                "TrueKeyword",
                "FalseKeyword",
                "NumericLiteral",
                "BigIntLiteral",
                "StringLiteral",
                "NoSubstitutionTemplateLiteral",
            ]
        );
        let [
            _,
            _,
            _,
            LiteralData::Number(number),
            LiteralData::BigInt(bigint),
            LiteralData::String(string),
            _,
        ] = literals
        else {
            panic!("the literals above");
        };
        assert_eq!(number.value(), 1.5);
        assert_eq!(bigint.value.slice(), b"0x1f");
        assert_eq!(string.slice8(), b"s");
        let pieces = [
            TemplatePieceKind::Head,
            TemplatePieceKind::Middle,
            TemplatePieceKind::Tail,
        ];
        assert_eq!(
            pieces.map(TemplatePieceKind::kind_name),
            ["TemplateHead", "TemplateMiddle", "TemplateTail"]
        );
    }

    #[test]
    fn a_tree_keeps_the_range_of_every_node() {
        let source: &[u8] = b"let v: A.B<string[], [x?: -1n, ...T]> | keyof typeof a.#b;";
        let at = |text: &str| span(source, text);
        let mut kept = Kept::default();

        let (a_start, a_end) = at("A");
        let (b_start, b_end) = at("B");
        let type_name = EntityName::QualifiedName(kept.put(QualifiedName {
            start: a_start,
            end: b_end,
            left: EntityName::Identifier(Name::new(b"A", a_start, a_end)),
            right: Name::new(b"B", b_start, b_end),
        }));
        let (string_start, string_end) = at("string");
        let string = Type::keyword(KeywordKind::String, string_start, string_end);
        let array = kept.ty(
            ArrayType {
                element_type: string,
            },
            at("string[]"),
        );
        let (one_start, one_end) = at("1n");
        let one = Literal {
            start: one_start,
            end: one_end,
            data: LiteralData::BigInt(kept.put(E::BigInt {
                value: StoreStr::new(b"1"),
            })),
        };
        let minus_one = kept.ty(
            LiteralType {
                literal: one,
                negative: true,
            },
            at("-1n"),
        );
        let (x_start, x_end) = at("x");
        let (question_start, question_end) = at("?");
        let named = kept.ty(
            NamedTupleMember {
                dot_dot_dot_token: None,
                name: Name::new(b"x", x_start, x_end),
                question_token: Some(Token {
                    start: question_start,
                    end: question_end,
                    kind: TokenKind::Question,
                }),
                type_node: minus_one,
            },
            at("x?: -1n"),
        );
        let t = kept.reference(source, "T");
        let rest = kept.ty(RestType { type_node: t }, at("...T"));
        let (tuple_start, tuple_end) = at("[x?: -1n, ...T]");
        let elements = kept.list(&[named, rest], (tuple_start + 1, tuple_end - 1));
        let tuple = kept.ty(TupleType { elements }, (tuple_start, tuple_end));
        let type_arguments = kept.list(&[array, tuple], (at("<").1, at(">").0));
        let reference = kept.ty(
            TypeReference {
                type_name,
                type_arguments: Some(type_arguments),
            },
            at("A.B<string[], [x?: -1n, ...T]>"),
        );
        let (name_start, name_end) = at("a.#b");
        let expr_name = EntityName::QualifiedName(kept.put(QualifiedName {
            start: name_start,
            end: name_end,
            left: EntityName::Identifier(Name::new(b"a", name_start, name_start + 1)),
            right: Name::new(b"#b", name_start + 2, name_end),
        }));
        let query = kept.ty(
            TypeQuery {
                expr_name,
                type_arguments: None,
            },
            at("typeof a.#b"),
        );
        let operator = kept.ty(
            TypeOperator {
                operator: TypeOperatorKind::KeyOf,
                type_node: query,
            },
            at("keyof typeof a.#b"),
        );
        let whole = at("A.B<string[], [x?: -1n, ...T]> | keyof typeof a.#b");
        let types = kept.list(&[reference, operator], whole);
        let union = kept.ty(UnionType { types }, whole);

        let mut lines = String::new();
        outline(source, &union, 0, &mut lines);
        assert_eq!(
            lines,
            "UnionType A.B<string[], [x?: -1n, ...T]> | keyof typeof a.#b\n \
             TypeReference A.B<string[], [x?: -1n, ...T]>\n  \
             ArrayType string[]\n   \
             StringKeyword string\n  \
             TupleType [x?: -1n, ...T]\n   \
             NamedTupleMember x?: -1n\n    \
             LiteralType -1n\n   \
             RestType ...T\n    \
             TypeReference T\n \
             TypeOperator keyof typeof a.#b\n  \
             TypeQuery typeof a.#b\n"
        );

        assert_eq!(full_start(source, &[], union.start), at(":").1);
        assert_eq!(union.loc(), Loc { start: 7 });
        assert_eq!(
            union.range(),
            range_of(source, "A.B<string[], [x?: -1n, ...T]> | keyof typeof a.#b")
        );
        let TypeData::Union(union) = union.data else {
            panic!("a union");
        };
        let [reference, operator] = *union.types else {
            panic!("two types");
        };
        let TypeData::TypeReference(reference) = reference.data else {
            panic!("a type reference");
        };
        let name = reference.type_name;
        assert_eq!(text_of(source, name.start(), name.end()), "A.B");
        let EntityName::QualifiedName(name) = name else {
            panic!("a qualified name");
        };
        assert_eq!(name.left.end(), a_end);
        assert_eq!(name.right.text.slice(), b"B");
        assert!(!name.right.is_private());
        let arguments = reference.type_arguments.expect("type arguments");
        assert_eq!(
            text_of(source, arguments.start, arguments.end),
            "string[], [x?: -1n, ...T]"
        );
        let [_, tuple] = *arguments else {
            panic!("two type arguments");
        };
        let TypeData::Tuple(tuple) = tuple.data else {
            panic!("a tuple");
        };
        let elements = tuple.elements;
        assert_eq!(
            text_of(source, elements.start, elements.end),
            "x?: -1n, ...T"
        );
        let [named, _] = *elements else {
            panic!("two elements");
        };
        let TypeData::NamedTupleMember(named) = named.data else {
            panic!("a named member");
        };
        assert!(named.dot_dot_dot_token.is_none());
        let question = named.question_token.expect("a question token");
        assert_eq!(question.kind, TokenKind::Question);
        assert_eq!(text_of(source, question.start, question.end), "?");
        let TypeData::Literal(literal) = named.type_node.data else {
            panic!("a literal type");
        };
        assert!(literal.negative);
        assert_eq!(
            text_of(source, literal.literal.start, literal.literal.end),
            "1n"
        );
        let LiteralData::BigInt(digits) = literal.literal.data else {
            panic!("a bigint");
        };
        assert_eq!(digits.value.slice(), b"1");
        let TypeData::TypeOperator(operator) = operator.data else {
            panic!("a type operator");
        };
        assert_eq!(operator.operator, TypeOperatorKind::KeyOf);
        let TypeData::TypeQuery(query) = operator.type_node.data else {
            panic!("a type query");
        };
        let EntityName::QualifiedName(name) = query.expr_name else {
            panic!("a qualified name");
        };
        assert!(name.right.is_private());
        assert_eq!(text_of(source, name.right.start, name.right.end), "#b");
    }

    #[test]
    fn members_keep_their_modifiers_tokens_and_signatures() {
        let source: &[u8] =
            b"{ readonly a?: P; m<const Q extends R = never>(this: S, ...rest: V[]): rest is W[] }";
        let at = |text: &str| span(source, text);
        let mut kept = Kept::default();

        let (readonly_start, readonly_end) = at("readonly");
        let readonly = kept.list(
            &[Modifier::keyword(
                ModifierKind::Readonly,
                readonly_start,
                readonly_end,
            )],
            (readonly_start, readonly_end),
        );
        let (a_start, a_end) = at("a?");
        let p = kept.reference(source, "P");
        let property = kept.member(
            PropertySignature {
                modifiers: readonly.items,
                name: PropertyName::Identifier(Name::new(b"a", a_start, a_end - 1)),
                postfix_token: Some(Token {
                    start: a_end - 1,
                    end: a_end,
                    kind: TokenKind::Question,
                }),
                type_node: Some(p),
                initializer: None,
            },
            at("readonly a?: P;"),
        );

        let (const_start, const_end) = at("const");
        let modifiers = kept.list(
            &[Modifier::keyword(
                ModifierKind::Const,
                const_start,
                const_end,
            )],
            (const_start, const_end),
        );
        let (q_start, q_end) = at("Q");
        let r = kept.reference(source, "R");
        let (never_start, never_end) = at("never");
        let (type_parameter_start, type_parameter_end) = at("const Q extends R = never");
        let type_parameters = kept.list(
            &[TypeParameter {
                start: type_parameter_start,
                end: type_parameter_end,
                modifiers: modifiers.items,
                name: Name::new(b"Q", q_start, q_end),
                constraint: Some(r),
                expression: None,
                default_type: Some(Type::keyword(KeywordKind::Never, never_start, never_end)),
            }],
            (type_parameter_start, type_parameter_end),
        );
        let s = kept.reference(source, "S");
        let (this_start, this_end) = at("this: S");
        let this = Parameter {
            start: this_start,
            end: this_end,
            modifiers: StoreSlice::EMPTY,
            dot_dot_dot_token: None,
            name: Binding {
                loc: Loc {
                    start: this_start as i32,
                },
                ..Binding::default()
            },
            question_token: None,
            type_node: Some(s),
            initializer: None,
        };
        let v = kept.reference(source, "V");
        let v_array = kept.ty(ArrayType { element_type: v }, at("V[]"));
        let (rest_start, rest_end) = at("...rest: V[]");
        let rest = Parameter {
            start: rest_start,
            end: rest_end,
            modifiers: StoreSlice::EMPTY,
            dot_dot_dot_token: Some(Token {
                start: rest_start,
                end: rest_start + 3,
                kind: TokenKind::DotDotDot,
            }),
            name: Binding {
                loc: Loc {
                    start: rest_start as i32 + 3,
                },
                ..Binding::default()
            },
            question_token: None,
            type_node: Some(v_array),
            initializer: None,
        };
        let parameters = kept.list(&[this, rest], at("this: S, ...rest: V[]"));
        let w = kept.reference(source, "W");
        let w_array = kept.ty(ArrayType { element_type: w }, at("W[]"));
        let (predicate_start, predicate_end) = at("rest is W[]");
        let predicate = kept.ty(
            TypePredicate {
                asserts_modifier: None,
                parameter_name: TypePredicateParameterName::Identifier(Name::new(
                    b"rest",
                    predicate_start,
                    predicate_start + 4,
                )),
                type_node: Some(w_array),
            },
            (predicate_start, predicate_end),
        );
        let (m_start, m_end) = at("m<");
        let method = kept.member(
            MethodSignature {
                modifiers: StoreSlice::EMPTY,
                name: PropertyName::Identifier(Name::new(b"m", m_start, m_end - 1)),
                postfix_token: None,
                type_parameters: Some(type_parameters),
                parameters,
                type_node: Some(predicate),
            },
            at("m<const Q extends R = never>(this: S, ...rest: V[]): rest is W[]"),
        );
        let (literal_start, literal_end) = (0, source.len() as u32);
        let members = kept.list(&[property, method], (literal_start + 1, method.end));
        let literal = kept.ty(TypeLiteral { members }, (literal_start, literal_end));

        let mut lines = String::new();
        outline(source, &literal, 0, &mut lines);
        assert_eq!(
            lines,
            "TypeLiteral { readonly a?: P; m<const Q extends R = never>(this: S, ...rest: V[]): rest is W[] }\n \
             TypeReference P\n \
             TypeReference R\n \
             NeverKeyword never\n \
             TypeReference S\n \
             ArrayType V[]\n  \
             TypeReference V\n \
             TypePredicate rest is W[]\n  \
             ArrayType W[]\n   \
             TypeReference W\n"
        );

        let TypeData::TypeLiteral(literal) = literal.data else {
            panic!("a type literal");
        };
        let [property, method] = *literal.members else {
            panic!("two members");
        };
        assert_eq!(
            text_of(source, property.start, property.end),
            "readonly a?: P;"
        );
        let MemberData::PropertySignature(property) = property.data else {
            panic!("a property signature");
        };
        let [readonly] = *property.modifiers.slice() else {
            panic!("one modifier");
        };
        assert!(matches!(
            readonly.data,
            ModifierData::Keyword(ModifierKind::Readonly)
        ));
        assert_eq!(text_of(source, readonly.start, readonly.end), "readonly");
        let name = property.name;
        assert_eq!(text_of(source, name.start(), name.end()), "a");
        let question = property.postfix_token.expect("a question token");
        assert_eq!(text_of(source, question.start, question.end), "?");

        let MemberData::MethodSignature(method) = method.data else {
            panic!("a method signature");
        };
        let [type_parameter] = *method.type_parameters.expect("type parameters") else {
            panic!("one type parameter");
        };
        assert_eq!(
            text_of(source, type_parameter.start, type_parameter.end),
            "const Q extends R = never"
        );
        assert_eq!(type_parameter.name.text.slice(), b"Q");
        let [modifier] = *type_parameter.modifiers.slice() else {
            panic!("one modifier");
        };
        assert!(matches!(
            modifier.data,
            ModifierData::Keyword(ModifierKind::Const)
        ));
        let parameters = method.parameters;
        assert_eq!(
            text_of(source, parameters.start, parameters.end),
            "this: S, ...rest: V[]"
        );
        let [this, rest] = *parameters else {
            panic!("two parameters");
        };
        assert_eq!(text_of(source, this.start, this.end), "this: S");
        assert!(this.dot_dot_dot_token.is_none());
        let dots = rest.dot_dot_dot_token.expect("a rest token");
        assert_eq!(dots.kind, TokenKind::DotDotDot);
        assert_eq!(text_of(source, dots.start, dots.end), "...");
        assert_eq!(rest.name.loc.start, dots.end as i32);
        let TypeData::TypePredicate(predicate) = method.type_node.expect("a return type").data
        else {
            panic!("a type predicate");
        };
        let name = predicate.parameter_name;
        assert_eq!(text_of(source, name.start(), name.end()), "rest");
    }

    #[test]
    fn names_and_lists_report_their_range() {
        let mut kept = Kept::default();

        let computed = PropertyName::Computed(kept.put(ComputedPropertyName {
            start: 10,
            end: 15,
            expression: Expr::EMPTY,
        }));
        assert_eq!((computed.start(), computed.end()), (10, 15));
        let string = Literal {
            start: 20,
            end: 23,
            data: LiteralData::String(kept.put(E::EString::init(b"k"))),
        };
        let literal = PropertyName::Literal(string);
        assert_eq!((literal.start(), literal.end()), (20, 23));
        let attribute = ImportAttributeName::String(string);
        assert_eq!((attribute.start(), attribute.end()), (20, 23));
        let attribute = ImportAttributeName::Identifier(Name::new(b"type", 30, 34));
        assert_eq!((attribute.start(), attribute.end()), (30, 34));
        let this = TypePredicateParameterName::This { start: 40, end: 44 };
        assert_eq!((this.start(), this.end()), (40, 44));
        assert!(!Name::new(b"", 0, 0).is_private());

        assert_eq!(
            range(5, 9),
            Range {
                loc: Loc { start: 5 },
                len: 4
            }
        );
        assert_eq!(range(9, 5).len, 0);

        let empty: List<Type> = List::empty(4, 4);
        assert!(empty.is_empty());
        assert_eq!((empty.start, empty.end), (4, 4));
        let never = Type::keyword(KeywordKind::Never, 1, 6);
        let list = kept.list(&[never, Type::this(8, 12)], (1, 13));
        let copy = list;
        assert_eq!(copy.len(), 2);
        let last = list.last().expect("two items");
        assert!(matches!(last.data, TypeData::This));
        assert!(last.end < list.end);

        let decorator = Modifier::decorator(Expr::EMPTY, 50, 52);
        assert!(matches!(decorator.data, ModifierData::Decorator(_)));
        assert_eq!((decorator.start, decorator.end), (50, 52));
    }

    #[test]
    fn full_start_is_the_end_of_the_token_before() {
        let source = "a /* c */ // d\n\u{a0}\u{2028}\u{feff}\u{3000}\tb".as_bytes();
        let comments = [range_of(source, "/* c */"), range_of(source, "// d")];
        let b = span(source, "b").0;
        assert_eq!(full_start(source, &comments, b), 1);
        assert_eq!(
            full_start(source, &comments[..1], b),
            span(source, "// d").1
        );
        assert_eq!(full_start(source, &[], b), span(source, "// d").1);
        assert_eq!(full_start(source, &comments, 0), 0);
        assert_eq!(full_start(source, &comments, u32::MAX), source.len() as u32);

        let source = b"a/*c*/.b";
        let comments = [range_of(source, "/*c*/")];
        assert_eq!(full_start(source, &comments, span(source, ".").0), 1);
        assert_eq!(full_start(source, &comments, span(source, "b").0), 7);

        let source = b"  // c\n x";
        let comments = [range_of(source, "// c")];
        assert_eq!(full_start(source, &comments, span(source, "x").0), 0);

        let source = "\u{e9} x".as_bytes();
        assert_eq!(full_start(source, &[], span(source, "x").0), 2);
        let source = b"B\xA0x";
        assert_eq!(full_start(source, &[], 2), 1);
        let source = b"\xA0\xA0\xA0\xA0\xA0x";
        assert_eq!(full_start(source, &[], 5), 0);
    }

    #[test]
    fn full_start_takes_the_hashbang_as_trivia() {
        let source = b"#!/usr/bin/env bun\n// c\nx y";
        let comments = [range_of(source, "// c")];
        assert_eq!(full_start(source, &comments, span(source, "x").0), 0);
        assert_eq!(
            full_start(source, &comments, span(source, "y").0),
            span(source, "x").1
        );
        assert_eq!(full_start(b"#!a", &[], 3), 0);

        let source = "#!a\u{2028}b\nc".as_bytes();
        assert_eq!(full_start(source, &[], span(source, "b").0), 0);
        assert_eq!(
            full_start(source, &[], span(source, "c").0),
            span(source, "b").1
        );

        let source = b"# !a\nb";
        assert_eq!(
            full_start(source, &[], span(source, "b").0),
            span(source, "a").1
        );
    }
}
