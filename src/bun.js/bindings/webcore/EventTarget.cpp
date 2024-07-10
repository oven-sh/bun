/*
 * Copyright (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 *           (C) 2001 Dirk Mueller (mueller@kde.org)
 * Copyright (C) 2004-2021 Apple Inc. All rights reserved.
 * Copyright (C) 2006 Alexey Proskuryakov (ap@webkit.org)
 *           (C) 2007, 2008 Nikolas Zimmermann <zimmermann@kde.org>
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

#include "config.h"
#include "Event.h"

#include "EventTarget.h"

#include "AddEventListenerOptions.h"
#include "DOMWrapperWorld.h"
#include "EventNames.h"
#include "EventTargetConcrete.h"
// #include "HTMLBodyElement.h"
// #include "HTMLHtmlElement.h"
// #include "InspectorInstrumentation.h"
#include "JSErrorHandler.h"
#include "JSEventListener.h"
// #include "Logging.h"
// #include "Quirks.h"
// #include "ScriptController.h"
// #include "ScriptDisallowedScope.h"
// #include "Settings.h"
// #include <wtf/IsoMallocInlines.h>
#include <wtf/MainThread.h>
#include <wtf/NeverDestroyed.h>
#include <wtf/Ref.h>
#include <wtf/SetForScope.h>
#include <wtf/StdLibExtras.h>
#include <wtf/Vector.h>

namespace WebCore {

WTF_MAKE_ISO_ALLOCATED_IMPL(EventTarget);
WTF_MAKE_ISO_ALLOCATED_IMPL(EventTargetWithInlineData);

Ref<EventTarget> EventTarget::create(ScriptExecutionContext& context)
{
    return EventTargetConcrete::create(context);
}

EventTarget::~EventTarget() = default;

bool EventTarget::isNode() const
{
    return false;
}

bool EventTarget::isContextStopped() const
{
    return !scriptExecutionContext();
}

bool EventTarget::isPaymentRequest() const
{
    return false;
}

bool EventTarget::addEventListener(const AtomString& eventType, Ref<EventListener>&& listener, const AddEventListenerOptions& options)
{
#if ASSERT_ENABLED
    listener->checkValidityForEventTarget(*this);
#endif

    if (options.signal && options.signal->aborted())
        return false;

    auto passive = options.passive;

    // if (!passive.has_value() && Quirks::shouldMakeEventListenerPassive(*this, eventType, listener.get()))
    //     passive = true;

    if (!ensureEventTargetData().eventListenerMap.add(eventType, listener.copyRef(), { options.capture, passive.value_or(false), options.once }))
        return false;

    if (options.signal) {
        options.signal->addAlgorithm([weakThis = WeakPtr { *this }, eventType, listener = WeakPtr { listener }, capture = options.capture](JSC::JSValue value) {
            if (weakThis && listener)
                weakThis->removeEventListener(eventType, *listener, capture);
        });
    }

    // if (listenerCreatedFromScript)
    //     InspectorInstrumentation::didAddEventListener(*this, eventType, listener.get(), options.capture);

    // if (eventNames().isWheelEventType(eventType))
    // invalidateEventListenerRegions();

    eventListenersDidChange();
    if (UNLIKELY(this->onDidChangeListener)) {
        this->onDidChangeListener(*this, eventType, OnDidChangeListenerKind::Add);
    }
    return true;
}

void EventTarget::addEventListenerForBindings(const AtomString& eventType, RefPtr<EventListener>&& listener, AddEventListenerOptionsOrBoolean&& variant)
{
    if (!listener)
        return;

    auto visitor = WTF::makeVisitor([&](const AddEventListenerOptions& options) { addEventListener(eventType, listener.releaseNonNull(), options); }, [&](bool capture) { addEventListener(eventType, listener.releaseNonNull(), capture); });

    std::visit(visitor, variant);
}

void EventTarget::removeEventListenerForBindings(const AtomString& eventType, RefPtr<EventListener>&& listener, EventListenerOptionsOrBoolean&& variant)
{
    if (!listener)
        return;

    auto visitor = WTF::makeVisitor([&](const EventListenerOptions& options) { removeEventListener(eventType, *listener, options); }, [&](bool capture) { removeEventListener(eventType, *listener, capture); });

    std::visit(visitor, variant);
}

bool EventTarget::removeEventListener(const AtomString& eventType, EventListener& listener, const EventListenerOptions& options)
{
    auto* data = eventTargetData();
    if (!data)
        return false;

    // InspectorInstrumentation::willRemoveEventListener(*this, eventType, listener, options.capture);

    if (data->eventListenerMap.remove(eventType, listener, options.capture)) {
        if (eventNames().isWheelEventType(eventType))
            invalidateEventListenerRegions();

        if (UNLIKELY(this->onDidChangeListener)) {
            this->onDidChangeListener(*this, eventType, OnDidChangeListenerKind::Remove);
        }
        eventListenersDidChange();
        return true;
    }
    return false;
}

template<typename JSMaybeErrorEventListener>
void EventTarget::setAttributeEventListener(const AtomString& eventType, JSC::JSValue listener, JSC::JSObject& jsEventTarget)
{
    auto& isolatedWorld = worldForDOMObject(jsEventTarget);
    auto* existingListener = attributeEventListener(eventType, isolatedWorld);
    if (!listener.isObject()) {
        if (existingListener)
            removeEventListener(eventType, *existingListener, false);
    } else if (existingListener) {
        // bool capture = false;

        // InspectorInstrumentation::willRemoveEventListener(*this, eventType, *existingListener, capture);
        existingListener->replaceJSFunctionForAttributeListener(asObject(listener), &jsEventTarget);
        // InspectorInstrumentation::didAddEventListener(*this, eventType, *existingListener, capture);
    } else
        addEventListener(eventType, JSMaybeErrorEventListener::create(*asObject(listener), jsEventTarget, true, isolatedWorld), {});
}

template void EventTarget::setAttributeEventListener<JSErrorHandler>(const AtomString& eventType, JSC::JSValue listener, JSC::JSObject& jsEventTarget);
template void EventTarget::setAttributeEventListener<JSEventListener>(const AtomString& eventType, JSC::JSValue listener, JSC::JSObject& jsEventTarget);

bool EventTarget::setAttributeEventListener(const AtomString& eventType, RefPtr<EventListener>&& listener, DOMWrapperWorld& isolatedWorld)
{
    auto* existingListener = attributeEventListener(eventType, isolatedWorld);
    if (!listener) {
        if (existingListener)
            removeEventListener(eventType, *existingListener, false);
        return false;
    }
    // if (existingListener) {
    //     InspectorInstrumentation::willRemoveEventListener(*this, eventType, *existingListener, false);

#if ASSERT_ENABLED
    listener->checkValidityForEventTarget(*this);
#endif

    auto listenerPointer = listener.copyRef();
    eventTargetData()->eventListenerMap.replace(eventType, *existingListener, listener.releaseNonNull(), {});

    // InspectorInstrumentation::didAddEventListener(*this, eventType, *listenerPointer, false);

    return true;

    return addEventListener(eventType, listener.releaseNonNull(), {});
}

JSEventListener* EventTarget::attributeEventListener(const AtomString& eventType, DOMWrapperWorld& isolatedWorld)
{
    for (auto& eventListener : eventListeners(eventType)) {
        auto& listener = eventListener->callback();
        if (listener.type() != EventListener::JSEventListenerType)
            continue;

        auto& jsListener = downcast<JSEventListener>(listener);
        if (jsListener.isAttribute() && &jsListener.isolatedWorld() == &isolatedWorld)
            return &jsListener;
    }

    return nullptr;
}

bool EventTarget::hasActiveEventListeners(const AtomString& eventType) const
{
    auto* data = eventTargetData();
    return data && data->eventListenerMap.containsActive(eventType);
}

ExceptionOr<bool> EventTarget::dispatchEventForBindings(Event& event)
{
    if (!event.isInitialized() || event.isBeingDispatched())
        return Exception { InvalidStateError };

    if (!scriptExecutionContext())
        return false;

    event.setUntrusted();

    dispatchEvent(event);
    return event.legacyReturnValue();
}

void EventTarget::dispatchEvent(Event& event)
{
    // FIXME: We should always use EventDispatcher.
    ASSERT(event.isInitialized());
    ASSERT(!event.isBeingDispatched());

    event.setTarget(this);
    event.setCurrentTarget(this);
    event.setEventPhase(Event::AT_TARGET);
    event.resetBeforeDispatch();
    fireEventListeners(event, EventInvokePhase::Capturing);
    fireEventListeners(event, EventInvokePhase::Bubbling);
    event.resetAfterDispatch();
}

void EventTarget::uncaughtExceptionInEventHandler()
{
}

static const AtomString& legacyType(const Event& event)
{

    return nullAtom();
}

// https://dom.spec.whatwg.org/#concept-event-listener-invoke
void EventTarget::fireEventListeners(Event& event, EventInvokePhase phase)
{
    ASSERT(event.isInitialized());

    auto* data = eventTargetData();
    if (!data)
        return;

    SetForScope firingEventListenersScope(data->isFiringEventListeners, true);

    if (auto* listenersVector = data->eventListenerMap.find(event.type())) {
        innerInvokeEventListeners(event, *listenersVector, phase);
        return;
    }

    // Only fall back to legacy types for trusted events.
    if (!event.isTrusted())
        return;

    const AtomString& legacyTypeName = legacyType(event);
    if (!legacyTypeName.isNull()) {
        if (auto* legacyListenersVector = data->eventListenerMap.find(legacyTypeName)) {
            AtomString typeName = event.type();
            event.setType(legacyTypeName);
            innerInvokeEventListeners(event, *legacyListenersVector, phase);
            event.setType(typeName);
        }
    }
}

// Intentionally creates a copy of the listeners vector to avoid event listeners added after this point from being run.
// Note that removal still has an effect due to the removed field in RegisteredEventListener.
// https://dom.spec.whatwg.org/#concept-event-listener-inner-invoke
void EventTarget::innerInvokeEventListeners(Event& event, EventListenerVector listeners, EventInvokePhase phase)
{
    Ref<EventTarget> protectedThis(*this);
    ASSERT(!listeners.isEmpty());
    ASSERT(scriptExecutionContext());

    auto& context = *scriptExecutionContext();
    // bool contextIsDocument = is<Document>(context);
    // if (contextIsDocument)
    //     InspectorInstrumentation::willDispatchEvent(downcast<Document>(context), event);

    for (auto& registeredListener : listeners) {
        if (UNLIKELY(registeredListener->wasRemoved()))
            continue;

        if (phase == EventInvokePhase::Capturing && !registeredListener->useCapture())
            continue;
        if (phase == EventInvokePhase::Bubbling && registeredListener->useCapture())
            continue;

        // if (InspectorInstrumentation::isEventListenerDisabled(*this, event.type(), registeredListener->callback(), registeredListener->useCapture()))
        //     continue;

        // If stopImmediatePropagation has been called, we just break out immediately, without
        // handling any more events on this target.
        if (event.immediatePropagationStopped())
            break;

        // Make sure the JS wrapper and function stay alive until the end of this scope. Otherwise,
        // event listeners with 'once' flag may get collected as soon as they get unregistered below,
        // before we call the js function.
        JSC::EnsureStillAliveScope wrapperProtector(registeredListener->callback().wrapper());
        JSC::EnsureStillAliveScope jsFunctionProtector(registeredListener->callback().jsFunction());

        // Do this before invocation to avoid reentrancy issues.
        if (registeredListener->isOnce())
            removeEventListener(event.type(), registeredListener->callback(), registeredListener->useCapture());

        if (registeredListener->isPassive())
            event.setInPassiveListener(true);

#if ASSERT_ENABLED
        registeredListener->callback().checkValidityForEventTarget(*this);
#endif

        // InspectorInstrumentation::willHandleEvent(context, event, *registeredListener);
        registeredListener->callback().handleEvent(context, event);
        // InspectorInstrumentation::didHandleEvent(context, event, *registeredListener);

        // if (registeredListener->isPassive())
        // event.setInPassiveListener(false);
    }

    // if (contextIsDocument)
    //     InspectorInstrumentation::didDispatchEvent(downcast<Document>(context), event);
}

Vector<AtomString> EventTarget::eventTypes()
{
    if (auto* data = eventTargetData())
        return data->eventListenerMap.eventTypes();
    return {};
}

const EventListenerVector& EventTarget::eventListeners(const AtomString& eventType)
{
    auto* data = eventTargetData();
    auto* listenerVector = data ? data->eventListenerMap.find(eventType) : nullptr;
    static NeverDestroyed<EventListenerVector> emptyVector;
    return listenerVector ? *listenerVector : emptyVector.get();
}

void EventTarget::removeAllEventListeners()
{
    // auto& threadData = threadGlobalData();
    // RELEASE_ASSERT(!threadData.isInRemoveAllEventListeners());

    // threadData.setIsInRemoveAllEventListeners(true);

    auto* data = eventTargetData();
    if (data && !data->eventListenerMap.isEmpty()) {
        // if (data->eventListenerMap.contains(eventNames().wheelEvent) || data->eventListenerMap.contains(eventNames().mousewheelEvent))
        // invalidateEventListenerRegions();

        if (UNLIKELY(this->onDidChangeListener)) {
            for (auto& eventType : data->eventListenerMap.eventTypes()) {
                this->onDidChangeListener(*this, eventType, OnDidChangeListenerKind::Clear);
            }
        }
        data->eventListenerMap.clear();
        eventListenersDidChange();
    }

    // threadData.setIsInRemoveAllEventListeners(false);
}

void EventTarget::invalidateEventListenerRegions()
{
}

} // namespace WebCore
