use crate::mal_prelude::*;
use bun_alloc::Arena;
use bun_ast::ImportRecord;
use bun_collections::VecExt;

use crate::options::Loader;
use crate::{Index, LinkerContext};
use bun_ast::PartList;
use bun_collections::DynamicBitSet as BitSet;

pub fn find_imported_css_files_in_js_order(
    this: &LinkerContext,
    _temp: &Arena,
    entry_point: Index,
) -> Vec<Index> {
    // PERF(port): was arena bulk-free (DynamicBitSet now Box<[usize]>-backed).
    let mut visited = BitSet::init_empty(this.graph.files.len()).expect("oom");
    let mut order: Vec<Index> = Vec::new();

    let all_import_records = this.graph.ast.items_import_records();
    let all_loaders = this.parse_graph().input_files.items_loader();
    let all_parts = this.graph.ast.items_parts();

    // Zig uses a local `struct { fn visit }.visit` to get a recursive local fn.
    // Rust nested `fn` items can recurse directly.
    #[allow(clippy::too_many_arguments)]
    fn visit(
        c: &LinkerContext,
        import_records: &[bun_ast::import_record::List<'_>],
        parts: &[PartList<'_>],
        loaders: &[Loader],
        visits: &mut BitSet,
        o: &mut Vec<Index>,
        source_index: Index,
        is_css: bool,
    ) {
        if visits.is_set(source_index.get() as usize) {
            return;
        }
        visits.set(source_index.get() as usize);

        let records: &[ImportRecord] = import_records[source_index.get() as usize].as_slice();
        let p = &parts[source_index.get() as usize];

        // Iterate over each part in the file in order
        for part in p.as_slice() {
            for &import_record_index in part.import_record_indices.slice() {
                let record = &records[import_record_index as usize];
                if record.source_index.is_valid() {
                    visit(
                        c,
                        import_records,
                        parts,
                        loaders,
                        visits,
                        o,
                        record.source_index,
                        loaders[record.source_index.get() as usize].is_css(),
                    );
                }
            }
        }

        if is_css && source_index.is_valid() {
            // bun.handleOom(o.append(temp, source_index)) — Rust Vec uses global arena.
            o.push(source_index);
        }
    }

    // Include all files reachable from the entry point
    visit(
        this,
        all_import_records,
        all_parts,
        all_loaders,
        &mut visited,
        &mut order,
        entry_point,
        false,
    );

    order
}

// ported from: src/bundler/linker_context/findImportedCSSFilesInJSOrder.zig
