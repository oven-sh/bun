use bun_core::strings;
use bun_lint::prelude::*;

/// Disallow irregular whitespace.
pub struct NoIrregularWhitespace {
    skip_comments: bool,
    skip_jsx_text: Option<bool>,
    skip_reg_exps: Option<bool>,
    skip_strings: bool,
    skip_templates: Option<bool>,
}

const NO_IRREGULAR_WHITESPACE: Message =
    Message::new("noIrregularWhitespace", "Irregular whitespace not allowed.");

/// The bytes that the UTF-8 of an irregular whitespace character can start with.
const FIRST_BYTES: &[u8] = b"\x0B\x0C\xC2\xE1\xE2\xE3\xEF";

#[derive(Copy, Clone, PartialEq)]
enum Irregular {
    Whitespace,
    LineTerminator,
}

/// What irregular whitespace character `text` starts with, and its length in bytes.
fn irregular_at(text: &[u8]) -> Option<(Irregular, usize)> {
    Some(match text {
        [0x0B | 0x0C, ..] => (Irregular::Whitespace, 1),
        // U+0085, U+00A0
        [0xC2, 0x85 | 0xA0, ..] => (Irregular::Whitespace, 2),
        // U+2028, U+2029
        [0xE2, 0x80, 0xA8 | 0xA9, ..] => (Irregular::LineTerminator, 3),
        // U+1680, U+180E, U+2000 to U+200B, U+202F, U+205F, U+3000, U+FEFF
        [0xE1, 0x9A, 0x80, ..]
        | [0xE1, 0xA0, 0x8E, ..]
        | [0xE2, 0x80, 0x80..=0x8B | 0xAF, ..]
        | [0xE2, 0x81, 0x9F, ..]
        | [0xE3, 0x80, 0x80, ..]
        | [0xEF, 0xBB, 0xBF, ..] => (Irregular::Whitespace, 3),
        _ => return None,
    })
}

/// What `skipJSXText`, `skipRegExps` and `skipTemplates` are where the options do not say: on in oxlint 1.80.
fn skips_by_default(file: &File) -> bool {
    file.language().is_oxlint
}

/// oxlint reports each character, and not each run of them.
fn oxlint_reports_each_character(file: &File) -> bool {
    file.language().is_oxlint
}

/// The token or the comment that `offset` is in.
// TODO(api): replace by tokens::File::token_or_comment_around
fn token_or_comment_around<'a>(file: &'a File<'a>, offset: u32) -> Option<Token<'a>> {
    let next = match file.tokens_before(Span::empty(offset)).with_comments().next() {
        Some(before) => file.tokens_after(before).with_comments().next(),
        None => file.tokens().with_comments().next(),
    }?;
    (next.start() <= offset).then_some(next)
}

impl NoIrregularWhitespace {
    /// Whether the whitespace at `offset` is in something that the options allow it in. Each of
    /// the nodes that upstream looks at is one token: a string or a regular expression `Literal`,
    /// a `TemplateElement`, a `JSXText`.
    fn is_skipped<'a>(&self, file: &'a File<'a>, offset: u32) -> bool {
        let Some(token) = token_or_comment_around(file, offset) else {
            return false;
        };
        match token.kind() {
            TokenKind::String => self.skip_strings,
            TokenKind::RegularExpression => self.skip_reg_exps.unwrap_or_else(|| skips_by_default(file)),
            TokenKind::Template => self.skip_templates.unwrap_or_else(|| skips_by_default(file)),
            // The value of an attribute is a string `Literal`.
            TokenKind::JsxText => match file.token_before(token) {
                Some(before) if before.is_punctuator("=") => self.skip_strings,
                _ => self.skip_jsx_text.unwrap_or_else(|| skips_by_default(file)),
            },
            TokenKind::Line | TokenKind::Block | TokenKind::Shebang => self.skip_comments,
            _ => false,
        }
    }

    fn check<'a>(&self, cx: &mut Cx<'a, Self>) {
        let text = cx.text();
        let rest_from = |at: usize| text.get(at..).unwrap_or_default();
        // ESLint takes a byte order mark off the text.
        let mut at = if text.starts_with(b"\xEF\xBB\xBF") { 3 } else { 0 };
        // Most files are ASCII, in which there are two such characters.
        let ascii_end = strings::first_non_ascii(rest_from(at)).map_or(text.len(), |first| at + first as usize);
        loop {
            let found = match text.get(at..ascii_end) {
                Some(ascii) if !ascii.is_empty() => strings::index_of_any(ascii, b"\x0B\x0C").unwrap_or(ascii.len()),
                _ => match strings::index_of_any(rest_from(at), FIRST_BYTES) {
                    Some(found) => found,
                    None => return,
                },
            };
            let start = at + found;
            let Some((kind, len)) = irregular_at(rest_from(start)) else {
                at = start + 1;
                continue;
            };
            at = start + len;
            if kind == Irregular::Whitespace && !oxlint_reports_each_character(cx.file()) {
                while let Some((Irregular::Whitespace, len)) = irregular_at(rest_from(at)) {
                    at += len;
                }
            }
            if !self.is_skipped(cx.file(), start as u32) {
                cx.report(Span::new(start as u32, at as u32), NO_IRREGULAR_WHITESPACE);
            }
        }
    }
}

impl Rule for NoIrregularWhitespace {
    const META: Meta = Meta::eslint("no-irregular-whitespace", Kind::Problem).recommended();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        NoIrregularWhitespace {
            skip_comments: options.bool_or("skipComments", false),
            skip_jsx_text: options.bool("skipJSXText"),
            skip_reg_exps: options.bool("skipRegExps"),
            skip_strings: options.bool_or("skipStrings", true),
            skip_templates: options.bool("skipTemplates"),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.finish(Self::check);
    }
}
