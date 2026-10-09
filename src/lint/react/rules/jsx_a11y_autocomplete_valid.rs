use bun_core::strings;
use crate::jsx::{as_jsx_element, get_element_type, get_string_literal_prop_value, has_jsx_prop_ignore_case};
use bun_lint_oxlint::text::contains_name;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforces that an element's autocomplete attribute must be a valid value.
pub struct AutocompleteValid {
    input_components: Vec<String>,
}

const AUTOCOMPLETE_VALID: Message = Message::new("", "`{{autocomplete}}` is not a valid value for `autocomplete`.");

static VALID_AUTOCOMPLETE_VALUES: [&str; 49] = [
    "address-level1", "address-level2", "address-level3", "address-level4", "address-line1", "address-line2", "address-line3",
    "bday", "bday-day", "bday-month", "bday-year", "cc-additional-name", "cc-csc", "cc-exp", "cc-exp-month", "cc-exp-year",
    "cc-family-name", "cc-given-name", "cc-name", "cc-number", "cc-type", "country", "country-name", "current-password", "email",
    "impp", "language", "name", "new-password", "off", "on", "one-time-code", "organization", "organization-title", "photo",
    "postal-code", "sex", "street-address", "tel", "tel-area-code", "tel-country-code", "tel-extension", "tel-local",
    "tel-national", "transaction-amount", "transaction-currency", "url", "username", "webauthn",
];

/// What can follow `billing` and `shipping`.
fn is_part_of_address(value: &[u8]) -> bool {
    matches!(value, b"country" | b"country-name" | b"postal-code" | b"street-address")
        || value.starts_with(b"address-l") && contains_name(&VALID_AUTOCOMPLETE_VALUES, value)
}

fn is_valid_autocomplete_value(value: &[u8]) -> bool {
    let mut parts = strings::split_unicode_whitespace(value);
    match (parts.next(), parts.next(), parts.next()) {
        (Some(only), None, _) => contains_name(&VALID_AUTOCOMPLETE_VALUES, only),
        (Some(b"billing" | b"shipping"), Some(second), None) => is_part_of_address(second),
        _ => false,
    }
}

impl Rule for AutocompleteValid {
    const META: Meta = Meta::oxlint(Plugin::JsxA11y, "autocomplete-valid", Kind::Problem);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let config = options.object(0);
        AutocompleteValid {
            input_components: match config.has("inputComponents") {
                true => config.strings("inputComponents").into_iter().map(String::from).collect(),
                false => vec!["input".to_owned()],
            },
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::Jsx], |rule, e, cx| {
            let Some(jsx_el) = as_jsx_element(e) else {
                return;
            };
            let Some(attr) = has_jsx_prop_ignore_case(jsx_el, "autocomplete") else {
                return;
            };
            let name = get_element_type(cx.file(), jsx_el);
            if rule.input_components.iter().any(|it| *it.as_bytes() == *name)
                && let Some(value) = get_string_literal_prop_value(attr)
                && !is_valid_autocomplete_value(value)
            {
                cx.report(attr, AUTOCOMPLETE_VALID).data("autocomplete", value);
            }
        });
    }
}
