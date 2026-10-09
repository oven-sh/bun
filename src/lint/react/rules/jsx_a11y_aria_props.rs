use crate::a11y::{cow_to_ascii_lowercase, is_valid_aria_property};
use crate::jsx::get_jsx_attribute_name;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforces that elements do not use invalid ARIA attributes.
pub struct AriaProps;

const ARIA_PROPS: Message = Message::new("", "'{{prop_name}}' is not a valid ARIA attribute.");

impl Rule for AriaProps {
    const META: Meta = Meta::oxlint(Plugin::JsxA11y, "aria-props", Kind::Problem).fixable(Fixable::Code);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        AriaProps
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        // Elements are far fewer than properties.
        on.exprs([ExprTag::Jsx], |_, e, cx| {
            let ExprKind::Jsx(jsx) = e.kind() else {
                return;
            };
            for attr in jsx.attrs() {
                let Some(name) = get_jsx_attribute_name(attr) else {
                    continue;
                };
                if !name.get(..5).is_some_and(|it| it.eq_ignore_ascii_case(b"aria-")) {
                    continue;
                }
                let name = cow_to_ascii_lowercase(name);
                if is_valid_aria_property(&name) {
                    continue;
                }
                let suggestion = get_common_aria_prop_typo(&name);
                cx.report(attr, ARIA_PROPS).data("prop_name", name).fix(|fixer| {
                    Some(fixer.replace(attr.key()?.span(fixer.file()), suggestion?))
                });
            }
        });
    }
}

fn get_common_aria_prop_typo(prop_name: &[u8]) -> Option<&'static str> {
    match prop_name {
        b"aria-labeledby" => Some("aria-labelledby"),
        b"aria-role" => Some("role"),
        b"aria-sorted" => Some("aria-sort"),
        b"aria-lable" => Some("aria-label"),
        b"aria-value" => Some("aria-valuenow"),
        _ => None,
    }
}
