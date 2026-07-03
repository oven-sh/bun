use bun_core::strings;

/// Every encoding the Encoding Standard defines, keyed by its canonical name.
/// https://encoding.spec.whatwg.org/#names-and-labels
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum EncodingLabel {
    Utf8,
    Ibm866,
    Iso8859_2,
    Iso8859_3,
    Iso8859_4,
    Iso8859_5,
    Iso8859_6,
    Iso8859_7,
    Iso8859_8,
    Iso8859_8I,
    Iso8859_10,
    Iso8859_13,
    Iso8859_14,
    Iso8859_15,
    Iso8859_16,
    Koi8R,
    Koi8U,
    Macintosh,
    Windows874,
    Windows1250,
    Windows1251,
    /// Also known as
    /// - ASCII
    /// - latin1
    Windows1252,
    Windows1253,
    Windows1254,
    Windows1255,
    Windows1256,
    Windows1257,
    Windows1258,
    XMacCyrillic,
    Big5,
    EucJp,
    Iso2022Jp,
    ShiftJis,
    EucKr,
    Utf16Be,
    Utf16Le,
    XUserDefined,
    /// `TextDecoder` must reject this one at construction
    /// (https://encoding.spec.whatwg.org/#dom-textdecoder). It is a distinct
    /// variant so the constructor can tell it apart from an unknown label.
    Replacement,
    Gbk,
    Gb18030,
}

impl EncodingLabel {
    /// The canonical name, lowercased: the value `TextDecoder.prototype.encoding`
    /// reports, and the name used to look up the WebKit `TextCodec`.
    pub fn get_label(self) -> &'static [u8] {
        match self {
            Self::Utf8 => b"utf-8",
            Self::Utf16Le => b"utf-16le",
            Self::Utf16Be => b"utf-16be",
            Self::Windows1252 => b"windows-1252",
            Self::Ibm866 => b"ibm866",
            Self::Iso8859_2 => b"iso-8859-2",
            Self::Iso8859_3 => b"iso-8859-3",
            Self::Iso8859_4 => b"iso-8859-4",
            Self::Iso8859_5 => b"iso-8859-5",
            Self::Iso8859_6 => b"iso-8859-6",
            Self::Iso8859_7 => b"iso-8859-7",
            Self::Iso8859_8 => b"iso-8859-8",
            Self::Iso8859_8I => b"iso-8859-8-i",
            Self::Iso8859_10 => b"iso-8859-10",
            Self::Iso8859_13 => b"iso-8859-13",
            Self::Iso8859_14 => b"iso-8859-14",
            Self::Iso8859_15 => b"iso-8859-15",
            Self::Iso8859_16 => b"iso-8859-16",
            Self::Koi8R => b"koi8-r",
            Self::Koi8U => b"koi8-u",
            Self::Macintosh => b"macintosh",
            Self::Windows874 => b"windows-874",
            Self::Windows1250 => b"windows-1250",
            Self::Windows1251 => b"windows-1251",
            Self::Windows1253 => b"windows-1253",
            Self::Windows1254 => b"windows-1254",
            Self::Windows1255 => b"windows-1255",
            Self::Windows1256 => b"windows-1256",
            Self::Windows1257 => b"windows-1257",
            Self::Windows1258 => b"windows-1258",
            Self::XMacCyrillic => b"x-mac-cyrillic",
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

    /// https://encoding.spec.whatwg.org/#concept-encoding-get
    pub fn which(input_: &[u8]) -> Option<EncodingLabel> {
        // ASCII whitespace: TAB, LF, FF, CR, SPACE.
        let input = strings::trim(input_, b" \t\r\n\x0C");
        strings::in_map_case_insensitive(input, &STRING_MAP)
    }
}

// The complete label table from https://encoding.spec.whatwg.org/encodings.json.
// Every label the spec defines, and only those, must resolve here.
bun_core::comptime_string_map! {
    static STRING_MAP: EncodingLabel = {
    // UTF-8
    b"unicode-1-1-utf-8" => EncodingLabel::Utf8,
    b"unicode11utf8" => EncodingLabel::Utf8,
    b"unicode20utf8" => EncodingLabel::Utf8,
    b"utf-8" => EncodingLabel::Utf8,
    b"utf8" => EncodingLabel::Utf8,
    b"x-unicode20utf8" => EncodingLabel::Utf8,

    // IBM866
    b"866" => EncodingLabel::Ibm866,
    b"cp866" => EncodingLabel::Ibm866,
    b"csibm866" => EncodingLabel::Ibm866,
    b"ibm866" => EncodingLabel::Ibm866,

    // ISO-8859-2
    b"csisolatin2" => EncodingLabel::Iso8859_2,
    b"iso-8859-2" => EncodingLabel::Iso8859_2,
    b"iso-ir-101" => EncodingLabel::Iso8859_2,
    b"iso8859-2" => EncodingLabel::Iso8859_2,
    b"iso88592" => EncodingLabel::Iso8859_2,
    b"iso_8859-2" => EncodingLabel::Iso8859_2,
    b"iso_8859-2:1987" => EncodingLabel::Iso8859_2,
    b"l2" => EncodingLabel::Iso8859_2,
    b"latin2" => EncodingLabel::Iso8859_2,

    // ISO-8859-3
    b"csisolatin3" => EncodingLabel::Iso8859_3,
    b"iso-8859-3" => EncodingLabel::Iso8859_3,
    b"iso-ir-109" => EncodingLabel::Iso8859_3,
    b"iso8859-3" => EncodingLabel::Iso8859_3,
    b"iso88593" => EncodingLabel::Iso8859_3,
    b"iso_8859-3" => EncodingLabel::Iso8859_3,
    b"iso_8859-3:1988" => EncodingLabel::Iso8859_3,
    b"l3" => EncodingLabel::Iso8859_3,
    b"latin3" => EncodingLabel::Iso8859_3,

    // ISO-8859-4
    b"csisolatin4" => EncodingLabel::Iso8859_4,
    b"iso-8859-4" => EncodingLabel::Iso8859_4,
    b"iso-ir-110" => EncodingLabel::Iso8859_4,
    b"iso8859-4" => EncodingLabel::Iso8859_4,
    b"iso88594" => EncodingLabel::Iso8859_4,
    b"iso_8859-4" => EncodingLabel::Iso8859_4,
    b"iso_8859-4:1988" => EncodingLabel::Iso8859_4,
    b"l4" => EncodingLabel::Iso8859_4,
    b"latin4" => EncodingLabel::Iso8859_4,

    // ISO-8859-5
    b"csisolatincyrillic" => EncodingLabel::Iso8859_5,
    b"cyrillic" => EncodingLabel::Iso8859_5,
    b"iso-8859-5" => EncodingLabel::Iso8859_5,
    b"iso-ir-144" => EncodingLabel::Iso8859_5,
    b"iso8859-5" => EncodingLabel::Iso8859_5,
    b"iso88595" => EncodingLabel::Iso8859_5,
    b"iso_8859-5" => EncodingLabel::Iso8859_5,
    b"iso_8859-5:1988" => EncodingLabel::Iso8859_5,

    // ISO-8859-6
    b"arabic" => EncodingLabel::Iso8859_6,
    b"asmo-708" => EncodingLabel::Iso8859_6,
    b"csiso88596e" => EncodingLabel::Iso8859_6,
    b"csiso88596i" => EncodingLabel::Iso8859_6,
    b"csisolatinarabic" => EncodingLabel::Iso8859_6,
    b"ecma-114" => EncodingLabel::Iso8859_6,
    b"iso-8859-6" => EncodingLabel::Iso8859_6,
    b"iso-8859-6-e" => EncodingLabel::Iso8859_6,
    b"iso-8859-6-i" => EncodingLabel::Iso8859_6,
    b"iso-ir-127" => EncodingLabel::Iso8859_6,
    b"iso8859-6" => EncodingLabel::Iso8859_6,
    b"iso88596" => EncodingLabel::Iso8859_6,
    b"iso_8859-6" => EncodingLabel::Iso8859_6,
    b"iso_8859-6:1987" => EncodingLabel::Iso8859_6,

    // ISO-8859-7
    b"csisolatingreek" => EncodingLabel::Iso8859_7,
    b"ecma-118" => EncodingLabel::Iso8859_7,
    b"elot_928" => EncodingLabel::Iso8859_7,
    b"greek" => EncodingLabel::Iso8859_7,
    b"greek8" => EncodingLabel::Iso8859_7,
    b"iso-8859-7" => EncodingLabel::Iso8859_7,
    b"iso-ir-126" => EncodingLabel::Iso8859_7,
    b"iso8859-7" => EncodingLabel::Iso8859_7,
    b"iso88597" => EncodingLabel::Iso8859_7,
    b"iso_8859-7" => EncodingLabel::Iso8859_7,
    b"iso_8859-7:1987" => EncodingLabel::Iso8859_7,
    b"sun_eu_greek" => EncodingLabel::Iso8859_7,

    // ISO-8859-8
    b"csiso88598e" => EncodingLabel::Iso8859_8,
    b"csisolatinhebrew" => EncodingLabel::Iso8859_8,
    b"hebrew" => EncodingLabel::Iso8859_8,
    b"iso-8859-8" => EncodingLabel::Iso8859_8,
    b"iso-8859-8-e" => EncodingLabel::Iso8859_8,
    b"iso-ir-138" => EncodingLabel::Iso8859_8,
    b"iso8859-8" => EncodingLabel::Iso8859_8,
    b"iso88598" => EncodingLabel::Iso8859_8,
    b"iso_8859-8" => EncodingLabel::Iso8859_8,
    b"iso_8859-8:1988" => EncodingLabel::Iso8859_8,
    b"visual" => EncodingLabel::Iso8859_8,

    // ISO-8859-8-I
    b"csiso88598i" => EncodingLabel::Iso8859_8I,
    b"iso-8859-8-i" => EncodingLabel::Iso8859_8I,
    b"logical" => EncodingLabel::Iso8859_8I,

    // ISO-8859-10
    b"csisolatin6" => EncodingLabel::Iso8859_10,
    b"iso-8859-10" => EncodingLabel::Iso8859_10,
    b"iso-ir-157" => EncodingLabel::Iso8859_10,
    b"iso8859-10" => EncodingLabel::Iso8859_10,
    b"iso885910" => EncodingLabel::Iso8859_10,
    b"l6" => EncodingLabel::Iso8859_10,
    b"latin6" => EncodingLabel::Iso8859_10,

    // ISO-8859-13
    b"iso-8859-13" => EncodingLabel::Iso8859_13,
    b"iso8859-13" => EncodingLabel::Iso8859_13,
    b"iso885913" => EncodingLabel::Iso8859_13,

    // ISO-8859-14
    b"iso-8859-14" => EncodingLabel::Iso8859_14,
    b"iso8859-14" => EncodingLabel::Iso8859_14,
    b"iso885914" => EncodingLabel::Iso8859_14,

    // ISO-8859-15
    b"csisolatin9" => EncodingLabel::Iso8859_15,
    b"iso-8859-15" => EncodingLabel::Iso8859_15,
    b"iso8859-15" => EncodingLabel::Iso8859_15,
    b"iso885915" => EncodingLabel::Iso8859_15,
    b"iso_8859-15" => EncodingLabel::Iso8859_15,
    b"l9" => EncodingLabel::Iso8859_15,

    // ISO-8859-16
    b"iso-8859-16" => EncodingLabel::Iso8859_16,

    // KOI8-R
    b"cskoi8r" => EncodingLabel::Koi8R,
    b"koi" => EncodingLabel::Koi8R,
    b"koi8" => EncodingLabel::Koi8R,
    b"koi8-r" => EncodingLabel::Koi8R,
    b"koi8_r" => EncodingLabel::Koi8R,

    // KOI8-U
    b"koi8-ru" => EncodingLabel::Koi8U,
    b"koi8-u" => EncodingLabel::Koi8U,

    // macintosh
    b"csmacintosh" => EncodingLabel::Macintosh,
    b"mac" => EncodingLabel::Macintosh,
    b"macintosh" => EncodingLabel::Macintosh,
    b"x-mac-roman" => EncodingLabel::Macintosh,

    // windows-874
    b"dos-874" => EncodingLabel::Windows874,
    b"iso-8859-11" => EncodingLabel::Windows874,
    b"iso8859-11" => EncodingLabel::Windows874,
    b"iso885911" => EncodingLabel::Windows874,
    b"tis-620" => EncodingLabel::Windows874,
    b"windows-874" => EncodingLabel::Windows874,

    // windows-1250
    b"cp1250" => EncodingLabel::Windows1250,
    b"windows-1250" => EncodingLabel::Windows1250,
    b"x-cp1250" => EncodingLabel::Windows1250,

    // windows-1251
    b"cp1251" => EncodingLabel::Windows1251,
    b"windows-1251" => EncodingLabel::Windows1251,
    b"x-cp1251" => EncodingLabel::Windows1251,

    // windows-1252
    b"ansi_x3.4-1968" => EncodingLabel::LATIN1,
    b"ascii" => EncodingLabel::LATIN1,
    b"cp1252" => EncodingLabel::LATIN1,
    b"cp819" => EncodingLabel::LATIN1,
    b"csisolatin1" => EncodingLabel::LATIN1,
    b"ibm819" => EncodingLabel::LATIN1,
    b"iso-8859-1" => EncodingLabel::LATIN1,
    b"iso-ir-100" => EncodingLabel::LATIN1,
    b"iso8859-1" => EncodingLabel::LATIN1,
    b"iso88591" => EncodingLabel::LATIN1,
    b"iso_8859-1" => EncodingLabel::LATIN1,
    b"iso_8859-1:1987" => EncodingLabel::LATIN1,
    b"l1" => EncodingLabel::LATIN1,
    b"latin1" => EncodingLabel::LATIN1,
    b"us-ascii" => EncodingLabel::LATIN1,
    b"windows-1252" => EncodingLabel::LATIN1,
    b"x-cp1252" => EncodingLabel::LATIN1,

    // windows-1253
    b"cp1253" => EncodingLabel::Windows1253,
    b"windows-1253" => EncodingLabel::Windows1253,
    b"x-cp1253" => EncodingLabel::Windows1253,

    // windows-1254
    b"cp1254" => EncodingLabel::Windows1254,
    b"csisolatin5" => EncodingLabel::Windows1254,
    b"iso-8859-9" => EncodingLabel::Windows1254,
    b"iso-ir-148" => EncodingLabel::Windows1254,
    b"iso8859-9" => EncodingLabel::Windows1254,
    b"iso88599" => EncodingLabel::Windows1254,
    b"iso_8859-9" => EncodingLabel::Windows1254,
    b"iso_8859-9:1989" => EncodingLabel::Windows1254,
    b"l5" => EncodingLabel::Windows1254,
    b"latin5" => EncodingLabel::Windows1254,
    b"windows-1254" => EncodingLabel::Windows1254,
    b"x-cp1254" => EncodingLabel::Windows1254,

    // windows-1255
    b"cp1255" => EncodingLabel::Windows1255,
    b"windows-1255" => EncodingLabel::Windows1255,
    b"x-cp1255" => EncodingLabel::Windows1255,

    // windows-1256
    b"cp1256" => EncodingLabel::Windows1256,
    b"windows-1256" => EncodingLabel::Windows1256,
    b"x-cp1256" => EncodingLabel::Windows1256,

    // windows-1257
    b"cp1257" => EncodingLabel::Windows1257,
    b"windows-1257" => EncodingLabel::Windows1257,
    b"x-cp1257" => EncodingLabel::Windows1257,

    // windows-1258
    b"cp1258" => EncodingLabel::Windows1258,
    b"windows-1258" => EncodingLabel::Windows1258,
    b"x-cp1258" => EncodingLabel::Windows1258,

    // x-mac-cyrillic
    b"x-mac-cyrillic" => EncodingLabel::XMacCyrillic,
    b"x-mac-ukrainian" => EncodingLabel::XMacCyrillic,

    // GBK
    b"chinese" => EncodingLabel::Gbk,
    b"csgb2312" => EncodingLabel::Gbk,
    b"csiso58gb231280" => EncodingLabel::Gbk,
    b"gb2312" => EncodingLabel::Gbk,
    b"gb_2312" => EncodingLabel::Gbk,
    b"gb_2312-80" => EncodingLabel::Gbk,
    b"gbk" => EncodingLabel::Gbk,
    b"iso-ir-58" => EncodingLabel::Gbk,
    b"x-gbk" => EncodingLabel::Gbk,

    // gb18030
    b"gb18030" => EncodingLabel::Gb18030,

    // Big5
    b"big5" => EncodingLabel::Big5,
    b"big5-hkscs" => EncodingLabel::Big5,
    b"cn-big5" => EncodingLabel::Big5,
    b"csbig5" => EncodingLabel::Big5,
    b"x-x-big5" => EncodingLabel::Big5,

    // EUC-JP
    b"cseucpkdfmtjapanese" => EncodingLabel::EucJp,
    b"euc-jp" => EncodingLabel::EucJp,
    b"x-euc-jp" => EncodingLabel::EucJp,

    // ISO-2022-JP
    b"csiso2022jp" => EncodingLabel::Iso2022Jp,
    b"iso-2022-jp" => EncodingLabel::Iso2022Jp,

    // Shift_JIS
    b"csshiftjis" => EncodingLabel::ShiftJis,
    b"ms932" => EncodingLabel::ShiftJis,
    b"ms_kanji" => EncodingLabel::ShiftJis,
    b"shift-jis" => EncodingLabel::ShiftJis,
    b"shift_jis" => EncodingLabel::ShiftJis,
    b"sjis" => EncodingLabel::ShiftJis,
    b"windows-31j" => EncodingLabel::ShiftJis,
    b"x-sjis" => EncodingLabel::ShiftJis,

    // EUC-KR
    b"cseuckr" => EncodingLabel::EucKr,
    b"csksc56011987" => EncodingLabel::EucKr,
    b"euc-kr" => EncodingLabel::EucKr,
    b"iso-ir-149" => EncodingLabel::EucKr,
    b"korean" => EncodingLabel::EucKr,
    b"ks_c_5601-1987" => EncodingLabel::EucKr,
    b"ks_c_5601-1989" => EncodingLabel::EucKr,
    b"ksc5601" => EncodingLabel::EucKr,
    b"ksc_5601" => EncodingLabel::EucKr,
    b"windows-949" => EncodingLabel::EucKr,

    // replacement
    b"csiso2022kr" => EncodingLabel::Replacement,
    b"hz-gb-2312" => EncodingLabel::Replacement,
    b"iso-2022-cn" => EncodingLabel::Replacement,
    b"iso-2022-cn-ext" => EncodingLabel::Replacement,
    b"iso-2022-kr" => EncodingLabel::Replacement,
    b"replacement" => EncodingLabel::Replacement,

    // UTF-16BE
    b"unicodefffe" => EncodingLabel::Utf16Be,
    b"utf-16be" => EncodingLabel::Utf16Be,

    // UTF-16LE
    b"csunicode" => EncodingLabel::Utf16Le,
    b"iso-10646-ucs-2" => EncodingLabel::Utf16Le,
    b"ucs-2" => EncodingLabel::Utf16Le,
    b"unicode" => EncodingLabel::Utf16Le,
    b"unicodefeff" => EncodingLabel::Utf16Le,
    b"utf-16" => EncodingLabel::Utf16Le,
    b"utf-16le" => EncodingLabel::Utf16Le,

    // x-user-defined
    b"x-user-defined" => EncodingLabel::XUserDefined,
    };
}
