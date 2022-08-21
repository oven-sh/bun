#pragma once

#include "EventListenerMap.h"
#include "EventListenerOptions.h"
#include "ExceptionOr.h"
#include "ContextDestructionObserver.h"
#include "ScriptWrappable.h"
#include <memory>
#include <variant>
#include <wtf/Forward.h>

#include <wtf/WeakPtr.h>

#include "root.h"

namespace JSC {
class JSValue;
class JSObject;
}

namespace WebCore {

struct AddEventListenerOptions;
class DOMWrapperWorld;
class JSEventListener;

struct EventEmitterData {
    WTF_MAKE_NONCOPYABLE(EventEmitterData);
    WTF_MAKE_FAST_ALLOCATED;

public:
    EventEmitterData() = default;
    EventListenerMap eventListenerMap;
    bool isFiringEventListeners { false };
};

class EventEmitter final : public ScriptWrappable, public CanMakeWeakPtr<EventEmitter>, public RefCounted<EventEmitter>, public ContextDestructionObserver {
    WTF_MAKE_ISO_ALLOCATED(EventEmitter);

public:
    static Ref<EventEmitter> create(ScriptExecutionContext&);
    WEBCORE_EXPORT ~EventEmitter() = default;

    using RefCounted::deref;
    using RefCounted::ref;

    ScriptExecutionContext* scriptExecutionContext() const { return ContextDestructionObserver::scriptExecutionContext(); };

    WEBCORE_EXPORT bool isNode() const { return false; };

    WEBCORE_EXPORT void addListenerForBindings(const AtomString& eventType, RefPtr<EventListener>&&, bool, bool);
    WEBCORE_EXPORT void removeListenerForBindings(const AtomString& eventType, RefPtr<EventListener>&&);
    WEBCORE_EXPORT void removeAllListenersForBindings(const AtomString& eventType);
    WEBCORE_EXPORT bool emitForBindings(const AtomString&);

    WEBCORE_EXPORT bool addListener(const AtomString& eventType, Ref<EventListener>&&, bool, bool);
    WEBCORE_EXPORT bool removeListener(const AtomString& eventType, EventListener&);
    WEBCORE_EXPORT bool removeAllListeners(const AtomString& eventType);

    WEBCORE_EXPORT void emit(const AtomString&);
    WEBCORE_EXPORT void uncaughtExceptionInEventHandler();

    WEBCORE_EXPORT Vector<AtomString> getEventNames();
    WEBCORE_EXPORT Vector<JSObject*> getListeners(const AtomString& eventType);
    WEBCORE_EXPORT int listenerCount(const AtomString& eventType);

    bool hasEventListeners() const;
    bool hasEventListeners(const AtomString& eventType) const;
    bool hasCapturingEventListeners(const AtomString& eventType);
    bool hasActiveEventListeners(const AtomString& eventType) const;

    Vector<AtomString> eventTypes();
    const EventListenerVector& eventListeners(const AtomString& eventType);

    void fireEventListeners(const AtomString& eventName);
    bool isFiringEventListeners() const;

    template<typename Visitor> void visitJSEventListeners(Visitor&);
    void invalidateJSEventListeners(JSC::JSObject*);

    const EventEmitterData* eventTargetData() const;

private:
    EventEmitter(ScriptExecutionContext& context) : ContextDestructionObserver(&context)
    {
    }

    EventEmitterData* eventTargetData() { return &m_eventTargetData; }
    EventEmitterData* eventTargetDataConcurrently() { return &m_eventTargetData; }
    EventEmitterData& ensureEventEmitterData() { return m_eventTargetData; }
    void eventListenersDidChange() {}

    void innerInvokeEventListeners(const AtomString&, EventListenerVector);
    void invalidateEventListenerRegions();

    EventEmitterData m_eventTargetData;
};

inline const EventEmitterData* EventEmitter::eventTargetData() const
{
    return const_cast<EventEmitter*>(this)->eventTargetData();
}

inline bool EventEmitter::isFiringEventListeners() const
{
    auto* data = eventTargetData();
    return data && data->isFiringEventListeners;
}

inline bool EventEmitter::hasEventListeners() const
{
    auto* data = eventTargetData();
    return data && !data->eventListenerMap.isEmpty();
}

inline bool EventEmitter::hasEventListeners(const AtomString& eventType) const
{
    auto* data = eventTargetData();
    return data && data->eventListenerMap.contains(eventType);
}

inline bool EventEmitter::hasCapturingEventListeners(const AtomString& eventType)
{
    auto* data = eventTargetData();
    return data && data->eventListenerMap.containsCapturing(eventType);
}

template<typename Visitor>
void EventEmitter::visitJSEventListeners(Visitor& visitor)
{
    if (auto* data = eventTargetDataConcurrently())
        data->eventListenerMap.visitJSEventListeners(visitor);
}

} // namespace WebCore
