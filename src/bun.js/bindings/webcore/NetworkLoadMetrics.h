/*
 * Copyright (C) 2010 Google, Inc. All Rights Reserved.
 * Copyright (C) 2014-2021 Apple, Inc. All Rights Reserved.
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

#include "HTTPHeaderMap.h"
#include <wtf/Box.h>
#include <wtf/MonotonicTime.h>
#include <wtf/text/WTFString.h>

#if PLATFORM(COCOA)
OBJC_CLASS NSURLConnection;
OBJC_CLASS NSURLSessionTaskMetrics;
#endif

namespace WebCore {

class ResourceHandle;

enum class NetworkLoadPriority : uint8_t {
    Low,
    Medium,
    High,
    Unknown,
};

enum class PrivacyStance : uint8_t {
    Unknown,
    NotEligible,
    Proxied,
    Failed,
    Direct,
    FailedUnreachable,
};

constexpr MonotonicTime reusedTLSConnectionSentinel { MonotonicTime::fromRawSeconds(-1) };

struct AdditionalNetworkLoadMetricsForWebInspector;

class NetworkLoadMetrics {
    WTF_DEPRECATED_MAKE_FAST_ALLOCATED(NetworkLoadMetrics);

public:
    WEBCORE_EXPORT NetworkLoadMetrics();
    WEBCORE_EXPORT NetworkLoadMetrics(MonotonicTime&& redirectStart, MonotonicTime&& fetchStart, MonotonicTime&& domainLookupStart, MonotonicTime&& domainLookupEnd, MonotonicTime&& connectStart, MonotonicTime&& secureConnectionStart, MonotonicTime&& connectEnd, MonotonicTime&& requestStart, MonotonicTime&& responseStart, MonotonicTime&& responseEnd, MonotonicTime&& workerStart, String&& protocol, uint16_t redirectCount, bool complete, bool cellular, bool expensive, bool constrained, bool multipath, bool isReusedConnection, bool failsTAOCheck, bool hasCrossOriginRedirect, PrivacyStance, uint64_t responseBodyBytesReceived, uint64_t responseBodyDecodedSize, RefPtr<AdditionalNetworkLoadMetricsForWebInspector>&&);

    WEBCORE_EXPORT static const NetworkLoadMetrics& emptyMetrics();

    WEBCORE_EXPORT NetworkLoadMetrics isolatedCopy() const;

    bool isComplete() const { return complete; }
    bool isCellular() const { return cellular; }
    bool isExpensive() const { return expensive; }
    bool isConstrained() const { return constrained; }
    bool isMultipath() const { return multipath; }
    bool reusedConnection() const { return isReusedConnection; }
    bool doesFailTAOCheck() const { return failsTAOCheck; }
    bool crossOriginRedirect() const { return hasCrossOriginRedirect; }
    void markComplete() { complete = true; }

    void updateFromFinalMetrics(const NetworkLoadMetrics&);

    // https://www.w3.org/TR/resource-timing-2/#attribute-descriptions
    MonotonicTime redirectStart;
    MonotonicTime fetchStart;
    MonotonicTime domainLookupStart;
    MonotonicTime domainLookupEnd;
    MonotonicTime connectStart;
    MonotonicTime secureConnectionStart;
    MonotonicTime connectEnd;
    MonotonicTime requestStart;
    MonotonicTime responseStart;
    MonotonicTime responseEnd;
    MonotonicTime workerStart;

    // ALPN Protocol ID: https://w3c.github.io/resource-timing/#bib-RFC7301
    String protocol;

    uint16_t redirectCount { 0 };

    bool complete : 1 { false };
    bool cellular : 1 { false };
    bool expensive : 1 { false };
    bool constrained : 1 { false };
    bool multipath : 1 { false };
    bool isReusedConnection : 1 { false };
    bool failsTAOCheck : 1 { false };
    bool hasCrossOriginRedirect : 1 { false };

    PrivacyStance privacyStance { PrivacyStance::Unknown };

    uint64_t responseBodyBytesReceived { std::numeric_limits<uint64_t>::max() };
    uint64_t responseBodyDecodedSize { std::numeric_limits<uint64_t>::max() };

    RefPtr<AdditionalNetworkLoadMetricsForWebInspector> additionalNetworkLoadMetricsForWebInspector;
};

struct AdditionalNetworkLoadMetricsForWebInspector : public RefCounted<AdditionalNetworkLoadMetricsForWebInspector> {

    static Ref<AdditionalNetworkLoadMetricsForWebInspector> create() { return adoptRef(*new AdditionalNetworkLoadMetricsForWebInspector()); }
    WEBCORE_EXPORT static Ref<AdditionalNetworkLoadMetricsForWebInspector> create(NetworkLoadPriority&&, String&& remoteAddress, String&& connectionIdentifier, String&& tlsProtocol, String&& tlsCipher, HTTPHeaderMap&& requestHeaders, uint64_t requestHeaderBytesSent, uint64_t responseHeaderBytesReceived, uint64_t requestBodyBytesSent, bool isProxyConnection);
    Ref<AdditionalNetworkLoadMetricsForWebInspector> isolatedCopy() const;
    Ref<AdditionalNetworkLoadMetricsForWebInspector> isolatedCopy();

    NetworkLoadPriority priority { NetworkLoadPriority::Unknown };

    String remoteAddress;
    String connectionIdentifier;

    String tlsProtocol;
    String tlsCipher;

    HTTPHeaderMap requestHeaders;

    uint64_t requestHeaderBytesSent { std::numeric_limits<uint64_t>::max() };
    uint64_t responseHeaderBytesReceived { std::numeric_limits<uint64_t>::max() };
    uint64_t requestBodyBytesSent { std::numeric_limits<uint64_t>::max() };

    bool isProxyConnection { false };

private:
    AdditionalNetworkLoadMetricsForWebInspector() {}
    AdditionalNetworkLoadMetricsForWebInspector(NetworkLoadPriority&&, String&& remoteAddress, String&& connectionIdentifier, String&& tlsProtocol, String&& tlsCipher, HTTPHeaderMap&& requestHeaders, uint64_t requestHeaderBytesSent, uint64_t responseHeaderBytesReceived, uint64_t requestBodyBytesSent, bool isProxyConnection);
};

#if PLATFORM(COCOA)
Box<NetworkLoadMetrics> copyTimingData(NSURLConnection*, const ResourceHandle&);
WEBCORE_EXPORT Box<NetworkLoadMetrics> copyTimingData(NSURLSessionTaskMetrics* incompleteMetrics, const NetworkLoadMetrics&);
#endif

} // namespace WebCore
