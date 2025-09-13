#include "root.h"

/*
 * Copyright (C) 2016-2017 Apple Inc. All rights reserved.
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
 * THIS SOFTWARE IS PROVIDED BY APPLE INC. AND ITS CONTRIBUTORS ``AS IS''
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO,
 * THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL APPLE INC. OR ITS CONTRIBUTORS
 * BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 * CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 * SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
 * INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
 * CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF
 * THE POSSIBILITY OF SUCH DAMAGE.
 */

// config.h removed - not needed in Bun
#include "TextCodecReplacement.h"

#include <wtf/Function.h>
#include <wtf/TZoneMallocInlines.h>
#include <wtf/text/WTFString.h>
#include <wtf/unicode/CharacterNames.h>

namespace PAL {

WTF_MAKE_TZONE_ALLOCATED_IMPL(TextCodecReplacement);

void TextCodecReplacement::registerEncodingNames(EncodingNameRegistrar registrar)
{
    registrar("replacement"_s, "replacement"_s);

    registrar("csiso2022kr"_s, "replacement"_s);
    registrar("hz-gb-2312"_s, "replacement"_s);
    registrar("iso-2022-cn"_s, "replacement"_s);
    registrar("iso-2022-cn-ext"_s, "replacement"_s);
    registrar("iso-2022-kr"_s, "replacement"_s);
}

void TextCodecReplacement::registerCodecs(TextCodecRegistrar registrar)
{
    registrar("replacement"_s, [] {
        return makeUnique<TextCodecReplacement>();
    });
}

String TextCodecReplacement::decode(std::span<const uint8_t>, bool, bool, bool& sawError)
{
    sawError = true;
    if (m_sentEOF)
        return emptyString();
    m_sentEOF = true;
    return span(replacementCharacter);
}

Vector<uint8_t> TextCodecReplacement::encode(StringView string, UnencodableHandling) const
{
    // Replacement encoding always fails to encode
    // Return empty vector as encoding is not supported
    UNUSED_PARAM(string);
    return Vector<uint8_t>();
}

} // namespace PAL
