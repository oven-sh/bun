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

#include <JavaScriptCore/JSCJSValueInlines.h>
#include <JavaScriptCore/VM.h>
#include "ZigGlobalObject.h"

#include <JavaScriptCore/CallData.h>
#include <JavaScriptCore/DOMJITAbstractHeap.h>
#include "DOMJITIDLConvert.h"
#include "DOMJITIDLType.h"
#include "DOMJITIDLTypeFilter.h"
#include "DOMJITHelpers.h"

// Refcounted so FFI_Callback_threadsafe_call can keep the wrapper alive from a
// foreign thread; copying the JSC::Strong members is only safe on the JS thread.
class FFICallbackFunctionWrapper : public ThreadSafeRefCounted<FFICallbackFunctionWrapper> {

    WTF_DEPRECATED_MAKE_FAST_ALLOCATED(FFICallbackFunctionWrapper);

public:
    JSC::Strong<JSC::JSFunction> m_function;
    JSC::Strong<Zig::GlobalObject> globalObject;
    // Cached on the JS thread at construction time so the foreign-thread
    // trampoline never has to dereference a Strong to find the context.
    WebCore::ScriptExecutionContextIdentifier m_contextId;
    ~FFICallbackFunctionWrapper() = default;

    FFICallbackFunctionWrapper(JSC::JSFunction* function, Zig::GlobalObject* globalObject)
        : m_function(globalObject->vm(), function)
        , globalObject(globalObject->vm(), globalObject)
        , m_contextId(globalObject->scriptExecutionContext()->identifier())
    {
    }
};
extern "C" void FFICallbackFunctionWrapper_destroy(FFICallbackFunctionWrapper* wrapper)
{
    // deref, not delete: pending event-loop tasks may still hold refs.
    wrapper->deref();
}

extern "C" FFICallbackFunctionWrapper* Bun__createFFICallbackFunction(
    Zig::GlobalObject* globalObject,
    JSC::EncodedJSValue callbackFn)
{
    auto* vm = &globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(*vm);

    auto* callbackFunction = uncheckedDowncast<JSC::JSFunction>(JSC::JSValue::decode(callbackFn));

    auto* wrapper = new FFICallbackFunctionWrapper(callbackFunction, globalObject);

    return wrapper;
}

extern "C" Zig::JSFFIFunction* Bun__CreateFFIFunctionWithData(Zig::GlobalObject* globalObject, const ZigString* symbolName, unsigned argCount, Zig::FFIFunction functionPointer, void* data)
{
    auto& vm = JSC::getVM(globalObject);
    Zig::JSFFIFunction* function = Zig::JSFFIFunction::create(vm, globalObject, argCount, symbolName != nullptr ? Zig::toStringCopy(*symbolName) : String(), functionPointer, JSC::NoIntrinsic);
    function->dataPtr = data;
    return function;
}

extern "C" JSC::EncodedJSValue Bun__CreateFFIFunctionWithDataValue(Zig::GlobalObject* globalObject, const ZigString* symbolName, unsigned argCount, Zig::FFIFunction functionPointer, void* data)
{
    return JSC::JSValue::encode(Bun__CreateFFIFunctionWithData(globalObject, symbolName, argCount, functionPointer, data));
}

extern "C" void* Bun__FFIFunction_getDataPtr(JSC::EncodedJSValue jsValue)
{

    Zig::JSFFIFunction* function = dynamicDowncast<Zig::JSFFIFunction>(JSC::JSValue::decode(jsValue));
    if (!function)
        return nullptr;

    return function->dataPtr;
}

extern "C" void Bun__FFIFunction_setDataPtr(JSC::EncodedJSValue jsValue, void* ptr)
{

    Zig::JSFFIFunction* function = dynamicDowncast<Zig::JSFFIFunction>(JSC::JSValue::decode(jsValue));
    if (!function)
        return;

    function->dataPtr = ptr;
}

extern "C" JSC::EncodedJSValue Bun__CreateFFIFunctionValue(Zig::GlobalObject* globalObject, const ZigString* symbolName, unsigned argCount, Zig::FFIFunction functionPointer, bool addPtrField, void* symbolFromDynamicLibrary)
{
    if (addPtrField) {
        auto* function = Zig::JSFFIFunction::createForFFI(globalObject->vm(), globalObject, argCount, symbolName != nullptr ? Zig::toStringCopy(*symbolName) : String(), reinterpret_cast<Bun::CFFIFunction>(functionPointer));
        auto& vm = JSC::getVM(globalObject);
        // We should only expose the "ptr" field when it's a JSCallback for bun:ffi.
        // Not for internal usages of this function type.
        // We should also consider a separate JSFunction type for our usage to not have this branch in the first place...
        function->putDirect(vm, JSC::Identifier::fromString(vm, String("ptr"_s)), JSC::jsNumber(std::bit_cast<double>(functionPointer)), JSC::PropertyAttribute::ReadOnly | 0);
        function->symbolFromDynamicLibrary = symbolFromDynamicLibrary;
        return JSC::JSValue::encode(function);
    }

    return Bun__CreateFFIFunctionWithDataValue(globalObject, symbolName, argCount, functionPointer, nullptr);
}

namespace Zig {
using namespace JSC;

const ClassInfo JSFFIFunction::s_info = { "Function"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSFFIFunction) };

JSFFIFunction::JSFFIFunction(VM& vm, NativeExecutable* executable, JSGlobalObject* globalObject, Structure* structure, CFFIFunction&& function)
    : Base(vm, executable, globalObject, structure)
    , m_function(WTF::move(function))
{
    // used in NAPI
    dataPtr = nullptr;
}

template<typename Visitor>
void JSFFIFunction::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    JSFFIFunction* thisObject = uncheckedDowncast<JSFFIFunction>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
}

DEFINE_VISIT_CHILDREN(JSFFIFunction);

JSFFIFunction* JSFFIFunction::create(VM& vm, Zig::GlobalObject* globalObject, unsigned length, const String& name, FFIFunction FFIFunction, Intrinsic intrinsic, NativeFunction nativeConstructor)
{
    NativeExecutable* executable = vm.getHostFunction(FFIFunction, ImplementationVisibility::Public, intrinsic, FFIFunction, nullptr, length, name);
    Structure* structure = globalObject->FFIFunctionStructure();
    JSFFIFunction* function = new (NotNull, allocateCell<JSFFIFunction>(vm)) JSFFIFunction(vm, executable, globalObject, structure, reinterpret_cast<CFFIFunction>(WTF::move(FFIFunction)));
    function->finishCreation(vm);
    return function;
}

#if OS(WINDOWS)

JSC_DEFINE_HOST_FUNCTION(JSFFIFunction::trampoline, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    const auto* function = uncheckedDowncast<JSFFIFunction>(callFrame->jsCallee());
    return function->function()(globalObject, callFrame);
}

#endif

JSFFIFunction* JSFFIFunction::createForFFI(VM& vm, Zig::GlobalObject* globalObject, unsigned length, const String& name, CFFIFunction FFIFunction)
{
#if OS(WINDOWS)
    NativeExecutable* executable = vm.getHostFunction(trampoline, ImplementationVisibility::Public, NoIntrinsic, trampoline, nullptr, length, name);
#else
    NativeExecutable* executable = vm.getHostFunction(FFIFunction, ImplementationVisibility::Public, NoIntrinsic, FFIFunction, nullptr, length, name);
#endif
    Structure* structure = globalObject->FFIFunctionStructure();
    JSFFIFunction* function = new (NotNull, allocateCell<JSFFIFunction>(vm)) JSFFIFunction(vm, executable, globalObject, structure, reinterpret_cast<CFFIFunction>(WTF::move(FFIFunction)));
    function->finishCreation(vm);
    return function;
}

} // namespace JSC

// Shared tail for the FFI_Callback_* entry points: call back into JS and leave any exception
// pending on the VM, like any other host function. Never clear and re-throw here: re-installing
// the TerminationException once the termination request is retired trips VM::setException.
static JSC::EncodedJSValue invokeFFICallback(Zig::GlobalObject* globalObject, JSC::JSFunction* function, JSC::MarkedArgumentBuffer& arguments)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto result = JSC::profiledCall(globalObject, JSC::ProfilingReason::API, function, JSC::getCallData(function), JSC::jsUndefined(), arguments);
    RETURN_IF_EXCEPTION(scope, JSC::JSValue::encode(JSC::jsNull()));
    return JSC::JSValue::encode(result);
}

extern "C" JSC::EncodedJSValue
FFI_Callback_call(FFICallbackFunctionWrapper& wrapper, size_t argCount, JSC::EncodedJSValue* args)
{
    JSC::MarkedArgumentBuffer arguments;
    for (size_t i = 0; i < argCount; ++i)
        arguments.appendWithCrashOnOverflow(JSC::JSValue::decode(args[i]));
    return invokeFFICallback(wrapper.globalObject.get(), wrapper.m_function.get(), arguments);
}

extern "C" void
FFI_Callback_threadsafe_call(FFICallbackFunctionWrapper& wrapper, size_t argCount, JSC::EncodedJSValue* args)
{
    // Runs on a foreign thread: do not touch the wrapper's JSC::Strong members here.
    WTF::Vector<JSC::EncodedJSValue, 8> argsVec;
    for (size_t i = 0; i < argCount; ++i)
        argsVec.append(args[i]);

    // Ref only once the context is found live (inside the map lock) and release via
    // adoptRef in the task, so the last deref — destroying two JSC::Strong members —
    // can only happen on the JS thread. On a dead/terminating context nothing is destroyed here.
    WebCore::ScriptExecutionContext::postTaskTo(wrapper.m_contextId, [&wrapper] { wrapper.ref(); }, [argsVec = WTF::move(argsVec), wrapper = &wrapper](WebCore::ScriptExecutionContext& ctx) mutable {
        auto protectedWrapper = adoptRef(*wrapper);
        auto* globalObject = uncheckedDowncast<Zig::GlobalObject>(ctx.jsGlobalObject());
        JSC::MarkedArgumentBuffer arguments;
        for (size_t i = 0; i < argsVec.size(); ++i)
            arguments.appendWithCrashOnOverflow(JSC::JSValue::decode(argsVec[i]));
        invokeFFICallback(globalObject, protectedWrapper->m_function.get(), arguments); });
}

extern "C" JSC::EncodedJSValue
FFI_Callback_call_0(FFICallbackFunctionWrapper& wrapper, size_t argCount, JSC::EncodedJSValue* args)
{
    JSC::MarkedArgumentBuffer arguments;
    return invokeFFICallback(wrapper.globalObject.get(), wrapper.m_function.get(), arguments);
}

extern "C" JSC::EncodedJSValue
FFI_Callback_call_1(FFICallbackFunctionWrapper& wrapper, size_t argCount, JSC::EncodedJSValue* args)
{
    JSC::MarkedArgumentBuffer arguments;
    arguments.append(JSC::JSValue::decode(args[0]));
    return invokeFFICallback(wrapper.globalObject.get(), wrapper.m_function.get(), arguments);
}

extern "C" JSC::EncodedJSValue
FFI_Callback_call_2(FFICallbackFunctionWrapper& wrapper, size_t argCount, JSC::EncodedJSValue* args)
{
    JSC::MarkedArgumentBuffer arguments;
    arguments.append(JSC::JSValue::decode(args[0]));
    arguments.append(JSC::JSValue::decode(args[1]));
    return invokeFFICallback(wrapper.globalObject.get(), wrapper.m_function.get(), arguments);
}

extern "C" JSC::EncodedJSValue FFI_Callback_call_3(FFICallbackFunctionWrapper& wrapper, size_t argCount, JSC::EncodedJSValue* args)
{
    JSC::MarkedArgumentBuffer arguments;
    arguments.append(JSC::JSValue::decode(args[0]));
    arguments.append(JSC::JSValue::decode(args[1]));
    arguments.append(JSC::JSValue::decode(args[2]));
    return invokeFFICallback(wrapper.globalObject.get(), wrapper.m_function.get(), arguments);
}

extern "C" JSC::EncodedJSValue FFI_Callback_call_4(FFICallbackFunctionWrapper& wrapper, size_t argCount, JSC::EncodedJSValue* args)
{
    JSC::MarkedArgumentBuffer arguments;
    arguments.append(JSC::JSValue::decode(args[0]));
    arguments.append(JSC::JSValue::decode(args[1]));
    arguments.append(JSC::JSValue::decode(args[2]));
    arguments.append(JSC::JSValue::decode(args[3]));
    return invokeFFICallback(wrapper.globalObject.get(), wrapper.m_function.get(), arguments);
}

extern "C" JSC::EncodedJSValue FFI_Callback_call_5(FFICallbackFunctionWrapper& wrapper, size_t argCount, JSC::EncodedJSValue* args)
{
    JSC::MarkedArgumentBuffer arguments;
    arguments.append(JSC::JSValue::decode(args[0]));
    arguments.append(JSC::JSValue::decode(args[1]));
    arguments.append(JSC::JSValue::decode(args[2]));
    arguments.append(JSC::JSValue::decode(args[3]));
    arguments.append(JSC::JSValue::decode(args[4]));
    return invokeFFICallback(wrapper.globalObject.get(), wrapper.m_function.get(), arguments);
}

extern "C" JSC::EncodedJSValue
FFI_Callback_call_6(FFICallbackFunctionWrapper& wrapper, size_t argCount, JSC::EncodedJSValue* args)
{
    JSC::MarkedArgumentBuffer arguments;
    arguments.append(JSC::JSValue::decode(args[0]));
    arguments.append(JSC::JSValue::decode(args[1]));
    arguments.append(JSC::JSValue::decode(args[2]));
    arguments.append(JSC::JSValue::decode(args[3]));
    arguments.append(JSC::JSValue::decode(args[4]));
    arguments.append(JSC::JSValue::decode(args[5]));
    return invokeFFICallback(wrapper.globalObject.get(), wrapper.m_function.get(), arguments);
}

extern "C" JSC::EncodedJSValue
FFI_Callback_call_7(FFICallbackFunctionWrapper& wrapper, size_t argCount, JSC::EncodedJSValue* args)
{
    JSC::MarkedArgumentBuffer arguments;
    arguments.append(JSC::JSValue::decode(args[0]));
    arguments.append(JSC::JSValue::decode(args[1]));
    arguments.append(JSC::JSValue::decode(args[2]));
    arguments.append(JSC::JSValue::decode(args[3]));
    arguments.append(JSC::JSValue::decode(args[4]));
    arguments.append(JSC::JSValue::decode(args[5]));
    arguments.append(JSC::JSValue::decode(args[6]));
    return invokeFFICallback(wrapper.globalObject.get(), wrapper.m_function.get(), arguments);
}
