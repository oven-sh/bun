# API of the parser unit

What other units call. Each section names the commit that it describes.

## Type nodes: `bun_ast::ts`

Commit `e1c99be1a4` on `robobun/abbc0c92/lint-parser`. File `src/ast/ts_nodes.rs`, which `src/ast/ts.rs` declares with
`#[path]` and re-exports: every name below is `bun_ast::ts::<name>`. `src/ast/lib.rs` and the existing AST types are
unchanged. Nothing builds these nodes yet: the `Build` sink does.

### Rules that hold for every node

- `start` and `end` are byte offsets in the source (`u32`). `start` is the offset of the first token of the node,
  `end` is the offset after its last token. They are the `getStart()` and the `end` of tsc. `Type::loc()`,
  `Type::range()` and `range(start, end)` give the `Loc` and the `Range` of a diagnostic.
- The `pos` of tsc (the end of the token before the node) is not stored. `full_start(source, comments, start)`
  computes it: it walks back from `start` over the white space of Bun's lexer and over `comments`, which must
  hold every comment of the file in source order. A file that starts with `#!` gives 0 for its first token.
- Every node type is `Copy`. A `Type` or a `Member` is a 20-byte handle: `start`, `end`, and a `TypeData` or
  `MemberData` that holds the kind and a `StoreRef` to the payload. Payloads and lists are in the
  `bun_alloc::Arena` that the caller passes, which is the arena of the lint parse. No node is put in the `Expr` or
  `Stmt` store. The fields of type `Expr`, `Binding` and `StoreSlice<Stmt>` hold what the expression, binding and
  statement parsers made.
- A payload of `TypeData` has no `start` and `end` of its own: they are on the `Type` that holds it. The same holds
  for a payload of `MemberData` and its `Member`.
- `List<T>` derefs to `[T]`. `start` is the end of the token that opens the list (`<`, `(`, `[`, `{`), or the start
  of the first token of the list when no token opens it (the types of a union, of an intersection and of a heritage
  clause, the spans of a template). `end` is the end of the last item or of the comma after it, and `start` when the
  list is empty. A trailing comma: `last.end < list.end`.
- The range of a `Member` takes the `;` or `,` after it.
- A `Name` holds the text without escapes. A private name keeps its `#` and `Name::is_private()` is true.

### `size_of` of each node

Every number has a `const` assertion in `src/ast/ts_nodes.rs`. Every node in the tables has alignment 4.

Handles, names, tokens and parts:

| `bun_ast::ts` | node of typescript-go `internal/ast` | `size_of` in bytes |
| --- | --- | ---: |
| `Type` | any type node: `start`, `end` and the kind | 20 (`Option<Type>` 20, align 4) |
| `TypeData` | the kind of a type and the pointer to its payload | 12 |
| `Member` | any type element: `start`, `end` and the kind | 20 |
| `MemberData` | the kind of a type element and the pointer to its payload | 12 |
| `List<T>` | `NodeList` | 20 (`Option<List<T>>` 20) |
| `Token` | `Token` (`DotDotDotToken`, `QuestionToken`, `ExclamationToken`, `PlusToken`, `MinusToken`, `ReadonlyKeyword`, `AssertsKeyword`) | 12 (`Option<Token>` 12) |
| `Name` | `Identifier`, `PrivateIdentifier` | 20 |
| `EntityName` | `EntityName` | 20 |
| `QualifiedName` | `QualifiedName` | 48 |
| `Literal` | `StringLiteral`, `NumericLiteral`, `BigIntLiteral`, `NoSubstitutionTemplateLiteral`, `KeywordExpression` (`null`, `true`, `false`) | 20 |
| `LiteralData` | the kind of a literal and its value | 12 |
| `PropertyName` | `PropertyName` | 24 |
| `ComputedPropertyName` | `ComputedPropertyName` | 24 |
| `Modifier` | a modifier keyword (`Token`) or a `Decorator` | 24 |
| `ModifierData` | the kind of a modifier | 16 |
| `TypeParameter` | `TypeParameterDeclaration` | 96 |
| `Parameter` | `ParameterDeclaration` | 96 |
| `HeritageClause` | `HeritageClause` | 32 |
| `TemplatePiece` | `TemplateHead`, `TemplateMiddle`, `TemplateTail` | 20 |
| `TemplateLiteralTypeSpan` | `TemplateLiteralTypeSpan` | 48 |
| `ImportAttributes` | `ImportAttributes` | 32 |
| `ImportAttribute` | `ImportAttribute` | 48 |
| `ImportAttributeName` | `ImportAttributeName` | 24 |
| `TypePredicateParameterName` | `TypePredicateParameterName` (`Identifier` or `ThisTypeNode`) | 20 |
| `Body` | `Block` of an accessor | 20 |

Payloads of `TypeData` (`KeywordTypeNode`, `ThisTypeNode` and `JSDocAllType` have no payload):

| `bun_ast::ts` | node of typescript-go `internal/ast` | `size_of` in bytes |
| --- | --- | ---: |
| `LiteralType` | `LiteralTypeNode` | 24 |
| `TypeReference` | `TypeReferenceNode` | 40 |
| `ExpressionWithTypeArguments` | `ExpressionWithTypeArguments` | 36 |
| `ArrayType` | `ArrayTypeNode` | 20 |
| `TupleType` | `TupleTypeNode` | 20 |
| `NamedTupleMember` | `NamedTupleMember` | 64 |
| `OptionalType` | `OptionalTypeNode` | 20 |
| `RestType` | `RestTypeNode` | 20 |
| `UnionType` | `UnionTypeNode` | 20 |
| `IntersectionType` | `IntersectionTypeNode` | 20 |
| `ConditionalType` | `ConditionalTypeNode` | 80 |
| `InferType` | `InferTypeNode` | 96 |
| `MappedType` | `MappedTypeNode` | 180 |
| `IndexedAccessType` | `IndexedAccessTypeNode` | 40 |
| `TypeOperator` | `TypeOperatorNode` | 24 |
| `TypeQuery` | `TypeQueryNode` | 40 |
| `FunctionType` | `FunctionTypeNode` | 60 |
| `ConstructorType` | `ConstructorTypeNode` | 72 |
| `TypeLiteral` | `TypeLiteralNode` | 20 |
| `TemplateLiteralType` | `TemplateLiteralTypeNode` | 40 |
| `ImportType` | `ImportTypeNode` | 76 |
| `ParenthesizedType` | `ParenthesizedTypeNode` | 20 |
| `TypePredicate` | `TypePredicateNode` | 52 |
| `JSDocNullableType` | `JSDocNullableType` | 20 |
| `JSDocNonNullableType` | `JSDocNonNullableType` | 20 |

Payloads of `MemberData`:

| `bun_ast::ts` | node of typescript-go `internal/ast` | `size_of` in bytes |
| --- | --- | ---: |
| `PropertySignature` | `PropertySignatureDeclaration` | 84 |
| `MethodSignature` | `MethodSignatureDeclaration` | 108 |
| `CallSignature` | `CallSignatureDeclaration` | 60 |
| `ConstructSignature` | `ConstructSignatureDeclaration` | 60 |
| `IndexSignature` | `IndexSignatureDeclaration` | 52 |
| `GetAccessor` | `GetAccessorDeclaration` | 116 |
| `SetAccessor` | `SetAccessorDeclaration` | 116 |

The kinds `KeywordKind`, `TokenKind`, `TypeOperatorKind`, `TemplatePieceKind`, `ImportAttributesToken`, `ModifierKind`
and `HeritageToken` are `#[repr(u8)]`: 1 byte.

### Types

```rust
/// A type. `start` is the offset of its first token, `end` the offset after its last token.
pub struct Type {
    pub start: u32,
    pub end: u32,
    pub data: TypeData,
}

/// The kind of a type, with its payload in the arena of the lint parse.
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

/// A list and its range.
pub struct List<T> {
    pub items: StoreSlice<T>,
    /// The end of the token that opens the list, or the start of its first token when none opens it.
    pub start: u32,
    /// The end of the last item or of the comma after it, or `start` when the list is empty.
    pub end: u32,
}

/// A token that TypeScript keeps as a node.
pub struct Token {
    pub start: u32,
    pub end: u32,
    pub kind: TokenKind,
}

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
pub struct Name {
    pub start: u32,
    pub end: u32,
    /// The name without escapes.
    pub text: StoreStr,
}

pub enum EntityName {
    Identifier(Name),
    QualifiedName(StoreRef<QualifiedName>),
}

pub struct QualifiedName {
    pub start: u32,
    pub end: u32,
    pub left: EntityName,
    pub right: Name,
}

/// A literal as a literal type, a property name or the name of an import attribute holds it.
pub struct Literal {
    pub start: u32,
    pub end: u32,
    pub data: LiteralData,
}

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

/// `negative` puts a `PrefixUnaryExpression` with the range of the type around `literal`.
pub struct LiteralType {
    pub literal: Literal,
    pub negative: bool,
}

pub struct TypeReference {
    pub type_name: EntityName,
    pub type_arguments: Option<List<Type>>,
}

pub struct ExpressionWithTypeArguments {
    pub expression: Expr,
    pub type_arguments: Option<List<Type>>,
}

pub struct ArrayType {
    pub element_type: Type,
}

pub struct TupleType {
    pub elements: List<Type>,
}

pub struct NamedTupleMember {
    pub dot_dot_dot_token: Option<Token>,
    pub name: Name,
    pub question_token: Option<Token>,
    pub type_node: Type,
}

/// `T?` as an element of a tuple.
pub struct OptionalType {
    pub type_node: Type,
}

/// `...T` as an element of a tuple.
pub struct RestType {
    pub type_node: Type,
}

/// `types` starts at the leading `|` when the source has one.
pub struct UnionType {
    pub types: List<Type>,
}

/// `types` starts at the leading `&` when the source has one.
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

pub struct IndexedAccessType {
    pub object_type: Type,
    pub index_type: Type,
}

pub enum TypeOperatorKind {
    KeyOf,
    Unique,
    Readonly,
}

pub struct TypeOperator {
    pub operator: TypeOperatorKind,
    pub type_node: Type,
}

pub struct TypeQuery {
    pub expr_name: EntityName,
    pub type_arguments: Option<List<Type>>,
}

pub struct FunctionType {
    pub type_parameters: Option<List<TypeParameter>>,
    pub parameters: List<Parameter>,
    pub type_node: Option<Type>,
}

pub struct ConstructorType {
    /// `abstract`, or nothing.
    pub modifiers: StoreSlice<Modifier>,
    pub type_parameters: Option<List<TypeParameter>>,
    pub parameters: List<Parameter>,
    pub type_node: Option<Type>,
}

pub struct TypeLiteral {
    pub members: List<Member>,
}

pub enum TemplatePieceKind {
    Head,
    Middle,
    Tail,
}

/// `TemplateHead`, `TemplateMiddle` or `TemplateTail`, from its `` ` `` or `}` to its `${` or `` ` ``.
pub struct TemplatePiece {
    pub start: u32,
    pub end: u32,
    pub kind: TemplatePieceKind,
    /// The text without escapes.
    pub text: StoreRef<E::EString>,
}

pub struct TemplateLiteralType {
    pub head: TemplatePiece,
    pub template_spans: List<TemplateLiteralTypeSpan>,
}

pub struct TemplateLiteralTypeSpan {
    pub start: u32,
    pub end: u32,
    pub type_node: Type,
    pub literal: TemplatePiece,
}

pub struct ImportType {
    pub is_type_of: bool,
    pub argument: Type,
    pub attributes: Option<StoreRef<ImportAttributes>>,
    pub qualifier: Option<EntityName>,
    pub type_arguments: Option<List<Type>>,
}

pub enum ImportAttributesToken {
    With,
    Assert,
}

pub struct ImportAttributes {
    pub start: u32,
    pub end: u32,
    pub token: ImportAttributesToken,
    pub attributes: List<ImportAttribute>,
    pub multi_line: bool,
}

pub struct ImportAttribute {
    pub start: u32,
    pub end: u32,
    pub name: ImportAttributeName,
    pub value: Expr,
}

pub enum ImportAttributeName {
    Identifier(Name),
    String(Literal),
}

pub struct ParenthesizedType {
    pub type_node: Type,
}

pub struct TypePredicate {
    pub asserts_modifier: Option<Token>,
    pub parameter_name: TypePredicateParameterName,
    pub type_node: Option<Type>,
}

pub enum TypePredicateParameterName {
    Identifier(Name),
    /// A `ThisTypeNode` with this range.
    This {
        start: u32,
        end: u32,
    },
}

pub struct JSDocNullableType {
    pub type_node: Type,
}

pub struct JSDocNonNullableType {
    pub type_node: Type,
}

/// A modifier keyword or a decorator, in the order of the source.
pub struct Modifier {
    pub start: u32,
    pub end: u32,
    pub data: ModifierData,
}

pub enum ModifierData {
    Keyword(ModifierKind),
    Decorator(Expr),
}

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

pub enum PropertyName {
    Identifier(Name),
    /// `String`, `Number` or `BigInt`.
    Literal(Literal),
    Computed(StoreRef<ComputedPropertyName>),
}

pub struct ComputedPropertyName {
    pub start: u32,
    pub end: u32,
    pub expression: Expr,
}

/// A member of a type literal, of a mapped type or of an interface. Its range takes the `;` or `,` after it.
pub struct Member {
    pub start: u32,
    pub end: u32,
    pub data: MemberData,
}

pub enum MemberData {
    PropertySignature(StoreRef<PropertySignature>),
    MethodSignature(StoreRef<MethodSignature>),
    CallSignature(StoreRef<CallSignature>),
    ConstructSignature(StoreRef<ConstructSignature>),
    IndexSignature(StoreRef<IndexSignature>),
    GetAccessor(StoreRef<GetAccessor>),
    SetAccessor(StoreRef<SetAccessor>),
}

pub struct PropertySignature {
    pub modifiers: StoreSlice<Modifier>,
    pub name: PropertyName,
    /// `Question`.
    pub postfix_token: Option<Token>,
    pub type_node: Option<Type>,
    /// The checker rejects it.
    pub initializer: Option<Expr>,
}

pub struct MethodSignature {
    pub modifiers: StoreSlice<Modifier>,
    pub name: PropertyName,
    /// `Question`.
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
    pub modifiers: StoreSlice<Modifier>,
    pub parameters: List<Parameter>,
    pub type_node: Option<Type>,
}

pub struct GetAccessor {
    pub modifiers: StoreSlice<Modifier>,
    pub name: PropertyName,
    pub type_parameters: Option<List<TypeParameter>>,
    pub parameters: List<Parameter>,
    pub type_node: Option<Type>,
    /// The checker rejects it.
    pub body: Option<Body>,
}

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
pub struct Body {
    pub start: u32,
    pub end: u32,
    pub stmts: StoreSlice<Stmt>,
}
```

### Functions

```rust
impl Type {
    pub const fn keyword(kind: KeywordKind, start: u32, end: u32) -> Type;
    pub const fn this(start: u32, end: u32) -> Type;
    pub const fn jsdoc_all(start: u32, end: u32) -> Type;
    /// Puts `payload` in `arena`.
    pub fn alloc<T: IntoTypeData>(arena: &Arena, payload: T, start: u32, end: u32) -> Type;
    pub const fn loc(&self) -> Loc;
    pub const fn range(&self) -> Range;
}
impl Member {
    /// Puts `payload` in `arena`.
    pub fn alloc<T: IntoMemberData>(arena: &Arena, payload: T, start: u32, end: u32) -> Member;
}
/// Implemented by the 25 payloads of `TypeData`.
pub trait IntoTypeData: Sized {
    fn type_data(payload: StoreRef<Self>) -> TypeData;
    fn into_type_data(self, arena: &Arena) -> TypeData;
}
/// Implemented by the 7 payloads of `MemberData`.
pub trait IntoMemberData: Sized {
    fn member_data(payload: StoreRef<Self>) -> MemberData;
    fn into_member_data(self, arena: &Arena) -> MemberData;
}
impl<T> List<T> {
    pub const fn empty(start: u32, end: u32) -> List<T>;
    /// Leaves `items` in the arena it grew in.
    pub fn from_bump(items: ArenaVec<'_, T>, start: u32, end: u32) -> List<T>;
    /// Copies `items` to `arena`.
    pub fn from_slice(arena: &Arena, items: &[T], start: u32, end: u32) -> List<T> where T: Copy;
}
impl Name {
    pub const fn new(text: &[u8], start: u32, end: u32) -> Name;
    pub fn is_private(&self) -> bool;
}
impl EntityName {
    /// `left.right`, with the `QualifiedName` in `arena`: its range is from the start of `left` to the end of `right`.
    pub fn qualified(arena: &Arena, left: EntityName, right: Name) -> EntityName;
    pub fn start(&self) -> u32;
    pub fn end(&self) -> u32;
}
impl LiteralData {
    pub const fn number(value: f64) -> LiteralData;
    pub fn bigint(arena: &Arena, digits: &[u8]) -> LiteralData;
    /// `NoSubstitutionTemplate` when `is_template`, else `String`.
    pub fn string(arena: &Arena, value: E::EString, is_template: bool) -> LiteralData;
    pub const fn kind_name(&self) -> &'static str;
}
impl PropertyName {
    pub fn computed(arena: &Arena, expression: Expr, start: u32, end: u32) -> PropertyName;
    pub fn start(&self) -> u32;
    pub fn end(&self) -> u32;
}
impl ImportAttributeName {
    pub const fn start(&self) -> u32;
    pub const fn end(&self) -> u32;
}
impl TypePredicateParameterName {
    pub const fn start(&self) -> u32;
    pub const fn end(&self) -> u32;
}
impl Modifier {
    pub const fn keyword(kind: ModifierKind, start: u32, end: u32) -> Modifier;
    pub const fn decorator(expression: Expr, start: u32, end: u32) -> Modifier;
}
impl TypeData { pub const fn kind_name(&self) -> &'static str; }
impl MemberData { pub const fn kind_name(&self) -> &'static str; }
impl KeywordKind { pub const fn kind_name(self) -> &'static str; }
impl TemplatePieceKind { pub const fn kind_name(self) -> &'static str; }
pub const fn range(start: u32, end: u32) -> Range;
pub fn full_start(source: &[u8], comments: &[Range], start: u32) -> u32;
```

`kind_name` gives the name of the member of `ts.SyntaxKind` (`"TypeReference"`, `"StringKeyword"`,
`"PropertySignature"`, `"TemplateHead"`). The reverse map `ts.SyntaxKind[kind]` of tsc 6.0.2 prints an alias for five
of them: `TypePredicate` is `FirstTypeNode`, `ImportType` is `LastTypeNode`, `NumericLiteral` is `FirstLiteralToken`,
`NoSubstitutionTemplateLiteral` is `FirstTemplateToken`, `TemplateTail` is `LastTemplateToken`.

### How the nodes differ from the reference

- A literal type has no expression node: `LiteralType.literal` is the literal and `negative` stands for the
  `PrefixUnaryExpression` with operator `-`, whose range is the range of the `Type`.
- `TypePredicate.parameter_name` holds the range of the `ThisTypeNode` and no node.
- A modifier list is a `StoreSlice<Modifier>` without a range of its own: it runs from the `start` of its first
  modifier to the `end` of its last.
- `TemplatePiece` keeps the text without escapes. The raw text is the source between `start + 1` and the `${` or
  the closing backtick.
- `Parameter.name` is a `bun_ast::Binding`, which has a `loc` and no end.
- `JSDocOptionalType` and `JSDocVariadicType` have no node: only the JSDoc parser of the reference builds them.
- There is no node for a missing type: the parser stops at its first error.

### State at that commit

The file was checked before the commit with rustc, clippy (the lint flags of the workspace and its `clippy.toml`),
rustfmt and Miri (Tree Borrows and Stacked Borrows), as a copy in a scratch crate: its crate root has the real
`StoreRef`, `StoreSlice` and `StoreStr` and stand-ins of the size of `Expr`, `Binding`, `Stmt`, `E::EString`,
`E::BigInt` and `E::Number`. It was not built in the worktree at that commit.

### Tests

`#[cfg(test)] mod tests` in `src/ast/ts_nodes.rs`, seven tests, run by `bun run rust:miri -p bun_ast`. A test binary
of `bun_ast` has no mimalloc, so a test cannot make an `Arena`: the tests keep their payloads in boxes and pick
the variant with `IntoTypeData::type_data` and `IntoMemberData::member_data`. A test in another crate that has no
arena can do the same.

## Syntax errors of a lint parse: the codes of the reference

Commits `a351e96b25`, `972712a9f9`, `4c3d6e977d`, `fe28d25308` and `e57ec63c80` on `robobun/abbc0c92/lint-parser`.
The first holds this change and a test file of another change: both were in the index when it was made. File `src/js_parser/parse/syntax_errors.rs`, module
`bun_js_parser::parse::syntax_errors`. Not built and not run in the worktree at these commits: the file was checked
alone with rustc, clippy (the lint levels of the workspace and its `clippy.toml`) and rustfmt against stand-ins of the
crates it uses, and its five tests that need no parser passed there.

`bun_ast::Msg` has no field for a code (`NEEDS.md`). Until it has one, the parser keeps the codes in a table of its
own and hands it out when a lint parse fails.

### Entry

```rust
impl<'a> Parser<'a> {
    /// `parse_for_lint`. Where the parse fails, `errors` gets what the reference reports for the messages that it logged.
    pub fn parse_for_lint_with_codes<R>(
        self,
        errors: &mut SyntaxErrors,
        f: impl FnOnce(&ParsedForLint<'_, 'a>) -> R,
    ) -> Result<R, Error>;
}
```

`Parser::parse_for_lint(f)` is `parse_for_lint_with_codes(&mut SyntaxErrors::default(), f)`. The parse is the same in
both. `errors` is left as it was when the parse succeeds.

```rust
/// The diagnostics of the reference for the messages that a lint parse left in the log.
#[derive(Default)]
pub struct SyntaxErrors { /* private */ }

impl SyntaxErrors {
    /// Every entry, by rising `msg`.
    pub fn entries(&self) -> &[SyntaxError];
    /// The entry of the message at index `msg` of the log.
    pub fn get(&self, msg: usize) -> Option<&SyntaxError>;
}

/// What the reference reports for one message that a lint parse left in the log.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct SyntaxError {
    /// The index of the message in `Log::msgs`.
    pub msg: u32,
    /// The number of the diagnostic: 1005 is TS1005.
    pub code: u32,
    /// The offset of the first byte that the diagnostic marks.
    pub start: u32,
    /// The offset after the last byte that it marks: `start` where it marks a position.
    pub end: u32,
    /// The text of the diagnostic, its argument filled in.
    pub text: Cow<'static, [u8]>,
}
```

How to use it: the log that `Parser::init` got holds the messages of Bun as before, with their text unchanged. For
the message at index `i` of `log.msgs`, `errors.get(i)` is the diagnostic of the reference, or `None` when the parser
knows none for it. `text` is the text of `diagnosticMessages.json` (`';' expected.`), `code` its number. `start` and
`end` are the range of the message of Bun, which is the token the lexer was on, with three exceptions that follow the
reference: TS1002 and TS1160 are at the offset where the line or the file ends, TS1385 to TS1388 run from the end of
the token before the type to the end of the type.

### No error recovery

The parser stops at its first error as today: error recovery is out of scope. A lint parse that fails returns `Err`
and no tree, no node stands for what is missing, and `f` is not called. The log can hold more than one message,
because some errors are logged and the parse goes on to the end of the statement or of the file before it fails: the
first message of the parse is the error, the others are what followed from it. The reference recovers and reports
more diagnostics for the same file: only its first one can be compared.

### What an entry means

An entry is the diagnostic that the reference has for the condition that Bun's parser found. Bun finds errors with
its own grammar: where the reference decides in another place or has a more specific diagnostic, its first diagnostic
for the same file is another one. The list "Known differences" below names the cases that are known.

| Condition in Bun's parser | Message of Bun | Entry |
| --- | --- | --- |
| a token that the grammar requires is missing (`Lexer::expect`, `expect_contextual_keyword`, `expect_or_insert_semicolon`, `expect_greater_than`) | `Expected "x" but found ...` | TS1005 `'x' expected.` |
| a name is missing and the lexer is on a reserved word | `Expected identifier but found "class"` | TS1359 `Identifier expected. 'class' is a reserved word that cannot be used here.` |
| a name is missing | `Expected identifier but found ...` | TS1003 `Identifier expected.` |
| a string has no closing quote | `Unterminated string literal` | TS1002 `Unterminated string literal.` |
| a template has no closing backtick | `Unterminated string literal` | TS1160 `Unterminated template literal.` |
| a comment has no `*/` | `Expected "*/" to terminate multi-line comment` | TS1010 `'*/' expected.` |
| the token starts no expression (the last arm of `parse_prefix`) | `Unexpected x` | TS1109 `Expression expected.` |
| the same at the first token of a statement of a block, of a function body or of the file, unless the token is a binary operator | `Unexpected x` | TS1128 `Declaration or statement expected.` |
| the same for `default` at the top of the file | `Unexpected default` | TS1005 `'export' expected.` |
| the same for `catch` and `finally` | `Unexpected catch` | TS1005 `'try' expected.` |
| the token starts no type (`parse_type_reference`) | `Unexpected x` | TS1110 `Type expected.` |
| a function or constructor type is an operand of `\|` or `&` (`Build` sink only) | the text of the entry | TS1385, TS1386, TS1387, TS1388 |
| the token starts no member of an object type (`Build` sink only) | `Unexpected x` | TS1131 `Property or signature expected.` |

The first six rows are read from the text of the message when the parse ends, because the lexer logs them and has
no way to the table. The others are recorded where they are logged. Every other message has no entry: the
`Syntax Error` of the lexer (numbers, escapes, regular expressions, characters), `Unexpected x` of the other call
sites of `Lexer::unexpected`, and every message that the parser logs itself.

### What a lint parse rejects that a parse without lint accepts

How the grammar knows that it is a lint parse: at run time `P::is_lint_parse()`, which is tested only on paths that
an error takes, and at compile time `TypeSink::STRICT`, which is true for `Build` alone. A parse without lint logs
and accepts what it did before this change.

- A type that is missing inside an attempt (`lexer_backtracker_bool`, `lexer_backtracker_result`,
  `is_type_script_arrow_return_type_after_question_and_before_colon`). The log of the lexer is off there, and the
  attempt went on as if the type stood. A lint parse logs `Unexpected x` past the lexer and records TS1110. If the
  attempt goes back, the message goes with it. If the attempt stays, the parse fails, as the reference fails when it
  keeps type arguments that it read with an error: `let x: (a: ) => void`, `f<A | >(x)`, `f<,>;`, `new A<B | >()`.
  This holds for every sink: inside an attempt `P::type_expected` answers false, so a sink whose `STRICT` is true
  goes on without a node where the grammar takes none (an element of a list of type arguments, an operand of `|`,
  `&`, `keyof` or `readonly`) and fails where a node is required (`build_type_with_opts`). Outside an attempt a
  sink whose `STRICT` is true fails at the token, as before.
- `typeHasArrowFunctionBlockingParseError`: inside an attempt, a return type that is missing before `=>` ends the
  attempt, so `(a): => a` is no arrow function and the `:` is the error (TS1005 at the `:`).
- `parseFunctionOrConstructorTypeToError`, with a sink whose `STRICT` is true: `A | () => void`, `| new () => A`,
  `A & <T>() => T`, `A | abstract new () => B` log the text of TS1385 to TS1388 and the parse goes on, as the
  reference goes on. `P::function_or_constructor_type_to_error` reads the node through the new hook
  `TypeSink::b_built(out) -> Option<ts::Type>`, which is `None` for the two other sinks.
- With a sink whose `STRICT` is true, `|` or `&` where `parseTypeOperatorOrHigher` reads a type is TS1110:
  `A & | B`, `| | A`, `& | A`, `keyof | A`. The two other sinks take any run of these operators as before.
- `isListElement` of `PCTypeMembers`, in `build_type_member_list` (type literals and what follows the mapping of
  a mapped type): `P::is_start_of_type_member` is `lookAhead(scanTypeMemberStart)`. A token that starts no member
  is TS1131 at that token, so `{ a A }` fails at `a` as in the reference, and not at `A`.

What a lint parse accepts that a parse without lint rejects: `isListTerminator` of `PCTypeArguments`. An element of a
list of type arguments is read with the new option `SkipTypeOptions::IsTypeArgument`. In a lint parse a token that
starts no type and is no `,` ends the list without an error where an element starts (after `<` or `,`), so `let x: A<>;`
parses as it does in the reference (the checker reports TS1099), `f<>()` and `f<A,>(x)` stay accepted, and
`let x: A<;` is TS1005 `'>' expected.` and not `Unexpected ;`.

typescript-go and tsc 6.0.2 disagree on `typeof x.#y`: typescript-go parses it (`parseTypeQuery` calls
`parseEntityName` with `allowPrivateName`), tsc reports TS1003 at the offset after the private name. A lint parse
follows typescript-go and accepts it, as every parse does today.

### How the table follows the log

The parser drops and restores messages of the log while it backtracks (`restore_parser_snapshot`, the lexer
backtrackers, `set_aside_failed_read`, `build_in_type`). A record holds the index of its message and the address
and the length of the text of the message. When the parse ends, a record counts only if the message at its index
still has that text, and the last such record of a message wins. So no backtracking site has to know the table.
A site that logs past the lexer inside an attempt must be one whose attempt truncates the log when it goes back:
`lexer_backtracker_kept` does not.

### Known differences from the first diagnostic of the reference

- In a list the reference asks for `,` where Bun asks for the token that closes the list or for `;`: the code is
  TS1005 in both, the argument differs (`let f = (a): => a` is `',' expected.` in the reference, `';' expected.` here).
- Where a statement that is one name is followed by a token on the same line, the reference reports TS1434, TS1435,
  TS1440, TS1228 or a name diagnostic for the name (`parseErrorForMissingSemicolonAfter`). Here it is TS1005
  `';' expected.` at the token.
- After a property of a class the reference reports TS1442, TS1441 or TS1436 (`parseSemicolonAfterPropertyName`),
  and for a function without a body TS1144. Here it is TS1005.
- The reference reports a token that starts no element of a list with the diagnostic of the list
  (`parsingContextErrors`: TS1135, TS1137, TS1136, TS1138, TS1139, TS1131, TS1132, TS1134, TS1180, TS1181) or, where
  the token ends the list, with TS1005 for the closing token (`f(` is `')' expected.`). Here an expression that is
  missing is TS1109 and a type that is missing is TS1110.
- A statement of a `case` clause that starts with a token that starts none is TS1129 in the reference, TS1128 here.
- TS1130 (`'case' or 'default' expected.`) and TS1472 (`'catch' or 'finally' expected.`) are TS1005 with one token here.
- At the end of the file the reference puts TS1003 at the end of the last token. Here it is at the end of the file.
- The codes of the scanner for numbers, escapes and characters (TS1121, TS1124, TS1125, TS1127, TS1198, TS1199,
  TS1351, TS1489, TS6188, TS6189) and TS1161 have no entry.

### Not done

- The checks of the reference that sit on a path that a valid program takes and are outside the type grammar:
  TS1477 (`a<b>.c`), TS17007 and TS17006 (`<A>x ** 2`), TS1209, TS18030, TS2754, TS1034, TS2880, TS1357, TS1260,
  TS1011, the list diagnostics above. A lint parse accepts these inputs as before, or rejects them without an entry.
- The members of classes, parameters and heritage clauses are strict only as far as the `Build` sink reads them.
  Their messages have the entries of the table above and no other.
- The checks that need the `Build` sink are tested through `x as T` only.
- An error in the first token of a file fails `Parser::init`, before the table exists: its message has no entry.

### Probe

`probes/diag-codes/`: `run.sh` prints, for each source of `inputs.txt`, the parse diagnostics of typescript-go
(`/tmp/rr/parsediag`), of tsc 6.0.2 and the errors of the `bun` on PATH. `expected.txt` is its output with
`bun` 1.4.3-canary.1+367d939d9, the binary that has none of this change.

### Tests

`mod tests` in `src/js_parser/parse/syntax_errors.rs`, nine tests. Five need no parser (the texts, the reading of
`Expected a but found b`, the end of a string without a closing quote, a record whose message the log drops, a
record whose message is set aside and put back). Three run `Parser::parse_for_lint_with_codes`: 19 sources with
the code, range and text of their first error, 5 sources that only a lint parse rejects, 6 sources that the
reference parses and a lint parse must take. A fourth reads types with the `Build` sink through `x as T`: 7 sources for
TS1385, TS1388, TS1110, TS1131 and TS1005, and 4 that parse. The code and the range of each are the first diagnostic of
typescript-go 89d5d5b, which is also the one of tsc 6.0.2. Two sources differ from that on purpose: for
`let f = (a): => a` the text is `';' expected.` (the reference: `',' expected.`), and
`class C { #y = 1; m(x: C) { let a: typeof x.#y; } }` parses as in typescript-go (tsc: TS1003). The four tests
that run the parser were not run.

## How the tests of the parser run

Commit `2b2d8c0e89` on `robobun/abbc0c92/lint-parser`. Files `src/js_parser/native_test_shims.rs` and
`src/js_parser/type_sink_tests.rs`, both under `#[cfg(test)]` in `src/js_parser/lib.rs`: no build of bun holds them
and nothing in them is for another unit to call. This section is for whoever runs or adds a test of the parser.

### Commands

In the worktree, after one `bun bd --version` (cargo needs `build/debug/codegen` and `vendor/` to resolve the
workspace):

| what runs | command |
| --- | --- |
| every test of the crate | `cargo test -p bun_js_parser --lib` |
| P2 alone, the type nodes (no parser) | `bun run rust:miri -p bun_ast` |
| P2 alone, the `Build` sink on types read alone | `cargo test -p bun_js_parser --lib type_sink_tests` |
| P3 alone: the entry, the side table, the codes, the backtracking points | `cargo test -p bun_js_parser --lib parse::` |
| the stand-ins | `cargo test -p bun_js_parser --lib native_test_shims` |

The tests of P3 are the `mod tests` of the files under `src/js_parser/parse/` and the files `*_tests.rs` there: each
name starts with `parse::`. No JavaScript test reaches a lint parse in this worktree and no job of CI runs these
tests: `NEEDS.md`, N3 and N4.

### Why the test binary needs stand-ins

A test binary of `bun_js_parser` links none of the C and C++ objects of bun. With one test that parses, the linker
reported 46 undefined symbols at `e3566be889` (`measure/base/cargo-test-undefined-symbols.txt`). A binary without
such a test links, because nothing in it reaches them. Miri is no way around the linker: a parse reads the stack
pointer with inline assembly (`bun_core::StackCheck`), which Miri does not run. `src/parsers` has a file of the
same name for its own tests.

`native_test_shims.rs` defines 57 symbols in Rust, each `#[unsafe(no_mangle)]`: the 46, and the others of the two
families that a change of the parser reaches first (the scans of `bun_highway`, the entry points of mimalloc).

| symbols | what the stand-in does |
| --- | --- |
| `Bun__StackCheck__getMaxStack` | a bound 1 MiB below the first call of the thread, and the same bound at every later call |
| `WTF__parseDouble` | the longest decimal prefix as fast_float reads it, parsed by `str::parse::<f64>` |
| 17 scans `highway_*` of bytes and substrings | scalar loops with the predicate of each kernel of `highway_strings.cpp` |
| 6 of `simdutf__*` | `validate_ascii`, `validate_utf8`, the two UTF-8 lengths of UTF-16, UTF-16 to UTF-8 with errors, base64 encode |
| 24 of `mi_*` | blocks of the allocator of the test binary, kept in a table by address: a heap is a number, and `mi_heap_destroy` frees the blocks of its heap |
| `__bun_macro_context_get_remap` | no path is one of a macro |
| `bun_cpu_features`, `getRSS`, `getPeakRSS`, `compress2`, `is_executable_file`, `bun_restore_stdio`, `on_before_reload_process_posix`, `mi_process_info` | what the crash reporter and a reload of the process link to: they report nothing, or fail |

What does not link: the visit pass. At the base a test of another crate that ran `Parser::parse` on TypeScript
needed twelve more symbols, of JavaScriptCore among them (`WTF__dtoa`, `JSC__jsToNumber`,
`Bun__JSC__operationMathPow`). A test stays on `Parser::init`, `P::init`, `Parser::parse_only`,
`Parser::parse_for_lint` and what the parse pass calls. Where a later change makes the linker report a symbol, its
stand-in goes into that file.

### Reading one type alone (P2)

`type_sink_tests.rs` makes a `P<'_, true, false>` the way `Parser::parse_only` makes its parser, with no side
table, and calls the entries of the sink that are `pub` on `P`: `build_type_script_type`,
`build_typescript_return_type` and `build_type_script_type_parameters`. Nothing of P3 is in it. Five tests: 26
types with the kind and the range of every type node inside them, 6 lists that a `>` inside `>>`, `>>>`, `>=`,
`>>=` or `>>>=` closes (the range of each list, the end of each node, the token and the offset after the type), 6
return types (predicates and `asserts`), 5 type parameter lists, 2 texts that start no type. Every expectation is
what tsc 6.0.2 builds for `type T = <text>;`, `let x: <text>;`, `function f(x: any): <text> {}` and
`function f<text>() {}`: `getStart()` and `end` of each node, `pos` and `end` of each list.

### State at that commit

No test binary of the crate was built at that commit, and no test of `type_sink_tests.rs` or of P3 was run. What
was checked, with the scripts of `probes/test-seam/`, which write nothing in the worktree:

- `native_test_shims.rs` was compiled alone with rustc, clippy (the lint levels of the workspace and its
  `clippy.toml`) and rustfmt, against stand-ins of `bun_core::Mutex` and `bun_alloc::mimalloc`. Its 7 tests passed
  there.
- `relink-base.py`: the object of that file was linked with the objects and the libraries that the base
  measurement left of the test binary of `e3566be889` (one test that runs `Parser::init` and
  `Parser::parse_only`). No undefined symbol, and that test passed on the stand-ins.
- `typecheck.py`: `bun_js_parser` at `e200dc91ce`, one commit later, with every test module and `--cfg test`, was
  type-checked against the dependency metadata of the debug build (`rustc --emit=metadata` with the arguments that
  the build recorded, `--deny=warnings` without `dead_code`, on a copy where the `#[test]` lines are removed:
  the debug build has its own `std`, which the test harness does not take). Exit 0.
- `outline.mjs` and `rows.mjs` print the expectations of `type_sink_tests.rs` from tsc 6.0.2
  (`rows.expected.txt`). No build has compared the `Build` sink with them.
- Which symbols the test binary of this commit needs was not measured. The tests of P3 call
  `Parser::parse_for_lint` with the TypeScript parser, which the measured test did not. By reading, the parse pass
  of TypeScript calls nothing outside the 46: the twelve more of a full parse come from `Parser::parse` and from
  the visit pass.
