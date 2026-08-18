#include "root.h"

/*
 * Copyright (C) 2020 Apple Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 * 1. Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY APPLE INC. ``AS IS'' AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL APPLE INC. OR
 * CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
 * EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
 * PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
 * PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY
 * OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

// config.h removed - not needed in Bun
#include "TextCodecCJK.h"

#include "EncodingTables.h"
#include <ranges>
#include <wtf/TZoneMallocInlines.h>
#include <wtf/text/MakeString.h>
#include <wtf/text/StringBuilder.h>
#include <wtf/unicode/CharacterNames.h>

namespace PAL {

WTF_MAKE_TZONE_ALLOCATED_IMPL(TextCodecCJK);

enum class TextCodecCJK::Encoding : uint8_t {
    EUC_JP,
    ISO2022JP,
    Shift_JIS,
    EUC_KR,
    Big5,
    GBK,
    GB18030
};

TextCodecCJK::TextCodecCJK(Encoding encoding)
    : m_encoding(encoding)
{
    checkEncodingTableInvariants();
}

void TextCodecCJK::registerEncodingNames(EncodingNameRegistrar registrar)
{
    // https://encoding.spec.whatwg.org/#names-and-labels
    auto registerAliases = [&](std::initializer_list<ASCIILiteral> list) {
        for (auto& alias : list)
            registrar(alias, *list.begin());
    };

    registerAliases({ "Big5"_s,
        "big5-hkscs"_s,
        "cn-big5"_s,
        "csbig5"_s,
        "x-x-big5"_s });

    registerAliases({ "EUC-JP"_s,
        "cseucpkdfmtjapanese"_s,
        "x-euc-jp"_s });

    registerAliases({ "Shift_JIS"_s,
        "csshiftjis"_s,
        "ms932"_s,
        "ms_kanji"_s,
        "shift-jis"_s,
        "sjis"_s,
        "windows-31j"_s,
        "x-sjis"_s });

    registerAliases({
        "EUC-KR"_s,
        "cseuckr"_s,
        "csksc56011987"_s,
        "iso-ir-149"_s,
        "korean"_s,
        "ks_c_5601-1987"_s,
        "ks_c_5601-1989"_s,
        "ksc5601"_s,
        "ksc_5601"_s,
        "windows-949"_s,

        // These aliases are not in the specification, but WebKit has historically supported them.
        "x-windows-949"_s,
        "x-uhc"_s,
    });

    registerAliases({ "ISO-2022-JP"_s,
        "csiso2022jp"_s });

    registerAliases({ "GBK"_s,
        "chinese"_s,
        "csgb2312"_s,
        "csiso58gb231280"_s,
        "gb2312"_s,
        "gb_2312"_s,
        "gb_2312-80"_s,
        "iso-ir-58"_s,
        "x-gbk"_s,

        // These aliases are not in the specification, but WebKit has historically supported them.
        "cn-gb"_s,
        "csgb231280"_s,
        "x-euc-cn"_s,
        "euc-cn"_s,
        "cp936"_s,
        "ms936"_s,
        "gb2312-1980"_s,
        "windows-936"_s,
        "windows-936-2000"_s });

    registerAliases({ "gb18030"_s,

        // These aliases are not in the specification, but WebKit has historically supported them.
        "ibm-1392"_s,
        "windows-54936"_s });
}

void TextCodecCJK::registerCodecs(TextCodecRegistrar registrar)
{
    registrar("EUC-JP"_s, [] {
        return makeUnique<TextCodecCJK>(Encoding::EUC_JP);
    });
    registrar("Big5"_s, [] {
        return makeUnique<TextCodecCJK>(Encoding::Big5);
    });
    registrar("Shift_JIS"_s, [] {
        return makeUnique<TextCodecCJK>(Encoding::Shift_JIS);
    });
    registrar("EUC-KR"_s, [] {
        return makeUnique<TextCodecCJK>(Encoding::EUC_KR);
    });
    registrar("ISO-2022-JP"_s, [] {
        return makeUnique<TextCodecCJK>(Encoding::ISO2022JP);
    });
    registrar("GBK"_s, [] {
        return makeUnique<TextCodecCJK>(Encoding::GBK);
    });
    registrar("gb18030"_s, [] {
        return makeUnique<TextCodecCJK>(Encoding::GB18030);
    });
}

String TextCodecCJK::decodeCommon(std::span<const uint8_t> bytes, bool flush, bool stopOnError, bool& sawError, NOESCAPE const Function<SawError(uint8_t, StringBuilder&)>& byteParser)
{
    StringBuilder result;
    result.reserveCapacity(bytes.size());

    if (m_prependedByte && byteParser(*std::exchange(m_prependedByte, std::nullopt), result) == SawError::Yes) {
        sawError = true;
        result.append(replacementCharacter);
        if (stopOnError) {
            m_lead = 0x00;
            return result.toString();
        }
    }
    for (auto byte : bytes) {
        if (byteParser(byte, result) == SawError::Yes) {
            sawError = true;
            result.append(replacementCharacter);
            if (stopOnError) {
                m_lead = 0x00;
                // The byte parser may have stashed `byte` here on the error
                // path; don't let it leak into the next decode call.
                m_prependedByte = std::nullopt;
                return result.toString();
            }
        }
        if (m_prependedByte && byteParser(*std::exchange(m_prependedByte, std::nullopt), result) == SawError::Yes) {
            sawError = true;
            result.append(replacementCharacter);
            if (stopOnError) {
                m_lead = 0x00;
                return result.toString();
            }
        }
    }

    if (flush && m_lead) {
        m_lead = 0x00;
        sawError = true;
        result.append(replacementCharacter);
    }

    return result.toString();
}

static std::optional<char16_t> codePointJIS0208(uint16_t pointer)
{
    return findFirstInSortedPairs(jis0208(), pointer);
}

static std::optional<char16_t> codePointJIS0212(uint16_t pointer)
{
    return findFirstInSortedPairs(jis0212(), pointer);
}

// https://encoding.spec.whatwg.org/#euc-jp-decoder
String TextCodecCJK::eucJPDecode(std::span<const uint8_t> bytes, bool flush, bool stopOnError, bool& sawError)
{
    auto result = decodeCommon(bytes, flush, stopOnError, sawError, [this](uint8_t byte, StringBuilder& result) {
        if (uint8_t lead = std::exchange(m_lead, 0x00)) {
            if (lead == 0x8E && byte >= 0xA1 && byte <= 0xDF) {
                result.append(static_cast<char32_t>(0xFF61 - 0xA1 + byte));
                return SawError::No;
            }
            if (lead == 0x8F && byte >= 0xA1 && byte <= 0xFE) {
                m_jis0212 = true;
                m_lead = byte;
                return SawError::No;
            }
            // The jis0212 flag is cleared unconditionally ("Set EUC-JP jis0212 to
            // false"), even when `byte` aborts the sequence, so it cannot leak
            // into the next, possibly valid, JIS X 0208 pair.
            bool jis0212 = std::exchange(m_jis0212, false);
            if (lead >= 0xA1 && lead <= 0xFE && byte >= 0xA1 && byte <= 0xFE) {
                uint16_t pointer = (lead - 0xA1) * 94 + byte - 0xA1;
                if (auto codePoint = jis0212 ? codePointJIS0212(pointer) : codePointJIS0208(pointer)) {
                    result.append(*codePoint);
                    return SawError::No;
                }
            }
            if (isASCII(byte))
                m_prependedByte = byte;
            return SawError::Yes;
        }
        if (isASCII(byte)) {
            result.append(byteCast<char>(byte));
            return SawError::No;
        }
        if (byte == 0x8E || byte == 0x8F || (byte >= 0xA1 && byte <= 0xFE)) {
            m_lead = byte;
            return SawError::No;
        }
        return SawError::Yes;
    });
    if (flush)
        m_jis0212 = false;
    return result;
}

// https://encoding.spec.whatwg.org/#iso-2022-jp-decoder
String TextCodecCJK::iso2022JPDecode(std::span<const uint8_t> bytes, bool flush, bool stopOnError, bool& sawError)
{
    auto byteParser = [&](uint8_t byte, StringBuilder& result) {
        switch (m_iso2022JPDecoderState) {
        case ISO2022JPDecoderState::ASCII:
            if (byte == 0x1B) {
                m_iso2022JPDecoderState = ISO2022JPDecoderState::EscapeStart;
                break;
            }
            if (byte <= 0x7F && byte != 0x0E && byte != 0x0F && byte != 0x1B) {
                m_iso2022JPOutput = false;
                result.append(byte);
                break;
            }
            m_iso2022JPOutput = false;
            return SawError::Yes;
        case ISO2022JPDecoderState::Roman:
            if (byte == 0x1B) {
                m_iso2022JPDecoderState = ISO2022JPDecoderState::EscapeStart;
                break;
            }
            if (byte == 0x5C) {
                m_iso2022JPOutput = false;
                result.append(static_cast<char16_t>(0x00A5));
                break;
            }
            if (byte == 0x7E) {
                m_iso2022JPOutput = false;
                result.append(static_cast<char16_t>(0x203E));
                break;
            }
            if (byte <= 0x7F && byte != 0x0E && byte != 0x0F && byte != 0x1B && byte != 0x5C && byte != 0x7E) {
                m_iso2022JPOutput = false;
                result.append(byte);
                break;
            }
            m_iso2022JPOutput = false;
            return SawError::Yes;
        case ISO2022JPDecoderState::Katakana:
            if (byte == 0x1B) {
                m_iso2022JPDecoderState = ISO2022JPDecoderState::EscapeStart;
                break;
            }
            if (byte >= 0x21 && byte <= 0x5F) {
                m_iso2022JPOutput = false;
                result.append(static_cast<char16_t>(0xFF61 - 0x21 + byte));
                break;
            }
            m_iso2022JPOutput = false;
            return SawError::Yes;
        case ISO2022JPDecoderState::LeadByte:
            if (byte == 0x1B) {
                m_iso2022JPDecoderState = ISO2022JPDecoderState::EscapeStart;
                break;
            }
            if (byte >= 0x21 && byte <= 0x7E) {
                m_iso2022JPOutput = false;
                m_lead = byte;
                m_iso2022JPDecoderState = ISO2022JPDecoderState::TrailByte;
                break;
            }
            m_iso2022JPOutput = false;
            return SawError::Yes;
        case ISO2022JPDecoderState::TrailByte:
            if (byte == 0x1B) {
                m_iso2022JPDecoderState = ISO2022JPDecoderState::EscapeStart;
                return SawError::Yes;
            }
            m_iso2022JPDecoderState = ISO2022JPDecoderState::LeadByte;
            if (byte >= 0x21 && byte <= 0x7E) {
                uint16_t pointer = (m_lead - 0x21) * 94 + byte - 0x21;
                if (auto codePoint = codePointJIS0208(pointer)) {
                    result.append(*codePoint);
                    break;
                }
                return SawError::Yes;
            }
            return SawError::Yes;
        case ISO2022JPDecoderState::EscapeStart:
            if (byte == 0x24 || byte == 0x28) {
                m_lead = byte;
                m_iso2022JPDecoderState = ISO2022JPDecoderState::Escape;
                break;
            }
            m_prependedByte = byte;
            m_iso2022JPOutput = false;
            m_iso2022JPDecoderState = m_iso2022JPDecoderOutputState;
            return SawError::Yes;
        case ISO2022JPDecoderState::Escape: {
            uint8_t lead = std::exchange(m_lead, 0x00);
            std::optional<ISO2022JPDecoderState> state;
            if (lead == 0x28) {
                if (byte == 0x42)
                    state = ISO2022JPDecoderState::ASCII;
                else if (byte == 0x4A)
                    state = ISO2022JPDecoderState::Roman;
                else if (byte == 0x49)
                    state = ISO2022JPDecoderState::Katakana;
            } else if (lead == 0x24 && (byte == 0x40 || byte == 0x42))
                state = ISO2022JPDecoderState::LeadByte;
            if (state) {
                m_iso2022JPDecoderState = *state;
                m_iso2022JPDecoderOutputState = *state;
                if (std::exchange(m_iso2022JPOutput, true))
                    return SawError::Yes;
                break;
            }
            m_prependedByte = lead;
            m_iso2022JPSecondPrependedByte = byte;
            m_iso2022JPOutput = false;
            m_iso2022JPDecoderState = m_iso2022JPDecoderOutputState;
            return SawError::Yes;
        }
        }
        return SawError::No;
    };

    StringBuilder result;
    result.reserveCapacity(bytes.size());

    if (m_prependedByte && byteParser(*std::exchange(m_prependedByte, std::nullopt), result) == SawError::Yes) {
        sawError = true;
        result.append(replacementCharacter);
        if (stopOnError) {
            m_lead = 0x00;
            return result.toString();
        }
    }
    if (m_iso2022JPSecondPrependedByte && byteParser(*std::exchange(m_iso2022JPSecondPrependedByte, std::nullopt), result) == SawError::Yes) {
        sawError = true;
        result.append(replacementCharacter);
        if (stopOnError) {
            m_lead = 0x00;
            return result.toString();
        }
    }
    for (auto byte : bytes) {
        if (byteParser(byte, result) == SawError::Yes) {
            sawError = true;
            result.append(replacementCharacter);
            if (stopOnError) {
                m_lead = 0x00;
                return result.toString();
            }
        }
        if (m_prependedByte && byteParser(*std::exchange(m_prependedByte, std::nullopt), result) == SawError::Yes) {
            sawError = true;
            result.append(replacementCharacter);
            if (stopOnError) {
                m_lead = 0x00;
                return result.toString();
            }
        }
        if (m_iso2022JPSecondPrependedByte && byteParser(*std::exchange(m_iso2022JPSecondPrependedByte, std::nullopt), result) == SawError::Yes) {
            sawError = true;
            result.append(replacementCharacter);
            if (stopOnError) {
                m_lead = 0x00;
                return result.toString();
            }
        }
    }

    if (flush) {
        switch (m_iso2022JPDecoderState) {
        case ISO2022JPDecoderState::ASCII:
        case ISO2022JPDecoderState::Roman:
        case ISO2022JPDecoderState::Katakana:
        case ISO2022JPDecoderState::LeadByte:
            break;
        case ISO2022JPDecoderState::TrailByte:
        case ISO2022JPDecoderState::EscapeStart:
            sawError = true;
            result.append(replacementCharacter);
            break;
        case ISO2022JPDecoderState::Escape: {
            uint8_t lead = std::exchange(m_lead, 0x00);
            // Set output state before calling byteParser, which reads these.
            m_iso2022JPOutput = false;
            m_iso2022JPDecoderState = m_iso2022JPDecoderOutputState;
            sawError = true;
            result.append(replacementCharacter);
            // Reprocess lead byte (always 0x24 or 0x28) in output state.
            if (!stopOnError && lead) {
                byteParser(lead, result);
                if (m_iso2022JPDecoderState == ISO2022JPDecoderState::TrailByte)
                    result.append(replacementCharacter);
            }
            break;
        }
        }
        m_iso2022JPDecoderState = ISO2022JPDecoderState::ASCII;
        m_iso2022JPDecoderOutputState = ISO2022JPDecoderState::ASCII;
        m_iso2022JPOutput = false;
        m_lead = 0x00;
        m_prependedByte = std::nullopt;
        m_iso2022JPSecondPrependedByte = std::nullopt;
    }

    return result.toString();
}

// https://encoding.spec.whatwg.org/#shift_jis-decoder
String TextCodecCJK::shiftJISDecode(std::span<const uint8_t> bytes, bool flush, bool stopOnError, bool& sawError)
{
    return decodeCommon(bytes, flush, stopOnError, sawError, [this](uint8_t byte, StringBuilder& result) {
        if (uint8_t lead = std::exchange(m_lead, 0x00)) {
            uint8_t offset = byte < 0x7F ? 0x40 : 0x41;
            uint8_t leadOffset = lead < 0xA0 ? 0x81 : 0xC1;
            if ((byte >= 0x40 && byte <= 0x7E) || (byte >= 0x80 && byte <= 0xFC)) {
                uint16_t pointer = (lead - leadOffset) * 188 + byte - offset;
                if (pointer >= 8836 && pointer <= 10715) {
                    result.append(static_cast<char16_t>(0xE000 - 8836 + pointer));
                    return SawError::No;
                }
                if (auto codePoint = codePointJIS0208(pointer)) {
                    result.append(*codePoint);
                    return SawError::No;
                }
            }
            if (isASCII(byte))
                m_prependedByte = byte;
            return SawError::Yes;
        }
        if (isASCII(byte) || byte == 0x80) {
            result.append(byte);
            return SawError::No;
        }
        if (byte >= 0xA1 && byte <= 0xDF) {
            result.append(static_cast<char16_t>(0xFF61 - 0xA1 + byte));
            return SawError::No;
        }
        if ((byte >= 0x81 && byte <= 0x9F) || (byte >= 0xE0 && byte <= 0xFC)) {
            m_lead = byte;
            return SawError::No;
        }
        return SawError::Yes;
    });
}

// https://encoding.spec.whatwg.org/#euc-kr-decoder
String TextCodecCJK::eucKRDecode(std::span<const uint8_t> bytes, bool flush, bool stopOnError, bool& sawError)
{
    return decodeCommon(bytes, flush, stopOnError, sawError, [this](uint8_t byte, StringBuilder& result) {
        if (uint8_t lead = std::exchange(m_lead, 0x00)) {
            if (byte >= 0x41 && byte <= 0xFE) {
                if (auto codePoint = findFirstInSortedPairs(eucKR(), (lead - 0x81) * 190 + byte - 0x41)) {
                    result.append(*codePoint);
                    return SawError::No;
                }
            }
            if (isASCII(byte))
                m_prependedByte = byte;
            return SawError::Yes;
        }
        if (isASCII(byte)) {
            result.append(byte);
            return SawError::No;
        }
        if (byte >= 0x81 && byte <= 0xFE) {
            m_lead = byte;
            return SawError::No;
        }
        return SawError::Yes;
    });
}

// https://encoding.spec.whatwg.org/index-gb18030-ranges.txt
static const std::array<std::pair<uint32_t, char32_t>, 207>& gb18030Ranges()
{
    static std::array<std::pair<uint32_t, char32_t>, 207> ranges { { { 0, 0x0080 }, { 36, 0x00A5 }, { 38, 0x00A9 }, { 45, 0x00B2 }, { 50, 0x00B8 }, { 81, 0x00D8 }, { 89, 0x00E2 }, { 95, 0x00EB },
        { 96, 0x00EE }, { 100, 0x00F4 }, { 103, 0x00F8 }, { 104, 0x00FB }, { 105, 0x00FD }, { 109, 0x0102 }, { 126, 0x0114 }, { 133, 0x011C },
        { 148, 0x012C }, { 172, 0x0145 }, { 175, 0x0149 }, { 179, 0x014E }, { 208, 0x016C }, { 306, 0x01CF }, { 307, 0x01D1 }, { 308, 0x01D3 },
        { 309, 0x01D5 }, { 310, 0x01D7 }, { 311, 0x01D9 }, { 312, 0x01DB }, { 313, 0x01DD }, { 341, 0x01FA }, { 428, 0x0252 }, { 443, 0x0262 },
        { 544, 0x02C8 }, { 545, 0x02CC }, { 558, 0x02DA }, { 741, 0x03A2 }, { 742, 0x03AA }, { 749, 0x03C2 }, { 750, 0x03CA }, { 805, 0x0402 },
        { 819, 0x0450 }, { 820, 0x0452 }, { 7922, 0x2011 }, { 7924, 0x2017 }, { 7925, 0x201A }, { 7927, 0x201E }, { 7934, 0x2027 }, { 7943, 0x2031 },
        { 7944, 0x2034 }, { 7945, 0x2036 }, { 7950, 0x203C }, { 8062, 0x20AD }, { 8148, 0x2104 }, { 8149, 0x2106 }, { 8152, 0x210A }, { 8164, 0x2117 },
        { 8174, 0x2122 }, { 8236, 0x216C }, { 8240, 0x217A }, { 8262, 0x2194 }, { 8264, 0x219A }, { 8374, 0x2209 }, { 8380, 0x2210 }, { 8381, 0x2212 },
        { 8384, 0x2216 }, { 8388, 0x221B }, { 8390, 0x2221 }, { 8392, 0x2224 }, { 8393, 0x2226 }, { 8394, 0x222C }, { 8396, 0x222F }, { 8401, 0x2238 },
        { 8406, 0x223E }, { 8416, 0x2249 }, { 8419, 0x224D }, { 8424, 0x2253 }, { 8437, 0x2262 }, { 8439, 0x2268 }, { 8445, 0x2270 }, { 8482, 0x2296 },
        { 8485, 0x229A }, { 8496, 0x22A6 }, { 8521, 0x22C0 }, { 8603, 0x2313 }, { 8936, 0x246A }, { 8946, 0x249C }, { 9046, 0x254C }, { 9050, 0x2574 },
        { 9063, 0x2590 }, { 9066, 0x2596 }, { 9076, 0x25A2 }, { 9092, 0x25B4 }, { 9100, 0x25BE }, { 9108, 0x25C8 }, { 9111, 0x25CC }, { 9113, 0x25D0 },
        { 9131, 0x25E6 }, { 9162, 0x2607 }, { 9164, 0x260A }, { 9218, 0x2641 }, { 9219, 0x2643 }, { 11329, 0x2E82 }, { 11331, 0x2E85 }, { 11334, 0x2E89 },
        { 11336, 0x2E8D }, { 11346, 0x2E98 }, { 11361, 0x2EA8 }, { 11363, 0x2EAB }, { 11366, 0x2EAF }, { 11370, 0x2EB4 }, { 11372, 0x2EB8 }, { 11375, 0x2EBC },
        { 11389, 0x2ECB }, { 11682, 0x2FFC }, { 11686, 0x3004 }, { 11687, 0x3018 }, { 11692, 0x301F }, { 11694, 0x302A }, { 11714, 0x303F }, { 11716, 0x3094 },
        { 11723, 0x309F }, { 11725, 0x30F7 }, { 11730, 0x30FF }, { 11736, 0x312A }, { 11982, 0x322A }, { 11989, 0x3232 }, { 12102, 0x32A4 }, { 12336, 0x3390 },
        { 12348, 0x339F }, { 12350, 0x33A2 }, { 12384, 0x33C5 }, { 12393, 0x33CF }, { 12395, 0x33D3 }, { 12397, 0x33D6 }, { 12510, 0x3448 }, { 12553, 0x3474 },
        { 12851, 0x359F }, { 12962, 0x360F }, { 12973, 0x361B }, { 13738, 0x3919 }, { 13823, 0x396F }, { 13919, 0x39D1 }, { 13933, 0x39E0 }, { 14080, 0x3A74 },
        { 14298, 0x3B4F }, { 14585, 0x3C6F }, { 14698, 0x3CE1 }, { 15583, 0x4057 }, { 15847, 0x4160 }, { 16318, 0x4338 }, { 16434, 0x43AD }, { 16438, 0x43B2 },
        { 16481, 0x43DE }, { 16729, 0x44D7 }, { 17102, 0x464D }, { 17122, 0x4662 }, { 17315, 0x4724 }, { 17320, 0x472A }, { 17402, 0x477D }, { 17418, 0x478E },
        { 17859, 0x4948 }, { 17909, 0x497B }, { 17911, 0x497E }, { 17915, 0x4984 }, { 17916, 0x4987 }, { 17936, 0x499C }, { 17939, 0x49A0 }, { 17961, 0x49B8 },
        { 18664, 0x4C78 }, { 18703, 0x4CA4 }, { 18814, 0x4D1A }, { 18962, 0x4DAF }, { 19043, 0x9FA6 }, { 33469, 0xE76C }, { 33470, 0xE7C8 }, { 33471, 0xE7E7 },
        { 33484, 0xE815 }, { 33485, 0xE819 }, { 33490, 0xE81F }, { 33497, 0xE827 }, { 33501, 0xE82D }, { 33505, 0xE833 }, { 33513, 0xE83C }, { 33520, 0xE844 },
        { 33536, 0xE856 }, { 33550, 0xE865 }, { 37845, 0xF92D }, { 37921, 0xF97A }, { 37948, 0xF996 }, { 38029, 0xF9E8 }, { 38038, 0xF9F2 }, { 38064, 0xFA10 },
        { 38065, 0xFA12 }, { 38066, 0xFA15 }, { 38069, 0xFA19 }, { 38075, 0xFA22 }, { 38076, 0xFA25 }, { 38078, 0xFA2A }, { 39108, 0xFE32 }, { 39109, 0xFE45 },
        { 39113, 0xFE53 }, { 39114, 0xFE58 }, { 39115, 0xFE67 }, { 39116, 0xFE6C }, { 39265, 0xFF5F }, { 39394, 0xFFE6 }, { 189000, 0x10000 } } };
    return ranges;
}

// https://encoding.spec.whatwg.org/#index-gb18030-ranges-code-point
static std::optional<char32_t> gb18030RangesCodePoint(uint32_t pointer)
{
    if ((pointer > 39419 && pointer < 189000) || pointer > 1237575)
        return std::nullopt;
    if (pointer == 7457)
        return 0xE7C7;
    auto& ranges = gb18030Ranges();
    auto upperBound = std::ranges::upper_bound(ranges, makeFirstAdapter(pointer), CompareFirst {});
    ASSERT(upperBound != ranges.begin());
    auto [offset, codePointOffset] = ranges[upperBound - ranges.begin() - 1];
    return codePointOffset + pointer - offset;
}

// https://encoding.spec.whatwg.org/#gb18030-decoder
String TextCodecCJK::gb18030Decode(std::span<const uint8_t> bytes, bool flush, bool stopOnError, bool& sawError)
{
    Function<SawError(uint8_t, StringBuilder&)> parseByte;
    parseByte = [&](uint8_t byte, StringBuilder& result) {
        if (m_gb18030Third) {
            if (byte < 0x30 || byte > 0x39) {
                sawError = true;
                result.append(replacementCharacter);
                m_gb18030First = 0x00;
                uint8_t second = std::exchange(m_gb18030Second, 0x00);
                uint8_t third = std::exchange(m_gb18030Third, 0x00);
                if (parseByte(second, result) == SawError::Yes) {
                    sawError = true;
                    result.append(replacementCharacter);
                }
                if (parseByte(third, result) == SawError::Yes) {
                    sawError = true;
                    result.append(replacementCharacter);
                }
                return parseByte(byte, result);
            }
            uint8_t first = std::exchange(m_gb18030First, 0x00);
            uint8_t second = std::exchange(m_gb18030Second, 0x00);
            uint8_t third = std::exchange(m_gb18030Third, 0x00);
            if (auto codePoint = gb18030RangesCodePoint(((first - 0x81) * 10 * 126 * 10) + ((second - 0x30) * 10 * 126) + ((third - 0x81) * 10) + byte - 0x30)) {
                result.append(*codePoint);
                return SawError::No;
            }
            return SawError::Yes;
        }
        if (m_gb18030Second) {
            if (byte >= 0x81 && byte <= 0xFE) {
                m_gb18030Third = byte;
                return SawError::No;
            }
            sawError = true;
            result.append(replacementCharacter);
            m_gb18030First = 0x00;
            if (parseByte(std::exchange(m_gb18030Second, 0x00), result) == SawError::Yes) {
                sawError = true;
                result.append(replacementCharacter);
            }
            return parseByte(byte, result);
        }
        if (m_gb18030First) {
            if (byte >= 0x30 && byte <= 0x39) {
                m_gb18030Second = byte;
                return SawError::No;
            }
            uint8_t lead = std::exchange(m_gb18030First, 0x00);
            uint8_t offset = byte < 0x7F ? 0x40 : 0x41;
            if ((byte >= 0x40 && byte <= 0x7E) || (byte >= 0x80 && byte <= 0xFE)) {
                size_t pointer = (lead - 0x81) * 190 + byte - offset;
                if (pointer < gb18030().size()) {
                    result.append(gb18030()[pointer]);
                    return SawError::No;
                }
            }
            if (isASCII(byte))
                m_prependedByte = byte;
            return SawError::Yes;
        }
        if (isASCII(byte)) {
            result.append(byte);
            return SawError::No;
        }
        if (byte == 0x80) {
            result.append(u'\u20AC');
            return SawError::No;
        }
        if (byte >= 0x81 && byte <= 0xFE) {
            m_gb18030First = byte;
            return SawError::No;
        }
        return SawError::Yes;
    };

    auto result = decodeCommon(bytes, flush, stopOnError, sawError, parseByte);
    if (flush && (m_gb18030First || m_gb18030Second || m_gb18030Third)) {
        m_gb18030First = 0x00;
        m_gb18030Second = 0x00;
        m_gb18030Third = 0x00;
        sawError = true;
        result = makeString(result, replacementCharacter);
    }
    return result;
}

// https://encoding.spec.whatwg.org/#gbk-decoder
String TextCodecCJK::gbkDecode(std::span<const uint8_t> bytes, bool flush, bool stopOnError, bool& sawError)
{
    return gb18030Decode(bytes, flush, stopOnError, sawError);
}

String TextCodecCJK::big5Decode(std::span<const uint8_t> bytes, bool flush, bool stopOnError, bool& sawError)
{
    return decodeCommon(bytes, flush, stopOnError, sawError, [this](uint8_t byte, StringBuilder& result) {
        if (uint8_t lead = std::exchange(m_lead, 0x00)) {
            uint8_t offset = byte < 0x7F ? 0x40 : 0x62;
            if ((byte >= 0x40 && byte <= 0x7E) || (byte >= 0xA1 && byte <= 0xFE)) {
                uint16_t pointer = (lead - 0x81) * 157 + (byte - offset);
                if (pointer == 1133)
                    result.append(u'\u00CA', u'\u0304');
                else if (pointer == 1135)
                    result.append(u'\u00CA', u'\u030C');
                else if (pointer == 1164)
                    result.append(u'\u00EA', u'\u0304');
                else if (pointer == 1166)
                    result.append(u'\u00EA', u'\u030C');
                else {
                    if (auto codePoint = findFirstInSortedPairs(big5(), pointer))
                        result.append(*codePoint);
                    else {
                        // https://encoding.spec.whatwg.org/#big5-decoder step 3.6:
                        // restore an ASCII trail byte even when the pointer
                        // itself was in range but had no entry in index Big5.
                        if (isASCII(byte))
                            m_prependedByte = byte;
                        return SawError::Yes;
                    }
                }
                return SawError::No;
            }
            if (isASCII(byte))
                m_prependedByte = byte;
            return SawError::Yes;
        }
        if (isASCII(byte)) {
            result.append(byteCast<char>(byte));
            return SawError::No;
        }
        if (byte >= 0x81 && byte <= 0xFE) {
            m_lead = byte;
            return SawError::No;
        }
        return SawError::Yes;
    });
}

String TextCodecCJK::decode(std::span<const uint8_t> bytes, bool flush, bool stopOnError, bool& sawError)
{
    switch (m_encoding) {
    case Encoding::EUC_JP:
        return eucJPDecode(bytes, flush, stopOnError, sawError);
    case Encoding::Shift_JIS:
        return shiftJISDecode(bytes, flush, stopOnError, sawError);
    case Encoding::ISO2022JP:
        return iso2022JPDecode(bytes, flush, stopOnError, sawError);
    case Encoding::EUC_KR:
        return eucKRDecode(bytes, flush, stopOnError, sawError);
    case Encoding::Big5:
        return big5Decode(bytes, flush, stopOnError, sawError);
    case Encoding::GBK:
        return gbkDecode(bytes, flush, stopOnError, sawError);
    case Encoding::GB18030:
        return gb18030Decode(bytes, flush, stopOnError, sawError);
    }
    ASSERT_NOT_REACHED();
    return {};
}

} // namespace PAL
