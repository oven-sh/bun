/*
 * Copyright (C) 2001 Peter Kelly (pmk@post.com)
 * Copyright (C) 2001 Tobias Anton (anton@stud.fbi.fh-darmstadt.de)
 * Copyright (C) 2006 Samuel Weinig (sam.weinig@gmail.com)
 * Copyright (C) 2003, 2005, 2006, 2008, 2010, 2013 Apple Inc. All rights reserved.
 * Copyright (C) 2013 Samsung Electronics. All rights reserved.
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

#include "config.h"
#include "WheelEvent.h"

#include "EventNames.h"
#include "MouseEventTypes.h"
#include "Node.h"
#include <wtf/MathExtras.h>
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(WheelEvent);

static double LEGACY_NODELETE wheelDeltaToDelta(int wheelDelta)
{
    // Avoid returning negative zero.
    if (!wheelDelta)
        return 0;
    return -static_cast<double>(wheelDelta);
}

inline WheelEvent::WheelEvent()
    : MouseEvent(EventInterfaceType::WheelEvent)
{
}

inline WheelEvent::WheelEvent(const AtomString& type, const Init& initializer)
    : MouseEvent(EventInterfaceType::WheelEvent, type, initializer, IsTrusted::No)
    , m_wheelDeltaX(initializer.wheelDeltaX ? initializer.wheelDeltaX : clampTo<int>(-initializer.deltaX))
    , m_wheelDeltaY(initializer.wheelDeltaY ? initializer.wheelDeltaY : clampTo<int>(-initializer.deltaY))
    , m_deltaX(initializer.deltaX ? initializer.deltaX : wheelDeltaToDelta(initializer.wheelDeltaX))
    , m_deltaY(initializer.deltaY ? initializer.deltaY : wheelDeltaToDelta(initializer.wheelDeltaY))
    , m_deltaZ(initializer.deltaZ)
    , m_deltaMode(initializer.deltaMode)
{
}

Ref<WheelEvent> WheelEvent::createForBindings()
{
    return adoptRef(*new WheelEvent);
}

Ref<WheelEvent> WheelEvent::create(const AtomString& type, const Init& initializer)
{
    return adoptRef(*new WheelEvent(type, initializer));
}

} // namespace WebCore
