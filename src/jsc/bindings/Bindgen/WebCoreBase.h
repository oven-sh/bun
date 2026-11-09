#pragma once

// For a class with `webcoreBase`: its JS object is a wrapper of WebCore's, of an object that these functions make.

#include "root.h"
#include "BunString.h"
#include "ContextDestructionObserver.h"
#include "DOMException.h"
#include "Event.h"
#include "EventTarget.h"
#include "EventTargetInterfaces.h"
#include "JSDOMException.h"
#include "JSEvent.h"
#include "JSEventListener.h"
#include "JSEventTarget.h"
#include "ScriptExecutionContext.h"
#include <wtf/RefCounted.h>

namespace Bun::Bindgen {

// Holds the listeners. Everything else about the object is in its Rust struct.
class EventTargetOfWrapper final : public RefCounted<EventTargetOfWrapper>,
                                   public WebCore::EventTargetWithInlineData,
                                   private WebCore::ContextDestructionObserver {
    WTF_MAKE_TZONE_ALLOCATED(EventTargetOfWrapper);

public:
    static Ref<EventTargetOfWrapper> create(WebCore::ScriptExecutionContext& context)
    {
        return adoptRef(*new EventTargetOfWrapper(context));
    }

    void ref() const final { RefCounted::ref(); }
    void deref() const final { RefCounted::deref(); }
    USING_CAN_MAKE_WEAKPTR(WebCore::EventTargetWithInlineData);

private:
    explicit EventTargetOfWrapper(WebCore::ScriptExecutionContext& context)
        : ContextDestructionObserver(&context)
    {
    }

    WebCore::EventTargetInterface eventTargetInterface() const final { return WebCore::BunBindgenEventTargetInterfaceType; }
    WebCore::ScriptExecutionContext* scriptExecutionContext() const final { return ContextDestructionObserver::scriptExecutionContext(); }
    void refEventTarget() final { ref(); }
    void derefEventTarget() final { deref(); }
};

// `bun_jsc::bindgen::EventInit`. The string is the caller's to release.
struct EventInit {
    BunString type;
    bool bubbles;
    bool cancelable;
    bool composed;
    bool isTrusted;
};

// `bun_jsc::bindgen::DOMExceptionInit`.
struct DOMExceptionInit {
    BunString message;
    BunString name;
};

Ref<WebCore::EventTarget> createEventTarget(WebCore::JSDOMGlobalObject&);
Ref<WebCore::Event> createEvent(EventInit);
Ref<WebCore::DOMException> createDOMException(DOMExceptionInit);

// `event.target`, and the event that a listener is called with, are the wrapper that the object remembers.
void didCreateWrapper(WebCore::JSDOMGlobalObject&, WebCore::JSDOMObject& wrapper, WebCore::ScriptWrappable&);
// An error knows where it was made.
void didCreateWrapper(WebCore::JSDOMGlobalObject&, WebCore::JSDOMObject& wrapper, WebCore::DOMException&);

}
