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

// Whether 'removeListener' listeners are called: the JS methods and a once() listener that fires announce, native teardown is silent.
enum class ListenerRemoval : bool {
    Silent,
    Announce,
};

struct EventEmitterData {
    WTF_MAKE_NONCOPYABLE(EventEmitterData);
    WTF_MAKE_TZONE_ALLOCATED(EventEmitterData);

public:
    EventEmitterData() = default;
    IdentifierEventListenerMap eventListenerMap;
    bool isFiringEventListeners { false };
    // Set when a 'removeListener' listener is added. While it is clear, a removal has nobody to tell and looks no further.
    bool mayHaveRemoveListenerListeners { false };
};
static_assert(sizeof(EventEmitterData) == sizeof(IdentifierEventListenerMap) + sizeof(void*), "the flags share the word after the map");

class EventEmitter final : public ScriptWrappable, public CanMakeWeakPtr<EventEmitter>, public RefCounted<EventEmitter>, public ContextDestructionObserver {
    WTF_MAKE_TZONE_ALLOCATED(EventEmitter);

public:
    static Ref<EventEmitter> create(ScriptExecutionContext&);
    WEBCORE_EXPORT ~EventEmitter() = default;

    // ContextDestructionObserver.
    void ref() const final { RefCounted::ref(); }
    void deref() const final { RefCounted::deref(); }
    USING_CAN_MAKE_WEAKPTR(CanMakeWeakPtr<EventEmitter>);

    ScriptExecutionContext* scriptExecutionContext() const { return ContextDestructionObserver::scriptExecutionContext(); };

    bool removeAllListeners(ListenerRemoval);
    WEBCORE_EXPORT void addListenerForBindings(const Identifier& eventType, RefPtr<EventListener>&&, bool, bool);
    // `eventName` is the name as the program passed it: the first argument of the 'removeListener' event.
    WEBCORE_EXPORT void removeListenerForBindings(const Identifier& eventType, JSC::JSValue eventName, RefPtr<EventListener>&&);
    WEBCORE_EXPORT void removeAllListenersForBindings(const Identifier& eventType, JSC::JSValue eventName);
    WEBCORE_EXPORT void removeAllListenersForBindings();
    WEBCORE_EXPORT bool emitForBindings(const Identifier&, const MarkedArgumentBuffer&);

    WEBCORE_EXPORT void addListener(const Identifier& eventType, Ref<EventListener>&&, bool, bool);
    // Without `eventName` the 'removeListener' listeners get `eventType` as a string or a symbol.
    WEBCORE_EXPORT bool removeListener(const Identifier& eventType, EventListener&, ListenerRemoval, JSC::JSValue eventName = {});
    WEBCORE_EXPORT bool removeAllListeners(const Identifier& eventType, ListenerRemoval, JSC::JSValue eventName = {});

    WEBCORE_EXPORT bool emit(const Identifier&, const MarkedArgumentBuffer&);

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

    bool fireEventListeners(const Identifier& eventName, const MarkedArgumentBuffer& arguments);
    bool isFiringEventListeners() const;

    const EventEmitterData* eventTargetData() const;

    template<typename Visitor> void visitJSEventListeners(Visitor& visitor) { m_eventTargetData.eventListenerMap.visitJSEventListeners(visitor); }

    void setThisObject(JSC::JSValue thisObject)
    {
        m_thisObject.clear();

        if (thisObject.isCell()) {
            m_thisObject = JSC::Weak<JSC::JSObject>(thisObject.getObject());
        }
    }

    // For the JS methods that do not store their receiver otherwise: the 'removeListener' listeners get it as `this`.
    void setThisObjectIfAnnouncing(JSC::JSValue thisObject)
    {
        if (m_eventTargetData.mayHaveRemoveListenerListeners) [[unlikely]]
            setThisObject(thisObject);
    }

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

    bool removeListener(const Identifier& eventType, SimpleRegisteredEventListener&, ListenerRemoval, JSC::JSValue eventName = {});
    void didChangeListeners(const Identifier& eventType);
    void didRemoveListener(const Identifier& eventType, EventListener& removed, ListenerRemoval, JSC::JSValue eventName);
    void announceRemoval(const Identifier& eventType, EventListener& removed, JSC::JSValue eventName);
    bool announcesRemovals(ListenerRemoval mode) { return mode == ListenerRemoval::Announce && m_eventTargetData.mayHaveRemoveListenerListeners && hasRemoveListenerListenersToCall(); }
    bool hasRemoveListenerListenersToCall();
    bool innerInvokeEventListeners(const Identifier&, SimpleEventListenerVector, const MarkedArgumentBuffer& arguments);

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
