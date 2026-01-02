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

#include "config.h"
#include "PerformanceTiming.h"

// #include "Document.h"
// #include "DocumentEventTiming.h"
// #include "DocumentLoadTiming.h"
// #include "DocumentLoader.h"
// #include "FrameLoader.h"
// #include "LocalFrame.h"
// #include "NetworkLoadMetrics.h"
#include "Performance.h"
// #include "ResourceResponse.h"

namespace WebCore {

PerformanceTiming::PerformanceTiming() {}

unsigned long long PerformanceTiming::navigationStart() const
{
    return 0;
}

unsigned long long PerformanceTiming::unloadEventStart() const
{
    return 0;
}

unsigned long long PerformanceTiming::unloadEventEnd() const
{
    return 0;
}

unsigned long long PerformanceTiming::redirectStart() const
{
    return 0;
}

unsigned long long PerformanceTiming::redirectEnd() const
{
    return 0;
}

unsigned long long PerformanceTiming::fetchStart() const
{
    return 0;
}

unsigned long long PerformanceTiming::domainLookupStart() const
{
    return 0;
}

unsigned long long PerformanceTiming::domainLookupEnd() const
{
    return 0;
}

unsigned long long PerformanceTiming::connectStart() const
{
    return 0;
}

unsigned long long PerformanceTiming::connectEnd() const
{
    return 0;
}

unsigned long long PerformanceTiming::secureConnectionStart() const
{
    return 0;
}

unsigned long long PerformanceTiming::requestStart() const
{
    return 0;
}

unsigned long long PerformanceTiming::responseStart() const
{
    return 0;
}

unsigned long long PerformanceTiming::responseEnd() const
{
    return 0;
}

unsigned long long PerformanceTiming::domLoading() const
{
    return 0;
}

unsigned long long PerformanceTiming::domInteractive() const
{
    return 0;
}

unsigned long long PerformanceTiming::domContentLoadedEventStart() const
{
    return 0;
}

unsigned long long PerformanceTiming::domContentLoadedEventEnd() const
{
    return 0;
}

unsigned long long PerformanceTiming::domComplete() const
{
    return 0;
}

unsigned long long PerformanceTiming::loadEventStart() const
{
    return 0;
}

unsigned long long PerformanceTiming::loadEventEnd() const
{
    return 0;
}

unsigned long long PerformanceTiming::monotonicTimeToIntegerMilliseconds(MonotonicTime timeStamp) const
{
    return timeStamp.secondsSinceEpoch().milliseconds();
}

} // namespace WebCore
