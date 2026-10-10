use crate::jsx::{as_jsx_element, get_prop_value, has_jsx_prop_ignore_case, parse_jsx_value};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforces that positive values for the `tabIndex` attribute are not used in JSX.
pub struct TabindexNoPositive;

const TABINDEX_NO_POSITIVE: Message = Message::new("", "Avoid positive integer values for `tabIndex`.");
const CHANGE: Message = Message::new("", "Change the `tabIndex` prop to a non-positive value.");

impl Rule for TabindexNoPositive {
    const META: Meta = Meta::oxlint(Plugin::JsxA11y, "tabindex-no-positive", Kind::Problem).has_suggestions();
    const ON: On = On::new().exprs(&[ExprTag::Jsx]);
    no_state!();

    fn new(_: &Options) -> Self {
        TabindexNoPositive
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if let Some(attr) = as_jsx_element(e).and_then(|jsx_el| has_jsx_prop_ignore_case(jsx_el, "tabIndex"))
            && let Some(value) = get_prop_value(attr)
            && parse_jsx_value(value).is_some_and(|parsed_value| parsed_value > 0.0)
        {
            cx.report(attr, TABINDEX_NO_POSITIVE).suggest_dangerously(CHANGE, |fixer| fixer.replace(value.span(), "\"0\""));
        }
    }
}
