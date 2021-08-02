const std = @import("std");

const Fs = @import("../../fs.zig");
const resolver = @import("../../resolver/resolver.zig");
const ast = @import("../../import_record.zig");
const NodeModuleBundle = @import("../../node_module_bundle.zig").NodeModuleBundle;
const logger = @import("../../logger.zig");
const Api = @import("../../api/schema.zig").Api;
const options = @import("../../options.zig");
const Bundler = @import("../../bundler.zig").ServeBundler;
const js_printer = @import("../../js_printer.zig");
const hash_map = @import("../../hash_map.zig");
const http = @import("../../http.zig");
const ImportKind = ast.ImportKind;
usingnamespace @import("./node_env_buf_map.zig");
usingnamespace @import("./base.zig");
usingnamespace @import("./webcore/response.zig");
usingnamespace @import("./config.zig");
usingnamespace @import("./bindings/exports.zig");
usingnamespace @import("./bindings/bindings.zig");

const Runtime = @import("../../runtime.zig");

pub const GlobalClasses = [_]type{
    Request.Class,
    Response.Class,
    Headers.Class,
    EventListenerMixin.addEventListener(VirtualMachine),
    BuildError.Class,
    ResolveError.Class,
};

pub const LazyClasses = [_]type{};

pub const Module = struct {
    reload_pending: bool = false,
};

// If you read JavascriptCore/API/JSVirtualMachine.mm - https://github.com/WebKit/WebKit/blob/acff93fb303baa670c055cb24c2bad08691a01a0/Source/JavaScriptCore/API/JSVirtualMachine.mm#L101
// We can see that it's sort of like std.mem.Allocator but for JSGlobalContextRef, to support Automatic Reference Counting
// Its unavailable on Linux
pub const VirtualMachine = struct {
    const RequireCacheType = std.AutoHashMap(u32, *Module);
    global: *JSGlobalObject,
    allocator: *std.mem.Allocator,
    node_modules: ?*NodeModuleBundle = null,
    bundler: Bundler,
    watcher: ?*http.Watcher = null,
    console: *ZigConsoleClient,
    require_cache: RequireCacheType,
    log: *logger.Log,
    event_listeners: EventListenerMixin.Map,
    pub threadlocal var vm_loaded = false;
    pub threadlocal var vm: *VirtualMachine = undefined;

    pub fn init(
        allocator: *std.mem.Allocator,
        _args: Api.TransformOptions,
        existing_bundle: ?*NodeModuleBundle,
        _log: ?*logger.Log,
    ) !*VirtualMachine {
        var log: *logger.Log = undefined;
        if (_log) |__log| {
            log = __log;
        } else {
            log = try allocator.create(logger.Log);
        }

        vm = try allocator.create(VirtualMachine);
        var console = try allocator.create(ZigConsoleClient);
        console.* = ZigConsoleClient.init(Output.errorWriter(), Output.writer());
        const bundler = try Bundler.init(
            allocator,
            log,
            try configureTransformOptionsForSpeedy(allocator, _args),
            existing_bundle,
        );
        vm.* = VirtualMachine{
            .global = undefined,
            .allocator = allocator,
            .require_cache = RequireCacheType.init(allocator),
            .event_listeners = EventListenerMixin.Map.init(allocator),
            .bundler = bundler,
            .console = console,
            .node_modules = bundler.options.node_modules_bundle,
            .log = log,
        };

        vm.bundler.configureLinker();

        var global_classes: [GlobalClasses.len]js.JSClassRef = undefined;
        inline for (GlobalClasses) |Class, i| {
            global_classes[i] = Class.get().*;
        }
        vm.global = ZigGlobalObject.create(
            &global_classes,
            @intCast(i32, global_classes.len),
            vm.console,
        );
        vm_loaded = true;

        return vm;
    }

    // dynamic import
    // pub fn import(global: *JSGlobalObject, specifier: ZigString, source: ZigString) callconv(.C) ErrorableZigString {

    // }

    threadlocal var source_code_printer: js_printer.BufferPrinter = undefined;
    threadlocal var source_code_printer_loaded: bool = false;

    inline fn _fetch(
        global: *JSGlobalObject,
        specifier: string,
        source: string,
        log: *logger.Log,
    ) !ResolvedSource {
        std.debug.assert(VirtualMachine.vm_loaded);
        std.debug.assert(VirtualMachine.vm.global == global);

        if (vm.node_modules != null and strings.eql(vm.bundler.linker.nodeModuleBundleImportPath(), specifier)) {
            // We kind of need an abstraction around this.
            // Basically we should subclass JSC::SourceCode with:
            // - hash
            // - file descriptor for source input
            // - file path + file descriptor for bytecode caching
            // - separate bundles for server build vs browser build OR at least separate sections
            const code = try vm.node_modules.?.readCodeAsStringSlow(vm.allocator);
            return ResolvedSource{
                .source_code = ZigString.init(code),
                .specifier = ZigString.init(vm.bundler.linker.nodeModuleBundleImportPath()),
                .source_url = ZigString.init(vm.bundler.options.node_modules_bundle_pretty_path),
                .hash = 0, // TODO
                .bytecodecache_fd = std.math.lossyCast(u64, vm.node_modules.?.fetchByteCodeCache(
                    vm.bundler.options.node_modules_bundle_pretty_path,
                    &vm.bundler.fs.fs,
                ) orelse 0),
            };
        } else if (strings.eqlComptime(specifier, Runtime.Runtime.Imports.Name)) {
            return ResolvedSource{
                .source_code = ZigString.init(Runtime.Runtime.sourceContent()),
                .specifier = ZigString.init(Runtime.Runtime.Imports.Name),
                .source_url = ZigString.init(Runtime.Runtime.Imports.Name),
                .hash = Runtime.Runtime.versionHash(),
                .bytecodecache_fd = std.math.lossyCast(
                    u64,
                    Runtime.Runtime.byteCodeCacheFile(&vm.bundler.fs.fs) orelse 0,
                ),
            };
        }

        const result = vm.bundler.resolve_results.get(specifier) orelse return error.MissingResolveResult;
        const path = result.path_pair.primary;
        const loader = vm.bundler.options.loaders.get(path.name.ext) orelse .file;

        switch (loader) {
            .js, .jsx, .ts, .tsx, .json => {
                vm.bundler.resetStore();
                const hash = http.Watcher.getHash(path.text);

                var fd: ?StoredFileDescriptorType = null;

                if (vm.watcher) |watcher| {
                    if (watcher.indexOf(hash)) |index| {
                        fd = watcher.watchlist.items(.fd)[index];
                    }
                }

                var old = vm.bundler.log;
                vm.bundler.log = log;
                defer vm.bundler.log = old;

                var parse_result = vm.bundler.parse(
                    vm.bundler.allocator,
                    path,
                    loader,
                    result.dirname_fd,
                    fd,
                    hash,
                ) orelse {
                    return error.ParseError;
                };

                // We _must_ link because:
                // - node_modules bundle won't be properly
                try vm.bundler.linker.link(
                    path,
                    &parse_result,
                    .absolute_path,
                    true,
                );

                if (!source_code_printer_loaded) {
                    var writer = try js_printer.BufferWriter.init(vm.allocator);
                    source_code_printer = js_printer.BufferPrinter.init(writer);
                    source_code_printer.ctx.append_null_byte = false;

                    source_code_printer_loaded = true;
                }

                source_code_printer.ctx.reset();

                var written = try vm.bundler.print(
                    parse_result,
                    @TypeOf(&source_code_printer),
                    &source_code_printer,
                    .esm,
                );

                if (written == 0) {
                    return error.PrintingErrorWriteFailed;
                }

                return ResolvedSource{
                    .source_code = ZigString.init(vm.allocator.dupe(u8, source_code_printer.ctx.written) catch unreachable),
                    .specifier = ZigString.init(specifier),
                    .source_url = ZigString.init(path.text),
                    .hash = 0,
                    .bytecodecache_fd = 0,
                };
            },
            else => {
                return ResolvedSource{
                    .source_code = ZigString.init(try strings.quotedAlloc(VirtualMachine.vm.allocator, path.pretty)),
                    .specifier = ZigString.init(path.text),
                    .source_url = ZigString.init(path.text),
                    .hash = 0,
                    .bytecodecache_fd = 0,
                };
            },
        }
    }
    inline fn _resolve(global: *JSGlobalObject, specifier: string, source: string) !string {
        std.debug.assert(VirtualMachine.vm_loaded);
        std.debug.assert(VirtualMachine.vm.global == global);
        if (vm.node_modules == null and strings.eqlComptime(specifier, Runtime.Runtime.Imports.Name)) {
            return Runtime.Runtime.Imports.Name;
        } else if (vm.node_modules != null and strings.eql(specifier, vm.bundler.linker.nodeModuleBundleImportPath())) {
            return vm.bundler.linker.nodeModuleBundleImportPath();
        }

        const result: resolver.Result = vm.bundler.resolve_results.get(specifier) orelse brk: {
            // We don't want to write to the hash table if there's an error
            // That's why we don't use getOrPut here
            const res = try vm.bundler.resolver.resolve(
                Fs.PathName.init(source).dirWithTrailingSlash(),
                specifier,
                .stmt,
            );
            try vm.bundler.resolve_results.put(res.path_pair.primary.text, res);
            break :brk res;
        };

        if (vm.node_modules != null and result.isLikelyNodeModule()) {
            const node_modules_bundle = vm.node_modules.?;

            node_module_checker: {
                const package_json = result.package_json orelse brk: {
                    if (vm.bundler.linker.resolver.packageJSONForResolvedNodeModule(&result)) |pkg| {
                        break :brk pkg;
                    } else {
                        break :node_module_checker;
                    }
                };

                if (node_modules_bundle.getPackageIDByName(package_json.name)) |possible_pkg_ids| {
                    const pkg_id: u32 = brk: {
                        for (possible_pkg_ids) |pkg_id| {
                            const pkg = node_modules_bundle.bundle.packages[pkg_id];
                            if (pkg.hash == package_json.hash) {
                                break :brk pkg_id;
                            }
                        }
                        break :node_module_checker;
                    };

                    const package = &node_modules_bundle.bundle.packages[pkg_id];

                    if (isDebug) {
                        std.debug.assert(strings.eql(node_modules_bundle.str(package.name), package_json.name));
                    }

                    const package_relative_path = vm.bundler.fs.relative(
                        package_json.source.path.name.dirWithTrailingSlash(),
                        result.path_pair.primary.text,
                    );

                    if (node_modules_bundle.findModuleIDInPackage(package, package_relative_path) == null) break :node_module_checker;

                    return vm.bundler.linker.nodeModuleBundleImportPath();
                }
            }
        }

        return result.path_pair.primary.text;
    }

    pub fn resolve(global: *JSGlobalObject, specifier: ZigString, source: ZigString) ErrorableZigString {
        const result = _resolve(global, specifier.slice(), source.slice()) catch |err| {
            return ErrorableZigString.errFmt(err, "ResolveError {s} for \"{s}\"\nfrom\"{s}\"", .{
                @errorName(err),
                specifier.slice(),
                source.slice(),
            });
        };

        return ErrorableZigString.ok(ZigString.init(result));
    }

    pub fn fetch(ret: *ErrorableResolvedSource, global: *JSGlobalObject, specifier: ZigString, source: ZigString) callconv(.C) void {
        var log = logger.Log.init(vm.bundler.allocator);
        const result = _fetch(global, specifier.slice(), source.slice()) catch |err| {
            switch (err) {
                error.ParserError => {
                    std.debug.assert(log.msgs.items.len > 0);

                    switch (log.msgs.items.len) {
                        1 => {
                            return ErrorableResolvedSource.err(error.ParserError, BuildError.create(vm.bundler.allocator, &log.msgs.items[0]));
                        },
                        else => {
                            
                        },
                    }
                },
                else => {
                    ret.* = ErrorableResolvedSource.errFmt(err, "{s}: \"{s}\"", .{
                        @errorName(err),
                        specifier.slice(),
                    });
                },
            }
        };

        ret.* = ErrorableResolvedSource.ok(result);
    }

    pub fn loadEntryPoint(this: *VirtualMachine, entry_point: string) !void {
        var path = this.bundler.normalizeEntryPointPath(entry_point);

        var promise = JSModuleLoader.loadAndEvaluateModule(this.global, ZigString.init(path));

        this.global.vm().drainMicrotasks();

        while (promise.status(this.global.vm()) == JSPromise.Status.Pending) {
            this.global.vm().drainMicrotasks();
        }

        if (promise.status(this.global.vm()) == JSPromise.Status.Rejected) {
            var exception_holder = ZigException.Holder.init();
            var exception = exception_holder.zigException();
            promise.result(this.global.vm()).toZigException(vm.global, exception);
            var stderr: std.fs.File = Output.errorStream();
            var buffered = std.io.bufferedWriter(stderr.writer());
            var writer = buffered.writer();
            defer buffered.flush() catch unreachable;
            // We are going to print the stack trace backwards
            const stack = exception.stack.frames();
            if (stack.len > 0) {
                var i = @intCast(i16, stack.len - 1);

                var func_name_pad: usize = 0;
                while (i >= 0) : (i -= 1) {
                    const frame = stack[@intCast(usize, i)];
                    func_name_pad = std.math.max(func_name_pad, std.fmt.count("{any}", .{
                        frame.nameFormatter(true),
                    }));
                }

                i = @intCast(i16, stack.len - 1);

                while (i >= 0) : (i -= 1) {
                    const frame = stack[@intCast(usize, i)];
                    const file = frame.source_url.slice();
                    const func = frame.function_name.slice();

                    try writer.print(" {any}", .{frame.sourceURLFormatter(true)});
                    try writer.writeAll(" in ");
                    try writer.print("  {any}\n", .{frame.nameFormatter(true)});

                    // if (!frame.position.isInvalid()) {
                    //     if (func.len > 0) {
                    //         writer.print(
                    //             comptime Output.prettyFmt("<r><d>{s}<r> {s}{s} - {s}:{d}:{d}\n", true),
                    //             .{
                    //                 if (i > 1) "↓" else "↳",
                    //                 frame.code_type.ansiColor(),
                    //                 func,
                    //                 file,
                    //                 frame.position.line,
                    //                 frame.position.column_start,
                    //             },
                    //         ) catch unreachable;
                    //     } else {
                    //         writer.print(comptime Output.prettyFmt("<r><d>{s}<r> {u} - {s}{s}:{d}:{d}\n", true), .{
                    //             if (i > 1) "↓" else "↳",
                    //             frame.code_type.emoji(),

                    //             frame.code_type.ansiColor(),
                    //             file,
                    //             frame.position.line,
                    //             frame.position.column_start,
                    //         }) catch unreachable;
                    //     }
                    // } else {
                    //     if (func.len > 0) {
                    //         writer.print(
                    //             comptime Output.prettyFmt("<r><d>{s}<r> {s}{s} - {s}\n", true),
                    //             .{
                    //                 if (i > 1) "↓" else "↳",
                    //                 frame.code_type.ansiColor(),
                    //                 func,
                    //                 file,
                    //             },
                    //         ) catch unreachable;
                    //     } else {
                    //         writer.print(
                    //             comptime Output.prettyFmt("<r><d>{s}<r> {u} - {s}{s}\n", true),
                    //             .{
                    //                 if (i > 1) "↓" else "↳",
                    //                 frame.code_type.emoji(),
                    //                 frame.code_type.ansiColor(),
                    //                 file,
                    //             },
                    //         ) catch unreachable;
                    //     }
                    // }
                }
            }

            var line_numbers = exception.stack.source_lines_numbers[0..exception.stack.source_lines_len];
            var max_line: i32 = -1;
            for (line_numbers) |line| max_line = std.math.max(max_line, line);
            const max_line_number_pad = std.fmt.count("{d}", .{max_line});

            var source_lines = exception.stack.sourceLineIterator();
            var last_pad: u64 = 0;
            while (source_lines.untilLast()) |source| {
                const int_size = std.fmt.count("{d}", .{source.line});
                const pad = max_line_number_pad - int_size;
                last_pad = pad;
                writer.writeByteNTimes(' ', pad) catch unreachable;
                writer.print(
                    comptime Output.prettyFmt("<r><d>{d} | <r>{s}\n", true),
                    .{
                        source.line,
                        std.mem.trim(u8, source.text, "\n"),
                    },
                ) catch unreachable;
            }

            const name = exception.name.slice();
            const message = exception.message.slice();
            var did_print_name = false;
            if (source_lines.next()) |source| {
                const int_size = std.fmt.count("{d}", .{source.line});
                const pad = max_line_number_pad - int_size;
                writer.writeByteNTimes(' ', pad) catch unreachable;

                std.debug.assert(!stack[0].position.isInvalid());
                var remainder = std.mem.trim(u8, source.text, "\n");
                const prefix = remainder[0..@intCast(usize, stack[0].position.column_start)];
                const underline = remainder[@intCast(usize, stack[0].position.column_start)..@intCast(usize, stack[0].position.column_stop)];
                const suffix = remainder[@intCast(usize, stack[0].position.column_stop)..];

                writer.print(
                    comptime Output.prettyFmt("<r><d>{d} |<r> {s}<red>{s}<r>{s}<r>\n<r>", true),
                    .{
                        source.line,
                        prefix,
                        underline,
                        suffix,
                    },
                ) catch unreachable;
                var first_non_whitespace = @intCast(u32, stack[0].position.column_start);
                while (first_non_whitespace < source.text.len and source.text[first_non_whitespace] == ' ') {
                    first_non_whitespace += 1;
                }
                std.debug.assert(stack.len > 0);
                const indent = @intCast(usize, pad) + " | ".len + first_non_whitespace + 1;

                writer.writeByteNTimes(' ', indent) catch unreachable;
                writer.print(comptime Output.prettyFmt(
                    "<red><b>^<r>\n",
                    true,
                ), .{}) catch unreachable;

                if (name.len > 0 and message.len > 0) {
                    writer.print(comptime Output.prettyFmt(" <r><red><b>{s}<r><d>:<r> <b>{s}<r>\n", true), .{
                        name,
                        message,
                    }) catch unreachable;
                } else if (name.len > 0) {
                    writer.print(comptime Output.prettyFmt(" <r><b>{s}<r>\n", true), .{name}) catch unreachable;
                } else if (message.len > 0) {
                    writer.print(comptime Output.prettyFmt(" <r><b>{s}<r>\n", true), .{message}) catch unreachable;
                }

                did_print_name = true;
            }

            if (!did_print_name) {
                if (name.len > 0 and message.len > 0) {
                    writer.print(comptime Output.prettyFmt("<r><red><b>{s}<r><d>:<r> <b>{s}<r>\n", true), .{
                        name,
                        message,
                    }) catch unreachable;
                } else if (name.len > 0) {
                    writer.print(comptime Output.prettyFmt("<r><b>{s}<r>\n", true), .{name}) catch unreachable;
                } else if (message.len > 0) {
                    writer.print(comptime Output.prettyFmt("<r><b>{s}<r>\n", true), .{name}) catch unreachable;
                }
            }

            // Output.prettyErrorln("<r><red>{s}<r><d>:<r> <b>{s}<r>\n<blue>{s}<r>:{d}:{d}\n{s}", .{
            //     exception.name.slice(),
            //     exception.message.slice(),
            //     exception.sourceURL.slice(),
            //     exception.line,
            //     exception.column,
            //     exception.stack.slice(),
            // });
        }
    }
};

pub const Object = struct {
    ref: js.jsObjectRef,
};

const GetterFn = fn (
    this: anytype,
    ctx: js.JSContextRef,
    thisObject: js.JSValueRef,
    prop: js.JSStringRef,
    exception: js.ExceptionRef,
) js.JSValueRef;
const SetterFn = fn (
    this: anytype,
    ctx: js.JSContextRef,
    thisObject: js.JSValueRef,
    prop: js.JSStringRef,
    value: js.JSValueRef,
    exception: js.ExceptionRef,
) js.JSValueRef;

const JSProp = struct {
    get: ?GetterFn = null,
    set: ?SetterFn = null,
    ro: bool = false,
};

pub const EventListenerMixin = struct {
    threadlocal var event_listener_names_buf: [128]u8 = undefined;
    pub const List = std.ArrayList(js.JSObjectRef);
    pub const Map = std.AutoHashMap(EventListenerMixin.EventType, EventListenerMixin.List);

    pub const EventType = enum {
        fetch,
        err,

        const SizeMatcher = strings.ExactSizeMatcher(8);

        pub fn match(str: string) ?EventType {
            return switch (SizeMatcher.match(str)) {
                SizeMatcher.case("fetch") => EventType.fetch,
                SizeMatcher.case("error") => EventType.err,
                else => null,
            };
        }
    };

    pub fn emitFetchEventError(
        request: *http.RequestContext,
        comptime fmt: string,
        args: anytype,
    ) void {
        Output.prettyErrorln(fmt, args);
        request.sendInternalError(error.FetchEventError) catch {};
    }

    pub fn emitFetchEvent(
        vm: *VirtualMachine,
        request_context: *http.RequestContext,
    ) !void {
        var listeners = vm.event_listeners.get(EventType.fetch) orelse return emitFetchEventError(
            request_context,
            "Missing \"fetch\" handler. Did you run \"addEventListener(\"fetch\", (event) => {{}})\"?",
            .{},
        );
        if (listeners.items.len == 0) return emitFetchEventError(
            request_context,
            "Missing \"fetch\" handler. Did you run \"addEventListener(\"fetch\", (event) => {{}})\"?",
            .{},
        );

        var exception: js.JSValueRef = null;
        // Rely on JS finalizer
        var fetch_event = try vm.allocator.create(FetchEvent);
        fetch_event.* = FetchEvent{
            .request_context = request_context,
            .request = Request{ .request_context = request_context },
        };

        var fetch_args: [1]js.JSObjectRef = undefined;
        for (listeners.items) |listener| {
            fetch_args[0] = FetchEvent.Class.make(vm.global, fetch_event);

            _ = js.JSObjectCallAsFunction(
                vm.ctx,
                listener,
                js.JSContextGetGlobalObject(vm.ctx),
                1,
                &fetch_args,
                &exception,
            );
            if (request_context.has_called_done) {
                break;
            }
        }

        if (exception != null) {
            var message = js.JSValueToStringCopy(vm.ctx, exception, null);
            defer js.JSStringRelease(message);
            var buf = vm.allocator.alloc(u8, js.JSStringGetLength(message) + 1) catch unreachable;
            defer vm.allocator.free(buf);
            var note = buf[0 .. js.JSStringGetUTF8CString(message, buf.ptr, buf.len) - 1];

            Output.prettyErrorln("<r><red>error<r>: <b>{s}<r>", .{note});
            Output.flush();

            if (!request_context.has_called_done) {
                request_context.sendInternalError(error.JavaScriptError) catch {};
            }
            return;
        }

        if (!request_context.has_called_done) {
            return emitFetchEventError(
                request_context,
                "\"fetch\" handler never called event.respondWith()",
                .{},
            );
        }
    }

    pub fn addEventListener(
        comptime Struct: type,
    ) type {
        const Handler = struct {
            pub fn addListener(
                ctx: js.JSContextRef,
                function: js.JSObjectRef,
                thisObject: js.JSObjectRef,
                argumentCount: usize,
                _arguments: [*c]const js.JSValueRef,
                exception: js.ExceptionRef,
            ) callconv(.C) js.JSValueRef {
                const arguments = _arguments[0 .. argumentCount - 1];
                if (arguments.len == 0 or arguments.len == 1 or !js.JSValueIsString(ctx, arguments[0]) or !js.JSValueIsObject(ctx, arguments[arguments.len - 1]) or !js.JSObjectIsFunction(ctx, arguments[arguments.len - 1])) {
                    return js.JSValueMakeUndefined(ctx);
                }

                const name_len = js.JSStringGetLength(arguments[0]);
                if (name_len > event_listener_names_buf.len) {
                    return js.JSValueMakeUndefined(ctx);
                }

                const name_used_len = js.JSStringGetUTF8CString(arguments[0], &event_listener_names_buf, event_listener_names_buf.len);
                const name = event_listener_names_buf[0 .. name_used_len - 1];
                const event = EventType.match(name) orelse return js.JSValueMakeUndefined(ctx);
                var entry = VirtualMachine.vm.event_listeners.getOrPut(event) catch unreachable;

                if (!entry.found_existing) {
                    entry.value_ptr.* = List.initCapacity(VirtualMachine.vm.allocator, 1) catch unreachable;
                }

                var callback = arguments[arguments.len - 1];
                js.JSValueProtect(ctx, callback);
                entry.value_ptr.append(callback) catch unreachable;

                return js.JSValueMakeUndefined(ctx);
            }
        };

        return NewClass(
            Struct,
            .{
                .name = "addEventListener",
                .read_only = true,
            },
            .{
                .@"callAsFunction" = .{
                    .rfn = Handler.addListener,
                    .ts = d.ts{},
                },
            },
            .{},
        );
    }
};

pub const ResolveError = struct {
    msg: logger.Msg,
    allocator: *std.mem.Allocator,
    referrer: ?Fs.Path = null,

    pub const Class = NewClass(
        ResolveError,
        .{
            .name = "ResolveError",
            .read_only = true,
        },
        .{
            .@"referrer" = .{
                .@"get" = getReferrer,
                .ro = true,
                .ts = d.ts{ .@"return" = "string" },
            },
            .@"message" = .{
                .@"get" = getMessage,
                .ro = true,
                .ts = d.ts{ .@"return" = "string" },
            },
            .@"name" = .{
                .@"get" = getName,
                .ro = true,
                .ts = d.ts{ .@"return" = "string" },
            },
            .@"specifier" = .{
                .@"get" = getSpecifier,
                .ro = true,
                .ts = d.ts{ .@"return" = "string" },
            },
            .@"importKind" = .{
                .@"get" = getImportKind,
                .ro = true,
                .ts = d.ts{ .@"return" = "string" },
            },
            .@"position" = .{
                .@"get" = getPosition,
                .ro = true,
                .ts = d.ts{ .@"return" = "string" },
            },
        },
        .{},
    );

    pub fn create(
        msg: logger.Msg,
        allocator: *std.mem.Allocator,
    ) js.JSObjectRef {
        var resolve_error = allocator.create(ResolveError) catch unreachable;
        resolve_error.* = ResolveError{
            .msg = msg,
            .allocator = allocator,
        };

        return Class.make(VirtualMachine.vm.global, resolve_error);
    }

    pub fn getPosition(
        this: *ResolveError,
        ctx: js.JSContextRef,
        thisObject: js.JSObjectRef,
        prop: js.JSStringRef,
        exception: js.ExceptionRef,
    ) js.JSValueRef {
        return BuildError.generatePositionObject(this.msg, ctx, exception);
    }

    pub fn getMessage(
        this: *BuildError,
        ctx: js.JSContextRef,
        thisObject: js.JSObjectRef,
        prop: js.JSStringRef,
        exception: js.ExceptionRef,
    ) js.JSValueRef {
        return ZigString.init(this.msg.data.text).toValue(VirtualMachine.vm.global);
    }

    pub fn getSpecifier(
        this: *BuildError,
        ctx: js.JSContextRef,
        thisObject: js.JSObjectRef,
        prop: js.JSStringRef,
        exception: js.ExceptionRef,
    ) js.JSValueRef {
        return ZigString.init(this.msg.metadata.Resolve.specifier.slice(this.msg.data.text)).toValue(VirtualMachine.vm.global);
    }

    pub fn getImportKind(
        this: *BuildError,
        ctx: js.JSContextRef,
        thisObject: js.JSObjectRef,
        prop: js.JSStringRef,
        exception: js.ExceptionRef,
    ) js.JSValueRef {
        return ZigString.init(@tagName(this.msg.metadata.Resolve.import_kind)).toValue(VirtualMachine.vm.global);
    }

    pub fn getReferrer(
        this: *BuildError,
        ctx: js.JSContextRef,
        thisObject: js.JSObjectRef,
        prop: js.JSStringRef,
        exception: js.ExceptionRef,
    ) js.JSValueRef {
        if (this.referrer) |referrer| {
            return ZigString.init(referrer.text).toValue(VirtualMachine.vm.global);
        } else {
            return js.JSValueMakeNull(ctx);
        }
    }

    const BuildErrorName = "ResolveError";
    pub fn getName(
        this: *BuildError,
        ctx: js.JSContextRef,
        thisObject: js.JSObjectRef,
        prop: js.JSStringRef,
        exception: js.ExceptionRef,
    ) js.JSValueRef {
        return ZigString.init(BuildErrorName).toValue(VirtualMachine.vm.global);
    }
};

pub const BuildError = struct {
    msg: logger.Msg,
    // resolve_result: resolver.Result,
    allocator: *std.mem.Allocator,

    pub const Class = NewClass(
        BuildError,
        .{
            .name = "BuildError",
            .read_only = true,
        },
        .{},
        .{
            .@"message" = .{
                .@"get" = getMessage,
                .ro = true,
            },
            .@"name" = .{
                .@"get" = getName,
                .ro = true,
            },
            // This is called "position" instead of "location" because "location" may be confused with Location.
            .@"position" = .{
                .@"get" = getPosition,
                .ro = true,
            },
        },
    );

    pub fn create(
        allocator: *std.mem.Allocator,
        msg: *const logger.Msg,
        // resolve_result: *const resolver.Result,
    ) js.JSObjectRef {
        var build_error = allocator.create(BuildError) catch unreachable;
        build_error.* = BuildError{
            .msg = msg.*,
            // .resolve_result = resolve_result.*,
            .allocator = allocator,
        };

        return Class.make(VirtualMachine.vm.global, build_error);
    }

    pub fn getPosition(
        this: *BuildError,
        ctx: js.JSContextRef,
        thisObject: js.JSObjectRef,
        prop: js.JSStringRef,
        exception: js.ExceptionRef,
    ) js.JSValueRef {
        return generatePositionObject(this.msg, ctx, exception);
    }

    pub const PositionProperties = struct {
        const _file = ZigString.init("file");
        var file_ptr: js.JSStringRef = null;
        pub fn file() js.JSStringRef {
            if (file_ptr == null) {
                file_ptr = _file.toJSStringRef();
            }
            return file_ptr.?;
        }
        const _namespace = ZigString.init("namespace");
        var namespace_ptr: js.JSStringRef = null;
        pub fn namespace() js.JSStringRef {
            if (namespace_ptr == null) {
                namespace_ptr = _namespace.toJSStringRef();
            }
            return namespace_ptr.?;
        }
        const _line = ZigString.init("line");
        var line_ptr: js.JSStringRef = null;
        pub fn line() js.JSStringRef {
            if (line_ptr == null) {
                line_ptr = _line.toJSStringRef();
            }
            return line_ptr.?;
        }
        const _column = ZigString.init("column");
        var column_ptr: js.JSStringRef = null;
        pub fn column() js.JSStringRef {
            if (column_ptr == null) {
                column_ptr = _column.toJSStringRef();
            }
            return column_ptr.?;
        }
        const _length = ZigString.init("length");
        var length_ptr: js.JSStringRef = null;
        pub fn length() js.JSStringRef {
            if (length_ptr == null) {
                length_ptr = _length.toJSStringRef();
            }
            return length_ptr.?;
        }
        const _lineText = ZigString.init("lineText");
        var lineText_ptr: js.JSStringRef = null;
        pub fn lineText() js.JSStringRef {
            if (lineText_ptr == null) {
                lineText_ptr = _lineText.toJSStringRef();
            }
            return lineText_ptr.?;
        }
        const _offset = ZigString.init("offset");
        var offset_ptr: js.JSStringRef = null;
        pub fn offset() js.JSStringRef {
            if (offset_ptr == null) {
                offset_ptr = _offset.toJSStringRef();
            }
            return offset_ptr.?;
        }
    };

    pub fn generatePositionObject(msg: logger.Msg, ctx: js.JSContextRef, exception: ExceptionValueRef) js.JSValue {
        if (msg.data.location) |location| {
            const ref = js.JSObjectMake(ctx, null, null);
            js.JSObjectSetProperty(ctx, ref, PositionProperties.lineText(), ZigString.init(location.line_text orelse "").toJSStringRef(), 0, exception);
            js.JSObjectSetProperty(ctx, ref, PositionProperties.file(), ZigString.init(location.file).toJSStringRef(), 0, exception);
            js.JSObjectSetProperty(ctx, ref, PositionProperties.namespace(), ZigString.init(location.namespace).toJSStringRef(), 0, exception);
            js.JSObjectSetProperty(ctx, ref, PositionProperties.line(), js.JSValueMakeNumber(ctx, location.line), 0, exception);
            js.JSObjectSetProperty(ctx, ref, PositionProperties.column(), js.JSValueMakeNumber(ctx, location.column), 0, exception);
            js.JSObjectSetProperty(ctx, ref, PositionProperties.length(), js.JSValueMakeNumber(ctx, location.length), 0, exception);
            js.JSObjectSetProperty(ctx, ref, PositionProperties.offset(), js.JSValueMakeNumber(ctx, location.offset), 0, exception);
            return ref;
        }

        return js.JSValueMakeNull(ctx);
    }

    pub fn getMessage(
        this: *BuildError,
        ctx: js.JSContextRef,
        thisObject: js.JSObjectRef,
        prop: js.JSStringRef,
        exception: js.ExceptionRef,
    ) js.JSValueRef {
        return ZigString.init(this.msg.data.text).toValue(VirtualMachine.vm.global);
    }

    const BuildErrorName = "BuildError";
    pub fn getName(
        this: *BuildError,
        ctx: js.JSContextRef,
        thisObject: js.JSObjectRef,
        prop: js.JSStringRef,
        exception: js.ExceptionRef,
    ) js.JSValueRef {
        return ZigString.init(BuildErrorName).toValue(VirtualMachine.vm.global);
    }
};

pub const JSPrivateDataTag = JSPrivateDataPtr.Tag;
