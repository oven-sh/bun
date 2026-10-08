//! The syntax tree as oxc and Prettier see it, for questions about what is around a node.
//!
//! Much of what decides how a node is printed is a question about its parent: does it need
//! parentheses there, does it start a statement, is it the callee of a call. The code that this
//! crate is a port of asks those questions in terms of ESTree, which has nodes that the syntax
//! tree of `bun_lint::ast` does not have (`ChainExpression`, `FunctionBody`, `FormalParameters`,
//! `TSTypeAnnotation`, `JSXExpressionContainer`, `ExportNamedDeclaration`, ..) and tells apart
//! what is one kind there (`LogicalExpression` and `BinaryExpression`).
//!
//! [`AstNodes`] is that tree. Nothing is converted or stored: a value is a name for the kind and
//! a handle, and [`AstNodes::parent`] computes the next one from the parent of the handle. Every
//! variant has exactly one field, so `AstNodes::X(_)` is always a valid pattern.
//!
//! - `expr.as_ast_nodes()`, `stmt.as_ast_nodes()`, ..: what a handle is.
//! - `expr.ast_parent()`, ..: what it is in. The same as `expr.as_ast_nodes().parent()`.
//! - `expr.as_chain_element()`: `a?.b` is two nodes in ESTree, a `ChainExpression` and the
//!   `MemberExpression` in it, and one `Expr`. `as_ast_nodes()` is the outer and this the inner.
//! - `nodes.span()`: the range that the node has in oxc.
//! - `nodes.ancestors()`: itself, its parent, and so on up to `Program`.

use bun_lint::ast::{
    BinOp, Case, Chain, Class, EnumMember, ExportSpec, Expr, ExprKind, File, Flags, FnBody, FnKind,
    Func, ImportSpec, Keyword, Member, MemberKind, ModuleName, Node, Param, Pat, PatKind, PatProp,
    Prop, PropKind, Stmt, StmtKind, TupleElem, TypeKind, TypeNode, TypeParam, UnOp, VarDecl,
};
use bun_lint::span::{Span, Spanned};
use bun_lint::tokens::skip_trivia_back;

/// An expression statement, or the body of an arrow function that is an expression, which oxc has
/// as an `ExpressionStatement` in a `FunctionBody`.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) enum ExpressionStatement<'a> {
    Stmt(Stmt<'a>),
    ArrowBody(Func<'a>),
}

impl<'a> ExpressionStatement<'a> {
    /// `() => expression`
    pub(crate) fn is_arrow_function_body(self) -> bool {
        matches!(self, ExpressionStatement::ArrowBody(_))
    }

    pub(crate) fn expression(self) -> Option<Expr<'a>> {
        match self {
            ExpressionStatement::Stmt(statement) => match statement.kind() {
                StmtKind::Expr(e) => Some(e),
                _ => None,
            },
            ExpressionStatement::ArrowBody(func) => match func.body() {
                FnBody::Expr(e) => Some(e),
                _ => None,
            },
        }
    }

    pub(crate) fn span(self) -> Span {
        match self {
            ExpressionStatement::Stmt(statement) => statement.span(),
            ExpressionStatement::ArrowBody(_) => self.expression().map_or(Span::default(), Expr::span),
        }
    }
}

macro_rules! ast_nodes {
    ($($payload:ty { $($variant:ident)* })*) => {
        #[derive(Copy, Clone, PartialEq, Eq, Debug)]
        pub(crate) enum AstNodes<'a> {
            Program(Program<'a>),
            $($($variant($payload),)*)*
        }
    };
}

/// The file.
#[derive(Copy, Clone)]
pub(crate) struct Program<'a>(pub(crate) &'a File<'a>);

impl PartialEq for Program<'_> {
    fn eq(&self, other: &Self) -> bool {
        std::ptr::eq(self.0, other.0)
    }
}
impl Eq for Program<'_> {}
impl std::fmt::Debug for Program<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Program")
    }
}

ast_nodes! {
    Expr<'a> {
        IdentifierReference BooleanLiteral NullLiteral NumericLiteral BigIntLiteral RegExpLiteral
        StringLiteral TemplateLiteral ThisExpression Super ArrayExpression ObjectExpression
        StaticMemberExpression ComputedMemberExpression PrivateFieldExpression CallExpression
        NewExpression ImportExpression MetaProperty TaggedTemplateExpression UnaryExpression
        UpdateExpression BinaryExpression LogicalExpression PrivateInExpression
        AssignmentExpression ConditionalExpression AwaitExpression YieldExpression TSAsExpression
        TSSatisfiesExpression TSTypeAssertion TSNonNullExpression TSInstantiationExpression
        JSXElement JSXFragment JSXText JSXEmptyExpression Elision PrivateIdentifier
        // All of `a, b, c`.
        SequenceExpression
        // All of `a?.b.c`. The field is also the node that is in it.
        ChainExpression
        // The `{e}` around `e`.
        JSXExpressionContainer
        // `{...e}` among the children of an element. The field is the `Spread`.
        JSXSpreadChild
        // `<a b>`. The field is the element.
        JSXOpeningElement
        // The `@e` around `e`.
        Decorator
        // What an array literal, an object literal, `a = 1` and `...a` are in the target of an
        // assignment.
        ArrayAssignmentTarget ObjectAssignmentTarget AssignmentTargetWithDefault
        AssignmentTargetRest
    }
    // `...e` in an array literal or in arguments is an `Expr`, in an object literal a `Prop`.
    Node<'a> { SpreadElement }
    ExpressionStatement<'a> { ExpressionStatement }
    Func<'a> {
        Function ArrowFunctionExpression
        // The `{ .. }`, or the expression after `=>`.
        FunctionBody
        // The `( .. )`.
        FormalParameters
    }
    Class<'a> { Class ClassBody }
    Param<'a> { FormalParameter FormalParameterRest TSThisParameter }
    Member<'a> {
        MethodDefinition PropertyDefinition AccessorProperty StaticBlock TSIndexSignature
        TSPropertySignature TSMethodSignature TSCallSignatureDeclaration
        TSConstructSignatureDeclaration
    }
    Prop<'a> {
        ObjectProperty JSXAttribute JSXSpreadAttribute AssignmentTargetPropertyIdentifier
        AssignmentTargetPropertyProperty
    }
    VarDecl<'a> { VariableDeclarator CatchParameter }
    Stmt<'a> {
        Directive BlockStatement EmptyStatement DebuggerStatement VariableDeclaration
        ReturnStatement IfStatement ForStatement ForInStatement ForOfStatement WhileStatement
        DoWhileStatement WithStatement SwitchStatement TryStatement ThrowStatement BreakStatement
        ContinueStatement LabeledStatement ImportDeclaration ExportAllDeclaration
        TSInterfaceDeclaration TSTypeAliasDeclaration TSEnumDeclaration TSModuleDeclaration
        TSGlobalDeclaration TSImportEqualsDeclaration TSExportAssignment
        TSNamespaceExportDeclaration
        // `export { a }`, or the `export` around a declaration. The field is also the declaration.
        ExportNamedDeclaration
        // `export default e`, or the `export default` around a declaration.
        ExportDefaultDeclaration
        // `catch (e) { .. }`. The field is the `try` statement.
        CatchClause
        // The `{ .. }` of the declaration.
        TSInterfaceBody TSEnumBody TSModuleBlock
    }
    Case<'a> { SwitchCase }
    EnumMember<'a> { TSEnumMember }
    ImportSpec<'a> { ImportSpecifier }
    ExportSpec<'a> { ExportSpecifier }
    Pat<'a> { BindingIdentifier ObjectPattern ArrayPattern }
    PatProp<'a> { BindingProperty }
    // `a = 1` and `...a` in a pattern: a `PatElem` or a `PatProp`.
    Node<'a> { AssignmentPattern BindingRestElement }
    TypeNode<'a> {
        // `any`, `string`, ..
        TSKeywordType
        TSThisType TSTypeReference TSLiteralType TSTemplateLiteralType TSArrayType TSTupleType
        TSUnionType TSIntersectionType TSFunctionType TSConstructorType TSTypeLiteral
        TSConditionalType TSInferType TSMappedType TSIndexedAccessType TSTypeOperator TSTypeQuery
        TSImportType TSTypePredicate
        // An element of `implements` or of the `extends` of an interface.
        TSClassImplements TSInterfaceHeritage
        // The `: T` around `T`.
        TSTypeAnnotation
    }
    TupleElem<'a> { TSNamedTupleMember TSOptionalType TSRestType }
    TypeParam<'a> { TSTypeParameter }
    // The `<..>`. The field is what has the type arguments or parameters.
    Node<'a> { TSTypeParameterInstantiation TSTypeParameterDeclaration }
}

/// How far up the nodes that oxc has around an expression and `bun_lint::ast` does not.
#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord)]
enum Level {
    Itself,
    Chain,
    JsxContainer,
}

/// Whether `e` is a link of an optional chain after its first `?.`. The `!` of `a?.b!` is one.
#[inline]
fn is_chain_link(e: Expr<'_>) -> bool {
    use bun_sema::hir::ExprTag;
    matches!(e.tag(), ExprTag::Dot | ExprTag::Index | ExprTag::Call | ExprTag::NonNull) && is_chain_link_slow(e)
}

fn is_chain_link_slow(e: Expr<'_>) -> bool {
    match e.kind() {
        ExprKind::Dot { chain, .. } | ExprKind::Index { chain, .. } => chain != Chain::No,
        ExprKind::Call(call) => call.chain() != Chain::No,
        ExprKind::NonNull(inner) => !inner.is_parenthesized() && is_chain_link(inner),
        _ => false,
    }
}

/// Whether oxc has a `ChainExpression` around `e`: it is all of `a?.b.c!`, not a part of it.
#[inline]
pub(crate) fn is_chain_root(e: Expr<'_>) -> bool {
    is_chain_link(e) && is_last_chain_link(e)
}

fn is_last_chain_link(e: Expr<'_>) -> bool {
    if e.is_parenthesized() {
        return true;
    }
    let Node::Expr(parent) = e.parent() else {
        return true;
    };
    match parent.kind() {
        ExprKind::Dot { obj, chain, .. } | ExprKind::Index { obj, chain, .. } => {
            obj != e || chain == Chain::No
        }
        ExprKind::Call(call) => call.callee() != e || call.chain() == Chain::No,
        ExprKind::NonNull(_) => false,
        _ => true,
    }
}

fn is_comma(e: Expr<'_>) -> bool {
    matches!(e.kind(), ExprKind::Binary { op: BinOp::Comma, .. })
}

/// Whether `e` is the `a, b` of `a, b, c`, which is not a node of its own in ESTree.
fn is_inner_comma(e: Expr<'_>) -> bool {
    is_comma(e)
        && !e.is_parenthesized()
        && matches!(
            e.parent(),
            Node::Expr(parent) if matches!(
                parent.kind(),
                ExprKind::Binary { op: BinOp::Comma, left, .. } if left == e
            )
        )
}

/// Whether `e` is written where ESTree has a pattern: it is what an assignment or a `for`-`in` or
/// `for`-`of` loop assigns to, or a part of that which is not a default value or a computed key.
pub(crate) fn is_assignment_target(mut e: Expr<'_>) -> bool {
    fn is_head<'a>(statement: Stmt<'a>, e: Expr<'a>) -> bool {
        matches!(
            statement.kind(),
            StmtKind::ForIn { left, .. } | StmtKind::ForOf { left, .. }
                if matches!(left.kind(), StmtKind::Expr(it) if it == e)
        )
    }
    loop {
        match e.parent() {
            Node::Expr(parent) => match parent.kind() {
                ExprKind::Assign { target, .. } => return target == e,
                ExprKind::Array(_) | ExprKind::Spread(_) => e = parent,
                _ => return false,
            },
            Node::Prop(prop) => match (prop.value() == Some(e), prop.parent()) {
                (true, Node::Expr(object)) if !prop.is_jsx_attribute() => e = object,
                _ => return false,
            },
            Node::Stmt(statement) => {
                return is_head(statement, e)
                    || matches!(statement.parent(), Node::Stmt(outer) if is_head(outer, e));
            }
            _ => return false,
        }
    }
}

/// What a handle is, and what it is in.
pub(crate) trait AsAstNodes<'a>: Copy {
    fn as_ast_nodes(self) -> AstNodes<'a>;

    #[inline]
    fn ast_parent(self) -> AstNodes<'a> {
        self.as_ast_nodes().parent()
    }

    /// The parent, its parent, and so on up to `Program`.
    #[inline]
    fn ast_ancestors(self) -> impl Iterator<Item = AstNodes<'a>> {
        self.ast_parent().ancestors()
    }
}

impl<'a> AsAstNodes<'a> for Expr<'a> {
    /// ESTree's `Expression`: for the whole of an optional chain, the `ChainExpression`. See
    /// [`ChainElement::as_chain_element`].
    #[inline]
    fn as_ast_nodes(self) -> AstNodes<'a> {
        match is_chain_root(self) {
            true => AstNodes::ChainExpression(self),
            false => self.as_chain_element(),
        }
    }
}

pub(crate) trait ChainElement<'a> {
    /// The member access, the call or the `!` itself, even if it is the whole of an optional
    /// chain. Its parent is the `ChainExpression` then. For any other expression this is the same
    /// as [`AsAstNodes::as_ast_nodes`].
    fn as_chain_element(self) -> AstNodes<'a>;
}

impl<'a> ChainElement<'a> for Expr<'a> {
    fn as_chain_element(self) -> AstNodes<'a> {
        use AstNodes as N;
        match self.kind() {
            ExprKind::Missing if self.jsx_container_span().is_some() => N::JSXEmptyExpression(self),
            ExprKind::Missing => N::Elision(self),
            ExprKind::Ident(_) => N::IdentifierReference(self),
            ExprKind::PrivateIdentifier(_) => N::PrivateIdentifier(self),
            ExprKind::This => N::ThisExpression(self),
            ExprKind::Super => N::Super(self),
            ExprKind::Null => N::NullLiteral(self),
            ExprKind::True | ExprKind::False => N::BooleanLiteral(self),
            ExprKind::Number(_) => N::NumericLiteral(self),
            ExprKind::String(_) if self.is_jsx_text() => N::JSXText(self),
            ExprKind::String(_) => N::StringLiteral(self),
            ExprKind::BigInt(_) => N::BigIntLiteral(self),
            ExprKind::Regex(_) => N::RegExpLiteral(self),
            ExprKind::Template(_) => N::TemplateLiteral(self),
            ExprKind::TaggedTemplate(_) => N::TaggedTemplateExpression(self),
            ExprKind::Array(_) if is_assignment_target(self) => N::ArrayAssignmentTarget(self),
            ExprKind::Array(_) => N::ArrayExpression(self),
            ExprKind::Object(_) if is_assignment_target(self) => N::ObjectAssignmentTarget(self),
            ExprKind::Object(_) => N::ObjectExpression(self),
            ExprKind::Fn(func) => func.as_ast_nodes(),
            ExprKind::Class(class) => N::Class(class),
            ExprKind::Dot { name, .. } if name.bytes().starts_with(b"#") => {
                N::PrivateFieldExpression(self)
            }
            ExprKind::Dot { .. } => N::StaticMemberExpression(self),
            ExprKind::Index { .. } => N::ComputedMemberExpression(self),
            ExprKind::Call(_) => N::CallExpression(self),
            ExprKind::New(_) => N::NewExpression(self),
            ExprKind::Unary {
                op: UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec,
                ..
            } => N::UpdateExpression(self),
            ExprKind::Unary { .. } => N::UnaryExpression(self),
            ExprKind::Binary {
                op: BinOp::And | BinOp::Or | BinOp::Nullish,
                ..
            } => N::LogicalExpression(self),
            ExprKind::Binary {
                op: BinOp::Comma, ..
            } => N::SequenceExpression(self),
            ExprKind::Binary {
                op: BinOp::In,
                left,
                ..
            } if matches!(left.kind(), ExprKind::PrivateIdentifier(_)) => N::PrivateInExpression(self),
            ExprKind::Binary { .. } => N::BinaryExpression(self),
            ExprKind::Assign { op: None, .. } if is_default_in_assignment_target(self) => {
                N::AssignmentTargetWithDefault(self)
            }
            ExprKind::Assign { .. } => N::AssignmentExpression(self),
            ExprKind::Cond { .. } => N::ConditionalExpression(self),
            ExprKind::Spread(_) if self.jsx_container_span().is_some() => N::JSXSpreadChild(self),
            ExprKind::Spread(_) if is_assignment_target(self) => N::AssignmentTargetRest(self),
            ExprKind::Spread(_) => N::SpreadElement(Node::Expr(self)),
            ExprKind::Await(_) => N::AwaitExpression(self),
            ExprKind::Yield { .. } => N::YieldExpression(self),
            ExprKind::As { .. } | ExprKind::AsConst(_) if self.is_angle_bracket_assertion() => {
                N::TSTypeAssertion(self)
            }
            ExprKind::As { .. } | ExprKind::AsConst(_) => N::TSAsExpression(self),
            ExprKind::Satisfies { .. } => N::TSSatisfiesExpression(self),
            ExprKind::NonNull(_) => N::TSNonNullExpression(self),
            ExprKind::Instantiation { .. } => N::TSInstantiationExpression(self),
            ExprKind::Jsx(jsx) if jsx.is_fragment() => N::JSXFragment(self),
            ExprKind::Jsx(_) => N::JSXElement(self),
            ExprKind::ImportCall { .. } => N::ImportExpression(self),
            ExprKind::ImportMeta | ExprKind::NewTarget => N::MetaProperty(self),
        }
    }
}

/// Whether `e`, an `=` assignment, is the `a = 1` of `[a = 1] = b` or `({ a = 1 } = b)`.
fn is_default_in_assignment_target(e: Expr<'_>) -> bool {
    let is_element = match e.parent() {
        Node::Expr(parent) => matches!(parent.kind(), ExprKind::Array(_)),
        Node::Prop(prop) => prop.value() == Some(e) && !prop.is_jsx_attribute(),
        _ => false,
    };
    is_element && is_assignment_target(e)
}

fn parent_of_expr<'a>(e: Expr<'a>, above: Level) -> AstNodes<'a> {
    use AstNodes as N;
    if above < Level::Chain && is_chain_root(e) {
        return N::ChainExpression(e);
    }
    // `{...e}` and `{}` are the container themselves.
    if above < Level::JsxContainer
        && e.jsx_container_span().is_some()
        && !matches!(e.kind(), ExprKind::Spread(_))
    {
        return N::JSXExpressionContainer(e);
    }
    match e.parent() {
        Node::File(file) => N::Program(Program(file)),
        Node::Expr(parent) => match parent.kind() {
            ExprKind::Binary {
                op: BinOp::Comma, ..
            } => {
                let mut root = parent;
                while is_inner_comma(root)
                    && let Node::Expr(outer) = root.parent()
                {
                    root = outer;
                }
                N::SequenceExpression(root)
            }
            _ => parent.as_chain_element(),
        },
        Node::Stmt(statement) => match statement.kind() {
            StmtKind::Expr(_) if statement.directive().is_some() => N::Directive(statement),
            StmtKind::Expr(_) => N::ExpressionStatement(ExpressionStatement::Stmt(statement)),
            _ => inner_of_stmt(statement),
        },
        Node::VarDecl(declaration) => declaration.as_ast_nodes(),
        Node::Param(param) if param.default() == Some(e) => param.as_ast_nodes(),
        Node::Param(_) => N::Decorator(e),
        Node::PatProp(prop) if prop.default() == Some(e) => N::AssignmentPattern(Node::PatProp(prop)),
        Node::PatProp(prop) => N::BindingProperty(prop),
        Node::PatElem(element) => N::AssignmentPattern(Node::PatElem(element)),
        Node::Prop(prop) => prop.as_ast_nodes(),
        Node::Member(member) if member.decorators().any(|it| it == e) => N::Decorator(e),
        Node::Member(member) => member.as_ast_nodes(),
        Node::Func(func) => N::ExpressionStatement(ExpressionStatement::ArrowBody(func)),
        Node::EnumMember(member) => N::TSEnumMember(member),
        Node::Case(case) => N::SwitchCase(case),
        Node::Class(class) if class.extends() == Some(e) => N::Class(class),
        Node::Class(_) => N::Decorator(e),
        Node::Type(ty) => ty.as_ast_nodes(),
        other => node_as_ast_nodes(other),
    }
}

impl<'a> AsAstNodes<'a> for Func<'a> {
    /// For a signature or a function type, which oxc has no `Function` in, the member or the
    /// type.
    fn as_ast_nodes(self) -> AstNodes<'a> {
        use AstNodes as N;
        match (self.kind(), self.owner()) {
            (FnKind::Arrow, _) => N::ArrowFunctionExpression(self),
            (_, Node::Type(ty)) => ty.as_ast_nodes(),
            (FnKind::StaticBlock, Node::Member(member)) => N::StaticBlock(member),
            (_, Node::Member(member)) if !matches!(member.parent(), Node::Class(_)) => {
                member.as_ast_nodes()
            }
            (FnKind::IndexSignature, Node::Member(member)) => N::TSIndexSignature(member),
            _ => N::Function(self),
        }
    }
}

impl<'a> AsAstNodes<'a> for Class<'a> {
    #[inline]
    fn as_ast_nodes(self) -> AstNodes<'a> {
        AstNodes::Class(self)
    }
}

impl<'a> AsAstNodes<'a> for Param<'a> {
    fn as_ast_nodes(self) -> AstNodes<'a> {
        match self.func().and_then(Func::this_param) {
            Some(this) if this == self => AstNodes::TSThisParameter(self),
            _ if self.is_rest() => AstNodes::FormalParameterRest(self),
            _ => AstNodes::FormalParameter(self),
        }
    }
}

impl<'a> AsAstNodes<'a> for Member<'a> {
    fn as_ast_nodes(self) -> AstNodes<'a> {
        use AstNodes as N;
        let is_in_class = matches!(self.parent(), Node::Class(_));
        match self.kind() {
            MemberKind::IndexSignature => N::TSIndexSignature(self),
            MemberKind::StaticBlock => N::StaticBlock(self),
            MemberKind::CallSignature => N::TSCallSignatureDeclaration(self),
            MemberKind::ConstructSignature => N::TSConstructSignatureDeclaration(self),
            MemberKind::Property if !is_in_class => N::TSPropertySignature(self),
            MemberKind::Property if self.flags().contains(Flags::ACCESSOR) => N::AccessorProperty(self),
            MemberKind::Property => N::PropertyDefinition(self),
            _ if !is_in_class => N::TSMethodSignature(self),
            _ => N::MethodDefinition(self),
        }
    }
}

impl<'a> AsAstNodes<'a> for Prop<'a> {
    fn as_ast_nodes(self) -> AstNodes<'a> {
        use AstNodes as N;
        let is_spread = self.kind() == PropKind::Spread;
        if self.is_jsx_attribute() || matches!(self.parent(), Node::Expr(e) if matches!(e.kind(), ExprKind::Jsx(_))) {
            return if is_spread { N::JSXSpreadAttribute(self) } else { N::JSXAttribute(self) };
        }
        let is_target = matches!(self.parent(), Node::Expr(object) if is_assignment_target(object));
        match (is_target, self.kind()) {
            (false, PropKind::Spread) => N::SpreadElement(Node::Prop(self)),
            (false, _) => N::ObjectProperty(self),
            (true, PropKind::Spread) => match self.value() {
                Some(value) => N::AssignmentTargetRest(value),
                None => N::ObjectProperty(self),
            },
            (true, PropKind::Shorthand) => N::AssignmentTargetPropertyIdentifier(self),
            (true, _) => N::AssignmentTargetPropertyProperty(self),
        }
    }
}

impl<'a> AsAstNodes<'a> for VarDecl<'a> {
    fn as_ast_nodes(self) -> AstNodes<'a> {
        match self.parent() {
            Node::Stmt(statement) if matches!(statement.kind(), StmtKind::Try { .. }) => {
                AstNodes::CatchParameter(self)
            }
            _ => AstNodes::VariableDeclarator(self),
        }
    }
}

/// The statement without the `export` around it.
fn inner_of_stmt<'a>(statement: Stmt<'a>) -> AstNodes<'a> {
    use AstNodes as N;
    match statement.kind() {
        StmtKind::Empty => N::EmptyStatement(statement),
        StmtKind::Debugger => N::DebuggerStatement(statement),
        StmtKind::Expr(_) if statement.directive().is_some() => N::Directive(statement),
        StmtKind::Expr(_) => N::ExpressionStatement(ExpressionStatement::Stmt(statement)),
        StmtKind::Var(_) => N::VariableDeclaration(statement),
        StmtKind::Fn(func) => N::Function(func),
        StmtKind::Class(class) => N::Class(class),
        StmtKind::Interface(_) => N::TSInterfaceDeclaration(statement),
        StmtKind::TypeAlias(_) => N::TSTypeAliasDeclaration(statement),
        StmtKind::Enum(_) => N::TSEnumDeclaration(statement),
        StmtKind::Module(module) if matches!(module.name(), ModuleName::Global) => {
            N::TSGlobalDeclaration(statement)
        }
        StmtKind::Module(_) => N::TSModuleDeclaration(statement),
        StmtKind::Return(_) => N::ReturnStatement(statement),
        StmtKind::If { .. } => N::IfStatement(statement),
        StmtKind::For { .. } => N::ForStatement(statement),
        StmtKind::ForIn { .. } => N::ForInStatement(statement),
        StmtKind::ForOf { .. } => N::ForOfStatement(statement),
        StmtKind::While { .. } => N::WhileStatement(statement),
        StmtKind::DoWhile { .. } => N::DoWhileStatement(statement),
        StmtKind::Block(_) => N::BlockStatement(statement),
        StmtKind::With { .. } => N::WithStatement(statement),
        StmtKind::Switch { .. } => N::SwitchStatement(statement),
        StmtKind::Try { .. } => N::TryStatement(statement),
        StmtKind::Throw(_) => N::ThrowStatement(statement),
        StmtKind::Break(_) => N::BreakStatement(statement),
        StmtKind::Continue(_) => N::ContinueStatement(statement),
        StmtKind::Labeled { .. } => N::LabeledStatement(statement),
        StmtKind::Import(_) => N::ImportDeclaration(statement),
        StmtKind::ImportEquals(_) => N::TSImportEqualsDeclaration(statement),
        StmtKind::ExportNamed(_) => N::ExportNamedDeclaration(statement),
        StmtKind::ExportStar { .. } => N::ExportAllDeclaration(statement),
        StmtKind::ExportDefault(_) => N::ExportDefaultDeclaration(statement),
        StmtKind::ExportAssign(_) => N::TSExportAssignment(statement),
        StmtKind::ExportAsNamespace(_) => N::TSNamespaceExportDeclaration(statement),
    }
}

/// `export` or `export default` is written before `statement`, which is a declaration.
fn export_around<'a>(statement: Stmt<'a>) -> Option<AstNodes<'a>> {
    if matches!(
        statement.kind(),
        StmtKind::ExportNamed(_) | StmtKind::ExportDefault(_) | StmtKind::ExportStar { .. }
    ) {
        return None;
    }
    let flags = statement.flags();
    match flags.contains(Flags::EXPORT) {
        true if flags.contains(Flags::DEFAULT) => Some(AstNodes::ExportDefaultDeclaration(statement)),
        true => Some(AstNodes::ExportNamedDeclaration(statement)),
        false => None,
    }
}

impl<'a> AsAstNodes<'a> for Stmt<'a> {
    /// With the `export` around a declaration.
    fn as_ast_nodes(self) -> AstNodes<'a> {
        export_around(self).unwrap_or_else(|| inner_of_stmt(self))
    }
}

/// What `statement`, with its `export`, is in.
fn parent_of_stmt<'a>(statement: Stmt<'a>) -> AstNodes<'a> {
    use AstNodes as N;
    match statement.parent() {
        Node::File(file) => N::Program(Program(file)),
        Node::Func(func) if func.kind() == FnKind::StaticBlock => func.as_ast_nodes(),
        Node::Func(func) => N::FunctionBody(func),
        Node::Case(case) => N::SwitchCase(case),
        Node::Stmt(parent) => match parent.kind() {
            StmtKind::Try { handler, .. } if handler == Some(statement) => N::CatchClause(parent),
            // `namespace A.B { .. }` is one node, and what is between the braces is in it.
            StmtKind::Module(_) => N::TSModuleBlock(parent),
            _ => inner_of_stmt(parent),
        },
        other => node_as_ast_nodes(other),
    }
}

impl<'a> AsAstNodes<'a> for TypeNode<'a> {
    fn as_ast_nodes(self) -> AstNodes<'a> {
        use AstNodes as N;
        match self.kind() {
            TypeKind::Ref { .. } | TypeKind::Heritage { .. } => match self.parent() {
                Node::Class(class) if class.implements().iter().any(|it| it == self) => {
                    N::TSClassImplements(self)
                }
                Node::Stmt(statement) if matches!(statement.kind(), StmtKind::Interface(_)) => {
                    N::TSInterfaceHeritage(self)
                }
                _ => N::TSTypeReference(self),
            },
            TypeKind::Error => N::TSKeywordType(self),
            TypeKind::Keyword(Keyword::This) => N::TSThisType(self),
            TypeKind::Keyword(_) => N::TSKeywordType(self),
            TypeKind::StringLit(_)
            | TypeKind::NumberLit(_)
            | TypeKind::BigIntLit { .. }
            | TypeKind::BoolLit(_) => N::TSLiteralType(self),
            TypeKind::Template(_) => N::TSTemplateLiteralType(self),
            TypeKind::Array(_) => N::TSArrayType(self),
            TypeKind::Tuple(_) => N::TSTupleType(self),
            TypeKind::Union(_) => N::TSUnionType(self),
            TypeKind::Intersection(_) => N::TSIntersectionType(self),
            TypeKind::Fn(func) if func.kind() == FnKind::ConstructorType => N::TSConstructorType(self),
            TypeKind::Fn(_) => N::TSFunctionType(self),
            TypeKind::Object(_) => N::TSTypeLiteral(self),
            TypeKind::Cond { .. } => N::TSConditionalType(self),
            TypeKind::Infer(_) => N::TSInferType(self),
            TypeKind::Mapped(_) => N::TSMappedType(self),
            TypeKind::IndexedAccess { .. } => N::TSIndexedAccessType(self),
            TypeKind::Keyof(_) | TypeKind::Readonly(_) | TypeKind::UniqueSymbol => N::TSTypeOperator(self),
            TypeKind::Typeof { .. } => N::TSTypeQuery(self),
            TypeKind::Import { is_typeof: true, .. } => N::TSTypeQuery(self),
            TypeKind::Import { .. } => N::TSImportType(self),
            TypeKind::Predicate { .. } => N::TSTypePredicate(self),
        }
    }

    fn ast_parent(self) -> AstNodes<'a> {
        use AstNodes as N;
        let arguments = |owner: Node<'a>| N::TSTypeParameterInstantiation(owner);
        match self.parent() {
            Node::Type(parent) => match parent.kind() {
                TypeKind::Ref { .. }
                | TypeKind::Heritage { .. }
                | TypeKind::Typeof { .. }
                | TypeKind::Import { .. } => arguments(Node::Type(parent)),
                _ => parent.as_ast_nodes(),
            },
            Node::TupleElem(element) => element.as_ast_nodes(),
            Node::TypeParam(param) => match param.parent() {
                // The `C` of `[K in C]` is directly in the mapped type.
                Node::Type(owner) if matches!(owner.kind(), TypeKind::Mapped(_)) => {
                    owner.as_ast_nodes()
                }
                _ => N::TSTypeParameter(param),
            },
            Node::Func(_) | Node::Param(_) | Node::VarDecl(_) | Node::Member(_) => {
                N::TSTypeAnnotation(self)
            }
            Node::Class(class) if class.implements().iter().any(|it| it == self) => N::Class(class),
            Node::Class(class) => arguments(Node::Class(class)),
            Node::Stmt(statement) => inner_of_stmt(statement),
            Node::Expr(e) => match e.kind() {
                ExprKind::As { .. } | ExprKind::Satisfies { .. } => e.as_chain_element(),
                _ => arguments(Node::Expr(e)),
            },
            other => node_as_ast_nodes(other),
        }
    }
}

impl<'a> AsAstNodes<'a> for TupleElem<'a> {
    /// For an element that is only a type, the tuple type.
    fn as_ast_nodes(self) -> AstNodes<'a> {
        match () {
            () if self.name().is_some() => AstNodes::TSNamedTupleMember(self),
            () if self.is_rest() => AstNodes::TSRestType(self),
            () if self.is_optional() => AstNodes::TSOptionalType(self),
            () => node_as_ast_nodes(self.parent()),
        }
    }
}

impl<'a> AsAstNodes<'a> for Pat<'a> {
    fn as_ast_nodes(self) -> AstNodes<'a> {
        match self.kind() {
            PatKind::Missing | PatKind::Ident(_) => AstNodes::BindingIdentifier(self),
            PatKind::Object(_) => AstNodes::ObjectPattern(self),
            PatKind::Array(_) => AstNodes::ArrayPattern(self),
        }
    }

    fn ast_parent(self) -> AstNodes<'a> {
        match self.parent() {
            Node::PatProp(prop) if prop.is_rest() => AstNodes::BindingRestElement(Node::PatProp(prop)),
            Node::PatProp(prop) if prop.default().is_some() => {
                AstNodes::AssignmentPattern(Node::PatProp(prop))
            }
            Node::PatElem(element) if element.is_rest() => {
                AstNodes::BindingRestElement(Node::PatElem(element))
            }
            Node::PatElem(element) if element.default().is_some() => {
                AstNodes::AssignmentPattern(Node::PatElem(element))
            }
            Node::PatElem(element) => node_as_ast_nodes(element.parent()),
            other => node_as_ast_nodes(other),
        }
    }
}

/// What a node of `bun_lint::ast` is. A statement is with its `export`.
pub(crate) fn node_as_ast_nodes<'a>(node: Node<'a>) -> AstNodes<'a> {
    use AstNodes as N;
    match node {
        Node::File(file) => N::Program(Program(file)),
        Node::Expr(it) => it.as_chain_element(),
        Node::Stmt(it) => it.as_ast_nodes(),
        Node::Type(it) => it.as_ast_nodes(),
        Node::Pat(it) => it.as_ast_nodes(),
        Node::PatProp(it) => N::BindingProperty(it),
        Node::PatElem(it) => match it.pat() {
            Some(pat) => pat.as_ast_nodes(),
            None => node_as_ast_nodes(it.parent()),
        },
        Node::Func(it) => it.as_ast_nodes(),
        Node::Param(it) => it.as_ast_nodes(),
        Node::TypeParam(it) => N::TSTypeParameter(it),
        Node::Class(it) => N::Class(it),
        Node::Member(it) => it.as_ast_nodes(),
        Node::Prop(it) => it.as_ast_nodes(),
        Node::VarDecl(it) => it.as_ast_nodes(),
        Node::Case(it) => N::SwitchCase(it),
        Node::EnumMember(it) => N::TSEnumMember(it),
        Node::ImportSpec(it) => N::ImportSpecifier(it),
        Node::ExportSpec(it) => N::ExportSpecifier(it),
        Node::TupleElem(it) => it.as_ast_nodes(),
    }
}

/// What the function or the class that `owner` is, is in.
fn parent_of_owner<'a>(owner: Node<'a>) -> AstNodes<'a> {
    match owner {
        Node::Expr(e) => parent_of_expr(e, Level::Itself),
        Node::Stmt(statement) => {
            export_around(statement).unwrap_or_else(|| parent_of_stmt(statement))
        }
        Node::Member(member) => member.as_ast_nodes(),
        Node::Type(ty) => ty.ast_parent(),
        other => node_as_ast_nodes(other),
    }
}

impl<'a> AstNodes<'a> {
    /// What it is directly in. `Program` is in itself.
    pub(crate) fn parent(self) -> AstNodes<'a> {
        use AstNodes as N;
        match self {
            N::Program(_) => self,

            N::ChainExpression(e) => parent_of_expr(e, Level::Chain),
            N::JSXExpressionContainer(e) => parent_of_expr(e, Level::JsxContainer),
            N::JSXOpeningElement(e) => e.as_chain_element(),
            N::Decorator(e) => match e.parent() {
                Node::Class(class) => N::Class(class),
                other => node_as_ast_nodes(other),
            },
            N::AssignmentTargetRest(e) => match e.kind() {
                ExprKind::Spread(_) => parent_of_expr(e, Level::Itself),
                // What `...` is written before in an object.
                _ => match e.parent() {
                    Node::Prop(prop) => node_as_ast_nodes(prop.parent()),
                    other => node_as_ast_nodes(other),
                },
            },
            N::IdentifierReference(e)
            | N::BooleanLiteral(e)
            | N::NullLiteral(e)
            | N::NumericLiteral(e)
            | N::BigIntLiteral(e)
            | N::RegExpLiteral(e)
            | N::StringLiteral(e)
            | N::TemplateLiteral(e)
            | N::ThisExpression(e)
            | N::Super(e)
            | N::ArrayExpression(e)
            | N::ObjectExpression(e)
            | N::StaticMemberExpression(e)
            | N::ComputedMemberExpression(e)
            | N::PrivateFieldExpression(e)
            | N::CallExpression(e)
            | N::NewExpression(e)
            | N::ImportExpression(e)
            | N::MetaProperty(e)
            | N::TaggedTemplateExpression(e)
            | N::UnaryExpression(e)
            | N::UpdateExpression(e)
            | N::BinaryExpression(e)
            | N::LogicalExpression(e)
            | N::PrivateInExpression(e)
            | N::AssignmentExpression(e)
            | N::ConditionalExpression(e)
            | N::AwaitExpression(e)
            | N::YieldExpression(e)
            | N::TSAsExpression(e)
            | N::TSSatisfiesExpression(e)
            | N::TSTypeAssertion(e)
            | N::TSNonNullExpression(e)
            | N::TSInstantiationExpression(e)
            | N::JSXElement(e)
            | N::JSXFragment(e)
            | N::JSXText(e)
            | N::JSXEmptyExpression(e)
            | N::Elision(e)
            | N::PrivateIdentifier(e)
            | N::SequenceExpression(e)
            | N::JSXSpreadChild(e)
            | N::ArrayAssignmentTarget(e)
            | N::ObjectAssignmentTarget(e)
            | N::AssignmentTargetWithDefault(e) => parent_of_expr(e, Level::Itself),

            N::SpreadElement(Node::Expr(e)) => parent_of_expr(e, Level::Itself),
            N::SpreadElement(node) => node_as_ast_nodes(node.parent()),

            N::ExpressionStatement(ExpressionStatement::Stmt(statement)) => parent_of_stmt(statement),
            N::ExpressionStatement(ExpressionStatement::ArrowBody(func)) => N::FunctionBody(func),

            N::Function(func) | N::ArrowFunctionExpression(func) => parent_of_owner(func.owner()),
            N::FunctionBody(func) | N::FormalParameters(func) => func.as_ast_nodes(),
            N::Class(class) => parent_of_owner(class.owner()),
            N::ClassBody(class) => N::Class(class),
            N::FormalParameter(param) | N::FormalParameterRest(param) => match param.func() {
                Some(func) if func.kind() == FnKind::IndexSignature => func.as_ast_nodes(),
                Some(func) => N::FormalParameters(func),
                None => N::Program(Program(param.file())),
            },
            N::TSThisParameter(param) => match param.func() {
                Some(func) => func.as_ast_nodes(),
                None => N::Program(Program(param.file())),
            },

            N::MethodDefinition(member)
            | N::PropertyDefinition(member)
            | N::AccessorProperty(member)
            | N::StaticBlock(member)
            | N::TSIndexSignature(member)
            | N::TSPropertySignature(member)
            | N::TSMethodSignature(member)
            | N::TSCallSignatureDeclaration(member)
            | N::TSConstructSignatureDeclaration(member) => match member.parent() {
                Node::Class(class) => N::ClassBody(class),
                Node::Stmt(interface) => N::TSInterfaceBody(interface),
                other => node_as_ast_nodes(other),
            },

            N::JSXAttribute(prop) | N::JSXSpreadAttribute(prop) => match prop.parent() {
                Node::Expr(element) => N::JSXOpeningElement(element),
                other => node_as_ast_nodes(other),
            },
            N::ObjectProperty(prop)
            | N::AssignmentTargetPropertyIdentifier(prop)
            | N::AssignmentTargetPropertyProperty(prop) => node_as_ast_nodes(prop.parent()),

            N::VariableDeclarator(declaration) => match declaration.parent() {
                Node::Stmt(statement) => N::VariableDeclaration(statement),
                other => node_as_ast_nodes(other),
            },
            N::CatchParameter(declaration) => match declaration.parent() {
                Node::Stmt(statement) => N::CatchClause(statement),
                other => node_as_ast_nodes(other),
            },

            N::ExportNamedDeclaration(statement) | N::ExportDefaultDeclaration(statement) => {
                parent_of_stmt(statement)
            }
            N::CatchClause(statement) => N::TryStatement(statement),
            N::TSInterfaceBody(statement) => N::TSInterfaceDeclaration(statement),
            N::TSEnumBody(statement) => N::TSEnumDeclaration(statement),
            N::TSModuleBlock(statement) => inner_of_stmt(statement),
            N::Directive(statement)
            | N::BlockStatement(statement)
            | N::EmptyStatement(statement)
            | N::DebuggerStatement(statement)
            | N::VariableDeclaration(statement)
            | N::ReturnStatement(statement)
            | N::IfStatement(statement)
            | N::ForStatement(statement)
            | N::ForInStatement(statement)
            | N::ForOfStatement(statement)
            | N::WhileStatement(statement)
            | N::DoWhileStatement(statement)
            | N::WithStatement(statement)
            | N::SwitchStatement(statement)
            | N::TryStatement(statement)
            | N::ThrowStatement(statement)
            | N::BreakStatement(statement)
            | N::ContinueStatement(statement)
            | N::LabeledStatement(statement)
            | N::ImportDeclaration(statement)
            | N::ExportAllDeclaration(statement)
            | N::TSInterfaceDeclaration(statement)
            | N::TSTypeAliasDeclaration(statement)
            | N::TSEnumDeclaration(statement)
            | N::TSModuleDeclaration(statement)
            | N::TSGlobalDeclaration(statement)
            | N::TSImportEqualsDeclaration(statement)
            | N::TSExportAssignment(statement)
            | N::TSNamespaceExportDeclaration(statement) => {
                export_around(statement).unwrap_or_else(|| parent_of_stmt(statement))
            }

            N::SwitchCase(case) => match case.parent() {
                Node::Stmt(statement) => N::SwitchStatement(statement),
                other => node_as_ast_nodes(other),
            },
            N::TSEnumMember(member) => match member.parent() {
                Node::Stmt(statement) => N::TSEnumBody(statement),
                other => node_as_ast_nodes(other),
            },
            N::ImportSpecifier(spec) => N::ImportDeclaration(spec.import().stmt()),
            N::ExportSpecifier(spec) => N::ExportNamedDeclaration(spec.export().stmt()),

            N::BindingIdentifier(pat) | N::ObjectPattern(pat) | N::ArrayPattern(pat) => pat.ast_parent(),
            N::BindingProperty(prop) => node_as_ast_nodes(prop.parent()),
            N::AssignmentPattern(Node::PatProp(prop)) => N::BindingProperty(prop),
            N::AssignmentPattern(node) | N::BindingRestElement(node) => node_as_ast_nodes(node.parent()),

            N::TSTypeAnnotation(ty) => node_as_ast_nodes(ty.parent()),
            N::TSKeywordType(ty)
            | N::TSThisType(ty)
            | N::TSTypeReference(ty)
            | N::TSLiteralType(ty)
            | N::TSTemplateLiteralType(ty)
            | N::TSArrayType(ty)
            | N::TSTupleType(ty)
            | N::TSUnionType(ty)
            | N::TSIntersectionType(ty)
            | N::TSFunctionType(ty)
            | N::TSConstructorType(ty)
            | N::TSTypeLiteral(ty)
            | N::TSConditionalType(ty)
            | N::TSInferType(ty)
            | N::TSMappedType(ty)
            | N::TSIndexedAccessType(ty)
            | N::TSTypeOperator(ty)
            | N::TSTypeQuery(ty)
            | N::TSImportType(ty)
            | N::TSTypePredicate(ty)
            | N::TSClassImplements(ty)
            | N::TSInterfaceHeritage(ty) => ty.ast_parent(),

            N::TSNamedTupleMember(element) | N::TSOptionalType(element) | N::TSRestType(element) => {
                node_as_ast_nodes(element.parent())
            }
            N::TSTypeParameter(param) => match param.parent() {
                Node::Type(ty) => ty.as_ast_nodes(),
                owner => N::TSTypeParameterDeclaration(owner),
            },
            N::TSTypeParameterInstantiation(owner) | N::TSTypeParameterDeclaration(owner) => match owner {
                Node::Stmt(statement) => inner_of_stmt(statement),
                Node::Expr(e) if matches!(e.kind(), ExprKind::Jsx(_)) => N::JSXOpeningElement(e),
                owner => node_as_ast_nodes(owner),
            },
        }
    }

    /// Itself, its parent, and so on up to `Program`.
    pub(crate) fn ancestors(self) -> impl Iterator<Item = AstNodes<'a>> {
        std::iter::successors(Some(self), |node| match node {
            AstNodes::Program(_) => None,
            node => Some(node.parent()),
        })
    }

    /// The parent of a `ChainExpression`, anything else itself.
    pub(crate) fn without_chain_expression(self) -> AstNodes<'a> {
        match self {
            AstNodes::ChainExpression(_) => self.parent().without_chain_expression(),
            _ => self,
        }
    }

    /// Whether it is a call or a `new` expression whose callee is `e`.
    pub(crate) fn is_call_like_callee(self, e: Expr<'a>) -> bool {
        match self {
            AstNodes::CallExpression(call) | AstNodes::NewExpression(call) => match call.kind() {
                ExprKind::Call(call) | ExprKind::New(call) => call.callee() == e,
                _ => false,
            },
            _ => false,
        }
    }

    /// The range that the node has in oxc.
    pub(crate) fn span(self) -> Span {
        use AstNodes as N;
        match self {
            N::Program(file) => file.0.span(),
            N::JSXExpressionContainer(e) | N::JSXSpreadChild(e) => {
                e.jsx_container_span().unwrap_or_else(|| e.span())
            }
            N::JSXOpeningElement(e) => match e.kind() {
                ExprKind::Jsx(jsx) => jsx.opening_span(),
                _ => e.span(),
            },
            N::Decorator(e) => {
                let outer = e.outer_span();
                let at = skip_trivia_back(e.file().text(), outer.start).saturating_sub(1);
                Span::new(at, outer.end)
            }
            N::AssignmentTargetRest(e) => match (e.kind(), e.parent()) {
                (ExprKind::Spread(_), _) => e.span(),
                (_, Node::Prop(prop)) => prop.span(),
                _ => e.span(),
            },
            N::IdentifierReference(e)
            | N::BooleanLiteral(e)
            | N::NullLiteral(e)
            | N::NumericLiteral(e)
            | N::BigIntLiteral(e)
            | N::RegExpLiteral(e)
            | N::StringLiteral(e)
            | N::TemplateLiteral(e)
            | N::ThisExpression(e)
            | N::Super(e)
            | N::ArrayExpression(e)
            | N::ObjectExpression(e)
            | N::StaticMemberExpression(e)
            | N::ComputedMemberExpression(e)
            | N::PrivateFieldExpression(e)
            | N::CallExpression(e)
            | N::NewExpression(e)
            | N::ImportExpression(e)
            | N::MetaProperty(e)
            | N::TaggedTemplateExpression(e)
            | N::UnaryExpression(e)
            | N::UpdateExpression(e)
            | N::BinaryExpression(e)
            | N::LogicalExpression(e)
            | N::PrivateInExpression(e)
            | N::AssignmentExpression(e)
            | N::ConditionalExpression(e)
            | N::AwaitExpression(e)
            | N::YieldExpression(e)
            | N::TSAsExpression(e)
            | N::TSSatisfiesExpression(e)
            | N::TSTypeAssertion(e)
            | N::TSNonNullExpression(e)
            | N::TSInstantiationExpression(e)
            | N::JSXElement(e)
            | N::JSXFragment(e)
            | N::JSXText(e)
            | N::JSXEmptyExpression(e)
            | N::Elision(e)
            | N::PrivateIdentifier(e)
            | N::SequenceExpression(e)
            | N::ChainExpression(e)
            | N::ArrayAssignmentTarget(e)
            | N::ObjectAssignmentTarget(e)
            | N::AssignmentTargetWithDefault(e) => e.span(),
            N::AssignmentPattern(Node::PatProp(prop)) => match prop.default() {
                Some(default) => prop.value().span().to(default.span()),
                None => prop.span(),
            },
            N::SpreadElement(node) | N::AssignmentPattern(node) | N::BindingRestElement(node) => node.span(),
            N::ExpressionStatement(statement) => statement.span(),
            N::Function(func) | N::ArrowFunctionExpression(func) => func.estree_span(),
            N::FunctionBody(func) => match func.body() {
                FnBody::Expr(e) => e.span(),
                _ => func.body_span().unwrap_or_else(|| Span::empty(func.span().end)),
            },
            N::FormalParameters(func) => func.params_span().unwrap_or_else(|| func.span()),
            N::Class(class) => class.estree_span(),
            N::ClassBody(class) => class.body_span(),
            N::FormalParameter(param) | N::FormalParameterRest(param) | N::TSThisParameter(param) => param.span(),
            N::MethodDefinition(member)
            | N::PropertyDefinition(member)
            | N::AccessorProperty(member)
            | N::StaticBlock(member)
            | N::TSIndexSignature(member)
            | N::TSPropertySignature(member)
            | N::TSMethodSignature(member)
            | N::TSCallSignatureDeclaration(member)
            | N::TSConstructSignatureDeclaration(member) => member.span(),
            N::ObjectProperty(prop)
            | N::JSXAttribute(prop)
            | N::JSXSpreadAttribute(prop)
            | N::AssignmentTargetPropertyIdentifier(prop)
            | N::AssignmentTargetPropertyProperty(prop) => prop.span(),
            N::VariableDeclarator(declaration) | N::CatchParameter(declaration) => declaration.span(),
            N::ExportNamedDeclaration(statement) | N::ExportDefaultDeclaration(statement) => {
                statement.export_span().unwrap_or_else(|| statement.span())
            }
            N::CatchClause(statement) => statement.catch_clause_span().unwrap_or_else(|| statement.span()),
            N::TSInterfaceBody(statement) => match statement.kind() {
                StmtKind::Interface(interface) => interface.body_span(),
                _ => statement.span(),
            },
            N::TSEnumBody(statement) => match statement.kind() {
                StmtKind::Enum(it) => it.body_span(),
                _ => statement.span(),
            },
            N::TSModuleBlock(statement) => match statement.kind() {
                StmtKind::Module(module) => module.innermost().body_span().unwrap_or_else(|| statement.span()),
                _ => statement.span(),
            },
            N::Directive(statement)
            | N::BlockStatement(statement)
            | N::EmptyStatement(statement)
            | N::DebuggerStatement(statement)
            | N::VariableDeclaration(statement)
            | N::ReturnStatement(statement)
            | N::IfStatement(statement)
            | N::ForStatement(statement)
            | N::ForInStatement(statement)
            | N::ForOfStatement(statement)
            | N::WhileStatement(statement)
            | N::DoWhileStatement(statement)
            | N::WithStatement(statement)
            | N::SwitchStatement(statement)
            | N::TryStatement(statement)
            | N::ThrowStatement(statement)
            | N::BreakStatement(statement)
            | N::ContinueStatement(statement)
            | N::LabeledStatement(statement)
            | N::ImportDeclaration(statement)
            | N::ExportAllDeclaration(statement)
            | N::TSInterfaceDeclaration(statement)
            | N::TSTypeAliasDeclaration(statement)
            | N::TSEnumDeclaration(statement)
            | N::TSModuleDeclaration(statement)
            | N::TSGlobalDeclaration(statement)
            | N::TSImportEqualsDeclaration(statement)
            | N::TSExportAssignment(statement)
            | N::TSNamespaceExportDeclaration(statement) => statement.span_without_export(),
            N::SwitchCase(case) => case.span(),
            N::TSEnumMember(member) => member.span(),
            N::ImportSpecifier(spec) => spec.span(),
            N::ExportSpecifier(spec) => spec.span(),
            N::BindingIdentifier(pat) | N::ObjectPattern(pat) | N::ArrayPattern(pat) => pat.span(),
            N::BindingProperty(prop) => prop.span(),
            N::TSTypeAnnotation(ty) => ty.annotation_span(),
            N::TSKeywordType(ty)
            | N::TSThisType(ty)
            | N::TSTypeReference(ty)
            | N::TSLiteralType(ty)
            | N::TSTemplateLiteralType(ty)
            | N::TSArrayType(ty)
            | N::TSTupleType(ty)
            | N::TSUnionType(ty)
            | N::TSIntersectionType(ty)
            | N::TSFunctionType(ty)
            | N::TSConstructorType(ty)
            | N::TSTypeLiteral(ty)
            | N::TSConditionalType(ty)
            | N::TSInferType(ty)
            | N::TSMappedType(ty)
            | N::TSIndexedAccessType(ty)
            | N::TSTypeOperator(ty)
            | N::TSTypeQuery(ty)
            | N::TSImportType(ty)
            | N::TSTypePredicate(ty)
            | N::TSClassImplements(ty)
            | N::TSInterfaceHeritage(ty) => ty.span(),
            N::TSNamedTupleMember(element) | N::TSOptionalType(element) | N::TSRestType(element) => element.span(),
            N::TSTypeParameter(param) => param.span(),
            N::TSTypeParameterInstantiation(owner) => {
                type_arguments_of(owner).and_then(|it| it.angle_brackets_span()).unwrap_or_else(|| owner.span())
            }
            N::TSTypeParameterDeclaration(owner) => {
                type_parameters_of(owner).and_then(|it| it.angle_brackets_span()).unwrap_or_else(|| owner.span())
            }
        }
    }
}

impl Spanned for AstNodes<'_> {
    fn span(&self) -> Span {
        AstNodes::span(*self)
    }
}

/// The type arguments that `owner` has.
pub(crate) fn type_arguments_of<'a>(owner: Node<'a>) -> Option<bun_lint::ast::List<'a, TypeNode<'a>>> {
    match owner {
        Node::Expr(e) => match e.kind() {
            ExprKind::Call(call) | ExprKind::New(call) | ExprKind::TaggedTemplate(call) => Some(call.type_args()),
            ExprKind::Instantiation { type_args, .. } => Some(type_args),
            ExprKind::Jsx(jsx) => Some(jsx.type_args()),
            _ => None,
        },
        Node::Type(ty) => match ty.kind() {
            TypeKind::Ref { args, .. }
            | TypeKind::Heritage { args, .. }
            | TypeKind::Typeof { args, .. }
            | TypeKind::Import { args, .. } => Some(args),
            _ => None,
        },
        Node::Class(class) => Some(class.extends_args()),
        _ => None,
    }
}

/// The type parameters that `owner` declares.
pub(crate) fn type_parameters_of<'a>(owner: Node<'a>) -> Option<bun_lint::ast::List<'a, TypeParam<'a>>> {
    match owner {
        Node::Func(func) => Some(func.type_params()),
        Node::Class(class) => Some(class.type_params()),
        Node::Stmt(statement) => match statement.kind() {
            StmtKind::Interface(interface) => Some(interface.type_params()),
            StmtKind::TypeAlias(alias) => Some(alias.type_params()),
            _ => None,
        },
        _ => None,
    }
}

