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
#include "JSDOMPromise.h"

#include "JSDOMGlobalObject.h"
#include <JavaScriptCore/BuiltinNames.h>
#include <JavaScriptCore/TopExceptionScope.h>
#include <JavaScriptCore/Exception.h>
#include <JavaScriptCore/JSBoundFunction.h>
#include <JavaScriptCore/JSNativeStdFunction.h>
#include <JavaScriptCore/JSPromiseConstructor.h>
#include <JavaScriptCore/SourceCode.h>

using namespace JSC;

namespace WebCore {

auto DOMPromise::whenPromiseIsSettled(JSDOMGlobalObject* globalObject, JSC::JSObject* promise, Function<void()>&& callback) -> IsCallbackRegistered
{
    auto& lexicalGlobalObject = *globalObject;
    auto& vm = lexicalGlobalObject.vm();
    JSLockHolder lock(vm);
    auto* handler = JSC::JSNativeStdFunction::create(vm, globalObject, 1, String {}, [callback = WTF::move(callback)](JSGlobalObject*, CallFrame*) mutable {
        // Exchange callback so captured variables are deallocated immediately rather than waiting for GC of the handler.
        std::exchange(callback, {})();
        return JSC::JSValue::encode(JSC::jsUndefined());
    });

    // A native promise takes the reaction directly. `then` looks up the species
    // through the promise's `constructor`, which a script can define, so
    // calling it could run user code and throw here.
    if (auto* nativePromise = dynamicDowncast<JSC::JSPromise>(promise)) {
        nativePromise->performPromiseThen(vm, globalObject, handler, handler, JSC::jsUndefined());
        return IsCallbackRegistered::Yes;
    }

    auto scope = DECLARE_THROW_SCOPE(vm);
    const JSC::Identifier& privateName = vm.propertyNames->builtinNames().thenPrivateName();
    auto thenFunction = promise->get(&lexicalGlobalObject, privateName);

    EXCEPTION_ASSERT(!scope.exception() || vm.hasPendingTerminationException());
    RETURN_IF_EXCEPTION(scope, IsCallbackRegistered::No);

    ASSERT(thenFunction.isCallable());

    JSC::MarkedArgumentBuffer arguments;
    arguments.append(handler);
    arguments.append(handler);

    auto callData = JSC::getCallData(thenFunction);
    ASSERT(callData.type != JSC::CallData::Type::None);
    call(&lexicalGlobalObject, thenFunction, callData, promise, arguments);

    EXCEPTION_ASSERT(!scope.exception() || vm.hasPendingTerminationException());
    return scope.exception() ? IsCallbackRegistered::No : IsCallbackRegistered::Yes;
}

// https://github.com/WebKit/WebKit/blob/main/Source/WebCore/bindings/js/JSDOMPromise.cpp
auto DOMPromise::whenSettledWithResult(Function<void(JSDOMGlobalObject*, bool, JSC::JSValue)>&& callback) -> IsCallbackRegistered
{
    auto* globalObject = this->globalObject();
    if (!globalObject || isSuspended())
        return IsCallbackRegistered::No;
    auto& vm = globalObject->vm();
    JSLockHolder lock(vm);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* handler = JSC::JSNativeStdFunction::create(vm, globalObject, 1, String {}, [callback = WTF::move(callback)](JSGlobalObject* globalObject, CallFrame* callFrame) mutable {
        if (auto* promise = dynamicDowncast<JSC::JSPromise>(callFrame->thisValue()))
            std::exchange(callback, {})(uncheckedDowncast<JSDOMGlobalObject>(globalObject), promise->status() == JSC::JSPromise::Status::Fulfilled, promise->result());
        return JSC::JSValue::encode(JSC::jsUndefined());
    });
    RETURN_IF_EXCEPTION(scope, IsCallbackRegistered::No);

    auto* promise = this->promise();
    auto* thisHandler = JSC::JSBoundFunction::create(vm, globalObject, handler, promise, JSC::ArgList {}, 0, jsEmptyString(vm), JSC::makeSource("createWhenPromiseSettledFunction"_s, JSC::SourceOrigin(), JSC::SourceTaintedOrigin::Untainted));
    RETURN_IF_EXCEPTION(scope, IsCallbackRegistered::No);
    if (!thisHandler) [[unlikely]]
        return IsCallbackRegistered::No;

    promise->performPromiseThenExported(vm, globalObject, thisHandler, thisHandler, JSC::jsUndefined());
    RETURN_IF_EXCEPTION(scope, IsCallbackRegistered::No);
    return IsCallbackRegistered::Yes;
}

auto DOMPromise::whenFulfilled(JSC::JSPromise& derived, Function<JSC::JSValue(JSDOMGlobalObject&, JSC::JSValue)>&& reaction) -> IsCallbackRegistered
{
    auto* globalObject = this->globalObject();
    if (!globalObject || isSuspended())
        return IsCallbackRegistered::No;
    auto& vm = globalObject->vm();
    JSLockHolder lock(vm);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* handler = JSC::JSNativeStdFunction::create(vm, globalObject, 1, String {}, [reaction = WTF::move(reaction)](JSGlobalObject* globalObject, CallFrame* callFrame) mutable {
        return JSC::JSValue::encode(std::exchange(reaction, {})(*uncheckedDowncast<JSDOMGlobalObject>(globalObject), callFrame->argument(0)));
    });
    RETURN_IF_EXCEPTION(scope, IsCallbackRegistered::No);

    // No rejection handler: the rejection reaches `derived` unchanged.
    promise()->performPromiseThenExported(vm, globalObject, handler, JSC::jsUndefined(), &derived);
    RETURN_IF_EXCEPTION(scope, IsCallbackRegistered::No);
    return IsCallbackRegistered::Yes;
}

}
