/*
 *  Copyright (C) 1999-2001 Harri Porten (porten@kde.org)
 *  Copyright (C) 2003-2017 Apple Inc. All rights reserved.
 *  Copyright (C) 2007 Samuel Weinig <sam@webkit.org>
 *  Copyright (C) 2009 Google, Inc. All rights reserved.
 *  Copyright (C) 2012 Ericsson AB. All rights reserved.
 *  Copyright (C) 2013 Michael Pruett <michael@68k.org>
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

#include "root.h"

#include "ExceptionDetails.h"
#include "ExceptionOr.h"
#include <JavaScriptCore/ThrowScope.h>

namespace JSC {
class CatchScope;
}

namespace WebCore {

class CachedScript;
class DeferredPromise;

void throwAttributeTypeError(JSC::JSGlobalObject&, JSC::ThrowScope&, const char* interfaceName, const char* attributeName, const char* expectedType);

void throwDataCloneError(JSC::JSGlobalObject&, JSC::ThrowScope&);
void throwDOMSyntaxError(JSC::JSGlobalObject&, JSC::ThrowScope&, ASCIILiteral); // Not the same as a JavaScript syntax error.
void throwInvalidStateError(JSC::JSGlobalObject&, JSC::ThrowScope&, ASCIILiteral);
WEBCORE_EXPORT void throwNonFiniteTypeError(JSC::JSGlobalObject&, JSC::ThrowScope&);
void throwNotSupportedError(JSC::JSGlobalObject&, JSC::ThrowScope&, ASCIILiteral);
void throwSecurityError(JSC::JSGlobalObject&, JSC::ThrowScope&, const String& message);
WEBCORE_EXPORT void throwSequenceTypeError(JSC::JSGlobalObject&, JSC::ThrowScope&);

WEBCORE_EXPORT JSC::EncodedJSValue throwArgumentMustBeEnumError(JSC::JSGlobalObject&, JSC::ThrowScope&, unsigned argumentIndex, const char* argumentName, const char* functionInterfaceName, const char* functionName, const char* expectedValues);
WEBCORE_EXPORT JSC::EncodedJSValue throwArgumentMustBeFunctionError(JSC::JSGlobalObject&, JSC::ThrowScope&, unsigned argumentIndex, const char* argumentName, const char* functionInterfaceName, const char* functionName);
WEBCORE_EXPORT JSC::EncodedJSValue throwArgumentMustBeObjectError(JSC::JSGlobalObject&, JSC::ThrowScope&, unsigned argumentIndex, const char* argumentName, const char* functionInterfaceName, const char* functionName);
WEBCORE_EXPORT JSC::EncodedJSValue throwArgumentTypeError(JSC::JSGlobalObject&, JSC::ThrowScope&, unsigned argumentIndex, const char* argumentName, const char* functionInterfaceName, const char* functionName, const char* expectedType);
WEBCORE_EXPORT JSC::EncodedJSValue throwRequiredMemberTypeError(JSC::JSGlobalObject&, JSC::ThrowScope&, const char* memberName, const char* dictionaryName, const char* expectedType);
JSC::EncodedJSValue throwConstructorScriptExecutionContextUnavailableError(JSC::JSGlobalObject&, JSC::ThrowScope&, const char* interfaceName);

String makeThisTypeErrorMessage(const char* interfaceName, const char* attributeName);
String makeUnsupportedIndexedSetterErrorMessage(const char* interfaceName);

WEBCORE_EXPORT JSC::EncodedJSValue throwThisTypeError(JSC::JSGlobalObject&, JSC::ThrowScope&, const char* interfaceName, const char* functionName);

WEBCORE_EXPORT JSC::EncodedJSValue rejectPromiseWithGetterTypeError(JSC::JSGlobalObject&, const JSC::ClassInfo*, JSC::PropertyName attributeName);
WEBCORE_EXPORT JSC::EncodedJSValue rejectPromiseWithThisTypeError(DeferredPromise&, const char* interfaceName, const char* operationName);
WEBCORE_EXPORT JSC::EncodedJSValue rejectPromiseWithThisTypeError(JSC::JSGlobalObject&, const char* interfaceName, const char* operationName);

String retrieveErrorMessageWithoutName(JSC::JSGlobalObject&, JSC::VM&, JSC::JSValue exception, JSC::CatchScope&);
String retrieveErrorMessage(JSC::JSGlobalObject&, JSC::VM&, JSC::JSValue exception, JSC::CatchScope&);
WEBCORE_EXPORT void reportException(JSC::JSGlobalObject*, JSC::JSValue exception, CachedScript* = nullptr, bool = false);
WEBCORE_EXPORT void reportException(JSC::JSGlobalObject*, JSC::Exception*, CachedScript* = nullptr, bool = false, ExceptionDetails* = nullptr);
void reportCurrentException(JSC::JSGlobalObject*);

JSC::JSValue createDOMException(JSC::JSGlobalObject&, Exception&&);
JSC::JSValue createDOMException(JSC::JSGlobalObject*, ExceptionCode, const String& = emptyString());

// Convert a DOM implementation exception into a JavaScript exception in the execution lexicalGlobalObject.
WEBCORE_EXPORT void propagateExceptionSlowPath(JSC::JSGlobalObject&, JSC::ThrowScope&, Exception&&);

ALWAYS_INLINE void propagateException(JSC::JSGlobalObject& lexicalGlobalObject, JSC::ThrowScope& throwScope, Exception&& exception)
{
    if (throwScope.exception())
        return;
    propagateExceptionSlowPath(lexicalGlobalObject, throwScope, WTFMove(exception));
}

inline void propagateException(JSC::JSGlobalObject& lexicalGlobalObject, JSC::ThrowScope& throwScope, ExceptionOr<void>&& value)
{
    if (UNLIKELY(value.hasException()))
        propagateException(lexicalGlobalObject, throwScope, value.releaseException());
}

inline void propagateException(JSC::JSGlobalObject* lexicalGlobalObject, JSC::ThrowScope& throwScope, ExceptionOr<void>&& value)
{
    if (UNLIKELY(value.hasException()))
        propagateException(lexicalGlobalObject, throwScope, value.releaseException());
}

template<typename Functor> void invokeFunctorPropagatingExceptionIfNecessary(JSC::JSGlobalObject& lexicalGlobalObject, JSC::ThrowScope& throwScope, Functor&& functor)
{
    using ReturnType = std::invoke_result_t<Functor>;

    if constexpr (IsExceptionOr<ReturnType>) {
        auto result = functor();
        if (UNLIKELY(result.hasException()))
            propagateException(lexicalGlobalObject, throwScope, result.releaseException());
    } else
        functor();
}

template<typename Functor> void invokeFunctorPropagatingExceptionIfNecessary(JSC::JSGlobalObject* lexicalGlobalObject, JSC::ThrowScope& throwScope, Functor&& functor)
{
    using ReturnType = std::invoke_result_t<Functor>;

    if constexpr (IsExceptionOr<ReturnType>) {
        auto result = functor();
        if (UNLIKELY(result.hasException()))
            propagateException(lexicalGlobalObject, throwScope, result.releaseException());
    } else
        functor();
}

} // namespace WebCore
