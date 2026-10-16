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
#include "EventTarget.h"

#include "AbortSignal.h"
#include "DOMWrapperWorld.h"
#include "Document.h"
#include "Event.h"
#include "EventNames.h"
#include "EventPath.h"
#include "EventTargetConcrete.h"
#include "EventTargetInlines.h"
#include "ExceptionOr.h"
#include "HTMLBodyElement.h"
#include "JSErrorHandler.h"
#include "JSEventListener.h"
#include "NodeDocument.h"
#include "ScriptDisallowedScope.h"
#include "WebCoreOpaqueRoot.h"
#include "Window.h"
#include <JavaScriptCore/HeapCellInlines.h>
#include <JavaScriptCore/JSCJSValueStructure.h>
#include <wtf/MainThread.h>
#include <wtf/NeverDestroyed.h>
#include <wtf/Ref.h>
#include <wtf/SetForScope.h>
#include <wtf/StdLibExtras.h>
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(EventTargetData);
WTF_MAKE_TZONE_ALLOCATED_IMPL(EventTarget);

struct SameSizeAsEventTarget : ScriptWrappable, CanMakeWeakPtrWithBitField<EventTarget, WeakPtrFactoryInitialization::Lazy, WeakPtrImplWithEventTargetData> {
    virtual ~SameSizeAsEventTarget() = default; // Allocate vtable pointer.
};

static_assert(sizeof(EventTarget) == sizeof(SameSizeAsEventTarget), "EventTarget should stay small");

Ref<EventTarget> EventTarget::create(ScriptExecutionContext& context)
{
    return EventTargetConcrete::create(context);
}

EventTarget::~EventTarget()
{
    // Explicitly tearing down since WeakPtrImpl can be alive longer than EventTarget.
    if (auto* eventTargetData = this->eventTargetData())
        eventTargetData->clear();
}

WebCoreOpaqueRoot EventTarget::opaqueRoot() const
{
    // FIXME: Remove suppression once rdar://189998365 is fixed.
    SUPPRESS_MEMORY_UNSAFE_CAST return WebCoreOpaqueRoot { const_cast<EventTarget*>(this) };
}

// https://dom.spec.whatwg.org/#default-passive-value
static bool shouldMakeEventListenerPassive(const EventTarget& eventTarget, const AtomString& eventType)
{
    auto* node = dynamicDowncast<Node>(eventTarget);
    if (!node && !is<Window>(eventTarget))
        return false;

    auto typeInfo = eventNames().typeInfoForEvent(eventType);
    if (!typeInfo.isInCategory(EventCategory::TouchScrollBlocking) && !typeInfo.isInCategory(EventCategory::Wheel))
        return false;

    if (!node || is<Document>(*node))
        return true;
    auto& document = node->document();
    return document.documentElement() == node || document.body() == node;
}

bool EventTarget::addEventListener(const AtomString& eventType, Ref<EventListener>&& listener, const AddEventListenerOptions& options)
{
#if ASSERT_ENABLED
    listener->checkValidityForEventTarget(*this);
#endif

    if (options.signal && options.signal->aborted())
        return false;

    auto passive = options.passive;

    if (!passive.has_value() && shouldMakeEventListenerPassive(*this, eventType))
        passive = true;

    auto* registeredListener = ensureEventTargetData().eventListenerMap.add(eventType, listener.copyRef(), { options.capture, passive.value_or(false), options.once, options.resistStopPropagation });
    if (!registeredListener)
        return false;

    if (RefPtr signal = options.signal) {
        uint32_t algorithmIdentifier = signal->addAlgorithm([weakThis = WeakPtr { *this }, eventType, listener = WeakPtr { listener }, capture = options.capture](JSC::JSValue) {
            if (weakThis && listener)
                Ref { *weakThis }->removeEventListener(eventType, *listener, { .capture = capture });
        });
        // Remember which abort algorithm belongs to this listener so that
        // removeEventListener / once:true / removeAllEventListeners can
        // drop it from the signal via RegisteredEventListener::markAsRemoved().
        registeredListener->setAbortSignal(WeakPtr { *signal }, algorithmIdentifier);
    }

    eventListenersDidChange();
    return true;
}

bool EventTarget::addEventListener(const AtomString& eventType, Ref<EventListener>&& listener)
{
    return addEventListener(eventType, WTF::move(listener), {});
}

void EventTarget::addEventListenerForBindings(const AtomString& eventType, RefPtr<EventListener>&& listener, AddEventListenerOptionsOrBoolean&& variant)
{
    if (!listener)
        return;

    auto visitor = WTF::makeVisitor([&](const AddEventListenerOptions& options) {
        // FIXME: Ideally we'd be able to mark the makeVisitor() lamdbas as NOESCAPE to avoid having to suppress.
        SUPPRESS_UNCOUNTED_LAMBDA_CAPTURE addEventListener(eventType, listener.releaseNonNull(), options); }, [&](bool capture) {
        // FIXME: Ideally we'd be able to mark the makeVisitor() lamdbas as NOESCAPE to avoid having to suppress.
        SUPPRESS_UNCOUNTED_LAMBDA_CAPTURE addEventListener(eventType, listener.releaseNonNull(), { { capture }, std::nullopt, false, nullptr, false }); });

    WTF::visit(visitor, variant);
}

void EventTarget::removeEventListenerForBindings(const AtomString& eventType, RefPtr<EventListener>&& listener, EventListenerOptionsOrBoolean&& variant)
{
    if (!listener)
        return;

    auto visitor = WTF::makeVisitor([&](const EventListenerOptions& options) {
        // FIXME: Ideally we'd be able to mark the makeVisitor() lamdbas as NOESCAPE to avoid having to suppress.
        SUPPRESS_UNCOUNTED_LAMBDA_CAPTURE removeEventListener(eventType, *listener, options); }, [&](bool capture) {
        // FIXME: Ideally we'd be able to mark the makeVisitor() lamdbas as NOESCAPE to avoid having to suppress.
        SUPPRESS_UNCOUNTED_LAMBDA_CAPTURE removeEventListener(eventType, *listener, { .capture = capture }); });

    WTF::visit(visitor, variant);
}

bool EventTarget::removeEventListener(const AtomString& eventType, EventListener& listener, const EventListenerOptions& options)
{
    auto* data = eventTargetData();
    if (!data)
        return false;

    if (data->eventListenerMap.remove(eventType, listener, options.capture)) {
        eventListenersDidChange();
        return true;
    }
    return false;
}

template<typename JSMaybeErrorEventListener>
void EventTarget::setAttributeEventListener(const AtomString& eventType, JSC::JSValue listener, JSC::JSObject& jsEventTarget)
{
    Ref isolatedWorld = worldForDOMObject(jsEventTarget);
    RefPtr existingListener = attributeEventListener(eventType, isolatedWorld);
    if (!listener.isObject()) {
        if (existingListener)
            removeEventListener(eventType, *existingListener, { .capture = false });
    } else if (existingListener)
        existingListener->replaceJSFunctionForAttributeListener(asObject(listener), &jsEventTarget);
    else
        addEventListener(eventType, JSMaybeErrorEventListener::create(*asObject(listener), jsEventTarget, true, isolatedWorld), {});
}

template void EventTarget::setAttributeEventListener<JSErrorHandler>(const AtomString& eventType, JSC::JSValue listener, JSC::JSObject& jsEventTarget);
template void EventTarget::setAttributeEventListener<JSEventListener>(const AtomString& eventType, JSC::JSValue listener, JSC::JSObject& jsEventTarget);

bool EventTarget::setAttributeEventListener(const AtomString& eventType, RefPtr<EventListener>&& listener, DOMWrapperWorld& isolatedWorld)
{
    RefPtr existingListener = attributeEventListener(eventType, isolatedWorld);
    if (!listener) {
        if (existingListener)
            removeEventListener(eventType, *existingListener, { .capture = false });
        return false;
    }
    if (existingListener) {
#if ASSERT_ENABLED
        listener->checkValidityForEventTarget(*this);
#endif

        eventTargetData()->eventListenerMap.replacePreservingOptions(eventType, *existingListener, *listener);

        return true;
    }
    return addEventListener(eventType, listener.releaseNonNull(), {});
}

RefPtr<JSEventListener> EventTarget::attributeEventListener(const AtomString& eventType, DOMWrapperWorld& isolatedWorld)
{
    for (Ref eventListener : eventListeners(eventType)) {
        RefPtr jsListener = dynamicDowncast<JSEventListener>(eventListener->callback());
        if (jsListener && jsListener->isAttribute() && jsListener->isolatedWorld() == &isolatedWorld)
            return jsListener;
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
    if (!event.isInitialized() || (event.isBeingDispatched() && isNode()))
        return Exception { ExceptionCode::InvalidStateError };

    if (event.isBeingDispatched())
        return Exception { EVENT_RECURSION, makeString("The event \""_s, event.type(), "\" is already being dispatched"_s) };

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

    EventPath eventPath { *this };
    event.setTarget(this);
    event.setCurrentTarget(this);
    event.setEventPhase(Event::AT_TARGET);
    event.resetBeforeDispatch();
    event.setEventPath(eventPath);
    fireEventListeners(event, EventInvokePhase::Capturing);
    fireEventListeners(event, EventInvokePhase::Bubbling);
    event.resetAfterDispatch();
}

void EventTarget::uncaughtExceptionInEventHandler()
{
}

const AtomString& EventTarget::legacyTypeForEvent(const Event& event)
{
    auto& eventNames = WebCore::eventNames();
    if (event.type() == eventNames.animationendEvent)
        return eventNames.webkitAnimationEndEvent;

    if (event.type() == eventNames.animationstartEvent)
        return eventNames.webkitAnimationStartEvent;

    if (event.type() == eventNames.animationiterationEvent)
        return eventNames.webkitAnimationIterationEvent;

    if (event.type() == eventNames.transitionendEvent)
        return eventNames.webkitTransitionEndEvent;

    // FIXME: This legacy name is not part of the specification (https://dom.spec.whatwg.org/#dispatching-events).
    if (event.type() == eventNames.wheelEvent)
        return eventNames.mousewheelEvent;

    return nullAtom();
}

// https://dom.spec.whatwg.org/#concept-event-listener-invoke
void EventTarget::fireEventListeners(Event& event, EventInvokePhase phase)
{
#if !ASSERT_WITH_SECURITY_IMPLICATION_DISABLED
    if (RefPtr node = dynamicDowncast<Node>(*this))
        ASSERT_WITH_SECURITY_IMPLICATION(ScriptDisallowedScope::InMainThread::isEventDispatchAllowedInSubtree(*node));
    else
        ASSERT_WITH_SECURITY_IMPLICATION(ScriptDisallowedScope::isScriptAllowedInMainThread());
#endif
    ASSERT(event.isInitialized());

    auto* data = eventTargetData();
    if (!data)
        return;
    // The context the target was made in is gone (a Bun.ModuleGraph's that was collected while the
    // host still held the target): its listeners go unheard.
    if (!scriptExecutionContext())
        return;

    SetForScope firingEventListenersScope(data->isFiringEventListeners, true);

    if (auto* listenersVector = data->eventListenerMap.find(event.type())) {
        innerInvokeEventListeners(event, *listenersVector, phase);
        return;
    }

    // Only fall back to legacy types for trusted events.
    if (!event.isTrusted())
        return;

    const AtomString& legacyTypeName = legacyTypeForEvent(event);
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
    Ref protectedThis { *this };
    ASSERT(!listeners.isEmpty());
    ASSERT(scriptExecutionContext());

    // A Bun.ModuleGraph's context is freed with the graph, which a listener can bring about.
    Ref context = *scriptExecutionContext();

    for (auto& registeredListener : listeners) {
        if (registeredListener->wasRemoved()) [[unlikely]]
            continue;

        if (phase == EventInvokePhase::Capturing && !registeredListener->useCapture())
            continue;
        if (phase == EventInvokePhase::Bubbling && registeredListener->useCapture())
            continue;

        Ref callback = registeredListener->callback();

        // If stopImmediatePropagation has been called, skip the remaining listeners. Listeners
        // registered with resistStopPropagation still run: they are how internal modules attach
        // teardown that unrelated code sharing the event target must not be able to suppress.
        if (event.immediatePropagationStopped() && !registeredListener->resistsStopPropagation())
            continue;

        // Make sure the JS wrapper and function stay alive until the end of this scope. Otherwise,
        // event listeners with 'once' flag may get collected as soon as they get unregistered below,
        // before we call the js function.
        JSC::EnsureStillAliveScope wrapperProtector(callback->wrapper());
        JSC::EnsureStillAliveScope jsFunctionProtector(callback->jsFunction());

        if (event.isAutofillEvent()) [[unlikely]]
            continue; // webkitrequestautofill only fires in a world with autofill capability.

        // Do this before invocation to avoid reentrancy issues.
        if (registeredListener->isOnce())
            removeEventListener(event.type(), callback, { .capture = registeredListener->useCapture() });

        if (registeredListener->isPassive())
            event.setInPassiveListener(true);

#if ASSERT_ENABLED
        callback->checkValidityForEventTarget(*this);
#endif

        callback->handleEvent(context, event);

        if (registeredListener->isPassive())
            event.setInPassiveListener(false);
    }
}

Vector<AtomString> EventTarget::eventTypes() const
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
    auto* data = eventTargetData();
    if (data && !data->eventListenerMap.isEmpty()) {
        data->eventListenerMap.clear();
        eventListenersDidChange();
    }
}

bool EventTarget::hasAnyEventListeners(std::span<const AtomString> eventTypes) const
{
    if (auto* data = eventTargetData()) {
        for (const auto& eventType : eventTypes) {
            if (data->eventListenerMap.contains(eventType))
                return true;
        }
    }
    return false;
}

} // namespace WebCore
