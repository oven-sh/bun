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

#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/JSCJSValueInlines.h>
#include <JavaScriptCore/StackVisitor.h>
#include <JavaScriptCore/VM.h>
#include "ZigGeneratedClasses.h"
#include "ZigGlobalObject.h"

#include <JavaScriptCore/CallData.h>
#include <JavaScriptCore/DOMJITAbstractHeap.h>

extern "C" Zig::JSFFIFunction* Bun__CreateFFIFunctionWithData(Zig::GlobalObject* globalObject, const EncodedSlice* symbolName, unsigned argCount, Zig::FFIFunction functionPointer, void* data)
{
    auto& vm = JSC::getVM(globalObject);
    Zig::JSFFIFunction* function = Zig::JSFFIFunction::create(vm, globalObject, argCount, symbolName != nullptr ? Zig::toStringCopy(*symbolName) : String(), functionPointer, JSC::NoIntrinsic);
    function->dataPtr = data;
    return function;
}

extern "C" JSC::EncodedJSValue Bun__CreateFFIFunctionWithDataValue(Zig::GlobalObject* globalObject, const EncodedSlice* symbolName, unsigned argCount, Zig::FFIFunction functionPointer, void* data)
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

extern "C" JSC::EncodedJSValue Bun__CreateFFIFunctionValue(Zig::GlobalObject* globalObject, const EncodedSlice* symbolName, unsigned argCount, Zig::FFIFunction functionPointer, bool addPtrField, void* symbolFromDynamicLibrary)
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

// Returns true if one of the functions is on the stack. Then the caller must keep the compiled code.
extern "C" bool Bun__FFI__closeFunctions(Zig::GlobalObject* globalObject, JSC::EncodedJSValue libraryValue)
{
    auto* library = dynamicDowncast<WebCore::JSFFI>(JSC::JSValue::decode(libraryValue));
    if (!library)
        return false;
    JSC::JSValue functionsValue = library->m_functionsValue.get();
    auto* functions = functionsValue ? dynamicDowncast<JSC::JSArray>(functionsValue) : nullptr;
    if (!functions)
        return false;
    const unsigned length = functions->length();
    for (unsigned i = 0; i < length; ++i) {
        if (auto* function = dynamicDowncast<Zig::JSFFIFunction>(functions->getIndexQuickly(i)))
            function->close();
    }

    auto& vm = JSC::getVM(globalObject);
    bool isRunning = false;
    JSC::StackVisitor::visit(vm.topCallFrame, vm, [&](JSC::StackVisitor& visitor) -> WTF::IterationStatus {
        JSC::CalleeBits callee = visitor->callee();
        if (!callee.isCell() || !callee.asCell())
            return WTF::IterationStatus::Continue;
        JSC::JSValue calleeValue = callee.asCell();
        for (unsigned i = 0; i < length; ++i) {
            if (functions->getIndexQuickly(i) == calleeValue) {
                isRunning = true;
                return WTF::IterationStatus::Done;
            }
        }
        return WTF::IterationStatus::Continue;
    });

    library->m_functionsValue.clear();
    return isRunning;
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

// Every call reads m_function, so close() reaches all callers. On Windows x64 this is also the SYSV_ABI to MS ABI bridge.
JSC_DEFINE_HOST_FUNCTION(JSFFIFunction::trampoline, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    const auto* function = uncheckedDowncast<JSFFIFunction>(callFrame->jsCallee());
    return function->function()(globalObject, callFrame);
}

// Stands in for compiled code after close(), so it has the ABI of CFFIFunction, not of a host function.
static JSC::EncodedJSValue closedLibraryFunction(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* function = uncheckedDowncast<JSFFIFunction>(callFrame->jsCallee());
    return JSC::throwVMTypeError(globalObject, scope, makeString("bun:ffi: cannot call '"_s, function->name(vm), "' because its library was closed"_s));
}

void JSFFIFunction::close()
{
    m_function = closedLibraryFunction;
}

JSFFIFunction* JSFFIFunction::createForFFI(VM& vm, Zig::GlobalObject* globalObject, unsigned length, const String& name, CFFIFunction FFIFunction)
{
    NativeExecutable* executable = vm.getHostFunction(trampoline, ImplementationVisibility::Public, NoIntrinsic, trampoline, nullptr, length, name);
    Structure* structure = globalObject->FFIFunctionStructure();
    JSFFIFunction* function = new (NotNull, allocateCell<JSFFIFunction>(vm)) JSFFIFunction(vm, executable, globalObject, structure, reinterpret_cast<CFFIFunction>(WTF::move(FFIFunction)));
    function->finishCreation(vm);
    return function;
}

} // namespace JSC
