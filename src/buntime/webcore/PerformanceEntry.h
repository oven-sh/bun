/*
 * Copyright (C) 2012 Google Inc. All rights reserved.
 * Copyright (C) 2012 Intel Inc. All rights reserved.
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

#pragma once

#include "Performance.h"
#include <wtf/RefCounted.h>
#include <wtf/text/WTFString.h>

namespace WebCore {

DECLARE_ALLOCATOR_WITH_HEAP_IDENTIFIER(PerformanceEntry);
class PerformanceEntry : public RefCounted<PerformanceEntry> {
    WTF_DEPRECATED_MAKE_FAST_ALLOCATED_WITH_HEAP_IDENTIFIER(PerformanceEntry, PerformanceEntry);

public:
    virtual ~PerformanceEntry();

    const String& name() const { return m_name; }
    const double startTime() const { return m_startTime; }
    const double duration() const { return m_duration; }

    enum class Type : uint8_t {
        Navigation = 1 << 0,
        Mark = 1 << 1,
        Measure = 1 << 2,
        Resource = 1 << 3,
        Paint = 1 << 4
    };

    virtual Type performanceEntryType() const = 0;
    virtual ASCIILiteral entryType() const = 0;

    size_t memoryCost() const;

    static std::optional<Type> parseEntryTypeString(const String& entryType);

    static bool startTimeCompareLessThan(const RefPtr<PerformanceEntry>& a, const RefPtr<PerformanceEntry>& b)
    {
        return a->startTime() < b->startTime();
    }

protected:
    PerformanceEntry(const String& name, double startTime, double finishTime);

private:
    const String m_name;
    const double m_startTime;
    const double m_duration;
};

} // namespace WebCore
