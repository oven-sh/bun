/*
 * Copyright (C) 2015-2021 Apple Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 * 1. Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY APPLE INC. ``AS IS'' AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL APPLE INC. OR
 * CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
 * EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
 * PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
 * PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY
 * OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

#include "root.h"
#include "JSFFIFunction.h"

#include "JavaScriptCore/JSCJSValueInlines.h"
#include "JavaScriptCore/VM.h"
#include "ZigGlobalObject.h"

#include <JavaScriptCore/DOMJITAbstractHeap.h>
#include "DOMJITIDLConvert.h"
#include "DOMJITIDLType.h"
#include "DOMJITIDLTypeFilter.h"
#include "DOMJITHelpers.h"

class FFICallbackFunctionWrapper {

    WTF_MAKE_FAST_ALLOCATED;

public:
    JSC::Strong<JSC::JSFunction> m_function;
    JSC::Strong<Zig::GlobalObject> globalObject;
    ~FFICallbackFunctionWrapper() = default;

    FFICallbackFunctionWrapper(JSC::JSFunction* function, Zig::GlobalObject* globalObject)
        : m_function(globalObject->vm(), function)
        , globalObject(globalObject->vm(), globalObject)
    {
    }
};
extern "C" void FFICallbackFunctionWrapper_destroy(FFICallbackFunctionWrapper* wrapper)
{
    delete wrapper;
}

extern "C" FFICallbackFunctionWrapper* Bun__createFFICallbackFunction(
    Zig::GlobalObject* globalObject,
    JSC::EncodedJSValue callbackFn)
{
    auto* vm = &globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(*vm);

    auto* callbackFunction = jsCast<JSC::JSFunction*>(JSC::JSValue::decode(callbackFn));

    auto* wrapper = new FFICallbackFunctionWrapper(callbackFunction, globalObject);

    return wrapper;
}

extern "C" Zig::JSFFIFunction* Bun__CreateFFIFunctionWithData(Zig::GlobalObject* globalObject, const ZigString* symbolName, unsigned argCount, Zig::FFIFunction functionPointer, bool strong, void* data)
{
    JSC::VM& vm = globalObject->vm();
    Zig::JSFFIFunction* function = Zig::JSFFIFunction::create(vm, globalObject, argCount, symbolName != nullptr ? Zig::toStringCopy(*symbolName) : String(), functionPointer, JSC::NoIntrinsic);
    if (strong)
        globalObject->trackFFIFunction(function);
    function->dataPtr = data;
    return function;
}

extern "C" JSC::EncodedJSValue Bun__CreateFFIFunctionWithDataValue(Zig::GlobalObject* globalObject, const ZigString* symbolName, unsigned argCount, Zig::FFIFunction functionPointer, bool strong, void* data)
{
    return JSC::JSValue::encode(Bun__CreateFFIFunctionWithData(globalObject, symbolName, argCount, functionPointer, strong, data));
}

extern "C" Zig::JSFFIFunction* Bun__CreateFFIFunction(Zig::GlobalObject* globalObject, const ZigString* symbolName, unsigned argCount, Zig::FFIFunction functionPointer, bool strong)
{
    return Bun__CreateFFIFunctionWithData(globalObject, symbolName, argCount, functionPointer, strong, nullptr);
}

extern "C" void* Bun__FFIFunction_getDataPtr(JSC::EncodedJSValue jsValue)
{

    Zig::JSFFIFunction* function = jsDynamicCast<Zig::JSFFIFunction*>(JSC::JSValue::decode(jsValue));
    if (!function)
        return nullptr;

    return function->dataPtr;
}

extern "C" void Bun__FFIFunction_setDataPtr(JSC::EncodedJSValue jsValue, void* ptr)
{

    Zig::JSFFIFunction* function = jsDynamicCast<Zig::JSFFIFunction*>(JSC::JSValue::decode(jsValue));
    if (!function)
        return;

    function->dataPtr = ptr;
}
extern "C" void Bun__untrackFFIFunction(Zig::GlobalObject* globalObject, JSC::EncodedJSValue function)
{
    globalObject->untrackFFIFunction(JSC::jsCast<JSC::JSFunction*>(JSC::JSValue::decode(function)));
}
extern "C" JSC::EncodedJSValue Bun__CreateFFIFunctionValue(Zig::GlobalObject* globalObject, const ZigString* symbolName, unsigned argCount, Zig::FFIFunction functionPointer, bool strong);
extern "C" JSC::EncodedJSValue Bun__CreateFFIFunctionValue(Zig::GlobalObject* globalObject, const ZigString* symbolName, unsigned argCount, Zig::FFIFunction functionPointer, bool strong)
{
    return JSC::JSValue::encode(JSC::JSValue(Bun__CreateFFIFunction(globalObject, symbolName, argCount, functionPointer, strong)));
}

namespace Zig {
using namespace JSC;

const ClassInfo JSFFIFunction::s_info = { "Function"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSFFIFunction) };

JSFFIFunction::JSFFIFunction(VM& vm, NativeExecutable* executable, JSGlobalObject* globalObject, Structure* structure, FFIFunction&& function)
    : Base(vm, executable, globalObject, structure)
    , m_function(WTFMove(function))
{
    // used in NAPI
    dataPtr = nullptr;
}

template<typename Visitor>
void JSFFIFunction::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    JSFFIFunction* thisObject = jsCast<JSFFIFunction*>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
}

DEFINE_VISIT_CHILDREN(JSFFIFunction);

void JSFFIFunction::finishCreation(VM& vm, NativeExecutable* executable, unsigned length, const String& name)
{
    Base::finishCreation(vm, executable, length, name);
    this->putDirect(vm, JSC::Identifier::fromString(vm, String(MAKE_STATIC_STRING_IMPL("ptr"))), jsNumber(bitwise_cast<double>(this->m_function)), JSC::PropertyAttribute::ReadOnly | 0);
    ASSERT(inherits(info()));
}

JSFFIFunction* JSFFIFunction::create(VM& vm, Zig::GlobalObject* globalObject, unsigned length, const String& name, FFIFunction FFIFunction, Intrinsic intrinsic, NativeFunction nativeConstructor)
{

    NativeExecutable* executable = vm.getHostFunction(FFIFunction, ImplementationVisibility::Public, intrinsic, FFIFunction, nullptr, name);

    Structure* structure = globalObject->FFIFunctionStructure();
    JSFFIFunction* function = new (NotNull, allocateCell<JSFFIFunction>(vm)) JSFFIFunction(vm, executable, globalObject, structure, WTFMove(FFIFunction));
    function->finishCreation(vm, executable, length, name);
    return function;
}

} // namespace JSC

extern "C" JSC::EncodedJSValue
FFI_Callback_call(FFICallbackFunctionWrapper& wrapper, size_t argCount, JSC::EncodedJSValue* args)
{
    auto* function = wrapper.m_function.get();
    auto* globalObject = wrapper.globalObject.get();
    auto& vm = globalObject->vm();
    JSC::MarkedArgumentBuffer arguments;
    for (size_t i = 0; i < argCount; ++i)
        arguments.appendWithCrashOnOverflow(JSC::JSValue::decode(args[i]));
    WTF::NakedPtr<JSC::Exception> exception;
    auto result = JSC::call(globalObject, function, JSC::getCallData(function), JSC::jsUndefined(), arguments, exception);
    if (UNLIKELY(exception)) {
        auto scope = DECLARE_THROW_SCOPE(vm);
        scope.throwException(globalObject, exception);
        return JSC::JSValue::encode(JSC::jsNull());
    }

    return JSC::JSValue::encode(result);
}

extern "C" void
FFI_Callback_threadsafe_call(FFICallbackFunctionWrapper& wrapper, size_t argCount, JSC::EncodedJSValue* args)
{

    auto* globalObject = wrapper.globalObject.get();
    WTF::Vector<JSC::EncodedJSValue, 8> argsVec;
    for (size_t i = 0; i < argCount; ++i)
        argsVec.append(args[i]);

    WebCore::ScriptExecutionContext::postTaskTo(globalObject->scriptExecutionContext()->identifier(), [argsVec = WTFMove(argsVec), wrapper](WebCore::ScriptExecutionContext& ctx) mutable {
        auto* globalObject = JSC::jsCast<Zig::GlobalObject*>(ctx.jsGlobalObject());
        auto& vm = globalObject->vm();
        JSC::MarkedArgumentBuffer arguments;
        auto* function = wrapper.m_function.get();
        for (size_t i = 0; i < argsVec.size(); ++i)
            arguments.appendWithCrashOnOverflow(JSC::JSValue::decode(argsVec[i]));
        WTF::NakedPtr<JSC::Exception> exception;
        JSC::call(globalObject, function, JSC::getCallData(function), JSC::jsUndefined(), arguments, exception);
        if (UNLIKELY(exception)) {
            auto scope = DECLARE_THROW_SCOPE(vm);
            scope.throwException(globalObject, exception);
            return;
        }
    });
}

extern "C" JSC::EncodedJSValue
FFI_Callback_call_0(FFICallbackFunctionWrapper& wrapper, size_t argCount, JSC::EncodedJSValue* args)
{
    auto* function = wrapper.m_function.get();
    auto* globalObject = wrapper.globalObject.get();
    auto& vm = globalObject->vm();

    JSC::MarkedArgumentBuffer arguments;

    WTF::NakedPtr<JSC::Exception> exception;
    auto result = JSC::call(globalObject, function, JSC::getCallData(function), JSC::jsUndefined(), arguments, exception);
    if (UNLIKELY(exception)) {
        auto scope = DECLARE_THROW_SCOPE(vm);
        scope.throwException(globalObject, exception);
        return JSC::JSValue::encode(JSC::jsNull());
    }

    return JSC::JSValue::encode(result);
}

extern "C" JSC::EncodedJSValue
FFI_Callback_call_1(FFICallbackFunctionWrapper& wrapper, size_t argCount, JSC::EncodedJSValue* args)
{
    auto* function = wrapper.m_function.get();
    auto* globalObject = wrapper.globalObject.get();
    auto& vm = globalObject->vm();

    JSC::MarkedArgumentBuffer arguments;
    arguments.append(JSC::JSValue::decode(args[0]));

    WTF::NakedPtr<JSC::Exception> exception;
    auto result = JSC::call(globalObject, function, JSC::getCallData(function), JSC::jsUndefined(), arguments, exception);
    if (UNLIKELY(exception)) {
        auto scope = DECLARE_THROW_SCOPE(vm);
        scope.throwException(globalObject, exception);
        return JSC::JSValue::encode(JSC::jsNull());
    }

    return JSC::JSValue::encode(result);
}

extern "C" JSC::EncodedJSValue
FFI_Callback_call_2(FFICallbackFunctionWrapper& wrapper, size_t argCount, JSC::EncodedJSValue* args)
{
    auto* function = wrapper.m_function.get();
    auto* globalObject = wrapper.globalObject.get();
    auto& vm = globalObject->vm();

    JSC::MarkedArgumentBuffer arguments;
    arguments.append(JSC::JSValue::decode(args[0]));
    arguments.append(JSC::JSValue::decode(args[1]));

    WTF::NakedPtr<JSC::Exception> exception;
    auto result = JSC::call(globalObject, function, JSC::getCallData(function), JSC::jsUndefined(), arguments, exception);
    if (UNLIKELY(exception)) {
        auto scope = DECLARE_THROW_SCOPE(vm);
        scope.throwException(globalObject, exception);
        return JSC::JSValue::encode(JSC::jsNull());
    }

    return JSC::JSValue::encode(result);
}

extern "C" JSC::EncodedJSValue FFI_Callback_call_3(FFICallbackFunctionWrapper& wrapper, size_t argCount, JSC::EncodedJSValue* args)
{
    auto* function = wrapper.m_function.get();
    auto* globalObject = wrapper.globalObject.get();
    auto& vm = globalObject->vm();

    JSC::MarkedArgumentBuffer arguments;
    arguments.append(JSC::JSValue::decode(args[0]));
    arguments.append(JSC::JSValue::decode(args[1]));
    arguments.append(JSC::JSValue::decode(args[2]));

    WTF::NakedPtr<JSC::Exception> exception;
    auto result = JSC::call(globalObject, function, JSC::getCallData(function), JSC::jsUndefined(), arguments, exception);
    if (UNLIKELY(exception)) {
        auto scope = DECLARE_THROW_SCOPE(vm);
        scope.throwException(globalObject, exception);
        return JSC::JSValue::encode(JSC::jsNull());
    }

    return JSC::JSValue::encode(result);
}

extern "C" JSC::EncodedJSValue FFI_Callback_call_4(FFICallbackFunctionWrapper& wrapper, size_t argCount, JSC::EncodedJSValue* args)
{
    auto* function = wrapper.m_function.get();
    auto* globalObject = wrapper.globalObject.get();
    auto& vm = globalObject->vm();

    JSC::MarkedArgumentBuffer arguments;
    arguments.append(JSC::JSValue::decode(args[0]));
    arguments.append(JSC::JSValue::decode(args[1]));
    arguments.append(JSC::JSValue::decode(args[2]));
    arguments.append(JSC::JSValue::decode(args[3]));

    WTF::NakedPtr<JSC::Exception> exception;
    auto result = JSC::call(globalObject, function, JSC::getCallData(function), JSC::jsUndefined(), arguments, exception);
    if (UNLIKELY(exception)) {
        auto scope = DECLARE_THROW_SCOPE(vm);
        scope.throwException(globalObject, exception);
        return JSC::JSValue::encode(JSC::jsNull());
    }

    return JSC::JSValue::encode(result);
}

extern "C" JSC::EncodedJSValue FFI_Callback_call_5(FFICallbackFunctionWrapper& wrapper, size_t argCount, JSC::EncodedJSValue* args)
{
    auto* function = wrapper.m_function.get();
    auto* globalObject = wrapper.globalObject.get();
    auto& vm = globalObject->vm();

    JSC::MarkedArgumentBuffer arguments;
    arguments.append(JSC::JSValue::decode(args[0]));
    arguments.append(JSC::JSValue::decode(args[1]));
    arguments.append(JSC::JSValue::decode(args[2]));
    arguments.append(JSC::JSValue::decode(args[3]));
    arguments.append(JSC::JSValue::decode(args[4]));

    WTF::NakedPtr<JSC::Exception> exception;
    auto result = JSC::call(globalObject, function, JSC::getCallData(function), JSC::jsUndefined(), arguments, exception);
    if (UNLIKELY(exception)) {
        auto scope = DECLARE_THROW_SCOPE(vm);
        scope.throwException(globalObject, exception);
        return JSC::JSValue::encode(JSC::jsNull());
    }

    return JSC::JSValue::encode(result);
}

extern "C" JSC::EncodedJSValue
FFI_Callback_call_6(FFICallbackFunctionWrapper& wrapper, size_t argCount, JSC::EncodedJSValue* args)
{
    auto* function = wrapper.m_function.get();
    auto* globalObject = wrapper.globalObject.get();
    auto& vm = globalObject->vm();

    JSC::MarkedArgumentBuffer arguments;
    arguments.append(JSC::JSValue::decode(args[0]));
    arguments.append(JSC::JSValue::decode(args[1]));
    arguments.append(JSC::JSValue::decode(args[2]));
    arguments.append(JSC::JSValue::decode(args[3]));
    arguments.append(JSC::JSValue::decode(args[4]));
    arguments.append(JSC::JSValue::decode(args[5]));

    WTF::NakedPtr<JSC::Exception> exception;
    auto result = JSC::call(globalObject, function, JSC::getCallData(function), JSC::jsUndefined(), arguments, exception);
    if (UNLIKELY(exception)) {
        auto scope = DECLARE_THROW_SCOPE(vm);
        scope.throwException(globalObject, exception);
        return JSC::JSValue::encode(JSC::jsNull());
    }

    return JSC::JSValue::encode(result);
}

extern "C" JSC::EncodedJSValue
FFI_Callback_call_7(FFICallbackFunctionWrapper& wrapper, size_t argCount, JSC::EncodedJSValue* args)
{
    auto* function = wrapper.m_function.get();
    auto* globalObject = wrapper.globalObject.get();
    auto& vm = globalObject->vm();

    JSC::MarkedArgumentBuffer arguments;
    arguments.append(JSC::JSValue::decode(args[0]));
    arguments.append(JSC::JSValue::decode(args[1]));
    arguments.append(JSC::JSValue::decode(args[2]));
    arguments.append(JSC::JSValue::decode(args[3]));
    arguments.append(JSC::JSValue::decode(args[4]));
    arguments.append(JSC::JSValue::decode(args[5]));
    arguments.append(JSC::JSValue::decode(args[6]));

    WTF::NakedPtr<JSC::Exception> exception;
    auto result = JSC::call(globalObject, function, JSC::getCallData(function), JSC::jsUndefined(), arguments, exception);
    if (UNLIKELY(exception)) {
        auto scope = DECLARE_THROW_SCOPE(vm);
        scope.throwException(globalObject, exception);
        return JSC::JSValue::encode(JSC::jsNull());
    }

    return JSC::JSValue::encode(result);
}
