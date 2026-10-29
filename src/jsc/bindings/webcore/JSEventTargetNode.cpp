

#include "root.h"

#include "JavaScriptCore/JSGlobalObject.h"
#include "JavaScriptCore/ArgList.h"
#include "JavaScriptCore/JSGlobalObjectInlines.h"
#include "JSEventTarget.h"
#include "JSEvent.h"
#include "EventNames.h"
#include "WebCoreJSClientData.h"
#include "JavaScriptCore/JSArray.h"
#include "JavaScriptCore/CustomGetterSetter.h"
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

static JSValue signalOfAbortEvent(VM& vm, JSEvent& wrapper)
{
    JSValue signal = wrapper.getDirect(vm, WebCore::builtinNames(vm).signalPrivateName());
    return signal ? signal : jsNull();
}

// For a signal that is no EventTarget, `target` and `currentTarget` are own values of its abort event. A later dispatch overrides them.
JSC_DEFINE_CUSTOM_GETTER(jsAbortEventTargetOfAnySignal, (JSGlobalObject * lexicalGlobalObject, EncodedJSValue thisValue, PropertyName))
{
    auto* wrapper = dynamicDowncast<JSEvent>(JSValue::decode(thisValue));
    if (!wrapper) [[unlikely]]
        return JSValue::encode(jsUndefined());

    if (auto* target = wrapper->wrapped().target())
        return JSValue::encode(toJS(lexicalGlobalObject, wrapper->globalObject(), *target));
    return JSValue::encode(signalOfAbortEvent(JSC::getVM(lexicalGlobalObject), *wrapper));
}

JSC_DEFINE_CUSTOM_GETTER(jsAbortEventCurrentTargetOfAnySignal, (JSGlobalObject * lexicalGlobalObject, EncodedJSValue thisValue, PropertyName))
{
    auto* wrapper = dynamicDowncast<JSEvent>(JSValue::decode(thisValue));
    if (!wrapper) [[unlikely]]
        return JSValue::encode(jsUndefined());

    Event& event = wrapper->wrapped();
    if (auto* currentTarget = event.currentTarget())
        return JSValue::encode(toJS(lexicalGlobalObject, wrapper->globalObject(), *currentTarget));
    if (!event.isBeingDispatched())
        return JSValue::encode(jsNull());
    return JSValue::encode(signalOfAbortEvent(JSC::getVM(lexicalGlobalObject), *wrapper));
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
    // JSEvent does not mark the wrapper of its target, and the reason of a signal lives on that wrapper.
    object->putDirect(vm, WebCore::builtinNames(vm).signalPrivateName(), signal, PropertyAttribute::DontEnum | 0);
    if (!target) {
        // validateAbortSignal() takes any object that has `aborted`, such as the AbortSignal of happy-dom or jsdom.
        unsigned attributes = PropertyAttribute::CustomValue | PropertyAttribute::ReadOnly | PropertyAttribute::DontEnum;
        auto* targetValue = CustomGetterSetter::create(vm, jsAbortEventTargetOfAnySignal, nullptr);
        object->putDirectCustomAccessor(vm, vm.propertyNames->target, targetValue, attributes);
        object->putDirectCustomAccessor(vm, Identifier::fromString(vm, "srcElement"_s), targetValue, attributes);
        auto* currentTargetValue = CustomGetterSetter::create(vm, jsAbortEventCurrentTargetOfAnySignal, nullptr);
        object->putDirectCustomAccessor(vm, Identifier::fromString(vm, "currentTarget"_s), currentTargetValue, attributes);
    }

    return JSValue::encode(wrapper);
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionNodeEventsFinishAbortEvent, (JSGlobalObject*, CallFrame* callFrame))
{
    if (auto* wrapper = dynamicDowncast<JSEvent>(callFrame->argument(0))) {
        Event& event = wrapper->wrapped();
        event.setCurrentTarget(nullptr);
        event.setEventPhase(Event::NONE);
    }

    return JSValue::encode(jsUndefined());
}

}
