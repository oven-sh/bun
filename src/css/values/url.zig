const std = @import("std");
const bun = @import("root").bun;
pub const css = @import("../css_parser.zig");
const Result = css.Result;
const ArrayList = std.ArrayListUnmanaged;
const Printer = css.Printer;
const PrintErr = css.PrintErr;
const CSSNumber = css.css_values.number.CSSNumber;
const CSSNumberFns = css.css_values.number.CSSNumberFns;
const Calc = css.css_values.calc.Calc;
const DimensionPercentage = css.css_values.percentage.DimensionPercentage;
const LengthPercentage = css.css_values.length.LengthPercentage;
const Length = css.css_values.length.Length;
const Percentage = css.css_values.percentage.Percentage;
const CssColor = css.css_values.color.CssColor;
const Image = css.css_values.image.Image;
const CSSInteger = css.css_values.number.CSSInteger;
const CSSIntegerFns = css.css_values.number.CSSIntegerFns;
const Angle = css.css_values.angle.Angle;
const Time = css.css_values.time.Time;
const Resolution = css.css_values.resolution.Resolution;
const CustomIdent = css.css_values.ident.CustomIdent;
const CustomIdentFns = css.css_values.ident.CustomIdentFns;
const Ident = css.css_values.ident.Ident;
const UrlDependency = css.dependencies.UrlDependency;

/// A CSS [url()](https://www.w3.org/TR/css-values-4/#urls) value and its source location.
pub const Url = struct {
    /// The url string.
    url: []const u8,
    /// The location where the `url()` was seen in the CSS source file.
    loc: css.dependencies.Location,

    const This = @This();

    pub fn parse(input: *css.Parser) Result(Url) {
        const loc = input.currentSourceLocation();
        const url = switch (input.expectUrl()) {
            .result => |vv| vv,
            .err => |e| return .{ .err = e },
        };
        return .{ .result = Url{ .url = url, .loc = css.dependencies.Location.fromSourceLocation(loc) } };
    }

    /// Returns whether the URL is absolute, and not relative.
    pub fn isAbsolute(this: *const This) bool {
        const url = this.url;

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
        comptime W: type,
        dest: *Printer(W),
    ) PrintErr!void {
        const dep: ?UrlDependency = if (dest.dependencies != null)
            UrlDependency.new(dest.allocator, this, dest.filename())
        else
            null;

        // If adding dependencies, always write url() with quotes so that the placeholder can
        // be replaced without escaping more easily. Quotes may be removed later during minification.
        if (dep) |d| {
            try dest.writeStr("url(");
            css.serializer.serializeString(d.placeholder, dest) catch return dest.addFmtError();
            try dest.writeChar(')');

            if (dest.dependencies) |*dependencies| {
                dependencies.append(dest.allocator, css.Dependency{ .Url = d }) catch bun.outOfMemory();
            }

            return;
        }

        if (dest.minify) {
            var buf = ArrayList(u8){};
            // PERF(alloc) we could use stack fallback here?
            var bufw = buf.writer(dest.allocator);
            const BufW = @TypeOf(bufw);
            defer buf.deinit();
            try (css.Token{ .unquoted_url = this.url }).toCss(BufW, &bufw);

            // If the unquoted url is longer than it would be quoted (e.g. `url("...")`)
            // then serialize as a string and choose the shorter version.
            if (buf.items.len > this.url.len + 7) {
                var buf2 = ArrayList(u8){};
                defer buf2.deinit();
                // PERF(alloc) we could use stack fallback here?
                bufw = buf2.writer(dest.allocator);
                try css.serializer.serializeString(this.url, BufW, &bufw);
                if (buf2.items.len + 5 < buf.items.len) {
                    try dest.writeStr("url(");
                    try dest.writeStr(buf2.items);
                    return dest.writeChar(')');
                }
            }

            try dest.writeStr(buf.items);
        } else {
            try dest.writeStr("url(");
            try css.serializer.serializeString(this.url, W, dest);
            try dest.writeChar(')');
        }
    }
};
