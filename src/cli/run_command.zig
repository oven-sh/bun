usingnamespace @import("../global.zig");
const std = @import("std");

const lex = @import("../js_lexer.zig");
const logger = @import("../logger.zig");
const alloc = @import("../alloc.zig");
const options = @import("../options.zig");
const js_parser = @import("../js_parser.zig");
const json_parser = @import("../json_parser.zig");
const js_printer = @import("../js_printer.zig");
const js_ast = @import("../js_ast.zig");
const linker = @import("../linker.zig");
usingnamespace @import("../ast/base.zig");
usingnamespace @import("../defines.zig");
const panicky = @import("../panic_handler.zig");
const sync = @import(".././sync.zig");
const Api = @import("../api/schema.zig").Api;
const resolve_path = @import(".././resolver/resolve_path.zig");
const configureTransformOptionsForBun = @import(".././javascript/jsc/config.zig").configureTransformOptionsForBun;
const Command = @import("../cli.zig").Command;
const bundler = @import("../bundler.zig");
const NodeModuleBundle = @import("../node_module_bundle.zig").NodeModuleBundle;
const DotEnv = @import("../env_loader.zig");
const which = @import("../which.zig").which;

var path_buf: [std.fs.MAX_PATH_BYTES]u8 = undefined;
var path_buf2: [std.fs.MAX_PATH_BYTES]u8 = undefined;
const NpmArgs = struct {
    // https://github.com/npm/rfcs/blob/main/implemented/0021-reduce-lifecycle-script-environment.md#detailed-explanation
    pub const package_name: string = "npm_package_name";
    pub const package_version: string = "npm_package_version";
};

const yarn_commands: []u64 = @import("./list-of-yarn-commands.zig").all_yarn_commands;

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

        return null;
    }

    const BUN_BIN_NAME = if (isDebug) "bun-debug" else "bun";
    const BUN_RUN = std.fmt.comptimePrint("{s} run", .{BUN_BIN_NAME});

    pub fn runPackageScript(
        ctx: Command.Context,
        original_script: string,
        name: string,
        cwd: string,
        env: *DotEnv.Loader,
        passthrough: []const string,
        silent: bool,
    ) !bool {
        const shell_bin = findShell(env.map.get("PATH") orelse "", cwd) orelse return error.MissingShell;

        var script = original_script;
        var copy_script = try std.ArrayList(u8).initCapacity(ctx.allocator, script.len);

        // Look for invocations of any:
        // - yarn run
        // - pnpm run
        // - npm run
        // Replace them with "bun run"
        // If "yarn" exists and
        var splitter = std.mem.split(u8, script, " ");
        var is_first = true;
        var skip_next = false;
        while (splitter.next()) |entry_| {
            const skip = skip_next;
            skip_next = false;
            var entry = entry_;

            if (strings.startsWith(entry, "\\\"") and strings.endsWith(entry, "\\\"") and entry.len > 4) {
                entry = entry[2 .. entry.len - 2];
            }

            if (strings.startsWith(entry, "'") and strings.endsWith(entry, "'") and entry.len > 2) {
                entry = entry[1 .. entry.len - 1];
            }

            var replace = false;
            defer is_first = false;

            if (!skip) {
                replacer: {
                    if (strings.eqlComptime(entry, "yarn")) {
                        var _split = splitter;

                        if (_split.next()) |entry2| {
                            if (strings.eqlComptime(entry2, "run")) {
                                replace = true;
                                _ = splitter.next();

                                break :replacer;
                            }

                            // "yarn npm" is a valid command
                            // this will confuse us
                            // so when we have a valid yarn command, rather than try to carefully parse & handle each version's arguments
                            // we just skip the command that says "yarn npm"
                            // this works because yarn is the only package manager that lets you omit "run"
                            // (bun is not a package manager)
                            const hash = std.hash.Wyhash.hash(0, entry2);
                            if (std.mem.indexOfScalar(u64, yarn_commands, hash) != null) {
                                skip_next = true;
                                break :replacer;
                            }

                            replace = true;
                            break :replacer;
                        }
                    }

                    if (strings.eqlComptime(entry, "pnpm")) {
                        var _split = splitter;

                        if (_split.next()) |entry2| {
                            if (strings.eqlComptime(entry2, "run")) {
                                replace = true;
                                _ = splitter.next();

                                break :replacer;
                            }
                        }
                    }

                    if (strings.eqlComptime(entry, "npm")) {
                        var _split = splitter;

                        if (_split.next()) |entry2| {
                            if (strings.eqlComptime(entry2, "run")) {
                                replace = true;
                                _ = splitter.next();
                                break :replacer;
                            }
                        }
                    }
                }
            }

            if (replace) {
                if (!is_first) {
                    copy_script.append(' ') catch unreachable;
                }
                try copy_script.appendSlice(BUN_RUN);
            } else {
                if (!is_first) {
                    copy_script.append(' ') catch unreachable;
                }

                try copy_script.appendSlice(entry);
            }
        }

        var combined_script: string = copy_script.items;

        if (passthrough.len > 0) {
            var combined_script_len: usize = script.len;
            for (passthrough) |p, i| {
                combined_script_len += p.len + 1;
            }
            var combined_script_buf = try ctx.allocator.alloc(u8, combined_script_len);
            std.mem.copy(u8, combined_script_buf, script);
            var remaining_script_buf = combined_script_buf[script.len..];
            for (passthrough) |p| {
                remaining_script_buf[0] = ' ';
                std.mem.copy(u8, remaining_script_buf[1..], p);
                remaining_script_buf = remaining_script_buf[p.len + 1 ..];
            }
            combined_script = combined_script_buf;
        }

        var argv = [_]string{ shell_bin, "-c", combined_script };
        var child_process = try std.ChildProcess.init(&argv, ctx.allocator);

        if (!silent) {
            Output.prettyErrorln("<r><d><magenta>$<r> <d><b>{s}<r>", .{combined_script});
            Output.flush();
        }

        var buf_map = try env.map.cloneToBufMap(ctx.allocator);

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
            std.os.exit(@truncate(u8, result.Signal));
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

        var child_process = try std.ChildProcess.init(argv, ctx.allocator);

        var buf_map = try env.map.cloneToBufMap(ctx.allocator);
        child_process.cwd = cwd;
        child_process.env_map = &buf_map;
        child_process.stderr_behavior = .Inherit;
        child_process.stdin_behavior = .Inherit;
        child_process.stdout_behavior = .Inherit;

        const result = child_process.spawnAndWait() catch |err| {
            Output.prettyErrorln("<r><red>error<r>: Failed to run <b>{s}<r> due to error <b>{s}<r>", .{ std.fs.path.basename(executable), @errorName(err) });
            Output.flush();
            return false;
        };

        if (result.Exited > 0) {
            Output.prettyErrorln("<r><red>error<r> <b>\"{s}\"<r> exited with {d} status<r>", .{ std.fs.path.basename(executable), result.Exited });
            Output.flush();
            std.os.exit(@truncate(u8, result.Signal));
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

    pub fn exec(ctx: Command.Context, comptime bin_dirs_only: bool, comptime log_errors: bool) !bool {
        var args = ctx.args;
        args.node_modules_bundle_path = null;
        args.node_modules_bundle_path_server = null;
        args.generate_node_module_bundle = false;

        var this_bundler = try bundler.Bundler.init(ctx.allocator, ctx.log, args, null, null);
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

        var positionals = ctx.positionals;
        if (positionals.len > 0 and strings.eqlComptime(positionals[0], "run") or strings.eqlComptime(positionals[0], "r")) {
            positionals = positionals[1..];
        }

        var root_dir_info = this_bundler.resolver.readDirInfo(this_bundler.fs.top_level_dir) catch |err| {
            if (!log_errors) return false;
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

        {
            this_bundler.env.loadProcess();

            if (this_bundler.env.map.get("NODE_ENV")) |node_env| {
                if (strings.eqlComptime(node_env, "production")) {
                    this_bundler.options.production = true;
                }
            }

            // Run .env in the root dir
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

        var ORIGINAL_PATH = PATH;

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

        var script_name_to_search: string = "";

        if (positionals.len > 0) {
            script_name_to_search = positionals[0];
        }

        var passthrough: []const string = &[_]string{};

        var passthrough_list = std.ArrayList(string).init(ctx.allocator);
        if (script_name_to_search.len > 0) {
            get_passthrough: {

                // If they explicitly pass "--", that means they want everything after that to be passed through.
                for (std.os.argv) |argv, i| {
                    if (strings.eqlComptime(std.mem.span(argv), "--")) {
                        if (std.os.argv.len > i + 1) {
                            var count: usize = 0;
                            for (std.os.argv[i + 1 ..]) |arg| {
                                count += 1;
                            }
                            try passthrough_list.ensureTotalCapacity(count);

                            for (std.os.argv[i + 1 ..]) |arg| {
                                passthrough_list.appendAssumeCapacity(std.mem.span(arg));
                            }

                            passthrough = passthrough_list.toOwnedSlice();
                            break :get_passthrough;
                        }
                    }
                }

                // If they do not pass "--", assume they want everything after the script name to be passed through.
                for (std.os.argv) |argv, i| {
                    if (strings.eql(std.mem.span(argv), script_name_to_search)) {
                        if (std.os.argv.len > i + 1) {
                            try passthrough_list.ensureTotalCapacity(std.os.argv[i + 1 ..].len);

                            for (std.os.argv[i + 1 ..]) |arg| {
                                passthrough_list.appendAssumeCapacity(std.mem.span(arg));
                            }

                            passthrough = passthrough_list.toOwnedSlice();
                            break :get_passthrough;
                        }
                    }
                }
            }
        }

        var did_print = false;
        if (root_dir_info.enclosing_package_json) |package_json| {
            if (package_json.name.len > 0) {
                if (this_bundler.env.map.get(NpmArgs.package_name) == null) {
                    this_bundler.env.map.put(NpmArgs.package_name, package_json.name) catch unreachable;
                }
            }

            if (package_json.version.len > 0) {
                if (this_bundler.env.map.get(NpmArgs.package_version) == null) {
                    this_bundler.env.map.put(NpmArgs.package_version, package_json.version) catch unreachable;
                }
            }

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
                            var is_first = true;
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
                                    ctx,
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
                                ctx,
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
                                    ctx,
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
                Output.prettyError("<r>No \"scripts\" in package.json found.", .{});
                Output.flush();
                std.os.exit(0);
            }

            return false;
        }

        var path_for_which = PATH;
        if (comptime bin_dirs_only) {
            path_for_which = PATH[0 .. PATH.len - (ORIGINAL_PATH.len + 1)];
        }

        if (which(&path_buf, path_for_which, this_bundler.fs.top_level_dir, script_name_to_search)) |destination| {
            var file = std.fs.openFileAbsoluteZ(destination, .{ .read = true }) catch |err| {
                if (!log_errors) return false;

                Output.prettyErrorln("<r>error: <red>{s}<r> opening file: \"{s}\"", .{ err, std.mem.span(destination) });
                Output.flush();
                return err;
            };
            var outbuf = std.os.getFdPath(file.handle, &path_buf2) catch |err| {
                if (!log_errors) return false;
                Output.prettyErrorln("<r>error: <red>{s}<r> resolving file: \"{s}\"", .{ err, std.mem.span(destination) });
                Output.flush();
                return err;
            };

            file.close();

            return try runBinary(
                ctx,
                try this_bundler.fs.dirname_store.append([]u8, outbuf),
                this_bundler.fs.top_level_dir,
                this_bundler.env,
                passthrough,
            );
        }

        if (comptime log_errors) {
            Output.prettyError("<r><red>error:<r> Missing script: <b>{s}<r>\n", .{script_name_to_search});
            Output.flush();
            std.os.exit(0);
        }

        return false;
    }
};
