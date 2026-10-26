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

#pragma once

#include "ExceptionOr.h"
#include "PerformanceEntry.h"
#include "PerformanceObserverCallback.h"
#include "ScriptWrappable.h"
#include <wtf/OptionSet.h>
#include <wtf/RefCounted.h>
#include <wtf/Vector.h>
#include <wtf/text/WTFString.h>

namespace JSC {
class JSArray;
class JSObject;
class VM;
}

namespace WebCore {

class JSPerformanceObserver;
class Performance;
class ScriptExecutionContext;

class PerformanceObserver : public ScriptWrappable, public RefCounted<PerformanceObserver> {
    WTF_MAKE_TZONE_ALLOCATED(PerformanceObserver);

public:
    struct Init {
        // Not set for a member that is undefined or null.
        std::optional<Vector<String>> entryTypes;
        std::optional<String> type;
        // The member is not undefined. Node tells a null member from a missing one.
        bool hasEntryTypes { false };
        bool hasType { false };
        bool buffered { false };
    };

    static Ref<PerformanceObserver> create(ScriptExecutionContext& context, Ref<PerformanceObserverCallback>&& callback)
    {
        return adoptRef(*new PerformanceObserver(context, WTF::move(callback)));
    }

    static Vector<String> supportedEntryTypes();

    void disassociate();

    ExceptionOr<void> observe(JSDOMGlobalObject&, Init&&);
    void disconnect();
    // The context of the script that made it.
    ScriptExecutionContext* scriptExecutionContext() const;
    // Takes the queue, in the order the entries were queued. Null when it is empty.
    JSC::JSArray* takeRecords();

    OptionSet<PerformanceEntry::Type> typeFilter() const { return m_typeFilter; }
    // An observer of one of Node's types is delivered from a setImmediate(), as in node. One of web types only, from a task.
    bool deliversOnImmediate() const { return m_typeFilter.containsAny(PerformanceEntry::nodeTypes()); }

    // The queue is a JS array on the wrapper (JSPerformanceObserver::m_pendingEntries). Defined in JSPerformanceObserver.h.
    inline void queueEntry(JSC::VM&, JSC::JSObject& entry);
    void deliver();

    bool isRegistered() const { return m_registered; }
    PerformanceObserverCallback& callback() { return m_callback.get(); }

private:
    PerformanceObserver(ScriptExecutionContext&, Ref<PerformanceObserverCallback>&&);

    // Whether observe() was first called with `type` or with `entryTypes`. The other is refused until disconnect().
    enum class Mode : uint8_t { Unset,
        Type,
        EntryTypes };

    JSC::JSArray* pendingEntries() const;
    static void queueEntrySlow(JSC::VM&, JSPerformanceObserver&, JSC::JSObject& entry);

    RefPtr<Performance> m_performance;
    Ref<PerformanceObserverCallback> m_callback;
    OptionSet<PerformanceEntry::Type> m_typeFilter;
    Mode m_mode { Mode::Unset };
    bool m_registered { false };
    // Its context is a Bun.ModuleGraph's: once that graph is disposed, or collected, it observes nothing more.
    bool m_isOfModuleGraph { false };
};

} // namespace WebCore
