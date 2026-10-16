/*
 * Copyright (C) 2011 Nokia Corporation and/or its subsidiary(-ies)
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
#include "HTMLSummaryElement.h"

#include "ElementInlines.h"
#include "EventNames.h"
#include "HTMLDetailsElement.h"
#include "KeyboardEvent.h"
#include "NodeName.h"
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(HTMLSummaryElement);

using namespace HTMLNames;

Ref<HTMLSummaryElement> HTMLSummaryElement::create(const QualifiedName& tagName, Document& document)
{
    return adoptRef(*new HTMLSummaryElement(tagName, document));
}

HTMLSummaryElement::HTMLSummaryElement(const QualifiedName& tagName, Document& document)
    : HTMLElement(tagName, document)
{
    ASSERT(hasTagName(summaryTag));
}

RefPtr<HTMLDetailsElement> HTMLSummaryElement::detailsElement() const
{
    return dynamicDowncast<HTMLDetailsElement>(parentElement());
}

bool HTMLSummaryElement::isActiveSummary() const
{
    RefPtr<HTMLDetailsElement> details = detailsElement();
    if (!details)
        return false;
    return details->isActiveSummary(*this);
}

static bool isInSummaryInteractiveContent(EventTarget* target)
{
    for (RefPtr element = dynamicDowncast<Element>(target); element && !is<HTMLSummaryElement>(element); element = element->parentOrShadowHostElement()) {
        RefPtr htmlElement = dynamicDowncast<HTMLElement>(*element);
        if ((htmlElement && htmlElement->isInteractiveContent()) || element->elementName() == ElementNames::SVG::a)
            return true;
    }
    return false;
}

int HTMLSummaryElement::defaultTabIndex() const
{
    return isActiveSummary() ? 0 : -1;
}

bool HTMLSummaryElement::supportsFocus() const
{
    return isActiveSummary() || HTMLElement::supportsFocus();
}

void HTMLSummaryElement::defaultEventHandler(Event& event)
{
    if (isActiveSummary()) {
        auto& eventNames = WebCore::eventNames();
        if (event.type() == eventNames.DOMActivateEvent && !isInSummaryInteractiveContent(protect(event.target()).get())) {
            if (RefPtr<HTMLDetailsElement> details = detailsElement())
                details->toggleOpen();
            event.setDefaultHandled();
            return;
        }

        if (auto* keyboardEvent = dynamicDowncast<KeyboardEvent>(event); keyboardEvent && document().focusedElement() == this) {
            if (keyboardEvent->type() == eventNames.keydownEvent && keyboardEvent->keyIdentifier() == "U+0020"_s) {
                setActive(true);
                // No setDefaultHandled() - IE dispatches a keypress in this case.
                return;
            }
            if (keyboardEvent->type() == eventNames.keypressEvent) {
                switch (keyboardEvent->charCode()) {
                case '\r':
                    dispatchSimulatedClick(&event);
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
                    dispatchSimulatedClick(&event);
                keyboardEvent->setDefaultHandled();
                return;
            }
        }
    }

    HTMLElement::defaultEventHandler(event);
}

bool HTMLSummaryElement::hasActivationBehavior() const
{
    return true;
}

}
