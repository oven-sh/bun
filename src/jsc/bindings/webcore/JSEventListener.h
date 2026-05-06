/*
 *  Copyright (C) 2001 Peter Kelly (pmk@post.com)
 *  Copyright (C) 2003-2021 Apple Inc. All rights reserved.
 *
 *  This library is free software; you can redistribute it and/or
 *  modify it under the terms of the GNU Lesser General Public
 *  License as published by the Free Software Foundation; either
 *  version 2 of the License, or (at your option) any later version.
 *
 *  This library is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 *  Lesser General Public License for more details.
 *
 *  You should have received a copy of the GNU Lesser General Public
 *  License along with this library; if not, write to the Free Software
 *  Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301  USA
 */

#pragma once

// #include "DOMWindow.h"
#include "DOMWrapperWorld.h"
#include "EventListener.h"
#include "EventNames.h"
// #include "HTMLElement.h"
#include <JavaScriptCore/StrongInlines.h>
#include <JavaScriptCore/Weak.h>
#include <JavaScriptCore/WeakInlines.h>
#include <wtf/Ref.h>
#include <wtf/TypeCasts.h>
#include <wtf/text/TextPosition.h>
#include <wtf/text/WTFString.h>

namespace WebCore {

class JSEventListener : public EventListener {
public:
    WEBCORE_EXPORT static Ref<JSEventListener> create(JSC::JSObject& listener, JSC::JSObject& wrapper, bool isAttribute, DOMWrapperWorld&);

    virtual ~JSEventListener();

    bool operator==(const EventListener&) const final;

    // Returns true if this event listener was created for an event handler attribute, like "onload" or "onclick".
    bool isAttribute() const final { return m_isAttribute; }

    bool wasCreatedFromMarkup() const { return m_wasCreatedFromMarkup; }

    JSC::JSObject* ensureJSFunction(ScriptExecutionContext&) const;
    DOMWrapperWorld& isolatedWorld() const { return m_isolatedWorld; }

    JSC::JSObject* jsFunction() const final { return m_jsFunction.get(); }
    JSC::JSObject* wrapper() const final { return m_wrapper.get(); }

    virtual URL sourceURL() const { return {}; }
    virtual TextPosition sourcePosition() const { return TextPosition(); }

    String functionName() const;

    void replaceJSFunctionForAttributeListener(JSC::JSObject* function, JSC::JSObject* wrapper);
    static bool wasCreatedFromMarkup(const EventListener& listener)
    {
        return is<JSEventListener>(listener) && downcast<JSEventListener>(listener).wasCreatedFromMarkup();
    }

private:
    virtual JSC::JSObject* initializeJSFunction(ScriptExecutionContext&) const;

    template<typename Visitor> void visitJSFunctionImpl(Visitor&);
    void visitJSFunction(JSC::AbstractSlotVisitor&) final;
    void visitJSFunction(JSC::SlotVisitor&) final;
    virtual String code() const { return String(); }

protected:
    enum class CreatedFromMarkup : bool { No,
        Yes };

    JSEventListener(JSC::JSObject* function, JSC::JSObject* wrapper, bool isAttribute, CreatedFromMarkup, DOMWrapperWorld&);
    void handleEvent(ScriptExecutionContext&, Event&) override;
    void setWrapperWhenInitializingJSFunction(JSC::VM&, JSC::JSObject* wrapper) const { m_wrapper = JSC::Weak<JSC::JSObject>(wrapper); }

private:
    bool m_isAttribute : 1;
    bool m_wasCreatedFromMarkup : 1;

    mutable bool m_isInitialized : 1;
    mutable JSC::Weak<JSC::JSObject> m_jsFunction;
    mutable JSC::Weak<JSC::JSObject> m_wrapper;

    Ref<DOMWrapperWorld> m_isolatedWorld;
};

// For "onxxx" attributes that automatically set up JavaScript event listeners.
JSC::JSValue eventHandlerAttribute(EventTarget&, const AtomString& eventType, DOMWrapperWorld&);

template<typename JSMaybeErrorEventListener>
inline void setEventHandlerAttribute(EventTarget& eventTarget, const AtomString& eventType, JSC::JSValue listener, JSC::JSObject& jsEventTarget)
{
    eventTarget.setAttributeEventListener<JSMaybeErrorEventListener>(eventType, listener, jsEventTarget);
}

// // Like the functions above, but for attributes that forward event handlers to the window object rather than setting them on the target.
// inline JSC::JSValue windowEventHandlerAttribute(DOMWindow& window, const AtomString& eventType, DOMWrapperWorld& isolatedWorld)
// {
//     return eventHandlerAttribute(window, eventType, isolatedWorld);
// }

// inline JSC::JSValue windowEventHandlerAttribute(HTMLElement& element, const AtomString& eventType, DOMWrapperWorld& isolatedWorld)
// {
//     if (auto* domWindow = element.document().domWindow())
//         return eventHandlerAttribute(*domWindow, eventType, isolatedWorld);
//     return JSC::jsNull();
// }

// template<typename JSMaybeErrorEventListener>
// inline void setWindowEventHandlerAttribute(DOMWindow& window, const AtomString& eventType, JSC::JSValue listener, JSC::JSObject& jsEventTarget)
// {
//     window.setAttributeEventListener<JSMaybeErrorEventListener>(eventType, listener, *jsEventTarget.globalObject());
// }

// template<typename JSMaybeErrorEventListener>
// inline void setWindowEventHandlerAttribute(HTMLElement& element, const AtomString& eventType, JSC::JSValue listener, JSC::JSObject& jsEventTarget)
// {
//     if (auto* domWindow = element.document().domWindow())
//         domWindow->setAttributeEventListener<JSMaybeErrorEventListener>(eventType, listener, *jsEventTarget.globalObject());
// }

inline JSC::JSObject* JSEventListener::ensureJSFunction(ScriptExecutionContext& scriptExecutionContext) const
{
    // initializeJSFunction can trigger code that deletes this event listener
    // before we're done. It should always return null in this case.
    JSC::VM& vm = m_isolatedWorld->vm();
    Ref protect = const_cast<JSEventListener&>(*this);
    JSC::EnsureStillAliveScope protectedWrapper(m_wrapper.get());

    if (!m_isInitialized) {
        ASSERT(!m_jsFunction);
        auto* function = initializeJSFunction(scriptExecutionContext);
        if (function) {
            m_jsFunction = JSC::Weak<JSC::JSObject>(function);
            // When JSFunction is initialized, initializeJSFunction must ensure that m_wrapper should be initialized too.
            ASSERT(m_wrapper);
            vm.writeBarrier(m_wrapper.get(), function);
            m_isInitialized = true;
        }
    }

    // m_wrapper and m_jsFunction are Weak<>. nullptr of these fields do not mean that this event-listener is not initialized yet.
    // If this is initialized once, m_isInitialized should be true, and then m_wrapper and m_jsFunction must be alive. m_wrapper's
    // liveness should be kept correctly by using ActiveDOMObject, output-constraints, etc. And m_jsFunction must be alive if m_wrapper
    // is alive since JSEventListener marks m_jsFunction in JSEventListener::visitJSFunction if m_wrapper is alive.
    // If the event-listener is not initialized yet, we should skip invoking this event-listener.
    if (!m_isInitialized)
        return nullptr;

    ASSERT(m_wrapper);
    ASSERT(m_jsFunction);
    // Ensure m_jsFunction is live JSObject as a quick sanity check (while it is already ensured by Weak<>). If this fails, this is possibly JSC GC side's bug.
    ASSERT(static_cast<JSC::JSCell*>(m_jsFunction.get())->isObject());

    return m_jsFunction.get();
}

} // namespace WebCore

SPECIALIZE_TYPE_TRAITS_BEGIN(WebCore::JSEventListener)
static bool isType(const WebCore::EventListener& input) { return input.type() == WebCore::JSEventListener::JSEventListenerType; }
SPECIALIZE_TYPE_TRAITS_END()
