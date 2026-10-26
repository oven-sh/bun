//! The syntax tree as oxc and Prettier see it, for questions about a node's surroundings.
//!
//! Much of what decides how a node is printed depends on its parent: does it need parentheses there, does it start a
//! statement, is it the callee of a call? The code this crate is ported from asks those questions in terms of ESTree,
//! which has nodes that `bun_lint::ast` doesn't have (`ChainExpression`, `FunctionBody`, `FormalParameters`,
//! `TSTypeAnnotation`, `JSXExpressionContainer`, `ExportNamedDeclaration`, ..) and splits kinds that are a single kind
//! there (`LogicalExpression` and `BinaryExpression`).
//!
//! [`AstNodes`] is that tree. Nothing is converted or stored. A value is just a kind plus a handle, and
//! [`AstNodes::parent`] computes the next one from the handle's parent. Every variant has exactly one field, so
//! `AstNodes::X(_)` is always a valid pattern.
//!
//! - `expr.as_ast_nodes()`, `stmt.as_ast_nodes()`, ..: the node for a handle.
//! - `expr.ast_parent()`, ..: its parent. Same as `expr.as_ast_nodes().parent()`.
//! - `expr.as_chain_element()`: `a?.b` is two nodes in ESTree, a `ChainExpression` and the `MemberExpression` inside
//!   it, but one `Expr`. `as_ast_nodes()` returns the outer node and this returns the inner one.
//! - `nodes.span()`: the node's range in oxc.
//! - `nodes.ancestors()`: the node itself, its parent, and so on up to `Program`.

use super::print::flow::{arrow_after_parameters, is_declared_class, is_flow_declare_export};
use bun_lint::ast::{
    BinOp, Case, Class, EnumMember, ExportSpec, Expr, ExprKind, File, Flags, FnBody, FnKind, Func,
    ImportSpec, Keyword, Member, MemberKind, ModuleName, Node, Param, Pat, PatKind, PatProp, Prop,
    PropKind, Stmt, StmtKind, StmtTag, TupleElem, TypeKind, TypeNode, TypeParam, UnOp, VarDecl,
};
use bun_lint::span::{Span, Spanned};
use bun_sema::hir::ExprTag;

/// An expression statement, or an arrow function's expression body, which oxc represents as an `ExpressionStatement` in
/// a `FunctionBody`.
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
            ExpressionStatement::ArrowBody(_) => {
                self.expression().map_or_else(Span::default, Expr::span)
            }
        }
    }
}

impl<'a> From<ExpressionStatement<'a>> for Node<'a> {
    fn from(statement: ExpressionStatement<'a>) -> Node<'a> {
        match statement {
            ExpressionStatement::Stmt(statement) => Node::Stmt(statement),
            ExpressionStatement::ArrowBody(func) => Node::Func(func),
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

        /// The variant of an [`AstNodes`].
        #[derive(Copy, Clone, PartialEq, Eq, Debug)]
        #[repr(u8)]
        pub(crate) enum AstKind {
            Program,
            $($($variant,)*)*
        }

        /// The [`AstKind`] variant names, indexed by discriminant.
        pub(crate) const AST_KIND_NAMES: &[&str] = &["Program", $($(stringify!($variant),)*)*];

        impl<'a> AstNodes<'a> {
            #[inline]
            pub(crate) fn kind(self) -> AstKind {
                match self {
                    AstNodes::Program(_) => AstKind::Program,
                    $($(AstNodes::$variant(_) => AstKind::$variant,)*)*
                }
            }

            /// Returns the underlying `bun_lint::ast` node.
            #[inline]
            pub(crate) fn raw(self) -> Node<'a> {
                match self {
                    AstNodes::Program(file) => Node::File(file.0),
                    $($(AstNodes::$variant(it) => Node::from(it),)*)*
                }
            }
        }
    };
}

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
        // Flow's `(e: T)`
        TypeCastExpression
        JSXElement JSXFragment JSXText JSXEmptyExpression Elision PrivateIdentifier
        // All of `a, b, c`.
        SequenceExpression
        // All of `a?.b.c`. The field is also the node inside it.
        ChainExpression
        // The `{e}` around `e`.
        JSXExpressionContainer
        // `{...e}` as a child of an element. The field is the `Spread`.
        JSXSpreadChild
        // `<a b>`. The field is the element.
        JSXOpeningElement
        // The `@e` around `e`.
        Decorator
        // An array literal, an object literal, `a = 1` and `...a` inside an assignment target.
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
    // The `<..>`. The field is the node that has the type arguments or parameters.
    Node<'a> { TSTypeParameterInstantiation TSTypeParameterDeclaration }
}

/// How far up we are among the wrapper nodes that oxc has around an expression and `bun_lint::ast` doesn't.
#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord)]
enum Level {
    Itself,
    Chain,
    JsxContainer,
}

#[inline]
fn is_comma(e: Expr<'_>) -> bool {
    e.binary_op() == Some(BinOp::Comma)
}

/// True if `e` is the `a, b` of `a, b, c`, which isn't a separate node in ESTree.
pub(crate) fn is_inner_comma(e: Expr<'_>) -> bool {
    is_comma(e)
        && !e.is_parenthesized()
        && matches!(e.parent(), Node::Expr(parent) if is_comma(parent) && parent.left() == Some(e))
}

/// Converts a handle to its [`AstNodes`], and finds its parent.
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
    /// ESTree's `Expression`. For a whole optional chain that's the `ChainExpression`. See
    /// [`ChainElement::as_chain_element`].
    #[inline]
    fn as_ast_nodes(self) -> AstNodes<'a> {
        match self.is_chain_root() {
            true => AstNodes::ChainExpression(self),
            false => self.as_chain_element(),
        }
    }

    /// Skips the `ChainExpression`, if there is one.
    #[inline]
    fn ast_parent(self) -> AstNodes<'a> {
        parent_of_expr(self, Level::Chain)
    }
}

pub(crate) trait ChainElement<'a> {
    /// Returns the member access, call or `!` itself, even if it's a whole optional chain. In that case its parent is
    /// the `ChainExpression`. For any other expression this is the same as [`AsAstNodes::as_ast_nodes`].
    fn as_chain_element(self) -> AstNodes<'a>;
}

impl<'a> ChainElement<'a> for Expr<'a> {
    #[inline]
    fn as_chain_element(self) -> AstNodes<'a> {
        use AstNodes as N;
        match self.tag() {
            ExprTag::Ident => N::IdentifierReference(self),
            ExprTag::This => N::ThisExpression(self),
            ExprTag::Call => N::CallExpression(self),
            ExprTag::Dot if !self.is_private_member() => N::StaticMemberExpression(self),
            ExprTag::Number => N::NumericLiteral(self),
            _ => chain_element_slow_path(self),
        }
    }
}

/// Handles the less common expression kinds.
fn chain_element_slow_path<'a>(e: Expr<'a>) -> AstNodes<'a> {
    use AstNodes as N;
    match e.tag() {
        ExprTag::Missing if e.jsx_container_span().is_some() => N::JSXEmptyExpression(e),
        ExprTag::Missing => N::Elision(e),
        ExprTag::Ident => N::IdentifierReference(e),
        ExprTag::PrivateIdentifier => N::PrivateIdentifier(e),
        ExprTag::This => N::ThisExpression(e),
        ExprTag::Super => N::Super(e),
        ExprTag::Null => N::NullLiteral(e),
        ExprTag::True | ExprTag::False => N::BooleanLiteral(e),
        ExprTag::Number => N::NumericLiteral(e),
        ExprTag::String if e.is_jsx_text() => N::JSXText(e),
        ExprTag::String => N::StringLiteral(e),
        ExprTag::BigInt => N::BigIntLiteral(e),
        ExprTag::Regex => N::RegExpLiteral(e),
        ExprTag::Template => N::TemplateLiteral(e),
        ExprTag::TaggedTemplate => N::TaggedTemplateExpression(e),
        ExprTag::Array if e.is_assignment_target() => N::ArrayAssignmentTarget(e),
        ExprTag::Array => N::ArrayExpression(e),
        ExprTag::Object if e.is_assignment_target() => N::ObjectAssignmentTarget(e),
        ExprTag::Object => N::ObjectExpression(e),
        ExprTag::Fn => e.as_fn().map_or(N::Elision(e), Func::as_ast_nodes),
        ExprTag::Class => e.as_class().map_or(N::Elision(e), N::Class),
        ExprTag::Dot if e.is_private_member() => N::PrivateFieldExpression(e),
        ExprTag::Dot => N::StaticMemberExpression(e),
        ExprTag::Index => N::ComputedMemberExpression(e),
        ExprTag::Call => N::CallExpression(e),
        ExprTag::New => N::NewExpression(e),
        ExprTag::Unary => match e.unary_op() {
            Some(UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec) => {
                N::UpdateExpression(e)
            }
            _ => N::UnaryExpression(e),
        },
        ExprTag::Binary => match e.binary_op() {
            Some(BinOp::And | BinOp::Or | BinOp::Nullish) => N::LogicalExpression(e),
            Some(BinOp::Comma) => N::SequenceExpression(e),
            Some(BinOp::In)
                if e.left()
                    .is_some_and(|left| left.tag() == ExprTag::PrivateIdentifier) =>
            {
                N::PrivateInExpression(e)
            }
            _ => N::BinaryExpression(e),
        },
        ExprTag::Assign if e.assign_op() == Some(None) && is_default_in_assignment_target(e) => {
            N::AssignmentTargetWithDefault(e)
        }
        ExprTag::Assign => N::AssignmentExpression(e),
        ExprTag::Cond => N::ConditionalExpression(e),
        ExprTag::Spread if e.jsx_container_span().is_some() => N::JSXSpreadChild(e),
        ExprTag::Spread if e.is_assignment_target() => N::AssignmentTargetRest(e),
        ExprTag::Spread => N::SpreadElement(Node::Expr(e)),
        ExprTag::Await => N::AwaitExpression(e),
        ExprTag::Yield => N::YieldExpression(e),
        ExprTag::As | ExprTag::AsConst if e.is_angle_bracket_assertion() => {
            match e.file().is_flow() {
                true => N::TypeCastExpression(e),
                false => N::TSTypeAssertion(e),
            }
        }
        ExprTag::As | ExprTag::AsConst => N::TSAsExpression(e),
        ExprTag::Satisfies => N::TSSatisfiesExpression(e),
        ExprTag::NonNull => N::TSNonNullExpression(e),
        ExprTag::Instantiation => N::TSInstantiationExpression(e),
        ExprTag::Jsx if matches!(e.kind(), ExprKind::Jsx(jsx) if jsx.is_fragment()) => {
            N::JSXFragment(e)
        }
        ExprTag::Jsx => N::JSXElement(e),
        ExprTag::ImportCall => N::ImportExpression(e),
        ExprTag::ImportMeta | ExprTag::NewTarget => N::MetaProperty(e),
    }
}

/// True if `e`, an `=` assignment, is the `a = 1` of `[a = 1] = b` or `({ a = 1 } = b)`. Also true for `b = { a = 1 }`,
/// which is an error.
fn is_default_in_assignment_target(e: Expr<'_>) -> bool {
    let is_element = match e.parent() {
        // `[...a = 1] = b` is an error.
        Node::Expr(parent) => matches!(parent.tag(), ExprTag::Array | ExprTag::Spread),
        Node::Prop(prop) if prop.kind() == PropKind::Shorthand => return prop.value() == Some(e),
        Node::Prop(prop) => prop.value() == Some(e) && !prop.is_jsx_attribute(),
        _ => false,
    };
    is_element && e.is_assignment_target()
}

/// True if `statement` takes the place of Prettier's `JsExpressionRoot`. That's a file whose text is `(`, an expression
/// from HTML, and `)`, and whose name starts with a NUL. The expression's parent is then the file.
#[inline]
fn is_expression_root(statement: Stmt<'_>) -> bool {
    statement.file().path().first() == Some(&0) && matches!(statement.parent(), Node::File(_))
}

fn parent_of_expr<'a>(e: Expr<'a>, above: Level) -> AstNodes<'a> {
    use AstNodes as N;
    if above < Level::Chain && e.is_chain_root() {
        return N::ChainExpression(e);
    }
    let parent = e.parent();
    // A child of an element or an attribute value can have braces around it. `{...e}` and `{}` are themselves the
    // container.
    if above < Level::JsxContainer
        && match parent {
            Node::Expr(parent) => parent.tag() == ExprTag::Jsx,
            Node::Prop(_) => true,
            _ => false,
        }
        && e.jsx_container_span().is_some()
        && e.tag() != ExprTag::Spread
    {
        return N::JSXExpressionContainer(e);
    }
    match parent {
        Node::File(file) => N::Program(Program(file)),
        Node::Expr(parent) => match is_comma(parent) {
            true => {
                let mut root = parent;
                while is_inner_comma(root)
                    && let Node::Expr(outer) = root.parent()
                {
                    root = outer;
                }
                N::SequenceExpression(root)
            }
            false => parent.as_chain_element(),
        },
        Node::Stmt(statement) => match statement.tag() {
            StmtTag::Expr if e.tag() == ExprTag::String && statement.directive().is_some() => {
                N::Directive(statement)
            }
            StmtTag::Expr if is_expression_root(statement) => N::Program(Program(statement.file())),
            StmtTag::Expr => N::ExpressionStatement(ExpressionStatement::Stmt(statement)),
            _ => inner_of_stmt(statement),
        },
        Node::VarDecl(declaration) => declaration.as_ast_nodes(),
        Node::Param(param) if param.default() == Some(e) => parent_in_parameter(param),
        Node::Param(_) => N::Decorator(e),
        Node::PatProp(prop) if prop.default() == Some(e) => {
            N::AssignmentPattern(Node::PatProp(prop))
        }
        Node::PatProp(prop) => N::BindingProperty(prop),
        Node::PatElem(element) => N::AssignmentPattern(Node::PatElem(element)),
        Node::Prop(prop) => prop.as_ast_nodes(),
        Node::Member(member) if member.modifiers().around(e.span().start).is_some() => {
            N::Decorator(e)
        }
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
    /// For a signature or a function type, where oxc has no `Function`, this returns the member or the type.
    fn as_ast_nodes(self) -> AstNodes<'a> {
        use AstNodes as N;
        match (self.kind(), self.owner()) {
            (FnKind::Arrow, _) => N::ArrowFunctionExpression(self),
            (_, Node::Type(ty)) => ty.as_ast_nodes(),
            (FnKind::StaticBlock, Node::Member(member)) => N::StaticBlock(member),
            (_, Node::Member(member)) if !matches!(member.parent(), Node::Class(class) if !is_declared_class(class)) => {
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
        let is_in_class = matches!(self.parent(), Node::Class(class) if !is_declared_class(class));
        match self.kind() {
            MemberKind::IndexSignature => N::TSIndexSignature(self),
            MemberKind::StaticBlock => N::StaticBlock(self),
            MemberKind::CallSignature => N::TSCallSignatureDeclaration(self),
            MemberKind::ConstructSignature => N::TSConstructSignatureDeclaration(self),
            MemberKind::Property if !is_in_class => N::TSPropertySignature(self),
            MemberKind::Property if self.flags().contains(Flags::ACCESSOR) => {
                N::AccessorProperty(self)
            }
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
        let owner = self.parent();
        if self.is_jsx_attribute() || matches!(owner, Node::Expr(e) if e.tag() == ExprTag::Jsx) {
            return if is_spread {
                N::JSXSpreadAttribute(self)
            } else {
                N::JSXAttribute(self)
            };
        }
        let is_target = matches!(owner, Node::Expr(object) if object.is_assignment_target());
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
            Node::Stmt(statement) if statement.tag() == StmtTag::Try => {
                AstNodes::CatchParameter(self)
            }
            _ => AstNodes::VariableDeclarator(self),
        }
    }
}

/// Returns the statement without its `export` wrapper.
pub(crate) fn inner_of_stmt<'a>(statement: Stmt<'a>) -> AstNodes<'a> {
    use AstNodes as N;
    match statement.tag() {
        StmtTag::Var => return N::VariableDeclaration(statement),
        StmtTag::Return => return N::ReturnStatement(statement),
        StmtTag::If => return N::IfStatement(statement),
        StmtTag::Throw => return N::ThrowStatement(statement),
        StmtTag::For => return N::ForStatement(statement),
        StmtTag::ForIn => return N::ForInStatement(statement),
        StmtTag::ForOf => return N::ForOfStatement(statement),
        StmtTag::While => return N::WhileStatement(statement),
        StmtTag::Switch => return N::SwitchStatement(statement),
        StmtTag::Try => return N::TryStatement(statement),
        StmtTag::ExportDefault => return N::ExportDefaultDeclaration(statement),
        _ => {}
    }
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

/// Returns the `export` or `export default` wrapper of `statement`, if it's an exported declaration.
fn export_wrapper<'a>(statement: Stmt<'a>) -> Option<AstNodes<'a>> {
    if matches!(
        statement.tag(),
        StmtTag::ExportNamed | StmtTag::ExportDefault | StmtTag::ExportStar
    ) {
        return None;
    }
    let flags = statement.flags();
    match flags.contains(Flags::EXPORT) {
        true if flags.contains(Flags::DEFAULT) => {
            Some(AstNodes::ExportDefaultDeclaration(statement))
        }
        true => Some(AstNodes::ExportNamedDeclaration(statement)),
        false => None,
    }
}

impl<'a> AsAstNodes<'a> for Stmt<'a> {
    /// Includes the `export` wrapper of a declaration.
    fn as_ast_nodes(self) -> AstNodes<'a> {
        export_wrapper(self).unwrap_or_else(|| inner_of_stmt(self))
    }
}

/// Returns the parent of `statement`, counting its `export` as part of it.
fn parent_of_stmt<'a>(statement: Stmt<'a>) -> AstNodes<'a> {
    use AstNodes as N;
    match statement.parent() {
        Node::File(file) => N::Program(Program(file)),
        Node::Func(func) if func.kind() == FnKind::StaticBlock => func.as_ast_nodes(),
        Node::Func(func) => N::FunctionBody(func),
        Node::Case(case) => N::SwitchCase(case),
        Node::Stmt(parent) => match parent.tag() {
            StmtTag::Try if matches!(parent.kind(), StmtKind::Try { handler, .. } if handler == Some(statement)) => {
                N::CatchClause(parent)
            }
            // `namespace A.B { .. }` is one node, and it directly contains what's between the braces.
            StmtTag::Module => N::TSModuleBlock(parent),
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
            TypeKind::Fn(func) if func.kind() == FnKind::ConstructorType => {
                N::TSConstructorType(self)
            }
            TypeKind::Fn(_) => N::TSFunctionType(self),
            TypeKind::Object(_) => N::TSTypeLiteral(self),
            TypeKind::Cond { .. } => N::TSConditionalType(self),
            TypeKind::Infer(_) => N::TSInferType(self),
            TypeKind::Mapped(_) => N::TSMappedType(self),
            TypeKind::IndexedAccess { .. } => N::TSIndexedAccessType(self),
            TypeKind::Keyof(_)
            | TypeKind::Readonly(_)
            | TypeKind::UniqueSymbol
            | TypeKind::Unique(_) => N::TSTypeOperator(self),
            TypeKind::Typeof { .. } => N::TSTypeQuery(self),
            TypeKind::Import {
                is_typeof: true, ..
            } => N::TSTypeQuery(self),
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
    /// For an element that's only a type, this returns the tuple type.
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
            Node::PatProp(prop) if prop.is_rest() => {
                AstNodes::BindingRestElement(Node::PatProp(prop))
            }
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
            Node::Param(param) => parent_in_parameter(param),
            other => node_as_ast_nodes(other),
        }
    }
}

/// Returns the parent of `param`'s pattern, type annotation and default value. `constructor(private a = 1) {}` is two
/// nodes in ESTree: a `TSParameterProperty`, which is the `FormalParameter` here, and the `AssignmentPattern` `a = 1`
/// inside it.
fn parent_in_parameter(param: Param<'_>) -> AstNodes<'_> {
    match param.is_parameter_property() && param.default().is_some() {
        true => AstNodes::AssignmentPattern(Node::Param(param)),
        false => param.as_ast_nodes(),
    }
}

/// Converts a `bun_lint::ast` node. A statement includes its `export`.
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

/// Returns the parent of the function or class that `owner` is.
fn parent_of_owner<'a>(owner: Node<'a>) -> AstNodes<'a> {
    match owner {
        Node::Expr(e) => parent_of_expr(e, Level::Itself),
        Node::Stmt(statement) => {
            export_wrapper(statement).unwrap_or_else(|| parent_of_stmt(statement))
        }
        Node::Member(member) => member.as_ast_nodes(),
        Node::Type(ty) => ty.ast_parent(),
        other => node_as_ast_nodes(other),
    }
}

impl<'a> AstNodes<'a> {
    /// Returns the expression if this is one, meaning something that can have parentheses around it.
    pub(crate) fn as_expression(self) -> Option<Expr<'a>> {
        use AstNodes as N;
        match self {
            N::Function(func) | N::ArrowFunctionExpression(func) => func.owner().as_expr(),
            N::Class(class) => class.owner().as_expr(),
            N::SpreadElement(_)
            | N::JSXExpressionContainer(_)
            | N::JSXSpreadChild(_)
            | N::JSXOpeningElement(_)
            | N::Decorator(_)
            | N::ChainExpression(_)
            | N::AssignmentTargetRest(_) => None,
            _ => match self.raw() {
                Node::Expr(e) => Some(e),
                _ => None,
            },
        }
    }

    /// Returns the direct parent. `Program` is its own parent.
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
                // The operand of `...` in an object.
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
            | N::AssignmentTargetWithDefault(e)
            | N::TypeCastExpression(e) => parent_of_expr(e, Level::Itself),

            N::SpreadElement(Node::Expr(e)) => parent_of_expr(e, Level::Itself),
            N::SpreadElement(node) => node_as_ast_nodes(node.parent()),

            N::ExpressionStatement(ExpressionStatement::Stmt(statement)) => {
                parent_of_stmt(statement)
            }
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
                export_wrapper(statement).unwrap_or_else(|| parent_of_stmt(statement))
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

            N::BindingIdentifier(pat) | N::ObjectPattern(pat) | N::ArrayPattern(pat) => {
                pat.ast_parent()
            }
            N::BindingProperty(prop) => node_as_ast_nodes(prop.parent()),
            N::AssignmentPattern(Node::PatProp(prop)) => N::BindingProperty(prop),
            N::AssignmentPattern(Node::Param(param)) => param.as_ast_nodes(),
            N::AssignmentPattern(node) | N::BindingRestElement(node) => {
                node_as_ast_nodes(node.parent())
            }

            N::TSTypeAnnotation(ty) => match ty.parent() {
                Node::Param(param) => parent_in_parameter(param),
                parent => node_as_ast_nodes(parent),
            },
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

            N::TSNamedTupleMember(element)
            | N::TSOptionalType(element)
            | N::TSRestType(element) => node_as_ast_nodes(element.parent()),
            N::TSTypeParameter(param) => match param.parent() {
                Node::Type(ty) => ty.as_ast_nodes(),
                owner => N::TSTypeParameterDeclaration(owner),
            },
            N::TSTypeParameterInstantiation(owner) | N::TSTypeParameterDeclaration(owner) => {
                match owner {
                    Node::Stmt(statement) => inner_of_stmt(statement),
                    Node::Expr(e) if matches!(e.kind(), ExprKind::Jsx(_)) => {
                        N::JSXOpeningElement(e)
                    }
                    owner => node_as_ast_nodes(owner),
                }
            }
        }
    }

    /// The node itself, its parent, and so on up to `Program`.
    pub(crate) fn ancestors(self) -> impl Iterator<Item = AstNodes<'a>> {
        std::iter::successors(Some(self), |node| match node {
            AstNodes::Program(_) => None,
            node => Some(node.parent()),
        })
    }

    /// Returns the parent of a `ChainExpression`, and any other node unchanged.
    pub(crate) fn without_chain_expression(self) -> AstNodes<'a> {
        match self {
            AstNodes::ChainExpression(_) => self.parent().without_chain_expression(),
            _ => self,
        }
    }

    /// True if this is a call or `new` expression whose callee is `e`.
    pub(crate) fn is_call_like_callee(self, e: Expr<'a>) -> bool {
        match self {
            AstNodes::CallExpression(call) | AstNodes::NewExpression(call) => {
                call.callee() == Some(e)
            }
            _ => false,
        }
    }

    /// [`AstNodes::span`], but starting at Prettier's `locStart`. A class's decorators can come before its `export`,
    /// and then belong to both the class and the export: `@decorator export class A {}`.
    pub(crate) fn span_with_decorators(self) -> Span {
        use AstNodes as N;
        let span = self.span();
        let class = match self {
            N::Class(class) => Some(class),
            N::ExportNamedDeclaration(statement) | N::ExportDefaultDeclaration(statement) => {
                match statement.kind() {
                    StmtKind::Class(class) => Some(class),
                    StmtKind::ExportDefault(e) => e.as_class(),
                    _ => None,
                }
            }
            _ => None,
        };
        match class.and_then(|class| class.decorators().next()) {
            Some(first) => Span::new(N::Decorator(first).span().start.min(span.start), span.end),
            None => span,
        }
    }

    /// Returns the node's range in oxc.
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
                let modifiers = match e.parent() {
                    Node::Class(class) => class.modifiers(),
                    Node::Member(member) => member.modifiers(),
                    Node::Param(param) => param.modifiers(),
                    _ => return e.outer_span(),
                };
                (modifiers.around(e.span().start))
                    .map_or_else(|| e.outer_span(), |modifier| modifier.span())
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
            | N::AssignmentTargetWithDefault(e)
            | N::TypeCastExpression(e) => e.span(),
            N::AssignmentPattern(Node::PatProp(prop)) => match prop.default() {
                Some(default) => prop.value().span().to(default.outer_span()),
                None => prop.span(),
            },
            N::AssignmentPattern(Node::Param(param)) => match param.default() {
                Some(default) => param.pat().span().to(default.outer_span()),
                None => param.span(),
            },
            N::SpreadElement(node) | N::AssignmentPattern(node) | N::BindingRestElement(node) => {
                node.span()
            }
            N::ExpressionStatement(statement) => statement.span(),
            N::Function(func) | N::ArrowFunctionExpression(func) => func.estree_span(),
            N::FunctionBody(func) => match func.body() {
                FnBody::Expr(e) => e.span(),
                _ => func
                    .body_span()
                    .unwrap_or_else(|| Span::empty(func.span().end)),
            },
            N::FormalParameters(func) => {
                let span = func.params_span().unwrap_or_else(|| func.span());
                let end = arrow_after_parameters(func).unwrap_or(span.end);
                Span::new(span.start, end)
            }
            N::Class(class) => match class.owner() {
                // `estree_span` checks every decorator for an `export`.
                Node::Stmt(statement) if !class.flags().contains(Flags::EXPORT) => statement.span(),
                _ => class.estree_span(),
            },
            N::ClassBody(class) => class.body_span(),
            N::FormalParameter(param)
            | N::FormalParameterRest(param)
            | N::TSThisParameter(param) => param.span(),
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
            N::VariableDeclarator(declaration) | N::CatchParameter(declaration) => {
                declaration.span()
            }
            N::ExportNamedDeclaration(statement) | N::ExportDefaultDeclaration(statement) => {
                match is_flow_declare_export(statement) {
                    true => statement.span(),
                    false => statement.export_span().unwrap_or_else(|| statement.span()),
                }
            }
            N::CatchClause(statement) => statement
                .catch_clause_span()
                .unwrap_or_else(|| statement.span()),
            N::TSInterfaceBody(statement) => match statement.kind() {
                StmtKind::Interface(interface) => interface.body_span(),
                _ => statement.span(),
            },
            N::TSEnumBody(statement) => match statement.kind() {
                StmtKind::Enum(it) => it.body_span(),
                _ => statement.span(),
            },
            N::TSModuleBlock(statement) => match statement.kind() {
                StmtKind::Module(module) => module
                    .innermost()
                    .body_span()
                    .unwrap_or_else(|| statement.span()),
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
            // The `T` of `a is T` has no `:` to start at.
            N::TSTypeAnnotation(ty)
                if matches!(ty.parent(), Node::Type(parent)
                    if matches!(parent.kind(), TypeKind::Predicate { .. })) =>
            {
                ty.outer_span()
            }
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
            N::TSNamedTupleMember(element)
            | N::TSOptionalType(element)
            | N::TSRestType(element) => element.span(),
            N::TSTypeParameter(param) => param.span(),
            N::TSTypeParameterInstantiation(owner) => type_arguments_of(owner)
                .and_then(|it| it.angle_brackets_span())
                .unwrap_or_else(|| owner.span()),
            N::TSTypeParameterDeclaration(owner) => type_parameters_of(owner)
                .and_then(|it| it.angle_brackets_span())
                .unwrap_or_else(|| owner.span()),
        }
    }
}

impl Spanned for AstNodes<'_> {
    fn span(&self) -> Span {
        AstNodes::span(*self)
    }
}

pub(crate) fn type_arguments_of<'a>(
    owner: Node<'a>,
) -> Option<bun_lint::ast::List<'a, TypeNode<'a>>> {
    match owner {
        Node::Expr(e) => match e.kind() {
            ExprKind::Call(call) | ExprKind::New(call) | ExprKind::TaggedTemplate(call) => {
                Some(call.type_args())
            }
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

pub(crate) fn type_parameters_of<'a>(
    owner: Node<'a>,
) -> Option<bun_lint::ast::List<'a, TypeParam<'a>>> {
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
