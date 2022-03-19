const std = @import("std");
const bun = @import("../global.zig");
const string = bun.string;
const Output = bun.Output;
const Global = bun.Global;
const Environment = bun.Environment;
const strings = bun.strings;
const MutableString = bun.MutableString;
const stringZ = bun.stringZ;
const default_allocator = bun.default_allocator;
const C = bun.C;

const Loader = @import("../options.zig").Loader;
const ComptimeStringMap = bun.ComptimeStringMap;

const MimeType = @This();

value: string,
category: Category,

pub fn canOpenInEditor(this: MimeType) bool {
    if (this.category == .text or this.category.isCode())
        return true;

    if (this.category == .image) {
        return strings.eqlComptime(this.value, "image/svg+xml");
    }

    return false;
}

pub const Category = enum {
    image,
    text,
    html,
    font,
    other,
    css,
    json,
    audio,
    video,
    javascript,
    wasm,

    pub fn isCode(this: Category) bool {
        return switch (this) {
            .wasm, .json, .css, .html, .javascript => true,
            else => false,
        };
    }

    pub fn isTextLike(this: Category) bool {
        return switch (this) {
            .javascript, .html, .text, .css, .json => true,
            else => false,
        };
    }
};

pub const other = MimeType.initComptime("application/octet-stream", .other);
pub const css = MimeType.initComptime("text/css", .css);
pub const javascript = MimeType.initComptime("text/javascript;charset=utf-8", .javascript);
pub const ico = MimeType.initComptime("image/vnd.microsoft.icon", .image);
pub const html = MimeType.initComptime("text/html;charset=utf-8", .html);
// we transpile json to javascript so that it is importable without import assertions.
pub const json = MimeType.initComptime("application/json;charset=utf-8", .json);
pub const transpiled_json = javascript;
pub const text = MimeType.initComptime("text/plain;charset=utf-8", .html);

fn initComptime(comptime str: string, t: Category) MimeType {
    return MimeType{
        .value = str,
        .category = t,
    };
}

pub fn init(str_: string) MimeType {
    var str = str_;
    if (std.mem.indexOfScalar(u8, str, '/')) |slash| {
        const category_ = str[0..slash];

        if (category_.len == 0 or category_[0] == '*' or str.len <= slash + 1) {
            return other;
        }

        str = str[slash + 1 ..];

        if (std.mem.indexOfScalar(u8, str, ';')) |semicolon| {
            str = str[0..semicolon];
        }

        switch (category_.len) {
            "application".len => {
                if (strings.eqlComptimeIgnoreLen(category_, "application")) {
                    if (strings.eqlComptime(str, "json") or strings.eqlComptime(str, "geo+json")) {
                        return json;
                    }
                }
            },
            "font".len => {
                if (strings.eqlComptimeIgnoreLen(category_, "font")) {
                    return MimeType{
                        .value = str,
                        .category = .font,
                    };
                }

                if (strings.eqlComptimeIgnoreLen(category_, "text")) {
                    if (strings.eqlComptime(str, "css")) {
                        return css;
                    }

                    if (strings.eqlComptime(str, "html")) {
                        return html;
                    }

                    if (strings.eqlComptime(str, "javascript")) {
                        return javascript;
                    }

                    if (strings.eqlComptime(str, "plain")) {
                        return MimeType{ .value = "text/plain", .category = .text };
                    }
                }
            },
            "image".len => {
                if (strings.eqlComptimeIgnoreLen(category_, "image")) {
                    return MimeType{
                        .value = str,
                        .category = .image,
                    };
                }
            },
            else => {},
        }
    }

    return MimeType{ .value = str, .category = .other };
}

// TODO: improve this
pub fn byLoader(loader: Loader, ext: string) MimeType {
    switch (loader) {
        .tsx, .ts, .js, .jsx, .json => {
            return javascript;
        },
        .css => {
            return css;
        },
        else => {
            return byExtension(ext);
        },
    }
}

const extensions = ComptimeStringMap(MimeType, .{
    .{ "bun", javascript },
    .{ "jsx", javascript },
    .{ "js", javascript },
    .{ "css", css },
    .{ "jpg", MimeType.initComptime("image/jpeg", .image) },
    .{ "gif", MimeType.initComptime("image/gif", .image) },
    .{ "png", MimeType.initComptime("image/png", .image) },
    .{ "bmp", MimeType.initComptime("image/bmp", .image) },
    .{ "wav", MimeType.initComptime("audio/wave", .audio) },
    .{ "aac", MimeType.initComptime("audio/aic", .audio) },
    .{ "mp4", MimeType.initComptime("video/mp4", .video) },
    .{ "htm", MimeType.initComptime("text/html;charset=utf-8", .html) },
    .{ "xml", MimeType.initComptime("text/xml", .other) },
    .{ "zip", MimeType.initComptime("application/zip", .other) },
    .{ "txt", MimeType.initComptime("text/plain", .other) },
    .{ "ttf", MimeType.initComptime("font/ttf", .font) },
    .{ "otf", MimeType.initComptime("font/otf", .font) },
    .{ "ico", ico },
    .{ "mp3", MimeType.initComptime("audio/mpeg", .video) },
    .{ "svg", MimeType.initComptime("image/svg+xml", .image) },
    .{ "csv", MimeType.initComptime("text/csv", .other) },
    .{ "mid", MimeType.initComptime("audio/mid", .audio) },
    .{ "mid", MimeType.initComptime("audio/mid", .audio) },
    .{ "json", MimeType.json },
    .{ "map", MimeType.json }, // source map
    .{ "jpeg", MimeType.initComptime("image/jpeg", .image) },
    .{ "aiff", MimeType.initComptime("image/png", .image) },
    .{ "tiff", MimeType.initComptime("image/tiff", .image) },
    .{ "html", MimeType.html },
    .{
        "wasm", MimeType.initComptime(
            "application/wasm",
            .wasm,
        ),
    },
    .{ "woff", MimeType.initComptime("font/woff", .font) },
    .{ "webm", MimeType.initComptime("video/webm", .video) },
    .{ "webp", MimeType.initComptime("image/webp", .image) },
    .{ "midi", MimeType.initComptime("audio/midi", .audio) },
    .{ "woff2", MimeType.initComptime("font/woff2", .font) },
    .{ "xhtml", MimeType.initComptime("application/xhtml+xml;charset=utf-8", .html) },
});

// TODO: improve this
pub fn byExtension(ext: string) MimeType {
    return extensions.get(ext) orelse MimeType.other;
}
