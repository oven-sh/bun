/*
 * Copyright (C) 2001 Peter Kelly (pmk@post.com)
 * Copyright (C) 2001 Tobias Anton (anton@stud.fbi.fh-darmstadt.de)
 * Copyright (C) 2006 Samuel Weinig (sam.weinig@gmail.com)
 * Copyright (C) 2003-2017 Apple Inc. All rights reserved.
 * Copyright (C) 2013 Samsung Electronics
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
 *
 */

#pragma once

#include "Event.h"

namespace WebCore {

class BeforeUnloadEvent final : public Event {
    WTF_MAKE_TZONE_ALLOCATED(BeforeUnloadEvent);
public:
    static Ref<BeforeUnloadEvent> create()
    {
        return adoptRef(*new BeforeUnloadEvent);
    }

    static Ref<BeforeUnloadEvent> createForBindings()
    {
        return adoptRef(*new BeforeUnloadEvent { ForBindings });
    }

    String returnValue() const { return m_returnValue; }
    void setReturnValue(const String& returnValue) { m_returnValue = returnValue; }

private:
    enum ForBindingsFlag { ForBindings };
    BeforeUnloadEvent();
    explicit BeforeUnloadEvent(ForBindingsFlag);

    String m_returnValue;
};

} // namespace WebCore

SPECIALIZE_TYPE_TRAITS_EVENT(BeforeUnloadEvent)
