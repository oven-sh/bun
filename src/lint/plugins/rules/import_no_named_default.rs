use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Forbid named default exports.
pub struct NoNamedDefault;

const USE_DEFAULT_IMPORT: Message = Message::new("", "Use default import syntax to import '{{name}}'.");
const OXLINT: Message = Message::new("", "Replace default import with named import.");

impl Rule for NoNamedDefault {
    const META: Meta = Meta::plugin(Plugin::Import, "no-named-default", Kind::Suggestion);
    const ON: On = On::new().import_specs();
    no_state!();

    fn new(_: &Options) -> Self {
        NoNamedDefault
    }

    fn import_spec<'a>(&self, specifier: ImportSpec<'a>, cx: &mut Cx<'a, Self>) {
        if specifier.is_type_only() || !specifier.imported().name().is("default") {
            return;
        }
        // oxlint points at the name in the other module.
        if cx.language().is_oxlint {
            cx.report(specifier.imported(), OXLINT);
        } else {
            cx.report(specifier.local(), USE_DEFAULT_IMPORT).data("name", specifier.local());
        }
    }
}
