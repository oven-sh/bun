use crate::a11y::HTML_TAG;
use bun_lint_oxlint::ast_util::get_identifier_name;
use crate::jsx::as_jsx_element;
use crate::react::is_jsx;
use bun_lint_oxlint::text::{contains_name, is_whitespace};
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Detects components without children which can be self-closed to avoid unnecessary extra closing tags.
pub struct SelfClosingComp {
    component: bool,
    html: bool,
}

const SELF_CLOSING_COMP: Message = Message::new("", "Unnecessary closing tag");

impl Rule for SelfClosingComp {
    const META: Meta = Meta::oxlint(Plugin::React, "self-closing-comp", Kind::Suggestion).fixable(Fixable::Code);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        SelfClosingComp { component: options.bool_or("component", true), html: options.bool_or("html", true) }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !is_jsx(file) {
            return;
        }
        on.exprs([ExprTag::Jsx], |rule, e, cx| {
            let Some(jsx) = as_jsx_element(e) else {
                return;
            };
            let Some(closing) = jsx.closing_span() else {
                return;
            };
            // Nothing but blanks with a line break in them is between the tags.
            let between = cx.slice(jsx.opening_span().between(closing));
            if !between.is_empty() && !(is_whitespace(between) && strings::contains_char(between, b'\n')) {
                return;
            }
            let is_dom_comp =
                get_identifier_name(jsx).is_some_and(|tag_name| contains_name(&HTML_TAG, tag_name.bytes()));
            if if is_dom_comp { rule.html } else { rule.component } {
                cx.report(closing, SELF_CLOSING_COMP)
                    .fix(|fixer| fixer.replace(Span::new(jsx.opening_span().end - 1, closing.end), " />"));
            }
        });
    }
}
