#include "root.h"
#include "DefineLazyProperties.h"
#include "BunClientData.h"

#include <JavaScriptCore/CallData.h>
#include <JavaScriptCore/CustomGetterSetter.h>
#include <JavaScriptCore/IdentifierInlines.h>
#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/JSCJSValueInlines.h>
#include <JavaScriptCore/JSObjectInlines.h>
#include <JavaScriptCore/ObjectConstructor.h>

namespace Bun {

using namespace JSC;

// Lazy properties and their ESM bindings (ModuleLoader.cpp) both read the values object, which calls each loader once.

JSObject* lazyPropertyValues(VM& vm, JSObject* target)
{
    JSValue values = target->getDirect(vm, WebCore::builtinNames(vm).lazyPropertyValuesPrivateName());
    return values ? values.getObject() : nullptr;
}

// The other attributes stay, so a frozen object stays ReadOnly, as with V8's ReconfigureDataProperty.
static void materialize(VM& vm, JSObject* object, PropertyName name, JSValue value, GetValueFunc getter)
{
    unsigned attributes = 0;
    PropertyOffset offset = object->getDirectOffset(vm, name, attributes);
    if (!isValidOffset(offset) || !(attributes & PropertyAttribute::CustomValue))
        return;
    if (uncheckedDowncast<CustomGetterSetter>(object->getDirect(offset))->getter() != getter)
        return;
    object->putDirect(vm, name, value, attributesForStructure(attributes) & ~static_cast<unsigned>(PropertyAttribute::CustomValue));
}

JSC_DEFINE_CUSTOM_GETTER(lazyValueGetter, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName propertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    // For a CustomValue, JSC passes the object that owns the property, not the receiver.
    JSObject* values = JSValue::decode(thisValue).getObject();
    if (!values) [[unlikely]]
        return JSValue::encode(jsUndefined());

    JSValue loaders = values->getDirect(vm, WebCore::builtinNames(vm).lazyPropertyLoadersPrivateName());
    JSValue loader = loaders && loaders.isObject() ? asObject(loaders)->getDirect(vm, propertyName) : JSValue();
    if (!loader || !loader.isCallable()) [[unlikely]]
        return JSValue::encode(jsUndefined());

    MarkedArgumentBuffer args;
    args.append(identifierToJSValue(vm, Identifier::fromUid(vm, propertyName.uid())));
    JSValue value = call(globalObject, loader, getCallData(loader), jsUndefined(), args);
    RETURN_IF_EXCEPTION(scope, {});

    materialize(vm, values, propertyName, value, lazyValueGetter);
    return JSValue::encode(value);
}

JSC_DEFINE_CUSTOM_GETTER(lazyPropertyGetter, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName propertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSObject* target = JSValue::decode(thisValue).getObject();
    JSObject* values = target ? lazyPropertyValues(vm, target) : nullptr;
    if (!values) [[unlikely]]
        return JSValue::encode(jsUndefined());

    JSValue value = values->get(globalObject, propertyName);
    RETURN_IF_EXCEPTION(scope, {});

    materialize(vm, target, propertyName, value, lazyPropertyGetter);
    return JSValue::encode(value);
}

bool isPendingLazyProperty(const PropertySlot& slot)
{
    return slot.isCustom() && (slot.attributes() & PropertyAttribute::CustomValue) && slot.customGetter() == GetValueFunc(lazyPropertyGetter);
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionDefineLazyProperties, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto& builtinNames = WebCore::builtinNames(vm);

    JSObject* target = callFrame->argument(0).getObject();
    JSArray* keys = dynamicDowncast<JSArray>(callFrame->argument(1));
    JSValue loader = callFrame->argument(2);
    if (!target || !keys || !loader.isCallable()) [[unlikely]] {
        throwTypeError(globalObject, scope, "defineLazyProperties(target, keys, loader) expects an object, an array of property names and a function"_s);
        return {};
    }

    JSObject* values = lazyPropertyValues(vm, target);
    if (!values) {
        values = constructEmptyObject(vm, globalObject->nullPrototypeObjectStructure());
        JSObject* loaders = constructEmptyObject(vm, globalObject->nullPrototypeObjectStructure());
        values->putDirect(vm, builtinNames.lazyPropertyLoadersPrivateName(), loaders, 0);
        target->putDirect(vm, builtinNames.lazyPropertyValuesPrivateName(), values, 0);
    }
    JSObject* loaders = asObject(values->getDirect(vm, builtinNames.lazyPropertyLoadersPrivateName()));

    auto* valueGetter = CustomGetterSetter::create(vm, lazyValueGetter, nullptr);
    auto* propertyGetter = CustomGetterSetter::create(vm, lazyPropertyGetter, nullptr);
    unsigned length = keys->length();
    for (unsigned i = 0; i < length; i++) {
        JSValue keyValue = keys->getIndex(globalObject, i);
        RETURN_IF_EXCEPTION(scope, {});
        Identifier key = keyValue.toPropertyKey(globalObject);
        RETURN_IF_EXCEPTION(scope, {});

        // putDirectCustomAccessor only adds new properties.
        if (isValidOffset(target->getDirectOffset(vm, key)) || isValidOffset(values->getDirectOffset(vm, key)) || parseIndex(key)) [[unlikely]] {
            throwTypeError(globalObject, scope, makeString("defineLazyProperties: \""_s, key.string(), "\" is already defined on the target or is an index"_s));
            return {};
        }

        loaders->putDirect(vm, key, loader, 0);
        values->putDirectCustomAccessor(vm, key, valueGetter, PropertyAttribute::CustomValue | 0);
        target->putDirectCustomAccessor(vm, key, propertyGetter, PropertyAttribute::CustomValue | 0);
    }

    return JSValue::encode(jsUndefined());
}

} // namespace Bun
