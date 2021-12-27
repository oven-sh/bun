const std = @import("std");
const lex = @import("js_lexer.zig");
const logger = @import("logger.zig");

const options = @import("options.zig");
const js_parser = @import("js_parser.zig");
const json_parser = @import("json_parser.zig");
const js_printer = @import("js_printer.zig");
const js_ast = @import("js_ast.zig");
const linker = @import("linker.zig");
usingnamespace @import("ast/base.zig");
usingnamespace @import("defines.zig");
const panicky = @import("panic_handler.zig");
const fs = @import("fs.zig");

const MainPanicHandler = panicky.NewPanicHandler(panicky.default_panic);

pub fn panic(msg: []const u8, error_return_trace: ?*std.builtin.StackTrace) noreturn {
    if (MainPanicHandler.Singleton) |singleton| {
        MainPanicHandler.handle_panic(msg, error_return_trace);
    } else {
        panicky.default_panic(msg, error_return_trace);
    }
}
// const Alloc = zee.ZeeAllocDefaults.wasm_allocator
pub fn main() anyerror!void {
    var arena = std.heap.ArenaAllocator.init(std.heap.page_allocator);
    var allocator = &arena.allocator;
    var log = logger.Log.init(default_allocator);
    var panicker = MainPanicHandler.init(&log);
    MainPanicHandler.Singleton = &panicker;

    const args = try std.process.argsAlloc(default_allocator);
    const stdout = std.io.getStdOut();
    const stderr = std.io.getStdErr();

    if (args.len < 1) {
        const len = stderr.write("Pass a file");
        return;
    }

    const absolutePath = args[args.len - 1];
    const pathname = fs.PathName.init(absolutePath);
    const entryPointName = try default_allocator.alloc(u8, pathname.base.len + pathname.ext.len);
    std.mem.copy(u8, entryPointName, pathname.base);
    std.mem.copy(u8, entryPointName[pathname.base.len..entryPointName.len], pathname.ext);
    const code = try std.io.getStdIn().readToEndAlloc(default_allocator, std.math.maxInt(usize));

    const opts = try options.TransformOptions.initUncached(default_allocator, entryPointName, code);
    var source = logger.Source.initFile(opts.entry_point, default_allocator);
    var ast: js_ast.Ast = undefined;

    var raw_defines = RawDefines.init(default_allocator);
    try raw_defines.put("process.env.NODE_ENV", "\"development\"");

    var user_defines = try DefineData.from_input(raw_defines, &log, default_allocator);

    var define = try Define.init(
        default_allocator,
        user_defines,
    );

    switch (opts.loader) {
        .json => {
            var expr = try json_parser.ParseJSON(&source, &log, default_allocator);
            var stmt = js_ast.Stmt.alloc(default_allocator, js_ast.S.ExportDefault{
                .value = js_ast.StmtOrExpr{ .expr = expr },
                .default_name = js_ast.LocRef{ .loc = logger.Loc{}, .ref = Ref{} },
            }, logger.Loc{ .start = 0 });

            var part = js_ast.Part{
                .stmts = &([_]js_ast.Stmt{stmt}),
            };

            ast = js_ast.Ast.initTest(&([_]js_ast.Part{part}));
        },
        .jsx, .tsx, .ts, .js => {
            var parser = try js_parser.Parser.init(opts, &log, &source, define, default_allocator);
            var res = try parser.parse();
            ast = res.ast;
        },
        else => {
            Global.panic("Unsupported loader: {s}", .{opts.loader});
        },
    }

    var _linker = linker.Linker{};
    var symbols: [][]js_ast.Symbol = &([_][]js_ast.Symbol{ast.symbols});
    const printed = try js_printer.printAst(
        default_allocator,
        ast,
        js_ast.Symbol.Map.initList(symbols),
        &source,
        false,
        js_printer.Options{ .to_module_ref = ast.module_ref orelse js_ast.Ref{ .inner_index = 0 } },
        &_linker,
    );

    // if (std.builtin.mode == std.builtin.Mode.Debug) {
    //     var fixed_buffer = [_]u8{0} ** 512000;
    //     var buf_stream = std.io.fixedBufferStream(&fixed_buffer);

    //     try ast.toJSON(default_allocator, stderr.writer());
    // }

    _ = try stdout.write(printed.js);
}
