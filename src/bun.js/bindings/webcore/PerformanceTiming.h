/*
 * Copyright (C) 2010 Google Inc. All rights reserved.
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

#pragma once

// #include "LocalDOMWindowProperty.h"
#include <wtf/MonotonicTime.h>
#include <wtf/Ref.h>
#include <wtf/RefCounted.h>

namespace WebCore {

class PerformanceTiming : public RefCounted<PerformanceTiming> {
public:
    static Ref<PerformanceTiming> create() { return adoptRef(*new PerformanceTiming()); }

    unsigned long long navigationStart() const;
    unsigned long long unloadEventStart() const;
    unsigned long long unloadEventEnd() const;
    unsigned long long redirectStart() const;
    unsigned long long redirectEnd() const;
    unsigned long long fetchStart() const;
    unsigned long long domainLookupStart() const;
    unsigned long long domainLookupEnd() const;
    unsigned long long connectStart() const;
    unsigned long long connectEnd() const;
    unsigned long long secureConnectionStart() const;
    unsigned long long requestStart() const;
    unsigned long long responseStart() const;
    unsigned long long responseEnd() const;
    unsigned long long domLoading() const;
    unsigned long long domInteractive() const;
    unsigned long long domContentLoadedEventStart() const;
    unsigned long long domContentLoadedEventEnd() const;
    unsigned long long domComplete() const;
    unsigned long long loadEventStart() const;
    unsigned long long loadEventEnd() const;

private:
    explicit PerformanceTiming();

    unsigned long long monotonicTimeToIntegerMilliseconds(MonotonicTime) const;

    // mutable unsigned long long m_navigationStart { 0 };
    // mutable unsigned long long m_unloadEventStart { 0 };
    // mutable unsigned long long m_unloadEventEnd { 0 };
    // mutable unsigned long long m_redirectStart { 0 };
    // mutable unsigned long long m_redirectEnd { 0 };
    // mutable unsigned long long m_fetchStart { 0 };
    // mutable unsigned long long m_domainLookupStart { 0 };
    // mutable unsigned long long m_domainLookupEnd { 0 };
    // mutable unsigned long long m_connectStart { 0 };
    // mutable unsigned long long m_connectEnd { 0 };
    // mutable unsigned long long m_secureConnectionStart { 0 };
    // mutable unsigned long long m_requestStart { 0 };
    // mutable unsigned long long m_responseStart { 0 };
    // mutable unsigned long long m_responseEnd { 0 };
    // mutable unsigned long long m_domLoading { 0 };
    // mutable unsigned long long m_domInteractive { 0 };
    // mutable unsigned long long m_domContentLoadedEventStart { 0 };
    // mutable unsigned long long m_domContentLoadedEventEnd { 0 };
    // mutable unsigned long long m_domComplete { 0 };
    // mutable unsigned long long m_loadEventStart { 0 };
    // mutable unsigned long long m_loadEventEnd { 0 };
};

} // namespace WebCore
