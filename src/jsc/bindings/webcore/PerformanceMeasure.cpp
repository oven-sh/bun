/*
 * Copyright (C) 2020 Apple Inc. All rights reserved.
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
#include "PerformanceMeasure.h"

#include "SerializedScriptValue.h"

namespace WebCore {

size_t PerformanceMeasure::memoryCost() const
{
    size_t size = sizeof(PerformanceMeasure);
    if (m_serializedDetail) {
        size += m_serializedDetail->memoryCost();
    }
    return size;
}

ExceptionOr<Ref<PerformanceMeasure>> PerformanceMeasure::create(const String& name, double startTime, double endTime, RefPtr<SerializedScriptValue>&& serializedDetail)
{
    return adoptRef(*new PerformanceMeasure(name, startTime, endTime, WTF::move(serializedDetail)));
}

PerformanceMeasure::PerformanceMeasure(const String& name, double startTime, double endTime, RefPtr<SerializedScriptValue>&& serializedDetail)
    : PerformanceEntry(name, startTime, endTime)
    , m_serializedDetail(WTF::move(serializedDetail))
{
}

PerformanceMeasure::~PerformanceMeasure() = default;

JSC::JSValue PerformanceMeasure::detail(JSC::JSGlobalObject& globalObject)
{
    if (!m_serializedDetail) {
        return JSC::jsNull();
    }

    return m_serializedDetail->deserialize(globalObject, &globalObject);
}

}
