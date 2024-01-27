const bun = @import("root").bun;
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
const Command = @import("../cli.zig").Command;
const Run = @import("./run_command.zig").RunCommand;

pub const BunxCommand = struct {
    var path_buf: [bun.MAX_PATH_BYTES]u8 = undefined;

    /// clones the string
    pub fn addCreatePrefix(allocator: std.mem.Allocator, input: []const u8) ![:0]const u8 {
        const prefixLength = "create-".len;

        if (input.len == 0) return try allocator.dupeZ(u8, input);

        var new_str = try allocator.allocSentinel(u8, input.len + prefixLength, 0);
        if (input[0] == '@') {
            // @org/some -> @org/create-some
            // @org/some@v -> @org/create-some@v
            if (strings.indexOfChar(input, '/')) |slash_i| {
                const index = slash_i + 1;
                @memcpy(new_str[0..index], input[0..index]);
                @memcpy(new_str[index .. index + prefixLength], "create-");
                @memcpy(new_str[index + prefixLength ..], input[index..]);
                return new_str;
            }
            // @org@v -> @org/create@v
            else if (strings.indexOfChar(input[1..], '@')) |at_i| {
                const index = at_i + 1;
                @memcpy(new_str[0..index], input[0..index]);
                @memcpy(new_str[index .. index + prefixLength], "/create");
                @memcpy(new_str[index + prefixLength ..], input[index..]);
                return new_str;
            }
            // @org -> @org/create
            else {
                @memcpy(new_str[0..input.len], input);
                @memcpy(new_str[input.len..], "/create");
                return new_str;
            }
        }

        @memcpy(new_str[0..prefixLength], "create-");
        @memcpy(new_str[prefixLength..], input);

        return new_str;
    }

    fn getBinNameFromSubpath(bundler: *bun.Bundler, dir_fd: bun.FileDescriptor, subpath_z: [:0]const u8) ![]const u8 {
        const target_package_json_fd = try std.os.openatZ(dir_fd.cast(), subpath_z, std.os.O.RDONLY, 0);
        const target_package_json = std.fs.File{ .handle = target_package_json_fd };
        defer target_package_json.close();

        const package_json_contents = try target_package_json.readToEndAlloc(bundler.allocator, std.math.maxInt(u32));
        const source = bun.logger.Source.initPathString(bun.span(subpath_z), package_json_contents);

        bun.JSAst.Expr.Data.Store.create(default_allocator);
        bun.JSAst.Stmt.Data.Store.create(default_allocator);

        const expr = try bun.JSON.ParseJSONUTF8(&source, bundler.log, bundler.allocator);

        // choose the first package that fits
        if (expr.get("bin")) |bin_expr| {
            switch (bin_expr.data) {
                .e_object => |object| {
                    for (object.properties.slice()) |prop| {
                        if (prop.key) |key| {
                            if (key.asString(bundler.allocator)) |bin_name| {
                                if (bin_name.len == 0) continue;
                                return bin_name;
                            }
                        }
                    }
                },
                .e_string => {
                    if (expr.get("name")) |name_expr| {
                        if (name_expr.asString(bundler.allocator)) |name| {
                            return name;
                        }
                    }
                },
                else => {},
            }
        }

        if (expr.asProperty("directories")) |dirs| {
            if (dirs.expr.asProperty("bin")) |bin_prop| {
                if (bin_prop.expr.asString(bundler.allocator)) |dir_name| {
                    const bin_dir = try std.os.openat(dir_fd.cast(), dir_name, std.os.O.RDONLY, 0);
                    defer std.os.close(bin_dir);
                    const dir = std.fs.Dir{ .fd = bin_dir };
                    var iterator = bun.DirIterator.iterate(dir, .u8);
                    var entry = iterator.next();
                    while (true) : (entry = iterator.next()) {
                        const current = switch (entry) {
                            .err => break,
                            .result => |result| result,
                        } orelse break;

                        if (current.kind == .file) {
                            if (current.name.len == 0) continue;
                            return try bundler.allocator.dupe(u8, current.name.slice());
                        }
                    }
                }
            }
        }

        return error.NoBinFound;
    }

    fn getBinNameFromProjectDirectory(bundler: *bun.Bundler, dir_fd: bun.FileDescriptor, package_name: []const u8) ![]const u8 {
        var subpath: [bun.MAX_PATH_BYTES]u8 = undefined;
        subpath[0.."node_modules/".len].* = "node_modules/".*;
        @memcpy(subpath["node_modules/".len..][0..package_name.len], package_name);
        subpath["node_modules/".len + package_name.len] = std.fs.path.sep;
        subpath["node_modules/".len + package_name.len + 1 ..][0.."package.json".len].* = "package.json".*;
        subpath["node_modules/".len + package_name.len + 1 + "package.json".len] = 0;

        const subpath_z: [:0]const u8 = subpath[0 .. "node_modules/".len + package_name.len + 1 + "package.json".len :0];
        return try getBinNameFromSubpath(bundler, dir_fd, subpath_z);
    }

    fn getBinNameFromTempDirectory(bundler: *bun.Bundler, tempdir_name: []const u8, package_name: []const u8) ![]const u8 {
        var subpath: [bun.MAX_PATH_BYTES]u8 = undefined;
        const subpath_z = std.fmt.bufPrintZ(
            &subpath,
            "{s}/node_modules/{s}/package.json",
            .{ tempdir_name, package_name },
        ) catch unreachable;
        return try getBinNameFromSubpath(bundler, bun.toFD(std.fs.cwd().fd), subpath_z);
    }

    /// Check the enclosing package.json for a matching "bin"
    /// If not found, check bunx cache dir
    fn getBinName(bundler: *bun.Bundler, toplevel_fd: bun.FileDescriptor, tempdir_name: []const u8, package_name: []const u8) error{ NoBinFound, NeedToInstall }![]const u8 {
        return getBinNameFromProjectDirectory(bundler, toplevel_fd, package_name) catch |err| {
            if (err == error.NoBinFound) {
                return error.NoBinFound;
            }

            return getBinNameFromTempDirectory(bundler, tempdir_name, package_name) catch |err2| {
                if (err2 == error.NoBinFound) {
                    return error.NoBinFound;
                }

                return error.NeedToInstall;
            };
        };
    }

    fn exit_with_usage() noreturn {
        Command.Tag.printHelp(.BunxCommand, false);
        Global.exit(1);
    }

    pub fn exec(ctx_: bun.CLI.Command.Context, argv: [][:0]const u8) !void {
        var ctx = ctx_;
        var requests_buf = bun.PackageManager.UpdateRequest.Array.init(0) catch unreachable;
        var run_in_bun = ctx.debug.run_in_bun;

        var passthrough_list = try std.ArrayList(string).initCapacity(ctx.allocator, argv.len);
        var package_name_for_update_request = [1]string{""};
        {
            var found_subcommand_name = false;

            for (argv) |positional| {
                if (positional.len == 0) continue;

                if (positional[0] != '-') {
                    if (!found_subcommand_name) {
                        found_subcommand_name = true;
                        if (positional.len == 1 and positional[0] == 'x')
                            continue;
                    }
                }

                if (!run_in_bun and !found_subcommand_name) {
                    if (strings.eqlComptime(positional, "--bun")) {
                        run_in_bun = true;
                        continue;
                    }
                }

                if (package_name_for_update_request[0].len == 0 and positional.len > 0 and positional[0] != '-') {
                    package_name_for_update_request[0] = positional;
                    continue;
                }

                try passthrough_list.append(positional);
            }
        }

        // check if package_name_for_update_request is empty string or " "
        if (package_name_for_update_request[0].len == 0) {
            exit_with_usage();
        }

        const update_requests = bun.PackageManager.UpdateRequest.parse(
            ctx.allocator,
            ctx.log,
            &package_name_for_update_request,
            &requests_buf,
            .add,
        );

        if (update_requests.len == 0) {
            exit_with_usage();
        }

        // this shouldn't happen
        if (update_requests.len > 1) {
            Output.prettyErrorln("<r><red>error<r><d>:<r> Only one package can be installed & run at a time right now", .{});
            Global.exit(1);
        }

        // Don't log stuff
        ctx.debug.silent = true;

        var update_request = update_requests[0];

        // if you type "tsc" and TypeScript is not installed:
        // 1. Install TypeScript
        // 2. Run tsc
        if (strings.eqlComptime(update_request.name, "tsc")) {
            update_request.name = "typescript";
        }

        const initial_bin_name = if (strings.eqlComptime(update_request.name, "typescript"))
            "tsc"
        else if (update_request.version.tag == .github)
            update_request.version.value.github.repo.slice(update_request.version_buf)
        else if (strings.lastIndexOfChar(update_request.name, '/')) |index|
            update_request.name[index + 1 ..]
        else
            update_request.name;

        // fast path: they're actually using this interchangeably with `bun run`
        // so we use Bun.which to check
        var this_bundler: bun.Bundler = undefined;
        var ORIGINAL_PATH: string = "";

        const force_using_bun = run_in_bun;
        const root_dir_info = try Run.configureEnvForRun(
            ctx,
            &this_bundler,
            null,
            true,
        );

        try Run.configurePathForRun(
            ctx,
            root_dir_info,
            &this_bundler,
            &ORIGINAL_PATH,
            root_dir_info.abs_path,
            force_using_bun,
        );

        const ignore_cwd = this_bundler.env.map.get("BUN_WHICH_IGNORE_CWD") orelse "";

        if (ignore_cwd.len > 0) {
            _ = this_bundler.env.map.map.swapRemove("BUN_WHICH_IGNORE_CWD");
        }

        var PATH = this_bundler.env.map.get("PATH").?;
        const display_version = if (update_request.version.literal.isEmpty())
            "latest"
        else
            update_request.version.literal.slice(update_request.version_buf);

        const package_fmt = brk: {
            if (update_request.version.tag == .github) {
                break :brk update_request.version.literal.slice(update_request.version_buf);
            }

            break :brk try std.fmt.allocPrint(
                ctx.allocator,
                "{s}@{s}",
                .{
                    update_request.name,
                    display_version,
                },
            );
        };

        const temp_dir = bun.fs.FileSystem.RealFS.platformTempDir();

        const PATH_FOR_BIN_DIRS = brk: {
            if (ignore_cwd.len == 0) break :brk PATH;

            // Remove the cwd passed through BUN_WHICH_IGNORE_CWD from path. This prevents temp node-gyp script from finding and running itself
            var new_path = try std.ArrayList(u8).initCapacity(ctx.allocator, PATH.len);
            var path_iter = std.mem.tokenizeScalar(u8, PATH, std.fs.path.delimiter);
            if (path_iter.next()) |segment| {
                if (!strings.eqlLong(strings.withoutTrailingSlash(segment), strings.withoutTrailingSlash(ignore_cwd), true)) {
                    try new_path.appendSlice(segment);
                }
            }
            while (path_iter.next()) |segment| {
                if (!strings.eqlLong(strings.withoutTrailingSlash(segment), strings.withoutTrailingSlash(ignore_cwd), true)) {
                    try new_path.append(std.fs.path.delimiter);
                    try new_path.appendSlice(segment);
                }
            }

            break :brk new_path.items;
        };

        defer {
            if (ignore_cwd.len > 0) {
                ctx.allocator.free(PATH_FOR_BIN_DIRS);
            }
        }
        if (PATH.len > 0) {
            PATH = try std.fmt.allocPrint(
                ctx.allocator,
                "{s}/{s}--bunx/node_modules/.bin:{s}",
                .{ temp_dir, package_fmt, PATH },
            );
        } else {
            PATH = try std.fmt.allocPrint(
                ctx.allocator,
                "{s}/{s}--bunx/node_modules/.bin",
                .{ temp_dir, package_fmt },
            );
        }
        try this_bundler.env.map.put("PATH", PATH);
        const bunx_cache_dir = PATH[0 .. temp_dir.len + "/--bunx".len + package_fmt.len];

        var absolute_in_cache_dir_buf: [bun.MAX_PATH_BYTES]u8 = undefined;
        var absolute_in_cache_dir = std.fmt.bufPrint(&absolute_in_cache_dir_buf, "{s}/node_modules/.bin/{s}", .{ bunx_cache_dir, initial_bin_name }) catch unreachable;

        const passthrough = passthrough_list.items;

        if (update_request.version.literal.isEmpty() or update_request.version.tag != .dist_tag) {
            var destination_: ?[:0]const u8 = null;

            // Only use the system-installed version if there is no version specified
            if (update_request.version.literal.isEmpty()) {
                destination_ = bun.which(
                    &path_buf,
                    PATH_FOR_BIN_DIRS,
                    if (ignore_cwd.len > 0) "" else this_bundler.fs.top_level_dir,
                    initial_bin_name,
                );
            }

            // Similar to "npx":
            //
            //  1. Try the bin in the current node_modules and then we try the bin in the global cache
            if (destination_ orelse bun.which(
                &path_buf,
                bunx_cache_dir,
                if (ignore_cwd.len > 0) "" else this_bundler.fs.top_level_dir,
                absolute_in_cache_dir,
            )) |destination| {
                const out = bun.asByteSlice(destination);
                _ = try Run.runBinary(
                    ctx,
                    try this_bundler.fs.dirname_store.append(@TypeOf(out), out),
                    this_bundler.fs.top_level_dir,
                    this_bundler.env,
                    passthrough,
                    null,
                );
                // we are done!
                Global.exit(0);
            }

            // 2. The "bin" is possibly not the same as the package name, so we load the package.json to figure out what "bin" to use
            const root_dir_fd = root_dir_info.getFileDescriptor();
            if (root_dir_fd != .zero) {
                if (getBinName(&this_bundler, root_dir_fd, bunx_cache_dir, initial_bin_name)) |package_name_for_bin| {
                    // if we check the bin name and its actually the same, we don't need to check $PATH here again
                    if (!strings.eqlLong(package_name_for_bin, initial_bin_name, true)) {
                        absolute_in_cache_dir = std.fmt.bufPrint(&absolute_in_cache_dir_buf, "{s}/node_modules/.bin/{s}", .{ bunx_cache_dir, package_name_for_bin }) catch unreachable;

                        // Only use the system-installed version if there is no version specified
                        if (update_request.version.literal.isEmpty()) {
                            destination_ = bun.which(
                                &path_buf,
                                PATH_FOR_BIN_DIRS,
                                if (ignore_cwd.len > 0) "" else this_bundler.fs.top_level_dir,
                                package_name_for_bin,
                            );
                        }

                        if (destination_ orelse bun.which(
                            &path_buf,
                            bunx_cache_dir,
                            if (ignore_cwd.len > 0) "" else this_bundler.fs.top_level_dir,
                            absolute_in_cache_dir,
                        )) |destination| {
                            const out = bun.asByteSlice(destination);
                            _ = try Run.runBinary(
                                ctx,
                                try this_bundler.fs.dirname_store.append(@TypeOf(out), out),
                                this_bundler.fs.top_level_dir,
                                this_bundler.env,
                                passthrough,
                                null,
                            );
                            // we are done!
                            Global.exit(0);
                        }
                    }
                } else |err| {
                    if (err == error.NoBinFound) {
                        Output.prettyErrorln("<r><red>error<r><d>:<r> could not determine executable to run for package <r><b>{s}<r>", .{update_request.name});
                        Global.exit(1);
                    }
                }
            }
        }

        const bunx_install_dir_path = try std.fmt.allocPrint(
            ctx.allocator,
            "{s}/{s}--bunx",
            .{ temp_dir, package_fmt },
        );

        // TODO: fix this after zig upgrade
        const bunx_install_iterable_dir = try std.fs.cwd().makeOpenPath(bunx_install_dir_path, .{});
        var bunx_install_dir = bunx_install_iterable_dir;

        create_package_json: {
            // create package.json, but only if it doesn't exist
            var package_json = bunx_install_dir.createFileZ("package.json", .{ .truncate = true }) catch break :create_package_json;
            defer package_json.close();
            package_json.writeAll("{}\n") catch {};
        }

        var args_buf = [_]string{
            try std.fs.selfExePathAlloc(ctx.allocator), "add",        "--no-summary",
            package_fmt,
            // disable the manifest cache when a tag is specified
            // so that @latest is fetched from the registry
                                           "--no-cache",
        };

        const argv_to_use: []const string = args_buf[0 .. args_buf.len - @as(usize, @intFromBool(update_request.version.tag != .dist_tag))];

        var child_process = std.ChildProcess.init(argv_to_use, default_allocator);
        child_process.cwd = bunx_install_dir_path;
        child_process.cwd_dir = bunx_install_dir;
        const env_map = try this_bundler.env.map.cloneToEnvMap(ctx.allocator);
        child_process.env_map = &env_map;
        child_process.stderr_behavior = .Inherit;
        child_process.stdin_behavior = .Inherit;
        child_process.stdout_behavior = .Inherit;
        const term = try child_process.spawnAndWait();

        switch (term) {
            .Exited => |exit_code| {
                if (exit_code != 0) {
                    Global.exit(exit_code);
                }
            },
            .Signal => |signal| {
                Global.exit(@as(u7, @truncate(signal)));
            },
            .Stopped => |signal| {
                Global.exit(@as(u7, @truncate(signal)));
            },
            // shouldn't happen
            else => {
                Global.exit(1);
            },
        }

        absolute_in_cache_dir = std.fmt.bufPrint(&absolute_in_cache_dir_buf, "{s}/node_modules/.bin/{s}", .{ bunx_cache_dir, initial_bin_name }) catch unreachable;

        // Similar to "npx":
        //
        //  1. Try the bin in the global cache
        //     Do not try $PATH because we already checked it above if we should
        if (bun.which(
            &path_buf,
            bunx_cache_dir,
            if (ignore_cwd.len > 0) "" else this_bundler.fs.top_level_dir,
            absolute_in_cache_dir,
        )) |destination| {
            const out = bun.asByteSlice(destination);
            _ = try Run.runBinary(
                ctx,
                try this_bundler.fs.dirname_store.append(@TypeOf(out), out),
                this_bundler.fs.top_level_dir,
                this_bundler.env,
                passthrough,
                null,
            );
            // we are done!
            Global.exit(0);
        }

        // 2. The "bin" is possibly not the same as the package name, so we load the package.json to figure out what "bin" to use
        if (getBinNameFromTempDirectory(&this_bundler, bunx_cache_dir, update_request.name)) |package_name_for_bin| {
            if (!strings.eqlLong(package_name_for_bin, initial_bin_name, true)) {
                absolute_in_cache_dir = std.fmt.bufPrint(&absolute_in_cache_dir_buf, "{s}/node_modules/.bin/{s}", .{ bunx_cache_dir, package_name_for_bin }) catch unreachable;

                if (bun.which(
                    &path_buf,
                    bunx_cache_dir,
                    if (ignore_cwd.len > 0) "" else this_bundler.fs.top_level_dir,
                    absolute_in_cache_dir,
                )) |destination| {
                    const out = bun.asByteSlice(destination);
                    _ = try Run.runBinary(
                        ctx,
                        try this_bundler.fs.dirname_store.append(@TypeOf(out), out),
                        this_bundler.fs.top_level_dir,
                        this_bundler.env,
                        passthrough,
                        null,
                    );
                    // we are done!
                    Global.exit(0);
                }
            }
        } else |_| {}

        Output.prettyErrorln("<r><red>error<r><d>:<r> could not determine executable to run for package <r><b>{s}<r>", .{update_request.name});
        Global.exit(1);
    }
};
