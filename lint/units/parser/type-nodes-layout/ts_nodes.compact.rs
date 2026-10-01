//! TypeScript type syntax as a lint parse keeps it: one node kind for each kind that the type grammar of typescript-go builds.
use bun_alloc::{Arena, ArenaVec};
use crate::{Binding, E, Expr, Loc, Range, Stmt, StoreRef, StoreSlice, StoreStr};
/// A type. `start` is the offset of its first token, `end` the offset after its last token.
#[derive(Clone, Copy)] pub struct Type { pub start: u32, pub end: u32, pub data: TypeData, }
/// The kind of a type, with its payload in the arena of the lint parse.
#[derive(Clone, Copy)] pub enum TypeData {
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
/// Picks the variant of [`TypeData`] for a payload.
pub trait IntoTypeData: Sized {
    fn into_type_data(self, arena: &Arena) -> TypeData;
}
macro_rules! impl_into_type_data {
    ($($ty:ident => $variant:ident),* $(,)?) => {
        $(
            impl IntoTypeData for $ty {
                #[inline]
                fn into_type_data(self, arena: &Arena) -> TypeData {
                    TypeData::$variant(StoreRef::from_bump(arena.alloc(self)))
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
    #[inline] pub const fn keyword(kind: KeywordKind, start: u32, end: u32) -> Type {
        Type { start, end, data: TypeData::Keyword(kind) }
    }
    #[inline] pub const fn this(start: u32, end: u32) -> Type {
        Type { start, end, data: TypeData::This }
    }
    #[inline] pub const fn jsdoc_all(start: u32, end: u32) -> Type {
        Type { start, end, data: TypeData::JSDocAll }
    }
    /// Puts `payload` in `arena`.
    #[inline] pub fn alloc<T: IntoTypeData>(arena: &Arena, payload: T, start: u32, end: u32) -> Type {
        Type { start, end, data: payload.into_type_data(arena) }
    }
    #[inline] pub const fn loc(&self) -> Loc {
        Loc {
            start: self.start as i32,
        }
    }
    #[inline] pub const fn range(&self) -> Range {
        range(self.start, self.end)
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
#[repr(u8)] #[derive(Clone, Copy, PartialEq, Eq, Debug)] pub enum KeywordKind {
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
    #[inline] pub const fn empty(start: u32, end: u32) -> List<T> {
        List { items: StoreSlice::EMPTY, start, end }
    }
    /// Leaves `items` in the arena it grew in.
    #[inline] pub fn from_bump(items: ArenaVec<'_, T>, start: u32, end: u32) -> List<T> {
        List { items: StoreSlice::from_bump(items), start, end }
    }
    #[inline] pub fn from_slice(arena: &Arena, items: &[T], start: u32, end: u32) -> List<T>
    where
        T: Copy,
    {
        List { items: StoreSlice::new_mut(arena.alloc_slice_copy(items)), start, end }
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
#[derive(Clone, Copy)] pub struct Token { pub start: u32, pub end: u32, pub kind: TokenKind, }
#[repr(u8)] #[derive(Clone, Copy, PartialEq, Eq, Debug)] pub enum TokenKind { DotDotDot, Question, Exclamation, Plus, Minus, Readonly, Asserts, }
/// An identifier, a keyword read as a name, or a private name with its `#`.
#[derive(Clone, Copy)] pub struct Name {
    pub start: u32,
    pub end: u32,
    /// The name without escapes.
    pub text: StoreStr,
}
impl Name {
    #[inline] pub const fn new(text: &[u8], start: u32, end: u32) -> Name {
        Name {
            start,
            end,
            text: StoreStr::new(text),
        }
    }
    /// A `PrivateIdentifier`, where every other name is an `Identifier`.
    #[inline] pub fn is_private(&self) -> bool {
        self.text.first() == Some(&b'#')
    }
}
#[derive(Clone, Copy)] pub enum EntityName { Identifier(Name), QualifiedName(StoreRef<QualifiedName>), }
#[derive(Clone, Copy)] pub struct QualifiedName { pub start: u32, pub end: u32, pub left: EntityName, pub right: Name, }
impl EntityName {
    #[inline] pub fn qualified(arena: &Arena, left: EntityName, right: Name) -> EntityName {
        EntityName::QualifiedName(StoreRef::from_bump(arena.alloc(QualifiedName {
            start: left.start(),
            end: right.end,
            left,
            right,
        })))
    }
    #[inline] pub fn start(&self) -> u32 {
        match self { EntityName::Identifier(name) => name.start, EntityName::QualifiedName(name) => name.start, }
    }
    #[inline] pub fn end(&self) -> u32 {
        match self { EntityName::Identifier(name) => name.end, EntityName::QualifiedName(name) => name.end, }
    }
}
/// A literal as a literal type, a property name or the name of an import attribute holds it.
#[derive(Clone, Copy)] pub struct Literal { pub start: u32, pub end: u32, pub data: LiteralData, }
#[derive(Clone, Copy)] pub enum LiteralData {
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
    #[inline] pub const fn number(value: f64) -> LiteralData {
        LiteralData::Number(E::Number::new(value))
    }
    #[inline] pub fn bigint(arena: &Arena, digits: &[u8]) -> LiteralData {
        LiteralData::BigInt(StoreRef::from_bump(arena.alloc(E::BigInt {
            value: StoreStr::new(digits),
        })))
    }
    /// `NoSubstitutionTemplate` when the lexer read `value` between backticks.
    #[inline] pub fn string(arena: &Arena, value: E::EString, is_template: bool) -> LiteralData {
        let value = StoreRef::from_bump(arena.alloc(value));
        if is_template {
            LiteralData::NoSubstitutionTemplate(value)
        } else {
            LiteralData::String(value)
        }
    }
}
/// `negative` puts a `PrefixUnaryExpression` with the range of the type around `literal`.
#[derive(Clone, Copy)] pub struct LiteralType { pub literal: Literal, pub negative: bool, }
#[derive(Clone, Copy)] pub struct TypeReference { pub type_name: EntityName, pub type_arguments: Option<List<Type>>, }
#[derive(Clone, Copy)] pub struct ExpressionWithTypeArguments { pub expression: Expr, pub type_arguments: Option<List<Type>>, }
#[derive(Clone, Copy)] pub struct ArrayType { pub element_type: Type, }
#[derive(Clone, Copy)] pub struct TupleType { pub elements: List<Type>, }
#[derive(Clone, Copy)] pub struct NamedTupleMember { pub dot_dot_dot_token: Option<Token>, pub name: Name, pub question_token: Option<Token>, pub type_node: Type, }
/// `T?` as an element of a tuple.
#[derive(Clone, Copy)] pub struct OptionalType { pub type_node: Type, }
/// `...T` as an element of a tuple.
#[derive(Clone, Copy)] pub struct RestType { pub type_node: Type, }
/// `types` starts at the leading `|` when the source has one.
#[derive(Clone, Copy)] pub struct UnionType { pub types: List<Type>, }
/// `types` starts at the leading `&` when the source has one.
#[derive(Clone, Copy)] pub struct IntersectionType { pub types: List<Type>, }
#[derive(Clone, Copy)] pub struct ConditionalType { pub check_type: Type, pub extends_type: Type, pub true_type: Type, pub false_type: Type, }
#[derive(Clone, Copy)] pub struct InferType { pub type_parameter: TypeParameter, }
#[derive(Clone, Copy)] pub struct MappedType {
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
#[derive(Clone, Copy)] pub struct IndexedAccessType { pub object_type: Type, pub index_type: Type, }
#[repr(u8)] #[derive(Clone, Copy, PartialEq, Eq, Debug)] pub enum TypeOperatorKind { KeyOf, Unique, Readonly, }
#[derive(Clone, Copy)] pub struct TypeOperator { pub operator: TypeOperatorKind, pub type_node: Type, }
#[derive(Clone, Copy)] pub struct TypeQuery { pub expr_name: EntityName, pub type_arguments: Option<List<Type>>, }
#[derive(Clone, Copy)] pub struct FunctionType { pub type_parameters: Option<List<TypeParameter>>, pub parameters: List<Parameter>, pub type_node: Option<Type>, }
#[derive(Clone, Copy)] pub struct ConstructorType {
    /// `abstract`, or nothing.
    pub modifiers: StoreSlice<Modifier>,
    pub type_parameters: Option<List<TypeParameter>>,
    pub parameters: List<Parameter>,
    pub type_node: Option<Type>,
}
#[derive(Clone, Copy)] pub struct TypeLiteral { pub members: List<Member>, }
#[repr(u8)] #[derive(Clone, Copy, PartialEq, Eq, Debug)] pub enum TemplatePieceKind { Head, Middle, Tail, }
/// `TemplateHead`, `TemplateMiddle` or `TemplateTail`, from its `` ` `` or `}` to its `${` or `` ` ``.
#[derive(Clone, Copy)] pub struct TemplatePiece {
    pub start: u32,
    pub end: u32,
    pub kind: TemplatePieceKind,
    /// The text without escapes.
    pub text: StoreRef<E::EString>,
}
#[derive(Clone, Copy)] pub struct TemplateLiteralType { pub head: TemplatePiece, pub template_spans: List<TemplateLiteralTypeSpan>, }
#[derive(Clone, Copy)] pub struct TemplateLiteralTypeSpan { pub start: u32, pub end: u32, pub type_node: Type, pub literal: TemplatePiece, }
#[derive(Clone, Copy)] pub struct ImportType { pub is_type_of: bool, pub argument: Type, pub attributes: Option<StoreRef<ImportAttributes>>, pub qualifier: Option<EntityName>, pub type_arguments: Option<List<Type>>, }
#[repr(u8)] #[derive(Clone, Copy, PartialEq, Eq, Debug)] pub enum ImportAttributesToken { With, Assert, }
#[derive(Clone, Copy)] pub struct ImportAttributes { pub start: u32, pub end: u32, pub token: ImportAttributesToken, pub attributes: List<ImportAttribute>, pub multi_line: bool, }
#[derive(Clone, Copy)] pub struct ImportAttribute { pub start: u32, pub end: u32, pub name: ImportAttributeName, pub value: Expr, }
#[derive(Clone, Copy)] pub enum ImportAttributeName { Identifier(Name), String(Literal), }
impl ImportAttributeName {
    #[inline] pub const fn start(&self) -> u32 {
        match self { ImportAttributeName::Identifier(name) => name.start, ImportAttributeName::String(literal) => literal.start, }
    }
    #[inline] pub const fn end(&self) -> u32 {
        match self { ImportAttributeName::Identifier(name) => name.end, ImportAttributeName::String(literal) => literal.end, }
    }
}
#[derive(Clone, Copy)] pub struct ParenthesizedType { pub type_node: Type, }
#[derive(Clone, Copy)] pub struct TypePredicate { pub asserts_modifier: Option<Token>, pub parameter_name: TypePredicateParameterName, pub type_node: Option<Type>, }
#[derive(Clone, Copy)] pub enum TypePredicateParameterName {
    Identifier(Name),
    /// A `ThisTypeNode` with this range.
    This {
        start: u32,
        end: u32,
    },
}
impl TypePredicateParameterName {
    #[inline] pub const fn start(&self) -> u32 {
        match self { TypePredicateParameterName::Identifier(name) => name.start, TypePredicateParameterName::This { start, .. } => *start, }
    }
    #[inline] pub const fn end(&self) -> u32 {
        match self { TypePredicateParameterName::Identifier(name) => name.end, TypePredicateParameterName::This { end, .. } => *end, }
    }
}
#[derive(Clone, Copy)] pub struct JSDocNullableType { pub type_node: Type, }
#[derive(Clone, Copy)] pub struct JSDocNonNullableType { pub type_node: Type, }
/// A modifier keyword or a decorator, in the order of the source.
#[derive(Clone, Copy)] pub struct Modifier { pub start: u32, pub end: u32, pub data: ModifierData, }
#[derive(Clone, Copy)] pub enum ModifierData { Keyword(ModifierKind), Decorator(Expr), }
#[repr(u8)] #[derive(Clone, Copy, PartialEq, Eq, Debug)] pub enum ModifierKind { Abstract, Accessor, Async, Const, Declare, Default, Export, In, Private, Protected, Public, Readonly, Out, Override, Static, }
impl Modifier {
    #[inline] pub const fn keyword(kind: ModifierKind, start: u32, end: u32) -> Modifier {
        Modifier { start, end, data: ModifierData::Keyword(kind) }
    }
    #[inline] pub const fn decorator(expression: Expr, start: u32, end: u32) -> Modifier {
        Modifier { start, end, data: ModifierData::Decorator(expression) }
    }
}
#[derive(Clone, Copy)] pub struct TypeParameter {
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
#[derive(Clone, Copy)] pub struct Parameter {
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
#[repr(u8)] #[derive(Clone, Copy, PartialEq, Eq, Debug)] pub enum HeritageToken { Extends, Implements, }
/// Each of `types` is a `TypeReference` or an `ExpressionWithTypeArguments`.
#[derive(Clone, Copy)] pub struct HeritageClause { pub start: u32, pub end: u32, pub token: HeritageToken, pub types: List<Type>, }
#[derive(Clone, Copy)] pub enum PropertyName {
    Identifier(Name),
    /// `String`, `Number` or `BigInt`.
    Literal(Literal),
    Computed(StoreRef<ComputedPropertyName>),
}
#[derive(Clone, Copy)] pub struct ComputedPropertyName { pub start: u32, pub end: u32, pub expression: Expr, }
impl PropertyName {
    #[inline] pub fn computed(arena: &Arena, expression: Expr, start: u32, end: u32) -> PropertyName {
        PropertyName::Computed(StoreRef::from_bump(arena.alloc(ComputedPropertyName {
            start,
            end,
            expression,
        })))
    }
    #[inline] pub fn start(&self) -> u32 {
        match self { PropertyName::Identifier(name) => name.start, PropertyName::Literal(literal) => literal.start, PropertyName::Computed(name) => name.start, }
    }
    #[inline] pub fn end(&self) -> u32 {
        match self { PropertyName::Identifier(name) => name.end, PropertyName::Literal(literal) => literal.end, PropertyName::Computed(name) => name.end, }
    }
}
/// A member of a type literal, of a mapped type or of an interface. Its range takes the `;` or `,` after it.
#[derive(Clone, Copy)] pub struct Member { pub start: u32, pub end: u32, pub data: MemberData, }
#[derive(Clone, Copy)] pub enum MemberData { PropertySignature(StoreRef<PropertySignature>), MethodSignature(StoreRef<MethodSignature>), CallSignature(StoreRef<CallSignature>), ConstructSignature(StoreRef<ConstructSignature>), IndexSignature(StoreRef<IndexSignature>), GetAccessor(StoreRef<GetAccessor>), SetAccessor(StoreRef<SetAccessor>), }
/// Picks the variant of [`MemberData`] for a payload.
pub trait IntoMemberData: Sized {
    fn into_member_data(self, arena: &Arena) -> MemberData;
}
macro_rules! impl_into_member_data {
    ($($ty:ident),* $(,)?) => {
        $(
            impl IntoMemberData for $ty {
                #[inline]
                fn into_member_data(self, arena: &Arena) -> MemberData {
                    MemberData::$ty(StoreRef::from_bump(arena.alloc(self)))
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
    #[inline] pub fn alloc<T: IntoMemberData>(arena: &Arena, payload: T, start: u32, end: u32) -> Member {
        Member { start, end, data: payload.into_member_data(arena) }
    }
}
#[derive(Clone, Copy)] pub struct PropertySignature {
    pub modifiers: StoreSlice<Modifier>,
    pub name: PropertyName,
    /// `Question`.
    pub postfix_token: Option<Token>,
    pub type_node: Option<Type>,
    /// The checker rejects it.
    pub initializer: Option<Expr>,
}
#[derive(Clone, Copy)] pub struct MethodSignature {
    pub modifiers: StoreSlice<Modifier>,
    pub name: PropertyName,
    /// `Question`.
    pub postfix_token: Option<Token>,
    pub type_parameters: Option<List<TypeParameter>>,
    pub parameters: List<Parameter>,
    pub type_node: Option<Type>,
}
#[derive(Clone, Copy)] pub struct CallSignature { pub type_parameters: Option<List<TypeParameter>>, pub parameters: List<Parameter>, pub type_node: Option<Type>, }
#[derive(Clone, Copy)] pub struct ConstructSignature { pub type_parameters: Option<List<TypeParameter>>, pub parameters: List<Parameter>, pub type_node: Option<Type>, }
#[derive(Clone, Copy)] pub struct IndexSignature { pub modifiers: StoreSlice<Modifier>, pub parameters: List<Parameter>, pub type_node: Option<Type>, }
#[derive(Clone, Copy)] pub struct GetAccessor {
    pub modifiers: StoreSlice<Modifier>,
    pub name: PropertyName,
    pub type_parameters: Option<List<TypeParameter>>,
    pub parameters: List<Parameter>,
    pub type_node: Option<Type>,
    /// The checker rejects it.
    pub body: Option<Body>,
}
#[derive(Clone, Copy)] pub struct SetAccessor {
    pub modifiers: StoreSlice<Modifier>,
    pub name: PropertyName,
    pub type_parameters: Option<List<TypeParameter>>,
    pub parameters: List<Parameter>,
    pub type_node: Option<Type>,
    /// The checker rejects it.
    pub body: Option<Body>,
}
/// The block of an accessor, from `{` to `}`.
#[derive(Clone, Copy)] pub struct Body { pub start: u32, pub end: u32, pub stmts: StoreSlice<Stmt>, }
/// The `pos` that TypeScript gives a node, a token or a list that starts at `start`: the end of the token before it.
pub fn full_start(source: &[u8], comments: &[Range], start: u32) -> u32 {
    let mut pos = (start as usize).min(source.len());
    let mut before = comments.partition_point(|comment| comment.end_i() <= pos);
    loop {
        let floor = if before > 0 {
            comments[before - 1].end_i()
        } else {
            0
        };
        pos = skip_whitespace_before(source, pos, floor);
        if before == 0 || pos != floor {
            break;
        }
        before -= 1;
        pos = comments[before].loc.i().min(pos);
    }
    if is_hashbang(&source[..pos]) {
        return 0;
    }
    pos as u32
}
fn skip_whitespace_before(source: &[u8], mut pos: usize, floor: usize) -> usize {
    while pos > floor {
        let mut at = pos - 1;
        while at > floor && source[at] & 0xC0 == 0x80 && pos - at < 4 {
            at -= 1;
        }
        let len = pos - at;
        let mut bytes = [0u8; 4];
        bytes[..len].copy_from_slice(&source[at..pos]);
        let is_space =
            match bun_core::strings::decode_wtf8_rune_t::<u32>(bytes, len as u8, u32::MAX) {
                0x09 | 0x0A | 0x0B | 0x0C | 0x0D | 0x2028 | 0x2029 | 0xFEFF => true,
                rune => bun_core::strings::is_unicode_space_separator(rune),
            };
        if !is_space {
            break;
        }
        pos = at;
    }
    pos
}
fn is_hashbang(before: &[u8]) -> bool {
    before.starts_with(b"#!") && bun_core::strings::index_of_any(before, b"\r\n").is_none()
}
