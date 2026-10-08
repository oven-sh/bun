//! `getOperatorPrecedence.ts`, `getWrappedCode.ts`, `isHigherPrecedenceThanAwait.ts`.

use crate::ast::{BinOp, Expr, ExprKind, FnKind, Node, PropKind, UnOp};
use std::borrow::Cow;

/// typescript-eslint's `OperatorPrecedence`, which is TypeScript's. It is ordered: a greater one
/// binds tighter.
#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
#[repr(i8)]
pub enum OperatorPrecedence {
    /// Lower than all the others.
    Invalid = -1,
    Comma = 0,
    Spread,
    Yield,
    Assignment,
    Conditional,
    LogicalOR,
    LogicalAND,
    BitwiseOR,
    BitwiseXOR,
    BitwiseAND,
    Equality,
    Relational,
    Shift,
    Additive,
    Multiplicative,
    Exponentiation,
    Unary,
    Update,
    LeftHandSide,
    Member,
    Primary,
}

impl OperatorPrecedence {
    /// Upstream's `Coalesce = Conditional`.
    pub const COALESCE: OperatorPrecedence = OperatorPrecedence::Conditional;
    pub const HIGHEST: OperatorPrecedence = OperatorPrecedence::Primary;
    pub const LOWEST: OperatorPrecedence = OperatorPrecedence::Comma;
}

/// typescript-eslint's `getOperatorPrecedenceForNode`. Parentheses around `e` do not count.
///
/// As upstream: `==` has the precedence of an assignment and `=` is `Invalid`, and so are
/// `satisfies`, `f<T>` and `import()`. The name of `a.b`, which is not an `Expr`, is `Primary`.
pub fn get_operator_precedence_for_node(e: Expr<'_>) -> OperatorPrecedence {
    use OperatorPrecedence as P;
    match e.kind() {
        ExprKind::Spread(_) => P::Spread,
        ExprKind::Yield { .. } => P::Yield,
        ExprKind::Fn(func) if func.is_arrow() => P::Yield,
        ExprKind::Cond { .. } => P::Conditional,
        ExprKind::Binary { op: BinOp::Comma, .. } => P::Comma,
        ExprKind::Binary { op: BinOp::EqEq, .. } | ExprKind::Assign { op: Some(_), .. } => {
            P::Assignment
        }
        ExprKind::Binary { op, .. } => get_binary_operator_precedence(op),
        ExprKind::As { .. } | ExprKind::AsConst(_) => match e.is_angle_bracket_assertion() {
            true => P::Unary,
            false => P::Relational,
        },
        ExprKind::Unary { op: UnOp::PostInc | UnOp::PostDec, .. } => P::Update,
        ExprKind::NonNull(_) | ExprKind::Unary { .. } | ExprKind::Await(_) => P::Unary,
        ExprKind::Call(_) => P::LeftHandSide,
        ExprKind::New(call) => match call.args().is_empty() {
            true => P::LeftHandSide,
            false => P::Member,
        },
        ExprKind::TaggedTemplate(_)
        | ExprKind::Dot { .. }
        | ExprKind::Index { .. }
        | ExprKind::ImportMeta
        | ExprKind::NewTarget => P::Member,
        ExprKind::This
        | ExprKind::Super
        | ExprKind::Ident(_)
        | ExprKind::PrivateIdentifier(_)
        | ExprKind::Null
        | ExprKind::True
        | ExprKind::False
        | ExprKind::Number(_)
        | ExprKind::String(_)
        | ExprKind::BigInt(_)
        | ExprKind::Regex(_)
        | ExprKind::Array(_)
        | ExprKind::Object(_)
        | ExprKind::Fn(_)
        | ExprKind::Class(_)
        | ExprKind::Template(_)
        | ExprKind::Jsx(_) => P::Primary,
        ExprKind::Assign { op: None, .. }
        | ExprKind::Satisfies { .. }
        | ExprKind::Instantiation { .. }
        | ExprKind::ImportCall { .. }
        | ExprKind::Missing => P::Invalid,
    }
}

/// The `ts.SyntaxKind`s that [`get_operator_precedence`] tells apart.
#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum SyntaxKind {
    /// Any other kind.
    Unknown,
    SpreadElement,
    YieldExpression,
    ConditionalExpression,
    /// Also an assignment and the comma operator.
    BinaryExpression,
    TypeAssertionExpression,
    NonNullExpression,
    PrefixUnaryExpression,
    TypeOfExpression,
    VoidExpression,
    DeleteExpression,
    AwaitExpression,
    PostfixUnaryExpression,
    CallExpression,
    NewExpression,
    TaggedTemplateExpression,
    PropertyAccessExpression,
    ElementAccessExpression,
    MetaProperty,
    AsExpression,
    SatisfiesExpression,
    ThisKeyword,
    SuperKeyword,
    Identifier,
    PrivateIdentifier,
    NullKeyword,
    TrueKeyword,
    FalseKeyword,
    NumericLiteral,
    BigIntLiteral,
    StringLiteral,
    ArrayLiteralExpression,
    ObjectLiteralExpression,
    FunctionExpression,
    ArrowFunction,
    ClassExpression,
    RegularExpressionLiteral,
    NoSubstitutionTemplateLiteral,
    TemplateExpression,
    ParenthesizedExpression,
    OmittedExpression,
    JsxElement,
    JsxSelfClosingElement,
    JsxFragment,
}

/// The `operatorToken.kind` of a `ts.BinaryExpression`.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum OperatorKind {
    Binary(BinOp),
    /// `None` is `=`.
    Assign(Option<BinOp>),
}

/// `esTreeNodeToTSNodeMap.get(node).kind`. It is never `ParenthesizedExpression`: ESTree has no
/// node for the parentheses.
pub fn ts_syntax_kind(e: Expr<'_>) -> SyntaxKind {
    use SyntaxKind as K;
    match e.kind() {
        ExprKind::Missing => K::OmittedExpression,
        ExprKind::Ident(_) => K::Identifier,
        ExprKind::PrivateIdentifier(_) => K::PrivateIdentifier,
        ExprKind::This => K::ThisKeyword,
        ExprKind::Super => K::SuperKeyword,
        ExprKind::Null => K::NullKeyword,
        ExprKind::True => K::TrueKeyword,
        ExprKind::False => K::FalseKeyword,
        ExprKind::Number(_) => K::NumericLiteral,
        ExprKind::String(_) => K::StringLiteral,
        ExprKind::BigInt(_) => K::BigIntLiteral,
        ExprKind::Regex(_) => K::RegularExpressionLiteral,
        ExprKind::Template(template) => match template.exprs().is_empty() {
            true => K::NoSubstitutionTemplateLiteral,
            false => K::TemplateExpression,
        },
        ExprKind::TaggedTemplate(_) => K::TaggedTemplateExpression,
        ExprKind::Array(_) => K::ArrayLiteralExpression,
        ExprKind::Object(_) => K::ObjectLiteralExpression,
        ExprKind::Fn(func) => match func.kind() {
            FnKind::Arrow => K::ArrowFunction,
            FnKind::Expr => K::FunctionExpression,
            // The value of a method or an accessor of an object literal is the `MethodDeclaration`
            // or the accessor itself.
            _ => K::Unknown,
        },
        ExprKind::Class(_) => K::ClassExpression,
        ExprKind::Dot { .. } => K::PropertyAccessExpression,
        ExprKind::Index { .. } => K::ElementAccessExpression,
        ExprKind::Call(_) | ExprKind::ImportCall { .. } => K::CallExpression,
        ExprKind::New(_) => K::NewExpression,
        ExprKind::Unary { op, .. } => match op {
            UnOp::PostInc | UnOp::PostDec => K::PostfixUnaryExpression,
            UnOp::Typeof => K::TypeOfExpression,
            UnOp::Void => K::VoidExpression,
            UnOp::Delete => K::DeleteExpression,
            _ => K::PrefixUnaryExpression,
        },
        ExprKind::Binary { .. } | ExprKind::Assign { .. } => K::BinaryExpression,
        ExprKind::Cond { .. } => K::ConditionalExpression,
        ExprKind::Spread(_) => K::SpreadElement,
        ExprKind::Await(_) => K::AwaitExpression,
        ExprKind::Yield { .. } => K::YieldExpression,
        ExprKind::As { .. } | ExprKind::AsConst(_) => match e.is_angle_bracket_assertion() {
            true => K::TypeAssertionExpression,
            false => K::AsExpression,
        },
        ExprKind::Satisfies { .. } => K::SatisfiesExpression,
        ExprKind::NonNull(_) => K::NonNullExpression,
        ExprKind::Instantiation { .. } => K::Unknown,
        ExprKind::Jsx(jsx) => match () {
            () if jsx.is_fragment() => K::JsxFragment,
            () if jsx.is_self_closing() => K::JsxSelfClosingElement,
            () => K::JsxElement,
        },
        ExprKind::ImportMeta | ExprKind::NewTarget => K::MetaProperty,
    }
}

/// `ts.isBinaryExpression(tsNode) ? tsNode.operatorToken.kind : ts.SyntaxKind.Unknown`, with `None`
/// for `Unknown`.
pub fn ts_operator_kind(e: Expr<'_>) -> Option<OperatorKind> {
    match e.kind() {
        ExprKind::Binary { op, .. } => Some(OperatorKind::Binary(op)),
        ExprKind::Assign { op, .. } => Some(OperatorKind::Assign(op)),
        _ => None,
    }
}

/// The expression that is `tsNode.parent`, if that is an expression other than a
/// `ParenthesizedExpression`. What TypeScript has a node of another kind in between for has none:
/// a substitution of a template (`TemplateSpan`), an expression in the braces of JSX
/// (`JsxExpression`), the default of `{ a = 1 }` in an assignment.
fn ts_parent_expression(e: Expr<'_>) -> Option<Expr<'_>> {
    let Node::Expr(parent) = e.parent() else {
        return None;
    };
    match parent.kind() {
        ExprKind::Template(_) | ExprKind::Jsx(_) => None,
        ExprKind::TaggedTemplate(call) if call.callee() != e && call.template() != Some(e) => None,
        ExprKind::Assign { .. }
            if matches!(parent.parent(), Node::Prop(prop) if prop.kind() == PropKind::Shorthand) =>
        {
            None
        }
        _ => Some(parent),
    }
}

/// `esTreeNodeToTSNodeMap.get(node).parent.kind`: `ParenthesizedExpression` if `e` is in
/// parentheses, `ArrowFunction` if it is the body of one, `Unknown` if the parent is not an
/// expression.
pub fn ts_parent_syntax_kind(e: Expr<'_>) -> SyntaxKind {
    if e.is_parenthesized() {
        return SyntaxKind::ParenthesizedExpression;
    }
    match e.parent() {
        Node::Func(func) if func.is_arrow() => SyntaxKind::ArrowFunction,
        _ => ts_parent_expression(e).map_or(SyntaxKind::Unknown, ts_syntax_kind),
    }
}

/// typescript-eslint's `getOperatorPrecedence` of `tsNode.parent`, with the operator of a parent
/// that is a `BinaryExpression` and with `hasArguments` of a parent that is a `NewExpression`.
pub fn get_operator_precedence_of_ts_parent(e: Expr<'_>) -> OperatorPrecedence {
    let parent = ts_parent_expression(e).filter(|_| !e.is_parenthesized());
    get_operator_precedence(
        ts_parent_syntax_kind(e),
        parent.and_then(ts_operator_kind),
        parent.is_some_and(|it| matches!(it.kind(), ExprKind::New(call) if !call.args().is_empty())),
    )
}

/// typescript-eslint's `getOperatorPrecedence`. Upstream takes `ts.SyntaxKind`s: see
/// [`ts_syntax_kind`], [`ts_operator_kind`] and [`ts_parent_syntax_kind`] for those of a node. For
/// a constant kind, write the result:
/// `getOperatorPrecedence(SyntaxKind.AsExpression, SyntaxKind.Unknown)` is
/// `OperatorPrecedence::Relational`.
///
/// `operator_kind` matters for a `BinaryExpression` only, which is `Invalid` without one.
pub fn get_operator_precedence(
    node_kind: SyntaxKind,
    operator_kind: Option<OperatorKind>,
    has_arguments: bool,
) -> OperatorPrecedence {
    use OperatorPrecedence as P;
    use SyntaxKind as K;
    match node_kind {
        K::SpreadElement => P::Spread,
        K::YieldExpression => P::Yield,
        K::ConditionalExpression => P::Conditional,
        K::BinaryExpression => match operator_kind {
            Some(OperatorKind::Assign(_)) => P::Assignment,
            Some(OperatorKind::Binary(BinOp::Comma)) => P::Comma,
            Some(OperatorKind::Binary(op)) => get_binary_operator_precedence(op),
            None => P::Invalid,
        },
        K::TypeAssertionExpression
        | K::NonNullExpression
        | K::PrefixUnaryExpression
        | K::TypeOfExpression
        | K::VoidExpression
        | K::DeleteExpression
        | K::AwaitExpression => P::Unary,
        K::PostfixUnaryExpression => P::Update,
        K::CallExpression => P::LeftHandSide,
        K::NewExpression => match has_arguments {
            true => P::Member,
            false => P::LeftHandSide,
        },
        K::TaggedTemplateExpression
        | K::PropertyAccessExpression
        | K::ElementAccessExpression
        | K::MetaProperty => P::Member,
        K::AsExpression | K::SatisfiesExpression => P::Relational,
        K::ThisKeyword
        | K::SuperKeyword
        | K::Identifier
        | K::PrivateIdentifier
        | K::NullKeyword
        | K::TrueKeyword
        | K::FalseKeyword
        | K::NumericLiteral
        | K::BigIntLiteral
        | K::StringLiteral
        | K::ArrayLiteralExpression
        | K::ObjectLiteralExpression
        | K::FunctionExpression
        | K::ArrowFunction
        | K::ClassExpression
        | K::RegularExpressionLiteral
        | K::NoSubstitutionTemplateLiteral
        | K::TemplateExpression
        | K::ParenthesizedExpression
        | K::OmittedExpression
        | K::JsxElement
        | K::JsxSelfClosingElement
        | K::JsxFragment => P::Primary,
        K::Unknown => P::Invalid,
    }
}

/// typescript-eslint's `getBinaryOperatorPrecedence`. The comma is `Invalid`, as upstream.
pub fn get_binary_operator_precedence(op: BinOp) -> OperatorPrecedence {
    use OperatorPrecedence as P;
    match op {
        BinOp::Add | BinOp::Sub => P::Additive,
        BinOp::EqEq | BinOp::NotEq | BinOp::EqEqEq | BinOp::NotEqEq => P::Equality,
        BinOp::Nullish => P::COALESCE,
        BinOp::Mul | BinOp::Div | BinOp::Rem => P::Multiplicative,
        BinOp::Pow => P::Exponentiation,
        BinOp::BitAnd => P::BitwiseAND,
        BinOp::And => P::LogicalAND,
        BinOp::BitXor => P::BitwiseXOR,
        BinOp::Lt | BinOp::Le | BinOp::Gt | BinOp::Ge | BinOp::In | BinOp::Instanceof => {
            P::Relational
        }
        BinOp::Shl | BinOp::Shr | BinOp::UShr => P::Shift,
        BinOp::BitOr => P::BitwiseOR,
        BinOp::Or => P::LogicalOR,
        BinOp::Comma => P::Invalid,
    }
}

/// typescript-eslint's `getWrappedCode`: `text`, in parentheses unless `node_precedence` is greater
/// than `parent_precedence`.
pub fn get_wrapped_code(
    text: &[u8],
    node_precedence: OperatorPrecedence,
    parent_precedence: OperatorPrecedence,
) -> Cow<'_, [u8]> {
    match node_precedence > parent_precedence {
        true => Cow::Borrowed(text),
        false => Cow::Owned(parenthesize(text)),
    }
}

/// `(text)`
pub(super) fn parenthesize(text: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(text.len() + 2);
    out.push(b'(');
    out.extend_from_slice(text);
    out.push(b')');
    out
}

/// typescript-eslint's `isHigherPrecedenceThanAwait`. Upstream takes the `ts.Node` of an ESTree
/// node, so parentheses around `e` do not count.
pub fn is_higher_precedence_than_await(e: Expr<'_>) -> bool {
    get_operator_precedence(ts_syntax_kind(e), ts_operator_kind(e), false)
        > OperatorPrecedence::Unary
}
