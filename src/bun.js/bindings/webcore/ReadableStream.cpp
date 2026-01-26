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

#include "root.h"

#include "config.h"
#include "ReadableStream.h"

#include "Exception.h"
#include "ExceptionCode.h"
#include "JSDOMConvertSequences.h"
#include "JSReadableStreamSink.h"
#include "JSReadableStreamSource.h"
#include "WebCoreJSClientData.h"
#include "WebCoreJSBuiltins.h"
#include "ZigGlobalObject.h"
#include "ZigGeneratedClasses.h"
#include "helpers.h"
#include "BunClientData.h"
#include "IDLTypes.h"
#include "BunIDLConvert.h"
#include <JavaScriptCore/JSFunction.h>
#include <JavaScriptCore/JSPromise.h>
#include <JavaScriptCore/ThrowScope.h>
#include <JavaScriptCore/CallData.h>
#include <JavaScriptCore/ArgList.h>

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
    EXCEPTION_ASSERT(!!scope.exception() == !object);
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

    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    auto callData = JSC::getCallData(function);
    auto result = call(&lexicalGlobalObject, function, callData, thisValue, arguments);
    EXCEPTION_ASSERT(!scope.exception() || vm.hasPendingTerminationException());
    RETURN_IF_EXCEPTION(scope, {});
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
    auto result = invokeConstructor(*m_globalObject, builtinNames.ReadableStreamDefaultReaderPrivateName(), [this](auto& args, auto&, auto&) {
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
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    auto value = createDOMException(&lexicalGlobalObject, exception.code(), exception.message());
    if (scope.exception()) [[unlikely]] {
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
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    auto value = createDOMException(&globalObject, exception.code(), exception.message());
    if (scope.exception()) [[unlikely]] {
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
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
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

} // namespace WebCore

using namespace JSC;
using namespace WebCore;

extern "C" bool ReadableStream__tee(JSC::EncodedJSValue possibleReadableStream, Zig::GlobalObject* globalObject, JSC::EncodedJSValue* possibleReadableStream1, JSC::EncodedJSValue* possibleReadableStream2)
{
    auto* readableStream = jsDynamicCast<WebCore::JSReadableStream*>(JSC::JSValue::decode(possibleReadableStream));
    if (!readableStream) [[unlikely]]
        return false;

    auto lexicalGlobalObject = globalObject;
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto* clientData = static_cast<Bun::JSVMClientData*>(vm.clientData);
    auto& privateName = clientData->builtinFunctions().readableStreamInternalsBuiltins().readableStreamTeePrivateName();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto invokeReadableStreamFunction = [](JSC::JSGlobalObject* lexicalGlobalObject, const JSC::Identifier& identifier, JSC::JSValue thisValue, const JSC::MarkedArgumentBuffer& arguments) -> std::optional<JSC::JSValue> {
        JSC::VM& vm = lexicalGlobalObject->vm();
        auto scope = DECLARE_THROW_SCOPE(vm);
        JSC::JSLockHolder lock(vm);

        auto function = lexicalGlobalObject->get(lexicalGlobalObject, identifier);
        scope.assertNoExceptionExceptTermination();
        if (scope.exception()) [[unlikely]]
            return {};
        ASSERT(function.isCallable());

        auto callData = JSC::getCallData(function);
        auto result = JSC::call(lexicalGlobalObject, function, callData, thisValue, arguments);
#if ASSERT_ENABLED
        if (scope.exception()) [[unlikely]] {
            Bun__reportError(lexicalGlobalObject, JSC::JSValue::encode(scope.exception()));
        }
#endif
        EXCEPTION_ASSERT(!scope.exception() || vm.hasPendingTerminationException());
        RETURN_IF_EXCEPTION(scope, {});
        return result;
    };

    MarkedArgumentBuffer arguments;
    arguments.append(readableStream);
    arguments.append(JSC::jsBoolean(true));
    ASSERT(!arguments.hasOverflowed());
    auto returnedValue = invokeReadableStreamFunction(lexicalGlobalObject, privateName, JSC::jsUndefined(), arguments);
    RETURN_IF_EXCEPTION(scope, false);
    if (!returnedValue) return false;

    auto results = convert<IDLSequence<Bun::IDLRawAny, std::array<JSValue, 2>>>(*lexicalGlobalObject, *returnedValue);
    RETURN_IF_EXCEPTION(scope, false);

    *possibleReadableStream1 = JSValue::encode(results[0]);
    *possibleReadableStream2 = JSValue::encode(results[1]);
    return true;
}

extern "C" void ReadableStream__cancel(JSC::EncodedJSValue possibleReadableStream, Zig::GlobalObject* globalObject)
{
    auto* readableStream = jsDynamicCast<WebCore::JSReadableStream*>(JSC::JSValue::decode(possibleReadableStream));
    if (!readableStream) [[unlikely]]
        return;

    if (!WebCore::ReadableStream::isLocked(globalObject, readableStream)) {
        return;
    }

    WebCore::Exception exception { Bun::AbortError };
    WebCore::ReadableStream::cancel(*globalObject, readableStream, exception);
}

extern "C" void ReadableStream__detach(JSC::EncodedJSValue possibleReadableStream, Zig::GlobalObject* globalObject)
{
    auto value = JSC::JSValue::decode(possibleReadableStream);
    if (value.isEmpty() || !value.isCell())
        return;

    auto* readableStream = static_cast<WebCore::JSReadableStream*>(value.asCell());
    if (!readableStream) [[unlikely]]
        return;
    readableStream->setNativePtr(globalObject->vm(), jsNumber(-1));
    readableStream->setNativeType(0);
    readableStream->setDisturbed(true);
}

extern "C" bool ReadableStream__isDisturbed(JSC::EncodedJSValue possibleReadableStream, Zig::GlobalObject* globalObject)
{
    ASSERT(globalObject);
    return WebCore::ReadableStream::isDisturbed(globalObject, jsDynamicCast<WebCore::JSReadableStream*>(JSC::JSValue::decode(possibleReadableStream)));
}

extern "C" bool ReadableStream__isLocked(JSC::EncodedJSValue possibleReadableStream, Zig::GlobalObject* globalObject)
{
    ASSERT(globalObject);
    WebCore::JSReadableStream* stream = jsDynamicCast<WebCore::JSReadableStream*>(JSValue::decode(possibleReadableStream));
    return stream != nullptr && WebCore::ReadableStream::isLocked(globalObject, stream);
}

extern "C" int32_t ReadableStreamTag__tagged(Zig::GlobalObject* globalObject, JSC::EncodedJSValue* possibleReadableStream, void** ptr)
{
    ASSERT(globalObject);
    JSC::JSObject* object = JSValue::decode(*possibleReadableStream).getObject();
    if (!object) {
        *ptr = nullptr;
        return -1;
    }

    auto& vm = JSC::getVM(globalObject);

    if (!object->inherits<WebCore::JSReadableStream>()) {
        auto throwScope = DECLARE_THROW_SCOPE(vm);
        JSValue target = object;
        JSValue fn = JSValue();
        auto* function = jsDynamicCast<JSC::JSFunction*>(object);
        if (function && !function->isHostFunction() && function->jsExecutable() && function->jsExecutable()->isAsyncGenerator()) {
            fn = object;
            target = jsUndefined();
        } else {
            auto iterable = object->getIfPropertyExists(globalObject, vm.propertyNames->asyncIteratorSymbol);
            RETURN_IF_EXCEPTION(throwScope, {});
            if (iterable && iterable.isCallable()) {
                fn = iterable;
            }
        }

        if (throwScope.exception()) [[unlikely]] {
            *ptr = nullptr;
            return -1;
        }

        if (fn.isEmpty()) {
            *ptr = nullptr;
            return -1;
        }

        auto* createIterator = globalObject->builtinInternalFunctions().readableStreamInternals().m_readableStreamFromAsyncIteratorFunction.get();

        JSC::MarkedArgumentBuffer arguments;
        arguments.append(target);
        arguments.append(fn);

        JSC::JSValue result = profiledCall(globalObject, JSC::ProfilingReason::API, createIterator, JSC::getCallData(createIterator), JSC::jsUndefined(), arguments);

        if (throwScope.exception()) [[unlikely]] {
            return -1;
        }

        if (!result.isObject()) {
            *ptr = nullptr;
            return -1;
        }

        object = result.getObject();

        ASSERT(object->inherits<WebCore::JSReadableStream>());
        *possibleReadableStream = JSValue::encode(object);
        *ptr = nullptr;
        ensureStillAliveHere(object);
        return 0;
    }

    auto* readableStream = jsCast<WebCore::JSReadableStream*>(object);

    JSValue nativePtrHandle = readableStream->nativePtr();
    if (nativePtrHandle.isEmpty() || !nativePtrHandle.isCell()) {
        *ptr = nullptr;
        return 0;
    }

    JSCell* cell = nativePtrHandle.asCell();

    if (auto* casted = jsDynamicCast<JSBlobInternalReadableStreamSource*>(cell)) {
        *ptr = casted->wrapped();
        return 1;
    }

    if (auto* casted = jsDynamicCast<JSFileInternalReadableStreamSource*>(cell)) {
        *ptr = casted->wrapped();
        return 2;
    }

    if (auto* casted = jsDynamicCast<JSBytesInternalReadableStreamSource*>(cell)) {
        *ptr = casted->wrapped();
        return 4;
    }

    return 0;
}

extern "C" JSC::EncodedJSValue ZigGlobalObject__createNativeReadableStream(Zig::GlobalObject* globalObject, JSC::EncodedJSValue nativePtr)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto& builtinNames = WebCore::builtinNames(vm);

    auto function = globalObject->getDirect(vm, builtinNames.createNativeReadableStreamPrivateName()).getObject();
    JSC::MarkedArgumentBuffer arguments = JSC::MarkedArgumentBuffer();
    arguments.append(JSValue::decode(nativePtr));

    auto callData = JSC::getCallData(function);
    auto result = call(globalObject, function, callData, JSC::jsUndefined(), arguments);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(result);
}

static inline JSC::EncodedJSValue ZigGlobalObject__readableStreamToArrayBufferBody(Zig::GlobalObject* globalObject, JSC::EncodedJSValue readableStreamValue)
{
    auto& vm = JSC::getVM(globalObject);

    auto throwScope = DECLARE_THROW_SCOPE(vm);

    auto* function = globalObject->m_readableStreamToArrayBuffer.get();
    if (!function) {
        function = JSFunction::create(vm, globalObject, static_cast<JSC::FunctionExecutable*>(readableStreamReadableStreamToArrayBufferCodeGenerator(vm)), globalObject);
        globalObject->m_readableStreamToArrayBuffer.set(vm, globalObject, function);
    }

    JSC::MarkedArgumentBuffer arguments = JSC::MarkedArgumentBuffer();
    arguments.append(JSValue::decode(readableStreamValue));

    auto callData = JSC::getCallData(function);
    JSValue result = call(globalObject, function, callData, JSC::jsUndefined(), arguments);

    JSC::JSObject* object = result.getObject();

    if (!result || result.isUndefinedOrNull()) [[unlikely]]
        return JSValue::encode(result);

    if (!object) [[unlikely]] {
        auto throwScope = DECLARE_THROW_SCOPE(vm);
        throwTypeError(globalObject, throwScope, "Expected object"_s);
        return {};
    }

    JSC::JSPromise* promise = JSC::jsDynamicCast<JSC::JSPromise*>(object);
    if (!promise) [[unlikely]] {
        auto throwScope = DECLARE_THROW_SCOPE(vm);
        throwTypeError(globalObject, throwScope, "Expected promise"_s);
        return {};
    }

    RELEASE_AND_RETURN(throwScope, JSC::JSValue::encode(promise));
}

extern "C" JSC::EncodedJSValue ZigGlobalObject__readableStreamToArrayBuffer(Zig::GlobalObject* globalObject, JSC::EncodedJSValue readableStreamValue)
{
    return ZigGlobalObject__readableStreamToArrayBufferBody(static_cast<Zig::GlobalObject*>(globalObject), readableStreamValue);
}

extern "C" JSC::EncodedJSValue ZigGlobalObject__readableStreamToBytes(Zig::GlobalObject* globalObject, JSC::EncodedJSValue readableStreamValue)
{
    auto& vm = JSC::getVM(globalObject);

    auto throwScope = DECLARE_THROW_SCOPE(vm);

    auto* function = globalObject->m_readableStreamToBytes.get();
    if (!function) {
        function = JSFunction::create(vm, globalObject, static_cast<JSC::FunctionExecutable*>(readableStreamReadableStreamToBytesCodeGenerator(vm)), globalObject);
        globalObject->m_readableStreamToBytes.set(vm, globalObject, function);
    }

    JSC::MarkedArgumentBuffer arguments = JSC::MarkedArgumentBuffer();
    arguments.append(JSValue::decode(readableStreamValue));

    auto callData = JSC::getCallData(function);
    JSValue result = call(globalObject, function, callData, JSC::jsUndefined(), arguments);

    JSC::JSObject* object = result.getObject();

    if (!result || result.isUndefinedOrNull()) [[unlikely]]
        return JSValue::encode(result);

    if (!object) [[unlikely]] {
        auto throwScope = DECLARE_THROW_SCOPE(vm);
        throwTypeError(globalObject, throwScope, "Expected object"_s);
        return {};
    }

    JSC::JSPromise* promise = JSC::jsDynamicCast<JSC::JSPromise*>(object);
    if (!promise) [[unlikely]] {
        auto throwScope = DECLARE_THROW_SCOPE(vm);
        throwTypeError(globalObject, throwScope, "Expected promise"_s);
        return {};
    }

    RELEASE_AND_RETURN(throwScope, JSC::JSValue::encode(promise));
}

extern "C" JSC::EncodedJSValue ZigGlobalObject__readableStreamToText(Zig::GlobalObject* globalObject, JSC::EncodedJSValue readableStreamValue)
{
    auto& vm = JSC::getVM(globalObject);

    JSC::JSFunction* function = nullptr;
    if (auto readableStreamToText = globalObject->m_readableStreamToText.get()) {
        function = readableStreamToText;
    } else {
        function = JSFunction::create(vm, globalObject, static_cast<JSC::FunctionExecutable*>(readableStreamReadableStreamToTextCodeGenerator(vm)), globalObject);

        globalObject->m_readableStreamToText.set(vm, globalObject, function);
    }

    JSC::MarkedArgumentBuffer arguments = JSC::MarkedArgumentBuffer();
    arguments.append(JSValue::decode(readableStreamValue));

    auto callData = JSC::getCallData(function);
    return JSC::JSValue::encode(call(globalObject, function, callData, JSC::jsUndefined(), arguments));
}

extern "C" JSC::EncodedJSValue ZigGlobalObject__readableStreamToFormData(Zig::GlobalObject* globalObject, JSC::EncodedJSValue readableStreamValue, JSC::EncodedJSValue contentTypeValue)
{
    auto& vm = JSC::getVM(globalObject);

    JSC::JSFunction* function = nullptr;
    if (auto readableStreamToFormData = globalObject->m_readableStreamToFormData.get()) {
        function = readableStreamToFormData;
    } else {
        function = JSFunction::create(vm, globalObject, static_cast<JSC::FunctionExecutable*>(readableStreamReadableStreamToFormDataCodeGenerator(vm)), globalObject);

        globalObject->m_readableStreamToFormData.set(vm, globalObject, function);
    }

    JSC::MarkedArgumentBuffer arguments = JSC::MarkedArgumentBuffer();
    arguments.append(JSValue::decode(readableStreamValue));
    arguments.append(JSValue::decode(contentTypeValue));

    auto callData = JSC::getCallData(function);
    return JSC::JSValue::encode(call(globalObject, function, callData, JSC::jsUndefined(), arguments));
}

extern "C" JSC::EncodedJSValue ZigGlobalObject__readableStreamToJSON(Zig::GlobalObject* globalObject, JSC::EncodedJSValue readableStreamValue)
{
    auto& vm = JSC::getVM(globalObject);

    JSC::JSFunction* function = nullptr;
    if (auto readableStreamToJSON = globalObject->m_readableStreamToJSON.get()) {
        function = readableStreamToJSON;
    } else {
        function = JSFunction::create(vm, globalObject, static_cast<JSC::FunctionExecutable*>(readableStreamReadableStreamToJSONCodeGenerator(vm)), globalObject);

        globalObject->m_readableStreamToJSON.set(vm, globalObject, function);
    }

    JSC::MarkedArgumentBuffer arguments = JSC::MarkedArgumentBuffer();
    arguments.append(JSValue::decode(readableStreamValue));

    auto callData = JSC::getCallData(function);
    return JSC::JSValue::encode(call(globalObject, function, callData, JSC::jsUndefined(), arguments));
}

extern "C" JSC::EncodedJSValue ZigGlobalObject__readableStreamToBlob(Zig::GlobalObject* globalObject, JSC::EncodedJSValue readableStreamValue)
{
    auto& vm = JSC::getVM(globalObject);

    JSC::JSFunction* function = nullptr;
    if (auto readableStreamToBlob = globalObject->m_readableStreamToBlob.get()) {
        function = readableStreamToBlob;
    } else {
        function = JSFunction::create(vm, globalObject, static_cast<JSC::FunctionExecutable*>(readableStreamReadableStreamToBlobCodeGenerator(vm)), globalObject);

        globalObject->m_readableStreamToBlob.set(vm, globalObject, function);
    }

    JSC::MarkedArgumentBuffer arguments = JSC::MarkedArgumentBuffer();
    arguments.append(JSValue::decode(readableStreamValue));

    auto callData = JSC::getCallData(function);
    return JSC::JSValue::encode(call(globalObject, function, callData, JSC::jsUndefined(), arguments));
}

JSC_DEFINE_HOST_FUNCTION(functionReadableStreamToArrayBuffer, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);

    if (callFrame->argumentCount() < 1) [[unlikely]] {
        auto throwScope = DECLARE_THROW_SCOPE(vm);
        throwTypeError(globalObject, throwScope, "Expected at least one argument"_s);
        return {};
    }

    auto readableStreamValue = callFrame->uncheckedArgument(0);
    return ZigGlobalObject__readableStreamToArrayBufferBody(static_cast<Zig::GlobalObject*>(globalObject), JSValue::encode(readableStreamValue));
}

JSC_DEFINE_HOST_FUNCTION(functionReadableStreamToBytes, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);

    if (callFrame->argumentCount() < 1) [[unlikely]] {
        auto throwScope = DECLARE_THROW_SCOPE(vm);
        throwTypeError(globalObject, throwScope, "Expected at least one argument"_s);
        return {};
    }

    auto readableStreamValue = callFrame->uncheckedArgument(0);
    return ZigGlobalObject__readableStreamToBytes(static_cast<Zig::GlobalObject*>(globalObject), JSValue::encode(readableStreamValue));
}
