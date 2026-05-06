/// https://encoding.spec.whatwg.org/encodings.json
pub const EncodingLabel = enum {
    @"UTF-8",
    IBM866,
    @"ISO-8859-3",
    @"ISO-8859-6",
    @"ISO-8859-7",
    @"ISO-8859-8",
    @"ISO-8859-8-I",
    @"KOI8-U",
    @"windows-874",
    /// Also known as
    /// - ASCII
    /// - latin1
    @"windows-1252",
    @"windows-1253",
    @"windows-1255",
    @"windows-1257",
    Big5,
    @"EUC-JP",
    @"ISO-2022-JP",
    Shift_JIS,
    @"EUC-KR",
    @"UTF-16BE",
    @"UTF-16LE",
    @"x-user-defined",
    replacement,
    GBK,
    GB18030,

    pub fn getLabel(this: EncodingLabel) []const u8 {
        return switch (this) {
            .@"UTF-8" => "utf-8",
            .@"UTF-16LE" => "utf-16le",
            .@"UTF-16BE" => "utf-16be",
            .@"windows-1252" => "windows-1252",
            .IBM866 => "ibm866",
            .@"ISO-8859-3" => "iso-8859-3",
            .@"ISO-8859-6" => "iso-8859-6",
            .@"ISO-8859-7" => "iso-8859-7",
            .@"ISO-8859-8" => "iso-8859-8",
            .@"ISO-8859-8-I" => "iso-8859-8-i",
            .@"KOI8-U" => "koi8-u",
            .@"windows-874" => "windows-874",
            .@"windows-1253" => "windows-1253",
            .@"windows-1255" => "windows-1255",
            .@"windows-1257" => "windows-1257",
            .Big5 => "big5",
            .@"EUC-JP" => "euc-jp",
            .@"ISO-2022-JP" => "iso-2022-jp",
            .Shift_JIS => "shift_jis",
            .@"EUC-KR" => "euc-kr",
            .@"x-user-defined" => "x-user-defined",
            .replacement => "replacement",
            .GBK => "gbk",
            .GB18030 => "gb18030",
        };
    }

    pub const latin1 = EncodingLabel.@"windows-1252";

    const string_map = bun.ComptimeStringMap(EncodingLabel, .{
        // Windows-1252 (Latin1) aliases
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

        // UTF-16LE aliases
        .{ "ucs-2", .@"UTF-16LE" },
        .{ "utf-16", .@"UTF-16LE" },
        .{ "unicode", .@"UTF-16LE" },
        .{ "utf-16le", .@"UTF-16LE" },
        .{ "csunicode", .@"UTF-16LE" },
        .{ "unicodefeff", .@"UTF-16LE" },
        .{ "iso-10646-ucs-2", .@"UTF-16LE" },

        // UTF-16BE aliases
        .{ "utf-16be", .@"UTF-16BE" },

        // UTF-8 aliases
        .{ "utf8", .@"UTF-8" },
        .{ "utf-8", .@"UTF-8" },
        .{ "unicode11utf8", .@"UTF-8" },
        .{ "unicode20utf8", .@"UTF-8" },
        .{ "x-unicode20utf8", .@"UTF-8" },
        .{ "unicode-1-1-utf-8", .@"UTF-8" },

        // IBM866 aliases
        .{ "ibm866", .IBM866 },
        .{ "cp866", .IBM866 },
        .{ "866", .IBM866 },
        .{ "csibm866", .IBM866 },

        // ISO-8859-3 aliases
        .{ "iso-8859-3", .@"ISO-8859-3" },
        .{ "iso8859-3", .@"ISO-8859-3" },
        .{ "iso_8859-3", .@"ISO-8859-3" },
        .{ "latin3", .@"ISO-8859-3" },
        .{ "csisolatin3", .@"ISO-8859-3" },
        .{ "iso-ir-109", .@"ISO-8859-3" },
        .{ "l3", .@"ISO-8859-3" },

        // ISO-8859-6 aliases
        .{ "iso-8859-6", .@"ISO-8859-6" },
        .{ "iso8859-6", .@"ISO-8859-6" },
        .{ "iso_8859-6", .@"ISO-8859-6" },
        .{ "arabic", .@"ISO-8859-6" },
        .{ "csisolatinarabic", .@"ISO-8859-6" },
        .{ "iso-ir-127", .@"ISO-8859-6" },
        .{ "asmo-708", .@"ISO-8859-6" },
        .{ "ecma-114", .@"ISO-8859-6" },

        // ISO-8859-7 aliases
        .{ "iso-8859-7", .@"ISO-8859-7" },
        .{ "iso8859-7", .@"ISO-8859-7" },
        .{ "iso_8859-7", .@"ISO-8859-7" },
        .{ "greek", .@"ISO-8859-7" },
        .{ "greek8", .@"ISO-8859-7" },
        .{ "csisolatingreek", .@"ISO-8859-7" },
        .{ "iso-ir-126", .@"ISO-8859-7" },
        .{ "ecma-118", .@"ISO-8859-7" },
        .{ "elot_928", .@"ISO-8859-7" },

        // ISO-8859-8 aliases
        .{ "iso-8859-8", .@"ISO-8859-8" },
        .{ "iso8859-8", .@"ISO-8859-8" },
        .{ "iso_8859-8", .@"ISO-8859-8" },
        .{ "hebrew", .@"ISO-8859-8" },
        .{ "csisolatinhebrew", .@"ISO-8859-8" },
        .{ "iso-ir-138", .@"ISO-8859-8" },
        .{ "visual", .@"ISO-8859-8" },

        // ISO-8859-8-I aliases
        .{ "iso-8859-8-i", .@"ISO-8859-8-I" },
        .{ "logical", .@"ISO-8859-8-I" },
        .{ "csiso88598i", .@"ISO-8859-8-I" },

        // KOI8-U aliases
        .{ "koi8-u", .@"KOI8-U" },
        .{ "koi8-ru", .@"KOI8-U" },

        // Windows code pages
        .{ "windows-874", .@"windows-874" },
        .{ "dos-874", .@"windows-874" },
        .{ "iso-8859-11", .@"windows-874" },
        .{ "iso8859-11", .@"windows-874" },
        .{ "iso885911", .@"windows-874" },
        .{ "iso_8859-11", .@"windows-874" },
        .{ "tis-620", .@"windows-874" },

        .{ "windows-1253", .@"windows-1253" },
        .{ "cp1253", .@"windows-1253" },
        .{ "x-cp1253", .@"windows-1253" },

        .{ "windows-1255", .@"windows-1255" },
        .{ "cp1255", .@"windows-1255" },
        .{ "x-cp1255", .@"windows-1255" },

        .{ "windows-1257", .@"windows-1257" },
        .{ "cp1257", .@"windows-1257" },
        .{ "x-cp1257", .@"windows-1257" },

        // CJK encodings
        .{ "big5", .Big5 },
        .{ "big5-hkscs", .Big5 },
        .{ "cn-big5", .Big5 },
        .{ "csbig5", .Big5 },
        .{ "x-x-big5", .Big5 },

        .{ "euc-jp", .@"EUC-JP" },
        .{ "cseucpkdfmtjapanese", .@"EUC-JP" },
        .{ "x-euc-jp", .@"EUC-JP" },

        .{ "iso-2022-jp", .@"ISO-2022-JP" },
        .{ "csiso2022jp", .@"ISO-2022-JP" },

        .{ "shift_jis", .Shift_JIS },
        .{ "shift-jis", .Shift_JIS },
        .{ "sjis", .Shift_JIS },
        .{ "csshiftjis", .Shift_JIS },
        .{ "ms932", .Shift_JIS },
        .{ "ms_kanji", .Shift_JIS },
        .{ "windows-31j", .Shift_JIS },
        .{ "x-sjis", .Shift_JIS },

        .{ "euc-kr", .@"EUC-KR" },
        .{ "cseuckr", .@"EUC-KR" },
        .{ "csksc56011987", .@"EUC-KR" },
        .{ "iso-ir-149", .@"EUC-KR" },
        .{ "korean", .@"EUC-KR" },
        .{ "ks_c_5601-1987", .@"EUC-KR" },
        .{ "ks_c_5601-1989", .@"EUC-KR" },
        .{ "ksc5601", .@"EUC-KR" },
        .{ "ksc_5601", .@"EUC-KR" },
        .{ "windows-949", .@"EUC-KR" },

        // Chinese encodings
        .{ "gbk", .GBK },
        .{ "gb2312", .GBK },
        .{ "chinese", .GBK },
        .{ "csgb2312", .GBK },
        .{ "csiso58gb231280", .GBK },
        .{ "gb_2312", .GBK },
        .{ "gb_2312-80", .GBK },
        .{ "iso-ir-58", .GBK },
        .{ "x-gbk", .GBK },

        .{ "gb18030", .GB18030 },

        // Other
        .{ "x-user-defined", .@"x-user-defined" },
        .{ "replacement", .replacement },
    });

    pub fn which(input_: string) ?EncodingLabel {
        const input = strings.trim(input_, " \t\r\n\x0C");
        return string_map.getAnyCase(input);
    }
};
const string = []const u8;

const encoding = @import("./encoding.zig");

const bun = @import("bun");
const strings = bun.strings;
