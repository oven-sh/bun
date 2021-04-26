const std = @import("std");
const lex = @import("js_lexer.zig");
const logger = @import("logger.zig");
const alloc = @import("alloc.zig");
const options = @import("options.zig");
const js_parser = @import("js_parser.zig");
const js_printer = @import("js_printer.zig");
const js_ast = @import("js_ast.zig");

pub fn main() anyerror!void {
    try alloc.setup(std.heap.page_allocator);
    // const args = try std.process.argsAlloc(alloc.dynamic);
    // // const stdout = std.io.getStdOut();
    // // const stderr = std.io.getStdErr();

    // // if (args.len < 1) {
    // //     const len = stderr.write("Pass a file");
    // //     return;
    // // }

    // // alloc

    const entryPointName = "/var/foo/index.js";
    const code = "for (let i = 0; i < 100; i++) { console.log('hi') aposkdpoaskdpokasdpokasdpokasdpokasdpoaksdpoaksdpoaskdpoaksdpoaksdpoaskdpoaskdpoasdk; ";

    const opts = try options.TransformOptions.initUncached(alloc.dynamic, entryPointName, code);
    var log = logger.Log.init(alloc.dynamic);
    var source = logger.Source.initFile(opts.entry_point, alloc.dynamic);
    var parser = try js_parser.Parser.init(opts, &log, &source, alloc.dynamic);
    var res = try parser.parse();

    const printed = try js_printer.printAst(alloc.dynamic, res.ast, js_ast.Symbol.Map{}, false, js_printer.Options{ .to_module_ref = js_ast.Ref{ .inner_index = 0 } });

    std.debug.print("{s}\n{s}", .{ res, printed });
}
