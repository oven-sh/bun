use bun_lint_oxlint::codegen::print_string;
use crate::jsx::{AttributeValue, get_prop_value};
use crate::react::is_jsx;
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

#[derive(Copy, Clone, PartialEq, Eq)]
enum Mode {
    Always,
    Never,
    Ignore,
}

/// Disallow unnecessary JSX expressions when literals alone are sufficient.
pub struct JsxCurlyBracePresence {
    props: Mode,
    children: Mode,
    prop_element_values: Mode,
}

const UNNECESSARY: Message = Message::new("", "Curly braces are unnecessary here.");
const NECESSARY: Message = Message::new("", "Curly braces are required here.");

impl Rule for JsxCurlyBracePresence {
    const META: Meta = Meta::oxlint(Plugin::React, "jsx-curly-brace-presence", Kind::Suggestion).fixable(Fixable::Code);
    const ON: On = On::new().exprs(&[ExprTag::Jsx]);
    type State<'a> = ();

    /// `"never"`, or `{ props, children, propElementValues }`
    fn new(options: &Options) -> Self {
        let mode = |value: Option<&str>, default: Mode| match value {
            Some("always") => Mode::Always,
            Some("never") => Mode::Never,
            Some("ignore") => Mode::Ignore,
            _ => default,
        };
        if let Some(all) = options.str(0) {
            let all = mode(Some(all), Mode::Ignore);
            return JsxCurlyBracePresence { props: all, children: all, prop_element_values: all };
        }
        let options = options.object(0);
        JsxCurlyBracePresence {
            props: mode(options.str("props"), Mode::Never),
            children: mode(options.str("children"), Mode::Never),
            prop_element_values: mode(options.str("propElementValues"), Mode::Ignore),
        }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        is_jsx(file).then_some(())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        self.check(e, cx);
    }
}

impl JsxCurlyBracePresence {
    fn check<'a>(&self, e: Expr<'a>, cx: &Cx<'a, Self>) {
        let ExprKind::Jsx(jsx) = e.kind() else {
            return;
        };
        for value in jsx.attrs().iter().filter_map(get_prop_value) {
            match value {
                AttributeValue::ExpressionContainer(inner) => {
                    let has_adjacent = false;
                    self.check_expression_container(inner, true, has_adjacent, cx);
                }
                AttributeValue::Element(element) | AttributeValue::Fragment(element) => {
                    if self.prop_element_values == Mode::Always {
                        cx.report(element, NECESSARY)
                            .fix(|fixer| [fixer.insert_before(element, "{"), fixer.insert_after(element, "}")]);
                    }
                }
                AttributeValue::StringLiteral(string) => {
                    if self.props == Mode::Always {
                        cx.report(string.span, NECESSARY)
                            .fix(|fixer| fixer.replace(string.span, in_braces(string.value)));
                    }
                }
            }
        }
        if self.children == Mode::Ignore
            || self.children == Mode::Never && jsx.tag().is_some_and(|it| it.is_ident("script"))
        {
            return;
        }
        // oxlint looks for what is next to `{a}` among the children of the parent of the element, where it is not. It
        // looks among those of the element itself only if that is a statement.
        let sees_adjacent =
            !e.is_parenthesized() && matches!(e.parent(), Node::Stmt(statement) if statement.tag() == StmtTag::Expr);
        let is_container = |child: &JsxChild| {
            matches!(child, JsxChild::Expr(e) if e.jsx_container_span().is_some() && e.tag() != ExprTag::Spread)
        };
        let mut children = jsx.children_with_whitespace().peekable();
        let mut follows_container = false;
        while let Some(child) = children.next() {
            let has_adjacent = sees_adjacent && (follows_container || children.peek().is_some_and(is_container));
            follows_container = is_container(&child);
            match child {
                JsxChild::Expr(inner) if follows_container => {
                    self.check_expression_container(inner, false, has_adjacent, cx)
                }
                JsxChild::Expr(text) if text.tag() == ExprTag::String && self.children == Mode::Always => {
                    report_missing_curly_for_text_node(text, cx);
                }
                _ => {}
            }
        }
    }

    /// `inner`: the `a` of `{a}`. `has_adjacent`: `has_adjacent_jsx_expression_containers`.
    fn check_expression_container<'a>(
        &self,
        inner: Expr<'a>,
        parent_is_attribute: bool,
        has_adjacent: bool,
        cx: &Cx<'a, Self>,
    ) {
        let Some(container) = inner.jsx_container_span().filter(|_| !inner.is_parenthesized()) else {
            return;
        };
        let allowed = if parent_is_attribute { self.props } else { self.children };
        // What the braces are replaced by, with what is in them.
        let replacement: Option<&'a [u8]> = match inner.kind() {
            ExprKind::Jsx(jsx) if parent_is_attribute => {
                if self.prop_element_values != Mode::Never || jsx.is_fragment() || !jsx.is_self_closing() {
                    return;
                }
                None
            }
            ExprKind::Jsx(_) => {
                if self.children != Mode::Never || has_adjacent {
                    return;
                }
                None
            }
            ExprKind::String(value) if allowed == Mode::Never => {
                if has_adjacent
                    || is_allowed_string_like_in_container(cx.slice(inner.span().shrink(1, 1)), parent_is_attribute)
                {
                    return;
                }
                Some(value.bytes())
            }
            ExprKind::Template(template) if allowed == Mode::Never => {
                let Some(string) = template.as_static().map(Name::bytes) else {
                    return;
                };
                if !parent_is_attribute && strings::index_of_any(string, b"\"'").is_some()
                    || has_adjacent
                    || is_allowed_string_like_in_container(string, parent_is_attribute)
                {
                    return;
                }
                Some(string)
            }
            _ => return,
        };
        if cx.file().comments_in(container).len() > 0 {
            return;
        }
        let report = cx.report(inner, UNNECESSARY);
        let report = match replacement.is_none() && !parent_is_attribute {
            true => report.help("remove the curly braces"),
            false => report,
        };
        report.fix(|fixer| match replacement {
            None if parent_is_attribute => vec![fixer.replace(container, inner.text())],
            None => vec![
                fixer.remove(Span::new(container.start, container.start + 1)),
                fixer.remove(Span::new(container.end - 1, container.end)),
            ],
            Some(string) if parent_is_attribute => {
                let quote = if strings::contains_char(string, b'"') { b'\'' } else { b'"' };
                let mut text = Vec::with_capacity(string.len() + 2);
                print_string(&mut text, string, quote);
                vec![fixer.replace(container, text)]
            }
            Some(string) => vec![fixer.replace(container, string)],
        });
    }
}

/// `{"text"}`
fn in_braces(text: &[u8]) -> Vec<u8> {
    let mut out = vec![b'{'];
    print_string(&mut out, text, b'"');
    out.push(b'}');
    out
}

/// But for `has_adjacent_jsx_expression_containers`.
fn is_allowed_string_like_in_container(s: &[u8], is_prop: bool) -> bool {
    let trimmed = strings::trim_unicode_whitespace(s);
    !s.is_empty() && trimmed.is_empty()
        || strings::index_of_any(s, b"\n\r").is_some()
        || next_html_entity(s).is_some()
        || is_prop && strings::contains_char(s, b'"') && strings::contains_char(s, b'\'')
        || !is_prop && (strings::index_of_any(s, b"<>{}\\").is_some() || trimmed.len() != s.len())
        || [&b"/*"[..], b"*/", b"\\n", b"\\r", b"\\u"].into_iter().any(|it| strings::contains(s, it))
}

/// Where the first `&name;` or `&#1;` is: `/&[A-Za-z\d#]+;/`
fn next_html_entity(text: &[u8]) -> Option<(usize, usize)> {
    let mut from = 0;
    while let Some(found) = text.get(from..).and_then(|rest| strings::index_of_char_usize(rest, b'&')) {
        let start = from + found;
        let name = text.get(start + 1..).unwrap_or_default();
        let len = name.iter().take_while(|it| it.is_ascii_alphanumeric() || **it == b'#').count();
        if len > 0 && name.get(len) == Some(&b';') {
            return Some((start, start + len + 2));
        }
        from = start + 1;
    }
    None
}

/// Calls `visit` with what is between the entities of `line`, and where it starts.
fn for_each_part<'t>(line: &'t [u8], mut visit: impl FnMut(usize, &'t [u8])) {
    let mut from = 0;
    while let Some((start, end)) = line.get(from..).and_then(next_html_entity) {
        visit(from, line.get(from..from + start).unwrap_or_default());
        from += end;
    }
    visit(from, line.get(from..).unwrap_or_default());
}

fn report_missing_curly_for_text_node<'a>(text: Expr<'a>, cx: &Cx<'a, JsxCurlyBracePresence>) {
    let (span, value) = (text.span(), text.text());
    // Nothing but entities and blanks.
    let mut has_text = false;
    for_each_part(value, |_, part| has_text |= !strings::trim_unicode_whitespace(part).is_empty());
    if !has_text {
        return;
    }
    cx.report(span, NECESSARY).fix(|fixer| {
        let mut fixes = Vec::new();
        // From the first character that is not a blank.
        let mut wrap = |start: usize, part: &[u8]| {
            let part_text = strings::trim_unicode_whitespace_start(part);
            if !part_text.is_empty() {
                let start = span.start + (start + part.len() - part_text.len()) as u32;
                fixes.push(fixer.replace(Span::new(start, start + part_text.len() as u32), in_braces(part_text)));
            }
        };
        if !strings::contains_char(value, b'\n') {
            wrap(0, value);
            return fixes;
        }
        let mut line_start = 0;
        for line in strings::split(value, b"\n") {
            for_each_part(line, |start, part| wrap(line_start + start, part));
            line_start += line.len() + 1;
        }
        fixes
    });
}
