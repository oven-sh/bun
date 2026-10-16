/*
 * Copyright (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 *           (C) 2001 Dirk Mueller (mueller@kde.org)
 * Copyright (C) 2003-2017 Apple Inc. All rights reserved.
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
#include "HTMLScriptElement.h"

#include "Document.h"
#include "ElementInlines.h"
#include "HTMLNames.h"
#include "HTMLParserIdioms.h"
#include "JSRequestPriority.h"
#include "NodeName.h"
#include "ReferrerPolicy.h"
#include "RequestPriority.h"
#include "Text.h"
#include <wtf/Ref.h>
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(HTMLScriptElement);

using namespace HTMLNames;

inline HTMLScriptElement::HTMLScriptElement(const QualifiedName& tagName, Document& document, bool wasInsertedByParser, bool alreadyStarted)
    : HTMLElement(tagName, document)
    , ScriptElement(*this, wasInsertedByParser, alreadyStarted)
{
    ASSERT(hasTagName(scriptTag));
}

Ref<HTMLScriptElement> HTMLScriptElement::create(const QualifiedName& tagName, Document& document, bool wasInsertedByParser, bool alreadyStarted)
{
    return adoptRef(*new HTMLScriptElement(tagName, document, wasInsertedByParser, alreadyStarted));
}

bool HTMLScriptElement::isURLAttribute(const Attribute& attribute) const
{
    return attribute.name() == srcAttr || HTMLElement::isURLAttribute(attribute);
}

void HTMLScriptElement::childrenChanged(const ChildChange& change)
{
    HTMLElement::childrenChanged(change);
    ScriptElement::childrenChanged(change);
}

void HTMLScriptElement::attributeChanged(const QualifiedName& name, const AtomString& oldValue, const AtomString& newValue, AttributeModificationReason attributeModificationReason)
{
    if (name == srcAttr)
        handleSourceAttribute(newValue);
    else if (name == asyncAttr)
        handleAsyncAttribute();
    else if (name == blockingAttr)
        protect(blocking())->associatedAttributeValueChanged();
    else
        HTMLElement::attributeChanged(name, oldValue, newValue, attributeModificationReason);
}

Node::NeedsPostConnectionSteps HTMLScriptElement::insertionSteps(InsertionType insertionType, ContainerNode& parentOfInsertedTree)
{
    HTMLElement::insertionSteps(insertionType, parentOfInsertedTree);
    return ScriptElement::insertionSteps(insertionType, parentOfInsertedTree);
}

void HTMLScriptElement::postConnectionSteps()
{
    ScriptElement::postConnectionSteps();
}

void HTMLScriptElement::setText(String&& value)
{
    setTextContent(WTF::move(value));
}

DOMTokenList& HTMLScriptElement::blocking()
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

void HTMLScriptElement::setAsync(bool async)
{
    setBooleanAttribute(asyncAttr, async);
    handleAsyncAttribute();
}

bool HTMLScriptElement::async() const
{
    return hasAttributeWithoutSynchronization(asyncAttr) || forceAsync();
}

String HTMLScriptElement::crossOrigin() const
{
    return parseCORSSettingsAttribute(attributeWithoutSynchronization(crossoriginAttr));
}

String HTMLScriptElement::src() const
{
    return getURLAttributeForBindings(WebCore::HTMLNames::srcAttr).string();
}

void HTMLScriptElement::setSrc(String&& value)
{
    setAttributeWithoutSynchronization(HTMLNames::srcAttr, AtomString { WTF::move(value) });
}

String HTMLScriptElement::typeAttributeValue() const
{
    return attributeWithoutSynchronization(typeAttr).string();
}

String HTMLScriptElement::languageAttributeValue() const
{
    return attributeWithoutSynchronization(languageAttr).string();
}

bool HTMLScriptElement::hasAsyncAttribute() const
{
    return hasAttributeWithoutSynchronization(asyncAttr);
}

bool HTMLScriptElement::hasSourceAttribute() const
{
    return hasAttributeWithoutSynchronization(srcAttr);
}

Ref<Element> HTMLScriptElement::cloneElementWithoutAttributesAndChildren(Document& document, CustomElementRegistry*) const
{
    return HTMLScriptElement::create(tagQName(), document, false, alreadyStarted());
}

String HTMLScriptElement::referrerPolicyForBindings() const
{
    return referrerPolicyToString(referrerPolicy());
}

ReferrerPolicy HTMLScriptElement::referrerPolicy() const
{
    return parseReferrerPolicy(attributeWithoutSynchronization(referrerpolicyAttr), ReferrerPolicySource::ReferrerPolicyAttribute).value_or(ReferrerPolicy::EmptyString);
}

String HTMLScriptElement::fetchPriorityForBindings() const
{
    return convertEnumerationToString(fetchPriority());
}

RequestPriority HTMLScriptElement::fetchPriority() const
{
    return parseEnumerationFromString<RequestPriority>(attributeWithoutSynchronization(fetchpriorityAttr)).value_or(RequestPriority::Auto);
}

}
