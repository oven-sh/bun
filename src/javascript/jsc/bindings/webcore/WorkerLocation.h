/*
 * Copyright (C) 2008 Apple Inc. All Rights Reserved.
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

#include <wtf/RefCounted.h>
#include <wtf/URL.h>
#include <wtf/text/WTFString.h>

namespace WebCore {

    class WorkerLocation : public RefCounted<WorkerLocation> {
    public:
        static Ref<WorkerLocation> create(URL&& url, String&& origin) { return adoptRef(*new WorkerLocation(WTFMove(url), WTFMove(origin))); }

        const URL& url() const { return m_url; }
        String href() const;

        // URI decomposition attributes
        String protocol() const;
        String host() const;
        String hostname() const;
        String port() const;
        String pathname() const;
        String search() const;
        String hash() const;
        String origin() const;

    private:
        WorkerLocation(URL&& url, String&& origin)
            : m_url(WTFMove(url))
            , m_origin(WTFMove(origin))
        {
        }

        URL m_url;
        String m_origin;
    };

} // namespace WebCore
