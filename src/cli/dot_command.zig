const std = @import("std");
const bun = @import("../global.zig");
const DirInfo = @import("../resolver/dir_info.zig");
const string = bun.string;
const strings = bun.strings;
const Output = bun.Output;
const Global = bun.Global;
const heap_allocator = bun.default_allocator;
const system = std.os.system;
const bundler = @import("../bundler.zig");
const Command = @import("../cli.zig").Command;
const RunCommand = @import("./run_command.zig").RunCommand;
const cli = @import("../cli.zig");

pub const DotCommand = struct {
    fn findFile() ?string {
        if (system.access("index.js", std.os.F_OK) == 0) {
            return "index.js";
        } else if (system.access("index.ts", std.os.F_OK) == 0) {
            return "index.ts";
        } else if (system.access("index.mjs", std.os.F_OK) == 0) {
            return "index.mjs";
        } else if (system.access("index.cjs", std.os.F_OK) == 0) {
            return "index.cjs";
        } else if (system.access("index.mts", std.os.F_OK) == 0) {
            return "index.mts";
        } else if (system.access("index.cts", std.os.F_OK) == 0) {
            return "index.cts";
        } else {
            return null;
        }
    }

    pub fn exec(ctx: *Command.Context) !bool {
        var ORIGINAL_PATH: string = "";
        var this_bundler: bundler.Bundler = undefined;
        var root_dir_info = try RunCommand.configureEnvForRun(ctx.*, &this_bundler, null, &ORIGINAL_PATH, true);

        var script_to_run: ?string = "";
        if (root_dir_info.enclosing_package_json) |package_json| script_to_run = package_json.main_fields.get("module") orelse package_json.main_fields.get("main") orelse null;

        if (script_to_run == null) {
            script_to_run = findFile();
        } else if (system.access(heap_allocator.dupeZ(u8, script_to_run.?) catch unreachable, std.os.F_OK) != 0) {
            var new_script_to_run = findFile();

            const package_json_path: string = if (root_dir_info.enclosing_package_json) |package_json|
                std.fmt.allocPrint(heap_allocator, "{s}/package.json", .{package_json.source.path.name.dir}) catch "package.json"
            else
                "package.json";

            if (new_script_to_run == null) {
                Output.prettyErrorln("<r><red>error<r>: Module not found \"<b>{s}<r>\". Invalid \"<b>main</b>\" field in \"{s}\"", .{
                    script_to_run,
                    package_json_path,
                });
                Global.exit(1);

                return false;
            } else script_to_run = new_script_to_run;

            Output.prettyWarnln("<r><yellow>Warn<r>: Invalid \"<b>main</b>\" field in \"{s}\"", .{
                package_json_path,
            });
        }

        //std.debug.print("POSITIONALS {any}\nENTRY POINTS {any}\n\n", .{ ctx.positionals, ctx.args.entry_points });
        ctx.positionals = &[_]string{script_to_run.?};
        ctx.args.entry_points = &[_]string{script_to_run.?};
        //ctx.positionals[0] = script_to_run.?;
        //ctx.args.entry_points[0] = script_to_run.?;

        if (Command.maybeOpenWithBunJS(ctx)) {
            return true;
        }

        Output.prettyErrorln("<r><red>error<r>: Module not found \"<b>{s}<r>\"", .{
            ctx.positionals[0],
        });
        Global.exit(1);

        return false;
    }
};
