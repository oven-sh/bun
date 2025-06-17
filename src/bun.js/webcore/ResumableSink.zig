pub fn ResumableSink(
    comptime js: type,
    comptime Context: type,
    comptime onWrite: ?fn (context: *Context, chunk: []const u8) bool,
    comptime onEnd: ?fn (context: *Context, err: ?JSC.JSValue) void,
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
        ref_count: RefCount,

        ondrain: JSC.Strong.Optional = JSC.Strong.Optional.empty,
        oncancel: JSC.Strong.Optional = JSC.Strong.Optional.empty,
        self: JSC.Strong.Optional = JSC.Strong.Optional.empty,
        stream: JSC.Strong.Optional = JSC.Strong.Optional.empty,
        globalThis: *JSC.JSGlobalObject,
        context: *Context,
        highWaterMark: i64 = 16384,
        pub fn constructor(globalThis: *JSC.JSGlobalObject, _: *JSC.CallFrame) bun.JSError!*@This() {
            return globalThis.throwInvalidArguments("ResumableSink is not constructable", .{});
        }

        pub fn init(globalThis: *JSC.JSGlobalObject, stream: JSC.WebCore.ReadableStream, context: *Context) bun.JSError!*@This() {
            const this = @This().new(.{
                .globalThis = globalThis,
                .context = context,
                .ref_count = RefCount.init(),
            });
            const self = this.toJS(globalThis);
            self.ensureStillAlive();
            const js_stream = stream.toJS();
            js_stream.ensureStillAlive();
            _ = Bun__assignStreamIntoResumableSink(globalThis, js_stream, self);
            if (globalThis.hasException()) {
                return bun.JSError.JSError;
            }
            this.self = JSC.Strong.Optional.create(self, globalThis);
            this.stream = JSC.Strong.Optional.create(js_stream, globalThis);
            return this;
        }

        pub fn jsSetHandlers(this: *@This(), globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
            JSC.markBinding(@src());
            const args = callframe.arguments();

            if (args.len < 2) {
                return globalThis.throwInvalidArguments("ResumableSink.setHandlers requires at least 2 arguments", .{});
            }

            const ondrain = args.ptr[0];
            const oncancel = args.ptr[1];

            if (ondrain.isCallable()) {
                this.ondrain = JSC.Strong.Optional.create(ondrain, globalThis);
            }
            if (oncancel.isCallable()) {
                this.oncancel = JSC.Strong.Optional.create(oncancel, globalThis);
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

            if (args.len < 1) {
                return globalThis.throwInvalidArguments("ResumableSink.write requires at least 1 argument", .{});
            }

            const buffer = args[0];
            buffer.ensureStillAlive();
            if (buffer.asArrayBuffer(globalThis)) |array_buffer| {
                const bytes = array_buffer.byteSlice();
                if (onWrite) |onWriteCallback| {
                    return JSC.jsBoolean(onWriteCallback(this.context, bytes));
                }
            }

            return .js_undefined;
        }

        pub fn jsEnd(this: *@This(), _: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
            JSC.markBinding(@src());
            const args = callframe.arguments();

            if (onEnd) |onEndCallback| {
                onEndCallback(this.context, if (args.len > 0) args[0] else null);
            }
            // let it be garbage collected
            this.stream.deinit();
            this.self.deinit();
            return .js_undefined;
        }

        pub fn drain(this: *@This()) void {
            if (this.ondrain.get()) |ondrain| {
                const globalObject = this.globalThis;
                const vm = globalObject.bunVM();
                vm.eventLoop().enter();
                defer vm.eventLoop().exit();

                _ = ondrain.call(globalObject, .js_undefined, &.{.js_undefined}) catch |err| {
                    // should never happen
                    bun.debugAssert(false);
                    _ = globalObject.takeError(err);
                };
            }
        }

        pub fn cancel(this: *@This(), reason: JSC.JSValue) void {
            if (this.oncancel.get()) |oncancel| {
                const globalObject = this.globalThis;
                const vm = globalObject.bunVM();
                vm.eventLoop().enter();
                defer vm.eventLoop().exit();

                _ = oncancel.call(globalObject, .js_undefined, &.{ .js_undefined, reason }) catch |err| {
                    // should never happen
                    bun.debugAssert(false);
                    _ = globalObject.takeError(err);
                };
            }
            // let it be garbage collected
            this.self.deinit();
            this.self = JSC.Strong.Optional.empty;
        }

        pub fn deinit(this: *@This()) void {
            this.ondrain.deinit();
            this.oncancel.deinit();
            this.stream.deinit();
            bun.destroy(this);
        }

        pub fn finalize(this: *@This()) void {
            this.deref();
        }
    };
}

pub const ResumableFetchSink = ResumableSink(JSC.Codegen.JSResumableFetchSink, FetchTasklet, FetchTasklet.writeRequestData, FetchTasklet.writeEndRequest);
const bun = @import("bun");
const FetchTasklet = @import("./fetch.zig").FetchTasklet;

const JSC = bun.JSC;
extern fn Bun__assignStreamIntoResumableSink(globalThis: *JSC.JSGlobalObject, stream: JSC.JSValue, sink: JSC.JSValue) JSC.JSValue;
