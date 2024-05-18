const std = @import("std");
const bun = @import("root").bun;
const Output = bun.Output;
const Global = bun.Global;
const Command = bun.CLI.Command;

pub const PatchCommand = struct {
    pub fn exec(ctx: Command.Context) !void {
        const edit_dir = ctx.patch_options.edit_dir orelse brk: {
            var tmpname_buf: [1024]u8 = undefined;
            const tempdir_name = bun.span(try bun.fs.FileSystem.instance.tmpname("tmp", &tmpname_buf, bun.fastRandom()));
            break :brk tempdir_name;
        };
        _ = edit_dir; // autofix
        // TODO: properly get the root project dir
        const lockfile_dir = ctx.bundler_options.root_dir;
        _ = lockfile_dir; // autofix
    }
};
