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

#include "config.h"
#include "ResourceTiming.h"

#include "PerformanceServerTiming.h"
#include "ResourceLoadTiming.h"

#include "NetworkLoadMetrics.h"

namespace WebCore {

DEFINE_ALLOCATOR_WITH_HEAP_IDENTIFIER(ResourceTiming);

ResourceTiming::ResourceTiming(const URL& url, const String& initiatorType, const NetworkLoadMetrics& networkLoadMetrics)
    : m_url(url)
    , m_initiatorType(initiatorType)
    , m_resourceLoadTiming(ResourceLoadTiming())
    , m_networkLoadMetrics(networkLoadMetrics)
    , m_serverTiming()
    , m_isSameOriginRequest(true)
{
}

Vector<Ref<PerformanceServerTiming>> ResourceTiming::populateServerTiming() const
{
    // To increase privacy, this additional check was proposed at https://github.com/w3c/resource-timing/issues/342 .
    if (!m_isSameOriginRequest)
        return {};

    return WTF::map(m_serverTiming, [](auto& entry) {
        return PerformanceServerTiming::create(String(entry.name), entry.duration, String(entry.description));
    });
}

} // namespace WebCore
