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

namespace WebCore {
using namespace JSC;

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
    // structuredClone never leaves this agent cluster, so SABs may share their backing store per
    // https://html.spec.whatwg.org/multipage/structured-data.html#structuredserializeinternal —
    // only the WorkerPostMessage context takes the SAB-sharing path; Default would copy to a plain AB.
    ExceptionOr<Ref<SerializedScriptValue>> serialized = SerializedScriptValue::create(*globalObject, value, WTF::move(serializeOptions.transfer), ports,
        SerializationForStorage::No, SerializationContext::WorkerPostMessage);
    RETURN_IF_EXCEPTION(throwScope, {});
    if (serialized.hasException()) {
        WebCore::propagateException(*globalObject, throwScope, serialized.releaseException());
        RELEASE_AND_RETURN(throwScope, {});
    }
    RETURN_IF_EXCEPTION(throwScope, {});

    JSValue deserialized = serialized.releaseReturnValue()->deserialize(*globalObject, globalObject, ports);
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
        String serializationContextString = serializationContextValue.getString(globalObject);
        RETURN_IF_EXCEPTION(throwScope, {});
        if (serializationContextString == "worker"_s) {
            serializationContext = SerializationContext::WorkerPostMessage;
        } else if (serializationContextString == "window"_s) {
            serializationContext = SerializationContext::WindowPostMessage;
        } else if (serializationContextString == "postMessage"_s) {
            serializationContext = SerializationContext::WindowPostMessage;
        } else if (serializationContextString == "default"_s) {
            serializationContext = SerializationContext::Default;
        } else {
            throwTypeError(globalObject, throwScope, "invalid serialization context"_s);
            return {};
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
    RETURN_IF_EXCEPTION(throwScope, {});
    if (serialized.hasException()) {
        WebCore::propagateException(*globalObject, throwScope, serialized.releaseException());
        RELEASE_AND_RETURN(throwScope, {});
    }
    RETURN_IF_EXCEPTION(throwScope, {});

    JSValue deserialized = serialized.releaseReturnValue()->deserialize(*globalObject, globalObject, ports);
    RETURN_IF_EXCEPTION(throwScope, {});

    return JSValue::encode(deserialized);
}

} // namespace WebCore
