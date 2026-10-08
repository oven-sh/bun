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

impl Rule for NoMultiStr {
    const META: Meta = Meta::eslint("no-multi-str", Kind::Suggestion);
    /// Where the strings with a line break start that are expressions.
    type State<'a> = Vec<u32>;

    fn new(_: &Options) -> Self {
        NoMultiStr
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> Vec<u32> {
        // A line break in a string follows a `\`, or is U+2028 or U+2029.
        let breaks: [&[u8]; 4] = [b"\\\n", b"\\\r", b"\xE2\x80\xA8", b"\xE2\x80\xA9"];
        if !breaks.iter().any(|it| strings::contains(file.text(), it)) {
            return Vec::new();
        }
        on.exprs([ExprTag::String], |_, e, cx| {
            if !ast_utils::has_linebreak(e.text()) {
                return;
            }
            cx.state.push(e.span().start);
            if !is_in_jsx(e) {
                cx.report(e, MULTILINE_STRING);
            }
        });
        // The strings that are not expressions: keys, module specifiers, literal types.
        on.finish(|_, cx| {
            for token in cx.file().tokens() {
                if token.kind() == TokenKind::String
                    && ast_utils::has_linebreak(token.text())
                    && !cx.state.contains(&token.start())
                {
                    cx.report(token, MULTILINE_STRING);
                }
            }
        });
        Vec::new()
    }
}
