/*
 * Copyright (C) 2026 Apple Inc. All rights reserved.
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
#include "JSDOMBindingFacade.h"

#include <JavaScriptCore/ArgList.h>
#include <JavaScriptCore/IteratorOperations.h>
#include <JavaScriptCore/JSArrayInlines.h>
#include <JavaScriptCore/JSBoundFunction.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/SourceCode.h>

namespace WebCore {

bool putDirect(JSC::JSObject* object, JSC::VM& vm, JSC::PropertyName propertyName, JSC::JSValue value, unsigned attributes)
{
    return object->putDirect(vm, propertyName, value, attributes);
}

void putDirectWithoutTransition(JSC::JSObject* object, JSC::VM& vm, JSC::PropertyName propertyName, JSC::JSValue value, unsigned attributes)
{
    object->putDirectWithoutTransition(vm, propertyName, value, attributes);
}

JSC::JSValue get(const JSC::JSObject* object, JSC::JSGlobalObject* globalObject, JSC::PropertyName propertyName)
{
    return object->get(globalObject, propertyName);
}

JSC::JSValue getDirect(const JSC::JSObject* object, JSC::VM& vm, JSC::PropertyName propertyName)
{
    return object->getDirect(vm, propertyName);
}

bool getOwnPropertySlot(JSC::JSObject* object, JSC::JSGlobalObject* globalObject, JSC::PropertyName propertyName, JSC::PropertySlot& slot)
{
    return JSC::JSObject::getOwnPropertySlot(object, globalObject, propertyName, slot);
}

bool getPropertySlot(JSC::JSObject* object, JSC::JSGlobalObject* globalObject, JSC::PropertyName propertyName, JSC::PropertySlot& slot)
{
    return object->getPropertySlot(globalObject, propertyName, slot);
}

bool getPropertySlot(JSC::JSObject* object, JSC::JSGlobalObject* globalObject, unsigned index, JSC::PropertySlot& slot)
{
    return object->getPropertySlot(globalObject, index, slot);
}

bool getNonIndexPropertySlot(JSC::JSObject* object, JSC::JSGlobalObject* globalObject, JSC::PropertyName propertyName, JSC::PropertySlot& slot)
{
    return object->getNonIndexPropertySlot(globalObject, propertyName, slot);
}

bool createDataProperty(JSC::JSObject* object, JSC::JSGlobalObject* globalObject, JSC::PropertyName propertyName, JSC::JSValue value, bool shouldThrow)
{
    return object->createDataProperty(globalObject, propertyName, value, shouldThrow);
}

JSC::JSObject* constructEmptyObject(JSC::JSGlobalObject* globalObject, JSC::Structure* structure)
{
    return JSC::constructEmptyObject(globalObject->vm(), structure);
}

JSC::PropertyOffset structureGet(JSC::Structure* structure, JSC::VM& vm, JSC::PropertyName propertyName)
{
    return structure->get(vm, propertyName);
}

JSC::JSValue storedPrototype(JSC::Structure* structure, const JSC::JSObject* object)
{
    return structure->storedPrototype(object);
}

JSC::JSObject* storedPrototypeObject(JSC::Structure* structure)
{
    return structure->storedPrototypeObject();
}

JSC::JSValue arrayGetDirectIndex(JSC::JSArray* array, JSC::JSGlobalObject* globalObject, unsigned index)
{
    return array->getDirectIndex(globalObject, index);
}

bool isIteratorProtocolFastAndNonObservable(JSC::JSArray* array)
{
    return array->isIteratorProtocolFastAndNonObservable();
}

JSC::JSArray* constructArray(JSC::JSGlobalObject* globalObject, const JSC::ArgList& values)
{
    return JSC::constructArray(globalObject, static_cast<JSC::ArrayAllocationProfile*>(nullptr), values);
}

JSC::JSArray* constructArray(JSC::JSGlobalObject* globalObject, const JSC::JSValue* values, unsigned length)
{
    return JSC::constructArray(globalObject, static_cast<JSC::ArrayAllocationProfile*>(nullptr), values, length);
}

JSC::JSArray* tryGetFastIterableJSArray(JSC::JSGlobalObject& globalObject, JSC::JSValue value)
{
    if (!value.isObject())
        return nullptr;
    auto* object = JSC::asObject(value);
    if (!JSC::isJSArray(object))
        return nullptr;
    auto* array = JSC::asArray(object);
    if (!array->isIteratorProtocolFastAndNonObservable())
        return nullptr;
    UNUSED_PARAM(globalObject);
    return array;
}

void forEachInContiguousJSArray(JSC::JSGlobalObject& globalObject, JSC::JSArray* array, NOESCAPE const ScopedLambda<void(JSC::JSValue)>& callback)
{
    auto& vm = JSC::getVM(&globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    unsigned length = array->length();
    JSC::IndexingType indexingType = array->indexingType() & JSC::IndexingShapeMask;
    if (indexingType == JSC::ContiguousShape) {
        for (unsigned i = 0; i < length; ++i) {
            auto indexValue = array->butterfly()->contiguous().at(array, i).get();
            callback(indexValue ? indexValue : JSC::jsUndefined());
            RETURN_IF_EXCEPTION(scope, void());
        }
        return;
    }
    for (unsigned i = 0; i < length; ++i) {
        auto indexValue = array->getDirectIndex(&globalObject, i);
        RETURN_IF_EXCEPTION(scope, void());
        callback(indexValue ? indexValue : JSC::jsUndefined());
        RETURN_IF_EXCEPTION(scope, void());
    }
}

void forEachInIterable(JSC::JSGlobalObject* globalObject, JSC::JSValue iterable, NOESCAPE const ScopedLambda<void(JSC::VM&, JSC::JSGlobalObject*, JSC::JSValue)>& callback)
{
    JSC::forEachInIterable(globalObject, iterable, callback);
}

void forEachInIterable(JSC::JSGlobalObject& globalObject, JSC::JSObject* iterable, JSC::JSValue method, NOESCAPE const ScopedLambda<void(JSC::VM&, JSC::JSGlobalObject&, JSC::JSValue)>& callback)
{
    JSC::forEachInIterable(globalObject, iterable, method, callback);
}

JSC::JSArray* constructArray(JSC::JSGlobalObject& globalObject, size_t count, NOESCAPE const ScopedLambda<JSC::JSValue(size_t)>& elementCallback)
{
    auto& vm = JSC::getVM(&globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSC::MarkedArgumentBuffer list;
    list.ensureCapacity(count);
    for (size_t i = 0; i < count; ++i) {
        list.append(elementCallback(i));
        RETURN_IF_EXCEPTION(scope, nullptr);
    }
    if (list.hasOverflowed()) [[unlikely]] {
        JSC::throwOutOfMemoryError(&globalObject, scope);
        return nullptr;
    }
    RELEASE_AND_RETURN(scope, JSC::constructArray(&globalObject, static_cast<JSC::ArrayAllocationProfile*>(nullptr), list));
}

JSC::JSValue freezeObject(JSC::JSGlobalObject& globalObject, JSC::JSObject* object)
{
    return JSC::objectConstructorFreeze(&globalObject, object);
}

JSC::JSBoundFunction* createBoundFunction(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSObject* target, JSC::JSValue boundThis, JSC::ArgList boundArgs, double length, ASCIILiteral sourceName)
{
    return JSC::JSBoundFunction::create(vm, globalObject, target, boundThis, boundArgs, length, JSC::jsEmptyString(vm), JSC::makeSource(sourceName, JSC::SourceOrigin(), JSC::SourceTaintedOrigin::Untainted));
}

} // namespace WebCore
