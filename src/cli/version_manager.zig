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

    // Parse the semver range from bunfig
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

    // Build current version as Semver.Version
    const current = Semver.Version{
        .major = Environment.version.major,
        .minor = Environment.version.minor,
        .patch = Environment.version.patch,
    };

    const current_str = Global.package_json_version;

    // Check if current version satisfies the constraint
    if (group.satisfies(current, pinned_version_str, current_str)) {
        return; // All good
    }

    // Version mismatch — determine if we can auto-install
    const install_dir = getBunInstallDir() orelse {
        Output.prettyErrorln(
            "<r><yellow>warn<r>: This project requires Bun <cyan>{s}<r> but you have <b>v{s}<r>\n" ++
                "      Bun was not installed via the official install script, so automatic version switching is unavailable.\n" ++
                "      Install the required version manually: <b>curl -fsSL https://bun.com/install | bash<r>",
            .{ pinned_version_str, current_str },
        );
        return;
    };

    // Check if self exe path is inside the bun install dir
    const self_exe = bun.selfExePath() catch {
        Output.prettyErrorln(
            "<r><yellow>warn<r>: This project requires Bun <cyan>{s}<r> but you have <b>v{s}<r>",
            .{ pinned_version_str, current_str },
        );
        return;
    };

    if (!strings.startsWith(self_exe, install_dir)) {
        Output.prettyErrorln(
            "<r><yellow>warn<r>: This project requires Bun <cyan>{s}<r> but you have <b>v{s}<r>\n" ++
                "      Automatic version switching is only available for bun installed in <b>{s}<r>",
            .{ pinned_version_str, current_str, install_dir },
        );
        return;
    }

    // Resolve what version to download
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

    // Check if the target version is already cached
    var versions_dir_buf: bun.PathBuffer = undefined;
    const versions_dir = std.fmt.bufPrint(&versions_dir_buf, "{s}/versions/{s}", .{ install_dir, target_version_str }) catch return;

    var bin_path_buf: bun.PathBuffer = undefined;
    const bin_path = std.fmt.bufPrint(&bin_path_buf, "{s}/bun{s}", .{ versions_dir, exe_suffix }) catch return;

    const already_cached = bun.sys.exists(bin_path);

    if (!already_cached) {
        // Need to download — prompt if TTY
        if (Output.isStderrTTY()) {
            Output.prettyError(
                "<r>This project requires Bun <cyan>v{s}<r> (constraint: <b>{s}<r>), but you have <b>v{s}<r>\n" ++
                    "Download Bun v{s}? <d>[Y/n]<r> ",
                .{ target_version_str, pinned_version_str, current_str, target_version_str },
            );
            Output.flush();

            // Read user response
            if (!getUserConfirmation()) {
                Output.prettyErrorln("<r><yellow>warn<r>: Version mismatch — continuing with v{s}", .{current_str});
                return;
            }
        } else {
            // Non-TTY: just warn and continue
            Output.prettyErrorln(
                "<r><yellow>warn<r>: This project requires Bun <cyan>{s}<r> but you have <b>v{s}<r>",
                .{ pinned_version_str, current_str },
            );
            return;
        }

        // Download the version
        if (!downloadVersion(target_version_str, versions_dir, allocator)) {
            Output.prettyErrorln("<r><red>error<r>: Failed to download Bun v{s}", .{target_version_str});
            return;
        }

        // Verify it exists after download
        if (!bun.sys.exists(bin_path)) {
            Output.prettyErrorln("<r><red>error<r>: Downloaded binary not found at {s}", .{bin_path});
            return;
        }
    }

    // Save current bun to versions dir if not already there
    saveCurrentVersion(install_dir, current_str, self_exe);

    // Update symlink: ~/.bun/bin/bun -> versions/<version>/bun
    var bun_bin_buf: bun.PathBuffer = undefined;
    const bun_bin = std.fmt.bufPrint(&bun_bin_buf, "{s}/bin/bun{s}", .{ install_dir, exe_suffix }) catch return;

    updateSymlink(bun_bin, bin_path) catch {
        Output.prettyErrorln("<r><red>error<r>: Failed to update symlink at {s}", .{bun_bin});
        return;
    };

    Output.prettyErrorln("<r><green>Switched to Bun v{s}<r>", .{target_version_str});
    Output.flush();

    // Re-exec via the symlink so the correct version runs
    reExec(bun_bin);
}

fn getUserConfirmation() bool {
    var buf: [16]u8 = undefined;
    const n = std.posix.read(std.posix.STDIN_FILENO, &buf) catch return false;
    if (n == 0) return true; // EOF = default yes
    const response = strings.trim(buf[0..n], " \t\r\n");
    if (response.len == 0) return true; // empty = default yes
    return strings.eqlCaseInsensitiveASCII(response, "y", true) or
        strings.eqlCaseInsensitiveASCII(response, "yes", true);
}

fn getBunInstallDir() ?[]const u8 {
    // Check BUN_INSTALL env var first, then default to ~/.bun
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

/// For exact versions, return directly. For ranges, query GitHub releases.
fn resolveTargetVersion(
    group: *const Semver.Query.Group,
    pinned_version_str: []const u8,
    allocator: std.mem.Allocator,
) ?[]const u8 {
    // Fast path: exact version specified
    if (group.getExactVersion()) |exact| {
        return std.fmt.allocPrint(allocator, "{d}.{d}.{d}", .{
            exact.major, exact.minor, exact.patch,
        }) catch null;
    }

    // For ranges, query GitHub API to find the latest matching release
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

    // Parse the JSON array of releases
    var log = logger.Log.init(allocator);
    defer log.deinit();
    const source = &logger.Source.initPathString("releases.json", body.list.items);

    upgrade_command.initializeStore();
    const expr = JSON.parseUTF8(source, &log, allocator) catch return null;

    var releases = expr.asArray() orelse return null;

    while (releases.next()) |release| {
        const tag_prop = release.asProperty("tag_name") orelse continue;
        const tag = tag_prop.expr.asString(allocator) orelse continue;

        // Tags are like "bun-v1.2.3"
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

    // Construct download URL
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
    bun.makePath(std.fs.cwd(), dest_dir) catch {
        Output.prettyErrorln("<r><red>error<r>: Failed to create directory {s}", .{dest_dir});
        return false;
    };

    // Write zip to temp file in dest dir
    const tmpname = "bun-download.zip";
    var dest_dir_handle = std.fs.cwd().openDir(dest_dir, .{}) catch {
        Output.prettyErrorln("<r><red>error<r>: Failed to open directory {s}", .{dest_dir});
        return false;
    };
    defer dest_dir_handle.close();

    var zip_file = dest_dir_handle.createFile(tmpname, .{ .truncate = true }) catch {
        Output.prettyErrorln("<r><red>error<r>: Failed to create temp file", .{});
        return false;
    };

    _ = zip_file.writeAll(bytes) catch {
        zip_file.close();
        dest_dir_handle.deleteFile(tmpname) catch {};
        Output.prettyErrorln("<r><red>error<r>: Failed to write zip file", .{});
        return false;
    };
    zip_file.close();

    // Unzip
    defer dest_dir_handle.deleteFile(tmpname) catch {};

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

        var unzip_process = std.process.Child.init(&unzip_argv, allocator);
        unzip_process.cwd = dest_dir;
        unzip_process.stdin_behavior = .Inherit;
        unzip_process.stdout_behavior = .Inherit;
        unzip_process.stderr_behavior = .Inherit;

        const result = unzip_process.spawnAndWait() catch {
            Output.prettyErrorln("<r><red>error<r>: Failed to run unzip", .{});
            return false;
        };

        if (result.Exited != 0) {
            Output.prettyErrorln("<r><red>error<r>: unzip failed (exit code: {d})", .{result.Exited});
            return false;
        }
    } else if (comptime Environment.isWindows) {
        var ps_buf: bun.PathBuffer = undefined;
        const powershell_path =
            bun.which(&ps_buf, bun.env_var.PATH.get() orelse "", "", "powershell") orelse {
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

    // The zip extracts to a subfolder like bun-linux-x64/bun
    // Move the binary to the dest dir root
    const extracted_exe = upgrade_command.Version.folder_name ++ std.fs.path.sep_str ++ "bun" ++ exe_suffix;

    bun.sys.moveFileZ(
        .fromStdDir(dest_dir_handle),
        extracted_exe,
        .fromStdDir(dest_dir_handle),
        "bun" ++ exe_suffix,
    ) catch {
        // Check if a binary already ended up in the right place
        var check_buf: bun.PathBuffer = undefined;
        const check_path = std.fmt.bufPrint(&check_buf, "{s}/bun{s}", .{ dest_dir, exe_suffix }) catch return false;
        if (!bun.sys.exists(check_path)) {
            Output.prettyErrorln("<r><red>error<r>: Failed to move extracted binary", .{});
            return false;
        }
    };

    // Clean up extracted subfolder
    dest_dir_handle.deleteTree(upgrade_command.Version.folder_name) catch {};

    return true;
}

fn saveCurrentVersion(install_dir: []const u8, current_str: []const u8, self_exe: []const u8) void {
    // Check if current version is already saved
    var path_buf: bun.PathBuffer = undefined;
    const current_ver_dir = std.fmt.bufPrint(&path_buf, "{s}/versions/{s}", .{ install_dir, current_str }) catch return;

    var bin_buf: bun.PathBuffer = undefined;
    const current_ver_bin = std.fmt.bufPrint(&bin_buf, "{s}/bun{s}", .{ current_ver_dir, exe_suffix }) catch return;

    if (bun.sys.exists(current_ver_bin)) return; // Already saved

    // Create directory and copy current binary
    bun.makePath(std.fs.cwd(), current_ver_dir) catch return;

    // Copy using file operations
    const src_file = std.fs.openFileAbsolute(self_exe, .{}) catch return;
    defer src_file.close();

    const dst_file = std.fs.cwd().createFile(current_ver_bin, .{}) catch return;
    defer dst_file.close();

    var copy_buf: [64 * 1024]u8 = undefined;

    while (true) {
        const n = src_file.read(&copy_buf) catch return;
        if (n == 0) break;
        dst_file.writeAll(copy_buf[0..n]) catch return;
    }

    // Make executable
    if (comptime Environment.isPosix) {
        dst_file.chmod(0o755) catch {};
    }
}

fn updateSymlink(link_path: []const u8, target_path: []const u8) !void {
    const link_path_z = bun.default_allocator.dupeZ(u8, link_path) catch return error.OutOfMemory;
    defer bun.default_allocator.free(link_path_z);

    const target_path_z = bun.default_allocator.dupeZ(u8, target_path) catch return error.OutOfMemory;
    defer bun.default_allocator.free(target_path_z);

    if (comptime Environment.isPosix) {
        // Remove existing file/symlink
        _ = bun.sys.unlink(link_path_z);

        // Create symlink
        switch (bun.sys.symlink(target_path_z, link_path_z)) {
            .result => {},
            .err => return error.SymlinkFailed,
        }
    } else if (comptime Environment.isWindows) {
        // On Windows, copy the file instead of symlink (symlinks require privileges)
        std.fs.copyFileAbsolute(target_path, link_path, .{}) catch {
            return error.CopyFailed;
        };
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
            const c = bun.C;
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
            std.posix.execveZ(exe_path_z, newargv, envp_ptr) catch {};
            Global.exit(1);
        }
    } else {
        // Windows: just exit and let the user re-run
        Global.exit(0);
    }
}

const exe_suffix = bun.exe_suffix;

const default_github_headers: []const u8 = "Acceptapplication/vnd.github.v3+json";

const upgrade_command = @import("upgrade_command.zig");

const std = @import("std");
const bun = @import("bun");
const DotEnv = @import("../env_loader.zig");
const Environment = bun.Environment;
const Global = bun.Global;
const HTTP = bun.http;
const Headers = HTTP.Headers;
const JSON = bun.json;
const logger = bun.logger;
const MutableString = bun.MutableString;
const Output = bun.Output;
const Semver = bun.Semver;
const strings = bun.strings;
const URL = @import("../url.zig").URL;
