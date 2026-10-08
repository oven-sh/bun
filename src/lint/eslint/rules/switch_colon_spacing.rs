use bun_lint::prelude::*;

/// Enforce spacing around colons of switch statements.
pub struct SwitchColonSpacing {
    before: bool,
    after: bool,
}

const EXPECTED_BEFORE: Message =
    Message::new("expectedBefore", "Expected space(s) before this colon.");
const EXPECTED_AFTER: Message =
    Message::new("expectedAfter", "Expected space(s) after this colon.");
const UNEXPECTED_BEFORE: Message =
    Message::new("unexpectedBefore", "Unexpected space(s) before this colon.");
const UNEXPECTED_AFTER: Message =
    Message::new("unexpectedAfter", "Unexpected space(s) after this colon.");

/// `left` and `right` are consecutive tokens.
fn is_valid_spacing<'a>(file: &'a File<'a>, left: Span, right: Span, expected: bool) -> bool {
    let between = file.slice(left.between(right));
    let is_space_between = match bun_core::strings::contains_char(between, b'/') {
        true => file.is_space_between(left, right),
        false => !between.is_empty(),
    };
    is_space_between == expected || !ast_utils::is_token_on_same_line(file, left, right)
}

fn fix(fixer: Fixer<'_>, left: Span, right: Span, spacing: bool) -> Option<Fix> {
    if fixer.file().comments_exist_between(left, right) {
        return None;
    }
    Some(match spacing {
        true => fixer.insert_after(left, " "),
        false => fixer.remove(left.between(right)),
    })
}

impl SwitchColonSpacing {
    fn check<'a>(&self, case: Case<'a>, cx: &mut Cx<'a, Self>) {
        let text = cx.text();
        let before_token = match case.test() {
            Some(test) => test.outer_span(),
            None => {
                let start = case.span().start;
                Span::new(start, start + "default".len() as u32)
            }
        };
        let colon_start = skip_trivia(text, before_token.end);
        let colon = Span::new(colon_start, colon_start + 1);
        let after_start = skip_trivia(text, colon.end);
        let after_token = Span::new(after_start, after_start + 1);
        let (before, after) = (self.before, self.after);

        if !is_valid_spacing(cx.file(), before_token, colon, before) {
            cx.report(colon, if before { EXPECTED_BEFORE } else { UNEXPECTED_BEFORE })
                .fix(|fixer| fix(fixer, before_token, colon, before));
        }
        if text.get(after_start as usize) != Some(&b'}')
            && !is_valid_spacing(cx.file(), colon, after_token, after)
        {
            cx.report(colon, if after { EXPECTED_AFTER } else { UNEXPECTED_AFTER })
                .fix(|fixer| fix(fixer, colon, after_token, after));
        }
    }
}

impl Rule for SwitchColonSpacing {
    const META: Meta = Meta::eslint("switch-colon-spacing", Kind::Layout)
        .fixable(Fixable::Whitespace)
        .deprecated();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        SwitchColonSpacing {
            before: options.bool_or("before", false),
            after: options.bool_or("after", true),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.cases(Self::check);
    }
}
