/*
 * Copyright (C) 2005, 2015 Apple Inc.
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

#include "config.h"
#include "EventNames.h"

namespace WebCore {

#define INITIALIZE_EVENT_NAME(name) \
    name##Event(makeAtomString(#name)),

EventNames::EventNames()
    : DOM_EVENT_NAMES_FOR_EACH(INITIALIZE_EVENT_NAME) dummy(0)
{
}

thread_local std::unique_ptr<EventNames> eventNames_;

const EventNames& eventNames()
{
    if (!eventNames_)
        eventNames_ = EventNames::create();
    return *eventNames_;
}

}
