use crate::a11y::HTML_TAG;
use crate::jsx::{as_jsx_element, get_element_type, has_jsx_prop_ignore_case};
use bun_lint_oxlint::text::contains_name;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// The scope prop should be used only on `<th>` elements.
pub struct Scope;

const SCOPE: Message = Message::new("", "The `scope` prop can only be used on `<th>` elements");

impl Rule for Scope {
    const META: Meta = Meta::oxlint(Plugin::JsxA11y, "scope", Kind::Problem).fixable(Fixable::Code);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        Scope
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::Jsx], |_, e, cx| {
            let Some(jsx_el) = as_jsx_element(e) else {
                return;
            };
            let Some(scope_attribute) = has_jsx_prop_ignore_case(jsx_el, "scope") else {
                return;
            };
            let element_type = get_element_type(cx.file(), jsx_el);
            if *element_type != *b"th" && contains_name(&HTML_TAG, &element_type) {
                cx.report(scope_attribute, SCOPE).fix(|fixer| fixer.remove(scope_attribute));
            }
        });
    }
}
