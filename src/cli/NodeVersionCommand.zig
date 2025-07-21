const bun = @import("bun");
const Output = bun.Output;
const Global = bun.Global;
const Environment = bun.Environment;
const MutableString = bun.MutableString;
const std = @import("std");
const Progress = bun.Progress;

const Command = @import("../cli.zig").Command;

const fs = bun.fs;
const URL = bun.URL;
const HTTP = bun.http;
const DotEnv = bun.DotEnv;

const platform_label = switch (Environment.os) {
    .mac => "darwin",
    .linux => "linux",
    .windows => "win",
    else => @compileError("Unsupported OS for Node.js installation"),
};

const arch_label = if (Environment.isAarch64) "arm64" else "x64";

fn getDownloadURL(version: []const u8, allocator: std.mem.Allocator) ![]const u8 {
    const extension = if (Environment.isWindows) "zip" else "tar.gz";
    return try std.fmt.allocPrint(
        allocator,
        "https://nodejs.org/dist/v{s}/node-v{s}-{s}-{s}.{s}",
        .{ version, version, platform_label, arch_label, extension }
    );
}

fn getBunInstallDir(allocator: std.mem.Allocator) ![]const u8 {
    if (bun.getenvZ("BUN_INSTALL")) |install_dir| {
        return try allocator.dupe(u8, install_dir);
    }
    
    // Fall back to ~/.bun like other Bun commands
    const home_dir = bun.getenvZ("HOME") orelse bun.getenvZ("USERPROFILE") orelse {
        Output.prettyErrorln("<r><red>error<r><d>:<r> Could not determine home directory. Please set BUN_INSTALL", .{});
        Global.exit(1);
    };
    
    return try std.fs.path.join(allocator, &.{ home_dir, ".bun" });
}

pub const NodeVersionCommand = struct {
    pub fn exec(ctx: Command.Context) !void {
        @branchHint(.cold);

        const args = bun.argv;
        if (args.len < 3) {
            Output.prettyErrorln("<r><red>error<r><d>:<r> Please specify a Node.js version to install", .{});
            Output.prettyErrorln("Usage: bun node \\<version\\>", .{});
            Output.prettyErrorln("Example: bun node 20.11.0", .{});
            Global.exit(1);
        }

        const version_arg = args[2];
        
        // Validate version format (basic check)
        if (!isValidVersion(version_arg)) {
            Output.prettyErrorln("<r><red>error<r><d>:<r> Invalid Node.js version format: {s}", .{version_arg});
            Output.prettyErrorln("Expected format: X.Y.Z (e.g., 20.11.0)", .{});
            Global.exit(1);
        }

        try installNodeVersion(ctx, version_arg);
    }

    fn isValidVersion(version: []const u8) bool {
        // Basic validation: check if it matches X.Y.Z pattern
        var dot_count: u32 = 0;
        var has_digits = false;
        
        for (version) |char| {
            if (char == '.') {
                dot_count += 1;
                if (dot_count > 2) return false;
            } else if (char >= '0' and char <= '9') {
                has_digits = true;
            } else {
                return false;
            }
        }
        
        return dot_count == 2 and has_digits;
    }

    fn installNodeVersion(ctx: Command.Context, version: []const u8) !void {
        Output.prettyErrorln("<r><b>Installing Node.js v{s}<r>", .{version});
        
        // Get BUN_INSTALL directory with fallback to ~/.bun
        const bun_install_dir = try getBunInstallDir(ctx.allocator);
        defer ctx.allocator.free(bun_install_dir);

        // Create node installation directory
        const node_install_path = try std.fmt.allocPrint(
            ctx.allocator,
            "{s}/node/v{s}",
            .{ bun_install_dir, version }
        );
        defer ctx.allocator.free(node_install_path);

        // Check if version is already installed
        if (std.fs.openDirAbsolute(node_install_path, .{})) |_| {
            Output.prettyErrorln("<r><b>Node.js v{s} is already installed<r>", .{version});
            try updateNodeShim(ctx, version, bun_install_dir);
            return;
        } else |_| {
            // Directory doesn't exist, proceed with installation
        }

        // Download and install
        try downloadAndInstallNode(ctx, version, bun_install_dir);
        try updateNodeShim(ctx, version, bun_install_dir);
        
        Output.prettyErrorln("<r><b><green>Successfully installed Node.js v{s}<r>", .{version});
    }

    fn downloadAndInstallNode(ctx: Command.Context, version: []const u8, bun_install_dir: []const u8) !void {
        var env_loader: DotEnv.Loader = brk: {
            const map = try ctx.allocator.create(DotEnv.Map);
            map.* = DotEnv.Map.init(ctx.allocator);
            break :brk DotEnv.Loader.init(map, ctx.allocator);
        };
        env_loader.loadProcess();

        const download_url = try getDownloadURL(version, ctx.allocator);
        defer ctx.allocator.free(download_url);

        const url = URL.parse(download_url);
        const http_proxy: ?URL = env_loader.getHttpProxyFor(url);

        Output.prettyErrorln("<r>Downloading from {s}<r>", .{download_url});

        var refresher = Progress{};
        var progress = refresher.start("Downloading Node.js", 0);
        refresher.refresh();

        var async_http = try ctx.allocator.create(HTTP.AsyncHTTP);
        var download_buffer = try ctx.allocator.create(MutableString);
        download_buffer.* = try MutableString.init(ctx.allocator, 1024 * 1024); // 1MB initial

        async_http.* = HTTP.AsyncHTTP.initSync(
            ctx.allocator,
            .GET,
            url,
            .{},
            "",
            download_buffer,
            "",
            http_proxy,
            null,
            HTTP.FetchRedirect.follow,
        );
        async_http.client.progress_node = progress;
        async_http.client.flags.reject_unauthorized = env_loader.getTLSRejectUnauthorized();

        const response = try async_http.sendSync();

        switch (response.status_code) {
            404 => {
                progress.end();
                refresher.refresh();
                Output.prettyErrorln("<r><red>error<r><d>:<r> Node.js version {s} not found", .{version});
                Global.exit(1);
            },
            200 => {},
            else => {
                progress.end();
                refresher.refresh();
                Output.prettyErrorln("<r><red>error<r><d>:<r> Failed to download Node.js (HTTP {d})", .{response.status_code});
                Global.exit(1);
            },
        }

        const bytes = download_buffer.slice();
        progress.end();
        refresher.refresh();

        if (bytes.len == 0) {
            Output.prettyErrorln("<r><red>error<r><d>:<r> Downloaded empty file", .{});
            Global.exit(1);
        }

        Output.prettyErrorln("<r>Downloaded {d} bytes<r>", .{bytes.len});

        // Extract the archive
        try extractNodeArchive(ctx, bytes, version, bun_install_dir);
    }

    fn extractNodeArchive(ctx: Command.Context, archive_data: []const u8, version: []const u8, bun_install_dir: []const u8) !void {
        Output.prettyErrorln("<r>Extracting Node.js v{s}<r>", .{version});

        // Create installation directory
        const node_install_path = try std.fmt.allocPrint(
            ctx.allocator,
            "{s}/node/v{s}",
            .{ bun_install_dir, version }
        );
        defer ctx.allocator.free(node_install_path);

        std.fs.makeDirAbsolute(node_install_path) catch |err| switch (err) {
            error.PathAlreadyExists => {},
            else => return err,
        };

        if (Environment.isWindows) {
            // For Windows, we expect a ZIP file
            try extractZipArchive(ctx, archive_data, node_install_path);
        } else {
            // For Unix systems, we expect a tar.gz file
            try extractTarGzArchive(ctx, archive_data, node_install_path);
        }
    }

    fn extractZipArchive(ctx: Command.Context, archive_data: []const u8, extract_path: []const u8) !void {
        // For now, implement a basic ZIP extraction using system tools
        // This is similar to how the upgrade command handles ZIP files on Windows
        
        var filesystem = try fs.FileSystem.init(null);
        var temp_dir = filesystem.tmpdir() catch |err| {
            Output.errGeneric("Failed to open temporary directory: {s}", .{@errorName(err)});
            Global.exit(1);
        };

        const temp_file = try temp_dir.createFile("node.zip", .{});
        defer temp_file.close();
        defer temp_dir.deleteFile("node.zip") catch {};

        try temp_file.writeAll(archive_data);

        // Use PowerShell to extract the ZIP
        const extract_script = try std.fmt.allocPrint(
            ctx.allocator,
            "$global:ProgressPreference='SilentlyContinue';Expand-Archive -Path \"node.zip\" \"{s}\" -Force",
            .{bun.fmt.escapePowershell(extract_path)},
        );
        defer ctx.allocator.free(extract_script);

        var buf: bun.PathBuffer = undefined;
        const powershell_path = bun.which(&buf, bun.getenvZ("PATH") orelse "", "", "powershell") orelse {
            Output.prettyErrorln("<r><red>error<r><d>:<r> PowerShell not found", .{});
            Global.exit(1);
        };

        var extract_argv = [_][]const u8{
            powershell_path,
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            extract_script,
        };

        const temp_path = try bun.FD.fromStdDir(temp_dir).getFdPath(&buf);

        _ = (bun.spawnSync(&.{
            .argv = &extract_argv,
            .envp = null,
            .cwd = temp_path,
            .stderr = .inherit,
            .stdout = .inherit,
            .stdin = .inherit,
            .windows = if (Environment.isWindows) .{
                .loop = bun.JSC.EventLoopHandle.init(bun.JSC.MiniEventLoop.initGlobal(null)),
            },
        }) catch |err| {
            Output.prettyErrorln("<r><red>error<r><d>:<r> Failed to extract ZIP: {s}", .{@errorName(err)});
            Global.exit(1);
        }).unwrap() catch |err| {
            Output.prettyErrorln("<r><red>error<r><d>:<r> Failed to extract ZIP: {s}", .{@errorName(err)});
            Global.exit(1);
        };
    }

    fn extractTarGzArchive(ctx: Command.Context, archive_data: []const u8, extract_path: []const u8) !void {
        // Write archive to temporary file and use system tar for extraction
        var filesystem = try fs.FileSystem.init(null);
        var temp_dir = filesystem.tmpdir() catch |err| {
            Output.errGeneric("Failed to open temporary directory: {s}", .{@errorName(err)});
            Global.exit(1);
        };

        const temp_file = try temp_dir.createFile("node.tar.gz", .{});
        defer temp_file.close();
        defer temp_dir.deleteFile("node.tar.gz") catch {};

        try temp_file.writeAll(archive_data);

        // Use system tar to extract
        var buf: bun.PathBuffer = undefined;
        const temp_path = try bun.FD.fromStdDir(temp_dir).getFdPath(&buf);

        const tar_argv = [_][]const u8{
            "tar",
            "-xzf",
            "node.tar.gz",
            "--strip-components=1",
            "-C",
            extract_path,
        };

        _ = (bun.spawnSync(&.{
            .argv = &tar_argv,
            .envp = null,
            .cwd = temp_path,
            .stderr = .inherit,
            .stdout = .inherit,
            .stdin = .inherit,
        }) catch |err| {
            Output.prettyErrorln("<r><red>error<r><d>:<r> Failed to extract tar.gz: {s}", .{@errorName(err)});
            Global.exit(1);
        }).unwrap() catch |err| {
            Output.prettyErrorln("<r><red>error<r><d>:<r> tar command failed: {s}", .{@errorName(err)});
            Global.exit(1);
        };

        _ = ctx; // Silence unused parameter warning
    }

    fn updateNodeShim(ctx: Command.Context, version: []const u8, bun_install_dir: []const u8) !void {
        // Create or update the node shim executable
        const bin_dir = try std.fmt.allocPrint(
            ctx.allocator,
            "{s}/bin",
            .{bun_install_dir}
        );
        defer ctx.allocator.free(bin_dir);

        std.fs.makeDirAbsolute(bin_dir) catch |err| switch (err) {
            error.PathAlreadyExists => {},
            else => return err,
        };

        const node_shim_path = try std.fmt.allocPrint(
            ctx.allocator,
            "{s}/node{s}",
            .{ bin_dir, if (Environment.isWindows) ".exe" else "" }
        );
        defer ctx.allocator.free(node_shim_path);

        const actual_node_path = try std.fmt.allocPrint(
            ctx.allocator,
            "{s}/node/v{s}/bin/node{s}",
            .{ bun_install_dir, version, if (Environment.isWindows) ".exe" else "" }
        );
        defer ctx.allocator.free(actual_node_path);

        // Remove existing shim if it exists
        std.fs.deleteFileAbsolute(node_shim_path) catch |err| switch (err) {
            error.FileNotFound => {},
            else => return err,
        };

        if (Environment.isWindows) {
            // On Windows, copy the executable directly since symlinks require admin privileges
            std.fs.copyFileAbsolute(actual_node_path, node_shim_path, .{}) catch |err| {
                Output.prettyErrorln("<r><red>error<r><d>:<r> Failed to copy node binary: {s}", .{@errorName(err)});
                Global.exit(1);
            };
        } else {
            // On Unix systems, use symlinks (secure, no shell injection possible)
            std.fs.symLinkAbsolute(actual_node_path, node_shim_path, .{}) catch |err| {
                Output.prettyErrorln("<r><red>error<r><d>:<r> Failed to create node symlink: {s}", .{@errorName(err)});
                Global.exit(1);
            };
        }

        Output.prettyErrorln("<r>Node.js shim updated: {s}<r>", .{node_shim_path});
    }
};