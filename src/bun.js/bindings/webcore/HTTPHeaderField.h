/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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

#pragma once

#include <wtf/text/WTFString.h>

namespace WebCore {

class WEBCORE_EXPORT HTTPHeaderField {
public:
    static std::optional<HTTPHeaderField> create(String&& name, String&& value);

    const String& name() const { return m_name; }
    const String& value() const { return m_value; }

    template<class Encoder> void encode(Encoder&) const;
    template<class Decoder> static std::optional<HTTPHeaderField> decode(Decoder&);

private:
    HTTPHeaderField(String&& name, String&& value)
        : m_name(WTFMove(name))
        , m_value(WTFMove(value))
    {
    }
    String m_name;
    String m_value;
};

template<class Encoder>
void HTTPHeaderField::encode(Encoder& encoder) const
{
    encoder << m_name;
    encoder << m_value;
}

template<class Decoder>
std::optional<HTTPHeaderField> HTTPHeaderField::decode(Decoder& decoder)
{
    std::optional<String> name;
    decoder >> name;
    if (!name)
        return std::nullopt;

    std::optional<String> value;
    decoder >> value;
    if (!value)
        return std::nullopt;

    return { { WTFMove(*name), WTFMove(*value) } };
}

namespace RFC7230 {
bool isTokenCharacter(UChar);
bool isWhitespace(UChar);
bool isTokenCharacter(LChar);
bool isWhitespace(LChar);
bool isCommentText(UChar);
bool isQuotedPairSecondOctet(UChar);
bool isDelimiter(UChar);
} // namespace RFC7230

} // namespace WebCore
