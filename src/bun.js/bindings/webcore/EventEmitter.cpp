#include "EventEmitter.h"

#include "Event.h"

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

Ref<EventEmitter> EventEmitter::create(ScriptExecutionContext& context)
{
    return adoptRef(*new EventEmitter(context));
}

bool EventEmitter::addListener(const Identifier& eventType, Ref<EventListener>&& listener, bool once, bool prepend)
{

    if (prepend) {
        if (!ensureEventEmitterData().eventListenerMap.prepend(eventType, listener.copyRef(), once))
            return false;
    } else {
        if (!ensureEventEmitterData().eventListenerMap.add(eventType, listener.copyRef(), once))
            return false;
    }

    eventListenersDidChange();
    if (this->onDidChangeListener)
        this->onDidChangeListener(*this, eventType, true);
    return true;
}

void EventEmitter::addListenerForBindings(const Identifier& eventType, RefPtr<EventListener>&& listener, bool once, bool prepend)
{
    if (!listener)
        return;

    addListener(eventType, listener.releaseNonNull(), once, prepend);
}

void EventEmitter::removeListenerForBindings(const Identifier& eventType, RefPtr<EventListener>&& listener)
{
    if (!listener)
        return;

    removeListener(eventType, *listener);
}

bool EventEmitter::removeListener(const Identifier& eventType, EventListener& listener)
{
    auto* data = eventTargetData();
    if (!data)
        return false;

    if (data->eventListenerMap.remove(eventType, listener)) {
        eventListenersDidChange();

        if (this->onDidChangeListener)
            this->onDidChangeListener(*this, eventType, false);
        return true;
    }
    return false;
}

void EventEmitter::removeAllListenersForBindings(const Identifier& eventType)
{
    removeAllListeners(eventType);
}

bool EventEmitter::removeAllListeners()
{
    auto* data = eventTargetData();
    if (!data)
        return false;

    auto& map = data->eventListenerMap;
    bool any = !map.isEmpty();
    map.clear();
    this->m_thisObject.clear();
    return any;
}

bool EventEmitter::removeAllListeners(const Identifier& eventType)
{
    auto* data = eventTargetData();
    if (!data)
        return false;

    if (data->eventListenerMap.removeAll(eventType)) {
        eventListenersDidChange();
        if (this->onDidChangeListener)
            this->onDidChangeListener(*this, eventType, false);
        return true;
    }
    return false;
}

bool EventEmitter::hasActiveEventListeners(const Identifier& eventType) const
{
    auto* data = eventTargetData();
    return data && data->eventListenerMap.containsActive(eventType);
}

bool EventEmitter::emitForBindings(const Identifier& eventType, const MarkedArgumentBuffer& arguments)
{
    if (!scriptExecutionContext())
        return false;

    emit(eventType, arguments);
    return true;
}

bool EventEmitter::emit(const Identifier& eventType, const MarkedArgumentBuffer& arguments)
{
    return fireEventListeners(eventType, arguments);
}

void EventEmitter::uncaughtExceptionInEventHandler()
{
}

Vector<Identifier> EventEmitter::getEventNames()
{
    auto* data = eventTargetData();
    if (!data)
        return {};
    return data->eventListenerMap.eventTypes();
}

int EventEmitter::listenerCount(const Identifier& eventType)
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

Vector<JSObject*> EventEmitter::getListeners(const Identifier& eventType)
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

// https://dom.spec.whatwg.org/#concept-event-listener-invoke
bool EventEmitter::fireEventListeners(const Identifier& eventType, const MarkedArgumentBuffer& arguments)
{

    auto* data = eventTargetData();
    if (!data)
        return false;

    auto* listenersVector = data->eventListenerMap.find(eventType);
    if (UNLIKELY(!listenersVector)) {
        if (eventType == scriptExecutionContext()->vm().propertyNames->error && arguments.size() > 0) {
            Ref<EventEmitter> protectedThis(*this);
            auto* thisObject = protectedThis->m_thisObject.get();
            if (!thisObject)
                return false;

            Bun__reportUnhandledError(thisObject->globalObject(), JSValue::encode(arguments.at(0)));
            return false;
        }
        return false;
    }

    bool prevFiringEventListeners = data->isFiringEventListeners;
    data->isFiringEventListeners = true;
    auto fired = innerInvokeEventListeners(eventType, *listenersVector, arguments);
    data->isFiringEventListeners = prevFiringEventListeners;
    return fired;
}

// Intentionally creates a copy of the listeners vector to avoid event listeners added after this point from being run.
// Note that removal still has an effect due to the removed field in RegisteredEventListener.
// https://dom.spec.whatwg.org/#concept-event-listener-inner-invoke
bool EventEmitter::innerInvokeEventListeners(const Identifier& eventType, SimpleEventListenerVector listeners, const MarkedArgumentBuffer& arguments)
{
    Ref<EventEmitter> protectedThis(*this);
    ASSERT(!listeners.isEmpty());
    ASSERT(scriptExecutionContext());

    auto& context = *scriptExecutionContext();
    VM& vm = context.vm();

    auto* thisObject = protectedThis->m_thisObject.get();
    JSC::JSValue thisValue = thisObject ? JSC::JSValue(thisObject) : JSC::jsUndefined();
    auto fired = false;

    for (auto& registeredListener : listeners) {
        // The below code used to be in here, but it's WRONG. Even if a listener is removed,
        // if we're in the middle of firing listeners, we still need to call it.
        // if (UNLIKELY(registeredListener->wasRemoved()))
        //     continue;

        auto& callback = registeredListener->callback();

        // Make sure the JS wrapper and function stay alive until the end of this scope. Otherwise,
        // event listeners with 'once' flag may get collected as soon as they get unregistered below,
        // before we call the js function.
        JSObject* jsFunction = callback.jsFunction();
        JSC::EnsureStillAliveScope wrapperProtector(callback.wrapper());
        JSC::EnsureStillAliveScope jsFunctionProtector(jsFunction);

        // Do this before invocation to avoid reentrancy issues.
        if (registeredListener->isOnce())
            removeListener(eventType, callback);

        if (UNLIKELY(!jsFunction))
            continue;

        JSC::JSGlobalObject* lexicalGlobalObject = jsFunction->globalObject();
        auto callData = JSC::getCallData(jsFunction);
        if (UNLIKELY(callData.type == JSC::CallData::Type::None))
            continue;

        fired = true;
        WTF::NakedPtr<JSC::Exception> exceptionPtr;
        call(lexicalGlobalObject, jsFunction, callData, thisValue, arguments, exceptionPtr);
        auto* exception = exceptionPtr.get();

        if (UNLIKELY(exception)) {
            auto errorIdentifier = vm.propertyNames->error;
            auto hasErrorListener = this->hasActiveEventListeners(errorIdentifier);
            if (!hasErrorListener || eventType == errorIdentifier) {
                // If the event type is error, report the exception to the console.
                Bun__reportUnhandledError(lexicalGlobalObject, JSValue::encode(JSValue(exception)));
            } else if (hasErrorListener) {
                MarkedArgumentBuffer expcep;
                JSValue errorValue = exception->value();
                if (!errorValue) {
                    errorValue = JSC::jsUndefined();
                }
                expcep.append(errorValue);
                fireEventListeners(errorIdentifier, WTFMove(expcep));
            }
        }
    }

    return fired;
}

Vector<Identifier> EventEmitter::eventTypes()
{
    if (auto* data = eventTargetData())
        return data->eventListenerMap.eventTypes();
    return {};
}

const SimpleEventListenerVector& EventEmitter::eventListeners(const Identifier& eventType)
{
    auto* data = eventTargetData();
    auto* listenerVector = data ? data->eventListenerMap.find(eventType) : nullptr;
    static NeverDestroyed<SimpleEventListenerVector> emptyVector;
    return listenerVector ? *listenerVector : emptyVector.get();
}

void EventEmitter::invalidateEventListenerRegions()
{
}

} // namespace WebCore
