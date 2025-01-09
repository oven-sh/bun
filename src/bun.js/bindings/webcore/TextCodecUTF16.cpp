/*
 * Copyright (C) 2004-2020 Apple Inc. All rights reserved.
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

#include "config.h"
#include "TextCodecUTF16.h"

#include <wtf/TZoneMallocInlines.h>
#include <wtf/text/CString.h>
#include <wtf/text/StringBuilder.h>
#include <wtf/text/WTFString.h>
#include <wtf/unicode/CharacterNames.h>

namespace PAL {

WTF_MAKE_TZONE_ALLOCATED_IMPL(TextCodecUTF16);

inline TextCodecUTF16::TextCodecUTF16(bool littleEndian)
    : m_littleEndian(littleEndian)
{
}

void TextCodecUTF16::registerEncodingNames(EncodingNameRegistrar registrar)
{
    registrar("UTF-16LE"_s, "UTF-16LE"_s);
    registrar("UTF-16BE"_s, "UTF-16BE"_s);

    registrar("ISO-10646-UCS-2"_s, "UTF-16LE"_s);
    registrar("UCS-2"_s, "UTF-16LE"_s);
    registrar("UTF-16"_s, "UTF-16LE"_s);
    registrar("Unicode"_s, "UTF-16LE"_s);
    registrar("csUnicode"_s, "UTF-16LE"_s);
    registrar("unicodeFEFF"_s, "UTF-16LE"_s);

    registrar("unicodeFFFE"_s, "UTF-16BE"_s);
}

void TextCodecUTF16::registerCodecs(TextCodecRegistrar registrar)
{
    registrar("UTF-16LE"_s, [] {
        return makeUnique<TextCodecUTF16>(true);
    });
    registrar("UTF-16BE"_s, [] {
        return makeUnique<TextCodecUTF16>(false);
    });
}

// https://encoding.spec.whatwg.org/#shared-utf-16-decoder
String TextCodecUTF16::decode(std::span<const uint8_t> bytes, bool flush, bool, bool& sawError)
{
    size_t index = 0;
    size_t lengthMinusOne = bytes.size() - 1;

    StringBuilder result;
    result.reserveCapacity(bytes.size() / 2);

    auto processCodeUnit = [&] (UChar codeUnit) {
        if (std::exchange(m_shouldStripByteOrderMark, false) && codeUnit == byteOrderMark)
            return;
        if (m_leadSurrogate) {
            auto leadSurrogate = *std::exchange(m_leadSurrogate, std::nullopt);
            if (U16_IS_TRAIL(codeUnit)) {
                char32_t codePoint = U16_GET_SUPPLEMENTARY(leadSurrogate, codeUnit);
                result.append(codePoint);
                return;
            }
            sawError = true;
            result.append(replacementCharacter);
        }
        if (U16_IS_LEAD(codeUnit)) {
            m_leadSurrogate = codeUnit;
            return;
        }
        if (U16_IS_TRAIL(codeUnit)) {
            sawError = true;
            result.append(replacementCharacter);
            return;
        }
        result.append(codeUnit);
    };
    auto processBytesLE = [&] (uint8_t first, uint8_t second) {
        processCodeUnit(first | (second << 8));
    };
    auto processBytesBE = [&] (uint8_t first, uint8_t second) {
        processCodeUnit((first << 8) | second);
    };

    if (!bytes.empty()) {
        if (m_leadByte && index < bytes.size()) {
            auto leadByte = *std::exchange(m_leadByte, std::nullopt);
            auto trailByte = bytes[index++];
            if (m_littleEndian)
                processBytesLE(leadByte, trailByte);
            else
                processBytesBE(leadByte, trailByte);
        }
        if (m_littleEndian) {
            for (; index < lengthMinusOne; index += 2)
                processBytesLE(bytes[index], bytes[index + 1]);
        } else {
            for (; index < lengthMinusOne; index += 2)
                processBytesBE(bytes[index], bytes[index + 1]);
        }

        if (index == lengthMinusOne) {
            ASSERT(!m_leadByte);
            m_leadByte = bytes[index];
        } else
            ASSERT(index == bytes.size());
    }

    if (flush) {
        m_shouldStripByteOrderMark = false;
        if (m_leadByte || m_leadSurrogate) {
            m_leadByte = std::nullopt;
            m_leadSurrogate = std::nullopt;
            sawError = true;
            result.append(replacementCharacter);
        }
    }

    return result.toString();
}

Vector<uint8_t> TextCodecUTF16::encode(StringView string, UnencodableHandling) const
{
    Vector<uint8_t> result(WTF::checkedProduct<size_t>(string.length(), 2));
    size_t index = 0;

    if (m_littleEndian) {
        for (auto character : string.codeUnits()) {
            result[index++] = character;
            result[index++] = character >> 8;
        }
    } else {
        for (auto character : string.codeUnits()) {
            result[index++] = character >> 8;
            result[index++] = character;
        }
    }

    return result;
}

} // namespace PAL
