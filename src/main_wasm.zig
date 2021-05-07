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
const panicky = @import("panic_handler.zig");
usingnamespace @import("global.zig");
const fs = @import("fs.zig");
const Schema = @import("api/schema.zig").Api;
const builtin = std.builtin;
const MainPanicHandler = panicky.NewPanicHandler(panicky.default_panic);

pub fn panic(msg: []const u8, error_return_trace: ?*std.builtin.StackTrace) noreturn {
    if (MainPanicHandler.Singleton) |singleton| {
        MainPanicHandler.handle_panic(msg, error_return_trace);
    } else {
        panicky.default_panic(msg, error_return_trace);
    }
}

var default_options = std.mem.zeroes(Schema.TransformOptions);

pub const Uint8Array = packed struct {
    pub const Float = @Type(builtin.TypeInfo{ .Float = .{ .bits = 2 * @bitSizeOf(usize) } });
    pub const Abi = if (builtin.target.isWasm()) Float else Uint8Array;

    ptr: [*]u8,
    len: usize,

    pub fn toSlice(raw: Abi) []u8 {
        const self = @bitCast(Uint8Array, raw);
        return self.ptr[0..self.len];
    }

    pub fn fromSlice(slice: []u8) Abi {
        const self = Uint8Array{ .ptr = slice.ptr, .len = slice.len };
        return @bitCast(Abi, self);
    }

    pub fn empty() Abi {
        return Uint8Array.fromSlice(&[0]u8{});
    }

    pub fn encode(comptime SchemaType: type, obj: SchemaType) !Abi {
        var list = std.ArrayList(u8).init(alloc.dynamic);
        var writer = list.writer();
        try obj.encode(writer);
        return Uint8Array.fromSlice(list.toOwnedSlice());
    }

    pub fn decode(self: Abi, comptime SchemaType: type) !SchemaType {
        var buf = Uint8Array.toSlice(self);
        var stream = std.io.fixedBufferStream(buf);
        return try SchemaType.decode(alloc.dynamic, stream.reader());
    }
};

pub fn constStrToU8(s: string) []u8 {
    return @intToPtr([*]u8, @ptrToInt(s.ptr))[0..s.len];
}

pub const Api = struct {
    options: *Schema.TransformOptions = &default_options,
    files: std.ArrayList(string),
    log: logger.Log,

    pub fn transform(self: *Api, request: Schema.Transform) !Schema.TransformResponse {
        const opts = try options.TransformOptions.initUncached(alloc.dynamic, request.path.?, request.contents.?);
        var source = logger.Source.initFile(opts.entry_point, alloc.dynamic);

        var ast: js_ast.Ast = undefined;
        var raw_defines = RawDefines.init(alloc.static);
        try raw_defines.put("process.env.NODE_ENV", "\"development\"");

        var user_defines = try DefineData.from_input(raw_defines, &self.log, alloc.static);
        var define = try Define.init(
            alloc.static,
            user_defines,
        );

        switch (opts.loader) {
            .json => {
                var expr = try json_parser.ParseJSON(&source, &self.log, alloc.dynamic);
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
                var parser = try js_parser.Parser.init(opts, &self.log, &source, define, alloc.dynamic);
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
            alloc.dynamic,
            ast,
            js_ast.Symbol.Map.initList(symbols),
            &source,
            false,
            js_printer.Options{ .to_module_ref = ast.module_ref orelse js_ast.Ref{ .inner_index = 0 } },
            &_linker,
        );
        var output_files = try alloc.dynamic.alloc(Schema.OutputFile, 1);
        var _data = printed.js[0..printed.js.len];
        var _path = constStrToU8(source.path.text);

        output_files[0] = Schema.OutputFile{ .data = _data, .path = _path };

        var resp = std.mem.zeroes(Schema.TransformResponse);
        resp.status = .success;
        resp.files = output_files;

        return resp;
        // var source = logger.Source.initFile(file: fs.File, allocator: *std.mem.Allocator)
    }
};

pub const Exports = struct {
    fn init() callconv(.C) u8 {
        if (alloc.needs_setup) {
            var arena = std.heap.ArenaAllocator.init(std.heap.page_allocator);
            var allocator = &arena.allocator;
            alloc.setup(allocator) catch return 0;
        }

        var _api = alloc.static.create(Api) catch return 0;

        _api.* = Api{ .files = std.ArrayList(string).init(alloc.dynamic), .log = logger.Log.init(alloc.dynamic) };
        api = _api;

        return 1;
    }

    fn transform(abi: Uint8Array.Abi) callconv(.C) Uint8Array.Abi {
        const req: Schema.Transform = Uint8Array.decode(abi, Schema.Transform) catch return Uint8Array.empty();
        alloc.dynamic.free(Uint8Array.toSlice(abi));
        const resp = api.?.transform(req) catch return Uint8Array.empty();
        return Uint8Array.encode(Schema.TransformResponse, resp) catch return Uint8Array.empty();
    }

    fn malloc(size: usize) callconv(.C) ?*c_void {
        if (size == 0) {
            return null;
        }
        //const result = alloc.dynamic.alloc(u8, size) catch return null;
        const result = alloc.dynamic.allocFn(alloc.dynamic, size, 1, 1, 0) catch return null;
        return result.ptr;
    }
    fn calloc(num_elements: usize, element_size: usize) callconv(.C) ?*c_void {
        const size = num_elements *% element_size;
        const c_ptr = @call(.{ .modifier = .never_inline }, malloc, .{size});
        if (c_ptr) |ptr| {
            const p = @ptrCast([*]u8, ptr);
            @memset(p, 0, size);
        }
        return c_ptr;
    }
    fn realloc(c_ptr: ?*c_void, new_size: usize) callconv(.C) ?*c_void {
        if (new_size == 0) {
            @call(.{ .modifier = .never_inline }, free, .{c_ptr});
            return null;
        } else if (c_ptr) |ptr| {
            // Use a synthetic slice
            const p = @ptrCast([*]u8, ptr);
            const result = alloc.dynamic.realloc(p[0..1], new_size) catch return null;
            return @ptrCast(*c_void, result.ptr);
        } else {
            return @call(.{ .modifier = .never_inline }, malloc, .{new_size});
        }
    }
    fn free(c_ptr: ?*c_void) callconv(.C) void {
        if (c_ptr) |ptr| {
            // Use a synthetic slice. zee_alloc will free via corresponding metadata.
            const p = @ptrCast([*]u8, ptr);
            //alloc.dynamic.free(p[0..1]);
            _ = alloc.dynamic.resizeFn(alloc.dynamic, p[0..1], 0, 0, 0, 0) catch unreachable;
        }
    }
};

comptime {
    @export(Exports.init, .{ .name = "init", .linkage = .Strong });
    @export(Exports.transform, .{ .name = "transform", .linkage = .Strong });
    @export(Exports.malloc, .{ .name = "malloc", .linkage = .Strong });
    @export(Exports.calloc, .{ .name = "calloc", .linkage = .Strong });
    @export(Exports.realloc, .{ .name = "realloc", .linkage = .Strong });
    @export(Exports.free, .{ .name = "free", .linkage = .Strong });
}

var api: ?*Api = null;
