/*
 * Copyright (C) 2016 Canon Inc.
 * Copyright (C) 2016-2021 Apple Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted, provided that the following conditions
 * are required to be met:
 *
 * 1.  Redistributions of source code must retain the above copyright
 *     notice, this list of conditions and the following disclaimer.
 * 2.  Redistributions in binary form must reproduce the above copyright
 *     notice, this list of conditions and the following disclaimer in the
 *     documentation and/or other materials provided with the distribution.
 * 3.  Neither the name of Canon Inc. nor the names of
 *     its contributors may be used to endorse or promote products derived
 *     from this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY CANON INC. AND ITS CONTRIBUTORS "AS IS" AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL CANON INC. AND ITS CONTRIBUTORS BE LIABLE FOR
 * ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
 * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
 * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
 * CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
 * OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

#include "config.h"
#include "ReadableStreamDefaultController.h"

#include "WebCoreJSClientData.h"
#include <JavaScriptCore/CatchScope.h>
#include <JavaScriptCore/HeapInlines.h>
#include <JavaScriptCore/IdentifierInlines.h>
#include <JavaScriptCore/JSObjectInlines.h>
#include <JavaScriptCore/JSCInlines.h>

namespace WebCore {

static bool invokeReadableStreamDefaultControllerFunction(JSC::JSGlobalObject& lexicalGlobalObject, const JSC::Identifier& identifier, const JSC::MarkedArgumentBuffer& arguments)
{
    JSC::VM& vm = lexicalGlobalObject.vm();
    JSC::JSLockHolder lock(vm);

    auto scope = DECLARE_CATCH_SCOPE(vm);
    auto function = lexicalGlobalObject.get(&lexicalGlobalObject, identifier);

    EXCEPTION_ASSERT(!scope.exception() || vm.hasPendingTerminationException());
    RETURN_IF_EXCEPTION(scope, false);

    ASSERT(function.isCallable());

    auto callData = JSC::getCallData(function);
    call(&lexicalGlobalObject, function, callData, JSC::jsUndefined(), arguments);
    EXCEPTION_ASSERT(!scope.exception() || vm.hasPendingTerminationException());
    return !scope.exception();
}

void ReadableStreamDefaultController::close()
{
    JSC::MarkedArgumentBuffer arguments;
    arguments.append(&jsController());

    auto* clientData = static_cast<JSVMClientData*>(globalObject().vm().clientData);
    auto& privateName = clientData->builtinFunctions().readableStreamInternalsBuiltins().readableStreamDefaultControllerClosePrivateName();

    invokeReadableStreamDefaultControllerFunction(globalObject(), privateName, arguments);
}

void ReadableStreamDefaultController::error(const Exception& exception)
{
    JSC::JSGlobalObject& lexicalGlobalObject = this->globalObject();
    auto& vm = lexicalGlobalObject.vm();
    JSC::JSLockHolder lock(vm);
    auto scope = DECLARE_CATCH_SCOPE(vm);
    auto value = createDOMException(&lexicalGlobalObject, exception.code(), exception.message());

    if (scope.exception()) [[unlikely]] {
        ASSERT(vm.hasPendingTerminationException());
        return;
    }

    JSC::MarkedArgumentBuffer arguments;
    arguments.append(&jsController());
    arguments.append(value);

    auto* clientData = static_cast<JSVMClientData*>(vm.clientData);
    auto& privateName = clientData->builtinFunctions().readableStreamInternalsBuiltins().readableStreamDefaultControllerErrorPrivateName();

    invokeReadableStreamDefaultControllerFunction(globalObject(), privateName, arguments);
}

void ReadableStreamDefaultController::error(JSC::JSValue error)
{
    JSC::JSGlobalObject& lexicalGlobalObject = this->globalObject();
    auto& vm = lexicalGlobalObject.vm();
    JSC::JSLockHolder lock(vm);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto value = JSC::Exception::create(vm, error);

    if (scope.exception()) [[unlikely]] {
        ASSERT(vm.hasPendingTerminationException());
        return;
    }

    JSC::MarkedArgumentBuffer arguments;
    arguments.append(&jsController());
    arguments.append(value);

    auto* clientData = static_cast<JSVMClientData*>(vm.clientData);
    auto& privateName = clientData->builtinFunctions().readableStreamInternalsBuiltins().readableStreamDefaultControllerErrorPrivateName();

    invokeReadableStreamDefaultControllerFunction(globalObject(), privateName, arguments);
}

bool ReadableStreamDefaultController::enqueue(JSC::JSValue value)
{
    JSC::JSGlobalObject& lexicalGlobalObject = this->globalObject();
    auto& vm = lexicalGlobalObject.vm();
    JSC::JSLockHolder lock(vm);

    JSC::MarkedArgumentBuffer arguments;
    arguments.append(&jsController());
    arguments.append(value);

    auto* clientData = static_cast<JSVMClientData*>(lexicalGlobalObject.vm().clientData);
    auto& privateName = clientData->builtinFunctions().readableStreamInternalsBuiltins().readableStreamDefaultControllerEnqueuePrivateName();

    return invokeReadableStreamDefaultControllerFunction(globalObject(), privateName, arguments);
}

bool ReadableStreamDefaultController::enqueue(RefPtr<JSC::ArrayBuffer>&& buffer)
{
    if (!buffer) {
        error(Exception { OutOfMemoryError });
        return false;
    }

    JSC::JSGlobalObject& lexicalGlobalObject = this->globalObject();
    auto& vm = lexicalGlobalObject.vm();
    JSC::JSLockHolder lock(vm);
    auto scope = DECLARE_CATCH_SCOPE(vm);
    auto length = buffer->byteLength();
    auto value = JSC::JSUint8Array::create(&lexicalGlobalObject, lexicalGlobalObject.typedArrayStructureWithTypedArrayType<JSC::TypeUint8>(), WTFMove(buffer), 0, length);

    EXCEPTION_ASSERT(!scope.exception() || vm.hasPendingTerminationException());
    RETURN_IF_EXCEPTION(scope, false);

    return enqueue(value);
}

} // namespace WebCore
