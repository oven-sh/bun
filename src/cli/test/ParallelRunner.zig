//! `bun test --parallel`: process-pool coordinator and worker.
//!
//! Coordinator spawns N `bun test --test-worker --isolate` processes, hands
//! out one file at a time over stdin (NDJSON), and reads per-file summaries
//! back over fd 3. Worker stdout/stderr are captured and printed with a
//! `[worker N]` prefix. Workers run each file in a fresh GlobalObject (Phase A
//! isolation) and exit after `--isolate-recycle-after` files so leaks stay
//! bounded; the coordinator respawns them transparently.

const ipc_fd: bun.FD = .fromNative(3);

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
        return this.worker.coord.vm.uwsLoop();
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
    alive: bool = false,
    extra_fd_stdio: [1]bun.spawn.SpawnOptions.Stdio = undefined,

    fn start(this: *Worker) !void {
        bun.assert(!this.alive);
        const coord = this.coord;

        var argv_buf: [16:null]?[*:0]const u8 = @splat(null);
        var n: usize = 0;
        argv_buf[n] = coord.self_exe.ptr;
        n += 1;
        argv_buf[n] = "test";
        n += 1;
        argv_buf[n] = "--test-worker";
        n += 1;
        argv_buf[n] = "--isolate";
        n += 1;
        for (coord.forwarded_args) |arg| {
            argv_buf[n] = arg;
            n += 1;
        }
        const argv = argv_buf[0..n :null];

        this.extra_fd_stdio = .{if (Environment.isPosix) .buffer else .{ .buffer = bun.new(bun.windows.libuv.Pipe, std.mem.zeroes(bun.windows.libuv.Pipe)) }};
        const options: bun.spawn.SpawnOptions = .{
            .stdin = if (Environment.isPosix) .buffer else .{ .buffer = bun.new(bun.windows.libuv.Pipe, std.mem.zeroes(bun.windows.libuv.Pipe)) },
            .stdout = if (Environment.isPosix) .buffer else .{ .buffer = bun.new(bun.windows.libuv.Pipe, std.mem.zeroes(bun.windows.libuv.Pipe)) },
            .stderr = if (Environment.isPosix) .buffer else .{ .buffer = bun.new(bun.windows.libuv.Pipe, std.mem.zeroes(bun.windows.libuv.Pipe)) },
            .extra_fds = &this.extra_fd_stdio,
            .cwd = coord.cwd,
            .windows = if (Environment.isWindows) .{ .loop = jsc.EventLoopHandle.init(coord.vm) },
            .stream = true,
        };

        var spawned = try (try bun.spawn.spawnProcess(&options, argv.ptr, coord.envp)).unwrap();
        var process = spawned.toProcess(coord.vm.eventLoop(), false);

        this.ipc.worker = this;
        this.out.worker = this;
        this.err.worker = this;
        this.ipc.reader.setParent(&this.ipc);
        this.out.reader.setParent(&this.out);
        this.err.reader.setParent(&this.err);

        if (Environment.isPosix) {
            this.stdin_fd = spawned.stdin;
            if (spawned.stdout) |fd| try this.out.reader.start(fd, true).unwrap();
            if (spawned.stderr) |fd| try this.err.reader.start(fd, true).unwrap();
            if (spawned.extra_pipes.items.len > 0) {
                try this.ipc.reader.start(spawned.extra_pipes.items[0], true).unwrap();
            }
        } else {
            // TODO(windows): wire up libuv pipes for IPC fd 3.
            this.stdin_fd = null;
        }

        this.process = process;
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
        return this.coord.vm.uwsLoop();
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
    self_exe: [:0]const u8,
    envp: [*:null]?[*:0]const u8,
    forwarded_args: []const [:0]const u8,

    workers: []Worker,
    /// retries[i] counts how many times files[i] has been re-queued after a
    /// worker crashed mid-run.
    retries: []u8,
    pending_retry: []?u32,
    next_file: u32 = 0,
    files_done: u32 = 0,
    live_workers: u32 = 0,
    crashed_files: u32 = 0,

    fn isDone(this: *const Coordinator) bool {
        return this.files_done >= this.files.len and this.live_workers == 0;
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
        if (this.next_file < this.files.len) {
            const idx = this.next_file;
            this.next_file += 1;
            w.dispatch(idx, this.files[idx].slice());
        } else {
            w.shutdown();
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
                this.files_done += 1;
                this.assignWork(w);
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
            }
            Output.flush();
            w.inflight = null;
        }

        if (this.next_file < this.files.len or retry_idx != null) {
            w.ipc = .{ .role = .ipc };
            w.out = .{ .role = .stdout };
            w.err = .{ .role = .stderr };
            w.process = null;
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

    const self_exe = bun.selfExePath() catch return error.SelfExePathFailed;

    // Forward flags that affect test execution inside the worker.
    var fwd: std.ArrayListUnmanaged([:0]const u8) = .empty;
    defer fwd.deinit(allocator);
    var timeout_buf: [32]u8 = undefined;
    if (ctx.test_options.default_timeout_ms != 5 * std.time.ms_per_s) {
        const s = try std.fmt.bufPrintZ(&timeout_buf, "--timeout={d}", .{ctx.test_options.default_timeout_ms});
        try fwd.append(allocator, try allocator.dupeZ(u8, s));
    }
    var recycle_buf: [48]u8 = undefined;
    {
        const s = try std.fmt.bufPrintZ(&recycle_buf, "--isolate-recycle-after={d}", .{ctx.test_options.isolate_recycle_after});
        try fwd.append(allocator, try allocator.dupeZ(u8, s));
    }
    if (ctx.test_options.run_todo) try fwd.append(allocator, "--todo");
    if (ctx.test_options.only) try fwd.append(allocator, "--only");
    if (ctx.test_options.update_snapshots) try fwd.append(allocator, "--update-snapshots");

    var arena = std.heap.ArenaAllocator.init(allocator);
    defer arena.deinit();
    const envp = try vm.transpiler.env.map.createNullDelimitedEnvMap(arena.allocator());

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
        .self_exe = self_exe,
        .envp = envp,
        .forwarded_args = fwd.items,
        .workers = workers,
        .retries = retries,
        .pending_retry = pending_retry,
    };

    for (workers, 0..) |*w, i| {
        w.* = .{ .coord = &coord, .idx = @intCast(i) };
    }

    vm.eventLoop().ensureWaker();
    vm.runWithAPILock(Coordinator, &coord, Coordinator.drive);
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
        first: bool,
        swap_after: bool,
        pub fn begin(r: *@This()) void {
            TestCommand.run(r.reporter, r.vm, r.file, .{ .first = r.first, .last = false }) catch |err| test_command.handleTopLevelTestErrorBeforeJavaScriptStart(err);
            if (r.swap_after) r.vm.swapGlobalForTestIsolation();
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
                    .first = files_run == 1,
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
    writeAll(ipc_fd, line);
    writeAll(ipc_fd, "\n");
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
