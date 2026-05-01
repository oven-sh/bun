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
// #include "PerformanceNavigation.h"
// #include "PerformanceNavigationTiming.h"
#include "PerformanceObserver.h"
// #include "PerformancePaintTiming.h"
#include "PerformanceResourceTiming.h"
#include "PerformanceTiming.h"
#include "PerformanceUserTiming.h"
// #include "ResourceResponse.h"
#include "ScriptExecutionContext.h"
#include <wtf/TZoneMallocInlines.h>
#include "BunClientData.h"

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(Performance);

constexpr Seconds highTimePrecision { 20_us };
static Seconds timePrecision { 1_ms };

Performance::Performance(ScriptExecutionContext* context, MonotonicTime timeOrigin)
    : ContextDestructionObserver(context)
    // , m_resourceTimingBufferFullTimer(*this, &Performance::resourceTimingBufferFullTimerFired) // FIXME: Migrate this to the event loop as well. https://bugs.webkit.org/show_bug.cgi?id=229044
    , m_timeOrigin(timeOrigin)
{
    ASSERT(m_timeOrigin);
}

Performance::~Performance() = default;

void Performance::contextDestroyed()
{
    // m_resourceTimingBufferFullTimer.stop();
    ContextDestructionObserver::contextDestroyed();
}

DOMHighResTimeStamp Performance::now() const
{
    auto nowNano = Bun__readOriginTimer(bunVM(scriptExecutionContext()->vm()));
    return static_cast<double>(nowNano) / 1000000.0;
}

DOMHighResTimeStamp Performance::timeOrigin() const
{
    // return reduceTimeResolution(m_timeOrigin.approximateWallTime().secondsSinceEpoch()).milliseconds();
    return m_timeOrigin.secondsSinceEpoch().milliseconds();
}

// ReducedResolutionSeconds Performance::nowInReducedResolutionSeconds() const
// {
//     Seconds now = MonotonicTime::now() - m_timeOrigin;
//     return reduceTimeResolution(now);
// }

Seconds Performance::reduceTimeResolution(Seconds seconds)
{
    double resolution = timePrecision.seconds();
    double reduced = std::floor(seconds.seconds() / resolution) * resolution;
    return Seconds(reduced);
}

void Performance::allowHighPrecisionTime()
{
    timePrecision = highTimePrecision;
}

Seconds Performance::timeResolution()
{
    return timePrecision;
}

DOMHighResTimeStamp Performance::relativeTimeFromTimeOriginInReducedResolution(MonotonicTime timestamp) const
{
    Seconds seconds = timestamp - m_timeOrigin;
    return reduceTimeResolution(seconds).milliseconds();
}

MonotonicTime Performance::monotonicTimeFromRelativeTime(DOMHighResTimeStamp relativeTime) const
{
    return m_timeOrigin + Seconds::fromMilliseconds(relativeTime);
}

// PerformanceNavigation* Performance::navigation()
// {
//     if (!is<Document>(scriptExecutionContext()))
//         return nullptr;

//     ASSERT(isMainThread());
//     if (!m_navigation)
//         m_navigation = PerformanceNavigation::create(downcast<Document>(*scriptExecutionContext()).domWindow());
//     return m_navigation.get();
// }

PerformanceTiming* Performance::timing()
{
    // if (!is<Document>(scriptExecutionContext()))
    //     return nullptr;
    // ASSERT(isMainThread());
    if (!m_timing)
        m_timing = PerformanceTiming::create();
    return m_timing.get();
}

Vector<RefPtr<PerformanceEntry>> Performance::getEntries() const
{
    Vector<RefPtr<PerformanceEntry>> entries;

    // if (m_navigationTiming)
    //     entries.append(m_navigationTiming);

    // entries.appendVector(m_resourceTimingBuffer);

    if (m_userTiming) {
        entries.appendVector(m_userTiming->getMarks());
        entries.appendVector(m_userTiming->getMeasures());
    }

    // if (m_firstContentfulPaint)
    //     entries.append(m_firstContentfulPaint);

    std::sort(entries.begin(), entries.end(), PerformanceEntry::startTimeCompareLessThan);
    return entries;
}

Vector<RefPtr<PerformanceEntry>> Performance::getEntriesByType(const String& entryType) const
{
    Vector<RefPtr<PerformanceEntry>> entries;

    // if (m_navigationTiming && entryType == "navigation"_s)
    //     entries.append(m_navigationTiming);

    if (entryType == "resource"_s)
        entries.appendVector(m_resourceTimingBuffer);

    // if (m_firstContentfulPaint && entryType == "paint"_s)
    //     entries.append(m_firstContentfulPaint);

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

    // if (m_navigationTiming && (entryType.isNull() || entryType == "navigation"_s) && name == m_navigationTiming->name())
    //     entries.append(m_navigationTiming);

    if (entryType.isNull() || entryType == "resource"_s) {
        for (auto& resource : m_resourceTimingBuffer) {
            if (resource->name() == name)
                entries.append(resource);
        }
    }

    // if (m_firstContentfulPaint && (entryType.isNull() || entryType == "paint"_s) && name == "first-contentful-paint"_s)
    //     entries.append(m_firstContentfulPaint);

    if (m_userTiming) {
        if (entryType.isNull() || entryType == "mark"_s)
            entries.appendVector(m_userTiming->getMarks(name));
        if (entryType.isNull() || entryType == "measure"_s)
            entries.appendVector(m_userTiming->getMeasures(name));
    }

    std::sort(entries.begin(), entries.end(), PerformanceEntry::startTimeCompareLessThan);
    return entries;
}

void Performance::appendBufferedEntriesByType(const String& entryType, Vector<RefPtr<PerformanceEntry>>& entries, PerformanceObserver& observer) const
{
    // if (m_navigationTiming
    //     && entryType == "navigation"_s
    //     && !observer.hasNavigationTiming()) {
    //     entries.append(m_navigationTiming);
    //     observer.addedNavigationTiming();
    // }

    if (entryType == "resource"_s)
        entries.appendVector(m_resourceTimingBuffer);

    // if (entryType == "paint"_s && m_firstContentfulPaint)
    //     entries.append(m_firstContentfulPaint);

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
    m_resourceTimingBufferFullFlag = false;
}

void Performance::setResourceTimingBufferSize(unsigned size)
{
    m_resourceTimingBufferSize = size;
    m_resourceTimingBufferFullFlag = false;
}

// void Performance::reportFirstContentfulPaint()
// {
//     ASSERT(!m_firstContentfulPaint);
//     m_firstContentfulPaint = PerformancePaintTiming::createFirstContentfulPaint(now());
//     queueEntry(*m_firstContentfulPaint);
// }

// void Performance::addNavigationTiming(DocumentLoader& documentLoader, Document& document, CachedResource& resource, const DocumentLoadTiming& timing, const NetworkLoadMetrics& metrics)
// {
//     ASSERT(document.settings().performanceNavigationTimingAPIEnabled());
//     m_navigationTiming = PerformanceNavigationTiming::create(m_timeOrigin, resource, timing, metrics, document.eventTiming(), document.securityOrigin(), documentLoader.triggeringAction().type());
// }

// void Performance::navigationFinished(const NetworkLoadMetrics& metrics)
// {
//     if (!m_navigationTiming)
//         return;
//     m_navigationTiming->navigationFinished(metrics);

//     queueEntry(*m_navigationTiming);
// }

void Performance::addResourceTiming(ResourceTiming&& resourceTiming)
{
    ASSERT(scriptExecutionContext());

    auto entry = PerformanceResourceTiming::create(m_timeOrigin, WTF::move(resourceTiming));

    if (m_waitingForBackupBufferToBeProcessed) {
        m_backupResourceTimingBuffer.append(WTF::move(entry));
        return;
    }

    if (m_resourceTimingBufferFullFlag) {
        // We fired resourcetimingbufferfull event but the author script didn't clear the buffer.
        // Notify performance observers but don't add it to the buffer.
        queueEntry(entry.get());
        return;
    }

    if (isResourceTimingBufferFull()) {
        // ASSERT(!m_resourceTimingBufferFullTimer.isActive());
        m_backupResourceTimingBuffer.append(WTF::move(entry));
        m_waitingForBackupBufferToBeProcessed = true;
        // m_resourceTimingBufferFullTimer.startOneShot(0_s);
        return;
    }

    queueEntry(entry.get());
    m_resourceTimingBuffer.append(WTF::move(entry));
}

bool Performance::isResourceTimingBufferFull() const
{
    return m_resourceTimingBuffer.size() >= m_resourceTimingBufferSize;
}

// void Performance::resourceTimingBufferFullTimerFired()
// {
//     ASSERT(scriptExecutionContext());

//     while (!m_backupResourceTimingBuffer.isEmpty()) {
//         auto beforeCount = m_backupResourceTimingBuffer.size();

//         auto backupBuffer = WTF::move(m_backupResourceTimingBuffer);
//         ASSERT(m_backupResourceTimingBuffer.isEmpty());

//         if (isResourceTimingBufferFull()) {
//             m_resourceTimingBufferFullFlag = true;
//             dispatchEvent(Event::create(eventNames().resourcetimingbufferfullEvent, Event::CanBubble::No, Event::IsCancelable::No));
//         }

//         if (m_resourceTimingBufferFullFlag) {
//             for (auto& entry : backupBuffer)
//                 queueEntry(*entry);
//             // Dispatching resourcetimingbufferfull event may have inserted more entries.
//             for (auto& entry : m_backupResourceTimingBuffer)
//                 queueEntry(*entry);
//             m_backupResourceTimingBuffer.clear();
//             break;
//         }

//         // More entries may have added while dispatching resourcetimingbufferfull event.
//         backupBuffer.appendVector(m_backupResourceTimingBuffer);
//         m_backupResourceTimingBuffer.clear();

//         for (auto& entry : backupBuffer) {
//             if (!isResourceTimingBufferFull()) {
//                 m_resourceTimingBuffer.append(entry.copyRef());
//                 queueEntry(*entry);
//             } else
//                 m_backupResourceTimingBuffer.append(entry.copyRef());
//         }

//         auto afterCount = m_backupResourceTimingBuffer.size();

//         if (beforeCount <= afterCount) {
//             m_backupResourceTimingBuffer.clear();
//             break;
//         }
//     }
//     m_waitingForBackupBufferToBeProcessed = false;
// }

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

    // if (m_navigationTiming
    //     && observer.typeFilter().contains(PerformanceEntry::Type::Navigation)
    //     && !observer.hasNavigationTiming()) {
    //     observer.queueEntry(*m_navigationTiming);
    //     observer.addedNavigationTiming();
    // }
}

void Performance::unregisterPerformanceObserver(PerformanceObserver& observer)
{
    m_observers.remove(&observer);
}

// void Performance::scheduleNavigationObservationTaskIfNeeded()
// {
//     if (m_navigationTiming)
//         scheduleTaskIfNeeded();
// }

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
