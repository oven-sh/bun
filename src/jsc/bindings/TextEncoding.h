/*
 * Copyright (C) 2004-2017 Apple Inc. All rights reserved.
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

#include "UnencodableHandling.h"
#include <wtf/URL.h>
#include <wtf/text/StringView.h>

#ifndef PAL_EXPORT
#define PAL_EXPORT
#endif

namespace PAL {

enum class NFCNormalize : bool { No,
    Yes };

class TextEncoding : public WTF::URLTextEncoding {
public:
    TextEncoding() = default;
    PAL_EXPORT TextEncoding(ASCIILiteral name);
    PAL_EXPORT TextEncoding(StringView name);
    PAL_EXPORT TextEncoding(const String& name);

    bool isValid() const { return !m_name.isNull(); }
    ASCIILiteral name() const { return m_name; }

    PAL_EXPORT String decode(std::span<const uint8_t>, bool stopOnError, bool& sawError) const;
    String decode(std::span<const uint8_t>) const;
    PAL_EXPORT Vector<uint8_t> encode(StringView, PAL::UnencodableHandling, NFCNormalize = NFCNormalize::Yes) const;
    Vector<uint8_t> encodeForURLParsing(StringView string) const final { return encode(string, PAL::UnencodableHandling::URLEncodedEntities, NFCNormalize::No); }

    char16_t backslashAsCurrencySymbol() const;

private:
    ASCIILiteral m_name;
    char16_t m_backslashAsCurrencySymbol;
};

PAL_EXPORT const TextEncoding& UTF8Encoding();

inline String TextEncoding::decode(std::span<const uint8_t> characters) const
{
    bool ignored;
    return decode(characters, false, ignored);
}

} // namespace PAL
