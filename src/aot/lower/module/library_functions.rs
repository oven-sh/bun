#[cfg(test)]
mod tests;

use bun_sema::check::aot::FunctionRef;
use bun_sema::program::{FileId, Files};
use rustc_hash::FxHashMap;

use super::library::collect_link_time_constant_functions;
use crate::builtins::id::RuntimeFunction;
use crate::load::Sources;
use crate::lower::{FileInputs, SourceKind};

pub(super) fn collect_linked_functions(
    files: &Files<'_>,
    file_inputs: &[Option<FileInputs<'_>>],
    sources: &Sources,
) -> FxHashMap<RuntimeFunction, FunctionRef> {
    let mut by_id = FxHashMap::default();
    for (index, inputs) in file_inputs.iter().enumerate() {
        let Some(inputs) = inputs else {
            continue;
        };
        match inputs.source {
            SourceKind::Program | SourceKind::RuntimeModule(_) => continue,
            SourceKind::RuntimeFunctions => {}
        }
        let file = FileId(index as u32);
        let hir = files.hir(file);
        for function in collect_link_time_constant_functions(files, file, inputs.builtins) {
            let export_name = files.atoms.bytes(hir[function].name);
            if let Some(id) = sources.runtime_function(file, export_name) {
                by_id.insert(id, FunctionRef { file, function });
            }
        }
    }
    by_id
}
