usingnamespace @import("../global.zig");
const std = @import("std");

const lex = @import("../js_lexer.zig");
const logger = @import("../logger.zig");
const alloc = @import("../alloc.zig");
const options = @import("../options.zig");
const js_parser = @import("../js_parser.zig");
const js_ast = @import("../js_ast.zig");
const linker = @import("../linker.zig");
usingnamespace @import("../ast/base.zig");
usingnamespace @import("../defines.zig");
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

pub const BuildCommand = struct {
    pub fn exec(ctx: Command.Context) !void {
        var result: options.TransformResult = undefined;
        switch (ctx.args.resolve orelse Api.ResolveMode.dev) {
            Api.ResolveMode.disable => {
                result = try bundler.Transformer.transform(
                    ctx.allocator,
                    ctx.log,
                    ctx.args,
                );
            },
            .lazy => {
                result = try bundler.Bundler.bundle(
                    ctx.allocator,
                    ctx.log,
                    ctx.args,
                );
            },
            else => {
                result = try bundler.Bundler.bundle(
                    ctx.allocator,
                    ctx.log,
                    ctx.args,
                );
            },
        }
        var did_write = false;
        var stderr_writer = Output.errorWriter();
        var buffered_writer = Output.errorWriter();
        defer Output.flush();
        var writer = Output.writer();
        var err_writer = writer;

        var open_file_limit: usize = 32;
        if (ctx.args.write) |write| {
            if (write) {
                const root_dir = result.root_dir orelse unreachable;
                if (std.os.getrlimit(.NOFILE)) |limit| {
                    open_file_limit = limit.cur;
                } else |err| {}

                var all_paths = try ctx.allocator.alloc([]const u8, result.output_files.len);
                var max_path_len: usize = 0;
                var max_padded_size: usize = 0;
                for (result.output_files) |f, i| {
                    all_paths[i] = f.input.text;
                }

                var from_path = resolve_path.longestCommonPath(all_paths);

                for (result.output_files) |f, i| {
                    max_path_len = std.math.max(
                        std.math.max(from_path.len, f.input.text.len) + 2 - from_path.len,
                        max_path_len,
                    );
                }

                did_write = true;

                // On posix, file handles automatically close on process exit by the OS
                // Closing files shows up in profiling.
                // So don't do that unless we actually need to.
                const do_we_need_to_close = !FeatureFlags.store_file_descriptors or (@intCast(usize, root_dir.fd) + open_file_limit) < result.output_files.len;

                var filepath_buf: [std.fs.MAX_PATH_BYTES]u8 = undefined;
                filepath_buf[0] = '.';
                filepath_buf[1] = '/';

                for (result.output_files) |f, i| {
                    var rel_path: []const u8 = undefined;
                    switch (f.value) {
                        // easy mode: write the buffer
                        .buffer => |value| {
                            rel_path = resolve_path.relative(from_path, f.input.text);

                            try root_dir.writeFile(rel_path, value);
                        },
                        .move => |value| {
                            // const primary = f.input.text[from_path.len..];
                            // std.mem.copy(u8, filepath_buf[2..], primary);
                            // rel_path = filepath_buf[0 .. primary.len + 2];
                            rel_path = value.pathname;

                            // try f.moveTo(result.outbase, constStrToU8(rel_path), root_dir.fd);
                        },
                        .copy => |value| {
                            rel_path = value.pathname;

                            try f.copyTo(result.outbase, allocators.constStrToU8(rel_path), root_dir.fd);
                        },
                        .noop => {},
                        .pending => |value| {
                            unreachable;
                        },
                    }

                    // Print summary
                    _ = try writer.write("\n");
                    const padding_count = 2 + (std.math.max(rel_path.len, max_path_len) - rel_path.len);
                    try writer.writeByteNTimes(' ', 2);
                    try writer.writeAll(rel_path);
                    try writer.writeByteNTimes(' ', padding_count);
                    const size = @intToFloat(f64, f.size) / 1000.0;
                    try std.fmt.formatFloatDecimal(size, .{ .precision = 2 }, writer);
                    try writer.writeAll(" KB\n");
                }
            }
        }

        if (isDebug) {
            err_writer.print("\nExpr count:       {d}\n", .{js_ast.Expr.icount}) catch {};
            err_writer.print("Stmt count:       {d}\n", .{js_ast.Stmt.icount}) catch {};
            err_writer.print("Binding count:    {d}\n", .{js_ast.Binding.icount}) catch {};
            err_writer.print("File Descriptors: {d} / {d}\n", .{
                fs.FileSystem.max_fd,
                open_file_limit,
            }) catch {};
        }

        if (Output.enable_ansi_colors) {
            for (result.errors) |err| {
                try err.writeFormat(err_writer, true);
                _ = try err_writer.write("\n");
            }

            for (result.warnings) |err| {
                try err.writeFormat(err_writer, true);
                _ = try err_writer.write("\n");
            }
        } else {
            for (result.errors) |err| {
                try err.writeFormat(err_writer, false);
                _ = try err_writer.write("\n");
            }

            for (result.warnings) |err| {
                try err.writeFormat(err_writer, false);
                _ = try err_writer.write("\n");
            }
        }

        const duration = std.time.nanoTimestamp() - ctx.start_time;

        if (did_write and duration < @as(i128, @as(i128, std.time.ns_per_s) * @as(i128, 2))) {
            var elapsed = @divTrunc(duration, @as(i128, std.time.ns_per_ms));
            try err_writer.print("\nCompleted in {d}ms", .{elapsed});
        }
    }
};
