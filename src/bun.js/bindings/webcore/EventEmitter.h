#pragma once

#include "root.h"

#include "IdentifierEventListenerMap.h"
#include "ExceptionOr.h"
#include "ContextDestructionObserver.h"
#include "ScriptWrappable.h"
#include <memory>
#include <variant>
#include <wtf/Forward.h>

#include <wtf/WeakPtr.h>

namespace JSC {
class JSValue;
class JSObject;
}

namespace WebCore {

class DOMWrapperWorld;
class JSEventListener;

struct EventEmitterData {
    WTF_MAKE_NONCOPYABLE(EventEmitterData);
    WTF_MAKE_FAST_ALLOCATED;

public:
    EventEmitterData() = default;
    IdentifierEventListenerMap eventListenerMap;
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
    bool removeAllListeners();
    WEBCORE_EXPORT void addListenerForBindings(const Identifier& eventType, RefPtr<EventListener>&&, bool, bool);
    WEBCORE_EXPORT void removeListenerForBindings(const Identifier& eventType, RefPtr<EventListener>&&);
    WEBCORE_EXPORT void removeAllListenersForBindings(const Identifier& eventType);
    WEBCORE_EXPORT bool emitForBindings(const Identifier&, const MarkedArgumentBuffer&);

    WEBCORE_EXPORT bool addListener(const Identifier& eventType, Ref<EventListener>&&, bool, bool);
    WEBCORE_EXPORT bool removeListener(const Identifier& eventType, EventListener&);
    WEBCORE_EXPORT bool removeAllListeners(const Identifier& eventType);

    WEBCORE_EXPORT bool emit(const Identifier&, const MarkedArgumentBuffer&);
    WEBCORE_EXPORT void uncaughtExceptionInEventHandler();

    WEBCORE_EXPORT Vector<Identifier> getEventNames();
    WEBCORE_EXPORT Vector<JSObject*> getListeners(const Identifier& eventType);
    WEBCORE_EXPORT int listenerCount(const Identifier& eventType);

    bool hasEventListeners() const;
    bool hasEventListeners(const Identifier& eventType) const;
    bool hasActiveEventListeners(const Identifier& eventType) const;
    bool hasEventListeners(JSC::VM& vm, ASCIILiteral eventType) const;

    WTF::Function<void(EventEmitter&, const Identifier& eventName, bool isAdded)> onDidChangeListener = WTF::Function<void(EventEmitter&, const Identifier& eventName, bool isAdded)>(nullptr);

    unsigned getMaxListeners() const { return m_maxListeners; };

    void setMaxListeners(unsigned count);

    Vector<Identifier> eventTypes();
    const SimpleEventListenerVector& eventListeners(const Identifier& eventType);

    bool fireEventListeners(const Identifier& eventName, const MarkedArgumentBuffer& arguments);
    bool isFiringEventListeners() const;

    void invalidateJSEventListeners(JSC::JSObject*);

    const EventEmitterData* eventTargetData() const;

    IdentifierEventListenerMap& eventListenerMap() { return ensureEventEmitterData().eventListenerMap; }

    void setThisObject(JSC::JSValue thisObject)
    {
        m_thisObject.clear();

        if (thisObject.isCell()) {
            m_thisObject = JSC::Weak<JSC::JSObject>(thisObject.getObject());
        }
    }

    bool m_hasIPCRef { false };

private:
    EventEmitter(ScriptExecutionContext& context)
        : ContextDestructionObserver(&context)
    {
    }

    EventEmitterData* eventTargetData() { return &m_eventTargetData; }
    EventEmitterData* eventTargetDataConcurrently() { return &m_eventTargetData; }
    EventEmitterData& ensureEventEmitterData() { return m_eventTargetData; }
    void eventListenersDidChange()
    {
    }

    bool innerInvokeEventListeners(const Identifier&, SimpleEventListenerVector, const MarkedArgumentBuffer& arguments);
    void invalidateEventListenerRegions();

    EventEmitterData m_eventTargetData;
    unsigned m_maxListeners { 10 };

    mutable JSC::Weak<JSC::JSObject> m_thisObject { nullptr };
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

inline bool EventEmitter::hasEventListeners(const Identifier& eventType) const
{
    auto* data = eventTargetData();
    return data && data->eventListenerMap.contains(eventType);
}

inline bool EventEmitter::hasEventListeners(JSC::VM& vm, ASCIILiteral eventType) const
{
    return this->hasEventListeners(Identifier::fromString(vm, eventType));
}

inline void EventEmitter::setMaxListeners(unsigned count)
{
    this->m_maxListeners = count;
}

} // namespace WebCore
