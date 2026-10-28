// The reads the console formatter (src/jsc/formatter/reader.rs) makes on its own account. They run no user code.

#include "root.h"

#include "BunClientData.h"
#include <JavaScriptCore/JSObjectInlines.h>
#include <JavaScriptCore/PropertySlot.h>

using namespace JSC;

// An own data property. ValueDeleted for an accessor, a Proxy or a module namespace export, empty when the lookup throws.
extern "C" [[ZIG_EXPORT(zero_is_throw)]] JSC::EncodedJSValue Bun__FormatterReads__ownData(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue encodedValue, uint8_t field)
{
    using ReactField = WebCore::BunBuiltinNames::ReactField;
    ASSERT(field < static_cast<uint8_t>(ReactField::Count_));
    const auto absent = JSValue::encode(JSValue::decode(JSValue::ValueDeleted));

    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSObject* object = JSValue::decode(encodedValue).getObject();
    if (!object)
        return absent;
    PropertyName name = WebCore::builtinNames(vm).reactFieldName(static_cast<ReactField>(field));
    PropertySlot slot(object, PropertySlot::InternalMethodType::VMInquiry, &vm);
    bool hasSlot = object->getOwnPropertySlotInline(globalObject, name, slot);
    RETURN_IF_EXCEPTION(scope, {});
    if (!hasSlot || !slot.isValue())
        return absent;
    JSValue value = slot.getValue(globalObject, name);
    return value ? JSValue::encode(value) : absent;
}
