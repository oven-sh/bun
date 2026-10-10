use crate::jsx::{as_jsx_element, get_jsx_attribute_name, get_string_literal_prop_value};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Prevent manual inclusion of stylesheets using `<link>` tags in Next.js applications.
pub struct NoCssTags;

const NO_CSS_TAGS: Message = Message::new("", "Do not include stylesheets manually.");

impl Rule for NoCssTags {
    const META: Meta = Meta::oxlint(Plugin::Nextjs, "no-css-tags", Kind::Problem);
    const ON: On = On::new().exprs(&[ExprTag::Jsx]);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoCssTags
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        if !file.mentions("link") || !file.mentions("stylesheet") {
            return None;
        }
        Some(())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(jsx) = as_jsx_element(e) else {
            return;
        };
        let Some(name) = jsx.tag().filter(|it| it.is_ident("link")) else {
            return;
        };
        // The last of each counts.
        let value_of = |name: &[u8]| {
            let attribute = jsx.attrs().iter().rfind(|it| get_jsx_attribute_name(*it) == Some(name));
            attribute.and_then(get_string_literal_prop_value)
        };
        if value_of(b"rel").is_some_and(|rel| rel == b"stylesheet")
            && value_of(b"href").is_some_and(|href| !href.starts_with(b"https://") && !href.starts_with(b"http://"))
        {
            cx.report(name, NO_CSS_TAGS);
        }
    }
}
