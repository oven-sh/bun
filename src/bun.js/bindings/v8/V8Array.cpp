THIS SHOULD BE A LINTER ERROR#include "V8Array.h"

#include "V8HandleScope.h"
#include "V8Context.h"
#include "v8_compatibility_assertions.h"
#include "JavaScriptCore/JSArray.h"
#include "JavaScriptCore/ArrayConstructor.h"
#include "JavaScriptCore/ObjectConstructor.h"
#include "JavaScriptCore/JSCJSValue.h"
#include "JavaScriptCore/ThrowScope.h"
#include "JavaScriptCore/IteratorOperations.h"

ASSERT_V8_TYPE_LAYOUT_MATCHES(v8::Array)

using JSC::ArrayAllocationProfile;
using JSC::JSArray;
using JSC::JSValue;
using JSC::JSGlobalObject;

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
    
    // Create array with elements
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSArray* array = JSC::constructEmptyArray(globalObject, nullptr, static_cast<unsigned>(length));
    
    // Set each element
    for (size_t i = 0; i < length; i++) {
        JSValue elementValue = elements[i]->localToJSValue();
        array->putDirectIndex(globalObject, static_cast<unsigned>(i), elementValue);
        RETURN_IF_EXCEPTION(scope, Local<Array>());
    }
    
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
    JSArray* array = JSC::constructEmptyArray(globalObject, nullptr, static_cast<unsigned>(length));
    
    // Fill array using callback
    for (size_t i = 0; i < length; i++) {
        MaybeLocal<v8::Value> maybeValue = next_value_callback();
        Local<v8::Value> value;
        if (!maybeValue.ToLocal(&value)) {
            // Callback signaled error/exception
            return MaybeLocal<Array>();
        }
        
        JSValue elementValue = value->localToJSValue();
        array->putDirectIndex(globalObject, static_cast<unsigned>(i), elementValue);
        RETURN_IF_EXCEPTION(scope, MaybeLocal<Array>());
    }
    
    return isolate->currentHandleScope()->createLocal<Array>(vm, array);
}

// Get array length
uint32_t Array::Length() const
{
    JSArray* jsArray = localToObjectPointer<JSArray>();
    return static_cast<uint32_t>(jsArray->length());
}

// Cast implementation
void Array::CheckCast(Value* obj)
{
    // In debug builds, verify that the object is actually an array
    if (obj && obj->localToJSValue().isCell()) {
        JSC::JSCell* cell = obj->localToJSValue().asCell();
        if (!cell->inherits<JSArray>()) {
            // This would be a cast error in real V8
            RELEASE_ASSERT_NOT_REACHED();
        }
    }
}

// Iterate implementation using forEachInIterable
Maybe<void> Array::Iterate(Local<Context> context, IterationCallback callback, void* callback_data)
{
    JSArray* jsArray = localToObjectPointer<JSArray>();
    Zig::GlobalObject* globalObject = context->globalObject();
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    
    CallbackResult finalResult = CallbackResult::kContinue;
    uint32_t index = 0;
    
    // Use JSC's forEachInIterable for proper array iteration
    JSC::forEachInIterable(globalObject, jsArray, [&](JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue element) -> void {
        Local<Value> localElement = context->GetIsolate()->currentHandleScope()->createLocal<Value>(vm, element);
        
        CallbackResult result = callback(index++, localElement, callback_data);
        
        switch (result) {
            case CallbackResult::kException:
            case CallbackResult::kBreak:
                finalResult = result;
                return; // Break out of iteration
            case CallbackResult::kContinue:
                break;
        }
    });
    
    RETURN_IF_EXCEPTION(scope, Nothing<void>());
    
    // Check if we should return an exception or success
    if (finalResult == CallbackResult::kException) {
        return Nothing<void>();
    }
    
    Maybe<void> result;
    result.m_hasValue = true;
    return result;
}

} // namespace v8
