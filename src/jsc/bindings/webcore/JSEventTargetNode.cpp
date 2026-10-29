

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

    Ref<Event> event = Event::create(eventNames().abortEvent, Event::CanBubble::No, Event::IsCancelable::No);
    event->setEventPhase(Event::AT_TARGET);

    JSValue wrapper = toJSNewlyCreated(lexicalGlobalObject, defaultGlobalObject(lexicalGlobalObject), WTF::move(event));
    RETURN_IF_EXCEPTION(throwScope, {});

    // A signal need not be an EventTarget, so the wrapper names it: JSEvent answers this slot where the event has no native target.
    asObject(wrapper)->putDirect(vm, WebCore::builtinNames(vm).signalPrivateName(), callFrame->argument(0), PropertyAttribute::DontEnum | 0);

    return JSValue::encode(wrapper);
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionNodeEventsFinishAbortEvent, (JSGlobalObject*, CallFrame* callFrame))
{
    if (auto* wrapper = dynamicDowncast<JSEvent>(callFrame->argument(0)))
        wrapper->wrapped().setEventPhase(Event::NONE);

    return JSValue::encode(jsUndefined());
}

}
