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

const lex = bun.js_lexer;
const logger = @import("root").bun.logger;

const options = @import("../options.zig");
const js_parser = bun.js_parser;
const js_ast = bun.JSAst;
const linker = @import("../linker.zig");

const allocators = @import("../allocators.zig");
const sync = @import("../sync.zig");
const Api = @import("../api/schema.zig").Api;
const resolve_path = @import("../resolver/resolve_path.zig");
const configureTransformOptionsForBun = @import("../bun.js/config.zig").configureTransformOptionsForBun;
const Command = @import("../cli.zig").Command;
const bundler = bun.bundler;

const fs = @import("../fs.zig");
const URL = @import("../url.zig").URL;
const HTTP = @import("root").bun.http;
const ParseJSON = @import("../json_parser.zig").ParseJSONUTF8;
const Archive = @import("../libarchive/libarchive.zig").Archive;
const Zlib = @import("../zlib.zig");
const JSPrinter = bun.js_printer;
const DotEnv = @import("../env_loader.zig");
const which = @import("../which.zig").which;
const clap = @import("root").bun.clap;
const Lock = @import("../lock.zig").Lock;
const Headers = @import("root").bun.http.Headers;
const CopyFile = @import("../copy_file.zig");

pub var initialized_store = false;
pub fn initializeStore() void {
    if (initialized_store) return;
    initialized_store = true;
    js_ast.Expr.Data.Store.create(default_allocator);
    js_ast.Stmt.Data.Store.create(default_allocator);
}

pub const Version = struct {
    zip_url: string,
    tag: string,
    buf: MutableString,
    size: u32 = 0,

    pub fn name(this: Version) ?string {
        if (this.tag.len <= "bun-v".len or !strings.hasPrefixComptime(this.tag, "bun-v")) {
            if (strings.eqlComptime(this.tag, "canary")) {
                const Cli = @import("../cli.zig");

                return std.fmt.allocPrint(
                    bun.default_allocator,
                    "bun-canary-timestamp-{any}",
                    .{
                        bun.fmt.hexIntLower(
                            bun.hash(
                                std.mem.asBytes(&Cli.start_time),
                            ),
                        ),
                    },
                ) catch unreachable;
            }
            return this.tag;
        }

        return this.tag["bun-v".len..];
    }

    pub const platform_label = switch (Environment.os) {
        .mac => "darwin",
        .linux => "linux",
        .windows => "windows",
        else => @compileError("Unsupported OS for Bun Upgrade"),
    };

    pub const arch_label = if (Environment.isAarch64) "aarch64" else "x64";
    pub const triplet = platform_label ++ "-" ++ arch_label;
    const suffix = if (Environment.baseline) "-baseline" else "";
    pub const folder_name = "bun-" ++ triplet ++ suffix;
    pub const baseline_folder_name = "bun-" ++ triplet ++ "-baseline";
    pub const zip_filename = folder_name ++ ".zip";
    pub const baseline_zip_filename = baseline_folder_name ++ ".zip";

    pub const profile_folder_name = "bun-" ++ triplet ++ suffix ++ "-profile";
    pub const profile_zip_filename = profile_folder_name ++ ".zip";

    const current_version: string = "bun-v" ++ Global.package_json_version;

    pub export const Bun__githubURL: [*:0]const u8 = std.fmt.comptimePrint("https://github.com/oven-sh/bun/release/bun-v{s}/{s}", .{
        Global.package_json_version,
        zip_filename,
    });

    pub const Bun__githubBaselineURL: [:0]const u8 = std.fmt.comptimePrint("https://github.com/oven-sh/bun/release/bun-v{s}/{s}", .{
        Global.package_json_version,
        baseline_zip_filename,
    });

    pub fn isCurrent(this: Version) bool {
        return strings.eqlComptime(this.tag, current_version);
    }

    comptime {
        _ = Bun__githubURL;
    }
};

pub const UpgradeCheckerThread = struct {
    var update_checker_thread: std.Thread = undefined;
    pub fn spawn(env_loader: *DotEnv.Loader) void {
        if (env_loader.map.get("BUN_DISABLE_UPGRADE_CHECK") != null or
            env_loader.map.get("CI") != null or
            strings.eqlComptime(env_loader.get("BUN_CANARY") orelse "0", "1"))
            return;
        update_checker_thread = std.Thread.spawn(.{}, run, .{env_loader}) catch return;
        update_checker_thread.detach();
    }

    fn _run(env_loader: *DotEnv.Loader) anyerror!void {
        var rand = std.rand.DefaultPrng.init(@as(u64, @intCast(@max(std.time.milliTimestamp(), 0))));
        const delay = rand.random().intRangeAtMost(u64, 100, 10000);
        std.time.sleep(std.time.ns_per_ms * delay);

        Output.Source.configureThread();
        HTTP.HTTPThread.init() catch unreachable;

        defer {
            js_ast.Expr.Data.Store.deinit();
            js_ast.Stmt.Data.Store.deinit();
        }
        var version = (try UpgradeCommand.getLatestVersion(default_allocator, env_loader, undefined, undefined, false, true)) orelse return;

        if (!version.isCurrent()) {
            if (version.name()) |name| {
                Output.prettyErrorln("\n<r><d>Bun v{s} is out. Run <b><cyan>bun upgrade<r> to upgrade.\n", .{name});
                Output.flush();
            }
        }

        version.buf.deinit();
    }

    fn run(env_loader: *DotEnv.Loader) void {
        _run(env_loader) catch |err| {
            if (Environment.isDebug) {
                std.debug.print("\n[UpgradeChecker] ERROR: {s}\n", .{@errorName(err)});
            }
        };
    }
};

pub const UpgradeCommand = struct {
    pub const timeout: u32 = 30000;
    const default_github_headers: string = "Acceptapplication/vnd.github.v3+json";
    var github_repository_url_buf: [bun.MAX_PATH_BYTES]u8 = undefined;
    var current_executable_buf: [bun.MAX_PATH_BYTES]u8 = undefined;
    var unzip_path_buf: [bun.MAX_PATH_BYTES]u8 = undefined;
    var tmpdir_path_buf: [bun.MAX_PATH_BYTES]u8 = undefined;

    pub fn getLatestVersion(
        allocator: std.mem.Allocator,
        env_loader: *DotEnv.Loader,
        refresher: *std.Progress,
        progress: *std.Progress.Node,
        use_profile: bool,
        comptime silent: bool,
    ) !?Version {
        var headers_buf: string = default_github_headers;
        // gonna have to free memory myself like a goddamn caveman due to a thread safety issue with ArenaAllocator
        defer {
            if (comptime silent) {
                if (headers_buf.ptr != default_github_headers.ptr) allocator.free(headers_buf);
            }
        }

        var header_entries: Headers.Entries = .{};
        const accept = Headers.Kv{
            .name = Api.StringPointer{ .offset = 0, .length = @as(u32, @intCast("Accept".len)) },
            .value = Api.StringPointer{ .offset = @as(u32, @intCast("Accept".len)), .length = @as(u32, @intCast("application/vnd.github.v3+json".len)) },
        };
        try header_entries.append(allocator, accept);
        defer if (comptime silent) header_entries.deinit(allocator);

        // Incase they're using a GitHub proxy in e.g. China
        var github_api_domain: string = "api.github.com";
        if (env_loader.map.get("GITHUB_API_DOMAIN")) |api_domain| {
            if (api_domain.len > 0) {
                github_api_domain = api_domain;
            }
        }

        const api_url = URL.parse(
            try std.fmt.bufPrint(
                &github_repository_url_buf,
                "https://{s}/repos/Jarred-Sumner/bun-releases-for-updater/releases/latest",
                .{
                    github_api_domain,
                },
            ),
        );

        if (env_loader.map.get("GITHUB_ACCESS_TOKEN")) |access_token| {
            if (access_token.len > 0) {
                headers_buf = try std.fmt.allocPrint(allocator, default_github_headers ++ "Access-TokenBearer {s}", .{access_token});
                try header_entries.append(
                    allocator,
                    Headers.Kv{
                        .name = Api.StringPointer{
                            .offset = accept.value.length + accept.value.offset,
                            .length = @as(u32, @intCast("Access-Token".len)),
                        },
                        .value = Api.StringPointer{
                            .offset = @as(u32, @intCast(accept.value.length + accept.value.offset + "Access-Token".len)),
                            .length = @as(u32, @intCast(access_token.len)),
                        },
                    },
                );
            }
        }

        const http_proxy: ?URL = env_loader.getHttpProxy(api_url);

        var metadata_body = try MutableString.init(allocator, 2048);

        // ensure very stable memory address
        var async_http: *HTTP.AsyncHTTP = allocator.create(HTTP.AsyncHTTP) catch unreachable;
        async_http.* = HTTP.AsyncHTTP.initSync(
            allocator,
            .GET,
            api_url,
            header_entries,
            headers_buf,
            &metadata_body,
            "",
            60 * std.time.ns_per_min,
            http_proxy,
            null,
            HTTP.FetchRedirect.follow,
        );
        async_http.client.reject_unauthorized = env_loader.getTLSRejectUnauthorized();

        if (!silent) async_http.client.progress_node = progress;
        const response = try async_http.sendSync(true);

        switch (response.status_code) {
            404 => return error.HTTP404,
            403 => return error.HTTPForbidden,
            429 => return error.HTTPTooManyRequests,
            499...599 => return error.GitHubIsDown,
            200 => {},
            else => return error.HTTPError,
        }

        var log = logger.Log.init(allocator);
        defer if (comptime silent) log.deinit();
        var source = logger.Source.initPathString("releases.json", metadata_body.list.items);
        initializeStore();
        var expr = ParseJSON(&source, &log, allocator) catch |err| {
            if (!silent) {
                progress.end();
                refresher.refresh();

                if (log.errors > 0) {
                    if (Output.enable_ansi_colors) {
                        try log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), true);
                    } else {
                        try log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), false);
                    }
                    Global.exit(1);
                } else {
                    Output.prettyErrorln("Error parsing releases from GitHub: <r><red>{s}<r>", .{@errorName(err)});
                    Global.exit(1);
                }
            }

            return null;
        };

        if (log.errors > 0) {
            if (comptime !silent) {
                progress.end();
                refresher.refresh();

                if (Output.enable_ansi_colors) {
                    try log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), true);
                } else {
                    try log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), false);
                }
                Global.exit(1);
            }

            return null;
        }

        var version = Version{ .zip_url = "", .tag = "", .buf = metadata_body, .size = 0 };

        if (expr.data != .e_object) {
            if (comptime !silent) {
                progress.end();
                refresher.refresh();

                const json_type: js_ast.Expr.Tag = @as(js_ast.Expr.Tag, expr.data);
                Output.prettyErrorln("JSON error - expected an object but received {s}", .{@tagName(json_type)});
                Global.exit(1);
            }

            return null;
        }

        if (expr.asProperty("tag_name")) |tag_name_| {
            if (tag_name_.expr.asString(allocator)) |tag_name| {
                version.tag = tag_name;
            }
        }

        if (version.tag.len == 0) {
            if (comptime !silent) {
                progress.end();
                refresher.refresh();

                Output.prettyErrorln("JSON Error parsing releases from GitHub: <r><red>tag_name<r> is missing?\n{s}", .{metadata_body.list.items});
                Global.exit(1);
            }

            return null;
        }

        get_asset: {
            const assets_ = expr.asProperty("assets") orelse break :get_asset;
            var assets = assets_.expr.asArray() orelse break :get_asset;

            while (assets.next()) |asset| {
                if (asset.asProperty("content_type")) |content_type| {
                    const content_type_ = (content_type.expr.asString(allocator)) orelse continue;
                    if (comptime Environment.isDebug) {
                        Output.prettyln("Content-type: {s}", .{content_type_});
                        Output.flush();
                    }

                    if (!strings.eqlComptime(content_type_, "application/zip")) continue;
                }

                if (asset.asProperty("name")) |name_| {
                    if (name_.expr.asString(allocator)) |name| {
                        if (comptime Environment.isDebug) {
                            const filename = if (!use_profile) Version.zip_filename else Version.profile_zip_filename;
                            Output.prettyln("Comparing {s} vs {s}", .{ name, filename });
                            Output.flush();
                        }

                        if (!use_profile and !strings.eqlComptime(name, Version.zip_filename)) continue;
                        if (use_profile and !strings.eqlComptime(name, Version.profile_zip_filename)) continue;

                        version.zip_url = (asset.asProperty("browser_download_url") orelse break :get_asset).expr.asString(allocator) orelse break :get_asset;
                        if (comptime Environment.isDebug) {
                            Output.prettyln("Found Zip {s}", .{version.zip_url});
                            Output.flush();
                        }

                        if (asset.asProperty("size")) |size_| {
                            if (size_.expr.data == .e_number) {
                                version.size = @as(u32, @intCast(@max(@as(i32, @intFromFloat(std.math.ceil(size_.expr.data.e_number.value))), 0)));
                            }
                        }
                        return version;
                    }
                }
            }
        }

        if (comptime !silent) {
            progress.end();
            refresher.refresh();
            if (version.name()) |name| {
                Output.prettyErrorln("Bun v{s} is out, but not for this platform ({s}) yet.", .{
                    name, Version.triplet,
                });
            }

            Global.exit(0);
        }

        return null;
    }

    const exe_suffix = if (Environment.isWindows) ".exe" else "";

    const exe_subpath = Version.folder_name ++ std.fs.path.sep_str ++ "bun" ++ exe_suffix;
    const profile_exe_subpath = Version.profile_folder_name ++ std.fs.path.sep_str ++ "bun-profile" ++ exe_suffix;

    const manual_upgrade_command = switch (Environment.os) {
        .linux, .mac => "curl -fsSL https://bun.sh/install | bash",
        .windows => "powershell -c 'irm bun.sh/install.ps1|iex'",
        else => "(TODO: Install script for " ++ Environment.os.displayString() ++ ")",
    };

    pub fn exec(ctx: Command.Context) !void {
        @setCold(true);

        _exec(ctx) catch |err| {
            Output.prettyErrorln(
                \\<r>Bun upgrade failed with error: <red><b>{s}<r>
                \\
                \\<cyan>Please upgrade manually<r>:
                \\  <b>{s}<r>
                \\
                \\
            , .{ @errorName(err), manual_upgrade_command });
            Global.exit(1);
        };
    }

    fn _exec(ctx: Command.Context) !void {
        try HTTP.HTTPThread.init();

        var filesystem = try fs.FileSystem.init(null);
        var env_loader: DotEnv.Loader = brk: {
            const map = try ctx.allocator.create(DotEnv.Map);
            map.* = DotEnv.Map.init(ctx.allocator);

            break :brk DotEnv.Loader.init(map, ctx.allocator);
        };
        env_loader.loadProcess();

        var version: Version = undefined;

        const use_canary = brk: {
            const default_use_canary = Environment.is_canary;

            if (default_use_canary and strings.containsAny(bun.argv(), "--stable"))
                break :brk false;

            break :brk strings.eqlComptime(env_loader.map.get("BUN_CANARY") orelse "0", "1") or
                strings.containsAny(bun.argv(), "--canary") or default_use_canary;
        };

        const use_profile = strings.containsAny(bun.argv(), "--profile");

        if (!use_canary) {
            var refresher = std.Progress{};
            var progress = refresher.start("Fetching version tags", 0);

            version = (try getLatestVersion(ctx.allocator, &env_loader, &refresher, progress, use_profile, false)) orelse return;

            progress.end();
            refresher.refresh();

            if (!Environment.is_canary) {
                if (version.name() != null and version.isCurrent()) {
                    Output.prettyErrorln(
                        "<r><green>Congrats!<r> You're already on the latest version of Bun <d>(which is v{s})<r>",
                        .{
                            version.name().?,
                        },
                    );
                    Global.exit(0);
                }
            }

            if (version.name() == null) {
                Output.prettyErrorln(
                    "<r><red>error:<r> Bun versions are currently unavailable (the latest version name didn't match the expeccted format)",
                    .{},
                );
                Global.exit(1);
            }

            if (!Environment.is_canary) {
                Output.prettyErrorln("<r><b>Bun <cyan>v{s}<r> is out<r>! You're on <blue>{s}<r>\n", .{ version.name().?, Global.package_json_version });
            } else {
                Output.prettyErrorln("<r><b>Downgrading from Bun <blue>{s}-canary<r> to Bun <cyan>v{s}<r><r>\n", .{ Global.package_json_version, version.name().? });
            }
            Output.flush();
        } else {
            version = Version{
                .tag = "canary",
                .zip_url = "https://github.com/oven-sh/bun/releases/download/canary/" ++ Version.zip_filename,
                .size = 0,
                .buf = MutableString.initEmpty(bun.default_allocator),
            };
        }

        const zip_url = URL.parse(version.zip_url);
        const http_proxy: ?URL = env_loader.getHttpProxy(zip_url);

        {
            var refresher = std.Progress{};
            var progress = refresher.start("Downloading", version.size);
            refresher.refresh();
            var async_http = ctx.allocator.create(HTTP.AsyncHTTP) catch unreachable;
            var zip_file_buffer = try ctx.allocator.create(MutableString);
            zip_file_buffer.* = try MutableString.init(ctx.allocator, @max(version.size, 1024));

            async_http.* = HTTP.AsyncHTTP.initSync(
                ctx.allocator,
                .GET,
                zip_url,
                .{},
                "",
                zip_file_buffer,
                "",
                timeout,
                http_proxy,
                null,
                HTTP.FetchRedirect.follow,
            );
            async_http.client.timeout = timeout;
            async_http.client.progress_node = progress;
            async_http.client.reject_unauthorized = env_loader.getTLSRejectUnauthorized();

            const response = try async_http.sendSync(true);

            switch (response.status_code) {
                404 => {
                    if (use_canary) {
                        Output.prettyErrorln(
                            \\<r><red>error:<r> Canary builds are not available for this platform yet
                            \\
                            \\   Release: <cyan>https://github.com/oven-sh/bun/releases/tag/canary<r>
                            \\  Filename: <b>{s}<r>
                            \\
                        , .{
                            Version.zip_filename,
                        });
                        Global.exit(1);
                    }

                    return error.HTTP404;
                },
                403 => return error.HTTPForbidden,
                429 => return error.HTTPTooManyRequests,
                499...599 => return error.GitHubIsDown,
                200 => {},
                else => return error.HTTPError,
            }

            const bytes = zip_file_buffer.toOwnedSliceLeaky();

            progress.end();
            refresher.refresh();

            if (bytes.len == 0) {
                Output.prettyErrorln("<r><red>error:<r> Failed to download the latest version of Bun. Received empty content", .{});
                Global.exit(1);
            }

            const version_name = version.name().?;

            var save_dir_ = filesystem.tmpdir();
            const save_dir_it = save_dir_.makeOpenPath(version_name, .{}) catch {
                Output.prettyErrorln("<r><red>error:<r> Failed to open temporary directory", .{});
                Global.exit(1);
            };
            const save_dir = save_dir_it;
            const tmpdir_path = bun.getFdPath(save_dir.fd, &tmpdir_path_buf) catch {
                Output.prettyErrorln("<r><red>error:<r> Failed to read temporary directory", .{});
                Global.exit(1);
            };

            tmpdir_path_buf[tmpdir_path.len] = 0;
            const tmpdir_z = tmpdir_path_buf[0..tmpdir_path.len :0];
            _ = bun.sys.chdir(tmpdir_z);

            const tmpname = "bun.zip";
            const exe =
                if (use_profile) profile_exe_subpath else exe_subpath;

            var zip_file = save_dir.createFileZ(tmpname, .{ .truncate = true }) catch |err| {
                Output.prettyErrorln("<r><red>error:<r> Failed to open temp file {s}", .{@errorName(err)});
                Global.exit(1);
            };

            {
                _ = zip_file.writeAll(bytes) catch |err| {
                    save_dir.deleteFileZ(tmpname) catch {};
                    Output.prettyErrorln("<r><red>error:<r> Failed to write to temp file {s}", .{@errorName(err)});
                    Global.exit(1);
                };
                zip_file.close();
            }

            {
                defer {
                    save_dir.deleteFileZ(tmpname) catch {};
                }

                if (comptime Environment.isPosix) {
                    const unzip_exe = which(&unzip_path_buf, env_loader.map.get("PATH") orelse "", filesystem.top_level_dir, "unzip") orelse {
                        save_dir.deleteFileZ(tmpname) catch {};
                        Output.prettyErrorln("<r><red>error:<r> Failed to locate \"unzip\" in PATH. bun upgrade needs \"unzip\" to work.", .{});
                        Global.exit(1);
                    };

                    // We could just embed libz2
                    // however, we want to be sure that xattrs are preserved
                    // xattrs are used for codesigning
                    // it'd be easy to mess that up
                    var unzip_argv = [_]string{
                        bun.asByteSlice(unzip_exe),
                        "-q",
                        "-o",
                        tmpname,
                    };

                    var unzip_process = std.ChildProcess.init(&unzip_argv, ctx.allocator);
                    unzip_process.cwd = tmpdir_path;
                    unzip_process.stdin_behavior = .Inherit;
                    unzip_process.stdout_behavior = .Inherit;
                    unzip_process.stderr_behavior = .Inherit;

                    const unzip_result = unzip_process.spawnAndWait() catch |err| {
                        save_dir.deleteFileZ(tmpname) catch {};
                        Output.prettyErrorln("<r><red>error:<r> Failed to spawn unzip due to {s}.", .{@errorName(err)});
                        Global.exit(1);
                    };

                    if (unzip_result.Exited != 0) {
                        Output.prettyErrorln("<r><red>Unzip failed<r> (exit code: {d})", .{unzip_result.Exited});
                        save_dir.deleteFileZ(tmpname) catch {};
                        Global.exit(1);
                    }
                } else if (Environment.isWindows) {
                    // Run a powershell script to unzip the file
                    const unzip_script = try std.fmt.allocPrint(
                        ctx.allocator,
                        "$global:ProgressPreference='SilentlyContinue';Expand-Archive -Path {s} {s} -Force",
                        .{
                            tmpname,
                            tmpdir_path,
                        },
                    );

                    var unzip_argv = [_]string{
                        "powershell.exe",
                        "-NoProfile",
                        "-ExecutionPolicy",
                        "Bypass",
                        "-Command",
                        unzip_script,
                    };

                    var unzip_process = std.ChildProcess.init(&unzip_argv, ctx.allocator);

                    unzip_process.cwd = tmpdir_path;
                    unzip_process.stdin_behavior = .Inherit;
                    unzip_process.stdout_behavior = .Inherit;
                    unzip_process.stderr_behavior = .Inherit;

                    const unzip_result = unzip_process.spawnAndWait() catch |err| {
                        save_dir.deleteFileZ(tmpname) catch {};
                        Output.prettyErrorln("<r><red>error:<r> Failed to spawn unzip due to {s}.", .{@errorName(err)});
                        Global.exit(1);
                    };

                    if (unzip_result.Exited != 0) {
                        Output.prettyErrorln("<r><red>Unzip failed<r> (exit code: {d})", .{unzip_result.Exited});
                        save_dir.deleteFileZ(tmpname) catch {};
                        Global.exit(1);
                    }
                }
            }
            {
                var verify_argv = [_]string{
                    exe,
                    "--version",
                };

                const result = std.ChildProcess.run(.{
                    .allocator = ctx.allocator,
                    .argv = &verify_argv,
                    .cwd = tmpdir_path,
                    .max_output_bytes = 512,
                }) catch |err| {
                    defer save_dir_.deleteTree(version_name) catch {};

                    if (err == error.FileNotFound) {
                        if (std.fs.cwd().access(exe, .{})) {
                            // On systems like NixOS, the FileNotFound is actually the system-wide linker,
                            // as they do not have one (most systems have it at a known path). This is how
                            // ChildProcess returns FileNotFound despite the actual
                            //
                            // In these cases, prebuilt binaries from GitHub will never work without
                            // extra patching, so we will print a message deferring them to their system
                            // package manager.
                            Output.prettyErrorln(
                                \\<r><red>error<r><d>:<r> 'bun upgrade' is unsupported on systems without ld
                                \\
                                \\You are likely on an immutable system such as NixOS, where dynamic
                                \\libraries are stored in a global cache.
                                \\
                                \\Please use your system's package manager to properly upgrade bun.
                                \\
                            , .{});
                            Global.exit(1);
                            return;
                        } else |_| {}
                    }

                    Output.prettyErrorln("<r><red>error<r><d>:<r> Failed to verify Bun (code: {s})<r>)", .{@errorName(err)});
                    Global.exit(1);
                };

                if (result.term.Exited != 0) {
                    save_dir_.deleteTree(version_name) catch {};
                    Output.prettyErrorln("<r><red>error<r><d>:<r> failed to verify Bun<r> (exit code: {d})", .{result.term.Exited});
                    Global.exit(1);
                }

                // It should run successfully
                // but we don't care about the version number if we're doing a canary build
                if (!use_canary) {
                    var version_string = result.stdout;
                    if (strings.indexOfChar(version_string, ' ')) |i| {
                        version_string = version_string[0..i];
                    }

                    if (!strings.eql(std.mem.trim(u8, version_string, " \n\r\t"), version_name)) {
                        save_dir_.deleteTree(version_name) catch {};

                        Output.prettyErrorln(
                            "<r><red>error<r>: The downloaded version of Bun (<red>{s}<r>) doesn't match the expected version (<b>{s}<r>)<r>. Cancelled upgrade",
                            .{
                                version_string[0..@min(version_string.len, 512)],
                                version_name,
                            },
                        );
                        Global.exit(1);
                    }
                }
            }

            const destination_executable_ = std.fs.selfExePath(&current_executable_buf) catch return error.UpgradeFailedMissingExecutable;
            current_executable_buf[destination_executable_.len] = 0;

            const target_filename_ = std.fs.path.basename(destination_executable_);
            const target_filename = current_executable_buf[destination_executable_.len - target_filename_.len ..][0..target_filename_.len :0];
            const target_dir_ = std.fs.path.dirname(destination_executable_) orelse return error.UpgradeFailedBecauseOfMissingExecutableDir;
            // safe because the slash will no longer be in use
            current_executable_buf[target_dir_.len] = 0;
            const target_dirname = current_executable_buf[0..target_dir_.len :0];
            const target_dir_it = std.fs.openDirAbsoluteZ(target_dirname, .{}) catch |err| {
                save_dir_.deleteTree(version_name) catch {};
                Output.prettyErrorln("<r><red>error:<r> Failed to open Bun's install directory {s}", .{@errorName(err)});
                Global.exit(1);
            };
            var target_dir = target_dir_it;

            if (use_canary) {

                // Check if the versions are the same
                const target_stat = target_dir.statFile(target_filename) catch |err| {
                    save_dir_.deleteTree(version_name) catch {};
                    Output.prettyErrorln("<r><red>error:<r> {s} while trying to stat target {s} ", .{ @errorName(err), target_filename });
                    Global.exit(1);
                };

                const dest_stat = save_dir.statFile(exe) catch |err| {
                    save_dir_.deleteTree(version_name) catch {};
                    Output.prettyErrorln("<r><red>error:<r> {s} while trying to stat source {s}", .{ @errorName(err), exe });
                    Global.exit(1);
                };

                if (target_stat.size == dest_stat.size and target_stat.size > 0) {
                    const input_buf = try ctx.allocator.alloc(u8, target_stat.size);

                    const target_hash = bun.hash(target_dir.readFile(target_filename, input_buf) catch |err| {
                        save_dir_.deleteTree(version_name) catch {};
                        Output.prettyErrorln("<r><red>error:<r> Failed to read target bun {s}", .{@errorName(err)});
                        Global.exit(1);
                    });

                    const source_hash = bun.hash(save_dir.readFile(exe, input_buf) catch |err| {
                        save_dir_.deleteTree(version_name) catch {};
                        Output.prettyErrorln("<r><red>error:<r> Failed to read source bun {s}", .{@errorName(err)});
                        Global.exit(1);
                    });

                    if (target_hash == source_hash) {
                        save_dir_.deleteTree(version_name) catch {};
                        Output.prettyErrorln(
                            \\<r><green>Congrats!<r> You're already on the latest <b>canary<r><green> build of Bun
                            \\
                            \\To downgrade to the latest stable release, run <b><cyan>bun upgrade --stable<r>
                            \\
                        ,
                            .{},
                        );
                        Global.exit(0);
                    }
                }
            }

            var outdated_filename: if (Environment.isWindows) ?stringZ else ?void = null;

            if (env_loader.map.get("BUN_DRY_RUN") == null) {
                if (comptime Environment.isWindows) {
                    // On Windows, we cannot replace the running executable directly.
                    // we rename the old executable to a temporary name, and then move the new executable to the old name.
                    // This is because Windows locks the executable while it's running.
                    current_executable_buf[target_dir_.len] = '\\';
                    outdated_filename = try std.fmt.allocPrintZ(ctx.allocator, "{s}\\{s}.outdated", .{
                        target_dirname,
                        target_filename,
                    });
                    std.os.rename(destination_executable_, outdated_filename.?) catch |err| {
                        save_dir_.deleteTree(version_name) catch {};
                        Output.prettyErrorln("<r><red>error:<r> Failed to rename current executable {s}", .{@errorName(err)});
                        Global.exit(1);
                    };
                    current_executable_buf[target_dir_.len] = 0;
                }

                C.moveFileZ(bun.toFD(save_dir.fd), exe, bun.toFD(target_dir.fd), target_filename) catch |err| {
                    defer save_dir_.deleteTree(version_name) catch {};

                    if (comptime Environment.isWindows) {
                        // Attempt to restore the old executable. If this fails, the user will be left without a working copy of bun.
                        std.os.rename(outdated_filename.?, destination_executable_) catch {
                            Output.errGeneric(
                                \\Failed to move new version of Bun due to {s}
                            ,
                                .{@errorName(err)},
                            );
                            Output.errGeneric(
                                \\Failed to restore the working copy of Bun. The installation is now corrupt.
                                \\
                                \\Please reinstall Bun manually with the following command:
                                \\   {s}
                                \\
                            ,
                                .{manual_upgrade_command},
                            );
                            Global.exit(1);
                        };
                    }

                    Output.errGeneric(
                        \\Failed to move new version of Bun due to {s}
                        \\
                        \\Please reinstall Bun manually with the following command:
                        \\   {s}
                        \\
                    ,
                        .{ @errorName(err), manual_upgrade_command },
                    );
                    Global.exit(1);
                };
            }

            // Ensure completions are up to date.
            {
                var completions_argv = [_]string{
                    target_filename,
                    "completions",
                };

                env_loader.map.put("IS_BUN_AUTO_UPDATE", "true") catch unreachable;
                var buf_map = try env_loader.map.cloneToEnvMap(ctx.allocator);
                _ = std.ChildProcess.run(.{
                    .allocator = ctx.allocator,
                    .argv = &completions_argv,
                    .cwd = target_dirname,
                    .max_output_bytes = 4096,
                    .env_map = &buf_map,
                }) catch undefined;
            }

            Output.printStartEnd(ctx.start_time, std.time.nanoTimestamp());

            if (use_canary) {
                Output.prettyErrorln(
                    \\<r> Upgraded.
                    \\
                    \\<b><green>Welcome to Bun's latest canary build!<r>
                    \\
                    \\Report any bugs:
                    \\
                    \\    https://github.com/oven-sh/bun/issues
                    \\
                    \\Changelog:
                    \\
                    \\    https://github.com/oven-sh/bun/compare/{s}...main
                    \\
                ,
                    .{Environment.git_sha},
                );
            } else {
                const bun_v = "bun-v" ++ Global.package_json_version;

                Output.prettyErrorln(
                    \\<r> Upgraded.
                    \\
                    \\<b><green>Welcome to Bun v{s}!<r>
                    \\
                    \\Report any bugs:
                    \\
                    \\    https://github.com/oven-sh/bun/issues
                    \\
                    \\What's new:
                    \\
                    \\    <cyan>https://github.com/oven-sh/bun/releases/tag/{s}<r>
                    \\
                    \\Changelog:
                    \\
                    \\    https://github.com/oven-sh/bun/compare/{s}...{s}
                    \\
                ,
                    .{ version_name, version.tag, bun_v, version.tag },
                );
            }

            Output.flush();

            if (Environment.isWindows) {
                if (outdated_filename) |to_remove| {
                    current_executable_buf[target_dir_.len] = '\\';
                    const delete_old_script = try std.fmt.allocPrint(
                        ctx.allocator,
                        // What is this?
                        // 1. spawns powershell
                        // 2. waits for all processes with the same path as the current executable to exit (including the current process)
                        // 3. deletes the old executable
                        //
                        // probably possible to hit a race condition, but i think the worst case is simply the file not getting deleted.
                        //
                        // in that edge case, the next time you upgrade it will simply override itself, fixing the bug.
                        //
                        // -NoNewWindow doesnt work, will keep the parent alive it seems
                        // -WindowStyle Hidden seems to just do nothing, not sure why.
                        // Using -WindowStyle Minimized seems to work, but you can spot a powershell icon appear in your taskbar for about ~1 second
                        //
                        // Alternative: we could simply do nothing and leave the `.outdated` file.
                        \\Start-Process powershell.exe -WindowStyle Minimized -ArgumentList "-NoProfile","-ExecutionPolicy","Bypass","-Command",'&{{$ErrorActionPreference=''SilentlyContinue''; Get-Process|Where-Object{{ $_.Path -eq ''{s}'' }}|Wait-Process; Remove-Item -Path ''{s}'' -Force }};'; exit
                    ,
                        .{
                            destination_executable_,
                            to_remove,
                        },
                    );

                    var delete_argv = [_]string{
                        "powershell.exe",
                        "-NoProfile",
                        "-ExecutionPolicy",
                        "Bypass",
                        "-Command",
                        delete_old_script,
                    };

                    _ = std.ChildProcess.run(.{
                        .allocator = ctx.allocator,
                        .argv = &delete_argv,
                        .cwd = tmpdir_path,
                        .max_output_bytes = 512,
                    }) catch {};
                }
            }
        }
    }
};
