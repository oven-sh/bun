const std = @import("std");
const is_bindgen: bool = std.meta.globalOption("bindgen", bool) orelse false;
const StaticExport = @import("./bindings/static_export.zig");
const c_char = StaticExport.c_char;
const bun = @import("../global.zig");
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
const NetworkThread = @import("http").NetworkThread;
const IO = @import("io");
pub fn zigCast(comptime Destination: type, value: anytype) *Destination {
    return @ptrCast(*Destination, @alignCast(@alignOf(*Destination), value));
}
const Allocator = std.mem.Allocator;
const IdentityContext = @import("../identity_context.zig").IdentityContext;
const Fs = @import("../fs.zig");
const Resolver = @import("../resolver/resolver.zig");
const ast = @import("../import_record.zig");
const NodeModuleBundle = @import("../node_module_bundle.zig").NodeModuleBundle;
const MacroEntryPoint = @import("../bundler.zig").MacroEntryPoint;
const logger = @import("../logger.zig");
const Api = @import("../api/schema.zig").Api;
const options = @import("../options.zig");
const Bundler = @import("../bundler.zig").Bundler;
const PluginRunner = @import("../bundler.zig").PluginRunner;
const ServerEntryPoint = @import("../bundler.zig").ServerEntryPoint;
const js_printer = @import("../js_printer.zig");
const js_parser = @import("../js_parser.zig");
const js_ast = @import("../js_ast.zig");
const hash_map = @import("../hash_map.zig");
const http = @import("../http.zig");
const NodeFallbackModules = @import("../node_fallbacks.zig");
const ImportKind = ast.ImportKind;
const Analytics = @import("../analytics/analytics_thread.zig");
const ZigString = @import("../jsc.zig").ZigString;
const Runtime = @import("../runtime.zig");
const Router = @import("./api/router.zig");
const ImportRecord = ast.ImportRecord;
const DotEnv = @import("../env_loader.zig");
const ParseResult = @import("../bundler.zig").ParseResult;
const PackageJSON = @import("../resolver/package_json.zig").PackageJSON;
const MacroRemap = @import("../resolver/package_json.zig").MacroMap;
const WebCore = @import("../jsc.zig").WebCore;
const Request = WebCore.Request;
const Response = WebCore.Response;
const Headers = WebCore.Headers;
const Fetch = WebCore.Fetch;
const FetchEvent = WebCore.FetchEvent;
const js = @import("../jsc.zig").C;
const JSC = @import("../jsc.zig");
const JSError = @import("./base.zig").JSError;
const d = @import("./base.zig").d;
const MarkedArrayBuffer = @import("./base.zig").MarkedArrayBuffer;
const getAllocator = @import("./base.zig").getAllocator;
const JSValue = @import("../jsc.zig").JSValue;
const NewClass = @import("./base.zig").NewClass;
const Microtask = @import("../jsc.zig").Microtask;
const JSGlobalObject = @import("../jsc.zig").JSGlobalObject;
const ExceptionValueRef = @import("../jsc.zig").ExceptionValueRef;
const JSPrivateDataPtr = @import("../jsc.zig").JSPrivateDataPtr;
const ZigConsoleClient = @import("../jsc.zig").ZigConsoleClient;
const Node = @import("../jsc.zig").Node;
const ZigException = @import("../jsc.zig").ZigException;
const ZigStackTrace = @import("../jsc.zig").ZigStackTrace;
const ErrorableResolvedSource = @import("../jsc.zig").ErrorableResolvedSource;
const ResolvedSource = @import("../jsc.zig").ResolvedSource;
const JSPromise = @import("../jsc.zig").JSPromise;
const JSInternalPromise = @import("../jsc.zig").JSInternalPromise;
const JSModuleLoader = @import("../jsc.zig").JSModuleLoader;
const JSPromiseRejectionOperation = @import("../jsc.zig").JSPromiseRejectionOperation;
const Exception = @import("../jsc.zig").Exception;
const ErrorableZigString = @import("../jsc.zig").ErrorableZigString;
const ZigGlobalObject = @import("../jsc.zig").ZigGlobalObject;
const VM = @import("../jsc.zig").VM;
const JSFunction = @import("../jsc.zig").JSFunction;
const Config = @import("./config.zig");
const URL = @import("../url.zig").URL;
const Transpiler = @import("./api/transpiler.zig");
const Bun = JSC.API.Bun;
const EventLoop = JSC.EventLoop;
const ThreadSafeFunction = JSC.napi.ThreadSafeFunction;
const PackageManager = @import("../install/install.zig").PackageManager;
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

    // The last item in this array becomes "process.env"
    Bun.EnvironmentVariables.Class,
};
const TaggedPointerUnion = @import("../tagged_pointer.zig").TaggedPointerUnion;
const Task = JSC.Task;
const Blob = @import("../blob.zig");
pub const Buffer = MarkedArrayBuffer;
const Lock = @import("../lock.zig").Lock;

pub const OpaqueCallback = fn (current: ?*anyopaque) callconv(.C) void;
pub fn OpaqueWrap(comptime Context: type, comptime Function: fn (this: *Context) void) OpaqueCallback {
    return struct {
        pub fn callback(ctx: ?*anyopaque) callconv(.C) void {
            var context: *Context = @ptrCast(*Context, @alignCast(@alignOf(Context), ctx.?));
            @call(.{}, Function, .{context});
        }
    }.callback;
}

const bun_file_import_path = "/node_modules.server.bun";

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

    pub fn putMappings(this: *SavedSourceMap, source: logger.Source, mappings: MutableString) !void {
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

        entry.value_ptr.* = Value.init(bun.cast(*SavedMappings, mappings.list.items.ptr)).ptr();
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
const uws = @import("uws");

pub export fn Bun__getDefaultGlobal() *JSGlobalObject {
    return JSC.VirtualMachine.vm.global;
}

pub export fn Bun__getVM() *JSC.VirtualMachine {
    return JSC.VirtualMachine.vm;
}

pub export fn Bun__drainMicrotasks() void {
    JSC.VirtualMachine.vm.eventLoop().tick();
}

export fn Bun__readOriginTimer(vm: *JSC.VirtualMachine) u64 {
    return vm.origin_timer.read();
}

export fn Bun__readOriginTimerStart(vm: *JSC.VirtualMachine) f64 {
    // timespce to milliseconds
    // use f128 to reduce precision loss when converting to f64
    return @floatCast(f64, (@intToFloat(f128, vm.origin_timestamp) + JSC.VirtualMachine.origin_relative_epoch) / 1_000_000.0);
}

comptime {
    if (!JSC.is_bindgen) {
        _ = Bun__getDefaultGlobal;
        _ = Bun__getVM;
        _ = Bun__drainMicrotasks;
        _ = Bun__queueTask;
        _ = Bun__queueTaskConcurrently;
        _ = Bun__handleRejectedPromise;
        _ = Bun__readOriginTimer;
        _ = Bun__onDidAppendPlugin;
        _ = Bun__readOriginTimerStart;
    }
}

/// This function is called on the main thread
/// The bunVM() call will assert this
pub export fn Bun__queueTask(global: *JSGlobalObject, task: *JSC.CppTask) void {
    global.bunVM().eventLoop().enqueueTask(Task.init(task));
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
    global.bunVM().runErrorHandler(result, null);
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
    process: js.JSObjectRef = null,
    blobs: ?*Blob.Group = null,
    flush_list: std.ArrayList(string),
    entry_point: ServerEntryPoint = undefined,
    origin: URL = URL{},
    node_fs: ?*Node.NodeFS = null,
    has_loaded_node_modules: bool = false,
    timer: Bun.Timer = Bun.Timer{},
    uws_event_loop: ?*uws.Loop = null,

    is_printing_plugin: bool = false,

    plugin_runner: ?PluginRunner = null,
    is_main_thread: bool = false,

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
    poller: JSC.Poller = JSC.Poller{},
    us_loop_reference_count: usize = 0,
    is_us_loop_entered: bool = false,
    pending_internal_promise: *JSC.JSInternalPromise = undefined,
    auto_install_dependencies: bool = false,
    load_builtins_from_path: []const u8 = "",

    pub threadlocal var is_main_thread_vm: bool = false;

    pub fn reload(this: *VirtualMachine) void {
        Output.debug("Reloading...", .{});
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

    pub inline fn enqueueTaskConcurrent(this: *VirtualMachine, task: JSC.ConcurrentTask) void {
        this.eventLoop().enqueueTaskConcurrent(task);
    }

    pub fn tick(this: *VirtualMachine) void {
        this.eventLoop().tick();
    }

    pub fn waitForPromise(this: *VirtualMachine, promise: *JSC.JSInternalPromise) void {
        this.eventLoop().waitForPromise(promise);
    }

    pub fn waitForTasks(this: *VirtualMachine) void {
        this.eventLoop().waitForTasks();
    }

    pub const MacroMap = std.AutoArrayHashMap(i32, js.JSObjectRef);

    /// Threadlocals are slow on macOS
    pub threadlocal var vm_loaded = false;

    /// Threadlocals are slow on macOS
    /// Consider using `globalThis.bunVM()` instead.
    /// There may be a time where we run multiple VMs in the same thread
    /// At that point, this threadlocal will be a problem.
    pub threadlocal var vm: *VirtualMachine = undefined;

    pub fn enableMacroMode(this: *VirtualMachine) void {
        if (!this.has_enabled_macro_mode) {
            this.has_enabled_macro_mode = true;
            this.macro_event_loop.tasks = EventLoop.Queue.init(default_allocator);
            this.macro_event_loop.tasks.ensureTotalCapacity(16) catch unreachable;
            this.macro_event_loop.global = this.global;
            this.macro_event_loop.virtual_machine = this;
            this.macro_event_loop.concurrent_tasks = .{};
        }

        this.bundler.options.platform = .bun_macro;
        this.bundler.resolver.caches.fs.use_alternate_source_cache = true;
        this.macro_mode = true;
        this.event_loop = &this.macro_event_loop;
        Analytics.Features.macros = true;
    }

    pub fn disableMacroMode(this: *VirtualMachine) void {
        this.bundler.options.platform = .bun;
        this.bundler.resolver.caches.fs.use_alternate_source_cache = false;
        this.macro_mode = false;
        this.event_loop = &this.regular_event_loop;
    }

    pub fn getAPIGlobals() []js.JSClassRef {
        if (is_bindgen)
            return &[_]js.JSClassRef{};
        var classes = default_allocator.alloc(js.JSClassRef, GlobalClasses.len) catch return &[_]js.JSClassRef{};
        inline for (GlobalClasses) |Class, i| {
            classes[i] = Class.get().*;
        }

        return classes;
    }

    pub fn getAPIConstructors(globalObject: *JSGlobalObject) []const JSC.JSValue {
        if (is_bindgen)
            return &[_]JSC.JSValue{};
        const is_first = !VirtualMachine.vm.has_loaded_constructors;
        if (is_first) {
            VirtualMachine.vm.global = globalObject;
            VirtualMachine.vm.has_loaded_constructors = true;
        }

        var slice = if (is_first)
            @as([]JSC.JSValue, &JSC.VirtualMachine.vm.global_api_constructors)
        else
            VirtualMachine.vm.allocator.alloc(JSC.JSValue, GlobalConstructors.len) catch unreachable;

        inline for (GlobalConstructors) |Class, i| {
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
                @maximum(
                    std.time.nanoTimestamp(),
                    origin_relative_epoch,
                ),
            ) - origin_relative_epoch,
        );
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

        VirtualMachine.vm = try allocator.create(VirtualMachine);
        var console = try allocator.create(ZigConsoleClient);
        console.* = ZigConsoleClient.init(Output.errorWriter(), Output.writer());
        const bundler = try Bundler.init(
            allocator,
            log,
            try Config.configureTransformOptionsForBunVM(allocator, _args),
            existing_bundle,
            env_loader,
        );

        VirtualMachine.vm.* = VirtualMachine{
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
            .macro_entry_points = @TypeOf(VirtualMachine.vm.macro_entry_points).init(allocator),
            .origin_timer = std.time.Timer.start() catch @panic("Please don't mess with timers."),
            .origin_timestamp = getOriginTimestamp(),
            .ref_strings = JSC.RefString.Map.init(allocator),
            .file_blobs = JSC.WebCore.Blob.Store.Map.init(allocator),
        };
        VirtualMachine.vm.source_mappings = .{ .map = &VirtualMachine.vm.saved_source_map_table };
        VirtualMachine.vm.regular_event_loop.tasks = EventLoop.Queue.init(
            default_allocator,
        );
        VirtualMachine.vm.regular_event_loop.tasks.ensureUnusedCapacity(64) catch unreachable;
        VirtualMachine.vm.regular_event_loop.concurrent_tasks = .{};
        VirtualMachine.vm.event_loop = &VirtualMachine.vm.regular_event_loop;

        vm.bundler.macro_context = null;

        VirtualMachine.vm.bundler.configureLinker();
        try VirtualMachine.vm.bundler.configureFramework(false);

        vm.bundler.macro_context = js_ast.Macro.MacroContext.init(&vm.bundler);

        if (_args.serve orelse false) {
            VirtualMachine.vm.bundler.linker.onImportCSS = Bun.onImportCSS;
        }

        var global_classes: [GlobalClasses.len]js.JSClassRef = undefined;
        inline for (GlobalClasses) |Class, i| {
            global_classes[i] = Class.get().*;
        }
        VirtualMachine.vm.global = ZigGlobalObject.create(
            &global_classes,
            @intCast(i32, global_classes.len),
            vm.console,
        );
        VirtualMachine.vm.regular_event_loop.global = VirtualMachine.vm.global;
        VirtualMachine.vm.regular_event_loop.virtual_machine = VirtualMachine.vm;
        VirtualMachine.vm_loaded = true;

        if (source_code_printer == null) {
            var writer = try js_printer.BufferWriter.init(allocator);
            source_code_printer = allocator.create(js_printer.BufferPrinter) catch unreachable;
            source_code_printer.?.* = js_printer.BufferPrinter.init(writer);
            source_code_printer.?.ctx.append_null_byte = false;
        }

        return VirtualMachine.vm;
    }

    // dynamic import
    // pub fn import(global: *JSGlobalObject, specifier: ZigString, source: ZigString) callconv(.C) ErrorableZigString {

    // }

    pub threadlocal var source_code_printer: ?*js_printer.BufferPrinter = null;

    pub fn clearRefString(_: *anyopaque, ref_string: *JSC.RefString) void {
        _ = VirtualMachine.vm.ref_strings.remove(ref_string.hash);
    }

    pub fn getFileBlob(this: *VirtualMachine, pathlike: JSC.Node.PathOrFileDescriptor) ?*JSC.WebCore.Blob.Store {
        const hash = pathlike.hash();
        return this.file_blobs.get(hash);
    }

    pub fn putFileBlob(this: *VirtualMachine, pathlike: JSC.Node.PathOrFileDescriptor, store: *JSC.WebCore.Blob.Store) !void {
        const hash = pathlike.hash();
        try this.file_blobs.put(hash, store);
    }

    pub fn removeFileBlob(this: *VirtualMachine, pathlike: JSC.Node.PathOrFileDescriptor) void {
        const hash = pathlike.hash();
        _ = this.file_blobs.remove(hash);
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

    const shared_library_suffix = if (Environment.isMac) "dylib" else if (Environment.isLinux) "so" else "";

    pub fn fetchBuiltinModule(jsc_vm: *VirtualMachine, specifier: string, log: *logger.Log, comptime disable_transpilying: bool) !?ResolvedSource {
        if (jsc_vm.node_modules != null and strings.eqlComptime(specifier, bun_file_import_path)) {
            // We kind of need an abstraction around this.
            // Basically we should subclass JSC::SourceCode with:
            // - hash
            // - file descriptor for source input
            // - file path + file descriptor for bytecode caching
            // - separate bundles for server build vs browser build OR at least separate sections
            const code = try jsc_vm.node_modules.?.readCodeAsStringSlow(jsc_vm.allocator);

            return ResolvedSource{
                .allocator = null,
                .source_code = ZigString.init(code),
                .specifier = ZigString.init(bun_file_import_path),
                .source_url = ZigString.init(bun_file_import_path[1..]),
                .hash = 0, // TODO
            };
        } else if (jsc_vm.node_modules == null and strings.eqlComptime(specifier, Runtime.Runtime.Imports.Name)) {
            return ResolvedSource{
                .allocator = null,
                .source_code = ZigString.init(Runtime.Runtime.sourceContentBun()),
                .specifier = ZigString.init(Runtime.Runtime.Imports.Name),
                .source_url = ZigString.init(Runtime.Runtime.Imports.Name),
                .hash = Runtime.Runtime.versionHash(),
            };
        } else if (HardcodedModule.Map.get(specifier)) |hardcoded| {
            switch (hardcoded) {
                // This is all complicated because the imports have to be linked and we want to run the printer on it
                // so it consistently handles bundled imports
                // we can't take the shortcut of just directly importing the file, sadly.
                .@"bun:main" => {
                    if (comptime disable_transpilying) {
                        return ResolvedSource{
                            .allocator = null,
                            .source_code = ZigString.init(jsc_vm.entry_point.source.contents),
                            .specifier = ZigString.init(std.mem.span(main_file_name)),
                            .source_url = ZigString.init(std.mem.span(main_file_name)),
                            .hash = 0,
                        };
                    }
                    defer jsc_vm.transpiled_count += 1;

                    var bundler = &jsc_vm.bundler;
                    var old = jsc_vm.bundler.log;
                    jsc_vm.bundler.log = log;
                    jsc_vm.bundler.linker.log = log;
                    jsc_vm.bundler.resolver.log = log;
                    defer {
                        jsc_vm.bundler.log = old;
                        jsc_vm.bundler.linker.log = old;
                        jsc_vm.bundler.resolver.log = old;
                    }

                    var jsx = bundler.options.jsx;
                    jsx.parse = false;
                    var opts = js_parser.Parser.Options.init(jsx, .js);
                    opts.enable_bundling = false;
                    opts.transform_require_to_import = false;
                    opts.features.dynamic_require = true;
                    opts.can_import_from_bundle = bundler.options.node_modules_bundle != null;
                    opts.features.hot_module_reloading = false;
                    opts.features.react_fast_refresh = false;
                    opts.filepath_hash_for_hmr = 0;
                    opts.warn_about_unbundled_modules = false;
                    opts.macro_context = &jsc_vm.bundler.macro_context.?;
                    const main_ast = (bundler.resolver.caches.js.parse(jsc_vm.allocator, opts, bundler.options.define, bundler.log, &jsc_vm.entry_point.source) catch null) orelse {
                        return error.ParseError;
                    };
                    var parse_result = ParseResult{ .source = jsc_vm.entry_point.source, .ast = main_ast, .loader = .js, .input_fd = null };
                    var file_path = Fs.Path.init(bundler.fs.top_level_dir);
                    file_path.name.dir = bundler.fs.top_level_dir;
                    file_path.name.base = "bun:main";
                    try bundler.linker.link(
                        file_path,
                        &parse_result,
                        jsc_vm.origin,
                        .absolute_path,
                        false,
                        true,
                    );
                    var printer = source_code_printer.?.*;
                    var written: usize = undefined;
                    printer.ctx.reset();
                    {
                        defer source_code_printer.?.* = printer;
                        written = try jsc_vm.bundler.printWithSourceMap(
                            parse_result,
                            @TypeOf(&printer),
                            &printer,
                            .esm_ascii,
                            SavedSourceMap.SourceMapHandler.init(&jsc_vm.source_mappings),
                        );
                    }

                    if (comptime Environment.dump_source)
                        try dumpSource(main_file_name, &printer);

                    if (written == 0) {
                        return error.PrintingErrorWriteFailed;
                    }

                    return ResolvedSource{
                        .allocator = null,
                        .source_code = ZigString.init(jsc_vm.allocator.dupe(u8, printer.ctx.written) catch unreachable),
                        .specifier = ZigString.init(std.mem.span(main_file_name)),
                        .source_url = ZigString.init(std.mem.span(main_file_name)),
                        .hash = 0,
                    };
                },
                .@"bun:jsc" => {
                    return ResolvedSource{
                        .allocator = null,
                        .source_code = ZigString.init(jsModuleFromFile(jsc_vm.load_builtins_from_path, "bun-jsc.exports.js")),
                        .specifier = ZigString.init("bun:jsc"),
                        .source_url = ZigString.init("bun:jsc"),
                        .hash = 0,
                    };
                },
                .@"node:child_process" => {
                    return ResolvedSource{
                        .allocator = null,
                        .source_code = ZigString.init(jsModuleFromFile(jsc_vm.load_builtins_from_path, "child_process.exports.js")),
                        .specifier = ZigString.init("node:child_process"),
                        .source_url = ZigString.init("node:child_process"),
                        .hash = 0,
                    };
                },
                .@"node:net" => {
                    return ResolvedSource{
                        .allocator = null,
                        .source_code = ZigString.init(jsModuleFromFile(jsc_vm.load_builtins_from_path, "net.exports.js")),
                        .specifier = ZigString.init("node:net"),
                        .source_url = ZigString.init("node:net"),
                        .hash = 0,
                    };
                },
                .@"node:fs" => {
                    if (comptime Environment.isDebug) {
                        return ResolvedSource{
                            .allocator = null,
                            .source_code = ZigString.init(strings.append(bun.default_allocator, jsModuleFromFile(jsc_vm.load_builtins_from_path, "fs.exports.js"), JSC.Node.fs.constants_string) catch unreachable),
                            .specifier = ZigString.init("node:fs"),
                            .source_url = ZigString.init("node:fs"),
                            .hash = 0,
                        };
                    }
                    return ResolvedSource{
                        .allocator = null,
                        .source_code = ZigString.init(@embedFile("fs.exports.js") ++ JSC.Node.fs.constants_string),
                        .specifier = ZigString.init("node:fs"),
                        .source_url = ZigString.init("node:fs"),
                        .hash = 0,
                    };
                },
                .@"node:buffer" => return jsSyntheticModule(.@"node:buffer"),
                .@"node:string_decoder" => return jsSyntheticModule(.@"node:string_decoder"),
                .@"node:module" => return jsSyntheticModule(.@"node:module"),
                .@"node:events" => return jsSyntheticModule(.@"node:events"),
                .@"node:process" => return jsSyntheticModule(.@"node:process"),
                .@"node:tty" => return jsSyntheticModule(.@"node:tty"),
                .@"node:stream" => {
                    return ResolvedSource{
                        .allocator = null,
                        .source_code = ZigString.init(jsModuleFromFile(jsc_vm.load_builtins_from_path, "streams.exports.js")),
                        .specifier = ZigString.init("node:stream"),
                        .source_url = ZigString.init("node:stream"),
                        .hash = 0,
                    };
                },

                .@"node:fs/promises" => {
                    return ResolvedSource{
                        .allocator = null,
                        .source_code = ZigString.init(@embedFile("fs_promises.exports.js") ++ JSC.Node.fs.constants_string),
                        .specifier = ZigString.init("node:fs/promises"),
                        .source_url = ZigString.init("node:fs/promises"),
                        .hash = 0,
                    };
                },
                .@"node:path" => {
                    return ResolvedSource{
                        .allocator = null,
                        .source_code = ZigString.init(jsModuleFromFile(jsc_vm.load_builtins_from_path, "path.exports.js")),
                        .specifier = ZigString.init("node:path"),
                        .source_url = ZigString.init("node:path"),
                        .hash = 0,
                    };
                },
                .@"node:path/win32" => {
                    return ResolvedSource{
                        .allocator = null,
                        .source_code = ZigString.init(jsModuleFromFile(jsc_vm.load_builtins_from_path, "path-win32.exports.js")),
                        .specifier = ZigString.init("node:path/win32"),
                        .source_url = ZigString.init("node:path/win32"),
                        .hash = 0,
                    };
                },
                .@"node:path/posix" => {
                    return ResolvedSource{
                        .allocator = null,
                        .source_code = ZigString.init(jsModuleFromFile(jsc_vm.load_builtins_from_path, "path-posix.exports.js")),
                        .specifier = ZigString.init("node:path/posix"),
                        .source_url = ZigString.init("node:path/posix"),
                        .hash = 0,
                    };
                },

                .@"node:os" => {
                    return ResolvedSource{
                        .allocator = null,
                        .source_code = ZigString.init(jsModuleFromFile(jsc_vm.load_builtins_from_path, "os.exports.js")),
                        .specifier = ZigString.init("node:os"),
                        .source_url = ZigString.init("node:os"),
                        .hash = 0,
                    };
                },
                .@"bun:ffi" => {
                    return ResolvedSource{
                        .allocator = null,
                        .source_code = ZigString.init(
                            "export const FFIType = " ++
                                JSC.FFI.ABIType.map_to_js_object ++
                                ";\n\n" ++
                                "export const suffix = '" ++ shared_library_suffix ++ "';\n\n" ++
                                @embedFile("ffi.exports.js") ++
                                "\n",
                        ),
                        .specifier = ZigString.init("bun:ffi"),
                        .source_url = ZigString.init("bun:ffi"),
                        .hash = 0,
                    };
                },
                .@"detect-libc" => {
                    return ResolvedSource{
                        .allocator = null,
                        .source_code = ZigString.init(
                            @as(string, @embedFile(if (Environment.isLinux) "detect-libc.linux.js" else "detect-libc.js")),
                        ),
                        .specifier = ZigString.init("detect-libc"),
                        .source_url = ZigString.init("detect-libc"),
                        .hash = 0,
                    };
                },
                .@"node:url" => {
                    return ResolvedSource{
                        .allocator = null,
                        .source_code = ZigString.init(
                            @as(string, jsModuleFromFile(jsc_vm.load_builtins_from_path, "url.exports.js")),
                        ),
                        .specifier = ZigString.init("node:url"),
                        .source_url = ZigString.init("node:url"),
                        .hash = 0,
                    };
                },
                .@"node:assert" => {
                    return ResolvedSource{
                        .allocator = null,
                        .source_code = ZigString.init(
                            @as(string, jsModuleFromFile(jsc_vm.load_builtins_from_path, "assert.exports.js")),
                        ),
                        .specifier = ZigString.init("node:assert"),
                        .source_url = ZigString.init("node:assert"),
                        .hash = 0,
                    };
                },
                .@"bun:sqlite" => {
                    return ResolvedSource{
                        .allocator = null,
                        .source_code = ZigString.init(
                            @as(string, jsModuleFromFile(jsc_vm.load_builtins_from_path, "./bindings/sqlite/sqlite.exports.js")),
                        ),
                        .specifier = ZigString.init("bun:sqlite"),
                        .source_url = ZigString.init("bun:sqlite"),
                        .hash = 0,
                    };
                },
                .@"node:perf_hooks" => {
                    return ResolvedSource{
                        .allocator = null,
                        .source_code = ZigString.init(
                            @as(string, jsModuleFromFile(jsc_vm.load_builtins_from_path, "./perf_hooks.exports.js")),
                        ),
                        .specifier = ZigString.init("node:perf_hooks"),
                        .source_url = ZigString.init("node:perf_hooks"),
                        .hash = 0,
                    };
                },
                .@"ws" => {
                    return ResolvedSource{
                        .allocator = null,
                        .source_code = ZigString.init(
                            @as(string, jsModuleFromFile(jsc_vm.load_builtins_from_path, "./ws.exports.js")),
                        ),
                        .specifier = ZigString.init("ws"),
                        .source_url = ZigString.init("ws"),
                        .hash = 0,
                    };
                },
                .@"node:timers" => {
                    return ResolvedSource{
                        .allocator = null,
                        .source_code = ZigString.init(
                            @as(string, jsModuleFromFile(jsc_vm.load_builtins_from_path, "./node_timers.exports.js")),
                        ),
                        .specifier = ZigString.init("node:timers"),
                        .source_url = ZigString.init("node:timers"),
                        .hash = 0,
                    };
                },
                .@"node:timers/promises" => {
                    return ResolvedSource{
                        .allocator = null,
                        .source_code = ZigString.init(
                            @as(string, jsModuleFromFile(jsc_vm.load_builtins_from_path, "./node_timers_promises.exports.js")),
                        ),
                        .specifier = ZigString.init("node:timers/promises"),
                        .source_url = ZigString.init("node:timers/promises"),
                        .hash = 0,
                    };
                },
                .@"node:stream/web" => {
                    return ResolvedSource{
                        .allocator = null,
                        .source_code = ZigString.init(
                            @as(string, jsModuleFromFile(jsc_vm.load_builtins_from_path, "./node_streams_web.exports.js")),
                        ),
                        .specifier = ZigString.init("node:stream/web"),
                        .source_url = ZigString.init("node:stream/web"),
                        .hash = 0,
                    };
                },
                .@"node:stream/consumer" => {
                    return ResolvedSource{
                        .allocator = null,
                        .source_code = ZigString.init(
                            @as(string, jsModuleFromFile(jsc_vm.load_builtins_from_path, "./node_streams_consumer.exports.js")),
                        ),
                        .specifier = ZigString.init("node:stream/consumer"),
                        .source_url = ZigString.init("node:stream/consumer"),
                        .hash = 0,
                    };
                },
                .@"undici" => {
                    return ResolvedSource{
                        .allocator = null,
                        .source_code = ZigString.init(
                            @as(string, jsModuleFromFile(jsc_vm.load_builtins_from_path, "./undici.exports.js")),
                        ),
                        .specifier = ZigString.init("undici"),
                        .source_url = ZigString.init("undici"),
                        .hash = 0,
                    };
                },
                .@"node:http" => {
                    return ResolvedSource{
                        .allocator = null,
                        .source_code = ZigString.init(
                            @as(string, jsModuleFromFile(jsc_vm.load_builtins_from_path, "./http.exports.js")),
                        ),
                        .specifier = ZigString.init("node:http"),
                        .source_url = ZigString.init("node:http"),
                        .hash = 0,
                    };
                },
                .@"node:https" => {
                    return ResolvedSource{
                        .allocator = null,
                        .source_code = ZigString.init(
                            @as(string, jsModuleFromFile(jsc_vm.load_builtins_from_path, "./https.exports.js")),
                        ),
                        .specifier = ZigString.init("node:https"),
                        .source_url = ZigString.init("node:https"),
                        .hash = 0,
                    };
                },
                .@"depd" => {
                    return ResolvedSource{
                        .allocator = null,
                        .source_code = ZigString.init(
                            @as(string, jsModuleFromFile(jsc_vm.load_builtins_from_path, "./depd.exports.js")),
                        ),
                        .specifier = ZigString.init("depd"),
                        .source_url = ZigString.init("depd"),
                        .hash = 0,
                    };
                },
            }
        } else if (specifier.len > js_ast.Macro.namespaceWithColon.len and
            strings.eqlComptimeIgnoreLen(specifier[0..js_ast.Macro.namespaceWithColon.len], js_ast.Macro.namespaceWithColon))
        {
            if (jsc_vm.macro_entry_points.get(MacroEntryPoint.generateIDFromSpecifier(specifier))) |entry| {
                return ResolvedSource{
                    .allocator = null,
                    .source_code = ZigString.init(entry.source.contents),
                    .specifier = ZigString.init(specifier),
                    .source_url = ZigString.init(specifier),
                    .hash = 0,
                };
            }
        }

        return null;
    }

    pub fn fetchWithoutOnLoadPlugins(
        jsc_vm: *VirtualMachine,
        _specifier: string,
        log: *logger.Log,
        ret: *ErrorableResolvedSource,
        comptime flags: FetchFlags,
    ) !ResolvedSource {
        std.debug.assert(VirtualMachine.vm_loaded);

        if (try fetchBuiltinModule(jsc_vm, _specifier, log, comptime flags.disableTranspiling())) |builtin| {
            return builtin;
        }

        var specifier = ModuleLoader.normalizeSpecifier(jsc_vm, _specifier);
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
            path,
            loader,
            log,
            null,
            ret,
            VirtualMachine.source_code_printer.?,
            flags,
        );
    }

    pub const ResolveFunctionResult = struct {
        result: ?Resolver.Result,
        path: string,
    };

    fn _resolve(
        ret: *ResolveFunctionResult,
        _: *JSGlobalObject,
        specifier: string,
        source: string,
        comptime is_a_file_path: bool,
        comptime realpath: bool,
    ) !void {
        std.debug.assert(VirtualMachine.vm_loaded);
        // macOS threadlocal vars are very slow
        // we won't change threads in this function
        // so we can copy it here
        var jsc_vm = vm;

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
        } else if (specifier.len > js_ast.Macro.namespaceWithColon.len and strings.eqlComptimeIgnoreLen(specifier[0..js_ast.Macro.namespaceWithColon.len], js_ast.Macro.namespaceWithColon)) {
            ret.result = null;
            ret.path = specifier;
            return;
        } else if (specifier.len > "/bun-vfs/node_modules/".len and strings.eqlComptimeIgnoreLen(specifier[0.."/bun-vfs/node_modules/".len], "/bun-vfs/node_modules/")) {
            ret.result = null;
            ret.path = specifier;
            return;
        } else if (HardcodedModule.Map.get(specifier)) |result| {
            ret.result = null;
            ret.path = @as(string, @tagName(result));
            return;
        }

        const is_special_source = strings.eqlComptime(source, main_file_name) or js_ast.Macro.isMacroPath(source);

        const result = try jsc_vm.bundler.resolver.resolve(
            if (!is_special_source)
                if (is_a_file_path)
                    Fs.PathName.init(source).dirWithTrailingSlash()
                else
                    source
            else
                jsc_vm.bundler.fs.top_level_dir,
            // TODO: do we need to handle things like query string params?
            if (strings.hasPrefixComptime(specifier, "file://")) specifier["file://".len..] else specifier,
            .stmt,
        );

        if (!jsc_vm.macro_mode) {
            jsc_vm.has_any_macro_remappings = jsc_vm.has_any_macro_remappings or jsc_vm.bundler.options.macro_remap.count() > 0;
        }
        ret.result = result;
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
            std.debug.assert(VirtualMachine.vm_loaded);

        var vm_ = globalObject.bunVM();
        if (vm_.global == globalObject) {
            vm_.enqueueTask(Task.init(@ptrCast(*JSC.MicrotaskForDefaultGlobalObject, microtask)));
        } else {
            vm_.enqueueTask(Task.init(microtask));
        }
    }

    pub fn resolveForAPI(res: *ErrorableZigString, global: *JSGlobalObject, specifier: ZigString, source: ZigString) void {
        resolveMaybeNeedsTrailingSlash(res, global, specifier, source, false, true);
    }

    pub fn resolveFilePathForAPI(res: *ErrorableZigString, global: *JSGlobalObject, specifier: ZigString, source: ZigString) void {
        resolveMaybeNeedsTrailingSlash(res, global, specifier, source, true, true);
    }

    pub fn resolve(res: *ErrorableZigString, global: *JSGlobalObject, specifier: ZigString, source: ZigString) void {
        resolveMaybeNeedsTrailingSlash(res, global, specifier, source, true, false);
    }

    pub fn resolveMaybeNeedsTrailingSlash(res: *ErrorableZigString, global: *JSGlobalObject, specifier: ZigString, source: ZigString, comptime is_a_file_path: bool, comptime realpath: bool) void {
        var result = ResolveFunctionResult{ .path = "", .result = null };
        var jsc_vm = vm;
        if (jsc_vm.plugin_runner) |plugin_runner| {
            if (PluginRunner.couldBePlugin(specifier.slice())) {
                const namespace = PluginRunner.extractNamespace(specifier.slice());
                const after_namespace = if (namespace.len == 0)
                    specifier
                else
                    specifier.substring(namespace.len + 1);

                if (plugin_runner.onResolveJSC(ZigString.init(namespace), after_namespace, source, .bun)) |resolved_path| {
                    res.* = resolved_path;
                    return;
                }
            }
        }

        if (HardcodedModule.Aliases.getWithEql(specifier, ZigString.eqlComptime)) |hardcoded| {
            res.* = ErrorableZigString.ok(ZigString.init(hardcoded));
            return;
        }

        _resolve(&result, global, specifier.slice(), source.slice(), is_a_file_path, realpath) catch |err| {
            // This should almost always just apply to dynamic imports

            const printed = ResolveError.fmt(
                jsc_vm.allocator,
                specifier.slice(),
                source.slice(),
                err,
            ) catch unreachable;
            const msg = logger.Msg{
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

            {
                res.* = ErrorableZigString.err(err, @ptrCast(*anyopaque, ResolveError.create(global, vm.allocator, msg, source.slice())));
            }

            return;
        };

        res.* = ErrorableZigString.ok(ZigString.init(result.path));
    }

    // // This double prints
    // pub fn promiseRejectionTracker(global: *JSGlobalObject, promise: *JSPromise, _: JSPromiseRejectionOperation) callconv(.C) JSValue {
    //     const result = promise.result(global.vm());
    //     if (@enumToInt(VirtualMachine.vm.last_error_jsvalue) != @enumToInt(result)) {
    //         VirtualMachine.vm.runErrorHandler(result, null);
    //     }

    //     return JSValue.jsUndefined();
    // }

    const main_file_name: string = "bun:main";

    pub fn fetch(ret: *ErrorableResolvedSource, global: *JSGlobalObject, specifier: ZigString, source: ZigString) callconv(.C) void {
        var log = logger.Log.init(vm.bundler.allocator);
        const spec = specifier.slice();
        // threadlocal is cheaper in linux
        var jsc_vm: *VirtualMachine = if (comptime Environment.isLinux)
            vm
        else
            global.bunVM();

        const result = if (!jsc_vm.bundler.options.disable_transpilation)
            @call(.{ .modifier = .always_inline }, fetchWithoutOnLoadPlugins, .{ jsc_vm, spec, &log, ret, .transpile }) catch |err| {
                processFetchLog(global, specifier, source, &log, ret, err);
                return;
            }
        else
            fetchWithoutOnLoadPlugins(jsc_vm, spec, &log, ret, .print_source_and_clone) catch |err| {
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

        if (vm.blobs) |blobs| {
            const specifier_blob = brk: {
                if (strings.hasPrefix(spec, VirtualMachine.vm.bundler.fs.top_level_dir)) {
                    break :brk spec[VirtualMachine.vm.bundler.fs.top_level_dir.len..];
                }
                break :brk spec;
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
                const msg = logger.Msg{
                    .data = logger.rangeData(null, logger.Range.None, std.fmt.allocPrint(vm.allocator, "{s} while building {s}", .{ @errorName(err), specifier.slice() }) catch unreachable),
                };
                {
                    ret.* = ErrorableResolvedSource.err(err, @ptrCast(*anyopaque, BuildError.create(globalThis, vm.bundler.allocator, msg)));
                }
                return;
            },

            1 => {
                const msg = log.msgs.items[0];
                ret.* = ErrorableResolvedSource.err(err, switch (msg.metadata) {
                    .build => BuildError.create(globalThis, vm.bundler.allocator, msg).?,
                    .resolve => ResolveError.create(
                        globalThis,
                        vm.bundler.allocator,
                        msg,
                        referrer.slice(),
                    ).?,
                });
                return;
            },
            else => {
                var errors_stack: [256]*anyopaque = undefined;

                var errors = errors_stack[0..@minimum(log.msgs.items.len, errors_stack.len)];

                for (log.msgs.items) |msg, i| {
                    errors[i] = switch (msg.metadata) {
                        .build => BuildError.create(globalThis, vm.bundler.allocator, msg).?,
                        .resolve => ResolveError.create(
                            globalThis,
                            vm.bundler.allocator,
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
                            std.fmt.allocPrint(vm.bundler.allocator, "{d} errors building \"{s}\"", .{
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

    pub fn runErrorHandler(this: *VirtualMachine, result: JSValue, exception_list: ?*ExceptionList) void {
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
        try this.entry_point.generate(this.bun_watcher != null, Fs.PathName.init(entry_path), main_file_name);
        this.eventLoop().ensureWaker();

        var promise: *JSInternalPromise = undefined;

        if (!this.bundler.options.disable_transpilation) {

            // We first import the node_modules bundle. This prevents any potential TDZ issues.
            // The contents of the node_modules bundle are lazy, so hopefully this should be pretty quick.
            if (this.node_modules != null and !this.has_loaded_node_modules) {
                this.has_loaded_node_modules = true;
                promise = JSModuleLoader.loadAndEvaluateModule(this.global, ZigString.static(bun_file_import_path));
                this.waitForPromise(promise);
                if (promise.status(this.global.vm()) == .Rejected)
                    return promise;
            }

            promise = JSModuleLoader.loadAndEvaluateModule(this.global, &ZigString.init(std.mem.span(main_file_name)));
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
            this.waitForPromise(promise);
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
            this.promise = vm._loadMacroEntryPoint(this.path);
        }
    };

    pub inline fn _loadMacroEntryPoint(this: *VirtualMachine, entry_path: string) *JSInternalPromise {
        var promise: *JSInternalPromise = undefined;

        promise = JSModuleLoader.loadAndEvaluateModule(this.global, &ZigString.init(entry_path));
        this.waitForPromise(promise);

        return promise;
    }

    // When the Error-like object is one of our own, it's best to rely on the object directly instead of serializing it to a ZigException.
    // This is for:
    // - BuildError
    // - ResolveError
    // If there were multiple errors, it could be contained in an AggregateError.
    // In that case, this function becomes recursive.
    // In all other cases, we will convert it to a ZigException.
    const errors_property = ZigString.init("errors");
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
                    VirtualMachine.vm.printErrorlikeObject(nextValue, null, this_.current_exception_list, Writer, this_.writer, color);
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

    pub fn reportUncaughtExceptio(_: *JSGlobalObject, exception: *JSC.Exception) JSValue {
        VirtualMachine.vm.runErrorHandler(exception.value(), null);
        return JSC.JSValue.jsUndefined();
    }

    pub fn printStackTrace(comptime Writer: type, writer: Writer, trace: ZigStackTrace, comptime allow_ansi_colors: bool) !void {
        const stack = trace.frames();
        if (stack.len > 0) {
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
        if (frames.len == 0) return;

        var top = &frames[0];
        if (this.source_mappings.resolveMapping(
            top.source_url.slice(),
            @maximum(top.position.line, 0),
            @maximum(top.position.column_start, 0),
        )) |mapping| {
            var log = logger.Log.init(default_allocator);
            var errorable: ErrorableResolvedSource = undefined;
            var original_source = fetchWithoutOnLoadPlugins(this, top.source_url.slice(), &log, &errorable, .print_source) catch return;
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

                var lines_ = lines[0..@minimum(lines.len, source_lines.len)];
                for (lines_) |line, j| {
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
                    @maximum(frame.position.line, 0),
                    @maximum(frame.position.column_start, 0),
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
        for (line_numbers) |line| max_line = @maximum(max_line, line);
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
        if (source_lines.next()) |source| {
            if (source.text.len > 0 and exception.stack.frames()[0].position.isInvalid()) {
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
            } else if (source.text.len > 0) {
                defer did_print_name = true;
                const int_size = std.fmt.count("{d}", .{source.line});
                const pad = max_line_number_pad - int_size;
                try writer.writeByteNTimes(' ', pad);
                const top = exception.stack.frames()[0];
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

        if (show.path) {
            if (show.syscall) {
                try writer.writeAll("  ");
            } else if (show.errno) {
                try writer.writeAll(" ");
            }
            try writer.print(comptime Output.prettyFmt(" path<d>: <r><cyan>\"{s}\"<r>\n", allow_ansi_color), .{exception.path});
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

    pub fn emitFetchEvent(
        vm: *VirtualMachine,
        request_context: *http.RequestContext,
        comptime CtxType: type,
        ctx: *CtxType,
        comptime onError: fn (ctx: *CtxType, err: anyerror, value: JSValue, request_ctx: *http.RequestContext) anyerror!void,
    ) !void {
        if (comptime JSC.is_bindgen) unreachable;

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

            vm.event_loop.waitForPromise(promise);

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
                if (Resolver.isPackagePath(specifier)) {
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
            .convertToType = .{ .rfn = convertToType },
        },
        .{
            .@"referrer" = .{
                .@"get" = getReferrer,
                .ro = true,
            },
            .@"code" = .{
                .@"get" = getCode,
                .ro = true,
            },
            .@"message" = .{
                .@"get" = getMessage,
                .ro = true,
            },
            .@"name" = .{
                .@"get" = getName,
                .ro = true,
            },
            .@"specifier" = .{
                .@"get" = getSpecifier,
                .ro = true,
            },
            .@"importKind" = .{
                .@"get" = getImportKind,
                .ro = true,
            },
            .@"position" = .{
                .@"get" = getPosition,
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

pub const HardcodedModule = enum {
    @"bun:ffi",
    @"bun:jsc",
    @"bun:main",
    @"bun:sqlite",
    @"depd",
    @"detect-libc",
    @"node:assert",
    @"node:buffer",
    @"node:child_process",
    @"node:events",
    @"node:fs",
    @"node:fs/promises",
    @"node:http",
    @"node:https",
    @"node:module",
    @"node:net",
    @"node:os",
    @"node:path",
    @"node:path/posix",
    @"node:path/win32",
    @"node:perf_hooks",
    @"node:process",
    @"node:stream",
    @"node:stream/consumer",
    @"node:stream/web",
    @"node:string_decoder",
    @"node:timers",
    @"node:timers/promises",
    @"node:tty",
    @"node:url",
    @"undici",
    @"ws",
    /// Already resolved modules go in here.
    /// This does not remap the module name, it is just a hash table.
    /// Do not put modules that have aliases in here
    /// Put those in Aliases
    pub const Map = bun.ComptimeStringMap(
        HardcodedModule,
        .{
            .{ "buffer", HardcodedModule.@"node:buffer" },
            .{ "bun:ffi", HardcodedModule.@"bun:ffi" },
            .{ "bun:jsc", HardcodedModule.@"bun:jsc" },
            .{ "bun:main", HardcodedModule.@"bun:main" },
            .{ "bun:sqlite", HardcodedModule.@"bun:sqlite" },
            .{ "depd", HardcodedModule.@"depd" },
            .{ "detect-libc", HardcodedModule.@"detect-libc" },
            .{ "node:assert", HardcodedModule.@"node:assert" },
            .{ "node:buffer", HardcodedModule.@"node:buffer" },
            .{ "node:child_process", HardcodedModule.@"node:child_process" },
            .{ "node:events", HardcodedModule.@"node:events" },
            .{ "node:fs", HardcodedModule.@"node:fs" },
            .{ "node:fs/promises", HardcodedModule.@"node:fs/promises" },
            .{ "node:http", HardcodedModule.@"node:http" },
            .{ "node:https", HardcodedModule.@"node:https" },
            .{ "node:module", HardcodedModule.@"node:module" },
            .{ "node:net", HardcodedModule.@"node:net" },
            .{ "node:os", HardcodedModule.@"node:os" },
            .{ "node:path", HardcodedModule.@"node:path" },
            .{ "node:path/posix", HardcodedModule.@"node:path/posix" },
            .{ "node:path/win32", HardcodedModule.@"node:path/win32" },
            .{ "node:perf_hooks", HardcodedModule.@"node:perf_hooks" },
            .{ "node:process", HardcodedModule.@"node:process" },
            .{ "node:stream", HardcodedModule.@"node:stream" },
            .{ "node:stream/consumer", HardcodedModule.@"node:stream/consumer" },
            .{ "node:stream/web", HardcodedModule.@"node:stream/web" },
            .{ "node:string_decoder", HardcodedModule.@"node:string_decoder" },
            .{ "node:timers", HardcodedModule.@"node:timers" },
            .{ "node:timers/promises", HardcodedModule.@"node:timers/promises" },
            .{ "node:tty", HardcodedModule.@"node:tty" },
            .{ "node:url", HardcodedModule.@"node:url" },
            .{ "undici", HardcodedModule.@"undici" },
            .{ "ws", HardcodedModule.@"ws" },
        },
    );
    pub const Aliases = bun.ComptimeStringMap(
        string,
        .{
            .{ "assert", "node:assert" },
            .{ "buffer", "node:buffer" },
            .{ "bun", "bun" },
            .{ "bun:ffi", "bun:ffi" },
            .{ "bun:jsc", "bun:jsc" },
            .{ "bun:sqlite", "bun:sqlite" },
            .{ "bun:wrap", "bun:wrap" },
            .{ "child_process", "node:child_process" },
            .{ "depd", "depd" },
            .{ "detect-libc", "detect-libc" },
            .{ "detect-libc/lib/detect-libc.js", "detect-libc" },
            .{ "events", "node:events" },
            .{ "ffi", "bun:ffi" },
            .{ "fs", "node:fs" },
            .{ "fs/promises", "node:fs/promises" },
            .{ "http", "node:http" },
            .{ "https", "node:https" },
            .{ "module", "node:module" },
            .{ "net", "node:net" },
            .{ "node:assert", "node:assert" },
            .{ "node:buffer", "node:buffer" },
            .{ "node:child_process", "node:child_process" },
            .{ "node:events", "node:events" },
            .{ "node:fs", "node:fs" },
            .{ "node:fs/promises", "node:fs/promises" },
            .{ "node:http", "node:http" },
            .{ "node:https", "node:https" },
            .{ "node:module", "node:module" },
            .{ "node:net", "node:net" },
            .{ "node:os", "node:os" },
            .{ "node:path", "node:path" },
            .{ "node:path/posix", "node:path/posix" },
            .{ "node:path/win32", "node:path/win32" },
            .{ "node:perf_hooks", "node:perf_hooks" },
            .{ "node:process", "node:process" },
            .{ "node:stream", "node:stream" },
            .{ "node:stream/consumer", "node:stream/consumer" },
            .{ "node:stream/web", "node:stream/web" },
            .{ "node:string_decoder", "node:string_decoder" },
            .{ "node:timers", "node:timers" },
            .{ "node:timers/promises", "node:timers/promises" },
            .{ "node:tty", "node:tty" },
            .{ "node:url", "node:url" },
            .{ "os", "node:os" },
            .{ "path", "node:path" },
            .{ "path/posix", "node:path/posix" },
            .{ "path/win32", "node:path/win32" },
            .{ "perf_hooks", "node:perf_hooks" },
            .{ "process", "node:process" },
            .{ "stream", "node:stream" },
            .{ "stream/consumer", "node:stream/consumer" },
            .{ "stream/web", "node:stream/web" },
            .{ "string_decoder", "node:string_decoder" },
            .{ "timers", "node:timers" },
            .{ "timers/promises", "node:timers/promises" },
            .{ "tty", "node:tty" },
            .{ "undici", "undici" },
            .{ "url", "node:url" },
            .{ "ws", "ws" },
            .{ "ws/lib/websocket", "ws" },
        },
    );
};

pub const DisabledModule = bun.ComptimeStringMap(
    void,
    .{
        .{"node:tls"},
        .{"node:worker_threads"},
        .{"tls"},
        .{"worker_threads"},
    },
);

// This exists to make it so we can reload these quicker in development
fn jsModuleFromFile(from_path: string, comptime input: string) string {
    const absolute_path = comptime std.fs.path.dirname(@src().file).? ++ "/" ++ input;
    const Holder = struct {
        pub const file = @embedFile(absolute_path);
    };

    if (comptime !Environment.allow_assert) {
        if (from_path.len == 0) {
            return Holder.file;
        }
    }

    var file: std.fs.File = undefined;

    if (comptime Environment.allow_assert) {
        file = std.fs.openFileAbsoluteZ(absolute_path, .{ .mode = .read_only }) catch {
            const WarnOnce = struct {
                pub var warned = false;
            };
            if (!WarnOnce.warned) {
                WarnOnce.warned = true;
                Output.prettyErrorln("Could not find file: " ++ absolute_path ++ " - using embedded version", .{});
            }
            return Holder.file;
        };
    } else {
        var parts = [_]string{ from_path, input };
        var buf: [bun.MAX_PATH_BYTES]u8 = undefined;
        var absolute_path_to_use = Fs.FileSystem.instance.absBuf(&parts, &buf);
        buf[absolute_path_to_use.len] = 0;
        file = std.fs.openFileAbsoluteZ(std.meta.assumeSentinel(absolute_path_to_use.ptr, 0), .{ .mode = .read_only }) catch {
            const WarnOnce = struct {
                pub var warned = false;
            };
            if (!WarnOnce.warned) {
                WarnOnce.warned = true;
                Output.prettyErrorln("Could not find file: {s}, so using embedded version", .{absolute_path_to_use});
            }
            return Holder.file;
        };
    }

    var contents = file.readToEndAlloc(bun.default_allocator, std.math.maxInt(usize)) catch @panic("Cannot read file: " ++ absolute_path);
    if (comptime !Environment.allow_assert) {
        file.close();
    }
    return contents;
}

inline fn jsSyntheticModule(comptime name: ResolvedSource.Tag) ResolvedSource {
    return ResolvedSource{
        .allocator = null,
        .source_code = ZigString.init(""),
        .specifier = ZigString.init(@tagName(name)),
        .source_url = ZigString.init(@tagName(name)),
        .hash = 0,
        .tag = name,
    };
}

fn dumpSource(specifier: string, printer: anytype) !void {
    const BunDebugHolder = struct {
        pub var dir: ?std.fs.Dir = null;
    };
    if (BunDebugHolder.dir == null) {
        BunDebugHolder.dir = try std.fs.cwd().makeOpenPath("/tmp/bun-debug-src/", .{ .iterate = true });
    }

    if (std.fs.path.dirname(specifier)) |dir_path| {
        var parent = try BunDebugHolder.dir.?.makeOpenPath(dir_path[1..], .{ .iterate = true });
        defer parent.close();
        try parent.writeFile(std.fs.path.basename(specifier), printer.ctx.getWritten());
    } else {
        try BunDebugHolder.dir.?.writeFile(std.fs.path.basename(specifier), printer.ctx.getWritten());
    }
}

pub const ModuleLoader = struct {
    pub export fn Bun__getDefaultLoader(global: *JSC.JSGlobalObject, str: *ZigString) Api.Loader {
        var jsc_vm = global.bunVM();
        const filename = str.toSlice(jsc_vm.allocator);
        defer filename.deinit();
        const loader = jsc_vm.bundler.options.loader(Fs.PathName.init(filename.slice()).ext).toAPI();
        if (loader == .file) {
            return Api.Loader.js;
        }

        return loader;
    }
    pub fn transpileSourceCode(
        jsc_vm: *VirtualMachine,
        specifier: string,
        path: Fs.Path,
        loader: options.Loader,
        log: *logger.Log,
        virtual_source: ?*const logger.Source,
        ret: *ErrorableResolvedSource,
        source_code_printer: *js_printer.BufferPrinter,
        comptime flags: FetchFlags,
    ) !ResolvedSource {
        const disable_transpilying = comptime flags.disableTranspiling();

        switch (loader) {
            .js, .jsx, .ts, .tsx, .json, .toml => {
                jsc_vm.transpiled_count += 1;
                jsc_vm.bundler.resetStore();
                const hash = http.Watcher.getHash(path.text);

                var allocator = if (jsc_vm.has_loaded) jsc_vm.arena.allocator() else jsc_vm.allocator;

                var fd: ?StoredFileDescriptorType = null;
                var package_json: ?*PackageJSON = null;

                if (jsc_vm.bun_dev_watcher) |watcher| {
                    if (watcher.indexOf(hash)) |index| {
                        const _fd = watcher.watchlist.items(.fd)[index];
                        fd = if (_fd > 0) _fd else null;
                        package_json = watcher.watchlist.items(.package_json)[index];
                    }
                } else if (jsc_vm.bun_watcher) |watcher| {
                    if (watcher.indexOf(hash)) |index| {
                        const _fd = watcher.watchlist.items(.fd)[index];
                        fd = if (_fd > 0) _fd else null;
                        package_json = watcher.watchlist.items(.package_json)[index];
                    }
                }

                var old = jsc_vm.bundler.log;
                jsc_vm.bundler.log = log;
                jsc_vm.bundler.linker.log = log;
                jsc_vm.bundler.resolver.log = log;

                defer {
                    jsc_vm.bundler.log = old;
                    jsc_vm.bundler.linker.log = old;
                    jsc_vm.bundler.resolver.log = old;
                }

                // this should be a cheap lookup because 24 bytes == 8 * 3 so it's read 3 machine words
                const is_node_override = specifier.len > "/bun-vfs/node_modules/".len and strings.eqlComptimeIgnoreLen(specifier[0.."/bun-vfs/node_modules/".len], "/bun-vfs/node_modules/");

                const macro_remappings = if (jsc_vm.macro_mode or !jsc_vm.has_any_macro_remappings or is_node_override)
                    MacroRemap{}
                else
                    jsc_vm.bundler.options.macro_remap;

                var fallback_source: logger.Source = undefined;

                var parse_options = Bundler.ParseOptions{
                    .allocator = allocator,
                    .path = path,
                    .loader = loader,
                    .dirname_fd = 0,
                    .file_descriptor = fd,
                    .file_hash = hash,
                    .macro_remappings = macro_remappings,
                    .jsx = jsc_vm.bundler.options.jsx,
                    .virtual_source = virtual_source,
                    .hoist_bun_plugin = true,
                };

                if (is_node_override) {
                    if (NodeFallbackModules.contentsFromPath(specifier)) |code| {
                        const fallback_path = Fs.Path.initWithNamespace(specifier, "node");
                        fallback_source = logger.Source{ .path = fallback_path, .contents = code, .key_path = fallback_path };
                        parse_options.virtual_source = &fallback_source;
                    }
                }

                var parse_result = jsc_vm.bundler.parseMaybeReturnFileOnly(
                    parse_options,
                    null,
                    disable_transpilying,
                ) orelse {
                    return error.ParseError;
                };

                if (jsc_vm.bundler.log.errors > 0) {
                    return error.ParseError;
                }

                if (comptime disable_transpilying) {
                    return ResolvedSource{
                        .allocator = null,
                        .source_code = switch (comptime flags) {
                            .print_source_and_clone => ZigString.init(jsc_vm.allocator.dupe(u8, parse_result.source.contents) catch unreachable),
                            .print_source => ZigString.init(parse_result.source.contents),
                            else => unreachable,
                        },
                        .specifier = ZigString.init(specifier),
                        .source_url = ZigString.init(path.text),
                        .hash = 0,
                    };
                }

                const has_bun_plugin = parse_result.ast.bun_plugin.hoisted_stmts.items.len > 0;

                if (has_bun_plugin) {
                    try ModuleLoader.runBunPlugin(jsc_vm, source_code_printer, &parse_result, ret);
                }

                var printer = source_code_printer.*;
                printer.ctx.reset();

                const start_count = jsc_vm.bundler.linker.import_counter;

                // We _must_ link because:
                // - node_modules bundle won't be properly
                try jsc_vm.bundler.linker.link(
                    path,
                    &parse_result,
                    jsc_vm.origin,
                    .absolute_path,
                    false,
                    true,
                );

                if (!jsc_vm.macro_mode)
                    jsc_vm.resolved_count += jsc_vm.bundler.linker.import_counter - start_count;
                jsc_vm.bundler.linker.import_counter = 0;

                const written = brk: {
                    defer source_code_printer.* = printer;
                    break :brk try jsc_vm.bundler.printWithSourceMap(
                        parse_result,
                        @TypeOf(&printer),
                        &printer,
                        .esm_ascii,
                        SavedSourceMap.SourceMapHandler.init(&jsc_vm.source_mappings),
                    );
                };

                if (written == 0) {
                    // if it's an empty file but there were plugins
                    // we don't want it to break if you try to import from it
                    if (has_bun_plugin) {
                        return ResolvedSource{
                            .allocator = null,
                            .source_code = ZigString.init("// auto-generated plugin stub\nexport default undefined\n"),
                            .specifier = ZigString.init(specifier),
                            .source_url = ZigString.init(path.text),
                            // // TODO: change hash to a bitfield
                            // .hash = 1,

                            // having JSC own the memory causes crashes
                            .hash = 0,
                        };
                    }
                    return error.PrintingErrorWriteFailed;
                }

                if (comptime Environment.dump_source) {
                    try dumpSource(specifier, &printer);
                }

                if (jsc_vm.isWatcherEnabled()) {
                    const resolved_source = jsc_vm.refCountedResolvedSource(printer.ctx.written, specifier, path.text, null);

                    if (parse_result.input_fd) |fd_| {
                        if (jsc_vm.bun_watcher != null and !is_node_override and std.fs.path.isAbsolute(path.text) and !strings.contains(path.text, "node_modules")) {
                            jsc_vm.bun_watcher.?.addFile(
                                fd_,
                                path.text,
                                hash,
                                loader,
                                0,
                                package_json,
                                true,
                            ) catch {};
                        }
                    }

                    return resolved_source;
                }

                return ResolvedSource{
                    .allocator = null,
                    .source_code = ZigString.init(try default_allocator.dupe(u8, printer.ctx.getWritten())),
                    .specifier = ZigString.init(specifier),
                    .source_url = ZigString.init(path.text),
                    // // TODO: change hash to a bitfield
                    // .hash = 1,

                    // having JSC own the memory causes crashes
                    .hash = 0,
                };
            },
            // provideFetch() should be called
            .napi => unreachable,
            // .wasm => {
            //     jsc_vm.transpiled_count += 1;
            //     var fd: ?StoredFileDescriptorType = null;

            //     var allocator = if (jsc_vm.has_loaded) jsc_vm.arena.allocator() else jsc_vm.allocator;

            //     const hash = http.Watcher.getHash(path.text);
            //     if (jsc_vm.watcher) |watcher| {
            //         if (watcher.indexOf(hash)) |index| {
            //             const _fd = watcher.watchlist.items(.fd)[index];
            //             fd = if (_fd > 0) _fd else null;
            //         }
            //     }

            //     var parse_options = Bundler.ParseOptions{
            //         .allocator = allocator,
            //         .path = path,
            //         .loader = loader,
            //         .dirname_fd = 0,
            //         .file_descriptor = fd,
            //         .file_hash = hash,
            //         .macro_remappings = MacroRemap{},
            //         .jsx = jsc_vm.bundler.options.jsx,
            //     };

            //     var parse_result = jsc_vm.bundler.parse(
            //         parse_options,
            //         null,
            //     ) orelse {
            //         return error.ParseError;
            //     };

            //     return ResolvedSource{
            //         .allocator = if (jsc_vm.has_loaded) &jsc_vm.allocator else null,
            //         .source_code = ZigString.init(jsc_vm.allocator.dupe(u8, parse_result.source.contents) catch unreachable),
            //         .specifier = ZigString.init(specifier),
            //         .source_url = ZigString.init(path.text),
            //         .hash = 0,
            //         .tag = ResolvedSource.Tag.wasm,
            //     };
            // },
            else => {
                return ResolvedSource{
                    .allocator = &jsc_vm.allocator,
                    .source_code = ZigString.init(try strings.quotedAlloc(jsc_vm.allocator, path.pretty)),
                    .specifier = ZigString.init(path.text),
                    .source_url = ZigString.init(path.text),
                    .hash = 0,
                };
            },
        }
    }

    pub fn runBunPlugin(
        jsc_vm: *VirtualMachine,
        source_code_printer: *js_printer.BufferPrinter,
        parse_result: *ParseResult,
        ret: *ErrorableResolvedSource,
    ) !void {
        var printer = source_code_printer.*;
        printer.ctx.reset();

        defer printer.ctx.reset();
        // If we start transpiling in the middle of an existing transpilation session
        // we will hit undefined memory bugs
        // unless we disable resetting the store until we are done transpiling
        const prev_disable_reset = js_ast.Stmt.Data.Store.disable_reset;
        js_ast.Stmt.Data.Store.disable_reset = true;
        js_ast.Expr.Data.Store.disable_reset = true;

        // flip the source code we use
        // unless we're already transpiling a plugin
        // that case could happen when
        const was_printing_plugin = jsc_vm.is_printing_plugin;
        const prev = jsc_vm.bundler.resolver.caches.fs.use_alternate_source_cache;
        jsc_vm.is_printing_plugin = true;
        defer {
            js_ast.Stmt.Data.Store.disable_reset = prev_disable_reset;
            js_ast.Expr.Data.Store.disable_reset = prev_disable_reset;
            if (!was_printing_plugin) jsc_vm.bundler.resolver.caches.fs.use_alternate_source_cache = prev;
            jsc_vm.is_printing_plugin = was_printing_plugin;
        }
        // we flip use_alternate_source_cache
        if (!was_printing_plugin) jsc_vm.bundler.resolver.caches.fs.use_alternate_source_cache = !prev;

        // this is a bad idea, but it should work for now.
        const original_name = parse_result.ast.symbols[parse_result.ast.bun_plugin.ref.innerIndex()].original_name;
        parse_result.ast.symbols[parse_result.ast.bun_plugin.ref.innerIndex()].original_name = "globalThis.Bun.plugin";
        defer {
            parse_result.ast.symbols[parse_result.ast.bun_plugin.ref.innerIndex()].original_name = original_name;
        }
        const hoisted_stmts = parse_result.ast.bun_plugin.hoisted_stmts.items;

        var parts = [1]js_ast.Part{
            js_ast.Part{
                .stmts = hoisted_stmts,
            },
        };
        var ast_copy = parse_result.ast;
        ast_copy.import_records = try jsc_vm.allocator.dupe(ImportRecord, ast_copy.import_records);
        defer jsc_vm.allocator.free(ast_copy.import_records);
        ast_copy.parts = &parts;
        ast_copy.prepend_part = null;
        var temporary_source = parse_result.source;
        var source_name = try std.fmt.allocPrint(jsc_vm.allocator, "{s}.plugin.{s}", .{ temporary_source.path.text, temporary_source.path.name.ext[1..] });
        temporary_source.path = Fs.Path.init(source_name);

        var temp_parse_result = parse_result.*;
        temp_parse_result.ast = ast_copy;

        try jsc_vm.bundler.linker.link(
            temporary_source.path,
            &temp_parse_result,
            jsc_vm.origin,
            .absolute_path,
            false,
            true,
        );

        _ = brk: {
            defer source_code_printer.* = printer;
            break :brk try jsc_vm.bundler.printWithSourceMapMaybe(
                temp_parse_result.ast,
                &temporary_source,
                @TypeOf(&printer),
                &printer,
                .esm_ascii,
                true,
                SavedSourceMap.SourceMapHandler.init(&jsc_vm.source_mappings),
            );
        };
        const wrote = printer.ctx.getWritten();

        if (wrote.len > 0) {
            if (comptime Environment.dump_source)
                try dumpSource(temporary_source.path.text, &printer);

            var exception = [1]JSC.JSValue{JSC.JSValue.zero};
            const promise = JSC.JSModuleLoader.evaluate(
                jsc_vm.global,
                wrote.ptr,
                wrote.len,
                temporary_source.path.text.ptr,
                temporary_source.path.text.len,
                parse_result.source.path.text.ptr,
                parse_result.source.path.text.len,
                JSC.JSValue.jsUndefined(),
                &exception,
            );
            if (!exception[0].isEmpty()) {
                ret.* = JSC.ErrorableResolvedSource.err(
                    error.JSErrorObject,
                    exception[0].asVoid(),
                );
                return error.PluginError;
            }

            if (!promise.isEmptyOrUndefinedOrNull()) {
                if (promise.asInternalPromise()) |promise_value| {
                    jsc_vm.waitForPromise(promise_value);

                    if (promise_value.status(jsc_vm.global.vm()) == .Rejected) {
                        ret.* = JSC.ErrorableResolvedSource.err(
                            error.JSErrorObject,
                            promise_value.result(jsc_vm.global.vm()).asVoid(),
                        );
                        return error.PluginError;
                    }
                }
            }
        }
    }
    pub fn normalizeSpecifier(jsc_vm: *VirtualMachine, slice_: string) string {
        var slice = slice_;
        if (slice.len == 0) return slice;
        var was_http = false;
        if (strings.hasPrefixComptime(slice, "https://")) {
            slice = slice["https://".len..];
            was_http = true;
        } else if (strings.hasPrefixComptime(slice, "http://")) {
            slice = slice["http://".len..];
            was_http = true;
        }

        if (strings.hasPrefix(slice, jsc_vm.origin.host)) {
            slice = slice[jsc_vm.origin.host.len..];
        } else if (was_http) {
            if (strings.indexOfChar(slice, '/')) |i| {
                slice = slice[i..];
            }
        }

        if (jsc_vm.origin.path.len > 1) {
            if (strings.hasPrefix(slice, jsc_vm.origin.path)) {
                slice = slice[jsc_vm.origin.path.len..];
            }
        }

        if (jsc_vm.bundler.options.routes.asset_prefix_path.len > 0) {
            if (strings.hasPrefix(slice, jsc_vm.bundler.options.routes.asset_prefix_path)) {
                slice = slice[jsc_vm.bundler.options.routes.asset_prefix_path.len..];
            }
        }

        return slice;
    }

    pub export fn Bun__fetchBuiltinModule(
        jsc_vm: *VirtualMachine,
        globalObject: *JSC.JSGlobalObject,
        specifier: *ZigString,
        referrer: *ZigString,
        ret: *ErrorableResolvedSource,
    ) bool {
        JSC.markBinding(@src());
        var log = logger.Log.init(jsc_vm.bundler.allocator);
        defer log.deinit();
        if (jsc_vm.fetchBuiltinModule(specifier.slice(), &log, false) catch |err| {
            VirtualMachine.processFetchLog(globalObject, specifier.*, referrer.*, &log, ret, err);
            return true;
        }) |builtin| {
            ret.* = ErrorableResolvedSource.ok(builtin);
            return true;
        } else {
            return false;
        }
    }

    pub export fn Bun__transpileFile(
        jsc_vm: *VirtualMachine,
        globalObject: *JSC.JSGlobalObject,
        specifier_ptr: *ZigString,
        referrer: *ZigString,
        ret: *ErrorableResolvedSource,
    ) bool {
        JSC.markBinding(@src());
        var log = logger.Log.init(jsc_vm.bundler.allocator);
        defer log.deinit();
        var _specifier = specifier_ptr.toSlice(jsc_vm.allocator);
        defer _specifier.deinit();
        var specifier = normalizeSpecifier(jsc_vm, _specifier.slice());
        const path = Fs.Path.init(specifier);
        const loader = jsc_vm.bundler.options.loaders.get(path.name.ext) orelse options.Loader.js;
        ret.* = ErrorableResolvedSource.ok(
            ModuleLoader.transpileSourceCode(
                jsc_vm,
                specifier,
                path,
                loader,
                &log,
                null,
                ret,
                VirtualMachine.source_code_printer.?,
                FetchFlags.transpile,
            ) catch |err| {
                if (err == error.PluginError) {
                    return true;
                }
                VirtualMachine.processFetchLog(globalObject, specifier_ptr.*, referrer.*, &log, ret, err);
                return true;
            },
        );
        return true;
    }

    export fn Bun__runVirtualModule(globalObject: *JSC.JSGlobalObject, specifier_ptr: *ZigString) JSValue {
        JSC.markBinding(@src());
        if (globalObject.bunVM().plugin_runner == null) return JSValue.zero;

        const specifier = specifier_ptr.slice();

        if (!PluginRunner.couldBePlugin(specifier)) {
            return JSValue.zero;
        }

        const namespace = PluginRunner.extractNamespace(specifier);
        const after_namespace = if (namespace.len == 0)
            specifier
        else
            specifier[@minimum(namespace.len + 1, specifier.len)..];

        return globalObject.runOnLoadPlugins(ZigString.init(namespace), ZigString.init(after_namespace), .bun) orelse return JSValue.zero;
    }

    export fn Bun__transpileVirtualModule(
        globalObject: *JSC.JSGlobalObject,
        specifier_ptr: *ZigString,
        referrer_ptr: *ZigString,
        source_code: *ZigString,
        loader_: Api.Loader,
        ret: *ErrorableResolvedSource,
    ) bool {
        JSC.markBinding(@src());
        const jsc_vm = globalObject.bunVM();
        std.debug.assert(jsc_vm.plugin_runner != null);

        var specifier_slice = specifier_ptr.toSlice(jsc_vm.allocator);
        const specifier = specifier_slice.slice();
        defer specifier_slice.deinit();
        var source_code_slice = source_code.toSlice(jsc_vm.allocator);
        defer source_code_slice.deinit();

        var virtual_source = logger.Source.initPathString(specifier, source_code_slice.slice());
        var log = logger.Log.init(jsc_vm.allocator);
        const path = Fs.Path.init(specifier);

        const loader = if (loader_ != ._none)
            options.Loader.fromString(@tagName(loader_)).?
        else
            jsc_vm.bundler.options.loaders.get(path.name.ext) orelse brk: {
                if (strings.eqlLong(specifier, jsc_vm.main, true)) {
                    break :brk options.Loader.js;
                }

                break :brk options.Loader.file;
            };

        defer log.deinit();
        ret.* = ErrorableResolvedSource.ok(
            ModuleLoader.transpileSourceCode(
                jsc_vm,
                specifier,
                path,
                options.Loader.fromString(@tagName(loader)).?,
                &log,
                &virtual_source,
                ret,
                VirtualMachine.source_code_printer.?,
                FetchFlags.transpile,
            ) catch |err| {
                if (err == error.PluginError) {
                    return true;
                }
                VirtualMachine.processFetchLog(globalObject, specifier_ptr.*, referrer_ptr.*, &log, ret, err);
                return true;
            },
        );
        return true;
    }

    comptime {
        _ = Bun__transpileVirtualModule;
        _ = Bun__runVirtualModule;
        _ = Bun__transpileFile;
        _ = Bun__fetchBuiltinModule;
        _ = Bun__getDefaultLoader;
    }
};

const FetchFlags = enum {
    transpile,
    print_source,
    print_source_and_clone,

    pub fn disableTranspiling(this: FetchFlags) bool {
        return this != .transpile;
    }
};

pub const Watcher = @import("../watcher.zig").NewWatcher(*HotReloader);

pub const HotReloader = struct {
    const watcher = @import("../watcher.zig");

    onAccept: std.ArrayHashMapUnmanaged(Watcher.HashType, bun.BabyList(OnAcceptCallback), bun.ArrayIdentityContext, false) = .{},
    vm: *JSC.VirtualMachine,

    pub const HotReloadTask = struct {
        reloader: *HotReloader,
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
            this.reloader.vm.reload();
        }

        pub fn enqueue(this: *HotReloadTask) void {
            if (this.count == 0)
                return;
            var that = bun.default_allocator.create(HotReloadTask) catch unreachable;

            that.* = this.*;
            this.count = 0;
            that.concurrent_task.task = Task.init(that);
            that.reloader.vm.eventLoop().enqueueTaskConcurrent(&that.concurrent_task);
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
                function: FunctionSignature,
            },
        };
    }

    pub const OnAcceptCallback = NewCallback(fn (
        vm: *JSC.VirtualMachine,
        specifier: []const u8,
    ) void);

    pub fn enableHotModuleReloading(this: *VirtualMachine) void {
        if (this.bun_watcher != null)
            return;

        var reloader = bun.default_allocator.create(HotReloader) catch @panic("OOM");
        reloader.* = .{
            .vm = this,
        };
        this.bun_watcher = JSC.Watcher.init(
            reloader,
            this.bundler.fs,
            bun.default_allocator,
        ) catch @panic("Failed to enable File Watcher");

        this.bundler.resolver.watcher = Resolver.ResolveWatcher(*Watcher, onMaybeWatchDirectory).init(this.bun_watcher.?);

        this.bun_watcher.?.start() catch @panic("Failed to start File Watcher");
    }

    pub fn onMaybeWatchDirectory(watch: *Watcher, file_path: string, dir_fd: StoredFileDescriptorType) void {
        // We don't want to watch:
        // - Directories outside the root directory
        // - Directories inside node_modules
        if (std.mem.indexOf(u8, file_path, "node_modules") == null and std.mem.indexOf(u8, file_path, watch.fs.top_level_dir) != null) {
            watch.addDirectory(dir_fd, file_path, Watcher.getHash(file_path), false) catch {};
        }
    }

    pub fn onFileUpdate(
        this: *HotReloader,
        events: []watcher.WatchEvent,
        changed_files: []?[:0]u8,
        watchlist: watcher.Watchlist,
    ) void {
        var slice = watchlist.slice();
        const file_paths = slice.items(.file_path);
        var counts = slice.items(.count);
        const kinds = slice.items(.kind);
        const hashes = slice.items(.hash);
        var file_descriptors = slice.items(.fd);
        var ctx = this.vm.bun_watcher.?;
        defer ctx.flushEvictions();
        defer Output.flush();

        var bundler = &this.vm.bundler;
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
                Output.prettyErrorln("[watcher] {s}: -- {}", .{ @tagName(kind), event.op });
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

                    if (comptime bun.FeatureFlags.verbose_watcher) {
                        Output.prettyErrorln("<r><d>File changed: {s}<r>", .{fs.relativeTo(file_path)});
                    }

                    if (event.op.write) {
                        current_task.append(id);
                    }
                },
                .directory => {
                    const affected = event.names(changed_files);
                    var entries_option: ?*Fs.FileSystem.RealFS.EntriesOption = null;
                    if (affected.len > 0) {
                        entries_option = rfs.entries.get(file_path);
                    }

                    rfs.bustEntriesCache(file_path);
                    resolver.dir_cache.remove(file_path);

                    if (entries_option) |dir_ent| {
                        var last_file_hash: Watcher.HashType = std.math.maxInt(Watcher.HashType);
                        for (affected) |changed_name_ptr| {
                            const changed_name: []const u8 = std.mem.span((changed_name_ptr orelse continue));
                            if (changed_name.len == 0 or changed_name[0] == '~' or changed_name[0] == '.') continue;

                            const loader = (bundler.options.loaders.get(Fs.PathName.init(changed_name).ext) orelse .file);
                            if (loader.isJavaScriptLikeOrJSON() or loader == .css) {
                                var path_string: bun.PathString = undefined;
                                var file_hash: Watcher.HashType = last_file_hash;
                                const abs_path: string = brk: {
                                    if (dir_ent.entries.get(changed_name)) |file_ent| {
                                        // reset the file descriptor
                                        file_ent.entry.cache.fd = 0;
                                        file_ent.entry.need_stat = true;
                                        path_string = file_ent.entry.abs_path;
                                        file_hash = Watcher.getHash(path_string.slice());
                                        for (hashes) |hash, entry_id| {
                                            if (hash == file_hash) {
                                                file_descriptors[entry_id] = 0;
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
                                        file_hash = Watcher.getHash(path_slice);
                                        break :brk path_slice;
                                    }
                                };

                                // skip consecutive duplicates
                                if (last_file_hash == file_hash) continue;
                                last_file_hash = file_hash;

                                Output.prettyErrorln("<r>   <d>File change: {s}<r>", .{fs.relativeTo(abs_path)});
                            }
                        }
                    }

                    // if (event.op.delete or event.op.rename)
                    //     ctx.watcher.removeAtIndex(event.index, hashes[event.index], parent_hashes, .directory);
                    if (comptime false) {
                        Output.prettyErrorln("<r>📁  <d>Dir change: {s}<r>", .{fs.relativeTo(file_path)});
                    } else {
                        Output.prettyErrorln("<r>    <d>Dir change: {s}<r>", .{fs.relativeTo(file_path)});
                    }
                },
            }
        }
    }
};
