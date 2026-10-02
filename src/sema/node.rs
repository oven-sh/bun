//! `*ast.Node`: one handle for every node of a file, whichever vector it is in, or in none.
//!
//! ROWS. The vectors of [`File`] that hold nodes are laid end to end, so a handle is the base of a vector plus an index: a typed id
//! becomes a handle, and a handle a typed id, by arithmetic. A node that takes two rows (`ExprKind::Fn` and its `Func`,
//! `StmtKind::Class` and its `Class`, a method and the function that is its value) has ONE handle, that of the row tsgo's node is: the
//! statement, the member, the property, the type node, else the expression.
//!
//! PARTS. A node of tsgo's that says nothing a row does not say has no row: its handle is the handle of that row and, in the top
//! bits, which [`Part`] of it. So `parent` goes up level by level as `node.Parent` does, and the levels take no memory.
//!
//! Rows that are no node: the statement around what is in the head of a `for`, the `Pat` of an omitted element, the `TupleElem` of a
//! plain element, the `Assign` of `{ a = 1 }`. What a class extends after the first has no `ExpressionWithTypeArguments` around it.
//! tsgo's nodes that are not there yet, so `parent` goes past them: `ParenthesizedExpression`, `ParenthesizedType`, `JsxExpression`,
//! `QualifiedName` and the identifiers of an entity name in a type, the literal of a `LiteralType`, of `["a"]` and of a template, module
//! specifiers, `ImportAttributes`, `WithStatement` (a `Block` of two), directives, tokens.

use crate::atom::Atom;
use crate::hir::*;

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

    /// `IsClassLike`
    pub fn is_class_like(self) -> bool {
        matches!(self, Kind::ClassDeclaration | Kind::ClassExpression)
    }
}

/// `*ast.Node`, of one file.
#[derive(Copy, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Debug)]
pub struct Node(pub u32);

/// How many bits of a handle say which row. The rest say which part of it.
const ROW_BITS: u32 = 27;

macro_rules! parts {
    ($($(#[$doc:meta])* $name:ident = $bits:literal,)*) => {
        /// A node that is told from the row it belongs to.
        #[derive(Copy, Clone, PartialEq, Eq, Debug)]
        #[repr(u8)]
        pub enum Part { $($(#[$doc])* $name = $bits,)* }

        impl Node {
            /// `None`: it is a row.
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
    /// `node.Name()`, of what has no pattern for a name. Of an `ImportDeclaration`: that of its `ImportClause`.
    Name = 1,
    /// `node.PropertyName()`
    PropertyName = 2,
    /// `node.Label()`
    Label = 3,
    /// The `Block` of a function-like, the `ModuleBlock`, the `CaseBlock`.
    Body = 4,
    CatchClause = 5,
    /// The `HeritageClause` that says `extends`.
    Extends = 6,
    /// The `HeritageClause` that says `implements`.
    Implements = 7,
    /// The `ExpressionWithTypeArguments` a class extends: `GetExtendsHeritageClauseElement`.
    Base = 8,
    /// The `VariableDeclarationList`. In the head of a `for` the statement it belongs to is no node.
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
    /// The `TemplateSpan` around a substitution. It belongs to the row of the expression.
    Span = 18,
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
    /// The row it is, or is a part of.
    #[inline]
    pub fn row(self) -> Node {
        Node(self.0 & ((1 << ROW_BITS) - 1))
    }
    /// That part of the row.
    #[inline]
    pub fn with(self, part: Part) -> Node {
        Node(self.row().0 | (part as u32) << ROW_BITS)
    }
    #[inline]
    fn idx(self) -> usize {
        self.0 as usize
    }
}

macro_rules! node_vectors {
    ($($index:literal $field:ident $id:ident $variant:ident;)*) => {
        /// What a [`Node`] is.
        #[derive(Copy, Clone, PartialEq, Eq, Debug)]
        pub enum NodeData {
            /// `nil`
            None,
            File,
            $($variant($id),)*
            /// That part of that row.
            Part(Part, Node),
        }

        /// How many vectors hold nodes.
        const VECTORS: usize = [$($index),*].len();

        /// Where the rows of each vector begin among the handles, and where the last ends.
        #[derive(Copy, Clone, Default)]
        pub struct NodeBases([u32; VECTORS + 1]);

        impl File {
            fn node_bases(&self) -> NodeBases {
                let mut bases = [1u32; VECTORS + 1];
                $(bases[$index + 1] = bases[$index] + self.$field.len() as u32;)*
                assert!(bases[VECTORS] < 1 << ROW_BITS);
                NodeBases(bases)
            }

            pub fn data(&self, node: Node) -> NodeData {
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

/// The handle of the row itself, which not every row goes by.
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
}

/// A typed id that is, or belongs to, a node.
pub trait ToNode: Copy {
    fn to_node(self, file: &File) -> Node;
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
    ExportSpecId ModifierId
}

impl ToNode for TupleElemId {
    /// An element without a name, `?` or `...` is its type.
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
statements_are_nodes! { InterfaceId interfaces AliasId aliases EnumId enums ModuleId modules ImportEqualsId import_equals }

/// `Visitor`, and the file whose ids it is handed.
struct Children<'a> {
    file: &'a File,
    visit: &'a mut dyn FnMut(Node) -> bool,
}

impl Children<'_> {
    /// `visit`
    fn one(&mut self, id: impl ToNode) -> bool {
        let node = id.to_node(self.file);
        node.is_some() && (self.visit)(node)
    }

    /// `visit`, of a part that is only there if `is_there`.
    fn part(&mut self, of: Node, part: Part, is_there: bool) -> bool {
        is_there && (self.visit)(of.with(part))
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

    /// `visitNodeList`, of expressions that each have `part` around them.
    fn wrapped(&mut self, list: IdList<ExprId>, part: Part) -> bool {
        let file = self.file;
        file.ids(list).any(|e| self.one(e.row(file).with(part)))
    }

    /// What is in the head of a `for` statement, which has no statement around it.
    fn for_initializer(&mut self, init: StmtId) -> bool {
        match self.file.stmts.get(init.idx()).map(|s| s.kind) {
            Some(StmtKind::Expr(e)) => self.one(e),
            Some(StmtKind::Var(_)) => self.one(init.row(self.file).with(Part::DeclarationList)),
            _ => self.one(init),
        }
    }

    /// All of the function-like `node` after its name.
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

    /// All of the class `node` after its modifiers.
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
            | ExprKind::String(_)
            | ExprKind::BigInt(_)
            | ExprKind::Regex => false,
            ExprKind::ImportMeta | ExprKind::NewTarget(_) => self.one(node.with(Part::Name)),
            ExprKind::Template { exprs, .. } => self.wrapped(exprs, Part::Span),
            ExprKind::TaggedTemplate(c) => {
                let call = &file[c];
                self.one(call.callee) || self.list(call.type_args) || self.one(call.template)
            }
            ExprKind::Array(elements) => self.list(elements),
            ExprKind::Object(properties) => self.span(properties),
            ExprKind::Fn(f) => self.one(file.name(node)) || self.function(f, node),
            ExprKind::Class(c) => self.span(file[c].modifiers) || self.class(c, node),
            ExprKind::Dot { obj, .. } => self.one(obj) || self.one(node.with(Part::Name)),
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
            ExprKind::Spread(e)
            | ExprKind::Await(e)
            | ExprKind::AsConst(e)
            | ExprKind::NonNull(e) => self.one(e),
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
                    || self.list(file[j].children)
                    || self.one(node.with(Part::Closing))
            }
            ExprKind::ImportCall { args, type_args } => self.list(type_args) || self.list(args),
        }
    }

    fn stmt(&mut self, s: StmtId, node: Node) -> bool {
        let file = self.file;
        match file[s].kind {
            StmtKind::Empty | StmtKind::Debugger => false,
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
            StmtKind::ForIn { left, expr, body }
            | StmtKind::ForOf {
                left, expr, body, ..
            } => self.for_initializer(left) || self.one(expr) || self.one(body),
            StmtKind::While { test, body } => self.one(test) || self.one(body),
            StmtKind::DoWhile { body, test } => self.one(body) || self.one(test),
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
                let has_clause = import.default.is_some()
                    || import.namespace.is_some()
                    || !import.named.is_empty();
                self.part(node, Part::ImportClause, has_clause)
            }
            StmtKind::ImportEquals(i) => {
                let is_external = matches!(file[i].target, ImportEqualsTarget::Require(_));
                self.one(node.with(Part::Name))
                    || self.part(node, Part::ModuleReference, is_external)
            }
            StmtKind::ExportNamed(_) => self.one(node.with(Part::ExportClause)),
            StmtKind::ExportStar { alias, .. } => {
                self.part(node, Part::ExportClause, alias.is_some())
            }
            StmtKind::ExportAsNamespace(_) => self.one(node.with(Part::Name)),
        }
    }

    fn ty(&mut self, t: TypeNodeId, node: Node) -> bool {
        let file = self.file;
        match file[t].kind {
            TypeNodeKind::Error
            | TypeNodeKind::Keyword(_)
            | TypeNodeKind::StringLit(_)
            | TypeNodeKind::NumberLit(_)
            | TypeNodeKind::BigIntLit { .. }
            | TypeNodeKind::BoolLit(_)
            | TypeNodeKind::UniqueSymbol => false,
            TypeNodeKind::Heritage(e) => self.one(e),
            TypeNodeKind::Ref { args, .. } | TypeNodeKind::Import { args, .. } => self.list(args),
            TypeNodeKind::Template { types, .. }
            | TypeNodeKind::Union(types)
            | TypeNodeKind::Intersection(types) => self.list(types),
            TypeNodeKind::Array(t) | TypeNodeKind::Keyof(t) | TypeNodeKind::Readonly(t) => {
                self.one(t)
            }
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
            TypeNodeKind::Predicate { ty, .. } => self.one(ty),
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
            Part::Label | Part::BindingsName => false,
            // `ComputedPropertyName`
            Part::Name | Part::PropertyName => match file.data(row) {
                NodeData::Member(m) => matches!(file[m].key, PropKey::Computed(e) if self.one(e)),
                NodeData::Prop(p) => matches!(file[p].key, PropKey::Computed(e) if self.one(e)),
                NodeData::PatProp(p) => matches!(file[p].key, PropKey::Computed(e) if self.one(e)),
                NodeData::EnumMember(m) => self.one(file[m].computed_name),
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
            Part::Span => (self.visit)(row),
            Part::DeclarationList => match statement {
                Some(StmtKind::Var(declarations)) => self.span(declarations),
                _ => false,
            },
            Part::ImportClause => match statement {
                Some(StmtKind::Import(i)) => {
                    let has_bindings = file[i].namespace.is_some() || !file[i].named.is_empty();
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
                Some(StmtKind::ImportEquals(i)) => self.one(file[i].expression),
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
    /// The handle of what `id` is, or is the second row of.
    #[inline]
    pub fn node(&self, id: impl ToNode) -> Node {
        id.to_node(self)
    }

    /// What `parents` has for the row `row`: the nearest node above that does not belong to `row` itself.
    #[inline]
    fn row_above(&self, row: Node) -> Node {
        let parents = self.parents.get_or_init(|| self.parents_of_all());
        parents.get(row.idx()).copied().unwrap_or(Node::NONE)
    }

    /// `node.Parent`. `NONE` for the file, and for a row nothing in the file leads to.
    pub fn parent(&self, node: Node) -> Node {
        let row = node.row();
        let is_import = || matches!(self.data(row), NodeData::Stmt(s) if matches!(self[s].kind, StmtKind::Import(_)));
        match node.part() {
            None => {
                let above = self.row_above(row);
                match self.data(above) {
                    NodeData::Expr(e) if matches!(self[e].kind, ExprKind::Template { .. }) => {
                        row.with(Part::Span)
                    }
                    _ => above,
                }
            }
            Some(Part::Span) => self.row_above(row),
            Some(Part::Base) => row.with(Part::Extends),
            // In the head of a `for`.
            Some(Part::DeclarationList) if self.is_for_initializer(row) => self.row_above(row),
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

    /// Whether the statement `row` is what is in the head of the `for` statement above it.
    fn is_for_initializer(&self, row: Node) -> bool {
        match (self.data(row), self.data(self.row_above(row))) {
            (NodeData::Stmt(s), NodeData::Stmt(above)) => matches!(
                self[above].kind,
                StmtKind::For { init: head, .. }
                    | StmtKind::ForIn { left: head, .. }
                    | StmtKind::ForOf { left: head, .. } if head == s
            ),
            _ => false,
        }
    }

    /// One walk, when the first parent is asked for: most files of a program are never asked.
    #[cold]
    fn parents_of_all(&self) -> Box<[Node]> {
        let mut parents = vec![Node::NONE; self.bases.0[VECTORS] as usize];
        let mut open = vec![Node::FILE];
        while let Some(node) = open.pop() {
            self.for_each_child(node, &mut |child| {
                // A part has no place of its own. One that is around its row, or stands for it, takes that of the row.
                let is_around_its_row = matches!(
                    child.part(),
                    None | Some(Part::Span | Part::DeclarationList)
                );
                if is_around_its_row && child.row() != node.row() {
                    parents[child.row().idx()] = node;
                }
                open.push(child);
                false
            });
        }
        parents.into()
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

    /// The function a method or an accessor of an object literal is.
    fn method_of(&self, p: PropId) -> FnId {
        match (
            self[p].kind,
            self.exprs.get(self[p].value.idx()).map(|e| e.kind),
        ) {
            (PropKind::Method | PropKind::Getter | PropKind::Setter, Some(ExprKind::Fn(f))) => f,
            _ => FnId::NONE,
        }
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

    /// `node.Name()`
    pub fn name(&self, node: Node) -> Node {
        let named = |name: Atom| {
            if name.is_some() {
                node.with(Part::Name)
            } else {
                Node::NONE
            }
        };
        let keyed = |key: PropKey| {
            if key == PropKey::None {
                Node::NONE
            } else {
                node.with(Part::Name)
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
            NodeData::Member(m) => keyed(self[m].key),
            // The name of `{ a }` and of `{ a = 1 }` is an expression.
            NodeData::Prop(p) if self[p].kind == PropKind::Shorthand => {
                match self.exprs.get(self[p].value.idx()).map(|e| e.kind) {
                    Some(ExprKind::Assign { target, .. }) => self.node(target),
                    _ => self.node(self[p].value),
                }
            }
            NodeData::Prop(p) => keyed(self[p].key),
            NodeData::EnumMember(_)
            | NodeData::TypeParam(_)
            | NodeData::ImportSpec(_)
            | NodeData::ExportSpec(_) => node.with(Part::Name),
            NodeData::TupleElem(e) => named(self[e].name),
            NodeData::Param(p) => self.node(self[p].pat),
            NodeData::VarDecl(d) => self.node(self[d].pat),
            NodeData::PatProp(p) => self.node(self[p].value),
            NodeData::PatElem(e) => self.node(self[e].pat),
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
        let is_there = match self.data(node) {
            NodeData::ImportSpec(s) => self[s].imported_pos != self[s].pos,
            NodeData::ExportSpec(s) => self[s].local_pos != self[s].pos,
            NodeData::PatProp(p) => {
                self[p].key != PropKey::None && self[p].key_pos != self[self[p].value].pos
            }
            _ => false,
        };
        if is_there {
            node.with(Part::PropertyName)
        } else {
            Node::NONE
        }
    }

    /// `node.ForEachChild`: the children in the order they are written, until `visit` says true.
    pub fn for_each_child(&self, node: Node, visit: &mut dyn FnMut(Node) -> bool) -> bool {
        let mut v = Children { file: self, visit };
        match self.data(node) {
            NodeData::None => false,
            NodeData::File => {
                v.list(self.body)
                    || self.import_attributes.iter().any(|&(_, e)| v.one(e))
                    || self.specifier_expressions.iter().any(|&e| v.one(e))
            }
            NodeData::Part(part, row) => v.part_of(part, row),
            NodeData::Expr(e) => v.expr(e, node),
            NodeData::Stmt(s) => v.span(self[s].modifiers) || v.stmt(s, node),
            NodeData::Type(t) => v.ty(t, node),
            NodeData::Pat(p) => match self[p].kind {
                PatKind::Missing | PatKind::Ident(_) => false,
                PatKind::Object(properties) => v.span(properties),
                PatKind::Array(elements) => v.span(elements),
            },
            NodeData::PatProp(p) => {
                v.one(self.property_name(node)) || v.one(self[p].value) || v.one(self[p].default)
            }
            NodeData::PatElem(e) if matches!(self[self[e].pat].kind, PatKind::Missing) => false,
            NodeData::PatElem(e) => v.one(self[e].pat) || v.one(self[e].default),
            NodeData::Param(p) => {
                let parameter = &self[p];
                v.span(self.param_modifiers(p))
                    || v.one(parameter.pat)
                    || v.one(parameter.ty)
                    || v.one(parameter.default)
            }
            NodeData::TypeParam(p) => {
                v.one(node.with(Part::Name)) || v.one(self[p].constraint) || v.one(self[p].default)
            }
            NodeData::Member(m) => {
                let member = &self[m];
                v.span(member.modifiers)
                    || v.one(self.name(node))
                    || member.func.is_some() && v.function(member.func, node)
                    || v.one(member.ty)
                    || v.one(member.init)
            }
            NodeData::Prop(p) => {
                let (property, method) = (&self[p], self.method_of(p));
                let value = self.exprs.get(property.value.idx()).map(|e| e.kind);
                v.one(self.name(node))
                    || v.one(self.jsdoc_type(JsDocTypeOwner::Prop(p)))
                    || match (property.kind, value) {
                        _ if method.is_some() => v.function(method, node),
                        (PropKind::Shorthand, Some(ExprKind::Assign { value, .. })) => v.one(value),
                        (PropKind::Shorthand, _) => false,
                        _ => v.one(property.value),
                    }
            }
            NodeData::VarDecl(d) => {
                let declaration = &self[d];
                v.one(declaration.pat) || v.one(declaration.ty) || v.one(declaration.init)
            }
            NodeData::Case(c) => v.one(self[c].test) || v.list(self[c].body),
            NodeData::EnumMember(m) => v.one(node.with(Part::Name)) || v.one(self[m].init),
            NodeData::ImportSpec(_) | NodeData::ExportSpec(_) => {
                v.one(self.property_name(node)) || v.one(node.with(Part::Name))
            }
            NodeData::TupleElem(e) => v.one(self.name(node)) || v.one(self[e].ty),
            NodeData::Modifier(m) => {
                matches!(self[m].kind, ModifierKind::Decorator(e) if v.one(e))
            }
        }
    }

    /// Sets what `node` and `data` answer from. No row is added afterwards.
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
                let is_attribute = self.parent(node).part() == Some(Part::Attributes);
                match self[p].kind {
                    PropKind::Spread if is_attribute => Kind::JsxSpreadAttribute,
                    _ if is_attribute => Kind::JsxAttribute,
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
            Part::Label | Part::BindingsName => Kind::Identifier,
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
            Part::Span => Kind::TemplateSpan,
        }
    }

    /// Of a name that is written as a literal only a member says so: the others are taken for identifiers.
    fn kind_of_name(&self, part: Part, row: Node) -> Kind {
        let of_key = |key: PropKey| match key {
            PropKey::Private(_) => Kind::PrivateIdentifier,
            PropKey::Computed(_) => Kind::ComputedPropertyName,
            _ => Kind::Identifier,
        };
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
            NodeData::Member(m) => {
                let flags = self[m].flags;
                match self[m].key {
                    PropKey::Name(_)
                        if flags.contains(Flags::LITERAL_NAME | Flags::STRING_NAME) =>
                    {
                        Kind::StringLiteral
                    }
                    PropKey::Name(_) if flags.contains(Flags::LITERAL_NAME) => Kind::NumericLiteral,
                    PropKey::Name(_) if flags.contains(Flags::STRING_NAME) => {
                        Kind::ComputedPropertyName
                    }
                    key => of_key(key),
                }
            }
            NodeData::Prop(p) => of_key(self[p].key),
            NodeData::PatProp(p) if part == Part::PropertyName => of_key(self[p].key),
            NodeData::EnumMember(m) if self[m].computed_name.is_some() => {
                Kind::ComputedPropertyName
            }
            _ => Kind::Identifier,
        }
    }

    fn kind_of_expr(&self, e: ExprId, node: Node) -> Kind {
        let parent = || self.parent(node);
        let is_in = |kind: fn(&ExprKind) -> bool| matches!(self.data(parent()), NodeData::Expr(parent) if kind(&self[parent].kind));
        match self[e].kind {
            ExprKind::Missing if is_in(|parent| matches!(parent, ExprKind::Array(_))) => {
                Kind::OmittedExpression
            }
            ExprKind::Missing | ExprKind::Ident(_) => Kind::Identifier,
            ExprKind::This => Kind::ThisKeyword,
            ExprKind::Super => Kind::SuperKeyword,
            ExprKind::Null => Kind::NullKeyword,
            ExprKind::True => Kind::TrueKeyword,
            ExprKind::False => Kind::FalseKeyword,
            ExprKind::Number(_) => Kind::NumericLiteral,
            // The name of a tag.
            ExprKind::String(_)
                if matches!(parent().part(), Some(Part::Opening | Part::Closing)) =>
            {
                Kind::Identifier
            }
            ExprKind::String(_) => match self.data(parent()) {
                NodeData::Expr(parent) => match self[parent].kind {
                    ExprKind::Jsx(j) if self[j].tag == e => Kind::Identifier,
                    ExprKind::Jsx(_) => Kind::JsxText,
                    _ => Kind::StringLiteral,
                },
                _ => Kind::StringLiteral,
            },
            ExprKind::BigInt(_) => Kind::BigIntLiteral,
            ExprKind::Regex => Kind::RegularExpressionLiteral,
            ExprKind::Template { .. } => Kind::TemplateExpression,
            ExprKind::TaggedTemplate(_) => Kind::TaggedTemplateExpression,
            ExprKind::Array(_) => Kind::ArrayLiteralExpression,
            ExprKind::Object(_) => Kind::ObjectLiteralExpression,
            ExprKind::Fn(f) if self[f].kind == FnKind::Arrow => Kind::ArrowFunction,
            ExprKind::Fn(_) => Kind::FunctionExpression,
            ExprKind::Class(_) => Kind::ClassExpression,
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
                if self[e].pos < open_parenthesis(self, expr).unwrap_or(self[expr].pos) =>
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
            // An element of a heritage clause is written like a type reference.
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
            TypeNodeKind::Typeof { .. } => Kind::TypeQuery,
            TypeNodeKind::Import { .. } => Kind::ImportType,
            TypeNodeKind::Predicate { .. } => Kind::TypePredicate,
        }
    }

    /// `GetTokenPosOfNode`: where its first token is.
    pub fn start(&self, node: Node) -> u32 {
        match self.data(node) {
            NodeData::None | NodeData::File => 0,
            NodeData::Part(part, row) => self.start_of_part(part, row),
            NodeData::Expr(e) => self[e].pos,
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
            NodeData::TupleElem(e) => self[self[e].ty].pos,
            NodeData::Modifier(m) => self[m].pos,
        }
    }

    /// 0: the tree does not say.
    fn start_of_part(&self, part: Part, row: Node) -> u32 {
        let is_property_name = part == Part::PropertyName;
        match (part, self.data(row)) {
            (Part::Span, _) => self.start(row),
            (Part::Base, _) => self.start(self.node(self[self.class_of(row)].extends)),
            (Part::Name, NodeData::Expr(e)) => match self[e].kind {
                ExprKind::Dot { name_pos, .. } => name_pos,
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
                (Part::ImportClause, StmtKind::Import(i)) => self[i].clause_start,
                (Part::NamedBindings, StmtKind::Import(i)) if self[i].namespace.is_some() => {
                    self[i].namespace_start
                }
                (Part::BindingsName, StmtKind::Import(i)) => self[i].namespace_pos,
                (Part::ExportClause, StmtKind::ExportStar { star_pos, .. }) => star_pos,
                (Part::BindingsName, StmtKind::ExportStar { alias_pos, .. }) => alias_pos,
                _ => 0,
            },
            (Part::Name, NodeData::Member(m)) => self[m].name_pos,
            (Part::Name, NodeData::Prop(p)) => self[p].pos,
            (Part::PropertyName, NodeData::PatProp(p)) => self[p].key_pos,
            (Part::Name, NodeData::EnumMember(m)) => self[m].pos,
            (Part::Name, NodeData::TypeParam(p)) => self[p].pos,
            (_, NodeData::ImportSpec(s)) if is_property_name => self[s].imported_pos,
            (_, NodeData::ImportSpec(s)) => self[s].pos,
            (_, NodeData::ExportSpec(s)) if is_property_name => self[s].local_pos,
            (_, NodeData::ExportSpec(s)) => self[s].pos,
            _ => 0,
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
