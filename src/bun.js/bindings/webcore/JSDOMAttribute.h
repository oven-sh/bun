/*
 *  Copyright (C) 1999-2001 Harri Porten (porten@kde.org)
 *  Copyright (C) 2003-2020 Apple Inc. All rights reserved.
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

#include "JSDOMCastThisValue.h"
#include "JSDOMExceptionHandling.h"

namespace WebCore {

template<typename JSClass>
class IDLAttribute {
public:
    using Setter = bool(JSC::JSGlobalObject&, JSClass&, JSC::JSValue);
    using SetterPassingPropertyName = bool(JSC::JSGlobalObject&, JSClass&, JSC::JSValue, JSC::PropertyName);
    using StaticSetter = bool(JSC::JSGlobalObject&, JSC::JSValue);
    using Getter = JSC::JSValue(JSC::JSGlobalObject&, JSClass&);
    using GetterPassingPropertyName = JSC::JSValue(JSC::JSGlobalObject&, JSClass&, JSC::PropertyName);
    using StaticGetter = JSC::JSValue(JSC::JSGlobalObject&);

    template<Setter setter, CastedThisErrorBehavior shouldThrow = CastedThisErrorBehavior::Throw>
    static bool set(JSC::JSGlobalObject& lexicalGlobalObject, JSC::EncodedJSValue thisValue, JSC::EncodedJSValue encodedValue, JSC::PropertyName attributeName)
    {
        auto throwScope = DECLARE_THROW_SCOPE(JSC::getVM(&lexicalGlobalObject));

        auto* thisObject = castThisValue<JSClass>(lexicalGlobalObject, JSC::JSValue::decode(thisValue));
        if (UNLIKELY(!thisObject)) {
            if constexpr (shouldThrow == CastedThisErrorBehavior::Throw)
                return JSC::throwVMDOMAttributeSetterTypeError(&lexicalGlobalObject, throwScope, JSClass::info(), attributeName);
            else
                return false;
        }

        RELEASE_AND_RETURN(throwScope, (setter(lexicalGlobalObject, *thisObject, JSC::JSValue::decode(encodedValue))));
    }

    // FIXME: FIXME: This can be merged with `set` if we replace the explicit setter function template parameter with a generic lambda.
    template<SetterPassingPropertyName setter, CastedThisErrorBehavior shouldThrow = CastedThisErrorBehavior::Throw>
    static bool setPassingPropertyName(JSC::JSGlobalObject& lexicalGlobalObject, JSC::EncodedJSValue thisValue, JSC::EncodedJSValue encodedValue, JSC::PropertyName attributeName)
    {
        auto throwScope = DECLARE_THROW_SCOPE(JSC::getVM(&lexicalGlobalObject));

        auto* thisObject = castThisValue<JSClass>(lexicalGlobalObject, JSC::JSValue::decode(thisValue));
        if (UNLIKELY(!thisObject)) {
            if constexpr (shouldThrow == CastedThisErrorBehavior::Throw)
                return JSC::throwVMDOMAttributeSetterTypeError(&lexicalGlobalObject, throwScope, JSClass::info(), attributeName);
            else
                return false;
        }

        RELEASE_AND_RETURN(throwScope, (setter(lexicalGlobalObject, *thisObject, JSC::JSValue::decode(encodedValue), attributeName)));
    }

    template<StaticSetter setter, CastedThisErrorBehavior shouldThrow = CastedThisErrorBehavior::Throw>
    static bool setStatic(JSC::JSGlobalObject& lexicalGlobalObject, JSC::EncodedJSValue, JSC::EncodedJSValue encodedValue, JSC::PropertyName)
    {
        return setter(lexicalGlobalObject, JSC::JSValue::decode(encodedValue));
    }

    template<Getter getter, CastedThisErrorBehavior shouldThrow = CastedThisErrorBehavior::Throw>
    static JSC::EncodedJSValue get(JSC::JSGlobalObject& lexicalGlobalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName attributeName)
    {
        auto throwScope = DECLARE_THROW_SCOPE(JSC::getVM(&lexicalGlobalObject));

        if constexpr (shouldThrow == CastedThisErrorBehavior::Assert) {
            ASSERT(castThisValue<JSClass>(lexicalGlobalObject, JSC::JSValue::decode(thisValue)));
            auto* thisObject = JSC::jsCast<JSClass*>(JSC::JSValue::decode(thisValue));
            RELEASE_AND_RETURN(throwScope, (JSC::JSValue::encode(getter(lexicalGlobalObject, *thisObject))));
        } else {
            auto* thisObject = castThisValue<JSClass>(lexicalGlobalObject, JSC::JSValue::decode(thisValue));
            if (UNLIKELY(!thisObject)) {
                if constexpr (shouldThrow == CastedThisErrorBehavior::Throw)
                    return JSC::throwVMDOMAttributeGetterTypeError(&lexicalGlobalObject, throwScope, JSClass::info(), attributeName);
                else if constexpr (shouldThrow == CastedThisErrorBehavior::RejectPromise)
                    RELEASE_AND_RETURN(throwScope, rejectPromiseWithGetterTypeError(lexicalGlobalObject, JSClass::info(), attributeName));
                else
                    return JSC::JSValue::encode(JSC::jsUndefined());
            }

            RELEASE_AND_RETURN(throwScope, (JSC::JSValue::encode(getter(lexicalGlobalObject, *thisObject))));
        }
    }

    // FIXME: This can be merged with `get` if we replace the explicit setter function template parameter with a generic lambda.
    template<GetterPassingPropertyName getter, CastedThisErrorBehavior shouldThrow = CastedThisErrorBehavior::Throw>
    static JSC::EncodedJSValue getPassingPropertyName(JSC::JSGlobalObject& lexicalGlobalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName attributeName)
    {
        auto throwScope = DECLARE_THROW_SCOPE(JSC::getVM(&lexicalGlobalObject));

        if constexpr (shouldThrow == CastedThisErrorBehavior::Assert) {
            ASSERT(castThisValue<JSClass>(lexicalGlobalObject, JSC::JSValue::decode(thisValue)));
            auto* thisObject = JSC::jsCast<JSClass*>(JSC::JSValue::decode(thisValue));
            RELEASE_AND_RETURN(throwScope, (JSC::JSValue::encode(getter(lexicalGlobalObject, *thisObject, attributeName))));
        } else {
            auto* thisObject = castThisValue<JSClass>(lexicalGlobalObject, JSC::JSValue::decode(thisValue));
            if (UNLIKELY(!thisObject)) {
                if constexpr (shouldThrow == CastedThisErrorBehavior::Throw)
                    return JSC::throwVMDOMAttributeGetterTypeError(&lexicalGlobalObject, throwScope, JSClass::info(), attributeName);
                else if constexpr (shouldThrow == CastedThisErrorBehavior::RejectPromise)
                    RELEASE_AND_RETURN(throwScope, rejectPromiseWithGetterTypeError(lexicalGlobalObject, JSClass::info(), attributeName));
                else
                    return JSC::JSValue::encode(JSC::jsUndefined());
            }

            RELEASE_AND_RETURN(throwScope, (JSC::JSValue::encode(getter(lexicalGlobalObject, *thisObject, attributeName))));
        }
    }

    template<StaticGetter getter, CastedThisErrorBehavior shouldThrow = CastedThisErrorBehavior::Throw>
    static JSC::EncodedJSValue getStatic(JSC::JSGlobalObject& lexicalGlobalObject, JSC::EncodedJSValue, JSC::PropertyName)
    {
        return JSC::JSValue::encode(getter(lexicalGlobalObject));
    }
};

} // namespace WebCore
