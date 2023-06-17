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

const Run = @import("./run_command.zig").RunCommand;

pub const BunxCommand = struct {
    var path_buf: [bun.MAX_PATH_BYTES]u8 = undefined;

    fn getBinNameFromSubpath(bundler: *bun.Bundler, dir_fd: std.os.fd_t, subpath_z: [:0]const u8) ![]const u8 {
        const target_package_json_fd = try std.os.openatZ(dir_fd, subpath_z, std.os.O.RDONLY, 0);
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
                    const bin_dir = try std.os.openat(dir_fd, dir_name, std.os.O.RDONLY, 0);
                    defer std.os.close(bin_dir);
                    var dir = std.fs.Dir{ .fd = bin_dir };
                    var iterator = @import("../bun.js/node/dir_iterator.zig").iterate(dir);
                    var entry = iterator.next();
                    while (true) : (entry = iterator.next()) {
                        const current = switch (entry) {
                            .err => break,
                            .result => |result| result,
                        } orelse break;

                        if (current.kind == .File) {
                            if (current.name.len == 0) continue;
                            return try bundler.allocator.dupe(u8, current.name.slice());
                        }
                    }
                }
            }
        }

        return error.NoBinFound;
    }

    fn getBinNameFromProjectDirectory(bundler: *bun.Bundler, dir_fd: std.os.fd_t, package_name: []const u8) ![]const u8 {
        var subpath: [bun.MAX_PATH_BYTES]u8 = undefined;
        subpath[0.."node_modules/".len].* = "node_modules/".*;
        bun.oldMemcpy(subpath["node_modules/".len..], package_name.ptr, package_name.len);
        subpath["node_modules/".len + package_name.len] = std.fs.path.sep;
        subpath["node_modules/".len + package_name.len + 1 ..][0.."package.json".len].* = "package.json".*;
        subpath["node_modules/".len + package_name.len + 1 + "package.json".len] = 0;

        var subpath_z: [:0]const u8 = subpath[0 .. "node_modules/".len + package_name.len + 1 + "package.json".len :0];
        return try getBinNameFromSubpath(bundler, dir_fd, subpath_z);
    }

    fn getBinNameFromTempDirectory(bundler: *bun.Bundler, tempdir_name: []const u8, package_name: []const u8) ![]const u8 {
        var subpath: [bun.MAX_PATH_BYTES]u8 = undefined;
        var subpath_z = std.fmt.bufPrintZ(
            &subpath,
            "{s}/node_modules/{s}/package.json",
            .{ tempdir_name, package_name },
        ) catch unreachable;
        return try getBinNameFromSubpath(bundler, std.os.AT.FDCWD, subpath_z);
    }

    /// Check the enclosing package.json for a matching "bin"
    /// If not found, check bunx cache dir
    fn getBinName(bundler: *bun.Bundler, toplevel_fd: std.os.fd_t, tempdir_name: []const u8, package_name: []const u8) error{ NoBinFound, NeedToInstall }![]const u8 {
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
        Output.prettyErrorln(
            \\usage<r><d>:<r> <cyan>bunx <r><d>[<r><blue>--bun<r><d>]<r><cyan> package<r><d>[@version] [...flags or arguments to pass through]<r>
            \\
            \\bunx runs an npm package executable, automatically installing into a global shared cache if not installed in node_modules.
            \\
            \\example<d>:<r>
            \\
            \\  <cyan>bunx bun-repl<r>
            \\  <cyan>bunx prettier foo.js<r>
            \\
            \\The <blue>--bun<r> flag forces the package to run in Bun's JavaScript runtime, even when it tries to use Node.js.
            \\
            \\  <cyan>bunx <r><blue>--bun<r><cyan> tsc --version<r>
            \\
        , .{});
        Global.exit(1);
    }

    pub fn exec(ctx: bun.CLI.Command.Context) !void {
        var requests_buf = bun.PackageManager.UpdateRequest.Array.init(0) catch unreachable;
        var run_in_bun = ctx.debug.run_in_bun;

        var passthrough_list = try std.ArrayList(string).initCapacity(ctx.allocator, std.os.argv.len -| 1);
        var package_name_for_update_request = [1]string{""};
        {
            var argv = std.os.argv[1..];

            var found_subcommand_name = false;

            for (argv) |positional_| {
                const positional = bun.span(positional_);

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

        var update_requests = bun.PackageManager.UpdateRequest.parse(
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

        var update_request = update_requests[0];

        // if you type "tsc" and TypeScript is not installed:
        // 1. Install TypeScript
        // 2. Run tsc
        if (strings.eqlComptime(update_request.name, "tsc")) {
            update_request.name = "typescript";
        }

        const initial_bin_name = if (strings.eqlComptime(update_request.name, "typescript"))
            "tsc"
        else if (strings.lastIndexOfChar(update_request.name, '/')) |index|
            update_request.name[index + 1 ..]
        else
            update_request.name;

        // fast path: they're actually using this interchangably with `bun run`
        // so we use Bun.which to check
        var this_bundler: bun.Bundler = undefined;
        var ORIGINAL_PATH: string = "";

        const force_using_bun = run_in_bun;
        const root_dir_info = try Run.configureEnvForRun(
            ctx,
            &this_bundler,
            null,
            &ORIGINAL_PATH,
            true,
            force_using_bun,
        );

        var PATH = this_bundler.env.map.get("PATH").?;
        const display_version = if (update_request.version.literal.isEmpty())
            "latest"
        else
            update_request.version.literal.slice(update_request.version_buf);

        const PATH_FOR_BIN_DIRS = PATH;
        if (PATH.len > 0) {
            PATH = try std.fmt.allocPrint(
                ctx.allocator,
                bun.fs.FileSystem.RealFS.PLATFORM_TMP_DIR ++ "/{s}@{s}--bunx/node_modules/.bin:{s}",
                .{ update_request.name, display_version, PATH },
            );
        } else {
            PATH = try std.fmt.allocPrint(
                ctx.allocator,
                bun.fs.FileSystem.RealFS.PLATFORM_TMP_DIR ++ "/{s}@{s}--bunx/node_modules/.bin",
                .{ update_request.name, display_version },
            );
        }
        try this_bundler.env.map.put("PATH", PATH);
        const bunx_cache_dir = PATH[0 .. bun.fs.FileSystem.RealFS.PLATFORM_TMP_DIR.len + "/--bunx@".len + update_request.name.len + display_version.len];

        var absolute_in_cache_dir_buf: [bun.MAX_PATH_BYTES]u8 = undefined;
        var absolute_in_cache_dir = std.fmt.bufPrint(&absolute_in_cache_dir_buf, "/{s}/node_modules/.bin/{s}", .{ bunx_cache_dir, initial_bin_name }) catch unreachable;

        const passthrough = passthrough_list.items;

        // Similar to "npx":
        //
        //  1. Try the bin in the current node_modules and then we try the bin in the global cache
        if (bun.which(
            &path_buf,
            PATH_FOR_BIN_DIRS,
            this_bundler.fs.top_level_dir,
            initial_bin_name,
        ) orelse bun.which(
            &path_buf,
            bunx_cache_dir,
            this_bundler.fs.top_level_dir,
            absolute_in_cache_dir,
        )) |destination| {
            const out = bun.asByteSlice(destination);
            _ = try Run.runBinary(
                ctx,
                try this_bundler.fs.dirname_store.append(@TypeOf(out), out),
                this_bundler.fs.top_level_dir,
                this_bundler.env,
                passthrough,
            );
            // we are done!
            Global.exit(0);
        }

        // 2. The "bin" is possibly not the same as the package name, so we load the package.json to figure out what "bin" to use
        if (getBinName(&this_bundler, root_dir_info.getFileDescriptor(), bunx_cache_dir, initial_bin_name)) |package_name_for_bin| {
            // if we check the bin name and its actually the same, we don't need to check $PATH here again
            if (!strings.eqlLong(package_name_for_bin, initial_bin_name, true)) {
                absolute_in_cache_dir = std.fmt.bufPrint(&absolute_in_cache_dir_buf, "{s}/node_modules/.bin/{s}", .{ bunx_cache_dir, package_name_for_bin }) catch unreachable;

                if (bun.which(
                    &path_buf,
                    PATH_FOR_BIN_DIRS,
                    this_bundler.fs.top_level_dir,
                    package_name_for_bin,
                ) orelse bun.which(
                    &path_buf,
                    bunx_cache_dir,
                    this_bundler.fs.top_level_dir,
                    absolute_in_cache_dir,
                )) |destination| {
                    const out = bun.asByteSlice(destination);
                    _ = try Run.runBinary(
                        ctx,
                        try this_bundler.fs.dirname_store.append(@TypeOf(out), out),
                        this_bundler.fs.top_level_dir,
                        this_bundler.env,
                        passthrough,
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

        var bunx_install_dir_path = try std.fmt.allocPrint(
            ctx.allocator,
            bun.fs.FileSystem.RealFS.PLATFORM_TMP_DIR ++ "/{s}@{s}--bunx",
            .{ update_request.name, display_version },
        );

        // TODO: fix this after zig upgrade
        var bunx_install_iterable_dir = try std.fs.cwd().makeOpenPathIterable(bunx_install_dir_path, .{});
        var bunx_install_dir = bunx_install_iterable_dir.dir;

        create_package_json: {
            // create package.json, but only if it doesn't exist
            var package_json = bunx_install_dir.createFileZ("package.json", .{ .truncate = false }) catch break :create_package_json;
            defer package_json.close();
            package_json.writeAll("{}\n") catch {};
        }

        var args_buf = [_]string{
            try std.fs.selfExePathAlloc(ctx.allocator), "add", "--no-summary", try std.fmt.allocPrint(
                ctx.allocator,
                "{s}@{s}",
                .{
                    update_request.name,
                    display_version,
                },
            ),
        };
        var child_process = std.ChildProcess.init(&args_buf, default_allocator);
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
                Global.exit(@truncate(u7, signal));
            },
            .Stopped => |signal| {
                Global.exit(@truncate(u7, signal));
            },
            // shouldn't happen
            else => {
                Global.exit(1);
            },
        }

        absolute_in_cache_dir = std.fmt.bufPrint(&absolute_in_cache_dir_buf, "{s}/node_modules/.bin/{s}", .{ bunx_cache_dir, initial_bin_name }) catch unreachable;

        // Similar to "npx":
        //
        //  1. Try the bin in the current node_modules and then we try the bin in the global cache
        if (bun.which(
            &path_buf,
            PATH_FOR_BIN_DIRS,
            this_bundler.fs.top_level_dir,
            initial_bin_name,
        ) orelse bun.which(
            &path_buf,
            bunx_cache_dir,
            this_bundler.fs.top_level_dir,
            absolute_in_cache_dir,
        )) |destination| {
            const out = bun.asByteSlice(destination);
            _ = try Run.runBinary(
                ctx,
                try this_bundler.fs.dirname_store.append(@TypeOf(out), out),
                this_bundler.fs.top_level_dir,
                this_bundler.env,
                passthrough,
            );
            // we are done!
            Global.exit(0);
        }

        // 2. The "bin" is possibly not the same as the package name, so we load the package.json to figure out what "bin" to use
        if (getBinNameFromTempDirectory(&this_bundler, bunx_cache_dir, update_request.name)) |package_name_for_bin| {

            // if we check the bin name and its actually the same, we don't need to check $PATH here again
            if (!strings.eqlLong(package_name_for_bin, initial_bin_name, true)) {
                absolute_in_cache_dir = std.fmt.bufPrint(&absolute_in_cache_dir_buf, "{s}/node_modules/.bin/{s}", .{ bunx_cache_dir, package_name_for_bin }) catch unreachable;

                if (bun.which(
                    &path_buf,
                    PATH_FOR_BIN_DIRS,
                    this_bundler.fs.top_level_dir,
                    package_name_for_bin,
                ) orelse bun.which(
                    &path_buf,
                    bunx_cache_dir,
                    this_bundler.fs.top_level_dir,
                    absolute_in_cache_dir,
                )) |destination| {
                    const out = bun.asByteSlice(destination);
                    _ = try Run.runBinary(
                        ctx,
                        try this_bundler.fs.dirname_store.append(@TypeOf(out), out),
                        this_bundler.fs.top_level_dir,
                        this_bundler.env,
                        passthrough,
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
