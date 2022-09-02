const std = @import("std");
const bun = @import("../global.zig");
const DirInfo = @import("../resolver/dir_info.zig");
const resolve_path = @import("../resolver/resolve_path.zig");
const string = bun.string;
const strings = bun.strings;
const Output = bun.Output;
const Global = bun.Global;
const heap_allocator = bun.default_allocator;
const system = std.os.system;
const Run = @import("../bun_js.zig").Run;
const bundler = @import("../bundler.zig");
const Command = @import("../cli.zig").Command;
const RunCommand = @import("./run_command.zig").RunCommand;
const cli = @import("../cli.zig");

const RunOutput = struct {
    cancelled: bool,
    script: ?string,
};

pub const DotCommand = struct {
    fn returnFileIfExist(name: string) ?std.fs.File {
        var script_name_to_search = name;
        var script_name_buf: [bun.MAX_PATH_BYTES]u8 = undefined;

        const file_: std.fs.File.OpenError!std.fs.File = brk: {
            if (script_name_to_search[0] == std.fs.path.sep) {
                break :brk std.fs.openFileAbsolute(script_name_to_search, .{ .mode = .read_only });
            } else if (!strings.hasPrefix(script_name_to_search, "..") and script_name_to_search[0] != '~') {
                const file_pathZ = brk2: {
                    if (!strings.hasPrefix(script_name_to_search, "./")) {
                        script_name_buf[0..2].* = "./".*;
                        @memcpy(script_name_buf[2..], script_name_to_search.ptr, script_name_to_search.len);
                        script_name_buf[script_name_to_search.len + 2] = 0;
                        break :brk2 script_name_buf[0 .. script_name_to_search.len + 2 :0];
                    } else {
                        @memcpy(&script_name_buf, script_name_to_search.ptr, script_name_to_search.len);
                        script_name_buf[script_name_to_search.len] = 0;
                        break :brk2 script_name_buf[0..script_name_to_search.len :0];
                    }
                };

                break :brk std.fs.cwd().openFileZ(file_pathZ, .{ .mode = .read_only });
            } else {
                var path_buf: [bun.MAX_PATH_BYTES]u8 = undefined;
                const cwd = std.os.getcwd(&path_buf) catch return null;
                path_buf[cwd.len] = std.fs.path.sep;
                var parts = [_]string{script_name_to_search};
                script_name_to_search = resolve_path.joinAbsStringBuf(
                    path_buf[0 .. cwd.len + 1],
                    &script_name_buf,
                    &parts,
                    .auto,
                );
                if (script_name_to_search.len == 0) return null;
                script_name_buf[script_name_to_search.len] = 0;
                var file_pathZ = script_name_buf[0..script_name_to_search.len :0];
                break :brk std.fs.openFileAbsoluteZ(file_pathZ, .{ .mode = .read_only });
            }
        };

        const file = file_ catch return null;

        return file;
    }

    fn findFile(ctx: *Command.Context, run: bool) RunOutput {
        if (returnFileIfExist("index.js")) |file| {
            return if (run) tryToRun(ctx, file, "index.js") else RunOutput{ .cancelled = false, .script = "index.js" };
        } else if (returnFileIfExist("index.ts")) |file| {
            return if (run) tryToRun(ctx, file, "index.ts") else RunOutput{ .cancelled = false, .script = "index.ts" };
        } else if (returnFileIfExist("index.mjs")) |file| {
            return if (run) tryToRun(ctx, file, "index.mjs") else RunOutput{ .cancelled = false, .script = "index.mjs" };
        } else if (returnFileIfExist("index.cjs")) |file| {
            return if (run) tryToRun(ctx, file, "index.cjs") else RunOutput{ .cancelled = false, .script = "index.cjs" };
        } else if (returnFileIfExist("index.mts")) |file| {
            return if (run) tryToRun(ctx, file, "index.mts") else RunOutput{ .cancelled = false, .script = "index.mts" };
        } else if (returnFileIfExist("index.cts")) |file| {
            return if (run) tryToRun(ctx, file, "index.cts") else RunOutput{ .cancelled = false, .script = "index.cts" };
        }

        return if (run) RunOutput{ .cancelled = true, .script = "index.js" } else RunOutput{ .cancelled = false, .script = null };
    }

    // From cli.zig - maybeOpenWithBunJS but modified to accept file & script_to_run
    fn tryToRun(ctx: *Command.Context, file: std.fs.File, script_to_run: string) RunOutput {
        ctx.args.entry_points = &[_]string{script_to_run};

        var script_name_buf: [bun.MAX_PATH_BYTES]u8 = undefined;

        Global.configureAllocator(.{ .long_running = true });

        var absolute_script_path = std.os.getFdPath(file.handle, &script_name_buf) catch return RunOutput{ .cancelled = true, .script = script_to_run };
        Run.boot(
            ctx.*,
            file,
            absolute_script_path,
        ) catch |err| {
            if (Output.enable_ansi_colors) {
                ctx.log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), true) catch {};
            } else {
                ctx.log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), false) catch {};
            }

            Output.prettyErrorln("<r><red>error<r>: Failed to run <b>{s}<r> due to error <b>{s}<r>", .{
                std.fs.path.basename(ctx.args.entry_points[0]),
                @errorName(err),
            });

            Global.exit(1);
        };

        return RunOutput{ .cancelled = false, .script = script_to_run };
    }

    pub fn exec(ctx: *Command.Context) !bool {
        var ORIGINAL_PATH: string = "";
        var this_bundler: bundler.Bundler = undefined;
        var root_dir_info = try RunCommand.configureEnvForRun(ctx.*, &this_bundler, null, &ORIGINAL_PATH, true);

        var script_to_run: ?string = "";
        if (root_dir_info.enclosing_package_json) |package_json| script_to_run = package_json.main_fields.get("module") orelse package_json.main_fields.get("main") orelse null;

        if (script_to_run == null) {
            const opts = findFile(ctx, true);

            if (opts.cancelled) {
                Output.prettyErrorln("<r><red>error<r>: Module not found \"<b>{s}<r>\"", .{
                    opts.script.?,
                });

                Global.exit(1);
            }

            return !opts.cancelled;
        } else {
            if (returnFileIfExist(script_to_run.?)) |file| {
                return !(tryToRun(ctx, file, script_to_run.?).cancelled);
            } else {
                const new_script = findFile(ctx, false);

                const package_json_path: string = if (root_dir_info.enclosing_package_json) |package_json|
                    std.fmt.allocPrint(heap_allocator, "{s}/package.json", .{package_json.source.path.name.dir}) catch "package.json"
                else
                    "package.json";

                if (new_script.script == null) {
                    Output.prettyErrorln("<r><red>error<r>: Module not found \"<b>{s}<r>\". Invalid \"<b>main</b>\" field in \"{s}\"", .{
                        script_to_run,
                        package_json_path,
                    });

                    Global.exit(1);

                    return false;
                }

                Output.prettyWarnln("<r><yellow>Warn<r>: Invalid \"<b>main</b>\" field in \"{s}\"", .{
                    package_json_path,
                });

                _ = tryToRun(ctx, returnFileIfExist(new_script.script.?).?, new_script.script.?);
            }
        }

        return true;
    }
};
