const _global = @import("../global.zig");
const string = _global.string;
const Output = _global.Output;
const Global = _global.Global;
const Environment = _global.Environment;
const strings = _global.strings;
const MutableString = _global.MutableString;
const stringZ = _global.stringZ;
const default_allocator = _global.default_allocator;
const C = _global.C;
const std = @import("std");

const lex = @import("../js_lexer.zig");
const logger = @import("../logger.zig");

const options = @import("../options.zig");
const js_parser = @import("../js_parser.zig");
const js_ast = @import("../js_ast.zig");
const linker = @import("../linker.zig");
const panicky = @import("../panic_handler.zig");
const allocators = @import("../allocators.zig");
const sync = @import("../sync.zig");
const Api = @import("../api/schema.zig").Api;
const resolve_path = @import("../resolver/resolve_path.zig");
const configureTransformOptionsForBun = @import("../javascript/jsc/config.zig").configureTransformOptionsForBun;
const Command = @import("../cli.zig").Command;
const bundler = @import("../bundler.zig");
const NodeModuleBundle = @import("../node_module_bundle.zig").NodeModuleBundle;
const fs = @import("../fs.zig");
const URL = @import("../query_string_map.zig").URL;
const HTTP = @import("http");
const ParseJSON = @import("../json_parser.zig").ParseJSON;
const Archive = @import("../libarchive/libarchive.zig").Archive;
const Zlib = @import("../zlib.zig");
const JSPrinter = @import("../js_printer.zig");
const DotEnv = @import("../env_loader.zig");
const which = @import("../which.zig").which;
const clap = @import("clap");
const Lock = @import("../lock.zig").Lock;
const Headers = @import("http").Headers;
const CopyFile = @import("../copy_file.zig");
const NetworkThread = HTTP.NetworkThread;

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
        if (this.tag.len > "bun-v".len and strings.eqlComptime(this.tag[0.."bun-v".len], "bun-v")) {
            return this.tag[("bun-v".len)..];
        } else {
            return null;
        }
    }

    pub const platform_label = if (Environment.isMac) "darwin" else "linux";
    pub const arch_label = if (Environment.isAarch64) "aarch64" else "x64";
    pub const triplet = platform_label ++ "-" ++ arch_label;
    pub const folder_name = "bun-" ++ triplet;
    pub const zip_filename = folder_name ++ ".zip";

    const current_version: string = "bun-v" ++ Global.package_json_version;

    pub fn isCurrent(this: Version) bool {
        return strings.eqlComptime(this.tag, current_version);
    }
};

pub const UpgradeCheckerThread = struct {
    var update_checker_thread: std.Thread = undefined;
    pub fn spawn(env_loader: *DotEnv.Loader) void {
        if (env_loader.map.get("BUN_DISABLE_UPGRADE_CHECK") != null or env_loader.map.get("CI") != null) return;
        update_checker_thread = std.Thread.spawn(.{}, run, .{env_loader}) catch return;
        update_checker_thread.detach();
    }

    fn _run(env_loader: *DotEnv.Loader) anyerror!void {
        var rand = std.rand.DefaultPrng.init(@intCast(u64, @maximum(std.time.milliTimestamp(), 0)));
        const delay = rand.random().intRangeAtMost(u64, 100, 10000);
        std.time.sleep(std.time.ns_per_ms * delay);

        Output.Source.configureThread();
        NetworkThread.init() catch unreachable;

        const version = (try UpgradeCommand.getLatestVersion(default_allocator, env_loader, undefined, undefined, true)) orelse return;

        if (!version.isCurrent()) {
            if (version.name()) |name| {
                Output.prettyErrorln("\n<r><d>Bun v{s} is out. Run <b><cyan>bun upgrade<r> to upgrade.\n", .{name});
                Output.flush();
            }
        }
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
    const default_github_headers = "Acceptapplication/vnd.github.v3+json";
    var github_repository_url_buf: [std.fs.MAX_PATH_BYTES]u8 = undefined;
    var current_executable_buf: [std.fs.MAX_PATH_BYTES]u8 = undefined;
    var unzip_path_buf: [std.fs.MAX_PATH_BYTES]u8 = undefined;
    var tmpdir_path_buf: [std.fs.MAX_PATH_BYTES]u8 = undefined;

    pub fn getLatestVersion(
        allocator: std.mem.Allocator,
        env_loader: *DotEnv.Loader,
        refresher: *std.Progress,
        progress: *std.Progress.Node,
        comptime silent: bool,
    ) !?Version {
        var headers_buf: string = default_github_headers;

        var header_entries: Headers.Entries = .{};
        const accept = Headers.Kv{
            .name = Api.StringPointer{ .offset = 0, .length = @intCast(u32, "Accept".len) },
            .value = Api.StringPointer{ .offset = @intCast(u32, "Accept".len), .length = @intCast(u32, "application/vnd.github.v3+json".len) },
        };
        try header_entries.append(allocator, accept);

        // Incase they're using a GitHub proxy in e.g. China
        var github_api_domain: string = "api.github.com";
        if (env_loader.map.get("GITHUB_API_DOMAIN")) |api_domain| {
            if (api_domain.len > 0) {
                github_api_domain = api_domain;
            }
        }

        var api_url = URL.parse(
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
                            .length = @intCast(u32, "Access-Token".len),
                        },
                        .value = Api.StringPointer{
                            .offset = @intCast(u32, accept.value.length + accept.value.offset + "Access-Token".len),
                            .length = @intCast(u32, access_token.len),
                        },
                    },
                );
            }
        }

        var metadata_body = try MutableString.init(allocator, 2048);
        var request_body = try MutableString.init(allocator, 0);

        // ensure very stable memory address
        var async_http: *HTTP.AsyncHTTP = allocator.create(HTTP.AsyncHTTP) catch unreachable;
        async_http.* = try HTTP.AsyncHTTP.init(allocator, .GET, api_url, header_entries, headers_buf, &metadata_body, &request_body, 60 * std.time.ns_per_min);
        if (!silent) async_http.client.progress_node = progress;
        const response = try async_http.sendSync();

        switch (response.status_code) {
            404 => return error.HTTP404,
            403 => return error.HTTPForbidden,
            429 => return error.HTTPTooManyRequests,
            499...599 => return error.GitHubIsDown,
            200 => {},
            else => return error.HTTPError,
        }

        var log = logger.Log.init(allocator);
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
                    Output.flush();
                    std.os.exit(1);
                } else {
                    Output.prettyErrorln("Error parsing releases from GitHub: <r><red>{s}<r>", .{@errorName(err)});
                    Output.flush();
                    std.os.exit(1);
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
                Output.flush();
                std.os.exit(1);
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
                Output.flush();
                std.os.exit(1);
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
                Output.flush();
                std.os.exit(1);
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
                            Output.prettyln("Comparing {s} vs {s}", .{ name, Version.zip_filename });
                            Output.flush();
                        }
                        if (strings.eqlComptime(name, Version.zip_filename)) {
                            version.zip_url = (asset.asProperty("browser_download_url") orelse break :get_asset).expr.asString(allocator) orelse break :get_asset;
                            if (comptime Environment.isDebug) {
                                Output.prettyln("Found Zip {s}", .{version.zip_url});
                                Output.flush();
                            }

                            if (asset.asProperty("size")) |size_| {
                                if (size_.expr.data == .e_number) {
                                    version.size = @intCast(u32, @maximum(@floatToInt(i32, std.math.ceil(size_.expr.data.e_number.value)), 0));
                                }
                            }
                            return version;
                        }
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

            Output.flush();
            std.os.exit(0);
        }

        version.buf.deinit();

        return null;
    }
    const exe_subpath = Version.folder_name ++ std.fs.path.sep_str ++ "bun";

    pub fn exec(ctx: Command.Context) !void {
        try NetworkThread.init();

        var filesystem = try fs.FileSystem.init1(ctx.allocator, null);
        var env_loader: DotEnv.Loader = brk: {
            var map = try ctx.allocator.create(DotEnv.Map);
            map.* = DotEnv.Map.init(ctx.allocator);

            break :brk DotEnv.Loader.init(map, ctx.allocator);
        };

        env_loader.loadProcess();

        var version: Version = undefined;

        {
            var refresher = std.Progress{};
            var progress = try refresher.start("Fetching version tags", 0);

            version = (try getLatestVersion(ctx.allocator, &env_loader, &refresher, progress, false)) orelse return;

            progress.end();
            refresher.refresh();

            if (version.name() != null and version.isCurrent()) {
                Output.prettyErrorln(
                    "<r><green>Congrats!<r> You're already on the latest version of Bun <d>(which is v{s})<r>",
                    .{
                        version.name().?,
                    },
                );
                Output.flush();
                std.os.exit(0);
            }

            if (version.name() == null) {
                Output.prettyErrorln(
                    "<r><red>error:<r> Bun versions are currently unavailable (the latest version name didn't match the expeccted format)",
                    .{},
                );
                Output.flush();
                std.os.exit(1);
            }
        }

        {
            Output.prettyErrorln("<r><b>Bun <cyan>v{s}<r> is out<r>! You're on <blue>{s}<r>\n", .{ version.name().?, Global.package_json_version });
            Output.flush();

            var refresher = std.Progress{};
            var progress = try refresher.start("Downloading", version.size);
            refresher.refresh();
            var async_http = ctx.allocator.create(HTTP.AsyncHTTP) catch unreachable;
            var zip_file_buffer = try ctx.allocator.create(MutableString);
            zip_file_buffer.* = try MutableString.init(ctx.allocator, @maximum(version.size, 1024));
            var request_buffer = try MutableString.init(ctx.allocator, 0);

            async_http.* = try HTTP.AsyncHTTP.init(
                ctx.allocator,
                .GET,
                URL.parse(version.zip_url),
                .{},
                "",
                zip_file_buffer,
                &request_buffer,
                timeout,
            );
            async_http.client.timeout = timeout;
            async_http.client.progress_node = progress;
            const response = try async_http.sendSync();

            switch (response.status_code) {
                404 => return error.HTTP404,
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
                Output.flush();
                std.os.exit(1);
            }

            const version_name = version.name().?;

            var save_dir_ = filesystem.tmpdir();
            var save_dir = save_dir_.makeOpenPath(version_name, .{ .iterate = true }) catch {
                Output.prettyErrorln("<r><red>error:<r> Failed to open temporary directory", .{});
                Output.flush();
                std.os.exit(1);
            };
            var tmpdir_path = std.os.getFdPath(save_dir.fd, &tmpdir_path_buf) catch {
                Output.prettyErrorln("<r><red>error:<r> Failed to read temporary directory", .{});
                Output.flush();
                std.os.exit(1);
            };

            tmpdir_path_buf[tmpdir_path.len] = 0;
            var tmpdir_z = tmpdir_path_buf[0..tmpdir_path.len :0];
            std.os.chdirZ(tmpdir_z) catch {};

            const tmpname = "bun.zip";

            var zip_file = save_dir.createFileZ(tmpname, .{ .truncate = true }) catch |err| {
                Output.prettyErrorln("<r><red>error:<r> Failed to open temp file {s}", .{@errorName(err)});
                Output.flush();
                std.os.exit(1);
            };

            {
                _ = zip_file.writeAll(bytes) catch |err| {
                    save_dir.deleteFileZ(tmpname) catch {};
                    Output.prettyErrorln("<r><red>error:<r> Failed to write to temp file {s}", .{@errorName(err)});
                    Output.flush();
                    std.os.exit(1);
                };
                zip_file.close();
            }

            {
                defer {
                    save_dir.deleteFileZ(tmpname) catch {};
                }

                const unzip_exe = which(&unzip_path_buf, env_loader.map.get("PATH") orelse "", filesystem.top_level_dir, "unzip") orelse {
                    save_dir.deleteFileZ(tmpname) catch {};
                    Output.prettyErrorln("<r><red>error:<r> Failed to locate \"unzip\" in PATH. bun upgrade needs \"unzip\" to work.", .{});
                    Output.flush();
                    std.os.exit(1);
                };

                // We could just embed libz2
                // however, we want to be sure that xattrs are preserved
                // xattrs are used for codesigning
                // it'd be easy to mess that up
                var unzip_argv = [_]string{
                    std.mem.span(unzip_exe),
                    "-q",
                    "-o",
                    std.mem.span(tmpname),
                };

                var unzip_process = try std.ChildProcess.init(&unzip_argv, ctx.allocator);
                defer unzip_process.deinit();
                unzip_process.cwd = tmpdir_path;
                unzip_process.stdin_behavior = .Inherit;
                unzip_process.stdout_behavior = .Inherit;
                unzip_process.stderr_behavior = .Inherit;

                const unzip_result = unzip_process.spawnAndWait() catch |err| {
                    save_dir.deleteFileZ(tmpname) catch {};
                    Output.prettyErrorln("<r><red>error:<r> Failed to spawn unzip due to {s}.", .{@errorName(err)});
                    Output.flush();
                    std.os.exit(1);
                };

                if (unzip_result.Exited != 0) {
                    Output.prettyErrorln("<r><red>Unzip failed<r> (exit code: {d})", .{unzip_result.Exited});
                    Output.flush();
                    save_dir.deleteFileZ(tmpname) catch {};
                    std.os.exit(1);
                }
            }

            {
                var verify_argv = [_]string{
                    exe_subpath,
                    "--version",
                };

                const result = std.ChildProcess.exec(.{
                    .allocator = ctx.allocator,
                    .argv = &verify_argv,
                    .cwd = tmpdir_path,
                    .max_output_bytes = 128,
                }) catch |err| {
                    save_dir_.deleteTree(version_name) catch {};
                    Output.prettyErrorln("<r><red>error<r> Failed to verify Bun {s}<r>)", .{@errorName(err)});
                    Output.flush();
                    std.os.exit(1);
                };

                if (result.term.Exited != 0) {
                    save_dir_.deleteTree(version_name) catch {};
                    Output.prettyErrorln("<r><red>error<r> failed to verify Bun<r> (exit code: {d})", .{result.term.Exited});
                    Output.flush();
                    std.os.exit(1);
                }

                if (!strings.eql(std.mem.trim(u8, result.stdout, " \n\r\t"), version_name)) {
                    save_dir_.deleteTree(version_name) catch {};

                    Output.prettyErrorln(
                        "<r><red>error<r>: The downloaded version of Bun (<red>{s}<r>) doesn't match the expected version (<b>{s}<r>)<r>. Cancelled upgrade",
                        .{
                            result.stdout[0..@minimum(result.stdout.len, 128)],
                            version_name,
                        },
                    );
                    Output.flush();
                    std.os.exit(1);
                }
            }

            var destination_executable_ = std.fs.selfExePath(&current_executable_buf) catch return error.UpgradeFailedMissingExecutable;
            current_executable_buf[destination_executable_.len] = 0;

            var target_filename_ = std.fs.path.basename(destination_executable_);
            var target_filename = current_executable_buf[destination_executable_.len - target_filename_.len ..][0..target_filename_.len :0];
            var target_dir_ = std.fs.path.dirname(destination_executable_) orelse return error.UpgradeFailedBecauseOfMissingExecutableDir;
            // safe because the slash will no longer be in use
            current_executable_buf[target_dir_.len] = 0;
            var target_dirname = current_executable_buf[0..target_dir_.len :0];
            var target_dir = std.fs.openDirAbsoluteZ(target_dirname, .{ .iterate = true }) catch |err| {
                save_dir_.deleteTree(version_name) catch {};
                Output.prettyErrorln("<r><red>error:<r> Failed to open Bun's install directory {s}", .{@errorName(err)});
                Output.flush();
                std.os.exit(1);
            };

            if (env_loader.map.get("BUN_DRY_RUN") == null) {
                C.moveFileZ(save_dir.fd, exe_subpath, target_dir.fd, target_filename) catch |err| {
                    save_dir_.deleteTree(version_name) catch {};
                    Output.prettyErrorln("<r><red>error:<r> Failed to move new version of Bun due to {s}. You could try the install script instead:\n   curl -L https://bun.sh/install | bash", .{@errorName(err)});
                    Output.flush();
                    std.os.exit(1);
                };
            }

            // Ensure completions are up to date.
            {
                var completions_argv = [_]string{
                    target_filename,
                    "completions",
                };

                env_loader.map.put("IS_BUN_AUTO_UPDATE", "true") catch unreachable;
                var buf_map = try env_loader.map.cloneToBufMap(ctx.allocator);
                _ = std.ChildProcess.exec(.{
                    .allocator = ctx.allocator,
                    .argv = &completions_argv,
                    .cwd = target_dirname,
                    .max_output_bytes = 4096,
                    .env_map = &buf_map,
                }) catch undefined;
            }

            Output.printStartEnd(ctx.start_time, std.time.nanoTimestamp());

            Output.prettyErrorln("<r> Upgraded.\n\n<b><green>Welcome to Bun v{s}!<r>\n\n  Report any bugs:\n    https://github.com/Jarred-Sumner/bun/issues\n\n  What's new:\n    https://github.com/Jarred-Sumner/bun/releases/tag/{s}<r>", .{ version_name, version.tag });
            Output.flush();
            return;
        }
    }
};
