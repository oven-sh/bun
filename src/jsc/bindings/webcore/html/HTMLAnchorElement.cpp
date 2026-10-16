/*
 * Copyright (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 *           (C) 2000 Simon Hausmann <hausmann@kde.org>
 * Copyright (C) 2003-2025 Apple Inc. All rights reserved.
 * Copyright (C) 2013 Google Inc. All rights reserved.
 *           (C) 2006 Graham Dennis (graham.dennis@gmail.com)
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
 */

#include "config.h"
#include "HTMLAnchorElement.h"

#include "DOMTokenList.h"
#include "ElementInlines.h"
#include "EventNames.h"
#include "History.h"
#include "KeyboardEvent.h"
#include "Location.h"
#include "MouseEvent.h"
#include "ReferrerPolicy.h"
#include "Window.h"
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(HTMLAnchorElement);

using namespace HTMLNames;

HTMLAnchorElement::HTMLAnchorElement(const QualifiedName& tagName, Document& document)
    : HTMLElement(tagName, document)
{
}

Ref<HTMLAnchorElement> HTMLAnchorElement::create(Document& document)
{
    return adoptRef(*new HTMLAnchorElement(aTag, document));
}

Ref<HTMLAnchorElement> HTMLAnchorElement::create(const QualifiedName& tagName, Document& document)
{
    return adoptRef(*new HTMLAnchorElement(tagName, document));
}

HTMLAnchorElement::~HTMLAnchorElement() = default;

bool HTMLAnchorElement::supportsFocus() const
{
    if (hasEditableStyle())
        return HTMLElement::supportsFocus();
    // If not a link we should still be able to focus the element if it has tabIndex.
    return isLink() || HTMLElement::supportsFocus();
}

bool HTMLAnchorElement::isMouseFocusable() const
{
    // Only allow links with tabIndex or contentEditable to be mouse focusable.
    if (isLink())
        return HTMLElement::supportsFocus();

    return HTMLElement::isMouseFocusable();
}

bool HTMLAnchorElement::isInteractiveContent() const
{
    return isLink();
}

void HTMLAnchorElement::defaultEventHandler(Event& event)
{
    if (isLink()) {
        if (focused() && KeyboardEvent::isEnterKeyKeydownEvent(event)) {
            event.setDefaultHandled();
            dispatchSimulatedClick(&event);
            return;
        }

        if (MouseEvent::canTriggerActivationBehavior(event)) {
            handleClick(event);
            return;
        }
    }

    HTMLElement::defaultEventHandler(event);
}

void HTMLAnchorElement::attributeChanged(const QualifiedName& name, const AtomString& oldValue, const AtomString& newValue, AttributeModificationReason attributeModificationReason)
{
    HTMLElement::attributeChanged(name, oldValue, newValue, attributeModificationReason);

    if (name == hrefAttr)
        setIsLink(!newValue.isNull());
    else if (name == relAttr) {
        if (m_relList)
            m_relList->associatedAttributeValueChanged();
    }
}

bool HTMLAnchorElement::isURLAttribute(const Attribute& attribute) const
{
    // FIXME: Should this be attribute.name().matches(hrefAttr) to also enforce the namespace?
    return hrefAttr->hasLocalName(attribute.name().localName()) || HTMLElement::isURLAttribute(attribute);
}

bool HTMLAnchorElement::draggable() const
{
    const AtomString& value = attributeWithoutSynchronization(draggableAttr);
    if (equalLettersIgnoringASCIICase(value, "true"_s))
        return true;
    if (equalLettersIgnoringASCIICase(value, "false"_s))
        return false;
    return hasAttributeWithoutSynchronization(hrefAttr);
}

URL HTMLAnchorElement::href() const
{
    return protect(document())->encodingParseURL(attributeWithoutSynchronization(hrefAttr));
}

DOMTokenList& HTMLAnchorElement::relList()
{
    if (!m_relList) {
        lazyInitialize(m_relList, makeUniqueWithoutRefCountedCheck<DOMTokenList>(*this, HTMLNames::relAttr, [](Document&, StringView token) {
            return equalLettersIgnoringASCIICase(token, "noreferrer"_s) || equalLettersIgnoringASCIICase(token, "noopener"_s) || equalLettersIgnoringASCIICase(token, "opener"_s);
        }));
    }
    return *m_relList;
}

const AtomString& HTMLAnchorElement::name() const
{
    return getNameAttribute();
}

int HTMLAnchorElement::defaultTabIndex() const
{
    return 0;
}

AtomString HTMLAnchorElement::target() const
{
    return attributeWithoutSynchronization(targetAttr);
}

String HTMLAnchorElement::origin() const
{
    auto url = href();
    if (!url.isValid())
        return emptyString();
    return URLDecomposition::origin();
}

void HTMLAnchorElement::setProtocol(StringView value)
{
    if (auto url = href(); !url.isValid())
        return;
    URLDecomposition::setProtocol(value);
}

String HTMLAnchorElement::text()
{
    return textContent();
}

void HTMLAnchorElement::setText(String&& text)
{
    setTextContent(WTF::move(text));
}

void HTMLAnchorElement::handleClick(Event& event)
{
    event.setDefaultHandled();

    // There is only this window to navigate.
    auto& target = hasAttributeWithoutSynchronization(targetAttr) ? attributeWithoutSynchronization(targetAttr) : document().baseTarget();
    if (!target.isEmpty() && !equalIgnoringASCIICase(target, "_self"_s) && !equalIgnoringASCIICase(target, "_parent"_s) && !equalIgnoringASCIICase(target, "_top"_s))
        return;
    if (RefPtr window = document().window(); window && (hasTagName(aTag) || isConnected()))
        window->location().navigate(href(), HistoryHandling::Push);
}

bool HTMLAnchorElement::hasActivationBehavior() const
{
    return isLink();
}

String HTMLAnchorElement::referrerPolicyForBindings() const
{
    return referrerPolicyToString(referrerPolicy());
}

ReferrerPolicy HTMLAnchorElement::referrerPolicy() const
{
    return parseReferrerPolicy(attributeWithoutSynchronization(referrerpolicyAttr), ReferrerPolicySource::ReferrerPolicyAttribute).value_or(ReferrerPolicy::EmptyString);
}

void HTMLAnchorElement::setFullURL(const URL& fullURL)
{
    setAttributeWithoutSynchronization(hrefAttr, AtomString { fullURL.string() });
}

}
