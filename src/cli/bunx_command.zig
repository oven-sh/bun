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

const debug = Output.scoped(.bunx, false);

pub const BunxCommand = struct {
    var path_buf: [bun.MAX_PATH_BYTES]u8 = undefined;

    /// Adds `create-` to the string, but also handles scoped packages correctly.
    /// Always clones the string in the process.
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

    /// 1 day
    const seconds_cache_valid = 60 * 60 * 24;
    /// 1 day
    const nanoseconds_cache_valid = seconds_cache_valid * 1000000000;

    fn getBinNameFromSubpath(bundler: *bun.Bundler, dir_fd: bun.FileDescriptor, subpath_z: [:0]const u8) ![]const u8 {
        const target_package_json_fd = try bun.sys.openat(dir_fd, subpath_z, std.os.O.RDONLY, 0).unwrap();
        const target_package_json = bun.sys.File{ .handle = target_package_json_fd };

        defer target_package_json.close();

        const package_json_read = target_package_json.readToEnd(bundler.allocator);

        // TODO: make this better
        if (package_json_read.err) |err| {
            try (bun.JSC.Maybe(void){ .err = err }).unwrap();
        }

        const package_json_contents = package_json_read.bytes.items;
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
                    const bin_dir = try bun.sys.openatA(dir_fd, dir_name, std.os.O.RDONLY | std.os.O.DIRECTORY, 0).unwrap();
                    defer _ = bun.sys.close(bin_dir);
                    const dir = std.fs.Dir{ .fd = bin_dir.cast() };
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
        const subpath_z = std.fmt.bufPrintZ(&subpath, bun.pathLiteral("node_modules/{s}/package.json"), .{package_name}) catch unreachable;
        return try getBinNameFromSubpath(bundler, dir_fd, subpath_z);
    }

    fn getBinNameFromTempDirectory(bundler: *bun.Bundler, tempdir_name: []const u8, package_name: []const u8, with_stale_check: bool) ![]const u8 {
        var subpath: [bun.MAX_PATH_BYTES]u8 = undefined;
        if (with_stale_check) {
            const subpath_z = std.fmt.bufPrintZ(
                &subpath,
                bun.pathLiteral("{s}/package.json"),
                .{tempdir_name},
            ) catch unreachable;
            const target_package_json_fd = bun.sys.openat(bun.toFD(std.fs.cwd().fd), subpath_z, std.os.O.RDONLY, 0).unwrap() catch return error.NeedToInstall;
            const target_package_json = bun.sys.File{ .handle = target_package_json_fd };

            const is_stale = is_stale: {
                if (Environment.isWindows) {
                    var io_status_block: std.os.windows.IO_STATUS_BLOCK = undefined;
                    var info: std.os.windows.FILE_BASIC_INFORMATION = undefined;
                    const rc = std.os.windows.ntdll.NtQueryInformationFile(target_package_json_fd.cast(), &io_status_block, &info, @sizeOf(std.os.windows.FILE_BASIC_INFORMATION), .FileBasicInformation);
                    switch (rc) {
                        .SUCCESS => {
                            const time = std.os.windows.fromSysTime(info.LastWriteTime);
                            const now = std.time.nanoTimestamp();
                            break :is_stale (now - time > nanoseconds_cache_valid);
                        },
                        // treat failures to stat as stale
                        else => break :is_stale true,
                    }
                } else {
                    const stat = target_package_json.stat().unwrap() catch break :is_stale true;
                    break :is_stale std.time.timestamp() - stat.mtime().tv_sec > seconds_cache_valid;
                }
            };

            if (is_stale) {
                _ = target_package_json.close();
                // If delete fails, oh well. Hope installation takes care of it.
                std.fs.cwd().deleteTree(tempdir_name) catch {};
                return error.NeedToInstall;
            }
            _ = target_package_json.close();
        }

        const subpath_z = std.fmt.bufPrintZ(
            &subpath,
            bun.pathLiteral("{s}/node_modules/{s}/package.json"),
            .{ tempdir_name, package_name },
        ) catch unreachable;

        return try getBinNameFromSubpath(bundler, bun.toFD(std.fs.cwd().fd), subpath_z);
    }

    /// Check the enclosing package.json for a matching "bin"
    /// If not found, check bunx cache dir
    fn getBinName(bundler: *bun.Bundler, toplevel_fd: bun.FileDescriptor, tempdir_name: []const u8, package_name: []const u8) error{ NoBinFound, NeedToInstall }![]const u8 {
        toplevel_fd.assertValid();
        return getBinNameFromProjectDirectory(bundler, toplevel_fd, package_name) catch |err| {
            if (err == error.NoBinFound) {
                return error.NoBinFound;
            }

            return getBinNameFromTempDirectory(bundler, tempdir_name, package_name, true) catch |err2| {
                if (err2 == error.NoBinFound) {
                    return error.NoBinFound;
                }

                return error.NeedToInstall;
            };
        };
    }

    fn exitWithUsage() noreturn {
        Command.Tag.printHelp(.BunxCommand, false);
        Global.exit(1);
    }

    pub fn exec(ctx: bun.CLI.Command.Context, argv: [][:0]const u8) !void {
        // Don't log stuff
        ctx.debug.silent = true;

        var passthrough_list = try std.ArrayList(string).initCapacity(ctx.allocator, argv.len);
        var maybe_package_name: ?string = null;
        var verbose_install = false;
        var silent_install = false;
        {
            var found_subcommand_name = false;

            for (argv) |positional| {
                if (maybe_package_name != null) {
                    passthrough_list.appendAssumeCapacity(positional);
                    continue;
                }

                if (positional.len > 0 and positional[0] == '-') {
                    if (strings.eqlComptime(positional, "--verbose")) {
                        verbose_install = true;
                    } else if (strings.eqlComptime(positional, "--silent")) {
                        silent_install = true;
                    } else if (strings.eqlComptime(positional, "--bun") or strings.eqlComptime(positional, "-b")) {
                        ctx.debug.run_in_bun = true;
                    }
                } else {
                    if (!found_subcommand_name) {
                        found_subcommand_name = true;
                    } else {
                        maybe_package_name = positional;
                    }
                }
            }
        }

        // check if package_name_for_update_request is empty string or " "
        if (maybe_package_name == null or maybe_package_name.?.len == 0) {
            exitWithUsage();
        }

        const package_name = maybe_package_name.?;

        var requests_buf = bun.PackageManager.UpdateRequest.Array.initCapacity(ctx.allocator, 64) catch bun.outOfMemory();
        defer requests_buf.deinit(ctx.allocator);
        const update_requests = bun.PackageManager.UpdateRequest.parse(
            ctx.allocator,
            ctx.log,
            &.{package_name},
            &requests_buf,
            .add,
        );

        if (update_requests.len == 0) {
            exitWithUsage();
        }

        bun.assert(update_requests.len == 1); // One positional cannot parse to multiple requests
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
        debug("initial_bin_name: {s}", .{initial_bin_name});

        // fast path: they're actually using this interchangeably with `bun run`
        // so we use Bun.which to check
        var this_bundler: bun.Bundler = undefined;
        var ORIGINAL_PATH: string = "";

        const root_dir_info = try Run.configureEnvForRun(
            ctx,
            &this_bundler,
            null,
            true,
            true,
        );

        try Run.configurePathForRun(
            ctx,
            root_dir_info,
            &this_bundler,
            &ORIGINAL_PATH,
            root_dir_info.abs_path,
            ctx.debug.run_in_bun,
        );

        const ignore_cwd = this_bundler.env.get("BUN_WHICH_IGNORE_CWD") orelse "";

        if (ignore_cwd.len > 0) {
            _ = this_bundler.env.map.map.swapRemove("BUN_WHICH_IGNORE_CWD");
        }

        var PATH = this_bundler.env.get("PATH").?;
        const display_version = if (update_request.version.literal.isEmpty())
            "latest"
        else
            update_request.version.literal.slice(update_request.version_buf);

        // package_fmt is used for the path to install in.
        const package_fmt = brk: {
            // Includes the delimiters because we use this as a part of $PATH
            const banned_path_chars = switch (Environment.os) {
                .windows => ":*?<>|;",
                else => ":",
            };

            const has_banned_char = bun.strings.indexAnyComptime(update_request.name, banned_path_chars) != null or bun.strings.indexAnyComptime(display_version, banned_path_chars) != null;

            break :brk try if (has_banned_char)
                // This branch gets hit usually when a URL is requested as the package
                // See https://github.com/oven-sh/bun/issues/3675
                //
                // But the requested version will contain the url.
                // The colon will break all platforms.
                std.fmt.allocPrint(ctx.allocator, "{s}@{s}@{d}", .{
                    initial_bin_name,
                    @tagName(update_request.version.tag),
                    bun.hash(update_request.name) +% bun.hash(display_version),
                })
            else
                try std.fmt.allocPrint(ctx.allocator, "{s}@{s}", .{
                    update_request.name,
                    display_version,
                });
        };
        debug("package_fmt: {s}", .{package_fmt});

        // install_param -> used in command 'bun install {what}'
        // result_package_name -> used for path 'node_modules/{what}/package.json'
        const install_param, const result_package_name = if (update_request.name.len != 0)
            .{
                try std.fmt.allocPrint(ctx.allocator, "{s}@{s}", .{
                    update_request.name,
                    display_version,
                }),
                update_request.name,
            }
        else
            // When there is not a clear package name (URL/GitHub/etc), we force the package name
            // to be the same as the calculated initial bin name. This allows us to have a predictable
            // node_modules folder structure.
            .{
                try std.fmt.allocPrint(ctx.allocator, "{s}@{s}", .{
                    initial_bin_name,
                    display_version,
                }),
                initial_bin_name,
            };
        debug("install_param: {s}", .{install_param});
        debug("result_package_name: {s}", .{result_package_name});

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
        defer if (ignore_cwd.len > 0) {
            ctx.allocator.free(PATH_FOR_BIN_DIRS);
        };

        // The bunx cache path is at the following location
        //
        //   <temp_dir>/bunx-<uid>-<package_fmt>/node_modules/.bin/<bin>
        //
        // Reasoning:
        // - Prefix with "bunx" to identify the bunx cache, make it easier to "rm -r"
        //   - Suffix would not work because scoped packages have a "/" in them, and
        //     before Bun 1.1 this was practically impossible to clear the cache manually.
        //     It was easier to just remove the entire temp directory.
        // - Use the uid to prevent conflicts between users. If the paths were the same
        //   across users, you run into permission conflicts
        //   - If you set permission to 777, you run into a potential attack vector
        //     where a user can replace the directory with malicious code.
        //
        // If this format changes, please update cache clearing code in package_manager_command.zig
        const uid = if (bun.Environment.isPosix) bun.C.getuid() else bun.windows.userUniqueId();
        PATH = switch (PATH.len > 0) {
            inline else => |path_is_nonzero| try std.fmt.allocPrint(
                ctx.allocator,
                bun.pathLiteral("{s}/bunx-{d}-{s}/node_modules/.bin{s}{s}"),
                .{
                    temp_dir,
                    uid,
                    package_fmt,
                    if (path_is_nonzero) &[1]u8{std.fs.path.delimiter} else "",
                    if (path_is_nonzero) PATH else "",
                },
            ),
        };

        try this_bundler.env.map.put("PATH", PATH);
        const bunx_cache_dir = PATH[0 .. temp_dir.len +
            "/bunx--".len +
            package_fmt.len +
            std.fmt.count("{d}", .{uid})];

        debug("bunx_cache_dir: {s}", .{bunx_cache_dir});

        var absolute_in_cache_dir_buf: bun.PathBuffer = undefined;
        var absolute_in_cache_dir = std.fmt.bufPrint(
            &absolute_in_cache_dir_buf,
            bun.pathLiteral("{s}/node_modules/.bin/{s}{s}"),
            .{ bunx_cache_dir, initial_bin_name, bun.exe_suffix },
        ) catch return error.PathTooLong;

        const passthrough = passthrough_list.items;

        var do_cache_bust = update_request.version.tag == .dist_tag;

        if (update_request.version.literal.isEmpty() or update_request.version.tag != .dist_tag) try_run_existing: {
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

                // If this directory was installed by bunx, we want to perform cache invalidation on it
                // this way running `bunx hello` will update hello automatically to the latest version
                if (bun.strings.hasPrefix(out, bunx_cache_dir)) {
                    const is_stale = is_stale: {
                        if (Environment.isWindows) {
                            const fd = bun.sys.openat(bun.invalid_fd, destination, std.os.O.RDONLY, 0).unwrap() catch {
                                // if we cant open this, we probably will just fail when we run it
                                // and that error message is likely going to be better than the one from `bun add`
                                break :is_stale false;
                            };
                            defer _ = bun.sys.close(fd);

                            var io_status_block: std.os.windows.IO_STATUS_BLOCK = undefined;
                            var info: std.os.windows.FILE_BASIC_INFORMATION = undefined;
                            const rc = std.os.windows.ntdll.NtQueryInformationFile(fd.cast(), &io_status_block, &info, @sizeOf(std.os.windows.FILE_BASIC_INFORMATION), .FileBasicInformation);
                            switch (rc) {
                                .SUCCESS => {
                                    const time = std.os.windows.fromSysTime(info.LastWriteTime);
                                    const now = std.time.nanoTimestamp();
                                    break :is_stale (now - time > nanoseconds_cache_valid);
                                },
                                // treat failures to stat as stale
                                else => break :is_stale true,
                            }
                        } else {
                            var stat: std.os.Stat = undefined;
                            const rc = std.c.stat(destination, &stat);
                            if (rc != 0) {
                                break :is_stale true;
                            }
                            break :is_stale std.time.timestamp() - stat.mtime().tv_sec > seconds_cache_valid;
                        }
                    };

                    if (is_stale) {
                        do_cache_bust = true;
                        break :try_run_existing;
                    }
                }

                try Run.runBinary(
                    ctx,
                    try this_bundler.fs.dirname_store.append(@TypeOf(out), out),
                    destination,
                    this_bundler.fs.top_level_dir,
                    this_bundler.env,
                    passthrough,
                    null,
                );
                // runBinary is noreturn
                @compileError("unreachable");
            }

            // 2. The "bin" is possibly not the same as the package name, so we load the package.json to figure out what "bin" to use
            const root_dir_fd = root_dir_info.getFileDescriptor();
            bun.assert(root_dir_fd != .zero);
            if (getBinName(&this_bundler, root_dir_fd, bunx_cache_dir, initial_bin_name)) |package_name_for_bin| {
                // if we check the bin name and its actually the same, we don't need to check $PATH here again
                if (!strings.eqlLong(package_name_for_bin, initial_bin_name, true)) {
                    absolute_in_cache_dir = std.fmt.bufPrint(&absolute_in_cache_dir_buf, bun.pathLiteral("{s}/node_modules/.bin/{s}{s}"), .{ bunx_cache_dir, package_name_for_bin, bun.exe_suffix }) catch unreachable;

                    // Only use the system-installed version if there is no version specified
                    if (update_request.version.literal.isEmpty()) {
                        destination_ = bun.which(
                            &path_buf,
                            bunx_cache_dir,
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
                        try Run.runBinary(
                            ctx,
                            try this_bundler.fs.dirname_store.append(@TypeOf(out), out),
                            destination,
                            this_bundler.fs.top_level_dir,
                            this_bundler.env,
                            passthrough,
                            null,
                        );
                        // runBinary is noreturn
                        @compileError("unreachable");
                    }
                }
            } else |err| {
                if (err == error.NoBinFound) {
                    Output.errGeneric("could not determine executable to run for package <b>{s}<r>", .{update_request.name});
                    Global.exit(1);
                }
            }
        }
        const bunx_install_dir = try std.fs.cwd().makeOpenPath(bunx_cache_dir, .{});

        create_package_json: {
            // create package.json, but only if it doesn't exist
            var package_json = bunx_install_dir.createFileZ("package.json", .{ .truncate = true }) catch break :create_package_json;
            defer package_json.close();
            package_json.writeAll("{}\n") catch {};
        }

        var args = std.BoundedArray([]const u8, 8).fromSlice(&.{
            try bun.selfExePath(),
            "add",
            install_param,
            "--no-summary",
        }) catch
            unreachable; // upper bound is known

        if (do_cache_bust) {
            // disable the manifest cache when a tag is specified
            // so that @latest is fetched from the registry
            args.append("--no-cache") catch
                unreachable; // upper bound is known

            // forcefully re-install packages in this mode too
            args.append("--force") catch
                unreachable; // upper bound is known
        }

        if (verbose_install) {
            args.append("--verbose") catch
                unreachable; // upper bound is known
        }

        if (silent_install) {
            args.append("--silent") catch
                unreachable; // upper bound is known
        }

        const argv_to_use = args.slice();

        debug("installing package: {s}", .{bun.fmt.fmtSlice(argv_to_use, " ")});
        this_bundler.env.map.put("BUN_INTERNAL_BUNX_INSTALL", "true") catch bun.outOfMemory();

        const spawn_result = switch ((bun.spawnSync(&.{
            .argv = argv_to_use,

            .envp = try this_bundler.env.map.createNullDelimitedEnvMap(bun.default_allocator),

            .cwd = bunx_cache_dir,
            .stderr = .inherit,
            .stdout = .inherit,
            .stdin = .inherit,

            .windows = if (Environment.isWindows) .{
                .loop = bun.JSC.EventLoopHandle.init(bun.JSC.MiniEventLoop.initGlobal(this_bundler.env)),
            } else {},
        }) catch |err| {
            Output.prettyErrorln("<r><red>error<r>: bunx failed to install <b>{s}<r> due to error <b>{s}<r>", .{ install_param, @errorName(err) });
            Global.exit(1);
        })) {
            .err => |err| {
                _ = err; // autofix
                Global.exit(1);
            },
            .result => |result| result,
        };

        switch (spawn_result.status) {
            .exited => |exit| {
                if (exit.signal.valid()) {
                    Global.raiseIgnoringPanicHandler(exit.signal);
                }

                if (exit.code != 0) {
                    Global.exit(exit.code);
                }
            },
            .signaled => |signal| {
                Global.raiseIgnoringPanicHandler(signal);
            },
            .err => |err| {
                Output.prettyErrorln("<r><red>error<r>: bunx failed to install <b>{s}<r> due to error:\n{}", .{ install_param, err });
                Global.exit(1);
            },
            else => {},
        }

        absolute_in_cache_dir = std.fmt.bufPrint(&absolute_in_cache_dir_buf, bun.pathLiteral("{s}/node_modules/.bin/{s}{s}"), .{ bunx_cache_dir, initial_bin_name, bun.exe_suffix }) catch unreachable;

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
            try Run.runBinary(
                ctx,
                try this_bundler.fs.dirname_store.append(@TypeOf(out), out),
                destination,
                this_bundler.fs.top_level_dir,
                this_bundler.env,
                passthrough,
                null,
            );
            // runBinary is noreturn
            @compileError("unreachable");
        }

        // 2. The "bin" is possibly not the same as the package name, so we load the package.json to figure out what "bin" to use
        if (getBinNameFromTempDirectory(&this_bundler, bunx_cache_dir, result_package_name, false)) |package_name_for_bin| {
            if (!strings.eqlLong(package_name_for_bin, initial_bin_name, true)) {
                absolute_in_cache_dir = std.fmt.bufPrint(&absolute_in_cache_dir_buf, "{s}/node_modules/.bin/{s}{s}", .{ bunx_cache_dir, package_name_for_bin, bun.exe_suffix }) catch unreachable;

                if (bun.which(
                    &path_buf,
                    bunx_cache_dir,
                    if (ignore_cwd.len > 0) "" else this_bundler.fs.top_level_dir,
                    absolute_in_cache_dir,
                )) |destination| {
                    const out = bun.asByteSlice(destination);
                    try Run.runBinary(
                        ctx,
                        try this_bundler.fs.dirname_store.append(@TypeOf(out), out),
                        destination,
                        this_bundler.fs.top_level_dir,
                        this_bundler.env,
                        passthrough,
                        null,
                    );
                    // runBinary is noreturn
                    @compileError("unreachable");
                }
            }
        } else |_| {}

        Output.errGeneric("could not determine executable to run for package <b>{s}<r>", .{update_request.name});
        Global.exit(1);
    }
};
