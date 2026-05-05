/*
 * Copyright (C) 2010-2018 Apple Inc. All rights reserved.
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

#include "JSDOMWrapper.h"
#include "root.h"

#include "BunBuiltinNames.h"

// #include "DOMWindow.h"
// #include "DOMWrapperWorld.h"
// #include "JSDOMWindow.h"
// #include "JSRemoteDOMWindow.h"
// #include "SerializedScriptValue.h"
// #include <JavaScriptCore/Error.h>

namespace WebCore {

STATIC_ASSERT_IS_TRIVIALLY_DESTRUCTIBLE(JSDOMObject);

JSDOMObject::JSDOMObject(JSC::Structure* structure, JSC::JSGlobalObject& globalObject)
    : Base(globalObject.vm(), structure)
{
    // ASSERT(scriptExecutionContext() || globalObject.classInfo(globalObject.vm()) == JSRemoteDOMWindow::info());
}

JSC::JSValue cloneAcrossWorlds(JSC::JSGlobalObject& lexicalGlobalObject, const JSDOMObject& owner, JSC::JSValue value)
{
    if (isWorldCompatible(lexicalGlobalObject, value))
        return value;
    // // FIXME: Is it best to handle errors by returning null rather than throwing an exception?
    // auto serializedValue = SerializedScriptValue::create(lexicalGlobalObject, value, SerializationErrorMode::NonThrowing);
    // if (!serializedValue)
    // return JSC::jsNull();
    // FIXME: Why is owner->globalObject() better than lexicalGlobalObject.lexicalGlobalObject() here?
    // Unlike this, isWorldCompatible uses lexicalGlobalObject.lexicalGlobalObject(); should the two match?
    // return serializedValue->deserialize(lexicalGlobalObject, owner.globalObject());
    return JSC::jsNull();
}

} // namespace WebCore
