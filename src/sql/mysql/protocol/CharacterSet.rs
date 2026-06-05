// MySQL collation/character-set id. Any wire byte is a legal value, named or
// not, so this is a `#[repr(transparent)]` newtype over `u8` —
// unknown ids coming off the wire are preserved instead of being collapsed to
// a known variant, and constructing one is never UB.
#[repr(transparent)]
#[derive(Copy, Clone, Eq, PartialEq, Hash, Debug)]
pub struct CharacterSet(pub u8);

#[allow(non_upper_case_globals)]
impl CharacterSet {
    pub const big5_chinese_ci: CharacterSet = CharacterSet(1);
    pub const latin2_czech_cs: CharacterSet = CharacterSet(2);
    pub const dec8_swedish_ci: CharacterSet = CharacterSet(3);
    pub const cp850_general_ci: CharacterSet = CharacterSet(4);
    pub const latin1_german1_ci: CharacterSet = CharacterSet(5);
    pub const hp8_english_ci: CharacterSet = CharacterSet(6);
    pub const koi8r_general_ci: CharacterSet = CharacterSet(7);
    pub const latin1_swedish_ci: CharacterSet = CharacterSet(8);
    pub const latin2_general_ci: CharacterSet = CharacterSet(9);
    pub const swe7_swedish_ci: CharacterSet = CharacterSet(10);
    pub const ascii_general_ci: CharacterSet = CharacterSet(11);
    pub const ujis_japanese_ci: CharacterSet = CharacterSet(12);
    pub const sjis_japanese_ci: CharacterSet = CharacterSet(13);
    pub const cp1251_bulgarian_ci: CharacterSet = CharacterSet(14);
    pub const latin1_danish_ci: CharacterSet = CharacterSet(15);
    pub const hebrew_general_ci: CharacterSet = CharacterSet(16);
    pub const tis620_thai_ci: CharacterSet = CharacterSet(18);
    pub const euckr_korean_ci: CharacterSet = CharacterSet(19);
    pub const latin7_estonian_cs: CharacterSet = CharacterSet(20);
    pub const latin2_hungarian_ci: CharacterSet = CharacterSet(21);
    pub const koi8u_general_ci: CharacterSet = CharacterSet(22);
    pub const cp1251_ukrainian_ci: CharacterSet = CharacterSet(23);
    pub const gb2312_chinese_ci: CharacterSet = CharacterSet(24);
    pub const greek_general_ci: CharacterSet = CharacterSet(25);
    pub const cp1250_general_ci: CharacterSet = CharacterSet(26);
    pub const latin2_croatian_ci: CharacterSet = CharacterSet(27);
    pub const gbk_chinese_ci: CharacterSet = CharacterSet(28);
    pub const cp1257_lithuanian_ci: CharacterSet = CharacterSet(29);
    pub const latin5_turkish_ci: CharacterSet = CharacterSet(30);
    pub const latin1_german2_ci: CharacterSet = CharacterSet(31);
    pub const armscii8_general_ci: CharacterSet = CharacterSet(32);
    pub const utf8mb3_general_ci: CharacterSet = CharacterSet(33);
    pub const cp1250_czech_cs: CharacterSet = CharacterSet(34);
    pub const ucs2_general_ci: CharacterSet = CharacterSet(35);
    pub const cp866_general_ci: CharacterSet = CharacterSet(36);
    pub const keybcs2_general_ci: CharacterSet = CharacterSet(37);
    pub const macce_general_ci: CharacterSet = CharacterSet(38);
    pub const macroman_general_ci: CharacterSet = CharacterSet(39);
    pub const cp852_general_ci: CharacterSet = CharacterSet(40);
    pub const latin7_general_ci: CharacterSet = CharacterSet(41);
    pub const latin7_general_cs: CharacterSet = CharacterSet(42);
    pub const macce_bin: CharacterSet = CharacterSet(43);
    pub const cp1250_croatian_ci: CharacterSet = CharacterSet(44);
    pub const utf8mb4_general_ci: CharacterSet = CharacterSet(45);
    pub const utf8mb4_bin: CharacterSet = CharacterSet(46);
    pub const latin1_bin: CharacterSet = CharacterSet(47);
    pub const latin1_general_ci: CharacterSet = CharacterSet(48);
    pub const latin1_general_cs: CharacterSet = CharacterSet(49);
    pub const cp1251_bin: CharacterSet = CharacterSet(50);
    pub const cp1251_general_ci: CharacterSet = CharacterSet(51);
    pub const cp1251_general_cs: CharacterSet = CharacterSet(52);
    pub const macroman_bin: CharacterSet = CharacterSet(53);
    pub const utf16_general_ci: CharacterSet = CharacterSet(54);
    pub const utf16_bin: CharacterSet = CharacterSet(55);
    pub const utf16le_general_ci: CharacterSet = CharacterSet(56);
    pub const cp1256_general_ci: CharacterSet = CharacterSet(57);
    pub const cp1257_bin: CharacterSet = CharacterSet(58);
    pub const cp1257_general_ci: CharacterSet = CharacterSet(59);
    pub const utf32_general_ci: CharacterSet = CharacterSet(60);
    pub const utf32_bin: CharacterSet = CharacterSet(61);
    pub const utf16le_bin: CharacterSet = CharacterSet(62);
    pub const binary: CharacterSet = CharacterSet(63);
    pub const armscii8_bin: CharacterSet = CharacterSet(64);
    pub const ascii_bin: CharacterSet = CharacterSet(65);
    pub const cp1250_bin: CharacterSet = CharacterSet(66);
    pub const cp1256_bin: CharacterSet = CharacterSet(67);
    pub const cp866_bin: CharacterSet = CharacterSet(68);
    pub const dec8_bin: CharacterSet = CharacterSet(69);
    pub const greek_bin: CharacterSet = CharacterSet(70);
    pub const hebrew_bin: CharacterSet = CharacterSet(71);
    pub const hp8_bin: CharacterSet = CharacterSet(72);
    pub const keybcs2_bin: CharacterSet = CharacterSet(73);
    pub const koi8r_bin: CharacterSet = CharacterSet(74);
    pub const koi8u_bin: CharacterSet = CharacterSet(75);
    pub const utf8mb3_tolower_ci: CharacterSet = CharacterSet(76);
    pub const latin2_bin: CharacterSet = CharacterSet(77);
    pub const latin5_bin: CharacterSet = CharacterSet(78);
    pub const latin7_bin: CharacterSet = CharacterSet(79);
    pub const cp850_bin: CharacterSet = CharacterSet(80);
    pub const cp852_bin: CharacterSet = CharacterSet(81);
    pub const swe7_bin: CharacterSet = CharacterSet(82);
    pub const utf8mb3_bin: CharacterSet = CharacterSet(83);
    pub const big5_bin: CharacterSet = CharacterSet(84);
    pub const euckr_bin: CharacterSet = CharacterSet(85);
    pub const gb2312_bin: CharacterSet = CharacterSet(86);
    pub const gbk_bin: CharacterSet = CharacterSet(87);
    pub const sjis_bin: CharacterSet = CharacterSet(88);
    pub const tis620_bin: CharacterSet = CharacterSet(89);
    pub const ucs2_bin: CharacterSet = CharacterSet(90);
    pub const ujis_bin: CharacterSet = CharacterSet(91);
    pub const geostd8_general_ci: CharacterSet = CharacterSet(92);
    pub const geostd8_bin: CharacterSet = CharacterSet(93);
    pub const latin1_spanish_ci: CharacterSet = CharacterSet(94);
    pub const cp932_japanese_ci: CharacterSet = CharacterSet(95);
    pub const cp932_bin: CharacterSet = CharacterSet(96);
    pub const eucjpms_japanese_ci: CharacterSet = CharacterSet(97);
    pub const eucjpms_bin: CharacterSet = CharacterSet(98);
    pub const cp1250_polish_ci: CharacterSet = CharacterSet(99);
    pub const utf16_unicode_ci: CharacterSet = CharacterSet(101);
    pub const utf16_icelandic_ci: CharacterSet = CharacterSet(102);
    pub const utf16_latvian_ci: CharacterSet = CharacterSet(103);
    pub const utf16_romanian_ci: CharacterSet = CharacterSet(104);
    pub const utf16_slovenian_ci: CharacterSet = CharacterSet(105);
    pub const utf16_polish_ci: CharacterSet = CharacterSet(106);
    pub const utf16_estonian_ci: CharacterSet = CharacterSet(107);
    pub const utf16_spanish_ci: CharacterSet = CharacterSet(108);
    pub const utf16_swedish_ci: CharacterSet = CharacterSet(109);
    pub const utf16_turkish_ci: CharacterSet = CharacterSet(110);
    pub const utf16_czech_ci: CharacterSet = CharacterSet(111);
    pub const utf16_danish_ci: CharacterSet = CharacterSet(112);
    pub const utf16_lithuanian_ci: CharacterSet = CharacterSet(113);
    pub const utf16_slovak_ci: CharacterSet = CharacterSet(114);
    pub const utf16_spanish2_ci: CharacterSet = CharacterSet(115);
    pub const utf16_roman_ci: CharacterSet = CharacterSet(116);
    pub const utf16_persian_ci: CharacterSet = CharacterSet(117);
    pub const utf16_esperanto_ci: CharacterSet = CharacterSet(118);
    pub const utf16_hungarian_ci: CharacterSet = CharacterSet(119);
    pub const utf16_sinhala_ci: CharacterSet = CharacterSet(120);
    pub const utf16_german2_ci: CharacterSet = CharacterSet(121);
    pub const utf16_croatian_ci: CharacterSet = CharacterSet(122);
    pub const utf16_unicode_520_ci: CharacterSet = CharacterSet(123);
    pub const utf16_vietnamese_ci: CharacterSet = CharacterSet(124);
    pub const ucs2_unicode_ci: CharacterSet = CharacterSet(128);
    pub const ucs2_icelandic_ci: CharacterSet = CharacterSet(129);
    pub const ucs2_latvian_ci: CharacterSet = CharacterSet(130);
    pub const ucs2_romanian_ci: CharacterSet = CharacterSet(131);
    pub const ucs2_slovenian_ci: CharacterSet = CharacterSet(132);
    pub const ucs2_polish_ci: CharacterSet = CharacterSet(133);
    pub const ucs2_estonian_ci: CharacterSet = CharacterSet(134);
    pub const ucs2_spanish_ci: CharacterSet = CharacterSet(135);
    pub const ucs2_swedish_ci: CharacterSet = CharacterSet(136);
    pub const ucs2_turkish_ci: CharacterSet = CharacterSet(137);
    pub const ucs2_czech_ci: CharacterSet = CharacterSet(138);
    pub const ucs2_danish_ci: CharacterSet = CharacterSet(139);
    pub const ucs2_lithuanian_ci: CharacterSet = CharacterSet(140);
    pub const ucs2_slovak_ci: CharacterSet = CharacterSet(141);
    pub const ucs2_spanish2_ci: CharacterSet = CharacterSet(142);
    pub const ucs2_roman_ci: CharacterSet = CharacterSet(143);
    pub const ucs2_persian_ci: CharacterSet = CharacterSet(144);
    pub const ucs2_esperanto_ci: CharacterSet = CharacterSet(145);
    pub const ucs2_hungarian_ci: CharacterSet = CharacterSet(146);
    pub const ucs2_sinhala_ci: CharacterSet = CharacterSet(147);
    pub const ucs2_german2_ci: CharacterSet = CharacterSet(148);
    pub const ucs2_croatian_ci: CharacterSet = CharacterSet(149);
    pub const ucs2_unicode_520_ci: CharacterSet = CharacterSet(150);
    pub const ucs2_vietnamese_ci: CharacterSet = CharacterSet(151);
    pub const ucs2_general_mysql500_ci: CharacterSet = CharacterSet(159);
    pub const utf32_unicode_ci: CharacterSet = CharacterSet(160);
    pub const utf32_icelandic_ci: CharacterSet = CharacterSet(161);
    pub const utf32_latvian_ci: CharacterSet = CharacterSet(162);
    pub const utf32_romanian_ci: CharacterSet = CharacterSet(163);
    pub const utf32_slovenian_ci: CharacterSet = CharacterSet(164);
    pub const utf32_polish_ci: CharacterSet = CharacterSet(165);
    pub const utf32_estonian_ci: CharacterSet = CharacterSet(166);
    pub const utf32_spanish_ci: CharacterSet = CharacterSet(167);
    pub const utf32_swedish_ci: CharacterSet = CharacterSet(168);
    pub const utf32_turkish_ci: CharacterSet = CharacterSet(169);
    pub const utf32_czech_ci: CharacterSet = CharacterSet(170);
    pub const utf32_danish_ci: CharacterSet = CharacterSet(171);
    pub const utf32_lithuanian_ci: CharacterSet = CharacterSet(172);
    pub const utf32_slovak_ci: CharacterSet = CharacterSet(173);
    pub const utf32_spanish2_ci: CharacterSet = CharacterSet(174);
    pub const utf32_roman_ci: CharacterSet = CharacterSet(175);
    pub const utf32_persian_ci: CharacterSet = CharacterSet(176);
    pub const utf32_esperanto_ci: CharacterSet = CharacterSet(177);
    pub const utf32_hungarian_ci: CharacterSet = CharacterSet(178);
    pub const utf32_sinhala_ci: CharacterSet = CharacterSet(179);
    pub const utf32_german2_ci: CharacterSet = CharacterSet(180);
    pub const utf32_croatian_ci: CharacterSet = CharacterSet(181);
    pub const utf32_unicode_520_ci: CharacterSet = CharacterSet(182);
    pub const utf32_vietnamese_ci: CharacterSet = CharacterSet(183);
    pub const utf8mb3_unicode_ci: CharacterSet = CharacterSet(192);
    pub const utf8mb3_icelandic_ci: CharacterSet = CharacterSet(193);
    pub const utf8mb3_latvian_ci: CharacterSet = CharacterSet(194);
    pub const utf8mb3_romanian_ci: CharacterSet = CharacterSet(195);
    pub const utf8mb3_slovenian_ci: CharacterSet = CharacterSet(196);
    pub const utf8mb3_polish_ci: CharacterSet = CharacterSet(197);
    pub const utf8mb3_estonian_ci: CharacterSet = CharacterSet(198);
    pub const utf8mb3_spanish_ci: CharacterSet = CharacterSet(199);
    pub const utf8mb3_swedish_ci: CharacterSet = CharacterSet(200);
    pub const utf8mb3_turkish_ci: CharacterSet = CharacterSet(201);
    pub const utf8mb3_czech_ci: CharacterSet = CharacterSet(202);
    pub const utf8mb3_danish_ci: CharacterSet = CharacterSet(203);
    pub const utf8mb3_lithuanian_ci: CharacterSet = CharacterSet(204);
    pub const utf8mb3_slovak_ci: CharacterSet = CharacterSet(205);
    pub const utf8mb3_spanish2_ci: CharacterSet = CharacterSet(206);
    pub const utf8mb3_roman_ci: CharacterSet = CharacterSet(207);
    pub const utf8mb3_persian_ci: CharacterSet = CharacterSet(208);
    pub const utf8mb3_esperanto_ci: CharacterSet = CharacterSet(209);
    pub const utf8mb3_hungarian_ci: CharacterSet = CharacterSet(210);
    pub const utf8mb3_sinhala_ci: CharacterSet = CharacterSet(211);
    pub const utf8mb3_german2_ci: CharacterSet = CharacterSet(212);
    pub const utf8mb3_croatian_ci: CharacterSet = CharacterSet(213);
    pub const utf8mb3_unicode_520_ci: CharacterSet = CharacterSet(214);
    pub const utf8mb3_vietnamese_ci: CharacterSet = CharacterSet(215);
    pub const utf8mb3_general_mysql500_ci: CharacterSet = CharacterSet(223);
    pub const utf8mb4_unicode_ci: CharacterSet = CharacterSet(224);
    pub const utf8mb4_icelandic_ci: CharacterSet = CharacterSet(225);
    pub const utf8mb4_latvian_ci: CharacterSet = CharacterSet(226);
    pub const utf8mb4_romanian_ci: CharacterSet = CharacterSet(227);
    pub const utf8mb4_slovenian_ci: CharacterSet = CharacterSet(228);
    pub const utf8mb4_polish_ci: CharacterSet = CharacterSet(229);
    pub const utf8mb4_estonian_ci: CharacterSet = CharacterSet(230);
    pub const utf8mb4_spanish_ci: CharacterSet = CharacterSet(231);
    pub const utf8mb4_swedish_ci: CharacterSet = CharacterSet(232);
    pub const utf8mb4_turkish_ci: CharacterSet = CharacterSet(233);
    pub const utf8mb4_czech_ci: CharacterSet = CharacterSet(234);
    pub const utf8mb4_danish_ci: CharacterSet = CharacterSet(235);
    pub const utf8mb4_lithuanian_ci: CharacterSet = CharacterSet(236);
    pub const utf8mb4_slovak_ci: CharacterSet = CharacterSet(237);
    pub const utf8mb4_spanish2_ci: CharacterSet = CharacterSet(238);
    pub const utf8mb4_roman_ci: CharacterSet = CharacterSet(239);
    pub const utf8mb4_persian_ci: CharacterSet = CharacterSet(240);
    pub const utf8mb4_esperanto_ci: CharacterSet = CharacterSet(241);
    pub const utf8mb4_hungarian_ci: CharacterSet = CharacterSet(242);
    pub const utf8mb4_sinhala_ci: CharacterSet = CharacterSet(243);
    pub const utf8mb4_german2_ci: CharacterSet = CharacterSet(244);
    pub const utf8mb4_croatian_ci: CharacterSet = CharacterSet(245);
    pub const utf8mb4_unicode_520_ci: CharacterSet = CharacterSet(246);
    pub const utf8mb4_vietnamese_ci: CharacterSet = CharacterSet(247);
    pub const gb18030_chinese_ci: CharacterSet = CharacterSet(248);
    pub const gb18030_bin: CharacterSet = CharacterSet(249);
    pub const gb18030_unicode_520_ci: CharacterSet = CharacterSet(250);
}

impl CharacterSet {
    pub const DEFAULT: CharacterSet = CharacterSet::utf8mb4_general_ci;

    /// Construct from a raw protocol byte: every byte is valid and unknown
    /// ids are kept
    /// as-is (they round-trip back onto the wire unchanged).
    pub const fn from_raw(b: u8) -> Self {
        Self(b)
    }

    /// The raw wire byte.
    pub const fn to_int(self) -> u8 {
        self.0
    }

    pub fn label(self) -> &'static str {
        match self.0 {
            1 => "big5_chinese_ci",
            2 => "latin2_czech_cs",
            3 => "dec8_swedish_ci",
            4 => "cp850_general_ci",
            5 => "latin1_german1_ci",
            6 => "hp8_english_ci",
            7 => "koi8r_general_ci",
            8 => "latin1_swedish_ci",
            9 => "latin2_general_ci",
            10 => "swe7_swedish_ci",
            11 => "ascii_general_ci",
            12 => "ujis_japanese_ci",
            13 => "sjis_japanese_ci",
            14 => "cp1251_bulgarian_ci",
            15 => "latin1_danish_ci",
            16 => "hebrew_general_ci",
            18 => "tis620_thai_ci",
            19 => "euckr_korean_ci",
            20 => "latin7_estonian_cs",
            21 => "latin2_hungarian_ci",
            22 => "koi8u_general_ci",
            23 => "cp1251_ukrainian_ci",
            24 => "gb2312_chinese_ci",
            25 => "greek_general_ci",
            26 => "cp1250_general_ci",
            27 => "latin2_croatian_ci",
            28 => "gbk_chinese_ci",
            29 => "cp1257_lithuanian_ci",
            30 => "latin5_turkish_ci",
            31 => "latin1_german2_ci",
            32 => "armscii8_general_ci",
            33 => "utf8mb3_general_ci",
            34 => "cp1250_czech_cs",
            35 => "ucs2_general_ci",
            36 => "cp866_general_ci",
            37 => "keybcs2_general_ci",
            38 => "macce_general_ci",
            39 => "macroman_general_ci",
            40 => "cp852_general_ci",
            41 => "latin7_general_ci",
            42 => "latin7_general_cs",
            43 => "macce_bin",
            44 => "cp1250_croatian_ci",
            45 => "utf8mb4_general_ci",
            46 => "utf8mb4_bin",
            47 => "latin1_bin",
            48 => "latin1_general_ci",
            49 => "latin1_general_cs",
            50 => "cp1251_bin",
            51 => "cp1251_general_ci",
            52 => "cp1251_general_cs",
            53 => "macroman_bin",
            54 => "utf16_general_ci",
            55 => "utf16_bin",
            56 => "utf16le_general_ci",
            57 => "cp1256_general_ci",
            58 => "cp1257_bin",
            59 => "cp1257_general_ci",
            60 => "utf32_general_ci",
            61 => "utf32_bin",
            62 => "utf16le_bin",
            63 => "binary",
            64 => "armscii8_bin",
            65 => "ascii_bin",
            66 => "cp1250_bin",
            67 => "cp1256_bin",
            68 => "cp866_bin",
            69 => "dec8_bin",
            70 => "greek_bin",
            71 => "hebrew_bin",
            72 => "hp8_bin",
            73 => "keybcs2_bin",
            74 => "koi8r_bin",
            75 => "koi8u_bin",
            76 => "utf8mb3_tolower_ci",
            77 => "latin2_bin",
            78 => "latin5_bin",
            79 => "latin7_bin",
            80 => "cp850_bin",
            81 => "cp852_bin",
            82 => "swe7_bin",
            83 => "utf8mb3_bin",
            84 => "big5_bin",
            85 => "euckr_bin",
            86 => "gb2312_bin",
            87 => "gbk_bin",
            88 => "sjis_bin",
            89 => "tis620_bin",
            90 => "ucs2_bin",
            91 => "ujis_bin",
            92 => "geostd8_general_ci",
            93 => "geostd8_bin",
            94 => "latin1_spanish_ci",
            95 => "cp932_japanese_ci",
            96 => "cp932_bin",
            97 => "eucjpms_japanese_ci",
            98 => "eucjpms_bin",
            99 => "cp1250_polish_ci",
            _ => "(unknown)",
        }
    }
}

impl Default for CharacterSet {
    fn default() -> Self {
        Self::DEFAULT
    }
}
