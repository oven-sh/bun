

#include "root.h"

#include "JavaScriptCore/JSGlobalObject.h"
#include "JavaScriptCore/ArgList.h"
#include "JavaScriptCore/JSGlobalObjectInlines.h"
#include "JSEventTarget.h"
#include "JSEvent.h"
#include "EventNames.h"
#include "WebCoreJSClientData.h"
#include "JavaScriptCore/JSArray.h"
#include "wtf/text/MakeString.h"
#include "../ErrorCode.h"

namespace Bun {

using namespace JSC;
using namespace WebCore;
JSC_DEFINE_HOST_FUNCTION(jsFunctionNodeEventsGetEventListeners, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    if (callFrame->argumentCount() < 2) {
        throwTypeError(globalObject, throwScope, "getEventListeners needs 2 arguments"_s);
        return {};
    }

    JSValue thisValue = callFrame->argument(0);
    auto* thisObject = dynamicDowncast<JSEventTarget>(thisValue);
    auto eventType = callFrame->argument(1).toWTFString(globalObject);
    RETURN_IF_EXCEPTION(throwScope, {});

    if (!thisObject) [[unlikely]] {
        return Bun::throwError(globalObject, throwScope, Bun::ErrorCode::ERR_INVALID_ARG_TYPE,
            "ERR_INVALID_ARG_TYPE: first argument must be of type EventEmitter"_s);
    }

    MarkedArgumentBuffer values;
    auto& listeners = thisObject->wrapped().eventListeners(WTF::makeAtomString(eventType));
    for (auto& listener : listeners) {
        auto* function = listener->callback().jsFunction();
        if (function) {
            values.append(function);
        }
    }

    RELEASE_AND_RETURN(throwScope, JSValue::encode(constructArray(globalObject, static_cast<ArrayAllocationProfile*>(nullptr), values)));
}

// events.addAbortListener() on an aborted signal: node's `kTarget` and `kIsBeingDispatched` steps, before and after the listener.
JSC_DEFINE_HOST_FUNCTION(jsFunctionNodeEventsArmAbortEvent, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    JSValue signal = callFrame->argument(0);
    auto* target = dynamicDowncast<JSEventTarget>(signal);

    Ref<Event> event = Event::create(eventNames().abortEvent, Event::CanBubble::No, Event::IsCancelable::No);
    event->setEventPhase(Event::AT_TARGET);
    if (target) {
        event->setTarget(RefPtr<EventTarget> { &target->wrapped() });
        event->setCurrentTarget(&target->wrapped());
    }

    JSValue wrapper = toJSNewlyCreated(lexicalGlobalObject, defaultGlobalObject(lexicalGlobalObject), WTF::move(event));
    RETURN_IF_EXCEPTION(throwScope, {});

    JSObject* object = asObject(wrapper);
    if (target) {
        // JSEvent does not mark the wrapper of its target, and the reason of a signal lives on that wrapper.
        object->putDirect(vm, WebCore::builtinNames(vm).signalPrivateName(), signal, PropertyAttribute::DontEnum | 0);
    } else {
        // validateAbortSignal() takes any object that has `aborted`, such as the AbortSignal of happy-dom or jsdom.
        unsigned attributes = PropertyAttribute::ReadOnly | PropertyAttribute::DontEnum;
        object->putDirect(vm, vm.propertyNames->target, signal, attributes);
        object->putDirect(vm, Identifier::fromString(vm, "currentTarget"_s), signal, attributes);
    }

    return JSValue::encode(wrapper);
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionNodeEventsFinishAbortEvent, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);

    auto* wrapper = dynamicDowncast<JSEvent>(callFrame->argument(0));
    if (!wrapper)
        return JSValue::encode(jsUndefined());

    Event& event = wrapper->wrapped();
    event.setCurrentTarget(nullptr);
    event.setEventPhase(Event::NONE);
    if (!event.target()) {
        // Stored over, not deleted: a delete would give every such event a Structure of its own.
        auto currentTarget = Identifier::fromString(vm, "currentTarget"_s);
        if (wrapper->getDirect(vm, currentTarget))
            wrapper->putDirect(vm, currentTarget, jsNull(), PropertyAttribute::ReadOnly | PropertyAttribute::DontEnum);
    }

    return JSValue::encode(jsUndefined());
}

}
