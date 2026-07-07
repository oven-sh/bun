#pragma once

#include "root.h"
#include <span>

namespace Bun {

// `Bun.stringWidth(input, { countAnsiEscapeCodes, ambiguousIsNarrow })`
JSC_DECLARE_HOST_FUNCTION(jsFunctionBunStringWidth);

namespace StringWidth {

// Terminal column width of a single codepoint (0, 1 or 2).
uint8_t visibleCodepointWidth(char32_t cp, bool ambiguousAsWide);

// Grapheme break test between two consecutive codepoints. `state` must be
// zero-initialized and carried between sequential calls.
bool graphemeBreak(char32_t cp1, char32_t cp2, uint8_t& state);

// True when the codepoint renders as emoji presentation (UCHAR_EMOJI, with
// the same early-outs the width code uses).
bool isEmojiPresentation(char32_t cp);

// Visible width of Latin-1 text, counting ANSI escape sequences as visible.
size_t visibleLatin1Width(std::span<const uint8_t> input);

// Visible width of Latin-1 text, treating ANSI escape sequences as zero-width.
size_t visibleLatin1WidthExcludeANSI(std::span<const uint8_t> input);

// Visible width of UTF-16 text (grapheme-cluster aware). `excludeAnsiColors`
// treats ANSI escape sequences as zero-width.
size_t visibleUTF16Width(std::span<const char16_t> input, bool excludeAnsiColors, bool ambiguousAsWide);

// Visible width of UTF-8 text, treating ANSI escape sequences as zero-width.
// Sums codepoint widths (no grapheme clustering) — used for console.table
// column sizing and the markdown ANSI renderer.
size_t visibleUTF8WidthExcludeANSI(std::span<const uint8_t> input);

// Byte index of the longest prefix of UTF-8 `input` whose visible width is
// <= `maxWidth`. ANSI escapes are zero-width and always included. Never
// splits a multi-byte codepoint.
size_t utf8IndexAtWidthExcludeANSI(std::span<const uint8_t> input, size_t maxWidth);

} // namespace StringWidth

} // namespace Bun
