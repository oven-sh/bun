//! This is the shared global state for a single JS instance execution.
//!
//! Today, Bun is one VM per thread, so the name "VirtualMachine" sort of makes
//! sense. If that changes, this should be renamed `ScriptExecutionContext`.

const VirtualMachine = @This();

export var has_bun_garbage_collector_flag_enabled = false;
pub export var isBunTest: bool = false;

// TODO: evaluate if this has any measurable performance impact.
pub var synthetic_allocation_limit: usize = std.math.maxInt(u32);
pub var string_allocation_limit: usize = std.math.maxInt(u32);

comptime {
    _ = Bun__remapStackFramePositions;
    @export(&scriptExecutionStatus, .{ .name = "Bun__VM__scriptExecutionStatus" });
    @export(&setEntryPointEvalResultESM, .{ .name = "Bun__VM__setEntryPointEvalResultESM" });
    @export(&setEntryPointEvalResultCJS, .{ .name = "Bun__VM__setEntryPointEvalResultCJS" });
    @export(&specifierIsEvalEntryPoint, .{ .name = "Bun__VM__specifierIsEvalEntryPoint" });
    @export(&string_allocation_limit, .{ .name = "Bun__stringSyntheticAllocationLimit" });
    @export(&allowAddons, .{ .name = "Bun__VM__allowAddons" });
    @export(&allowRejectionHandledWarning, .{ .name = "Bun__VM__allowRejectionHandledWarning" });
}

global: *JSGlobalObject,
allocator: std.mem.Allocator,
has_loaded_constructors: bool = false,
transpiler: Transpiler,
bun_watcher: ImportWatcher = .{ .none = {} },
console: *ConsoleObject,
log: *logger.Log,
main: []const u8 = "",
main_is_html_entrypoint: bool = false,
main_resolved_path: bun.String = bun.String.empty,
main_hash: u32 = 0,
/// Set if code overrides Bun.main to a custom value, and then reset when the VM loads a new file
/// (e.g. when bun:test starts testing a new file)
overridden_main: jsc.Strong.Optional = .empty,
entry_point: ServerEntryPoint = undefined,
origin: URL = URL{},
node_fs: ?*bun.api.node.fs.NodeFS = null,
timer: bun.api.Timer.All,
event_loop_handle: ?*jsc.PlatformEventLoop = null,
pending_unref_counter: i32 = 0,
preload: []const []const u8 = &.{},
unhandled_pending_rejection_to_capture: ?*JSValue = null,
standalone_module_graph: ?*bun.StandaloneModuleGraph = null,
smol: bool = false,
dns_result_order: DNSResolver.Order = .verbatim,
cpu_profiler_config: ?CPUProfilerConfig = null,
heap_profiler_config: ?HeapProfilerConfig = null,
counters: Counters = .{},

hot_reload: bun.cli.Command.HotReload = .none,
jsc_vm: *VM = undefined,

/// hide bun:wrap from stack traces
/// bun:wrap is very noisy
hide_bun_stackframes: bool = true,

is_printing_plugin: bool = false,
is_shutting_down: bool = false,
plugin_runner: ?PluginRunner = null,
is_main_thread: bool = false,
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
auto_killer: ProcessAutoKiller = .{ .enabled = false },

has_any_macro_remappings: bool = false,
is_from_devserver: bool = false,
has_enabled_macro_mode: bool = false,

/// Used by bun:test to set global hooks for beforeAll, beforeEach, etc.
is_in_preload: bool = false,
has_patched_run_main: bool = false,

transpiler_store: ModuleLoader.RuntimeTranspilerStore,

after_event_loop_callback_ctx: ?*anyopaque = null,
after_event_loop_callback: ?jsc.OpaqueCallback = null,

remap_stack_frames_mutex: bun.Mutex = .{},

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
argv: []const []const u8 = &[_][]const u8{},

origin_timer: std.time.Timer = undefined,
origin_timestamp: u64 = 0,
/// For fake timers: override performance.now() with a specific value (in nanoseconds)
/// When null, use the real timer. When set, return this value instead.
overridden_performance_now: ?u64 = null,
macro_event_loop: EventLoop = EventLoop{},
regular_event_loop: EventLoop = EventLoop{},
event_loop: *EventLoop = undefined,

ref_strings: jsc.RefString.Map = undefined,
ref_strings_mutex: bun.Mutex = undefined,

active_tasks: usize = 0,

rare_data: ?*jsc.RareData = null,
is_us_loop_entered: bool = false,
pending_internal_promise: ?*JSInternalPromise = null,
entry_point_result: struct {
    value: jsc.Strong.Optional = .empty,
    cjs_set_value: bool = false,
} = .{},

auto_install_dependencies: bool = false,

onUnhandledRejection: *const OnUnhandledRejection = defaultOnUnhandledRejection,
onUnhandledRejectionCtx: ?*anyopaque = null,
onUnhandledRejectionExceptionList: ?*ExceptionList = null,
unhandled_error_counter: usize = 0,
is_handling_uncaught_exception: bool = false,
exit_on_uncaught_exception: bool = false,

modules: ModuleLoader.AsyncModule.Queue = .{},
aggressive_garbage_collection: GCLevel = GCLevel.none,

module_loader: ModuleLoader = .{},

gc_controller: jsc.GarbageCollectionController = .{},
worker: ?*webcore.WebWorker = null,
ipc: ?IPCInstanceUnion = null,
hot_reload_counter: u32 = 0,

debugger: ?jsc.Debugger = null,
has_started_debugger: bool = false,
has_terminated: bool = false,

debug_thread_id: if (Environment.allow_assert) std.Thread.Id else void,

body_value_hive_allocator: webcore.Body.Value.HiveAllocator = undefined,

is_inside_deferred_task_queue: bool = false,

// defaults off. .on("message") will set it to true unless overridden
// process.channel.unref() will set it to false and mark it overridden
// on disconnect it will be disabled
channel_ref: bun.Async.KeepAlive = .{},
// if process.channel.ref() or unref() has been called, this is set to true
channel_ref_overridden: bool = false,
// if one disconnect event listener should be ignored
channel_ref_should_ignore_one_disconnect_event_listener: bool = false,

/// A set of extensions that exist in the require.extensions map. Keys
/// contain the leading '.'. Value is either a loader for built in
/// functions, or an index into JSCommonJSExtensions.
///
/// `.keys() == transpiler.resolver.opts.extra_cjs_extensions`, so
/// mutations in this map must update the resolver.
commonjs_custom_extensions: bun.StringArrayHashMapUnmanaged(node_module_module.CustomLoader) = .empty,
/// Incremented when the `require.extensions` for a built-in extension is mutated.
/// An example is mutating `require.extensions['.js']` to intercept all '.js' files.
/// The value is decremented when defaults are restored.
has_mutated_built_in_extensions: u32 = 0,

initial_script_execution_context_identifier: i32,

extern "C" fn Bake__getAsyncLocalStorage(globalObject: *JSGlobalObject) callconv(jsc.conv) jsc.JSValue;

pub fn getDevServerAsyncLocalStorage(this: *VirtualMachine) !?jsc.JSValue {
    const jsvalue = try jsc.fromJSHostCall(this.global, @src(), Bake__getAsyncLocalStorage, .{this.global});
    if (jsvalue.isEmptyOrUndefinedOrNull()) return null;
    return jsvalue;
}

pub const ProcessAutoKiller = @import("./ProcessAutoKiller.zig");
pub const OnUnhandledRejection = fn (*VirtualMachine, globalObject: *JSGlobalObject, JSValue) void;

pub const OnException = fn (*ZigException) void;

pub fn allowAddons(this: *VirtualMachine) callconv(.c) bool {
    return if (this.transpiler.options.transform_options.allow_addons) |allow_addons| allow_addons else true;
}
pub fn allowRejectionHandledWarning(this: *VirtualMachine) callconv(.c) bool {
    return this.unhandledRejectionsMode() != .bun;
}
pub fn unhandledRejectionsMode(this: *VirtualMachine) api.UnhandledRejections {
    return this.transpiler.options.transform_options.unhandled_rejections orelse .bun;
}

pub fn initRequestBodyValue(this: *VirtualMachine, body: jsc.WebCore.Body.Value) !*Body.Value.HiveRef {
    return .init(body, &this.body_value_hive_allocator);
}

/// Whether this VM should be destroyed after it exits, even if it is the main thread's VM.
/// Worker VMs are always destroyed on exit, regardless of this setting. Setting this to
/// true may expose bugs that would otherwise only occur using Workers. Controlled by
pub fn shouldDestructMainThreadOnExit(_: *const VirtualMachine) bool {
    return bun.feature_flag.BUN_DESTRUCT_VM_ON_EXIT.get();
}

pub threadlocal var is_bundler_thread_for_bytecode_cache: bool = false;

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
    return this.default_tls_reject_unauthorized orelse this.transpiler.env.getTLSRejectUnauthorized();
}

pub fn onSubprocessSpawn(this: *VirtualMachine, process: *bun.spawn.Process) void {
    this.auto_killer.onSubprocessSpawn(process);
}

pub fn onSubprocessExit(this: *VirtualMachine, process: *bun.spawn.Process) void {
    this.auto_killer.onSubprocessExit(process);
}

pub fn getVerboseFetch(this: *VirtualMachine) bun.http.HTTPVerboseLevel {
    return this.default_verbose_fetch orelse {
        if (this.transpiler.env.get("BUN_CONFIG_VERBOSE_FETCH")) |verbose_fetch| {
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

pub const VMHolder = struct {
    pub threadlocal var vm: ?*VirtualMachine = null;
    pub threadlocal var cached_global_object: ?*JSGlobalObject = null;
    pub var main_thread_vm: ?*VirtualMachine = null;
    pub export fn Bun__setDefaultGlobalObject(global: *JSGlobalObject) void {
        if (vm) |vm_instance| {
            vm_instance.global = global;

            // Ensure this is always set when it should be.
            if (vm_instance.is_main_thread) {
                VMHolder.main_thread_vm = vm_instance;
            }
        }

        cached_global_object = global;
    }

    pub export fn Bun__getDefaultGlobalObject() ?*JSGlobalObject {
        return cached_global_object orelse {
            if (vm) |vm_instance| {
                cached_global_object = vm_instance.global;
            }
            return null;
        };
    }

    pub export fn Bun__thisThreadHasVM() bool {
        return vm != null;
    }
};

pub inline fn get() *VirtualMachine {
    return getOrNull().?;
}

pub inline fn getOrNull() ?*VirtualMachine {
    return VMHolder.vm;
}

pub fn getMainThreadVM() ?*VirtualMachine {
    return VMHolder.main_thread_vm;
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

pub fn isEventLoopAliveExcludingImmediates(vm: *const VirtualMachine) bool {
    return vm.unhandled_error_counter == 0 and
        (@intFromBool(vm.event_loop_handle.?.isActive()) +
            vm.active_tasks +
            vm.event_loop.tasks.count +
            @intFromBool(vm.event_loop.hasPendingRefs()) > 0);
}

pub fn isEventLoopAlive(vm: *const VirtualMachine) bool {
    return vm.isEventLoopAliveExcludingImmediates() or
        // We need to keep running in this case so that immediate tasks get run. But immediates
        // intentionally don't make the event loop _active_ so we need to check for them
        // separately.
        vm.event_loop.immediate_tasks.items.len > 0 or
        vm.event_loop.next_immediate_tasks.items.len > 0;
}

pub fn wakeup(this: *VirtualMachine) void {
    this.eventLoop().wakeup();
}

const SourceMapHandlerGetter = struct {
    vm: *VirtualMachine,
    printer: *js_printer.BufferPrinter,

    pub fn get(this: *SourceMapHandlerGetter) js_printer.SourceMapHandler {
        if (this.vm.debugger == null or this.vm.debugger.?.mode == .connect) {
            return SavedSourceMap.SourceMapHandler.init(&this.vm.source_mappings);
        }

        return js_printer.SourceMapHandler.For(SourceMapHandlerGetter, onChunk).init(this);
    }

    /// When the inspector is enabled, we want to generate an inline sourcemap.
    /// And, for now, we also store it in source_mappings like normal
    /// This is hideously expensive memory-wise...
    pub fn onChunk(this: *SourceMapHandlerGetter, chunk: SourceMap.Chunk, source: *const logger.Source) anyerror!void {
        var temp_json_buffer = bun.MutableString.initEmpty(bun.default_allocator);
        defer temp_json_buffer.deinit();
        try chunk.printSourceMapContentsAtOffset(source, &temp_json_buffer, true, SavedSourceMap.vlq_offset, true);
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

    pub fn apply(this: *UnhandledRejectionScope, vm: *jsc.VirtualMachine) void {
        vm.onUnhandledRejection = this.onUnhandledRejection;
        vm.onUnhandledRejectionCtx = this.ctx;
        vm.unhandled_error_counter = this.count;
    }
};

pub fn onQuietUnhandledRejectionHandler(this: *VirtualMachine, _: *JSGlobalObject, _: JSValue) void {
    this.unhandled_error_counter += 1;
}

pub fn onQuietUnhandledRejectionHandlerCaptureValue(this: *VirtualMachine, _: *JSGlobalObject, value: JSValue) void {
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

fn ensureSourceCodePrinter(this: *VirtualMachine) void {
    if (source_code_printer == null) {
        const allocator = if (bun.heap_breakdown.enabled) bun.heap_breakdown.namedAllocator("SourceCode") else this.allocator;
        const writer = js_printer.BufferWriter.init(allocator);
        source_code_printer = allocator.create(js_printer.BufferPrinter) catch unreachable;
        source_code_printer.?.* = js_printer.BufferPrinter.init(writer);
        source_code_printer.?.ctx.append_null_byte = false;
    }
}

pub fn loadExtraEnvAndSourceCodePrinter(this: *VirtualMachine) void {
    var map = this.transpiler.env.map;

    ensureSourceCodePrinter(this);

    if (map.get("BUN_SHOW_BUN_STACKFRAMES") != null) {
        this.hide_bun_stackframes = false;
    }

    if (bun.feature_flag.BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER.get()) {
        this.transpiler_store.enabled = false;
    }

    if (map.map.fetchSwapRemove("NODE_CHANNEL_FD")) |kv| {
        const fd_s = kv.value.value;
        const mode = if (map.map.fetchSwapRemove("NODE_CHANNEL_SERIALIZATION_MODE")) |mode_kv|
            IPC.Mode.fromString(mode_kv.value.value) orelse .json
        else
            .json;

        IPC.log("IPC environment variables: NODE_CHANNEL_FD={s}, NODE_CHANNEL_SERIALIZATION_MODE={s}", .{ fd_s, @tagName(mode) });
        if (std.fmt.parseInt(u31, fd_s, 10)) |fd| {
            this.initIPCInstance(.fromUV(fd), mode);
        } else |_| {
            Output.warn("Failed to parse IPC channel number '{s}'", .{fd_s});
        }
    }

    // Node.js checks if this are set to "1" and no other value
    if (map.get("NODE_PRESERVE_SYMLINKS")) |value| {
        this.transpiler.resolver.opts.preserve_symlinks = bun.strings.eqlComptime(value, "1");
    }

    if (map.get("BUN_GARBAGE_COLLECTOR_LEVEL")) |gc_level| {
        // Reuse this flag for other things to avoid unnecessary hashtable
        // lookups on start for obscure flags which we do not want others to
        // depend on.
        if (map.get("BUN_FEATURE_FLAG_FORCE_WAITER_THREAD") != null) {
            bun.spawn.process.WaiterThread.setShouldUseWaiterThread();
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

        if (map.get("BUN_FEATURE_FLAG_SYNTHETIC_MEMORY_LIMIT")) |value| {
            if (std.fmt.parseInt(usize, value, 10)) |limit| {
                synthetic_allocation_limit = limit;
                string_allocation_limit = limit;
            } else |_| {
                Output.panic("BUN_FEATURE_FLAG_SYNTHETIC_MEMORY_LIMIT must be a positive integer", .{});
            }
        }
    }
}

extern fn Bun__handleUncaughtException(*JSGlobalObject, err: JSValue, is_rejection: c_int) c_int;
extern fn Bun__handleUnhandledRejection(*JSGlobalObject, reason: JSValue, promise: JSValue) c_int;
extern fn Bun__wrapUnhandledRejectionErrorForUncaughtException(*JSGlobalObject, reason: JSValue) JSValue;
extern fn Bun__emitHandledPromiseEvent(*JSGlobalObject, promise: JSValue) bool;
extern fn Bun__promises__isErrorLike(*JSGlobalObject, reason: JSValue) bool;
extern fn Bun__promises__emitUnhandledRejectionWarning(*JSGlobalObject, reason: JSValue, promise: JSValue) void;
extern fn Bun__noSideEffectsToString(vm: *jsc.VM, globalObject: *JSGlobalObject, reason: JSValue) JSValue;

fn isErrorLike(globalObject: *JSGlobalObject, reason: JSValue) bun.JSError!bool {
    return jsc.fromJSHostCallGeneric(globalObject, @src(), Bun__promises__isErrorLike, .{ globalObject, reason });
}

fn wrapUnhandledRejectionErrorForUncaughtException(globalObject: *JSGlobalObject, reason: JSValue) JSValue {
    if (isErrorLike(globalObject, reason) catch blk: {
        globalObject.clearException();
        break :blk false;
    }) return reason;
    const reasonStr = blk: {
        var scope: jsc.TopExceptionScope = undefined;
        scope.init(globalObject, @src());
        defer scope.deinit();
        defer if (scope.exception()) |_| scope.clearException();
        break :blk Bun__noSideEffectsToString(globalObject.vm(), globalObject, reason);
    };
    const msg_1 = "This error originated either by throwing inside of an async function without a catch block, " ++
        "or by rejecting a promise which was not handled with .catch(). The promise rejected with the reason \"";
    if (reasonStr.isString()) {
        return globalObject.ERR(.UNHANDLED_REJECTION, msg_1 ++ "{f}\".", .{reasonStr.asString().view(globalObject)}).toJS();
    }
    return globalObject.ERR(.UNHANDLED_REJECTION, msg_1 ++ "{s}\".", .{"undefined"}).toJS();
}

pub fn unhandledRejection(this: *jsc.VirtualMachine, globalObject: *JSGlobalObject, reason: JSValue, promise: JSValue) void {
    if (this.isShuttingDown()) {
        Output.debugWarn("unhandledRejection during shutdown.", .{});
        return;
    }

    if (isBunTest) {
        this.unhandled_error_counter += 1;
        this.onUnhandledRejection(this, globalObject, reason);
        return;
    }

    switch (this.unhandledRejectionsMode()) {
        .bun => {
            if (Bun__handleUnhandledRejection(globalObject, reason, promise) > 0) return;
            // continue to default handler
        },
        .none => {
            defer this.eventLoop().drainMicrotasks() catch |e| switch (e) {
                error.JSTerminated => {}, // we are returning anyway
            };
            if (Bun__handleUnhandledRejection(globalObject, reason, promise) > 0) return;
            return; // ignore the unhandled rejection
        },
        .warn => {
            defer this.eventLoop().drainMicrotasks() catch |e| switch (e) {
                error.JSTerminated => {}, // we are returning anyway
            };
            _ = Bun__handleUnhandledRejection(globalObject, reason, promise);
            jsc.fromJSHostCallGeneric(globalObject, @src(), Bun__promises__emitUnhandledRejectionWarning, .{ globalObject, reason, promise }) catch |err| {
                _ = globalObject.reportUncaughtException(globalObject.takeException(err).asException(globalObject.vm()).?);
            };
            return;
        },
        .warn_with_error_code => {
            defer this.eventLoop().drainMicrotasks() catch |e| switch (e) {
                error.JSTerminated => {}, // we are returning anyway
            };
            if (Bun__handleUnhandledRejection(globalObject, reason, promise) > 0) return;
            jsc.fromJSHostCallGeneric(globalObject, @src(), Bun__promises__emitUnhandledRejectionWarning, .{ globalObject, reason, promise }) catch |err| {
                _ = globalObject.reportUncaughtException(globalObject.takeException(err).asException(globalObject.vm()).?);
            };
            this.exit_handler.exit_code = 1;
            return;
        },
        .strict => {
            defer this.eventLoop().drainMicrotasks() catch |e| switch (e) {
                error.JSTerminated => {}, // we are returning anyway
            };
            const wrapped_reason = wrapUnhandledRejectionErrorForUncaughtException(globalObject, reason);
            _ = this.uncaughtException(globalObject, wrapped_reason, true);
            if (Bun__handleUnhandledRejection(globalObject, reason, promise) > 0) return;
            jsc.fromJSHostCallGeneric(globalObject, @src(), Bun__promises__emitUnhandledRejectionWarning, .{ globalObject, reason, promise }) catch |err| {
                _ = globalObject.reportUncaughtException(globalObject.takeException(err).asException(globalObject.vm()).?);
            };
            return;
        },
        .throw => {
            if (Bun__handleUnhandledRejection(globalObject, reason, promise) > 0) {
                this.eventLoop().drainMicrotasks() catch |e| switch (e) {
                    error.JSTerminated => {}, // we are returning anyway
                };
                return;
            }
            const wrapped_reason = wrapUnhandledRejectionErrorForUncaughtException(globalObject, reason);
            if (this.uncaughtException(globalObject, wrapped_reason, true)) {
                this.eventLoop().drainMicrotasks() catch |e| switch (e) {
                    error.JSTerminated => {}, // we are returning anyway
                };
                return;
            }
            // continue to default handler
            this.eventLoop().drainMicrotasks() catch |e| switch (e) {
                error.JSTerminated => return,
            };
        },
    }
    this.unhandled_error_counter += 1;
    this.onUnhandledRejection(this, globalObject, reason);
    return;
}

pub fn handledPromise(this: *jsc.VirtualMachine, globalObject: *JSGlobalObject, promise: JSValue) bool {
    if (this.isShuttingDown()) {
        return true;
    }

    return Bun__emitHandledPromiseEvent(globalObject, promise);
}

pub fn uncaughtException(this: *jsc.VirtualMachine, globalObject: *JSGlobalObject, err: JSValue, is_rejection: bool) bool {
    if (this.isShuttingDown()) {
        return true;
    }

    if (isBunTest) {
        this.unhandled_error_counter += 1;
        this.onUnhandledRejection(this, globalObject, err);
        return true;
    }

    if (this.is_handling_uncaught_exception) {
        this.runErrorHandler(err, null);
        bun.api.node.process.exit(globalObject, 7);
        @panic("Uncaught exception while handling uncaught exception");
    }
    if (this.exit_on_uncaught_exception) {
        this.runErrorHandler(err, null);
        bun.api.node.process.exit(globalObject, 1);
        @panic("made it past Bun__Process__exit");
    }
    this.is_handling_uncaught_exception = true;
    defer this.is_handling_uncaught_exception = false;
    const handled = Bun__handleUncaughtException(globalObject, err.toError() orelse err, if (is_rejection) 1 else 0) > 0;
    if (!handled) {
        // TODO maybe we want a separate code path for uncaught exceptions
        this.unhandled_error_counter += 1;
        this.exit_handler.exit_code = 1;
        this.onUnhandledRejection(this, globalObject, err);
    }
    return handled;
}

pub fn reportExceptionInHotReloadedModuleIfNeeded(this: *jsc.VirtualMachine) void {
    defer this.addMainToWatcherIfNeeded();
    var promise = this.pending_internal_promise orelse return;

    if (promise.status() == .rejected and !promise.isHandled()) {
        this.unhandledRejection(this.global, promise.result(), promise.asValue());
        promise.setHandled(this.global.vm());
    }
}

pub fn addMainToWatcherIfNeeded(this: *jsc.VirtualMachine) void {
    if (this.isWatcherEnabled()) {
        const main = this.main;
        if (main.len == 0) return;
        _ = this.bun_watcher.addFileByPathSlow(main, this.transpiler.options.loader(std.fs.path.extension(main)));
    }
}

pub fn defaultOnUnhandledRejection(this: *jsc.VirtualMachine, _: *JSGlobalObject, value: JSValue) void {
    this.runErrorHandler(value, this.onUnhandledRejectionExceptionList);
}

pub inline fn packageManager(this: *VirtualMachine) *PackageManager {
    return this.transpiler.getPackageManager();
}

pub fn garbageCollect(this: *const VirtualMachine, sync: bool) usize {
    @branchHint(.cold);
    Global.mimalloc_cleanup(false);
    if (sync)
        return this.global.vm().runGC(true);

    this.global.vm().collectAsync();
    return this.global.vm().heapSize();
}

pub inline fn autoGarbageCollect(this: *const VirtualMachine) void {
    if (this.aggressive_garbage_collection != .none) {
        _ = this.garbageCollect(this.aggressive_garbage_collection == .aggressive);
    }
}

pub fn reload(this: *VirtualMachine, _: *HotReloader.Task) void {
    Output.debug("Reloading...", .{});
    const should_clear_terminal = !this.transpiler.env.hasSetNoClearTerminalOnReload(!Output.enable_ansi_colors_stdout);
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

    this.global.reload() catch @panic("Failed to reload");
    this.hot_reload_counter += 1;
    this.pending_internal_promise = this.reloadEntryPoint(this.main) catch @panic("Failed to reload");
}

pub inline fn nodeFS(this: *VirtualMachine) *Node.fs.NodeFS {
    return this.node_fs orelse brk: {
        this.node_fs = bun.default_allocator.create(Node.fs.NodeFS) catch unreachable;
        this.node_fs.?.* = Node.fs.NodeFS{
            // only used when standalone module graph is enabled
            .vm = if (this.standalone_module_graph != null) this else null,
        };
        break :brk this.node_fs.?;
    };
}

pub inline fn rareData(this: *VirtualMachine) *jsc.RareData {
    return this.rare_data orelse brk: {
        this.rare_data = this.allocator.create(jsc.RareData) catch unreachable;
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

pub fn scriptExecutionStatus(this: *const VirtualMachine) callconv(.c) jsc.ScriptExecutionStatus {
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

pub fn specifierIsEvalEntryPoint(this: *VirtualMachine, specifier: JSValue) callconv(.c) bool {
    if (this.module_loader.eval_source) |eval_source| {
        var specifier_str = specifier.toBunString(this.global) catch @panic("unexpected exception");
        defer specifier_str.deref();
        return specifier_str.eqlUTF8(eval_source.path.text);
    }

    return false;
}

pub fn setEntryPointEvalResultESM(this: *VirtualMachine, result: JSValue) callconv(.c) void {
    // allow esm evaluate to set value multiple times
    if (!this.entry_point_result.cjs_set_value) {
        this.entry_point_result.value.set(this.global, result);
    }
}

pub fn setEntryPointEvalResultCJS(this: *VirtualMachine, value: JSValue) callconv(.c) void {
    if (!this.entry_point_result.value.has()) {
        this.entry_point_result.value.set(this.global, value);
        this.entry_point_result.cjs_set_value = true;
    }
}

pub fn onExit(this: *VirtualMachine) void {
    // Write CPU profile if profiling was enabled - do this FIRST before any shutdown begins
    // Grab the config and null it out to make this idempotent
    if (this.cpu_profiler_config) |config| {
        this.cpu_profiler_config = null;
        CPUProfiler.stopAndWriteProfile(this.jsc_vm, config) catch |err| {
            Output.err(err, "Failed to write CPU profile", .{});
        };
    }

    // Write heap profile if profiling was enabled - do this after CPU profile but before shutdown
    // Grab the config and null it out to make this idempotent
    if (this.heap_profiler_config) |config| {
        this.heap_profiler_config = null;
        HeapProfiler.generateAndWriteProfile(this.jsc_vm, config) catch |err| {
            Output.err(err, "Failed to write heap profile", .{});
        };
    }

    this.exit_handler.dispatchOnExit();
    this.is_shutting_down = true;

    const rare_data = this.rare_data orelse return;
    defer rare_data.cleanup_hooks.clearAndFree(bun.default_allocator);
    // Make sure we run new cleanup hooks introduced by running cleanup hooks
    while (rare_data.cleanup_hooks.items.len > 0) {
        var hooks = rare_data.cleanup_hooks;
        defer hooks.deinit(bun.default_allocator);
        rare_data.cleanup_hooks = .{};
        for (hooks.items) |hook| {
            hook.execute();
        }
    }
}

extern fn Zig__GlobalObject__destructOnExit(*JSGlobalObject) void;

pub fn globalExit(this: *VirtualMachine) noreturn {
    bun.assert(this.isShuttingDown());
    // FIXME: we should be doing this, but we're not, but unfortunately doing it
    //        causes like 50+ tests to break
    // this.eventLoop().tick();

    if (this.shouldDestructMainThreadOnExit()) {
        if (this.eventLoop().forever_timer) |t| t.deinit(true);
        Zig__GlobalObject__destructOnExit(this.global);
        this.transpiler.deinit();
        this.gc_controller.deinit();
        this.deinit();
    }
    bun.Global.exit(this.exit_handler.exit_code);
}

pub fn nextAsyncTaskID(this: *VirtualMachine) u64 {
    var debugger: *jsc.Debugger = &(this.debugger orelse return 0);
    debugger.next_debugger_id +%= 1;
    return debugger.next_debugger_id;
}

pub fn hotMap(this: *VirtualMachine) ?*jsc.RareData.HotMap {
    if (this.hot_reload != .hot) {
        return null;
    }

    return this.rareData().hotMap(this.allocator);
}

pub inline fn enqueueTask(this: *VirtualMachine, task: jsc.Task) void {
    this.eventLoop().enqueueTask(task);
}

pub inline fn enqueueImmediateTask(this: *VirtualMachine, task: *bun.api.Timer.ImmediateObject) void {
    this.eventLoop().enqueueImmediateTask(task);
}

pub inline fn enqueueTaskConcurrent(this: *VirtualMachine, task: *jsc.ConcurrentTask) void {
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

pub fn waitForPromise(this: *VirtualMachine, promise: jsc.AnyPromise) void {
    this.eventLoop().waitForPromise(promise);
}

pub fn waitForTasks(this: *VirtualMachine) void {
    while (this.isEventLoopAlive()) {
        this.eventLoop().tick();

        if (this.isEventLoopAlive()) {
            this.eventLoop().autoTick();
        }
    }
}

pub const MacroMap = std.AutoArrayHashMap(i32, jsc.C.JSObjectRef);

pub fn enableMacroMode(this: *VirtualMachine) void {
    jsc.markBinding(@src());

    if (!this.has_enabled_macro_mode) {
        this.has_enabled_macro_mode = true;
        this.macro_event_loop.tasks = EventLoop.Queue.init(default_allocator);
        this.macro_event_loop.tasks.ensureTotalCapacity(16) catch unreachable;
        this.macro_event_loop.global = this.global;
        this.macro_event_loop.virtual_machine = this;
        this.macro_event_loop.concurrent_tasks = .{};
        ensureSourceCodePrinter(this);
    }

    this.transpiler.options.target = .bun_macro;
    this.transpiler.resolver.caches.fs.use_alternate_source_cache = true;
    this.macro_mode = true;
    this.event_loop = &this.macro_event_loop;
    bun.analytics.Features.macros += 1;
    this.transpiler_store.enabled = false;
}

pub fn disableMacroMode(this: *VirtualMachine) void {
    this.transpiler.options.target = .bun;
    this.transpiler.resolver.caches.fs.use_alternate_source_cache = false;
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
pub fn initWithModuleGraph(
    opts: Options,
) !*VirtualMachine {
    jsc.markBinding(@src());
    const allocator = opts.allocator;
    VMHolder.vm = try allocator.create(VirtualMachine);
    const console = try allocator.create(ConsoleObject);
    console.init(Output.rawErrorWriter(), Output.rawWriter());
    const log = opts.log.?;
    const transpiler = try Transpiler.init(
        allocator,
        log,
        opts.args,
        null,
    );
    var vm = VMHolder.vm.?;

    vm.* = VirtualMachine{
        .global = undefined,
        .transpiler_store = RuntimeTranspilerStore.init(),
        .allocator = allocator,
        .entry_point = ServerEntryPoint{},
        .transpiler = transpiler,
        .console = console,
        .log = log,
        .timer = bun.api.Timer.All.init(),
        .origin = transpiler.options.origin,
        .saved_source_map_table = SavedSourceMap.HashTable.init(bun.default_allocator),
        .source_mappings = undefined,
        .macros = MacroMap.init(allocator),
        .macro_entry_points = @TypeOf(vm.macro_entry_points).init(allocator),
        .origin_timer = std.time.Timer.start() catch @panic("Timers are not supported on this system."),
        .origin_timestamp = getOriginTimestamp(),
        .ref_strings = jsc.RefString.Map.init(allocator),
        .ref_strings_mutex = .{},
        .standalone_module_graph = opts.graph.?,
        .debug_thread_id = if (Environment.allow_assert) std.Thread.getCurrentId(),

        .initial_script_execution_context_identifier = if (opts.is_main_thread) 1 else std.math.maxInt(i32),
    };
    vm.source_mappings.init(&vm.saved_source_map_table);
    vm.regular_event_loop.tasks = EventLoop.Queue.init(
        default_allocator,
    );
    vm.regular_event_loop.virtual_machine = vm;
    vm.regular_event_loop.tasks.ensureUnusedCapacity(64) catch unreachable;
    vm.regular_event_loop.concurrent_tasks = .{};
    vm.event_loop = &vm.regular_event_loop;

    vm.transpiler.macro_context = null;
    vm.transpiler.resolver.store_fd = false;
    vm.transpiler.resolver.prefer_module_field = false;

    vm.transpiler.resolver.onWakePackageManager = .{
        .context = &vm.modules,
        .handler = ModuleLoader.AsyncModule.Queue.onWakeHandler,
        .onDependencyError = ModuleLoader.AsyncModule.Queue.onDependencyError,
    };

    // Emitting "@__PURE__" comments at runtime is a waste of memory and time.
    vm.transpiler.options.emit_dce_annotations = false;

    vm.transpiler.resolver.standalone_module_graph = opts.graph.?;

    // Avoid reading from tsconfig.json & package.json when we're in standalone mode
    vm.transpiler.configureLinkerWithAutoJSX(false);

    vm.transpiler.macro_context = js_ast.Macro.MacroContext.init(&vm.transpiler);
    if (opts.is_main_thread) {
        VMHolder.main_thread_vm = vm;
        vm.is_main_thread = true;
    }
    is_smol_mode = opts.smol;
    vm.global = JSGlobalObject.create(
        vm,
        vm.console,
        vm.initial_script_execution_context_identifier,
        false,
        false,
        null,
    );
    vm.regular_event_loop.global = vm.global;
    vm.jsc_vm = vm.global.vm();
    uws.Loop.get().internal_loop_data.jsc_vm = vm.jsc_vm;

    vm.configureDebugger(opts.debugger);
    vm.body_value_hive_allocator = Body.Value.HiveAllocator.init(bun.typedAllocator(jsc.WebCore.Body.Value));

    return vm;
}

export fn Bun__isMainThreadVM() callconv(.c) bool {
    return get().is_main_thread;
}

pub const Options = struct {
    allocator: std.mem.Allocator,
    args: api.TransformOptions,
    log: ?*logger.Log = null,
    env_loader: ?*DotEnv.Loader = null,
    store_fd: bool = false,
    smol: bool = false,
    dns_result_order: DNSResolver.Order = .verbatim,

    // --print needs the result from evaluating the main module
    eval: bool = false,

    graph: ?*bun.StandaloneModuleGraph = null,
    debugger: bun.cli.Command.Debugger = .{ .unspecified = {} },
    is_main_thread: bool = false,
    /// Whether this VM should be destroyed after it exits, even if it is the main thread's VM.
    /// Worker VMs are always destroyed on exit, regardless of this setting. Setting this to
    /// true may expose bugs that would otherwise only occur using Workers.
    destruct_main_thread_on_exit: bool = false,
};

pub var is_smol_mode = false;

pub fn init(opts: Options) !*VirtualMachine {
    jsc.markBinding(@src());
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
    console.init(Output.rawErrorWriter(), Output.rawWriter());
    const transpiler = try Transpiler.init(
        allocator,
        log,
        try Config.configureTransformOptionsForBunVM(allocator, opts.args),
        opts.env_loader,
    );
    var vm = VMHolder.vm.?;
    if (opts.is_main_thread) {
        VMHolder.main_thread_vm = vm;
    }
    vm.* = VirtualMachine{
        .global = undefined,
        .transpiler_store = RuntimeTranspilerStore.init(),
        .allocator = allocator,
        .entry_point = ServerEntryPoint{},
        .transpiler = transpiler,
        .console = console,
        .log = log,

        .timer = bun.api.Timer.All.init(),

        .origin = transpiler.options.origin,

        .saved_source_map_table = SavedSourceMap.HashTable.init(bun.default_allocator),
        .source_mappings = undefined,
        .macros = MacroMap.init(allocator),
        .macro_entry_points = @TypeOf(vm.macro_entry_points).init(allocator),
        .origin_timer = std.time.Timer.start() catch @panic("Please don't mess with timers."),
        .origin_timestamp = getOriginTimestamp(),
        .ref_strings = jsc.RefString.Map.init(allocator),
        .ref_strings_mutex = .{},
        .debug_thread_id = if (Environment.allow_assert) std.Thread.getCurrentId(),

        .initial_script_execution_context_identifier = if (opts.is_main_thread) 1 else std.math.maxInt(i32),
    };
    vm.source_mappings.init(&vm.saved_source_map_table);
    vm.regular_event_loop.tasks = EventLoop.Queue.init(
        default_allocator,
    );

    vm.regular_event_loop.virtual_machine = vm;
    vm.regular_event_loop.tasks.ensureUnusedCapacity(64) catch unreachable;
    vm.regular_event_loop.concurrent_tasks = .{};
    vm.event_loop = &vm.regular_event_loop;

    // Emitting "@__PURE__" comments at runtime is a waste of memory and time.
    vm.transpiler.options.emit_dce_annotations = false;

    vm.transpiler.macro_context = null;
    vm.transpiler.resolver.store_fd = opts.store_fd;
    vm.transpiler.resolver.prefer_module_field = false;
    vm.transpiler.resolver.opts.preserve_symlinks = opts.args.preserve_symlinks orelse false;

    vm.transpiler.resolver.onWakePackageManager = .{
        .context = &vm.modules,
        .handler = ModuleLoader.AsyncModule.Queue.onWakeHandler,
        .onDependencyError = ModuleLoader.AsyncModule.Queue.onDependencyError,
    };

    vm.transpiler.configureLinker();

    vm.transpiler.macro_context = js_ast.Macro.MacroContext.init(&vm.transpiler);

    vm.global = JSGlobalObject.create(
        vm,
        vm.console,
        vm.initial_script_execution_context_identifier,
        opts.smol,
        opts.eval,
        null,
    );
    vm.regular_event_loop.global = vm.global;
    vm.jsc_vm = vm.global.vm();
    uws.Loop.get().internal_loop_data.jsc_vm = vm.jsc_vm;
    vm.smol = opts.smol;
    vm.dns_result_order = opts.dns_result_order;

    if (opts.smol)
        is_smol_mode = opts.smol;

    vm.configureDebugger(opts.debugger);
    vm.body_value_hive_allocator = Body.Value.HiveAllocator.init(bun.typedAllocator(jsc.WebCore.Body.Value));

    return vm;
}

pub inline fn assertOnJSThread(vm: *const VirtualMachine) void {
    if (Environment.allow_assert) {
        if (vm.debug_thread_id != std.Thread.getCurrentId()) {
            std.debug.panic("Expected to be on the JS thread.", .{});
        }
    }
}

fn configureDebugger(this: *VirtualMachine, cli_flag: bun.cli.Command.Debugger) void {
    if (bun.env_var.HYPERFINE_RANDOMIZED_ENVIRONMENT_OFFSET.get() != null) {
        return;
    }

    const unix = bun.env_var.BUN_INSPECT.get();
    const connect_to = bun.env_var.BUN_INSPECT_CONNECT_TO.get();

    const set_breakpoint_on_first_line = unix.len > 0 and strings.endsWith(unix, "?break=1"); // If we should set a breakpoint on the first line
    const wait_for_debugger = unix.len > 0 and strings.endsWith(unix, "?wait=1"); // If we should wait for the debugger to connect before starting the event loop

    const wait_for_connection: jsc.Debugger.Wait = if (set_breakpoint_on_first_line or wait_for_debugger) .forever else .off;

    switch (cli_flag) {
        .unspecified => {
            if (unix.len > 0) {
                this.debugger = .{
                    .path_or_port = null,
                    .from_environment_variable = unix,
                    .wait_for_connection = wait_for_connection,
                    .set_breakpoint_on_first_line = set_breakpoint_on_first_line,
                };
            } else if (connect_to.len > 0) {
                // This works in the vscode debug terminal because that relies on unix or notify being set, which they
                // are in the debug terminal. This branch doesn't reach
                this.debugger = .{
                    .path_or_port = null,
                    .from_environment_variable = connect_to,
                    .wait_for_connection = .off,
                    .set_breakpoint_on_first_line = false,
                    .mode = .connect,
                };
            }
        },
        .enable => {
            this.debugger = .{
                .path_or_port = cli_flag.enable.path_or_port,
                .from_environment_variable = unix,
                .wait_for_connection = if (cli_flag.enable.wait_for_connection) .forever else wait_for_connection,
                .set_breakpoint_on_first_line = set_breakpoint_on_first_line or cli_flag.enable.set_breakpoint_on_first_line,
            };
        },
    }

    if (this.isInspectorEnabled() and this.debugger.?.mode != .connect) {
        this.transpiler.options.minify_identifiers = false;
        this.transpiler.options.minify_syntax = false;
        this.transpiler.options.minify_whitespace = false;
        this.transpiler.options.debugger = true;
    }
}

pub fn initWorker(
    worker: *webcore.WebWorker,
    opts: Options,
) anyerror!*VirtualMachine {
    jsc.markBinding(@src());
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
    console.init(Output.rawErrorWriter(), Output.rawWriter());
    const transpiler = try Transpiler.init(
        allocator,
        log,
        try Config.configureTransformOptionsForBunVM(allocator, opts.args),
        opts.env_loader,
    );
    var vm = VMHolder.vm.?;

    vm.* = VirtualMachine{
        .global = undefined,
        .allocator = allocator,
        .transpiler_store = RuntimeTranspilerStore.init(),
        .entry_point = ServerEntryPoint{},
        .transpiler = transpiler,
        .console = console,
        .log = log,

        .timer = bun.api.Timer.All.init(),
        .origin = transpiler.options.origin,

        .saved_source_map_table = SavedSourceMap.HashTable.init(bun.default_allocator),
        .source_mappings = undefined,
        .macros = MacroMap.init(allocator),
        .macro_entry_points = @TypeOf(vm.macro_entry_points).init(allocator),
        .origin_timer = std.time.Timer.start() catch @panic("Please don't mess with timers."),
        .origin_timestamp = getOriginTimestamp(),
        .ref_strings = jsc.RefString.Map.init(allocator),
        .ref_strings_mutex = .{},
        .standalone_module_graph = worker.parent.standalone_module_graph,
        .worker = worker,
        .debug_thread_id = if (Environment.allow_assert) std.Thread.getCurrentId(),
        .initial_script_execution_context_identifier = @as(i32, @intCast(worker.execution_context_id)),
    };
    vm.source_mappings.init(&vm.saved_source_map_table);
    vm.regular_event_loop.tasks = EventLoop.Queue.init(
        default_allocator,
    );

    // Emitting "@__PURE__" comments at runtime is a waste of memory and time.
    vm.transpiler.options.emit_dce_annotations = false;

    vm.regular_event_loop.virtual_machine = vm;
    vm.regular_event_loop.tasks.ensureUnusedCapacity(64) catch unreachable;
    vm.regular_event_loop.concurrent_tasks = .{};
    vm.event_loop = &vm.regular_event_loop;
    vm.hot_reload = worker.parent.hot_reload;
    vm.transpiler.macro_context = null;
    vm.transpiler.resolver.store_fd = opts.store_fd;
    vm.transpiler.resolver.prefer_module_field = false;
    vm.transpiler.resolver.onWakePackageManager = .{
        .context = &vm.modules,
        .handler = ModuleLoader.AsyncModule.Queue.onWakeHandler,
        .onDependencyError = ModuleLoader.AsyncModule.Queue.onDependencyError,
    };
    vm.transpiler.resolver.standalone_module_graph = opts.graph;

    if (opts.graph == null) {
        vm.transpiler.configureLinker();
    } else {
        vm.transpiler.configureLinkerWithAutoJSX(false);
    }

    vm.smol = opts.smol;
    vm.transpiler.macro_context = js_ast.Macro.MacroContext.init(&vm.transpiler);

    vm.global = JSGlobalObject.create(
        vm,
        vm.console,
        vm.initial_script_execution_context_identifier,
        worker.mini,
        opts.eval,
        worker.cpp_worker,
    );
    vm.regular_event_loop.global = vm.global;
    vm.jsc_vm = vm.global.vm();
    uws.Loop.get().internal_loop_data.jsc_vm = vm.jsc_vm;
    vm.transpiler.setAllocator(allocator);
    vm.body_value_hive_allocator = Body.Value.HiveAllocator.init(bun.typedAllocator(jsc.WebCore.Body.Value));

    return vm;
}

extern fn BakeCreateProdGlobal(console_ptr: *anyopaque) *jsc.JSGlobalObject;

pub fn initBake(opts: Options) anyerror!*VirtualMachine {
    jsc.markBinding(@src());
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
    console.init(Output.rawErrorWriter(), Output.rawWriter());
    const transpiler = try Transpiler.init(
        allocator,
        log,
        try Config.configureTransformOptionsForBunVM(allocator, opts.args),
        opts.env_loader,
    );
    var vm = VMHolder.vm.?;

    vm.* = VirtualMachine{
        .global = undefined,
        .transpiler_store = RuntimeTranspilerStore.init(),
        .allocator = allocator,
        .entry_point = ServerEntryPoint{},
        .transpiler = transpiler,
        .console = console,
        .log = log,
        .timer = bun.api.Timer.All.init(),
        .origin = transpiler.options.origin,
        .saved_source_map_table = SavedSourceMap.HashTable.init(bun.default_allocator),
        .source_mappings = undefined,
        .macros = MacroMap.init(allocator),
        .macro_entry_points = @TypeOf(vm.macro_entry_points).init(allocator),
        .origin_timer = std.time.Timer.start() catch @panic("Please don't mess with timers."),
        .origin_timestamp = getOriginTimestamp(),
        .ref_strings = jsc.RefString.Map.init(allocator),
        .ref_strings_mutex = .{},
        .debug_thread_id = if (Environment.allow_assert) std.Thread.getCurrentId(),

        .initial_script_execution_context_identifier = if (opts.is_main_thread) 1 else std.math.maxInt(i32),
    };
    vm.source_mappings.init(&vm.saved_source_map_table);
    vm.regular_event_loop.tasks = EventLoop.Queue.init(
        default_allocator,
    );

    vm.regular_event_loop.virtual_machine = vm;
    vm.regular_event_loop.tasks.ensureUnusedCapacity(64) catch unreachable;
    vm.regular_event_loop.concurrent_tasks = .{};
    vm.event_loop = &vm.regular_event_loop;
    if (comptime bun.Environment.isWindows) {
        vm.eventLoop().ensureWaker();
        vm.global = BakeCreateProdGlobal(vm.console);
        vm.jsc_vm = vm.global.vm();
        uws.Loop.get().internal_loop_data.jsc_vm = vm.jsc_vm;
    } else {
        vm.global = BakeCreateProdGlobal(vm.console);
        vm.jsc_vm = vm.global.vm();
        vm.eventLoop().ensureWaker();
    }

    vm.transpiler.macro_context = null;
    vm.transpiler.resolver.store_fd = opts.store_fd;
    vm.transpiler.resolver.prefer_module_field = false;

    vm.transpiler.resolver.onWakePackageManager = .{
        .context = &vm.modules,
        .handler = ModuleLoader.AsyncModule.Queue.onWakeHandler,
        .onDependencyError = ModuleLoader.AsyncModule.Queue.onDependencyError,
    };

    vm.transpiler.configureLinker();

    vm.transpiler.macro_context = js_ast.Macro.MacroContext.init(&vm.transpiler);

    vm.smol = opts.smol;

    if (opts.smol)
        is_smol_mode = opts.smol;

    vm.configureDebugger(opts.debugger);
    vm.body_value_hive_allocator = Body.Value.HiveAllocator.init(bun.typedAllocator(jsc.WebCore.Body.Value));

    return vm;
}

pub threadlocal var source_code_printer: ?*js_printer.BufferPrinter = null;

pub fn clearRefString(_: *anyopaque, ref_string: *jsc.RefString) void {
    _ = VirtualMachine.get().ref_strings.remove(ref_string.hash);
}

pub fn refCountedResolvedSource(this: *VirtualMachine, code: []const u8, specifier: bun.String, source_url: []const u8, hash_: ?u32, comptime add_double_ref: bool) ResolvedSource {
    // refCountedString will panic if the code is empty
    if (code.len == 0) {
        return ResolvedSource{
            .source_code = bun.String.init(""),
            .specifier = specifier,
            .source_url = specifier.createIfDifferent(source_url),
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
        .allocator = source,
        .source_code_needs_deref = false,
    };
}

fn refCountedStringWithWasNew(this: *VirtualMachine, new: *bool, input_: []const u8, hash_: ?u32, comptime dupe: bool) *jsc.RefString {
    jsc.markBinding(@src());
    bun.assert(input_.len > 0);
    const hash = hash_ orelse jsc.RefString.computeHash(input_);
    this.ref_strings_mutex.lock();
    defer this.ref_strings_mutex.unlock();

    const entry = this.ref_strings.getOrPut(hash) catch unreachable;
    if (!entry.found_existing) {
        const input = if (comptime dupe)
            (this.allocator.dupe(u8, input_) catch unreachable)
        else
            input_;

        const ref = this.allocator.create(jsc.RefString) catch unreachable;
        ref.* = jsc.RefString{
            .allocator = this.allocator,
            .ptr = input.ptr,
            .len = input.len,
            .impl = bun.String.createExternal(*jsc.RefString, input, true, ref, &freeRefString).value.WTFStringImpl,
            .hash = hash,
            .ctx = this,
            .onBeforeDeinit = VirtualMachine.clearRefString,
        };
        entry.value_ptr.* = ref;
    }
    new.* = !entry.found_existing;
    return entry.value_ptr.*;
}

fn freeRefString(str: *jsc.RefString, _: *anyopaque, _: u32) callconv(.c) void {
    str.deinit();
}

pub fn refCountedString(this: *VirtualMachine, input_: []const u8, hash_: ?u32, comptime dupe: bool) *jsc.RefString {
    bun.assert(input_.len > 0);
    var _was_new = false;
    return this.refCountedStringWithWasNew(&_was_new, input_, hash_, comptime dupe);
}

pub fn fetchWithoutOnLoadPlugins(
    jsc_vm: *VirtualMachine,
    globalObject: *JSGlobalObject,
    _specifier: String,
    referrer: String,
    log: *logger.Log,
    comptime flags: FetchFlags,
) anyerror!ResolvedSource {
    bun.assert(VirtualMachine.isLoaded());

    if (try ModuleLoader.fetchBuiltinModule(jsc_vm, _specifier)) |builtin| {
        return builtin;
    }

    const specifier_clone = _specifier.toUTF8(bun.default_allocator);
    defer specifier_clone.deinit();
    const referrer_clone = referrer.toUTF8(bun.default_allocator);
    defer referrer_clone.deinit();

    var virtual_source_to_use: ?logger.Source = null;
    var blob_to_deinit: ?jsc.WebCore.Blob = null;
    defer if (blob_to_deinit) |*blob| blob.deinit();
    const lr = options.getLoaderAndVirtualSource(specifier_clone.slice(), jsc_vm, &virtual_source_to_use, &blob_to_deinit, null) catch {
        return error.ModuleNotFound;
    };
    const module_type: options.ModuleType = if (lr.package_json) |pkg| pkg.module_type else .unknown;

    // .print_source, which is used by exceptions avoids duplicating the entire source code
    // but that means we have to be careful of the lifetime of the source code
    // so we only want to reset the arena once its done freeing it.
    defer if (flags != .print_source) jsc_vm.module_loader.resetArena(jsc_vm);
    errdefer if (flags == .print_source) jsc_vm.module_loader.resetArena(jsc_vm);

    return try ModuleLoader.transpileSourceCode(
        jsc_vm,
        lr.specifier,
        referrer_clone.slice(),
        _specifier,
        lr.path,
        lr.loader orelse if (lr.is_main) .js else .file,
        module_type,
        log,
        lr.virtual_source,
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
    jsc_vm: *VirtualMachine,
    ret: *ResolveFunctionResult,
    specifier: string,
    source: string,
    is_esm: bool,
    comptime is_a_file_path: bool,
) !void {
    if (strings.eqlComptime(std.fs.path.basename(specifier), Runtime.Runtime.Imports.alt_name)) {
        ret.path = Runtime.Runtime.Imports.Name;
        return;
    } else if (strings.eqlComptime(specifier, main_file_name)) {
        ret.result = null;
        ret.path = jsc_vm.entry_point.source.path.text;
        return;
    } else if (strings.hasPrefixComptime(specifier, js_ast.Macro.namespaceWithColon)) {
        ret.result = null;
        ret.path = try bun.default_allocator.dupe(u8, specifier);
        return;
    } else if (strings.hasPrefixComptime(specifier, node_fallbacks.import_path)) {
        ret.result = null;
        ret.path = try bun.default_allocator.dupe(u8, specifier);
        return;
    } else if (jsc.ModuleLoader.HardcodedModule.Alias.get(specifier, .bun, .{})) |result| {
        ret.result = null;
        ret.path = result.path;
        return;
    } else if (jsc_vm.module_loader.eval_source != null and
        (strings.endsWithComptime(specifier, bun.pathLiteral("/[eval]")) or
            strings.endsWithComptime(specifier, bun.pathLiteral("/[stdin]"))))
    {
        ret.result = null;
        ret.path = try bun.default_allocator.dupe(u8, specifier);
        return;
    } else if (strings.hasPrefixComptime(specifier, "blob:")) {
        ret.result = null;
        if (jsc.WebCore.ObjectURLRegistry.singleton().has(specifier["blob:".len..])) {
            ret.path = try bun.default_allocator.dupe(u8, specifier);
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
        jsc_vm.transpiler.fs.top_level_dir;

    const result: Resolver.Result = try brk: {
        // TODO: We only want to retry on not found only when the directories we searched for were cached.
        // This fixes an issue where new files created in cached directories were not picked up.
        // See https://github.com/oven-sh/bun/issues/3216
        //
        // This cache-bust is disabled when the filesystem is not being used to resolve.
        var retry_on_not_found = std.fs.path.isAbsolute(source_to_use);
        while (true) {
            break :brk switch (jsc_vm.transpiler.resolver.resolveAndAutoInstall(
                source_to_use,
                normalized_specifier,
                if (is_esm) .stmt else .require,
                jsc_vm.transpiler.resolver.opts.global_cache,
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
                                // Normalized without trailing slash
                                break :name bun.strings.normalizeSlashesOnly(&specifier_cache_resolver_buf, dir, std.fs.path.sep);
                            }
                        }

                        var parts = [_]string{
                            source_to_use,
                            normalized_specifier,
                            bun.pathLiteral(".."),
                        };

                        break :name bun.path.joinAbsStringBufZ(
                            jsc_vm.transpiler.fs.top_level_dir,
                            &specifier_cache_resolver_buf,
                            &parts,
                            .auto,
                        );
                    };

                    // Only re-query if we previously had something cached.
                    if (jsc_vm.transpiler.resolver.bustDirCache(bun.strings.withoutTrailingSlashWindowsPath(buster_name))) {
                        continue;
                    }

                    return error.ModuleNotFound;
                },
            };
        }
    };

    if (!jsc_vm.macro_mode) {
        jsc_vm.has_any_macro_remappings = jsc_vm.has_any_macro_remappings or jsc_vm.transpiler.options.macro_remap.count() > 0;
    }
    ret.result = result;
    ret.query_string = query_string;
    const result_path = result.pathConst() orelse return error.ModuleNotFound;
    jsc_vm.resolved_count += 1;

    ret.path = result_path.text;
}

pub fn resolve(
    res: *ErrorableString,
    global: *JSGlobalObject,
    specifier: bun.String,
    source: bun.String,
    query_string: ?*ZigString,
    is_esm: bool,
) !void {
    try resolveMaybeNeedsTrailingSlash(res, global, specifier, source, query_string, is_esm, true, false);
}

fn normalizeSource(source: []const u8) []const u8 {
    if (strings.hasPrefixComptime(source, "file://")) {
        return source["file://".len..];
    }

    return source;
}

pub fn resolveMaybeNeedsTrailingSlash(
    res: *ErrorableString,
    global: *JSGlobalObject,
    specifier: bun.String,
    source: bun.String,
    query_string: ?*ZigString,
    is_esm: bool,
    comptime is_a_file_path: bool,
    is_user_require_resolve: bool,
) bun.JSError!void {
    if (is_a_file_path and specifier.length() > comptime @as(u32, @intFromFloat(@trunc(@as(f64, @floatFromInt(bun.MAX_PATH_BYTES)) * 1.5)))) {
        const specifier_utf8 = specifier.toUTF8(bun.default_allocator);
        defer specifier_utf8.deinit();
        const source_utf8 = source.toUTF8(bun.default_allocator);
        defer source_utf8.deinit();
        const printed = bun.api.ResolveMessage.fmt(
            bun.default_allocator,
            specifier_utf8.slice(),
            source_utf8.slice(),
            error.NameTooLong,
            if (is_esm) .stmt else if (is_user_require_resolve) .require_resolve else .require,
        ) catch |err| bun.handleOom(err);
        const msg = logger.Msg{
            .data = logger.rangeData(
                null,
                logger.Range.None,
                printed,
            ),
        };
        res.* = ErrorableString.err(error.NameTooLong, (try bun.api.ResolveMessage.create(global, VirtualMachine.get().allocator, msg, source_utf8.slice())));
        return;
    }

    var result = ResolveFunctionResult{ .path = "", .result = null };
    const jsc_vm = global.bunVM();
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

            if (try plugin_runner.onResolveJSC(bun.String.init(namespace), bun.String.borrowUTF8(after_namespace), source, .bun)) |resolved_path| {
                res.* = resolved_path;
                return;
            }
        }
    }

    if (jsc.ModuleLoader.HardcodedModule.Alias.get(specifier_utf8.slice(), .bun, .{})) |hardcoded| {
        res.* = ErrorableString.ok(
            if (is_user_require_resolve and hardcoded.node_builtin)
                specifier
            else
                bun.String.init(hardcoded.path),
        );
        return;
    }

    const old_log = jsc_vm.log;
    // the logger can end up being called on another thread, it must not use threadlocal Heap Allocator
    var log = logger.Log.init(bun.default_allocator);
    defer log.deinit();
    jsc_vm.log = &log;
    jsc_vm.transpiler.resolver.log = &log;
    jsc_vm.transpiler.linker.log = &log;
    defer {
        jsc_vm.log = old_log;
        jsc_vm.transpiler.linker.log = old_log;
        jsc_vm.transpiler.resolver.log = old_log;
    }
    jsc_vm._resolve(&result, specifier_utf8.slice(), normalizeSource(source_utf8.slice()), is_esm, is_a_file_path) catch |err_| {
        var err = err_;
        const msg: logger.Msg = brk: {
            const msgs: []logger.Msg = log.msgs.items;

            for (msgs) |m| {
                if (m.metadata == .resolve) {
                    err = m.metadata.resolve.err;
                    break :brk m;
                }
            }

            const import_kind: bun.ImportKind = if (is_esm)
                .stmt
            else if (is_user_require_resolve)
                .require_resolve
            else
                .require;

            const printed = try bun.api.ResolveMessage.fmt(
                jsc_vm.allocator,
                specifier_utf8.slice(),
                source_utf8.slice(),
                err,
                import_kind,
            );
            break :brk logger.Msg{
                .data = logger.rangeData(
                    null,
                    logger.Range.None,
                    printed,
                ),
                .metadata = .{
                    .resolve = .{
                        .specifier = logger.BabyString.in(printed, specifier_utf8.slice()),
                        .import_kind = import_kind,
                    },
                },
            };
        };

        {
            res.* = ErrorableString.err(err, (try bun.api.ResolveMessage.create(global, VirtualMachine.get().allocator, msg, source_utf8.slice())));
        }

        return;
    };

    if (query_string) |query| {
        query.* = ZigString.init(result.query_string);
    }

    res.* = ErrorableString.ok(bun.String.init(result.path));
}

pub const main_file_name: string = "bun:main";

pub export fn Bun__drainMicrotasksFromJS(globalObject: *JSGlobalObject, callframe: *jsc.CallFrame) callconv(jsc.conv) JSValue {
    _ = callframe; // autofix
    globalObject.bunVM().drainMicrotasks();
    return .js_undefined;
}

pub fn drainMicrotasks(this: *VirtualMachine) void {
    this.eventLoop().drainMicrotasks() catch {}; // TODO: properly propagate exception upwards
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
                            std.fmt.allocPrint(globalThis.allocator(), "Unexpected pending import in \"{f}\". To automatically install npm packages with Bun, please use an import statement instead of require() or dynamic import().\nThis error can also happen if dependencies import packages which are not referenced anywhere. Worst case, run `bun install` and opt-out of the node_modules folder until we come up with a better way to handle this error.", .{specifier}) catch unreachable,
                        ),
                    };
                }

                break :brk logger.Msg{
                    .data = logger.rangeData(null, logger.Range.None, std.fmt.allocPrint(globalThis.allocator(), "{s} while building {f}", .{ @errorName(err), specifier }) catch unreachable),
                };
            };
            {
                ret.* = ErrorableResolvedSource.err(err, (bun.api.BuildMessage.create(globalThis, globalThis.allocator(), msg) catch |e| globalThis.takeException(e)));
            }
            return;
        },

        1 => {
            const msg = log.msgs.items[0];
            ret.* = ErrorableResolvedSource.err(err, switch (msg.metadata) {
                .build => (bun.api.BuildMessage.create(globalThis, globalThis.allocator(), msg) catch |e| globalThis.takeException(e)),
                .resolve => (bun.api.ResolveMessage.create(
                    globalThis,
                    globalThis.allocator(),
                    msg,
                    referrer.toUTF8(bun.default_allocator).slice(),
                ) catch |e| globalThis.takeException(e)),
            });
            return;
        },
        else => {
            var errors_stack: [256]JSValue = undefined;

            const len = @min(log.msgs.items.len, errors_stack.len);
            const errors = errors_stack[0..len];
            const logs = log.msgs.items[0..len];

            for (logs, errors) |msg, *current| {
                current.* = switch (msg.metadata) {
                    .build => bun.api.BuildMessage.create(globalThis, globalThis.allocator(), msg) catch |e| globalThis.takeException(e),
                    .resolve => bun.api.ResolveMessage.create(
                        globalThis,
                        globalThis.allocator(),
                        msg,
                        referrer.toUTF8(bun.default_allocator).slice(),
                    ) catch |e| globalThis.takeException(e),
                };
            }

            ret.* = ErrorableResolvedSource.err(
                err,
                globalThis.createAggregateError(
                    errors,
                    &ZigString.init(
                        std.fmt.allocPrint(globalThis.allocator(), "{d} errors building \"{f}\"", .{
                            errors.len,
                            specifier,
                        }) catch unreachable,
                    ),
                ) catch |e| globalThis.takeException(e),
            );
        },
    }
}

pub fn deinit(this: *VirtualMachine) void {
    this.auto_killer.deinit();

    if (source_code_printer) |print| {
        print.getMutableBuffer().deinit();
        print.ctx.written = &.{};
    }
    this.source_mappings.deinit();
    if (this.rare_data) |rare_data| {
        rare_data.deinit();
    }
    this.overridden_main.deinit();
    this.has_terminated = true;
}

pub const ExceptionList = std.array_list.Managed(api.JsException);

pub fn printException(
    this: *VirtualMachine,
    exception: *Exception,
    exception_list: ?*ExceptionList,
    comptime Writer: type,
    writer: Writer,
    comptime allow_side_effects: bool,
) void {
    var formatter = ConsoleObject.Formatter{
        .globalThis = this.global,
        .quote_strings = false,
        .single_line = false,
        .stack_check = bun.StackCheck.init(),
    };
    defer formatter.deinit();
    if (Output.enable_ansi_colors_stderr) {
        this.printErrorlikeObject(exception.value(), exception, exception_list, &formatter, Writer, writer, true, allow_side_effects);
    } else {
        this.printErrorlikeObject(exception.value(), exception, exception_list, &formatter, Writer, writer, false, allow_side_effects);
    }
}

pub noinline fn runErrorHandler(this: *VirtualMachine, result: JSValue, exception_list: ?*ExceptionList) void {
    @branchHint(.cold);

    const prev_had_errors = this.had_errors;
    this.had_errors = false;
    defer this.had_errors = prev_had_errors;

    const writer = Output.errorWriterBuffered();
    defer {
        writer.flush() catch {};
    }

    if (result.asException(this.jsc_vm)) |exception| {
        this.printException(
            exception,
            exception_list,
            @TypeOf(writer),
            writer,
            true,
        );
    } else {
        var formatter = ConsoleObject.Formatter{
            .globalThis = this.global,
            .quote_strings = false,
            .single_line = false,
            .stack_check = bun.StackCheck.init(),
            .error_display_level = .full,
        };
        defer formatter.deinit();
        switch (Output.enable_ansi_colors_stderr) {
            inline else => |enable_colors| this.printErrorlikeObject(result, null, exception_list, &formatter, @TypeOf(writer), writer, enable_colors, true),
        }
    }
}

export fn Bun__logUnhandledException(exception: JSValue) void {
    get().runErrorHandler(exception, null);
}

pub fn clearEntryPoint(this: *VirtualMachine) bun.JSError!void {
    if (this.main.len == 0) {
        return;
    }

    var str = ZigString.init(main_file_name);
    try this.global.deleteModuleRegistryEntry(&str);
}

fn loadPreloads(this: *VirtualMachine) !?*JSInternalPromise {
    this.is_in_preload = true;
    defer this.is_in_preload = false;

    for (this.preload) |preload| {
        var result = switch (this.transpiler.resolver.resolveAndAutoInstall(
            this.transpiler.fs.top_level_dir,
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
                    "{s} resolving preload {f}",
                    .{
                        @errorName(e),
                        bun.fmt.formatJSONStringLatin1(preload),
                    },
                ) catch unreachable;
                return e;
            },
            .pending, .not_found => {
                this.log.addErrorFmt(
                    null,
                    logger.Loc.Empty,
                    this.allocator,
                    "preload not found {f}",
                    .{
                        bun.fmt.formatJSONStringLatin1(preload),
                    },
                ) catch unreachable;
                return error.ModuleNotFound;
            },
        };
        var promise = try JSModuleLoader.import(this.global, &String.fromBytes(result.path().?.text));

        this.pending_internal_promise = promise;
        JSValue.fromCell(promise).protect();
        defer JSValue.fromCell(promise).unprotect();

        // pending_internal_promise can change if hot module reloading is enabled
        if (this.isWatcherEnabled()) {
            this.eventLoop().performGC();
            switch (this.pending_internal_promise.?.status()) {
                .pending => {
                    while (this.pending_internal_promise.?.status() == .pending) {
                        this.eventLoop().tick();

                        if (this.pending_internal_promise.?.status() == .pending) {
                            this.eventLoop().autoTick();
                        }
                    }
                },
                else => {},
            }
        } else {
            this.eventLoop().performGC();
            this.waitForPromise(jsc.AnyPromise{
                .internal = promise,
            });
        }

        if (promise.status() == .rejected)
            return promise;
    }

    // only load preloads once
    this.preload.len = 0;

    return null;
}

pub fn ensureDebugger(this: *VirtualMachine, block_until_connected: bool) !void {
    if (this.debugger != null) {
        try jsc.Debugger.create(this, this.global);

        if (block_until_connected) {
            jsc.Debugger.waitForDebuggerIfNecessary(this);
        }
    }
}

extern fn Bun__loadHTMLEntryPoint(global: *JSGlobalObject) *JSInternalPromise;

pub fn reloadEntryPoint(this: *VirtualMachine, entry_path: []const u8) !*JSInternalPromise {
    this.has_loaded = false;
    this.main = entry_path;
    this.main_resolved_path.deref();
    this.main_resolved_path = .empty;
    this.main_hash = Watcher.getHash(entry_path);
    this.overridden_main.deinit();

    try this.ensureDebugger(true);

    if (!this.main_is_html_entrypoint) {
        try this.entry_point.generate(
            this.allocator,
            this.bun_watcher != .none,
            entry_path,
            main_file_name,
        );
    }

    if (!this.transpiler.options.disable_transpilation) {
        if (this.preload.len > 0) {
            if (try this.loadPreloads()) |promise| {
                JSValue.fromCell(promise).ensureStillAlive();
                JSValue.fromCell(promise).protect();
                this.pending_internal_promise = promise;
                return promise;
            }

            // Check if Module.runMain was patched
            const prev = this.pending_internal_promise;
            if (this.has_patched_run_main) {
                @branchHint(.cold);
                this.pending_internal_promise = null;
                const ret = try jsc.fromJSHostCall(this.global, @src(), NodeModuleModule__callOverriddenRunMain, .{ this.global, try bun.String.createUTF8ForJS(this.global, main_file_name) });
                if (this.pending_internal_promise == prev or this.pending_internal_promise == null) {
                    this.pending_internal_promise = JSInternalPromise.resolvedPromise(this.global, ret);
                    return this.pending_internal_promise.?;
                }
                return (this.pending_internal_promise orelse prev).?;
            }
        }

        const promise = if (!this.main_is_html_entrypoint)
            JSModuleLoader.loadAndEvaluateModule(this.global, &String.init(main_file_name)) orelse return error.JSError
        else
            try jsc.fromJSHostCallGeneric(this.global, @src(), Bun__loadHTMLEntryPoint, .{this.global});

        this.pending_internal_promise = promise;
        JSValue.fromCell(promise).ensureStillAlive();
        return promise;
    } else {
        const promise = JSModuleLoader.loadAndEvaluateModule(this.global, &String.fromBytes(this.main)) orelse return error.JSError;
        this.pending_internal_promise = promise;
        JSValue.fromCell(promise).ensureStillAlive();

        return promise;
    }
}

extern "C" fn NodeModuleModule__callOverriddenRunMain(global: *JSGlobalObject, argv1: JSValue) JSValue;
export fn Bun__VirtualMachine__setOverrideModuleRunMain(vm: *VirtualMachine, is_patched: bool) void {
    if (vm.is_in_preload) {
        vm.has_patched_run_main = is_patched;
    }
}
export fn Bun__VirtualMachine__setOverrideModuleRunMainPromise(vm: *VirtualMachine, promise: *JSInternalPromise) void {
    if (vm.pending_internal_promise == null) {
        vm.pending_internal_promise = promise;
    }
}

pub fn reloadEntryPointForTestRunner(this: *VirtualMachine, entry_path: []const u8) !*JSInternalPromise {
    this.has_loaded = false;
    this.main = entry_path;
    this.main_resolved_path.deref();
    this.main_resolved_path = .empty;
    this.main_hash = Watcher.getHash(entry_path);
    this.overridden_main.deinit();

    this.eventLoop().ensureWaker();

    try this.ensureDebugger(true);

    if (!this.transpiler.options.disable_transpilation) {
        if (try this.loadPreloads()) |promise| {
            JSValue.fromCell(promise).ensureStillAlive();
            this.pending_internal_promise = promise;
            JSValue.fromCell(promise).protect();

            return promise;
        }
    }

    const promise = JSModuleLoader.loadAndEvaluateModule(this.global, &String.fromBytes(this.main)) orelse return error.JSError;
    this.pending_internal_promise = promise;
    JSValue.fromCell(promise).ensureStillAlive();

    return promise;
}

// worker dont has bun_watcher and also we dont wanna call autoTick before dispatchOnline
pub fn loadEntryPointForWebWorker(this: *VirtualMachine, entry_path: string) anyerror!*JSInternalPromise {
    const promise = try this.reloadEntryPoint(entry_path);
    this.eventLoop().performGC();
    this.eventLoop().waitForPromiseWithTermination(jsc.AnyPromise{
        .internal = promise,
    });
    if (this.worker) |worker| {
        if (worker.hasRequestedTerminate()) {
            return error.WorkerTerminated;
        }
    }
    return this.pending_internal_promise.?;
}

pub fn loadEntryPointForTestRunner(this: *VirtualMachine, entry_path: string) anyerror!*JSInternalPromise {
    var promise = try this.reloadEntryPointForTestRunner(entry_path);

    // pending_internal_promise can change if hot module reloading is enabled
    if (this.isWatcherEnabled()) {
        this.eventLoop().performGC();
        switch (this.pending_internal_promise.?.status()) {
            .pending => {
                while (this.pending_internal_promise.?.status() == .pending) {
                    this.eventLoop().tick();

                    if (this.pending_internal_promise.?.status() == .pending) {
                        this.eventLoop().autoTick();
                    }
                }
            },
            else => {},
        }
    } else {
        if (promise.status() == .rejected) {
            return promise;
        }

        this.eventLoop().performGC();
        this.waitForPromise(.{ .internal = promise });
    }

    this.eventLoop().autoTick();

    return this.pending_internal_promise.?;
}

pub fn loadEntryPoint(this: *VirtualMachine, entry_path: string) anyerror!*JSInternalPromise {
    var promise = try this.reloadEntryPoint(entry_path);

    // pending_internal_promise can change if hot module reloading is enabled
    if (this.isWatcherEnabled()) {
        this.eventLoop().performGC();
        switch (this.pending_internal_promise.?.status()) {
            .pending => {
                while (this.pending_internal_promise.?.status() == .pending) {
                    this.eventLoop().tick();

                    if (this.pending_internal_promise.?.status() == .pending) {
                        this.eventLoop().autoTick();
                    }
                }
            },
            else => {},
        }
    } else {
        if (promise.status() == .rejected) {
            return promise;
        }

        this.eventLoop().performGC();
        this.waitForPromise(.{ .internal = promise });
    }

    return this.pending_internal_promise.?;
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
        try macro_entry_pointer.generate(&this.transpiler, Fs.PathName.init(entry_path), function_name, hash, specifier);
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
pub fn runWithAPILock(this: *VirtualMachine, comptime Context: type, ctx: *Context, comptime function: fn (ctx: *Context) void) void {
    this.global.vm().holdAPILock(ctx, jsc.OpaqueWrap(Context, function));
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
    this.waitForPromise(jsc.AnyPromise{
        .internal = promise,
    });

    return promise;
}

pub fn printErrorLikeObjectToConsole(this: *VirtualMachine, value: JSValue) void {
    this.runErrorHandler(value, null);
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
    formatter: *ConsoleObject.Formatter,
    comptime Writer: type,
    writer: *std.Io.Writer,
    comptime allow_ansi_color: bool,
    comptime allow_side_effects: bool,
) void {
    var was_internal = false;

    defer {
        if (was_internal) {
            if (exception) |exception_| {
                var holder = ZigException.Holder.init();
                var zig_exception: *ZigException = holder.zigException();
                holder.deinit(this);
                exception_.getStackTrace(this.global, &zig_exception.stack);
                if (zig_exception.stack.frames_len > 0) {
                    if (allow_ansi_color) {
                        printStackTrace(Writer, writer, zig_exception.stack, true) catch {};
                    } else {
                        printStackTrace(Writer, writer, zig_exception.stack, false) catch {};
                    }
                }

                if (exception_list) |list| {
                    zig_exception.addToErrorList(list, this.transpiler.fs.top_level_dir, &this.origin) catch {};
                }
            }
        }
    }

    if (value.isAggregateError(this.global)) {
        const AggregateErrorIterator = struct {
            writer: Writer,
            current_exception_list: ?*ExceptionList = null,
            formatter: *ConsoleObject.Formatter,

            pub fn iteratorWithColor(vm: *VM, globalObject: *JSGlobalObject, ctx: ?*anyopaque, nextValue: JSValue) callconv(.c) void {
                iterator(vm, globalObject, nextValue, ctx.?, true);
            }
            pub fn iteratorWithOutColor(vm: *VM, globalObject: *JSGlobalObject, ctx: ?*anyopaque, nextValue: JSValue) callconv(.c) void {
                iterator(vm, globalObject, nextValue, ctx.?, false);
            }
            fn iterator(_: *VM, _: *JSGlobalObject, nextValue: JSValue, ctx: ?*anyopaque, comptime color: bool) void {
                const this_ = @as(*@This(), @ptrFromInt(@intFromPtr(ctx)));
                VirtualMachine.get().printErrorlikeObject(nextValue, null, this_.current_exception_list, this_.formatter, Writer, this_.writer, color, allow_side_effects);
            }
        };
        var iter = AggregateErrorIterator{ .writer = writer, .current_exception_list = exception_list, .formatter = formatter };
        if (comptime allow_ansi_color) {
            value.getErrorsProperty(this.global).forEach(this.global, &iter, AggregateErrorIterator.iteratorWithColor) catch return; // TODO: properly propagate exception upwards
        } else {
            value.getErrorsProperty(this.global).forEach(this.global, &iter, AggregateErrorIterator.iteratorWithOutColor) catch return; // TODO: properly propagate exception upwards
        }
        return;
    }

    was_internal = this.printErrorFromMaybePrivateData(
        value,
        exception_list,
        formatter,
        Writer,
        writer,
        allow_ansi_color,
        allow_side_effects,
    );
}

fn printErrorFromMaybePrivateData(
    this: *VirtualMachine,
    value: JSValue,
    exception_list: ?*ExceptionList,
    formatter: *ConsoleObject.Formatter,
    comptime Writer: type,
    writer: *std.Io.Writer,
    comptime allow_ansi_color: bool,
    comptime allow_side_effects: bool,
) bool {
    if (value.jsType() == .DOMWrapper) {
        if (value.as(bun.api.BuildMessage)) |build_error| {
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
        } else if (value.as(bun.api.ResolveMessage)) |resolve_error| {
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
        .js,
        value,
        exception_list,
        formatter,
        Writer,
        writer,
        allow_ansi_color,
        allow_side_effects,
    ) catch |err| {
        if (err == error.JSError) {
            this.global.clearException();
        } else if (comptime Environment.isDebug) {
            // yo dawg
            Output.printErrorln("Error while printing Error-like object: {s}", .{@errorName(err)});
            Output.flush();
        }
    };

    return false;
}

pub fn reportUncaughtException(globalObject: *JSGlobalObject, exception: *Exception) JSValue {
    var jsc_vm = globalObject.bunVM();
    _ = jsc_vm.uncaughtException(globalObject, exception.value(), false);
    return .js_undefined;
}

pub fn printStackTrace(comptime Writer: type, writer: Writer, trace: ZigStackTrace, comptime allow_ansi_colors: bool) !void {
    const stack = trace.frames();
    if (stack.len > 0) {
        var vm = VirtualMachine.get();
        const origin: ?*const URL = if (vm.is_from_devserver) &vm.origin else null;
        const dir = vm.transpiler.fs.top_level_dir;

        for (stack) |frame| {
            const file_slice = frame.source_url.toUTF8(bun.default_allocator);
            defer file_slice.deinit();
            const func_slice = frame.function_name.toUTF8(bun.default_allocator);
            defer func_slice.deinit();

            const file = file_slice.slice();
            const func = func_slice.slice();

            if (file.len == 0 and func.len == 0) continue;

            const has_name = std.fmt.count("{f}", .{frame.nameFormatter(false)}) > 0;

            if (has_name and !frame.position.isInvalid()) {
                try writer.print(
                    comptime Output.prettyFmt(
                        "<r>      <d>at <r>{f}<d> (<r>{f}<d>)<r>\n",
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
            } else if (!frame.position.isInvalid()) {
                try writer.print(
                    comptime Output.prettyFmt(
                        "<r>      <d>at <r>{f}\n",
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
            } else if (has_name) {
                try writer.print(
                    comptime Output.prettyFmt(
                        "<r>      <d>at <r>{f}<d>\n",
                        allow_ansi_colors,
                    ),
                    .{
                        frame.nameFormatter(
                            allow_ansi_colors,
                        ),
                    },
                );
            } else {
                try writer.print(
                    comptime Output.prettyFmt(
                        "<r>      <d>at <r>{f}<d>\n",
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

pub export fn Bun__remapStackFramePositions(vm: *jsc.VirtualMachine, frames: [*]jsc.ZigStackFrame, frames_count: usize) void {
    // **Warning** this method can be called in the heap collector thread!!
    // https://github.com/oven-sh/bun/issues/17087
    vm.remapStackFramePositions(frames, frames_count);
}

pub fn remapStackFramePositions(this: *VirtualMachine, frames: [*]jsc.ZigStackFrame, frames_count: usize) void {
    for (frames[0..frames_count]) |*frame| {
        if (frame.position.isInvalid() or frame.remapped) continue;
        var sourceURL = frame.source_url.toUTF8(bun.default_allocator);
        defer sourceURL.deinit();

        // **Warning** this method can be called in the heap collector thread!!
        // https://github.com/oven-sh/bun/issues/17087
        this.remap_stack_frames_mutex.lock();
        defer this.remap_stack_frames_mutex.unlock();

        if (this.resolveSourceMapping(
            sourceURL.slice(),
            frame.position.line,
            frame.position.column,
            .no_source_contents,
        )) |lookup| {
            const source_map = lookup.source_map;
            defer if (source_map) |map| map.deref();
            if (lookup.displaySourceURLIfNeeded(sourceURL.slice())) |source_url| {
                frame.source_url.deref();
                frame.source_url = source_url;
            }
            const mapping = lookup.mapping;
            frame.position.line = mapping.original.lines;
            frame.position.column = mapping.original.columns;
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
    allow_source_code_preview: bool,
) void {
    error_instance.toZigException(this.global, exception);
    const enable_source_code_preview = allow_source_code_preview and
        !(bun.feature_flag.BUN_DISABLE_SOURCE_CODE_PREVIEW.get() or
            bun.feature_flag.BUN_DISABLE_TRANSPILED_SOURCE_CODE_PREVIEW.get());

    defer {
        if (Environment.isDebug) {
            if (!enable_source_code_preview and source_code_slice.* != null) {
                Output.panic("Do not collect source code when we don't need to", .{});
            } else if (!enable_source_code_preview and exception.stack.source_lines_numbers[0] != -1) {
                Output.panic("Do not collect source code when we don't need to", .{});
            }
        }
    }

    // defer this so that it copies correctly
    defer if (exception_list) |list| {
        exception.addToErrorList(list, this.transpiler.fs.top_level_dir, &this.origin) catch unreachable;
    };

    const NoisyBuiltinFunctionMap = bun.ComptimeStringMap(void, .{
        .{"asyncModuleEvaluation"},
        .{"link"},
        .{"linkAndEvaluateModule"},
        .{"moduleEvaluation"},
        .{"processTicksAndRejections"},
    });

    var frames: []jsc.ZigStackFrame = exception.stack.frames_ptr[0..exception.stack.frames_len];
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
            if ((frame.source_url.isEmpty() or frame.source_url.eqlComptime("[unknown]") or frame.source_url.hasPrefixComptime("[source:")) and
                NoisyBuiltinFunctionMap.getWithEql(frame.function_name, String.eqlComptime) != null)
            {
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
                if ((frame.source_url.isEmpty() or frame.source_url.eqlComptime("[unknown]") or frame.source_url.hasPrefixComptime("[source:")) and
                    NoisyBuiltinFunctionMap.getWithEql(frame.function_name, String.eqlComptime) != null)
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
    var top_frame_is_builtin = false;
    if (this.hide_bun_stackframes) {
        for (frames) |*frame| {
            if (frame.source_url.hasPrefixComptime("bun:") or
                frame.source_url.hasPrefixComptime("node:") or
                frame.source_url.isEmpty() or
                frame.source_url.eqlComptime("native") or
                frame.source_url.eqlComptime("unknown") or
                frame.source_url.eqlComptime("[unknown]") or
                frame.source_url.hasPrefixComptime("[source:"))
            {
                top_frame_is_builtin = true;
                continue;
            }

            top = frame;
            top_frame_is_builtin = false;
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
                    .lines = bun.Ordinal.fromZeroBased(@max(top.position.line.zeroBased(), 0)),
                    .columns = bun.Ordinal.fromZeroBased(@max(top.position.column.zeroBased(), 0)),
                },
                .source_index = 0,
            },
            .source_map = null,
            .prefetched_source_code = null,
        }
    else
        this.resolveSourceMapping(
            top_source_url.slice(),
            top.position.line,
            top.position.column,
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
            if (!enable_source_code_preview) {
                break :code ZigString.Slice.empty;
            }

            if (!top.remapped and lookup.source_map != null and lookup.source_map.?.isExternal()) {
                if (lookup.getSourceCode(top_source_url.slice())) |src| {
                    break :code src;
                }
            }

            if (top_frame_is_builtin) {
                // Avoid printing "export default 'native'"
                break :code ZigString.Slice.empty;
            }

            var log = logger.Log.init(bun.default_allocator);
            defer log.deinit();

            var original_source = fetchWithoutOnLoadPlugins(this, this.global, top.source_url, bun.String.empty, &log, .print_source) catch return;
            must_reset_parser_arena_later.* = true;
            break :code original_source.source_code.toUTF8(bun.default_allocator);
        };

        if (enable_source_code_preview and code.len == 0) {
            exception.collectSourceLines(error_instance, this.global);
        }

        if (code.len > 0)
            source_code_slice.* = code;

        top.position.line = mapping.original.lines;
        top.position.column = mapping.original.columns;

        exception.remapped = true;
        top.remapped = true;

        const last_line = @max(top.position.line.zeroBased(), 0);
        if (strings.getLinesInText(
            code.slice(),
            @intCast(last_line),
            ZigException.Holder.source_lines_count,
        )) |lines_buf| {
            var lines = lines_buf.slice();
            var source_lines = exception.stack.source_lines_ptr[0..ZigException.Holder.source_lines_count];
            var source_line_numbers = exception.stack.source_lines_numbers[0..ZigException.Holder.source_lines_count];
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
    } else if (enable_source_code_preview) {
        exception.collectSourceLines(error_instance, this.global);
    }

    if (frames.len > 1) {
        for (frames) |*frame| {
            if (frame == top or frame.position.isInvalid()) continue;
            const source_url = frame.source_url.toUTF8(bun.default_allocator);
            defer source_url.deinit();
            if (this.resolveSourceMapping(
                source_url.slice(),
                frame.position.line,
                frame.position.column,
                .no_source_contents,
            )) |lookup| {
                defer if (lookup.source_map) |map| map.deref();
                if (lookup.displaySourceURLIfNeeded(source_url.slice())) |src| {
                    frame.source_url.deref();
                    frame.source_url = src;
                }
                const mapping = lookup.mapping;
                frame.remapped = true;
                frame.position.line = mapping.original.lines;
                frame.position.column = mapping.original.columns;
            }
        }
    }
}

pub fn printExternallyRemappedZigException(
    this: *VirtualMachine,
    zig_exception: *ZigException,
    formatter: ?*ConsoleObject.Formatter,
    comptime Writer: type,
    writer: Writer,
    comptime allow_side_effects: bool,
    comptime allow_ansi_color: bool,
) !void {
    var default_formatter: ConsoleObject.Formatter = .{ .globalThis = this.global };
    defer default_formatter.deinit();
    try this.printErrorInstance(
        .zig_exception,
        zig_exception,
        null,
        formatter orelse &default_formatter,
        Writer,
        writer,
        allow_ansi_color,
        allow_side_effects,
    );
}

fn printErrorInstance(
    this: *VirtualMachine,
    comptime mode: enum { js, zig_exception },
    error_instance: switch (mode) {
        .js => JSValue,
        .zig_exception => *ZigException,
    },
    exception_list: ?*ExceptionList,
    formatter: *ConsoleObject.Formatter,
    comptime Writer: type,
    writer: Writer,
    comptime allow_ansi_color: bool,
    comptime allow_side_effects: bool,
) !void {
    var exception_holder = if (mode == .js) ZigException.Holder.init();
    var exception = if (mode == .js) exception_holder.zigException() else error_instance;
    defer if (mode == .js) exception_holder.deinit(this);
    defer if (mode == .js) error_instance.ensureStillAlive();

    // The ZigException structure stores substrings of the source code, in
    // which we need the lifetime of this data to outlive the inner call to
    // remapZigException, but still get freed.
    var source_code_slice: ?ZigString.Slice = null;
    defer if (source_code_slice) |slice| slice.deinit();

    if (mode == .js) {
        this.remapZigException(
            exception,
            error_instance,
            exception_list,
            &exception_holder.need_to_clear_parser_arena_on_deinit,
            &source_code_slice,
            formatter.error_display_level != .warn,
        );
    }
    const prev_had_errors = this.had_errors;
    this.had_errors = true;
    defer this.had_errors = prev_had_errors;

    if (allow_side_effects) {
        if (this.debugger) |*debugger| {
            debugger.lifecycle_reporter_agent.reportError(exception);
        }
    }

    defer if (allow_side_effects and Output.is_github_action)
        printGithubAnnotation(exception);

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
        try writer.splatByteAll(' ', pad);

        const trimmed = std.mem.trimRight(u8, std.mem.trim(u8, source.text.slice(), "\n"), "\t ");
        const clamped = trimmed[0..@min(trimmed.len, max_line_length)];

        if (clamped.len != trimmed.len) {
            const fmt = if (comptime allow_ansi_color) "<r><d> | ... truncated <r>\n" else "\n";
            try writer.print(
                comptime Output.prettyFmt(
                    "<r><b>{d} |<r> {f}" ++ fmt,
                    allow_ansi_color,
                ),
                .{ display_line, bun.fmt.fmtJavaScript(clamped, .{ .enable_colors = allow_ansi_color }) },
            );
        } else {
            try writer.print(
                comptime Output.prettyFmt(
                    "<r><b>{d} |<r> {f}\n",
                    allow_ansi_color,
                ),
                .{ display_line, bun.fmt.fmtJavaScript(clamped, .{ .enable_colors = allow_ansi_color }) },
            );
        }
    }

    const name = exception.name;
    const message = exception.message;

    const is_error_instance = mode == .js and
        (error_instance != .zero and error_instance.jsType() == .ErrorInstance);
    const code: ?[]const u8 = if (is_error_instance) code: {
        if (error_instance.uncheckedPtrCast(jsc.JSObject).getCodePropertyVMInquiry(this.global)) |code_value| {
            if (code_value.isString()) {
                const code_string = code_value.toBunString(this.global) catch {
                    // JSC::JSString to WTF::String can only fail on out of memory.
                    bun.outOfMemory();
                };
                defer code_string.deref();

                if (code_string.is8Bit()) {
                    // We can count on this memory being valid until the end
                    // of this function because
                    break :code code_string.latin1();
                }
            }
        }
        break :code null;
    } else null;

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
                        "<r><b>- |<r> {f}" ++ fmt,
                        allow_ansi_color,
                    ),
                    .{bun.fmt.fmtJavaScript(text, .{ .enable_colors = allow_ansi_color })},
                );
            } else {
                try writer.print(
                    comptime Output.prettyFmt(
                        "<r><d>- |<r> {f}\n",
                        allow_ansi_color,
                    ),
                    .{bun.fmt.fmtJavaScript(text, .{ .enable_colors = allow_ansi_color })},
                );
            }

            try this.printErrorNameAndMessage(name, message, !exception.browser_url.isEmpty(), code, Writer, writer, allow_ansi_color, formatter.error_display_level);
        } else if (top_frame) |top| {
            defer did_print_name = true;
            const display_line = source.line + 1;
            const int_size = std.fmt.count("{d}", .{display_line});
            const pad = max_line_number_pad - int_size;
            try writer.splatByteAll(' ', pad);
            defer source.text.deinit();
            const text = source.text.slice();
            const trimmed = std.mem.trimRight(u8, std.mem.trim(u8, text, "\n"), "\t ");

            // TODO: preserve the divot position and possibly use stringWidth() to figure out where to put the divot
            const clamped = trimmed[0..@min(trimmed.len, max_line_length)];

            if (clamped.len != trimmed.len) {
                const fmt = if (comptime allow_ansi_color) "<r><d> | ... truncated <r>\n\n" else "\n\n";
                try writer.print(
                    comptime Output.prettyFmt(
                        "<r><b>{d} |<r> {f}" ++ fmt,
                        allow_ansi_color,
                    ),
                    .{ display_line, bun.fmt.fmtJavaScript(clamped, .{ .enable_colors = allow_ansi_color }) },
                );
            } else {
                try writer.print(
                    comptime Output.prettyFmt(
                        "<r><b>{d} |<r> {f}\n",
                        allow_ansi_color,
                    ),
                    .{ display_line, bun.fmt.fmtJavaScript(clamped, .{ .enable_colors = allow_ansi_color }) },
                );

                if (clamped.len < max_line_length_with_divot or top.position.column.zeroBased() > max_line_length_with_divot) {
                    const indent = max_line_number_pad + " | ".len + @as(u64, @intCast(top.position.column.zeroBased()));

                    try writer.splatByteAll(' ', indent);
                    try writer.print(comptime Output.prettyFmt(
                        "<red><b>^<r>\n",
                        allow_ansi_color,
                    ), .{});
                } else {
                    try writer.writeAll("\n");
                }
            }

            try this.printErrorNameAndMessage(name, message, !exception.browser_url.isEmpty(), code, Writer, writer, allow_ansi_color, formatter.error_display_level);
        }
    }

    if (!did_print_name) {
        try this.printErrorNameAndMessage(name, message, !exception.browser_url.isEmpty(), code, Writer, writer, allow_ansi_color, formatter.error_display_level);
    }

    // This is usually unsafe to do, but we are protecting them each time first
    var errors_to_append = std.array_list.Managed(JSValue).init(this.allocator);
    defer {
        for (errors_to_append.items) |err| {
            err.unprotect();
        }
        errors_to_append.deinit();
    }

    if (is_error_instance) {
        var saw_cause = false;
        const Iterator = jsc.JSPropertyIterator(.{
            .include_value = true,
            .skip_empty_name = true,
            .own_properties_only = true,
            .observable = false,
            .only_non_index_properties = true,
        });
        // SAFETY: error instances are always objects
        const error_obj = error_instance.getObject().?;
        var iterator = try Iterator.init(this.global, error_obj);
        defer iterator.deinit();
        const longest_name = @min(iterator.getLongestPropertyName(), 10);
        var is_first_property = true;
        while (try iterator.next()) |field| {
            const value = iterator.value;
            if (field.eqlComptime("message") or field.eqlComptime("name") or field.eqlComptime("stack")) {
                continue;
            }

            // We special-case the code property. Let's avoid printing it twice.
            if (field.eqlComptime("code") and code != null) {
                continue;
            }

            const kind = value.jsType();
            if (kind == .ErrorInstance and
                // avoid infinite recursion
                !prev_had_errors)
            {
                if (field.eqlComptime("cause")) {
                    saw_cause = true;
                }
                value.protect();
                try errors_to_append.append(value);
            } else if (kind.isObject() or kind.isArray() or value.isPrimitive() or kind.isStringLike()) {
                var bun_str = bun.String.empty;
                defer bun_str.deref();
                const prev_disable_inspect_custom = formatter.disable_inspect_custom;
                const prev_quote_strings = formatter.quote_strings;
                const prev_max_depth = formatter.max_depth;
                const prev_format_buffer_as_text = formatter.format_buffer_as_text;
                formatter.depth += 1;
                formatter.format_buffer_as_text = true;
                defer {
                    formatter.depth -= 1;
                    formatter.max_depth = prev_max_depth;
                    formatter.quote_strings = prev_quote_strings;
                    formatter.disable_inspect_custom = prev_disable_inspect_custom;
                    formatter.format_buffer_as_text = prev_format_buffer_as_text;
                }
                formatter.max_depth = 1;
                formatter.quote_strings = true;
                formatter.disable_inspect_custom = true;

                const pad_left = longest_name -| field.length();
                is_first_property = false;
                try writer.splatByteAll(' ', pad_left);

                try writer.print(comptime Output.prettyFmt(" {f}<r><d>:<r> ", allow_ansi_color), .{field});

                // When we're printing errors for a top-level uncaught exception / rejection, suppress further errors here.
                if (allow_side_effects) {
                    if (this.global.hasException()) {
                        this.global.clearException();
                    }
                }

                formatter.format(
                    try jsc.Formatter.Tag.getAdvanced(
                        value,
                        this.global,
                        .{ .disable_inspect_custom = true, .hide_global = true },
                    ),
                    Writer,
                    writer,
                    value,
                    this.global,
                    allow_ansi_color,
                ) catch {};

                if (allow_side_effects) {
                    // When we're printing errors for a top-level uncaught exception / rejection, suppress further errors here.
                    if (this.global.hasException()) {
                        this.global.clearException();
                    }
                } else if (this.global.hasException() or formatter.failed) {
                    return;
                }

                try writer.writeAll(comptime Output.prettyFmt("<r><d>,<r>\n", allow_ansi_color));
            }
        }

        if (code) |code_str| {
            const pad_left = longest_name -| "code".len;
            is_first_property = false;
            try writer.splatByteAll(' ', pad_left);

            try writer.print(comptime Output.prettyFmt(" code<r><d>:<r> <green>{f}<r>\n", allow_ansi_color), .{
                bun.fmt.quote(code_str),
            });
        }

        if (!is_first_property) {
            try writer.writeAll("\n");
        }

        // "cause" is not enumerable, so the above loop won't see it.
        if (!saw_cause) {
            if (try error_instance.getOwn(this.global, "cause")) |cause| {
                if (cause.jsType() == .ErrorInstance) {
                    cause.protect();
                    try errors_to_append.append(cause);
                }
            }
        }
    } else if (mode == .js and error_instance != .zero) {
        // If you do reportError([1,2,3]] we should still show something at least.
        const tag = try jsc.Formatter.Tag.getAdvanced(
            error_instance,
            this.global,
            .{ .disable_inspect_custom = true, .hide_global = true },
        );
        if (tag.tag != .NativeCode) {
            try formatter.format(
                tag,
                Writer,
                writer,
                error_instance,
                this.global,
                allow_ansi_color,
            );

            // Always include a newline in this case
            try writer.writeAll("\n");
        }
    }

    try printStackTrace(@TypeOf(writer), writer, exception.stack, allow_ansi_color);

    if (!exception.browser_url.isEmpty()) {
        try writer.print(
            comptime Output.prettyFmt(
                "    <d>from <r>browser tab <magenta>{f}<r>\n",
                allow_ansi_color,
            ),
            .{exception.browser_url},
        );
    }

    for (errors_to_append.items) |err| {
        // Check for circular references to prevent infinite recursion in cause chains
        if (formatter.map_node == null) {
            formatter.map_node = ConsoleObject.Formatter.Visited.Pool.get(default_allocator);
            formatter.map_node.?.data.clearRetainingCapacity();
            formatter.map = formatter.map_node.?.data;
        }

        const entry = formatter.map.getOrPut(err) catch unreachable;
        if (entry.found_existing) {
            try writer.writeAll("\n");
            try writer.writeAll(comptime Output.prettyFmt("<r><cyan>[Circular]<r>", allow_ansi_color));
            continue;
        }

        try writer.writeAll("\n");
        try this.printErrorInstance(.js, err, exception_list, formatter, Writer, writer, allow_ansi_color, allow_side_effects);
        _ = formatter.map.remove(err);
    }
}

fn printErrorNameAndMessage(
    _: *VirtualMachine,
    name: String,
    message: String,
    is_browser_error: bool,
    optional_code: ?[]const u8,
    comptime Writer: type,
    writer: Writer,
    comptime allow_ansi_color: bool,
    error_display_level: ConsoleObject.FormatOptions.ErrorDisplayLevel,
) !void {
    if (is_browser_error) {
        try writer.writeAll(Output.prettyFmt("<red>frontend<r> ", true));
    }
    if (!name.isEmpty() and !message.isEmpty()) {
        const display_name, const display_message = if (name.eqlComptime("Error")) brk: {
            // If `err.code` is set, and `err.message` is of form `{code}: {text}`,
            // use the code as the name since `error: ENOENT: no such ...` is
            // not as nice looking since it there are two error prefixes.
            if (optional_code) |code| if (bun.strings.isAllASCII(code)) {
                const has_prefix = switch (message.isUTF16()) {
                    inline else => |is_utf16| has_prefix: {
                        const msg_chars = if (is_utf16) message.utf16() else message.latin1();
                        // + 1 to ensure the message is a non-empty string.
                        break :has_prefix msg_chars.len > code.len + ": ".len + 1 and
                            (if (is_utf16)
                                // there is no existing function to perform this slice comparison
                                // []const u16, []const u8
                                for (code, msg_chars[0..code.len]) |a, b| {
                                    if (a != b) break false;
                                } else true
                            else
                                bun.strings.eqlLong(msg_chars[0..code.len], code, false)) and
                            msg_chars[code.len] == ':' and
                            msg_chars[code.len + 1] == ' ';
                    },
                };
                if (has_prefix) break :brk .{
                    String.init(code),
                    message.substring(code.len + ": ".len),
                };
            };

            break :brk .{ String.empty, message };
        } else .{ name, message };
        try writer.print(comptime Output.prettyFmt("{f}<b>{f}<r>\n", allow_ansi_color), .{
            error_display_level.formatter(display_name, allow_ansi_color, .include_colon),
            display_message,
        });
    } else if (!name.isEmpty()) {
        try writer.print("{f}\n", .{error_display_level.formatter(name, allow_ansi_color, .include_colon)});
    } else if (!message.isEmpty()) {
        try writer.print(comptime Output.prettyFmt("{f}<b>{f}<r>\n", allow_ansi_color), .{ error_display_level.formatter(bun.String.empty, allow_ansi_color, .include_colon), message });
    } else {
        try writer.print(comptime Output.prettyFmt("{f}\n", allow_ansi_color), .{error_display_level.formatter(bun.String.empty, allow_ansi_color, .exclude_colon)});
    }
}

// In Github Actions, emit an annotation that renders the error and location.
// https://docs.github.com/en/actions/using-workflows/workflow-commands-for-github-actions#setting-an-error-message
pub noinline fn printGithubAnnotation(exception: *ZigException) void {
    @branchHint(.cold);
    const name = exception.name;
    const message = exception.message;
    const frames = exception.stack.frames();
    const top_frame = if (frames.len > 0) frames[0] else null;
    const dir = bun.env_var.GITHUB_WORKSPACE.get() orelse bun.fs.FileSystem.instance.top_level_dir;
    const allocator = bun.default_allocator;
    Output.flush();

    var writer = Output.errorWriterBuffered();
    defer {
        writer.flush() catch {};
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
        writer.print("{f}", .{name.githubAction()}) catch {};
    }

    if (!message.isEmpty()) {
        const message_slice = message.toUTF8(allocator);
        defer message_slice.deinit();
        const msg = message_slice.slice();

        var cursor: u32 = 0;
        while (strings.indexOfNewlineOrNonASCIIOrANSI(msg, cursor)) |i| {
            cursor = i + 1;
            if (msg[i] == '\n') {
                const first_line = bun.String.borrowUTF8(msg[0..i]);
                writer.print(": {f}::", .{first_line.githubAction()}) catch {};
                break;
            }
        } else {
            writer.print(": {f}::", .{message.githubAction()}) catch {};
        }

        while (strings.indexOfNewlineOrNonASCIIOrANSI(msg, cursor)) |i| {
            cursor = i + 1;
            if (msg[i] == '\n') {
                break;
            }
        }

        if (cursor > 0) {
            const body = ZigString.initUTF8(msg[cursor..]);
            writer.print("{f}", .{body.githubAction()}) catch {};
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

            const has_name = std.fmt.count("{f}", .{frame.nameFormatter(
                false,
            )}) > 0;

            // %0A = escaped newline
            if (has_name) {
                writer.print(
                    "%0A      at {f} ({f})",
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
                    "%0A      at {f}",
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

pub fn resolveSourceMapping(
    this: *VirtualMachine,
    path: []const u8,
    line: Ordinal,
    column: Ordinal,
    source_handling: SourceMap.SourceContentHandling,
) ?SourceMap.Mapping.Lookup {
    return this.source_mappings.resolveMapping(path, line, column, source_handling) orelse {
        if (this.standalone_module_graph) |graph| {
            const file = graph.find(path) orelse return null;
            const map = file.sourcemap.load() orelse return null;

            map.ref();

            this.source_mappings.putValue(path, SavedSourceMap.Value.init(map)) catch
                bun.outOfMemory();

            const mapping = map.mappings.find(line, column) orelse
                return null;

            return .{
                .mapping = mapping,
                .source_map = map,
                .prefetched_source_code = null,
            };
        }

        return null;
    };
}

extern fn Process__emitMessageEvent(global: *JSGlobalObject, value: JSValue, handle: JSValue) void;
extern fn Process__emitDisconnectEvent(global: *JSGlobalObject) void;
pub extern fn Process__emitErrorEvent(global: *JSGlobalObject, value: JSValue) void;

pub const IPCInstanceUnion = union(enum) {
    /// IPC is put in this "enabled but not started" state when IPC is detected
    /// but the client JavaScript has not yet done `.on("message")`
    waiting: struct {
        fd: bun.FD,
        mode: IPC.Mode,
    },
    initialized: *IPCInstance,
};

pub const IPCInstance = struct {
    pub const new = bun.TrivialNew(@This());
    pub const deinit = bun.TrivialDeinit(@This());

    globalThis: *JSGlobalObject,
    context: if (Environment.isPosix) *uws.SocketContext else void,
    data: IPC.SendQueue,
    has_disconnect_called: bool = false,

    const node_cluster_binding = @import("./node/node_cluster_binding.zig");

    pub fn ipc(this: *IPCInstance) ?*IPC.SendQueue {
        return &this.data;
    }
    pub fn getGlobalThis(this: *IPCInstance) ?*JSGlobalObject {
        return this.globalThis;
    }

    pub fn handleIPCMessage(this: *IPCInstance, message: IPC.DecodedIPCMessage, handle: JSValue) void {
        jsc.markBinding(@src());
        const globalThis = this.globalThis;
        const event_loop = jsc.VirtualMachine.get().eventLoop();

        switch (message) {
            // In future versions we can read this in order to detect version mismatches,
            // or disable future optimizations if the subprocess is old.
            .version => |v| {
                IPC.log("Parent IPC version is {d}", .{v});
            },
            .data => |data| {
                IPC.log("Received IPC message from parent", .{});
                event_loop.enter();
                defer event_loop.exit();
                Process__emitMessageEvent(globalThis, data, handle);
            },
            .internal => |data| {
                IPC.log("Received IPC internal message from parent", .{});
                event_loop.enter();
                defer event_loop.exit();
                node_cluster_binding.handleInternalMessageChild(globalThis, data) catch return;
            },
        }
    }

    pub fn handleIPCClose(this: *IPCInstance) void {
        IPC.log("IPCInstance#handleIPCClose", .{});
        var vm = VirtualMachine.get();
        const event_loop = vm.eventLoop();
        node_cluster_binding.child_singleton.deinit();
        event_loop.enter();
        Process__emitDisconnectEvent(vm.global);
        event_loop.exit();
        if (Environment.isPosix) {
            this.context.deinit(false);
        }
        vm.channel_ref.disable();
    }

    export fn Bun__closeChildIPC(global: *JSGlobalObject) void {
        if (global.bunVM().getIPCInstance()) |current_ipc| {
            current_ipc.data.closeSocketNextTick(true);
        }
    }

    pub const Handlers = IPC.NewIPCHandler(IPCInstance);
};

pub fn initIPCInstance(this: *VirtualMachine, fd: bun.FD, mode: IPC.Mode) void {
    IPC.log("initIPCInstance {f}", .{fd});
    this.ipc = .{ .waiting = .{ .fd = fd, .mode = mode } };
}

pub fn getIPCInstance(this: *VirtualMachine) ?*IPCInstance {
    if (this.ipc == null) return null;
    if (this.ipc.? != .waiting) return this.ipc.?.initialized;
    const opts = this.ipc.?.waiting;

    IPC.log("getIPCInstance {f}", .{opts.fd});

    this.event_loop.ensureWaker();

    const instance = switch (Environment.os) {
        else => instance: {
            const context = uws.SocketContext.createNoSSLContext(this.event_loop_handle.?, @sizeOf(usize)).?;
            IPC.Socket.configure(context, true, *IPC.SendQueue, IPC.IPCHandlers.PosixSocket);

            var instance = IPCInstance.new(.{
                .globalThis = this.global,
                .context = context,
                .data = undefined,
            });

            this.ipc = .{ .initialized = instance };

            instance.data = .init(opts.mode, .{ .virtual_machine = instance }, .uninitialized);

            const socket = IPC.Socket.fromFd(context, opts.fd, IPC.SendQueue, &instance.data, null, true) orelse {
                instance.deinit();
                this.ipc = null;
                Output.warn("Unable to start IPC socket", .{});
                return null;
            };
            socket.setTimeout(0);

            instance.data.socket = .{ .open = socket };

            break :instance instance;
        },
        .windows => instance: {
            var instance = IPCInstance.new(.{
                .globalThis = this.global,
                .context = {},
                .data = undefined,
            });
            instance.data = .init(opts.mode, .{ .virtual_machine = instance }, .uninitialized);

            this.ipc = .{ .initialized = instance };

            instance.data.windowsConfigureClient(opts.fd) catch {
                instance.deinit();
                this.ipc = null;
                Output.warn("Unable to start IPC pipe '{f}'", .{opts.fd});
                return null;
            };

            break :instance instance;
        },
    };

    instance.data.writeVersionPacket(this.global);

    return instance;
}

/// To satisfy the interface from NewHotReloader()
pub fn getLoaders(vm: *VirtualMachine) *bun.options.Loader.HashTable {
    return &vm.transpiler.options.loaders;
}

/// To satisfy the interface from NewHotReloader()
pub fn bustDirCache(vm: *VirtualMachine, path: []const u8) bool {
    return vm.transpiler.resolver.bustDirCache(path);
}

pub const ExitHandler = struct {
    exit_code: u8 = 0,

    pub export fn Bun__getExitCode(vm: *VirtualMachine) u8 {
        return vm.exit_handler.exit_code;
    }

    pub export fn Bun__setExitCode(vm: *VirtualMachine, code: u8) void {
        vm.exit_handler.exit_code = code;
    }

    extern fn Process__dispatchOnBeforeExit(*JSGlobalObject, code: u8) void;
    extern fn Process__dispatchOnExit(*JSGlobalObject, code: u8) void;
    extern fn Bun__closeAllSQLiteDatabasesForTermination() void;

    pub fn dispatchOnExit(this: *ExitHandler) void {
        jsc.markBinding(@src());
        const vm: *VirtualMachine = @alignCast(@fieldParentPtr("exit_handler", this));
        Process__dispatchOnExit(vm.global, this.exit_code);
        if (vm.isMainThread()) {
            Bun__closeAllSQLiteDatabasesForTermination();
        }
    }

    pub fn dispatchOnBeforeExit(this: *ExitHandler) void {
        jsc.markBinding(@src());
        const vm: *VirtualMachine = @alignCast(@fieldParentPtr("exit_handler", this));
        jsc.fromJSHostCallGeneric(vm.global, @src(), Process__dispatchOnBeforeExit, .{ vm.global, this.exit_code }) catch return;
    }
};

const string = []const u8;

const Config = @import("./config.zig");
const Counters = @import("./Counters.zig");
const Fs = @import("../fs.zig");
const IPC = @import("./ipc.zig");
const Resolver = @import("../resolver/resolver.zig");
const Runtime = @import("../runtime.zig");
const node_module_module = @import("./bindings/NodeModuleModule.zig");
const std = @import("std");
const PackageManager = @import("../install/install.zig").PackageManager;
const URL = @import("../url.zig").URL;
const Allocator = std.mem.Allocator;

const CPUProfiler = @import("./bindings/BunCPUProfiler.zig");
const CPUProfilerConfig = CPUProfiler.CPUProfilerConfig;

const HeapProfiler = @import("./bindings/BunHeapProfiler.zig");
const HeapProfilerConfig = HeapProfiler.HeapProfilerConfig;

const bun = @import("bun");
const Async = bun.Async;
const DotEnv = bun.DotEnv;
const Environment = bun.Environment;
const Global = bun.Global;
const MutableString = bun.MutableString;
const Ordinal = bun.Ordinal;
const Output = bun.Output;
const SourceMap = bun.SourceMap;
const String = bun.String;
const Transpiler = bun.Transpiler;
const Watcher = bun.Watcher;
const default_allocator = bun.default_allocator;
const js_ast = bun.ast;
const js_printer = bun.js_printer;
const logger = bun.logger;
const options = bun.options;
const strings = bun.strings;
const uws = bun.uws;
const Arena = bun.allocators.MimallocArena;
const PluginRunner = bun.transpiler.PluginRunner;
const api = bun.schema.api;
const DNSResolver = bun.api.dns.Resolver;

const jsc = bun.jsc;
const ConsoleObject = jsc.ConsoleObject;
const ErrorableResolvedSource = jsc.ErrorableResolvedSource;
const ErrorableString = jsc.ErrorableString;
const EventLoop = jsc.EventLoop;
const Exception = jsc.Exception;
const JSGlobalObject = jsc.JSGlobalObject;
const JSInternalPromise = jsc.JSInternalPromise;
const JSModuleLoader = jsc.JSModuleLoader;
const JSValue = jsc.JSValue;
const Node = jsc.Node;
const ResolvedSource = jsc.ResolvedSource;
const SavedSourceMap = jsc.SavedSourceMap;
const VM = jsc.VM;
const ZigException = jsc.ZigException;
const ZigStackTrace = jsc.ZigStackTrace;
const ZigString = jsc.ZigString;
const Bun = jsc.API.Bun;

const ModuleLoader = jsc.ModuleLoader;
const FetchFlags = ModuleLoader.FetchFlags;
const RuntimeTranspilerStore = jsc.ModuleLoader.RuntimeTranspilerStore;
const node_fallbacks = ModuleLoader.node_fallbacks;

const HotReloader = jsc.hot_reloader.HotReloader;
const ImportWatcher = jsc.hot_reloader.ImportWatcher;

const MacroEntryPoint = bun.transpiler.EntryPoints.MacroEntryPoint;
const ServerEntryPoint = bun.transpiler.EntryPoints.ServerEntryPoint;

const webcore = bun.webcore;
const Body = webcore.Body;
