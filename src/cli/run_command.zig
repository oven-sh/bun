const bun = @import("../global.zig");
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

const lex = @import("../js_lexer.zig");
const logger = @import("../logger.zig");

const options = @import("../options.zig");
const js_parser = @import("../js_parser.zig");
const json_parser = @import("../json_parser.zig");
const js_printer = @import("../js_printer.zig");
const js_ast = @import("../js_ast.zig");
const linker = @import("../linker.zig");
const panicky = @import("../panic_handler.zig");
const sync = @import("../sync.zig");
const Api = @import("../api/schema.zig").Api;
const resolve_path = @import("../resolver/resolve_path.zig");
const configureTransformOptionsForBun = @import("../bun.js/config.zig").configureTransformOptionsForBun;
const Command = @import("../cli.zig").Command;
const bundler = @import("../bundler.zig");
const NodeModuleBundle = @import("../node_module_bundle.zig").NodeModuleBundle;
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

const yarn_commands: []u64 = @import("./list-of-yarn-commands.zig").all_yarn_commands;

const ShellCompletions = @import("./shell_completions.zig");

pub const RunCommand = struct {
    const shells_to_search = &[_]string{
        "bash",
        "sh",
        "zsh",
    };

    pub fn findShell(PATH: string, cwd: string) ?string {
        inline for (shells_to_search) |shell| {
            if (which(&path_buf, PATH, cwd, shell)) |shell_| {
                return shell_;
            }
        }

        const Try = struct {
            pub fn shell(str: stringZ) bool {
                std.os.accessZ(str, std.os.X_OK) catch return false;
                return true;
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

    const BUN_BIN_NAME = if (Environment.isDebug) "bun-debug" else "bun";
    const BUN_RUN = std.fmt.comptimePrint("{s} run", .{BUN_BIN_NAME});

    // Look for invocations of any:
    // - yarn run
    // - yarn $cmdName
    // - pnpm run
    // - npm run
    // Replace them with "bun run"

    pub inline fn replacePackageManagerRun(copy_script: *std.ArrayList(u8), script: string) !void {
        var entry_i: usize = 0;
        var delimiter: u8 = ' ';

        while (entry_i < script.len) {
            const start = entry_i;

            switch (script[entry_i]) {
                'y' => {
                    if (delimiter > 0) {
                        if (entry_i + "arn".len < script.len) {
                            var remainder = script[start..];
                            if (remainder.len > "yarn ".len and strings.eqlComptimeIgnoreLen(remainder[0.."yarn ".len], "yarn ")) {
                                const next = remainder["yarn ".len..];
                                // We have yarn
                                // Find the next space
                                if (strings.indexOfChar(next, ' ')) |space| {
                                    const yarn_cmd = next[0..space];
                                    if (strings.eqlComptime(yarn_cmd, "run")) {
                                        try copy_script.appendSlice("bun run");
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
                                    if (std.mem.indexOfScalar(u64, yarn_commands, std.hash.Wyhash.hash(0, yarn_cmd)) == null) {
                                        try copy_script.appendSlice("bun run");
                                        try copy_script.append(' ');
                                        try copy_script.appendSlice(yarn_cmd);
                                        entry_i += "yarn ".len + yarn_cmd.len;
                                        delimiter = 0;
                                        continue;
                                    }
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
                        const npm_i = entry_i + "pm run ".len;
                        if (npm_i < script.len) {
                            const base = script[start..];
                            if (base.len > "npm run ".len) {
                                const remainder = base[0.."npm run ".len];
                                if (strings.eqlComptimeIgnoreLen(remainder, "npm run ")) {
                                    try copy_script.appendSlice("bun run ");
                                    entry_i += remainder.len;
                                    delimiter = 0;
                                    continue;
                                }
                            }
                        }
                    }

                    delimiter = 0;
                },
                'p' => {
                    if (delimiter > 0) {
                        const npm_i = entry_i + "npm run ".len;
                        if (npm_i < script.len) {
                            const remainder = script[start .. npm_i + 1];
                            if (remainder.len > npm_i and strings.eqlComptimeIgnoreLen(remainder, "pnpm run") and remainder[remainder.len - 1] == delimiter) {
                                try copy_script.appendSlice("bun run ");
                                entry_i += remainder.len;
                                delimiter = 0;
                                continue;
                            }
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

    pub fn runPackageScript(
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

        var combined_script: string = copy_script.items;

        if (passthrough.len > 0) {
            var combined_script_len: usize = script.len;
            for (passthrough) |p| {
                combined_script_len += p.len + 1;
            }
            var combined_script_buf = try allocator.alloc(u8, combined_script_len);
            std.mem.copy(u8, combined_script_buf, script);
            var remaining_script_buf = combined_script_buf[script.len..];
            for (passthrough) |part| {
                var p = part;
                remaining_script_buf[0] = ' ';
                std.mem.copy(u8, remaining_script_buf[1..], p);
                remaining_script_buf = remaining_script_buf[p.len + 1 ..];
            }
            combined_script = combined_script_buf;
        }

        var argv = [_]string{ shell_bin, "-c", combined_script };
        var child_process = std.ChildProcess.init(&argv, allocator);

        if (!silent) {
            Output.prettyErrorln("<r><d><magenta>$<r> <d><b>{s}<r>", .{combined_script});
            Output.flush();
        }

        var buf_map = try env.map.cloneToEnvMap(allocator);

        child_process.env_map = &buf_map;
        child_process.cwd = cwd;
        child_process.stderr_behavior = .Inherit;
        child_process.stdin_behavior = .Inherit;
        child_process.stdout_behavior = .Inherit;

        const result = child_process.spawnAndWait() catch |err| {
            Output.prettyErrorln("<r><red>error<r>: Failed to run script <b>{s}<r> due to error <b>{s}<r>", .{ name, @errorName(err) });
            Output.flush();
            return true;
        };

        if (result.Exited > 0) {
            Output.prettyErrorln("<r><red>Script error<r> <b>\"{s}\"<r> exited with {d} status<r>", .{ name, result.Exited });
            Output.flush();

            Global.exit(result.Exited);
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
            argv = array_list.toOwnedSlice();
        }

        var child_process = std.ChildProcess.init(argv, ctx.allocator);

        var buf_map = try env.map.cloneToEnvMap(ctx.allocator);
        child_process.cwd = cwd;
        child_process.env_map = &buf_map;
        child_process.stderr_behavior = .Inherit;
        child_process.stdin_behavior = .Inherit;
        child_process.stdout_behavior = .Inherit;

        const result = child_process.spawnAndWait() catch |err| {
            if (err == error.AccessDenied) {
                {
                    var stat = std.mem.zeroes(std.c.Stat);
                    const rc = bun.C.stat(std.meta.assumeSentinel(executable, 0), &stat);
                    if (rc == 0) {
                        if (std.os.S.ISDIR(stat.mode)) {
                            Output.prettyErrorln("<r><red>error<r>: Failed to run directory \"<b>{s}<r>\"\n", .{executable});
                            Global.exit(1);
                        }
                    }
                }
            }
            Output.prettyErrorln("<r><red>error<r>: Failed to run \"<b>{s}<r>\" due to error <b>{s}<r>", .{ std.fs.path.basename(executable), @errorName(err) });
            Global.exit(1);
        };

        if (result.Exited > 0) {
            Output.prettyErrorln("<r><red>error<r> \"<b>{s}<r>\" exited with {d} status<r>", .{ std.fs.path.basename(executable), result.Exited });
            Global.exit(result.Exited);
        }

        return true;
    }

    pub fn ls(ctx: Command.Context) !void {
        var args = ctx.args;
        args.node_modules_bundle_path = null;
        args.node_modules_bundle_path_server = null;
        args.generate_node_module_bundle = false;

        var this_bundler = try bundler.Bundler.init(ctx.allocator, ctx.log, args, null, null);
        this_bundler.options.env.behavior = Api.DotEnvBehavior.load_all;
        this_bundler.options.env.prefix = "";

        this_bundler.resolver.care_about_bin_folder = true;
        this_bundler.resolver.care_about_scripts = true;
        this_bundler.configureLinker();
    }

    pub const Filter = enum { script, bin, all, bun_js, all_plus_bun_js, script_and_descriptions, script_exclude };
    const DirInfo = @import("../resolver/dir_info.zig");
    pub fn configureEnvForRun(
        ctx: Command.Context,
        this_bundler: *bundler.Bundler,
        env: ?*DotEnv.Loader,
        ORIGINAL_PATH: *string,
        log_errors: bool,
    ) !*DirInfo {
        var args = ctx.args;
        args.node_modules_bundle_path = null;
        args.node_modules_bundle_path_server = null;
        args.generate_node_module_bundle = false;
        this_bundler.* = try bundler.Bundler.init(ctx.allocator, ctx.log, args, null, env);
        this_bundler.options.env.behavior = Api.DotEnvBehavior.load_all;
        this_bundler.env.quiet = true;
        this_bundler.options.env.prefix = "";

        this_bundler.resolver.care_about_bin_folder = true;
        this_bundler.resolver.care_about_scripts = true;
        this_bundler.configureLinker();

        var root_dir_info = this_bundler.resolver.readDirInfo(this_bundler.fs.top_level_dir) catch |err| {
            if (!log_errors) return error.CouldntReadCurrentDirectory;
            if (Output.enable_ansi_colors) {
                ctx.log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), true) catch {};
            } else {
                ctx.log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), false) catch {};
            }
            Output.prettyErrorln("Error loading directory: \"{s}\"", .{@errorName(err)});
            Output.flush();
            return err;
        } orelse {
            if (Output.enable_ansi_colors) {
                ctx.log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), true) catch {};
            } else {
                ctx.log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), false) catch {};
            }
            Output.prettyErrorln("Error loading current directory", .{});
            Output.flush();
            return error.CouldntReadCurrentDirectory;
        };

        var package_json_dir: string = "";

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

            if (root_dir_info.getEntries()) |dir| {
                // Run .env again if it exists in a parent dir
                if (this_bundler.options.production) {
                    this_bundler.env.load(&this_bundler.fs.fs, dir, false) catch {};
                } else {
                    this_bundler.env.load(&this_bundler.fs.fs, dir, true) catch {};
                }
            }
        }

        var bin_dirs = this_bundler.resolver.binDirs();

        if (root_dir_info.enclosing_package_json) |package_json| {
            if (root_dir_info.package_json == null) {
                // no trailing slash
                package_json_dir = std.mem.trimRight(u8, package_json.source.path.name.dir, "/");
            }
        }

        var PATH = this_bundler.env.map.get("PATH") orelse "";
        ORIGINAL_PATH.* = PATH;

        if (bin_dirs.len > 0 or package_json_dir.len > 0) {
            var new_path_len: usize = PATH.len + 2;
            for (bin_dirs) |bin| {
                new_path_len += bin.len + 1;
            }

            if (package_json_dir.len > 0) {
                new_path_len += package_json_dir.len + 1;
            }

            var new_path = try std.ArrayList(u8).initCapacity(ctx.allocator, new_path_len);

            {
                var needs_colon = false;
                if (package_json_dir.len > 0) {
                    defer needs_colon = true;
                    if (needs_colon) {
                        try new_path.append(':');
                    }
                    try new_path.appendSlice(package_json_dir);
                }

                var bin_dir_i: i32 = @intCast(i32, bin_dirs.len) - 1;
                // Iterate in reverse order
                // Directories are added to bin_dirs in top-down order
                // That means the parent-most node_modules/.bin will be first
                while (bin_dir_i >= 0) : (bin_dir_i -= 1) {
                    defer needs_colon = true;
                    if (needs_colon) {
                        try new_path.append(':');
                    }
                    try new_path.appendSlice(bin_dirs[@intCast(usize, bin_dir_i)]);
                }

                if (needs_colon) {
                    try new_path.append(':');
                }
                try new_path.appendSlice(PATH);
            }

            this_bundler.env.map.put("PATH", new_path.items) catch unreachable;
            PATH = new_path.items;
        }

        this_bundler.env.loadNodeJSConfig(this_bundler.fs) catch {};
        this_bundler.env.map.putDefault("npm_config_local_prefix", this_bundler.fs.top_level_dir) catch unreachable;

        // we have no way of knowing what version they're expecting without running the node executable
        // running the node executable is too slow
        // so we will just hardcode it to LTS
        this_bundler.env.map.putDefault(
            "npm_config_user_agent",
            // the use of npm/? is copying yarn
            // e.g.
            // > "yarn/1.22.4 npm/? node/v12.16.3 darwin x64",
            "bun/" ++ Global.package_json_version ++ " npm/? node/v16.14.0 " ++ Global.os_name ++ " " ++ Global.arch_name,
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

    pub fn completions(ctx: Command.Context, default_completions: ?[]const string, reject_list: []const string, comptime filter: Filter) !ShellCompletions {
        var shell_out = ShellCompletions{};
        if (filter != .script_exclude) {
            if (default_completions) |defaults| {
                shell_out.commands = defaults;
            }
        }

        var args = ctx.args;
        args.node_modules_bundle_path = null;
        args.node_modules_bundle_path_server = null;
        args.generate_node_module_bundle = false;

        var this_bundler = bundler.Bundler.init(ctx.allocator, ctx.log, args, null, null) catch return shell_out;
        this_bundler.options.env.behavior = Api.DotEnvBehavior.load_all;
        this_bundler.options.env.prefix = "";
        this_bundler.env.quiet = true;

        this_bundler.resolver.care_about_bin_folder = true;
        this_bundler.resolver.care_about_scripts = true;
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

        const ResultList = std.StringArrayHashMap(void);

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
                            if (value.kind(&this_bundler.fs.fs) == .file) {
                                if (!has_copied) {
                                    std.mem.copy(u8, &path_buf, value.dir);
                                    dir_slice = path_buf[0..value.dir.len];
                                    if (!strings.endsWithChar(value.dir, std.fs.path.sep)) {
                                        dir_slice = path_buf[0 .. value.dir.len + 1];
                                    }
                                    has_copied = true;
                                }

                                const base = value.base();
                                std.mem.copy(u8, path_buf[dir_slice.len..], base);
                                path_buf[dir_slice.len + base.len] = 0;
                                var slice = path_buf[0 .. dir_slice.len + base.len :0];
                                std.os.accessZ(slice, std.os.X_OK) catch continue;
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
                        if (name[0] != '.' and this_bundler.options.loader(std.fs.path.extension(name)).isJavaScriptLike() and
                            !strings.contains(name, ".config") and
                            !strings.contains(name, ".d.ts") and
                            value.kind(&this_bundler.fs.fs) == .file)
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
        shell_out.descriptions = descriptions.toOwnedSlice();

        return shell_out;
    }

    pub fn exec(ctx: Command.Context, comptime bin_dirs_only: bool, comptime log_errors: bool) !bool {
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

        if (comptime log_errors) {
            if (script_name_to_search.len > 0) {
                possibly_open_with_bun_js: {
                    if (options.defaultLoaders.get(std.fs.path.extension(script_name_to_search))) |loader| {
                        if (loader.isJavaScriptLike()) {
                            var file_path = script_name_to_search;
                            const file_: std.fs.File.OpenError!std.fs.File = brk: {
                                if (script_name_to_search[0] == std.fs.path.sep) {
                                    break :brk std.fs.openFileAbsolute(script_name_to_search, .{ .mode = .read_only });
                                } else {
                                    const cwd = std.os.getcwd(&path_buf) catch break :possibly_open_with_bun_js;
                                    path_buf[cwd.len] = std.fs.path.sep;
                                    var parts = [_]string{script_name_to_search};
                                    file_path = resolve_path.joinAbsStringBuf(
                                        path_buf[0 .. cwd.len + 1],
                                        &path_buf2,
                                        &parts,
                                        .auto,
                                    );
                                    if (file_path.len == 0) break :possibly_open_with_bun_js;
                                    path_buf2[file_path.len] = 0;
                                    var file_pathZ = path_buf2[0..file_path.len :0];
                                    break :brk std.fs.openFileAbsoluteZ(file_pathZ, .{ .mode = .read_only });
                                }
                            };

                            const file = file_ catch break :possibly_open_with_bun_js;
                            // "White space after #! is optional."
                            var shebang_buf: [64]u8 = undefined;
                            const shebang_size = file.pread(&shebang_buf, 0) catch |err| {
                                Output.prettyErrorln("<r><red>error<r>: Failed to read file <b>{s}<r> due to error <b>{s}<r>", .{ file_path, @errorName(err) });
                                Global.exit(1);
                            };

                            var shebang: string = shebang_buf[0..shebang_size];
                            shebang = std.mem.trim(u8, shebang, " \r\n\t");
                            if (shebang.len == 0) break :possibly_open_with_bun_js;

                            if (shebang.len > 2 and strings.eqlComptimeIgnoreLen(shebang[0..2], "#!")) {
                                const first_arg: string = if (std.os.argv.len > 0) bun.span(std.os.argv[0]) else "";
                                const filename = std.fs.path.basename(first_arg);
                                // are we attempting to run the script with bun?
                                if (!strings.contains(shebang, filename)) {
                                    break :possibly_open_with_bun_js;
                                }
                            }
                            Global.configureAllocator(.{ .long_running = true });

                            Run.boot(ctx, file, ctx.allocator.dupe(u8, file_path) catch unreachable) catch |err| {
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

                            // If we get here, then we run it with bun.js

                        }
                    }
                }
            }
        }

        Global.configureAllocator(.{ .long_running = false });

        var did_print = false;
        var ORIGINAL_PATH: string = "";
        var this_bundler: bundler.Bundler = undefined;
        var root_dir_info = try configureEnvForRun(ctx, &this_bundler, null, &ORIGINAL_PATH, log_errors);
        if (root_dir_info.enclosing_package_json) |package_json| {
            if (package_json.scripts) |scripts| {
                switch (script_name_to_search.len) {
                    0 => {
                        var display_name = package_json.name;

                        if (display_name.len == 0) {
                            display_name = std.fs.path.basename(package_json.source.path.name.dir);
                        }

                        var iterator = scripts.iterator();

                        if (scripts.count() > 0) {
                            did_print = true;

                            Output.prettyln("<r><blue><b>{s}<r> scripts:<r>\n", .{display_name});
                            while (iterator.next()) |entry| {
                                Output.prettyln("\n", .{});
                                Output.prettyln(" bun run <blue>{s}<r>\n", .{entry.key_ptr.*});
                                Output.prettyln(" <d>  {s}<r>\n", .{entry.value_ptr.*});
                            }

                            Output.prettyln("\n<d>{d} scripts<r>", .{scripts.count()});

                            Output.flush();

                            return true;
                        } else {
                            Output.prettyln("<r><blue><b>{s}<r> has no \"scripts\" in package.json.", .{display_name});
                            Output.flush();
                            return true;
                        }
                    },
                    else => {
                        if (scripts.get(script_name_to_search)) |script_content| {
                            // allocate enough to hold "post${scriptname}"
                            var temp_script_buffer = try std.fmt.allocPrint(ctx.allocator, "ppre{s}", .{script_name_to_search});

                            if (scripts.get(temp_script_buffer[1..])) |prescript| {
                                if (!try runPackageScript(
                                    ctx.allocator,
                                    prescript,
                                    temp_script_buffer[1..],
                                    this_bundler.fs.top_level_dir,
                                    this_bundler.env,
                                    passthrough,
                                    ctx.debug.silent,
                                )) {
                                    return false;
                                }
                            }

                            if (!try runPackageScript(
                                ctx.allocator,
                                script_content,
                                script_name_to_search,
                                this_bundler.fs.top_level_dir,
                                this_bundler.env,
                                passthrough,
                                ctx.debug.silent,
                            )) return false;

                            std.mem.copy(u8, temp_script_buffer, "post");

                            if (scripts.get(temp_script_buffer)) |postscript| {
                                if (!try runPackageScript(
                                    ctx.allocator,
                                    postscript,
                                    temp_script_buffer,
                                    this_bundler.fs.top_level_dir,
                                    this_bundler.env,
                                    passthrough,
                                    ctx.debug.silent,
                                )) {
                                    return false;
                                }
                            }

                            return true;
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
            path_for_which = "";

            if (ORIGINAL_PATH.len < PATH.len) {
                path_for_which = PATH[0 .. PATH.len - (ORIGINAL_PATH.len + 1)];
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
                // // var outbuf = std.os.getFdPath(file.handle, &path_buf2) catch |err| {
                // //     if (!log_errors) return false;
                // //     Output.prettyErrorln("<r>error: <red>{s}<r> resolving file: \"{s}\"", .{ err, std.mem.span(destination) });
                // //     Output.flush();
                // //     return err;
                // // };

                // // file.close();

                const out = std.mem.span(destination);
                return try runBinary(
                    ctx,
                    try this_bundler.fs.dirname_store.append(@TypeOf(out), out),
                    this_bundler.fs.top_level_dir,
                    this_bundler.env,
                    passthrough,
                );
            }
        }

        if (comptime log_errors) {
            Output.prettyError("<r><red>error:<r> Missing script \"<b>{s}<r>\"\n", .{script_name_to_search});
            Global.exit(0);
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
