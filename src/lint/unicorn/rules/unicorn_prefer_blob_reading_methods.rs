use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Recommends using `Blob#text()` and `Blob#arrayBuffer()` over `FileReader#readAsText()` and `FileReader#readAsArrayBuffer()`.
pub struct PreferBlobReadingMethods;

const PREFER_BLOB_READING_METHODS: Message =
    Message::new("", "Prefer `Blob#{{good_method}}()` over `FileReader#{{bad_method}}(blob)`.");

impl Rule for PreferBlobReadingMethods {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "prefer-blob-reading-methods", Kind::Suggestion);
    const ON: On = On::new().method_calls(&["readAsText", "readAsArrayBuffer"]);
    /// `readAsText`, `readAsArrayBuffer`
    type State<'a> = [Name<'a>; 2];

    fn new(_: &Options) -> Self {
        PreferBlobReadingMethods
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Self::State<'a>> {
        const METHODS: [&str; 2] = ["readAsText", "readAsArrayBuffer"];
        METHODS.iter().any(|it| file.find_name(it).is_some()).then(|| METHODS.map(|it| file.name_of(it)))
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(call_expr) = e.as_call() else {
            return;
        };
        let callee = call_expr.callee();
        let Some((_, name, chain)) = callee.as_dot().filter(|it| cx.state.contains(&it.1.name())) else {
            return;
        };
        if call_expr.args().len() != 1 || call_expr.is_optional() {
            return;
        }
        let good_method = match name.bytes() {
            b"readAsText" => "text",
            b"readAsArrayBuffer" => "arrayBuffer",
            _ => return,
        };
        if chain != Chain::Start && !callee.is_parenthesized() {
            cx.report(name, PREFER_BLOB_READING_METHODS).data("good_method", good_method).data("bad_method", name);
        }
    }
}
