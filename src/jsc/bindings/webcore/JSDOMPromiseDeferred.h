/*
 * Copyright (C) 2013-2021 Apple Inc. All rights reserved.
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

#include "ExceptionOr.h"
#include "JSDOMConvert.h"
#include "JSDOMGuardedObject.h"
#include "ScriptExecutionContext.h"
#include <JavaScriptCore/TopExceptionScope.h>
#include <JavaScriptCore/JSPromise.h>

namespace WebCore {

class JSDOMWindow;
enum class RejectAsHandled : uint8_t { No,
    Yes };

#define DEFERRED_PROMISE_HANDLE_AND_RETURN_IF_EXCEPTION(scope, globalObject)                     \
    do {                                                                                         \
        if (scope.exception()) [[unlikely]] {                                                    \
            handleUncaughtException(scope, *uncheckedDowncast<JSDOMGlobalObject>(globalObject)); \
            return;                                                                              \
        }                                                                                        \
    } while (false)

class DeferredPromise : public DOMGuarded<JSC::JSPromise> {
public:
    enum class Mode {
        ClearPromiseOnResolve,
        RetainPromiseOnResolve
    };

    static RefPtr<DeferredPromise> create(JSDOMGlobalObject& globalObject, Mode mode = Mode::ClearPromiseOnResolve)
    {
        auto& vm = JSC::getVM(&globalObject);
        auto* promise = JSC::JSPromise::create(vm, globalObject.promiseStructure());
        ASSERT(promise);
        return adoptRef(new DeferredPromise(globalObject, *promise, mode));
    }

    static Ref<DeferredPromise> create(JSDOMGlobalObject& globalObject, JSC::JSPromise& deferred, Mode mode = Mode::ClearPromiseOnResolve)
    {
        return adoptRef(*new DeferredPromise(globalObject, deferred, mode));
    }

    template<class IDLType>
    void resolve(typename IDLType::ParameterType value)
    {
        if (shouldIgnoreRequestToFulfill())
            return;

        ASSERT(deferred());
        ASSERT(globalObject());
        JSC::JSGlobalObject* lexicalGlobalObject = globalObject();
        auto& vm = lexicalGlobalObject->vm();
        JSC::JSLockHolder locker(vm);
        auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
        auto value_js = toJS<IDLType>(*lexicalGlobalObject, *globalObject(), std::forward<typename IDLType::ParameterType>(value));
        DEFERRED_PROMISE_HANDLE_AND_RETURN_IF_EXCEPTION(scope, lexicalGlobalObject);
        resolve(*lexicalGlobalObject, value_js);
        DEFERRED_PROMISE_HANDLE_AND_RETURN_IF_EXCEPTION(scope, lexicalGlobalObject);
    }

    void resolve()
    {
        if (shouldIgnoreRequestToFulfill())
            return;

        ASSERT(deferred());
        ASSERT(globalObject());
        JSC::JSGlobalObject* lexicalGlobalObject = globalObject();
        JSC::JSLockHolder locker(lexicalGlobalObject);
        resolve(*lexicalGlobalObject, JSC::jsUndefined());
    }

    template<class IDLType>
    void reject(typename IDLType::ParameterType value, RejectAsHandled rejectAsHandled = RejectAsHandled::No)
    {
        if (shouldIgnoreRequestToFulfill())
            return;

        ASSERT(deferred());
        ASSERT(globalObject());
        JSC::JSGlobalObject* lexicalGlobalObject = globalObject();
        auto& vm = lexicalGlobalObject->vm();
        JSC::JSLockHolder locker(vm);
        auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
        auto value_js = toJS<IDLType>(*lexicalGlobalObject, *globalObject(), std::forward<typename IDLType::ParameterType>(value));
        DEFERRED_PROMISE_HANDLE_AND_RETURN_IF_EXCEPTION(scope, lexicalGlobalObject);
        reject(*lexicalGlobalObject, value_js, rejectAsHandled);
    }

    WEBCORE_EXPORT void reject(Exception, RejectAsHandled = RejectAsHandled::No);
    WEBCORE_EXPORT void reject(ExceptionCode, const String& = {}, RejectAsHandled = RejectAsHandled::No);

    template<typename Callback>
    void resolveWithCallback(Callback callback)
    {
        if (shouldIgnoreRequestToFulfill())
            return;

        ASSERT(deferred());
        ASSERT(globalObject());
        JSC::JSGlobalObject* lexicalGlobalObject = globalObject();
        auto& vm = lexicalGlobalObject->vm();
        JSC::JSLockHolder locker(vm);
        auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
        auto value_js = callback(*globalObject());
        DEFERRED_PROMISE_HANDLE_AND_RETURN_IF_EXCEPTION(scope, lexicalGlobalObject);
        resolve(*lexicalGlobalObject, value_js);
    }

    template<typename Callback>
    void rejectWithCallback(Callback callback, RejectAsHandled rejectAsHandled = RejectAsHandled::No)
    {
        if (shouldIgnoreRequestToFulfill())
            return;

        ASSERT(deferred());
        ASSERT(globalObject());
        JSC::JSGlobalObject* lexicalGlobalObject = globalObject();
        auto& vm = lexicalGlobalObject->vm();
        JSC::JSLockHolder locker(vm);
        auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
        auto value_js = callback(*globalObject());
        DEFERRED_PROMISE_HANDLE_AND_RETURN_IF_EXCEPTION(scope, lexicalGlobalObject);
        reject(*lexicalGlobalObject, value_js, rejectAsHandled);
    }

private:
    DeferredPromise(JSDOMGlobalObject& globalObject, JSC::JSPromise& deferred, Mode mode)
        : DOMGuarded<JSC::JSPromise>(globalObject, deferred)
        , m_mode(mode)
    {
    }

    bool shouldIgnoreRequestToFulfill() const { return isEmpty(); }

    JSC::JSPromise* deferred() const { return guarded(); }

    enum class ResolveMode { Resolve,
        Reject,
        RejectAsHandled };
    WEBCORE_EXPORT void callFunction(JSC::JSGlobalObject&, ResolveMode, JSC::JSValue resolution);

    void resolve(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue resolution) { callFunction(lexicalGlobalObject, ResolveMode::Resolve, resolution); }
    void reject(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue resolution, RejectAsHandled rejectAsHandled)
    {
        callFunction(lexicalGlobalObject, rejectAsHandled == RejectAsHandled::Yes ? ResolveMode::RejectAsHandled : ResolveMode::Reject, resolution);
    }

    bool handleTerminationExceptionIfNeeded(JSC::TopExceptionScope&, JSDOMGlobalObject& lexicalGlobalObject);
    void handleUncaughtException(JSC::TopExceptionScope&, JSDOMGlobalObject& lexicalGlobalObject);

    Mode m_mode;
};

void fulfillPromiseWithArrayBuffer(Ref<DeferredPromise>&&, ArrayBuffer*);
void fulfillPromiseWithArrayBuffer(Ref<DeferredPromise>&&, const void*, size_t);
WEBCORE_EXPORT void rejectPromiseWithExceptionIfAny(JSC::JSGlobalObject&, JSDOMGlobalObject&, JSC::JSPromise&, JSC::TopExceptionScope&);

enum class RejectedPromiseWithTypeErrorCause { NativeGetter,
    InvalidThis };
JSC::EncodedJSValue createRejectedPromiseWithTypeError(JSC::JSGlobalObject&, const String&, RejectedPromiseWithTypeErrorCause);

template<typename PromiseFunctor>
inline JSC::JSValue callPromiseFunction(JSC::JSGlobalObject& lexicalGlobalObject, JSC::CallFrame& callFrame, PromiseFunctor functor)
{
    auto& vm = JSC::getVM(&lexicalGlobalObject);
    auto topExceptionScope = DECLARE_TOP_EXCEPTION_SCOPE(vm);

    auto& globalObject = *downcast<JSDOMGlobalObject>(&lexicalGlobalObject);
    auto* promise = JSC::JSPromise::create(vm, globalObject.promiseStructure());
    ASSERT(promise);

    functor(lexicalGlobalObject, callFrame, DeferredPromise::create(globalObject, *promise));

    rejectPromiseWithExceptionIfAny(lexicalGlobalObject, globalObject, *promise, topExceptionScope);
    // FIXME: We could have error since any JS call can throw stack-overflow errors.
    // https://bugs.webkit.org/show_bug.cgi?id=203402
    RETURN_IF_EXCEPTION(topExceptionScope, JSC::jsUndefined());
    return promise;
}

} // namespace WebCore
