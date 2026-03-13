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

#pragma once

#include "JSDOMBinding.h"
#include "ScriptExecutionContext.h"
#include <JavaScriptCore/JSObject.h>
#include <JavaScriptCore/Strong.h>
#include <JavaScriptCore/StrongInlines.h>
#include <wtf/Threading.h>

namespace WebCore {

// We have to clean up this data on the context thread because unprotecting a
// JSObject on the wrong thread without synchronization would corrupt the heap
// (and synchronization would be slow).

class JSCallbackData {
    WTF_DEPRECATED_MAKE_FAST_ALLOCATED(JSCallbackData);

public:
    enum class CallbackType { Function,
        Object,
        FunctionOrObject };

    WEBCORE_EXPORT static JSC::JSValue invokeCallback(JSC::VM&, JSC::JSObject* callback, JSC::JSValue thisValue, JSC::MarkedArgumentBuffer&, CallbackType, JSC::PropertyName functionName, NakedPtr<JSC::Exception>& returnedException);

protected:
    explicit JSCallbackData() = default;

    ~JSCallbackData()
    {
#if !PLATFORM(IOS_FAMILY)
        ASSERT(m_thread.ptr() == &Thread::currentSingleton());
#endif
    }

private:
#if ASSERT_ENABLED
    Ref<Thread> m_thread { Thread::currentSingleton() };
#endif
};

class JSCallbackDataStrong : public JSCallbackData {
public:
    JSCallbackDataStrong(JSC::VM& vm, JSC::JSObject* callback, void* = nullptr)
        : m_callback(vm, callback)
    {
    }

    JSC::JSObject* callback() { return m_callback.get(); }

    JSC::JSValue invokeCallback(JSC::VM& vm, JSC::JSValue thisValue, JSC::MarkedArgumentBuffer& args, CallbackType callbackType, JSC::PropertyName functionName, NakedPtr<JSC::Exception>& returnedException)
    {
        return JSCallbackData::invokeCallback(vm, callback(), thisValue, args, callbackType, functionName, returnedException);
    }

private:
    JSC::Strong<JSC::JSObject> m_callback;
};

class JSCallbackDataWeak : public JSCallbackData {
public:
    JSCallbackDataWeak(JSC::VM&, JSC::JSObject* callback, void* owner)
        : m_callback(callback, &m_weakOwner, owner)
    {
    }

    JSC::JSObject* callback() { return m_callback.get(); }

    JSC::JSValue invokeCallback(JSC::VM& vm, JSC::JSValue thisValue, JSC::MarkedArgumentBuffer& args, CallbackType callbackType, JSC::PropertyName functionName, NakedPtr<JSC::Exception>& returnedException)
    {
        return JSCallbackData::invokeCallback(vm, callback(), thisValue, args, callbackType, functionName, returnedException);
    }

    template<typename Visitor> void visitJSFunction(Visitor&);

private:
    class WeakOwner : public JSC::WeakHandleOwner {
        bool isReachableFromOpaqueRoots(JSC::Handle<JSC::Unknown>, void* context, JSC::AbstractSlotVisitor&, ASCIILiteral*) override;
    };
    WeakOwner m_weakOwner;
    JSC::Weak<JSC::JSObject> m_callback;
};

} // namespace WebCore
