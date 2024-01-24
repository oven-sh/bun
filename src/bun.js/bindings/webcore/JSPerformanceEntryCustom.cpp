/*
 * Copyright (C) 2012 Google Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are
 * met:
 *
 *     * Redistributions of source code must retain the above copyright
 * notice, this list of conditions and the following disclaimer.
 *     * Redistributions in binary form must reproduce the above
 * copyright notice, this list of conditions and the following disclaimer
 * in the documentation and/or other materials provided with the
 * distribution.
 *     * Neither the name of Google Inc. nor the names of its
 * contributors may be used to endorse or promote products derived from
 * this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 * A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
 * OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
 * LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

#include "config.h"

#include "JSPerformanceEntry.h"

#include "JSDOMBinding.h"
#include "JSPerformanceMark.h"
#include "JSPerformanceMeasure.h"
// #include "JSPerformanceNavigationTiming.h"
// #include "JSPerformancePaintTiming.h"
// #include "JSPerformanceResourceTiming.h"
#include "PerformanceMark.h"
#include "PerformanceMeasure.h"
// #include "PerformanceNavigationTiming.h"
// #include "PerformancePaintTiming.h"
// #include "PerformanceResourceTiming.h"

namespace WebCore {
using namespace JSC;

JSValue toJSNewlyCreated(JSGlobalObject*, JSDOMGlobalObject* globalObject, Ref<PerformanceEntry>&& entry)
{
    switch (entry->performanceEntryType()) {
    // case PerformanceEntry::Type::Navigation:
    //     return createWrapper<PerformanceNavigationTiming>(globalObject, WTFMove(entry));
    case PerformanceEntry::Type::Mark:
        return createWrapper<PerformanceMark>(globalObject, WTFMove(entry));
    case PerformanceEntry::Type::Measure:
        return createWrapper<PerformanceMeasure>(globalObject, WTFMove(entry));
    // case PerformanceEntry::Type::Resource:
    //     return createWrapper<PerformanceResourceTiming>(globalObject, WTFMove(entry));
    // case PerformanceEntry::Type::Paint:
    //     return createWrapper<PerformancePaintTiming>(globalObject, WTFMove(entry));
    default: {
    }
    }

    ASSERT_NOT_REACHED();
    return createWrapper<PerformanceEntry>(globalObject, WTFMove(entry));
}

JSValue toJS(JSC::JSGlobalObject* lexicalGlobalObject, JSDOMGlobalObject* globalObject, PerformanceEntry& entry)
{
    return wrap(lexicalGlobalObject, globalObject, entry);
}

} // namespace WebCore
