const JSParser = bun.js_parser;
const JSPrinter = bun.js_printer;
const JSAst = bun.JSAst;
const Api = @import("./api/schema.zig").Api;
const Logger = @import("root").bun.logger;
const global = @import("root").bun;
const default_allocator = global.default_allocator;
const std = @import("std");
const Define = @import("./defines.zig");
const Options = @import("./options.zig");
const ApiWriter = @import("./api/schema.zig").Writer;
const ApiReader = @import("./api/schema.zig").Reader;
const ImportKind = @import("./import_record.zig").ImportKind;
const Output = global.Output;

export var code_buffer_ptr: ?[*]const u8 = null;
pub const bindgen = true;
const Main = @This();
pub const os = struct {
    pub const c = Main.system;
    pub const system = Main.system;
};

pub extern fn console_error(slice: u64) void;
pub extern fn console_log(slice: u64) void;
pub extern fn console_warn(slice: u64) void;
pub extern fn console_info(slice: u64) void;
pub const Uint8Array = extern struct {
    ptr: ?[*]const u8 = null,
    len: usize = 0,

    pub fn fromSlice(slice: []const u8) u64 {
        return @bitCast(u64, [2]u32{
            @ptrToInt(slice.ptr),
            slice.len,
        });
    }

    pub fn fromJS(data: u64) []u8 {
        const ptrs = @bitCast([2]u32, data);
        return @intToPtr([*]u8, ptrs[0])[0..ptrs[1]];
    }
};

pub const system = struct {
    pub const fd_t = i32;
    pub const sockaddr = fd_t;
    pub const mode_t = fd_t;
    pub const E = enum(u8) {
        SUCCESS = 0,
        EPERM = 1,
        ENOENT = 2,
        ESRCH = 3,
        EINTR = 4,
        EIO = 5,
        ENXIO = 6,
        E2BIG = 7,
        ENOEXEC = 8,
        EBADF = 9,
        ECHILD = 10,
        EDEADLK = 11,
        ENOMEM = 12,
        EACCES = 13,
        EFAULT = 14,
        ENOTBLK = 15,
        EBUSY = 16,
        EEXIST = 17,
        EXDEV = 18,
        ENODEV = 19,
        ENOTDIR = 20,
        EISDIR = 21,
        EINVAL = 22,
        ENFILE = 23,
        EMFILE = 24,
        ENOTTY = 25,
        ETXTBSY = 26,
        EFBIG = 27,
        ENOSPC = 28,
        ESPIPE = 29,
        EROFS = 30,
        EMLINK = 31,
        EPIPE = 32,
        EDOM = 33,
        ERANGE = 34,
        EAGAIN = 35,
        EINPROGRESS = 36,
        EALREADY = 37,
        ENOTSOCK = 38,
        EDESTADDRREQ = 39,
        EMSGSIZE = 40,
        EPROTOTYPE = 41,
        ENOPROTOOPT = 42,
        EPROTONOSUPPORT = 43,
        ESOCKTNOSUPPORT = 44,
        ENOTSUP = 45,
        EPFNOSUPPORT = 46,
        EAFNOSUPPORT = 47,
        EADDRINUSE = 48,
        EADDRNOTAVAIL = 49,
        ENETDOWN = 50,
        ENETUNREACH = 51,
        ENETRESET = 52,
        ECONNABORTED = 53,
        ECONNRESET = 54,
        ENOBUFS = 55,
        EISCONN = 56,
        ENOTCONN = 57,
        ESHUTDOWN = 58,
        ETOOMANYREFS = 59,
        ETIMEDOUT = 60,
        ECONNREFUSED = 61,
        ELOOP = 62,
        ENAMETOOLONG = 63,
        EHOSTDOWN = 64,
        EHOSTUNREACH = 65,
        ENOTEMPTY = 66,
        EPROCLIM = 67,
        EUSERS = 68,
        EDQUOT = 69,
        ESTALE = 70,
        EREMOTE = 71,
        EBADRPC = 72,
        ERPCMISMATCH = 73,
        EPROGUNAVAIL = 74,
        EPROGMISMATCH = 75,
        EPROCUNAVAIL = 76,
        ENOLCK = 77,
        ENOSYS = 78,
        EFTYPE = 79,
        EAUTH = 80,
        ENEEDAUTH = 81,
        EPWROFF = 82,
        EDEVERR = 83,
        EOVERFLOW = 84,
        EBADEXEC = 85,
        EBADARCH = 86,
        ESHLIBVERS = 87,
        EBADMACHO = 88,
        ECANCELED = 89,
        EIDRM = 90,
        ENOMSG = 91,
        EILSEQ = 92,
        ENOATTR = 93,
        EBADMSG = 94,
        EMULTIHOP = 95,
        ENODATA = 96,
        ENOLINK = 97,
        ENOSR = 98,
        ENOSTR = 99,
        EPROTO = 100,
        ETIME = 101,
        EOPNOTSUPP = 102,
        ENOPOLICY = 103,
        ENOTRECOVERABLE = 104,
        EOWNERDEAD = 105,
        EQFULL = 106,
    };
};

export fn cycleStart() void {}
export fn cycleEnd() void {}

var transform_response: Api.TransformResponse = std.mem.zeroes(Api.TransformResponse);
var output_files: [1]Api.OutputFile = undefined;
var buffer_writer: JSPrinter.BufferWriter = undefined;
var writer: JSPrinter.BufferPrinter = undefined;
var define: *Define.Define = undefined;
export fn bun_malloc(size: usize) u64 {
    return @bitCast(u64, [2]u32{
        @ptrToInt((default_allocator.alloc(u8, size) catch unreachable).ptr),
        size,
    });
}

export fn bun_free(bytes: u64) void {
    default_allocator.free(Uint8Array.fromJS(bytes));
}

var output_stream_buf: [16384]u8 = undefined;
var output_stream = std.io.fixedBufferStream(&output_stream_buf);
var error_stream_buf: [16384]u8 = undefined;
var error_stream = std.io.fixedBufferStream(&error_stream_buf);
var output_source: global.Output.Source = undefined;
export fn init() void {
    const Mimalloc = @import("./allocators/mimalloc.zig");
    // reserve 256 MB upfront
    Mimalloc.mi_option_set(Mimalloc.mi_option_t.allow_decommit, 0);
    Mimalloc.mi_option_set(Mimalloc.mi_option_t.limit_os_alloc, 1);
    _ = Mimalloc.mi_reserve_os_memory(2.56e+8, false, true);

    output_source = global.Output.Source.init(output_stream, error_stream);
    global.Output.Source.set(&output_source);
    JSAst.Stmt.Data.Store.create(default_allocator);
    JSAst.Expr.Data.Store.create(default_allocator);
    buffer_writer = JSPrinter.BufferWriter.init(default_allocator) catch unreachable;
    buffer_writer.buffer.growBy(1024) catch unreachable;
    writer = JSPrinter.BufferPrinter.init(buffer_writer);
    define = Define.Define.init(default_allocator, null, null) catch unreachable;
}
const Arena = @import("./mimalloc_arena.zig").Arena;

var log: Logger.Log = undefined;

export fn transform(opts_array: u64) u64 {
    // var arena = std.heap.ArenaAllocator.init(default_allocator);
    var arena = Arena.init() catch unreachable;
    var allocator = arena.allocator();
    defer arena.deinit();
    log = Logger.Log.init(allocator);

    var reader = ApiReader.init(Uint8Array.fromJS(opts_array), allocator);
    var opts = Api.Transform.decode(&reader) catch unreachable;
    const loader_ = opts.loader orelse Api.Loader.tsx;

    defer {
        JSAst.Stmt.Data.Store.reset();
        JSAst.Expr.Data.Store.reset();
    }
    const loader: Options.Loader = switch (loader_) {
        .jsx => Options.Loader.jsx,
        .js => Options.Loader.js,
        .ts => Options.Loader.ts,
        .tsx => Options.Loader.tsx,
        else => .file,
    };
    const path = opts.path orelse loader.stdinName();
    var code = Logger.Source.initPathString(path, opts.contents);
    code.contents_is_recycled = true;

    var parser = JSParser.Parser.init(.{
        .jsx = .{},
    }, &log, &code, define, allocator) catch unreachable;
    parser.options.jsx.parse = loader.isJSX();
    parser.options.ts = loader.isTypeScript();
    parser.options.tree_shaking = false;
    parser.options.features.top_level_await = true;
    const result = parser.parse() catch unreachable;
    if (result.ok) {
        var symbols: [][]JSAst.Symbol = &([_][]JSAst.Symbol{result.ast.symbols});

        _ = JSPrinter.printAst(
            @TypeOf(&writer),
            &writer,
            result.ast,
            JSAst.Symbol.Map.initList(symbols),
            &code,
            false,
            .{},
            void,
            null,
            false,
        ) catch 0;

        output_files[0] = .{ .data = writer.ctx.written, .path = path };
        writer.ctx.reset();
        writer.written = 0;
        buffer_writer = writer.ctx;
    } else {
        output_files[0] = .{ .data = "", .path = path };
    }

    transform_response = Api.TransformResponse{
        .status = if (result.ok) Api.TransformResponseStatus.success else Api.TransformResponseStatus.fail,
        .files = &output_files,
        .errors = (log.toAPI(allocator) catch unreachable).msgs,
    };

    var output = std.ArrayList(u8).init(default_allocator);
    var output_writer = output.writer();
    const Encoder = ApiWriter(@TypeOf(output_writer));
    var encoder = Encoder.init(output_writer);
    transform_response.encode(&encoder) catch unreachable;
    return @bitCast(u64, [2]u32{ @ptrToInt(output.items.ptr), output.items.len });
}

export fn scan(opts_array: u64) u64 {
    // var arena = std.heap.ArenaAllocator.init(default_allocator);
    var arena = Arena.init() catch unreachable;
    var allocator = arena.allocator();
    defer arena.deinit();
    log = Logger.Log.init(allocator);

    var reader = ApiReader.init(Uint8Array.fromJS(opts_array), allocator);
    var opts = Api.Scan.decode(&reader) catch unreachable;
    const loader_ = opts.loader orelse Api.Loader.tsx;

    defer {
        JSAst.Stmt.Data.Store.reset();
        JSAst.Expr.Data.Store.reset();
    }
    const loader: Options.Loader = switch (loader_) {
        .jsx => Options.Loader.jsx,
        .js => Options.Loader.js,
        .ts => Options.Loader.ts,
        .tsx => Options.Loader.tsx,
        else => .file,
    };
    const path = opts.path orelse loader.stdinName();
    var code = Logger.Source.initPathString(path, opts.contents);
    code.contents_is_recycled = true;

    var parser = JSParser.Parser.init(.{
        .jsx = .{},
    }, &log, &code, define, allocator) catch unreachable;
    parser.options.jsx.parse = loader.isJSX();
    parser.options.ts = loader.isTypeScript();
    parser.options.features.top_level_await = true;
    const result = parser.parse() catch unreachable;
    var scan_result = std.mem.zeroes(Api.ScanResult);
    var output = std.ArrayList(u8).init(default_allocator);
    var output_writer = output.writer();
    const Encoder = ApiWriter(@TypeOf(output_writer));

    if (result.ok) {
        var scanned_imports = allocator.alloc(Api.ScannedImport, result.ast.import_records.len) catch unreachable;
        var scanned_i: usize = 0;
        for (result.ast.import_records) |import_record| {
            if (import_record.kind == .internal) continue;
            scanned_imports[scanned_i] = Api.ScannedImport{ .path = import_record.path.text, .kind = import_record.kind.toAPI() };
            scanned_i += 1;
        }

        scan_result = Api.ScanResult{ .exports = result.ast.named_exports.keys(), .imports = scanned_imports[0..scanned_i] };
    }

    var encoder = Encoder.init(output_writer);
    scan_result.encode(&encoder) catch unreachable;
    return @bitCast(u64, [2]u32{ @ptrToInt(output.items.ptr), output.items.len });
}

// pub fn main() anyerror!void {}

export fn emsc_main() void {
    _ = emsc_main;
    _ = cycleEnd;
    _ = cycleStart;
    _ = transform;
    _ = bun_free;
    _ = bun_malloc;
}

comptime {
    _ = emsc_main;
    _ = cycleEnd;
    _ = cycleStart;
    _ = transform;
    _ = bun_free;
    _ = scan;
    _ = bun_malloc;
}
