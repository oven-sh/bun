use bun_lint_oxlint::ast_util::get_identifier_name;
use crate::jsx::{Child, children, is_jsx_fragment};
use crate::react::{is_jsx, is_padding_spaces};
use crate::util_jsx::is_fragment;
use crate::util_pragma::{get_fragment_from_context, get_from_context};
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallow unnecessary fragments
pub struct JsxNoUselessFragment {
    allow_expressions: bool,
}

const NEEDS_MORE_CHILDREN: Message = Message::new(
    "NeedsMoreChildren",
    "Fragments should contain more than one child - otherwise, there’s no need for a Fragment at all.",
);
const CHILD_OF_HTML_ELEMENT: Message =
    Message::new("ChildOfHtmlElement", "Passing a fragment to an HTML element is useless.");
const OXLINT_NEEDS_MORE_CHILDREN: Message = Message::new("", "Fragments should contain more than one child.");
const OXLINT_CHILD_OF_HTML_ELEMENT: Message = Message::new("", "Passing a fragment to a HTML element is useless.");

pub struct Pragmas<'a> {
    react: &'a [u8],
    fragment: &'a [u8],
}

impl Rule for JsxNoUselessFragment {
    const META: Meta = Meta::plugin(Plugin::React, "jsx-no-useless-fragment", Kind::Suggestion)
        .fixable(Fixable::Code)
        .has_suggestions();
    const ON: On = On::new().exprs(&[ExprTag::Jsx]);
    type State<'a> = Pragmas<'a>;

    fn new(options: &Options) -> Self {
        JsxNoUselessFragment { allow_expressions: options.object(0).bool_or("allowExpressions", false) }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Pragmas<'a>> {
        // oxlint reads no settings and no comment.
        if file.language().is_oxlint {
            return is_jsx(file).then_some(Pragmas { react: b"React", fragment: b"Fragment" });
        }
        Some(Pragmas { react: get_from_context(file), fragment: get_fragment_from_context(file) })
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Jsx(jsx) = e.kind() else {
            return;
        };
        let (file, is_oxlint) = (cx.file(), cx.language().is_oxlint);
        let is_fragment_element = |it: Jsx<'a>| match is_oxlint {
            true => is_jsx_fragment(it),
            false => is_fragment(it, cx.state.react, cx.state.fragment),
        };
        // oxlint leaves one with a `ref` alone too.
        let is_kept = |name: Name| name.is("key") || (is_oxlint && name.is("ref"));
        if !jsx.is_fragment()
            && (!is_fragment_element(jsx) || jsx.attrs().iter().filter_map(|it| it.key()?.name()).any(is_kept))
        {
            return;
        }
        // The element or the fragment that it is a child of, without braces around it.
        let parent = match e.parent() {
            Node::Expr(parent) if e.jsx_container_span().is_none() && !e.is_parenthesized() => match parent.kind() {
                ExprKind::Jsx(parent) => Some(parent),
                _ => None,
            },
            _ => None,
        };
        let is_child_of_html_element = parent.is_some_and(|it| is_html_element(it, is_oxlint));
        let can_fix = || match parent {
            // `const a = <></>`, `const a = <>cat {meow}</>`
            None => {
                let is_nonspace_text_or_curly = |it: Child| match it {
                    Child::Text(raw) => !is_only_whitespace(raw, is_oxlint),
                    _ => matches!(it, Child::ExpressionContainer(_)),
                };
                children(file, jsx).next().is_some() && !children(file, jsx).any(is_nonspace_text_or_curly)
            }
            // `Eeee` in `<Eeee><>foo</></Eeee>` may want an element.
            Some(parent) => {
                // For oxlint that is every name with a letter that is not small.
                let is_html = if is_oxlint { is_all_lowercase(parent) } else { is_child_of_html_element };
                parent.is_fragment() || is_html || is_fragment_element(parent)
            }
        };
        let report = |message: Message, of_oxlint: Message| {
            let fix = |fixer: Fixer<'a>| {
                let inside =
                    jsx.closing_span().map_or(&b""[..], |closing| file.slice(jsx.opening_span().between(closing)));
                fixer.replace(e, trim_like_react(inside, is_oxlint))
            };
            // oxlint points at the opening tag, and suggests what upstream fixes.
            match (is_oxlint, can_fix()) {
                (true, true) => cx.report(jsx.opening_span(), of_oxlint).suggest(of_oxlint, fix),
                (true, false) => cx.report(jsx.opening_span(), of_oxlint),
                (false, true) => cx.report(e, message).fix(fix),
                (false, false) => cx.report(e, message),
            };
        };
        let is_only_text = || {
            let mut all = children(file, jsx);
            matches!((all.next(), all.next()), (Some(Child::Text(_)), None))
        };
        let is_padding = |it: Child<'a>| match it {
            _ if is_oxlint => is_padding_spaces(it),
            Child::Text(raw) => is_only_whitespace(raw, is_oxlint) && strings::contains_char(raw, b'\n'),
            _ => false,
        };
        let mut non_padding_children = children(file, jsx).filter(|it| !is_padding(*it));
        let (first, has_more) = (non_padding_children.next(), non_padding_children.next().is_some());
        // For oxlint a call in parentheses is none.
        let is_call = |it: Child<'a>| {
            matches!(it, Child::ExpressionContainer(e)
                if e.tag() == ExprTag::Call && !e.is_chain_root() && !(is_oxlint && e.is_parenthesized()))
        };
        if !has_more
            && !first.is_some_and(is_call)
            && !(parent.is_none() && is_only_text())
            && !(self.allow_expressions && matches!(first, Some(Child::ExpressionContainer(_))))
        {
            report(NEEDS_MORE_CHILDREN, OXLINT_NEEDS_MORE_CHILDREN);
        }
        if is_child_of_html_element {
            report(CHILD_OF_HTML_ELEMENT, OXLINT_CHILD_OF_HTML_ELEMENT);
        }
    }
}

/// `isOnlyWhitespace`. oxlint goes by Unicode's `White_Space`.
fn is_only_whitespace(text: &[u8], is_oxlint: bool) -> bool {
    if is_oxlint { strings::is_all_unicode_whitespace(text) } else { strings::is_all_js_whitespace(text) }
}

/// Blanks at the start and at the end go if there is a line break in them. oxlint knows the blanks of ASCII only.
fn trim_like_react(text: &[u8], is_oxlint: bool) -> &[u8] {
    let has_line_break = |blanks: &[u8]| strings::contains_char(blanks, b'\n');
    let rest = if is_oxlint { text.trim_ascii_start() } else { strings::trim_js_whitespace_start(text) };
    let (blanks, rest) = text.split_at(text.len() - rest.len());
    let text = if has_line_break(blanks) { rest } else { text };
    let rest = if is_oxlint { text.trim_ascii_end() } else { strings::trim_js_whitespace_end(text) };
    let (rest, blanks) = text.split_at(rest.len());
    if has_line_break(blanks) { rest } else { text }
}

fn is_all_lowercase(jsx: Jsx) -> bool {
    get_identifier_name(jsx).is_some_and(|name| {
        strings::wtf8_codepoints(name.bytes()).all(|it| char::from_u32(it.1).is_some_and(char::is_lowercase))
    })
}

/// `isChildOfHtmlElement`: its name is `/^[a-z]+$/`. For oxlint it starts with a small letter: `<a>`, `<a-b>`.
fn is_html_element(jsx: Jsx, is_oxlint: bool) -> bool {
    if !is_oxlint {
        return match jsx.tag().map(Expr::kind) {
            Some(ExprKind::Ident(name)) => name.bytes().iter().all(u8::is_ascii_lowercase),
            Some(ExprKind::This) => true,
            _ => false,
        };
    }
    get_identifier_name(jsx).is_some_and(|name| match name.bytes().first() {
        Some(first) if first.is_ascii() => first.is_ascii_lowercase(),
        // Without a hyphen it is the name of a variable.
        _ => {
            strings::contains_char(name.bytes(), b'-')
                && strings::wtf8_first_codepoint(name.bytes()).and_then(char::from_u32).is_some_and(char::is_lowercase)
        }
    })
}
