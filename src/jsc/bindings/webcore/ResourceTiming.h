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

#pragma once

// #include "LoaderMalloc.h"
#include "NetworkLoadMetrics.h"
#include "ResourceLoadTiming.h"
#include "ServerTiming.h"
#include <wtf/URL.h>

namespace WebCore {

class PerformanceServerTiming;
class ResourceLoadTiming;

DECLARE_ALLOCATOR_WITH_HEAP_IDENTIFIER(ResourceTiming);

class ResourceTiming {
    WTF_DEPRECATED_MAKE_FAST_ALLOCATED_WITH_HEAP_IDENTIFIER(ResourceTiming, ResourceTiming);

public:
    const URL& url() const { return m_url; }
    const String& initiatorType() const { return m_initiatorType; }
    const ResourceLoadTiming& resourceLoadTiming() const { return m_resourceLoadTiming; }
    const NetworkLoadMetrics& networkLoadMetrics() const { return m_networkLoadMetrics; }
    NetworkLoadMetrics& networkLoadMetrics() { return m_networkLoadMetrics; }
    Vector<Ref<PerformanceServerTiming>> populateServerTiming() const;
    bool isSameOriginRequest() const { return m_isSameOriginRequest; }

private:
    ResourceTiming(const URL& url, const String& initiatorType, const NetworkLoadMetrics& networkLoadMetrics);

    URL m_url;
    String m_initiatorType;
    ResourceLoadTiming m_resourceLoadTiming;
    NetworkLoadMetrics m_networkLoadMetrics;
    Vector<ServerTiming> m_serverTiming;
    bool m_isSameOriginRequest { false };
};

} // namespace WebCore
