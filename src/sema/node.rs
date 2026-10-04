//! `*ast.Node`: one handle for every node of a file, whichever vector it is stored in, or none.
//!
//! HIR nodes. The vectors of [`File`] that hold nodes are concatenated into one index space, so a
//! handle is the base of a vector plus an index: a typed id converts to a handle, and a handle to a
//! typed id, by arithmetic. A tsgo node that is split over two HIR nodes (`ExprKind::Fn` and its
//! `Func`, `StmtKind::Class` and its `Class`, a method and the function that is its value) has one
//! handle, that of the HIR node that corresponds to tsgo's node: the statement, the member, the
//! property, the type node, else the expression.
//!
//! Parts. A tsgo node that carries no information beyond that of a HIR node has no HIR node of its
//! own: its handle is the handle of that HIR node and, in the top bits, which [`Part`] of it. So
//! `parent` ascends level by level as `node.Parent` does, and the levels take no memory.
//!
//! HIR nodes that are not tsgo nodes: the statement that wraps the contents of the head of a `for`,
//! the `Pat` of an omitted element, the `TupleElem` of a plain element, the `Assign` of `{ a = 1
//! }`, the placeholders for the specifier of `import()` and for the empty `{}` of JSX. The heritage
//! elements a class extends after the first have no `ExpressionWithTypeArguments` around them. An
//! import or export whose specifier is not a string is an `EmptyStatement`, a `WithStatement` is a
//! `Block` of two statements.
//! tsgo nodes that are not represented yet, so `parent` skips them: `ParenthesizedType`, tokens.

use crate::atom::{Atom, known};
use crate::bind::{Decl, Parent};
use crate::check::spans::{
    jsx_identifier_end, skip_trivia, skip_trivia_back, start_of_token_before,
};
use crate::hir::*;
use std::cell::{Cell, RefCell};
use std::ops::ControlFlow;

macro_rules! kinds {
    ($($name:ident)*) => {
        /// `ast.Kind`
        #[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
        #[repr(u16)]
        pub enum Kind { $($name),* }
    };
}
kinds! {
    Unknown EndOfFile SingleLineCommentTrivia MultiLineCommentTrivia NewLineTrivia WhitespaceTrivia ConflictMarkerTrivia
    NonTextFileMarkerTrivia NumericLiteral BigIntLiteral StringLiteral JsxText JsxTextAllWhiteSpaces RegularExpressionLiteral
    NoSubstitutionTemplateLiteral TemplateHead TemplateMiddle TemplateTail OpenBraceToken CloseBraceToken OpenParenToken
    CloseParenToken OpenBracketToken CloseBracketToken DotToken DotDotDotToken SemicolonToken CommaToken QuestionDotToken
    LessThanToken LessThanSlashToken GreaterThanToken LessThanEqualsToken GreaterThanEqualsToken EqualsEqualsToken
    ExclamationEqualsToken EqualsEqualsEqualsToken ExclamationEqualsEqualsToken EqualsGreaterThanToken PlusToken MinusToken
    AsteriskToken AsteriskAsteriskToken SlashToken PercentToken PlusPlusToken MinusMinusToken LessThanLessThanToken
    GreaterThanGreaterThanToken GreaterThanGreaterThanGreaterThanToken AmpersandToken BarToken CaretToken ExclamationToken
    TildeToken AmpersandAmpersandToken BarBarToken QuestionToken ColonToken AtToken QuestionQuestionToken BacktickToken HashToken
    EqualsToken PlusEqualsToken MinusEqualsToken AsteriskEqualsToken AsteriskAsteriskEqualsToken SlashEqualsToken
    PercentEqualsToken LessThanLessThanEqualsToken GreaterThanGreaterThanEqualsToken GreaterThanGreaterThanGreaterThanEqualsToken
    AmpersandEqualsToken BarEqualsToken BarBarEqualsToken AmpersandAmpersandEqualsToken QuestionQuestionEqualsToken
    CaretEqualsToken Identifier PrivateIdentifier JSDocCommentTextToken BreakKeyword CaseKeyword CatchKeyword ClassKeyword
    ConstKeyword ContinueKeyword DebuggerKeyword DefaultKeyword DeleteKeyword DoKeyword ElseKeyword EnumKeyword ExportKeyword
    ExtendsKeyword FalseKeyword FinallyKeyword ForKeyword FunctionKeyword IfKeyword ImportKeyword InKeyword InstanceOfKeyword
    NewKeyword NullKeyword ReturnKeyword SuperKeyword SwitchKeyword ThisKeyword ThrowKeyword TrueKeyword TryKeyword TypeOfKeyword
    VarKeyword VoidKeyword WhileKeyword WithKeyword ImplementsKeyword InterfaceKeyword LetKeyword PackageKeyword PrivateKeyword
    ProtectedKeyword PublicKeyword StaticKeyword YieldKeyword AbstractKeyword AccessorKeyword AsKeyword AssertsKeyword
    AssertKeyword AnyKeyword AsyncKeyword AwaitKeyword BooleanKeyword ConstructorKeyword DeclareKeyword GetKeyword ImmediateKeyword
    InferKeyword IntrinsicKeyword IsKeyword KeyOfKeyword ModuleKeyword NamespaceKeyword NeverKeyword OutKeyword ReadonlyKeyword
    RequireKeyword NumberKeyword ObjectKeyword SatisfiesKeyword SetKeyword StringKeyword SymbolKeyword TypeKeyword UndefinedKeyword
    UniqueKeyword UnknownKeyword UsingKeyword FromKeyword GlobalKeyword BigIntKeyword OverrideKeyword OfKeyword DeferKeyword
    QualifiedName ComputedPropertyName TypeParameter Parameter Decorator PropertySignature PropertyDeclaration MethodSignature
    MethodDeclaration ClassStaticBlockDeclaration Constructor GetAccessor SetAccessor CallSignature ConstructSignature
    IndexSignature TypePredicate TypeReference FunctionType ConstructorType TypeQuery TypeLiteral ArrayType TupleType OptionalType
    RestType UnionType IntersectionType ConditionalType InferType ParenthesizedType ThisType TypeOperator IndexedAccessType
    MappedType LiteralType NamedTupleMember TemplateLiteralType TemplateLiteralTypeSpan ImportType ObjectBindingPattern
    ArrayBindingPattern BindingElement ArrayLiteralExpression ObjectLiteralExpression PropertyAccessExpression
    ElementAccessExpression CallExpression NewExpression TaggedTemplateExpression TypeAssertionExpression ParenthesizedExpression
    FunctionExpression ArrowFunction DeleteExpression TypeOfExpression VoidExpression AwaitExpression PrefixUnaryExpression
    PostfixUnaryExpression BinaryExpression ConditionalExpression TemplateExpression YieldExpression SpreadElement ClassExpression
    OmittedExpression ExpressionWithTypeArguments AsExpression NonNullExpression MetaProperty SyntheticExpression
    SatisfiesExpression TemplateSpan SemicolonClassElement Block EmptyStatement VariableStatement ExpressionStatement IfStatement
    DoStatement WhileStatement ForStatement ForInStatement ForOfStatement ContinueStatement BreakStatement ReturnStatement
    WithStatement SwitchStatement LabeledStatement ThrowStatement TryStatement DebuggerStatement VariableDeclaration
    VariableDeclarationList FunctionDeclaration ClassDeclaration InterfaceDeclaration TypeAliasDeclaration EnumDeclaration
    ModuleDeclaration ModuleBlock CaseBlock NamespaceExportDeclaration ImportEqualsDeclaration ImportDeclaration ImportClause
    NamespaceImport NamedImports ImportSpecifier ExportAssignment ExportDeclaration NamedExports NamespaceExport ExportSpecifier
    MissingDeclaration ExternalModuleReference JsxElement JsxSelfClosingElement JsxOpeningElement JsxClosingElement JsxFragment
    JsxOpeningFragment JsxClosingFragment JsxAttribute JsxAttributes JsxSpreadAttribute JsxExpression JsxNamespacedName CaseClause
    DefaultClause HeritageClause CatchClause ImportAttributes ImportAttribute PropertyAssignment ShorthandPropertyAssignment
    SpreadAssignment EnumMember SourceFile JSDocTypeExpression JSDocNameReference JSDocAllType JSDocNullableType
    JSDocNonNullableType JSDocOptionalType JSDocVariadicType JSDoc JSDocText JSDocTypeLiteral JSDocSignature JSDocLink
    JSDocLinkCode JSDocLinkPlain JSDocUnknownTag JSDocAugmentsTag JSDocImplementsTag JSDocDeprecatedTag JSDocPublicTag
    JSDocPrivateTag JSDocProtectedTag JSDocReadonlyTag JSDocOverrideTag JSDocCallbackTag JSDocOverloadTag JSDocParameterTag
    JSDocReturnTag JSDocThisTag JSDocTypeTag JSDocTemplateTag JSDocTypedefTag JSDocSeeTag JSDocPropertyTag JSDocThrowsTag
    JSDocSatisfiesTag JSDocImportTag SyntaxList JSTypeAliasDeclaration JSImportDeclaration NotEmittedStatement
    PartiallyEmittedExpression SyntheticReferenceExpression NotEmittedTypeElement
}

impl Kind {
    /// `IsFunctionLikeDeclaration`
    pub fn is_function_like_declaration(self) -> bool {
        use Kind::*;
        matches!(
            self,
            FunctionDeclaration
                | MethodDeclaration
                | Constructor
                | GetAccessor
                | SetAccessor
                | FunctionExpression
                | ArrowFunction
        )
    }

    /// `IsFunctionLikeKind`
    /// `IsIterationStatement(node, false)`
    pub fn is_iteration_statement(self) -> bool {
        use Kind::*;
        matches!(
            self,
            ForStatement | ForInStatement | ForOfStatement | DoStatement | WhileStatement
        )
    }

    pub fn is_function_like(self) -> bool {
        use Kind::*;
        self.is_function_like_declaration()
            || matches!(
                self,
                MethodSignature
                    | CallSignature
                    | JSDocSignature
                    | ConstructSignature
                    | IndexSignature
                    | FunctionType
                    | ConstructorType
            )
    }

    /// `IsDeclarationNode`: the kinds whose nodes have a `DeclarationBase`.
    #[rustfmt::skip]
    pub fn is_declaration(self) -> bool {
        use Kind::*;
        self.is_function_like() || self.is_class_like() || matches!(self,
            VariableDeclaration | Parameter | BindingElement | MissingDeclaration | InterfaceDeclaration
            | TypeAliasDeclaration | JSTypeAliasDeclaration | EnumDeclaration | ImportDeclaration
            | JSImportDeclaration | NamespaceImport | ExportAssignment | NamespaceExportDeclaration
            | NamespaceExport | ExportSpecifier | SemicolonClassElement | ClassStaticBlockDeclaration
            | NoSubstitutionTemplateLiteral | BinaryExpression | CallExpression | ObjectLiteralExpression
            | SpreadAssignment | MappedType | TypeLiteral | NamedTupleMember | JsxAttributes | JsxAttribute
            | ModuleDeclaration | ImportEqualsDeclaration | ExportDeclaration | ImportClause
            | ImportSpecifier | TypeParameter | JSDocTypeLiteral | SourceFile | EnumMember
            | PropertySignature | PropertyDeclaration | PropertyAssignment | ShorthandPropertyAssignment)
    }

    /// `IsClassLike`
    pub fn is_class_like(self) -> bool {
        matches!(self, Kind::ClassDeclaration | Kind::ClassExpression)
    }
}

/// `*ast.Node`, of one file.
#[derive(Copy, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Debug)]
pub struct Node(pub u32);

/// The number of bits of a handle that select the HIR node. The remaining bits select the part of
/// it.
const ROW_BITS: u32 = 26;

macro_rules! parts {
    ($($(#[$doc:meta])* $name:ident = $bits:literal,)*) => {
        /// A node that is derived from the HIR node it belongs to.
        #[derive(Copy, Clone, PartialEq, Eq, Debug)]
        #[repr(u8)]
        pub enum Part { $($(#[$doc])* $name = $bits,)* }

        impl Node {
            /// `None`: it is a HIR node.
            #[inline]
            pub fn part(self) -> Option<Part> {
                match self.0 >> ROW_BITS {
                    $($bits => Some(Part::$name),)*
                    _ => None,
                }
            }
        }
    };
}
parts! {
    /// `node.Name()` for a node whose name is not a pattern. For an `ImportDeclaration`: the name
    /// of its `ImportClause`.
    Name = 1,
    /// `node.PropertyName()`
    PropertyName = 2,
    /// `node.Label()`
    Label = 3,
    /// The `Block` of a function-like, the `ModuleBlock`, the `CaseBlock`.
    Body = 4,
    CatchClause = 5,
    /// The `HeritageClause` with the `extends` keyword.
    Extends = 6,
    /// The `HeritageClause` with the `implements` keyword.
    Implements = 7,
    /// The `ExpressionWithTypeArguments` a class extends: `GetExtendsHeritageClauseElement`.
    Base = 8,
    /// The `VariableDeclarationList`. In the head of a `for` the statement it belongs to is not a
    /// tsgo node.
    DeclarationList = 9,
    ImportClause = 10,
    /// `NamespaceImport`, `NamedImports`
    NamedBindings = 11,
    /// `NamespaceExport`, `NamedExports`
    ExportClause = 12,
    /// The name of a `NamespaceImport` or a `NamespaceExport`.
    BindingsName = 13,
    /// `ExternalModuleReference`
    ModuleReference = 14,
    /// `JsxOpeningElement`, `JsxOpeningFragment`
    Opening = 15,
    /// `JsxClosingElement`, `JsxClosingFragment`
    Closing = 16,
    /// `JsxAttributes`
    Attributes = 17,
    /// The `TemplateSpan` around a substitution. It belongs to the HIR node of the expression.
    Span = 18,
    /// The literal in the brackets of `["a"]` and `[0]`.
    NameLiteral = 19,
    /// `Namespace` of a `JsxNamespacedName`. It belongs to the HIR node of the tag name, or of the
    /// attribute.
    Namespace = 20,
    /// The `QualifiedName` that ends with a name, a `PropertyAccessExpression` in a heritage
    /// clause. It belongs to the HIR node of that name.
    Qualified = 21,
    /// The literal of a `LiteralType`; the `SymbolKeyword` of `unique symbol`.
    Literal = 22,
    /// The numeric literal in the `-1` of a `LiteralType`.
    Operand = 23,
    /// `TemplateHead`
    Head = 24,
    /// `TemplateMiddle`, `TemplateTail`. It belongs to the HIR node of the preceding substitution.
    Tail = 25,
    /// The `TypeReference` for `const` in `x as const` and `<const>x`.
    ConstType = 26,
    /// The `JsxExpression` around an expression. It belongs to the HIR node of the expression.
    JsxExpression = 27,
    /// `node.ModuleSpecifier()` that is a string.
    Specifier = 28,
    /// The `ImportKeyword` that is called in `import("m")`; the `AssertsKeyword` of a type predicate; the `AwaitKeyword` of `for await`.
    Keyword = 29,
    /// `Name()` of a `JsxNamespacedName`.
    LocalName = 30,
}

impl Node {
    pub const NONE: Node = Node(u32::MAX);
    /// The `SourceFile`.
    pub const FILE: Node = Node(0);
    #[inline]
    pub fn is_none(self) -> bool {
        self.0 == u32::MAX
    }
    #[inline]
    pub fn is_some(self) -> bool {
        self.0 != u32::MAX
    }
    /// The HIR node that it is, or is a part of.
    #[inline]
    pub fn row(self) -> Node {
        Node(self.0 & ((1 << ROW_BITS) - 1))
    }
    /// That part of the HIR node.
    #[inline]
    pub fn with(self, part: Part) -> Node {
        if self.is_none() {
            return Node::NONE;
        }
        Node(self.row().0 | (part as u32) << ROW_BITS)
    }
    #[inline]
    fn idx(self) -> usize {
        self.0 as usize
    }
}

macro_rules! node_vectors {
    ($($index:literal $field:ident $id:ident $variant:ident;)*) => {
        /// What a [`Node`] refers to.
        #[derive(Copy, Clone, PartialEq, Eq, Debug)]
        pub enum NodeData {
            /// `nil`
            None,
            File,
            $($variant($id),)*
            /// That part of that HIR node.
            Part(Part, Node),
        }

        /// The number of vectors that hold nodes.
        const VECTORS: usize = [$($index),*].len();

        /// The first handle of the HIR nodes of each vector, and the end of the last vector.
        #[derive(Copy, Clone, Default)]
        pub struct NodeBases([u32; VECTORS + 1]);

        impl File {
            fn node_bases(&self) -> NodeBases {
                let mut bases = [1u32; VECTORS + 1];
                $(bases[$index + 1] = bases[$index] + self.$field.len() as u32;)*
                assert!(bases[VECTORS] < 1 << ROW_BITS);
                NodeBases(bases)
            }

            #[inline]
            pub fn data(&self, node: Node) -> NodeData {
                let bases = &self.bases.0;
                // Most queried nodes are expressions or statements.
                if node.0.wrapping_sub(bases[0]) < bases[1] - bases[0] {
                    return NodeData::Expr(ExprId(node.0 - bases[0]));
                }
                if node.0.wrapping_sub(bases[1]) < bases[2] - bases[1] {
                    return NodeData::Stmt(StmtId(node.0 - bases[1]));
                }
                self.data_of_the_rest(node)
            }

            /// Passes the children of every HIR node to `v`, vector by vector, so that each loop is
            /// specialized to the match arm of its own kind.
            /// `at_hand`: the node whose children they are. `open`: where `v` collects the parts
            /// that have children.
            fn children_of_all_rows<V: FnMut(Node) -> bool>(
                &self,
                v: &mut Children<'_, V>,
                at_hand: &Cell<Node>,
                open: &RefCell<Vec<Node>>,
            ) {
                let bases = &self.bases.0;
                $(for i in 0..self.$field.len() as u32 {
                    let (data, node) = (NodeData::$variant($id(i)), Node(bases[$index] + i));
                    if self.may_have_rows_under_it(data, node) {
                        at_hand.set(node);
                        v.children(data, node);
                        v.children_of_parts(at_hand, open);
                    }
                })*
                at_hand.set(Node::FILE);
                v.children(NodeData::File, Node::FILE);
                v.children_of_parts(at_hand, open);
            }

            fn data_of_the_rest(&self, node: Node) -> NodeData {
                let bases = &self.bases.0;
                if node == Node::FILE {
                    return NodeData::File;
                }
                if let Some(part) = node.part() {
                    return NodeData::Part(part, node.row());
                }
                let vector = bases.partition_point(|&base| base <= node.0) - 1;
                let index = node.0 - bases[vector];
                match vector {
                    $($index => NodeData::$variant($id(index)),)*
                    _ => NodeData::None,
                }
            }
        }

        $(impl Row for $id {
            #[inline]
            fn row(self, file: &File) -> Node {
                if self.is_none() { Node::NONE } else { Node(file.bases.0[$index] + self.0) }
            }
        })*
    };
}

/// The handle of the HIR node itself, which not every HIR node uses as its node handle.
trait Row: Copy {
    fn row(self, file: &File) -> Node;
}

node_vectors! {
    0 exprs ExprId Expr;
    1 stmts StmtId Stmt;
    2 types TypeNodeId Type;
    3 pats PatId Pat;
    4 pat_props PatPropId PatProp;
    5 pat_elems PatElemId PatElem;
    6 params ParamId Param;
    7 type_params TypeParamId TypeParam;
    8 members MemberId Member;
    9 props PropId Prop;
    10 var_decls VarDeclId VarDecl;
    11 cases CaseId Case;
    12 enum_members EnumMemberId EnumMember;
    13 import_specs ImportSpecId ImportSpec;
    14 export_specs ExportSpecId ExportSpec;
    15 tuple_elems TupleElemId TupleElem;
    16 modifiers ModifierId Modifier;
    17 names NameId Name;
    18 parens ParenId Paren;
}

/// `node.Parent` for every node of a file.
pub struct Parents {
    /// Indexed by HIR node: one load.
    rows: Box<[Node]>,
    /// The parents of the `TemplateSpan` and the `JsxExpression` around an expression and of the
    /// `QualifiedName` that ends with a name, which are themselves the entry in `rows` for that
    /// expression or name. Sorted.
    around: Box<[(Node, Node)]>,
}

/// A typed id that is, or belongs to, a node.
pub trait ToNode: Copy {
    fn to_node(self, file: &File) -> Node;
    /// The node that represents it in its parent: an expression including its enclosing
    /// parentheses.
    #[inline]
    fn to_child(self, file: &File) -> Node {
        self.to_node(file)
    }
}

macro_rules! rows_are_nodes {
    ($($id:ident)*) => {
        $(impl ToNode for $id {
            #[inline]
            fn to_node(self, file: &File) -> Node {
                self.row(file)
            }
        })*
    };
}
rows_are_nodes! {
    StmtId TypeNodeId PatId PatPropId PatElemId ParamId TypeParamId MemberId PropId VarDeclId CaseId EnumMemberId ImportSpecId
    ExportSpecId ModifierId NameId
}

impl ToNode for Span<NameId> {
    /// `EntityName`: the single name, or the `QualifiedName` that ends with the last name.
    fn to_node(self, file: &File) -> Node {
        match self.iter().next_back() {
            Some(last) if self.len() > 1 => last.row(file).with(Part::Qualified),
            Some(only) => only.row(file),
            None => Node::NONE,
        }
    }
}

impl ToNode for TupleElemId {
    /// An element without a name, `?` or `...` is represented by its type.
    fn to_node(self, file: &File) -> Node {
        match file.tuple_elems.get(self.idx()) {
            Some(element) if element.name.is_none() && !element.optional && !element.rest => {
                element.ty.row(file)
            }
            Some(_) => self.row(file),
            None => Node::NONE,
        }
    }
}

impl ToNode for Node {
    #[inline]
    fn to_node(self, _: &File) -> Node {
        self
    }
}

impl ToNode for ExprId {
    fn to_node(self, file: &File) -> Node {
        match file.exprs.get(self.idx()).map(|e| e.kind) {
            Some(ExprKind::Fn(f)) => f.to_node(file),
            Some(_) => self.row(file),
            None => Node::NONE,
        }
    }

    fn to_child(self, file: &File) -> Node {
        // The outermost parentheses around it come last.
        let after = file.parens.partition_point(|p| p.0.0 <= self.0);
        match after.checked_sub(1) {
            Some(last) if file.parens[last].0 == self => ParenId(last as u32).row(file),
            _ => self.to_node(file),
        }
    }
}

impl ToNode for FnId {
    #[inline]
    fn to_node(self, file: &File) -> Node {
        file.fn_nodes.get(self.idx()).copied().unwrap_or(Node::NONE)
    }
}

impl ToNode for ClassId {
    #[inline]
    fn to_node(self, file: &File) -> Node {
        let class = file.class_nodes.get(self.idx());
        class.copied().unwrap_or(Node::NONE)
    }
}

macro_rules! statements_are_nodes {
    ($($id:ident $field:ident)*) => {
        $(impl ToNode for $id {
            #[inline]
            fn to_node(self, file: &File) -> Node {
                file.$field.get(self.idx()).map_or(Node::NONE, |it| it.stmt.row(file))
            }
        })*
    };
}
statements_are_nodes! {
    InterfaceId interfaces AliasId aliases EnumId enums ModuleId modules ImportEqualsId import_equals ImportId imports
    ExportId exports
}

impl ToNode for Decl {
    /// One of `symbol.Declarations`.
    fn to_node(self, file: &File) -> Node {
        match self {
            // The `VariableDeclaration`, `Parameter` or `BindingElement` it is the name of.
            Decl::Var(name) | Decl::Param(name) | Decl::Require(name) => {
                file.parent(file.node(name))
            }
            Decl::Fn(f) => file.node(f),
            Decl::Class(c) => file.node(c),
            Decl::Interface(i) => file.node(i),
            Decl::Alias(a) => file.node(a),
            Decl::Enum(e) => file.node(e),
            Decl::EnumMember(m) => file.node(m),
            Decl::Module(m) => file.node(m),
            Decl::TypeParam(p) => file.node(p),
            Decl::ImportDefault(i) => file.node(i).with(Part::ImportClause),
            Decl::ImportNamespace(i) => file.node(i).with(Part::NamedBindings),
            Decl::ImportSpec(s) => file.node(s),
            Decl::ImportEquals(i) => file.node(i),
            Decl::ExportSpec(s) => file.node(s),
            Decl::ExportStarAs(s) => file.node(s).with(Part::ExportClause),
            Decl::ExportExpr(s) | Decl::UmdGlobal(s) => file.node(s),
            Decl::File | Decl::CommonJsVariable => Node::FILE,
            Decl::ModuleExports(e)
            | Decl::ExportsProperty(e)
            | Decl::Expando(e)
            | Decl::ObjectLiteral(e)
            | Decl::ThisProperty(e) => file.node(e),
            Decl::Member(m) => file.node(m),
            Decl::ParameterProperty(p) => file.node(p),
            Decl::Property(p) => file.node(p),
            Decl::TypeLiteral(t) => file.node(t),
        }
    }
}

impl ToNode for Parent {
    /// The node that directly contains an expression or a statement whose `Parent` this is. For
    /// callers that still hold a `Parent`.
    fn to_node(self, file: &File) -> Node {
        match self {
            Parent::None => Node::NONE,
            Parent::Expr(e) => file.node(e),
            Parent::Stmt(s) => file.node(s),
            Parent::VarInit(d) => file.node(d),
            Parent::ParamDefault(p) | Parent::Decorator(_, DecoratorOwner::Param(p)) => {
                file.node(p)
            }
            Parent::PatPropDefault(p) => file.node(p),
            Parent::PatElemDefault(e) => file.node(e),
            Parent::Prop(p) => file.node(p),
            Parent::PropKey(_, p) | Parent::MethodKey(p) => file.node(p).with(Part::Name),
            Parent::PatKey(p) => file.node(p).with(Part::PropertyName),
            Parent::MemberKey(m) => file.node(m).with(Part::Name),
            Parent::MemberInit(m) | Parent::Decorator(_, DecoratorOwner::Member(m)) => file.node(m),
            Parent::FnBody(f) => file.node(f),
            Parent::EnumInit(m) => file.node(m),
            Parent::Case(c) => file.node(c),
            Parent::ClassExtends(c) | Parent::Decorator(_, DecoratorOwner::Class(c)) => {
                file.node(c)
            }
            Parent::Module(m) => file.node(m),
            Parent::File => Node::FILE,
        }
    }
}

/// `Visitor`, and the file that the ids passed to it belong to.
struct Children<'a, V: FnMut(Node) -> bool + ?Sized> {
    file: &'a File,
    visit: &'a mut V,
    /// Whether a parenthesized expression is visited as its `ParenthesizedExpression`, which
    /// requires a search.
    with_parentheses: bool,
}

impl<V: FnMut(Node) -> bool + ?Sized> Children<'_, V> {
    /// `node.ForEachChild`. `data`: what `node` refers to. A caller that knows it statically is
    /// specialized to the one match arm.
    #[inline(always)]
    fn children(&mut self, data: NodeData, node: Node) -> bool {
        let file = self.file;
        match data {
            NodeData::None => false,
            NodeData::File => self.list(file.body),
            NodeData::Part(part, row) => self.part_of(part, row),
            NodeData::Expr(e) => self.expr(e, node),
            NodeData::Stmt(s) => self.span(file[s].modifiers) || self.stmt(s, node),
            NodeData::Type(t) => self.ty(t, node),
            NodeData::Pat(p) => match file[p].kind {
                PatKind::Missing | PatKind::Ident(_) => false,
                PatKind::Object(properties) => self.span(properties),
                PatKind::Array(elements) => self.span(elements),
            },
            NodeData::PatProp(p) => {
                self.one(file.property_name(node))
                    || self.one(file[p].value)
                    || self.one(file[p].default)
            }
            NodeData::PatElem(e) if matches!(file[file[e].pat].kind, PatKind::Missing) => false,
            NodeData::PatElem(e) => self.one(file[e].pat) || self.one(file[e].default),
            NodeData::Param(p) => {
                let parameter = &file[p];
                self.span(file.param_modifiers(p))
                    || self.one(parameter.pat)
                    || self.one(parameter.ty)
                    || self.one(parameter.default)
            }
            NodeData::TypeParam(p) => {
                self.span(file[p].modifiers)
                    || self.one(node.with(Part::Name))
                    || self.one(file[p].constraint)
                    || self.one(file[p].default)
            }
            NodeData::Member(m) => {
                let member = &file[m];
                self.span(member.modifiers)
                    || self.one(file.name(node))
                    || member.func.is_some() && self.function(member.func, node)
                    // For an accessor and an index signature it duplicates the return type of the
                    // function.
                    || member.func.is_none() && self.one(member.ty)
                    || self.one(member.init)
            }
            NodeData::Prop(p) => {
                let (property, method) = (&file[p], file.method_of(p));
                let value = file.exprs.get(property.value.idx()).map(|e| e.kind);
                self.one(file.name(node))
                    || self.one(file.jsdoc_type(JsDocTypeOwner::Prop(p)))
                    || match (property.kind, value) {
                        _ if method.is_some() => self.function(method, node),
                        (PropKind::Shorthand, Some(ExprKind::Assign { value, .. })) => {
                            self.one(value)
                        }
                        (PropKind::Shorthand, _) => false,
                        (PropKind::Init, _) if property.name_kind == NameKind::Jsx => {
                            self.jsx_child(property.value)
                        }
                        _ => self.one(property.value),
                    }
            }
            NodeData::VarDecl(d) => {
                let declaration = &file[d];
                self.one(declaration.pat) || self.one(declaration.ty) || self.one(declaration.init)
            }
            NodeData::Case(c) => self.one(file[c].test) || self.list(file[c].body),
            NodeData::EnumMember(m) => self.one(node.with(Part::Name)) || self.one(file[m].init),
            NodeData::ImportSpec(_) | NodeData::ExportSpec(_) => {
                self.one(file.property_name(node)) || self.one(node.with(Part::Name))
            }
            NodeData::TupleElem(e) => self.one(file.name(node)) || self.one(file[e].ty),
            NodeData::Modifier(m) => {
                matches!(file[m].kind, ModifierKind::Decorator(e) if self.one(e))
            }
            NodeData::Name(_) => false,
            NodeData::Paren(_) => (self.visit)(file.expression(node)),
        }
    }

    /// `children` for the parts in `open`, and for the parts in those.
    #[inline]
    fn children_of_parts(&mut self, at_hand: &Cell<Node>, open: &RefCell<Vec<Node>>) {
        while let Some(part) = { open.borrow_mut().pop() } {
            at_hand.set(part);
            if let Some(which) = part.part() {
                self.part_of(which, part.row());
            }
        }
    }

    /// `visit`
    fn one(&mut self, id: impl ToNode) -> bool {
        let node = if self.with_parentheses {
            id.to_child(self.file)
        } else {
            id.to_node(self.file)
        };
        node.is_some() && (self.visit)(node)
    }

    /// `visit` for a part that only exists if `exists`.
    fn part(&mut self, of: Node, part: Part, exists: bool) -> bool {
        exists && (self.visit)(of.with(part))
    }

    /// `visitNodeList`
    fn list<T: ToNode + From<u32>>(&mut self, list: IdList<T>) -> bool {
        let file = self.file;
        file.ids(list).any(|id| self.one(id))
    }

    /// `visitNodeList`
    fn span<T: ToNode + From<u32>>(&mut self, span: Span<T>) -> bool {
        span.iter().any(|id| self.one(id))
    }

    /// `visitNodeList` for expressions or types that are each wrapped in `part`.
    fn wrapped<T: Row + From<u32>>(&mut self, list: IdList<T>, part: Part) -> bool {
        let file = self.file;
        file.ids(list).any(|e| self.one(e.row(file).with(part)))
    }

    /// A child of a JSX element, or the initializer of an attribute: text, a string and an element
    /// represent themselves.
    fn jsx_child(&mut self, e: ExprId) -> bool {
        match self.file.exprs.get(e.idx()).map(|e| e.kind) {
            None => false,
            Some(ExprKind::Jsx(_)) => self.one(e),
            Some(ExprKind::String(_)) if jsx_expression_around(self.file, e).is_none() => {
                self.one(e)
            }
            Some(_) => self.one(e.row(self.file).with(Part::JsxExpression)),
        }
    }

    /// The expression in the declaration `s` in place of a module specifier that is not a string,
    /// and its `ImportAttributes`. Few files have either.
    fn after_from(&mut self, s: StmtId) -> bool {
        let file = self.file;
        let (start, end) = (file[s].start, file[s].loc.end);
        // A missing one is positioned at the next token.
        let mut specifiers = file.specifier_expressions.iter();
        specifiers
            .any(|&e| (start + 1..=file.token_after(end)).contains(&file[e].pos) && self.one(e))
            || self.import_attributes(start, end)
    }

    /// The `ImportAttributes` of the node that spans `start` to `end`: the first ones inside that
    /// span.
    fn import_attributes(&mut self, start: u32, end: u32) -> bool {
        let mut all = self.file.import_attributes.iter();
        all.find(|of| (start..end).contains(&of.0))
            .is_some_and(|of| self.one(of.1))
    }

    /// The contents of the head of a `for` statement, which have no enclosing statement node.
    fn for_initializer(&mut self, init: StmtId) -> bool {
        match self.file.stmts.get(init.idx()).map(|s| s.kind) {
            Some(StmtKind::Expr(e)) => self.one(e),
            Some(StmtKind::Var(_)) => self.one(init.row(self.file).with(Part::DeclarationList)),
            _ => self.one(init),
        }
    }

    /// The children of the function-like `node` after its name.
    fn function(&mut self, f: FnId, node: Node) -> bool {
        let func = &self.file[f];
        self.span(func.type_params)
            || self.one(func.this_param)
            || self.span(func.params)
            || self.one(func.ret)
            || self.one(self.file.jsdoc_type(JsDocTypeOwner::Fn(f)))
            || match func.body {
                FnBody::None => false,
                FnBody::Block(_) => self.one(node.with(Part::Body)),
                FnBody::Expr(e) => self.one(e),
            }
    }

    /// The children of the class `node` after its modifiers.
    fn class(&mut self, c: ClassId, node: Node) -> bool {
        let class = &self.file[c];
        let extends = class.extends.is_some() || !class.other_extends.is_empty();
        let implements = !class.implements.is_empty() || !class.other_implements.is_empty();
        self.one(self.file.name(node))
            || self.span(class.type_params)
            || self.part(node, Part::Extends, extends)
            || self.part(node, Part::Implements, implements)
            || self.span(class.members)
    }

    fn call(&mut self, c: CallId) -> bool {
        let call = &self.file[c];
        self.one(call.callee) || self.list(call.type_args) || self.list(call.args)
    }

    fn expr(&mut self, e: ExprId, node: Node) -> bool {
        let file = self.file;
        match file[e].kind {
            ExprKind::Missing
            | ExprKind::Ident(_)
            | ExprKind::This
            | ExprKind::Super
            | ExprKind::Null
            | ExprKind::True
            | ExprKind::False
            | ExprKind::Number(_)
            | ExprKind::BigInt(_)
            | ExprKind::Regex => false,
            ExprKind::String(_) => {
                file.is_namespaced_tag_name(e)
                    && (self.one(node.with(Part::Namespace))
                        || self.one(node.with(Part::LocalName)))
            }
            ExprKind::ImportMeta | ExprKind::NewTarget(_) => self.one(node.with(Part::Name)),
            ExprKind::Template { exprs, .. } if exprs.is_empty() => false,
            ExprKind::Template { exprs, .. } => {
                self.one(node.with(Part::Head)) || self.wrapped(exprs, Part::Span)
            }
            ExprKind::TaggedTemplate(c) => {
                let call = &file[c];
                self.one(call.callee) || self.list(call.type_args) || self.one(call.template)
            }
            ExprKind::Array(elements) => self.list(elements),
            ExprKind::Object(properties) => self.span(properties),
            ExprKind::Fn(f) => self.one(file.name(node)) || self.function(f, node),
            ExprKind::Class(c) => self.span(file[c].modifiers) || self.class(c, node),
            ExprKind::Dot { obj, .. } => {
                !file.is_import_keyword(obj) && self.one(obj) || self.one(node.with(Part::Name))
            }
            ExprKind::Index { obj, index, .. } => self.one(obj) || self.one(index),
            ExprKind::Call(c) | ExprKind::New(c) => self.call(c),
            ExprKind::Unary { operand, .. } => self.one(operand),
            ExprKind::Binary { left, right, .. } => self.one(left) || self.one(right),
            ExprKind::Assign { target, value, .. } => {
                self.one(target)
                    || self.one(file.jsdoc_type(JsDocTypeOwner::Assign(e)))
                    || self.one(value)
            }
            ExprKind::Cond { test, yes, no } => self.one(test) || self.one(yes) || self.one(no),
            ExprKind::Spread(e) | ExprKind::Await(e) | ExprKind::NonNull(e) => self.one(e),
            // `<const>e` has its type first.
            ExprKind::AsConst(operand) if file.is_type_assertion(e, operand) => {
                self.one(node.with(Part::ConstType)) || self.one(operand)
            }
            ExprKind::AsConst(operand) => {
                let is_written = file.start_of_part(Part::ConstType, node) != 0;
                self.one(operand) || self.part(node, Part::ConstType, is_written)
            }
            ExprKind::Yield { value, .. } => self.one(value),
            // `<T>e` has its type first.
            ExprKind::As { expr, ty } if file[ty].pos < file[expr].pos => {
                self.one(ty) || self.one(expr)
            }
            ExprKind::As { expr, ty } | ExprKind::Satisfies { expr, ty } => {
                self.one(expr) || self.one(ty)
            }
            ExprKind::Instantiation { expr, type_args } => self.one(expr) || self.list(type_args),
            ExprKind::Jsx(j) if file.is_self_closing(j) => {
                self.one(file[j].tag)
                    || self.list(file[j].type_args)
                    || self.one(node.with(Part::Attributes))
            }
            ExprKind::Jsx(j) => {
                self.one(node.with(Part::Opening))
                    || file
                        .ids(file[j].children)
                        .any(|child| self.jsx_child(child))
                    || self.one(node.with(Part::Closing))
            }
            ExprKind::ImportCall { args } => {
                self.one(node.with(Part::Keyword))
                    || self.list(file.type_args_of_import_call(args))
                    // `import()`: the placeholder for the specifier is not a node.
                    || (file.ids(args))
                        .any(|arg| !matches!(file[arg].kind, ExprKind::Missing) && self.one(arg))
            }
        }
    }

    fn stmt(&mut self, s: StmtId, node: Node) -> bool {
        let file = self.file;
        match file[s].kind {
            StmtKind::Debugger => false,
            // It also represents an import or an export whose specifier is not a string.
            StmtKind::Empty => self.after_from(s),
            StmtKind::Break(label) | StmtKind::Continue(label) => {
                self.part(node, Part::Label, label.is_some())
            }
            StmtKind::Expr(e) | StmtKind::Return(e) | StmtKind::Throw(e) => self.one(e),
            StmtKind::ExportDefault(e) | StmtKind::ExportAssign(e) => {
                self.one(file.jsdoc_type(JsDocTypeOwner::Export(s))) || self.one(e)
            }
            StmtKind::Var(_) => self.one(node.with(Part::DeclarationList)),
            StmtKind::Fn(f) => self.one(file.name(node)) || self.function(f, node),
            StmtKind::Class(c) => self.class(c, node),
            StmtKind::Interface(i) => {
                let interface = &file[i];
                let extends = !interface.extends.is_empty() || !interface.other_heritage.is_empty();
                self.one(node.with(Part::Name))
                    || self.span(interface.type_params)
                    || self.part(node, Part::Extends, extends)
                    || self.span(interface.members)
            }
            StmtKind::TypeAlias(a) => {
                self.one(node.with(Part::Name))
                    || self.span(file[a].type_params)
                    || self.one(file[a].ty)
            }
            StmtKind::Enum(e) => self.one(node.with(Part::Name)) || self.span(file[e].members),
            StmtKind::Module(m) => {
                self.one(node.with(Part::Name))
                    || match file.nested_namespace(m) {
                        Some(nested) => self.one(nested),
                        None => self.part(node, Part::Body, file[m].has_body),
                    }
            }
            StmtKind::If { test, yes, no } => self.one(test) || self.one(yes) || self.one(no),
            StmtKind::For {
                init,
                test,
                update,
                body,
            } => self.for_initializer(init) || self.one(test) || self.one(update) || self.one(body),
            StmtKind::ForOf { is_await: true, .. } if self.one(node.with(Part::Keyword)) => true,
            StmtKind::ForIn { left, expr, body }
            | StmtKind::ForOf {
                left, expr, body, ..
            } => self.for_initializer(left) || self.one(expr) || self.one(body),
            StmtKind::While { test, body } => self.one(test) || self.one(body),
            StmtKind::DoWhile { body, test } => self.one(body) || self.one(test),
            // The statement that wraps the object of a `with` is not a node.
            StmtKind::Block(statements) if file.is_with_statement(s) => {
                let (object, body) = (file.id_at(statements, 0), file.id_at(statements, 1));
                matches!(file[object].kind, StmtKind::Expr(e) if self.one(e)) || self.one(body)
            }
            StmtKind::Block(statements) => self.list(statements),
            StmtKind::Switch { expr, .. } => self.one(expr) || self.one(node.with(Part::Body)),
            StmtKind::Try {
                block,
                handler,
                finalizer,
                ..
            } => {
                self.one(block)
                    || self.part(node, Part::CatchClause, handler.is_some())
                    || self.one(finalizer)
            }
            StmtKind::Labeled { body, .. } => self.one(node.with(Part::Label)) || self.one(body),
            StmtKind::Import(i) => {
                let import = &file[i];
                // `import {} from "m"` has one too.
                let has_clause = import.default.is_some()
                    || import.namespace.is_some()
                    || !import.named.is_empty()
                    || import.clause_end > import.clause_start;
                self.part(node, Part::ImportClause, has_clause)
                    || self.part(node, Part::Specifier, import.spec.is_some())
                    || self.after_from(s)
            }
            StmtKind::ImportEquals(i) => {
                self.one(node.with(Part::Name))
                    || match file[i].target {
                        ImportEqualsTarget::Require(_) => {
                            self.one(node.with(Part::ModuleReference))
                        }
                        ImportEqualsTarget::Entity(name) => self.one(name),
                    }
            }
            StmtKind::ExportNamed(x) => {
                self.one(node.with(Part::ExportClause))
                    || self.part(node, Part::Specifier, file[x].spec.is_some())
                    || self.after_from(s)
            }
            StmtKind::ExportStar { alias, spec, .. } => {
                self.part(node, Part::ExportClause, alias.is_some())
                    || self.part(node, Part::Specifier, spec.is_some())
                    || self.after_from(s)
            }
            StmtKind::ExportAsNamespace(_) => self.one(node.with(Part::Name)),
        }
    }

    fn ty(&mut self, t: TypeNodeId, node: Node) -> bool {
        let file = self.file;
        match file[t].kind {
            TypeNodeKind::Keyword(Keyword::Null)
            | TypeNodeKind::StringLit(_)
            | TypeNodeKind::NumberLit(_)
            | TypeNodeKind::BigIntLit { .. }
            | TypeNodeKind::BoolLit(_)
            | TypeNodeKind::UniqueSymbol => self.one(node.with(Part::Literal)),
            TypeNodeKind::Error | TypeNodeKind::Keyword(_) => false,
            TypeNodeKind::Template { types, .. } if types.is_empty() => {
                self.one(node.with(Part::Literal))
            }
            TypeNodeKind::Template { types, .. } => {
                self.one(node.with(Part::Head)) || self.wrapped(types, Part::Span)
            }
            TypeNodeKind::Heritage(e) => self.one(e),
            TypeNodeKind::Import { name, args, .. } => {
                self.import_attributes(file[t].pos, file[t].end)
                    || self.one(name)
                    || self.list(args)
            }
            TypeNodeKind::Ref { name, args } => self.one(name) || self.list(args),
            TypeNodeKind::Union(types) | TypeNodeKind::Intersection(types) => self.list(types),
            TypeNodeKind::Array(t)
            | TypeNodeKind::Keyof(t)
            | TypeNodeKind::Readonly(t)
            | TypeNodeKind::JSDoc { ty: t, .. } => self.one(t),
            TypeNodeKind::Tuple(elements) => self.span(elements),
            TypeNodeKind::Fn(f) => self.function(f, node),
            TypeNodeKind::Object(members) => self.span(members),
            TypeNodeKind::Cond {
                check,
                extends,
                yes,
                no,
            } => self.one(check) || self.one(extends) || self.one(yes) || self.one(no),
            TypeNodeKind::Infer(parameter) => self.one(parameter),
            TypeNodeKind::Mapped(m) => {
                let mapped = &file[m];
                self.one(mapped.param)
                    || self.one(mapped.name_ty)
                    || self.one(mapped.ty)
                    || self.span(mapped.members)
            }
            TypeNodeKind::IndexedAccess { obj, index } => self.one(obj) || self.one(index),
            TypeNodeKind::Typeof { args, expr, .. } => self.one(expr) || self.list(args),
            TypeNodeKind::Predicate { ty, asserts, .. } => {
                self.part(node, Part::Keyword, asserts)
                    || self.one(node.with(Part::Name))
                    || self.one(ty)
            }
        }
    }

    fn part_of(&mut self, part: Part, row: Node) -> bool {
        let file = self.file;
        let statement = match file.data(row) {
            NodeData::Stmt(s) => Some(file[s].kind),
            _ => None,
        };
        let jsx = match file.data(row) {
            NodeData::Expr(e) => match file[e].kind {
                ExprKind::Jsx(j) => Some(&file[j]),
                _ => None,
            },
            _ => None,
        };
        match part {
            Part::Label
            | Part::BindingsName
            | Part::NameLiteral
            | Part::Operand
            | Part::Head
            | Part::Tail
            | Part::Specifier
            | Part::Namespace
            | Part::LocalName => false,
            Part::Keyword => self.part(row, Part::Name, file.is_deferred_import_call(row)),
            Part::Literal => {
                file.kind_of_part(part, row) == Kind::PrefixUnaryExpression
                    && self.one(row.with(Part::Operand))
            }
            Part::ConstType => self.one(row.with(Part::Name)),
            // The placeholder for the empty `{}` is positioned at the brace. The dots of `{...e}`
            // belong to the `JsxExpression`.
            Part::JsxExpression => match file.data(row) {
                NodeData::Expr(e) => match file[e].kind {
                    ExprKind::Missing if file.text.get(file[e].pos as usize) == Some(&b'{') => {
                        false
                    }
                    ExprKind::Spread(inner) => self.one(inner),
                    _ => self.one(e),
                },
                _ => false,
            },
            // `ComputedPropertyName`
            Part::Name | Part::PropertyName => match file.key_of(row) {
                (PropKey::Computed(e), _) => self.one(e),
                (_, NameKind::ComputedString | NameKind::ComputedNumber) => {
                    self.one(row.with(Part::NameLiteral))
                }
                (_, NameKind::Jsx) => {
                    file.colon_of_jsx_name(file.start_of_part(part, row))
                        .is_some()
                        && (self.one(row.with(Part::Namespace))
                            || self.one(row.with(Part::LocalName)))
                }
                _ => false,
            },
            Part::Body => match statement {
                Some(StmtKind::Module(m)) => self.list(file[m].body),
                Some(StmtKind::Switch { cases, .. }) => self.span(cases),
                _ => match file.fns.get(file.function_of(row).idx()).map(|f| f.body) {
                    Some(FnBody::Block(statements)) => self.list(statements),
                    _ => false,
                },
            },
            Part::CatchClause => match statement {
                Some(StmtKind::Try { param, handler, .. }) => self.one(param) || self.one(handler),
                _ => false,
            },
            Part::Extends => match (statement, file.classes.get(file.class_of(row).idx())) {
                (Some(StmtKind::Interface(i)), _) => {
                    self.list(file[i].extends) || self.list(file[i].other_heritage)
                }
                (_, Some(class)) => {
                    self.part(row, Part::Base, class.extends.is_some())
                        || self.list(class.other_extends)
                }
                _ => false,
            },
            Part::Implements => match file.classes.get(file.class_of(row).idx()) {
                Some(class) => self.list(class.implements) || self.list(class.other_implements),
                None => false,
            },
            Part::Base => match file.classes.get(file.class_of(row).idx()) {
                Some(class) => self.one(class.extends) || self.list(class.extends_args),
                None => false,
            },
            // `Left`, `Right`
            Part::Qualified => {
                let left = Node(row.0 - 1);
                let is_qualified =
                    matches!(file.data(left), NodeData::Name(n) if file[n].is_qualified());
                self.one(if is_qualified {
                    left.with(Part::Qualified)
                } else {
                    left
                }) || self.one(row)
            }
            Part::Span => {
                (match file.data(row) {
                    NodeData::Expr(e) => self.one(e),
                    _ => self.one(row),
                }) || self.one(row.with(Part::Tail))
            }
            Part::DeclarationList => match statement {
                Some(StmtKind::Var(declarations)) => self.span(declarations),
                _ => false,
            },
            Part::ImportClause => match statement {
                Some(StmtKind::Import(i)) => {
                    let has_bindings = file[i].namespace.is_some()
                        || !file[i].named.is_empty()
                        || file[i].default.is_none();
                    self.part(row, Part::Name, file[i].default.is_some())
                        || self.part(row, Part::NamedBindings, has_bindings)
                }
                _ => false,
            },
            Part::NamedBindings => match statement {
                Some(StmtKind::Import(i)) if file[i].namespace.is_some() => {
                    self.one(row.with(Part::BindingsName))
                }
                Some(StmtKind::Import(i)) => self.span(file[i].named),
                _ => false,
            },
            Part::ExportClause => match statement {
                Some(StmtKind::ExportNamed(x)) => self.span(file[x].items),
                _ => self.one(row.with(Part::BindingsName)),
            },
            Part::ModuleReference => match statement {
                Some(StmtKind::ImportEquals(i)) => {
                    let is_string = matches!(file[i].target, ImportEqualsTarget::Require(spec) if spec.is_some());
                    self.part(row, Part::Specifier, is_string) || self.one(file[i].expression)
                }
                _ => false,
            },
            Part::Opening => match jsx {
                Some(jsx) => {
                    self.one(jsx.tag)
                        || self.list(jsx.type_args)
                        || self.part(row, Part::Attributes, jsx.tag.is_some())
                }
                None => false,
            },
            Part::Closing => jsx.is_some_and(|jsx| self.one(jsx.close_tag)),
            Part::Attributes => jsx.is_some_and(|jsx| self.span(jsx.attrs)),
        }
    }
}

impl File {
    /// The handle of the node that `id` is, or is the second HIR node of.
    #[inline]
    pub fn node(&self, id: impl ToNode) -> Node {
        id.to_node(self)
    }

    #[inline]
    fn parents(&self) -> &Parents {
        self.parents.get_or_init(|| self.parents_of_all())
    }

    /// `node.Parent`. `NONE` for the file, and for a HIR node that is unreachable from the file.
    #[inline]
    pub fn parent(&self, node: Node) -> Node {
        match self.parents().rows.get(node.idx()) {
            Some(&parent) => parent,
            None => self.parent_of_part(node),
        }
    }

    fn parent_of_part(&self, node: Node) -> Node {
        let row = node.row();
        let is_import = || matches!(self.data(row), NodeData::Stmt(s) if matches!(self[s].kind, StmtKind::Import(_)));
        match node.part() {
            None => Node::NONE,
            Some(Part::Span | Part::Qualified | Part::JsxExpression) => {
                let around = &self.parents().around;
                let at = around.binary_search_by_key(&node, |&(wrapper, _)| wrapper);
                at.map_or(Node::NONE, |at| around[at].1)
            }
            Some(Part::Base) => row.with(Part::Extends),
            Some(Part::NameLiteral) if matches!(self.data(row), NodeData::PatProp(_)) => {
                row.with(Part::PropertyName)
            }
            Some(Part::NameLiteral) => row.with(Part::Name),
            Some(Part::Operand) => row.with(Part::Literal),
            Some(Part::Tail) => row.with(Part::Span),
            Some(Part::Namespace | Part::LocalName)
                if matches!(self.data(row), NodeData::Prop(_)) =>
            {
                row.with(Part::Name)
            }
            Some(Part::Name) if matches!(self.data(row), NodeData::Expr(e) if matches!(self[e].kind, ExprKind::AsConst(_))) => {
                row.with(Part::ConstType)
            }
            Some(Part::Name) if matches!(self.data(row), NodeData::Expr(e) if matches!(self[e].kind, ExprKind::ImportCall { .. })) => {
                row.with(Part::Keyword)
            }
            Some(Part::Specifier) if matches!(self.data(row), NodeData::Stmt(s) if matches!(self[s].kind, StmtKind::ImportEquals(_))) => {
                row.with(Part::ModuleReference)
            }
            // In the head of a `for`.
            Some(Part::DeclarationList) if self.is_for_initializer(row) => self.parent(row),
            Some(Part::Name) if is_import() => row.with(Part::ImportClause),
            Some(Part::NamedBindings) => row.with(Part::ImportClause),
            Some(Part::BindingsName) if is_import() => row.with(Part::NamedBindings),
            Some(Part::BindingsName) => row.with(Part::ExportClause),
            Some(Part::Attributes) if !self.kind(row).eq(&Kind::JsxSelfClosingElement) => {
                row.with(Part::Opening)
            }
            Some(_) => row,
        }
    }

    /// Whether the statement `row` is the contents of the head of its parent `for` statement.
    fn is_for_initializer(&self, row: Node) -> bool {
        match (self.data(row), self.data(self.parent(row))) {
            (NodeData::Stmt(s), NodeData::Stmt(above)) => matches!(
                self[above].kind,
                StmtKind::For { init: head, .. }
                    | StmtKind::ForIn { left: head, .. }
                    | StmtKind::ForOf { left: head, .. } if head == s
            ),
            _ => false,
        }
    }

    /// Half of all nodes are leaves: the traversal does not revisit them.
    #[inline]
    fn may_have_rows_under_it(&self, data: NodeData, node: Node) -> bool {
        match data {
            NodeData::Expr(e) => !matches!(
                self[e].kind,
                ExprKind::Missing
                    | ExprKind::Ident(_)
                    | ExprKind::This
                    | ExprKind::Super
                    | ExprKind::Null
                    | ExprKind::True
                    | ExprKind::False
                    | ExprKind::Number(_)
                    | ExprKind::String(_)
                    | ExprKind::BigInt(_)
                    | ExprKind::Regex
                    | ExprKind::ImportMeta
                    | ExprKind::NewTarget(_)
            ),
            NodeData::Pat(p) => !matches!(self[p].kind, PatKind::Missing | PatKind::Ident(_)),
            NodeData::Type(t) => !matches!(
                self[t].kind,
                TypeNodeKind::Keyword(_)
                    | TypeNodeKind::StringLit(_)
                    | TypeNodeKind::NumberLit(_)
                    | TypeNodeKind::BigIntLit { .. }
                    | TypeNodeKind::BoolLit(_)
                    | TypeNodeKind::UniqueSymbol
            ),
            NodeData::Modifier(m) => matches!(self[m].kind, ModifierKind::Decorator(_)),
            NodeData::Name(_) | NodeData::ImportSpec(_) | NodeData::ExportSpec(_) => false,
            // They are inserted between child and parent afterwards.
            NodeData::Paren(_) => false,
            // An element that is only its type is not a node, and comes after the tuple that holds
            // the type.
            NodeData::TupleElem(e) => e.to_node(self) == node,
            NodeData::Part(
                Part::Label
                | Part::BindingsName
                | Part::NameLiteral
                | Part::Literal
                | Part::Operand
                | Part::Head
                | Part::Tail
                | Part::ConstType
                | Part::Specifier
                | Part::Keyword
                | Part::Namespace
                | Part::LocalName,
                _,
            ) => false,
            NodeData::Part(Part::Name | Part::PropertyName, row) => {
                matches!(self.key_of(row).0, PropKey::Computed(_))
            }
            _ => true,
        }
    }

    /// Computed when the first parent is requested: for most files of a program none ever is.
    /// Iterates over the HIR nodes in order, not top-down from the file: that needs no stack, and
    /// no HIR node is visited twice. A HIR node is created after its children, so of two HIR nodes
    /// with the same child (a HIR node that is not a tsgo node, or that is unreachable, has the
    /// children of the node around it) the later one is the tsgo node, and overwrites the earlier.
    #[cold]
    fn parents_of_all(&self) -> Parents {
        let total = self.bases.0[VECTORS];
        let mut rows = vec![Node::NONE; total as usize];
        let mut around = Vec::new();
        // The current HIR node or part, and the parts of that HIR node that have children.
        let (at_hand, open) = (Cell::new(Node::NONE), RefCell::new(Vec::new()));
        let mut visit = |child: Node| {
            let node = at_hand.get();
            match child.part() {
                None => {
                    rows[child.idx()] = node;
                    return false;
                }
                Some(Part::Span | Part::Qualified | Part::JsxExpression) => {
                    around.push((child, node));
                }
                // In the head of a `for` it represents its HIR node, which is not a tsgo node.
                Some(Part::DeclarationList) if child.row() != node.row() => {
                    rows[child.row().idx()] = node;
                    return false;
                }
                // The name of an expression or a statement is an identifier.
                Some(Part::Name) if child.row().0 < self.bases.0[2] => return false,
                Some(
                    Part::Label
                    | Part::BindingsName
                    | Part::NameLiteral
                    | Part::Literal
                    | Part::Operand
                    | Part::Head
                    | Part::Tail
                    | Part::ConstType
                    | Part::Specifier
                    | Part::Keyword
                    | Part::Namespace
                    | Part::LocalName,
                ) => return false,
                // Derived from the HIR node.
                Some(_) => {}
            }
            open.borrow_mut().push(child);
            false
        };
        let mut v = Children {
            file: self,
            visit: &mut visit,
            with_parentheses: false,
        };
        self.children_of_all_rows(&mut v, &at_hand, &open);
        // The parentheses are inserted afterwards: their list is short, whereas a lookup in it for
        // every expression is not cheap.
        for p in 0..self.parens.len() as u32 {
            let parentheses = ParenId(p).row(self);
            let inner = self.expression(parentheses).row();
            rows[parentheses.idx()] = rows[inner.idx()];
            if rows[inner.idx()].is_some() {
                rows[inner.idx()] = parentheses;
            }
        }
        // The later entry wins here too.
        around.sort_by_key(|&(inner, _)| inner);
        around.dedup_by(|later, kept| {
            let is_same = later.0 == kept.0;
            if is_same {
                *kept = *later;
            }
            is_same
        });
        Parents {
            rows: rows.into(),
            around: around.into(),
        }
    }

    /// `FindAncestor`
    pub fn find_ancestor(&self, mut node: Node, mut found: impl FnMut(Node) -> bool) -> Node {
        while node.is_some() && !found(node) {
            node = self.parent(node);
        }
        node
    }

    /// `FunctionLikeData`: the `Func` of a function-like.
    pub fn function_of(&self, node: Node) -> FnId {
        match self.data(node) {
            NodeData::Expr(e) => match self[e].kind {
                ExprKind::Fn(f) => f,
                _ => FnId::NONE,
            },
            NodeData::Stmt(s) => match self[s].kind {
                StmtKind::Fn(f) => f,
                _ => FnId::NONE,
            },
            NodeData::Type(t) => match self[t].kind {
                TypeNodeKind::Fn(f) => f,
                _ => FnId::NONE,
            },
            NodeData::Member(m) => self[m].func,
            NodeData::Prop(p) => self.method_of(p),
            _ => FnId::NONE,
        }
    }

    /// `ClassLikeData`: the `Class` of a class-like.
    pub fn class_of(&self, node: Node) -> ClassId {
        match self.data(node) {
            NodeData::Expr(e) => match self[e].kind {
                ExprKind::Class(c) => c,
                _ => ClassId::NONE,
            },
            NodeData::Stmt(s) => match self[s].kind {
                StmtKind::Class(c) => c,
                _ => ClassId::NONE,
            },
            _ => ClassId::NONE,
        }
    }

    /// The function of a method or an accessor of an object literal.
    fn method_of(&self, p: PropId) -> FnId {
        match (
            self[p].kind,
            self.exprs.get(self[p].value.idx()).map(|e| e.kind),
        ) {
            (PropKind::Method | PropKind::Getter | PropKind::Setter, Some(ExprKind::Fn(f))) => f,
            _ => FnId::NONE,
        }
    }

    /// `<T>operand`, which starts before its operand, parentheses included; not `operand as T`.
    fn is_type_assertion(&self, e: ExprId, operand: ExprId) -> bool {
        self[e].pos < open_parenthesis(self, operand).unwrap_or(self[operand].pos)
    }

    /// A `with` statement is stored as a block of its object and its body, positioned at the
    /// keyword.
    fn is_with_statement(&self, s: StmtId) -> bool {
        let written = self.text.get(self[s].start as usize..);
        matches!(self[s].kind, StmtKind::Block(list) if list.len() == 2)
            && written.is_some_and(|text| text.starts_with(b"with"))
    }

    /// The position of the `:` of the `JsxNamespacedName` that starts at `pos`. `None`: the name
    /// there is an identifier.
    fn colon_of_jsx_name(&self, pos: u32) -> Option<u32> {
        let colon = skip_trivia(&self.text, jsx_identifier_end(&self.text, pos as usize));
        (self.text.get(colon) == Some(&b':')).then_some(colon as u32)
    }

    /// Whether `e` is a JSX tag name of the form `a:b`. A string literal starts with its quote, and
    /// `JsxText` after a `>` or a `}`.
    fn is_namespaced_tag_name(&self, e: ExprId) -> bool {
        let pos = self[e].pos as usize;
        !matches!(self.text.get(pos), None | Some(b'"' | b'\'' | b'`' | b'#'))
            && matches!(
                self.text[..skip_trivia_back(&self.text, pos)].last(),
                Some(b'<' | b'/')
            )
            && self.colon_of_jsx_name(self[e].pos).is_some()
    }

    /// The `import` of an `import.x` that is neither `import.meta` nor called: the keyword of a
    /// `MetaProperty` is not a node.
    fn is_import_keyword(&self, e: ExprId) -> bool {
        matches!(self[e].kind, ExprKind::Missing)
            && (self.text.get(self[e].pos as usize..))
                .is_some_and(|rest| rest.starts_with(b"import"))
    }

    /// `import.defer("m")`
    fn is_deferred_import_call(&self, row: Node) -> bool {
        !self.deferred_import_calls.is_empty()
            && matches!(self.data(row), NodeData::Expr(e) if matches!(self[e].kind, ExprKind::ImportCall { args, .. }
                if self.deferred_import_calls.iter().any(|call| call.0 == self.id_at(args, 0))))
    }

    fn is_self_closing(&self, j: JsxId) -> bool {
        self[j].tag.is_some() && self[j].close_pos == u32::MAX
    }

    /// The `B` of `namespace A.B`, which is the body of `A` without a block.
    fn nested_namespace(&self, m: ModuleId) -> Option<StmtId> {
        let mut body = self.ids(self[m].body);
        match (body.next(), body.next()) {
            (Some(only), None) if is_nested_namespace(self, only) => Some(only),
            _ => None,
        }
    }

    /// The key of a member, a property, a binding element or a member of an enum, and its syntactic
    /// form.
    fn key_of(&self, row: Node) -> (PropKey, NameKind) {
        match self.data(row) {
            NodeData::Member(m) => {
                let flags = self[m].flags;
                let is_string = flags.contains(Flags::STRING_NAME);
                let kind = match flags.contains(Flags::COMPUTED_NAME) {
                    true if is_string => NameKind::ComputedString,
                    true => NameKind::ComputedNumber,
                    false if is_string => NameKind::StringLiteral,
                    false if flags.contains(Flags::LITERAL_NAME) => NameKind::NumericLiteral,
                    false => NameKind::Identifier,
                };
                (self[m].key, kind)
            }
            NodeData::Prop(p) => (self[p].key, self[p].name_kind),
            NodeData::PatProp(p) => (self[p].key, self[p].name_kind),
            NodeData::EnumMember(m) if self[m].computed_name.is_some() => (
                PropKey::Computed(self[m].computed_name),
                NameKind::Identifier,
            ),
            NodeData::EnumMember(m) => (PropKey::Name(self[m].name), self[m].name_kind),
            _ => (PropKey::None, NameKind::Identifier),
        }
    }

    /// `node.Text()` for a name, an identifier or a string. `NONE`: it has none, or the HIR does
    /// not store it.
    pub fn text(&self, node: Node) -> Atom {
        let statement = |row: Node| match self.data(row) {
            NodeData::Stmt(s) => Some(self[s].kind),
            _ => None,
        };
        match self.data(node) {
            NodeData::Expr(e) => match self[e].kind {
                ExprKind::Ident(text) | ExprKind::String(text) | ExprKind::BigInt(text) => text,
                _ => Atom::NONE,
            },
            NodeData::Pat(p) => match self[p].kind {
                PatKind::Ident(text) => text,
                _ => Atom::NONE,
            },
            NodeData::Name(n) => self[n].text,
            NodeData::Part(Part::Label, row) => match statement(row) {
                Some(
                    StmtKind::Labeled { label, .. }
                    | StmtKind::Break(label)
                    | StmtKind::Continue(label),
                ) => label,
                _ => Atom::NONE,
            },
            NodeData::Part(Part::BindingsName, row) => match statement(row) {
                Some(StmtKind::Import(i)) => self[i].namespace,
                Some(StmtKind::ExportStar { alias, .. }) => alias,
                _ => Atom::NONE,
            },
            NodeData::Part(Part::PropertyName, row) => match self.data(row) {
                NodeData::ImportSpec(s) => self[s].imported,
                NodeData::ExportSpec(s) => self[s].local,
                _ => self.key_of(row).0.name().unwrap_or(Atom::NONE),
            },
            NodeData::Part(Part::NameLiteral, row) => {
                self.key_of(row).0.name().unwrap_or(Atom::NONE)
            }
            NodeData::Part(Part::Name, row) => match self.data(row) {
                NodeData::Expr(e) => match self[e].kind {
                    ExprKind::Dot { name, .. } | ExprKind::NewTarget(name) => name,
                    ExprKind::AsConst(_) => known::r#const,
                    ExprKind::Fn(f) => self[f].name,
                    ExprKind::Class(c) => self[c].name,
                    _ => Atom::NONE,
                },
                NodeData::Stmt(s) => match self[s].kind {
                    StmtKind::Fn(f) => self[f].name,
                    StmtKind::Class(c) => self[c].name,
                    StmtKind::Interface(i) => self[i].name,
                    StmtKind::TypeAlias(a) => self[a].name,
                    StmtKind::Enum(e) => self[e].name,
                    StmtKind::Module(m) => match self[m].name {
                        ModuleName::Ident(name) | ModuleName::String(name) => name,
                        ModuleName::Global => known::global,
                    },
                    StmtKind::ImportEquals(i) => self[i].name,
                    StmtKind::Import(i) => self[i].default,
                    StmtKind::ExportAsNamespace(name) => name,
                    _ => Atom::NONE,
                },
                NodeData::TypeParam(p) => self[p].name,
                NodeData::Type(t) => match self[t].kind {
                    TypeNodeKind::Predicate { param, .. } => param,
                    _ => Atom::NONE,
                },
                NodeData::ImportSpec(s) => self[s].local,
                NodeData::ExportSpec(s) => self[s].exported,
                NodeData::TupleElem(e) => self[e].name,
                _ if self.key_of(row).0 == PropKey::None && self.kind(node) == Kind::Identifier => {
                    known::empty
                }
                _ => self.key_of(row).0.name().unwrap_or(Atom::NONE),
            },
            _ => Atom::NONE,
        }
    }

    /// `node.Name()`
    pub fn name(&self, node: Node) -> Node {
        let named = |name: Atom| {
            if name.is_some() {
                node.with(Part::Name)
            } else {
                Node::NONE
            }
        };
        match self.data(node) {
            NodeData::Expr(e) => match self[e].kind {
                ExprKind::Dot { .. } | ExprKind::ImportMeta | ExprKind::NewTarget(_) => {
                    node.with(Part::Name)
                }
                ExprKind::Fn(f) => named(self[f].name),
                ExprKind::Class(c) => named(self[c].name),
                _ => Node::NONE,
            },
            NodeData::Stmt(s) => match self[s].kind {
                StmtKind::Fn(f) => named(self[f].name),
                StmtKind::Class(c) => named(self[c].name),
                StmtKind::Interface(_)
                | StmtKind::TypeAlias(_)
                | StmtKind::Enum(_)
                | StmtKind::Module(_)
                | StmtKind::ImportEquals(_)
                | StmtKind::ExportAsNamespace(_) => node.with(Part::Name),
                _ => Node::NONE,
            },
            NodeData::Member(m) => match self[m].kind {
                MemberKind::Property
                | MemberKind::Method
                | MemberKind::Getter
                | MemberKind::Setter => node.with(Part::Name),
                _ => Node::NONE,
            },
            // The name of `{ a }` and of `{ a = 1 }` is an expression.
            NodeData::Prop(p) if self[p].kind == PropKind::Shorthand => {
                match self.exprs.get(self[p].value.idx()).map(|e| e.kind) {
                    Some(ExprKind::Assign { target, .. }) => self.node(target),
                    _ => self.node(self[p].value),
                }
            }
            NodeData::Prop(p) if self[p].kind == PropKind::Spread => Node::NONE,
            NodeData::Prop(_) => node.with(Part::Name),
            NodeData::EnumMember(_)
            | NodeData::TypeParam(_)
            | NodeData::ImportSpec(_)
            | NodeData::ExportSpec(_) => node.with(Part::Name),
            NodeData::TupleElem(e) => named(self[e].name),
            NodeData::Param(p) => self.node(self[p].pat),
            NodeData::VarDecl(d) => self.node(self[d].pat),
            NodeData::PatProp(p) => self.node(self[p].value),
            NodeData::PatElem(e) => self.node(self[e].pat),
            NodeData::Part(Part::Qualified, row) => row,
            NodeData::Part(Part::ImportClause, row) => match self.data(row) {
                NodeData::Stmt(s) => match self[s].kind {
                    StmtKind::Import(i) if self[i].default.is_some() => row.with(Part::Name),
                    _ => Node::NONE,
                },
                _ => Node::NONE,
            },
            NodeData::Part(Part::NamedBindings | Part::ExportClause, row)
                if matches!(
                    self.kind(node),
                    Kind::NamespaceImport | Kind::NamespaceExport
                ) =>
            {
                row.with(Part::BindingsName)
            }
            _ => Node::NONE,
        }
    }

    /// `node.PropertyName()`
    pub fn property_name(&self, node: Node) -> Node {
        let exists = match self.data(node) {
            NodeData::ImportSpec(s) => self[s].imported_pos != self[s].pos,
            NodeData::ExportSpec(s) => self[s].local_pos != self[s].pos,
            // `parseObjectBindingElement`: only an identifier is a name without a property name.
            NodeData::PatProp(p) => {
                let name = &self[self[p].value];
                self[p].key != PropKey::None
                    && (self[p].key_pos != name.pos || !matches!(name.kind, PatKind::Ident(_)))
            }
            _ => false,
        };
        if exists {
            node.with(Part::PropertyName)
        } else {
            Node::NONE
        }
    }

    /// `node.ForEachChild`: the children in source order, until `visit` returns true.
    pub fn for_each_child(&self, node: Node, visit: &mut dyn FnMut(Node) -> bool) -> bool {
        self.for_each_child_with(node, true, visit)
    }

    fn for_each_child_with<V: FnMut(Node) -> bool + ?Sized>(
        &self,
        node: Node,
        with_parentheses: bool,
        visit: &mut V,
    ) -> bool {
        let mut v = Children {
            file: self,
            visit,
            with_parentheses,
        };
        v.children(self.data(node), node)
    }

    /// Computes the data that `node` and `data` read. No HIR node is added afterwards.
    pub fn finish_nodes(&mut self) {
        self.bases = self.node_bases();
        let mut fn_nodes = vec![Node::NONE; self.fns.len()];
        let mut class_nodes = vec![Node::NONE; self.classes.len()];
        for (i, statement) in self.stmts.iter().enumerate() {
            match statement.kind {
                StmtKind::Fn(f) => fn_nodes[f.idx()] = StmtId(i as u32).row(self),
                StmtKind::Class(c) => class_nodes[c.idx()] = StmtId(i as u32).row(self),
                _ => {}
            }
        }
        for (i, member) in self.members.iter().enumerate() {
            if member.func.is_some() {
                fn_nodes[member.func.idx()] = MemberId(i as u32).row(self);
            }
        }
        for (i, ty) in self.types.iter().enumerate() {
            if let TypeNodeKind::Fn(f) = ty.kind {
                fn_nodes[f.idx()] = TypeNodeId(i as u32).row(self);
            }
        }
        for i in 0..self.props.len() as u32 {
            let method = self.method_of(PropId(i));
            if method.is_some() {
                fn_nodes[method.idx()] = PropId(i).row(self);
            }
        }
        for (i, e) in self.exprs.iter().enumerate() {
            match e.kind {
                ExprKind::Fn(f) if fn_nodes[f.idx()].is_none() => {
                    fn_nodes[f.idx()] = ExprId(i as u32).row(self);
                }
                ExprKind::Class(c) => class_nodes[c.idx()] = ExprId(i as u32).row(self),
                _ => {}
            }
        }
        (self.fn_nodes, self.class_nodes) = (fn_nodes, class_nodes);
    }

    /// `node.Kind`
    pub fn kind(&self, node: Node) -> Kind {
        match self.data(node) {
            NodeData::None => Kind::Unknown,
            NodeData::File => Kind::SourceFile,
            NodeData::Part(part, row) => self.kind_of_part(part, row),
            NodeData::Expr(e) => self.kind_of_expr(e, node),
            NodeData::Stmt(s) => self.kind_of_stmt(s),
            NodeData::Type(t) => self.kind_of_type(t, node),
            NodeData::Pat(p) => match self[p].kind {
                PatKind::Missing => Kind::OmittedExpression,
                PatKind::Ident(_) => Kind::Identifier,
                PatKind::Object(_) => Kind::ObjectBindingPattern,
                PatKind::Array(_) => Kind::ArrayBindingPattern,
            },
            NodeData::PatElem(e) if matches!(self[self[e].pat].kind, PatKind::Missing) => {
                Kind::OmittedExpression
            }
            NodeData::PatProp(_) | NodeData::PatElem(_) => Kind::BindingElement,
            NodeData::Param(_) => Kind::Parameter,
            NodeData::TypeParam(_) => Kind::TypeParameter,
            NodeData::Member(m) => {
                let is_in_class = self.class_of(self.parent(node)).is_some();
                match self[m].kind {
                    MemberKind::Property if is_in_class => Kind::PropertyDeclaration,
                    MemberKind::Property => Kind::PropertySignature,
                    MemberKind::Method if is_in_class => Kind::MethodDeclaration,
                    MemberKind::Method => Kind::MethodSignature,
                    MemberKind::Getter => Kind::GetAccessor,
                    MemberKind::Setter => Kind::SetAccessor,
                    MemberKind::Constructor => Kind::Constructor,
                    MemberKind::CallSignature => Kind::CallSignature,
                    MemberKind::ConstructSignature => Kind::ConstructSignature,
                    MemberKind::IndexSignature => Kind::IndexSignature,
                    MemberKind::StaticBlock => Kind::ClassStaticBlockDeclaration,
                }
            }
            NodeData::Prop(p) => {
                let is_attribute = self[p].name_kind == NameKind::Jsx;
                match self[p].kind {
                    PropKind::Spread if is_attribute => Kind::JsxSpreadAttribute,
                    _ if is_attribute => Kind::JsxAttribute,
                    PropKind::Init
                        if !self.import_attributes.is_empty()
                            && self.kind(self.parent(node)) == Kind::ImportAttributes =>
                    {
                        Kind::ImportAttribute
                    }
                    PropKind::Init => Kind::PropertyAssignment,
                    PropKind::Shorthand => Kind::ShorthandPropertyAssignment,
                    PropKind::Spread => Kind::SpreadAssignment,
                    PropKind::Method => Kind::MethodDeclaration,
                    PropKind::Getter => Kind::GetAccessor,
                    PropKind::Setter => Kind::SetAccessor,
                }
            }
            NodeData::VarDecl(_) => Kind::VariableDeclaration,
            NodeData::Case(c) if self[c].test.is_none() => Kind::DefaultClause,
            NodeData::Case(_) => Kind::CaseClause,
            NodeData::EnumMember(_) => Kind::EnumMember,
            NodeData::ImportSpec(_) => Kind::ImportSpecifier,
            NodeData::ExportSpec(_) => Kind::ExportSpecifier,
            NodeData::TupleElem(e) if self[e].name.is_some() => Kind::NamedTupleMember,
            NodeData::TupleElem(e) if self[e].rest => Kind::RestType,
            NodeData::TupleElem(_) => Kind::OptionalType,
            NodeData::Modifier(m) => match self[m].kind {
                ModifierKind::Decorator(_) => Kind::Decorator,
                ModifierKind::Keyword(flag) => kind_of_modifier(flag),
            },
            NodeData::Name(_) => Kind::Identifier,
            NodeData::Paren(_) => Kind::ParenthesizedExpression,
        }
    }

    fn kind_of_part(&self, part: Part, row: Node) -> Kind {
        let statement = match self.data(row) {
            NodeData::Stmt(s) => Some(self[s].kind),
            _ => None,
        };
        let is_fragment = || self.kind(row) == Kind::JsxFragment;
        match part {
            Part::Name | Part::PropertyName => self.kind_of_name(part, row),
            Part::Label | Part::BindingsName | Part::Namespace | Part::LocalName => {
                Kind::Identifier
            }
            Part::NameLiteral if self.key_of(row).1 == NameKind::ComputedString => {
                Kind::StringLiteral
            }
            Part::NameLiteral => Kind::NumericLiteral,
            Part::Body => match statement {
                Some(StmtKind::Module(_)) => Kind::ModuleBlock,
                Some(StmtKind::Switch { .. }) => Kind::CaseBlock,
                _ => Kind::Block,
            },
            Part::CatchClause => Kind::CatchClause,
            Part::Extends | Part::Implements => Kind::HeritageClause,
            Part::Base => Kind::ExpressionWithTypeArguments,
            Part::DeclarationList => Kind::VariableDeclarationList,
            Part::ImportClause => Kind::ImportClause,
            Part::NamedBindings => match statement {
                Some(StmtKind::Import(i)) if self[i].namespace.is_some() => Kind::NamespaceImport,
                _ => Kind::NamedImports,
            },
            Part::ExportClause => match statement {
                Some(StmtKind::ExportNamed(_)) => Kind::NamedExports,
                _ => Kind::NamespaceExport,
            },
            Part::ModuleReference => Kind::ExternalModuleReference,
            Part::Opening if is_fragment() => Kind::JsxOpeningFragment,
            Part::Opening => Kind::JsxOpeningElement,
            Part::Closing if is_fragment() => Kind::JsxClosingFragment,
            Part::Closing => Kind::JsxClosingElement,
            Part::Attributes => Kind::JsxAttributes,
            Part::Span if matches!(self.data(row), NodeData::Type(_)) => {
                Kind::TemplateLiteralTypeSpan
            }
            Part::Span => Kind::TemplateSpan,
            Part::Head => Kind::TemplateHead,
            Part::Tail => {
                let is_last = match (self.data(row), self.data(self.parent(row.with(Part::Span)))) {
                    (NodeData::Expr(e), NodeData::Expr(template)) => matches!(self[template].kind,
                        ExprKind::Template { exprs, .. } if self.ids(exprs).next_back() == Some(e)),
                    (NodeData::Type(t), NodeData::Type(template)) => matches!(self[template].kind,
                        TypeNodeKind::Template { types, .. } if self.ids(types).next_back() == Some(t)),
                    _ => true,
                };
                if is_last {
                    Kind::TemplateTail
                } else {
                    Kind::TemplateMiddle
                }
            }
            Part::ConstType => Kind::TypeReference,
            Part::JsxExpression => Kind::JsxExpression,
            Part::Specifier => Kind::StringLiteral,
            Part::Keyword => match self.data(row) {
                NodeData::Expr(_) if self.is_deferred_import_call(row) => Kind::MetaProperty,
                NodeData::Expr(_) => Kind::ImportKeyword,
                NodeData::Type(_) => Kind::AssertsKeyword,
                _ => Kind::AwaitKeyword,
            },
            Part::Literal | Part::Operand => match self.data(row) {
                NodeData::Type(t) => match self[t].kind {
                    TypeNodeKind::Keyword(_) => Kind::NullKeyword,
                    TypeNodeKind::UniqueSymbol => Kind::SymbolKeyword,
                    TypeNodeKind::BoolLit(true) => Kind::TrueKeyword,
                    TypeNodeKind::BoolLit(false) => Kind::FalseKeyword,
                    TypeNodeKind::Template { .. } => Kind::NoSubstitutionTemplateLiteral,
                    TypeNodeKind::StringLit(_)
                        if self.text.get(self[t].pos as usize) == Some(&b'`') =>
                    {
                        Kind::NoSubstitutionTemplateLiteral
                    }
                    TypeNodeKind::StringLit(_) => Kind::StringLiteral,
                    TypeNodeKind::NumberLit(n)
                        if part == Part::Literal && self.numbers[n as usize].is_sign_negative() =>
                    {
                        Kind::PrefixUnaryExpression
                    }
                    TypeNodeKind::BigIntLit { negative: true, .. } if part == Part::Literal => {
                        Kind::PrefixUnaryExpression
                    }
                    TypeNodeKind::BigIntLit { .. } => Kind::BigIntLiteral,
                    _ => Kind::NumericLiteral,
                },
                _ => Kind::Unknown,
            },
            // The expression of an `ExpressionWithTypeArguments` is an expression.
            Part::Qualified => {
                let around =
                    self.find_ancestor(row.with(part), |n| n.part() != Some(Part::Qualified));
                match self.kind(around) {
                    Kind::ExpressionWithTypeArguments => Kind::PropertyAccessExpression,
                    _ => Kind::QualifiedName,
                }
            }
        }
    }

    fn kind_of_name(&self, part: Part, row: Node) -> Kind {
        match self.data(row) {
            NodeData::Expr(e) => match self[e].kind {
                ExprKind::Dot { name_pos, .. } if is_private_name_at(self, name_pos) => {
                    Kind::PrivateIdentifier
                }
                _ => Kind::Identifier,
            },
            NodeData::Stmt(s) => match self[s].kind {
                StmtKind::Module(m) if matches!(self[m].name, ModuleName::String(_)) => {
                    Kind::StringLiteral
                }
                _ => Kind::Identifier,
            },
            NodeData::PatProp(_) if part == Part::Name => Kind::Identifier,
            NodeData::Type(t) => match self[t].kind {
                TypeNodeKind::Predicate {
                    param: known::this, ..
                } => Kind::ThisType,
                _ => Kind::Identifier,
            },
            NodeData::Prop(p)
                if self[p].name_kind == NameKind::Jsx
                    && self.colon_of_jsx_name(self[p].pos).is_some() =>
            {
                Kind::JsxNamespacedName
            }
            // `ModuleExportName`
            NodeData::ImportSpec(_) | NodeData::ExportSpec(_) => {
                match self.text.get(self.start_of_part(part, row) as usize) {
                    Some(b'"' | b'\'') => Kind::StringLiteral,
                    _ => Kind::Identifier,
                }
            }
            _ => match self.key_of(row) {
                (PropKey::Private(_), _) => Kind::PrivateIdentifier,
                (PropKey::Computed(_), _)
                | (_, NameKind::ComputedString | NameKind::ComputedNumber) => {
                    Kind::ComputedPropertyName
                }
                (_, NameKind::StringLiteral) => Kind::StringLiteral,
                (_, NameKind::NumericLiteral) => Kind::NumericLiteral,
                // A name that declares nothing (`getDeclarationName`) is stored as no name.
                (_, NameKind::Identifier | NameKind::Jsx) => {
                    match self.text.get(self.start_of_part(part, row) as usize) {
                        Some(b'#') => Kind::PrivateIdentifier,
                        Some(b'0'..=b'9') => Kind::BigIntLiteral,
                        // Of an `ImportAttribute`.
                        Some(b'"' | b'\'') => Kind::StringLiteral,
                        _ => Kind::Identifier,
                    }
                }
            },
        }
    }

    fn kind_of_expr(&self, e: ExprId, node: Node) -> Kind {
        let parent = || self.parent(node);
        let is_in = |kind: fn(&ExprKind) -> bool| matches!(self.data(parent()), NodeData::Expr(parent) if kind(&self[parent].kind));
        match self[e].kind {
            ExprKind::Missing if is_in(|parent| matches!(parent, ExprKind::Array(_))) => {
                Kind::OmittedExpression
            }
            // `parseDecoratedExpression`: decorators before something that is not a class.
            ExprKind::Missing if self.text.get(self[e].pos as usize) == Some(&b'@') => {
                Kind::MissingDeclaration
            }
            ExprKind::Missing | ExprKind::Ident(_) => Kind::Identifier,
            // `typeof this.a` is an entity name.
            ExprKind::This if self.is_in_type_query(node) => Kind::Identifier,
            ExprKind::This => Kind::ThisKeyword,
            ExprKind::Super => Kind::SuperKeyword,
            ExprKind::Null => Kind::NullKeyword,
            ExprKind::True => Kind::TrueKeyword,
            ExprKind::False => Kind::FalseKeyword,
            ExprKind::Number(_) => Kind::NumericLiteral,
            ExprKind::String(_) if is_private_name_at(self, self[e].pos) => Kind::PrivateIdentifier,
            ExprKind::String(_) if self.is_namespaced_tag_name(e) => Kind::JsxNamespacedName,
            // The name of a tag.
            ExprKind::String(_)
                if matches!(parent().part(), Some(Part::Opening | Part::Closing)) =>
            {
                Kind::Identifier
            }
            ExprKind::String(_) => match self.data(parent()) {
                NodeData::Expr(parent) if matches!(self[parent].kind, ExprKind::Jsx(_)) => {
                    match self[parent].kind {
                        ExprKind::Jsx(j) if self[j].tag == e => Kind::Identifier,
                        _ => Kind::JsxText,
                    }
                }
                _ if self.text.get(self[e].pos as usize) == Some(&b'`') => {
                    Kind::NoSubstitutionTemplateLiteral
                }
                _ => Kind::StringLiteral,
            },
            ExprKind::BigInt(_) => Kind::BigIntLiteral,
            ExprKind::Regex => Kind::RegularExpressionLiteral,
            ExprKind::Template { exprs, .. } if exprs.is_empty() => {
                Kind::NoSubstitutionTemplateLiteral
            }
            ExprKind::Template { .. } => Kind::TemplateExpression,
            ExprKind::TaggedTemplate(_) => Kind::TaggedTemplateExpression,
            ExprKind::Array(_) => Kind::ArrayLiteralExpression,
            ExprKind::Object(_) if self.import_attributes.iter().any(|of| of.1 == e) => {
                Kind::ImportAttributes
            }
            ExprKind::Object(_) => Kind::ObjectLiteralExpression,
            ExprKind::Fn(f) if self[f].kind == FnKind::Arrow => Kind::ArrowFunction,
            ExprKind::Fn(_) => Kind::FunctionExpression,
            ExprKind::Class(_) => Kind::ClassExpression,
            ExprKind::Dot { obj, .. } if self.is_import_keyword(obj) => Kind::MetaProperty,
            ExprKind::Dot { .. } if self.is_in_type_query(self.parent(node)) => Kind::QualifiedName,
            ExprKind::Dot { .. } => Kind::PropertyAccessExpression,
            ExprKind::Index { .. } => Kind::ElementAccessExpression,
            ExprKind::Call(_) | ExprKind::ImportCall { .. } => Kind::CallExpression,
            ExprKind::New(_) => Kind::NewExpression,
            ExprKind::Unary { op, .. } => match op {
                UnOp::Typeof => Kind::TypeOfExpression,
                UnOp::Void => Kind::VoidExpression,
                UnOp::Delete => Kind::DeleteExpression,
                UnOp::PostInc | UnOp::PostDec => Kind::PostfixUnaryExpression,
                _ => Kind::PrefixUnaryExpression,
            },
            ExprKind::Binary { .. } | ExprKind::Assign { .. } => Kind::BinaryExpression,
            ExprKind::Cond { .. } => Kind::ConditionalExpression,
            ExprKind::Spread(_) => Kind::SpreadElement,
            ExprKind::Await(_) => Kind::AwaitExpression,
            ExprKind::Yield { .. } => Kind::YieldExpression,
            // `<T>e` starts before its operand, parentheses included.
            ExprKind::As { expr, .. } | ExprKind::AsConst(expr)
                if self.is_type_assertion(e, expr) =>
            {
                Kind::TypeAssertionExpression
            }
            ExprKind::As { .. } | ExprKind::AsConst(_) => Kind::AsExpression,
            ExprKind::Satisfies { .. } => Kind::SatisfiesExpression,
            ExprKind::NonNull(_) => Kind::NonNullExpression,
            ExprKind::Instantiation { .. } => Kind::ExpressionWithTypeArguments,
            ExprKind::Jsx(j) if self[j].tag.is_none() => Kind::JsxFragment,
            ExprKind::Jsx(j) if self.is_self_closing(j) => Kind::JsxSelfClosingElement,
            ExprKind::Jsx(_) => Kind::JsxElement,
            ExprKind::ImportMeta | ExprKind::NewTarget(_) => Kind::MetaProperty,
        }
    }

    fn kind_of_stmt(&self, s: StmtId) -> Kind {
        match self[s].kind {
            StmtKind::Empty => Kind::EmptyStatement,
            StmtKind::Debugger => Kind::DebuggerStatement,
            StmtKind::Expr(_) => Kind::ExpressionStatement,
            StmtKind::Var(_) => Kind::VariableStatement,
            StmtKind::Fn(_) => Kind::FunctionDeclaration,
            StmtKind::Class(_) => Kind::ClassDeclaration,
            StmtKind::Interface(_) => Kind::InterfaceDeclaration,
            StmtKind::TypeAlias(a) if self[a].flags.contains(Flags::REPARSED) => {
                Kind::JSTypeAliasDeclaration
            }
            StmtKind::TypeAlias(_) => Kind::TypeAliasDeclaration,
            StmtKind::Enum(_) => Kind::EnumDeclaration,
            StmtKind::Module(_) => Kind::ModuleDeclaration,
            StmtKind::Return(_) => Kind::ReturnStatement,
            StmtKind::If { .. } => Kind::IfStatement,
            StmtKind::For { .. } => Kind::ForStatement,
            StmtKind::ForIn { .. } => Kind::ForInStatement,
            StmtKind::ForOf { .. } => Kind::ForOfStatement,
            StmtKind::While { .. } => Kind::WhileStatement,
            StmtKind::DoWhile { .. } => Kind::DoStatement,
            StmtKind::Block(_) if self.is_with_statement(s) => Kind::WithStatement,
            StmtKind::Block(_) => Kind::Block,
            StmtKind::Switch { .. } => Kind::SwitchStatement,
            StmtKind::Try { .. } => Kind::TryStatement,
            StmtKind::Throw(_) => Kind::ThrowStatement,
            StmtKind::Break(_) => Kind::BreakStatement,
            StmtKind::Continue(_) => Kind::ContinueStatement,
            StmtKind::Labeled { .. } => Kind::LabeledStatement,
            StmtKind::Import(_) => Kind::ImportDeclaration,
            StmtKind::ImportEquals(_) => Kind::ImportEqualsDeclaration,
            StmtKind::ExportNamed(_) | StmtKind::ExportStar { .. } => Kind::ExportDeclaration,
            // `parseJSONText`
            StmtKind::ExportAssign(_) if self.kind == FileKind::Json => Kind::ExpressionStatement,
            StmtKind::ExportDefault(_) | StmtKind::ExportAssign(_) => Kind::ExportAssignment,
            StmtKind::ExportAsNamespace(_) => Kind::NamespaceExportDeclaration,
        }
    }

    fn kind_of_type(&self, t: TypeNodeId, node: Node) -> Kind {
        match self[t].kind {
            TypeNodeKind::Error => Kind::Unknown,
            TypeNodeKind::Heritage(_) => Kind::ExpressionWithTypeArguments,
            TypeNodeKind::Keyword(keyword) => match keyword {
                Keyword::Any => Kind::AnyKeyword,
                Keyword::Unknown => Kind::UnknownKeyword,
                Keyword::Never => Kind::NeverKeyword,
                Keyword::Void => Kind::VoidKeyword,
                Keyword::Undefined => Kind::UndefinedKeyword,
                Keyword::Null => Kind::LiteralType,
                Keyword::String => Kind::StringKeyword,
                Keyword::Number => Kind::NumberKeyword,
                Keyword::Boolean => Kind::BooleanKeyword,
                Keyword::BigInt => Kind::BigIntKeyword,
                Keyword::Symbol => Kind::SymbolKeyword,
                Keyword::Object => Kind::ObjectKeyword,
                Keyword::This => Kind::ThisType,
                Keyword::Intrinsic => Kind::IntrinsicKeyword,
            },
            // An element of a heritage clause has the same syntax as a type reference.
            TypeNodeKind::Ref { .. }
                if matches!(
                    self.parent(node).part(),
                    Some(Part::Extends | Part::Implements)
                ) =>
            {
                Kind::ExpressionWithTypeArguments
            }
            TypeNodeKind::Ref { .. } => Kind::TypeReference,
            TypeNodeKind::StringLit(_)
            | TypeNodeKind::NumberLit(_)
            | TypeNodeKind::BigIntLit { .. }
            | TypeNodeKind::BoolLit(_) => Kind::LiteralType,
            TypeNodeKind::Template { types, .. } if types.is_empty() => Kind::LiteralType,
            TypeNodeKind::Template { .. } => Kind::TemplateLiteralType,
            TypeNodeKind::Array(_) => Kind::ArrayType,
            TypeNodeKind::Tuple(_) => Kind::TupleType,
            TypeNodeKind::Union(_) => Kind::UnionType,
            TypeNodeKind::Intersection(_) => Kind::IntersectionType,
            TypeNodeKind::Fn(f) if self[f].kind == FnKind::ConstructorType => Kind::ConstructorType,
            TypeNodeKind::Fn(_) => Kind::FunctionType,
            TypeNodeKind::Object(_) => Kind::TypeLiteral,
            TypeNodeKind::Cond { .. } => Kind::ConditionalType,
            TypeNodeKind::Infer(_) => Kind::InferType,
            TypeNodeKind::Mapped(_) => Kind::MappedType,
            TypeNodeKind::IndexedAccess { .. } => Kind::IndexedAccessType,
            TypeNodeKind::Keyof(_) | TypeNodeKind::Readonly(_) | TypeNodeKind::UniqueSymbol => {
                Kind::TypeOperator
            }
            TypeNodeKind::JSDoc { is_nullable, .. } if is_nullable => Kind::JSDocNullableType,
            TypeNodeKind::JSDoc { .. } => Kind::JSDocNonNullableType,
            TypeNodeKind::Typeof { .. } => Kind::TypeQuery,
            TypeNodeKind::Import { .. } => Kind::ImportType,
            TypeNodeKind::Predicate { .. } => Kind::TypePredicate,
        }
    }

    /// `GetTokenPosOfNode`: the position of its first token.
    pub fn start(&self, node: Node) -> u32 {
        match self.data(node) {
            NodeData::None | NodeData::File => 0,
            NodeData::Part(part, row) => self.start_of_part(part, row),
            NodeData::Expr(e) => start_inside_parentheses(self, e),
            NodeData::Stmt(s) => self[s].start,
            NodeData::Type(t) => self[t].pos,
            NodeData::Pat(p) => self[p].pos,
            NodeData::PatProp(p) => self[p].pos,
            NodeData::PatElem(e) => self[e].start,
            NodeData::Param(p) => self[p].pos,
            NodeData::TypeParam(p) => self[p].start,
            NodeData::Member(m) => self[m].start,
            NodeData::Prop(p) => self[p].start,
            NodeData::VarDecl(d) => self[self[d].pat].pos,
            NodeData::Case(c) => self[c].pos,
            NodeData::EnumMember(m) => self[m].pos,
            NodeData::ImportSpec(s) => self[s].start,
            NodeData::ExportSpec(s) => self[s].start,
            NodeData::TupleElem(e) => self[e].start,
            NodeData::Modifier(m) => self[m].pos,
            NodeData::Name(n) => self[n].pos(),
            NodeData::Paren(p) => self.parens[p.idx()].1,
        }
    }

    /// 0: the HIR does not record it.
    /// `SkipTrivia`. 0 without the source text.
    fn token_after(&self, end: u32) -> u32 {
        match self.text.is_empty() {
            true => 0,
            false => skip_trivia(&self.text, end as usize) as u32,
        }
    }

    /// The start of the name of a `MetaProperty` whose keyword ends at `end`. 0 if there is no dot.
    fn token_after_dot(&self, end: u32) -> u32 {
        let dot = self.token_after(end);
        match self.text.get(dot as usize) {
            Some(b'.') => self.token_after(dot + 1),
            _ => 0,
        }
    }

    /// The start of a part that begins with a token the HIR does not store, which directly precedes
    /// its first child. 0 if it has no child, or if something else precedes it.
    fn start_of_token_before_first_child(&self, node: Node, written: &[u8]) -> u32 {
        let mut first = Node::NONE;
        self.for_each_child(node, &mut |child| {
            first = child;
            true
        });
        match self.start(first) {
            0 => 0,
            start => start_of_token_before(&self.text, start, written).unwrap_or(0),
        }
    }

    fn start_of_part(&self, part: Part, row: Node) -> u32 {
        let is_property_name = part == Part::PropertyName;
        match (part, self.data(row)) {
            (Part::Span, _) => self.start(row),
            (Part::Literal | Part::Head, NodeData::Type(t))
                if !matches!(self[t].kind, TypeNodeKind::UniqueSymbol) =>
            {
                self[t].pos
            }
            (Part::Head | Part::Keyword, NodeData::Expr(e)) => self[e].pos,
            (Part::Keyword, NodeData::Type(t)) => self[t].pos,
            (Part::Namespace, _) => self.start(self.parent_of_part(row.with(part))),
            (Part::LocalName, _) => {
                let colon = self.colon_of_jsx_name(self.start(row.with(Part::Namespace)));
                colon.map_or(0, |colon| self.token_after(colon + 1))
            }
            (Part::Qualified, NodeData::Name(mut first)) => {
                while self[first].is_qualified() {
                    first = NameId(first.0 - 1);
                }
                self[first].pos()
            }
            (Part::Base, _) => self.start(self.child(self[self.class_of(row)].extends)),
            (Part::Body, _) if self.function_of(row).is_some() => {
                let function = self.function_of(row);
                let bodies = &self.body_starts;
                match bodies.binary_search_by_key(&function.0, |body| body.0.0) {
                    Ok(at) => bodies[at].1,
                    Err(_) if self[function].kind == FnKind::StaticBlock => self[function].anchor,
                    Err(_) => 0,
                }
            }
            (Part::Body, _) => self.start_of_token_before_first_child(row.with(part), b"{"),
            (Part::Extends, _) => {
                self.start_of_token_before_first_child(row.with(part), b"extends")
            }
            (Part::Implements, _) => {
                self.start_of_token_before_first_child(row.with(part), b"implements")
            }
            (Part::NameLiteral, NodeData::PatProp(p)) => self.token_after(self[p].key_pos + 1),
            (Part::NameLiteral, _) => self.token_after(self.start(row.with(Part::Name)) + 1),
            (Part::Operand, NodeData::Type(t)) => self.token_after(self[t].pos + 1),
            // `<const>x`, `x as const`. 0: it is reparsed from `@type {const}`.
            (Part::ConstType | Part::Name, NodeData::Expr(e))
                if matches!(self[e].kind, ExprKind::AsConst(_)) =>
            {
                let start = match self[e].kind {
                    ExprKind::AsConst(operand) if self.is_type_assertion(e, operand) => {
                        self.token_after(self[e].pos + 1)
                    }
                    _ => self[e].end.saturating_sub(b"const".len() as u32),
                };
                let rest = self.text.get(start as usize..).unwrap_or_default();
                if rest.starts_with(b"const") { start } else { 0 }
            }
            (Part::Name, NodeData::Expr(e)) => match self[e].kind {
                ExprKind::Dot { name_pos, .. } => name_pos,
                ExprKind::ImportMeta | ExprKind::ImportCall { .. } => {
                    self.token_after_dot(self[e].pos + b"import".len() as u32)
                }
                ExprKind::NewTarget(_) => self.token_after_dot(self[e].pos + b"new".len() as u32),
                ExprKind::Fn(f) => self[f].name_pos,
                ExprKind::Class(c) => self[c].name_pos,
                _ => 0,
            },
            (_, NodeData::Stmt(s)) => match (part, self[s].kind) {
                (Part::Name, StmtKind::Fn(f)) => self[f].name_pos,
                (Part::Name, StmtKind::Class(c)) => self[c].name_pos,
                (Part::Name, StmtKind::Interface(i)) => self[i].name_pos,
                (Part::Name, StmtKind::TypeAlias(a)) => self[a].name_pos,
                (Part::Name, StmtKind::Enum(e)) => self[e].name_pos,
                (Part::Name, StmtKind::Module(m)) => self[m].name_pos,
                (Part::Name, StmtKind::ImportEquals(i)) => self[i].name_pos,
                (Part::Name, StmtKind::Import(i)) => self[i].default_pos,
                // `export as namespace N`
                (Part::Name, StmtKind::ExportAsNamespace(_)) => (0..self[s].modifiers.len() + 3)
                    .fold(self[s].start, |at, _| {
                        let rest = self.text.get(at as usize..).unwrap_or_default();
                        let word = rest.iter().take_while(|b| b.is_ascii_alphabetic()).count();
                        self.token_after(at + word as u32)
                    }),
                (Part::ImportClause, StmtKind::Import(i)) => self[i].clause_start,
                (Part::NamedBindings, StmtKind::Import(i)) if self[i].namespace.is_some() => {
                    self[i].namespace_start
                }
                (Part::BindingsName, StmtKind::Import(i)) => self[i].namespace_pos,
                (Part::ExportClause, StmtKind::ExportStar { star_pos, .. }) => star_pos,
                (Part::BindingsName, StmtKind::ExportStar { alias_pos, .. }) => alias_pos,
                (Part::NamedBindings | Part::ExportClause, _) => {
                    self.start_of_token_before_first_child(row.with(part), b"{")
                }
                (Part::DeclarationList, StmtKind::Var(declarations)) => {
                    let list = row.with(part);
                    match declarations.iter().next().map(|first| self[first].kind) {
                        None => 0,
                        Some(VarKind::Var) => self.start_of_token_before_first_child(list, b"var"),
                        Some(VarKind::Let) => self.start_of_token_before_first_child(list, b"let"),
                        Some(VarKind::Const) => {
                            self.start_of_token_before_first_child(list, b"const")
                        }
                        Some(VarKind::Using) => {
                            self.start_of_token_before_first_child(list, b"using")
                        }
                        Some(VarKind::AwaitUsing) => {
                            let using = self.start_of_token_before_first_child(list, b"using");
                            start_of_token_before(&self.text, using, b"await").unwrap_or(0)
                        }
                    }
                }
                (Part::CatchClause, StmtKind::Try { block, .. }) => {
                    self.token_after(self[block].loc.end)
                }
                (Part::Label, StmtKind::Labeled { .. }) => self[s].start,
                (Part::Label, StmtKind::Break(_)) => {
                    self.token_after(self[s].start + b"break".len() as u32)
                }
                (Part::Label, StmtKind::Continue(_)) => {
                    self.token_after(self[s].start + b"continue".len() as u32)
                }
                _ => 0,
            },
            (Part::Name, NodeData::Member(m)) => self[m].name_pos,
            (Part::Name, NodeData::Prop(p)) => self[p].pos,
            (Part::PropertyName, NodeData::PatProp(p)) => self[p].key_pos,
            (Part::Name, NodeData::EnumMember(m)) => self[m].pos,
            (Part::Name, NodeData::TypeParam(p)) => self[p].pos,
            (Part::Name, NodeData::TupleElem(e)) if self[e].rest => {
                self.token_after(self[e].start + b"...".len() as u32)
            }
            (Part::Name, NodeData::TupleElem(e)) => self[e].start,
            (Part::Name, NodeData::Type(t)) => match self[t].kind {
                TypeNodeKind::Predicate { asserts: true, .. } => {
                    self.token_after(self[t].pos + b"asserts".len() as u32)
                }
                _ => self[t].pos,
            },
            (_, NodeData::ImportSpec(s)) if is_property_name => self[s].imported_pos,
            (_, NodeData::ImportSpec(s)) => self[s].pos,
            (_, NodeData::ExportSpec(s)) if is_property_name => self[s].local_pos,
            (_, NodeData::ExportSpec(s)) => self[s].pos,
            _ => 0,
        }
    }
}

// ───────────────────────────── ast.go: accessors ─────────────────────────────

impl File {
    /// The node that represents the expression `e` in its parent.
    #[inline]
    pub fn child(&self, e: ExprId) -> Node {
        e.to_child(self)
    }

    /// `node.Expression()`
    pub fn expression(&self, node: Node) -> Node {
        match self.data(node) {
            NodeData::Expr(e) => match self[e].kind {
                ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => self.child(obj),
                ExprKind::Call(c) | ExprKind::New(c) => self.child(self[c].callee),
                ExprKind::Unary { operand: e, .. }
                | ExprKind::Spread(e)
                | ExprKind::Await(e)
                | ExprKind::AsConst(e)
                | ExprKind::NonNull(e)
                | ExprKind::Yield { value: e, .. }
                | ExprKind::As { expr: e, .. }
                | ExprKind::Satisfies { expr: e, .. }
                | ExprKind::Instantiation { expr: e, .. } => self.child(e),
                _ => Node::NONE,
            },
            NodeData::Stmt(s) => match self[s].kind {
                StmtKind::Expr(e)
                | StmtKind::Return(e)
                | StmtKind::Throw(e)
                | StmtKind::ExportDefault(e)
                | StmtKind::ExportAssign(e)
                | StmtKind::If { test: e, .. }
                | StmtKind::While { test: e, .. }
                | StmtKind::DoWhile { test: e, .. }
                | StmtKind::ForIn { expr: e, .. }
                | StmtKind::ForOf { expr: e, .. }
                | StmtKind::Switch { expr: e, .. } => self.child(e),
                StmtKind::Block(statements) if self.is_with_statement(s) => {
                    self.expression(self.node(self.id_at(statements, 0)))
                }
                _ => Node::NONE,
            },
            NodeData::Type(t) => match self[t].kind {
                TypeNodeKind::Heritage(e) => self.child(e),
                _ => Node::NONE,
            },
            NodeData::Case(c) => self.child(self[c].test),
            NodeData::Prop(p) if self[p].kind == PropKind::Spread => self.child(self[p].value),
            NodeData::Modifier(m) => match self[m].kind {
                ModifierKind::Decorator(e) => self.child(e),
                ModifierKind::Keyword(_) => Node::NONE,
            },
            // Their content: the next level of parentheses, or the expression.
            NodeData::Paren(p) => match (self.parens[p.idx()].0, p.0.checked_sub(1)) {
                (e, Some(inner)) if self.parens[inner as usize].0 == e => ParenId(inner).row(self),
                (e, _) => self.node(e),
            },
            NodeData::Part(Part::Span, row) => match self.data(row) {
                NodeData::Expr(e) => self.child(e),
                _ => Node::NONE,
            },
            NodeData::Part(Part::Base, row) => self.child(self[self.class_of(row)].extends),
            NodeData::Part(Part::Name | Part::PropertyName, row) => match self.key_of(row) {
                (PropKey::Computed(e), _) => self.child(e),
                (_, NameKind::ComputedString | NameKind::ComputedNumber) => {
                    row.with(Part::NameLiteral)
                }
                _ => Node::NONE,
            },
            _ => Node::NONE,
        }
    }

    /// `node.Initializer()`
    pub fn initializer(&self, node: Node) -> Node {
        match self.data(node) {
            NodeData::VarDecl(d) => self.child(self[d].init),
            NodeData::Param(p) => self.child(self[p].default),
            NodeData::PatProp(p) => self.child(self[p].default),
            NodeData::PatElem(e) => self.child(self[e].default),
            NodeData::Member(m) => self.child(self[m].init),
            NodeData::EnumMember(m) => self.child(self[m].init),
            NodeData::Prop(p) if self[p].kind == PropKind::Init => self.child(self[p].value),
            _ => Node::NONE,
        }
    }

    /// `node.Type()`
    pub fn type_node(&self, node: Node) -> Node {
        if let Some(function) = self.fns.get(self.function_of(node).idx()) {
            return self.node(function.ret);
        }
        self.node(match self.data(node) {
            NodeData::VarDecl(d) => self[d].ty,
            NodeData::Param(p) => self[p].ty,
            NodeData::Member(m) => self[m].ty,
            NodeData::TupleElem(e) => self[e].ty,
            NodeData::Stmt(s) => match self[s].kind {
                StmtKind::TypeAlias(a) => self[a].ty,
                _ => TypeNodeId::NONE,
            },
            NodeData::Expr(e) => match self[e].kind {
                ExprKind::As { ty, .. } | ExprKind::Satisfies { ty, .. } => ty,
                _ => TypeNodeId::NONE,
            },
            NodeData::Type(t) => match self[t].kind {
                TypeNodeKind::Keyof(ty)
                | TypeNodeKind::Readonly(ty)
                | TypeNodeKind::JSDoc { ty, .. }
                | TypeNodeKind::Predicate { ty, .. } => ty,
                TypeNodeKind::Mapped(m) => self[m].ty,
                _ => TypeNodeId::NONE,
            },
            _ => TypeNodeId::NONE,
        })
    }

    /// `node.Body()`
    pub fn body(&self, node: Node) -> Node {
        match self.fns.get(self.function_of(node).idx()).map(|f| f.body) {
            Some(FnBody::Block(_)) => node.with(Part::Body),
            Some(FnBody::Expr(e)) => self.child(e),
            Some(FnBody::None) => Node::NONE,
            None => match self.data(node) {
                NodeData::Stmt(s) => match self[s].kind {
                    StmtKind::Module(m) => match self.nested_namespace(m) {
                        Some(nested) => self.node(nested),
                        None if self[m].has_body => node.with(Part::Body),
                        None => Node::NONE,
                    },
                    _ => Node::NONE,
                },
                _ => Node::NONE,
            },
        }
    }

    /// `node.ModifierFlags()`, plus the other [`Flags`] of a declaration.
    pub fn flags(&self, node: Node) -> Flags {
        match self.data(node) {
            NodeData::Expr(e) => match self[e].kind {
                ExprKind::Fn(f) => self[f].flags,
                ExprKind::Class(c) => self[c].flags,
                _ => Flags::empty(),
            },
            NodeData::Type(_) | NodeData::Prop(_) => {
                let function = self.fns.get(self.function_of(node).idx());
                function.map_or(Flags::empty(), |function| function.flags)
            }
            NodeData::Stmt(s) => match self[s].kind {
                StmtKind::Var(declarations) => declarations
                    .iter()
                    .next()
                    .map_or(Flags::empty(), |d| self[d].flags),
                StmtKind::Fn(f) => self[f].flags,
                StmtKind::Class(c) => self[c].flags,
                StmtKind::Interface(i) => self[i].flags,
                StmtKind::TypeAlias(a) => self[a].flags,
                StmtKind::Enum(e) => self[e].flags,
                StmtKind::Module(m) => self[m].flags,
                StmtKind::ImportEquals(i) => self[i].flags,
                _ => Flags::empty(),
            },
            NodeData::VarDecl(d) => self[d].flags,
            NodeData::Param(p) => self[p].flags,
            NodeData::TypeParam(p) => self[p].flags,
            NodeData::Member(m) => self[m].flags,
            _ => Flags::empty(),
        }
    }
}

/// Ranges of a file, for answering by position a question that would otherwise require walking up
/// the parents.
pub struct Places(Vec<TextRange>);

impl Places {
    /// Nested or overlapping ranges are merged.
    pub fn new(ranges: impl Iterator<Item = TextRange>) -> Places {
        let mut ranges: Vec<TextRange> = ranges.collect();
        ranges.sort_unstable_by_key(|range| range.pos);
        ranges.dedup_by(|next, kept| {
            let is_in_it = next.pos < kept.end;
            kept.end = if is_in_it {
                kept.end.max(next.end)
            } else {
                kept.end
            };
            is_in_it
        });
        Places(ranges)
    }

    pub fn contain(&self, pos: u32) -> bool {
        let after = self.0.partition_point(|range| range.pos <= pos);
        after > 0 && pos < self.0[after - 1].end
    }
}

// ───────────────────────────── ast/utilities.go ─────────────────────────────

impl Kind {
    /// `IsClassElement`
    pub fn is_class_element(self) -> bool {
        use Kind::*;
        matches!(
            self,
            Constructor
                | PropertyDeclaration
                | MethodDeclaration
                | GetAccessor
                | SetAccessor
                | IndexSignature
                | ClassStaticBlockDeclaration
                | SemicolonClassElement
        )
    }

    /// `IsAccessExpression`
    pub fn is_access_expression(self) -> bool {
        matches!(
            self,
            Kind::PropertyAccessExpression | Kind::ElementAccessExpression
        )
    }
}

impl File {
    /// `FindAncestorKind`
    pub fn find_ancestor_kind(&self, node: Node, kind: Kind) -> Node {
        self.find_ancestor(node, |n| self.kind(n) == kind)
    }

    /// `FindAncestorOrQuit`. `Break(true)`: `FindAncestorTrue`. `Break(false)`: `FindAncestorQuit`.
    pub fn find_ancestor_or_quit(
        &self,
        mut node: Node,
        mut callback: impl FnMut(Node) -> ControlFlow<bool>,
    ) -> Node {
        while node.is_some() {
            match callback(node) {
                ControlFlow::Break(true) => return node,
                ControlFlow::Break(false) => return Node::NONE,
                ControlFlow::Continue(()) => node = self.parent(node),
            }
        }
        Node::NONE
    }

    /// Every `Identifier` whose text is one of `Atom::is_keyword_identifier`, in source order,
    /// except those for which `is_identifier_name` is true, of which only some are included.
    pub fn keyword_identifiers(&self) -> &[Node] {
        self.keyword_identifiers.get_or_init(|| {
            let mut found = Vec::new();
            for &pos in self.keyword_identifier_positions.iter() {
                // Descends from the file, at each level into the last child that does not start
                // after `pos`.
                let mut node = Node::FILE;
                while node.is_some() {
                    let (mut inside, mut starts) = (Node::NONE, 0);
                    self.for_each_child(node, &mut |child| {
                        if self.text(child).is_keyword_identifier()
                            && self.kind(child) == Kind::Identifier
                        {
                            found.push(child);
                        }
                        let start = self.start(child);
                        if (starts..=pos).contains(&start) {
                            (inside, starts) = (child, start);
                        }
                        false
                    });
                    node = inside;
                }
            }
            found.sort_unstable_by_key(|&node| (self.start(node), node));
            found.dedup();
            found.into()
        })
    }

    /// `FindUseStrictPrologue`
    pub fn find_use_strict_prologue(&self, statements: IdList<StmtId>) -> StmtId {
        for statement in self.ids(statements) {
            // `IsPrologueDirective`
            let expression = self.expression(self.node(statement));
            if self.kind(expression) != Kind::StringLiteral {
                break;
            }
            // `IsUseStrictPrologue`
            let start = self.start(expression) as usize;
            if let Some(b"\"use strict\"" | b"'use strict'") = self.text.get(start..start + 12) {
                return statement;
            }
        }
        StmtId::NONE
    }

    /// `NodeIsMissing`: an identifier the parser synthesized where it found none.
    pub fn is_missing(&self, node: Node) -> bool {
        self.kind(node) == Kind::Identifier
            && match self.data(node) {
                NodeData::Expr(e) => {
                    matches!(
                        self[e].kind,
                        ExprKind::Missing | ExprKind::Ident(known::empty)
                    )
                }
                NodeData::Part(Part::LocalName, _) => {
                    let start = self.start(node) as usize;
                    jsx_identifier_end(&self.text, start) == start
                }
                _ => self.text(node) == known::empty,
            }
    }

    /// `IsExpressionNode`
    #[rustfmt::skip]
    pub fn is_expression_node(&self, mut node: Node) -> bool {
        use Kind::*;
        match self.kind(node) {
            SuperKeyword | NullKeyword | TrueKeyword | FalseKeyword | RegularExpressionLiteral
            | ArrayLiteralExpression | ObjectLiteralExpression | PropertyAccessExpression
            | ElementAccessExpression | CallExpression | NewExpression | TaggedTemplateExpression
            | AsExpression | TypeAssertionExpression | SatisfiesExpression | NonNullExpression
            | ParenthesizedExpression | FunctionExpression | ClassExpression | ArrowFunction
            | VoidExpression | DeleteExpression | TypeOfExpression | PrefixUnaryExpression
            | PostfixUnaryExpression | BinaryExpression | ConditionalExpression | SpreadElement
            | TemplateExpression | OmittedExpression | JsxElement | JsxSelfClosingElement | JsxFragment
            | YieldExpression | AwaitExpression => true,
            // "`import.defer` in `import.defer(...)` is not an expression"
            MetaProperty => node.part() != Some(Part::Keyword),
            ExpressionWithTypeArguments => self.kind(self.parent(node)) != HeritageClause,
            QualifiedName => {
                while self.kind(self.parent(node)) == QualifiedName {
                    node = self.parent(node);
                }
                self.kind(self.parent(node)) == TypeQuery || self.is_jsx_tag_name(node)
            }
            PrivateIdentifier => matches!(self.data(self.parent(node)), NodeData::Expr(parent)
                if matches!(self[parent].kind, ExprKind::Binary { op: BinOp::In, left, .. } if self.child(left) == node)),
            Identifier if self.kind(self.parent(node)) == TypeQuery || self.is_jsx_tag_name(node) => true,
            Identifier | NumericLiteral | BigIntLiteral | StringLiteral | NoSubstitutionTemplateLiteral
            | ThisKeyword => self.is_in_expression_context(node),
            _ => false,
        }
    }

    /// `IsJsxTagName`
    pub fn is_jsx_tag_name(&self, node: Node) -> bool {
        let parent = self.parent(node);
        let mut first = Node::NONE;
        matches!(
            self.kind(parent),
            Kind::JsxOpeningElement | Kind::JsxClosingElement | Kind::JsxSelfClosingElement
        ) && {
            self.for_each_child(parent, &mut |child| {
                first = child;
                true
            });
            first == node
        }
    }

    /// `IsInExpressionContext`
    #[rustfmt::skip]
    pub fn is_in_expression_context(&self, node: Node) -> bool {
        use Kind::*;
        let parent = self.parent(node);
        match self.kind(parent) {
            VariableDeclaration | Parameter | PropertyDeclaration | PropertySignature | EnumMember
            | PropertyAssignment | BindingElement => self.initializer(parent) == node,
            ExpressionStatement | IfStatement | DoStatement | WhileStatement | ReturnStatement
            | WithStatement | SwitchStatement | CaseClause | DefaultClause | ThrowStatement
            | TypeAssertionExpression | AsExpression | TemplateSpan | ComputedPropertyName
            | SatisfiesExpression => self.expression(parent) == node,
            // Everything in the head except a `VariableDeclarationList`.
            ForStatement | ForInStatement | ForOfStatement => {
                matches!(self.data(node), NodeData::Expr(_) | NodeData::Paren(_))
            }
            Decorator | JsxExpression | JsxSpreadAttribute | SpreadAssignment => true,
            ExpressionWithTypeArguments => {
                self.expression(parent) == node
                    && !self.is_part_of_type_expression_with_type_arguments(parent)
            }
            ShorthandPropertyAssignment => self.name(parent) != node,
            _ => self.is_expression_node(parent),
        }
    }

    /// `isPartOfTypeExpressionWithTypeArguments`
    fn is_part_of_type_expression_with_type_arguments(&self, node: Node) -> bool {
        let parent = self.parent(node);
        self.kind(parent) == Kind::HeritageClause
            && (!self.kind(self.parent(parent)).is_class_like()
                || parent.part() == Some(Part::Implements))
    }

    /// `IsDeclarationName`
    pub fn is_declaration_name(&self, name: Node) -> bool {
        let parent = self.parent(name);
        !matches!(
            self.kind(name),
            Kind::SourceFile | Kind::ObjectBindingPattern | Kind::ArrayBindingPattern
        ) && self.kind(parent).is_declaration()
            && self.name(parent) == name
    }

    /// `IsIdentifierName`
    pub fn is_identifier_name(&self, node: Node) -> bool {
        let parent = self.parent(node);
        match self.kind(parent) {
            Kind::PropertyDeclaration
            | Kind::PropertySignature
            | Kind::MethodDeclaration
            | Kind::MethodSignature
            | Kind::GetAccessor
            | Kind::SetAccessor
            | Kind::EnumMember
            | Kind::PropertyAssignment
            | Kind::PropertyAccessExpression
            | Kind::QualifiedName => self.name(parent) == node,
            Kind::BindingElement | Kind::ImportSpecifier => self.property_name(parent) == node,
            Kind::ExportSpecifier
            | Kind::JsxAttribute
            | Kind::JsxSelfClosingElement
            | Kind::JsxOpeningElement
            | Kind::JsxClosingElement => true,
            _ => false,
        }
    }

    /// `GetContainingClass`
    pub fn get_containing_class(&self, node: Node) -> Node {
        self.find_ancestor(self.parent(node), |n| self.kind(n).is_class_like())
    }

    /// `getContainingClassExcludingClassDecorators`
    pub fn get_containing_class_excluding_class_decorators(&self, node: Node) -> Node {
        let decorator = self.find_ancestor_or_quit(self.parent(node), |n| match self.kind(n) {
            kind if kind.is_class_like() => ControlFlow::Break(false),
            Kind::Decorator => ControlFlow::Break(true),
            _ => ControlFlow::Continue(()),
        });
        if decorator.is_none() {
            self.get_containing_class(node)
        } else if self.kind(self.parent(decorator)).is_class_like() {
            self.get_containing_class(self.parent(decorator))
        } else {
            self.get_containing_class(decorator)
        }
    }

    /// `GetContainingFunction`
    pub fn get_containing_function(&self, node: Node) -> Node {
        self.find_ancestor(self.parent(node), |n| self.kind(n).is_function_like())
    }

    /// `getContainingFunctionOrClassStaticBlock`
    pub fn get_containing_function_or_class_static_block(&self, node: Node) -> Node {
        self.find_ancestor(self.parent(node), |n| {
            let kind = self.kind(n);
            kind.is_function_like() || kind == Kind::ClassStaticBlockDeclaration
        })
    }

    /// `GetEnclosingBlockScopeContainer`
    pub fn get_enclosing_block_scope_container(&self, node: Node) -> Node {
        self.find_ancestor(self.parent(node), |current| self.is_block_scope(current))
    }

    /// `IsBlockScope(node, node.Parent)`
    pub fn is_block_scope(&self, node: Node) -> bool {
        use Kind::*;
        match self.kind(node) {
            SourceFile
            | CaseBlock
            | CatchClause
            | ModuleDeclaration
            | ForStatement
            | ForInStatement
            | ForOfStatement
            | Constructor
            | MethodDeclaration
            | GetAccessor
            | SetAccessor
            | FunctionDeclaration
            | FunctionExpression
            | ArrowFunction
            | PropertyDeclaration
            | ClassStaticBlockDeclaration => true,
            // `IsFunctionLikeOrClassStaticBlockDeclaration`
            Block => {
                let parent = self.kind(self.parent(node));
                !parent.is_function_like() && parent != ClassStaticBlockDeclaration
            }
            _ => false,
        }
    }

    /// `GetThisContainer`
    pub fn get_this_container(
        &self,
        node: Node,
        include_arrow_functions: bool,
        include_class_computed_property_name: bool,
    ) -> Node {
        self.this_container_from(
            self.parent(node),
            include_arrow_functions,
            include_class_computed_property_name,
        )
    }

    /// The same, for a direct child of `node`.
    pub fn this_container_from(
        &self,
        mut node: Node,
        include_arrow_functions: bool,
        include_class_computed_property_name: bool,
    ) -> Node {
        use Kind::*;
        loop {
            match self.kind(node) {
                Unknown => return Node::NONE,
                ComputedPropertyName => {
                    let class = self.parent(self.parent(node));
                    if include_class_computed_property_name && self.kind(class).is_class_like() {
                        return node;
                    }
                    node = class;
                }
                Decorator => {
                    let parent = self.parent(node);
                    if self.kind(parent) == Parameter
                        && self.kind(self.parent(parent)).is_class_element()
                    {
                        node = self.parent(parent);
                    } else if self.kind(parent).is_class_element() {
                        node = parent;
                    }
                }
                ArrowFunction if include_arrow_functions => return node,
                FunctionDeclaration
                | FunctionExpression
                | ModuleDeclaration
                | ClassStaticBlockDeclaration
                | PropertyDeclaration
                | PropertySignature
                | MethodDeclaration
                | MethodSignature
                | Constructor
                | GetAccessor
                | SetAccessor
                | CallSignature
                | ConstructSignature
                | IndexSignature
                | EnumDeclaration
                | SourceFile => return node,
                _ => {}
            }
            node = self.parent(node);
        }
    }

    /// `GetNewTargetContainer`
    pub fn get_new_target_container(&self, node: Node) -> Node {
        let container = self.get_this_container(node, false, false);
        match self.kind(container) {
            Kind::Constructor | Kind::FunctionDeclaration | Kind::FunctionExpression => container,
            _ => Node::NONE,
        }
    }

    /// `IsInTopLevelContext`
    pub fn is_in_top_level_context(&self, mut node: Node) -> bool {
        let parent = self.parent(node);
        if matches!(
            self.kind(parent),
            Kind::ClassDeclaration | Kind::FunctionDeclaration
        ) && self.name(parent) == node
        {
            node = parent;
        }
        self.get_this_container(node, true, false) == Node::FILE
    }

    /// `isInParameterInitializerBeforeContainingFunction`
    pub fn is_in_parameter_initializer_before_containing_function(&self, mut node: Node) -> bool {
        let mut in_binding_initializer = false;
        loop {
            let parent = self.parent(node);
            let kind = self.kind(parent);
            if parent.is_none() || kind.is_function_like() {
                return false;
            }
            let is_initializer = || self.initializer(parent) == node;
            if kind == Kind::Parameter && (in_binding_initializer || is_initializer()) {
                return true;
            }
            in_binding_initializer |= kind == Kind::BindingElement && is_initializer();
            node = parent;
        }
    }

    /// `GetRootDeclaration`
    pub fn get_root_declaration(&self, mut node: Node) -> Node {
        while self.kind(node) == Kind::BindingElement {
            node = self.parent(self.parent(node));
        }
        node
    }

    /// `GetImmediatelyInvokedFunctionExpression`
    pub fn get_immediately_invoked_function_expression(&self, function: Node) -> Node {
        if !matches!(
            self.kind(function),
            Kind::FunctionExpression | Kind::ArrowFunction
        ) {
            return Node::NONE;
        }
        let (mut previous, mut parent) = (function, self.parent(function));
        while self.kind(parent) == Kind::ParenthesizedExpression {
            (previous, parent) = (parent, self.parent(parent));
        }
        if self.kind(parent) == Kind::CallExpression && self.expression(parent) == previous {
            parent
        } else {
            Node::NONE
        }
    }

    /// `IsStatic`
    pub fn is_static(&self, node: Node) -> bool {
        let kind = self.kind(node);
        kind.is_class_element() && self.flags(node).contains(Flags::STATIC)
            || kind == Kind::ClassStaticBlockDeclaration
    }

    /// `IsParameterPropertyDeclaration(node, node.Parent)`
    pub fn is_parameter_property_declaration(&self, node: Node) -> bool {
        matches!(self.data(node), NodeData::Param(p) if self[p].flags.contains(Flags::PARAMETER_PROPERTY))
            && self.kind(self.parent(node)) == Kind::Constructor
    }

    /// `IsBlockOrCatchScoped`
    pub fn is_block_or_catch_scoped(&self, declaration: Node) -> bool {
        match self.data(self.get_root_declaration(declaration)) {
            NodeData::VarDecl(d) => self[d].kind != VarKind::Var,
            _ => false,
        }
    }

    /// `node.Flags&NodeFlagsAmbient != 0`. An ambient node makes all its descendants ambient,
    /// except its own decorators and modifiers, which the parser has already parsed by the time it
    /// knows.
    pub fn is_ambient(&self, mut node: Node) -> bool {
        let mut is_modifier = false;
        while node.is_some() {
            if !is_modifier && self.flags(node).contains(Flags::AMBIENT) {
                return true;
            }
            is_modifier = matches!(self.data(node), NodeData::Modifier(_));
            node = self.parent(node);
        }
        self.kind == FileKind::Declaration
    }

    /// `node.Flags&NodeFlagsAwaitContext != 0`, as set by the parser's first pass. `Err`: it is
    /// that of the returned statement of the file, which `reparseTopLevelAwait` may parse again.
    pub fn await_context(&self, node: Node) -> Result<bool, Node> {
        self.context_of(node, Flags::ASYNC)
    }

    /// The state of `NodeFlagsAwaitContext` (`ASYNC`) or `NodeFlagsYieldContext` (`GENERATOR`) that
    /// `setContextFlags` had set where `node` was parsed.
    fn context_of(&self, node: Node, modifier: Flags) -> Result<bool, Node> {
        let is_await = modifier == Flags::ASYNC;
        let (mut below, mut above) = (node, self.parent(node));
        loop {
            let kind = self.kind(above);
            match kind {
                Kind::SourceFile => return Err(below),
                Kind::Unknown | Kind::EnumDeclaration | Kind::ModuleDeclaration => {
                    return Ok(false);
                }
                // `parseType` exits both contexts. The types a class implements are parsed as
                // expressions.
                _ if matches!(self.data(above), NodeData::Type(_))
                    && kind != Kind::ExpressionWithTypeArguments =>
                {
                    return Ok(false);
                }
                Kind::ExportAssignment | Kind::ExportDeclaration if is_await => return Ok(true),
                Kind::ClassStaticBlockDeclaration if below == self.body(above) => {
                    return Ok(is_await);
                }
                Kind::PropertyDeclaration if below == self.initializer(above) => return Ok(false),
                // Its decorators are parsed in the outer context.
                Kind::Parameter
                    if is_await && matches!(self.data(below), NodeData::Modifier(_)) =>
                {
                    above = self.parent(above);
                }
                // The part of an exported class after its type parameters.
                Kind::ClassDeclaration | Kind::ClassExpression
                    if is_await
                        && self.flags(above).contains(Flags::EXPORT)
                        && (matches!(self.data(below), NodeData::Member(_))
                            || matches!(below.part(), Some(Part::Extends | Part::Implements))) =>
                {
                    return Ok(true);
                }
                // `parseFunctionExpression`: its name is parsed in its own context combined with
                // the outer one.
                Kind::FunctionExpression
                    if below == self.name(above) && self.flags(above).contains(modifier) =>
                {
                    return Ok(true);
                }
                _ if kind.is_function_like()
                    && (matches!(self.data(below), NodeData::Param(_))
                        || below == self.body(above)) =>
                {
                    return Ok(self.flags(above).contains(modifier));
                }
                _ => {}
            }
            (below, above) = (above, self.parent(above));
        }
    }

    /// The ranges in which `isInAmbientOrTypeNode` is true: the interfaces, type aliases and type
    /// literals, and the `declare` declarations.
    fn ambient_or_type_places(&self) -> &Places {
        self.ambient_or_type_places.get_or_init(|| {
            let statements = self.stmts.iter().enumerate().filter(|&(s, statement)| {
                matches!(
                    statement.kind,
                    StmtKind::Interface(_) | StmtKind::TypeAlias(_)
                ) || self
                    .flags(self.node(StmtId(s as u32)))
                    .contains(Flags::AMBIENT)
            });
            let members = self.members.iter();
            let members = members.filter(|member| member.flags.contains(Flags::AMBIENT));
            let literals = self.types.iter();
            let literals = literals.filter(|node| matches!(node.kind, TypeNodeKind::Object(_)));
            Places::new(
                statements
                    .map(|(_, statement)| statement.loc)
                    .chain(members.map(|member| member.loc))
                    // One whose end is unknown extends to the end.
                    .chain(literals.map(|node| TextRange {
                        pos: node.pos,
                        end: if node.end == 0 { u32::MAX } else { node.end },
                    })),
            )
        })
    }

    /// `isInAmbientOrTypeNode`, in one walk up the parents. A node that starts outside every such
    /// range needs no walk.
    pub fn is_in_ambient_or_type_node(&self, mut node: Node) -> bool {
        if self.kind == FileKind::Declaration {
            return true;
        }
        if !self.ambient_or_type_places().contain(self.start(node)) {
            return false;
        }
        let mut is_modifier = false;
        while node.is_some() {
            let is_type = match self.data(node) {
                NodeData::Stmt(s) => {
                    matches!(
                        self[s].kind,
                        StmtKind::Interface(_) | StmtKind::TypeAlias(_)
                    )
                }
                NodeData::Type(t) => matches!(self[t].kind, TypeNodeKind::Object(_)),
                _ => false,
            };
            if is_type || !is_modifier && self.flags(node).contains(Flags::AMBIENT) {
                return true;
            }
            is_modifier = matches!(self.data(node), NodeData::Modifier(_));
            node = self.parent(node);
        }
        self.kind == FileKind::Declaration
    }

    /// `isThisProperty`
    pub fn is_this_property(&self, node: Node) -> bool {
        self.kind(node).is_access_expression()
            && self.kind(self.expression(node)) == Kind::ThisKeyword
    }

    /// `isInPropertyInitializerOrClassStaticBlock`
    pub fn is_in_property_initializer_or_class_static_block(
        &self,
        node: Node,
        ignore_arrow_functions: bool,
    ) -> bool {
        use Kind::*;
        let found = self.find_ancestor_or_quit(node, |node| match self.kind(node) {
            PropertyDeclaration | ClassStaticBlockDeclaration => ControlFlow::Break(true),
            TypeQuery | JsxClosingElement => ControlFlow::Break(false),
            ArrowFunction if !ignore_arrow_functions => ControlFlow::Break(false),
            Block => {
                let parent = self.kind(self.parent(node));
                if parent.is_function_like_declaration() && parent != ArrowFunction {
                    ControlFlow::Break(false)
                } else {
                    ControlFlow::Continue(())
                }
            }
            _ => ControlFlow::Continue(()),
        });
        found.is_some()
    }

    /// `IsInTypeQuery`. The operand of a `typeof` in a type is stored as an expression.
    pub fn is_in_type_query(&self, mut node: Node) -> bool {
        loop {
            match self.data(node) {
                NodeData::Expr(e)
                    if matches!(
                        self[e].kind,
                        ExprKind::Ident(_) | ExprKind::This | ExprKind::Dot { .. }
                    ) => {}
                NodeData::Part(Part::Name, _) => {}
                NodeData::Type(t) => return matches!(self[t].kind, TypeNodeKind::Typeof { .. }),
                _ => return false,
            }
            node = self.parent(node);
        }
    }

    /// `getSuperContainer`
    pub fn get_super_container(&self, mut node: Node, stop_on_functions: bool) -> Node {
        use Kind::*;
        loop {
            node = self.parent(node);
            match self.kind(node) {
                Unknown => return Node::NONE,
                ComputedPropertyName => node = self.parent(node),
                FunctionDeclaration | FunctionExpression | ArrowFunction if !stop_on_functions => {}
                FunctionDeclaration
                | FunctionExpression
                | ArrowFunction
                | PropertyDeclaration
                | PropertySignature
                | MethodDeclaration
                | MethodSignature
                | Constructor
                | GetAccessor
                | SetAccessor
                | ClassStaticBlockDeclaration => return node,
                Decorator => {
                    let parent = self.parent(node);
                    if self.kind(parent) == Parameter
                        && self.kind(self.parent(parent)).is_class_element()
                    {
                        node = self.parent(parent);
                    } else if self.kind(parent).is_class_element() {
                        node = parent;
                    }
                }
                _ => {}
            }
        }
    }
}

/// The inverse of `ModifierToFlag`.
fn kind_of_modifier(flag: Flags) -> Kind {
    const KINDS: [(Flags, Kind); 15] = [
        (Flags::EXPORT, Kind::ExportKeyword),
        (Flags::DEFAULT, Kind::DefaultKeyword),
        (Flags::AMBIENT, Kind::DeclareKeyword),
        (Flags::ABSTRACT, Kind::AbstractKeyword),
        (Flags::ASYNC, Kind::AsyncKeyword),
        (Flags::STATIC, Kind::StaticKeyword),
        (Flags::READONLY, Kind::ReadonlyKeyword),
        (Flags::PRIVATE, Kind::PrivateKeyword),
        (Flags::PROTECTED, Kind::ProtectedKeyword),
        (Flags::PUBLIC, Kind::PublicKeyword),
        (Flags::OVERRIDE, Kind::OverrideKeyword),
        (Flags::ACCESSOR, Kind::AccessorKeyword),
        (Flags::CONST, Kind::ConstKeyword),
        (Flags::IN, Kind::InKeyword),
        (Flags::OUT, Kind::OutKeyword),
    ];
    let found = KINDS.iter().find(|(modifier, _)| *modifier == flag);
    found.map_or(Kind::Unknown, |&(_, kind)| kind)
}

impl File {
    /// `GetDeclarationContainer`
    pub fn get_declaration_container(&self, node: Node) -> Node {
        let declaration = self.find_ancestor(self.get_root_declaration(node), |node| {
            !matches!(
                self.kind(node),
                Kind::VariableDeclaration
                    | Kind::VariableDeclarationList
                    | Kind::ImportSpecifier
                    | Kind::NamedImports
                    | Kind::NamespaceImport
                    | Kind::ImportClause
            )
        });
        self.parent(declaration)
    }
}
