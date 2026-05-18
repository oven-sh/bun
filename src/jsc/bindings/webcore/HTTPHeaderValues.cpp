/*
 * Copyright (C) 2016-2017 Apple Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 * 1.  Redistributions of source code must retain the above copyright
 *     notice, this list of conditions and the following disclaimer.
 * 2.  Redistributions in binary form must reproduce the above copyright
 *     notice, this list of conditions and the following disclaimer in the
 *     documentation and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY APPLE INC. AND ITS CONTRIBUTORS ``AS IS'' AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL APPLE INC. OR ITS CONTRIBUTORS BE LIABLE FOR ANY
 * DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
 * LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON
 * ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
 * SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

#include "config.h"
#include "HTTPHeaderValues.h"

#include <wtf/NeverDestroyed.h>
#include <wtf/text/WTFString.h>

namespace WebCore {

namespace HTTPHeaderValues {

const String& textPlainContentType()
{
    static NeverDestroyed<const String> contentType(MAKE_STATIC_STRING_IMPL("text/plain;charset=UTF-8"));
    return contentType;
}

const String& formURLEncodedContentType()
{
    static NeverDestroyed<const String> contentType(MAKE_STATIC_STRING_IMPL("application/x-www-form-urlencoded;charset=UTF-8"));
    return contentType;
}

const String& applicationJSONContentType()
{
    // The default encoding is UTF-8: https://www.ietf.org/rfc/rfc4627.txt.
    static NeverDestroyed<const String> contentType(MAKE_STATIC_STRING_IMPL("application/json"));
    return contentType;
}

const String& noCache()
{
    static NeverDestroyed<const String> value(MAKE_STATIC_STRING_IMPL("no-cache"));
    return value;
}

const String& maxAge0()
{
    static NeverDestroyed<const String> value(MAKE_STATIC_STRING_IMPL("max-age=0"));
    return value;
}

}

}
