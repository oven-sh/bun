// Implementation of `Bun.stringWidth` — terminal column width of a string,
// aware of ANSI escape sequences, grapheme clusters (including ZWJ emoji,
// regional indicator flags, keycaps and variation selectors) and Unicode East
// Asian Width.
//
// Escape sequences are recognized by ANSI::consumeANSI() in ANSIHelpers.h, the
// recognizer shared with Bun.stripANSI and Bun.wrapAnsi: CSI (ESC [ ... final),
// OSC (ESC ] ... BEL/ST), the ST-terminated control strings (ESC P/X/^/_), the
// two-byte Fe/Fs/Fp escapes (ESC 7, ESC c, ESC =) and the nF charset
// designators (ESC ( B).
//
// The 8-bit C1 introducers (0x9B CSI, 0x9D OSC, 0x90/0x98/0x9E/0x9F control
// strings) are recognized on all three encodings; on the UTF-8 path a C1
// codepoint is the two-byte sequence 0xC2 0x9x, matched as that pair.
//
// The ASCII fast paths use explicit SIMD kernels from highway_strings.cpp
// (highway_visible_latin1_width, highway_count_printable_ascii16,
// highway_first_non_ascii*) so throughput does not depend on the compiler's
// autovectorizer.
//
// Rust callers (console.table column sizing, the markdown ANSI renderer)
// and sliceAnsi.cpp/wrapAnsi.cpp consume the `Bun__*` C exports at the bottom
// of this file.

#include "root.h"
#include "stringWidth.h"
#include "ANSIHelpers.h"
#include <unicode/uchar.h>
#include "ObjectBindings.h"
#include "stringWidthTables.h"

#include <algorithm>
#include <array>
#include <optional>
#include <span>
#include <wtf/text/WTFString.h>
#include <unicode/utf16.h>

// SIMD kernels implemented in highway_strings.cpp.
extern "C" size_t highway_visible_latin1_width(const uint8_t* input, size_t len);
extern "C" size_t highway_visible_latin1_width_exclude_ansi(const uint8_t* input, size_t len);
extern "C" size_t highway_visible_utf16_width(const uint16_t* input, size_t len, size_t* width);
extern "C" size_t highway_count_printable_ascii16(const uint16_t* input, size_t len);
extern "C" size_t highway_first_non_ascii16(const uint16_t* input, size_t len);
extern "C" size_t highway_first_non_ascii8(const uint8_t* input, size_t len);

namespace Bun {
namespace StringWidth {

// ============================================================================
// Codepoint classification (grapheme break class + width + emoji, one lookup)
// ============================================================================

// Each codepoint maps to one packed byte via the 3-stage table in
// stringWidthTables.h (regenerate with scripts/generate-stringwidth-tables.mjs):
//   bits 0-4  GraphemeBreakClass ordinal
//   bits 5-6  width class: 0 zero-width, 1 narrow, 2 wide, 3 East Asian Ambiguous
//   bit  7    Emoji property (with the isEmojiPresentation() early-outs baked in)
// The generator derives all three fields from the Unicode Character
// Database version pinned in the script (EastAsianWidth.txt,
// DerivedGeneralCategory.txt, emoji-data.txt).
static constexpr uint8_t kFusedClassMask = 0x1F;
static constexpr uint8_t kFusedWidthShift = 5;
static constexpr uint8_t kFusedWidthMask = 0x3;
static constexpr uint8_t kFusedWidthAmbiguous = 3;
static constexpr uint8_t kFusedEmojiBit = 0x80;

static constexpr uint8_t fusedClassify(char32_t cp)
{
    const size_t high = cp >> 8;
    const size_t low = cp & 0xFF;
    const size_t stage2Index = StringWidthTables::kGraphemeBreakStage1[high] + low;
    return StringWidthTables::kGraphemeBreakStage3[StringWidthTables::kGraphemeBreakStage2[stage2Index]];
}

// Terminal column width from a packed classification byte.
static constexpr uint8_t widthFromFused(uint8_t packed, bool ambiguousAsWide)
{
    const uint8_t width = (packed >> kFusedWidthShift) & kFusedWidthMask;
    if (width == kFusedWidthAmbiguous)
        return ambiguousAsWide ? 2 : 1;
    return width;
}

// Spot-check the generated table against known codepoints.
static_assert(widthFromFused(fusedClassify(U'A'), false) == 1);
static_assert(widthFromFused(fusedClassify(0x1B), false) == 0); // ESC: control, zero width
static_assert(widthFromFused(fusedClassify(0xAD), false) == 0); // soft hyphen
static_assert(widthFromFused(fusedClassify(0x202E), false) == 0); // RLO: bidi control, zero width
static_assert(widthFromFused(fusedClassify(0x2069), false) == 0); // PDI: bidi isolate, zero width
static_assert(widthFromFused(fusedClassify(0x61C), false) == 0); // arabic letter mark, zero width
static_assert(widthFromFused(fusedClassify(0x1BCA0), false) == 0); // shorthand format control, zero width
static_assert(widthFromFused(fusedClassify(0x1D173), false) == 0); // musical format control, zero width
static_assert(widthFromFused(fusedClassify(0x4E2D), false) == 2); // CJK ideograph: wide
static_assert(widthFromFused(fusedClassify(0xFF21), false) == 2); // fullwidth A: wide
static_assert(widthFromFused(fusedClassify(0xA7), false) == 1); // section sign: ambiguous, narrow by default
static_assert(widthFromFused(fusedClassify(0xA7), true) == 2); // section sign: ambiguous as wide
static_assert((fusedClassify(0x1F600) & kFusedEmojiBit) != 0); // emoji
static_assert((fusedClassify(U'#') & kFusedEmojiBit) == 0); // '#': below the U+203C early-out
static_assert((fusedClassify(0xFE0F) & kFusedEmojiBit) == 0); // VS16 handled separately
static_assert(widthFromFused(fusedClassify(0x0591), false) == 0); // hebrew accent (Mn): zero width
static_assert(widthFromFused(fusedClassify(0x1161), false) == 0); // hangul jungseong: zero width
static_assert(widthFromFused(fusedClassify(0x1112), false) == 2); // hangul choseong: wide
static_assert(widthFromFused(fusedClassify(0x4DC0), false) == 2); // yijing hexagram: wide since Unicode 16
static_assert((fusedClassify(0x1FA89) & kFusedEmojiBit) != 0); // Unicode 16 emoji

uint8_t visibleCodepointWidth(char32_t cp, bool ambiguousAsWide)
{
    ASSERT(cp <= 0x10FFFF);
    return widthFromFused(fusedClassify(cp), ambiguousAsWide);
}

bool isEmojiPresentation(char32_t cp)
{
    ASSERT(cp <= 0x10FFFF);
    return fusedClassify(cp) & kFusedEmojiBit;
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
static_assert(kGraphemeBreakClassCount <= kFusedClassMask + 1);
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
// The state is packed into bits 0-2 of graphemeBreakKey().
static_assert(kGraphemeBreakStateCount <= (1 << 3));

static constexpr GraphemeBreakClass graphemeBreakClassFromFused(uint8_t packed)
{
    return static_cast<GraphemeBreakClass>(packed & kFusedClassMask);
}

static GraphemeBreakClass graphemeBreakClass(char32_t cp)
{
    ASSERT(cp <= 0x10FFFF);
    return graphemeBreakClassFromFused(fusedClassify(cp));
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

// Returns true when there is a grapheme cluster break between two consecutive
// codepoints with the given break classes. Must be called sequentially,
// carrying `state` between calls. Control characters, CR and LF are not
// handled here — callers treat them before consulting the break algorithm
// (they always terminate a cluster).
static bool graphemeBreakClasses(GraphemeBreakClass gb1, GraphemeBreakClass gb2, GraphemeBreakState& state)
{
    const uint8_t value = kGraphemeBreakDecisions[graphemeBreakKey(gb1, gb2, state)];
    state = static_cast<GraphemeBreakState>(value >> 1);
    return value & 1;
}

static bool graphemeBreak(char32_t cp1, char32_t cp2, GraphemeBreakState& state)
{
    return graphemeBreakClasses(graphemeBreakClass(cp1), graphemeBreakClass(cp2), state);
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

    void reset(char32_t cp, uint8_t packed, bool ambiguousAsWide)
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

        const uint8_t w = widthFromFused(packed, ambiguousAsWide);
        count = 1;
        baseWidth = w;
        nonEmojiWidth = w;
        emojiBase = packed & kFusedEmojiBit;
        keycap = (cp == 0x20E3);
        regionalIndicator = isRegionalIndicator(cp);
        skinTone = isSkinToneModifier(cp);
        zwj = (cp == 0x200D);
        vs15 = false;
        vs16 = false;
    }

    void add(char32_t cp, uint8_t packed, bool ambiguousAsWide)
    {
        if (count < UINT8_MAX)
            count++;
        keycap = keycap || (cp == 0x20E3);
        regionalIndicator = regionalIndicator || isRegionalIndicator(cp);
        skinTone = skinTone || isSkinToneModifier(cp);
        zwj = zwj || (cp == 0x200D);
        vs15 = vs15 || (cp == 0xFE0E);
        vs16 = vs16 || (cp == 0xFE0F);

        // Zero-width codepoints contribute nothing here.
        const uint32_t newWidth = static_cast<uint32_t>(nonEmojiWidth) + widthFromFused(packed, ambiguousAsWide);
        nonEmojiWidth = static_cast<uint16_t>(std::min<uint32_t>(newWidth, 1023));
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

        // VS16 widens only a base with the Emoji property to emoji
        // presentation; the fused emoji bit early-outs below U+203C, where
        // (c) and (R) are the only non-keycap Emoji codepoints. Zero-width
        // and narrow non-emoji bases keep their own width under VS15/VS16.
        if (vs15 || vs16) {
            if (baseWidth == 2 || (vs16 && (emojiBase || firstCp == 0xA9 || firstCp == 0xAE)))
                return 2;
            return baseWidth;
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

// Visible width treating ANSI escape sequences as zero-width (see the file
// header for the grammar). Ref: https://cs.stanford.edu/people/miles/iso8859.html
//
// Implemented as a single-pass SIMD kernel (highway_strings.cpp): each chunk is
// classified once into printable/escape bitmasks, so dense SGR input does not
// pay a separate scan per escape sequence. That kernel carries its own scalar
// mirror of ANSI::consumeANSI(), which stringWidth.test.ts cross-checks
// against this one.
size_t visibleLatin1WidthExcludeANSI(std::span<const uint8_t> input)
{
    if (input.empty())
        return 0;
    return highway_visible_latin1_width_exclude_ansi(input.data(), input.size());
}

// Per-byte terminal width for Latin-1 with East Asian Ambiguous counted as
// wide, derived from the fused table so both paths classify identically.
static constexpr auto kLatin1AmbiguousAsWideWidth = []() constexpr {
    std::array<uint8_t, 256> table {};
    for (size_t i = 0; i < table.size(); i++)
        table[i] = widthFromFused(fusedClassify(static_cast<char32_t>(i)), /* ambiguousAsWide */ true);
    return table;
}();
static_assert(kLatin1AmbiguousAsWideWidth[0xA7] == 2); // section sign: ambiguous
static_assert(kLatin1AmbiguousAsWideWidth[0xAD] == 0); // soft hyphen: ambiguous but zero-width
static_assert(kLatin1AmbiguousAsWideWidth[0xA0] == 1); // nbsp: not ambiguous
static_assert(kLatin1AmbiguousAsWideWidth[0x1B] == 0); // ESC: control

size_t visibleLatin1WidthAmbiguousAsWide(std::span<const uint8_t> input)
{
    size_t width = 0;
    for (const uint8_t c : input)
        width += kLatin1AmbiguousAsWideWidth[c];
    return width;
}

// Same ANSI grammar as visibleLatin1WidthExcludeANSI (ANSI::consumeANSI),
// scalar because the ambiguous-as-wide option is rare.
size_t visibleLatin1WidthExcludeANSIAmbiguousAsWide(std::span<const uint8_t> input)
{
    const uint8_t* p = input.data();
    const uint8_t* const end = p + input.size();
    size_t width = 0;
    while (p != end) {
        if (ANSI::isEscapeCharacter(*p)) {
            p = ANSI::consumeANSI(p, end); // always makes progress
            continue;
        }
        width += kLatin1AmbiguousAsWideWidth[*p++];
    }
    return width;
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

// UTF-8 width of a run with no escape sequences in it: ASCII runs are counted
// in bulk, non-ASCII codepoints are decoded and summed individually (no
// grapheme clustering — keeps the historical behavior of the console.table /
// markdown renderer callers).
static size_t visibleUTF8Width(std::span<const uint8_t> input)
{
    std::span<const uint8_t> bytes = input;
    size_t len = 0;

    while (true) {
        // Runs of non-ASCII codepoints are common (CJK text); peek before
        // paying for a SIMD scan that would return 0.
        const size_t i = (!bytes.empty() && bytes[0] > 0x7F) ? 0 : highway_first_non_ascii8(bytes.data(), bytes.size());
        if (i == bytes.size())
            break;
        len += visibleLatin1Width(bytes.first(i));

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

    len += visibleLatin1Width(bytes);
    return len;
}

// Start of the next escape sequence in UTF-8 text: ESC, or the two-byte
// encoding (0xC2 0x9x) of an 8-bit C1 introducer. nullptr if none.
static const uint8_t* findEscapeIntroducerUTF8(const uint8_t* p, const uint8_t* end)
{
    while (true) {
        const uint8_t* const q = ANSI::scanForAnyByte<0x1b, 0xc2>(p, end);
        if (!q || *q == 0x1b)
            return q;
        if (q + 1 != end && q[1] >= 0x90 && ANSI::isEscapeCharacter(q[1]))
            return q;
        p = q + 1; // an ordinary U+0080-U+00BF codepoint
    }
}

size_t visibleUTF8WidthExcludeANSI(std::span<const uint8_t> input)
{
    const uint8_t* p = input.data();
    const uint8_t* const end = p + input.size();
    size_t width = 0;

    while (p != end) {
        const uint8_t* const esc = findEscapeIntroducerUTF8(p, end);
        width += visibleUTF8Width({ p, static_cast<size_t>((esc ? esc : end) - p) });
        if (!esc)
            break;
        // *esc is an introducer, so consumeANSI() always makes progress.
        p = ANSI::consumeANSI<true>(esc, end);
    }
    return width;
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
    const uint8_t* const begin = input.data();
    const uint8_t* const end = begin + input.size();
    const uint8_t* p = begin;
    size_t w = 0;

    while (p != end) {
        const uint8_t* const esc = findEscapeIntroducerUTF8(p, end);
        // Walk the visible run before the introducer.
        const size_t runStart = static_cast<size_t>(p - begin);
        const size_t runLen = static_cast<size_t>((esc ? esc : end) - p);
        if (const auto stop = utf8WalkRun(input, runStart, runLen, maxWidth, w))
            return *stop;
        if (!esc)
            break;

        // Escape sequences count as zero-width and are always included in the
        // prefix; an unterminated one consumes the rest of the input.
        p = ANSI::consumeANSI<true>(esc, end);
    }
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

// Grapheme-cluster-aware width accumulator for runs of UTF-16 text with no
// escape sequences in them. State is carried between runs so a combining mark
// that follows an escape sequence still joins the cluster before it.
struct UTF16WidthAccumulator {
    size_t len = 0;
    GraphemeState graphemeState;
    // Break class of the last *visible* codepoint, used for grapheme break
    // decisions (carried so each codepoint is classified only once). Escape
    // sequence bytes must not participate: a CSI final byte like 'm' would
    // otherwise wrongly join to a following combining mark.
    GraphemeBreakClass prevClass = GraphemeBreakClass::Other;
    GraphemeBreakState breakState = GraphemeBreakState::Default;
    bool hasPrevVisible = false;
    const bool ambiguousAsWide;

    explicit UTF16WidthAccumulator(bool ambiguousAsWide)
        : ambiguousAsWide(ambiguousAsWide)
    {
    }

    void addCodepoint(char32_t cp)
    {
        const uint8_t packed = fusedClassify(cp);
        const GraphemeBreakClass cpClass = graphemeBreakClassFromFused(packed);
        if (!hasPrevVisible) {
            graphemeState.reset(cp, packed, ambiguousAsWide);
        } else if (graphemeBreakClasses(prevClass, cpClass, breakState)) {
            len += graphemeState.width();
            graphemeState.reset(cp, packed, ambiguousAsWide);
        } else {
            graphemeState.add(cp, packed, ambiguousAsWide);
        }
        hasPrevVisible = true;
        prevClass = cpClass;
    }

    // Seed the cluster state from the last codepoint of a bulk-counted run,
    // flushing whatever cluster was pending before it. The codepoint's own
    // width is not added here: a combining mark, jamo or ZWJ right after the
    // run still joins its cluster, so the caller counts every unit but the
    // last and lets GraphemeState::width() settle the final one.
    void seedFromBulkRun(char32_t cp, uint8_t packed)
    {
        if (graphemeState.count > 0)
            len += graphemeState.width();
        graphemeState.reset(cp, packed, ambiguousAsWide);
        hasPrevVisible = true;
        prevClass = graphemeBreakClassFromFused(packed);
        breakState = GraphemeBreakState::Default;
    }

    // Consumes text up to the end of `input`, or — when `stopAtEscape` — up to
    // the first escape introducer (ESC or an 8-bit C1 introducer), which the
    // caller then hands to the escape recognizer. Returns the number of code
    // units consumed. ESC is below 0x20 and the C1 introducers are above 0x7F
    // outside the bulk kernel's allowlist, so both bulk kernels already stop on
    // them; only the ASCII run needs an extra scan, over a span that is already
    // in cache.
    size_t addRun(std::span<const char16_t> input, bool stopAtEscape = false)
    {
        const char16_t* const begin = input.data();
        while (true) {
            // Bulk fast path: leading code units that are always their own
            // grapheme cluster with a fixed width (ASCII, most Latin/Greek/
            // Cyrillic letters, the main CJK/kana/Hangul-syllable/fullwidth
            // blocks) are classified and counted in one SIMD pass
            // (highway_visible_utf16_width). Skipped when ambiguous-width
            // characters count as wide (Greek/Cyrillic are East-Asian-
            // Ambiguous); the first-unit check skips the call when the next
            // codepoint (surrogate pair, control) clearly needs the scalar
            // path anyway.
            if (!ambiguousAsWide && !input.empty() && input[0] >= 0x20 && !U16_IS_SURROGATE(input[0])) {
                size_t bulkWidth = 0;
                const size_t consumed = highway_visible_utf16_width(
                    reinterpret_cast<const uint16_t*>(input.data()), input.size(), &bulkWidth);
                if (consumed > 0) {
                    const char32_t lastCp = input[consumed - 1];
                    const uint8_t lastPacked = fusedClassify(lastCp);
                    seedFromBulkRun(lastCp, lastPacked);
                    len += bulkWidth - widthFromFused(lastPacked, ambiguousAsWide);
                    input = input.subspan(consumed);
                    continue;
                }
            }

            // Empty, or the caller's escape introducer is next — checked
            // before the ASCII scan so an ESC does not trigger a scan whose
            // result would be discarded.
            if (input.empty() || (stopAtEscape && ANSI::isEscapeCharacter(input[0])))
                break;

            // Length of the leading all-ASCII (<= 0x7F) run, bounded by the
            // next escape when `stopAtEscape` so neither scan reads past the
            // current visible run. Peek the first unit before scanning — a
            // non-ASCII lead (CJK, emoji) would scan a zero-length prefix.
            size_t idx = 0;
            if (input[0] <= 0x7F) {
                size_t bound = input.size();
                if (stopAtEscape) {
                    if (const char16_t* const esc = ANSI::scanForAnyByte<0x1b>(input.data(), input.data() + input.size()))
                        bound = static_cast<size_t>(esc - input.data());
                }
                idx = highway_first_non_ascii16(reinterpret_cast<const uint16_t*>(input.data()), bound);
            }
            if (idx > 0) {
                const char32_t lastCp = input[idx - 1];
                const uint8_t lastPacked = fusedClassify(lastCp);
                seedFromBulkRun(lastCp, lastPacked);
                if (idx > 1)
                    len += countPrintableAscii16(input.first(idx - 1));
                input = input.subspan(idx);
                continue;
            }

            // Decode one non-ASCII codepoint (input[0] > 0x7F). Invalid
            // sequences and lone surrogates are zero-width and do not update
            // the grapheme state.
            const UTF16Decoded decoded = decodeUTF16Codepoint(input);
            input = input.subspan(decoded.lengthInUnits);
            if (!decoded.skip)
                addCodepoint(decoded.codePoint);
        }
        return static_cast<size_t>(input.data() - begin);
    }

    size_t finish() const { return len + graphemeState.width(); }
};

// Grapheme-cluster-aware width of UTF-16 text. When `excludeAnsiColors` is
// set, escape sequences contribute nothing (see the file header for the
// grammar); otherwise escape bytes are counted like ordinary codepoints.
size_t visibleUTF16Width(std::span<const char16_t> input, bool excludeAnsiColors, bool ambiguousAsWide)
{
    UTF16WidthAccumulator accumulator { ambiguousAsWide };
    if (!excludeAnsiColors) {
        accumulator.addRun(input);
        return accumulator.finish();
    }

    const char16_t* p = input.data();
    const char16_t* const end = p + input.size();
    while (p != end) {
        if (ANSI::isEscapeCharacter(*p)) {
            p = ANSI::consumeANSI(p, end); // always makes progress
            continue;
        }
        p += accumulator.addRun({ p, static_cast<size_t>(end - p) }, /* stopAtEscape */ true);
    }
    return accumulator.finish();
}

} // namespace StringWidth

// ============================================================================
// C exports (consumed by sliceAnsi.cpp / wrapAnsi.cpp and by Rust callers —
// console.table column sizing and the markdown ANSI renderer)
// ============================================================================

extern "C" size_t Bun__visibleWidthExcludeANSI_latin1(const uint8_t* ptr, size_t len, bool ambiguous_as_wide)
{
    return ambiguous_as_wide
        ? StringWidth::visibleLatin1WidthExcludeANSIAmbiguousAsWide({ ptr, len })
        : StringWidth::visibleLatin1WidthExcludeANSI({ ptr, len });
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
    // Guard the exported ABI: the classification table covers the Unicode
    // scalar range only. Out-of-range input falls back to width 1, matching
    // the previous range-check implementation.
    if (cp > 0x10FFFF)
        return 1;
    return StringWidth::visibleCodepointWidth(cp, ambiguous_as_wide);
}

extern "C" bool Bun__graphemeBreak(uint32_t cp1, uint32_t cp2, uint8_t* state)
{
    // Guard the exported ABI: the grapheme class lookup indexes fixed tables,
    // so reject values outside the Unicode scalar range instead of reading out
    // of bounds. Invalid input is treated as a cluster boundary.
    if (!state || cp1 > 0x10FFFF || cp2 > 0x10FFFF)
        return true;
    return StringWidth::graphemeBreak(cp1, cp2, *state);
}

extern "C" bool Bun__isEmojiPresentation(uint32_t cp)
{
    if (cp > 0x10FFFF)
        return false;
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

namespace StringWidth {

// node's per-code-point column width (src/node_i18n.cc GetColumnWidth,
// v26.3.0): East Asian Width first, Emoji_Presentation on the
// neutral/narrow-ambiguous path, then the zero-width general categories
// (Cc/Cf/Me/Mn or Emoji_Modifier) with the SOFT HYPHEN exception.
// https://github.com/nodejs/node/blob/v26.3.0/src/node_i18n.cc
static uint32_t perCodePointColumnWidth(char32_t cp, bool ambiguousAsWide)
{
    switch (u_getIntPropertyValue(static_cast<UChar32>(cp), UCHAR_EAST_ASIAN_WIDTH)) {
    case U_EA_FULLWIDTH:
    case U_EA_WIDE:
        return 2;
    case U_EA_AMBIGUOUS:
        if (ambiguousAsWide)
            return 2;
        [[fallthrough]];
    case U_EA_NEUTRAL:
        if (u_hasBinaryProperty(static_cast<UChar32>(cp), UCHAR_EMOJI_PRESENTATION))
            return 2;
        [[fallthrough]];
    default: {
        constexpr uint32_t zeroWidthMask = U_GC_CC_MASK | U_GC_CF_MASK | U_GC_ME_MASK | U_GC_MN_MASK;
        if (cp != 0x00AD
            && ((U_MASK(u_charType(static_cast<UChar32>(cp))) & zeroWidthMask)
                || u_hasBinaryProperty(static_cast<UChar32>(cp), UCHAR_EMOJI_MODIFIER)))
            return 0;
        return 1;
    }
    }
}

static size_t perCodePointLatin1Width(std::span<const uint8_t> input, bool excludeAnsiColors, bool ambiguousAsWide)
{
    size_t width = 0;
    const uint8_t* p = input.data();
    const uint8_t* const end = p + input.size();
    while (p != end) {
        if (excludeAnsiColors && ANSI::isEscapeCharacter(*p)) {
            p = ANSI::consumeANSI(p, end); // always makes progress
            continue;
        }
        width += perCodePointColumnWidth(*p++, ambiguousAsWide);
    }
    return width;
}

static size_t perCodePointUTF16Width(std::span<const char16_t> input, bool excludeAnsiColors, bool ambiguousAsWide)
{
    size_t width = 0;
    const char16_t* p = input.data();
    const char16_t* const end = p + input.size();
    while (p != end) {
        if (excludeAnsiColors && ANSI::isEscapeCharacter(*p)) {
            p = ANSI::consumeANSI(p, end); // always makes progress
            continue;
        }
        char32_t cp = *p++;
        if (U16_IS_LEAD(cp) && p != end && U16_IS_TRAIL(*p)) {
            cp = U16_GET_SUPPLEMENTARY(static_cast<char16_t>(cp), *p);
            p++;
        }
        width += perCodePointColumnWidth(cp, ambiguousAsWide);
    }
    return width;
}

} // namespace StringWidth

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
    bool perCodePoint = false;

    const JSC::JSValue optionsValue = callFrame->argument(1);
    if (optionsValue.isObject()) {
        JSC::JSObject* optionsObject = JSC::asObject(optionsValue);

        // Same prototype-pollution-mitigated lookup the previous implementation
        // (and the other Bun option parsers) use: stops before Object.prototype.
        JSC::JSValue countAnsiValue = getIfPropertyExistsPrototypePollutionMitigation(globalObject, optionsObject, JSC::Identifier::fromString(vm, "countAnsiEscapeCodes"_s));
        RETURN_IF_EXCEPTION(scope, {});
        applyTruthyBooleanOption(globalObject, countAnsiValue, countAnsiEscapeCodes);

        JSC::JSValue ambiguousIsNarrowValue = getIfPropertyExistsPrototypePollutionMitigation(globalObject, optionsObject, JSC::Identifier::fromString(vm, "ambiguousIsNarrow"_s));
        RETURN_IF_EXCEPTION(scope, {});
        applyTruthyBooleanOption(globalObject, ambiguousIsNarrowValue, ambiguousIsNarrow);

        JSC::JSValue perCodePointValue = getIfPropertyExistsPrototypePollutionMitigation(globalObject, optionsObject, JSC::Identifier::fromString(vm, "perCodePoint"_s));
        RETURN_IF_EXCEPTION(scope, {});
        applyTruthyBooleanOption(globalObject, perCodePointValue, perCodePoint);
    }

    const bool ambiguousAsWide = !ambiguousIsNarrow;
    if (perCodePoint) {
        // node's ICU column-width algorithm: every code point measured
        // individually (an emoji ZWJ sequence counts each member), instead
        // of the grapheme clustering above.
        size_t width;
        if (view->is8Bit()) {
            const auto span = view->span8();
            width = StringWidth::perCodePointLatin1Width({ reinterpret_cast<const uint8_t*>(span.data()), span.size() }, !countAnsiEscapeCodes, ambiguousAsWide);
        } else {
            const auto span = view->span16();
            width = StringWidth::perCodePointUTF16Width({ span.data(), span.size() }, !countAnsiEscapeCodes, ambiguousAsWide);
        }
        return JSC::JSValue::encode(JSC::jsNumber(static_cast<double>(width)));
    }
    size_t width;
    if (view->is8Bit()) {
        // 8-bit JSC strings are Latin-1.
        const auto span = view->span8();
        const std::span<const uint8_t> bytes { reinterpret_cast<const uint8_t*>(span.data()), span.size() };
        if (ambiguousAsWide) {
            width = countAnsiEscapeCodes
                ? StringWidth::visibleLatin1WidthAmbiguousAsWide(bytes)
                : StringWidth::visibleLatin1WidthExcludeANSIAmbiguousAsWide(bytes);
        } else {
            width = countAnsiEscapeCodes
                ? StringWidth::visibleLatin1Width(bytes)
                : StringWidth::visibleLatin1WidthExcludeANSI(bytes);
        }
    } else {
        const auto span = view->span16();
        width = StringWidth::visibleUTF16Width({ span.data(), span.size() }, !countAnsiEscapeCodes, ambiguousAsWide);
    }

    return JSC::JSValue::encode(JSC::jsNumber(static_cast<double>(width)));
}

} // namespace Bun
