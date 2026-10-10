use bun_lint_oxlint::import::import_entries;
use crate::oxlint::vue::export_entries;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforce imports from `vue` instead of `@vue/*`.
pub struct PreferImportFromVue;

const PREFER_IMPORT_FROM_VUE: Message = Message::new("", "Use imports from `vue` instead of `@vue/*`.");

const VUE_MODULES: [&str; 4] = ["@vue/reactivity", "@vue/runtime-core", "@vue/runtime-dom", "@vue/shared"];

impl Rule for PreferImportFromVue {
    const META: Meta = Meta::oxlint(Plugin::Vue, "prefer-import-from-vue", Kind::Problem).fixable(Fixable::Code);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferImportFromVue
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        let path = file.path();
        let is_typescript_definition = path.ends_with(b".d.ts") || path.ends_with(b".d.mts") || path.ends_with(b".d.cts");
        if is_typescript_definition || !file.mentions_any(&VUE_MODULES) {
            return None;
        }
        Some(())
    }

    // A report for each name that is imported or exported.
    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let imports = import_entries(cx.file()).filter_map(|it| Some((it.declaration.spec(), it.declaration.spec_span()?)));
        let exports = export_entries(cx.file());
        for (_, span) in imports.chain(exports.iter().filter_map(|it| it.module_request)).filter(|it| it.0.is_any(&VUE_MODULES)) {
            cx.report(span, PREFER_IMPORT_FROM_VUE).fix(|fixer| fixer.replace(span, "'vue'"));
        }
    }
}
