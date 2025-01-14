const bun = @import("root").bun;
const Output = bun.Output;
const Global = bun.Global;
const Environment = bun.Environment;
const std = @import("std");
const Fs = @import("../fs.zig");
const RunCommand = @import("run_command.zig").RunCommand;
const DependencyMap = @import("../resolver/package_json.zig").DependencyMap;
const SemverString = @import("../install/semver.zig").String;

const CLI = bun.CLI;
const Command = CLI.Command;

const transpiler = bun.transpiler;

const FilterArg = @import("filter_arg.zig");

const ScriptConfig = struct {
    package_json_path: []u8,
    package_name: []const u8,
    script_name: []const u8,
    script_content: []const u8,
    combined: [:0]const u8,
    deps: DependencyMap,

    // $PATH must be set per script because it contains
    // node_modules/.bin
    // ../node_modules/.bin
    // ../../node_modules/.bin
    // and so forth, in addition to the user's $PATH.
    PATH: []const u8,
    elide_count: ?usize,

    fn cmp(_: void, a: @This(), b: @This()) bool {
        return bun.strings.cmpStringsAsc({}, a.package_name, b.package_name);
    }
};

pub const ProcessHandle = struct {
    const This = @This();

    config: *ScriptConfig,
    state: *State,

    stdout: bun.io.BufferedReader = bun.io.BufferedReader.init(This),
    stderr: bun.io.BufferedReader = bun.io.BufferedReader.init(This),
    buffer: std.ArrayList(u8) = std.ArrayList(u8).init(bun.default_allocator),

    process: ?struct {
        ptr: *bun.spawn.Process,
        status: bun.spawn.Status = .running,
    } = null,
    options: bun.spawn.SpawnOptions,

    start_time: ?std.time.Instant = null,
    end_time: ?std.time.Instant = null,

    remaining_dependencies: usize = 0,
    dependents: std.ArrayList(*This) = std.ArrayList(*This).init(bun.default_allocator),
    visited: bool = false,
    visiting: bool = false,

    fn start(this: *This) !void {
        this.state.remaining_scripts += 1;
        const handle = this;

        var argv = [_:null]?[*:0]const u8{ this.state.shell_bin, if (Environment.isPosix) "-c" else "exec", this.config.combined, null };

        this.start_time = std.time.Instant.now() catch null;
        var spawned: bun.spawn.SpawnProcessResult = brk: {

            // Get the envp with the PATH configured
            // There's probably a more optimal way to do this where you have a std.ArrayList shared
            // instead of creating a new one for each process
            var arena = std.heap.ArenaAllocator.init(bun.default_allocator);
            defer arena.deinit();
            const original_path = this.state.env.map.get("PATH") orelse "";
            this.state.env.map.put("PATH", this.config.PATH) catch bun.outOfMemory();
            defer this.state.env.map.put("PATH", original_path) catch bun.outOfMemory();
            const envp = try this.state.env.map.createNullDelimitedEnvMap(arena.allocator());

            break :brk try (try bun.spawn.spawnProcess(&this.options, argv[0..], envp)).unwrap();
        };
        var process = spawned.toProcess(this.state.event_loop, false);

        handle.stdout.setParent(handle);
        handle.stderr.setParent(handle);

        if (Environment.isWindows) {
            handle.stdout.source = .{ .pipe = this.options.stdout.buffer };
            handle.stderr.source = .{ .pipe = this.options.stderr.buffer };
        }

        if (Environment.isPosix) {
            if (spawned.stdout) |stdout| {
                _ = bun.sys.setNonblocking(stdout);
                try handle.stdout.start(stdout, true).unwrap();
            }
            if (spawned.stderr) |stderr| {
                _ = bun.sys.setNonblocking(stderr);
                try handle.stderr.start(stderr, true).unwrap();
            }
        } else {
            try handle.stdout.startWithCurrentPipe().unwrap();
            try handle.stderr.startWithCurrentPipe().unwrap();
        }

        this.process = .{ .ptr = process };
        process.setExitHandler(handle);

        switch (process.watchOrReap()) {
            .result => {},
            .err => |err| {
                if (!process.hasExited())
                    process.onExit(.{ .err = err }, &std.mem.zeroes(bun.spawn.Rusage));
            },
        }
    }

    pub fn onReadChunk(this: *This, chunk: []const u8, hasMore: bun.io.ReadState) bool {
        _ = hasMore;
        this.state.readChunk(this, chunk) catch {};
        return true;
    }

    pub fn onReaderDone(this: *This) void {
        _ = this;
    }

    pub fn onReaderError(this: *This, err: bun.sys.Error) void {
        _ = this;
        _ = err;
    }

    pub fn onProcessExit(this: *This, proc: *bun.spawn.Process, status: bun.spawn.Status, _: *const bun.spawn.Rusage) void {
        this.process.?.status = status;
        this.end_time = std.time.Instant.now() catch null;
        // We just leak the process because we're going to exit anyway after all processes are done
        _ = proc;
        this.state.processExit(this) catch {};
    }

    pub fn eventLoop(this: *This) *bun.JSC.MiniEventLoop {
        return this.state.event_loop;
    }

    pub fn loop(this: *This) *bun.uws.Loop {
        return this.state.event_loop.loop;
    }
};

fn fmt(comptime str: []const u8) []const u8 {
    return Output.prettyFmt(str, true);
}

const State = struct {
    const This = @This();

    handles: []ProcessHandle,
    event_loop: *bun.JSC.MiniEventLoop,
    remaining_scripts: usize = 0,
    // buffer for batched output
    draw_buf: std.ArrayList(u8) = std.ArrayList(u8).init(bun.default_allocator),
    last_lines_written: usize = 0,
    pretty_output: bool,
    shell_bin: [:0]const u8,
    aborted: bool = false,
    env: *bun.DotEnv.Loader,

    pub fn isDone(this: *This) bool {
        return this.remaining_scripts == 0;
    }

    const ElideResult = struct {
        content: []const u8,
        elided_count: usize,
    };

    fn readChunk(this: *This, handle: *ProcessHandle, chunk: []const u8) !void {
        if (this.pretty_output) {
            handle.buffer.appendSlice(chunk) catch bun.outOfMemory();
            this.redraw(false) catch {};
        } else {
            var content = chunk;
            this.draw_buf.clearRetainingCapacity();
            if (handle.buffer.items.len > 0) {
                if (std.mem.indexOfScalar(u8, content, '\n')) |i| {
                    try handle.buffer.appendSlice(content[0 .. i + 1]);
                    content = content[i + 1 ..];
                    try this.draw_buf.writer().print("{s} {s}: {s}", .{ handle.config.package_name, handle.config.script_name, handle.buffer.items });
                    handle.buffer.clearRetainingCapacity();
                } else {
                    try handle.buffer.appendSlice(content);
                    return;
                }
            }
            while (std.mem.indexOfScalar(u8, content, '\n')) |i| {
                const line = content[0 .. i + 1];
                try this.draw_buf.writer().print("{s} {s}: {s}", .{ handle.config.package_name, handle.config.script_name, line });
                content = content[i + 1 ..];
            }
            if (content.len > 0) {
                try handle.buffer.appendSlice(content);
            }
            this.flushDrawBuf();
        }
    }

    fn processExit(this: *This, handle: *ProcessHandle) !void {
        this.remaining_scripts -= 1;
        if (!this.aborted) {
            for (handle.dependents.items) |dependent| {
                dependent.remaining_dependencies -= 1;
                if (dependent.remaining_dependencies == 0) {
                    dependent.start() catch {
                        Output.prettyErrorln("<r><red>error<r>: Failed to start process", .{});
                        Global.exit(1);
                    };
                }
            }
        }
        if (this.pretty_output) {
            this.redraw(false) catch {};
        } else {
            this.draw_buf.clearRetainingCapacity();
            // flush any remaining buffer
            if (handle.buffer.items.len > 0) {
                try this.draw_buf.writer().print("{s}: {s}\n", .{ handle.config.package_name, handle.buffer.items });
                handle.buffer.clearRetainingCapacity();
            }
            // print exit status
            switch (handle.process.?.status) {
                .exited => |exited| {
                    try this.draw_buf.writer().print("{s} {s}: Exited with code {d}\n", .{ handle.config.package_name, handle.config.script_name, exited.code });
                },
                .signaled => |signal| {
                    try this.draw_buf.writer().print("{s} {s}: Signaled with code {s}\n", .{ handle.config.package_name, handle.config.script_name, @tagName(signal) });
                },
                else => {},
            }
            this.flushDrawBuf();
        }
    }

    fn elide(data_: []const u8, max_lines: ?usize) ElideResult {
        var data = data_;
        if (data.len == 0) return .{ .content = &.{}, .elided_count = 0 };
        if (data[data.len - 1] == '\n') {
            data = data[0 .. data.len - 1];
        }
        if (max_lines == null or max_lines.? == 0) return .{ .content = data, .elided_count = 0 };
        var i: usize = data.len;
        var lines: usize = 0;
        while (i > 0) : (i -= 1) {
            if (data[i - 1] == '\n') {
                lines += 1;
                if (lines >= max_lines.?) {
                    break;
                }
            }
        }
        const content = if (i >= data.len) &.{} else data[i..];
        var elided: usize = 0;
        while (i > 0) : (i -= 1) {
            if (data[i - 1] == '\n') {
                elided += 1;
            }
        }
        return .{ .content = content, .elided_count = elided };
    }

    fn redraw(this: *This, is_abort: bool) !void {
        if (!this.pretty_output) return;
        this.draw_buf.clearRetainingCapacity();
        try this.draw_buf.appendSlice("\x1b[?2026h");
        if (this.last_lines_written > 0) {
            // move cursor to the beginning of the line and clear it
            try this.draw_buf.appendSlice("\x1b[0G\x1b[K");
            for (0..this.last_lines_written) |_| {
                // move cursor up and clear the line
                try this.draw_buf.appendSlice("\x1b[1A\x1b[K");
            }
        }
        for (this.handles) |*handle| {
            // normally we truncate the output to 10 lines, but on abort we print everything to aid debugging
            const elide_lines = if (is_abort) null else handle.config.elide_count orelse 10;
            const e = elide(handle.buffer.items, elide_lines);

            try this.draw_buf.writer().print(fmt("<b>{s}<r> {s} $ <d>{s}<r>\n"), .{ handle.config.package_name, handle.config.script_name, handle.config.script_content });
            if (e.elided_count > 0) {
                try this.draw_buf.writer().print(
                    fmt("<cyan>│<r> <d>[{d} lines elided]<r>\n"),
                    .{e.elided_count},
                );
            }
            var content = e.content;
            while (std.mem.indexOfScalar(u8, content, '\n')) |i| {
                const line = content[0 .. i + 1];
                try this.draw_buf.appendSlice(fmt("<cyan>│<r> "));
                try this.draw_buf.appendSlice(line);
                content = content[i + 1 ..];
            }
            if (content.len > 0) {
                try this.draw_buf.appendSlice(fmt("<cyan>│<r> "));
                try this.draw_buf.appendSlice(content);
                try this.draw_buf.append('\n');
            }
            try this.draw_buf.appendSlice(fmt("<cyan>└─<r> "));
            if (handle.process) |proc| {
                switch (proc.status) {
                    .running => try this.draw_buf.appendSlice(fmt("<cyan>Running...<r>\n")),
                    .exited => |exited| {
                        if (exited.code == 0) {
                            if (handle.start_time != null and handle.end_time != null) {
                                const duration = handle.end_time.?.since(handle.start_time.?);
                                const ms = @as(f64, @floatFromInt(duration)) / 1_000_000.0;
                                if (ms > 1000.0) {
                                    try this.draw_buf.writer().print(fmt("<cyan>Done in {d:.2} s<r>\n"), .{ms / 1_000.0});
                                } else {
                                    try this.draw_buf.writer().print(fmt("<cyan>Done in {d:.0} ms<r>\n"), .{ms});
                                }
                            } else {
                                try this.draw_buf.appendSlice(fmt("<cyan>Done<r>\n"));
                            }
                        } else {
                            try this.draw_buf.writer().print(fmt("<red>Exited with code {d}<r>\n"), .{exited.code});
                        }
                    },
                    .signaled => |code| {
                        if (code == .SIGINT) {
                            try this.draw_buf.writer().print(fmt("<red>Interrupted<r>\n"), .{});
                        } else {
                            try this.draw_buf.writer().print(fmt("<red>Signaled with code {s}<r>\n"), .{@tagName(code)});
                        }
                    },
                    .err => {
                        try this.draw_buf.appendSlice(fmt("<red>Error<r>\n"));
                    },
                }
            } else {
                try this.draw_buf.writer().print(fmt("<cyan><d>Waiting for {d} other script(s)<r>\n"), .{handle.remaining_dependencies});
            }
        }
        try this.draw_buf.appendSlice("\x1b[?2026l");
        this.last_lines_written = 0;
        for (this.draw_buf.items) |c| {
            if (c == '\n') {
                this.last_lines_written += 1;
            }
        }
        this.flushDrawBuf();
    }

    fn flushDrawBuf(this: *This) void {
        std.io.getStdOut().writeAll(this.draw_buf.items) catch {};
    }

    pub fn abort(this: *This) void {
        // we perform an abort by sending SIGINT to all processes
        this.aborted = true;
        for (this.handles) |*handle| {
            if (handle.process) |*proc| {
                // if we get an error here we simply ignore it
                _ = proc.ptr.kill(std.posix.SIG.INT);
            }
        }
    }

    pub fn finalize(this: *This) u8 {
        if (this.aborted) {
            this.redraw(true) catch {};
        }
        for (this.handles) |handle| {
            if (handle.process) |proc| {
                switch (proc.status) {
                    .exited => |exited| if (exited.code != 0) return exited.code,
                    .signaled => |signal| return signal.toExitCode() orelse 1,
                    else => return 1,
                }
            }
        }
        return 0;
    }
};

const AbortHandler = struct {
    const This = @This();

    var should_abort = false;

    fn posixSignalHandler(sig: i32, info: *const std.posix.siginfo_t, _: ?*const anyopaque) callconv(.C) void {
        _ = sig;
        _ = info;
        should_abort = true;
    }

    fn windowsCtrlHandler(dwCtrlType: std.os.windows.DWORD) callconv(std.os.windows.WINAPI) std.os.windows.BOOL {
        if (dwCtrlType == std.os.windows.CTRL_C_EVENT) {
            should_abort = true;
            return std.os.windows.TRUE;
        }
        return std.os.windows.FALSE;
    }

    pub fn install() void {
        if (Environment.isPosix) {
            const action = std.posix.Sigaction{
                .handler = .{ .sigaction = AbortHandler.posixSignalHandler },
                .mask = std.posix.empty_sigset,
                .flags = std.posix.SA.SIGINFO | std.posix.SA.RESTART | std.posix.SA.RESETHAND,
            };
            // if we can't set the handler, we just ignore it
            std.posix.sigaction(std.posix.SIG.INT, &action, null) catch |err| {
                if (Environment.isDebug) {
                    Output.warn("Failed to set abort handler: {s}\n", .{@errorName(err)});
                }
            };
        } else {
            const res = bun.windows.SetConsoleCtrlHandler(windowsCtrlHandler, std.os.windows.TRUE);
            if (res == 0) {
                if (Environment.isDebug) {
                    Output.warn("Failed to set abort handler\n", .{});
                }
            }
        }
    }

    pub fn uninstall() void {
        // only necessary on Windows, as on posix we pass the SA_RESETHAND flag
        if (Environment.isWindows) {
            // restores default Ctrl+C behavior
            _ = bun.windows.SetConsoleCtrlHandler(null, std.os.windows.FALSE);
        }
    }
};

fn windowsIsTerminal() bool {
    const res = bun.windows.GetFileType(bun.STDOUT_FD.cast());
    return res == bun.windows.FILE_TYPE_CHAR;
}

pub fn runScriptsWithFilter(ctx: Command.Context) !noreturn {
    const script_name = if (ctx.positionals.len > 1) ctx.positionals[1] else if (ctx.positionals.len > 0) ctx.positionals[0] else {
        Output.prettyErrorln("<r><red>error<r>: No script name provided", .{});
        Global.exit(1);
    };
    const pre_script_name = try ctx.allocator.alloc(u8, script_name.len + 3);
    @memcpy(pre_script_name[0..3], "pre");
    @memcpy(pre_script_name[3..], script_name);

    const post_script_name = try ctx.allocator.alloc(u8, script_name.len + 4);
    @memcpy(post_script_name[0..4], "post");
    @memcpy(post_script_name[4..], script_name);

    const fsinstance = try bun.fs.FileSystem.init(null);

    // these things are leaked because we are going to exit
    var filter_instance = try FilterArg.FilterSet.init(ctx.allocator, ctx.filters, fsinstance.top_level_dir);
    var patterns = std.ArrayList([]u8).init(ctx.allocator);

    // Find package.json at workspace root
    var root_buf: bun.PathBuffer = undefined;
    const resolve_root = try FilterArg.getCandidatePackagePatterns(ctx.allocator, ctx.log, &patterns, fsinstance.top_level_dir, &root_buf);

    var this_transpiler: transpiler.Transpiler = undefined;
    _ = try RunCommand.configureEnvForRun(ctx, &this_transpiler, null, true, false);

    var package_json_iter = try FilterArg.PackageFilterIterator.init(ctx.allocator, patterns.items, resolve_root);
    defer package_json_iter.deinit();

    // Get list of packages that match the configuration
    var scripts = std.ArrayList(ScriptConfig).init(ctx.allocator);
    // var scripts = std.ArrayHashMap([]const u8, ScriptConfig).init(ctx.allocator);
    while (try package_json_iter.next()) |package_json_path| {
        const dirpath = std.fs.path.dirname(package_json_path) orelse Global.crash();
        const path = bun.strings.withoutTrailingSlash(dirpath);

        const pkgjson = bun.PackageJSON.parse(&this_transpiler.resolver, dirpath, .zero, null, .include_scripts, .main, .no_hash) orelse {
            Output.warn("Failed to read package.json\n", .{});
            continue;
        };

        const pkgscripts = pkgjson.scripts orelse continue;

        if (!filter_instance.matches(path, pkgjson.name))
            continue;

        const PATH = try RunCommand.configurePathForRunWithPackageJsonDir(ctx, dirpath, &this_transpiler, null, dirpath, ctx.debug.run_in_bun);

        for (&[3][]const u8{ pre_script_name, script_name, post_script_name }) |name| {
            const original_content = pkgscripts.get(name) orelse continue;

            var copy_script_capacity: usize = original_content.len;
            for (ctx.passthrough) |part| copy_script_capacity += 1 + part.len;
            // we leak this
            var copy_script = try std.ArrayList(u8).initCapacity(ctx.allocator, copy_script_capacity);

            try RunCommand.replacePackageManagerRun(&copy_script, original_content);
            const len_command_only = copy_script.items.len;

            for (ctx.passthrough) |part| {
                try copy_script.append(' ');
                if (bun.shell.needsEscapeUtf8AsciiLatin1(part)) {
                    try bun.shell.escape8Bit(part, &copy_script, true);
                } else {
                    try copy_script.appendSlice(part);
                }
            }
            try copy_script.append(0);

            try scripts.append(.{
                .package_json_path = try ctx.allocator.dupe(u8, package_json_path),
                .package_name = pkgjson.name,
                .script_name = name,
                .script_content = copy_script.items[0..len_command_only],
                .combined = copy_script.items[0 .. copy_script.items.len - 1 :0],
                .deps = pkgjson.dependencies,
                .PATH = PATH,
                .elide_count = ctx.bundler_options.elide_lines,
            });
        }
    }

    if (scripts.items.len == 0) {
        Output.prettyErrorln("<r><red>error<r>: No packages matched the filter", .{});
        Global.exit(1);
    }

    const event_loop = bun.JSC.MiniEventLoop.initGlobal(this_transpiler.env);
    const shell_bin: [:0]const u8 = if (Environment.isPosix)
        RunCommand.findShell(this_transpiler.env.get("PATH") orelse "", fsinstance.top_level_dir) orelse return error.MissingShell
    else
        bun.selfExePath() catch return error.MissingShell;

    var state = State{
        .handles = try ctx.allocator.alloc(ProcessHandle, scripts.items.len),
        .event_loop = event_loop,
        .pretty_output = if (Environment.isWindows) windowsIsTerminal() else Output.enable_ansi_colors_stdout,
        .shell_bin = shell_bin,
        .env = this_transpiler.env,
    };

    // Check if elide-lines is used in a non-terminal environment
    if (ctx.bundler_options.elide_lines != null and !state.pretty_output) {
        Output.prettyErrorln("<r><red>error<r>: --elide-lines is only supported in terminal environments", .{});
        Global.exit(1);
    }

    // initialize the handles
    var map = bun.StringHashMap(std.ArrayList(*ProcessHandle)).init(ctx.allocator);
    for (scripts.items, 0..) |*script, i| {
        state.handles[i] = ProcessHandle{
            .state = &state,
            .config = script,
            .options = .{
                .stdin = .ignore,
                .stdout = if (Environment.isPosix) .buffer else .{ .buffer = try bun.default_allocator.create(bun.windows.libuv.Pipe) },
                .stderr = if (Environment.isPosix) .buffer else .{ .buffer = try bun.default_allocator.create(bun.windows.libuv.Pipe) },
                .cwd = std.fs.path.dirname(script.package_json_path) orelse "",
                .windows = if (Environment.isWindows) .{ .loop = bun.JSC.EventLoopHandle.init(event_loop) } else {},
                .stream = true,
            },
        };
        const res = try map.getOrPut(script.package_name);
        if (res.found_existing) {
            try res.value_ptr.append(&state.handles[i]);
            // Output.prettyErrorln("<r><red>error<r>: Duplicate package name: {s}", .{script.package_name});
            // Global.exit(1);
        } else {
            res.value_ptr.* = std.ArrayList(*ProcessHandle).init(ctx.allocator);
            try res.value_ptr.append(&state.handles[i]);
            // &state.handles[i];
        }
    }
    // compute dependencies (TODO: maybe we should do this only in a workspace?)
    for (state.handles) |*handle| {
        var iter = handle.config.deps.map.iterator();
        while (iter.next()) |entry| {
            var sfa = std.heap.stackFallback(256, ctx.allocator);
            const alloc = sfa.get();
            const buf = try alloc.alloc(u8, entry.key_ptr.len());
            defer alloc.free(buf);
            const name = entry.key_ptr.slice(buf);
            // is it a workspace dependency?
            if (map.get(name)) |pkgs| {
                for (pkgs.items) |dep| {
                    try dep.dependents.append(handle);
                    handle.remaining_dependencies += 1;
                }
            }
        }
    }

    // check if there is a dependency cycle
    var has_cycle = false;
    for (state.handles) |*handle| {
        if (hasCycle(handle)) {
            has_cycle = true;
            break;
        }
    }
    // if there is, we ignore dependency order completely
    if (has_cycle) {
        for (state.handles) |*handle| {
            handle.dependents.clearRetainingCapacity();
            handle.remaining_dependencies = 0;
        }
    }

    // set up dependencies between pre/post scripts
    // this is done after the cycle check because we don't want these to be removed if there is a cycle
    for (0..state.handles.len - 1) |i| {
        if (bun.strings.eql(state.handles[i].config.package_name, state.handles[i + 1].config.package_name)) {
            try state.handles[i].dependents.append(&state.handles[i + 1]);
            state.handles[i + 1].remaining_dependencies += 1;
        }
    }

    // start inital scripts
    for (state.handles) |*handle| {
        if (handle.remaining_dependencies == 0) {
            handle.start() catch {
                // todo this should probably happen in "start"
                Output.prettyErrorln("<r><red>error<r>: Failed to start process", .{});
                Global.exit(1);
            };
        }
    }

    AbortHandler.install();

    while (!state.isDone()) {
        if (AbortHandler.should_abort and !state.aborted) {
            // We uninstall the custom abort handler so that if the user presses Ctrl+C again,
            // the process is aborted immediately and doesn't wait for the event loop to tick.
            // This can be useful if one of the processes is stuck and doesn't react to SIGINT.
            AbortHandler.uninstall();
            state.abort();
        }
        event_loop.tickOnce(&state);
    }

    const status = state.finalize();

    Global.exit(status);
}

fn hasCycle(current: *ProcessHandle) bool {
    current.visited = true;
    current.visiting = true;
    for (current.dependents.items) |dep| {
        if (dep.visiting) {
            return true;
        } else if (!dep.visited) {
            if (hasCycle(dep)) {
                return true;
            }
        }
    }
    current.visiting = false;
    return false;
}
