//! Shared implementation of Web and Node `Worker`
const bun = @import("bun");
const jsc = bun.jsc;
const Output = bun.Output;
const log = Output.scoped(.Worker, true);
const std = @import("std");
const JSValue = jsc.JSValue;
const Async = bun.Async;
const WTFStringImpl = @import("../string.zig").WTFStringImpl;
const WebWorker = @This();

/// null when haven't started yet
vm: ?*jsc.VirtualMachine = null,
status: std.atomic.Value(Status) = .init(.start),
/// To prevent UAF, the `spin` function (aka the worker's event loop) will call deinit once this is set and properly exit the loop.
requested_terminate: std.atomic.Value(bool) = .init(false),
execution_context_id: u32 = 0,
parent_context_id: u32 = 0,
parent: *jsc.VirtualMachine,

/// To be resolved on the Worker thread at startup, in spin().
unresolved_specifier: []const u8,
preloads: [][]const u8 = &.{},
store_fd: bool = false,
arena: ?bun.MimallocArena = null,
name: [:0]const u8 = "Worker",
cpp_worker: *anyopaque,
mini: bool,
// Most of our code doesn't care whether `eval` was passed, because worker_threads.ts
// automatically passes a Blob URL instead of a file path if `eval` is true. But, if `eval` is
// true, then we need to make sure that `process.argv` contains "[worker eval]" instead of the
// Blob URL.
eval_mode: bool,

/// `user_keep_alive` is the state of the user's .ref()/.unref() calls
/// if false, then the parent poll will always be unref, otherwise the worker's event loop will keep the poll alive.
user_keep_alive: bool = false,
worker_event_loop_running: bool = true,
parent_poll_ref: Async.KeepAlive = .{},

// kept alive by C++ Worker object
argv: []const WTFStringImpl,
execArgv: ?[]const WTFStringImpl,

/// Used to distinguish between terminate() called by exit(), and terminate() called for other reasons
exit_called: bool = false,

pub const Status = enum(u8) {
    start,
    starting,
    running,
    terminated,
};

extern fn WebWorker__dispatchExit(?*jsc.JSGlobalObject, *anyopaque, i32) void;
extern fn WebWorker__dispatchOnline(cpp_worker: *anyopaque, *jsc.JSGlobalObject) void;
extern fn WebWorker__fireEarlyMessages(cpp_worker: *anyopaque, *jsc.JSGlobalObject) void;
extern fn WebWorker__dispatchError(*jsc.JSGlobalObject, *anyopaque, bun.String, JSValue) void;

export fn WebWorker__getParentWorker(vm: *jsc.VirtualMachine) ?*anyopaque {
    const worker = vm.worker orelse return null;
    return worker.cpp_worker;
}

pub fn hasRequestedTerminate(this: *const WebWorker) bool {
    return this.requested_terminate.load(.monotonic);
}

pub fn setRequestedTerminate(this: *WebWorker) bool {
    return this.requested_terminate.swap(true, .release);
}

export fn WebWorker__updatePtr(worker: *WebWorker, ptr: *anyopaque) bool {
    worker.cpp_worker = ptr;

    var thread = std.Thread.spawn(
        .{ .stack_size = bun.default_thread_stack_size },
        startWithErrorHandling,
        .{worker},
    ) catch {
        worker.deinit();
        return false;
    };
    thread.detach();
    return true;
}

fn resolveEntryPointSpecifier(
    parent: *jsc.VirtualMachine,
    str: []const u8,
    error_message: *bun.String,
    logger: *bun.logger.Log,
) ?[]const u8 {
    if (parent.standalone_module_graph) |graph| {
        if (graph.find(str) != null) {
            return str;
        }

        // Since `bun build --compile` renames files to `.js` by
        // default, we need to do the reverse of our file extension
        // mapping.
        //
        //   new Worker("./foo") -> new Worker("./foo.js")
        //   new Worker("./foo.ts") -> new Worker("./foo.js")
        //   new Worker("./foo.jsx") -> new Worker("./foo.js")
        //   new Worker("./foo.mjs") -> new Worker("./foo.js")
        //   new Worker("./foo.mts") -> new Worker("./foo.js")
        //   new Worker("./foo.cjs") -> new Worker("./foo.js")
        //   new Worker("./foo.cts") -> new Worker("./foo.js")
        //   new Worker("./foo.tsx") -> new Worker("./foo.js")
        //
        if (bun.strings.hasPrefixComptime(str, "./") or bun.strings.hasPrefixComptime(str, "../")) try_from_extension: {
            var pathbuf: bun.PathBuffer = undefined;
            var base = str;

            base = bun.path.joinAbsStringBuf(bun.StandaloneModuleGraph.base_public_path_with_default_suffix, &pathbuf, &.{str}, .loose);
            const extname = std.fs.path.extension(base);

            // ./foo -> ./foo.js
            if (extname.len == 0) {
                pathbuf[base.len..][0..3].* = ".js".*;
                if (graph.find(pathbuf[0 .. base.len + 3])) |js_file| {
                    return js_file.name;
                }

                break :try_from_extension;
            }

            // ./foo.ts -> ./foo.js
            if (bun.strings.eqlComptime(extname, ".ts")) {
                pathbuf[base.len - 3 .. base.len][0..3].* = ".js".*;
                if (graph.find(pathbuf[0..base.len])) |js_file| {
                    return js_file.name;
                }

                break :try_from_extension;
            }

            if (extname.len == 4) {
                inline for (.{ ".tsx", ".jsx", ".mjs", ".mts", ".cts", ".cjs" }) |ext| {
                    if (bun.strings.eqlComptime(extname, ext)) {
                        pathbuf[base.len - ext.len ..][0..".js".len].* = ".js".*;
                        const as_js = pathbuf[0 .. base.len - ext.len + ".js".len];
                        if (graph.find(as_js)) |js_file| {
                            return js_file.name;
                        }
                        break :try_from_extension;
                    }
                }
            }
        }
    }

    if (bun.webcore.ObjectURLRegistry.isBlobURL(str)) {
        if (bun.webcore.ObjectURLRegistry.singleton().has(str["blob:".len..])) {
            return str;
        } else {
            error_message.* = bun.String.static("Blob URL is missing");
            return null;
        }
    }

    var resolved_entry_point: bun.resolver.Result = parent.transpiler.resolveEntryPoint(str) catch {
        const out = (logger.toJS(parent.global, bun.default_allocator, "Error resolving Worker entry point") catch bun.outOfMemory()).toBunString(parent.global) catch {
            error_message.* = bun.String.static("unexpected exception");
            return null;
        };
        error_message.* = out;
        return null;
    };

    const entry_path: *bun.fs.Path = resolved_entry_point.path() orelse {
        error_message.* = bun.String.static("Worker entry point is missing");
        return null;
    };
    return entry_path.text;
}

pub fn create(
    cpp_worker: *void,
    parent: *jsc.VirtualMachine,
    name_str: bun.String,
    specifier_str: bun.String,
    error_message: *bun.String,
    parent_context_id: u32,
    this_context_id: u32,
    mini: bool,
    default_unref: bool,
    eval_mode: bool,
    argv_ptr: ?[*]WTFStringImpl,
    argv_len: usize,
    inherit_execArgv: bool,
    execArgv_ptr: ?[*]WTFStringImpl,
    execArgv_len: usize,
    preload_modules_ptr: ?[*]bun.String,
    preload_modules_len: usize,
) callconv(.c) ?*WebWorker {
    jsc.markBinding(@src());
    log("[{d}] WebWorker.create", .{this_context_id});
    var spec_slice = specifier_str.toUTF8(bun.default_allocator);
    defer spec_slice.deinit();
    const prev_log = parent.transpiler.log;
    var temp_log = bun.logger.Log.init(bun.default_allocator);
    parent.transpiler.setLog(&temp_log);
    defer parent.transpiler.setLog(prev_log);
    defer temp_log.deinit();

    const preload_modules = if (preload_modules_ptr) |ptr| ptr[0..preload_modules_len] else &.{};

    var preloads = std.ArrayList([]const u8).initCapacity(bun.default_allocator, preload_modules_len) catch bun.outOfMemory();
    for (preload_modules) |module| {
        const utf8_slice = module.toUTF8(bun.default_allocator);
        defer utf8_slice.deinit();
        if (resolveEntryPointSpecifier(parent, utf8_slice.slice(), error_message, &temp_log)) |preload| {
            preloads.append(bun.default_allocator.dupe(u8, preload) catch bun.outOfMemory()) catch bun.outOfMemory();
        }

        if (!error_message.isEmpty()) {
            for (preloads.items) |preload| {
                bun.default_allocator.free(preload);
            }
            preloads.deinit();
            return null;
        }
    }

    var worker = bun.default_allocator.create(WebWorker) catch bun.outOfMemory();
    worker.* = WebWorker{
        .cpp_worker = cpp_worker,
        .parent = parent,
        .parent_context_id = parent_context_id,
        .execution_context_id = this_context_id,
        .mini = mini,
        .eval_mode = eval_mode,
        .unresolved_specifier = (spec_slice.toOwned(bun.default_allocator) catch bun.outOfMemory()).slice(),
        .store_fd = parent.transpiler.resolver.store_fd,
        .name = brk: {
            if (!name_str.isEmpty()) {
                break :brk std.fmt.allocPrintZ(bun.default_allocator, "{}", .{name_str}) catch bun.outOfMemory();
            }
            break :brk "";
        },
        .user_keep_alive = !default_unref,
        .worker_event_loop_running = true,
        .argv = if (argv_ptr) |ptr| ptr[0..argv_len] else &.{},
        .execArgv = if (inherit_execArgv) null else (if (execArgv_ptr) |ptr| ptr[0..execArgv_len] else &.{}),
        .preloads = preloads.items,
    };

    worker.parent_poll_ref.ref(parent);

    return worker;
}

pub fn startWithErrorHandling(
    this: *WebWorker,
) void {
    bun.Analytics.Features.workers_spawned += 1;
    start(this) catch |err| {
        Output.panic("An unhandled error occurred while starting a worker: {s}\n", .{@errorName(err)});
    };
}

pub fn start(
    this: *WebWorker,
) anyerror!void {
    if (this.name.len > 0) {
        Output.Source.configureNamedThread(this.name);
    } else {
        Output.Source.configureNamedThread("Worker");
    }

    if (this.hasRequestedTerminate()) {
        this.exitAndDeinit();
        return;
    }

    assert(this.status.load(.acquire) == .start);
    assert(this.vm == null);

    var transform_options = this.parent.transpiler.options.transform_options;

    if (this.execArgv) |exec_argv| parse_new_args: {
        var new_args: std.ArrayList([]const u8) = try .initCapacity(bun.default_allocator, exec_argv.len);
        defer {
            for (new_args.items) |arg| {
                bun.default_allocator.free(arg);
            }
            new_args.deinit();
        }

        for (exec_argv) |arg| {
            try new_args.append(arg.toOwnedSliceZ(bun.default_allocator));
        }

        var diag: bun.clap.Diagnostic = .{};
        var iter: bun.clap.args.SliceIterator = .init(new_args.items);

        var args = bun.clap.parseEx(bun.clap.Help, bun.CLI.Command.Tag.RunCommand.params(), &iter, .{
            .diagnostic = &diag,
            .allocator = bun.default_allocator,

            // just one for executable
            .stop_after_positional_at = 1,
        }) catch {
            // ignore param parsing errors
            break :parse_new_args;
        };
        defer args.deinit();

        // override the existing even if it was set
        transform_options.allow_addons = !args.flag("--no-addons");

        // TODO: currently this only checks for --no-addons. I think
        // this should go through most flags and update the options.
    }

    this.arena = try bun.MimallocArena.init();
    var vm = try jsc.VirtualMachine.initWorker(this, .{
        .allocator = this.arena.?.allocator(),
        .args = transform_options,
        .store_fd = this.store_fd,
        .graph = this.parent.standalone_module_graph,
    });
    vm.allocator = this.arena.?.allocator();
    vm.arena = &this.arena.?;

    var b = &vm.transpiler;

    b.configureDefines() catch {
        this.flushLogs();
        this.exitAndDeinit();
        return;
    };

    // TODO: we may have to clone other parts of vm state. this will be more
    // important when implementing vm.deinit()
    const map = try vm.allocator.create(bun.DotEnv.Map);
    map.* = try vm.transpiler.env.map.cloneWithAllocator(vm.allocator);

    const loader = try vm.allocator.create(bun.DotEnv.Loader);
    loader.* = bun.DotEnv.Loader.init(map, vm.allocator);

    vm.transpiler.env = loader;

    vm.loadExtraEnvAndSourceCodePrinter();
    vm.is_main_thread = false;
    jsc.VirtualMachine.is_main_thread_vm = false;
    vm.onUnhandledRejection = onUnhandledRejection;
    const callback = jsc.OpaqueWrap(WebWorker, WebWorker.spin);

    this.vm = vm;

    vm.global.vm().holdAPILock(this, callback);
}

/// Deinit will clean up vm and everything.
/// Early deinit may be called from caller thread, but full vm deinit will only be called within worker's thread.
fn deinit(this: *WebWorker) void {
    log("[{d}] deinit", .{this.execution_context_id});
    this.parent_poll_ref.unrefConcurrently(this.parent);
    bun.default_allocator.free(this.unresolved_specifier);
    for (this.preloads) |preload| {
        bun.default_allocator.free(preload);
    }
    bun.default_allocator.free(this.preloads);
    bun.default_allocator.destroy(this);
}

fn flushLogs(this: *WebWorker) void {
    jsc.markBinding(@src());
    var vm = this.vm orelse return;
    if (vm.log.msgs.items.len == 0) return;
    const err = vm.log.toJS(vm.global, bun.default_allocator, "Error in worker") catch bun.outOfMemory();
    const str = err.toBunString(vm.global) catch @panic("unexpected exception");
    defer str.deref();
    WebWorker__dispatchError(vm.global, this.cpp_worker, str, err);
}

fn onUnhandledRejection(vm: *jsc.VirtualMachine, globalObject: *jsc.JSGlobalObject, error_instance_or_exception: jsc.JSValue) void {
    // Prevent recursion
    vm.onUnhandledRejection = &jsc.VirtualMachine.onQuietUnhandledRejectionHandlerCaptureValue;

    var error_instance = error_instance_or_exception.toError() orelse error_instance_or_exception;

    var array = bun.MutableString.init(bun.default_allocator, 0) catch unreachable;
    defer array.deinit();

    var buffered_writer_ = bun.MutableString.BufferedWriter{ .context = &array };
    var buffered_writer = &buffered_writer_;
    var worker = vm.worker orelse @panic("Assertion failure: no worker");

    const writer = buffered_writer.writer();
    const Writer = @TypeOf(writer);
    // we buffer this because it'll almost always be < 4096
    // when it's under 4096, we want to avoid the dynamic allocation
    jsc.ConsoleObject.format2(
        .Debug,
        globalObject,
        &[_]jsc.JSValue{error_instance},
        1,
        Writer,
        Writer,
        writer,
        .{
            .enable_colors = false,
            .add_newline = false,
            .flush = false,
            .max_depth = 32,
        },
    ) catch |err| {
        switch (err) {
            error.JSError => {},
            error.OutOfMemory => globalObject.throwOutOfMemory() catch {},
        }
        error_instance = globalObject.tryTakeException().?;
    };
    buffered_writer.flush() catch {
        bun.outOfMemory();
    };
    jsc.markBinding(@src());
    WebWorker__dispatchError(globalObject, worker.cpp_worker, bun.String.createUTF8(array.slice()), error_instance);
    if (vm.worker) |worker_| {
        _ = worker.setRequestedTerminate();
        worker.parent_poll_ref.unrefConcurrently(worker.parent);
        worker_.exitAndDeinit();
    }
}

fn setStatus(this: *WebWorker, status: Status) void {
    log("[{d}] status: {s}", .{ this.execution_context_id, @tagName(status) });

    this.status.store(status, .release);
}

fn unhandledError(this: *WebWorker, _: anyerror) void {
    this.flushLogs();
}

fn spin(this: *WebWorker) void {
    log("[{d}] spin start", .{this.execution_context_id});

    var vm = this.vm.?;
    assert(this.status.load(.acquire) == .start);
    this.setStatus(.starting);
    vm.preload = this.preloads;
    // resolve entrypoint
    var resolve_error = bun.String.empty;
    defer resolve_error.deref();
    const path = resolveEntryPointSpecifier(vm, this.unresolved_specifier, &resolve_error, vm.log) orelse {
        vm.exit_handler.exit_code = 1;
        if (vm.log.errors == 0 and !resolve_error.isEmpty()) {
            const err = resolve_error.toUTF8(bun.default_allocator);
            defer err.deinit();
            vm.log.addError(null, .Empty, err.slice()) catch bun.outOfMemory();
        }
        this.flushLogs();
        this.exitAndDeinit();
        return;
    };
    defer bun.default_allocator.free(path);

    // If the worker is terminated before we even try to run any code, the exit code should be 0
    if (this.hasRequestedTerminate()) {
        this.flushLogs();
        this.exitAndDeinit();
        return;
    }

    var promise = vm.loadEntryPointForWebWorker(path) catch {
        // If we called process.exit(), don't override the exit code
        if (!this.exit_called) vm.exit_handler.exit_code = 1;
        this.flushLogs();
        this.exitAndDeinit();
        return;
    };

    if (promise.status(vm.global.vm()) == .rejected) {
        const handled = vm.uncaughtException(vm.global, promise.result(vm.global.vm()), true);

        if (!handled) {
            vm.exit_handler.exit_code = 1;
            this.exitAndDeinit();
            return;
        }
    } else {
        _ = promise.result(vm.global.vm());
    }

    this.flushLogs();
    log("[{d}] event loop start", .{this.execution_context_id});
    // TODO(@190n) call dispatchOnline earlier (basically as soon as spin() starts, before
    // we start running JS)
    WebWorker__dispatchOnline(this.cpp_worker, vm.global);
    WebWorker__fireEarlyMessages(this.cpp_worker, vm.global);
    this.setStatus(.running);

    // don't run the GC if we don't actually need to
    if (vm.isEventLoopAlive() or
        vm.eventLoop().tickConcurrentWithCount() > 0)
    {
        vm.global.vm().releaseWeakRefs();
        _ = vm.arena.gc();
        _ = vm.global.vm().runGC(false);
    }

    // always doing a first tick so we call CppTask without delay after dispatchOnline
    vm.tick();

    while (vm.isEventLoopAlive()) {
        vm.tick();
        if (this.hasRequestedTerminate()) break;
        vm.eventLoop().autoTickActive();
        if (this.hasRequestedTerminate()) break;
    }

    log("[{d}] before exit {s}", .{ this.execution_context_id, if (this.hasRequestedTerminate()) "(terminated)" else "(event loop dead)" });

    // Only call "beforeExit" if we weren't from a .terminate
    if (!this.hasRequestedTerminate()) {
        // TODO: is this able to allow the event loop to continue?
        vm.onBeforeExit();
    }

    this.flushLogs();
    this.exitAndDeinit();
    log("[{d}] spin done", .{this.execution_context_id});
}

/// This is worker.ref()/.unref() from JS (Caller thread)
pub fn setRef(this: *WebWorker, value: bool) callconv(.c) void {
    if (this.hasRequestedTerminate()) {
        return;
    }

    this.setRefInternal(value);
}

pub fn setRefInternal(this: *WebWorker, value: bool) void {
    if (value) {
        this.parent_poll_ref.ref(this.parent);
    } else {
        this.parent_poll_ref.unref(this.parent);
    }
}

/// Implement process.exit(). May only be called from the Worker thread.
pub fn exit(this: *WebWorker) void {
    this.exit_called = true;
    this.notifyNeedTermination();
}

/// Request a terminate from any thread.
pub fn notifyNeedTermination(this: *WebWorker) callconv(.c) void {
    if (this.status.load(.acquire) == .terminated) {
        return;
    }
    if (this.setRequestedTerminate()) {
        return;
    }
    log("[{d}] notifyNeedTermination", .{this.execution_context_id});

    if (this.vm) |vm| {
        vm.eventLoop().wakeup();
        // TODO(@190n) notifyNeedTermination
    }

    // TODO(@190n) delete
    this.setRefInternal(false);
}

/// This handles cleanup, emitting the "close" event, and deinit.
/// Only call after the VM is initialized AND on the same thread as the worker.
/// Otherwise, call `notifyNeedTermination` to cause the event loop to safely terminate.
pub fn exitAndDeinit(this: *WebWorker) noreturn {
    jsc.markBinding(@src());
    this.setStatus(.terminated);
    bun.Analytics.Features.workers_terminated += 1;

    log("[{d}] exitAndDeinit", .{this.execution_context_id});
    const cpp_worker = this.cpp_worker;
    var exit_code: i32 = 0;
    var globalObject: ?*jsc.JSGlobalObject = null;
    var vm_to_deinit: ?*jsc.VirtualMachine = null;
    var loop: ?*bun.uws.Loop = null;
    if (this.vm) |vm| {
        loop = vm.uwsLoop();
        this.vm = null;
        vm.is_shutting_down = true;
        vm.onExit();
        exit_code = vm.exit_handler.exit_code;
        globalObject = vm.global;
        vm_to_deinit = vm;
    }
    var arena = this.arena;

    WebWorker__dispatchExit(globalObject, cpp_worker, exit_code);
    if (loop) |loop_| {
        loop_.internal_loop_data.jsc_vm = null;
    }

    bun.uws.onThreadExit();
    this.deinit();

    if (vm_to_deinit) |vm| {
        vm.deinit(); // NOTE: deinit here isn't implemented, so freeing workers will leak the vm.
    }
    bun.deleteAllPoolsForThreadExit();
    if (arena) |*arena_| {
        arena_.deinit();
    }

    bun.exitThread();
}

comptime {
    @export(&create, .{ .name = "WebWorker__create" });
    @export(&notifyNeedTermination, .{ .name = "WebWorker__notifyNeedTermination" });
    @export(&setRef, .{ .name = "WebWorker__setRef" });
    _ = WebWorker__updatePtr;
}

const assert = bun.assert;
