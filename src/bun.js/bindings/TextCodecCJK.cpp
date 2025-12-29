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
#include <mutex>
#include <ranges>
#include <wtf/TZoneMallocInlines.h>
#include <wtf/text/CodePointIterator.h>
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

using JIS0208EncodeIndex = std::array<std::pair<char16_t, uint16_t>, sizeof(jis0208()) / sizeof(jis0208()[0])>;
static const JIS0208EncodeIndex& jis0208EncodeIndex()
{
    // Allocate this at runtime because building it at compile time would make the binary much larger and this is often not used.
    static JIS0208EncodeIndex* table;
    static std::once_flag once;
    std::call_once(once, [&] {
        table = new JIS0208EncodeIndex;
        auto& index = jis0208();
        for (size_t i = 0; i < index.size(); i++)
            (*table)[i] = { index[i].second, index[i].first };
        stableSortByFirst(*table);
    });
    return *table;
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
    return decodeCommon(bytes, flush, stopOnError, sawError, [this](uint8_t byte, StringBuilder& result) {
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
            if (lead >= 0xA1 && lead <= 0xFE && byte >= 0xA1 && byte <= 0xFE) {
                uint16_t pointer = (lead - 0xA1) * 94 + byte - 0xA1;
                if (auto codePoint = std::exchange(m_jis0212, false) ? codePointJIS0212(pointer) : codePointJIS0208(pointer)) {
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
}

// https://encoding.spec.whatwg.org/#euc-jp-encoder
static Vector<uint8_t> eucJPEncode(StringView string, Function<void(char32_t, Vector<uint8_t>&)>&& unencodableHandler)
{
    Vector<uint8_t> result;
    result.reserveInitialCapacity(string.length());

    auto characters = string.upconvertedCharacters();
    for (WTF::CodePointIterator<char16_t> iterator(characters); !iterator.atEnd(); ++iterator) {
        auto codePoint = *iterator;
        if (isASCII(codePoint)) {
            result.append(codePoint);
            continue;
        }
        if (codePoint == 0x00A5) {
            result.append(0x5C);
            continue;
        }
        if (codePoint == 0x203E) {
            result.append(0x7E);
            continue;
        }
        if (codePoint >= 0xFF61 && codePoint <= 0xFF9F) {
            result.append(0x8E);
            result.append(codePoint - 0xFF61 + 0xA1);
            continue;
        }
        if (codePoint == 0x2212)
            codePoint = 0xFF0D;

        auto pointer = findFirstInSortedPairs(jis0208EncodeIndex(), codePoint);
        if (!pointer) {
            unencodableHandler(codePoint, result);
            continue;
        }
        result.append(*pointer / 94 + 0xA1);
        result.append(*pointer % 94 + 0xA1);
    }
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
    if (m_iso2022JPSecondPrependedByte && byteParser(*std::exchange(m_iso2022JPSecondPrependedByte, std::nullopt), result) == SawError::Yes && stopOnError) {
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
        if (m_iso2022JPSecondPrependedByte && byteParser(*std::exchange(m_iso2022JPSecondPrependedByte, std::nullopt), result) == SawError::Yes && stopOnError) {
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
            m_iso2022JPDecoderState = ISO2022JPDecoderState::LeadByte;
            [[fallthrough]];
        case ISO2022JPDecoderState::EscapeStart:
            sawError = true;
            result.append(replacementCharacter);
            break;
        case ISO2022JPDecoderState::Escape:
            sawError = true;
            result.append(replacementCharacter);
            if (m_lead) {
                ASSERT(isASCII(m_lead));
                result.append(std::exchange(m_lead, 0x00));
            }
            break;
        }
    }

    return result.toString();
}

// https://encoding.spec.whatwg.org/#iso-2022-jp-encoder
static Vector<uint8_t> iso2022JPEncode(StringView string, Function<void(char32_t, Vector<uint8_t>&)>&& unencodableHandler)
{
    enum class State : uint8_t { ASCII,
        Roman,
        Jis0208 };
    State state { State::ASCII };

    Vector<uint8_t> result;
    result.reserveInitialCapacity(string.length());

    auto changeStateToASCII = [&] {
        state = State::ASCII;
        result.append(0x1B);
        result.append(0x28);
        result.append(0x42);
    };

    auto statefulUnencodableHandler = [&](char32_t codePoint, Vector<uint8_t>& result) {
        if (state == State::Jis0208)
            changeStateToASCII();
        unencodableHandler(codePoint, result);
    };

    Function<void(char32_t)> parseCodePoint;
    parseCodePoint = [&](char32_t codePoint) {
        if ((state == State::ASCII || state == State::Roman) && (codePoint == 0x000E || codePoint == 0x000F || codePoint == 0x001B)) {
            statefulUnencodableHandler(replacementCharacter, result);
            return;
        }
        if (state == State::ASCII && isASCII(codePoint)) {
            result.append(codePoint);
            return;
        }
        if (state == State::Roman) {
            if (isASCII(codePoint) && codePoint != 0x005C && codePoint != 0x007E) {
                result.append(codePoint);
                return;
            }
            if (codePoint == 0x00A5) {
                result.append(0x5C);
                return;
            }
            if (codePoint == 0x203E) {
                result.append(0x7E);
                return;
            }
        }
        if (isASCII(codePoint) && state != State::ASCII) {
            if (state != State::ASCII)
                changeStateToASCII();
            parseCodePoint(codePoint);
            return;
        }
        if ((codePoint == 0x00A5 || codePoint == 0x203E) && state != State::Roman) {
            state = State::Roman;
            result.append(0x1B);
            result.append(0x28);
            result.append(0x4A);
            parseCodePoint(codePoint);
            return;
        }
        if (codePoint == 0x2212)
            codePoint = 0xFF0D;
        if (codePoint >= 0xFF61 && codePoint <= 0xFF9F) {
            // From https://encoding.spec.whatwg.org/index-iso-2022-jp-katakana.txt
            static constexpr std::array<char32_t, 63> iso2022JPKatakana {
                0x3002, 0x300C, 0x300D, 0x3001, 0x30FB, 0x30F2, 0x30A1, 0x30A3, 0x30A5, 0x30A7, 0x30A9, 0x30E3, 0x30E5, 0x30E7, 0x30C3, 0x30FC,
                0x30A2, 0x30A4, 0x30A6, 0x30A8, 0x30AA, 0x30AB, 0x30AD, 0x30AF, 0x30B1, 0x30B3, 0x30B5, 0x30B7, 0x30B9, 0x30BB, 0x30BD, 0x30BF,
                0x30C1, 0x30C4, 0x30C6, 0x30C8, 0x30CA, 0x30CB, 0x30CC, 0x30CD, 0x30CE, 0x30CF, 0x30D2, 0x30D5, 0x30D8, 0x30DB, 0x30DE, 0x30DF,
                0x30E0, 0x30E1, 0x30E2, 0x30E4, 0x30E6, 0x30E8, 0x30E9, 0x30EA, 0x30EB, 0x30EC, 0x30ED, 0x30EF, 0x30F3, 0x309B, 0x309C
            };
            static_assert(std::size(iso2022JPKatakana) == 0xFF9F - 0xFF61 + 1);
            codePoint = iso2022JPKatakana[codePoint - 0xFF61];
        }

        auto pointer = findFirstInSortedPairs(jis0208EncodeIndex(), codePoint);
        if (!pointer) {
            statefulUnencodableHandler(codePoint, result);
            return;
        }
        if (state != State::Jis0208) {
            state = State::Jis0208;
            result.append(0x1B);
            result.append(0x24);
            result.append(0x42);
            parseCodePoint(codePoint);
            return;
        }
        result.append(*pointer / 94 + 0x21);
        result.append(*pointer % 94 + 0x21);
    };

    auto characters = string.upconvertedCharacters();
    for (WTF::CodePointIterator<char16_t> iterator(characters); !iterator.atEnd(); ++iterator)
        parseCodePoint(*iterator);

    if (state != State::ASCII)
        changeStateToASCII();

    return result;
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

// https://encoding.spec.whatwg.org/#shift_jis-encoder
static Vector<uint8_t> shiftJISEncode(StringView string, Function<void(char32_t, Vector<uint8_t>&)>&& unencodableHandler)
{
    Vector<uint8_t> result;
    result.reserveInitialCapacity(string.length());

    auto characters = string.upconvertedCharacters();
    for (WTF::CodePointIterator<char16_t> iterator(characters); !iterator.atEnd(); ++iterator) {
        auto codePoint = *iterator;
        if (isASCII(codePoint) || codePoint == 0x0080) {
            result.append(codePoint);
            continue;
        }
        if (codePoint == 0x00A5) {
            result.append(0x5C);
            continue;
        }
        if (codePoint == 0x203E) {
            result.append(0x7E);
            continue;
        }
        if (codePoint >= 0xFF61 && codePoint <= 0xFF9F) {
            result.append(codePoint - 0xFF61 + 0xA1);
            continue;
        }
        if (codePoint == 0x2212)
            codePoint = 0xFF0D;

        auto range = findInSortedPairs(jis0208EncodeIndex(), codePoint);
        if (range.empty()) {
            unencodableHandler(codePoint, result);
            continue;
        }

        ASSERT(range.size() <= 3);
        for (auto& pair : range) {
            uint16_t pointer = pair.second;
            if (pointer >= 8272 && pointer <= 8835)
                continue;
            uint8_t lead = pointer / 188;
            uint8_t leadOffset = lead < 0x1F ? 0x81 : 0xC1;
            uint8_t trail = pointer % 188;
            uint8_t offset = trail < 0x3F ? 0x40 : 0x41;
            result.append(lead + leadOffset);
            result.append(trail + offset);
            break;
        }
    }
    return result;
}

using EUCKREncodingIndex = std::array<std::pair<char16_t, uint16_t>, sizeof(eucKR()) / sizeof(eucKR()[0])>;
static const EUCKREncodingIndex& eucKREncodingIndex()
{
    // Allocate this at runtime because building it at compile time would make the binary much larger and this is often not used.
    static EUCKREncodingIndex* table;
    static std::once_flag once;
    std::call_once(once, [&] {
        table = new EUCKREncodingIndex;
        auto& index = eucKR();
        for (size_t i = 0; i < index.size(); i++)
            (*table)[i] = { index[i].second, index[i].first };
        sortByFirst(*table);
        ASSERT(sortedFirstsAreUnique(*table));
    });
    return *table;
}

// https://encoding.spec.whatwg.org/#euc-kr-encoder
static Vector<uint8_t> eucKREncode(StringView string, Function<void(char32_t, Vector<uint8_t>&)>&& unencodableHandler)
{
    Vector<uint8_t> result;
    result.reserveInitialCapacity(string.length());

    auto characters = string.upconvertedCharacters();
    for (WTF::CodePointIterator<char16_t> iterator(characters); !iterator.atEnd(); ++iterator) {
        auto codePoint = *iterator;
        if (isASCII(codePoint)) {
            result.append(codePoint);
            continue;
        }

        auto pointer = findFirstInSortedPairs(eucKREncodingIndex(), codePoint);
        if (!pointer) {
            unencodableHandler(codePoint, result);
            continue;
        }
        result.append(*pointer / 190 + 0x81);
        result.append(*pointer % 190 + 0x41);
    }
    return result;
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

using Big5EncodeIndex = std::array<std::pair<char32_t, uint16_t>, sizeof(big5()) / sizeof(big5()[0]) - 3904>;
static const Big5EncodeIndex& big5EncodeIndex()
{
    // Allocate this at runtime because building it at compile time would make the binary much larger and this is often not used.
    static Big5EncodeIndex* table;
    static std::once_flag once;
    std::call_once(once, [&] {
        table = new Big5EncodeIndex;
        auto& index = big5();
        // Remove the first 3094 elements because of https://encoding.spec.whatwg.org/#index-big5-pointer
        ASSERT(index[3903].first == (0xA1 - 0x81) * 157 - 1);
        ASSERT(index[3904].first == (0xA1 - 0x81) * 157);
        for (size_t i = 3904; i < index.size(); i++)
            (*table)[i - 3904] = { index[i].second, index[i].first };
        stableSortByFirst(*table);
    });
    return *table;
}

// https://encoding.spec.whatwg.org/#big5-encoder
static Vector<uint8_t> big5Encode(StringView string, Function<void(char32_t, Vector<uint8_t>&)>&& unencodableHandler)
{
    Vector<uint8_t> result;
    result.reserveInitialCapacity(string.length());

    auto characters = string.upconvertedCharacters();
    for (WTF::CodePointIterator<char16_t> iterator(characters); !iterator.atEnd(); ++iterator) {
        auto codePoint = *iterator;
        if (isASCII(codePoint)) {
            result.append(codePoint);
            continue;
        }

        auto range = findInSortedPairs(big5EncodeIndex(), codePoint);
        if (range.empty()) {
            unencodableHandler(codePoint, result);
            continue;
        }

        uint16_t pointer = 0;
        if (codePoint == 0x2550 || codePoint == 0x255E || codePoint == 0x2561 || codePoint == 0x256A || codePoint == 0x5341 || codePoint == 0x5345)
            pointer = range.back().second;
        else
            pointer = range.front().second;

        if (pointer < 157 * (0xA1 - 0x81)) {
            unencodableHandler(codePoint, result);
            continue;
        }

        uint8_t lead = pointer / 157 + 0x81;
        uint8_t trail = pointer % 157;
        uint8_t offset = trail < 0x3F ? 0x40 : 0x62;
        result.append(lead);
        result.append(trail + offset);
    }
    return result;
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

// https://encoding.spec.whatwg.org/#index-gb18030-ranges-pointer
static uint32_t gb18030RangesPointer(char32_t codePoint)
{
    if (codePoint == 0xE7C7)
        return 7457;
    auto& ranges = gb18030Ranges();
    auto upperBound = std::ranges::upper_bound(ranges, makeSecondAdapter(codePoint), CompareSecond {});
    ASSERT(upperBound != ranges.begin());
    auto [pointerOffset, offset] = ranges[upperBound - ranges.begin() - 1];
    return pointerOffset + codePoint - offset;
}

using GB18030EncodeIndex = std::array<std::pair<char16_t, uint16_t>, 23940>;
static const GB18030EncodeIndex& gb18030EncodeIndex()
{
    // Allocate this at runtime because building it at compile time would make the binary much larger and this is often not used.
    static GB18030EncodeIndex* table;
    static std::once_flag once;
    std::call_once(once, [&] {
        table = new GB18030EncodeIndex;
        auto& index = gb18030();
        for (uint16_t i = 0; i < index.size(); i++)
            (*table)[i] = { index[i], i };
        stableSortByFirst(*table);
    });
    return *table;
}

// https://unicode-org.atlassian.net/browse/ICU-22357
// The 2-byte values are handled correctly by values from gb18030()
// but these need to be exceptions from gb18030Ranges().
static std::optional<uint16_t> gb18030AsymmetricEncode(char16_t codePoint)
{
    switch (codePoint) {
    case 0xE81E:
        return 0xFE59;
    case 0xE826:
        return 0xFE61;
    case 0xE82B:
        return 0xFE66;
    case 0xE82C:
        return 0xFE67;
    case 0xE832:
        return 0xFE6D;
    case 0xE843:
        return 0xFE7E;
    case 0xE854:
        return 0xFE90;
    case 0xE864:
        return 0xFEA0;
    case 0xE78D:
        return 0xA6D9;
    case 0xE78F:
        return 0xA6DB;
    case 0xE78E:
        return 0xA6DA;
    case 0xE790:
        return 0xA6DC;
    case 0xE791:
        return 0xA6DD;
    case 0xE792:
        return 0xA6DE;
    case 0xE793:
        return 0xA6DF;
    case 0xE794:
        return 0xA6EC;
    case 0xE795:
        return 0xA6ED;
    case 0xE796:
        return 0xA6F3;
    }
    return std::nullopt;
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

// https://encoding.spec.whatwg.org/#gb18030-encoder
enum class IsGBK : bool { No,
    Yes };
static Vector<uint8_t> gbEncodeShared(StringView string, Function<void(char32_t, Vector<uint8_t>&)>&& unencodableHandler, IsGBK isGBK)
{
    Vector<uint8_t> result;
    result.reserveInitialCapacity(string.length());

    auto characters = string.upconvertedCharacters();
    for (WTF::CodePointIterator<char16_t> iterator(characters); !iterator.atEnd(); ++iterator) {
        auto codePoint = *iterator;
        if (isASCII(codePoint)) {
            result.append(codePoint);
            continue;
        }
        if (codePoint == 0xE5E5) {
            unencodableHandler(codePoint, result);
            continue;
        }
        if (isGBK == IsGBK::Yes && codePoint == 0x20AC) {
            result.append(0x80);
            continue;
        }
        if (auto encoded = gb18030AsymmetricEncode(codePoint)) {
            result.append(*encoded >> 8);
            result.append(*encoded);
            continue;
        }
        auto range = findInSortedPairs(gb18030EncodeIndex(), codePoint);
        if (!range.empty()) {
            uint16_t pointer = range[0].second;
            uint8_t lead = pointer / 190 + 0x81;
            uint8_t trail = pointer % 190;
            uint8_t offset = trail < 0x3F ? 0x40 : 0x41;
            result.append(lead);
            result.append(trail + offset);
            continue;
        }
        if (isGBK == IsGBK::Yes) {
            unencodableHandler(codePoint, result);
            continue;
        }
        uint32_t pointer = gb18030RangesPointer(codePoint);
        uint8_t byte1 = pointer / (10 * 126 * 10);
        pointer = pointer % (10 * 126 * 10);
        uint8_t byte2 = pointer / (10 * 126);
        pointer = pointer % (10 * 126);
        uint8_t byte3 = pointer / 10;
        uint8_t byte4 = pointer % 10;
        result.append(byte1 + 0x81);
        result.append(byte2 + 0x30);
        result.append(byte3 + 0x81);
        result.append(byte4 + 0x30);
    }
    return result;
}

static Vector<uint8_t> gb18030Encode(StringView string, Function<void(char32_t, Vector<uint8_t>&)>&& unencodableHandler)
{
    return gbEncodeShared(string, WTF::move(unencodableHandler), IsGBK::No);
}

// https://encoding.spec.whatwg.org/#gbk-decoder
String TextCodecCJK::gbkDecode(std::span<const uint8_t> bytes, bool flush, bool stopOnError, bool& sawError)
{
    return gb18030Decode(bytes, flush, stopOnError, sawError);
}

static Vector<uint8_t> gbkEncode(StringView string, Function<void(char32_t, Vector<uint8_t>&)>&& unencodableHandler)
{
    return gbEncodeShared(string, WTF::move(unencodableHandler), IsGBK::Yes);
}

constexpr size_t maxUChar32Digits = 10;

static void appendDecimal(char32_t c, Vector<uint8_t>& result)
{
    std::array<uint8_t, lengthOfIntegerAsString(std::numeric_limits<decltype(c)>::max())> buffer;
    writeIntegerToBuffer(c, std::span<uint8_t> { buffer });
    result.append(std::span { buffer }.first(lengthOfIntegerAsString(c)));
}

static void urlEncodedEntityUnencodableHandler(char32_t c, Vector<uint8_t>& result)
{
    result.reserveCapacity(result.size() + 9 + maxUChar32Digits);
    result.appendList({ '%', '2', '6', '%', '2', '3' });
    appendDecimal(c, result);
    result.appendList({ '%', '3', 'B' });
}

static void entityUnencodableHandler(char32_t c, Vector<uint8_t>& result)
{
    result.reserveCapacity(result.size() + 3 + maxUChar32Digits);
    result.appendList({ '&', '#' });
    appendDecimal(c, result);
    result.append(';');
}

Function<void(char32_t, Vector<uint8_t>&)> unencodableHandler(UnencodableHandling handling)
{
    switch (handling) {
    case UnencodableHandling::Entities:
        return entityUnencodableHandler;
    case UnencodableHandling::URLEncodedEntities:
        return urlEncodedEntityUnencodableHandler;
    }
    ASSERT_NOT_REACHED();
    return entityUnencodableHandler;
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
                    else
                        return SawError::Yes;
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

Vector<uint8_t> TextCodecCJK::encode(StringView string, UnencodableHandling handling) const
{
    switch (m_encoding) {
    case Encoding::EUC_JP:
        return eucJPEncode(string, unencodableHandler(handling));
    case Encoding::Shift_JIS:
        return shiftJISEncode(string, unencodableHandler(handling));
    case Encoding::ISO2022JP:
        return iso2022JPEncode(string, unencodableHandler(handling));
    case Encoding::EUC_KR:
        return eucKREncode(string, unencodableHandler(handling));
    case Encoding::Big5:
        return big5Encode(string, unencodableHandler(handling));
    case Encoding::GBK:
        return gbkEncode(string, unencodableHandler(handling));
    case Encoding::GB18030:
        return gb18030Encode(string, unencodableHandler(handling));
    }
    ASSERT_NOT_REACHED();
    return {};
}

} // namespace PAL
