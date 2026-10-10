use crate::a11y::HTML_TAG;
use bun_lint_oxlint::ast_util::get_identifier_name;
use crate::jsx::as_jsx_element;
use crate::react::is_jsx;
use crate::util_jsx::is_dom_component;
use bun_lint_oxlint::text::contains_name;
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallow extra closing tags for components without children
pub struct SelfClosingComp {
    component: bool,
    html: bool,
}

const NOT_SELF_CLOSING: Message = Message::new("notSelfClosing", "Empty components are self-closing");
const SELF_CLOSING_COMP: Message = Message::new("", "Unnecessary closing tag");

impl Rule for SelfClosingComp {
    const META: Meta = Meta::plugin(Plugin::React, "self-closing-comp", Kind::None).fixable(Fixable::Code);
    const ON: On = On::new().exprs(&[ExprTag::Jsx]);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        SelfClosingComp { component: options.bool_or("component", true), html: options.bool_or("html", true) }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        if file.language().is_oxlint && !is_jsx(file) {
            return None;
        }
        Some(())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(jsx) = as_jsx_element(e) else {
            return;
        };
        let Some(closing) = jsx.closing_span() else {
            return;
        };
        let is_oxlint = cx.language().is_oxlint;
        let opening = jsx.opening_span();
        // Nothing but blanks with a line break in them is between the tags.
        let between = cx.slice(opening.between(closing));
        let is_empty = between.is_empty()
            || if is_oxlint {
                // oxlint looks at the text as it is written, and takes a no-break space for a blank.
                strings::is_all_unicode_whitespace(between) && strings::contains_char(between, b'\n')
            } else {
                children_is_multiline_spaces(jsx, cx.file())
            };
        if !is_empty {
            return;
        }
        let is_wanted = if is_oxlint {
            // oxlint knows the elements of HTML by a list, and all else is a component.
            let is_dom_comp =
                get_identifier_name(jsx).is_some_and(|tag_name| contains_name(&HTML_TAG, tag_name.bytes()));
            if is_dom_comp { self.html } else { self.component }
        } else if is_dom_component(jsx) {
            self.html
        } else {
            self.component && !is_namespaced_name(jsx)
        };
        if is_wanted {
            // oxlint points at the closing tag.
            let (at, message) = if is_oxlint { (closing, SELF_CLOSING_COMP) } else { (opening, NOT_SELF_CLOSING) };
            cx.report(at, message).fix(|fixer| {
                let bracket = opening.end - 1;
                fixer.replace(Span::new(bracket, closing.end), " />")
            });
        }
    }
}

/// `<A:b>`
fn is_namespaced_name(jsx: Jsx<'_>) -> bool {
    matches!(jsx.tag().map(Expr::kind), Some(ExprKind::String(name)) if strings::contains_char(name.bytes(), b':'))
}

/// upstream's `childrenIsMultilineSpaces`
fn children_is_multiline_spaces<'a>(jsx: Jsx<'a>, file: &'a File<'a>) -> bool {
    let mut children = jsx.children_with_whitespace();
    let (Some(child), None) = (children.next(), children.next()) else {
        return false;
    };
    child.text_value(file).is_some_and(|value| {
        strings::contains_char(&value, b'\n')
            && strings::is_all_js_whitespace(&value)
            && !strings::contains(&value, "\u{a0}".as_bytes())
    })
}
