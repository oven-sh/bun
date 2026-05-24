// Implementation of `Bun.stringWidth` — terminal column width of a string,
// aware of ANSI escape sequences, grapheme clusters (including ZWJ emoji,
// regional indicator flags, keycaps and variation selectors) and Unicode East
// Asian Width.
//
// The ASCII fast paths use explicit SIMD kernels from highway_strings.cpp
// (highway_visible_latin1_width, highway_count_printable_ascii16,
// highway_first_non_ascii*) so throughput does not depend on the compiler's
// autovectorizer. Escape-sequence scanning reuses the WTF::SIMD helpers in
// ANSIHelpers.h shared with stripANSI/wrapAnsi/sliceAnsi.
//
// Rust/Zig callers (console.table column sizing, the markdown ANSI renderer)
// and sliceAnsi.cpp/wrapAnsi.cpp consume the `Bun__*` C exports at the bottom
// of this file.

#include "root.h"
#include "stringWidth.h"
#include "ANSIHelpers.h"
#include "stringWidthTables.h"

#include <algorithm>
#include <array>
#include <optional>
#include <span>
#include <wtf/text/WTFString.h>
#include <unicode/uchar.h>

// SIMD kernels implemented in highway_strings.cpp.
extern "C" size_t highway_visible_latin1_width(const uint8_t* input, size_t len);
extern "C" size_t highway_count_printable_ascii16(const uint16_t* input, size_t len);
extern "C" size_t highway_first_non_ascii16(const uint16_t* input, size_t len);
extern "C" size_t highway_first_non_ascii8(const uint8_t* input, size_t len);
extern "C" size_t highway_index_of_char(const uint8_t* haystack, size_t haystack_len, uint8_t needle);

namespace Bun {
namespace StringWidth {

// ============================================================================
// Codepoint classification (zero-width + East Asian Width)
// ============================================================================

static bool isInSortedRanges(char32_t cp, const StringWidthTables::CodepointRange* ranges, size_t count)
{
    // Binary search: find the last range whose `lo` is <= cp, then check `hi`.
    size_t lo = 0;
    size_t hi = count;
    while (lo < hi) {
        const size_t mid = lo + (hi - lo) / 2;
        if (ranges[mid].lo <= cp)
            lo = mid + 1;
        else
            hi = mid;
    }
    if (lo == 0)
        return false;
    return cp <= ranges[lo - 1].hi;
}

// Codepoints that occupy no terminal columns: C0/C1 controls, soft hyphen,
// combining marks, zero-width joiners/spaces, variation selectors, surrogates,
// format characters, etc.
static bool isZeroWidthCodepoint(char32_t cp)
{
    if (cp <= 0x1f)
        return true;

    if (cp >= 0x7f && cp <= 0x9f) {
        // DEL + C1 control characters
        return true;
    }

    // Soft hyphen (U+00AD) - invisible/zero-width
    if (cp == 0xad)
        return true;

    if (cp >= 0x300 && cp <= 0x36f) {
        // Combining Diacritical Marks
        return true;
    }

    if (cp >= 0x200b && cp <= 0x200f) {
        // Modifying Invisible Characters (ZWS, ZWNJ, ZWJ, LRM, RLM)
        return true;
    }

    if (cp >= 0x2060 && cp <= 0x2064) {
        // Word joiner (U+2060), invisible operators
        return true;
    }

    if (cp >= 0x20d0 && cp <= 0x20ff) {
        // Combining Diacritical Marks for Symbols
        return true;
    }

    if (cp >= 0xfe00 && cp <= 0xfe0f) {
        // Variation Selectors
        return true;
    }
    if (cp >= 0xfe20 && cp <= 0xfe2f) {
        // Combining Half Marks
        return true;
    }

    if (cp == 0xfeff) {
        // Zero Width No-Break Space (BOM, ZWNBSP)
        return true;
    }

    if (cp >= 0xd800 && cp <= 0xdfff) {
        // Surrogates (including lone surrogates)
        return true;
    }

    // Arabic formatting characters
    if ((cp >= 0x600 && cp <= 0x605) || cp == 0x6dd || cp == 0x70f || cp == 0x8e2)
        return true;

    // Indic script combining marks (Devanagari through Malayalam)
    if (cp >= 0x900 && cp <= 0xd4f) {
        const char32_t offset = cp & 0x7f;
        // Signs at block start (except position 0x03 which is often a visible Visarga)
        if (offset <= 0x02)
            return true;
        // Vowel signs, virama (0x3a-0x4d), but exclude:
        // - 0x3D (Avagraha - visible letter in most blocks)
        if (offset >= 0x3a && offset <= 0x4d && offset != 0x3d)
            return true;
        // Position 0x4E-0x4F are visible symbols in some blocks (e.g., Malayalam Sign Para)
        // Stress signs (0x51-0x57)
        if (offset >= 0x51 && offset <= 0x57)
            return true;
        // Vowel signs (0x62-0x63)
        if (offset >= 0x62 && offset <= 0x63)
            return true;
    }

    // Thai combining marks
    // Note: U+0E32 (SARA AA) and U+0E33 (SARA AM) are Grapheme_Base (spacing vowels), not combining
    if (cp == 0xe31 || (cp >= 0xe34 && cp <= 0xe3a) || (cp >= 0xe47 && cp <= 0xe4e))
        return true;

    // Lao combining marks
    // Note: U+0EB2 and U+0EB3 are spacing vowels like Thai, not combining
    if (cp == 0xeb1 || (cp >= 0xeb4 && cp <= 0xebc) || (cp >= 0xec8 && cp <= 0xecd))
        return true;

    // Combining Diacritical Marks Extended
    if (cp >= 0x1ab0 && cp <= 0x1aff)
        return true;

    // Combining Diacritical Marks Supplement
    if (cp >= 0x1dc0 && cp <= 0x1dff)
        return true;

    // Tag characters
    if (cp >= 0xe0000 && cp <= 0xe007f)
        return true;

    if (cp >= 0xe0100 && cp <= 0xe01ef) {
        // Variation Selectors Supplement
        return true;
    }

    return false;
}

// East Asian Width `W` (wide) or `F` (fullwidth) — occupies two columns.
static bool isEastAsianWideCodepoint(char32_t cp)
{
    if (cp < 0x1100)
        return false;
    return isInSortedRanges(cp, StringWidthTables::kEastAsianWideRanges, std::size(StringWidthTables::kEastAsianWideRanges));
}

// East Asian Width `A` (ambiguous) — one column by default, two columns when
// `ambiguousIsNarrow: false`.
static bool isEastAsianAmbiguousCodepoint(char32_t cp)
{
    return isInSortedRanges(cp, StringWidthTables::kEastAsianAmbiguousRanges, std::size(StringWidthTables::kEastAsianAmbiguousRanges));
}

uint8_t visibleCodepointWidth(char32_t cp, bool ambiguousAsWide)
{
    if (isZeroWidthCodepoint(cp))
        return 0;
    if (isEastAsianWideCodepoint(cp))
        return 2;
    if (ambiguousAsWide && isEastAsianAmbiguousCodepoint(cp))
        return 2;
    return 1;
}

bool isEmojiPresentation(char32_t cp)
{
    // Fast path: nothing below U+203C can be an emoji base
    if (cp < 0x203C)
        return false;

    // Fast path: common non-emoji BMP ranges
    if (cp >= 0x2C00 && cp < 0x1F000)
        return false;

    // Exclude variation selectors and ZWJ which are handled separately
    if (cp == 0xFE0E || cp == 0xFE0F || cp == 0x200D)
        return false;

    return u_hasBinaryProperty(static_cast<UChar32>(cp), UCHAR_EMOJI);
}

// ============================================================================
// Grapheme break (UAX #29 incl. GB9c Indic Conjunct Break, uucode algorithm)
// ============================================================================

// Grapheme break property for codepoints, excluding control/CR/LF which the
// width loops handle before consulting the break algorithm. Ordinal values
// must match the stage3 data in stringWidthTables.h.
enum class GraphemeBreakClass : uint8_t {
    Other,
    Prepend,
    RegionalIndicator,
    SpacingMark,
    L,
    V,
    T,
    Lv,
    Lvt,
    Zwj,
    Zwnj,
    ExtendedPictographic,
    EmojiModifierBase,
    EmojiModifier,
    IndicConjunctBreakExtend,
    IndicConjunctBreakLinker,
    IndicConjunctBreakConsonant,
};
static constexpr size_t kGraphemeBreakClassCount = 17;
static_assert(static_cast<uint8_t>(GraphemeBreakClass::RegionalIndicator) == 2);
static_assert(static_cast<uint8_t>(GraphemeBreakClass::Zwj) == 9);
static_assert(static_cast<uint8_t>(GraphemeBreakClass::IndicConjunctBreakConsonant) == kGraphemeBreakClassCount - 1);

// State carried between sequential graphemeBreak() calls. Numeric values are
// part of the `Bun__graphemeBreak` C ABI (opaque uint8_t, zero-initialized).
enum class GraphemeBreakState : uint8_t {
    Default,
    RegionalIndicator,
    ExtendedPictographic,
    IndicConjunctBreakConsonant,
    IndicConjunctBreakLinker,
};
static constexpr size_t kGraphemeBreakStateCount = 5;

static GraphemeBreakClass graphemeBreakClass(char32_t cp)
{
    // 3-stage table lookup: stage1 maps the high bits to a stage2 block,
    // stage2 maps to a stage3 index, stage3 holds the class.
    ASSERT(cp <= 0x10FFFF);
    const size_t high = cp >> 8;
    const size_t low = cp & 0xFF;
    const size_t stage2Index = StringWidthTables::kGraphemeBreakStage1[high] + low;
    return static_cast<GraphemeBreakClass>(StringWidthTables::kGraphemeBreakStage3[StringWidthTables::kGraphemeBreakStage2[stage2Index]]);
}

static constexpr bool isIndicConjunctBreakExtend(GraphemeBreakClass gb)
{
    return gb == GraphemeBreakClass::IndicConjunctBreakExtend || gb == GraphemeBreakClass::Zwj;
}

static constexpr bool isExtend(GraphemeBreakClass gb)
{
    return gb == GraphemeBreakClass::Zwnj
        || gb == GraphemeBreakClass::IndicConjunctBreakExtend
        || gb == GraphemeBreakClass::IndicConjunctBreakLinker;
}

static constexpr bool isExtendedPictographic(GraphemeBreakClass gb)
{
    return gb == GraphemeBreakClass::ExtendedPictographic || gb == GraphemeBreakClass::EmojiModifierBase;
}

// Core grapheme break algorithm (ported from uucode's
// computeGraphemeBreakNoControl). Only evaluated at compile time to build the
// precomputed decision table below.
static constexpr bool computeGraphemeBreakNoControl(GraphemeBreakClass gb1, GraphemeBreakClass gb2, GraphemeBreakState& state)
{
    using G = GraphemeBreakClass;
    using S = GraphemeBreakState;

    // Set state back to default when gb1 or gb2 is not expected in sequence.
    switch (state) {
    case S::RegionalIndicator:
        if (gb1 != G::RegionalIndicator || gb2 != G::RegionalIndicator)
            state = S::Default;
        break;
    case S::ExtendedPictographic: {
        const auto expected = [](G gb) {
            return gb == G::IndicConjunctBreakExtend || gb == G::IndicConjunctBreakLinker
                || gb == G::Zwnj || gb == G::Zwj || gb == G::ExtendedPictographic
                || gb == G::EmojiModifierBase || gb == G::EmojiModifier;
        };
        if (!expected(gb1))
            state = S::Default;
        if (!expected(gb2))
            state = S::Default;
        break;
    }
    case S::IndicConjunctBreakConsonant:
    case S::IndicConjunctBreakLinker: {
        const auto expected = [](G gb) {
            return gb == G::IndicConjunctBreakConsonant || gb == G::IndicConjunctBreakLinker
                || gb == G::IndicConjunctBreakExtend || gb == G::Zwj;
        };
        if (!expected(gb1))
            state = S::Default;
        if (!expected(gb2))
            state = S::Default;
        break;
    }
    case S::Default:
        break;
    }

    // GB6: L x (L | V | LV | LVT)
    if (gb1 == G::L) {
        if (gb2 == G::L || gb2 == G::V || gb2 == G::Lv || gb2 == G::Lvt)
            return false;
    }

    // GB7: (LV | V) x (V | T)
    if (gb1 == G::Lv || gb1 == G::V) {
        if (gb2 == G::V || gb2 == G::T)
            return false;
    }

    // GB8: (LVT | T) x T
    if (gb1 == G::Lvt || gb1 == G::T) {
        if (gb2 == G::T)
            return false;
    }

    // Handle GB9 (Extend | ZWJ) later, since it can also match the start of
    // GB9c (Indic) and GB11 (Emoji ZWJ)

    // GB9a: SpacingMark
    if (gb2 == G::SpacingMark)
        return false;

    // GB9b: Prepend
    if (gb1 == G::Prepend)
        return false;

    // GB9c: Indic Conjunct Break
    if (gb1 == G::IndicConjunctBreakConsonant) {
        // start of sequence
        if (isIndicConjunctBreakExtend(gb2)) {
            state = S::IndicConjunctBreakConsonant;
            return false;
        }
        if (gb2 == G::IndicConjunctBreakLinker) {
            // jump straight to linker state
            state = S::IndicConjunctBreakLinker;
            return false;
        }
        // else, not an Indic sequence
    } else if (state == S::IndicConjunctBreakConsonant) {
        // consonant state
        if (gb2 == G::IndicConjunctBreakLinker) {
            // consonant -> linker transition
            state = S::IndicConjunctBreakLinker;
            return false;
        }
        if (isIndicConjunctBreakExtend(gb2)) {
            // continue [extend]* sequence
            return false;
        }
        // Not a valid Indic sequence
        state = S::Default;
    } else if (state == S::IndicConjunctBreakLinker) {
        // linker state
        if (gb2 == G::IndicConjunctBreakLinker || isIndicConjunctBreakExtend(gb2)) {
            // continue [extend linker]* sequence
            return false;
        }
        if (gb2 == G::IndicConjunctBreakConsonant) {
            // linker -> end of sequence
            state = S::Default;
            return false;
        }
        // Not a valid Indic sequence
        state = S::Default;
    }

    // GB11: Emoji ZWJ sequence and Emoji modifier sequence
    if (isExtendedPictographic(gb1)) {
        // start of sequence
        if (isExtend(gb2) || gb2 == G::Zwj) {
            state = S::ExtendedPictographic;
            return false;
        }

        // emoji_modifier_sequence: emoji_modifier_base emoji_modifier
        if (gb1 == G::EmojiModifierBase && gb2 == G::EmojiModifier) {
            state = S::ExtendedPictographic;
            return false;
        }

        // else, not an Emoji ZWJ sequence
    } else if (state == S::ExtendedPictographic) {
        // continue or end sequence
        if ((isExtend(gb1) || gb1 == G::EmojiModifier) && (isExtend(gb2) || gb2 == G::Zwj)) {
            // continue extend* ZWJ sequence
            return false;
        }
        if (gb1 == G::Zwj && isExtendedPictographic(gb2)) {
            // ZWJ -> end of sequence
            state = S::Default;
            return false;
        }
        // Not a valid Emoji ZWJ sequence
        state = S::Default;
    }

    // GB12 and GB13: Regional Indicator
    if (gb1 == G::RegionalIndicator && gb2 == G::RegionalIndicator) {
        if (state == S::Default) {
            state = S::RegionalIndicator;
            return false;
        }
        state = S::Default;
        return true;
    }

    // GB9: x (Extend | ZWJ)
    if (isExtend(gb2) || gb2 == G::Zwj)
        return false;

    // GB999: Otherwise, break everywhere
    return true;
}

// Precomputed decision table for every (state, class1, class2) permutation.
// Key layout: state (3 bits) | class1 << 3 (5 bits) | class2 << 8 (5 bits).
// Value layout: shouldBreak (bit 0) | nextState << 1.
static constexpr size_t graphemeBreakKey(GraphemeBreakClass gb1, GraphemeBreakClass gb2, GraphemeBreakState state)
{
    return static_cast<size_t>(state)
        | (static_cast<size_t>(gb1) << 3)
        | (static_cast<size_t>(gb2) << 8);
}

static constexpr auto kGraphemeBreakDecisions = []() constexpr {
    std::array<uint8_t, 1 << 13> result {};
    for (size_t stateInt = 0; stateInt < kGraphemeBreakStateCount; stateInt++) {
        for (size_t i1 = 0; i1 < kGraphemeBreakClassCount; i1++) {
            for (size_t i2 = 0; i2 < kGraphemeBreakClassCount; i2++) {
                auto state = static_cast<GraphemeBreakState>(stateInt);
                const auto gb1 = static_cast<GraphemeBreakClass>(i1);
                const auto gb2 = static_cast<GraphemeBreakClass>(i2);
                const size_t key = graphemeBreakKey(gb1, gb2, state);
                const bool shouldBreak = computeGraphemeBreakNoControl(gb1, gb2, state);
                result[key] = static_cast<uint8_t>(shouldBreak) | (static_cast<uint8_t>(state) << 1);
            }
        }
    }
    return result;
}();

// Returns true when there is a grapheme cluster break between cp1 and cp2.
// Must be called sequentially, carrying `state` between calls. Control
// characters, CR and LF are not handled here — callers treat them before
// consulting the break algorithm (they always terminate a cluster).
static bool graphemeBreak(char32_t cp1, char32_t cp2, GraphemeBreakState& state)
{
    const uint8_t value = kGraphemeBreakDecisions[graphemeBreakKey(graphemeBreakClass(cp1), graphemeBreakClass(cp2), state)];
    state = static_cast<GraphemeBreakState>(value >> 1);
    return value & 1;
}

bool graphemeBreak(char32_t cp1, char32_t cp2, uint8_t& state)
{
    auto breakState = static_cast<GraphemeBreakState>(state);
    const bool result = graphemeBreak(cp1, cp2, breakState);
    state = static_cast<uint8_t>(breakState);
    return result;
}

// ============================================================================
// Grapheme cluster width accumulator
// ============================================================================

// Accumulates the codepoints of one grapheme cluster and decides the cluster's
// terminal width: flags (regional indicator pairs), keycap sequences, emoji
// with skin tone / ZWJ, and variation selectors all override the plain sum of
// codepoint widths.
struct GraphemeState {
    char32_t firstCp = 0;
    uint16_t nonEmojiWidth = 0; // accumulated width, saturates at 1023
    uint8_t baseWidth = 0; // width of the first codepoint (0, 1 or 2)
    uint8_t count = 0; // number of codepoints in the cluster
    bool emojiBase = false;
    bool keycap = false;
    bool regionalIndicator = false;
    bool skinTone = false;
    bool zwj = false;
    bool vs15 = false;
    bool vs16 = false;

    static bool isRegionalIndicator(char32_t cp) { return cp >= 0x1F1E6 && cp <= 0x1F1FF; }
    static bool isSkinToneModifier(char32_t cp) { return cp >= 0x1F3FB && cp <= 0x1F3FF; }

    void reset(char32_t cp, bool ambiguousAsWide)
    {
        firstCp = cp;

        // Fast path for ASCII - no emoji complexity, simple width calculation
        if (cp < 0x80) {
            const uint8_t w = (cp >= 0x20 && cp < 0x7F) ? 1 : 0;
            *this = GraphemeState {};
            firstCp = cp;
            count = 1;
            baseWidth = w;
            nonEmojiWidth = w;
            return;
        }

        const uint8_t w = visibleCodepointWidth(cp, ambiguousAsWide);
        count = 1;
        baseWidth = w;
        nonEmojiWidth = w;
        emojiBase = isEmojiPresentation(cp);
        keycap = (cp == 0x20E3);
        regionalIndicator = isRegionalIndicator(cp);
        skinTone = isSkinToneModifier(cp);
        zwj = (cp == 0x200D);
        vs15 = false;
        vs16 = false;
    }

    void add(char32_t cp, bool ambiguousAsWide)
    {
        if (count < UINT8_MAX)
            count++;
        keycap = keycap || (cp == 0x20E3);
        regionalIndicator = regionalIndicator || isRegionalIndicator(cp);
        skinTone = skinTone || isSkinToneModifier(cp);
        zwj = zwj || (cp == 0x200D);
        vs15 = vs15 || (cp == 0xFE0E);
        vs16 = vs16 || (cp == 0xFE0F);

        if (!isZeroWidthCodepoint(cp)) {
            const uint32_t newWidth = static_cast<uint32_t>(nonEmojiWidth) + visibleCodepointWidth(cp, ambiguousAsWide);
            nonEmojiWidth = static_cast<uint16_t>(std::min<uint32_t>(newWidth, 1023));
        }
    }

    size_t width() const
    {
        if (count == 0)
            return 0;

        // Regional indicator pair (flag emoji) → width 2
        if (regionalIndicator && count >= 2)
            return 2;
        // Keycap sequence → width 2
        if (keycap)
            return 2;
        // Single regional indicator → width 1
        if (regionalIndicator)
            return 1;
        // Emoji with skin tone or ZWJ → width 2
        if (emojiBase && (skinTone || zwj))
            return 2;

        // Handle variation selectors
        if (vs15 || vs16) {
            if (baseWidth == 2)
                return 2;
            if (vs16) {
                // Digits, '#' and '*' with VS16 are keycap bases; plain ASCII
                // stays narrow even with emoji presentation requested.
                if ((firstCp >= 0x30 && firstCp <= 0x39) || firstCp == 0x23 || firstCp == 0x2A)
                    return 1;
                if (firstCp < 0x80)
                    return 1;
                return 2;
            }
            return 1;
        }

        return nonEmojiWidth;
    }
};

// ============================================================================
// Latin-1 width
// ============================================================================

// Zero-width Latin-1 bytes: C0 controls, DEL + C1 controls, soft hyphen.
static uint8_t visibleLatin1WidthScalar(uint8_t c)
{
    return ((c >= 0x7F && c <= 0x9F) || c < 0x20 || c == 0xAD) ? 0 : 1;
}

size_t visibleLatin1Width(std::span<const uint8_t> input)
{
    // For inputs smaller than one SIMD vector the dynamic-dispatch call costs
    // more than the count itself — ANSI-heavy strings hit this constantly with
    // the short visible runs between escape sequences.
    if (input.size() < 16) {
        size_t count = 0;
        for (const uint8_t c : input)
            count += visibleLatin1WidthScalar(c);
        return count;
    }
    return highway_visible_latin1_width(input.data(), input.size());
}

// Visible width treating ANSI escape sequences (ESC[...<final>, ESC]...BEL/ST)
// as zero-width. Ref: https://cs.stanford.edu/people/miles/iso8859.html
size_t visibleLatin1WidthExcludeANSI(std::span<const uint8_t> input)
{
    size_t length = 0;
    const uint8_t* ptr = input.data();
    size_t len = input.size();

    while (true) {
        // Consecutive escape sequences are common (e.g. `ESC[39m ESC[22m`);
        // peek before paying for a SIMD scan of the remainder.
        const size_t i = (len != 0 && ptr[0] == 0x1b) ? 0 : highway_index_of_char(ptr, len, 0x1b);
        if (i == len)
            break;
        length += visibleLatin1Width({ ptr, i });
        ptr += i;
        len -= i;

        // ptr[0] == ESC
        if (len < 2)
            return length;

        if (ptr[1] == '[') {
            // CSI sequence: ESC [ <params> <final byte>. The final byte is in
            // [0x40, 0x7E]; SIMD-scan for it (parameters can be 1-15+ bytes,
            // e.g. ESC [ 1;31;48;2;255;0;0 m).
            if (len < 3)
                return length;
            ptr += 2;
            len -= 2;
            const uint8_t* term = ANSI::scanForByteInRange<0x40, 0x7e>(ptr, ptr + len);
            if (!term)
                return length;
            const size_t consumed = static_cast<size_t>(term - ptr) + 1;
            ptr += consumed;
            len -= consumed;
        } else if (ptr[1] == ']') {
            // OSC sequence: ESC ] ... terminated by BEL (0x07), C1 ST (0x9C)
            // or 7-bit ST (ESC \). The payload is opaque (titles, hyperlinks,
            // filenames) — SIMD-scan for the terminators.
            ptr += 2;
            len -= 2;
            while (true) {
                const uint8_t* term = ANSI::scanForAnyByte<0x07, 0x9c, 0x1b>(ptr, ptr + len);
                if (!term) {
                    ptr += len;
                    len = 0;
                    break;
                }
                const size_t t = static_cast<size_t>(term - ptr);
                if (*term == 0x07 || *term == 0x9c) {
                    // Single-byte terminator (BEL or C1 ST).
                    ptr += t + 1;
                    len -= t + 1;
                    break;
                }
                // ESC at offset t — check if the next byte is '\' (ST = ESC \).
                if (t + 1 < len && ptr[t + 1] == '\\') {
                    ptr += t + 2;
                    len -= t + 2;
                    break;
                }
                // Stray ESC inside the OSC payload — skip it and keep scanning.
                ptr += t + 1;
                len -= t + 1;
            }
        } else {
            // ESC followed by anything else: only the ESC itself is dropped.
            ptr += 1;
            len -= 1;
        }
    }

    length += visibleLatin1Width({ ptr, len });
    return length;
}

// ============================================================================
// UTF-8 width
// ============================================================================

static uint8_t wtf8SequenceLength(uint8_t firstByte)
{
    if (firstByte <= 0x7F)
        return 1;
    if (firstByte >= 0xC0 && firstByte <= 0xDF)
        return 2;
    if (firstByte >= 0xE0 && firstByte <= 0xEF)
        return 3;
    if (firstByte >= 0xF0 && firstByte <= 0xF7)
        return 4;
    return 1;
}

// WTF-8 multibyte decode (same semantics as esbuild's decodeWTF8Rune): invalid
// sequences decode to U+FFFD.
static char32_t decodeWTF8RuneMultibyte(const std::array<uint8_t, 4>& p, uint8_t len)
{
    constexpr char32_t replacement = 0xFFFD;
    ASSERT(len > 1);

    const uint8_t s1 = p[1];
    if ((s1 & 0xC0) != 0x80)
        return replacement;

    if (len == 2) {
        const char32_t cp = (static_cast<char32_t>(p[0] & 0x1F) << 6) | (s1 & 0x3F);
        return cp < 0x80 ? replacement : cp;
    }

    const uint8_t s2 = p[2];
    if ((s2 & 0xC0) != 0x80)
        return replacement;

    if (len == 3) {
        const char32_t cp = (static_cast<char32_t>(p[0] & 0x0F) << 12) | (static_cast<char32_t>(s1 & 0x3F) << 6) | (s2 & 0x3F);
        return cp < 0x800 ? replacement : cp;
    }

    const uint8_t s3 = p[3];
    if ((s3 & 0xC0) != 0x80)
        return replacement;

    const char32_t cp = (static_cast<char32_t>(p[0] & 0x07) << 18) | (static_cast<char32_t>(s1 & 0x3F) << 12) | (static_cast<char32_t>(s2 & 0x3F) << 6) | (s3 & 0x3F);
    if (cp < 0x10000 || cp > 0x10FFFF)
        return replacement;
    return cp;
}

// UTF-8 width: ASCII runs go through `asciiWidth`, non-ASCII codepoints are
// decoded and summed individually (no grapheme clustering — keeps the
// historical behavior of the console.table / markdown renderer callers).
template<typename AsciiWidthFn>
static size_t visibleUTF8WidthImpl(std::span<const uint8_t> input, AsciiWidthFn asciiWidth)
{
    std::span<const uint8_t> bytes = input;
    size_t len = 0;

    while (true) {
        // Runs of non-ASCII codepoints are common (CJK text); peek before
        // paying for a SIMD scan that would return 0.
        const size_t i = (!bytes.empty() && bytes[0] > 0x7F) ? 0 : highway_first_non_ascii8(bytes.data(), bytes.size());
        if (i == bytes.size())
            break;
        len += asciiWidth(bytes.first(i));

        const auto thisChunk = bytes.subspan(i);
        const uint8_t byte = thisChunk[0];
        const uint8_t skip = wtf8SequenceLength(byte);

        std::array<uint8_t, 4> cpBytes { byte, 0, 0, 0 };
        const size_t available = std::min<size_t>(skip, thisChunk.size());
        for (size_t k = 1; k < available; k++)
            cpBytes[k] = thisChunk[k];

        const char32_t cp = (skip > 1) ? decodeWTF8RuneMultibyte(cpBytes, skip) : 0xFFFD;
        len += visibleCodepointWidth(cp, false);

        bytes = bytes.subspan(std::min<size_t>(i + skip, bytes.size()));
    }

    len += asciiWidth(bytes);
    return len;
}

size_t visibleUTF8WidthExcludeANSI(std::span<const uint8_t> input)
{
    return visibleUTF8WidthImpl(input, [](std::span<const uint8_t> ascii) {
        return visibleLatin1WidthExcludeANSI(ascii);
    });
}

// Walk `len` bytes of `input` starting at `start`, accumulating visible width
// into `w`. Returns the absolute byte index at which adding the next codepoint
// would exceed `maxWidth`, or nullopt if the whole run fits.
static std::optional<size_t> utf8WalkRun(std::span<const uint8_t> input, size_t start, size_t len, size_t maxWidth, size_t& w)
{
    std::span<const uint8_t> bytes = input.subspan(start, len);

    while (true) {
        const size_t i = highway_first_non_ascii8(bytes.data(), bytes.size());
        if (i == bytes.size())
            break;

        // ASCII run: each printable char is width 1.
        for (size_t k = 0; k < i; k++) {
            const size_t cw = visibleLatin1WidthScalar(bytes[k]);
            if (w + cw > maxWidth)
                return static_cast<size_t>(bytes.data() - input.data()) + k;
            w += cw;
        }

        const auto thisChunk = bytes.subspan(i);
        const uint8_t byte = thisChunk[0];
        const uint8_t skip = wtf8SequenceLength(byte);

        std::array<uint8_t, 4> cpBytes { byte, 0, 0, 0 };
        const size_t available = std::min<size_t>(skip, thisChunk.size());
        for (size_t k = 1; k < available; k++)
            cpBytes[k] = thisChunk[k];

        const char32_t cp = (skip > 1) ? decodeWTF8RuneMultibyte(cpBytes, skip) : 0xFFFD;
        const size_t cw = visibleCodepointWidth(cp, false);
        if (w + cw > maxWidth)
            return static_cast<size_t>(bytes.data() - input.data()) + i;
        w += cw;

        bytes = bytes.subspan(std::min<size_t>(i + skip, bytes.size()));
    }

    for (size_t k = 0; k < bytes.size(); k++) {
        const size_t cw = visibleLatin1WidthScalar(bytes[k]);
        if (w + cw > maxWidth)
            return static_cast<size_t>(bytes.data() - input.data()) + k;
        w += cw;
    }
    return std::nullopt;
}

size_t utf8IndexAtWidthExcludeANSI(std::span<const uint8_t> input, size_t maxWidth)
{
    std::span<const uint8_t> remaining = input;
    size_t w = 0;

    while (true) {
        const size_t esc = highway_index_of_char(remaining.data(), remaining.size(), 0x1b);
        if (esc == remaining.size())
            break;

        // Walk the visible run before ESC.
        const size_t runStart = static_cast<size_t>(remaining.data() - input.data());
        if (const auto stop = utf8WalkRun(input, runStart, esc, maxWidth, w))
            return *stop;
        remaining = remaining.subspan(esc);

        // Same CSI/OSC skip as visibleLatin1WidthExcludeANSI.
        if (remaining.size() < 2)
            return input.size();
        if (remaining[1] == '[') {
            if (remaining.size() < 3)
                return input.size();
            remaining = remaining.subspan(2);
            const uint8_t* term = ANSI::scanForByteInRange<0x40, 0x7e>(remaining.data(), remaining.data() + remaining.size());
            if (!term)
                return input.size();
            remaining = remaining.subspan(static_cast<size_t>(term - remaining.data()) + 1);
        } else if (remaining[1] == ']') {
            remaining = remaining.subspan(2);
            while (true) {
                const uint8_t* term = ANSI::scanForAnyByte<0x07, 0x9c, 0x1b>(remaining.data(), remaining.data() + remaining.size());
                if (!term) {
                    remaining = remaining.subspan(remaining.size());
                    break;
                }
                const size_t t = static_cast<size_t>(term - remaining.data());
                if (*term == 0x07 || *term == 0x9c) {
                    remaining = remaining.subspan(t + 1);
                    break;
                }
                if (t + 1 < remaining.size() && remaining[t + 1] == '\\') {
                    remaining = remaining.subspan(t + 2);
                    break;
                }
                remaining = remaining.subspan(t + 1);
            }
        } else {
            remaining = remaining.subspan(1);
        }
    }

    const size_t runStart = static_cast<size_t>(remaining.data() - input.data());
    if (const auto stop = utf8WalkRun(input, runStart, remaining.size(), maxWidth, w))
        return *stop;
    return input.size();
}

// ============================================================================
// UTF-16 width
// ============================================================================

// Count of UTF-16 code units in [0x20, 0x7E]. Short runs skip the SIMD
// kernel's dispatch overhead (mixed ASCII/unicode text has many tiny runs).
static size_t countPrintableAscii16(std::span<const char16_t> input)
{
    if (input.size() < 16) {
        size_t count = 0;
        for (const char16_t c : input)
            count += (c >= 0x20 && c < 0x7F) ? 1 : 0;
        return count;
    }
    return highway_count_printable_ascii16(reinterpret_cast<const uint16_t*>(input.data()), input.size());
}

struct UTF16Decoded {
    char32_t codePoint;
    uint8_t lengthInUnits;
    // Lone lead/trail surrogates and truncated pairs are skipped entirely
    // (zero width, no grapheme state update).
    bool skip;
};

static UTF16Decoded decodeUTF16Codepoint(std::span<const char16_t> input)
{
    const char16_t unit = input[0];
    if (U16_IS_LEAD(unit)) {
        if (input.size() == 1)
            return { 0xFFFD, 1, true };
        const char16_t next = input[1];
        if (!U16_IS_TRAIL(next))
            return { 0xFFFD, 1, true };
        return { static_cast<char32_t>(U16_GET_SUPPLEMENTARY(unit, next)), 2, false };
    }
    if (U16_IS_TRAIL(unit))
        return { 0xFFFD, 1, true };
    return { unit, 1, false };
}

// Grapheme-cluster-aware width of UTF-16 text. When `excludeAnsiColors` is
// set, CSI (ESC [ ... final) and OSC (ESC ] ... BEL/ST) sequences contribute
// nothing; otherwise escape bytes are counted like ordinary codepoints.
size_t visibleUTF16Width(std::span<const char16_t> input, bool excludeAnsiColors, bool ambiguousAsWide)
{
    size_t len = 0;
    // Last *visible* codepoint, used for grapheme break decisions. Escape
    // sequence bytes must not participate: a CSI final byte like 'm' would
    // otherwise wrongly join to a following combining mark.
    std::optional<char32_t> prevVisible;
    GraphemeBreakState breakState = GraphemeBreakState::Default;
    GraphemeState graphemeState;
    bool saw1b = false; // saw ESC, deciding what follows
    bool sawCsi = false; // inside CSI: ESC [
    bool sawOsc = false; // inside OSC: ESC ]

    while (true) {
        {
            // Length of the leading all-ASCII (<= 0x7F) run. Peek the first
            // unit before paying for a SIMD scan — runs of non-ASCII
            // codepoints (CJK, emoji) would scan zero-length prefixes.
            const size_t idx = (!input.empty() && input[0] > 0x7F)
                ? 0
                : highway_first_non_ascii16(reinterpret_cast<const uint16_t*>(input.data()), input.size());

            // Fast path: bulk ASCII processing when not inside an escape
            // sequence. ASCII chars are always their own graphemes, so they
            // can be counted directly with SIMD.
            if (idx > 0 && !saw1b && !sawCsi && !sawOsc) {
                // If stripping ANSI, stop at the first ESC; otherwise process
                // the entire run.
                size_t bulkEnd = idx;
                if (excludeAnsiColors) {
                    const char16_t* esc = ANSI::scanForAnyByte<0x1b>(input.data(), input.data() + idx);
                    bulkEnd = esc ? static_cast<size_t>(esc - input.data()) : idx;
                }

                if (bulkEnd > 0) {
                    // Flush any pending grapheme from previous non-ASCII text.
                    if (graphemeState.count > 0)
                        len += graphemeState.width();

                    // Count all but the last char in bulk using SIMD. The last
                    // char seeds the grapheme state in case a combining mark
                    // follows.
                    if (bulkEnd > 1)
                        len += countPrintableAscii16(input.first(bulkEnd - 1));

                    const char32_t lastCp = input[bulkEnd - 1];
                    graphemeState.reset(lastCp, ambiguousAsWide);
                    prevVisible = lastCp;
                    breakState = GraphemeBreakState::Default;

                    if (bulkEnd == idx) {
                        input = input.subspan(idx);
                        continue;
                    }

                    // Otherwise we hit ESC — start escape sequence handling.
                    saw1b = true;
                    input = input.subspan(bulkEnd + 1);
                    continue;
                }
            }

            size_t j = 0;
            while (j < idx) {
                // Bulk SIMD scans inside escape states — long CSI parameter
                // strings and OSC payloads (URLs, titles) don't need per-unit
                // processing.
                if (sawCsi) {
                    // CSI final byte is in [0x40, 0x7E].
                    const char16_t* term = ANSI::scanForByteInRange<0x40, 0x7e>(input.data() + j, input.data() + idx);
                    if (term) {
                        saw1b = false;
                        sawCsi = false;
                        j = static_cast<size_t>(term - input.data()) + 1;
                        continue;
                    }
                    // Terminator not in this ASCII run — stay in CSI state; the
                    // non-ASCII codepoint handler below keeps parsing.
                    break;
                }
                if (sawOsc) {
                    // OSC payload terminates at BEL (0x07) or ESC + '\' (ST).
                    const char16_t* term = ANSI::scanForAnyByte<0x07, 0x1b>(input.data() + j, input.data() + idx);
                    if (term) {
                        const size_t t = static_cast<size_t>(term - input.data());
                        if (*term == 0x07) {
                            saw1b = false;
                            sawOsc = false;
                            j = t + 1;
                            continue;
                        }
                        // ESC found — peek the next unit for '\' (ST).
                        if (t + 1 < idx && input[t + 1] == u'\\') {
                            saw1b = false;
                            sawOsc = false;
                            j = t + 2;
                            continue;
                        }
                        // Lone ESC inside OSC — skip it and keep scanning.
                        j = t + 1;
                        continue;
                    }
                    // Terminator not in this ASCII run — stay in OSC state.
                    break;
                }

                // Per-unit path for everything else.
                const char32_t cp = input[j];
                j += 1;

                if (saw1b) {
                    if (cp == '[') {
                        sawCsi = true;
                        continue;
                    }
                    if (cp == ']') {
                        sawOsc = true;
                        continue;
                    }
                    if (cp == 0x1b) {
                        // Another ESC — this one starts a new potential
                        // sequence (ESC itself is zero-width anyway).
                        continue;
                    }
                    // ESC followed by an ordinary char: the ESC is dropped,
                    // the char is counted directly.
                    len += visibleCodepointWidth(cp, ambiguousAsWide);
                    saw1b = false;
                    continue;
                }
                if (!excludeAnsiColors || cp != 0x1b) {
                    if (prevVisible) {
                        if (graphemeBreak(*prevVisible, cp, breakState)) {
                            len += graphemeState.width();
                            graphemeState.reset(cp, ambiguousAsWide);
                        } else {
                            graphemeState.add(cp, ambiguousAsWide);
                        }
                    } else {
                        graphemeState.reset(cp, ambiguousAsWide);
                    }
                    prevVisible = cp;
                    continue;
                }
                saw1b = true;
            }
            input = input.subspan(idx);
        }

        if (input.empty())
            break;

        // Decode one non-ASCII codepoint (input[0] > 0x7F).
        const UTF16Decoded decoded = decodeUTF16Codepoint(input);
        input = input.subspan(decoded.lengthInUnits);
        // Skip invalid sequences and lone surrogates (treat as zero-width).
        if (decoded.skip)
            continue;
        const char32_t cp = decoded.codePoint;

        // Handle non-ASCII characters inside escape sequences.
        if (sawOsc) {
            // In OSC, look for BEL (0x07) or C1 ST (0x9C); the 7-bit ST
            // (ESC \) only uses ASCII and is handled above. Non-ASCII chars
            // inside OSC do not contribute to width.
            if (cp == 0x07 || cp == 0x9c) {
                saw1b = false;
                sawOsc = false;
            }
            continue;
        }
        if (sawCsi) {
            // CSI sequences only contain ASCII parameters and final bytes.
            // A non-ASCII char ends the CSI sequence abnormally — don't count it.
            saw1b = false;
            sawCsi = false;
            continue;
        }
        if (saw1b) {
            // ESC followed by non-ASCII — not a valid sequence start; treat
            // the char normally below.
            saw1b = false;
        }

        if (prevVisible) {
            if (graphemeBreak(*prevVisible, cp, breakState)) {
                len += graphemeState.width();
                graphemeState.reset(cp, ambiguousAsWide);
            } else {
                graphemeState.add(cp, ambiguousAsWide);
            }
        } else {
            graphemeState.reset(cp, ambiguousAsWide);
        }
        prevVisible = cp;
    }

    // Add the width of the final grapheme.
    len += graphemeState.width();
    return len;
}

} // namespace StringWidth

// ============================================================================
// C exports (consumed by sliceAnsi.cpp / wrapAnsi.cpp and by Rust callers —
// console.table column sizing and the markdown ANSI renderer)
// ============================================================================

extern "C" size_t Bun__visibleWidthExcludeANSI_latin1(const uint8_t* ptr, size_t len)
{
    return StringWidth::visibleLatin1WidthExcludeANSI({ ptr, len });
}

extern "C" size_t Bun__visibleWidthExcludeANSI_utf16(const uint16_t* ptr, size_t len, bool ambiguous_as_wide)
{
    return StringWidth::visibleUTF16Width({ reinterpret_cast<const char16_t*>(ptr), len }, true, ambiguous_as_wide);
}

extern "C" size_t Bun__visibleWidthExcludeANSI_utf8(const uint8_t* ptr, size_t len)
{
    return StringWidth::visibleUTF8WidthExcludeANSI({ ptr, len });
}

extern "C" size_t Bun__visibleWidthExcludeANSI_utf8IndexAtWidth(const uint8_t* ptr, size_t len, size_t max_width)
{
    return StringWidth::utf8IndexAtWidthExcludeANSI({ ptr, len }, max_width);
}

extern "C" uint8_t Bun__codepointWidth(uint32_t cp, bool ambiguous_as_wide)
{
    return StringWidth::visibleCodepointWidth(cp, ambiguous_as_wide);
}

extern "C" bool Bun__graphemeBreak(uint32_t cp1, uint32_t cp2, uint8_t* state)
{
    return StringWidth::graphemeBreak(cp1, cp2, *state);
}

extern "C" bool Bun__isEmojiPresentation(uint32_t cp)
{
    return StringWidth::isEmojiPresentation(cp);
}

// ============================================================================
// JavaScript binding: Bun.stringWidth(input, options)
// ============================================================================

// `getTruthy` semantics shared with the other Bun option parsers: undefined,
// null and falsy strings leave the default in place; any other value is
// coerced with ToBoolean.
static void applyTruthyBooleanOption(JSC::JSGlobalObject* globalObject, JSC::JSValue value, bool& out)
{
    if (value.isUndefinedOrNull())
        return;
    if (value.isString() && !value.toBoolean(globalObject))
        return;
    out = value.toBoolean(globalObject);
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionBunStringWidth, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    const JSC::JSValue input = callFrame->argument(0);
    if (input.isUndefined())
        return JSC::JSValue::encode(JSC::jsNumber(0));

    JSC::JSString* const jsString = input.toString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    const auto view = jsString->view(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    if (view->isEmpty())
        return JSC::JSValue::encode(JSC::jsNumber(0));

    bool countAnsiEscapeCodes = false;
    bool ambiguousIsNarrow = true;

    const JSC::JSValue optionsValue = callFrame->argument(1);
    if (optionsValue.isObject()) {
        JSC::JSObject* optionsObject = JSC::asObject(optionsValue);

        JSC::JSValue countAnsiValue = optionsObject->get(globalObject, JSC::Identifier::fromString(vm, "countAnsiEscapeCodes"_s));
        RETURN_IF_EXCEPTION(scope, {});
        applyTruthyBooleanOption(globalObject, countAnsiValue, countAnsiEscapeCodes);

        JSC::JSValue ambiguousIsNarrowValue = optionsObject->get(globalObject, JSC::Identifier::fromString(vm, "ambiguousIsNarrow"_s));
        RETURN_IF_EXCEPTION(scope, {});
        applyTruthyBooleanOption(globalObject, ambiguousIsNarrowValue, ambiguousIsNarrow);
    }

    const bool ambiguousAsWide = !ambiguousIsNarrow;
    size_t width;
    if (view->is8Bit()) {
        // 8-bit JSC strings are Latin-1. The Latin-1 path has never honored
        // ambiguousIsNarrow (parity with the previous implementation), even
        // though some Latin-1 codepoints are East-Asian-Ambiguous (§, ×, ÷, ...).
        const auto span = view->span8();
        const std::span<const uint8_t> bytes { reinterpret_cast<const uint8_t*>(span.data()), span.size() };
        width = countAnsiEscapeCodes
            ? StringWidth::visibleLatin1Width(bytes)
            : StringWidth::visibleLatin1WidthExcludeANSI(bytes);
    } else {
        const auto span = view->span16();
        width = StringWidth::visibleUTF16Width({ span.data(), span.size() }, !countAnsiEscapeCodes, ambiguousAsWide);
    }

    return JSC::JSValue::encode(JSC::jsNumber(static_cast<double>(width)));
}

} // namespace Bun
