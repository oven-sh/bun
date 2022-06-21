const std = @import("std");
const is_bindgen: bool = std.meta.globalOption("bindgen", bool) orelse false;
const StaticExport = @import("./bindings/static_export.zig");
const c_char = StaticExport.c_char;
const bun = @import("../../global.zig");
const string = bun.string;
const Output = bun.Output;
const Global = bun.Global;
const Environment = bun.Environment;
const strings = bun.strings;
const MutableString = bun.MutableString;
const stringZ = bun.stringZ;
const default_allocator = bun.default_allocator;
const StoredFileDescriptorType = bun.StoredFileDescriptorType;
const Arena = @import("../../mimalloc_arena.zig").Arena;
const C = bun.C;
const NetworkThread = @import("http").NetworkThread;
const IO = @import("io");
pub fn zigCast(comptime Destination: type, value: anytype) *Destination {
    return @ptrCast(*Destination, @alignCast(@alignOf(*Destination), value));
}
const Allocator = std.mem.Allocator;
const IdentityContext = @import("../../identity_context.zig").IdentityContext;
const Fs = @import("../../fs.zig");
const Resolver = @import("../../resolver/resolver.zig");
const ast = @import("../../import_record.zig");
const NodeModuleBundle = @import("../../node_module_bundle.zig").NodeModuleBundle;
const MacroEntryPoint = @import("../../bundler.zig").MacroEntryPoint;
const logger = @import("../../logger.zig");
const Api = @import("../../api/schema.zig").Api;
const options = @import("../../options.zig");
const Bundler = @import("../../bundler.zig").Bundler;
const ServerEntryPoint = @import("../../bundler.zig").ServerEntryPoint;
const js_printer = @import("../../js_printer.zig");
const js_parser = @import("../../js_parser.zig");
const js_ast = @import("../../js_ast.zig");
const hash_map = @import("../../hash_map.zig");
const http = @import("../../http.zig");
const NodeFallbackModules = @import("../../node_fallbacks.zig");
const ImportKind = ast.ImportKind;
const Analytics = @import("../../analytics/analytics_thread.zig");
const ZigString = @import("../../jsc.zig").ZigString;
const Runtime = @import("../../runtime.zig");
const Router = @import("./api/router.zig");
const ImportRecord = ast.ImportRecord;
const DotEnv = @import("../../env_loader.zig");
const ParseResult = @import("../../bundler.zig").ParseResult;
const PackageJSON = @import("../../resolver/package_json.zig").PackageJSON;
const MacroRemap = @import("../../resolver/package_json.zig").MacroMap;
const WebCore = @import("../../jsc.zig").WebCore;
const Request = WebCore.Request;
const Response = WebCore.Response;
const Headers = WebCore.Headers;
const Fetch = WebCore.Fetch;
const FetchEvent = WebCore.FetchEvent;
const js = @import("../../jsc.zig").C;
const JSC = @import("../../jsc.zig");
const JSError = @import("./base.zig").JSError;
const d = @import("./base.zig").d;
const MarkedArrayBuffer = @import("./base.zig").MarkedArrayBuffer;
const getAllocator = @import("./base.zig").getAllocator;
const JSValue = @import("../../jsc.zig").JSValue;
const NewClass = @import("./base.zig").NewClass;
const Microtask = @import("../../jsc.zig").Microtask;
const JSGlobalObject = @import("../../jsc.zig").JSGlobalObject;
const ExceptionValueRef = @import("../../jsc.zig").ExceptionValueRef;
const JSPrivateDataPtr = @import("../../jsc.zig").JSPrivateDataPtr;
const ZigConsoleClient = @import("../../jsc.zig").ZigConsoleClient;
const Node = @import("../../jsc.zig").Node;
const ZigException = @import("../../jsc.zig").ZigException;
const ZigStackTrace = @import("../../jsc.zig").ZigStackTrace;
const ErrorableResolvedSource = @import("../../jsc.zig").ErrorableResolvedSource;
const ResolvedSource = @import("../../jsc.zig").ResolvedSource;
const JSPromise = @import("../../jsc.zig").JSPromise;
const JSInternalPromise = @import("../../jsc.zig").JSInternalPromise;
const JSModuleLoader = @import("../../jsc.zig").JSModuleLoader;
const JSPromiseRejectionOperation = @import("../../jsc.zig").JSPromiseRejectionOperation;
const Exception = @import("../../jsc.zig").Exception;
const ErrorableZigString = @import("../../jsc.zig").ErrorableZigString;
const ZigGlobalObject = @import("../../jsc.zig").ZigGlobalObject;
const VM = @import("../../jsc.zig").VM;
const JSFunction = @import("../../jsc.zig").JSFunction;
const Config = @import("./config.zig");
const URL = @import("../../url.zig").URL;
const Transpiler = @import("./api/transpiler.zig");
const Bun = JSC.API.Bun;
const EventLoop = JSC.EventLoop;
const ThreadSafeFunction = JSC.napi.ThreadSafeFunction;
pub const GlobalConstructors = [_]type{
    WebCore.Blob.Constructor,
    WebCore.TextDecoder.Constructor,
    // WebCore.TextEncoder.Constructor,
    Request.Constructor,
    Response.Constructor,
    JSC.Cloudflare.HTMLRewriter.Constructor,
};

pub const GlobalClasses = [_]type{
    Bun.Class,
    EventListenerMixin.addEventListener(VirtualMachine),
    BuildError.Class,
    ResolveError.Class,

    Fetch.Class,
    js_ast.Macro.JSNode.BunJSXCallbackFunction,
    WebCore.Performance.Class,

    WebCore.Crypto.Class,
    WebCore.Crypto.Prototype,

    // The last item in this array becomes "process.env"
    Bun.EnvironmentVariables.Class,
};
const TaggedPointerUnion = @import("../../tagged_pointer.zig").TaggedPointerUnion;
const Task = JSC.Task;
const Blob = @import("../../blob.zig");
pub const Buffer = MarkedArrayBuffer;
const Lock = @import("../../lock.zig").Lock;

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

const SourceMap = @import("../../sourcemap/sourcemap.zig");
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

    map: HashTable,

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

comptime {
    if (!JSC.is_bindgen) {
        _ = Bun__getDefaultGlobal;
        _ = Bun__getVM;
        _ = Bun__drainMicrotasks;
    }
}

// If you read JavascriptCore/API/JSVirtualMachine.mm - https://github.com/WebKit/WebKit/blob/acff93fb303baa670c055cb24c2bad08691a01a0/Source/JavaScriptCore/API/JSVirtualMachine.mm#L101
// We can see that it's sort of like std.mem.Allocator but for JSGlobalContextRef, to support Automatic Reference Counting
// Its unavailable on Linux

// JavaScriptCore expects 1 VM per thread
// However, there can be many JSGlobalObject
// We currently assume a 1:1 correspondence between the two.
// This is technically innacurate
pub const VirtualMachine = struct {
    global: *JSGlobalObject,
    allocator: std.mem.Allocator,
    has_loaded_constructors: bool = false,
    node_modules: ?*NodeModuleBundle = null,
    bundler: Bundler,
    watcher: ?*http.Watcher = null,
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
    argv: []const []const u8 = &[_][]const u8{"bun"},
    global_api_constructors: [GlobalConstructors.len]JSC.JSValue = undefined,

    origin_timer: std.time.Timer = undefined,
    active_tasks: usize = 0,

    macro_event_loop: EventLoop = EventLoop{},
    regular_event_loop: EventLoop = EventLoop{},
    event_loop: *EventLoop = undefined,

    ref_strings: JSC.RefString.Map = undefined,
    file_blobs: JSC.WebCore.Blob.Store.Map,

    source_mappings: SavedSourceMap = undefined,
    response_objects_pool: ?*Response.Pool = null,

    rare_data: ?*JSC.RareData = null,
    poller: JSC.Poller = JSC.Poller{},

    pub fn io(this: *VirtualMachine) *IO {
        if (this.io_ == null) {
            this.io_ = IO.init(this) catch @panic("Failed to initialize IO");
        }

        return &this.io_.?;
    }

    pub inline fn nodeFS(this: *VirtualMachine) *Node.NodeFS {
        return this.node_fs orelse brk: {
            this.node_fs = bun.default_allocator.create(Node.NodeFS) catch unreachable;
            this.node_fs.?.* = Node.NodeFS{ .async_io = undefined };
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

    pub inline fn enqueueTaskConcurrent(this: *VirtualMachine, task: Task) void {
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

    pub threadlocal var vm_loaded = false;
    pub threadlocal var vm: *VirtualMachine = undefined;

    pub fn enableMacroMode(this: *VirtualMachine) void {
        if (!this.has_enabled_macro_mode) {
            this.has_enabled_macro_mode = true;
            this.macro_event_loop.tasks = EventLoop.Queue.init(default_allocator);
            this.macro_event_loop.tasks.ensureTotalCapacity(16) catch unreachable;
            this.macro_event_loop.global = this.global;
            this.macro_event_loop.virtual_machine = this;
            this.macro_event_loop.concurrent_tasks = EventLoop.Queue.init(default_allocator);
        }

        this.bundler.options.platform = .bun_macro;
        this.bundler.resolver.caches.fs.is_macro_mode = true;
        this.macro_mode = true;
        this.event_loop = &this.macro_event_loop;
        Analytics.Features.macros = true;
    }

    pub fn disableMacroMode(this: *VirtualMachine) void {
        this.bundler.options.platform = .bun;
        this.bundler.resolver.caches.fs.is_macro_mode = false;
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
            .source_mappings = SavedSourceMap{ .map = SavedSourceMap.HashTable.init(allocator) },
            .macros = MacroMap.init(allocator),
            .macro_entry_points = @TypeOf(VirtualMachine.vm.macro_entry_points).init(allocator),
            .origin_timer = std.time.Timer.start() catch @panic("Please don't mess with timers."),
            .ref_strings = JSC.RefString.Map.init(allocator),
            .file_blobs = JSC.WebCore.Blob.Store.Map.init(allocator),
        };
        VirtualMachine.vm.regular_event_loop.tasks = EventLoop.Queue.init(
            default_allocator,
        );
        VirtualMachine.vm.regular_event_loop.tasks.ensureUnusedCapacity(64) catch unreachable;
        VirtualMachine.vm.regular_event_loop.concurrent_tasks = EventLoop.Queue.init(default_allocator);
        VirtualMachine.vm.regular_event_loop.concurrent_tasks.ensureUnusedCapacity(8) catch unreachable;
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

    threadlocal var source_code_printer: ?*js_printer.BufferPrinter = null;

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

    inline fn _fetch(
        _: *JSGlobalObject,
        _specifier: string,
        _: string,
        log: *logger.Log,
        comptime disable_transpilying: bool,
    ) !ResolvedSource {
        std.debug.assert(VirtualMachine.vm_loaded);
        var jsc_vm = vm;

        if (jsc_vm.node_modules != null and strings.eqlComptime(_specifier, bun_file_import_path)) {
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
        } else if (jsc_vm.node_modules == null and strings.eqlComptime(_specifier, Runtime.Runtime.Imports.Name)) {
            return ResolvedSource{
                .allocator = null,
                .source_code = ZigString.init(Runtime.Runtime.sourceContentBun()),
                .specifier = ZigString.init(Runtime.Runtime.Imports.Name),
                .source_url = ZigString.init(Runtime.Runtime.Imports.Name),
                .hash = Runtime.Runtime.versionHash(),
            };
        } else if (HardcodedModule.Map.get(_specifier)) |hardcoded| {
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
                    opts.transform_require_to_import = true;
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
                        .source_code = ZigString.init(@embedFile("bun-jsc.exports.js") ++ JSC.Node.fs.constants_string),
                        .specifier = ZigString.init("bun:jsc"),
                        .source_url = ZigString.init("bun:jsc"),
                        .hash = 0,
                    };
                },
                .@"node:fs" => {
                    return ResolvedSource{
                        .allocator = null,
                        .source_code = ZigString.init(@embedFile("fs.exports.js") ++ JSC.Node.fs.constants_string),
                        .specifier = ZigString.init("node:fs"),
                        .source_url = ZigString.init("node:fs"),
                        .hash = 0,
                    };
                },
                .@"node:path" => {
                    return ResolvedSource{
                        .allocator = null,
                        .source_code = ZigString.init(Node.Path.code),
                        .specifier = ZigString.init("node:path"),
                        .source_url = ZigString.init("node:path"),
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
                .@"bun:sqlite" => {
                    return ResolvedSource{
                        .allocator = null,
                        .source_code = ZigString.init(
                            @as(string, @embedFile("./bindings/sqlite/sqlite.exports.js")),
                        ),
                        .specifier = ZigString.init("bun:sqlite"),
                        .source_url = ZigString.init("bun:sqlite"),
                        .hash = 0,
                    };
                },
                .@"node:module" => {
                    return ResolvedSource{
                        .allocator = null,
                        .source_code = ZigString.init(
                            @as(string, @embedFile("./module.exports.js")),
                        ),
                        .specifier = ZigString.init("node:module"),
                        .source_url = ZigString.init("node:module"),
                        .hash = 0,
                    };
                },
            }
        } else if (_specifier.len > js_ast.Macro.namespaceWithColon.len and
            strings.eqlComptimeIgnoreLen(_specifier[0..js_ast.Macro.namespaceWithColon.len], js_ast.Macro.namespaceWithColon))
        {
            if (comptime !disable_transpilying) {
                if (jsc_vm.macro_entry_points.get(MacroEntryPoint.generateIDFromSpecifier(_specifier))) |entry| {
                    return ResolvedSource{
                        .allocator = null,
                        .source_code = ZigString.init(entry.source.contents),
                        .specifier = ZigString.init(_specifier),
                        .source_url = ZigString.init(_specifier),
                        .hash = 0,
                    };
                }
            }
        }

        const specifier = normalizeSpecifier(_specifier);

        std.debug.assert(std.fs.path.isAbsolute(specifier)); // if this crashes, it means the resolver was skipped.

        const path = Fs.Path.init(specifier);
        const loader = jsc_vm.bundler.options.loaders.get(path.name.ext) orelse .file;

        switch (loader) {
            .js, .jsx, .ts, .tsx, .json, .toml => {
                jsc_vm.transpiled_count += 1;
                jsc_vm.bundler.resetStore();
                const hash = http.Watcher.getHash(path.text);

                var allocator = if (jsc_vm.has_loaded) jsc_vm.arena.allocator() else jsc_vm.allocator;

                var fd: ?StoredFileDescriptorType = null;
                var package_json: ?*PackageJSON = null;

                if (jsc_vm.watcher) |watcher| {
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

                if (comptime disable_transpilying) {
                    return ResolvedSource{
                        .allocator = null,
                        .source_code = ZigString.init(parse_result.source.contents),
                        .specifier = ZigString.init(specifier),
                        .source_url = ZigString.init(path.text),
                        .hash = 0,
                    };
                }

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

                if (written == 0) {
                    return error.PrintingErrorWriteFailed;
                }

                if (jsc_vm.has_loaded) {
                    return jsc_vm.refCountedResolvedSource(printer.ctx.written, specifier, path.text, null);
                }

                return ResolvedSource{
                    .allocator = null,
                    .source_code = ZigString.init(jsc_vm.allocator.dupe(u8, printer.ctx.written) catch unreachable),
                    .specifier = ZigString.init(specifier),
                    .source_url = ZigString.init(path.text),
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
                    .allocator = &vm.allocator,
                    .source_code = ZigString.init(try strings.quotedAlloc(jsc_vm.allocator, path.pretty)),
                    .specifier = ZigString.init(path.text),
                    .source_url = ZigString.init(path.text),
                    .hash = 0,
                };
            },
        }
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
            ret.path = std.mem.span(@tagName(result));
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
            specifier,
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

        _resolve(&result, global, specifier.slice(), source.slice(), is_a_file_path, realpath) catch |err| {
            // This should almost always just apply to dynamic imports

            const printed = ResolveError.fmt(
                vm.allocator,
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
    pub fn normalizeSpecifier(slice_: string) string {
        var vm_ = VirtualMachine.vm;

        var slice = slice_;
        if (slice.len == 0) return slice;
        var was_http = false;
        if (strings.hasPrefix(slice, "https://")) {
            slice = slice["https://".len..];
            was_http = true;
        }

        if (strings.hasPrefix(slice, "http://")) {
            slice = slice["http://".len..];
            was_http = true;
        }

        if (strings.hasPrefix(slice, vm_.origin.host)) {
            slice = slice[vm_.origin.host.len..];
        } else if (was_http) {
            if (strings.indexOfChar(slice, '/')) |i| {
                slice = slice[i..];
            }
        }

        if (vm_.origin.path.len > 1) {
            if (strings.hasPrefix(slice, vm_.origin.path)) {
                slice = slice[vm_.origin.path.len..];
            }
        }

        if (vm_.bundler.options.routes.asset_prefix_path.len > 0) {
            if (strings.hasPrefix(slice, vm_.bundler.options.routes.asset_prefix_path)) {
                slice = slice[vm_.bundler.options.routes.asset_prefix_path.len..];
            }
        }

        return slice;
    }

    // // This double prints
    // pub fn promiseRejectionTracker(global: *JSGlobalObject, promise: *JSPromise, _: JSPromiseRejectionOperation) callconv(.C) JSValue {
    //     const result = promise.result(global.vm());
    //     if (@enumToInt(VirtualMachine.vm.last_error_jsvalue) != @enumToInt(result)) {
    //         VirtualMachine.vm.defaultErrorHandler(result, null);
    //     }

    //     return JSValue.jsUndefined();
    // }

    const main_file_name: string = "bun:main";

    pub fn fetch(ret: *ErrorableResolvedSource, global: *JSGlobalObject, specifier: ZigString, source: ZigString) callconv(.C) void {
        var log = logger.Log.init(vm.bundler.allocator);
        const spec = specifier.slice();
        const result = _fetch(global, spec, source.slice(), &log, false) catch |err| {
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

    fn processFetchLog(globalThis: *JSGlobalObject, specifier: ZigString, referrer: ZigString, log: *logger.Log, ret: *ErrorableResolvedSource, err: anyerror) void {
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

    pub fn defaultErrorHandler(this: *VirtualMachine, result: JSValue, exception_list: ?*ExceptionList) void {
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

    pub fn loadEntryPoint(this: *VirtualMachine, entry_path: string) !*JSInternalPromise {
        try this.entry_point.generate(@TypeOf(this.bundler), &this.bundler, Fs.PathName.init(entry_path), main_file_name);
        this.main = entry_path;

        var promise: *JSInternalPromise = undefined;
        // We first import the node_modules bundle. This prevents any potential TDZ issues.
        // The contents of the node_modules bundle are lazy, so hopefully this should be pretty quick.
        if (this.node_modules != null and !this.has_loaded_node_modules) {
            this.has_loaded_node_modules = true;
            promise = JSModuleLoader.loadAndEvaluateModule(this.global, &ZigString.init(std.mem.span(bun_file_import_path)));

            this.waitForPromise(promise);
            if (promise.status(this.global.vm()) == .Rejected)
                return promise;
        }

        promise = JSModuleLoader.loadAndEvaluateModule(this.global, &ZigString.init(std.mem.span(main_file_name)));

        this.waitForPromise(promise);

        return promise;
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

        if (js.JSValueIsObject(this.global.ref(), value.asRef())) {
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
        VirtualMachine.vm.defaultErrorHandler(exception.value(), null);
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
            var original_source = _fetch(this.global, top.source_url.slice(), "", &log, true) catch return;
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
            writer.writeByteNTimes(' ', pad) catch unreachable;
            writer.print(
                comptime Output.prettyFmt("<r><d>{d} | <r>{s}\n", allow_ansi_color),
                .{
                    source.line,
                    std.mem.trim(u8, source.text, "\n"),
                },
            ) catch unreachable;
        }

        var name = exception.name;
        if (strings.eqlComptime(exception.name.slice(), "Error")) {
            name = ZigString.init("error");
        }

        const message = exception.message;
        var did_print_name = false;
        if (source_lines.next()) |source| {
            if (source.text.len > 0 and exception.stack.frames()[0].position.isInvalid()) {
                defer did_print_name = true;
                var text = std.mem.trim(u8, source.text, "\n");

                writer.print(
                    comptime Output.prettyFmt(
                        "<r><d>- |<r> {s}\n",
                        allow_ansi_color,
                    ),
                    .{
                        text,
                    },
                ) catch unreachable;

                if (name.len > 0 and message.len > 0) {
                    writer.print(comptime Output.prettyFmt(" <r><red>{}<r><d>:<r> <b>{}<r>\n", allow_ansi_color), .{
                        name,
                        message,
                    }) catch unreachable;
                } else if (name.len > 0) {
                    writer.print(comptime Output.prettyFmt(" <r><b>{}<r>\n", allow_ansi_color), .{name}) catch unreachable;
                } else if (message.len > 0) {
                    writer.print(comptime Output.prettyFmt(" <r><b>{}<r>\n", allow_ansi_color), .{message}) catch unreachable;
                }
            } else if (source.text.len > 0) {
                defer did_print_name = true;
                const int_size = std.fmt.count("{d}", .{source.line});
                const pad = max_line_number_pad - int_size;
                writer.writeByteNTimes(' ', pad) catch unreachable;
                const top = exception.stack.frames()[0];
                var remainder = std.mem.trim(u8, source.text, "\n");

                writer.print(
                    comptime Output.prettyFmt(
                        "<r><d>{d} |<r> {s}\n",
                        allow_ansi_color,
                    ),
                    .{ source.line, remainder },
                ) catch unreachable;

                if (!top.position.isInvalid()) {
                    var first_non_whitespace = @intCast(u32, top.position.column_start);
                    while (first_non_whitespace < source.text.len and source.text[first_non_whitespace] == ' ') {
                        first_non_whitespace += 1;
                    }
                    const indent = @intCast(usize, pad) + " | ".len + first_non_whitespace;

                    writer.writeByteNTimes(' ', indent) catch unreachable;
                    writer.print(comptime Output.prettyFmt(
                        "<red><b>^<r>\n",
                        allow_ansi_color,
                    ), .{}) catch unreachable;
                }

                if (name.len > 0 and message.len > 0) {
                    writer.print(comptime Output.prettyFmt(" <r><red>{s}<r><d>:<r> <b>{s}<r>\n", allow_ansi_color), .{
                        name,
                        message,
                    }) catch unreachable;
                } else if (name.len > 0) {
                    writer.print(comptime Output.prettyFmt(" <r><b>{s}<r>\n", allow_ansi_color), .{name}) catch unreachable;
                } else if (message.len > 0) {
                    writer.print(comptime Output.prettyFmt(" <r><b>{s}<r>\n", allow_ansi_color), .{message}) catch unreachable;
                }
            }
        }

        if (!did_print_name) {
            if (name.len > 0 and message.len > 0) {
                writer.print(comptime Output.prettyFmt("<r><red>{s}<r><d>:<r> <b>{s}<r>\n", true), .{
                    name,
                    message,
                }) catch unreachable;
            } else if (name.len > 0) {
                writer.print(comptime Output.prettyFmt("<r>{s}<r>\n", true), .{name}) catch unreachable;
            } else if (message.len > 0) {
                writer.print(comptime Output.prettyFmt("<r>{s}<r>\n", true), .{name}) catch unreachable;
            }
        }

        var add_extra_line = false;

        const Show = struct {
            system_code: bool = false,
            syscall: bool = false,
            errno: bool = false,
            path: bool = false,
        };

        var show = Show{
            .system_code = exception.system_code.len > 0 and !strings.eql(exception.system_code.slice(), name.slice()),
            .syscall = exception.syscall.len > 0,
            .errno = exception.errno < 0,
            .path = exception.path.len > 0,
        };

        if (show.path) {
            if (show.syscall) {
                writer.writeAll("  ") catch unreachable;
            } else if (show.errno) {
                writer.writeAll(" ") catch unreachable;
            }
            writer.print(comptime Output.prettyFmt(" path<d>: <r><cyan>\"{s}\"<r>\n", allow_ansi_color), .{exception.path}) catch unreachable;
        }

        if (show.system_code) {
            if (show.syscall) {
                writer.writeAll("  ") catch unreachable;
            } else if (show.errno) {
                writer.writeAll(" ") catch unreachable;
            }
            writer.print(comptime Output.prettyFmt(" code<d>: <r><cyan>\"{s}\"<r>\n", allow_ansi_color), .{exception.system_code}) catch unreachable;
            add_extra_line = true;
        }

        if (show.syscall) {
            writer.print(comptime Output.prettyFmt("syscall<d>: <r><cyan>\"{s}\"<r>\n", allow_ansi_color), .{exception.syscall}) catch unreachable;
            add_extra_line = true;
        }

        if (show.errno) {
            if (show.syscall) {
                writer.writeAll("  ") catch unreachable;
            }
            writer.print(comptime Output.prettyFmt("errno<d>: <r><yellow>{d}<r>\n", allow_ansi_color), .{exception.errno}) catch unreachable;
            add_extra_line = true;
        }

        if (add_extra_line) writer.writeAll("\n") catch unreachable;

        try printStackTrace(@TypeOf(writer), writer, exception.stack, allow_ansi_color);
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
            .request = try Request.fromRequestContext(request_context, vm.global),
            .onPromiseRejectionCtx = @as(*anyopaque, ctx),
            .onPromiseRejectionHandler = FetchEventRejectionHandler.onRejection,
        };

        var fetch_args: [1]js.JSObjectRef = undefined;
        fetch_args[0] = FetchEvent.Class.make(vm.global.ref(), fetch_event);
        JSC.C.JSValueProtect(vm.global.ref(), fetch_args[0]);
        defer JSC.C.JSValueUnprotect(vm.global.ref(), fetch_args[0]);

        for (listeners.items) |listener_ref| {
            vm.tick();
            var result = js.JSObjectCallAsFunctionReturnValue(vm.global.ref(), listener_ref, null, 1, &fetch_args);
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
                    .ts = d.ts{},
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
        var ref = Class.make(globalThis.ref(), resolve_error);
        js.JSValueProtect(globalThis.ref(), ref);
        return ref;
    }

    pub fn getPosition(
        this: *ResolveError,
        ctx: js.JSContextRef,
        _: js.JSObjectRef,
        _: js.JSStringRef,
        exception: js.ExceptionRef,
    ) js.JSValueRef {
        return BuildError.generatePositionObject(this.msg, ctx, exception);
    }

    pub fn getMessage(
        this: *ResolveError,
        ctx: js.JSContextRef,
        _: js.JSObjectRef,
        _: js.JSStringRef,
        _: js.ExceptionRef,
    ) js.JSValueRef {
        return ZigString.init(this.msg.data.text).toValue(ctx.ptr()).asRef();
    }

    pub fn getSpecifier(
        this: *ResolveError,
        ctx: js.JSContextRef,
        _: js.JSObjectRef,
        _: js.JSStringRef,
        _: js.ExceptionRef,
    ) js.JSValueRef {
        return ZigString.init(this.msg.metadata.resolve.specifier.slice(this.msg.data.text)).toValue(ctx.ptr()).asRef();
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
            return ZigString.init(referrer.text).toValue(ctx.ptr()).asRef();
        } else {
            return js.JSValueMakeNull(ctx);
        }
    }

    const BuildErrorName = "ResolveError";
    pub fn getName(
        _: *ResolveError,
        ctx: js.JSContextRef,
        _: js.JSObjectRef,
        _: js.JSStringRef,
        _: js.ExceptionRef,
    ) js.JSValueRef {
        return ZigString.init(BuildErrorName).toValue(ctx.ptr()).asRef();
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

        var ref = Class.make(globalThis.ref(), build_error);
        js.JSValueProtect(globalThis.ref(), ref);
        return ref;
    }

    pub fn getPosition(
        this: *BuildError,
        ctx: js.JSContextRef,
        _: js.JSObjectRef,
        _: js.JSStringRef,
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

    pub fn generatePositionObject(msg: logger.Msg, ctx: js.JSContextRef, exception: ExceptionValueRef) js.JSValueRef {
        if (msg.data.location) |location| {
            const ref = js.JSObjectMake(ctx, null, null);
            js.JSObjectSetProperty(
                ctx,
                ref,
                PositionProperties.lineText(),
                ZigString.init(location.line_text orelse "").toJSStringRef(),
                0,
                exception,
            );
            js.JSObjectSetProperty(
                ctx,
                ref,
                PositionProperties.file(),
                ZigString.init(location.file).toJSStringRef(),
                0,
                exception,
            );
            js.JSObjectSetProperty(
                ctx,
                ref,
                PositionProperties.namespace(),
                ZigString.init(location.namespace).toJSStringRef(),
                0,
                exception,
            );
            js.JSObjectSetProperty(
                ctx,
                ref,
                PositionProperties.line(),
                js.JSValueMakeNumber(ctx, @intToFloat(f64, location.line)),
                0,
                exception,
            );
            js.JSObjectSetProperty(
                ctx,
                ref,
                PositionProperties.column(),
                js.JSValueMakeNumber(ctx, @intToFloat(f64, location.column)),
                0,
                exception,
            );
            js.JSObjectSetProperty(
                ctx,
                ref,
                PositionProperties.length(),
                js.JSValueMakeNumber(ctx, @intToFloat(f64, location.length)),
                0,
                exception,
            );
            js.JSObjectSetProperty(
                ctx,
                ref,
                PositionProperties.offset(),
                js.JSValueMakeNumber(ctx, @intToFloat(f64, location.offset)),
                0,
                exception,
            );
            return ref;
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
    @"bun:main",
    @"node:fs",
    @"node:path",
    @"detect-libc",
    @"bun:sqlite",
    @"bun:jsc",
    @"node:module",

    pub const Map = bun.ComptimeStringMap(
        HardcodedModule,
        .{
            .{ "bun:ffi", HardcodedModule.@"bun:ffi" },
            .{ "ffi", HardcodedModule.@"bun:ffi" },
            .{ "bun:main", HardcodedModule.@"bun:main" },
            .{ "node:fs", HardcodedModule.@"node:fs" },
            .{ "fs", HardcodedModule.@"node:fs" },
            .{ "node:path", HardcodedModule.@"node:path" },
            .{ "path", HardcodedModule.@"node:path" },
            .{ "node:path/win32", HardcodedModule.@"node:path" },
            .{ "node:path/posix", HardcodedModule.@"node:path" },
            .{ "detect-libc", HardcodedModule.@"detect-libc" },
            .{ "bun:sqlite", HardcodedModule.@"bun:sqlite" },
            .{ "node:module", HardcodedModule.@"node:module" },
            .{ "module", HardcodedModule.@"node:module" },
            .{ "bun:jsc", HardcodedModule.@"bun:jsc" },
        },
    );
    pub const LinkerMap = bun.ComptimeStringMap(
        string,
        .{
            .{ "bun:ffi", "bun:ffi" },
            .{ "bun:jsc", "bun:jsc" },
            .{ "detect-libc", "detect-libc" },
            .{ "detect-libc/lib/detect-libc.js", "detect-libc" },
            .{ "ffi", "bun:ffi" },
            .{ "fs", "node:fs" },
            .{ "node:fs", "node:fs" },
            .{ "node:path", "node:path" },
            .{ "path", "node:path" },
            .{ "bun:wrap", "bun:wrap" },
            .{ "bun:sqlite", "bun:sqlite" },
            .{ "node:module", "node:module" },
            .{ "module", "node:module" },
        },
    );
};
