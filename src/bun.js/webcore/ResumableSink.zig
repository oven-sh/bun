/// ResumableSink allows a simplified way of reading a stream into a native Writable Interface, allowing to pause and resume the stream without the use of promises.
/// returning false on `onWrite` will pause the stream and calling .drain() will resume the stream consumption.
/// onEnd is always called when the stream is done or errored.
/// Calling `cancel` will cancel the stream, onEnd will be called with the reason passed to cancel.
/// Different from JSSink this is not intended to be exposed to the users, like FileSink or HTTPRequestSink etc.
pub fn ResumableSink(
    comptime js: type,
    comptime Context: type,
    comptime onWrite: fn (context: *Context, chunk: []const u8) bool,
    comptime onEnd: fn (context: *Context, err: ?JSC.JSValue) void,
) type {
    return struct {
        const log = bun.Output.scoped(.ResumableSink, false);
        pub const toJS = js.toJS;
        pub const fromJS = js.fromJS;
        pub const fromJSDirect = js.fromJSDirect;

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
        self: JSC.Strong.Optional = JSC.Strong.Optional.empty,
        globalThis: *JSC.JSGlobalObject,
        context: *Context,
        highWaterMark: i64 = 16384,
        pub fn constructor(globalThis: *JSC.JSGlobalObject, _: *JSC.CallFrame) bun.JSError!*@This() {
            return globalThis.throwInvalidArguments("ResumableSink is not constructable", .{});
        }

        pub fn init(globalThis: *JSC.JSGlobalObject, stream: JSC.WebCore.ReadableStream, context: *Context) *@This() {
            return initExactRefs(globalThis, stream, context, 1);
        }

        pub fn initExactRefs(globalThis: *JSC.JSGlobalObject, stream: JSC.WebCore.ReadableStream, context: *Context, ref_count: u32) *@This() {
            const this = @This().new(.{
                .globalThis = globalThis,
                .context = context,
                .ref_count = RefCount.initExactRefs(ref_count),
            });
            const self = this.toJS(globalThis);
            self.ensureStillAlive();
            const js_stream = stream.toJS();
            js_stream.ensureStillAlive();
            _ = Bun__assignStreamIntoResumableSink(globalThis, js_stream, self);
            this.self = JSC.Strong.Optional.create(self, globalThis);
            setStream(self, globalThis, js_stream);
            return this;
        }

        pub fn jsSetHandlers(_: *@This(), globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame, this_value: JSC.JSValue) bun.JSError!JSC.JSValue {
            JSC.markBinding(@src());
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

        pub fn jsStart(this: *@This(), globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
            JSC.markBinding(@src());
            const args = callframe.arguments();

            if (args.len > 0 and args[0].isObject()) {
                if (try args[0].getOptionalInt(globalThis, "highWaterMark", i64)) |highWaterMark| {
                    this.highWaterMark = highWaterMark;
                }
            }

            return .js_undefined;
        }

        pub fn jsWrite(this: *@This(), globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
            JSC.markBinding(@src());
            const args = callframe.arguments();
            // ignore any call if detached
            if (!this.self.has()) return .js_undefined;

            if (args.len < 1) {
                return globalThis.throwInvalidArguments("ResumableSink.write requires at least 1 argument", .{});
            }

            const buffer = args[0];
            buffer.ensureStillAlive();
            if (try JSC.Node.StringOrBuffer.fromJS(globalThis, bun.default_allocator, buffer)) |sb| {
                defer sb.deinit();
                const bytes = sb.slice();
                return JSC.jsBoolean(onWrite(this.context, bytes));
            }

            return globalThis.throwInvalidArguments("ResumableSink.write requires a string or buffer", .{});
        }

        pub fn jsEnd(this: *@This(), _: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
            JSC.markBinding(@src());
            const args = callframe.arguments();
            // ignore any call if detached
            if (!this.self.has()) return .js_undefined;
            this.detachJS();
            log("jsEnd {}", .{args.len});
            onEnd(this.context, if (args.len > 0) args[0] else null);
            return .js_undefined;
        }

        pub fn drain(this: *@This()) void {
            if (this.self.get()) |js_this| {
                const globalObject = this.globalThis;
                const vm = globalObject.bunVM();
                vm.eventLoop().enter();
                defer vm.eventLoop().exit();
                if (getDrain(js_this)) |ondrain| {
                    if (ondrain.isCallable()) {
                        _ = ondrain.call(globalObject, .js_undefined, &.{.js_undefined}) catch |err| {
                            // should never happen
                            bun.debugAssert(false);
                            _ = globalObject.takeError(err);
                        };
                    }
                }
            }
        }

        pub fn cancel(this: *@This(), reason: JSC.JSValue) void {
            if (this.self.get()) |js_this| {
                js_this.ensureStillAlive();

                const globalObject = this.globalThis;
                const vm = globalObject.bunVM();
                vm.eventLoop().enter();
                defer vm.eventLoop().exit();

                if (getCancel(js_this)) |oncancel| {
                    oncancel.ensureStillAlive();
                    // detach first so if cancel calls end will be a no-op
                    this.detachJS();
                    // call onEnd to indicate the native side that the stream errored
                    onEnd(this.context, reason);
                    if (oncancel.isCallable()) {
                        _ = oncancel.call(globalObject, .js_undefined, &.{ .js_undefined, reason }) catch |err| {
                            // should never happen
                            bun.debugAssert(false);
                            _ = globalObject.takeError(err);
                        };
                    }
                } else {
                    // should never happen but lets call onEnd to indicate the native side that the stream errored
                    this.detachJS();
                    onEnd(this.context, reason);
                }
            }
        }

        fn detachJS(this: *@This()) void {
            if (this.self.trySwap()) |js_this| {
                setDrain(js_this, this.globalThis, .zero);
                setCancel(js_this, this.globalThis, .zero);
                setStream(js_this, this.globalThis, .zero);
                this.self.deinit();
                this.self = JSC.Strong.Optional.empty;
            }
        }
        pub fn deinit(this: *@This()) void {
            this.detachJS();
            bun.destroy(this);
        }

        pub fn finalize(this: *@This()) void {
            this.deref();
        }
    };
}

pub const ResumableFetchSink = ResumableSink(JSC.Codegen.JSResumableFetchSink, FetchTasklet, FetchTasklet.writeRequestData, FetchTasklet.writeEndRequest);
const S3UploadStreamWrapper = @import("../../s3/client.zig").S3UploadStreamWrapper;
pub const ResumableS3UploadSink = ResumableSink(JSC.Codegen.JSResumableS3UploadSink, S3UploadStreamWrapper, S3UploadStreamWrapper.writeRequestData, S3UploadStreamWrapper.writeEndRequest);
const bun = @import("bun");
const FetchTasklet = @import("./fetch.zig").FetchTasklet;

const JSC = bun.JSC;
extern fn Bun__assignStreamIntoResumableSink(globalThis: *JSC.JSGlobalObject, stream: JSC.JSValue, sink: JSC.JSValue) JSC.JSValue;
