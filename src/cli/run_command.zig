const bun = @import("root").bun;
const Async = bun.Async;
const string = bun.string;
const Output = bun.Output;
const Global = bun.Global;
const Environment = bun.Environment;
const strings = bun.strings;
const MutableString = bun.MutableString;
const stringZ = bun.stringZ;
const default_allocator = bun.default_allocator;
const C = bun.C;
const std = @import("std");
const uws = bun.uws;
const JSC = bun.JSC;
const WaiterThread = JSC.Subprocess.WaiterThread;
const OOM = bun.OOM;

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
const transpiler = bun.transpiler;

const DotEnv = @import("../env_loader.zig");
const which = @import("../which.zig").which;
const Run = @import("../bun_js.zig").Run;
var path_buf: bun.PathBuffer = undefined;
var path_buf2: bun.PathBuffer = undefined;
const NpmArgs = struct {
    // https://github.com/npm/rfcs/blob/main/implemented/0021-reduce-lifecycle-script-environment.md#detailed-explanation
    pub const package_name: string = "npm_package_name";
    pub const package_version: string = "npm_package_version";
};
const PackageJSON = @import("../resolver/package_json.zig").PackageJSON;
const yarn_commands = @import("./list-of-yarn-commands.zig").all_yarn_commands;

const ShellCompletions = @import("./shell_completions.zig");
const PosixSpawn = bun.posix.spawn;

const PackageManager = @import("../install/install.zig").PackageManager;
const Lockfile = @import("../install/lockfile.zig");

const LifecycleScriptSubprocess = bun.install.LifecycleScriptSubprocess;

const windows = std.os.windows;

pub const RunCommand = struct {
    const shells_to_search = &[_]string{
        "bash",
        "sh",
        "zsh",
    };

    fn findShellImpl(PATH: string, cwd: string) ?stringZ {
        if (comptime Environment.isWindows) {
            return "C:\\Windows\\System32\\cmd.exe";
        }

        inline for (shells_to_search) |shell| {
            if (which(&path_buf, PATH, cwd, shell)) |shell_| {
                return shell_;
            }
        }

        const Try = struct {
            pub fn shell(str: stringZ) bool {
                return bun.sys.isExecutableFilePath(str);
            }
        };

        const hardcoded_popular_ones = [_]stringZ{
            "/bin/bash",
            "/usr/bin/bash",
            "/usr/local/bin/bash", // don't think this is a real one
            "/bin/sh",
            "/usr/bin/sh", // don't think this is a real one
            "/usr/bin/zsh",
            "/usr/local/bin/zsh",
        };
        inline for (hardcoded_popular_ones) |shell| {
            if (Try.shell(shell)) {
                return shell;
            }
        }

        return null;
    }

    /// Find the "best" shell to use
    /// Cached to only run once
    pub fn findShell(PATH: string, cwd: string) ?stringZ {
        const bufs = struct {
            pub var shell_buf_once: bun.PathBuffer = undefined;
            pub var found_shell: [:0]const u8 = "";
        };
        if (bufs.found_shell.len > 0) {
            return bufs.found_shell;
        }

        if (findShellImpl(PATH, cwd)) |found| {
            if (found.len < bufs.shell_buf_once.len) {
                @memcpy(bufs.shell_buf_once[0..found.len], found);
                bufs.shell_buf_once[found.len] = 0;
                bufs.found_shell = bufs.shell_buf_once[0..found.len :0];
                return bufs.found_shell;
            }

            return found;
        }

        return null;
    }

    const BUN_BIN_NAME = if (Environment.isDebug) "bun-debug" else "bun";
    const BUN_RUN = std.fmt.comptimePrint("{s} run", .{BUN_BIN_NAME});

    const BUN_RUN_USING_BUN = std.fmt.comptimePrint("{s} --bun run", .{BUN_BIN_NAME});

    // Look for invocations of any:
    // - yarn run
    // - yarn $cmdName
    // - pnpm run
    // - npm run
    // Replace them with "bun run"

    pub inline fn replacePackageManagerRun(
        copy_script: *std.ArrayList(u8),
        script: string,
    ) OOM!void {
        var entry_i: usize = 0;
        var delimiter: u8 = ' ';

        while (entry_i < script.len) {
            const start = entry_i;

            switch (script[entry_i]) {
                'y' => {
                    if (delimiter > 0) {
                        const remainder = script[start..];
                        if (strings.hasPrefixComptime(remainder, "yarn ")) {
                            const next = remainder["yarn ".len..];
                            // We have yarn
                            // Find the next space
                            if (strings.indexOfChar(next, ' ')) |space| {
                                const yarn_cmd = next[0..space];
                                if (strings.eqlComptime(yarn_cmd, "run")) {
                                    try copy_script.appendSlice(BUN_RUN);
                                    entry_i += "yarn run".len;
                                    continue;
                                }

                                // yarn npm is a yarn 2 subcommand
                                if (strings.eqlComptime(yarn_cmd, "npm")) {
                                    entry_i += "yarn npm ".len;
                                    try copy_script.appendSlice("yarn npm ");
                                    continue;
                                }

                                if (strings.startsWith(yarn_cmd, "-")) {
                                    // Skip the rest of the command
                                    entry_i += "yarn ".len + yarn_cmd.len;
                                    try copy_script.appendSlice("yarn ");
                                    try copy_script.appendSlice(yarn_cmd);
                                    continue;
                                }

                                // implicit yarn commands
                                if (!yarn_commands.has(yarn_cmd)) {
                                    try copy_script.appendSlice(BUN_RUN);
                                    try copy_script.append(' ');
                                    try copy_script.appendSlice(yarn_cmd);
                                    entry_i += "yarn ".len + yarn_cmd.len;
                                    delimiter = 0;
                                    continue;
                                }
                            }
                        }
                    }

                    delimiter = 0;
                },

                ' ' => {
                    delimiter = ' ';
                },
                '"' => {
                    delimiter = '"';
                },
                '\'' => {
                    delimiter = '\'';
                },

                'n' => {
                    if (delimiter > 0) {
                        if (strings.hasPrefixComptime(script[start..], "npm run ")) {
                            try copy_script.appendSlice(BUN_RUN ++ " ");
                            entry_i += "npm run ".len;
                            delimiter = 0;
                            continue;
                        }

                        if (strings.hasPrefixComptime(script[start..], "npx ")) {
                            try copy_script.appendSlice(BUN_BIN_NAME ++ " x ");
                            entry_i += "npx ".len;
                            delimiter = 0;
                            continue;
                        }
                    }

                    delimiter = 0;
                },
                'p' => {
                    if (delimiter > 0) {
                        if (strings.hasPrefixComptime(script[start..], "pnpm run ")) {
                            try copy_script.appendSlice(BUN_RUN ++ " ");
                            entry_i += "pnpm run ".len;
                            delimiter = 0;
                            continue;
                        }
                        if (strings.hasPrefixComptime(script[start..], "pnpm dlx ")) {
                            try copy_script.appendSlice(BUN_BIN_NAME ++ " x ");
                            entry_i += "pnpm dlx ".len;
                            delimiter = 0;
                            continue;
                        }
                        if (strings.hasPrefixComptime(script[start..], "pnpx ")) {
                            try copy_script.appendSlice(BUN_BIN_NAME ++ " x ");
                            entry_i += "pnpx ".len;
                            delimiter = 0;
                            continue;
                        }
                    }

                    delimiter = 0;
                },
                else => {
                    delimiter = 0;
                },
            }

            try copy_script.append(script[entry_i]);
            entry_i += 1;
        }
    }

    const log = Output.scoped(.RUN, false);

    pub fn runPackageScriptForeground(
        ctx: Command.Context,
        allocator: std.mem.Allocator,
        original_script: string,
        name: string,
        cwd: string,
        env: *DotEnv.Loader,
        passthrough: []const string,
        silent: bool,
        use_system_shell: bool,
    ) !void {
        const shell_bin = findShell(env.get("PATH") orelse "", cwd) orelse return error.MissingShell;
        env.map.put("npm_lifecycle_event", name) catch unreachable;
        env.map.put("npm_lifecycle_script", original_script) catch unreachable;

        var copy_script_capacity: usize = original_script.len;
        for (passthrough) |part| copy_script_capacity += 1 + part.len;
        var copy_script = try std.ArrayList(u8).initCapacity(allocator, copy_script_capacity);

        // We're going to do this slowly.
        // Find exact matches of yarn, pnpm, npm

        try replacePackageManagerRun(&copy_script, original_script);

        for (passthrough) |part| {
            try copy_script.append(' ');
            if (bun.shell.needsEscapeUtf8AsciiLatin1(part)) {
                try bun.shell.escape8Bit(part, &copy_script, true);
            } else {
                try copy_script.appendSlice(part);
            }
        }

        log("Script: \"{s}\"", .{copy_script.items});

        if (!silent) {
            Output.command(copy_script.items);
            Output.flush();
        }

        if (!use_system_shell) {
            const mini = bun.JSC.MiniEventLoop.initGlobal(env);
            const code = bun.shell.Interpreter.initAndRunFromSource(ctx, mini, name, copy_script.items, cwd) catch |err| {
                if (!silent) {
                    Output.prettyErrorln("<r><red>error<r>: Failed to run script <b>{s}<r> due to error <b>{s}<r>", .{ name, @errorName(err) });
                }

                Global.exit(1);
            };

            if (code > 0) {
                if (code != 2 and !silent) {
                    Output.prettyErrorln("<r><red>error<r><d>:<r> script <b>\"{s}\"<r> exited with code {d}<r>", .{ name, code });
                    Output.flush();
                }

                Global.exit(code);
            }

            return;
        }

        const argv = [_]string{
            shell_bin,
            if (Environment.isWindows) "/c" else "-c",
            copy_script.items,
        };

        const ipc_fd = if (!Environment.isWindows) blk: {
            const node_ipc_fd = bun.getenvZ("NODE_CHANNEL_FD") orelse break :blk null;
            const fd = std.fmt.parseInt(u32, node_ipc_fd, 10) catch break :blk null;
            break :blk bun.toFD(@as(i32, @intCast(fd)));
        } else null; // TODO: implement on Windows

        const spawn_result = switch ((bun.spawnSync(&.{
            .argv = &argv,
            .argv0 = shell_bin.ptr,

            // TODO: remember to free this when we add --filter or --concurrent
            // in the meantime we don't need to free it.
            .envp = try env.map.createNullDelimitedEnvMap(bun.default_allocator),

            .cwd = cwd,
            .stderr = .inherit,
            .stdout = .inherit,
            .stdin = .inherit,
            .ipc = ipc_fd,

            .windows = if (Environment.isWindows) .{
                .loop = JSC.EventLoopHandle.init(JSC.MiniEventLoop.initGlobal(env)),
            },
        }) catch |err| {
            if (!silent) {
                Output.prettyErrorln("<r><red>error<r>: Failed to run script <b>{s}<r> due to error <b>{s}<r>", .{ name, @errorName(err) });
            }

            Output.flush();
            return;
        })) {
            .err => |err| {
                if (!silent) {
                    Output.prettyErrorln("<r><red>error<r>: Failed to run script <b>{s}<r> due to error:\n{}", .{ name, err });
                }

                Output.flush();
                return;
            },
            .result => |result| result,
        };

        switch (spawn_result.status) {
            .exited => |exit_code| {
                if (exit_code.signal.valid() and exit_code.signal != .SIGINT and !silent) {
                    Output.prettyErrorln("<r><red>error<r><d>:<r> script <b>\"{s}\"<r> was terminated by signal {}<r>", .{ name, exit_code.signal.fmt(Output.enable_ansi_colors_stderr) });
                    Output.flush();

                    Global.raiseIgnoringPanicHandler(exit_code.signal);
                }

                if (exit_code.code != 0) {
                    if (exit_code.code != 2 and !silent) {
                        Output.prettyErrorln("<r><red>error<r><d>:<r> script <b>\"{s}\"<r> exited with code {d}<r>", .{ name, exit_code.code });
                        Output.flush();
                    }

                    Global.exit(exit_code.code);
                }
            },

            .signaled => |signal| {
                if (signal.valid() and signal != .SIGINT and !silent) {
                    Output.prettyErrorln("<r><red>error<r><d>:<r> script <b>\"{s}\"<r> was terminated by signal {}<r>", .{ name, signal.fmt(Output.enable_ansi_colors_stderr) });
                    Output.flush();
                }
                Global.raiseIgnoringPanicHandler(signal);
            },

            .err => |err| {
                if (!silent) {
                    Output.prettyErrorln("<r><red>error<r>: Failed to run script <b>{s}<r> due to error:\n{}", .{ name, err });
                }

                Output.flush();
                return;
            },

            else => {},
        }

        return;
    }

    /// When printing error messages from 'bun run', attribute bun overridden node.js to bun
    /// This prevents '"node" exited with ...' when it was actually bun.
    /// As of writing this is only used for 'runBinary'
    fn basenameOrBun(str: []const u8) []const u8 {
        // The full path is not used here, because on windows it is dependant on the
        // username. Before windows we checked bun_node_dir, but this is not allowed on Windows.
        if (strings.hasSuffixComptime(str, "/bun-node/node" ++ bun.exe_suffix) or (Environment.isWindows and strings.hasSuffixComptime(str, "\\bun-node\\node" ++ bun.exe_suffix))) {
            return "bun";
        }
        return std.fs.path.basename(str);
    }

    /// On windows, this checks for a `.bunx` file in the same directory as the
    /// script If it exists, it will be run instead of the script which is
    /// assumed to `bun_shim_impl.exe`
    ///
    /// This function only returns if an error starting the process is
    /// encountered, most other errors are handled by printing and exiting.
    pub fn runBinary(
        ctx: Command.Context,
        executable: []const u8,
        executableZ: [:0]const u8,
        cwd: string,
        env: *DotEnv.Loader,
        passthrough: []const string,
        original_script_for_bun_run: ?[]const u8,
    ) !noreturn {
        // Attempt to find a ".bunx" file on disk, and run it, skipping the
        // wrapper exe.  we build the full exe path even though we could do
        // a relative lookup, because in the case we do find it, we have to
        // generate this full path anyways.
        if (Environment.isWindows and bun.FeatureFlags.windows_bunx_fast_path and bun.strings.hasSuffixComptime(executable, ".exe")) {
            bun.assert(std.fs.path.isAbsolute(executable));

            // Using @constCast is safe because we know that
            // `direct_launch_buffer` is the data destination that assumption is
            // backed by the immediate assertion.
            var wpath = @constCast(bun.strings.toNTPath(&BunXFastPath.direct_launch_buffer, executable));
            bun.assert(bun.isSliceInBufferT(u16, wpath, &BunXFastPath.direct_launch_buffer));

            bun.assert(wpath.len > bun.windows.nt_object_prefix.len + ".exe".len);
            wpath.len += ".bunx".len - ".exe".len;
            @memcpy(wpath[wpath.len - "bunx".len ..], comptime bun.strings.w("bunx"));

            BunXFastPath.tryLaunch(ctx, wpath, env, passthrough);
        }

        try runBinaryWithoutBunxPath(
            ctx,
            executable,
            executableZ,
            cwd,
            env,
            passthrough,
            original_script_for_bun_run,
        );
    }

    fn runBinaryGenericError(executable: []const u8, silent: bool, err: bun.sys.Error) noreturn {
        if (!silent) {
            Output.prettyErrorln("<r><red>error<r>: Failed to run \"<b>{s}<r>\" due to:\n{}", .{ basenameOrBun(executable), err.withPath(executable) });
        }

        Global.exit(1);
    }

    fn runBinaryWithoutBunxPath(
        ctx: Command.Context,
        executable: []const u8,
        executableZ: [*:0]const u8,
        cwd: string,
        env: *DotEnv.Loader,
        passthrough: []const string,
        original_script_for_bun_run: ?[]const u8,
    ) !noreturn {
        var argv_ = [_]string{executable};
        var argv: []const string = &argv_;

        if (passthrough.len > 0) {
            var array_list = std.ArrayList(string).init(ctx.allocator);
            try array_list.append(executable);
            try array_list.appendSlice(passthrough);
            argv = try array_list.toOwnedSlice();
        }

        const silent = ctx.debug.silent;
        const spawn_result = bun.spawnSync(&.{
            .argv = argv,
            .argv0 = executableZ,

            // TODO: remember to free this when we add --filter or --concurrent
            // in the meantime we don't need to free it.
            .envp = try env.map.createNullDelimitedEnvMap(bun.default_allocator),

            .cwd = cwd,
            .stderr = .inherit,
            .stdout = .inherit,
            .stdin = .inherit,
            .use_execve_on_macos = silent,

            .windows = if (Environment.isWindows) .{
                .loop = JSC.EventLoopHandle.init(JSC.MiniEventLoop.initGlobal(env)),
            },
        }) catch |err| {
            bun.handleErrorReturnTrace(err, @errorReturnTrace());

            // an error occurred before the process was spawned
            print_error: {
                if (!silent) {
                    if (comptime Environment.isPosix) {
                        switch (bun.sys.stat(executable[0.. :0])) {
                            .result => |stat| {
                                if (bun.S.ISDIR(stat.mode)) {
                                    Output.prettyErrorln("<r><red>error<r>: Failed to run directory \"<b>{s}<r>\"\n", .{basenameOrBun(executable)});
                                    break :print_error;
                                }
                            },
                            .err => |err2| {
                                switch (err2.getErrno()) {
                                    .NOENT, .PERM, .NOTDIR => {
                                        Output.prettyErrorln("<r><red>error<r>: Failed to run \"<b>{s}<r>\" due to error:\n{}", .{ basenameOrBun(executable), err2 });
                                        break :print_error;
                                    },
                                    else => {},
                                }
                            },
                        }
                    }

                    Output.prettyErrorln("<r><red>error<r>: Failed to run \"<b>{s}<r>\" due to <r><red>{s}<r>", .{ basenameOrBun(executable), @errorName(err) });
                }
            }
            Global.exit(1);
        };

        switch (spawn_result) {
            .err => |err| {
                // an error occurred while spawning the process
                runBinaryGenericError(executable, silent, err);
            },
            .result => |result| {
                switch (result.status) {
                    // An error occurred after the process was spawned.
                    .err => |err| {
                        runBinaryGenericError(executable, silent, err);
                    },

                    .signaled => |signal| {
                        if (signal.valid() and signal != .SIGINT and !silent) {
                            Output.prettyErrorln("<r><red>error<r>: Failed to run \"<b>{s}<r>\" due to signal <b>{s}<r>", .{
                                basenameOrBun(executable),
                                signal.name() orelse "unknown",
                            });
                        }

                        Global.raiseIgnoringPanicHandler(signal);
                    },

                    .exited => |exit_code| {
                        // A process can be both signaled and exited
                        if (exit_code.signal.valid()) {
                            if (!silent) {
                                Output.prettyErrorln("<r><red>error<r>: \"<b>{s}<r>\" exited with signal <b>{s}<r>", .{
                                    basenameOrBun(executable),
                                    exit_code.signal.name() orelse "unknown",
                                });
                            }

                            Global.raiseIgnoringPanicHandler(exit_code.signal);
                        }

                        const code = exit_code.code;
                        if (code != 0) {
                            if (!silent) {
                                const is_probably_trying_to_run_a_pkg_script =
                                    original_script_for_bun_run != null and
                                    ((code == 1 and bun.strings.eqlComptime(original_script_for_bun_run.?, "test")) or
                                        (code == 2 and bun.strings.eqlAnyComptime(original_script_for_bun_run.?, &.{
                                            "install",
                                            "kill",
                                            "link",
                                        }) and ctx.positionals.len == 1));

                                if (is_probably_trying_to_run_a_pkg_script) {
                                    // if you run something like `bun run test`, you get a confusing message because
                                    // you don't usually think about your global path, let alone "/bin/test"
                                    //
                                    // test exits with code 1, the other ones i listed exit with code 2
                                    //
                                    // so for these script names, print the entire exe name.
                                    Output.errGeneric("\"<b>{s}<r>\" exited with code {d}", .{ executable, code });
                                    Output.note("a package.json script \"{s}\" was not found", .{original_script_for_bun_run.?});
                                }
                                // 128 + 2 is the exit code of a process killed by SIGINT, which is caused by CTRL + C
                                else if (code > 0 and code != 130) {
                                    Output.errGeneric("\"<b>{s}<r>\" exited with code {d}", .{ basenameOrBun(executable), code });
                                } else {
                                    Output.prettyErrorln("<r><red>error<r>: Failed to run \"<b>{s}<r>\" due to exit code <b>{d}<r>", .{
                                        basenameOrBun(executable),
                                        code,
                                    });
                                }
                            }
                        }

                        Global.exit(code);
                    },
                    .running => @panic("Unexpected state: process is running"),
                }
            },
        }
    }

    pub fn ls(ctx: Command.Context) !void {
        const args = ctx.args;

        var this_transpiler = try transpiler.Transpiler.init(ctx.allocator, ctx.log, args, null);
        this_transpiler.options.env.behavior = Api.DotEnvBehavior.load_all;
        this_transpiler.options.env.prefix = "";

        this_transpiler.resolver.care_about_bin_folder = true;
        this_transpiler.resolver.care_about_scripts = true;
        this_transpiler.configureLinker();
    }

    pub const bun_node_dir = switch (Environment.os) {
        // This path is almost always a path to a user directory. So it cannot be inlined like
        // our uses of /tmp. You can use one of these functions instead:
        // - bun.windows.GetTempPathW (native)
        // - bun.fs.FileSystem.RealFS.platformTempDir (any platform)
        .windows => @compileError("Do not use RunCommand.bun_node_dir on Windows"),

        .mac => "/private/tmp",
        else => "/tmp",
    } ++ if (!Environment.isDebug)
        "/bun-node" ++ if (Environment.git_sha_short.len > 0) "-" ++ Environment.git_sha_short else ""
    else
        "/bun-node-debug";

    pub fn bunNodeFileUtf8(allocator: std.mem.Allocator) ![:0]const u8 {
        if (!Environment.isWindows) return bun_node_dir;
        var temp_path_buffer: bun.WPathBuffer = undefined;
        var target_path_buffer: bun.PathBuffer = undefined;
        const len = bun.windows.GetTempPathW(
            temp_path_buffer.len,
            @ptrCast(&temp_path_buffer),
        );
        if (len == 0) {
            return error.FailedToGetTempPath;
        }

        const converted = try bun.strings.convertUTF16toUTF8InBuffer(
            &target_path_buffer,
            temp_path_buffer[0..len],
        );

        const dir_name = "bun-node" ++ if (Environment.git_sha_short.len > 0) "-" ++ Environment.git_sha_short else "";
        const file_name = dir_name ++ "\\node.exe";
        @memcpy(target_path_buffer[converted.len..][0..file_name.len], file_name);

        target_path_buffer[converted.len + file_name.len] = 0;

        return try allocator.dupeZ(u8, target_path_buffer[0 .. converted.len + file_name.len :0]);
    }

    pub fn createFakeTemporaryNodeExecutable(PATH: *std.ArrayList(u8), optional_bun_path: *string) !void {
        // If we are already running as "node", the path should exist
        if (CLI.pretend_to_be_node) return;

        if (Environment.isPosix) {
            var argv0 = @as([*:0]const u8, @ptrCast(optional_bun_path.ptr));

            // if we are already an absolute path, use that
            // if the user started the application via a shebang, it's likely that the path is absolute already
            if (bun.argv[0][0] == '/') {
                optional_bun_path.* = bun.argv[0];
                argv0 = bun.argv[0];
            } else if (optional_bun_path.len == 0) {
                // otherwise, ask the OS for the absolute path
                const self = try bun.selfExePath();
                if (self.len > 0) {
                    argv0 = self.ptr;
                    optional_bun_path.* = self;
                }
            }

            if (optional_bun_path.len == 0) {
                argv0 = bun.argv[0];
            }

            if (Environment.isDebug) {
                std.fs.deleteTreeAbsolute(bun_node_dir) catch {};
            }
            const paths = .{ bun_node_dir ++ "/node", bun_node_dir ++ "/bun" };
            inline for (paths) |path| {
                var retried = false;
                while (true) {
                    inner: {
                        std.posix.symlinkZ(argv0, path) catch |err| {
                            if (err == error.PathAlreadyExists) break :inner;
                            if (retried)
                                return;

                            std.fs.makeDirAbsoluteZ(bun_node_dir) catch {};

                            retried = true;
                            continue;
                        };
                    }
                    break;
                }
            }
            if (PATH.items.len > 0 and PATH.items[PATH.items.len - 1] != std.fs.path.delimiter) {
                try PATH.append(std.fs.path.delimiter);
            }

            // The reason for the extra delim is because we are going to append the system PATH
            // later on. this is done by the caller, and explains why we are adding bun_node_dir
            // to the end of the path slice rather than the start.
            try PATH.appendSlice(bun_node_dir ++ .{std.fs.path.delimiter});
        } else if (Environment.isWindows) {
            var target_path_buffer: bun.WPathBuffer = undefined;

            const prefix = comptime bun.strings.w("\\??\\");

            const len = bun.windows.GetTempPathW(
                target_path_buffer.len - prefix.len,
                @ptrCast(&target_path_buffer[prefix.len]),
            );
            if (len == 0) {
                Output.debug("Failed to create temporary node dir: {s}", .{@tagName(std.os.windows.kernel32.GetLastError())});
                return;
            }

            @memcpy(target_path_buffer[0..prefix.len], prefix);

            const dir_name = "bun-node" ++ if (Environment.isDebug)
                "-debug"
            else if (Environment.git_sha_short.len > 0)
                "-" ++ Environment.git_sha_short
            else
                "";
            @memcpy(target_path_buffer[prefix.len..][len..].ptr, comptime bun.strings.w(dir_name));
            const dir_slice = target_path_buffer[0 .. prefix.len + len + dir_name.len];

            if (Environment.isDebug) {
                const dir_slice_u8 = std.unicode.utf16LeToUtf8Alloc(bun.default_allocator, dir_slice) catch @panic("oom");
                defer bun.default_allocator.free(dir_slice_u8);
                std.fs.deleteTreeAbsolute(dir_slice_u8) catch {};
                std.fs.makeDirAbsolute(dir_slice_u8) catch @panic("huh?");
            }

            const image_path = bun.windows.exePathW();
            inline for (.{ "node.exe", "bun.exe" }) |name| {
                const file_name = dir_name ++ "\\" ++ name ++ "\x00";
                @memcpy(target_path_buffer[len + prefix.len ..][0..file_name.len], comptime bun.strings.w(file_name));

                const file_slice = target_path_buffer[0 .. prefix.len + len + file_name.len - "\x00".len];

                if (bun.windows.CreateHardLinkW(@ptrCast(file_slice.ptr), image_path.ptr, null) == 0) {
                    switch (std.os.windows.kernel32.GetLastError()) {
                        .ALREADY_EXISTS => {},
                        else => {
                            {
                                bun.assert(target_path_buffer[dir_slice.len] == '\\');
                                target_path_buffer[dir_slice.len] = 0;
                                std.posix.mkdirW(target_path_buffer[0..dir_slice.len :0], 0) catch {};
                                target_path_buffer[dir_slice.len] = '\\';
                            }

                            if (bun.windows.CreateHardLinkW(@ptrCast(file_slice.ptr), image_path.ptr, null) == 0) {
                                return;
                            }
                        },
                    }
                }
            }
            if (PATH.items.len > 0 and PATH.items[PATH.items.len - 1] != std.fs.path.delimiter) {
                try PATH.append(std.fs.path.delimiter);
            }

            // The reason for the extra delim is because we are going to append the system PATH
            // later on. this is done by the caller, and explains why we are adding bun_node_dir
            // to the end of the path slice rather than the start.
            try bun.strings.toUTF8AppendToList(PATH, dir_slice[prefix.len..]);
            try PATH.append(std.fs.path.delimiter);
        }
    }

    pub const Filter = enum { script, bin, all, bun_js, all_plus_bun_js, script_and_descriptions, script_exclude };
    const DirInfo = @import("../resolver/dir_info.zig");
    pub fn configureEnvForRun(
        ctx: Command.Context,
        this_transpiler: *transpiler.Transpiler,
        env: ?*DotEnv.Loader,
        log_errors: bool,
        store_root_fd: bool,
    ) !*DirInfo {
        const args = ctx.args;
        this_transpiler.* = try transpiler.Transpiler.init(ctx.allocator, ctx.log, args, env);
        this_transpiler.options.env.behavior = Api.DotEnvBehavior.load_all;
        this_transpiler.env.quiet = true;
        this_transpiler.options.env.prefix = "";

        this_transpiler.resolver.care_about_bin_folder = true;
        this_transpiler.resolver.care_about_scripts = true;
        this_transpiler.resolver.store_fd = store_root_fd;

        this_transpiler.resolver.opts.load_tsconfig_json = true;
        this_transpiler.options.load_tsconfig_json = true;

        this_transpiler.configureLinker();

        const root_dir_info = this_transpiler.resolver.readDirInfo(this_transpiler.fs.top_level_dir) catch |err| {
            if (!log_errors) return error.CouldntReadCurrentDirectory;
            ctx.log.print(Output.errorWriter()) catch {};
            Output.prettyErrorln("<r><red>error<r><d>:<r> <b>{s}<r> loading directory {}", .{ @errorName(err), bun.fmt.QuotedFormatter{ .text = this_transpiler.fs.top_level_dir } });
            Output.flush();
            return err;
        } orelse {
            ctx.log.print(Output.errorWriter()) catch {};
            Output.prettyErrorln("error loading current directory", .{});
            Output.flush();
            return error.CouldntReadCurrentDirectory;
        };

        this_transpiler.resolver.store_fd = false;

        if (env == null) {
            this_transpiler.env.loadProcess();

            if (this_transpiler.env.get("NODE_ENV")) |node_env| {
                if (strings.eqlComptime(node_env, "production")) {
                    this_transpiler.options.production = true;
                }
            }

            this_transpiler.runEnvLoader(true) catch {};
        }

        this_transpiler.env.map.putDefault("npm_config_local_prefix", this_transpiler.fs.top_level_dir) catch unreachable;

        // we have no way of knowing what version they're expecting without running the node executable
        // running the node executable is too slow
        // so we will just hardcode it to LTS
        this_transpiler.env.map.putDefault(
            "npm_config_user_agent",
            // the use of npm/? is copying yarn
            // e.g.
            // > "yarn/1.22.4 npm/? node/v12.16.3 darwin x64",
            "bun/" ++ Global.package_json_version ++ " npm/? node/v" ++ Environment.reported_nodejs_version ++ " " ++ Global.os_name ++ " " ++ Global.arch_name,
        ) catch unreachable;

        if (this_transpiler.env.get("npm_execpath") == null) {
            // we don't care if this fails
            if (bun.selfExePath()) |self_exe_path| {
                this_transpiler.env.map.putDefault("npm_execpath", self_exe_path) catch unreachable;
            } else |_| {}
        }

        if (root_dir_info.enclosing_package_json) |package_json| {
            if (package_json.name.len > 0) {
                if (this_transpiler.env.map.get(NpmArgs.package_name) == null) {
                    this_transpiler.env.map.put(NpmArgs.package_name, package_json.name) catch unreachable;
                }
            }

            this_transpiler.env.map.putDefault("npm_package_json", package_json.source.path.text) catch unreachable;

            if (package_json.version.len > 0) {
                if (this_transpiler.env.map.get(NpmArgs.package_version) == null) {
                    this_transpiler.env.map.put(NpmArgs.package_version, package_json.version) catch unreachable;
                }
            }

            if (package_json.config) |config| {
                try this_transpiler.env.map.ensureUnusedCapacity(config.count());
                for (config.keys(), config.values()) |k, v| {
                    const key = try bun.strings.concat(bun.default_allocator, &.{ "npm_package_config_", k });
                    this_transpiler.env.map.putAssumeCapacity(key, v);
                }
            }
        }

        return root_dir_info;
    }

    pub fn configurePathForRunWithPackageJsonDir(
        ctx: Command.Context,
        package_json_dir: string,
        this_transpiler: *transpiler.Transpiler,
        ORIGINAL_PATH: ?*string,
        cwd: string,
        force_using_bun: bool,
    ) ![]u8 {
        const PATH = this_transpiler.env.get("PATH") orelse "";
        if (ORIGINAL_PATH) |original_path| {
            original_path.* = PATH;
        }

        const bun_node_exe = try bunNodeFileUtf8(ctx.allocator);
        const bun_node_dir_win = bun.Dirname.dirname(u8, bun_node_exe) orelse return error.FailedToGetTempPath;
        const found_node = this_transpiler.env.loadNodeJSConfig(
            this_transpiler.fs,
            if (force_using_bun) bun_node_exe else "",
        ) catch false;

        var needs_to_force_bun = force_using_bun or !found_node;
        var optional_bun_self_path: string = "";

        var new_path_len: usize = PATH.len + 2;

        if (package_json_dir.len > 0) {
            new_path_len += package_json_dir.len + 1;
        }

        {
            var remain = cwd;
            while (strings.lastIndexOfChar(remain, std.fs.path.sep)) |i| {
                new_path_len += strings.withoutTrailingSlash(remain).len + "node_modules.bin".len + 1 + 2; // +2 for path separators, +1 for path delimiter
                remain = remain[0..i];
            } else {
                new_path_len += strings.withoutTrailingSlash(remain).len + "node_modules.bin".len + 1 + 2; // +2 for path separators, +1 for path delimiter
            }
        }

        if (needs_to_force_bun) {
            new_path_len += bun_node_dir_win.len + 1;
        }

        var new_path = try std.ArrayList(u8).initCapacity(ctx.allocator, new_path_len);

        if (needs_to_force_bun) {
            createFakeTemporaryNodeExecutable(&new_path, &optional_bun_self_path) catch bun.outOfMemory();
            if (!force_using_bun) {
                this_transpiler.env.map.put("NODE", bun_node_exe) catch bun.outOfMemory();
                this_transpiler.env.map.put("npm_node_execpath", bun_node_exe) catch bun.outOfMemory();
                this_transpiler.env.map.put("npm_execpath", optional_bun_self_path) catch bun.outOfMemory();
            }

            needs_to_force_bun = false;
        }

        {
            if (package_json_dir.len > 0) {
                try new_path.appendSlice(package_json_dir);
                try new_path.append(std.fs.path.delimiter);
            }

            var remain = cwd;
            while (strings.lastIndexOfChar(remain, std.fs.path.sep)) |i| {
                try new_path.appendSlice(strings.withoutTrailingSlash(remain));
                try new_path.appendSlice(bun.pathLiteral("/node_modules/.bin"));
                try new_path.append(std.fs.path.delimiter);
                remain = remain[0..i];
            } else {
                try new_path.appendSlice(strings.withoutTrailingSlash(remain));
                try new_path.appendSlice(bun.pathLiteral("/node_modules/.bin"));
                try new_path.append(std.fs.path.delimiter);
            }

            try new_path.appendSlice(PATH);
        }

        return new_path.items;
    }

    pub fn configurePathForRun(
        ctx: Command.Context,
        root_dir_info: *DirInfo,
        this_transpiler: *transpiler.Transpiler,
        ORIGINAL_PATH: ?*string,
        cwd: string,
        force_using_bun: bool,
    ) !void {
        var package_json_dir: string = "";

        if (root_dir_info.enclosing_package_json) |package_json| {
            if (root_dir_info.package_json == null) {
                // no trailing slash

                package_json_dir = strings.withoutTrailingSlash(package_json.source.path.name.dir);
            }
        }

        const new_path = try configurePathForRunWithPackageJsonDir(ctx, package_json_dir, this_transpiler, ORIGINAL_PATH, cwd, force_using_bun);
        this_transpiler.env.map.put("PATH", new_path) catch bun.outOfMemory();
    }

    pub fn completions(ctx: Command.Context, default_completions: ?[]const string, reject_list: []const string, comptime filter: Filter) !ShellCompletions {
        var shell_out = ShellCompletions{};
        if (filter != .script_exclude) {
            if (default_completions) |defaults| {
                shell_out.commands = defaults;
            }
        }

        const args = ctx.args;

        var this_transpiler = transpiler.Transpiler.init(ctx.allocator, ctx.log, args, null) catch return shell_out;
        this_transpiler.options.env.behavior = Api.DotEnvBehavior.load_all;
        this_transpiler.options.env.prefix = "";
        this_transpiler.env.quiet = true;

        this_transpiler.resolver.care_about_bin_folder = true;
        this_transpiler.resolver.care_about_scripts = true;
        this_transpiler.resolver.store_fd = true;
        defer {
            this_transpiler.resolver.care_about_bin_folder = false;
            this_transpiler.resolver.care_about_scripts = false;
        }
        this_transpiler.configureLinker();

        const root_dir_info = (this_transpiler.resolver.readDirInfo(this_transpiler.fs.top_level_dir) catch null) orelse return shell_out;

        {
            this_transpiler.env.loadProcess();

            if (this_transpiler.env.get("NODE_ENV")) |node_env| {
                if (strings.eqlComptime(node_env, "production")) {
                    this_transpiler.options.production = true;
                }
            }
        }

        const ResultList = bun.StringArrayHashMap(void);

        if (this_transpiler.env.get("SHELL")) |shell| {
            shell_out.shell = ShellCompletions.Shell.fromEnv(@TypeOf(shell), shell);
        }

        var results = ResultList.init(ctx.allocator);
        var descriptions = std.ArrayList(string).init(ctx.allocator);

        if (filter != .script_exclude) {
            if (default_completions) |defaults| {
                try results.ensureUnusedCapacity(defaults.len);
                for (defaults) |item| {
                    _ = results.getOrPutAssumeCapacity(item);
                }
            }
        }

        if (filter == Filter.bin or filter == Filter.all or filter == Filter.all_plus_bun_js) {
            for (this_transpiler.resolver.binDirs()) |bin_path| {
                if (this_transpiler.resolver.readDirInfo(bin_path) catch null) |bin_dir| {
                    if (bin_dir.getEntriesConst()) |entries| {
                        var iter = entries.data.iterator();
                        var has_copied = false;
                        var dir_slice: string = "";
                        while (iter.next()) |entry| {
                            const value = entry.value_ptr.*;
                            if (value.kind(&this_transpiler.fs.fs, true) == .file) {
                                if (!has_copied) {
                                    bun.copy(u8, &path_buf, value.dir);
                                    dir_slice = path_buf[0..value.dir.len];
                                    if (!strings.endsWithCharOrIsZeroLength(value.dir, std.fs.path.sep)) {
                                        dir_slice = path_buf[0 .. value.dir.len + 1];
                                    }
                                    has_copied = true;
                                }

                                const base = value.base();
                                bun.copy(u8, path_buf[dir_slice.len..], base);
                                path_buf[dir_slice.len + base.len] = 0;
                                const slice = path_buf[0 .. dir_slice.len + base.len :0];
                                if (Environment.isWindows) {
                                    @panic("TODO");
                                }
                                if (!(bun.sys.isExecutableFilePath(slice))) continue;
                                // we need to dupe because the string pay point to a pointer that only exists in the current scope
                                _ = try results.getOrPut(this_transpiler.fs.filename_store.append(@TypeOf(base), base) catch continue);
                            }
                        }
                    }
                }
            }
        }

        if (filter == Filter.all_plus_bun_js or filter == Filter.bun_js) {
            if (this_transpiler.resolver.readDirInfo(this_transpiler.fs.top_level_dir) catch null) |dir_info| {
                if (dir_info.getEntriesConst()) |entries| {
                    var iter = entries.data.iterator();

                    while (iter.next()) |entry| {
                        const value = entry.value_ptr.*;
                        const name = value.base();
                        if (name[0] != '.' and this_transpiler.options.loader(std.fs.path.extension(name)).canBeRunByBun() and
                            !strings.contains(name, ".config") and
                            !strings.contains(name, ".d.ts") and
                            !strings.contains(name, ".d.mts") and
                            !strings.contains(name, ".d.cts") and
                            value.kind(&this_transpiler.fs.fs, true) == .file)
                        {
                            _ = try results.getOrPut(this_transpiler.fs.filename_store.append(@TypeOf(name), name) catch continue);
                        }
                    }
                }
            }
        }

        if (filter == Filter.script_exclude or filter == Filter.script or filter == Filter.all or filter == Filter.all_plus_bun_js or filter == Filter.script_and_descriptions) {
            if (root_dir_info.enclosing_package_json) |package_json| {
                if (package_json.scripts) |scripts| {
                    try results.ensureUnusedCapacity(scripts.count());
                    if (filter == Filter.script_and_descriptions) {
                        try descriptions.ensureUnusedCapacity(scripts.count());
                    }

                    var max_description_len: usize = 20;
                    if (this_transpiler.env.get("MAX_DESCRIPTION_LEN")) |max| {
                        if (std.fmt.parseInt(usize, max, 10) catch null) |max_len| {
                            max_description_len = max_len;
                        }
                    }

                    const keys = scripts.keys();
                    var key_i: usize = 0;
                    loop: while (key_i < keys.len) : (key_i += 1) {
                        const key = keys[key_i];

                        if (filter == Filter.script_exclude) {
                            for (reject_list) |default| {
                                if (std.mem.eql(u8, default, key)) {
                                    continue :loop;
                                }
                            }
                        }

                        if (strings.startsWith(key, "post") or strings.startsWith(key, "pre")) {
                            continue :loop;
                        }

                        const entry_item = results.getOrPutAssumeCapacity(key);

                        if (filter == Filter.script_and_descriptions and max_description_len > 0) {
                            var description = scripts.get(key).?;

                            // When the command starts with something like
                            // NODE_OPTIONS='--max-heap-size foo' bar
                            // ^--------------------------------^ trim that
                            // that way, you can see the real command that's being run
                            if (description.len > 0) {
                                trimmer: {
                                    if (description.len > 0 and strings.startsWith(description, "NODE_OPTIONS=")) {
                                        if (strings.indexOfChar(description, '=')) |i| {
                                            const delimiter: u8 = if (description.len > i + 1)
                                                @as(u8, switch (description[i + 1]) {
                                                    '\'' => '\'',
                                                    '"' => '"',
                                                    else => ' ',
                                                })
                                            else
                                                break :trimmer;

                                            const delimiter_offset = @as(usize, if (delimiter == ' ') 1 else 2);
                                            if (description.len > delimiter_offset + i) {
                                                if (strings.indexOfChar(description[delimiter_offset + i ..], delimiter)) |j| {
                                                    description = std.mem.trim(u8, description[delimiter_offset + i ..][j + 1 ..], " ");
                                                } else {
                                                    break :trimmer;
                                                }
                                            } else {
                                                break :trimmer;
                                            }
                                        } else {
                                            break :trimmer;
                                        }
                                    }
                                }

                                if (description.len > max_description_len) {
                                    description = description[0..max_description_len];
                                }
                            }

                            try descriptions.insert(entry_item.index, description);
                        }
                    }
                }
            }
        }

        const all_keys = results.keys();

        strings.sortAsc(all_keys);
        shell_out.commands = all_keys;
        shell_out.descriptions = try descriptions.toOwnedSlice();

        return shell_out;
    }

    pub fn printHelp(package_json: ?*PackageJSON) void {
        const intro_text =
            \\<b>Usage<r>: <b><green>bun run<r> <cyan>[flags]<r> \<file or script\>
        ;

        const examples_text =
            \\<b>Examples:<r>
            \\  <d>Run a JavaScript or TypeScript file<r>
            \\  <b><green>bun run<r> <blue>./index.js<r>
            \\  <b><green>bun run<r> <blue>./index.tsx<r>
            \\
            \\  <d>Run a package.json script<r>
            \\  <b><green>bun run<r> <blue>dev<r>
            \\  <b><green>bun run<r> <blue>lint<r>
            \\
            \\Full documentation is available at <magenta>https://bun.sh/docs/cli/run<r>
            \\
        ;

        Output.pretty(intro_text ++ "\n\n", .{});

        Output.pretty("<b>Flags:<r>", .{});

        clap.simpleHelp(&Arguments.run_params);
        Output.pretty("\n\n" ++ examples_text, .{});

        if (package_json) |pkg| {
            if (pkg.scripts) |scripts| {
                var display_name = pkg.name;

                if (display_name.len == 0) {
                    display_name = std.fs.path.basename(pkg.source.path.name.dir);
                }

                var iterator = scripts.iterator();

                if (scripts.count() > 0) {
                    Output.pretty("\n<b>package.json scripts ({d} found):<r>", .{scripts.count()});
                    // Output.prettyln("<r><blue><b>{s}<r> scripts:<r>\n", .{display_name});
                    while (iterator.next()) |entry| {
                        Output.prettyln("\n", .{});
                        Output.prettyln("  <d>$</r> bun run<r> <blue>{s}<r>\n", .{entry.key_ptr.*});
                        Output.prettyln("  <d>  {s}<r>\n", .{entry.value_ptr.*});
                    }

                    // Output.prettyln("\n<d>{d} scripts<r>", .{scripts.count()});

                    Output.prettyln("\n", .{});
                } else {
                    Output.prettyln("\n<r><yellow>No \"scripts\" found in package.json.<r>\n", .{});
                }
            } else {
                Output.prettyln("\n<r><yellow>No \"scripts\" found in package.json.<r>\n", .{});
            }
        }

        Output.flush();
    }

    fn _bootAndHandleError(ctx: Command.Context, path: string, loader: ?bun.options.Loader) bool {
        Global.configureAllocator(.{ .long_running = true });
        Run.boot(ctx, ctx.allocator.dupe(u8, path) catch return false, loader) catch |err| {
            ctx.log.print(Output.errorWriter()) catch {};

            Output.prettyErrorln("<r><red>error<r>: Failed to run <b>{s}<r> due to error <b>{s}<r>", .{
                std.fs.path.basename(path),
                @errorName(err),
            });
            bun.handleErrorReturnTrace(err, @errorReturnTrace());
            Global.exit(1);
        };
        return true;
    }
    fn maybeOpenWithBunJS(ctx: Command.Context) bool {
        if (ctx.args.entry_points.len == 0)
            return false;
        var script_name_buf: bun.PathBuffer = undefined;

        const script_name_to_search = ctx.args.entry_points[0];

        var absolute_script_path: ?string = null;

        // TODO: optimize this pass for Windows. we can make better use of system apis available
        var file_path = script_name_to_search;
        {
            const file = bun.toLibUVOwnedFD(((brk: {
                if (std.fs.path.isAbsolute(script_name_to_search)) {
                    var win_resolver = resolve_path.PosixToWinNormalizer{};
                    var resolved = win_resolver.resolveCWD(script_name_to_search) catch @panic("Could not resolve path");
                    if (comptime Environment.isWindows) {
                        resolved = resolve_path.normalizeString(resolved, false, .windows);
                    }
                    break :brk bun.openFile(
                        resolved,
                        .{ .mode = .read_only },
                    );
                } else if (!strings.hasPrefix(script_name_to_search, "..") and script_name_to_search[0] != '~') {
                    const file_pathZ = brk2: {
                        @memcpy(script_name_buf[0..file_path.len], file_path);
                        script_name_buf[file_path.len] = 0;
                        break :brk2 script_name_buf[0..file_path.len :0];
                    };

                    break :brk bun.openFileZ(file_pathZ, .{ .mode = .read_only });
                } else {
                    var path_buf_2: bun.PathBuffer = undefined;
                    const cwd = bun.getcwd(&path_buf_2) catch return false;
                    path_buf_2[cwd.len] = std.fs.path.sep;
                    var parts = [_]string{script_name_to_search};
                    file_path = resolve_path.joinAbsStringBuf(
                        path_buf_2[0 .. cwd.len + 1],
                        &script_name_buf,
                        &parts,
                        .auto,
                    );
                    if (file_path.len == 0) return false;
                    script_name_buf[file_path.len] = 0;
                    const file_pathZ = script_name_buf[0..file_path.len :0];
                    break :brk bun.openFileZ(file_pathZ, .{ .mode = .read_only });
                }
            }) catch return false).handle) catch return false;
            defer _ = bun.sys.close(file);

            switch (bun.sys.fstat(file)) {
                .result => |stat| {
                    // directories cannot be run. if only there was a faster way to check this
                    if (bun.S.ISDIR(@intCast(stat.mode))) return false;
                },
                .err => return false,
            }

            Global.configureAllocator(.{ .long_running = true });

            absolute_script_path = brk: {
                if (comptime !Environment.isWindows) break :brk bun.getFdPath(file, &script_name_buf) catch return false;

                var fd_path_buf: bun.PathBuffer = undefined;
                break :brk bun.getFdPath(file, &fd_path_buf) catch return false;
            };
        }

        if (!ctx.debug.loaded_bunfig) {
            bun.CLI.Arguments.loadConfigPath(ctx.allocator, true, "bunfig.toml", ctx, .RunCommand) catch {};
        }

        _ = _bootAndHandleError(ctx, absolute_script_path.?, null);
        return true;
    }
    pub fn exec(
        ctx: Command.Context,
        cfg: struct {
            bin_dirs_only: bool,
            log_errors: bool,
            allow_fast_run_for_extensions: bool,
        },
    ) !bool {
        const bin_dirs_only = cfg.bin_dirs_only;
        const log_errors = cfg.log_errors;

        // find what to run

        var positionals = ctx.positionals;
        if (positionals.len > 0 and strings.eqlComptime(positionals[0], "run")) {
            positionals = positionals[1..];
        }

        var target_name: string = "";
        if (positionals.len > 0) {
            target_name = positionals[0];
            positionals = positionals[1..];
        }
        const passthrough = ctx.passthrough; // unclear why passthrough is an escaped string, it should probably be []const []const u8 and allow its users to escape it.

        var try_fast_run = false;
        var skip_script_check = false;
        if (target_name.len > 0 and target_name[0] == '.') {
            try_fast_run = true;
            skip_script_check = true;
        } else if (std.fs.path.isAbsolute(target_name)) {
            try_fast_run = true;
            skip_script_check = true;
        } else if (cfg.allow_fast_run_for_extensions) {
            const ext = std.fs.path.extension(target_name);
            const default_loader = options.defaultLoaders.get(ext);
            if (default_loader != null and default_loader.?.canBeRunByBun()) {
                try_fast_run = true;
            }
        }

        // try fast run (check if the file exists and is not a folder, then run it)
        if (try_fast_run and maybeOpenWithBunJS(ctx)) return true;

        // setup

        const force_using_bun = ctx.debug.run_in_bun;
        var ORIGINAL_PATH: string = "";
        var this_transpiler: transpiler.Transpiler = undefined;
        const root_dir_info = try configureEnvForRun(ctx, &this_transpiler, null, log_errors, false);
        try configurePathForRun(ctx, root_dir_info, &this_transpiler, &ORIGINAL_PATH, root_dir_info.abs_path, force_using_bun);
        this_transpiler.env.map.put("npm_command", "run-script") catch unreachable;

        if (!ctx.debug.loaded_bunfig) {
            bun.CLI.Arguments.loadConfigPath(ctx.allocator, true, "bunfig.toml", ctx, .RunCommand) catch {};
        }

        // check for empty command

        if (target_name.len == 0) {
            if (root_dir_info.enclosing_package_json) |package_json| {
                RunCommand.printHelp(package_json);
            } else {
                RunCommand.printHelp(null);
                Output.prettyln("\n<r><yellow>No package.json found.<r>\n", .{});
                Output.flush();
            }

            return true;
        }

        // check for stdin

        if (target_name.len == 1 and target_name[0] == '-') {
            log("Executing from stdin", .{});

            // read from stdin
            var stack_fallback = std.heap.stackFallback(2048, bun.default_allocator);
            var list = std.ArrayList(u8).init(stack_fallback.get());
            errdefer list.deinit();

            std.io.getStdIn().reader().readAllArrayList(&list, 1024 * 1024 * 1024) catch return false;
            ctx.runtime_options.eval.script = list.items;

            const trigger = bun.pathLiteral("/[stdin]");
            var entry_point_buf: [bun.MAX_PATH_BYTES + trigger.len]u8 = undefined;
            const cwd = try std.posix.getcwd(&entry_point_buf);
            @memcpy(entry_point_buf[cwd.len..][0..trigger.len], trigger);
            const entry_path = entry_point_buf[0 .. cwd.len + trigger.len];

            var passthrough_list = try std.ArrayList(string).initCapacity(ctx.allocator, ctx.passthrough.len + 1);
            passthrough_list.appendAssumeCapacity("-");
            passthrough_list.appendSliceAssumeCapacity(ctx.passthrough);
            ctx.passthrough = passthrough_list.items;

            Run.boot(ctx, ctx.allocator.dupe(u8, entry_path) catch return false, null) catch |err| {
                ctx.log.print(Output.errorWriter()) catch {};

                Output.prettyErrorln("<r><red>error<r>: Failed to run <b>{s}<r> due to error <b>{s}<r>", .{
                    std.fs.path.basename(target_name),
                    @errorName(err),
                });
                bun.handleErrorReturnTrace(err, @errorReturnTrace());
                Global.exit(1);
            };
            return true;
        }

        // run script with matching name

        if (!skip_script_check) if (root_dir_info.enclosing_package_json) |package_json| {
            if (package_json.scripts) |scripts| {
                if (scripts.get(target_name)) |script_content| {
                    log("Found matching script `{s}`", .{script_content});
                    Global.configureAllocator(.{ .long_running = false });
                    this_transpiler.env.map.put("npm_lifecycle_event", target_name) catch unreachable;

                    // allocate enough to hold "post${scriptname}"
                    var temp_script_buffer = try std.fmt.allocPrint(ctx.allocator, "\x00pre{s}", .{target_name});
                    defer ctx.allocator.free(temp_script_buffer);

                    const package_json_path = root_dir_info.enclosing_package_json.?.source.path.text;
                    const package_json_dir = strings.withoutTrailingSlash(strings.withoutSuffixComptime(package_json_path, "package.json"));
                    log("Running in dir `{s}`", .{package_json_dir});

                    if (scripts.get(temp_script_buffer[1..])) |prescript| {
                        try runPackageScriptForeground(
                            ctx,
                            ctx.allocator,
                            prescript,
                            temp_script_buffer[1..],
                            package_json_dir,
                            this_transpiler.env,
                            &.{},
                            ctx.debug.silent,
                            ctx.debug.use_system_shell,
                        );
                    }

                    try runPackageScriptForeground(
                        ctx,
                        ctx.allocator,
                        script_content,
                        target_name,
                        package_json_dir,
                        this_transpiler.env,
                        passthrough,
                        ctx.debug.silent,
                        ctx.debug.use_system_shell,
                    );

                    temp_script_buffer[0.."post".len].* = "post".*;

                    if (scripts.get(temp_script_buffer)) |postscript| {
                        try runPackageScriptForeground(
                            ctx,
                            ctx.allocator,
                            postscript,
                            temp_script_buffer,
                            package_json_dir,
                            this_transpiler.env,
                            &.{},
                            ctx.debug.silent,
                            ctx.debug.use_system_shell,
                        );
                    }

                    return true;
                }
            }
        };

        // load module and run that module
        // TODO: run module resolution here - try the next condition if the module can't be found

        log("Try resolve `{s}` in `{s}`", .{ target_name, this_transpiler.fs.top_level_dir });
        if (this_transpiler.resolver.resolve(this_transpiler.fs.top_level_dir, target_name, .entry_point_run) catch
            this_transpiler.resolver.resolve(this_transpiler.fs.top_level_dir, try std.mem.join(ctx.allocator, "", &.{ "./", target_name }), .entry_point_run)) |resolved|
        {
            var resolved_mutable = resolved;
            const path = resolved_mutable.path().?;
            const loader: bun.options.Loader = this_transpiler.options.loaders.get(path.name.ext) orelse .tsx;
            if (loader.canBeRunByBun() or loader == .html) {
                log("Resolved to: `{s}`", .{path.text});
                return _bootAndHandleError(ctx, path.text, loader);
            } else {
                log("Resolved file `{s}` but ignoring because loader is {s}", .{ path.text, @tagName(loader) });
            }
        } else |_| {
            // Support globs for HTML entry points.
            if (strings.hasSuffixComptime(target_name, ".html")) {
                if (strings.containsChar(target_name, '*')) {
                    return _bootAndHandleError(ctx, target_name, .html);
                }
            }
        }

        // execute a node_modules/.bin/<X> command, or (run only) a system command like 'ls'

        if (Environment.isWindows and bun.FeatureFlags.windows_bunx_fast_path) try_bunx_file: {
            // Attempt to find a ".bunx" file on disk, and run it, skipping the
            // wrapper exe.  we build the full exe path even though we could do
            // a relative lookup, because in the case we do find it, we have to
            // generate this full path anyways.
            var ptr: []u16 = &BunXFastPath.direct_launch_buffer;
            const root = comptime bun.strings.w("\\??\\");
            @memcpy(ptr[0..root.len], root);
            ptr = ptr[4..];
            const cwd_len = windows.kernel32.GetCurrentDirectoryW(
                BunXFastPath.direct_launch_buffer.len - 4,
                ptr.ptr,
            );
            if (cwd_len == 0) break :try_bunx_file;
            ptr = ptr[cwd_len..];
            const prefix = comptime bun.strings.w("\\node_modules\\.bin\\");
            @memcpy(ptr[0..prefix.len], prefix);
            ptr = ptr[prefix.len..];
            const encoded = bun.strings.convertUTF8toUTF16InBuffer(ptr[0..], target_name);
            ptr = ptr[encoded.len..];
            const ext = comptime bun.strings.w(".bunx");
            @memcpy(ptr[0..ext.len], ext);
            ptr[ext.len] = 0;

            const l = root.len + cwd_len + prefix.len + target_name.len + ext.len;
            const path_to_use = BunXFastPath.direct_launch_buffer[0..l :0];
            BunXFastPath.tryLaunch(ctx, path_to_use, this_transpiler.env, ctx.passthrough);
        }

        const PATH = this_transpiler.env.get("PATH") orelse "";
        var path_for_which = PATH;
        if (bin_dirs_only) {
            if (ORIGINAL_PATH.len < PATH.len) {
                path_for_which = PATH[0 .. PATH.len - (ORIGINAL_PATH.len + 1)];
            } else {
                path_for_which = "";
            }
        }

        if (path_for_which.len > 0) {
            if (which(&path_buf, path_for_which, this_transpiler.fs.top_level_dir, target_name)) |destination| {
                const out = bun.asByteSlice(destination);
                return try runBinaryWithoutBunxPath(
                    ctx,
                    try this_transpiler.fs.dirname_store.append(@TypeOf(out), out),
                    destination,
                    this_transpiler.fs.top_level_dir,
                    this_transpiler.env,
                    passthrough,
                    target_name,
                );
            }
        }

        // failure

        if (ctx.runtime_options.if_present) {
            return true;
        }

        if (log_errors) {
            const ext = std.fs.path.extension(target_name);
            const default_loader = options.defaultLoaders.get(ext);
            if (default_loader != null and default_loader.?.isJavaScriptLikeOrJSON() or target_name.len > 0 and (target_name[0] == '.' or target_name[0] == '/' or std.fs.path.isAbsolute(target_name))) {
                Output.prettyError("<r><red>error<r><d>:<r> <b>Module not found \"<b>{s}<r>\"\n", .{target_name});
            } else if (ext.len > 0) {
                Output.prettyError("<r><red>error<r><d>:<r> <b>File not found \"<b>{s}<r>\"\n", .{target_name});
            } else {
                Output.prettyError("<r><red>error<r><d>:<r> <b>Script not found \"<b>{s}<r>\"\n", .{target_name});
            }

            Global.exit(1);
        }

        return false;
    }

    pub fn execAsIfNode(ctx: Command.Context) !void {
        bun.assert(CLI.pretend_to_be_node);

        if (ctx.runtime_options.eval.script.len > 0) {
            const trigger = bun.pathLiteral("/[eval]");
            var entry_point_buf: [bun.MAX_PATH_BYTES + trigger.len]u8 = undefined;
            const cwd = try std.posix.getcwd(&entry_point_buf);
            @memcpy(entry_point_buf[cwd.len..][0..trigger.len], trigger);
            try Run.boot(ctx, entry_point_buf[0 .. cwd.len + trigger.len], null);
            return;
        }

        if (ctx.positionals.len == 0) {
            Output.errGeneric("Missing script to execute. Bun's provided 'node' cli wrapper does not support a repl.", .{});
            Global.exit(1);
        }

        // TODO(@paperclover): merge windows branch
        // var win_resolver = resolve_path.PosixToWinNormalizer{};

        const filename = ctx.positionals[0];

        const normalized_filename = if (std.fs.path.isAbsolute(filename))
            // TODO(@paperclover): merge windows branch
            // try win_resolver.resolveCWD("/dev/bun/test/etc.js");
            filename
        else brk: {
            const cwd = try bun.getcwd(&path_buf);
            path_buf[cwd.len] = std.fs.path.sep_posix;
            var parts = [_]string{filename};
            break :brk resolve_path.joinAbsStringBuf(
                path_buf[0 .. cwd.len + 1],
                &path_buf2,
                &parts,
                .loose,
            );
        };

        Run.boot(ctx, normalized_filename, null) catch |err| {
            ctx.log.print(Output.errorWriter()) catch {};

            Output.err(err, "Failed to run script \"<b>{s}<r>\"", .{std.fs.path.basename(normalized_filename)});
            Global.exit(1);
        };
    }
};

pub const BunXFastPath = struct {
    const shim_impl = @import("../install/windows-shim/bun_shim_impl.zig");
    const debug = Output.scoped(.BunXFastPath, false);

    var direct_launch_buffer: bun.WPathBuffer = undefined;
    var environment_buffer: bun.WPathBuffer = undefined;

    /// If this returns, it implies the fast path cannot be taken
    fn tryLaunch(ctx: Command.Context, path_to_use: [:0]u16, env: *DotEnv.Loader, passthrough: []const []const u8) void {
        if (!bun.FeatureFlags.windows_bunx_fast_path) return;

        bun.assert(bun.isSliceInBufferT(u16, path_to_use, &BunXFastPath.direct_launch_buffer));
        var command_line = BunXFastPath.direct_launch_buffer[path_to_use.len..];

        debug("Attempting to find and load bunx file: '{}'", .{bun.fmt.utf16(path_to_use)});
        if (Environment.allow_assert) {
            bun.assert(std.fs.path.isAbsoluteWindowsWTF16(path_to_use));
        }
        const handle = (bun.sys.openFileAtWindows(
            bun.invalid_fd, // absolute path is given
            path_to_use,
            .{
                .access_mask = windows.STANDARD_RIGHTS_READ | windows.FILE_READ_DATA | windows.FILE_READ_ATTRIBUTES | windows.FILE_READ_EA | windows.SYNCHRONIZE,
                .disposition = windows.FILE_OPEN,
                .options = windows.FILE_NON_DIRECTORY_FILE | windows.FILE_SYNCHRONOUS_IO_NONALERT,
            },
        ).unwrap() catch |err| {
            debug("Failed to open bunx file: '{}'", .{err});
            return;
        }).cast();

        var i: usize = 0;
        for (passthrough) |str| {
            command_line[i] = ' ';
            const result = bun.strings.convertUTF8toUTF16InBuffer(command_line[1 + i ..], str);
            i += result.len + 1;
        }
        ctx.passthrough = passthrough;

        const run_ctx = shim_impl.FromBunRunContext{
            .handle = handle,
            .base_path = path_to_use[4..],
            .arguments = command_line[0..i],
            .force_use_bun = ctx.debug.run_in_bun,
            .direct_launch_with_bun_js = &directLaunchCallback,
            .cli_context = ctx,
            .environment = env.map.writeWindowsEnvBlock(&environment_buffer) catch return,
        };

        if (Environment.isDebug) {
            debug("run_ctx.handle: '{}'", .{bun.FDImpl.fromSystem(handle)});
            debug("run_ctx.base_path: '{}'", .{bun.fmt.utf16(run_ctx.base_path)});
            debug("run_ctx.arguments: '{}'", .{bun.fmt.utf16(run_ctx.arguments)});
            debug("run_ctx.force_use_bun: '{}'", .{run_ctx.force_use_bun});
        }

        shim_impl.tryStartupFromBunJS(run_ctx);

        debug("did not start via shim", .{});
    }

    fn directLaunchCallback(wpath: []u16, ctx: Command.Context) void {
        const utf8 = bun.strings.convertUTF16toUTF8InBuffer(
            bun.reinterpretSlice(u8, &direct_launch_buffer),
            wpath,
        ) catch return;
        Run.boot(ctx, utf8, null) catch |err| {
            ctx.log.print(Output.errorWriter()) catch {};
            Output.err(err, "Failed to run bin \"<b>{s}<r>\"", .{std.fs.path.basename(utf8)});
            Global.exit(1);
        };
    }
};
