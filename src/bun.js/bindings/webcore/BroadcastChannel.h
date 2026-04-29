/*
 * Copyright (C) 2021 Apple Inc. All rights reserved.
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
 * THIS SOFTWARE IS PROVIDED BY APPLE INC. ``AS IS'' AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL APPLE INC. OR
 * CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
 * EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
 * PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
 * PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY
 * OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

// BroadcastChannel is a thin EventTarget over the process-global
// BunBroadcastChannelRegistry.
//
// The registry is directly thread-safe; posting never bounces through the
// main thread. Each (message, subscriber) pair becomes one task on the
// subscriber's context — the HTML spec requires that same-event-loop
// subscribers observe messages in (message-major, creation-minor) order,
// which per-channel inbox batching would break. If cross-thread bursts ever
// need coalescing, the place to add it is a per-(context, name) inbox in the
// registry, not per-channel.

#pragma once

#include "ContextDestructionObserver.h"
#include "EventTarget.h"
#include "ExceptionOr.h"
#include "ScriptExecutionContext.h"
#include <wtf/Forward.h>
#include <wtf/ThreadSafeWeakPtr.h>

namespace JSC {
class JSGlobalObject;
class JSValue;
}

namespace WebCore {

class SerializedScriptValue;

class BroadcastChannel final : public ThreadSafeRefCountedAndCanMakeThreadSafeWeakPtr<BroadcastChannel>, public EventTarget, public ContextDestructionObserver {
    WTF_MAKE_TZONE_ALLOCATED(BroadcastChannel);

public:
    static Ref<BroadcastChannel> create(ScriptExecutionContext& context, const String& name)
    {
        return adoptRef(*new BroadcastChannel(context, name));
    }
    ~BroadcastChannel();

    using ThreadSafeRefCountedAndCanMakeThreadSafeWeakPtr<BroadcastChannel>::ref;
    using ThreadSafeRefCountedAndCanMakeThreadSafeWeakPtr<BroadcastChannel>::deref;

    String name() const { return m_name; }

    ExceptionOr<void> postMessage(JSC::JSGlobalObject&, JSC::JSValue message);
    void close();
    bool isClosed() const { return m_state.load(std::memory_order_acquire) & Closed; }

    // Called on this channel's context thread with one message.
    void dispatchMessage(Ref<SerializedScriptValue>&&);

    bool hasPendingActivity() const;

    void jsRef(JSGlobalObject*);
    void jsUnref(JSGlobalObject*);

private:
    friend class BunBroadcastChannelRegistry;

    BroadcastChannel(ScriptExecutionContext&, const String& name);

    // EventTarget
    EventTargetInterface eventTargetInterface() const final { return BroadcastChannelEventTargetInterfaceType; }
    ScriptExecutionContext* scriptExecutionContext() const final { return ContextDestructionObserver::scriptExecutionContext(); }
    void refEventTarget() final { ref(); }
    void derefEventTarget() final { deref(); }
    void eventListenersDidChange() final;
    void contextDestroyed() final;

    // State is a single atomic so the GC-thread hasPendingActivity() check
    // never takes a lock. Layout: bit 0 = Closed, high bits = count of
    // messages posted-but-not-yet-dispatched (keeps the channel alive until
    // its queued tasks run even if JS drops the last reference).
    enum State : uint64_t {
        Closed = 1ull << 0,
        QueuedShift = 8,
        QueuedOne = 1ull << QueuedShift,
    };

    const String m_name;
    const ScriptExecutionContextIdentifier m_contextId;

    std::atomic<uint64_t> m_state { 0 };

    bool m_hasRelevantEventListener { false };
    bool m_hasRef { false };
};

} // namespace WebCore
