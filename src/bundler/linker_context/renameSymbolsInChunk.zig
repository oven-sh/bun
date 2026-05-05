/// TODO: investigate if we need to parallelize this function
/// esbuild does parallelize it.
pub fn renameSymbolsInChunk(
    c: *LinkerContext,
    allocator: std.mem.Allocator,
    chunk: *Chunk,
    files_in_order: []const u32,
) !renamer.Renamer {
    const trace = bun.perf.trace("Bundler.renameSymbolsInChunk");
    defer trace.end();
    const all_module_scopes = c.graph.ast.items(.module_scope);
    const all_flags: []const JSMeta.Flags = c.graph.meta.items(.flags);
    const all_parts: []const Part.List = c.graph.ast.items(.parts);
    const all_wrapper_refs: []const Ref = c.graph.ast.items(.wrapper_ref);
    const all_import_records: []const ImportRecord.List = c.graph.ast.items(.import_records);

    var reserved_names = try renamer.computeInitialReservedNames(allocator, c.options.output_format);
    for (files_in_order) |source_index| {
        renamer.computeReservedNamesForScope(&all_module_scopes[source_index], &c.graph.symbols, &reserved_names, allocator);
    }

    var sorted_imports_from_other_chunks: std.array_list.Managed(StableRef) = brk: {
        var list = std.array_list.Managed(StableRef).init(allocator);
        var count: u32 = 0;
        const imports_from_other_chunks = chunk.content.javascript.imports_from_other_chunks.values();
        for (imports_from_other_chunks) |item| {
            count += item.len;
        }

        list.ensureTotalCapacityPrecise(count) catch unreachable;
        list.items.len = count;
        var remain = list.items;
        const stable_source_indices = c.graph.stable_source_indices;
        for (imports_from_other_chunks) |item| {
            for (item.slice()) |ref| {
                remain[0] = StableRef{
                    .stable_source_index = stable_source_indices[ref.ref.sourceIndex()],
                    .ref = ref.ref,
                };
                remain = remain[1..];
            }
        }

        std.sort.pdq(StableRef, list.items, {}, StableRef.isLessThan);
        break :brk list;
    };
    defer sorted_imports_from_other_chunks.deinit();

    if (c.options.minify_identifiers) {
        const first_top_level_slots: js_ast.SlotCounts = brk: {
            var slots = js_ast.SlotCounts{};
            const nested_scope_slot_counts = c.graph.ast.items(.nested_scope_slot_counts);
            for (files_in_order) |i| {
                slots.unionMax(nested_scope_slot_counts[i]);
            }
            break :brk slots;
        };

        var minify_renamer = try MinifyRenamer.init(allocator, c.graph.symbols, first_top_level_slots, reserved_names);

        var top_level_symbols = renamer.StableSymbolCount.Array.init(allocator);
        defer top_level_symbols.deinit();

        var top_level_symbols_all = renamer.StableSymbolCount.Array.init(allocator);

        const stable_source_indices = c.graph.stable_source_indices;
        var freq = js_ast.CharFreq{
            .freqs = [_]i32{0} ** 64,
        };
        const ast_flags_list = c.graph.ast.items(.flags);

        var capacity = sorted_imports_from_other_chunks.items.len;
        {
            const char_freqs = c.graph.ast.items(.char_freq);

            for (files_in_order) |source_index| {
                if (ast_flags_list[source_index].has_char_freq) {
                    freq.include(char_freqs[source_index]);
                }
            }
        }

        const exports_ref_list = c.graph.ast.items(.exports_ref);
        const module_ref_list = c.graph.ast.items(.module_ref);
        const parts_list = c.graph.ast.items(.parts);

        for (files_in_order) |source_index| {
            const ast_flags = ast_flags_list[source_index];
            const uses_exports_ref = ast_flags.uses_exports_ref;
            const uses_module_ref = ast_flags.uses_module_ref;
            const exports_ref = exports_ref_list[source_index];
            const module_ref = module_ref_list[source_index];
            const parts = parts_list[source_index];

            top_level_symbols.clearRetainingCapacity();

            if (uses_exports_ref) {
                try minify_renamer.accumulateSymbolUseCount(&top_level_symbols, exports_ref, 1, stable_source_indices);
            }
            if (uses_module_ref) {
                try minify_renamer.accumulateSymbolUseCount(&top_level_symbols, module_ref, 1, stable_source_indices);
            }

            for (parts.slice()) |part| {
                if (!part.is_live) {
                    continue;
                }

                try minify_renamer.accumulateSymbolUseCounts(&top_level_symbols, part.symbol_uses, stable_source_indices);

                for (part.declared_symbols.refs()) |declared_ref| {
                    try minify_renamer.accumulateSymbolUseCount(&top_level_symbols, declared_ref, 1, stable_source_indices);
                }
            }

            std.sort.pdq(renamer.StableSymbolCount, top_level_symbols.items, {}, StableSymbolCount.lessThan);
            capacity += top_level_symbols.items.len;
            top_level_symbols_all.appendSlice(top_level_symbols.items) catch unreachable;
        }

        top_level_symbols.clearRetainingCapacity();
        for (sorted_imports_from_other_chunks.items) |stable_ref| {
            try minify_renamer.accumulateSymbolUseCount(&top_level_symbols, stable_ref.ref, 1, stable_source_indices);
        }
        top_level_symbols_all.appendSlice(top_level_symbols.items) catch unreachable;
        try minify_renamer.allocateTopLevelSymbolSlots(top_level_symbols_all);

        var minifier = freq.compile(allocator);
        try minify_renamer.assignNamesByFrequency(&minifier);

        return minify_renamer.toRenamer();
    }

    var r = try renamer.NumberRenamer.init(
        allocator,
        allocator,
        c.graph.symbols,
        reserved_names,
    );
    for (sorted_imports_from_other_chunks.items) |stable_ref| {
        r.addTopLevelSymbol(stable_ref.ref);
    }

    var sorted_ = std.array_list.Managed(u32).init(r.temp_allocator);
    var sorted = &sorted_;
    defer sorted.deinit();

    // Two passes are required so that every top-level symbol is registered in
    // `r.root` before any nested scope is visited. Without this, a local
    // binding in file/part N could collide-rename into a name that is later
    // claimed by a top-level symbol in file/part M (M > N), silently shadowing
    // it in the output. See https://github.com/oven-sh/bun/issues/30269.
    //
    // Pass 1 adds all top-level symbols for the chunk (across every file).
    // Pass 2 recurses into the nested scopes; by then `r.root` is fully
    // populated so `findUnusedName` sees every potential top-level collision.
    //
    // `nested_scopes` stores the scopes to walk in pass 2, one entry per file
    // in the same order as `files_in_order`. For ESM/no-wrap the entry is the
    // concatenation of `part.scopes` for every live part. For CJS-wrapped
    // files the entry is the single module scope (the whole module body lives
    // inside the wrapper closure, so it's all "nested").
    var nested_scopes: std.array_list.Managed([]const *js_ast.Scope) = try .initCapacity(r.temp_allocator, files_in_order.len);
    defer nested_scopes.deinit();

    // Scratch buffer reused across files to accumulate `part.scopes`.
    var scopes_scratch = std.array_list.Managed(*js_ast.Scope).init(r.temp_allocator);
    defer scopes_scratch.deinit();

    // Pass 1: add all top-level symbols across the whole chunk, and stash the
    // nested scopes that pass 2 will visit.
    for (files_in_order) |source_index| {
        const wrap = all_flags[source_index].wrap;
        const parts: []const Part = all_parts[source_index].slice();

        switch (wrap) {
            // Modules wrapped in a CommonJS closure look like this:
            //
            //   // foo.js
            //   var require_foo = __commonJS((exports, module) => {
            //     exports.foo = 123;
            //   });
            //
            // The symbol "require_foo" is stored in "file.ast.WrapperRef". We want
            // to be able to minify everything inside the closure without worrying
            // about collisions with other CommonJS modules. Set up the scopes such
            // that it appears as if the file was structured this way all along. It's
            // not completely accurate (e.g. we don't set the parent of the module
            // scope to this new top-level scope) but it's good enough for the
            // renaming code.
            .cjs => {
                r.addTopLevelSymbol(all_wrapper_refs[source_index]);

                // External import statements will be hoisted outside of the CommonJS
                // wrapper if the output format supports import statements. We need to
                // add those symbols to the top-level scope to avoid causing name
                // collisions. This code special-cases only those symbols.
                if (c.options.output_format.keepES6ImportExportSyntax()) {
                    const import_records = all_import_records[source_index].slice();
                    for (parts) |*part| {
                        for (part.stmts) |stmt| {
                            switch (stmt.data) {
                                .s_import => |import| {
                                    if (!import_records[import.import_record_index].source_index.isValid()) {
                                        r.addTopLevelSymbol(import.namespace_ref);
                                        if (import.default_name) |default_name| {
                                            if (default_name.ref) |ref| {
                                                r.addTopLevelSymbol(ref);
                                            }
                                        }

                                        for (import.items) |*item| {
                                            if (item.name.ref) |ref| {
                                                r.addTopLevelSymbol(ref);
                                            }
                                        }
                                    }
                                },
                                .s_export_star => |export_| {
                                    if (!import_records[export_.import_record_index].source_index.isValid()) {
                                        r.addTopLevelSymbol(export_.namespace_ref);
                                    }
                                },
                                .s_export_from => |export_| {
                                    if (!import_records[export_.import_record_index].source_index.isValid()) {
                                        r.addTopLevelSymbol(export_.namespace_ref);

                                        for (export_.items) |*item| {
                                            if (item.name.ref) |ref| {
                                                r.addTopLevelSymbol(ref);
                                            }
                                        }
                                    }
                                },
                                else => {},
                            }
                        }
                    }
                }

                // Pass 2 will walk the module scope itself (the module body is
                // inside the CJS wrapper closure, so everything in it is nested
                // from the renamer's point of view).
                const one = try r.temp_allocator.alloc(*js_ast.Scope, 1);
                one[0] = &all_module_scopes[source_index];
                nested_scopes.appendAssumeCapacity(one);
                continue;
            },

            // Modules wrapped in an ESM closure look like this:
            //
            //   // foo.js
            //   var foo, foo_exports = {};
            //   __export(foo_exports, {
            //     foo: () => foo
            //   });
            //   let init_foo = __esm(() => {
            //     foo = 123;
            //   });
            //
            // The symbol "init_foo" is stored in "file.ast.WrapperRef". We need to
            // minify everything inside the closure without introducing a new scope
            // since all top-level variables will be hoisted outside of the closure.
            .esm => {
                r.addTopLevelSymbol(all_wrapper_refs[source_index]);
            },

            else => {},
        }

        scopes_scratch.clearRetainingCapacity();
        for (parts) |*part| {
            if (!part.is_live) continue;

            r.addTopLevelDeclaredSymbols(part.declared_symbols);
            try scopes_scratch.appendSlice(part.scopes);
        }

        const stashed = try r.temp_allocator.dupe(*js_ast.Scope, scopes_scratch.items);
        nested_scopes.appendAssumeCapacity(stashed);
    }

    // Pass 2: now that `r.root` has every top-level symbol in the chunk,
    // recurse into each file's nested scopes to rename collisions.
    for (files_in_order, nested_scopes.items) |source_index, scopes| {
        for (scopes) |scope| {
            r.assignNamesRecursiveWithNumberScope(&r.root, scope, source_index, sorted);
        }
        // Bulk-release every NumberScope we borrowed from the pool while
        // processing this file. The recursive walk has already put each scope
        // back individually; this is just a defensive reset that matches the
        // previous per-part behavior.
        r.number_scope_pool.hive.used = @TypeOf(r.number_scope_pool.hive.used).initEmpty();
    }

    return r.toRenamer();
}

pub const DeferredBatchTask = bun.bundle_v2.DeferredBatchTask;
pub const ThreadPool = bun.bundle_v2.ThreadPool;
pub const ParseTask = bun.bundle_v2.ParseTask;

const std = @import("std");

const bun = @import("bun");
const ImportRecord = bun.ImportRecord;

const js_ast = bun.ast;
const Part = js_ast.Part;

const bundler = bun.bundle_v2;
const Chunk = bundler.Chunk;
const JSMeta = bundler.JSMeta;
const LinkerContext = bun.bundle_v2.LinkerContext;
const Ref = bun.bundle_v2.Ref;
const StableRef = bundler.StableRef;

const renamer = bun.renamer;
const MinifyRenamer = renamer.MinifyRenamer;
const StableSymbolCount = renamer.StableSymbolCount;
