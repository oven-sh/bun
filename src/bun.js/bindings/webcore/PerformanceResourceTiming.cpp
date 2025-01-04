/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
 * Copyright (C) 2012 Google Inc. All rights reserved.
 * Copyright (C) 2012 Intel Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are
 * met:
 *
 *     * Redistributions of source code must retain the above copyright
 * notice, this list of conditions and the following disclaimer.
 *     * Redistributions in binary form must reproduce the above
 * copyright notice, this list of conditions and the following disclaimer
 * in the documentation and/or other materials provided with the
 * distribution.
 *     * Neither the name of Google Inc. nor the names of its
 * contributors may be used to endorse or promote products derived from
 * this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 * A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
 * OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
 * LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

#include "config.h"
#include "PerformanceResourceTiming.h"

// #include "Document.h"
// #include "DocumentLoadTiming.h"
// #include "DocumentLoader.h"
#include "PerformanceServerTiming.h"
// #include "ResourceResponse.h"
#include "ResourceTiming.h"
#include <wtf/URL.h>

namespace WebCore {

static double networkLoadTimeToDOMHighResTimeStamp(MonotonicTime timeOrigin, MonotonicTime timeStamp)
{
    if (!timeStamp)
        return 0.0;
    ASSERT(timeOrigin);
    return Performance::reduceTimeResolution(timeStamp - timeOrigin).milliseconds();
}

static double fetchStart(MonotonicTime timeOrigin, const ResourceTiming& resourceTiming)
{
    if (auto fetchStart = resourceTiming.networkLoadMetrics().fetchStart; fetchStart && !resourceTiming.networkLoadMetrics().failsTAOCheck)
        return networkLoadTimeToDOMHighResTimeStamp(timeOrigin, fetchStart);

    // fetchStart is a required property.
    auto startTime = resourceTiming.resourceLoadTiming().startTime();
    ASSERT(startTime);
    return networkLoadTimeToDOMHighResTimeStamp(timeOrigin, startTime);
}

size_t PerformanceResourceTiming::memoryCost() const
{
    size_t size = sizeof(PerformanceResourceTiming);
    size += m_serverTiming.size() * sizeof(PerformanceServerTiming);
    return size;
}

static double entryStartTime(MonotonicTime timeOrigin, const ResourceTiming& resourceTiming)
{
    if (resourceTiming.networkLoadMetrics().failsTAOCheck
        || !resourceTiming.networkLoadMetrics().redirectCount)
        return fetchStart(timeOrigin, resourceTiming);

    if (resourceTiming.networkLoadMetrics().redirectStart)
        return networkLoadTimeToDOMHighResTimeStamp(timeOrigin, resourceTiming.networkLoadMetrics().redirectStart);

    return networkLoadTimeToDOMHighResTimeStamp(timeOrigin, resourceTiming.resourceLoadTiming().startTime());
}

static double entryEndTime(MonotonicTime timeOrigin, const ResourceTiming& resourceTiming)
{
    if (resourceTiming.networkLoadMetrics().responseEnd)
        return networkLoadTimeToDOMHighResTimeStamp(timeOrigin, resourceTiming.networkLoadMetrics().responseEnd);

    return networkLoadTimeToDOMHighResTimeStamp(timeOrigin, resourceTiming.resourceLoadTiming().endTime());
}

Ref<PerformanceResourceTiming> PerformanceResourceTiming::create(MonotonicTime timeOrigin, ResourceTiming&& resourceTiming)
{
    return adoptRef(*new PerformanceResourceTiming(timeOrigin, WTFMove(resourceTiming)));
}

PerformanceResourceTiming::PerformanceResourceTiming(MonotonicTime timeOrigin, ResourceTiming&& resourceTiming)
    : PerformanceEntry(resourceTiming.url().string(), entryStartTime(timeOrigin, resourceTiming), entryEndTime(timeOrigin, resourceTiming))
    , m_timeOrigin(timeOrigin)
    , m_resourceTiming(WTFMove(resourceTiming))
    , m_serverTiming(m_resourceTiming.populateServerTiming())
{
}

PerformanceResourceTiming::~PerformanceResourceTiming() = default;

const String& PerformanceResourceTiming::nextHopProtocol() const
{
    if (m_resourceTiming.networkLoadMetrics().failsTAOCheck)
        return emptyString();

    return m_resourceTiming.networkLoadMetrics().protocol;
}

double PerformanceResourceTiming::workerStart() const
{
    if (m_resourceTiming.networkLoadMetrics().failsTAOCheck)
        return 0.0;

    return networkLoadTimeToDOMHighResTimeStamp(m_timeOrigin, m_resourceTiming.networkLoadMetrics().workerStart);
}

double PerformanceResourceTiming::redirectStart() const
{
    if (m_resourceTiming.networkLoadMetrics().failsTAOCheck)
        return 0.0;

    if (m_resourceTiming.isLoadedFromServiceWorker())
        return 0.0;

    if (!m_resourceTiming.networkLoadMetrics().redirectCount)
        return 0.0;

    return networkLoadTimeToDOMHighResTimeStamp(m_timeOrigin, m_resourceTiming.networkLoadMetrics().redirectStart);
}

double PerformanceResourceTiming::redirectEnd() const
{
    if (m_resourceTiming.networkLoadMetrics().failsTAOCheck)
        return 0.0;

    if (m_resourceTiming.isLoadedFromServiceWorker())
        return 0.0;

    if (!m_resourceTiming.networkLoadMetrics().redirectCount)
        return 0.0;

    // These two times are so close to each other that we don't record two timestamps.
    // See https://www.w3.org/TR/resource-timing-2/#attribute-descriptions
    return fetchStart();
}

double PerformanceResourceTiming::fetchStart() const
{
    return WebCore::fetchStart(m_timeOrigin, m_resourceTiming);
}

double PerformanceResourceTiming::domainLookupStart() const
{
    if (m_resourceTiming.networkLoadMetrics().failsTAOCheck)
        return 0.0;

    if (m_resourceTiming.isLoadedFromServiceWorker())
        return fetchStart();

    if (!m_resourceTiming.networkLoadMetrics().domainLookupStart)
        return fetchStart();

    return networkLoadTimeToDOMHighResTimeStamp(m_timeOrigin, m_resourceTiming.networkLoadMetrics().domainLookupStart);
}

double PerformanceResourceTiming::domainLookupEnd() const
{
    if (m_resourceTiming.networkLoadMetrics().failsTAOCheck)
        return 0.0;

    if (m_resourceTiming.isLoadedFromServiceWorker())
        return fetchStart();

    if (!m_resourceTiming.networkLoadMetrics().domainLookupEnd)
        return domainLookupStart();

    return networkLoadTimeToDOMHighResTimeStamp(m_timeOrigin, m_resourceTiming.networkLoadMetrics().domainLookupEnd);
}

double PerformanceResourceTiming::connectStart() const
{
    if (m_resourceTiming.networkLoadMetrics().failsTAOCheck)
        return 0.0;

    if (m_resourceTiming.isLoadedFromServiceWorker())
        return fetchStart();

    if (!m_resourceTiming.networkLoadMetrics().connectStart)
        return domainLookupEnd();

    return networkLoadTimeToDOMHighResTimeStamp(m_timeOrigin, m_resourceTiming.networkLoadMetrics().connectStart);
}

double PerformanceResourceTiming::connectEnd() const
{
    if (m_resourceTiming.networkLoadMetrics().failsTAOCheck)
        return 0.0;

    if (m_resourceTiming.isLoadedFromServiceWorker())
        return fetchStart();

    if (!m_resourceTiming.networkLoadMetrics().connectEnd)
        return connectStart();

    return networkLoadTimeToDOMHighResTimeStamp(m_timeOrigin, m_resourceTiming.networkLoadMetrics().connectEnd);
}

double PerformanceResourceTiming::secureConnectionStart() const
{
    if (m_resourceTiming.networkLoadMetrics().failsTAOCheck)
        return 0.0;

    if (m_resourceTiming.networkLoadMetrics().secureConnectionStart == reusedTLSConnectionSentinel)
        return fetchStart();

    if (!m_resourceTiming.networkLoadMetrics().secureConnectionStart)
        return 0.0;

    return networkLoadTimeToDOMHighResTimeStamp(m_timeOrigin, m_resourceTiming.networkLoadMetrics().secureConnectionStart);
}

double PerformanceResourceTiming::requestStart() const
{
    if (m_resourceTiming.networkLoadMetrics().failsTAOCheck)
        return 0.0;

    // requestStart is 0 when a network request is not made.
    if (!m_resourceTiming.networkLoadMetrics().requestStart)
        return connectEnd();

    return networkLoadTimeToDOMHighResTimeStamp(m_timeOrigin, m_resourceTiming.networkLoadMetrics().requestStart);
}

double PerformanceResourceTiming::responseStart() const
{
    if (m_resourceTiming.networkLoadMetrics().failsTAOCheck)
        return 0.0;

    // responseStart is 0 when a network request is not made.
    if (!m_resourceTiming.networkLoadMetrics().responseStart)
        return requestStart();

    return networkLoadTimeToDOMHighResTimeStamp(m_timeOrigin, m_resourceTiming.networkLoadMetrics().responseStart);
}

double PerformanceResourceTiming::responseEnd() const
{
    // responseEnd is a required property, but PerformanceNavigationTiming
    // can be queried before the document load is complete
    ASSERT(m_resourceTiming.networkLoadMetrics().isComplete()
        || m_resourceTiming.resourceLoadTiming().endTime()
        || performanceEntryType() == Type::Navigation);

    if (m_resourceTiming.networkLoadMetrics().isComplete()) {
        if (m_resourceTiming.networkLoadMetrics().responseEnd)
            return networkLoadTimeToDOMHighResTimeStamp(m_timeOrigin, m_resourceTiming.networkLoadMetrics().responseEnd);

        // responseEnd is 0 when a network request is not made.
        // This should mean all other properties are empty.
        ASSERT(!m_resourceTiming.networkLoadMetrics().responseStart);
        ASSERT(!m_resourceTiming.networkLoadMetrics().requestStart);
        ASSERT(!m_resourceTiming.networkLoadMetrics().requestStart);
        ASSERT(!m_resourceTiming.networkLoadMetrics().secureConnectionStart);
        ASSERT(!m_resourceTiming.networkLoadMetrics().connectEnd);
        ASSERT(!m_resourceTiming.networkLoadMetrics().connectStart);
        ASSERT(!m_resourceTiming.networkLoadMetrics().domainLookupEnd);
        ASSERT(!m_resourceTiming.networkLoadMetrics().domainLookupStart);
    }

    return networkLoadTimeToDOMHighResTimeStamp(m_timeOrigin, m_resourceTiming.resourceLoadTiming().endTime());
}

uint64_t PerformanceResourceTiming::transferSize() const
{
    // This is intentionally stricter than a TAO check.
    // See https://github.com/w3c/server-timing/issues/89
    if (!m_resourceTiming.isSameOriginRequest())
        return 0;

    auto encodedBodySize = m_resourceTiming.networkLoadMetrics().responseBodyBytesReceived;
    if (encodedBodySize == std::numeric_limits<uint64_t>::max())
        return 0;

    // https://w3c.github.io/resource-timing/#dom-performanceresourcetiming-transfersize
    // Motivated by https://github.com/w3c/resource-timing/issues/238
    return encodedBodySize + 300;
}

uint64_t PerformanceResourceTiming::encodedBodySize() const
{
    // This is intentionally stricter than a TAO check.
    // See https://github.com/w3c/server-timing/issues/89
    if (!m_resourceTiming.isSameOriginRequest())
        return 0;

    auto encodedBodySize = m_resourceTiming.networkLoadMetrics().responseBodyBytesReceived;
    if (encodedBodySize == std::numeric_limits<uint64_t>::max())
        return 0;

    return encodedBodySize;
}

uint64_t PerformanceResourceTiming::decodedBodySize() const
{
    // This is intentionally stricter than a TAO check.
    // See https://github.com/w3c/server-timing/issues/89
    if (!m_resourceTiming.isSameOriginRequest())
        return 0;

    auto decodedBodySize = m_resourceTiming.networkLoadMetrics().responseBodyDecodedSize;
    if (decodedBodySize == std::numeric_limits<uint64_t>::max())
        return 0;

    return decodedBodySize;
}

} // namespace WebCore
