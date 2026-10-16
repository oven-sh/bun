use crate::import_export_map::{ExportMaps, Got, PARSE_ERRORS};
use bun_lint_oxlint::module_record::{debug, get_loaded_module, is_waiting_for_modules};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use std::cell::OnceCell;

/// Ensure a default export is present, given a default import.
pub struct Default;

const NO_DEFAULT: Message = Message::new("", "No default export found in imported module \"{{source}}\".");
const DEFAULT: Message = Message::new("", "No default export found in imported module {{imported_name}}");

/// `oxc_span`'s `VALID_EXTENSIONS`
fn has_valid_extension(path: &[u8]) -> bool {
    [&b".js"[..], b".mjs", b".cjs", b".jsx", b".ts", b".mts", b".cts", b".tsx"].iter().any(|it| path.ends_with(it))
}

impl Rule for Default {
    const META: Meta = Meta::plugin(Plugin::Import, "default", Kind::Problem).needs_modules();
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        Default
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        // oxlint knows the other files when all are read. The plugin reads the one that it asks about.
        if file.language().is_oxlint && is_waiting_for_modules(file) || file.modules().is_none() {
            return None;
        }
        file.has_stmts([StmtTag::Import]).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let (file, maps) = (cx.file(), OnceCell::new());
        let is_oxlint = file.language().is_oxlint;
        for stmt in file.stmts_of_kind(StmtTag::Import) {
            let StmtKind::Import(import) = stmt.kind() else {
                continue;
            };
            let Some(local) = import.default() else {
                continue;
            };
            let specifier = import.spec().bytes();
            if is_oxlint {
                // Its record has the imports of the top level.
                if matches!(stmt.parent(), Node::File(_))
                    && let Some(remote) = get_loaded_module(file, specifier)
                    && remote.record.has_module_syntax
                    && has_valid_extension(remote.path())
                    && !remote.record.has_export_default
                    && !remote.exports(b"default")
                {
                    cx.report(local, DEFAULT).data("imported_name", debug(specifier));
                }
                continue;
            }
            let Some(maps) = maps.get_or_init(|| ExportMaps::of(file)) else {
                return;
            };
            let Some(imports) = maps.get(specifier) else {
                continue;
            };
            if imports.has_errors() {
                let source = import.spec_span().unwrap_or_else(|| stmt.span());
                cx.report(source, PARSE_ERRORS).data("source", specifier).data("errors", imports.errors_text());
            } else if matches!(maps.get_export(imports, b"default"), Got::Undefined) {
                cx.report(local, NO_DEFAULT).data("source", specifier);
            }
        }
    }
}
