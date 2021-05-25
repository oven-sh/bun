const std = @import("std");
usingnamespace @import("../global.zig");

const Loader = @import("../options.zig").Loader;
const Two = strings.ExactSizeMatcher(2);
const Four = strings.ExactSizeMatcher(4);
const Eight = strings.ExactSizeMatcher(8);

const MimeType = @This();

value: string,
category: Category,

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
};

pub const other = MimeType.init("application/octet-stream", .other);
pub const css = MimeType.init("application/octet-stream", .other);
pub const javascript = MimeType.init("text/javascript;charset=utf-8", .javascript);

fn init(comptime str: string, t: Category) MimeType {
    return MimeType{
        .value = str,
        .category = t,
    };
}

// TODO: improve this
pub fn byLoader(loader: Loader, ext: string) MimeType {
    switch (loader) {
        .tsx, .ts, .js, .jsx => {
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
                Four.case("css") => css,
                Four.case("jpg") => MimeType.init("image/jpeg", .image),
                Four.case("gif") => MimeType.init("image/gif", .image),
                Four.case("png") => MimeType.init("image/png", .image),
                Four.case("bmp") => MimeType.init("image/bmp", .image),
                Four.case("jsx"), Four.case("mjs") => MimeType.javascript,
                Four.case("wav") => MimeType.init("audio/wave", .audio),
                Four.case("aac") => MimeType.init("audio/aic", .audio),
                Four.case("mp4") => MimeType.init("video/mp4", .video),
                Four.case("htm") => MimeType.init("text/html;charset=utf-8", .html),
                Four.case("xml") => MimeType.init("text/xml", .other),
                Four.case("zip") => MimeType.init("application/zip", .other),
                Four.case("txt") => MimeType.init("text/plain", .other),
                Four.case("ttf") => MimeType.init("font/ttf", .font),
                Four.case("otf") => MimeType.init("font/otf", .font),
                Four.case("ico") => MimeType.init("image/vnd.microsoft.icon", .image),
                Four.case("mp3") => MimeType.init("audio/mpeg", .video),
                Four.case("svg") => MimeType.init("image/svg+xml", .image),
                Four.case("csv") => MimeType.init("text/csv", .other),
                Four.case("mid") => MimeType.init("audio/mid", .audio),
                else => MimeType.other,
            };
        },
        4 => {
            return switch (Four.match(ext)) {
                Four.case("json") => MimeType.init("application/json;charset=utf-8", .json),
                Four.case("jpeg") => MimeType.init("image/jpeg", .image),
                Four.case("aiff") => MimeType.init("image/png", .image),
                Four.case("tiff") => MimeType.init("image/tiff", .image),
                Four.case("html") => MimeType.init("text/html;charset=utf-8", .html),
                Four.case("wasm") => MimeType.init(
                    "application/wasm",
                    .wasm,
                ),
                Four.case("woff") => MimeType.init("font/woff", .font),
                Four.case("webm") => MimeType.init("video/webm", .video),
                Four.case("webp") => MimeType.init("image/webp", .image),
                Four.case("midi") => MimeType.init("audio/midi", .audio),
                else => MimeType.other,
            };
        },
        5 => {
            const eight = [8]u8{ ext[0], ext[1], ext[2], ext[3], ext[4], 0, 0, 0 };
            return switch (std.mem.readIntNative(u64, &eight)) {
                Eight.case("woff2") => MimeType.init("font/woff2", .font),
                Eight.case("xhtml") => MimeType.init("application/xhtml+xml;charset=utf-8", .html),
                else => MimeType.other,
            };
        },
        else => MimeType.other,
    };
}
