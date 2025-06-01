const bun = @import("bun");
const JSC = bun.JSC;

pub const S3Stat = struct {
    const log = bun.Output.scoped(.S3Stat, false);
    pub const js = JSC.Codegen.JSS3Stat;
    pub const toJS = js.toJS;
    pub const fromJS = js.fromJS;
    pub const fromJSDirect = js.fromJSDirect;

    pub const new = bun.TrivialNew(@This());

    size: u64,
    etag: bun.String,
    contentType: bun.String,
    lastModified: f64,

    pub fn constructor(globalThis: *JSC.JSGlobalObject, _: *JSC.CallFrame) bun.JSError!*@This() {
        return globalThis.throwInvalidArguments("S3Stat is not constructable", .{});
    }

    pub fn init(
        size: u64,
        etag: []const u8,
        contentType: []const u8,
        lastModified: []const u8,
        globalThis: *JSC.JSGlobalObject,
    ) *@This() {
        var date_str = bun.String.init(lastModified);
        defer date_str.deref();
        const last_modified = date_str.parseDate(globalThis);

        return S3Stat.new(.{
            .size = size,
            .etag = bun.String.createUTF8(etag),
            .contentType = bun.String.createUTF8(contentType),
            .lastModified = last_modified,
        });
    }

    pub fn getSize(this: *@This(), _: *JSC.JSGlobalObject) JSC.JSValue {
        return JSC.JSValue.jsNumber(this.size);
    }

    pub fn getEtag(this: *@This(), globalObject: *JSC.JSGlobalObject) JSC.JSValue {
        return this.etag.toJS(globalObject);
    }

    pub fn getContentType(this: *@This(), globalObject: *JSC.JSGlobalObject) JSC.JSValue {
        return this.contentType.toJS(globalObject);
    }

    pub fn getLastModified(this: *@This(), globalObject: *JSC.JSGlobalObject) JSC.JSValue {
        return JSC.JSValue.fromDateNumber(globalObject, this.lastModified);
    }

    pub fn finalize(this: *@This()) void {
        this.etag.deref();
        this.contentType.deref();
        bun.destroy(this);
    }
};
