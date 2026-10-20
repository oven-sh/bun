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

#include "JSDOMOperation.h"
#include "JSDOMPromiseDeferred.h"

namespace WebCore {

template<typename JSClass>
class IDLOperationReturningPromise {
public:
    using ClassParameter = JSClass*;
    using Operation = JSC::EncodedJSValue(JSC::JSGlobalObject*, JSC::CallFrame*, ClassParameter, Ref<DeferredPromise>&&);

    template<Operation operation, CastedThisErrorBehavior shouldThrow = CastedThisErrorBehavior::RejectPromise>
    static JSC::EncodedJSValue call(JSC::JSGlobalObject& lexicalGlobalObject, JSC::CallFrame& callFrame, ASCIILiteral operationName)
    {
        return JSC::JSValue::encode(callPromiseFunction(lexicalGlobalObject, callFrame, [&operationName](JSC::JSGlobalObject& lexicalGlobalObject, JSC::CallFrame& callFrame, Ref<DeferredPromise>&& promise) {
            auto* thisObject = IDLOperation<JSClass>::cast(lexicalGlobalObject, callFrame);
            if constexpr (shouldThrow != CastedThisErrorBehavior::Assert) {
                if (!thisObject) [[unlikely]]
                    return rejectPromiseWithThisTypeError(promise.get(), JSClass::info()->className, operationName);
            } else
                ASSERT(thisObject);

            ASSERT_GC_OBJECT_INHERITS(thisObject, JSClass::info());

            // FIXME: We should refactor the binding generated code to use references for lexicalGlobalObject and thisObject.
            return operation(&lexicalGlobalObject, &callFrame, thisObject, WTF::move(promise));
        }));
    }
};

} // namespace WebCore
