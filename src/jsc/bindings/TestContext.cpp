#include "root.h"

#include <JavaScriptCore/ErrorInstance.h>
#include <JavaScriptCore/ExceptionHelpers.h>
#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/Symbol.h>

// What src/runtime/test_runner/test_context.rs needs from JavaScriptCore.

// The own data at `index`, also of an array that is frozen or sparse. A hole or an accessor is undefined: no getter runs.
static JSC::JSValue ownElementOrUndefined(JSC::JSGlobalObject* globalObject, JSC::JSArray* array, unsigned index)
{
    if (array->canGetIndexQuickly(index))
        return array->getIndexQuickly(index);
    JSC::PropertySlot slot(array, JSC::PropertySlot::InternalMethodType::VMInquiry, &JSC::getVM(globalObject));
    if (JSC::JSObject::getOwnPropertySlotByIndex(array, globalObject, index, slot) && slot.isValue())
        return slot.getValue(globalObject, index);
    return JSC::jsUndefined();
}

// `task.result.errors` if it is an array, also one that a hook assigned. An accessor is a GetterSetter here, so no getter runs.
static JSC::JSArray* errorsOfResult(JSC::VM& vm, JSC::JSObject* result)
{
    JSC::JSValue errors = result->getDirect(vm, vm.propertyNames->errors);
    return errors ? dynamicDowncast<JSC::JSArray>(errors) : nullptr;
}

// Vitest's `result.errors ??= []`.
static JSC::JSArray* ensureErrorsOfResult(JSC::JSGlobalObject* globalObject, JSC::JSObject* result)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (auto* errors = errorsOfResult(vm, result))
        return errors;
    auto* errors = JSC::constructEmptyArray(globalObject, nullptr);
    RETURN_IF_EXCEPTION(scope, nullptr);
    result->putDirect(vm, vm.propertyNames->errors, errors);
    return errors;
}

// Vitest's `processError` keeps an object, and gives any other value as `{ message: String(value) }`. The entry is defined, not set, so no setter runs.
static void addToErrorsOfTest(JSC::JSGlobalObject* globalObject, JSC::JSObject* result, JSC::JSValue value)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (!value.isObject()) {
        JSC::JSString* message;
        if (value.isSymbol()) {
            auto description = asSymbol(value)->tryGetDescriptiveString();
            if (!description) [[unlikely]] {
                throwOutOfMemoryError(globalObject, scope);
                return;
            }
            message = jsString(vm, *description);
        } else {
            message = value.toString(globalObject);
            RETURN_IF_EXCEPTION(scope, );
        }
        auto* entry = JSC::constructEmptyObject(globalObject);
        entry->putDirect(vm, vm.propertyNames->message, message);
        value = entry;
    }
    auto* errors = ensureErrorsOfResult(globalObject, result);
    RETURN_IF_EXCEPTION(scope, );
    scope.release();
    errors->putDirectIndex(globalObject, errors->length(), value, 0, JSC::PutDirectIndexShouldThrow);
}

// An AggregateError adds each member of its `errors`, and not itself.
static void addErrorOrItsMembersToErrorsOfTest(JSC::JSGlobalObject* globalObject, JSC::JSObject* result, JSC::JSValue value)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* error = dynamicDowncast<JSC::ErrorInstance>(value);
    // An `errors` that the test made an accessor is a GetterSetter here, which is no array.
    JSC::JSValue members = error && error->errorType() == JSC::ErrorType::AggregateError ? error->getDirect(vm, vm.propertyNames->errors) : JSC::JSValue();
    auto* array = members ? dynamicDowncast<JSC::JSArray>(members) : nullptr;
    if (!array)
        RELEASE_AND_RETURN(scope, addToErrorsOfTest(globalObject, result, value));
    // An AggregateError without members leaves an empty array, as in Vitest.
    ensureErrorsOfResult(globalObject, result);
    RETURN_IF_EXCEPTION(scope, );
    // `array` can be `task.result.errors`, so its length is read once.
    for (unsigned index = 0, length = array->length(); index < length; index++) {
        addToErrorsOfTest(globalObject, result, ownElementOrUndefined(globalObject, array, index));
        RETURN_IF_EXCEPTION(scope, );
    }
}

// Vitest's `failTask`: a thrown array adds each of its elements to `task.result.errors`. Only own data is read, so no code of the test runs.
extern "C" [[ZIG_EXPORT(check_slow)]] void Bun__TestContext__recordError(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue encodedResult, JSC::EncodedJSValue encodedThrown)
{
    auto scope = DECLARE_THROW_SCOPE(JSC::getVM(globalObject));
    auto* result = JSC::JSValue::decode(encodedResult).getObject();
    JSC::JSValue thrown = JSC::JSValue::decode(encodedThrown);
    auto* array = dynamicDowncast<JSC::JSArray>(thrown);
    if (!array)
        RELEASE_AND_RETURN(scope, addErrorOrItsMembersToErrorsOfTest(globalObject, result, thrown));
    // `array` can be `task.result.errors`, so its length is read once.
    for (unsigned index = 0, length = array->length(); index < length; index++) {
        addErrorOrItsMembersToErrorsOfTest(globalObject, result, ownElementOrUndefined(globalObject, array, index));
        RETURN_IF_EXCEPTION(scope, );
    }
}

// Empty if `task.result.errors` is no array.
extern "C" [[ZIG_EXPORT(nothrow)]] JSC::EncodedJSValue Bun__TestContext__errorsOfResult(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue encodedResult)
{
    auto* errors = errorsOfResult(JSC::getVM(globalObject), JSC::JSValue::decode(encodedResult).getObject());
    return errors ? JSC::JSValue::encode(errors) : JSC::EncodedJSValue {};
}
