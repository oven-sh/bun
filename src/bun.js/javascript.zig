const std = @import("std");
const is_bindgen: bool = std.meta.globalOption("bindgen", bool) orelse false;
const StaticExport = @import("./bindings/static_export.zig");
const bun = @import("root").bun;
const string = bun.string;
const Output = bun.Output;
const Global = bun.Global;
const Environment = bun.Environment;
const strings = bun.strings;
const MutableString = bun.MutableString;
const stringZ = bun.stringZ;
const default_allocator = bun.default_allocator;
const StoredFileDescriptorType = bun.StoredFileDescriptorType;
const ErrorableString = bun.JSC.ErrorableString;
const Arena = @import("../mimalloc_arena.zig").Arena;
const C = bun.C;

const Allocator = std.mem.Allocator;
const IdentityContext = @import("../identity_context.zig").IdentityContext;
const Fs = @import("../fs.zig");
const Resolver = @import("../resolver/resolver.zig");
const ast = @import("../import_record.zig");
const MacroEntryPoint = bun.bundler.MacroEntryPoint;
const ParseResult = bun.bundler.ParseResult;
const logger = bun.logger;
const Api = @import("../api/schema.zig").Api;
const options = @import("../options.zig");
const Bundler = bun.Bundler;
const PluginRunner = bun.bundler.PluginRunner;
const ServerEntryPoint = bun.bundler.ServerEntryPoint;
const js_printer = bun.js_printer;
const js_parser = bun.js_parser;
const js_ast = bun.JSAst;
const NodeFallbackModules = @import("../node_fallbacks.zig");
const ImportKind = ast.ImportKind;
const Analytics = @import("../analytics/analytics_thread.zig");
const ZigString = bun.JSC.ZigString;
const Runtime = @import("../runtime.zig");
const Router = @import("./api/filesystem_router.zig");
const ImportRecord = ast.ImportRecord;
const DotEnv = @import("../env_loader.zig");
const PackageJSON = @import("../resolver/package_json.zig").PackageJSON;
const MacroRemap = @import("../resolver/package_json.zig").MacroMap;
const WebCore = bun.JSC.WebCore;
const Request = WebCore.Request;
const Response = WebCore.Response;
const Headers = WebCore.Headers;
const String = bun.String;
const Fetch = WebCore.Fetch;
const FetchEvent = WebCore.FetchEvent;
const js = bun.JSC.C;
const JSC = bun.JSC;
const JSError = @import("./base.zig").JSError;
const d = @import("./base.zig").d;
const MarkedArrayBuffer = @import("./base.zig").MarkedArrayBuffer;
const getAllocator = @import("./base.zig").getAllocator;
const JSValue = bun.JSC.JSValue;
const NewClass = @import("./base.zig").NewClass;

const JSGlobalObject = bun.JSC.JSGlobalObject;
const ExceptionValueRef = bun.JSC.ExceptionValueRef;
const JSPrivateDataPtr = bun.JSC.JSPrivateDataPtr;
const ConsoleObject = bun.JSC.ConsoleObject;
const Node = bun.JSC.Node;
const ZigException = bun.JSC.ZigException;
const ZigStackTrace = bun.JSC.ZigStackTrace;
const ErrorableResolvedSource = bun.JSC.ErrorableResolvedSource;
const ResolvedSource = bun.JSC.ResolvedSource;
const JSPromise = bun.JSC.JSPromise;
const JSInternalPromise = bun.JSC.JSInternalPromise;
const JSModuleLoader = bun.JSC.JSModuleLoader;
const JSPromiseRejectionOperation = bun.JSC.JSPromiseRejectionOperation;
const Exception = bun.JSC.Exception;
const ErrorableZigString = bun.JSC.ErrorableZigString;
const ZigGlobalObject = bun.JSC.ZigGlobalObject;
const VM = bun.JSC.VM;
const JSFunction = bun.JSC.JSFunction;
const Config = @import("./config.zig");
const URL = @import("../url.zig").URL;
const Bun = JSC.API.Bun;
const EventLoop = JSC.EventLoop;
const PendingResolution = @import("../resolver/resolver.zig").PendingResolution;
const ThreadSafeFunction = JSC.napi.ThreadSafeFunction;
const PackageManager = @import("../install/install.zig").PackageManager;
const IPC = @import("ipc.zig");
pub const GenericWatcher = @import("../watcher.zig");

const ModuleLoader = JSC.ModuleLoader;
const FetchFlags = JSC.FetchFlags;

const TaggedPointerUnion = @import("../tagged_pointer.zig").TaggedPointerUnion;
const Task = JSC.Task;

pub const Buffer = MarkedArrayBuffer;
const Lock = @import("../lock.zig").Lock;
const BuildMessage = JSC.BuildMessage;
const ResolveMessage = JSC.ResolveMessage;
const Async = bun.Async;

const Ordinal = bun.Ordinal;

pub const OpaqueCallback = *const fn (current: ?*anyopaque) callconv(.C) void;
pub fn OpaqueWrap(comptime Context: type, comptime Function: fn (this: *Context) void) OpaqueCallback {
    return struct {
        pub fn callback(ctx: ?*anyopaque) callconv(.C) void {
            const context: *Context = @as(*Context, @ptrCast(@alignCast(ctx.?)));
            Function(context);
        }
    }.callback;
}

pub const bun_file_import_path = "/node_modules.server.bun";

export var has_bun_garbage_collector_flag_enabled = false;

const SourceMap = @import("../sourcemap/sourcemap.zig");
const ParsedSourceMap = SourceMap.Mapping.ParsedSourceMap;
const MappingList = SourceMap.Mapping.List;
const SourceProviderMap = SourceMap.SourceProviderMap;

const uv = bun.windows.libuv;

pub const SavedSourceMap = struct {
    /// This is a pointer to the map located on the VirtualMachine struct
    map: *HashTable,
    mutex: bun.Lock = bun.Lock.init(),

    pub const vlq_offset = 24;

    pub fn init(this: *SavedSourceMap, map: *HashTable) void {
        this.* = .{
            .map = map,
            .mutex = bun.Lock.init(),
        };

        this.map.lockPointers();
    }

    pub inline fn lock(map: *SavedSourceMap) void {
        map.mutex.lock();
        map.map.unlockPointers();
    }

    pub inline fn unlock(map: *SavedSourceMap) void {
        map.map.lockPointers();
        map.mutex.unlock();
    }

    // For the runtime, we store the number of mappings and how many bytes the final list is at the beginning of the array
    // The first 8 bytes are the length of the array
    // The second 8 bytes are the number of mappings
    pub const SavedMappings = struct {
        data: [*]u8,

        pub fn vlq(this: SavedMappings) []u8 {
            return this.data[vlq_offset..this.len()];
        }

        pub inline fn len(this: SavedMappings) usize {
            return @as(u64, @bitCast(this.data[0..8].*));
        }

        pub fn deinit(this: SavedMappings) void {
            default_allocator.free(this.data[0..this.len()]);
        }

        pub fn toMapping(this: SavedMappings, allocator: Allocator, path: string) anyerror!ParsedSourceMap {
            const result = SourceMap.Mapping.parse(
                allocator,
                this.data[vlq_offset..this.len()],
                @as(usize, @bitCast(this.data[8..16].*)),
                1,
                @as(usize, @bitCast(this.data[16..24].*)),
            );
            switch (result) {
                .fail => |fail| {
                    if (Output.enable_ansi_colors_stderr) {
                        try fail.toData(path).writeFormat(
                            Output.errorWriter(),
                            logger.Kind.warn,
                            true,
                        );
                    } else {
                        try fail.toData(path).writeFormat(
                            Output.errorWriter(),
                            logger.Kind.warn,

                            false,
                        );
                    }

                    return fail.err;
                },
                .success => |success| {
                    return success;
                },
            }
        }
    };

    /// ParsedSourceMap is the canonical form for sourcemaps,
    ///
    /// but `SavedMappings` and `SourceProviderMap` are much cheaper to construct.
    /// In `fn get`, this value gets converted to ParsedSourceMap always
    pub const Value = TaggedPointerUnion(.{
        ParsedSourceMap,
        SavedMappings,
        SourceProviderMap,
    });

    pub const MissingSourceMapNoteInfo = struct {
        pub var storage: bun.PathBuffer = undefined;
        pub var path: ?[]const u8 = null;
        pub var seen_invalid = false;

        pub fn print() void {
            if (seen_invalid) return;
            if (path) |note| {
                Output.note("missing sourcemaps for {s}", .{note});
                Output.note("consider bundling with '--sourcemap' to get unminified traces", .{});
            }
        }
    };

    pub fn putZigSourceProvider(this: *SavedSourceMap, opaque_source_provider: *anyopaque, path: []const u8) void {
        const source_provider: *SourceProviderMap = @ptrCast(opaque_source_provider);
        this.putValue(path, Value.init(source_provider)) catch bun.outOfMemory();
    }

    pub fn removeZigSourceProvider(this: *SavedSourceMap, opaque_source_provider: *anyopaque, path: []const u8) void {
        this.lock();
        defer this.unlock();

        const entry = this.map.getEntry(bun.hash(path)) orelse return;
        const old_value = Value.from(entry.value_ptr.*);
        if (old_value.get(SourceProviderMap)) |prov| {
            if (@intFromPtr(prov) == @intFromPtr(opaque_source_provider)) {
                // there is nothing to unref or deinit
                this.map.removeByPtr(entry.key_ptr);
            }
        } else if (old_value.get(ParsedSourceMap)) |map| {
            if (map.underlying_provider.provider()) |prov| {
                if (@intFromPtr(prov) == @intFromPtr(opaque_source_provider)) {
                    this.map.removeByPtr(entry.key_ptr);
                    map.deref();
                }
            }
        }
    }

    pub const HashTable = std.HashMap(u64, *anyopaque, IdentityContext(u64), 80);

    pub fn onSourceMapChunk(this: *SavedSourceMap, chunk: SourceMap.Chunk, source: logger.Source) anyerror!void {
        try this.putMappings(source, chunk.buffer);
    }

    pub const SourceMapHandler = js_printer.SourceMapHandler.For(SavedSourceMap, onSourceMapChunk);

    pub fn deinit(this: *SavedSourceMap) void {
        {
            this.lock();
            defer this.unlock();

            var iter = this.map.valueIterator();
            while (iter.next()) |val| {
                var value = Value.from(val.*);
                if (value.get(ParsedSourceMap)) |source_map| {
                    source_map.deref();
                } else if (value.get(SavedMappings)) |saved_mappings| {
                    var saved = SavedMappings{ .data = @as([*]u8, @ptrCast(saved_mappings)) };
                    saved.deinit();
                } else if (value.get(SourceProviderMap)) |provider| {
                    _ = provider; // do nothing, we did not hold a ref to ZigSourceProvider
                }
            }
        }

        this.map.unlockPointers();
        this.map.deinit();
    }

    pub fn putMappings(this: *SavedSourceMap, source: logger.Source, mappings: MutableString) !void {
        try this.putValue(source.path.text, Value.init(bun.cast(*SavedMappings, mappings.list.items.ptr)));
    }

    fn putValue(this: *SavedSourceMap, path: []const u8, value: Value) !void {
        this.lock();
        defer this.unlock();

        const entry = try this.map.getOrPut(bun.hash(path));
        if (entry.found_existing) {
            var old_value = Value.from(entry.value_ptr.*);
            if (old_value.get(ParsedSourceMap)) |parsed_source_map| {
                var source_map: *ParsedSourceMap = parsed_source_map;
                source_map.deref();
            } else if (old_value.get(SavedMappings)) |saved_mappings| {
                var saved = SavedMappings{ .data = @as([*]u8, @ptrCast(saved_mappings)) };
                saved.deinit();
            } else if (old_value.get(SourceProviderMap)) |provider| {
                _ = provider; // do nothing, we did not hold a ref to ZigSourceProvider
            }
        }
        entry.value_ptr.* = value.ptr();
    }

    fn getWithContent(
        this: *SavedSourceMap,
        path: string,
        hint: SourceMap.ParseUrlResultHint,
    ) SourceMap.ParseUrl {
        const hash = bun.hash(path);

        // This lock is for the hash table
        this.lock();

        // This mapping entry is only valid while the mutex is locked
        const mapping = this.map.getEntry(hash) orelse {
            this.unlock();
            return .{};
        };

        switch (Value.from(mapping.value_ptr.*).tag()) {
            Value.Tag.ParsedSourceMap => {
                defer this.unlock();
                const map = Value.from(mapping.value_ptr.*).as(ParsedSourceMap);
                map.ref();
                return .{ .map = map };
            },
            Value.Tag.SavedMappings => {
                defer this.unlock();
                var saved = SavedMappings{ .data = @as([*]u8, @ptrCast(Value.from(mapping.value_ptr.*).as(ParsedSourceMap))) };
                defer saved.deinit();
                const result = ParsedSourceMap.new(saved.toMapping(default_allocator, path) catch {
                    _ = this.map.remove(mapping.key_ptr.*);
                    return .{};
                });
                mapping.value_ptr.* = Value.init(result).ptr();
                result.ref();

                return .{ .map = result };
            },
            Value.Tag.SourceProviderMap => {
                var ptr = Value.from(mapping.value_ptr.*).as(SourceProviderMap);
                this.unlock();

                // Do not lock the mutex while we're parsing JSON!
                if (ptr.getSourceMap(path, .none, hint)) |parse| {
                    if (parse.map) |map| {
                        map.ref();
                        // The mutex is not locked. We have to check the hash table again.
                        this.putValue(path, Value.init(map)) catch bun.outOfMemory();

                        return parse;
                    }
                }

                this.lock();
                defer this.unlock();
                // does not have a valid source map. let's not try again
                _ = this.map.remove(hash);

                // Store path for a user note.
                const storage = MissingSourceMapNoteInfo.storage[0..path.len];
                @memcpy(storage, path);
                MissingSourceMapNoteInfo.path = storage;
                return .{};
            },
            else => {
                if (Environment.allow_assert) {
                    @panic("Corrupt pointer tag");
                }
                return .{};
            },
        }
    }

    pub fn get(this: *SavedSourceMap, path: string) ?*ParsedSourceMap {
        return this.getWithContent(path, .mappings_only).map;
    }

    pub fn resolveMapping(
        this: *SavedSourceMap,
        path: []const u8,
        line: i32,
        column: i32,
        source_handling: SourceMap.SourceContentHandling,
    ) ?SourceMap.Mapping.Lookup {
        const parse = this.getWithContent(path, switch (source_handling) {
            .no_source_contents => .mappings_only,
            .source_contents => .{ .all = .{ .line = line, .column = column } },
        });
        const map = parse.map orelse return null;

        const mapping = parse.mapping orelse
            SourceMap.Mapping.find(map.mappings, line, column) orelse
            return null;

        return .{
            .mapping = mapping,
            .source_map = map,
            .prefetched_source_code = parse.source_contents,
        };
    }
};
const uws = bun.uws;

pub export fn Bun__getDefaultGlobal() *JSGlobalObject {
    return JSC.VirtualMachine.get().global;
}

pub export fn Bun__getVM() *JSC.VirtualMachine {
    return JSC.VirtualMachine.get();
}

pub export fn Bun__drainMicrotasks() void {
    JSC.VirtualMachine.get().eventLoop().tick();
}

export fn Bun__readOriginTimer(vm: *JSC.VirtualMachine) u64 {
    return vm.origin_timer.read();
}

export fn Bun__readOriginTimerStart(vm: *JSC.VirtualMachine) f64 {
    // timespce to milliseconds
    return @as(f64, @floatCast((@as(f64, @floatFromInt(vm.origin_timestamp)) + JSC.VirtualMachine.origin_relative_epoch) / 1_000_000.0));
}

pub export fn Bun__GlobalObject__hasIPC(global: *JSC.JSGlobalObject) bool {
    return global.bunVM().ipc != null;
}

pub export fn Bun__Process__send(
    globalObject: *JSGlobalObject,
    callFrame: *JSC.CallFrame,
) callconv(JSC.conv) JSValue {
    JSC.markBinding(@src());
    if (callFrame.argumentsCount() < 1) {
        globalObject.throwInvalidArguments("process.send requires at least one argument", .{});
        return .zero;
    }
    const vm = globalObject.bunVM();
    if (vm.getIPCInstance()) |ipc_instance| {
        const success = ipc_instance.data.serializeAndSend(globalObject, callFrame.argument(0));
        return if (success) .undefined else .zero;
    } else {
        globalObject.throw("IPC Socket is no longer open.", .{});
        return .zero;
    }
}

pub export fn Bun__isBunMain(globalObject: *JSGlobalObject, str: *const bun.String) bool {
    return str.eqlUTF8(globalObject.bunVM().main);
}

pub export fn Bun__Process__disconnect(
    globalObject: *JSGlobalObject,
    callFrame: *JSC.CallFrame,
) callconv(JSC.conv) JSValue {
    JSC.markBinding(@src());
    _ = callFrame;
    _ = globalObject;
    return .undefined;
}

/// When IPC environment variables are passed, the socket is not immediately opened,
/// but rather we wait for process.on('message') or process.send() to be called, THEN
/// we open the socket. This is to avoid missing messages at the start of the program.
pub export fn Bun__ensureProcessIPCInitialized(globalObject: *JSGlobalObject) void {
    // getIPC() will initialize a "waiting" ipc instance so this is enough.
    // it will do nothing if IPC is not enabled.
    _ = globalObject.bunVM().getIPCInstance();
}

/// This function is called on the main thread
/// The bunVM() call will assert this
pub export fn Bun__queueTask(global: *JSGlobalObject, task: *JSC.CppTask) void {
    JSC.markBinding(@src());

    global.bunVM().eventLoop().enqueueTask(Task.init(task));
}

pub export fn Bun__queueTaskWithTimeout(global: *JSGlobalObject, task: *JSC.CppTask, milliseconds: i32) void {
    JSC.markBinding(@src());

    global.bunVM().eventLoop().enqueueTaskWithTimeout(Task.init(task), milliseconds);
}

pub export fn Bun__reportUnhandledError(globalObject: *JSGlobalObject, value: JSValue) callconv(.C) JSValue {
    JSC.markBinding(@src());
    // This JSGlobalObject might not be the main script execution context
    // See the crash in https://github.com/oven-sh/bun/issues/9778
    const jsc_vm = JSC.VirtualMachine.get();
    _ = jsc_vm.uncaughtException(globalObject, value, false);
    return JSC.JSValue.jsUndefined();
}

/// This function is called on another thread
/// The main difference: we need to allocate the task & wakeup the thread
/// We can avoid that if we run it from the main thread.
pub export fn Bun__queueTaskConcurrently(global: *JSGlobalObject, task: *JSC.CppTask) void {
    JSC.markBinding(@src());

    global.bunVMConcurrently().eventLoop().enqueueTaskConcurrent(
        JSC.ConcurrentTask.create(Task.init(task)),
    );
}

pub export fn Bun__handleRejectedPromise(global: *JSGlobalObject, promise: *JSC.JSPromise) void {
    JSC.markBinding(@src());

    const result = promise.result(global.vm());
    var jsc_vm = global.bunVM();

    // this seems to happen in some cases when GC is running
    if (result == .zero)
        return;

    _ = jsc_vm.unhandledRejection(global, result, promise.asValue(global));
    jsc_vm.autoGarbageCollect();
}

pub export fn Bun__onDidAppendPlugin(jsc_vm: *VirtualMachine, globalObject: *JSGlobalObject) void {
    if (jsc_vm.plugin_runner != null) {
        return;
    }

    jsc_vm.plugin_runner = PluginRunner{
        .global_object = globalObject,
        .allocator = jsc_vm.allocator,
    };
    jsc_vm.bundler.linker.plugin_runner = &jsc_vm.plugin_runner.?;
}

const WindowsOnly = struct {
    pub fn Bun__ZigGlobalObject__uvLoop(jsc_vm: *VirtualMachine) callconv(.C) *bun.windows.libuv.Loop {
        return jsc_vm.uvLoop();
    }
};

comptime {
    if (Environment.isWindows) {
        @export(WindowsOnly.Bun__ZigGlobalObject__uvLoop, .{ .name = "Bun__ZigGlobalObject__uvLoop" });
    }
}

pub const ExitHandler = struct {
    exit_code: u8 = 0,

    pub export fn Bun__getExitCode(vm: *VirtualMachine) u8 {
        return vm.exit_handler.exit_code;
    }

    pub export fn Bun__setExitCode(vm: *VirtualMachine, code: u8) void {
        vm.exit_handler.exit_code = code;
    }

    extern fn Process__dispatchOnBeforeExit(*JSC.JSGlobalObject, code: u8) void;
    extern fn Process__dispatchOnExit(*JSC.JSGlobalObject, code: u8) void;
    extern fn Bun__closeAllSQLiteDatabasesForTermination() void;

    pub fn dispatchOnExit(this: *ExitHandler) void {
        JSC.markBinding(@src());
        const vm: *VirtualMachine = @alignCast(@fieldParentPtr("exit_handler", this));
        Process__dispatchOnExit(vm.global, this.exit_code);
        if (vm.isMainThread()) {
            Bun__closeAllSQLiteDatabasesForTermination();
        }
    }

    pub fn dispatchOnBeforeExit(this: *ExitHandler) void {
        JSC.markBinding(@src());
        const vm: *VirtualMachine = @alignCast(@fieldParentPtr("exit_handler", this));
        Process__dispatchOnBeforeExit(vm.global, this.exit_code);
    }
};

pub const WebWorker = @import("./web_worker.zig").WebWorker;

pub const ImportWatcher = union(enum) {
    none: void,
    hot: *HotReloader.Watcher,
    watch: *WatchReloader.Watcher,

    pub fn start(this: ImportWatcher) !void {
        switch (this) {
            inline .hot => |w| try w.start(),
            inline .watch => |w| try w.start(),
            else => {},
        }
    }

    pub inline fn watchlist(this: ImportWatcher) GenericWatcher.WatchList {
        return switch (this) {
            inline .hot, .watch => |w| w.watchlist,
            else => .{},
        };
    }

    pub inline fn indexOf(this: ImportWatcher, hash: GenericWatcher.HashType) ?u32 {
        return switch (this) {
            inline .hot, .watch => |w| w.indexOf(hash),
            else => null,
        };
    }

    pub inline fn addFile(
        this: ImportWatcher,
        fd: StoredFileDescriptorType,
        file_path: string,
        hash: GenericWatcher.HashType,
        loader: options.Loader,
        dir_fd: StoredFileDescriptorType,
        package_json: ?*PackageJSON,
        comptime copy_file_path: bool,
    ) bun.JSC.Maybe(void) {
        return switch (this) {
            inline .hot, .watch => |watcher| watcher.addFile(
                fd,
                file_path,
                hash,
                loader,
                dir_fd,
                package_json,
                copy_file_path,
            ),
            .none => .{ .result = {} },
        };
    }
};

pub const PlatformEventLoop = if (Environment.isPosix) uws.Loop else bun.Async.Loop;

export fn Bun__setTLSRejectUnauthorizedValue(value: i32) void {
    VirtualMachine.get().default_tls_reject_unauthorized = value != 0;
}

export fn Bun__getTLSRejectUnauthorizedValue() i32 {
    return if (JSC.VirtualMachine.get().getTLSRejectUnauthorized()) 1 else 0;
}

export fn Bun__setVerboseFetchValue(value: i32) void {
    VirtualMachine.get().default_verbose_fetch = if (value == 1) .headers else if (value == 2) .curl else .none;
}

export fn Bun__getVerboseFetchValue() i32 {
    return switch (JSC.VirtualMachine.get().getVerboseFetch()) {
        .none => 0,
        .headers => 1,
        .curl => 2,
    };
}

/// TODO: rename this to ScriptExecutionContext
/// This is the shared global state for a single JS instance execution
/// Today, Bun is one VM per thread, so the name "VirtualMachine" sort of makes sense
/// However, that may change in the future
pub const VirtualMachine = struct {
    global: *JSGlobalObject,
    allocator: std.mem.Allocator,
    has_loaded_constructors: bool = false,
    bundler: Bundler,
    bun_watcher: ImportWatcher = .{ .none = {} },
    console: *ConsoleObject,
    log: *logger.Log,
    main: string = "",
    main_resolved_path: bun.String = bun.String.empty,
    main_hash: u32 = 0,
    process: js.JSObjectRef = null,
    flush_list: std.ArrayList(string),
    entry_point: ServerEntryPoint = undefined,
    origin: URL = URL{},
    node_fs: ?*Node.NodeFS = null,
    timer: Bun.Timer.All = .{},
    event_loop_handle: ?*PlatformEventLoop = null,
    pending_unref_counter: i32 = 0,
    preload: []const string = &[_][]const u8{},
    unhandled_pending_rejection_to_capture: ?*JSC.JSValue = null,
    standalone_module_graph: ?*bun.StandaloneModuleGraph = null,
    smol: bool = false,

    hot_reload: bun.CLI.Command.HotReload = .none,
    jsc: *JSC.VM = undefined,

    /// hide bun:wrap from stack traces
    /// bun:wrap is very noisy
    hide_bun_stackframes: bool = true,

    is_printing_plugin: bool = false,
    is_shutting_down: bool = false,
    plugin_runner: ?PluginRunner = null,
    is_main_thread: bool = false,
    last_reported_error_for_dedupe: JSValue = .zero,
    exit_handler: ExitHandler = .{},

    default_tls_reject_unauthorized: ?bool = null,
    default_verbose_fetch: ?bun.http.HTTPVerboseLevel = null,

    /// Do not access this field directly!
    ///
    /// It exists in the VirtualMachine struct so that we don't accidentally
    /// make a stack copy of it only use it through source_mappings.
    ///
    /// This proposal could let us safely move it back https://github.com/ziglang/zig/issues/7769
    saved_source_map_table: SavedSourceMap.HashTable = undefined,
    source_mappings: SavedSourceMap = undefined,

    arena: *Arena = undefined,
    has_loaded: bool = false,

    transpiled_count: usize = 0,
    resolved_count: usize = 0,
    had_errors: bool = false,

    macros: MacroMap,
    macro_entry_points: std.AutoArrayHashMap(i32, *MacroEntryPoint),
    macro_mode: bool = false,
    no_macros: bool = false,

    has_any_macro_remappings: bool = false,
    is_from_devserver: bool = false,
    has_enabled_macro_mode: bool = false,

    /// Used by bun:test to set global hooks for beforeAll, beforeEach, etc.
    is_in_preload: bool = false,

    transpiler_store: JSC.RuntimeTranspilerStore,

    after_event_loop_callback_ctx: ?*anyopaque = null,
    after_event_loop_callback: ?OpaqueCallback = null,

    /// The arguments used to launch the process _after_ the script name and bun and any flags applied to Bun
    ///     "bun run foo --bar"
    ///          ["--bar"]
    ///     "bun run foo baz --bar"
    ///          ["baz", "--bar"]
    ///     "bun run foo
    ///          []
    ///     "bun foo --bar"
    ///          ["--bar"]
    ///     "bun foo baz --bar"
    ///          ["baz", "--bar"]
    ///     "bun foo
    ///          []
    argv: []const []const u8 = &[_][]const u8{"bun"},

    origin_timer: std.time.Timer = undefined,
    origin_timestamp: u64 = 0,
    macro_event_loop: EventLoop = EventLoop{},
    regular_event_loop: EventLoop = EventLoop{},
    event_loop: *EventLoop = undefined,

    ref_strings: JSC.RefString.Map = undefined,
    ref_strings_mutex: Lock = undefined,

    active_tasks: usize = 0,

    rare_data: ?*JSC.RareData = null,
    is_us_loop_entered: bool = false,
    pending_internal_promise: *JSC.JSInternalPromise = undefined,
    entry_point_result: struct {
        value: JSC.Strong = .{},
        cjs_set_value: bool = false,
    } = .{},

    auto_install_dependencies: bool = false,

    onUnhandledRejection: *const OnUnhandledRejection = defaultOnUnhandledRejection,
    onUnhandledRejectionCtx: ?*anyopaque = null,
    onUnhandledRejectionExceptionList: ?*ExceptionList = null,
    unhandled_error_counter: usize = 0,
    is_handling_uncaught_exception: bool = false,

    modules: ModuleLoader.AsyncModule.Queue = .{},
    aggressive_garbage_collection: GCLevel = GCLevel.none,

    module_loader: ModuleLoader = .{},

    gc_controller: JSC.GarbageCollectionController = .{},
    worker: ?*JSC.WebWorker = null,
    ipc: ?IPCInstanceUnion = null,

    debugger: ?Debugger = null,
    has_started_debugger: bool = false,
    has_terminated: bool = false,

    debug_thread_id: if (Environment.allow_assert) std.Thread.Id else void,

    pub const OnUnhandledRejection = fn (*VirtualMachine, globalObject: *JSC.JSGlobalObject, JSC.JSValue) void;

    pub const OnException = fn (*ZigException) void;

    pub fn uwsLoop(this: *const VirtualMachine) *uws.Loop {
        if (comptime Environment.isPosix) {
            if (Environment.allow_assert) {
                return this.event_loop_handle orelse @panic("uws event_loop_handle is null");
            }
            return this.event_loop_handle.?;
        }

        return uws.Loop.get();
    }

    pub fn uvLoop(this: *const VirtualMachine) *bun.Async.Loop {
        if (Environment.allow_assert) {
            return this.event_loop_handle orelse @panic("libuv event_loop_handle is null");
        }
        return this.event_loop_handle.?;
    }

    pub fn isMainThread(this: *const VirtualMachine) bool {
        return this.worker == null;
    }

    pub fn isInspectorEnabled(this: *const VirtualMachine) bool {
        return this.debugger != null;
    }

    pub fn isShuttingDown(this: *const VirtualMachine) bool {
        return this.is_shutting_down;
    }

    pub fn getTLSRejectUnauthorized(this: *const VirtualMachine) bool {
        return this.default_tls_reject_unauthorized orelse this.bundler.env.getTLSRejectUnauthorized();
    }

    pub fn getVerboseFetch(this: *VirtualMachine) bun.http.HTTPVerboseLevel {
        return this.default_verbose_fetch orelse {
            if (this.bundler.env.get("BUN_CONFIG_VERBOSE_FETCH")) |verbose_fetch| {
                if (strings.eqlComptime(verbose_fetch, "true") or strings.eqlComptime(verbose_fetch, "1")) {
                    this.default_verbose_fetch = .headers;
                    return .headers;
                } else if (strings.eqlComptime(verbose_fetch, "curl")) {
                    this.default_verbose_fetch = .curl;
                    return .curl;
                }
            }
            this.default_verbose_fetch = .none;
            return .none;
        };
    }

    const VMHolder = struct {
        pub threadlocal var vm: ?*VirtualMachine = null;
    };

    pub inline fn get() *VirtualMachine {
        return VMHolder.vm.?;
    }

    pub fn mimeType(this: *VirtualMachine, str: []const u8) ?bun.http.MimeType {
        return this.rareData().mimeTypeFromString(this.allocator, str);
    }

    pub fn onAfterEventLoop(this: *VirtualMachine) void {
        if (this.after_event_loop_callback) |cb| {
            const ctx = this.after_event_loop_callback_ctx;
            this.after_event_loop_callback = null;
            this.after_event_loop_callback_ctx = null;
            cb(ctx);
        }
    }

    pub fn isEventLoopAlive(vm: *const VirtualMachine) bool {
        return vm.unhandled_error_counter == 0 and
            (vm.event_loop_handle.?.isActive() or
            vm.active_tasks + vm.event_loop.tasks.count + vm.event_loop.immediate_tasks.count + vm.event_loop.next_immediate_tasks.count > 0);
    }

    pub fn wakeup(this: *VirtualMachine) void {
        this.eventLoop().wakeup();
    }

    const SourceMapHandlerGetter = struct {
        vm: *VirtualMachine,
        printer: *js_printer.BufferPrinter,

        pub fn get(this: *SourceMapHandlerGetter) js_printer.SourceMapHandler {
            if (this.vm.debugger == null) {
                return SavedSourceMap.SourceMapHandler.init(&this.vm.source_mappings);
            }

            return js_printer.SourceMapHandler.For(SourceMapHandlerGetter, onChunk).init(this);
        }

        /// When the inspector is enabled, we want to generate an inline sourcemap.
        /// And, for now, we also store it in source_mappings like normal
        /// This is hideously expensive memory-wise...
        pub fn onChunk(this: *SourceMapHandlerGetter, chunk: SourceMap.Chunk, source: logger.Source) anyerror!void {
            var temp_json_buffer = bun.MutableString.initEmpty(bun.default_allocator);
            defer temp_json_buffer.deinit();
            temp_json_buffer = try chunk.printSourceMapContentsAtOffset(source, temp_json_buffer, true, SavedSourceMap.vlq_offset, true);
            const source_map_url_prefix_start = "//# sourceMappingURL=data:application/json;base64,";
            // TODO: do we need to %-encode the path?
            const source_url_len = source.path.text.len;
            const source_mapping_url = "\n//# sourceURL=";
            const prefix_len = source_map_url_prefix_start.len + source_mapping_url.len + source_url_len;

            try this.vm.source_mappings.putMappings(source, chunk.buffer);
            const encode_len = bun.base64.encodeLen(temp_json_buffer.list.items);
            try this.printer.ctx.buffer.growIfNeeded(encode_len + prefix_len + 2);
            this.printer.ctx.buffer.appendAssumeCapacity("\n" ++ source_map_url_prefix_start);
            _ = bun.base64.encode(this.printer.ctx.buffer.list.items.ptr[this.printer.ctx.buffer.len()..this.printer.ctx.buffer.list.capacity], temp_json_buffer.list.items);
            this.printer.ctx.buffer.list.items.len += encode_len;
            this.printer.ctx.buffer.appendAssumeCapacity(source_mapping_url);
            // TODO: do we need to %-encode the path?
            this.printer.ctx.buffer.appendAssumeCapacity(source.path.text);
            try this.printer.ctx.buffer.append("\n");
        }
    };

    pub inline fn sourceMapHandler(this: *VirtualMachine, printer: *js_printer.BufferPrinter) SourceMapHandlerGetter {
        return SourceMapHandlerGetter{
            .vm = this,
            .printer = printer,
        };
    }

    pub const GCLevel = enum(u3) {
        none = 0,
        mild = 1,
        aggressive = 2,
    };

    pub threadlocal var is_main_thread_vm: bool = false;

    pub const UnhandledRejectionScope = struct {
        ctx: ?*anyopaque = null,
        onUnhandledRejection: *const OnUnhandledRejection = undefined,
        count: usize = 0,

        pub fn apply(this: *UnhandledRejectionScope, vm: *JSC.VirtualMachine) void {
            vm.onUnhandledRejection = this.onUnhandledRejection;
            vm.onUnhandledRejectionCtx = this.ctx;
            vm.unhandled_error_counter = this.count;
        }
    };

    pub fn onQuietUnhandledRejectionHandler(this: *VirtualMachine, _: *JSC.JSGlobalObject, _: JSC.JSValue) void {
        this.unhandled_error_counter += 1;
    }

    pub fn onQuietUnhandledRejectionHandlerCaptureValue(this: *VirtualMachine, _: *JSC.JSGlobalObject, value: JSC.JSValue) void {
        this.unhandled_error_counter += 1;
        value.ensureStillAlive();
        if (this.unhandled_pending_rejection_to_capture) |ptr| {
            ptr.* = value;
        }
    }

    pub fn unhandledRejectionScope(this: *VirtualMachine) UnhandledRejectionScope {
        return .{
            .onUnhandledRejection = this.onUnhandledRejection,
            .ctx = this.onUnhandledRejectionCtx,
            .count = this.unhandled_error_counter,
        };
    }

    pub fn loadExtraEnv(this: *VirtualMachine) void {
        var map = this.bundler.env.map;

        if (map.get("BUN_SHOW_BUN_STACKFRAMES") != null) {
            this.hide_bun_stackframes = false;
        }

        if (map.map.fetchSwapRemove("NODE_CHANNEL_FD")) |kv| {
            const mode = if (map.map.fetchSwapRemove("NODE_CHANNEL_SERIALIZATION_MODE")) |mode_kv|
                IPC.Mode.fromString(mode_kv.value.value) orelse .json
            else
                .json;
            IPC.log("IPC environment variables: NODE_CHANNEL_FD={d}, NODE_CHANNEL_SERIALIZATION_MODE={s}", .{ kv.value.value, @tagName(mode) });
            if (Environment.isWindows) {
                this.initIPCInstance(kv.value.value, mode);
            } else {
                if (std.fmt.parseInt(i32, kv.value.value, 10)) |fd| {
                    this.initIPCInstance(bun.toFD(fd), mode);
                } else |_| {
                    Output.warn("Failed to parse IPC channel number '{s}'", .{kv.value.value});
                }
            }
        }

        if (map.get("BUN_GARBAGE_COLLECTOR_LEVEL")) |gc_level| {
            // Reuse this flag for other things to avoid unnecessary hashtable
            // lookups on start for obscure flags which we do not want others to
            // depend on.
            if (map.get("BUN_FEATURE_FLAG_FORCE_WAITER_THREAD") != null) {
                bun.spawn.WaiterThread.setShouldUseWaiterThread();
            }

            // Only allowed for testing
            if (map.get("BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING") != null) {
                ModuleLoader.is_allowed_to_use_internal_testing_apis = true;
            }

            if (strings.eqlComptime(gc_level, "1")) {
                this.aggressive_garbage_collection = .mild;
                has_bun_garbage_collector_flag_enabled = true;
            } else if (strings.eqlComptime(gc_level, "2")) {
                this.aggressive_garbage_collection = .aggressive;
                has_bun_garbage_collector_flag_enabled = true;
            }
        }
    }

    extern fn Bun__handleUncaughtException(*JSC.JSGlobalObject, err: JSC.JSValue, is_rejection: c_int) c_int;
    extern fn Bun__handleUnhandledRejection(*JSC.JSGlobalObject, reason: JSC.JSValue, promise: JSC.JSValue) c_int;
    extern fn Bun__Process__exit(*JSC.JSGlobalObject, code: c_int) noreturn;

    pub fn unhandledRejection(this: *JSC.VirtualMachine, globalObject: *JSC.JSGlobalObject, reason: JSC.JSValue, promise: JSC.JSValue) bool {
        if (this.isShuttingDown()) {
            Output.debugWarn("unhandledRejection during shutdown.", .{});
            return true;
        }

        if (isBunTest) {
            this.unhandled_error_counter += 1;
            this.onUnhandledRejection(this, globalObject, reason);
            return true;
        }

        const handled = Bun__handleUnhandledRejection(globalObject, reason, promise) > 0;
        if (!handled) {
            this.unhandled_error_counter += 1;
            this.onUnhandledRejection(this, globalObject, reason);
        }
        return handled;
    }

    pub fn uncaughtException(this: *JSC.VirtualMachine, globalObject: *JSC.JSGlobalObject, err: JSC.JSValue, is_rejection: bool) bool {
        if (this.isShuttingDown()) {
            Output.debugWarn("uncaughtException during shutdown.", .{});
            return true;
        }

        if (isBunTest) {
            this.unhandled_error_counter += 1;
            this.onUnhandledRejection(this, globalObject, err);
            return true;
        }

        if (this.is_handling_uncaught_exception) {
            this.runErrorHandler(err, null);
            Bun__Process__exit(globalObject, 1);
            @panic("Uncaught exception while handling uncaught exception");
        }
        this.is_handling_uncaught_exception = true;
        defer this.is_handling_uncaught_exception = false;
        const handled = Bun__handleUncaughtException(globalObject, err.toError() orelse err, if (is_rejection) 1 else 0) > 0;
        if (!handled) {
            // TODO maybe we want a separate code path for uncaught exceptions
            this.unhandled_error_counter += 1;
            this.onUnhandledRejection(this, globalObject, err);
        }
        return handled;
    }

    pub fn defaultOnUnhandledRejection(this: *JSC.VirtualMachine, _: *JSC.JSGlobalObject, value: JSC.JSValue) void {
        this.runErrorHandler(value, this.onUnhandledRejectionExceptionList);
    }

    pub inline fn packageManager(this: *VirtualMachine) *PackageManager {
        return this.bundler.getPackageManager();
    }

    pub fn garbageCollect(this: *const VirtualMachine, sync: bool) JSValue {
        @setCold(true);
        Global.mimalloc_cleanup(false);
        if (sync)
            return this.global.vm().runGC(true);

        this.global.vm().collectAsync();
        return JSValue.jsNumber(this.global.vm().heapSize());
    }

    pub inline fn autoGarbageCollect(this: *const VirtualMachine) void {
        if (this.aggressive_garbage_collection != .none) {
            _ = this.garbageCollect(this.aggressive_garbage_collection == .aggressive);
        }
    }

    pub fn reload(this: *VirtualMachine) void {
        Output.debug("Reloading...", .{});
        const should_clear_terminal = !this.bundler.env.hasSetNoClearTerminalOnReload(!Output.enable_ansi_colors);
        if (this.hot_reload == .watch) {
            Output.flush();
            bun.reloadProcess(
                bun.default_allocator,
                should_clear_terminal,
                false,
            );
        }

        if (should_clear_terminal) {
            Output.flush();
            Output.disableBuffering();
            Output.resetTerminalAll();
            Output.enableBuffering();
        }

        this.global.reload();
        this.pending_internal_promise = this.reloadEntryPoint(this.main) catch @panic("Failed to reload");
    }

    pub fn io(this: *VirtualMachine) *bun.AsyncIO {
        if (this.io_ == null) {
            this.io_ = bun.AsyncIO.init(this) catch @panic("Failed to initialize AsyncIO");
        }

        return &this.io_.?;
    }

    pub inline fn nodeFS(this: *VirtualMachine) *Node.NodeFS {
        return this.node_fs orelse brk: {
            this.node_fs = bun.default_allocator.create(Node.NodeFS) catch unreachable;
            this.node_fs.?.* = Node.NodeFS{
                // only used when standalone module graph is enabled
                .vm = if (this.standalone_module_graph != null) this else null,
            };
            break :brk this.node_fs.?;
        };
    }

    pub inline fn rareData(this: *VirtualMachine) *JSC.RareData {
        return this.rare_data orelse brk: {
            this.rare_data = this.allocator.create(JSC.RareData) catch unreachable;
            this.rare_data.?.* = .{};
            break :brk this.rare_data.?;
        };
    }

    pub inline fn eventLoop(this: *VirtualMachine) *EventLoop {
        return this.event_loop;
    }

    pub fn prepareLoop(_: *VirtualMachine) void {}

    pub fn enterUWSLoop(this: *VirtualMachine) void {
        var loop = this.event_loop_handle.?;
        loop.run();
    }

    pub fn onBeforeExit(this: *VirtualMachine) void {
        this.exit_handler.dispatchOnBeforeExit();
        var dispatch = false;
        while (true) {
            while (this.isEventLoopAlive()) : (dispatch = true) {
                this.tick();
                this.eventLoop().autoTickActive();
            }

            if (dispatch) {
                this.exit_handler.dispatchOnBeforeExit();
                dispatch = false;

                if (this.isEventLoopAlive()) continue;
            }

            break;
        }
    }

    pub fn scriptExecutionStatus(this: *const VirtualMachine) callconv(.C) JSC.ScriptExecutionStatus {
        if (this.is_shutting_down) {
            return .stopped;
        }

        if (this.worker) |worker| {
            if (worker.hasRequestedTerminate()) {
                return .stopped;
            }
        }

        return .running;
    }

    pub fn specifierIsEvalEntryPoint(this: *VirtualMachine, specifier: JSValue) callconv(.C) bool {
        if (this.module_loader.eval_source) |eval_source| {
            var specifier_str = specifier.toBunString(this.global);
            defer specifier_str.deref();
            return specifier_str.eqlUTF8(eval_source.path.text);
        }

        return false;
    }

    pub fn setEntryPointEvalResultESM(this: *VirtualMachine, result: JSValue) callconv(.C) void {
        // allow esm evaluate to set value multiple times
        if (!this.entry_point_result.cjs_set_value) {
            this.entry_point_result.value.set(this.global, result);
        }
    }

    pub fn setEntryPointEvalResultCJS(this: *VirtualMachine, value: JSValue) callconv(.C) void {
        if (!this.entry_point_result.value.has()) {
            this.entry_point_result.value.set(this.global, value);
            this.entry_point_result.cjs_set_value = true;
        }
    }

    comptime {
        @export(scriptExecutionStatus, .{ .name = "Bun__VM__scriptExecutionStatus" });
        @export(setEntryPointEvalResultESM, .{ .name = "Bun__VM__setEntryPointEvalResultESM" });
        @export(setEntryPointEvalResultCJS, .{ .name = "Bun__VM__setEntryPointEvalResultCJS" });
        @export(specifierIsEvalEntryPoint, .{ .name = "Bun__VM__specifierIsEvalEntryPoint" });
    }

    pub fn onExit(this: *VirtualMachine) void {
        this.exit_handler.dispatchOnExit();

        const rare_data = this.rare_data orelse return;
        var hook = rare_data.cleanup_hook orelse return;
        hook.execute();
        while (hook.next) |next| {
            next.execute();
            hook = next;
        }
    }

    pub fn nextAsyncTaskID(this: *VirtualMachine) u64 {
        var debugger: *Debugger = &(this.debugger orelse return 0);
        debugger.next_debugger_id +%= 1;
        return debugger.next_debugger_id;
    }

    pub fn hotMap(this: *VirtualMachine) ?*JSC.RareData.HotMap {
        if (this.hot_reload != .hot) {
            return null;
        }

        return this.rareData().hotMap(this.allocator);
    }

    pub var has_created_debugger: bool = false;

    pub const Debugger = struct {
        path_or_port: ?[]const u8 = null,
        unix: []const u8 = "",
        script_execution_context_id: u32 = 0,
        next_debugger_id: u64 = 1,
        poll_ref: Async.KeepAlive = .{},
        wait_for_connection: bool = false,
        set_breakpoint_on_first_line: bool = false,

        const debug = Output.scoped(.DEBUGGER, false);

        extern "C" fn Bun__createJSDebugger(*JSC.JSGlobalObject) u32;
        extern "C" fn Bun__ensureDebugger(u32, bool) void;
        extern "C" fn Bun__startJSDebuggerThread(*JSC.JSGlobalObject, u32, *bun.String) void;
        var futex_atomic: std.atomic.Value(u32) = undefined;

        pub fn create(this: *VirtualMachine, globalObject: *JSGlobalObject) !void {
            debug("create", .{});
            JSC.markBinding(@src());
            if (has_created_debugger) return;
            has_created_debugger = true;
            var debugger = &this.debugger.?;
            debugger.script_execution_context_id = Bun__createJSDebugger(globalObject);
            if (!this.has_started_debugger) {
                this.has_started_debugger = true;
                futex_atomic = std.atomic.Value(u32).init(0);
                var thread = try std.Thread.spawn(.{}, startJSDebuggerThread, .{this});
                thread.detach();
            }
            this.eventLoop().ensureWaker();

            if (debugger.wait_for_connection) {
                debugger.poll_ref.ref(this);
            }

            debug("spin", .{});
            while (futex_atomic.load(.monotonic) > 0) {
                std.Thread.Futex.wait(&futex_atomic, 1);
            }
            if (comptime Environment.allow_assert)
                debug("waitForDebugger: {}", .{Output.ElapsedFormatter{
                    .colors = Output.enable_ansi_colors_stderr,
                    .duration_ns = @truncate(@as(u128, @intCast(std.time.nanoTimestamp() - bun.CLI.start_time))),
                }});

            Bun__ensureDebugger(debugger.script_execution_context_id, debugger.wait_for_connection);
            while (debugger.wait_for_connection) {
                this.eventLoop().tick();
                if (debugger.wait_for_connection)
                    this.eventLoop().autoTickActive();
            }
        }

        pub fn startJSDebuggerThread(other_vm: *VirtualMachine) void {
            var arena = bun.MimallocArena.init() catch unreachable;
            Output.Source.configureNamedThread("Debugger");
            debug("startJSDebuggerThread", .{});
            JSC.markBinding(@src());

            var vm = JSC.VirtualMachine.init(.{
                .allocator = arena.allocator(),
                .args = std.mem.zeroes(Api.TransformOptions),
                .store_fd = false,
            }) catch @panic("Failed to create Debugger VM");
            vm.allocator = arena.allocator();
            vm.arena = &arena;

            vm.bundler.configureDefines() catch @panic("Failed to configure defines");
            vm.is_main_thread = false;
            vm.eventLoop().ensureWaker();

            vm.global.vm().holdAPILock(other_vm, @ptrCast(&start));
        }

        pub export fn Debugger__didConnect() void {
            var this = VirtualMachine.get();
            bun.assert(this.debugger.?.wait_for_connection);
            this.debugger.?.wait_for_connection = false;
            this.debugger.?.poll_ref.unref(this);
        }

        fn start(other_vm: *VirtualMachine) void {
            JSC.markBinding(@src());

            var this = VirtualMachine.get();
            const debugger = other_vm.debugger.?;

            if (debugger.unix.len > 0) {
                var url = bun.String.createUTF8(debugger.unix);
                Bun__startJSDebuggerThread(this.global, debugger.script_execution_context_id, &url);
            }

            if (debugger.path_or_port) |path_or_port| {
                var url = bun.String.createUTF8(path_or_port);
                Bun__startJSDebuggerThread(this.global, debugger.script_execution_context_id, &url);
            }

            this.global.handleRejectedPromises();

            if (this.log.msgs.items.len > 0) {
                if (Output.enable_ansi_colors) {
                    this.log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), true) catch {};
                } else {
                    this.log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), false) catch {};
                }
                Output.prettyErrorln("\n", .{});
                Output.flush();
            }

            debug("wake", .{});
            futex_atomic.store(0, .monotonic);
            std.Thread.Futex.wake(&futex_atomic, 1);

            this.eventLoop().tick();

            while (true) {
                while (this.isEventLoopAlive()) {
                    this.tick();
                    this.eventLoop().autoTickActive();
                }

                this.eventLoop().tickPossiblyForever();
            }
        }
    };

    pub inline fn enqueueTask(this: *VirtualMachine, task: Task) void {
        this.eventLoop().enqueueTask(task);
    }

    pub inline fn enqueueImmediateTask(this: *VirtualMachine, task: Task) void {
        this.eventLoop().enqueueImmediateTask(task);
    }

    pub inline fn enqueueTaskConcurrent(this: *VirtualMachine, task: *JSC.ConcurrentTask) void {
        this.eventLoop().enqueueTaskConcurrent(task);
    }

    pub fn tick(this: *VirtualMachine) void {
        this.eventLoop().tick();
    }

    pub fn waitFor(this: *VirtualMachine, cond: *bool) void {
        while (!cond.*) {
            this.eventLoop().tick();

            if (!cond.*) {
                this.eventLoop().autoTick();
            }
        }
    }

    pub fn waitForPromise(this: *VirtualMachine, promise: JSC.AnyPromise) void {
        this.eventLoop().waitForPromise(promise);
    }

    pub fn waitForTasks(this: *VirtualMachine) void {
        this.eventLoop().waitForTasks();
    }

    pub const MacroMap = std.AutoArrayHashMap(i32, js.JSObjectRef);

    pub fn enableMacroMode(this: *VirtualMachine) void {
        JSC.markBinding(@src());

        if (!this.has_enabled_macro_mode) {
            this.has_enabled_macro_mode = true;
            this.macro_event_loop.tasks = EventLoop.Queue.init(default_allocator);
            this.macro_event_loop.immediate_tasks = EventLoop.Queue.init(default_allocator);
            this.macro_event_loop.next_immediate_tasks = EventLoop.Queue.init(default_allocator);
            this.macro_event_loop.tasks.ensureTotalCapacity(16) catch unreachable;
            this.macro_event_loop.global = this.global;
            this.macro_event_loop.virtual_machine = this;
            this.macro_event_loop.concurrent_tasks = .{};
        }

        this.bundler.options.target = .bun_macro;
        this.bundler.resolver.caches.fs.use_alternate_source_cache = true;
        this.macro_mode = true;
        this.event_loop = &this.macro_event_loop;
        Analytics.Features.macros += 1;
        this.transpiler_store.enabled = false;
    }

    pub fn disableMacroMode(this: *VirtualMachine) void {
        this.bundler.options.target = .bun;
        this.bundler.resolver.caches.fs.use_alternate_source_cache = false;
        this.macro_mode = false;
        this.event_loop = &this.regular_event_loop;
        this.transpiler_store.enabled = true;
    }

    pub fn isWatcherEnabled(this: *VirtualMachine) bool {
        return this.bun_watcher != .none;
    }

    /// Instead of storing timestamp as a i128, we store it as a u64.
    /// We subtract the timestamp from Jan 1, 2000 (Y2K)
    pub const origin_relative_epoch = 946684800 * std.time.ns_per_s;
    fn getOriginTimestamp() u64 {
        return @as(
            u64,
            @truncate(@as(
                u128,
                // handle if they set their system clock to be before epoch
                @intCast(@max(
                    std.time.nanoTimestamp(),
                    origin_relative_epoch,
                )),
            ) - origin_relative_epoch),
        );
    }

    pub inline fn isLoaded() bool {
        return VMHolder.vm != null;
    }
    const RuntimeTranspilerStore = JSC.RuntimeTranspilerStore;
    pub fn initWithModuleGraph(
        opts: Options,
    ) !*VirtualMachine {
        JSC.markBinding(@src());
        const allocator = opts.allocator;
        VMHolder.vm = try allocator.create(VirtualMachine);
        const console = try allocator.create(ConsoleObject);
        console.* = ConsoleObject.init(Output.errorWriter(), Output.writer());
        const log = opts.log.?;
        const bundler = try Bundler.init(
            allocator,
            log,
            opts.args,
            null,
        );
        var vm = VMHolder.vm.?;

        vm.* = VirtualMachine{
            .global = undefined,
            .transpiler_store = RuntimeTranspilerStore.init(allocator),
            .allocator = allocator,
            .entry_point = ServerEntryPoint{},
            .bundler = bundler,
            .console = console,
            .log = log,
            .flush_list = std.ArrayList(string).init(allocator),
            .origin = bundler.options.origin,
            .saved_source_map_table = SavedSourceMap.HashTable.init(bun.default_allocator),
            .source_mappings = undefined,
            .macros = MacroMap.init(allocator),
            .macro_entry_points = @TypeOf(vm.macro_entry_points).init(allocator),
            .origin_timer = std.time.Timer.start() catch @panic("Timers are not supported on this system."),
            .origin_timestamp = getOriginTimestamp(),
            .ref_strings = JSC.RefString.Map.init(allocator),
            .ref_strings_mutex = Lock.init(),
            .standalone_module_graph = opts.graph.?,
            .debug_thread_id = if (Environment.allow_assert) std.Thread.getCurrentId() else {},
        };
        vm.source_mappings.init(&vm.saved_source_map_table);
        vm.regular_event_loop.tasks = EventLoop.Queue.init(
            default_allocator,
        );
        vm.regular_event_loop.immediate_tasks = EventLoop.Queue.init(
            default_allocator,
        );
        vm.regular_event_loop.next_immediate_tasks = EventLoop.Queue.init(
            default_allocator,
        );
        vm.regular_event_loop.tasks.ensureUnusedCapacity(64) catch unreachable;
        vm.regular_event_loop.concurrent_tasks = .{};
        vm.event_loop = &vm.regular_event_loop;

        vm.bundler.macro_context = null;
        vm.bundler.resolver.store_fd = false;
        vm.bundler.resolver.prefer_module_field = false;

        vm.bundler.resolver.onWakePackageManager = .{
            .context = &vm.modules,
            .handler = ModuleLoader.AsyncModule.Queue.onWakeHandler,
            .onDependencyError = JSC.ModuleLoader.AsyncModule.Queue.onDependencyError,
        };

        vm.bundler.resolver.standalone_module_graph = opts.graph.?;

        // Avoid reading from tsconfig.json & package.json when we're in standalone mode
        vm.bundler.configureLinkerWithAutoJSX(false);
        try vm.bundler.configureFramework(false);

        vm.bundler.macro_context = js_ast.Macro.MacroContext.init(&vm.bundler);

        vm.global = ZigGlobalObject.create(
            vm.console,
            -1,
            false,
            false,
            null,
        );
        vm.regular_event_loop.global = vm.global;
        vm.regular_event_loop.virtual_machine = vm;
        vm.jsc = vm.global.vm();

        if (source_code_printer == null) {
            const writer = try js_printer.BufferWriter.init(allocator);
            source_code_printer = allocator.create(js_printer.BufferPrinter) catch unreachable;
            source_code_printer.?.* = js_printer.BufferPrinter.init(writer);
            source_code_printer.?.ctx.append_null_byte = false;
        }

        vm.configureDebugger(opts.debugger);

        return vm;
    }

    pub const Options = struct {
        allocator: std.mem.Allocator,
        args: Api.TransformOptions,
        log: ?*logger.Log = null,
        env_loader: ?*DotEnv.Loader = null,
        store_fd: bool = false,
        smol: bool = false,

        // --print needs the result from evaluating the main module
        eval: bool = false,

        graph: ?*bun.StandaloneModuleGraph = null,
        debugger: bun.CLI.Command.Debugger = .{ .unspecified = {} },
    };

    pub var is_smol_mode = false;

    pub fn init(opts: Options) !*VirtualMachine {
        JSC.markBinding(@src());
        const allocator = opts.allocator;
        var log: *logger.Log = undefined;
        if (opts.log) |__log| {
            log = __log;
        } else {
            log = try allocator.create(logger.Log);
            log.* = logger.Log.init(allocator);
        }

        VMHolder.vm = try allocator.create(VirtualMachine);
        const console = try allocator.create(ConsoleObject);
        console.* = ConsoleObject.init(Output.errorWriter(), Output.writer());
        const bundler = try Bundler.init(
            allocator,
            log,
            try Config.configureTransformOptionsForBunVM(allocator, opts.args),
            opts.env_loader,
        );
        var vm = VMHolder.vm.?;

        vm.* = VirtualMachine{
            .global = undefined,
            .transpiler_store = RuntimeTranspilerStore.init(allocator),
            .allocator = allocator,
            .entry_point = ServerEntryPoint{},
            .bundler = bundler,
            .console = console,
            .log = log,
            .flush_list = std.ArrayList(string).init(allocator),
            .origin = bundler.options.origin,
            .saved_source_map_table = SavedSourceMap.HashTable.init(bun.default_allocator),
            .source_mappings = undefined,
            .macros = MacroMap.init(allocator),
            .macro_entry_points = @TypeOf(vm.macro_entry_points).init(allocator),
            .origin_timer = std.time.Timer.start() catch @panic("Please don't mess with timers."),
            .origin_timestamp = getOriginTimestamp(),
            .ref_strings = JSC.RefString.Map.init(allocator),
            .ref_strings_mutex = Lock.init(),
            .debug_thread_id = if (Environment.allow_assert) std.Thread.getCurrentId() else {},
        };
        vm.source_mappings.init(&vm.saved_source_map_table);
        vm.regular_event_loop.tasks = EventLoop.Queue.init(
            default_allocator,
        );
        vm.regular_event_loop.immediate_tasks = EventLoop.Queue.init(
            default_allocator,
        );
        vm.regular_event_loop.next_immediate_tasks = EventLoop.Queue.init(
            default_allocator,
        );
        vm.regular_event_loop.tasks.ensureUnusedCapacity(64) catch unreachable;
        vm.regular_event_loop.concurrent_tasks = .{};
        vm.event_loop = &vm.regular_event_loop;

        vm.bundler.macro_context = null;
        vm.bundler.resolver.store_fd = opts.store_fd;
        vm.bundler.resolver.prefer_module_field = false;

        vm.bundler.resolver.onWakePackageManager = .{
            .context = &vm.modules,
            .handler = ModuleLoader.AsyncModule.Queue.onWakeHandler,
            .onDependencyError = JSC.ModuleLoader.AsyncModule.Queue.onDependencyError,
        };

        vm.bundler.configureLinker();
        try vm.bundler.configureFramework(false);

        vm.bundler.macro_context = js_ast.Macro.MacroContext.init(&vm.bundler);

        if (opts.args.serve orelse false) {
            vm.bundler.linker.onImportCSS = Bun.onImportCSS;
        }

        vm.global = ZigGlobalObject.create(
            vm.console,
            -1,
            opts.smol,
            opts.eval,
            null,
        );
        vm.regular_event_loop.global = vm.global;
        vm.regular_event_loop.virtual_machine = vm;
        vm.jsc = vm.global.vm();
        vm.smol = opts.smol;

        if (opts.smol)
            is_smol_mode = opts.smol;

        if (source_code_printer == null) {
            const writer = try js_printer.BufferWriter.init(allocator);
            source_code_printer = allocator.create(js_printer.BufferPrinter) catch unreachable;
            source_code_printer.?.* = js_printer.BufferPrinter.init(writer);
            source_code_printer.?.ctx.append_null_byte = false;
        }

        vm.configureDebugger(opts.debugger);

        return vm;
    }

    pub inline fn assertOnJSThread(vm: *const VirtualMachine) void {
        if (Environment.allow_assert) {
            if (vm.debug_thread_id != std.Thread.getCurrentId()) {
                std.debug.panic("Expected to be on the JS thread.", .{});
            }
        }
    }

    fn configureDebugger(this: *VirtualMachine, debugger: bun.CLI.Command.Debugger) void {
        const unix = bun.getenvZ("BUN_INSPECT") orelse "";
        const set_breakpoint_on_first_line = unix.len > 0 and strings.endsWith(unix, "?break=1");
        const wait_for_connection = set_breakpoint_on_first_line or (unix.len > 0 and strings.endsWith(unix, "?wait=1"));

        switch (debugger) {
            .unspecified => {
                if (unix.len > 0) {
                    this.debugger = Debugger{
                        .path_or_port = null,
                        .unix = unix,
                        .wait_for_connection = wait_for_connection,
                        .set_breakpoint_on_first_line = set_breakpoint_on_first_line,
                    };
                }
            },
            .enable => {
                this.debugger = Debugger{
                    .path_or_port = debugger.enable.path_or_port,
                    .unix = unix,
                    .wait_for_connection = wait_for_connection or debugger.enable.wait_for_connection,
                    .set_breakpoint_on_first_line = set_breakpoint_on_first_line or debugger.enable.set_breakpoint_on_first_line,
                };
            },
        }

        if (debugger != .unspecified) {
            this.bundler.options.minify_identifiers = false;
            this.bundler.options.minify_syntax = false;
            this.bundler.options.minify_whitespace = false;
            this.bundler.options.debugger = true;
        }
    }

    pub fn initWorker(
        worker: *WebWorker,
        opts: Options,
    ) anyerror!*VirtualMachine {
        JSC.markBinding(@src());
        var log: *logger.Log = undefined;
        const allocator = opts.allocator;
        if (opts.log) |__log| {
            log = __log;
        } else {
            log = try allocator.create(logger.Log);
            log.* = logger.Log.init(allocator);
        }

        VMHolder.vm = try allocator.create(VirtualMachine);
        const console = try allocator.create(ConsoleObject);
        console.* = ConsoleObject.init(Output.errorWriter(), Output.writer());
        const bundler = try Bundler.init(
            allocator,
            log,
            try Config.configureTransformOptionsForBunVM(allocator, opts.args),
            opts.env_loader,
        );
        var vm = VMHolder.vm.?;

        vm.* = VirtualMachine{
            .global = undefined,
            .allocator = allocator,
            .transpiler_store = RuntimeTranspilerStore.init(allocator),
            .entry_point = ServerEntryPoint{},
            .bundler = bundler,
            .console = console,
            .log = log,
            .flush_list = std.ArrayList(string).init(allocator),
            .origin = bundler.options.origin,
            .saved_source_map_table = SavedSourceMap.HashTable.init(bun.default_allocator),
            .source_mappings = undefined,
            .macros = MacroMap.init(allocator),
            .macro_entry_points = @TypeOf(vm.macro_entry_points).init(allocator),
            .origin_timer = std.time.Timer.start() catch @panic("Please don't mess with timers."),
            .origin_timestamp = getOriginTimestamp(),
            .ref_strings = JSC.RefString.Map.init(allocator),
            .ref_strings_mutex = Lock.init(),
            .standalone_module_graph = worker.parent.standalone_module_graph,
            .worker = worker,
            .debug_thread_id = if (Environment.allow_assert) std.Thread.getCurrentId() else {},
        };
        vm.source_mappings.init(&vm.saved_source_map_table);
        vm.regular_event_loop.tasks = EventLoop.Queue.init(
            default_allocator,
        );
        vm.regular_event_loop.immediate_tasks = EventLoop.Queue.init(
            default_allocator,
        );
        vm.regular_event_loop.next_immediate_tasks = EventLoop.Queue.init(
            default_allocator,
        );
        vm.regular_event_loop.tasks.ensureUnusedCapacity(64) catch unreachable;
        vm.regular_event_loop.concurrent_tasks = .{};
        vm.event_loop = &vm.regular_event_loop;
        vm.hot_reload = worker.parent.hot_reload;
        vm.bundler.macro_context = null;
        vm.bundler.resolver.store_fd = opts.store_fd;
        vm.bundler.resolver.prefer_module_field = false;
        vm.bundler.resolver.onWakePackageManager = .{
            .context = &vm.modules,
            .handler = ModuleLoader.AsyncModule.Queue.onWakeHandler,
            .onDependencyError = JSC.ModuleLoader.AsyncModule.Queue.onDependencyError,
        };

        vm.bundler.configureLinker();
        try vm.bundler.configureFramework(false);
        vm.smol = opts.smol;
        vm.bundler.macro_context = js_ast.Macro.MacroContext.init(&vm.bundler);

        if (opts.args.serve orelse false) {
            vm.bundler.linker.onImportCSS = Bun.onImportCSS;
        }

        vm.global = ZigGlobalObject.create(
            vm.console,
            @as(i32, @intCast(worker.execution_context_id)),
            worker.mini,
            opts.eval,
            worker.cpp_worker,
        );
        vm.regular_event_loop.global = vm.global;
        vm.regular_event_loop.virtual_machine = vm;
        vm.jsc = vm.global.vm();
        vm.bundler.setAllocator(allocator);
        if (source_code_printer == null) {
            const writer = try js_printer.BufferWriter.init(allocator);
            source_code_printer = allocator.create(js_printer.BufferPrinter) catch unreachable;
            source_code_printer.?.* = js_printer.BufferPrinter.init(writer);
            source_code_printer.?.ctx.append_null_byte = false;
        }

        return vm;
    }

    pub threadlocal var source_code_printer: ?*js_printer.BufferPrinter = null;

    pub fn clearRefString(_: *anyopaque, ref_string: *JSC.RefString) void {
        _ = VirtualMachine.get().ref_strings.remove(ref_string.hash);
    }

    pub fn refCountedResolvedSource(this: *VirtualMachine, code: []const u8, specifier: bun.String, source_url: []const u8, hash_: ?u32, comptime add_double_ref: bool) ResolvedSource {
        // refCountedString will panic if the code is empty
        if (code.len == 0) {
            return ResolvedSource{
                .source_code = bun.String.init(""),
                .specifier = specifier,
                .source_url = specifier.createIfDifferent(source_url),
                .hash = 0,
                .allocator = null,
                .source_code_needs_deref = false,
            };
        }
        var source = this.refCountedString(code, hash_, !add_double_ref);
        if (add_double_ref) {
            source.ref();
            source.ref();
        }

        return ResolvedSource{
            .source_code = bun.String.init(source.impl),
            .specifier = specifier,
            .source_url = specifier.createIfDifferent(source_url),
            .hash = source.hash,
            .allocator = source,
            .source_code_needs_deref = false,
        };
    }

    pub fn refCountedStringWithWasNew(this: *VirtualMachine, new: *bool, input_: []const u8, hash_: ?u32, comptime dupe: bool) *JSC.RefString {
        JSC.markBinding(@src());
        bun.assert(input_.len > 0);
        const hash = hash_ orelse JSC.RefString.computeHash(input_);
        this.ref_strings_mutex.lock();
        defer this.ref_strings_mutex.unlock();

        const entry = this.ref_strings.getOrPut(hash) catch unreachable;
        if (!entry.found_existing) {
            const input = if (comptime dupe)
                (this.allocator.dupe(u8, input_) catch unreachable)
            else
                input_;

            const ref = this.allocator.create(JSC.RefString) catch unreachable;
            ref.* = JSC.RefString{
                .allocator = this.allocator,
                .ptr = input.ptr,
                .len = input.len,
                .impl = bun.String.createExternal(input, true, ref, &JSC.RefString.RefString__free).value.WTFStringImpl,
                .hash = hash,
                .ctx = this,
                .onBeforeDeinit = VirtualMachine.clearRefString,
            };
            entry.value_ptr.* = ref;
        }
        new.* = !entry.found_existing;
        return entry.value_ptr.*;
    }

    pub fn refCountedString(this: *VirtualMachine, input_: []const u8, hash_: ?u32, comptime dupe: bool) *JSC.RefString {
        bun.assert(input_.len > 0);
        var _was_new = false;
        return this.refCountedStringWithWasNew(&_was_new, input_, hash_, comptime dupe);
    }

    pub fn fetchWithoutOnLoadPlugins(
        jsc_vm: *VirtualMachine,
        globalObject: *JSC.JSGlobalObject,
        _specifier: String,
        referrer: String,
        log: *logger.Log,
        comptime flags: FetchFlags,
    ) anyerror!ResolvedSource {
        bun.assert(VirtualMachine.isLoaded());

        if (try ModuleLoader.fetchBuiltinModule(jsc_vm, _specifier)) |builtin| {
            return builtin;
        }

        const display_specifier = _specifier.toUTF8(bun.default_allocator);
        defer display_specifier.deinit();
        const specifier_clone = _specifier.toUTF8(bun.default_allocator);
        defer specifier_clone.deinit();
        var display_slice = display_specifier.slice();
        const specifier = ModuleLoader.normalizeSpecifier(jsc_vm, specifier_clone.slice(), &display_slice);
        const referrer_clone = referrer.toUTF8(bun.default_allocator);
        defer referrer_clone.deinit();
        var path = Fs.Path.init(specifier_clone.slice());

        // For blobs.
        var blob_source: ?JSC.WebCore.Blob = null;
        var virtual_source_to_use: ?logger.Source = null;
        defer {
            if (blob_source) |*blob| {
                blob.deinit();
            }
        }

        const loader, const virtual_source = brk: {
            if (jsc_vm.module_loader.eval_source) |eval_source| {
                if (strings.endsWithComptime(specifier, bun.pathLiteral("/[eval]"))) {
                    break :brk .{ .tsx, eval_source };
                }
                if (strings.endsWithComptime(specifier, bun.pathLiteral("/[stdin]"))) {
                    break :brk .{ .tsx, eval_source };
                }
            }

            var ext_for_loader = path.name.ext;

            // Support errors within blob: URLs
            // Be careful to handle Bun.file(), in addition to regular Blob/File objects
            // Bun.file() should be treated the same as a file path.
            if (JSC.WebCore.ObjectURLRegistry.isBlobURL(specifier)) {
                if (JSC.WebCore.ObjectURLRegistry.singleton().resolveAndDupe(specifier["blob:".len..])) |blob| {
                    blob_source = blob;

                    if (blob.getFileName()) |filename| {
                        const current_path = Fs.Path.init(filename);
                        if (blob.needsToReadFile()) {
                            path = current_path;
                        }

                        ext_for_loader = current_path.name.ext;
                    } else if (blob.getMimeTypeOrContentType()) |mime_type| {
                        if (strings.hasPrefixComptime(mime_type.value, "application/javascript-jsx")) {
                            ext_for_loader = ".jsx";
                        } else if (strings.hasPrefixComptime(mime_type.value, "application/typescript-jsx")) {
                            ext_for_loader = ".tsx";
                        } else if (strings.hasPrefixComptime(mime_type.value, "application/javascript")) {
                            ext_for_loader = ".js";
                        } else if (strings.hasPrefixComptime(mime_type.value, "application/typescript")) {
                            ext_for_loader = ".ts";
                        } else if (strings.hasPrefixComptime(mime_type.value, "application/json")) {
                            ext_for_loader = ".json";
                        } else if (strings.hasPrefixComptime(mime_type.value, "application/json5")) {
                            ext_for_loader = ".jsonc";
                        } else if (strings.hasPrefixComptime(mime_type.value, "application/jsonc")) {
                            ext_for_loader = ".jsonc";
                        } else if (mime_type.category == .text) {
                            ext_for_loader = ".txt";
                        } else {
                            // Be maximally permissive.
                            ext_for_loader = ".tsx";
                        }
                    } else {
                        // Be maximally permissive.
                        ext_for_loader = ".tsx";
                    }

                    if (!blob.needsToReadFile()) {
                        virtual_source_to_use = logger.Source{
                            .path = path,
                            .key_path = path,
                            .contents = blob.sharedView(),
                        };
                    }
                } else {
                    return error.ModuleNotFound;
                }
            }

            break :brk .{
                jsc_vm.bundler.options.loaders.get(ext_for_loader) orelse brk2: {
                    if (strings.eqlLong(specifier, jsc_vm.main, true)) {
                        break :brk2 options.Loader.js;
                    }
                    break :brk2 options.Loader.file;
                },
                if (virtual_source_to_use) |*src| src else null,
            };
        };

        // .print_source, which is used by exceptions avoids duplicating the entire source code
        // but that means we have to be careful of the lifetime of the source code
        // so we only want to reset the arena once its done freeing it.
        defer if (flags != .print_source) jsc_vm.module_loader.resetArena(jsc_vm);
        errdefer if (flags == .print_source) jsc_vm.module_loader.resetArena(jsc_vm);

        return try ModuleLoader.transpileSourceCode(
            jsc_vm,
            specifier_clone.slice(),
            display_slice,
            referrer_clone.slice(),
            _specifier,
            path,
            loader,
            log,
            virtual_source,
            null,
            VirtualMachine.source_code_printer.?,
            globalObject,
            flags,
        );
    }

    pub const ResolveFunctionResult = struct {
        result: ?Resolver.Result,
        path: string,
        query_string: []const u8 = "",
    };

    fn normalizeSpecifierForResolution(specifier_: []const u8, query_string: *[]const u8) []const u8 {
        var specifier = specifier_;

        if (strings.indexOfChar(specifier, '?')) |i| {
            query_string.* = specifier[i..];
            specifier = specifier[0..i];
        }

        return specifier;
    }

    threadlocal var specifier_cache_resolver_buf: bun.PathBuffer = undefined;
    fn _resolve(
        ret: *ResolveFunctionResult,
        specifier: string,
        source: string,
        is_esm: bool,
        comptime is_a_file_path: bool,
    ) !void {
        bun.assert(VirtualMachine.isLoaded());
        // macOS threadlocal vars are very slow
        // we won't change threads in this function
        // so we can copy it here
        var jsc_vm = VirtualMachine.get();

        if (strings.eqlComptime(std.fs.path.basename(specifier), Runtime.Runtime.Imports.alt_name)) {
            ret.path = Runtime.Runtime.Imports.Name;
            return;
        } else if (strings.eqlComptime(specifier, main_file_name)) {
            ret.result = null;
            ret.path = jsc_vm.entry_point.source.path.text;
            return;
        } else if (strings.hasPrefixComptime(specifier, js_ast.Macro.namespaceWithColon)) {
            ret.result = null;
            ret.path = specifier;
            return;
        } else if (strings.hasPrefixComptime(specifier, "/bun-vfs/node_modules/")) {
            ret.result = null;
            ret.path = specifier;
            return;
        } else if (JSC.HardcodedModule.Aliases.get(specifier, .bun)) |result| {
            ret.result = null;
            ret.path = result.path;
            return;
        } else if (jsc_vm.module_loader.eval_source != null and
            (strings.endsWithComptime(specifier, bun.pathLiteral("/[eval]")) or
            strings.endsWithComptime(specifier, bun.pathLiteral("/[stdin]"))))
        {
            ret.result = null;
            ret.path = specifier;
            return;
        } else if (strings.hasPrefixComptime(specifier, "blob:")) {
            ret.result = null;
            if (JSC.WebCore.ObjectURLRegistry.singleton().has(specifier["blob:".len..])) {
                ret.path = specifier;
                return;
            } else {
                return error.ModuleNotFound;
            }
        }

        const is_special_source = strings.eqlComptime(source, main_file_name) or js_ast.Macro.isMacroPath(source);
        var query_string: []const u8 = "";
        const normalized_specifier = normalizeSpecifierForResolution(specifier, &query_string);
        const source_to_use = if (!is_special_source)
            if (is_a_file_path)
                Fs.PathName.init(source).dirWithTrailingSlash()
            else
                source
        else
            jsc_vm.bundler.fs.top_level_dir;

        const result: Resolver.Result = try brk: {
            // TODO: We only want to retry on not found only when the directories we searched for were cached.
            // This fixes an issue where new files created in cached directories were not picked up.
            // See https://github.com/oven-sh/bun/issues/3216
            //
            // This cache-bust is disabled when the filesystem is not being used to resolve.
            var retry_on_not_found = std.fs.path.isAbsolute(source_to_use);
            while (true) {
                break :brk switch (jsc_vm.bundler.resolver.resolveAndAutoInstall(
                    source_to_use,
                    normalized_specifier,
                    if (is_esm) .stmt else .require,
                    if (jsc_vm.standalone_module_graph == null) .read_only else .disable,
                )) {
                    .success => |r| r,
                    .failure => |e| e,
                    .pending, .not_found => if (!retry_on_not_found)
                        error.ModuleNotFound
                    else {
                        retry_on_not_found = false;

                        const buster_name = name: {
                            if (std.fs.path.isAbsolute(normalized_specifier)) {
                                if (std.fs.path.dirname(normalized_specifier)) |dir| {
                                    // Normalized with trailing slash
                                    break :name bun.strings.normalizeSlashesOnly(&specifier_cache_resolver_buf, dir, std.fs.path.sep);
                                }
                            }

                            var parts = [_]string{
                                source_to_use,
                                normalized_specifier,
                                bun.pathLiteral(".."),
                            };

                            break :name bun.path.joinAbsStringBufZ(
                                jsc_vm.bundler.fs.top_level_dir,
                                &specifier_cache_resolver_buf,
                                &parts,
                                .auto,
                            );
                        };

                        // Only re-query if we previously had something cached.
                        if (jsc_vm.bundler.resolver.bustDirCache(buster_name)) {
                            continue;
                        }

                        return error.ModuleNotFound;
                    },
                };
            }
        };

        if (!jsc_vm.macro_mode) {
            jsc_vm.has_any_macro_remappings = jsc_vm.has_any_macro_remappings or jsc_vm.bundler.options.macro_remap.count() > 0;
        }
        ret.result = result;
        ret.query_string = query_string;
        const result_path = result.pathConst() orelse return error.ModuleNotFound;
        jsc_vm.resolved_count += 1;

        ret.path = result_path.text;
    }

    pub fn resolveForAPI(
        res: *ErrorableString,
        global: *JSGlobalObject,
        specifier: bun.String,
        source: bun.String,
        query_string: ?*ZigString,
        is_esm: bool,
    ) void {
        resolveMaybeNeedsTrailingSlash(res, global, specifier, source, query_string, is_esm, false);
    }

    pub fn resolveFilePathForAPI(
        res: *ErrorableString,
        global: *JSGlobalObject,
        specifier: bun.String,
        source: bun.String,
        query_string: ?*ZigString,
        is_esm: bool,
    ) void {
        resolveMaybeNeedsTrailingSlash(res, global, specifier, source, query_string, is_esm, true);
    }

    pub fn resolve(
        res: *ErrorableString,
        global: *JSGlobalObject,
        specifier: bun.String,
        source: bun.String,
        query_string: ?*ZigString,
        is_esm: bool,
    ) void {
        resolveMaybeNeedsTrailingSlash(res, global, specifier, source, query_string, is_esm, true);
    }

    fn normalizeSource(source: []const u8) []const u8 {
        if (strings.hasPrefixComptime(source, "file://")) {
            return source["file://".len..];
        }

        return source;
    }

    fn resolveMaybeNeedsTrailingSlash(
        res: *ErrorableString,
        global: *JSGlobalObject,
        specifier: bun.String,
        source: bun.String,
        query_string: ?*ZigString,
        is_esm: bool,
        comptime is_a_file_path: bool,
    ) void {
        if (is_a_file_path and specifier.length() > comptime @as(u32, @intFromFloat(@trunc(@as(f64, @floatFromInt(bun.MAX_PATH_BYTES)) * 1.5)))) {
            const specifier_utf8 = specifier.toUTF8(bun.default_allocator);
            defer specifier_utf8.deinit();
            const source_utf8 = source.toUTF8(bun.default_allocator);
            defer source_utf8.deinit();
            const printed = ResolveMessage.fmt(
                bun.default_allocator,
                specifier_utf8.slice(),
                source_utf8.slice(),
                error.NameTooLong,
            ) catch bun.outOfMemory();
            const msg = logger.Msg{
                .data = logger.rangeData(
                    null,
                    logger.Range.None,
                    printed,
                ),
            };
            res.* = ErrorableString.err(error.NameTooLong, ResolveMessage.create(global, VirtualMachine.get().allocator, msg, source_utf8.slice()).asVoid());
            return;
        }

        var result = ResolveFunctionResult{ .path = "", .result = null };
        var jsc_vm = VirtualMachine.get();
        const specifier_utf8 = specifier.toUTF8(bun.default_allocator);
        defer specifier_utf8.deinit();

        const source_utf8 = source.toUTF8(bun.default_allocator);
        defer source_utf8.deinit();
        if (jsc_vm.plugin_runner) |plugin_runner| {
            if (PluginRunner.couldBePlugin(specifier_utf8.slice())) {
                const namespace = PluginRunner.extractNamespace(specifier_utf8.slice());
                const after_namespace = if (namespace.len == 0)
                    specifier_utf8.slice()
                else
                    specifier_utf8.slice()[namespace.len + 1 .. specifier_utf8.len];

                if (plugin_runner.onResolveJSC(bun.String.init(namespace), bun.String.fromUTF8(after_namespace), source, .bun)) |resolved_path| {
                    res.* = resolved_path;
                    return;
                }
            }
        }

        if (JSC.HardcodedModule.Aliases.getWithEql(specifier, bun.String.eqlComptime, jsc_vm.bundler.options.target)) |hardcoded| {
            if (hardcoded.tag == .none) {
                resolveMaybeNeedsTrailingSlash(
                    res,
                    global,
                    bun.String.init(hardcoded.path),
                    source,
                    query_string,
                    is_esm,
                    is_a_file_path,
                );
                return;
            }

            res.* = ErrorableString.ok(bun.String.init(hardcoded.path));
            return;
        }

        const old_log = jsc_vm.log;
        // the logger can end up being called on another thread, it must not use threadlocal Heap Allocator
        var log = logger.Log.init(bun.default_allocator);
        defer log.deinit();
        jsc_vm.log = &log;
        jsc_vm.bundler.resolver.log = &log;
        jsc_vm.bundler.linker.log = &log;
        defer {
            jsc_vm.log = old_log;
            jsc_vm.bundler.linker.log = old_log;
            jsc_vm.bundler.resolver.log = old_log;
        }
        _resolve(&result, specifier_utf8.slice(), normalizeSource(source_utf8.slice()), is_esm, is_a_file_path) catch |err_| {
            var err = err_;
            const msg: logger.Msg = brk: {
                const msgs: []logger.Msg = log.msgs.items;

                for (msgs) |m| {
                    if (m.metadata == .resolve) {
                        err = m.metadata.resolve.err;
                        break :brk m;
                    }
                }

                const printed = ResolveMessage.fmt(
                    jsc_vm.allocator,
                    specifier_utf8.slice(),
                    source_utf8.slice(),
                    err,
                ) catch unreachable;
                break :brk logger.Msg{
                    .data = logger.rangeData(
                        null,
                        logger.Range.None,
                        printed,
                    ),
                    .metadata = .{
                        // import_kind is wrong probably
                        .resolve = .{ .specifier = logger.BabyString.in(printed, specifier_utf8.slice()), .import_kind = if (is_esm) .stmt else .require },
                    },
                };
            };

            {
                res.* = ErrorableString.err(err, ResolveMessage.create(global, VirtualMachine.get().allocator, msg, source_utf8.slice()).asVoid());
            }

            return;
        };

        if (query_string) |query| {
            query.* = ZigString.init(result.query_string);
        }

        res.* = ErrorableString.ok(bun.String.init(result.path));
    }

    pub const main_file_name: string = "bun:main";

    pub fn drainMicrotasks(this: *VirtualMachine) void {
        this.eventLoop().drainMicrotasks();
    }

    pub fn processFetchLog(globalThis: *JSGlobalObject, specifier: bun.String, referrer: bun.String, log: *logger.Log, ret: *ErrorableResolvedSource, err: anyerror) void {
        switch (log.msgs.items.len) {
            0 => {
                const msg: logger.Msg = brk: {
                    if (err == error.UnexpectedPendingResolution) {
                        break :brk logger.Msg{
                            .data = logger.rangeData(
                                null,
                                logger.Range.None,
                                std.fmt.allocPrint(globalThis.allocator(), "Unexpected pending import in \"{}\". To automatically install npm packages with Bun, please use an import statement instead of require() or dynamic import().\nThis error can also happen if dependencies import packages which are not referenced anywhere. Worst case, run `bun install` and opt-out of the node_modules folder until we come up with a better way to handle this error.", .{specifier}) catch unreachable,
                            ),
                        };
                    }

                    break :brk logger.Msg{
                        .data = logger.rangeData(null, logger.Range.None, std.fmt.allocPrint(globalThis.allocator(), "{s} while building {}", .{ @errorName(err), specifier }) catch unreachable),
                    };
                };
                {
                    ret.* = ErrorableResolvedSource.err(err, BuildMessage.create(globalThis, globalThis.allocator(), msg).asVoid());
                }
                return;
            },

            1 => {
                const msg = log.msgs.items[0];
                ret.* = ErrorableResolvedSource.err(err, switch (msg.metadata) {
                    .build => BuildMessage.create(globalThis, globalThis.allocator(), msg).asVoid(),
                    .resolve => ResolveMessage.create(
                        globalThis,
                        globalThis.allocator(),
                        msg,
                        referrer.toUTF8(bun.default_allocator).slice(),
                    ).asVoid(),
                });
                return;
            },
            else => {
                var errors_stack: [256]*anyopaque = undefined;

                const len = @min(log.msgs.items.len, errors_stack.len);
                const errors = errors_stack[0..len];
                const logs = log.msgs.items[0..len];

                for (logs, errors) |msg, *current| {
                    current.* = switch (msg.metadata) {
                        .build => BuildMessage.create(globalThis, globalThis.allocator(), msg).asVoid(),
                        .resolve => ResolveMessage.create(
                            globalThis,
                            globalThis.allocator(),
                            msg,
                            referrer.toUTF8(bun.default_allocator).slice(),
                        ).asVoid(),
                    };
                }

                ret.* = ErrorableResolvedSource.err(
                    err,
                    globalThis.createAggregateError(
                        errors.ptr,
                        @as(u16, @intCast(errors.len)),
                        &ZigString.init(
                            std.fmt.allocPrint(globalThis.allocator(), "{d} errors building \"{}\"", .{
                                errors.len,
                                specifier,
                            }) catch unreachable,
                        ),
                    ).asVoid(),
                );
            },
        }
    }

    // TODO:
    pub fn deinit(this: *VirtualMachine) void {
        this.source_mappings.deinit();
        this.has_terminated = true;
    }

    pub const ExceptionList = std.ArrayList(Api.JsException);

    pub fn printException(
        this: *VirtualMachine,
        exception: *Exception,
        exception_list: ?*ExceptionList,
        comptime Writer: type,
        writer: Writer,
        comptime allow_side_effects: bool,
    ) void {
        if (Output.enable_ansi_colors) {
            this.printErrorlikeObject(exception.value(), exception, exception_list, Writer, writer, true, allow_side_effects);
        } else {
            this.printErrorlikeObject(exception.value(), exception, exception_list, Writer, writer, false, allow_side_effects);
        }
    }

    pub fn runErrorHandlerWithDedupe(this: *VirtualMachine, result: JSValue, exception_list: ?*ExceptionList) void {
        if (this.last_reported_error_for_dedupe == result and !this.last_reported_error_for_dedupe.isEmptyOrUndefinedOrNull())
            return;

        this.runErrorHandler(result, exception_list);
    }

    pub noinline fn runErrorHandler(this: *VirtualMachine, result: JSValue, exception_list: ?*ExceptionList) void {
        @setCold(true);
        if (!result.isEmptyOrUndefinedOrNull())
            this.last_reported_error_for_dedupe = result;

        const prev_had_errors = this.had_errors;
        this.had_errors = false;
        defer this.had_errors = prev_had_errors;

        const error_writer = Output.errorWriter();
        var buffered_writer = std.io.bufferedWriter(error_writer);
        defer {
            buffered_writer.flush() catch {};
        }

        const writer = buffered_writer.writer();

        if (result.isException(this.global.vm())) {
            const exception = @as(*Exception, @ptrCast(result.asVoid()));

            this.printException(
                exception,
                exception_list,
                @TypeOf(writer),
                writer,
                true,
            );
        } else if (Output.enable_ansi_colors) {
            this.printErrorlikeObject(result, null, exception_list, @TypeOf(writer), writer, true, true);
        } else {
            this.printErrorlikeObject(result, null, exception_list, @TypeOf(writer), writer, false, true);
        }
    }

    export fn Bun__logUnhandledException(exception: JSC.JSValue) void {
        get().runErrorHandler(exception, null);
    }

    pub fn clearEntryPoint(
        this: *VirtualMachine,
    ) void {
        if (this.main.len == 0) {
            return;
        }

        var str = ZigString.init(main_file_name);
        this.global.deleteModuleRegistryEntry(&str);
    }

    fn loadPreloads(this: *VirtualMachine) !?*JSInternalPromise {
        this.is_in_preload = true;
        defer this.is_in_preload = false;

        for (this.preload) |preload| {
            var result = switch (this.bundler.resolver.resolveAndAutoInstall(
                this.bundler.fs.top_level_dir,
                normalizeSource(preload),
                .stmt,
                if (this.standalone_module_graph == null) .read_only else .disable,
            )) {
                .success => |r| r,
                .failure => |e| {
                    this.log.addErrorFmt(
                        null,
                        logger.Loc.Empty,
                        this.allocator,
                        "{s} resolving preload {}",
                        .{
                            @errorName(e),
                            js_printer.formatJSONString(preload),
                        },
                    ) catch unreachable;
                    return e;
                },
                .pending, .not_found => {
                    this.log.addErrorFmt(
                        null,
                        logger.Loc.Empty,
                        this.allocator,
                        "preload not found {}",
                        .{
                            js_printer.formatJSONString(preload),
                        },
                    ) catch unreachable;
                    return error.ModuleNotFound;
                },
            };
            var promise = JSModuleLoader.import(this.global, &String.fromBytes(result.path().?.text));

            this.pending_internal_promise = promise;
            JSValue.fromCell(promise).protect();
            defer JSValue.fromCell(promise).unprotect();

            // pending_internal_promise can change if hot module reloading is enabled
            if (this.isWatcherEnabled()) {
                this.eventLoop().performGC();
                switch (this.pending_internal_promise.status(this.global.vm())) {
                    JSC.JSPromise.Status.Pending => {
                        while (this.pending_internal_promise.status(this.global.vm()) == .Pending) {
                            this.eventLoop().tick();

                            if (this.pending_internal_promise.status(this.global.vm()) == .Pending) {
                                this.eventLoop().autoTick();
                            }
                        }
                    },
                    else => {},
                }
            } else {
                this.eventLoop().performGC();
                this.waitForPromise(JSC.AnyPromise{
                    .Internal = promise,
                });
            }

            if (promise.status(this.global.vm()) == .Rejected)
                return promise;
        }

        // only load preloads once
        this.preload.len = 0;

        return null;
    }

    pub fn reloadEntryPoint(this: *VirtualMachine, entry_path: []const u8) !*JSInternalPromise {
        this.has_loaded = false;
        this.main = entry_path;
        this.main_hash = GenericWatcher.getHash(entry_path);

        try this.entry_point.generate(
            this.allocator,
            this.bun_watcher != .none,
            entry_path,
            main_file_name,
        );
        this.eventLoop().ensureWaker();

        if (this.debugger != null) {
            try Debugger.create(this, this.global);
        }

        if (!this.bundler.options.disable_transpilation) {
            if (try this.loadPreloads()) |promise| {
                JSC.JSValue.fromCell(promise).ensureStillAlive();
                JSC.JSValue.fromCell(promise).protect();
                this.pending_internal_promise = promise;
                return promise;
            }

            const promise = JSModuleLoader.loadAndEvaluateModule(this.global, &String.init(main_file_name)) orelse return error.JSError;
            this.pending_internal_promise = promise;
            JSC.JSValue.fromCell(promise).ensureStillAlive();
            return promise;
        } else {
            const promise = JSModuleLoader.loadAndEvaluateModule(this.global, &String.init(this.main)) orelse return error.JSError;
            this.pending_internal_promise = promise;
            JSC.JSValue.fromCell(promise).ensureStillAlive();

            return promise;
        }
    }

    pub fn reloadEntryPointForTestRunner(this: *VirtualMachine, entry_path: []const u8) !*JSInternalPromise {
        this.has_loaded = false;
        this.main = entry_path;
        this.main_hash = GenericWatcher.getHash(entry_path);

        this.eventLoop().ensureWaker();

        if (this.debugger != null) {
            try Debugger.create(this, this.global);
        }

        if (!this.bundler.options.disable_transpilation) {
            if (try this.loadPreloads()) |promise| {
                JSC.JSValue.fromCell(promise).ensureStillAlive();
                this.pending_internal_promise = promise;
                JSC.JSValue.fromCell(promise).protect();

                return promise;
            }
        }

        const promise = JSModuleLoader.loadAndEvaluateModule(this.global, &String.fromBytes(this.main)) orelse return error.JSError;
        this.pending_internal_promise = promise;
        JSC.JSValue.fromCell(promise).ensureStillAlive();

        return promise;
    }

    // worker dont has bun_watcher and also we dont wanna call autoTick before dispatchOnline
    pub fn loadEntryPointForWebWorker(this: *VirtualMachine, entry_path: string) anyerror!*JSInternalPromise {
        const promise = try this.reloadEntryPoint(entry_path);
        this.eventLoop().performGC();
        this.eventLoop().waitForPromiseWithTermination(JSC.AnyPromise{
            .Internal = promise,
        });
        if (this.worker) |worker| {
            if (worker.hasRequestedTerminate()) {
                return error.WorkerTerminated;
            }
        }
        return this.pending_internal_promise;
    }

    pub fn loadEntryPointForTestRunner(this: *VirtualMachine, entry_path: string) anyerror!*JSInternalPromise {
        var promise = try this.reloadEntryPointForTestRunner(entry_path);

        // pending_internal_promise can change if hot module reloading is enabled
        if (this.isWatcherEnabled()) {
            this.eventLoop().performGC();
            switch (this.pending_internal_promise.status(this.global.vm())) {
                JSC.JSPromise.Status.Pending => {
                    while (this.pending_internal_promise.status(this.global.vm()) == .Pending) {
                        this.eventLoop().tick();

                        if (this.pending_internal_promise.status(this.global.vm()) == .Pending) {
                            this.eventLoop().autoTick();
                        }
                    }
                },
                else => {},
            }
        } else {
            if (promise.status(this.global.vm()) == .Rejected) {
                return promise;
            }

            this.eventLoop().performGC();
            this.waitForPromise(JSC.AnyPromise{
                .Internal = promise,
            });
        }

        this.eventLoop().autoTick();

        return this.pending_internal_promise;
    }

    pub fn loadEntryPoint(this: *VirtualMachine, entry_path: string) anyerror!*JSInternalPromise {
        var promise = try this.reloadEntryPoint(entry_path);

        // pending_internal_promise can change if hot module reloading is enabled
        if (this.isWatcherEnabled()) {
            this.eventLoop().performGC();
            switch (this.pending_internal_promise.status(this.global.vm())) {
                JSC.JSPromise.Status.Pending => {
                    while (this.pending_internal_promise.status(this.global.vm()) == .Pending) {
                        this.eventLoop().tick();

                        if (this.pending_internal_promise.status(this.global.vm()) == .Pending) {
                            this.eventLoop().autoTick();
                        }
                    }
                },
                else => {},
            }
        } else {
            if (promise.status(this.global.vm()) == .Rejected) {
                return promise;
            }

            this.eventLoop().performGC();
            this.waitForPromise(JSC.AnyPromise{
                .Internal = promise,
            });
        }

        return this.pending_internal_promise;
    }

    pub fn addListeningSocketForWatchMode(this: *VirtualMachine, socket: bun.FileDescriptor) void {
        if (this.hot_reload != .watch) {
            return;
        }

        this.rareData().addListeningSocketForWatchMode(socket);
    }
    pub fn removeListeningSocketForWatchMode(this: *VirtualMachine, socket: bun.FileDescriptor) void {
        if (this.hot_reload != .watch) {
            return;
        }

        this.rareData().removeListeningSocketForWatchMode(socket);
    }

    pub fn loadMacroEntryPoint(this: *VirtualMachine, entry_path: string, function_name: string, specifier: string, hash: i32) !*JSInternalPromise {
        const entry_point_entry = try this.macro_entry_points.getOrPut(hash);

        if (!entry_point_entry.found_existing) {
            var macro_entry_pointer: *MacroEntryPoint = this.allocator.create(MacroEntryPoint) catch unreachable;
            entry_point_entry.value_ptr.* = macro_entry_pointer;
            try macro_entry_pointer.generate(&this.bundler, Fs.PathName.init(entry_path), function_name, hash, specifier);
        }
        const entry_point = entry_point_entry.value_ptr.*;

        var loader = MacroEntryPointLoader{
            .path = entry_point.source.path.text,
        };

        this.runWithAPILock(MacroEntryPointLoader, &loader, MacroEntryPointLoader.load);
        return loader.promise orelse return error.JSError;
    }

    /// A subtlelty of JavaScriptCore:
    /// JavaScriptCore has many release asserts that check an API lock is currently held
    /// We cannot hold it from Zig code because it relies on C++ ARIA to automatically release the lock
    /// and it is not safe to copy the lock itself
    /// So we have to wrap entry points to & from JavaScript with an API lock that calls out to C++
    pub inline fn runWithAPILock(this: *VirtualMachine, comptime Context: type, ctx: *Context, comptime function: fn (ctx: *Context) void) void {
        this.global.vm().holdAPILock(ctx, OpaqueWrap(Context, function));
    }

    const MacroEntryPointLoader = struct {
        path: string,
        promise: ?*JSInternalPromise = null,
        pub fn load(this: *MacroEntryPointLoader) void {
            this.promise = VirtualMachine.get()._loadMacroEntryPoint(this.path);
        }
    };

    pub inline fn _loadMacroEntryPoint(this: *VirtualMachine, entry_path: string) ?*JSInternalPromise {
        var promise: *JSInternalPromise = undefined;

        promise = JSModuleLoader.loadAndEvaluateModule(this.global, &String.init(entry_path)) orelse return null;
        this.waitForPromise(JSC.AnyPromise{
            .Internal = promise,
        });

        return promise;
    }

    // When the Error-like object is one of our own, it's best to rely on the object directly instead of serializing it to a ZigException.
    // This is for:
    // - BuildMessage
    // - ResolveMessage
    // If there were multiple errors, it could be contained in an AggregateError.
    // In that case, this function becomes recursive.
    // In all other cases, we will convert it to a ZigException.
    pub fn printErrorlikeObject(
        this: *VirtualMachine,
        value: JSValue,
        exception: ?*Exception,
        exception_list: ?*ExceptionList,
        comptime Writer: type,
        writer: Writer,
        comptime allow_ansi_color: bool,
        comptime allow_side_effects: bool,
    ) void {
        if (comptime JSC.is_bindgen) {
            return;
        }

        var was_internal = false;

        defer {
            if (was_internal) {
                if (exception) |exception_| {
                    var holder = ZigException.Holder.init();
                    var zig_exception: *ZigException = holder.zigException();
                    holder.deinit(this);
                    exception_.getStackTrace(&zig_exception.stack);
                    if (zig_exception.stack.frames_len > 0) {
                        if (allow_ansi_color) {
                            printStackTrace(Writer, writer, zig_exception.stack, true) catch {};
                        } else {
                            printStackTrace(Writer, writer, zig_exception.stack, false) catch {};
                        }
                    }

                    if (exception_list) |list| {
                        zig_exception.addToErrorList(list, this.bundler.fs.top_level_dir, &this.origin) catch {};
                    }
                }
            }
        }

        if (value.isAggregateError(this.global)) {
            const AggregateErrorIterator = struct {
                writer: Writer,
                current_exception_list: ?*ExceptionList = null,

                pub fn iteratorWithColor(_vm: [*c]VM, globalObject: [*c]JSGlobalObject, ctx: ?*anyopaque, nextValue: JSValue) callconv(.C) void {
                    iterator(_vm, globalObject, nextValue, ctx.?, true);
                }
                pub fn iteratorWithOutColor(_vm: [*c]VM, globalObject: [*c]JSGlobalObject, ctx: ?*anyopaque, nextValue: JSValue) callconv(.C) void {
                    iterator(_vm, globalObject, nextValue, ctx.?, false);
                }
                inline fn iterator(_: [*c]VM, _: [*c]JSGlobalObject, nextValue: JSValue, ctx: ?*anyopaque, comptime color: bool) void {
                    const this_ = @as(*@This(), @ptrFromInt(@intFromPtr(ctx)));
                    VirtualMachine.get().printErrorlikeObject(nextValue, null, this_.current_exception_list, Writer, this_.writer, color, allow_side_effects);
                }
            };
            var iter = AggregateErrorIterator{ .writer = writer, .current_exception_list = exception_list };
            if (comptime allow_ansi_color) {
                value.getErrorsProperty(this.global).forEach(this.global, &iter, AggregateErrorIterator.iteratorWithColor);
            } else {
                value.getErrorsProperty(this.global).forEach(this.global, &iter, AggregateErrorIterator.iteratorWithOutColor);
            }
            return;
        }

        was_internal = this.printErrorFromMaybePrivateData(
            value,
            exception_list,
            Writer,
            writer,
            allow_ansi_color,
            allow_side_effects,
        );
    }

    pub fn printErrorFromMaybePrivateData(
        this: *VirtualMachine,
        value: JSC.JSValue,
        exception_list: ?*ExceptionList,
        comptime Writer: type,
        writer: Writer,
        comptime allow_ansi_color: bool,
        comptime allow_side_effects: bool,
    ) bool {
        if (value.jsType() == .DOMWrapper) {
            if (value.as(JSC.BuildMessage)) |build_error| {
                defer Output.flush();
                if (!build_error.logged) {
                    if (this.had_errors) {
                        writer.writeAll("\n") catch {};
                    }
                    build_error.msg.writeFormat(writer, allow_ansi_color) catch {};
                    build_error.logged = true;
                    writer.writeAll("\n") catch {};
                }
                this.had_errors = this.had_errors or build_error.msg.kind == .err;
                if (exception_list != null) {
                    this.log.addMsg(
                        build_error.msg,
                    ) catch {};
                }
                return true;
            } else if (value.as(JSC.ResolveMessage)) |resolve_error| {
                defer Output.flush();
                if (!resolve_error.logged) {
                    if (this.had_errors) {
                        writer.writeAll("\n") catch {};
                    }
                    resolve_error.msg.writeFormat(writer, allow_ansi_color) catch {};
                    resolve_error.logged = true;
                    writer.writeAll("\n") catch {};
                }

                this.had_errors = this.had_errors or resolve_error.msg.kind == .err;

                if (exception_list != null) {
                    this.log.addMsg(
                        resolve_error.msg,
                    ) catch {};
                }
                return true;
            }
        }

        this.printErrorInstance(
            value,
            exception_list,
            Writer,
            writer,
            allow_ansi_color,
            allow_side_effects,
        ) catch |err| {
            if (comptime Environment.isDebug) {
                // yo dawg
                Output.printErrorln("Error while printing Error-like object: {s}", .{@errorName(err)});
                Output.flush();
            }
        };

        return false;
    }

    pub fn reportUncaughtException(globalObject: *JSGlobalObject, exception: *JSC.Exception) JSValue {
        var jsc_vm = globalObject.bunVM();
        _ = jsc_vm.uncaughtException(globalObject, exception.value(), false);
        return JSC.JSValue.jsUndefined();
    }

    pub fn printStackTrace(comptime Writer: type, writer: Writer, trace: ZigStackTrace, comptime allow_ansi_colors: bool) !void {
        const stack = trace.frames();
        if (stack.len > 0) {
            var vm = VirtualMachine.get();
            const origin: ?*const URL = if (vm.is_from_devserver) &vm.origin else null;
            const dir = vm.bundler.fs.top_level_dir;

            for (stack) |frame| {
                const file_slice = frame.source_url.toUTF8(bun.default_allocator);
                defer file_slice.deinit();
                const func_slice = frame.function_name.toUTF8(bun.default_allocator);
                defer func_slice.deinit();

                const file = file_slice.slice();
                const func = func_slice.slice();

                if (file.len == 0 and func.len == 0) continue;

                const has_name = std.fmt.count("{}", .{frame.nameFormatter(false)}) > 0;

                if (has_name) {
                    try writer.print(
                        comptime Output.prettyFmt(
                            "<r>      <d>at <r>{}<d> (<r>{}<d>)<r>\n",
                            allow_ansi_colors,
                        ),
                        .{
                            frame.nameFormatter(
                                allow_ansi_colors,
                            ),
                            frame.sourceURLFormatter(
                                dir,
                                origin,
                                false,
                                allow_ansi_colors,
                            ),
                        },
                    );
                } else {
                    try writer.print(
                        comptime Output.prettyFmt(
                            "<r>      <d>at <r>{}\n",
                            allow_ansi_colors,
                        ),
                        .{
                            frame.sourceURLFormatter(
                                dir,
                                origin,
                                false,
                                allow_ansi_colors,
                            ),
                        },
                    );
                }
            }
        }
    }

    pub export fn Bun__remapStackFramePositions(globalObject: *JSC.JSGlobalObject, frames: [*]JSC.ZigStackFrame, frames_count: usize) void {
        globalObject.bunVM().remapStackFramePositions(frames, frames_count);
    }

    pub fn remapStackFramePositions(this: *VirtualMachine, frames: [*]JSC.ZigStackFrame, frames_count: usize) void {
        for (frames[0..frames_count]) |*frame| {
            if (frame.position.isInvalid() or frame.remapped) continue;
            var sourceURL = frame.source_url.toUTF8(bun.default_allocator);
            defer sourceURL.deinit();

            if (this.source_mappings.resolveMapping(
                sourceURL.slice(),
                @max(frame.position.line.zeroBased(), 0),
                @max(frame.position.column.zeroBased(), 0),
                .no_source_contents,
            )) |lookup| {
                const source_map = lookup.source_map;
                defer if (source_map) |map| map.deref();
                if (lookup.displaySourceURLIfNeeded(sourceURL.slice())) |source_url| {
                    frame.source_url.deref();
                    frame.source_url = source_url;
                }
                const mapping = lookup.mapping;
                frame.position.line = Ordinal.fromZeroBased(mapping.original.lines);
                frame.position.column = Ordinal.fromZeroBased(mapping.original.columns);
                frame.remapped = true;
            } else {
                // we don't want it to be remapped again
                frame.remapped = true;
            }
        }
    }

    pub fn remapZigException(
        this: *VirtualMachine,
        exception: *ZigException,
        error_instance: JSValue,
        exception_list: ?*ExceptionList,
        must_reset_parser_arena_later: *bool,
        source_code_slice: *?ZigString.Slice,
    ) void {
        error_instance.toZigException(this.global, exception);

        // defer this so that it copies correctly
        defer {
            if (exception_list) |list| {
                exception.addToErrorList(list, this.bundler.fs.top_level_dir, &this.origin) catch unreachable;
            }
        }

        const NoisyBuiltinFunctionMap = bun.ComptimeStringMap(void, .{
            .{"asyncModuleEvaluation"},
            .{"link"},
            .{"linkAndEvaluateModule"},
            .{"moduleEvaluation"},
            .{"processTicksAndRejections"},
        });

        var frames: []JSC.ZigStackFrame = exception.stack.frames_ptr[0..exception.stack.frames_len];
        if (this.hide_bun_stackframes) {
            var start_index: ?usize = null;
            for (frames, 0..) |frame, i| {
                if (frame.source_url.eqlComptime("bun:wrap") or
                    frame.function_name.eqlComptime("::bunternal::"))
                {
                    start_index = i;
                    break;
                }

                // Workaround for being unable to hide that specific frame without also hiding the frame before it
                if (frame.source_url.isEmpty() and NoisyBuiltinFunctionMap.getWithEql(frame.function_name, String.eqlComptime) != null) {
                    start_index = 0;
                    break;
                }
            }

            if (start_index) |k| {
                var j = k;
                for (frames[k..]) |frame| {
                    if (frame.source_url.eqlComptime("bun:wrap") or
                        frame.function_name.eqlComptime("::bunternal::"))
                    {
                        continue;
                    }

                    // Workaround for being unable to hide that specific frame without also hiding the frame before it
                    if (frame.source_url.isEmpty() and NoisyBuiltinFunctionMap.getWithEql(frame.function_name, String.eqlComptime) != null) {
                        continue;
                    }

                    frames[j] = frame;
                    j += 1;
                }
                exception.stack.frames_len = @as(u8, @truncate(j));
                frames.len = j;
            }
        }

        if (frames.len == 0) return;

        var top = &frames[0];
        if (this.hide_bun_stackframes) {
            for (frames) |*frame| {
                if (frame.source_url.hasPrefixComptime("bun:") or
                    frame.source_url.hasPrefixComptime("node:") or
                    frame.source_url.isEmpty() or
                    frame.source_url.eqlComptime("native"))
                {
                    continue;
                }

                top = frame;
                break;
            }
        }

        var top_source_url = top.source_url.toUTF8(bun.default_allocator);
        defer top_source_url.deinit();

        const maybe_lookup = if (top.remapped)
            SourceMap.Mapping.Lookup{
                .mapping = .{
                    .generated = .{},
                    .original = .{
                        .lines = @max(top.position.line.zeroBased(), 0),
                        .columns = @max(top.position.column.zeroBased(), 0),
                    },
                    .source_index = 0,
                },
                .source_map = null,
                .prefetched_source_code = null,
            }
        else
            this.source_mappings.resolveMapping(
                top_source_url.slice(),
                @max(top.position.line.zeroBased(), 0),
                @max(top.position.column.zeroBased(), 0),
                .source_contents,
            );

        if (maybe_lookup) |lookup| {
            const mapping = lookup.mapping;
            const source_map = lookup.source_map;
            defer if (source_map) |map| map.deref();

            if (!top.remapped) {
                if (lookup.displaySourceURLIfNeeded(top_source_url.slice())) |src| {
                    top.source_url.deref();
                    top.source_url = src;
                }
            }

            const code = code: {
                if (!top.remapped and lookup.source_map != null and lookup.source_map.?.isExternal()) {
                    if (lookup.getSourceCode(top_source_url.slice())) |src| {
                        break :code src;
                    }
                }

                var log = logger.Log.init(bun.default_allocator);
                defer log.deinit();
                var original_source = fetchWithoutOnLoadPlugins(this, this.global, top.source_url, bun.String.empty, &log, .print_source) catch return;
                must_reset_parser_arena_later.* = true;
                break :code original_source.source_code.toUTF8(bun.default_allocator);
            };
            source_code_slice.* = code;

            top.position.line = Ordinal.fromZeroBased(mapping.original.lines);
            top.position.column = Ordinal.fromZeroBased(mapping.original.columns);

            exception.remapped = true;
            top.remapped = true;

            const last_line = @max(top.position.line.zeroBased(), 0);
            if (strings.getLinesInText(
                code.slice(),
                @intCast(last_line),
                JSC.ZigException.Holder.source_lines_count,
            )) |lines_buf| {
                var lines = lines_buf.slice();
                var source_lines = exception.stack.source_lines_ptr[0..JSC.ZigException.Holder.source_lines_count];
                var source_line_numbers = exception.stack.source_lines_numbers[0..JSC.ZigException.Holder.source_lines_count];
                @memset(source_lines, String.empty);
                @memset(source_line_numbers, 0);

                lines = lines[0..@min(@as(usize, lines.len), source_lines.len)];
                var current_line_number: i32 = @intCast(last_line);
                for (lines, source_lines[0..lines.len], source_line_numbers[0..lines.len]) |line, *line_dest, *line_number| {
                    // To minimize duplicate allocations, we use the same slice as above
                    // it should virtually always be UTF-8 and thus not cloned
                    line_dest.* = String.init(line);
                    line_number.* = current_line_number;
                    current_line_number -= 1;
                }

                exception.stack.source_lines_len = @as(u8, @truncate(lines.len));
            }
        }

        if (frames.len > 1) {
            for (frames) |*frame| {
                if (frame == top or frame.position.isInvalid()) continue;
                const source_url = frame.source_url.toUTF8(bun.default_allocator);
                defer source_url.deinit();
                if (this.source_mappings.resolveMapping(
                    source_url.slice(),
                    @max(frame.position.line.zeroBased(), 0),
                    @max(frame.position.column.zeroBased(), 0),
                    .no_source_contents,
                )) |lookup| {
                    defer if (lookup.source_map) |map| map.deref();
                    if (lookup.displaySourceURLIfNeeded(source_url.slice())) |src| {
                        frame.source_url.deref();
                        frame.source_url = src;
                    }
                    const mapping = lookup.mapping;
                    frame.remapped = true;
                    frame.position.line = Ordinal.fromZeroBased(mapping.original.lines);
                    frame.position.column = Ordinal.fromZeroBased(mapping.original.columns);
                }
            }
        }
    }

    pub fn printErrorInstance(this: *VirtualMachine, error_instance: JSValue, exception_list: ?*ExceptionList, comptime Writer: type, writer: Writer, comptime allow_ansi_color: bool, comptime allow_side_effects: bool) anyerror!void {
        var exception_holder = ZigException.Holder.init();
        var exception = exception_holder.zigException();
        defer exception_holder.deinit(this);

        var source_code_slice: ?ZigString.Slice = null;
        defer if (source_code_slice) |slice| slice.deinit();

        this.remapZigException(
            exception,
            error_instance,
            exception_list,
            &exception_holder.need_to_clear_parser_arena_on_deinit,
            &source_code_slice,
        );
        const prev_had_errors = this.had_errors;
        this.had_errors = true;
        defer this.had_errors = prev_had_errors;

        if (allow_side_effects and Output.is_github_action) {
            defer printGithubAnnotation(exception);
        }

        // This is a longer number than necessary because we don't handle this case very well
        // At the very least, we shouldn't dump 100 KB of minified code into your terminal.
        const max_line_length_with_divot = 512;
        const max_line_length = 1024;

        const line_numbers = exception.stack.source_lines_numbers[0..exception.stack.source_lines_len];
        var max_line: i32 = -1;
        for (line_numbers) |line| max_line = @max(max_line, line);
        const max_line_number_pad = std.fmt.count("{d}", .{max_line + 1});

        var source_lines = exception.stack.sourceLineIterator();
        var last_pad: u64 = 0;
        while (source_lines.untilLast()) |source| {
            defer source.text.deinit();
            const display_line = source.line + 1;

            const int_size = std.fmt.count("{d}", .{display_line});
            const pad = max_line_number_pad - int_size;
            last_pad = pad;
            try writer.writeByteNTimes(' ', pad);

            const trimmed = std.mem.trimRight(u8, std.mem.trim(u8, source.text.slice(), "\n"), "\t ");
            const clamped = trimmed[0..@min(trimmed.len, max_line_length)];

            if (clamped.len != trimmed.len) {
                const fmt = if (comptime allow_ansi_color) "<r><d> | ... truncated <r>\n" else "\n";
                try writer.print(
                    comptime Output.prettyFmt(
                        "<r><b>{d} |<r> {}" ++ fmt,
                        allow_ansi_color,
                    ),
                    .{ display_line, bun.fmt.fmtJavaScript(clamped, allow_ansi_color) },
                );
            } else {
                try writer.print(
                    comptime Output.prettyFmt(
                        "<r><b>{d} |<r> {}\n",
                        allow_ansi_color,
                    ),
                    .{ display_line, bun.fmt.fmtJavaScript(clamped, allow_ansi_color) },
                );
            }
        }

        const name = exception.name;

        const message = exception.message;

        var did_print_name = false;
        if (source_lines.next()) |source| brk: {
            if (source.text.len == 0) break :brk;

            var top_frame = if (exception.stack.frames_len > 0) &exception.stack.frames()[0] else null;

            if (this.hide_bun_stackframes) {
                for (exception.stack.frames()) |*frame| {
                    if (frame.position.isInvalid() or frame.source_url.hasPrefixComptime("bun:") or frame.source_url.hasPrefixComptime("node:")) continue;
                    top_frame = frame;
                    break;
                }
            }

            if (top_frame == null or top_frame.?.position.isInvalid()) {
                defer did_print_name = true;
                defer source.text.deinit();
                const trimmed = std.mem.trimRight(u8, std.mem.trim(u8, source.text.slice(), "\n"), "\t ");

                const text = trimmed[0..@min(trimmed.len, max_line_length)];

                if (text.len != trimmed.len) {
                    const fmt = if (comptime allow_ansi_color) "<r><d> | ... truncated <r>\n" else "\n";
                    try writer.print(
                        comptime Output.prettyFmt(
                            "<r><b>- |<r> {}" ++ fmt,
                            allow_ansi_color,
                        ),
                        .{bun.fmt.fmtJavaScript(text, allow_ansi_color)},
                    );
                } else {
                    try writer.print(
                        comptime Output.prettyFmt(
                            "<r><d>- |<r> {}\n",
                            allow_ansi_color,
                        ),
                        .{bun.fmt.fmtJavaScript(text, allow_ansi_color)},
                    );
                }

                try this.printErrorNameAndMessage(name, message, Writer, writer, allow_ansi_color);
            } else if (top_frame) |top| {
                defer did_print_name = true;
                const display_line = source.line + 1;
                const int_size = std.fmt.count("{d}", .{display_line});
                const pad = max_line_number_pad - int_size;
                try writer.writeByteNTimes(' ', pad);
                defer source.text.deinit();
                const text = source.text.slice();
                const trimmed = std.mem.trimRight(u8, std.mem.trim(u8, text, "\n"), "\t ");

                // TODO: preserve the divot position and possibly use stringWidth() to figure out where to put the divot
                const clamped = trimmed[0..@min(trimmed.len, max_line_length)];

                if (clamped.len != trimmed.len) {
                    const fmt = if (comptime allow_ansi_color) "<r><d> | ... truncated <r>\n\n" else "\n\n";
                    try writer.print(
                        comptime Output.prettyFmt(
                            "<r><b>{d} |<r> {}" ++ fmt,
                            allow_ansi_color,
                        ),
                        .{ display_line, bun.fmt.fmtJavaScript(clamped, allow_ansi_color) },
                    );
                } else {
                    try writer.print(
                        comptime Output.prettyFmt(
                            "<r><b>{d} |<r> {}\n",
                            allow_ansi_color,
                        ),
                        .{ display_line, bun.fmt.fmtJavaScript(clamped, allow_ansi_color) },
                    );

                    if (clamped.len < max_line_length_with_divot or top.position.column.zeroBased() > max_line_length_with_divot) {
                        const indent = max_line_number_pad + " | ".len + @as(u64, @intCast(top.position.column.zeroBased()));

                        try writer.writeByteNTimes(' ', indent);
                        try writer.print(comptime Output.prettyFmt(
                            "<red><b>^<r>\n",
                            allow_ansi_color,
                        ), .{});
                    } else {
                        try writer.writeAll("\n");
                    }
                }

                try this.printErrorNameAndMessage(name, message, Writer, writer, allow_ansi_color);
            }
        }

        if (!did_print_name) {
            try this.printErrorNameAndMessage(name, message, Writer, writer, allow_ansi_color);
        }

        var add_extra_line = false;

        const Show = struct {
            system_code: bool = false,
            syscall: bool = false,
            errno: bool = false,
            path: bool = false,
            fd: bool = false,
        };

        const show = Show{
            .system_code = !exception.system_code.eql(name) and !exception.system_code.isEmpty(),
            .syscall = !exception.syscall.isEmpty(),
            .errno = exception.errno != 0,
            .path = !exception.path.isEmpty(),
            .fd = exception.fd != -1,
        };

        const extra_fields = .{
            "url",
            "info",
            "pkg",
            "errors",
            "cause",
        };

        // This is usually unsafe to do, but we are protecting them each time first
        var errors_to_append = std.ArrayList(JSC.JSValue).init(this.allocator);
        defer {
            for (errors_to_append.items) |err| {
                err.unprotect();
            }
            errors_to_append.deinit();
        }

        if (error_instance != .zero and error_instance.isCell() and error_instance.jsType().canGet()) {
            inline for (extra_fields) |field| {
                if (error_instance.getTruthyComptime(this.global, field)) |value| {
                    const kind = value.jsType();
                    if (kind.isStringLike()) {
                        if (value.toStringOrNull(this.global)) |str| {
                            var zig_str = str.toSlice(this.global, bun.default_allocator);
                            defer zig_str.deinit();
                            try writer.print(comptime Output.prettyFmt(" {s}<d>: <r>\"{s}\"<r>\n", allow_ansi_color), .{ field, zig_str.slice() });
                            add_extra_line = true;
                        }
                    } else if (kind == .ErrorInstance and
                        // avoid infinite recursion
                        !prev_had_errors)
                    {
                        value.protect();
                        try errors_to_append.append(value);
                    } else if (kind.isObject() or kind.isArray()) {
                        var bun_str = bun.String.empty;
                        defer bun_str.deref();
                        value.jsonStringify(this.global, 2, &bun_str); //2
                        try writer.print(comptime Output.prettyFmt(" {s}<d>: <r>{}<r>\n", allow_ansi_color), .{ field, bun_str });
                        add_extra_line = true;
                    }
                }
            }
        }

        if (show.errno) {
            if (show.syscall) {
                try writer.writeAll("  ");
            }
            try writer.print(comptime Output.prettyFmt(" errno<d>: <r><yellow>{d}<r>\n", allow_ansi_color), .{exception.errno});
            add_extra_line = true;
        }

        if (show.system_code) {
            if (show.syscall) {
                try writer.writeAll("  ");
            } else if (show.errno) {
                try writer.writeAll(" ");
            }
            try writer.print(comptime Output.prettyFmt(" code<d>: <r><cyan>\"{}\"<r>\n", allow_ansi_color), .{exception.system_code});
            add_extra_line = true;
        }

        if (show.syscall) {
            try writer.print(comptime Output.prettyFmt(" syscall<d>: <r><cyan>\"{}\"<r>\n", allow_ansi_color), .{exception.syscall});
            add_extra_line = true;
        }

        if (show.path) {
            if (show.syscall) {
                try writer.writeAll("  ");
            } else if (show.errno) {
                try writer.writeAll(" ");
            }
            try writer.print(comptime Output.prettyFmt(" path<d>: <r><cyan>\"{}\"<r>\n", allow_ansi_color), .{exception.path});
        }

        if (show.fd) {
            if (show.syscall) {
                try writer.writeAll("     ");
            } else if (show.errno) {
                try writer.writeAll("  ");
            }
            try writer.print(comptime Output.prettyFmt(" fd<d>: <r><yellow>{d}<r>\n", allow_ansi_color), .{exception.fd});
        }

        if (add_extra_line) try writer.writeAll("\n");

        try printStackTrace(@TypeOf(writer), writer, exception.stack, allow_ansi_color);

        for (errors_to_append.items) |err| {
            try writer.writeAll("\n");
            try this.printErrorInstance(err, exception_list, Writer, writer, allow_ansi_color, allow_side_effects);
        }
    }

    fn printErrorNameAndMessage(_: *VirtualMachine, name: String, message: String, comptime Writer: type, writer: Writer, comptime allow_ansi_color: bool) !void {
        if (!name.isEmpty() and !message.isEmpty()) {
            const display_name: String = if (name.eqlComptime("Error")) String.init("error") else name;

            try writer.print(comptime Output.prettyFmt("<r><red>{}<r><d>:<r> <b>{s}<r>\n", allow_ansi_color), .{
                display_name,
                message,
            });
        } else if (!name.isEmpty()) {
            if (!name.hasPrefixComptime("error")) {
                try writer.print(comptime Output.prettyFmt("<r><red>error<r><d>:<r> <b>{}<r>\n", allow_ansi_color), .{name});
            } else {
                try writer.print(comptime Output.prettyFmt("<r><red>{}<r>\n", allow_ansi_color), .{name});
            }
        } else if (!message.isEmpty()) {
            try writer.print(comptime Output.prettyFmt("<r><red>error<r><d>:<r> <b>{}<r>\n", allow_ansi_color), .{message});
        } else {
            try writer.print(comptime Output.prettyFmt("<r><red>error<r>\n", allow_ansi_color), .{});
        }
    }

    // In Github Actions, emit an annotation that renders the error and location.
    // https://docs.github.com/en/actions/using-workflows/workflow-commands-for-github-actions#setting-an-error-message
    pub noinline fn printGithubAnnotation(exception: *JSC.ZigException) void {
        @setCold(true);
        const name = exception.name;
        const message = exception.message;
        const frames = exception.stack.frames();
        const top_frame = if (frames.len > 0) frames[0] else null;
        const dir = bun.getenvZ("GITHUB_WORKSPACE") orelse bun.fs.FileSystem.instance.top_level_dir;
        const allocator = bun.default_allocator;
        Output.flush();

        var buffered_writer = std.io.bufferedWriter(Output.errorWriter());
        var writer = buffered_writer.writer();
        defer {
            buffered_writer.flush() catch {};
        }

        var has_location = false;

        if (top_frame) |frame| {
            if (!frame.position.isInvalid()) {
                const source_url = frame.source_url.toUTF8(allocator);
                defer source_url.deinit();
                const file = bun.path.relative(dir, source_url.slice());
                writer.print("\n::error file={s},line={d},col={d},title=", .{
                    file,
                    frame.position.line.oneBased(),
                    frame.position.column.oneBased(),
                }) catch {};
                has_location = true;
            }
        }

        if (!has_location) {
            writer.print("\n::error title=", .{}) catch {};
        }

        if (name.isEmpty() or name.eqlComptime("Error")) {
            writer.print("error", .{}) catch {};
        } else {
            writer.print("{s}", .{name.githubAction()}) catch {};
        }

        if (!message.isEmpty()) {
            const message_slice = message.toUTF8(allocator);
            defer message_slice.deinit();
            const msg = message_slice.slice();

            var cursor: u32 = 0;
            while (strings.indexOfNewlineOrNonASCIIOrANSI(msg, cursor)) |i| {
                cursor = i + 1;
                if (msg[i] == '\n') {
                    const first_line = bun.String.fromUTF8(msg[0..i]);
                    writer.print(": {s}::", .{first_line.githubAction()}) catch {};
                    break;
                }
            } else {
                writer.print(": {s}::", .{message.githubAction()}) catch {};
            }

            while (strings.indexOfNewlineOrNonASCIIOrANSI(msg, cursor)) |i| {
                cursor = i + 1;
                if (msg[i] == '\n') {
                    break;
                }
            }

            if (cursor > 0) {
                const body = ZigString.initUTF8(msg[cursor..]);
                writer.print("{s}", .{body.githubAction()}) catch {};
            }
        } else {
            writer.print("::", .{}) catch {};
        }

        // TODO: cleanup and refactor to use printStackTrace()
        if (top_frame) |_| {
            const vm = VirtualMachine.get();
            const origin = if (vm.is_from_devserver) &vm.origin else null;

            var i: i16 = 0;
            while (i < frames.len) : (i += 1) {
                const frame = frames[@as(usize, @intCast(i))];
                const source_url = frame.source_url.toUTF8(allocator);
                defer source_url.deinit();
                const file = bun.path.relative(dir, source_url.slice());
                const func = frame.function_name.toUTF8(allocator);

                if (file.len == 0 and func.len == 0) continue;

                const has_name = std.fmt.count("{any}", .{frame.nameFormatter(
                    false,
                )}) > 0;

                // %0A = escaped newline
                if (has_name) {
                    writer.print(
                        "%0A      at {any} ({any})",
                        .{
                            frame.nameFormatter(false),
                            frame.sourceURLFormatter(
                                file,
                                origin,
                                false,
                                false,
                            ),
                        },
                    ) catch {};
                } else {
                    writer.print(
                        "%0A      at {any}",
                        .{
                            frame.sourceURLFormatter(
                                file,
                                origin,
                                false,
                                false,
                            ),
                        },
                    ) catch {};
                }
            }
        }

        writer.print("\n", .{}) catch {};
    }

    extern fn Process__emitMessageEvent(global: *JSGlobalObject, value: JSValue) void;
    extern fn Process__emitDisconnectEvent(global: *JSGlobalObject) void;

    pub const IPCInstanceUnion = union(enum) {
        /// IPC is put in this "enabled but not started" state when IPC is detected
        /// but the client JavaScript has not yet done `.on("message")`
        waiting: struct {
            info: IPCInfoType,
            mode: IPC.Mode,
        },
        initialized: *IPCInstance,
    };

    pub const IPCInstance = struct {
        globalThis: ?*JSGlobalObject,
        context: if (Environment.isPosix) *uws.SocketContext else u0,
        data: IPC.IPCData,

        pub usingnamespace bun.New(@This());

        pub fn ipc(this: *IPCInstance) *IPC.IPCData {
            return &this.data;
        }

        pub fn handleIPCMessage(
            this: *IPCInstance,
            message: IPC.DecodedIPCMessage,
        ) void {
            JSC.markBinding(@src());
            switch (message) {
                // In future versions we can read this in order to detect version mismatches,
                // or disable future optimizations if the subprocess is old.
                .version => |v| {
                    IPC.log("Parent IPC version is {d}", .{v});
                },
                .data => |data| {
                    IPC.log("Received IPC message from parent", .{});
                    if (this.globalThis) |global| {
                        Process__emitMessageEvent(global, data);
                    }
                },
            }
        }

        pub fn handleIPCClose(this: *IPCInstance) void {
            if (this.globalThis) |global| {
                var vm = global.bunVM();
                vm.ipc = null;
                Process__emitDisconnectEvent(global);
            }
            if (Environment.isPosix) {
                uws.us_socket_context_free(0, this.context);
            }
            this.destroy();
        }

        pub const Handlers = IPC.NewIPCHandler(IPCInstance);
    };

    const IPCInfoType = if (Environment.isWindows) []const u8 else bun.FileDescriptor;
    pub fn initIPCInstance(this: *VirtualMachine, info: IPCInfoType, mode: IPC.Mode) void {
        IPC.log("initIPCInstance {" ++ (if (Environment.isWindows) "s" else "") ++ "}", .{info});
        this.ipc = .{
            .waiting = .{ .info = info, .mode = mode },
        };
    }

    pub fn getIPCInstance(this: *VirtualMachine) ?*IPCInstance {
        if (this.ipc == null) return null;
        if (this.ipc.? != .waiting) return this.ipc.?.initialized;
        const opts = this.ipc.?.waiting;

        IPC.log("getIPCInstance {" ++ (if (Environment.isWindows) "s" else "") ++ "}", .{opts.info});

        this.event_loop.ensureWaker();

        const instance = switch (Environment.os) {
            else => instance: {
                const context = uws.us_create_socket_context(0, this.event_loop_handle.?, @sizeOf(usize), .{}).?;
                IPC.Socket.configure(context, true, *IPCInstance, IPCInstance.Handlers);

                var instance = IPCInstance.new(.{
                    .globalThis = this.global,
                    .context = context,
                    .data = undefined,
                });

                const socket = IPC.Socket.fromFd(context, opts.info, IPCInstance, instance, null) orelse {
                    instance.destroy();
                    this.ipc = null;
                    Output.warn("Unable to start IPC socket", .{});
                    return null;
                };
                socket.setTimeout(0);

                instance.data = .{ .socket = socket, .mode = opts.mode };

                break :instance instance;
            },
            .windows => instance: {
                var instance = IPCInstance.new(.{
                    .globalThis = this.global,
                    .context = 0,
                    .data = .{ .mode = opts.mode },
                });

                instance.data.configureClient(IPCInstance, instance, opts.info) catch {
                    instance.destroy();
                    this.ipc = null;
                    Output.warn("Unable to start IPC pipe '{s}'", .{opts.info});
                    return null;
                };

                break :instance instance;
            },
        };

        this.ipc = .{ .initialized = instance };

        instance.data.writeVersionPacket();

        return instance;
    }

    comptime {
        if (!JSC.is_bindgen)
            _ = Bun__remapStackFramePositions;
    }
};

pub const HotReloader = NewHotReloader(VirtualMachine, JSC.EventLoop, false);
pub const WatchReloader = NewHotReloader(VirtualMachine, JSC.EventLoop, true);
pub const Watcher = HotReloader.Watcher;
extern fn BunDebugger__willHotReload() void;

pub fn NewHotReloader(comptime Ctx: type, comptime EventLoopType: type, comptime reload_immediately: bool) type {
    return struct {
        pub const Watcher = GenericWatcher.NewWatcher(*@This());
        const Reloader = @This();

        onAccept: std.ArrayHashMapUnmanaged(GenericWatcher.HashType, bun.BabyList(OnAcceptCallback), bun.ArrayIdentityContext, false) = .{},
        ctx: *Ctx,
        verbose: bool = false,
        pending_count: std.atomic.Value(u32) = std.atomic.Value(u32).init(0),

        tombstones: bun.StringHashMapUnmanaged(*bun.fs.FileSystem.RealFS.EntriesOption) = .{},

        pub fn eventLoop(this: @This()) *EventLoopType {
            return this.ctx.eventLoop();
        }

        pub fn enqueueTaskConcurrent(this: @This(), task: *JSC.ConcurrentTask) void {
            if (comptime reload_immediately)
                unreachable;

            this.eventLoop().enqueueTaskConcurrent(task);
        }

        pub var clear_screen = false;

        pub const HotReloadTask = struct {
            reloader: *Reloader,
            count: u8 = 0,
            hashes: [8]u32 = [_]u32{0} ** 8,
            concurrent_task: JSC.ConcurrentTask = undefined,

            pub fn append(this: *HotReloadTask, id: u32) void {
                if (this.count == 8) {
                    this.enqueue();
                    const reloader = this.reloader;
                    this.* = .{
                        .reloader = reloader,
                        .count = 0,
                    };
                }

                this.hashes[this.count] = id;
                this.count += 1;
            }

            pub fn run(this: *HotReloadTask) void {
                // Since we rely on the event loop for hot reloads, there can be
                // a delay before the next reload begins. In the time between the
                // last reload and the next one, we shouldn't schedule any more
                // hot reloads. Since we reload literally everything, we don't
                // need to worry about missing any changes.
                //
                // Note that we set the count _before_ we reload, so that if we
                // get another hot reload request while we're reloading, we'll
                // still enqueue it.
                while (this.reloader.pending_count.swap(0, .monotonic) > 0) {
                    this.reloader.ctx.reload();
                }
            }

            pub fn enqueue(this: *HotReloadTask) void {
                JSC.markBinding(@src());
                if (this.count == 0)
                    return;

                if (comptime reload_immediately) {
                    Output.flush();
                    if (comptime Ctx == ImportWatcher) {
                        this.reloader.ctx.rareData().closeAllListenSocketsForWatchMode();
                    }
                    bun.reloadProcess(bun.default_allocator, clear_screen, false);
                    unreachable;
                }

                _ = this.reloader.pending_count.fetchAdd(1, .monotonic);

                BunDebugger__willHotReload();
                var that = bun.default_allocator.create(HotReloadTask) catch unreachable;

                that.* = this.*;
                this.count = 0;
                that.concurrent_task.task = Task.init(that);
                this.reloader.enqueueTaskConcurrent(&that.concurrent_task);
            }

            pub fn deinit(this: *HotReloadTask) void {
                bun.default_allocator.destroy(this);
            }
        };

        fn NewCallback(comptime FunctionSignature: type) type {
            return union(enum) {
                javascript_callback: JSC.Strong,
                zig_callback: struct {
                    ptr: *anyopaque,
                    function: *const FunctionSignature,
                },
            };
        }

        pub const OnAcceptCallback = NewCallback(fn (
            vm: *JSC.VirtualMachine,
            specifier: []const u8,
        ) void);

        pub fn enableHotModuleReloading(this: *Ctx) void {
            if (comptime @TypeOf(this.bun_watcher) == ImportWatcher) {
                if (this.bun_watcher != .none)
                    return;
            } else {
                if (this.bun_watcher != null)
                    return;
            }

            var reloader = bun.default_allocator.create(Reloader) catch bun.outOfMemory();
            reloader.* = .{
                .ctx = this,
                .verbose = if (@hasField(Ctx, "log")) this.log.level.atLeast(.info) else false,
            };

            if (comptime @TypeOf(this.bun_watcher) == ImportWatcher) {
                this.bun_watcher = if (reload_immediately)
                    .{ .watch = @This().Watcher.init(
                        reloader,
                        this.bundler.fs,
                        bun.default_allocator,
                    ) catch |err| {
                        bun.handleErrorReturnTrace(err, @errorReturnTrace());
                        Output.panic("Failed to enable File Watcher: {s}", .{@errorName(err)});
                    } }
                else
                    .{ .hot = @This().Watcher.init(
                        reloader,
                        this.bundler.fs,
                        bun.default_allocator,
                    ) catch |err| {
                        bun.handleErrorReturnTrace(err, @errorReturnTrace());
                        Output.panic("Failed to enable File Watcher: {s}", .{@errorName(err)});
                    } };

                if (reload_immediately) {
                    this.bundler.resolver.watcher = Resolver.ResolveWatcher(*@This().Watcher, onMaybeWatchDirectory).init(this.bun_watcher.watch);
                } else {
                    this.bundler.resolver.watcher = Resolver.ResolveWatcher(*@This().Watcher, onMaybeWatchDirectory).init(this.bun_watcher.hot);
                }
            } else {
                this.bun_watcher = @This().Watcher.init(
                    reloader,
                    this.bundler.fs,
                    bun.default_allocator,
                ) catch |err| {
                    bun.handleErrorReturnTrace(err, @errorReturnTrace());
                    Output.panic("Failed to enable File Watcher: {s}", .{@errorName(err)});
                };
                this.bundler.resolver.watcher = Resolver.ResolveWatcher(*@This().Watcher, onMaybeWatchDirectory).init(this.bun_watcher.?);
            }

            clear_screen = !this.bundler.env.hasSetNoClearTerminalOnReload(!Output.enable_ansi_colors);

            reloader.getContext().start() catch @panic("Failed to start File Watcher");
        }

        pub fn onMaybeWatchDirectory(watch: *@This().Watcher, file_path: string, dir_fd: StoredFileDescriptorType) void {
            // We don't want to watch:
            // - Directories outside the root directory
            // - Directories inside node_modules
            if (std.mem.indexOf(u8, file_path, "node_modules") == null and std.mem.indexOf(u8, file_path, watch.fs.top_level_dir) != null) {
                _ = watch.addDirectory(dir_fd, file_path, GenericWatcher.getHash(file_path), false);
            }
        }

        fn putTombstone(this: *@This(), key: []const u8, value: *bun.fs.FileSystem.RealFS.EntriesOption) void {
            this.tombstones.put(bun.default_allocator, key, value) catch unreachable;
        }

        fn getTombstone(this: *@This(), key: []const u8) ?*bun.fs.FileSystem.RealFS.EntriesOption {
            return this.tombstones.get(key);
        }

        pub fn onError(
            _: *@This(),
            err: bun.sys.Error,
        ) void {
            Output.err(@as(bun.C.E, @enumFromInt(err.errno)), "Watcher crashed", .{});
            if (bun.Environment.isDebug) {
                @panic("Watcher crash");
            }
        }

        pub fn getContext(this: *@This()) *@This().Watcher {
            if (comptime @TypeOf(this.ctx.bun_watcher) == ImportWatcher) {
                if (reload_immediately) {
                    return this.ctx.bun_watcher.watch;
                } else {
                    return this.ctx.bun_watcher.hot;
                }
            } else {
                return this.ctx.bun_watcher.?;
            }
        }

        pub fn onFileUpdate(
            this: *@This(),
            events: []GenericWatcher.WatchEvent,
            changed_files: []?[:0]u8,
            watchlist: GenericWatcher.WatchList,
        ) void {
            var slice = watchlist.slice();
            const file_paths = slice.items(.file_path);
            var counts = slice.items(.count);
            const kinds = slice.items(.kind);
            const hashes = slice.items(.hash);
            const parents = slice.items(.parent_hash);
            const file_descriptors = slice.items(.fd);
            var ctx = this.getContext();
            defer ctx.flushEvictions();
            defer Output.flush();

            var bundler = if (@TypeOf(this.ctx.bundler) == *bun.Bundler)
                this.ctx.bundler
            else
                &this.ctx.bundler;

            var fs: *Fs.FileSystem = bundler.fs;
            var rfs: *Fs.FileSystem.RealFS = &fs.fs;
            var resolver = &bundler.resolver;
            var _on_file_update_path_buf: bun.PathBuffer = undefined;

            var current_task: HotReloadTask = .{
                .reloader = this,
            };
            defer current_task.enqueue();

            for (events) |event| {
                const file_path = file_paths[event.index];
                const update_count = counts[event.index] + 1;
                counts[event.index] = update_count;
                const kind = kinds[event.index];

                // so it's consistent with the rest
                // if we use .extname we might run into an issue with whether or not the "." is included.
                // const path = Fs.PathName.init(file_path);
                const id = hashes[event.index];

                if (comptime Environment.isDebug) {
                    Output.prettyErrorln("[watch] {s} ({s}, {})", .{ file_path, @tagName(kind), event.op });
                }

                switch (kind) {
                    .file => {
                        if (event.op.delete or event.op.rename) {
                            ctx.removeAtIndex(
                                event.index,
                                0,
                                &.{},
                                .file,
                            );
                        }

                        if (this.verbose)
                            Output.prettyErrorln("<r><d>File changed: {s}<r>", .{fs.relativeTo(file_path)});

                        if (event.op.write or event.op.delete or event.op.rename) {
                            current_task.append(id);
                        }
                    },
                    .directory => {
                        if (comptime Environment.isWindows) {
                            // on windows we receive file events for all items affected by a directory change
                            // so we only need to clear the directory cache. all other effects will be handled
                            // by the file events
                            _ = resolver.bustDirCache(strings.pathWithoutTrailingSlashOne(file_path));
                            continue;
                        }
                        var affected_buf: [128][]const u8 = undefined;
                        var entries_option: ?*Fs.FileSystem.RealFS.EntriesOption = null;

                        const affected = brk: {
                            if (comptime Environment.isMac) {
                                if (rfs.entries.get(file_path)) |existing| {
                                    this.putTombstone(file_path, existing);
                                    entries_option = existing;
                                } else if (this.getTombstone(file_path)) |existing| {
                                    entries_option = existing;
                                }

                                var affected_i: usize = 0;

                                // if a file descriptor is stale, we need to close it
                                if (event.op.delete and entries_option != null) {
                                    for (parents, 0..) |parent_hash, entry_id| {
                                        if (parent_hash == id) {
                                            const affected_path = file_paths[entry_id];
                                            const was_deleted = check: {
                                                std.posix.access(affected_path, std.posix.F_OK) catch break :check true;
                                                break :check false;
                                            };
                                            if (!was_deleted) continue;

                                            affected_buf[affected_i] = affected_path[file_path.len..];
                                            affected_i += 1;
                                            if (affected_i >= affected_buf.len) break;
                                        }
                                    }
                                }

                                break :brk affected_buf[0..affected_i];
                            }

                            break :brk event.names(changed_files);
                        };

                        if (affected.len > 0 and !Environment.isMac) {
                            if (rfs.entries.get(file_path)) |existing| {
                                this.putTombstone(file_path, existing);
                                entries_option = existing;
                            } else if (this.getTombstone(file_path)) |existing| {
                                entries_option = existing;
                            }
                        }

                        _ = resolver.bustDirCache(strings.pathWithoutTrailingSlashOne(file_path));

                        if (entries_option) |dir_ent| {
                            var last_file_hash: GenericWatcher.HashType = std.math.maxInt(GenericWatcher.HashType);

                            for (affected) |changed_name_| {
                                const changed_name: []const u8 = if (comptime Environment.isMac)
                                    changed_name_
                                else
                                    bun.asByteSlice(changed_name_.?);
                                if (changed_name.len == 0 or changed_name[0] == '~' or changed_name[0] == '.') continue;

                                const loader = (bundler.options.loaders.get(Fs.PathName.init(changed_name).ext) orelse .file);
                                var prev_entry_id: usize = std.math.maxInt(usize);
                                if (loader != .file) {
                                    var path_string: bun.PathString = undefined;
                                    var file_hash: GenericWatcher.HashType = last_file_hash;
                                    const abs_path: string = brk: {
                                        if (dir_ent.entries.get(@as([]const u8, @ptrCast(changed_name)))) |file_ent| {
                                            // reset the file descriptor
                                            file_ent.entry.cache.fd = .zero;
                                            file_ent.entry.need_stat = true;
                                            path_string = file_ent.entry.abs_path;
                                            file_hash = GenericWatcher.getHash(path_string.slice());
                                            for (hashes, 0..) |hash, entry_id| {
                                                if (hash == file_hash) {
                                                    if (file_descriptors[entry_id] != .zero) {
                                                        if (prev_entry_id != entry_id) {
                                                            current_task.append(@as(u32, @truncate(entry_id)));
                                                            ctx.removeAtIndex(
                                                                @as(u16, @truncate(entry_id)),
                                                                0,
                                                                &.{},
                                                                .file,
                                                            );
                                                        }
                                                    }

                                                    prev_entry_id = entry_id;
                                                    break;
                                                }
                                            }

                                            break :brk path_string.slice();
                                        } else {
                                            const file_path_without_trailing_slash = std.mem.trimRight(u8, file_path, std.fs.path.sep_str);
                                            @memcpy(_on_file_update_path_buf[0..file_path_without_trailing_slash.len], file_path_without_trailing_slash);
                                            _on_file_update_path_buf[file_path_without_trailing_slash.len] = std.fs.path.sep;

                                            @memcpy(_on_file_update_path_buf[file_path_without_trailing_slash.len..][0..changed_name.len], changed_name);
                                            const path_slice = _on_file_update_path_buf[0 .. file_path_without_trailing_slash.len + changed_name.len + 1];
                                            file_hash = GenericWatcher.getHash(path_slice);
                                            break :brk path_slice;
                                        }
                                    };

                                    // skip consecutive duplicates
                                    if (last_file_hash == file_hash) continue;
                                    last_file_hash = file_hash;

                                    if (this.verbose)
                                        Output.prettyErrorln("<r> <d>File change: {s}<r>", .{fs.relativeTo(abs_path)});
                                }
                            }
                        }

                        if (this.verbose) {
                            Output.prettyErrorln("<r> <d>Dir change: {s}<r>", .{fs.relativeTo(file_path)});
                        }
                    },
                }
            }
        }
    };
}

export fn Bun__addSourceProviderSourceMap(vm: *VirtualMachine, opaque_source_provider: *anyopaque, specifier: *bun.String) void {
    var sfb = std.heap.stackFallback(4096, bun.default_allocator);
    const slice = specifier.toUTF8(sfb.get());
    defer slice.deinit();
    vm.source_mappings.putZigSourceProvider(opaque_source_provider, slice.slice());
}

export fn Bun__removeSourceProviderSourceMap(vm: *VirtualMachine, opaque_source_provider: *anyopaque, specifier: *bun.String) void {
    var sfb = std.heap.stackFallback(4096, bun.default_allocator);
    const slice = specifier.toUTF8(sfb.get());
    defer slice.deinit();
    vm.source_mappings.removeZigSourceProvider(opaque_source_provider, slice.slice());
}

pub export var isBunTest: bool = false;
