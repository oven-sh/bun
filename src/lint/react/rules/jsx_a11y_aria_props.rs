use crate::a11y::{cow_to_ascii_lowercase, is_valid_aria_property};
use crate::jsx::get_jsx_attribute_name;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforces that elements do not use invalid ARIA attributes.
pub struct AriaProps;

const ARIA_PROPS: Message = Message::new("", "'{{prop_name}}' is not a valid ARIA attribute.");

impl Rule for AriaProps {
    const META: Meta = Meta::oxlint(Plugin::JsxA11y, "aria-props", Kind::Problem).fixable(Fixable::Code);
    // Elements are far fewer than properties.
    const ON: On = On::new().exprs(&[ExprTag::Jsx]);
    no_state!();

    fn new(_: &Options) -> Self {
        AriaProps
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
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
            let report = cx.report(attr, ARIA_PROPS).data("prop_name", name);
            let report = match suggestion {
                Some(suggestion) => report.help_with(|| format!("Did you mean '{suggestion}'?")),
                None => report.help(
                    "You can find a list of valid ARIA attributes at https://www.w3.org/TR/wai-aria-1.1/#state_prop_def",
                ),
            };
            report.fix(|fixer| Some(fixer.replace(attr.key()?.span(fixer.file()), suggestion?)));
        }
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
