/*
 * Copyright (C) 2015-2023 Apple Inc. All rights reserved.
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
 */

#include "config.h"
#include "CustomElementReactionQueue.h"

#include "CustomElementRegistry.h"
#include "ElementInlines.h"
#include "HTMLFormElement.h"
#include "JSCustomElementInterface.h"
#include "JSDOMBinding.h"
#include <JavaScriptCore/Heap.h>
#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/TopExceptionScope.h>
#include <wtf/Ref.h>
#include <wtf/SetForScope.h>
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(CustomElementReactionQueueItem);
WTF_MAKE_TZONE_ALLOCATED_IMPL(CustomElementQueue);
WTF_MAKE_TZONE_ALLOCATED_IMPL(CustomElementReactionQueue);

inline CustomElementReactionQueueItem::AdoptedPayload::~AdoptedPayload() = default;
inline CustomElementReactionQueueItem::FormAssociatedPayload::~FormAssociatedPayload() = default;

inline CustomElementReactionQueueItem::CustomElementReactionQueueItem() = default;
inline CustomElementReactionQueueItem::CustomElementReactionQueueItem(CustomElementReactionQueueItem&&) = default;

inline CustomElementReactionQueueItem::CustomElementReactionQueueItem(Type type, Payload payload)
    : m_type(type)
    , m_payload(payload)
{ }

inline CustomElementReactionQueueItem::~CustomElementReactionQueueItem() = default;

inline void CustomElementReactionQueueItem::invoke(Element& element, JSCustomElementInterface& elementInterface)
{
    switch (m_type) {
    case Type::Invalid:
        ASSERT_NOT_REACHED();
        break;
    case Type::ElementUpgrade:
        ASSERT(!m_payload.has_value());
        elementInterface.upgradeElement(element);
        break;
    case Type::Connected:
        ASSERT(!m_payload.has_value());
        elementInterface.invokeConnectedCallback(element);
        break;
    case Type::Disconnected:
        ASSERT(!m_payload.has_value());
        elementInterface.invokeDisconnectedCallback(element);
        break;
    case Type::ConnectedMove:
        ASSERT(!m_payload.has_value());
        elementInterface.invokeConnectedMoveCallback(element);
        break;
    case Type::Adopted: {
        ASSERT(m_payload.has_value() && std::holds_alternative<AdoptedPayload>(m_payload.value()));
        auto& payload = std::get<AdoptedPayload>(m_payload.value());
        elementInterface.invokeAdoptedCallback(element, payload.oldDocument, payload.newDocument);
        break;
    }
    case Type::AttributeChanged: {
        ASSERT(m_payload.has_value() && std::holds_alternative<AttributeChangedPayload>(m_payload.value()));
        auto& payload = std::get<AttributeChangedPayload>(m_payload.value());
        elementInterface.invokeAttributeChangedCallback(element, std::get<0>(payload), std::get<1>(payload), std::get<2>(payload));
        break;
    }
    case Type::FormAssociated:
        ASSERT(m_payload.has_value() && std::holds_alternative<FormAssociatedPayload>(m_payload.value()));
        elementInterface.invokeFormAssociatedCallback(element, std::get<FormAssociatedPayload>(m_payload.value()).form.get());
        break;
    case Type::FormReset:
        ASSERT(!m_payload.has_value());
        elementInterface.invokeFormResetCallback(element);
        break;
    case Type::FormDisabled:
        ASSERT(m_payload.has_value() && std::holds_alternative<FormDisabledPayload>(m_payload.value()));
        elementInterface.invokeFormDisabledCallback(element, std::get<FormDisabledPayload>(m_payload.value()));
        break;
    case Type::FormStateRestore:
        ASSERT(m_payload.has_value() && std::holds_alternative<FormStateRestorePayload>(m_payload.value()));
        elementInterface.invokeFormStateRestoreCallback(element, std::get<FormStateRestorePayload>(m_payload.value()));
        break;
    }
}

CustomElementReactionQueue::CustomElementReactionQueue(JSCustomElementInterface& elementInterface)
    : m_interface(elementInterface)
{ }

CustomElementReactionQueue::~CustomElementReactionQueue()
{
    ASSERT(m_items.isEmpty());
}

void CustomElementReactionQueue::clear()
{
    m_items.clear();
}

#if ASSERT_ENABLED
bool CustomElementReactionQueue::hasJustUpgradeReaction() const
{
    return m_items.size() == 1 && m_items[0].type() == CustomElementReactionQueueItem::Type::ElementUpgrade;
}
#endif

void CustomElementReactionQueue::enqueueElementUpgrade(Element& element, bool alreadyScheduledToUpgrade)
{
    ASSERT(CustomElementReactionDisallowedScope::isReactionAllowed());
    ASSERT(element.reactionQueue());
    CheckedRef queue = *element.reactionQueue();
    if (alreadyScheduledToUpgrade)
        ASSERT(queue->hasJustUpgradeReaction());
    else
        queue->m_items.append(Item::Type::ElementUpgrade);
    enqueueElementOnAppropriateElementQueue(element);
}

// https://html.spec.whatwg.org/multipage/custom-elements.html#concept-try-upgrade
bool CustomElementReactionQueue::tryToUpgradeElement(Element& element)
{
    ASSERT(CustomElementReactionDisallowedScope::isReactionAllowed());
    ASSERT(element.isCustomElementUpgradeCandidate());
    RefPtr registry = CustomElementRegistry::registryForElement(element);
    if (!registry)
        return false;

    RefPtr elementInterface = registry->findInterface(element);
    if (!elementInterface)
        return false;

    element.enqueueToUpgrade(*elementInterface);
    return true;
}

void CustomElementReactionQueue::enqueueConnectedCallbackIfNeeded(Element& element)
{
    ASSERT(CustomElementReactionDisallowedScope::isReactionAllowed());
    ASSERT(element.isDefinedCustomElement());
    ASSERT(element.document().refCount() > 0);
    ASSERT(element.reactionQueue());
    CheckedRef queue = *element.reactionQueue();
    if (!queue->m_interface->hasConnectedCallback())
        return;
    queue->m_items.append(Item::Type::Connected);
    enqueueElementOnAppropriateElementQueue(element);
}

void CustomElementReactionQueue::enqueueDisconnectedCallbackIfNeeded(Element& element)
{
    ASSERT(element.isDefinedCustomElement());
    if (element.document().wasRemovedLastRefCalled())
        return; // Don't enqueue disconnectedCallback if the entire document is getting destructed.
    ASSERT(CustomElementReactionDisallowedScope::isReactionAllowed());
    ASSERT(element.reactionQueue());
    CheckedRef queue = *element.reactionQueue();
    if (!queue->m_interface->hasDisconnectedCallback())
        return;
    queue->m_items.append(Item::Type::Disconnected);
    enqueueElementOnAppropriateElementQueue(element);
}

void CustomElementReactionQueue::enqueueConnectedMoveCallbackIfNeeded(Element& element)
{
    ASSERT(CustomElementReactionDisallowedScope::isReactionAllowed());
    ASSERT(element.isDefinedCustomElement());
    ASSERT(element.document().refCount() > 0);
    ASSERT(element.reactionQueue());
    CheckedRef queue = *element.reactionQueue();
    if (queue->m_interface->hasConnectedMoveCallback()) {
        queue->m_items.append(Item::Type::ConnectedMove);
        enqueueElementOnAppropriateElementQueue(element);
        return;
    }
    if (queue->m_interface->hasDisconnectedCallback())
        queue->m_items.append(Item::Type::Disconnected);
    if (queue->m_interface->hasConnectedCallback())
        queue->m_items.append(Item::Type::Connected);
    if (!queue->m_items.isEmpty())
        enqueueElementOnAppropriateElementQueue(element);
}

void CustomElementReactionQueue::enqueueAdoptedCallbackIfNeeded(Element& element, Document& oldDocument, Document& newDocument)
{
    ASSERT(CustomElementReactionDisallowedScope::isReactionAllowed());
    ASSERT(element.isDefinedCustomElement());
    ASSERT(element.document().refCount() > 0);
    ASSERT(element.reactionQueue());
    CheckedRef queue = *element.reactionQueue();
    if (!queue->m_interface->hasAdoptedCallback())
        return;
    queue->m_items.append({ Item::Type::Adopted, Item::AdoptedPayload { Ref { oldDocument }, Ref { newDocument } } });
    enqueueElementOnAppropriateElementQueue(element);
}

void CustomElementReactionQueue::enqueueAttributeChangedCallbackIfNeeded(Element& element, const QualifiedName& attributeName, const AtomString& oldValue, const AtomString& newValue)
{
    ASSERT(CustomElementReactionDisallowedScope::isReactionAllowed());
    ASSERT(element.isDefinedCustomElement());
    ASSERT(element.document().refCount() > 0);
    ASSERT(element.reactionQueue());
    CheckedRef queue = *element.reactionQueue();
    if (!queue->m_interface->observesAttribute(attributeName.localName()))
        return;
    queue->m_items.append({ Item::Type::AttributeChanged, std::make_tuple(attributeName, oldValue, newValue) });
    enqueueElementOnAppropriateElementQueue(element);
}

void CustomElementReactionQueue::enqueueFormAssociatedCallbackIfNeeded(Element& element, HTMLFormElement* associatedForm)
{
    ASSERT(CustomElementReactionDisallowedScope::isReactionAllowed());
    if (element.document().wasRemovedLastRefCalled())
        return; // Don't enqueue formAssociatedCallback if the entire document is getting destructed.
    CheckedRef queue = *element.reactionQueue();
    if (!queue->m_interface->hasFormAssociatedCallback())
        return;
    ASSERT(queue->isFormAssociated());
    queue->m_items.append({ Item::Type::FormAssociated, Item::FormAssociatedPayload { associatedForm } });
    enqueueElementOnAppropriateElementQueue(element);
}

void CustomElementReactionQueue::enqueueFormResetCallbackIfNeeded(Element& element)
{
    ASSERT(CustomElementReactionDisallowedScope::isReactionAllowed());
    ASSERT(element.document().refCount() > 0);
    CheckedRef queue = *element.reactionQueue();
    if (!queue->m_interface->hasFormResetCallback())
        return;
    ASSERT(queue->isFormAssociated());
    queue->m_items.append(Item::Type::FormReset);
    enqueueElementOnAppropriateElementQueue(element);
}

void CustomElementReactionQueue::enqueueFormDisabledCallbackIfNeeded(Element& element, bool isDisabled)
{
    ASSERT(CustomElementReactionDisallowedScope::isReactionAllowed());
    ASSERT(element.document().refCount() > 0);
    CheckedRef queue = *element.reactionQueue();
    if (!queue->m_interface->hasFormDisabledCallback())
        return;
    ASSERT(queue->isFormAssociated());
    queue->m_items.append({ Item::Type::FormDisabled, isDisabled });
    enqueueElementOnAppropriateElementQueue(element);
}

void CustomElementReactionQueue::enqueueFormStateRestoreCallbackIfNeeded(Element& element, CustomElementFormValue&& state)
{
    ASSERT(CustomElementReactionDisallowedScope::isReactionAllowed());
    ASSERT(element.document().refCount() > 0);
    CheckedRef queue = *element.reactionQueue();
    if (!queue->m_interface->hasFormStateRestoreCallback())
        return;
    ASSERT(queue->isFormAssociated());
    queue->m_items.append({ Item::Type::FormStateRestore, WTF::move(state) });
    enqueueElementOnAppropriateElementQueue(element);
}

void CustomElementReactionQueue::enqueuePostUpgradeReactions(Element& element)
{
    ASSERT(CustomElementReactionDisallowedScope::isReactionAllowed());
    ASSERT(element.isCustomElementUpgradeCandidate());
    if (!element.hasAttributes() && !element.isConnected())
        return;

    ASSERT(element.reactionQueue());
    CheckedRef queue = *element.reactionQueue();

    if (element.hasAttributes()) {
        for (auto& attribute : element.attributes()) {
            if (queue->m_interface->observesAttribute(attribute.localName()))
                queue->m_items.append({ Item::Type::AttributeChanged, std::make_tuple(attribute.name(), nullAtom(), attribute.value()) });
        }
    }

    if (element.isConnected() && queue->m_interface->hasConnectedCallback())
        queue->m_items.append(Item::Type::Connected);
}

bool CustomElementReactionQueue::observesStyleAttribute() const
{
    return m_interface->observesAttribute(HTMLNames::styleAttr->localName());
}

bool CustomElementReactionQueue::isElementInternalsDisabled() const
{
    return m_interface->isElementInternalsDisabled();
}

bool CustomElementReactionQueue::isFormAssociated() const
{
    return m_interface->isFormAssociated();
}

bool CustomElementReactionQueue::hasFormStateRestoreCallback() const
{
    return m_interface->hasFormStateRestoreCallback();
}

void CustomElementReactionQueue::setElementInternalsAttached()
{
    m_elementInternalsAttached = true;
}

void CustomElementReactionQueue::invokeAll(Element& element)
{
    while (!m_items.isEmpty()) {
        auto items = std::exchange(m_items, { });
        for (auto& item : items)
            item.invoke(element, m_interface.get());
    }
}

inline void CustomElementQueue::add(Element& element)
{
    ASSERT(!m_invoking);
    // FIXME: Avoid inserting the same element multiple times.
    m_elements.append(element);
}

inline void CustomElementQueue::invokeAll()
{
    RELEASE_ASSERT(!m_invoking);
    SetForScope invoking(m_invoking, true);
    unsigned originalSize = m_elements.size();
    // It's possible for more elements to be enqueued if some IDL attributes were missing CEReactions.
    // Invoke callbacks slightly later here instead of crashing / ignoring those cases.
    for (unsigned i = 0; i < m_elements.size(); ++i) {
        Ref element = m_elements[i].get();
        element->clearIsInCustomElementReactionQueue();
        CheckedPtr queue = element->reactionQueue();
        ASSERT(queue);
        queue->invokeAll(element);
    }
    ASSERT_UNUSED(originalSize, m_elements.size() == originalSize);
    m_elements.clear();
}

void CustomElementQueue::processQueue(JSC::JSGlobalObject* state)
{
    if (!state) {
        invokeAll();
        return;
    }

    Ref vm = state->vm();
    JSC::JSLockHolder lock(vm);

    JSC::Exception* previousException = nullptr;
    {
        auto catchScope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
        previousException = catchScope.exception();
        if (previousException)
            catchScope.clearException();
    }

    invokeAll();

    if (previousException) {
        auto throwScope = DECLARE_THROW_SCOPE(vm);
        throwException(state, throwScope, previousException);
    }
}

Vector<Ref<Element>, 4> CustomElementQueue::takeElements()
{
    RELEASE_ASSERT(!m_invoking);
    return std::exchange(m_elements, { });
}

void CustomElementReactionQueue::enqueueElementsOnAppropriateElementQueue(const Vector<Ref<Element>>& elements)
{
    for (auto& element : elements)
        enqueueElementOnAppropriateElementQueue(element);
}

// https://html.spec.whatwg.org/multipage/custom-elements.html#enqueue-an-element-on-the-appropriate-element-queue
void CustomElementReactionQueue::enqueueElementOnAppropriateElementQueue(Element& element)
{
    ASSERT(element.reactionQueue());
    element.setIsInCustomElementReactionQueue();
    auto* currentProcessingStack = domClientData(element.document().vm()).customElementReactionStack();
    if (!currentProcessingStack) {
        protect(element.document())->backupElementQueue().add(element);
        return;
    }

    currentProcessingStack->m_queue.add(element);
}

void CustomElementReactionQueue::processBackupQueue(CustomElementQueue& backupElementQueue)
{
    backupElementQueue.processQueue(nullptr);
}

}
