use bun_core::strings;
use bun_lint::prelude::*;

/// Disallow octal escape sequences in string literals.
pub struct NoOctalEscape;

const OCTAL_ESCAPE_SEQUENCE: Message = Message::new(
    "octalEscapeSequence",
    "Don't use octal: '\\{{sequence}}'. Use '\\u....' instead.",
);

/// The group of `/^(?:[^\\]|\\.)*?\\([0-3][0-7]{1,2}|[4-7][0-7]|0(?=[89])|[1-7])/su`.
fn octal_escape(raw: &[u8]) -> Option<&[u8]> {
    let mut at = 0;
    while let Some(found) = strings::index_of_char_usize(raw.get(at..)?, b'\\') {
        let start = at + found + 1;
        let is_octal = |i: usize| matches!(raw.get(start + i), Some(b'0'..=b'7'));
        let len = match raw.get(start)? {
            b'0'..=b'3' if is_octal(1) => 2 + usize::from(is_octal(2)),
            b'4'..=b'7' if is_octal(1) => 2,
            b'0' if matches!(raw.get(start + 1), Some(b'8' | b'9')) => 1,
            b'1'..=b'7' => 1,
            _ => 0,
        };
        if len > 0 {
            return raw.get(start..start + len);
        }
        at = start + 1;
    }
    None
}

impl Rule for NoOctalEscape {
    const META: Meta = Meta::eslint("no-octal-escape", Kind::Suggestion);
    const ON: On = On::new().string_literals();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoOctalEscape
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        strings::contains_char(file.text(), b'\\').then_some(())
    }

    fn string_literal<'a>(&self, literal: Literal<'a>, cx: &mut Cx<'a, Self>) {
        if let Some(sequence) = octal_escape(literal.text()) {
            cx.report(literal, OCTAL_ESCAPE_SEQUENCE).data("sequence", sequence);
        }
    }
}
