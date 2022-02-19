const std = @import("std");
const _global = @import("../global.zig");
const string = _global.string;
const Output = _global.Output;
const Global = _global.Global;
const Environment = _global.Environment;
const strings = _global.strings;
const MutableString = _global.MutableString;
const stringZ = _global.stringZ;
const default_allocator = _global.default_allocator;
const C = _global.C;

const Loader = @import("../options.zig").Loader;
const Two = strings.ExactSizeMatcher(2);
const Four = strings.ExactSizeMatcher(4);
const Eight = strings.ExactSizeMatcher(8);

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
pub const json = MimeType.initComptime("application/json", .json);
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

// TODO: improve this
pub fn byExtension(ext: string) MimeType {
    return switch (ext.len) {
        2 => {
            return switch (std.mem.readIntNative(u16, ext[0..2])) {
                Two.case("js") => javascript,
                else => MimeType.other,
            };
        },
        3 => {
            const four = [4]u8{ ext[0], ext[1], ext[2], 0 };
            return switch (std.mem.readIntNative(u32, &four)) {
                Four.case("bun") => javascript,

                Four.case("css") => css,
                Four.case("jpg") => MimeType.initComptime("image/jpeg", .image),
                Four.case("gif") => MimeType.initComptime("image/gif", .image),
                Four.case("png") => MimeType.initComptime("image/png", .image),
                Four.case("bmp") => MimeType.initComptime("image/bmp", .image),
                Four.case("jsx"), Four.case("mjs") => MimeType.javascript,
                Four.case("wav") => MimeType.initComptime("audio/wave", .audio),
                Four.case("aac") => MimeType.initComptime("audio/aic", .audio),
                Four.case("mp4") => MimeType.initComptime("video/mp4", .video),
                Four.case("htm") => MimeType.initComptime("text/html;charset=utf-8", .html),
                Four.case("xml") => MimeType.initComptime("text/xml", .other),
                Four.case("zip") => MimeType.initComptime("application/zip", .other),
                Four.case("txt") => MimeType.initComptime("text/plain", .other),
                Four.case("ttf") => MimeType.initComptime("font/ttf", .font),
                Four.case("otf") => MimeType.initComptime("font/otf", .font),
                Four.case("ico") => ico,
                Four.case("mp3") => MimeType.initComptime("audio/mpeg", .video),
                Four.case("svg") => MimeType.initComptime("image/svg+xml", .image),
                Four.case("csv") => MimeType.initComptime("text/csv", .other),
                Four.case("mid") => MimeType.initComptime("audio/mid", .audio),
                else => MimeType.other,
            };
        },
        4 => {
            return switch (Four.match(ext)) {
                Four.case("json") => MimeType.json,
                Four.case("jpeg") => MimeType.initComptime("image/jpeg", .image),
                Four.case("aiff") => MimeType.initComptime("image/png", .image),
                Four.case("tiff") => MimeType.initComptime("image/tiff", .image),
                Four.case("html") => MimeType.html,
                Four.case("wasm") => MimeType.initComptime(
                    "application/wasm",
                    .wasm,
                ),
                Four.case("woff") => MimeType.initComptime("font/woff", .font),
                Four.case("webm") => MimeType.initComptime("video/webm", .video),
                Four.case("webp") => MimeType.initComptime("image/webp", .image),
                Four.case("midi") => MimeType.initComptime("audio/midi", .audio),
                else => MimeType.other,
            };
        },
        5 => {
            const eight = [8]u8{ ext[0], ext[1], ext[2], ext[3], ext[4], 0, 0, 0 };
            return switch (std.mem.readIntNative(u64, &eight)) {
                Eight.case("woff2") => MimeType.initComptime("font/woff2", .font),
                Eight.case("xhtml") => MimeType.initComptime("application/xhtml+xml;charset=utf-8", .html),
                else => MimeType.other,
            };
        },
        else => MimeType.other,
    };
}
