//! `bun test --parallel`: process-pool coordinator and worker.
//!
//! Coordinator spawns N `bun test --test-worker --isolate` processes, hands
//! out one file at a time over stdin (NDJSON), and reads per-file summaries
//! back over fd 3. Worker stdout/stderr are captured and printed with a
//! `[worker N]` prefix. Workers run each file in a fresh GlobalObject (Phase A
//! isolation) and exit after `--isolate-recycle-after` files so leaks stay
//! bounded; the coordinator respawns them transparently.

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
///     file_done <idx> <pass> <fail> <skip> <todo> <expectations> <skipped_label> <files> <unhandled>\n
const Kind = enum {
    ready,
    file_done,
    recycle,
    run,
    shutdown,
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
        while (!this.isDone()) {
            this.vm.eventLoop().tick();
            if (this.isDone()) break;
            this.vm.eventLoop().autoTick();
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
        Output.prettyError("\nBailed out after {d} failure{s}<r>\n", .{ this.bail, if (this.bail == 1) "" else "s" });
        Output.flush();
        for (this.workers) |*other| {
            if (other.alive and other.inflight == null) other.shutdown();
        }
    }

    fn onLine(this: *Coordinator, w: *Worker, role: @FieldType(WorkerPipe, "role"), line: []const u8) void {
        switch (role) {
            .stdout, .stderr => {
                const writer = if (role == .stderr) Output.errorWriter() else Output.writer();
                if (Output.enable_ansi_colors_stderr) {
                    writer.print(comptime Output.prettyFmt("<d>[worker {d}]<r> ", true), .{w.idx}) catch {};
                } else {
                    writer.print("[worker {d}] ", .{w.idx}) catch {};
                }
                writer.writeAll(line) catch {};
                writer.writeAll("\n") catch {};
                Output.flush();
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

                const file = this.files[idx].slice();
                const rel = bun.path.relative(bun.fs.FileSystem.instance.top_level_dir, file);
                if (fail > 0) {
                    Output.prettyError("<r><red>✗<r> <b>{s}<r> <d>({d} pass, {d} fail)<r>\n", .{ rel, pass, fail });
                } else {
                    Output.prettyError("<r><green>✓<r> {s} <d>({d} pass)<r>\n", .{ rel, pass });
                }
                Output.flush();

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
            .run, .shutdown => {},
        }
    }

    fn onWorkerExit(this: *Coordinator, w: *Worker, status: bun.spawn.Status) void {
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
        .recycle_after = ctx.test_options.isolate_recycle_after,
        .bail = ctx.test_options.bail,
    };

    for (workers, 0..) |*w, i| {
        w.* = .{ .coord = &coord, .idx = @intCast(i) };
    }

    vm.eventLoop().ensureWaker();
    vm.runWithAPILock(Coordinator, &coord, Coordinator.drive);
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
        if (opts.coverage.reporters.lcov) try argv.append(arena, "--coverage-reporter=lcov");
        if (opts.coverage.reporters.text) try argv.append(arena, "--coverage-reporter=text");
        if (!std.mem.eql(u8, opts.coverage.reports_directory, "coverage"))
            try argv.append(arena, try printZ(arena, "--coverage-dir={s}", .{opts.coverage.reports_directory}));
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
            .shutdown => bun.Global.exit(0),
            .run => {
                const idx_str = takeWord(&rest) orelse continue;
                const idx = std.fmt.parseInt(u32, idx_str, 10) catch continue;
                const file = rest;

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
                    writeIpcLine("recycle");
                    bun.Global.exit(0);
                }
            },
            .ready, .file_done, .recycle => {},
        }
    }
    bun.Global.exit(0);
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
