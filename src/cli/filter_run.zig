const bun = @import("root").bun;
const Output = bun.Output;
const Global = bun.Global;
const Environment = bun.Environment;
const std = @import("std");
const JSC = bun.JSC;
const Fs = @import("../fs.zig");
const RunCommand = @import("run_command.zig").RunCommand;

const lex = bun.js_lexer;
const logger = bun.logger;
const clap = bun.clap;
const CLI = bun.CLI;
const Arguments = CLI.Arguments;
const Command = CLI.Command;

const options = @import("../options.zig");
const js_parser = bun.js_parser;
const json_parser = bun.JSON;
const js_printer = bun.js_printer;
const js_ast = bun.JSAst;
const linker = @import("../linker.zig");

const sync = @import("../sync.zig");
const Api = @import("../api/schema.zig").Api;
const resolve_path = @import("../resolver/resolve_path.zig");
const configureTransformOptionsForBun = @import("../bun.js/config.zig").configureTransformOptionsForBun;
const bundler = bun.bundler;

const DotEnv = @import("../env_loader.zig");

const PackageManager = @import("../install/install.zig").PackageManager;
const Lockfile = @import("../install/lockfile.zig");
const FilterArg = @import("filter_arg.zig");

const ScriptConfig = struct {
    package_json_path: []u8,
    package_name: []const u8,
    script_name: []const u8,
    script_content: []const u8,
    combined: [:0]const u8,
};

pub const ProcessHandle = struct {
    const This = @This();

    state: *State,
    config: *ScriptConfig,
    process: *bun.spawn.Process,
    stdout: bun.io.BufferedReader = bun.io.BufferedReader.init(This),
    stderr: bun.io.BufferedReader = bun.io.BufferedReader.init(This),
    buffer: std.ArrayList(u8) = std.ArrayList(u8).init(bun.default_allocator),
    status: bun.spawn.Status = .running,

    pub fn onReadChunk(this: *This, chunk: []const u8, hasMore: bun.io.ReadState) bool {
        _ = hasMore;
        if (this.state.pretty_output) {
            this.buffer.appendSlice(chunk) catch bun.outOfMemory();
            this.state.redraw(false) catch {};
        } else {
            this.handleChunkBasic(chunk) catch bun.outOfMemory();
        }
        return true;
    }

    fn handleChunkBasic(this: *This, chunk: []const u8) !void {
        var content = chunk;
        if (this.buffer.items.len > 0) {
            if (std.mem.indexOfScalar(u8, content, '\n')) |i| {
                try this.buffer.appendSlice(content[0 .. i + 1]);
                content = content[i + 1 ..];
                try std.io.getStdOut().writer().print("{s}: {s}\n", .{ this.config.package_name, this.buffer.items });
                this.buffer.clearRetainingCapacity();
            } else {
                try this.buffer.appendSlice(content);
                return;
            }
        }
        while (std.mem.indexOfScalar(u8, content, '\n')) |i| {
            const line = content[0 .. i + 1];
            try std.io.getStdOut().writer().print("{s}: {s}\n", .{ this.config.package_name, line });
            content = content[i + 1 ..];
        }
        if (content.len > 0) {
            try this.buffer.appendSlice(content);
        }
    }

    pub fn onReaderDone(this: *This) void {
        _ = this;
    }

    pub fn onReaderError(this: *This, err: bun.sys.Error) void {
        _ = this;
        _ = err;
    }

    pub fn onProcessExit(this: *This, proc: *bun.spawn.Process, status: bun.spawn.Status, _: *const bun.spawn.Rusage) void {
        this.state.live_processes -= 1;
        this.status = status;
        this.state.redraw(false) catch {};
        // We just leak the process because we're going to exit anyway after all processes are done
        _ = proc;
    }

    pub fn eventLoop(this: *This) *bun.JSC.MiniEventLoop {
        return this.state.event_loop;
    }

    pub fn loop(this: *This) *bun.uws.Loop {
        return this.state.event_loop.loop;
    }
};

pub const InterpreterHandle = struct {
    const This = @This();

    state: *State,
    config: *ScriptConfig,
    buffer: std.ArrayList(u8) = std.ArrayList(u8).init(bun.default_allocator),
    done: bool = false,
};

fn fmt(comptime str: []const u8) []const u8 {
    return Output.prettyFmt(str, true);
}

const State = struct {
    const This = @This();

    handles: []ProcessHandle,
    event_loop: *bun.JSC.MiniEventLoop,
    live_processes: usize,
    draw_buf: std.ArrayList(u8) = std.ArrayList(u8).init(bun.default_allocator),
    last_lines_written: usize = 0,
    pretty_output: bool,

    pub fn isDone(this: *This) bool {
        const state = bun.cast(*const @This(), this);
        return state.live_processes == 0;
    }

    const ElideResult = struct {
        content: []const u8,
        elided_count: usize,
    };

    fn elide(data_: []const u8, max_lines: ?usize) ElideResult {
        var data = data_;
        if (data.len == 0) return ElideResult{ .content = &.{}, .elided_count = 0 };
        if (data[data.len - 1] == '\n') {
            data = data[0 .. data.len - 1];
        }
        if (max_lines == null) return ElideResult{ .content = data, .elided_count = 0 };
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
        return ElideResult{ .content = content, .elided_count = elided };
    }

    pub fn redraw(this: *This, is_abort: bool) !void {
        if (!this.pretty_output) return;
        this.draw_buf.clearRetainingCapacity();
        if (this.last_lines_written > 0) {
            // move cursor to the beginning of the line and clear it
            try this.draw_buf.appendSlice("\x1b[0G\x1b[K");
            for (0..this.last_lines_written) |_| {
                // move cursor up and clear the line
                try this.draw_buf.appendSlice("\x1b[1A\x1b[K");
            }
        }
        for (this.handles) |*handle| {
            const e = elide(handle.buffer.items, if (is_abort) null else 10);
            try this.draw_buf.writer().print(fmt("<b>{s}<r> $ <d>{s}<r>\n"), .{ handle.config.package_name, handle.config.script_content });
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
            switch (handle.status) {
                .running => try this.draw_buf.appendSlice(fmt("<cyan>Running...<r>\n")),
                .exited => |exited| {
                    if (exited.code == 0) {
                        try this.draw_buf.appendSlice(fmt("<cyan>Done<r>\n"));
                    } else {
                        try this.draw_buf.writer().print(fmt("<red>Exited with code {d}<r>\n"), .{exited.code});
                    }
                },
                .signaled => |code| {
                    try this.draw_buf.writer().print(fmt("<red>Signaled with code {s}<r>\n"), .{@tagName(code)});
                },
                .err => {
                    try this.draw_buf.appendSlice(fmt("<red>Error<r>\n"));
                },
            }
        }
        this.last_lines_written = 0;
        for (this.draw_buf.items) |c| {
            if (c == '\n') {
                this.last_lines_written += 1;
            }
        }
        try std.io.getStdOut().writeAll(this.draw_buf.items);
    }

    pub fn flush(this: *This) !void {
        if (this.pretty_output) return;
        for (this.handles) |*handle| {
            try std.io.getStdOut().writer().print("{s}: {s}\n", .{ handle.config.package_name, handle.buffer.items });
            handle.buffer.clearRetainingCapacity();
        }
    }

    pub fn abort(this: *This) void {
        for (this.handles) |*handle| {
            // if we get an error here we simply ignore it
            _ = handle.process.kill(std.os.SIG.INT);
        }
    }
};

const AbortHandler = struct {
    const This = @This();

    var should_abort = false;

    fn posixSignalHandler(sig: i32, info: *const std.os.siginfo_t, _: ?*const anyopaque) callconv(.C) void {
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
            const action = std.os.Sigaction{
                .handler = .{ .sigaction = AbortHandler.posixSignalHandler },
                .mask = std.os.empty_sigset,
                .flags = std.os.SA.SIGINFO | std.os.SA.RESTART | std.os.SA.RESETHAND,
            };
            // if we can't set the handler, we just ignore it
            std.os.sigaction(std.os.SIG.INT, &action, null) catch |err| {
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
};

pub fn runScriptsWithFilter(ctx: Command.Context) !noreturn {
    const script_name = if (ctx.positionals.len > 1) ctx.positionals[1] else brk: {
        Output.prettyErrorln("<r><red>error<r>: No script name provided", .{});
        break :brk Global.exit(1);
    };

    // 1. find package.json at workspace root
    // 2. read workspace configuration
    // 3. get list of packages that match the configuration
    // 4. spawn the scripts and get their respective process handles
    // 5. concurrently read from the output fds and print them to stdout
    // 6. once all processes have exited, exit

    const fsinstance = try bun.fs.FileSystem.init(null);

    // these things are leaked because we are going to exit
    var filter_instance = try FilterArg.FilterSet.init(ctx.allocator, ctx.filters, fsinstance.top_level_dir);
    var patterns = std.ArrayList([]u8).init(ctx.allocator);

    var root_buf: bun.PathBuffer = undefined;
    const resolve_root = try FilterArg.getCandidatePackagePatterns(ctx.allocator, ctx.log, &patterns, fsinstance.top_level_dir, &root_buf);

    var this_bundler: bundler.Bundler = undefined;
    _ = try RunCommand.configureEnvForRun(ctx, &this_bundler, null, true, false);

    var package_json_iter = try FilterArg.PackageFilterIterator.init(ctx.allocator, patterns.items, resolve_root);
    defer package_json_iter.deinit();

    var scripts = std.ArrayList(ScriptConfig).init(ctx.allocator);
    while (try package_json_iter.next()) |package_json_path| {
        const dirpath = std.fs.path.dirname(package_json_path) orelse Global.crash();
        const path = bun.strings.withoutTrailingSlash(dirpath);

        const dir_info = this_bundler.resolver.readDirInfo(path) catch |err| {
            Output.warn("Failed to read directory info for {s}: {s}\n", .{ path, @errorName(err) });
            continue;
        } orelse continue;

        const pkgjson = dir_info.enclosing_package_json orelse continue;

        const matches = if (filter_instance.has_name_filters)
            filter_instance.matchesPathName(path, pkgjson.name)
        else
            filter_instance.matchesPath(path);

        if (!matches) continue;

        const pkgscripts = pkgjson.scripts orelse continue;
        const content = pkgscripts.get(script_name) orelse continue;

        // we leak this
        var copy_script = try std.ArrayList(u8).initCapacity(ctx.allocator, content.len);
        try RunCommand.replacePackageManagerRun(&copy_script, content);

        // and this, too
        var combined_len = content.len;
        for (ctx.passthrough) |p| {
            combined_len += p.len + 1;
        }
        var combined = try ctx.allocator.allocSentinel(u8, combined_len, 0);
        bun.copy(u8, combined, content);
        var remaining_script_buf = combined[content.len..];
        for (ctx.passthrough) |part| {
            const p = part;
            remaining_script_buf[0] = ' ';
            bun.copy(u8, remaining_script_buf[1..], p);
            remaining_script_buf = remaining_script_buf[p.len + 1 ..];
        }

        try scripts.append(.{
            .package_json_path = try ctx.allocator.dupe(u8, package_json_path),
            .package_name = pkgjson.name,
            .script_name = script_name,
            .script_content = copy_script.items,
            .combined = combined,
        });
    }

    if (scripts.items.len == 0) {
        Output.prettyErrorln("<r><red>error<r>: No packages matched the filter", .{});
        Global.exit(1);
    }

    const event_loop = bun.JSC.MiniEventLoop.initGlobal(this_bundler.env);
    const shell_bin: [:0]const u8 = if (Environment.isPosix)
        RunCommand.findShell(this_bundler.env.get("PATH") orelse "", fsinstance.top_level_dir) orelse return error.MissingShell
    else
        bun.selfExePath() catch return error.MissingShell;
    const envp = try this_bundler.env.map.createNullDelimitedEnvMap(ctx.allocator);

    var state = State{
        .handles = try ctx.allocator.alloc(ProcessHandle, scripts.items.len),
        .event_loop = event_loop,
        .live_processes = scripts.items.len,
        .pretty_output = Output.enable_ansi_colors_stdout,
    };

    for (scripts.items, 0..) |*script, i| {
        var argv = [_:null]?[*:0]const u8{ shell_bin, if (Environment.isPosix) "-c" else "exec", script.combined, null };

        const spawn_options = bun.spawn.SpawnOptions{
            .stdin = .ignore,
            .stdout = if (Environment.isPosix) .buffer else .{ .buffer = try bun.default_allocator.create(bun.windows.libuv.Pipe) },
            .stderr = if (Environment.isPosix) .buffer else .{ .buffer = try bun.default_allocator.create(bun.windows.libuv.Pipe) },
            .cwd = std.fs.path.dirname(script.package_json_path) orelse "",
            .windows = if (Environment.isWindows) .{ .loop = JSC.EventLoopHandle.init(event_loop) } else {},
            .stream = false,
        };

        var spawned = try (try bun.spawn.spawnProcess(&spawn_options, argv[0..], envp)).unwrap();
        var process = spawned.toProcess(event_loop, false);
        state.handles[i] = ProcessHandle{
            .state = &state,
            .config = script,
            .process = process,
        };

        const handle = &state.handles[i];
        handle.stdout.setParent(handle);
        handle.stderr.setParent(handle);

        if (Environment.isWindows) {
            handle.stdout.source = .{ .pipe = spawn_options.stdout.buffer };
            handle.stderr.source = .{ .pipe = spawn_options.stderr.buffer };
        }

        if (Environment.isPosix) {
            if (spawned.stdout) |stdout| {
                if (!spawned.memfds[1]) {
                    try handle.stdout.start(stdout, true).unwrap();
                } else {
                    handle.stdout.startMemfd(stdout);
                }
            }
            if (spawned.stderr) |stderr| {
                if (!spawned.memfds[2]) {
                    try handle.stderr.start(stderr, true).unwrap();
                } else {
                    handle.stderr.startMemfd(stderr);
                }
            }
        } else {
            try handle.stdout.startWithCurrentPipe().unwrap();
            try handle.stderr.startWithCurrentPipe().unwrap();
        }

        process.setExitHandler(handle);

        try process.watch(event_loop).unwrap();
    }

    AbortHandler.install();

    var aborted = false;
    while (!state.isDone()) {
        if (AbortHandler.should_abort and !aborted) {
            aborted = true;
            state.abort();
        }
        event_loop.tickOnce(&state);
    }

    if (state.pretty_output) {
        state.redraw(aborted) catch {};
    } else {
        state.flush() catch {};
    }

    Global.exit(0);
}
