#include "EventEmitter.h"
#include "BunClientData.h"

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
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(EventEmitter);

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
    // Collect before clearing so per-event teardown (signal handlers, IPC
    // refs, listener-count mirrors) observes the post-removal zero counts.
    Vector<Identifier> eventTypes = map.eventTypes();
    map.clear();
    this->m_thisObject.clear();
    if (any) {
        eventListenersDidChange();
        if (this->onDidChangeListener) {
            for (auto& eventType : eventTypes)
                this->onDidChangeListener(*this, eventType, false);
        }
    }
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

bool EventEmitter::emitForBindings(const Identifier& eventType, const MarkedArgumentBuffer& arguments)
{
    if (!scriptExecutionContext())
        return false;

    return emit(eventType, arguments);
}

// The runtime starts this emit, so no JS caller can receive a listener's exception.
// It is reported once as uncaught, after the pass that it ended.
bool EventEmitter::emit(const Identifier& eventType, const MarkedArgumentBuffer& arguments)
{
    VM& vm = scriptExecutionContext()->vm();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    JSC::JSGlobalObject* listenerGlobal = nullptr;
    bool fired = fireEventListeners(eventType, arguments, listenerGlobal);
    if (auto* exception = scope.exception(); exception && listenerGlobal) [[unlikely]] {
        // A TerminationException is taken here too, as the catching JSC::call did, and the report ignores
        // it. Left pending, it can outlive its termination request (VMTraps::deferTerminationSlow asserts).
        scope.clearException();
        Bun__reportUnhandledError(listenerGlobal, JSValue::encode(exception));
    }
    return fired;
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
            if (registeredListener->wasRemoved()) [[unlikely]]
                continue;

            if (registeredListener->callback().jsFunction()) {
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
            if (registeredListener->wasRemoved()) [[unlikely]]
                continue;

            if (JSC::JSObject* jsFunction = registeredListener->callback().jsFunction()) {
                listeners.append(jsFunction);
            }
        }
    }
    return listeners;
}

// One pass over the listeners of `eventType`, like EventEmitter.prototype.emit in node: it has no catch, so a
// listener's exception ends the pass. Then this returns with the exception pending and `listenerGlobal` set.
bool EventEmitter::fireEventListeners(const Identifier& eventType, const MarkedArgumentBuffer& arguments, JSC::JSGlobalObject*& listenerGlobal)
{

    auto* data = eventTargetData();
    if (!data)
        return false;

    auto* listenersVector = data->eventListenerMap.find(eventType);
    if (!listenersVector) [[unlikely]] {
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
    auto fired = innerInvokeEventListeners(eventType, *listenersVector, arguments, listenerGlobal);
    data->isFiringEventListeners = prevFiringEventListeners;
    return fired;
}

// Intentionally creates a copy of the listeners vector to avoid event listeners added after this point from being run.
// Note that removal still has an effect due to the removed field in RegisteredEventListener.
bool EventEmitter::innerInvokeEventListeners(const Identifier& eventType, SimpleEventListenerVector listeners, const MarkedArgumentBuffer& arguments, JSC::JSGlobalObject*& listenerGlobal)
{
    Ref<EventEmitter> protectedThis(*this);
    ASSERT(!listeners.isEmpty());
    ASSERT(scriptExecutionContext());

    auto& context = *scriptExecutionContext();
    VM& vm = context.vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = protectedThis->m_thisObject.get();
    JSC::JSValue thisValue = thisObject ? thisObject : JSC::jsUndefined();
    auto fired = false;

    for (auto& registeredListener : listeners) {
        // The below code used to be in here, but it's WRONG. Even if a listener is removed,
        // if we're in the middle of firing listeners, we still need to call it.
        // if (registeredListener->wasRemoved()) [[unlikely]]
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

        if (!jsFunction) [[unlikely]]
            continue;
        if (WebCore::clientData(vm)->isStoppingOrStopped(vm)) [[unlikely]]
            break;

        JSC::JSGlobalObject* lexicalGlobalObject = jsFunction->globalObject();
        auto callData = JSC::getCallData(jsFunction);
        if (callData.type == JSC::CallData::Type::None) [[unlikely]]
            continue;

        fired = true;
        call(lexicalGlobalObject, jsFunction, callData, thisValue, arguments);
        if (scope.exception()) [[unlikely]] {
            listenerGlobal = lexicalGlobalObject;
            break;
        }
    }

    return fired;
}

} // namespace WebCore
