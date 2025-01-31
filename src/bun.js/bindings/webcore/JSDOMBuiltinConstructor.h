/*
 *  Copyright (C) 2015, 2016 Canon Inc. All rights reserved.
 *  Copyright (C) 2016-2021 Apple Inc. All rights reserved.
 *
 *  This library is free software; you can redistribute it and/or
 *  modify it under the terms of the GNU Lesser General Public
 *  License as published by the Free Software Foundation; either
 *  version 2 of the License, or (at your option) any later version.
 *
 *  This library is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 *  Lesser General Public License for more details.
 *
 *  You should have received a copy of the GNU Lesser General Public
 *  License along with this library; if not, write to the Free Software
 *  Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301  USA
 */

#pragma once

#include "JSDOMBuiltinConstructorBase.h"
#include "JSDOMExceptionHandling.h"
#include "JSDOMWrapperCache.h"

namespace WebCore {

template<typename JSClass> class JSDOMBuiltinConstructor final : public JSDOMBuiltinConstructorBase {
public:
    using Base = JSDOMBuiltinConstructorBase;

    static JSDOMBuiltinConstructor* create(JSC::VM&, JSC::Structure*, JSDOMGlobalObject&);
    static JSC::Structure* createStructure(JSC::VM&, JSC::JSGlobalObject&, JSC::JSValue prototype);

    DECLARE_INFO;

    // Usually defined for each specialization class.
    static JSC::JSValue prototypeForStructure(JSC::VM&, const JSDOMGlobalObject&);

    static JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES construct(JSC::JSGlobalObject*, JSC::CallFrame*);
    static JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES call(JSC::JSGlobalObject*, JSC::CallFrame*);

private:
    JSDOMBuiltinConstructor(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure, construct, call)
    {
    }

    void finishCreation(JSC::VM&, JSDOMGlobalObject&);

    JSC::Structure* getDOMStructureForJSObject(JSC::JSGlobalObject*, JSC::JSObject* newTarget);

    // Usually defined for each specialization class.
    void initializeProperties(JSC::VM&, JSDOMGlobalObject&) {}
    // Must be defined for each specialization class.
    JSC::FunctionExecutable* initializeExecutable(JSC::VM&);
};

template<typename JSClass> inline JSDOMBuiltinConstructor<JSClass>* JSDOMBuiltinConstructor<JSClass>::create(JSC::VM& vm, JSC::Structure* structure, JSDOMGlobalObject& globalObject)
{
    JSDOMBuiltinConstructor* constructor = new (NotNull, JSC::allocateCell<JSDOMBuiltinConstructor>(vm)) JSDOMBuiltinConstructor(vm, structure);
    constructor->finishCreation(vm, globalObject);
    return constructor;
}

template<typename JSClass> inline JSC::Structure* JSDOMBuiltinConstructor<JSClass>::createStructure(JSC::VM& vm, JSC::JSGlobalObject& globalObject, JSC::JSValue prototype)
{
    return JSC::Structure::create(vm, &globalObject, prototype, JSC::TypeInfo(JSC::InternalFunctionType, StructureFlags), info());
}

template<typename JSClass> inline void JSDOMBuiltinConstructor<JSClass>::finishCreation(JSC::VM& vm, JSDOMGlobalObject& globalObject)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
    setInitializeFunction(vm, *JSC::JSFunction::create(vm, &globalObject, initializeExecutable(vm), &globalObject));
    initializeProperties(vm, globalObject);
}

template<typename JSClass> inline JSC::Structure* JSDOMBuiltinConstructor<JSClass>::getDOMStructureForJSObject(JSC::JSGlobalObject* lexicalGlobalObject, JSC::JSObject* newTarget)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);

    if (LIKELY(newTarget == this))
        return getDOMStructure<JSClass>(vm, *globalObject());

    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* newTargetGlobalObject = JSC::getFunctionRealm(lexicalGlobalObject, newTarget);
    RETURN_IF_EXCEPTION(scope, nullptr);
    auto* baseStructure = getDOMStructure<JSClass>(vm, *JSC::jsCast<JSDOMGlobalObject*>(newTargetGlobalObject));
    RELEASE_AND_RETURN(scope, JSC::InternalFunction::createSubclassStructure(lexicalGlobalObject, newTarget, baseStructure));
}

template<typename JSClass> inline JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES JSDOMBuiltinConstructor<JSClass>::call(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame)
{
    ASSERT(callFrame);
    auto* castedThis = JSC::jsCast<JSDOMBuiltinConstructor*>(callFrame->jsCallee());
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (callFrame->thisValue() != castedThis) {
        throwTypeError(lexicalGlobalObject, scope, "Constructor called as a function"_s);
        return {};
    }
    auto* structure = castedThis->getDOMStructureForJSObject(lexicalGlobalObject, asObject(callFrame->thisValue()));
    if (UNLIKELY(!structure))
        return {};

    auto* jsObject = JSClass::create(structure, castedThis->globalObject());
    JSC::call(lexicalGlobalObject, castedThis->initializeFunction(), jsObject, JSC::ArgList(callFrame), "This error should never occur: initialize function is guaranteed to be callable."_s);
    return JSC::JSValue::encode(jsObject);
}

template<typename JSClass> inline JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES JSDOMBuiltinConstructor<JSClass>::construct(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame)
{
    ASSERT(callFrame);
    auto* castedThis = JSC::jsCast<JSDOMBuiltinConstructor*>(callFrame->jsCallee());
    auto* structure = castedThis->getDOMStructureForJSObject(lexicalGlobalObject, asObject(callFrame->newTarget()));
    if (UNLIKELY(!structure))
        return {};

    auto* jsObject = JSClass::create(structure, castedThis->globalObject());
    JSC::call(lexicalGlobalObject, castedThis->initializeFunction(), jsObject, JSC::ArgList(callFrame), "This error should never occur: initialize function is guaranteed to be callable."_s);
    return JSC::JSValue::encode(jsObject);
}

} // namespace WebCore
