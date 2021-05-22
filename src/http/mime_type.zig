const std = @import("std");
usingnamespace @import("global.zig");

const Two = strings.ExactSizeMatcher(2);
const Four = strings.ExactSizeMatcher(4);

const MimeType = @This();

value: string,
category: Category,

pub const Category = enum {
    image,
    text,
    html,
    font,
    other,
    json,
    video,
    javascript,
    wasm,
};

pub const other = MimeType.init("application/octet-stream", .other);

fn init(comptime str: string, t: Category) MimeType {
    return comptime {
        return MimeType{
            .value = str,
            .category = t,
        };
    };
}

// TODO: improve this
pub fn byExtension(_ext: string) MimeType {
    const ext = _ext[1..];
    switch (ext.len) {
        2 => {
            return switch (Two.hashUnsafe(ext)) {
                Two.case("js") => MimeType.init("application/javascript;charset=utf-8", .javascript),
                else => MimeType.other,
            };
        },
        3 => {
            const four = [4]u8{ ext[0], ext[1], ext[2], 0 };
            return switch (std.mem.readIntNative(u32, &four)) {
                Four.case("css\\0") => MimeType.init("text/css;charset=utf-8", .css),
                Four.case("jpg\\0") => MimeType.init("image/jpeg", .image),
                Four.case("gif\\0") => MimeType.init("image/gif", .image),
                Four.case("png\\0") => MimeType.init("image/png", .image),
                Four.case("bmp\\0") => MimeType.init("image/bmp", .image),
                Four.case("mjs\\0") => MimeType.init("text/javascript;charset=utf-8", .javascript),
                Four.case("wav\\0") => MimeType.init("audio/wave", .audio),
                Four.case("aac\\0") => MimeType.init("audio/aic", .audio),
                Four.case("mp4\\0") => MimeType.init("video/mp4", .video),
                Four.case("htm\\0") => MimeType.init("text/html;charset=utf-8", .html),
                Four.case("xml\\0") => MimeType.init("text/xml", .other),
                Four.case("zip\\0") => MimeType.init("application/zip", .other),
                Four.case("txt\\0") => MimeType.init("text/plain", .other),
                Four.case("ttf\\0") => MimeType.init("font/ttf", .font),
                Four.case("otf\\0") => MimeType.init("font/otf", .font),
                Four.case("ico\\0") => MimeType.init("image/vnd.microsoft.icon", .image),
                Four.case("mp3\\0") => MimeType.init("audio/mpeg", .video),
                Four.case("svg\\0") => MimeType.init("image/svg+xml", .image),
                Four.case("csv\\0") => MimeType.init("text/csv", .other),
                Four.case("mid\\0") => MimeType.init("audio/mid", .audio),
                else => MimeType.other,
            };
        },
        4 => {
            return switch (Four.hashUnsafe(ext)) {
                Four.case("json") => MimeType.init("application/json", .json),
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
                Eight.case("woff2\\0\\0\\0") => MimeType.init("font/woff2", .font),
                Eight.case("xhtml\\0\\0\\0") => MimeType.init("application/xhtml+xml", .html),
                else => MimeType.other,
            };
        },
        else => MimeType.other,
    }
}
