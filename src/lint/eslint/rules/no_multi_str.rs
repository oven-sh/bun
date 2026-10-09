use bun_core::strings;
use bun_lint::prelude::*;

/// Disallow multiline strings.
pub struct NoMultiStr;

const MULTILINE_STRING: Message = Message::new(
    "multilineString",
    "Multiline support is limited to browsers supporting ES5 only.",
);

/// Whether ESLint's parent of the string `e` is a node of JSX: an attribute, an expression
/// container, a spread.
fn is_in_jsx(e: Expr) -> bool {
    match e.parent() {
        Node::Prop(prop) => matches!(prop.parent(), Node::Expr(owner) if owner.tag() == ExprTag::Jsx),
        Node::Expr(parent) => match parent.tag() {
            ExprTag::Jsx => true,
            ExprTag::Spread => parent.jsx_container_span().is_some(),
            _ => false,
        },
        _ => false,
    }
}

/// Where a string with a line break is reported. oxlint points at what is before the first line break.
fn place(string: Span, file: &File) -> Span {
    let text = file.slice(string);
    let is_linebreak = |at: &usize| matches!(text.get(*at..), Some([b'\n' | b'\r', ..] | [0xE2, 0x80, 0xA8 | 0xA9, ..]));
    match (1..text.len()).find(is_linebreak).filter(|_| file.language().is_oxlint) {
        Some(at) => Span::new(string.start + at as u32 - 1, string.start + at as u32),
        None => string,
    }
}

impl Rule for NoMultiStr {
    const META: Meta = Meta::eslint("no-multi-str", Kind::Suggestion);
    /// Where the strings with a line break start that are expressions.
    type State<'a> = Vec<u32>;

    fn new(_: &Options) -> Self {
        NoMultiStr
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> Vec<u32> {
        // A line break in a string follows a `\`, or is U+2028 or U+2029.
        let text = file.text();
        let (mut at, mut has_break) = (0, false);
        while !has_break && let Some(found) = text.get(at..).and_then(|rest| strings::index_of_char_usize(rest, b'\\')) {
            at += found + 1;
            has_break = matches!(text.get(at), Some(b'\n' | b'\r'));
        }
        let not_ascii = strings::first_non_ascii(text).and_then(|first| text.get(first as usize..)).unwrap_or_default();
        if !has_break && !strings::contains(not_ascii, b"\xE2\x80\xA8") && !strings::contains(not_ascii, b"\xE2\x80\xA9") {
            return Vec::new();
        }
        on.exprs([ExprTag::String], |_, e, cx| {
            if !strings::contains_js_line_break(e.text()) {
                return;
            }
            cx.state.push(e.span().start);
            if !is_in_jsx(e) {
                cx.report(place(e.span(), cx.file()), MULTILINE_STRING);
            }
        });
        // The strings that are not expressions: keys, module specifiers, literal types.
        on.finish(|_, cx| {
            cx.state.sort_unstable();
            for token in cx.file().tokens() {
                if token.kind() == TokenKind::String
                    && strings::contains_js_line_break(token.text())
                    && cx.state.binary_search(&token.start()).is_err()
                {
                    cx.report(place(Span::new(token.start(), token.end()), cx.file()), MULTILINE_STRING);
                }
            }
        });
        Vec::new()
    }
}
