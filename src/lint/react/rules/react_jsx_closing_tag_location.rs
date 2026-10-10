use crate::util_ast::is_node_first_in_line;
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforce closing tag location for multiline JSX.
pub struct JsxClosingTagLocation {
    is_line_aligned: bool,
}

const ON_OWN_LINE: Message =
    Message::new("onOwnLine", "Closing tag of a multiline JSX expression must be on its own line.");
const MATCH_INDENT: Message = Message::new("matchIndent", "Expected closing tag to match indentation of opening.");
const ALIGN_WITH_OPENING: Message =
    Message::new("alignWithOpening", "Expected closing tag to be aligned with the line containing the opening tag");

impl Rule for JsxClosingTagLocation {
    const META: Meta =
        Meta::plugin(Plugin::React, "jsx-closing-tag-location", Kind::None).fixable(Fixable::Whitespace);
    const ON: On = On::new().exprs(&[ExprTag::Jsx]);
    no_state!();

    fn new(options: &Options) -> Self {
        let location = options.str(0).or_else(|| options.object(0).str("location"));
        JsxClosingTagLocation { is_line_aligned: location == Some("line-aligned") }
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Jsx(jsx) = e.kind() else { return };
        let Some(closing) = jsx.closing_span() else { return };
        let file = cx.file();
        let opening = jsx.opening_span().start;
        if file.is_on_same_line(opening, closing.start) {
            return;
        }
        let opening = file.position(opening);
        let indentation = if self.is_line_aligned {
            let line = file.line_text(opening.line);
            let blank = line.len() - strings::trim_js_whitespace_start(line).len();
            strings::wtf8_len_utf16(line.get(..blank).unwrap_or_default())
        } else {
            opening.column
        };
        let start = file.position(closing.start);
        if indentation == start.column {
            return;
        }
        let is_first_in_line = is_node_first_in_line(file, closing);
        let message = match (is_first_in_line, self.is_line_aligned) {
            (false, _) => ON_OWN_LINE,
            (true, false) => MATCH_INDENT,
            (true, true) => ALIGN_WITH_OPENING,
        };
        cx.report(closing, message).fix(|fixer| {
            let indent = std::iter::repeat_n(b' ', indentation as usize);
            if is_first_in_line {
                let before = Span::new(file.line_span(start.line).start, closing.start);
                return fixer.replace(before, indent.collect::<Vec<u8>>());
            }
            fixer.insert_before(closing, std::iter::once(b'\n').chain(indent).collect::<Vec<u8>>())
        });
    }
}
