/*
 * Copyright (C) 2021 Apple Inc. All rights reserved.
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
#include "NetworkLoadMetrics.h"

#include <wtf/NeverDestroyed.h>

namespace WebCore {

NetworkLoadMetrics::NetworkLoadMetrics() = default;

NetworkLoadMetrics::NetworkLoadMetrics(MonotonicTime&& redirectStart, MonotonicTime&& fetchStart, MonotonicTime&& domainLookupStart, MonotonicTime&& domainLookupEnd, MonotonicTime&& connectStart, MonotonicTime&& secureConnectionStart, MonotonicTime&& connectEnd, MonotonicTime&& requestStart, MonotonicTime&& responseStart, MonotonicTime&& responseEnd, MonotonicTime&& workerStart, String&& protocol, uint16_t redirectCount, bool complete, bool cellular, bool expensive, bool constrained, bool multipath, bool isReusedConnection, bool failsTAOCheck, bool hasCrossOriginRedirect, PrivacyStance privacyStance, uint64_t responseBodyBytesReceived, uint64_t responseBodyDecodedSize, RefPtr<AdditionalNetworkLoadMetricsForWebInspector>&& additionalNetworkLoadMetricsForWebInspector)
    : redirectStart(WTF::move(redirectStart))
    , fetchStart(WTF::move(fetchStart))
    , domainLookupStart(WTF::move(domainLookupStart))
    , domainLookupEnd(WTF::move(domainLookupEnd))
    , connectStart(WTF::move(connectStart))
    , secureConnectionStart(WTF::move(secureConnectionStart))
    , connectEnd(WTF::move(connectEnd))
    , requestStart(WTF::move(requestStart))
    , responseStart(WTF::move(responseStart))
    , responseEnd(responseEnd)
    , workerStart(workerStart)
    , protocol(protocol)
    , redirectCount(redirectCount)
    , complete(complete)
    , cellular(cellular)
    , expensive(expensive)
    , constrained(constrained)
    , multipath(multipath)
    , isReusedConnection(isReusedConnection)
    , failsTAOCheck(failsTAOCheck)
    , hasCrossOriginRedirect(hasCrossOriginRedirect)
    , privacyStance(privacyStance)
    , responseBodyBytesReceived(responseBodyBytesReceived)
    , responseBodyDecodedSize(responseBodyDecodedSize)
    , additionalNetworkLoadMetricsForWebInspector(WTF::move(additionalNetworkLoadMetricsForWebInspector))
{
}

void NetworkLoadMetrics::updateFromFinalMetrics(const NetworkLoadMetrics& other)
{
    MonotonicTime originalRedirectStart = redirectStart;
    MonotonicTime originalFetchStart = fetchStart;
    MonotonicTime originalDomainLookupStart = domainLookupStart;
    MonotonicTime originalDomainLookupEnd = domainLookupEnd;
    MonotonicTime originalConnectStart = connectStart;
    MonotonicTime originalSecureConnectionStart = secureConnectionStart;
    MonotonicTime originalConnectEnd = connectEnd;
    MonotonicTime originalRequestStart = requestStart;
    MonotonicTime originalResponseStart = responseStart;
    MonotonicTime originalResponseEnd = responseEnd;
    MonotonicTime originalWorkerStart = workerStart;

    *this = other;

    if (!redirectStart)
        redirectStart = originalRedirectStart;
    if (!fetchStart)
        fetchStart = originalFetchStart;
    if (!domainLookupStart)
        domainLookupStart = originalDomainLookupStart;
    if (!domainLookupEnd)
        domainLookupEnd = originalDomainLookupEnd;
    if (!connectStart)
        connectStart = originalConnectStart;
    if (!secureConnectionStart)
        secureConnectionStart = originalSecureConnectionStart;
    if (!connectEnd)
        connectEnd = originalConnectEnd;
    if (!requestStart)
        requestStart = originalRequestStart;
    if (!responseStart)
        responseStart = originalResponseStart;
    if (!responseEnd)
        responseEnd = originalResponseEnd;
    if (!workerStart)
        workerStart = originalWorkerStart;

    if (!responseEnd)
        responseEnd = MonotonicTime::now();
    complete = true;
}

const NetworkLoadMetrics& NetworkLoadMetrics::emptyMetrics()
{
    static NeverDestroyed<NetworkLoadMetrics> metrics;
    return metrics.get();
}

Ref<AdditionalNetworkLoadMetricsForWebInspector> AdditionalNetworkLoadMetricsForWebInspector::isolatedCopy()
{
    auto copy = AdditionalNetworkLoadMetricsForWebInspector::create();
    copy->priority = priority;
    copy->remoteAddress = remoteAddress.isolatedCopy();
    copy->connectionIdentifier = connectionIdentifier.isolatedCopy();
    copy->tlsProtocol = tlsProtocol.isolatedCopy();
    copy->tlsCipher = tlsCipher.isolatedCopy();
    copy->requestHeaders = requestHeaders.isolatedCopy();
    copy->requestHeaderBytesSent = requestHeaderBytesSent;
    copy->responseHeaderBytesReceived = responseHeaderBytesReceived;
    copy->requestBodyBytesSent = requestBodyBytesSent;
    copy->isProxyConnection = isProxyConnection;
    return copy;
}

NetworkLoadMetrics NetworkLoadMetrics::isolatedCopy() const
{
    NetworkLoadMetrics copy;

    copy.redirectStart = redirectStart.isolatedCopy();
    copy.fetchStart = fetchStart.isolatedCopy();
    copy.domainLookupStart = domainLookupStart.isolatedCopy();
    copy.domainLookupEnd = domainLookupEnd.isolatedCopy();
    copy.connectStart = connectStart.isolatedCopy();
    copy.secureConnectionStart = secureConnectionStart.isolatedCopy();
    copy.connectEnd = connectEnd.isolatedCopy();
    copy.requestStart = requestStart.isolatedCopy();
    copy.responseStart = responseStart.isolatedCopy();
    copy.responseEnd = responseEnd.isolatedCopy();
    copy.workerStart = workerStart.isolatedCopy();

    copy.protocol = protocol.isolatedCopy();

    copy.redirectCount = redirectCount;

    copy.complete = complete;
    copy.cellular = cellular;
    copy.expensive = expensive;
    copy.constrained = constrained;
    copy.multipath = multipath;
    copy.isReusedConnection = isReusedConnection;
    copy.failsTAOCheck = failsTAOCheck;
    copy.hasCrossOriginRedirect = hasCrossOriginRedirect;

    copy.privacyStance = privacyStance;

    copy.responseBodyBytesReceived = responseBodyBytesReceived;
    copy.responseBodyDecodedSize = responseBodyDecodedSize;

    if (additionalNetworkLoadMetricsForWebInspector)
        copy.additionalNetworkLoadMetricsForWebInspector = additionalNetworkLoadMetricsForWebInspector->isolatedCopy();

    return copy;
}

Ref<AdditionalNetworkLoadMetricsForWebInspector> AdditionalNetworkLoadMetricsForWebInspector::create(NetworkLoadPriority&& priority, String&& remoteAddress, String&& connectionIdentifier, String&& tlsProtocol, String&& tlsCipher, HTTPHeaderMap&& requestHeaders, uint64_t requestHeaderBytesSent, uint64_t responseHeaderBytesReceived, uint64_t requestBodyBytesSent, bool isProxyConnection)
{
    return adoptRef(*new AdditionalNetworkLoadMetricsForWebInspector(WTF::move(priority), WTF::move(remoteAddress), WTF::move(connectionIdentifier), WTF::move(tlsProtocol), WTF::move(tlsCipher), WTF::move(requestHeaders), requestHeaderBytesSent, responseHeaderBytesReceived, requestBodyBytesSent, isProxyConnection));
}

AdditionalNetworkLoadMetricsForWebInspector::AdditionalNetworkLoadMetricsForWebInspector(NetworkLoadPriority&& priority, String&& remoteAddress, String&& connectionIdentifier, String&& tlsProtocol, String&& tlsCipher, HTTPHeaderMap&& requestHeaders, uint64_t requestHeaderBytesSent, uint64_t responseHeaderBytesReceived, uint64_t requestBodyBytesSent, bool isProxyConnection)
    : priority(WTF::move(priority))
    , remoteAddress(WTF::move(remoteAddress))
    , connectionIdentifier(WTF::move(connectionIdentifier))
    , tlsProtocol(WTF::move(tlsProtocol))
    , tlsCipher(WTF::move(tlsCipher))
    , requestHeaders(WTF::move(requestHeaders))
    , requestHeaderBytesSent(requestHeaderBytesSent)
    , responseHeaderBytesReceived(responseHeaderBytesReceived)
    , requestBodyBytesSent(requestBodyBytesSent)
    , isProxyConnection(isProxyConnection)
{
}

} // namespace WebCore
