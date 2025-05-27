/*
 * Copyright (C) 2020-2021 Apple Inc. All rights reserved.
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
 * THIS SOFTWARE IS PROVIDED BY CANON INC. ``AS IS'' AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL CANON INC. OR
 * CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
 * EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
 * PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
 * PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY
 * OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

#include "config.h"
#include "InternalWritableStream.h"

#include "Exception.h"
#include "WebCoreJSClientData.h"

namespace WebCore {

static ExceptionOr<JSC::JSValue> invokeWritableStreamFunction(JSC::JSGlobalObject& globalObject, const JSC::Identifier& identifier, const JSC::MarkedArgumentBuffer& arguments)
{
    JSC::VM& vm = globalObject.vm();
    JSC::JSLockHolder lock(vm);

    auto scope = DECLARE_CATCH_SCOPE(vm);

    auto function = globalObject.get(&globalObject, identifier);
    ASSERT(function.isCallable());
    scope.assertNoExceptionExceptTermination();

    auto callData = JSC::getCallData(function);

    auto result = call(&globalObject, function, callData, JSC::jsUndefined(), arguments);
    RETURN_IF_EXCEPTION(scope, Exception { ExistingExceptionError });

    return result;
}

ExceptionOr<Ref<InternalWritableStream>> InternalWritableStream::createFromUnderlyingSink(JSDOMGlobalObject& globalObject, JSC::JSValue underlyingSink, JSC::JSValue strategy)
{
    auto* clientData = static_cast<JSVMClientData*>(globalObject.vm().clientData);
    auto& privateName = clientData->builtinFunctions().writableStreamInternalsBuiltins().createInternalWritableStreamFromUnderlyingSinkPrivateName();

    JSC::MarkedArgumentBuffer arguments;
    arguments.append(underlyingSink);
    arguments.append(strategy);
    ASSERT(!arguments.hasOverflowed());

    auto result = invokeWritableStreamFunction(globalObject, privateName, arguments);
    if (result.hasException()) [[unlikely]]
        return result.releaseException();

    ASSERT(result.returnValue().isObject());
    return adoptRef(*new InternalWritableStream(globalObject, *result.returnValue().toObject(&globalObject)));
}

Ref<InternalWritableStream> InternalWritableStream::fromObject(JSDOMGlobalObject& globalObject, JSC::JSObject& object)
{
    return adoptRef(*new InternalWritableStream(globalObject, object));
}

bool InternalWritableStream::locked() const
{
    auto* globalObject = this->globalObject();
    if (!globalObject)
        return false;

    auto scope = DECLARE_CATCH_SCOPE(globalObject->vm());

    auto* clientData = static_cast<JSVMClientData*>(globalObject->vm().clientData);
    auto& privateName = clientData->builtinFunctions().writableStreamInternalsBuiltins().isWritableStreamLockedPrivateName();

    JSC::MarkedArgumentBuffer arguments;
    arguments.append(guardedObject());
    ASSERT(!arguments.hasOverflowed());

    auto result = invokeWritableStreamFunction(*globalObject, privateName, arguments);
    if (scope.exception())
        scope.clearException();

    return result.hasException() ? false : result.returnValue().isTrue();
}

void InternalWritableStream::lock()
{
    auto* globalObject = this->globalObject();
    if (!globalObject)
        return;

    auto scope = DECLARE_CATCH_SCOPE(globalObject->vm());

    auto* clientData = static_cast<JSVMClientData*>(globalObject->vm().clientData);
    auto& privateName = clientData->builtinFunctions().writableStreamInternalsBuiltins().acquireWritableStreamDefaultWriterPrivateName();

    JSC::MarkedArgumentBuffer arguments;
    arguments.append(guardedObject());
    ASSERT(!arguments.hasOverflowed());

    auto result = invokeWritableStreamFunction(*globalObject, privateName, arguments);
    if (scope.exception()) [[unlikely]]
        scope.clearException();
}

JSC::JSValue InternalWritableStream::abort(JSC::JSGlobalObject& globalObject, JSC::JSValue reason)
{
    auto* clientData = static_cast<JSVMClientData*>(globalObject.vm().clientData);
    auto& privateName = clientData->builtinFunctions().writableStreamInternalsBuiltins().writableStreamAbortForBindingsPrivateName();

    JSC::MarkedArgumentBuffer arguments;
    arguments.append(guardedObject());
    arguments.append(reason);
    ASSERT(!arguments.hasOverflowed());

    auto result = invokeWritableStreamFunction(globalObject, privateName, arguments);
    if (result.hasException())
        return {};

    return result.returnValue();
}

JSC::JSValue InternalWritableStream::close(JSC::JSGlobalObject& globalObject)
{
    auto* clientData = static_cast<JSVMClientData*>(globalObject.vm().clientData);
    auto& privateName = clientData->builtinFunctions().writableStreamInternalsBuiltins().writableStreamCloseForBindingsPrivateName();

    JSC::MarkedArgumentBuffer arguments;
    arguments.append(guardedObject());
    ASSERT(!arguments.hasOverflowed());

    auto result = invokeWritableStreamFunction(globalObject, privateName, arguments);
    if (result.hasException())
        return {};

    return result.returnValue();
}

JSC::JSValue InternalWritableStream::getWriter(JSC::JSGlobalObject& globalObject)
{
    auto* clientData = static_cast<JSVMClientData*>(globalObject.vm().clientData);
    auto& privateName = clientData->builtinFunctions().writableStreamInternalsBuiltins().acquireWritableStreamDefaultWriterPrivateName();

    JSC::MarkedArgumentBuffer arguments;
    arguments.append(guardedObject());
    ASSERT(!arguments.hasOverflowed());

    auto result = invokeWritableStreamFunction(globalObject, privateName, arguments);
    if (result.hasException())
        return {};

    return result.returnValue();
}

}
