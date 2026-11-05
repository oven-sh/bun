use bun_alloc::Arena;
use bun_aot::load::source_provider::{Failed, SourceFile};
use bun_ast::{Loc, Log, Source};
use bun_sema::atom::Interner;
use bun_sema::hir_from_data::DataValue;

use super::services::BuildContext;
pub(crate) use crate::bun_css::css_modules::is_module_path;
use crate::css_module_graph::{StackOverflow, load_exports, without_bom};

pub(crate) fn exported_names<'s>(
    context: &BuildContext,
    file: &SourceFile<'_>,
    arena: &'s Arena,
    atoms: &Interner<'s>,
    log: &mut Log,
) -> Result<&'s DataValue<'s>, Failed> {
    let contents = without_bom(file.contents.to_vec());
    match context.with_worker(|transpiler, _| load_exports(transpiler, file.path, &contents)) {
        Ok(exports) => {
            let intern = |(name, value): &(Vec<u8>, Vec<u8>)| {
                (atoms.intern(name), DataValue::String(atoms.intern(value)))
            };
            let names: Vec<_> = exports.iter().map(intern).collect();
            Ok(arena.alloc(DataValue::Object(arena.alloc_slice_copy(&names))))
        }
        Err(StackOverflow) => {
            let source = Source::init_path_string(file.path, file.contents);
            log.add_error(
                Some(&source),
                Loc::EMPTY,
                b"The CSS module nests too deeply",
            );
            Err(Failed)
        }
    }
}
