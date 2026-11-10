#include "root.h"

#include <JavaScriptCore/ErrorInstance.h>
#include <JavaScriptCore/ExceptionHelpers.h>
#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/Symbol.h>

// What src/runtime/test_runner/test_context.rs needs from JavaScriptCore.

// A hole is undefined, as it is for the iteration in Vitest. No getter runs.
static JSC::JSValue ownElementOrUndefined(JSC::JSArray* array, unsigned index)
{
    return array->canGetIndexQuickly(index) ? array->getIndexQuickly(index) : JSC::jsUndefined();
}

// Vitest's `processError` keeps an object, and gives any other value as `{ message: String(value) }`. The entry is defined, not set, so no setter runs.
static void addToErrorsOfTest(JSC::JSGlobalObject* globalObject, JSC::JSArray* errors, JSC::JSValue value)
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
    scope.release();
    errors->putDirectIndex(globalObject, errors->length(), value, 0, JSC::PutDirectIndexShouldThrow);
}

// An AggregateError adds each member of its `errors`, and not itself.
static void addErrorOrItsMembersToErrorsOfTest(JSC::JSGlobalObject* globalObject, JSC::JSArray* errors, JSC::JSValue value)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* error = dynamicDowncast<JSC::ErrorInstance>(value);
    // An `errors` that the test made an accessor is a GetterSetter here, which is no array.
    JSC::JSValue members = error && error->errorType() == JSC::ErrorType::AggregateError ? error->getDirect(vm, vm.propertyNames->errors) : JSC::JSValue();
    auto* array = members ? dynamicDowncast<JSC::JSArray>(members) : nullptr;
    if (!array)
        RELEASE_AND_RETURN(scope, addToErrorsOfTest(globalObject, errors, value));
    // `array` can be `errors`, so its length is read once.
    for (unsigned index = 0, length = array->length(); index < length; index++) {
        addToErrorsOfTest(globalObject, errors, ownElementOrUndefined(array, index));
        RETURN_IF_EXCEPTION(scope, );
    }
}

// Vitest's `failTask`: what a thrown value adds to `task.result.errors`. A thrown array adds each of its elements.
// Only own data is read, so none of the test's code runs here.
extern "C" [[ZIG_EXPORT(check_slow)]] void Bun__TestContext__recordError(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue encodedErrors, JSC::EncodedJSValue encodedThrown)
{
    auto scope = DECLARE_THROW_SCOPE(JSC::getVM(globalObject));
    auto* errors = uncheckedDowncast<JSC::JSArray>(JSC::JSValue::decode(encodedErrors));
    JSC::JSValue thrown = JSC::JSValue::decode(encodedThrown);
    auto* array = dynamicDowncast<JSC::JSArray>(thrown);
    if (!array)
        RELEASE_AND_RETURN(scope, addErrorOrItsMembersToErrorsOfTest(globalObject, errors, thrown));
    // `array` can be `errors`, so its length is read once.
    for (unsigned index = 0, length = array->length(); index < length; index++) {
        addErrorOrItsMembersToErrorsOfTest(globalObject, errors, ownElementOrUndefined(array, index));
        RETURN_IF_EXCEPTION(scope, );
    }
}
