/*
 * Copyright (C) 2010 Google Inc. All rights reserved.
 * Copyright (C) 2012 Intel Inc. All rights reserved.
 * Copyright (C) 2016 Apple Inc. All rights reserved.
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

#include "ContextDestructionObserver.h"
// #include "DOMHighResTimeStamp.h"
#include "EventTarget.h"
#include "ExceptionOr.h"
// #include "ReducedResolutionSeconds.h"
#include "ScriptExecutionContext.h"
// #include "Timer.h"
#include <variant>

#include <wtf/ListHashSet.h>
#include <wtf/Seconds.h>

extern "C" uint64_t Bun__readOriginTimer(void*);
extern "C" double Bun__readOriginTimerStart(void*);

namespace JSC {
class JSGlobalObject;
}

namespace WebCore {

using ReducedResolutionSeconds = Seconds;
using DOMHighResTimeStamp = double;

class Document;
class PerformanceUserTiming;
class PerformanceEntry;
class PerformanceMark;
class PerformanceMeasure;
class PerformanceNavigation;
class PerformanceNavigationTiming;
class PerformanceObserver;
class PerformanceTiming;
class ScriptExecutionContext;
struct PerformanceMarkOptions;
struct PerformanceMeasureOptions;

class Performance final : public RefCounted<Performance>, public ContextDestructionObserver, public EventTarget {
    WTF_MAKE_TZONE_ALLOCATED(Performance);

public:
    static Ref<Performance> create(ScriptExecutionContext* context, MonotonicTime timeOrigin) { return adoptRef(*new Performance(context, timeOrigin)); }
    ~Performance();

    DOMHighResTimeStamp now() const;
    DOMHighResTimeStamp timeOrigin() const;

    // PerformanceNavigation* navigation();
    PerformanceTiming* timing();

    Vector<RefPtr<PerformanceEntry>> getEntries() const;
    Vector<RefPtr<PerformanceEntry>> getEntriesByType(const String& entryType) const;
    Vector<RefPtr<PerformanceEntry>> getEntriesByName(const String& name, const String& entryType) const;
    void appendBufferedEntriesByType(const String& entryType, Vector<RefPtr<PerformanceEntry>>&) const;

    void clearResourceTimings();
    void setResourceTimingBufferSize(unsigned);

    ExceptionOr<Ref<PerformanceMark>> mark(JSC::JSGlobalObject&, const String& markName, std::optional<PerformanceMarkOptions>&&);
    void clearMarks(const String& markName);

    using StartOrMeasureOptions = std::variant<String, PerformanceMeasureOptions>;
    ExceptionOr<Ref<PerformanceMeasure>> measure(JSC::JSGlobalObject&, const String& measureName, std::optional<StartOrMeasureOptions>&&, const String& endMark);
    void clearMeasures(const String& measureName);

    size_t memoryCost() const;

    void removeAllObservers();
    void registerPerformanceObserver(PerformanceObserver&);
    void unregisterPerformanceObserver(PerformanceObserver&);

    static Seconds reduceTimeResolution(Seconds);

    MonotonicTime monotonicTimeFromRelativeTime(DOMHighResTimeStamp) const;

    ScriptExecutionContext* scriptExecutionContext() const final { return ContextDestructionObserver::scriptExecutionContext(); }

    // ContextDestructionObserver.
    void ref() const final { RefCounted::ref(); }
    void deref() const final { RefCounted::deref(); }
    USING_CAN_MAKE_WEAKPTR(EventTarget);

private:
    Performance(ScriptExecutionContext*, MonotonicTime timeOrigin);

    void contextDestroyed() override;

    EventTargetInterface eventTargetInterface() const final { return PerformanceEventTargetInterfaceType; }

    void refEventTarget() final { ref(); }
    void derefEventTarget() final { deref(); }

    void queueEntry(PerformanceEntry&);
    void scheduleTaskIfNeeded();

    // mutable RefPtr<PerformanceNavigation> m_navigation;
    mutable RefPtr<PerformanceTiming> m_timing;

    Vector<RefPtr<PerformanceEntry>> m_resourceTimingBuffer;

    bool m_hasScheduledTimingBufferDeliveryTask { false };

    MonotonicTime m_timeOrigin;

    std::unique_ptr<PerformanceUserTiming> m_userTiming;

    ListHashSet<RefPtr<PerformanceObserver>> m_observers;
};

}
