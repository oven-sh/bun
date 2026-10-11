

#include "root.h"

#include "JavaScriptCore/JSGlobalObject.h"
#include "JavaScriptCore/ArgList.h"
#include "JavaScriptCore/JSGlobalObjectInlines.h"
#include "JSEventTarget.h"
#include "JSEvent.h"
#include "JSEventListener.h"
#include "JSEventListenerOptions.h"
#include "JSMessagePort.h"
#include "JSDOMConvertBoolean.h"
#include "JSDOMConvertDictionary.h"
#include "JSDOMConvertStrings.h"
#include "JSDOMConvertUnion.h"
#include "JSDOMExceptionHandling.h"
#include "JavaScriptCore/JSArray.h"
#include "JavaScriptCore/Symbol.h"
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

// The functions below are node's NodeEventTarget (lib/internal/event_target.js) over the one
// EventTarget listener list. Only the MessagePort shim in node:worker_threads calls them.

// The receiver of a NodeEventTarget method: a MessagePort. `standIn` is the shim's word that the
// receiver was the parentPort it gives a web Worker, whose listeners live on the global scope.
static JSEventTargetWrapper nodeEventTarget(VM& vm, JSValue value, bool standIn)
{
    if (standIn)
        return jsEventTargetCast(vm, value);
    if (auto* port = dynamicDowncast<JSMessagePort>(value))
        return { port->wrapped(), *port };
    return {};
}

// On the stand-in these methods see only what its own on()/once() registered, never the other
// listeners of the global scope.
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

// (receiver, type, listener, once, standIn)
JSC_DEFINE_HOST_FUNCTION(jsFunctionNodeEventTargetAddListener, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    auto target = nodeEventTarget(vm, callFrame->argument(0), callFrame->argument(4).isTrue());
    if (target.isNull()) [[unlikely]]
        return Bun::ERR::INVALID_THIS(throwScope, globalObject, "NodeEventTarget"_s);

    // node validates the listener before it converts the type.
    JSValue listenerValue = callFrame->argument(2);
    if (!listenerValue.isObject() && !listenerValue.isUndefinedOrNull()) [[unlikely]]
        return Bun::ERR::INVALID_ARG_INSTANCE(throwScope, globalObject, "listener"_s, "EventListener"_s, listenerValue);

    auto type = convert<IDLAtomStringAdaptor<IDLDOMString>>(*globalObject, callFrame->argument(1));
    RETURN_IF_EXCEPTION(throwScope, {});

    JSObject& wrapper = target;
    if (!listenerValue.isObject()) {
        emitAddEventListenerArgumentTypeWarning(*globalObject, wrapper, type, listenerValue);
        RETURN_IF_EXCEPTION(throwScope, {});
        return JSValue::encode(jsUndefined());
    }

    auto listener = JSEventListener::create(*asObject(listenerValue), wrapper, false, currentWorld(*globalObject));
    listener->setIsNodeStyle();
    AddEventListenerOptions options;
    options.once = callFrame->argument(3).isTrue();
    target.wrapped().addEventListener(type, WTF::move(listener), options);
    vm.writeBarrier(&wrapper, listenerValue);
    return JSValue::encode(jsUndefined());
}

// (receiver, type, listener, options, standIn)
JSC_DEFINE_HOST_FUNCTION(jsFunctionNodeEventTargetRemoveListener, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    auto target = nodeEventTarget(vm, callFrame->argument(0), callFrame->argument(4).isTrue());
    if (target.isNull()) [[unlikely]]
        return Bun::ERR::INVALID_THIS(throwScope, globalObject, "NodeEventTarget"_s);

    JSValue listenerValue = callFrame->argument(2);
    if (!listenerValue.isObject()) {
        if (listenerValue.isUndefinedOrNull())
            return JSValue::encode(jsUndefined());
        return Bun::ERR::INVALID_ARG_INSTANCE(throwScope, globalObject, "listener"_s, "EventListener"_s, listenerValue);
    }

    auto type = convert<IDLAtomStringAdaptor<IDLDOMString>>(*globalObject, callFrame->argument(1));
    RETURN_IF_EXCEPTION(throwScope, {});
    JSValue optionsValue = callFrame->argument(3);
    auto options = optionsValue.isUndefined() ? false : convert<IDLUnion<IDLDictionary<EventListenerOptions>, IDLBoolean>>(*globalObject, optionsValue);
    RETURN_IF_EXCEPTION(throwScope, {});

    JSObject& wrapper = target;
    target.wrapped().removeEventListenerForBindings(type, JSEventListener::create(*asObject(listenerValue), wrapper, false, currentWorld(*globalObject)), WTF::move(options));
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

    // One removeEventListener() per listener: the target's own bookkeeping (the loop ref of a
    // MessagePort) then runs as it does for off().
    for (auto& type : types) {
        EventListenerVector listeners = impl.eventListeners(type);
        for (auto& registered : listeners) {
            if (matches(*registered, standIn))
                impl.removeEventListener(type, registered->callback(), registered->useCapture());
        }
    }
    return JSValue::encode(jsUndefined());
}

// (port, event, value): emit(). Returns whether the port had a listener for the event's type.
JSC_DEFINE_HOST_FUNCTION(jsFunctionNodeEventTargetEmit, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    auto target = nodeEventTarget(vm, callFrame->argument(0), false);
    if (target.isNull()) [[unlikely]]
        return Bun::ERR::INVALID_THIS(throwScope, globalObject, "NodeEventTarget"_s);

    auto* event = JSEvent::toWrapped(vm, callFrame->argument(1));
    if (!event) [[unlikely]]
        return Bun::ERR::INVALID_ARG_INSTANCE(throwScope, globalObject, "event"_s, "Event"_s, callFrame->argument(1));

    auto& impl = target.wrapped();
    bool hadListeners = !impl.eventListeners(event->type()).isEmpty();
    NodeStyleEventValue nodeValue(vm, *event, callFrame->argument(2));
    auto dispatched = impl.dispatchEventForBindings(*event);
    if (dispatched.hasException()) [[unlikely]] {
        propagateException(*globalObject, throwScope, dispatched.releaseException());
        return {};
    }
    return JSValue::encode(jsBoolean(hadListeners));
}

}
