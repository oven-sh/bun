//! Shared implementation of Web and Node `Worker`.
//!
//! Lifetime / threading model
//! ==========================
//!
//! Three objects, two threads, one ownership rule:
//!
//!   ┌─ PARENT THREAD ───────────────────────────────────────────────────────┐
//!   │  JSWorker (GC'd JSCell) ──Ref──► WebCore::Worker (ThreadSafeRefCounted)│
//!   │                                    └─ impl_ ──owns──► Zig WebWorker    │
//!   └───────────────────────────────────────────────────────┬───────────────┘
//!                                                            │
//!   ┌─ WORKER THREAD ───────────────────────────────────────┴───────────────┐
//!   │  runs threadMain() → spin() → shutdown(); reads this struct directly  │
//!   └───────────────────────────────────────────────────────────────────────┘
//!
//! Ownership rule: this struct is OWNED BY the C++ `WebCore::Worker`. It is
//! allocated in `create()` and freed in `WebCore::Worker::~Worker()` via
//! `WebWorker__destroy`. The worker thread NEVER frees it. Because `JSWorker`
//! holds a `Ref<Worker>`, `impl_` is valid for the entire time JS can call
//! `terminate()`/`ref()`/`unref()` — those calls cannot UAF.
//!
//! Refs on `WebCore::Worker`:
//!   - `JSWorker` wrapper  +1  (dropped at GC)
//!   - worker thread       +1  taken in `Worker::create()` BEFORE the thread is
//!                             spawned, dropped on the PARENT thread inside the
//!                             close task posted by `dispatchExit()`. `~Worker`
//!                             therefore never runs on the worker thread.
//!
//! Lifecycle of the worker thread (`threadMain`):
//!   1. `startVM()`  — build a mimalloc arena, clone env, initialise a
//!      `jsc.VirtualMachine`, publish `vm` under `vm_lock`.
//!   2. `spin()`     — load the entry point, call `dispatchOnline` +
//!      `fireEarlyMessages`, run the event loop until it drains or
//!      `requested_terminate` is observed, run `beforeExit`.
//!   3. `shutdown()` — call `vm.onExit()`, tear down the JSC VM, post
//!      `dispatchExit` (which releases `parent_poll_ref` + the thread ref on
//!      the parent), free the arena, exit the thread. After `dispatchExit`
//!      `this` may be freed at any time; nothing below it dereferences `this`.
//!
//! `vm_lock` exists solely to close the TOCTOU between the parent reading a
//! non-null `vm` (in `notifyNeedTermination`) and the worker freeing the arena
//! that backs it. It is held only while (a) publishing `vm` in `startVM`,
//! (b) nulling `vm` in `shutdown`, (c) reading `vm` + calling `wakeup()` in
//! `notifyNeedTermination`.
//!
//! Every field below is grouped by which thread may touch it.
//!
//! At process exit (`globalExit` under BUN_DESTRUCT_VM_ON_EXIT),
//! `terminateAllAndWait()` stops every live worker and waits for each to
//! reach `shutdown()` before process-global resolver state is freed — the
//! main-thread analogue of Node's `Environment::stop_sub_worker_contexts()`.
//!
//! Known gap vs Node.js: the worker thread is detached, not joined, so
//! `await worker.terminate()` resolves before the OS thread is fully gone;
//! nested workers are not stopped when their WORKER parent's context tears
//! down (only the main thread waits). When a parent context is gone before
//! the close task posts, the thread-held `Worker` ref is intentionally
//! leaked (see `Worker::dispatchExit`).

const WebWorker = @This();

const log = Output.scoped(.Worker, .hidden);

// ---- Immutable after `create()` (safe from any thread) ----------------------

/// The owning C++ `WebCore::Worker`. Never null; this struct is freed by
/// `~Worker`, so the pointer cannot dangle.
cpp_worker: *anyopaque,
/// Parent `jsc.VirtualMachine`. Read on the worker thread by `startVM()`
/// (transform options, env, proxy storage, standalone graph) and on the
/// parent thread by `setRef()` / `releaseParentPollRef()`.
///
/// Validity: when the parent is the main thread, `globalExit()` calls
/// `terminateAllAndWait()` before freeing anything, so this stays valid
/// through `startVM()` even with `{ref:false}`/`.unref()`. When the parent
/// is itself a worker, nothing joins us on its exit — the nested-worker
/// "Known gap" in the file header. When `parent_poll_ref` is held (the
/// default), the parent's loop stays alive until the close task runs.
parent: *jsc.VirtualMachine,
parent_context_id: u32,
execution_context_id: u32,
mini: bool,
eval_mode: bool,
store_fd: bool,
/// Borrowed from C++ `WorkerOptions` (kept alive by the owning `Worker`).
argv: []const WTFStringImpl,
execArgv: ?[]const WTFStringImpl,
/// Heap-owned by this struct; freed in `destroy()`.
unresolved_specifier: []const u8,
preloads: [][]const u8,
name: [:0]const u8,

// ---- Cross-thread signalling ------------------------------------------------

/// Intrusive node for the process-global `LiveWorkers` list. Registered
/// before the thread is spawned; removed in `shutdown()` once the worker is
/// past all process-global resolver access.
live_node: std.DoublyLinkedList.Node = .{},

/// Set by the parent (`notifyNeedTermination`) or by the worker itself
/// (`exit`). The worker loop polls this between ticks.
requested_terminate: std.atomic.Value(bool) = .init(false),

/// The worker's `jsc.VirtualMachine`, or null before `startVM()` / after
/// `shutdown()` nulls it. Lives inside `arena`. `vm_lock` must be held for any
/// cross-thread read (see header comment).
vm: ?*jsc.VirtualMachine = null,
vm_lock: bun.Mutex = .{},

// ---- Parent-thread only -----------------------------------------------------

/// Keep-alive on the parent's event loop. `Async.KeepAlive` is not thread-safe;
/// it is reffed in `create()`, toggled by `setRef()` (JS `.ref()`/`.unref()`),
/// and released by `releaseParentPollRef()` from the close task — all on the
/// parent thread.
parent_poll_ref: Async.KeepAlive = .{},

// ---- Worker-thread only -----------------------------------------------------

status: Status = .start,
arena: ?bun.MimallocArena = null,
/// Set by `exit()` so that `spin()`'s error paths don't clobber an explicit
/// `process.exit(code)`.
exit_called: bool = false,

pub const Status = enum(u8) {
    /// Thread not yet started / startVM in progress.
    start,
    /// `spin()` has begun; entry point is loading.
    starting,
    /// `dispatchOnline` has fired; event loop is running.
    running,
    /// `shutdown()` has begun; no further JS will run.
    terminated,
};

extern fn WebWorker__teardownJSCVM(*jsc.JSGlobalObject) void;
extern fn WebWorker__dispatchExit(*anyopaque, i32) void;
extern fn WebWorker__dispatchOnline(cpp_worker: *anyopaque, *jsc.JSGlobalObject) void;
extern fn WebWorker__fireEarlyMessages(cpp_worker: *anyopaque, *jsc.JSGlobalObject) void;
extern fn WebWorker__dispatchError(*jsc.JSGlobalObject, *anyopaque, bun.String, JSValue) void;

/// Process-global registry of worker threads that have been spawned and
/// have not yet reached the point in `shutdown()` where they are past all
/// process-global resolver access (BSSMap singletons like `dir_cache`).
/// `globalExit()` uses this to terminate and wait for workers before
/// `transpiler.deinit()` frees those singletons.
///
/// Lock ordering: `LiveWorkers.mutex` → `worker.vm_lock` (never the reverse).
const LiveWorkers = struct {
    var mutex: bun.Mutex = .{};
    var list: std.DoublyLinkedList = .{};
    /// Number of workers registered in `list`. Separate atomic so
    /// `terminateAllAndWait` can futex-wait on it without the mutex.
    var outstanding: std.atomic.Value(u32) = .init(0);

    fn register(worker: *WebWorker) void {
        mutex.lock();
        defer mutex.unlock();
        list.append(&worker.live_node);
        _ = outstanding.fetchAdd(1, .release);
        // Wake terminateAllAndWait so it re-sweeps and catches this worker
        // (it may have been created by another worker mid-sweep). No-op if
        // nothing is waiting.
        bun.Futex.wake(&outstanding, 1);
    }

    fn unregister(worker: *WebWorker) void {
        mutex.lock();
        list.remove(&worker.live_node);
        mutex.unlock();
        // Wake any waiter in terminateAllAndWait when we hit zero. Waking
        // unconditionally is fine (spurious wakeups just re-check the
        // counter) and avoids a compare-before-wake race.
        _ = outstanding.fetchSub(1, .release);
        bun.Futex.wake(&outstanding, 1);
    }
};

/// Request termination of every live worker and block until each has reached
/// `shutdown()` (past all process-global resolver access), or `timeout_ms`
/// elapses. Called from `VirtualMachine.globalExit()` on the main thread
/// before `transpiler.deinit()` frees the process-global BSSMap singletons —
/// without this, a detached worker still in `startVM()`/`spin()` would UAF on
/// `dir_cache` / `dirname_store` etc.
///
/// This is the `Environment::stop_sub_worker_contexts()` equivalent for the
/// main thread; nested workers (a worker's own sub-workers at the worker's
/// exit) remain the documented gap.
///
/// Termination is cooperative: `requested_terminate` is polled at
/// checkpoints throughout `startVM()` and `spin()`, and for a running VM
/// `notifyNeedTermination()` raises a TerminationException at the next JSC
/// safepoint. We do NOT use `thread_suspend`/`SuspendThread` — a worker
/// frozen mid-mimalloc-alloc or holding the `dir_cache` mutex would
/// deadlock/corrupt the very cleanup we're trying to make safe.
pub fn terminateAllAndWait(timeout_ms: u64) void {
    if (LiveWorkers.outstanding.load(.acquire) == 0) return;

    // Futex-wait on the counter so we sleep rather than burn a core. Each
    // unregister() wakes us; we re-check and re-wait until zero or deadline.
    // We re-sweep the list on EVERY iteration: a worker A that was mid-
    // `WebWorker__create` for a nested worker B when we first swept will
    // register B after we release the mutex, and B's `requested_terminate`
    // was never set. Sweeping is O(outstanding) and `requested_terminate`
    // is a swap, so re-sweeping already-terminated entries is cheap.
    var timer = std.time.Timer.start() catch null;
    const deadline_ns = timeout_ms * std.time.ns_per_ms;
    while (true) {
        {
            LiveWorkers.mutex.lock();
            defer LiveWorkers.mutex.unlock();
            var it = LiveWorkers.list.first;
            while (it) |node| : (it = node.next) {
                const worker: *WebWorker = @fieldParentPtr("live_node", node);
                if (worker.requested_terminate.swap(true, .release)) continue;
                worker.vm_lock.lock();
                defer worker.vm_lock.unlock();
                if (worker.vm) |vm| {
                    vm.jsc_vm.notifyNeedTermination();
                    vm.eventLoop().wakeup();
                }
            }
        }

        const n = LiveWorkers.outstanding.load(.acquire);
        if (n == 0) return;
        if (timer) |*t| {
            const elapsed = t.read();
            if (elapsed >= deadline_ns) {
                log("terminateAllAndWait: timed out with {d} outstanding", .{n});
                return;
            }
            bun.Futex.wait(&LiveWorkers.outstanding, n, deadline_ns - elapsed) catch {};
        } else {
            // Monotonic clock unavailable — yield-spin.
            std.Thread.yield() catch {};
        }
    }
}

export fn WebWorker__getParentWorker(vm: *jsc.VirtualMachine) ?*anyopaque {
    const worker = vm.worker orelse return null;
    return worker.cpp_worker;
}

pub fn hasRequestedTerminate(this: *const WebWorker) bool {
    return this.requested_terminate.load(.acquire);
}

fn setRequestedTerminate(this: *WebWorker) bool {
    return this.requested_terminate.swap(true, .release);
}

// =============================================================================
// Construction (parent thread)
// =============================================================================

/// Allocate the struct, take a keep-alive on the parent event loop, and spawn
/// the worker thread. On any failure returns null with `error_message` set and
/// nothing to clean up (no keep-alive held, no allocation outstanding).
pub fn create(
    cpp_worker: *anyopaque,
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
    log("[{d}] create", .{this_context_id});

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
            for (preloads.items) |preload| bun.default_allocator.free(preload);
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
        .argv = if (argv_ptr) |ptr| ptr[0..argv_len] else &.{},
        .execArgv = if (inherit_execArgv) null else (if (execArgv_ptr) |ptr| ptr[0..execArgv_len] else &.{}),
        .preloads = preloads.items,
    };

    // Keep the parent's event loop alive until the close task releases this.
    // If the user passed `{ ref: false }` we skip — they've opted out of the
    // worker keeping the process alive.
    if (!default_unref) {
        worker.parent_poll_ref.ref(parent);
    }

    // Register BEFORE spawning so terminateAllAndWait() can never miss a
    // worker whose thread is already running.
    LiveWorkers.register(worker);

    var thread = std.Thread.spawn(
        .{ .stack_size = bun.default_thread_stack_size },
        threadMain,
        .{worker},
    ) catch {
        LiveWorkers.unregister(worker);
        worker.parent_poll_ref.unref(parent);
        worker.destroy();
        error_message.* = bun.String.static("Failed to spawn worker thread");
        return null;
    };
    thread.detach();

    return worker;
}

/// Free the struct and its owned strings. Called from `WebCore::Worker::~Worker()`
/// (or from `create()` on spawn failure). The allocator is mimalloc (thread-safe),
/// so the caller's thread doesn't matter.
pub fn destroy(this: *WebWorker) callconv(.c) void {
    log("[{d}] destroy", .{this.execution_context_id});
    bun.default_allocator.free(this.unresolved_specifier);
    for (this.preloads) |preload| bun.default_allocator.free(preload);
    bun.default_allocator.free(this.preloads);
    if (this.name.len > 0) bun.default_allocator.free(this.name);
    bun.default_allocator.destroy(this);
}

// =============================================================================
// Parent-thread API (called from C++ via JS)
// =============================================================================

/// worker.ref()/.unref() from JS. The struct is guaranteed alive: it's freed
/// by `~Worker`, which can't run while JSWorker (the caller) holds its
/// `Ref<Worker>`. `Worker::setKeepAlive()` gates out calls after terminate()
/// or the close task, so this can unconditionally toggle.
pub fn setRef(this: *WebWorker, value: bool) callconv(.c) void {
    if (value) {
        this.parent_poll_ref.ref(this.parent);
    } else {
        this.parent_poll_ref.unref(this.parent);
    }
}

/// worker.terminate() from JS. Sets `requested_terminate`, interrupts running
/// JS in the worker (TerminationException at the next safepoint), and wakes
/// the worker loop so it observes the flag. `parent_poll_ref` stays held until
/// the close task runs so that `await worker.terminate()` keeps the parent
/// alive until 'close' fires.
pub fn notifyNeedTermination(this: *WebWorker) callconv(.c) void {
    if (this.setRequestedTerminate()) return;
    log("[{d}] notifyNeedTermination", .{this.execution_context_id});

    // vm_lock serialises against shutdown() nulling `vm` and freeing the arena
    // it lives in.
    this.vm_lock.lock();
    defer this.vm_lock.unlock();
    if (this.vm) |vm| {
        vm.jsc_vm.notifyNeedTermination();
        vm.eventLoop().wakeup();
    }
}

/// Release the keep-alive on the parent's event loop. Called on the parent
/// thread from the close task posted by `dispatchExit`.
pub fn releaseParentPollRef(this: *WebWorker) callconv(.c) void {
    this.parent_poll_ref.unref(this.parent);
}

// =============================================================================
// Worker thread
// =============================================================================

fn threadMain(this: *WebWorker) void {
    bun.analytics.Features.workers_spawned += 1;

    if (this.name.len > 0) {
        Output.Source.configureNamedThread(this.name);
    } else {
        Output.Source.configureNamedThread("Worker");
    }

    // Terminated before we even started — skip straight to shutdown so the
    // parent still gets a close event and the thread ref is dropped.
    if (this.hasRequestedTerminate()) {
        this.shutdown();
        // unreachable
    }

    this.startVM() catch |err| {
        Output.panic("An unhandled error occurred while starting a worker: {s}\n", .{@errorName(err)});
    };

    this.vm.?.global.vm().holdAPILock(this, jsc.OpaqueWrap(WebWorker, WebWorker.spin));
}

/// Phase 1: build the worker's arena + VirtualMachine and publish `vm`.
fn startVM(this: *WebWorker) !void {
    assert(this.status == .start);
    assert(this.vm == null);

    var transform_options = this.parent.transpiler.options.transform_options;

    if (this.execArgv) |exec_argv| parse_new_args: {
        var new_args: std.array_list.Managed([]const u8) = try .initCapacity(bun.default_allocator, exec_argv.len);
        defer {
            for (new_args.items) |arg| bun.default_allocator.free(arg);
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
    // The parent's storage.lock serialises against Bun__setEnvValue on the
    // main thread — it covers both the slot swap and the map.put, so
    // cloneFrom and cloneWithAllocator see the same state.
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
    // Ensure map entries point at the exact bytes we hold refs on.
    temp_proxy_storage.syncInto(map);

    const loader = try allocator.create(bun.DotEnv.Loader);
    loader.* = bun.DotEnv.Loader.init(map, allocator);

    // Checkpoint before the expensive part: initWorker builds a full JSC
    // VM. If terminateAllAndWait() fired while we were cloning the env
    // above, bail now rather than spending ~50–100ms (release) creating a
    // VM that will immediately tear down.
    if (this.hasRequestedTerminate()) {
        temp_proxy_storage.deinit();
        this.shutdown();
    }

    var vm = try jsc.VirtualMachine.initWorker(this, .{
        .allocator = allocator,
        .args = transform_options,
        .env_loader = loader,
        .store_fd = this.store_fd,
        .graph = this.parent.standalone_module_graph,
    });
    vm.allocator = allocator;
    vm.arena = &this.arena.?;

    // Move the pre-cloned proxy storage into the worker VM.
    vm.proxy_env_storage = temp_proxy_storage;
    temp_proxy_storage = .{};

    vm.is_main_thread = false;
    jsc.VirtualMachine.is_main_thread_vm = false;
    vm.onUnhandledRejection = onUnhandledRejection;

    // Publish `vm` now (rather than at the end of startVM) so that:
    //   - a concurrent notifyNeedTermination()/terminateAllAndWait() can
    //     wake us once JS starts running, and
    //   - early returns below reach spin()/shutdown() with this.vm set,
    //     so teardownJSCVM/vm.deinit() run and the just-built JSC::VM
    //     heap is not leaked.
    // We do NOT call shutdown() directly from here: shutdown() with a
    // non-null vm runs vm.onExit() (JS), which requires holdAPILock.
    // Instead we return; threadMain enters holdAPILock(spin) and spin()'s
    // first check observes requested_terminate.
    {
        this.vm_lock.lock();
        defer this.vm_lock.unlock();
        this.vm = vm;
    }

    var b = &vm.transpiler;
    b.resolver.env_loader = b.env;

    if (this.parent.standalone_module_graph) |graph| {
        bun.bun_js.applyStandaloneRuntimeFlags(b, graph);
    }

    // Second checkpoint: initWorker just spent the bulk of startup time;
    // if terminate arrived during it, skip configureDefines() (which
    // walks the resolver's global dir_cache) and entry-point loading.
    // spin() will observe the flag and shutdown() under the API lock.
    if (this.hasRequestedTerminate()) return;

    b.configureDefines() catch {
        // Fall through to spin() → shutdown() for full teardown under
        // the API lock (flushLogs runs JS). Set terminate so spin()
        // bails immediately; vm.log carries the error for flushLogs.
        vm.exit_handler.exit_code = 1;
        _ = this.setRequestedTerminate();
        return;
    };

    vm.loadExtraEnvAndSourceCodePrinter();
}

/// Phase 2: load the entry point, dispatch 'online', run the event loop.
/// Runs inside `holdAPILock`. Always ends by calling `shutdown()`.
fn spin(this: *WebWorker) void {
    log("[{d}] spin start", .{this.execution_context_id});

    var vm = this.vm.?;
    assert(this.status == .start);
    this.setStatus(.starting);

    // Terminated during startVM() (or startVM() short-circuited here on
    // configureDefines failure) — shut down under the API lock so the
    // JSC::VM built by initWorker is torn down rather than leaked.
    if (this.hasRequestedTerminate()) {
        this.flushLogs(vm);
        this.shutdown();
    }

    vm.preload = this.preloads;

    // Resolve the entry point on the worker thread (the parent only stored the
    // raw specifier). The returned slice is BORROWED — every exit from spin()
    // goes through shutdown() which is noreturn, so a `defer free` here would
    // never run anyway.
    var resolve_error = bun.String.empty;
    const path = resolveEntryPointSpecifier(vm, this.unresolved_specifier, &resolve_error, vm.log) orelse {
        vm.exit_handler.exit_code = 1;
        if (vm.log.errors == 0 and !resolve_error.isEmpty()) {
            const err = resolve_error.toUTF8(bun.default_allocator);
            defer err.deinit();
            bun.handleOom(vm.log.addError(null, .Empty, err.slice()));
        }
        resolve_error.deref();
        this.flushLogs(vm);
        this.shutdown();
    };
    resolve_error.deref();

    // Terminated while resolving — exit code 0, no error.
    if (this.hasRequestedTerminate()) {
        this.flushLogs(vm);
        this.shutdown();
    }

    var promise = vm.loadEntryPointForWebWorker(path) catch {
        // process.exit() may have run during load; don't clobber its code.
        if (!this.exit_called) vm.exit_handler.exit_code = 1;
        this.flushLogs(vm);
        this.shutdown();
    };

    if (promise.status() == .rejected) {
        const handled = vm.uncaughtException(vm.global, promise.result(vm.jsc_vm), true);

        if (!handled) {
            vm.exit_handler.exit_code = 1;
            this.shutdown();
        }
    } else {
        _ = promise.result(vm.jsc_vm);
    }

    this.flushLogs(vm);
    log("[{d}] event loop start", .{this.execution_context_id});
    // dispatchOnline fires the parent-side 'open' event and flips the C++
    // state to Running (which routes postMessage directly instead of
    // queuing). It is placed after the entry point has loaded so the parent
    // observes 'online' only once the worker's top-level code has completed;
    // moving it earlier would change that observable ordering.
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

    // Always do a first tick so we call CppTask without delay after
    // dispatchOnline.
    vm.tick();

    while (vm.isEventLoopAlive()) {
        vm.tick();
        if (this.hasRequestedTerminate()) break;
        vm.eventLoop().autoTickActive();
        if (this.hasRequestedTerminate()) break;
    }

    log("[{d}] before exit {s}", .{ this.execution_context_id, if (this.hasRequestedTerminate()) "(terminated)" else "(event loop dead)" });

    // Only emit 'beforeExit' on a natural drain, not on terminate().
    if (!this.hasRequestedTerminate()) {
        // TODO: is this able to allow the event loop to continue?
        vm.onBeforeExit();
    }

    this.flushLogs(vm);
    this.shutdown();
}

/// Phase 3: run exit handlers, tear down the JSC VM, post the close event,
/// free the arena, exit the thread.
///
/// Ordering constraints (each step is a barrier for the next):
///   1. `vm = null` under lock    — a racing notifyNeedTermination() now sees
///                                  null and skips wakeup() instead of touching
///                                  memory freed in step 5.
///   2. `vm.onExit()`             — user 'exit' handlers run; needs the JSC VM.
///   3. `teardownJSCVM()`         — collectNow + vm.deref×2; can re-enter Zig
///                                  via finalizers, so must precede step 5.
///   4. `dispatchExit()`          — posts close task → parent releases
///                                  parent_poll_ref + thread-held Worker ref.
///                                  After this `this` may be freed at any time.
///   5. free loop/arena/pools     — no `this.*` dereferences below step 4.
///
/// Does NOT free `this` — see ownership rule in the file header.
fn shutdown(this: *WebWorker) noreturn {
    jsc.markBinding(@src());
    this.setStatus(.terminated);
    bun.analytics.Features.workers_terminated += 1;
    log("[{d}] shutdown", .{this.execution_context_id});

    // Snapshot everything we'll need after `this` may be freed (step 4).
    const cpp_worker = this.cpp_worker;
    var arena = this.arena;
    this.arena = null;

    // ---- 1. Unpublish vm --------------------------------------------------
    var vm_to_deinit: ?*jsc.VirtualMachine = null;
    var loop: ?*bun.uws.Loop = null;
    {
        this.vm_lock.lock();
        defer this.vm_lock.unlock();
        if (this.vm) |vm| {
            loop = vm.uwsLoop();
            this.vm = null;
            vm_to_deinit = vm;
        }
    }

    // ---- 2. User exit handlers -------------------------------------------
    var exit_code: i32 = 0;
    var globalObject: ?*jsc.JSGlobalObject = null;
    if (vm_to_deinit) |vm| {
        // terminate() set the JSC termination flag to interrupt running JS;
        // clear it so process.on('exit') handlers can run. teardownJSCVM
        // re-sets it for the JSC VM teardown.
        vm.jsc_vm.clearHasTerminationRequest();
        vm.is_shutting_down = true;
        vm.onExit();
        jsc.API.cron.CronJob.clearAllForVM(vm, .teardown);
        // Embedded socket groups must drain while JSC is still alive —
        // closeAll() fires on_close → JS callbacks. RareData.deinit() runs
        // after teardownJSCVM and only deinit()s (asserts empty in debug).
        if (vm.rare_data) |rare| rare.closeAllSocketGroups(vm);
        exit_code = vm.exit_handler.exit_code;
        globalObject = vm.global;
    }

    // ---- 3. JSC VM teardown ----------------------------------------------
    if (globalObject) |global| {
        WebWorker__teardownJSCVM(global);
    }

    // The JSC VM teardown above removed this worker's ScriptExecutionContext
    // from the global map (via ~GlobalObject → removeFromContextsMap), so no
    // new cross-thread tasks can be enqueued past this point. Free any
    // EventLoopTask/ConcurrentTask pairs that were posted to this worker
    // (worker.postMessage / MessagePort / BroadcastChannel) but never ran —
    // otherwise each leaks until process exit.
    if (vm_to_deinit) |vm| {
        vm.event_loop.drainCancelledTasks();
    }

    // JSC is down; no more resolver/module-loader access past this point.
    // Unregister so the main thread's terminateAllAndWait() can proceed to
    // free process-global resolver state. Must happen before dispatchExit
    // because `this` may be freed once that posts.
    LiveWorkers.unregister(this);

    // ---- 4. Post close task to parent ------------------------------------
    WebWorker__dispatchExit(cpp_worker, exit_code);
    // `this` may be freed past this point.

    // ---- 5. Free worker-thread resources ---------------------------------
    if (loop) |loop_| {
        loop_.internal_loop_data.jsc_vm = null;
    }
    if (vm_to_deinit) |vm| {
        // Must precede Loop.shutdown so uv_close isn't called twice on the
        // GC timer.
        vm.gc_controller.deinit();
    }
    if (comptime Environment.isWindows) {
        bun.windows.libuv.Loop.shutdown();
    }
    if (vm_to_deinit) |vm| {
        vm.deinit();
    }
    bun.deleteAllPoolsForThreadExit();
    if (arena) |*arena_| {
        arena_.deinit();
    }

    bun.exitThread();
}

/// process.exit() inside the worker. Worker-thread only.
pub fn exit(this: *WebWorker) void {
    this.exit_called = true;
    _ = this.setRequestedTerminate();
    // Stop subsequent JS at the next safepoint. `this.vm` is null during
    // `vm.onExit()` (shutdown nulls it first), so a re-entrant process.exit()
    // from an exit handler does not re-arm the trap.
    if (this.vm) |vm| {
        vm.jsc_vm.notifyNeedTermination();
    }
}

// =============================================================================
// Helpers (worker thread)
// =============================================================================

fn setStatus(this: *WebWorker, status: Status) void {
    log("[{d}] status: {s}", .{ this.execution_context_id, @tagName(status) });
    this.status = status;
}

fn flushLogs(this: *WebWorker, vm: *jsc.VirtualMachine) void {
    jsc.markBinding(@src());
    if (vm.log.msgs.items.len == 0) return;
    const err, const str = blk: {
        const err = vm.log.toJS(vm.global, bun.default_allocator, "Error in worker") catch |e|
            break :blk e;
        const str = err.toBunString(vm.global) catch |e| break :blk e;
        break :blk .{ err, str };
    } catch |err| switch (err) {
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

    const worker = vm.worker orelse @panic("Assertion failure: no worker");

    const writer = &array.writer;
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
    _ = worker.setRequestedTerminate();
    worker.shutdown();
}

/// Resolve a worker entry-point specifier to a path the module loader can
/// consume. The returned slice is BORROWED — it aliases `str`, the standalone
/// module graph, or the resolver's arena; the caller must NOT free it.
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

comptime {
    @export(&create, .{ .name = "WebWorker__create" });
    @export(&notifyNeedTermination, .{ .name = "WebWorker__notifyNeedTermination" });
    @export(&setRef, .{ .name = "WebWorker__setRef" });
    @export(&destroy, .{ .name = "WebWorker__destroy" });
    @export(&releaseParentPollRef, .{ .name = "WebWorker__releaseParentPollRef" });
}

const std = @import("std");
const WTFStringImpl = @import("../string/string.zig").WTFStringImpl;

const bun = @import("bun");
const Async = bun.Async;
const Environment = bun.Environment;
const Output = bun.Output;
const assert = bun.assert;

const jsc = bun.jsc;
const JSValue = jsc.JSValue;
