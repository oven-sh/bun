/*
 * Copyright (C) 2019-2021 Apple Inc. All rights reserved.
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
 */

#include "config.h"
#include "JSDOMSetLike.h"

#include "WebCoreJSClientData.h"
#include <JavaScriptCore/JSNativeStdFunction.h>
#include <JavaScriptCore/JSObjectInlines.h>
#include <JavaScriptCore/JSSet.h>
#include <JavaScriptCore/JSSetInlines.h>
#include <JavaScriptCore/TopExceptionScope.h>
#include <JavaScriptCore/VMTrapsInlines.h>

namespace WebCore {

void DOMSetAdapter::clear()
{
    clearBackingSet(m_lexicalGlobalObject, m_backingSet);
}

std::pair<bool, std::reference_wrapper<JSC::JSObject>> getBackingSet(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSObject& setLike)
{
    auto& vm = lexicalGlobalObject.vm();
    auto backingSet = setLike.getDirect(vm, builtinNames(vm).backingSetPrivateName());
    if (!backingSet) {
        auto& vm = lexicalGlobalObject.vm();
        backingSet = JSC::JSSet::create(vm, lexicalGlobalObject.setStructure());
        setLike.putDirect(vm, builtinNames(vm).backingSetPrivateName(), backingSet, std::to_underlying(JSC::PropertyAttribute::DontEnum));
        return { true, *JSC::asObject(backingSet) };
    }
    return { false, *JSC::asObject(backingSet) };
}

void clearBackingSet(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSObject& backingSet)
{
    auto& vm = JSC::getVM(&lexicalGlobalObject);
    auto function = lexicalGlobalObject.jsSetPrototype()->getDirect(vm, vm.propertyNames->builtinNames().clearPrivateName());
    ASSERT(function);

    auto callData = JSC::getCallData(function);
    ASSERT(callData.type != JSC::CallData::Type::None);
    JSC::MarkedArgumentBuffer arguments;
    JSC::call(&lexicalGlobalObject, function, callData, &backingSet, arguments);
}

void addToBackingSet(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSObject& backingSet, JSC::JSValue item)
{
    auto& vm = JSC::getVM(&lexicalGlobalObject);
    auto function = lexicalGlobalObject.jsSetPrototype()->getDirect(vm, vm.propertyNames->builtinNames().addPrivateName());
    ASSERT(function);

    auto callData = JSC::getCallData(function);
    ASSERT(callData.type != JSC::CallData::Type::None);
    JSC::MarkedArgumentBuffer arguments;
    arguments.append(item);
    ASSERT(!arguments.hasOverflowed());
    JSC::call(&lexicalGlobalObject, function, callData, &backingSet, arguments);
}

JSC::JSValue forwardAttributeGetterToBackingSet(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSObject& backingSet, const JSC::Identifier& attributeName)
{
    return backingSet.get(&lexicalGlobalObject, attributeName);
}

JSC::JSValue forwardFunctionCallToBackingSet(JSC::JSGlobalObject& lexicalGlobalObject, JSC::CallFrame& callFrame, JSC::JSObject& backingSet, const JSC::Identifier& functionName)
{
    auto& vm = JSC::getVM(&lexicalGlobalObject);
    auto function = lexicalGlobalObject.jsSetPrototype()->getDirect(vm, functionName);
    ASSERT(function);

    auto callData = JSC::getCallData(function);
    ASSERT(callData.type != JSC::CallData::Type::None);
    JSC::MarkedArgumentBuffer arguments;
    arguments.ensureCapacity(callFrame.argumentCount());
    for (size_t cptr = 0; cptr < callFrame.argumentCount(); ++cptr)
        arguments.append(callFrame.uncheckedArgument(cptr));
    ASSERT(!arguments.hasOverflowed());
    return JSC::call(&lexicalGlobalObject, function, callData, &backingSet, arguments);
}

// WebKit implements this with the forEachWrapper JS builtin from JSDOMBindingInternals.js,
// which bun does not bundle; the same wrapper is built here as a native function instead.
JSC::JSValue forwardForEachCallToBackingSet(JSDOMGlobalObject& globalObject, JSC::CallFrame& callFrame, JSC::JSObject& setLike)
{
    auto result = getBackingSet(globalObject, setLike);
    ASSERT(!result.first);

    auto& vm = JSC::getVM(&globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto callback = callFrame.argument(0);
    auto callbackCallData = JSC::getCallData(callback);
    if (callbackCallData.type == JSC::CallData::Type::None)
        return JSC::throwTypeError(&globalObject, scope);

    JSC::JSValue setLikeValue(&setLike);
    auto* wrapper = JSC::JSNativeStdFunction::create(
        vm, &globalObject, 2, String(),
        [callback, callbackCallData, setLikeValue](JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* wrapperCallFrame) -> JSC::EncodedJSValue {
            JSC::MarkedArgumentBuffer arguments;
            arguments.append(wrapperCallFrame->argument(0));
            arguments.append(wrapperCallFrame->argument(1));
            arguments.append(setLikeValue);
            ASSERT(!arguments.hasOverflowed());
            return JSC::JSValue::encode(JSC::call(lexicalGlobalObject, callback, callbackCallData, JSC::jsUndefined(), arguments));
        },
        callback, setLikeValue);

    auto function = globalObject.jsSetPrototype()->getDirect(vm, vm.propertyNames->builtinNames().forEachPrivateName());
    ASSERT(function);

    auto callData = JSC::getCallData(function);
    ASSERT(callData.type != JSC::CallData::Type::None);

    JSC::MarkedArgumentBuffer arguments;
    arguments.append(wrapper);
    ASSERT(!arguments.hasOverflowed());
    RELEASE_AND_RETURN(scope, JSC::call(&globalObject, function, callData, &result.second.get(), arguments));
}

}
