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

#include "config.h"
#include "JSDOMPromiseDeferred.h"

// #include "DOMWindow.h"
// #include "EventLoop.h"
#include "JSDOMExceptionHandling.h"
#include "JSDOMPromise.h"
// #include "JSDOMWindow.h"
// #include "ScriptController.h"
// #include "WorkerGlobalScope.h"
#include <JavaScriptCore/BuiltinNames.h>
#include <JavaScriptCore/Exception.h>
#include <JavaScriptCore/JSONObject.h>
#include <JavaScriptCore/JSPromiseConstructor.h>
#include <JavaScriptCore/Strong.h>
#include "ErrorCode.h"
#include "JavaScriptCore/ErrorInstance.h"

namespace WebCore {
using namespace JSC;

JSC::JSValue DeferredPromise::promise() const
{
    if (isEmpty())
        return jsUndefined();

    ASSERT(deferred());
    return deferred();
}

void DeferredPromise::callFunction(JSGlobalObject& lexicalGlobalObject, ResolveMode mode, JSValue resolution)
{
    if (shouldIgnoreRequestToFulfill())
        return;

    // if (activeDOMObjectsAreSuspended()) {
    //     JSC::Strong<JSC::Unknown, ShouldStrongDestructorGrabLock::Yes> strongResolution(lexicalGlobalObject.vm(), resolution);
    //     ASSERT(scriptExecutionContext()->eventLoop().isSuspended());
    //     scriptExecutionContext()->eventLoop().queueTask(TaskSource::Networking, [this, protectedThis = Ref { *this }, mode, strongResolution = WTF::move(strongResolution)]() mutable {
    //         if (shouldIgnoreRequestToFulfill())
    //             return;

    //         JSC::JSGlobalObject* lexicalGlobalObject = globalObject();
    //         JSC::JSLockHolder locker(lexicalGlobalObject);
    //         callFunction(*globalObject(), mode, strongResolution.get());
    //     });
    //     return;
    // }

    // FIXME: We could have error since any JS call can throw stack-overflow errors.
    // https://bugs.webkit.org/show_bug.cgi?id=203402
    auto& vm = lexicalGlobalObject.vm();
    switch (mode) {
    case ResolveMode::Resolve:
        deferred()->resolve(&lexicalGlobalObject, resolution);
        break;
    case ResolveMode::Reject:
        deferred()->reject(vm, &lexicalGlobalObject, resolution);
        break;
    case ResolveMode::RejectAsHandled:
        deferred()->rejectAsHandled(vm, &lexicalGlobalObject, resolution);
        break;
    }

    if (m_mode == Mode::ClearPromiseOnResolve)
        clear();
}

void DeferredPromise::whenSettled(Function<void()>&& callback)
{
    if (shouldIgnoreRequestToFulfill())
        return;

    // if (activeDOMObjectsAreSuspended()) {
    //     scriptExecutionContext()->eventLoop().queueTask(TaskSource::Networking, [this, protectedThis = Ref { *this }, callback = WTF::move(callback)]() mutable {
    //         whenSettled(WTF::move(callback));
    //     });
    //     return;
    // }

    DOMPromise::whenPromiseIsSettled(globalObject(), deferred(), WTF::move(callback));
}

void DeferredPromise::reject(RejectAsHandled rejectAsHandled)
{
    if (shouldIgnoreRequestToFulfill())
        return;

    ASSERT(deferred());
    ASSERT(m_globalObject);
    auto& lexicalGlobalObject = *m_globalObject;
    JSC::JSLockHolder locker(&lexicalGlobalObject);
    reject(lexicalGlobalObject, JSC::jsUndefined(), rejectAsHandled);
}

void DeferredPromise::reject(JSC::JSValue value, RejectAsHandled rejectAsHandled)
{
    if (shouldIgnoreRequestToFulfill())
        return;
    ASSERT(deferred());
    ASSERT(m_globalObject);
    auto& lexicalGlobalObject = *m_globalObject;
    JSC::JSLockHolder locker(&lexicalGlobalObject);
    reject(lexicalGlobalObject, value, rejectAsHandled);
}

void DeferredPromise::reject(std::nullptr_t, RejectAsHandled rejectAsHandled)
{
    if (shouldIgnoreRequestToFulfill())
        return;

    ASSERT(deferred());
    ASSERT(m_globalObject);
    auto& lexicalGlobalObject = *m_globalObject;
    JSC::JSLockHolder locker(&lexicalGlobalObject);
    reject(lexicalGlobalObject, JSC::jsNull(), rejectAsHandled);
}

void DeferredPromise::reject(Exception exception, RejectAsHandled rejectAsHandled)
{
    if (shouldIgnoreRequestToFulfill())
        return;

    Ref protectedThis(*this);
    ASSERT(deferred());
    ASSERT(m_globalObject);
    auto& lexicalGlobalObject = *m_globalObject;
    JSC::VM& vm = lexicalGlobalObject.vm();
    JSC::JSLockHolder locker(vm);
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);

    if (exception.code() == ExistingExceptionError) {
        EXCEPTION_ASSERT(scope.exception());
        auto error = scope.exception()->value();
        bool isTerminating = handleTerminationExceptionIfNeeded(scope, lexicalGlobalObject);
        (void)scope.tryClearException();

        if (!isTerminating)
            reject<IDLAny>(error, rejectAsHandled);
        return;
    }

    auto error = createDOMException(lexicalGlobalObject, WTF::move(exception));
    if (scope.exception()) [[unlikely]] {
        handleUncaughtException(scope, lexicalGlobalObject);
        return;
    }

    reject(lexicalGlobalObject, error, rejectAsHandled);
    if (scope.exception()) [[unlikely]]
        handleUncaughtException(scope, lexicalGlobalObject);
}

void DeferredPromise::reject(ExceptionCode ec, const String& message, RejectAsHandled rejectAsHandled)
{
    if (shouldIgnoreRequestToFulfill())
        return;

    Ref protectedThis(*this);
    ASSERT(deferred());
    ASSERT(m_globalObject);
    auto& lexicalGlobalObject = *m_globalObject;
    JSC::VM& vm = lexicalGlobalObject.vm();
    JSC::JSLockHolder locker(vm);
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);

    if (ec == ExistingExceptionError) {
        EXCEPTION_ASSERT(scope.exception());
        auto error = scope.exception()->value();
        bool isTerminating = handleTerminationExceptionIfNeeded(scope, lexicalGlobalObject);
        (void)scope.tryClearException();

        if (!isTerminating)
            reject<IDLAny>(error, rejectAsHandled);
        return;
    }

    auto error = createDOMException(&lexicalGlobalObject, ec, message);
    if (scope.exception()) [[unlikely]] {
        handleUncaughtException(scope, lexicalGlobalObject);
        return;
    }

    reject(lexicalGlobalObject, error, rejectAsHandled);
    if (scope.exception()) [[unlikely]]
        handleUncaughtException(scope, lexicalGlobalObject);
}

void DeferredPromise::reject(const JSC::PrivateName& privateName, RejectAsHandled rejectAsHandled)
{
    if (shouldIgnoreRequestToFulfill())
        return;

    ASSERT(deferred());
    ASSERT(m_globalObject);
    JSC::JSGlobalObject* lexicalGlobalObject = m_globalObject.get();
    JSC::JSLockHolder locker(lexicalGlobalObject);
    reject(*lexicalGlobalObject, JSC::Symbol::create(lexicalGlobalObject->vm(), privateName.uid()), rejectAsHandled);
}

void rejectPromiseWithExceptionIfAny(JSC::JSGlobalObject& lexicalGlobalObject, JSDOMGlobalObject& globalObject, JSPromise& promise, JSC::TopExceptionScope& topExceptionScope)
{
    UNUSED_PARAM(lexicalGlobalObject);
    if (!topExceptionScope.exception()) [[likely]]
        return;

    JSValue error = topExceptionScope.exception()->value();
    (void)topExceptionScope.tryClearException();

    DeferredPromise::create(globalObject, promise)->reject<IDLAny>(error);
}

JSC::EncodedJSValue createRejectedPromiseWithTypeError(JSC::JSGlobalObject& lexicalGlobalObject, const String& errorMessage, RejectedPromiseWithTypeErrorCause cause)
{
    auto& vm = lexicalGlobalObject.vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    ErrorInstance* rejectionValue = static_cast<ErrorInstance*>(cause == RejectedPromiseWithTypeErrorCause::InvalidThis ? Bun::createInvalidThisError(&lexicalGlobalObject, errorMessage) : createTypeError(&lexicalGlobalObject, errorMessage));
    if (cause == RejectedPromiseWithTypeErrorCause::NativeGetter)
        rejectionValue->setNativeGetterTypeError();

    RELEASE_AND_RETURN(scope, JSValue::encode(JSC::JSPromise::rejectedPromise(&lexicalGlobalObject, rejectionValue)));
}

static inline JSC::JSValue parseAsJSON(JSC::JSGlobalObject* lexicalGlobalObject, const String& data)
{
    JSC::JSLockHolder lock(lexicalGlobalObject);
    return JSC::JSONParse(lexicalGlobalObject, data);
}

void fulfillPromiseWithJSON(Ref<DeferredPromise>&& promise, const String& data)
{
    JSC::JSValue value = parseAsJSON(promise->globalObject(), data);
    if (!value)
        promise->reject(SyntaxError);
    else
        promise->resolve<IDLAny>(value);
}

void fulfillPromiseWithArrayBuffer(Ref<DeferredPromise>&& promise, ArrayBuffer* arrayBuffer)
{
    if (!arrayBuffer) {
        promise->reject<IDLAny>(createOutOfMemoryError(promise->globalObject()));
        return;
    }
    promise->resolve<IDLInterface<ArrayBuffer>>(*arrayBuffer);
}

void fulfillPromiseWithArrayBuffer(Ref<DeferredPromise>&& promise, const void* data, size_t length)
{
    fulfillPromiseWithArrayBuffer(WTF::move(promise), ArrayBuffer::tryCreate({ reinterpret_cast<const uint8_t*>(data), length }).get());
}

bool DeferredPromise::handleTerminationExceptionIfNeeded(TopExceptionScope& scope, JSDOMGlobalObject& lexicalGlobalObject)
{
    auto* exception = scope.exception();
    VM& vm = scope.vm();

    return !!exception && vm.isTerminationException(exception);
}

void DeferredPromise::handleUncaughtException(TopExceptionScope& scope, JSDOMGlobalObject& lexicalGlobalObject)
{
    auto* exception = scope.exception();
    handleTerminationExceptionIfNeeded(scope, lexicalGlobalObject);
    reportException(&lexicalGlobalObject, exception);
};

} // namespace WebCore
