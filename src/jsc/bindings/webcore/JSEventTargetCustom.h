/*
 * Copyright (C) 2016-2020 Apple Inc. All rights reserved.
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
 * THIS SOFTWARE IS PROVIDED BY APPLE INC. AND ITS CONTRIBUTORS ``AS IS''
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO,
 * THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL APPLE INC. OR ITS CONTRIBUTORS
 * BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 * CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 * SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
 * INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
 * CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF
 * THE POSSIBILITY OF SUCH DAMAGE.
 */

#pragma once

#include "JSDOMBinding.h"
#include "JSDOMOperation.h"

namespace WebCore {

// Wrapper type for JSEventTarget's castedThis because JSDOMWindow and JSWorkerGlobalScope do not inherit JSEventTarget.
class JSEventTargetWrapper {
public:
    JSEventTargetWrapper() = default;

    JSEventTargetWrapper(EventTarget& wrapped, JSC::JSObject& wrapper)
        : m_wrapped(&wrapped)
        , m_wrapper(&wrapper)
    {
    }

    bool isNull() const { return !m_wrapped; }
    EventTarget& wrapped()
    {
        ASSERT(m_wrapped);
        return *m_wrapped;
    }

    operator JSC::JSObject&()
    {
        ASSERT(m_wrapper);
        return *m_wrapper;
    }

private:
    EventTarget* m_wrapped { nullptr };
    JSC::JSObject* m_wrapper { nullptr };
};

JSEventTargetWrapper jsEventTargetCast(JSC::VM&, JSC::JSValue thisValue);

template<> class IDLOperation<JSEventTarget> {
public:
    using ClassParameter = JSEventTargetWrapper*;
    using Operation = JSC::EncodedJSValue(JSC::JSGlobalObject*, JSC::CallFrame*, ClassParameter);

    template<Operation operation, CastedThisErrorBehavior = CastedThisErrorBehavior::Throw>
    static JSC::EncodedJSValue call(JSC::JSGlobalObject& lexicalGlobalObject, JSC::CallFrame& callFrame, ASCIILiteral operationName)
    {
        auto& vm = JSC::getVM(&lexicalGlobalObject);
        auto throwScope = DECLARE_THROW_SCOPE(vm);

        auto thisValue = callFrame.thisValue().toThis(&lexicalGlobalObject, JSC::ECMAMode::strict());
        auto thisObject = jsEventTargetCast(vm, thisValue.isUndefinedOrNull() ? JSC::JSValue(&lexicalGlobalObject) : thisValue);
        if (thisObject.isNull()) [[unlikely]]
            return throwThisTypeError(lexicalGlobalObject, throwScope, "EventTarget", operationName);

        // Note: WebKit Ref-protects thisObject.wrapped() here, but Bun's req.signal lifecycle
        // depends on exact ref-counting; the JS cell already keeps wrapped alive via JSDOMWrapper.
        RELEASE_AND_RETURN(throwScope, (operation(&lexicalGlobalObject, &callFrame, &thisObject)));
    }
};

} // namespace WebCore
