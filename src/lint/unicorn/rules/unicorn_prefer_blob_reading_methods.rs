use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Recommends using `Blob#text()` and `Blob#arrayBuffer()` over `FileReader#readAsText()` and `FileReader#readAsArrayBuffer()`.
pub struct PreferBlobReadingMethods;

const PREFER_BLOB_READING_METHODS: Message =
    Message::new("", "Prefer `Blob#{{good_method}}()` over `FileReader#{{bad_method}}(blob)`.");

impl Rule for PreferBlobReadingMethods {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "prefer-blob-reading-methods", Kind::Suggestion);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferBlobReadingMethods
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !file.mentions_any(&["readAsText", "readAsArrayBuffer"]) {
            return;
        }
        on.exprs([ExprTag::Call], |_, e, cx| {
            let Some(call_expr) = e.as_call().filter(|it| it.args().len() == 1 && !it.is_optional()) else {
                return;
            };
            let callee = call_expr.callee();
            let ExprKind::Dot { name, chain, .. } = callee.kind() else {
                return;
            };
            let good_method = match name.bytes() {
                b"readAsText" => "text",
                b"readAsArrayBuffer" => "arrayBuffer",
                _ => return,
            };
            if chain != Chain::Start && !callee.is_parenthesized() {
                cx.report(name, PREFER_BLOB_READING_METHODS).data("good_method", good_method).data("bad_method", name);
            }
        });
    }
}
