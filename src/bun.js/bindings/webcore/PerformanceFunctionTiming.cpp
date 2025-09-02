/*
 * Copyright (C) 2024 Jarred Sumner. All rights reserved.
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

#include "config.h"
#include "PerformanceFunctionTiming.h"

#include "SerializedScriptValue.h"
#include <JavaScriptCore/JSCInlines.h>

namespace WebCore {

PerformanceFunctionTiming::PerformanceFunctionTiming(const String& name, double startTime, double endTime, RefPtr<SerializedScriptValue>&& detail)
    : PerformanceEntry(name, startTime, endTime)
    , m_serializedDetail(WTFMove(detail))
{
}

PerformanceFunctionTiming::~PerformanceFunctionTiming() = default;

Ref<PerformanceFunctionTiming> PerformanceFunctionTiming::create(const String& name, double startTime, double endTime, RefPtr<SerializedScriptValue>&& detail)
{
    return adoptRef(*new PerformanceFunctionTiming(name, startTime, endTime, WTFMove(detail)));
}

JSC::JSValue PerformanceFunctionTiming::detail(JSC::JSGlobalObject& globalObject)
{
    if (!m_serializedDetail)
        return JSC::jsNull();

    return m_serializedDetail->deserialize(globalObject, &globalObject);
}

size_t PerformanceFunctionTiming::memoryCost() const
{
    size_t cost = sizeof(PerformanceFunctionTiming);
    if (m_serializedDetail)
        cost += m_serializedDetail->memoryCost();
    return cost;
}

} // namespace WebCore