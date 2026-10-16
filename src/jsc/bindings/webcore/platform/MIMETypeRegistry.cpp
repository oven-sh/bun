/*
 * Copyright (C) 2006-2026 Apple Inc. All rights reserved.
 * Copyright (C) 2008, 2009 Torch Mobile Inc. All rights reserved. (http://www.torchmobile.com/)
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
#include "MIMETypeRegistry.h"

#include "HTTPParsers.h"
#include <wtf/text/WTFString.h>

namespace WebCore {

static bool isValidMIMETypeWithSuffix(const String& mimeType, const ASCIILiteral suffix)
{
    if (!mimeType.endsWithIgnoringASCIICase(suffix))
        return false;

    if (mimeType.length() < suffix.length() + 2)
        return false;

    auto slashPosition = mimeType.find('/');
    if (slashPosition == notFound || slashPosition <= 0)
        return false;

    auto type = mimeType.substring(0, slashPosition);
    if (!isValidHTTPToken(type))
        return false;

    // Assume the suffix is already a valid HTTP token and avoid checking it.
    auto subtypeExcludingSuffix = mimeType.substring(slashPosition + 1, mimeType.length() - slashPosition - suffix.length());
    return isValidHTTPToken(subtypeExcludingSuffix);
}

// https://mimesniff.spec.whatwg.org/#xml-mime-type
bool MIMETypeRegistry::isXMLMIMEType(const String& mimeType)
{
    if (equalLettersIgnoringASCIICase(mimeType, "text/xml"_s) || equalLettersIgnoringASCIICase(mimeType, "application/xml"_s))
        return true;

    return isValidMIMETypeWithSuffix(mimeType, "+xml"_s);
}

} // namespace WebCore
