use crate::jsx::{AttributeValue, as_jsx_element, get_prop_value, has_jsx_prop_ignore_case, is_undefined};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforces that the `accessKey` prop is not used on any element to avoid complications with keyboard commands used by a screen
/// reader.
pub struct NoAccessKey;

const NO_ACCESS_KEY: Message = Message::new("", "No access key attribute allowed.");
const REMOVE: Message = Message::new(
    "",
    "Remove the `accessKey` attribute. Inconsistencies between keyboard shortcuts and keyboard commands used by screen readers and keyboard-only users create accessibility complications.",
);

impl Rule for NoAccessKey {
    const META: Meta = Meta::oxlint(Plugin::JsxA11y, "no-access-key", Kind::Problem).has_suggestions();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoAccessKey
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::Jsx], |_, e, cx| {
            let Some(attr) = as_jsx_element(e).and_then(|jsx_el| has_jsx_prop_ignore_case(jsx_el, "accessKey")) else {
                return;
            };
            let is_set = match get_prop_value(attr) {
                Some(AttributeValue::StringLiteral(_)) => true,
                Some(value) => value.as_expression().is_some_and(|it| !is_undefined(it)),
                None => false,
            };
            if is_set {
                cx.report(attr, NO_ACCESS_KEY).suggest(REMOVE, |fixer| fixer.remove(attr));
            }
        });
    }
}
