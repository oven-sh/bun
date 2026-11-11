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

void EventEmitter::addListener(const Identifier& eventType, Ref<EventListener>&& listener, bool once, bool prepend)
{
    if (prepend)
        ensureEventEmitterData().eventListenerMap.prepend(eventType, WTF::move(listener), once);
    else
        ensureEventEmitterData().eventListenerMap.add(eventType, WTF::move(listener), once);

    if (auto* context = scriptExecutionContext(); context && eventType == builtinNames(context->vm()).removeListenerPublicName())
        m_eventTargetData.mayHaveRemoveListenerListeners = true;

    eventListenersDidChange();
    if (this->onDidChangeListener)
        this->onDidChangeListener(*this, eventType, true);
}

void EventEmitter::addListenerForBindings(const Identifier& eventType, RefPtr<EventListener>&& listener, bool once, bool prepend)
{
    if (!listener)
        return;

    addListener(eventType, listener.releaseNonNull(), once, prepend);
}

// Script may run no longer once a termination is requested. The emit loop takes the exception of the 'removeListener' listener that it ended, so the JS methods that remove throw it again.
static NEVER_INLINE void throwTerminationIfRequested(ScriptExecutionContext* context)
{
    if (!context)
        return;

    auto& vm = context->vm();
    if (!vm.hasTerminationRequest() || vm.hasPendingTerminationException() || vm.traps().isDeferringTermination())
        return;

    auto scope = DECLARE_THROW_SCOPE(vm);
    scope.release();
    vm.throwTerminationException();
}

void EventEmitter::removeListenerForBindings(const Identifier& eventType, JSC::JSValue eventName, RefPtr<EventListener>&& listener)
{
    if (!listener)
        return;

    bool mayAnnounce = m_eventTargetData.mayHaveRemoveListenerListeners;
    removeListener(eventType, *listener, ListenerRemoval::Announce, eventName);
    if (mayAnnounce) [[unlikely]]
        throwTerminationIfRequested(scriptExecutionContext());
}

ALWAYS_INLINE void EventEmitter::didChangeListeners(const Identifier& eventType)
{
    eventListenersDidChange();
    if (this->onDidChangeListener)
        this->onDidChangeListener(*this, eventType, false);
}

// node asks after the removal, so the last 'removeListener' listener is not told of its own: https://github.com/nodejs/node/blob/v26.12.1/lib/events.js#L702
NEVER_INLINE bool EventEmitter::hasRemoveListenerListenersToCall()
{
    auto* context = scriptExecutionContext();
    if (!context)
        return false;

    auto& vm = context->vm();
    if (!m_eventTargetData.eventListenerMap.contains(builtinNames(vm).removeListenerPublicName())) {
        m_eventTargetData.mayHaveRemoveListenerListeners = false;
        return false;
    }
    return !clientData(vm)->isStoppingOrStopped(vm) && !vm.hasTerminationRequest();
}

NEVER_INLINE void EventEmitter::announceRemoval(const Identifier& eventType, EventListener& removed, JSC::JSValue eventName)
{
    // The map no longer marks the function: whoever passed `removed` keeps it alive until here.
    JSC::JSObject* function = removed.jsFunction();
    if (!function) [[unlikely]]
        return;

    auto* globalObject = scriptExecutionContext()->jsGlobalObject();
    auto& vm = JSC::getVM(globalObject);
    // A once() listener of 'removeListener' is removed, and that announced, before it is called: a chain of them nests here with no call of JS in between.
    if (!vm.isSafeToRecurseSoft()) [[unlikely]] {
        Bun__reportUnhandledError(globalObject, JSValue::encode(createStackOverflowError(globalObject)));
        return;
    }

    MarkedArgumentBuffer arguments;
    arguments.append(eventName ? eventName : JSC::identifierToSafePublicJSValue(vm, eventType));
    arguments.append(function);
    fireEventListeners(builtinNames(vm).removeListenerPublicName(), arguments);
}

// Every removal of one listener ends here. The hook runs first, so a 'removeListener' listener finds the signal handler of a last listener uninstalled.
ALWAYS_INLINE void EventEmitter::didRemoveListener(const Identifier& eventType, EventListener& removed, ListenerRemoval mode, JSC::JSValue eventName)
{
    didChangeListeners(eventType);
    if (announcesRemovals(mode)) [[unlikely]]
        announceRemoval(eventType, removed, eventName);
}

bool EventEmitter::removeListener(const Identifier& eventType, EventListener& listener, ListenerRemoval mode, JSC::JSValue eventName)
{
    auto* data = eventTargetData();
    if (!data)
        return false;

    if (data->eventListenerMap.remove(eventType, listener)) {
        didRemoveListener(eventType, listener, mode, eventName);
        return true;
    }
    return false;
}

ALWAYS_INLINE bool EventEmitter::removeListener(const Identifier& eventType, SimpleRegisteredEventListener& registration, ListenerRemoval mode, JSC::JSValue eventName)
{
    auto* data = eventTargetData();
    if (!data)
        return false;

    if (data->eventListenerMap.remove(eventType, registration)) {
        didRemoveListener(eventType, registration.callback(), mode, eventName);
        return true;
    }
    return false;
}

void EventEmitter::removeAllListenersForBindings(const Identifier& eventType, JSC::JSValue eventName)
{
    bool mayAnnounce = m_eventTargetData.mayHaveRemoveListenerListeners;
    removeAllListeners(eventType, ListenerRemoval::Announce, eventName);
    if (mayAnnounce) [[unlikely]]
        throwTerminationIfRequested(scriptExecutionContext());
}

void EventEmitter::removeAllListenersForBindings()
{
    bool mayAnnounce = m_eventTargetData.mayHaveRemoveListenerListeners;
    removeAllListeners(ListenerRemoval::Announce);
    if (mayAnnounce) [[unlikely]]
        throwTerminationIfRequested(scriptExecutionContext());
}

bool EventEmitter::removeAllListeners(ListenerRemoval mode)
{
    auto* data = eventTargetData();
    if (!data)
        return false;

    auto& map = data->eventListenerMap;
    bool any = !map.isEmpty();
    if (announcesRemovals(mode)) [[unlikely]] {
        // 'removeListener' goes last, so its listeners are told of every removal. What they add meanwhile goes untold: https://github.com/nodejs/node/blob/v26.12.1/lib/events.js#L765-L772
        auto& vm = scriptExecutionContext()->vm();
        auto& removeListenerEvent = builtinNames(vm).removeListenerPublicName();
        for (auto& eventType : getEventNames()) {
            if (eventType != removeListenerEvent)
                removeAllListeners(eventType, mode);
            // A termination ended a 'removeListener' listener. The rest stays, as where an exception leaves node's loop.
            if (vm.hasTerminationRequest()) [[unlikely]]
                return any;
        }
        removeAllListeners(removeListenerEvent, mode);
        if (vm.hasTerminationRequest()) [[unlikely]]
            return any;
    }

    // Collect before clearing so per-event teardown (signal handlers, IPC
    // refs, listener-count mirrors) observes the post-removal zero counts.
    Vector<Identifier> eventTypes = map.eventTypes();
    map.clear();
    data->mayHaveRemoveListenerListeners = false;
    this->m_thisObject.clear();
    for (auto& eventType : eventTypes)
        didChangeListeners(eventType);
    return any;
}

bool EventEmitter::removeAllListeners(const Identifier& eventType, ListenerRemoval mode, JSC::JSValue eventName)
{
    auto* data = eventTargetData();
    if (!data)
        return false;

    if (announcesRemovals(mode)) [[unlikely]] {
        auto* listeners = data->eventListenerMap.find(eventType);
        if (!listeners)
            return false;

        // removeListener() for each entry, the last first. node passes the wrapper of a once() listener, which names that registration, or the function, which names its last one: https://github.com/nodejs/node/blob/v26.12.1/lib/events.js#L777-L786
        SimpleEventListenerVector registrations = *listeners;
        auto& vm = scriptExecutionContext()->vm();
        for (size_t i = registrations.size(); i > 0 && !vm.hasTerminationRequest(); --i) {
            auto& registration = *registrations[i - 1];
            JSC::EnsureStillAliveScope function(registration.callback().jsFunction());
            if (registration.isOnce())
                removeListener(eventType, registration, mode, eventName);
            else
                removeListener(eventType, registration.callback(), mode, eventName);
        }
        return true;
    }

    if (data->eventListenerMap.removeAll(eventType)) {
        didChangeListeners(eventType);
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

    return emit(eventType, arguments);
}

bool EventEmitter::emit(const Identifier& eventType, const MarkedArgumentBuffer& arguments)
{
    return fireEventListeners(eventType, arguments);
}

static NEVER_INLINE Vector<Identifier> inOwnKeyOrder(const Vector<Identifier>& names)
{
    // An entry holds an array index above the position of its name, so a sort of the entries sorts those names.
    Vector<uint64_t> indexes;
    Vector<Identifier> strings;
    Vector<Identifier> symbols;
    for (unsigned position = 0; position < names.size(); ++position) {
        auto& name = names[position];
        if (name.isSymbol())
            symbols.append(name);
        else if (auto index = parseIndex(name))
            indexes.append((static_cast<uint64_t>(*index) << 32) | position);
        else
            strings.append(name);
    }
    std::sort(indexes.begin(), indexes.end());

    Vector<Identifier> ordered;
    ordered.reserveInitialCapacity(names.size());
    for (uint64_t entry : indexes)
        ordered.append(names[static_cast<uint32_t>(entry)]);
    ordered.appendVector(strings);
    ordered.appendVector(symbols);
    return ordered;
}

// In the order of Reflect.ownKeys() on node's `_events`: array indexes ascending, then the other strings, then the symbols.
Vector<Identifier> EventEmitter::getEventNames()
{
    auto* data = eventTargetData();
    if (!data)
        return {};

    // The map lists the names as they were added. That is the order, unless a name is an array index or a string follows a symbol.
    auto eventTypes = data->eventListenerMap.eventTypes();
    bool sawSymbol = false;
    for (auto& eventType : eventTypes) {
        if (eventType.isSymbol())
            sawSymbol = true;
        else if (sawSymbol || parseIndex(eventType)) [[unlikely]]
            return inOwnKeyOrder(eventTypes);
    }
    return eventTypes;
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

// https://dom.spec.whatwg.org/#concept-event-listener-invoke
bool EventEmitter::fireEventListeners(const Identifier& eventType, const MarkedArgumentBuffer& arguments)
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
        if (registeredListener->isOnce()) {
            // An emit from inside an earlier listener already ran it.
            if (registeredListener->hasFired()) [[unlikely]]
                continue;
            registeredListener->markAsFired();
            removeListener(eventType, *registeredListener, ListenerRemoval::Announce);
            // A termination ended a 'removeListener' listener: this listener does not run behind it.
            if (vm.hasTerminationRequest()) [[unlikely]]
                break;
        }

        if (!jsFunction) [[unlikely]]
            continue;
        if (WebCore::clientData(vm)->isStoppingOrStopped(vm)) [[unlikely]]
            break;

        JSC::JSGlobalObject* lexicalGlobalObject = jsFunction->globalObject();
        auto callData = JSC::getCallData(jsFunction);
        if (callData.type == JSC::CallData::Type::None) [[unlikely]]
            continue;

        fired = true;
        WTF::NakedPtr<JSC::Exception> exceptionPtr;
        call(lexicalGlobalObject, jsFunction, callData, thisValue, arguments, exceptionPtr);
        auto* exception = exceptionPtr.get();

        if (exception) [[unlikely]] {
            auto errorIdentifier = vm.propertyNames->error;
            auto hasErrorListener = this->hasActiveEventListeners(errorIdentifier);
            if (!hasErrorListener || eventType == errorIdentifier) {
                // If the event type is error, report the exception to the console.
                Bun__reportUnhandledError(lexicalGlobalObject, JSValue::encode(exception));
            } else if (hasErrorListener) {
                MarkedArgumentBuffer expcep;
                JSValue errorValue = exception->value();
                if (!errorValue) {
                    errorValue = JSC::jsUndefined();
                }
                expcep.append(errorValue);
                fireEventListeners(errorIdentifier, WTF::move(expcep));
            }
        }
    }

    return fired;
}

} // namespace WebCore
