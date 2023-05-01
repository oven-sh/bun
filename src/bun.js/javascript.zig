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
const Arena = @import("../mimalloc_arena.zig").Arena;
const C = bun.C;
const NetworkThread = @import("root").bun.HTTP.NetworkThread;
const IO = @import("root").bun.AsyncIO;
const Allocator = std.mem.Allocator;
const IdentityContext = @import("../identity_context.zig").IdentityContext;
const Fs = @import("../fs.zig");
const Resolver = @import("../resolver/resolver.zig");
const ast = @import("../import_record.zig");
const NodeModuleBundle = @import("../node_module_bundle.zig").NodeModuleBundle;
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
const http = @import("../http.zig");
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

const ModuleLoader = JSC.ModuleLoader;
const FetchFlags = JSC.FetchFlags;

pub const GlobalConstructors = [_]type{
    JSC.Cloudflare.HTMLRewriter.Constructor,
};

pub const GlobalClasses = [_]type{
    Bun.Class,
    WebCore.Crypto.Class,
    EventListenerMixin.addEventListener(VirtualMachine),
    BuildError.Class,
    ResolveError.Class,

    Fetch.Class,
    js_ast.Macro.JSNode.BunJSXCallbackFunction,

    WebCore.Crypto.Prototype,

    WebCore.Alert.Class,
    WebCore.Confirm.Class,
    WebCore.Prompt.Class,
};
const TaggedPointerUnion = @import("../tagged_pointer.zig").TaggedPointerUnion;
const Task = JSC.Task;
const Blob = @import("../blob.zig");
pub const Buffer = MarkedArrayBuffer;
const Lock = @import("../lock.zig").Lock;

pub const OpaqueCallback = *const fn (current: ?*anyopaque) callconv(.C) void;
pub fn OpaqueWrap(comptime Context: type, comptime Function: fn (this: *Context) void) OpaqueCallback {
    return struct {
        pub fn callback(ctx: ?*anyopaque) callconv(.C) void {
            var context: *Context = @ptrCast(*Context, @alignCast(@alignOf(Context), ctx.?));
            @call(.auto, Function, .{context});
        }
    }.callback;
}

pub const bun_file_import_path = "/node_modules.server.bun";

const SourceMap = @import("../sourcemap/sourcemap.zig");
const MappingList = SourceMap.Mapping.List;

pub const SavedSourceMap = struct {
    // For bun.js, we store the number of mappings and how many bytes the final list is at the beginning of the array
    // The first 8 bytes are the length of the array
    // The second 8 bytes are the number of mappings
    pub const SavedMappings = struct {
        data: [*]u8,

        pub fn vlq(this: SavedMappings) []u8 {
            return this.data[16..this.len()];
        }

        pub inline fn len(this: SavedMappings) usize {
            return @bitCast(u64, this.data[0..8].*);
        }

        pub fn deinit(this: SavedMappings) void {
            default_allocator.free(this.data[0..this.len()]);
        }

        pub fn toMapping(this: SavedMappings, allocator: Allocator, path: string) anyerror!MappingList {
            const result = SourceMap.Mapping.parse(
                allocator,
                this.data[16..this.len()],
                @bitCast(usize, this.data[8..16].*),
                1,
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

    pub const Value = TaggedPointerUnion(.{ MappingList, SavedMappings });
    pub const HashTable = std.HashMap(u64, *anyopaque, IdentityContext(u64), 80);

    /// This is a pointer to the map located on the VirtualMachine struct
    map: *HashTable,

    pub fn onSourceMapChunk(this: *SavedSourceMap, chunk: SourceMap.Chunk, source: logger.Source) anyerror!void {
        try this.putMappings(source, chunk.buffer);
    }

    pub const SourceMapHandler = js_printer.SourceMapHandler.For(SavedSourceMap, onSourceMapChunk);

    pub fn putMappings(this: *SavedSourceMap, source: logger.Source, mappings: SourceMap.MappingsBuffer) !void {
        var entry = try this.map.getOrPut(std.hash.Wyhash.hash(0, source.path.text));
        if (entry.found_existing) {
            var value = Value.from(entry.value_ptr.*);
            if (value.get(MappingList)) |source_map_| {
                var source_map: *MappingList = source_map_;
                source_map.deinit(default_allocator);
            } else if (value.get(SavedMappings)) |saved_mappings| {
                var saved = SavedMappings{ .data = @ptrCast([*]u8, saved_mappings) };

                saved.deinit();
            }
        }

        entry.value_ptr.* = Value.init(bun.cast(*SavedMappings, mappings.data.list.items.ptr)).ptr();
    }

    pub fn get(this: *SavedSourceMap, path: string) ?MappingList {
        var mapping = this.map.getEntry(std.hash.Wyhash.hash(0, path)) orelse return null;
        switch (Value.from(mapping.value_ptr.*).tag()) {
            (@field(Value.Tag, @typeName(MappingList))) => {
                return Value.from(mapping.value_ptr.*).as(MappingList).*;
            },
            Value.Tag.SavedMappings => {
                var saved = SavedMappings{ .data = @ptrCast([*]u8, Value.from(mapping.value_ptr.*).as(MappingList)) };
                defer saved.deinit();
                var result = default_allocator.create(MappingList) catch unreachable;
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
        var mappings = this.get(path) orelse return null;
        return SourceMap.Mapping.find(mappings, line, column);
    }
};
const uws = @import("root").bun.uws;

pub export fn Bun__getDefaultGlobal() *JSGlobalObject {
    _ = @sizeOf(JSC.VirtualMachine) + 1;
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
    return @floatCast(f64, (@intToFloat(f64, vm.origin_timestamp) + JSC.VirtualMachine.origin_relative_epoch) / 1_000_000.0);
}

// comptime {
//     if (!JSC.is_bindgen) {
//         _ = Bun__getDefaultGlobal;
//         _ = Bun__getVM;
//         _ = Bun__drainMicrotasks;
//         _ = Bun__queueTask;
//         _ = Bun__queueTaskConcurrently;
//         _ = Bun__handleRejectedPromise;
//         _ = Bun__readOriginTimer;
//         _ = Bun__onDidAppendPlugin;
//         _ = Bun__readOriginTimerStart;
//         _ = Bun__reportUnhandledError;
//     }
// }

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

/// TODO: rename this to ScriptExecutionContext
/// This is the shared global state for a single JS instance execution
/// Today, Bun is one VM per thread, so the name "VirtualMachine" sort of makes sense
/// However, that may change in the future
pub const VirtualMachine = struct {
    global: *JSGlobalObject,
    allocator: std.mem.Allocator,
    has_loaded_constructors: bool = false,
    node_modules: ?*NodeModuleBundle = null,
    bundler: Bundler,
    bun_dev_watcher: ?*http.Watcher = null,
    bun_watcher: ?*JSC.Watcher = null,
    console: *ZigConsoleClient,
    log: *logger.Log,
    event_listeners: EventListenerMixin.Map,
    main: string = "",
    main_hash: u32 = 0,
    process: js.JSObjectRef = null,
    blobs: ?*Blob.Group = null,
    flush_list: std.ArrayList(string),
    entry_point: ServerEntryPoint = undefined,
    origin: URL = URL{},
    node_fs: ?*Node.NodeFS = null,
    has_loaded_node_modules: bool = false,
    timer: Bun.Timer = Bun.Timer{},
    uws_event_loop: ?*uws.Loop = null,
    pending_unref_counter: i32 = 0,
    preload: []const string = &[_][]const u8{},
    unhandled_pending_rejection_to_capture: ?*JSC.JSValue = null,

    hot_reload: bun.CLI.Command.HotReload = .none,

    /// hide bun:wrap from stack traces
    /// bun:wrap is very noisy
    hide_bun_stackframes: bool = true,

    is_printing_plugin: bool = false,

    plugin_runner: ?PluginRunner = null,
    is_main_thread: bool = false,
    last_reported_error_for_dedupe: JSValue = .zero,

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

    has_any_macro_remappings: bool = false,
    is_from_devserver: bool = false,
    has_enabled_macro_mode: bool = false,

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

    global_api_constructors: [GlobalConstructors.len]JSC.JSValue = undefined,

    origin_timer: std.time.Timer = undefined,
    origin_timestamp: u64 = 0,
    macro_event_loop: EventLoop = EventLoop{},
    regular_event_loop: EventLoop = EventLoop{},
    event_loop: *EventLoop = undefined,

    ref_strings: JSC.RefString.Map = undefined,
    file_blobs: JSC.WebCore.Blob.Store.Map,

    source_mappings: SavedSourceMap = undefined,

    active_tasks: usize = 0,

    rare_data: ?*JSC.RareData = null,
    us_loop_reference_count: usize = 0,
    is_us_loop_entered: bool = false,
    pending_internal_promise: *JSC.JSInternalPromise = undefined,
    auto_install_dependencies: bool = false,
    load_builtins_from_path: []const u8 = "",

    onUnhandledRejection: *const OnUnhandledRejection = defaultOnUnhandledRejection,
    onUnhandledRejectionCtx: ?*anyopaque = null,
    unhandled_error_counter: usize = 0,

    modules: ModuleLoader.AsyncModule.Queue = .{},
    aggressive_garbage_collection: GCLevel = GCLevel.none,

    gc_controller: JSC.GarbageCollectionController = .{},

    pub const OnUnhandledRejection = fn (*VirtualMachine, globalObject: *JSC.JSGlobalObject, JSC.JSValue) void;

    const VMHolder = struct {
        pub threadlocal var vm: ?*VirtualMachine = null;
    };

    pub inline fn get() *VirtualMachine {
        return VMHolder.vm.?;
    }

    pub fn mimeType(this: *VirtualMachine, str: []const u8) ?bun.HTTP.MimeType {
        return this.rareData().mimeTypeFromString(this.allocator, str);
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

        if (map.get("BUN_SHOW_BUN_STACKFRAMES") != null)
            this.hide_bun_stackframes = false;

        if (map.get("BUN_OVERRIDE_MODULE_PATH")) |override_path| {
            if (override_path.len > 0) {
                this.load_builtins_from_path = override_path;
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
            this.node_fs.?.* = Node.NodeFS{};
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
        var loop = this.uws_event_loop.?;
        loop.run();
    }

    pub fn onExit(this: *VirtualMachine) void {
        var rare_data = this.rare_data orelse return;
        var hook = rare_data.cleanup_hook orelse return;
        hook.execute();
        while (hook.next) |next| {
            next.execute();
            hook = next;
        }
    }

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
    }

    pub fn disableMacroMode(this: *VirtualMachine) void {
        this.bundler.options.target = .bun;
        this.bundler.resolver.caches.fs.use_alternate_source_cache = false;
        this.macro_mode = false;
        this.event_loop = &this.regular_event_loop;
    }

    pub fn getAPIGlobals() []js.JSClassRef {
        if (is_bindgen)
            return &[_]js.JSClassRef{};
        var classes = default_allocator.alloc(js.JSClassRef, GlobalClasses.len) catch return &[_]js.JSClassRef{};
        inline for (GlobalClasses, 0..) |Class, i| {
            classes[i] = Class.get().*;
        }

        return classes;
    }

    pub fn getAPIConstructors(globalObject: *JSGlobalObject) []const JSC.JSValue {
        if (is_bindgen)
            return &[_]JSC.JSValue{};
        const is_first = !VirtualMachine.get().has_loaded_constructors;
        if (is_first) {
            VirtualMachine.get().global = globalObject;
            VirtualMachine.get().has_loaded_constructors = true;
        }

        var slice = if (is_first)
            @as([]JSC.JSValue, &JSC.VirtualMachine.get().global_api_constructors)
        else
            VirtualMachine.get().allocator.alloc(JSC.JSValue, GlobalConstructors.len) catch unreachable;

        inline for (GlobalConstructors, 0..) |Class, i| {
            var ref = Class.constructor(globalObject.ref()).?;
            JSC.C.JSValueProtect(globalObject.ref(), ref);
            slice[i] = JSC.JSValue.fromRef(
                ref,
            );
        }

        return slice;
    }

    pub fn isWatcherEnabled(this: *VirtualMachine) bool {
        return this.bun_dev_watcher != null or this.bun_watcher != null;
    }

    /// Instead of storing timestamp as a i128, we store it as a u64.
    /// We subtract the timestamp from Jan 1, 2000 (Y2K)
    pub const origin_relative_epoch = 946684800 * std.time.ns_per_s;
    fn getOriginTimestamp() u64 {
        return @truncate(
            u64,
            @intCast(
                u128,
                // handle if they set their system clock to be before epoch
                @max(
                    std.time.nanoTimestamp(),
                    origin_relative_epoch,
                ),
            ) - origin_relative_epoch,
        );
    }

    pub inline fn isLoaded() bool {
        return VMHolder.vm != null;
    }

    pub fn init(
        allocator: std.mem.Allocator,
        _args: Api.TransformOptions,
        existing_bundle: ?*NodeModuleBundle,
        _log: ?*logger.Log,
        env_loader: ?*DotEnv.Loader,
    ) !*VirtualMachine {
        var log: *logger.Log = undefined;
        if (_log) |__log| {
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
            try Config.configureTransformOptionsForBunVM(allocator, _args),
            existing_bundle,
            env_loader,
        );

        var vm = VMHolder.vm.?;

        vm.* = VirtualMachine{
            .global = undefined,
            .allocator = allocator,
            .entry_point = ServerEntryPoint{},
            .event_listeners = EventListenerMixin.Map.init(allocator),
            .bundler = bundler,
            .console = console,
            .node_modules = bundler.options.node_modules_bundle,
            .log = log,
            .flush_list = std.ArrayList(string).init(allocator),
            .blobs = if (_args.serve orelse false) try Blob.Group.init(allocator) else null,
            .origin = bundler.options.origin,
            .saved_source_map_table = SavedSourceMap.HashTable.init(allocator),
            .source_mappings = undefined,
            .macros = MacroMap.init(allocator),
            .macro_entry_points = @TypeOf(vm.macro_entry_points).init(allocator),
            .origin_timer = std.time.Timer.start() catch @panic("Please don't mess with timers."),
            .origin_timestamp = getOriginTimestamp(),
            .ref_strings = JSC.RefString.Map.init(allocator),
            .file_blobs = JSC.WebCore.Blob.Store.Map.init(allocator),
        };
        vm.source_mappings = .{ .map = &vm.saved_source_map_table };
        vm.regular_event_loop.tasks = EventLoop.Queue.init(
            default_allocator,
        );
        vm.regular_event_loop.tasks.ensureUnusedCapacity(64) catch unreachable;
        vm.regular_event_loop.concurrent_tasks = .{};
        vm.event_loop = &vm.regular_event_loop;

        vm.bundler.macro_context = null;

        vm.bundler.resolver.onWakePackageManager = .{
            .context = &vm.modules,
            .handler = ModuleLoader.AsyncModule.Queue.onWakeHandler,
            .onDependencyError = JSC.ModuleLoader.AsyncModule.Queue.onDependencyError,
        };

        vm.bundler.configureLinker();
        try vm.bundler.configureFramework(false);

        vm.bundler.macro_context = js_ast.Macro.MacroContext.init(&vm.bundler);

        if (_args.serve orelse false) {
            vm.bundler.linker.onImportCSS = Bun.onImportCSS;
        }

        var global_classes: [GlobalClasses.len]js.JSClassRef = undefined;
        inline for (GlobalClasses, 0..) |Class, i| {
            global_classes[i] = Class.get().*;
        }
        vm.global = ZigGlobalObject.create(
            &global_classes,
            @intCast(i32, global_classes.len),
            vm.console,
        );
        vm.regular_event_loop.global = vm.global;
        vm.regular_event_loop.virtual_machine = vm;

        if (source_code_printer == null) {
            var writer = try js_printer.BufferWriter.init(allocator);
            source_code_printer = allocator.create(js_printer.BufferPrinter) catch unreachable;
            source_code_printer.?.* = js_printer.BufferPrinter.init(writer);
            source_code_printer.?.ctx.append_null_byte = false;
        }

        return vm;
    }

    // dynamic import
    // pub fn import(global: *JSGlobalObject, specifier: ZigString, source: ZigString) callconv(.C) ErrorableZigString {

    // }

    pub threadlocal var source_code_printer: ?*js_printer.BufferPrinter = null;

    pub fn clearRefString(_: *anyopaque, ref_string: *JSC.RefString) void {
        _ = VirtualMachine.get().ref_strings.remove(ref_string.hash);
    }

    pub fn refCountedResolvedSource(this: *VirtualMachine, code: []const u8, specifier: []const u8, source_url: []const u8, hash_: ?u32) ResolvedSource {
        var source = this.refCountedString(code, hash_, true);

        return ResolvedSource{
            .source_code = ZigString.init(source.slice()),
            .specifier = ZigString.init(specifier),
            .source_url = ZigString.init(source_url),
            .hash = source.hash,
            .allocator = source,
        };
    }

    pub fn refCountedStringWithWasNew(this: *VirtualMachine, new: *bool, input_: []const u8, hash_: ?u32, comptime dupe: bool) *JSC.RefString {
        const hash = hash_ orelse JSC.RefString.computeHash(input_);

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
        _specifier: string,
        referrer: string,
        log: *logger.Log,
        ret: *ErrorableResolvedSource,
        comptime flags: FetchFlags,
    ) !ResolvedSource {
        std.debug.assert(VirtualMachine.isLoaded());

        if (try ModuleLoader.fetchBuiltinModule(jsc_vm, _specifier, log, comptime flags.disableTranspiling())) |builtin| {
            return builtin;
        }
        var display_specifier = _specifier;
        var specifier = ModuleLoader.normalizeSpecifier(jsc_vm, _specifier, &display_specifier);
        var path = Fs.Path.init(specifier);
        const loader = jsc_vm.bundler.options.loaders.get(path.name.ext) orelse brk: {
            if (strings.eqlLong(specifier, jsc_vm.main, true)) {
                break :brk options.Loader.js;
            }

            break :brk options.Loader.file;
        };

        return try ModuleLoader.transpileSourceCode(
            jsc_vm,
            specifier,
            display_specifier,
            referrer,
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
            specifier = specifier[0..i];
            query_string.* = specifier[i..];
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
        comptime realpath: bool,
    ) !void {
        std.debug.assert(VirtualMachine.isLoaded());
        // macOS threadlocal vars are very slow
        // we won't change threads in this function
        // so we can copy it here
        var jsc_vm = VirtualMachine.get();

        if (jsc_vm.node_modules == null and strings.eqlComptime(std.fs.path.basename(specifier), Runtime.Runtime.Imports.alt_name)) {
            ret.path = Runtime.Runtime.Imports.Name;
            return;
        } else if (jsc_vm.node_modules != null and strings.eqlComptime(specifier, bun_file_import_path)) {
            ret.path = bun_file_import_path;
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
            var retry_on_not_found = query_string.len > 0;
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
        if (comptime !realpath) {
            if (jsc_vm.node_modules != null and !strings.eqlComptime(result_path.namespace, "node") and result.isLikelyNodeModule()) {
                const node_modules_bundle = jsc_vm.node_modules.?;

                node_module_checker: {
                    const package_json = result.package_json orelse brk: {
                        if (jsc_vm.bundler.resolver.packageJSONForResolvedNodeModule(&result)) |pkg| {
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

                        if (Environment.isDebug) {
                            std.debug.assert(strings.eql(node_modules_bundle.str(package.name), package_json.name));
                        }

                        const package_relative_path = jsc_vm.bundler.fs.relative(
                            package_json.source.path.name.dirWithTrailingSlash(),
                            result_path.text,
                        );

                        if (node_modules_bundle.findModuleIDInPackage(package, package_relative_path) == null) break :node_module_checker;

                        ret.path = bun_file_import_path;
                        return;
                    }
                }
            }
        }

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
            vm_.enqueueTask(Task.init(@ptrCast(*JSC.MicrotaskForDefaultGlobalObject, microtask)));
        } else {
            vm_.enqueueTask(Task.init(microtask));
        }
    }

    pub fn resolveForAPI(
        res: *ErrorableZigString,
        global: *JSGlobalObject,
        specifier: ZigString,
        source: ZigString,
        query_string: *ZigString,
        is_esm: bool,
    ) void {
        resolveMaybeNeedsTrailingSlash(res, global, specifier, source, query_string, is_esm, false, true);
    }

    pub fn resolveFilePathForAPI(
        res: *ErrorableZigString,
        global: *JSGlobalObject,
        specifier: ZigString,
        source: ZigString,
        query_string: *ZigString,
        is_esm: bool,
    ) void {
        resolveMaybeNeedsTrailingSlash(res, global, specifier, source, query_string, is_esm, true, true);
    }

    pub fn resolve(
        res: *ErrorableZigString,
        global: *JSGlobalObject,
        specifier: ZigString,
        source: ZigString,
        query_string: *ZigString,
        is_esm: bool,
    ) void {
        resolveMaybeNeedsTrailingSlash(res, global, specifier, source, query_string, is_esm, true, false);
    }

    fn normalizeSource(source: []const u8) []const u8 {
        if (strings.hasPrefixComptime(source, "file://")) {
            return source["file://".len..];
        }

        return source;
    }

    fn resolveMaybeNeedsTrailingSlash(
        res: *ErrorableZigString,
        global: *JSGlobalObject,
        specifier: ZigString,
        source: ZigString,
        query_string: ?*ZigString,
        is_esm: bool,
        comptime is_a_file_path: bool,
        comptime realpath: bool,
    ) void {
        var result = ResolveFunctionResult{ .path = "", .result = null };
        var jsc_vm = VirtualMachine.get();
        if (jsc_vm.plugin_runner) |plugin_runner| {
            if (PluginRunner.couldBePlugin(specifier.slice())) {
                const namespace = PluginRunner.extractNamespace(specifier.slice());
                const after_namespace = if (namespace.len == 0)
                    specifier
                else
                    specifier.substring(namespace.len + 1, specifier.len);

                if (plugin_runner.onResolveJSC(ZigString.init(namespace), after_namespace, source, .bun)) |resolved_path| {
                    res.* = resolved_path;
                    return;
                }
            }
        }

        if (JSC.HardcodedModule.Aliases.getWithEql(specifier, ZigString.eqlComptime)) |hardcoded| {
            if (hardcoded.tag == .none) {
                resolveMaybeNeedsTrailingSlash(
                    res,
                    global,
                    ZigString.init(hardcoded.path),
                    source,
                    query_string,
                    is_esm,
                    is_a_file_path,
                    realpath,
                );
                return;
            }

            res.* = ErrorableZigString.ok(ZigString.init(hardcoded.path));
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
        _resolve(&result, global, specifier.slice(), normalizeSource(source.slice()), is_esm, is_a_file_path, realpath) catch |err_| {
            var err = err_;
            const msg: logger.Msg = brk: {
                var msgs: []logger.Msg = log.msgs.items;

                for (msgs) |m| {
                    if (m.metadata == .resolve) {
                        err = m.metadata.resolve.err;
                        break :brk m;
                    }
                }

                const printed = ResolveError.fmt(
                    jsc_vm.allocator,
                    specifier.slice(),
                    source.slice(),
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
                        .resolve = .{ .specifier = logger.BabyString.in(printed, specifier.slice()), .import_kind = .stmt },
                    },
                };
            };

            {
                res.* = ErrorableZigString.err(err, @ptrCast(*anyopaque, ResolveError.create(global, VirtualMachine.get().allocator, msg, source.slice())));
            }

            return;
        };

        if (query_string) |query| {
            query.* = ZigString.init(result.query_string);
        }

        res.* = ErrorableZigString.ok(ZigString.init(result.path));
    }

    // // This double prints
    // pub fn promiseRejectionTracker(global: *JSGlobalObject, promise: *JSPromise, _: JSPromiseRejectionOperation) callconv(.C) JSValue {
    //     const result = promise.result(global.vm());
    //     if (@enumToInt(VirtualMachine.get().last_error_jsvalue) != @enumToInt(result)) {
    //         VirtualMachine.get().runErrorHandler(result, null);
    //     }

    //     return JSValue.jsUndefined();
    // }

    pub const main_file_name: string = "bun:main";

    pub fn fetch(ret: *ErrorableResolvedSource, global: *JSGlobalObject, specifier: ZigString, source: ZigString) callconv(.C) void {
        var jsc_vm: *VirtualMachine = if (comptime Environment.isLinux)
            VirtualMachine.get()
        else
            global.bunVM();

        var log = logger.Log.init(jsc_vm.bundler.allocator);
        var spec = specifier.toSlice(jsc_vm.allocator);
        defer spec.deinit();
        var refer = source.toSlice(jsc_vm.allocator);
        defer refer.deinit();

        const result = if (!jsc_vm.bundler.options.disable_transpilation)
            @call(.always_inline, fetchWithoutOnLoadPlugins, .{ jsc_vm, global, spec.slice(), refer.slice(), &log, ret, .transpile }) catch |err| {
                processFetchLog(global, specifier, source, &log, ret, err);
                return;
            }
        else
            fetchWithoutOnLoadPlugins(jsc_vm, global, spec.slice(), refer.slice(), &log, ret, .print_source_and_clone) catch |err| {
                processFetchLog(global, specifier, source, &log, ret, err);
                return;
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
            const specifier_blob = brk: {
                if (strings.hasPrefix(spec.slice(), VirtualMachine.get().bundler.fs.top_level_dir)) {
                    break :brk spec.slice()[VirtualMachine.get().bundler.fs.top_level_dir.len..];
                }
                break :brk spec.slice();
            };

            if (vm.has_loaded) {
                blobs.temporary.put(specifier_blob, .{ .ptr = result.source_code.ptr, .len = result.source_code.len }) catch {};
            } else {
                blobs.persistent.put(specifier_blob, .{ .ptr = result.source_code.ptr, .len = result.source_code.len }) catch {};
            }
        }

        ret.success = true;
    }

    pub fn processFetchLog(globalThis: *JSGlobalObject, specifier: ZigString, referrer: ZigString, log: *logger.Log, ret: *ErrorableResolvedSource, err: anyerror) void {
        switch (log.msgs.items.len) {
            0 => {
                const msg: logger.Msg = brk: {
                    if (err == error.UnexpectedPendingResolution) {
                        break :brk logger.Msg{
                            .data = logger.rangeData(
                                null,
                                logger.Range.None,
                                std.fmt.allocPrint(globalThis.allocator(), "Unexpected pending import in \"{s}\". To automatically install npm packages with Bun, please use an import statement instead of require() or dynamic import().\nThis error can also happen if dependencies import packages which are not referenced anywhere. Worst case, run `bun install` and opt-out of the node_modules folder until we come up with a better way to handle this error.", .{specifier.slice()}) catch unreachable,
                            ),
                        };
                    }

                    break :brk logger.Msg{
                        .data = logger.rangeData(null, logger.Range.None, std.fmt.allocPrint(globalThis.allocator(), "{s} while building {s}", .{ @errorName(err), specifier.slice() }) catch unreachable),
                    };
                };
                {
                    ret.* = ErrorableResolvedSource.err(err, @ptrCast(*anyopaque, BuildError.create(globalThis, globalThis.allocator(), msg)));
                }
                return;
            },

            1 => {
                const msg = log.msgs.items[0];
                ret.* = ErrorableResolvedSource.err(err, switch (msg.metadata) {
                    .build => BuildError.create(globalThis, globalThis.allocator(), msg).?,
                    .resolve => ResolveError.create(
                        globalThis,
                        globalThis.allocator(),
                        msg,
                        referrer.slice(),
                    ).?,
                });
                return;
            },
            else => {
                var errors_stack: [256]*anyopaque = undefined;

                var errors = errors_stack[0..@min(log.msgs.items.len, errors_stack.len)];

                for (log.msgs.items, 0..) |msg, i| {
                    errors[i] = switch (msg.metadata) {
                        .build => BuildError.create(globalThis, globalThis.allocator(), msg).?,
                        .resolve => ResolveError.create(
                            globalThis,
                            globalThis.allocator(),
                            msg,
                            referrer.slice(),
                        ).?,
                    };
                }

                ret.* = ErrorableResolvedSource.err(
                    err,
                    globalThis.createAggregateError(
                        errors.ptr,
                        @intCast(u16, errors.len),
                        &ZigString.init(
                            std.fmt.allocPrint(globalThis.allocator(), "{d} errors building \"{s}\"", .{
                                errors.len,
                                specifier.slice(),
                            }) catch unreachable,
                        ),
                    ).asVoid(),
                );
            },
        }
    }

    // TODO:
    pub fn deinit(_: *VirtualMachine) void {}

    pub const ExceptionList = std.ArrayList(Api.JsException);

    pub fn printException(
        this: *VirtualMachine,
        exception: *Exception,
        exception_list: ?*ExceptionList,
        comptime Writer: type,
        writer: Writer,
    ) void {
        if (Output.enable_ansi_colors) {
            this.printErrorlikeObject(exception.value(), exception, exception_list, Writer, writer, true);
        } else {
            this.printErrorlikeObject(exception.value(), exception, exception_list, Writer, writer, false);
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
            var exception = @ptrCast(*Exception, result.asVoid());

            this.printException(
                exception,
                exception_list,
                @TypeOf(Output.errorWriter()),
                Output.errorWriter(),
            );
        } else if (Output.enable_ansi_colors) {
            this.printErrorlikeObject(result, null, exception_list, @TypeOf(Output.errorWriter()), Output.errorWriter(), true);
        } else {
            this.printErrorlikeObject(result, null, exception_list, @TypeOf(Output.errorWriter()), Output.errorWriter(), false);
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
        this.main = entry_path;
        try this.entry_point.generate(
            this.allocator,
            this.bun_watcher != null,
            Fs.PathName.init(entry_path),
            main_file_name,
        );
        this.eventLoop().ensureWaker();

        var promise: *JSInternalPromise = undefined;

        if (!this.bundler.options.disable_transpilation) {

            // We first import the node_modules bundle. This prevents any potential TDZ issues.
            // The contents of the node_modules bundle are lazy, so hopefully this should be pretty quick.
            if (this.node_modules != null and !this.has_loaded_node_modules) {
                this.has_loaded_node_modules = true;
                promise = JSModuleLoader.loadAndEvaluateModule(this.global, ZigString.static(bun_file_import_path));
                this.waitForPromise(JSC.AnyPromise{
                    .Internal = promise,
                });
                if (promise.status(this.global.vm()) == .Rejected)
                    return promise;
            }

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
                promise = JSModuleLoader.loadAndEvaluateModule(this.global, &ZigString.init(result.path().?.text));
                this.pending_internal_promise = promise;

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

            // only load preloads once
            this.preload.len = 0;

            promise = JSModuleLoader.loadAndEvaluateModule(this.global, ZigString.static(main_file_name));
            this.pending_internal_promise = promise;
        } else {
            promise = JSModuleLoader.loadAndEvaluateModule(this.global, &ZigString.init(this.main));
            this.pending_internal_promise = promise;
        }

        return promise;
    }

    pub fn loadEntryPoint(this: *VirtualMachine, entry_path: string) !*JSInternalPromise {
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

        promise = JSModuleLoader.loadAndEvaluateModule(this.global, &ZigString.init(entry_path));
        this.waitForPromise(JSC.AnyPromise{
            .Internal = promise,
        });

        return promise;
    }

    // When the Error-like object is one of our own, it's best to rely on the object directly instead of serializing it to a ZigException.
    // This is for:
    // - BuildError
    // - ResolveError
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
                    var this_ = @intToPtr(*@This(), @ptrToInt(ctx));
                    VirtualMachine.get().printErrorlikeObject(nextValue, null, this_.current_exception_list, Writer, this_.writer, color);
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

        if (value.isObject()) {
            if (js.JSObjectGetPrivate(value.asRef())) |priv| {
                was_internal = this.printErrorFromMaybePrivateData(
                    priv,
                    exception_list,
                    Writer,
                    writer,
                    allow_ansi_color,
                );
                return;
            }
        }

        was_internal = this.printErrorFromMaybePrivateData(
            value.asRef(),
            exception_list,
            Writer,
            writer,
            allow_ansi_color,
        );
    }

    pub fn printErrorFromMaybePrivateData(
        this: *VirtualMachine,
        value: ?*anyopaque,
        exception_list: ?*ExceptionList,
        comptime Writer: type,
        writer: Writer,
        comptime allow_ansi_color: bool,
    ) bool {
        const private_data_ptr = JSPrivateDataPtr.from(value);

        switch (private_data_ptr.tag()) {
            .BuildError => {
                defer Output.flush();
                var build_error = private_data_ptr.as(BuildError);
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
            },
            .ResolveError => {
                defer Output.flush();
                var resolve_error = private_data_ptr.as(ResolveError);
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
            },
            else => {
                this.printErrorInstance(
                    @intToEnum(JSValue, @bitCast(JSValue.Type, (@ptrToInt(value)))),
                    exception_list,
                    Writer,
                    writer,
                    allow_ansi_color,
                ) catch |err| {
                    if (comptime Environment.isDebug) {
                        // yo dawg
                        Output.printErrorln("Error while printing Error-like object: {s}", .{@errorName(err)});
                        Output.flush();
                    }
                };
                return false;
            },
        }
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
                const frame = stack[@intCast(usize, i)];
                const file = frame.source_url.slice();
                const func = frame.function_name.slice();
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
        var i: usize = 0;
        while (i < frames_count) : (i += 1) {
            if (frames[i].position.isInvalid()) continue;
            if (this.source_mappings.resolveMapping(
                frames[i].source_url.slice(),
                @max(frames[i].position.line, 0),
                @max(frames[i].position.column_start, 0),
            )) |mapping| {
                frames[i].position.line = mapping.original.lines;
                frames[i].position.column_start = mapping.original.columns;
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
                exception.stack.frames_len = @truncate(u8, j);
                frames.len = j;
            }
        }

        if (frames.len == 0) return;

        var top = &frames[0];
        if (this.source_mappings.resolveMapping(
            top.source_url.slice(),
            @max(top.position.line, 0),
            @max(top.position.column_start, 0),
        )) |mapping| {
            var log = logger.Log.init(default_allocator);
            var errorable: ErrorableResolvedSource = undefined;
            var original_source = fetchWithoutOnLoadPlugins(this, this.global, top.source_url.slice(), "", &log, &errorable, .print_source) catch return;
            const code = original_source.source_code.slice();
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
                code,
                @intCast(u32, top.position.line),
                JSC.ZigException.Holder.source_lines_count,
            )) |lines| {
                var source_lines = exception.stack.source_lines_ptr[0..JSC.ZigException.Holder.source_lines_count];
                var source_line_numbers = exception.stack.source_lines_numbers[0..JSC.ZigException.Holder.source_lines_count];
                std.mem.set(ZigString, source_lines, ZigString.Empty);
                std.mem.set(i32, source_line_numbers, 0);

                var lines_ = lines[0..@min(lines.len, source_lines.len)];
                for (lines_, 0..) |line, j| {
                    source_lines[(lines_.len - 1) - j] = ZigString.init(line);
                    source_line_numbers[j] = top.position.line - @intCast(i32, j) + 1;
                }

                exception.stack.source_lines_len = @intCast(u8, lines_.len);

                top.position.column_stop = @intCast(i32, source_lines[lines_.len - 1].len);
                top.position.line_stop = top.position.column_stop;

                // This expression range is no longer accurate
                top.position.expression_start = mapping.original.columns;
                top.position.expression_stop = top.position.column_stop;
            }
        }

        if (frames.len > 1) {
            for (frames[1..]) |*frame| {
                if (frame.position.isInvalid()) continue;
                if (this.source_mappings.resolveMapping(
                    frame.source_url.slice(),
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

    pub fn printErrorInstance(this: *VirtualMachine, error_instance: JSValue, exception_list: ?*ExceptionList, comptime Writer: type, writer: Writer, comptime allow_ansi_color: bool) !void {
        var exception_holder = ZigException.Holder.init();
        var exception = exception_holder.zigException();
        this.remapZigException(exception, error_instance, exception_list);
        this.had_errors = true;

        var line_numbers = exception.stack.source_lines_numbers[0..exception.stack.source_lines_len];
        var max_line: i32 = -1;
        for (line_numbers) |line| max_line = @max(max_line, line);
        const max_line_number_pad = std.fmt.count("{d}", .{max_line});

        var source_lines = exception.stack.sourceLineIterator();
        var last_pad: u64 = 0;
        while (source_lines.untilLast()) |source| {
            const int_size = std.fmt.count("{d}", .{source.line});
            const pad = max_line_number_pad - int_size;
            last_pad = pad;
            try writer.writeByteNTimes(' ', pad);
            try writer.print(
                comptime Output.prettyFmt("<r><d>{d} | <r>{s}\n", allow_ansi_color),
                .{
                    source.line,
                    std.mem.trim(u8, source.text, "\n"),
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
                var text = std.mem.trim(u8, source.text, "\n");

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
                var remainder = std.mem.trim(u8, source.text, "\n");

                try writer.print(
                    comptime Output.prettyFmt(
                        "<r><d>{d} |<r> {s}\n",
                        allow_ansi_color,
                    ),
                    .{ source.line, remainder },
                );

                if (!top.position.isInvalid()) {
                    var first_non_whitespace = @intCast(u32, top.position.column_start);
                    while (first_non_whitespace < source.text.len and source.text[first_non_whitespace] == ' ') {
                        first_non_whitespace += 1;
                    }
                    const indent = @intCast(usize, pad) + " | ".len + first_non_whitespace;

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
            .system_code = exception.system_code.len > 0 and !strings.eql(exception.system_code.slice(), name.slice()),
            .syscall = exception.syscall.len > 0,
            .errno = exception.errno < 0,
            .path = exception.path.len > 0,
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
                            var zig_str = ZigString.init("");
                            value.jsonStringify(this.global, 2, &zig_str);
                            try writer.print(comptime Output.prettyFmt(" {s}<d>: <r>{s}<r>\n", allow_ansi_color), .{ field, zig_str });
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
            try writer.print(comptime Output.prettyFmt(" path<d>: <r><cyan>\"{s}\"<r>\n", allow_ansi_color), .{exception.path});
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
            try writer.print(comptime Output.prettyFmt(" code<d>: <r><cyan>\"{s}\"<r>\n", allow_ansi_color), .{exception.system_code});
            add_extra_line = true;
        }

        if (show.syscall) {
            try writer.print(comptime Output.prettyFmt("syscall<d>: <r><cyan>\"{s}\"<r>\n", allow_ansi_color), .{exception.syscall});
            add_extra_line = true;
        }

        if (show.errno) {
            if (show.syscall) {
                try writer.writeAll("  ");
            }
            try writer.print(comptime Output.prettyFmt("errno<d>: <r><yellow>{d}<r>\n", allow_ansi_color), .{exception.errno});
            add_extra_line = true;
        }

        if (add_extra_line) try writer.writeAll("\n");

        try printStackTrace(@TypeOf(writer), writer, exception.stack, allow_ansi_color);
    }

    fn printErrorNameAndMessage(_: *VirtualMachine, name: ZigString, message: ZigString, comptime Writer: type, writer: Writer, comptime allow_ansi_color: bool) !void {
        if (name.len > 0 and message.len > 0) {
            const display_name: ZigString = if (!name.is16Bit() and strings.eqlComptime(name.slice(), "Error")) ZigString.init("error") else name;

            try writer.print(comptime Output.prettyFmt("<r><red>{any}<r><d>:<r> <b>{s}<r>\n", allow_ansi_color), .{
                display_name,
                message,
            });
        } else if (name.len > 0) {
            if (name.is16Bit() or !strings.hasPrefixComptime(name.slice(), "error")) {
                try writer.print(comptime Output.prettyFmt("<r><red>error<r><d>:<r> <b>{s}<r>\n", allow_ansi_color), .{name});
            } else {
                try writer.print(comptime Output.prettyFmt("<r><red>{s}<r>\n", allow_ansi_color), .{name});
            }
        } else if (message.len > 0) {
            try writer.print(comptime Output.prettyFmt("<r><red>error<r><d>:<r> <b>{s}<r>\n", allow_ansi_color), .{message});
        } else {
            try writer.print(comptime Output.prettyFmt("<r><red>error<r>\n", allow_ansi_color), .{});
        }
    }

    comptime {
        if (!JSC.is_bindgen)
            _ = Bun__remapStackFramePositions;
    }
};

const GetterFn = *const fn (
    this: anytype,
    ctx: js.JSContextRef,
    thisObject: js.JSValueRef,
    prop: js.JSStringRef,
    exception: js.ExceptionRef,
) js.JSValueRef;
const SetterFn = *const fn (
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

    pub fn emitFetchEvent(
        vm: *VirtualMachine,
        request_context: *http.RequestContext,
        comptime CtxType: type,
        ctx: *CtxType,
        comptime onError: fn (ctx: *CtxType, err: anyerror, value: JSValue, request_ctx: *http.RequestContext) anyerror!void,
    ) !void {
        JSC.markBinding(@src());

        var listeners = vm.event_listeners.get(EventType.fetch) orelse (return onError(ctx, error.NoListeners, JSValue.jsUndefined(), request_context) catch {});
        if (listeners.items.len == 0) return onError(ctx, error.NoListeners, JSValue.jsUndefined(), request_context) catch {};
        const FetchEventRejectionHandler = struct {
            pub fn onRejection(_ctx: *anyopaque, err: anyerror, fetch_event: *FetchEvent, value: JSValue) void {
                onError(
                    @intToPtr(*CtxType, @ptrToInt(_ctx)),
                    err,
                    value,
                    fetch_event.request_context.?,
                ) catch {};
            }
        };

        // Rely on JS finalizer
        var fetch_event = try vm.allocator.create(FetchEvent);

        fetch_event.* = FetchEvent{
            .request_context = request_context,
            .request = try Request.fromRequestContext(request_context),
            .onPromiseRejectionCtx = @as(*anyopaque, ctx),
            .onPromiseRejectionHandler = FetchEventRejectionHandler.onRejection,
        };

        var fetch_args: [1]js.JSObjectRef = undefined;
        fetch_args[0] = FetchEvent.Class.make(vm.global, fetch_event);
        JSC.C.JSValueProtect(vm.global, fetch_args[0]);
        defer JSC.C.JSValueUnprotect(vm.global, fetch_args[0]);

        for (listeners.items) |listener_ref| {
            vm.tick();
            var result = js.JSObjectCallAsFunctionReturnValue(vm.global, listener_ref, null, 1, &fetch_args);
            vm.tick();
            var promise = JSInternalPromise.resolvedPromise(vm.global, result);

            vm.event_loop.waitForPromise(JSC.AnyPromise{
                .Internal = promise,
            });

            if (fetch_event.rejected) return;

            if (promise.status(vm.global.vm()) == .Rejected) {
                onError(ctx, error.JSError, promise.result(vm.global.vm()), request_context) catch {};
                return;
            }

            _ = promise.result(vm.global.vm());

            vm.waitForTasks();

            if (request_context.has_called_done) {
                break;
            }
        }

        if (!request_context.has_called_done) {
            onError(ctx, error.FetchHandlerRespondWithNeverCalled, JSValue.jsUndefined(), request_context) catch {};
            return;
        }
    }

    pub fn addEventListener(
        comptime Struct: type,
    ) type {
        const Handler = struct {
            pub fn addListener(
                ctx: js.JSContextRef,
                _: js.JSObjectRef,
                _: js.JSObjectRef,
                argumentCount: usize,
                _arguments: [*c]const js.JSValueRef,
                _: js.ExceptionRef,
            ) callconv(.C) js.JSValueRef {
                const arguments = _arguments[0..argumentCount];
                if (arguments.len == 0 or arguments.len == 1 or !js.JSValueIsString(ctx, arguments[0]) or !js.JSValueIsObject(ctx, arguments[arguments.len - 1]) or !js.JSObjectIsFunction(ctx, arguments[arguments.len - 1])) {
                    return js.JSValueMakeUndefined(ctx);
                }
                var name_slice = JSValue.c(arguments[0]).toSlice(ctx, ctx.allocator());
                defer name_slice.deinit();
                const name = name_slice.slice();
                const event = EventType.match(name) orelse return js.JSValueMakeUndefined(ctx);
                var entry = VirtualMachine.get().event_listeners.getOrPut(event) catch unreachable;

                if (!entry.found_existing) {
                    entry.value_ptr.* = List.initCapacity(VirtualMachine.get().allocator, 1) catch unreachable;
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
                .callAsFunction = .{
                    .rfn = Handler.addListener,
                },
            },
            .{},
        );
    }
};

pub const ResolveError = struct {
    msg: logger.Msg,
    allocator: std.mem.Allocator,
    referrer: ?Fs.Path = null,
    logged: bool = false,

    pub fn fmt(allocator: std.mem.Allocator, specifier: string, referrer: string, err: anyerror) !string {
        switch (err) {
            error.ModuleNotFound => {
                if (Resolver.isPackagePath(specifier) and !strings.containsChar(specifier, '/')) {
                    return try std.fmt.allocPrint(allocator, "Cannot find package \"{s}\" from \"{s}\"", .{ specifier, referrer });
                } else {
                    return try std.fmt.allocPrint(allocator, "Cannot find module \"{s}\" from \"{s}\"", .{ specifier, referrer });
                }
            },
            else => {
                if (Resolver.isPackagePath(specifier)) {
                    return try std.fmt.allocPrint(allocator, "{s} while resolving package \"{s}\" from \"{s}\"", .{ @errorName(err), specifier, referrer });
                } else {
                    return try std.fmt.allocPrint(allocator, "{s} while resolving \"{s}\" from \"{s}\"", .{ @errorName(err), specifier, referrer });
                }
            },
        }
    }

    pub fn toStringFn(this: *ResolveError, ctx: js.JSContextRef) js.JSValueRef {
        var text = std.fmt.allocPrint(default_allocator, "ResolveError: {s}", .{this.msg.data.text}) catch return null;
        var str = ZigString.init(text);
        str.setOutputEncoding();
        if (str.isUTF8()) {
            const out = str.toValueGC(ctx.ptr());
            default_allocator.free(text);
            return out.asObjectRef();
        }

        return str.toExternalValue(ctx.ptr()).asObjectRef();
    }

    pub fn toString(
        // this
        this: *ResolveError,
        ctx: js.JSContextRef,
        // function
        _: js.JSObjectRef,
        // thisObject
        _: js.JSObjectRef,
        _: []const js.JSValueRef,
        _: js.ExceptionRef,
    ) js.JSValueRef {
        return this.toStringFn(ctx);
    }

    pub fn convertToType(ctx: js.JSContextRef, obj: js.JSObjectRef, kind: js.JSType, _: js.ExceptionRef) callconv(.C) js.JSValueRef {
        switch (kind) {
            js.JSType.kJSTypeString => {
                if (js.JSObjectGetPrivate(obj)) |priv| {
                    if (JSPrivateDataPtr.from(priv).is(ResolveError)) {
                        var this = JSPrivateDataPtr.from(priv).as(ResolveError);
                        return this.toStringFn(ctx);
                    }
                }
            },
            else => {},
        }

        return obj;
    }

    pub const Class = NewClass(
        ResolveError,
        .{
            .name = "ResolveError",
            .read_only = true,
        },
        .{
            .toString = .{ .rfn = toString },
            .convertToType = .{ .rfn = &convertToType },
        },
        .{
            .referrer = .{
                .get = getReferrer,
                .ro = true,
            },
            .code = .{
                .get = getCode,
                .ro = true,
            },
            .message = .{
                .get = getMessage,
                .ro = true,
            },
            .name = .{
                .get = getName,
                .ro = true,
            },
            .specifier = .{
                .get = getSpecifier,
                .ro = true,
            },
            .importKind = .{
                .get = getImportKind,
                .ro = true,
            },
            .position = .{
                .get = getPosition,
                .ro = true,
            },
        },
    );

    pub fn create(
        globalThis: *JSGlobalObject,
        allocator: std.mem.Allocator,
        msg: logger.Msg,
        referrer: string,
    ) js.JSObjectRef {
        var resolve_error = allocator.create(ResolveError) catch unreachable;
        resolve_error.* = ResolveError{
            .msg = msg.clone(allocator) catch unreachable,
            .allocator = allocator,
            .referrer = Fs.Path.init(referrer),
        };
        var ref = Class.make(globalThis, resolve_error);
        js.JSValueProtect(globalThis, ref);
        return ref;
    }

    pub fn getCode(
        _: *ResolveError,
        ctx: js.JSContextRef,
        _: js.JSObjectRef,
        _: js.JSStringRef,
        _: js.ExceptionRef,
    ) js.JSValueRef {
        return ZigString.static(comptime @as(string, @tagName(JSC.Node.ErrorCode.ERR_MODULE_NOT_FOUND))).toValue(ctx).asObjectRef();
    }

    pub fn getPosition(
        this: *ResolveError,
        ctx: js.JSContextRef,
        _: js.JSObjectRef,
        _: js.JSStringRef,
        _: js.ExceptionRef,
    ) js.JSValueRef {
        return BuildError.generatePositionObject(this.msg, ctx);
    }

    pub fn getMessage(
        this: *ResolveError,
        ctx: js.JSContextRef,
        _: js.JSObjectRef,
        _: js.JSStringRef,
        _: js.ExceptionRef,
    ) js.JSValueRef {
        return ZigString.init(this.msg.data.text).toValueGC(ctx.ptr()).asRef();
    }

    pub fn getSpecifier(
        this: *ResolveError,
        ctx: js.JSContextRef,
        _: js.JSObjectRef,
        _: js.JSStringRef,
        _: js.ExceptionRef,
    ) js.JSValueRef {
        return ZigString.init(this.msg.metadata.resolve.specifier.slice(this.msg.data.text)).toValueGC(ctx.ptr()).asRef();
    }

    pub fn getImportKind(
        this: *ResolveError,
        ctx: js.JSContextRef,
        _: js.JSObjectRef,
        _: js.JSStringRef,
        _: js.ExceptionRef,
    ) js.JSValueRef {
        return ZigString.init(@tagName(this.msg.metadata.resolve.import_kind)).toValue(ctx.ptr()).asRef();
    }

    pub fn getReferrer(
        this: *ResolveError,
        ctx: js.JSContextRef,
        _: js.JSObjectRef,
        _: js.JSStringRef,
        _: js.ExceptionRef,
    ) js.JSValueRef {
        if (this.referrer) |referrer| {
            return ZigString.init(referrer.text).toValueGC(ctx.ptr()).asRef();
        } else {
            return js.JSValueMakeNull(ctx);
        }
    }

    pub fn getName(
        _: *ResolveError,
        ctx: js.JSContextRef,
        _: js.JSObjectRef,
        _: js.JSStringRef,
        _: js.ExceptionRef,
    ) js.JSValueRef {
        return ZigString.static("ResolveError").toValue(ctx.ptr()).asRef();
    }

    pub fn finalize(this: *ResolveError) void {
        this.msg.deinit(bun.default_allocator);
    }
};

pub const BuildError = struct {
    msg: logger.Msg,
    // resolve_result: Resolver.Result,
    allocator: std.mem.Allocator,
    logged: bool = false,

    pub const Class = NewClass(
        BuildError,
        .{ .name = "BuildError", .read_only = true, .ts = .{
            .class = .{
                .name = "BuildError",
            },
        } },
        .{
            .convertToType = .{ .rfn = convertToType },
            .toString = .{ .rfn = toString },
        },
        .{
            .message = .{
                .get = getMessage,
                .ro = true,
            },
            .name = .{
                .get = getName,
                .ro = true,
            },
            // This is called "position" instead of "location" because "location" may be confused with Location.
            .position = .{
                .get = getPosition,
                .ro = true,
            },
        },
    );

    pub fn toStringFn(this: *BuildError, ctx: js.JSContextRef) js.JSValueRef {
        var text = std.fmt.allocPrint(default_allocator, "BuildError: {s}", .{this.msg.data.text}) catch return null;
        var str = ZigString.init(text);
        str.setOutputEncoding();
        if (str.isUTF8()) {
            const out = str.toValueGC(ctx.ptr());
            default_allocator.free(text);
            return out.asObjectRef();
        }

        return str.toExternalValue(ctx.ptr()).asObjectRef();
    }

    pub fn toString(
        // this
        this: *BuildError,
        ctx: js.JSContextRef,
        // function
        _: js.JSObjectRef,
        // thisObject
        _: js.JSObjectRef,
        _: []const js.JSValueRef,
        _: js.ExceptionRef,
    ) js.JSValueRef {
        return this.toStringFn(ctx);
    }

    pub fn convertToType(ctx: js.JSContextRef, obj: js.JSObjectRef, kind: js.JSType, _: js.ExceptionRef) callconv(.C) js.JSValueRef {
        switch (kind) {
            js.JSType.kJSTypeString => {
                if (js.JSObjectGetPrivate(obj)) |priv| {
                    if (JSPrivateDataPtr.from(priv).is(BuildError)) {
                        var this = JSPrivateDataPtr.from(priv).as(BuildError);
                        return this.toStringFn(ctx);
                    }
                }
            },
            else => {},
        }

        return obj;
    }

    pub fn create(
        globalThis: *JSGlobalObject,
        allocator: std.mem.Allocator,
        msg: logger.Msg,
        // resolve_result: *const Resolver.Result,
    ) js.JSObjectRef {
        var build_error = allocator.create(BuildError) catch unreachable;
        build_error.* = BuildError{
            .msg = msg.clone(allocator) catch unreachable,
            // .resolve_result = resolve_result.*,
            .allocator = allocator,
        };

        var ref = Class.make(globalThis, build_error);
        js.JSValueProtect(globalThis, ref);
        return ref;
    }

    pub fn getPosition(
        this: *BuildError,
        ctx: js.JSContextRef,
        _: js.JSObjectRef,
        _: js.JSStringRef,
        _: js.ExceptionRef,
    ) js.JSValueRef {
        return generatePositionObject(this.msg, ctx);
    }

    pub fn generatePositionObject(msg: logger.Msg, ctx: js.JSContextRef) js.JSValueRef {
        if (msg.data.location) |location| {
            var object = JSC.JSValue.createEmptyObject(ctx, 7);

            object.put(
                ctx,
                ZigString.static("lineText"),
                ZigString.init(location.line_text orelse "").toValueGC(ctx),
            );
            object.put(
                ctx,
                ZigString.static("file"),
                ZigString.init(location.file).toValueGC(ctx),
            );
            object.put(
                ctx,
                ZigString.static("namespace"),
                ZigString.init(location.namespace).toValueGC(ctx),
            );
            object.put(
                ctx,
                ZigString.static("line"),
                JSValue.jsNumber(location.line),
            );
            object.put(
                ctx,
                ZigString.static("column"),
                JSValue.jsNumber(location.column),
            );
            object.put(
                ctx,
                ZigString.static("length"),
                JSValue.jsNumber(location.length),
            );
            object.put(
                ctx,
                ZigString.static("offset"),
                JSValue.jsNumber(location.offset),
            );
            return object.asObjectRef();
        }

        return js.JSValueMakeNull(ctx);
    }

    pub fn getMessage(
        this: *BuildError,
        ctx: js.JSContextRef,
        _: js.JSObjectRef,
        _: js.JSStringRef,
        _: js.ExceptionRef,
    ) js.JSValueRef {
        return ZigString.init(this.msg.data.text).toValue(ctx.ptr()).asRef();
    }

    const BuildErrorName = "BuildError";
    pub fn getName(
        _: *BuildError,
        ctx: js.JSContextRef,
        _: js.JSObjectRef,
        _: js.JSStringRef,
        _: js.ExceptionRef,
    ) js.JSValueRef {
        return ZigString.init(BuildErrorName).toValue(ctx.ptr()).asRef();
    }
};

pub const JSPrivateDataTag = JSPrivateDataPtr.Tag;
pub const HotReloader = NewHotReloader(VirtualMachine, JSC.EventLoop, false);
pub const Watcher = HotReloader.Watcher;

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
                                        if (dir_ent.entries.get(@ptrCast([]const u8, changed_name))) |file_ent| {
                                            // reset the file descriptor
                                            file_ent.entry.cache.fd = 0;
                                            file_ent.entry.need_stat = true;
                                            path_string = file_ent.entry.abs_path;
                                            file_hash = @This().Watcher.getHash(path_string.slice());
                                            for (hashes, 0..) |hash, entry_id| {
                                                if (hash == file_hash) {
                                                    if (file_descriptors[entry_id] != 0) {
                                                        if (prev_entry_id != entry_id) {
                                                            current_task.append(@truncate(u32, entry_id));
                                                            ctx.removeAtIndex(
                                                                @truncate(u16, entry_id),
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
                                            @memcpy(&_on_file_update_path_buf, file_path_without_trailing_slash.ptr, file_path_without_trailing_slash.len);
                                            _on_file_update_path_buf[file_path_without_trailing_slash.len] = std.fs.path.sep;

                                            @memcpy(_on_file_update_path_buf[file_path_without_trailing_slash.len + 1 ..].ptr, changed_name.ptr, changed_name.len);
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
