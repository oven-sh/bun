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

class CachedResource;
class Document;
class DocumentLoadTiming;
class DocumentLoader;
class NetworkLoadMetrics;
class PerformanceUserTiming;
class PerformanceEntry;
class PerformanceMark;
class PerformanceMeasure;
class PerformanceNavigation;
class PerformanceNavigationTiming;
class PerformanceObserver;
class PerformancePaintTiming;
class PerformanceTiming;
class ResourceResponse;
class ResourceTiming;
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
    // ReducedResolutionSeconds nowInReducedResolutionSeconds() const;

    // PerformanceNavigation* navigation();
    PerformanceTiming* timing();

    Vector<RefPtr<PerformanceEntry>> getEntries() const;
    Vector<RefPtr<PerformanceEntry>> getEntriesByType(const String& entryType) const;
    Vector<RefPtr<PerformanceEntry>> getEntriesByName(const String& name, const String& entryType) const;
    void appendBufferedEntriesByType(const String& entryType, Vector<RefPtr<PerformanceEntry>>&, PerformanceObserver&) const;

    void clearResourceTimings();
    void setResourceTimingBufferSize(unsigned);

    ExceptionOr<Ref<PerformanceMark>> mark(JSC::JSGlobalObject&, const String& markName, std::optional<PerformanceMarkOptions>&&);
    void clearMarks(const String& markName);

    using StartOrMeasureOptions = std::variant<String, PerformanceMeasureOptions>;
    ExceptionOr<Ref<PerformanceMeasure>> measure(JSC::JSGlobalObject&, const String& measureName, std::optional<StartOrMeasureOptions>&&, const String& endMark);
    void clearMeasures(const String& measureName);

    // void addNavigationTiming(DocumentLoader&, Document&, CachedResource&, const DocumentLoadTiming&, const NetworkLoadMetrics&);
    // void navigationFinished(const NetworkLoadMetrics&);
    void addResourceTiming(ResourceTiming&&);

    // void reportFirstContentfulPaint();

    size_t memoryCost() const;

    void removeAllObservers();
    void registerPerformanceObserver(PerformanceObserver&);
    void unregisterPerformanceObserver(PerformanceObserver&);

    static void allowHighPrecisionTime();
    static Seconds timeResolution();
    static Seconds reduceTimeResolution(Seconds);

    DOMHighResTimeStamp relativeTimeFromTimeOriginInReducedResolution(MonotonicTime) const;
    MonotonicTime monotonicTimeFromRelativeTime(DOMHighResTimeStamp) const;

    ScriptExecutionContext* scriptExecutionContext() const final { return ContextDestructionObserver::scriptExecutionContext(); }

    using RefCounted::deref;
    using RefCounted::ref;

    // void scheduleNavigationObservationTaskIfNeeded();

    // PerformanceNavigationTiming* navigationTiming() { return m_navigationTiming.get(); }

    // EventTargetData* eventTargetData() override;
    // EventTargetData* eventTargetDataConcurrently() override;
    // EventTargetData& ensureEventTargetData() override;

private:
    Performance(ScriptExecutionContext*, MonotonicTime timeOrigin);

    void contextDestroyed() override;

    EventTargetInterface eventTargetInterface() const final { return PerformanceEventTargetInterfaceType; }

    void refEventTarget() final { ref(); }
    void derefEventTarget() final { deref(); }

    bool isResourceTimingBufferFull() const;
    // void resourceTimingBufferFullTimerFired();

    void queueEntry(PerformanceEntry&);
    void scheduleTaskIfNeeded();

    // mutable RefPtr<PerformanceNavigation> m_navigation;
    mutable RefPtr<PerformanceTiming> m_timing;

    // https://w3c.github.io/resource-timing/#extensions-performance-interface recommends size of 150.
    Vector<RefPtr<PerformanceEntry>> m_resourceTimingBuffer;
    unsigned m_resourceTimingBufferSize { 150 };

    // Timer m_resourceTimingBufferFullTimer;
    Vector<RefPtr<PerformanceEntry>> m_backupResourceTimingBuffer;

    // https://w3c.github.io/resource-timing/#dfn-resource-timing-buffer-full-flag
    bool m_resourceTimingBufferFullFlag { false };
    bool m_waitingForBackupBufferToBeProcessed { false };
    bool m_hasScheduledTimingBufferDeliveryTask { false };

    MonotonicTime m_timeOrigin;

    // RefPtr<PerformanceNavigationTiming> m_navigationTiming;
    // RefPtr<PerformancePaintTiming> m_firstContentfulPaint;
    std::unique_ptr<PerformanceUserTiming> m_userTiming;

    ListHashSet<RefPtr<PerformanceObserver>> m_observers;

    EventTargetData* eventTargetData() final { return &m_eventTargetData; }
    EventTargetData* eventTargetDataConcurrently() final { return &m_eventTargetData; }
    EventTargetData& ensureEventTargetData() final { return m_eventTargetData; }

    EventTargetData m_eventTargetData;
};

}
