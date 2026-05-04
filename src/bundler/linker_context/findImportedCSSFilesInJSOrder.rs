use bun_alloc::Arena;
use bun_collections::{BabyList, DynamicBitSet};
use bun_options_types::ImportRecord;

use crate::options::Loader;
use crate::part::List as PartList; // TODO(port): verify path of `Part.List`
use crate::{Index, LinkerContext, Part};

/// JavaScript modules are traversed in depth-first postorder. This is the
/// order that JavaScript modules were evaluated in before the top-level await
/// feature was introduced.
///
///      A
///     / \
///    B   C
///     \ /
///      D
///
/// If A imports B and then C, B imports D, and C imports D, then the JavaScript
/// traversal order is D B C A.
///
/// This function may deviate from ESM import order for dynamic imports (both
/// "require()" and "import()"). This is because the import order is impossible
/// to determine since the imports happen at run-time instead of compile-time.
/// In this case we just pick an arbitrary but consistent order.
pub fn find_imported_css_files_in_js_order(
    this: &LinkerContext,
    temp: &Arena,
    entry_point: Index,
) -> BabyList<Index> {
    // PERF(port): was arena bulk-free (DynamicBitSet now Box<[usize]>-backed) — profile in Phase B
    let mut visited = BitSet::new_empty(this.graph.files.len());
    let mut order: BabyList<Index> = BabyList::default();

    // TODO(port): MultiArrayList field-slice accessor shape (`.items(.field)` in Zig)
    let all_import_records = this.graph.ast.import_records();
    let all_loaders = this.parse_graph.input_files.loader();
    let all_parts = this.graph.ast.parts();

    // Zig uses a local `struct { fn visit }.visit` to get a recursive local fn.
    // Rust nested `fn` items can recurse directly.
    #[allow(clippy::too_many_arguments)]
    fn visit(
        c: &LinkerContext,
        import_records: &[BabyList<ImportRecord>],
        parts: &[PartList],
        loaders: &[Loader],
        temp: &Arena,
        visits: &mut BitSet,
        o: &mut BabyList<Index>,
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
            // Traverse any files imported by this part. Note that CommonJS calls
            // to "require()" count as imports too, sort of as if the part has an
            // ESM "import" statement in it. This may seem weird because ESM imports
            // are a compile-time concept while CommonJS imports are a run-time
            // concept. But we don't want to manipulate <style> tags at run-time so
            // this is the only way to do it.
            for &import_record_index in part.import_record_indices.as_slice() {
                let record = &records[import_record_index as usize];
                if record.source_index.is_valid() {
                    visit(
                        c,
                        import_records,
                        parts,
                        loaders,
                        temp,
                        visits,
                        o,
                        record.source_index,
                        loaders[record.source_index.get() as usize].is_css(),
                    );
                }
            }
        }

        if is_css && source_index.is_valid() {
            // bun.handleOom(o.append(temp, source_index)) — Rust aborts on OOM.
            o.push(temp, source_index);
        }
    }

    // Include all files reachable from the entry point
    visit(
        this,
        all_import_records,
        all_parts,
        all_loaders,
        temp,
        &mut visited,
        &mut order,
        entry_point,
        false,
    );

    order
}

pub type BitSet = DynamicBitSet;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bundler/linker_context/findImportedCSSFilesInJSOrder.zig (103 lines)
//   confidence: medium
//   todos:      2
//   notes:      MultiArrayList `.items(.field)` accessor + `Part.List` path need Phase B wiring; arena threaded for BabyList push
// ──────────────────────────────────────────────────────────────────────────
