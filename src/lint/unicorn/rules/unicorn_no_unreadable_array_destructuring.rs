use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallows destructuring values from an array in ways that are difficult to read.
pub struct NoUnreadableArrayDestructuring;

const NO_UNREADABLE_ARRAY_DESTRUCTURING: Message =
    Message::new("", "Array destructuring may not contain consecutive ignored values.");

#[derive(Copy, Clone, PartialEq, Eq)]
enum Element {
    Hole,
    Value,
    Rest,
}

fn is_unreadable_array_destructuring(elements: impl Iterator<Item = Element>) -> bool {
    let (mut len, mut has_rest, mut has_consecutive_holes, mut previous) = (0, false, false, Element::Value);
    for element in elements {
        if element == Element::Rest {
            has_rest = true;
            continue;
        }
        len += 1;
        has_consecutive_holes |= element == Element::Hole && previous == Element::Hole;
        previous = element;
    }
    has_consecutive_holes && (len >= 3 || has_rest)
}

impl Rule for NoUnreadableArrayDestructuring {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "no-unreadable-array-destructuring", Kind::Suggestion);
    const ON: On = On::new().pats(&[PatTag::Array]).exprs(&[ExprTag::Array]);
    no_state!();

    fn new(_: &Options) -> Self {
        NoUnreadableArrayDestructuring
    }

    fn pat<'a>(&self, pat: Pat<'a>, cx: &mut Cx<'a, Self>) {
        let PatKind::Array(elements) = pat.kind() else {
            return;
        };
        let elements = elements.iter().map(|it| match it.pat() {
            _ if it.is_rest() => Element::Rest,
            Some(_) => Element::Value,
            None => Element::Hole,
        });
        if is_unreadable_array_destructuring(elements) {
            cx.report(pat, NO_UNREADABLE_ARRAY_DESTRUCTURING);
        }
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Array(elements) = e.kind() else {
            return;
        };
        if elements.len() < 3 || !e.is_assignment_target() {
            return;
        }
        let elements = elements.iter().map(|it| match it.tag() {
            ExprTag::Spread => Element::Rest,
            ExprTag::Missing => Element::Hole,
            _ => Element::Value,
        });
        if is_unreadable_array_destructuring(elements) {
            cx.report(e, NO_UNREADABLE_ARRAY_DESTRUCTURING);
        }
    }
}
