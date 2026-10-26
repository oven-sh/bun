use bun_lint_oxlint::codegen::print_string;
use crate::jsx::{AttributeValue, get_prop_value};
use crate::react::is_jsx;
use bun_core::printer::json_stringify;
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

#[derive(Copy, Clone, PartialEq, Eq)]
enum Mode {
    Always,
    Never,
    Ignore,
}

/// Disallow unnecessary JSX expressions when literals alone are sufficient or enforce JSX expressions on literals in
/// JSX children or attributes.
pub struct JsxCurlyBracePresence {
    props: Mode,
    children: Mode,
    prop_element_values: Mode,
    /// True if the option is a single string that sets both `props` and `children`.
    is_single_string: bool,
}

const UNNECESSARY_CURLY: Message = Message::new("unnecessaryCurly", "Curly braces are unnecessary here.");
const MISSING_CURLY: Message = Message::new("missingCurly", "Need to wrap this literal in a JSX expression.");
const UNNECESSARY: Message = Message::new("", "Curly braces are unnecessary here.");
const NECESSARY: Message = Message::new("", "Curly braces are required here.");

/// The kind of string that's in braces, or could be.
#[derive(Copy, Clone, PartialEq, Eq)]
enum StringLike {
    Literal,
    Template,
}

impl Rule for JsxCurlyBracePresence {
    const META: Meta = Meta::plugin(Plugin::React, "jsx-curly-brace-presence", Kind::None).fixable(Fixable::Code);
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
            return JsxCurlyBracePresence { props: all, children: all, prop_element_values: all, is_single_string: true };
        }
        let options = options.object(0);
        JsxCurlyBracePresence {
            props: mode(options.str("props"), Mode::Never),
            children: mode(options.str("children"), Mode::Never),
            prop_element_values: mode(options.str("propElementValues"), Mode::Ignore),
            is_single_string: false,
        }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        (!file.language().is_oxlint || is_jsx(file)).then_some(())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        self.check(e, cx);
    }
}

impl JsxCurlyBracePresence {
    /// For oxlint the single string also applies to elements that are attribute values.
    fn prop_element_values(&self, is_oxlint: bool) -> Mode {
        if self.is_single_string && !is_oxlint { Mode::Ignore } else { self.prop_element_values }
    }

    fn check<'a>(&self, e: Expr<'a>, cx: &Cx<'a, Self>) {
        let ExprKind::Jsx(jsx) = e.kind() else {
            return;
        };
        let is_oxlint = cx.language().is_oxlint;
        let necessary = if is_oxlint { NECESSARY } else { MISSING_CURLY };
        for value in jsx.attrs().iter().filter_map(get_prop_value) {
            match value {
                AttributeValue::ExpressionContainer(inner) => {
                    let (parent_is_attribute, has_adjacent) = (true, false);
                    self.check_expression_container(inner, parent_is_attribute, has_adjacent, is_oxlint, cx);
                }
                // oxlint also requires braces around a fragment.
                AttributeValue::Fragment(_) if !is_oxlint => {}
                AttributeValue::Element(element) | AttributeValue::Fragment(element) => {
                    // With "never" oxlint doesn't report it.
                    let unreported_mode = if is_oxlint { Mode::Never } else { Mode::Ignore };
                    let configured_mode = self.prop_element_values(is_oxlint);
                    if configured_mode != Mode::Ignore && configured_mode != unreported_mode {
                        cx.report(element, necessary)
                            .by_selector()
                            .fix(|fixer| [fixer.insert_before(element, "{"), fixer.insert_after(element, "}")]);
                    }
                }
                AttributeValue::StringLiteral(string) => {
                    if self.props == Mode::Always {
                        cx.report(string.span, necessary).by_selector().fix(|fixer| {
                            // oxlint prints the text as a JavaScript string, even if it has line breaks.
                            let text = match is_oxlint {
                                true => in_braces(string.value, is_oxlint),
                                false if strings::contains_js_line_break(string.value) => return None,
                                false => escaped_in_braces(string.value),
                            };
                            Some(fixer.replace(string.span, text))
                        });
                    }
                }
            }
        }
        // oxlint keeps the braces inside a `<script>`.
        if self.children == Mode::Ignore
            || is_oxlint && self.children == Mode::Never && jsx.tag().is_some_and(|it| it.is_ident("script"))
        {
            return;
        }
        // oxlint searches for the containers next to `{a}` among the children of the element's parent, where `{a}`
        // never is. It only searches the element's own children if the element is an expression statement.
        let checks_adjacent = !is_oxlint
            || !e.is_parenthesized() && matches!(e.parent(), Node::Stmt(statement) if statement.tag() == StmtTag::Expr);
        let is_container = |child: &JsxChild| {
            matches!(child, JsxChild::Expr(e) if e.jsx_container_span().is_some() && e.tag() != ExprTag::Spread)
        };
        let mut children = jsx.children_with_whitespace().peekable();
        let mut follows_container = false;
        while let Some(child) = children.next() {
            let has_adjacent = checks_adjacent && (follows_container || children.peek().is_some_and(is_container));
            follows_container = is_container(&child);
            match child {
                JsxChild::Expr(inner) if follows_container => {
                    let parent_is_attribute = false;
                    self.check_expression_container(inner, parent_is_attribute, has_adjacent, is_oxlint, cx)
                }
                _ if self.children != Mode::Always => {}
                JsxChild::Expr(text) if text.tag() == ExprTag::String => {
                    report_missing_curly_for_text_node(text.span(), is_oxlint, cx);
                }
                // Some characters that the parser treats as whitespace aren't whitespace for the rule.
                JsxChild::Whitespace(text) => report_missing_curly_for_text_node(text, is_oxlint, cx),
                JsxChild::Expr(_) => {}
            }
        }
    }

    /// `inner`: the `a` in `{a}`. `has_adjacent`: `has_adjacent_jsx_expression_containers`.
    fn check_expression_container<'a>(
        &self,
        inner: Expr<'a>,
        parent_is_attribute: bool,
        has_adjacent: bool,
        is_oxlint: bool,
        cx: &Cx<'a, Self>,
    ) {
        // oxlint's AST has a node for parentheses.
        let Some(container) = inner.jsx_container_span().filter(|_| !is_oxlint || !inner.is_parenthesized()) else {
            return;
        };
        let allowed = if parent_is_attribute { self.props } else { self.children };
        // The text that replaces the braces and their content. `None` keeps the content.
        let replacement: Option<&'a [u8]> = match inner.kind() {
            ExprKind::Jsx(jsx) if parent_is_attribute => {
                // oxlint keeps the braces around an element that has a closing tag.
                if self.prop_element_values(is_oxlint) != Mode::Never
                    || jsx.is_fragment()
                    || is_oxlint && !jsx.is_self_closing()
                {
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
                let raw_text = cx.slice(inner.span().shrink(1, 1));
                if has_adjacent
                    || is_allowed_string_like_in_container(raw_text, StringLike::Literal, parent_is_attribute, cx.file())
                {
                    return;
                }
                Some(value.bytes())
            }
            ExprKind::Template(template) if allowed == Mode::Never => {
                let Some(string) = template.as_static().map(Name::bytes) else {
                    return;
                };
                // oxlint checks the cooked value.
                let checked_text = if is_oxlint { string } else { template.raw(0) };
                if has_adjacent
                    || is_allowed_string_like_in_container(checked_text, StringLike::Template, parent_is_attribute, cx.file())
                {
                    return;
                }
                Some(if parent_is_attribute { checked_text } else { string })
            }
            _ => return,
        };
        // oxlint also looks for comments next to an element that's an attribute value.
        let may_have_comments = !is_oxlint && parent_is_attribute && replacement.is_none();
        if !may_have_comments && cx.file().comments_in(container).len() > 0 {
            return;
        }
        // oxlint reports what's inside the braces.
        let report = match is_oxlint {
            true if replacement.is_none() && !parent_is_attribute => {
                cx.report(inner, UNNECESSARY).help("remove the curly braces")
            }
            true => cx.report(inner, UNNECESSARY),
            false => cx.report(container, UNNECESSARY_CURLY),
        };
        report.fix(|fixer| match replacement {
            // oxlint keeps the whitespace between the braces and a child.
            None if parent_is_attribute || !is_oxlint => vec![fixer.replace(container, inner.text())],
            None => vec![
                fixer.remove(Span::new(container.start, container.start + 1)),
                fixer.remove(Span::new(container.end - 1, container.end)),
            ],
            Some(string) if parent_is_attribute => {
                let quote = if strings::contains_char(string, b'"') { b'\'' } else { b'"' };
                let mut text = Vec::with_capacity(string.len() + 2);
                // oxlint prints a JavaScript string.
                if is_oxlint {
                    print_string(&mut text, string, quote);
                } else {
                    text.push(quote);
                    text.extend_from_slice(string);
                    text.push(quote);
                }
                vec![fixer.replace(container, text)]
            }
            Some(string) => vec![fixer.replace(container, string)],
        });
    }
}

/// `{"text"}`
fn in_braces(text: &[u8], is_oxlint: bool) -> Vec<u8> {
    let mut out = vec![b'{'];
    // ESLint's rule uses `JSON.stringify`.
    match is_oxlint {
        true => print_string(&mut out, text, b'"'),
        false => json_stringify(text, &mut out),
    }
    out.push(b'}');
    out
}

/// `{"text"}` with upstream's `escapeDoubleQuotes(escapeBackslashes(text))`: doubles each `\`, and adds one before any
/// `"` that doesn't already follow a `\`.
fn escaped_in_braces(text: &[u8]) -> Vec<u8> {
    let mut out = b"{\"".to_vec();
    for &byte in text {
        if byte == b'\\' || byte == b'"' && out.last() != Some(&b'\\') {
            out.push(b'\\');
        }
        out.push(byte);
    }
    out.extend_from_slice(b"\"}");
    out
}

/// Doesn't include the `has_adjacent_jsx_expression_containers` check. `s`: without the quotes.
fn is_allowed_string_like_in_container(s: &[u8], kind: StringLike, is_prop: bool, file: &File) -> bool {
    let is_oxlint = file.language().is_oxlint;
    let is_template = kind == StringLike::Template;
    // oxlint uses Rust's definition of whitespace, ESLint uses JavaScript's.
    let trimmed = if is_oxlint { strings::trim_unicode_whitespace(s) } else { strings::trim_js_whitespace(s) };
    // typescript-estree keeps `\r` in a template's text, and upstream only looks for `\n`.
    let line_breaks: &[u8] = if !is_oxlint && file.uses_typescript_parser() { b"\n" } else { b"\n\r" };
    let has = |it: u8| strings::contains_char(s, it);
    !s.is_empty() && trimmed.is_empty()
        || strings::index_of_any(s, line_breaks).is_some()
        || next_html_entity(s).is_some()
        || !is_prop && (strings::index_of_any(s, b"<>{}\\").is_some() || trimmed.len() != s.len())
        || match (is_oxlint, is_template) {
            (true, _) => {
                has(b'"') && has(b'\'') && is_prop
                    || (has(b'"') || has(b'\'')) && is_template && !is_prop
                    || [&b"/*"[..], b"*/", b"\\n", b"\\r", b"\\u"].into_iter().any(|it| strings::contains(s, it))
            }
            (false, true) => has(b'\\') || has(b'"') || has(b'\'') || trimmed.len() != s.len(),
            (false, false) => has(b'\\') || strings::contains(s, b"/*"),
        }
}

/// Returns the range of the first `&name;` or `&#1;`: `/&[A-Za-z\d#]+;/`
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

/// Calls `visit` with each piece of text between `line`'s entities, and its start offset.
fn for_each_part<'t>(line: &'t [u8], mut visit: impl FnMut(usize, &'t [u8])) {
    let mut from = 0;
    while let Some((start, end)) = line.get(from..).and_then(next_html_entity) {
        visit(from, line.get(from..from + start).unwrap_or_default());
        from += end;
    }
    visit(from, line.get(from..).unwrap_or_default());
}

fn report_missing_curly_for_text_node(span: Span, is_oxlint: bool, cx: &Cx<'_, JsxCurlyBracePresence>) {
    let value = cx.slice(span);
    // oxlint uses Rust's definition of whitespace, ESLint uses JavaScript's.
    let trim_start: fn(&[u8]) -> &[u8] =
        if is_oxlint { strings::trim_unicode_whitespace_start } else { strings::trim_js_whitespace_start };
    // Skip text that's only entities and whitespace.
    let mut has_text = false;
    for_each_part(value, |_, part| has_text |= !trim_start(part).is_empty());
    if !has_text {
        return;
    }
    cx.report(span, if is_oxlint { NECESSARY } else { MISSING_CURLY }).by_selector().fix(|fixer| {
        let mut fixes = Vec::new();
        // `after_blanks`: start at the first non-whitespace character.
        let mut wrap = |start: usize, part: &[u8], after_blanks: bool| {
            let part_text = if after_blanks { trim_start(part) } else { part };
            if !part_text.is_empty() {
                let start = span.start + (start + part.len() - part_text.len()) as u32;
                let part_span = Span::new(start, start + part_text.len() as u32);
                fixes.push(fixer.replace(part_span, in_braces(part_text, is_oxlint)));
            }
        };
        // ESLint's rule wraps single-line text as is.
        let has_lines = match is_oxlint {
            true => strings::contains_char(value, b'\n'),
            false => strings::contains_js_line_break(value),
        };
        if !has_lines {
            wrap(0, value, is_oxlint);
            return fixes;
        }
        let mut line_start = 0;
        for line in strings::split(value, b"\n") {
            // ESLint's rule only keeps a line's leading whitespace outside the braces.
            for_each_part(line, |start, part| wrap(line_start + start, part, is_oxlint || start == 0));
            line_start += line.len() + 1;
        }
        // ESLint's rule replaces the whole text.
        if !is_oxlint {
            fixes.extend([fixer.remove(Span::empty(span.start)), fixer.remove(Span::empty(span.end))]);
        }
        fixes
    });
}
