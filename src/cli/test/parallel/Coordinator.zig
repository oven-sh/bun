//! Process-pool coordinator for `bun test --parallel`. Owns the worker slice,
//! drives the event loop, routes IPC frames to per-test output, and handles
//! crash retry / bail / lazy scale-up. Construction and the run loop entry
//! live in `runner.zig`; this file is the per-run state and its methods.

pub const Coordinator = struct {
    vm: *jsc.VirtualMachine,
    reporter: *CommandLineReporter,
    files: []const PathString,
    cwd: [:0]const u8,
    argv: [:null]?[*:0]const u8,
    /// One envp per worker slot — same base, with that slot's JEST_WORKER_ID
    /// and BUN_TEST_WORKER_ID appended.
    envps: []const [:null]?[*:0]const u8,

    workers: []Worker,
    /// retries[i] counts how many times files[i] has been re-queued after a
    /// worker crashed mid-run.
    retries: []u8,
    pending_retry: []?u32,
    /// Temp dir for per-worker JUnit XML and LCOV coverage fragments; null
    /// when neither was requested.
    worker_tmpdir: ?[:0]const u8,
    junit_fragments: std.ArrayListUnmanaged([]const u8) = .empty,
    coverage_fragments: std.ArrayListUnmanaged([]const u8) = .empty,
    /// File index whose `path:` header was most recently written. Result lines
    /// from concurrent workers interleave; whenever the source file changes the
    /// header is re-emitted so every line has visible context. null at start.
    last_header_idx: ?u32 = null,
    frame: Frame = .{},
    parallel_limit: u32,
    scale_up_after_ms: i64,
    bail: u32,
    dots: bool,
    files_done: u32 = 0,
    spawned_count: u32 = 0,
    live_workers: u32 = 0,
    crashed_files: std.ArrayListUnmanaged(u32) = .empty,
    bailed: bool = false,
    last_printed_dot: bool = false,
    /// Kill-on-close Job Object so the OS reaps workers if the coordinator dies
    /// without running its signal handler (e.g. SIGKILL / TerminateProcess).
    windows_job: if (Environment.isWindows) ?std.os.windows.HANDLE else void =
        if (Environment.isWindows) null else {},

    fn isDone(this: *const Coordinator) bool {
        return (this.files_done >= this.files.len or this.bailed) and this.live_workers == 0;
    }

    fn hasUndispatchedFiles(this: *const Coordinator) bool {
        for (this.workers) |*w| if (!w.range.isEmpty()) return true;
        return false;
    }

    /// The worker (spawned or not) whose range has the most files remaining.
    fn findStealVictim(this: *Coordinator) ?*Worker {
        var victim: ?*Worker = null;
        var most: u32 = 0;
        for (this.workers) |*v| {
            if (v.range.len() > most) {
                most = v.range.len();
                victim = v;
            }
        }
        return victim;
    }

    pub fn drive(this: *Coordinator) void {
        _ = this.spawnWorker();
        while (!this.isDone()) {
            if (AbortHandler.should_abort.load(.acquire)) return this.abortAll();
            this.vm.eventLoop().tick();
            this.maybeScaleUp();
            if (this.isDone()) break;
            if (this.spawned_count < this.parallel_limit and this.hasUndispatchedFiles() and !this.bailed) {
                // Bound the wait so we wake to scale up even if no I/O arrives.
                var ts = bun.timespec{
                    .sec = @divTrunc(this.scale_up_after_ms, std.time.ms_per_s),
                    .nsec = @mod(this.scale_up_after_ms, std.time.ms_per_s) * std.time.ns_per_ms,
                };
                this.vm.eventLoop().usocketsLoop().tickWithTimeout(&ts);
            } else {
                this.vm.eventLoop().autoTick();
            }
        }
    }

    /// SIGINT/SIGTERM: terminate every worker (and its descendants) and exit.
    /// Workers run in their own process group, so kill(-pid, SIGTERM) reaches
    /// everything they spawned. Kernel-level safety nets cover the case where
    /// the coordinator can't run this (SIGKILL): PDEATHSIG on Linux,
    /// kill-on-close Job Object on Windows. macOS has neither; the process
    /// group kill here plus stdin EOF in the worker loop is the best effort.
    fn abortAll(this: *Coordinator) noreturn {
        AbortHandler.uninstall();
        for (this.workers[0..this.spawned_count]) |*w| {
            if (w.process) |p| {
                if (Environment.isPosix) {
                    _ = std.c.kill(-p.pid, std.posix.SIG.TERM);
                } else {
                    _ = p.kill(1);
                }
            }
        }
        if (this.worker_tmpdir) |d| bun.FD.cwd().deleteTree(d) catch {};
        bun.Global.exit(130);
    }

    fn spawnWorker(this: *Coordinator) bool {
        bun.assert(this.spawned_count < this.parallel_limit);
        const w = &this.workers[this.spawned_count];
        // A prior failed start()'s errdefer leaves ipc.done = true; reset so a
        // retry on the same slot starts with a fresh channel.
        w.ipc = .{};
        w.out = .{ .role = .stdout, .worker = w };
        w.err = .{ .role = .stderr, .worker = w };
        w.start() catch |e| {
            Output.err(e, "failed to spawn test worker", .{});
            if (this.live_workers == 0) bun.Global.exit(1);
            return false;
        };
        this.spawned_count += 1;
        return true;
    }

    /// Once every live worker has been busy for at least `scale_up_after_ms`,
    /// spawn the remaining workers. A suite of trivially fast files therefore
    /// runs on one worker with zero spawn overhead; the first slow file
    /// triggers full scale-up so longer suites aren't staircased.
    fn maybeScaleUp(this: *Coordinator) void {
        if (this.spawned_count >= this.parallel_limit) return;
        if (this.bailed or !this.hasUndispatchedFiles()) return;
        const now = std.time.milliTimestamp();
        for (this.workers[0..this.spawned_count]) |*w| {
            if (!w.alive) continue;
            if (w.inflight == null) return;
            if (now - w.dispatched_at < this.scale_up_after_ms) return;
        }
        const want = @min(this.parallel_limit, @as(u32, @intCast(this.files.len)) - this.files_done);
        while (this.spawned_count < want) {
            // On failure, leave the slot unconsumed so the next drive() tick
            // can retry; don't loop here or a hard spawn error would spin.
            if (!this.spawnWorker()) break;
        }
    }

    fn assignWork(this: *Coordinator, w: *Worker) void {
        if (this.bailed) return w.shutdown();
        if (w.range.popFront()) |idx|
            return w.dispatch(idx, this.files[idx].slice());
        // Steal the back half of the largest remaining range as a contiguous
        // block. The thief walks it forward via popFront, so both workers keep
        // directory locality and total steals are O(K log N) instead of O(N).
        // Stealing from not-yet-spawned workers is fine — their range is just
        // an unclaimed reservation.
        if (this.findStealVictim()) |v| {
            if (v.range.stealBackHalf()) |stolen| {
                w.range = stolen;
                if (w.range.popFront()) |idx|
                    return w.dispatch(idx, this.files[idx].slice());
            }
        }
        w.shutdown();
    }

    fn bailOut(this: *Coordinator) void {
        if (this.bailed) return;
        this.bailed = true;
        this.breakDots();
        Output.prettyError("\nBailed out after {d} failure{s}<r>\n", .{ this.bail, if (this.bail == 1) "" else "s" });
        Output.flush();
        for (this.workers[0..this.spawned_count]) |*other| {
            if (other.alive and other.inflight == null) other.shutdown();
        }
    }

    pub fn relPath(this: *Coordinator, file_idx: u32) []const u8 {
        return bun.path.relative(bun.fs.FileSystem.instance.top_level_dir, this.files[file_idx].slice());
    }

    fn ensureHeader(this: *Coordinator, file_idx: u32) void {
        if (this.dots) return;
        if (this.last_header_idx == file_idx) return;
        this.last_header_idx = file_idx;
        Output.errorWriter().print("\n{s}:\n", .{this.relPath(file_idx)}) catch {};
    }

    fn breakDots(this: *Coordinator) void {
        if (this.last_printed_dot) {
            Output.errorWriter().writeByte('\n') catch {};
            this.last_printed_dot = false;
        }
    }

    fn flushCaptured(this: *Coordinator, w: *Worker) void {
        if (w.captured.items.len == 0) return;
        this.breakDots();
        if (w.inflight) |idx| this.ensureHeader(idx);
        Output.errorWriter().writeAll(w.captured.items) catch {};
        if (!bun.strings.endsWithChar(w.captured.items, '\n')) {
            Output.errorWriter().writeByte('\n') catch {};
        }
        w.captured.clearRetainingCapacity();
    }

    pub fn onFrame(this: *Coordinator, w: *Worker, kind: Frame.Kind, rd: *Frame.Reader) void {
        switch (kind) {
            .ready => this.assignWorkOrRetry(w),
            .file_start => _ = rd.u32_(),
            .test_done => {
                const idx = rd.u32_();
                const formatted = rd.str();
                if (w.inflight != idx) return;
                this.flushCaptured(w);
                if (formatted.len == 0) return; // e.g. pass under --only-failures
                // dots-mode failures print a full line (writeTestStatusLine);
                // dots themselves are unterminated.
                const is_dot = this.dots and !bun.strings.endsWithChar(formatted, '\n');
                if (!is_dot) {
                    this.breakDots();
                    this.ensureHeader(idx);
                }
                Output.errorWriter().writeAll(formatted) catch {};
                this.last_printed_dot = is_dot;
                Output.flush();
            },
            .file_done => {
                var nums: [9]u32 = undefined;
                for (&nums) |*n| n.* = rd.u32_();
                const idx, const pass, const fail, const skip, const todo, const expectations, const skipped_label, const files, const unhandled = nums;

                this.flushCaptured(w);

                // A worker can write file_done and crash before the coordinator
                // reads the frame; onWorkerExit() will already have called
                // accountCrash() and cleared inflight. Ignore the buffered frame
                // so we don't double-count.
                if (w.inflight != idx) return;

                const summary = this.reporter.summary();
                summary.pass += pass;
                summary.fail += fail;
                summary.skip += skip;
                summary.todo += todo;
                summary.expectations += expectations;
                summary.skipped_because_label += skipped_label;
                summary.files += files;
                this.reporter.jest.unhandled_errors_between_tests += unhandled;

                w.inflight = null;
                this.files_done += 1;
                if (this.bail > 0 and summary.fail >= this.bail) this.bailOut();
                // A dead worker can deliver a buffered file_done during the
                // pre-reap drain; don't dispatch into it (stdin is gone, the
                // file index would be consumed and skipped). reapWorker()
                // handles the next dispatch via respawn.
                if (w.alive) this.assignWork(w);
            },
            .repeat_bufs => {
                inline for (.{
                    &this.reporter.failures_to_repeat_buf,
                    &this.reporter.skips_to_repeat_buf,
                    &this.reporter.todos_to_repeat_buf,
                }) |dest| {
                    bun.handleOom(dest.appendSlice(bun.default_allocator, rd.str()));
                }
            },
            .junit_file, .coverage_file => {
                const path = rd.str();
                if (path.len == 0) return;
                const list = if (kind == .junit_file) &this.junit_fragments else &this.coverage_fragments;
                bun.handleOom(list.append(bun.default_allocator, bun.handleOom(bun.default_allocator.dupe(u8, path))));
            },
            .run, .shutdown => {},
        }
    }

    pub fn onWorkerExit(this: *Coordinator, w: *Worker, status: bun.spawn.Status) void {
        w.exit_status = status;
        // The Channel delivers any remaining buffered data then close (which
        // sets ipc.done and calls tryReap), so no explicit drain is needed —
        // tryReap here covers the case where the channel already closed first.
        this.tryReap(w);
    }

    pub fn tryReap(this: *Coordinator, w: *Worker) void {
        const status = w.exit_status orelse return;
        if (!w.ipc.done) return;
        w.exit_status = null;
        this.reapWorker(w, status);
    }

    fn reapWorker(this: *Coordinator, w: *Worker, status: bun.spawn.Status) void {
        // Decrement here (not in onProcessExit) so drive() keeps pumping until
        // the IPC pipe has been drained and this reap actually runs.
        this.live_workers -= 1;
        this.flushCaptured(w);
        var retry_idx: ?u32 = null;
        if (w.inflight) |idx| {
            this.breakDots();
            this.ensureHeader(idx);
            const rel = this.relPath(idx);
            if (this.retries[idx] < 1) {
                this.retries[idx] += 1;
                retry_idx = idx;
                Output.prettyError("<r><yellow>⟳<r> crashed running <b>{s}<r>, retrying\n", .{rel});
            } else {
                this.accountCrash(idx, @tagName(status));
            }
            Output.flush();
            w.inflight = null;
        }

        var respawned = false;
        if (!this.bailed and (this.hasUndispatchedFiles() or retry_idx != null)) {
            w.ipc.deinit();
            w.out.deinit();
            w.err.deinit();
            w.ipc = .{};
            w.out = .{ .role = .stdout, .worker = w };
            w.err = .{ .role = .stderr, .worker = w };
            w.process = null;
            if (w.start()) |_| {
                respawned = true;
                if (retry_idx) |idx| this.pending_retry[w.idx] = idx;
            } else |e| {
                Output.err(e, "failed to respawn test worker", .{});
            }
        }

        if (!respawned) {
            // The worker slot is dead. Any retry that was queued for it (either
            // from this exit or from a prior respawn that died before .ready)
            // will never be picked up — count it as a crash so totals stay
            // correct and drive() doesn't wait on a files_done that can't
            // advance.
            if (retry_idx orelse this.pending_retry[w.idx]) |orphan| {
                this.pending_retry[w.idx] = null;
                this.accountCrash(orphan, "retry abandoned");
                Output.flush();
            }
            if (!this.bailed and this.live_workers == 0) {
                this.abortQueuedFiles("no live workers");
            }
            w.ipc.deinit();
            w.out.deinit();
            w.err.deinit();
            w.captured.deinit(bun.default_allocator);
        }
    }

    fn accountCrash(this: *Coordinator, file_idx: u32, reason: []const u8) void {
        this.breakDots();
        Output.prettyError("<r><red>✗<r> <b>{s}<r> <d>(crashed: {s})<r>\n", .{ this.relPath(file_idx), reason });
        this.reporter.summary().fail += 1;
        this.reporter.summary().files += 1;
        bun.handleOom(this.crashed_files.append(bun.default_allocator, file_idx));
        this.files_done += 1;
        if (this.bail > 0 and this.reporter.summary().fail >= this.bail) this.bailOut();
    }

    /// Mark every not-yet-dispatched file as failed so `drive()` can exit
    /// instead of spinning when no live worker remains to make progress.
    fn abortQueuedFiles(this: *Coordinator, reason: []const u8) void {
        for (this.workers) |*w| {
            while (w.range.popFront()) |idx| {
                Output.prettyError("<r><red>✗<r> <b>{s}<r> <d>({s})<r>\n", .{ this.relPath(idx), reason });
                this.reporter.summary().fail += 1;
                this.reporter.summary().files += 1;
                bun.handleOom(this.crashed_files.append(bun.default_allocator, idx));
                this.files_done += 1;
            }
        }
        Output.flush();
    }

    fn assignWorkOrRetry(this: *Coordinator, w: *Worker) void {
        if (this.bailed) return w.shutdown();
        if (this.pending_retry[w.idx]) |idx| {
            this.pending_retry[w.idx] = null;
            w.dispatch(idx, this.files[idx].slice());
        } else {
            this.assignWork(w);
        }
    }

    /// Coordinator-side SIGINT/SIGTERM handling. The signal handler only sets a
    /// flag; `Coordinator.drive` checks it and tears down workers itself so we
    /// don't do non-signal-safe work in the handler. Linux PDEATHSIG and the
    /// Windows Job Object are the safety net for when the coordinator can't run
    /// this (SIGKILL).
    pub const AbortHandler = struct {
        var should_abort: std.atomic.Value(bool) = .init(false);
        var prev_int: if (Environment.isPosix) std.posix.Sigaction else void = undefined;
        var prev_term: if (Environment.isPosix) std.posix.Sigaction else void = undefined;

        fn posixHandler(_: i32, _: *const std.posix.siginfo_t, _: ?*const anyopaque) callconv(.c) void {
            should_abort.store(true, .release);
        }

        fn windowsCtrlHandler(ctrl: std.os.windows.DWORD) callconv(.winapi) std.os.windows.BOOL {
            switch (ctrl) {
                std.os.windows.CTRL_C_EVENT, std.os.windows.CTRL_BREAK_EVENT, std.os.windows.CTRL_CLOSE_EVENT => {
                    should_abort.store(true, .release);
                    return std.os.windows.TRUE;
                },
                else => return std.os.windows.FALSE,
            }
        }

        pub fn install() void {
            if (Environment.isPosix) {
                const act = std.posix.Sigaction{
                    .handler = .{ .sigaction = posixHandler },
                    .mask = std.posix.sigemptyset(),
                    .flags = std.posix.SA.SIGINFO,
                };
                std.posix.sigaction(std.posix.SIG.INT, &act, &prev_int);
                std.posix.sigaction(std.posix.SIG.TERM, &act, &prev_term);
            } else {
                _ = bun.c.SetConsoleCtrlHandler(windowsCtrlHandler, std.os.windows.TRUE);
            }
        }

        pub fn uninstall() void {
            if (Environment.isPosix) {
                std.posix.sigaction(std.posix.SIG.INT, &prev_int, null);
                std.posix.sigaction(std.posix.SIG.TERM, &prev_term, null);
            } else {
                _ = bun.c.SetConsoleCtrlHandler(windowsCtrlHandler, std.os.windows.FALSE);
            }
        }
    };

    pub fn createWindowsKillOnCloseJob() ?std.os.windows.HANDLE {
        if (!Environment.isWindows) return null;
        const job = bun.windows.CreateJobObjectA(null, null) orelse return null;
        var jeli = std.mem.zeroes(bun.c.JOBOBJECT_EXTENDED_LIMIT_INFORMATION);
        jeli.BasicLimitInformation.LimitFlags = bun.c.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        if (bun.c.SetInformationJobObject(
            job,
            bun.c.JobObjectExtendedLimitInformation,
            &jeli,
            @sizeOf(bun.c.JOBOBJECT_EXTENDED_LIMIT_INFORMATION),
        ) == 0) {
            std.os.windows.CloseHandle(job);
            return null;
        }
        return job;
    }
};

const Frame = @import("./Frame.zig");
const Worker = @import("./Worker.zig");
const std = @import("std");

const test_command = @import("../../test_command.zig");
const CommandLineReporter = test_command.CommandLineReporter;

const bun = @import("bun");
const Environment = bun.Environment;
const Output = bun.Output;
const PathString = bun.PathString;
const jsc = bun.jsc;
