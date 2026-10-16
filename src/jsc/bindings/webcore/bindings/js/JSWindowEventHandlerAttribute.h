#pragma once

#include "Document.h"
#include "HTMLElement.h"
#include "JSDOMWrapperCache.h"
#include "JSEventHandlerAttribute.h"
#include "JSEventListener.h"
#include "JSHTMLElement.h"
#include "JSWindow.h"
#include "Window.h"

namespace WebCore {

// Upstream has these in JSEventListener.h. They are apart in Bun so that a listener on a plain EventTarget does not need HTMLElement.h.
// For attributes that forward event handlers to the window object rather than setting them on the target (`body.onload`).
inline JSC::JSValue windowEventHandlerAttribute(Window& window, const AtomString& eventType, DOMWrapperWorld& isolatedWorld)
{
    return eventHandlerAttribute(window, eventType, isolatedWorld);
}

inline JSC::JSValue windowEventHandlerAttribute(HTMLElement& element, const AtomString& eventType, DOMWrapperWorld& isolatedWorld)
{
    if (RefPtr window = element.document().window())
        return eventHandlerAttribute(*window, eventType, isolatedWorld);
    return JSC::jsNull();
}

// The window's wrapper marks the listener's function. Upstream passes the global object, which is the window there.
template<typename JSMaybeErrorEventListener>
inline void setWindowEventHandlerAttribute(Window& window, const AtomString& eventType, JSC::JSValue listener, JSC::JSObject& jsEventTarget)
{
    auto* globalObject = uncheckedDowncast<JSDOMGlobalObject>(jsEventTarget.realm());
    window.setAttributeEventListener<JSMaybeErrorEventListener>(eventType, listener, *asObject(wrap(globalObject, globalObject, window)));
}

template<typename JSMaybeErrorEventListener>
inline void setWindowEventHandlerAttribute(HTMLElement& element, const AtomString& eventType, JSC::JSValue listener, JSC::JSObject& jsEventTarget)
{
    if (RefPtr window = element.document().window())
        setWindowEventHandlerAttribute<JSMaybeErrorEventListener>(*window, eventType, listener, jsEventTarget);
}

// For eventHandlerAttributeGetter() and eventHandlerAttributeSetter() in JSEventHandlerAttribute.h. JSWrapper is JSHTMLElement (body, frameset) or JSWindow.
template<typename JSWrapper>
struct WindowEventHandlerAttribute {
    using Wrapper = JSWrapper;
    using Implementation = typename JSWrapper::DOMWrapped;

    static JSC::JSValue get(Implementation& implementation, const AtomString& eventType, DOMWrapperWorld& world) { return windowEventHandlerAttribute(implementation, eventType, world); }

    template<typename Listener>
    static void set(Implementation& implementation, const AtomString& eventType, JSC::JSValue value, JSC::JSObject& wrapper) { setWindowEventHandlerAttribute<Listener>(implementation, eventType, value, wrapper); }
};

} // namespace WebCore
