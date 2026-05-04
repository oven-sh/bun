pub const S3Stat = struct {
    const log = bun.Output.scoped(.S3Stat, .visible);
    pub const js = jsc.Codegen.JSS3Stat;
    pub const toJS = js.toJS;
    pub const fromJS = js.fromJS;
    pub const fromJSDirect = js.fromJSDirect;

    pub const new = bun.TrivialNew(@This());

    size: u64,
    etag: bun.String,
    contentType: bun.String,
    lastModified: f64,

    pub fn constructor(globalThis: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!*@This() {
        return globalThis.throwInvalidArguments("S3Stat is not constructable", .{});
    }

    pub fn init(
        size: u64,
        etag: []const u8,
        contentType: []const u8,
        lastModified: []const u8,
        globalThis: *jsc.JSGlobalObject,
    ) bun.JSError!*@This() {
        var date_str = bun.String.init(lastModified);
        defer date_str.deref();
        const last_modified = try date_str.parseDate(globalThis);

        return S3Stat.new(.{
            .size = size,
            .etag = bun.String.cloneUTF8(etag),
            .contentType = bun.String.cloneUTF8(contentType),
            .lastModified = last_modified,
        });
    }

    pub fn getSize(this: *@This(), _: *jsc.JSGlobalObject) jsc.JSValue {
        return jsc.JSValue.jsNumber(this.size);
    }

    pub fn getEtag(this: *@This(), globalObject: *jsc.JSGlobalObject) bun.JSError!jsc.JSValue {
        return this.etag.toJS(globalObject);
    }

    pub fn getContentType(this: *@This(), globalObject: *jsc.JSGlobalObject) bun.JSError!jsc.JSValue {
        return this.contentType.toJS(globalObject);
    }

    pub fn getLastModified(this: *@This(), globalObject: *jsc.JSGlobalObject) jsc.JSValue {
        return jsc.JSValue.fromDateNumber(globalObject, this.lastModified);
    }

    pub fn finalize(this: *@This()) void {
        this.etag.deref();
        this.contentType.deref();
        bun.destroy(this);
    }
};

const bun = @import("bun");
const jsc = bun.jsc;
