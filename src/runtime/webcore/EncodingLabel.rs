use bun_str::strings;

/// https://encoding.spec.whatwg.org/encodings.json
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum EncodingLabel {
    Utf8,
    Ibm866,
    Iso8859_3,
    Iso8859_6,
    Iso8859_7,
    Iso8859_8,
    Iso8859_8I,
    Koi8U,
    Windows874,
    /// Also known as
    /// - ASCII
    /// - latin1
    Windows1252,
    Windows1253,
    Windows1255,
    Windows1257,
    Big5,
    EucJp,
    Iso2022Jp,
    ShiftJis,
    EucKr,
    Utf16Be,
    Utf16Le,
    XUserDefined,
    Replacement,
    Gbk,
    Gb18030,
}

impl EncodingLabel {
    pub fn get_label(self) -> &'static [u8] {
        match self {
            Self::Utf8 => b"utf-8",
            Self::Utf16Le => b"utf-16le",
            Self::Utf16Be => b"utf-16be",
            Self::Windows1252 => b"windows-1252",
            Self::Ibm866 => b"ibm866",
            Self::Iso8859_3 => b"iso-8859-3",
            Self::Iso8859_6 => b"iso-8859-6",
            Self::Iso8859_7 => b"iso-8859-7",
            Self::Iso8859_8 => b"iso-8859-8",
            Self::Iso8859_8I => b"iso-8859-8-i",
            Self::Koi8U => b"koi8-u",
            Self::Windows874 => b"windows-874",
            Self::Windows1253 => b"windows-1253",
            Self::Windows1255 => b"windows-1255",
            Self::Windows1257 => b"windows-1257",
            Self::Big5 => b"big5",
            Self::EucJp => b"euc-jp",
            Self::Iso2022Jp => b"iso-2022-jp",
            Self::ShiftJis => b"shift_jis",
            Self::EucKr => b"euc-kr",
            Self::XUserDefined => b"x-user-defined",
            Self::Replacement => b"replacement",
            Self::Gbk => b"gbk",
            Self::Gb18030 => b"gb18030",
        }
    }

    pub const LATIN1: EncodingLabel = EncodingLabel::Windows1252;

    pub fn which(input_: &[u8]) -> Option<EncodingLabel> {
        let input = strings::trim(input_, b" \t\r\n\x0C");
        // TODO(port): phf custom hasher — Zig used ComptimeStringMap.getAnyCase (ASCII case-insensitive).
        // All keys in STRING_MAP are already lowercase; Phase B must lowercase `input` before lookup
        // (or use a case-insensitive phf hasher) to preserve behavior.
        STRING_MAP.get(input).copied()
    }
}

static STRING_MAP: phf::Map<&'static [u8], EncodingLabel> = phf::phf_map! {
    // Windows-1252 (Latin1) aliases
    b"l1" => EncodingLabel::LATIN1,
    b"ascii" => EncodingLabel::LATIN1,
    b"cp819" => EncodingLabel::LATIN1,
    b"cp1252" => EncodingLabel::LATIN1,
    b"ibm819" => EncodingLabel::LATIN1,
    b"latin1" => EncodingLabel::LATIN1,
    b"iso88591" => EncodingLabel::LATIN1,
    b"us-ascii" => EncodingLabel::LATIN1,
    b"x-cp1252" => EncodingLabel::LATIN1,
    b"iso8859-1" => EncodingLabel::LATIN1,
    b"iso_8859-1" => EncodingLabel::LATIN1,
    b"iso-8859-1" => EncodingLabel::LATIN1,
    b"iso-ir-100" => EncodingLabel::LATIN1,
    b"csisolatin1" => EncodingLabel::LATIN1,
    b"windows-1252" => EncodingLabel::LATIN1,
    b"ansi_x3.4-1968" => EncodingLabel::LATIN1,
    b"iso_8859-1:1987" => EncodingLabel::LATIN1,

    // UTF-16LE aliases
    b"ucs-2" => EncodingLabel::Utf16Le,
    b"utf-16" => EncodingLabel::Utf16Le,
    b"unicode" => EncodingLabel::Utf16Le,
    b"utf-16le" => EncodingLabel::Utf16Le,
    b"csunicode" => EncodingLabel::Utf16Le,
    b"unicodefeff" => EncodingLabel::Utf16Le,
    b"iso-10646-ucs-2" => EncodingLabel::Utf16Le,

    // UTF-16BE aliases
    b"utf-16be" => EncodingLabel::Utf16Be,

    // UTF-8 aliases
    b"utf8" => EncodingLabel::Utf8,
    b"utf-8" => EncodingLabel::Utf8,
    b"unicode11utf8" => EncodingLabel::Utf8,
    b"unicode20utf8" => EncodingLabel::Utf8,
    b"x-unicode20utf8" => EncodingLabel::Utf8,
    b"unicode-1-1-utf-8" => EncodingLabel::Utf8,

    // IBM866 aliases
    b"ibm866" => EncodingLabel::Ibm866,
    b"cp866" => EncodingLabel::Ibm866,
    b"866" => EncodingLabel::Ibm866,
    b"csibm866" => EncodingLabel::Ibm866,

    // ISO-8859-3 aliases
    b"iso-8859-3" => EncodingLabel::Iso8859_3,
    b"iso8859-3" => EncodingLabel::Iso8859_3,
    b"iso_8859-3" => EncodingLabel::Iso8859_3,
    b"latin3" => EncodingLabel::Iso8859_3,
    b"csisolatin3" => EncodingLabel::Iso8859_3,
    b"iso-ir-109" => EncodingLabel::Iso8859_3,
    b"l3" => EncodingLabel::Iso8859_3,

    // ISO-8859-6 aliases
    b"iso-8859-6" => EncodingLabel::Iso8859_6,
    b"iso8859-6" => EncodingLabel::Iso8859_6,
    b"iso_8859-6" => EncodingLabel::Iso8859_6,
    b"arabic" => EncodingLabel::Iso8859_6,
    b"csisolatinarabic" => EncodingLabel::Iso8859_6,
    b"iso-ir-127" => EncodingLabel::Iso8859_6,
    b"asmo-708" => EncodingLabel::Iso8859_6,
    b"ecma-114" => EncodingLabel::Iso8859_6,

    // ISO-8859-7 aliases
    b"iso-8859-7" => EncodingLabel::Iso8859_7,
    b"iso8859-7" => EncodingLabel::Iso8859_7,
    b"iso_8859-7" => EncodingLabel::Iso8859_7,
    b"greek" => EncodingLabel::Iso8859_7,
    b"greek8" => EncodingLabel::Iso8859_7,
    b"csisolatingreek" => EncodingLabel::Iso8859_7,
    b"iso-ir-126" => EncodingLabel::Iso8859_7,
    b"ecma-118" => EncodingLabel::Iso8859_7,
    b"elot_928" => EncodingLabel::Iso8859_7,

    // ISO-8859-8 aliases
    b"iso-8859-8" => EncodingLabel::Iso8859_8,
    b"iso8859-8" => EncodingLabel::Iso8859_8,
    b"iso_8859-8" => EncodingLabel::Iso8859_8,
    b"hebrew" => EncodingLabel::Iso8859_8,
    b"csisolatinhebrew" => EncodingLabel::Iso8859_8,
    b"iso-ir-138" => EncodingLabel::Iso8859_8,
    b"visual" => EncodingLabel::Iso8859_8,

    // ISO-8859-8-I aliases
    b"iso-8859-8-i" => EncodingLabel::Iso8859_8I,
    b"logical" => EncodingLabel::Iso8859_8I,
    b"csiso88598i" => EncodingLabel::Iso8859_8I,

    // KOI8-U aliases
    b"koi8-u" => EncodingLabel::Koi8U,
    b"koi8-ru" => EncodingLabel::Koi8U,

    // Windows code pages
    b"windows-874" => EncodingLabel::Windows874,
    b"dos-874" => EncodingLabel::Windows874,
    b"iso-8859-11" => EncodingLabel::Windows874,
    b"iso8859-11" => EncodingLabel::Windows874,
    b"iso885911" => EncodingLabel::Windows874,
    b"iso_8859-11" => EncodingLabel::Windows874,
    b"tis-620" => EncodingLabel::Windows874,

    b"windows-1253" => EncodingLabel::Windows1253,
    b"cp1253" => EncodingLabel::Windows1253,
    b"x-cp1253" => EncodingLabel::Windows1253,

    b"windows-1255" => EncodingLabel::Windows1255,
    b"cp1255" => EncodingLabel::Windows1255,
    b"x-cp1255" => EncodingLabel::Windows1255,

    b"windows-1257" => EncodingLabel::Windows1257,
    b"cp1257" => EncodingLabel::Windows1257,
    b"x-cp1257" => EncodingLabel::Windows1257,

    // CJK encodings
    b"big5" => EncodingLabel::Big5,
    b"big5-hkscs" => EncodingLabel::Big5,
    b"cn-big5" => EncodingLabel::Big5,
    b"csbig5" => EncodingLabel::Big5,
    b"x-x-big5" => EncodingLabel::Big5,

    b"euc-jp" => EncodingLabel::EucJp,
    b"cseucpkdfmtjapanese" => EncodingLabel::EucJp,
    b"x-euc-jp" => EncodingLabel::EucJp,

    b"iso-2022-jp" => EncodingLabel::Iso2022Jp,
    b"csiso2022jp" => EncodingLabel::Iso2022Jp,

    b"shift_jis" => EncodingLabel::ShiftJis,
    b"shift-jis" => EncodingLabel::ShiftJis,
    b"sjis" => EncodingLabel::ShiftJis,
    b"csshiftjis" => EncodingLabel::ShiftJis,
    b"ms932" => EncodingLabel::ShiftJis,
    b"ms_kanji" => EncodingLabel::ShiftJis,
    b"windows-31j" => EncodingLabel::ShiftJis,
    b"x-sjis" => EncodingLabel::ShiftJis,

    b"euc-kr" => EncodingLabel::EucKr,
    b"cseuckr" => EncodingLabel::EucKr,
    b"csksc56011987" => EncodingLabel::EucKr,
    b"iso-ir-149" => EncodingLabel::EucKr,
    b"korean" => EncodingLabel::EucKr,
    b"ks_c_5601-1987" => EncodingLabel::EucKr,
    b"ks_c_5601-1989" => EncodingLabel::EucKr,
    b"ksc5601" => EncodingLabel::EucKr,
    b"ksc_5601" => EncodingLabel::EucKr,
    b"windows-949" => EncodingLabel::EucKr,

    // Chinese encodings
    b"gbk" => EncodingLabel::Gbk,
    b"gb2312" => EncodingLabel::Gbk,
    b"chinese" => EncodingLabel::Gbk,
    b"csgb2312" => EncodingLabel::Gbk,
    b"csiso58gb231280" => EncodingLabel::Gbk,
    b"gb_2312" => EncodingLabel::Gbk,
    b"gb_2312-80" => EncodingLabel::Gbk,
    b"iso-ir-58" => EncodingLabel::Gbk,
    b"x-gbk" => EncodingLabel::Gbk,

    b"gb18030" => EncodingLabel::Gb18030,

    // Other
    b"x-user-defined" => EncodingLabel::XUserDefined,
    b"replacement" => EncodingLabel::Replacement,
};

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/webcore/EncodingLabel.zig (239 lines)
//   confidence: medium
//   todos:      1
//   notes:      which() needs ASCII-lowercase before phf lookup (Zig used getAnyCase); phf_map! may need &[u8] key coercion in Phase B
// ──────────────────────────────────────────────────────────────────────────
