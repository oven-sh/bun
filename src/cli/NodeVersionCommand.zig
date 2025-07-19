const bun = @import("bun");
const Output = bun.Output;
const Global = bun.Global;
const Environment = bun.Environment;
const MutableString = bun.MutableString;
const std = @import("std");
const Progress = bun.Progress;

const Command = @import("../cli.zig").Command;

const fs = @import("../fs.zig");
const URL = @import("../url.zig").URL;
const HTTP = bun.http;
const DotEnv = @import("../env_loader.zig");

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
        
        // Get BUN_INSTALL directory
        const bun_install_dir = bun.getenvZ("BUN_INSTALL") orelse {
            Output.prettyErrorln("<r><red>error<r><d>:<r> BUN_INSTALL environment variable not set", .{});
            Global.exit(1);
        };

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
        _ = archive_data;
        _ = extract_path;
        _ = ctx;
        
        // For now, use system tar command to extract
        // TODO: Implement libarchive extraction
        Output.prettyErrorln("<r><red>error<r><d>:<r> tar.gz extraction not yet implemented", .{});
        Global.exit(1);
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

        // For now, create a simple shell script that execs the actual node binary
        if (Environment.isWindows) {
            const batch_content = try std.fmt.allocPrint(
                ctx.allocator,
                "@echo off\n\"{s}\" %*\n",
                .{actual_node_path}
            );
            defer ctx.allocator.free(batch_content);

            const batch_file = try std.fs.createFileAbsolute(node_shim_path, .{});
            defer batch_file.close();
            try batch_file.writeAll(batch_content);
        } else {
            const script_content = try std.fmt.allocPrint(
                ctx.allocator,
                "#!/bin/sh\nexec \"{s}\" \"$@\"\n",
                .{actual_node_path}
            );
            defer ctx.allocator.free(script_content);

            const script_file = try std.fs.createFileAbsolute(node_shim_path, .{});
            defer script_file.close();
            try script_file.writeAll(script_content);
            try script_file.chmod(0o755);
        }

        Output.prettyErrorln("<r>Node.js shim updated: {s}<r>", .{node_shim_path});
    }
};