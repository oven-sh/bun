#include "V8Array.h"

#include "V8HandleScope.h"
#include "V8Context.h"
#include "v8_compatibility_assertions.h"
#include "JavaScriptCore/JSArray.h"
#include "JavaScriptCore/ArrayConstructor.h"
#include "JavaScriptCore/ObjectConstructor.h"
#include "JavaScriptCore/JSCJSValue.h"
#include "JavaScriptCore/ThrowScope.h"
#include "JavaScriptCore/IteratorOperations.h"
#include "JavaScriptCore/ArgList.h"

ASSERT_V8_TYPE_LAYOUT_MATCHES(v8::Array)

using JSC::ArrayAllocationProfile;
using JSC::JSArray;
using JSC::JSGlobalObject;
using JSC::JSValue;
using JSC::MarkedArgumentBuffer;

namespace v8 {

// Array::New with elements and length
Local<Array> Array::New(Isolate* isolate, Local<Value>* elements, size_t length)
{
    Zig::GlobalObject* globalObject = isolate->globalObject();
    auto& vm = isolate->vm();

    if (length == 0) {
        JSArray* array = JSC::constructEmptyArray(globalObject, nullptr);
        return isolate->currentHandleScope()->createLocal<Array>(vm, array);
    }

    // Use MarkedArgumentsBuffer as suggested
    auto scope = DECLARE_THROW_SCOPE(vm);
    MarkedArgumentBuffer args;

    // Add each element to the arguments buffer
    for (size_t i = 0; i < length; i++) {
        JSValue elementValue = elements[i]->localToJSValue();
        args.append(elementValue);
    }

    // Construct array using the buffer
    JSArray* array = JSC::constructArray(globalObject, static_cast<ArrayAllocationProfile*>(nullptr), args);
    RETURN_IF_EXCEPTION(scope, Local<Array>());

    return isolate->currentHandleScope()->createLocal<Array>(vm, array);
}

// Array::New with just length
Local<Array> Array::New(Isolate* isolate, int length)
{
    Zig::GlobalObject* globalObject = isolate->globalObject();
    auto& vm = isolate->vm();

    int realLength = length > 0 ? length : 0;
    JSArray* array = JSC::constructEmptyArray(globalObject, nullptr, static_cast<unsigned>(realLength));

    return isolate->currentHandleScope()->createLocal<Array>(vm, array);
}

// Array::New with callback
MaybeLocal<Array> Array::New(Local<Context> context, size_t length,
    std::function<MaybeLocal<v8::Value>()> next_value_callback)
{
    Isolate* isolate = context->GetIsolate();
    Zig::GlobalObject* globalObject = context->globalObject();
    auto& vm = isolate->vm();

    auto scope = DECLARE_THROW_SCOPE(vm);
    MarkedArgumentBuffer args;

    // Fill array using callback
    for (size_t i = 0; i < length; i++) {
        MaybeLocal<v8::Value> maybeValue = next_value_callback();
        Local<v8::Value> value;
        if (!maybeValue.ToLocal(&value)) {
            // Callback signaled error/exception
            return MaybeLocal<Array>();
        }

        JSValue elementValue = value->localToJSValue();
        args.append(elementValue);
    }

    // Construct array using the buffer
    JSArray* array = JSC::constructArray(globalObject, static_cast<ArrayAllocationProfile*>(nullptr), args);
    RETURN_IF_EXCEPTION(scope, MaybeLocal<Array>());

    return isolate->currentHandleScope()->createLocal<Array>(vm, array);
}

// Get array length
uint32_t Array::Length() const
{
    const JSArray* jsArray = localToObjectPointer<JSArray>();
    return static_cast<uint32_t>(jsArray->length());
}

// Cast implementation
void Array::CheckCast(Value* obj)
{
    // Verify that the object is actually an array
    if (obj && obj->localToJSValue().isCell()) {
        JSC::JSCell* cell = obj->localToJSValue().asCell();
        if (!cell->inherits<JSArray>()) {
            // This would be a cast error in real V8
            RELEASE_ASSERT_NOT_REACHED();
        }
    }
}

// Iterate implementation using manual iteration
Maybe<bool> Array::Iterate(Local<Context> context, IterationCallback callback, void* callback_data)
{
    const JSArray* jsArray = localToObjectPointer<JSArray>();
    Zig::GlobalObject* globalObject = context->globalObject();
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    // Manual iteration to support early exit
    for (unsigned index = 0; index < jsArray->length(); ++index) {
        JSValue element = jsArray->getIndex(globalObject, index);
        RETURN_IF_EXCEPTION(scope, Nothing<bool>());

        Local<Value> localElement = context->GetIsolate()->currentHandleScope()->createLocal<Value>(vm, element);
        CallbackResult result = callback(index, localElement, callback_data);

        switch (result) {
        case CallbackResult::kException:
            return Nothing<bool>();
        case CallbackResult::kBreak:
            return Just(true); // Early exit without error
        case CallbackResult::kContinue:
            break;
        }
    }

    return Just(true);
}

} // namespace v8
