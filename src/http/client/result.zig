const bun = @import("root").bun;
const JSC = bun.JSC;
const MutableString = bun.MutableString;
const HTTPResponseMetadata = @import("./metadata.zig").HTTPResponseMetadata;
const CertificateInfo = @import("./certificate_info.zig").CertificateInfo;
const AsyncHTTP = @import("./async_http.zig").AsyncHTTP;
pub const HTTPClientResult = struct {
    body: ?*MutableString = null,
    has_more: bool = false,
    redirected: bool = false,
    can_stream: bool = false,

    fail: ?anyerror = null,

    /// Owns the response metadata aka headers, url and status code
    metadata: ?HTTPResponseMetadata = null,

    /// For Http Client requests
    /// when Content-Length is provided this represents the whole size of the request
    /// If chunked encoded this will represent the total received size (ignoring the chunk headers)
    /// If is not chunked encoded and Content-Length is not provided this will be unknown
    body_size: BodySize = .unknown,
    certificate_info: ?CertificateInfo = null,

    pub fn abortReason(this: *const HTTPClientResult) ?JSC.CommonAbortReason {
        if (this.isTimeout()) {
            return .Timeout;
        }

        if (this.isAbort()) {
            return .UserAbort;
        }

        return null;
    }

    pub const BodySize = union(enum) {
        total_received: usize,
        content_length: usize,
        unknown: void,
    };

    pub fn isSuccess(this: *const HTTPClientResult) bool {
        return this.fail == null;
    }

    pub fn isTimeout(this: *const HTTPClientResult) bool {
        return if (this.fail) |e| e == error.Timeout else false;
    }

    pub fn isAbort(this: *const HTTPClientResult) bool {
        return if (this.fail) |e| (e == error.Aborted or e == error.AbortedBeforeConnecting) else false;
    }

    pub const Callback = struct {
        ctx: *anyopaque,
        function: Function,

        pub const Function = *const fn (*anyopaque, *AsyncHTTP, HTTPClientResult) void;

        pub fn run(self: Callback, async_http: *AsyncHTTP, result: HTTPClientResult) void {
            self.function(self.ctx, async_http, result);
        }

        pub fn New(comptime Type: type, comptime callback: anytype) type {
            return struct {
                pub fn init(this: Type) Callback {
                    return Callback{
                        .ctx = this,
                        .function = @This().wrapped_callback,
                    };
                }

                pub fn wrapped_callback(ptr: *anyopaque, async_http: *AsyncHTTP, result: HTTPClientResult) void {
                    const casted = @as(Type, @ptrCast(@alignCast(ptr)));
                    @call(bun.callmod_inline, callback, .{ casted, async_http, result });
                }
            };
        }
    };
};
