use bun_lint_oxlint::module_record::requested_modules;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallow importing from `node:test`, preferring `vitest` instead.
pub struct NoImportNodeTest;

const NO_IMPORT_NODE_TEST: Message = Message::new("", "Do not import from `node:test`");
const IMPORT_FROM_VITEST: Message = Message::new("", "Import from `vitest` instead.");

impl Rule for NoImportNodeTest {
    const META: Meta = Meta::oxlint(Plugin::Vitest, "no-import-node-test", Kind::Suggestion).has_suggestions();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoImportNodeTest
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !file.mentions("node:test") {
            return;
        }
        on.finish(|_, cx| {
            let requested_modules = requested_modules(cx.file());
            if let Some((_, node_test_module)) = requested_modules.iter().find(|it| it.0.is("node:test"))
                && let Some(requested_module) = node_test_module.first()
            {
                let span = requested_module.span;
                cx.report(span, NO_IMPORT_NODE_TEST).suggest(IMPORT_FROM_VITEST, |fixer| fixer.replace(span, "\"vitest\""));
            }
        });
    }
}
