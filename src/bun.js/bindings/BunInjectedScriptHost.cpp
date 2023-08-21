#include "root.h"
#include "BunInjectedScriptHost.h"

#include "ZigGeneratedClasses.h"
#include "DOMException.h"

#include "JSDOMException.h"
#include "JSEventListener.h"
#include "JSEventTarget.h"
#include "JSWorker.h"
#include "JavaScriptCore/ObjectConstructor.h"

#include "JSFetchHeaders.h"
#include "JSURLSearchParams.h"
#include "JSDOMFormData.h"
#include <JavaScriptCore/JSCallbackObject.h>
namespace Bun {

using namespace JSC;
using namespace WebCore;

JSValue BunInjectedScriptHost::subtype(JSGlobalObject* exec, JSValue value)
{
    VM& vm = exec->vm();

    if (
        value.inherits<JSDOMException>() || value.inherits<JSResolveMessage>() || value.inherits<JSBuildMessage>())
        return jsNontrivialString(vm, "error"_s);

    return jsUndefined();
}

static JSObject* constructInternalProperty(VM& vm, JSGlobalObject* exec, const String& name, JSValue value)
{
    auto* object = constructEmptyObject(exec);
    object->putDirect(vm, Identifier::fromString(vm, "name"_s), jsString(vm, name));
    object->putDirect(vm, Identifier::fromString(vm, "value"_s), value);
    return object;
}

static JSObject* constructInternalProperty(VM& vm, JSGlobalObject* exec, Identifier name, JSValue value)
{
    auto* object = constructEmptyObject(exec);
    object->putDirect(vm, Identifier::fromString(vm, "name"_s), JSC::identifierToJSValue(vm, name));
    object->putDirect(vm, Identifier::fromString(vm, "value"_s), value);
    return object;
}

static JSObject* objectForEventTargetListeners(VM& vm, JSGlobalObject* exec, EventTarget* eventTarget)
{
    auto* scriptExecutionContext = eventTarget->scriptExecutionContext();
    if (!scriptExecutionContext)
        return nullptr;

    JSObject* listeners = nullptr;

    for (auto& eventType : eventTarget->eventTypes()) {
        unsigned listenersForEventIndex = 0;
        auto* listenersForEvent = constructEmptyArray(exec, nullptr);

        for (auto& eventListener : eventTarget->eventListeners(eventType)) {
            if (!is<JSEventListener>(eventListener->callback()))
                continue;

            auto& jsListener = downcast<JSEventListener>(eventListener->callback());
            // if (jsListener.isolatedWorld() != &currentWorld(*exec))
            //     continue;

            auto* jsFunction = jsListener.ensureJSFunction(*scriptExecutionContext);
            if (!jsFunction)
                continue;

            auto* propertiesForListener = constructEmptyObject(exec);
            propertiesForListener->putDirect(vm, Identifier::fromString(vm, "callback"_s), jsFunction);
            propertiesForListener->putDirect(vm, Identifier::fromString(vm, "capture"_s), jsBoolean(eventListener->useCapture()));
            propertiesForListener->putDirect(vm, Identifier::fromString(vm, "passive"_s), jsBoolean(eventListener->isPassive()));
            propertiesForListener->putDirect(vm, Identifier::fromString(vm, "once"_s), jsBoolean(eventListener->isOnce()));
            listenersForEvent->putDirectIndex(exec, listenersForEventIndex++, propertiesForListener);
        }

        if (listenersForEventIndex) {
            if (!listeners)
                listeners = constructEmptyObject(exec);
            listeners->putDirect(vm, Identifier::fromString(vm, eventType), listenersForEvent);
        }
    }

    return listeners;
}

static JSValue constructDataProperties(VM& vm, JSGlobalObject* exec, JSArray* array, JSValue value)
{
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (!value.isObject())
        return value;

    auto* object = asObject(value);
    PropertyNameArray propertyNames(vm, PropertyNameMode::Strings, PrivateSymbolMode::Exclude);
    object->getPropertyNames(exec, propertyNames, DontEnumPropertiesMode::Exclude);
    RETURN_IF_EXCEPTION(scope, {});
    unsigned i = 0;

    for (auto& propertyName : propertyNames) {
        auto propertyValue = object->getDirect(vm, propertyName);

        array->putDirectIndex(exec, i++, constructInternalProperty(vm, exec, propertyName, propertyValue));
        RETURN_IF_EXCEPTION(scope, {});
    }

    RELEASE_AND_RETURN(scope, array);
}

static JSValue constructDataPropertiesSlow(VM& vm, JSGlobalObject* exec, JSArray* array, JSValue value)
{
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (!value.isObject())
        return value;

    auto* object = asObject(value);
    PropertyNameArray propertyNames(vm, PropertyNameMode::Strings, PrivateSymbolMode::Exclude);
    object->getPropertyNames(exec, propertyNames, DontEnumPropertiesMode::Exclude);
    RETURN_IF_EXCEPTION(scope, {});
    unsigned i = 0;
    auto catcher = DECLARE_CATCH_SCOPE(vm);

    for (auto& propertyName : propertyNames) {
        auto propertyValue = object->get(exec, propertyName);
        if (catcher.exception()) {
            catcher.clearException();
            propertyValue = jsUndefined();
        }

        array->putDirectIndex(exec, i++, constructInternalProperty(vm, exec, propertyName, propertyValue));
        RETURN_IF_EXCEPTION(scope, {});
    }

    RELEASE_AND_RETURN(scope, array);
}

JSValue BunInjectedScriptHost::getInternalProperties(VM& vm, JSGlobalObject* exec, JSC::JSValue value)
{
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (auto* worker = JSWorker::toWrapped(vm, value)) {
        unsigned index = 0;
        auto* array = constructEmptyArray(exec, nullptr);

        String name = worker->name();
        if (!name.isEmpty())
            array->putDirectIndex(exec, index++, constructInternalProperty(vm, exec, "name"_s, jsString(vm, WTFMove(name))));

        array->putDirectIndex(exec, index++, constructInternalProperty(vm, exec, "terminated"_s, jsBoolean(worker->wasTerminated())));

        if (auto* listeners = objectForEventTargetListeners(vm, exec, worker))
            array->putDirectIndex(exec, index++, constructInternalProperty(vm, exec, "listeners"_s, listeners));

        RETURN_IF_EXCEPTION(scope, {});
        return array;
    }

    if (value.isCell()) {
        JSC::JSCell* cell = value.asCell();
        JSC::JSType type = cell->type();

        if (type == JSDOMWrapperType) {
            if (auto* headers = jsDynamicCast<JSFetchHeaders*>(value)) {
                auto* array = constructEmptyArray(exec, nullptr);
                unsigned index = 0;
                // array->putDirectIndex(exec, index++, constructInternalProperty(vm, exec, "#inspect"_s, WebCore::getInternalProperties(vm, exec, headers)));
                constructDataProperties(vm, exec, array, WebCore::getInternalProperties(vm, exec, headers));
                RETURN_IF_EXCEPTION(scope, {});
                return array;
            }

            if (auto* params = jsDynamicCast<JSURLSearchParams*>(value)) {
                auto* array = constructEmptyArray(exec, nullptr);
                unsigned index = 0;
                // array->putDirectIndex(exec, index++, constructInternalProperty(vm, exec, "#inspect"_s, WebCore::getInternalProperties(vm, exec, params)));
                constructDataProperties(vm, exec, array, WebCore::getInternalProperties(vm, exec, params));
                RETURN_IF_EXCEPTION(scope, {});
                return array;
            }

            if (auto* formData = jsDynamicCast<JSDOMFormData*>(value)) {
                unsigned index = 0;
                auto* array = constructEmptyArray(exec, nullptr);
                // array->putDirectIndex(exec, index++, constructInternalProperty(vm, exec, "#inspect"_s, WebCore::getInternalProperties(vm, exec, formData)));
                constructDataProperties(vm, exec, array, WebCore::getInternalProperties(vm, exec, formData));
                RETURN_IF_EXCEPTION(scope, {});
                return array;
            }
        }
    }

    if (auto* eventTarget = JSEventTarget::toWrapped(vm, value)) {
        unsigned index = 0;
        auto* array = constructEmptyArray(exec, nullptr);

        if (auto* listeners = objectForEventTargetListeners(vm, exec, eventTarget))
            array->putDirectIndex(exec, index++, constructInternalProperty(vm, exec, "listeners"_s, listeners));

        RETURN_IF_EXCEPTION(scope, {});
        return array;
    }

    return {};
}

}