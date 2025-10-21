/*
 * Copyright (C) 2011 Google Inc. All rights reserved.
 * Copyright (C) 2012 Motorola Mobility Inc.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 *
 * 1.  Redistributions of source code must retain the above copyright
 *     notice, this list of conditions and the following disclaimer.
 * 2.  Redistributions in binary form must reproduce the above copyright
 *     notice, this list of conditions and the following disclaimer in the
 *     documentation and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY APPLE AND ITS CONTRIBUTORS "AS IS" AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL APPLE OR ITS CONTRIBUTORS BE LIABLE FOR ANY
 * DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
 * LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
 * ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
 * THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

#pragma once

#include "root.h"

#include "ExceptionOr.h"
#include "URLDecomposition.h"
#include <wtf/URL.h>
#include <wtf/WeakPtr.h>

namespace WebCore {

class Blob;
class ScriptExecutionContext;
class URLRegistrable;
class URLSearchParams;

class DOMURL final : public RefCounted<DOMURL>, public CanMakeWeakPtr<DOMURL>, public URLDecomposition {
public:
    static ExceptionOr<Ref<DOMURL>> create(const String& url, const String& base);
    static ExceptionOr<Ref<DOMURL>> create(const String& url);
    WEBCORE_EXPORT ~DOMURL();

    static RefPtr<DOMURL> parse(const String& url, const String& base);
    static bool canParse(const String& url, const String& base);

    const URL& href() const { return m_url; }
    ExceptionOr<void> setHref(const String&);

    URLSearchParams& searchParams();

    const String& toJSON() const { return m_url.string(); }

    static String createObjectURL(ScriptExecutionContext&, Blob&);
    static void revokeObjectURL(ScriptExecutionContext&, const String&);

    static String createPublicURL(ScriptExecutionContext&, URLRegistrable&);

    size_t memoryCost() const
    {
        return sizeof(DOMURL) + m_url.string().sizeInBytes();
    }
    size_t memoryCostForGC() const
    {
        return sizeof(DOMURL) + static_cast<size_t>(m_initialURLCostForGC);
    }

private:
    static ExceptionOr<Ref<DOMURL>> create(const String& url, const URL& base);
    DOMURL(URL&& completeURL);

    URL fullURL() const final { return m_url; }
    void setFullURL(const URL& fullURL) final { setHref(fullURL.string()); }

    URL m_url;
    RefPtr<URLSearchParams> m_searchParams;
    uint16_t m_initialURLCostForGC { 0 };
};

} // namespace WebCore
