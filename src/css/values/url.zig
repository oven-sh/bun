pub const css = @import("../css_parser.zig");
const Result = css.Result;
const Printer = css.Printer;
const PrintErr = css.PrintErr;
const UrlDependency = css.dependencies.UrlDependency;

/// A CSS [url()](https://www.w3.org/TR/css-values-4/#urls) value and its source location.
pub const Url = struct {
    /// The url string.
    import_record_idx: u32,
    /// The location where the `url()` was seen in the CSS source file.
    loc: css.dependencies.Location,

    const This = @This();

    pub fn parse(input: *css.Parser) Result(Url) {
        const start_pos = input.position();
        const loc = input.currentSourceLocation();
        const url = switch (input.expectUrl()) {
            .result => |vv| vv,
            .err => |e| return .{ .err = e },
        };
        const import_record_idx = switch (input.addImportRecord(url, start_pos, .url)) {
            .result => |idx| idx,
            .err => |e| return .{ .err = e },
        };
        return .{ .result = Url{ .import_record_idx = import_record_idx, .loc = css.dependencies.Location.fromSourceLocation(loc) } };
    }

    /// Returns whether the URL is absolute, and not relative.
    pub fn isAbsolute(this: *const This, import_records: *const bun.BabyList(bun.ImportRecord)) bool {
        const url = import_records.at(this.import_record_idx).path.pretty;

        // Quick checks. If the url starts with '.', it is relative.
        if (bun.strings.startsWithChar(url, '.')) {
            return false;
        }

        // If the url starts with '/' it is absolute.
        if (bun.strings.startsWithChar(url, '/')) {
            return true;
        }

        // If the url starts with '#' we have a fragment URL.
        // These are resolved relative to the document rather than the CSS file.
        // https://drafts.csswg.org/css-values-4/#local-urls
        if (bun.strings.startsWithChar(url, '#')) {
            return true;
        }

        // Otherwise, we might have a scheme. These must start with an ascii alpha character.
        // https://url.spec.whatwg.org/#scheme-start-state
        if (url.len == 0 or !std.ascii.isAlphabetic(url[0])) {
            return false;
        }

        // https://url.spec.whatwg.org/#scheme-state
        for (url) |c| {
            switch (c) {
                'a'...'z', 'A'...'Z', '0'...'9', '+', '-', '.' => {},
                ':' => return true,
                else => break,
            }
        }

        return false;
    }

    pub fn toCss(
        this: *const This,
        dest: *Printer,
    ) PrintErr!void {
        const dep: ?UrlDependency = if (dest.dependencies != null)
            UrlDependency.new(dest.allocator, this, dest.filename(), try dest.getImportRecords())
        else
            null;

        // If adding dependencies, always write url() with quotes so that the placeholder can
        // be replaced without escaping more easily. Quotes may be removed later during minification.
        if (dep) |d| {
            try dest.writeStr("url(");
            css.serializer.serializeString(d.placeholder, dest) catch return dest.addFmtError();
            try dest.writeChar(')');

            if (dest.dependencies) |*dependencies| {
                bun.handleOom(dependencies.append(dest.allocator, css.Dependency{ .url = d }));
            }

            return;
        }

        const import_record = try dest.importRecord(this.import_record_idx);
        const url = try dest.getImportRecordUrl(this.import_record_idx);

        if (dest.minify and !import_record.flags.is_internal) {
            var buf = std.Io.Writer.Allocating.init(dest.allocator);
            defer buf.deinit();
            // PERF(alloc) we could use stack fallback here?
            css.Token.toCssGeneric(&css.Token{ .unquoted_url = url }, &buf.writer) catch return dest.addFmtError();

            // If the unquoted url is longer than it would be quoted (e.g. `url("...")`)
            // then serialize as a string and choose the shorter version.
            if (buf.written().len > url.len + 7) {
                var buf2 = std.Io.Writer.Allocating.init(dest.allocator);
                defer buf2.deinit();
                // PERF(alloc) we could use stack fallback here?
                css.serializer.serializeString(url, &buf2.writer) catch return dest.addFmtError();
                if (buf2.written().len + 5 < buf.written().len) {
                    try dest.writeStr("url(");
                    try dest.writeStr(buf2.written());
                    return dest.writeChar(')');
                }
            }

            try dest.writeStr(buf.written());
        } else {
            try dest.writeStr("url(");
            css.serializer.serializeString(url, dest) catch return dest.addFmtError();
            try dest.writeChar(')');
        }
    }

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }

    // TODO: dedupe import records??
    // This might not fucking work
    pub fn eql(this: *const Url, other: *const Url) bool {
        return this.import_record_idx == other.import_record_idx;
    }

    // TODO: dedupe import records??
    // This might not fucking work
    pub fn hash(this: *const @This(), hasher: *std.hash.Wyhash) void {
        return css.implementHash(@This(), this, hasher);
    }
};

const bun = @import("bun");
const std = @import("std");
