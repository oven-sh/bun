#include <iostream>
#include "config.h"
#include "Event.h"

#include "EventEmitter.h"

#include "AddEventListenerOptions.h"
#include "DOMWrapperWorld.h"
#include "EventNames.h"
#include "JSErrorHandler.h"
#include "JSEventListener.h"
#include <wtf/MainThread.h>
#include <wtf/NeverDestroyed.h>
#include <wtf/Ref.h>
#include <wtf/SetForScope.h>
#include <wtf/StdLibExtras.h>
#include <wtf/Vector.h>

namespace WebCore {

WTF_MAKE_ISO_ALLOCATED_IMPL(EventEmitter);
WTF_MAKE_ISO_ALLOCATED_IMPL(EventEmitterWithInlineData);

Ref<EventEmitter> EventEmitter::create(ScriptExecutionContext& context)
{
    return adoptRef(*new EventEmitter(context));
}

bool EventEmitter::addListener(const AtomString& eventType, Ref<EventListener>&& listener, bool once, bool prepend)
{
    bool listenerCreatedFromScript = is<JSEventListener>(listener) && !downcast<JSEventListener>(listener.get()).wasCreatedFromMarkup();

    if (prepend) {
        if (!ensureEventEmitterData().eventListenerMap.prepend(eventType, listener.copyRef(), { false, false, once }))
            return false;
    } else {
        if (!ensureEventEmitterData().eventListenerMap.add(eventType, listener.copyRef(), { false, false, once }))
            return false;
    }


    eventListenersDidChange();
    return true;
}

void EventEmitter::addListenerForBindings(const AtomString& eventType, RefPtr<EventListener>&& listener, bool once, bool prepend)
{
    if (!listener)
        return;

    addListener(eventType, listener.releaseNonNull(), once, prepend);
}

void EventEmitter::removeListenerForBindings(const AtomString& eventType, RefPtr<EventListener>&& listener)
{
    if (!listener)
        return;

    removeListener(eventType, *listener);
}

bool EventEmitter::removeListener(const AtomString& eventType, EventListener& listener)
{
    auto* data = eventTargetData();
    if (!data)
        return false;

    if (data->eventListenerMap.remove(eventType, listener, false)) {
        if (eventNames().isWheelEventType(eventType))
            invalidateEventListenerRegions();

        eventListenersDidChange();
        return true;
    }
    return false;
}

void EventEmitter::removeAllListenersForBindings(const AtomString& eventType)
{
    removeAllListeners(eventType);
}

bool EventEmitter::removeAllListeners(const AtomString& eventType)
{
    auto* data = eventTargetData();
    if (!data)
        return false;

    if (data->eventListenerMap.removeAll(eventType)) {
        if (eventNames().isWheelEventType(eventType))
            invalidateEventListenerRegions();

        eventListenersDidChange();
        return true;
    }
    return false;
}

bool EventEmitter::hasActiveEventListeners(const AtomString& eventType) const
{
    auto* data = eventTargetData();
    return data && data->eventListenerMap.containsActive(eventType);
}

bool EventEmitter::emitForBindings(const AtomString& eventType)
{
    if (!scriptExecutionContext())
        return false;

    emit(eventType);
    return true;
}

void EventEmitter::emit(const AtomString& eventType)
{
    fireEventListeners(eventType);
}

void EventEmitter::uncaughtExceptionInEventHandler()
{
}

Vector<AtomString> EventEmitter::getEventNames()
{
    auto* data = eventTargetData();
    if (!data)
        return {};
    return data->eventListenerMap.eventTypes();
}

int EventEmitter::listenerCount(const AtomString& eventType)
{
    auto* data = eventTargetData();
    if (!data)
        return 0;
    int result = 0;
    if (auto* listenersVector = data->eventListenerMap.find(eventType)) {
        for (auto& registeredListener : *listenersVector) {
            if (UNLIKELY(registeredListener->wasRemoved()))
                continue;

            if (JSC::JSObject* jsFunction = registeredListener->callback().jsFunction()) {
                result++;
            }
        }
    }
    return result;
}

Vector<JSObject*> EventEmitter::getListeners(const AtomString& eventType)
{
    auto* data = eventTargetData();
    if (!data)
        return {};
    Vector<JSObject*> listeners;
    if (auto* listenersVector = data->eventListenerMap.find(eventType)) {
        for (auto& registeredListener : *listenersVector) {
            if (UNLIKELY(registeredListener->wasRemoved()))
                continue;

            if (JSC::JSObject* jsFunction = registeredListener->callback().jsFunction()) {
                listeners.append(jsFunction);
            }
        }
    }
    return listeners;
}

static const AtomString& legacyType(const Event& event)
{

    return nullAtom();
}

// https://dom.spec.whatwg.org/#concept-event-listener-invoke
void EventEmitter::fireEventListeners(const AtomString& eventType)
{
    ASSERT_WITH_SECURITY_IMPLICATION(ScriptDisallowedScope::isEventAllowedInMainThread());

    auto* data = eventTargetData();
    if (!data)
        return;

    SetForScope firingEventListenersScope(data->isFiringEventListeners, true);

    if (auto* listenersVector = data->eventListenerMap.find(eventType)) {
        innerInvokeEventListeners(eventType, *listenersVector);
        return;
    }
}

// Intentionally creates a copy of the listeners vector to avoid event listeners added after this point from being run.
// Note that removal still has an effect due to the removed field in RegisteredEventListener.
// https://dom.spec.whatwg.org/#concept-event-listener-inner-invoke
void EventEmitter::innerInvokeEventListeners(const AtomString& eventType, EventListenerVector listeners)
{
    Ref<EventEmitter> protectedThis(*this);
    ASSERT(!listeners.isEmpty());
    ASSERT(scriptExecutionContext());

    auto& context = *scriptExecutionContext();
    VM& vm = context.vm();

    for (auto& registeredListener : listeners) {
        if (UNLIKELY(registeredListener->wasRemoved()))
            continue;

        // Make sure the JS wrapper and function stay alive until the end of this scope. Otherwise,
        // event listeners with 'once' flag may get collected as soon as they get unregistered below,
        // before we call the js function.
        JSC::EnsureStillAliveScope wrapperProtector(registeredListener->callback().wrapper());
        JSC::EnsureStillAliveScope jsFunctionProtector(registeredListener->callback().jsFunction());

        // Do this before invocation to avoid reentrancy issues.
        if (registeredListener->isOnce())
            removeListener(eventType, registeredListener->callback());

        if (JSC::JSObject* jsFunction = registeredListener->callback().jsFunction()) {
            JSC::JSGlobalObject* lexicalGlobalObject = jsFunction->globalObject();
            auto callData = JSC::getCallData(jsFunction);
            JSC::MarkedArgumentBuffer arguments;
            JSC::call(jsFunction->globalObject(), jsFunction, callData, JSC::jsUndefined(), arguments);
        }
    }
}

Vector<AtomString> EventEmitter::eventTypes()
{
    if (auto* data = eventTargetData())
        return data->eventListenerMap.eventTypes();
    return {};
}

const EventListenerVector& EventEmitter::eventListeners(const AtomString& eventType)
{
    auto* data = eventTargetData();
    auto* listenerVector = data ? data->eventListenerMap.find(eventType) : nullptr;
    static NeverDestroyed<EventListenerVector> emptyVector;
    return listenerVector ? *listenerVector : emptyVector.get();
}

void EventEmitter::invalidateEventListenerRegions()
{
}

} // namespace WebCore
