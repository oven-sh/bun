// const c = @import("./c.zig");
const std = @import("std");
usingnamespace @import("global.zig");
const Address = std.net.Address;
const routez = @import("routez");
const Request = routez.Request;
const Response = routez.Response;

pub const Server = struct {
    pub fn start(allocator: *std.mem.Allocator) !void {
        var server = routez.Server.init(
            allocator,
            .{},
            .{
                routez.all("/", indexHandler),
                routez.get("/about", aboutHandler),
                routez.get("/about/more", aboutHandler2),
                routez.get("/post/{post_num}/?", postHandler),
                routez.static("./", "/static"),
                routez.all("/counter", counterHandler),
            },
        );
        var addr = Address.parseIp("127.0.0.1", 8080) catch unreachable;
        server.listen(addr) catch unreachable;
    }
};

fn indexHandler(req: Request, res: Response) !void {
    try res.write("hi\n");
}

fn aboutHandler(req: Request, res: Response) !void {
    try res.write("Hello from about\n");
}

fn aboutHandler2(req: Request, res: Response) !void {
    try res.write("Hello from about2\n");
}

fn postHandler(req: Request, res: Response, args: *const struct {
    post_num: []const u8,
}) !void {
    try res.print("Hello from post, post_num is {s}\n", .{args.post_num});
}

var counter = std.atomic.Int(usize).init(0);
fn counterHandler(req: Request, res: Response) !void {
    try res.print("Page loaded {d} times\n", .{counter.fetchAdd(1)});
}

// pub const Server = struct {
//     pub var server = std.mem.zeroes(c.struct_mg_callbacks);

//     pub fn beginRequest(conn: ?*c.struct_mg_connection) callconv(.C) c_int {
//         return 0;
//     }
//     pub fn endRequest(conn: ?*const c.struct_mg_connection, status_code: c_int) callconv(.C) void {}
//     pub fn logMessage(conn: ?*const c.struct_mg_connection, msg: [*c]const u8) callconv(.C) c_int {
//         return 1;
//     }
//     pub fn logAccess(conn: ?*const c.struct_mg_connection, msg: [*c]const u8) callconv(.C) c_int {
//         return 1;
//     }
//     // pub fn initSsl(conn: ?*c_void, ?*c_void) callconv(.C) c_int
//     // pub fn initSslDomain(conn: [*c]const u8, ?*c_void, ?*c_void) callconv(.C) c_int
//     // pub fn externalSslCtx(ctx: [*c]?*c_void, ?*c_void) callconv(.C) c_int
//     // pub fn externalSslCtxDomain(ctx: [*c]const u8, [*c]?*c_void, ?*c_void) callconv(.C) c_int
//     // pub fn connectionClose(conn: ?*const c.struct_mg_connection) callconv(.C) void
//     // pub fn connectionClosed(conn: ?*const c.struct_mg_connection) callconv(.C) void
//     // pub fn initLua(conn: ?*const c.struct_mg_connection, ?*c_void, c_uint) callconv(.C) void
//     // pub fn exitLua(conn: ?*const c.struct_mg_connection, ?*c_void, c_uint) callconv(.C) void
//     pub fn httpError(conn: ?*c.struct_mg_connection, status: c_int, msg: [*c]const u8) callconv(.C) c_int {
//         return 0;
//     }
//     pub fn handleCodeRequest(conn: ?*c.struct_mg_connection, cbdata: ?*c_void) c_int {
//         var buf = "helloooo";
//         var buf_slice = buf[0.. :0];
//         // c.mg_write(conn, &buf_slice, buf_slice.len);
//         c.mg_send_http_ok(conn, "text/plain", buf_slice.len);
//         return 200;
//     }
//     pub fn initContext(ctx: *c.struct_mg_context) callconv(.C) void {
//         c.mg_set_request_handler(ctx, "/_src/", &handleCodeRequest, null);
//     }
//     pub fn exitContext(ctx: *c.struct_mg_context) callconv(.C) void {}
//     pub fn initThread(ctx: *c.struct_mg_context, thread_type: c_int) callconv(.C) ?*c_void {}
//     pub fn exitThread(ctx: *c.struct_mg_context, thread_type: c_int, user_ptr: ?*c_void) callconv(.C) void {}

//     // pub fn initConnection(ctx: ?*const c.struct_mg_connection, [*c]?*c_void) callconv(.C) c_int {

//     // }

//     pub fn start() !void {
//         // server.
//         server.begin_request = &beginRequest;
//         server.end_request = &endRequest;
//         server.log_message = &logMessage;
//         server.log_access = &logAccess;
//         server.http_error = &httpError;
//         server.init_context = &initContext;
//         server.exit_context = &exitContext;
//         server.init_thread = &initThread;
//         server.exit_thread = &exitThread;
//         const val = c.mg_init_library(c.MG_FEATURES_COMPRESSION);
//         // callbacks.log_access
//         var opts = [_:null][*c]const u8{
//             "listening_ports",
//             "4086",
//             "request_timeout_ms",
//             "10000",
//             "error_log_file",
//             "error.log",
//             "enable_auth_domain_check",
//             "no",
//         };

//         c.mg_start(&server, 0, opts);
//     }
// };
