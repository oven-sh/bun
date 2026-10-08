use bun_lint::prelude::*;

/// Enforce consistent linebreak style.
pub struct LinebreakStyle {
    expects_lf: bool,
}

const EXPECTED_LF: Message = Message::new(
    "expectedLF",
    "Expected linebreaks to be 'LF' but found 'CRLF'.",
);
const EXPECTED_CRLF: Message = Message::new(
    "expectedCRLF",
    "Expected linebreaks to be 'CRLF' but found 'LF'.",
);

impl Rule for LinebreakStyle {
    const META: Meta = Meta::eslint("linebreak-style", Kind::Layout)
        .fixable(Fixable::Whitespace)
        .deprecated();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        LinebreakStyle {
            expects_lf: options.str(0).unwrap_or("unix") == "unix",
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.finish(|rule, cx| {
            let (expected, message) = match rule.expects_lf {
                true => ("\n", EXPECTED_LF),
                false => ("\r\n", EXPECTED_CRLF),
            };
            let text = cx.text();
            for (start, len) in ast_utils::create_global_linebreak_matcher(text) {
                if text.get(start..start + len) == Some(expected.as_bytes()) {
                    continue;
                }
                let line_break = Span::new(start as u32, (start + len) as u32);
                cx.report(line_break, message).fix(|fixer| fixer.replace(line_break, expected));
            }
        });
    }
}
