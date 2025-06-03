/// https://encoding.spec.whatwg.org/encodings.json
pub const EncodingLabel = enum {
    // commented out = not supported yet
    @"UTF-8",
    // IBM866,
    // @"ISO-8859-2",
    // @"ISO-8859-3",
    // @"ISO-8859-4",
    // @"ISO-8859-5",
    // @"ISO-8859-6",
    // @"ISO-8859-7",
    // @"ISO-8859-8",
    // @"ISO-8859-8-I",
    // @"ISO-8859-10",
    // @"ISO-8859-13",
    // @"ISO-8859-14",
    // @"ISO-8859-15",
    // @"ISO-8859-16",
    // @"KOI8-R",
    // @"KOI8-U",
    // macintosh,
    // @"windows-874",
    // @"windows-1250",
    // @"windows-1251",
    /// Also known as
    /// - ASCII
    /// - latin1
    @"windows-1252",
    // @"windows-1253",
    // @"windows-1254",
    // @"windows-1255",
    // @"windows-1256",
    // @"windows-1257",
    // @"windows-1258",
    // @"x-mac-cyrillic",
    // Big5,
    // @"EUC-JP",
    // @"ISO-2022-JP",
    // Shift_JIS,
    // @"EUC-KR",
    @"UTF-16BE",
    @"UTF-16LE",
    // @"x-user-defined",

    pub fn getLabel(this: EncodingLabel) []const u8 {
        return switch (this) {
            .@"UTF-8" => "utf-8",
            .@"UTF-16LE" => "utf-16le",
            .@"UTF-16BE" => "utf-16be",
            .@"windows-1252" => "windows-1252",
        };
    }

    pub const latin1 = EncodingLabel.@"windows-1252";

    const string_map = bun.ComptimeStringMap(EncodingLabel, .{
        .{ "l1", latin1 },
        .{ "ascii", latin1 },
        .{ "cp819", latin1 },
        .{ "cp1252", latin1 },
        .{ "ibm819", latin1 },
        .{ "latin1", latin1 },
        .{ "iso88591", latin1 },
        .{ "us-ascii", latin1 },
        .{ "x-cp1252", latin1 },
        .{ "iso8859-1", latin1 },
        .{ "iso_8859-1", latin1 },
        .{ "iso-8859-1", latin1 },
        .{ "iso-ir-100", latin1 },
        .{ "csisolatin1", latin1 },
        .{ "windows-1252", latin1 },
        .{ "ansi_x3.4-1968", latin1 },
        .{ "iso_8859-1:1987", latin1 },

        .{ "ucs-2", .@"UTF-16LE" },
        .{ "utf-16", .@"UTF-16LE" },
        .{ "unicode", .@"UTF-16LE" },
        .{ "utf-16le", .@"UTF-16LE" },
        .{ "csunicode", .@"UTF-16LE" },
        .{ "unicodefeff", .@"UTF-16LE" },
        .{ "iso-10646-ucs-2", .@"UTF-16LE" },

        .{ "utf-16be", .@"UTF-16BE" },

        .{ "utf8", .@"UTF-8" },
        .{ "utf-8", .@"UTF-8" },
        .{ "unicode11utf8", .@"UTF-8" },
        .{ "unicode20utf8", .@"UTF-8" },
        .{ "x-unicode20utf8", .@"UTF-8" },
        .{ "unicode-1-1-utf-8", .@"UTF-8" },
    });

    pub fn which(input_: string) ?EncodingLabel {
        const input = strings.trim(input_, " \t\r\n");
        return string_map.getAnyCase(input);
    }
};
const bun = @import("bun");
const encoding = @import("encoding.zig");
const string = []const u8;
const strings = bun.strings;
