const bun = @import("bun");
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

    pub fn exec(ctx: bun.CLI.Command.Context) !void {
        var requests_buf = bun.PackageManager.UpdateRequest.Array.init(0) catch unreachable;
        var run_in_bun = ctx.debug.run_in_bun;

        var passthrough_list = try std.ArrayList(string).initCapacity(ctx.allocator, std.os.argv.len -| 1);
        var package_name_for_update_request = [1]string{""};
        {
            var argv = std.mem.span(std.os.argv)[1..];
            if (argv.len > 0 and strings.eqlComptime(bun.span(argv[0]), "x"))
                argv = argv[1..];

            for (argv) |positional_| {
                const positional = bun.span(positional_);
                if (!run_in_bun) {
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

        const passthrough = passthrough_list.items;

        var update_requests = bun.PackageManager.UpdateRequest.parse(
            ctx.allocator,
            ctx.log,
            &package_name_for_update_request,
            &requests_buf,
            .add,
        );

        if (update_requests.len == 0) {
            Output.prettyErrorln("Welcome to bunx!\nbunx quickly runs an npm package executable, automatically installing if missing.\nTo get started, specify a package to install & run.\n\nexample<d>:<r>\n  <cyan>bunx bun-repl<r>\n", .{});
            Global.exit(1);
        }

        if (update_requests.len > 1) {
            Output.prettyErrorln("<r><red>error<r><d>:<r> Only one package can be installed & run at a time right now", .{});
            Global.exit(1);
        }

        const update_request = update_requests[0];

        // fast path: they're actually using this interchangably with `bun run`
        // so we use Bun.which to check
        var this_bundler: bun.Bundler = undefined;
        var ORIGINAL_PATH: string = "";

        const force_using_bun = run_in_bun;
        _ = try Run.configureEnvForRun(
            ctx,
            &this_bundler,
            null,
            &ORIGINAL_PATH,
            true,
            force_using_bun,
        );

        const package_name_for_bin = update_request.name;
        var PATH = this_bundler.env.map.get("PATH").?;
        const display_version: []const u8 =
            if (update_request.missing_version)
            "latest"
        else
            update_request.version_buf;
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

        if (bun.which(&path_buf, PATH, this_bundler.fs.top_level_dir, package_name_for_bin)) |destination| {
            const out = std.mem.span(destination);
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

        var bunx_install_dir_path = try std.fmt.allocPrint(
            ctx.allocator,
            bun.fs.FileSystem.RealFS.PLATFORM_TMP_DIR ++ "/{s}@{s}--bunx",
            .{ update_request.name, display_version },
        );

        // TODO: fix this after zig upgrade
        var bunx_install_dir = try std.fs.cwd().makeOpenPath(bunx_install_dir_path, .{ .iterate = true });
        outer: {
            // create package.json, but only if it doesn't exist
            var package_json = bunx_install_dir.createFileZ("package.json", .{ .truncate = false }) catch break :outer;
            defer package_json.close();
            package_json.writeAll("{}\n") catch break :outer;
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

        if (bun.which(&path_buf, PATH, this_bundler.fs.top_level_dir, package_name_for_bin)) |destination| {
            const out = std.mem.span(destination);
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

        Output.prettyErrorln("<r><red>error<r><d>:<r> could not determine executable to run for package <r><b>{s}<r>", .{package_name_for_bin});
        Global.exit(1);
    }
};
