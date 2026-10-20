/*
 * Copyright (C) 2005-2025 Apple Inc. All rights reserved.
 * Copyright (C) 2010 Google Inc. All rights reserved.
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
#include "RadioInputType.h"

#include "ContainerNodeInlines.h"
#include "HTMLFormElement.h"
#include "HTMLInputElement.h"
#include "HTMLNames.h"
#include "InputTypeNames.h"
#include "KeyboardEvent.h"
#include "LocalizedStrings.h"
#include "MouseEvent.h"
#include "NodeTraversal.h"
#include "TypedElementDescendantIteratorInlines.h"
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(RadioInputType);

using namespace HTMLNames;

const AtomString& RadioInputType::formControlType() const
{
    return InputTypeNames::radio();
}

bool RadioInputType::valueMissing(StringView) const
{
    RefPtr element = this->element();
    ASSERT(element);
    auto& name = element->name();
    if (auto* buttons = element->radioButtonGroups())
        return !buttons->checkedButtonForGroup(name) && buttons->isInRequiredGroup(*element);

    if (name.isEmpty())
        return false;

    ASSERT(!element->isConnected());
    ASSERT(!element->form());

    bool isRequired = false;
    bool foundCheckedRadio = false;
    forEachButtonInDetachedGroup(protect(element->rootNode()), name, [&](auto& input) {
        if (input.checked()) {
            foundCheckedRadio = true;
            return false;
        }
        if (input.isRequired())
            isRequired = true;
        return true;
    });
    return isRequired && !foundCheckedRadio;
}

void RadioInputType::forEachButtonInDetachedGroup(ContainerNode& rootNode, const String& groupName, NOESCAPE const Function<bool(HTMLInputElement&)>& apply)
{
    ASSERT(!groupName.isEmpty());

    auto next = [&](auto& current) {
        if (is<HTMLFormElement>(current)) {
            // No need to consider the descendants of a <form> since they will have a form owner and we're only
            // interested in <input> elements without a form owner.
            return Traversal<HTMLElement>::nextSkippingChildren(current, &rootNode);
        }
        return Traversal<HTMLElement>::next(current, &rootNode);
    };
    for (RefPtr descendant = Traversal<HTMLElement>::inclusiveFirstWithin(rootNode); descendant; descendant = next(*descendant)) {
        if (is<HTMLFormElement>(*descendant))
            continue;
        auto* input = dynamicDowncast<HTMLInputElement>(*descendant);
        if (input && input->isRadioButton() && !input->form() && input->name() == groupName) {
            bool shouldContinue = apply(*input);
            if (!shouldContinue)
                return;
        }
    }
}

void RadioInputType::willUpdateCheckedness(bool nowChecked, WasSetByJavaScript)
{
    if (!nowChecked)
        return;
    Ref element = *this->element();
    if (element->radioButtonGroups()) {
        // Buttons in RadioButtonGroups are handled in HTMLInputElement::setChecked().
        return;
    }
    if (RefPtr input = element->checkedRadioButtonForGroup())
        input->setChecked(false);
}

String RadioInputType::valueMissingText() const
{
    return validationMessageValueMissingForRadioText();
}

void RadioInputType::handleClickEvent(MouseEvent& event)
{
    event.setDefaultHandled();
}

auto RadioInputType::handleKeydownEvent(KeyboardEvent& event) -> ShouldCallBaseEventHandler
{
    if (BaseCheckableInputType::handleKeydownEvent(event) == ShouldCallBaseEventHandler::No)
        return ShouldCallBaseEventHandler::No;
    if (event.defaultHandled())
        return ShouldCallBaseEventHandler::Yes;
    const String& key = event.keyIdentifier();
    if (key != "Up"_s && key != "Down"_s && key != "Left"_s && key != "Right"_s)
        return ShouldCallBaseEventHandler::Yes;

    RefPtr element = this->element();
    ASSERT(element);
    // Left and up mean "previous radio button".
    // Right and down mean "next radio button".
    // Tested in WinIE, and even for RTL, left still means previous radio button (and so moves
    // to the right).  Seems strange, but we'll match it.
    bool forward = (key == "Down"_s || key == "Right"_s);

    // We can only stay within the form's children if the form hasn't been demoted to a leaf because
    // of malformed HTML.
    RefPtr<Node> node = element;
    while ((node = (forward ? NodeTraversal::next(*node) : NodeTraversal::previous(*node)))) {
        // Once we encounter a form element, we know we're through.
        if (is<HTMLFormElement>(*node))
            break;
        // Look for more radio buttons.
        RefPtr inputElement = dynamicDowncast<HTMLInputElement>(*node);
        if (!inputElement)
            continue;
        if (inputElement->form() != element->form())
            break;
        if (inputElement->isRadioButton() && inputElement->name() == element->name() && inputElement->isFocusable()) {
            protect(inputElement->document())->setFocusedElement(inputElement.get());
            inputElement->dispatchSimulatedClick(&event, SendNoEvents, DoNotShowPressedLook);
            event.setDefaultHandled();
            return ShouldCallBaseEventHandler::Yes;
        }
    }
    return ShouldCallBaseEventHandler::Yes;
}

void RadioInputType::handleKeyupEvent(KeyboardEvent& event)
{
    const String& key = event.keyIdentifier();
    if (key != "U+0020"_s)
        return;

    RefPtr element = this->element();
    ASSERT(element);
    // If an unselected radio is tabbed into (because the entire group has nothing
    // checked, or because of some explicit .focus() call), then allow space to check it.
    if (element->checked()) {
        // If we are going to skip DispatchSimulatedClick, then at least call setActive(false)
        // to prevent the radio from being stuck in the active state.
        element->setActive(false);
        return;
    }
    dispatchSimulatedClickIfActive(event);
}

bool RadioInputType::isKeyboardFocusable(const FocusEventData& focusEventData) const
{
    if (!InputType::isKeyboardFocusable(focusEventData))
        return false;

    RefPtr element = this->element();
    ASSERT(element);
    // Never allow keyboard tabbing to leave you in the same radio group.  Always
    // skip any other elements in the group.
    if (RefPtr focusedInput = dynamicDowncast<HTMLInputElement>(element->document().focusedElement())) {
        if (focusedInput->isRadioButton() && focusedInput->form() == element->form() && focusedInput->name() == element->name())
            return false;
    }

    // Allow keyboard focus if we're checked or if nothing in the group is checked.
    return element->checked() || !element->checkedRadioButtonForGroup();
}

bool RadioInputType::shouldSendChangeEventAfterCheckedChanged()
{
    // Don't send a change event for a radio button that's getting unchecked.
    // This was done to match the behavior of other browsers.
    ASSERT(element());
    return element()->checked();
}

void RadioInputType::willDispatchClick(InputElementClickState& state)
{
    RefPtr element = this->element();
    ASSERT(element);
    // An event handler can use preventDefault or "return false" to reverse the selection we do here.
    // The InputElementClickState object contains what we need to undo what we did here in didDispatchClick.

    // We want radio groups to end up in sane states, i.e., to have something checked.
    // Therefore if nothing is currently selected, we won't allow the upcoming action to be "undone", since
    // we want some object in the radio group to actually get selected.

    state.checked = element->checked();
    state.checkedRadioButton = element->checkedRadioButtonForGroup();

    element->setChecked(true);
}

void RadioInputType::didDispatchClick(Event& event, const InputElementClickState& state)
{
    RefPtr element = this->element();
    if (event.defaultPrevented() || event.defaultHandled()) {
        // Restore the original selected radio button if possible.
        // Make sure it is still a radio button and only do the restoration if it still belongs to our group.
        auto& button = state.checkedRadioButton;
        ASSERT(element);
        if (button && button->isRadioButton() && button->form() == element->form() && button->name() == element->name())
            button->setChecked(true);
        else
            element->setChecked(false);
    } else if (state.checked != element->checked())
        fireInputAndChangeEvents();

    // The work we did in willDispatchClick was default handling.
    event.setDefaultHandled();
}

bool RadioInputType::matchesIndeterminatePseudoClass() const
{
    ASSERT(element());
    Ref element = *this->element();
    if (auto* radioButtonGroups = element->radioButtonGroups())
        return !radioButtonGroups->hasCheckedButton(Ref { element });
    return !element->checked();
}

} // namespace WebCore
