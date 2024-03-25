/*
 * Copyright (C) 2010 Google Inc. All rights reserved.
 * Copyright (C) 2013-2018 Apple Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are
 * met:
 *
 *     * Redistributions of source code must retain the above copyright
 * notice, this list of conditions and the following disclaimer.
 *     * Redistributions in binary form must reproduce the above
 * copyright notice, this list of conditions and the following disclaimer
 * in the documentation and/or other materials provided with the
 * distribution.
 *     * Neither the name of Google Inc. nor the names of its
 * contributors may be used to endorse or promote products derived from
 * this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 * A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
 * OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
 * LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

#include "config.h"
#include "JSErrorHandler.h"

// #include "Document.h"
#include "ErrorEvent.h"
#include "Event.h"
#include "JSDOMConvertNumbers.h"
#include "JSDOMConvertStrings.h"
// #include "JSDOMWindow.h"
#include "JSEvent.h"
// #include "JSExecState.h"
// #include "JSExecStateInstrumentation.h"
#include <JavaScriptCore/JSLock.h>
#include <wtf/Ref.h>

namespace WebCore {
using namespace JSC;

inline JSErrorHandler::JSErrorHandler(JSObject& listener, JSObject& wrapper, bool isAttribute, DOMWrapperWorld& world)
    : JSEventListener(&listener, &wrapper, isAttribute, CreatedFromMarkup::No, world)
{
}

Ref<JSErrorHandler> JSErrorHandler::create(JSC::JSObject& listener, JSC::JSObject& wrapper, bool isAttribute, DOMWrapperWorld& world)
{
    return adoptRef(*new JSErrorHandler(listener, wrapper, isAttribute, world));
}

JSErrorHandler::~JSErrorHandler() = default;

void JSErrorHandler::handleEvent(ScriptExecutionContext& scriptExecutionContext, Event& event)
{
    if (!is<ErrorEvent>(event))
        return JSEventListener::handleEvent(scriptExecutionContext, event);

    VM& vm = scriptExecutionContext.vm();
    JSLockHolder lock(vm);

    JSObject* jsFunction = this->ensureJSFunction(scriptExecutionContext);
    if (!jsFunction)
        return;

    auto* globalObject = toJSDOMGlobalObject(scriptExecutionContext, isolatedWorld());
    if (!globalObject)
        return;

    auto callData = getCallData(jsFunction);
    if (callData.type != CallData::Type::None) {
        Ref<JSErrorHandler> protectedThis(*this);

        RefPtr<Event> savedEvent;
        // auto* jsFunctionWindow = jsDynamicCast<JSDOMWindow*>( jsFunction->globalObject());
        // if (jsFunctionWindow) {
        //     savedEvent = jsFunctionWindow->currentEvent();

        //     // window.event should not be set when the target is inside a shadow tree, as per the DOM specification.
        //     if (!event.currentTargetIsInShadowTree())
        //         jsFunctionWindow->setCurrentEvent(&event);
        // }

        auto& errorEvent = downcast<ErrorEvent>(event);

        MarkedArgumentBuffer args;
        args.append(toJS<IDLDOMString>(*globalObject, errorEvent.message()));
        args.append(toJS<IDLUSVString>(*globalObject, errorEvent.filename()));
        args.append(toJS<IDLUnsignedLong>(errorEvent.lineno()));
        args.append(toJS<IDLUnsignedLong>(errorEvent.colno()));
        args.append(errorEvent.error(*globalObject));
        ASSERT(!args.hasOverflowed());

        // JSExecState::instrumentFunction(&scriptExecutionContext, callData);

        NakedPtr<JSC::Exception> exception;
        JSValue returnValue = JSC::profiledCall(globalObject, JSC::ProfilingReason::Other, jsFunction, callData, globalObject, args, exception);

        // InspectorInstrumentation::didCallFunction(&scriptExecutionContext);

        // if (jsFunctionWindow)
        //     jsFunctionWindow->setCurrentEvent(savedEvent.get());

        if (exception)
            reportException(globalObject, exception);
        else {
            if (returnValue.isTrue())
                event.preventDefault();
        }
    }
}

} // namespace WebCore
