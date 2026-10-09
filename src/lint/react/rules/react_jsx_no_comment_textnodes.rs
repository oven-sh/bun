use crate::react::is_jsx;
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// This rule prevents comment strings (e.g. beginning with `//` or `/*`) from being accidentally injected as a text
/// node in JSX statements.
pub struct JsxNoCommentTextnodes;

const JSX_NO_COMMENT_TEXTNODES: Message =
    Message::new("", "Comments inside children section of tag should be placed inside braces");

impl Rule for JsxNoCommentTextnodes {
    const META: Meta = Meta::oxlint(Plugin::React, "jsx-no-comment-textnodes", Kind::Problem);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        JsxNoCommentTextnodes
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !is_jsx(file) {
            return;
        }
        on.exprs([ExprTag::Jsx], |_, e, cx| {
            let ExprKind::Jsx(jsx) = e.kind() else {
                return;
            };
            let texts =
                jsx.children().iter().filter(|it| it.tag() == ExprTag::String && it.jsx_container_span().is_none());
            for jsx_text in texts.filter(|it| has_comment_pattern(it.text())) {
                cx.report(jsx_text, JSX_NO_COMMENT_TEXTNODES);
            }
        });
    }
}

/// A line of the text starts with `//` or `/*`.
fn has_comment_pattern(text: &[u8]) -> bool {
    strings::contains_char(text, b'/')
        && strings::split(text, b"\n")
            .map(strings::trim_unicode_whitespace)
            .any(|line| line.starts_with(b"//") || line.starts_with(b"/*"))
}
