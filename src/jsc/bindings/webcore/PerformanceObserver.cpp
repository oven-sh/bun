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
    auto* context = m_callback->scriptExecutionContext();
    m_isOfModuleGraph = context && context->isForModuleGraph();
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

    // What a disposed Bun.ModuleGraph had queued still runs: its observers observe nothing more (Performance::disconnectObserversOf).
    if (m_isOfModuleGraph) {
        auto* context = scriptExecutionContext();
        if (!context || context->isStopped())
            return {};
    }

    auto& vm = globalObject.vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    // Node's checks in node's order, null members included: https://github.com/nodejs/node/blob/v26.3.0/lib/internal/perf/observe.js#L257-L301
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
            // Node disconnects (https://github.com/nodejs/node/blob/v26.3.0/lib/internal/perf/observe.js#L313-L316). The specification keeps an observer of web types registered.
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

    // The buffered entries join the queue in start order, as in node: https://github.com/nodejs/node/blob/v26.3.0/lib/internal/perf/observe.js#L304-L310
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
    bool wasDeliveredOnImmediate = deliversOnImmediate();
    m_typeFilter = filter;
    if (!m_registered) {
        m_performance->registerPerformanceObserver(*this);
        m_registered = true;
    }
    m_performance->observedTypesDidChange(previousFilter, filter);

    // A buffered observe() takes its place in the next delivery, as in node. Any other observe() leaves the place as it is, unless it moved queued entries to the other kind of delivery.
    bool needsDelivery = init.type && init.buffered ? deliversOnImmediate() || pendingEntries() : pendingEntries() && wasDeliveredOnImmediate != deliversOnImmediate();
    if (needsDelivery)
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
    // On out of memory the entry is not queued, and its producer goes on.
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

    // Its context is gone: nothing can call it, so it holds no queue and no place in the counts.
    if (!m_callback->scriptExecutionContext()) {
        disconnect();
        return;
    }

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
