/// Deduplicate external imports across files within a chunk.
/// When multiple files import from the same external module (e.g., "react/jsx-runtime"),
/// this pass merges the symbol refs so they all point to a canonical symbol.
/// The first import statement for each path is augmented to include all imports,
/// and subsequent import statements are removed.
///
/// Before:
///   // a.js
///   import { jsxDEV } from "react/jsx-dev-runtime";
///   var X = () => jsxDEV("div", ...);
///
///   // index.js
///   import { jsxDEV as jsxDEV2, Fragment } from "react/jsx-dev-runtime";
///   var HelloWorld = () => jsxDEV2(Fragment, ...);
///
/// After:
///   // a.js
///   import { jsxDEV, Fragment } from "react/jsx-dev-runtime";
///   var X = () => jsxDEV("div", ...);
///
///   // index.js
///   var HelloWorld = () => jsxDEV(Fragment, ...);
pub fn deduplicateExternalImports(c: *LinkerContext, chunks: []Chunk) void {
    const trace = bun.perf.trace("Bundler.deduplicateExternalImports");
    defer trace.end();

    if (!c.options.output_format.keepES6ImportExportSyntax()) {
        // Only relevant for ESM output where import statements are preserved
        return;
    }

    const all_import_records = c.graph.ast.items(.import_records);
    const all_parts = c.graph.ast.items(.parts);

    for (chunks) |*chunk| {
        if (chunk.content != .javascript) continue;

        const js_chunk = &chunk.content.javascript;
        const files_in_order = js_chunk.files_in_chunk_order;

        if (files_in_order.len <= 1) continue; // No deduplication needed for single file

        // Map from (external path, import name) to canonical ref
        // Key format: "path\x00name" (null-separated)
        var canonical_refs = std.StringHashMap(CanonicalImport).init(c.allocator());
        defer canonical_refs.deinit();

        // Track the first import statement for each path
        var canonical_imports_by_path = std.StringHashMap(CanonicalPathImport).init(c.allocator());
        defer canonical_imports_by_path.deinit();

        // First pass: collect all external imports and establish canonical refs
        for (files_in_order) |source_index| {
            const import_records = all_import_records[source_index].slice();
            const parts = all_parts[source_index].slice();

            for (parts) |part| {
                for (part.stmts) |stmt| {
                    if (stmt.data != .s_import) continue;
                    const s_import = stmt.data.s_import;

                    const record_idx = s_import.import_record_index;
                    if (record_idx >= import_records.len) continue;

                    const record = &import_records[record_idx];

                    // Only process external ES imports
                    if (record.source_index.isValid()) continue; // Not external
                    if (record.kind != .stmt) continue; // Only static imports
                    if (record.path.is_disabled) continue;

                    const path = record.path.text;
                    const record_key = (@as(u64, source_index) << 32) | @as(u64, record_idx);

                    // Track if this is the first import record for this path
                    const path_gop = canonical_imports_by_path.getOrPut(path) catch continue;
                    const is_canonical_record_for_path = !path_gop.found_existing;
                    if (is_canonical_record_for_path) {
                        path_gop.value_ptr.* = .{
                            .source_index = source_index,
                            .import_record_index = record_idx,
                            .s_import = s_import,
                        };
                    }

                    // Process each named import item
                    for (s_import.items) |item| {
                        const import_name = item.alias;
                        if (import_name.len == 0) continue;

                        const ref = item.name.ref orelse continue;

                        // Create lookup key: "path\x00import_name"
                        const key = makeKey(c.allocator(), path, import_name) catch continue;

                        const gop = canonical_refs.getOrPut(key) catch continue;
                        if (!gop.found_existing) {
                            // First occurrence - this becomes the canonical ref
                            gop.value_ptr.* = .{
                                .canonical_ref = ref,
                                .alias = import_name,
                            };
                        } else {
                            // Subsequent occurrence - merge to canonical ref
                            const canonical = gop.value_ptr.canonical_ref;
                            if (!ref.eql(canonical)) {
                                _ = c.graph.symbols.merge(ref, canonical);
                            }
                        }
                    }

                    // Handle default import
                    if (s_import.default_name) |default_name| {
                        if (default_name.ref) |ref| {
                            const key = makeKey(c.allocator(), path, "default") catch continue;

                            const gop = canonical_refs.getOrPut(key) catch continue;
                            if (!gop.found_existing) {
                                gop.value_ptr.* = .{
                                    .canonical_ref = ref,
                                    .alias = "default",
                                };
                            } else {
                                const canonical = gop.value_ptr.canonical_ref;
                                if (!ref.eql(canonical)) {
                                    _ = c.graph.symbols.merge(ref, canonical);
                                }
                            }
                        }
                    }

                    // Handle namespace import (import * as ns)
                    if (record.flags.contains_import_star) {
                        const ns_ref = s_import.namespace_ref;
                        if (ns_ref.isValid()) {
                            const key = makeKey(c.allocator(), path, "*") catch continue;

                            const gop = canonical_refs.getOrPut(key) catch continue;
                            if (!gop.found_existing) {
                                gop.value_ptr.* = .{
                                    .canonical_ref = ns_ref,
                                    .alias = "*",
                                };
                            } else {
                                const canonical = gop.value_ptr.canonical_ref;
                                if (!ns_ref.eql(canonical)) {
                                    _ = c.graph.symbols.merge(ns_ref, canonical);
                                }
                            }
                        }
                    }

                    // Mark non-first import records for this path as duplicates (to be removed)
                    if (!is_canonical_record_for_path) {
                        js_chunk.deduplicated_external_import_records.put(c.allocator(), record_key, {}) catch continue;
                    }
                }
            }
        }

        // Second pass: augment the canonical import statements with any additional imports
        var iter = canonical_imports_by_path.iterator();
        while (iter.next()) |entry| {
            const path = entry.key_ptr.*;
            const canonical_import = entry.value_ptr.*;
            const s_import = canonical_import.s_import;

            // Find all unique imports for this path
            var unique_items = std.ArrayListUnmanaged(js_ast.ClauseItem){};
            var seen_names = std.StringHashMap(void).init(c.allocator());
            defer seen_names.deinit();

            // First, add existing items
            for (s_import.items) |item| {
                if (seen_names.contains(item.alias)) continue;
                seen_names.put(item.alias, {}) catch continue;
                unique_items.append(c.allocator(), item) catch continue;
            }

            // Then, add any additional items from other files
            var ref_iter = canonical_refs.iterator();
            while (ref_iter.next()) |ref_entry| {
                const key = ref_entry.key_ptr.*;
                const import_info = ref_entry.value_ptr.*;

                // Check if this key is for the current path
                const null_pos = std.mem.indexOfScalar(u8, key, 0) orelse continue;
                const key_path = key[0..null_pos];
                if (!std.mem.eql(u8, key_path, path)) continue;

                const alias = import_info.alias;
                if (std.mem.eql(u8, alias, "*") or std.mem.eql(u8, alias, "default")) continue;

                if (seen_names.contains(alias)) continue;
                seen_names.put(alias, {}) catch continue;

                unique_items.append(c.allocator(), .{
                    .name = .{
                        .ref = import_info.canonical_ref,
                        .loc = Logger.Loc.Empty,
                    },
                    .alias = alias,
                    .alias_loc = Logger.Loc.Empty,
                }) catch continue;
            }

            // Update the items if we have new ones
            if (unique_items.items.len > s_import.items.len) {
                s_import.items = unique_items.items;
            }
        }

        // Mark chunk as having deduplicated imports if any merging was done
        if (canonical_refs.count() > 0) {
            js_chunk.external_imports_deduplicated = true;
        }
    }
}

const CanonicalImport = struct {
    canonical_ref: Ref,
    alias: []const u8,
};

const CanonicalPathImport = struct {
    source_index: u32,
    import_record_index: u32,
    s_import: *js_ast.S.Import,
};

fn makeKey(allocator: std.mem.Allocator, path: []const u8, name: []const u8) ![]const u8 {
    const key = try allocator.alloc(u8, path.len + 1 + name.len);
    @memcpy(key[0..path.len], path);
    key[path.len] = 0;
    @memcpy(key[path.len + 1 ..], name);
    return key;
}

const std = @import("std");
const bun = @import("bun");
const Ref = bun.bundle_v2.Ref;
const js_ast = bun.ast;
const Logger = bun.logger;

const LinkerContext = bun.bundle_v2.LinkerContext;
const Chunk = bun.bundle_v2.Chunk;
