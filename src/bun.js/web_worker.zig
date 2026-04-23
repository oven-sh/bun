//! Shared implementation of Web and Node `Worker`
//!
//! Lifetime / threading model
//! ==========================
//!
//! There are three objects, two threads, and one ownership rule:
//!
//!   ┌─ PARENT THREAD ──────────────────────────────────────────────────────┐
//!   │  JSWorker (GC'd JSCell)                                              │
//!   │    └─ Ref<WebCore::Worker>                                           │
//!   │                                                                      │
//!   │  WebCore::Worker (ThreadSafeRefCounted, EventTarget)                 │
//!   │    ├─ void* impl_  ─────────────────────────────┐ raw pointer to ↓   │
//!   │    └─ ScriptExecutionContext* (parent ctx)      │                    │
//!   └────────────────────────────────────────────────  │  ──────────────────┘
//!                                                      ▼
//!   ┌─ EITHER THREAD (owned by ~Worker) ──────────────────────────────────┐
//!   │  Zig WebWorker (this struct, default_allocator)                      │
//!   │    ├─ vm: ?*VirtualMachine    – worker thread writes; vm_lock guards │
//!   │    │                            cross-thread read in terminate()     │
//!   │    ├─ status / requested_terminate – atomics                         │
//!   │    ├─ parent_poll_ref          – PARENT-THREAD-ONLY (KeepAlive)      │
//!   │    └─ parent / cpp_worker      – set once in create()                │
//!   └──────────────────────────────────────────────────────────────────────┘
//!
//! Ownership rule: the Zig WebWorker struct is OWNED BY the C++ Worker. It is
//! allocated in `create()` and freed in `WebCore::Worker::~Worker()` via
//! `WebWorker__destroy`. The worker thread NEVER frees it. Because JSWorker
//! holds a `Ref<Worker>`, `impl_` is valid for the entire time JS can call
//! `terminate()`/`ref()`/`unref()` — those calls cannot UAF.
//!
//! Refcounting on `WebCore::Worker`:
//!   - JSWorker wrapper holds +1 (dropped when GC'd)
//!   - `Worker::create()` takes +1 "on Zig's behalf" after `WebWorker__create`
//!     succeeds. This +1 is dropped on the PARENT thread inside `dispatchExit`'s
//!     posted close-event task (or in `updatePtr()` on spawn failure). It is
//!     never dropped on the worker thread, so `~Worker` (and the
//!     `EventListenerMap` it tears down) never runs on the worker thread. If
//!     posting fails because the parent context is gone, the +1 is leaked —
//!     parent VM teardown is in progress so the leak is bounded.
//!
//! Worker thread lifecycle (`startWithErrorHandling` → `start` → `spin` →
//! `exitAndDeinit`):
//!   1. spin() runs the worker's event loop until it drains or
//!      `requested_terminate` is observed.
//!   2. exitAndDeinit() runs ON THE WORKER THREAD. It:
//!        - sets `status = .terminated`
//!        - under `vm_lock`: nulls `vm` (so a racing `notifyNeedTermination`
//!          sees null and skips `wakeup()` instead of touching freed memory)
//!        - copies `arena`/`cpp_worker`/exit_code to locals so nothing reads
//!          `this.*` after the next step
//!        - calls `WebWorker__teardownJSCVM` to tear down the worker's JSC VM
//!          (collectNow, vm.deref×2). This can re-enter Zig (finalizers), so it
//!          runs before any mimalloc-backed state is destroyed.
//!        - calls `WebWorker__dispatchExit`, which posts the close-event task to
//!          the parent context. The close-event task runs ON THE PARENT THREAD
//!          and does:
//!            - dispatch the `close` event
//!            - `WebWorker__releaseParentPollRef` (parent-thread unref)
//!            - drop the Zig-held `Worker` ref
//!          This is ordered after JSC teardown so the parent stays alive
//!          (parent_poll_ref held) through the worker's collectNow().
//!        - frees gc_controller timers, libuv Loop.shutdown(), vm.deinit(),
//!          thread pools, and the worker's mimalloc arena, then exits the
//!          thread. `this` may already be freed by now (the parent's close
//!          task can complete and `~Worker` fire in between); that's fine
//!          because nothing here dereferences `this` after dispatchExit.
//!
//! `parent_poll_ref` (the keep-alive on the parent's event loop) is mutated
//! ONLY on the parent thread:
//!   - `create()`      – ref   (parent thread)
//!   - `setRef()`      – ref/unref via JS .ref()/.unref()  (parent thread)
//!   - `releaseParentPollRef()` – unref in close-event task (parent thread)
//!   - `WebWorker__updatePtr` spawn-fail path – unref       (parent thread)
//! `KeepAlive.status` is non-atomic, so the worker thread MUST NOT touch it.
//!
//! `terminate()` and worker-side `process.exit()` call
//! `vm.jsc_vm.notifyNeedTermination()`, which makes JSC throw a
//! TerminationException at the next safepoint. Combined with `wakeup()` this
//! lets the worker reach `exitAndDeinit` even if it was in a tight loop, so
//! `await worker.terminate()` resolves and `parent_poll_ref` is released via
//! the close-event task rather than eagerly.
//!
//! `vm_lock` is held only briefly around three sites: `start()` setting `vm`,
//! `exitAndDeinit()` nulling `vm`, and `notifyNeedTermination()` reading `vm`
//! to call `wakeup()`. It exists solely to close the TOCTOU between the parent
//! reading a non-null `vm` and the worker freeing the arena that contains it.
//!
//! Known gaps vs Node.js (not handled here): the worker thread is detached,
//! not joined, so `await worker.terminate()` resolves before the OS thread is
//! fully gone; nested workers are not stopped/joined when their parent exits.

const WebWorker = @This();

const log = Output.scoped(.Worker, .hidden);

/// null when haven't started yet
vm: ?*jsc.VirtualMachine = null,
/// Serializes `vm` against cross-thread reads in `notifyNeedTermination`. Held briefly
/// around the assignment in `start()`, the null in `exitAndDeinit()`, and the wakeup
/// call from the parent.
vm_lock: bun.Mutex = .{},
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

extern fn WebWorker__teardownJSCVM(*jsc.JSGlobalObject) void;
extern fn WebWorker__dispatchExit(*anyopaque, i32) void;
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
        // Called from the parent thread (Worker JS constructor), so plain unref is correct.
        // The struct itself stays allocated; ~Worker frees it via WebWorker__destroy.
        worker.parent_poll_ref.unref(worker.parent);
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
        const out = blk: {
            const out = logger.toJS(
                parent.global,
                bun.default_allocator,
                "Error resolving Worker entry point",
            ) catch |err| break :blk err;
            break :blk out.toBunString(parent.global);
        } catch |err| switch (err) {
            error.OutOfMemory => bun.outOfMemory(),
            error.JSError => {
                error_message.* = bun.String.static("unexpected exception");
                return null;
            },
            error.JSTerminated => {
                error_message.* = bun.String.static("unexpected exception");
                return null;
            },
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

    var preloads = bun.handleOom(std.array_list.Managed([]const u8).initCapacity(bun.default_allocator, preload_modules_len));
    for (preload_modules) |module| {
        const utf8_slice = module.toUTF8(bun.default_allocator);
        defer utf8_slice.deinit();
        if (resolveEntryPointSpecifier(parent, utf8_slice.slice(), error_message, &temp_log)) |preload| {
            bun.handleOom(preloads.append(bun.handleOom(bun.default_allocator.dupe(u8, preload))));
        }

        if (!error_message.isEmpty()) {
            for (preloads.items) |preload| {
                bun.default_allocator.free(preload);
            }
            preloads.deinit();
            return null;
        }
    }

    var worker = bun.handleOom(bun.default_allocator.create(WebWorker));
    worker.* = WebWorker{
        .cpp_worker = cpp_worker,
        .parent = parent,
        .parent_context_id = parent_context_id,
        .execution_context_id = this_context_id,
        .mini = mini,
        .eval_mode = eval_mode,
        .unresolved_specifier = bun.handleOom(spec_slice.toOwned(bun.default_allocator)).slice(),
        .store_fd = parent.transpiler.resolver.store_fd,
        .name = brk: {
            if (!name_str.isEmpty()) {
                break :brk bun.handleOom(std.fmt.allocPrintSentinel(bun.default_allocator, "{f}", .{name_str}, 0));
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
    bun.analytics.Features.workers_spawned += 1;
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
        var new_args: std.array_list.Managed([]const u8) = try .initCapacity(bun.default_allocator, exec_argv.len);
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

        var args = bun.clap.parseEx(bun.clap.Help, bun.cli.Command.Tag.RunCommand.params(), &iter, .{
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

    this.arena = bun.MimallocArena.init();
    const allocator = this.arena.?.allocator();

    // Proxy-env values may be RefCountedEnvValue bytes owned by the parent's
    // proxy_env_storage. We need a consistent snapshot of (storage slots +
    // env.map entries) so every slice we copy is backed by a ref we hold.
    // The parent's storage.lock serializes against Bun__setEnvValue on the
    // main thread — it covers both the slot swap and the map.put, so
    // cloneFrom and cloneWithAllocator see the same state.
    //
    // proxy_env_storage lives directly on VirtualMachine (not in lazy
    // RareData) so there's no null-check race — it always exists.
    var temp_proxy_storage: jsc.RareData.ProxyEnvStorage = .{};
    errdefer temp_proxy_storage.deinit();

    const map = try allocator.create(bun.DotEnv.Map);
    {
        const parent_storage = &this.parent.proxy_env_storage;
        parent_storage.lock.lock();
        defer parent_storage.lock.unlock();

        temp_proxy_storage.cloneFrom(parent_storage);
        map.* = try this.parent.transpiler.env.map.cloneWithAllocator(allocator);
    }
    // Ensure map entries point at the exact bytes we hold refs on — covers
    // the case where a proxy var was in the initial environ (no ref) and
    // later overwritten by the setter (reffed).
    temp_proxy_storage.syncInto(map);

    const loader = try allocator.create(bun.DotEnv.Loader);
    loader.* = bun.DotEnv.Loader.init(map, allocator);

    var vm = try jsc.VirtualMachine.initWorker(this, .{
        .allocator = allocator,
        .args = transform_options,
        .env_loader = loader,
        .store_fd = this.store_fd,
        .graph = this.parent.standalone_module_graph,
    });
    vm.allocator = allocator;
    vm.arena = &this.arena.?;

    // Move the pre-cloned proxy storage into the worker VM. Refs were
    // already bumped before the map clone above. proxy_env_storage is a
    // direct field on VirtualMachine — no rareData() lazy-init here.
    vm.proxy_env_storage = temp_proxy_storage;
    temp_proxy_storage = .{};

    var b = &vm.transpiler;
    b.resolver.env_loader = b.env;

    if (this.parent.standalone_module_graph) |graph| {
        bun.bun_js.applyStandaloneRuntimeFlags(b, graph);
    }

    b.configureDefines() catch {
        // exitAndDeinit's null-guard skips vm.deinit() while this.vm is still
        // null (we only assign it below). Free the moved-in proxy storage
        // explicitly so the cloned RefCountedEnvValue refs aren't leaked.
        vm.proxy_env_storage.deinit();
        this.flushLogs();
        this.exitAndDeinit();
        return;
    };

    vm.loadExtraEnvAndSourceCodePrinter();
    vm.is_main_thread = false;
    jsc.VirtualMachine.is_main_thread_vm = false;
    vm.onUnhandledRejection = onUnhandledRejection;
    const callback = jsc.OpaqueWrap(WebWorker, WebWorker.spin);

    {
        this.vm_lock.lock();
        defer this.vm_lock.unlock();
        this.vm = vm;
    }

    vm.global.vm().holdAPILock(this, callback);
}

/// Release the keep-alive on the parent's event loop. Called on the parent thread
/// from the close-event task posted by `WebWorker__dispatchExit`, so plain `unref`
/// (not `unrefConcurrently`) is correct.
pub fn releaseParentPollRef(this: *WebWorker) callconv(.c) void {
    this.parent_poll_ref.unref(this.parent);
}

/// Free the struct and its owned strings. Called from `WebCore::Worker::~Worker()`,
/// so the lifetime of `impl_` matches the C++ Worker — `terminate()`/`ref()`/`unref()`
/// can never observe a freed struct. Allocator is mimalloc (thread-safe), so the
/// caller's thread doesn't matter for the free itself.
pub fn destroy(this: *WebWorker) callconv(.c) void {
    log("[{d}] destroy", .{this.execution_context_id});
    bun.default_allocator.free(this.unresolved_specifier);
    for (this.preloads) |preload| {
        bun.default_allocator.free(preload);
    }
    bun.default_allocator.free(this.preloads);
    if (this.name.len > 0) bun.default_allocator.free(this.name);
    bun.default_allocator.destroy(this);
}

fn flushLogs(this: *WebWorker) void {
    jsc.markBinding(@src());
    var vm = this.vm orelse return;
    if (vm.log.msgs.items.len == 0) return;
    const err, const str = blk: {
        const err = vm.log.toJS(vm.global, bun.default_allocator, "Error in worker") catch |e|
            break :blk e;
        const str = err.toBunString(vm.global) catch |e| break :blk e;
        break :blk .{ err, str };
    } catch |err| switch (err) {
        // TODO: properly handle exception
        error.JSError => @panic("unhandled exception"),
        error.OutOfMemory => bun.outOfMemory(),
        error.JSTerminated => @panic("unhandled exception"),
    };
    defer str.deref();
    bun.jsc.fromJSHostCallGeneric(vm.global, @src(), WebWorker__dispatchError, .{ vm.global, this.cpp_worker, str, err }) catch |e| {
        _ = vm.global.reportUncaughtException(vm.global.takeException(e).asException(vm.global.vm()).?);
    };
}

fn onUnhandledRejection(vm: *jsc.VirtualMachine, globalObject: *jsc.JSGlobalObject, error_instance_or_exception: jsc.JSValue) void {
    // Prevent recursion
    vm.onUnhandledRejection = &jsc.VirtualMachine.onQuietUnhandledRejectionHandlerCaptureValue;

    var error_instance = error_instance_or_exception.toError() orelse error_instance_or_exception;

    var array = std.Io.Writer.Allocating.init(bun.default_allocator);
    defer array.deinit();

    var worker = vm.worker orelse @panic("Assertion failure: no worker");

    const writer = &array.writer;
    // we buffer this because it'll almost always be < 4096
    // when it's under 4096, we want to avoid the dynamic allocation
    jsc.ConsoleObject.format2(
        .Debug,
        globalObject,
        &[_]jsc.JSValue{error_instance},
        1,
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
            error.JSTerminated => {},
        }
        error_instance = globalObject.tryTakeException().?;
    };
    writer.flush() catch {
        bun.outOfMemory();
    };
    jsc.markBinding(@src());
    WebWorker__dispatchError(globalObject, worker.cpp_worker, bun.String.cloneUTF8(array.written()), error_instance);
    if (vm.worker) |worker_| {
        _ = worker.setRequestedTerminate();
        worker_.exitAndDeinit();
    }
}

fn setStatus(this: *WebWorker, status: Status) void {
    log("[{d}] status: {s}", .{ this.execution_context_id, @tagName(status) });

    this.status.store(status, .release);
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
            bun.handleOom(vm.log.addError(null, .Empty, err.slice()));
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

    if (promise.status() == .rejected) {
        const handled = vm.uncaughtException(vm.global, promise.result(), true);

        if (!handled) {
            vm.exit_handler.exit_code = 1;
            this.exitAndDeinit();
            return;
        }
    } else if (promise.status() == .fulfilled) {
        _ = promise.result();
    }
    // If promise is still pending (top-level await), that's OK — the main
    // event loop below will continue to tick until it settles.

    this.flushLogs();
    log("[{d}] event loop start", .{this.execution_context_id});
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

/// This is worker.ref()/.unref() from JS (parent thread). The struct is guaranteed
/// alive here: it's freed by ~Worker, and JSWorker holds a Ref<Worker>.
pub fn setRef(this: *WebWorker, value: bool) callconv(.c) void {
    if (this.hasRequestedTerminate() or this.status.load(.acquire) == .terminated) {
        return;
    }

    if (value) {
        this.parent_poll_ref.ref(this.parent);
    } else {
        this.parent_poll_ref.unref(this.parent);
    }
}

/// Implement process.exit(). May only be called from the Worker thread.
pub fn exit(this: *WebWorker) void {
    this.exit_called = true;
    _ = this.setRequestedTerminate();
    // Stop subsequent JS at the next safepoint. `this.vm` is null during
    // vm.onExit() (exitAndDeinit nulls it first), so a re-entrant
    // process.exit() from an exit handler does not re-arm the trap.
    if (this.vm) |vm| {
        vm.jsc_vm.notifyNeedTermination();
    }
}

/// Request a terminate from the parent thread (worker.terminate()). The struct is
/// guaranteed alive: it's freed by ~Worker, which can't run while JSWorker (the
/// caller) holds its Ref<Worker>.
pub fn notifyNeedTermination(this: *WebWorker) callconv(.c) void {
    if (this.setRequestedTerminate()) {
        return;
    }
    log("[{d}] notifyNeedTermination", .{this.execution_context_id});

    // Interrupt running JS in the worker (TerminationException at the next
    // safepoint) and wake its event loop so it observes requested_terminate.
    // vm_lock serializes against exitAndDeinit nulling vm and freeing the arena.
    // parent_poll_ref stays held until the close-event task runs so that
    // `await worker.terminate()` keeps the parent alive until 'exit' fires.
    this.vm_lock.lock();
    defer this.vm_lock.unlock();
    if (this.vm) |vm| {
        vm.jsc_vm.notifyNeedTermination();
        vm.eventLoop().wakeup();
    }
}

/// This handles VM/arena cleanup and posts the "close" event to the parent.
/// Only call after the VM is initialized AND on the same thread as the worker.
/// Otherwise, call `notifyNeedTermination` to cause the event loop to safely terminate.
///
/// This does NOT free `this` — the WebWorker struct outlives the worker thread and
/// is freed by `WebCore::Worker::~Worker()` via `WebWorker__destroy`, so the parent
/// thread can safely call terminate()/ref()/unref() at any point.
pub fn exitAndDeinit(this: *WebWorker) noreturn {
    jsc.markBinding(@src());
    this.setStatus(.terminated);
    bun.analytics.Features.workers_terminated += 1;

    log("[{d}] exitAndDeinit", .{this.execution_context_id});
    const cpp_worker = this.cpp_worker;
    var exit_code: i32 = 0;
    var globalObject: ?*jsc.JSGlobalObject = null;
    var vm_to_deinit: ?*jsc.VirtualMachine = null;
    var loop: ?*bun.uws.Loop = null;

    {
        // Publish vm = null before the arena (and the VM inside it) is freed, so a
        // concurrent notifyNeedTermination() either sees null or completes its
        // wakeup() before we proceed.
        this.vm_lock.lock();
        defer this.vm_lock.unlock();
        if (this.vm) |vm| {
            loop = vm.uwsLoop();
            this.vm = null;
            vm_to_deinit = vm;
        }
    }
    if (vm_to_deinit) |vm| {
        // terminate() set the JSC termination flag to interrupt running JS; clear
        // it so process.on('exit') handlers can run. WebWorker__teardownJSCVM
        // re-sets it for the JSC VM teardown.
        vm.jsc_vm.clearHasTerminationRequest();
        vm.is_shutting_down = true;
        vm.onExit();
        jsc.API.cron.CronJob.clearAllForVM(vm, .teardown);
        exit_code = vm.exit_handler.exit_code;
        globalObject = vm.global;
    }
    var arena = this.arena;
    this.arena = null;

    // JSC VM teardown can re-enter Zig (finalizers, module registry callbacks),
    // so it must run before any mimalloc-backed state is destroyed below.
    if (globalObject) |global| {
        WebWorker__teardownJSCVM(global);
    }

    // Post the close-event task. It releases parent_poll_ref on the parent
    // thread; the parent can exit any time after this runs. Loop.shutdown()
    // below can block on Windows (uv_run(.default) with active requests), so
    // posting first lets the parent proceed regardless.
    WebWorker__dispatchExit(cpp_worker, exit_code);
    // Past this point `this` may be freed at any time (the C++ Worker's last ref can
    // drop on the parent thread once the close-event task runs).

    if (loop) |loop_| {
        loop_.internal_loop_data.jsc_vm = null;
    }

    if (vm_to_deinit) |vm| {
        // this deinit needs to happen before `Loop.shutdown`
        // in order to not call uv_close on the gc timer twice.
        vm.gc_controller.deinit();
    }

    if (comptime Environment.isWindows) {
        bun.windows.libuv.Loop.shutdown();
    }

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
    @export(&destroy, .{ .name = "WebWorker__destroy" });
    @export(&releaseParentPollRef, .{ .name = "WebWorker__releaseParentPollRef" });
    _ = WebWorker__updatePtr;
}

const std = @import("std");
const WTFStringImpl = @import("../string.zig").WTFStringImpl;

const bun = @import("bun");
const Async = bun.Async;
const Environment = bun.Environment;
const Output = bun.Output;
const assert = bun.assert;

const jsc = bun.jsc;
const JSValue = jsc.JSValue;
