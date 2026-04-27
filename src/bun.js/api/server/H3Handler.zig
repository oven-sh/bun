//! Per-request state for HTTP/3. Kept separate from RequestContext, which is
//! monomorphised over the TCP/TLS uws response type and would otherwise need
//! a third instantiation. The flow mirrors onRequest → onResponse but writes
//! through uws.H3.Response directly.

const H3Handler = @This();

resp: *uws.H3.Response,
globalThis: *jsc.JSGlobalObject,
vm: *jsc.VirtualMachine,
on_request: jsc.JSValue,
server: jsc.JSValue,
poll_ref: bun.Async.KeepAlive = .{},

response_ref: jsc.Strong.Optional = .empty,
request_body: std.array_list.Managed(u8),
js_body: ?*jsc.WebCore.Body.Value.HiveRef = null,
flags: packed struct(u8) {
    aborted: bool = false,
    done: bool = false,
    has_body: bool = false,
    _pad: u5 = 0,
} = .{},

pub const new = bun.TrivialNew(@This());

pub fn onRequest(
    globalThis: *jsc.JSGlobalObject,
    vm: *jsc.VirtualMachine,
    base_url: []const u8,
    on_request: jsc.JSValue,
    server_js: jsc.JSValue,
    req: *uws.H3.Request,
    resp: *uws.H3.Response,
) void {
    var ctx = H3Handler.new(.{
        .resp = resp,
        .globalThis = globalThis,
        .vm = vm,
        .on_request = on_request,
        .server = server_js,
        .request_body = .init(bun.default_allocator),
    });
    ctx.poll_ref.ref(vm);
    resp.onAborted(*H3Handler, onAborted, ctx);

    const method = bun.http.Method.which(req.method()) orelse .GET;
    ctx.flags.has_body = method.hasRequestBody() and
        (req.header("content-length") != null or req.header("content-type") != null);

    // Absolute URL: base_url already has scheme://host[:port]; req.url() is the
    // raw :path (includes query).
    const path = req.url();
    var buf = bun.handleOom(bun.default_allocator.alloc(u8, base_url.len + path.len));
    @memcpy(buf[0..base_url.len], base_url);
    @memcpy(buf[base_url.len..], path);
    const url = bun.String.cloneUTF8(buf);
    bun.default_allocator.free(buf);

    const headers = jsc.WebCore.FetchHeaders.createEmpty();
    req.forEachHeader(*jsc.WebCore.FetchHeaders, struct {
        fn each(h: *jsc.WebCore.FetchHeaders, name: []const u8, value: []const u8) void {
            h.append(&jsc.ZigString.init(name), &jsc.ZigString.init(value), jsc.VirtualMachine.get().global);
        }
    }.each, headers);

    const body_ref = vm.initRequestBodyValue(.{ .Null = {} }) catch {
        ctx.fail("500 Internal Server Error");
        return;
    };
    ctx.js_body = body_ref;

    const request = jsc.WebCore.Request.new(
        jsc.WebCore.Request.init2(url, headers, body_ref.ref(), method),
    );
    const js_request = request.toJS(globalThis);

    if (ctx.flags.has_body) {
        body_ref.value = .{
            .Locked = .{
                .task = ctx,
                .global = globalThis,
                .onStartBuffering = onStartBuffering,
                .onStartStreaming = null,
                .onReadableStreamAvailable = null,
            },
        };
        resp.onData(*H3Handler, onBodyChunk, ctx);
    }

    const result = on_request.call(globalThis, server_js, &.{ js_request, server_js }) catch |err|
        globalThis.takeException(err);
    js_request.ensureStillAlive();

    ctx.handleResult(result);
}

fn handleResult(this: *H3Handler, value: jsc.JSValue) void {
    if (this.flags.aborted) return this.finalize();
    if (value.isEmptyOrUndefinedOrNull()) {
        return this.fail("500 Internal Server Error");
    }
    if (value.asAnyPromise()) |promise| {
        switch (promise.status()) {
            .pending => {
                this.response_ref = .create(value, this.globalThis);
                value.then(this.globalThis, this, jsOnResolve, jsOnReject) catch {};
                return;
            },
            .fulfilled => return this.handleResult(promise.result(this.vm.jsc_vm)),
            .rejected => {
                promise.setHandled(this.vm.jsc_vm);
                return this.fail("500 Internal Server Error");
            },
        }
    }
    if (value.as(jsc.WebCore.Response)) |response| {
        this.response_ref = .create(value, this.globalThis);
        this.render(response);
        return;
    }
    this.fail("500 Internal Server Error");
}

pub fn jsOnResolve(_: *jsc.JSGlobalObject, frame: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const args = frame.arguments();
    var this: *H3Handler = args[args.len - 1].asPromisePtr(H3Handler);
    this.response_ref.deinit();
    this.handleResult(if (args.len > 0) args[0] else .js_undefined);
    return .js_undefined;
}

pub fn jsOnReject(_: *jsc.JSGlobalObject, frame: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const args = frame.arguments();
    var this: *H3Handler = args[args.len - 1].asPromisePtr(H3Handler);
    this.response_ref.deinit();
    this.fail("500 Internal Server Error");
    return .js_undefined;
}

/// ZigGlobalObject.cpp references these unconditionally, so Windows still
/// needs the symbols even though no H3 request can arrive there.
fn jsOnUnreachable(_: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    return .js_undefined;
}

comptime {
    if (bun.Environment.isWindows) {
        @export(&jsc.toJSHostFn(jsOnUnreachable), .{ .name = "Bun__H3Handler__onResolve" });
        @export(&jsc.toJSHostFn(jsOnUnreachable), .{ .name = "Bun__H3Handler__onReject" });
    } else {
        @export(&jsc.toJSHostFn(jsOnResolve), .{ .name = "Bun__H3Handler__onResolve" });
        @export(&jsc.toJSHostFn(jsOnReject), .{ .name = "Bun__H3Handler__onReject" });
    }
}

fn render(this: *H3Handler, response: *jsc.WebCore.Response) void {
    if (this.flags.aborted) return this.finalize();
    const resp = this.resp;

    const status = response.statusCode();
    if (HTTPStatusText.get(status)) |text| {
        resp.writeStatus(text);
    } else {
        var b: [16]u8 = undefined;
        resp.writeStatus(std.fmt.bufPrint(&b, "{d}", .{status}) catch "500");
    }

    if (response.getInitHeaders()) |headers| {
        var n: u32 = 0;
        var buf_len: u32 = 0;
        headers.count(&n, &buf_len);
        if (n > 0) {
            var sfa = std.heap.stackFallback(4096, bun.default_allocator);
            const alloc = sfa.get();
            const names = bun.handleOom(alloc.alloc(bun.StringPointer, n));
            defer alloc.free(names);
            const values = bun.handleOom(alloc.alloc(bun.StringPointer, n));
            defer alloc.free(values);
            const buf = bun.handleOom(alloc.alloc(u8, buf_len));
            defer alloc.free(buf);
            headers.copyTo(names.ptr, values.ptr, buf.ptr);
            for (names, values) |name_sp, val_sp| {
                resp.writeHeader(buf[name_sp.offset..][0..name_sp.length], buf[val_sp.offset..][0..val_sp.length]);
            }
        }
    }

    var body = response.getBodyValue();
    var blob = body.useAsAnyBlobAllowNonUTF8String();
    defer blob.detach();
    const slice = blob.slice();
    resp.end(slice, false);
    this.flags.done = true;
    this.finalize();
}

fn fail(this: *H3Handler, status: []const u8) void {
    if (!this.flags.aborted and !this.flags.done) {
        this.resp.writeStatus(status);
        this.resp.end("", false);
    }
    this.flags.done = true;
    this.finalize();
}

fn onAborted(this: *H3Handler, _: *uws.H3.Response) void {
    this.flags.aborted = true;
    if (this.js_body) |body| {
        body.value.toErrorInstance(.{ .AbortReason = .ConnectionClosed }, this.globalThis) catch {};
    }
    if (this.response_ref.has()) return; // promise still pending; finalize on resolve/reject
    this.finalize();
}

fn onStartBuffering(task: *anyopaque) void {
    _ = task;
}

fn onBodyChunk(this: *H3Handler, _: *uws.H3.Response, chunk: []const u8, last: bool) void {
    if (chunk.len > 0) bun.handleOom(this.request_body.appendSlice(chunk));
    if (last) {
        if (this.js_body) |body| {
            var old = body.value;
            const owned = this.request_body.toOwnedSlice() catch bun.outOfMemory();
            body.value = .{ .InternalBlob = .{ .bytes = std.array_list.Managed(u8).fromOwnedSlice(bun.default_allocator, owned) } };
            old.resolve(&body.value, this.globalThis, null) catch {};
        }
    }
}

fn finalize(this: *H3Handler) void {
    if (this.response_ref.has()) return;
    this.poll_ref.unref(this.vm);
    this.response_ref.deinit();
    this.request_body.deinit();
    if (this.js_body) |body| _ = body.unref();
    bun.destroy(this);
}

const std = @import("std");
const bun = @import("bun");
const jsc = bun.jsc;
const uws = bun.uws;
const HTTPStatusText = @import("./HTTPStatusText.zig");
