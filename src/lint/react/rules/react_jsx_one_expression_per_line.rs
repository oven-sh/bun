use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use std::borrow::Cow;

/// Require one JSX element per line
pub struct JsxOneExpressionPerLine {
    allow: Allow,
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Allow {
    None,
    Literal,
    SingleChild,
    NonJsx,
}

const MOVE_TO_NEW_LINE: Message = Message::new("moveToNewLine", "`{{descriptor}}` must be placed on a new line");

/// A child that is not white space.
#[derive(Copy, Clone)]
struct Child<'a> {
    /// `None`: it is text.
    node: Option<Expr<'a>>,
    span: Span,
    /// What is before it in its line: the opening tag or a child.
    prev_child: Option<Span>,
}

impl Rule for JsxOneExpressionPerLine {
    const META: Meta =
        Meta::plugin(Plugin::React, "jsx-one-expression-per-line", Kind::Layout).fixable(Fixable::Whitespace);
    const ON: On = On::new().exprs(&[ExprTag::Jsx]);
    no_state!();

    fn new(options: &Options) -> Self {
        JsxOneExpressionPerLine {
            allow: match options.object(0).str("allow") {
                Some("literal") => Allow::Literal,
                Some("single-child") => Allow::SingleChild,
                Some("non-jsx") => Allow::NonJsx,
                _ => Allow::None,
            },
        }
    }

    /// Upstream groups the children by the lines in which they begin and end. These never decrease from a child to the
    /// next, so two are in one line where nothing between them counts as a line break.
    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Jsx(jsx) = e.kind() else {
            return;
        };
        let (opening_element, Some(closing_element)) = (jsx.opening_span(), jsx.closing_span()) else {
            return;
        };
        let (file, children) = (cx.file(), jsx.children());
        let is_allowed = match self.allow {
            Allow::None => false,
            Allow::NonJsx => !children.iter().any(|it| it.tag() == ExprTag::Jsx && it.jsx_container_span().is_none()),
            Allow::Literal | Allow::SingleChild => {
                children.len() == 1
                    && (self.allow == Allow::SingleChild || children.first().is_some_and(Expr::is_jsx_text))
                    && ast_utils::is_on_one_line(file, e.span())
            }
        };
        if is_allowed {
            return;
        }
        let (mut prev_child, mut last_child) = (Some(opening_element), None::<Child<'a>>);
        for child in jsx.children_with_whitespace() {
            // What is white space for the parser is not all `\s`.
            let (node, span) = match child {
                JsxChild::Expr(it) if it.is_jsx_text() => (None, it.span()),
                JsxChild::Expr(it) => (Some(it), it.jsx_container_span().unwrap_or_else(|| it.span())),
                JsxChild::Whitespace(span) => (None, span),
            };
            let raw = if node.is_none() { file.slice(span) } else { &b""[..] };
            if node.is_none() && strings::is_all_js_whitespace(raw) {
                if strings::contains_js_line_break(raw) {
                    prev_child = None;
                }
                continue;
            }
            // The one before it is not the last in its line.
            if let Some(it) = last_child {
                it.report(None, cx);
            }
            // `/^\s*\n/`
            let blanks = raw.len() - strings::trim_js_whitespace_start(raw).len();
            if strings::contains_char(raw.get(..blanks).unwrap_or_default(), b'\n') {
                prev_child = None;
            }
            last_child = Some(Child { node, span, prev_child });
            // `/\n\s*$/`
            let blanks = raw.get(strings::trim_js_whitespace_end(raw).len()..).unwrap_or_default();
            prev_child = (!strings::contains_char(blanks, b'\n')).then_some(span);
        }
        if let Some(it) = last_child {
            it.report(prev_child.is_some().then_some(closing_element), cx);
        }
    }
}

impl<'a> Child<'a> {
    /// `next_child`: the closing tag, if that is after it in its line.
    fn report(self, next_child: Option<Span>, cx: &Cx<'a, JsxOneExpressionPerLine>) {
        let Child { node, span, prev_child } = self;
        if prev_child.is_none() && next_child.is_none() {
            return;
        }
        let file = cx.file();
        cx.report(span, MOVE_TO_NEW_LINE).data("descriptor", node_descriptor(node, file.slice(span))).fix(|fixer| {
            let mut replace_text = Vec::new();
            if let Some(prev_child) = prev_child {
                if is_space_between(file, prev_child, span) {
                    replace_text.extend_from_slice(b"\n{' '}");
                }
                replace_text.push(b'\n');
            }
            replace_text.extend_from_slice(strings::trim(file.slice(span), b" "));
            if let Some(next_child) = next_child {
                replace_text.push(b'\n');
                if is_space_between(file, span, next_child) {
                    replace_text.extend_from_slice(b"{' '}\n");
                }
            }
            fixer.replace(span, replace_text)
        });
    }
}

/// upstream's `nodeDescriptor`
fn node_descriptor<'a>(n: Option<Expr<'a>>, source: &'a [u8]) -> Cow<'a, [u8]> {
    if let Some(n) = n
        && n.jsx_container_span().is_none()
        && let ExprKind::Jsx(jsx) = n.kind()
        && let Some(name) = jsx.tag()
    {
        let name: &[u8] = match name.kind() {
            ExprKind::Ident(name) => name.bytes(),
            ExprKind::This => b"this",
            // The `name` of `a:b` is a node.
            ExprKind::String(name) if strings::contains_char(name.bytes(), b':') => b"[object Object]",
            ExprKind::String(name) => name.bytes(),
            // `a.b` has none.
            _ => b"undefined",
        };
        return Cow::Borrowed(name);
    }
    if !strings::contains_char(source, b'\n') {
        return Cow::Borrowed(source);
    }
    let mut descriptor = source.to_vec();
    descriptor.retain(|it| *it != b'\n');
    Cow::Owned(descriptor)
}

/// upstream's `spaceBetweenPrev` and `spaceBetweenNext`. Only text begins or ends with a blank, and what is between two
/// that do not touch is text that is white space: `isSpaceBetweenTokens`.
fn is_space_between(file: &File<'_>, first: Span, second: Span) -> bool {
    file.slice(first).ends_with(b" ") || file.slice(second).starts_with(b" ") || first.end != second.start
}
