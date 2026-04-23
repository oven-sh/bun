/// Bun version pinning via bunfig.toml `version` field.
///
/// When a project specifies a semver range in bunfig.toml:
///   version = "~1.2.3"
///
/// Bun checks if the running version satisfies it. If not, and bun was
/// installed via the official install script (~/.bun), it offers to
/// download the correct version, store it in ~/.bun/versions/<ver>/,
/// symlink ~/.bun/bin/bun to it, and re-exec.
///
/// Subsequent runs use the symlink directly — no double-init.
pub fn checkPinnedVersion(pinned_version_str: []const u8, allocator: std.mem.Allocator) void {
    @branchHint(.cold);

    var arena = std.heap.ArenaAllocator.init(allocator);
    defer arena.deinit();
    const arena_alloc = arena.allocator();

    const group = Semver.Query.parse(
        arena_alloc,
        pinned_version_str,
        Semver.SlicedString.init(pinned_version_str, pinned_version_str),
    ) catch {
        Output.prettyErrorln(
            "<r><yellow>warn<r>: Invalid version range <b>\"{s}\"<r> in bunfig.toml",
            .{pinned_version_str},
        );
        return;
    };

    // Semver.Query.parse silently accepts garbage input as an empty group
    // (which always satisfies). Detect and warn about it.
    if (!group.head.head.range.hasLeft() and group.head.head.range.right.op == .unset) {
        Output.prettyErrorln(
            "<r><yellow>warn<r>: Invalid version range <b>\"{s}\"<r> in bunfig.toml",
            .{pinned_version_str},
        );
        return;
    }

    const current = Semver.Version{
        .major = Environment.version.major,
        .minor = Environment.version.minor,
        .patch = Environment.version.patch,
    };
    const current_str = Global.package_json_version;

    if (group.satisfies(current, pinned_version_str, current_str)) {
        return;
    }

    // Version mismatch — determine if we can auto-install
    const install_dir = getBunInstallDir() orelse {
        Output.prettyErrorln(
            "<r><yellow>warn<r>: This project requires Bun <cyan>{s}<r> but you have <b>v{s}<r>\n" ++
                "      Bun was not installed via the official install script, so automatic version switching is unavailable.\n" ++
                "      Install the required version manually: <b>" ++
                (if (comptime Environment.isWindows) "powershell -c \"irm bun.sh/install.ps1 | iex\"" else "curl -fsSL https://bun.com/install | bash") ++
                "<r>",
            .{ pinned_version_str, current_str },
        );
        return;
    };

    const self_exe = bun.selfExePath() catch {
        printMismatchWarning(pinned_version_str, current_str);
        return;
    };

    // Verify self_exe is actually inside install_dir (boundary check to avoid
    // matching /home/user/.bun-custom against /home/user/.bun)
    if (!strings.startsWith(self_exe, install_dir) or
        (self_exe.len > install_dir.len and self_exe[install_dir.len] != '/'))
    {
        Output.prettyErrorln(
            "<r><yellow>warn<r>: This project requires Bun <cyan>{s}<r> but you have <b>v{s}<r>\n" ++
                "      Automatic version switching is only available for bun installed in <b>{s}<r>",
            .{ pinned_version_str, current_str, install_dir },
        );
        return;
    }

    // Non-TTY environments: always warn-only, never mutate the installation
    if (!Output.isStderrTTY()) {
        printMismatchWarning(pinned_version_str, current_str);
        return;
    }

    const target_version_str = resolveTargetVersion(
        &group,
        pinned_version_str,
        arena_alloc,
    ) orelse {
        Output.prettyErrorln(
            "<r><yellow>warn<r>: This project requires Bun <cyan>{s}<r> but you have <b>v{s}<r>\n" ++
                "      Could not resolve a version satisfying the constraint.",
            .{ pinned_version_str, current_str },
        );
        return;
    };

    var versions_dir_buf: bun.PathBuffer = undefined;
    const versions_dir = std.fmt.bufPrint(&versions_dir_buf, "{s}/versions/{s}", .{ install_dir, target_version_str }) catch return;

    var bin_path_buf: bun.PathBuffer = undefined;
    const bin_path = std.fmt.bufPrint(&bin_path_buf, "{s}/bun{s}", .{ versions_dir, exe_suffix }) catch return;

    if (!bun.sys.exists(bin_path)) {
        // Prompt before download
        Output.prettyError(
            "<r>This project requires Bun <cyan>v{s}<r> (constraint: <b>{s}<r>), but you have <b>v{s}<r>\n" ++
                "Download Bun v{s}? <d>[Y/n]<r> ",
            .{ target_version_str, pinned_version_str, current_str, target_version_str },
        );
        Output.flush();

        if (!getUserConfirmation()) {
            Output.prettyErrorln("<r><yellow>warn<r>: Version mismatch — continuing with v{s}", .{current_str});
            return;
        }

        if (!downloadVersion(target_version_str, versions_dir, allocator)) {
            Output.prettyErrorln("<r><red>error<r>: Failed to download Bun v{s}", .{target_version_str});
            return;
        }

        if (!bun.sys.exists(bin_path)) {
            Output.prettyErrorln("<r><red>error<r>: Downloaded binary not found at {s}", .{bin_path});
            return;
        }
    }

    // Save current bun to versions dir if not already there
    if (!saveCurrentVersion(install_dir, current_str, self_exe)) {
        Output.prettyErrorln("<r><red>error<r>: Failed to save current version backup", .{});
        return;
    }

    // Update symlink
    var bun_bin_buf: bun.PathBuffer = undefined;
    const bun_bin = std.fmt.bufPrint(&bun_bin_buf, "{s}/bin/bun{s}", .{ install_dir, exe_suffix }) catch return;

    if (comptime Environment.isWindows) {
        // On Windows, rename the running exe out of the way then copy the new one in
        var outdated_buf: bun.PathBuffer = undefined;
        const outdated_path = std.fmt.bufPrint(&outdated_buf, "{s}.outdated", .{bun_bin}) catch return;
        const outdated_z = bun.default_allocator.dupeZ(u8, outdated_path) catch return;
        defer bun.default_allocator.free(outdated_z);
        const bun_bin_z = bun.default_allocator.dupeZ(u8, bun_bin) catch return;
        defer bun.default_allocator.free(bun_bin_z);
        const bin_path_z = bun.default_allocator.dupeZ(u8, bin_path) catch return;
        defer bun.default_allocator.free(bin_path_z);

        bun.sys.moveFileZ(.cwd(), bun_bin_z, .cwd(), outdated_z) catch {
            Output.prettyErrorln("<r><red>error<r>: Failed to rename current executable", .{});
            return;
        };

        bun.sys.moveFileZ(.cwd(), bin_path_z, .cwd(), bun_bin_z) catch {
            // Restore original
            bun.sys.moveFileZ(.cwd(), outdated_z, .cwd(), bun_bin_z) catch {};
            Output.prettyErrorln("<r><red>error<r>: Failed to install new version", .{});
            return;
        };
    } else {
        updateSymlink(bun_bin, bin_path) catch {
            Output.prettyErrorln("<r><red>error<r>: Failed to update symlink at {s}", .{bun_bin});
            return;
        };
    }

    Output.prettyErrorln("<r><green>Switched to Bun v{s}<r>", .{target_version_str});
    Output.flush();

    reExec(bun_bin);
}

fn printMismatchWarning(pinned_version_str: []const u8, current_str: []const u8) void {
    Output.prettyErrorln(
        "<r><yellow>warn<r>: This project requires Bun <cyan>{s}<r> but you have <b>v{s}<r>",
        .{ pinned_version_str, current_str },
    );
}

fn getUserConfirmation() bool {
    var buf: [256]u8 = undefined;
    const n = bun.sys.read(bun.FD.stdin(), &buf).unwrap() catch return false;
    if (n == 0) return false; // EOF (stdin closed/redirected) = decline
    const response = strings.trim(buf[0..n], " \t\r\n");
    if (response.len == 0) return true; // empty = default yes
    return strings.eqlCaseInsensitiveASCII(response, "y", true) or
        strings.eqlCaseInsensitiveASCII(response, "yes", true);
}

fn getBunInstallDir() ?[]const u8 {
    if (bun.env_var.BUN_INSTALL.get()) |dir| {
        if (dir.len > 0 and bun.sys.exists(dir)) return dir;
    }

    const State = struct {
        var home_bun_path: ?[]const u8 = null;
        var computed: bool = false;
    };

    if (State.computed) return State.home_bun_path;
    State.computed = true;

    if (bun.env_var.HOME.get()) |home| {
        if (home.len > 0) {
            const path = std.fmt.allocPrint(bun.default_allocator, "{s}/.bun", .{home}) catch return null;
            if (bun.sys.exists(path)) {
                State.home_bun_path = path;
                return path;
            }
            bun.default_allocator.free(path);
        }
    }

    return null;
}

fn resolveTargetVersion(
    group: *const Semver.Query.Group,
    pinned_version_str: []const u8,
    allocator: std.mem.Allocator,
) ?[]const u8 {
    if (group.getExactVersion()) |_| {
        // Preserve the original string to keep pre-release suffixes like -canary.1
        return allocator.dupe(u8, pinned_version_str) catch null;
    }

    return queryLatestMatchingRelease(group, pinned_version_str, allocator);
}

fn queryLatestMatchingRelease(
    group: *const Semver.Query.Group,
    pinned_version_str: []const u8,
    allocator: std.mem.Allocator,
) ?[]const u8 {
    HTTP.HTTPThread.init(&.{});

    const env_map = allocator.create(DotEnv.Map) catch return null;
    env_map.* = DotEnv.Map.init(allocator);
    var env_loader = DotEnv.Loader.init(env_map, allocator);
    env_loader.loadProcess() catch return null;

    var github_api_domain: []const u8 = "api.github.com";
    if (env_loader.map.get("GITHUB_API_DOMAIN")) |domain| {
        if (domain.len > 0) github_api_domain = domain;
    }

    var url_buf: [512]u8 = undefined;
    const api_url_str = std.fmt.bufPrint(
        &url_buf,
        "https://{s}/repos/oven-sh/bun/releases?per_page=50",
        .{github_api_domain},
    ) catch return null;

    const api_url = URL.parse(api_url_str);
    const http_proxy: ?URL = env_loader.getHttpProxyFor(api_url);

    var header_entries: Headers.Entry.List = .empty;
    const headers_buf: []const u8 = default_github_headers;
    const accept = Headers.Entry{
        .name = .{ .offset = 0, .length = @intCast("Accept".len) },
        .value = .{ .offset = @intCast("Accept".len), .length = @intCast("application/vnd.github.v3+json".len) },
    };
    header_entries.append(allocator, accept) catch return null;

    var body = MutableString.init(allocator, 32768) catch return null;

    const async_http = allocator.create(HTTP.AsyncHTTP) catch return null;
    async_http.* = HTTP.AsyncHTTP.initSync(
        allocator,
        .GET,
        api_url,
        header_entries,
        headers_buf,
        &body,
        "",
        http_proxy,
        null,
        HTTP.FetchRedirect.follow,
    );
    async_http.client.flags.reject_unauthorized = env_loader.getTLSRejectUnauthorized();

    const response = async_http.sendSync() catch return null;
    if (response.status_code != 200) return null;

    var log = logger.Log.init(allocator);
    defer log.deinit();
    const source = &logger.Source.initPathString("releases.json", body.list.items);

    upgrade_command.initializeStore();
    const expr = JSON.parseUTF8(source, &log, allocator) catch return null;

    var releases = expr.asArray() orelse return null;

    while (releases.next()) |release| {
        const tag_prop = release.asProperty("tag_name") orelse continue;
        const tag = tag_prop.expr.asString(allocator) orelse continue;

        if (!strings.hasPrefixComptime(tag, "bun-v")) continue;
        const ver_str = tag["bun-v".len..];

        const parse_result = Semver.Version.parse(
            Semver.SlicedString.init(ver_str, ver_str),
        );
        if (parse_result.valid) {
            const ver = parse_result.version.min();
            if (group.satisfies(ver, pinned_version_str, ver_str)) {
                return allocator.dupe(u8, ver_str) catch null;
            }
        }
    }

    return null;
}

fn downloadVersion(version_str: []const u8, dest_dir: []const u8, allocator: std.mem.Allocator) bool {
    HTTP.HTTPThread.init(&.{});

    var url_buf: [512]u8 = undefined;
    const download_url_str = std.fmt.bufPrint(
        &url_buf,
        "https://github.com/oven-sh/bun/releases/download/bun-v{s}/{s}",
        .{ version_str, upgrade_command.Version.zip_filename },
    ) catch return false;

    const env_map = allocator.create(DotEnv.Map) catch return false;
    env_map.* = DotEnv.Map.init(allocator);
    var env_loader = DotEnv.Loader.init(env_map, allocator);
    env_loader.loadProcess() catch return false;

    const download_url = URL.parse(download_url_str);
    const http_proxy: ?URL = env_loader.getHttpProxyFor(download_url);

    const zip_buffer = allocator.create(MutableString) catch return false;
    zip_buffer.* = MutableString.init(allocator, 64 * 1024 * 1024) catch return false;

    const async_http = allocator.create(HTTP.AsyncHTTP) catch return false;
    async_http.* = HTTP.AsyncHTTP.initSync(
        allocator,
        .GET,
        download_url,
        .{},
        "",
        zip_buffer,
        "",
        http_proxy,
        null,
        HTTP.FetchRedirect.follow,
    );
    async_http.client.flags.reject_unauthorized = env_loader.getTLSRejectUnauthorized();

    Output.prettyError("<r>Downloading Bun v{s}...", .{version_str});
    Output.flush();

    const response = async_http.sendSync() catch {
        Output.prettyErrorln(" <red>failed<r>", .{});
        return false;
    };

    if (response.status_code != 200) {
        Output.prettyErrorln(" <red>HTTP {d}<r>", .{response.status_code});
        return false;
    }

    const bytes = zip_buffer.slice();
    if (bytes.len == 0) {
        Output.prettyErrorln(" <red>empty response<r>", .{});
        return false;
    }

    Output.prettyErrorln(" <green>done<r> ({d} bytes)", .{bytes.len});

    // Create dest dir
    bun.FD.cwd().makePath(u8, dest_dir) catch {
        Output.prettyErrorln("<r><red>error<r>: Failed to create directory {s}", .{dest_dir});
        return false;
    };

    // Write zip to temp file in dest dir
    const tmpname = "bun-download.zip";
    var zip_path_buf: bun.PathBuffer = undefined;
    const zip_path = std.fmt.bufPrint(&zip_path_buf, "{s}/{s}", .{ dest_dir, tmpname }) catch return false;
    const zip_path_z = allocator.dupeZ(u8, zip_path) catch return false;
    defer allocator.free(zip_path_z);

    const zip_fd = switch (bun.sys.open(zip_path_z, bun.O.WRONLY | bun.O.CREAT | bun.O.TRUNC, 0o644)) {
        .result => |fd| fd,
        .err => {
            Output.prettyErrorln("<r><red>error<r>: Failed to create temp file", .{});
            return false;
        },
    };

    var written: usize = 0;
    while (written < bytes.len) {
        const n = bun.sys.write(zip_fd, bytes[written..]).unwrap() catch {
            zip_fd.close();
            _ = bun.sys.unlink(zip_path_z);
            Output.prettyErrorln("<r><red>error<r>: Failed to write zip file", .{});
            return false;
        };
        written += n;
    }
    zip_fd.close();

    defer _ = bun.sys.unlink(zip_path_z);

    // Open dest dir handle for moveFileZ later
    const dest_dir_fd = switch (bun.sys.openA(dest_dir, bun.O.RDONLY | bun.O.DIRECTORY, 0)) {
        .result => |fd| fd,
        .err => {
            Output.prettyErrorln("<r><red>error<r>: Failed to open directory {s}", .{dest_dir});
            return false;
        },
    };
    defer dest_dir_fd.close();
    // Clean up extracted subfolder on all return paths (including unzip failures)
    defer dest_dir_fd.deleteTree(upgrade_command.Version.folder_name) catch {};

    // Unzip using bun.spawnSync on all platforms
    if (comptime Environment.isPosix) {
        var unzip_buf: bun.PathBuffer = undefined;
        const unzip_exe = bun.which(&unzip_buf, bun.env_var.PATH.get() orelse "", "", "unzip") orelse {
            Output.prettyErrorln("<r><red>error<r>: \"unzip\" not found in PATH", .{});
            return false;
        };

        var unzip_argv = [_][]const u8{
            bun.asByteSlice(unzip_exe),
            "-q",
            "-o",
            tmpname,
        };

        const result = (bun.spawnSync(&.{
            .argv = &unzip_argv,
            .envp = null,
            .cwd = dest_dir,
            .stderr = .inherit,
            .stdout = .inherit,
            .stdin = .inherit,
        }) catch {
            Output.prettyErrorln("<r><red>error<r>: Failed to run unzip", .{});
            return false;
        }).unwrap() catch {
            Output.prettyErrorln("<r><red>error<r>: Failed to run unzip", .{});
            return false;
        };

        if (!result.status.isOK()) {
            switch (result.status) {
                .exited => |e| Output.prettyErrorln("<r><red>error<r>: unzip failed (exit code: {d})", .{e.code}),
                .signaled => |sig| Output.prettyErrorln("<r><red>error<r>: unzip killed by signal {d}", .{@intFromEnum(sig)}),
                else => Output.prettyErrorln("<r><red>error<r>: unzip terminated abnormally", .{}),
            }
            return false;
        }
    } else if (comptime Environment.isWindows) {
        var ps_buf: bun.PathBuffer = undefined;
        const powershell_path =
            bun.which(&ps_buf, bun.env_var.PATH.get() orelse "", "", "powershell") orelse
            hardcoded_system_powershell: {
                const system_root = bun.env_var.SYSTEMROOT.get() orelse "C:\\Windows";
                const hardcoded_path = bun.path.joinAbsStringBuf(system_root, &ps_buf, &.{ system_root, "System32\\WindowsPowerShell\\v1.0\\powershell.exe" }, .windows);
                if (bun.sys.exists(hardcoded_path)) break :hardcoded_system_powershell hardcoded_path;
                Output.prettyErrorln("<r><red>error<r>: PowerShell not found", .{});
                return false;
            };

        const unzip_script = std.fmt.allocPrint(
            allocator,
            "$global:ProgressPreference='SilentlyContinue';Expand-Archive -Path \"{f}\" \"{f}\" -Force",
            .{
                bun.fmt.escapePowershell(tmpname),
                bun.fmt.escapePowershell(dest_dir),
            },
        ) catch return false;
        defer allocator.free(unzip_script);

        var unzip_argv = [_][]const u8{
            powershell_path,
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            unzip_script,
        };

        _ = (bun.spawnSync(&.{
            .argv = &unzip_argv,
            .envp = null,
            .cwd = dest_dir,
            .stderr = .inherit,
            .stdout = .inherit,
            .stdin = .inherit,
            .windows = if (Environment.isWindows) .{
                .loop = bun.jsc.EventLoopHandle.init(bun.jsc.MiniEventLoop.initGlobal(null, null)),
            },
        }) catch return false).unwrap() catch return false;
    }

    // Move extracted binary from subfolder to dest dir root
    const extracted_exe = upgrade_command.Version.folder_name ++ std.fs.path.sep_str ++ "bun" ++ exe_suffix;

    bun.sys.moveFileZ(
        dest_dir_fd,
        extracted_exe,
        dest_dir_fd,
        "bun" ++ exe_suffix,
    ) catch {
        var check_buf: bun.PathBuffer = undefined;
        const check_path = std.fmt.bufPrint(&check_buf, "{s}/bun{s}", .{ dest_dir, exe_suffix }) catch return false;
        if (!bun.sys.exists(check_path)) {
            Output.prettyErrorln("<r><red>error<r>: Failed to move extracted binary", .{});
            return false;
        }
    };

    return true;
}

fn saveCurrentVersion(install_dir: []const u8, current_str: []const u8, self_exe: []const u8) bool {
    var path_buf: bun.PathBuffer = undefined;
    const current_ver_dir = std.fmt.bufPrint(&path_buf, "{s}/versions/{s}", .{ install_dir, current_str }) catch return false;

    var bin_buf: bun.PathBuffer = undefined;
    const current_ver_bin = std.fmt.bufPrint(&bin_buf, "{s}/bun{s}", .{ current_ver_dir, exe_suffix }) catch return false;

    if (bun.sys.exists(current_ver_bin)) return true;

    bun.FD.cwd().makePath(u8, current_ver_dir) catch return false;

    const self_exe_z = bun.default_allocator.dupeZ(u8, self_exe) catch return false;
    defer bun.default_allocator.free(self_exe_z);

    const src_fd = switch (bun.sys.open(self_exe_z, bun.O.RDONLY, 0)) {
        .result => |fd| fd,
        .err => return false,
    };
    defer src_fd.close();

    const current_ver_bin_z = bun.default_allocator.dupeZ(u8, current_ver_bin) catch return false;
    defer bun.default_allocator.free(current_ver_bin_z);

    const dst_fd = switch (bun.sys.open(
        current_ver_bin_z,
        bun.O.WRONLY | bun.O.CREAT | bun.O.TRUNC,
        0o755,
    )) {
        .result => |fd| fd,
        .err => return false,
    };
    defer dst_fd.close();

    var copy_buf: [64 * 1024]u8 = undefined;
    while (true) {
        const n = bun.sys.read(src_fd, &copy_buf).unwrap() catch return false;
        if (n == 0) break;
        var written: usize = 0;
        while (written < n) {
            const w = bun.sys.write(dst_fd, copy_buf[written..n]).unwrap() catch return false;
            written += w;
        }
    }
    return true;
}

fn updateSymlink(link_path: []const u8, target_path: []const u8) !void {
    const link_path_z = bun.default_allocator.dupeZ(u8, link_path) catch return error.OutOfMemory;
    defer bun.default_allocator.free(link_path_z);

    const target_path_z = bun.default_allocator.dupeZ(u8, target_path) catch return error.OutOfMemory;
    defer bun.default_allocator.free(target_path_z);

    _ = bun.sys.unlink(link_path_z);

    switch (bun.sys.symlink(target_path_z, link_path_z)) {
        .result => {},
        .err => return error.SymlinkFailed,
    }
}

fn reExec(exe_path: []const u8) noreturn {
    const allocator = bun.default_allocator;

    Output.Source.Stdio.restore();

    const dupe_argv = allocator.allocSentinel(?[*:0]const u8, bun.argv.len, null) catch
        Global.exit(1);
    for (bun.argv, dupe_argv) |src, *dest| {
        dest.* = (allocator.dupeZ(u8, src) catch Global.exit(1)).ptr;
    }

    const exe_path_z = (allocator.dupeZ(u8, exe_path) catch Global.exit(1)).ptr;
    const newargv = @as([*:null]?[*:0]const u8, @ptrCast(dupe_argv.ptr));

    if (comptime Environment.isPosix) {
        const environ_slice = std.mem.span(std.c.environ);
        const envp = allocator.allocSentinel(?[*:0]const u8, environ_slice.len, null) catch
            Global.exit(1);
        for (environ_slice, envp) |src, *dest| {
            if (src == null) {
                dest.* = null;
            } else {
                dest.* = (allocator.dupeZ(u8, bun.sliceTo(src.?, 0)) catch Global.exit(1)).ptr;
            }
        }
        const envp_ptr = @as([*:null]?[*:0]const u8, @ptrCast(envp.ptr));

        if (comptime Environment.isMac) {
            const spawn = bun.spawn;
            const c = bun.c;
            var actions = spawn.Actions.init() catch Global.exit(1);
            actions.inherit(.stdin()) catch Global.exit(1);
            actions.inherit(.stdout()) catch Global.exit(1);
            actions.inherit(.stderr()) catch Global.exit(1);

            var attrs = spawn.Attr.init() catch Global.exit(1);
            attrs.resetSignals() catch {};
            attrs.set(
                c.POSIX_SPAWN_CLOEXEC_DEFAULT |
                    c.POSIX_SPAWN_SETEXEC |
                    c.POSIX_SPAWN_SETSIGDEF | c.POSIX_SPAWN_SETSIGMASK,
            ) catch Global.exit(1);

            switch (spawn.spawnZ(exe_path_z, actions, attrs, newargv, envp_ptr)) {
                .err => Global.exit(1),
                .result => Global.exit(1),
            }
        } else {
            const err = std.posix.execveZ(exe_path_z, newargv, envp_ptr);
            Output.prettyErrorln("<r><red>error<r>: Failed to exec new bun version: {s}", .{@errorName(err)});
            Global.exit(1);
        }
    } else if (comptime Environment.isWindows) {
        // On Windows, spawn the correct version as a child and exit
        const exe_path_z_win = bun.default_allocator.dupeZ(u8, exe_path) catch Global.exit(1);
        const result = (bun.spawnSync(&.{
            .argv = @as([]const []const u8, bun.argv),
            .argv0 = exe_path_z_win,
            .envp = null,
            .cwd = "",
            .stderr = .inherit,
            .stdout = .inherit,
            .stdin = .inherit,
            .windows = .{
                .loop = bun.jsc.EventLoopHandle.init(bun.jsc.MiniEventLoop.initGlobal(null, null)),
            },
        }) catch Global.exit(1)).unwrap() catch Global.exit(1);
        switch (result.status) {
            .exited => |e| Global.exit(e.code),
            else => Global.exit(1),
        }
    } else {
        Global.exit(1);
    }
}

const default_github_headers: []const u8 = "Acceptapplication/vnd.github.v3+json";

const DotEnv = @import("../env_loader.zig");
const std = @import("std");
const upgrade_command = @import("./upgrade_command.zig");
const URL = @import("../url.zig").URL;

const bun = @import("bun");
const Environment = bun.Environment;
const Global = bun.Global;
const JSON = bun.json;
const MutableString = bun.MutableString;
const Output = bun.Output;
const Semver = bun.Semver;
const exe_suffix = bun.exe_suffix;
const logger = bun.logger;
const strings = bun.strings;

const HTTP = bun.http;
const Headers = HTTP.Headers;
