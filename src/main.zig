const std = @import("std");
const lex = @import("js_lexer.zig");
const logger = @import("logger.zig");
const alloc = @import("alloc.zig");
const options = @import("options.zig");
const js_parser = @import("js_parser.zig");
const json_parser = @import("json_parser.zig");
const js_printer = @import("js_printer.zig");
const js_ast = @import("js_ast.zig");
const linker = @import("linker.zig");
usingnamespace @import("ast/base.zig");
usingnamespace @import("defines.zig");
usingnamespace @import("global.zig");
const panicky = @import("panic_handler.zig");
const cli = @import("cli.zig");
pub const MainPanicHandler = panicky.NewPanicHandler(panicky.default_panic);

pub fn panic(msg: []const u8, error_return_trace: ?*std.builtin.StackTrace) noreturn {
    if (MainPanicHandler.Singleton) |singleton| {
        MainPanicHandler.handle_panic(msg, error_return_trace);
    } else {
        panicky.default_panic(msg, error_return_trace);
    }
}

pub fn main() anyerror!void {
    // The memory allocator makes a massive difference.
    // std.heap.raw_c_allocator and std.heap.c_allocator perform similarly.
    // std.heap.GeneralPurposeAllocator makes this about 3x _slower_ than esbuild.
    // var root_alloc = std.heap.ArenaAllocator.init(std.heap.raw_c_allocator);
    // var root_alloc_ = &root_alloc.allocator;
    try alloc.setup(std.heap.c_allocator);
    var stdout = std.io.getStdOut();
    // var stdout = std.io.bufferedWriter(stdout_file.writer());
    var stderr = std.io.getStdErr();
    // var stderr = std.io.bufferedWriter(stderr_file.writer());
    var output_source = Output.Source.init(stdout, stderr);
    // defer stdout.flush() catch {};
    // defer stderr.flush() catch {};
    Output.Source.set(&output_source);

    try cli.Cli.start(std.heap.c_allocator, stdout, stderr, MainPanicHandler);
}
