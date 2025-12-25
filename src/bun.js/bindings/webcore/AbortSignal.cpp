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
extern "C" void AbortSignal__Timeout__run(AbortSignalTimeout timeout, void* vm);
extern "C" void AbortSignal__Timeout__deinit(AbortSignalTimeout timeout, void*);

Ref<AbortSignal> AbortSignal::create(ScriptExecutionContext* context)
{
    return adoptRef(*new AbortSignal(context));
}

// https://dom.spec.whatwg.org/#dom-abortsignal-abort
Ref<AbortSignal> AbortSignal::abort(JSDOMGlobalObject& globalObject, ScriptExecutionContext& context, JSC::JSValue reason)
{
    ASSERT(reason);
    if (reason.isUndefined())
        reason = toJS(&globalObject, &globalObject, DOMException::create(ExceptionCode::AbortError));
    return adoptRef(*new AbortSignal(&context, Aborted::Yes, reason));
}

// https://dom.spec.whatwg.org/#dom-abortsignal-timeout
Ref<AbortSignal> AbortSignal::timeout(ScriptExecutionContext& context, uint64_t milliseconds)
{
    auto signal = adoptRef(*new AbortSignal(&context));
    signal->m_timeout = AbortSignal__Timeout__create(bunVM(context.vm()), signal.ptr(), milliseconds);
    ASSERT(signal->m_timeout);
    signal->ref();
    return signal;
}

Ref<AbortSignal> AbortSignal::any(ScriptExecutionContext& context, const Vector<RefPtr<AbortSignal>>& signals)
{
    Ref resultSignal = AbortSignal::create(&context);

    auto abortedSignalIndex = signals.findIf([](auto& signal) { return signal->aborted(); });
    if (abortedSignalIndex != notFound) {
        resultSignal->signalAbort(signals[abortedSignalIndex]->reason().getValue());
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
    cancelTimer();
}

JSValue AbortSignal::jsReason(JSC::JSGlobalObject& globalObject)
{
    JSValue existingValue = m_reason.getValue(jsUndefined());
    if (existingValue.isUndefined()) {
        if (m_commonReason != CommonAbortReason::None) {
            existingValue = toJS(&globalObject, m_commonReason);
            m_commonReason = CommonAbortReason::None;
            m_reason.setWeakly(existingValue);
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
    m_sourceSignals.add(signal);
    signal.addDependentSignal(*this);
}

void AbortSignal::addDependentSignal(AbortSignal& signal)
{
    m_dependentSignals.add(signal);
}

void AbortSignal::cancelTimer()
{
    if (auto timeout = std::exchange(m_timeout, nullptr)) {
        AbortSignal__Timeout__deinit(timeout, bunVM(scriptExecutionContext()->vm()));
    }
}

void AbortSignal::markAborted(JSC::JSValue reason)
{
    applyFlags(static_cast<uint8_t>(AbortSignalFlags::Aborted) | static_cast<uint8_t>(AbortSignalFlags::IsFiringEventListeners));
    m_sourceSignals.clear();

    // FIXME: This code is wrong: we should emit a write-barrier. Otherwise, GC can collect it.
    // https://bugs.webkit.org/show_bug.cgi?id=236353
    ASSERT(reason);
    m_reason.setWeakly(reason);

    cancelTimer();
}

void AbortSignal::runAbortSteps()
{
    auto reason = m_reason.getValue();
    ASSERT(reason);

    auto callbacks = std::exchange(m_native_callbacks, {});
    for (auto callback : callbacks) {
        const auto [ctx, func] = callback;
        func(ctx, JSC::JSValue::encode(reason));
    }

    // 1. For each algorithm of signal's abort algorithms: run algorithm.
    //    2. Empty signal's abort algorithms. (std::exchange empties)
    for (auto& algorithm : std::exchange(m_algorithms, {}))
        algorithm.second(reason);

    // 3. Fire an event named abort at signal.
    dispatchEvent(Event::create(eventNames().abortEvent, Event::CanBubble::No, Event::IsCancelable::No));

    setIsFiringEventListeners(false);
}

// https://dom.spec.whatwg.org/#abortsignal-signal-abort
void AbortSignal::signalAbort(JSC::JSValue reason)
{
    // 1. If signal's aborted flag is set, then return.
    if (aborted())
        return;

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

    m_commonReason = reason;
    signalAbort(toJS(globalObject, reason));
}

void AbortSignal::cleanNativeBindings(void* ref)
{
    auto callbacks = std::exchange(m_native_callbacks, {});

    callbacks.removeAllMatching([=](auto callback) {
        const auto [ctx, func] = callback;
        return ctx == ref;
    });

    std::exchange(m_native_callbacks, WTF::move(callbacks));
    this->eventListenersDidChange();
}

// https://dom.spec.whatwg.org/#abortsignal-follow
void AbortSignal::signalFollow(AbortSignal& signal)
{
    if (aborted())
        return;

    if (signal.aborted()) {
        signalAbort(signal.jsReason(*scriptExecutionContext()->jsGlobalObject()));
        return;
    }

    ASSERT(!m_followingSignal);
    m_followingSignal = signal;
    signal.addAlgorithm([weakThis = WeakPtr { *this }](JSC::JSValue reason) {
        if (RefPtr signal = weakThis.get())
            signal->signalAbort(reason);
    });
}

void AbortSignal::eventListenersDidChange()
{
    setHasAbortEventListener(hasEventListeners(eventNames().abortEvent) or !m_native_callbacks.isEmpty());
}

uint32_t AbortSignal::addAbortAlgorithmToSignal(AbortSignal& signal, Ref<AbortAlgorithm>&& algorithm)
{
    if (signal.aborted()) {
        // TODO: Null check.
        algorithm->handleEvent(signal.jsReason(*signal.scriptExecutionContext()->jsGlobalObject()));
        return 0;
    }
    return signal.addAlgorithm([algorithm = WTF::move(algorithm)](JSC::JSValue value) mutable {
        algorithm->handleEvent(value);
    });
}

void AbortSignal::removeAbortAlgorithmFromSignal(AbortSignal& signal, uint32_t algorithmIdentifier)
{
    signal.removeAlgorithm(algorithmIdentifier);
}

uint32_t AbortSignal::addAlgorithm(Algorithm&& algorithm)
{
    m_algorithms.append(std::make_pair(++m_algorithmIdentifier, WTF::move(algorithm)));
    return m_algorithmIdentifier;
}

void AbortSignal::removeAlgorithm(uint32_t algorithmIdentifier)
{
    m_algorithms.removeFirstMatching([algorithmIdentifier](auto& pair) {
        return pair.first == algorithmIdentifier;
    });
}

void AbortSignal::throwIfAborted(JSC::JSGlobalObject& lexicalGlobalObject)
{
    if (!aborted())
        return;

    Ref vm = lexicalGlobalObject.vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    throwException(&lexicalGlobalObject, scope, m_reason.getValue());
}

WebCoreOpaqueRoot root(AbortSignal* signal)
{
    return WebCoreOpaqueRoot { signal };
}

size_t AbortSignal::memoryCost() const
{
    return sizeof(AbortSignal) + m_native_callbacks.sizeInBytes() + m_algorithms.sizeInBytes() + m_sourceSignals.capacity() + m_dependentSignals.capacity();
}

} // namespace WebCore
