/*
 * Copyright (C) 2017-2023 Apple Inc. All rights reserved.
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
#include "AbortSignal.h"

#include "AbortAlgorithm.h"
#include "DOMException.h"
// #include "DOMTimer.h"
#include "Event.h"
#include "EventNames.h"
#include "JSDOMException.h"
#include "JavaScriptCore/JSCJSValue.h"
#include "ScriptExecutionContext.h"
#include "WebCoreOpaqueRoot.h"
#include "wtf/DebugHeap.h"
#include <wtf/TZoneMallocInlines.h>
#include <JavaScriptCore/Exception.h>
#include <JavaScriptCore/JSCast.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(AbortSignal);

extern "C" AbortSignalTimeout AbortSignal__Timeout__create(void* vm, AbortSignal* signal, uint64_t milliseconds);
extern "C" void AbortSignal__Timeout__deinit(AbortSignalTimeout timeout);

Ref<AbortSignal> AbortSignal::create(ScriptExecutionContext* context)
{
    return adoptRef(*new AbortSignal(context));
}

// https://dom.spec.whatwg.org/#dom-abortsignal-abort
Ref<AbortSignal> AbortSignal::abort(ScriptExecutionContext& context, JSC::JSValue reason)
{
    ASSERT(reason);
    // Defer the default to jsReason(); m_reason's JSC::Weak has no owner until toJSNewlyCreated().
    auto signal = adoptRef(*new AbortSignal(&context, Aborted::Yes, reason));
    if (reason.isUndefined())
        signal->m_commonReason = CommonAbortReason::UserAbort;
    return signal;
}

// https://dom.spec.whatwg.org/#dom-abortsignal-timeout
Ref<AbortSignal> AbortSignal::timeout(ScriptExecutionContext& context, uint64_t milliseconds)
{
    auto signal = adoptRef(*new AbortSignal(&context));
    // The native timer holds a raw back-pointer to the signal but no refcount.
    // The JS wrapper is the sole owner; isReachableFromOpaqueRoots keeps it
    // alive while an abort listener or an AbortSignal.any() dependent observes
    // the timeout. With no observer, collecting the wrapper destroys the
    // signal and ~AbortSignal() cancels and frees the timer.
    signal->m_timeout = AbortSignal__Timeout__create(bunVM(context.vm()), signal.ptr(), milliseconds);
    ASSERT(signal->m_timeout);
    return signal;
}

Ref<AbortSignal> AbortSignal::any(ScriptExecutionContext& context, const Vector<RefPtr<AbortSignal>>& signals)
{
    Ref resultSignal = AbortSignal::create(&context);

    auto abortedSignalIndex = signals.findIf([](auto& signal) { return signal->aborted(); });
    if (abortedSignalIndex != notFound) {
        resultSignal->signalAbort(signals[abortedSignalIndex]->jsReason(*context.jsGlobalObject()));
        return resultSignal;
    }

    resultSignal->markAsDependent();
    for (auto& signal : signals)
        resultSignal->addSourceSignal(*signal);

    return resultSignal;
}

AbortSignal::AbortSignal(ScriptExecutionContext* context, Aborted aborted, JSC::JSValue reason)
    : ContextDestructionObserver(context)
    , m_reason(reason)
    , m_flags(aborted == Aborted::Yes ? static_cast<uint8_t>(AbortSignalFlags::Aborted) : 0)
{
    ASSERT(reason);
}

AbortSignal::~AbortSignal()
{
    releaseSourceObserverCounts();

    // Invalidate WeakPtrs to this signal before our members (notably
    // m_algorithms) are destroyed. A listener registered on this signal
    // with { signal: this } stores a WeakPtr<AbortSignal> back to us on its
    // RegisteredEventListener; without this the base ~EventTarget() (which
    // runs after m_algorithms is freed but before the CanMakeWeakPtr base
    // destructor revokes the factory) would call markAsRemoved(), resolve
    // that WeakPtr, ref() a mid-deletion object, and call removeAlgorithm()
    // on the freed vector. Clearing only the impl's object pointer leaves
    // the impl itself (and the EventTargetData it hosts) intact so
    // ~EventTarget()'s eventTargetData() lookup still works.
    if (auto* impl = EventTargetWithInlineData::weakPtrFactory().impl())
        impl->clear();

    cancelTimer();
}

JSValue AbortSignal::jsReason(JSC::JSGlobalObject& globalObject)
{
    JSValue existingValue = m_reason.getValue(jsUndefined());
    if (existingValue.isUndefined()) {
        if (m_commonReason != CommonAbortReason::None) {
            existingValue = toJS(&globalObject, m_commonReason);
            m_commonReason = CommonAbortReason::None;
            m_reason.set(globalObject.vm(), wrapper(), existingValue);
        }
    }

    return existingValue;
}

void AbortSignal::addSourceSignal(AbortSignal& signal)
{
    if (signal.isDependent()) {
        for (Ref sourceSignal : signal.sourceSignals())
            addSourceSignal(sourceSignal);
        return;
    }
    ASSERT(!signal.aborted());
    ASSERT(signal.sourceSignals().isEmptyIgnoringNullReferences());
    if (m_sourceSignals.add(signal).isNewEntry)
        signal.addDependentSignal(*this);
}

void AbortSignal::addDependentSignal(AbortSignal& signal)
{
    if (m_dependentSignals.add(signal).isNewEntry)
        m_timeoutObserverCount.fetch_add(1, std::memory_order_relaxed);
}

// Release the observer count this dependent took on each source in
// addDependentSignal(). Called from both markAborted() (which clears
// m_sourceSignals) and ~AbortSignal().
void AbortSignal::releaseSourceObserverCounts()
{
    for (Ref source : m_sourceSignals)
        source->m_timeoutObserverCount.fetch_sub(1, std::memory_order_relaxed);
}

void AbortSignal::cancelTimer()
{
    if (auto timeout = std::exchange(m_timeout, nullptr)) {
        AbortSignal__Timeout__deinit(timeout);
    }
}

void AbortSignal::markAborted(JSC::JSValue reason)
{
    applyFlags(static_cast<uint8_t>(AbortSignalFlags::Aborted) | static_cast<uint8_t>(AbortSignalFlags::IsFiringEventListeners));
    releaseSourceObserverCounts();
    m_sourceSignals.clear();

    ASSERT(reason);
    if (auto* context = scriptExecutionContext())
        m_reason.set(context->vm(), wrapper(), reason);
    else
        m_reason.setWeakly(reason);

    cancelTimer();
}

void AbortSignal::runAbortSteps()
{
    auto reason = m_reason.getValue();
    ASSERT(reason);

    auto callbacks = std::exchange(m_native_callbacks, {});
    m_nativeCallbacksBeingDispatched = &callbacks;
    for (auto& callback : callbacks) {
        const auto [ctx, func] = callback;
        if (!func)
            continue;
        func(ctx, JSC::JSValue::encode(reason));
    }
    m_nativeCallbacksBeingDispatched = nullptr;

    // 1. For each algorithm of signal's abort algorithms: run algorithm.
    //    2. Empty signal's abort algorithms. (std::exchange empties)
    for (auto& algorithm : std::exchange(m_algorithms, {}))
        algorithm.second(reason);

    Vector<std::pair<uint32_t, Ref<AbortAlgorithm>>> abortAlgorithms;
    {
        Locker locker { m_abortAlgorithmsLock };
        abortAlgorithms = std::exchange(m_abortAlgorithms, {});
    }
    for (auto& pair : abortAlgorithms)
        pair.second->handleEvent(reason);

    // 3. Fire an event named abort at signal.
    if (hasEventListeners(eventNames().abortEvent))
        dispatchEvent(Event::create(eventNames().abortEvent, Event::CanBubble::No, Event::IsCancelable::No));
    setIsFiringEventListeners(false);
}

// https://dom.spec.whatwg.org/#abortsignal-signal-abort
void AbortSignal::signalAbort(JSC::JSValue reason)
{
    // 1. If signal’s aborted flag is set, then return.
    if (aborted())
        return;

    // Firing abort listeners (ours and dependent signals') can re-enter JS and
    // trigger GC. Once we clear IsFiringEventListeners the wrapper may become
    // unreachable, so keep `this` alive across the whole dispatch.
    Ref protectedThis { *this };

    // 2. Set signal’s abort reason to reason if it is given; otherwise to a new "AbortError" DOMException.
    markAborted(reason);

    Vector<Ref<AbortSignal>> dependentSignalsToAbort;

    for (Ref dependentSignal : std::exchange(m_dependentSignals, {})) {
        if (!dependentSignal->aborted()) {
            dependentSignal->markAborted(reason);
            dependentSignalsToAbort.append(WTF::move(dependentSignal));
        }
    }

    // 5. Run the abort steps
    runAbortSteps();

    // 6. For each dependentSignal of dependentSignalsToAbort, run the abort steps for dependentSignal.
    for (auto& dependentSignal : dependentSignalsToAbort)
        dependentSignal->runAbortSteps();
}

void AbortSignal::signalAbort(JSC::JSGlobalObject* globalObject, CommonAbortReason reason)
{
    // 1. If signal's aborted flag is set, then return.
    if (aborted())
        return;

    // toJS() allocates a DOMException, which can GC. For an unobserved
    // timeout signal the wrapper is collectible at that point, so protect
    // `this` before the allocation rather than only inside signalAbort(JSValue).
    Ref protectedThis { *this };
    m_commonReason = reason;
    signalAbort(toJS(globalObject, reason));
}

void AbortSignal::cleanNativeBindings(void* ref)
{
    if (m_nativeCallbacksBeingDispatched) {
        for (auto& callback : *m_nativeCallbacksBeingDispatched) {
            if (std::get<0>(callback) == ref)
                std::get<1>(callback) = nullptr;
        }
    }

    auto callbacks = std::exchange(m_native_callbacks, {});

    callbacks.removeAllMatching([=](auto callback) {
        const auto [ctx, func] = callback;
        return ctx == ref;
    });

    std::exchange(m_native_callbacks, WTF::move(callbacks));
    this->eventListenersDidChange();
}

void AbortSignal::eventListenersDidChange()
{
    bool hadListeners = hasAbortEventListener();
    bool hasListeners = hasEventListeners(eventNames().abortEvent) or !m_native_callbacks.isEmpty();
    setHasAbortEventListener(hasListeners);
    if (hasListeners != hadListeners) {
        if (hasListeners)
            m_timeoutObserverCount.fetch_add(1, std::memory_order_relaxed);
        else
            m_timeoutObserverCount.fetch_sub(1, std::memory_order_relaxed);
    }
}

uint32_t AbortSignal::addAbortAlgorithmToSignal(AbortSignal& signal, Ref<AbortAlgorithm>&& algorithm)
{
    if (signal.aborted()) {
        // TODO: Null check.
        algorithm->handleEvent(signal.jsReason(*signal.scriptExecutionContext()->jsGlobalObject()));
        return 0;
    }
    auto identifier = ++signal.m_algorithmIdentifier;
    Locker locker { signal.m_abortAlgorithmsLock };
    signal.m_abortAlgorithms.append(std::make_pair(identifier, WTF::move(algorithm)));
    signal.m_timeoutObserverCount.fetch_add(1, std::memory_order_relaxed);
    return identifier;
}

void AbortSignal::removeAbortAlgorithmFromSignal(AbortSignal& signal, uint32_t algorithmIdentifier)
{
    Locker locker { signal.m_abortAlgorithmsLock };
    if (signal.m_abortAlgorithms.removeFirstMatching([algorithmIdentifier](auto& pair) {
            return pair.first == algorithmIdentifier;
        }))
        signal.m_timeoutObserverCount.fetch_sub(1, std::memory_order_relaxed);
}

uint32_t AbortSignal::addAlgorithm(Algorithm&& algorithm)
{
    m_algorithms.append(std::make_pair(++m_algorithmIdentifier, WTF::move(algorithm)));
    m_timeoutObserverCount.fetch_add(1, std::memory_order_relaxed);
    return m_algorithmIdentifier;
}

void AbortSignal::removeAlgorithm(uint32_t algorithmIdentifier)
{
    if (m_algorithms.removeFirstMatching([algorithmIdentifier](auto& pair) {
            return pair.first == algorithmIdentifier;
        }))
        m_timeoutObserverCount.fetch_sub(1, std::memory_order_relaxed);
}

void AbortSignal::throwIfAborted(JSC::JSGlobalObject& lexicalGlobalObject)
{
    if (!aborted())
        return;

    Ref vm = lexicalGlobalObject.vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue reason = jsReason(lexicalGlobalObject);
    RETURN_IF_EXCEPTION(scope, );
    throwException(&lexicalGlobalObject, scope, reason);
}

WebCoreOpaqueRoot root(AbortSignal* signal)
{
    return WebCoreOpaqueRoot { signal };
}

size_t AbortSignal::memoryCost() const
{
    return sizeof(AbortSignal) + m_native_callbacks.sizeInBytes() + m_algorithms.sizeInBytes() + m_abortAlgorithms.sizeInBytes() + m_sourceSignals.capacity() + m_dependentSignals.capacity();
}

template<typename Visitor>
void AbortSignal::visitAbortAlgorithms(Visitor& visitor)
{
    Locker locker { m_abortAlgorithmsLock };
    for (auto& pair : m_abortAlgorithms)
        pair.second->visitJSFunction(visitor);
}

template void AbortSignal::visitAbortAlgorithms(JSC::AbstractSlotVisitor&);
template void AbortSignal::visitAbortAlgorithms(JSC::SlotVisitor&);

} // namespace WebCore
