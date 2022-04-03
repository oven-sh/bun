/*
 * Copyright (C) 2006, 2007, 2009, 2010, 2011, 2012 Apple Inc. All rights reserved.
 * Copyright (C) 2012, 2013 Adobe Systems Incorporated. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 *
 * 1.  Redistributions of source code must retain the above copyright
 *     notice, this list of conditions and the following disclaimer.
 * 2.  Redistributions in binary form must reproduce the above copyright
 *     notice, this list of conditions and the following disclaimer in the
 *     documentation and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDER "AS IS" AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER BE
 * LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY,
 * OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
 * PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
 * PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR
 * TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF
 * THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF
 * SUCH DAMAGE.
 */

#pragma once

#include "ExceptionOr.h"
#include "WebCorePath.h"
#include <variant>
#include <wtf/Forward.h>

namespace WebCore {

struct DOMPointInit;

class CanvasPath {
public:
    using RadiusVariant = std::variant<double, DOMPointInit>;
    virtual ~CanvasPath() = default;

    void closePath();
    void moveTo(float x, float y);
    void lineTo(float x, float y);
    void quadraticCurveTo(float cpx, float cpy, float x, float y);
    void bezierCurveTo(float cp1x, float cp1y, float cp2x, float cp2y, float x, float y);
    ExceptionOr<void> arcTo(float x0, float y0, float x1, float y1, float radius);
    ExceptionOr<void> arc(float x, float y, float r, float sa, float ea, bool anticlockwise);
    ExceptionOr<void> ellipse(float x, float y, float radiusX, float radiusY, float rotation, float startAngle, float endAngled, bool anticlockwise);
    void rect(float x, float y, float width, float height);
    ExceptionOr<void> roundRect(float x, float y, float width, float height, const RadiusVariant& radii);
    ExceptionOr<void> roundRect(float x, float y, float width, float height, const Span<const RadiusVariant>& radii);

    float currentX() const;
    float currentY() const;

protected:
    CanvasPath() = default;
    CanvasPath(const Path& path)
        : m_path(path)
    {
    }

    virtual bool hasInvertibleTransform() const { return true; }

    // void lineTo(FloatPoint);

    Path m_path;
};

}
