/*
 * Copyright (C) 2009 Google Inc. All rights reserved.
 * Copyright (C) 2016 Apple Inc. All rights reserved.
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
#include "ErrorEvent.h"

#include "DOMWrapperWorld.h"
#include "EventNames.h"
#include <JavaScriptCore/HeapInlines.h>
#include <JavaScriptCore/StrongInlines.h>
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {
using namespace JSC;

WTF_MAKE_TZONE_ALLOCATED_IMPL(ErrorEvent);

ErrorEvent::ErrorEvent(const AtomString& type, const Init& initializer, IsTrusted isTrusted)
    : Event(type, initializer, isTrusted)
    , m_message(initializer.message)
    , m_fileName(initializer.filename)
    , m_lineNumber(initializer.lineno)
    , m_columnNumber(initializer.colno)
    , m_error(initializer.error)
{
}

ErrorEvent::ErrorEvent(const AtomString& type, const String& message, const String& fileName, unsigned lineNumber, unsigned columnNumber, JSC::Strong<JSC::Unknown> error)
    : Event(type, CanBubble::No, IsCancelable::Yes)
    , m_message(message)
    , m_fileName(fileName)
    , m_lineNumber(lineNumber)
    , m_columnNumber(columnNumber)
    , m_error(error.get())
{
}

ErrorEvent::ErrorEvent(const String& message, const String& fileName, unsigned lineNumber, unsigned columnNumber, JSC::Strong<JSC::Unknown> error)
    : ErrorEvent(eventNames().errorEvent, message, fileName, lineNumber, columnNumber, error)
{
}

ErrorEvent::~ErrorEvent() = default;

EventInterface ErrorEvent::eventInterface() const
{
    return ErrorEventInterfaceType;
}

JSValue ErrorEvent::error(JSGlobalObject& globalObject)
{
    if (!m_error)
        return jsNull();

    JSValue error = m_error.getValue();
    // if (!isWorldCompatible(globalObject, error)) {
    //     // We need to make sure ErrorEvents do not leak their error property across isolated DOM worlds.
    //     // Ideally, we would check that the worlds have different privileges but that's not possible yet.
    //     auto serializedError = trySerializeError(globalObject);
    //     if (!serializedError)
    //         return jsNull();
    //     return serializedError->deserialize(globalObject, &globalObject);
    // }

    return error;
}

// RefPtr<SerializedScriptValue> ErrorEvent::trySerializeError(JSGlobalObject& exec)
// {
//     // if (!m_serializedError && !m_triedToSerialize) {
//     //     m_serializedError = SerializedScriptValue::create(exec, m_error.getValue(), SerializationErrorMode::NonThrowing);
//     //     m_triedToSerialize = true;
//     // }
//     return 0;
// }

bool ErrorEvent::isErrorEvent() const
{
    return true;
}

} // namespace WebCore
