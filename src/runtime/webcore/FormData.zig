//! HTML `FormData` parsing + JS bridge. Moved from `url/url.zig` because the
//! struct is webcore (fetch Body) and JSC-heavy; `url/` is JSC-free.

pub const FormData = struct {
    fields: Map,
    buffer: []const u8,
    const log = Output.scoped(.FormData, .visible);

    pub const Map = std.ArrayHashMapUnmanaged(
        bun.Semver.String,
        Field.Entry,
        bun.Semver.String.ArrayHashContext,
        false,
    );

    pub const Encoding = union(enum) {
        URLEncoded: void,
        Multipart: []const u8, // boundary

        pub fn get(content_type: []const u8) ?Encoding {
            if (strings.indexOf(content_type, "application/x-www-form-urlencoded") != null)
                return Encoding{ .URLEncoded = {} };

            if (strings.indexOf(content_type, "multipart/form-data") == null) return null;

            const boundary = getBoundary(content_type) orelse return null;
            return .{
                .Multipart = boundary,
            };
        }
    };

    pub const AsyncFormData = struct {
        encoding: Encoding,
        allocator: std.mem.Allocator,

        pub fn init(allocator: std.mem.Allocator, encoding: Encoding) !*AsyncFormData {
            const this = try allocator.create(AsyncFormData);
            this.* = AsyncFormData{
                .encoding = switch (encoding) {
                    .Multipart => .{
                        .Multipart = try allocator.dupe(u8, encoding.Multipart),
                    },
                    else => encoding,
                },
                .allocator = allocator,
            };
            return this;
        }

        pub fn deinit(this: *AsyncFormData) void {
            if (this.encoding == .Multipart)
                this.allocator.free(this.encoding.Multipart);
            this.allocator.destroy(this);
        }

        pub fn toJS(this: *AsyncFormData, global: *jsc.JSGlobalObject, data: []const u8, promise: jsc.AnyPromise) bun.JSTerminated!void {
            if (this.encoding == .Multipart and this.encoding.Multipart.len == 0) {
                log("AsnycFormData.toJS -> promise.reject missing boundary", .{});
                try promise.reject(global, jsc.ZigString.init("FormData missing boundary").toErrorInstance(global));
                return;
            }

            const js_value = bun.FormData.toJS(
                global,
                data,
                this.encoding,
            ) catch |err| {
                log("AsnycFormData.toJS -> failed ", .{});
                try promise.reject(global, global.createErrorInstance("FormData {s}", .{@errorName(err)}));
                return;
            };
            try promise.resolve(global, js_value);
        }
    };

    pub fn getBoundary(content_type: []const u8) ?[]const u8 {
        const boundary_index = strings.indexOf(content_type, "boundary=") orelse return null;
        const boundary_start = boundary_index + "boundary=".len;
        const begin = content_type[boundary_start..];
        if (begin.len == 0)
            return null;

        const boundary_end = strings.indexOfChar(begin, ';') orelse @as(u32, @truncate(begin.len));
        if (begin[0] == '"') {
            if (boundary_end > 1 and begin[boundary_end - 1] == '"') {
                return begin[1 .. boundary_end - 1];
            }
            // Opening quote with no matching closing quote — malformed.
            return null;
        }

        return begin[0..boundary_end];
    }

    pub const Field = struct {
        /// Raw slice into the input buffer. Not using `bun.Semver.String` because
        /// file bodies are binary data that can contain null bytes, which
        /// Semver.String's inline storage treats as terminators.
        value: []const u8 = "",
        filename: bun.Semver.String = .{},
        content_type: bun.Semver.String = .{},
        is_file: bool = false,
        zero_count: u8 = 0,

        pub const Entry = union(enum) {
            field: Field,
            list: bun.BabyList(Field),
        };

        pub const External = extern struct {
            name: jsc.ZigString,
            value: jsc.ZigString,
            blob: ?*jsc.WebCore.Blob = null,
        };
    };

    pub fn toJS(globalThis: *jsc.JSGlobalObject, input: []const u8, encoding: Encoding) !jsc.JSValue {
        switch (encoding) {
            .URLEncoded => {
                var str = jsc.ZigString.fromUTF8(strings.withoutUTF8BOM(input));
                const result = jsc.DOMFormData.createFromURLQuery(globalThis, &str);
                // Check if an exception was thrown (e.g., string too long)
                if (result == .zero) {
                    return error.JSError;
                }
                return result;
            },
            .Multipart => |boundary| return toJSFromMultipartData(globalThis, input, boundary),
        }
    }

    pub fn fromMultipartData(
        globalThis: *jsc.JSGlobalObject,
        callframe: *jsc.CallFrame,
    ) bun.JSError!jsc.JSValue {
        jsc.markBinding(@src());

        const args_ = callframe.arguments_old(2);

        const args = args_.ptr[0..2];

        const input_value = args[0];
        const boundary_value = args[1];
        var boundary_slice = jsc.ZigString.Slice.empty;
        defer boundary_slice.deinit();

        var encoding = Encoding{
            .URLEncoded = {},
        };

        if (input_value.isEmptyOrUndefinedOrNull()) {
            return globalThis.throwInvalidArguments("input must not be empty", .{});
        }

        if (!boundary_value.isEmptyOrUndefinedOrNull()) {
            if (boundary_value.asArrayBuffer(globalThis)) |array_buffer| {
                if (array_buffer.byteSlice().len > 0)
                    encoding = .{ .Multipart = array_buffer.byteSlice() };
            } else if (boundary_value.isString()) {
                boundary_slice = try boundary_value.toSliceOrNull(globalThis);
                if (boundary_slice.len > 0) {
                    encoding = .{ .Multipart = boundary_slice.slice() };
                }
            } else {
                return globalThis.throwInvalidArguments("boundary must be a string or ArrayBufferView", .{});
            }
        }
        var input_slice = jsc.ZigString.Slice{};
        defer input_slice.deinit();
        var input: []const u8 = "";

        if (input_value.asArrayBuffer(globalThis)) |array_buffer| {
            input = array_buffer.byteSlice();
        } else if (input_value.isString()) {
            input_slice = try input_value.toSliceOrNull(globalThis);
            input = input_slice.slice();
        } else if (input_value.as(jsc.WebCore.Blob)) |blob| {
            input = blob.sharedView();
        } else {
            return globalThis.throwInvalidArguments("input must be a string or ArrayBufferView", .{});
        }

        return FormData.toJS(globalThis, input, encoding) catch |err| {
            if (err == error.JSError) return error.JSError;
            if (err == error.JSTerminated) return error.JSTerminated;
            return globalThis.throwError(err, "while parsing FormData");
        };
    }

    comptime {
        const jsFunctionFromMultipartData = jsc.toJSHostFn(fromMultipartData);
        @export(&jsFunctionFromMultipartData, .{ .name = "FormData__jsFunctionFromMultipartData" });
    }

    pub fn toJSFromMultipartData(
        globalThis: *jsc.JSGlobalObject,
        input: []const u8,
        boundary: []const u8,
    ) !jsc.JSValue {
        const form_data_value = jsc.DOMFormData.create(globalThis);
        form_data_value.ensureStillAlive();
        const form = jsc.DOMFormData.fromJS(form_data_value) orelse {
            log("failed to create DOMFormData.fromJS", .{});
            return error.@"failed to parse multipart data";
        };
        const Wrapper = struct {
            globalThis: *jsc.JSGlobalObject,
            form: *jsc.DOMFormData,

            pub fn onEntry(wrap: *@This(), name: bun.Semver.String, field: Field, buf: []const u8) void {
                const value_str = field.value;
                var key = jsc.ZigString.initUTF8(name.slice(buf));

                if (field.is_file) {
                    const filename_str = field.filename.slice(buf);

                    var blob = jsc.WebCore.Blob.create(value_str, bun.default_allocator, wrap.globalThis, false);
                    defer blob.detach();
                    var filename = jsc.ZigString.initUTF8(filename_str);
                    const content_type: []const u8 = brk: {
                        if (!field.content_type.isEmpty()) {
                            break :brk field.content_type.slice(buf);
                        }
                        if (filename_str.len > 0) {
                            const extension = std.fs.path.extension(filename_str);
                            if (extension.len > 0) {
                                if (bun.http.MimeType.byExtensionNoDefault(extension[1..extension.len])) |mime| {
                                    break :brk mime.value;
                                }
                            }
                        }

                        if (bun.http.MimeType.sniff(value_str)) |mime| {
                            break :brk mime.value;
                        }

                        break :brk "";
                    };

                    if (content_type.len > 0) {
                        if (!field.content_type.isEmpty()) {
                            blob.content_type_allocated = true;
                            blob.content_type = bun.default_allocator.dupe(u8, content_type) catch @panic("failed to allocate memory for blob content type");
                            blob.content_type_was_set = true;
                        } else {
                            blob.content_type = content_type;
                            blob.content_type_was_set = false;
                            blob.content_type_allocated = false;
                        }
                    }

                    wrap.form.appendBlob(wrap.globalThis, &key, &blob, &filename);
                } else {
                    var value = jsc.ZigString.initUTF8(
                        // > Each part whose `Content-Disposition` header does not
                        // > contain a `filename` parameter must be parsed into an
                        // > entry whose value is the UTF-8 decoded without BOM
                        // > content of the part. This is done regardless of the
                        // > presence or the value of a `Content-Type` header and
                        // > regardless of the presence or the value of a
                        // > `charset` parameter.
                        strings.withoutUTF8BOM(value_str),
                    );
                    wrap.form.append(&key, &value);
                }
            }
        };

        {
            var wrap = Wrapper{
                .globalThis = globalThis,
                .form = form,
            };

            forEachMultipartEntry(input, boundary, *Wrapper, &wrap, Wrapper.onEntry) catch |err| {
                log("failed to parse multipart data", .{});
                return err;
            };
        }

        return form_data_value;
    }

    pub fn forEachMultipartEntry(
        input: []const u8,
        boundary: []const u8,
        comptime Ctx: type,
        ctx: Ctx,
        comptime iterator: fn (
            Ctx,
            bun.Semver.String,
            Field,
            string,
        ) void,
    ) !void {
        var slice = input;
        var subslicer = bun.Semver.SlicedString.init(input, input);

        var buf: [76]u8 = undefined;
        {
            const final_boundary = std.fmt.bufPrint(&buf, "--{s}--", .{boundary}) catch |err| {
                if (err == error.NoSpaceLeft) {
                    return error.@"boundary is too long";
                }

                return err;
            };
            const final_boundary_index = strings.lastIndexOf(input, final_boundary);
            if (final_boundary_index == null) {
                return error.@"missing final boundary";
            }
            slice = slice[0..final_boundary_index.?];
        }

        const separator = try std.fmt.bufPrint(&buf, "--{s}\r\n", .{boundary});
        var splitter = strings.split(slice, separator);
        _ = splitter.next(); // skip first boundary

        while (splitter.next()) |chunk| {
            var remain = chunk;
            const header_end = strings.indexOf(remain, "\r\n\r\n") orelse return error.@"is missing header end";
            const header = remain[0 .. header_end + 2];
            remain = remain[header_end + 4 ..];

            var field = Field{};
            var name: bun.Semver.String = .{};
            var filename: ?bun.Semver.String = null;
            var header_chunk = header;
            var is_file = false;
            while (header_chunk.len > 0 and (filename == null or name.len() == 0)) {
                const line_end = strings.indexOf(header_chunk, "\r\n") orelse return error.@"is missing header line end";
                const line = header_chunk[0..line_end];
                header_chunk = header_chunk[line_end + 2 ..];
                const colon = strings.indexOf(line, ":") orelse return error.@"is missing header colon separator";

                const key = line[0..colon];
                var value = if (line.len > colon + 1) line[colon + 1 ..] else "";
                if (strings.eqlCaseInsensitiveASCII(key, "content-disposition", true)) {
                    value = strings.trim(value, " ");
                    if (strings.hasPrefixComptime(value, "form-data;")) {
                        value = value["form-data;".len..];
                        value = strings.trim(value, " ");
                    }

                    while (strings.indexOf(value, "=")) |eql_start| {
                        const eql_key = strings.trim(value[0..eql_start], " ;");
                        value = value[eql_start + 1 ..];
                        if (strings.hasPrefixComptime(value, "\"")) {
                            value = value[1..];
                        }

                        var field_value = value;
                        {
                            var i: usize = 0;
                            while (i < field_value.len) : (i += 1) {
                                switch (field_value[i]) {
                                    '"' => {
                                        field_value = field_value[0..i];
                                        break;
                                    },
                                    '\\' => {
                                        i += @intFromBool(field_value.len > i + 1 and field_value[i + 1] == '"');
                                    },
                                    // the spec requires a end quote, but some browsers don't send it
                                    else => {},
                                }
                            }
                            value = value[@min(i + 1, value.len)..];
                        }

                        if (strings.eqlCaseInsensitiveASCII(eql_key, "name", true)) {
                            name = subslicer.sub(field_value).value();
                        } else if (strings.eqlCaseInsensitiveASCII(eql_key, "filename", true)) {
                            filename = subslicer.sub(field_value).value();
                            is_file = true;
                        }

                        if (!name.isEmpty() and filename != null) {
                            break;
                        }

                        if (strings.indexOfChar(value, ';')) |semi_start| {
                            value = value[semi_start + 1 ..];
                        } else {
                            break;
                        }
                    }
                } else if (value.len > 0 and field.content_type.isEmpty() and strings.eqlCaseInsensitiveASCII(key, "content-type", true)) {
                    field.content_type = subslicer.sub(strings.trim(value, "; \t")).value();
                }
            }

            if (name.len() + @as(usize, field.zero_count) == 0) {
                continue;
            }

            var body = remain;
            if (strings.endsWithComptime(body, "\r\n")) {
                body = body[0 .. body.len - 2];
            }
            field.value = body;
            field.filename = filename orelse .{};
            field.is_file = is_file;

            iterator(ctx, name, field, input);
        }
    }
};

const string = []const u8;

const std = @import("std");

const bun = @import("bun");
const Output = bun.Output;
const jsc = bun.jsc;
const strings = bun.strings;
