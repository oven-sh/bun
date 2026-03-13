#include "V8Array.h"

#include "V8HandleScope.h"
#include "V8EscapableHandleScope.h"
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
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (length == 0) {
        JSArray* array = JSC::constructEmptyArray(globalObject, nullptr);
        RETURN_IF_EXCEPTION(scope, Local<Array>());
        return isolate->currentHandleScope()->createLocal<Array>(vm, array);
    }

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
    auto scope = DECLARE_THROW_SCOPE(vm);

    int realLength = length > 0 ? length : 0;
    JSArray* array = JSC::constructEmptyArray(globalObject, nullptr, static_cast<unsigned>(realLength));
    RETURN_IF_EXCEPTION(scope, Local<Array>());

    return isolate->currentHandleScope()->createLocal<Array>(vm, array);
}

// Array::New with callback
MaybeLocal<Array> Array::New(Local<Context> context, size_t length,
    std::function<MaybeLocal<v8::Value>()> next_value_callback)
{
    Isolate* isolate = context->GetIsolate();
    Zig::GlobalObject* globalObject = context->globalObject();
    auto& vm = isolate->vm();

    EscapableHandleScope handleScope(isolate);

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

    Local<Array> result = handleScope.createLocal<Array>(vm, array);
    return handleScope.Escape(result);
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
    if (!obj) {
        RELEASE_ASSERT_NOT_REACHED();
    }

    JSValue jsValue = obj->localToJSValue();
    if (!jsValue || !JSC::jsDynamicCast<JSArray*>(jsValue)) {
        RELEASE_ASSERT_NOT_REACHED();
    }
}

// Iterate implementation using manual iteration
Maybe<void> Array::Iterate(Local<Context> context, IterationCallback callback, void* callback_data)
{
    const JSArray* jsArray = localToObjectPointer<JSArray>();
    Zig::GlobalObject* globalObject = context->globalObject();
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    HandleScope handleScope(context->GetIsolate());

    // Manual iteration to support early exit
    for (unsigned index = 0; index < jsArray->length(); ++index) {
        JSValue element = jsArray->getIndex(globalObject, index);
        RETURN_IF_EXCEPTION(scope, Nothing<void>());

        Local<Value> localElement = handleScope.createLocal<Value>(vm, element);
        CallbackResult result = callback(index, localElement, callback_data);
        RETURN_IF_EXCEPTION(scope, Nothing<void>());

        switch (result) {
        case CallbackResult::kException:
            return Nothing<void>();
        case CallbackResult::kBreak:
            return JustVoid(); // Early exit without error
        case CallbackResult::kContinue:
            break;
        }
    }

    return JustVoid();
}

} // namespace v8
