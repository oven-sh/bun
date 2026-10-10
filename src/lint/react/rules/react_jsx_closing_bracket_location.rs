use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforce closing bracket location in JSX.
pub struct JsxClosingBracketLocation {
    /// `None` is `false`: anywhere.
    non_empty: Option<Location>,
    self_closing: Option<Location>,
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Location {
    AfterProps,
    PropsAligned,
    TagAligned,
    LineAligned,
}

const BRACKET_LOCATION: Message =
    Message::new("bracketLocation", "The closing bracket must be {{location}}{{details}}");

impl Location {
    fn of(option: &Json) -> Option<Location> {
        match option.as_str()? {
            b"after-props" => Some(Location::AfterProps),
            b"props-aligned" => Some(Location::PropsAligned),
            b"tag-aligned" => Some(Location::TagAligned),
            b"line-aligned" => Some(Location::LineAligned),
            _ => None,
        }
    }

    /// `MESSAGE_LOCATION`
    fn message(self) -> &'static str {
        match self {
            Location::AfterProps => "placed after the last prop",
            Location::PropsAligned => "aligned with the last prop",
            Location::TagAligned => "aligned with the opening tag",
            Location::LineAligned => "aligned with the line containing the opening tag",
        }
    }
}

impl Rule for JsxClosingBracketLocation {
    const META: Meta = Meta::plugin(Plugin::React, "jsx-closing-bracket-location", Kind::Layout)
        .fixable(Fixable::Code)
        .reports_on_exit();
    const ON: On = On::new().exprs(&[ExprTag::Jsx]);
    no_state!();

    fn new(options: &Options) -> Self {
        let (config, mut both) = (options.object(0), Some(Location::TagAligned));
        // `"tag-aligned"` is short for `{ location: "tag-aligned" }`.
        if let Some(location) = options.get(0).filter(|it| it.as_str().is_some()).or_else(|| config.get("location")) {
            both = Location::of(location);
        }
        JsxClosingBracketLocation {
            non_empty: config.get("nonEmpty").map_or(both, Location::of),
            self_closing: config.get("selfClosing").map_or(both, Location::of),
        }
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Jsx(jsx) = e.kind() else {
            return;
        };
        let Some(name) = jsx.tag().map(|it| it.span()) else {
            return;
        };
        let (file, node, is_self_closing) = (cx.file(), jsx.opening_span(), jsx.is_self_closing());
        let closing = closing_bracket(file, node, is_self_closing);
        let Some(last_prop) = jsx.attrs().last().map(|it| it.span()) else {
            if !ast_utils::is_on_one_line(file, Span::new(name.start, closing)) {
                let closing_tag = if is_self_closing { " />" } else { " >" };
                cx.report_at(closing, BRACKET_LOCATION)
                    .data("location", "placed after the opening tag")
                    .data("details", "")
                    .fix(|fixer| fixer.replace(Span::after(name, node.end), closing_tag));
            }
            return;
        };
        // `getExpectedLocation`
        let expected = match ast_utils::is_on_one_line(file, node.to(last_prop)) {
            true => Some(Location::AfterProps),
            false if is_self_closing => self.self_closing,
            false => self.non_empty,
        };
        let Some(expected) = expected else {
            return;
        };
        let is_on_line_of_last_prop = || ast_utils::is_on_one_line(file, Span::after(last_prop, closing));
        let starts_with_tab = |at: u32| file.line_text(file.line_of(at)).first() == Some(&b'\t');
        // `getCorrectColumn`
        let correct_column = match expected {
            Location::AfterProps => None,
            Location::PropsAligned => Some(file.position(last_prop.start).column),
            Location::TagAligned => Some(file.position(node.start).column),
            Location::LineAligned => Some(strings::wtf8_len_utf16(indentation(file, node.start))),
        };
        // `hasCorrectLocation`, and `usingSameIndentation`
        let is_correct = match correct_column {
            None => is_on_line_of_last_prop(),
            Some(column) => {
                column == file.position(closing).column
                    && (expected != Location::TagAligned || starts_with_tab(node.start) == starts_with_tab(closing))
            }
        };
        if is_correct {
            return;
        }
        let details = correct_column.map_or_else(String::new, |column| {
            let line = if is_on_line_of_last_prop() { " on the next line" } else { "" };
            format!(" (expected column {}{line})", column + 1)
        });
        cx.report_at(closing, BRACKET_LOCATION).data("location", expected.message()).data("details", details).fix(
            |fixer| {
                let mut replacement = Vec::new();
                if let Some(column) = correct_column {
                    let aligned_with = if expected == Location::PropsAligned { last_prop } else { node };
                    replacement.push(b'\n');
                    push_indentation(&mut replacement, indentation(file, aligned_with.start), column);
                }
                replacement.extend_from_slice(if is_self_closing { "/>" } else { ">" }.as_bytes());
                fixer.replace(Span::after(last_prop, node.end), replacement)
            },
        );
    }
}

/// Where the `>` of the opening element `node` is, or the `/` before it.
fn closing_bracket<'a>(file: &'a File<'a>, node: Span, is_self_closing: bool) -> u32 {
    let bracket = node.end.saturating_sub(1);
    if !is_self_closing {
        return bracket;
    }
    match file.text().get(..bracket as usize) {
        // Not the end of a comment between the two.
        Some([.., before, b'/']) if *before != b'*' => bracket - 1,
        _ => file.tokens_in(node).nth_back(1).map_or(bracket, Token::start),
    }
}

/// `/^\s*/.exec(line)[0]` for the line that `at` is in.
fn indentation<'a>(file: &'a File<'a>, at: u32) -> &'a [u8] {
    let whole = file.line_text(file.line_of(at));
    whole.get(..whole.len() - strings::trim_js_whitespace_start(whole).len()).unwrap_or_default()
}

/// `getIndentation`: spaces stand for what is before the column and is no whitespace.
fn push_indentation(out: &mut Vec<u8>, indentation: &[u8], correct_column: u32) {
    let len = strings::wtf8_len_utf16(indentation);
    out.extend_from_slice(indentation);
    if len + 1 < correct_column {
        out.extend(std::iter::repeat_n(b' ', (correct_column - len) as usize));
    }
}
