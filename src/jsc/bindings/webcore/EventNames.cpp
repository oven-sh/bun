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
#include "JavaScriptCore/JSGlobalObject.h"
#include "JavaScriptCore/JSStringInlines.h"
#include "wtf/Assertions.h"

namespace WebCore {

#define INITIALIZE_EVENT_NAME(name) \
    name##Event(makeAtomString(#name##_s)),

EventNames::EventNames()
    : DOM_EVENT_NAMES_FOR_EACH(INITIALIZE_EVENT_NAME) dummy(0)
{
}

const EventNames& eventNames()
{
    // Saves the call that finds the thread's value.
    static thread_local constinit const EventNames* names = nullptr;
    if (!names) [[unlikely]] {
        static NeverDestroyed<ThreadSpecific<EventNames>> namesOfThread;
        names = namesOfThread.get();
    }
    return *names;
}

enum class DOMEventName : uint8_t {
    rename = 0,
    change = 1,
    error = 2,
    abort = 3,
    close = 4,

};

extern "C" JSC::EncodedJSValue Bun__domEventNameToJS(JSC::JSGlobalObject* globalObject, DOMEventName name)
{
    const auto& eventName = [&]() -> const AtomString& {
        switch (name) {
        case DOMEventName::rename:
            return eventNames().renameEvent;
        case DOMEventName::change:
            return eventNames().changeEvent;
        case DOMEventName::error:
            return eventNames().errorEvent;
        case DOMEventName::abort:
            return eventNames().abortEvent;
        case DOMEventName::close:
            return eventNames().closeEvent;
        default:
            RELEASE_ASSERT_NOT_REACHED();
        }
    }();

    return JSValue::encode(JSC::jsString(globalObject->vm(), eventName));
}

}
