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
pub fn findImportedCSSFilesInJSOrder(this: *LinkerContext, temp_allocator: std.mem.Allocator, entry_point: Index) BabyList(Index) {
    var visited = bun.handleOom(BitSet.initEmpty(temp_allocator, this.graph.files.len));
    var order: BabyList(Index) = .{};

    const all_import_records = this.graph.ast.items(.import_records);
    const all_loaders = this.parse_graph.input_files.items(.loader);
    const all_parts = this.graph.ast.items(.parts);

    const visit = struct {
        fn visit(
            c: *LinkerContext,
            import_records: []const BabyList(ImportRecord),
            parts: []const Part.List,
            loaders: []const Loader,
            temp: std.mem.Allocator,
            visits: *BitSet,
            o: *BabyList(Index),
            source_index: Index,
            is_css: bool,
        ) void {
            if (visits.isSet(source_index.get())) return;
            visits.set(source_index.get());

            const records: []ImportRecord = import_records[source_index.get()].slice();
            const p = &parts[source_index.get()];

            // Iterate over each part in the file in order
            for (p.sliceConst()) |part| {
                // Traverse any files imported by this part. Note that CommonJS calls
                // to "require()" count as imports too, sort of as if the part has an
                // ESM "import" statement in it. This may seem weird because ESM imports
                // are a compile-time concept while CommonJS imports are a run-time
                // concept. But we don't want to manipulate <style> tags at run-time so
                // this is the only way to do it.
                for (part.import_record_indices.sliceConst()) |import_record_index| {
                    const record = &records[import_record_index];
                    if (record.source_index.isValid()) {
                        visit(
                            c,
                            import_records,
                            parts,
                            loaders,
                            temp,
                            visits,
                            o,
                            record.source_index,
                            loaders[record.source_index.get()].isCSS(),
                        );
                    }
                }
            }

            if (is_css and source_index.isValid()) {
                bun.handleOom(o.append(temp, source_index));
            }
        }
    }.visit;

    // Include all files reachable from the entry point
    visit(
        this,
        all_import_records,
        all_parts,
        all_loaders,
        temp_allocator,
        &visited,
        &order,
        entry_point,
        false,
    );

    return order;
}

pub const BitSet = bun.bit_set.DynamicBitSetUnmanaged;

const std = @import("std");

const bun = @import("bun");
const BabyList = bun.BabyList;
const ImportRecord = bun.ImportRecord;
const Loader = bun.Loader;

const Index = bun.bundle_v2.Index;
const LinkerContext = bun.bundle_v2.LinkerContext;
const Part = bun.bundle_v2.Part;
