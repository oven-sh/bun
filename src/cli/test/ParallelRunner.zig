//! `bun test --parallel`: process-pool coordinator and worker.
//!
//! The coordinator lazily spawns up to N `bun test --test-worker --isolate`
//! processes (starting with one, adding another whenever every live worker
//! has been busy for ≥`scale_up_after_ms`), hands out one file at a time over
//! stdin, and reads per-test events back over fd 3. Per-test status lines are
//! streamed to the coordinator the moment a test finishes; worker stdout and
//! stderr are buffered and flushed atomically before each result line so
//! console output never interleaves across files. Output is identical to
//! serial: workers are an implementation detail and never named.

/// fd 3 in the worker. On Windows this must be a libuv (CRT) fd so
/// `uv_get_osfhandle(3)` resolves to the inherited handle; can't be a
/// file-scope const because `FD.fromUV` rejects >2 at comptime.
fn ipcFd() bun.FD {
    return .fromUV(3);
}

/// Wire protocol on both stdin and fd 3: length-prefixed binary frames.
///   [u32 LE payload_len][u8 kind][payload]
/// Strings within a payload are [u32 LE len][bytes].
const Kind = enum(u8) {
    // worker → coordinator
    ready, // (empty)
    file_start, // u32 file_idx
    test_done, // u32 file_idx, str formatted_line (ANSI included; printed verbatim)
    file_done, // 9 × u32: file_idx, pass, fail, skip, todo, expectations, skipped_label, files, unhandled
    repeat_bufs, // 3 × str: failures, skips, todos (verbatim repeat-buffer bytes)
    junit_file, // str path
    coverage_file, // str path
    // coordinator → worker
    run, // u32 file_idx, str path
    shutdown, // (empty)
};

/// Minimal length-prefixed binary codec. Frames build into a reusable buffer
/// then flush in a single write so partial reads on the other side never see a
/// torn header.
const Frame = struct {
    buf: std.ArrayListUnmanaged(u8) = .empty,

    fn begin(self: *Frame, kind: Kind) void {
        self.buf.clearRetainingCapacity();
        // reserve header; payload_len patched in send()
        bun.handleOom(self.buf.appendNTimes(bun.default_allocator, 0, 4));
        bun.handleOom(self.buf.append(bun.default_allocator, @intFromEnum(kind)));
    }
    fn u32_(self: *Frame, v: u32) void {
        var le: [4]u8 = undefined;
        std.mem.writeInt(u32, &le, v, .little);
        bun.handleOom(self.buf.appendSlice(bun.default_allocator, &le));
    }
    fn str(self: *Frame, s: []const u8) void {
        self.u32_(@intCast(s.len));
        bun.handleOom(self.buf.appendSlice(bun.default_allocator, s));
    }
    fn send(self: *Frame, fd: bun.FD) void {
        const payload_len: u32 = @intCast(self.buf.items.len - 5);
        std.mem.writeInt(u32, self.buf.items[0..4], payload_len, .little);
        writeAll(fd, self.buf.items);
    }
    fn deinit(self: *Frame) void {
        self.buf.deinit(bun.default_allocator);
    }

    /// Payload reader; bounds-checked, returns zero/empty on truncation.
    const Reader = struct {
        p: []const u8,
        fn u32_(self: *Reader) u32 {
            if (self.p.len < 4) return 0;
            const v = std.mem.readInt(u32, self.p[0..4], .little);
            self.p = self.p[4..];
            return v;
        }
        fn str(self: *Reader) []const u8 {
            const n = self.u32_();
            if (self.p.len < n) return "";
            const s = self.p[0..n];
            self.p = self.p[n..];
            return s;
        }
    };
};

/// All workers are busy for at least this long before another is spawned.
/// Overridable via BUN_TEST_PARALLEL_SCALE_MS for tests, where debug-build
/// module load alone can exceed the production 5ms threshold.
const default_scale_up_after_ms = 5;

/// Upper bound on a single IPC frame payload. The protocol is internal but
/// fd 3 is reachable from test JS via `fs.writeSync(3, ...)`; rejecting
/// nonsensical lengths up-front prevents both a `5 + len` u32 overflow and
/// an unbounded allocation.
const max_frame_payload: u32 = 64 * 1024 * 1024;

/// Reads worker output (IPC, stdout, or stderr) and routes it. One per pipe.
/// IPC bytes are frame-decoded; stdout/stderr accumulate into the worker's
/// `captured` buffer and flush atomically with the next test result so console
/// output from concurrent files never interleaves.
const WorkerPipe = struct {
    reader: bun.io.BufferedReader = bun.io.BufferedReader.init(WorkerPipe),
    worker: *Worker,
    role: enum { ipc, stdout, stderr },
    buf: std.ArrayListUnmanaged(u8) = .empty,
    /// EOF or error observed. For the IPC pipe this gates `tryReap` so
    /// kernel-buffered frames written just before exit() are decoded
    /// before the pipe is torn down.
    done: bool = false,

    pub fn deinit(this: *WorkerPipe) void {
        this.reader.deinit();
        this.buf.deinit(bun.default_allocator);
    }

    pub fn onReadChunk(this: *WorkerPipe, chunk: []const u8, _: bun.io.ReadState) bool {
        if (this.role != .ipc) {
            bun.handleOom(this.worker.captured.appendSlice(bun.default_allocator, chunk));
            return true;
        }
        bun.handleOom(this.buf.appendSlice(bun.default_allocator, chunk));
        var head: usize = 0;
        while (this.buf.items.len - head >= 5) {
            const len = std.mem.readInt(u32, this.buf.items[head..][0..4], .little);
            if (len > max_frame_payload) {
                // Corrupt or hostile frame (test JS wrote to fd 3). Kill the
                // worker so onWorkerExit accounts for the in-flight file and
                // the slot can respawn.
                this.buf.clearRetainingCapacity();
                this.done = true;
                if (this.worker.process) |p| _ = p.kill(9);
                return false;
            }
            if (this.buf.items.len - head < @as(usize, 5) + len) break;
            const kind = std.meta.intToEnum(Kind, this.buf.items[head + 4]) catch {
                head += @as(usize, 5) + len;
                continue;
            };
            var rd = Frame.Reader{ .p = this.buf.items[head + 5 ..][0..len] };
            this.worker.coord.onFrame(this.worker, kind, &rd);
            head += @as(usize, 5) + len;
        }
        if (head > 0) {
            const rest = this.buf.items.len - head;
            std.mem.copyForwards(u8, this.buf.items[0..rest], this.buf.items[head..]);
            this.buf.items.len = rest;
        }
        return true;
    }
    pub fn onReaderDone(this: *WorkerPipe) void {
        this.done = true;
        if (this.role == .ipc) this.worker.coord.tryReap(this.worker);
    }
    pub fn onReaderError(this: *WorkerPipe, _: bun.sys.Error) void {
        this.done = true;
        if (this.role == .ipc) this.worker.coord.tryReap(this.worker);
    }
    pub fn eventLoop(this: *WorkerPipe) *jsc.EventLoop {
        return this.worker.coord.vm.eventLoop();
    }
    pub fn loop(this: *WorkerPipe) *bun.Async.Loop {
        return this.worker.coord.vm.uvLoop();
    }
};

pub const Worker = struct {
    coord: *Coordinator,
    idx: u32,
    process: ?*bun.spawn.Process = null,
    stdin_fd: ?bun.FD = null,

    ipc: WorkerPipe,
    out: WorkerPipe,
    err: WorkerPipe,

    /// Index into `Coordinator.files` currently running on this worker.
    inflight: ?u32 = null,
    /// `std.time.milliTimestamp()` at the most recent dispatch; drives lazy
    /// scale-up.
    dispatched_at: i64 = 0,
    /// Worker stdout+stderr since the last `test_done`. Flushed atomically
    /// under the right file header so concurrent files don't interleave.
    captured: std.ArrayListUnmanaged(u8) = .empty,
    alive: bool = false,
    /// Set when the process-exit notification arrives. Reaping waits for both
    /// this and `ipc.done` so trailing IPC frames are decoded first.
    exit_status: ?bun.spawn.Status = null,
    extra_fd_stdio: [1]bun.spawn.SpawnOptions.Stdio = .{.ignore},

    fn start(this: *Worker) !void {
        bun.assert(!this.alive);
        const coord = this.coord;

        this.ipc.reader.setParent(&this.ipc);
        this.out.reader.setParent(&this.out);
        this.err.reader.setParent(&this.err);

        // All resource cleanup on any error return — including watchOrReap
        // failure below. Each guard checks for null/unstarted so the order in
        // which fields are populated doesn't matter.
        errdefer {
            if (this.process) |p| {
                p.exit_handler = .{};
                if (!p.hasExited()) _ = p.kill(9);
                p.close();
                this.process = null;
            }
            if (this.stdin_fd) |fd| {
                fd.close();
                this.stdin_fd = null;
            }
            this.ipc.deinit();
            this.out.deinit();
            this.err.deinit();
        }

        if (Environment.isPosix) {
            this.extra_fd_stdio = .{.buffer};
            const options: bun.spawn.SpawnOptions = .{
                .stdin = .buffer,
                .stdout = .buffer,
                .stderr = .buffer,
                .extra_fds = &this.extra_fd_stdio,
                .cwd = coord.cwd,
                .stream = true,
            };
            var spawned = try (try bun.spawn.spawnProcess(&options, coord.argv.ptr, coord.envp)).unwrap();
            defer spawned.extra_pipes.deinit();
            this.process = spawned.toProcess(coord.vm.eventLoop(), false);
            this.stdin_fd = spawned.stdin;
            if (spawned.stdout) |fd| try this.out.reader.start(fd, true).unwrap();
            if (spawned.stderr) |fd| try this.err.reader.start(fd, true).unwrap();
            if (spawned.extra_pipes.items.len > 0) {
                try this.ipc.reader.start(spawned.extra_pipes.items[0], true).unwrap();
            } else {
                this.ipc.done = true;
            }
        } else {
            // Windows: stdin and the fd-3 results pipe are created with
            // bun.sys.pipe() (uv_pipe(0,0) → both ends non-overlapped) so the
            // worker's blocking ReadFile/WriteFile and the coordinator's
            // bun.sys.write(stdin_fd) work. Same approach security_scanner.zig
            // uses for its child-sync-IO pipes. stdout/stderr stay as libuv
            // .buffer pipes since the child writes via the CRT and the
            // coordinator reads async via startWithPipe().
            // TODO: verify on Windows CI.
            const uv = bun.windows.libuv;

            var stdin_pair = try bun.sys.pipe().unwrap();
            errdefer for (&stdin_pair) |*fd| {
                if (fd.isValid()) fd.close();
            };
            var ipc_pair = try bun.sys.pipe().unwrap();
            errdefer for (&ipc_pair) |*fd| {
                if (fd.isValid()) fd.close();
            };

            this.extra_fd_stdio = .{.{ .pipe = ipc_pair[1] }};
            const options: bun.spawn.SpawnOptions = .{
                .stdin = .{ .pipe = stdin_pair[0] },
                .stdout = .{ .buffer = bun.new(uv.Pipe, std.mem.zeroes(uv.Pipe)) },
                .stderr = .{ .buffer = bun.new(uv.Pipe, std.mem.zeroes(uv.Pipe)) },
                .extra_fds = &this.extra_fd_stdio,
                .cwd = coord.cwd,
                .windows = .{ .loop = jsc.EventLoopHandle.init(coord.vm) },
                .stream = true,
            };
            var spawned = try (try bun.spawn.spawnProcess(&options, coord.argv.ptr, coord.envp)).unwrap();
            this.process = spawned.toProcess(coord.vm.eventLoop(), false);

            stdin_pair[0].close();
            stdin_pair[0] = bun.FD.invalid;
            ipc_pair[1].close();
            ipc_pair[1] = bun.FD.invalid;
            this.stdin_fd = stdin_pair[1];
            stdin_pair[1] = bun.FD.invalid;

            try this.ipc.reader.start(ipc_pair[0], true).unwrap();
            ipc_pair[0] = bun.FD.invalid;
            if (spawned.stdout == .buffer) try this.out.reader.startWithPipe(spawned.stdout.buffer).unwrap();
            if (spawned.stderr == .buffer) try this.err.reader.startWithPipe(spawned.stderr.buffer).unwrap();
            spawned.extra_pipes.deinit();
        }

        const process = this.process.?;
        this.alive = true;
        coord.live_workers += 1;
        process.setExitHandler(this);
        switch (process.watchOrReap()) {
            .result => {},
            .err => |e| {
                // Surface to the caller (spawnWorker / onWorkerExit) instead of
                // synchronously firing onExit() — that would re-enter
                // onWorkerExit() → start(), which under persistent EMFILE
                // recurses unboundedly while spawning real processes each frame.
                // Resource cleanup is handled by the function-scope errdefer.
                this.alive = false;
                coord.live_workers -= 1;
                Output.err(e, "watchOrReap failed for test worker", .{});
                return error.ProcessWatchFailed;
            },
        }
    }

    pub fn onProcessExit(this: *Worker, _: *bun.spawn.Process, status: bun.spawn.Status, _: *const bun.spawn.Rusage) void {
        this.alive = false;
        if (this.stdin_fd) |fd| {
            fd.close();
            this.stdin_fd = null;
        }
        this.coord.onWorkerExit(this, status);
    }

    pub fn eventLoop(this: *Worker) *jsc.EventLoop {
        return this.coord.vm.eventLoop();
    }
    pub fn loop(this: *Worker) *bun.Async.Loop {
        return this.coord.vm.uvLoop();
    }

    fn dispatch(this: *Worker, file_idx: u32, file: []const u8) void {
        const fd = this.stdin_fd orelse return;
        const f = &this.coord.frame;
        f.begin(.run);
        f.u32_(file_idx);
        f.str(file);
        f.send(fd);
        this.inflight = file_idx;
        this.dispatched_at = std.time.milliTimestamp();
    }

    fn shutdown(this: *Worker) void {
        if (this.stdin_fd) |fd| {
            const f = &this.coord.frame;
            f.begin(.shutdown);
            f.send(fd);
            fd.close();
            this.stdin_fd = null;
        }
    }
};

pub const Coordinator = struct {
    vm: *jsc.VirtualMachine,
    reporter: *CommandLineReporter,
    files: []const PathString,
    cwd: [:0]const u8,
    argv: [:null]?[*:0]const u8,
    envp: [*:null]?[*:0]const u8,

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
    next_file: u32 = 0,
    files_done: u32 = 0,
    spawned_count: u32 = 0,
    live_workers: u32 = 0,
    crashed_files: u32 = 0,
    bailed: bool = false,
    last_printed_dot: bool = false,

    fn isDone(this: *const Coordinator) bool {
        return (this.files_done >= this.files.len or this.bailed) and this.live_workers == 0;
    }

    pub fn drive(this: *Coordinator) void {
        _ = this.spawnWorker();
        while (!this.isDone()) {
            this.vm.eventLoop().tick();
            this.maybeScaleUp();
            if (this.isDone()) break;
            if (this.spawned_count < this.parallel_limit and this.next_file < this.files.len and !this.bailed) {
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

    fn spawnWorker(this: *Coordinator) bool {
        bun.assert(this.spawned_count < this.parallel_limit);
        const w = &this.workers[this.spawned_count];
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
        if (this.bailed or this.next_file >= this.files.len) return;
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
        if (!this.bailed and this.next_file < this.files.len) {
            const idx = this.next_file;
            this.next_file += 1;
            w.dispatch(idx, this.files[idx].slice());
        } else {
            w.shutdown();
        }
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

    fn relPath(this: *Coordinator, file_idx: u32) []const u8 {
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

    fn onFrame(this: *Coordinator, w: *Worker, kind: Kind, rd: *Frame.Reader) void {
        switch (kind) {
            .ready => this.assignWorkOrRetry(w),
            .file_start => _ = rd.u32_(),
            .test_done => {
                const idx = rd.u32_();
                const formatted = rd.str();
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

    fn onWorkerExit(this: *Coordinator, w: *Worker, status: bun.spawn.Status) void {
        w.exit_status = status;
        // POSIX: synchronously drain anything already in the kernel pipe
        // buffer; the writer is dead so this can't block. On Windows
        // BufferedReader.read() is just unpause() and the EOF callback drives
        // tryReap when libuv delivers it.
        if (!w.ipc.done) w.ipc.reader.read();
        this.tryReap(w);
    }

    fn tryReap(this: *Coordinator, w: *Worker) void {
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
        if (!this.bailed and (this.next_file < this.files.len or retry_idx != null)) {
            w.ipc.deinit();
            w.out.deinit();
            w.err.deinit();
            w.ipc = .{ .role = .ipc, .worker = w };
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
        this.crashed_files += 1;
        this.files_done += 1;
        if (this.bail > 0 and this.reporter.summary().fail >= this.bail) this.bailOut();
    }

    /// Mark every not-yet-dispatched file as failed so `drive()` can exit
    /// instead of spinning when no live worker remains to make progress.
    fn abortQueuedFiles(this: *Coordinator, reason: []const u8) void {
        while (this.next_file < this.files.len) : (this.next_file += 1) {
            const rel = this.relPath(this.next_file);
            Output.prettyError("<r><red>✗<r> <b>{s}<r> <d>({s})<r>\n", .{ rel, reason });
            this.reporter.summary().fail += 1;
            this.reporter.summary().files += 1;
            this.crashed_files += 1;
            this.files_done += 1;
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
};

/// Returns true if files were actually run via the worker pool, false if it
/// fell back to the sequential path (≤1 effective worker). The caller uses
/// this to decide whether to run the serial coverage/JUnit reporters.
pub fn runAsCoordinator(
    reporter: *CommandLineReporter,
    vm: *jsc.VirtualMachine,
    files: []const PathString,
    ctx: Command.Context,
    coverage_opts: *TestCommand.CodeCoverageOptions,
) !bool {
    const allocator = ctx.allocator;
    const n: u32 = @min(ctx.test_options.parallel, @as(u32, @intCast(files.len)));
    if (n <= 1) {
        TestCommand.runAllTests(reporter, vm, files, allocator);
        return false;
    }

    Output.prettyError("<d>(parallel)<r>\n", .{});
    Output.flush();

    var arena = std.heap.ArenaAllocator.init(allocator);
    defer arena.deinit();

    var worker_tmpdir: ?[:0]const u8 = null;
    // Workers' stderr is a pipe; have them format with ANSI when we will be
    // rendering to a color terminal so streamed lines match serial output.
    if (Output.enable_ansi_colors_stderr) {
        bun.handleOom(vm.transpiler.env.map.put("FORCE_COLOR", "1"));
    }
    defer if (worker_tmpdir) |d| bun.FD.cwd().deleteTree(d) catch {};
    if (ctx.test_options.reporters.junit or coverage_opts.enabled) {
        const dir = try std.fmt.allocPrintSentinel(arena.allocator(), "{s}/bun-test-worker-{d}", .{ bun.fs.FileSystem.RealFS.getDefaultTempDir(), std.crypto.random.int(u32) }, 0);
        bun.FD.cwd().makePath(u8, dir) catch |e| {
            Output.err(e, "failed to create worker temp dir {s}", .{dir});
            bun.Global.exit(1);
        };
        worker_tmpdir = dir;
        bun.handleOom(vm.transpiler.env.map.put("BUN_TEST_WORKER_TMP", dir));
        // Coordinator's own JunitReporter would otherwise produce an empty
        // document and overwrite the merged one in writeJUnitReportIfNeeded.
        if (reporter.reporters.junit) |jr| {
            bun.handleOom(vm.transpiler.env.map.put("BUN_TEST_WORKER_JUNIT", "1"));
            jr.deinit();
            reporter.reporters.junit = null;
        }
    }
    const envp = try vm.transpiler.env.map.createNullDelimitedEnvMap(arena.allocator());
    const argv = try buildWorkerArgv(arena.allocator(), ctx);

    const workers = try allocator.alloc(Worker, n);
    const retries = try allocator.alloc(u8, files.len);
    @memset(retries, 0);
    const pending_retry = try allocator.alloc(?u32, n);
    @memset(pending_retry, null);

    var coord = Coordinator{
        .vm = vm,
        .reporter = reporter,
        .files = files,
        .cwd = bun.fs.FileSystem.instance.top_level_dir,
        .argv = argv,
        .envp = envp,
        .workers = workers,
        .retries = retries,
        .pending_retry = pending_retry,
        .worker_tmpdir = worker_tmpdir,
        .parallel_limit = n,
        .scale_up_after_ms = if (vm.transpiler.env.get("BUN_TEST_PARALLEL_SCALE_MS")) |s|
            std.fmt.parseInt(i64, s, 10) catch default_scale_up_after_ms
        else
            default_scale_up_after_ms,
        .bail = ctx.test_options.bail,
        .dots = ctx.test_options.reporters.dots,
    };

    for (workers, 0..) |*w, i| {
        w.* = .{
            .coord = &coord,
            .idx = @intCast(i),
            .ipc = .{ .role = .ipc, .worker = w },
            .out = .{ .role = .stdout, .worker = w },
            .err = .{ .role = .stderr, .worker = w },
        };
    }

    vm.eventLoop().ensureWaker();
    vm.runWithAPILock(Coordinator, &coord, Coordinator.drive);

    if (ctx.test_options.reporters.junit) {
        if (ctx.test_options.reporter_outfile) |outfile| {
            mergeJUnitFragments(coord.junit_fragments.items, outfile, reporter.summary());
        }
    }
    if (coverage_opts.enabled) {
        switch (Output.enable_ansi_colors_stderr) {
            inline else => |colors| mergeCoverageFragments(coord.coverage_fragments.items, coverage_opts, colors),
        }
    }
    return true;
}

fn mergeJUnitFragments(paths: []const []const u8, outfile: []const u8, summary: *const TestRunner.Summary) void {
    var contents: std.ArrayListUnmanaged(u8) = .empty;
    defer contents.deinit(bun.default_allocator);

    const elapsed_time = @as(f64, @floatFromInt(std.time.nanoTimestamp() - bun.start_time)) / std.time.ns_per_s;
    bun.handleOom(contents.writer(bun.default_allocator).print(
        \\<?xml version="1.0" encoding="UTF-8"?>
        \\<testsuites name="bun test" tests="{d}" assertions="{d}" failures="{d}" skipped="{d}" time="{d}">
        \\
    , .{
        summary.pass + summary.fail + summary.skip + summary.todo,
        summary.expectations,
        summary.fail,
        summary.skip + summary.todo,
        elapsed_time,
    }));

    for (paths) |path| {
        const file = switch (bun.sys.File.readFrom(bun.FD.cwd(), path, bun.default_allocator)) {
            .result => |r| r,
            .err => continue,
        };
        defer bun.default_allocator.free(file);
        // Each fragment is a full <testsuites> document; extract its body.
        const open_end = bun.strings.indexOf(file, "<testsuites") orelse continue;
        const body_start = open_end + (bun.strings.indexOfChar(file[open_end..], '>') orelse continue) + 1;
        const body_end = bun.strings.lastIndexOf(file, "</testsuites>") orelse continue;
        if (body_start >= body_end) continue;
        const body = std.mem.trim(u8, file[body_start..body_end], "\n");
        if (body.len == 0) continue;
        bun.handleOom(contents.appendSlice(bun.default_allocator, body));
        bun.handleOom(contents.append(bun.default_allocator, '\n'));
    }

    bun.handleOom(contents.appendSlice(bun.default_allocator, "</testsuites>\n"));

    const out_z = bun.handleOom(bun.default_allocator.dupeZ(u8, outfile));
    defer bun.default_allocator.free(out_z);
    switch (bun.sys.File.openat(.cwd(), out_z, bun.O.WRONLY | bun.O.CREAT | bun.O.TRUNC, 0o664)) {
        .err => |err| Output.err(error.JUnitReportFailed, "Failed to write JUnit report to {s}\n{f}", .{ outfile, err }),
        .result => |fd| {
            defer _ = fd.close();
            _ = bun.sys.File.writeAll(fd, contents.items);
        },
    }
}

const FileCoverage = struct {
    path: []const u8,
    fnf: u32 = 0,
    fnh: u32 = 0,
    /// 1-based line number → summed hit count.
    da: std.AutoArrayHashMapUnmanaged(u32, u32) = .empty,

    fn lh(self: *const FileCoverage) u32 {
        var n: u32 = 0;
        for (self.da.values()) |c| n += @intFromBool(c > 0);
        return n;
    }
};

/// Merge per-worker LCOV fragments into a single report. Line-level (DA) merge
/// is precise. FNF/FNH take the per-worker max since Bun's LCOV writer doesn't
/// emit per-function FN/FNDA records yet, so disjoint per-worker function hits
/// can't be unioned; this under-reports % Funcs when workers cover different
/// functions of the same file. The non-parallel path has the same FN/FNDA gap.
fn mergeCoverageFragments(paths: []const []const u8, opts: *TestCommand.CodeCoverageOptions, comptime enable_colors: bool) void {
    var arena_state = std.heap.ArenaAllocator.init(bun.default_allocator);
    defer arena_state.deinit();
    const arena = arena_state.allocator();

    var by_file: bun.StringArrayHashMapUnmanaged(FileCoverage) = .empty;

    for (paths) |path| {
        const data = switch (bun.sys.File.readFrom(bun.FD.cwd(), path, arena)) {
            .result => |r| r,
            .err => continue,
        };
        var cur: ?*FileCoverage = null;
        var lines = std.mem.splitScalar(u8, data, '\n');
        while (lines.next()) |raw| {
            const line = std.mem.trimEnd(u8, raw, "\r");
            if (bun.strings.hasPrefixComptime(line, "SF:")) {
                const name = line[3..];
                const gop = bun.handleOom(by_file.getOrPut(arena, name));
                if (!gop.found_existing) {
                    gop.key_ptr.* = bun.handleOom(arena.dupe(u8, name));
                    gop.value_ptr.* = .{ .path = gop.key_ptr.* };
                }
                cur = gop.value_ptr;
            } else if (bun.strings.eqlComptime(line, "end_of_record")) {
                cur = null;
            } else if (cur) |fc| {
                if (bun.strings.hasPrefixComptime(line, "DA:")) {
                    var parts = std.mem.splitScalar(u8, line[3..], ',');
                    const ln = std.fmt.parseInt(u32, parts.next() orelse continue, 10) catch continue;
                    const cnt = std.fmt.parseInt(u32, parts.next() orelse continue, 10) catch continue;
                    const gop = bun.handleOom(fc.da.getOrPut(arena, ln));
                    gop.value_ptr.* = if (gop.found_existing) gop.value_ptr.* +| cnt else cnt;
                } else if (bun.strings.hasPrefixComptime(line, "FNF:")) {
                    fc.fnf = @max(fc.fnf, std.fmt.parseInt(u32, line[4..], 10) catch 0);
                } else if (bun.strings.hasPrefixComptime(line, "FNH:")) {
                    fc.fnh = @max(fc.fnh, std.fmt.parseInt(u32, line[4..], 10) catch 0);
                }
            }
        }
    }

    if (by_file.count() == 0) return;

    // Stable output order.
    const Ctx = struct {
        keys: []const []const u8,
        pub fn lessThan(ctx: @This(), a: usize, b: usize) bool {
            return std.mem.lessThan(u8, ctx.keys[a], ctx.keys[b]);
        }
    };
    by_file.sort(Ctx{ .keys = by_file.keys() });

    if (opts.reporters.lcov) {
        var fs = bun.jsc.Node.fs.NodeFS{};
        _ = fs.mkdirRecursive(.{
            .path = .{ .encoded_slice = jsc.ZigString.Slice.fromUTF8NeverFree(opts.reports_directory) },
            .always_return_none = true,
        });
        var path_buf: bun.PathBuffer = undefined;
        const out_path = bun.path.joinAbsStringBufZ(bun.fs.FileSystem.instance.top_level_dir, &path_buf, &.{ opts.reports_directory, "lcov.info" }, .auto);
        switch (bun.sys.File.openat(.cwd(), out_path, bun.O.CREAT | bun.O.WRONLY | bun.O.TRUNC | bun.O.CLOEXEC, 0o644)) {
            .err => |e| Output.err(.lcovCoverageError, "Failed to write merged lcov.info\n{f}", .{e}),
            .result => |f| {
                defer f.close();
                const buf = bun.handleOom(arena.alloc(u8, 64 * 1024));
                var bw = f.writer().adaptToNewApi(buf);
                const w = &bw.new_interface;
                for (by_file.values()) |*fc| {
                    const sorted = bun.handleOom(arena.dupe(u32, fc.da.keys()));
                    std.sort.pdq(u32, sorted, {}, std.sort.asc(u32));
                    w.print("TN:\nSF:{s}\nFNF:{d}\nFNH:{d}\n", .{ fc.path, fc.fnf, fc.fnh }) catch {};
                    for (sorted) |ln| w.print("DA:{d},{d}\n", .{ ln, fc.da.get(ln).? }) catch {};
                    w.print("LF:{d}\nLH:{d}\nend_of_record\n", .{ fc.da.count(), fc.lh() }) catch {};
                }
                w.flush() catch {};
            },
        }
    }

    const base = opts.fractions;
    var failing = false;
    var avg = CoverageFraction{ .functions = 0, .lines = 0, .stmts = 0 };
    var avg_n: f64 = 0;
    const fracs = bun.handleOom(arena.alloc(CoverageFraction, by_file.count()));
    for (by_file.values(), fracs) |*fc, *frac| {
        const lf: f64 = @floatFromInt(fc.da.count());
        const lh_: f64 = @floatFromInt(fc.lh());
        const fnf: f64 = @floatFromInt(@max(fc.fnf, 1));
        frac.* = .{
            .functions = @as(f64, @floatFromInt(fc.fnh)) / fnf,
            .lines = if (lf > 0) lh_ / lf else 1.0,
            .stmts = if (lf > 0) lh_ / lf else 1.0,
        };
        frac.failing = frac.functions < base.functions or frac.lines < base.lines;
        if (frac.failing) failing = true;
        avg.functions += frac.functions;
        avg.lines += frac.lines;
        avg.stmts += frac.stmts;
        avg_n += 1;
    }
    opts.fractions.failing = failing;

    if (opts.reporters.text) {
        var max_len: usize = "All files".len;
        for (by_file.keys()) |k| max_len = @max(max_len, k.len);

        var console = Output.errorWriter();
        const sep = struct {
            fn write(c: anytype, n: usize, comptime colors: bool) void {
                c.writeAll(Output.prettyFmt("<r><d>", colors)) catch {};
                c.splatByteAll('-', n + 2) catch {};
                c.writeAll(Output.prettyFmt("|---------|---------|-------------------<r>\n", colors)) catch {};
            }
        }.write;
        sep(console, max_len, enable_colors);
        console.writeAll("File") catch {};
        console.splatByteAll(' ', max_len - "File".len + 1) catch {};
        console.writeAll(Output.prettyFmt(" <d>|<r> % Funcs <d>|<r> % Lines <d>|<r> Uncovered Line #s\n", enable_colors)) catch {};
        sep(console, max_len, enable_colors);

        var body = std.Io.Writer.Allocating.init(arena);
        for (by_file.values(), fracs) |*fc, frac| {
            CoverageReportText.writeFormatWithValues(fc.path, max_len, frac, base, frac.failing, &body.writer, true, enable_colors) catch {};
            body.writer.writeAll(Output.prettyFmt("<r><d> | <r>", enable_colors)) catch {};

            const sorted = bun.handleOom(arena.dupe(u32, fc.da.keys()));
            std.sort.pdq(u32, sorted, {}, std.sort.asc(u32));
            var first = true;
            var range_start: u32 = 0;
            var range_end: u32 = 0;
            for (sorted) |ln| {
                if (fc.da.get(ln).? != 0) continue;
                if (range_start == 0) {
                    range_start = ln;
                    range_end = ln;
                } else if (ln == range_end + 1) {
                    range_end = ln;
                } else {
                    writeRange(&body.writer, &first, range_start, range_end, enable_colors);
                    range_start = ln;
                    range_end = ln;
                }
            }
            if (range_start != 0) writeRange(&body.writer, &first, range_start, range_end, enable_colors);
            body.writer.writeAll("\n") catch {};
        }

        if (avg_n > 0) {
            avg.functions /= avg_n;
            avg.lines /= avg_n;
            avg.stmts /= avg_n;
        }
        CoverageReportText.writeFormatWithValues("All files", max_len, avg, base, failing, console, false, enable_colors) catch {};
        console.writeAll(Output.prettyFmt("<r><d> |<r>\n", enable_colors)) catch {};
        body.writer.flush() catch {};
        console.writeAll(body.written()) catch {};
        sep(console, max_len, enable_colors);

        Output.flush();
    }
}

fn writeRange(w: *std.Io.Writer, first: *bool, a: u32, b: u32, comptime colors: bool) void {
    if (first.*) first.* = false else w.writeAll(Output.prettyFmt("<r><d>,<r>", colors)) catch {};
    if (a == b) {
        w.print(Output.prettyFmt("<red>{d}", colors), .{a}) catch {};
    } else {
        w.print(Output.prettyFmt("<red>{d}-{d}", colors), .{ a, b }) catch {};
    }
}

/// Build the argv used for every worker (re)spawn. Forwards every `bun test`
/// flag that affects how tests *execute inside* a worker, plus `--dots` and
/// `--only-failures` since the worker formats result lines and the coordinator
/// prints them verbatim. Coordinator-only concerns — file discovery
/// (`--path-ignore-patterns`, `--changed`), `--reporter`/`--reporter-outfile`,
/// `--pass-with-no-tests`, `--parallel` itself — are intentionally not
/// forwarded.
fn buildWorkerArgv(arena: std.mem.Allocator, ctx: Command.Context) ![:null]?[*:0]const u8 {
    var argv: std.ArrayListUnmanaged(?[*:0]const u8) = .empty;
    const opts = &ctx.test_options;

    const printZ = struct {
        fn f(a: std.mem.Allocator, comptime fmt: []const u8, args: anytype) ![*:0]const u8 {
            return (try std.fmt.allocPrintSentinel(a, fmt, args, 0)).ptr;
        }
    }.f;

    try argv.append(arena, (bun.selfExePath() catch return error.SelfExePathFailed).ptr);
    try argv.append(arena, "test");
    try argv.append(arena, "--test-worker");
    try argv.append(arena, "--isolate");

    try argv.append(arena, try printZ(arena, "--timeout={d}", .{opts.default_timeout_ms}));
    if (opts.run_todo) try argv.append(arena, "--todo");
    if (opts.only) try argv.append(arena, "--only");
    if (opts.reporters.dots) try argv.append(arena, "--dots");
    if (opts.reporters.only_failures) try argv.append(arena, "--only-failures");
    if (opts.update_snapshots) try argv.append(arena, "--update-snapshots");
    if (opts.concurrent) try argv.append(arena, "--concurrent");
    if (opts.randomize) try argv.append(arena, "--randomize");
    if (opts.seed) |seed|
        try argv.append(arena, try printZ(arena, "--seed={d}", .{seed}));
    // --bail is intentionally NOT forwarded: workers Global.exit(1) on bail
    // (test_command.zig handleTestCompleted), which the coordinator would
    // misread as a crash. Cross-worker bail is handled at file granularity by
    // the coordinator instead.
    if (opts.repeat_count > 0)
        try argv.append(arena, try printZ(arena, "--rerun-each={d}", .{opts.repeat_count}));
    if (opts.retry > 0)
        try argv.append(arena, try printZ(arena, "--retry={d}", .{opts.retry}));
    try argv.append(arena, try printZ(arena, "--max-concurrency={d}", .{opts.max_concurrency}));
    if (opts.test_filter_pattern) |pattern| {
        try argv.append(arena, "-t");
        try argv.append(arena, (try arena.dupeZ(u8, pattern)).ptr);
    }
    for (ctx.preloads) |preload| {
        try argv.append(arena, "--preload");
        try argv.append(arena, (try arena.dupeZ(u8, preload)).ptr);
    }
    if (ctx.args.define) |define| {
        for (define.keys, define.values) |key, value| {
            try argv.append(arena, "--define");
            try argv.append(arena, try printZ(arena, "{s}={s}", .{ key, value }));
        }
    }
    if (ctx.args.loaders) |loaders| {
        for (loaders.extensions, loaders.loaders) |ext, loader| {
            try argv.append(arena, "--loader");
            try argv.append(arena, try printZ(arena, "{s}:{s}", .{ ext, @tagName(loader) }));
        }
    }
    if (ctx.args.tsconfig_override) |tsconfig| {
        try argv.append(arena, "--tsconfig-override");
        try argv.append(arena, (try arena.dupeZ(u8, tsconfig)).ptr);
    }
    if (opts.coverage.enabled) {
        try argv.append(arena, "--coverage");
    }

    try argv.append(arena, null);
    return argv.items[0 .. argv.items.len - 1 :null];
}

/// Worker side: read framed commands from stdin, run each file with isolation,
/// stream per-test events to fd 3. Never returns.
pub fn runAsWorker(
    reporter: *CommandLineReporter,
    vm: *jsc.VirtualMachine,
    ctx: Command.Context,
) !noreturn {
    vm.test_isolation_enabled = true;
    vm.auto_killer.enabled = true;

    var arena = bun.MimallocArena.init();
    vm.eventLoop().ensureWaker();
    vm.arena = &arena;
    vm.allocator = arena.allocator();

    const worker_tmp = vm.transpiler.env.get("BUN_TEST_WORKER_TMP");
    if (vm.transpiler.env.get("BUN_TEST_WORKER_JUNIT") != null and reporter.reporters.junit == null) {
        reporter.reporters.junit = test_command.JunitReporter.init();
    }

    worker_frame.begin(.ready);
    worker_frame.send(ipcFd());

    const stdin = bun.FD.stdin();
    var stdin_buf: std.ArrayListUnmanaged(u8) = .empty;
    var path_buf: std.ArrayListUnmanaged(u8) = .empty;

    const Runner = struct {
        reporter: *CommandLineReporter,
        vm: *jsc.VirtualMachine,
        file: []const u8,
        pub fn begin(r: *@This()) void {
            // Workers always run with --isolate; every file is its own complete
            // run from the preload's perspective.
            TestCommand.run(r.reporter, r.vm, r.file, .{ .first = true, .last = true }) catch |err| test_command.handleTopLevelTestErrorBeforeJavaScriptStart(err);
            r.vm.swapGlobalForTestIsolation();
            r.reporter.jest.bun_test_root.resetHookScopeForTestIsolation();
        }
    };

    while (readFrame(stdin, &stdin_buf)) |hd| {
        var rd = Frame.Reader{ .p = stdin_buf.items[5 .. 5 + hd.len] };
        const consumed: usize = 5 + hd.len;
        switch (hd.kind) {
            .shutdown => break,
            .run => {
                const idx = rd.u32_();
                // Copy out before consuming; rd points into stdin_buf.
                path_buf.clearRetainingCapacity();
                bun.handleOom(path_buf.appendSlice(bun.default_allocator, rd.str()));
                std.mem.copyForwards(u8, stdin_buf.items, stdin_buf.items[consumed..]);
                stdin_buf.items.len -= consumed;

                reporter.worker_ipc_file_idx = idx;
                worker_frame.begin(.file_start);
                worker_frame.u32_(idx);
                worker_frame.send(ipcFd());

                const before = reporter.summary().*;
                const before_unhandled = reporter.jest.unhandled_errors_between_tests;

                var runner = Runner{ .reporter = reporter, .vm = vm, .file = path_buf.items };
                vm.runWithAPILock(Runner, &runner, Runner.begin);

                const after = reporter.summary().*;
                worker_frame.begin(.file_done);
                inline for (.{
                    idx,
                    after.pass - before.pass,
                    after.fail - before.fail,
                    after.skip - before.skip,
                    after.todo - before.todo,
                    after.expectations - before.expectations,
                    after.skipped_because_label - before.skipped_because_label,
                    after.files - before.files,
                    reporter.jest.unhandled_errors_between_tests - before_unhandled,
                }) |v| worker_frame.u32_(v);
                worker_frame.send(ipcFd());
            },
            else => {
                std.mem.copyForwards(u8, stdin_buf.items, stdin_buf.items[consumed..]);
                stdin_buf.items.len -= consumed;
            },
        }
    }
    workerFlushAggregates(reporter, vm, ctx, worker_tmp);
    bun.Global.exit(0);
}

fn workerFlushAggregates(reporter: *CommandLineReporter, vm: *jsc.VirtualMachine, ctx: Command.Context, worker_tmp: ?[]const u8) void {
    // Snapshots flush lazily when the next file opens its snapshot file; the
    // last file each worker ran has no successor to trigger that.
    if (jsc.Jest.Jest.runner) |runner| {
        _ = runner.snapshots.writeInlineSnapshots() catch false;
        runner.snapshots.writeSnapshotFile() catch {};
    }

    worker_frame.begin(.repeat_bufs);
    worker_frame.str(reporter.failures_to_repeat_buf.items);
    worker_frame.str(reporter.skips_to_repeat_buf.items);
    worker_frame.str(reporter.todos_to_repeat_buf.items);
    worker_frame.send(ipcFd());

    if (worker_tmp) |dir| {
        const id: i64 = if (Environment.isWindows)
            @intCast(std.os.windows.GetCurrentProcessId())
        else
            @intCast(std.c.getpid());
        if (reporter.reporters.junit) |junit| {
            const path = bun.handleOom(std.fmt.allocPrintSentinel(bun.default_allocator, "{s}/w{d}.xml", .{ dir, id }, 0));
            if (junit.current_file.len > 0) junit.endTestSuite() catch {};
            if (junit.writeToFile(path)) |_| {
                worker_frame.begin(.junit_file);
                worker_frame.str(path);
                worker_frame.send(ipcFd());
            } else |e| {
                Output.err(e, "failed to write JUnit fragment to {s}", .{path});
            }
        }
        if (ctx.test_options.coverage.enabled) {
            const path = bun.handleOom(std.fmt.allocPrintSentinel(bun.default_allocator, "{s}/cov{d}.lcov", .{ dir, id }, 0));
            if (reporter.writeLcovOnly(vm, &ctx.test_options.coverage, path)) |_| {
                worker_frame.begin(.coverage_file);
                worker_frame.str(path);
                worker_frame.send(ipcFd());
            } else |e| {
                Output.err(e, "failed to write coverage fragment to {s}", .{path});
            }
        }
    }
}

/// Reused across all worker → coordinator emits.
var worker_frame: Frame = .{};

/// Called from `CommandLineReporter.handleTestCompleted` in the worker with the
/// fully-formatted status line (✓/✗ + scopes + name + duration, including ANSI
/// codes). The coordinator prints these bytes verbatim so output matches serial.
pub fn workerEmitTestDone(file_idx: u32, formatted_line: []const u8) void {
    worker_frame.begin(.test_done);
    worker_frame.u32_(file_idx);
    worker_frame.str(formatted_line);
    worker_frame.send(ipcFd());
}

fn writeAll(fd: bun.FD, bytes: []const u8) void {
    var remaining = bytes;
    while (remaining.len > 0) {
        switch (bun.sys.write(fd, remaining)) {
            .result => |n| remaining = remaining[n..],
            .err => |e| switch (e.getErrno()) {
                .INTR => continue,
                else => return,
            },
        }
    }
}

/// Blocking read until one complete frame header sits at buf[0..]. Returns
/// {kind, len}; payload is buf.items[5 .. 5+len]. Caller consumes before the
/// next call.
fn readFrame(fd: bun.FD, buf: *std.ArrayListUnmanaged(u8)) ?struct { kind: Kind, len: u32 } {
    while (true) {
        if (buf.items.len >= 5) {
            const len = std.mem.readInt(u32, buf.items[0..4], .little);
            if (len > max_frame_payload) return null;
            if (buf.items.len >= @as(usize, 5) + len) {
                const kind = std.meta.intToEnum(Kind, buf.items[4]) catch return null;
                return .{ .kind = kind, .len = len };
            }
        }
        var chunk: [4096]u8 = undefined;
        switch (bun.sys.read(fd, &chunk)) {
            .result => |n| {
                if (n == 0) return null;
                bun.handleOom(buf.appendSlice(bun.default_allocator, chunk[0..n]));
            },
            .err => |e| switch (e.getErrno()) {
                .INTR => continue,
                else => return null,
            },
        }
    }
}

const std = @import("std");
const Command = @import("../../cli.zig").Command;

const test_command = @import("../test_command.zig");
const CommandLineReporter = test_command.CommandLineReporter;
const TestCommand = test_command.TestCommand;

const bun = @import("bun");
const Environment = bun.Environment;
const Output = bun.Output;
const PathString = bun.PathString;
const jsc = bun.jsc;
const CoverageFraction = bun.SourceMap.coverage.Fraction;
const TestRunner = jsc.Jest.TestRunner;
const CoverageReportText = bun.SourceMap.coverage.Report.Text;
