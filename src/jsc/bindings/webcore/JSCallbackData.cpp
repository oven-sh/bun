/*
 * Copyright (C) 2007-2021 Apple Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 *
 * 1.  Redistributions of source code must retain the above copyright
 *     notice, this list of conditions and the following disclaimer.
 * 2.  Redistributions in binary form must reproduce the above copyright
 *     notice, this list of conditions and the following disclaimer in the
 *     documentation and/or other materials provided with the distribution.
 * 3.  Neither the name of Apple Inc. ("Apple") nor the names of
 *     its contributors may be used to endorse or promote products derived
 *     from this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY APPLE AND ITS CONTRIBUTORS "AS IS" AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL APPLE OR ITS CONTRIBUTORS BE LIABLE FOR ANY
 * DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
 * LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
 * ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
 * THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

#include "config.h"

#include "ZigGlobalObject.h"

#include "JSCallbackData.h"

#include "JSDOMBinding.h"
// #include "JSExecState.h"
// #include "JSExecStateInstrumentation.h"
#include <JavaScriptCore/Exception.h>

namespace WebCore {
using namespace JSC;

// https://webidl.spec.whatwg.org/#call-a-user-objects-operation
JSValue JSCallbackData::invokeCallback(VM& vm, JSObject* callback, JSValue thisValue, MarkedArgumentBuffer& args, CallbackType method, PropertyName functionName, NakedPtr<JSC::Exception>& returnedException)
{
    ASSERT(callback);

    // https://webidl.spec.whatwg.org/#ref-for-prepare-to-run-script makes callback's [[Realm]] a running JavaScript execution context,
    // which is used for creating TypeError objects: https://tc39.es/ecma262/#sec-ecmascript-function-objects-call-thisargument-argumentslist (step 4).
    JSGlobalObject* lexicalGlobalObject = callback->globalObject();

    ScriptExecutionContext* context = uncheckedDowncast<JSDOMGlobalObject>(lexicalGlobalObject)->scriptExecutionContext();
    // We will fail to get the context if the frame has been detached. Once the VM's stop was
    // requested this is a silent no-op, as at the other native→JS boundaries
    // (JSEventListener::handleEvent, Bun__JSValue__call).
    if (!context || context->isJSExecutionForbidden())
        return JSValue();

    JSValue function = callback;
    CallData callData = getCallData(callback);
    if (callData.type == CallData::Type::None) {
        returnedException = JSC::Exception::create(vm, createTypeError(lexicalGlobalObject));
        return JSValue();
    }

    ASSERT(!function.isEmpty());
    ASSERT(callData.type != CallData::Type::None);

    // JSExecState::instrumentFunction(context, callData);

    returnedException = nullptr;
    JSValue result = JSC::profiledCall(lexicalGlobalObject, JSC::ProfilingReason::Other, function, callData, thisValue, args, returnedException);

    // InspectorInstrumentation::didCallFunction(context);

    return result;
}

template<typename Visitor>
void JSCallbackData::visitJSFunction(Visitor& visitor)
{
    visitor.append(m_callback);
}

template void JSCallbackData::visitJSFunction(JSC::AbstractSlotVisitor&);
template void JSCallbackData::visitJSFunction(JSC::SlotVisitor&);

bool JSCallbackData::WeakOwner::isReachableFromOpaqueRoots(JSC::Handle<JSC::Unknown>, void* context, AbstractSlotVisitor& visitor, ASCIILiteral* reason)
{
    if (reason) [[unlikely]]
        *reason = "Callback owner is an opaque root"_s;
    return visitor.containsOpaqueRoot(context);
}

} // namespace WebCore
