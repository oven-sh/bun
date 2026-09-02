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

// The loaders live on the target under a private name (invisible to user
// code), keyed by property name. A CustomGetterSetter carries no payload, so
// this is how one native getter serves every lazy property.
static JSObject* lazyPropertyLoaders(VM& vm, JSObject* target)
{
    JSValue loaders = target->getDirect(vm, WebCore::builtinNames(vm).lazyPropertyLoadersPrivateName());
    return loaders ? loaders.getObject() : nullptr;
}

JSC_DEFINE_CUSTOM_GETTER(lazyPropertyGetter, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName propertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    // For a CustomValue, JSC passes the object that owns the property, not the receiver.
    JSObject* thisObject = JSValue::decode(thisValue).getObject();
    if (!thisObject) [[unlikely]]
        return JSValue::encode(jsUndefined());

    JSObject* loaders = lazyPropertyLoaders(vm, thisObject);
    if (!loaders) [[unlikely]]
        return JSValue::encode(jsUndefined());

    JSValue loader = loaders->getDirect(vm, propertyName);
    if (!loader || !loader.isCallable()) [[unlikely]]
        return JSValue::encode(jsUndefined());

    MarkedArgumentBuffer args;
    args.append(identifierToJSValue(vm, Identifier::fromUid(vm, propertyName.uid())));
    JSValue value = call(globalObject, loader, getCallData(loader), jsUndefined(), args);
    RETURN_IF_EXCEPTION(scope, {});

    // Replace the getter with the value, as a data property with the same
    // attributes (a frozen target keeps ReadOnly | DontDelete, as V8's
    // ReconfigureDataProperty does). Skip if the loader redefined the
    // property itself.
    unsigned attributes = 0;
    PropertyOffset offset = thisObject->getDirectOffset(vm, propertyName, attributes);
    if (isValidOffset(offset) && (attributes & PropertyAttribute::CustomValue)) {
        thisObject->putDirect(vm, propertyName, value, attributesForStructure(attributes) & ~static_cast<unsigned>(PropertyAttribute::CustomValue));
    }

    return JSValue::encode(value);
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionDefineLazyProperties, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSObject* target = callFrame->argument(0).getObject();
    JSArray* keys = dynamicDowncast<JSArray>(callFrame->argument(1));
    JSValue loader = callFrame->argument(2);
    if (!target || !keys || !loader.isCallable()) [[unlikely]] {
        throwTypeError(globalObject, scope, "defineLazyProperties(target, keys, loader) expects an object, an array of property names and a function"_s);
        return {};
    }

    JSObject* loaders = lazyPropertyLoaders(vm, target);
    if (!loaders) {
        loaders = constructEmptyObject(vm, globalObject->nullPrototypeObjectStructure());
        target->putDirect(vm, WebCore::builtinNames(vm).lazyPropertyLoadersPrivateName(), loaders, 0);
    }

    auto* getterSetter = CustomGetterSetter::create(vm, lazyPropertyGetter, nullptr);
    unsigned length = keys->length();
    for (unsigned i = 0; i < length; i++) {
        JSValue keyValue = keys->getIndex(globalObject, i);
        RETURN_IF_EXCEPTION(scope, {});
        Identifier key = keyValue.toPropertyKey(globalObject);
        RETURN_IF_EXCEPTION(scope, {});

        // putDirectCustomAccessor only adds new properties.
        if (isValidOffset(target->getDirectOffset(vm, key)) || parseIndex(key)) [[unlikely]] {
            throwTypeError(globalObject, scope, makeString("defineLazyProperties: \""_s, key.string(), "\" is already defined on the target or is an index"_s));
            return {};
        }

        loaders->putDirect(vm, key, loader, 0);
        target->putDirectCustomAccessor(vm, key, getterSetter, PropertyAttribute::CustomValue | 0);
    }

    return JSValue::encode(jsUndefined());
}

} // namespace Bun
