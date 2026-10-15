/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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
 * THIS SOFTWARE IS PROVIDED BY APPLE INC. AND ITS CONTRIBUTORS ``AS IS''
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO,
 * THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL APPLE INC. OR ITS CONTRIBUTORS
 * BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 * CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 * SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
 * INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
 * CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF
 * THE POSSIBILITY OF SUCH DAMAGE.
 */

#include "config.h"
#include "PerformanceObserver.h"

#include "JSDOMExceptionHandling.h"
#include "JSPerformanceEntry.h"
#include "JSPerformanceObserver.h"
#include "Performance.h"
#include "ScriptExecutionContext.h"
#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/JSCInlines.h>
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(PerformanceObserver);

PerformanceObserver::PerformanceObserver(ScriptExecutionContext& scriptExecutionContext, Ref<PerformanceObserverCallback>&& callback)
    : m_callback(WTF::move(callback))
{
    m_performance = uncheckedDowncast<Zig::GlobalObject>(scriptExecutionContext.globalObject())->performance();
}

ScriptExecutionContext* PerformanceObserver::scriptExecutionContext() const
{
    return m_callback->scriptExecutionContext();
}

void PerformanceObserver::disassociate()
{
    m_performance = nullptr;
    m_registered = false;
}

// A registered observer has its wrapper (JSPerformanceObserverOwner::isReachableFromOpaqueRoots).
static JSPerformanceObserver* wrapperOf(const PerformanceObserver& observer)
{
    return static_cast<JSPerformanceObserver*>(observer.wrapper());
}

JSC::JSArray* PerformanceObserver::pendingEntries() const
{
    auto* wrapper = wrapperOf(*this);
    return wrapper ? wrapper->m_pendingEntries.get() : nullptr;
}

ExceptionOr<void> PerformanceObserver::observe(JSDOMGlobalObject& globalObject, Init&& init)
{
    if (!m_performance)
        return Exception { TypeError };

    auto* context = scriptExecutionContext();
    // The observers that a Bun.ModuleGraph's script made stop with it
    // (Performance::disconnectObserversOf). What the script had queued still runs, and observes
    // nothing more.
    if (context && context->isForModuleGraph() && context->isStopped())
        return {};

    auto& vm = globalObject.vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    // Node's checks, in node's order. A member that is null is set for some of them and missing
    // for others:
    // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/perf/observe.js#L257-L301
    if (!init.hasEntryTypes && !init.hasType)
        return Exception { TypeError, "no type or entryTypes were provided"_s };
    if (init.entryTypes && init.type)
        return Exception { TypeError, "either entryTypes or type must be provided"_s };

    switch (m_mode) {
    case Mode::Unset:
        m_mode = init.hasType ? Mode::Type : Mode::EntryTypes;
        break;
    case Mode::Type:
        if (init.hasEntryTypes)
            return Exception { InvalidModificationError, "observer type can't be changed once registered"_s };
        break;
    case Mode::EntryTypes:
        if (init.hasType)
            return Exception { InvalidModificationError, "observer type can't be changed once registered"_s };
        break;
    }

    // `entryTypes` replaces what is observed, `type` adds to it.
    auto filter = m_typeFilter;
    if (m_mode == Mode::EntryTypes) {
        if (!init.entryTypes) {
            // null: what the conversion of any other value that is not a sequence throws.
            throwSequenceTypeError(globalObject, scope);
            return Exception { ExistingExceptionError };
        }
        filter = {};
        for (auto& entryType : *init.entryTypes) {
            if (auto type = PerformanceEntry::parseEntryTypeString(entryType))
                filter.add(*type);
        }
        if (filter.isEmpty()) {
            // Node stops an observer that is told to observe nothing it knows. One that is
            // registered for web types only keeps observing them, as the specification says.
            // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/perf/observe.js#L313-L316
            if (!m_registered || deliversOnImmediate())
                disconnect();
            return {};
        }
    } else {
        // A `type` that is null, or not a type there is, observes nothing and is not an error.
        auto type = init.type ? PerformanceEntry::parseEntryTypeString(*init.type) : std::nullopt;
        if (!type)
            return {};
        filter.add(*type);
    }

    if (filter.containsAny(PerformanceEntry::nodeTypes())) {
        m_performance->willObserveNodeTypes(globalObject);
        RETURN_IF_EXCEPTION(scope, Exception { ExistingExceptionError });
    }

    // As node does, the buffered entries join the queue, behind what is in it and in the order
    // they started, and are delivered with it.
    // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/perf/observe.js#L304-L310
    if (init.type && init.buffered) {
        Vector<RefPtr<PerformanceEntry>> buffered;
        m_performance->appendBufferedEntriesByType(*init.type, buffered);
        std::stable_sort(buffered.begin(), buffered.end(), PerformanceEntry::startTimeCompareLessThan);
        for (auto& entry : buffered) {
            JSC::JSValue wrapper = toJS(&globalObject, &globalObject, *entry);
            RETURN_IF_EXCEPTION(scope, Exception { ExistingExceptionError });
            queueEntry(vm, *asObject(wrapper));
        }
    }

    auto previousFilter = m_registered ? m_typeFilter : OptionSet<PerformanceEntry::Type> {};
    m_typeFilter = filter;
    if (!m_registered) {
        m_performance->registerPerformanceObserver(*this);
        m_registered = true;
    }
    m_performance->observedTypesDidChange(previousFilter, filter);

    // Also for what was queued before this call changed how the observer is delivered.
    if (pendingEntries())
        m_performance->scheduleDelivery(*this);

    return {};
}

JSC::JSArray* PerformanceObserver::takeRecords()
{
    auto* wrapper = wrapperOf(*this);
    if (!wrapper)
        return nullptr;
    auto* entries = wrapper->m_pendingEntries.get();
    wrapper->m_pendingEntries.clear();
    return entries;
}

void PerformanceObserver::disconnect()
{
    if (m_performance) {
        if (m_registered)
            m_performance->observedTypesDidChange(m_typeFilter, {});
        m_performance->unregisterPerformanceObserver(*this);
    }

    m_registered = false;
    if (auto* wrapper = wrapperOf(*this))
        wrapper->m_pendingEntries.clear();
    m_typeFilter = {};
    m_mode = Mode::Unset;
}

// The first entry, and one that does not fit in the array as it is.
void PerformanceObserver::queueEntrySlow(JSC::VM& vm, JSPerformanceObserver& wrapper, JSC::JSObject& entry)
{
    auto* globalObject = wrapper.globalObject();
    // Out of memory: the entry is not queued, and performance.mark() or the node: module that
    // produced it goes on.
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    auto* pending = wrapper.m_pendingEntries.get();
    bool isFirst = !pending;
    if (isFirst) {
        pending = JSC::JSArray::tryCreate(vm, globalObject->arrayStructureForIndexingTypeDuringAllocation(JSC::ArrayWithContiguous), 0, 4);
        if (!pending) [[unlikely]]
            return;
    }
    // Defines the element: unlike push(), it calls no setter that script put on Array.prototype.
    pending->putDirectIndex(globalObject, pending->length(), &entry);
    if (scope.exception()) [[unlikely]] {
        (void)scope.tryClearException();
        return;
    }
    if (isFirst)
        wrapper.m_pendingEntries.set(vm, &wrapper, pending);
}

void PerformanceObserver::deliver()
{
    if (!pendingEntries())
        return;

    auto* context = m_callback->scriptExecutionContext();
    if (!context)
        return;

    auto* entries = takeRecords();
    JSC::EnsureStillAliveScope keepEntries(entries);
    m_callback->handleEvent(*this, *entries, *this);
}

// Node's list: https://github.com/nodejs/node/blob/v26.3.0/lib/internal/perf/observe.js#L82-L93
Vector<String> PerformanceObserver::supportedEntryTypes()
{
    return {
        "dns"_s,
        "function"_s,
        "gc"_s,
        "http"_s,
        "http2"_s,
        "mark"_s,
        "measure"_s,
        "net"_s,
        "quic"_s,
        "resource"_s,
    };
}

} // namespace WebCore
