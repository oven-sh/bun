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

#pragma once

// API facade in front of JSC that avoids including expensive JSC headers.

#include <JavaScriptCore/GetVM.h>
#include <JavaScriptCore/HeapInlines.h>
#include <JavaScriptCore/IdentifierInlines.h>
#include <JavaScriptCore/IndexingType.h>
#include <JavaScriptCore/IteratorOperations.h>
#include <JavaScriptCore/JSCJSValue.h>
#include <JavaScriptCore/JSCJSValueInlines.h>
#include <JavaScriptCore/JSCell.h>
#include <JavaScriptCore/JSCellInlines.h>
#include <JavaScriptCore/JSObjectInlines.h>
#include <JavaScriptCore/JSTypeInfo.h>
#include <JavaScriptCore/Lookup.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/PropertyName.h>
#include <JavaScriptCore/SlotVisitorInlines.h>
#include <JavaScriptCore/StrongInlines.h>
#include <JavaScriptCore/StructureCreateInlines.h>
#include <JavaScriptCore/StructureInlinesLight.h>
#include <JavaScriptCore/ThrowScope.h>
#include <JavaScriptCore/WriteBarrierInlines.h>
#include <wtf/Forward.h>
#include <wtf/ScopedLambda.h>

namespace JSC {
class ArgList;
class Identifier;
class JSArray;
class JSBoundFunction;
class JSCell;
class JSGlobalObject;
class JSObject;
class SlotVisitor;
class Structure;
class VM;
struct ClassInfo;
}

namespace WebCore {

WEBCORE_EXPORT bool putDirect(JSC::JSObject*, JSC::VM&, JSC::PropertyName, JSC::JSValue, unsigned attributes);
WEBCORE_EXPORT void putDirectWithoutTransition(JSC::JSObject*, JSC::VM&, JSC::PropertyName, JSC::JSValue, unsigned attributes);
WEBCORE_EXPORT JSC::JSValue get(const JSC::JSObject*, JSC::JSGlobalObject*, JSC::PropertyName);
WEBCORE_EXPORT JSC::JSValue getDirect(const JSC::JSObject*, JSC::VM&, JSC::PropertyName);
WEBCORE_EXPORT bool getOwnPropertySlot(JSC::JSObject*, JSC::JSGlobalObject*, JSC::PropertyName, JSC::PropertySlot&);
WEBCORE_EXPORT bool getPropertySlot(JSC::JSObject*, JSC::JSGlobalObject*, JSC::PropertyName, JSC::PropertySlot&);
WEBCORE_EXPORT bool getPropertySlot(JSC::JSObject*, JSC::JSGlobalObject*, unsigned, JSC::PropertySlot&);
WEBCORE_EXPORT bool getNonIndexPropertySlot(JSC::JSObject*, JSC::JSGlobalObject*, JSC::PropertyName, JSC::PropertySlot&);
WEBCORE_EXPORT bool createDataProperty(JSC::JSObject*, JSC::JSGlobalObject*, JSC::PropertyName, JSC::JSValue, bool shouldThrow);

// Bun's own bindings call these six unqualified with `using namespace JSC`. A second function with JSC's signature would make those calls ambiguous.
using JSC::constructEmptyObject;
using JSC::createIteratorResultObject;
using JSC::getCallData;
using JSC::getConstructData;
using JSC::hasIteratorMethod;
using JSC::iteratorMethod;

WEBCORE_EXPORT JSC::JSObject* constructEmptyObject(JSC::JSGlobalObject*, JSC::Structure*);

WEBCORE_EXPORT JSC::PropertyOffset structureGet(JSC::Structure*, JSC::VM&, JSC::PropertyName);
WEBCORE_EXPORT JSC::JSValue storedPrototype(JSC::Structure*, const JSC::JSObject*);
WEBCORE_EXPORT JSC::JSObject* storedPrototypeObject(JSC::Structure*);

WEBCORE_EXPORT JSC::JSValue arrayGetDirectIndex(JSC::JSArray*, JSC::JSGlobalObject*, unsigned);

WEBCORE_EXPORT bool isIteratorProtocolFastAndNonObservable(JSC::JSArray*);
WEBCORE_EXPORT JSC::JSArray* constructArray(JSC::JSGlobalObject*, const JSC::ArgList&);
WEBCORE_EXPORT JSC::JSArray* constructArray(JSC::JSGlobalObject*, const JSC::JSValue*, unsigned length);

WEBCORE_EXPORT JSC::JSArray* tryGetFastIterableJSArray(JSC::JSGlobalObject&, JSC::JSValue);
WEBCORE_EXPORT void forEachInContiguousJSArray(JSC::JSGlobalObject&, JSC::JSArray*, NOESCAPE const ScopedLambda<void(JSC::JSValue)>&);
WEBCORE_EXPORT void forEachInIterable(JSC::JSGlobalObject*, JSC::JSValue iterable, NOESCAPE const ScopedLambda<void(JSC::VM&, JSC::JSGlobalObject*, JSC::JSValue)>&);
WEBCORE_EXPORT void forEachInIterable(JSC::JSGlobalObject&, JSC::JSObject*, JSC::JSValue method, NOESCAPE const ScopedLambda<void(JSC::VM&, JSC::JSGlobalObject&, JSC::JSValue)>&);
WEBCORE_EXPORT JSC::JSArray* constructArray(JSC::JSGlobalObject&, size_t, NOESCAPE const ScopedLambda<JSC::JSValue(size_t)>&);
WEBCORE_EXPORT JSC::JSValue freezeObject(JSC::JSGlobalObject&, JSC::JSObject*);

WEBCORE_EXPORT JSC::JSBoundFunction* createBoundFunction(JSC::VM&, JSC::JSGlobalObject*, JSC::JSObject* target, JSC::JSValue boundThis, JSC::ArgList, double length, ASCIILiteral sourceName);

} // namespace WebCore
