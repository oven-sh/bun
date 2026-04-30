#include "config.h"
#include "root.h"

#include "headers-handwritten.h"
#include "ZigGlobalObject.h"
#include "blob.h"
#include "webcore/Event.h"
#include "webcore/ErrorEvent.h"
#include "webcore/MessageEvent.h"
#include "webcore/JSEvent.h"
#include "webcore/JSErrorEvent.h"
#include "webcore/JSMessageEvent.h"
#include "webcore/EventNames.h"

using namespace JSC;
using namespace WebCore;

// Creates a MessageEvent for SSE dispatch with the given event type (typically
// "message" or a custom event name from the server's `event:` field), data
// (joined data lines), origin (the URL origin), and lastEventId.
extern "C" EncodedJSValue Bun__createSSEMessageEvent(
    JSGlobalObject* lexicalGlobalObject,
    const BunString* eventType,
    const BunString* data,
    const BunString* origin,
    const BunString* lastEventId)
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);

    WTF::AtomString typeAtom = eventType->tag != BunStringTag::Empty
        ? WTF::AtomString(eventType->toWTFString(BunString::ZeroCopy))
        : eventNames().messageEvent;

    WTF::String dataString = data->toWTFString(BunString::ZeroCopy);
    WTF::String originString = origin->toWTFString(BunString::ZeroCopy);
    WTF::String lastEventIdString = lastEventId->toWTFString(BunString::ZeroCopy);

    auto event = MessageEvent::create(
        typeAtom,
        MessageEvent::DataType(WTF::move(dataString)),
        WTF::move(originString),
        WTF::move(lastEventIdString));

    return JSValue::encode(toJS(lexicalGlobalObject, globalObject, event.ptr()));
}

// Creates a plain Event for "open" dispatch.
extern "C" EncodedJSValue Bun__createSSEOpenEvent(JSGlobalObject* lexicalGlobalObject)
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto event = Event::create(eventNames().openEvent, Event::CanBubble::No, Event::IsCancelable::No);
    return JSValue::encode(toJS(lexicalGlobalObject, globalObject, event.ptr()));
}

// Creates an ErrorEvent for "error" dispatch. If message is empty, a plain
// Event with type "error" is created instead (per spec, the error event in
// EventSource is a simple Event, not an ErrorEvent — but we expose a message
// when we have one as a Bun extension for better DX).
extern "C" EncodedJSValue Bun__createSSEErrorEvent(
    JSGlobalObject* lexicalGlobalObject,
    const BunString* message)
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);

    if (message->tag == BunStringTag::Empty) {
        auto event = Event::create(eventNames().errorEvent, Event::CanBubble::No, Event::IsCancelable::No);
        return JSValue::encode(toJS(lexicalGlobalObject, globalObject, event.ptr()));
    }

    ErrorEvent::Init init;
    init.message = message->toWTFString(BunString::ZeroCopy);
    auto event = ErrorEvent::create(eventNames().errorEvent, WTF::move(init), EventIsTrusted::Yes);
    return JSValue::encode(toJS(lexicalGlobalObject, globalObject, event.ptr()));
}
