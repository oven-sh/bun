/*
 * Copyright (C) 2006-2021 Apple Inc. All rights reserved.
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

#include <cstdint>
#include <wtf/RefCountedAndCanMakeWeakPtr.h>
#include <wtf/WeakPtr.h>

namespace JSC {
class AbstractSlotVisitor;
class JSObject;
class SlotVisitor;
}

namespace WebCore {

class ScriptExecutionContext;
class Event;
class EventTarget;

class EventListener : public RefCountedAndCanMakeWeakPtr<EventListener> {
public:
    enum Type : uint8_t {
        JSEventListenerType,
        ImageEventListenerType,
        ObjCEventListenerType,
        CPPEventListenerType,
        ConditionEventListenerType,
        GObjectEventListenerType,
        NativeEventListenerType,
        SVGTRefTargetEventListenerType,
        PDFJSDocumentEventListenerType,
    };

    virtual ~EventListener() = default;
    virtual bool operator==(const EventListener& other) const { return this == &other; }

    virtual void handleEvent(ScriptExecutionContext&, Event&) = 0;

    virtual void visitJSFunctionInGCThread(JSC::AbstractSlotVisitor&) {}
    virtual void visitJSFunctionInGCThread(JSC::SlotVisitor&) {}

    virtual bool isAttribute() const { return false; }
    Type type() const { return m_type; }

#if ASSERT_ENABLED
    virtual void checkValidityForEventTarget(EventTarget&) {}
#endif

    virtual JSC::JSObject* jsFunction() const { return nullptr; }
    virtual JSC::JSObject* wrapper() const { return nullptr; }

protected:
    explicit EventListener(Type type)
        : m_type(type)
    {
    }

private:
    Type m_type;
};

} // namespace WebCore
