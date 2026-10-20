/*
 * Copyright (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 *           (C) 2001 Dirk Mueller (mueller@kde.org)
 * Copyright (C) 2004-2018 Apple Inc. All rights reserved.
 *           (C) 2006 Alexey Proskuryakov (ap@nypop.com)
 * Copyright (C) 2007 Samuel Weinig (sam@webkit.org)
 *
 * This library is free software; you can redistribute it and/or
 * modify it under the terms of the GNU Library General Public
 * License as published by the Free Software Foundation; either
 * version 2 of the License, or (at your option) any later version.
 *
 * This library is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 * Library General Public License for more details.
 *
 * You should have received a copy of the GNU Library General Public License
 * along with this library; see the file COPYING.LIB.  If not, write to
 * the Free Software Foundation, Inc., 51 Franklin Street, Fifth Floor,
 * Boston, MA 02110-1301, USA.
 *
 */

#include "config.h"
#include "HTMLButtonElement.h"

#include "CommandEvent.h"
#include "CommonAtomStrings.h"
#include "DOMFormData.h"
#include "ElementInlines.h"
#include "EventNames.h"
#include "HTMLFormElement.h"
#include "HTMLNames.h"
#include "HTMLSelectElement.h"
#include "KeyboardEvent.h"
#include <wtf/SetForScope.h>
#include <wtf/StdLibExtras.h>
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(HTMLButtonElement);

using namespace HTMLNames;

inline HTMLButtonElement::HTMLButtonElement(const QualifiedName& tagName, Document& document)
    : HTMLFormControlElement(tagName, document)
    , m_type(Type::Submit)
    , m_isActivatedSubmit(false)
{
    ASSERT(hasTagName(buttonTag));
}

Ref<HTMLButtonElement> HTMLButtonElement::create(const QualifiedName& tagName, Document& document)
{
    return adoptRef(*new HTMLButtonElement(tagName, document));
}

Ref<HTMLButtonElement> HTMLButtonElement::create(Document& document)
{
    return adoptRef(*new HTMLButtonElement(buttonTag, document));
}

Node::NeedsPostConnectionSteps HTMLButtonElement::insertionSteps(InsertionType insertionType, ContainerNode& parentOfInsertedTree)
{
    auto result = HTMLFormControlElement::insertionSteps(insertionType, parentOfInsertedTree);
    computeType(attributeWithoutSynchronization(HTMLNames::typeAttr));
    return result;
}

void HTMLButtonElement::removingSteps(RemovalType removalType, ContainerNode& oldParentOfRemovedTree)
{
    HTMLFormControlElement::removingSteps(removalType, oldParentOfRemovedTree);
    computeType(attributeWithoutSynchronization(HTMLNames::typeAttr));
}

int HTMLButtonElement::defaultTabIndex() const
{
    return 0;
}

const AtomString& HTMLButtonElement::formControlType() const
{
    switch (m_type) {
    case Type::Submit:
        return submitAtom();
    case Type::Button:
        return HTMLNames::buttonTag->localName();
    case Type::Reset:
        return resetAtom();
    }

    ASSERT_NOT_REACHED();
    return emptyAtom();
}

void HTMLButtonElement::attributeChanged(const QualifiedName& name, const AtomString& oldValue, const AtomString& newValue, AttributeModificationReason attributeModificationReason)
{
    if (name == typeAttr)
        computeType(newValue);
    else if (name == commandAttr || name == commandforAttr)
        computeType(attributeWithoutSynchronization(HTMLNames::typeAttr));
    else
        HTMLFormControlElement::attributeChanged(name, oldValue, newValue, attributeModificationReason);
}

RefPtr<Element> HTMLButtonElement::commandForElement() const
{
    if (isDisabledFormControl())
        return nullptr;

    return elementForAttributeInternal(commandforAttr);
}

CommandType HTMLButtonElement::commandType() const
{
    auto action = attributeWithoutSynchronization(HTMLNames::commandAttr);
    if (action.isNull() || action.isEmpty())
        return CommandType::Invalid;

    if (equalIgnoringASCIICase(action, "toggle-popover"_s))
        return CommandType::TogglePopover;

    if (equalIgnoringASCIICase(action, "show-popover"_s))
        return CommandType::ShowPopover;

    if (equalIgnoringASCIICase(action, "hide-popover"_s))
        return CommandType::HidePopover;

    if (equalIgnoringASCIICase(action, "show-modal"_s))
        return CommandType::ShowModal;

    if (equalIgnoringASCIICase(action, "close"_s))
        return CommandType::Close;

    if (equalIgnoringASCIICase(action, "request-close"_s))
        return CommandType::RequestClose;

    if (action.startsWith("--"_s))
        return CommandType::Custom;

    return CommandType::Invalid;
}

void HTMLButtonElement::handleCommand()
{
    RefPtr invokee = commandForElement();
    if (!invokee)
        return;

    auto commandRaw = attributeWithoutSynchronization(HTMLNames::commandAttr);
    auto command = commandType();

    if (command == CommandType::Invalid)
        return;

    if (command != CommandType::Custom && !invokee->isValidCommandType(command))
        return;

    CommandEvent::Init init {
        { false, true, false },
        this,
        commandRaw.isNull() ? emptyAtom() : commandRaw,
    };
    Ref event = CommandEvent::create(eventNames().commandEvent, WTF::move(init),
        CommandEvent::IsTrusted::Yes);
    invokee->dispatchEvent(event);

    if (!event->defaultPrevented() && command != CommandType::Custom)
        invokee->handleCommandInternal(*this, command);
}

String HTMLButtonElement::command() const
{
    switch (commandType()) {
    case CommandType::TogglePopover:
        return "toggle-popover"_s;
    case CommandType::ShowPopover:
        return "show-popover"_s;
    case CommandType::HidePopover:
        return "hide-popover"_s;
    case CommandType::Close:
        return "close"_s;
    case CommandType::RequestClose:
        return "request-close"_s;
    case CommandType::ShowModal:
        return "show-modal"_s;
    case CommandType::Custom:
        return attributeWithoutSynchronization(HTMLNames::commandAttr);
    case CommandType::Invalid:
        return emptyString();
    }

    ASSERT_NOT_REACHED();
    return { };
}

void HTMLButtonElement::defaultEventHandler(Event& event)
{
    auto& eventNames = WebCore::eventNames();
    if (event.type() == eventNames.DOMActivateEvent && !isDisabledFormControl()) {
        if (form()) {
            if (RefPtr currentForm = form()) {
                if (isSubmitButton())
                    currentForm->submitIfPossible(&event, this);

                if (m_type == Type::Reset)
                    currentForm->reset();
            }

            if (isSubmitButton() || m_type == Type::Reset) {
                event.setDefaultHandled();
                return;
            }

            if (m_type == Type::Button && !equalLettersIgnoringASCIICase(attributeWithoutSynchronization(HTMLNames::typeAttr), "button"_s))
                return;
        }

        if (commandForElement()) {
            handleCommand();
            return;
        }

        handlePopoverTargetAction(protect(event.target()).get());
    }

    if (RefPtr keyboardEvent = dynamicDowncast<KeyboardEvent>(event); keyboardEvent && document().focusedElement() == this) {
        if (keyboardEvent->type() == eventNames.keydownEvent && keyboardEvent->keyIdentifier() == "U+0020"_s) {
            setActive(true);
            // No setDefaultHandled() - IE dispatches a keypress in this case.
            return;
        }
        if (keyboardEvent->type() == eventNames.keypressEvent) {
            switch (keyboardEvent->charCode()) {
                case '\r':
                    dispatchSimulatedClick(keyboardEvent.get());
                    keyboardEvent->setDefaultHandled();
                    return;
                case ' ':
                    // Prevent scrolling down the page.
                    keyboardEvent->setDefaultHandled();
                    return;
            }
        }
        if (keyboardEvent->type() == eventNames.keyupEvent && keyboardEvent->keyIdentifier() == "U+0020"_s) {
            if (active())
                dispatchSimulatedClick(keyboardEvent.get());
            keyboardEvent->setDefaultHandled();
            return;
        }
    }

    HTMLFormControlElement::defaultEventHandler(event);
}

bool HTMLButtonElement::hasActivationBehavior() const
{
    return true;
}

bool HTMLButtonElement::isSuccessfulSubmitButton() const
{
    // HTML spec says that buttons must have names to be considered successful.
    // However, other browsers do not impose this constraint.
    return isSubmitButton();
}

bool HTMLButtonElement::matchesDefaultPseudoClass() const
{
    RefPtr form = this->form();
    return isSuccessfulSubmitButton() && form && form->defaultButton() == this;
}

bool HTMLButtonElement::isActivatedSubmit() const
{
    return m_isActivatedSubmit;
}

void HTMLButtonElement::setActivatedSubmit(bool flag)
{
    m_isActivatedSubmit = flag;
}

bool HTMLButtonElement::appendFormData(DOMFormData& formData)
{
    if (!isSubmitButton() || name().isEmpty() || !m_isActivatedSubmit)
        return false;
    formData.append(name(), value());
    return true;
}

bool HTMLButtonElement::isURLAttribute(const Attribute& attribute) const
{
    return attribute.name() == formactionAttr || HTMLFormControlElement::isURLAttribute(attribute);
}

const AtomString& HTMLButtonElement::value() const
{
    return attributeWithoutSynchronization(valueAttr);
}

bool HTMLButtonElement::computeWillValidate() const
{
    return isSubmitButton() && HTMLFormControlElement::computeWillValidate();
}

bool HTMLButtonElement::isSubmitButton() const
{
    return m_type == Type::Submit;
}

void HTMLButtonElement::computeType(const AtomString& typeAttrValue)
{
    auto oldType = m_type;
    if (equalLettersIgnoringASCIICase(typeAttrValue, "reset"_s))
        m_type = Type::Reset;
    else if (equalLettersIgnoringASCIICase(typeAttrValue, "button"_s))
        m_type = Type::Button;
    else if (equalLettersIgnoringASCIICase(typeAttrValue, "submit"_s))
        m_type = Type::Submit;
    else if (hasAttributeWithoutSynchronization(HTMLNames::commandAttr) || hasAttributeWithoutSynchronization(HTMLNames::commandforAttr))
        m_type = Type::Button;
    else if (is<HTMLSelectElement>(parentNode()))
        m_type = Type::Button;
    else
        m_type = Type::Submit;
    if (oldType != m_type) {
        updateWillValidateAndValidity();
        if (RefPtr currentForm = form(); currentForm && (oldType == Type::Submit || m_type == Type::Submit))
            currentForm->resetDefaultButton();
    }
}

} // namespace
