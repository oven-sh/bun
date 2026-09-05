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

#include "config.h"
#include "Performance.h"

// #include "Document.h"
// #include "DocumentLoader.h"
#include "Event.h"
// #include "EventLoop.h"
#include "EventNames.h"
// #include "LocalFrame.h"
#include "PerformanceEntry.h"
#include "PerformanceMarkOptions.h"
#include "PerformanceMeasureOptions.h"
#include "PerformanceObserver.h"
#include "PerformanceResourceTiming.h"
#include "PerformanceTiming.h"
#include "PerformanceUserTiming.h"
#include "ScriptExecutionContext.h"
#include <wtf/TZoneMallocInlines.h>
#include "BunClientData.h"

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(Performance);

static constexpr Seconds timePrecision { 1_ms };

Performance::Performance(ScriptExecutionContext* context, MonotonicTime timeOrigin)
    : ContextDestructionObserver(context)
    , m_timeOrigin(timeOrigin)
{
    ASSERT(m_timeOrigin);
}

Performance::~Performance() = default;

void Performance::contextDestroyed()
{
    ContextDestructionObserver::contextDestroyed();
}

DOMHighResTimeStamp Performance::now() const
{
    auto nowNano = Bun__readOriginTimer(bunVM(scriptExecutionContext()->vm()));
    return static_cast<double>(nowNano) / 1000000.0;
}

DOMHighResTimeStamp Performance::timeOrigin() const
{
    // Read it each time: bun:test fake timers move the origin along with now().
    return Bun__readOriginTimerStart(bunVM(scriptExecutionContext()->vm()));
}

Seconds Performance::reduceTimeResolution(Seconds seconds)
{
    double resolution = timePrecision.seconds();
    double reduced = std::floor(seconds.seconds() / resolution) * resolution;
    return Seconds(reduced);
}

MonotonicTime Performance::monotonicTimeFromRelativeTime(DOMHighResTimeStamp relativeTime) const
{
    return m_timeOrigin + Seconds::fromMilliseconds(relativeTime);
}

PerformanceTiming* Performance::timing()
{
    if (!m_timing)
        m_timing = PerformanceTiming::create();
    return m_timing.get();
}

Vector<RefPtr<PerformanceEntry>> Performance::getEntries() const
{
    Vector<RefPtr<PerformanceEntry>> entries;

    // entries.appendVector(m_resourceTimingBuffer);

    if (m_userTiming) {
        entries.appendVector(m_userTiming->getMarks());
        entries.appendVector(m_userTiming->getMeasures());
    }

    std::sort(entries.begin(), entries.end(), PerformanceEntry::startTimeCompareLessThan);
    return entries;
}

Vector<RefPtr<PerformanceEntry>> Performance::getEntriesByType(const String& entryType) const
{
    Vector<RefPtr<PerformanceEntry>> entries;

    if (entryType == "resource"_s)
        entries.appendVector(m_resourceTimingBuffer);

    if (m_userTiming) {
        if (entryType == "mark"_s)
            entries.appendVector(m_userTiming->getMarks());
        else if (entryType == "measure"_s)
            entries.appendVector(m_userTiming->getMeasures());
    }

    std::sort(entries.begin(), entries.end(), PerformanceEntry::startTimeCompareLessThan);
    return entries;
}

size_t Performance::memoryCost() const
{
    size_t size = sizeof(Performance);
    size += m_resourceTimingBuffer.size() * sizeof(PerformanceResourceTiming);
    if (m_userTiming) {
        size += m_userTiming->memoryCost();
    }
    return size;
}

Vector<RefPtr<PerformanceEntry>> Performance::getEntriesByName(const String& name, const String& entryType) const
{
    Vector<RefPtr<PerformanceEntry>> entries;

    if (entryType.isNull() || entryType == "resource"_s) {
        for (auto& resource : m_resourceTimingBuffer) {
            if (resource->name() == name)
                entries.append(resource);
        }
    }

    if (m_userTiming) {
        if (entryType.isNull() || entryType == "mark"_s)
            entries.appendVector(m_userTiming->getMarks(name));
        if (entryType.isNull() || entryType == "measure"_s)
            entries.appendVector(m_userTiming->getMeasures(name));
    }

    std::sort(entries.begin(), entries.end(), PerformanceEntry::startTimeCompareLessThan);
    return entries;
}

void Performance::appendBufferedEntriesByType(const String& entryType, Vector<RefPtr<PerformanceEntry>>& entries) const
{
    if (entryType == "resource"_s)
        entries.appendVector(m_resourceTimingBuffer);
    if (m_userTiming) {
        if (entryType.isNull() || entryType == "mark"_s)
            entries.appendVector(m_userTiming->getMarks());
        if (entryType.isNull() || entryType == "measure"_s)
            entries.appendVector(m_userTiming->getMeasures());
    }
}

void Performance::clearResourceTimings()
{
    m_resourceTimingBuffer.clear();
}

void Performance::setResourceTimingBufferSize(unsigned)
{
}

ExceptionOr<Ref<PerformanceMark>> Performance::mark(JSC::JSGlobalObject& globalObject, const String& markName, std::optional<PerformanceMarkOptions>&& markOptions)
{
    if (!m_userTiming)
        m_userTiming = makeUnique<PerformanceUserTiming>(*this);

    auto mark = m_userTiming->mark(globalObject, markName, WTF::move(markOptions));
    if (mark.hasException())
        return mark.releaseException();

    queueEntry(mark.returnValue().get());
    return mark.releaseReturnValue();
}

void Performance::clearMarks(const String& markName)
{
    if (!m_userTiming)
        m_userTiming = makeUnique<PerformanceUserTiming>(*this);
    m_userTiming->clearMarks(markName);
}

ExceptionOr<Ref<PerformanceMeasure>> Performance::measure(JSC::JSGlobalObject& globalObject, const String& measureName, std::optional<StartOrMeasureOptions>&& startOrMeasureOptions, const String& endMark)
{
    if (!m_userTiming)
        m_userTiming = makeUnique<PerformanceUserTiming>(*this);

    auto measure = m_userTiming->measure(globalObject, measureName, WTF::move(startOrMeasureOptions), endMark);
    if (measure.hasException())
        return measure.releaseException();

    queueEntry(measure.returnValue().get());
    return measure.releaseReturnValue();
}

void Performance::clearMeasures(const String& measureName)
{
    if (!m_userTiming)
        m_userTiming = makeUnique<PerformanceUserTiming>(*this);
    m_userTiming->clearMeasures(measureName);
}

void Performance::removeAllObservers()
{
    for (auto& observer : m_observers)
        observer->disassociate();
    m_observers.clear();
}

void Performance::registerPerformanceObserver(PerformanceObserver& observer)
{
    m_observers.add(&observer);
}

void Performance::unregisterPerformanceObserver(PerformanceObserver& observer)
{
    m_observers.remove(&observer);
}

void Performance::queueEntry(PerformanceEntry& entry)
{
    bool shouldScheduleTask = false;
    for (auto& observer : m_observers) {
        if (observer->typeFilter().contains(entry.performanceEntryType())) {
            observer->queueEntry(entry);
            shouldScheduleTask = true;
        }
    }

    if (!shouldScheduleTask)
        return;

    scheduleTaskIfNeeded();
}

void Performance::scheduleTaskIfNeeded()
{
    if (m_hasScheduledTimingBufferDeliveryTask)
        return;

    auto* context = scriptExecutionContext();
    if (!context)
        return;

    m_hasScheduledTimingBufferDeliveryTask = true;
    context->postTask([protectedThis = Ref { *this }, this](ScriptExecutionContext& context) {
        m_hasScheduledTimingBufferDeliveryTask = false;
        for (auto& observer : copyToVector(m_observers))
            observer->deliver();
    });
}

} // namespace WebCore
