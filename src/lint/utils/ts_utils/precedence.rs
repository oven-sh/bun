//! `getOperatorPrecedence.ts`, `getWrappedCode.ts`, `isHigherPrecedenceThanAwait.ts`.

use crate::ast::{BinOp, Expr, ExprKind, FnKind, Node, PropKind, UnOp};
use crate::types::SyntaxKind;
use crate::utils::ast_utils::is_member_expression;
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

/// `esTreeNodeToTSNodeMap.get(node).kind`, from the syntax alone: `e.ts_node().kind()` needs a
/// program. It is never `ParenthesizedExpression`: ESTree has no node for the parentheses.
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
        ExprKind::String(_) if e.is_jsx_text() => K::JsxText,
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
        // The value of a method or an accessor of an object literal is the declaration itself.
        ExprKind::Fn(func) => match func.kind() {
            FnKind::Arrow => K::ArrowFunction,
            FnKind::Getter => K::GetAccessor,
            FnKind::Setter => K::SetAccessor,
            FnKind::Method => K::MethodDeclaration,
            _ => K::FunctionExpression,
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
        ExprKind::Instantiation { .. } => K::ExpressionWithTypeArguments,
        ExprKind::Jsx(jsx) => match () {
            () if jsx.is_fragment() => K::JsxFragment,
            () if jsx.is_self_closing() => K::JsxSelfClosingElement,
            () => K::JsxElement,
        },
        ExprKind::ImportMeta | ExprKind::NewTarget => K::MetaProperty,
    }
}

/// The `ts.SyntaxKind` of the token of a binary operator.
pub fn binary_operator_token_kind(op: BinOp) -> SyntaxKind {
    use SyntaxKind as K;
    match op {
        BinOp::Add => K::PlusToken,
        BinOp::Sub => K::MinusToken,
        BinOp::Mul => K::AsteriskToken,
        BinOp::Div => K::SlashToken,
        BinOp::Rem => K::PercentToken,
        BinOp::Pow => K::AsteriskAsteriskToken,
        BinOp::Shl => K::LessThanLessThanToken,
        BinOp::Shr => K::GreaterThanGreaterThanToken,
        BinOp::UShr => K::GreaterThanGreaterThanGreaterThanToken,
        BinOp::BitAnd => K::AmpersandToken,
        BinOp::BitOr => K::BarToken,
        BinOp::BitXor => K::CaretToken,
        BinOp::Lt => K::LessThanToken,
        BinOp::Le => K::LessThanEqualsToken,
        BinOp::Gt => K::GreaterThanToken,
        BinOp::Ge => K::GreaterThanEqualsToken,
        BinOp::EqEq => K::EqualsEqualsToken,
        BinOp::NotEq => K::ExclamationEqualsToken,
        BinOp::EqEqEq => K::EqualsEqualsEqualsToken,
        BinOp::NotEqEq => K::ExclamationEqualsEqualsToken,
        BinOp::In => K::InKeyword,
        BinOp::Instanceof => K::InstanceOfKeyword,
        BinOp::And => K::AmpersandAmpersandToken,
        BinOp::Or => K::BarBarToken,
        BinOp::Nullish => K::QuestionQuestionToken,
        BinOp::Comma => K::CommaToken,
    }
}

/// The `ts.SyntaxKind` of the token of an assignment operator. `None` is `=`.
pub fn assignment_operator_token_kind(op: Option<BinOp>) -> SyntaxKind {
    use SyntaxKind as K;
    match op {
        None => K::EqualsToken,
        Some(BinOp::Add) => K::PlusEqualsToken,
        Some(BinOp::Sub) => K::MinusEqualsToken,
        Some(BinOp::Mul) => K::AsteriskEqualsToken,
        Some(BinOp::Div) => K::SlashEqualsToken,
        Some(BinOp::Rem) => K::PercentEqualsToken,
        Some(BinOp::Pow) => K::AsteriskAsteriskEqualsToken,
        Some(BinOp::Shl) => K::LessThanLessThanEqualsToken,
        Some(BinOp::Shr) => K::GreaterThanGreaterThanEqualsToken,
        Some(BinOp::UShr) => K::GreaterThanGreaterThanGreaterThanEqualsToken,
        Some(BinOp::BitAnd) => K::AmpersandEqualsToken,
        Some(BinOp::BitOr) => K::BarEqualsToken,
        Some(BinOp::BitXor) => K::CaretEqualsToken,
        Some(BinOp::And) => K::AmpersandAmpersandEqualsToken,
        Some(BinOp::Or) => K::BarBarEqualsToken,
        Some(BinOp::Nullish) => K::QuestionQuestionEqualsToken,
        Some(_) => K::Unknown,
    }
}

/// `ts.isBinaryExpression(tsNode) ? tsNode.operatorToken.kind : ts.SyntaxKind.Unknown`
pub fn ts_operator_kind(e: Expr<'_>) -> SyntaxKind {
    match e.kind() {
        ExprKind::Binary { op, .. } => binary_operator_token_kind(op),
        ExprKind::Assign { op, .. } => assignment_operator_token_kind(op),
        _ => SyntaxKind::Unknown,
    }
}

/// The expression that is `tsNode.parent`, if that is an expression other than a
/// `ParenthesizedExpression`. What TypeScript has a node of another kind in between for has none:
/// a substitution of a template (`TemplateSpan`), an expression in the braces of JSX
/// (`JsxExpression`), the name of a tag, the default of `{ a = 1 }` in an assignment, the `a` of
/// `typeof a.b` (`QualifiedName`).
fn ts_parent_expression(e: Expr<'_>) -> Option<Expr<'_>> {
    let parent = match e.parent() {
        Node::Expr(parent) => parent,
        // The value of a method is the `MethodDeclaration`, which is directly in the object.
        Node::Prop(prop) if prop.func().is_some() && prop.value() == Some(e) => {
            return prop.parent().as_expr();
        }
        _ => return None,
    };
    match parent.kind() {
        ExprKind::Template(_) => None,
        ExprKind::Jsx(_) => (matches!(e.kind(), ExprKind::Jsx(_))
            && e.jsx_container_span().is_none())
        .then_some(parent),
        ExprKind::Dot { .. } if !is_member_expression(parent) => None,
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
        parent.map_or(SyntaxKind::Unknown, ts_operator_kind),
        parent.is_some_and(|it| matches!(it.kind(), ExprKind::New(call) if !call.args().is_empty())),
    )
}

/// typescript-eslint's `getOperatorPrecedence`. For the kinds of a node without a program, see
/// [`ts_syntax_kind`], [`ts_operator_kind`] and [`ts_parent_syntax_kind`].
///
/// `operator_kind` matters for a `BinaryExpression` only, which is `Invalid` with `Unknown`.
pub fn get_operator_precedence(
    node_kind: SyntaxKind,
    operator_kind: SyntaxKind,
    has_arguments: bool,
) -> OperatorPrecedence {
    use OperatorPrecedence as P;
    use SyntaxKind as K;
    match node_kind {
        K::SpreadElement => P::Spread,
        K::YieldExpression => P::Yield,
        K::ConditionalExpression => P::Conditional,
        K::BinaryExpression => match operator_kind {
            K::AmpersandAmpersandEqualsToken
            | K::AmpersandEqualsToken
            | K::AsteriskAsteriskEqualsToken
            | K::AsteriskEqualsToken
            | K::BarBarEqualsToken
            | K::BarEqualsToken
            | K::CaretEqualsToken
            | K::EqualsToken
            | K::GreaterThanGreaterThanEqualsToken
            | K::GreaterThanGreaterThanGreaterThanEqualsToken
            | K::LessThanLessThanEqualsToken
            | K::MinusEqualsToken
            | K::PercentEqualsToken
            | K::PlusEqualsToken
            | K::QuestionQuestionEqualsToken
            | K::SlashEqualsToken => P::Assignment,
            K::CommaToken => P::Comma,
            _ => get_binary_operator_precedence_of_kind(operator_kind),
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
        _ => P::Invalid,
    }
}

/// typescript-eslint's `getBinaryOperatorPrecedence`, for the operator of an ESTree node. The comma
/// is `Invalid`, as upstream.
pub fn get_binary_operator_precedence(op: BinOp) -> OperatorPrecedence {
    get_binary_operator_precedence_of_kind(binary_operator_token_kind(op))
}

/// typescript-eslint's `getBinaryOperatorPrecedence`, for a `ts.SyntaxKind`.
pub fn get_binary_operator_precedence_of_kind(kind: SyntaxKind) -> OperatorPrecedence {
    use OperatorPrecedence as P;
    use SyntaxKind as K;
    match kind {
        K::MinusToken | K::PlusToken => P::Additive,
        K::EqualsEqualsEqualsToken
        | K::EqualsEqualsToken
        | K::ExclamationEqualsEqualsToken
        | K::ExclamationEqualsToken => P::Equality,
        K::QuestionQuestionToken => P::COALESCE,
        K::AsteriskToken | K::PercentToken | K::SlashToken => P::Multiplicative,
        K::AsteriskAsteriskToken => P::Exponentiation,
        K::AmpersandToken => P::BitwiseAND,
        K::AmpersandAmpersandToken => P::LogicalAND,
        K::CaretToken => P::BitwiseXOR,
        K::AsKeyword
        | K::GreaterThanEqualsToken
        | K::GreaterThanToken
        | K::InKeyword
        | K::InstanceOfKeyword
        | K::LessThanEqualsToken
        | K::LessThanToken => P::Relational,
        K::GreaterThanGreaterThanGreaterThanToken
        | K::GreaterThanGreaterThanToken
        | K::LessThanLessThanToken => P::Shift,
        K::BarToken => P::BitwiseOR,
        K::BarBarToken => P::LogicalOR,
        _ => P::Invalid,
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
