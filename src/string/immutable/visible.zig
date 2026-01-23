pub fn isZeroWidthCodepointType(comptime T: type, cp: T) bool {
    if (cp <= 0x1f) {
        return true;
    }

    if (cp >= 0x7f and cp <= 0x9f) {
        // C1 control characters
        return true;
    }

    // Soft hyphen (U+00AD) - invisible/zero-width
    if (cp == 0xad)
        return true;

    if (comptime @sizeOf(T) == 1) {
        return false;
    }

    if (cp >= 0x300 and cp <= 0x36f) {
        // Combining Diacritical Marks
        return true;
    }

    if (cp >= 0x200b and cp <= 0x200f) {
        // Modifying Invisible Characters (ZWS, ZWNJ, ZWJ, LRM, RLM)
        return true;
    }

    if (cp >= 0x2060 and cp <= 0x2064) {
        // Word joiner (U+2060), invisible operators
        return true;
    }

    if (cp >= 0x20d0 and cp <= 0x20ff)
        // Combining Diacritical Marks for Symbols
        return true;

    if (cp >= 0xfe00 and cp <= 0xfe0f)
        // Variation Selectors
        return true;
    if (cp >= 0xfe20 and cp <= 0xfe2f)
        // Combining Half Marks
        return true;

    if (cp == 0xfeff)
        // Zero Width No-Break Space (BOM, ZWNBSP)
        return true;

    if (cp >= 0xd800 and cp <= 0xdfff)
        // Surrogates (including lone surrogates)
        return true;

    // Arabic formatting characters
    if ((cp >= 0x600 and cp <= 0x605) or cp == 0x6dd or cp == 0x70f or cp == 0x8e2)
        return true;

    // Indic script combining marks (Devanagari through Malayalam)
    if (cp >= 0x900 and cp <= 0xd4f) {
        const offset = cp & 0x7f;
        // Signs at block start (except position 0x03 which is often a visible Visarga)
        if (offset <= 0x02) return true;
        // Vowel signs, virama (0x3a-0x4d), but exclude:
        // - 0x3D (Avagraha - visible letter in most blocks)
        if (offset >= 0x3a and offset <= 0x4d and offset != 0x3d) return true;
        // Position 0x4E-0x4F are visible symbols in some blocks (e.g., Malayalam Sign Para)
        // Stress signs (0x51-0x57)
        if (offset >= 0x51 and offset <= 0x57) return true;
        // Vowel signs (0x62-0x63)
        if (offset >= 0x62 and offset <= 0x63) return true;
    }

    // Thai combining marks
    if ((cp >= 0xe31 and cp <= 0xe3a) or (cp >= 0xe47 and cp <= 0xe4e))
        return true;

    // Lao combining marks
    if ((cp >= 0xeb1 and cp <= 0xebc) or (cp >= 0xec8 and cp <= 0xecd))
        return true;

    // Combining Diacritical Marks Extended
    if (cp >= 0x1ab0 and cp <= 0x1aff)
        return true;

    // Combining Diacritical Marks Supplement
    if (cp >= 0x1dc0 and cp <= 0x1dff)
        return true;

    // Tag characters
    if (cp >= 0xe0000 and cp <= 0xe007f)
        return true;

    if (cp >= 0xe0100 and cp <= 0xe01ef)
        // Variation Selectors Supplement
        return true;

    return false;
}

/// Official unicode reference: https://www.unicode.org/Public/UCD/latest/ucd/EastAsianWidth.txt
/// Tag legend:
///  - `W` (wide) -> true
///  - `F` (full-width) -> true
///  - `H` (half-width) -> false
///  - `N` (neutral) -> false
///  - `Na` (narrow) -> false
///  - `A` (ambiguous) -> false?
///
/// To regenerate the switch body list, run:
/// ```js
///    [...(await (await fetch("https://www.unicode.org/Public/UCD/latest/ucd/EastAsianWidth.txt")).text()).matchAll(/^([\dA-F]{4,})(?:\.\.([\dA-F]{4,}))?\s+;\s+(\w+)\s+#\s+(.*?)\s*$/gm)].flatMap(([,start, end, type, comment]) => (
///        (['W', 'F'].includes(type)) ? [`        ${(end ? `0x${start}...0x${end}` : `0x${start}`)}, // ${''.padStart(17 - start.length - (end ? end.length + 5 : 0))}[${type}] ${comment}`] : []
///    )).join('\n')
/// ```
pub fn isFullWidthCodepointType(comptime T: type, cp: T) bool {
    if (!(cp >= 0x1100)) {
        return false;
    }

    return switch (cp) {
        0x1100...0x115F, //     [W] Lo    [96] HANGUL CHOSEONG KIYEOK..HANGUL CHOSEONG FILLER
        0x231A...0x231B, //     [W] So     [2] WATCH..HOURGLASS
        0x2329, //              [W] Ps         LEFT-POINTING ANGLE BRACKET
        0x232A, //              [W] Pe         RIGHT-POINTING ANGLE BRACKET
        0x23E9...0x23EC, //     [W] So     [4] BLACK RIGHT-POINTING DOUBLE TRIANGLE..BLACK DOWN-POINTING DOUBLE TRIANGLE
        0x23F0, //              [W] So         ALARM CLOCK
        0x23F3, //              [W] So         HOURGLASS WITH FLOWING SAND
        0x25FD...0x25FE, //     [W] Sm     [2] WHITE MEDIUM SMALL SQUARE..BLACK MEDIUM SMALL SQUARE
        0x2614...0x2615, //     [W] So     [2] UMBRELLA WITH RAIN DROPS..HOT BEVERAGE
        0x2648...0x2653, //     [W] So    [12] ARIES..PISCES
        0x267F, //              [W] So         WHEELCHAIR SYMBOL
        0x2693, //              [W] So         ANCHOR
        0x26A1, //              [W] So         HIGH VOLTAGE SIGN
        0x26AA...0x26AB, //     [W] So     [2] MEDIUM WHITE CIRCLE..MEDIUM BLACK CIRCLE
        0x26BD...0x26BE, //     [W] So     [2] SOCCER BALL..BASEBALL
        0x26C4...0x26C5, //     [W] So     [2] SNOWMAN WITHOUT SNOW..SUN BEHIND CLOUD
        0x26CE, //              [W] So         OPHIUCHUS
        0x26D4, //              [W] So         NO ENTRY
        0x26EA, //              [W] So         CHURCH
        0x26F2...0x26F3, //     [W] So     [2] FOUNTAIN..FLAG IN HOLE
        0x26F5, //              [W] So         SAILBOAT
        0x26FA, //              [W] So         TENT
        0x26FD, //              [W] So         FUEL PUMP
        0x2705, //              [W] So         WHITE HEAVY CHECK MARK
        0x270A...0x270B, //     [W] So     [2] RAISED FIST..RAISED HAND
        0x2728, //              [W] So         SPARKLES
        0x274C, //              [W] So         CROSS MARK
        0x274E, //              [W] So         NEGATIVE SQUARED CROSS MARK
        0x2753...0x2755, //     [W] So     [3] BLACK QUESTION MARK ORNAMENT..WHITE EXCLAMATION MARK ORNAMENT
        0x2757, //              [W] So         HEAVY EXCLAMATION MARK SYMBOL
        0x2795...0x2797, //     [W] So     [3] HEAVY PLUS SIGN..HEAVY DIVISION SIGN
        0x27B0, //              [W] So         CURLY LOOP
        0x27BF, //              [W] So         DOUBLE CURLY LOOP
        0x2B1B...0x2B1C, //     [W] So     [2] BLACK LARGE SQUARE..WHITE LARGE SQUARE
        0x2B50, //              [W] So         WHITE MEDIUM STAR
        0x2B55, //              [W] So         HEAVY LARGE CIRCLE
        0x2E80...0x2E99, //     [W] So    [26] CJK RADICAL REPEAT..CJK RADICAL RAP
        0x2E9B...0x2EF3, //     [W] So    [89] CJK RADICAL CHOKE..CJK RADICAL C-SIMPLIFIED TURTLE
        0x2F00...0x2FD5, //     [W] So   [214] KANGXI RADICAL ONE..KANGXI RADICAL FLUTE
        0x2FF0...0x2FFF, //     [W] So    [16] IDEOGRAPHIC DESCRIPTION CHARACTER LEFT TO RIGHT..IDEOGRAPHIC DESCRIPTION CHARACTER ROTATION
        0x3000, //              [F] Zs         IDEOGRAPHIC SPACE
        0x3001...0x3003, //     [W] Po     [3] IDEOGRAPHIC COMMA..DITTO MARK
        0x3004, //              [W] So         JAPANESE INDUSTRIAL STANDARD SYMBOL
        0x3005, //              [W] Lm         IDEOGRAPHIC ITERATION MARK
        0x3006, //              [W] Lo         IDEOGRAPHIC CLOSING MARK
        0x3007, //              [W] Nl         IDEOGRAPHIC NUMBER ZERO
        0x3008, //              [W] Ps         LEFT ANGLE BRACKET
        0x3009, //              [W] Pe         RIGHT ANGLE BRACKET
        0x300A, //              [W] Ps         LEFT DOUBLE ANGLE BRACKET
        0x300B, //              [W] Pe         RIGHT DOUBLE ANGLE BRACKET
        0x300C, //              [W] Ps         LEFT CORNER BRACKET
        0x300D, //              [W] Pe         RIGHT CORNER BRACKET
        0x300E, //              [W] Ps         LEFT WHITE CORNER BRACKET
        0x300F, //              [W] Pe         RIGHT WHITE CORNER BRACKET
        0x3010, //              [W] Ps         LEFT BLACK LENTICULAR BRACKET
        0x3011, //              [W] Pe         RIGHT BLACK LENTICULAR BRACKET
        0x3012...0x3013, //     [W] So     [2] POSTAL MARK..GETA MARK
        0x3014, //              [W] Ps         LEFT TORTOISE SHELL BRACKET
        0x3015, //              [W] Pe         RIGHT TORTOISE SHELL BRACKET
        0x3016, //              [W] Ps         LEFT WHITE LENTICULAR BRACKET
        0x3017, //              [W] Pe         RIGHT WHITE LENTICULAR BRACKET
        0x3018, //              [W] Ps         LEFT WHITE TORTOISE SHELL BRACKET
        0x3019, //              [W] Pe         RIGHT WHITE TORTOISE SHELL BRACKET
        0x301A, //              [W] Ps         LEFT WHITE SQUARE BRACKET
        0x301B, //              [W] Pe         RIGHT WHITE SQUARE BRACKET
        0x301C, //              [W] Pd         WAVE DASH
        0x301D, //              [W] Ps         REVERSED DOUBLE PRIME QUOTATION MARK
        0x301E...0x301F, //     [W] Pe     [2] DOUBLE PRIME QUOTATION MARK..LOW DOUBLE PRIME QUOTATION MARK
        0x3020, //              [W] So         POSTAL MARK FACE
        0x3021...0x3029, //     [W] Nl     [9] HANGZHOU NUMERAL ONE..HANGZHOU NUMERAL NINE
        0x302A...0x302D, //     [W] Mn     [4] IDEOGRAPHIC LEVEL TONE MARK..IDEOGRAPHIC ENTERING TONE MARK
        0x302E...0x302F, //     [W] Mc     [2] HANGUL SINGLE DOT TONE MARK..HANGUL DOUBLE DOT TONE MARK
        0x3030, //              [W] Pd         WAVY DASH
        0x3031...0x3035, //     [W] Lm     [5] VERTICAL KANA REPEAT MARK..VERTICAL KANA REPEAT MARK LOWER HALF
        0x3036...0x3037, //     [W] So     [2] CIRCLED POSTAL MARK..IDEOGRAPHIC TELEGRAPH LINE FEED SEPARATOR SYMBOL
        0x3038...0x303A, //     [W] Nl     [3] HANGZHOU NUMERAL TEN..HANGZHOU NUMERAL THIRTY
        0x303B, //              [W] Lm         VERTICAL IDEOGRAPHIC ITERATION MARK
        0x303C, //              [W] Lo         MASU MARK
        0x303D, //              [W] Po         PART ALTERNATION MARK
        0x303E, //              [W] So         IDEOGRAPHIC VARIATION INDICATOR
        0x3041...0x3096, //     [W] Lo    [86] HIRAGANA LETTER SMALL A..HIRAGANA LETTER SMALL KE
        0x3099...0x309A, //     [W] Mn     [2] COMBINING KATAKANA-HIRAGANA VOICED SOUND MARK..COMBINING KATAKANA-HIRAGANA SEMI-VOICED SOUND MARK
        0x309B...0x309C, //     [W] Sk     [2] KATAKANA-HIRAGANA VOICED SOUND MARK..KATAKANA-HIRAGANA SEMI-VOICED SOUND MARK
        0x309D...0x309E, //     [W] Lm     [2] HIRAGANA ITERATION MARK..HIRAGANA VOICED ITERATION MARK
        0x309F, //              [W] Lo         HIRAGANA DIGRAPH YORI
        0x30A0, //              [W] Pd         KATAKANA-HIRAGANA DOUBLE HYPHEN
        0x30A1...0x30FA, //     [W] Lo    [90] KATAKANA LETTER SMALL A..KATAKANA LETTER VO
        0x30FB, //              [W] Po         KATAKANA MIDDLE DOT
        0x30FC...0x30FE, //     [W] Lm     [3] KATAKANA-HIRAGANA PROLONGED SOUND MARK..KATAKANA VOICED ITERATION MARK
        0x30FF, //              [W] Lo         KATAKANA DIGRAPH KOTO
        0x3105...0x312F, //     [W] Lo    [43] BOPOMOFO LETTER B..BOPOMOFO LETTER NN
        0x3131...0x318E, //     [W] Lo    [94] HANGUL LETTER KIYEOK..HANGUL LETTER ARAEAE
        0x3190...0x3191, //     [W] So     [2] IDEOGRAPHIC ANNOTATION LINKING MARK..IDEOGRAPHIC ANNOTATION REVERSE MARK
        0x3192...0x3195, //     [W] No     [4] IDEOGRAPHIC ANNOTATION ONE MARK..IDEOGRAPHIC ANNOTATION FOUR MARK
        0x3196...0x319F, //     [W] So    [10] IDEOGRAPHIC ANNOTATION TOP MARK..IDEOGRAPHIC ANNOTATION MAN MARK
        0x31A0...0x31BF, //     [W] Lo    [32] BOPOMOFO LETTER BU..BOPOMOFO LETTER AH
        0x31C0...0x31E3, //     [W] So    [36] CJK STROKE T..CJK STROKE Q
        0x31EF, //              [W] So         IDEOGRAPHIC DESCRIPTION CHARACTER SUBTRACTION
        0x31F0...0x31FF, //     [W] Lo    [16] KATAKANA LETTER SMALL KU..KATAKANA LETTER SMALL RO
        0x3200...0x321E, //     [W] So    [31] PARENTHESIZED HANGUL KIYEOK..PARENTHESIZED KOREAN CHARACTER O HU
        0x3220...0x3229, //     [W] No    [10] PARENTHESIZED IDEOGRAPH ONE..PARENTHESIZED IDEOGRAPH TEN
        0x322A...0x3247, //     [W] So    [30] PARENTHESIZED IDEOGRAPH MOON..CIRCLED IDEOGRAPH KOTO
        0x3250, //              [W] So         PARTNERSHIP SIGN
        0x3251...0x325F, //     [W] No    [15] CIRCLED NUMBER TWENTY ONE..CIRCLED NUMBER THIRTY FIVE
        0x3260...0x327F, //     [W] So    [32] CIRCLED HANGUL KIYEOK..KOREAN STANDARD SYMBOL
        0x3280...0x3289, //     [W] No    [10] CIRCLED IDEOGRAPH ONE..CIRCLED IDEOGRAPH TEN
        0x328A...0x32B0, //     [W] So    [39] CIRCLED IDEOGRAPH MOON..CIRCLED IDEOGRAPH NIGHT
        0x32B1...0x32BF, //     [W] No    [15] CIRCLED NUMBER THIRTY SIX..CIRCLED NUMBER FIFTY
        0x32C0...0x32FF, //     [W] So    [64] IDEOGRAPHIC TELEGRAPH SYMBOL FOR JANUARY..SQUARE ERA NAME REIWA
        0x3300...0x33FF, //     [W] So   [256] SQUARE APAATO..SQUARE GAL
        0x3400...0x4DBF, //     [W] Lo  [6592] CJK UNIFIED IDEOGRAPH-3400..CJK UNIFIED IDEOGRAPH-4DBF
        0x4E00...0x9FFF, //     [W] Lo [20992] CJK UNIFIED IDEOGRAPH-4E00..CJK UNIFIED IDEOGRAPH-9FFF
        0xA000...0xA014, //     [W] Lo    [21] YI SYLLABLE IT..YI SYLLABLE E
        0xA015, //              [W] Lm         YI SYLLABLE WU
        0xA016...0xA48C, //     [W] Lo  [1143] YI SYLLABLE BIT..YI SYLLABLE YYR
        0xA490...0xA4C6, //     [W] So    [55] YI RADICAL QOT..YI RADICAL KE
        0xA960...0xA97C, //     [W] Lo    [29] HANGUL CHOSEONG TIKEUT-MIEUM..HANGUL CHOSEONG SSANGYEORINHIEUH
        0xAC00...0xD7A3, //     [W] Lo [11172] HANGUL SYLLABLE GA..HANGUL SYLLABLE HIH
        0xF900...0xFA6D, //     [W] Lo   [366] CJK COMPATIBILITY IDEOGRAPH-F900..CJK COMPATIBILITY IDEOGRAPH-FA6D
        0xFA6E...0xFA6F, //     [W] Cn     [2] <reserved-FA6E>..<reserved-FA6F>
        0xFA70...0xFAD9, //     [W] Lo   [106] CJK COMPATIBILITY IDEOGRAPH-FA70..CJK COMPATIBILITY IDEOGRAPH-FAD9
        0xFADA...0xFAFF, //     [W] Cn    [38] <reserved-FADA>..<reserved-FAFF>
        0xFE10...0xFE16, //     [W] Po     [7] PRESENTATION FORM FOR VERTICAL COMMA..PRESENTATION FORM FOR VERTICAL QUESTION MARK
        0xFE17, //              [W] Ps         PRESENTATION FORM FOR VERTICAL LEFT WHITE LENTICULAR BRACKET
        0xFE18, //              [W] Pe         PRESENTATION FORM FOR VERTICAL RIGHT WHITE LENTICULAR BRAKCET
        0xFE19, //              [W] Po         PRESENTATION FORM FOR VERTICAL HORIZONTAL ELLIPSIS
        0xFE30, //              [W] Po         PRESENTATION FORM FOR VERTICAL TWO DOT LEADER
        0xFE31...0xFE32, //     [W] Pd     [2] PRESENTATION FORM FOR VERTICAL EM DASH..PRESENTATION FORM FOR VERTICAL EN DASH
        0xFE33...0xFE34, //     [W] Pc     [2] PRESENTATION FORM FOR VERTICAL LOW LINE..PRESENTATION FORM FOR VERTICAL WAVY LOW LINE
        0xFE35, //              [W] Ps         PRESENTATION FORM FOR VERTICAL LEFT PARENTHESIS
        0xFE36, //              [W] Pe         PRESENTATION FORM FOR VERTICAL RIGHT PARENTHESIS
        0xFE37, //              [W] Ps         PRESENTATION FORM FOR VERTICAL LEFT CURLY BRACKET
        0xFE38, //              [W] Pe         PRESENTATION FORM FOR VERTICAL RIGHT CURLY BRACKET
        0xFE39, //              [W] Ps         PRESENTATION FORM FOR VERTICAL LEFT TORTOISE SHELL BRACKET
        0xFE3A, //              [W] Pe         PRESENTATION FORM FOR VERTICAL RIGHT TORTOISE SHELL BRACKET
        0xFE3B, //              [W] Ps         PRESENTATION FORM FOR VERTICAL LEFT BLACK LENTICULAR BRACKET
        0xFE3C, //              [W] Pe         PRESENTATION FORM FOR VERTICAL RIGHT BLACK LENTICULAR BRACKET
        0xFE3D, //              [W] Ps         PRESENTATION FORM FOR VERTICAL LEFT DOUBLE ANGLE BRACKET
        0xFE3E, //              [W] Pe         PRESENTATION FORM FOR VERTICAL RIGHT DOUBLE ANGLE BRACKET
        0xFE3F, //              [W] Ps         PRESENTATION FORM FOR VERTICAL LEFT ANGLE BRACKET
        0xFE40, //              [W] Pe         PRESENTATION FORM FOR VERTICAL RIGHT ANGLE BRACKET
        0xFE41, //              [W] Ps         PRESENTATION FORM FOR VERTICAL LEFT CORNER BRACKET
        0xFE42, //              [W] Pe         PRESENTATION FORM FOR VERTICAL RIGHT CORNER BRACKET
        0xFE43, //              [W] Ps         PRESENTATION FORM FOR VERTICAL LEFT WHITE CORNER BRACKET
        0xFE44, //              [W] Pe         PRESENTATION FORM FOR VERTICAL RIGHT WHITE CORNER BRACKET
        0xFE45...0xFE46, //     [W] Po     [2] SESAME DOT..WHITE SESAME DOT
        0xFE47, //              [W] Ps         PRESENTATION FORM FOR VERTICAL LEFT SQUARE BRACKET
        0xFE48, //              [W] Pe         PRESENTATION FORM FOR VERTICAL RIGHT SQUARE BRACKET
        0xFE49...0xFE4C, //     [W] Po     [4] DASHED OVERLINE..DOUBLE WAVY OVERLINE
        0xFE4D...0xFE4F, //     [W] Pc     [3] DASHED LOW LINE..WAVY LOW LINE
        0xFE50...0xFE52, //     [W] Po     [3] SMALL COMMA..SMALL FULL STOP
        0xFE54...0xFE57, //     [W] Po     [4] SMALL SEMICOLON..SMALL EXCLAMATION MARK
        0xFE58, //              [W] Pd         SMALL EM DASH
        0xFE59, //              [W] Ps         SMALL LEFT PARENTHESIS
        0xFE5A, //              [W] Pe         SMALL RIGHT PARENTHESIS
        0xFE5B, //              [W] Ps         SMALL LEFT CURLY BRACKET
        0xFE5C, //              [W] Pe         SMALL RIGHT CURLY BRACKET
        0xFE5D, //              [W] Ps         SMALL LEFT TORTOISE SHELL BRACKET
        0xFE5E, //              [W] Pe         SMALL RIGHT TORTOISE SHELL BRACKET
        0xFE5F...0xFE61, //     [W] Po     [3] SMALL NUMBER SIGN..SMALL ASTERISK
        0xFE62, //              [W] Sm         SMALL PLUS SIGN
        0xFE63, //              [W] Pd         SMALL HYPHEN-MINUS
        0xFE64...0xFE66, //     [W] Sm     [3] SMALL LESS-THAN SIGN..SMALL EQUALS SIGN
        0xFE68, //              [W] Po         SMALL REVERSE SOLIDUS
        0xFE69, //              [W] Sc         SMALL DOLLAR SIGN
        0xFE6A...0xFE6B, //     [W] Po     [2] SMALL PERCENT SIGN..SMALL COMMERCIAL AT
        0xFF01...0xFF03, //     [F] Po     [3] FULLWIDTH EXCLAMATION MARK..FULLWIDTH NUMBER SIGN
        0xFF04, //              [F] Sc         FULLWIDTH DOLLAR SIGN
        0xFF05...0xFF07, //     [F] Po     [3] FULLWIDTH PERCENT SIGN..FULLWIDTH APOSTROPHE
        0xFF08, //              [F] Ps         FULLWIDTH LEFT PARENTHESIS
        0xFF09, //              [F] Pe         FULLWIDTH RIGHT PARENTHESIS
        0xFF0A, //              [F] Po         FULLWIDTH ASTERISK
        0xFF0B, //              [F] Sm         FULLWIDTH PLUS SIGN
        0xFF0C, //              [F] Po         FULLWIDTH COMMA
        0xFF0D, //              [F] Pd         FULLWIDTH HYPHEN-MINUS
        0xFF0E...0xFF0F, //     [F] Po     [2] FULLWIDTH FULL STOP..FULLWIDTH SOLIDUS
        0xFF10...0xFF19, //     [F] Nd    [10] FULLWIDTH DIGIT ZERO..FULLWIDTH DIGIT NINE
        0xFF1A...0xFF1B, //     [F] Po     [2] FULLWIDTH COLON..FULLWIDTH SEMICOLON
        0xFF1C...0xFF1E, //     [F] Sm     [3] FULLWIDTH LESS-THAN SIGN..FULLWIDTH GREATER-THAN SIGN
        0xFF1F...0xFF20, //     [F] Po     [2] FULLWIDTH QUESTION MARK..FULLWIDTH COMMERCIAL AT
        0xFF21...0xFF3A, //     [F] Lu    [26] FULLWIDTH LATIN CAPITAL LETTER A..FULLWIDTH LATIN CAPITAL LETTER Z
        0xFF3B, //              [F] Ps         FULLWIDTH LEFT SQUARE BRACKET
        0xFF3C, //              [F] Po         FULLWIDTH REVERSE SOLIDUS
        0xFF3D, //              [F] Pe         FULLWIDTH RIGHT SQUARE BRACKET
        0xFF3E, //              [F] Sk         FULLWIDTH CIRCUMFLEX ACCENT
        0xFF3F, //              [F] Pc         FULLWIDTH LOW LINE
        0xFF40, //              [F] Sk         FULLWIDTH GRAVE ACCENT
        0xFF41...0xFF5A, //     [F] Ll    [26] FULLWIDTH LATIN SMALL LETTER A..FULLWIDTH LATIN SMALL LETTER Z
        0xFF5B, //              [F] Ps         FULLWIDTH LEFT CURLY BRACKET
        0xFF5C, //              [F] Sm         FULLWIDTH VERTICAL LINE
        0xFF5D, //              [F] Pe         FULLWIDTH RIGHT CURLY BRACKET
        0xFF5E, //              [F] Sm         FULLWIDTH TILDE
        0xFF5F, //              [F] Ps         FULLWIDTH LEFT WHITE PARENTHESIS
        0xFF60, //              [F] Pe         FULLWIDTH RIGHT WHITE PARENTHESIS
        0xFFE0...0xFFE1, //     [F] Sc     [2] FULLWIDTH CENT SIGN..FULLWIDTH POUND SIGN
        0xFFE2, //              [F] Sm         FULLWIDTH NOT SIGN
        0xFFE3, //              [F] Sk         FULLWIDTH MACRON
        0xFFE4, //              [F] So         FULLWIDTH BROKEN BAR
        0xFFE5...0xFFE6, //     [F] Sc     [2] FULLWIDTH YEN SIGN..FULLWIDTH WON SIGN
        0x16FE0...0x16FE1, //   [W] Lm     [2] TANGUT ITERATION MARK..NUSHU ITERATION MARK
        0x16FE2, //             [W] Po         OLD CHINESE HOOK MARK
        0x16FE3, //             [W] Lm         OLD CHINESE ITERATION MARK
        0x16FE4, //             [W] Mn         KHITAN SMALL SCRIPT FILLER
        0x16FF0...0x16FF1, //   [W] Mc     [2] VIETNAMESE ALTERNATE READING MARK CA..VIETNAMESE ALTERNATE READING MARK NHAY
        0x17000...0x187F7, //   [W] Lo  [6136] TANGUT IDEOGRAPH-17000..TANGUT IDEOGRAPH-187F7
        0x18800...0x18AFF, //   [W] Lo   [768] TANGUT COMPONENT-001..TANGUT COMPONENT-768
        0x18B00...0x18CD5, //   [W] Lo   [470] KHITAN SMALL SCRIPT CHARACTER-18B00..KHITAN SMALL SCRIPT CHARACTER-18CD5
        0x18D00...0x18D08, //   [W] Lo     [9] TANGUT IDEOGRAPH-18D00..TANGUT IDEOGRAPH-18D08
        0x1AFF0...0x1AFF3, //   [W] Lm     [4] KATAKANA LETTER MINNAN TONE-2..KATAKANA LETTER MINNAN TONE-5
        0x1AFF5...0x1AFFB, //   [W] Lm     [7] KATAKANA LETTER MINNAN TONE-7..KATAKANA LETTER MINNAN NASALIZED TONE-5
        0x1AFFD...0x1AFFE, //   [W] Lm     [2] KATAKANA LETTER MINNAN NASALIZED TONE-7..KATAKANA LETTER MINNAN NASALIZED TONE-8
        0x1B000...0x1B0FF, //   [W] Lo   [256] KATAKANA LETTER ARCHAIC E..HENTAIGANA LETTER RE-2
        0x1B100...0x1B122, //   [W] Lo    [35] HENTAIGANA LETTER RE-3..KATAKANA LETTER ARCHAIC WU
        0x1B132, //             [W] Lo         HIRAGANA LETTER SMALL KO
        0x1B150...0x1B152, //   [W] Lo     [3] HIRAGANA LETTER SMALL WI..HIRAGANA LETTER SMALL WO
        0x1B155, //             [W] Lo         KATAKANA LETTER SMALL KO
        0x1B164...0x1B167, //   [W] Lo     [4] KATAKANA LETTER SMALL WI..KATAKANA LETTER SMALL N
        0x1B170...0x1B2FB, //   [W] Lo   [396] NUSHU CHARACTER-1B170..NUSHU CHARACTER-1B2FB
        0x1F004, //             [W] So         MAHJONG TILE RED DRAGON
        0x1F0CF, //             [W] So         PLAYING CARD BLACK JOKER
        0x1F18E, //             [W] So         NEGATIVE SQUARED AB
        0x1F191...0x1F19A, //   [W] So    [10] SQUARED CL..SQUARED VS
        0x1F200...0x1F202, //   [W] So     [3] SQUARE HIRAGANA HOKA..SQUARED KATAKANA SA
        0x1F210...0x1F23B, //   [W] So    [44] SQUARED CJK UNIFIED IDEOGRAPH-624B..SQUARED CJK UNIFIED IDEOGRAPH-914D
        0x1F240...0x1F248, //   [W] So     [9] TORTOISE SHELL BRACKETED CJK UNIFIED IDEOGRAPH-672C..TORTOISE SHELL BRACKETED CJK UNIFIED IDEOGRAPH-6557
        0x1F250...0x1F251, //   [W] So     [2] CIRCLED IDEOGRAPH ADVANTAGE..CIRCLED IDEOGRAPH ACCEPT
        0x1F260...0x1F265, //   [W] So     [6] ROUNDED SYMBOL FOR FU..ROUNDED SYMBOL FOR CAI
        0x1F300...0x1F320, //   [W] So    [33] CYCLONE..SHOOTING STAR
        0x1F32D...0x1F335, //   [W] So     [9] HOT DOG..CACTUS
        0x1F337...0x1F37C, //   [W] So    [70] TULIP..BABY BOTTLE
        0x1F37E...0x1F393, //   [W] So    [22] BOTTLE WITH POPPING CORK..GRADUATION CAP
        0x1F3A0...0x1F3CA, //   [W] So    [43] CAROUSEL HORSE..SWIMMER
        0x1F3CF...0x1F3D3, //   [W] So     [5] CRICKET BAT AND BALL..TABLE TENNIS PADDLE AND BALL
        0x1F3E0...0x1F3F0, //   [W] So    [17] HOUSE BUILDING..EUROPEAN CASTLE
        0x1F3F4, //             [W] So         WAVING BLACK FLAG
        0x1F3F8...0x1F3FA, //   [W] So     [3] BADMINTON RACQUET AND SHUTTLECOCK..AMPHORA
        0x1F3FB...0x1F3FF, //   [W] Sk     [5] EMOJI MODIFIER FITZPATRICK TYPE-1-2..EMOJI MODIFIER FITZPATRICK TYPE-6
        0x1F400...0x1F43E, //   [W] So    [63] RAT..PAW PRINTS
        0x1F440, //             [W] So         EYES
        0x1F442...0x1F4FC, //   [W] So   [187] EAR..VIDEOCASSETTE
        0x1F4FF...0x1F53D, //   [W] So    [63] PRAYER BEADS..DOWN-POINTING SMALL RED TRIANGLE
        0x1F54B...0x1F54E, //   [W] So     [4] KAABA..MENORAH WITH NINE BRANCHES
        0x1F550...0x1F567, //   [W] So    [24] CLOCK FACE ONE OCLOCK..CLOCK FACE TWELVE-THIRTY
        0x1F57A, //             [W] So         MAN DANCING
        0x1F595...0x1F596, //   [W] So     [2] REVERSED HAND WITH MIDDLE FINGER EXTENDED..RAISED HAND WITH PART BETWEEN MIDDLE AND RING FINGERS
        0x1F5A4, //             [W] So         BLACK HEART
        0x1F5FB...0x1F5FF, //   [W] So     [5] MOUNT FUJI..MOYAI
        0x1F600...0x1F64F, //   [W] So    [80] GRINNING FACE..PERSON WITH FOLDED HANDS
        0x1F680...0x1F6C5, //   [W] So    [70] ROCKET..LEFT LUGGAGE
        0x1F6CC, //             [W] So         SLEEPING ACCOMMODATION
        0x1F6D0...0x1F6D2, //   [W] So     [3] PLACE OF WORSHIP..SHOPPING TROLLEY
        0x1F6D5...0x1F6D7, //   [W] So     [3] HINDU TEMPLE..ELEVATOR
        0x1F6DC...0x1F6DF, //   [W] So     [4] WIRELESS..RING BUOY
        0x1F6EB...0x1F6EC, //   [W] So     [2] AIRPLANE DEPARTURE..AIRPLANE ARRIVING
        0x1F6F4...0x1F6FC, //   [W] So     [9] SCOOTER..ROLLER SKATE
        0x1F7E0...0x1F7EB, //   [W] So    [12] LARGE ORANGE CIRCLE..LARGE BROWN SQUARE
        0x1F7F0, //             [W] So         HEAVY EQUALS SIGN
        0x1F90C...0x1F93A, //   [W] So    [47] PINCHED FINGERS..FENCER
        0x1F93C...0x1F945, //   [W] So    [10] WRESTLERS..GOAL NET
        0x1F947...0x1F9FF, //   [W] So   [185] FIRST PLACE MEDAL..NAZAR AMULET
        0x1FA70...0x1FA7C, //   [W] So    [13] BALLET SHOES..CRUTCH
        0x1FA80...0x1FA88, //   [W] So     [9] YO-YO..FLUTE
        0x1FA90...0x1FABD, //   [W] So    [46] RINGED PLANET..WING
        0x1FABF...0x1FAC5, //   [W] So     [7] GOOSE..PERSON WITH CROWN
        0x1FACE...0x1FADB, //   [W] So    [14] MOOSE..PEA POD
        0x1FAE0...0x1FAE8, //   [W] So     [9] MELTING FACE..SHAKING FACE
        0x1FAF0...0x1FAF8, //   [W] So     [9] HAND WITH INDEX FINGER AND THUMB CROSSED..RIGHTWARDS PUSHING HAND
        0x20000...0x2A6DF, //   [W] Lo [42720] CJK UNIFIED IDEOGRAPH-20000..CJK UNIFIED IDEOGRAPH-2A6DF
        0x2A6E0...0x2A6FF, //   [W] Cn    [32] <reserved-2A6E0>..<reserved-2A6FF>
        0x2A700...0x2B739, //   [W] Lo  [4154] CJK UNIFIED IDEOGRAPH-2A700..CJK UNIFIED IDEOGRAPH-2B739
        0x2B73A...0x2B73F, //   [W] Cn     [6] <reserved-2B73A>..<reserved-2B73F>
        0x2B740...0x2B81D, //   [W] Lo   [222] CJK UNIFIED IDEOGRAPH-2B740..CJK UNIFIED IDEOGRAPH-2B81D
        0x2B81E...0x2B81F, //   [W] Cn     [2] <reserved-2B81E>..<reserved-2B81F>
        0x2B820...0x2CEA1, //   [W] Lo  [5762] CJK UNIFIED IDEOGRAPH-2B820..CJK UNIFIED IDEOGRAPH-2CEA1
        0x2CEA2...0x2CEAF, //   [W] Cn    [14] <reserved-2CEA2>..<reserved-2CEAF>
        0x2CEB0...0x2EBE0, //   [W] Lo  [7473] CJK UNIFIED IDEOGRAPH-2CEB0..CJK UNIFIED IDEOGRAPH-2EBE0
        0x2EBE1...0x2EBEF, //   [W] Cn    [15] <reserved-2EBE1>..<reserved-2EBEF>
        0x2EBF0...0x2EE5D, //   [W] Lo   [622] CJK UNIFIED IDEOGRAPH-2EBF0..CJK UNIFIED IDEOGRAPH-2EE5D
        0x2EE5E...0x2F7FF, //   [W] Cn  [2466] <reserved-2EE5E>..<reserved-2F7FF>
        0x2F800...0x2FA1D, //   [W] Lo   [542] CJK COMPATIBILITY IDEOGRAPH-2F800..CJK COMPATIBILITY IDEOGRAPH-2FA1D
        0x2FA1E...0x2FA1F, //   [W] Cn     [2] <reserved-2FA1E>..<reserved-2FA1F>
        0x2FA20...0x2FFFD, //   [W] Cn  [1502] <reserved-2FA20>..<reserved-2FFFD>
        0x30000...0x3134A, //   [W] Lo  [4939] CJK UNIFIED IDEOGRAPH-30000..CJK UNIFIED IDEOGRAPH-3134A
        0x3134B...0x3134F, //   [W] Cn     [5] <reserved-3134B>..<reserved-3134F>
        0x31350...0x323AF, //   [W] Lo  [4192] CJK UNIFIED IDEOGRAPH-31350..CJK UNIFIED IDEOGRAPH-323AF
        0x323B0...0x3FFFD, //   [W] Cn [56398] <reserved-323B0>..<reserved-3FFFD>
        => true,
        else => false,
    };
}

pub fn isAmgiguousCodepointType(comptime T: type, cp: T) bool {
    return switch (cp) {
        0xA1,
        0xA4,
        0xA7,
        0xA8,
        0xAA,
        0xAD,
        0xAE,
        0xB0...0xB4,
        0xB6...0xBA,
        0xBC...0xBF,
        0xC6,
        0xD0,
        0xD7,
        0xD8,
        0xDE...0xE1,
        0xE6,
        0xE8...0xEA,
        0xEC,
        0xED,
        0xF0,
        0xF2,
        0xF3,
        0xF7...0xFA,
        0xFC,
        0xFE,
        0x101,
        0x111,
        0x113,
        0x11B,
        0x126,
        0x127,
        0x12B,
        0x131...0x133,
        0x138,
        0x13F...0x142,
        0x144,
        0x148...0x14B,
        0x14D,
        0x152,
        0x153,
        0x166,
        0x167,
        0x16B,
        0x1CE,
        0x1D0,
        0x1D2,
        0x1D4,
        0x1D6,
        0x1D8,
        0x1DA,
        0x1DC,
        0x251,
        0x261,
        0x2C4,
        0x2C7,
        0x2C9...0x2CB,
        0x2CD,
        0x2D0,
        0x2D8...0x2DB,
        0x2DD,
        0x2DF,
        0x300...0x36F,
        0x391...0x3A1,
        0x3A3...0x3A9,
        0x3B1...0x3C1,
        0x3C3...0x3C9,
        0x401,
        0x410...0x44F,
        0x451,
        0x2010,
        0x2013...0x2016,
        0x2018,
        0x2019,
        0x201C,
        0x201D,
        0x2020...0x2022,
        0x2024...0x2027,
        0x2030,
        0x2032,
        0x2033,
        0x2035,
        0x203B,
        0x203E,
        0x2074,
        0x207F,
        0x2081...0x2084,
        0x20AC,
        0x2103,
        0x2105,
        0x2109,
        0x2113,
        0x2116,
        0x2121,
        0x2122,
        0x2126,
        0x212B,
        0x2153,
        0x2154,
        0x215B...0x215E,
        0x2160...0x216B,
        0x2170...0x2179,
        0x2189,
        0x2190...0x2199,
        0x21B8,
        0x21B9,
        0x21D2,
        0x21D4,
        0x21E7,
        0x2200,
        0x2202,
        0x2203,
        0x2207,
        0x2208,
        0x220B,
        0x220F,
        0x2211,
        0x2215,
        0x221A,
        0x221D...0x2220,
        0x2223,
        0x2225,
        0x2227...0x222C,
        0x222E,
        0x2234...0x2237,
        0x223C,
        0x223D,
        0x2248,
        0x224C,
        0x2252,
        0x2260,
        0x2261,
        0x2264...0x2267,
        0x226A,
        0x226B,
        0x226E,
        0x226F,
        0x2282,
        0x2283,
        0x2286,
        0x2287,
        0x2295,
        0x2299,
        0x22A5,
        0x22BF,
        0x2312,
        0x2460...0x24E9,
        0x24EB...0x254B,
        0x2550...0x2573,
        0x2580...0x258F,
        0x2592...0x2595,
        0x25A0,
        0x25A1,
        0x25A3...0x25A9,
        0x25B2,
        0x25B3,
        0x25B6,
        0x25B7,
        0x25BC,
        0x25BD,
        0x25C0,
        0x25C1,
        0x25C6...0x25C8,
        0x25CB,
        0x25CE...0x25D1,
        0x25E2...0x25E5,
        0x25EF,
        0x2605,
        0x2606,
        0x2609,
        0x260E,
        0x260F,
        0x261C,
        0x261E,
        0x2640,
        0x2642,
        0x2660,
        0x2661,
        0x2663...0x2665,
        0x2667...0x266A,
        0x266C,
        0x266D,
        0x266F,
        0x269E,
        0x269F,
        0x26BF,
        0x26C6...0x26CD,
        0x26CF...0x26D3,
        0x26D5...0x26E1,
        0x26E3,
        0x26E8,
        0x26E9,
        0x26EB...0x26F1,
        0x26F4,
        0x26F6...0x26F9,
        0x26FB,
        0x26FC,
        0x26FE,
        0x26FF,
        0x273D,
        0x2776...0x277F,
        0x2B56...0x2B59,
        0x3248...0x324F,
        0xE000...0xF8FF,
        0xFE00...0xFE0F,
        0xFFFD,
        0x1F100...0x1F10A,
        0x1F110...0x1F12D,
        0x1F130...0x1F169,
        0x1F170...0x1F18D,
        0x1F18F,
        0x1F190,
        0x1F19B...0x1F1AC,
        0xE0100...0xE01EF,
        0xF0000...0xFFFFD,
        0x100000...0x10FFFD,
        => true,
        else => false,
    };
}

pub fn visibleCodepointWidth(cp: u32, ambiguousAsWide: bool) u3_fast {
    return visibleCodepointWidthType(u32, cp, ambiguousAsWide);
}

pub fn visibleCodepointWidthMaybeEmoji(cp: u32, maybe_emoji: bool, ambiguousAsWide: bool) u3_fast {
    // UCHAR_EMOJI=57,
    if (maybe_emoji and icu_hasBinaryProperty(cp, 57)) {
        return 2;
    }
    return visibleCodepointWidth(cp, ambiguousAsWide);
}

pub fn visibleCodepointWidthType(comptime T: type, cp: T, ambiguousAsWide: bool) u3_fast {
    if (isZeroWidthCodepointType(T, cp)) {
        return 0;
    }

    if (isFullWidthCodepointType(T, cp)) {
        return 2;
    }
    if (ambiguousAsWide and isAmgiguousCodepointType(T, cp)) {
        return 2;
    }

    return 1;
}

pub const visible = struct {
    // Ref: https://cs.stanford.edu/people/miles/iso8859.html
    fn visibleLatin1Width(input_: []const u8) usize {
        var length: usize = 0;
        var input = input_;
        const input_end_ptr = input.ptr + input.len - (input.len % 16);
        var input_ptr = input.ptr;
        while (input_ptr != input_end_ptr) {
            const input_chunk: [16]u8 = input_ptr[0..16].*;
            const sums: @Vector(16, u8) = [16]u8{
                visibleLatin1WidthScalar(input_chunk[0]),
                visibleLatin1WidthScalar(input_chunk[1]),
                visibleLatin1WidthScalar(input_chunk[2]),
                visibleLatin1WidthScalar(input_chunk[3]),
                visibleLatin1WidthScalar(input_chunk[4]),
                visibleLatin1WidthScalar(input_chunk[5]),
                visibleLatin1WidthScalar(input_chunk[6]),
                visibleLatin1WidthScalar(input_chunk[7]),
                visibleLatin1WidthScalar(input_chunk[8]),
                visibleLatin1WidthScalar(input_chunk[9]),
                visibleLatin1WidthScalar(input_chunk[10]),
                visibleLatin1WidthScalar(input_chunk[11]),
                visibleLatin1WidthScalar(input_chunk[12]),
                visibleLatin1WidthScalar(input_chunk[13]),
                visibleLatin1WidthScalar(input_chunk[14]),
                visibleLatin1WidthScalar(input_chunk[15]),
            };
            length += @reduce(.Add, sums);
            input_ptr += 16;
        }
        input.len %= 16;
        input.ptr = input_ptr;

        for (input) |byte| length += visibleLatin1WidthScalar(byte);
        return length;
    }

    fn visibleLatin1WidthScalar(c: u8) u1 {
        // Zero-width: control chars (0x00-0x1F, 0x7F-0x9F) and soft hyphen (0xAD)
        return if ((c >= 127 and c <= 159) or c < 32 or c == 0xAD) 0 else 1;
    }

    fn visibleLatin1WidthExcludeANSIColors(input_: anytype) usize {
        var length: usize = 0;
        var input = input_;

        const ElementType = std.meta.Child(@TypeOf(input_));
        const indexFn = if (comptime ElementType == u8) strings.indexOfCharUsize else strings.indexOfChar16Usize;

        while (indexFn(input, '\x1b')) |i| {
            length += visibleLatin1Width(input[0..i]);
            input = input[i..];

            if (input.len < 2) return length;

            if (input[1] == '[') {
                // CSI sequence: ESC [ <params> <final byte>
                // Final byte is in range 0x40-0x7E (@ through ~)
                if (input.len < 3) return length;
                input = input[2..];
                while (input.len > 0) {
                    const c = input[0];
                    input = input[1..];
                    // Final byte terminates the sequence
                    if (c >= 0x40 and c <= 0x7E) break;
                }
            } else if (input[1] == ']') {
                // OSC sequence: ESC ] ... (BEL or ST)
                // Find terminator: BEL (0x07) or ST (ESC \)
                input = input[2..];
                while (input.len > 0) {
                    if (input[0] == 0x07) {
                        // BEL terminator
                        input = input[1..];
                        break;
                    } else if (input[0] == 0x1b and input.len > 1 and input[1] == '\\') {
                        // ST terminator (ESC \)
                        input = input[2..];
                        break;
                    }
                    input = input[1..];
                }
            } else {
                input = input[1..];
            }
        }

        length += visibleLatin1Width(input);

        return length;
    }

    fn visibleUTF8WidthFn(input: []const u8, comptime asciiFn: anytype) usize {
        var bytes = input;
        var len: usize = 0;
        while (bun.strings.firstNonASCII(bytes)) |i| {
            len += asciiFn(bytes[0..i]);
            const this_chunk = bytes[i..];
            const byte = this_chunk[0];

            const skip = bun.strings.wtf8ByteSequenceLengthWithInvalid(byte);
            const cp_bytes: [4]u8 = switch (@min(@as(usize, skip), this_chunk.len)) {
                inline 1, 2, 3, 4 => |cp_len| .{
                    byte,
                    if (comptime cp_len > 1) this_chunk[1] else 0,
                    if (comptime cp_len > 2) this_chunk[2] else 0,
                    if (comptime cp_len > 3) this_chunk[3] else 0,
                },
                else => unreachable,
            };

            const cp = decodeWTF8RuneTMultibyte(&cp_bytes, skip, u32, unicode_replacement);
            len += visibleCodepointWidth(cp, false);

            bytes = bytes[@min(i + skip, bytes.len)..];
        }

        len += asciiFn(bytes);

        return len;
    }

    /// Packed state for grapheme tracking - all small fields in one u32
    const PackedState = packed struct(u32) {
        non_emoji_width: u10 = 0, // Accumulated width (max 1024)
        base_width: u2 = 0, // Width of first codepoint (0, 1, or 2)
        count: u8 = 0, // Number of codepoints in grapheme
        // Flags
        emoji_base: bool = false,
        keycap: bool = false,
        regional_indicator: bool = false,
        skin_tone: bool = false,
        zwj: bool = false,
        vs15: bool = false,
        vs16: bool = false,
        _pad: u5 = 0,
    };

    const GraphemeState = struct {
        first_cp: u32 = 0,
        last_cp: u32 = 0,
        s: PackedState = .{},

        inline fn reset(self: *GraphemeState, cp: u32, ambiguousAsWide: bool) void {
            self.first_cp = cp;
            self.last_cp = cp;

            // Fast path for ASCII - no emoji complexity, simple width calculation
            if (cp < 0x80) {
                const w: u2 = if (cp >= 0x20 and cp < 0x7F) 1 else 0;
                self.s = .{ .count = 1, .base_width = w, .non_emoji_width = w };
                return;
            }

            const w: u3_fast = if (!isZeroWidthCodepointType(u32, cp))
                visibleCodepointWidthType(u32, cp, ambiguousAsWide)
            else
                0;

            self.s = .{
                .count = 1,
                .base_width = @truncate(w),
                .non_emoji_width = w,
                .emoji_base = isEmojiBase(cp),
                .keycap = cp == 0x20E3,
                .regional_indicator = isRegionalIndicator(cp),
                .skin_tone = isSkinToneModifier(cp),
                .zwj = cp == 0x200D,
            };
        }

        fn add(self: *GraphemeState, cp: u32, ambiguousAsWide: bool) void {
            self.last_cp = cp;
            self.s.count +|= 1;
            self.s.keycap = self.s.keycap or (cp == 0x20E3);
            self.s.regional_indicator = self.s.regional_indicator or isRegionalIndicator(cp);
            self.s.skin_tone = self.s.skin_tone or isSkinToneModifier(cp);
            self.s.zwj = self.s.zwj or (cp == 0x200D);
            self.s.vs15 = self.s.vs15 or (cp == 0xFE0E);
            self.s.vs16 = self.s.vs16 or (cp == 0xFE0F);

            if (!isZeroWidthCodepointType(u32, cp)) {
                self.s.non_emoji_width +|= visibleCodepointWidthType(u32, cp, ambiguousAsWide);
            }
        }

        inline fn width(self: *const GraphemeState) usize {
            const s = self.s;
            if (s.count == 0) return 0;

            // Regional indicator pair (flag emoji) → width 2
            if (s.regional_indicator and s.count >= 2) return 2;
            // Keycap sequence → width 2
            if (s.keycap) return 2;
            // Single regional indicator → width 1
            if (s.regional_indicator) return 1;
            // Emoji with skin tone or ZWJ → width 2
            if (s.emoji_base and (s.skin_tone or s.zwj)) return 2;

            // Handle variation selectors
            if (s.vs15 or s.vs16) {
                if (s.base_width == 2) return 2;
                if (s.vs16) {
                    const cp = self.first_cp;
                    if ((cp >= 0x30 and cp <= 0x39) or cp == 0x23 or cp == 0x2A) return 1;
                    if (cp < 0x80) return 1;
                    return 2;
                }
                return 1;
            }

            return s.non_emoji_width;
        }

        fn isEmojiBase(cp: u32) bool {
            // Note: ASCII fast path is handled in reset(), so cp >= 0x80 here

            // Fast path: nothing below U+203C can be an emoji base
            if (cp < 0x203C) return false;

            // Fast path: common non-emoji BMP ranges
            if (cp >= 0x2C00 and cp < 0x1F000) return false;

            // Exclude variation selectors and ZWJ which are handled separately
            if (cp == 0xFE0E or cp == 0xFE0F or cp == 0x200D) return false;

            // Use ICU for accurate emoji detection
            // UCHAR_EMOJI = 57
            return icu_hasBinaryProperty(cp, 57);
        }

        fn isRegionalIndicator(cp: u32) bool {
            return cp >= 0x1F1E6 and cp <= 0x1F1FF;
        }

        fn isSkinToneModifier(cp: u32) bool {
            return cp >= 0x1F3FB and cp <= 0x1F3FF;
        }
    };

    /// Count printable ASCII characters (0x20-0x7E) in a UTF-16 slice using SIMD
    fn countPrintableAscii16(input: []const u16) usize {
        var total: usize = 0;
        var remaining = input;

        // Process 8 u16 values at a time using SIMD
        const vec_len = 8;
        while (remaining.len >= vec_len) {
            const chunk: @Vector(vec_len, u16) = remaining[0..vec_len].*;
            const low: @Vector(vec_len, u16) = @splat(0x20);
            const high: @Vector(vec_len, u16) = @splat(0x7F);
            const ge_low = chunk >= low;
            const lt_high = chunk < high;
            const printable = @select(bool, ge_low, lt_high, @as(@Vector(vec_len, bool), @splat(false)));
            total += @popCount(@as(u8, @bitCast(printable)));
            remaining = remaining[vec_len..];
        }

        // Handle remaining elements
        for (remaining) |c| {
            total += @intFromBool(c >= 0x20 and c < 0x7F);
        }

        return total;
    }

    fn visibleUTF16WidthFn(input_: []const u16, exclude_ansi_colors: bool, ambiguousAsWide: bool) usize {
        var input = input_;
        var len: usize = 0;
        var prev: ?u32 = null;
        var break_state: grapheme.BreakState = .default;
        var grapheme_state = GraphemeState{};
        var saw_1b = false;
        var saw_csi = false; // CSI: ESC [
        var saw_osc = false; // OSC: ESC ]
        var stretch_len: usize = 0;

        while (true) {
            {
                const idx = firstNonASCII16(input) orelse input.len;

                // Fast path: bulk ASCII processing when not in escape sequence
                // ASCII chars are always their own graphemes, so we can count directly
                if (idx > 0 and !saw_1b and !saw_csi and !saw_osc) {
                    // Find how much we can bulk process
                    // If stripping ANSI, stop at first ESC; otherwise process entire run
                    const bulk_end = if (exclude_ansi_colors)
                        strings.indexOfChar16Usize(input[0..idx], 0x1b) orelse idx
                    else
                        idx;

                    if (bulk_end > 0) {
                        // Flush any pending grapheme from previous non-ASCII
                        if (grapheme_state.s.count > 0) {
                            len += grapheme_state.width();
                        }

                        // Count all but last char in bulk using SIMD
                        // Last char goes into grapheme_state in case combining mark follows
                        if (bulk_end > 1) {
                            len += countPrintableAscii16(input[0 .. bulk_end - 1]);
                        }

                        // Last char before ESC (or end) uses reset()
                        const last_cp: u32 = input[bulk_end - 1];
                        grapheme_state.reset(last_cp, ambiguousAsWide);
                        prev = last_cp;
                        break_state = .default;

                        // If we consumed everything, advance and continue
                        if (bulk_end == idx) {
                            input = input[idx..];
                            continue;
                        }

                        // Otherwise we hit ESC - start escape sequence handling
                        saw_1b = true;
                        prev = 0x1b;
                        input = input[bulk_end + 1 ..];
                        continue;
                    }
                }

                for (0..idx) |j| {
                    const cp: u32 = input[j];
                    defer prev = cp;

                    if (saw_osc) {
                        // In OSC sequence, look for BEL (0x07) or ST (ESC \)
                        if (cp == 0x07) {
                            saw_1b = false;
                            saw_osc = false;
                            stretch_len = 0;
                            continue;
                        } else if (cp == '\\' and prev == 0x1b) {
                            // ST terminator complete (ESC \)
                            saw_1b = false;
                            saw_osc = false;
                            stretch_len = 0;
                            continue;
                        } else if (cp == 0x1b) {
                            // ESC inside OSC - might be start of ST terminator
                            // Don't exit OSC yet, wait to see if next char is '\'
                            continue;
                        }
                        stretch_len += visibleCodepointWidth(cp, ambiguousAsWide);
                        continue;
                    }
                    if (saw_csi) {
                        // CSI final byte is in range 0x40-0x7E (@ through ~)
                        if (cp >= 0x40 and cp <= 0x7E) {
                            saw_1b = false;
                            saw_csi = false;
                            stretch_len = 0;
                            continue;
                        }
                        // Parameter bytes - don't add to width
                        continue;
                    }
                    if (saw_1b) {
                        if (cp == '[') {
                            saw_csi = true;
                            stretch_len = 0;
                            continue;
                        } else if (cp == ']') {
                            saw_osc = true;
                            stretch_len = 0;
                            continue;
                        } else if (cp == 0x1b) {
                            // Another ESC - this one starts a new potential sequence
                            // Keep saw_1b = true, don't add width (ESC is control char anyway)
                            continue;
                        }
                        len += visibleCodepointWidth(cp, ambiguousAsWide);
                        saw_1b = false;
                        continue;
                    }
                    if (!exclude_ansi_colors or cp != 0x1b) {
                        if (prev) |prev_| {
                            const should_break = grapheme.graphemeBreak(@truncate(prev_), @truncate(cp), &break_state);
                            if (should_break) {
                                len += grapheme_state.width();
                                grapheme_state.reset(@truncate(cp), ambiguousAsWide);
                            } else {
                                grapheme_state.add(cp, ambiguousAsWide);
                            }
                        } else {
                            grapheme_state.reset(@truncate(cp), ambiguousAsWide);
                        }
                        continue;
                    }
                    saw_1b = true;
                    continue;
                }
                // Only add stretch_len if we completed the escape sequence
                // (unterminated sequences should not contribute to width)
                if (!saw_csi and !saw_osc) {
                    len += stretch_len;
                }
                stretch_len = 0;
                input = input[idx..];
            }
            if (input.len == 0) break;
            const replacement = utf16CodepointWithFFFD(input);
            defer input = input[replacement.len..];
            // Skip invalid sequences and lone surrogates (treat as zero-width)
            if (replacement.fail or replacement.is_lead) continue;
            const cp: u32 = @intCast(replacement.code_point);
            defer prev = cp;

            // Handle non-ASCII characters inside escape sequences
            if (saw_osc) {
                // In OSC sequence, look for BEL (0x07) or ST (ESC \)
                // Non-ASCII chars inside OSC should not contribute to width
                if (cp == 0x07) {
                    saw_1b = false;
                    saw_osc = false;
                    stretch_len = 0;
                }
                // Note: ST (ESC \) only uses ASCII chars, so we don't need to check here
                continue;
            }
            if (saw_csi) {
                // CSI sequences should only contain ASCII parameters and final bytes
                // Non-ASCII char ends the CSI sequence abnormally - don't count it
                saw_1b = false;
                saw_csi = false;
                stretch_len = 0;
                continue;
            }
            if (saw_1b) {
                // ESC followed by non-ASCII - not a valid sequence start
                saw_1b = false;
                // Don't count this char as part of escape, treat normally below
            }

            if (prev) |prev_| {
                const should_break = grapheme.graphemeBreak(@truncate(prev_), @truncate(cp), &break_state);
                if (should_break) {
                    len += grapheme_state.width();
                    grapheme_state.reset(cp, ambiguousAsWide);
                } else {
                    grapheme_state.add(cp, ambiguousAsWide);
                }
            } else {
                grapheme_state.reset(cp, ambiguousAsWide);
            }
        }
        // Add width of final grapheme
        len += grapheme_state.width();
        return len;
    }

    fn visibleLatin1WidthFn(input: []const u8) usize {
        return visibleLatin1Width(input);
    }

    pub const width = struct {
        pub fn latin1(input: []const u8) usize {
            return visibleLatin1Width(input);
        }

        pub fn utf8(input: []const u8) usize {
            return visibleUTF8WidthFn(input, visibleLatin1Width);
        }

        pub fn utf16(input: []const u16, ambiguousAsWide: bool) usize {
            return visibleUTF16WidthFn(input, false, ambiguousAsWide);
        }

        pub const exclude_ansi_colors = struct {
            pub fn latin1(input: []const u8) usize {
                return visibleLatin1WidthExcludeANSIColors(input);
            }

            pub fn utf8(input: []const u8) usize {
                return visibleUTF8WidthFn(input, visibleLatin1WidthExcludeANSIColors);
            }

            pub fn utf16(input: []const u16, ambiguousAsWide: bool) usize {
                return visibleUTF16WidthFn(input, true, ambiguousAsWide);
            }
        };
    };
};

// extern "C" bool icu_hasBinaryProperty(UChar32 cp, unsigned int prop)
extern fn icu_hasBinaryProperty(c: u32, which: c_uint) bool;

// C exports for wrapAnsi.cpp

/// Calculate visible width of UTF-8 string excluding ANSI escape codes
export fn Bun__visibleWidthExcludeANSI_utf8(ptr: [*]const u8, len: usize, ambiguous_as_wide: bool) usize {
    _ = ambiguous_as_wide; // UTF-8 version doesn't use this parameter
    const input = ptr[0..len];
    return visible.width.exclude_ansi_colors.utf8(input);
}

/// Calculate visible width of UTF-16 string excluding ANSI escape codes
export fn Bun__visibleWidthExcludeANSI_utf16(ptr: [*]const u16, len: usize, ambiguous_as_wide: bool) usize {
    const input = ptr[0..len];
    return visible.width.exclude_ansi_colors.utf16(input, ambiguous_as_wide);
}

/// Calculate visible width of Latin-1 string excluding ANSI escape codes
export fn Bun__visibleWidthExcludeANSI_latin1(ptr: [*]const u8, len: usize) usize {
    const input = ptr[0..len];
    return visible.width.exclude_ansi_colors.latin1(input);
}

/// Calculate visible width of a single codepoint
export fn Bun__codepointWidth(cp: u32, ambiguous_as_wide: bool) u8 {
    return @intCast(visibleCodepointWidth(cp, ambiguous_as_wide));
}

const bun = @import("bun");
const std = @import("std");

const strings = bun.strings;
const decodeWTF8RuneTMultibyte = strings.decodeWTF8RuneTMultibyte;
const firstNonASCII = strings.firstNonASCII;
const firstNonASCII16 = strings.firstNonASCII16;
const grapheme = strings.grapheme;
const u3_fast = strings.u3_fast;
const unicode_replacement = strings.unicode_replacement;
const utf16CodepointWithFFFD = strings.utf16CodepointWithFFFD;
