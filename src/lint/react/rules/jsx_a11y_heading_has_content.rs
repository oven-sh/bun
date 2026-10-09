use crate::a11y::{is_hidden_from_screen_reader, object_has_accessible_child};
use crate::jsx::{as_jsx_element, get_element_type};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforce that heading elements have content that is accessible to screen readers.
pub struct HeadingHasContent {
    /// Besides `h1` to `h6`.
    components: Vec<String>,
}

const HEADING_HAS_CONTENT: Message =
    Message::new("", "Headings must have content and the content must be accessible by a screen reader.");

impl Rule for HeadingHasContent {
    const META: Meta = Meta::oxlint(Plugin::JsxA11y, "heading-has-content", Kind::Problem);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        HeadingHasContent { components: options.object(0).strings("components").into_iter().map(String::from).collect() }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::Jsx], |rule, e, cx| {
            let Some(jsx_el) = as_jsx_element(e) else {
                return;
            };
            let name = get_element_type(cx.file(), jsx_el);
            if !matches!(*name, [b'h', b'1'..=b'6']) && !rule.components.iter().any(|it| *it.as_bytes() == *name) {
                return;
            }
            if !object_has_accessible_child(cx.file(), jsx_el) && !is_hidden_from_screen_reader(cx.file(), jsx_el) {
                cx.report(jsx_el.opening_span(), HEADING_HAS_CONTENT);
            }
        });
    }
}
