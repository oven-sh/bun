#include "root.h"
#include "Bindgen/WebCoreBase.h"
#include "EventInit.h"
#include "JSEventListener.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/Error.h>
#include <JavaScriptCore/JSCInlines.h>

namespace Bun::Bindgen {
using namespace JSC;
using namespace WebCore;

Ref<EventTarget> createEventTarget(Zig::GlobalObject& globalObject)
{
    return EventTarget::create(*globalObject.currentScriptExecutionContext());
}

Ref<Event> createEvent(const EventBase& base)
{
    EventInit init;
    init.bubbles = base.bubbles;
    init.cancelable = base.cancelable;
    init.composed = base.composed;
    return Event::create(AtomString(base.type.toWTFString(BunString::NonNull)), init, base.isTrusted ? Event::IsTrusted::Yes : Event::IsTrusted::No);
}

// https://webidl.spec.whatwg.org/#idl-DOMException-derived-interfaces
Ref<DOMException> createDOMException(ASCIILiteral className, const DOMExceptionBase& base)
{
    return DOMException::create(base.message.toWTFString(BunString::NonNull), className);
}

JSValue eventHandler(JSEventTarget& target, ASCIILiteral eventType)
{
    return eventHandlerAttribute(target.wrapped(), AtomString(eventType), worldForDOMObject(target));
}

void setEventHandler(VM& vm, JSEventTarget& target, ASCIILiteral eventType, JSValue value)
{
    setEventHandlerAttribute<JSEventListener>(target.wrapped(), AtomString(eventType), value, target);
    vm.writeBarrier(&target, value);
    ensureStillAliveHere(value);
}

extern "C" void Bun__Bindgen__addErrorInfo(JSGlobalObject* globalObject, EncodedJSValue object)
{
    addErrorInfo(globalObject, asObject(JSValue::decode(object)), true);
}

// What `target.dispatchEvent(event)` returns, for an event that was just made. What a listener throws is reported.
extern "C" bool Bun__Bindgen__dispatchEvent(JSEventTarget* target, JSEvent* event)
{
    EnsureStillAliveScope ensureTargetStillAlive { target };
    EnsureStillAliveScope ensureEventStillAlive { event };
    target->wrapped().dispatchEvent(event->wrapped());
    return !event->wrapped().defaultPrevented();
}

}
