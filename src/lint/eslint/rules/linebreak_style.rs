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
    const ON: On = On::new().finish();
    no_state!();

    fn new(options: &Options) -> Self {
        LinebreakStyle {
            expects_lf: options.str(0).unwrap_or("unix") == "unix",
        }
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let (expected, message) = match self.expects_lf {
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
    }
}
