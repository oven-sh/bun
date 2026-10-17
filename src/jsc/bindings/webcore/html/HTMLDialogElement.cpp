/*
 * Copyright (C) 2019-2026 Apple Inc. All rights reserved.
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
#include "HTMLDialogElement.h"

#include "CommonAtomStrings.h"
#include "ContainerNodeInlines.h"
#include "EventNames.h"
#include "FocusOptions.h"
#include "HTMLButtonElement.h"
#include "HTMLElement.h"
#include "HTMLNames.h"
#include "PopoverData.h"
#include "ToggleEvent.h"
#include "ToggleEventTask.h"
#include "TypedElementDescendantIteratorInlines.h"
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(HTMLDialogElement);

using namespace HTMLNames;

HTMLDialogElement::HTMLDialogElement(const QualifiedName& tagName, Document& document)
    : HTMLElement(tagName, document)
{
}

const AtomString& HTMLDialogElement::closedBy() const
{
    switch (computedClosedByState()) {
    case ClosedByState::None:
        return noneAtom();
    case ClosedByState::CloseRequest:
        return closerequestAtom();
    case ClosedByState::Any:
        return anyAtom();
    default:
        ASSERT_NOT_REACHED();
        return nullAtom();
    }
}

ClosedByState HTMLDialogElement::closedByState() const
{
    if (!hasAttributeWithoutSynchronization(HTMLNames::closedbyAttr))
        return ClosedByState::Auto;

    auto value = attributeWithoutSynchronization(HTMLNames::closedbyAttr);
    if (equalIgnoringASCIICase(value, noneAtom()))
        return ClosedByState::None;
    if (equalIgnoringASCIICase(value, closerequestAtom()))
        return ClosedByState::CloseRequest;
    if (equalIgnoringASCIICase(value, anyAtom()))
        return ClosedByState::Any;

    return ClosedByState::Auto;
}

ClosedByState HTMLDialogElement::computedClosedByState() const
{
    ClosedByState result = closedByState();
    if (result == ClosedByState::Auto)
        return m_isModal ? ClosedByState::CloseRequest : ClosedByState::None;

    return result;
}

// https://html.spec.whatwg.org/multipage/interactive-elements.html#dom-dialog-show
ExceptionOr<void> HTMLDialogElement::show()
{
    // If the element already has an open attribute, then return.
    if (isOpen()) {
        if (!isModal())
            return { };
        return Exception { ExceptionCode::InvalidStateError, "Cannot call show() on an open modal dialog."_s };
    }

    ToggleEvent::Init init;
    init.oldState = "closed"_s;
    init.newState = "open"_s;
    init.source = nullptr;
    Ref event = ToggleEvent::create(eventNames().beforetoggleEvent, init, Event::IsCancelable::Yes);
    dispatchEvent(event);
    if (event->defaultPrevented())
        return { };

    if (isOpen())
        return { };

    queueDialogToggleEventTask(ToggleState::Closed, ToggleState::Open, nullptr);

    setAttributeWithoutSynchronization(openAttr, emptyAtom());

    Ref document = this->document();
    m_previouslyFocusedElement = document->focusedElement();

    document->hidePopoversForTopLayerElement(*this, FireEvents::No);

    runFocusingSteps();

    return { };
}

// https://html.spec.whatwg.org/multipage/interactive-elements.html#show-a-modal-dialog
ExceptionOr<void> HTMLDialogElement::showModal(Element* source)
{
    if (isOpen()) {
        if (isModal())
            return { };
        return Exception { ExceptionCode::InvalidStateError, "Cannot call showModal() on an open non-modal dialog."_s };
    }

    if (!isConnected())
        return Exception { ExceptionCode::InvalidStateError, "Element is not connected."_s };

    if (isPopoverShowing())
        return Exception { ExceptionCode::InvalidStateError, "Element is already an open popover."_s };

    Ref document = this->document();
    if (!document->isFullyActive())
        return Exception { ExceptionCode::InvalidStateError, "Invalid for dialogs within documents that are not fully active."_s };

    ToggleEvent::Init init;
    init.oldState = "closed"_s;
    init.newState = "open"_s;
    init.source = source;
    Ref event = ToggleEvent::create(eventNames().beforetoggleEvent, init, Event::IsCancelable::Yes);
    dispatchEvent(event);
    if (event->defaultPrevented())
        return { };

    if (isOpen())
        return { };

    if (!isConnected())
        return { };

    if (isPopoverShowing())
        return { };

    queueDialogToggleEventTask(ToggleState::Closed, ToggleState::Open, source);

    setIsModal(true);

    setAttributeWithoutSynchronization(openAttr, emptyAtom());

    // Remove before adding, so we always add at the end of the top layer. A dialog can still
    // be in the top layer here if its open attribute was removed directly rather than by
    // close(), and showing it again must promote it above the dialogs opened since.
    if (isInTopLayer())
        removeFromTopLayer();
    addToTopLayer();

    m_previouslyFocusedElement = document->focusedElement();

    document->hidePopoversForTopLayerElement(*this, FireEvents::No);

    runFocusingSteps();

    return { };
}

// https://html.spec.whatwg.org/multipage/interactive-elements.html#dom-dialog-close
void HTMLDialogElement::close(const String& result, Element* source)
{
    if (!isOpen())
        return;

    ToggleEvent::Init init;
    init.oldState = "open"_s;
    init.newState = "closed"_s;
    init.source = source;
    Ref event = ToggleEvent::create(eventNames().beforetoggleEvent, init, Event::IsCancelable::No);
    dispatchEvent(event);

    if (!isOpen())
        return;

    queueDialogToggleEventTask(ToggleState::Open, ToggleState::Closed, source);

    removeAttribute(openAttr);

    bool wasModal = isModal();

    if (wasModal)
        removeFromTopLayer();

    setIsModal(false);

    if (!result.isNull())
        m_returnValue = result;

    if (RefPtr element = std::exchange(m_previouslyFocusedElement, nullptr).get()) {
        RefPtr focusedElement = document().focusedElement();
        bool focusIsInsideDialog = focusedElement && focusedElement->isComposedTreeInclusiveDescendantOf(*this);
        if (wasModal || focusIsInsideDialog) {
            FocusOptions options;
            options.preventScroll = true;
            element->focus(options);
        }
    }

    queueTaskToDispatchEvent(TaskSource::UserInteraction, Event::create(eventNames().closeEvent, Event::CanBubble::No, Event::IsCancelable::No));
}

// https://html.spec.whatwg.org/multipage/interactive-elements.html#dom-dialog-requestclose
void HTMLDialogElement::requestClose(const String& returnValue, Element* source)
{
    if (!isOpen())
        return;

    if (!isConnected())
        return;

    if (!protect(this->document())->isFullyActive())
        return;

    if (m_isRequestingToClose)
        return;

    m_isRequestingToClose = true;

    Ref cancelEvent = Event::create(eventNames().cancelEvent, Event::CanBubble::No, Event::IsCancelable::Yes);
    dispatchEvent(cancelEvent);
    if (!cancelEvent->defaultPrevented())
        close(returnValue, source);

    m_isRequestingToClose = false;
}

bool HTMLDialogElement::isValidCommandType(const CommandType command)
{
    return HTMLElement::isValidCommandType(command) || command == CommandType::ShowModal || command == CommandType::Close
        || command == CommandType::RequestClose;
}

bool HTMLDialogElement::handleCommandInternal(HTMLButtonElement& invoker, const CommandType& command)
{
    if (HTMLElement::handleCommandInternal(invoker, command))
        return true;

    if (isPopoverShowing())
        return false;

    if (isOpen()) {
        if (command == CommandType::Close) {
            String value = invoker.value().string();
            close(value, &invoker);
            return true;
        }
        if (command == CommandType::RequestClose) {
            String value = invoker.value().string();
            requestClose(value, &invoker);
            return true;
        }
    } else {
        if (command == CommandType::ShowModal) {
            showModal(&invoker);
            return true;
        }
    }

    return false;
}

// https://html.spec.whatwg.org/multipage/interactive-elements.html#dialog-focusing-steps
void HTMLDialogElement::runFocusingSteps()
{
    RefPtr<Element> control;
    if (hasAttributeWithoutSynchronization(HTMLNames::autofocusAttr))
        control = this;
    if (!control)
        control = findFocusDelegate();

    if (!control)
        control = this;

    if (control->isFocusable())
        control->runFocusingStepsForAutofocus();
    else if (m_isModal)
        protect(document())->setFocusedElement(nullptr); // Focus fixup rule
}

bool HTMLDialogElement::supportsFocus() const
{
    return true;
}

void HTMLDialogElement::removingSteps(RemovalType removalType, ContainerNode& oldParentOfRemovedTree)
{
    HTMLElement::removingSteps(removalType, oldParentOfRemovedTree);
    setIsModal(false);
}

void HTMLDialogElement::attributeChanged(const QualifiedName& name, const AtomString& oldValue, const AtomString& newValue, AttributeModificationReason attributeModificationReason)
{
    HTMLElement::attributeChanged(name, oldValue, newValue, attributeModificationReason);
    if (name == openAttr)
        m_isOpen = !newValue.isNull();
}

void HTMLDialogElement::setIsModal(bool newValue)
{
    m_isModal = newValue;
}

void HTMLDialogElement::queueDialogToggleEventTask(ToggleState oldState, ToggleState newState, Element* source)
{
    if (!m_toggleEventTask)
        lazyInitialize(m_toggleEventTask, ToggleEventTask::create(*this));

    RefPtr { m_toggleEventTask }->queue(oldState, newState, source);
}

}
