/// CSS files are traversed in depth-first postorder just like JavaScript. But
/// unlike JavaScript import statements, CSS "@import" rules are evaluated every
/// time instead of just the first time.
///
///      A
///     / \
///    B   C
///     \ /
///      D
///
/// If A imports B and then C, B imports D, and C imports D, then the CSS
/// traversal order is D B D C A.
///
/// However, evaluating a CSS file multiple times is sort of equivalent to
/// evaluating it once at the last location. So we basically drop all but the
/// last evaluation in the order.
///
/// The only exception to this is "@layer". Evaluating a CSS file multiple
/// times is sort of equivalent to evaluating it once at the first location
/// as far as "@layer" is concerned. So we may in some cases keep both the
/// first and last locations and only write out the "@layer" information
/// for the first location.
pub fn findImportedFilesInCSSOrder(this: *LinkerContext, temp_allocator: std.mem.Allocator, entry_points: []const Index) BabyList(Chunk.CssImportOrder) {
    const Visitor = struct {
        allocator: std.mem.Allocator,
        temp_allocator: std.mem.Allocator,
        css_asts: []?*bun.css.BundlerStyleSheet,
        all_import_records: []const BabyList(ImportRecord),

        graph: *LinkerGraph,
        parse_graph: *Graph,

        has_external_import: bool = false,
        visited: BabyList(Index),
        order: BabyList(Chunk.CssImportOrder) = .{},

        pub fn visit(
            visitor: *@This(),
            source_index: Index,
            wrapping_conditions: *BabyList(bun.css.ImportConditions),
            wrapping_import_records: *BabyList(ImportRecord),
        ) void {
            debug(
                "Visit file: {d}={s}",
                .{ source_index.get(), visitor.parse_graph.input_files.items(.source)[source_index.get()].path.pretty },
            );
            // The CSS specification strangely does not describe what to do when there
            // is a cycle. So we are left with reverse-engineering the behavior from a
            // real browser. Here's what the WebKit code base has to say about this:
            //
            //   "Check for a cycle in our import chain. If we encounter a stylesheet
            //   in our parent chain with the same URL, then just bail."
            //
            // So that's what we do here. See "StyleRuleImport::requestStyleSheet()" in
            // WebKit for more information.
            for (visitor.visited.slice()) |visitedSourceIndex| {
                if (visitedSourceIndex.get() == source_index.get()) {
                    debug(
                        "Skip file: {d}={s}",
                        .{ source_index.get(), visitor.parse_graph.input_files.items(.source)[source_index.get()].path.pretty },
                    );
                    return;
                }
            }

            visitor.visited.push(
                visitor.temp_allocator,
                source_index,
            ) catch bun.outOfMemory();

            const repr: *const bun.css.BundlerStyleSheet = visitor.css_asts[source_index.get()] orelse return; // Sanity check
            const top_level_rules = &repr.rules;

            // TODO: should we even do this? @import rules have to be the first rules in the stylesheet, why even allow pre-import layers?
            // Any pre-import layers come first
            // if len(repr.AST.LayersPreImport) > 0 {
            //     order = append(order, cssImportOrder{
            //         kind:                   cssImportLayers,
            //         layers:                 repr.AST.LayersPreImport,
            //         conditions:             wrappingConditions,
            //         conditionImportRecords: wrappingImportRecords,
            //     })
            // }

            defer {
                _ = visitor.visited.pop();
            }

            // Iterate over the top-level "@import" rules
            var import_record_idx: usize = 0;
            for (top_level_rules.v.items) |*rule| {
                if (rule.* == .import) {
                    defer import_record_idx += 1;
                    const record = visitor.all_import_records[source_index.get()].at(import_record_idx);

                    // Follow internal dependencies
                    if (record.source_index.isValid()) {
                        // If this import has conditions, fork our state so that the entire
                        // imported stylesheet subtree is wrapped in all of the conditions
                        if (rule.import.hasConditions()) {
                            // Fork our state
                            var nested_conditions = wrapping_conditions.deepClone2(visitor.allocator);
                            var nested_import_records = wrapping_import_records.clone(visitor.allocator) catch bun.outOfMemory();

                            // Clone these import conditions and append them to the state
                            nested_conditions.push(visitor.allocator, rule.import.conditionsWithImportRecords(visitor.allocator, &nested_import_records)) catch bun.outOfMemory();
                            visitor.visit(record.source_index, &nested_conditions, wrapping_import_records);
                            continue;
                        }
                        visitor.visit(record.source_index, wrapping_conditions, wrapping_import_records);
                        continue;
                    }

                    // Record external depednencies
                    if (!record.is_internal) {
                        var all_conditions = wrapping_conditions.deepClone2(visitor.allocator);
                        var all_import_records = wrapping_import_records.clone(visitor.allocator) catch bun.outOfMemory();
                        // If this import has conditions, append it to the list of overall
                        // conditions for this external import. Note that an external import
                        // may actually have multiple sets of conditions that can't be
                        // merged. When this happens we need to generate a nested imported
                        // CSS file using a data URL.
                        if (rule.import.hasConditions()) {
                            all_conditions.push(visitor.allocator, rule.import.conditionsWithImportRecords(visitor.allocator, &all_import_records)) catch bun.outOfMemory();
                            visitor.order.push(
                                visitor.allocator,
                                Chunk.CssImportOrder{
                                    .kind = .{
                                        .external_path = record.path,
                                    },
                                    .conditions = all_conditions,
                                    .condition_import_records = all_import_records,
                                },
                            ) catch bun.outOfMemory();
                        } else {
                            visitor.order.push(
                                visitor.allocator,
                                Chunk.CssImportOrder{
                                    .kind = .{
                                        .external_path = record.path,
                                    },
                                    .conditions = wrapping_conditions.*,
                                    .condition_import_records = wrapping_import_records.*,
                                },
                            ) catch bun.outOfMemory();
                        }
                        debug(
                            "Push external: {d}={s}",
                            .{ source_index.get(), visitor.parse_graph.input_files.items(.source)[source_index.get()].path.pretty },
                        );
                        visitor.has_external_import = true;
                    }
                }
            }

            // Iterate over the "composes" directives. Note that the order doesn't
            // matter for these because the output order is explicitly undfened
            // in the specification.
            for (visitor.all_import_records[source_index.get()].sliceConst()) |*record| {
                if (record.kind == .composes and record.source_index.isValid()) {
                    visitor.visit(record.source_index, wrapping_conditions, wrapping_import_records);
                }
            }

            if (comptime bun.Environment.isDebug) {
                debug(
                    "Push file: {d}={s}",
                    .{ source_index.get(), visitor.parse_graph.input_files.items(.source)[source_index.get()].path.pretty },
                );
            }
            // Accumulate imports in depth-first postorder
            visitor.order.push(visitor.allocator, Chunk.CssImportOrder{
                .kind = .{ .source_index = source_index },
                .conditions = wrapping_conditions.*,
            }) catch bun.outOfMemory();
        }
    };

    var visitor = Visitor{
        .allocator = this.allocator,
        .temp_allocator = temp_allocator,
        .graph = &this.graph,
        .parse_graph = this.parse_graph,
        .visited = BabyList(Index).initCapacity(temp_allocator, 16) catch bun.outOfMemory(),
        .css_asts = this.graph.ast.items(.css),
        .all_import_records = this.graph.ast.items(.import_records),
    };
    var wrapping_conditions: BabyList(bun.css.ImportConditions) = .{};
    var wrapping_import_records: BabyList(ImportRecord) = .{};
    // Include all files reachable from any entry point
    for (entry_points) |entry_point| {
        visitor.visit(entry_point, &wrapping_conditions, &wrapping_import_records);
    }

    var order = visitor.order;
    var wip_order = BabyList(Chunk.CssImportOrder).initCapacity(temp_allocator, order.len) catch bun.outOfMemory();

    const css_asts: []const ?*bun.css.BundlerStyleSheet = this.graph.ast.items(.css);

    debugCssOrder(this, &order, .BEFORE_HOISTING);

    // CSS syntax unfortunately only allows "@import" rules at the top of the
    // file. This means we must hoist all external "@import" rules to the top of
    // the file when bundling, even though doing so will change the order of CSS
    // evaluation.
    if (visitor.has_external_import) {
        // Pass 1: Pull out leading "@layer" and external "@import" rules
        var is_at_layer_prefix = true;
        for (order.slice()) |*entry| {
            if ((entry.kind == .layers and is_at_layer_prefix) or entry.kind == .external_path) {
                wip_order.push(temp_allocator, entry.*) catch bun.outOfMemory();
            }
            if (entry.kind != .layers) {
                is_at_layer_prefix = false;
            }
        }

        // Pass 2: Append everything that we didn't pull out in pass 1
        is_at_layer_prefix = true;
        for (order.slice()) |*entry| {
            if ((entry.kind != .layers or !is_at_layer_prefix) and entry.kind != .external_path) {
                wip_order.push(temp_allocator, entry.*) catch bun.outOfMemory();
            }
            if (entry.kind != .layers) {
                is_at_layer_prefix = false;
            }
        }

        order.len = wip_order.len;
        @memcpy(order.slice(), wip_order.slice());
        wip_order.clearRetainingCapacity();
    }
    debugCssOrder(this, &order, .AFTER_HOISTING);

    // Next, optimize import order. If there are duplicate copies of an imported
    // file, replace all but the last copy with just the layers that are in that
    // file. This works because in CSS, the last instance of a declaration
    // overrides all previous instances of that declaration.
    {
        var source_index_duplicates = std.AutoArrayHashMap(u32, BabyList(u32)).init(temp_allocator);
        var external_path_duplicates = std.StringArrayHashMap(BabyList(u32)).init(temp_allocator);

        var i: u32 = visitor.order.len;
        next_backward: while (i != 0) {
            i -= 1;
            const entry = visitor.order.at(i);
            switch (entry.kind) {
                .source_index => |idx| {
                    const gop = source_index_duplicates.getOrPut(idx.get()) catch bun.outOfMemory();
                    if (!gop.found_existing) {
                        gop.value_ptr.* = BabyList(u32){};
                    }
                    for (gop.value_ptr.slice()) |j| {
                        if (isConditionalImportRedundant(&entry.conditions, &order.at(j).conditions)) {
                            // This import is redundant, but it might have @layer rules.
                            // So we should keep the @layer rules so that the cascade ordering of layers
                            // is preserved
                            order.mut(i).kind = .{
                                .layers = Chunk.CssImportOrder.Layers.borrow(&css_asts[idx.get()].?.layer_names),
                            };
                            continue :next_backward;
                        }
                    }
                    gop.value_ptr.push(temp_allocator, i) catch bun.outOfMemory();
                },
                .external_path => |p| {
                    const gop = external_path_duplicates.getOrPut(p.text) catch bun.outOfMemory();
                    if (!gop.found_existing) {
                        gop.value_ptr.* = BabyList(u32){};
                    }
                    for (gop.value_ptr.slice()) |j| {
                        if (isConditionalImportRedundant(&entry.conditions, &order.at(j).conditions)) {
                            // Don't remove duplicates entirely. The import conditions may
                            // still introduce layers to the layer order. Represent this as a
                            // file with an empty layer list.
                            order.mut(i).kind = .{
                                .layers = .{ .owned = .{} },
                            };
                            continue :next_backward;
                        }
                    }
                    gop.value_ptr.push(temp_allocator, i) catch bun.outOfMemory();
                },
                .layers => {},
            }
        }
    }
    debugCssOrder(this, &order, .AFTER_REMOVING_DUPLICATES);

    // Then optimize "@layer" rules by removing redundant ones. This loop goes
    // forward instead of backward because "@layer" takes effect at the first
    // copy instead of the last copy like other things in CSS.
    {
        const DuplicateEntry = struct {
            layers: []const bun.css.LayerName,
            indices: bun.BabyList(u32) = .{},
        };
        var layer_duplicates = bun.BabyList(DuplicateEntry){};

        next_forward: for (order.slice()) |*entry| {
            debugCssOrder(this, &wip_order, .WHILE_OPTIMIZING_REDUNDANT_LAYER_RULES);
            switch (entry.kind) {
                // Simplify the conditions since we know they only wrap "@layer"
                .layers => |*layers| {
                    // Truncate the conditions at the first anonymous layer
                    for (entry.conditions.slice(), 0..) |*condition_, i| {
                        const conditions: *bun.css.ImportConditions = condition_;
                        // The layer is anonymous if it's a "layer" token without any
                        // children instead of a "layer(...)" token with children:
                        //
                        //   /* entry.css */
                        //   @import "foo.css" layer;
                        //
                        //   /* foo.css */
                        //   @layer foo;
                        //
                        // We don't need to generate this (as far as I can tell):
                        //
                        //   @layer {
                        //     @layer foo;
                        //   }
                        //
                        if (conditions.hasAnonymousLayer()) {
                            entry.conditions.len = @intCast(i);
                            layers.replace(temp_allocator, .{});
                            break;
                        }
                    }

                    // If there are no layer names for this file, trim all conditions
                    // without layers because we know they have no effect.
                    //
                    // (They have no effect because this is a `.layer` import with no rules
                    //  and only layer declarations.)
                    //
                    //   /* entry.css */
                    //   @import "foo.css" layer(foo) supports(display: flex);
                    //
                    //   /* foo.css */
                    //   @import "empty.css" supports(display: grid);
                    //
                    // That would result in this:
                    //
                    //   @supports (display: flex) {
                    //     @layer foo {
                    //       @supports (display: grid) {}
                    //     }
                    //   }
                    //
                    // Here we can trim "supports(display: grid)" to generate this:
                    //
                    //   @supports (display: flex) {
                    //     @layer foo;
                    //   }
                    //
                    if (layers.inner().len == 0) {
                        var i: u32 = entry.conditions.len;
                        while (i != 0) {
                            i -= 1;
                            const condition = entry.conditions.at(i);
                            if (condition.layer != null) {
                                break;
                            }
                            entry.conditions.len = i;
                        }
                    }

                    // Remove unnecessary entries entirely
                    if (entry.conditions.len == 0 and layers.inner().len == 0) {
                        continue;
                    }
                },
                else => {},
            }

            // Omit redundant "@layer" rules with the same set of layer names. Note
            // that this tests all import order entries (not just layer ones) because
            // sometimes non-layer ones can make following layer ones redundant.
            // layers_post_import
            const layers_key: []const bun.css.LayerName = switch (entry.kind) {
                .source_index => css_asts[entry.kind.source_index.get()].?.layer_names.sliceConst(),
                .layers => entry.kind.layers.inner().sliceConst(),
                .external_path => &.{},
            };
            var index: usize = 0;
            while (index < layer_duplicates.len) : (index += 1) {
                const both_equal = both_equal: {
                    if (layers_key.len != layer_duplicates.at(index).layers.len) {
                        break :both_equal false;
                    }

                    for (layers_key, layer_duplicates.at(index).layers) |*a, *b| {
                        if (!a.eql(b)) {
                            break :both_equal false;
                        }
                    }

                    break :both_equal true;
                };

                if (both_equal) {
                    break;
                }
            }
            if (index == layer_duplicates.len) {
                // This is the first time we've seen this combination of layer names.
                // Allocate a new set of duplicate indices to track this combination.
                layer_duplicates.push(temp_allocator, DuplicateEntry{
                    .layers = layers_key,
                }) catch bun.outOfMemory();
            }
            var duplicates = layer_duplicates.at(index).indices.slice();
            var j = duplicates.len;
            while (j != 0) {
                j -= 1;
                const duplicate_index = duplicates[j];
                if (isConditionalImportRedundant(&entry.conditions, &wip_order.at(duplicate_index).conditions)) {
                    if (entry.kind != .layers) {
                        // If an empty layer is followed immediately by a full layer and
                        // everything else is identical, then we don't need to emit the
                        // empty layer. For example:
                        //
                        //   @media screen {
                        //     @supports (display: grid) {
                        //       @layer foo;
                        //     }
                        //   }
                        //   @media screen {
                        //     @supports (display: grid) {
                        //       @layer foo {
                        //         div {
                        //           color: red;
                        //         }
                        //       }
                        //     }
                        //   }
                        //
                        // This can be improved by dropping the empty layer. But we can
                        // only do this if there's nothing in between these two rules.
                        if (j == duplicates.len - 1 and duplicate_index == wip_order.len - 1) {
                            const other = wip_order.at(duplicate_index);
                            if (other.kind == .layers and importConditionsAreEqual(entry.conditions.sliceConst(), other.conditions.sliceConst())) {
                                // Remove the previous entry and then overwrite it below
                                duplicates = duplicates[0..j];
                                wip_order.len = duplicate_index;
                                break;
                            }
                        }

                        // Non-layer entries still need to be present because they have
                        // other side effects beside inserting things in the layer order
                        wip_order.push(temp_allocator, entry.*) catch bun.outOfMemory();
                    }

                    // Don't add this to the duplicate list below because it's redundant
                    continue :next_forward;
                }
            }

            layer_duplicates.mut(index).indices.push(
                temp_allocator,
                wip_order.len,
            ) catch bun.outOfMemory();
            wip_order.push(temp_allocator, entry.*) catch bun.outOfMemory();
        }

        debugCssOrder(this, &wip_order, .WHILE_OPTIMIZING_REDUNDANT_LAYER_RULES);

        order.len = wip_order.len;
        @memcpy(order.slice(), wip_order.slice());
        wip_order.clearRetainingCapacity();
    }
    debugCssOrder(this, &order, .AFTER_OPTIMIZING_REDUNDANT_LAYER_RULES);

    // Finally, merge adjacent "@layer" rules with identical conditions together.
    {
        var did_clone: i32 = -1;
        for (order.slice()) |*entry| {
            if (entry.kind == .layers and wip_order.len > 0) {
                const prev_index = wip_order.len - 1;
                const prev = wip_order.at(prev_index);
                if (prev.kind == .layers and importConditionsAreEqual(prev.conditions.sliceConst(), entry.conditions.sliceConst())) {
                    if (did_clone != prev_index) {
                        did_clone = @intCast(prev_index);
                    }
                    // need to clone the layers here as they could be references to css ast
                    wip_order.mut(prev_index).kind.layers.toOwned(temp_allocator).append(
                        temp_allocator,
                        entry.kind.layers.inner().sliceConst(),
                    ) catch bun.outOfMemory();
                }
            }
        }
    }
    debugCssOrder(this, &order, .AFTER_MERGING_ADJACENT_LAYER_RULES);

    return order;
}

fn importConditionsAreEqual(a: []const bun.css.ImportConditions, b: []const bun.css.ImportConditions) bool {
    if (a.len != b.len) {
        return false;
    }

    for (a, b) |*ai, *bi| {
        if (!ai.layersEql(bi) or !ai.supportsEql(bi) or !ai.media.eql(&bi.media)) return false;
    }

    return true;
}

/// Given two "@import" rules for the same source index (an earlier one and a
/// later one), the earlier one is masked by the later one if the later one's
/// condition list is a prefix of the earlier one's condition list.
///
/// For example:
///
///    // entry.css
///    @import "foo.css" supports(display: flex);
///    @import "bar.css" supports(display: flex);
///
///    // foo.css
///    @import "lib.css" screen;
///
///    // bar.css
///    @import "lib.css";
///
/// When we bundle this code we'll get an import order as follows:
///
///  1. lib.css [supports(display: flex), screen]
///  2. foo.css [supports(display: flex)]
///  3. lib.css [supports(display: flex)]
///  4. bar.css [supports(display: flex)]
///  5. entry.css []
///
/// For "lib.css", the entry with the conditions [supports(display: flex)] should
/// make the entry with the conditions [supports(display: flex), screen] redundant.
///
/// Note that all of this deliberately ignores the existence of "@layer" because
/// that is handled separately. All of this is only for handling unlayered styles.
pub fn isConditionalImportRedundant(earlier: *const BabyList(bun.css.ImportConditions), later: *const BabyList(bun.css.ImportConditions)) bool {
    if (later.len > earlier.len) return false;

    for (0..later.len) |i| {
        const a = earlier.at(i);
        const b = later.at(i);

        // Only compare "@supports" and "@media" if "@layers" is equal
        if (a.layersEql(b)) {
            const same_supports = a.supportsEql(b);
            const same_media = a.media.eql(&b.media);

            // If the import conditions are exactly equal, then only keep
            // the later one. The earlier one is redundant. Example:
            //
            //   @import "foo.css" layer(abc) supports(display: flex) screen;
            //   @import "foo.css" layer(abc) supports(display: flex) screen;
            //
            // The later one makes the earlier one redundant.
            if (same_supports and same_media) {
                continue;
            }

            // If the media conditions are exactly equal and the later one
            // doesn't have any supports conditions, then the later one will
            // apply in all cases where the earlier one applies. Example:
            //
            //   @import "foo.css" layer(abc) supports(display: flex) screen;
            //   @import "foo.css" layer(abc) screen;
            //
            // The later one makes the earlier one redundant.
            if (same_media and b.supports == null) {
                continue;
            }

            // If the supports conditions are exactly equal and the later one
            // doesn't have any media conditions, then the later one will
            // apply in all cases where the earlier one applies. Example:
            //
            //   @import "foo.css" layer(abc) supports(display: flex) screen;
            //   @import "foo.css" layer(abc) supports(display: flex);
            //
            // The later one makes the earlier one redundant.
            if (same_supports and b.media.media_queries.items.len == 0) {
                continue;
            }
        }

        return false;
    }

    return true;
}

const CssOrderDebugStep = enum {
    BEFORE_HOISTING,
    AFTER_HOISTING,
    AFTER_REMOVING_DUPLICATES,
    WHILE_OPTIMIZING_REDUNDANT_LAYER_RULES,
    AFTER_OPTIMIZING_REDUNDANT_LAYER_RULES,
    AFTER_MERGING_ADJACENT_LAYER_RULES,
};

fn debugCssOrder(this: *LinkerContext, order: *const BabyList(Chunk.CssImportOrder), comptime step: CssOrderDebugStep) void {
    if (comptime bun.Environment.isDebug) {
        const env_var = "BUN_DEBUG_CSS_ORDER_" ++ @tagName(step);
        const enable_all = bun.getenvTruthy("BUN_DEBUG_CSS_ORDER");
        if (enable_all or bun.getenvTruthy(env_var)) {
            debugCssOrderImpl(this, order, step);
        }
    }
}

fn debugCssOrderImpl(this: *LinkerContext, order: *const BabyList(Chunk.CssImportOrder), comptime step: CssOrderDebugStep) void {
    if (comptime bun.Environment.isDebug) {
        debug("CSS order {s}:\n", .{@tagName(step)});
        var arena = bun.ArenaAllocator.init(bun.default_allocator);
        defer arena.deinit();
        for (order.slice(), 0..) |entry, i| {
            const conditions_str = if (entry.conditions.len > 0) conditions_str: {
                var arrlist = std.ArrayListUnmanaged(u8){};
                const writer = arrlist.writer(arena.allocator());
                const W = @TypeOf(writer);
                arrlist.appendSlice(arena.allocator(), "[") catch unreachable;
                var symbols = Symbol.Map{};
                for (entry.conditions.sliceConst(), 0..) |*condition_, j| {
                    const condition: *const bun.css.ImportConditions = condition_;
                    const scratchbuf = std.ArrayList(u8).init(arena.allocator());
                    var printer = bun.css.Printer(W).new(
                        arena.allocator(),
                        scratchbuf,
                        writer,
                        bun.css.PrinterOptions.default(),
                        .{
                            .import_records = &entry.condition_import_records,
                            .ast_urls_for_css = this.parse_graph.ast.items(.url_for_css),
                            .ast_unique_key_for_additional_file = this.parse_graph.input_files.items(.unique_key_for_additional_file),
                        },
                        &this.mangled_props,
                        &symbols,
                    );

                    condition.toCss(W, &printer) catch unreachable;
                    if (j != entry.conditions.len - 1) {
                        arrlist.appendSlice(arena.allocator(), ", ") catch unreachable;
                    }
                }
                arrlist.appendSlice(arena.allocator(), " ]") catch unreachable;
                break :conditions_str arrlist.items;
            } else "[]";

            debug("  {d}: {} {s}\n", .{ i, entry.fmt(this), conditions_str });
        }
    }
}

const bun = @import("bun");
const BabyList = bun.BabyList;
const Index = bun.bundle_v2.Index;
const LinkerContext = bun.bundle_v2.LinkerContext;

const Environment = bun.Environment;
const default_allocator = bun.default_allocator;

const std = @import("std");
const js_ast = bun.js_ast;
const ImportRecord = bun.ImportRecord;

const Symbol = js_ast.Symbol;
const B = js_ast.B;
const bundler = bun.bundle_v2;
const Graph = bundler.Graph;
const LinkerGraph = bundler.LinkerGraph;

pub const DeferredBatchTask = bun.bundle_v2.DeferredBatchTask;
pub const ThreadPool = bun.bundle_v2.ThreadPool;
pub const ParseTask = bun.bundle_v2.ParseTask;
const Chunk = bundler.Chunk;

const debug = LinkerContext.debug;
