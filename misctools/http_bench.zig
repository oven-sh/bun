const std = @import("std");
const bun = @import("bun");
const string = []const u8;
const Output = bun.Output;
const Global = bun.Global;
const Environment = bun.Environment;
const strings = bun.strings;
const MutableString = bun.MutableString;
const stringZ = [:0]const u8;
const default_allocator = bun.default_allocator;
const clap = @import("../src/deps/zig-clap/clap.zig");

const URL = @import("../src/url.zig").URL;
const Method = @import("../src/http/Method.zig").Method;
const ColonListType = @import("../src/cli/colon_list_type.zig").ColonListType;
const HeadersTuple = ColonListType(string, noop_resolver);
const path_handler = @import("../src/resolver/resolve_path.zig");

fn noop_resolver(in: string) !string {
    return in;
}

const VERSION = "0.0.0";

const params = [_]clap.Param(clap.Help){
    clap.parseParam("-v, --verbose              Show headers & status code") catch unreachable,
    clap.parseParam("-H, --header <STR>...      Add a header") catch unreachable,
    clap.parseParam("-r, --max-redirects <STR>  Maximum number of redirects to follow (default: 128)") catch unreachable,
    clap.parseParam("-b, --body <STR>           HTTP request body as a string") catch unreachable,
    clap.parseParam("-f, --file <STR>           File path to load as body") catch unreachable,
    clap.parseParam("-n, --count <INT>          How many runs? Default 10") catch unreachable,
    clap.parseParam("-r, --retry <INT>          Max retry count") catch unreachable,
    clap.parseParam("--no-gzip                  Disable gzip") catch unreachable,
    clap.parseParam("--no-deflate               Disable deflate") catch unreachable,
    clap.parseParam("--no-compression           Disable gzip & deflate") catch unreachable,
    clap.parseParam("--version                  Print the version and exit") catch unreachable,
    clap.parseParam("--turbo                    Skip sending TLS shutdown signals") catch unreachable,
    clap.parseParam("--repeat <INT>             Repeat N times") catch unreachable,
    clap.parseParam("--max-concurrency <INT>    Max concurrent") catch unreachable,
    clap.parseParam("<POS>...                          ") catch unreachable,
};

const MethodNames = std.ComptimeStringMap(Method, .{
    .{ "GET", Method.GET },
    .{ "get", Method.GET },

    .{ "POST", Method.POST },
    .{ "post", Method.POST },

    .{ "PUT", Method.PUT },
    .{ "put", Method.PUT },

    .{ "PATCH", Method.PATCH },
    .{ "patch", Method.PATCH },

    .{ "OPTIONS", Method.OPTIONS },
    .{ "options", Method.OPTIONS },

    .{ "HEAD", Method.HEAD },
    .{ "head", Method.HEAD },
});

var file_path_buf: bun.PathBuffer = undefined;
var cwd_buf: bun.PathBuffer = undefined;

pub const Arguments = struct {
    url: URL,
    method: Method,
    verbose: bool = false,
    headers: Headers.Entries,
    headers_buf: string,
    body: string = "",
    turbo: bool = false,
    count: usize = 10,
    repeat: usize = 0,
    concurrency: u16 = 32,

    pub fn parse(allocator: std.mem.Allocator) !Arguments {
        var diag = clap.Diagnostic{};

        var args = clap.parse(clap.Help, &params, .{
            .diagnostic = &diag,
            .allocator = allocator,
        }) catch |err| {
            // Report useful error and exit
            diag.report(Output.errorWriter(), err) catch {};
            return err;
        };

        const positionals = args.positionals();
        var raw_args: std.ArrayListUnmanaged(string) = undefined;

        if (positionals.len > 0) {
            raw_args = .{ .capacity = positionals.len, .items = @as([*][]const u8, @ptrFromInt(@intFromPtr(positionals.ptr)))[0..positionals.len] };
        } else {
            raw_args = .{};
        }

        if (args.flag("--version")) {
            try Output.writer().writeAll(VERSION);
            Global.exit(0);
        }

        var method = Method.GET;
        var url: URL = .{};
        var body_string: string = args.option("--body") orelse "";

        if (args.option("--file")) |file_path| {
            if (file_path.len > 0) {
                const cwd = try std.process.getCwd(&cwd_buf);
                var parts = [_]string{file_path};
                const absolute_path = path_handler.joinAbsStringBuf(cwd, &file_path_buf, &parts, .auto);
                file_path_buf[absolute_path.len] = 0;
                file_path_buf[absolute_path.len + 1] = 0;
                const absolute_path_len = absolute_path.len;
                const absolute_path_ = file_path_buf[0..absolute_path_len :0];

                var body_file = std.fs.openFileAbsoluteZ(absolute_path_, .{ .mode = .read_only }) catch |err| {
                    Output.printErrorln("<r><red>{s}<r> opening file {s}", .{ @errorName(err), absolute_path });
                    Global.exit(1);
                };

                const file_contents = body_file.readToEndAlloc(allocator, try body_file.getEndPos()) catch |err| {
                    Output.printErrorln("<r><red>{s}<r> reading file {s}", .{ @errorName(err), absolute_path });
                    Global.exit(1);
                };
                body_string = file_contents;
            }
        }

        {
            var raw_arg_i: usize = 0;
            while (raw_arg_i < raw_args.items.len) : (raw_arg_i += 1) {
                const arg = raw_args.items[raw_arg_i];
                if (MethodNames.get(arg[0..])) |method_| {
                    method = method_;
                    _ = raw_args.swapRemove(raw_arg_i);
                }
            }

            if (raw_args.items.len == 0) {
                Output.prettyErrorln("<r><red>error<r><d>:<r> <b>Missing URL<r>\n\nExample:\n<r><b>fetch GET https://example.com<r>\n\n<b>fetch example.com/foo<r>\n\n", .{});
                Global.exit(1);
            }

            const url_position = raw_args.items.len - 1;
            url = URL.parse(raw_args.swapRemove(url_position));
            if (!url.isAbsolute()) {
                Output.prettyErrorln("<r><red>error<r><d>:<r> <b>Invalid URL<r>\n\nExample:\n<r><b>fetch GET https://example.com<r>\n\n<b>fetch example.com/foo<r>\n\n", .{});
                Global.exit(1);
            }
        }

        return Arguments{
            .url = url,
            .method = method,
            .verbose = args.flag("--verbose"),
            .headers = .{},
            .headers_buf = "",
            .body = body_string,
            // .keep_alive = !args.flag("--no-keep-alive"),
            .concurrency = std.fmt.parseInt(u16, args.option("--max-concurrency") orelse "32", 10) catch 32,
            .turbo = args.flag("--turbo"),
            .count = std.fmt.parseInt(usize, args.option("--count") orelse "10", 10) catch |err| {
                Output.prettyErrorln("<r><red>{s}<r> parsing count", .{@errorName(err)});
                Global.exit(1);
            },
        };
    }
};

const HTTP = bun.http;
const NetworkThread = HTTP.NetworkThread;

var stdout_: std.fs.File = undefined;
var stderr_: std.fs.File = undefined;
pub fn main() anyerror!void {
    stdout_ = std.io.getStdOut();
    stderr_ = std.io.getStdErr();
    var output_source = Output.Source.init(stdout_, stderr_);
    Output.Source.set(&output_source);

    defer Output.flush();

    const args = try Arguments.parse(default_allocator);

    var channel = try default_allocator.create(HTTP.HTTPChannel);
    channel.* = HTTP.HTTPChannel.init();

    try channel.buffer.ensureTotalCapacity(args.count);

    try NetworkThread.init();
    if (args.concurrency > 0) HTTP.AsyncHTTP.max_simultaneous_requests.store(args.concurrency, .monotonic);
    const Group = struct {
        response_body: MutableString = undefined,
        context: HTTP.HTTPChannelContext = undefined,
    };
    const Batch = bun.ThreadPool.Batch;
    var groups = try default_allocator.alloc(Group, args.count);
    var repeat_i: usize = 0;
    while (repeat_i < args.repeat + 1) : (repeat_i += 1) {
        var i: usize = 0;
        var batch = Batch{};
        while (i < args.count) : (i += 1) {
            groups[i] = Group{};
            const response_body = &groups[i].response_body;
            response_body.* = try MutableString.init(default_allocator, 1024);

            var ctx = &groups[i].context;
            ctx.* = .{
                .channel = channel,
                .http = try HTTP.AsyncHTTP.init(
                    default_allocator,
                    args.method,
                    args.url,
                    args.headers,
                    args.headers_buf,
                    response_body,
                    "",
                ),
            };
            ctx.http.client.verbose = args.verbose;
            ctx.http.callback = HTTP.HTTPChannelContext.callback;
            ctx.http.schedule(default_allocator, &batch);
        }
        NetworkThread.global.schedule(batch);

        var read_count: usize = 0;
        var success_count: usize = 0;
        var fail_count: usize = 0;
        var min_duration: usize = std.math.maxInt(usize);
        var max_duration: usize = 0;
        var timer = try std.time.Timer.start();
        while (read_count < args.count) {
            const http = channel.readItem() catch continue;
            read_count += 1;

            Output.printElapsed(@as(f64, @floatCast(@as(f128, @floatFromInt(http.elapsed)) / std.time.ns_per_ms)));
            if (http.response) |resp| {
                if (resp.status_code == 200) {
                    success_count += 1;
                } else {
                    fail_count += 1;
                }

                max_duration = @max(max_duration, http.elapsed);
                min_duration = @min(min_duration, http.elapsed);

                switch (resp.status_code) {
                    200, 202, 302 => {
                        Output.prettyError(" <r><green>{d}<r>", .{resp.status_code});
                    },
                    else => {
                        Output.prettyError(" <r><red>{d}<r>", .{resp.status_code});
                    },
                }

                if (http.gzip_elapsed > 0) {
                    Output.prettyError(" <d>{s}<r><d> - {s}<r> <d>({d} bytes, ", .{
                        @tagName(http.client.method),
                        http.client.url.href,
                        http.response_buffer.list.items.len,
                    });
                    Output.printElapsed(@as(f64, @floatCast(@as(f128, @floatFromInt(http.gzip_elapsed)) / std.time.ns_per_ms)));
                    Output.prettyError("<d> gzip)<r>\n", .{});
                } else {
                    Output.prettyError(" <d>{s}<r><d> - {s}<r> <d>({d} bytes)<r>\n", .{
                        @tagName(http.client.method),
                        http.client.url.href,
                        http.response_buffer.list.items.len,
                    });
                }
            } else if (http.err) |err| {
                fail_count += 1;
                Output.printError(" err: {s}\n", .{@errorName(err)});
            } else {
                fail_count += 1;
                Output.prettyError(" Uh-oh: {s}\n", .{@tagName(http.state.raw)});
            }

            Output.flush();
        }
        Output.prettyErrorln("\n<d>------<r>\n\n", .{});
        Output.prettyErrorln("Success: <b><green>{d}<r>\nFailure: <b><red>{d}<r>\n\n", .{
            success_count,
            fail_count,
        });

        Output.printElapsed(@as(f64, @floatCast(@as(f128, @floatFromInt(timer.read())) / std.time.ns_per_ms)));
        Output.prettyErrorln(" {d} requests", .{
            read_count,
        });
        Output.flush();
    }
}
