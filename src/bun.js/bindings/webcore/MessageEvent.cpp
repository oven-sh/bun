/*
 * Copyright (C) 2007 Henry Mason (hmason@mac.com)
 * Copyright (C) 2003-2018 Apple Inc. All rights reserved.
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
 * THIS SOFTWARE IS PROVIDED BY APPLE INC. ``AS IS'' AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL APPLE INC. OR
 * CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
 * EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
 * PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
 * PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY
 * OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 *
 */
#include "root.h"
#include "config.h"
#include "MessageEvent.h"

// #include "Blob.h"
#include "EventNames.h"
#include "JSDOMConvert.h"
#include "JSMessageEvent.h"
#include <JavaScriptCore/JSCInlines.h>
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

using namespace JSC;

WTF_MAKE_TZONE_ALLOCATED_IMPL(MessageEvent);

MessageEvent::MessageEvent() = default;

inline MessageEvent::MessageEvent(const AtomString& type, Init&& initializer, IsTrusted isTrusted)
    : Event(type, initializer, isTrusted)
    , m_data(JSValueTag {})
    , m_origin(initializer.origin)
    , m_lastEventId(initializer.lastEventId)
    , m_source(WTFMove(initializer.source))
    , m_ports(WTFMove(initializer.ports))
    , m_jsData(initializer.data)
{
}

inline MessageEvent::MessageEvent(const AtomString& type, DataType&& data, const String& origin, const String& lastEventId, RefPtr<MessagePort>&& source, Vector<RefPtr<MessagePort>>&& ports)
    : Event(type, CanBubble::No, IsCancelable::No)
    , m_data(WTFMove(data))
    , m_origin(origin)
    , m_lastEventId(lastEventId)
    , m_source(WTFMove(source))
    , m_ports(WTFMove(ports))
{
}

Ref<MessageEvent> MessageEvent::create(const AtomString& type, DataType&& data, const String& origin, const String& lastEventId, RefPtr<MessagePort>&& source, Vector<RefPtr<MessagePort>>&& ports)
{
    return adoptRef(*new MessageEvent(type, WTFMove(data), origin, lastEventId, WTFMove(source), WTFMove(ports)));
}

Ref<MessageEvent> MessageEvent::create(DataType&& data, const String& origin, const String& lastEventId, RefPtr<MessagePort>&& source, Vector<RefPtr<MessagePort>>&& ports)
{
    return create(eventNames().messageEvent, WTFMove(data), origin, lastEventId, WTFMove(source), WTFMove(ports));
}

Ref<MessageEvent> MessageEvent::createForBindings()
{
    return adoptRef(*new MessageEvent);
}

Ref<MessageEvent> MessageEvent::create(const AtomString& type, Init&& initializer, IsTrusted isTrusted)
{
    return adoptRef(*new MessageEvent(type, WTFMove(initializer), isTrusted));
}

MessageEvent::~MessageEvent() = default;

auto MessageEvent::create(JSC::JSGlobalObject& globalObject, Ref<SerializedScriptValue>&& data, RefPtr<MessagePort>&& source, Vector<RefPtr<MessagePort>>&& ports) -> MessageEventWithStrongData
{
    return create(globalObject, WTFMove(data), {}, {}, WTFMove(source), WTFMove(ports));
}

auto MessageEvent::create(JSC::JSGlobalObject& globalObject, Ref<SerializedScriptValue>&& data, const String& origin, const String& lastEventId, RefPtr<MessagePort>&& source, Vector<RefPtr<MessagePort>>&& ports) -> MessageEventWithStrongData
{
    auto& vm = globalObject.vm();
    // Locker<JSC::JSLock> locker(vm.apiLock());
    auto catchScope = DECLARE_CATCH_SCOPE(vm);

    bool didFail = false;

    auto deserialized = data->deserialize(globalObject, &globalObject, ports, SerializationErrorMode::NonThrowing, &didFail);
    if (UNLIKELY(catchScope.exception()))
        deserialized = jsUndefined();

    JSC::Strong<JSC::Unknown> strongData(vm, deserialized);

    auto& eventType = didFail ? eventNames().messageerrorEvent : eventNames().messageEvent;
    auto event = adoptRef(*new MessageEvent(eventType, WTFMove(data), origin, lastEventId, WTFMove(source), WTFMove(ports)));
    JSC::Strong<JSC::JSObject> strongWrapper(vm, JSC::jsCast<JSC::JSObject*>(toJS(&globalObject, JSC::jsCast<JSDOMGlobalObject*>(&globalObject), event.get())));
    // Since we've already deserialized the SerializedScriptValue, cache the result so we don't have to deserialize
    // again the next time JSMessageEvent::data() gets called by the main world.
    event->cachedData().set(vm, strongWrapper.get(), deserialized);

    return MessageEventWithStrongData { event, WTFMove(strongWrapper) };
}

void MessageEvent::initMessageEvent(const AtomString& type, bool canBubble, bool cancelable, JSValue data, const String& origin, const String& lastEventId, RefPtr<MessagePort>&& source, Vector<RefPtr<MessagePort>>&& ports)
{
    if (isBeingDispatched())
        return;

    initEvent(type, canBubble, cancelable);

    {
        Locker { m_concurrentDataAccessLock };
        m_data = JSValueTag {};
    }
    // FIXME: This code is wrong: we should emit a write-barrier. Otherwise, GC can collect it.
    // https://bugs.webkit.org/show_bug.cgi?id=236353
    m_jsData.setWeakly(data);
    m_cachedData.clear();
    m_origin = origin;
    m_lastEventId = lastEventId;
    m_source = WTFMove(source);
    m_ports = WTFMove(ports);
    m_cachedPorts.clear();
}

EventInterface MessageEvent::eventInterface() const
{
    return MessageEventInterfaceType;
}

size_t MessageEvent::memoryCost() const
{
    Locker { m_concurrentDataAccessLock };
    return WTF::switchOn(
        m_data, [](JSValueTag) -> size_t { return 0; },
        [](const Ref<SerializedScriptValue>& data) -> size_t { return data->memoryCost(); },
        [](const String& string) -> size_t { return string.sizeInBytes(); },
        // [](const Ref<Blob>& blob) -> size_t { return blob->size(); },
        [](const Ref<ArrayBuffer>& buffer) -> size_t { return buffer->byteLength(); });
}

} // namespace WebCore
