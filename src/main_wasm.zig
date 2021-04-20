const std = @import("std");
const lex = @import("js_lexer.zig");
const logger = @import("logger.zig");
const alloc = @import("alloc.zig");

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
    const msgs = std.ArrayList(logger.Msg).init(alloc.dynamic);
    const log = logger.Log{
        .msgs = msgs,
    };

    const source = logger.Source.initPathString("index.js", "for (let i = 0; i < 100; i++) { console.log('hi') aposkdpoaskdpokasdpokasdpokasdpokasdpoaksdpoaksdpoaskdpoaksdpoaksdpoaskdpoaskdpoasdk; }", alloc.dynamic);

    var lexer = try lex.Lexer.init(log, source, alloc.dynamic);
    lexer.next();
    while (lexer.token != lex.T.t_end_of_file) {
        lexer.next();
    }
    const v = try std.io.getStdOut().write("Finished");
}
