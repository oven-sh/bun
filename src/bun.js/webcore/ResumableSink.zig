/// ResumableSink allows a simplified way of reading a stream into a native Writable Interface, allowing to pause and resume the stream without the use of promises.
/// returning false on `onWrite` will pause the stream and calling .drain() will resume the stream consumption.
/// onEnd is always called when the stream is done or errored.
/// Calling `cancel` will cancel the stream, onEnd will be called with the reason passed to cancel.
/// Different from JSSink this is not intended to be exposed to the users, like FileSink or HTTPRequestSink etc.
pub fn ResumableSink(
    comptime js: type,
    comptime Context: type,
) type {
    return struct {
        const log = bun.Output.scoped(.ResumableSink, .visible);
        pub const toJS = js.toJS;
        pub const fromJS = js.fromJS;
        pub const fromJSDirect = js.fromJSDirect;

        const ThisSink = @This();
        const onWrite = Context.writeRequestData;
        const onEnd = Context.writeEndRequest;

        pub const new = bun.TrivialNew(@This());
        const RefCount = bun.ptr.RefCount(@This(), "ref_count", deinit, .{});
        pub const ref = RefCount.ref;
        pub const deref = RefCount.deref;
        const setCancel = js.oncancelSetCached;
        const getCancel = js.oncancelGetCached;
        const setDrain = js.ondrainSetCached;
        const getDrain = js.ondrainGetCached;
        const setStream = js.streamSetCached;
        const getStream = js.streamGetCached;
        ref_count: RefCount,
        #js_this: jsc.JSRef = .empty(),
        // We can have a detached self, and still have a strong reference to the stream
        stream: jsc.WebCore.ReadableStream.Strong = .{},
        globalThis: *jsc.JSGlobalObject,
        context: *Context,
        highWaterMark: i64 = 16384,
        status: Status = .started,

        const Status = enum(u8) {
            started,
            piped,
            paused,
            done,
        };

        pub fn constructor(globalThis: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!*ThisSink {
            return globalThis.throwInvalidArguments("ResumableSink is not constructable", .{});
        }

        pub fn init(globalThis: *jsc.JSGlobalObject, stream: jsc.WebCore.ReadableStream, context: *Context) *ThisSink {
            return initExactRefs(globalThis, stream, context, 1);
        }

        pub fn initExactRefs(globalThis: *jsc.JSGlobalObject, stream: jsc.WebCore.ReadableStream, context: *Context, ref_count: u32) *ThisSink {
            const this: *ThisSink = ThisSink.new(.{
                .globalThis = globalThis,
                .context = context,
                .ref_count = RefCount.initExactRefs(ref_count),
            });
            if (stream.isLocked(globalThis) or stream.isDisturbed(globalThis)) {
                var err = jsc.SystemError{
                    .code = bun.String.static(@tagName(jsc.Node.ErrorCode.ERR_STREAM_CANNOT_PIPE)),
                    .message = bun.String.static("Stream already used, please create a new one"),
                };
                const err_instance = err.toErrorInstance(globalThis);
                err_instance.ensureStillAlive();
                this.status = .done;
                onEnd(this.context, err_instance);
                this.deref();
                return this;
            }
            if (stream.ptr == .Bytes) {
                const byte_stream: *bun.webcore.ByteStream = stream.ptr.Bytes;
                // if pipe is empty, we can pipe
                if (byte_stream.pipe.isEmpty()) {
                    // equivalent to onStart to get the highWaterMark
                    this.highWaterMark = if (byte_stream.highWaterMark < std.math.maxInt(i64))
                        @intCast(byte_stream.highWaterMark)
                    else
                        std.math.maxInt(i64);

                    if (byte_stream.has_received_last_chunk) {
                        this.status = .done;
                        const err = brk_err: {
                            const pending = byte_stream.pending.result;
                            if (pending == .err) {
                                const js_err, const was_strong = pending.err.toJSWeak(this.globalThis);
                                js_err.ensureStillAlive();
                                if (was_strong == .Strong)
                                    js_err.unprotect();
                                break :brk_err js_err;
                            }
                            break :brk_err null;
                        };

                        var bytes = byte_stream.drain();
                        defer bytes.deinit(bun.default_allocator);
                        log("onWrite {}", .{bytes.len});
                        _ = onWrite(this.context, bytes.slice());
                        onEnd(this.context, err);
                        this.deref();
                        return this;
                    }
                    // We can pipe but we also wanna to drain as much as possible first
                    var bytes = byte_stream.drain();
                    defer bytes.deinit(bun.default_allocator);
                    // lets write and see if we can still pipe or if we have backpressure
                    if (bytes.len > 0) {
                        log("onWrite {}", .{bytes.len});
                        // we ignore the return value here because we dont want to pause the stream
                        // if we pause will just buffer in the pipe and we can do the buffer in one place
                        _ = onWrite(this.context, bytes.slice());
                    }
                    this.status = .piped;
                    byte_stream.pipe = jsc.WebCore.Pipe.Wrap(@This(), onStreamPipe).init(this);
                    this.ref(); // one ref for the pipe

                    // we only need the stream, we dont need to touch JS side yet
                    this.stream = jsc.WebCore.ReadableStream.Strong.init(stream, this.globalThis);
                    return this;
                }
            }
            // lets go JS side route
            const self = this.toJS(globalThis);
            self.ensureStillAlive();
            const js_stream = stream.toJS();
            js_stream.ensureStillAlive();
            this.#js_this.setStrong(self, globalThis);
            setStream(self, globalThis, js_stream);

            _ = Bun__assignStreamIntoResumableSink(globalThis, js_stream, self);

            return this;
        }

        pub fn jsSetHandlers(_: *ThisSink, globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame, this_value: jsc.JSValue) bun.JSError!jsc.JSValue {
            jsc.markBinding(@src());
            const args = callframe.arguments();

            if (args.len < 2) {
                return globalThis.throwInvalidArguments("ResumableSink.setHandlers requires at least 2 arguments", .{});
            }

            const ondrain = args.ptr[0];
            const oncancel = args.ptr[1];

            if (ondrain.isCallable()) {
                setDrain(this_value, globalThis, ondrain);
            }
            if (oncancel.isCallable()) {
                setCancel(this_value, globalThis, oncancel);
            }
            return .js_undefined;
        }

        pub fn jsStart(this: *ThisSink, globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
            jsc.markBinding(@src());
            const args = callframe.arguments();
            if (args.len > 0 and args[0].isObject()) {
                if (try args[0].getOptionalInt(globalThis, "highWaterMark", i64)) |highWaterMark| {
                    this.highWaterMark = highWaterMark;
                }
            }

            return .js_undefined;
        }

        pub fn jsWrite(this: *ThisSink, globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
            jsc.markBinding(@src());
            const args = callframe.arguments();
            // ignore any call if detached
            if (this.isDetached()) return .js_undefined;

            if (args.len < 1) {
                return globalThis.throwInvalidArguments("ResumableSink.write requires at least 1 argument", .{});
            }

            const buffer = args[0];
            const sb = try jsc.Node.StringOrBuffer.fromJS(globalThis, bun.default_allocator, buffer) orelse {
                return globalThis.throwInvalidArguments("ResumableSink.write requires a string or buffer", .{});
            };

            defer sb.deinit();
            const bytes = sb.slice();
            log("jsWrite {}", .{bytes.len});
            switch (onWrite(this.context, bytes)) {
                .backpressure => {
                    log("paused", .{});
                    this.status = .paused;
                },
                .done => {},
                .want_more => {
                    this.status = .started;
                },
            }

            return .jsBoolean(this.status != .paused);
        }

        pub fn jsEnd(this: *ThisSink, _: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
            jsc.markBinding(@src());
            const args = callframe.arguments();
            // ignore any call if detached
            if (this.isDetached()) return .js_undefined;
            this.detachJS();
            log("jsEnd {}", .{args.len});
            this.status = .done;

            onEnd(this.context, if (args.len > 0) args[0] else null);
            return .js_undefined;
        }

        pub fn drain(this: *ThisSink) void {
            log("drain", .{});
            if (this.status != .paused) {
                return;
            }
            if (this.#js_this.tryGet()) |js_this| {
                const globalObject = this.globalThis;

                if (getDrain(js_this)) |ondrain| {
                    this.status = .started;
                    globalObject.bunVM().eventLoop().runCallback(ondrain, globalObject, .js_undefined, &.{ .js_undefined, .js_undefined });
                }
            }
        }

        pub fn cancel(this: *ThisSink, reason: jsc.JSValue) void {
            if (this.status == .piped) {
                reason.ensureStillAlive();
                this.endPipe(reason);
                return;
            }
            if (this.#js_this.tryGet()) |js_this| {
                this.status = .done;
                js_this.ensureStillAlive();

                const onCancelCallback = getCancel(js_this);
                const globalObject = this.globalThis;

                // detach first so if cancel calls end will be a no-op
                this.detachJS();

                // call onEnd to indicate the native side that the stream errored
                onEnd(this.context, reason);

                js_this.ensureStillAlive();
                if (onCancelCallback) |callback| {
                    const event_loop = globalObject.bunVM().eventLoop();
                    event_loop.runCallback(callback, globalObject, .js_undefined, &.{ .js_undefined, reason });
                }
            }
        }

        pub fn isDetached(this: *const ThisSink) bool {
            return this.#js_this != .strong or this.status == .done;
        }

        fn detachJS(this: *ThisSink) void {
            if (this.#js_this.tryGet()) |js_this| {
                setDrain(js_this, this.globalThis, .zero);
                setCancel(js_this, this.globalThis, .zero);
                setStream(js_this, this.globalThis, .zero);
                this.#js_this.downgrade();
            }
        }
        pub fn deinit(this: *ThisSink) void {
            this.detachJS();
            this.stream.deinit();
            bun.destroy(this);
        }

        pub fn finalize(this: *ThisSink) void {
            this.#js_this.finalize();
            this.deref();
        }

        fn onStreamPipe(
            this: *ThisSink,
            stream: bun.webcore.streams.Result,
            allocator: std.mem.Allocator,
        ) void {
            var stream_ = stream;
            const stream_needs_deinit = stream == .owned or stream == .owned_and_done;

            defer {
                if (stream_needs_deinit) {
                    switch (stream_) {
                        .owned_and_done => |*owned| owned.deinit(allocator),
                        .owned => |*owned| owned.deinit(allocator),
                        else => unreachable,
                    }
                }
            }
            const chunk = stream.slice();
            log("onWrite {}", .{chunk.len});

            // TODO: should the "done" state also trigger `endPipe`?
            _ = onWrite(this.context, chunk);

            const is_done = stream.isDone();

            if (is_done) {
                const err: ?jsc.JSValue = brk_err: {
                    if (stream == .err) {
                        const js_err, const was_strong = stream.err.toJSWeak(this.globalThis);
                        js_err.ensureStillAlive();
                        if (was_strong == .Strong)
                            js_err.unprotect();
                        break :brk_err js_err;
                    }
                    break :brk_err null;
                };
                this.endPipe(err);
            }
        }

        fn endPipe(this: *ThisSink, err: ?jsc.JSValue) void {
            log("endPipe", .{});
            if (this.status != .piped) return;
            this.status = .done;
            const globalObject = this.globalThis;
            if (this.stream.get(globalObject)) |stream_| {
                if (stream_.ptr == .Bytes) {
                    stream_.ptr.Bytes.pipe = .{};
                }
                if (err != null) {
                    stream_.cancel(globalObject);
                } else {
                    stream_.done(globalObject);
                }
                var stream = this.stream;
                this.stream = .{};
                stream.deinit();
            }

            onEnd(this.context, err);

            if (this.#js_this == .strong) {
                // JS owns the stream, so we need to detach the JS and let finalize handle the deref
                // this should not happen but lets handle it anyways
                this.detachJS();
            } else {
                // no js attached, so we can just deref
                this.deref();
            }

            // We ref when we attach the stream so we deref when we detach the stream
            this.deref();
        }
    };
}
pub const ResumableSinkBackpressure = enum {
    want_more,
    backpressure,
    done,
};
pub const ResumableFetchSink = ResumableSink(jsc.Codegen.JSResumableFetchSink, FetchTasklet);
pub const ResumableS3UploadSink = ResumableSink(jsc.Codegen.JSResumableS3UploadSink, S3UploadStreamWrapper);

extern fn Bun__assignStreamIntoResumableSink(globalThis: *jsc.JSGlobalObject, stream: jsc.JSValue, sink: jsc.JSValue) jsc.JSValue;

const std = @import("std");
const FetchTasklet = @import("./fetch.zig").FetchTasklet;
const S3UploadStreamWrapper = @import("../../s3/client.zig").S3UploadStreamWrapper;

const bun = @import("bun");
const jsc = bun.jsc;
