pub const Parser = struct {
    options: Options,
    lexer: js_lexer.Lexer,
    log: *logger.Log,
    source: *const logger.Source,
    define: *Define,
    allocator: Allocator,

    pub const Options = struct {
        jsx: options.JSX.Pragma,
        ts: bool = false,
        keep_names: bool = true,
        ignore_dce_annotations: bool = false,
        preserve_unused_imports_ts: bool = false,
        use_define_for_class_fields: bool = false,
        suppress_warnings_about_weird_code: bool = true,
        filepath_hash_for_hmr: u32 = 0,
        features: RuntimeFeatures = .{},

        tree_shaking: bool = false,
        bundle: bool = false,
        code_splitting: bool = false,
        package_version: string = "",

        macro_context: *MacroContextType() = undefined,

        warn_about_unbundled_modules: bool = true,

        module_type: options.ModuleType = .unknown,
        output_format: options.Format = .esm,

        transform_only: bool = false,

        /// Used for inlining the state of import.meta.main during visiting
        import_meta_main_value: ?bool = null,
        lower_import_meta_main_for_node_js: bool = false,

        /// When using react fast refresh or server components, the framework is
        /// able to customize what import sources are used.
        framework: ?*bun.bake.Framework = null,

        /// REPL mode: transforms code for interactive evaluation
        /// - Wraps lone object literals `{...}` in parentheses
        /// - Hoists variable declarations for REPL persistence
        /// - Wraps last expression in { value: expr } for result capture
        /// - Wraps code with await in async IIFE
        repl_mode: bool = false,

        pub fn hashForRuntimeTranspiler(this: *const Options, hasher: *std.hash.Wyhash, did_use_jsx: bool) void {
            bun.assert(!this.bundle);

            if (did_use_jsx) {
                if (this.jsx.parse) {
                    this.jsx.hashForRuntimeTranspiler(hasher);
                    // this holds the values for the jsx optimizaiton flags, which have both been removed
                    // as the optimizations break newer versions of react, see https://github.com/oven-sh/bun/issues/11025
                    const jsx_optimizations = [_]bool{ false, false };
                    hasher.update(std.mem.asBytes(&jsx_optimizations));
                } else {
                    hasher.update("NO_JSX");
                }
            }

            if (this.ts) {
                hasher.update("TS");
            } else {
                hasher.update("NO_TS");
            }

            if (this.ignore_dce_annotations) {
                hasher.update("no_dce");
            }

            this.features.hashForRuntimeTranspiler(hasher);
        }

        // Used to determine if `joinWithComma` should be called in `visitStmts`. We do this
        // to avoid changing line numbers too much to make source mapping more readable
        pub fn runtimeMergeAdjacentExpressionStatements(this: Options) bool {
            return this.bundle;
        }

        pub fn init(jsx: options.JSX.Pragma, loader: options.Loader) Options {
            var opts = Options{
                .ts = loader.isTypeScript(),
                .jsx = jsx,
            };
            opts.jsx.parse = loader.isJSX();
            return opts;
        }
    };

    pub fn scanImports(self: *Parser, scan_pass: *ScanPassResult) anyerror!void {
        if (self.options.ts and self.options.jsx.parse) {
            return try self._scanImports(TSXImportScanner, scan_pass);
        } else if (self.options.ts) {
            return try self._scanImports(TypeScriptImportScanner, scan_pass);
        } else if (self.options.jsx.parse) {
            return try self._scanImports(JSXImportScanner, scan_pass);
        } else {
            return try self._scanImports(JavaScriptImportScanner, scan_pass);
        }
    }

    fn _scanImports(self: *Parser, comptime ParserType: type, scan_pass: *ScanPassResult) anyerror!void {
        var p: ParserType = undefined;

        try ParserType.init(self.allocator, self.log, self.source, self.define, self.lexer, self.options, &p);
        p.import_records = &scan_pass.import_records;
        p.named_imports = &scan_pass.named_imports;

        // The problem with our scan pass approach is type-only imports.
        // We don't have accurate symbol counts.
        // So we don't have a good way to distinguish between a type-only import and not.
        if (comptime ParserType.parser_features.typescript) {
            p.parse_pass_symbol_uses = &scan_pass.used_symbols;
        }

        // Parse the file in the first pass, but do not bind symbols
        var opts = ParseStatementOptions{ .is_module_scope = true };

        // Parsing seems to take around 2x as much time as visiting.
        // Which makes sense.
        // June 4: "Parsing took: 18028000"
        // June 4: "Rest of this took: 8003000"
        _ = p.parseStmtsUpTo(js_lexer.T.t_end_of_file, &opts) catch |err| {
            if (err == error.StackOverflow) {
                // The lexer location won't be totally accurate, but it's kind of helpful.
                try p.log.addError(p.source, p.lexer.loc(), "Maximum call stack size exceeded");
                return;
            }
            return err;
        };

        //
        if (comptime ParserType.parser_features.typescript) {
            for (scan_pass.import_records.items) |*import_record| {
                // Mark everything as unused
                // Except:
                // - export * as ns from 'foo';
                // - export * from 'foo';
                // - import 'foo';
                // - import("foo")
                // - require("foo")
                import_record.flags.is_unused = import_record.flags.is_unused or
                    (import_record.kind == .stmt and
                        !import_record.flags.was_originally_bare_import and
                        !import_record.flags.calls_runtime_re_export_fn);
            }

            var iter = scan_pass.used_symbols.iterator();
            while (iter.next()) |entry| {
                const val = entry.value_ptr;
                if (val.used) {
                    scan_pass.import_records.items[val.import_record_index].flags.is_unused = false;
                }
            }
        }

        // Symbol use counts are unavailable
        // So we say "did we parse any JSX?"
        // if yes, just automatically add the import so that .bun knows to include the file.
        if (self.options.jsx.parse and p.needs_jsx_import) {
            _ = p.addImportRecord(
                .require,
                logger.Loc{ .start = 0 },
                p.options.jsx.importSource(),
            );
            // Ensure we have both classic and automatic
            // This is to handle cases where they use fragments in the automatic runtime
            _ = p.addImportRecord(
                .require,
                logger.Loc{ .start = 0 },
                p.options.jsx.classic_import_source,
            );
        }

        scan_pass.approximate_newline_count = p.lexer.approximate_newline_count;
    }

    pub fn toLazyExportAST(this: *Parser, expr: Expr, comptime runtime_api_call: []const u8, symbols: Symbol.List) !js_ast.Result {
        var p: JavaScriptParser = undefined;
        try JavaScriptParser.init(this.allocator, this.log, this.source, this.define, this.lexer, this.options, &p);
        defer p.lexer.deinit();

        p.lexer.track_comments = this.options.features.minify_identifiers;
        // Instead of doing "should_fold_typescript_constant_expressions or features.minify_syntax"
        // Let's enable this flag file-wide
        if (p.options.features.minify_syntax or
            p.options.features.inlining)
        {
            p.should_fold_typescript_constant_expressions = true;
        }

        // If we added to `p.symbols` it's going to fuck up all the indices
        // in the `symbols` array.
        bun.assert(p.symbols.items.len == 0);
        var symbols_ = symbols;
        p.symbols = symbols_.moveToListManaged(p.allocator);

        try p.prepareForVisitPass();

        var final_expr = expr;

        // Optionally call a runtime API function to transform the expression
        if (runtime_api_call.len > 0) {
            var args = try p.allocator.alloc(Expr, 1);
            args[0] = expr;
            final_expr = p.callRuntime(expr.loc, runtime_api_call, args);
        }

        const ns_export_part = js_ast.Part{
            .can_be_removed_if_unused = true,
        };

        var stmts = try p.allocator.alloc(js_ast.Stmt, 1);
        stmts[0] = Stmt{
            .data = .{
                .s_lazy_export = brk: {
                    const data = try p.allocator.create(Expr.Data);
                    data.* = final_expr.data;
                    break :brk data;
                },
            },
            .loc = expr.loc,
        };
        const part = js_ast.Part{
            .stmts = stmts,
            .symbol_uses = p.symbol_uses,
        };
        p.symbol_uses = .{};
        var parts = try ListManaged(js_ast.Part).initCapacity(p.allocator, 2);
        parts.appendSliceAssumeCapacity(&.{ ns_export_part, part });

        const exports_kind: js_ast.ExportsKind = brk: {
            if (expr.data == .e_undefined) {
                if (strings.eqlComptime(this.source.path.name.ext, ".cjs")) break :brk .cjs;
                if (strings.eqlComptime(this.source.path.name.ext, ".mjs")) break :brk .esm;
            }
            break :brk .none;
        };
        return .{ .ast = try p.toAST(&parts, exports_kind, .none, "") };
    }

    pub fn parse(self: *Parser) !js_ast.Result {
        if (comptime Environment.isWasm) {
            self.options.ts = true;
            self.options.jsx.parse = true;
            return try self._parse(TSXParser);
        }

        if (self.options.ts and self.options.jsx.parse) {
            return try self._parse(TSXParser);
        } else if (self.options.ts) {
            return try self._parse(TypeScriptParser);
        } else if (self.options.jsx.parse) {
            return try self._parse(JSXParser);
        } else {
            return try self._parse(JavaScriptParser);
        }
    }

    pub fn analyze(self: *Parser, context: *anyopaque, callback: *const fn (*anyopaque, *TSXParser, []js_ast.Part) anyerror!void) anyerror!void {
        var p: TSXParser = undefined;
        try TSXParser.init(self.allocator, self.log, self.source, self.define, self.lexer, self.options, &p);

        defer p.lexer.deinit();

        // Consume a leading hashbang comment
        var hashbang: string = "";
        if (p.lexer.token == .t_hashbang) {
            hashbang = p.lexer.identifier;
            try p.lexer.next();
        }

        // Parse the file in the first pass, but do not bind symbols
        var opts = ParseStatementOptions{ .is_module_scope = true };
        const parse_tracer = bun.perf.trace("JSParser.parse");

        const stmts = p.parseStmtsUpTo(js_lexer.T.t_end_of_file, &opts) catch |err| {
            if (comptime Environment.isWasm) {
                Output.print("JSParser.parse: caught error {s} at location: {d}\n", .{ @errorName(err), p.lexer.loc().start });
                p.log.print(Output.writer()) catch {};
            }
            return err;
        };

        parse_tracer.end();

        if (self.log.errors > 0) {
            if (comptime Environment.isWasm) {
                // If the logger is backed by console.log, every print appends a newline.
                // so buffering is kind of mandatory here
                const fakeWriter = struct {
                    fn writeAll(_: @This(), data: []const u8) anyerror!usize {
                        if (data.len == 0) return 0;

                        Output.print("{s}", .{data});
                        return data.len;
                    }
                };
                const writer = std.Io.GenericWriter(fakeWriter, anyerror, fakeWriter.writeAll){
                    .context = fakeWriter{},
                };
                var buffered_writer = bun.deprecated.bufferedWriter(writer);
                const actual = buffered_writer.writer();
                for (self.log.msgs.items) |msg| {
                    var m: logger.Msg = msg;
                    m.writeFormat(actual, true) catch {};
                }
                buffered_writer.flush() catch {};
            }
            return error.SyntaxError;
        }

        const visit_tracer = bun.perf.trace("JSParser.visit");
        try p.prepareForVisitPass();

        var parts = ListManaged(js_ast.Part).init(p.allocator);
        defer parts.deinit();

        try p.appendPart(&parts, stmts);
        visit_tracer.end();

        const analyze_tracer = bun.perf.trace("JSParser.analyze");
        try callback(context, &p, parts.items);
        analyze_tracer.end();
    }

    fn _parse(noalias self: *Parser, comptime ParserType: type) !js_ast.Result {
        const prev_action = bun.crash_handler.current_action;
        defer bun.crash_handler.current_action = prev_action;
        bun.crash_handler.current_action = .{ .parse = self.source.path.text };

        var p: ParserType = undefined;
        const orig_error_count = self.log.errors;
        try ParserType.init(self.allocator, self.log, self.source, self.define, self.lexer, self.options, &p);

        if (p.options.features.hot_module_reloading) {
            bun.assert(!p.options.tree_shaking);
        }

        // Instead of doing "should_fold_typescript_constant_expressions or features.minify_syntax"
        // Let's enable this flag file-wide
        if (p.options.features.minify_syntax or
            p.options.features.inlining)
        {
            p.should_fold_typescript_constant_expressions = true;
        }

        defer p.lexer.deinit();

        var binary_expression_stack_heap = std.heap.stackFallback(42 * @sizeOf(ParserType.BinaryExpressionVisitor), bun.default_allocator);
        p.binary_expression_stack = std.array_list.Managed(ParserType.BinaryExpressionVisitor).initCapacity(
            binary_expression_stack_heap.get(),
            41, // one less in case of unlikely alignment between the stack buffer and reality
        ) catch unreachable; // stack allocation cannot fail
        defer p.binary_expression_stack.clearAndFree();

        var binary_expression_simplify_stack_heap = std.heap.stackFallback(48 * @sizeOf(SideEffects.BinaryExpressionSimplifyVisitor), bun.default_allocator);
        p.binary_expression_simplify_stack = std.array_list.Managed(SideEffects.BinaryExpressionSimplifyVisitor).initCapacity(
            binary_expression_simplify_stack_heap.get(),
            47,
        ) catch unreachable; // stack allocation cannot fail
        defer p.binary_expression_simplify_stack.clearAndFree();

        if (Environment.allow_assert) {
            bun.assert(binary_expression_stack_heap.fixed_buffer_allocator.ownsPtr(@ptrCast(p.binary_expression_stack.items)));
            bun.assert(binary_expression_simplify_stack_heap.fixed_buffer_allocator.ownsPtr(@ptrCast(p.binary_expression_simplify_stack.items)));
        }

        // defer {
        //     if (p.allocated_names_pool) |pool| {
        //         pool.data = p.allocated_names;
        //         pool.release();
        //         p.allocated_names_pool = null;
        //     }
        // }

        // Consume a leading hashbang comment
        var hashbang: string = "";
        if (p.lexer.token == .t_hashbang) {
            hashbang = p.lexer.identifier;
            try p.lexer.next();
        }

        // Detect a leading "// @bun" pragma
        if (self.options.features.dont_bundle_twice) {
            if (self.hasBunPragma(hashbang.len > 0)) |pragma| {
                return js_ast.Result{
                    .already_bundled = pragma,
                };
            }
        }

        // We must check the cache only after we've consumed the hashbang and leading // @bun pragma
        // We don't want to ever put files with `// @bun` into this cache, as that would be wasteful.
        if (comptime Environment.isNative and bun.FeatureFlags.runtime_transpiler_cache) {
            const runtime_transpiler_cache: ?*bun.jsc.RuntimeTranspilerCache = p.options.features.runtime_transpiler_cache;
            if (runtime_transpiler_cache) |cache| {
                if (cache.get(p.source, &p.options, p.options.jsx.parse and (!p.source.path.isNodeModule() or p.source.path.isJSXFile()))) {
                    return js_ast.Result{
                        .cached = {},
                    };
                }
            }
        }

        // Parse the file in the first pass, but do not bind symbols
        var opts = ParseStatementOptions{ .is_module_scope = true };
        const parse_tracer = bun.perf.trace("JSParser.parse");

        // Parsing seems to take around 2x as much time as visiting.
        // Which makes sense.
        // June 4: "Parsing took: 18028000"
        // June 4: "Rest of this took: 8003000"
        const stmts = p.parseStmtsUpTo(js_lexer.T.t_end_of_file, &opts) catch |err| {
            parse_tracer.end();
            if (err == error.StackOverflow) {
                // The lexer location won't be totally accurate, but it's kind of helpful.
                try p.log.addError(p.source, p.lexer.loc(), "Maximum call stack size exceeded");

                // Return a SyntaxError so that we reuse existing code for handling errors.
                return error.SyntaxError;
            }

            return err;
        };

        parse_tracer.end();

        // Halt parsing right here if there were any errors
        // This fixes various conditions that would cause crashes due to the AST being in an invalid state while visiting
        // In a number of situations, we continue to parsing despite errors so that we can report more errors to the user
        //   Example where NOT halting causes a crash: A TS enum with a number literal as a member name
        //     https://discord.com/channels/876711213126520882/876711213126520885/1039325382488371280
        if (self.log.errors > orig_error_count) {
            return error.SyntaxError;
        }

        bun.crash_handler.current_action = .{ .visit = self.source.path.text };

        const visit_tracer = bun.perf.trace("JSParser.visit");
        try p.prepareForVisitPass();

        var before = ListManaged(js_ast.Part).init(p.allocator);
        var after = ListManaged(js_ast.Part).init(p.allocator);
        var parts = ListManaged(js_ast.Part).init(p.allocator);
        defer {
            after.deinit();
            before.deinit();
        }

        if (p.options.bundle) {
            // The bundler requires a part for generated module wrappers. This
            // part must be at the start as it is referred to by index.
            bun.handleOom(before.append(js_ast.Part{}));
        }

        // --inspect-brk
        if (p.options.features.set_breakpoint_on_first_line) {
            var debugger_stmts = try p.allocator.alloc(Stmt, 1);
            debugger_stmts[0] = Stmt{
                .data = .{ .s_debugger = .{} },
                .loc = logger.Loc.Empty,
            };
            before.append(
                js_ast.Part{
                    .stmts = debugger_stmts,
                },
            ) catch |err| bun.handleOom(err);
        }

        // When "using" declarations appear at the top level, we change all TDZ
        // variables in the top-level scope into "var" so that they aren't harmed
        // when they are moved into the try/catch statement that lowering will
        // generate.
        //
        // This is necessary because exported function declarations must be hoisted
        // outside of the try/catch statement because they can be evaluated before
        // this module is evaluated due to ESM cross-file function hoisting. And
        // these function bodies might reference anything else in this scope, which
        // must still work when those things are moved inside a try/catch statement.
        //
        // Before:
        //
        //   using foo = get()
        //   export function fn() {
        //     return [foo, new Bar]
        //   }
        //   class Bar {}
        //
        // After ("fn" is hoisted, "Bar" is converted to "var"):
        //
        //   export function fn() {
        //     return [foo, new Bar]
        //   }
        //   try {
        //     var foo = get();
        //     var Bar = class {};
        //   } catch (_) {
        //     ...
        //   } finally {
        //     ...
        //   }
        //
        // This is also necessary because other code might be appended to the code
        // that we're processing and expect to be able to access top-level variables.
        p.will_wrap_module_in_try_catch_for_using = p.shouldLowerUsingDeclarations(stmts);

        // Bind symbols in a second pass over the AST. I started off doing this in a
        // single pass, but it turns out it's pretty much impossible to do this
        // correctly while handling arrow functions because of the grammar
        // ambiguities.
        //
        // Note that top-level lowered "using" declarations disable tree-shaking
        // because we only do tree-shaking on top-level statements and lowering
        // a top-level "using" declaration moves all top-level statements into a
        // nested scope.
        if (!p.options.tree_shaking or p.will_wrap_module_in_try_catch_for_using) {
            // When tree shaking is disabled, everything comes in a single part
            try p.appendPart(&parts, stmts);
        } else {
            // Preprocess TypeScript enums to improve code generation. Otherwise
            // uses of an enum before that enum has been declared won't be inlined:
            //
            //   console.log(Foo.FOO) // We want "FOO" to be inlined here
            //   const enum Foo { FOO = 0 }
            //
            // The TypeScript compiler itself contains code with this pattern, so
            // it's important to implement this optimization.

            var preprocessed_enums: std.ArrayListUnmanaged([]js_ast.Part) = .{};
            var preprocessed_enum_i: usize = 0;
            if (p.scopes_in_order_for_enum.count() > 0) {
                for (stmts) |*stmt| {
                    if (stmt.data == .s_enum) {
                        const old_scopes_in_order = p.scope_order_to_visit;
                        defer p.scope_order_to_visit = old_scopes_in_order;

                        p.scope_order_to_visit = p.scopes_in_order_for_enum.get(stmt.loc).?;

                        var enum_parts = ListManaged(js_ast.Part).init(p.allocator);
                        var sliced = try ListManaged(Stmt).initCapacity(p.allocator, 1);
                        sliced.appendAssumeCapacity(stmt.*);
                        try p.appendPart(&enum_parts, sliced.items);
                        try preprocessed_enums.append(p.allocator, enum_parts.items);
                    }
                }
            }

            // When tree shaking is enabled, each top-level statement is potentially a separate part.
            for (stmts) |stmt| {
                switch (stmt.data) {
                    .s_local => |local| {
                        if (local.decls.len > 1) {
                            for (local.decls.slice()) |decl| {
                                var sliced = try ListManaged(Stmt).initCapacity(p.allocator, 1);
                                sliced.items.len = 1;
                                var _local = local.*;
                                _local.decls = try .initOne(p.allocator, decl);
                                sliced.items[0] = p.s(_local, stmt.loc);
                                try p.appendPart(&parts, sliced.items);
                            }
                        } else {
                            var sliced = try ListManaged(Stmt).initCapacity(p.allocator, 1);
                            sliced.items.len = 1;
                            sliced.items[0] = stmt;
                            try p.appendPart(&parts, sliced.items);
                        }
                    },
                    .s_import, .s_export_from, .s_export_star => {
                        const parts_list = if (p.options.bundle)
                            // Move imports (and import-like exports) to the top of the file to
                            // ensure that if they are converted to a require() call, the effects
                            // will take place before any other statements are evaluated.
                            &before
                        else
                            // If we aren't doing any format conversion, just keep these statements
                            // inline where they were. Exports are sorted so order doesn't matter:
                            // https://262.ecma-international.org/6.0/#sec-module-namespace-exotic-objects.
                            // However, this is likely an aesthetic issue that some people will
                            // complain about. In addition, there are code transformation tools
                            // such as TypeScript and Babel with bugs where the order of exports
                            // in the file is incorrectly preserved instead of sorted, so preserving
                            // the order of exports ourselves here may be preferable.
                            &parts;

                        var sliced = try ListManaged(Stmt).initCapacity(p.allocator, 1);
                        sliced.items.len = 1;
                        sliced.items[0] = stmt;
                        try p.appendPart(parts_list, sliced.items);
                    },

                    .s_class => |class| {
                        // Move class export statements to the top of the file if we can
                        // This automatically resolves some cyclical import issues
                        // https://github.com/kysely-org/kysely/issues/412
                        const should_move = !p.options.bundle and class.class.canBeMoved();

                        var sliced = try ListManaged(Stmt).initCapacity(p.allocator, 1);
                        sliced.items.len = 1;
                        sliced.items[0] = stmt;
                        try p.appendPart(&parts, sliced.items);

                        if (should_move) {
                            before.append(parts.getLast()) catch unreachable;
                            parts.items.len -= 1;
                        }
                    },
                    .s_export_default => |value| {
                        // We move export default statements when we can
                        // This automatically resolves some cyclical import issues in packages like luxon
                        // https://github.com/oven-sh/bun/issues/1961
                        const should_move = !p.options.bundle and value.canBeMoved();
                        var sliced = try ListManaged(Stmt).initCapacity(p.allocator, 1);
                        sliced.items.len = 1;
                        sliced.items[0] = stmt;
                        try p.appendPart(&parts, sliced.items);

                        if (should_move) {
                            before.append(parts.getLast()) catch unreachable;
                            parts.items.len -= 1;
                        }
                    },
                    .s_enum => {
                        try parts.appendSlice(preprocessed_enums.items[preprocessed_enum_i]);
                        preprocessed_enum_i += 1;

                        const enum_scope_count = p.scopes_in_order_for_enum.get(stmt.loc).?.len;
                        p.scope_order_to_visit = p.scope_order_to_visit[enum_scope_count..];
                    },
                    else => {
                        var sliced = try ListManaged(Stmt).initCapacity(p.allocator, 1);
                        sliced.appendAssumeCapacity(stmt);
                        try p.appendPart(&parts, sliced.items);
                    },
                }
            }
        }

        visit_tracer.end();

        // If there were errors while visiting, also halt here
        if (self.log.errors > orig_error_count) {
            return error.SyntaxError;
        }

        const postvisit_tracer = bun.perf.trace("JSParser.postvisit");
        defer postvisit_tracer.end();

        var uses_dirname = p.symbols.items[p.dirname_ref.innerIndex()].use_count_estimate > 0;
        var uses_filename = p.symbols.items[p.filename_ref.innerIndex()].use_count_estimate > 0;

        // Handle dirname and filename at bundle-time
        // We always inject it at the top of the module
        //
        // This inlines
        //
        //    var __dirname = "foo/bar"
        //    var __filename = "foo/bar/baz.js"
        //
        if (p.options.bundle or !p.options.features.commonjs_at_runtime) {
            if (uses_dirname or uses_filename) {
                const count = @as(usize, @intFromBool(uses_dirname)) + @as(usize, @intFromBool(uses_filename));
                var declared_symbols = DeclaredSymbol.List.initCapacity(p.allocator, count) catch unreachable;
                var decls = p.allocator.alloc(G.Decl, count) catch unreachable;
                if (uses_dirname) {
                    decls[0] = .{
                        .binding = p.b(B.Identifier{ .ref = p.dirname_ref }, logger.Loc.Empty),
                        .value = p.newExpr(
                            E.String{
                                .data = p.source.path.name.dir,
                            },
                            logger.Loc.Empty,
                        ),
                    };
                    declared_symbols.appendAssumeCapacity(.{ .ref = p.dirname_ref, .is_top_level = true });
                }
                if (uses_filename) {
                    decls[@as(usize, @intFromBool(uses_dirname))] = .{
                        .binding = p.b(B.Identifier{ .ref = p.filename_ref }, logger.Loc.Empty),
                        .value = p.newExpr(
                            E.String{
                                .data = p.source.path.text,
                            },
                            logger.Loc.Empty,
                        ),
                    };
                    declared_symbols.appendAssumeCapacity(.{ .ref = p.filename_ref, .is_top_level = true });
                }

                var part_stmts = p.allocator.alloc(Stmt, 1) catch unreachable;
                part_stmts[0] = p.s(S.Local{
                    .kind = .k_var,
                    .decls = Decl.List.fromOwnedSlice(decls),
                }, logger.Loc.Empty);
                before.append(js_ast.Part{
                    .stmts = part_stmts,
                    .declared_symbols = declared_symbols,
                    .tag = .dirname_filename,
                }) catch unreachable;
                uses_dirname = false;
                uses_filename = false;
            }
        }

        // This is a workaround for broken module environment checks in packages like lodash-es
        // https://github.com/lodash/lodash/issues/5660
        var force_esm = false;

        if (p.shouldUnwrapCommonJSToESM()) {
            if (p.imports_to_convert_from_require.items.len > 0) {
                const all_stmts = p.allocator.alloc(Stmt, p.imports_to_convert_from_require.items.len) catch unreachable;
                before.ensureUnusedCapacity(p.imports_to_convert_from_require.items.len) catch unreachable;

                var remaining_stmts = all_stmts;

                for (p.imports_to_convert_from_require.items) |deferred_import| {
                    var import_part_stmts = remaining_stmts[0..1];
                    remaining_stmts = remaining_stmts[1..];

                    bun.handleOom(p.module_scope.generated.append(p.allocator, deferred_import.namespace.ref.?));

                    import_part_stmts[0] = Stmt.alloc(
                        S.Import,
                        S.Import{
                            .star_name_loc = deferred_import.namespace.loc,
                            .import_record_index = deferred_import.import_record_id,
                            .namespace_ref = deferred_import.namespace.ref.?,
                        },
                        deferred_import.namespace.loc,
                    );
                    var declared_symbols = DeclaredSymbol.List.initCapacity(p.allocator, 1) catch unreachable;
                    declared_symbols.appendAssumeCapacity(.{ .ref = deferred_import.namespace.ref.?, .is_top_level = true });
                    before.appendAssumeCapacity(.{
                        .stmts = import_part_stmts,
                        .declared_symbols = declared_symbols,
                        .tag = .import_to_convert_from_require,
                        // This part has a single symbol, so it may be removed if unused.
                        .can_be_removed_if_unused = true,
                    });
                }
                bun.assert(remaining_stmts.len == 0);
            }

            if (p.commonjs_named_exports.count() > 0) {
                const export_refs = p.commonjs_named_exports.values();
                const export_names = p.commonjs_named_exports.keys();

                break_optimize: {
                    if (!p.commonjs_named_exports_deoptimized) {
                        var needs_decl_count: usize = 0;
                        for (export_refs) |*export_ref| {
                            needs_decl_count += @as(usize, @intFromBool(export_ref.needs_decl));
                        }
                        // This is a workaround for packages which have broken ESM checks
                        // If they never actually assign to exports.foo, only check for it
                        // and the package specifies type "module"
                        // and the package uses ESM syntax
                        // We should just say
                        // You're ESM and lying about it.
                        if (p.options.module_type == .esm or p.has_es_module_syntax) {
                            if (needs_decl_count == export_names.len) {
                                force_esm = true;
                                break :break_optimize;
                            }
                        }

                        if (needs_decl_count > 0) {
                            p.symbols.items[p.exports_ref.innerIndex()].use_count_estimate += @as(u32, @truncate(export_refs.len));
                            p.deoptimizeCommonJSNamedExports();
                        }
                    }
                }

                if (!p.commonjs_named_exports_deoptimized and p.esm_export_keyword.len == 0) {
                    p.esm_export_keyword.loc = export_refs[0].loc_ref.loc;
                    p.esm_export_keyword.len = 5;
                }
            }
        }

        if (parts.items.len < 4 and parts.items.len > 0 and p.options.features.unwrap_commonjs_to_esm) {
            // Specially handle modules shaped like this:
            //
            //   CommonJS:
            //
            //    if (process.env.NODE_ENV === 'production')
            //         module.exports = require('./foo.prod.js')
            //     else
            //         module.exports = require('./foo.dev.js')
            //
            // Find the part containing the actual module.exports = require() statement,
            // skipping over parts that only contain comments, directives, and empty statements.
            // This handles files like:
            //
            //    /*!
            //     * express
            //     * MIT Licensed
            //     */
            //    'use strict';
            //    module.exports = require('./lib/express');
            //
            // When tree-shaking is enabled, each statement becomes its own part, so we need
            // to look across all parts to find the single meaningful statement.
            const StmtAndPart = struct { stmt: Stmt, part_idx: usize };
            const stmt_and_part: ?StmtAndPart = brk: {
                var found: ?StmtAndPart = null;
                for (parts.items, 0..) |part, part_idx| {
                    for (part.stmts) |s| {
                        switch (s.data) {
                            .s_comment, .s_directive, .s_empty => continue,
                            else => {
                                // If we already found a non-trivial statement, there's more than one
                                if (found != null) break :brk null;
                                found = .{ .stmt = s, .part_idx = part_idx };
                            },
                        }
                    }
                }
                break :brk found;
            };
            if (stmt_and_part) |found| {
                const stmt = found.stmt;
                var part = &parts.items[found.part_idx];
                if (p.symbols.items[p.module_ref.innerIndex()].use_count_estimate == 1) {
                    if (stmt.data == .s_expr) {
                        const value: Expr = stmt.data.s_expr.value;

                        if (value.data == .e_binary) {
                            const bin = value.data.e_binary;
                            const left = bin.left;
                            const right = bin.right;
                            if (bin.op == .bin_assign and
                                left.data == .e_dot and
                                strings.eqlComptime(left.data.e_dot.name, "exports") and
                                left.data.e_dot.target.data == .e_identifier and
                                left.data.e_dot.target.data.e_identifier.ref.eql(p.module_ref))
                            {
                                const redirect_import_record_index: ?u32 = inner_brk: {
                                    // general case:
                                    //
                                    //      module.exports = require("foo");
                                    //
                                    if (right.data == .e_require_string) {
                                        break :inner_brk right.data.e_require_string.import_record_index;
                                    }

                                    // special case: a module for us to unwrap
                                    //
                                    //      module.exports = require("react/jsx-runtime")
                                    //                       ^ was converted into:
                                    //
                                    //      import * as Foo from 'bar';
                                    //      module.exports = Foo;
                                    //
                                    // This is what fixes #3537
                                    if (right.data == .e_identifier and
                                        p.import_records.items.len == 1 and
                                        p.imports_to_convert_from_require.items.len == 1 and
                                        p.imports_to_convert_from_require.items[0].namespace.ref.?.eql(right.data.e_identifier.ref))
                                    {
                                        // We know it's 0 because there is only one import in the whole file
                                        // so that one import must be the one we're looking for
                                        break :inner_brk 0;
                                    }

                                    break :inner_brk null;
                                };
                                if (redirect_import_record_index) |id| {
                                    part.symbol_uses = .{};
                                    return js_ast.Result{
                                        .ast = js_ast.Ast{
                                            .import_records = ImportRecord.List.moveFromList(&p.import_records),
                                            .redirect_import_record_index = id,
                                            .named_imports = p.named_imports,
                                            .named_exports = p.named_exports,
                                        },
                                    };
                                }
                            }
                        }
                    }
                }
            }

            if (p.commonjs_named_exports_deoptimized and
                p.options.features.unwrap_commonjs_to_esm and
                p.unwrap_all_requires and
                p.imports_to_convert_from_require.items.len == 1 and
                p.import_records.items.len == 1 and
                p.symbols.items[p.module_ref.innerIndex()].use_count_estimate == 1)
            {
                for (parts.items) |*part| {
                    // Specially handle modules shaped like this:
                    //
                    //    doSomeStuff();
                    //    module.exports = require('./foo.js');
                    //
                    // An example is react-dom/index.js, which does a DCE check.
                    if (part.stmts.len > 1) break;

                    for (part.stmts, 0..) |*stmt, j| {
                        if (stmt.data == .s_expr) {
                            const value: Expr = stmt.data.s_expr.value;

                            if (value.data == .e_binary) {
                                var bin = value.data.e_binary;
                                while (true) {
                                    const left = bin.left;
                                    const right = bin.right;

                                    if (bin.op == .bin_assign and
                                        right.data == .e_require_string and
                                        left.data == .e_dot and
                                        strings.eqlComptime(left.data.e_dot.name, "exports") and
                                        left.data.e_dot.target.data == .e_identifier and
                                        left.data.e_dot.target.data.e_identifier.ref.eql(p.module_ref))
                                    {
                                        p.export_star_import_records.append(
                                            p.allocator,
                                            right.data.e_require_string.import_record_index,
                                        ) catch unreachable;
                                        const namespace_ref = p.imports_to_convert_from_require.items[
                                            right.data.e_require_string.unwrapped_id
                                        ].namespace.ref.?;

                                        part.stmts = brk: {
                                            var new_stmts = try StmtList.initCapacity(p.allocator, part.stmts.len + 1);
                                            new_stmts.appendSliceAssumeCapacity(part.stmts[0..j]);

                                            new_stmts.appendAssumeCapacity(Stmt.alloc(
                                                S.ExportStar,
                                                S.ExportStar{
                                                    .import_record_index = right.data.e_require_string.import_record_index,
                                                    .namespace_ref = namespace_ref,
                                                },
                                                stmt.loc,
                                            ));
                                            new_stmts.appendSliceAssumeCapacity(part.stmts[j + 1 ..]);
                                            break :brk new_stmts.items;
                                        };

                                        part.import_record_indices.append(
                                            p.allocator,
                                            right.data.e_require_string.import_record_index,
                                        ) catch |err| bun.handleOom(err);
                                        p.symbols.items[p.module_ref.innerIndex()].use_count_estimate = 0;
                                        p.symbols.items[namespace_ref.innerIndex()].use_count_estimate -|= 1;
                                        _ = part.symbol_uses.swapRemove(namespace_ref);

                                        for (before.items, 0..) |before_part, i| {
                                            if (before_part.tag == .import_to_convert_from_require) {
                                                _ = before.swapRemove(i);
                                                break;
                                            }
                                        }

                                        if (p.esm_export_keyword.len == 0) {
                                            p.esm_export_keyword.loc = stmt.loc;
                                            p.esm_export_keyword.len = 5;
                                        }
                                        p.commonjs_named_exports_deoptimized = false;
                                        break;
                                    }

                                    if (right.data == .e_binary) {
                                        bin = right.data.e_binary;
                                        continue;
                                    }

                                    break;
                                }
                            }
                        }
                    }
                }
            }
        } else if (p.options.bundle and parts.items.len == 0) {
            // This flag is disabled because it breaks circular export * as from
            //
            //  entry.js:
            //
            //    export * from './foo';
            //
            //  foo.js:
            //
            //    export const foo = 123
            //    export * as ns from './foo'
            //
            if (comptime FeatureFlags.export_star_redirect) {
                // If the file only contains "export * from './blah'
                // we pretend the file never existed in the first place.
                // the semantic difference here is in export default statements
                // note: export_star_import_records are not filled in yet

                if (before.items.len > 0 and p.import_records.items.len == 1) {
                    const export_star_redirect: ?*S.ExportStar = brk: {
                        var export_star: ?*S.ExportStar = null;
                        for (before.items) |part| {
                            for (part.stmts) |stmt| {
                                switch (stmt.data) {
                                    .s_export_star => |star| {
                                        if (star.alias != null) {
                                            break :brk null;
                                        }

                                        if (export_star != null) {
                                            break :brk null;
                                        }

                                        export_star = star;
                                    },
                                    .s_empty, .s_comment => {},
                                    else => {
                                        break :brk null;
                                    },
                                }
                            }
                        }
                        break :brk export_star;
                    };

                    if (export_star_redirect) |star| {
                        return js_ast.Result{
                            .ast = .{
                                .allocator = p.allocator,
                                .import_records = ImportRecord.List.init(p.import_records.items),
                                .redirect_import_record_index = star.import_record_index,
                                .named_imports = p.named_imports,
                                .named_exports = p.named_exports,
                            },
                        };
                    }
                }
            }
        }

        // Analyze cross-part dependencies for tree shaking and code splitting
        var exports_kind = js_ast.ExportsKind.none;
        const exports_ref_usage_count = p.symbols.items[p.exports_ref.innerIndex()].use_count_estimate;
        const uses_exports_ref = exports_ref_usage_count > 0;

        if (uses_exports_ref and p.commonjs_named_exports.count() > 0 and !force_esm) {
            p.deoptimizeCommonJSNamedExports();
        }

        const uses_module_ref = p.symbols.items[p.module_ref.innerIndex()].use_count_estimate > 0;

        var wrap_mode: WrapMode = .none;

        if (p.isDeoptimizedCommonJS()) {
            exports_kind = .cjs;
        } else if (p.esm_export_keyword.len > 0 or p.top_level_await_keyword.len > 0) {
            exports_kind = .esm;
        } else if (uses_exports_ref or uses_module_ref or p.has_top_level_return or p.has_with_scope) {
            exports_kind = .cjs;
            if (p.options.features.commonjs_at_runtime) {
                wrap_mode = .bun_commonjs;

                const import_record: ?*const ImportRecord = brk: {
                    for (p.import_records.items) |*import_record| {
                        if (import_record.flags.is_internal or import_record.flags.is_unused) continue;
                        if (import_record.kind == .stmt) break :brk import_record;
                    }

                    break :brk null;
                };

                // make it an error to use an import statement with a commonjs exports usage
                if (import_record) |record| {
                    // find the usage of the export symbol

                    var notes = ListManaged(logger.Data).init(p.allocator);

                    try notes.append(logger.Data{
                        .text = try std.fmt.allocPrint(p.allocator, "Try require({f}) instead", .{bun.fmt.QuotedFormatter{ .text = record.path.text }}),
                    });

                    if (uses_module_ref) {
                        try notes.append(logger.Data{
                            .text = "This file is CommonJS because 'module' was used",
                        });
                    }

                    if (uses_exports_ref) {
                        try notes.append(logger.Data{
                            .text = "This file is CommonJS because 'exports' was used",
                        });
                    }

                    if (p.has_top_level_return) {
                        try notes.append(logger.Data{
                            .text = "This file is CommonJS because top-level return was used",
                        });
                    }

                    if (p.has_with_scope) {
                        try notes.append(logger.Data{
                            .text = "This file is CommonJS because a \"with\" statement is used",
                        });
                    }

                    try p.log.addRangeErrorWithNotes(p.source, record.range, "Cannot use import statement with CommonJS-only features", notes.items);
                }
            }
        } else {
            switch (p.options.module_type) {
                // ".cjs" or ".cts" or ("type: commonjs" and (".js" or ".jsx" or ".ts" or ".tsx"))
                .cjs => {
                    // There are no commonjs-only features used (require is allowed in ESM)
                    bun.assert(!uses_exports_ref and
                        !uses_module_ref and
                        !p.has_top_level_return and
                        !p.has_with_scope);
                    // Use ESM if the file has ES module syntax (import)
                    exports_kind = if (p.has_es_module_syntax) .esm else .cjs;
                },
                .esm => {
                    exports_kind = .esm;
                },
                .unknown => {
                    // Divergence from esbuild and Node.js: we default to ESM
                    // when there are no exports.
                    //
                    // However, this breaks certain packages.
                    // For example, the checkpoint-client used by
                    // Prisma does an eval("__dirname") but does not export
                    // anything.
                    //
                    // If they use an import statement, we say it's ESM because that's not allowed in CommonJS files.
                    const uses_any_import_statements = brk: {
                        for (p.import_records.items) |*import_record| {
                            if (import_record.flags.is_internal or import_record.flags.is_unused) continue;
                            if (import_record.kind == .stmt) break :brk true;
                        }

                        break :brk false;
                    };

                    if (uses_any_import_statements) {
                        exports_kind = .esm;
                    }
                    // Otherwise, if they use CommonJS features its CommonJS.
                    // If you add a 'use strict'; at the top, you probably meant CommonJS because "use strict"; does nothing in ESM.
                    else if (p.symbols.items[p.require_ref.innerIndex()].use_count_estimate > 0 or uses_dirname or uses_filename or (!p.options.bundle and p.module_scope.strict_mode == .explicit_strict_mode)) {
                        exports_kind = .cjs;
                    } else {
                        // If unknown, we default to ESM
                        exports_kind = .esm;
                    }
                },
            }

            if (exports_kind == .cjs and p.options.features.commonjs_at_runtime) {
                wrap_mode = .bun_commonjs;
            }
        }

        // Handle dirname and filename at runtime.
        //
        // If we reach this point, it means:
        //
        // 1) we are building an ESM file that uses __dirname or __filename
        // 2) we are targeting bun's runtime.
        // 3) we are not bundling.
        //
        if (exports_kind == .esm and (uses_dirname or uses_filename)) {
            bun.assert(!p.options.bundle);
            const count = @as(usize, @intFromBool(uses_dirname)) + @as(usize, @intFromBool(uses_filename));
            var declared_symbols = DeclaredSymbol.List.initCapacity(p.allocator, count) catch unreachable;
            var decls = p.allocator.alloc(G.Decl, count) catch unreachable;
            if (uses_dirname) {
                // var __dirname = import.meta
                decls[0] = .{
                    .binding = p.b(B.Identifier{ .ref = p.dirname_ref }, logger.Loc.Empty),
                    .value = p.newExpr(
                        E.Dot{
                            .name = "dir",
                            .name_loc = logger.Loc.Empty,
                            .target = p.newExpr(E.ImportMeta{}, logger.Loc.Empty),
                        },
                        logger.Loc.Empty,
                    ),
                };
                declared_symbols.appendAssumeCapacity(.{ .ref = p.dirname_ref, .is_top_level = true });
            }
            if (uses_filename) {
                // var __filename = import.meta.path
                decls[@as(usize, @intFromBool(uses_dirname))] = .{
                    .binding = p.b(B.Identifier{ .ref = p.filename_ref }, logger.Loc.Empty),
                    .value = p.newExpr(
                        E.Dot{
                            .name = "path",
                            .name_loc = logger.Loc.Empty,
                            .target = p.newExpr(E.ImportMeta{}, logger.Loc.Empty),
                        },
                        logger.Loc.Empty,
                    ),
                };
                declared_symbols.appendAssumeCapacity(.{ .ref = p.filename_ref, .is_top_level = true });
            }

            var part_stmts = p.allocator.alloc(Stmt, 1) catch unreachable;
            part_stmts[0] = p.s(S.Local{
                .kind = .k_var,
                .decls = Decl.List.fromOwnedSlice(decls),
            }, logger.Loc.Empty);
            before.append(js_ast.Part{
                .stmts = part_stmts,
                .declared_symbols = declared_symbols,
                .tag = .dirname_filename,
            }) catch unreachable;
        }

        if (exports_kind == .esm and p.commonjs_named_exports.count() > 0 and !p.unwrap_all_requires and !force_esm) {
            exports_kind = .esm_with_dynamic_fallback_from_cjs;
        }

        // Auto inject jest globals into the test file
        if (p.options.features.inject_jest_globals) outer: {
            var jest: *Jest = &p.jest;

            for (p.import_records.items) |*item| {
                // skip if they did import it
                if (strings.eqlComptime(item.path.text, "bun:test") or strings.eqlComptime(item.path.text, "@jest/globals") or strings.eqlComptime(item.path.text, "vitest")) {
                    if (p.options.features.runtime_transpiler_cache) |cache| {
                        // If we rewrote import paths, we need to disable the runtime transpiler cache
                        if (!strings.eqlComptime(item.path.text, "bun:test")) {
                            cache.input_hash = null;
                        }
                    }

                    break :outer;
                }
            }

            // if they didn't use any of the jest globals, don't inject it, I guess.
            const items_count = brk: {
                var count: usize = 0;
                inline for (comptime std.meta.fieldNames(Jest)) |symbol_name| {
                    count += @intFromBool(p.symbols.items[@field(jest, symbol_name).innerIndex()].use_count_estimate > 0);
                }

                break :brk count;
            };
            if (items_count == 0)
                break :outer;

            var declared_symbols = js_ast.DeclaredSymbol.List{};
            try declared_symbols.ensureTotalCapacity(p.allocator, items_count);

            // For CommonJS modules, use require instead of import
            if (exports_kind == .cjs) {
                var import_record_indices = bun.handleOom(p.allocator.alloc(u32, 1));
                const import_record_id = p.addImportRecord(.require, logger.Loc.Empty, "bun:test");
                import_record_indices[0] = import_record_id;

                // Create object binding pattern for destructuring
                var properties = p.allocator.alloc(B.Property, items_count) catch unreachable;
                var prop_i: usize = 0;
                inline for (comptime std.meta.fieldNames(Jest)) |symbol_name| {
                    if (p.symbols.items[@field(jest, symbol_name).innerIndex()].use_count_estimate > 0) {
                        properties[prop_i] = .{
                            .key = p.newExpr(E.String{
                                .data = symbol_name,
                            }, logger.Loc.Empty),
                            .value = p.b(B.Identifier{ .ref = @field(jest, symbol_name) }, logger.Loc.Empty),
                        };
                        declared_symbols.appendAssumeCapacity(.{ .ref = @field(jest, symbol_name), .is_top_level = true });
                        prop_i += 1;
                    }
                }

                // Create: const { test, expect, ... } = require("bun:test")
                var decls = p.allocator.alloc(G.Decl, 1) catch unreachable;
                decls[0] = .{
                    .binding = p.b(B.Object{
                        .properties = properties,
                    }, logger.Loc.Empty),
                    .value = p.newExpr(E.RequireString{
                        .import_record_index = import_record_id,
                    }, logger.Loc.Empty),
                };

                var part_stmts = p.allocator.alloc(Stmt, 1) catch unreachable;
                part_stmts[0] = p.s(S.Local{
                    .kind = .k_const,
                    .decls = Decl.List.fromOwnedSlice(decls),
                }, logger.Loc.Empty);

                before.append(js_ast.Part{
                    .stmts = part_stmts,
                    .declared_symbols = declared_symbols,
                    .import_record_indices = bun.BabyList(u32).fromOwnedSlice(import_record_indices),
                    .tag = .bun_test,
                }) catch unreachable;
            } else {
                var import_record_indices = bun.handleOom(p.allocator.alloc(u32, 1));
                const import_record_id = p.addImportRecord(.stmt, logger.Loc.Empty, "bun:test");
                import_record_indices[0] = import_record_id;

                // For ESM modules, use import statement
                var clauses: []js_ast.ClauseItem = p.allocator.alloc(js_ast.ClauseItem, items_count) catch unreachable;
                var clause_i: usize = 0;
                inline for (comptime std.meta.fieldNames(Jest)) |symbol_name| {
                    if (p.symbols.items[@field(jest, symbol_name).innerIndex()].use_count_estimate > 0) {
                        clauses[clause_i] = js_ast.ClauseItem{
                            .name = .{ .ref = @field(jest, symbol_name), .loc = logger.Loc.Empty },
                            .alias = symbol_name,
                            .alias_loc = logger.Loc.Empty,
                            .original_name = "",
                        };
                        declared_symbols.appendAssumeCapacity(.{ .ref = @field(jest, symbol_name), .is_top_level = true });
                        clause_i += 1;
                    }
                }

                const import_stmt = p.s(
                    S.Import{
                        .namespace_ref = p.declareSymbol(.unbound, logger.Loc.Empty, "bun_test_import_namespace_for_internal_use_only") catch unreachable,
                        .items = clauses,
                        .import_record_index = import_record_id,
                    },
                    logger.Loc.Empty,
                );

                var part_stmts = try p.allocator.alloc(Stmt, 1);
                part_stmts[0] = import_stmt;
                before.append(js_ast.Part{
                    .stmts = part_stmts,
                    .declared_symbols = declared_symbols,
                    .import_record_indices = bun.BabyList(u32).fromOwnedSlice(import_record_indices),
                    .tag = .bun_test,
                }) catch unreachable;
            }

            // If we injected jest globals, we need to disable the runtime transpiler cache
            if (p.options.features.runtime_transpiler_cache) |cache| {
                cache.input_hash = null;
            }
        }

        if (p.has_called_runtime) {
            var runtime_imports: [RuntimeImports.all.len]u8 = undefined;
            var iter = p.runtime_imports.iter();
            var i: usize = 0;
            while (iter.next()) |entry| {
                runtime_imports[i] = @as(u8, @intCast(entry.key));
                i += 1;
            }

            std.sort.pdq(
                u8,
                runtime_imports[0..i],
                {},
                struct {
                    pub fn isLessThan(_: void, a: u8, b: u8) bool {
                        return std.math.order(
                            RuntimeImports.all_sorted_index[a],
                            RuntimeImports.all_sorted_index[b],
                        ) == .lt;
                    }
                }.isLessThan,
            );

            if (i > 0) {
                p.generateImportStmt(
                    RuntimeImports.Name,
                    runtime_imports[0..i],
                    &before,
                    p.runtime_imports,
                    null,
                    "import_",
                    true,
                ) catch unreachable;
            }
        }

        // handle new way to do automatic JSX imports which fixes symbol collision issues
        if (p.options.jsx.parse and p.options.features.auto_import_jsx and p.options.jsx.runtime == .automatic) {
            var buf = [3]string{ "", "", "" };
            const runtime_import_names = p.jsx_imports.runtimeImportNames(&buf);

            if (runtime_import_names.len > 0) {
                p.generateImportStmt(
                    p.options.jsx.importSource(),
                    runtime_import_names,
                    &before,
                    &p.jsx_imports,
                    null,
                    "",
                    false,
                ) catch unreachable;
            }

            const source_import_names = p.jsx_imports.sourceImportNames();
            if (source_import_names.len > 0) {
                p.generateImportStmt(
                    p.options.jsx.package_name,
                    source_import_names,
                    &before,
                    &p.jsx_imports,
                    null,
                    "",
                    false,
                ) catch unreachable;
            }
        }

        if (p.server_components_wrap_ref.isValid()) {
            const fw = p.options.framework orelse @panic("server components requires a framework configured, but none was set");
            const sc = fw.server_components.?;
            try p.generateReactRefreshImport(
                &before,
                sc.server_runtime_import,
                &.{
                    .{
                        .name = sc.server_register_client_reference,
                        .ref = p.server_components_wrap_ref,
                        .enabled = true,
                    },
                },
            );
        }

        if (p.react_refresh.register_used or p.react_refresh.signature_used) {
            try p.generateReactRefreshImport(
                &before,
                if (p.options.framework) |fw| fw.react_fast_refresh.?.import_source else "react-refresh/runtime",
                &.{
                    .{
                        .name = "register",
                        .enabled = p.react_refresh.register_used,
                        .ref = p.react_refresh.register_ref,
                    },
                    .{
                        .name = "createSignatureFunctionForTransform",
                        .enabled = p.react_refresh.signature_used,
                        .ref = p.react_refresh.create_signature_ref,
                    },
                },
            );
        }

        // Bake: transform global `Response` to use `import { Response } from 'bun:app'`
        if (!p.response_ref.isNull() and is_used_and_has_no_links: {
            // We only want to do this if the symbol is used and didn't get
            // bound to some other value
            const symbol: *const Symbol = &p.symbols.items[p.response_ref.innerIndex()];
            break :is_used_and_has_no_links !symbol.hasLink() and symbol.use_count_estimate > 0;
        }) {
            try p.generateImportStmtForBakeResponse(&before);
        }

        if (before.items.len > 0 or after.items.len > 0) {
            try parts.ensureUnusedCapacity(before.items.len + after.items.len);
            const parts_len = parts.items.len;
            parts.items.len += before.items.len + after.items.len;

            if (before.items.len > 0) {
                if (parts_len > 0) {
                    // first copy parts to the middle if before exists
                    bun.copy(js_ast.Part, parts.items[before.items.len..][0..parts_len], parts.items[0..parts_len]);
                }
                bun.copy(js_ast.Part, parts.items[0..before.items.len], before.items);
            }
            if (after.items.len > 0) {
                bun.copy(js_ast.Part, parts.items[parts_len + before.items.len ..][0..after.items.len], after.items);
            }
        }

        // Pop the module scope to apply the "ContainsDirectEval" rules
        // p.popScope();

        if (comptime Environment.isNative and bun.FeatureFlags.runtime_transpiler_cache) {
            const runtime_transpiler_cache: ?*bun.jsc.RuntimeTranspilerCache = p.options.features.runtime_transpiler_cache;
            if (runtime_transpiler_cache) |cache| {
                if (p.macro_call_count != 0) {
                    // disable this for:
                    // - macros
                    cache.input_hash = null;
                } else {
                    cache.exports_kind = exports_kind;
                }
            }
        }

        return js_ast.Result{ .ast = try p.toAST(&parts, exports_kind, wrap_mode, hashbang) };
    }

    pub fn init(_options: Options, log: *logger.Log, source: *const logger.Source, define: *Define, allocator: Allocator) !Parser {
        return Parser{
            .options = _options,
            .allocator = allocator,
            .lexer = try js_lexer.Lexer.init(log, source, allocator),
            .define = define,
            .source = source,
            .log = log,
        };
    }

    const PragmaState = packed struct { seen_cjs: bool = false, seen_bytecode: bool = false };

    fn hasBunPragma(self: *const Parser, has_hashbang: bool) ?js_ast.Result.AlreadyBundled {
        const BUN_PRAGMA = "// @bun";
        const contents = self.lexer.source.contents;
        const end = contents.len;

        // pragmas may appear after a hashbang comment
        //
        //   ```js
        //   #!/usr/bin/env bun
        //   // @bun
        //   const myCode = 1;
        //   ```
        var cursor: usize = 0;
        if (has_hashbang) {
            while (contents[cursor] != '\n') {
                cursor += 1;
                if (cursor >= end) return null;
            }

            // eat the last newline
            // NOTE: in windows, \n comes after \r so no extra work needs to be done
            cursor += 1;
        }

        if (!bun.strings.startsWith(contents[cursor..], BUN_PRAGMA)) return null;
        cursor += BUN_PRAGMA.len;

        var state: PragmaState = .{};

        while (cursor < end) : (cursor += 1) {
            switch (contents[cursor]) {
                '\n' => break,
                '@' => {
                    cursor += 1;
                    if (cursor >= contents.len) break;
                    if (contents[cursor] != 'b') continue;
                    const slice = contents[cursor..];
                    if (bun.strings.startsWith(slice, "bun-cjs")) {
                        state.seen_cjs = true;
                        cursor += "bun-cjs".len;
                    } else if (bun.strings.startsWith(slice, "bytecode")) {
                        state.seen_bytecode = true;
                        cursor += "bytecode".len;
                    }
                },
                else => {},
            }
        }

        if (state.seen_cjs) {
            return if (state.seen_bytecode) .bytecode_cjs else .bun_cjs;
        } else {
            return if (state.seen_bytecode) .bytecode else .bun;
        }
    }
};

fn MacroContextType() type {
    if (comptime Environment.isWasm) {
        return ?*anyopaque;
    }

    return js_ast.Macro.MacroContext;
}

const string = []const u8;

const _runtime = @import("../runtime.zig");
const Define = @import("../defines.zig").Define;

const importRecord = @import("../import_record.zig");
const ImportRecord = importRecord.ImportRecord;

const RuntimeFeatures = _runtime.Runtime.Features;
const RuntimeImports = _runtime.Runtime.Imports;

const bun = @import("bun");
const Environment = bun.Environment;
const FeatureFlags = bun.FeatureFlags;
const Output = bun.Output;
const default_allocator = bun.default_allocator;
const logger = bun.logger;
const options = bun.options;
const strings = bun.strings;

const js_ast = bun.ast;
const B = js_ast.B;
const DeclaredSymbol = js_ast.DeclaredSymbol;
const E = js_ast.E;
const Expr = js_ast.Expr;
const S = js_ast.S;
const Stmt = js_ast.Stmt;
const StmtList = js_ast.StmtList;
const Symbol = js_ast.Symbol;

const G = js_ast.G;
const Decl = G.Decl;

const js_lexer = bun.js_lexer;
const T = js_lexer.T;

const js_parser = bun.js_parser;
const JSXImportScanner = js_parser.JSXImportScanner;
const JSXParser = js_parser.JSXParser;
const JavaScriptImportScanner = js_parser.JavaScriptImportScanner;
const JavaScriptParser = js_parser.JavaScriptParser;
const Jest = js_parser.Jest;
const ParseStatementOptions = js_parser.ParseStatementOptions;
const ScanPassResult = js_parser.ScanPassResult;
const SideEffects = js_parser.SideEffects;
const TSXImportScanner = js_parser.TSXImportScanner;
const TSXParser = js_parser.TSXParser;
const TypeScriptImportScanner = js_parser.TypeScriptImportScanner;
const TypeScriptParser = js_parser.TypeScriptParser;
const WrapMode = js_parser.WrapMode;

const std = @import("std");
const List = std.ArrayListUnmanaged;
const Allocator = std.mem.Allocator;
const ListManaged = std.array_list.Managed;
