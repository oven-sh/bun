#pragma once

#include "root.h"
#include <algorithm>
#include <span>

namespace Bun {

// `Bun.stringWidth(input, { countAnsiEscapeCodes, ambiguousIsNarrow })`
JSC_DECLARE_HOST_FUNCTION(jsFunctionBunStringWidth);

namespace StringWidth {

// ============================================================================
// Codepoint classification (grapheme break class + width + emoji, one lookup)
// ============================================================================

// Each codepoint maps to one packed byte (stringWidthTables.h, regenerate
// with scripts/generate-stringwidth-tables.mjs):
//   bits 0-4  GraphemeBreakClass ordinal
//   bits 5-6  width class: 0 zero-width, 1 narrow, 2 wide, 3 East Asian Ambiguous
//   bit  7    the Emoji property, minus the keycap bases [0-9#*]
static constexpr uint8_t kFusedClassMask = 0x1F;
static constexpr uint8_t kFusedWidthShift = 5;
static constexpr uint8_t kFusedWidthMask = 0x3;
static constexpr uint8_t kFusedWidthAmbiguous = 3;
static constexpr uint8_t kFusedEmojiBit = 0x80;

// Grapheme_Cluster_Break refined with the emoji and Indic Conjunct Break
// properties. Ordinal values must match the generator.
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
    Control, // Grapheme_Cluster_Break Control, CR and LF
};
static constexpr size_t kGraphemeBreakClassCount = 18;
static_assert(kGraphemeBreakClassCount <= kFusedClassMask + 1);

// Packed classification byte of a codepoint (cp <= 0x10FFFF).
uint8_t fusedClassify(char32_t cp);

static constexpr GraphemeBreakClass graphemeBreakClassFromFused(uint8_t packed)
{
    return static_cast<GraphemeBreakClass>(packed & kFusedClassMask);
}

// Terminal column width from a packed classification byte.
static constexpr uint8_t widthFromFused(uint8_t packed, bool ambiguousAsWide)
{
    const uint8_t width = (packed >> kFusedWidthShift) & kFusedWidthMask;
    if (width == kFusedWidthAmbiguous)
        return ambiguousAsWide ? 2 : 1;
    return width;
}

// Terminal column width of a single codepoint (0, 1 or 2).
uint8_t visibleCodepointWidth(char32_t cp, bool ambiguousAsWide);

// Grapheme break test between two consecutive codepoints. `state` must be
// zero-initialized and carried between sequential calls.
bool graphemeBreak(char32_t cp1, char32_t cp2, uint8_t& state);

// ============================================================================
// Grapheme cluster width
// ============================================================================

// Accumulates the codepoints of one grapheme cluster and decides the
// cluster's terminal width. The base codepoint sets the width; extending
// codepoints add theirs (zero for marks and format characters, one for the
// halfwidth katakana voiced sound marks, ...) except the emoji modifiers,
// which never widen a cluster. The emoji sequences override the sum: a
// regional indicator pair (flag), a keycap, an emoji with a skin tone or a
// ZWJ, and the VS15/VS16 presentation selectors.
struct GraphemeState {
    uint16_t summedWidth = 0; // saturates at 1023
    uint8_t baseWidth = 0; // width of the first codepoint (0, 1 or 2)
    uint8_t count = 0; // number of codepoints in the cluster
    uint8_t regionalIndicators = 0;
    bool emojiBase = false; // first codepoint has the Emoji property
    bool keycapBase = false; // first codepoint is [0-9#*]
    bool keycap = false; // U+20E3 COMBINING ENCLOSING KEYCAP after the base
    bool skinTone = false;
    bool zwj = false;
    bool vs15 = false;
    bool vs16 = false;

    void reset(char32_t cp, uint8_t packed, bool ambiguousAsWide)
    {
        *this = GraphemeState {};
        const uint8_t w = widthFromFused(packed, ambiguousAsWide);
        count = 1;
        baseWidth = w;
        summedWidth = w;
        emojiBase = packed & kFusedEmojiBit;
        keycapBase = (cp >= '0' && cp <= '9') || cp == '#' || cp == '*';
        regionalIndicators = graphemeBreakClassFromFused(packed) == GraphemeBreakClass::RegionalIndicator;
    }

    void add(char32_t cp, uint8_t packed, bool ambiguousAsWide)
    {
        if (count < UINT8_MAX)
            count++;
        keycap = keycap || (cp == 0x20E3);
        zwj = zwj || (cp == 0x200D);
        vs15 = vs15 || (cp == 0xFE0E);
        vs16 = vs16 || (cp == 0xFE0F);

        const GraphemeBreakClass cpClass = graphemeBreakClassFromFused(packed);
        if (cpClass == GraphemeBreakClass::RegionalIndicator && regionalIndicators < UINT8_MAX)
            regionalIndicators++;
        if (cpClass == GraphemeBreakClass::EmojiModifier) {
            skinTone = true;
            return;
        }

        const uint32_t newWidth = static_cast<uint32_t>(summedWidth) + widthFromFused(packed, ambiguousAsWide);
        summedWidth = static_cast<uint16_t>(std::min<uint32_t>(newWidth, 1023));
    }

    size_t width() const
    {
        if (count == 0)
            return 0;
        // Regional indicator pair (flag emoji)
        if (regionalIndicators >= 2)
            return 2;
        // Keycap sequence: [0-9#*] (VS16)? U+20E3
        if (keycapBase && keycap)
            return 2;
        // Emoji modifier sequence or emoji ZWJ sequence
        if (emojiBase && (skinTone || zwj))
            return 2;
        // VS16 widens a base with the Emoji property to emoji presentation.
        // Zero-width and narrow non-emoji bases keep their own width under
        // VS15/VS16.
        if (vs15 || vs16) {
            if (baseWidth == 2 || (vs16 && emojiBase))
                return 2;
            return baseWidth;
        }
        return summedWidth;
    }
};

// ============================================================================
// String width
// ============================================================================

// Visible width of Latin-1 text, counting ANSI escape sequences as visible.
size_t visibleLatin1Width(std::span<const uint8_t> input);

// Visible width of Latin-1 text, treating ANSI escape sequences as zero-width.
size_t visibleLatin1WidthExcludeANSI(std::span<const uint8_t> input);

// Same as the pair above, with East Asian Ambiguous codepoints counted as wide.
size_t visibleLatin1WidthAmbiguousAsWide(std::span<const uint8_t> input);
size_t visibleLatin1WidthExcludeANSIAmbiguousAsWide(std::span<const uint8_t> input);

// Visible width of UTF-16 text (grapheme-cluster aware). `excludeAnsiColors`
// treats ANSI escape sequences as zero-width.
size_t visibleUTF16Width(std::span<const char16_t> input, bool excludeAnsiColors, bool ambiguousAsWide);

// Visible width of UTF-8 text (grapheme-cluster aware), treating ANSI escape
// sequences as zero-width. Used for console.table column sizing and the
// markdown ANSI renderer.
size_t visibleUTF8WidthExcludeANSI(std::span<const uint8_t> input);

// Byte index of the longest prefix of UTF-8 `input` whose visible width is
// <= `maxWidth`. ANSI escapes are zero-width and always included. Never
// splits a grapheme cluster or a multi-byte codepoint.
size_t utf8IndexAtWidthExcludeANSI(std::span<const uint8_t> input, size_t maxWidth);

} // namespace StringWidth

} // namespace Bun
