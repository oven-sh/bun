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

#include "DOMRectInit.h"
#include "ScriptWrappable.h"
#include <wtf/MathExtras.h>
#include <wtf/NoVirtualDestructorBase.h>
#include <wtf/Ref.h>
#include <wtf/RefCounted.h>
#include <wtf/TZoneMalloc.h>

namespace WebCore {

class WebCoreOpaqueRoot;

class DOMRectReadOnly : public ScriptWrappable, public RefCounted<DOMRectReadOnly>, public NoVirtualDestructorBase {
    WTF_MAKE_TZONE_ALLOCATED_EXPORT(DOMRectReadOnly, WEBCORE_EXPORT);
public:
    static Ref<DOMRectReadOnly> create(double x, double y, double width, double height) { return adoptRef(*new DOMRectReadOnly(x, y, width, height)); }
    static Ref<DOMRectReadOnly> fromRect(const DOMRectInit& init) { return create(init.x, init.y, init.width, init.height); }

    double x() const { return m_x; }
    double y() const { return m_y; }
    double width() const { return m_width; }
    double height() const { return m_height; }

    // Model NaN handling after Math.min, Math.max.
    double top() const { return WTF::nanPropagatingMin(m_y, m_y + m_height); }
    double right() const { return WTF::nanPropagatingMax(m_x, m_x + m_width); }
    double bottom() const { return WTF::nanPropagatingMax(m_y, m_y + m_height); }
    double left() const { return WTF::nanPropagatingMin(m_x, m_x + m_width); }

protected:
    DOMRectReadOnly(double x, double y, double width, double height)
        : m_x(x)
        , m_y(y)
        , m_width(width)
        , m_height(height)
    {
    }

    DOMRectReadOnly() = default;

    // Any of these can be NaN or Inf.
    double m_x { 0 };
    double m_y { 0 };
    double m_width { 0 }; // Can be negative.
    double m_height { 0 }; // Can be negative.
};

WebCoreOpaqueRoot LEGACY_NODELETE root(DOMRectReadOnly*);

} // namespace WebCore
