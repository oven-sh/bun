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
const NetworkThread = @import("root").bun.HTTP.NetworkThread;
const IO = @import("root").bun.AsyncIO;
const Allocator = std.mem.Allocator;
const IdentityContext = @import("../identity_context.zig").IdentityContext;
const Fs = @import("../fs.zig");
const Resolver = @import("../resolver/resolver.zig");
const ast = @import("../import_record.zig");
const MacroEntryPoint = bun.bundler.MacroEntryPoint;
const ParseResult = bun.bundler.ParseResult;
const logger = @import("root").bun.logger;
const Api = @import("../api/schema.zig").Api;
const options = @import("../options.zig");
const Bundler = bun.Bundler;
const PluginRunner = bun.bundler.PluginRunner;
const ServerEntryPoint = bun.bundler.ServerEntryPoint;
const js_printer = bun.js_printer;
const js_parser = bun.js_parser;
const js_ast = bun.JSAst;
const http = @import("../bun_dev_http_server.zig");
const NodeFallbackModules = @import("../node_fallbacks.zig");
const ImportKind = ast.ImportKind;
const Analytics = @import("../analytics/analytics_thread.zig");
const ZigString = @import("root").bun.JSC.ZigString;
const Runtime = @import("../runtime.zig");
const Router = @import("./api/filesystem_router.zig");
const ImportRecord = ast.ImportRecord;
const DotEnv = @import("../env_loader.zig");
const PackageJSON = @import("../resolver/package_json.zig").PackageJSON;
const MacroRemap = @import("../resolver/package_json.zig").MacroMap;
const WebCore = @import("root").bun.JSC.WebCore;
const Request = WebCore.Request;
const Response = WebCore.Response;
const Headers = WebCore.Headers;
const String = bun.String;
const Fetch = WebCore.Fetch;
const FetchEvent = WebCore.FetchEvent;
const js = @import("root").bun.JSC.C;
const JSC = @import("root").bun.JSC;
const JSError = @import("./base.zig").JSError;
const d = @import("./base.zig").d;
const MarkedArrayBuffer = @import("./base.zig").MarkedArrayBuffer;
const getAllocator = @import("./base.zig").getAllocator;
const JSValue = @import("root").bun.JSC.JSValue;
const NewClass = @import("./base.zig").NewClass;
const Microtask = @import("root").bun.JSC.Microtask;
const JSGlobalObject = @import("root").bun.JSC.JSGlobalObject;
const ExceptionValueRef = @import("root").bun.JSC.ExceptionValueRef;
const JSPrivateDataPtr = @import("root").bun.JSC.JSPrivateDataPtr;
const ZigConsoleClient = @import("root").bun.JSC.ZigConsoleClient;
const Node = @import("root").bun.JSC.Node;
const ZigException = @import("root").bun.JSC.ZigException;
const ZigStackTrace = @import("root").bun.JSC.ZigStackTrace;
const ErrorableResolvedSource = @import("root").bun.JSC.ErrorableResolvedSource;
const ResolvedSource = @import("root").bun.JSC.ResolvedSource;
const JSPromise = @import("root").bun.JSC.JSPromise;
const JSInternalPromise = @import("root").bun.JSC.JSInternalPromise;
const JSModuleLoader = @import("root").bun.JSC.JSModuleLoader;
const JSPromiseRejectionOperation = @import("root").bun.JSC.JSPromiseRejectionOperation;
const Exception = @import("root").bun.JSC.Exception;
const ErrorableZigString = @import("root").bun.JSC.ErrorableZigString;
const ZigGlobalObject = @import("root").bun.JSC.ZigGlobalObject;
const VM = @import("root").bun.JSC.VM;
const JSFunction = @import("root").bun.JSC.JSFunction;
const Config = @import("./config.zig");
const URL = @import("../url.zig").URL;
const Bun = JSC.API.Bun;
const EventLoop = JSC.EventLoop;
const PendingResolution = @import("../resolver/resolver.zig").PendingResolution;
const ThreadSafeFunction = JSC.napi.ThreadSafeFunction;
const PackageManager = @import("../install/install.zig").PackageManager;
const IPC = @import("ipc.zig");

const ModuleLoader = JSC.ModuleLoader;
const FetchFlags = JSC.FetchFlags;

const TaggedPointerUnion = @import("../tagged_pointer.zig").TaggedPointerUnion;
const Task = JSC.Task;
const Blob = @import("../blob.zig");
pub const Buffer = MarkedArrayBuffer;
const Lock = @import("../lock.zig").Lock;
const BuildMessage = JSC.BuildMessage;
const ResolveMessage = JSC.ResolveMessage;

pub const OpaqueCallback = *const fn (current: ?*anyopaque) callconv(.C) void;
pub fn OpaqueWrap(comptime Context: type, comptime Function: fn (this: *Context) void) OpaqueCallback {
    return struct {
        pub fn callback(ctx: ?*anyopaque) callconv(.C) void {
            var context: *Context = @as(*Context, @ptrCast(@alignCast(ctx.?)));
            @call(.auto, Function, .{context});
        }
    }.callback;
}

pub const bun_file_import_path = "/node_modules.server.bun";

const SourceMap = @import("../sourcemap/sourcemap.zig");
const ParsedSourceMap = SourceMap.Mapping.ParsedSourceMap;
const MappingList = SourceMap.Mapping.List;

pub const SavedSourceMap = struct {
    pub const vlq_offset = 24;

    // For bun.js, we store the number of mappings and how many bytes the final list is at the beginning of the array
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
                            false,
                        );
                    } else {
                        try fail.toData(path).writeFormat(
                            Output.errorWriter(),
                            logger.Kind.warn,
                            false,
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

    pub const Value = TaggedPointerUnion(.{ ParsedSourceMap, SavedMappings });
    pub const HashTable = std.HashMap(u64, *anyopaque, IdentityContext(u64), 80);

    /// This is a pointer to the map located on the VirtualMachine struct
    map: *HashTable,

    mutex: bun.Lock = bun.Lock.init(),

    pub fn onSourceMapChunk(this: *SavedSourceMap, chunk: SourceMap.Chunk, source: logger.Source) anyerror!void {
        try this.putMappings(source, chunk.buffer);
    }

    pub const SourceMapHandler = js_printer.SourceMapHandler.For(SavedSourceMap, onSourceMapChunk);

    pub fn deinit(this: *SavedSourceMap) void {
        {
            this.mutex.lock();
            var iter = this.map.valueIterator();
            while (iter.next()) |val| {
                var value = Value.from(val.*);
                if (value.get(ParsedSourceMap)) |source_map_| {
                    var source_map: *ParsedSourceMap = source_map_;
                    source_map.deinit(default_allocator);
                } else if (value.get(SavedMappings)) |saved_mappings| {
                    var saved = SavedMappings{ .data = @as([*]u8, @ptrCast(saved_mappings)) };
                    saved.deinit();
                }
            }

            this.mutex.unlock();
        }

        this.map.deinit();
    }

    pub fn putMappings(this: *SavedSourceMap, source: logger.Source, mappings: MutableString) !void {
        this.mutex.lock();
        defer this.mutex.unlock();
        var entry = try this.map.getOrPut(bun.hash(source.path.text));
        if (entry.found_existing) {
            var value = Value.from(entry.value_ptr.*);
            if (value.get(ParsedSourceMap)) |source_map_| {
                var source_map: *ParsedSourceMap = source_map_;
                source_map.deinit(default_allocator);
            } else if (value.get(SavedMappings)) |saved_mappings| {
                var saved = SavedMappings{ .data = @as([*]u8, @ptrCast(saved_mappings)) };

                saved.deinit();
            }
        }

        entry.value_ptr.* = Value.init(bun.cast(*SavedMappings, mappings.list.items.ptr)).ptr();
    }

    pub fn get(this: *SavedSourceMap, path: string) ?ParsedSourceMap {
        var mapping = this.map.getEntry(bun.hash(path)) orelse return null;
        switch (Value.from(mapping.value_ptr.*).tag()) {
            Value.Tag.ParsedSourceMap => {
                return Value.from(mapping.value_ptr.*).as(ParsedSourceMap).*;
            },
            Value.Tag.SavedMappings => {
                var saved = SavedMappings{ .data = @as([*]u8, @ptrCast(Value.from(mapping.value_ptr.*).as(ParsedSourceMap))) };
                defer saved.deinit();
                var result = default_allocator.create(ParsedSourceMap) catch unreachable;
                result.* = saved.toMapping(default_allocator, path) catch {
                    _ = this.map.remove(mapping.key_ptr.*);
                    return null;
                };
                mapping.value_ptr.* = Value.init(result).ptr();
                return result.*;
            },
            else => return null,
        }
    }

    pub fn resolveMapping(
        this: *SavedSourceMap,
        path: []const u8,
        line: i32,
        column: i32,
    ) ?SourceMap.Mapping {
        this.mutex.lock();
        defer this.mutex.unlock();

        const parsed_mappings = this.get(path) orelse return null;
        return SourceMap.Mapping.find(parsed_mappings.mappings, line, column);
    }
};
const uws = @import("root").bun.uws;

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
) JSValue {
    JSC.markBinding(@src());
    if (callFrame.argumentsCount() < 1) {
        globalObject.throwInvalidArguments("process.send requires at least one argument", .{});
        return .zero;
    }
    var vm = globalObject.bunVM();
    if (vm.ipc) |ipc| {
        const fd = ipc.socket.fd();
        const success = IPC.serializeJSValueForSubprocess(
            globalObject,
            callFrame.argument(0),
            fd,
        );
        return if (success) .undefined else .zero;
    } else {
        globalObject.throw("IPC Socket is no longer open.", .{});
        return .zero;
    }
}

pub export fn Bun__Process__disconnect(
    globalObject: *JSGlobalObject,
    callFrame: *JSC.CallFrame,
) JSValue {
    _ = callFrame;
    _ = globalObject;
    return .undefined;
}

/// This function is called on the main thread
/// The bunVM() call will assert this
pub export fn Bun__queueTask(global: *JSGlobalObject, task: *JSC.CppTask) void {
    global.bunVM().eventLoop().enqueueTask(Task.init(task));
}

pub export fn Bun__queueTaskWithTimeout(global: *JSGlobalObject, task: *JSC.CppTask, milliseconds: i32) void {
    global.bunVM().eventLoop().enqueueTaskWithTimeout(Task.init(task), milliseconds);
}

pub export fn Bun__reportUnhandledError(globalObject: *JSGlobalObject, value: JSValue) callconv(.C) JSValue {
    var jsc_vm = globalObject.bunVM();
    jsc_vm.onUnhandledError(globalObject, value);
    return JSC.JSValue.jsUndefined();
}

/// This function is called on another thread
/// The main difference: we need to allocate the task & wakeup the thread
/// We can avoid that if we run it from the main thread.
pub export fn Bun__queueTaskConcurrently(global: *JSGlobalObject, task: *JSC.CppTask) void {
    var concurrent = bun.default_allocator.create(JSC.ConcurrentTask) catch unreachable;
    concurrent.* = JSC.ConcurrentTask{
        .task = Task.init(task),
        .auto_delete = true,
    };
    global.bunVMConcurrently().eventLoop().enqueueTaskConcurrent(concurrent);
}

pub export fn Bun__handleRejectedPromise(global: *JSGlobalObject, promise: *JSC.JSPromise) void {
    const result = promise.result(global.vm());
    var jsc_vm = global.bunVM();

    // this seems to happen in some cases when GC is running
    if (result == .zero)
        return;

    jsc_vm.onUnhandledError(global, result);
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
        var vm = @fieldParentPtr(VirtualMachine, "exit_handler", this);
        Process__dispatchOnExit(vm.global, this.exit_code);
        if (vm.isMainThread())
            Bun__closeAllSQLiteDatabasesForTermination();
    }

    pub fn dispatchOnBeforeExit(this: *ExitHandler) void {
        JSC.markBinding(@src());
        var vm = @fieldParentPtr(VirtualMachine, "exit_handler", this);
        Process__dispatchOnBeforeExit(vm.global, this.exit_code);
    }
};

pub const WebWorker = @import("./web_worker.zig").WebWorker;

/// TODO: rename this to ScriptExecutionContext
/// This is the shared global state for a single JS instance execution
/// Today, Bun is one VM per thread, so the name "VirtualMachine" sort of makes sense
/// However, that may change in the future
pub const VirtualMachine = struct {
    global: *JSGlobalObject,
    allocator: std.mem.Allocator,
    has_loaded_constructors: bool = false,
    bundler: Bundler,
    bun_dev_watcher: ?*http.Watcher = null,
    bun_watcher: ?*JSC.Watcher = null,
    console: *ZigConsoleClient,
    log: *logger.Log,
    main: string = "",
    main_hash: u32 = 0,
    process: js.JSObjectRef = null,
    blobs: ?*Blob.Group = null,
    flush_list: std.ArrayList(string),
    entry_point: ServerEntryPoint = undefined,
    origin: URL = URL{},
    node_fs: ?*Node.NodeFS = null,
    timer: Bun.Timer = Bun.Timer{},
    event_loop_handle: ?*uws.Loop = null,
    pending_unref_counter: i32 = 0,
    preload: []const string = &[_][]const u8{},
    unhandled_pending_rejection_to_capture: ?*JSC.JSValue = null,
    standalone_module_graph: ?*bun.StandaloneModuleGraph = null,

    hot_reload: bun.CLI.Command.HotReload = .none,
    jsc: *JSC.VM = undefined,

    /// hide bun:wrap from stack traces
    /// bun:wrap is very noisy
    hide_bun_stackframes: bool = true,

    is_printing_plugin: bool = false,

    plugin_runner: ?PluginRunner = null,
    is_main_thread: bool = false,
    last_reported_error_for_dedupe: JSValue = .zero,
    exit_handler: ExitHandler = .{},

    /// Do not access this field directly
    /// It exists in the VirtualMachine struct so that
    /// we don't accidentally make a stack copy of it
    /// only use it through
    /// source_mappings
    saved_source_map_table: SavedSourceMap.HashTable = undefined,

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
    file_blobs: JSC.WebCore.Blob.Store.Map,

    source_mappings: SavedSourceMap = undefined,

    active_tasks: usize = 0,

    rare_data: ?*JSC.RareData = null,
    is_us_loop_entered: bool = false,
    pending_internal_promise: *JSC.JSInternalPromise = undefined,
    auto_install_dependencies: bool = false,

    onUnhandledRejection: *const OnUnhandledRejection = defaultOnUnhandledRejection,
    onUnhandledRejectionCtx: ?*anyopaque = null,
    unhandled_error_counter: usize = 0,

    on_exception: ?*const OnException = null,

    modules: ModuleLoader.AsyncModule.Queue = .{},
    aggressive_garbage_collection: GCLevel = GCLevel.none,

    parser_arena: ?@import("root").bun.ArenaAllocator = null,

    gc_controller: JSC.GarbageCollectionController = .{},
    worker: ?*JSC.WebWorker = null,
    ipc: ?*IPCInstance = null,

    debugger: ?Debugger = null,
    has_started_debugger: bool = false,

    pub const OnUnhandledRejection = fn (*VirtualMachine, globalObject: *JSC.JSGlobalObject, JSC.JSValue) void;

    pub const OnException = fn (*ZigException) void;

    pub fn isMainThread(this: *const VirtualMachine) bool {
        return this.worker == null;
    }

    pub fn isInspectorEnabled(this: *const VirtualMachine) bool {
        return this.debugger != null;
    }

    pub fn setOnException(this: *VirtualMachine, callback: *const OnException) void {
        this.on_exception = callback;
    }

    pub fn clearOnException(this: *VirtualMachine) void {
        this.on_exception = null;
    }

    const VMHolder = struct {
        pub threadlocal var vm: ?*VirtualMachine = null;
    };

    pub inline fn get() *VirtualMachine {
        return VMHolder.vm.?;
    }

    pub fn mimeType(this: *VirtualMachine, str: []const u8) ?bun.HTTP.MimeType {
        return this.rareData().mimeTypeFromString(this.allocator, str);
    }

    pub fn onAfterEventLoop(this: *VirtualMachine) void {
        if (this.after_event_loop_callback) |cb| {
            var ctx = this.after_event_loop_callback_ctx;
            this.after_event_loop_callback = null;
            this.after_event_loop_callback_ctx = null;
            cb(ctx);
        }
    }

    pub fn isEventLoopAlive(vm: *const VirtualMachine) bool {
        return vm.active_tasks > 0 or
            vm.event_loop_handle.?.active > 0 or
            vm.event_loop.tasks.count > 0;
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

    pub fn resetUnhandledRejection(this: *VirtualMachine) void {
        this.onUnhandledRejection = defaultOnUnhandledRejection;
    }

    pub fn loadExtraEnv(this: *VirtualMachine) void {
        var map = this.bundler.env.map;

        if (map.get("BUN_SHOW_BUN_STACKFRAMES") != null) {
            this.hide_bun_stackframes = false;
        }

        if (map.map.fetchSwapRemove("BUN_INTERNAL_IPC_FD")) |kv| {
            if (std.fmt.parseInt(i32, kv.value, 10) catch null) |fd| {
                this.initIPCInstance(fd);
            } else {
                Output.printErrorln("Failed to parse BUN_INTERNAL_IPC_FD", .{});
            }
        }

        if (map.get("BUN_GARBAGE_COLLECTOR_LEVEL")) |gc_level| {
            if (strings.eqlComptime(gc_level, "1")) {
                this.aggressive_garbage_collection = .mild;
            } else if (strings.eqlComptime(gc_level, "2")) {
                this.aggressive_garbage_collection = .aggressive;
            }
        }
    }

    pub fn onUnhandledError(this: *JSC.VirtualMachine, globalObject: *JSC.JSGlobalObject, value: JSC.JSValue) void {
        this.unhandled_error_counter += 1;
        this.onUnhandledRejection(this, globalObject, value);
    }

    pub fn defaultOnUnhandledRejection(this: *JSC.VirtualMachine, _: *JSC.JSGlobalObject, value: JSC.JSValue) void {
        this.runErrorHandler(value, null);
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
        if (this.hot_reload == .watch) {
            Output.flush();
            bun.reloadProcess(bun.default_allocator, !strings.eqlComptime(this.bundler.env.map.get("BUN_CONFIG_NO_CLEAR_TERMINAL_ON_RELOAD") orelse "0", "true"));
        }

        if (!strings.eqlComptime(this.bundler.env.map.get("BUN_CONFIG_NO_CLEAR_TERMINAL_ON_RELOAD") orelse "0", "true")) {
            Output.flush();
            Output.disableBuffering();
            Output.resetTerminalAll();
            Output.enableBuffering();
        }

        this.global.reload();
        this.pending_internal_promise = this.reloadEntryPoint(this.main) catch @panic("Failed to reload");
    }

    pub fn io(this: *VirtualMachine) *IO {
        if (this.io_ == null) {
            this.io_ = IO.init(this) catch @panic("Failed to initialize IO");
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

    pub fn onExit(this: *VirtualMachine) void {
        this.exit_handler.dispatchOnExit();

        var rare_data = this.rare_data orelse return;
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
        poll_ref: JSC.PollRef = .{},
        wait_for_connection: bool = false,
        set_breakpoint_on_first_line: bool = false,

        const debug = Output.scoped(.DEBUGGER, false);

        extern "C" fn Bun__createJSDebugger(*JSC.JSGlobalObject) u32;
        extern "C" fn Bun__ensureDebugger(u32, bool) void;
        extern "C" fn Bun__startJSDebuggerThread(*JSC.JSGlobalObject, u32, *bun.String) void;
        var futex_atomic: std.atomic.Atomic(u32) = undefined;

        pub fn create(this: *VirtualMachine, globalObject: *JSGlobalObject) !void {
            debug("create", .{});
            JSC.markBinding(@src());
            if (has_created_debugger) return;
            has_created_debugger = true;
            var debugger = &this.debugger.?;
            debugger.script_execution_context_id = Bun__createJSDebugger(globalObject);
            if (!this.has_started_debugger) {
                this.has_started_debugger = true;
                futex_atomic = std.atomic.Atomic(u32).init(0);
                var thread = try std.Thread.spawn(.{}, startJSDebuggerThread, .{this});
                thread.detach();
            }
            this.eventLoop().ensureWaker();

            if (debugger.wait_for_connection) {
                debugger.poll_ref.ref(this);
            }

            debug("spin", .{});
            while (futex_atomic.load(.Monotonic) > 0) std.Thread.Futex.wait(&futex_atomic, 1);
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
            std.debug.assert(this.debugger.?.wait_for_connection);
            this.debugger.?.wait_for_connection = false;
            this.debugger.?.poll_ref.unref(this);
        }

        fn start(other_vm: *VirtualMachine) void {
            JSC.markBinding(@src());

            var this = VirtualMachine.get();
            var debugger = other_vm.debugger.?;

            if (debugger.unix.len > 0) {
                var url = bun.String.create(debugger.unix);
                Bun__startJSDebuggerThread(this.global, debugger.script_execution_context_id, &url);
            }

            if (debugger.path_or_port) |path_or_port| {
                var url = bun.String.create(path_or_port);
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
            futex_atomic.store(0, .Monotonic);
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

    pub fn waitForPromiseWithTimeout(this: *VirtualMachine, promise: JSC.AnyPromise, timeout: u32) bool {
        return this.eventLoop().waitForPromiseWithTimeout(promise, timeout);
    }

    pub fn waitForTasks(this: *VirtualMachine) void {
        this.eventLoop().waitForTasks();
    }

    pub const MacroMap = std.AutoArrayHashMap(i32, js.JSObjectRef);

    pub fn enableMacroMode(this: *VirtualMachine) void {
        if (!this.has_enabled_macro_mode) {
            this.has_enabled_macro_mode = true;
            this.macro_event_loop.tasks = EventLoop.Queue.init(default_allocator);
            this.macro_event_loop.tasks.ensureTotalCapacity(16) catch unreachable;
            this.macro_event_loop.global = this.global;
            this.macro_event_loop.virtual_machine = this;
            this.macro_event_loop.concurrent_tasks = .{};
        }

        this.bundler.options.target = .bun_macro;
        this.bundler.resolver.caches.fs.use_alternate_source_cache = true;
        this.macro_mode = true;
        this.event_loop = &this.macro_event_loop;
        Analytics.Features.macros = true;
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
        return this.bun_dev_watcher != null or this.bun_watcher != null;
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
        const allocator = opts.allocator;
        VMHolder.vm = try allocator.create(VirtualMachine);
        var console = try allocator.create(ZigConsoleClient);
        console.* = ZigConsoleClient.init(Output.errorWriter(), Output.writer());
        var log = opts.log.?;
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
            .blobs = null,
            .origin = bundler.options.origin,
            .saved_source_map_table = SavedSourceMap.HashTable.init(bun.default_allocator),
            .source_mappings = undefined,
            .macros = MacroMap.init(allocator),
            .macro_entry_points = @TypeOf(vm.macro_entry_points).init(allocator),
            .origin_timer = std.time.Timer.start() catch @panic("Please don't mess with timers."),
            .origin_timestamp = getOriginTimestamp(),
            .ref_strings = JSC.RefString.Map.init(allocator),
            .ref_strings_mutex = Lock.init(),
            .file_blobs = JSC.WebCore.Blob.Store.Map.init(allocator),
            .standalone_module_graph = opts.graph.?,
            .parser_arena = @import("root").bun.ArenaAllocator.init(allocator),
        };
        vm.source_mappings = .{ .map = &vm.saved_source_map_table };
        vm.regular_event_loop.tasks = EventLoop.Queue.init(
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
            null,
        );
        vm.regular_event_loop.global = vm.global;
        vm.regular_event_loop.virtual_machine = vm;
        vm.jsc = vm.global.vm();

        if (source_code_printer == null) {
            var writer = try js_printer.BufferWriter.init(allocator);
            source_code_printer = allocator.create(js_printer.BufferPrinter) catch unreachable;
            source_code_printer.?.* = js_printer.BufferPrinter.init(writer);
            source_code_printer.?.ctx.append_null_byte = false;
        }

        vm.configureDebugger(opts.debugger);

        return vm;
    }

    pub const Options = struct {
        allocator: std.mem.Allocator,
        args: Api.TransformOptions = std.mem.zeroes(Api.TransformOptions),
        log: ?*logger.Log = null,
        env_loader: ?*DotEnv.Loader = null,
        store_fd: bool = false,
        smol: bool = false,
        graph: ?*bun.StandaloneModuleGraph = null,
        debugger: bun.CLI.Command.Debugger = .{ .unspecified = {} },
    };

    pub fn init(opts: Options) !*VirtualMachine {
        const allocator = opts.allocator;
        var log: *logger.Log = undefined;
        if (opts.log) |__log| {
            log = __log;
        } else {
            log = try allocator.create(logger.Log);
            log.* = logger.Log.init(allocator);
        }

        VMHolder.vm = try allocator.create(VirtualMachine);
        var console = try allocator.create(ZigConsoleClient);
        console.* = ZigConsoleClient.init(Output.errorWriter(), Output.writer());
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
            .blobs = if (opts.args.serve orelse false) try Blob.Group.init(allocator) else null,
            .origin = bundler.options.origin,
            .saved_source_map_table = SavedSourceMap.HashTable.init(bun.default_allocator),
            .source_mappings = undefined,
            .macros = MacroMap.init(allocator),
            .macro_entry_points = @TypeOf(vm.macro_entry_points).init(allocator),
            .origin_timer = std.time.Timer.start() catch @panic("Please don't mess with timers."),
            .origin_timestamp = getOriginTimestamp(),
            .ref_strings = JSC.RefString.Map.init(allocator),
            .ref_strings_mutex = Lock.init(),
            .file_blobs = JSC.WebCore.Blob.Store.Map.init(allocator),
            .parser_arena = @import("root").bun.ArenaAllocator.init(allocator),
        };
        vm.source_mappings = .{ .map = &vm.saved_source_map_table };
        vm.regular_event_loop.tasks = EventLoop.Queue.init(
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
            null,
        );
        vm.regular_event_loop.global = vm.global;
        vm.regular_event_loop.virtual_machine = vm;
        vm.jsc = vm.global.vm();

        if (source_code_printer == null) {
            var writer = try js_printer.BufferWriter.init(allocator);
            source_code_printer = allocator.create(js_printer.BufferPrinter) catch unreachable;
            source_code_printer.?.* = js_printer.BufferPrinter.init(writer);
            source_code_printer.?.ctx.append_null_byte = false;
        }

        vm.configureDebugger(opts.debugger);

        return vm;
    }

    fn configureDebugger(this: *VirtualMachine, debugger: bun.CLI.Command.Debugger) void {
        var unix = bun.getenvZ("BUN_INSPECT") orelse "";
        var set_breakpoint_on_first_line = unix.len > 0 and strings.endsWith(unix, "?break=1");
        var wait_for_connection = set_breakpoint_on_first_line or (unix.len > 0 and strings.endsWith(unix, "?wait=1"));

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
        var log: *logger.Log = undefined;
        const allocator = opts.allocator;
        if (opts.log) |__log| {
            log = __log;
        } else {
            log = try allocator.create(logger.Log);
            log.* = logger.Log.init(allocator);
        }

        VMHolder.vm = try allocator.create(VirtualMachine);
        var console = try allocator.create(ZigConsoleClient);
        console.* = ZigConsoleClient.init(Output.errorWriter(), Output.writer());
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
            .blobs = if (opts.args.serve orelse false) try Blob.Group.init(allocator) else null,
            .origin = bundler.options.origin,
            .saved_source_map_table = SavedSourceMap.HashTable.init(bun.default_allocator),
            .source_mappings = undefined,
            .macros = MacroMap.init(allocator),
            .macro_entry_points = @TypeOf(vm.macro_entry_points).init(allocator),
            .origin_timer = std.time.Timer.start() catch @panic("Please don't mess with timers."),
            .origin_timestamp = getOriginTimestamp(),
            .ref_strings = JSC.RefString.Map.init(allocator),
            .ref_strings_mutex = Lock.init(),
            .file_blobs = JSC.WebCore.Blob.Store.Map.init(allocator),
            .parser_arena = @import("root").bun.ArenaAllocator.init(allocator),
            .standalone_module_graph = worker.parent.standalone_module_graph,
            .worker = worker,
        };
        vm.source_mappings = .{ .map = &vm.saved_source_map_table };
        vm.regular_event_loop.tasks = EventLoop.Queue.init(
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

        vm.bundler.macro_context = js_ast.Macro.MacroContext.init(&vm.bundler);

        if (opts.args.serve orelse false) {
            vm.bundler.linker.onImportCSS = Bun.onImportCSS;
        }

        vm.global = ZigGlobalObject.create(
            vm.console,
            @as(i32, @intCast(worker.execution_context_id)),
            worker.mini,
            worker.cpp_worker,
        );
        vm.regular_event_loop.global = vm.global;
        vm.regular_event_loop.virtual_machine = vm;
        vm.jsc = vm.global.vm();

        if (source_code_printer == null) {
            var writer = try js_printer.BufferWriter.init(allocator);
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
        var source = this.refCountedString(code, hash_, !add_double_ref);
        if (add_double_ref) {
            source.ref();
            source.ref();
        }

        return ResolvedSource{
            .source_code = bun.String.init(source.impl),
            .specifier = specifier,
            .source_url = ZigString.init(source_url),
            .hash = source.hash,
            .allocator = source,
        };
    }

    pub fn refCountedStringWithWasNew(this: *VirtualMachine, new: *bool, input_: []const u8, hash_: ?u32, comptime dupe: bool) *JSC.RefString {
        JSC.markBinding(@src());
        const hash = hash_ orelse JSC.RefString.computeHash(input_);
        this.ref_strings_mutex.lock();
        defer this.ref_strings_mutex.unlock();

        var entry = this.ref_strings.getOrPut(hash) catch unreachable;
        if (!entry.found_existing) {
            const input = if (comptime dupe)
                (this.allocator.dupe(u8, input_) catch unreachable)
            else
                input_;

            var ref = this.allocator.create(JSC.RefString) catch unreachable;
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
        var _was_new = false;
        return this.refCountedStringWithWasNew(&_was_new, input_, hash_, comptime dupe);
    }

    pub fn preflush(this: *VirtualMachine) void {
        // We flush on the next tick so that if there were any errors you can still see them
        this.blobs.?.temporary.reset() catch {};
    }

    pub fn flush(this: *VirtualMachine) void {
        this.had_errors = false;
        for (this.flush_list.items) |item| {
            this.allocator.free(item);
        }
        this.flush_list.shrinkRetainingCapacity(0);
        this.transpiled_count = 0;
        this.resolved_count = 0;
    }

    pub fn fetchWithoutOnLoadPlugins(
        jsc_vm: *VirtualMachine,
        globalObject: *JSC.JSGlobalObject,
        _specifier: String,
        referrer: String,
        log: *logger.Log,
        ret: *ErrorableResolvedSource,
        comptime flags: FetchFlags,
    ) anyerror!ResolvedSource {
        std.debug.assert(VirtualMachine.isLoaded());

        if (try ModuleLoader.fetchBuiltinModule(jsc_vm, _specifier)) |builtin| {
            return builtin;
        }
        var display_specifier = _specifier.toUTF8(bun.default_allocator);
        defer display_specifier.deinit();
        var specifier_clone = _specifier.toUTF8(bun.default_allocator);
        defer specifier_clone.deinit();
        var display_slice = display_specifier.slice();
        var specifier = ModuleLoader.normalizeSpecifier(jsc_vm, specifier_clone.slice(), &display_slice);
        const referrer_clone = referrer.toUTF8(bun.default_allocator);
        defer referrer_clone.deinit();
        var path = Fs.Path.init(specifier_clone.slice());
        const loader = jsc_vm.bundler.options.loaders.get(path.name.ext) orelse brk: {
            if (strings.eqlLong(specifier, jsc_vm.main, true)) {
                break :brk options.Loader.js;
            }

            break :brk options.Loader.file;
        };

        return try ModuleLoader.transpileSourceCode(
            jsc_vm,
            specifier_clone.slice(),
            display_slice,
            referrer_clone.slice(),
            _specifier,
            path,
            loader,
            log,
            null,
            ret,
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
        if (strings.hasPrefixComptime(specifier, "file://")) specifier = specifier["file://".len..];

        if (strings.indexOfChar(specifier, '?')) |i| {
            query_string.* = specifier[i..];
            specifier = specifier[0..i];
        }

        return specifier;
    }

    threadlocal var specifier_cache_resolver_buf: [bun.MAX_PATH_BYTES]u8 = undefined;
    fn _resolve(
        ret: *ResolveFunctionResult,
        _: *JSGlobalObject,
        specifier: string,
        source: string,
        is_esm: bool,
        comptime is_a_file_path: bool,
    ) !void {
        std.debug.assert(VirtualMachine.isLoaded());
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
        } else if (JSC.HardcodedModule.Map.get(specifier)) |result| {
            ret.result = null;
            ret.path = @as(string, @tagName(result));
            return;
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
            var retry_on_not_found = true;
            while (true) {
                break :brk switch (jsc_vm.bundler.resolver.resolveAndAutoInstall(
                    source_to_use,
                    normalized_specifier,
                    if (is_esm) .stmt else .require,
                    .read_only,
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
                                    break :name strings.withTrailingSlash(dir, normalized_specifier);
                                }
                            }

                            var parts = [_]string{
                                source_to_use,
                                normalized_specifier,
                                "../",
                            };

                            break :name bun.path.joinAbsStringBuf(
                                jsc_vm.bundler.fs.top_level_dir,
                                &specifier_cache_resolver_buf,
                                &parts,
                                .auto,
                            );
                        };

                        jsc_vm.bundler.resolver.bustDirCache(buster_name);
                        continue;
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
    pub fn queueMicrotaskToEventLoop(
        globalObject: *JSGlobalObject,
        microtask: *Microtask,
    ) void {
        if (comptime Environment.allow_assert)
            std.debug.assert(VirtualMachine.isLoaded());

        var vm_ = globalObject.bunVM();
        if (vm_.global == globalObject) {
            vm_.enqueueTask(Task.init(@as(*JSC.MicrotaskForDefaultGlobalObject, @ptrCast(microtask))));
        } else {
            vm_.enqueueTask(Task.init(microtask));
        }
    }

    pub fn resolveForAPI(
        res: *ErrorableString,
        global: *JSGlobalObject,
        specifier: bun.String,
        source: bun.String,
        query_string: *ZigString,
        is_esm: bool,
    ) void {
        resolveMaybeNeedsTrailingSlash(res, global, specifier, source, query_string, is_esm, false);
    }

    pub fn resolveFilePathForAPI(
        res: *ErrorableString,
        global: *JSGlobalObject,
        specifier: bun.String,
        source: bun.String,
        query_string: *ZigString,
        is_esm: bool,
    ) void {
        resolveMaybeNeedsTrailingSlash(res, global, specifier, source, query_string, is_esm, true);
    }

    pub fn resolve(
        res: *ErrorableString,
        global: *JSGlobalObject,
        specifier: bun.String,
        source: bun.String,
        query_string: *ZigString,
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
            ) catch @panic("Out of Memory");
            const msg = logger.Msg{
                .data = logger.rangeData(
                    null,
                    logger.Range.None,
                    printed,
                ),
            };
            res.* = ErrorableString.err(error.NameTooLong, ResolveMessage.create(global, VirtualMachine.get().allocator, msg, source.utf8()).asVoid());
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

        var old_log = jsc_vm.log;
        var log = logger.Log.init(jsc_vm.allocator);
        defer log.deinit();
        jsc_vm.log = &log;
        jsc_vm.bundler.resolver.log = &log;
        jsc_vm.bundler.linker.log = &log;
        defer {
            jsc_vm.log = old_log;
            jsc_vm.bundler.linker.log = old_log;
            jsc_vm.bundler.resolver.log = old_log;
        }
        _resolve(&result, global, specifier_utf8.slice(), normalizeSource(source_utf8.slice()), is_esm, is_a_file_path) catch |err_| {
            var err = err_;
            const msg: logger.Msg = brk: {
                var msgs: []logger.Msg = log.msgs.items;

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

    // // This double prints
    // pub fn promiseRejectionTracker(global: *JSGlobalObject, promise: *JSPromise, _: JSPromiseRejectionOperation) callconv(.C) JSValue {
    //     const result = promise.result(global.vm());
    //     if (@intFromEnum(VirtualMachine.get().last_error_jsvalue) != @intFromEnum(result)) {
    //         VirtualMachine.get().runErrorHandler(result, null);
    //     }

    //     return JSValue.jsUndefined();
    // }

    pub const main_file_name: string = "bun:main";

    pub fn fetch(ret: *ErrorableResolvedSource, global: *JSGlobalObject, specifier: bun.String, source: bun.String) callconv(.C) void {
        var jsc_vm: *VirtualMachine = if (comptime Environment.isLinux)
            VirtualMachine.get()
        else
            global.bunVM();

        var log = logger.Log.init(jsc_vm.bundler.allocator);

        const result = switch (!jsc_vm.bundler.options.disable_transpilation) {
            inline else => |is_disabled| fetchWithoutOnLoadPlugins(jsc_vm, global, specifier, source, &log, ret, if (comptime is_disabled) .print_source_and_clone else .transpile) catch |err| {
                processFetchLog(global, specifier, source, &log, ret, err);
                return;
            },
        };

        if (log.errors > 0) {
            processFetchLog(global, specifier, source, &log, ret, error.LinkError);
            return;
        }

        if (log.warnings > 0) {
            var writer = Output.errorWriter();
            if (Output.enable_ansi_colors) {
                for (log.msgs.items) |msg| {
                    if (msg.kind == .warn) {
                        msg.writeFormat(writer, true) catch {};
                    }
                }
            } else {
                for (log.msgs.items) |msg| {
                    if (msg.kind == .warn) {
                        msg.writeFormat(writer, false) catch {};
                    }
                }
            }
        }

        ret.result.value = result;
        var vm = get();

        if (vm.blobs) |blobs| {
            const spec = specifier.toUTF8(bun.default_allocator);
            const specifier_blob = brk: {
                if (strings.hasPrefix(spec.slice(), VirtualMachine.get().bundler.fs.top_level_dir)) {
                    break :brk spec.slice()[VirtualMachine.get().bundler.fs.top_level_dir.len..];
                }
                break :brk spec.slice();
            };

            if (vm.has_loaded) {
                blobs.temporary.put(specifier_blob, .{ .ptr = result.source_code.byteSlice().ptr, .len = result.source_code.length() }) catch {};
            } else {
                blobs.persistent.put(specifier_blob, .{ .ptr = result.source_code.byteSlice().ptr, .len = result.source_code.length() }) catch {};
            }
        }

        ret.success = true;
    }

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

                var errors = errors_stack[0..@min(log.msgs.items.len, errors_stack.len)];

                for (log.msgs.items, errors) |msg, *current| {
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

    pub fn runErrorHandler(this: *VirtualMachine, result: JSValue, exception_list: ?*ExceptionList) void {
        if (!result.isEmptyOrUndefinedOrNull())
            this.last_reported_error_for_dedupe = result;

        if (result.isException(this.global.vm())) {
            var exception = @as(*Exception, @ptrCast(result.asVoid()));

            this.printException(
                exception,
                exception_list,
                @TypeOf(Output.errorWriter()),
                Output.errorWriter(),
                true,
            );
        } else if (Output.enable_ansi_colors) {
            this.printErrorlikeObject(result, null, exception_list, @TypeOf(Output.errorWriter()), Output.errorWriter(), true, true);
        } else {
            this.printErrorlikeObject(result, null, exception_list, @TypeOf(Output.errorWriter()), Output.errorWriter(), false, true);
        }
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

    pub fn reloadEntryPoint(this: *VirtualMachine, entry_path: []const u8) !*JSInternalPromise {
        this.has_loaded = false;
        this.main = entry_path;
        this.main_hash = bun.JSC.Watcher.getHash(entry_path);

        try this.entry_point.generate(
            this.allocator,
            this.bun_watcher != null,
            Fs.PathName.init(entry_path),
            main_file_name,
        );
        this.eventLoop().ensureWaker();

        var promise: *JSInternalPromise = undefined;

        if (this.debugger != null) {
            try Debugger.create(this, this.global);
        }

        if (!this.bundler.options.disable_transpilation) {
            {
                this.is_in_preload = true;
                defer this.is_in_preload = false;
                for (this.preload) |preload| {
                    var result = switch (this.bundler.resolver.resolveAndAutoInstall(
                        this.bundler.fs.top_level_dir,
                        normalizeSource(preload),
                        .stmt,
                        .read_only,
                    )) {
                        .success => |r| r,
                        .failure => |e| {
                            this.log.addErrorFmt(
                                null,
                                logger.Loc.Empty,
                                this.allocator,
                                "{s} resolving preload {any}",
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
                                "preload not found {any}",
                                .{
                                    js_printer.formatJSONString(preload),
                                },
                            ) catch unreachable;
                            return error.ModuleNotFound;
                        },
                    };
                    promise = JSModuleLoader.loadAndEvaluateModule(this.global, &String.fromBytes(result.path().?.text));

                    this.pending_internal_promise = promise;
                    JSValue.fromCell(promise).protect();
                    defer JSValue.fromCell(promise).unprotect();

                    // pending_internal_promise can change if hot module reloading is enabled
                    if (this.bun_watcher != null) {
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
            }

            // only load preloads once
            this.preload.len = 0;

            promise = JSModuleLoader.loadAndEvaluateModule(this.global, &String.init(main_file_name));
            this.pending_internal_promise = promise;
            JSC.JSValue.fromCell(promise).ensureStillAlive();
        } else {
            promise = JSModuleLoader.loadAndEvaluateModule(this.global, &String.init(this.main));
            this.pending_internal_promise = promise;
            JSC.JSValue.fromCell(promise).ensureStillAlive();
        }

        return promise;
    }

    // worker dont has bun_watcher and also we dont wanna call autoTick before dispatchOnline
    pub fn loadEntryPointForWebWorker(this: *VirtualMachine, entry_path: string) anyerror!*JSInternalPromise {
        var promise = try this.reloadEntryPoint(entry_path);
        this.eventLoop().performGC();
        this.waitForPromise(JSC.AnyPromise{
            .Internal = promise,
        });
        return this.pending_internal_promise;
    }

    pub fn loadEntryPoint(this: *VirtualMachine, entry_path: string) anyerror!*JSInternalPromise {
        var promise = try this.reloadEntryPoint(entry_path);

        // pending_internal_promise can change if hot module reloading is enabled
        if (this.bun_watcher != null) {
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

        this.eventLoop().autoTick();

        return this.pending_internal_promise;
    }

    pub fn loadMacroEntryPoint(this: *VirtualMachine, entry_path: string, function_name: string, specifier: string, hash: i32) !*JSInternalPromise {
        var entry_point_entry = try this.macro_entry_points.getOrPut(hash);

        if (!entry_point_entry.found_existing) {
            var macro_entry_pointer: *MacroEntryPoint = this.allocator.create(MacroEntryPoint) catch unreachable;
            entry_point_entry.value_ptr.* = macro_entry_pointer;
            try macro_entry_pointer.generate(&this.bundler, Fs.PathName.init(entry_path), function_name, hash, specifier);
        }
        var entry_point = entry_point_entry.value_ptr.*;

        var loader = MacroEntryPointLoader{
            .path = entry_point.source.path.text,
        };

        this.runWithAPILock(MacroEntryPointLoader, &loader, MacroEntryPointLoader.load);
        return loader.promise;
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
        promise: *JSInternalPromise = undefined,
        pub fn load(this: *MacroEntryPointLoader) void {
            this.promise = VirtualMachine.get()._loadMacroEntryPoint(this.path);
        }
    };

    pub inline fn _loadMacroEntryPoint(this: *VirtualMachine, entry_path: string) *JSInternalPromise {
        var promise: *JSInternalPromise = undefined;

        promise = JSModuleLoader.loadAndEvaluateModule(this.global, &String.init(entry_path));
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
                    defer zig_exception.deinit();
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
                    var this_ = @as(*@This(), @ptrFromInt(@intFromPtr(ctx)));
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
                    build_error.msg.writeFormat(writer, allow_ansi_color) catch {};
                    writer.writeAll("\n") catch {};
                    build_error.logged = true;
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
                    resolve_error.msg.writeFormat(writer, allow_ansi_color) catch {};
                    resolve_error.logged = true;
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
        jsc_vm.onUnhandledError(globalObject, exception.value());
        return JSC.JSValue.jsUndefined();
    }

    pub fn printStackTrace(comptime Writer: type, writer: Writer, trace: ZigStackTrace, comptime allow_ansi_colors: bool) !void {
        const stack = trace.frames();
        if (stack.len > 0) {
            var vm = VirtualMachine.get();
            var i: i16 = 0;
            const origin: ?*const URL = if (vm.is_from_devserver) &vm.origin else null;
            const dir = vm.bundler.fs.top_level_dir;

            while (i < stack.len) : (i += 1) {
                const frame = stack[@as(usize, @intCast(i))];
                const file_slice = frame.source_url.toUTF8(bun.default_allocator);
                defer file_slice.deinit();
                const func_slice = frame.function_name.toUTF8(bun.default_allocator);
                defer func_slice.deinit();

                const file = file_slice.slice();
                const func = func_slice.slice();

                if (file.len == 0 and func.len == 0) continue;

                const has_name = std.fmt.count("{any}", .{frame.nameFormatter(
                    false,
                )}) > 0;

                if (has_name) {
                    try writer.print(
                        comptime Output.prettyFmt(
                            "<r>      <d>at <r>{any}<d> (<r>{any}<d>)<r>\n",
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
                            "<r>      <d>at <r>{any}\n",
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
                @max(frame.position.line, 0),
                @max(frame.position.column_start, 0),
            )) |mapping| {
                frame.position.line = mapping.original.lines;
                frame.position.column_start = mapping.original.columns;
                frame.remapped = true;
            } else {
                frame.remapped = true;
            }
        }
    }

    pub fn remapZigException(
        this: *VirtualMachine,
        exception: *ZigException,
        error_instance: JSValue,
        exception_list: ?*ExceptionList,
    ) void {
        error_instance.toZigException(this.global, exception);
        // defer this so that it copies correctly
        defer {
            if (exception_list) |list| {
                exception.addToErrorList(list, this.bundler.fs.top_level_dir, &this.origin) catch unreachable;
            }
        }

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
            }

            if (start_index) |k| {
                var j = k;
                var i: usize = k;
                while (i < frames.len) : (i += 1) {
                    const frame = frames[i];
                    if (frame.source_url.eqlComptime("bun:wrap") or
                        frame.function_name.eqlComptime("::bunternal::"))
                    {
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
        var top_source_url = top.source_url.toUTF8(bun.default_allocator);
        defer top_source_url.deinit();
        if (this.source_mappings.resolveMapping(
            top_source_url.slice(),
            @max(top.position.line, 0),
            @max(top.position.column_start, 0),
        )) |mapping| {
            var log = logger.Log.init(default_allocator);
            var errorable: ErrorableResolvedSource = undefined;
            var original_source = fetchWithoutOnLoadPlugins(this, this.global, top.source_url, bun.String.empty, &log, &errorable, .print_source) catch return;
            const code = original_source.source_code.toUTF8(bun.default_allocator);
            defer code.deinit();

            top.position.line = mapping.original.lines;
            top.position.line_start = mapping.original.lines;
            top.position.line_stop = mapping.original.lines + 1;
            top.position.column_start = mapping.original.columns;
            top.position.column_stop = mapping.original.columns + 1;
            exception.remapped = true;
            top.remapped = true;
            // This expression range is no longer accurate
            top.position.expression_start = mapping.original.columns;
            top.position.expression_stop = mapping.original.columns + 1;

            if (strings.getLinesInText(
                code.slice(),
                @as(u32, @intCast(top.position.line)),
                JSC.ZigException.Holder.source_lines_count,
            )) |lines| {
                var source_lines = exception.stack.source_lines_ptr[0..JSC.ZigException.Holder.source_lines_count];
                var source_line_numbers = exception.stack.source_lines_numbers[0..JSC.ZigException.Holder.source_lines_count];
                @memset(source_lines, String.empty);
                @memset(source_line_numbers, 0);

                var lines_ = lines[0..@min(lines.len, source_lines.len)];
                for (lines_, 0..) |line, j| {
                    source_lines[(lines_.len - 1) - j] = String.init(line);
                    source_line_numbers[j] = top.position.line - @as(i32, @intCast(j)) + 1;
                }

                exception.stack.source_lines_len = @as(u8, @intCast(lines_.len));

                top.position.column_stop = @as(i32, @intCast(source_lines[lines_.len - 1].length()));
                top.position.line_stop = top.position.column_stop;

                // This expression range is no longer accurate
                top.position.expression_start = mapping.original.columns;
                top.position.expression_stop = top.position.column_stop;
            }
        }

        if (frames.len > 1) {
            for (frames[1..]) |*frame| {
                if (frame.position.isInvalid()) continue;
                const source_url = frame.source_url.toUTF8(bun.default_allocator);
                defer source_url.deinit();
                if (this.source_mappings.resolveMapping(
                    source_url.slice(),
                    @max(frame.position.line, 0),
                    @max(frame.position.column_start, 0),
                )) |mapping| {
                    frame.position.line = mapping.original.lines;
                    frame.remapped = true;
                    frame.position.column_start = mapping.original.columns;
                }
            }
        }
    }

    pub fn printErrorInstance(this: *VirtualMachine, error_instance: JSValue, exception_list: ?*ExceptionList, comptime Writer: type, writer: Writer, comptime allow_ansi_color: bool, comptime allow_side_effects: bool) !void {
        var exception_holder = ZigException.Holder.init();
        var exception = exception_holder.zigException();
        defer exception_holder.deinit();
        this.remapZigException(exception, error_instance, exception_list);
        this.had_errors = true;

        if (allow_side_effects) {
            defer if (this.on_exception) |cb| {
                cb(exception);
            };
        }

        var line_numbers = exception.stack.source_lines_numbers[0..exception.stack.source_lines_len];
        var max_line: i32 = -1;
        for (line_numbers) |line| max_line = @max(max_line, line);
        const max_line_number_pad = std.fmt.count("{d}", .{max_line});

        var source_lines = exception.stack.sourceLineIterator();
        var last_pad: u64 = 0;
        while (source_lines.untilLast()) |source| {
            defer source.text.deinit();

            const int_size = std.fmt.count("{d}", .{source.line});
            const pad = max_line_number_pad - int_size;
            last_pad = pad;
            try writer.writeByteNTimes(' ', pad);

            try writer.print(
                comptime Output.prettyFmt("<r><d>{d} | <r>{s}\n", allow_ansi_color),
                .{
                    source.line,
                    std.mem.trim(u8, source.text.slice(), "\n"),
                },
            );
        }

        var name = exception.name;

        const message = exception.message;

        var did_print_name = false;
        if (source_lines.next()) |source| brk: {
            if (source.text.len == 0) break :brk;

            const top_frame = if (exception.stack.frames_len > 0) exception.stack.frames()[0] else null;
            if (top_frame == null or top_frame.?.position.isInvalid()) {
                defer did_print_name = true;
                defer source.text.deinit();
                var text = std.mem.trim(u8, source.text.slice(), "\n");

                try writer.print(
                    comptime Output.prettyFmt(
                        "<r><d>- |<r> {s}\n",
                        allow_ansi_color,
                    ),
                    .{
                        text,
                    },
                );

                try this.printErrorNameAndMessage(name, message, Writer, writer, allow_ansi_color);
            } else if (top_frame) |top| {
                defer did_print_name = true;
                const int_size = std.fmt.count("{d}", .{source.line});
                const pad = max_line_number_pad - int_size;
                try writer.writeByteNTimes(' ', pad);
                defer source.text.deinit();
                const text = source.text.slice();
                var remainder = std.mem.trim(u8, text, "\n");

                try writer.print(
                    comptime Output.prettyFmt(
                        "<r><d>{d} |<r> {s}\n",
                        allow_ansi_color,
                    ),
                    .{ source.line, remainder },
                );

                if (!top.position.isInvalid()) {
                    var first_non_whitespace = @as(u32, @intCast(top.position.column_start));
                    while (first_non_whitespace < text.len and text[first_non_whitespace] == ' ') {
                        first_non_whitespace += 1;
                    }
                    const indent = @as(usize, @intCast(pad)) + " | ".len + first_non_whitespace;

                    try writer.writeByteNTimes(' ', indent);
                    try writer.print(comptime Output.prettyFmt(
                        "<red><b>^<r>\n",
                        allow_ansi_color,
                    ), .{});
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

        var show = Show{
            .system_code = !exception.system_code.eql(name) and !exception.system_code.isEmpty(),
            .syscall = !exception.syscall.isEmpty(),
            .errno = exception.errno < 0,
            .path = !exception.path.isEmpty(),
            .fd = exception.fd != -1,
        };

        const extra_fields = .{
            "url",
            "info",
            "pkg",
            "errors",
        };

        if (error_instance != .zero and error_instance.isCell() and error_instance.jsType().canGet()) {
            inline for (extra_fields) |field| {
                if (error_instance.get(this.global, field)) |value| {
                    if (!value.isEmptyOrUndefinedOrNull()) {
                        const kind = value.jsType();
                        if (kind.isStringLike()) {
                            if (value.toStringOrNull(this.global)) |str| {
                                var zig_str = str.toSlice(this.global, bun.default_allocator);
                                defer zig_str.deinit();
                                try writer.print(comptime Output.prettyFmt(" {s}<d>: <r>\"{s}\"<r>\n", allow_ansi_color), .{ field, zig_str.slice() });
                                add_extra_line = true;
                            }
                        } else if (kind.isObject() or kind.isArray()) {
                            var bun_str = bun.String.empty;
                            defer bun_str.deref();
                            value.jsonStringify(this.global, 2, &bun_str); //2
                            try writer.print(comptime Output.prettyFmt(" {s}<d>: <r>{any}<r>\n", allow_ansi_color), .{ field, bun_str });
                            add_extra_line = true;
                        }
                    }
                }
            }
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
                try writer.writeAll("   ");
            } else if (show.errno) {
                try writer.writeAll("  ");
            }

            try writer.print(comptime Output.prettyFmt(" fd<d>: <r><cyan>\"{d}\"<r>\n", allow_ansi_color), .{exception.fd});
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

        if (show.errno) {
            if (show.syscall) {
                try writer.writeAll("  ");
            }
            try writer.print(comptime Output.prettyFmt(" errno<d>: <r><yellow>{d}<r>\n", allow_ansi_color), .{exception.errno});
            add_extra_line = true;
        }

        if (add_extra_line) try writer.writeAll("\n");

        try printStackTrace(@TypeOf(writer), writer, exception.stack, allow_ansi_color);
    }

    fn printErrorNameAndMessage(_: *VirtualMachine, name: String, message: String, comptime Writer: type, writer: Writer, comptime allow_ansi_color: bool) !void {
        if (!name.isEmpty() and !message.isEmpty()) {
            const display_name: String = if (name.eqlComptime("Error")) String.init("error") else name;

            try writer.print(comptime Output.prettyFmt("<r><red>{any}<r><d>:<r> <b>{s}<r>\n", allow_ansi_color), .{
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

    extern fn Process__emitMessageEvent(global: *JSGlobalObject, value: JSValue) void;
    extern fn Process__emitDisconnectEvent(global: *JSGlobalObject) void;

    pub const IPCInstance = struct {
        globalThis: ?*JSGlobalObject,
        socket: IPC.Socket,
        uws_context: *uws.SocketContext,
        ipc_buffer: bun.ByteList,

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

        pub fn handleIPCClose(this: *IPCInstance, _: IPC.Socket) void {
            JSC.markBinding(@src());
            if (this.globalThis) |global| {
                var vm = global.bunVM();
                vm.ipc = null;
                Process__emitDisconnectEvent(global);
            }
            uws.us_socket_context_free(0, this.uws_context);
            bun.default_allocator.destroy(this);
        }

        pub const Handlers = IPC.NewIPCHandler(IPCInstance);
    };

    pub fn initIPCInstance(this: *VirtualMachine, fd: i32) void {
        this.event_loop.ensureWaker();
        const context = uws.us_create_socket_context(0, this.event_loop_handle.?, @sizeOf(usize), .{}).?;
        IPC.Socket.configure(context, true, *IPCInstance, IPCInstance.Handlers);

        const socket = uws.newSocketFromFd(context, @sizeOf(*IPCInstance), fd) orelse {
            uws.us_socket_context_free(0, context);
            Output.prettyWarnln("Failed to initialize IPC connection to parent", .{});
            return;
        };

        var instance = bun.default_allocator.create(IPCInstance) catch @panic("OOM");
        instance.* = .{
            .globalThis = this.global,
            .socket = socket,
            .uws_context = context,
            .ipc_buffer = bun.ByteList{},
        };
        var ptr = socket.ext(*IPCInstance);
        ptr.?.* = instance;
        this.ipc = instance;
    }
    comptime {
        if (!JSC.is_bindgen)
            _ = Bun__remapStackFramePositions;
    }
};

pub const HotReloader = NewHotReloader(VirtualMachine, JSC.EventLoop, false);
pub const Watcher = HotReloader.Watcher;
extern fn BunDebugger__willHotReload() void;

pub fn NewHotReloader(comptime Ctx: type, comptime EventLoopType: type, comptime reload_immediately: bool) type {
    return struct {
        const watcher = @import("../watcher.zig");
        pub const Watcher = watcher.NewWatcher(*@This());
        const Reloader = @This();

        onAccept: std.ArrayHashMapUnmanaged(@This().Watcher.HashType, bun.BabyList(OnAcceptCallback), bun.ArrayIdentityContext, false) = .{},
        ctx: *Ctx,
        verbose: bool = false,

        tombstones: std.StringHashMapUnmanaged(*bun.fs.FileSystem.RealFS.EntriesOption) = .{},

        pub fn eventLoop(this: @This()) *EventLoopType {
            return this.ctx.eventLoop();
        }

        pub fn enqueueTaskConcurrent(this: @This(), task: *JSC.ConcurrentTask) void {
            if (comptime reload_immediately)
                unreachable;

            this.eventLoop().enqueueTaskConcurrent(task);
        }

        pub const HotReloadTask = struct {
            reloader: *Reloader,
            count: u8 = 0,
            hashes: [8]u32 = [_]u32{0} ** 8,
            concurrent_task: JSC.ConcurrentTask = undefined,

            pub fn append(this: *HotReloadTask, id: u32) void {
                if (this.count == 8) {
                    this.enqueue();
                    var reloader = this.reloader;
                    this.* = .{
                        .reloader = reloader,
                        .count = 0,
                    };
                }

                this.hashes[this.count] = id;
                this.count += 1;
            }

            pub fn run(this: *HotReloadTask) void {
                this.reloader.ctx.reload();
            }

            pub fn enqueue(this: *HotReloadTask) void {
                if (this.count == 0)
                    return;

                if (comptime reload_immediately) {
                    bun.reloadProcess(bun.default_allocator, Output.enable_ansi_colors);
                    unreachable;
                }

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
            if (this.bun_watcher != null)
                return;

            var reloader = bun.default_allocator.create(Reloader) catch @panic("OOM");
            reloader.* = .{
                .ctx = this,
                .verbose = if (@hasField(Ctx, "log")) this.log.level.atLeast(.info) else false,
            };
            this.bun_watcher = @This().Watcher.init(
                reloader,
                this.bundler.fs,
                bun.default_allocator,
            ) catch @panic("Failed to enable File Watcher");

            this.bundler.resolver.watcher = Resolver.ResolveWatcher(*@This().Watcher, onMaybeWatchDirectory).init(this.bun_watcher.?);

            this.bun_watcher.?.start() catch @panic("Failed to start File Watcher");
        }

        pub fn onMaybeWatchDirectory(watch: *@This().Watcher, file_path: string, dir_fd: StoredFileDescriptorType) void {
            // We don't want to watch:
            // - Directories outside the root directory
            // - Directories inside node_modules
            if (std.mem.indexOf(u8, file_path, "node_modules") == null and std.mem.indexOf(u8, file_path, watch.fs.top_level_dir) != null) {
                watch.addDirectory(dir_fd, file_path, @This().Watcher.getHash(file_path), false) catch {};
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
            err: anyerror,
        ) void {
            Output.prettyErrorln("<r>Watcher crashed: <red><b>{s}<r>", .{@errorName(err)});
        }

        pub fn onFileUpdate(
            this: *@This(),
            events: []watcher.WatchEvent,
            changed_files: []?[:0]u8,
            watchlist: watcher.Watchlist,
        ) void {
            var slice = watchlist.slice();
            const file_paths = slice.items(.file_path);
            var counts = slice.items(.count);
            const kinds = slice.items(.kind);
            const hashes = slice.items(.hash);
            const parents = slice.items(.parent_hash);
            var file_descriptors = slice.items(.fd);
            var ctx = this.ctx.bun_watcher.?;
            defer ctx.flushEvictions();
            defer Output.flush();

            var bundler = if (@TypeOf(this.ctx.bundler) == *bun.Bundler)
                this.ctx.bundler
            else
                &this.ctx.bundler;

            var fs: *Fs.FileSystem = bundler.fs;
            var rfs: *Fs.FileSystem.RealFS = &fs.fs;
            var resolver = &bundler.resolver;
            var _on_file_update_path_buf: [bun.MAX_PATH_BYTES]u8 = undefined;

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
                                                std.os.access(affected_path, std.os.F_OK) catch break :check true;
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

                        resolver.bustDirCache(file_path);

                        if (entries_option) |dir_ent| {
                            var last_file_hash: @This().Watcher.HashType = std.math.maxInt(@This().Watcher.HashType);

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
                                    var file_hash: @This().Watcher.HashType = last_file_hash;
                                    const abs_path: string = brk: {
                                        if (dir_ent.entries.get(@as([]const u8, @ptrCast(changed_name)))) |file_ent| {
                                            // reset the file descriptor
                                            file_ent.entry.cache.fd = 0;
                                            file_ent.entry.need_stat = true;
                                            path_string = file_ent.entry.abs_path;
                                            file_hash = @This().Watcher.getHash(path_string.slice());
                                            for (hashes, 0..) |hash, entry_id| {
                                                if (hash == file_hash) {
                                                    if (file_descriptors[entry_id] != 0) {
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
                                            var file_path_without_trailing_slash = std.mem.trimRight(u8, file_path, std.fs.path.sep_str);
                                            @memcpy(_on_file_update_path_buf[0..file_path_without_trailing_slash.len], file_path_without_trailing_slash);
                                            _on_file_update_path_buf[file_path_without_trailing_slash.len] = std.fs.path.sep;

                                            @memcpy(_on_file_update_path_buf[file_path_without_trailing_slash.len..][0..changed_name.len], changed_name);
                                            const path_slice = _on_file_update_path_buf[0 .. file_path_without_trailing_slash.len + changed_name.len + 1];
                                            file_hash = @This().Watcher.getHash(path_slice);
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
