#include "root.h"

/*
 * Copyright (C) 2004-2019 Apple Inc. All rights reserved.
 * Copyright (C) 2006 Alexey Proskuryakov <ap@nypop.com>
 * Copyright (C) 2007-2009 Torch Mobile, Inc.
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
#include "TextEncoding.h"

#include "TextCodec.h"
#include "TextEncodingRegistry.h"
#include <wtf/StdLibExtras.h>
#include <wtf/text/StringView.h>

namespace PAL {

TextEncoding::TextEncoding(ASCIILiteral name)
    : m_name(atomCanonicalTextEncodingName(name))
    , m_backslashAsCurrencySymbol(backslashAsCurrencySymbol())
{
}

TextEncoding::TextEncoding(StringView name)
    : m_name(atomCanonicalTextEncodingName(name))
    , m_backslashAsCurrencySymbol(backslashAsCurrencySymbol())
{
}

TextEncoding::TextEncoding(const String& name)
    : TextEncoding(StringView { name })
{
}

String TextEncoding::decode(std::span<const uint8_t> data, bool stopOnError, bool& sawError) const
{
    if (m_name.isNull())
        return String();

    return newTextCodec(*this)->decode(data, true, stopOnError, sawError);
}

Vector<uint8_t> TextEncoding::encode(StringView string, PAL::UnencodableHandling handling, NFCNormalize normalize) const
{
    if (m_name.isNull() || string.isEmpty())
        return {};

    // FIXME: What's the right place to do normalization?
    // It's a little strange to do it inside the encode function.
    // Perhaps normalization should be an explicit step done before calling encode.
    if (normalize == NFCNormalize::Yes)
        return newTextCodec(*this)->encode(normalizedNFC(string).view, handling);
    return newTextCodec(*this)->encode(string, handling);
}

char16_t TextEncoding::backslashAsCurrencySymbol() const
{
    return shouldShowBackslashAsCurrencySymbolIn(m_name) ? 0x00A5 : '\\';
}

} // namespace PAL
