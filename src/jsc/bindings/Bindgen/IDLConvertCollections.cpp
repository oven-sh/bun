#include "root.h"
#include "Bindgen/IDLConvertCollections.h"
#include "JSDOMConvertStrings.h"
#include <JavaScriptCore/IteratorOperations.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/PropertyNameArray.h>

namespace Bun::Bindgen {
using namespace JSC;

bool Roots::add(JSGlobalObject& globalObject, JSValue value)
{
    if (!value.isCell())
        return true;
    m_values.append(value);
    if (m_values.hasOverflowed()) [[unlikely]]
        return Detail::throwOutOfMemory(globalObject);
    return true;
}

JSValue iteratorMethod(JSGlobalObject& globalObject, JSObject* object)
{
    if (getIterationMode(object) == IterationMode::FastArray) [[likely]]
        return object->realm()->arrayProtoValuesFunction();
    auto scope = DECLARE_THROW_SCOPE(getVM(&globalObject));
    JSValue method = JSC::iteratorMethod(&globalObject, object);
    RETURN_IF_EXCEPTION(scope, {});
    return method;
}

namespace Detail {

bool throwOutOfMemory(JSGlobalObject& globalObject)
{
    auto scope = DECLARE_THROW_SCOPE(getVM(&globalObject));
    throwOutOfMemoryError(&globalObject, scope);
    return false;
}

unsigned initialCapacityFor(JSObject* iterable)
{
    return isJSArray(iterable) ? std::min(asArray(iterable)->length(), 1024u) : 0;
}

bool forEachElement(JSGlobalObject& globalObject, JSObject* iterable, JSValue iteratorMethod, const ScopedLambda<bool(JSValue)>& callback)
{
    auto scope = DECLARE_THROW_SCOPE(getVM(&globalObject));
    forEachInIterable(globalObject, iterable, iteratorMethod, [&](VM&, JSGlobalObject&, JSValue element) {
        callback(element);
    });
    RETURN_IF_EXCEPTION(scope, false);
    return true;
}

bool forEachRecordEntry(JSGlobalObject& globalObject, JSObject* object, const ScopedLambda<bool(const String& key, JSValue)>& callback)
{
    VM& vm = getVM(&globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    // DontEnumPropertiesMode::Exclude would ask a proxy for each descriptor twice.
    PropertyNameArrayBuilder keys(vm, PropertyNameMode::StringsAndSymbols, PrivateSymbolMode::Exclude);
    object->methodTable()->getOwnPropertyNames(object, &globalObject, keys, DontEnumPropertiesMode::Include);
    RETURN_IF_EXCEPTION(scope, false);
    for (auto& key : keys) {
        PropertySlot slot(object, PropertySlot::InternalMethodType::GetOwnProperty);
        bool hasProperty = object->methodTable()->getOwnPropertySlot(object, &globalObject, key, slot);
        RETURN_IF_EXCEPTION(scope, false);
        if (!hasProperty || (slot.attributes() & PropertyAttribute::DontEnum))
            continue;
        String string = WebCore::identifierToString(globalObject, key);
        RETURN_IF_EXCEPTION(scope, false);
        JSValue value = slot.isTaintedByOpaqueObject() ? object->get(&globalObject, key) : slot.getValue(&globalObject, key);
        RETURN_IF_EXCEPTION(scope, false);
        if (hasException(scope, callback(string, value))) [[unlikely]]
            return false;
    }
    return true;
}

}

}
