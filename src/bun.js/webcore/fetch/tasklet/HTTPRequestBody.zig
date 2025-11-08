pub const HTTPRequestBody = union(enum) {
    AnyBlob: AnyBlob,
    Sendfile: http.SendFile,
    ReadableStream: jsc.WebCore.ReadableStream.Strong,

    pub const Empty: HTTPRequestBody = .{ .AnyBlob = .{ .Blob = .{} } };

    pub fn store(this: *HTTPRequestBody) ?*Blob.Store {
        return switch (this.*) {
            .AnyBlob => this.AnyBlob.store(),
            else => null,
        };
    }

    pub fn slice(this: *const HTTPRequestBody) []const u8 {
        return switch (this.*) {
            .AnyBlob => this.AnyBlob.slice(),
            else => "",
        };
    }

    pub fn detach(this: *HTTPRequestBody) void {
        switch (this.*) {
            .AnyBlob => this.AnyBlob.detach(),
            .ReadableStream => |*stream| {
                stream.deinit();
            },
            .Sendfile => {
                if (@max(this.Sendfile.offset, this.Sendfile.remain) > 0)
                    this.Sendfile.fd.close();
                this.Sendfile.offset = 0;
                this.Sendfile.remain = 0;
            },
        }
    }

    pub fn fromJS(globalThis: *JSGlobalObject, value: JSValue) bun.JSError!HTTPRequestBody {
        var body_value = try Body.Value.fromJS(globalThis, value);
        if (body_value == .Used or (body_value == .Locked and (body_value.Locked.action != .none or body_value.Locked.isDisturbed2(globalThis)))) {
            return globalThis.ERR(.BODY_ALREADY_USED, "body already used", .{}).throw();
        }
        if (body_value == .Locked) {
            if (body_value.Locked.readable.has()) {
                // just grab the ref
                return FetchTasklet.HTTPRequestBody{ .ReadableStream = body_value.Locked.readable };
            }
            const readable = try body_value.toReadableStream(globalThis);
            if (!readable.isEmptyOrUndefinedOrNull() and body_value == .Locked and body_value.Locked.readable.has()) {
                return FetchTasklet.HTTPRequestBody{ .ReadableStream = body_value.Locked.readable };
            }
        }
        return FetchTasklet.HTTPRequestBody{ .AnyBlob = body_value.useAsAnyBlob() };
    }

    pub fn needsToReadFile(this: *HTTPRequestBody) bool {
        return switch (this.*) {
            .AnyBlob => |blob| blob.needsToReadFile(),
            else => false,
        };
    }

    pub fn isS3(this: *const HTTPRequestBody) bool {
        return switch (this.*) {
            .AnyBlob => |*blob| blob.isS3(),
            else => false,
        };
    }

    pub fn hasContentTypeFromUser(this: *HTTPRequestBody) bool {
        return switch (this.*) {
            .AnyBlob => |blob| blob.hasContentTypeFromUser(),
            else => false,
        };
    }

    pub fn getAnyBlob(this: *HTTPRequestBody) ?*AnyBlob {
        return switch (this.*) {
            .AnyBlob => &this.AnyBlob,
            else => null,
        };
    }

    pub fn hasBody(this: *HTTPRequestBody) bool {
        return switch (this.*) {
            .AnyBlob => |blob| blob.size() > 0,
            .ReadableStream => |*stream| stream.has(),
            .Sendfile => true,
        };
    }
};
const bun = @import("bun");
const http = bun.http;
const jsc = bun.jsc;
const JSGlobalObject = jsc.JSGlobalObject;
const JSValue = jsc.JSValue;
const Body = bun.webcore.Body;
const AnyBlob = jsc.WebCore.Blob.Any;
const Blob = bun.webcore.Blob;
