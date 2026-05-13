//! Reacts to OS low-memory signals by shrinking the JSC heap and returning
//! mimalloc free segments to the OS. One per process, hooked into the
//! main-thread VM's event loop, never keeps the loop alive.
//!
//! Off by default — opt in with
//! `BUN_FEATURE_FLAG_EXPERIMENTAL_MEMORY_PRESSURE_HANDLER=1` so downstreams can
//! A/B the change before it becomes default-on.
//!
//! Detection front-ends:
//! - Windows: `CreateMemoryResourceNotification(LowMemoryResourceNotification)`
//!   waited on via `RegisterWaitForSingleObject` (NT threadpool); the callback
//!   `uv_async_send`s the JS thread. Mirrors WebKit PR 63320.
//! - macOS: `dispatch_source_create(DISPATCH_SOURCE_TYPE_MEMORYPRESSURE, …)` on
//!   a global concurrent queue; the handler enqueues a `ConcurrentTask`.
//!   Mirrors `MemoryPressureHandlerCocoa.mm`.
//! - Linux: a PSI trigger (`/proc/pressure/memory`, `POLLPRI`) blocked on by a
//!   dedicated thread which enqueues a `ConcurrentTask`. PSI signals via
//!   POLLPRI which `Async.FilePoll` doesn't yet expose, hence the thread.
//!
//! All three converge on `respond()` running on the JS thread.
//!
//! `WTF::MemoryPressureHandler` was considered but not used: in Bun's JSCOnly
//! WebKit build it is a no-op stub on macOS, has no OS hook on Linux, polls
//! every 60 s on Windows, and `releaseMemory()` does nothing without a
//! Bun-supplied `lowMemoryHandler` anyway — see `PlatformJSCOnly.cmake`.

const log = bun.Output.scoped(.MemoryPressure, .visible);

/// At most one `respond()` per holdoff window on platforms whose signal stays
/// asserted while pressure persists (Windows level-triggered handle, Linux PSI
/// re-firing each measurement window). macOS only fires on state transitions
/// so it doesn't need this.
const holdoff_ms: u64 = 30_000;

var installed = std.atomic.Value(bool).init(false);

/// Called from `VirtualMachine.init` once the main-thread VM and its event
/// loop exist. Single-shot; later VMs (workers) skip via `is_main_thread`.
pub fn installOnEventLoop(vm: *jsc.VirtualMachine) void {
    if (!bun.feature_flag.BUN_FEATURE_FLAG_EXPERIMENTAL_MEMORY_PRESSURE_HANDLER.get()) return;
    if (installed.swap(true, .monotonic)) return;

    Backend.install(vm);
}

/// Called from `VirtualMachine.deinit` for the main-thread VM. Best-effort:
/// process exit will reclaim everything anyway, but this lets the JS-thread
/// `respond()` race against shutdown cleanly.
pub fn uninstall() void {
    if (!installed.swap(false, .monotonic)) return;
    Backend.uninstall();
}

/// Test seam — runs the JS-thread response path directly. Debug builds only.
/// Returns the post-increment `analytics.Features.memory_pressure` count.
pub fn simulate(vm: *jsc.VirtualMachine) usize {
    if (comptime !Environment.isDebug) return 0;
    respond(vm, true);
    return bun.analytics.Features.memory_pressure;
}

/// Test seam — see `Darwin.testUninstallBarrier`. Returns `true` iff
/// `uninstall()` blocked until an in-flight libdispatch event handler
/// finished (the property a barrier in `uninstall()` would guarantee).
/// Debug + macOS only; trivially `true` elsewhere.
pub fn testUninstallBarrier(vm: *jsc.VirtualMachine) bool {
    if (comptime !(Environment.isDebug and Environment.isMac)) return true;
    return Darwin.testUninstallBarrier(vm);
}

/// The platform-agnostic response. Always runs on the JS thread that owns
/// `vm`, so it's safe to touch the JSC heap directly.
fn respond(vm: *jsc.VirtualMachine, critical: bool) void {
    log("memory pressure ({s}); shrinking footprint", .{if (critical) "critical" else "warning"});
    bun.analytics.Features.memory_pressure += 1;
    // Synchronous full collection now — reclaims unreachable JS objects
    // immediately, regardless of whether we're inside an entryScope.
    _ = vm.global.vm().runGC(true);
    // Deferred deeper cleanup: shrinkFootprintWhenIdle() runs `deleteAllCode`
    // (drops JIT'd code) + another sync full GC + releaseFastMallocFreeMemory
    // via VM::whenIdle, i.e. immediately if no JS is on the stack, otherwise
    // when the current entryScope pops.
    vm.global.vm().shrinkFootprint();
    // Return mimalloc free segments to the OS.
    bun.Global.mimalloc_cleanup(critical);
}

const Backend = if (Environment.isWindows)
    Windows
else if (Environment.isMac)
    Darwin
else if (Environment.isLinux)
    Linux
else
    Noop;

const Noop = struct {
    fn install(_: *jsc.VirtualMachine) void {}
    fn uninstall() void {}
};

// ───────────────────────────────────── Windows ──────────────────────────────

const Windows = struct {
    var state: ?*State = null;

    const State = struct {
        notification: w32.HANDLE,
        wait: ?w32.HANDLE = null,
        wake: libuv.uv_async_t,
        rearm: libuv.Timer,
        vm: *jsc.VirtualMachine,
        /// uv_close is async and close callbacks fire LIFO within a loop
        /// tick, so destroying State from one handle's close cb while the
        /// other's is still pending is a UAF. Count both closes down to 0.
        closing: std.atomic.Value(u32) = .init(0),
    };

    fn install(vm: *jsc.VirtualMachine) void {
        const notification = win_externs.CreateMemoryResourceNotification(.LowMemoryResourceNotification) orelse {
            log("CreateMemoryResourceNotification failed (err={d})", .{@intFromEnum(w32.GetLastError())});
            return;
        };

        const s = bun.new(State, .{
            .notification = notification,
            .wake = undefined,
            .rearm = undefined,
            .vm = vm,
        });
        state = s;

        s.wake.init(vm.uvLoop(), onWake);
        s.wake.unref();
        s.wake.setData(s);
        s.rearm.init(vm.uvLoop());
        s.rearm.unref();
        s.rearm.data = s;

        if (!arm(s)) {
            // Best-effort: leave the libuv handles up but never armed.
            log("RegisterWaitForSingleObject failed (err={d}); watcher disabled", .{@intFromEnum(w32.GetLastError())});
            return;
        }
        log("installed (RegisterWaitForSingleObject)", .{});
    }

    fn arm(s: *State) bool {
        var wait: w32.HANDLE = undefined;
        const ok = win_externs.RegisterWaitForSingleObject(
            &wait,
            s.notification,
            onLowMemoryThreadpool,
            s,
            w32.INFINITE,
            win_externs.WT_EXECUTEINWAITTHREAD | win_externs.WT_EXECUTEONLYONCE,
        );
        if (ok == 0) return false;
        s.wait = wait;
        return true;
    }

    /// NT threadpool thread. The notification handle is *level*-triggered: it
    /// stays signalled while memory remains low, so we registered ONLYONCE and
    /// re-arm from the JS thread after the holdoff.
    ///
    /// We do NOT re-check QueryMemoryResourceNotification here: a TOCTOU
    /// where pressure clears between signal and callback would otherwise
    /// permanently disarm the watcher (the only re-arm path is via onWake).
    /// A false-positive respond() once per 30 s holdoff is harmless.
    fn onLowMemoryThreadpool(ctx: ?*anyopaque, _: w32.BOOLEAN) callconv(.winapi) void {
        const s: *State = @ptrCast(@alignCast(ctx.?));
        s.wake.send();
    }

    /// JS thread.
    fn onWake(handle: [*c]libuv.uv_async_t) callconv(.c) void {
        const s: *State = @ptrCast(@alignCast(handle.*.data.?));
        // WT_EXECUTEONLYONCE only stops the callback re-firing; per MSDN the
        // wait registration must still be UnregisterWaitEx'd to free the NT
        // threadpool object. Safe to do here: we're on the JS thread (via
        // uv_async), not inside the WAITORTIMERCALLBACK, so the "no blocking
        // unregister from the callback" restriction doesn't apply. null
        // CompletionEvent: the callback that posted us has already returned.
        if (s.wait) |w| {
            _ = win_externs.UnregisterWaitEx(w, null);
            s.wait = null;
        }
        respond(s.vm, true);
        s.rearm.start(holdoff_ms, 0, onRearm);
        s.rearm.unref();
    }

    /// JS thread.
    fn onRearm(handle: *libuv.Timer) callconv(.c) void {
        const s: *State = @ptrCast(@alignCast(handle.data.?));
        if (state == null) return; // uninstall() raced
        if (!arm(s)) {
            log("RegisterWaitForSingleObject re-arm failed (err={d}); watcher disabled", .{@intFromEnum(w32.GetLastError())});
        }
    }

    fn uninstall() void {
        const s = state orelse return;
        state = null;
        if (s.wait) |w| {
            // INVALID_HANDLE_VALUE waits for any in-flight callback to drain.
            _ = win_externs.UnregisterWaitEx(w, w32.INVALID_HANDLE_VALUE);
        }
        _ = win_externs.CloseHandle(s.notification);
        s.rearm.stop();
        s.closing.store(2, .monotonic);
        libuv.uv_close(@ptrCast(&s.rearm), onClosed);
        libuv.uv_close(@ptrCast(&s.wake), onClosed);
    }

    fn onClosed(handle: *anyopaque) callconv(.c) void {
        const h: *libuv.Handle = @ptrCast(@alignCast(handle));
        const s: *State = @ptrCast(@alignCast(h.data.?));
        if (s.closing.fetchSub(1, .acq_rel) == 1) bun.destroy(s);
    }
};

// ───────────────────────────────────── Darwin ───────────────────────────────

const Darwin = struct {
    var state: ?*State = null;

    /// Debug-only instrumentation for `testUninstallBarrier()` — lets the
    /// test deterministically park a libdispatch-invoked event handler in
    /// the post-`shutting_down`-check / pre-`enqueueTaskConcurrent` window
    /// while `uninstall()` runs, then observe whether the handler completed
    /// before `uninstall()` returned.
    const TestHooks = if (Environment.isDebug) struct {
        /// Set by `onPressureDispatch` once it's past `shutting_down` and
        /// about to enqueue. The test waits on this before calling uninstall.
        in_handler: std.Thread.ResetEvent = .{},
        /// `onPressureDispatch` waits on this before the enqueue. Released
        /// by the test's helper thread once `uninstall()` is past
        /// `dispatch_source_cancel()` (via `after_cancel`).
        proceed: std.Thread.ResetEvent = .{},
        /// Set inside `uninstall()` immediately after the async
        /// `dispatch_source_cancel()` call — i.e., right at the start of the
        /// would-be race window. The helper thread waits on this so it
        /// releases the worker only once `uninstall()` is in progress.
        after_cancel: std.Thread.ResetEvent = .{},
        /// Set by `onPressureDispatch` after the enqueue completes. The test
        /// snapshots `isSet()` immediately after `uninstall()` returns (RED
        /// ⇒ false: uninstall returned while the worker was still parked;
        /// GREEN ⇒ true: uninstall blocked until the worker — and therefore
        /// the cancel handler — finished), then `wait()`s on it so the
        /// stack-allocated `hooks` outlives the worker even in RED.
        handler_done: std.Thread.ResetEvent = .{},
    } else void;

    const State = struct {
        source: *anyopaque,
        vm: *jsc.VirtualMachine,
        /// Set on the dispatch thread, consumed on the JS thread.
        pending_critical: std.atomic.Value(bool) = .init(true),
        /// Fast-path bail for an in-flight `onPressureDispatch` during
        /// shutdown. NOT load-bearing for safety — see `testUninstallBarrier`
        /// for the TOCTOU (handler can pass this check before it's set).
        shutting_down: std.atomic.Value(bool) = .init(false),
        test_hooks: if (Environment.isDebug) ?*TestHooks else void =
            if (Environment.isDebug) null else {},
    };

    fn install(vm: *jsc.VirtualMachine) void {
        const mask = DISPATCH_MEMORYPRESSURE_WARN | DISPATCH_MEMORYPRESSURE_CRITICAL |
            DISPATCH_MEMORYPRESSURE_PROC_LIMIT_WARN | DISPATCH_MEMORYPRESSURE_PROC_LIMIT_CRITICAL;
        installSource(vm, &_dispatch_source_type_memorypressure, mask, "DISPATCH_SOURCE_TYPE_MEMORYPRESSURE");
    }

    fn installSource(vm: *jsc.VirtualMachine, source_type: *const anyopaque, mask: c_ulong, name: []const u8) void {
        const queue = dispatch_get_global_queue(QOS_CLASS_UTILITY, 0);
        const source = dispatch_source_create(source_type, 0, mask, queue) orelse {
            log("dispatch_source_create({s}) failed", .{name});
            return;
        };
        const s = bun.new(State, .{ .source = source, .vm = vm });
        state = s;
        dispatch_set_context(source, s);
        dispatch_source_set_event_handler_f(source, onPressureDispatch);
        // dispatch_source_cancel() is async and doesn't interrupt an
        // in-flight event handler; libdispatch guarantees the cancel handler
        // runs only after the last event handler has returned, so do the
        // release+destroy there to avoid a UAF.
        dispatch_source_set_cancel_handler_f(source, onCancelled);
        dispatch_resume(source);
        log("installed ({s})", .{name});
    }

    /// libdispatch worker thread. The kernel only fires on state
    /// *transitions*, so no holdoff is needed — one task per transition.
    fn onPressureDispatch(ctx: ?*anyopaque) callconv(.c) void {
        const s: *State = @ptrCast(@alignCast(ctx.?));
        if (s.shutting_down.load(.acquire)) return;
        if (comptime Environment.isDebug) if (s.test_hooks) |th| {
            // Park in the race window so testUninstallBarrier() can run
            // uninstall() while we're between the check and the enqueue.
            th.in_handler.set();
            th.proceed.wait();
        };
        const data = dispatch_source_get_data(s.source);
        const critical = (data & (DISPATCH_MEMORYPRESSURE_CRITICAL | DISPATCH_MEMORYPRESSURE_PROC_LIMIT_CRITICAL)) != 0;
        s.pending_critical.store(critical, .monotonic);
        s.vm.enqueueTaskConcurrent(jsc.ConcurrentTask.fromCallback(s, onJSThread));
        if (comptime Environment.isDebug) if (s.test_hooks) |th| th.handler_done.set();
    }

    /// JS thread.
    fn onJSThread(s: *State) void {
        if (state == null) return; // uninstall() raced
        respond(s.vm, s.pending_critical.load(.monotonic));
    }

    fn uninstall() void {
        const s = state orelse return;
        state = null;
        s.shutting_down.store(true, .release);
        dispatch_source_cancel(s.source);
        if (comptime Environment.isDebug) if (s.test_hooks) |th| th.after_cancel.set();
        // RACE: dispatch_source_cancel() is async and does NOT wait for an
        // in-flight event handler, so onPressureDispatch may be between its
        // shutting_down.load() and enqueueTaskConcurrent() while we return
        // and VirtualMachine.deinit() proceeds to has_terminated=true (which
        // makes that enqueue panic under allow_assert). State cleanup is
        // deferred to onCancelled, which libdispatch guarantees runs after
        // the last event handler — so State is safe; the enqueue is not.
        // Demonstrated by testUninstallBarrier(); barrier added in the
        // following commit. Linux (thread.join) and Windows
        // (UnregisterWaitEx INVALID_HANDLE_VALUE) already block here.
    }

    /// libdispatch worker thread. Runs after the last `onPressureDispatch`
    /// has returned, so State is no longer touched concurrently.
    fn onCancelled(ctx: ?*anyopaque) callconv(.c) void {
        const s: *State = @ptrCast(@alignCast(ctx.?));
        dispatch_release(s.source);
        bun.destroy(s);
    }

    /// Debug-only red/green seam for the `uninstall()` barrier.
    ///
    /// Installs a `DISPATCH_SOURCE_TYPE_DATA_ADD` source (fireable on demand
    /// via `dispatch_source_merge_data`) through the SAME `installSource` /
    /// `onPressureDispatch` / `onCancelled` / `uninstall` path the real
    /// MEMORYPRESSURE source uses, fires it once, parks the libdispatch
    /// worker in the race window, then calls `uninstall()` and snapshots
    /// `handler_done` immediately after it returns.
    ///
    /// Returns `true` iff the handler had completed before `uninstall()`
    /// returned. With the current non-blocking `uninstall()` this is
    /// deterministically `false`: `uninstall()` falls through right after
    /// `after_cancel.set()` while the worker is still parked, the helper
    /// thread hasn't released `proceed` yet (it waits on `after_cancel`),
    /// so when we read `handler_done.isSet()` the worker hasn't reached the
    /// enqueue. After capturing the verdict the seam waits on `handler_done`
    /// so the stack-allocated `hooks` outlives the worker, then joins the
    /// helper. The enqueued ConcurrentTask is harmless: when it later runs
    /// `onJSThread(s)` on the event loop the first line is
    /// `if (state == null) return;`, which bails before any `s` deref.
    pub fn testUninstallBarrier(vm: *jsc.VirtualMachine) bool {
        if (comptime !Environment.isDebug) return true;
        bun.assert(state == null); // don't clobber a real install

        var hooks: TestHooks = .{};
        installSource(vm, &_dispatch_source_type_data_add, 0, "DISPATCH_SOURCE_TYPE_DATA_ADD (test)");
        const s = state orelse return true; // installSource failed; nothing to test
        s.test_hooks = &hooks;

        // Fire the source so libdispatch invokes onPressureDispatch on a
        // worker (NOT a direct call — the cancel-handler ordering guarantee
        // only applies to libdispatch-managed invocations).
        dispatch_source_merge_data(s.source, 1);
        hooks.in_handler.wait();

        // Helper thread releases the worker only once uninstall() is past
        // dispatch_source_cancel() — i.e., inside what would be the race
        // window if uninstall() didn't block.
        const helper = std.Thread.spawn(.{}, struct {
            fn run(th: *TestHooks) void {
                th.after_cancel.wait();
                th.proceed.set();
            }
        }.run, .{&hooks}) catch {
            // Can't spawn — unblock the worker and tear down so we don't
            // hang; report inconclusive-as-pass (best effort for a debug seam).
            hooks.proceed.set();
            Darwin.uninstall();
            hooks.handler_done.wait();
            return true;
        };

        Darwin.uninstall();
        const blocked = hooks.handler_done.isSet();
        // Drain so `hooks` outlives the worker even when uninstall() didn't
        // block (RED). onCancelled then frees `s` once the worker returns.
        hooks.handler_done.wait();
        helper.join();
        return blocked;
    }

    extern "c" const _dispatch_source_type_memorypressure: anyopaque;
    extern "c" const _dispatch_source_type_data_add: anyopaque;
    extern "c" fn dispatch_source_create(type: *const anyopaque, handle: usize, mask: c_ulong, queue: ?*anyopaque) ?*anyopaque;
    extern "c" fn dispatch_source_set_event_handler_f(source: *anyopaque, handler: *const fn (?*anyopaque) callconv(.c) void) void;
    extern "c" fn dispatch_source_set_cancel_handler_f(source: *anyopaque, handler: *const fn (?*anyopaque) callconv(.c) void) void;
    extern "c" fn dispatch_source_merge_data(source: *anyopaque, value: c_ulong) void;
    extern "c" fn dispatch_set_context(object: *anyopaque, context: ?*anyopaque) void;
    extern "c" fn dispatch_source_get_data(source: *anyopaque) c_ulong;
    extern "c" fn dispatch_get_global_queue(identifier: c_long, flags: c_ulong) *anyopaque;
    extern "c" fn dispatch_resume(object: *anyopaque) void;
    extern "c" fn dispatch_source_cancel(source: *anyopaque) void;
    extern "c" fn dispatch_release(object: *anyopaque) void;
    const DISPATCH_MEMORYPRESSURE_WARN: c_ulong = 0x02;
    const DISPATCH_MEMORYPRESSURE_CRITICAL: c_ulong = 0x04;
    const DISPATCH_MEMORYPRESSURE_PROC_LIMIT_WARN: c_ulong = 0x10;
    const DISPATCH_MEMORYPRESSURE_PROC_LIMIT_CRITICAL: c_ulong = 0x20;
    const QOS_CLASS_UTILITY: c_long = 0x11;
};

// ───────────────────────────────────── Linux ────────────────────────────────

const Linux = struct {
    var state: ?*State = null;

    /// ≥150 ms some-stall in any 1 s window. "some" rather than "full" so we
    /// react before the whole process is blocked on reclaim.
    const trigger = "some 150000 1000000\n";

    const State = struct {
        fd: bun.FD,
        thread: std.Thread,
        vm: *jsc.VirtualMachine,
        shutdown: std.atomic.Value(bool) = .init(false),
    };

    fn install(vm: *jsc.VirtualMachine) void {
        // PSI triggers need O_RDWR | O_NONBLOCK and signal via POLLPRI.
        const fd = switch (bun.sys.open("/proc/pressure/memory", bun.O.RDWR | bun.O.NONBLOCK | bun.O.CLOEXEC, 0)) {
            .result => |fd| fd,
            .err => |err| {
                // ENOENT (no PSI), EACCES (some hardened kernels gate
                // unprivileged triggers), …: best-effort, just skip.
                log("PSI unavailable (open /proc/pressure/memory: {s}); watcher disabled", .{@tagName(err.getErrno())});
                return;
            },
        };
        switch (bun.sys.write(fd, trigger)) {
            .result => {},
            .err => |err| {
                // EOPNOTSUPP (psi=0 cmdline), EBUSY, …
                log("PSI unavailable (write trigger: {s}); watcher disabled", .{@tagName(err.getErrno())});
                fd.close();
                return;
            },
        }

        const s = bun.new(State, .{ .fd = fd, .thread = undefined, .vm = vm });
        state = s;
        s.thread = std.Thread.spawn(.{ .stack_size = 64 * 1024 }, run, .{s}) catch {
            log("PSI watcher thread spawn failed; watcher disabled", .{});
            fd.close();
            bun.destroy(s);
            state = null;
            return;
        };
        log("installed (/proc/pressure/memory PSI)", .{});
    }

    /// Dedicated thread. PSI fires POLLPRI which `Async.FilePoll` doesn't yet
    /// expose, so block in poll() here and post a `ConcurrentTask` to the JS
    /// thread when it does — same off-thread→enqueue shape as macOS/Windows.
    ///
    /// On Linux, closing an fd from another thread does NOT wake a poll()
    /// already blocked on it: poll holds its own `struct file` reference via
    /// fdget(), so close() just decrements f_count without reaching
    /// release(). Use a finite timeout so `shutdown` is checked periodically
    /// instead of relying on cross-thread close-as-wakeup.
    fn run(s: *State) void {
        bun.Output.Source.configureNamedThread("MemoryPressure");
        var fds = [1]std.posix.pollfd{.{ .fd = s.fd.cast(), .events = std.posix.POLL.PRI, .revents = 0 }};
        while (!s.shutdown.load(.monotonic)) {
            const n = std.posix.poll(&fds, 200) catch break;
            if (s.shutdown.load(.monotonic)) break;
            if (n == 0) continue;
            if (fds[0].revents & (std.posix.POLL.ERR | std.posix.POLL.HUP | std.posix.POLL.NVAL) != 0) break;
            if (fds[0].revents & std.posix.POLL.PRI == 0) continue;

            s.vm.enqueueTaskConcurrent(jsc.ConcurrentTask.fromCallback(s, onJSThread));

            // PSI re-fires every measurement window while the stall persists;
            // throttle so we don't sync-GC in a tight loop. Sleep in slices so
            // shutdown is reasonably prompt.
            var slept: u64 = 0;
            while (slept < holdoff_ms and !s.shutdown.load(.monotonic)) : (slept += 200) {
                std.Thread.sleep(200 * std.time.ns_per_ms);
            }
        }
    }

    /// JS thread.
    fn onJSThread(s: *State) void {
        if (state == null) return; // uninstall() raced
        respond(s.vm, true);
    }

    fn uninstall() void {
        const s = state orelse return;
        state = null;
        s.shutdown.store(true, .monotonic);
        // run()'s 200 ms poll timeout picks up the shutdown flag; join first
        // and only then close the fd, so a concurrent fd-table reuse can't
        // make the watcher poll() an unrelated file.
        s.thread.join();
        s.fd.close();
        bun.destroy(s);
    }
};

const w32 = if (Environment.isWindows) std.os.windows else struct {};
const libuv = if (Environment.isWindows) bun.windows.libuv else struct {};
const win_externs = if (Environment.isWindows) @import("../windows_sys/externs.zig") else struct {};

const std = @import("std");

const bun = @import("bun");
const Environment = bun.Environment;
const jsc = bun.jsc;
