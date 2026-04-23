const ScriptConfig = struct {
    label: []const u8,
    command: [:0]const u8,
    cwd: []const u8,
    PATH: []const u8,
};

/// Wraps a BufferedReader and tracks whether it represents stdout or stderr,
/// so output can be routed to the correct parent stream.
const PipeReader = struct {
    const This = @This();

    reader: bun.io.BufferedReader = bun.io.BufferedReader.init(This),
    handle: *ProcessHandle = undefined, // set in ProcessHandle.start()
    is_stderr: bool,
    line_buffer: std.array_list.Managed(u8) = std.array_list.Managed(u8).init(bun.default_allocator),

    pub fn onReadChunk(this: *This, chunk: []const u8, hasMore: bun.io.ReadState) bool {
        _ = hasMore;
        this.handle.state.readChunk(this, chunk) catch {};
        return true;
    }

    pub fn onReaderDone(this: *This) void {
        _ = this;
    }

    pub fn onReaderError(this: *This, err: bun.sys.Error) void {
        _ = this;
        _ = err;
    }

    pub fn eventLoop(this: *This) *bun.jsc.MiniEventLoop {
        return this.handle.state.event_loop;
    }

    pub fn loop(this: *This) *bun.Async.Loop {
        if (comptime bun.Environment.isWindows) {
            return this.handle.state.event_loop.loop.uv_loop;
        } else {
            return this.handle.state.event_loop.loop;
        }
    }
};

pub const ProcessHandle = struct {
    const This = @This();

    config: *ScriptConfig,
    state: *State,
    color_idx: usize,

    stdout_reader: PipeReader = .{ .is_stderr = false },
    stderr_reader: PipeReader = .{ .is_stderr = true },

    process: ?struct {
        ptr: *bun.spawn.Process,
        status: bun.spawn.Status = .running,
    } = null,
    options: bun.spawn.SpawnOptions,

    start_time: ?std.time.Instant = null,
    end_time: ?std.time.Instant = null,

    remaining_dependencies: usize = 0,
    /// Dependents within the same script group (pre->main->post chain).
    /// These are NOT started if this handle fails, even with --no-exit-on-error.
    group_dependents: std.array_list.Managed(*This) = std.array_list.Managed(*This).init(bun.default_allocator),
    /// Dependents across sequential groups (group N -> group N+1).
    /// These ARE started even if this handle fails when --no-exit-on-error is set.
    next_dependents: std.array_list.Managed(*This) = std.array_list.Managed(*This).init(bun.default_allocator),

    fn start(this: *This) !void {
        this.state.remaining_scripts += 1;

        var argv = [_:null]?[*:0]const u8{
            this.state.shell_bin,
            if (Environment.isPosix) "-c" else "exec",
            this.config.command,
            null,
        };

        this.start_time = std.time.Instant.now() catch null;
        var spawned: bun.spawn.process.SpawnProcessResult = brk: {
            var arena = std.heap.ArenaAllocator.init(bun.default_allocator);
            defer arena.deinit();
            const original_path = this.state.env.map.get("PATH") orelse "";
            bun.handleOom(this.state.env.map.put("PATH", this.config.PATH));
            defer bun.handleOom(this.state.env.map.put("PATH", original_path));
            const envp = try this.state.env.map.createNullDelimitedEnvMap(arena.allocator());
            break :brk try (try bun.spawn.spawnProcess(&this.options, argv[0..], envp)).unwrap();
        };
        var process = spawned.toProcess(this.state.event_loop, false);

        this.stdout_reader.handle = this;
        this.stderr_reader.handle = this;
        this.stdout_reader.reader.setParent(&this.stdout_reader);
        this.stderr_reader.reader.setParent(&this.stderr_reader);

        if (Environment.isWindows) {
            this.stdout_reader.reader.source = .{ .pipe = this.options.stdout.buffer };
            this.stderr_reader.reader.source = .{ .pipe = this.options.stderr.buffer };
        }

        if (Environment.isPosix) {
            if (spawned.stdout) |stdout_fd| {
                _ = bun.sys.setNonblocking(stdout_fd);
                try this.stdout_reader.reader.start(stdout_fd, true).unwrap();
            }
            if (spawned.stderr) |stderr_fd| {
                _ = bun.sys.setNonblocking(stderr_fd);
                try this.stderr_reader.reader.start(stderr_fd, true).unwrap();
            }
        } else {
            try this.stdout_reader.reader.startWithCurrentPipe().unwrap();
            try this.stderr_reader.reader.startWithCurrentPipe().unwrap();
        }

        this.process = .{ .ptr = process };
        process.setExitHandler(this);

        switch (process.watchOrReap()) {
            .result => {},
            .err => |err| {
                if (!process.hasExited())
                    process.onExit(.{ .err = err }, &std.mem.zeroes(bun.spawn.Rusage));
            },
        }
    }

    pub fn onProcessExit(this: *This, proc: *bun.spawn.Process, status: bun.spawn.Status, _: *const bun.spawn.Rusage) void {
        this.process.?.status = status;
        this.end_time = std.time.Instant.now() catch null;
        _ = proc;
        this.state.processExit(this) catch {};
    }

    pub fn eventLoop(this: *This) *bun.jsc.MiniEventLoop {
        return this.state.event_loop;
    }

    pub fn loop(this: *This) *bun.Async.Loop {
        if (comptime bun.Environment.isWindows) {
            return this.state.event_loop.loop.uv_loop;
        } else {
            return this.state.event_loop.loop;
        }
    }
};

const colors = [_][]const u8{
    "\x1b[36m", // cyan
    "\x1b[33m", // yellow
    "\x1b[35m", // magenta
    "\x1b[32m", // green
    "\x1b[34m", // blue
    "\x1b[31m", // red
};
const reset = "\x1b[0m";

const State = struct {
    const This = @This();

    handles: []ProcessHandle,
    event_loop: *bun.jsc.MiniEventLoop,
    remaining_scripts: usize = 0,
    max_label_len: usize,
    shell_bin: [:0]const u8,
    aborted: bool = false,
    no_exit_on_error: bool,
    env: *bun.DotEnv.Loader,
    use_colors: bool,

    pub fn isDone(this: *This) bool {
        return this.remaining_scripts == 0;
    }

    fn readChunk(this: *This, pipe: *PipeReader, chunk: []const u8) (std.Io.Writer.Error || bun.OOM)!void {
        try pipe.line_buffer.appendSlice(chunk);

        // Route to correct parent stream: child stdout -> parent stdout, child stderr -> parent stderr
        const writer = if (pipe.is_stderr) Output.errorWriter() else Output.writer();

        // Process complete lines
        while (std.mem.indexOfScalar(u8, pipe.line_buffer.items, '\n')) |newline_pos| {
            const line = pipe.line_buffer.items[0 .. newline_pos + 1];
            try this.writeLineWithPrefix(pipe.handle, line, writer);
            // Remove processed line from buffer
            const remaining = pipe.line_buffer.items[newline_pos + 1 ..];
            std.mem.copyForwards(u8, pipe.line_buffer.items[0..remaining.len], remaining);
            pipe.line_buffer.items.len = remaining.len;
        }
    }

    fn writeLineWithPrefix(this: *This, handle: *ProcessHandle, line: []const u8, writer: *std.Io.Writer) std.Io.Writer.Error!void {
        try this.writePrefix(handle, writer);
        try writer.writeAll(line);
    }

    fn writePrefix(this: *This, handle: *ProcessHandle, writer: *std.Io.Writer) std.Io.Writer.Error!void {
        if (this.use_colors) {
            try writer.writeAll(colors[handle.color_idx % colors.len]);
        }

        try writer.writeAll(handle.config.label);
        const padding = this.max_label_len -| handle.config.label.len;
        for (0..padding) |_| {
            try writer.writeByte(' ');
        }

        if (this.use_colors) {
            try writer.writeAll(reset);
        }

        try writer.writeAll(" | ");
    }

    fn flushPipeBuffer(this: *This, handle: *ProcessHandle, pipe: *PipeReader) std.Io.Writer.Error!void {
        if (pipe.line_buffer.items.len > 0) {
            const line = pipe.line_buffer.items;
            const needs_newline = line.len > 0 and line[line.len - 1] != '\n';
            const writer = if (pipe.is_stderr) Output.errorWriter() else Output.writer();
            try this.writeLineWithPrefix(handle, line, writer);
            if (needs_newline) {
                writer.writeAll("\n") catch {};
            }
            pipe.line_buffer.clearRetainingCapacity();
        }
    }

    fn processExit(this: *This, handle: *ProcessHandle) std.Io.Writer.Error!void {
        this.remaining_scripts -= 1;

        // Flush remaining buffers (stdout first, then stderr)
        try this.flushPipeBuffer(handle, &handle.stdout_reader);
        try this.flushPipeBuffer(handle, &handle.stderr_reader);

        // Print exit status to stderr (status messages always go to stderr)
        const writer = Output.errorWriter();
        try this.writePrefix(handle, writer);

        switch (handle.process.?.status) {
            .exited => |exited| {
                if (exited.code != 0) {
                    try writer.print("Exited with code {d}\n", .{exited.code});
                } else {
                    if (handle.start_time != null and handle.end_time != null) {
                        const duration = handle.end_time.?.since(handle.start_time.?);
                        const ms = @as(f64, @floatFromInt(duration)) / 1_000_000.0;
                        if (ms > 1000.0) {
                            try writer.print("Done in {d:.2}s\n", .{ms / 1000.0});
                        } else {
                            try writer.print("Done in {d:.0}ms\n", .{ms});
                        }
                    } else {
                        try writer.writeAll("Done\n");
                    }
                }
            },
            .signaled => |signal| {
                try writer.print("Signaled: {s}\n", .{@tagName(signal)});
            },
            else => {
                try writer.writeAll("Error\n");
            },
        }

        // Check if we should abort on error
        const failed = switch (handle.process.?.status) {
            .exited => |exited| exited.code != 0,
            .signaled => true,
            else => true,
        };

        if (failed and !this.no_exit_on_error) {
            this.abort();
            return;
        }

        if (failed) {
            // Pre->main->post chain is broken -- skip group dependents.
            this.skipDependents(handle.group_dependents.items);
            // But cascade to next-group dependents (sequential --no-exit-on-error).
            if (!this.aborted) {
                this.startDependents(handle.next_dependents.items);
            }
            return;
        }

        // Success: cascade to all dependents
        if (!this.aborted) {
            this.startDependents(handle.group_dependents.items);
            this.startDependents(handle.next_dependents.items);
        }
    }

    fn startDependents(_: *This, dependents: []*ProcessHandle) void {
        for (dependents) |dependent| {
            dependent.remaining_dependencies -= 1;
            if (dependent.remaining_dependencies == 0) {
                dependent.start() catch {
                    Output.prettyErrorln("<r><red>error<r>: Failed to start process", .{});
                    Global.exit(1);
                };
            }
        }
    }

    /// Skip group dependents that will never start because their predecessor
    /// failed. Recursively skip their group dependents too.
    fn skipDependents(this: *This, dependents: []*ProcessHandle) void {
        for (dependents) |dependent| {
            dependent.remaining_dependencies -= 1;
            if (dependent.remaining_dependencies == 0) {
                this.skipDependents(dependent.group_dependents.items);
                // Still cascade next_dependents so sequential chains continue
                if (!this.aborted) {
                    this.startDependents(dependent.next_dependents.items);
                }
            }
        }
    }

    pub fn abort(this: *This) void {
        this.aborted = true;
        for (this.handles) |*handle| {
            if (handle.process) |*proc| {
                if (proc.status == .running) {
                    _ = proc.ptr.kill(std.posix.SIG.INT);
                }
            }
        }
    }

    pub fn finalize(this: *This) u8 {
        for (this.handles) |handle| {
            if (handle.process) |proc| {
                switch (proc.status) {
                    .exited => |exited| {
                        if (exited.code != 0) return exited.code;
                    },
                    .signaled => |signal| return signal.toExitCode() orelse 1,
                    else => return 1,
                }
            }
        }
        return 0;
    }
};

const AbortHandler = struct {
    var should_abort = false;

    fn posixSignalHandler(sig: i32, info: *const std.posix.siginfo_t, _: ?*const anyopaque) callconv(.c) void {
        _ = sig;
        _ = info;
        should_abort = true;
    }

    fn windowsCtrlHandler(dwCtrlType: std.os.windows.DWORD) callconv(.winapi) std.os.windows.BOOL {
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
                .mask = std.posix.sigemptyset(),
                .flags = std.posix.SA.SIGINFO | std.posix.SA.RESTART | std.posix.SA.RESETHAND,
            };
            std.posix.sigaction(std.posix.SIG.INT, &action, null);
        } else {
            const res = bun.c.SetConsoleCtrlHandler(windowsCtrlHandler, std.os.windows.TRUE);
            if (res == 0) {
                if (Environment.isDebug) {
                    Output.warn("Failed to set abort handler\n", .{});
                }
            }
        }
    }

    pub fn uninstall() void {
        if (Environment.isWindows) {
            _ = bun.c.SetConsoleCtrlHandler(null, std.os.windows.FALSE);
        }
    }
};

/// Simple glob matching: `*` matches any sequence of characters.
fn matchesGlob(pattern: []const u8, name: []const u8) bool {
    var pi: usize = 0;
    var ni: usize = 0;
    var star_pi: usize = 0;
    var star_ni: usize = 0;
    var have_star = false;

    while (ni < name.len or pi < pattern.len) {
        if (pi < pattern.len and pattern[pi] == '*') {
            have_star = true;
            star_pi = pi;
            star_ni = ni;
            pi += 1;
        } else if (pi < pattern.len and ni < name.len and pattern[pi] == name[ni]) {
            pi += 1;
            ni += 1;
        } else if (have_star) {
            pi = star_pi + 1;
            star_ni += 1;
            ni = star_ni;
            if (ni > name.len) return false;
        } else {
            return false;
        }
    }
    return true;
}

/// Add configs for a single script name (with pre/post handling).
/// When `label_prefix` is non-null, labels become "{prefix}:{name}" (for workspace runs).
fn addScriptConfigs(
    configs: *std.array_list.Managed(ScriptConfig),
    group_infos: *std.array_list.Managed(GroupInfo),
    raw_name: []const u8,
    scripts_map: ?*const bun.StringArrayHashMap([]const u8),
    allocator: std.mem.Allocator,
    cwd: []const u8,
    PATH: []const u8,
    label_prefix: ?[]const u8,
) !void {
    const group_start = configs.items.len;

    const label = if (label_prefix) |prefix|
        try std.fmt.allocPrint(allocator, "{s}:{s}", .{ prefix, raw_name })
    else
        raw_name;

    const script_content = if (scripts_map) |sm| sm.get(raw_name) else null;

    if (script_content) |content| {
        // It's a package.json script - check for pre/post
        const pre_name = try std.fmt.allocPrint(allocator, "pre{s}", .{raw_name});
        const post_name = try std.fmt.allocPrint(allocator, "post{s}", .{raw_name});

        const pre_content = if (scripts_map) |sm| sm.get(pre_name) else null;
        const post_content = if (scripts_map) |sm| sm.get(post_name) else null;

        if (pre_content) |pc| {
            var cmd_buf = try std.array_list.Managed(u8).initCapacity(allocator, pc.len + 1);
            try RunCommand.replacePackageManagerRun(&cmd_buf, pc);
            try cmd_buf.append(0);
            try configs.append(.{
                .label = label,
                .command = cmd_buf.items[0 .. cmd_buf.items.len - 1 :0],
                .cwd = cwd,
                .PATH = PATH,
            });
        }

        // Main script
        {
            var cmd_buf = try std.array_list.Managed(u8).initCapacity(allocator, content.len + 1);
            try RunCommand.replacePackageManagerRun(&cmd_buf, content);
            try cmd_buf.append(0);
            try configs.append(.{
                .label = label,
                .command = cmd_buf.items[0 .. cmd_buf.items.len - 1 :0],
                .cwd = cwd,
                .PATH = PATH,
            });
        }

        if (post_content) |pc| {
            var cmd_buf = try std.array_list.Managed(u8).initCapacity(allocator, pc.len + 1);
            try RunCommand.replacePackageManagerRun(&cmd_buf, pc);
            try cmd_buf.append(0);
            try configs.append(.{
                .label = label,
                .command = cmd_buf.items[0 .. cmd_buf.items.len - 1 :0],
                .cwd = cwd,
                .PATH = PATH,
            });
        }
    } else {
        // Not a package.json script - run as a raw command
        // If it looks like a file path, prefix with bun executable
        const is_file = raw_name.len > 0 and (raw_name[0] == '.' or raw_name[0] == '/' or
            (Environment.isWindows and raw_name[0] == '\\') or hasRunnableExtension(raw_name));
        const command_z = if (is_file) brk: {
            const bun_path = bun.selfExePath() catch "bun";
            // Quote the bun path so that backslashes on Windows are not
            // interpreted as escape characters by `bun exec` (Bun's shell).
            const cmd_str = try std.fmt.allocPrint(allocator, "\"{s}\" {s}" ++ "\x00", .{ bun_path, raw_name });
            break :brk cmd_str[0 .. cmd_str.len - 1 :0];
        } else try allocator.dupeZ(u8, raw_name);
        try configs.append(.{
            .label = label,
            .command = command_z,
            .cwd = cwd,
            .PATH = PATH,
        });
    }

    try group_infos.append(.{
        .start = group_start,
        .count = configs.items.len - group_start,
    });
}

const GroupInfo = struct { start: usize, count: usize };

pub fn run(ctx: Command.Context) !noreturn {
    // Validate flags
    if (ctx.parallel and ctx.sequential) {
        Output.prettyErrorln("<r><red>error<r>: --parallel and --sequential cannot be used together", .{});
        Global.exit(1);
    }

    // Collect script names from positionals + passthrough
    // For RunCommand: positionals[0] is "run", skip it. For AutoCommand: no "run" prefix.
    var script_names = std.array_list.Managed([]const u8).init(ctx.allocator);

    var positionals = ctx.positionals;
    if (positionals.len > 0 and (strings.eqlComptime(positionals[0], "run") or strings.eqlComptime(positionals[0], "r"))) {
        positionals = positionals[1..];
    }
    for (positionals) |pos| {
        if (pos.len > 0) {
            try script_names.append(pos);
        }
    }
    for (ctx.passthrough) |pt| {
        if (pt.len > 0) {
            try script_names.append(pt);
        }
    }

    if (script_names.items.len == 0) {
        Output.prettyErrorln("<r><red>error<r>: --parallel/--sequential requires at least one script name", .{});
        Global.exit(1);
    }

    // Set up the transpiler/environment
    const fsinstance = try bun.fs.FileSystem.init(null);
    var this_transpiler: transpiler.Transpiler = undefined;
    _ = try RunCommand.configureEnvForRun(ctx, &this_transpiler, null, true, false);
    const cwd = fsinstance.top_level_dir;

    const event_loop = bun.jsc.MiniEventLoop.initGlobal(this_transpiler.env, null);
    const shell_bin: [:0]const u8 = if (Environment.isPosix)
        RunCommand.findShell(this_transpiler.env.get("PATH") orelse "", cwd) orelse return error.MissingShell
    else
        bun.selfExePath() catch return error.MissingShell;

    // Build ScriptConfigs and ProcessHandles
    // Each script name can produce up to 3 handles (pre, main, post)
    var configs = std.array_list.Managed(ScriptConfig).init(ctx.allocator);
    var group_infos = std.array_list.Managed(GroupInfo).init(ctx.allocator);

    if (ctx.filters.len > 0 or ctx.workspaces) {
        // Workspace-aware mode: iterate over matching workspace packages
        var filters_to_use = ctx.filters;
        if (ctx.workspaces) {
            filters_to_use = &.{"*"};
        }

        var filter_instance = try FilterArg.FilterSet.init(ctx.allocator, filters_to_use, cwd);
        var patterns = std.array_list.Managed([]u8).init(ctx.allocator);

        var root_buf: bun.PathBuffer = undefined;
        const resolve_root = try FilterArg.getCandidatePackagePatterns(ctx.allocator, ctx.log, &patterns, cwd, &root_buf);

        var package_json_iter = try FilterArg.PackageFilterIterator.init(ctx.allocator, patterns.items, resolve_root);
        defer package_json_iter.deinit();

        // Phase 1: Collect matching packages (filesystem order is nondeterministic)
        const MatchedPackage = struct {
            name: []const u8,
            dirpath: []const u8,
            scripts: *const bun.StringArrayHashMap([]const u8),
            PATH: []const u8,
        };
        var matched_packages = std.array_list.Managed(MatchedPackage).init(ctx.allocator);

        while (try package_json_iter.next()) |package_json_path| {
            const dirpath = try ctx.allocator.dupe(u8, std.fs.path.dirname(package_json_path) orelse Global.crash());
            const path = bun.strings.withoutTrailingSlash(dirpath);

            // When using --workspaces, skip the root package to prevent recursion
            if (ctx.workspaces and strings.eql(path, resolve_root)) {
                continue;
            }

            const pkgjson = bun.PackageJSON.parse(&this_transpiler.resolver, dirpath, .invalid, null, .include_scripts, .main) orelse {
                continue;
            };

            if (!filter_instance.matches(path, pkgjson.name))
                continue;

            const pkg_scripts = pkgjson.scripts orelse continue;
            const pkg_PATH = try RunCommand.configurePathForRunWithPackageJsonDir(ctx, dirpath, &this_transpiler, null, dirpath, ctx.debug.run_in_bun);
            const pkg_name = if (pkgjson.name.len > 0)
                pkgjson.name
            else
                // Fallback: use relative path from workspace root
                try ctx.allocator.dupe(u8, bun.path.relativePlatform(resolve_root, path, .posix, false));

            try matched_packages.append(.{
                .name = pkg_name,
                .dirpath = dirpath,
                .scripts = pkg_scripts,
                .PATH = pkg_PATH,
            });
        }

        // Phase 2: Sort by package name, then by path as tiebreaker for deterministic ordering
        std.mem.sort(MatchedPackage, matched_packages.items, {}, struct {
            fn lessThan(_: void, a: MatchedPackage, b: MatchedPackage) bool {
                const name_order = std.mem.order(u8, a.name, b.name);
                if (name_order != .eq) return name_order == .lt;
                return std.mem.order(u8, a.dirpath, b.dirpath) == .lt;
            }
        }.lessThan);

        // Phase 3: Build configs from sorted packages
        for (matched_packages.items) |pkg| {
            for (script_names.items) |raw_name| {
                if (std.mem.indexOfScalar(u8, raw_name, '*') != null) {
                    // Glob: expand against this package's scripts
                    var matches = std.array_list.Managed([]const u8).init(ctx.allocator);
                    for (pkg.scripts.keys()) |key| {
                        if (matchesGlob(raw_name, key)) {
                            try matches.append(key);
                        }
                    }
                    std.mem.sort([]const u8, matches.items, {}, struct {
                        fn lessThan(_: void, a: []const u8, b: []const u8) bool {
                            return std.mem.order(u8, a, b) == .lt;
                        }
                    }.lessThan);
                    for (matches.items) |matched_name| {
                        try addScriptConfigs(&configs, &group_infos, matched_name, pkg.scripts, ctx.allocator, pkg.dirpath, pkg.PATH, pkg.name);
                    }
                } else {
                    if (pkg.scripts.get(raw_name) != null) {
                        try addScriptConfigs(&configs, &group_infos, raw_name, pkg.scripts, ctx.allocator, pkg.dirpath, pkg.PATH, pkg.name);
                    } else if (ctx.workspaces and !ctx.if_present) {
                        Output.prettyErrorln("<r><red>error<r>: Missing \"{s}\" script in package \"{s}\"", .{ raw_name, pkg.name });
                        Global.exit(1);
                    }
                }
            }
        }

        if (configs.items.len == 0) {
            if (ctx.if_present) {
                Global.exit(0);
            }
            if (ctx.workspaces) {
                Output.prettyErrorln("<r><red>error<r>: No workspace packages have matching scripts", .{});
            } else {
                Output.prettyErrorln("<r><red>error<r>: No packages matched the filter", .{});
            }
            Global.exit(1);
        }
    } else {
        // Single-package mode: use the root package.json
        const PATH = try RunCommand.configurePathForRunWithPackageJsonDir(ctx, "", &this_transpiler, null, cwd, ctx.debug.run_in_bun);

        // Load package.json scripts
        const root_dir_info = this_transpiler.resolver.readDirInfo(cwd) catch {
            Output.prettyErrorln("<r><red>error<r>: Failed to read directory", .{});
            Global.exit(1);
        } orelse {
            Output.prettyErrorln("<r><red>error<r>: Failed to read directory", .{});
            Global.exit(1);
        };

        const package_json = root_dir_info.enclosing_package_json;
        const scripts_map: ?*const bun.StringArrayHashMap([]const u8) = if (package_json) |pkg| pkg.scripts else null;

        for (script_names.items) |raw_name| {
            // Check if this is a glob pattern
            if (std.mem.indexOfScalar(u8, raw_name, '*') != null) {
                if (scripts_map) |sm| {
                    // Collect matching script names
                    var matches = std.array_list.Managed([]const u8).init(ctx.allocator);
                    for (sm.keys()) |key| {
                        if (matchesGlob(raw_name, key)) {
                            try matches.append(key);
                        }
                    }

                    // Sort alphabetically
                    std.mem.sort([]const u8, matches.items, {}, struct {
                        fn lessThan(_: void, a: []const u8, b: []const u8) bool {
                            return std.mem.order(u8, a, b) == .lt;
                        }
                    }.lessThan);

                    if (matches.items.len == 0) {
                        Output.prettyErrorln("<r><red>error<r>: No scripts match pattern \"{s}\"", .{raw_name});
                        Global.exit(1);
                    }

                    for (matches.items) |matched_name| {
                        try addScriptConfigs(&configs, &group_infos, matched_name, scripts_map, ctx.allocator, cwd, PATH, null);
                    }
                } else {
                    Output.prettyErrorln("<r><red>error<r>: Cannot use glob pattern \"{s}\" without package.json scripts", .{raw_name});
                    Global.exit(1);
                }
            } else {
                try addScriptConfigs(&configs, &group_infos, raw_name, scripts_map, ctx.allocator, cwd, PATH, null);
            }
        }
    }

    if (configs.items.len == 0) {
        Output.prettyErrorln("<r><red>error<r>: No scripts to run", .{});
        Global.exit(1);
    }

    // Compute max label width
    var max_label_len: usize = 0;
    for (configs.items) |*config| {
        if (config.label.len > max_label_len) {
            max_label_len = config.label.len;
        }
    }

    const use_colors = Output.enable_ansi_colors_stderr;

    var state = State{
        .handles = try ctx.allocator.alloc(ProcessHandle, configs.items.len),
        .event_loop = event_loop,
        .max_label_len = max_label_len,
        .shell_bin = shell_bin,
        .no_exit_on_error = ctx.no_exit_on_error,
        .env = this_transpiler.env,
        .use_colors = use_colors,
    };

    // Initialize handles
    for (configs.items, 0..) |*config, i| {
        // Find which group this belongs to, for color assignment
        var color_idx: usize = 0;
        for (group_infos.items, 0..) |group, gi| {
            if (i >= group.start and i < group.start + group.count) {
                color_idx = gi;
                break;
            }
        }

        state.handles[i] = ProcessHandle{
            .state = &state,
            .config = config,
            .color_idx = color_idx,
            .options = .{
                .stdin = .ignore,
                .stdout = if (Environment.isPosix) .buffer else .{ .buffer = bun.new(bun.windows.libuv.Pipe, std.mem.zeroes(bun.windows.libuv.Pipe)) },
                .stderr = if (Environment.isPosix) .buffer else .{ .buffer = bun.new(bun.windows.libuv.Pipe, std.mem.zeroes(bun.windows.libuv.Pipe)) },
                .cwd = config.cwd,
                .windows = if (Environment.isWindows) .{ .loop = bun.jsc.EventLoopHandle.init(event_loop) },
                .stream = true,
            },
        };
    }

    // Set up pre->main->post chaining within each group
    for (group_infos.items) |group| {
        if (group.count > 1) {
            var j: usize = group.start;
            while (j < group.start + group.count - 1) : (j += 1) {
                try state.handles[j].group_dependents.append(&state.handles[j + 1]);
                state.handles[j + 1].remaining_dependencies += 1;
            }
        }
    }

    // For sequential mode, chain groups together
    if (ctx.sequential) {
        var gi: usize = 0;
        while (gi < group_infos.items.len - 1) : (gi += 1) {
            const current_group = group_infos.items[gi];
            const next_group = group_infos.items[gi + 1];
            // Last handle of current group -> first handle of next group
            const last_in_current = current_group.start + current_group.count - 1;
            const first_in_next = next_group.start;
            try state.handles[last_in_current].next_dependents.append(&state.handles[first_in_next]);
            state.handles[first_in_next].remaining_dependencies += 1;
        }
    }

    // Start handles with no dependencies
    for (state.handles) |*handle| {
        if (handle.remaining_dependencies == 0) {
            handle.start() catch {
                Output.prettyErrorln("<r><red>error<r>: Failed to start process", .{});
                Global.exit(1);
            };
        }
    }

    AbortHandler.install();

    while (!state.isDone()) {
        if (AbortHandler.should_abort and !state.aborted) {
            AbortHandler.uninstall();
            state.abort();
        }
        event_loop.tickOnce(&state);
    }

    const status = state.finalize();
    Global.exit(status);
}

fn hasRunnableExtension(name: []const u8) bool {
    const ext = std.fs.path.extension(name);
    const loader = bun.options.defaultLoaders.get(ext) orelse return false;
    return loader.canBeRunByBun();
}

const FilterArg = @import("./filter_arg.zig");
const std = @import("std");
const RunCommand = @import("./run_command.zig").RunCommand;

const bun = @import("bun");
const Environment = bun.Environment;
const Global = bun.Global;
const Output = bun.Output;
const strings = bun.strings;
const transpiler = bun.transpiler;

const CLI = bun.cli;
const Command = CLI.Command;
