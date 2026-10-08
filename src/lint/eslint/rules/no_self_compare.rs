use bun_core::strings;
use bun_lint::prelude::*;

/// Disallow comparisons where both sides are exactly the same.
pub struct NoSelfCompare;

const COMPARING_TO_SELF: Message =
    Message::new("comparingToSelf", "Comparing to itself is potentially pointless.");

/// Whether the first tokens and the last tokens of the two can be the same, without a look at the
/// tokens. A name with an escape is the same token as the name it stands for. `has_escapes`: whether
/// there is a `\` in the file, once that has been asked.
fn can_have_equal_tokens(left: Expr, right: Expr, has_escapes: &mut Option<bool>) -> bool {
    let (file, left, right) = (left.file(), left.text(), right.text());
    (left.first() == right.first() && left.last() == right.last())
        || *has_escapes.get_or_insert_with(|| strings::contains_char(file.text(), b'\\'))
            && (strings::contains_char(left, b'\\') || strings::contains_char(right, b'\\'))
}

impl Rule for NoSelfCompare {
    const META: Meta = Meta::eslint("no-self-compare", Kind::Problem);
    /// Whether there is a `\` in the file.
    type State<'a> = Option<bool>;

    fn new(_: &Options) -> Self {
        NoSelfCompare
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) -> Option<bool> {
        on.exprs([ExprTag::Binary], |_, e, cx| {
            let ExprKind::Binary { op, left, right } = e.kind() else {
                return;
            };
            let is_comparison = matches!(
                op,
                BinOp::EqEqEq
                    | BinOp::EqEq
                    | BinOp::NotEqEq
                    | BinOp::NotEq
                    | BinOp::Gt
                    | BinOp::Lt
                    | BinOp::Ge
                    | BinOp::Le
            );
            // The same tokens are the same kind of expression.
            if is_comparison
                && left.tag() == right.tag()
                && can_have_equal_tokens(left, right, &mut cx.state)
                && ast_utils::equal_tokens(cx.file(), left, right)
            {
                cx.report(e, COMPARING_TO_SELF);
            }
        });
        None
    }
}
