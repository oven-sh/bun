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
};

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

    inline fn _fetch(global: *JSGlobalObject, specifier: string, source: string) !ResolvedSource {
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
                    .source_url = ZigString.init(path.pretty),
                    .hash = 0,
                    .bytecodecache_fd = 0,
                };
            },
            else => {
                return ResolvedSource{
                    .source_code = ZigString.init(try strings.quotedAlloc(VirtualMachine.vm.allocator, path.pretty)),
                    .specifier = ZigString.init(path.text),
                    .source_url = ZigString.init(path.pretty),
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

    pub fn fetch(global: *JSGlobalObject, specifier: ZigString, source: ZigString) callconv(.C) ErrorableResolvedSource {
        const result = _fetch(global, specifier.slice(), source.slice()) catch |err| {
            return ErrorableResolvedSource.errFmt(err, "{s}: \"{s}\"", .{
                @errorName(err),
                specifier.slice(),
            });
        };

        return ErrorableResolvedSource.ok(result);
    }

    pub fn loadEntryPoint(this: *VirtualMachine, entry_point: string) !void {
        var path = this.bundler.normalizeEntryPointPath(entry_point);

        var promise = JSModuleLoader.loadAndEvaluateModule(this.global, ZigString.init(path));

        this.global.vm().drainMicrotasks();

        while (promise.status(this.global.vm()) == JSPromise.Status.Pending) {
            this.global.vm().drainMicrotasks();
        }

        if (promise.status(this.global.vm()) == JSPromise.Status.Rejected) {
            var exception = promise.result(this.global.vm()).toZigException(this.global);
            Output.prettyErrorln("<r><red>{s}<r><d>:<r> <b>{s}<r>\n<blue>{s}<r>:{d}:{d}\n{s}", .{
                exception.name.slice(),
                exception.message.slice(),
                exception.sourceURL.slice(),
                exception.line,
                exception.column,
                exception.stack.slice(),
            });
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
            fetch_args[0] = js.JSObjectMake(
                vm.ctx,
                FetchEvent.Class.get().*,
                fetch_event,
            );

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
