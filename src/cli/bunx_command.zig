const std = @import("std");
const bun = @import("bun");
const string = bun.string;
const Allocator = std.mem.Allocator;
const Output = bun.Output;
const Global = bun.Global;
const Environment = bun.Environment;
const strings = bun.strings;
const default_allocator = bun.default_allocator;

const cli = @import("../cli.zig");

const Command = cli.Command;
const Run = @import("./run_command.zig").RunCommand;
const UpdateRequest = bun.PackageManager.UpdateRequest;

const debug = Output.scoped(.bunx, false);

pub const BunxCommand = struct {
    var path_buf: bun.PathBuffer = undefined;

    /// bunx-specific options parsed from argv.
    const Options = struct {
        /// CLI arguments to pass to the command being run.
        passthrough_list: std.ArrayListUnmanaged(string) = .{},
        /// `bunx <package_name>`
        package_name: string,
        // `--silent` and `--verbose` are not mutually exclusive. Both the
        // global CLI parser and `bun add` parser use them for different
        // purposes.
        verbose_install: bool = false,
        silent_install: bool = false,
        /// Skip installing the package, only running the target command if its
        /// already downloaded. If its not, `bunx` exits with an error.
        no_install: bool = false,
        allocator: Allocator,

        /// Create a new `Options` instance by parsing CLI arguments. `ctx` may be mutated.
        ///
        /// ## Exits
        /// - `--revision` or `--version` flags are passed without a target
        ///   command also being provided. This is not a failure.
        /// - Incorrect arguments are passed. Prints usage and exits with a failure code.
        fn parse(ctx: bun.CLI.Command.Context, argv: [][:0]const u8) Allocator.Error!Options {
            var found_subcommand_name = false;
            var maybe_package_name: ?string = null;
            var has_version = false; //  --version
            var has_revision = false; // --revision

            // SAFETY: `opts` is only ever returned when a package name is found, otherwise the process exits.
            var opts = Options{ .package_name = undefined, .allocator = ctx.allocator };
            try opts.passthrough_list.ensureTotalCapacityPrecise(opts.allocator, argv.len);

            for (argv) |positional| {
                if (maybe_package_name != null) {
                    opts.passthrough_list.appendAssumeCapacity(positional);
                    continue;
                }

                if (positional.len > 0 and positional[0] == '-') {
                    if (strings.eqlComptime(positional, "--version") or strings.eqlComptime(positional, "-v")) {
                        has_version = true;
                    } else if (strings.eqlComptime(positional, "--revision")) {
                        has_revision = true;
                    } else if (strings.eqlComptime(positional, "--verbose")) {
                        opts.verbose_install = true;
                    } else if (strings.eqlComptime(positional, "--silent")) {
                        opts.silent_install = true;
                    } else if (strings.eqlComptime(positional, "--bun") or strings.eqlComptime(positional, "-b")) {
                        ctx.debug.run_in_bun = true;
                    } else if (strings.eqlComptime(positional, "--no-install")) {
                        opts.no_install = true;
                    }
                } else {
                    if (!found_subcommand_name) {
                        found_subcommand_name = true;
                    } else {
                        maybe_package_name = positional;
                    }
                }
            }

            // check if package_name_for_update_request is empty string or " "
            if (maybe_package_name == null or maybe_package_name.?.len == 0) {
                // no need to free memory b/c we're exiting
                if (has_revision) {
                    cli.printRevisionAndExit();
                } else if (has_version) {
                    cli.printVersionAndExit();
                } else {
                    exitWithUsage();
                }
            }
            opts.package_name = maybe_package_name.?;
            return opts;
        }

        fn deinit(self: *Options) void {
            self.passthrough_list.deinit(self.allocator);
            self.* = undefined;
        }
    };

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

    fn getBinNameFromSubpath(transpiler: *bun.Transpiler, dir_fd: bun.FileDescriptor, subpath_z: [:0]const u8) ![]const u8 {
        const target_package_json_fd = try bun.sys.openat(dir_fd, subpath_z, bun.O.RDONLY, 0).unwrap();
        const target_package_json = bun.sys.File{ .handle = target_package_json_fd };

        defer target_package_json.close();

        const package_json_read = target_package_json.readToEnd(transpiler.allocator);

        // TODO: make this better
        if (package_json_read.err) |err| {
            try (bun.JSC.Maybe(void){ .err = err }).unwrap();
        }

        const package_json_contents = package_json_read.bytes.items;
        const source = &bun.logger.Source.initPathString(bun.span(subpath_z), package_json_contents);

        bun.JSAst.Expr.Data.Store.create();
        bun.JSAst.Stmt.Data.Store.create();

        const expr = try bun.JSON.parsePackageJSONUTF8(source, transpiler.log, transpiler.allocator);

        // choose the first package that fits
        if (expr.get("bin")) |bin_expr| {
            switch (bin_expr.data) {
                .e_object => |object| {
                    for (object.properties.slice()) |prop| {
                        if (prop.key) |key| {
                            if (key.asString(transpiler.allocator)) |bin_name| {
                                if (bin_name.len == 0) continue;
                                return bin_name;
                            }
                        }
                    }
                },
                .e_string => {
                    if (expr.get("name")) |name_expr| {
                        if (name_expr.asString(transpiler.allocator)) |name| {
                            return name;
                        }
                    }
                },
                else => {},
            }
        }

        if (expr.asProperty("directories")) |dirs| {
            if (dirs.expr.asProperty("bin")) |bin_prop| {
                if (bin_prop.expr.asString(transpiler.allocator)) |dir_name| {
                    const bin_dir = try bun.sys.openatA(dir_fd, dir_name, bun.O.RDONLY | bun.O.DIRECTORY, 0).unwrap();
                    defer bin_dir.close();
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
                            return try transpiler.allocator.dupe(u8, current.name.slice());
                        }
                    }
                }
            }
        }

        return error.NoBinFound;
    }

    fn getBinNameFromProjectDirectory(transpiler: *bun.Transpiler, dir_fd: bun.FileDescriptor, package_name: []const u8) ![]const u8 {
        var subpath: bun.PathBuffer = undefined;
        const subpath_z = std.fmt.bufPrintZ(&subpath, bun.pathLiteral("node_modules/{s}/package.json"), .{package_name}) catch unreachable;
        return try getBinNameFromSubpath(transpiler, dir_fd, subpath_z);
    }

    fn getBinNameFromTempDirectory(transpiler: *bun.Transpiler, tempdir_name: []const u8, package_name: []const u8, with_stale_check: bool) ![]const u8 {
        var subpath: bun.PathBuffer = undefined;
        if (with_stale_check) {
            const subpath_z = std.fmt.bufPrintZ(
                &subpath,
                bun.pathLiteral("{s}/package.json"),
                .{tempdir_name},
            ) catch unreachable;
            const target_package_json_fd = bun.sys.openat(bun.FD.cwd(), subpath_z, bun.O.RDONLY, 0).unwrap() catch return error.NeedToInstall;
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
                    break :is_stale std.time.timestamp() - stat.mtime().sec > seconds_cache_valid;
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

        return try getBinNameFromSubpath(transpiler, bun.FD.cwd(), subpath_z);
    }

    /// Check the enclosing package.json for a matching "bin"
    /// If not found, check bunx cache dir
    fn getBinName(transpiler: *bun.Transpiler, toplevel_fd: bun.FileDescriptor, tempdir_name: []const u8, package_name: []const u8) error{ NoBinFound, NeedToInstall }![]const u8 {
        bun.assert(toplevel_fd.isValid());
        return getBinNameFromProjectDirectory(transpiler, toplevel_fd, package_name) catch |err| {
            if (err == error.NoBinFound) {
                return error.NoBinFound;
            }

            return getBinNameFromTempDirectory(transpiler, tempdir_name, package_name, true) catch |err2| {
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

        var opts = try Options.parse(ctx, argv);
        defer opts.deinit();

        var requests_buf = UpdateRequest.Array.initCapacity(ctx.allocator, 64) catch bun.outOfMemory();
        defer requests_buf.deinit(ctx.allocator);
        const update_requests = UpdateRequest.parse(
            ctx.allocator,
            null,
            ctx.log,
            &.{opts.package_name},
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
        // SAFETY: initialized by Run.configureEnvForRun
        var this_transpiler: bun.Transpiler = undefined;
        var ORIGINAL_PATH: string = "";

        const root_dir_info = try Run.configureEnvForRun(
            ctx,
            &this_transpiler,
            null,
            true,
            true,
        );

        try Run.configurePathForRun(
            ctx,
            root_dir_info,
            &this_transpiler,
            &ORIGINAL_PATH,
            root_dir_info.abs_path,
            ctx.debug.run_in_bun,
        );
        this_transpiler.env.map.put("npm_command", "exec") catch unreachable;
        this_transpiler.env.map.put("npm_lifecycle_event", "bunx") catch unreachable;
        this_transpiler.env.map.put("npm_lifecycle_script", opts.package_name) catch unreachable;

        if (strings.eqlComptime(opts.package_name, "bun-repl")) {
            this_transpiler.env.map.remove("BUN_INSPECT_CONNECT_TO");
            this_transpiler.env.map.remove("BUN_INSPECT_NOTIFY");
            this_transpiler.env.map.remove("BUN_INSPECT");
        }

        const ignore_cwd = this_transpiler.env.get("BUN_WHICH_IGNORE_CWD") orelse "";

        if (ignore_cwd.len > 0) {
            _ = this_transpiler.env.map.map.swapRemove("BUN_WHICH_IGNORE_CWD");
        }

        var PATH = this_transpiler.env.get("PATH").?;
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

            const has_banned_char = strings.indexAnyComptime(update_request.name, banned_path_chars) != null or strings.indexAnyComptime(display_version, banned_path_chars) != null;

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
        const uid = if (bun.Environment.isPosix) bun.c.getuid() else bun.windows.userUniqueId();
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

        try this_transpiler.env.map.put("PATH", PATH);
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

        const passthrough = opts.passthrough_list.items;

        var do_cache_bust = update_request.version.tag == .dist_tag;
        const look_for_existing_bin = update_request.version.literal.isEmpty() or update_request.version.tag != .dist_tag;

        debug("try run existing? {}", .{look_for_existing_bin});
        if (look_for_existing_bin) try_run_existing: {
            var destination_: ?[:0]const u8 = null;

            // Only use the system-installed version if there is no version specified
            if (update_request.version.literal.isEmpty()) {
                destination_ = bun.which(
                    &path_buf,
                    PATH_FOR_BIN_DIRS,
                    if (ignore_cwd.len > 0) "" else this_transpiler.fs.top_level_dir,
                    initial_bin_name,
                );
            }

            // Similar to "npx":
            //
            //  1. Try the bin in the current node_modules and then we try the bin in the global cache
            if (destination_ orelse bun.which(
                &path_buf,
                bunx_cache_dir,
                if (ignore_cwd.len > 0) "" else this_transpiler.fs.top_level_dir,
                absolute_in_cache_dir,
            )) |destination| {
                const out = bun.asByteSlice(destination);

                // If this directory was installed by bunx, we want to perform cache invalidation on it
                // this way running `bunx hello` will update hello automatically to the latest version
                if (bun.strings.hasPrefix(out, bunx_cache_dir)) {
                    const is_stale = is_stale: {
                        if (Environment.isWindows) {
                            const fd = bun.sys.openat(.cwd(), destination, bun.O.RDONLY, 0).unwrap() catch {
                                // if we cant open this, we probably will just fail when we run it
                                // and that error message is likely going to be better than the one from `bun add`
                                break :is_stale false;
                            };
                            defer fd.close();

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
                            var stat: std.posix.Stat = undefined;
                            const rc = std.c.stat(destination, &stat);
                            if (rc != 0) {
                                break :is_stale true;
                            }
                            break :is_stale std.time.timestamp() - stat.mtime().sec > seconds_cache_valid;
                        }
                    };

                    if (is_stale) {
                        debug("found stale binary: {s}", .{out});
                        do_cache_bust = true;
                        if (opts.no_install) {
                            Output.warn("Using a stale installation of <b>{s}<r> because --no-install was passed. Run `bunx` without --no-install to use a fresh binary.", .{update_request.name});
                        } else {
                            break :try_run_existing;
                        }
                    }
                }

                debug("running existing binary: {s}", .{destination});
                try Run.runBinary(
                    ctx,
                    try this_transpiler.fs.dirname_store.append(@TypeOf(out), out),
                    destination,
                    this_transpiler.fs.top_level_dir,
                    this_transpiler.env,
                    passthrough,
                    null,
                );
                // runBinary is noreturn
                @compileError("unreachable");
            }

            // 2. The "bin" is possibly not the same as the package name, so we load the package.json to figure out what "bin" to use
            const root_dir_fd = root_dir_info.getFileDescriptor();
            bun.assert(root_dir_fd.isValid());
            if (getBinName(&this_transpiler, root_dir_fd, bunx_cache_dir, initial_bin_name)) |package_name_for_bin| {
                // if we check the bin name and its actually the same, we don't need to check $PATH here again
                if (!strings.eqlLong(package_name_for_bin, initial_bin_name, true)) {
                    absolute_in_cache_dir = std.fmt.bufPrint(&absolute_in_cache_dir_buf, bun.pathLiteral("{s}/node_modules/.bin/{s}{s}"), .{ bunx_cache_dir, package_name_for_bin, bun.exe_suffix }) catch unreachable;

                    // Only use the system-installed version if there is no version specified
                    if (update_request.version.literal.isEmpty()) {
                        destination_ = bun.which(
                            &path_buf,
                            bunx_cache_dir,
                            if (ignore_cwd.len > 0) "" else this_transpiler.fs.top_level_dir,
                            package_name_for_bin,
                        );
                    }

                    if (destination_ orelse bun.which(
                        &path_buf,
                        bunx_cache_dir,
                        if (ignore_cwd.len > 0) "" else this_transpiler.fs.top_level_dir,
                        absolute_in_cache_dir,
                    )) |destination| {
                        const out = bun.asByteSlice(destination);
                        try Run.runBinary(
                            ctx,
                            try this_transpiler.fs.dirname_store.append(@TypeOf(out), out),
                            destination,
                            this_transpiler.fs.top_level_dir,
                            this_transpiler.env,
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
        // If we've reached this point, it means we couldn't find an existing binary to run.
        // Next step is to install, then run it.

        // NOTE: npx prints errors like this:
        //
        //     npm error npx canceled due to missing packages and no YES option: ["foo@1.2.3"]
        //     npm error A complete log of this run can be found in: [folder]/debug.log
        //
        // Which is not very helpful.

        if (opts.no_install) {
            Output.errGeneric(
                "Could not find an existing '{s}' binary to run. Stopping because --no-install was passed.",
                .{initial_bin_name},
            );
            Global.exit(1);
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

        if (opts.verbose_install) {
            args.append("--verbose") catch
                unreachable; // upper bound is known
        }

        if (opts.silent_install) {
            args.append("--silent") catch
                unreachable; // upper bound is known
        }

        const argv_to_use = args.slice();

        debug("installing package: {s}", .{bun.fmt.fmtSlice(argv_to_use, " ")});
        this_transpiler.env.map.put("BUN_INTERNAL_BUNX_INSTALL", "true") catch bun.outOfMemory();

        const spawn_result = switch ((bun.spawnSync(&.{
            .argv = argv_to_use,

            .envp = try this_transpiler.env.map.createNullDelimitedEnvMap(bun.default_allocator),

            .cwd = bunx_cache_dir,
            .stderr = .inherit,
            .stdout = .inherit,
            .stdin = .inherit,

            .windows = if (Environment.isWindows) .{
                .loop = bun.JSC.EventLoopHandle.init(bun.JSC.MiniEventLoop.initGlobal(this_transpiler.env)),
            },
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
            if (ignore_cwd.len > 0) "" else this_transpiler.fs.top_level_dir,
            absolute_in_cache_dir,
        )) |destination| {
            const out = bun.asByteSlice(destination);
            try Run.runBinary(
                ctx,
                try this_transpiler.fs.dirname_store.append(@TypeOf(out), out),
                destination,
                this_transpiler.fs.top_level_dir,
                this_transpiler.env,
                passthrough,
                null,
            );
            // runBinary is noreturn
            @compileError("unreachable");
        }

        // 2. The "bin" is possibly not the same as the package name, so we load the package.json to figure out what "bin" to use
        if (getBinNameFromTempDirectory(&this_transpiler, bunx_cache_dir, result_package_name, false)) |package_name_for_bin| {
            if (!strings.eqlLong(package_name_for_bin, initial_bin_name, true)) {
                absolute_in_cache_dir = std.fmt.bufPrint(&absolute_in_cache_dir_buf, "{s}/node_modules/.bin/{s}{s}", .{ bunx_cache_dir, package_name_for_bin, bun.exe_suffix }) catch unreachable;

                if (bun.which(
                    &path_buf,
                    bunx_cache_dir,
                    if (ignore_cwd.len > 0) "" else this_transpiler.fs.top_level_dir,
                    absolute_in_cache_dir,
                )) |destination| {
                    const out = bun.asByteSlice(destination);
                    try Run.runBinary(
                        ctx,
                        try this_transpiler.fs.dirname_store.append(@TypeOf(out), out),
                        destination,
                        this_transpiler.fs.top_level_dir,
                        this_transpiler.env,
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
