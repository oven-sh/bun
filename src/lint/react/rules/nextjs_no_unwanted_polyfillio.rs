use crate::jsx::{as_jsx_element, get_string_literal_prop_value, has_jsx_prop};
use crate::nextjs::{find_url_query_value, get_next_script_import_local_name, is_next_polyfilled_feature};
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use std::cell::OnceCell;

/// Prevent use of unsafe polyfill.io domains and duplicate polyfills.
pub struct NoUnwantedPolyfillio;

const NO_UNWANTED_POLYFILLIO: Message = Message::new(
    "",
    "No duplicate polyfills from Polyfill.io are allowed. {{polyfill_name}} already shipped with Next.js.",
);
const POLYFILL_IO_SECURITY_WARNING: Message =
    Message::new("", "Using polyfill.io is a security risk due to a supply chain attack in 2024.");

impl Rule for NoUnwantedPolyfillio {
    const META: Meta = Meta::oxlint(Plugin::Nextjs, "no-unwanted-polyfillio", Kind::Problem);
    /// `get_next_script_import_local_name`
    type State<'a> = OnceCell<Option<Name<'a>>>;

    fn new(_: &Options) -> Self {
        NoUnwantedPolyfillio
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> Self::State<'a> {
        if !file.mentions("src") {
            return OnceCell::new();
        }
        on.exprs([ExprTag::Jsx], |_, e, cx| {
            let Some(jsx) = as_jsx_element(e) else {
                return;
            };
            let (Some(tag_name), Some(src)) = (jsx.tag().and_then(Expr::as_ident), has_jsx_prop(jsx, "src")) else {
                return;
            };
            let Some(src_str) = get_string_literal_prop_value(src).filter(|it| it.starts_with(b"https://")) else {
                return;
            };
            let starts_with_any = |prefixes: &[&[u8]]| prefixes.iter().any(|it| src_str.starts_with(it));
            let is_unsafe = starts_with_any(&[b"https://cdn.polyfill.io/v2/", b"https://polyfill.io/v3/"]);
            if !is_unsafe
                && !starts_with_any(&[
                    b"https://polyfill-fastly.net/",
                    b"https://polyfill-fastly.io/",
                    b"https://cdnjs.cloudflare.com/polyfill/",
                ])
            {
                return;
            }
            if !tag_name.is("script") && *cx.state.get_or_init(|| get_next_script_import_local_name(cx.file())) != Some(tag_name) {
                return;
            }
            if is_unsafe {
                cx.report(src, POLYFILL_IO_SECURITY_WARNING);
                return;
            }
            let Some(features_value) = find_url_query_value(src_str, b"features") else {
                return;
            };
            let (mut polyfill_name, mut count) = (Vec::new(), 0);
            let features = strings::split(features_value, b"%2C").flat_map(|it| strings::split(it, b","));
            for feature in features.filter(|it| is_next_polyfilled_feature(it)) {
                if count > 0 {
                    polyfill_name.extend_from_slice(b", ");
                }
                polyfill_name.extend_from_slice(feature);
                count += 1;
            }
            if count > 0 {
                polyfill_name.extend_from_slice(if count > 1 { " are" } else { " is" }.as_bytes());
                cx.report(src, NO_UNWANTED_POLYFILLIO).data("polyfill_name", polyfill_name);
            }
        });
        OnceCell::new()
    }
}
