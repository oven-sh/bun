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
    /// Cached JS object containing x-amz-meta-* headers as key-value pairs.
    /// Keys have the "x-amz-meta-" prefix stripped.
    metadata: jsc.JSRef,

    pub fn constructor(globalThis: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!*@This() {
        return globalThis.throwInvalidArguments("S3Stat is not constructable", .{});
    }

    /// Initialize S3Stat from stat result data.
    /// `headers` should be the raw response headers - this function will extract x-amz-meta-* headers.
    pub fn init(
        size: u64,
        etag: []const u8,
        contentType: []const u8,
        lastModified: []const u8,
        headers: []const picohttp.Header,
        globalThis: *jsc.JSGlobalObject,
    ) bun.JSError!*@This() {
        var date_str = bun.String.init(lastModified);
        defer date_str.deref();
        const last_modified = try date_str.parseDate(globalThis);

        // Build metadata JS object from x-amz-meta-* headers
        const metadata_obj = try buildMetadataObject(headers, globalThis);

        return S3Stat.new(.{
            .size = size,
            .etag = bun.String.cloneUTF8(etag),
            .contentType = bun.String.cloneUTF8(contentType),
            .lastModified = last_modified,
            .metadata = jsc.JSRef.initStrong(metadata_obj, globalThis),
        });
    }

    /// Extract x-amz-meta-* headers and build a JS object with stripped key names.
    fn buildMetadataObject(headers: []const picohttp.Header, globalThis: *jsc.JSGlobalObject) bun.JSError!jsc.JSValue {
        const prefix = "x-amz-meta-";
        const prefix_len = prefix.len;

        // Create empty JS object
        const obj = jsc.JSValue.createEmptyObject(globalThis, 0);

        for (headers) |header| {
            // Case-insensitive check for x-amz-meta- prefix
            if (header.name.len > prefix_len and
                strings.eqlCaseInsensitiveASCII(header.name[0..prefix_len], prefix, true))
            {
                // Strip the prefix to get the user's key name
                const key = header.name[prefix_len..];
                const value_js = try bun.String.createUTF8ForJS(globalThis, header.value);

                // put() accepts []const u8 directly and wraps it in ZigString
                obj.put(globalThis, key, value_js);
            }
        }

        return obj;
    }

    pub fn getSize(this: *@This(), _: *jsc.JSGlobalObject) jsc.JSValue {
        return jsc.JSValue.jsNumber(this.size);
    }

    pub fn getEtag(this: *@This(), globalObject: *jsc.JSGlobalObject) jsc.JSValue {
        return this.etag.toJS(globalObject);
    }

    pub fn getContentType(this: *@This(), globalObject: *jsc.JSGlobalObject) jsc.JSValue {
        return this.contentType.toJS(globalObject);
    }

    pub fn getLastModified(this: *@This(), globalObject: *jsc.JSGlobalObject) jsc.JSValue {
        return jsc.JSValue.fromDateNumber(globalObject, this.lastModified);
    }

    pub fn getMetadata(this: *@This(), _: *jsc.JSGlobalObject) jsc.JSValue {
        return this.metadata.tryGet() orelse .js_undefined;
    }

    pub fn finalize(this: *@This()) void {
        this.etag.deref();
        this.contentType.deref();
        this.metadata.deinit();
        bun.destroy(this);
    }
};

const bun = @import("bun");
const jsc = bun.jsc;
const picohttp = bun.picohttp;
const strings = bun.strings;
