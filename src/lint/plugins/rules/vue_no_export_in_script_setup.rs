use bun_lint_oxlint::import::export_default;
use crate::oxlint::vue::{export_entries, is_vue_setup};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallow `export` in `<script setup>`.
pub struct NoExportInScriptSetup;

const NO_EXPORT_IN_SCRIPT_SETUP: Message = Message::new("", "<script setup>` cannot contain ES module exports.");

impl Rule for NoExportInScriptSetup {
    const META: Meta = Meta::oxlint(Plugin::Vue, "no-export-in-script-setup", Kind::Problem);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoExportInScriptSetup
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if is_vue_setup(file) {
            on.finish(|_, cx| {
                let entries = export_entries(cx.file());
                for span in entries.iter().filter(|it| !it.is_type).map(|it| it.span).chain(export_default(cx.file())) {
                    cx.report(span, NO_EXPORT_IN_SCRIPT_SETUP);
                }
            });
        }
    }
}
