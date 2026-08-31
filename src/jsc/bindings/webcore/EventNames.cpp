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
#include "ZigGlobalObject.h"
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

thread_local std::unique_ptr<EventNames> eventNames_;

const EventNames& eventNames()
{
    if (!eventNames_)
        eventNames_ = EventNames::create();
    return *eventNames_;
}

// Must be kept in sync with `EventType` in src/runtime/node/node_fs_watcher.rs
enum class DOMEventName : uint8_t {
    rename = 0,
    change = 1,
    error = 2,
    abort = 3,
    close = 4,

};

extern "C" JSC::EncodedJSValue Bun__domEventNameToJS(JSC::JSGlobalObject* lexicalGlobalObject, DOMEventName name)
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto& commonStrings = globalObject->commonStrings();
    switch (name) {
    case DOMEventName::rename:
        return JSValue::encode(commonStrings.eventRenameString(globalObject));
    case DOMEventName::change:
        return JSValue::encode(commonStrings.eventChangeString(globalObject));
    case DOMEventName::error:
        return JSValue::encode(commonStrings.fetchErrorString(globalObject));
    case DOMEventName::abort:
        return JSValue::encode(commonStrings.eventAbortString(globalObject));
    case DOMEventName::close:
        return JSValue::encode(commonStrings.eventCloseString(globalObject));
    default:
        RELEASE_ASSERT_NOT_REACHED();
    }
}

}
