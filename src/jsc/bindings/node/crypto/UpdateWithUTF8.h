#pragma once

#include "root.h"
#include <unicode/utf16.h>
#include <wtf/SIMDUTF.h>

namespace Bun {

// Piece by piece on the stack: nothing can throw once a piece is in the hash.
template<typename Digest>
static NEVER_INLINE bool updateWithConvertedUTF8(Digest& digest, StringView text)
{
    constexpr size_t maximumUnits = 4096;
    std::array<char, 3 * maximumUnits> bytes;
    while (!text.isEmpty()) {
        size_t units = std::min<size_t>(text.length(), maximumUnits);
        size_t written;
        if (text.is8Bit())
            written = simdutf::convert_latin1_to_utf8(byteCast<char>(text.span8()).data(), units, bytes.data());
        else {
            if (units < text.length() && U16_IS_LEAD(text.span16()[units - 1]))
                units--;
            auto result = simdutf::convert_utf16le_to_utf8_with_errors(text.span16().data(), units, bytes.data());
            written = result.count;
            if (result.error != simdutf::error_code::SUCCESS) {
                std::array<char16_t, maximumUnits> wellFormed;
                simdutf::to_well_formed_utf16le(text.span16().data(), units, wellFormed.data());
                written = simdutf::convert_valid_utf16le_to_utf8(wellFormed.data(), units, bytes.data());
            }
        }
        if (!digest.update(byteCast<uint8_t>(std::span { bytes }.first(written))))
            return false;
        text = text.substring(units);
    }
    return true;
}

template<typename Digest>
static ALWAYS_INLINE bool updateWithUTF8(Digest& digest, StringView text)
{
    if (text.is8Bit() && WTF::charactersAreAllASCII(text.span8()))
        return digest.update(byteCast<uint8_t>(text.span8()));
    return updateWithConvertedUTF8(digest, text);
}

} // namespace Bun
