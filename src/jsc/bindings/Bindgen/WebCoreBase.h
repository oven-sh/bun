#pragma once
#include "root.h"
#include "DOMException.h"
#include "Event.h"
#include "EventTarget.h"
#include "JSDOMException.h"
#include "JSDOMWrapperCache.h"
#include "JSEvent.h"
#include "JSEventTarget.h"
#include "headers-handwritten.h"

// For a generated class that extends a class of WebCore.
namespace Bun::Bindgen {

// `bindgen::EventBase` in Rust.
struct EventBase {
    BunString type;
    bool bubbles;
    bool cancelable;
    bool composed;
    bool isTrusted;
};

// `bindgen::DOMExceptionBase` in Rust.
struct DOMExceptionBase {
    BunString message;
};

// What an instance wraps.
Ref<WebCore::EventTarget> createEventTarget(Zig::GlobalObject&);
Ref<WebCore::Event> createEvent(const EventBase&);
Ref<WebCore::DOMException> createDOMException(WTF::ASCIILiteral className, const DOMExceptionBase&);

JSC::JSValue eventHandler(WebCore::JSEventTarget&, WTF::ASCIILiteral eventType);
void setEventHandler(JSC::VM&, WebCore::JSEventTarget&, WTF::ASCIILiteral eventType, JSC::JSValue);

}
