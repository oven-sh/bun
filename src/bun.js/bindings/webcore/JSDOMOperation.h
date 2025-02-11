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
class IDLOperation {
public:
    using ClassParameter = JSClass*;
    using Operation = JSC::EncodedJSValue(JSC::JSGlobalObject*, JSC::CallFrame*, ClassParameter);
    using StaticOperation = JSC::EncodedJSValue(JSC::JSGlobalObject*, JSC::CallFrame*);

    // FIXME: Remove this after FunctionCallResolveNode is fixed not to pass resolved scope as |this| value.
    // https://bugs.webkit.org/show_bug.cgi?id=225397
    static JSClass* cast(JSC::JSGlobalObject& lexicalGlobalObject, JSC::CallFrame& callFrame)
    {
        if constexpr (std::is_base_of_v<JSDOMGlobalObject, JSClass>)
            return castThisValue<JSClass>(lexicalGlobalObject, callFrame.thisValue().toThis(&lexicalGlobalObject, JSC::ECMAMode::strict()));
        else
            return castThisValue<JSClass>(lexicalGlobalObject, callFrame.thisValue());
    }

    template<Operation operation, CastedThisErrorBehavior shouldThrow = CastedThisErrorBehavior::Throw>
    static JSC::EncodedJSValue call(JSC::JSGlobalObject& lexicalGlobalObject, JSC::CallFrame& callFrame, const char* operationName)
    {
        auto throwScope = DECLARE_THROW_SCOPE(JSC::getVM(&lexicalGlobalObject));

        auto* thisObject = cast(lexicalGlobalObject, callFrame);
        if constexpr (shouldThrow != CastedThisErrorBehavior::Assert) {
            if (UNLIKELY(!thisObject))
                return throwThisTypeError(lexicalGlobalObject, throwScope, JSClass::info()->className, operationName);
        } else
            ASSERT(thisObject);

        ASSERT_GC_OBJECT_INHERITS(thisObject, JSClass::info());

        // FIXME: We should refactor the binding generated code to use references for lexicalGlobalObject and thisObject.
        RELEASE_AND_RETURN(throwScope, (operation(&lexicalGlobalObject, &callFrame, thisObject)));
    }

    template<StaticOperation operation, CastedThisErrorBehavior shouldThrow = CastedThisErrorBehavior::Throw>
    static JSC::EncodedJSValue callStatic(JSC::JSGlobalObject& lexicalGlobalObject, JSC::CallFrame& callFrame, const char*)
    {
        // FIXME: We should refactor the binding generated code to use references for lexicalGlobalObject.
        return operation(&lexicalGlobalObject, &callFrame);
    }
};

// Rewrite all usages of JSC::createNotEnoughArgumentsError to use our own version.
// Our version adds the "code" property from Node.js.
JSC::JSObject* createNotEnoughArgumentsErrorBun(JSGlobalObject* globalObject);

#ifndef createNotEnoughArgumentsError
#define createNotEnoughArgumentsError WebCore::createNotEnoughArgumentsErrorBun
#endif

void throwNodeRangeError(JSGlobalObject* lexicalGlobalObject, ThrowScope& scope, ASCIILiteral message);
void throwNodeRangeError(JSGlobalObject* lexicalGlobalObject, ThrowScope& scope, const String& message);

} // namespace WebCore
