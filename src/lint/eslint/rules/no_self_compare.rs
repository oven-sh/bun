use super::no_dupe_else_if::can_have_equal_tokens as is_parsed_alike;
use bun_lint::prelude::*;

/// Disallow comparisons where both sides are exactly the same.
pub struct NoSelfCompare;

const COMPARING_TO_SELF: Message =
    Message::new("comparingToSelf", "Comparing to itself is potentially pointless.");

/// Whether `text` ends with an escape as a name can have it: `\u0061`, `\u{61}`.
fn ends_with_escape(text: &[u8]) -> bool {
    match text {
        [rest @ .., b'}'] => {
            let digits = rest.iter().rev().take_while(|it| it.is_ascii_hexdigit()).count();
            rest.get(..rest.len() - digits).is_some_and(|it| it.ends_with(b"\\u{"))
        }
        _ => text.len().checked_sub(6).and_then(|at| text.get(at..)).is_some_and(|it| it.starts_with(b"\\u")),
    }
}

/// Whether the first tokens and the last tokens of the two can be the same, without a look at the
/// tokens. A name with an escape is the same token as the name it stands for.
fn can_have_equal_tokens(left: &[u8], right: &[u8]) -> bool {
    (left.first() == right.first() || left.first() == Some(&b'\\') || right.first() == Some(&b'\\'))
        && (left.last() == right.last() || ends_with_escape(left) || ends_with_escape(right))
}

impl Rule for NoSelfCompare {
    const META: Meta = Meta::eslint("no-self-compare", Kind::Problem);
    const ON: On = On::new().binaries(&[
        BinOp::EqEqEq,
        BinOp::EqEq,
        BinOp::NotEqEq,
        BinOp::NotEq,
        BinOp::Gt,
        BinOp::Lt,
        BinOp::Ge,
        BinOp::Le,
    ]);
    no_state!();

    fn new(_: &Options) -> Self {
        NoSelfCompare
    }

    fn binary<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some((_, left, right)) = e.as_binary() else {
            return;
        };
        // The same tokens are the same kind of expression.
        if left.tag() != right.tag() {
            return;
        }
        let is_oxlint = cx.language().is_oxlint;
        let is_same = match left.tag() {
            // oxlint compares what literals stand for: `"a" === 'a'`, `1.0 === 1`.
            ExprTag::String if is_oxlint => left.as_string() == right.as_string(),
            ExprTag::Number if is_oxlint => left.as_number() == right.as_number(),
            _ => {
                can_have_equal_tokens(left.text(), right.text())
                    && is_parsed_alike(left, right)
                    && ast_utils::equal_tokens(cx.file(), left, right)
            }
        };
        if is_same {
            // oxlint points at the left side.
            cx.report(if is_oxlint { left.outer_span() } else { e.span() }, COMPARING_TO_SELF)
                .labels_with(|labels| labels.push(right.outer_span(), ""));
        }
    }
}
