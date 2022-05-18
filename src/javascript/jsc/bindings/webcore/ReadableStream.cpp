/*
 * Copyright (C) 2017-2021 Apple Inc. All rights reserved.
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
#include "ReadableStream.h"

#include "Exception.h"
#include "ExceptionCode.h"
#include "JSDOMConvertSequences.h"
#include "JSReadableStreamSink.h"
#include "JSReadableStreamSource.h"
#include "WebCoreJSClientData.h"


namespace WebCore {
using namespace JSC;

static inline ExceptionOr<JSObject*> invokeConstructor(JSC::JSGlobalObject& lexicalGlobalObject, const JSC::Identifier& identifier, const Function<void(MarkedArgumentBuffer&, JSC::JSGlobalObject&, JSDOMGlobalObject&)>& buildArguments)
{
    VM& vm = lexicalGlobalObject.vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto& globalObject = *JSC::jsCast<JSDOMGlobalObject*>(&lexicalGlobalObject);

    auto constructorValue = globalObject.get(&lexicalGlobalObject, identifier);
    EXCEPTION_ASSERT(!scope.exception() || vm.hasPendingTerminationException());
    RETURN_IF_EXCEPTION(scope, Exception { ExistingExceptionError });
    auto constructor = JSC::asObject(constructorValue);

    auto constructData = JSC::getConstructData(constructor);
    ASSERT(constructData.type != CallData::Type::None);

    MarkedArgumentBuffer args;
    buildArguments(args, lexicalGlobalObject, globalObject);
    ASSERT(!args.hasOverflowed());

    JSObject* object = JSC::construct(&lexicalGlobalObject, constructor, constructData, args);
    ASSERT(!!scope.exception() == !object);
    EXCEPTION_ASSERT(!scope.exception() || vm.hasPendingTerminationException());
    RETURN_IF_EXCEPTION(scope, Exception { ExistingExceptionError });

    return object;
}

ExceptionOr<Ref<ReadableStream>> ReadableStream::create(JSC::JSGlobalObject& lexicalGlobalObject, RefPtr<ReadableStreamSource>&& source)
{
    auto& builtinNames = WebCore::builtinNames(lexicalGlobalObject.vm());

    auto objectOrException = invokeConstructor(lexicalGlobalObject, builtinNames.ReadableStreamPrivateName(), [&source](auto& args, auto& lexicalGlobalObject, auto& globalObject) {
        args.append(source ? toJSNewlyCreated(&lexicalGlobalObject, &globalObject, source.releaseNonNull()) : JSC::jsUndefined());
    });

    if (objectOrException.hasException())
        return objectOrException.releaseException();

    return create(*JSC::jsCast<JSDOMGlobalObject*>(&lexicalGlobalObject), *jsCast<JSReadableStream*>(objectOrException.releaseReturnValue()));
}

static inline std::optional<JSC::JSValue> invokeReadableStreamFunction(JSC::JSGlobalObject& lexicalGlobalObject, const JSC::Identifier& identifier, JSC::JSValue thisValue, const JSC::MarkedArgumentBuffer& arguments)
{
    JSC::VM& vm = lexicalGlobalObject.vm();
    JSC::JSLockHolder lock(vm);

    auto function = lexicalGlobalObject.get(&lexicalGlobalObject, identifier);
    ASSERT(function.isCallable());

    auto scope = DECLARE_CATCH_SCOPE(vm);
    auto callData = JSC::getCallData(function);
    auto result = call(&lexicalGlobalObject, function, callData, thisValue, arguments);
    EXCEPTION_ASSERT(!scope.exception() || vm.hasPendingTerminationException());
    if (scope.exception())
        return { };
    return result;
}

void ReadableStream::pipeTo(ReadableStreamSink& sink)
{
    auto& lexicalGlobalObject = *m_globalObject;
    auto* clientData = static_cast<JSVMClientData*>(lexicalGlobalObject.vm().clientData);
    auto& privateName = clientData->builtinFunctions().readableStreamInternalsBuiltins().readableStreamPipeToPrivateName();

    MarkedArgumentBuffer arguments;
    arguments.append(readableStream());
    arguments.append(toJS(&lexicalGlobalObject, m_globalObject.get(), sink));
    ASSERT(!arguments.hasOverflowed());
    invokeReadableStreamFunction(lexicalGlobalObject, privateName, JSC::jsUndefined(), arguments);
}

std::optional<std::pair<Ref<ReadableStream>, Ref<ReadableStream>>> ReadableStream::tee()
{
    auto& lexicalGlobalObject = *m_globalObject;
    auto* clientData = static_cast<JSVMClientData*>(lexicalGlobalObject.vm().clientData);
    auto& privateName = clientData->builtinFunctions().readableStreamInternalsBuiltins().readableStreamTeePrivateName();

    MarkedArgumentBuffer arguments;
    arguments.append(readableStream());
    arguments.append(JSC::jsBoolean(true));
    ASSERT(!arguments.hasOverflowed());
    auto returnedValue = invokeReadableStreamFunction(lexicalGlobalObject, privateName, JSC::jsUndefined(), arguments);
    if (!returnedValue)
        return { };

    auto results = Detail::SequenceConverter<IDLInterface<ReadableStream>>::convert(lexicalGlobalObject, *returnedValue);

    ASSERT(results.size() == 2);
    return std::make_pair(results[0].releaseNonNull(), results[1].releaseNonNull());
}

void ReadableStream::lock()
{
    auto& builtinNames = WebCore::builtinNames(m_globalObject->vm());
    invokeConstructor(*m_globalObject, builtinNames.ReadableStreamDefaultReaderPrivateName(), [this](auto& args, auto&, auto&) {
        args.append(readableStream());
    });
}

void ReadableStream::cancel(const Exception& exception)
{
    auto& lexicalGlobalObject = *m_globalObject;
    auto* clientData = static_cast<JSVMClientData*>(lexicalGlobalObject.vm().clientData);
    auto& privateName = clientData->builtinFunctions().readableStreamInternalsBuiltins().readableStreamCancelPrivateName();

    auto& vm = lexicalGlobalObject.vm();
    JSC::JSLockHolder lock(vm);
    auto scope = DECLARE_CATCH_SCOPE(vm);
    auto value = createDOMException(&lexicalGlobalObject, exception.code(), exception.message());
    if (UNLIKELY(scope.exception())) {
        ASSERT(vm.hasPendingTerminationException());
        return;
    }

    MarkedArgumentBuffer arguments;
    arguments.append(readableStream());
    arguments.append(value);
    ASSERT(!arguments.hasOverflowed());
    invokeReadableStreamFunction(lexicalGlobalObject, privateName, JSC::jsUndefined(), arguments);
}

static inline bool checkReadableStream(JSDOMGlobalObject& globalObject, JSReadableStream* readableStream, JSC::JSValue function)
{
    auto& lexicalGlobalObject = globalObject;

    ASSERT(function);
    JSC::MarkedArgumentBuffer arguments;
    arguments.append(readableStream);
    ASSERT(!arguments.hasOverflowed());

    auto& vm = lexicalGlobalObject.vm();
    auto scope = DECLARE_CATCH_SCOPE(vm);
    auto callData = JSC::getCallData(function);
    ASSERT(callData.type != JSC::CallData::Type::None);

    auto result = call(&lexicalGlobalObject, function, callData, JSC::jsUndefined(), arguments);
    EXCEPTION_ASSERT(!scope.exception() || vm.hasPendingTerminationException());

    return result.isTrue() || scope.exception();
}

bool ReadableStream::isLocked() const
{
    return checkReadableStream(*globalObject(), readableStream(), globalObject()->builtinInternalFunctions().readableStreamInternals().m_isReadableStreamLockedFunction.get());
}

bool ReadableStream::isDisturbed() const
{
    return checkReadableStream(*globalObject(), readableStream(), globalObject()->builtinInternalFunctions().readableStreamInternals().m_isReadableStreamDisturbedFunction.get());
}

bool ReadableStream::isDisturbed(JSGlobalObject& lexicalGlobalObject, JSValue value)
{
    auto& globalObject = *jsDynamicCast<JSDOMGlobalObject*>(&lexicalGlobalObject);
    auto* readableStream = jsDynamicCast<JSReadableStream*>(value);

    return checkReadableStream(globalObject, readableStream, globalObject.builtinInternalFunctions().readableStreamInternals().m_isReadableStreamDisturbedFunction.get());
}

}
