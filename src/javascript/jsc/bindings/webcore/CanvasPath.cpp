/*
 * Copyright (C) 2004, 2005, 2006, 2007, 2008, 2009, 2010, 2011, 2012 Apple Inc. All rights reserved.
 * Copyright (C) 2008, 2010 Nokia Corporation and/or its subsidiary(-ies)
 * Copyright (C) 2007 Alp Toker <alp@atoker.com>
 * Copyright (C) 2008 Eric Seidel <eric@webkit.org>
 * Copyright (C) 2008 Dirk Schulze <krit@webkit.org>
 * Copyright (C) 2010 Torch Mobile (Beijing) Co. Ltd. All rights reserved.
 * Copyright (C) 2012 Intel Corporation. All rights reserved.
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

#include "config.h"
#include "CanvasPath.h"

// #include "AffineTransform.h"
#include "DOMPointInit.h"
// #include "FloatRect.h"
// #include "FloatRoundedRect.h"
// #include "FloatSize.h"
#include <algorithm>
#include <wtf/MathExtras.h>

namespace WebCore {

void CanvasPath::closePath()
{
    //     if (m_path.isEmpty())
    //         return;

    //     FloatRect boundRect = m_path.fastBoundingRect();
    //     if (boundRect.width() || boundRect.height())
    //         m_path.closeSubpath();
}

void CanvasPath::moveTo(float x, float y)
{
    // if (!std::isfinite(x) || !std::isfinite(y))
    //     return;
    // if (!hasInvertibleTransform())
    //     return;
    // m_path.moveTo(FloatPoint(x, y));
}

// void CanvasPath::lineTo(FloatPoint point)
// {
//     // lineTo(point.x(), point.y());
// }

void CanvasPath::lineTo(float x, float y)
{
    // if (!std::isfinite(x) || !std::isfinite(y))
    //     return;
    // if (!hasInvertibleTransform())
    //     return;

    // FloatPoint p1 = FloatPoint(x, y);
    // if (!m_path.hasCurrentPoint())
    //     m_path.moveTo(p1);
    // else if (p1 != m_path.currentPoint())
    //     m_path.addLineTo(p1);
}

void CanvasPath::quadraticCurveTo(float cpx, float cpy, float x, float y)
{
    // if (!std::isfinite(cpx) || !std::isfinite(cpy) || !std::isfinite(x) || !std::isfinite(y))
    //     return;
    // if (!hasInvertibleTransform())
    //     return;
    // if (!m_path.hasCurrentPoint())
    //     m_path.moveTo(FloatPoint(cpx, cpy));

    // FloatPoint p1 = FloatPoint(x, y);
    // FloatPoint cp = FloatPoint(cpx, cpy);
    // if (p1 != m_path.currentPoint() || p1 != cp)
    //     m_path.addQuadCurveTo(cp, p1);
}

void CanvasPath::bezierCurveTo(float cp1x, float cp1y, float cp2x, float cp2y, float x, float y)
{
    // if (!std::isfinite(cp1x) || !std::isfinite(cp1y) || !std::isfinite(cp2x) || !std::isfinite(cp2y) || !std::isfinite(x) || !std::isfinite(y))
    //     return;
    // if (!hasInvertibleTransform())
    //     return;
    // if (!m_path.hasCurrentPoint())
    //     m_path.moveTo(FloatPoint(cp1x, cp1y));

    // FloatPoint p1 = FloatPoint(x, y);
    // FloatPoint cp1 = FloatPoint(cp1x, cp1y);
    // FloatPoint cp2 = FloatPoint(cp2x, cp2y);
    // if (p1 != m_path.currentPoint() || p1 != cp1 || p1 != cp2)
    //     m_path.addBezierCurveTo(cp1, cp2, p1);
}

ExceptionOr<void> CanvasPath::arcTo(float x1, float y1, float x2, float y2, float r)
{
    // if (!std::isfinite(x1) || !std::isfinite(y1) || !std::isfinite(x2) || !std::isfinite(y2) || !std::isfinite(r))
    //     return {};

    // if (r < 0)
    //     return Exception { IndexSizeError };

    // if (!hasInvertibleTransform())
    //     return {};

    // FloatPoint p1 = FloatPoint(x1, y1);
    // FloatPoint p2 = FloatPoint(x2, y2);

    // if (!m_path.hasCurrentPoint())
    //     m_path.moveTo(p1);
    // else if (p1 == m_path.currentPoint() || p1 == p2 || !r)
    //     lineTo(x1, y1);
    // else
    //     m_path.addArcTo(p1, p2, r);

    // return {};
}

static void normalizeAngles(float& startAngle, float& endAngle, bool anticlockwise)
{
    // float newStartAngle = startAngle;
    // if (newStartAngle < 0)
    //     newStartAngle = (2 * piFloat) + fmodf(newStartAngle, -(2 * piFloat));
    // else
    //     newStartAngle = fmodf(newStartAngle, 2 * piFloat);

    // float delta = newStartAngle - startAngle;
    // startAngle = newStartAngle;
    // endAngle = endAngle + delta;
    // ASSERT(newStartAngle >= 0 && (newStartAngle < 2 * piFloat || WTF::areEssentiallyEqual<float>(newStartAngle, 2 * piFloat)));

    // if (anticlockwise && startAngle - endAngle >= 2 * piFloat)
    //     endAngle = startAngle - 2 * piFloat;
    // else if (!anticlockwise && endAngle - startAngle >= 2 * piFloat)
    //     endAngle = startAngle + 2 * piFloat;
}

ExceptionOr<void> CanvasPath::arc(float x, float y, float radius, float startAngle, float endAngle, bool anticlockwise)
{
    // if (!std::isfinite(x) || !std::isfinite(y) || !std::isfinite(radius) || !std::isfinite(startAngle) || !std::isfinite(endAngle))
    //     return {};

    // if (radius < 0)
    //     return Exception { IndexSizeError };

    // if (!hasInvertibleTransform())
    //     return {};

    // normalizeAngles(startAngle, endAngle, anticlockwise);

    // if (!radius || startAngle == endAngle) {
    //     // The arc is empty but we still need to draw the connecting line.
    //     lineTo(x + radius * cosf(startAngle), y + radius * sinf(startAngle));
    //     return {};
    // }

    // m_path.addArc(FloatPoint(x, y), radius, startAngle, endAngle, anticlockwise);
    // return {};
}

ExceptionOr<void> CanvasPath::ellipse(float x, float y, float radiusX, float radiusY, float rotation, float startAngle, float endAngle, bool anticlockwise)
{
    // if (!std::isfinite(x) || !std::isfinite(y) || !std::isfinite(radiusX) || !std::isfinite(radiusY) || !std::isfinite(rotation) || !std::isfinite(startAngle) || !std::isfinite(endAngle))
    //     return {};

    // if (radiusX < 0 || radiusY < 0)
    //     return Exception { IndexSizeError };

    // if (!hasInvertibleTransform())
    //     return {};

    // normalizeAngles(startAngle, endAngle, anticlockwise);

    // if ((!radiusX && !radiusY) || startAngle == endAngle) {
    //     AffineTransform transform;
    //     transform.translate(x, y).rotate(rad2deg(rotation));

    //     lineTo(transform.mapPoint(FloatPoint(radiusX * cosf(startAngle), radiusY * sinf(startAngle))));
    //     return {};
    // }

    // if (!radiusX || !radiusY) {
    //     AffineTransform transform;
    //     transform.translate(x, y).rotate(rad2deg(rotation));

    //     lineTo(transform.mapPoint(FloatPoint(radiusX * cosf(startAngle), radiusY * sinf(startAngle))));

    //     if (!anticlockwise) {
    //         for (float angle = startAngle - fmodf(startAngle, piOverTwoFloat) + piOverTwoFloat; angle < endAngle; angle += piOverTwoFloat)
    //             lineTo(transform.mapPoint(FloatPoint(radiusX * cosf(angle), radiusY * sinf(angle))));
    //     } else {
    //         for (float angle = startAngle - fmodf(startAngle, piOverTwoFloat); angle > endAngle; angle -= piOverTwoFloat)
    //             lineTo(transform.mapPoint(FloatPoint(radiusX * cosf(angle), radiusY * sinf(angle))));
    //     }

    //     lineTo(transform.mapPoint(FloatPoint(radiusX * cosf(endAngle), radiusY * sinf(endAngle))));
    //     return {};
    // }

    // m_path.addEllipse(FloatPoint(x, y), radiusX, radiusY, rotation, startAngle, endAngle, anticlockwise);
    // return {};
}

void CanvasPath::rect(float x, float y, float width, float height)
{
    // if (!hasInvertibleTransform())
    //     return;

    // if (!std::isfinite(x) || !std::isfinite(y) || !std::isfinite(width) || !std::isfinite(height))
    //     return;

    // if (!width && !height) {
    //     m_path.moveTo(FloatPoint(x, y));
    //     return;
    // }

    // m_path.addRect(FloatRect(x, y, width, height));
}

ExceptionOr<void> CanvasPath::roundRect(float x, float y, float width, float height, const RadiusVariant& radii)
{
    //     // return roundRect(x, y, width, height, Span { &radii, 1 });
}

ExceptionOr<void> CanvasPath::roundRect(float x, float y, float width, float height, const Span<const RadiusVariant>& radii)
{
    //     // // Based on Nov 5th 2021 version of https://html.spec.whatwg.org/multipage/canvas.html#dom-context-2d-roundrect
    //     // // 1. If any of x, y, w, or h are infinite or NaN, then return.

    //     // if (!std::isfinite(x) || !std::isfinite(y) || !std::isfinite(width) || !std::isfinite(height))
    //     //     return { };

    //     // // 2. If radii is not a list of size one, two, three, or four, then throw a RangeError.
    //     // if (radii.size() > 4 || radii.empty())
    //     //     return Exception { RangeError, makeString("radii must contain at least 1 element, up to 4. It contained ", radii.size(), " elements.") };

    //     // // 3. Let normalizedRadii be an empty list.
    //     // Vector<FloatPoint, 4> normalizedRadii;

    //     // // 4. For each radius of radii:
    //     // for (auto& radius : radii) {
    //     //     auto shouldReturnSilently = false;
    //     //     auto exception = WTF::switchOn(radius,
    //     //         // 4.1 If radius is a DOMPointInit:
    //     //         [&normalizedRadii, &shouldReturnSilently](DOMPointInit point) -> ExceptionOr<void> {
    //     //             // 4.1.1 If radius["x"] or radius["y"] is infinite or NaN, then return.
    //     //             if (!std::isfinite(point.x) || !std::isfinite(point.y)) {
    //     //                 shouldReturnSilently = true;
    //     //                 return { };
    //     //             }

    //     //             // 4.1.2 If radius["x"] or radius["y"] is negative, then throw a RangeError.
    //     //             if (point.x < 0 || point.y < 0)
    //     //                 return Exception { RangeError, makeString("radius point coordinates must be positive") };

    //     //             // 4.1.3 Otherwise, append radius to normalizedRadii.
    //     //             normalizedRadii.append({ static_cast<float>(point.x), static_cast<float>(point.y) });
    //     //             return { };
    //     //         },
    //     //         // 4.2 If radius is a unrestricted double:
    //     //         [&normalizedRadii, &shouldReturnSilently](double radiusValue) -> ExceptionOr<void> {

    //     //             // 4.2.1 If radius is infinite or NaN, then return.
    //     //             if (!std::isfinite(radiusValue)) {
    //     //                 shouldReturnSilently = true;
    //     //                 return { };
    //     //             }

    //     //             // 4.2.2 If radius is negative, then throw a RangeError.
    //     //             if (radiusValue < 0)
    //     //                 return Exception { RangeError, makeString("radius value must be positive") };

    //     //             // 4.2.3 Otherwise append «[ "x" → radius, "y" → radius ]» to normalizedRadii.
    //     //             normalizedRadii.append({ static_cast<float>(radiusValue), static_cast<float>(radiusValue) });
    //     //             return { };
    //     //         }
    //     //     );
    //     //     if (exception.hasException() || shouldReturnSilently)
    //     //         return exception;
    //     // }

    //     // // Degenerate case, fall back to regular rect.
    //     // // We do not do this before parsing the radii in order to make sure the Exceptions can be raised.
    //     // if (!width || !height) {
    //     //     rect(x, y, width, height);
    //     //     return { };
    //     // }

    //     // // 5. Let upperLeft, upperRight, lowerRight, and lowerLeft be null.
    //     // FloatPoint upperLeft, upperRight, lowerRight, lowerLeft;

    //     // switch (normalizedRadii.size()) {
    //     // case 4:
    //     //     // 6. If normalizedRadii's size is 4, then set upperLeft to normalizedRadii[0], set upperRight to normalizedRadii[1], set lowerRight to normalizedRadii[2], and set lowerLeft to normalizedRadii[3].
    //     //     upperLeft = normalizedRadii[0];
    //     //     upperRight = normalizedRadii[1];
    //     //     lowerRight = normalizedRadii[2];
    //     //     lowerLeft = normalizedRadii[3];
    //     //     break;
    //     // case 3:
    //     //     // 7. If normalizedRadii's size is 3, then set upperLeft to normalizedRadii[0], set upperRight and lowerLeft to normalizedRadii[1], and set lowerRight to normalizedRadii[2].
    //     //     upperLeft = normalizedRadii[0];
    //     //     upperRight = normalizedRadii[1];
    //     //     lowerRight = normalizedRadii[2];
    //     //     lowerLeft = normalizedRadii[1];
    //     //     break;
    //     // case 2:
    //     //     // 8. If normalizedRadii's size is 2, then set upperLeft and lowerRight to normalizedRadii[0] and set upperRight and lowerLeft to normalizedRadii[1].
    //     //     upperLeft = normalizedRadii[0];
    //     //     upperRight = normalizedRadii[1];
    //     //     lowerRight = normalizedRadii[0];
    //     //     lowerLeft = normalizedRadii[1];
    //     //     break;
    //     // case 1:
    //     //     // 9. If normalizedRadii's size is 1, then set upperLeft, upperRight, lowerRight, and lowerLeft to normalizedRadii[0].
    //     //     upperLeft = normalizedRadii[0];
    //     //     upperRight = normalizedRadii[0];
    //     //     lowerRight = normalizedRadii[0];
    //     //     lowerLeft = normalizedRadii[0];
    //     //     break;
    //     // default:
    //     //     RELEASE_ASSERT_NOT_REACHED();
    //     //     break;
    //     // }

    //     // // Must handle clockwise and counter-clockwise directions properly so path winding works correctly.
    //     // bool clockwise = true;
    //     // if (width < 0) {
    //     //     clockwise = !clockwise;
    //     //     width = std::abs(width);
    //     //     x -= width;
    //     //     std::swap(upperLeft, upperRight);
    //     //     std::swap(lowerLeft, lowerRight);
    //     // }

    //     // if (height < 0) {
    //     //     clockwise = !clockwise;
    //     //     height = std::abs(height);
    //     //     y -= height;
    //     //     std::swap(upperLeft, lowerLeft);
    //     //     std::swap(upperRight, lowerRight);
    //     // }

    //     // // 10. Corner curves must not overlap. Scale all radii to prevent this:

    //     // // 10.1    Let top be upperLeft["x"] + upperRight["x"].
    //     // auto top = upperLeft.x() + upperRight.x();

    //     // // 10.2    Let right be upperRight["y"] + lowerRight["y"].
    //     // auto right = upperRight.y() + lowerRight.y();

    //     // // 10.3    Let bottom be lowerRight["x"] + lowerLeft["x"].
    //     // auto bottom = lowerRight.x() + lowerLeft.x();

    //     // // 10.4    Let left be upperLeft["y"] + lowerLeft["y"].
    //     // auto left = upperLeft.y() + lowerLeft.y();

    //     // // 10.5    Let scale be the minimum value of the ratios w / top, h / right, w / bottom, h / left.
    //     // auto scale = std::min({ width / top, height / right, width / bottom, height / left });

    //     // // 10.6    If scale is less than 1, then set the x and y members of upperLeft, upperRight, lowerLeft, and lowerRight to their current values multiplied by scale.
    //     // if (scale < 1) {
    //     //     upperLeft.scale(scale);
    //     //     upperRight.scale(scale);
    //     //     lowerLeft.scale(scale);
    //     //     lowerRight.scale(scale);
    //     // }

    //     // // 11. Create a new subpath:
    //     // m_path.moveTo({ x + upperLeft.x(), y });

    //     // // The 11.x clockwise substeps are handled by Path::addRoundedRect directly.
    //     // if (clockwise) {
    //     //     m_path.addRoundedRect({ FloatRect(x, y, width, height),
    //     //         { static_cast<float>(upperLeft.x()), static_cast<float>(upperLeft.y()) },
    //     //         { static_cast<float>(upperRight.x()), static_cast<float>(upperRight.y()) },
    //     //         { static_cast<float>(lowerLeft.x()), static_cast<float>(lowerLeft.y()) },
    //     //         { static_cast<float>(lowerRight.x()), static_cast<float>(lowerRight.y()) },
    //     //     });
    //     // } else {
    //     //     // Top Left corner
    //     //     if (upperLeft.x() > 0 || upperLeft.y() > 0) {
    //     //         m_path.addBezierCurveTo({ x + upperLeft.x() * m_path.circleControlPoint(), y },
    //     //             { x, y + upperLeft.y() * m_path.circleControlPoint() },
    //     //             { x, y + upperLeft.y() });
    //     //     }
    //     //     // Left edge
    //     //     m_path.addLineTo({ x, y + height - lowerLeft.y() });
    //     //     // Bottom left corner
    //     //     if (lowerLeft.x() > 0 || lowerLeft.y() > 0) {
    //     //         m_path.addBezierCurveTo({ x, y + height - lowerLeft.y() * m_path.circleControlPoint() },
    //     //             { x + lowerLeft.x() * m_path.circleControlPoint(), y + height },
    //     //             { x + lowerLeft.x(), y + height });
    //     //     }
    //     //     // Bottom edge
    //     //     m_path.addLineTo({ x + width - lowerRight.x(), y + height });
    //     //     // Bottom right corner
    //     //     if (lowerRight.x() > 0 || lowerRight.y() > 0) {
    //     //         m_path.addBezierCurveTo({ x + width - lowerRight.x() * m_path.circleControlPoint(), y + height },
    //     //             { x + width, y + height - lowerRight.y() * m_path.circleControlPoint() },
    //     //             { x + width, y + height - lowerRight.y() });
    //     //     }
    //     //     // Right edge
    //     //     m_path.addLineTo({ x + width, y + upperRight.y() });
    //     //     // Top right corner
    //     //     if (upperRight.x() > 0 || upperRight.y() > 0) {
    //     //         m_path.addBezierCurveTo({ x + width, y + upperRight.y() * m_path.circleControlPoint() },
    //     //             { x + width - upperRight.x() * m_path.circleControlPoint(), y },
    //     //             { x + width - upperRight.x(), y });
    //     //     }
    //     //     // Top edge
    //     //     m_path.addLineTo({ x + upperLeft.x(), y });
    //     // }

    //     // // 12. Mark the subpath as closed.
    //     // m_path.closeSubpath();

    //     // // 13. Create a new subpath with the point (x, y) as the only point in the subpath.
    //     // m_path.moveTo({ x, y });

    //     // return { };
}

float CanvasPath::currentX() const
{
    // return m_path.currentPoint().x();
}

float CanvasPath::currentY() const
{
    // return m_path.currentPoint().y();
}
}
