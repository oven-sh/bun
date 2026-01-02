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
#include <wtf/OptionSet.h>
#include <wtf/RefCounted.h>
#include <wtf/Vector.h>
#include <wtf/text/WTFString.h>

namespace WebCore {

class Performance;
class ScriptExecutionContext;

class PerformanceObserver : public RefCounted<PerformanceObserver> {
public:
    struct Init {
        std::optional<Vector<String>> entryTypes;
        std::optional<String> type;
        bool buffered;
    };

    static Ref<PerformanceObserver> create(ScriptExecutionContext& context, Ref<PerformanceObserverCallback>&& callback)
    {
        return adoptRef(*new PerformanceObserver(context, WTF::move(callback)));
    }

    static Vector<String> supportedEntryTypes(ScriptExecutionContext&);

    void disassociate();

    ExceptionOr<void> observe(Init&&);
    void disconnect();
    Vector<RefPtr<PerformanceEntry>> takeRecords();

    OptionSet<PerformanceEntry::Type> typeFilter() const { return m_typeFilter; }

    bool hasNavigationTiming() const { return m_hasNavigationTiming; }
    void addedNavigationTiming() { m_hasNavigationTiming = true; }

    void queueEntry(PerformanceEntry&);
    void deliver();

    bool isRegistered() const { return m_registered; }
    PerformanceObserverCallback& callback() { return m_callback.get(); }

private:
    PerformanceObserver(ScriptExecutionContext&, Ref<PerformanceObserverCallback>&&);

    RefPtr<Performance> m_performance;
    Vector<RefPtr<PerformanceEntry>> m_entriesToDeliver;
    Ref<PerformanceObserverCallback> m_callback;
    OptionSet<PerformanceEntry::Type> m_typeFilter;
    bool m_registered { false };
    bool m_isTypeObserver { false };
    bool m_hasNavigationTiming { false };
};

} // namespace WebCore
