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
// const zee = @import("zee_alloc.zig");

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
        const res = try SchemaType.decode(alloc.dynamic, stream.reader());
        return res;
    }
};

pub fn constStrToU8(s: string) []u8 {
    return @intToPtr([*]u8, @ptrToInt(s.ptr))[0..s.len];
}

pub const Api = struct {
    options: *Schema.TransformOptions = &default_options,
    files: std.ArrayList(string),
    log: logger.Log,
    defines: ?*Define = null,

    pub fn transform(self: *Api, request: Schema.Transform) !Schema.TransformResponse {
        const opts = try options.TransformOptions.initUncached(alloc.dynamic, request.path.?, request.contents);
        var source = logger.Source.initFile(opts.entry_point, alloc.dynamic);

        var ast: js_ast.Ast = undefined;
        if (self.defines == null) {
            var raw_defines = RawDefines.init(alloc.static);
            raw_defines.put("process.env.NODE_ENV", "\"development\"") catch unreachable;

            var user_defines = try DefineData.from_input(raw_defines, &self.log, alloc.static);
            self.defines = try Define.init(
                alloc.static,
                user_defines,
            );
        }

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
                var parser = try js_parser.Parser.init(opts, &self.log, &source, self.defines.?, alloc.dynamic);
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
        // Output.print("Parts count: {d}", .{ast.parts.len});
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

pub extern fn console_log(abi: Uint8Array.Abi) void;
pub extern fn console_error(abi: Uint8Array.Abi) void;
pub extern fn console_warn(abi: Uint8Array.Abi) void;
pub extern fn console_info(abi: Uint8Array.Abi) void;

// const ZeeAlloc = zee.ZeeAlloc(.{});
// var zee_instance: ZeeAlloc = undefined;
// const Gpa = std.heap.GeneralPurposeAllocator(.{});
// var arena: std.heap.ArenaAllocator = undefined;
// var gpa: Gpa = undefined;
var hunk: alloc.Hunk = undefined;
var hunk_high: alloc.HunkSide = undefined;
var hunk_low: alloc.HunkSide = undefined;
var perma_hunk: alloc.Hunk = undefined;
var perma_hunk_high_alloc: *std.mem.Allocator = undefined;
var perma_hunk_high: alloc.HunkSide = undefined;
var perma_hunk_low_alloc: *std.mem.Allocator = undefined;
var perma_hunk_low: alloc.HunkSide = undefined;
var last_start_high: usize = 0;
var last_start_low: usize = 0;
pub const Exports = struct {
    fn init() callconv(.C) i32 {
        var perma_hunk_buf = std.heap.page_allocator.alloc(u8, 128000) catch return -1;
        perma_hunk = alloc.Hunk.init(perma_hunk_buf);
        perma_hunk_high = perma_hunk.high();
        perma_hunk_low = perma_hunk.low();

        perma_hunk_high_alloc = &perma_hunk_low.allocator;

        // var gpa = Gpa{};
        // var allocator = &gpa.allocator;
        // alloc.setup(allocator) catch return -1;
        var out_buffer = perma_hunk_low.allocator.alloc(u8, 4096) catch return -1;
        var err_buffer = perma_hunk_low.allocator.alloc(u8, 4096) catch return -1;
        var output = perma_hunk_low.allocator.create(Output.Source) catch return -1;
        var stream = std.io.fixedBufferStream(out_buffer);
        var err_stream = std.io.fixedBufferStream(err_buffer);
        output.* = Output.Source.init(
            stream,
            err_stream,
        );
        output.out_buffer = out_buffer;
        output.err_buffer = err_buffer;
        Output.Source.set(output);

        var _api = std.heap.page_allocator.create(Api) catch return -1;
        _api.* = Api{ .files = std.ArrayList(string).init(std.heap.page_allocator), .log = logger.Log.init(std.heap.page_allocator) };
        api = _api;

        _ = MainPanicHandler.init(&api.?.log);

        // This will need more thought.
        var raw_defines = RawDefines.init(std.heap.page_allocator);
        raw_defines.put("process.env.NODE_ENV", "\"development\"") catch return -1;
        var user_defines = DefineData.from_input(raw_defines, &_api.log, std.heap.page_allocator) catch return -1;
        _api.defines = Define.init(
            std.heap.page_allocator,
            user_defines,
        ) catch return -1;

        if (alloc.needs_setup) {
            var buf = std.heap.page_allocator.alloc(u8, 26843545) catch return -1;
            hunk = alloc.Hunk.init(buf);
            hunk_high = hunk.high();
            hunk_low = hunk.low();
            alloc.dynamic = &hunk_high.allocator;
            alloc.static = &hunk_low.allocator;
            alloc.needs_setup = false;
        }

        Output.printErrorable("Initialized.", .{}) catch |err| {
            var name = alloc.static.alloc(u8, @errorName(err).len) catch unreachable;
            std.mem.copy(u8, name, @errorName(err));
            console_error(Uint8Array.fromSlice(name));
        };

        return 1;
    }

    fn transform(abi: Uint8Array.Abi) callconv(.C) Uint8Array.Abi {
        // Output.print("Received {d}", .{abi});
        const req: Schema.Transform = Uint8Array.decode(abi, Schema.Transform) catch return Uint8Array.empty();
        // Output.print("Req {s}", .{req});
        // alloc.dynamic.free(Uint8Array.toSlice(abi));
        const resp = api.?.transform(req) catch return Uint8Array.empty();

        var res = Uint8Array.encode(Schema.TransformResponse, resp) catch return Uint8Array.empty();

        return res;
    }

    // Reset
    fn cycleStart() callconv(.C) void {
        last_start_high = hunk.getHighMark();
        last_start_low = hunk.getLowMark();
    }

    fn cycleEnd() callconv(.C) void {
        if (last_start_high > 0) {
            hunk.freeToHighMark(last_start_high);
            last_start_high = 0;
        }

        if (last_start_low > 0) {
            hunk.freeToLowMark(last_start_low);
            last_start_low = 0;
        }
    }

    fn malloc(size: usize) callconv(.C) Uint8Array.Abi {
        if (size == 0) {
            return 0;
        }
        const result = alloc.dynamic.alloc(u8, size) catch unreachable;
        return Uint8Array.fromSlice(result);
    }
    // fn calloc(num_elements: usize, element_size: usize) callconv(.C) ?*c_void {
    //     const size = num_elements *% element_size;
    //     const c_ptr = @call(.{ .modifier = .never_inline }, malloc, .{size});
    //     if (c_ptr) |ptr| {
    //         const p = @ptrCast([*]u8, ptr);
    //         @memset(p, 0, size);
    //     }
    //     return c_ptr;
    // }
    // fn realloc(c_ptr: ?*c_void, new_size: usize) callconv(.C) ?*c_void {
    //     if (new_size == 0) {
    //         // @call(.{ .modifier = .never_inline }, free, .{@intCast(Uint8Array.Abi, c_ptr.?)});
    //         return null;
    //     } else if (c_ptr) |ptr| {
    //         // Use a synthetic slice
    //         const p = @ptrCast([*]u8, ptr);
    //         const result = alloc.dynamic.realloc(p[0..1], new_size) catch return null;
    //         return @ptrCast(*c_void, result.ptr);
    //     } else {
    //         return @call(.{ .modifier = .never_inline }, malloc, .{new_size});
    //     }
    // }
    fn free(abi: Uint8Array.Abi) callconv(.C) void {
        alloc.dynamic.free(Uint8Array.toSlice(abi));
    }
};

var api: ?*Api = null;

comptime {
    @export(Exports.init, .{ .name = "init", .linkage = .Strong });
    @export(Exports.transform, .{ .name = "transform", .linkage = .Strong });
    @export(Exports.malloc, .{ .name = "malloc", .linkage = .Strong });
    // @export(Exports.calloc, .{ .name = "calloc", .linkage = .Strong });
    // @export(Exports.realloc, .{ .name = "realloc", .linkage = .Strong });
    @export(Exports.cycleStart, .{ .name = "cycleStart", .linkage = .Strong });
    @export(Exports.cycleEnd, .{ .name = "cycleEnd", .linkage = .Strong });
    @export(Exports.free, .{ .name = "free", .linkage = .Strong });
}

pub fn main() anyerror!void {
    std.mem.doNotOptimizeAway(Exports.init);
    std.mem.doNotOptimizeAway(Exports.transform);
    std.mem.doNotOptimizeAway(Exports.malloc);
    // std.mem.doNotOptimizeAway(Exports.calloc);
    // std.mem.doNotOptimizeAway(Exports.realloc);
    std.mem.doNotOptimizeAway(Exports.free);
}
