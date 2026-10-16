/*
 * Copyright (C) Research In Motion Limited 2010. All rights reserved.
 * Copyright (C) 2018-2024 Apple Inc. All rights reserved.
 *
 * This library is free software; you can redistribute it and/or
 * modify it under the terms of the GNU Library General Public
 * License as published by the Free Software Foundation; either
 * version 2 of the License, or (at your option) any later version.
 *
 * This library is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 * Library General Public License for more details.
 *
 * You should have received a copy of the GNU Library General Public License
 * along with this library; see the file COPYING.LIB.  If not, write to
 * the Free Software Foundation, Inc., 51 Franklin Street, Fifth Floor,
 * Boston, MA 02110-1301, USA.
 */

#pragma once

#include "ExceptionOr.h"
#include "SVGProperty.h"
#include "ScriptWrappable.h"
#include <wtf/RefCounted.h>
#include <wtf/TZoneMalloc.h>

namespace WebCore {

class SVGElement;

// Either four numbers of its own (createSVGRect()), or the `viewBox` attribute of an element.
class SVGRect final : public ScriptWrappable, public RefCounted<SVGRect> {
    WTF_MAKE_TZONE_ALLOCATED(SVGRect);
public:
    struct Value {
        float x { 0 };
        float y { 0 };
        float width { 0 };
        float height { 0 };
    };

    static Ref<SVGRect> create();
    static Ref<SVGRect> create(SVGElement&, SVGPropertyAccess);
    ~SVGRect();

    float x() { return value().x; }
    float y() { return value().y; }
    float width() { return value().width; }
    float height() { return value().height; }

    ExceptionOr<void> setX(float x) { return set(&Value::x, x); }
    ExceptionOr<void> setY(float y) { return set(&Value::y, y); }
    ExceptionOr<void> setWidth(float width) { return set(&Value::width, width); }
    ExceptionOr<void> setHeight(float height) { return set(&Value::height, height); }

private:
    SVGRect(SVGElement*, SVGPropertyAccess);

    Value value() const;
    ExceptionOr<void> set(float Value::*, float);

    const RefPtr<SVGElement> m_contextElement;
    const SVGPropertyAccess m_access;
    Value m_value;
};

}
