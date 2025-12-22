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

#pragma once

#include "config.h"

#include "ContextDestructionObserver.h"
#include "EventTarget.h"
#include "JSValueInWrappedObject.h"
#include "JavaScriptCore/JSGlobalObject.h"
#include "ZigGlobalObject.h"
#include "wtf/DebugHeap.h"
#include "wtf/FastMalloc.h"
#include <wtf/Function.h>
#include <wtf/Ref.h>
#include <wtf/RefCounted.h>
#include <wtf/WeakListHashSet.h>
#include <wtf/WeakPtr.h>

namespace WebCore {

class AbortAlgorithm;
class ScriptExecutionContext;
class WebCoreOpaqueRoot;

DECLARE_ALLOCATOR_WITH_HEAP_IDENTIFIER(AbortSignal);

enum class CommonAbortReason : uint8_t {
    None,
    Timeout,
    UserAbort,
    ConnectionClosed,
};

JSC::JSValue toJS(JSC::JSGlobalObject*, CommonAbortReason);

typedef void* AbortSignalTimeout;

class AbortSignal final : public RefCounted<AbortSignal>, public EventTargetWithInlineData, private ContextDestructionObserver {
    WTF_MAKE_TZONE_ALLOCATED(AbortSignal);

private:
    enum class AbortSignalFlags : uint8_t {
        Dependent = 1,
        Aborted = 2,
        HasAbortEventListener = 4,
        IsFiringEventListeners = 8,
    };

public:
    static Ref<AbortSignal> create(ScriptExecutionContext*);
    WEBCORE_EXPORT ~AbortSignal();
    using NativeCallbackTuple = std::tuple<void*, void (*)(void*, JSC::EncodedJSValue)>;

    static Ref<AbortSignal> abort(JSDOMGlobalObject&, ScriptExecutionContext&, JSC::JSValue reason);
    static Ref<AbortSignal> timeout(ScriptExecutionContext&, uint64_t milliseconds);
    static Ref<AbortSignal> any(ScriptExecutionContext&, const Vector<RefPtr<AbortSignal>>&);

    static uint32_t addAbortAlgorithmToSignal(AbortSignal&, Ref<AbortAlgorithm>&&);
    static void removeAbortAlgorithmFromSignal(AbortSignal&, uint32_t algorithmIdentifier);

    void signalAbort(JSC::JSGlobalObject* globalObject, CommonAbortReason reason);
    void signalAbort(JSC::JSValue reason);
    void signalFollow(AbortSignal&);

    bool aborted() const { return m_flags & static_cast<uint8_t>(AbortSignalFlags::Aborted); }
    void markAborted(JSC::JSValue reason);
    void runAbortSteps();

    const JSValueInWrappedObject& reason() const { return m_reason; }
    JSValue jsReason(JSC::JSGlobalObject& globalObject);
    CommonAbortReason commonReason() const { return m_commonReason; }

    void cleanNativeBindings(void* ref);
    void addNativeCallback(NativeCallbackTuple callback)
    {
        m_native_callbacks.append(callback);
        eventListenersDidChange();
    }

    bool hasActiveTimeoutTimer() const { return m_timeout != nullptr; }
    bool hasAbortEventListener() const { return m_flags & static_cast<uint8_t>(AbortSignalFlags::HasAbortEventListener); }
    bool isFiringEventListeners() const { return m_flags & static_cast<uint8_t>(AbortSignalFlags::IsFiringEventListeners); }

    using RefCounted::deref;
    using RefCounted::ref;

    using Algorithm = Function<void(JSC::JSValue reason)>;
    uint32_t addAlgorithm(Algorithm&&);
    void removeAlgorithm(uint32_t);

    bool isFollowingSignal() const { return !!m_followingSignal; }

    void throwIfAborted(JSC::JSGlobalObject&);

    using AbortSignalSet = WeakListHashSet<AbortSignal, WeakPtrImplWithEventTargetData>;
    const AbortSignalSet& sourceSignals() const { return m_sourceSignals; }
    AbortSignalSet& sourceSignals() { return m_sourceSignals; }

    // https://github.com/oven-sh/bun/issues/4517
    void incrementPendingActivityCount() { ++pendingActivityCount; }
    void decrementPendingActivityCount() { --pendingActivityCount; }
    bool hasPendingActivity() const { return pendingActivityCount > 0; }
    bool isDependent() const { return m_flags & static_cast<uint8_t>(AbortSignalFlags::Dependent); }

    size_t memoryCost() const;

    AbortSignalTimeout getTimeout() const { return m_timeout; }

private:
    enum class Aborted : bool {
        No,
        Yes
    };
    explicit AbortSignal(ScriptExecutionContext*, Aborted = Aborted::No, JSC::JSValue reason = JSC::jsUndefined());

    void markAsDependent() { setIsDependent(true); }
    void addSourceSignal(AbortSignal&);
    void addDependentSignal(AbortSignal&);
    void cancelTimer();

    void applyFlags(uint8_t flags) { m_flags |= flags; }
    void setIsDependent(bool isDependent)
    {
        if (isDependent) {
            m_flags |= static_cast<uint8_t>(AbortSignalFlags::Dependent);
        } else {
            m_flags &= ~static_cast<uint8_t>(AbortSignalFlags::Dependent);
        }
    }
    void setAborted(bool aborted)
    {
        if (aborted) {
            m_flags |= static_cast<uint8_t>(AbortSignalFlags::Aborted);
        } else {
            m_flags &= ~static_cast<uint8_t>(AbortSignalFlags::Aborted);
        }
    }
    void setHasAbortEventListener(bool hasAbortEventListener)
    {
        if (hasAbortEventListener) {
            m_flags |= static_cast<uint8_t>(AbortSignalFlags::HasAbortEventListener);
        } else {
            m_flags &= ~static_cast<uint8_t>(AbortSignalFlags::HasAbortEventListener);
        }
    }
    void setIsFiringEventListeners(bool isFiringEventListeners)
    {
        if (isFiringEventListeners) {
            m_flags |= static_cast<uint8_t>(AbortSignalFlags::IsFiringEventListeners);
        } else {
            m_flags &= ~static_cast<uint8_t>(AbortSignalFlags::IsFiringEventListeners);
        }
    }

    // EventTarget.
    EventTargetInterface eventTargetInterface() const final { return AbortSignalEventTargetInterfaceType; }
    ScriptExecutionContext* scriptExecutionContext() const final { return ContextDestructionObserver::scriptExecutionContext(); }
    void refEventTarget() final { ref(); }
    void derefEventTarget() final { deref(); }
    void eventListenersDidChange() final;

    Vector<std::pair<uint32_t, Algorithm>> m_algorithms;
    WeakPtr<AbortSignal, WeakPtrImplWithEventTargetData> m_followingSignal;
    AbortSignalSet m_sourceSignals;
    AbortSignalSet m_dependentSignals;
    JSValueInWrappedObject m_reason;
    CommonAbortReason m_commonReason { CommonAbortReason::None };
    Vector<NativeCallbackTuple, 2> m_native_callbacks;
    std::atomic<uint32_t> pendingActivityCount { 0 };
    uint32_t m_algorithmIdentifier { 0 };
    AbortSignalTimeout m_timeout { nullptr };
    uint8_t m_flags { 0 };
};

WebCoreOpaqueRoot root(AbortSignal*);

} // namespace WebCore
