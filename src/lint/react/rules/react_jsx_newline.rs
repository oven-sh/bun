use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Require or prevent a new line after jsx elements and expressions.
pub struct JsxNewline {
    prevent: bool,
    allow_multilines: bool,
}

const REQUIRE: Message = Message::new("require", "JSX element should start in a new line");
const PREVENT: Message = Message::new("prevent", "JSX element should not start in a new line");
const ALLOW_MULTILINES: Message = Message::new("allowMultilines", "Multiline JSX elements should start in a new line");

impl Rule for JsxNewline {
    const META: Meta =
        Meta::plugin(Plugin::React, "jsx-newline", Kind::None).fixable(Fixable::Code).reports_at_the_end();
    const ON: On = On::new().exprs(&[ExprTag::Jsx]);
    no_state!();

    fn new(options: &Options) -> Self {
        let configuration = options.object(0);
        JsxNewline {
            prevent: configuration.bool_or("prevent", false),
            allow_multilines: configuration.bool_or("allowMultilines", false),
        }
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Jsx(parent) = e.kind() else {
            return;
        };
        // An element, and another after the text that follows it.
        if parent.children().len() < 2 {
            return;
        }
        let file = cx.file();
        let is_multilined = |node: Span| !ast_utils::is_on_one_line(file, node);
        let mut elements = parent.children_with_whitespace();
        while let Some(element) = elements.next() {
            let Some(element) = non_block_comment(element) else {
                continue;
            };
            let mut siblings = elements;
            let (Some(first_adjacent_sibling), Some(JsxChild::Expr(second_adjacent_sibling))) =
                (siblings.next(), siblings.next())
            else {
                continue;
            };
            let (between, is_without_new_line) = match first_adjacent_sibling {
                JsxChild::Whitespace(it) => (it, is_without_new_line(file.slice(it))),
                JsxChild::Expr(it) => match it.jsx_text_value() {
                    Some(value) => (it.span(), is_without_new_line(&value)),
                    None => continue,
                },
            };
            let is_next_multilined = || {
                let mut rest = [JsxChild::Expr(second_adjacent_sibling)].into_iter().chain(siblings);
                rest.find_map(non_block_comment).is_some_and(is_multilined)
            };
            let (message, is_doubled) = if self.allow_multilines && (is_multilined(element) || is_next_multilined()) {
                if !is_without_new_line {
                    continue;
                }
                (ALLOW_MULTILINES, true)
            } else if is_without_new_line == self.prevent {
                continue;
            } else {
                (if self.prevent { PREVENT } else { REQUIRE }, !self.prevent)
            };
            let at = second_adjacent_sibling.jsx_container_span().unwrap_or_else(|| second_adjacent_sibling.span());
            cx.report(at, message).fix(|fixer| {
                let (newlines, replacement): (&[u8], &[u8]) =
                    if is_doubled { (b"\n", b"\n\n") } else { (b"\n\n", b"\n") };
                fixer.replace(between, with_the_last_replaced(file.slice(between), newlines, replacement))
            });
        }
    }
}

/// upstream's `isNonBlockComment`: the range of a `JSXElement` or a `JSXExpressionContainer` that does not begin with
/// `{/*`.
fn non_block_comment(element: JsxChild<'_>) -> Option<Span> {
    let JsxChild::Expr(element) = element else {
        return None;
    };
    match (element.jsx_container_span(), element.kind()) {
        (Some(_), ExprKind::Spread(_)) => None,
        (Some(container), _) => (!element.file().slice(container).starts_with(b"{/*")).then_some(container),
        (None, ExprKind::Jsx(jsx)) => (!jsx.is_fragment()).then(|| element.span()),
        (None, _) => None,
    }
}

/// `!/\n\s*\n/.test(value)`
fn is_without_new_line(value: &[u8]) -> bool {
    let Some((_, mut rest)) = strings::split_once_char(value, b'\n') else {
        return true;
    };
    while let Some((line, after)) = strings::split_once_char(rest, b'\n') {
        if strings::is_all_js_whitespace(line) {
            return false;
        }
        rest = after;
    }
    true
}

/// `raw.replace(/(newlines)(?!.*\1)/g, replacement)`, where `newlines` is one line feed or two.
#[cold]
#[inline(never)]
fn with_the_last_replaced(raw: &[u8], newlines: &[u8], replacement: &[u8]) -> Vec<u8> {
    let mut replaced = Vec::with_capacity(raw.len() + 1);
    let mut rest = raw;
    while let Some(at) = strings::index_of(rest, newlines) {
        let (before, found) = rest.split_at(at);
        let after = found.get(newlines.len()..).unwrap_or_default();
        replaced.extend_from_slice(before);
        // `.*` takes what is before the next line break.
        let next = strings::find_js_line_break(after).and_then(|it| after.get(it.0..));
        if next.is_some_and(|it| it.starts_with(newlines)) {
            replaced.push(b'\n');
            rest = found.get(1..).unwrap_or_default();
        } else {
            replaced.extend_from_slice(replacement);
            rest = after;
        }
    }
    replaced.extend_from_slice(rest);
    replaced
}
