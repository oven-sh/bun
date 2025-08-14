#include "root.h"

/*
 * Copyright (C) 2007-2017 Apple, Inc. All rights reserved.
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
#include "TextCodecUserDefined.h"

#include <array>
#include <wtf/TZoneMallocInlines.h>
#include <wtf/text/CString.h>
#include <wtf/text/StringBuilder.h>
#include <wtf/text/WTFString.h>

namespace PAL {

WTF_MAKE_TZONE_ALLOCATED_IMPL(TextCodecUserDefined);

void TextCodecUserDefined::registerEncodingNames(EncodingNameRegistrar registrar)
{
    registrar("x-user-defined"_s, "x-user-defined"_s);
}

void TextCodecUserDefined::registerCodecs(TextCodecRegistrar registrar)
{
    registrar("x-user-defined"_s, [] {
        return makeUnique<TextCodecUserDefined>();
    });
}

String TextCodecUserDefined::decode(std::span<const uint8_t> bytes, bool, bool, bool&)
{
    StringBuilder result;
    result.reserveCapacity(bytes.size());
    for (const uint8_t byte : bytes) {
        // x-user-defined maps 0x80-0xFF to U+F780-U+F7FF
        // ASCII range (0x00-0x7F) maps directly
        if (byte < 0x80)
            result.append(static_cast<char16_t>(byte));
        else
            result.append(static_cast<char16_t>(0xF700 | byte));
    }
    return result.toString();
}

static Vector<uint8_t> encodeComplexUserDefined(StringView string, UnencodableHandling handling)
{
    Vector<uint8_t> result;

    for (auto character : string.codePoints()) {
        int8_t signedByte = character;
        if ((signedByte & 0xF7FF) == character)
            result.append(signedByte);
        else {
            // No way to encode this character with x-user-defined.
            UnencodableReplacementArray replacement;
            result.append(TextCodec::getUnencodableReplacement(character, handling, replacement));
        }
    }

    return result;
}

Vector<uint8_t> TextCodecUserDefined::encode(StringView string, UnencodableHandling handling) const
{
    {
        Vector<uint8_t> result(string.length());
        size_t index = 0;

        // Convert and simultaneously do a check to see if it's all ASCII.
        char16_t ored = 0;
        for (auto character : string.codeUnits()) {
            result[index++] = character;
            ored |= character;
        }

        if (!(ored & 0xFF80))
            return result;
    }

    // If it wasn't all ASCII, call the function that handles more-complex cases.
    return encodeComplexUserDefined(string, handling);
}

} // namespace PAL
