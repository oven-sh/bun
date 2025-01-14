/*
 * Copyright (C) 2012 Intel Inc. All rights reserved.
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

#pragma once

#include "ExceptionOr.h"
#include "PerformanceMark.h"
#include "PerformanceMeasure.h"
#include <wtf/HashMap.h>
#include <wtf/text/StringHash.h>

namespace JSC {
class JSGlobalObject;
}

namespace WebCore {

class Performance;

using PerformanceEntryMap = HashMap<String, Vector<RefPtr<PerformanceEntry>>>;

class PerformanceUserTiming {
    WTF_MAKE_FAST_ALLOCATED;

public:
    explicit PerformanceUserTiming(Performance&);

    ExceptionOr<Ref<PerformanceMark>> mark(JSC::JSGlobalObject&, const String& markName, std::optional<PerformanceMarkOptions>&&);
    void clearMarks(const String& markName);

    using StartOrMeasureOptions = std::variant<String, PerformanceMeasureOptions>;
    ExceptionOr<Ref<PerformanceMeasure>> measure(JSC::JSGlobalObject&, const String& measureName, std::optional<StartOrMeasureOptions>&&, const String& endMark);
    void clearMeasures(const String& measureName);

    Vector<RefPtr<PerformanceEntry>> getMarks() const;
    Vector<RefPtr<PerformanceEntry>> getMeasures() const;

    Vector<RefPtr<PerformanceEntry>> getMarks(const String& name) const;
    Vector<RefPtr<PerformanceEntry>> getMeasures(const String& name) const;

    static bool isRestrictedMarkName(const String& markName);

    size_t memoryCost() const;

private:
    ExceptionOr<double> convertMarkToTimestamp(const std::variant<String, double>&) const;
    ExceptionOr<double> convertMarkToTimestamp(const String& markName) const;
    ExceptionOr<double> convertMarkToTimestamp(double) const;

    ExceptionOr<Ref<PerformanceMeasure>> measure(const String& measureName, const String& startMark, const String& endMark);
    ExceptionOr<Ref<PerformanceMeasure>> measure(JSC::JSGlobalObject&, const String& measureName, const PerformanceMeasureOptions&);

    Performance& m_performance;
    PerformanceEntryMap m_marksMap;
    int64_t m_markCounter { 0 };
    PerformanceEntryMap m_measuresMap;
    int64_t m_measureCounter { 0 };
};

}
