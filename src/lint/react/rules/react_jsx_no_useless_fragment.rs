use bun_lint_oxlint::ast_util::{as_call_expression, get_identifier_name};
use crate::jsx::{Child, children, is_jsx_fragment};
use crate::react::{is_jsx, is_padding_spaces};
use bun_lint_oxlint::text::is_whitespace;
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallow unnecessary fragments.
pub struct JsxNoUselessFragment {
    allow_expressions: bool,
}

const NEEDS_MORE_CHILDREN: Message = Message::new("", "Fragments should contain more than one child.");
const CHILD_OF_HTML_ELEMENT: Message = Message::new("", "Passing a fragment to a HTML element is useless.");

impl Rule for JsxNoUselessFragment {
    const META: Meta = Meta::oxlint(Plugin::React, "jsx-no-useless-fragment", Kind::Suggestion).has_suggestions();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        JsxNoUselessFragment { allow_expressions: options.object(0).bool_or("allowExpressions", false) }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if is_jsx(file) {
            on.exprs([ExprTag::Jsx], check);
        }
    }
}

fn check<'a>(rule: &JsxNoUselessFragment, e: Expr<'a>, cx: &mut Cx<'a, JsxNoUselessFragment>) {
    let ExprKind::Jsx(jsx) = e.kind() else {
        return;
    };
    if !jsx.is_fragment()
        && (!is_jsx_fragment(jsx)
            || jsx.attrs().iter().filter_map(|it| it.key()?.name()).any(|name| name.is_any(&["key", "ref"])))
    {
        return;
    }
    let file = cx.file();
    // The element or the fragment that it is a child of, without braces around it.
    let parent = match e.parent() {
        Node::Expr(parent) if e.jsx_container_span().is_none() && !e.is_parenthesized() => match parent.kind() {
            ExprKind::Jsx(parent) => Some(parent),
            _ => None,
        },
        _ => None,
    };
    let report = |message: Message| {
        let report = cx.report(jsx.opening_span(), message);
        if can_fix(file, jsx, parent) {
            report.suggest(message, |fixer| {
                let inside =
                    jsx.closing_span().map_or(&b""[..], |closing| file.slice(jsx.opening_span().between(closing)));
                fixer.replace(e, trim_like_react(inside))
            });
        }
    };
    let is_only_text = || {
        let mut all = children(file, jsx);
        matches!((all.next(), all.next()), (Some(Child::Text(_)), None))
    };
    let mut non_padding_children = children(file, jsx).filter(|it| !is_padding_spaces(*it));
    let (first, has_more) = (non_padding_children.next(), non_padding_children.next().is_some());
    let is_call = |it: Child<'a>| matches!(it, Child::ExpressionContainer(e) if as_call_expression(e).is_some());
    if !has_more
        && !first.is_some_and(is_call)
        && !(parent.is_none() && is_only_text())
        && !(rule.allow_expressions && matches!(first, Some(Child::ExpressionContainer(_))))
    {
        report(NEEDS_MORE_CHILDREN);
    }
    if parent.is_some_and(is_html_element) {
        report(CHILD_OF_HTML_ELEMENT);
    }
}

/// Blanks at the start and at the end go if there is a line break in them.
fn trim_like_react(text: &[u8]) -> &[u8] {
    let has_line_break = |blanks: &[u8]| strings::contains_char(blanks, b'\n');
    let (blanks, rest) = text.split_at(text.len() - text.trim_ascii_start().len());
    let text = if has_line_break(blanks) { rest } else { text };
    let (rest, blanks) = text.split_at(text.trim_ascii_end().len());
    if has_line_break(blanks) { rest } else { text }
}

fn can_fix<'a>(file: &'a File<'a>, jsx: Jsx<'a>, parent: Option<Jsx<'a>>) -> bool {
    let Some(parent) = parent else {
        // `const a = <></>`, `const a = <>cat {meow}</>`
        let is_whitespace_or_expression = |it: Child| match it {
            Child::Text(text) => is_whitespace(text),
            _ => matches!(it, Child::ExpressionContainer(_)),
        };
        return !children(file, jsx).all(is_whitespace_or_expression);
    };
    // `Eeee` in `<Eeee><>foo</></Eeee>` may want an element.
    let is_lowercase =
        |name: Name| text::code_points(name.bytes()).all(|it| char::from_u32(it.1).is_some_and(char::is_lowercase));
    parent.is_fragment() || get_identifier_name(parent).is_some_and(is_lowercase) || is_jsx_fragment(parent)
}

/// Its name starts with a small letter: `<a>`, `<a-b>`.
fn is_html_element(jsx: Jsx) -> bool {
    get_identifier_name(jsx).is_some_and(|name| match name.bytes().first() {
        Some(first) if first.is_ascii() => first.is_ascii_lowercase(),
        // Without a hyphen it is the name of a variable.
        _ => {
            strings::contains_char(name.bytes(), b'-')
                && text::first_code_point(name.bytes()).and_then(char::from_u32).is_some_and(char::is_lowercase)
        }
    })
}
