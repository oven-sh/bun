//! Barrel optimization: detect pure re-export barrel files and defer loading
//! of unused submodules. Uses a persistent `requested_exports` map to track
//! which exports have been requested from each barrel, providing cross-call
//! deduplication and cycle detection (inspired by Rolldown's pattern).
//!
//! Import requests are recorded eagerly as each file is processed — before
//! barrels are known. When a barrel later loads, applyBarrelOptimization reads
//! `requested_exports` to see what's already been requested. No graph scan needed.

const BundleV2 = @import("./bundle_v2.zig").BundleV2;
const ParseTask = @import("./ParseTask.zig").ParseTask;
const Output = bun.Output;
const log = Output.scoped(.barrel, .hidden);

pub const RequestedExports = union(enum) {
    all,
    partial: std.StringArrayHashMapUnmanaged(void),
};

const BarrelExportResolution = struct {
    import_record_index: u32,
    /// The original alias in the source module (e.g. "d" for `export { d as c }`)
    original_alias: ?[]const u8,
};

/// Look up an export name → import_record_index by chasing
/// named_exports[alias].ref through named_imports.
/// Also returns the original alias from the source module for BFS propagation.
fn resolveBarrelExport(alias: []const u8, named_exports: JSAst.NamedExports, named_imports: JSAst.NamedImports) ?BarrelExportResolution {
    const export_entry = named_exports.get(alias) orelse return null;
    const import_entry = named_imports.get(export_entry.ref) orelse return null;
    return .{ .import_record_index = import_entry.import_record_index, .original_alias = import_entry.alias };
}

/// Analyze a parsed file to determine if it's a barrel and mark unneeded
/// import records as is_unused so they won't be resolved. Runs BEFORE resolution.
///
/// A file qualifies as a barrel if:
/// 1. It has `sideEffects: false` or is in `optimize_imports`, AND
/// 2. All named exports are re-exports (no local definitions), AND
/// 3. It is not an export star target of another barrel.
///
/// Export * records are never deferred (always resolved) to avoid circular races.
pub fn applyBarrelOptimization(this: *BundleV2, parse_result: *ParseTask.Result) void {
    applyBarrelOptimizationImpl(this, parse_result) catch bun.outOfMemory();
}

fn applyBarrelOptimizationImpl(this: *BundleV2, parse_result: *ParseTask.Result) !void {
    const result = &parse_result.value.success;
    const ast = &result.ast;
    const source_index = result.source.index.get();

    const is_explicit = if (this.transpiler.options.optimize_imports) |oi| oi.map.contains(result.package_name) else false;
    const is_side_effects_false = result.side_effects == .no_side_effects__package_json;
    if (!is_explicit and !is_side_effects_false) return;
    if (ast.import_records.len == 0) return;
    if (ast.named_exports.count() == 0 and ast.export_star_import_records.len == 0) return;

    const named_exports = ast.named_exports;
    const named_imports = ast.named_imports;

    // Verify pure barrel: all named exports must be re-exports
    var export_iter = named_exports.iterator();
    while (export_iter.next()) |entry| {
        if (named_imports.get(entry.value_ptr.ref) == null) return;
    }

    // If this barrel is a star target of another barrel, can't safely defer
    if (this.graph.input_files.items(.flags)[source_index].is_export_star_target) return;

    // Check requested_exports to see which exports were already requested by
    // files parsed before this barrel. scheduleBarrelDeferredImports records
    // requests eagerly as each file is processed, so we don't need to scan
    // the graph.
    if (this.requested_exports.get(source_index)) |existing| {
        switch (existing) {
            .all => return, // import * already seen — load everything
            .partial => {},
        }
    }

    // Build the set of needed import_record_indices from already-requested
    // export names. Export * records are always needed.
    var needed_records_stack = std.heap.stackFallback(8192, this.allocator());
    const needed_records_alloc = needed_records_stack.get();
    var needed_records = std.AutoArrayHashMapUnmanaged(u32, void){};
    defer needed_records.deinit(needed_records_alloc);

    for (ast.export_star_import_records) |record_idx| {
        try needed_records.put(needed_records_alloc, record_idx, {});
    }

    if (this.requested_exports.get(source_index)) |existing| {
        switch (existing) {
            .all => unreachable, // handled above
            .partial => |partial| {
                var partial_iter = partial.iterator();
                while (partial_iter.next()) |p_entry| {
                    if (resolveBarrelExport(p_entry.key_ptr.*, named_exports, named_imports)) |resolution| {
                        try needed_records.put(needed_records_alloc, resolution.import_record_index, {});
                    }
                }
            },
        }
    }

    // Mark unneeded named re-export records as is_unused.
    var has_deferrals = false;
    export_iter = named_exports.iterator();
    while (export_iter.next()) |entry| {
        if (named_imports.get(entry.value_ptr.ref)) |imp| {
            if (!needed_records.contains(imp.import_record_index)) {
                if (imp.import_record_index < ast.import_records.len) {
                    ast.import_records.slice()[imp.import_record_index].flags.is_unused = true;
                    has_deferrals = true;
                }
            }
        }
    }

    if (has_deferrals) {
        log("barrel detected: {s} (source={d}, {d} deferred)", .{
            if (result.package_name.len > 0) result.package_name else result.source.path.text,
            source_index,
            named_exports.count() - needed_records.count(),
        });

        // Merge with existing entry (keep already-requested names) or create new
        const gop = try this.requested_exports.getOrPut(this.allocator(), source_index);
        if (!gop.found_existing) {
            gop.value_ptr.* = .{ .partial = .{} };
        }
    }
}

/// Clear is_unused on a deferred barrel record. Returns true if the record was un-deferred.
fn unDeferRecord(import_records: *ImportRecord.List, record_idx: u32) bool {
    if (record_idx >= import_records.len) return false;
    const rec = &import_records.slice()[record_idx];
    if (rec.flags.is_internal or !rec.flags.is_unused) return false;
    rec.flags.is_unused = false;
    return true;
}

/// BFS work queue item: un-defer an export from a barrel.
const BarrelWorkItem = struct { barrel_source_index: u32, alias: []const u8, is_star: bool };

/// Resolve, process, and patch import records for a single barrel.
/// Used to inline-resolve deferred records whose source_index is still invalid.
fn resolveBarrelRecords(this: *BundleV2, barrel_idx: u32, barrels_to_resolve: *std.AutoArrayHashMapUnmanaged(u32, void)) i32 {
    const graph_ast = this.graph.ast.slice();
    const barrel_ir = &graph_ast.items(.import_records)[barrel_idx];
    const target = graph_ast.items(.target)[barrel_idx];
    var resolve_result = this.resolveImportRecords(.{
        .import_records = barrel_ir,
        .source = &this.graph.input_files.items(.source)[barrel_idx],
        .loader = this.graph.input_files.items(.loader)[barrel_idx],
        .target = target,
    });
    defer resolve_result.resolve_queue.deinit();
    const scheduled = this.processResolveQueue(resolve_result.resolve_queue, target, barrel_idx);
    this.patchImportRecordSourceIndices(barrel_ir, .{
        .source_index = Index.init(barrel_idx),
        .source_path = this.graph.input_files.items(.source)[barrel_idx].path.text,
        .loader = this.graph.input_files.items(.loader)[barrel_idx],
        .target = target,
        .force_save = true,
    });
    _ = barrels_to_resolve.swapRemove(barrel_idx);
    return scheduled;
}

/// After a new file's import records are patched with source_indices,
/// record what this file requests from each target in requested_exports
/// (eagerly, before barrels are known), then BFS through barrel chains
/// to un-defer needed records. Un-deferred records are re-resolved through
/// resolveImportRecords (same path as initial resolution).
/// Returns the number of newly scheduled parse tasks.
pub fn scheduleBarrelDeferredImports(this: *BundleV2, result: *ParseTask.Result.Success) !i32 {
    const file_import_records = result.ast.import_records;

    // Phase 1: Seed — eagerly record what this file requests from each target.
    // This runs for every file, even before any barrels are known. When a barrel
    // is later parsed, applyBarrelOptimization reads these pre-recorded requests
    // to decide which exports to keep. O(file's imports) per file.
    var ni_iter = result.ast.named_imports.iterator();
    while (ni_iter.next()) |ni_entry| {
        const ni = ni_entry.value_ptr;
        if (ni.import_record_index >= file_import_records.len) continue;
        const ir = file_import_records.slice()[ni.import_record_index];
        if (!ir.source_index.isValid()) continue;
        const target = ir.source_index.get();

        const gop = try this.requested_exports.getOrPut(this.allocator(), target);
        if (ni.alias_is_star) {
            gop.value_ptr.* = .all;
        } else if (ni.alias) |alias| {
            if (gop.found_existing) {
                switch (gop.value_ptr.*) {
                    .all => {},
                    .partial => |*p| try p.put(this.allocator(), alias, {}),
                }
            } else {
                gop.value_ptr.* = .{ .partial = .{} };
                try gop.value_ptr.partial.put(this.allocator(), alias, {});
            }
        } else if (!gop.found_existing) {
            gop.value_ptr.* = .{ .partial = .{} };
        }
    }

    // Phase 2: BFS — un-defer barrel records that are now needed.
    // Build work queue from this file's named_imports, then propagate
    // through chains of barrels. Only runs real work when barrels exist
    // (targets with deferred records).
    var queue_stack = std.heap.stackFallback(8192, this.allocator());
    const queue_alloc = queue_stack.get();
    var queue = std.ArrayListUnmanaged(BarrelWorkItem){};
    defer queue.deinit(queue_alloc);

    ni_iter = result.ast.named_imports.iterator();
    while (ni_iter.next()) |ni_entry| {
        const ni = ni_entry.value_ptr;
        if (ni.import_record_index >= file_import_records.len) continue;
        const ir = file_import_records.slice()[ni.import_record_index];
        if (!ir.source_index.isValid()) continue;

        if (ni.alias_is_star) {
            try queue.append(queue_alloc, .{ .barrel_source_index = ir.source_index.get(), .alias = "", .is_star = true });
        } else if (ni.alias) |alias| {
            try queue.append(queue_alloc, .{ .barrel_source_index = ir.source_index.get(), .alias = alias, .is_star = false });
        }
    }

    // Also seed the BFS with exports previously requested from THIS file
    // that couldn't propagate because this file wasn't parsed yet.
    // This handles the case where file A requests export "d" from file B,
    // but B hadn't been parsed when A's BFS ran, so B's export * records
    // were empty and the propagation stopped.
    const this_source_index = result.source.index.get();
    if (this.requested_exports.get(this_source_index)) |existing| {
        switch (existing) {
            .all => try queue.append(queue_alloc, .{ .barrel_source_index = this_source_index, .alias = "", .is_star = true }),
            .partial => |partial| {
                var partial_iter = partial.iterator();
                while (partial_iter.next()) |p_entry| {
                    try queue.append(queue_alloc, .{ .barrel_source_index = this_source_index, .alias = p_entry.key_ptr.*, .is_star = false });
                }
            },
        }
    }

    if (queue.items.len == 0) return 0;

    // Items [0, initial_queue_len) are from this file's imports and were
    // already recorded in requested_exports during seeding (phase 1).
    // Skip dedup for them so un-deferral proceeds correctly.
    // Items added during BFS propagation (>= initial_queue_len) use normal
    // dedup via requested_exports to prevent cycles.
    const initial_queue_len = queue.items.len;

    var barrels_to_resolve = std.AutoArrayHashMapUnmanaged(u32, void){};
    var barrels_to_resolve_stack = std.heap.stackFallback(1024, this.allocator());
    const barrels_to_resolve_alloc = barrels_to_resolve_stack.get();
    defer barrels_to_resolve.deinit(barrels_to_resolve_alloc);

    var newly_scheduled: i32 = 0;
    var qi: usize = 0;
    while (qi < queue.items.len) : (qi += 1) {
        const item = queue.items[qi];
        const barrel_idx = item.barrel_source_index;

        // For BFS-propagated items (not from initial queue), use
        // requested_exports for dedup and cycle detection.
        if (qi >= initial_queue_len) {
            const gop = try this.requested_exports.getOrPut(this.allocator(), barrel_idx);
            if (item.is_star) {
                gop.value_ptr.* = .all;
            } else if (gop.found_existing) {
                switch (gop.value_ptr.*) {
                    .all => continue,
                    .partial => |*p| {
                        const alias_gop = try p.getOrPut(this.allocator(), item.alias);
                        if (alias_gop.found_existing) continue;
                    },
                }
            } else {
                gop.value_ptr.* = .{ .partial = .{} };
                try gop.value_ptr.partial.put(this.allocator(), item.alias, {});
            }
        }

        const graph_ast = this.graph.ast.slice();
        if (barrel_idx >= graph_ast.len) continue;
        const barrel_ir = &graph_ast.items(.import_records)[barrel_idx];

        if (item.is_star) {
            for (barrel_ir.slice(), 0..) |rec, idx| {
                if (rec.flags.is_unused and !rec.flags.is_internal) {
                    if (unDeferRecord(barrel_ir, @intCast(idx))) {
                        try barrels_to_resolve.put(barrels_to_resolve_alloc, barrel_idx, {});
                    }
                }
            }
            continue;
        }

        const alias = item.alias;
        const resolution = resolveBarrelExport(alias, graph_ast.items(.named_exports)[barrel_idx], graph_ast.items(.named_imports)[barrel_idx]) orelse {
            // Name not in named re-exports — might come from export *.
            for (graph_ast.items(.export_star_import_records)[barrel_idx]) |star_idx| {
                if (star_idx >= barrel_ir.len) continue;
                if (unDeferRecord(barrel_ir, star_idx)) {
                    try barrels_to_resolve.put(barrels_to_resolve_alloc, barrel_idx, {});
                }
                var star_rec = barrel_ir.slice()[star_idx];
                if (!star_rec.source_index.isValid()) {
                    // Deferred record was never resolved — resolve inline now.
                    newly_scheduled += resolveBarrelRecords(this, barrel_idx, &barrels_to_resolve);
                    // Re-derive pointer after resolution may have mutated slices.
                    star_rec = this.graph.ast.slice().items(.import_records)[barrel_idx].slice()[star_idx];
                }
                if (star_rec.source_index.isValid()) {
                    try queue.append(queue_alloc, .{ .barrel_source_index = star_rec.source_index.get(), .alias = alias, .is_star = false });
                }
            }
            continue;
        };

        if (unDeferRecord(barrel_ir, resolution.import_record_index)) {
            try barrels_to_resolve.put(barrels_to_resolve_alloc, barrel_idx, {});
        }

        const propagate_alias = resolution.original_alias orelse alias;
        if (resolution.import_record_index < barrel_ir.len) {
            var rec = barrel_ir.slice()[resolution.import_record_index];
            if (!rec.source_index.isValid()) {
                // Deferred record was never resolved — resolve inline now.
                newly_scheduled += resolveBarrelRecords(this, barrel_idx, &barrels_to_resolve);
                rec = this.graph.ast.slice().items(.import_records)[barrel_idx].slice()[resolution.import_record_index];
            }
            if (rec.source_index.isValid()) {
                try queue.append(queue_alloc, .{ .barrel_source_index = rec.source_index.get(), .alias = propagate_alias, .is_star = false });
            }
        }
    }

    // Re-resolve any remaining un-deferred records through the normal resolution path.
    while (barrels_to_resolve.count() > 0) {
        const barrel_source_index = barrels_to_resolve.keys()[0];
        newly_scheduled += resolveBarrelRecords(this, barrel_source_index, &barrels_to_resolve);
    }

    return newly_scheduled;
}

const bun = @import("bun");
const std = @import("std");
const Fs = @import("../fs.zig");
const Logger = @import("../logger.zig");
const ImportRecord = bun.ImportRecord;
const Index = bun.ast.Index;
const JSAst = bun.ast.BundledAst;
const js_ast = bun.ast;
