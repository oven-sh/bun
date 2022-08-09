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

extern "C" Zig::JSFFIFunction* Bun__CreateFFIFunction(Zig::GlobalObject* globalObject, const ZigString* symbolName, unsigned argCount, Zig::FFIFunction functionPointer)
{
    JSC::VM& vm = globalObject->vm();
    Zig::JSFFIFunction* function = Zig::JSFFIFunction::create(vm, globalObject, argCount, symbolName != nullptr ? Zig::toStringCopy(*symbolName) : String(), functionPointer, JSC::NoIntrinsic);
    return function;
}
extern "C" JSC::EncodedJSValue Bun__CreateFFIFunctionValue(Zig::GlobalObject* globalObject, const ZigString* symbolName, unsigned argCount, Zig::FFIFunction functionPointer);
extern "C" JSC::EncodedJSValue Bun__CreateFFIFunctionValue(Zig::GlobalObject* globalObject, const ZigString* symbolName, unsigned argCount, Zig::FFIFunction functionPointer)
{
    return JSC::JSValue::encode(JSC::JSValue(Bun__CreateFFIFunction(globalObject, symbolName, argCount, functionPointer)));
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

    NativeExecutable* executable = vm.getHostFunction(FFIFunction, intrinsic, FFIFunction, nullptr, name);

    Structure* structure = globalObject->FFIFunctionStructure();
    JSFFIFunction* function = new (NotNull, allocateCell<JSFFIFunction>(vm)) JSFFIFunction(vm, executable, globalObject, structure, WTFMove(FFIFunction));
    function->finishCreation(vm, executable, length, name);
    return function;
}

} // namespace JSC
