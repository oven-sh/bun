//! What ESTree has and the HIR does not.
//!
//! | ESTree | here |
//! | --- | --- |
//! | `node.type`, as text for a message | [`estree_type_name`] |
//! | `node.range` where it differs from `.span()` | [`estree_span`] |
//! | `node.parent`, for a walk that compares `type`s | [`estree_parent`], [`normalize`] |
//! | `ChainExpression` | [`is_chain_root`], [`chain_root`], [`is_in_optional_chain`] |
//! | `SequenceExpression.expressions` | [`sequence_expressions`], [`is_sequence_root`], [`sequence_root`] |
//! | `ExpressionStatement`, as opposed to the `init` of a `for` | [`is_expression_statement`], [`is_for_init`] |
//! | `TSQualifiedName` in `typeof a.b` | [`is_in_type_query`] |
//! | a pattern in an assignment | [`is_assignment_target`] |
//! | any pattern, in a declaration or in an assignment | [`Target`] |
//! | `TSTypeAnnotation.range` | [`type_annotation_span`] |
//! | `sourceCode.getNodeByRangeIndex(i)` | [`get_node_by_range_index`] |
//! | `sourceCode.getNodeByRangeIndex(i).type` | [`estree_type_at`](super::estree_type_at) |
//! | `CatchClause.range` | [`catch_clause_span`] |

use crate::ast::{
    BinOp, Class, Expr, ExprKind, File, Flags, FnKind, Func, Key, Keyword, MemberKind, Name, Node,
    Param, Pat, PatKind, PropKind, Stmt, StmtKind, TypeKind, TypeNode, UnOp, VarDecl,
};
use crate::span::{Span, Spanned};
use smallvec::SmallVec;

// ───────────────────────────── optional chains ─────────────────────────────

/// [`Expr::is_chain_root`]: ESTree has a `ChainExpression` around `e`. It is the whole of
/// `a?.b.c()`, not a part of it. In `a?.b!`, that is the `ExprKind::NonNull`.
#[inline]
pub fn is_chain_root(e: Expr<'_>) -> bool {
    e.is_chain_root()
}

/// The whole optional chain that `e` is a link of: what ESTree has a `ChainExpression` around.
/// `None` if `e` is not in a chain, or is before its first `?.`: the `a` of `a?.b`.
pub fn chain_root(e: Expr<'_>) -> Option<Expr<'_>> {
    if !e.is_in_optional_chain() {
        return None;
    }
    let mut root = e;
    while !root.is_chain_root()
        && let Some(parent) = root.parent().as_expr()
    {
        root = parent;
    }
    Some(root)
}

/// [`Expr::is_in_optional_chain`]: evaluating `e` can be cut short by a `?.` in it or before it in
/// the same chain.
#[inline]
pub fn is_in_optional_chain(e: Expr<'_>) -> bool {
    e.is_in_optional_chain()
}

// ───────────────────────────── the comma operator ─────────────────────────────

#[inline]
fn is_comma(e: Expr<'_>) -> bool {
    matches!(
        e.kind(),
        ExprKind::Binary {
            op: BinOp::Comma,
            ..
        }
    )
}

/// Whether `e` is the `a, b` of `a, b, c`, which ESTree has no node for.
fn is_inner_comma(e: Expr<'_>) -> bool {
    is_comma(e)
        && !e.is_parenthesized()
        && matches!(
            e.parent().as_expr().map(Expr::kind),
            Some(ExprKind::Binary { op: BinOp::Comma, left, .. }) if left == e
        )
}

/// Whether `e` is a `SequenceExpression` of ESTree: all of `a, b, c`.
#[inline]
pub fn is_sequence_root(e: Expr<'_>) -> bool {
    is_comma(e) && !is_inner_comma(e)
}

/// The `SequenceExpression` of ESTree that `e`, a comma expression, is or is the start of.
pub fn sequence_root(mut e: Expr<'_>) -> Expr<'_> {
    while is_inner_comma(e)
        && let Some(parent) = e.parent().as_expr()
    {
        e = parent;
    }
    e
}

/// [`Expr::sequence`]: ESTree's `SequenceExpression.expressions`, the `a`, `b` and `c` of `a, b, c`.
/// An operand in parentheses is one expression. What is not a comma expression is its own only
/// element.
#[inline]
pub fn sequence_expressions(e: Expr<'_>) -> SmallVec<[Expr<'_>; 4]> {
    e.sequence()
}

/// ESTree's `SequenceExpression.expressions.at(-1)`.
#[inline]
pub fn last_sequence_expression(e: Expr<'_>) -> Expr<'_> {
    match e.kind() {
        ExprKind::Binary {
            op: BinOp::Comma,
            right,
            ..
        } => right,
        _ => e,
    }
}

// ───────────────────────────── the head of a `for` ─────────────────────────────

/// Whether `statement` is the `init` of a `for` or the `left` of a `for`-`in` or a `for`-`of`. If it
/// is a `StmtKind::Expr`, ESTree has the expression there and no `ExpressionStatement`.
pub fn is_for_init(statement: Stmt<'_>) -> bool {
    match statement.parent().as_stmt().map(Stmt::kind) {
        Some(StmtKind::For { init, .. }) => init == Some(statement),
        Some(StmtKind::ForIn { left, .. } | StmtKind::ForOf { left, .. }) => left == statement,
        _ => false,
    }
}

/// Whether `statement` is an `ExpressionStatement` of ESTree: a `StmtKind::Expr` that is not in the
/// head of a `for`.
#[inline]
pub fn is_expression_statement(statement: Stmt<'_>) -> bool {
    matches!(statement.kind(), StmtKind::Expr(_)) && !statement.is_wrapper()
}

// ───────────────────────────── patterns ─────────────────────────────

/// Whether `e` is written where ESTree has a pattern: it is what an assignment or a `for`-`in` or
/// `for`-`of` loop assigns to, or a part of that which is not a default value or a computed key.
///
/// For an `Array`, an `Object`, an `Assign` or a `Spread` it is [`Expr::is_assignment_target`]: ESTree
/// calls it an `ArrayPattern`, an `ObjectPattern`, an `AssignmentPattern` or a `RestElement`, which
/// in parentheses it is not. For anything else it tells that it is written to, in parentheses or
/// not. The operand of `++` and `--` is not a pattern.
pub fn is_assignment_target(e: Expr<'_>) -> bool {
    if matches!(
        e.kind(),
        ExprKind::Array(_) | ExprKind::Object(_) | ExprKind::Assign { .. } | ExprKind::Spread(_)
    ) {
        return e.is_assignment_target();
    }
    match e.parent() {
        Node::Expr(parent) => match parent.kind() {
            ExprKind::Assign { target, .. } => target == e,
            ExprKind::Array(_) | ExprKind::Spread(_) => parent.is_assignment_target(),
            _ => false,
        },
        Node::Prop(prop) => {
            prop.value() == Some(e)
                && !prop.is_jsx_attribute()
                && matches!(prop.parent(), Node::Expr(object) if object.is_assignment_target())
        }
        Node::Stmt(statement) => matches!(
            statement.kind(),
            StmtKind::ForIn { left, .. } | StmtKind::ForOf { left, .. }
                if matches!(left.kind(), StmtKind::Expr(target) if target == e)
        ),
        _ => false,
    }
}

/// A pattern of ESTree: a [`Pat`] in a declaration or a parameter, an [`Expr`] in an assignment.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Target<'a> {
    Pat(Pat<'a>),
    Expr(Expr<'a>),
}

#[derive(Copy, Clone, Debug)]
pub enum TargetKind<'a> {
    /// `Identifier`
    Ident(Name<'a>),
    /// `MemberExpression`, or what else an assignment can have on its left, such as `a!`.
    Other(Expr<'a>),
    /// `ArrayPattern`
    Array,
    /// `ObjectPattern`
    Object,
}

/// An element of an `ArrayPattern`, or a `Property` or a `RestElement` of an `ObjectPattern`.
#[derive(Copy, Clone, Debug)]
pub struct TargetElement<'a> {
    /// Of a property that is not a rest element.
    pub key: Option<Key<'a>>,
    /// `None` for a hole in an array.
    pub target: Option<Target<'a>>,
    /// The `1` of `a = 1`: ESTree's `AssignmentPattern.right`.
    pub default: Option<Expr<'a>>,
    pub is_rest: bool,
    /// `{ a }`, `{ a = 1 }`
    pub is_shorthand: bool,
    /// The node of the element: a `PatElem`, a `PatProp`, a `Prop`, or the `Expr` in an array.
    pub node: Node<'a>,
}

impl<'a> From<Pat<'a>> for Target<'a> {
    #[inline]
    fn from(pat: Pat<'a>) -> Self {
        Target::Pat(pat)
    }
}

impl<'a> From<Expr<'a>> for Target<'a> {
    #[inline]
    fn from(e: Expr<'a>) -> Self {
        Target::Expr(e)
    }
}

impl<'a> From<Target<'a>> for Node<'a> {
    #[inline]
    fn from(target: Target<'a>) -> Self {
        match target {
            Target::Pat(pat) => Node::Pat(pat),
            Target::Expr(e) => Node::Expr(e),
        }
    }
}

impl Spanned for Target<'_> {
    #[inline]
    fn span(&self) -> Span {
        Target::span(*self)
    }
}

impl<'a> Target<'a> {
    #[inline]
    pub fn span(self) -> Span {
        match self {
            Target::Pat(pat) => pat.span(),
            Target::Expr(e) => e.span(),
        }
    }

    pub fn kind(self) -> TargetKind<'a> {
        match self {
            Target::Pat(pat) => match pat.kind() {
                PatKind::Ident(name) => TargetKind::Ident(name),
                PatKind::Object(_) => TargetKind::Object,
                PatKind::Array(_) | PatKind::Missing => TargetKind::Array,
            },
            Target::Expr(e) => match e.kind() {
                ExprKind::Ident(name) => TargetKind::Ident(name),
                ExprKind::Object(_) => TargetKind::Object,
                ExprKind::Array(_) => TargetKind::Array,
                _ => TargetKind::Other(e),
            },
        }
    }

    #[inline]
    pub fn as_ident(self) -> Option<Name<'a>> {
        match self.kind() {
            TargetKind::Ident(name) => Some(name),
            _ => None,
        }
    }

    /// Splits the `a = 1` of an assignment target into the target and the default value.
    fn split_default(e: Expr<'a>) -> (Expr<'a>, Option<Expr<'a>>) {
        match e.kind() {
            ExprKind::Assign {
                op: None,
                target,
                value,
            } => (target, Some(value)),
            _ => (e, None),
        }
    }

    /// The elements of an array pattern or the properties of an object pattern, in source order.
    /// Empty for anything else.
    pub fn elements(self) -> SmallVec<[TargetElement<'a>; 4]> {
        match self {
            Target::Pat(pat) => match pat.kind() {
                PatKind::Array(elements) => elements
                    .iter()
                    .map(|it| TargetElement {
                        key: None,
                        target: it.pat().map(Target::Pat),
                        default: it.default(),
                        is_rest: it.is_rest(),
                        is_shorthand: false,
                        node: Node::PatElem(it),
                    })
                    .collect(),
                PatKind::Object(props) => props
                    .iter()
                    .map(|it| TargetElement {
                        key: it.key(),
                        target: Some(Target::Pat(it.value())),
                        default: it.default(),
                        is_rest: it.is_rest(),
                        is_shorthand: it.is_shorthand(),
                        node: Node::PatProp(it),
                    })
                    .collect(),
                PatKind::Ident(_) | PatKind::Missing => SmallVec::new(),
            },
            Target::Expr(e) => match e.kind() {
                ExprKind::Array(elements) => elements
                    .iter()
                    .map(|it| {
                        let (inner, is_rest) = match it.kind() {
                            ExprKind::Spread(inner) => (inner, true),
                            _ => (it, false),
                        };
                        let (target, default) = Self::split_default(inner);
                        TargetElement {
                            key: None,
                            target: (!it.is_missing()).then_some(Target::Expr(target)),
                            default,
                            is_rest,
                            is_shorthand: false,
                            node: Node::Expr(it),
                        }
                    })
                    .collect(),
                ExprKind::Object(props) => props
                    .iter()
                    .map(|it| {
                        let split = it.value().map(Self::split_default);
                        TargetElement {
                            key: it.key(),
                            target: split.map(|it| Target::Expr(it.0)),
                            default: split.and_then(|it| it.1),
                            is_rest: it.kind() == PropKind::Spread,
                            is_shorthand: it.kind() == PropKind::Shorthand,
                            node: Node::Prop(it),
                        }
                    })
                    .collect(),
                _ => SmallVec::new(),
            },
        }
    }

    /// Calls `visit` with everything that the pattern assigns to, in source order: identifiers,
    /// and in an assignment also member accesses.
    pub fn for_each_leaf(self, visit: &mut dyn FnMut(Target<'a>)) {
        match self.kind() {
            TargetKind::Ident(_) | TargetKind::Other(_) => visit(self),
            TargetKind::Array | TargetKind::Object => {
                for element in self.elements() {
                    if let Some(target) = element.target {
                        target.for_each_leaf(visit);
                    }
                }
            }
        }
    }
}

// ───────────────────────────── node.type ─────────────────────────────

/// [`Expr::is_in_type_query`]: `e` is the `a.b.c` of the type `typeof a.b.c`, or the `a` or the `a.b`
/// in it. ESTree has an `Identifier` or a `TSQualifiedName` there, not a `MemberExpression`.
#[inline]
pub fn is_in_type_query(e: Expr<'_>) -> bool {
    e.is_in_type_query()
}

fn is_jsx_child(e: Expr<'_>) -> bool {
    matches!(e.parent().as_expr().map(Expr::kind), Some(ExprKind::Jsx(_)))
}

fn type_name_of_func(func: Func<'_>) -> &'static str {
    let has_body = func.has_body();
    match func.kind() {
        FnKind::Decl if has_body => "FunctionDeclaration",
        FnKind::Decl => "TSDeclareFunction",
        FnKind::Arrow => "ArrowFunctionExpression",
        FnKind::Expr => "FunctionExpression",
        FnKind::Method | FnKind::Getter | FnKind::Setter | FnKind::Constructor => {
            match (func.owner(), has_body) {
                (Node::Member(member), _) if !matches!(member.parent(), Node::Class(_)) => {
                    "TSMethodSignature"
                }
                (_, true) => "FunctionExpression",
                (_, false) => "TSEmptyBodyFunctionExpression",
            }
        }
        FnKind::StaticBlock => "StaticBlock",
        FnKind::CallSignature => "TSCallSignatureDeclaration",
        FnKind::ConstructSignature => "TSConstructSignatureDeclaration",
        FnKind::FunctionType => "TSFunctionType",
        FnKind::ConstructorType => "TSConstructorType",
        FnKind::IndexSignature => "TSIndexSignature",
    }
}

fn type_name_of_class(class: Class<'_>) -> &'static str {
    match class.owner() {
        Node::Expr(_) => "ClassExpression",
        _ => "ClassDeclaration",
    }
}

fn type_name_of_expr(e: Expr<'_>) -> &'static str {
    match e.kind() {
        ExprKind::Missing => "JSXEmptyExpression",
        ExprKind::Ident(_) | ExprKind::This if e.is_jsx_tag_name() => "JSXIdentifier",
        ExprKind::Ident(_) => "Identifier",
        ExprKind::PrivateIdentifier(_) => "PrivateIdentifier",
        ExprKind::This => "ThisExpression",
        ExprKind::Super => "Super",
        ExprKind::String(name) if e.is_jsx_tag_name() => {
            match bun_core::strings::contains_char(name.bytes(), b':') {
                true => "JSXNamespacedName",
                false => "JSXIdentifier",
            }
        }
        ExprKind::String(_) if e.is_jsx_text() => "JSXText",
        ExprKind::Null
        | ExprKind::True
        | ExprKind::False
        | ExprKind::Number(_)
        | ExprKind::String(_)
        | ExprKind::BigInt(_)
        | ExprKind::Regex(_) => "Literal",
        ExprKind::Template(_) => "TemplateLiteral",
        ExprKind::TaggedTemplate(_) => "TaggedTemplateExpression",
        ExprKind::Array(_) if is_assignment_target(e) => "ArrayPattern",
        ExprKind::Array(_) => "ArrayExpression",
        ExprKind::Object(_) if is_assignment_target(e) => "ObjectPattern",
        ExprKind::Object(_) => "ObjectExpression",
        ExprKind::Fn(func) => type_name_of_func(func),
        ExprKind::Class(_) => "ClassExpression",
        ExprKind::Dot { .. } if e.is_jsx_tag_name() => "JSXMemberExpression",
        ExprKind::Dot { .. } if is_in_type_query(e) => "TSQualifiedName",
        ExprKind::Dot { .. } | ExprKind::Index { .. } => "MemberExpression",
        ExprKind::Call(_) => "CallExpression",
        ExprKind::New(_) => "NewExpression",
        ExprKind::Unary {
            op: UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec,
            ..
        } => "UpdateExpression",
        ExprKind::Unary { .. } => "UnaryExpression",
        ExprKind::Binary { op, .. } => match op {
            BinOp::And | BinOp::Or | BinOp::Nullish => "LogicalExpression",
            BinOp::Comma => "SequenceExpression",
            _ => "BinaryExpression",
        },
        ExprKind::Assign { op: None, .. } if is_assignment_target(e) => "AssignmentPattern",
        ExprKind::Assign { .. } => "AssignmentExpression",
        ExprKind::Cond { .. } => "ConditionalExpression",
        ExprKind::Spread(_) if is_jsx_child(e) => "JSXSpreadChild",
        ExprKind::Spread(_) if is_assignment_target(e) => "RestElement",
        ExprKind::Spread(_) => "SpreadElement",
        ExprKind::Await(_) => "AwaitExpression",
        ExprKind::Yield { .. } => "YieldExpression",
        ExprKind::As { .. } | ExprKind::AsConst(_) if e.is_angle_bracket_assertion() => {
            "TSTypeAssertion"
        }
        ExprKind::As { .. } | ExprKind::AsConst(_) => "TSAsExpression",
        ExprKind::Satisfies { .. } => "TSSatisfiesExpression",
        ExprKind::NonNull(_) => "TSNonNullExpression",
        ExprKind::Instantiation { .. } => "TSInstantiationExpression",
        ExprKind::Jsx(jsx) if jsx.is_fragment() => "JSXFragment",
        ExprKind::Jsx(_) => "JSXElement",
        ExprKind::ImportCall { .. } => "ImportExpression",
        ExprKind::ImportMeta | ExprKind::NewTarget => "MetaProperty",
    }
}

fn type_name_of_stmt(statement: Stmt<'_>) -> &'static str {
    match statement.kind() {
        StmtKind::Empty => "EmptyStatement",
        StmtKind::Debugger => "DebuggerStatement",
        StmtKind::Expr(e) if is_for_init(statement) => type_name_of_expr(e),
        StmtKind::Expr(_) => "ExpressionStatement",
        StmtKind::Var(_) => "VariableDeclaration",
        StmtKind::Fn(func) => type_name_of_func(func),
        StmtKind::Class(_) => "ClassDeclaration",
        StmtKind::Interface(_) => "TSInterfaceDeclaration",
        StmtKind::TypeAlias(_) => "TSTypeAliasDeclaration",
        StmtKind::Enum(_) => "TSEnumDeclaration",
        StmtKind::Module(_) => "TSModuleDeclaration",
        StmtKind::Return(_) => "ReturnStatement",
        StmtKind::If { .. } => "IfStatement",
        StmtKind::For { .. } => "ForStatement",
        StmtKind::ForIn { .. } => "ForInStatement",
        StmtKind::ForOf { .. } => "ForOfStatement",
        StmtKind::While { .. } => "WhileStatement",
        StmtKind::DoWhile { .. } => "DoWhileStatement",
        StmtKind::Block(_) => "BlockStatement",
        StmtKind::With { .. } => "WithStatement",
        StmtKind::Switch { .. } => "SwitchStatement",
        StmtKind::Try { .. } => "TryStatement",
        StmtKind::Throw(_) => "ThrowStatement",
        StmtKind::Break(_) => "BreakStatement",
        StmtKind::Continue(_) => "ContinueStatement",
        StmtKind::Labeled { .. } => "LabeledStatement",
        StmtKind::Import(_) => "ImportDeclaration",
        StmtKind::ImportEquals(_) => "TSImportEqualsDeclaration",
        StmtKind::ExportNamed(_) => "ExportNamedDeclaration",
        StmtKind::ExportStar { .. } => "ExportAllDeclaration",
        StmtKind::ExportDefault(_) => "ExportDefaultDeclaration",
        StmtKind::ExportAssign(_) => "TSExportAssignment",
        StmtKind::ExportAsNamespace(_) => "TSNamespaceExportDeclaration",
    }
}

fn type_name_of_type(ty: TypeNode<'_>) -> &'static str {
    match ty.kind() {
        TypeKind::Error => "TSUnknownKeyword",
        TypeKind::Heritage { .. } | TypeKind::Ref { .. } => match ty.parent() {
            Node::Class(class) if class.implements().iter().any(|it| it == ty) => {
                "TSClassImplements"
            }
            Node::Stmt(statement) if matches!(statement.kind(), StmtKind::Interface(_)) => {
                "TSInterfaceHeritage"
            }
            _ => "TSTypeReference",
        },
        TypeKind::Keyword(keyword) => match keyword {
            Keyword::Any => "TSAnyKeyword",
            Keyword::Unknown => "TSUnknownKeyword",
            Keyword::Never => "TSNeverKeyword",
            Keyword::Void => "TSVoidKeyword",
            Keyword::Undefined => "TSUndefinedKeyword",
            Keyword::Null => "TSNullKeyword",
            Keyword::String => "TSStringKeyword",
            Keyword::Number => "TSNumberKeyword",
            Keyword::Boolean => "TSBooleanKeyword",
            Keyword::BigInt => "TSBigIntKeyword",
            Keyword::Symbol => "TSSymbolKeyword",
            Keyword::Object => "TSObjectKeyword",
            Keyword::This => "TSThisType",
            Keyword::Intrinsic => "TSIntrinsicKeyword",
        },
        TypeKind::StringLit(_)
        | TypeKind::NumberLit(_)
        | TypeKind::BigIntLit { .. }
        | TypeKind::BoolLit(_) => "TSLiteralType",
        TypeKind::Template(_) => "TSTemplateLiteralType",
        TypeKind::Array(_) => "TSArrayType",
        TypeKind::Tuple(_) => "TSTupleType",
        TypeKind::Union(_) => "TSUnionType",
        TypeKind::Intersection(_) => "TSIntersectionType",
        TypeKind::Fn(func) => type_name_of_func(func),
        TypeKind::Object(_) => "TSTypeLiteral",
        TypeKind::Cond { .. } => "TSConditionalType",
        TypeKind::Infer(_) => "TSInferType",
        TypeKind::Mapped(_) => "TSMappedType",
        TypeKind::IndexedAccess { .. } => "TSIndexedAccessType",
        TypeKind::Keyof(_) | TypeKind::Readonly(_) | TypeKind::UniqueSymbol => "TSTypeOperator",
        TypeKind::Typeof { .. }
        | TypeKind::Import {
            is_typeof: true, ..
        } => "TSTypeQuery",
        TypeKind::Import { .. } => "TSImportType",
        TypeKind::Predicate { .. } => "TSTypePredicate",
    }
}

fn type_name_of_pat(pat: Pat<'_>) -> &'static str {
    match pat.kind() {
        PatKind::Ident(_) | PatKind::Missing => "Identifier",
        PatKind::Object(_) => "ObjectPattern",
        PatKind::Array(_) => "ArrayPattern",
    }
}

fn type_name_of_param(param: Param<'_>) -> &'static str {
    match () {
        () if param.is_parameter_property() => "TSParameterProperty",
        () if param.is_rest() => "RestElement",
        () if param.default().is_some() => "AssignmentPattern",
        () => type_name_of_pat(param.pat()),
    }
}

/// ESTree's `node.type`, that of typescript-estree for TypeScript's syntax.
///
/// Where one node here stands for several of ESTree, it is the outermost that is not a mere
/// wrapper: a `Param` with a default is an `AssignmentPattern`, an exported declaration is the
/// declaration and not the `ExportNamedDeclaration`, the root of an optional chain is the member
/// access or the call and not the `ChainExpression`. Where a node here has none in ESTree, it is
/// what it holds: the `StmtKind::Expr` in the head of a `for` is the expression, the `VarDecl` of
/// `catch (e)` the pattern.
pub fn estree_type_name(node: Node<'_>) -> &'static str {
    match node {
        Node::File(_) => "Program",
        Node::Expr(e) => type_name_of_expr(e),
        Node::Stmt(statement) => type_name_of_stmt(statement),
        Node::Type(ty) => type_name_of_type(ty),
        Node::Pat(pat) => type_name_of_pat(pat),
        Node::PatProp(prop) if prop.is_rest() => "RestElement",
        Node::PatProp(_) => "Property",
        Node::PatElem(element) => match element.pat() {
            _ if element.is_rest() => "RestElement",
            _ if element.default().is_some() => "AssignmentPattern",
            Some(pat) => type_name_of_pat(pat),
            None => "Identifier",
        },
        Node::Func(func) => type_name_of_func(func),
        Node::Param(param) => type_name_of_param(param),
        Node::TypeParam(_) => "TSTypeParameter",
        Node::Class(class) => type_name_of_class(class),
        Node::Member(member) => {
            let flags = member.flags();
            let is_abstract = flags.contains(Flags::ABSTRACT);
            let in_class = matches!(member.parent(), Node::Class(_));
            match member.kind() {
                MemberKind::Property if !in_class => "TSPropertySignature",
                MemberKind::Property => match (flags.contains(Flags::ACCESSOR), is_abstract) {
                    (true, true) => "TSAbstractAccessorProperty",
                    (true, false) => "AccessorProperty",
                    (false, true) => "TSAbstractPropertyDefinition",
                    (false, false) => "PropertyDefinition",
                },
                MemberKind::Method | MemberKind::Getter | MemberKind::Setter if !in_class => {
                    "TSMethodSignature"
                }
                MemberKind::Method
                | MemberKind::Getter
                | MemberKind::Setter
                | MemberKind::Constructor => match is_abstract {
                    true => "TSAbstractMethodDefinition",
                    false => "MethodDefinition",
                },
                MemberKind::CallSignature => "TSCallSignatureDeclaration",
                MemberKind::ConstructSignature => "TSConstructSignatureDeclaration",
                MemberKind::IndexSignature => "TSIndexSignature",
                MemberKind::StaticBlock => "StaticBlock",
            }
        }
        Node::Prop(prop) => match (prop.kind(), prop.parent()) {
            (PropKind::Spread, Node::Expr(owner)) => match owner.kind() {
                ExprKind::Jsx(_) => "JSXSpreadAttribute",
                _ if is_assignment_target(owner) => "RestElement",
                _ => "SpreadElement",
            },
            _ if prop.is_jsx_attribute() => "JSXAttribute",
            _ => "Property",
        },
        Node::VarDecl(declaration) if is_catch_param(declaration) => {
            type_name_of_pat(declaration.pat())
        }
        Node::VarDecl(_) => "VariableDeclarator",
        Node::Case(_) => "SwitchCase",
        Node::EnumMember(_) => "TSEnumMember",
        Node::ImportSpec(_) => "ImportSpecifier",
        Node::ExportSpec(_) => "ExportSpecifier",
        Node::TupleElem(element) => match () {
            // Of `...name: T`, the `name: T` is a `TSNamedTupleMember` in it.
            () if element.is_rest() => "TSRestType",
            () if element.name().is_some() => "TSNamedTupleMember",
            () if element.is_optional() => "TSOptionalType",
            () => type_name_of_type(element.ty()),
        },
    }
}

// ───────────────────────────── node.range ─────────────────────────────

/// Whether `declaration` is the `e` of `catch (e)`, which in ESTree is the pattern alone.
fn is_catch_param(declaration: VarDecl<'_>) -> bool {
    matches!(declaration.parent(), Node::Stmt(statement) if matches!(statement.kind(), StmtKind::Try { .. }))
}

fn span_of_pat(pat: Pat<'_>) -> Span {
    match pat.parent() {
        // The annotation belongs to the `RestElement`.
        Node::Param(param) if param.is_rest() => pat.span(),
        Node::Param(param) => param.binding_span(),
        Node::VarDecl(declaration) => declaration.binding_span(),
        _ => pat.span(),
    }
}

/// ESTree's `node.range`, that of typescript-estree for TypeScript's syntax, of the node that
/// [`estree_type_name`] names. It differs from `node.span()` for:
///
/// - an exported declaration: without `export` and `export default`,
/// - the function of a method or an accessor: from its type parameters or its `(`,
/// - a pattern with a type annotation, in a declarator or a parameter: with the `?` and the
///   annotation,
/// - a parameter with a default value: without decorators,
/// - the expression in the head of a `for`, and the parameter of a `catch`: see
///   [`estree_type_name`].
pub fn estree_span(node: Node<'_>) -> Span {
    match node {
        Node::Stmt(statement) => match statement.kind() {
            StmtKind::Expr(e) if is_for_init(statement) => e.span(),
            _ => statement.span_without_export(),
        },
        Node::VarDecl(declaration) if is_catch_param(declaration) => span_of_pat(declaration.pat()),
        Node::Func(func) => func.estree_span(),
        Node::Class(class) => class.estree_span(),
        Node::Pat(pat) => span_of_pat(pat),
        // Only these have their decorators in their range.
        Node::Param(param) if param.is_parameter_property() || param.is_rest() => param.span(),
        Node::Param(param) => param.span_without_modifiers(),
        _ => node.span(),
    }
}

/// [`TypeNode::annotation_span`]: typescript-estree's range of the `TSTypeAnnotation` around `ty`,
/// from the `:`, or from the `=>` of a function type, to the end of the type with the parentheses
/// around it.
#[inline]
pub fn type_annotation_span(ty: TypeNode<'_>) -> Span {
    ty.annotation_span()
}

/// [`Stmt::catch_clause_span`]: ESTree's range of the `CatchClause` of a `try` statement, from
/// `catch` to the end of the handler.
#[inline]
pub fn catch_clause_span(statement: Stmt<'_>) -> Option<Span> {
    statement.catch_clause_span()
}

// ───────────────────────────── node.parent ─────────────────────────────

/// One node for what ESTree has one node for: the `Expr` or the `Stmt` that is a function becomes
/// the `Func`, the one that is a class the `Class`, a signature or a static block that is a
/// `Member` with nothing but a `Func` stays the `Member`.
pub fn normalize(node: Node<'_>) -> Node<'_> {
    match node {
        Node::Expr(e) => match e.kind() {
            ExprKind::Fn(func) => Node::Func(func),
            ExprKind::Class(class) => Node::Class(class),
            _ => node,
        },
        Node::Stmt(statement) => match statement.kind() {
            StmtKind::Fn(func) => Node::Func(func),
            StmtKind::Class(class) => Node::Class(class),
            _ => node,
        },
        Node::Type(ty) => match ty.kind() {
            TypeKind::Fn(func) => Node::Func(func),
            _ => node,
        },
        _ => node,
    }
}

/// ESTree's `node.parent`, [`normalize`]d, for walks that compare node types.
///
/// - The parent of a `Func` or a `Class` is that of the expression or the statement it is. That of
///   the function of a method is the `Member` or the `Prop`.
/// - The `a, b` inside `a, b, c` is skipped, and the `StmtKind::Expr` in the head of a `for`.
/// - The nodes of ESTree that do not exist here are not in the walk: the `BlockStatement` that is
///   the body of a function (the parent of a statement in it is the `Func`), `ClassBody`,
///   `ChainExpression`, `ExportNamedDeclaration` and `ExportDefaultDeclaration` around a
///   declaration, `CatchClause`, `TSTypeAnnotation`, `JSXExpressionContainer`,
///   `JSXOpeningElement`, `TSModuleBlock`, `TSInterfaceBody`, `TemplateElement`.
pub fn estree_parent(node: Node<'_>) -> Node<'_> {
    let parent = match node {
        Node::Func(func) => match func.owner() {
            owner @ (Node::Expr(_) | Node::Stmt(_) | Node::Type(_)) => owner.parent(),
            owner => owner,
        },
        Node::Class(class) => class.owner().parent(),
        _ => node.parent(),
    };
    match parent {
        Node::Expr(e) if is_inner_comma(e) => Node::Expr(sequence_root(e)),
        Node::Stmt(statement) if matches!(node, Node::Expr(_)) && is_for_init(statement) => {
            statement.parent()
        }
        _ => normalize(parent),
    }
}

/// [`estree_parent`], the parent of that, and so on. The last is the file.
pub fn estree_ancestors(node: Node<'_>) -> impl Iterator<Item = Node<'_>> {
    std::iter::successors(Some(node), |&at| match at {
        Node::File(_) => None,
        _ => Some(estree_parent(at)),
    })
    .skip(1)
}

/// ESLint's `sourceCode.getNodeByRangeIndex`: the innermost node whose span contains `offset`.
/// It is never the `Expr` or the `Stmt` that is a function or a class, but the `Func` or the
/// `Class`.
pub fn get_node_by_range_index<'a>(file: &'a File<'a>, offset: u32) -> Node<'a> {
    let mut at = Node::File(file);
    loop {
        let mut inner = None;
        at.for_each_child_near(offset, |child| {
            // ESTree has these decorators outside of the range of what they are in, so that the
            // search does not get to them.
            let span = match child {
                Node::Param(_) => estree_span(child),
                Node::Stmt(statement) => {
                    statement.export_span().unwrap_or_else(|| statement.span())
                }
                _ => child.span(),
            };
            if inner.is_none() && span.contains_offset(offset) {
                inner = Some(child);
            }
        });
        match inner {
            Some(child) => at = child,
            None => return at,
        }
    }
}
