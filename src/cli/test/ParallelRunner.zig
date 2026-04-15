//! `bun test --parallel`: process-pool coordinator and worker.
//!
//! Coordinator spawns N `bun test --test-worker --isolate` processes, hands
//! out one file at a time over stdin, and reads per-test events back over fd
//! 3. Per-test status lines are streamed to the coordinator the moment a test
//! finishes; stderr (errors, console.log) streams per-line. On a TTY the
//! coordinator draws a live one-line-per-worker status block at the bottom;
//! result lines scroll above it. Workers run each file in a fresh GlobalObject
//! and exit after `--isolate-recycle-after` files; the coordinator respawns
//! them transparently.

/// fd 3 in the worker. On Windows this must be a libuv (CRT) fd so
/// `uv_get_osfhandle(3)` resolves to the inherited handle; can't be a
/// file-scope const because `FD.fromUV` rejects >2 at comptime.
fn ipcFd() bun.FD {
    return .fromUV(3);
}

/// Wire protocol (newline-delimited, space-separated):
///   coordinator -> worker (stdin):
///     run <idx> <file...>\n
///     shutdown\n
///   worker -> coordinator (fd 3):
///     ready\n
///     recycle\n
///     file_start <idx>\n
///     test_start <idx> <hex_name>\n
///     test_done <idx> <hex_status_line>\n
///     file_done <idx> <pass> <fail> <skip> <todo> <expectations> <skipped_label> <files> <unhandled>\n
///     repeat_bufs <fail_hex> <skip_hex> <todo_hex>\n  (sent once before recycle/shutdown)
///     junit_file <path...>\n                          (sent once before recycle/shutdown)
///     coverage_file <path...>\n                       (sent once before recycle/shutdown)
const Kind = enum {
    ready,
    file_start,
    test_start,
    test_done,
    file_done,
    repeat_bufs,
    junit_file,
    coverage_file,
    recycle,
    run,
    shutdown,
};

/// Live one-line-per-worker status block drawn at the bottom of a TTY.
/// Result lines and worker stderr print above it: clear → write → redraw.
const LiveStatus = struct {
    enabled: bool,
    rows: []Row,
    lines_drawn: u32 = 0,
    last_draw_ns: i128 = 0,

    const Row = struct {
        file: []const u8 = "",
        test_name: []const u8 = "",
        started_ns: i128 = 0,
    };

    fn init(allocator: std.mem.Allocator, n: u32) LiveStatus {
        const enabled = Output.stderr_descriptor_type == .terminal and Output.enable_ansi_colors_stderr;
        const rows = allocator.alloc(Row, n) catch bun.outOfMemory();
        @memset(rows, .{});
        return .{ .enabled = enabled, .rows = rows };
    }

    fn setFile(self: *LiveStatus, w: u32, file: []const u8) void {
        const r = &self.rows[w];
        bun.default_allocator.free(r.file);
        bun.default_allocator.free(r.test_name);
        r.* = .{
            .file = bun.default_allocator.dupe(u8, file) catch bun.outOfMemory(),
            .started_ns = std.time.nanoTimestamp(),
        };
    }
    fn setTest(self: *LiveStatus, w: u32, name: []const u8) void {
        const r = &self.rows[w];
        bun.default_allocator.free(r.test_name);
        r.test_name = bun.default_allocator.dupe(u8, name) catch bun.outOfMemory();
        r.started_ns = std.time.nanoTimestamp();
    }
    fn setIdle(self: *LiveStatus, w: u32) void {
        const r = &self.rows[w];
        bun.default_allocator.free(r.file);
        bun.default_allocator.free(r.test_name);
        r.* = .{};
    }

    fn clear(self: *LiveStatus) void {
        if (!self.enabled or self.lines_drawn == 0) return;
        const w = Output.errorWriter();
        w.print("\x1b[{d}A\x1b[J", .{self.lines_drawn}) catch {};
        self.lines_drawn = 0;
    }

    fn draw(self: *LiveStatus) void {
        if (!self.enabled) return;
        const now = std.time.nanoTimestamp();
        self.last_draw_ns = now;
        const w = Output.errorWriter();
        for (self.rows, 0..) |row, i| {
            if (row.file.len == 0) {
                w.print(comptime Output.prettyFmt("<r><d>  worker {d} idle<r>\n", true), .{i}) catch {};
            } else {
                const elapsed_ms: u64 = @intCast(@max(0, @divTrunc(now - row.started_ns, std.time.ns_per_ms)));
                const name = if (row.test_name.len > 0) row.test_name else "(loading)";
                w.print(comptime Output.prettyFmt("<r><cyan>⏵<r> <d>{s} ›<r> {s} <d>[{d}ms]<r>\n", true), .{ row.file, name, elapsed_ms }) catch {};
            }
            self.lines_drawn += 1;
        }
        Output.flush();
    }

    fn maybeRefresh(self: *LiveStatus) void {
        if (!self.enabled) return;
        const now = std.time.nanoTimestamp();
        if (now - self.last_draw_ns < 80 * std.time.ns_per_ms) return;
        self.clear();
        self.draw();
    }

    /// Call before writing permanent output to stderr; pair with `draw()` after.
    fn open(self: *LiveStatus) void {
        self.clear();
    }
};

/// Reads worker output (IPC, stdout, or stderr) and routes it. One per pipe.
const WorkerPipe = struct {
    reader: bun.io.BufferedReader = bun.io.BufferedReader.init(WorkerPipe),
    worker: *Worker = undefined,
    role: enum { ipc, stdout, stderr },
    line_buf: std.ArrayListUnmanaged(u8) = .empty,

    pub fn onReadChunk(this: *WorkerPipe, chunk: []const u8, _: bun.io.ReadState) bool {
        bun.handleOom(this.line_buf.appendSlice(bun.default_allocator, chunk));
        while (std.mem.indexOfScalar(u8, this.line_buf.items, '\n')) |nl| {
            const line = this.line_buf.items[0..nl];
            this.worker.coord.onLine(this.worker, this.role, line);
            const remaining = this.line_buf.items[nl + 1 ..];
            std.mem.copyForwards(u8, this.line_buf.items[0..remaining.len], remaining);
            this.line_buf.items.len = remaining.len;
        }
        return true;
    }
    pub fn onReaderDone(this: *WorkerPipe) void {
        if (this.line_buf.items.len > 0) {
            this.worker.coord.onLine(this.worker, this.role, this.line_buf.items);
            this.line_buf.clearRetainingCapacity();
        }
    }
    pub fn onReaderError(_: *WorkerPipe, _: bun.sys.Error) void {}
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

    ipc: WorkerPipe = .{ .role = .ipc },
    out: WorkerPipe = .{ .role = .stdout },
    err: WorkerPipe = .{ .role = .stderr },

    /// Index into `Coordinator.files` currently running on this worker.
    inflight: ?u32 = null,
    /// Files completed by this worker process since (re)spawn. Mirrors the
    /// worker's own counter so the coordinator can predict a recycle exit and
    /// not dispatch into a dying worker.
    files_run: u32 = 0,
    alive: bool = false,
    extra_fd_stdio: [1]bun.spawn.SpawnOptions.Stdio = undefined,

    fn start(this: *Worker) !void {
        bun.assert(!this.alive);
        const coord = this.coord;

        this.ipc.worker = this;
        this.out.worker = this;
        this.err.worker = this;
        this.ipc.reader.setParent(&this.ipc);
        this.out.reader.setParent(&this.out);
        this.err.reader.setParent(&this.err);

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
            this.process = spawned.toProcess(coord.vm.eventLoop(), false);
            this.stdin_fd = spawned.stdin;
            if (spawned.stdout) |fd| try this.out.reader.start(fd, true).unwrap();
            if (spawned.stderr) |fd| try this.err.reader.start(fd, true).unwrap();
            if (spawned.extra_pipes.items.len > 0) {
                try this.ipc.reader.start(spawned.extra_pipes.items[0], true).unwrap();
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

            const stdin_pair = try bun.sys.pipe().unwrap();
            errdefer {
                stdin_pair[0].close();
                stdin_pair[1].close();
            }
            const ipc_pair = try bun.sys.pipe().unwrap();
            errdefer {
                ipc_pair[0].close();
                ipc_pair[1].close();
            }

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
            ipc_pair[1].close();
            this.stdin_fd = stdin_pair[1];

            try this.ipc.reader.start(ipc_pair[0], true).unwrap();
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
            .err => |e| if (!process.hasExited()) process.onExit(.{ .err = e }, &std.mem.zeroes(bun.spawn.Rusage)),
        }
    }

    pub fn onProcessExit(this: *Worker, _: *bun.spawn.Process, status: bun.spawn.Status, _: *const bun.spawn.Rusage) void {
        this.alive = false;
        this.coord.live_workers -= 1;
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

    fn send(this: *Worker, json: []const u8) void {
        const fd = this.stdin_fd orelse return;
        var remaining = json;
        while (remaining.len > 0) {
            switch (bun.sys.write(fd, remaining)) {
                .result => |wrote| remaining = remaining[wrote..],
                .err => |e| switch (e.getErrno()) {
                    .AGAIN, .INTR => continue,
                    else => return,
                },
            }
        }
        _ = bun.sys.write(fd, "\n");
    }

    fn dispatch(this: *Worker, file_idx: u32, file: []const u8) void {
        this.inflight = file_idx;
        var buf: [4096]u8 = undefined;
        const line = std.fmt.bufPrint(&buf, "run {d} {s}", .{ file_idx, file }) catch return;
        this.send(line);
    }

    fn shutdown(this: *Worker) void {
        this.send("shutdown");
        if (this.stdin_fd) |fd| {
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
    live: LiveStatus,
    scratch: std.ArrayListUnmanaged(u8) = .empty,
    recycle_after: u32,
    bail: u32,
    next_file: u32 = 0,
    files_done: u32 = 0,
    live_workers: u32 = 0,
    crashed_files: u32 = 0,
    bailed: bool = false,

    fn isDone(this: *const Coordinator) bool {
        return (this.files_done >= this.files.len or this.bailed) and this.live_workers == 0;
    }

    pub fn drive(this: *Coordinator) void {
        for (this.workers) |*w| {
            w.start() catch |e| {
                Output.err(e, "failed to spawn test worker {d}", .{w.idx});
                bun.Global.exit(1);
            };
        }
        this.live.draw();
        while (!this.isDone()) {
            this.vm.eventLoop().tick();
            this.live.maybeRefresh();
            if (this.isDone()) break;
            this.vm.eventLoop().autoTick();
        }
        this.live.clear();
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
        this.live.open();
        Output.prettyError("\nBailed out after {d} failure{s}<r>\n", .{ this.bail, if (this.bail == 1) "" else "s" });
        Output.flush();
        for (this.workers) |*other| {
            if (other.alive and other.inflight == null) other.shutdown();
        }
    }

    fn relPath(this: *Coordinator, file_idx: u32) []const u8 {
        return bun.path.relative(bun.fs.FileSystem.instance.top_level_dir, this.files[file_idx].slice());
    }

    fn ensureHeader(this: *Coordinator, file_idx: u32) void {
        if (this.last_header_idx == file_idx) return;
        this.last_header_idx = file_idx;
        const w = Output.errorWriter();
        w.print("\n{s}:\n", .{this.relPath(file_idx)}) catch {};
    }

    fn onLine(this: *Coordinator, w: *Worker, role: @FieldType(WorkerPipe, "role"), line: []const u8) void {
        switch (role) {
            .stdout, .stderr => {
                this.live.open();
                if (w.inflight) |idx| this.ensureHeader(idx);
                Output.errorWriter().writeAll(line) catch {};
                Output.errorWriter().writeByte('\n') catch {};
                Output.flush();
                this.live.draw();
            },
            .ipc => this.onIpc(w, line),
        }
    }

    fn onIpc(this: *Coordinator, w: *Worker, line: []const u8) void {
        var it = std.mem.tokenizeScalar(u8, line, ' ');
        const kind = std.meta.stringToEnum(Kind, it.next() orelse return) orelse return;
        switch (kind) {
            .ready => this.assignWorkOrRetry(w),
            .recycle => {}, // exit handler will respawn
            .file_start => {
                const idx = std.fmt.parseInt(u32, it.next() orelse return, 10) catch return;
                this.live.setFile(w.idx, this.relPath(idx));
                this.live.open();
                this.live.draw();
            },
            .test_start => {
                _ = it.next(); // file idx
                const name = decodeHex(&this.scratch, it.next() orelse return) orelse return;
                this.live.setTest(w.idx, name);
                this.live.open();
                this.live.draw();
            },
            .test_done => {
                const idx = std.fmt.parseInt(u32, it.next() orelse return, 10) catch return;
                const formatted = decodeHex(&this.scratch, it.next() orelse "") orelse return;
                if (formatted.len == 0) return; // e.g. pass under isAIAgent() — silenced by design
                this.live.open();
                this.ensureHeader(idx);
                Output.errorWriter().writeAll(formatted) catch {};
                Output.flush();
                this.live.draw();
            },
            .file_done => {
                var nums: [9]u32 = undefined;
                for (&nums) |*n| n.* = std.fmt.parseInt(u32, it.next() orelse return, 10) catch return;
                const idx, const pass, const fail, const skip, const todo, const expectations, const skipped_label, const files, const unhandled = nums;

                const summary = this.reporter.summary();
                summary.pass += pass;
                summary.fail += fail;
                summary.skip += skip;
                summary.todo += todo;
                summary.expectations += expectations;
                summary.skipped_because_label += skipped_label;
                summary.files += files;
                this.reporter.jest.unhandled_errors_between_tests += unhandled;
                _ = idx;

                this.live.setIdle(w.idx);
                w.inflight = null;
                w.files_run += 1;
                this.files_done += 1;
                if (this.bail > 0 and summary.fail >= this.bail) {
                    this.bailOut();
                }
                if (this.recycle_after == 0 or w.files_run < this.recycle_after) {
                    this.assignWork(w);
                }
                // else: worker is about to send `recycle` and exit; let
                // onWorkerExit respawn and the new worker's `ready` will pull.
            },
            .repeat_bufs => {
                inline for (.{
                    &this.reporter.failures_to_repeat_buf,
                    &this.reporter.skips_to_repeat_buf,
                    &this.reporter.todos_to_repeat_buf,
                }) |dest| {
                    if (it.next()) |hex| {
                        if (!(hex.len == 1 and hex[0] == '-')) {
                            const decoded_len = hex.len / 2;
                            bun.handleOom(dest.ensureUnusedCapacity(bun.default_allocator, decoded_len));
                            const slice = dest.unusedCapacitySlice()[0..decoded_len];
                            if (std.fmt.hexToBytes(slice, hex)) |_| {
                                dest.items.len += decoded_len;
                            } else |_| {}
                        }
                    }
                }
            },
            .junit_file => {
                const path = std.mem.trim(u8, it.rest(), " ");
                if (path.len > 0) {
                    bun.handleOom(this.junit_fragments.append(bun.default_allocator, bun.default_allocator.dupe(u8, path) catch bun.outOfMemory()));
                }
            },
            .coverage_file => {
                const path = std.mem.trim(u8, it.rest(), " ");
                if (path.len > 0) {
                    bun.handleOom(this.coverage_fragments.append(bun.default_allocator, bun.default_allocator.dupe(u8, path) catch bun.outOfMemory()));
                }
            },
            .run, .shutdown => {},
        }
    }

    fn onWorkerExit(this: *Coordinator, w: *Worker, status: bun.spawn.Status) void {
        this.live.setIdle(w.idx);
        this.live.open();
        defer this.live.draw();
        var retry_idx: ?u32 = null;
        if (w.inflight) |idx| {
            const file = this.files[idx].slice();
            const rel = bun.path.relative(bun.fs.FileSystem.instance.top_level_dir, file);
            if (this.retries[idx] < 1) {
                this.retries[idx] += 1;
                retry_idx = idx;
                Output.prettyError("<r><yellow>⟳<r> worker {d} crashed running <b>{s}<r>, retrying\n", .{ w.idx, rel });
            } else {
                Output.prettyError("<r><red>✗<r> <b>{s}<r> <d>(worker crashed: {s})<r>\n", .{ rel, @tagName(status) });
                this.reporter.summary().fail += 1;
                this.reporter.summary().files += 1;
                this.crashed_files += 1;
                this.files_done += 1;
                if (this.bail > 0 and this.reporter.summary().fail >= this.bail) this.bailOut();
            }
            Output.flush();
            w.inflight = null;
        }

        if (!this.bailed and (this.next_file < this.files.len or retry_idx != null)) {
            w.ipc = .{ .role = .ipc };
            w.out = .{ .role = .stdout };
            w.err = .{ .role = .stderr };
            w.process = null;
            w.files_run = 0;
            w.start() catch |e| {
                Output.err(e, "failed to respawn worker {d}", .{w.idx});
                if (retry_idx != null) {
                    this.reporter.summary().fail += 1;
                    this.reporter.summary().files += 1;
                    this.files_done += 1;
                }
                return;
            };
            if (retry_idx) |idx| this.pending_retry[w.idx] = idx;
        }
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

pub fn runAsCoordinator(
    reporter: *CommandLineReporter,
    vm: *jsc.VirtualMachine,
    files: []const PathString,
    ctx: Command.Context,
    coverage_opts: *TestCommand.CodeCoverageOptions,
) !void {
    const allocator = ctx.allocator;
    const n: u32 = @min(ctx.test_options.parallel, @as(u32, @intCast(files.len)));
    if (n <= 1) {
        // Nothing to parallelize; fall back to the sequential path.
        return TestCommand.runAllTests(reporter, vm, files, allocator);
    }

    Output.prettyError("<r><d>--parallel: {d} workers, {d} files<r>\n", .{ n, files.len });
    Output.flush();

    var arena = std.heap.ArenaAllocator.init(allocator);
    defer arena.deinit();

    var worker_tmpdir: ?[:0]const u8 = null;
    // Workers' stderr is a pipe; have them format with ANSI when we will be
    // rendering to a color terminal so streamed lines match serial output.
    if (Output.enable_ansi_colors_stderr) {
        vm.transpiler.env.map.put("FORCE_COLOR", "1") catch bun.outOfMemory();
    }
    if (ctx.test_options.reporters.junit or coverage_opts.enabled) {
        const dir = try std.fmt.allocPrintSentinel(arena.allocator(), "{s}/bun-test-worker-{d}", .{ bun.fs.FileSystem.RealFS.getDefaultTempDir(), std.crypto.random.int(u32) }, 0);
        if (std.fs.cwd().makePath(dir)) |_| {
            worker_tmpdir = dir;
            vm.transpiler.env.map.put("BUN_TEST_WORKER_TMP", dir) catch bun.outOfMemory();
        } else |e| {
            Output.err(e, "failed to create worker temp dir {s}", .{dir});
        }
        // Coordinator's own JunitReporter would otherwise produce an empty
        // document and overwrite the merged one in writeJUnitReportIfNeeded.
        if (reporter.reporters.junit) |jr| {
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
        .live = LiveStatus.init(allocator, n),
        .worker_tmpdir = worker_tmpdir,
        .recycle_after = ctx.test_options.isolate_recycle_after,
        .bail = ctx.test_options.bail,
    };

    for (workers, 0..) |*w, i| {
        w.* = .{ .coord = &coord, .idx = @intCast(i) };
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
    if (worker_tmpdir) |dir| std.fs.cwd().deleteTree(dir) catch {};
}

fn mergeJUnitFragments(paths: []const []const u8, outfile: []const u8, summary: *const TestRunner.Summary) void {
    var contents: std.ArrayListUnmanaged(u8) = .empty;
    defer contents.deinit(bun.default_allocator);

    const elapsed_time = @as(f64, @floatFromInt(std.time.nanoTimestamp() - bun.start_time)) / std.time.ns_per_s;
    contents.writer(bun.default_allocator).print(
        \\<?xml version="1.0" encoding="UTF-8"?>
        \\<testsuites name="bun test" tests="{d}" assertions="{d}" failures="{d}" skipped="{d}" time="{d}">
        \\
    , .{
        summary.pass + summary.fail + summary.skip + summary.todo,
        summary.expectations,
        summary.fail,
        summary.skip + summary.todo,
        elapsed_time,
    }) catch bun.outOfMemory();

    for (paths) |path| {
        const file = std.fs.cwd().readFileAlloc(bun.default_allocator, path, 64 * 1024 * 1024) catch continue;
        defer bun.default_allocator.free(file);
        // Each fragment is a full <testsuites> document; extract its body.
        const open_end = std.mem.indexOf(u8, file, "<testsuites") orelse continue;
        const body_start = (std.mem.indexOfScalarPos(u8, file, open_end, '>') orelse continue) + 1;
        const body_end = std.mem.lastIndexOf(u8, file, "</testsuites>") orelse continue;
        if (body_start >= body_end) continue;
        const body = std.mem.trim(u8, file[body_start..body_end], "\n");
        if (body.len == 0) continue;
        contents.appendSlice(bun.default_allocator, body) catch bun.outOfMemory();
        contents.append(bun.default_allocator, '\n') catch bun.outOfMemory();
    }

    contents.appendSlice(bun.default_allocator, "</testsuites>\n") catch bun.outOfMemory();

    var path_buf: bun.PathBuffer = undefined;
    @memcpy(path_buf[0..outfile.len], outfile);
    path_buf[outfile.len] = 0;
    switch (bun.sys.File.openat(.cwd(), path_buf[0..outfile.len :0], bun.O.WRONLY | bun.O.CREAT | bun.O.TRUNC, 0o664)) {
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

    var by_file: std.StringArrayHashMapUnmanaged(FileCoverage) = .empty;

    for (paths) |path| {
        const data = std.fs.cwd().readFileAlloc(arena, path, 64 * 1024 * 1024) catch continue;
        var cur: ?*FileCoverage = null;
        var lines = std.mem.splitScalar(u8, data, '\n');
        while (lines.next()) |raw| {
            const line = std.mem.trimEnd(u8, raw, "\r");
            if (std.mem.startsWith(u8, line, "SF:")) {
                const name = line[3..];
                const gop = by_file.getOrPut(arena, name) catch bun.outOfMemory();
                if (!gop.found_existing) {
                    gop.key_ptr.* = arena.dupe(u8, name) catch bun.outOfMemory();
                    gop.value_ptr.* = .{ .path = gop.key_ptr.* };
                }
                cur = gop.value_ptr;
            } else if (std.mem.eql(u8, line, "end_of_record")) {
                cur = null;
            } else if (cur) |fc| {
                if (std.mem.startsWith(u8, line, "DA:")) {
                    var parts = std.mem.splitScalar(u8, line[3..], ',');
                    const ln = std.fmt.parseInt(u32, parts.next() orelse continue, 10) catch continue;
                    const cnt = std.fmt.parseInt(u32, parts.next() orelse continue, 10) catch continue;
                    const gop = fc.da.getOrPut(arena, ln) catch bun.outOfMemory();
                    gop.value_ptr.* = if (gop.found_existing) gop.value_ptr.* +| cnt else cnt;
                } else if (std.mem.startsWith(u8, line, "FNF:")) {
                    fc.fnf = @max(fc.fnf, std.fmt.parseInt(u32, line[4..], 10) catch 0);
                } else if (std.mem.startsWith(u8, line, "FNH:")) {
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
                const buf = arena.alloc(u8, 64 * 1024) catch bun.outOfMemory();
                var bw = f.writer().adaptToNewApi(buf);
                const w = &bw.new_interface;
                for (by_file.values()) |*fc| {
                    const sorted = arena.dupe(u32, fc.da.keys()) catch bun.outOfMemory();
                    std.sort.pdq(u32, sorted, {}, std.sort.asc(u32));
                    w.print("TN:\nSF:{s}\nFNF:{d}\nFNH:{d}\n", .{ fc.path, fc.fnf, fc.fnh }) catch {};
                    for (sorted) |ln| w.print("DA:{d},{d}\n", .{ ln, fc.da.get(ln).? }) catch {};
                    w.print("LF:{d}\nLH:{d}\nend_of_record\n", .{ fc.da.count(), fc.lh() }) catch {};
                }
                w.flush() catch {};
            },
        }
    }

    if (opts.reporters.text) {
        const base = opts.fractions;
        var failing = false;
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
        var avg = CoverageFraction{ .functions = 0, .lines = 0, .stmts = 0 };
        var avg_n: f64 = 0;

        for (by_file.values()) |*fc| {
            const lf: f64 = @floatFromInt(fc.da.count());
            const lh_: f64 = @floatFromInt(fc.lh());
            const fnf: f64 = @floatFromInt(@max(fc.fnf, 1));
            var frac = CoverageFraction{
                .functions = @as(f64, @floatFromInt(fc.fnh)) / fnf,
                .lines = if (lf > 0) lh_ / lf else 1.0,
                .stmts = if (lf > 0) lh_ / lf else 1.0,
            };
            const failed = frac.functions < base.functions or frac.lines < base.lines;
            frac.failing = failed;
            if (failed) failing = true;
            avg.functions += frac.functions;
            avg.lines += frac.lines;
            avg.stmts += frac.stmts;
            avg_n += 1;

            CoverageReportText.writeFormatWithValues(fc.path, max_len, frac, base, failed, &body.writer, true, enable_colors) catch {};
            body.writer.writeAll(Output.prettyFmt("<r><d> | <r>", enable_colors)) catch {};

            // Uncovered line ranges (DA entries with count 0).
            const sorted = arena.dupe(u32, fc.da.keys()) catch bun.outOfMemory();
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

        opts.fractions.failing = failing;
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
/// flag that affects how tests *execute inside* a worker. Coordinator-only
/// concerns — file discovery (`--path-ignore-patterns`, `--changed`), output
/// format (`--reporter`, `--reporter-outfile`, `--dots`, `--only-failures`),
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

    try argv.append(arena, try printZ(arena, "--isolate-recycle-after={d}", .{opts.isolate_recycle_after}));
    if (opts.default_timeout_ms != 5 * std.time.ms_per_s)
        try argv.append(arena, try printZ(arena, "--timeout={d}", .{opts.default_timeout_ms}));
    if (opts.run_todo) try argv.append(arena, "--todo");
    if (opts.only) try argv.append(arena, "--only");
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
    if (opts.max_concurrency != 20)
        try argv.append(arena, try printZ(arena, "--max-concurrency={d}", .{opts.max_concurrency}));
    if (opts.test_filter_pattern) |pattern| {
        try argv.append(arena, "-t");
        try argv.append(arena, (try arena.dupeZ(u8, pattern)).ptr);
    }
    for (ctx.preloads) |preload| {
        try argv.append(arena, "--preload");
        try argv.append(arena, (try arena.dupeZ(u8, preload)).ptr);
    }
    if (opts.coverage.enabled) {
        try argv.append(arena, "--coverage");
    }

    try argv.append(arena, null);
    return argv.items[0 .. argv.items.len - 1 :null];
}

/// Worker side: read NDJSON commands from stdin, run each file with isolation,
/// write per-file summaries to fd 3. Never returns.
pub fn runAsWorker(
    reporter: *CommandLineReporter,
    vm: *jsc.VirtualMachine,
    ctx: Command.Context,
) !noreturn {
    vm.test_isolation_enabled = true;
    vm.auto_killer.enabled = true;

    const recycle_after = ctx.test_options.isolate_recycle_after;
    var files_run: u32 = 0;

    var arena = bun.MimallocArena.init();
    vm.eventLoop().ensureWaker();
    vm.arena = &arena;
    vm.allocator = arena.allocator();

    const worker_tmp = vm.transpiler.env.get("BUN_TEST_WORKER_TMP");
    if (worker_tmp != null and reporter.reporters.junit == null) {
        // Coordinator decides which fragments to consume, so we always
        // populate the JUnit reporter when a tmp dir is provided.
        reporter.reporters.junit = test_command.JunitReporter.init();
    }

    writeIpcLine("ready");

    var stdin_buf: std.ArrayListUnmanaged(u8) = .empty;
    defer stdin_buf.deinit(bun.default_allocator);
    const stdin = bun.FD.stdin();

    const Runner = struct {
        reporter: *CommandLineReporter,
        vm: *jsc.VirtualMachine,
        file: []const u8,
        swap_after: bool,
        pub fn begin(r: *@This()) void {
            // Workers always run with --isolate; every file is its own complete
            // run from the preload's perspective.
            TestCommand.run(r.reporter, r.vm, r.file, .{ .first = true, .last = true }) catch |err| test_command.handleTopLevelTestErrorBeforeJavaScriptStart(err);
            if (r.swap_after) {
                r.vm.swapGlobalForTestIsolation();
                r.reporter.jest.bun_test_root.resetHookScopeForTestIsolation();
            }
        }
    };

    var fmt_buf: [256]u8 = undefined;
    while (true) {
        const line = readLine(stdin, &stdin_buf) orelse break;
        var rest = line;
        const kind_str = takeWord(&rest) orelse continue;
        const kind = std.meta.stringToEnum(Kind, kind_str) orelse continue;
        switch (kind) {
            .shutdown => {
                workerFlushAggregates(reporter, vm, ctx, worker_tmp);
                bun.Global.exit(0);
            },
            .run => {
                const idx_str = takeWord(&rest) orelse continue;
                const idx = std.fmt.parseInt(u32, idx_str, 10) catch continue;
                const file = rest;

                reporter.worker_ipc_file_idx = idx;
                {
                    var buf: [64]u8 = undefined;
                    writeIpcLine(std.fmt.bufPrint(&buf, "file_start {d}", .{idx}) catch unreachable);
                }

                const before = reporter.summary().*;
                const before_unhandled = reporter.jest.unhandled_errors_between_tests;

                files_run += 1;
                const will_recycle = recycle_after > 0 and files_run >= recycle_after;
                var runner = Runner{
                    .reporter = reporter,
                    .vm = vm,
                    .file = file,
                    .swap_after = !will_recycle,
                };
                vm.runWithAPILock(Runner, &runner, Runner.begin);

                const after = reporter.summary().*;
                const msg = std.fmt.bufPrint(&fmt_buf, "file_done {d} {d} {d} {d} {d} {d} {d} {d} {d}", .{
                    idx,
                    after.pass - before.pass,
                    after.fail - before.fail,
                    after.skip - before.skip,
                    after.todo - before.todo,
                    after.expectations - before.expectations,
                    after.skipped_because_label - before.skipped_because_label,
                    after.files - before.files,
                    reporter.jest.unhandled_errors_between_tests - before_unhandled,
                }) catch unreachable;
                writeIpcLine(msg);

                if (will_recycle) {
                    workerFlushAggregates(reporter, vm, ctx, worker_tmp);
                    writeIpcLine("recycle");
                    bun.Global.exit(0);
                }
            },
            .ready, .file_start, .test_start, .test_done, .file_done, .repeat_bufs, .junit_file, .coverage_file, .recycle => {},
        }
    }
    workerFlushAggregates(reporter, vm, ctx, worker_tmp);
    bun.Global.exit(0);
}

fn workerFlushAggregates(reporter: *CommandLineReporter, vm: *jsc.VirtualMachine, ctx: Command.Context, worker_tmp: ?[]const u8) void {
    var line: std.ArrayListUnmanaged(u8) = .empty;
    defer line.deinit(bun.default_allocator);
    line.appendSlice(bun.default_allocator, "repeat_bufs") catch bun.outOfMemory();
    inline for (.{
        reporter.failures_to_repeat_buf.items,
        reporter.skips_to_repeat_buf.items,
        reporter.todos_to_repeat_buf.items,
    }) |buf| {
        line.append(bun.default_allocator, ' ') catch bun.outOfMemory();
        if (buf.len == 0) {
            line.append(bun.default_allocator, '-') catch bun.outOfMemory();
        } else {
            const hex_chars = "0123456789abcdef";
            line.ensureUnusedCapacity(bun.default_allocator, buf.len * 2) catch bun.outOfMemory();
            for (buf) |b| {
                line.appendAssumeCapacity(hex_chars[b >> 4]);
                line.appendAssumeCapacity(hex_chars[b & 0xf]);
            }
        }
    }
    writeIpcLine(line.items);

    if (worker_tmp) |dir| {
        const id = std.crypto.random.int(u32);
        if (reporter.reporters.junit) |junit| {
            const path = std.fmt.allocPrintSentinel(bun.default_allocator, "{s}/w{d}.xml", .{ dir, id }, 0) catch bun.outOfMemory();
            if (junit.current_file.len > 0) junit.endTestSuite() catch {};
            junit.writeToFile(path) catch {};
            line.clearRetainingCapacity();
            line.writer(bun.default_allocator).print("junit_file {s}", .{path}) catch bun.outOfMemory();
            writeIpcLine(line.items);
        }
        if (ctx.test_options.coverage.enabled) {
            const path = std.fmt.allocPrintSentinel(bun.default_allocator, "{s}/cov{d}.lcov", .{ dir, id }, 0) catch bun.outOfMemory();
            reporter.writeLcovOnly(vm, &ctx.test_options.coverage, path) catch {};
            line.clearRetainingCapacity();
            line.writer(bun.default_allocator).print("coverage_file {s}", .{path}) catch bun.outOfMemory();
            writeIpcLine(line.items);
        }
    }
}

/// Called from `Execution.onSequenceStarted` in the worker. Tells the
/// coordinator which test is now running so the live TTY status block can
/// show it.
pub fn workerEmitTestStart(file_idx: u32, name: []const u8) void {
    var line: std.ArrayListUnmanaged(u8) = .empty;
    defer line.deinit(bun.default_allocator);
    line.writer(bun.default_allocator).print("test_start {d} ", .{file_idx}) catch bun.outOfMemory();
    appendHex(&line, name);
    writeIpcLine(line.items);
}

/// Called from `CommandLineReporter.handleTestCompleted` in the worker with the
/// fully-formatted status line (✓/✗ + scopes + name + duration, including ANSI
/// codes). The coordinator prints these bytes verbatim so output matches serial.
pub fn workerEmitTestDone(file_idx: u32, formatted_line: []const u8) void {
    var line: std.ArrayListUnmanaged(u8) = .empty;
    defer line.deinit(bun.default_allocator);
    line.writer(bun.default_allocator).print("test_done {d} ", .{file_idx}) catch bun.outOfMemory();
    appendHex(&line, formatted_line);
    writeIpcLine(line.items);
}

fn appendHex(dst: *std.ArrayListUnmanaged(u8), bytes: []const u8) void {
    if (bytes.len == 0) {
        dst.append(bun.default_allocator, '-') catch bun.outOfMemory();
        return;
    }
    const hex_chars = "0123456789abcdef";
    dst.ensureUnusedCapacity(bun.default_allocator, bytes.len * 2) catch bun.outOfMemory();
    for (bytes) |b| {
        dst.appendAssumeCapacity(hex_chars[b >> 4]);
        dst.appendAssumeCapacity(hex_chars[b & 0xf]);
    }
}

fn decodeHex(scratch: *std.ArrayListUnmanaged(u8), hex: []const u8) ?[]const u8 {
    if (hex.len == 1 and hex[0] == '-') return "";
    scratch.clearRetainingCapacity();
    scratch.ensureUnusedCapacity(bun.default_allocator, hex.len / 2) catch bun.outOfMemory();
    const out = scratch.unusedCapacitySlice()[0 .. hex.len / 2];
    _ = std.fmt.hexToBytes(out, hex) catch return null;
    scratch.items.len += out.len;
    return scratch.items;
}

fn takeWord(rest: *[]const u8) ?[]const u8 {
    var s = rest.*;
    while (s.len > 0 and s[0] == ' ') s = s[1..];
    if (s.len == 0) return null;
    const end = std.mem.indexOfScalar(u8, s, ' ') orelse s.len;
    const word = s[0..end];
    rest.* = if (end < s.len) s[end + 1 ..] else s[end..];
    return word;
}

fn writeIpcLine(line: []const u8) void {
    const fd = ipcFd();
    writeAll(fd, line);
    writeAll(fd, "\n");
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

fn readLine(fd: bun.FD, buf: *std.ArrayListUnmanaged(u8)) ?[]const u8 {
    while (true) {
        if (std.mem.indexOfScalar(u8, buf.items, '\n')) |nl| {
            const line = buf.items[0..nl];
            // Shift the consumed line out on the *next* call by leaving the
            // newline in place; simplest: copy out and trim now.
            const owned = bun.default_allocator.dupe(u8, line) catch bun.outOfMemory();
            const remaining = buf.items[nl + 1 ..];
            std.mem.copyForwards(u8, buf.items[0..remaining.len], remaining);
            buf.items.len = remaining.len;
            // The caller treats the slice as borrowed for the iteration; we
            // intentionally leak `owned` into the worker's lifetime — the
            // process exits when the loop ends.
            return owned;
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
const bun = @import("bun");
const Environment = bun.Environment;
const Output = bun.Output;
const PathString = bun.PathString;
const jsc = bun.jsc;

const Command = @import("../../cli.zig").Command;
const test_command = @import("../test_command.zig");
const TestCommand = test_command.TestCommand;
const CommandLineReporter = test_command.CommandLineReporter;
const TestRunner = jsc.Jest.TestRunner;
const CoverageFraction = bun.SourceMap.coverage.Fraction;
const CoverageReportText = bun.SourceMap.coverage.Report.Text;
