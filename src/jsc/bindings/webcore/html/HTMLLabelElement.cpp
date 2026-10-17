/*
 * Copyright (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 *           (C) 2001 Dirk Mueller (mueller@kde.org)
 * Copyright (C) 2004-2025 Apple Inc. All rights reserved.
 *           (C) 2006 Alexey Proskuryakov (ap@nypop.com)
 * Copyright (C) 2014 Google Inc. All rights reserved.
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
#include "HTMLLabelElement.h"

#include "Document.h"
#include "Event.h"
#include "EventNames.h"
#include "FormListedElement.h"
#include "HTMLFormControlElement.h"
#include "HTMLNames.h"
#include "MouseEvent.h"
#include "SelectionRestorationMode.h"
#include "TypedElementDescendantIteratorInlines.h"
#include <wtf/SetForScope.h>
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(HTMLLabelElement);

using namespace HTMLNames;

static HTMLElement* elementForAttributeIfLabelable(const HTMLLabelElement& context, const QualifiedName& attributeName)
{
    if (RefPtr element = context.elementForAttributeInternal(attributeName)) {
        if (auto* labelableElement = dynamicDowncast<HTMLElement>(*element)) {
            if (labelableElement->isLabelable())
                return labelableElement;
        }
    }
    return nullptr;
}

inline HTMLLabelElement::HTMLLabelElement(const QualifiedName& tagName, Document& document)
    : HTMLElement(tagName, document)
{
    ASSERT(hasTagName(labelTag));
}

Ref<HTMLLabelElement> HTMLLabelElement::create(const QualifiedName& tagName, Document& document)
{
    return adoptRef(*new HTMLLabelElement(tagName, document));
}

Ref<HTMLLabelElement> HTMLLabelElement::create(Document& document)
{
    return adoptRef(*new HTMLLabelElement(labelTag, document));
}

RefPtr<HTMLElement> HTMLLabelElement::control() const
{
    if (!hasAttributeWithoutSynchronization(forAttr)) {
        // https://html.spec.whatwg.org/multipage/forms.html#labeled-control
        for (Ref descendant : descendantsOfType<HTMLElement>(*this)) {
            if (descendant->isLabelable()) {
                // FIXME: Remove suppression once rdar://189998365 is fixed.
                SUPPRESS_MEMORY_UNSAFE_CAST return const_cast<HTMLElement*>(descendant.ptr());
            }
        }
        return nullptr;
    }
    return isConnected() ? elementForAttributeIfLabelable(*this, forAttr) : nullptr;
}

RefPtr<HTMLElement> HTMLLabelElement::controlForBindings() const
{
    return dynamicDowncast<HTMLElement>(retargetReferenceTargetForBindings(control()));
}

HTMLFormElement* HTMLLabelElement::form() const
{
    if (RefPtr element = control()) {
        if (auto* listedElement = element->asValidatedFormListedElement())
            return listedElement->form();
    }
    return nullptr;
}

RefPtr<HTMLFormElement> HTMLLabelElement::formForBindings() const
{
    // FIXME: The downcast should be unnecessary, but the WPT was written before https://github.com/WICG/webcomponents/issues/1072 was resolved. Update once the WPT has been updated.
    return dynamicDowncast<HTMLFormElement>(retargetReferenceTargetForBindings(form()));
}

void HTMLLabelElement::setActive(bool down)
{
    if (down == active())
        return;

    // Update our status first.
    HTMLElement::setActive(down);

    // Also update our corresponding control.
    if (auto element = control())
        element->setActive(down);
}

void HTMLLabelElement::setHovered(bool over)
{
    if (over == hovered())
        return;
        
    // Update our status first.
    HTMLElement::setHovered(over);

    // Also update our corresponding control.
    if (auto element = control())
        element->setHovered(over);
}

bool HTMLLabelElement::isEventTargetedAtInteractiveDescendants(Event& event) const
{
    RefPtr node = dynamicDowncast<Node>(*event.target());
    if (!node)
        return false;

    // Interactive content (e.g. a <button>) may remove itself while handling the
    // click, detaching it from the label before the label's default action runs.
    // The event path was computed before that mutation, so the label still
    // default-handles the click and must do nothing. Only bail when the target
    // is still connected but outside the label.
    if (node->isConnected() && !isShadowIncludingInclusiveAncestorOf(node.get()))
        return false;

    for (RefPtr it = node; it && it != this; it = it->parentElementInComposedTree()) {
        RefPtr element = dynamicDowncast<HTMLElement>(*it);
        if (element && element->isInteractiveContent())
            return true;
    }

    return false;
}
void HTMLLabelElement::defaultEventHandler(Event& event)
{
    if (isAnyClick(event) && !m_processingClick) {
        auto control = this->control();

        // If we can't find a control or if the control received the click
        // event, then there's no need for us to do anything.
        RefPtr eventTarget = dynamicDowncast<Node>(event.target());
        if (!control || (eventTarget && control->isShadowIncludingInclusiveAncestorOf(eventTarget.get()))) {
            HTMLElement::defaultEventHandler(event);
            return;
        }

        // The activation behavior of a label element for events targeted at interactive
        // content descendants of a label element, and any descendants of those interactive
        // content descendants, must be to do nothing.
        // https://html.spec.whatwg.org/#the-label-element
        if (isEventTargetedAtInteractiveDescendants(event)) {
            HTMLElement::defaultEventHandler(event);
            return;
        }

        SetForScope processingClick(m_processingClick, true);

        control->dispatchSimulatedClick(&event);

        if (control->isMouseFocusable())
            control->focus({ { }, { }, { }, { }, { }, FocusTrigger::Click, { } });

        event.setDefaultHandled();
    }

    HTMLElement::defaultEventHandler(event);
}

bool HTMLLabelElement::hasActivationBehavior() const
{
    return true;
}

void HTMLLabelElement::focus(const FocusOptions& options)
{
    Ref protectedThis(*this);
    if (isFocusable()) {
        // The value of restorationMode is not used for label elements as it doesn't override updateFocusAppearance.
        Element::focus(options);
        return;
    }

    // To match other browsers, always restore previous selection.
    if (auto element = control())
        element->focus({ { }, { }, SelectionRestorationMode::RestoreOrSelectAll, options.direction });
}

bool HTMLLabelElement::accessKeyAction(bool sendMouseEvents)
{
    if (auto element = control())
        return element->accessKeyAction(sendMouseEvents);

    return HTMLElement::accessKeyAction(sendMouseEvents);
}

} // namespace
