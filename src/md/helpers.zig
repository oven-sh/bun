/// Check if a byte is ASCII whitespace (space, tab, LF, CR, FF, VT).
pub inline fn isWhitespace(c: u8) bool {
    return switch (c) {
        ' ', '\t', '\n', '\r', 0x0C, 0x0B => true,
        else => false,
    };
}

/// Check if a byte is a blank character (space or tab).
pub inline fn isBlank(c: u8) bool {
    return c == ' ' or c == '\t';
}

/// Check if a byte is a newline (CR or LF).
pub inline fn isNewline(c: u8) bool {
    return c == '\n' or c == '\r';
}

/// Check if a byte is a newline or NUL (used for end-of-line detection).
pub inline fn isNewlineOrNul(c: u8) bool {
    return c == '\n' or c == '\r' or c == 0;
}

/// Check if byte is ASCII alphanumeric.
pub inline fn isAlphaNum(c: u8) bool {
    return std.ascii.isAlphanumeric(c);
}

/// Check if byte is ASCII alpha.
pub inline fn isAlpha(c: u8) bool {
    return std.ascii.isAlphabetic(c);
}

/// Check if byte is ASCII digit.
pub inline fn isDigit(c: u8) bool {
    return std.ascii.isDigit(c);
}

/// Check if byte is ASCII hex digit.
pub inline fn isHexDigit(c: u8) bool {
    return std.ascii.isHex(c);
}

/// Check if a Unicode codepoint is whitespace per CommonMark spec.
/// This includes ASCII whitespace + Unicode Zs category.
pub fn isUnicodeWhitespace(codepoint: u21) bool {
    if (codepoint < 128) return isWhitespace(@intCast(codepoint));
    return switch (codepoint) {
        0x00A0, // NO-BREAK SPACE
        0x1680, // OGHAM SPACE MARK
        0x2000...0x200A, // EN QUAD...HAIR SPACE
        0x202F, // NARROW NO-BREAK SPACE
        0x205F, // MEDIUM MATHEMATICAL SPACE
        0x3000, // IDEOGRAPHIC SPACE
        => true,
        else => false,
    };
}

/// Check if a Unicode codepoint is punctuation per CommonMark spec.
pub fn isUnicodePunctuation(codepoint: u21) bool {
    if (codepoint < 128) return isAsciiPunctuation(@intCast(codepoint));
    // Unicode categories Pc, Pd, Pe, Pf, Pi, Po, Ps, Sc, Sk, Sm, So
    return isUnicodePunctuationExtended(codepoint);
}

/// Check if byte is ASCII punctuation per CommonMark spec.
pub inline fn isAsciiPunctuation(c: u8) bool {
    return switch (c) {
        '!', '"', '#', '$', '%', '&', '\'', '(', ')', '*', '+', ',', '-', '.', '/' => true,
        ':', ';', '<', '=', '>', '?', '@' => true,
        '[', '\\', ']', '^', '_', '`' => true,
        '{', '|', '}', '~' => true,
        else => false,
    };
}

/// Extended Unicode punctuation check (non-ASCII).
/// Unicode general "P" and "S" categories, matching md4c's punct map.
fn isUnicodePunctuationExtended(codepoint: u21) bool {
    for (unicode_punctuation_ranges) |range| {
        if (codepoint >= range[0] and codepoint <= range[1]) return true;
        if (codepoint < range[0]) return false;
    }
    return false;
}

/// Check if a character at a given offset matches any character in the set.
pub inline fn isAnyOf(text: []const u8, off: OFF, chars: []const u8) bool {
    if (off >= text.len) return false;
    const c = text[off];
    for (chars) |ch| {
        if (c == ch) return true;
    }
    return false;
}

/// Get the indentation of a line starting from `off`, counting spaces and tabs.
/// Returns the indent width and advances `off` past the whitespace.
pub fn lineIndentation(text: []const u8, total_indent: u32, off_start: OFF) struct { indent: u32, off: OFF } {
    var off = off_start;
    var indent: u32 = 0;
    while (off < text.len and isBlank(text[off])) {
        if (text[off] == '\t') {
            indent = (total_indent + indent + 4) / 4 * 4 - total_indent;
        } else {
            indent += 1;
        }
        off += 1;
    }
    return .{ .indent = indent, .off = off };
}

pub const Utf8DecodeResult = struct { codepoint: u21, len: u3 };

/// Decode a UTF-8 codepoint from the text at the given offset.
/// Returns the codepoint and the number of bytes consumed.
pub fn decodeUtf8(text: []const u8, off: usize) Utf8DecodeResult {
    if (off >= text.len) return .{ .codepoint = 0, .len = 1 };
    const b0 = text[off];
    if (b0 < 0x80) return .{ .codepoint = b0, .len = 1 };

    const seq_len = bun.strings.codepointSize(u8, b0);
    if (seq_len == 0) return .{ .codepoint = 0xFFFD, .len = 1 };
    const remaining = text.len - off;
    if (remaining < seq_len) return .{ .codepoint = 0xFFFD, .len = 1 };

    var buf: [4]u8 = .{ 0, 0, 0, 0 };
    const n: usize = @intCast(seq_len);
    @memcpy(buf[0..n], text[off..][0..n]);

    const cp = bun.strings.decodeWTF8RuneT(&buf, seq_len, u21, 0xFFFD);
    return .{ .codepoint = cp, .len = @intCast(seq_len) };
}

/// Decode the UTF-8 codepoint ending just before position `off` (i.e. the
/// codepoint whose last byte is at `text[off - 1]`).
/// Returns the codepoint and the number of bytes it occupies.
pub fn decodeUtf8Backward(text: []const u8, off: usize) Utf8DecodeResult {
    if (off == 0 or off > text.len) return .{ .codepoint = 0, .len = 1 };
    const last = text[off - 1];
    if (last < 0x80) return .{ .codepoint = last, .len = 1 };
    // Walk back over continuation bytes (10xxxxxx)
    var start: usize = off - 1;
    while (start > 0 and (text[start] & 0xC0) == 0x80) {
        start -= 1;
    }
    const r = decodeUtf8(text, start);
    return .{ .codepoint = r.codepoint, .len = r.len };
}

/// Encode a Unicode codepoint as UTF-8.
pub fn encodeUtf8(codepoint: u21, buf: *[4]u8) u3 {
    return @intCast(bun.strings.encodeWTF8RuneT(buf, u21, codepoint));
}

/// Skip UTF-8 BOM if present at the start of the text.
pub fn skipUtf8Bom(text: []const u8) []const u8 {
    if (text.len >= 3 and text[0] == 0xEF and text[1] == 0xBB and text[2] == 0xBF) {
        return text[3..];
    }
    return text;
}

/// Skip YAML frontmatter if present at the start of the text.
/// Frontmatter starts with `---` on its own line at the very beginning,
/// and ends with `---` or `...` on its own line.
/// The content between markers must contain at least one `:` to be considered
/// valid YAML (this prevents false positives with setext headings like "---\nFoo\n---").
/// Returns the text after the closing delimiter (or the original text if no frontmatter).
pub fn skipFrontmatter(text: []const u8) []const u8 {
    // Must start with exactly "---" followed by newline (or end of string for empty frontmatter)
    if (text.len < 3) return text;
    if (text[0] != '-' or text[1] != '-' or text[2] != '-') return text;

    // Check that the opening delimiter is followed by a newline or end of string
    var pos: usize = 3;
    // Skip optional spaces/tabs after ---
    while (pos < text.len and (text[pos] == ' ' or text[pos] == '\t')) {
        pos += 1;
    }
    // Must be followed by newline or end of text
    if (pos < text.len and text[pos] != '\n' and text[pos] != '\r') {
        return text; // Not a valid frontmatter opener (e.g., "---text")
    }
    // Skip the newline
    if (pos < text.len and text[pos] == '\r') pos += 1;
    if (pos < text.len and text[pos] == '\n') pos += 1;

    const content_start = pos;

    // Now search for the closing delimiter: `---` or `...` at the start of a line
    while (pos < text.len) {
        // Check for closing delimiter at start of this line
        if (pos + 3 <= text.len) {
            const is_dash_closer = text[pos] == '-' and text[pos + 1] == '-' and text[pos + 2] == '-';
            const is_dot_closer = text[pos] == '.' and text[pos + 1] == '.' and text[pos + 2] == '.';
            if (is_dash_closer or is_dot_closer) {
                var end_pos = pos + 3;
                // Skip optional spaces/tabs after closer
                while (end_pos < text.len and (text[end_pos] == ' ' or text[end_pos] == '\t')) {
                    end_pos += 1;
                }
                // Closer must be followed by newline or end of text
                if (end_pos >= text.len or text[end_pos] == '\n' or text[end_pos] == '\r') {
                    // Validate that the content looks like YAML (contains at least one ':')
                    // This prevents false positives with setext headings like "---\nFoo\n---"
                    const content = text[content_start..pos];
                    var has_colon = false;
                    for (content) |c| {
                        if (c == ':') {
                            has_colon = true;
                            break;
                        }
                    }
                    if (!has_colon) {
                        return text; // Not valid YAML frontmatter
                    }

                    // Skip the newline after the closer
                    if (end_pos < text.len and text[end_pos] == '\r') end_pos += 1;
                    if (end_pos < text.len and text[end_pos] == '\n') end_pos += 1;
                    return text[end_pos..];
                }
            }
        }

        // Move to the next line
        while (pos < text.len and text[pos] != '\n') {
            pos += 1;
        }
        if (pos < text.len) pos += 1; // Skip the newline
    }

    // No closing delimiter found - treat as no frontmatter (return original text)
    return text;
}

/// Case-insensitive ASCII comparison.
pub fn asciiCaseEql(a: []const u8, b: []const u8) bool {
    return bun.strings.eqlCaseInsensitiveASCIIICheckLength(a, b);
}

/// Find an HTML entity starting at `start` (which must point to '&').
/// Returns the end position (one past the ';') or null if no valid entity found.
pub fn findEntity(content: []const u8, start: usize) ?usize {
    if (start + 2 >= content.len) return null;

    // Numeric entity
    if (content[start + 1] == '#') {
        var pos = start + 2;
        if (pos < content.len and (content[pos] == 'x' or content[pos] == 'X')) {
            // Hex
            pos += 1;
            const digit_start = pos;
            while (pos < content.len and isHexDigit(content[pos]) and pos - digit_start < 6)
                pos += 1;
            if (pos > digit_start and pos < content.len and content[pos] == ';') {
                return pos + 1;
            }
        } else {
            // Decimal
            const digit_start = pos;
            while (pos < content.len and isDigit(content[pos]) and pos - digit_start < 7)
                pos += 1;
            if (pos > digit_start and pos < content.len and content[pos] == ';') {
                return pos + 1;
            }
        }
        return null;
    }

    // Named entity
    var pos = start + 1;
    if (pos < content.len and isAlpha(content[pos])) {
        pos += 1;
        while (pos < content.len and isAlphaNum(content[pos]) and pos - start < 48)
            pos += 1;
        if (pos < content.len and content[pos] == ';') {
            if (entity_mod.lookup(content[start .. pos + 1]) != null) {
                return pos + 1;
            }
        }
    }

    return null;
}

// zig fmt: off
const unicode_punctuation_ranges = &[_][2]u21{
    .{ 0x00A1, 0x00A9 }, .{ 0x00AB, 0x00AC }, .{ 0x00AE, 0x00B1 }, .{ 0x00B4, 0x00B4 },
    .{ 0x00B6, 0x00B8 }, .{ 0x00BB, 0x00BB }, .{ 0x00BF, 0x00BF }, .{ 0x00D7, 0x00D7 },
    .{ 0x00F7, 0x00F7 }, .{ 0x02C2, 0x02C5 }, .{ 0x02D2, 0x02DF }, .{ 0x02E5, 0x02EB },
    .{ 0x02ED, 0x02ED }, .{ 0x02EF, 0x02FF }, .{ 0x0375, 0x0375 }, .{ 0x037E, 0x037E },
    .{ 0x0384, 0x0385 }, .{ 0x0387, 0x0387 }, .{ 0x03F6, 0x03F6 }, .{ 0x0482, 0x0482 },
    .{ 0x055A, 0x055F }, .{ 0x0589, 0x058A }, .{ 0x058D, 0x058F }, .{ 0x05BE, 0x05BE },
    .{ 0x05C0, 0x05C0 }, .{ 0x05C3, 0x05C3 }, .{ 0x05C6, 0x05C6 }, .{ 0x05F3, 0x05F4 },
    .{ 0x0606, 0x060F }, .{ 0x061B, 0x061B }, .{ 0x061D, 0x061F }, .{ 0x066A, 0x066D },
    .{ 0x06D4, 0x06D4 }, .{ 0x06DE, 0x06DE }, .{ 0x06E9, 0x06E9 }, .{ 0x06FD, 0x06FE },
    .{ 0x0700, 0x070D }, .{ 0x07F6, 0x07F9 }, .{ 0x07FE, 0x07FF }, .{ 0x0830, 0x083E },
    .{ 0x085E, 0x085E }, .{ 0x0888, 0x0888 }, .{ 0x0964, 0x0965 }, .{ 0x0970, 0x0970 },
    .{ 0x09F2, 0x09F3 }, .{ 0x09FA, 0x09FB }, .{ 0x09FD, 0x09FD }, .{ 0x0A76, 0x0A76 },
    .{ 0x0AF0, 0x0AF1 }, .{ 0x0B70, 0x0B70 }, .{ 0x0BF3, 0x0BFA }, .{ 0x0C77, 0x0C77 },
    .{ 0x0C7F, 0x0C7F }, .{ 0x0C84, 0x0C84 }, .{ 0x0D4F, 0x0D4F }, .{ 0x0D79, 0x0D79 },
    .{ 0x0DF4, 0x0DF4 }, .{ 0x0E3F, 0x0E3F }, .{ 0x0E4F, 0x0E4F }, .{ 0x0E5A, 0x0E5B },
    .{ 0x0F01, 0x0F17 }, .{ 0x0F1A, 0x0F1F }, .{ 0x0F34, 0x0F34 }, .{ 0x0F36, 0x0F36 },
    .{ 0x0F38, 0x0F38 }, .{ 0x0F3A, 0x0F3D }, .{ 0x0F85, 0x0F85 }, .{ 0x0FBE, 0x0FC5 },
    .{ 0x0FC7, 0x0FCC }, .{ 0x0FCE, 0x0FDA }, .{ 0x104A, 0x104F }, .{ 0x109E, 0x109F },
    .{ 0x10FB, 0x10FB }, .{ 0x1360, 0x1368 }, .{ 0x1390, 0x1399 }, .{ 0x1400, 0x1400 },
    .{ 0x166D, 0x166E }, .{ 0x169B, 0x169C }, .{ 0x16EB, 0x16ED }, .{ 0x1735, 0x1736 },
    .{ 0x17D4, 0x17D6 }, .{ 0x17D8, 0x17DB }, .{ 0x1800, 0x180A }, .{ 0x1940, 0x1940 },
    .{ 0x1944, 0x1945 }, .{ 0x19DE, 0x19FF }, .{ 0x1A1E, 0x1A1F }, .{ 0x1AA0, 0x1AA6 },
    .{ 0x1AA8, 0x1AAD }, .{ 0x1B5A, 0x1B6A }, .{ 0x1B74, 0x1B7E }, .{ 0x1BFC, 0x1BFF },
    .{ 0x1C3B, 0x1C3F }, .{ 0x1C7E, 0x1C7F }, .{ 0x1CC0, 0x1CC7 }, .{ 0x1CD3, 0x1CD3 },
    .{ 0x1FBD, 0x1FBD }, .{ 0x1FBF, 0x1FC1 }, .{ 0x1FCD, 0x1FCF }, .{ 0x1FDD, 0x1FDF },
    .{ 0x1FED, 0x1FEF }, .{ 0x1FFD, 0x1FFE }, .{ 0x2010, 0x2027 }, .{ 0x2030, 0x205E },
    .{ 0x207A, 0x207E }, .{ 0x208A, 0x208E }, .{ 0x20A0, 0x20C0 }, .{ 0x2100, 0x2101 },
    .{ 0x2103, 0x2106 }, .{ 0x2108, 0x2109 }, .{ 0x2114, 0x2114 }, .{ 0x2116, 0x2118 },
    .{ 0x211E, 0x2123 }, .{ 0x2125, 0x2125 }, .{ 0x2127, 0x2127 }, .{ 0x2129, 0x2129 },
    .{ 0x212E, 0x212E }, .{ 0x213A, 0x213B }, .{ 0x2140, 0x2144 }, .{ 0x214A, 0x214D },
    .{ 0x214F, 0x214F }, .{ 0x218A, 0x218B }, .{ 0x2190, 0x2426 }, .{ 0x2440, 0x244A },
    .{ 0x249C, 0x24E9 }, .{ 0x2500, 0x2775 }, .{ 0x2794, 0x2B73 }, .{ 0x2B76, 0x2B95 },
    .{ 0x2B97, 0x2BFF }, .{ 0x2CE5, 0x2CEA }, .{ 0x2CF9, 0x2CFC }, .{ 0x2CFE, 0x2CFF },
    .{ 0x2D70, 0x2D70 }, .{ 0x2E00, 0x2E2E }, .{ 0x2E30, 0x2E5D }, .{ 0x2E80, 0x2E99 },
    .{ 0x2E9B, 0x2EF3 }, .{ 0x2F00, 0x2FD5 }, .{ 0x2FF0, 0x2FFF }, .{ 0x3001, 0x3004 },
    .{ 0x3008, 0x3020 }, .{ 0x3030, 0x3030 }, .{ 0x3036, 0x3037 }, .{ 0x303D, 0x303F },
    .{ 0x309B, 0x309C }, .{ 0x30A0, 0x30A0 }, .{ 0x30FB, 0x30FB }, .{ 0x3190, 0x3191 },
    .{ 0x3196, 0x319F }, .{ 0x31C0, 0x31E3 }, .{ 0x31EF, 0x31EF }, .{ 0x3200, 0x321E },
    .{ 0x322A, 0x3247 }, .{ 0x3250, 0x3250 }, .{ 0x3260, 0x327F }, .{ 0x328A, 0x32B0 },
    .{ 0x32C0, 0x33FF }, .{ 0x4DC0, 0x4DFF }, .{ 0xA490, 0xA4C6 }, .{ 0xA4FE, 0xA4FF },
    .{ 0xA60D, 0xA60F }, .{ 0xA673, 0xA673 }, .{ 0xA67E, 0xA67E }, .{ 0xA6F2, 0xA6F7 },
    .{ 0xA700, 0xA716 }, .{ 0xA720, 0xA721 }, .{ 0xA789, 0xA78A }, .{ 0xA828, 0xA82B },
    .{ 0xA836, 0xA839 }, .{ 0xA874, 0xA877 }, .{ 0xA8CE, 0xA8CF }, .{ 0xA8F8, 0xA8FA },
    .{ 0xA8FC, 0xA8FC }, .{ 0xA92E, 0xA92F }, .{ 0xA95F, 0xA95F }, .{ 0xA9C1, 0xA9CD },
    .{ 0xA9DE, 0xA9DF }, .{ 0xAA5C, 0xAA5F }, .{ 0xAA77, 0xAA79 }, .{ 0xAADE, 0xAADF },
    .{ 0xAAF0, 0xAAF1 }, .{ 0xAB5B, 0xAB5B }, .{ 0xAB6A, 0xAB6B }, .{ 0xABEB, 0xABEB },
    .{ 0xFB29, 0xFB29 }, .{ 0xFBB2, 0xFBC2 }, .{ 0xFD3E, 0xFD4F }, .{ 0xFDCF, 0xFDCF },
    .{ 0xFDFC, 0xFDFF }, .{ 0xFE10, 0xFE19 }, .{ 0xFE30, 0xFE52 }, .{ 0xFE54, 0xFE66 },
    .{ 0xFE68, 0xFE6B }, .{ 0xFF01, 0xFF0F }, .{ 0xFF1A, 0xFF20 }, .{ 0xFF3B, 0xFF40 },
    .{ 0xFF5B, 0xFF65 }, .{ 0xFFE0, 0xFFE6 }, .{ 0xFFE8, 0xFFEE }, .{ 0xFFFC, 0xFFFD },
    .{ 0x10100, 0x10102 }, .{ 0x10137, 0x1013F }, .{ 0x10179, 0x10189 }, .{ 0x1018C, 0x1018E },
    .{ 0x10190, 0x1019C }, .{ 0x101A0, 0x101A0 }, .{ 0x101D0, 0x101FC }, .{ 0x1039F, 0x1039F },
    .{ 0x103D0, 0x103D0 }, .{ 0x1056F, 0x1056F }, .{ 0x10857, 0x10857 }, .{ 0x10877, 0x10878 },
    .{ 0x1091F, 0x1091F }, .{ 0x1093F, 0x1093F }, .{ 0x10A50, 0x10A58 }, .{ 0x10A7F, 0x10A7F },
    .{ 0x10AC8, 0x10AC8 }, .{ 0x10AF0, 0x10AF6 }, .{ 0x10B39, 0x10B3F }, .{ 0x10B99, 0x10B9C },
    .{ 0x10EAD, 0x10EAD }, .{ 0x10F55, 0x10F59 }, .{ 0x10F86, 0x10F89 }, .{ 0x11047, 0x1104D },
    .{ 0x110BB, 0x110BC }, .{ 0x110BE, 0x110C1 }, .{ 0x11140, 0x11143 }, .{ 0x11174, 0x11175 },
    .{ 0x111C5, 0x111C8 }, .{ 0x111CD, 0x111CD }, .{ 0x111DB, 0x111DB }, .{ 0x111DD, 0x111DF },
    .{ 0x11238, 0x1123D }, .{ 0x112A9, 0x112A9 }, .{ 0x1144B, 0x1144F }, .{ 0x1145A, 0x1145B },
    .{ 0x1145D, 0x1145D }, .{ 0x114C6, 0x114C6 }, .{ 0x115C1, 0x115D7 }, .{ 0x11641, 0x11643 },
    .{ 0x11660, 0x1166C }, .{ 0x116B9, 0x116B9 }, .{ 0x1173C, 0x1173F }, .{ 0x1183B, 0x1183B },
    .{ 0x11944, 0x11946 }, .{ 0x119E2, 0x119E2 }, .{ 0x11A3F, 0x11A46 }, .{ 0x11A9A, 0x11A9C },
    .{ 0x11A9E, 0x11AA2 }, .{ 0x11B00, 0x11B09 }, .{ 0x11C41, 0x11C45 }, .{ 0x11C70, 0x11C71 },
    .{ 0x11EF7, 0x11EF8 }, .{ 0x11F43, 0x11F4F }, .{ 0x11FD5, 0x11FF1 }, .{ 0x11FFF, 0x11FFF },
    .{ 0x12470, 0x12474 }, .{ 0x12FF1, 0x12FF2 }, .{ 0x16A6E, 0x16A6F }, .{ 0x16AF5, 0x16AF5 },
    .{ 0x16B37, 0x16B3F }, .{ 0x16B44, 0x16B45 }, .{ 0x16E97, 0x16E9A }, .{ 0x16FE2, 0x16FE2 },
    .{ 0x1BC9C, 0x1BC9C }, .{ 0x1BC9F, 0x1BC9F }, .{ 0x1CF50, 0x1CFC3 }, .{ 0x1D000, 0x1D0F5 },
    .{ 0x1D100, 0x1D126 }, .{ 0x1D129, 0x1D164 }, .{ 0x1D16A, 0x1D16C }, .{ 0x1D183, 0x1D184 },
    .{ 0x1D18C, 0x1D1A9 }, .{ 0x1D1AE, 0x1D1EA }, .{ 0x1D200, 0x1D241 }, .{ 0x1D245, 0x1D245 },
    .{ 0x1D300, 0x1D356 }, .{ 0x1D6C1, 0x1D6C1 }, .{ 0x1D6DB, 0x1D6DB }, .{ 0x1D6FB, 0x1D6FB },
    .{ 0x1D715, 0x1D715 }, .{ 0x1D735, 0x1D735 }, .{ 0x1D74F, 0x1D74F }, .{ 0x1D76F, 0x1D76F },
    .{ 0x1D789, 0x1D789 }, .{ 0x1D7A9, 0x1D7A9 }, .{ 0x1D7C3, 0x1D7C3 }, .{ 0x1D800, 0x1D9FF },
    .{ 0x1DA37, 0x1DA3A }, .{ 0x1DA6D, 0x1DA74 }, .{ 0x1DA76, 0x1DA83 }, .{ 0x1DA85, 0x1DA8B },
    .{ 0x1E14F, 0x1E14F }, .{ 0x1E2FF, 0x1E2FF }, .{ 0x1E95E, 0x1E95F }, .{ 0x1ECAC, 0x1ECAC },
    .{ 0x1ECB0, 0x1ECB0 }, .{ 0x1ED2E, 0x1ED2E }, .{ 0x1EEF0, 0x1EEF1 },
    .{ 0x1F000, 0x1F02B }, .{ 0x1F030, 0x1F093 }, .{ 0x1F0A0, 0x1F0AE }, .{ 0x1F0B1, 0x1F0BF },
    .{ 0x1F0C1, 0x1F0CF }, .{ 0x1F0D1, 0x1F0F5 }, .{ 0x1F10D, 0x1F1AD }, .{ 0x1F1E6, 0x1F202 },
    .{ 0x1F210, 0x1F23B }, .{ 0x1F240, 0x1F248 }, .{ 0x1F250, 0x1F251 }, .{ 0x1F260, 0x1F265 },
    .{ 0x1F300, 0x1F6D7 }, .{ 0x1F6DC, 0x1F6EC }, .{ 0x1F6F0, 0x1F6FC }, .{ 0x1F700, 0x1F776 },
    .{ 0x1F77B, 0x1F7D9 }, .{ 0x1F7E0, 0x1F7EB }, .{ 0x1F7F0, 0x1F7F0 }, .{ 0x1F800, 0x1F80B },
    .{ 0x1F810, 0x1F847 }, .{ 0x1F850, 0x1F859 }, .{ 0x1F860, 0x1F887 }, .{ 0x1F890, 0x1F8AD },
    .{ 0x1F8B0, 0x1F8B1 }, .{ 0x1F900, 0x1FA53 }, .{ 0x1FA60, 0x1FA6D }, .{ 0x1FA70, 0x1FA7C },
    .{ 0x1FA80, 0x1FA88 }, .{ 0x1FA90, 0x1FABD }, .{ 0x1FABF, 0x1FAC5 }, .{ 0x1FACE, 0x1FADB },
    .{ 0x1FAE0, 0x1FAE8 }, .{ 0x1FAF0, 0x1FAF8 }, .{ 0x1FB00, 0x1FB92 }, .{ 0x1FB94, 0x1FBCA },
};
// zig fmt: on

/// Parse a numeric character reference (&#DDD; or &#xHHH;) and return the codepoint.
pub fn parseEntityCodepoint(entity_text: []const u8) ?u21 {
    if (entity_text.len < 4 or entity_text[0] != '&' or entity_text[1] != '#') return null;
    var cp: u32 = 0;
    if (entity_text[2] == 'x' or entity_text[2] == 'X') {
        for (entity_text[3..]) |ec| {
            if (ec == ';') break;
            cp = cp *% 16 +% switch (ec) {
                '0'...'9' => ec - '0',
                'a'...'f' => ec - 'a' + 10,
                'A'...'F' => ec - 'A' + 10,
                else => 0,
            };
        }
    } else {
        for (entity_text[2..]) |ec| {
            if (ec == ';') break;
            cp = cp *% 10 +% (ec - '0');
        }
    }
    if (cp == 0 or cp > 0x10FFFF or (cp >= 0xD800 and cp <= 0xDFFF)) cp = 0xFFFD;
    return @intCast(cp);
}

/// Decode an HTML entity to raw UTF-8 bytes.
/// Returns decoded bytes as a slice of `out`, or null for unknown entities.
pub fn decodeEntityToUtf8(entity_text: []const u8, out: *[8]u8) ?[]const u8 {
    if (parseEntityCodepoint(entity_text)) |cp| {
        const len = encodeUtf8(cp, out[0..4]);
        return out[0..len];
    }
    if (entity_mod.lookup(entity_text)) |codepoints| {
        const len1 = encodeUtf8(codepoints[0], out[0..4]);
        if (codepoints[1] != 0) {
            var tmp: [4]u8 = undefined;
            const len2 = encodeUtf8(codepoints[1], &tmp);
            @memcpy(out[len1..][0..len2], tmp[0..len2]);
            return out[0 .. len1 + len2];
        }
        return out[0..len1];
    }
    return null;
}

/// Generate a GitHub-compatible slug from text content.
/// Modifies text_buf in-place. Uses slug_counts for -N deduplication.
pub fn generateSlug(
    text_buf: *std.ArrayListUnmanaged(u8),
    slug_counts: *bun.StringHashMapUnmanaged(u32),
    allocator: Allocator,
) []const u8 {
    const text_items = text_buf.items;
    var out_len: usize = 0;
    var prev_hyphen: bool = true; // true to trim leading hyphens

    for (text_items) |c| {
        if (c >= 'A' and c <= 'Z') {
            text_buf.items[out_len] = c + 32;
            out_len += 1;
            prev_hyphen = false;
        } else if ((c >= 'a' and c <= 'z') or (c >= '0' and c <= '9')) {
            text_buf.items[out_len] = c;
            out_len += 1;
            prev_hyphen = false;
        } else if (c == '-' or c == ' ') {
            if (!prev_hyphen) {
                text_buf.items[out_len] = '-';
                out_len += 1;
                prev_hyphen = true;
            }
        }
        // else: skip non-alphanumeric characters
    }

    // Trim trailing hyphens
    while (out_len > 0 and text_buf.items[out_len - 1] == '-') {
        out_len -= 1;
    }

    const base_slug = text_buf.items[0..out_len];

    // Deduplicate via slug_counts
    const gop = slug_counts.getOrPut(allocator, base_slug) catch return base_slug;

    if (!gop.found_existing) {
        // First occurrence — store a duped key so the map owns it
        gop.key_ptr.* = allocator.dupe(u8, base_slug) catch {
            // Dupe failed: remove the entry so deinit won't free a pointer into text_buf
            slug_counts.removeByPtr(gop.key_ptr);
            return base_slug;
        };
        gop.value_ptr.* = 0;
        return base_slug;
    }

    // Already seen — append -N suffix
    const count = gop.value_ptr.* + 1;
    gop.value_ptr.* = count;
    text_buf.shrinkRetainingCapacity(out_len);
    text_buf.append(allocator, '-') catch return base_slug;

    // Inline decimal formatting (count is always >= 1)
    var dec_buf: [10]u8 = undefined;
    var v = count;
    var i: usize = dec_buf.len;
    while (v > 0) {
        i -= 1;
        dec_buf[i] = @intCast('0' + v % 10);
        v /= 10;
    }
    text_buf.appendSlice(allocator, dec_buf[i..]) catch return base_slug;
    return text_buf.items;
}

/// Shared heading-ID state used by all renderers (HTML, React AST, JS callbacks).
/// Tracks whether we're inside a heading, accumulates text for slug generation,
/// and deduplicates slugs via a count map.
pub const HeadingIdTracker = struct {
    enabled: bool,
    in_heading: bool = false,
    text_buf: std.ArrayListUnmanaged(u8) = .{},
    slug_counts: bun.StringHashMapUnmanaged(u32) = .{},

    pub fn init(enabled: bool) HeadingIdTracker {
        return .{ .enabled = enabled };
    }

    pub fn deinit(self: *HeadingIdTracker, allocator: Allocator) void {
        self.text_buf.deinit(allocator);
        var it = self.slug_counts.iterator();
        while (it.next()) |entry| {
            allocator.free(@constCast(entry.key_ptr.*));
        }
        self.slug_counts.deinit(allocator);
    }

    /// Call on entering a heading block.
    pub fn enterHeading(self: *HeadingIdTracker) void {
        if (self.enabled) self.in_heading = true;
    }

    /// Call from text callback to accumulate text for slug.
    /// No-op if not inside a heading or disabled.
    pub fn trackText(self: *HeadingIdTracker, text_type: TextType, content: []const u8, allocator: Allocator) void {
        if (!self.in_heading) return;
        switch (text_type) {
            .null_char => self.text_buf.appendSlice(allocator, "\xEF\xBF\xBD") catch {},
            .br, .softbr => self.text_buf.appendSlice(allocator, " ") catch {},
            .html => {}, // skip HTML tags in slug
            .entity => {
                var buf: [8]u8 = undefined;
                const decoded = decodeEntityToUtf8(content, &buf) orelse content;
                self.text_buf.appendSlice(allocator, decoded) catch {};
            },
            else => self.text_buf.appendSlice(allocator, content) catch {},
        }
    }

    /// Call on leaving a heading block. Returns slug (valid until clearAfterHeading).
    pub fn leaveHeading(self: *HeadingIdTracker, allocator: Allocator) ?[]const u8 {
        if (!self.enabled) return null;
        self.in_heading = false;
        return generateSlug(&self.text_buf, &self.slug_counts, allocator);
    }

    /// Call after using the slug to reset text buffer.
    pub fn clearAfterHeading(self: *HeadingIdTracker) void {
        self.text_buf.clearRetainingCapacity();
    }
};

const bun = @import("bun");
const entity_mod = @import("./entity.zig");
const std = @import("std");
const Allocator = std.mem.Allocator;

const types = @import("./types.zig");
const OFF = types.OFF;
const TextType = types.TextType;
