// Reads for the console formatter (src/jsc/formatter/reader.rs) that run no user code.

#include "root.h"

#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/JSObjectInlines.h>
#include <JavaScriptCore/MathCommon.h>
#include <JavaScriptCore/PropertySlot.h>

using namespace JSC;

extern "C" uint64_t Bun__JSObject__endOfPresentIndexes(JSC::EncodedJSValue);

// The length of an array, or the own data `length` of an arguments object. Without one: one past the last present index.
extern "C" [[ZIG_EXPORT(nothrow)]] uint64_t Bun__FormatterReads__arrayLength(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue encodedValue)
{
    JSObject* object = JSValue::decode(encodedValue).getObject();
    if (!object)
        return 0;

    switch (object->type()) {
    case ArrayType:
    case DerivedArrayType:
        return uncheckedDowncast<JSArray>(object)->length();
    case DirectArgumentsType:
    case ScopedArgumentsType:
    case ClonedArgumentsType: {
        VM& vm = getVM(globalObject);
        auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
        PropertySlot slot(object, PropertySlot::InternalMethodType::VMInquiry, &vm);
        bool hasSlot = object->methodTable()->getOwnPropertySlot(object, globalObject, vm.propertyNames->length, slot);
        scope.assertNoExceptionExceptTermination();
        if (hasSlot && slot.isValue()) {
            JSValue length = slot.getValue(globalObject, vm.propertyNames->length);
            if (length.isNumber()) {
                double number = length.asNumber();
                return number > 0 ? static_cast<uint64_t>(std::min(number, maxSafeInteger())) : 0;
            }
        }
        break;
    }
    default:
        break;
    }

    return Bun__JSObject__endOfPresentIndexes(encodedValue);
}
