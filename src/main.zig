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

pub fn main() anyerror!void {
    try alloc.setup(std.heap.page_allocator);
    const args = try std.process.argsAlloc(alloc.dynamic);
    const stdout = std.io.getStdOut();
    const stderr = std.io.getStdErr();

    if (args.len < 1) {
        const len = stderr.write("Pass a file");
        return;
    }

    const absolutePath = try std.fs.path.resolve(alloc.dynamic, args);
    const entryPointName = std.fs.path.basename(absolutePath);
    const file = try std.fs.openFileAbsolute(absolutePath, std.fs.File.OpenFlags{ .read = true });
    const stat = try file.stat();
    const code = try file.readToEndAlloc(alloc.dynamic, stat.size);

    const opts = try options.TransformOptions.initUncached(alloc.dynamic, entryPointName, code);
    var log = logger.Log.init(alloc.dynamic);
    var source = logger.Source.initFile(opts.entry_point, alloc.dynamic);
    var ast: js_ast.Ast = undefined;

    switch (opts.loader) {
        .json => {
            var expr = try json_parser.ParseJSON(&source, &log, alloc.dynamic);
            var stmt = js_ast.Stmt.alloc(alloc.dynamic, js_ast.S.ExportDefault{
                .value = js_ast.StmtOrExpr{ .expr = expr },
                .default_name = js_ast.LocRef{ .loc = logger.Loc{}, .ref = Ref{} },
            }, logger.Loc{ .start = 0 });

            var part = js_ast.Part{
                .stmts = &([_]js_ast.Stmt{stmt}),
            };

            ast = js_ast.Ast.initTest(&([_]js_ast.Part{part}));
        },
        .jsx, .tsx, .ts, .js => {
            var parser = try js_parser.Parser.init(opts, &log, &source, alloc.dynamic);
            var res = try parser.parse();
            ast = res.ast;
        },
        else => {
            std.debug.panic("Unsupported loader: {s}", .{opts.loader});
        },
    }

    var _linker = linker.Linker{};
    var symbols: [][]js_ast.Symbol = &([_][]js_ast.Symbol{ast.symbols});
    const printed = try js_printer.printAst(
        alloc.dynamic,
        ast,
        js_ast.Symbol.Map.initList(symbols),
        false,
        js_printer.Options{ .to_module_ref = js_ast.Ref{ .inner_index = 0 } },
        &_linker,
    );

    _ = try stdout.write(printed.js);
}
