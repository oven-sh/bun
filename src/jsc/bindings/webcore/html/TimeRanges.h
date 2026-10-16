/*
 * Copyright (C) 2007, 2009 Apple Inc. All rights reserved.
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
#include "ScriptWrappable.h"
#include <wtf/RefCounted.h>
#include <wtf/TZoneMalloc.h>

namespace WebCore {

// Nothing is ever loaded or played, so every TimeRanges is empty.
class TimeRanges final : public ScriptWrappable, public RefCounted<TimeRanges> {
    WTF_MAKE_TZONE_ALLOCATED(TimeRanges);
public:
    static Ref<TimeRanges> create() { return adoptRef(*new TimeRanges); }

    unsigned length() const { return 0; }
    ExceptionOr<double> start(unsigned) const { return Exception { ExceptionCode::IndexSizeError }; }
    ExceptionOr<double> end(unsigned) const { return Exception { ExceptionCode::IndexSizeError }; }

private:
    TimeRanges() = default;
};

} // namespace WebCore
