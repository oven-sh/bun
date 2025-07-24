pub const NodeCommand = struct {
    pub fn exec(ctx: Command.Context) !void {
        const relevant_args = bun.argv[2..];

        if (relevant_args.len == 0) {
            printHelp();
            return;
        }

        const first_arg = relevant_args[0];

        if (strings.eqlComptime(first_arg, "bun")) {
            try handleNodeAlias(ctx, "bun");
            return;
        }

        if (looksLikeVersion(first_arg)) {
            if (relevant_args.len == 1) {
                try installNodeVersion(ctx, first_arg, true);
            } else {
                try runWithNodeVersion(ctx, first_arg, relevant_args[1..]);
            }
        } else {
            try runWithDefaultNode(ctx, relevant_args);
        }
    }

    fn printHelp() void {
        Output.prettyln("<r><b>bun node<r> <d>v" ++ Global.package_json_version_with_sha ++ "<r>", .{});

        Output.prettyln(
            \\Install & manage Node.js versions or configure node to use Bun instead.
            \\
            \\<b>Examples:<r>
            \\  <d>$<r> <b><green>bun node<r> <cyan>latest<r>            <d>Install latest Node.js and set as default<r>
            \\  <d>$<r> <b><green>bun node<r> <cyan>lts<r>               <d>Install latest LTS Node.js and set as default<r>
            \\  <d>$<r> <b><green>bun node<r> <blue>24<r>                <d>Install latest Node.js v24.x and set as default<r>
            \\  <d>$<r> <b><green>bun node<r> <blue>foo.js<r>            <d>Run foo.js with default Node.js<r>
            \\  <d>$<r> <b><green>bun node<r> <blue>24.0.0 foo.js<r>     <d>Run foo.js with Node.js v24.0.0<r>
            \\  <d>$<r> <b><green>bun node<r> <cyan>bun<r>               <d>Make 'node' command run Bun instead<r>
            \\
            \\<d><b>Note:<r><d> Latest version information is cached for 24 hours.<r>
            \\
        , .{});
    }

    fn looksLikeVersion(arg: []const u8) bool {
        if (arg.len == 0) return false;

        if (strings.eqlComptime(arg, "latest") or
            strings.eqlComptime(arg, "lts") or
            strings.eqlComptime(arg, "current"))
        {
            return true;
        }

        if (arg[0] != 'v' and !std.ascii.isDigit(arg[0])) return false;

        const start: usize = if (arg[0] == 'v') 1 else 0;
        for (arg[start..]) |c| {
            if (!std.ascii.isDigit(c) and c != '.' and c != '-') return false;
        }

        return true;
    }

    fn getNodeCacheDir(allocator: std.mem.Allocator) ![]const u8 {
        var global_dir = try Options.openGlobalDir("");
        defer global_dir.close();
        var path_buf: bun.PathBuffer = undefined;
        const path = try bun.getFdPath(bun.FD.fromStdDir(global_dir), &path_buf);
        const result = try std.fs.path.join(allocator, &.{ path, "node" });
        return result;
    }

    fn getNodeBinDir(allocator: std.mem.Allocator) ![]const u8 {
        if (bun.getenvZ("BUN_INSTALL_BIN")) |bin_dir| {
            return try allocator.dupe(u8, bin_dir);
        }

        const install_dir = bun.getenvZ("BUN_INSTALL") orelse brk: {
            const home = bun.getenvZ("HOME") orelse bun.getenvZ("USERPROFILE") orelse {
                Output.prettyErrorln("<r><red>error:<r> unable to find home directory", .{});
                Global.crash();
            };
            break :brk try std.fs.path.join(allocator, &.{ home, ".bun" });
        };

        if (bun.getenvZ("BUN_INSTALL") != null) {
            return try std.fs.path.join(allocator, &.{ install_dir, "bin" });
        } else {
            defer allocator.free(install_dir);
            return try std.fs.path.join(allocator, &.{ install_dir, "bin" });
        }
    }

    fn normalizeVersion(version: []const u8) []const u8 {
        if (version.len > 0 and version[0] == 'v') {
            return version[1..];
        }
        return version;
    }

    fn resolveVersion(allocator: std.mem.Allocator, version_spec: []const u8) ![]const u8 {
        const normalized = normalizeVersion(version_spec);

        if (strings.eqlComptime(normalized, "latest")) {
            return try fetchNodeVersion(allocator, .latest, null);
        } else if (strings.eqlComptime(normalized, "lts")) {
            return try fetchNodeVersion(allocator, .lts, null);
        } else if (strings.eqlComptime(normalized, "current")) {
            return try fetchNodeVersion(allocator, .latest, null);
        }

        if (strings.indexOf(normalized, ".")) |_| {
            return try allocator.dupe(u8, normalized);
        }

        return try fetchNodeVersion(allocator, .major, normalized);
    }

    fn getCachedVersionInfo(allocator: std.mem.Allocator) !?[]const u8 {
        const cache_dir = try getNodeCacheDir(allocator);
        defer allocator.free(cache_dir);

        const cache_file = try std.fs.path.join(allocator, &.{ cache_dir, ".version-cache" });
        defer allocator.free(cache_file);

        var file = std.fs.openFileAbsolute(cache_file, .{}) catch return null;
        defer file.close();

        const stat = try file.stat();
        const now = std.time.timestamp();
        const age = now - @divFloor(stat.mtime, std.time.ns_per_s);

        if (age > 24 * 60 * 60) {
            return null;
        }

        const content = try file.readToEndAlloc(allocator, 1024 * 1024);
        return content;
    }

    fn saveCachedVersionInfo(allocator: std.mem.Allocator, data: []const u8) !void {
        const cache_dir = try getNodeCacheDir(allocator);
        defer allocator.free(cache_dir);

        const cache_dirZ = try allocator.dupeZ(u8, cache_dir);
        defer allocator.free(cache_dirZ);

        switch (bun.sys.mkdir(cache_dirZ, 0o755)) {
            .result => {},
            .err => |err| {
                if (err.errno != @intFromEnum(bun.sys.E.EXIST)) {
                    return err.toZigErr();
                }
            },
        }

        const cache_file = try std.fs.path.join(allocator, &.{ cache_dir, ".version-cache" });
        defer allocator.free(cache_file);

        const cache_fileZ = try allocator.dupeZ(u8, cache_file);
        defer allocator.free(cache_fileZ);

        const fd = switch (bun.sys.open(cache_fileZ, bun.O.WRONLY | bun.O.CREAT | bun.O.TRUNC, 0o644)) {
            .result => |fd| fd,
            .err => |err| return err.toZigErr(),
        };
        defer fd.close();

        var file = bun.sys.File{ .handle = fd };
        switch (file.writeAll(data)) {
            .result => {},
            .err => |err| return err.toZigErr(),
        }
    }

    fn fetchNodeVersion(allocator: std.mem.Allocator, filter: VersionFilter, major_version: ?[]const u8) ![]const u8 {
        if (try getCachedVersionInfo(allocator)) |cached| {
            defer allocator.free(cached);
            return try parseVersionFromCache(allocator, cached, filter, major_version);
        }

        const version_data = try fetchNodeVersionsFromAPI(allocator);
        defer allocator.free(version_data);

        saveCachedVersionInfo(allocator, version_data) catch {};

        return try parseVersionFromCache(allocator, version_data, filter, major_version);
    }

    fn fetchNodeVersionsFromAPI(allocator: std.mem.Allocator) ![]const u8 {
        const url = URL.parse("https://nodejs.org/dist/index.json");
        var response_buffer = try MutableString.init(allocator, 0);
        defer response_buffer.deinit();

        var req = AsyncHTTP.initSync(allocator, .GET, url, .{}, "", &response_buffer, "", null, null, .follow);

        const response = req.sendSync() catch |err| {
            Output.prettyErrorln("<r><red>error:<r> Failed to fetch Node.js versions from API: {}", .{err});
            Global.exit(1);
        };

        if (response.status_code != 200) {
            Output.prettyErrorln("<r><red>error:<r> Failed to fetch Node.js versions: HTTP {d}", .{response.status_code});
            Global.exit(1);
        }

        return try allocator.dupe(u8, response_buffer.list.items);
    }

    const VersionFilter = enum {
        latest,
        lts,
        major,
    };

    fn parseVersionFromCache(allocator: std.mem.Allocator, json_data: []const u8, filter: VersionFilter, major_version: ?[]const u8) ![]const u8 {
        const parsed = try std.json.parseFromSlice(std.json.Value, allocator, json_data, .{});
        defer parsed.deinit();

        const array = switch (parsed.value) {
            .array => |arr| arr,
            else => {
                Output.prettyErrorln("<r><red>error:<r> Invalid Node.js version data format", .{});
                Global.exit(1);
            },
        };

        for (array.items) |item| {
            const obj = switch (item) {
                .object => |o| o,
                else => continue,
            };

            const version_value = obj.get("version") orelse continue;
            const version_str = switch (version_value) {
                .string => |s| s,
                else => continue,
            };

            var version = version_str;
            if (version.len > 0 and version[0] == 'v') {
                version = version[1..];
            }

            switch (filter) {
                .latest => {
                    return try allocator.dupe(u8, version);
                },
                .lts => {
                    if (obj.get("lts")) |lts_val| {
                        switch (lts_val) {
                            .string => return try allocator.dupe(u8, version),
                            else => {},
                        }
                    }
                },
                .major => {
                    if (strings.indexOf(version, ".")) |dot_idx| {
                        const major = version[0..dot_idx];
                        if (strings.eql(major, major_version.?)) {
                            return try allocator.dupe(u8, version);
                        }
                    }
                },
            }
        }

        switch (filter) {
            .latest => {
                Output.prettyErrorln("<r><red>error:<r> Could not determine latest Node.js version", .{});
                Global.exit(1);
            },
            .lts => {
                Output.prettyErrorln("<r><red>error:<r> Could not find LTS version in Node.js version data", .{});
                Global.exit(1);
            },
            .major => {
                Output.prettyErrorln("<r><red>error:<r> Node.js version {s} not found", .{major_version.?});
                Global.exit(1);
            },
        }
    }

    const node_platform = blk: {
        if (Env.isMac) {
            if (Env.isAarch64) {
                break :blk "darwin-arm64";
            } else {
                break :blk "darwin-x64";
            }
        } else if (Env.isLinux) {
            if (Env.isAarch64) {
                break :blk "linux-arm64";
            } else {
                break :blk "linux-x64";
            }
        } else if (Env.isWindows) {
            if (Env.isAarch64) {
                break :blk "win-arm64";
            } else {
                break :blk "win-x64";
            }
        }
        break :blk "unknown";
    };

    const node_binary_name = if (Env.isWindows) "node.exe" else "node";
    const node_archive_ext = if (Env.isWindows) "zip" else "tar.gz";
    const node_archive_url_fmt = "https://nodejs.org/dist/v{s}/node-v{s}-" ++ node_platform ++ "." ++ node_archive_ext;

    fn downloadNode(allocator: std.mem.Allocator, version: []const u8, dest_dir: []const u8) !void {
        const url_str = try std.fmt.allocPrint(allocator, node_archive_url_fmt, .{ version, version });
        defer allocator.free(url_str);

        Output.prettyln("<r><green>Downloading<r> Node.js v{s}", .{version});
        Output.flush();

        try downloadNodeInternal(allocator, url_str, dest_dir, version, false);
    }

    fn downloadNodeSilent(allocator: std.mem.Allocator, version: []const u8, dest_dir: []const u8) !void {
        const url_str = try std.fmt.allocPrint(allocator, node_archive_url_fmt, .{ version, version });
        defer allocator.free(url_str);

        if (Output.enable_ansi_colors_stderr) {
            Output.prettyError("<r><green>Downloading<r> Node.js v{s}", .{version});
            Output.flush();
        }

        try downloadNodeInternal(allocator, url_str, dest_dir, version, true);

        if (Output.enable_ansi_colors_stderr) {
            Output.prettyError("\r\x1b[K", .{});
            Output.flush();
        }
    }

    fn downloadNodeInternal(allocator: std.mem.Allocator, url_str: []const u8, dest_dir: []const u8, version: []const u8, is_quiet: bool) !void {
        const parent_dir = std.fs.path.dirname(dest_dir);
        if (parent_dir) |parent| {
            std.fs.cwd().makePath(parent) catch {};
        }

        const dest_dirZ = try allocator.dupeZ(u8, dest_dir);
        defer allocator.free(dest_dirZ);

        switch (bun.sys.mkdir(dest_dirZ, 0o755)) {
            .result => {},
            .err => |err| {
                if (err.errno != @intFromEnum(bun.sys.E.EXIST)) {
                    if (is_quiet) Output.prettyErrorln("", .{});
                    Output.prettyErrorln("<r><red>error:<r> Failed to create directory {s}: {}", .{ dest_dir, err });
                    Global.exit(1);
                }
            },
        }

        const temp_archive = try std.fmt.allocPrint(allocator, "{s}.download." ++ node_archive_ext, .{dest_dir});
        defer allocator.free(temp_archive);
        defer {
            if (allocator.dupeZ(u8, temp_archive)) |temp_archiveZ| {
                defer allocator.free(temp_archiveZ);
                _ = bun.sys.unlink(temp_archiveZ);
            } else |_| {}
        }

        const url = URL.parse(url_str);
        var response_buffer = try MutableString.init(allocator, 0);
        defer response_buffer.deinit();

        var req = AsyncHTTP.initSync(allocator, .GET, url, .{}, "", &response_buffer, "", null, null, .follow);

        const response = req.sendSync() catch |err| {
            if (is_quiet) Output.prettyErrorln("", .{});
            Output.prettyErrorln("<r><red>error:<r> Failed to download Node.js v{s}: {}", .{ version, err });
            Global.exit(1);
        };

        if (response.status_code != 200) {
            if (is_quiet) Output.prettyErrorln("", .{});
            Output.prettyErrorln("<r><red>error:<r> Failed to download Node.js v{s}: HTTP {d}", .{ version, response.status_code });
            Global.exit(1);
        }

        const temp_archiveZ = try allocator.dupeZ(u8, temp_archive);
        defer allocator.free(temp_archiveZ);

        const fd = switch (bun.sys.open(temp_archiveZ, bun.O.WRONLY | bun.O.CREAT | bun.O.TRUNC, 0o644)) {
            .result => |fd| fd,
            .err => |err| {
                if (is_quiet) Output.prettyErrorln("", .{});
                Output.prettyErrorln("<r><red>error:<r> Failed to create file {s}: {}", .{ temp_archive, err });
                Global.exit(1);
            },
        };
        defer fd.close();

        var file = bun.sys.File{ .handle = fd };
        switch (file.writeAll(response_buffer.list.items)) {
            .result => {},
            .err => |err| {
                if (is_quiet) Output.prettyErrorln("", .{});
                Output.prettyErrorln("<r><red>error:<r> Failed to write archive {s}: {}", .{ temp_archive, err });
                Global.exit(1);
            },
        }

        try extractNodeArchive(allocator, temp_archive, dest_dir, version, is_quiet);
    }

    fn extractNodeArchive(allocator: std.mem.Allocator, archive_path: []const u8, dest_dir: []const u8, version: []const u8, is_quiet: bool) !void {
        _ = version;
        const archive_data = std.fs.cwd().readFileAlloc(allocator, archive_path, std.math.maxInt(usize)) catch |err| {
            if (is_quiet) Output.prettyErrorln("", .{});
            Output.prettyErrorln("<r><red>error:<r> Failed to read archive {s}: {}", .{ archive_path, err });
            Global.exit(1);
        };
        defer allocator.free(archive_data);

        var dest_dir_handle = std.fs.openDirAbsolute(dest_dir, .{}) catch |err| {
            if (is_quiet) Output.prettyErrorln("", .{});
            Output.prettyErrorln("<r><red>error:<r> Failed to open destination directory {s}: {}", .{ dest_dir, err });
            Global.exit(1);
        };
        defer dest_dir_handle.close();

        _ = Archiver.extractToDir(
            archive_data,
            dest_dir_handle,
            null,
            void,
            {},
            .{
                .depth_to_skip = 1,
                .close_handles = true,
            },
        ) catch |err| {
            if (is_quiet) Output.prettyErrorln("", .{});
            Output.prettyErrorln("<r><red>error:<r> Failed to extract archive {s}: {}", .{ archive_path, err });
            Global.exit(1);
        };

        const src_binary = if (Env.isWindows)
            try std.fs.path.join(allocator, &.{ dest_dir, node_binary_name })
        else
            try std.fs.path.join(allocator, &.{ dest_dir, "bin", node_binary_name });
        defer allocator.free(src_binary);

        const dest_binary = try std.fs.path.join(allocator, &.{ dest_dir, node_binary_name });
        defer allocator.free(dest_binary);

        if (!Env.isWindows or !strings.eql(src_binary, dest_binary)) {
            if (Env.isWindows) {
                var src_buf: bun.OSPathBuffer = undefined;
                var dest_buf: bun.OSPathBuffer = undefined;
                const src_path = bun.strings.toWPathNormalized(&src_buf, src_binary);
                const dest_path = bun.strings.toWPathNormalized(&dest_buf, dest_binary);

                bun.copyFile(src_path, dest_path).unwrap() catch |err| {
                    if (is_quiet) Output.prettyErrorln("", .{});
                    Output.prettyErrorln("<r><red>error:<r> Failed to copy binary: {}", .{err});
                    Global.exit(1);
                };
            } else {
                const src_fd = switch (bun.sys.open(try allocator.dupeZ(u8, src_binary), bun.O.RDONLY, 0)) {
                    .result => |fd| fd,
                    .err => |err| {
                        if (is_quiet) Output.prettyErrorln("", .{});
                        Output.prettyErrorln("<r><red>error:<r> Failed to open source binary: {}", .{err});
                        Global.exit(1);
                    },
                };
                defer src_fd.close();

                const dest_fd = switch (bun.sys.open(try allocator.dupeZ(u8, dest_binary), bun.O.WRONLY | bun.O.CREAT | bun.O.TRUNC, 0o755)) {
                    .result => |fd| fd,
                    .err => |err| {
                        if (is_quiet) Output.prettyErrorln("", .{});
                        Output.prettyErrorln("<r><red>error:<r> Failed to create dest binary: {}", .{err});
                        Global.exit(1);
                    },
                };
                defer dest_fd.close();

                bun.copyFile(src_fd, dest_fd).unwrap() catch |err| {
                    if (is_quiet) Output.prettyErrorln("", .{});
                    Output.prettyErrorln("<r><red>error:<r> Failed to copy binary: {}", .{err});
                    Global.exit(1);
                };
            }
        }

        if (Env.isPosix) {
            const dest_binaryZ = try allocator.dupeZ(u8, dest_binary);
            defer allocator.free(dest_binaryZ);

            switch (bun.sys.chmod(dest_binaryZ, 0o755)) {
                .result => {},
                .err => |err| {
                    if (is_quiet) Output.prettyErrorln("", .{});
                    Output.prettyErrorln("<r><red>error:<r> Failed to chmod {s}: {}", .{ dest_binary, err });
                    Global.exit(1);
                },
            }
        }
    }

    fn installNodeVersion(ctx: Command.Context, version_spec: []const u8, set_as_default: bool) !void {
        const allocator = ctx.allocator;
        const version = try resolveVersion(allocator, version_spec);
        defer allocator.free(version);

        const cache_dir = try getNodeCacheDir(allocator);
        defer allocator.free(cache_dir);

        const version_dir = try std.fmt.allocPrint(allocator, "{s}/node-{s}", .{ cache_dir, version });
        defer allocator.free(version_dir);

        const version_binary = try std.fmt.allocPrintZ(allocator, "{s}/" ++ node_binary_name, .{version_dir});
        defer allocator.free(version_binary);

        if (bun.sys.access(version_binary, 0) == .result) {
            if (set_as_default) {
                Output.prettyln("<r><green>✓<r> Node.js v{s} is already installed", .{version});
            }
        } else {
            if (set_as_default) {
                try downloadNode(allocator, version, version_dir);
                Output.prettyln("<r><green>✓<r> Successfully installed Node.js v{s}", .{version});
            } else {
                try downloadNodeSilent(allocator, version, version_dir);
            }
        }

        if (set_as_default) {
            try updateGlobalNodeSymlink(ctx, version);
            Output.prettyln("<r><green>✓<r> Set Node.js v{s} as default", .{version});

            try checkPathPriority(allocator);
        }
    }

    fn updateGlobalNodeSymlink(ctx: Command.Context, version: []const u8) !void {
        const allocator = ctx.allocator;

        const cache_dir = try getNodeCacheDir(allocator);
        defer allocator.free(cache_dir);

        const bin_dir = try getNodeBinDir(allocator);
        defer allocator.free(bin_dir);

        const bin_dirZ = try allocator.dupeZ(u8, bin_dir);
        defer allocator.free(bin_dirZ);

        switch (bun.sys.mkdir(bin_dirZ, 0o755)) {
            .result => {},
            .err => |err| {
                if (err.errno != @intFromEnum(bun.sys.E.EXIST)) {
                    return err.toZigErr();
                }
            },
        }

        const version_binary = try std.fmt.allocPrintZ(allocator, "{s}/node-{s}/" ++ node_binary_name, .{ cache_dir, version });
        defer allocator.free(version_binary);

        if (bun.sys.access(version_binary, 0) != .result) {
            const version_dir = try std.fmt.allocPrint(allocator, "{s}/node-{s}", .{ cache_dir, version });
            defer allocator.free(version_dir);

            Output.prettyErrorln("<r><yellow>warn:<r> Node.js v{s} binary not found, downloading...", .{version});
            try downloadNode(allocator, version, version_dir);
        }

        const global_binary = try std.fs.path.joinZ(allocator, &.{ bin_dir, node_binary_name });
        defer allocator.free(global_binary);

        _ = bun.sys.unlink(global_binary);

        switch (bun.sys.link(u8, version_binary, global_binary)) {
            .result => {},
            .err => |err| switch (err.getErrno()) {
                .XDEV => {
                    if (Env.isWindows) {
                        var src_buf: bun.OSPathBuffer = undefined;
                        var dest_buf: bun.OSPathBuffer = undefined;
                        const src_path = bun.strings.toWPathNormalized(&src_buf, version_binary);
                        const dest_path = bun.strings.toWPathNormalized(&dest_buf, global_binary);
                        
                        bun.copyFile(src_path, dest_path).unwrap() catch |copy_err| {
                            Output.prettyErrorln("<r><red>error:<r> Failed to copy Node binary: {}", .{copy_err});
                            Global.exit(1);
                        };
                    } else {
                        const src_fd = switch (bun.sys.open(version_binary, bun.O.RDONLY, 0)) {
                            .result => |fd| fd,
                            .err => |open_err| {
                                Output.prettyErrorln("<r><red>error:<r> Failed to open source binary: {}", .{open_err});
                                Global.exit(1);
                            },
                        };
                        defer src_fd.close();

                        const dest_fd = switch (bun.sys.open(global_binary, bun.O.WRONLY | bun.O.CREAT | bun.O.TRUNC, 0o755)) {
                            .result => |fd| fd,
                            .err => |open_err| {
                                Output.prettyErrorln("<r><red>error:<r> Failed to create dest binary: {}", .{open_err});
                                Global.exit(1);
                            },
                        };
                        defer dest_fd.close();

                        bun.copyFile(src_fd, dest_fd).unwrap() catch |copy_err| {
                            Output.prettyErrorln("<r><red>error:<r> Failed to copy Node binary: {}", .{copy_err});
                            Global.exit(1);
                        };
                    }
                },
                else => return err.toZigErr(),
            },
        }
    }

    fn handleNodeAlias(ctx: Command.Context, target: []const u8) !void {
        const allocator = ctx.allocator;

        if (!strings.eqlComptime(target, "bun")) {
            Output.prettyErrorln("<r><red>error:<r> only 'bun' is supported as alias target", .{});
            Global.exit(1);
        }

        const bin_dir = try getNodeBinDir(allocator);
        defer allocator.free(bin_dir);

        const bin_dirZ2 = try allocator.dupeZ(u8, bin_dir);
        defer allocator.free(bin_dirZ2);

        switch (bun.sys.mkdir(bin_dirZ2, 0o755)) {
            .result => {},
            .err => |err| {
                if (err.errno != @intFromEnum(bun.sys.E.EXIST)) {
                    return err.toZigErr();
                }
            },
        }

        const global_binary = try std.fs.path.joinZ(allocator, &.{ bin_dir, node_binary_name });
        defer allocator.free(global_binary);

        const bun_exe = bun.selfExePath() catch {
            Output.prettyErrorln("<r><red>error:<r> failed to determine bun executable path", .{});
            Global.crash();
        };

        _ = bun.sys.unlink(global_binary);

        switch (bun.sys.link(u8, bun_exe, global_binary)) {
            .result => {},
            .err => |err| switch (err.getErrno()) {
                .XDEV => {
                    if (Env.isWindows) {
                        var src_buf: bun.OSPathBuffer = undefined;
                        var dest_buf: bun.OSPathBuffer = undefined;
                        const src_path = bun.strings.toWPathNormalized(&src_buf, bun_exe);
                        const dest_path = bun.strings.toWPathNormalized(&dest_buf, global_binary);

                        bun.copyFile(src_path, dest_path).unwrap() catch |copy_err| {
                            Output.prettyErrorln("<r><red>error:<r> Failed to copy Bun binary: {}", .{copy_err});
                            Global.exit(1);
                        };
                    } else {
                        const src_fd = switch (bun.sys.open(try allocator.dupeZ(u8, bun_exe), bun.O.RDONLY, 0)) {
                            .result => |fd| fd,
                            .err => |open_err| {
                                Output.prettyErrorln("<r><red>error:<r> Failed to open Bun binary: {}", .{open_err});
                                Global.exit(1);
                            },
                        };
                        defer src_fd.close();

                        const dest_fd = switch (bun.sys.open(global_binary, bun.O.WRONLY | bun.O.CREAT | bun.O.TRUNC, 0o755)) {
                            .result => |fd| fd,
                            .err => |open_err| {
                                Output.prettyErrorln("<r><red>error:<r> Failed to create dest binary: {}", .{open_err});
                                Global.exit(1);
                            },
                        };
                        defer dest_fd.close();

                        bun.copyFile(src_fd, dest_fd).unwrap() catch |copy_err| {
                            Output.prettyErrorln("<r><red>error:<r> Failed to copy Bun binary: {}", .{copy_err});
                            Global.exit(1);
                        };
                    }
                },
                else => return err.toZigErr(),
            },
        }

        Output.prettyln("<r><green>✓<r> Successfully aliased 'node' to Bun", .{});
        Output.prettyln("<r><d>The 'node' command will now run Bun<r>", .{});

        try checkPathPriority(allocator);
    }

    fn runWithNodeVersion(ctx: Command.Context, version_spec: []const u8, args: []const []const u8) !void {
        const allocator = ctx.allocator;
        const version = try resolveVersion(allocator, version_spec);
        defer allocator.free(version);

        const cache_dir = try getNodeCacheDir(allocator);
        defer allocator.free(cache_dir);

        const version_binary = try std.fmt.allocPrint(allocator, "{s}/node-{s}/" ++ node_binary_name, .{ cache_dir, version });
        defer allocator.free(version_binary);

        const version_binaryZ3 = try allocator.dupeZ(u8, version_binary);
        defer allocator.free(version_binaryZ3);

        if (bun.sys.access(version_binaryZ3, 0) == .result) {
            try runNode(allocator, version_binary, args);
        } else {
            try installNodeVersion(ctx, version_spec, false);
            try runNode(allocator, version_binary, args);
        }
    }

    fn runWithDefaultNode(ctx: Command.Context, args: []const []const u8) !void {
        const allocator = ctx.allocator;

        const bin_dir = try getNodeBinDir(allocator);
        defer allocator.free(bin_dir);

        const node_symlink = try std.fs.path.joinZ(allocator, &.{ bin_dir, node_binary_name });
        defer allocator.free(node_symlink);

        if (bun.sys.access(node_symlink, 0) == .result) {
            try runNode(allocator, node_symlink, args);
            return;
        }

        var path_buf2: bun.PathBuffer = undefined;
        const path_env2 = bun.getenvZ("PATH") orelse "";
        var cwd_buf: bun.PathBuffer = undefined;
        const cwd_tmp = bun.getcwd(&cwd_buf) catch "";

        if (which(&path_buf2, path_env2, cwd_tmp, "node")) |node_path| {
            try runNode(allocator, node_path, args);
        } else {
            Output.prettyErrorln("<r><red>error:<r> Node.js not found", .{});
            Output.prettyln("Run 'bun node lts' to install Node.js", .{});
            Global.exit(1);
        }
    }

    fn runNode(allocator: std.mem.Allocator, node_path: []const u8, args: []const []const u8) !void {
        var argv = try allocator.alloc([]const u8, args.len + 1);
        defer allocator.free(argv);

        argv[0] = node_path;
        for (args, 1..) |arg, i| {
            argv[i] = arg;
        }

        const bin_dir = try getNodeBinDir(allocator);
        defer allocator.free(bin_dir);

        const current_path = bun.getenvZ("PATH") orelse "";
        const new_path = try std.fmt.allocPrint(allocator, "{s}{c}{s}", .{ bin_dir, if (Env.isWindows) ';' else ':', current_path });
        defer allocator.free(new_path);

        var env_map = try std.process.getEnvMap(allocator);
        defer env_map.deinit();
        try env_map.put("PATH", new_path);

        const envp_count = env_map.count();
        const envp_buf = try allocator.allocSentinel(?[*:0]const u8, envp_count, null);
        {
            var it = env_map.iterator();
            var i: usize = 0;
            while (it.next()) |pair| : (i += 1) {
                const env_buf = try allocator.allocSentinel(u8, pair.key_ptr.len + pair.value_ptr.len + 1, 0);
                bun.copy(u8, env_buf, pair.key_ptr.*);
                env_buf[pair.key_ptr.len] = '=';
                bun.copy(u8, env_buf[pair.key_ptr.len + 1 ..], pair.value_ptr.*);
                envp_buf[i] = env_buf.ptr;
            }
        }

        const node_pathZ = try allocator.dupeZ(u8, node_path);
        defer allocator.free(node_pathZ);

        const spawn_result = bun.spawnSync(&.{
            .argv = argv,
            .argv0 = node_pathZ,
            .envp = envp_buf,
            .cwd = try bun.getcwdAlloc(allocator),
            .stderr = .inherit,
            .stdout = .inherit,
            .stdin = .inherit,
            .use_execve_on_macos = true,
            .windows = if (Env.isWindows) .{
                .loop = bun.JSC.EventLoopHandle.init(bun.JSC.MiniEventLoop.initGlobal(null)),
                .hide_window = false,
            } else {},
        }) catch |err| {
            Output.prettyErrorln("<r><red>error:<r> Failed to run Node.js: {}", .{err});
            Global.exit(1);
        };

        switch (spawn_result) {
            .result => |result| {
                switch (result.status) {
                    .exited => |exit| {
                        Global.exit(exit.code);
                    },
                    .signaled => |signal| {
                        Output.prettyErrorln("<r><red>error:<r> Node.js terminated by signal: {}", .{signal});
                        Global.exit(1);
                    },
                    .err => |err| {
                        Output.prettyErrorln("<r><red>error:<r> Failed to run Node.js: {}", .{err});
                        Global.exit(1);
                    },
                    .running => {
                        Global.exit(1);
                    },
                }
            },
            .err => |err| {
                Output.prettyErrorln("<r><red>error:<r> Failed to spawn Node.js: {}", .{err.toSystemError()});
                Global.exit(1);
            },
        }
    }

    fn checkPathPriority(allocator: std.mem.Allocator) !void {
        const bin_dir = try getNodeBinDir(allocator);
        defer allocator.free(bin_dir);

        var path_buf: bun.PathBuffer = undefined;
        const path_env = bun.getenvZ("PATH") orelse "";
        var cwd_buf: bun.PathBuffer = undefined;
        const cwd = bun.getcwd(&cwd_buf) catch "";

        if (which(&path_buf, path_env, cwd, "node")) |node_path| {
            const node_dir = std.fs.path.dirname(node_path) orelse "";

            if (!strings.eql(node_dir, bin_dir)) {
                const inner_path_env = bun.getenvZ("PATH") orelse "";
                var path_entries = strings.split(inner_path_env, if (Env.isWindows) ";" else ":");

                var found_bun_dir = false;
                var found_other_dir = false;

                while (path_entries.next()) |entry| {
                    if (strings.eql(entry, bin_dir)) {
                        found_bun_dir = true;
                        if (found_other_dir) {
                            if (Env.isWindows) {
                                const msg =
                                    \\ 
                                    \\<r><yellow>⚠️  Warning:<r> The 'node' command may not use the Bun-managed version
                                    \\   Found 'node' at: {s}
                                    \\   Bun's bin directory ({s}) appears after another 'node' in PATH
                                    \\
                                    \\   To fix this, add Bun's bin directory earlier in your PATH:
                                    \\   1. Open System Properties → Advanced → Environment Variables
                                    \\   2. Edit the "Path" variable in System or User variables
                                    \\   3. Move "{s}" before other directories containing 'node'
                                    \\   4. Click OK and restart your terminal
                                    \\
                                    \\   Or run this in PowerShell as Administrator:
                                    \\   <cyan>[Environment]::SetEnvironmentVariable("Path", "{s};" + $env:Path, [System.EnvironmentVariableTarget]::User)<r>
                                    \\
                                ;
                                Output.prettyln(msg, .{ node_path, bin_dir, bin_dir, bin_dir });
                            } else {
                                const msg =
                                    \\ 
                                    \\<r><yellow>⚠️  Warning:<r> The 'node' command may not use the Bun-managed version
                                    \\   Found 'node' at: {s}
                                    \\   Bun's bin directory ({s}) appears after another 'node' in PATH
                                    \\
                                    \\   To fix this, add the following to the end of your shell configuration:
                                    \\   <cyan>export PATH="{s}:$PATH"<r>
                                    \\
                                ;
                                Output.prettyln(msg, .{ node_path, bin_dir, bin_dir });
                            }
                        }
                        break;
                    } else if (entry.len > 0) {
                        const test_node = try std.fs.path.joinZ(allocator, &.{ entry, "node" });
                        defer allocator.free(test_node);
                        if (bun.sys.access(test_node, 0) == .result) {
                            found_other_dir = true;
                        }
                    }
                }

                if (!found_bun_dir) {
                    if (Env.isWindows) {
                        const msg =
                            \\
                            \\ <r><yellow>⚠️  Warning:<r> Bun's bin directory is not in PATH
                            \\
                            \\   The 'node' command will not be available globally
                            \\
                            \\   To fix this:
                            \\   1. Open System Properties → Advanced → Environment Variables
                            \\   2. Edit the "Path" variable in System or User variables
                            \\   3. Add "{s}" to the list (and ensure it's before other directories containing 'node')
                            \\   4. Click OK and restart your terminal
                            \\
                            \\   Or run this in PowerShell as Administrator:
                            \\   <cyan>[Environment]::SetEnvironmentVariable("Path", $env:Path + ";{s}", [System.EnvironmentVariableTarget]::User)<r>
                            \\
                        ;
                        Output.prettyln(msg, .{ bin_dir, bin_dir });
                    } else {
                        const msg =
                            \\
                            \\ <r><yellow>⚠️  Warning:<r> Bun's bin directory is not in PATH
                            \\
                            \\   The 'node' command will not be available globally
                            \\
                            \\   To fix this, add the following to the end of your shell configuration:
                            \\   <cyan>export PATH="{s}:$PATH"<r>
                            \\
                        ;
                        Output.prettyln(msg, .{bin_dir});
                    }
                }
            }
        }
    }
};

const Options = @import("../install/PackageManager/PackageManagerOptions.zig");
const std = @import("std");
const Command = @import("../cli.zig").Command;
const which = @import("../which.zig").which;

const bun = @import("bun");
const Env = bun.Environment;
const Global = bun.Global;
const MutableString = bun.MutableString;
const Output = bun.Output;
const URL = bun.URL;
const strings = bun.strings;
const Archiver = bun.libarchive.Archiver;

const HTTP = bun.http;
const AsyncHTTP = HTTP.AsyncHTTP;
