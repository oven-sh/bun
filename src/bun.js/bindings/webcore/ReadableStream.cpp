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

ExceptionOr<Ref<ReadableStream>> ReadableStream::create(JSC::JSGlobalObject& lexicalGlobalObject, RefPtr<ReadableStreamSource>&& source, JSC::JSValue nativePtr)
{
    auto& builtinNames = WebCore::builtinNames(lexicalGlobalObject.vm());
    RELEASE_ASSERT(source != nullptr);

    auto objectOrException = invokeConstructor(lexicalGlobalObject, builtinNames.ReadableStreamPrivateName(), [&source, nativePtr](auto& args, auto& lexicalGlobalObject, auto& globalObject) {
        auto sourceStream = toJSNewlyCreated(&lexicalGlobalObject, &globalObject, source.releaseNonNull());
        auto tag = WebCore::clientData(lexicalGlobalObject.vm())->builtinNames().bunNativePtrPrivateName();
        sourceStream.getObject()->putDirect(lexicalGlobalObject.vm(), tag, nativePtr, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::DontEnum);
        args.append(sourceStream);
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
        return {};
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
        return {};

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

void ReadableStream::cancel(WebCore::JSDOMGlobalObject& globalObject, JSReadableStream* readableStream, const Exception& exception)
{
    auto* clientData = static_cast<JSVMClientData*>(globalObject.vm().clientData);
    auto& privateName = clientData->builtinFunctions().readableStreamInternalsBuiltins().readableStreamCancelPrivateName();

    auto& vm = globalObject.vm();
    JSC::JSLockHolder lock(vm);
    auto scope = DECLARE_CATCH_SCOPE(vm);
    auto value = createDOMException(&globalObject, exception.code(), exception.message());
    if (UNLIKELY(scope.exception())) {
        ASSERT(vm.hasPendingTerminationException());
        return;
    }

    MarkedArgumentBuffer arguments;
    arguments.append(readableStream);
    arguments.append(value);
    ASSERT(!arguments.hasOverflowed());
    invokeReadableStreamFunction(globalObject, privateName, JSC::jsUndefined(), arguments);
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
    auto clientData = WebCore::clientData(m_globalObject->vm());
    auto& privateName = clientData->builtinNames().readerPrivateName();
    return readableStream()->getDirect(m_globalObject->vm(), privateName).isTrue();
}

bool ReadableStream::isLocked(JSGlobalObject* globalObject, JSReadableStream* readableStream)
{
    auto clientData = WebCore::clientData(globalObject->vm());
    auto& privateName = clientData->builtinNames().readerPrivateName();
    return readableStream->getDirect(globalObject->vm(), privateName).isTrue();
}

bool ReadableStream::isDisturbed(JSGlobalObject* globalObject, JSReadableStream* readableStream)
{
    return readableStream->disturbed();
}

bool ReadableStream::isDisturbed() const
{
    return readableStream()->disturbed();
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionTransferToNativeReadableStream, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    auto* readableStream = jsDynamicCast<JSReadableStream*>(callFrame->argument(0));
    readableStream->setTransferred();
    readableStream->setDisturbed(true);
    return JSValue::encode(jsUndefined());
}

}
