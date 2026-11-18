// What src/dom/api/events needs of JavaScriptCore.
#include "root.h"

#include "Bindgen/JSGlobalStandIn.h"
#include "Bindgen/JSInterface.h"
#include "BunClientData.h"
#include "DesktopRealm.h"
#include "EventTarget.h"
#include "JSErrorEvent.h"
#include "JSEvent.h"
#include "JSEventTarget.h"
#include "JSMessagePort.h"
#include "RemovableFeatures.h"
#include <JavaScriptCore/JSBoundFunction.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/JSGlobalProxy.h>
#include <JavaScriptCore/ProxyObject.h>

using namespace JSC;

namespace WebCore {
JSC_DECLARE_HOST_FUNCTION(jsEventTargetPrototypeFunction_addEventListener);
JSC_DECLARE_HOST_FUNCTION(jsEventTargetPrototypeFunction_removeEventListener);
JSC_DECLARE_HOST_FUNCTION(jsEventTargetPrototypeFunction_dispatchEvent);
}

extern "C" bool Bun__DOM__isEvent(EncodedJSValue);
extern "C" void Bun__DOM__cancelEvent(EncodedJSValue);

extern "C" EncodedJSValue Bun__DOM__targetBehind(JSGlobalObject* globalObject, EncodedJSValue object)
{
    return JSValue::encode(Bun::Bindgen::existingReceiverOf(globalObject, JSValue::decode(object)));
}

extern "C" JSGlobalObject* Bun__DOM__realmOfWindow(EncodedJSValue window)
{
    JSObject* object = asObject(JSValue::decode(window));
    return object->type() == GlobalProxyType ? uncheckedDowncast<JSGlobalProxy>(object)->target() : object->structure()->realm();
}

extern "C" void Bun__DOM__putBehind(EncodedJSValue window, EncodedJSValue target)
{
    JSObject* object = asObject(JSValue::decode(window));
    Bun::Bindgen::setReceiverOf(object->vm(), object, asObject(JSValue::decode(target)));
}

extern "C" EncodedJSValue Bun__DOM__targetOfRealmOfCallback(JSGlobalObject* globalObject, EncodedJSValue callback)
{
    JSObject* object = JSValue::decode(callback).getObject();
    while (object) {
        if (auto* bound = dynamicDowncast<JSBoundFunction>(object))
            object = bound->targetFunction();
        else if (auto* proxy = dynamicDowncast<ProxyObject>(object); proxy && !proxy->isRevoked())
            object = proxy->target();
        else
            break;
    }
    auto* realm = object ? object->structure()->realm() : nullptr;
    return realm ? Bun__DOM__targetBehind(globalObject, JSValue::encode(realm)) : JSValue::encode(JSValue());
}

namespace Bun {

JSC_DECLARE_HOST_FUNCTION(jsDesktopAddEventListenerToOther);
JSC_DEFINE_HOST_FUNCTION(jsDesktopAddEventListenerToOther, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    return WebCore::jsEventTargetPrototypeFunction_addEventListener(globalObject, callFrame);
}

JSC_DECLARE_HOST_FUNCTION(jsDesktopRemoveEventListenerFromOther);
JSC_DEFINE_HOST_FUNCTION(jsDesktopRemoveEventListenerFromOther, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    return WebCore::jsEventTargetPrototypeFunction_removeEventListener(globalObject, callFrame);
}

JSC_DECLARE_HOST_FUNCTION(jsDesktopDispatchEventToOther);
JSC_DEFINE_HOST_FUNCTION(jsDesktopDispatchEventToOther, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    return WebCore::jsEventTargetPrototypeFunction_dispatchEvent(globalObject, callFrame);
}

static JSObject* constructLike(JSGlobalObject* globalObject, JSValue constructor, JSObject* event)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    MarkedArgumentBuffer arguments;
    arguments.append(event->get(globalObject, vm.propertyNames->type));
    RETURN_IF_EXCEPTION(scope, nullptr);
    arguments.append(event);
    RELEASE_AND_RETURN(scope, construct(globalObject, constructor, getConstructData(constructor), arguments));
}

// The listeners get an event of WebCore that looks the same.
JSValue desktopRealmDispatch(JSGlobalObject* globalObject, WebCore::EventTarget& target, JSValue value)
{
    if (isFeatureRemoved(Feature::Desktop))
        return {};
    BUN_BEGIN_REMOVABLE_ENTRY_POINT(Desktop, Abort, JSValue)
    if (!Bun__DOM__isEvent(JSValue::encode(value)))
        return {};
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSObject* event = asObject(value);
    JSObject* twin = constructLike(globalObject, WebCore::JSEvent::getConstructor(vm, globalObject), event);
    RETURN_IF_EXCEPTION(scope, {});
    JSValue end = asObject(Bindgen::interfaceObjectNamed(event->structure()->realm(), *Identifier::fromString(vm, "Event"_s).impl()))->getDirect(vm, vm.propertyNames->prototype);
    for (JSValue from = event; from.isObject() && from != end; from = asObject(from)->getPrototypeDirect()) {
        PropertyNameArrayBuilder names(vm, PropertyNameMode::Strings, PrivateSymbolMode::Exclude);
        asObject(from)->methodTable()->getOwnPropertyNames(asObject(from), globalObject, names, DontEnumPropertiesMode::Include);
        RETURN_IF_EXCEPTION(scope, {});
        for (const auto& name : names) {
            bool isThere = twin->hasProperty(globalObject, name);
            RETURN_IF_EXCEPTION(scope, {});
            if (isThere)
                continue;
            JSValue member = event->get(globalObject, name);
            RETURN_IF_EXCEPTION(scope, {});
            twin->putDirectMayBeIndex(globalObject, name, member);
            RETURN_IF_EXCEPTION(scope, {});
        }
    }
    Ref wrapped = uncheckedDowncast<WebCore::JSEvent>(twin)->wrapped();
    bool proceeds = target.dispatchEventForBindings(wrapped).releaseReturnValue();
    if (!proceeds)
        Bun__DOM__cancelEvent(JSValue::encode(event));
    return jsBoolean(proceeds);
    BUN_END_REMOVABLE_ENTRY_POINT
}

extern "C" void Bun__DOM__dispatchToSignal(JSGlobalObject* globalObject, EncodedJSValue signal, EncodedJSValue event)
{
    desktopRealmDispatch(globalObject, uncheckedDowncast<WebCore::JSEventTarget>(JSValue::decode(signal))->wrapped(), JSValue::decode(event));
}

// An event of WebCore gets the members that depend on the dispatch from its twin. Undefined for any other value.
extern "C" bool Bun__DOM__isPortOfRuntime(EncodedJSValue value)
{
    return JSValue::decode(value).inherits<WebCore::JSMessagePort>();
}

extern "C" EncodedJSValue Bun__DOM__twinOfNativeEvent(JSGlobalObject* globalObject, EncodedJSValue value, EncodedJSValue eventClass, EncodedJSValue errorEventClass)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* event = dynamicDowncast<WebCore::JSEvent>(JSValue::decode(value));
    if (!event)
        return JSValue::encode(jsUndefined());
    auto& key = WebCore::builtinNames(vm).implPrivateName();
    if (JSValue known = event->getDirect(vm, key))
        return JSValue::encode(known);
    JSObject* twin = constructLike(globalObject, JSValue::decode(event->inherits<WebCore::JSErrorEvent>() ? errorEventClass : eventClass), event);
    RETURN_IF_EXCEPTION(scope, {});
    event->putDirect(vm, key, twin);
    JSObject* members = asObject(asObject(JSValue::decode(eventClass))->getDirect(vm, vm.propertyNames->prototype));
    PropertyNameArrayBuilder names(vm, PropertyNameMode::Strings, PrivateSymbolMode::Exclude);
    members->methodTable()->getOwnPropertyNames(members, globalObject, names, DontEnumPropertiesMode::Exclude);
    RETURN_IF_EXCEPTION(scope, {});
    for (const auto& name : names) {
        auto bind = [&](JSValue it) -> JSValue {
            return it.isCallable() && !scope.exception() ? JSBoundFunction::create(vm, globalObject, asObject(it), twin, ArgList(), 0, jsString(vm, name.string()), SourceTaintedOrigin::Untainted) : it;
        };
        if (name == vm.propertyNames->type || name == "initEvent"_s)
            continue;
        PropertyDescriptor member;
        bool isThere = members->getOwnPropertyDescriptor(globalObject, name, member);
        RETURN_IF_EXCEPTION(scope, {});
        if (!isThere)
            continue;
        if (member.isAccessorDescriptor()) {
            JSValue getter = bind(member.getter());
            JSValue setter = bind(member.setter());
            RETURN_IF_EXCEPTION(scope, {});
            member.setGetter(getter);
            member.setSetter(setter);
        } else {
            JSValue bound = bind(member.value());
            RETURN_IF_EXCEPTION(scope, {});
            member.setValue(bound);
        }
        event->methodTable()->defineOwnProperty(event, globalObject, name, member, false);
        RETURN_IF_EXCEPTION(scope, {});
    }
    return JSValue::encode(twin);
}

}
