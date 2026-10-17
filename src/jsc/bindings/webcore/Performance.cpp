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
#include "InternalModuleRegistry.h"
#include "JSPerformance.h"
#include "JSPerformanceEntry.h"
#include "JSPerformanceMark.h"
#include "JSPerformanceMeasure.h"
#include "JSPerformanceObserver.h"
#include "JSPerformanceObserverEntryList.h"
#include "JSPerformanceResourceTiming.h"
#include "headers.h"
#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/JSCInlines.h>

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

    return m_userTiming->mark(globalObject, markName, WTF::move(markOptions));
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

    return m_userTiming->measure(globalObject, measureName, WTF::move(startOrMeasureOptions), endMark);
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
    m_observersPendingOnImmediate.clear();
    m_nodeObserverCounts.fill(0);
}

void Performance::registerPerformanceObserver(PerformanceObserver& observer)
{
    m_observers.add(&observer);
}

void Performance::unregisterPerformanceObserver(PerformanceObserver& observer)
{
    m_observers.remove(&observer);
    m_observersPendingOnImmediate.remove(&observer);
}

void Performance::disconnectObserversOf(const ScriptExecutionContext& context)
{
    for (auto& observer : copyToVector(m_observers)) {
        if (observer->scriptExecutionContext() == &context)
            observer->disconnect();
    }
}

void Performance::willObserveNodeTypes(JSDOMGlobalObject& globalObject)
{
    if (m_nodeObserverCountsForScript)
        return;

    auto& vm = globalObject.vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSC::JSValue shared = globalObject.internalModuleRegistry()->requireId(&globalObject, vm, Bun::InternalModuleRegistry::Field::InternalShared);
    RETURN_IF_EXCEPTION(scope, );
    auto* exports = shared.getObject();
    JSC::JSValue counts = exports->get(&globalObject, JSC::Identifier::fromString(vm, "observerCounts"_s));
    RETURN_IF_EXCEPTION(scope, );
    JSC::JSValue nodeEntry = exports->get(&globalObject, JSC::Identifier::fromString(vm, "PerformanceNodeEntry"_s));
    RETURN_IF_EXCEPTION(scope, );
    JSC::JSValue nodeEntryPrototype = nodeEntry.get(&globalObject, vm.propertyNames->prototype);
    RETURN_IF_EXCEPTION(scope, );

    // Linked here, not at module load: that would create the PerformanceEntry constructor in every process that loads a node: module.
    asObject(nodeEntryPrototype)->setPrototypeDirect(vm, JSPerformanceEntry::prototype(vm, globalObject));
    asObject(nodeEntry)->setPrototypeDirect(vm, JSPerformanceEntry::getConstructor(vm, &globalObject));
    m_nodeObserverCountsForScript = JSC::Weak<JSC::JSArray>(JSC::asArray(counts));
}

void Performance::observedTypesDidChange(OptionSet<PerformanceEntry::Type> before, OptionSet<PerformanceEntry::Type> after)
{
    auto changed = (before ^ after) & PerformanceEntry::nodeTypes();
    if (changed.isEmpty())
        return;

    auto* context = scriptExecutionContext();
    auto* countsForScript = context ? m_nodeObserverCountsForScript.get() : nullptr;
    for (auto type : changed) {
        auto index = PerformanceEntry::nodeTypeIndex(type);
        auto& count = m_nodeObserverCounts[index];
        if (after.contains(type))
            ++count;
        else
            --count;
        if (!countsForScript)
            continue;
        auto* globalObject = context->globalObject();
        auto scope = DECLARE_TOP_EXCEPTION_SCOPE(globalObject->vm());
        countsForScript->putDirectIndex(globalObject, index, JSC::jsNumber(count));
        if (scope.exception()) [[unlikely]]
            (void)scope.tryClearException();
    }
}

void Performance::queueEntryForObservers(JSC::VM& vm, JSC::JSObject& entry, PerformanceEntry::Type type)
{
    bool hasQueuedForTask = false;
    for (auto& observer : m_observers) {
        if (!observer->typeFilter().contains(type))
            continue;
        observer->queueEntry(vm, entry);
        if (observer->deliversOnImmediate())
            scheduleImmediateDelivery(*observer);
        else
            hasQueuedForTask = true;
    }
    if (hasQueuedForTask && !m_hasScheduledTimingBufferDeliveryTask)
        scheduleTaskIfNeeded();
}

// Out of line, to keep small what an observer of marks adds to each performance.mark().
NEVER_INLINE void Performance::scheduleImmediateDelivery(PerformanceObserver& observer)
{
    m_observersPendingOnImmediate.add(&observer);
    scheduleImmediateIfNeeded();
}

void Performance::scheduleDelivery(PerformanceObserver& observer)
{
    if (observer.deliversOnImmediate())
        scheduleImmediateDelivery(observer);
    else
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
        for (auto& observer : copyToVector(m_observers)) {
            if (!observer->deliversOnImmediate())
                observer->deliver();
        }
    });
}

// With a Bun.ModuleGraph in the realm, no graph owns the immediate (dispose() does not drop it) and no callback sees a graph's AsyncLocalStorage stores.
class NoAsyncContextInRealmWithModuleGraphs {
    WTF_MAKE_NONCOPYABLE(NoAsyncContextInRealmWithModuleGraphs);
    WTF_FORBID_HEAP_ALLOCATION;

public:
    explicit NoAsyncContextInRealmWithModuleGraphs(Zig::GlobalObject& globalObject)
    {
        if (!globalObject.hasModuleGraphs()) [[likely]]
            return;
        m_globalObject = &globalObject;
        auto* asyncContextData = globalObject.m_asyncContextData.get();
        m_previous = asyncContextData->getInternalField(0);
        asyncContextData->putInternalField(globalObject.vm(), 0, JSC::jsUndefined());
    }

    ~NoAsyncContextInRealmWithModuleGraphs()
    {
        if (m_globalObject)
            m_globalObject->m_asyncContextData.get()->putInternalField(m_globalObject->vm(), 0, m_previous);
    }

private:
    Zig::GlobalObject* m_globalObject { nullptr };
    JSC::JSValue m_previous;
};

JSC_DEFINE_HOST_FUNCTION(jsFunctionDeliverPerformanceEntries, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame*))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (RefPtr performance = defaultGlobalObject(lexicalGlobalObject)->existingPerformance())
        performance->deliverOnImmediate();
    RETURN_IF_EXCEPTION(scope, {});
    return JSC::JSValue::encode(JSC::jsUndefined());
}

// Node's one setImmediate() for every pending observer: https://github.com/nodejs/node/blob/v26.3.0/lib/internal/perf/observe.js#L117-L127
void Performance::scheduleImmediateIfNeeded()
{
    if (m_hasScheduledImmediateDelivery)
        return;

    auto* context = scriptExecutionContext();
    if (!context || context->isJSExecutionForbidden())
        return;

    auto* globalObject = uncheckedDowncast<Zig::GlobalObject>(context->globalObject());
    auto& vm = globalObject->vm();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    {
        NoAsyncContextInRealmWithModuleGraphs noAsyncContext(*globalObject);
        auto* deliver = JSC::JSFunction::create(vm, globalObject, 0, String(), jsFunctionDeliverPerformanceEntries, JSC::ImplementationVisibility::Private);
        Bun__Timer__setImmediate(globalObject, JSC::JSValue::encode(deliver), JSC::JSValue::encode(JSC::jsUndefined()));
    }
    if (scope.exception()) [[unlikely]] {
        (void)scope.tryClearException();
        return;
    }
    m_hasScheduledImmediateDelivery = true;
}

void Performance::deliverOnImmediate()
{
    m_hasScheduledImmediateDelivery = false;
    auto* context = scriptExecutionContext();
    if (!context)
        return;
    // Also for an immediate that was set before the realm had its first graph.
    NoAsyncContextInRealmWithModuleGraphs noAsyncContext(*uncheckedDowncast<Zig::GlobalObject>(context->globalObject()));
    // An observer that observes web types only by now has a task to deliver it.
    for (auto& observer : std::exchange(m_observersPendingOnImmediate, {})) {
        if (observer->deliversOnImmediate())
            observer->deliver();
    }
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionQueueNodePerformanceEntry, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    RefPtr performance = defaultGlobalObject(lexicalGlobalObject)->existingPerformance();
    auto* entry = callFrame->argument(0).getObject();
    JSC::JSValue typeIndex = callFrame->argument(1);
    if (!performance || !entry || !typeIndex.isUInt32() || typeIndex.asUInt32() >= PerformanceEntry::numberOfNodeTypes) [[unlikely]]
        return JSC::JSValue::encode(JSC::jsUndefined());
    auto type = PerformanceEntry::nodeTypeAtIndex(typeIndex.asUInt32());
    performance->queueEntry(JSC::getVM(lexicalGlobalObject), *entry, type);
    return JSC::JSValue::encode(JSC::jsUndefined());
}

JSC::JSValue createNodePerfHooksBinding(Zig::GlobalObject* globalObject)
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSC::MarkedArgumentBuffer classes;
    classes.append(JSPerformance::getConstructor(vm, globalObject));
    classes.append(JSPerformanceEntry::getConstructor(vm, globalObject));
    classes.append(JSPerformanceMark::getConstructor(vm, globalObject));
    classes.append(JSPerformanceMeasure::getConstructor(vm, globalObject));
    classes.append(JSPerformanceObserver::getConstructor(vm, globalObject));
    classes.append(JSPerformanceObserverEntryList::getConstructor(vm, globalObject));
    classes.append(JSPerformanceResourceTiming::getConstructor(vm, globalObject));
    RELEASE_AND_RETURN(scope, JSC::constructArray(globalObject, static_cast<JSC::ArrayAllocationProfile*>(nullptr), classes));
}

} // namespace WebCore
