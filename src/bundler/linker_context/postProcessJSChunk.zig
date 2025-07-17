/// This runs after we've already populated the compile results
pub fn postProcessJSChunk(ctx: GenerateChunkCtx, worker: *ThreadPool.Worker, chunk: *Chunk, chunk_index: usize) !void {
    const trace = bun.perf.trace("Bundler.postProcessJSChunk");
    defer trace.end();

    _ = chunk_index;
    const c = ctx.c;
    bun.assert(chunk.content == .javascript);

    js_ast.Expr.Data.Store.create();
    js_ast.Stmt.Data.Store.create();

    defer chunk.renamer.deinit(bun.default_allocator);

    var arena = bun.ArenaAllocator.init(worker.allocator);
    defer arena.deinit();

    // Also generate the cross-chunk binding code
    var cross_chunk_prefix: []u8 = &.{};
    var cross_chunk_suffix: []u8 = &.{};

    var runtime_scope: *Scope = &c.graph.ast.items(.module_scope)[c.graph.files.items(.input_file)[Index.runtime.value].get()];
    var runtime_members = &runtime_scope.members;
    const toCommonJSRef = c.graph.symbols.follow(runtime_members.get("__toCommonJS").?.ref);
    const toESMRef = c.graph.symbols.follow(runtime_members.get("__toESM").?.ref);
    const runtimeRequireRef = if (c.options.output_format == .cjs) null else c.graph.symbols.follow(runtime_members.get("__require").?.ref);

    {
        const print_options = js_printer.Options{
            .bundling = true,
            .indent = .{},
            .has_run_symbol_renamer = true,

            .allocator = worker.allocator,
            .require_ref = runtimeRequireRef,
            .minify_whitespace = c.options.minify_whitespace,
            .minify_identifiers = c.options.minify_identifiers,
            .minify_syntax = c.options.minify_syntax,
            .target = c.options.target,
            .print_dce_annotations = c.options.emit_dce_annotations,
            .mangled_props = &c.mangled_props,
            // .const_values = c.graph.const_values,
        };

        var cross_chunk_import_records = ImportRecord.List.initCapacity(worker.allocator, chunk.cross_chunk_imports.len) catch unreachable;
        defer cross_chunk_import_records.deinitWithAllocator(worker.allocator);
        for (chunk.cross_chunk_imports.slice()) |import_record| {
            cross_chunk_import_records.appendAssumeCapacity(
                .{
                    .kind = import_record.import_kind,
                    .path = Fs.Path.init(ctx.chunks[import_record.chunk_index].unique_key),
                    .range = Logger.Range.None,
                },
            );
        }

        const ast = c.graph.ast.get(chunk.entry_point.source_index);

        cross_chunk_prefix = js_printer.print(
            worker.allocator,
            c.resolver.opts.target,
            ast.toAST(),
            c.getSource(chunk.entry_point.source_index),
            print_options,
            cross_chunk_import_records.slice(),
            &[_]Part{
                .{ .stmts = chunk.content.javascript.cross_chunk_prefix_stmts.slice() },
            },
            chunk.renamer,
            false,
        ).result.code;
        cross_chunk_suffix = js_printer.print(
            worker.allocator,
            c.resolver.opts.target,
            ast.toAST(),
            c.getSource(chunk.entry_point.source_index),
            print_options,
            &.{},
            &[_]Part{
                .{ .stmts = chunk.content.javascript.cross_chunk_suffix_stmts.slice() },
            },
            chunk.renamer,
            false,
        ).result.code;
    }

    // Generate the exports for the entry point, if there are any
    const entry_point_tail = brk: {
        if (chunk.isEntryPoint()) {
            break :brk generateEntryPointTailJS(
                c,
                toCommonJSRef,
                toESMRef,
                chunk.entry_point.source_index,
                worker.allocator,
                arena.allocator(),
                chunk.renamer,
            );
        }

        break :brk CompileResult.empty;
    };

    var j = StringJoiner{
        .allocator = worker.allocator,
        .watcher = .{
            .input = chunk.unique_key,
        },
    };
    const output_format = c.options.output_format;

    var line_offset: bun.sourcemap.LineColumnOffset.Optional = if (c.options.source_maps != .none) .{ .value = .{} } else .{ .null = {} };

    // Concatenate the generated JavaScript chunks together

    var newline_before_comment = false;
    var is_executable = false;

    // Start with the hashbang if there is one. This must be done before the
    // banner because it only works if it's literally the first character.
    if (chunk.isEntryPoint()) {
        const is_bun = ctx.c.graph.ast.items(.target)[chunk.entry_point.source_index].isBun();
        const hashbang = c.graph.ast.items(.hashbang)[chunk.entry_point.source_index];

        if (hashbang.len > 0) {
            j.pushStatic(hashbang);
            j.pushStatic("\n");
            line_offset.advance(hashbang);
            line_offset.advance("\n");
            newline_before_comment = true;
            is_executable = true;
        }

        if (is_bun) {
            const cjs_entry_chunk = "(function(exports, require, module, __filename, __dirname) {";
            if (ctx.c.options.generate_bytecode_cache and output_format == .cjs) {
                const input = "// @bun @bytecode @bun-cjs\n" ++ cjs_entry_chunk;
                j.pushStatic(input);
                line_offset.advance(input);
            } else if (ctx.c.options.generate_bytecode_cache) {
                j.pushStatic("// @bun @bytecode\n");
                line_offset.advance("// @bun @bytecode\n");
            } else if (output_format == .cjs) {
                j.pushStatic("// @bun @bun-cjs\n" ++ cjs_entry_chunk);
                line_offset.advance("// @bun @bun-cjs\n" ++ cjs_entry_chunk);
            } else {
                j.pushStatic("// @bun\n");
                line_offset.advance("// @bun\n");
            }
        }
    }

    if (c.options.banner.len > 0) {
        if (newline_before_comment) {
            j.pushStatic("\n");
            line_offset.advance("\n");
        }
        j.pushStatic(ctx.c.options.banner);
        line_offset.advance(ctx.c.options.banner);
        j.pushStatic("\n");
        line_offset.advance("\n");
    }

    // Add the top-level directive if present (but omit "use strict" in ES
    // modules because all ES modules are automatically in strict mode)
    if (chunk.isEntryPoint() and !output_format.isAlwaysStrictMode()) {
        const flags: JSAst.Flags = c.graph.ast.items(.flags)[chunk.entry_point.source_index];

        if (flags.has_explicit_use_strict_directive) {
            j.pushStatic("\"use strict\";\n");
            line_offset.advance("\"use strict\";\n");
            newline_before_comment = true;
        }
    }

    // For Kit, hoist runtime.js outside of the IIFE
    const compile_results = chunk.compile_results_for_chunk;
    if (c.options.output_format == .internal_bake_dev) {
        for (compile_results) |compile_result| {
            const source_index = compile_result.sourceIndex();
            if (source_index != Index.runtime.value) break;
            line_offset.advance(compile_result.code());
            j.push(compile_result.code(), bun.default_allocator);
        }
    }

    switch (c.options.output_format) {
        .internal_bake_dev => {
            const start = bun.bake.getHmrRuntime(if (c.options.target.isServerSide()) .server else .client);
            j.pushStatic(start.code);
            line_offset.advance(start.code);
        },
        .iife => {
            // Bun does not do arrow function lowering. So the wrapper can be an arrow.
            const start = if (c.options.minify_whitespace) "(()=>{" else "(() => {\n";
            j.pushStatic(start);
            line_offset.advance(start);
        },
        else => {}, // no wrapper
    }

    if (cross_chunk_prefix.len > 0) {
        newline_before_comment = true;
        line_offset.advance(cross_chunk_prefix);
        j.push(cross_chunk_prefix, bun.default_allocator);
    }

    // Concatenate the generated JavaScript chunks together
    var prev_filename_comment: Index.Int = 0;

    var compile_results_for_source_map: std.MultiArrayList(CompileResultForSourceMap) = .{};
    compile_results_for_source_map.setCapacity(worker.allocator, compile_results.len) catch bun.outOfMemory();

    const show_comments = c.options.mode == .bundle and
        !c.options.minify_whitespace;

    const emit_targets_in_commands = show_comments and (if (ctx.c.framework) |fw| fw.server_components != null else false);

    const sources: []const Logger.Source = c.parse_graph.input_files.items(.source);
    const targets: []const options.Target = c.parse_graph.ast.items(.target);
    for (compile_results) |compile_result| {
        const source_index = compile_result.sourceIndex();
        const is_runtime = source_index == Index.runtime.value;

        // TODO: extracated legal comments

        // Add a comment with the file path before the file contents
        if (show_comments and source_index != prev_filename_comment and compile_result.code().len > 0) {
            prev_filename_comment = source_index;

            if (newline_before_comment) {
                j.pushStatic("\n");
                line_offset.advance("\n");
            }

            // Make sure newlines in the path can't cause a syntax error.
            const CommentType = enum {
                multiline,
                single,
            };

            const pretty = sources[source_index].path.pretty;

            // TODO: quote this. This is really janky.
            const comment_type = if (strings.indexOfNewlineOrNonASCII(pretty, 0) != null)
                CommentType.multiline
            else
                CommentType.single;

            if (!c.options.minify_whitespace and
                (output_format == .iife or output_format == .internal_bake_dev))
            {
                j.pushStatic("  ");
                line_offset.advance("  ");
            }

            switch (comment_type) {
                .multiline => {
                    j.pushStatic("/* ");
                    line_offset.advance("/* ");
                },
                .single => {
                    j.pushStatic("// ");
                    line_offset.advance("// ");
                },
            }

            j.pushStatic(pretty);
            line_offset.advance(pretty);

            if (emit_targets_in_commands) {
                j.pushStatic(" (");
                line_offset.advance(" (");
                const target = @tagName(targets[source_index].bakeGraph());
                j.pushStatic(target);
                line_offset.advance(target);
                j.pushStatic(")");
                line_offset.advance(")");
            }

            switch (comment_type) {
                .multiline => {
                    j.pushStatic(" */\n");
                    line_offset.advance(" */\n");
                },
                .single => {
                    j.pushStatic("\n");
                    line_offset.advance("\n");
                },
            }
        }

        if (is_runtime) {
            if (c.options.output_format != .internal_bake_dev) {
                line_offset.advance(compile_result.code());
                j.push(compile_result.code(), bun.default_allocator);
            }
        } else {
            j.push(compile_result.code(), bun.default_allocator);

            if (compile_result.sourceMapChunk()) |source_map_chunk| {
                if (c.options.source_maps != .none) {
                    try compile_results_for_source_map.append(worker.allocator, CompileResultForSourceMap{
                        .source_map_chunk = source_map_chunk,
                        .generated_offset = line_offset.value,
                        .source_index = compile_result.sourceIndex(),
                    });
                }

                line_offset.reset();
            } else {
                line_offset.advance(compile_result.code());
            }
        }

        // TODO: metafile
        newline_before_comment = compile_result.code().len > 0;
    }

    const tail_code = entry_point_tail.code();
    if (tail_code.len > 0) {
        // Stick the entry point tail at the end of the file. Deliberately don't
        // include any source mapping information for this because it's automatically
        // generated and doesn't correspond to a location in the input file.
        j.push(tail_code, bun.default_allocator);
    }

    // Put the cross-chunk suffix inside the IIFE
    if (cross_chunk_suffix.len > 0) {
        if (newline_before_comment) {
            j.pushStatic("\n");
        }

        j.push(cross_chunk_suffix, bun.default_allocator);
    }

    switch (output_format) {
        .iife => {
            const without_newline = "})();";

            const with_newline = if (newline_before_comment)
                without_newline ++ "\n"
            else
                without_newline;

            j.pushStatic(with_newline);
        },
        .internal_bake_dev => {
            {
                const str = "}, {\n  main: ";
                j.pushStatic(str);
                line_offset.advance(str);
            }
            {
                const input = c.parse_graph.input_files.items(.source)[chunk.entry_point.source_index].path;
                var buf = MutableString.initEmpty(worker.allocator);
                js_printer.quoteForJSONBuffer(input.pretty, &buf, true) catch bun.outOfMemory();
                const str = buf.slice(); // worker.allocator is an arena
                j.pushStatic(str);
                line_offset.advance(str);
            }
            // {
            //     const str = "\n  react_refresh: ";
            //     j.pushStatic(str);
            //     line_offset.advance(str);
            // }
            {
                const str = "\n});";
                j.pushStatic(str);
                line_offset.advance(str);
            }
        },
        .cjs => {
            if (chunk.isEntryPoint()) {
                const is_bun = ctx.c.graph.ast.items(.target)[chunk.entry_point.source_index].isBun();
                if (is_bun) {
                    j.pushStatic("})\n");
                    line_offset.advance("})\n");
                }
            }
        },
        else => {},
    }

    j.ensureNewlineAtEnd();
    // TODO: maybeAppendLegalComments

    if (c.options.footer.len > 0) {
        if (newline_before_comment) {
            j.pushStatic("\n");
            line_offset.advance("\n");
        }
        j.pushStatic(ctx.c.options.footer);
        line_offset.advance(ctx.c.options.footer);
        j.pushStatic("\n");
        line_offset.advance("\n");
    }

    chunk.intermediate_output = c.breakOutputIntoPieces(
        worker.allocator,
        &j,
        @as(u32, @truncate(ctx.chunks.len)),
    ) catch @panic("Unhandled out of memory error in breakOutputIntoPieces()");

    // TODO: meta contents

    chunk.isolated_hash = c.generateIsolatedHash(chunk);
    chunk.is_executable = is_executable;

    if (c.options.source_maps != .none) {
        const can_have_shifts = chunk.intermediate_output == .pieces;
        chunk.output_source_map = try c.generateSourceMapForChunk(
            chunk.isolated_hash,
            worker,
            compile_results_for_source_map,
            c.resolver.opts.output_dir,
            can_have_shifts,
        );
    }
}

pub fn generateEntryPointTailJS(
    c: *LinkerContext,
    toCommonJSRef: Ref,
    toESMRef: Ref,
    source_index: Index.Int,
    allocator: std.mem.Allocator,
    temp_allocator: std.mem.Allocator,
    r: renamer.Renamer,
) CompileResult {
    const flags: JSMeta.Flags = c.graph.meta.items(.flags)[source_index];
    var stmts = std.ArrayList(Stmt).init(temp_allocator);
    defer stmts.deinit();
    const ast: JSAst = c.graph.ast.get(source_index);

    switch (c.options.output_format) {
        .esm => {
            switch (flags.wrap) {
                .cjs => {
                    stmts.append(
                        Stmt.alloc(
                            // "export default require_foo();"
                            S.ExportDefault,
                            .{
                                .default_name = .{
                                    .loc = Logger.Loc.Empty,
                                    .ref = ast.wrapper_ref,
                                },
                                .value = .{
                                    .expr = Expr.init(
                                        E.Call,
                                        E.Call{
                                            .target = Expr.initIdentifier(
                                                ast.wrapper_ref,
                                                Logger.Loc.Empty,
                                            ),
                                        },
                                        Logger.Loc.Empty,
                                    ),
                                },
                            },
                            Logger.Loc.Empty,
                        ),
                    ) catch unreachable;
                },
                else => {
                    if (flags.wrap == .esm and ast.wrapper_ref.isValid()) {
                        if (flags.is_async_or_has_async_dependency) {
                            // "await init_foo();"
                            stmts.append(
                                Stmt.alloc(
                                    S.SExpr,
                                    .{
                                        .value = Expr.init(
                                            E.Await,
                                            E.Await{
                                                .value = Expr.init(
                                                    E.Call,
                                                    E.Call{
                                                        .target = Expr.initIdentifier(
                                                            ast.wrapper_ref,
                                                            Logger.Loc.Empty,
                                                        ),
                                                    },
                                                    Logger.Loc.Empty,
                                                ),
                                            },
                                            Logger.Loc.Empty,
                                        ),
                                    },
                                    Logger.Loc.Empty,
                                ),
                            ) catch unreachable;
                        } else {
                            // "init_foo();"
                            stmts.append(
                                Stmt.alloc(
                                    S.SExpr,
                                    .{
                                        .value = Expr.init(
                                            E.Call,
                                            E.Call{
                                                .target = Expr.initIdentifier(
                                                    ast.wrapper_ref,
                                                    Logger.Loc.Empty,
                                                ),
                                            },
                                            Logger.Loc.Empty,
                                        ),
                                    },
                                    Logger.Loc.Empty,
                                ),
                            ) catch unreachable;
                        }
                    }

                    const sorted_and_filtered_export_aliases = c.graph.meta.items(.sorted_and_filtered_export_aliases)[source_index];

                    if (sorted_and_filtered_export_aliases.len > 0) {
                        const resolved_exports: ResolvedExports = c.graph.meta.items(.resolved_exports)[source_index];
                        const imports_to_bind: RefImportData = c.graph.meta.items(.imports_to_bind)[source_index];

                        // If the output format is ES6 modules and we're an entry point, generate an
                        // ES6 export statement containing all exports. Except don't do that if this
                        // entry point is a CommonJS-style module, since that would generate an ES6
                        // export statement that's not top-level. Instead, we will export the CommonJS
                        // exports as a default export later on.
                        var items = std.ArrayList(js_ast.ClauseItem).init(temp_allocator);
                        const cjs_export_copies = c.graph.meta.items(.cjs_export_copies)[source_index];

                        var had_default_export = false;

                        for (sorted_and_filtered_export_aliases, 0..) |alias, i| {
                            var resolved_export = resolved_exports.get(alias).?;

                            had_default_export = had_default_export or strings.eqlComptime(alias, "default");

                            // If this is an export of an import, reference the symbol that the import
                            // was eventually resolved to. We need to do this because imports have
                            // already been resolved by this point, so we can't generate a new import
                            // and have that be resolved later.
                            if (imports_to_bind.get(resolved_export.data.import_ref)) |import_data| {
                                resolved_export.data.import_ref = import_data.data.import_ref;
                                resolved_export.data.source_index = import_data.data.source_index;
                            }

                            // Exports of imports need EImportIdentifier in case they need to be re-
                            // written to a property access later on
                            if (c.graph.symbols.get(resolved_export.data.import_ref).?.namespace_alias != null) {
                                const temp_ref = cjs_export_copies[i];

                                // Create both a local variable and an export clause for that variable.
                                // The local variable is initialized with the initial value of the
                                // export. This isn't fully correct because it's a "dead" binding and
                                // doesn't update with the "live" value as it changes. But ES6 modules
                                // don't have any syntax for bare named getter functions so this is the
                                // best we can do.
                                //
                                // These input files:
                                //
                                //   // entry_point.js
                                //   export {foo} from './cjs-format.js'
                                //
                                //   // cjs-format.js
                                //   Object.defineProperty(exports, 'foo', {
                                //     enumerable: true,
                                //     get: () => Math.random(),
                                //   })
                                //
                                // Become this output file:
                                //
                                //   // cjs-format.js
                                //   var require_cjs_format = __commonJS((exports) => {
                                //     Object.defineProperty(exports, "foo", {
                                //       enumerable: true,
                                //       get: () => Math.random()
                                //     });
                                //   });
                                //
                                //   // entry_point.js
                                //   var cjs_format = __toESM(require_cjs_format());
                                //   var export_foo = cjs_format.foo;
                                //   export {
                                //     export_foo as foo
                                //   };
                                //
                                stmts.append(
                                    Stmt.alloc(
                                        S.Local,
                                        .{
                                            .decls = js_ast.G.Decl.List.fromSlice(
                                                temp_allocator,
                                                &.{
                                                    .{
                                                        .binding = Binding.alloc(
                                                            temp_allocator,
                                                            B.Identifier{
                                                                .ref = temp_ref,
                                                            },
                                                            Logger.Loc.Empty,
                                                        ),
                                                        .value = Expr.init(
                                                            E.ImportIdentifier,
                                                            E.ImportIdentifier{
                                                                .ref = resolved_export.data.import_ref,
                                                            },
                                                            Logger.Loc.Empty,
                                                        ),
                                                    },
                                                },
                                            ) catch unreachable,
                                        },
                                        Logger.Loc.Empty,
                                    ),
                                ) catch unreachable;

                                items.append(
                                    .{
                                        .name = js_ast.LocRef{
                                            .ref = temp_ref,
                                            .loc = Logger.Loc.Empty,
                                        },
                                        .alias = alias,
                                        .alias_loc = Logger.Loc.Empty,
                                    },
                                ) catch unreachable;
                            } else {
                                // Local identifiers can be exported using an export clause. This is done
                                // this way instead of leaving the "export" keyword on the local declaration
                                // itself both because it lets the local identifier be minified and because
                                // it works transparently for re-exports across files.
                                //
                                // These input files:
                                //
                                //   // entry_point.js
                                //   export * from './esm-format.js'
                                //
                                //   // esm-format.js
                                //   export let foo = 123
                                //
                                // Become this output file:
                                //
                                //   // esm-format.js
                                //   let foo = 123;
                                //
                                //   // entry_point.js
                                //   export {
                                //     foo
                                //   };
                                //
                                items.append(.{
                                    .name = js_ast.LocRef{
                                        .ref = resolved_export.data.import_ref,
                                        .loc = resolved_export.data.name_loc,
                                    },
                                    .alias = alias,
                                    .alias_loc = resolved_export.data.name_loc,
                                }) catch unreachable;
                            }
                        }

                        stmts.append(
                            Stmt.alloc(
                                S.ExportClause,
                                .{
                                    .items = items.items,
                                    .is_single_line = false,
                                },
                                Logger.Loc.Empty,
                            ),
                        ) catch unreachable;

                        if (flags.needs_synthetic_default_export and !had_default_export) {
                            var properties = G.Property.List.initCapacity(allocator, items.items.len) catch unreachable;
                            const getter_fn_body = allocator.alloc(Stmt, items.items.len) catch unreachable;
                            var remain_getter_fn_body = getter_fn_body;
                            for (items.items) |export_item| {
                                var fn_body = remain_getter_fn_body[0..1];
                                remain_getter_fn_body = remain_getter_fn_body[1..];
                                fn_body[0] = Stmt.alloc(
                                    S.Return,
                                    S.Return{
                                        .value = Expr.init(
                                            E.Identifier,
                                            E.Identifier{
                                                .ref = export_item.name.ref.?,
                                            },
                                            export_item.name.loc,
                                        ),
                                    },
                                    Logger.Loc.Empty,
                                );
                                properties.appendAssumeCapacity(
                                    G.Property{
                                        .key = Expr.init(
                                            E.String,
                                            E.String{
                                                .data = export_item.alias,
                                                .is_utf16 = false,
                                            },
                                            export_item.alias_loc,
                                        ),
                                        .value = Expr.init(
                                            E.Function,
                                            E.Function{
                                                .func = G.Fn{
                                                    .body = G.FnBody{
                                                        .loc = Logger.Loc.Empty,
                                                        .stmts = fn_body,
                                                    },
                                                },
                                            },
                                            export_item.alias_loc,
                                        ),
                                        .kind = G.Property.Kind.get,
                                        .flags = js_ast.Flags.Property.init(.{
                                            .is_method = true,
                                        }),
                                    },
                                );
                            }
                            stmts.append(
                                Stmt.alloc(
                                    S.ExportDefault,
                                    S.ExportDefault{
                                        .default_name = .{
                                            .ref = Ref.None,
                                            .loc = Logger.Loc.Empty,
                                        },
                                        .value = .{
                                            .expr = Expr.init(
                                                E.Object,
                                                E.Object{
                                                    .properties = properties,
                                                },
                                                Logger.Loc.Empty,
                                            ),
                                        },
                                    },
                                    Logger.Loc.Empty,
                                ),
                            ) catch unreachable;
                        }
                    }
                },
            }
        },

        // TODO: iife
        .iife => {},

        .internal_bake_dev => {
            // nothing needs to be done here, as the exports are already
            // forwarded in the module closure.
        },

        .cjs => {
            switch (flags.wrap) {
                .cjs => {
                    // "module.exports = require_foo();"
                    stmts.append(
                        Stmt.assign(
                            Expr.init(
                                E.Dot,
                                .{
                                    .target = Expr.initIdentifier(c.unbound_module_ref, Logger.Loc.Empty),
                                    .name = "exports",
                                    .name_loc = Logger.Loc.Empty,
                                },
                                Logger.Loc.Empty,
                            ),
                            Expr.init(
                                E.Call,
                                .{
                                    .target = Expr.initIdentifier(ast.wrapper_ref, Logger.Loc.Empty),
                                },
                                Logger.Loc.Empty,
                            ),
                        ),
                    ) catch unreachable;
                },
                .esm => {
                    // "init_foo();"
                    stmts.append(
                        Stmt.alloc(
                            S.SExpr,
                            .{
                                .value = Expr.init(
                                    E.Call,
                                    .{
                                        .target = Expr.initIdentifier(ast.wrapper_ref, Logger.Loc.Empty),
                                    },
                                    Logger.Loc.Empty,
                                ),
                            },
                            Logger.Loc.Empty,
                        ),
                    ) catch unreachable;
                },
                else => {},
            }

            // TODO:
            // If we are generating CommonJS for node, encode the known export names in
            // a form that node can understand them. This relies on the specific behavior
            // of this parser, which the node project uses to detect named exports in
            // CommonJS files: https://github.com/guybedford/cjs-module-lexer. Think of
            // this code as an annotation for that parser.
        },
    }

    if (stmts.items.len == 0) {
        return .{
            .javascript = .{
                .source_index = source_index,
                .result = .{ .result = .{
                    .code = "",
                } },
            },
        };
    }

    const print_options = js_printer.Options{
        // TODO: IIFE indent
        .indent = .{},
        .has_run_symbol_renamer = true,

        .allocator = allocator,
        .to_esm_ref = toESMRef,
        .to_commonjs_ref = toCommonJSRef,
        .require_or_import_meta_for_source_callback = js_printer.RequireOrImportMeta.Callback.init(LinkerContext, LinkerContext.requireOrImportMetaForSource, c),

        .minify_whitespace = c.options.minify_whitespace,
        .print_dce_annotations = c.options.emit_dce_annotations,
        .minify_syntax = c.options.minify_syntax,
        .mangled_props = &c.mangled_props,
        // .const_values = c.graph.const_values,
    };

    return .{
        .javascript = .{
            .result = js_printer.print(
                allocator,
                c.resolver.opts.target,
                ast.toAST(),
                c.getSource(source_index),
                print_options,
                ast.import_records.slice(),
                &[_]Part{
                    .{
                        .stmts = stmts.items,
                    },
                },
                r,
                false,
            ),
            .source_index = source_index,
        },
    };
}

const bun = @import("bun");
const strings = bun.strings;
const LinkerContext = bun.bundle_v2.LinkerContext;
const Index = bun.bundle_v2.Index;
const ImportRecord = bun.ImportRecord;
const Part = bun.bundle_v2.Part;
const std = @import("std");

const JSMeta = bun.bundle_v2.JSMeta;
const JSAst = bun.bundle_v2.JSAst;
const js_ast = bun.bundle_v2.js_ast;
const Ref = bun.bundle_v2.js_ast.Ref;
const ResolvedExports = bun.bundle_v2.ResolvedExports;
const Logger = bun.logger;
const RefImportData = bun.bundle_v2.RefImportData;
const options = bun.options;
const js_printer = bun.bundle_v2.js_printer;
const renamer = bun.bundle_v2.renamer;
const Chunk = bun.bundle_v2.Chunk;

const Stmt = js_ast.Stmt;
const Expr = js_ast.Expr;
const E = js_ast.E;
const S = js_ast.S;
const G = js_ast.G;
const B = js_ast.B;

const Binding = js_ast.Binding;

const GenerateChunkCtx = bun.bundle_v2.LinkerContext.GenerateChunkCtx;
const ThreadPool = bun.bundle_v2.ThreadPool;

const Scope = js_ast.Scope;
const Fs = bun.bundle_v2.Fs;
const CompileResult = bun.bundle_v2.CompileResult;
const StringJoiner = bun.StringJoiner;

const CompileResultForSourceMap = bun.bundle_v2.CompileResultForSourceMap;

const MutableString = bun.MutableString;
