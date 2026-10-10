use crate::jest::{self, JestFnKind, JestGeneralFnKind};
use bun_lint_oxlint::module_record::ModuleRecord;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Prevents using exports if a file has one or more tests in it.
pub struct NoExport;

const NO_EXPORT: Message = Message::new("", "Do not export from a test file.");

impl Rule for NoExport {
    const META: Meta = Meta::oxlint(Plugin::Jest, "no-export", Kind::Problem);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoExport
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        if !jest::is_jest_file(file) || !jest::may_have_possible_jest_call_node(file) {
            return None;
        }
        Some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let file = cx.file();
        let has_tests = jest::iter_possible_jest_call_node(file).any(|possible_node| {
            jest::parse_general_jest_fn_call(file, possible_node)
                .is_some_and(|general| general.kind == JestFnKind::General(JestGeneralFnKind::Test))
        });
        if has_tests {
            let module_record = ModuleRecord::new(file);
            for span in module_record.exported_bindings.values().copied().chain(module_record.export_default()) {
                cx.report(span, NO_EXPORT);
            }
        }
    }
}
