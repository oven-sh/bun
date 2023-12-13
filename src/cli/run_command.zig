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

const lex = bun.js_lexer;
const logger = @import("root").bun.logger;
const clap = @import("root").bun.clap;
const Arguments = @import("../cli.zig").Arguments;

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
const Command = @import("../cli.zig").Command;
const bundler = bun.bundler;

const DotEnv = @import("../env_loader.zig");
const which = @import("../which.zig").which;
const Run = @import("../bun_js.zig").Run;
var path_buf: [bun.MAX_PATH_BYTES]u8 = undefined;
var path_buf2: [bun.MAX_PATH_BYTES]u8 = undefined;
const NpmArgs = struct {
    // https://github.com/npm/rfcs/blob/main/implemented/0021-reduce-lifecycle-script-environment.md#detailed-explanation
    pub const package_name: string = "npm_package_name";
    pub const package_version: string = "npm_package_version";
};
const PackageJSON = @import("../resolver/package_json.zig").PackageJSON;
const yarn_commands: []u64 = @import("./list-of-yarn-commands.zig").all_yarn_commands;

const ShellCompletions = @import("./shell_completions.zig");
const PosixSpawn = bun.posix.spawn;

const PackageManager = @import("../install/install.zig").PackageManager;
const Lockfile = @import("../install/lockfile.zig");

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
            pub var shell_buf_once: [bun.MAX_PATH_BYTES]u8 = undefined;
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
    ) !void {
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
                                if (std.mem.indexOfScalar(u64, yarn_commands, bun.hash(yarn_cmd)) == null) {
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

                // do we need to escape?
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
                    }

                    delimiter = 0;
                },
                // TODO: handle escape sequences properly
                // https://github.com/oven-sh/bun/issues/53
                '\\' => {
                    delimiter = 0;

                    if (entry_i + 1 < script.len) {
                        switch (script[entry_i + 1]) {
                            '"', '\'' => {
                                entry_i += 1;
                                continue;
                            },
                            '\\' => {
                                entry_i += 1;
                            },
                            else => {},
                        }
                    }
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
        allocator: std.mem.Allocator,
        original_script: string,
        name: string,
        cwd: string,
        env: *DotEnv.Loader,
        passthrough: []const string,
        silent: bool,
    ) !bool {
        const shell_bin = findShell(env.map.get("PATH") orelse "", cwd) orelse return error.MissingShell;

        var script = original_script;
        var copy_script = try std.ArrayList(u8).initCapacity(allocator, script.len);

        // We're going to do this slowly.
        // Find exact matches of yarn, pnpm, npm

        try replacePackageManagerRun(&copy_script, script);

        var combined_script: []u8 = copy_script.items;

        log("Script: \"{s}\"", .{combined_script});

        if (passthrough.len > 0) {
            var combined_script_len = script.len;
            for (passthrough) |p| {
                combined_script_len += p.len + 1;
            }
            var combined_script_buf = try allocator.alloc(u8, combined_script_len);
            bun.copy(u8, combined_script_buf, script);
            var remaining_script_buf = combined_script_buf[script.len..];
            for (passthrough) |part| {
                var p = part;
                remaining_script_buf[0] = ' ';
                bun.copy(u8, remaining_script_buf[1..], p);
                remaining_script_buf = remaining_script_buf[p.len + 1 ..];
            }
            combined_script = combined_script_buf;
        }

        var argv = [_]string{
            shell_bin,
            if (Environment.isWindows) "/c" else "-c",
            combined_script,
        };

        if (!silent) {
            Output.prettyErrorln("<r><d><magenta>$<r> <d><b>{s}<r>", .{combined_script});
            Output.flush();
        }

        var child_process = std.ChildProcess.init(&argv, allocator);
        var buf_map = try env.map.cloneToEnvMap(allocator);

        child_process.env_map = &buf_map;
        child_process.cwd = cwd;
        child_process.stderr_behavior = .Inherit;
        child_process.stdin_behavior = .Inherit;
        child_process.stdout_behavior = .Inherit;

        const result = child_process.spawnAndWait() catch |err| {
            if (!silent) {
                Output.prettyErrorln("<r><red>error<r>: Failed to run script <b>{s}<r> due to error <b>{s}<r>", .{ name, @errorName(err) });
            }

            Output.flush();
            return true;
        };

        switch (result) {
            .Exited => |code| {
                if (code > 0) {
                    if (code > 2 and !silent) {
                        Output.prettyErrorln("<r><red>error<r><d>:<r> script <b>\"{s}\"<r> exited with {any}<r>", .{ name, bun.SignalCode.from(code) });
                        Output.flush();
                    }

                    Global.exit(code);
                }
            },
            .Signal => |signal| {
                if (!silent) {
                    Output.prettyErrorln("<r><red>error<r><d>:<r> script <b>\"{s}\"<r> exited with {any}<r>", .{ name, bun.SignalCode.from(signal) });
                    Output.flush();
                }

                Global.exit(1);
            },
            .Stopped => |signal| {
                if (!silent) {
                    Output.prettyErrorln("<r><red>error<r><d>:<r> script <b>\"{s}\"<r> was stopped by signal {any}<r>", .{ name, bun.SignalCode.from(signal) });
                    Output.flush();
                }

                Global.exit(1);
            },

            else => {},
        }

        return true;
    }

    pub fn runBinary(
        ctx: Command.Context,
        executable: []const u8,
        cwd: string,
        env: *DotEnv.Loader,
        passthrough: []const string,
    ) !bool {
        var argv_ = [_]string{executable};
        var argv: []const string = &argv_;

        if (passthrough.len > 0) {
            var array_list = std.ArrayList(string).init(ctx.allocator);
            try array_list.append(executable);
            try array_list.appendSlice(passthrough);
            argv = try array_list.toOwnedSlice();
        }

        var child_process = std.ChildProcess.init(argv, ctx.allocator);

        var buf_map = try env.map.cloneToEnvMap(ctx.allocator);
        child_process.cwd = cwd;
        child_process.env_map = &buf_map;
        child_process.stderr_behavior = .Inherit;
        child_process.stdin_behavior = .Inherit;
        child_process.stdout_behavior = .Inherit;
        const silent = ctx.debug.silent;

        const result = child_process.spawnAndWait() catch |err| {
            if (err == error.AccessDenied) {
                if (comptime Environment.isPosix) {
                    var stat = std.mem.zeroes(std.c.Stat);
                    const rc = bun.C.stat(executable[0.. :0].ptr, &stat);
                    if (rc == 0) {
                        if (std.os.S.ISDIR(stat.mode)) {
                            if (!silent)
                                Output.prettyErrorln("<r><red>error<r>: Failed to run directory \"<b>{s}<r>\"\n", .{executable});
                            Global.exit(1);
                        }
                    }
                }
            }
            Output.prettyErrorln("<r><red>error<r>: Failed to run \"<b>{s}<r>\" due to error <b>{s}<r>", .{ std.fs.path.basename(executable), @errorName(err) });
            Global.exit(1);
        };
        switch (result) {
            .Exited => |sig| {
                // 2 is SIGINT, which is CTRL + C so that's kind of annoying to show
                if (sig > 0 and sig != 2 and !silent)
                    Output.prettyErrorln("<r><red>error<r><d>:<r> \"<b>{s}<r>\" exited with <b>{any}<r>", .{ std.fs.path.basename(executable), bun.SignalCode.from(sig) });
                Global.exit(sig);
            },
            .Signal => |sig| {
                // 2 is SIGINT, which is CTRL + C so that's kind of annoying to show
                if (sig > 0 and sig != 2 and !silent) {
                    Output.prettyErrorln("<r><red>error<r><d>:<r> \"<b>{s}<r>\" exited with <b>{any}<r>", .{ std.fs.path.basename(executable), bun.SignalCode.from(sig) });
                }
                Global.exit(std.mem.asBytes(&sig)[0]);
            },
            .Stopped => |sig| {
                if (sig > 0 and !silent)
                    Output.prettyErrorln("<r><red>error<r> \"<b>{s}<r>\" stopped with {any}<r>", .{ std.fs.path.basename(executable), bun.SignalCode.from(sig) });
                Global.exit(std.mem.asBytes(&sig)[0]);
            },
            .Unknown => |sig| {
                if (!silent)
                    Output.prettyErrorln("<r><red>error<r> \"<b>{s}<r>\" stopped: {d}<r>", .{ std.fs.path.basename(executable), sig });
                Global.exit(1);
            },
        }

        return true;
    }

    pub fn ls(ctx: Command.Context) !void {
        var args = ctx.args;

        var this_bundler = try bundler.Bundler.init(ctx.allocator, ctx.log, args, null);
        this_bundler.options.env.behavior = Api.DotEnvBehavior.load_all;
        this_bundler.options.env.prefix = "";

        this_bundler.resolver.care_about_bin_folder = true;
        this_bundler.resolver.care_about_scripts = true;
        this_bundler.configureLinker();
    }

    const bun_node_dir = switch (@import("builtin").target.os.tag) {
        // TODO:
        .windows => "TMPDIR",

        .macos => "/private/tmp",
        else => "/tmp",
    } ++ if (!Environment.isDebug)
        "/bun-node"
    else
        "/bun-debug-node";

    var self_exe_bin_path_buf: [bun.MAX_PATH_BYTES + 1]u8 = undefined;
    fn createFakeTemporaryNodeExecutable(PATH: *std.ArrayList(u8), optional_bun_path: *string) !void {
        if (comptime Environment.isWindows) {
            bun.todo(@src(), {});
            return;
        }

        var retried = false;

        if (!strings.endsWithComptime(std.mem.span(bun.argv()[0]), "node")) {
            var argv0 = @as([*:0]const u8, @ptrCast(optional_bun_path.ptr));

            // if we are already an absolute path, use that
            // if the user started the application via a shebang, it's likely that the path is absolute already
            if (bun.argv()[0][0] == '/') {
                optional_bun_path.* = bun.span(bun.argv()[0]);
                argv0 = bun.argv()[0];
            } else if (optional_bun_path.len == 0) {
                // otherwise, ask the OS for the absolute path
                var self = std.fs.selfExePath(&self_exe_bin_path_buf) catch unreachable;
                if (self.len > 0) {
                    self.ptr[self.len] = 0;
                    argv0 = @as([*:0]const u8, @ptrCast(self.ptr));
                    optional_bun_path.* = self;
                }
            }

            if (optional_bun_path.len == 0) {
                argv0 = bun.argv()[0];
            }

            while (true) {
                inner: {
                    std.os.symlinkZ(argv0, bun_node_dir ++ "/node") catch |err| {
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

        if (PATH.items.len > 0) {
            try PATH.append(':');
        }

        try PATH.appendSlice(bun_node_dir ++ ":");
    }

    pub const Filter = enum { script, bin, all, bun_js, all_plus_bun_js, script_and_descriptions, script_exclude };
    const DirInfo = @import("../resolver/dir_info.zig");
    pub fn configureEnvForRun(
        ctx: Command.Context,
        this_bundler: *bundler.Bundler,
        env: ?*DotEnv.Loader,
        log_errors: bool,
    ) !*DirInfo {
        var args = ctx.args;
        this_bundler.* = try bundler.Bundler.init(ctx.allocator, ctx.log, args, env);
        this_bundler.options.env.behavior = Api.DotEnvBehavior.load_all;
        this_bundler.env.quiet = true;
        this_bundler.options.env.prefix = "";

        this_bundler.resolver.care_about_bin_folder = true;
        this_bundler.resolver.care_about_scripts = true;

        this_bundler.resolver.opts.load_tsconfig_json = false;
        this_bundler.options.load_tsconfig_json = false;

        this_bundler.configureLinker();

        var root_dir_info = this_bundler.resolver.readDirInfo(this_bundler.fs.top_level_dir) catch |err| {
            if (!log_errors) return error.CouldntReadCurrentDirectory;
            if (Output.enable_ansi_colors) {
                ctx.log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), true) catch {};
            } else {
                ctx.log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), false) catch {};
            }
            Output.prettyErrorln("<r><red>error<r><d>:<r> <b>{s}<r> loading directory {}", .{ @errorName(err), strings.QuotedFormatter{ .text = this_bundler.fs.top_level_dir } });
            Output.flush();
            return err;
        } orelse {
            if (Output.enable_ansi_colors) {
                ctx.log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), true) catch {};
            } else {
                ctx.log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), false) catch {};
            }
            Output.prettyErrorln("error loading current directory", .{});
            Output.flush();
            return error.CouldntReadCurrentDirectory;
        };

        if (env == null) {
            this_bundler.env.loadProcess();

            if (this_bundler.env.map.get("NODE_ENV")) |node_env| {
                if (strings.eqlComptime(node_env, "production")) {
                    this_bundler.options.production = true;
                }
            }

            // TODO: evaluate if we can skip running this in nested calls to bun run
            // The reason why it's unclear:
            // - Some scripts may do NODE_ENV=production bun run foo
            //   This would cause potentially a different .env file to be loaded
            this_bundler.runEnvLoader() catch {};

            if (root_dir_info.getEntries(0)) |dir| {
                // Run .env again if it exists in a parent dir
                if (this_bundler.options.production) {
                    this_bundler.env.load(dir, this_bundler.options.env.files, .production) catch {};
                } else {
                    this_bundler.env.load(dir, this_bundler.options.env.files, .development) catch {};
                }
            }
        }

        this_bundler.env.map.putDefault("npm_config_local_prefix", this_bundler.fs.top_level_dir) catch unreachable;

        // we have no way of knowing what version they're expecting without running the node executable
        // running the node executable is too slow
        // so we will just hardcode it to LTS
        this_bundler.env.map.putDefault(
            "npm_config_user_agent",
            // the use of npm/? is copying yarn
            // e.g.
            // > "yarn/1.22.4 npm/? node/v12.16.3 darwin x64",
            "bun/" ++ Global.package_json_version ++ " npm/? node/v20.8.0 " ++ Global.os_name ++ " " ++ Global.arch_name,
        ) catch unreachable;

        if (this_bundler.env.get("npm_execpath") == null) {
            // we don't care if this fails
            if (std.fs.selfExePathAlloc(ctx.allocator)) |self_exe_path| {
                this_bundler.env.map.putDefault("npm_execpath", self_exe_path) catch unreachable;
            } else |_| {}
        }

        if (root_dir_info.enclosing_package_json) |package_json| {
            if (package_json.name.len > 0) {
                if (this_bundler.env.map.get(NpmArgs.package_name) == null) {
                    this_bundler.env.map.put(NpmArgs.package_name, package_json.name) catch unreachable;
                }
            }

            this_bundler.env.map.putDefault("npm_package_json", package_json.source.path.text) catch unreachable;

            if (package_json.version.len > 0) {
                if (this_bundler.env.map.get(NpmArgs.package_version) == null) {
                    this_bundler.env.map.put(NpmArgs.package_version, package_json.version) catch unreachable;
                }
            }
        }

        return root_dir_info;
    }

    pub fn configurePathForRun(
        ctx: Command.Context,
        root_dir_info: *DirInfo,
        this_bundler: *bundler.Bundler,
        ORIGINAL_PATH: ?*string,
        cwd: string,
        force_using_bun: bool,
    ) !void {
        var package_json_dir: string = "";

        if (root_dir_info.enclosing_package_json) |package_json| {
            if (root_dir_info.package_json == null) {
                // no trailing slash
                package_json_dir = std.mem.trimRight(u8, package_json.source.path.name.dir, "/");
            }
        }

        var PATH = this_bundler.env.map.get("PATH") orelse "";
        if (ORIGINAL_PATH) |original_path| {
            original_path.* = PATH;
        }

        const found_node = this_bundler.env.loadNodeJSConfig(
            this_bundler.fs,
            if (force_using_bun) bun_node_dir ++ "/node" else "",
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
            new_path_len += bun_node_dir.len + 1;
        }

        var new_path = try std.ArrayList(u8).initCapacity(ctx.allocator, new_path_len);

        if (needs_to_force_bun) {
            createFakeTemporaryNodeExecutable(&new_path, &optional_bun_self_path) catch unreachable;
            if (!force_using_bun) {
                this_bundler.env.map.put("NODE", bun_node_dir ++ "/node") catch unreachable;
                this_bundler.env.map.put("npm_node_execpath", bun_node_dir ++ "/node") catch unreachable;
                this_bundler.env.map.put("npm_execpath", optional_bun_self_path) catch unreachable;
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

        this_bundler.env.map.put("PATH", new_path.items) catch unreachable;
    }

    pub fn completions(ctx: Command.Context, default_completions: ?[]const string, reject_list: []const string, comptime filter: Filter) !ShellCompletions {
        var shell_out = ShellCompletions{};
        if (filter != .script_exclude) {
            if (default_completions) |defaults| {
                shell_out.commands = defaults;
            }
        }

        var args = ctx.args;

        var this_bundler = bundler.Bundler.init(ctx.allocator, ctx.log, args, null) catch return shell_out;
        this_bundler.options.env.behavior = Api.DotEnvBehavior.load_all;
        this_bundler.options.env.prefix = "";
        this_bundler.env.quiet = true;

        this_bundler.resolver.care_about_bin_folder = true;
        this_bundler.resolver.care_about_scripts = true;
        this_bundler.resolver.store_fd = true;
        defer {
            this_bundler.resolver.care_about_bin_folder = false;
            this_bundler.resolver.care_about_scripts = false;
        }
        this_bundler.configureLinker();

        var root_dir_info = (this_bundler.resolver.readDirInfo(this_bundler.fs.top_level_dir) catch null) orelse return shell_out;

        {
            this_bundler.env.loadProcess();

            if (this_bundler.env.map.get("NODE_ENV")) |node_env| {
                if (strings.eqlComptime(node_env, "production")) {
                    this_bundler.options.production = true;
                }
            }
        }

        const ResultList = bun.StringArrayHashMap(void);

        if (this_bundler.env.map.get("SHELL")) |shell| {
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
            for (this_bundler.resolver.binDirs()) |bin_path| {
                if (this_bundler.resolver.readDirInfo(bin_path) catch null) |bin_dir| {
                    if (bin_dir.getEntriesConst()) |entries| {
                        var iter = entries.data.iterator();
                        var has_copied = false;
                        var dir_slice: string = "";
                        while (iter.next()) |entry| {
                            const value = entry.value_ptr.*;
                            if (value.kind(&this_bundler.fs.fs, true) == .file) {
                                if (!has_copied) {
                                    bun.copy(u8, &path_buf, value.dir);
                                    dir_slice = path_buf[0..value.dir.len];
                                    if (!strings.endsWithChar(value.dir, std.fs.path.sep)) {
                                        dir_slice = path_buf[0 .. value.dir.len + 1];
                                    }
                                    has_copied = true;
                                }

                                const base = value.base();
                                bun.copy(u8, path_buf[dir_slice.len..], base);
                                path_buf[dir_slice.len + base.len] = 0;
                                var slice = path_buf[0 .. dir_slice.len + base.len :0];
                                if (!(bun.sys.isExecutableFilePath(slice))) continue;
                                // we need to dupe because the string pay point to a pointer that only exists in the current scope
                                _ = try results.getOrPut(this_bundler.fs.filename_store.append(@TypeOf(base), base) catch continue);
                            }
                        }
                    }
                }
            }
        }

        if (filter == Filter.all_plus_bun_js or filter == Filter.bun_js) {
            if (this_bundler.resolver.readDirInfo(this_bundler.fs.top_level_dir) catch null) |dir_info| {
                if (dir_info.getEntriesConst()) |entries| {
                    var iter = entries.data.iterator();

                    while (iter.next()) |entry| {
                        const value = entry.value_ptr.*;
                        const name = value.base();
                        if (name[0] != '.' and this_bundler.options.loader(std.fs.path.extension(name)).canBeRunByBun() and
                            !strings.contains(name, ".config") and
                            !strings.contains(name, ".d.ts") and
                            !strings.contains(name, ".d.mts") and
                            !strings.contains(name, ".d.cts") and
                            value.kind(&this_bundler.fs.fs, true) == .file)
                        {
                            _ = try results.getOrPut(this_bundler.fs.filename_store.append(@TypeOf(name), name) catch continue);
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
                    if (this_bundler.env.map.get("MAX_DESCRIPTION_LEN")) |max| {
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

                        var entry_item = results.getOrPutAssumeCapacity(key);

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

        var all_keys = results.keys();

        strings.sortAsc(all_keys);
        shell_out.commands = all_keys;
        shell_out.descriptions = try descriptions.toOwnedSlice();

        return shell_out;
    }

    pub fn printHelp(package_json: ?*PackageJSON) void {
        const intro_text =
            \\<b>Usage<r>: <b><green>bun run<r> <cyan>[flags]<r> \<file or script\>
        ;

        const outro_text =
            \\<b>Examples:<r>
            \\  <d>Run a JavaScript or TypeScript file<r>
            \\  <b><green>bun run<r> <blue>./index.js<r>
            \\  <b><green>bun run<r> <blue>./index.tsx<r>
            \\
            \\  <d>Run a package.json script<r>
            \\  <b><green>bun run <blue>dev<r>
            \\  <b><green>bun run <blue>lint<r>
            \\
            \\Full documentation is available at <magenta>https://bun.sh/docs/cli/run<r>
            \\
        ;

        Output.pretty(intro_text ++ "\n\n", .{});
        Output.flush();
        Output.pretty("<b>Flags:<r>", .{});
        Output.flush();
        clap.simpleHelp(&Arguments.run_params);

        if (package_json) |pkg| {
            if (pkg.scripts) |scripts| {
                var display_name = pkg.name;

                if (display_name.len == 0) {
                    display_name = std.fs.path.basename(pkg.source.path.name.dir);
                }

                var iterator = scripts.iterator();

                if (scripts.count() > 0) {
                    Output.pretty("\n\n<b>package.json scripts ({d} found):<r>", .{scripts.count()});
                    // Output.prettyln("<r><blue><b>{s}<r> scripts:<r>\n", .{display_name});
                    while (iterator.next()) |entry| {
                        Output.prettyln("\n", .{});
                        Output.prettyln("  <d>$</r> bun run<r> <blue>{s}<r>\n", .{entry.key_ptr.*});
                        Output.prettyln("  <d>  {s}<r>\n", .{entry.value_ptr.*});
                    }

                    // Output.prettyln("\n<d>{d} scripts<r>", .{scripts.count()});

                    Output.flush();

                    // return true;
                } else {
                    Output.prettyln("<r><yellow>No \"scripts\" found in package.json.<r>", .{});
                    Output.flush();
                    // return true;
                }
            }
        }
        Output.pretty("\n\n" ++ outro_text, .{});
        Output.flush();
    }

    pub fn exec(ctx_: Command.Context, comptime bin_dirs_only: bool, comptime log_errors: bool) !bool {
        var ctx = ctx_;
        // Step 1. Figure out what we're trying to run
        var positionals = ctx.positionals;
        if (positionals.len > 0 and strings.eqlComptime(positionals[0], "run") or strings.eqlComptime(positionals[0], "r")) {
            positionals = positionals[1..];
        }

        var script_name_to_search: string = "";

        if (positionals.len > 0) {
            script_name_to_search = positionals[0];
        }

        const passthrough = ctx.passthrough;
        const force_using_bun = ctx.debug.run_in_bun;

        // This doesn't cover every case
        if ((script_name_to_search.len == 1 and script_name_to_search[0] == '.') or
            (script_name_to_search.len == 2 and @as(u16, @bitCast(script_name_to_search[0..2].*)) == @as(u16, @bitCast([_]u8{ '.', '/' }))))
        {
            Run.boot(ctx, ".") catch |err| {
                if (Output.enable_ansi_colors) {
                    ctx.log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), true) catch {};
                } else {
                    ctx.log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), false) catch {};
                }

                Output.prettyErrorln("<r><red>error<r>: Failed to run <b>{s}<r> due to error <b>{s}<r>", .{
                    script_name_to_search,
                    @errorName(err),
                });
                Global.exit(1);
            };
            return true;
        }

        if (log_errors or force_using_bun) {
            if (script_name_to_search.len > 0) {
                possibly_open_with_bun_js: {
                    const ext = std.fs.path.extension(script_name_to_search);
                    var has_loader = false;
                    if (!force_using_bun) {
                        if (options.defaultLoaders.get(ext)) |load| {
                            has_loader = true;
                            if (!load.canBeRunByBun())
                                break :possibly_open_with_bun_js;
                            // if there are preloads, allow weirdo file extensions
                        } else {
                            // you can have package.json scripts with file extensions in the name
                            // eg "foo.zip"
                            // in those cases, we don't know
                            if (ext.len == 0 or strings.containsChar(script_name_to_search, ':'))
                                break :possibly_open_with_bun_js;
                        }
                    }

                    var file_path = script_name_to_search;
                    var must_normalize = false;
                    const file_: anyerror!std.fs.File = brk: {
                        if (std.fs.path.isAbsolute(script_name_to_search)) {
                            must_normalize = Environment.isWindows;
                            break :brk bun.openFile(script_name_to_search, .{ .mode = .read_only });
                        } else {
                            const cwd = bun.getcwd(&path_buf) catch break :possibly_open_with_bun_js;
                            path_buf[cwd.len] = std.fs.path.sep_posix;
                            var parts = [_]string{script_name_to_search};
                            file_path = resolve_path.joinAbsStringBuf(
                                path_buf[0 .. cwd.len + 1],
                                &path_buf2,
                                &parts,
                                .loose,
                            );
                            if (file_path.len == 0) break :possibly_open_with_bun_js;
                            path_buf2[file_path.len] = 0;
                            var file_pathZ = path_buf2[0..file_path.len :0];
                            break :brk bun.openFileZ(file_pathZ, .{ .mode = .read_only });
                        }
                    };

                    const file = file_ catch break :possibly_open_with_bun_js;

                    if (!force_using_bun) {
                        // Due to preload, we don't know if they intend to run
                        // this as a script or as a regular file
                        // once we know it's a file, check if they have any preloads
                        if (ext.len > 0 and !has_loader) {
                            if (!ctx.debug.loaded_bunfig) {
                                try bun.CLI.Arguments.loadConfigPath(ctx.allocator, true, "bunfig.toml", &ctx, .RunCommand);
                            }

                            if (ctx.preloads.len == 0)
                                break :possibly_open_with_bun_js;
                        }

                        // ignore the shebang if they explicitly passed `--bun`
                        // "White space after #! is optional."
                        var shebang_buf: [64]u8 = undefined;
                        const shebang_size = file.pread(&shebang_buf, 0) catch |err| {
                            if (!ctx.debug.silent)
                                Output.prettyErrorln("<r><red>error<r>: Failed to read file <b>{s}<r> due to error <b>{s}<r>", .{ file_path, @errorName(err) });
                            Global.exit(1);
                        };

                        var shebang: string = shebang_buf[0..shebang_size];

                        shebang = std.mem.trim(u8, shebang, " \r\n\t");
                        if (strings.hasPrefixComptime(shebang, "#!")) {
                            const first_arg: string = if (bun.argv().len > 0) bun.span(bun.argv()[0]) else "";
                            const filename = std.fs.path.basename(first_arg);
                            // are we attempting to run the script with bun?
                            if (!strings.contains(shebang, filename)) {
                                break :possibly_open_with_bun_js;
                            }
                        }
                    }

                    Global.configureAllocator(.{ .long_running = true });
                    var out_path = ctx.allocator.dupe(u8, file_path) catch unreachable;
                    if (must_normalize) {
                        if (comptime Environment.isWindows) {
                            std.mem.replaceScalar(u8, out_path, std.fs.path.sep_windows, std.fs.path.sep_posix);
                        }
                    }
                    Run.boot(ctx, out_path) catch |err| {
                        if (Output.enable_ansi_colors) {
                            ctx.log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), true) catch {};
                        } else {
                            ctx.log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), false) catch {};
                        }

                        Output.prettyErrorln("<r><red>error<r>: Failed to run <b>{s}<r> due to error <b>{s}<r>", .{
                            std.fs.path.basename(file_path),
                            @errorName(err),
                        });
                        Global.exit(1);
                    };

                    return true;
                }
            }
        }

        Global.configureAllocator(.{ .long_running = false });

        var ORIGINAL_PATH: string = "";
        var this_bundler: bundler.Bundler = undefined;
        var root_dir_info = try configureEnvForRun(ctx, &this_bundler, null, log_errors);
        try configurePathForRun(ctx, root_dir_info, &this_bundler, &ORIGINAL_PATH, root_dir_info.abs_path, force_using_bun);
        this_bundler.env.map.put("npm_lifecycle_event", script_name_to_search) catch unreachable;
        if (root_dir_info.enclosing_package_json) |package_json| {
            if (package_json.scripts) |scripts| {
                switch (script_name_to_search.len) {
                    0 => {
                        // naked "bun run"
                        RunCommand.printHelp(package_json);
                        return true;
                    },
                    else => {
                        if (scripts.get(script_name_to_search)) |script_content| {
                            // allocate enough to hold "post${scriptname}"
                            var temp_script_buffer = try std.fmt.allocPrint(ctx.allocator, "ppre{s}", .{script_name_to_search});
                            defer ctx.allocator.free(temp_script_buffer);

                            if (scripts.get(temp_script_buffer[1..])) |prescript| {
                                if (!try runPackageScriptForeground(
                                    ctx.allocator,
                                    prescript,
                                    temp_script_buffer[1..],
                                    this_bundler.fs.top_level_dir,
                                    this_bundler.env,
                                    &.{},
                                    ctx.debug.silent,
                                )) {
                                    return false;
                                }
                            }

                            if (!try runPackageScriptForeground(
                                ctx.allocator,
                                script_content,
                                script_name_to_search,
                                this_bundler.fs.top_level_dir,
                                this_bundler.env,
                                passthrough,
                                ctx.debug.silent,
                            )) return false;

                            temp_script_buffer[0.."post".len].* = "post".*;

                            if (scripts.get(temp_script_buffer)) |postscript| {
                                if (!try runPackageScriptForeground(
                                    ctx.allocator,
                                    postscript,
                                    temp_script_buffer,
                                    this_bundler.fs.top_level_dir,
                                    this_bundler.env,
                                    &.{},
                                    ctx.debug.silent,
                                )) {
                                    return false;
                                }
                            }

                            return true;
                        } else if ((script_name_to_search.len > 1 and script_name_to_search[0] == '/') or
                            (script_name_to_search.len > 2 and script_name_to_search[0] == '.' and script_name_to_search[1] == '/'))
                        {
                            Run.boot(ctx, ctx.allocator.dupe(u8, script_name_to_search) catch unreachable) catch |err| {
                                if (Output.enable_ansi_colors) {
                                    ctx.log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), true) catch {};
                                } else {
                                    ctx.log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), false) catch {};
                                }

                                Output.prettyErrorln("<r><red>error<r>: Failed to run <b>{s}<r> due to error <b>{s}<r>", .{
                                    std.fs.path.basename(script_name_to_search),
                                    @errorName(err),
                                });
                                Global.exit(1);
                            };
                        }
                    },
                }
            }
        }

        if (script_name_to_search.len == 0) {
            if (comptime log_errors) {
                Output.prettyError("<r>No \"scripts\" in package.json found.\n", .{});
                Global.exit(0);
            }

            return false;
        }

        const PATH = this_bundler.env.map.get("PATH") orelse "";
        var path_for_which = PATH;
        if (comptime bin_dirs_only) {
            if (ORIGINAL_PATH.len < PATH.len) {
                path_for_which = PATH[0 .. PATH.len - (ORIGINAL_PATH.len + 1)];
            } else {
                path_for_which = "";
            }
        }

        if (path_for_which.len > 0) {
            if (which(&path_buf, path_for_which, this_bundler.fs.top_level_dir, script_name_to_search)) |destination| {
                // var file = std.fs.openFileAbsoluteZ(destination, .{ .mode = .read_only }) catch |err| {
                //     if (!log_errors) return false;

                //     Output.prettyErrorln("<r>error: <red>{s}<r> opening file: \"{s}\"", .{ err, std.mem.span(destination) });
                //     Output.flush();
                //     return err;
                // };
                // // var outbuf = bun.getFdPath(file.handle, &path_buf2) catch |err| {
                // //     if (!log_errors) return false;
                // //     Output.prettyErrorln("<r>error: <red>{s}<r> resolving file: \"{s}\"", .{ err, std.mem.span(destination) });
                // //     Output.flush();
                // //     return err;
                // // };

                // // file.close();

                const out = bun.asByteSlice(destination);
                return try runBinary(
                    ctx,
                    try this_bundler.fs.dirname_store.append(@TypeOf(out), out),
                    this_bundler.fs.top_level_dir,
                    this_bundler.env,
                    passthrough,
                );
            }
        }

        if (ctx.runtime_options.if_present) {
            return true;
        }

        if (comptime log_errors) {
            Output.prettyError("<r><red>error<r><d>:<r> missing script \"<b>{s}<r>\"\n", .{script_name_to_search});
            Global.exit(1);
        }

        return false;
    }
};

test "replacePackageManagerRun" {
    var copy_script = std.ArrayList(u8).init(default_allocator);

    {
        copy_script.clearRetainingCapacity();
        try RunCommand.replacePackageManagerRun(&copy_script, "yarn run foo");
        try std.testing.expectEqualStrings(copy_script.items, "bun run foo");
    }

    {
        copy_script.clearRetainingCapacity();
        try RunCommand.replacePackageManagerRun(&copy_script, "yarn install foo");
        try std.testing.expectEqualStrings(copy_script.items, "yarn install foo");
    }

    {
        copy_script.clearRetainingCapacity();
        try RunCommand.replacePackageManagerRun(&copy_script, "yarn --prod");
        try std.testing.expectEqualStrings(copy_script.items, "yarn --prod");
    }

    {
        copy_script.clearRetainingCapacity();
        try RunCommand.replacePackageManagerRun(&copy_script, "yarn -prod");
        try std.testing.expectEqualStrings(copy_script.items, "yarn -prod");
    }

    {
        copy_script.clearRetainingCapacity();
        try RunCommand.replacePackageManagerRun(&copy_script, "yarn");
        try std.testing.expectEqualStrings(copy_script.items, "yarn");
    }

    {
        copy_script.clearRetainingCapacity();
        try RunCommand.replacePackageManagerRun(&copy_script, "yarn ");
        try std.testing.expectEqualStrings(copy_script.items, "yarn ");
    }

    {
        copy_script.clearRetainingCapacity();
        try RunCommand.replacePackageManagerRun(&copy_script, "npm ");
        try std.testing.expectEqualStrings(copy_script.items, "npm ");
    }

    {
        copy_script.clearRetainingCapacity();
        try RunCommand.replacePackageManagerRun(&copy_script, "npm bacon run");
        try std.testing.expectEqualStrings(copy_script.items, "npm bacon run");
    }

    {
        copy_script.clearRetainingCapacity();
        try RunCommand.replacePackageManagerRun(&copy_script, "yarn bacon foo");
        try std.testing.expectEqualStrings(copy_script.items, "bun run bacon foo");
    }

    {
        copy_script.clearRetainingCapacity();
        try RunCommand.replacePackageManagerRun(&copy_script, "yarn npm run foo");
        try std.testing.expectEqualStrings(copy_script.items, "yarn npm run foo");
    }

    {
        copy_script.clearRetainingCapacity();
        try RunCommand.replacePackageManagerRun(&copy_script, "npm run foo");
        try std.testing.expectEqualStrings(copy_script.items, "bun run foo");
    }

    {
        copy_script.clearRetainingCapacity();
        try RunCommand.replacePackageManagerRun(&copy_script, "bpm run foo");
        try std.testing.expectEqualStrings(copy_script.items, "bpm run foo");
    }

    {
        copy_script.clearRetainingCapacity();
        try RunCommand.replacePackageManagerRun(&copy_script, "pnpm run foo");
        try std.testing.expectEqualStrings(copy_script.items, "bun run foo");
    }

    {
        copy_script.clearRetainingCapacity();
        try RunCommand.replacePackageManagerRun(&copy_script, "foopnpm run foo");
        try std.testing.expectEqualStrings(copy_script.items, "foopnpm run foo");
    }

    {
        copy_script.clearRetainingCapacity();
        try RunCommand.replacePackageManagerRun(&copy_script, "foopnpm rune foo");
        try std.testing.expectEqualStrings(copy_script.items, "foopnpm rune foo");
    }

    {
        copy_script.clearRetainingCapacity();
        try RunCommand.replacePackageManagerRun(&copy_script, "foopnpm ru foo");
        try std.testing.expectEqualStrings(copy_script.items, "foopnpm ru foo");
    }

    {
        copy_script.clearRetainingCapacity();
        try RunCommand.replacePackageManagerRun(&copy_script, "'npm run foo'");
        try std.testing.expectEqualStrings(copy_script.items, "'bun run foo'");
    }
}
