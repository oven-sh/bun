/*
 * Copyright (C) 2009 Google Inc. All rights reserved.
 * Copyright (C) 2009-2021 Apple Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are
 * met:
 *
 *     * Redistributions of source code must retain the above copyright
 * notice, this list of conditions and the following disclaimer.
 *     * Redistributions in binary form must reproduce the above
 * copyright notice, this list of conditions and the following disclaimer
 * in the documentation and/or other materials provided with the
 * distribution.
 *     * Neither the name of Google Inc. nor the names of its
 * contributors may be used to endorse or promote products derived from
 * this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 * A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
 * OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
 * LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

#include "config.h"
#include "JSMessageEvent.h"

// #include "JSBlob.h"
#include "JSDOMBinding.h"
#include "JSDOMConvert.h"
#include "JSDOMWindow.h"
#include "JSEventTarget.h"
// #include "JSMessagePort.h"
#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/JSArrayBuffer.h>

namespace WebCore {

JSC::JSValue JSMessageEvent::ports(JSC::JSGlobalObject& lexicalGlobalObject) const
{
    auto throwScope = DECLARE_THROW_SCOPE(lexicalGlobalObject.vm());
    return cachedPropertyValue(throwScope, lexicalGlobalObject, *this, wrapped().cachedPorts(), [&](JSC::ThrowScope& throwScope) {
        JSC::JSValue ports = toJS<IDLFrozenArray<IDLInterface<MessagePort>>>(lexicalGlobalObject, *globalObject(), throwScope, wrapped().ports());
        return ports;
    });
}

JSC::JSValue JSMessageEvent::data(JSC::JSGlobalObject& lexicalGlobalObject) const
{
    auto throwScope = DECLARE_THROW_SCOPE(lexicalGlobalObject.vm());
    return cachedPropertyValue(throwScope, lexicalGlobalObject, *this, wrapped().cachedData(), [this, &lexicalGlobalObject](JSC::ThrowScope&) {
        return WTF::switchOn(
            wrapped().data(), [this](MessageEvent::JSValueTag) -> JSC::JSValue { return wrapped().jsData().getValue(JSC::jsNull()); }, [this, &lexicalGlobalObject](const Ref<SerializedScriptValue>& data) {
            // FIXME: Is it best to handle errors by returning null rather than throwing an exception?
            return data->deserialize(lexicalGlobalObject, globalObject(), wrapped().ports(), SerializationErrorMode::NonThrowing); }, [&lexicalGlobalObject](const String& data) { return toJS<IDLDOMString>(lexicalGlobalObject, data); }, [this, &lexicalGlobalObject](const Ref<ArrayBuffer>& data) { return toJS<IDLInterface<ArrayBuffer>>(lexicalGlobalObject, *globalObject(), data); });
    });
}

template<typename Visitor>
void JSMessageEvent::visitAdditionalChildren(Visitor& visitor)
{
    wrapped().jsData().visit(visitor);
    wrapped().cachedData().visit(visitor);
    wrapped().cachedPorts().visit(visitor);
}

DEFINE_VISIT_ADDITIONAL_CHILDREN(JSMessageEvent);

} // namespace WebCore
