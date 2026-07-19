/*
 * Copyright (C) 2016 Apple Inc. All Rights Reserved.
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
 *
 */

#include "config.h"
#include "StructuredClone.h"

#include "JSDOMBinding.h"
#include "JSDOMExceptionHandling.h"
#include <JavaScriptCore/JSTypedArrays.h>
#include "SerializedScriptValue.h"
#include "MessagePort.h"
#include "JSStructuredSerializeOptions.h"
#include "ZigGlobalObject.h"

namespace WebCore {
using namespace JSC;

enum class CloneMode {
    Full,
    Partial,
};

static JSC::EncodedJSValue cloneArrayBufferImpl(JSGlobalObject* lexicalGlobalObject, CallFrame* callFrame, CloneMode mode)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);

    ASSERT(lexicalGlobalObject);
    ASSERT(callFrame->argumentCount());
    ASSERT(callFrame->lexicalGlobalObject(vm) == lexicalGlobalObject);

    auto* buffer = toUnsharedArrayBuffer(vm, callFrame->uncheckedArgument(0));
    if (!buffer) {
        auto scope = DECLARE_THROW_SCOPE(vm);
        throwDataCloneError(*lexicalGlobalObject, scope);
        return {};
    }
    if (mode == CloneMode::Partial) {
        ASSERT(callFrame->argumentCount() == 3);
        int srcByteOffset = static_cast<int>(callFrame->uncheckedArgument(1).toNumber(lexicalGlobalObject));
        int srcLength = static_cast<int>(callFrame->uncheckedArgument(2).toNumber(lexicalGlobalObject));
        return JSValue::encode(JSArrayBuffer::create(lexicalGlobalObject->vm(), lexicalGlobalObject->arrayBufferStructure(ArrayBufferSharingMode::Default), buffer->slice(srcByteOffset, srcByteOffset + srcLength)));
    }
    return JSValue::encode(JSArrayBuffer::create(lexicalGlobalObject->vm(), lexicalGlobalObject->arrayBufferStructure(ArrayBufferSharingMode::Default), buffer->slice(0)));
}

JSC_DEFINE_HOST_FUNCTION(cloneArrayBuffer, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    return cloneArrayBufferImpl(globalObject, callFrame, CloneMode::Partial);
}

JSC_DEFINE_HOST_FUNCTION(structuredCloneForStream, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    ASSERT(callFrame);
    ASSERT(callFrame->argumentCount());

    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue value = callFrame->uncheckedArgument(0);

    if (value.isPrimitive()) {
        return JSValue::encode(value);
    }

    if (value.inherits<JSArrayBuffer>())
        RELEASE_AND_RETURN(scope, cloneArrayBufferImpl(globalObject, callFrame, CloneMode::Full));

    if (value.inherits<JSArrayBufferView>()) {
        auto* bufferView = uncheckedDowncast<JSArrayBufferView>(value);
        ASSERT(bufferView);

        auto* buffer = bufferView->unsharedBuffer();
        if (!buffer) {
            throwDataCloneError(*globalObject, scope);
            return {};
        }
        // Copy only the bytes the view covers. Chunks are often narrow windows into a
        // much larger shared buffer (e.g. a fetch body's read buffer); cloning the whole
        // backing buffer per chunk retains every neighboring chunk's bytes again.
        size_t byteOffset = bufferView->byteOffset();
        auto bufferClone = buffer->slice(byteOffset, byteOffset + bufferView->byteLength());
        Structure* structure = bufferView->structure();

#define CLONE_TYPED_ARRAY(name)                                                                                                                            \
    do {                                                                                                                                                   \
        if (bufferView->inherits<JS##name##Array>())                                                                                                       \
            RELEASE_AND_RETURN(scope, JSValue::encode(JS##name##Array::create(globalObject, structure, WTF::move(bufferClone), 0, bufferView->length()))); \
    } while (0);

        FOR_EACH_TYPED_ARRAY_TYPE_EXCLUDING_DATA_VIEW(CLONE_TYPED_ARRAY)

#undef CLONE_TYPED_ARRAY

        if (value.inherits<JSDataView>())
            RELEASE_AND_RETURN(scope, JSValue::encode(JSDataView::create(globalObject, structure, WTF::move(bufferClone), 0, bufferView->length())));
    }

    throwTypeError(globalObject, scope, "structuredClone not implemented for non-ArrayBuffer / non-ArrayBufferView"_s);
    return {};
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionStructuredClone, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    if (callFrame->argumentCount() == 0) {
        throwTypeError(globalObject, throwScope, "structuredClone requires 1 argument"_s);
        return {};
    }

    JSC::JSValue value = callFrame->argument(0);
    JSC::JSValue options = callFrame->argument(1);

    // https://html.spec.whatwg.org/multipage/structured-data.html#dom-structuredclone
    // Convert the options dictionary (including its `transfer` sequence) per WebIDL
    // before serializing, so an invalid transfer list throws without detaching anything.
    auto serializeOptions = convertDictionary<StructuredSerializeOptions>(*globalObject, options);
    RETURN_IF_EXCEPTION(throwScope, {});

    Vector<RefPtr<MessagePort>> ports;
    ExceptionOr<Ref<SerializedScriptValue>> serialized = SerializedScriptValue::create(*globalObject, value, WTF::move(serializeOptions.transfer), ports);
    if (serialized.hasException()) {
        WebCore::propagateException(*globalObject, throwScope, serialized.releaseException());
        RELEASE_AND_RETURN(throwScope, {});
    }
    throwScope.assertNoException();

    // StructuredSerializeWithTransfer sets [[Detached]] on every transferable and
    // StructuredDeserializeWithTransfer creates a fresh object per transferDataHolder.
    auto disentangled = MessagePort::disentanglePorts(WTF::move(ports));
    if (disentangled.hasException()) {
        WebCore::propagateException(*globalObject, throwScope, disentangled.releaseException());
        RELEASE_AND_RETURN(throwScope, {});
    }
    auto* context = defaultGlobalObject(globalObject)->scriptExecutionContext();
    auto entangled = MessagePort::entanglePorts(*context, disentangled.releaseReturnValue());

    JSValue deserialized = serialized.releaseReturnValue()->deserialize(*globalObject, globalObject, entangled);
    RETURN_IF_EXCEPTION(throwScope, {});

    return JSValue::encode(deserialized);
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionStructuredCloneAdvanced, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    if (callFrame->argumentCount() < 4) {
        throwTypeError(globalObject, throwScope, "structuredCloneAdvanced requires 3 arguments"_s);
        return {};
    }

    JSC::JSValue value = callFrame->argument(0);
    JSC::JSValue transferListValue = callFrame->argument(1);
    bool isForTransfer = callFrame->argument(2).toBoolean(globalObject);
    bool isForStorage = callFrame->argument(3).toBoolean(globalObject);
    JSC::JSValue serializationContextValue = callFrame->argument(4);

    SerializationContext serializationContext = SerializationContext::Default;
    if (serializationContextValue.isString()) {
        if (serializationContextValue.getString(globalObject) == "worker"_s) {
            serializationContext = SerializationContext::WorkerPostMessage;
        } else if (serializationContextValue.getString(globalObject) == "window"_s) {
            serializationContext = SerializationContext::WindowPostMessage;
        } else if (serializationContextValue.getString(globalObject) == "postMessage"_s) {
            serializationContext = SerializationContext::WindowPostMessage;
        } else if (serializationContextValue.getString(globalObject) == "default"_s) {
            serializationContext = SerializationContext::Default;
        } else {
            throwTypeError(globalObject, throwScope, "invalid serialization context"_s);
        }
    }

    SerializationForCrossProcessTransfer forTransfer = isForTransfer ? SerializationForCrossProcessTransfer::Yes : SerializationForCrossProcessTransfer::No;
    SerializationForStorage forStorage = isForStorage ? SerializationForStorage::Yes : SerializationForStorage::No;

    Vector<JSC::Strong<JSC::JSObject>> transferList;

    if (transferListValue.isObject()) {
        JSC::JSObject* transferListObject = transferListValue.getObject();
        if (auto* transferListArray = dynamicDowncast<JSC::JSArray>(transferListObject)) {
            for (unsigned i = 0; i < transferListArray->length(); i++) {
                JSC::JSValue transferListValue = transferListArray->get(globalObject, i);
                RETURN_IF_EXCEPTION(throwScope, {});
                if (transferListValue.isObject()) {
                    transferList.append(JSC::Strong<JSC::JSObject>(vm, transferListValue.getObject()));
                }
            }
        }
    }

    Vector<RefPtr<MessagePort>> ports;
    ExceptionOr<Ref<SerializedScriptValue>> serialized = SerializedScriptValue::create(*globalObject, value, WTF::move(transferList), ports, forStorage, serializationContext, forTransfer);
    if (serialized.hasException()) {
        WebCore::propagateException(*globalObject, throwScope, serialized.releaseException());
        RELEASE_AND_RETURN(throwScope, {});
    }
    throwScope.assertNoException();

    auto disentangled = MessagePort::disentanglePorts(WTF::move(ports));
    if (disentangled.hasException()) {
        WebCore::propagateException(*globalObject, throwScope, disentangled.releaseException());
        RELEASE_AND_RETURN(throwScope, {});
    }
    auto* context = defaultGlobalObject(globalObject)->scriptExecutionContext();
    auto entangled = MessagePort::entanglePorts(*context, disentangled.releaseReturnValue());

    JSValue deserialized = serialized.releaseReturnValue()->deserialize(*globalObject, globalObject, entangled);
    RETURN_IF_EXCEPTION(throwScope, {});

    return JSValue::encode(deserialized);
}

} // namespace WebCore
