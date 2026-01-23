pub fn generateCodeForFileInChunkJS(
    c: *LinkerContext,
    writer: *js_printer.BufferWriter,
    r: renamer.Renamer,
    chunk: *Chunk,
    part_range: PartRange,
    toCommonJSRef: Ref,
    toESMRef: Ref,
    runtimeRequireRef: ?Ref,
    stmts: *StmtList,
    allocator: std.mem.Allocator,
    temp_allocator: std.mem.Allocator,
) js_printer.PrintResult {
    const parts: []Part = c.graph.ast.items(.parts)[part_range.source_index.get()].slice()[part_range.part_index_begin..part_range.part_index_end];
    const all_flags: []const JSMeta.Flags = c.graph.meta.items(.flags);
    const flags = all_flags[part_range.source_index.get()];
    const wrapper_part_index = if (flags.wrap != .none)
        c.graph.meta.items(.wrapper_part_index)[part_range.source_index.get()]
    else
        Index.invalid;

    // referencing everything by array makes the code a lot more annoying :(
    var ast: JSAst = c.graph.ast.get(part_range.source_index.get());

    // For HMR, part generation is entirely special cased.
    // - export wrapping is already done.
    // - imports are split from the main code.
    // - one part range per file
    if (c.options.output_format == .internal_bake_dev) brk: {
        if (part_range.source_index.isRuntime()) {
            @branchHint(.cold);
            bun.debugAssert(c.dev_server == null);
            break :brk; // this is from `bun build --format=internal_bake_dev`
        }

        const hmr_api_ref = ast.wrapper_ref;

        for (parts) |part| {
            c.convertStmtsForChunkForDevServer(stmts, part.stmts, allocator, &ast) catch |err|
                return .{ .err = err };
        }

        const main_stmts_len = stmts.inside_wrapper_prefix.stmts.items.len + stmts.inside_wrapper_suffix.items.len;
        const all_stmts_len = main_stmts_len + stmts.outside_wrapper_prefix.items.len + 1;

        bun.handleOom(stmts.all_stmts.ensureUnusedCapacity(stmts.allocator, all_stmts_len));
        stmts.all_stmts.appendSliceAssumeCapacity(stmts.inside_wrapper_prefix.stmts.items);
        stmts.all_stmts.appendSliceAssumeCapacity(stmts.inside_wrapper_suffix.items);

        const inner = stmts.all_stmts.items[0..main_stmts_len];

        var clousure_args = bun.BoundedArray(G.Arg, 3).fromSlice(&.{
            .{ .binding = Binding.alloc(temp_allocator, B.Identifier{
                .ref = hmr_api_ref,
            }, Logger.Loc.Empty) },
        }) catch unreachable; // is within bounds

        if (ast.flags.uses_module_ref or ast.flags.uses_exports_ref) {
            clousure_args.appendSliceAssumeCapacity(&.{
                .{
                    .binding = Binding.alloc(temp_allocator, B.Identifier{
                        .ref = ast.module_ref,
                    }, Logger.Loc.Empty),
                },
                .{
                    .binding = Binding.alloc(temp_allocator, B.Identifier{
                        .ref = ast.exports_ref,
                    }, Logger.Loc.Empty),
                },
            });
        }

        stmts.all_stmts.appendAssumeCapacity(Stmt.allocateExpr(temp_allocator, Expr.init(E.Function, .{ .func = .{
            .args = bun.handleOom(temp_allocator.dupe(G.Arg, clousure_args.slice())),
            .body = .{
                .stmts = inner,
                .loc = Logger.Loc.Empty,
            },
        } }, Logger.Loc.Empty)));
        stmts.all_stmts.appendSliceAssumeCapacity(stmts.outside_wrapper_prefix.items);

        ast.flags.uses_module_ref = true;

        // TODO: there is a weird edge case where the pretty path is not computed
        // it does not reproduce when debugging.
        var source = c.getSource(part_range.source_index.get()).*;
        if (source.path.text.ptr == source.path.pretty.ptr) {
            source.path = genericPathWithPrettyInitialized(
                source.path,
                c.options.target,
                c.resolver.fs.top_level_dir,
                allocator,
            ) catch |err| bun.handleOom(err);
        }

        return c.printCodeForFileInChunkJS(
            r,
            allocator,
            writer,
            stmts.all_stmts.items[main_stmts_len..],
            &ast,
            flags,
            .None,
            .None,
            null,
            part_range.source_index,
            &source,
        );
    }

    var needs_wrapper = false;

    const namespace_export_part_index = js_ast.namespace_export_part_index;

    stmts.reset();

    const part_index_for_lazy_default_export: u32 = brk: {
        if (ast.flags.has_lazy_export) {
            if (c.graph.meta.items(.resolved_exports)[part_range.source_index.get()].get("default")) |default| {
                break :brk c.graph.topLevelSymbolToParts(part_range.source_index.get(), default.data.import_ref)[0];
            }
        }
        break :brk std.math.maxInt(u32);
    };

    const output_format = c.options.output_format;

    // The top-level directive must come first (the non-wrapped case is handled
    // by the chunk generation code, although only for the entry point)
    if (flags.wrap != .none and ast.flags.has_explicit_use_strict_directive and !chunk.isEntryPoint() and !output_format.isAlwaysStrictMode()) {
        stmts.inside_wrapper_prefix.appendNonDependency(Stmt.alloc(S.Directive, .{
            .value = "use strict",
        }, Logger.Loc.Empty)) catch unreachable;
    }

    // TODO: handle directive
    if (namespace_export_part_index >= part_range.part_index_begin and
        namespace_export_part_index < part_range.part_index_end and
        parts[namespace_export_part_index].is_live)
    {
        c.convertStmtsForChunk(
            part_range.source_index.get(),
            stmts,
            parts[namespace_export_part_index].stmts,
            chunk,
            temp_allocator,
            flags.wrap,
            &ast,
        ) catch |err| {
            bun.handleErrorReturnTrace(err, @errorReturnTrace());
            return .{ .err = err };
        };

        switch (flags.wrap) {
            .esm => {
                stmts.appendSlice(.outside_wrapper_prefix, stmts.inside_wrapper_suffix.items) catch unreachable;
            },
            else => {
                stmts.inside_wrapper_prefix.appendNonDependencySlice(stmts.inside_wrapper_suffix.items) catch unreachable;
            },
        }

        stmts.inside_wrapper_suffix.clearRetainingCapacity();
    }

    // Add all other parts in this chunk
    for (parts, 0..) |part, index_| {
        const index = part_range.part_index_begin + @as(u32, @truncate(index_));
        if (!part.is_live) {
            // Skip the part if it's not in this chunk
            continue;
        }

        if (index == namespace_export_part_index) {
            // Skip the namespace export part because we already handled it above
            continue;
        }

        if (index == wrapper_part_index.get()) {
            // Skip the wrapper part because we already handled it above
            needs_wrapper = true;
            continue;
        }

        var single_stmts_list = [1]Stmt{undefined};
        var part_stmts = part.stmts;

        // If this could be a JSON or TOML file that exports a top-level object literal, go
        // over the non-default top-level properties that ended up being imported
        // and substitute references to them into the main top-level object literal.
        // So this JSON file:
        //
        //   {
        //     "foo": [1, 2, 3],
        //     "bar": [4, 5, 6],
        //   }
        //
        // is initially compiled into this:
        //
        //   export var foo = [1, 2, 3];
        //   export var bar = [4, 5, 6];
        //   export default {
        //     foo: [1, 2, 3],
        //     bar: [4, 5, 6],
        //   };
        //
        // But we turn it into this if both "foo" and "default" are imported:
        //
        //   export var foo = [1, 2, 3];
        //   export default {
        //     foo,
        //     bar: [4, 5, 6],
        //   };
        //
        if (index == part_index_for_lazy_default_export) {
            bun.assert(index != std.math.maxInt(u32));

            const stmt = part_stmts[0];

            if (stmt.data != .s_export_default)
                @panic("expected Lazy default export to be an export default statement");

            const default_export = stmt.data.s_export_default;
            var default_expr = default_export.value.expr;

            // Be careful: the top-level value in a JSON file is not necessarily an object
            if (default_expr.data == .e_object) {
                var new_properties = default_expr.data.e_object.properties.clone(temp_allocator) catch unreachable;

                var resolved_exports = c.graph.meta.items(.resolved_exports)[part_range.source_index.get()];

                // If any top-level properties ended up being imported directly, change
                // the property to just reference the corresponding variable instead
                for (new_properties.slice()) |*prop| {
                    if (prop.key == null or prop.key.?.data != .e_string or prop.value == null) continue;
                    const name = prop.key.?.data.e_string.slice(temp_allocator);
                    if (strings.eqlComptime(name, "default") or
                        strings.eqlComptime(name, "__esModule") or
                        !bun.js_lexer.isIdentifier(name)) continue;

                    if (resolved_exports.get(name)) |export_data| {
                        const export_ref = export_data.data.import_ref;
                        const export_part = ast.parts.slice()[c.graph.topLevelSymbolToParts(part_range.source_index.get(), export_ref)[0]];
                        if (export_part.is_live) {
                            prop.* = .{
                                .key = prop.key,
                                .value = Expr.initIdentifier(export_ref, prop.value.?.loc),
                            };
                        }
                    }
                }

                default_expr = Expr.allocate(
                    temp_allocator,
                    E.Object,
                    E.Object{
                        .properties = new_properties,
                    },
                    default_expr.loc,
                );
            }

            single_stmts_list[0] = Stmt.allocate(
                temp_allocator,
                S.ExportDefault,
                .{
                    .default_name = default_export.default_name,
                    .value = .{ .expr = default_expr },
                },
                stmt.loc,
            );
            part_stmts = single_stmts_list[0..];
        }

        c.convertStmtsForChunk(
            part_range.source_index.get(),
            stmts,
            part_stmts,
            chunk,
            temp_allocator,
            flags.wrap,
            &ast,
        ) catch |err| return .{
            .err = err,
        };
    }

    // Hoist all import statements before any normal statements. ES6 imports
    // are different than CommonJS imports. All modules imported via ES6 import
    // statements are evaluated before the module doing the importing is
    // evaluated (well, except for cyclic import scenarios). We need to preserve
    // these semantics even when modules imported via ES6 import statements end
    // up being CommonJS modules.
    stmts.all_stmts.ensureUnusedCapacity(stmts.allocator, stmts.inside_wrapper_prefix.stmts.items.len + stmts.inside_wrapper_suffix.items.len) catch unreachable;
    stmts.all_stmts.appendSliceAssumeCapacity(stmts.inside_wrapper_prefix.stmts.items);
    stmts.all_stmts.appendSliceAssumeCapacity(stmts.inside_wrapper_suffix.items);
    stmts.inside_wrapper_prefix.reset();
    stmts.inside_wrapper_suffix.clearRetainingCapacity();

    if (c.options.minify_syntax) {
        mergeAdjacentLocalStmts(&stmts.all_stmts, temp_allocator);
    }

    var out_stmts: []js_ast.Stmt = stmts.all_stmts.items;

    // Optionally wrap all statements in a closure
    if (needs_wrapper) {
        switch (flags.wrap) {
            .cjs => {
                // Only include the arguments that are actually used
                var args = std.array_list.Managed(G.Arg).initCapacity(
                    temp_allocator,
                    if (ast.flags.uses_module_ref or ast.flags.uses_exports_ref) 2 else 0,
                ) catch unreachable;

                if (ast.flags.uses_module_ref or ast.flags.uses_exports_ref) {
                    args.appendAssumeCapacity(
                        G.Arg{
                            .binding = Binding.alloc(
                                temp_allocator,
                                B.Identifier{
                                    .ref = ast.exports_ref,
                                },
                                Logger.Loc.Empty,
                            ),
                        },
                    );

                    if (ast.flags.uses_module_ref) {
                        args.appendAssumeCapacity(
                            G.Arg{
                                .binding = Binding.alloc(
                                    temp_allocator,
                                    B.Identifier{
                                        .ref = ast.module_ref,
                                    },
                                    Logger.Loc.Empty,
                                ),
                            },
                        );
                    }
                }

                // TODO: variants of the runtime functions
                var cjs_args = temp_allocator.alloc(Expr, 1) catch unreachable;
                cjs_args[0] = Expr.init(
                    E.Arrow,
                    E.Arrow{
                        .args = args.items,
                        .body = .{
                            .stmts = stmts.all_stmts.items,
                            .loc = Logger.Loc.Empty,
                        },
                    },
                    Logger.Loc.Empty,
                );

                const commonjs_wrapper_definition = Expr.init(
                    E.Call,
                    E.Call{
                        .target = Expr.init(
                            E.Identifier,
                            E.Identifier{
                                .ref = c.cjs_runtime_ref,
                            },
                            Logger.Loc.Empty,
                        ),
                        .args = bun.BabyList(Expr).fromOwnedSlice(cjs_args),
                    },
                    Logger.Loc.Empty,
                );

                // "var require_foo = __commonJS(...);"
                {
                    var decls = temp_allocator.alloc(G.Decl, 1) catch unreachable;
                    decls[0] = G.Decl{
                        .binding = Binding.alloc(
                            temp_allocator,
                            B.Identifier{
                                .ref = ast.wrapper_ref,
                            },
                            Logger.Loc.Empty,
                        ),
                        .value = commonjs_wrapper_definition,
                    };

                    stmts.append(
                        .outside_wrapper_prefix,
                        Stmt.alloc(
                            S.Local,
                            S.Local{
                                .decls = G.Decl.List.fromOwnedSlice(decls),
                            },
                            Logger.Loc.Empty,
                        ),
                    ) catch unreachable;
                }
            },
            .esm => {
                // The wrapper only needs to be "async" if there is a transitive async
                // dependency. For correctness, we must not use "async" if the module
                // isn't async because then calling "require()" on that module would
                // swallow any exceptions thrown during module initialization.
                const is_async = flags.is_async_or_has_async_dependency;

                const ExportHoist = struct {
                    decls: std.ArrayListUnmanaged(G.Decl),
                    allocator: std.mem.Allocator,

                    pub fn wrapIdentifier(w: *@This(), loc: Logger.Loc, ref: Ref) Expr {
                        w.decls.append(
                            w.allocator,
                            .{
                                .binding = Binding.alloc(
                                    w.allocator,
                                    B.Identifier{
                                        .ref = ref,
                                    },
                                    loc,
                                ),
                                .value = null,
                            },
                        ) catch |err| bun.handleOom(err);

                        return Expr.initIdentifier(ref, loc);
                    }
                };

                var hoist = ExportHoist{
                    .decls = .{},
                    .allocator = temp_allocator,
                };

                var inner_stmts = stmts.all_stmts.items;

                // Hoist all top-level "var" and "function" declarations out of the closure
                {
                    var end: usize = 0;
                    for (stmts.all_stmts.items) |stmt| {
                        const transformed = switch (stmt.data) {
                            .s_local => |local| stmt: {
                                // Convert the declarations to assignments
                                var value = Expr.empty;
                                for (local.decls.slice()) |*decl| {
                                    if (decl.value) |initializer| {
                                        const can_be_moved = initializer.canBeMoved();
                                        if (can_be_moved) {
                                            // if the value can be moved, move the decl directly to preserve destructuring
                                            // ie `const { main } = class { static main() {} }` => `var {main} = class { static main() {} }`
                                            bun.handleOom(hoist.decls.append(hoist.allocator, decl.*));
                                        } else {
                                            // if the value cannot be moved, add every destructuring key separately
                                            // ie `var { append } = { append() {} }` => `var append; __esm(() => ({ append } = { append() {} }))`
                                            const binding = decl.binding.toExpr(&hoist);
                                            value = value.joinWithComma(
                                                binding.assign(initializer),
                                                temp_allocator,
                                            );
                                        }
                                    } else {
                                        _ = decl.binding.toExpr(&hoist);
                                    }
                                }

                                if (value.isEmpty()) {
                                    continue;
                                }

                                break :stmt Stmt.allocateExpr(temp_allocator, value);
                            },
                            .s_function => {
                                bun.handleOom(stmts.append(.outside_wrapper_prefix, stmt));
                                continue;
                            },
                            .s_class => |class| stmt: {
                                if (class.class.canBeMoved()) {
                                    bun.handleOom(stmts.append(.outside_wrapper_prefix, stmt));
                                    continue;
                                }

                                break :stmt Stmt.allocateExpr(
                                    temp_allocator,
                                    Expr.assign(hoist.wrapIdentifier(
                                        class.class.class_name.?.loc,
                                        class.class.class_name.?.ref.?,
                                    ), .{
                                        .data = .{ .e_class = &class.class },
                                        .loc = stmt.loc,
                                    }),
                                );
                            },
                            else => stmt,
                        };

                        inner_stmts[end] = transformed;
                        end += 1;
                    }
                    inner_stmts.len = end;
                }

                if (hoist.decls.items.len > 0) {
                    stmts.append(
                        .outside_wrapper_prefix,
                        Stmt.alloc(
                            S.Local,
                            S.Local{
                                .decls = G.Decl.List.moveFromList(&hoist.decls),
                            },
                            Logger.Loc.Empty,
                        ),
                    ) catch unreachable;
                    hoist.decls.items.len = 0;
                }

                if (inner_stmts.len > 0) {
                    // See the comment in needsWrapperRef for why the symbol
                    // is sometimes not generated.
                    bun.assert(!ast.wrapper_ref.isEmpty()); // js_parser's needsWrapperRef thought wrapper was not needed

                    // "__esm(() => { ... })"
                    var esm_args = bun.handleOom(temp_allocator.alloc(Expr, 1));
                    esm_args[0] = Expr.init(E.Arrow, .{
                        .args = &.{},
                        .is_async = is_async,
                        .body = .{
                            .stmts = inner_stmts,
                            .loc = Logger.Loc.Empty,
                        },
                    }, Logger.Loc.Empty);

                    // "var init_foo = __esm(...);"
                    const value = Expr.init(E.Call, .{
                        .target = Expr.initIdentifier(c.esm_runtime_ref, Logger.Loc.Empty),
                        .args = bun.BabyList(Expr).fromOwnedSlice(esm_args),
                    }, Logger.Loc.Empty);

                    var decls = bun.handleOom(temp_allocator.alloc(G.Decl, 1));
                    decls[0] = G.Decl{
                        .binding = Binding.alloc(
                            temp_allocator,
                            B.Identifier{
                                .ref = ast.wrapper_ref,
                            },
                            Logger.Loc.Empty,
                        ),
                        .value = value,
                    };

                    stmts.append(
                        .outside_wrapper_prefix,
                        Stmt.alloc(S.Local, .{
                            .decls = G.Decl.List.fromOwnedSlice(decls),
                        }, Logger.Loc.Empty),
                    ) catch |err| bun.handleOom(err);
                } else {
                    // // If this fails, then there will be places we reference
                    // // `init_foo` without it actually existing.
                    // bun.assert(ast.wrapper_ref.isEmpty());

                    // TODO: the edge case where we are wrong is when there
                    // are references to other ESM modules, but those get
                    // fully hoisted. The look like side effects, but they
                    // are removed.
                    //
                    // It is too late to retroactively delete the
                    // wrapper_ref, since printing has already begun.  The
                    // most we can do to salvage the situation is to print
                    // an empty arrow function.
                    //
                    // This is marked as a TODO, because this can be solved
                    // via a count of external modules, decremented during
                    // linking.
                    if (!ast.wrapper_ref.isEmpty()) {
                        const value = Expr.init(E.Arrow, .{
                            .args = &.{},
                            .is_async = is_async,
                            .body = .{
                                .stmts = inner_stmts,
                                .loc = Logger.Loc.Empty,
                            },
                        }, Logger.Loc.Empty);

                        stmts.append(
                            .outside_wrapper_prefix,
                            Stmt.alloc(S.Local, .{
                                .decls = G.Decl.List.fromSlice(temp_allocator, &.{.{
                                    .binding = Binding.alloc(
                                        temp_allocator,
                                        B.Identifier{
                                            .ref = ast.wrapper_ref,
                                        },
                                        Logger.Loc.Empty,
                                    ),
                                    .value = value,
                                }}) catch |err| bun.handleOom(err),
                            }, Logger.Loc.Empty),
                        ) catch |err| bun.handleOom(err);
                    }
                }
            },
            else => {},
        }

        out_stmts = stmts.outside_wrapper_prefix.items;
    }

    if (out_stmts.len == 0) {
        return .{
            .result = .{
                .code = "",
                .source_map = null,
            },
        };
    }

    return c.printCodeForFileInChunkJS(
        r,
        allocator,
        writer,
        out_stmts,
        &ast,
        flags,
        toESMRef,
        toCommonJSRef,
        runtimeRequireRef,
        part_range.source_index,
        c.getSource(part_range.source_index.get()),
    );
}

fn mergeAdjacentLocalStmts(stmts: *std.ArrayListUnmanaged(Stmt), allocator: std.mem.Allocator) void {
    if (stmts.items.len == 0)
        return;

    var did_merge_with_previous_local = false;
    var end: usize = 1;

    for (stmts.items[1..]) |stmt| {
        // Try to merge with the previous variable statement
        if (stmt.data == .s_local) {
            var after = stmt.data.s_local;
            if (stmts.items[end - 1].data == .s_local) {
                var before = stmts.items[end - 1].data.s_local;
                // It must be the same kind of variable statement (i.e. let/var/const)
                if (before.canMergeWith(after)) {
                    if (did_merge_with_previous_local) {
                        // Avoid O(n^2) behavior for repeated variable declarations
                        // Appending to this decls list is safe because did_merge_with_previous_local is true
                        before.decls.appendSlice(allocator, after.decls.slice()) catch unreachable;
                    } else {
                        // Append the declarations to the previous variable statement
                        did_merge_with_previous_local = true;

                        var clone = bun.BabyList(G.Decl).initCapacity(allocator, before.decls.len + after.decls.len) catch unreachable;
                        clone.appendSliceAssumeCapacity(before.decls.slice());
                        clone.appendSliceAssumeCapacity(after.decls.slice());
                        // we must clone instead of overwrite in-place incase the same S.Local is used across threads
                        // https://github.com/oven-sh/bun/issues/2942
                        stmts.items[end - 1] = Stmt.allocate(
                            allocator,
                            S.Local,
                            S.Local{
                                .decls = clone,
                                .is_export = before.is_export,
                                .was_commonjs_export = before.was_commonjs_export,
                                .was_ts_import_equals = before.was_ts_import_equals,
                                .kind = before.kind,
                            },
                            stmts.items[end - 1].loc,
                        );
                    }
                    continue;
                }
            }
        }

        did_merge_with_previous_local = false;
        stmts.items[end] = stmt;
        end += 1;
    }
    stmts.items.len = end;
}

const std = @import("std");

const bun = @import("bun");
const BabyList = bun.BabyList;
const Logger = bun.logger;
const options = bun.options;
const strings = bun.strings;

const Chunk = bun.bundle_v2.Chunk;
const Index = bun.bundle_v2.Index;
const JSAst = bun.bundle_v2.JSAst;
const JSMeta = bun.bundle_v2.JSMeta;
const Part = bun.bundle_v2.Part;
const PartRange = bun.bundle_v2.PartRange;
const genericPathWithPrettyInitialized = bun.bundle_v2.genericPathWithPrettyInitialized;
const js_printer = bun.bundle_v2.js_printer;
const renamer = bun.bundle_v2.renamer;

const LinkerContext = bun.bundle_v2.LinkerContext;
const StmtList = LinkerContext.StmtList;

const js_ast = bun.bundle_v2.js_ast;
const B = js_ast.B;
const Binding = js_ast.Binding;
const E = js_ast.E;
const Expr = js_ast.Expr;
const G = js_ast.G;
const Ref = bun.bundle_v2.js_ast.Ref;
const S = js_ast.S;
const Stmt = js_ast.Stmt;
