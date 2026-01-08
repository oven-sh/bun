pub const PrepareCssAstTask = struct {
    task: ThreadPoolLib.Task,
    chunk: *Chunk,
    linker: *LinkerContext,
};

pub fn prepareCssAstsForChunk(task: *ThreadPoolLib.Task) void {
    const prepare_css_asts: *const PrepareCssAstTask = @fieldParentPtr("task", task);
    var worker = ThreadPool.Worker.get(@fieldParentPtr("linker", prepare_css_asts.linker));
    defer worker.unget();

    prepareCssAstsForChunkImpl(prepare_css_asts.linker, prepare_css_asts.chunk, worker.allocator);
}

fn prepareCssAstsForChunkImpl(c: *LinkerContext, chunk: *Chunk, allocator: std.mem.Allocator) void {
    const asts: []const ?*bun.css.BundlerStyleSheet = c.graph.ast.items(.css);

    // Prepare CSS asts
    // Remove duplicate rules across files. This must be done in serial, not
    // in parallel, and must be done from the last rule to the first rule.
    {
        var i: usize = chunk.content.css.imports_in_chunk_in_order.len;
        while (i != 0) {
            i -= 1;
            const entry = chunk.content.css.imports_in_chunk_in_order.mut(i);
            switch (entry.kind) {
                .layers => |layers| {
                    const len = layers.inner().len;
                    var rules = bun.css.BundlerCssRuleList{};
                    if (len > 0) {
                        rules.v.append(allocator, bun.css.BundlerCssRule{
                            .layer_statement = bun.css.LayerStatementRule{
                                .names = bun.css.SmallList(bun.css.LayerName, 1).fromBabyListNoDeinit(layers.inner().*),
                                .loc = bun.css.Location.dummy(),
                            },
                        }) catch |err| bun.handleOom(err);
                    }
                    var ast = bun.css.BundlerStyleSheet{
                        .rules = rules,
                        .sources = .{},
                        .source_map_urls = .{},
                        .license_comments = .{},
                        .options = bun.css.ParserOptions.default(allocator, null),
                        .composes = .{},
                    };
                    wrapRulesWithConditions(&ast, allocator, &entry.conditions);
                    chunk.content.css.asts[i] = ast;
                },
                .external_path => |*p| {
                    var conditions: ?*bun.css.ImportConditions = null;
                    if (entry.conditions.len > 0) {
                        conditions = entry.conditions.mut(0);
                        entry.condition_import_records.append(
                            allocator,
                            bun.ImportRecord{ .kind = .at, .path = p.*, .range = Logger.Range{} },
                        ) catch |err| bun.handleOom(err);

                        // Handling a chain of nested conditions is complicated. We can't
                        // necessarily join them together because a) there may be multiple
                        // layer names and b) layer names are only supposed to be inserted
                        // into the layer order if the parent conditions are applied.
                        //
                        // Instead we handle them by preserving the "@import" nesting using
                        // imports of data URL stylesheets. This may seem strange but I think
                        // this is the only way to do this in CSS.
                        var j: usize = entry.conditions.len;
                        while (j != 1) {
                            j -= 1;

                            const ast_import = bun.css.BundlerStyleSheet{
                                .options = bun.css.ParserOptions.default(allocator, null),
                                .license_comments = .{},
                                .sources = .{},
                                .source_map_urls = .{},
                                .rules = rules: {
                                    var rules = bun.css.BundlerCssRuleList{};
                                    var import_rule = bun.css.ImportRule{
                                        .url = p.pretty,
                                        .import_record_idx = entry.condition_import_records.len,
                                        .loc = bun.css.Location.dummy(),
                                    };
                                    import_rule.conditionsMut().* = entry.conditions.at(j).*;
                                    rules.v.append(allocator, bun.css.BundlerCssRule{
                                        .import = import_rule,
                                    }) catch |err| bun.handleOom(err);
                                    break :rules rules;
                                },
                                .composes = .{},
                            };

                            const printer_options = bun.css.PrinterOptions{
                                .targets = bun.css.Targets.forBundlerTarget(c.options.target),
                                // TODO: make this more configurable
                                .minify = c.options.minify_whitespace or c.options.minify_syntax or c.options.minify_identifiers,
                            };

                            const print_result = switch (ast_import.toCss(
                                allocator,
                                printer_options,
                                .{
                                    .import_records = &entry.condition_import_records,
                                    .ast_urls_for_css = c.parse_graph.ast.items(.url_for_css),
                                    .ast_unique_key_for_additional_file = c.parse_graph.input_files.items(.unique_key_for_additional_file),
                                },
                                &c.mangled_props,
                                &c.graph.symbols,
                            )) {
                                .result => |v| v,
                                .err => |e| {
                                    bun.handleOom(c.log.addErrorFmt(null, Loc.Empty, c.allocator(), "Error generating CSS for import: {f}", .{e}));
                                    continue;
                                },
                            };
                            p.* = bun.fs.Path.init(DataURL.encodeStringAsShortestDataURL(allocator, "text/css", std.mem.trim(u8, print_result.code, " \n\r\t")));
                        }
                    }

                    var empty_conditions = bun.css.ImportConditions{};
                    const actual_conditions = if (conditions) |cc| cc else &empty_conditions;

                    entry.condition_import_records.append(allocator, bun.ImportRecord{
                        .kind = .at,
                        .path = p.*,
                        .range = Logger.Range.none,
                    }) catch |err| bun.handleOom(err);

                    chunk.content.css.asts[i] = bun.css.BundlerStyleSheet{
                        .rules = rules: {
                            var rules = bun.css.BundlerCssRuleList{};
                            var import_rule = bun.css.ImportRule.fromUrlAndImportRecordIdx(p.pretty, entry.condition_import_records.len);
                            import_rule.conditionsMut().* = actual_conditions.*;
                            rules.v.append(allocator, bun.css.BundlerCssRule{
                                .import = import_rule,
                            }) catch |err| bun.handleOom(err);
                            break :rules rules;
                        },
                        .sources = .{},
                        .source_map_urls = .{},
                        .license_comments = .{},
                        .options = bun.css.ParserOptions.default(allocator, null),
                        .composes = .{},
                    };
                },
                .source_index => |source_index| {
                    // Multiple imports may refer to the same file/AST, but they
                    // may wrap or modify the AST in different ways. So we need
                    // to make a shallow copy and be careful not to modify shared
                    // references.
                    var ast = ast: {
                        const original_stylesheet = asts[source_index.get()].?;
                        chunk.content.css.asts[i] = original_stylesheet.*;
                        break :ast &chunk.content.css.asts[i];
                    };

                    filter: {
                        // Filter out "@charset", "@import", and leading "@layer" rules
                        // TODO: we are doing simple version rn, only @import
                        for (ast.rules.v.items, 0..) |*rule, ruleidx| {
                            // if ((rule.* == .import and import_records[source_index.get()].at(rule.import.import_record_idx).flags.is_internal) or rule.* == .ignored) {} else {
                            if (rule.* == .import or rule.* == .ignored) {} else {
                                // It's okay to do this because AST is allocated into arena
                                const reslice = ast.rules.v.items[ruleidx..];
                                ast.rules.v = .{
                                    .items = reslice,
                                    .capacity = ast.rules.v.capacity - (ast.rules.v.items.len - reslice.len),
                                };
                                break :filter;
                            }
                        }
                        ast.rules.v.items.len = 0;
                    }

                    wrapRulesWithConditions(ast, allocator, &entry.conditions);
                    // TODO: Remove top-level duplicate rules across files
                },
            }
        }
    }
}

fn wrapRulesWithConditions(
    ast: *bun.css.BundlerStyleSheet,
    temp_allocator: std.mem.Allocator,
    conditions: *const BabyList(bun.css.ImportConditions),
) void {
    var dummy_import_records = bun.BabyList(bun.ImportRecord){};
    defer bun.debugAssert(dummy_import_records.len == 0);

    var i: usize = conditions.len;
    while (i > 0) {
        i -= 1;
        const item = conditions.at(i);

        // Generate "@layer" wrappers. Note that empty "@layer" rules still have
        // a side effect (they set the layer order) so they cannot be removed.
        if (item.layer) |l| {
            const layer = l.v;
            var do_block_rule = true;
            if (ast.rules.v.items.len == 0) {
                if (l.v == null) {
                    // Omit an empty "@layer {}" entirely
                    continue;
                } else {
                    // Generate "@layer foo;" instead of "@layer foo {}"
                    ast.rules.v = .{};
                    do_block_rule = false;
                }
            }

            ast.rules = brk: {
                var new_rules = bun.css.BundlerCssRuleList{};
                new_rules.v.append(
                    temp_allocator,
                    if (do_block_rule) .{ .layer_block = bun.css.BundlerLayerBlockRule{
                        .name = layer,
                        .rules = ast.rules,
                        .loc = bun.css.Location.dummy(),
                    } } else .{
                        .layer_statement = .{
                            .names = if (layer) |ly| bun.css.SmallList(bun.css.LayerName, 1).withOne(ly) else .{},
                            .loc = bun.css.Location.dummy(),
                        },
                    },
                ) catch |err| bun.handleOom(err);

                break :brk new_rules;
            };
        }

        // Generate "@supports" wrappers. This is not done if the rule block is
        // empty because empty "@supports" rules have no effect.
        if (ast.rules.v.items.len > 0) {
            if (item.supports) |*supports| {
                ast.rules = brk: {
                    var new_rules = bun.css.BundlerCssRuleList{};
                    new_rules.v.append(temp_allocator, .{
                        .supports = bun.css.BundlerSupportsRule{
                            .condition = supports.cloneWithImportRecords(
                                temp_allocator,
                                &dummy_import_records,
                            ),
                            .rules = ast.rules,
                            .loc = bun.css.Location.dummy(),
                        },
                    }) catch |err| bun.handleOom(err);
                    break :brk new_rules;
                };
            }
        }

        // Generate "@media" wrappers. This is not done if the rule block is
        // empty because empty "@media" rules have no effect.
        if (ast.rules.v.items.len > 0 and item.media.media_queries.items.len > 0) {
            ast.rules = brk: {
                var new_rules = bun.css.BundlerCssRuleList{};
                new_rules.v.append(temp_allocator, .{
                    .media = bun.css.BundlerMediaRule{
                        .query = item.media.cloneWithImportRecords(temp_allocator, &dummy_import_records),
                        .rules = ast.rules,
                        .loc = bun.css.Location.dummy(),
                    },
                }) catch |err| bun.handleOom(err);
                break :brk new_rules;
            };
        }
    }
}

pub const DeferredBatchTask = bun.bundle_v2.DeferredBatchTask;
pub const ThreadPool = bun.bundle_v2.ThreadPool;
pub const ParseTask = bun.bundle_v2.ParseTask;

const std = @import("std");

const bun = @import("bun");
const BabyList = bun.BabyList;
const ImportRecord = bun.ImportRecord;
const ThreadPoolLib = bun.ThreadPool;

const bundler = bun.bundle_v2;
const Chunk = bundler.Chunk;
const DataURL = bun.bundle_v2.DataURL;
const LinkerContext = bun.bundle_v2.LinkerContext;

const Logger = bun.logger;
const Loc = Logger.Loc;
