use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint_oxlint::ast_util::static_string;

/// Disallow `.split(separator).length` with a separator of one character, which makes an array only to count.
pub struct NoArrayJustToCount {
    /// `countFunction`: called as `countFunction(string, separator)`, it says how often the separator occurs.
    count_function: Option<Box<[u8]>>,
}

const ARRAY_TO_COUNT: Message = Message::new(
    "arrayToCount",
    "`split()` makes an array of all the pieces, and only their number is used. Count how often the separator occurs.",
);

/// The string and the separator of `string.split(separator)`, if the separator is one character that is written out.
fn split_by_character(e: Expr<'_>) -> Option<(Expr<'_>, Expr<'_>)> {
    let call = e.as_call()?;
    let separator = call.args().first().filter(|_| call.args().len() == 1)?;
    let is_one_character = strings::wtf8_codepoints(static_string(separator)?.bytes()).count() == 1;
    let is_split = ast_utils::is_specific_member_access(call.callee(), None, Some("split"));
    call.callee().object().filter(|_| is_one_character && is_split).map(|string| (string, separator))
}

/// Whether `a + b` has to be in parentheses where `e` is.
fn binds_tighter_than_addition(e: Expr) -> bool {
    match e.parent() {
        Node::Expr(parent) if !e.is_parenthesized() => match parent.kind() {
            ExprKind::Call(call) | ExprKind::New(call) => call.callee() == e,
            ExprKind::Index { obj, .. } => obj == e,
            ExprKind::Template(_) | ExprKind::Array(_) | ExprKind::Spread(_) | ExprKind::Jsx(_) => false,
            _ => {
                let precedence = ast_utils::get_precedence(parent);
                precedence < 0 || precedence >= ast_utils::get_binary_operator_precedence(BinOp::Add)
            }
        },
        _ => false,
    }
}

impl Rule for NoArrayJustToCount {
    const META: Meta = Meta::plugin(Plugin::Bun, "no-array-just-to-count", Kind::Suggestion).fixable(Fixable::Code);
    const ON: On = On::new().exprs(&[ExprTag::Dot]);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        NoArrayJustToCount { count_function: options.object(0).str("countFunction").map(|it| it.as_bytes().into()) }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        if !file.mentions("split") {
            return None;
        }
        Some(())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Dot { obj, name, .. } = e.kind() else {
            return;
        };
        if !name.name().is("length") {
            return;
        }
        let Some((string, separator)) = split_by_character(obj) else {
            return;
        };
        // `.length - 1` is the number of separators itself.
        let minus_one = e.parent().as_expr().filter(|parent| {
            matches!(parent.kind(), ExprKind::Binary { op: BinOp::Sub, left, right }
                if left == e && !e.is_parenthesized() && matches!(right.kind(), ExprKind::Number(it) if it == 1.0))
        });
        let reported = minus_one.unwrap_or(e);
        let report = cx.report(reported, ARRAY_TO_COUNT);
        // The function has to be in scope, and `a?.split(..)` can be `undefined`.
        if let Some(function) = self.count_function.as_deref()
            && !e.is_in_optional_chain()
            && string.binary_op() != Some(BinOp::Comma)
            && Node::Expr(e).scope().resolve_bytes(function).is_some()
        {
            report.fix(|fixer| {
                let call = [function, b"(", string.text(), b", ", separator.text(), b")"].concat();
                let text = match (minus_one, binds_tighter_than_addition(e)) {
                    (Some(_), _) => call,
                    (None, true) => [b"(", &call[..], b" + 1)"].concat(),
                    (None, false) => [&call[..], b" + 1"].concat(),
                };
                fixer.replace(reported, text)
            });
        }
    }
}
