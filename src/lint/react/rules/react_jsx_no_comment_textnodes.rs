use crate::react::is_jsx;
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallow comments from being inserted as text nodes.
pub struct JsxNoCommentTextnodes;

const PUT_COMMENT_IN_BRACES: Message =
    Message::new("putCommentInBraces", "Comments inside children section of tag should be placed inside braces");
const JSX_NO_COMMENT_TEXTNODES: Message =
    Message::new("", "Comments inside children section of tag should be placed inside braces");

impl Rule for JsxNoCommentTextnodes {
    const META: Meta = Meta::plugin(Plugin::React, "jsx-no-comment-textnodes", Kind::Problem).recommended();
    const ON: On = On::new().exprs(&[ExprTag::Jsx]);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        JsxNoCommentTextnodes
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        (!file.language().is_oxlint || is_jsx(file)).then_some(())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Jsx(jsx) = e.kind() else {
            return;
        };
        let is_oxlint = cx.language().is_oxlint;
        // A string that is spread is a `Literal` whose parent is of JSX as well. oxlint looks at text only.
        let spread = |it: Expr<'a>| match it.kind() {
            ExprKind::Spread(argument) if !is_oxlint => argument,
            _ => it,
        };
        let is_string = |it: &Expr| it.tag() == ExprTag::String;
        let attributes = jsx.attrs().iter().filter(|it| !is_oxlint && it.kind() == PropKind::Spread);
        let texts = jsx.children().iter().map(spread).filter(|it| is_string(it) && it.jsx_container_span().is_none());
        let texts = texts.chain(attributes.filter_map(Prop::value).filter(is_string));
        for jsx_text in texts.filter(|it| has_comment_pattern(it.text(), is_oxlint)) {
            cx.report(jsx_text, if is_oxlint { JSX_NO_COMMENT_TEXTNODES } else { PUT_COMMENT_IN_BRACES });
        }
    }
}

/// A line of the text starts with `//` or `/*`: `/^\s*\/(\/|\*)/m`
fn has_comment_pattern(text: &[u8], is_oxlint: bool) -> bool {
    let starts_comment = |line: &[u8]| line.starts_with(b"//") || line.starts_with(b"/*");
    if !strings::contains_char(text, b'/') {
        return false;
    }
    // For oxlint only `\n` ends a line, U+0085 is a blank and U+FEFF is none.
    match is_oxlint {
        true => strings::split(text, b"\n").map(strings::trim_unicode_whitespace).any(starts_comment),
        false => strings::js_lines(text).map(strings::trim_js_whitespace_start).any(starts_comment),
    }
}
