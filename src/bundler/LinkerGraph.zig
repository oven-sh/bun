pub const LinkerGraph = @This();

const debug = Output.scoped(.LinkerGraph, false);

files: File.List = .{},
files_live: BitSet = undefined,
entry_points: EntryPoint.List = .{},
symbols: js_ast.Symbol.Map = .{},

allocator: std.mem.Allocator,

code_splitting: bool = false,

// This is an alias from Graph
// it is not a clone!
ast: MultiArrayList(JSAst) = .{},
meta: MultiArrayList(JSMeta) = .{},

/// We should avoid traversing all files in the bundle, because the linker
/// should be able to run a linking operation on a large bundle where only
/// a few files are needed (e.g. an incremental compilation scenario). This
/// holds all files that could possibly be reached through the entry points.
/// If you need to iterate over all files in the linking operation, iterate
/// over this array. This array is also sorted in a deterministic ordering
/// to help ensure deterministic builds (source indices are random).
reachable_files: []Index = &[_]Index{},

/// Index from `.parse_graph.input_files` to index in `.files`
stable_source_indices: []const u32 = &[_]u32{},

is_scb_bitset: BitSet = .{},
has_client_components: bool = false,
has_server_components: bool = false,

/// This is for cross-module inlining of detected inlinable constants
// const_values: js_ast.Ast.ConstValuesMap = .{},
/// This is for cross-module inlining of TypeScript enum constants
ts_enums: js_ast.Ast.TsEnumsMap = .{},

pub fn init(allocator: std.mem.Allocator, file_count: usize) !LinkerGraph {
    return LinkerGraph{
        .allocator = allocator,
        .files_live = try BitSet.initEmpty(allocator, file_count),
    };
}

pub fn runtimeFunction(this: *const LinkerGraph, name: string) Ref {
    return this.ast.items(.named_exports)[Index.runtime.value].get(name).?.ref;
}

pub fn generateNewSymbol(this: *LinkerGraph, source_index: u32, kind: Symbol.Kind, original_name: string) Ref {
    const source_symbols = &this.symbols.symbols_for_source.slice()[source_index];

    var ref = Ref.init(
        @truncate(source_symbols.len),
        @truncate(source_index),
        false,
    );
    ref.tag = .symbol;

    // TODO: will this crash on resize due to using threadlocal mimalloc heap?
    source_symbols.push(
        this.allocator,
        .{
            .kind = kind,
            .original_name = original_name,
        },
    ) catch unreachable;

    this.ast.items(.module_scope)[source_index].generated.push(this.allocator, ref) catch unreachable;
    return ref;
}

pub fn generateRuntimeSymbolImportAndUse(
    graph: *LinkerGraph,
    source_index: Index.Int,
    entry_point_part_index: Index,
    name: []const u8,
    count: u32,
) !void {
    if (count == 0) return;
    debug("generateRuntimeSymbolImportAndUse({s}) for {d}", .{ name, source_index });

    const ref = graph.runtimeFunction(name);
    try graph.generateSymbolImportAndUse(
        source_index,
        entry_point_part_index.get(),
        ref,
        count,
        Index.runtime,
    );
}

pub fn addPartToFile(
    graph: *LinkerGraph,
    id: u32,
    part: Part,
) !u32 {
    var parts: *Part.List = &graph.ast.items(.parts)[id];
    const part_id = @as(u32, @truncate(parts.len));
    try parts.push(graph.allocator, part);
    var top_level_symbol_to_parts_overlay: ?*TopLevelSymbolToParts = null;

    const Iterator = struct {
        graph: *LinkerGraph,
        id: u32,
        top_level_symbol_to_parts_overlay: *?*TopLevelSymbolToParts,
        part_id: u32,

        pub fn next(self: *@This(), ref: Ref) void {
            var overlay = brk: {
                if (self.top_level_symbol_to_parts_overlay.*) |out| {
                    break :brk out;
                }

                const out = &self.graph.meta.items(.top_level_symbol_to_parts_overlay)[self.id];

                self.top_level_symbol_to_parts_overlay.* = out;
                break :brk out;
            };

            var entry = overlay.getOrPut(self.graph.allocator, ref) catch unreachable;
            if (!entry.found_existing) {
                if (self.graph.ast.items(.top_level_symbols_to_parts)[self.id].get(ref)) |original_parts| {
                    var list = std.ArrayList(u32).init(self.graph.allocator);
                    list.ensureTotalCapacityPrecise(original_parts.len + 1) catch unreachable;
                    list.appendSliceAssumeCapacity(original_parts.slice());
                    list.appendAssumeCapacity(self.part_id);

                    entry.value_ptr.* = .init(list.items);
                } else {
                    entry.value_ptr.* = BabyList(u32).fromSlice(self.graph.allocator, &.{self.part_id}) catch bun.outOfMemory();
                }
            } else {
                entry.value_ptr.push(self.graph.allocator, self.part_id) catch unreachable;
            }
        }
    };

    var ctx = Iterator{
        .graph = graph,
        .id = id,
        .part_id = part_id,
        .top_level_symbol_to_parts_overlay = &top_level_symbol_to_parts_overlay,
    };

    js_ast.DeclaredSymbol.forEachTopLevelSymbol(&parts.ptr[part_id].declared_symbols, &ctx, Iterator.next);

    return part_id;
}

pub fn generateSymbolImportAndUse(
    g: *LinkerGraph,
    source_index: u32,
    part_index: u32,
    ref: Ref,
    use_count: u32,
    source_index_to_import_from: Index,
) !void {
    if (use_count == 0) return;

    var parts_list = g.ast.items(.parts)[source_index].slice();
    var part: *Part = &parts_list[part_index];

    // Mark this symbol as used by this part

    var uses = &part.symbol_uses;
    var uses_entry = uses.getOrPut(g.allocator, ref) catch unreachable;

    if (!uses_entry.found_existing) {
        uses_entry.value_ptr.* = .{ .count_estimate = use_count };
    } else {
        uses_entry.value_ptr.count_estimate += use_count;
    }

    const exports_ref = g.ast.items(.exports_ref)[source_index];
    const module_ref = g.ast.items(.module_ref)[source_index];
    if (!exports_ref.isNull() and ref.eql(exports_ref)) {
        g.ast.items(.flags)[source_index].uses_exports_ref = true;
    }

    if (!module_ref.isNull() and ref.eql(module_ref)) {
        g.ast.items(.flags)[source_index].uses_module_ref = true;
    }

    // null ref shouldn't be there.
    bun.assert(!ref.isEmpty());

    // Track that this specific symbol was imported
    if (source_index_to_import_from.get() != source_index) {
        const imports_to_bind = &g.meta.items(.imports_to_bind)[source_index];
        try imports_to_bind.put(g.allocator, ref, .{
            .data = .{
                .source_index = source_index_to_import_from,
                .import_ref = ref,
            },
        });
    }

    // Pull in all parts that declare this symbol
    var dependencies = &part.dependencies;
    const part_ids = g.topLevelSymbolToParts(source_index_to_import_from.get(), ref);
    const new_dependencies = try dependencies.writableSlice(g.allocator, part_ids.len);
    for (part_ids, new_dependencies) |part_id, *dependency| {
        dependency.* = .{
            .source_index = source_index_to_import_from,
            .part_index = @as(u32, @truncate(part_id)),
        };
    }
}

pub fn topLevelSymbolToParts(g: *LinkerGraph, id: u32, ref: Ref) []u32 {
    if (g.meta.items(.top_level_symbol_to_parts_overlay)[id].get(ref)) |overlay| {
        return overlay.slice();
    }

    if (g.ast.items(.top_level_symbols_to_parts)[id].get(ref)) |list| {
        return list.slice();
    }

    return &.{};
}

pub fn load(
    this: *LinkerGraph,
    entry_points: []const Index,
    sources: []const Logger.Source,
    server_component_boundaries: ServerComponentBoundary.List,
    dynamic_import_entry_points: []const Index.Int,
) !void {
    const scb = server_component_boundaries.slice();
    try this.files.setCapacity(this.allocator, sources.len);
    this.files.zero();
    this.files_live = try BitSet.initEmpty(
        this.allocator,
        sources.len,
    );
    this.files.len = sources.len;
    var files = this.files.slice();

    var entry_point_kinds = files.items(.entry_point_kind);
    {
        const kinds = std.mem.sliceAsBytes(entry_point_kinds);
        @memset(kinds, 0);
    }

    // Setup entry points
    {
        try this.entry_points.setCapacity(this.allocator, entry_points.len + server_component_boundaries.list.len + dynamic_import_entry_points.len);
        this.entry_points.len = entry_points.len;
        const source_indices = this.entry_points.items(.source_index);

        const path_strings: []bun.PathString = this.entry_points.items(.output_path);
        {
            const output_was_auto_generated = std.mem.sliceAsBytes(this.entry_points.items(.output_path_was_auto_generated));
            @memset(output_was_auto_generated, 0);
        }

        for (entry_points, path_strings, source_indices) |i, *path_string, *source_index| {
            const source = sources[i.get()];
            if (comptime Environment.allow_assert) {
                bun.assert(source.index.get() == i.get());
            }
            entry_point_kinds[source.index.get()] = EntryPoint.Kind.user_specified;
            path_string.* = bun.PathString.init(source.path.text);
            source_index.* = source.index.get();
        }

        for (dynamic_import_entry_points) |id| {
            bun.assert(this.code_splitting); // this should never be a thing without code splitting

            if (entry_point_kinds[id] != .none) {
                // You could dynamic import a file that is already an entry point
                continue;
            }

            const source = &sources[id];
            entry_point_kinds[id] = EntryPoint.Kind.dynamic_import;

            this.entry_points.appendAssumeCapacity(.{
                .source_index = id,
                .output_path = bun.PathString.init(source.path.text),
                .output_path_was_auto_generated = true,
            });
        }

        var import_records_list: []ImportRecord.List = this.ast.items(.import_records);
        try this.meta.setCapacity(this.allocator, import_records_list.len);
        this.meta.len = this.ast.len;
        this.meta.zero();

        if (scb.list.len > 0) {
            this.is_scb_bitset = BitSet.initEmpty(this.allocator, this.files.len) catch unreachable;

            // Index all SCBs into the bitset. This is needed so chunking
            // can track the chunks that SCBs belong to.
            for (scb.list.items(.use_directive), scb.list.items(.source_index), scb.list.items(.reference_source_index)) |use, original_id, ref_id| {
                switch (use) {
                    .none => {},
                    .client => {
                        this.is_scb_bitset.set(original_id);
                        this.is_scb_bitset.set(ref_id);
                    },
                    .server => {
                        bun.todoPanic(@src(), "um", .{});
                    },
                }
            }

            // For client components, the import record index currently points to the original source index, instead of the reference source index.
            for (this.reachable_files) |source_id| {
                for (import_records_list[source_id.get()].slice()) |*import_record| {
                    if (import_record.source_index.isValid() and this.is_scb_bitset.isSet(import_record.source_index.get())) {
                        import_record.source_index = Index.init(
                            scb.getReferenceSourceIndex(import_record.source_index.get()) orelse
                                // If this gets hit, might be fine to switch this to `orelse continue`
                                // not confident in this assertion
                                Output.panic("Missing SCB boundary for file #{d}", .{import_record.source_index.get()}),
                        );
                        bun.assert(import_record.source_index.isValid()); // did not generate
                    }
                }
            }
        } else {
            this.is_scb_bitset = .{};
        }
    }

    // Setup files
    {
        var stable_source_indices = try this.allocator.alloc(Index, sources.len + 1);

        // set it to max value so that if we access an invalid one, it crashes
        @memset(std.mem.sliceAsBytes(stable_source_indices), 255);

        for (this.reachable_files, 0..) |source_index, i| {
            stable_source_indices[source_index.get()] = Index.source(i);
        }

        @memset(
            files.items(.distance_from_entry_point),
            (LinkerGraph.File{}).distance_from_entry_point,
        );
        this.stable_source_indices = @as([]const u32, @ptrCast(stable_source_indices));
    }

    {
        var input_symbols = js_ast.Symbol.Map.initList(js_ast.Symbol.NestedList.init(this.ast.items(.symbols)));
        var symbols = input_symbols.symbols_for_source.clone(this.allocator) catch bun.outOfMemory();
        for (symbols.slice(), input_symbols.symbols_for_source.slice()) |*dest, src| {
            dest.* = src.clone(this.allocator) catch bun.outOfMemory();
        }
        this.symbols = js_ast.Symbol.Map.initList(symbols);
    }

    // TODO: const_values
    // {
    //     var const_values = this.const_values;
    //     var count: usize = 0;

    //     for (this.ast.items(.const_values)) |const_value| {
    //         count += const_value.count();
    //     }

    //     if (count > 0) {
    //         try const_values.ensureTotalCapacity(this.allocator, count);
    //         for (this.ast.items(.const_values)) |const_value| {
    //             for (const_value.keys(), const_value.values()) |key, value| {
    //                 const_values.putAssumeCapacityNoClobber(key, value);
    //             }
    //         }
    //     }

    //     this.const_values = const_values;
    // }

    {
        var count: usize = 0;
        for (this.ast.items(.ts_enums)) |ts_enums| {
            count += ts_enums.count();
        }
        if (count > 0) {
            try this.ts_enums.ensureTotalCapacity(this.allocator, count);
            for (this.ast.items(.ts_enums)) |ts_enums| {
                for (ts_enums.keys(), ts_enums.values()) |key, value| {
                    this.ts_enums.putAssumeCapacityNoClobber(key, value);
                }
            }
        }
    }

    const src_named_exports: []js_ast.Ast.NamedExports = this.ast.items(.named_exports);
    const dest_resolved_exports: []ResolvedExports = this.meta.items(.resolved_exports);
    for (src_named_exports, dest_resolved_exports, 0..) |src, *dest, source_index| {
        var resolved = ResolvedExports{};
        resolved.ensureTotalCapacity(this.allocator, src.count()) catch unreachable;
        for (src.keys(), src.values()) |key, value| {
            resolved.putAssumeCapacityNoClobber(key, .{ .data = .{
                .import_ref = value.ref,
                .name_loc = value.alias_loc,
                .source_index = Index.source(source_index),
            } });
        }
        dest.* = resolved;
    }
}

pub const File = struct {
    entry_bits: AutoBitSet = undefined,

    input_file: Index = Index.source(0),

    /// The minimum number of links in the module graph to get from an entry point
    /// to this file
    distance_from_entry_point: u32 = std.math.maxInt(u32),

    /// This file is an entry point if and only if this is not ".none".
    /// Note that dynamically-imported files are allowed to also be specified by
    /// the user as top-level entry points, so some dynamically-imported files
    /// may be ".user_specified" instead of ".dynamic_import".
    entry_point_kind: EntryPoint.Kind = .none,

    /// If "entry_point_kind" is not ".none", this is the index of the
    /// corresponding entry point chunk.
    ///
    /// This is also initialized for files that are a SCB's generated
    /// reference, pointing to its destination. This forms a lookup map from
    /// a Source.Index to its output path inb reakOutputIntoPieces
    entry_point_chunk_index: u32 = std.math.maxInt(u32),

    line_offset_table: bun.sourcemap.LineOffsetTable.List = .empty,
    quoted_source_contents: string = "",

    pub fn isEntryPoint(this: *const File) bool {
        return this.entry_point_kind.isEntryPoint();
    }

    pub fn isUserSpecifiedEntryPoint(this: *const File) bool {
        return this.entry_point_kind.isUserSpecifiedEntryPoint();
    }

    pub const List = MultiArrayList(File);
};

const bun = @import("bun");
const Environment = bun.Environment;
const std = @import("std");
const string = bun.string;
const Output = bun.Output;
const BitSet = bun.bit_set.DynamicBitSetUnmanaged;
const BabyList = bun.BabyList;

const Logger = bun.bundle_v2.Logger;
const TopLevelSymbolToParts = bun.bundle_v2.TopLevelSymbolToParts;
const Index = bun.bundle_v2.Index;
const Part = bun.bundle_v2.Part;
const Ref = bun.bundle_v2.Ref;
const EntryPoint = bun.bundle_v2.EntryPoint;
const ServerComponentBoundary = bun.bundle_v2.ServerComponentBoundary;
const MultiArrayList = bun.MultiArrayList;
const JSAst = bun.bundle_v2.JSAst;
const JSMeta = bun.bundle_v2.JSMeta;
const js_ast = @import("../js_ast.zig");
const Symbol = @import("../js_ast.zig").Symbol;
const ImportRecord = bun.ImportRecord;
const ResolvedExports = bun.bundle_v2.ResolvedExports;
const AutoBitSet = bun.bit_set.AutoBitSet;
