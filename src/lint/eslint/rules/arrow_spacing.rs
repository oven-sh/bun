use bun_lint::prelude::*;

/// Enforce consistent spacing before and after the arrow in arrow functions.
pub struct ArrowSpacing {
    before: bool,
    after: bool,
}

const EXPECTED_BEFORE: Message = Message::new("expectedBefore", "Missing space before =>.");
const UNEXPECTED_BEFORE: Message = Message::new("unexpectedBefore", "Unexpected space before =>.");
const EXPECTED_AFTER: Message = Message::new("expectedAfter", "Missing space after =>.");
const UNEXPECTED_AFTER: Message = Message::new("unexpectedAfter", "Unexpected space after =>.");

/// Whether the byte next to the arrow separates it from the nearest token. `None` if that takes
/// looking at the tokens: it can be part of a comment or of a wider character.
fn is_gap(next_to_arrow: Option<&u8>) -> Option<bool> {
    match *next_to_arrow? {
        b' ' | b'\t' | b'\n' | b'\r' => Some(true),
        b'/' | 0x0B | 0x0C | 0x80..=0xFF => None,
        _ => Some(false),
    }
}

impl ArrowSpacing {
    fn check<'a>(&self, func: Func<'a>, cx: &mut Cx<'a, Self>) {
        let Some(arrow) = func.arrow_span() else {
            return;
        };
        let (file, text) = (cx.file(), cx.text());

        if is_gap(text.get((arrow.start as usize).wrapping_sub(1))) != Some(self.before)
            && let Some(before) = file.token_before(arrow)
            && (before.end() < arrow.start) != self.before
        {
            if self.before {
                cx.report(before, EXPECTED_BEFORE).fix(|fixer| fixer.insert_before(arrow, " "));
            } else {
                cx.report(before, UNEXPECTED_BEFORE)
                    .fix(|fixer| fixer.remove(before.span().between(arrow)));
            }
        }

        if is_gap(text.get(arrow.end as usize)) != Some(self.after)
            && let Some(after) = file.token_after(arrow)
            && (arrow.end < after.start()) != self.after
        {
            if self.after {
                cx.report(after, EXPECTED_AFTER).fix(|fixer| fixer.insert_after(arrow, " "));
            } else {
                cx.report(after, UNEXPECTED_AFTER)
                    .fix(|fixer| fixer.remove(arrow.between(after.span())));
            }
        }
    }
}

impl Rule for ArrowSpacing {
    const META: Meta = Meta::eslint("arrow-spacing", Kind::Layout)
        .fixable(Fixable::Whitespace)
        .deprecated();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let object = options.object(0);
        ArrowSpacing {
            before: object.bool_or("before", true),
            after: object.bool_or("after", true),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.funcs(Self::check);
    }
}
