/*
 * Copyright (C) 2016, 2017 Apple Inc. All rights reserved.
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

#include "DOMRectReadOnly.h"

namespace WebCore {

class DOMRect : public DOMRectReadOnly {
public:
    static Ref<DOMRect> create() { return adoptRef(*new DOMRect()); }
    static Ref<DOMRect> create(double x, double y, double width, double height) { return adoptRef(*new DOMRect(x, y, width, height)); }
    static Ref<DOMRect> fromRect(const DOMRectInit& init) { return create(init.x, init.y, init.width, init.height); }

    void setX(double x) { m_x = x; }
    void setY(double y) { m_y = y; }

    void setWidth(double width) { m_width = width; }
    void setHeight(double height) { m_height = height; }

private:
    DOMRect(double x, double y, double width, double height)
        : DOMRectReadOnly(x, y, width, height)
    {
    }

    DOMRect() = default;
};
static_assert(sizeof(DOMRect) == sizeof(DOMRectReadOnly));

}
