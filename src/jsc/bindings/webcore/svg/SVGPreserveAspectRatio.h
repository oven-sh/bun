/*
 * Copyright (C) 2016-2019 Apple Inc. All rights reserved.
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
#include "SVGPreserveAspectRatioValue.h"
#include "SVGProperty.h"
#include "ScriptWrappable.h"
#include <wtf/RefCounted.h>
#include <wtf/TZoneMalloc.h>

namespace WebCore {

class SVGElement;

// The `preserveAspectRatio` attribute of an element.
class SVGPreserveAspectRatio final : public ScriptWrappable, public RefCounted<SVGPreserveAspectRatio> {
    WTF_MAKE_TZONE_ALLOCATED(SVGPreserveAspectRatio);
public:
    static Ref<SVGPreserveAspectRatio> create(SVGElement&, SVGPropertyAccess);
    ~SVGPreserveAspectRatio();

    unsigned short align() const { return value().align(); }
    ExceptionOr<void> setAlign(unsigned short align) { return set(&SVGPreserveAspectRatioValue::setAlign, align); }

    unsigned short meetOrSlice() const { return value().meetOrSlice(); }
    ExceptionOr<void> setMeetOrSlice(unsigned short meetOrSlice) { return set(&SVGPreserveAspectRatioValue::setMeetOrSlice, meetOrSlice); }

private:
    SVGPreserveAspectRatio(SVGElement&, SVGPropertyAccess);

    SVGPreserveAspectRatioValue value() const;
    ExceptionOr<void> set(ExceptionOr<void> (SVGPreserveAspectRatioValue::*)(unsigned short), unsigned short);

    const Ref<SVGElement> m_contextElement;
    const SVGPropertyAccess m_access;
};

} // namespace WebCore
