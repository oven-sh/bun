/*
 * Copyright (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 *           (C) 2001 Dirk Mueller (mueller@kde.org)
 * Copyright (C) 2003-2025 Apple Inc. All rights reserved.
 * Copyright (C) 2009 Rob Buis (rwlbuis@gmail.com)
 * Copyright (C) 2011 Google Inc. All rights reserved.
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
#include "HTMLLinkElement.h"

#include "Attribute.h"
#include "DOMTokenList.h"
#include "Document.h"
#include "ElementInlines.h"
#include "HTMLNames.h"
#include "HTMLParserIdioms.h"
#include "JSRequestPriority.h"
#include "NodeName.h"
#include "ReferrerPolicy.h"
#include "RequestPriority.h"
#include <wtf/SortedArrayMap.h>
#include <wtf/TZoneMallocInlines.h>
#include <wtf/text/MakeString.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(HTMLLinkElement);

using namespace HTMLNames;

// https://html.spec.whatwg.org/#linkTypes
static constexpr SortedArraySet supportedLinkTypes { WTF::toArray<ComparableLettersLiteral>({
    "alternate"_s,
    "apple-touch-icon"_s,
    "apple-touch-icon-precomposed"_s,
    "dns-prefetch"_s,
    "expect"_s,
    "icon"_s,
    "modulepreload"_s,
    "preload"_s,
    "stylesheet"_s,
    "tls-certificate-binding"_s,
}) };

inline HTMLLinkElement::HTMLLinkElement(const QualifiedName& tagName, Document& document)
    : HTMLElement(tagName, document)
{
    ASSERT(hasTagName(linkTag));
}

Ref<HTMLLinkElement> HTMLLinkElement::create(const QualifiedName& tagName, Document& document, bool)
{
    return adoptRef(*new HTMLLinkElement(tagName, document));
}

HTMLLinkElement::~HTMLLinkElement() = default;

void HTMLLinkElement::attributeChanged(const QualifiedName& name, const AtomString& oldValue, const AtomString& newValue, AttributeModificationReason attributeModificationReason)
{
    switch (name.nodeName()) {
    case AttributeNames::relAttr:
        if (m_relList)
            m_relList->associatedAttributeValueChanged();
        break;
    case AttributeNames::sizesAttr:
        if (m_sizes)
            m_sizes->associatedAttributeValueChanged();
        break;
    case AttributeNames::blockingAttr:
        if (m_blockingList)
            m_blockingList->associatedAttributeValueChanged();
        break;
    default:
        HTMLElement::attributeChanged(name, oldValue, newValue, attributeModificationReason);
        break;
    }
}

String HTMLLinkElement::crossOrigin() const
{
    return parseCORSSettingsAttribute(attributeWithoutSynchronization(crossoriginAttr));
}

String HTMLLinkElement::as() const
{
    String as = attributeWithoutSynchronization(asAttr);
    if (equalLettersIgnoringASCIICase(as, "fetch"_s)
        || equalLettersIgnoringASCIICase(as, "image"_s)
        || equalLettersIgnoringASCIICase(as, "script"_s)
        || equalLettersIgnoringASCIICase(as, "style"_s)
        || equalLettersIgnoringASCIICase(as, "track"_s)
        || equalLettersIgnoringASCIICase(as, "font"_s))
        return as.convertToASCIILowercase();
    return String();
}

DOMTokenList& HTMLLinkElement::sizes()
{
    if (!m_sizes)
        lazyInitialize(m_sizes, makeUniqueWithoutRefCountedCheck<DOMTokenList>(*this, sizesAttr));
    return *m_sizes;
}

DOMTokenList& HTMLLinkElement::relList()
{
    if (!m_relList) 
        lazyInitialize(m_relList, makeUniqueWithoutRefCountedCheck<DOMTokenList>(*this, HTMLNames::relAttr, [](Document&, StringView token) {
            return supportedLinkTypes.contains(token);
        }));
    return *m_relList;
}

// https://html.spec.whatwg.org/multipage/semantics.html#dom-link-blocking
DOMTokenList& HTMLLinkElement::blocking()
{
    if (!m_blockingList) {
        lazyInitialize(m_blockingList, makeUniqueWithoutRefCountedCheck<DOMTokenList>(*this, HTMLNames::blockingAttr, [](Document&, StringView token) {
            if (equalLettersIgnoringASCIICase(token, "render"_s))
                return true;
            return false;
        }));
    }
    return *m_blockingList;
}

bool HTMLLinkElement::isURLAttribute(const Attribute& attribute) const
{
    // FIXME: Should these be attribute.name().matches(...) to also enforce the namespace?
    return hrefAttr->hasLocalName(attribute.name().localName())
    || HTMLElement::isURLAttribute(attribute);
}

URL HTMLLinkElement::href() const
{
    return protect(document())->encodingParseURL(attributeWithoutSynchronization(hrefAttr));
}

AtomString HTMLLinkElement::target() const
{
    return attributeWithoutSynchronization(targetAttr);
}

const AtomString& HTMLLinkElement::type() const
{
    return attributeWithoutSynchronization(typeAttr);
}

String HTMLLinkElement::referrerPolicyForBindings() const
{
    return referrerPolicyToString(referrerPolicy());
}

ReferrerPolicy HTMLLinkElement::referrerPolicy() const
{
    return parseReferrerPolicy(attributeWithoutSynchronization(referrerpolicyAttr), ReferrerPolicySource::ReferrerPolicyAttribute).value_or(ReferrerPolicy::EmptyString);
}

String HTMLLinkElement::debugDescription() const
{
    return makeString(HTMLElement::debugDescription(), ' ', type(), ' ', href().string());
}

String HTMLLinkElement::fetchPriorityForBindings() const
{
    return convertEnumerationToString(fetchPriority());
}

RequestPriority HTMLLinkElement::fetchPriority() const
{
    return parseEnumerationFromString<RequestPriority>(attributeWithoutSynchronization(fetchpriorityAttr)).value_or(RequestPriority::Auto);
}

} // namespace WebCore
