

#include "root.h"

#include "JavaScriptCore/JSGlobalObject.h"
#include "JavaScriptCore/ArgList.h"
#include "JavaScriptCore/JSGlobalObjectInlines.h"
#include "JSEventTarget.h"
#include "AddEventListenerOptions.h"
#include "CustomEvent.h"
#include "EventNames.h"
#include "JSEventListener.h"
#include "JSMessagePort.h"
#include "JSDOMConvertStrings.h"
#include "MessageEvent.h"
#include "JavaScriptCore/JSArray.h"
#include "JavaScriptCore/Symbol.h"
#include "wtf/text/MakeString.h"
#include "../ErrorCode.h"
#include "../NodeValidator.h"

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

// node's NodeEventTarget (lib/internal/event_target.js), for the MessagePort shim in node:worker_threads.

// `standIn`: the receiver was the parentPort of a web Worker, whose listeners live on the global scope.
static JSEventTargetWrapper nodeEventTarget(VM& vm, JSValue value, bool standIn)
{
    if (standIn)
        return jsEventTargetCast(vm, value);
    if (auto* port = dynamicDowncast<JSMessagePort>(value))
        return { port->wrapped(), *port };
    return {};
}

// The stand-in sees only the listeners of its own on()/once(), not the others of the global scope.
static bool matches(const RegisteredEventListener& registered, bool nodeStyleOnly)
{
    if (!nodeStyleOnly)
        return true;
    auto* listener = dynamicDowncast<JSEventListener>(registered.callback());
    return listener && listener->isNodeStyle();
}

// `String(type)`, which listenerCount() and removeAllListeners() apply: a Symbol does not throw.
static AtomString toEventTypeString(JSGlobalObject* globalObject, JSValue type)
{
    if (type.isSymbol())
        return makeAtomString(asSymbol(type)->tryGetDescriptiveString().value_or(String()));
    return makeAtomString(type.toWTFString(globalObject));
}

// (receiver, type, listener, once, standIn). False for a null or undefined listener: nothing is added.
JSC_DEFINE_HOST_FUNCTION(jsFunctionNodeEventTargetAddListener, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    auto target = nodeEventTarget(vm, callFrame->argument(0), callFrame->argument(4).isTrue());
    if (target.isNull()) [[unlikely]]
        return Bun::ERR::INVALID_THIS(throwScope, globalObject, "NodeEventTarget"_s);

    // node validates the listener before it converts the type.
    JSValue listenerValue = callFrame->argument(2);
    if (!listenerValue.isObject()) [[unlikely]] {
        if (listenerValue.isUndefinedOrNull())
            return JSValue::encode(jsBoolean(false));
        return Bun::ERR::INVALID_ARG_INSTANCE(throwScope, globalObject, "listener"_s, "EventListener"_s, listenerValue);
    }

    auto type = convert<IDLAtomStringAdaptor<IDLDOMString>>(*globalObject, callFrame->argument(1));
    RETURN_IF_EXCEPTION(throwScope, {});

    JSObject& wrapper = target;
    auto listener = JSEventListener::create(*asObject(listenerValue), wrapper, false, currentWorld(*globalObject));
    listener->setIsNodeStyle();
    AddEventListenerOptions options;
    options.once = callFrame->argument(3).isTrue();
    target.wrapped().addEventListener(type, WTF::move(listener), options);
    vm.writeBarrier(&wrapper, listenerValue);
    return JSValue::encode(jsBoolean(true));
}

// (receiver): the receiver check of the methods that the shim implements in JS.
JSC_DEFINE_HOST_FUNCTION(jsFunctionNodeEventTargetAssert, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    if (nodeEventTarget(vm, callFrame->argument(0), false).isNull()) [[unlikely]]
        return Bun::ERR::INVALID_THIS(throwScope, globalObject, "NodeEventTarget"_s);
    return JSValue::encode(jsUndefined());
}

// (receiver, type, standIn)
JSC_DEFINE_HOST_FUNCTION(jsFunctionNodeEventTargetListenerCount, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    bool standIn = callFrame->argument(2).isTrue();
    auto target = nodeEventTarget(vm, callFrame->argument(0), standIn);
    if (target.isNull()) [[unlikely]]
        return Bun::ERR::INVALID_THIS(throwScope, globalObject, "NodeEventTarget"_s);

    auto type = toEventTypeString(globalObject, callFrame->argument(1));
    RETURN_IF_EXCEPTION(throwScope, {});

    unsigned count = 0;
    for (auto& registered : target.wrapped().eventListeners(type))
        count += matches(*registered, standIn);
    return JSValue::encode(jsNumber(count));
}

// (receiver, standIn)
JSC_DEFINE_HOST_FUNCTION(jsFunctionNodeEventTargetEventNames, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    bool standIn = callFrame->argument(1).isTrue();
    auto target = nodeEventTarget(vm, callFrame->argument(0), standIn);
    if (target.isNull()) [[unlikely]]
        return Bun::ERR::INVALID_THIS(throwScope, globalObject, "NodeEventTarget"_s);

    auto& impl = target.wrapped();
    MarkedArgumentBuffer names;
    for (auto& type : impl.eventTypes()) {
        for (auto& registered : impl.eventListeners(type)) {
            if (matches(*registered, standIn)) {
                names.append(jsString(vm, type.string()));
                break;
            }
        }
    }
    RELEASE_AND_RETURN(throwScope, JSValue::encode(constructArray(globalObject, static_cast<ArrayAllocationProfile*>(nullptr), names)));
}

// (receiver, type | undefined, standIn)
JSC_DEFINE_HOST_FUNCTION(jsFunctionNodeEventTargetRemoveAllListeners, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    bool standIn = callFrame->argument(2).isTrue();
    auto target = nodeEventTarget(vm, callFrame->argument(0), standIn);
    if (target.isNull()) [[unlikely]]
        return Bun::ERR::INVALID_THIS(throwScope, globalObject, "NodeEventTarget"_s);

    auto& impl = target.wrapped();
    Vector<AtomString> types;
    JSValue typeValue = callFrame->argument(1);
    if (typeValue.isUndefined())
        types = impl.eventTypes();
    else {
        types.append(toEventTypeString(globalObject, typeValue));
        RETURN_IF_EXCEPTION(throwScope, {});
    }

    // One removeEventListener() per listener: a MessagePort then releases its loop ref as it does for off().
    for (auto& type : types) {
        EventListenerVector listeners = impl.eventListeners(type);
        for (auto& registered : listeners) {
            if (matches(*registered, standIn))
                impl.removeEventListener(type, registered->callback(), registered->useCapture());
        }
    }
    return JSValue::encode(jsUndefined());
}

// (port, type, value): emit(). Returns whether the port had a listener for `type`.
JSC_DEFINE_HOST_FUNCTION(jsFunctionNodeEventTargetEmit, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    auto target = nodeEventTarget(vm, callFrame->argument(0), false);
    if (target.isNull()) [[unlikely]]
        return Bun::ERR::INVALID_THIS(throwScope, globalObject, "NodeEventTarget"_s);

    JSValue typeValue = callFrame->argument(1);
    Bun::V::validateString(throwScope, globalObject, typeValue, "type"_s);
    RETURN_IF_EXCEPTION(throwScope, {});
    auto type = convert<IDLAtomStringAdaptor<IDLDOMString>>(*globalObject, typeValue);
    RETURN_IF_EXCEPTION(throwScope, {});

    auto& impl = target.wrapped();
    if (!impl.hasEventListeners(type))
        return JSValue::encode(jsBoolean(false));

    // on() listeners get `value`. addEventListener() listeners get a MessageEvent (data) or a CustomEvent (detail).
    JSValue value = callFrame->argument(2);
    JSValue inEvent = value.isUndefined() ? jsNull() : value;
    RefPtr<Event> event;
    if (type == eventNames().messageEvent || type == eventNames().messageerrorEvent) {
        MessageEvent::Init init;
        init.data = inEvent;
        event = MessageEvent::create(type, WTF::move(init));
    } else {
        CustomEvent::Init init;
        init.detail = inEvent;
        event = CustomEvent::create(type, init);
    }
    NodeStyleEventValue::dispatch(vm, impl, *event, value);
    return JSValue::encode(jsBoolean(true));
}

}
