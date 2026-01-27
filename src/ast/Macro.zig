pub const namespace: string = "macro";
pub const namespaceWithColon: string = namespace ++ ":";

pub fn isMacroPath(str: string) bool {
    return strings.hasPrefixComptime(str, namespaceWithColon);
}

pub const MacroContext = struct {
    pub const MacroMap = std.AutoArrayHashMap(i32, Macro);

    resolver: *Resolver,
    env: *DotEnv.Loader,
    macros: MacroMap,
    remap: MacroRemap,
    javascript_object: jsc.JSValue = jsc.JSValue.zero,

    pub fn getRemap(this: MacroContext, path: string) ?MacroRemapEntry {
        if (this.remap.entries.len == 0) return null;
        return this.remap.get(path);
    }

    pub fn init(transpiler: *Transpiler) MacroContext {
        return MacroContext{
            .macros = MacroMap.init(default_allocator),
            .resolver = &transpiler.resolver,
            .env = transpiler.env,
            .remap = transpiler.options.macro_remap,
        };
    }

    pub fn call(
        this: *MacroContext,
        import_record_path: string,
        source_dir: string,
        log: *logger.Log,
        source: *const logger.Source,
        import_range: logger.Range,
        caller: Expr,
        function_name: string,
    ) anyerror!Expr {
        Expr.Data.Store.disable_reset = true;
        Stmt.Data.Store.disable_reset = true;
        defer Expr.Data.Store.disable_reset = false;
        defer Stmt.Data.Store.disable_reset = false;
        // const is_package_path = isPackagePath(specifier);
        const import_record_path_without_macro_prefix = if (isMacroPath(import_record_path))
            import_record_path[namespaceWithColon.len..]
        else
            import_record_path;

        bun.assert(!isMacroPath(import_record_path_without_macro_prefix));

        const input_specifier = brk: {
            if (jsc.ModuleLoader.HardcodedModule.Alias.get(import_record_path, .bun, .{})) |replacement| {
                break :brk replacement.path;
            }

            const resolve_result = this.resolver.resolve(source_dir, import_record_path_without_macro_prefix, .stmt) catch |err| {
                switch (err) {
                    error.ModuleNotFound => {
                        log.addResolveError(
                            source,
                            import_range,
                            log.msgs.allocator,
                            "Macro \"{s}\" not found",
                            .{import_record_path},
                            .stmt,
                            err,
                        ) catch unreachable;
                        return error.MacroNotFound;
                    },
                    else => {
                        log.addRangeErrorFmt(
                            source,
                            import_range,
                            log.msgs.allocator,
                            "{s} resolving macro \"{s}\"",
                            .{ @errorName(err), import_record_path },
                        ) catch unreachable;
                        return err;
                    },
                }
            };
            break :brk resolve_result.path_pair.primary.text;
        };

        var specifier_buf: [64]u8 = undefined;
        var specifier_buf_len: u32 = 0;
        const hash = MacroEntryPoint.generateID(
            input_specifier,
            function_name,
            &specifier_buf,
            &specifier_buf_len,
        );

        const macro_entry = this.macros.getOrPut(hash) catch unreachable;
        if (!macro_entry.found_existing) {
            macro_entry.value_ptr.* = Macro.init(
                default_allocator,
                this.resolver,
                input_specifier,
                log,
                this.env,
                function_name,
                specifier_buf[0..specifier_buf_len],
                hash,
            ) catch |err| {
                macro_entry.value_ptr.* = Macro{ .resolver = undefined, .disabled = true };
                return err;
            };
            Output.flush();
        }
        defer Output.flush();

        const macro = macro_entry.value_ptr.*;
        if (macro.disabled) {
            return caller;
        }
        macro.vm.enableMacroMode();
        defer macro.vm.disableMacroMode();
        macro.vm.eventLoop().ensureWaker();

        const Wrapper = struct {
            args: std.meta.ArgsTuple(@TypeOf(Macro.Runner.run)),
            ret: Runner.MacroError!Expr,

            pub fn call(self: *@This()) void {
                self.ret = @call(.auto, Macro.Runner.run, self.args);
            }
        };
        var wrapper = Wrapper{
            .args = .{
                macro,
                log,
                default_allocator,
                function_name,
                caller,
                source,
                hash,
                this.javascript_object,
            },
            .ret = undefined,
        };

        macro.vm.runWithAPILock(Wrapper, &wrapper, Wrapper.call);
        return try wrapper.ret;
        // this.macros.getOrPut(key: K)
    }
};

pub const MacroResult = struct {
    import_statements: []S.Import = &[_]S.Import{},
    replacement: Expr,
};

resolver: *Resolver,
vm: *JavaScript.VirtualMachine = undefined,

resolved: ResolveResult = undefined,
disabled: bool = false,

pub fn init(
    _: std.mem.Allocator,
    resolver: *Resolver,
    input_specifier: []const u8,
    log: *logger.Log,
    env: *DotEnv.Loader,
    function_name: string,
    specifier: string,
    hash: i32,
) !Macro {
    var vm: *JavaScript.VirtualMachine = if (JavaScript.VirtualMachine.isLoaded())
        JavaScript.VirtualMachine.get()
    else brk: {
        const old_transform_options = resolver.opts.transform_options;
        defer resolver.opts.transform_options = old_transform_options;

        // JSC needs to be initialized if building from CLI
        jsc.initialize(false);

        var _vm = try JavaScript.VirtualMachine.init(.{
            .allocator = default_allocator,
            .args = resolver.opts.transform_options,
            .log = log,
            .is_main_thread = false,
            .env_loader = env,
        });

        _vm.enableMacroMode();
        _vm.eventLoop().ensureWaker();

        try _vm.transpiler.configureDefines();
        break :brk _vm;
    };

    vm.enableMacroMode();
    vm.eventLoop().ensureWaker();

    const loaded_result = try vm.loadMacroEntryPoint(input_specifier, function_name, specifier, hash);

    switch (loaded_result.unwrap(vm.jsc_vm, .leave_unhandled)) {
        .rejected => |result| {
            vm.unhandledRejection(vm.global, result, loaded_result.asValue());
            vm.disableMacroMode();
            return error.MacroLoadError;
        },
        else => {},
    }

    return Macro{
        .vm = vm,
        .resolver = resolver,
    };
}

pub const Runner = struct {
    const VisitMap = std.AutoHashMapUnmanaged(jsc.JSValue, Expr);

    threadlocal var args_buf: [3]js.JSObjectRef = undefined;
    threadlocal var exception_holder: jsc.ZigException.Holder = undefined;
    pub const MacroError = error{ MacroFailed, OutOfMemory } || ToJSError || bun.JSError;

    pub const Run = struct {
        caller: Expr,
        function_name: string,
        macro: *const Macro,
        global: *jsc.JSGlobalObject,
        allocator: std.mem.Allocator,
        id: i32,
        log: *logger.Log,
        source: *const logger.Source,
        visited: VisitMap = VisitMap{},
        is_top_level: bool = false,

        pub fn runAsync(
            macro: Macro,
            log: *logger.Log,
            allocator: std.mem.Allocator,
            function_name: string,
            caller: Expr,
            args: []jsc.JSValue,
            source: *const logger.Source,
            id: i32,
        ) MacroError!Expr {
            const macro_callback = macro.vm.macros.get(id) orelse return caller;

            const result = js.JSObjectCallAsFunctionReturnValueHoldingAPILock(
                macro.vm.global,
                macro_callback,
                null,
                args.len,
                @as([*]js.JSObjectRef, @ptrCast(args.ptr)),
            );

            var runner = Run{
                .caller = caller,
                .function_name = function_name,
                .macro = &macro,
                .allocator = allocator,
                .global = macro.vm.global,
                .id = id,
                .log = log,
                .source = source,
                .visited = VisitMap{},
            };

            defer runner.visited.deinit(allocator);

            return try runner.run(
                result,
            );
        }

        pub fn run(
            this: *Run,
            value: jsc.JSValue,
        ) MacroError!Expr {
            return switch ((try jsc.ConsoleObject.Formatter.Tag.get(value, this.global)).tag) {
                .Error => this.coerce(value, .Error),
                .Undefined => this.coerce(value, .Undefined),
                .Null => this.coerce(value, .Null),
                .Private => this.coerce(value, .Private),
                .Boolean => this.coerce(value, .Boolean),
                .Array => this.coerce(value, .Array),
                .Object => this.coerce(value, .Object),
                .toJSON, .JSON => this.coerce(value, .JSON),
                .Integer => this.coerce(value, .Integer),
                .Double => this.coerce(value, .Double),
                .String => this.coerce(value, .String),
                .Promise => this.coerce(value, .Promise),
                else => brk: {
                    const name = value.getClassInfoName() orelse "unknown";

                    this.log.addErrorFmt(
                        this.source,
                        this.caller.loc,
                        this.allocator,
                        "cannot coerce {s} ({s}) to Bun's AST. Please return a simpler type",
                        .{ name, @tagName(value.jsType()) },
                    ) catch unreachable;
                    break :brk error.MacroFailed;
                },
            };
        }

        pub fn coerce(
            this: *Run,
            value: jsc.JSValue,
            comptime tag: jsc.ConsoleObject.Formatter.Tag,
        ) MacroError!Expr {
            switch (comptime tag) {
                .Error => {
                    _ = this.macro.vm.uncaughtException(this.global, value, false);
                    return this.caller;
                },
                .Undefined => if (this.is_top_level)
                    return this.caller
                else
                    return Expr.init(E.Undefined, E.Undefined{}, this.caller.loc),
                .Null => return Expr.init(E.Null, E.Null{}, this.caller.loc),
                .Private => {
                    this.is_top_level = false;
                    if (this.visited.get(value)) |cached| {
                        return cached;
                    }

                    var blob_: ?*const jsc.WebCore.Blob = null;
                    const mime_type: ?MimeType = null;

                    if (value.jsType() == .DOMWrapper) {
                        if (value.as(jsc.WebCore.Response)) |resp| {
                            return this.run(try resp.getBlobWithoutCallFrame(this.global));
                        } else if (value.as(jsc.WebCore.Request)) |resp| {
                            return this.run(try resp.getBlobWithoutCallFrame(this.global));
                        } else if (value.as(jsc.WebCore.Blob)) |resp| {
                            blob_ = resp;
                        } else if (value.as(bun.api.ResolveMessage) != null or value.as(bun.api.BuildMessage) != null) {
                            _ = this.macro.vm.uncaughtException(this.global, value, false);
                            return error.MacroFailed;
                        }
                    }

                    if (blob_) |blob| {
                        return Expr.fromBlob(
                            blob,
                            this.allocator,
                            mime_type,
                            this.log,
                            this.caller.loc,
                        ) catch {
                            return error.MacroFailed;
                        };
                    }

                    return Expr.init(E.String, E.String.empty, this.caller.loc);
                },

                .Boolean => {
                    return Expr{ .data = .{ .e_boolean = .{ .value = value.toBoolean() } }, .loc = this.caller.loc };
                },
                jsc.ConsoleObject.Formatter.Tag.Array => {
                    this.is_top_level = false;

                    const _entry = this.visited.getOrPut(this.allocator, value) catch unreachable;
                    if (_entry.found_existing) {
                        return _entry.value_ptr.*;
                    }

                    var iter = try jsc.JSArrayIterator.init(value, this.global);

                    // Process all array items
                    var array = this.allocator.alloc(Expr, iter.len) catch unreachable;
                    errdefer this.allocator.free(array);
                    const expr = Expr.init(
                        E.Array,
                        E.Array{ .items = ExprNodeList.empty, .was_originally_macro = true },
                        this.caller.loc,
                    );
                    _entry.value_ptr.* = expr;
                    var i: usize = 0;
                    while (try iter.next()) |item| {
                        array[i] = try this.run(item);
                        if (array[i].isMissing())
                            continue;
                        i += 1;
                    }

                    expr.data.e_array.items = ExprNodeList.fromOwnedSlice(array);
                    expr.data.e_array.items.len = @truncate(i);
                    return expr;
                },
                // TODO: optimize this
                jsc.ConsoleObject.Formatter.Tag.Object => {
                    this.is_top_level = false;
                    const _entry = this.visited.getOrPut(this.allocator, value) catch unreachable;
                    if (_entry.found_existing) {
                        return _entry.value_ptr.*;
                    }

                    // Reserve a placeholder to break cycles.
                    const expr = Expr.init(
                        E.Object,
                        E.Object{ .properties = G.Property.List{}, .was_originally_macro = true },
                        this.caller.loc,
                    );
                    _entry.value_ptr.* = expr;

                    // SAFETY: tag ensures `value` is an object.
                    const obj = value.getObject() orelse unreachable;
                    var object_iter = try jsc.JSPropertyIterator(.{
                        .skip_empty_name = false,
                        .include_value = true,
                    }).init(this.global, obj);
                    defer object_iter.deinit();

                    // Build properties list
                    var properties = bun.handleOom(
                        G.Property.List.initCapacity(this.allocator, object_iter.len),
                    );
                    errdefer properties.clearAndFree(this.allocator);

                    while (try object_iter.next()) |prop| {
                        const object_value = try this.run(object_iter.value);

                        properties.append(this.allocator, G.Property{
                            .key = Expr.init(
                                E.String,
                                E.String.init(prop.toOwnedSlice(this.allocator) catch unreachable),
                                this.caller.loc,
                            ),
                            .value = object_value,
                        }) catch |err| bun.handleOom(err);
                    }

                    expr.data.e_object.properties = properties;

                    return expr;
                },

                .JSON => {
                    this.is_top_level = false;
                    // if (console_tag.cell == .JSDate) {
                    //     // in the code for printing dates, it never exceeds this amount
                    //     var iso_string_buf = this.allocator.alloc(u8, 36) catch unreachable;
                    //     var str = jsc.ZigString.init("");
                    //     value.jsonStringify(this.global, 0, &str);
                    //     var out_buf: []const u8 = std.fmt.bufPrint(iso_string_buf, "{}", .{str}) catch "";
                    //     if (out_buf.len > 2) {
                    //         // trim the quotes
                    //         out_buf = out_buf[1 .. out_buf.len - 1];
                    //     }
                    //     return Expr.init(E.New, E.New{.target = Expr.init(E.Dot{.target = E}) })
                    // }
                },

                .Integer => {
                    return Expr.init(E.Number, E.Number{ .value = @as(f64, @floatFromInt(value.toInt32())) }, this.caller.loc);
                },
                .Double => {
                    return Expr.init(E.Number, E.Number{ .value = value.asNumber() }, this.caller.loc);
                },
                .String => {
                    var bun_str = try value.toBunString(this.global);
                    defer bun_str.deref();

                    // encode into utf16 so the printer escapes the string correctly
                    var utf16_bytes = this.allocator.alloc(u16, bun_str.length()) catch unreachable;
                    const out_slice = utf16_bytes[0 .. (bun_str.encodeInto(std.mem.sliceAsBytes(utf16_bytes), .utf16le) catch 0) / 2];
                    return Expr.init(E.String, E.String.init(out_slice), this.caller.loc);
                },
                .Promise => {
                    if (this.visited.get(value)) |cached| {
                        return cached;
                    }

                    const promise = value.asAnyPromise() orelse @panic("Unexpected promise type");

                    this.macro.vm.waitForPromise(promise);

                    const promise_result = promise.result(this.macro.vm.jsc_vm);
                    const rejected = promise.status() == .rejected;

                    if (promise_result.isUndefined() and this.is_top_level) {
                        this.is_top_level = false;
                        return this.caller;
                    }

                    if (rejected or promise_result.isError() or promise_result.isAggregateError(this.global) or promise_result.isException(this.global.vm())) {
                        this.macro.vm.unhandledRejection(this.global, promise_result, promise.asValue());
                        return error.MacroFailed;
                    }
                    this.is_top_level = false;
                    const result = try this.run(promise_result);

                    this.visited.put(this.allocator, value, result) catch unreachable;
                    return result;
                },
                else => {},
            }

            this.log.addErrorFmt(
                this.source,
                this.caller.loc,
                this.allocator,
                "cannot coerce {s} to Bun's AST. Please return a simpler type",
                .{@tagName(value.jsType())},
            ) catch unreachable;
            return error.MacroFailed;
        }
    };

    pub fn run(
        macro: Macro,
        log: *logger.Log,
        allocator: std.mem.Allocator,
        function_name: string,
        caller: Expr,
        source: *const logger.Source,
        id: i32,
        javascript_object: jsc.JSValue,
    ) MacroError!Expr {
        if (comptime Environment.isDebug) Output.prettyln("<r><d>[macro]<r> call <d><b>{s}<r>", .{function_name});

        exception_holder = jsc.ZigException.Holder.init();
        var js_args: []jsc.JSValue = &.{};
        var js_processed_args_len: usize = 0;
        defer {
            for (js_args[0..js_processed_args_len -| @as(usize, @intFromBool(javascript_object != .zero))]) |arg| {
                arg.unprotect();
            }

            allocator.free(js_args);
        }

        const globalObject = jsc.VirtualMachine.get().global;

        switch (caller.data) {
            .e_call => |call| {
                const call_args: []Expr = call.args.slice();
                js_args = try allocator.alloc(jsc.JSValue, call_args.len + @as(usize, @intFromBool(javascript_object != .zero)));
                js_processed_args_len = js_args.len;

                for (0.., call_args, js_args[0..call_args.len]) |i, in, *out| {
                    const value = in.toJS(
                        allocator,
                        globalObject,
                    ) catch |e| {
                        // Keeping a separate variable instead of modifying js_args.len
                        // due to allocator.free call in defer
                        js_processed_args_len = i;
                        return e;
                    };
                    value.protect();
                    out.* = value;
                }
            },
            .e_template => {
                @panic("TODO: support template literals in macros");
            },
            else => {
                @panic("Unexpected caller type");
            },
        }

        if (javascript_object != .zero) {
            if (js_args.len == 0) {
                js_args = try allocator.alloc(jsc.JSValue, 1);
            }

            js_args[js_args.len - 1] = javascript_object;
        }

        const CallFunction = @TypeOf(Run.runAsync);
        const CallArgs = std.meta.ArgsTuple(CallFunction);
        const CallData = struct {
            threadlocal var call_args: CallArgs = undefined;
            threadlocal var result: MacroError!Expr = undefined;
            pub fn callWrapper(args: CallArgs) MacroError!Expr {
                jsc.markBinding(@src());
                call_args = args;
                Bun__startMacro(&call, jsc.VirtualMachine.get().global);
                return result;
            }

            pub fn call() callconv(.c) void {
                const call_args_copy = call_args;
                const local_result = @call(.auto, Run.runAsync, call_args_copy);
                result = local_result;
            }
        };

        return CallData.callWrapper(.{
            macro,
            log,
            allocator,
            function_name,
            caller,
            js_args,
            source,
            id,
        });
    }

    extern "c" fn Bun__startMacro(function: *const anyopaque, *anyopaque) void;
};

const string = []const u8;

const DotEnv = @import("../env_loader.zig");
const std = @import("std");

const MacroRemap = @import("../resolver/package_json.zig").MacroMap;
const MacroRemapEntry = @import("../resolver/package_json.zig").MacroImportReplacementMap;

const ResolveResult = @import("../resolver/resolver.zig").Result;
const Resolver = @import("../resolver/resolver.zig").Resolver;
const isPackagePath = @import("../resolver/resolver.zig").isPackagePath;

const bun = @import("bun");
const Environment = bun.Environment;
const Output = bun.Output;
const Transpiler = bun.Transpiler;
const default_allocator = bun.default_allocator;
const logger = bun.logger;
const strings = bun.strings;
const Loader = bun.options.Loader;
const MimeType = bun.http.MimeType;
const MacroEntryPoint = bun.transpiler.EntryPoints.MacroEntryPoint;

const js_ast = bun.ast;
const E = js_ast.E;
const Expr = js_ast.Expr;
const ExprNodeList = js_ast.ExprNodeList;
const G = js_ast.G;
const Macro = js_ast.Macro;
const S = js_ast.S;
const Stmt = js_ast.Stmt;
const ToJSError = js_ast.ToJSError;

const JavaScript = bun.jsc;
const jsc = bun.jsc;
const js = bun.jsc.C;
