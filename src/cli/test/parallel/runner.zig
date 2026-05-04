//! Coordinator and worker entry points: `runAsCoordinator` (sets up the
//! `Coordinator`, sorts/partitions files, drives the loop, merges fragments)
//! and `runAsWorker` (the `--test-worker` side that reads framed commands
//! from stdin, runs each file under isolation, and streams results to fd 3).

/// All workers are busy for at least this long before another is spawned.
/// Overridable via BUN_TEST_PARALLEL_SCALE_MS for tests, where debug-build
/// module load alone can exceed the production 5ms threshold.
pub const default_scale_up_after_ms = 5;

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
    const N: u32 = @intCast(files.len);
    const K: u32 = @min(ctx.test_options.parallel, N);
    if (K <= 1) {
        // Jest sets JEST_WORKER_ID=1 even with --maxWorkers=1; match that so
        // tests can rely on the var whenever --parallel is passed.
        bun.handleOom(vm.transpiler.env.map.put("JEST_WORKER_ID", "1"));
        bun.handleOom(vm.transpiler.env.map.put("BUN_TEST_WORKER_ID", "1"));
        TestCommand.runAllTests(reporter, vm, files, allocator);
        return false;
    }

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
        const dir = try std.fmt.allocPrintSentinel(arena.allocator(), "{s}/bun-test-worker-{d}", .{
            bun.fs.FileSystem.RealFS.getDefaultTempDir(),
            if (bun.Environment.isWindows) std.os.windows.GetCurrentProcessId() else std.c.getpid(),
        }, 0);
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
    // Each worker gets a unique JEST_WORKER_ID / BUN_TEST_WORKER_ID (1-indexed,
    // matching Jest) so tests can pick distinct ports/databases. Serialize the
    // env map once per worker after .put() — appending after the fact would
    // create duplicate entries when the parent already has the variable set,
    // and POSIX getenv() returns the first match.
    const envps = try arena.allocator().alloc([:null]?[*:0]const u8, K);
    for (envps, 0..) |*envp, i| {
        const id = try std.fmt.allocPrint(arena.allocator(), "{d}", .{i + 1});
        bun.handleOom(vm.transpiler.env.map.put("JEST_WORKER_ID", id));
        bun.handleOom(vm.transpiler.env.map.put("BUN_TEST_WORKER_ID", id));
        envp.* = try vm.transpiler.env.map.createNullDelimitedEnvMap(arena.allocator());
    }
    const argv = try buildWorkerArgv(arena.allocator(), ctx);

    // Sort lexicographically so adjacent indices share parent directories.
    // Each worker owns a contiguous chunk; co-located files share imports, so
    // this keeps each worker's isolation SourceProvider cache hot. --randomize
    // explicitly opts out of locality (the caller already shuffled).
    const sorted = try arena.allocator().dupe(PathString, files);
    if (!ctx.test_options.randomize) {
        std.sort.pdq(PathString, sorted, {}, struct {
            fn lt(_: void, a: PathString, b: PathString) bool {
                return bun.strings.order(a.slice(), b.slice()) == .lt;
            }
        }.lt);
    }

    const workers = try allocator.alloc(Worker, K);

    var coord = Coordinator{
        .vm = vm,
        .reporter = reporter,
        .files = sorted,
        .cwd = bun.fs.FileSystem.instance.top_level_dir,
        .argv = argv,
        .envps = envps,
        .workers = workers,
        .worker_tmpdir = worker_tmpdir,
        .parallel_limit = K,
        .scale_up_after_ms = if (ctx.test_options.parallel_delay_ms) |d|
            @intCast(d)
        else if (vm.transpiler.env.get("BUN_TEST_PARALLEL_SCALE_MS")) |s|
            @max(0, std.fmt.parseInt(i64, s, 10) catch default_scale_up_after_ms)
        else
            default_scale_up_after_ms,
        .bail = ctx.test_options.bail,
        .dots = ctx.test_options.reporters.dots,
        .windows_job = if (Environment.isWindows) Coordinator.createWindowsKillOnCloseJob() else {},
    };

    Coordinator.AbortHandler.install();
    defer Coordinator.AbortHandler.uninstall();

    for (workers, 0..) |*w, i| {
        const idx: u32 = @intCast(i);
        w.* = .{
            .coord = &coord,
            .idx = idx,
            .range = .{ .lo = idx * N / K, .hi = (idx + 1) * N / K },
            .out = .{ .role = .stdout, .worker = w },
            .err = .{ .role = .stderr, .worker = w },
        };
    }

    vm.eventLoop().ensureWaker();
    vm.runWithAPILock(Coordinator, &coord, Coordinator.drive);

    if (ctx.test_options.reporters.junit) {
        if (ctx.test_options.reporter_outfile) |outfile| {
            aggregate.mergeJUnitFragments(&coord, outfile, reporter.summary());
        }
    }
    if (coverage_opts.enabled) {
        switch (Output.enable_ansi_colors_stderr) {
            inline else => |colors| aggregate.mergeCoverageFragments(coord.coverage_fragments.items, coverage_opts, colors),
        }
    }
    return true;
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
    inline for (.{
        .{ "--conditions", ctx.args.conditions },
        .{ "--drop", ctx.args.drop },
        .{ "--main-fields", ctx.args.main_fields },
        .{ "--extension-order", ctx.args.extension_order },
        .{ "--env-file", ctx.args.env_files },
        .{ "--feature", ctx.args.feature_flags },
    }) |pair| {
        for (pair[1]) |value| {
            try argv.append(arena, pair[0]);
            try argv.append(arena, (try arena.dupeZ(u8, value)).ptr);
        }
    }
    if (ctx.args.preserve_symlinks orelse false)
        try argv.append(arena, "--preserve-symlinks");
    if (ctx.runtime_options.smol)
        try argv.append(arena, "--smol");
    if (ctx.runtime_options.experimental_http2_fetch)
        try argv.append(arena, "--experimental-http2-fetch");
    if (ctx.runtime_options.experimental_http3_fetch)
        try argv.append(arena, "--experimental-http3-fetch");
    if (ctx.args.allow_addons == false)
        try argv.append(arena, "--no-addons");
    if (ctx.debug.macros == .disable)
        try argv.append(arena, "--no-macros");
    if (ctx.args.disable_default_env_files)
        try argv.append(arena, "--no-env-file");
    if (ctx.args.jsx) |jsx| {
        if (jsx.factory.len > 0)
            try argv.append(arena, try printZ(arena, "--jsx-factory={s}", .{jsx.factory}));
        if (jsx.fragment.len > 0)
            try argv.append(arena, try printZ(arena, "--jsx-fragment={s}", .{jsx.fragment}));
        if (jsx.import_source.len > 0)
            try argv.append(arena, try printZ(arena, "--jsx-import-source={s}", .{jsx.import_source}));
        try argv.append(arena, try printZ(arena, "--jsx-runtime={s}", .{@tagName(jsx.runtime)}));
        if (jsx.side_effects)
            try argv.append(arena, "--jsx-side-effects");
    }
    if (opts.coverage.enabled) {
        try argv.append(arena, "--coverage");
    }

    try argv.append(arena, null);
    return argv.items[0 .. argv.items.len - 1 :null];
}

/// Event-loop-driven coordinator ↔ worker channel. The worker pumps
/// `vm.eventLoop()` between files instead of sitting in a blocking read(), so
/// any post-swap cleanup the loop owns (timers the generation guard let
/// through, async dispose, etc.) gets to run, and on macOS — where there's no
/// PDEATHSIG — coordinator death surfaces as channel close. Same `Channel`
/// abstraction as the coordinator side: usockets over the socketpair on POSIX,
/// `uv.Pipe` over the inherited duplex named-pipe on Windows.
const WorkerCommands = struct {
    vm: *jsc.VirtualMachine,
    channel: Channel(WorkerCommands, "channel") = .{},
    /// Coordinator dispatches one `.run` and waits for `.file_done` before
    /// the next, so a single slot is sufficient. Owned path storage.
    pending_idx: ?u32 = null,
    pending_path: std.ArrayListUnmanaged(u8) = .empty,
    /// EOF, error, `.shutdown`, or a corrupt frame.
    done: bool = false,

    pub fn send(this: *WorkerCommands, frame_bytes: []const u8) void {
        this.channel.send(frame_bytes);
    }

    pub fn onChannelFrame(this: *WorkerCommands, kind: Frame.Kind, rd: *Frame.Reader) void {
        switch (kind) {
            .run => {
                this.pending_idx = rd.u32_();
                this.pending_path.clearRetainingCapacity();
                bun.handleOom(this.pending_path.appendSlice(bun.default_allocator, rd.str()));
            },
            .shutdown => this.done = true,
            else => {},
        }
    }
    pub fn onChannelDone(this: *WorkerCommands) void {
        this.done = true;
    }
};

/// Worker side: read framed commands from the IPC channel via the event loop,
/// run each file with isolation, stream per-test events back. Never returns.
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

    const WorkerLoop = struct {
        reporter: *CommandLineReporter,
        vm: *jsc.VirtualMachine,
        cmds: WorkerCommands,

        pub fn begin(self: *@This()) void {
            if (!self.cmds.channel.adopt(self.vm, .fromUV(3))) {
                Output.prettyErrorln("<red>error<r>: test worker failed to adopt IPC fd", .{});
                bun.Global.exit(1);
            }
            worker_cmds = &self.cmds;

            worker_frame.begin(.ready);
            self.cmds.send(worker_frame.finish());

            while (true) {
                while (self.cmds.pending_idx == null and !self.cmds.done) {
                    self.vm.eventLoop().tick();
                    if (self.cmds.pending_idx != null or self.cmds.done) break;
                    self.vm.eventLoop().autoTick();
                }
                const idx = self.cmds.pending_idx orelse break;
                self.cmds.pending_idx = null;

                self.reporter.worker_ipc_file_idx = idx;
                worker_frame.begin(.file_start);
                worker_frame.u32_(idx);
                self.cmds.send(worker_frame.finish());

                const before = self.reporter.summary().*;
                const before_unhandled = self.reporter.jest.unhandled_errors_between_tests;

                // Workers always run with --isolate; every file is its own
                // complete run from the preload's perspective.
                TestCommand.run(self.reporter, self.vm, self.cmds.pending_path.items, .{ .first = true, .last = true }) catch |err| test_command.handleTopLevelTestErrorBeforeJavaScriptStart(err);
                self.vm.swapGlobalForTestIsolation();
                self.reporter.jest.bun_test_root.resetHookScopeForTestIsolation();
                self.reporter.jest.default_timeout_override = std.math.maxInt(u32);

                const after = self.reporter.summary().*;
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
                    self.reporter.jest.unhandled_errors_between_tests - before_unhandled,
                }) |v| worker_frame.u32_(v);
                self.cmds.send(worker_frame.finish());
            }
        }
    };

    var loop = WorkerLoop{ .reporter = reporter, .vm = vm, .cmds = .{ .vm = vm } };
    vm.runWithAPILock(WorkerLoop, &loop, WorkerLoop.begin);

    workerFlushAggregates(reporter, vm, ctx, worker_tmp, &loop.cmds);
    // Drain any backpressure-buffered frames before exit so the coordinator
    // sees repeat_bufs/junit_file/coverage_file.
    while (loop.cmds.channel.hasPendingWrites() and !loop.cmds.channel.done) {
        vm.eventLoop().tick();
        if (!loop.cmds.channel.hasPendingWrites() or loop.cmds.channel.done) break;
        vm.eventLoop().autoTick();
    }
    bun.Global.exit(0);
}

fn workerFlushAggregates(reporter: *CommandLineReporter, vm: *jsc.VirtualMachine, ctx: Command.Context, worker_tmp: ?[]const u8, cmds: *WorkerCommands) void {
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
    cmds.send(worker_frame.finish());

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
                cmds.send(worker_frame.finish());
            } else |e| {
                Output.err(e, "failed to write JUnit fragment to {s}", .{path});
            }
        }
        if (ctx.test_options.coverage.enabled) {
            const path = bun.handleOom(std.fmt.allocPrintSentinel(bun.default_allocator, "{s}/cov{d}.lcov", .{ dir, id }, 0));
            if (reporter.writeLcovOnly(vm, &ctx.test_options.coverage, path)) |_| {
                worker_frame.begin(.coverage_file);
                worker_frame.str(path);
                cmds.send(worker_frame.finish());
            } else |e| {
                Output.err(e, "failed to write coverage fragment to {s}", .{path});
            }
        }
    }
}

/// Reused across all worker → coordinator emits.
var worker_frame: Frame = .{};
/// Set in `runAsWorker` so `workerEmitTestDone` (called from
/// `CommandLineReporter.handleTestCompleted`) can reach the channel.
var worker_cmds: ?*WorkerCommands = null;

/// Called from `CommandLineReporter.handleTestCompleted` in the worker with the
/// fully-formatted status line (✓/✗ + scopes + name + duration, including ANSI
/// codes). The coordinator prints these bytes verbatim so output matches serial.
pub fn workerEmitTestDone(file_idx: u32, formatted_line: []const u8) void {
    const cmds = worker_cmds orelse return;
    worker_frame.begin(.test_done);
    worker_frame.u32_(file_idx);
    worker_frame.str(formatted_line);
    cmds.send(worker_frame.finish());
}

const Frame = @import("./Frame.zig");
const Worker = @import("./Worker.zig");
const aggregate = @import("./aggregate.zig");
const std = @import("std");
const Channel = @import("./Channel.zig").Channel;
const Command = @import("../../../cli.zig").Command;
const Coordinator = @import("./Coordinator.zig").Coordinator;

const test_command = @import("../../test_command.zig");
const CommandLineReporter = test_command.CommandLineReporter;
const TestCommand = test_command.TestCommand;

const bun = @import("bun");
const Environment = bun.Environment;
const Output = bun.Output;
const PathString = bun.PathString;
const jsc = bun.jsc;
