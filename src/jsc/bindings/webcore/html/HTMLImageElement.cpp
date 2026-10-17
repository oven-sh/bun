/*
 * Copyright (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 * Copyright (C) 2004-2026 Apple Inc. All rights reserved.
 * Copyright (C) 2010-2015 Google Inc. All rights reserved.
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
#include "HTMLImageElement.h"

#include "CommonAtomStrings.h"
#include "ElementInlines.h"
#include "HTMLDocument.h"
#include "HTMLFormElement.h"
#include "HTMLParserIdioms.h"
#include "JSDOMPromiseDeferred.h"
#include "JSRequestPriority.h"
#include "NodeName.h"
#include "ReferrerPolicy.h"
#include "RequestPriority.h"
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(HTMLImageElement);

using namespace HTMLNames;

HTMLImageElement::HTMLImageElement(const QualifiedName& tagName, Document& document)
    : HTMLElement(tagName, document)
{
    ASSERT(hasTagName(imgTag));
}

Ref<HTMLImageElement> HTMLImageElement::create(Document& document)
{
    return adoptRef(*new HTMLImageElement(imgTag, document));
}

Ref<HTMLImageElement> HTMLImageElement::create(const QualifiedName& tagName, Document& document)
{
    return adoptRef(*new HTMLImageElement(tagName, document));
}

HTMLImageElement::~HTMLImageElement()
{
    setForm(nullptr);
}

void HTMLImageElement::resetFormOwner()
{
    setForm(HTMLFormElement::findClosestFormAncestor(*this));
}

void HTMLImageElement::setFormInternal(RefPtr<HTMLFormElement>&& newForm)
{
    if (RefPtr form = FormAssociatedElement::form())
        form->unregisterImgElement(*this);
    FormAssociatedElement::setFormInternal(newForm.copyRef());
    if (newForm)
        newForm->registerImgElement(*this);
}

void HTMLImageElement::formOwnerRemovedFromTree(const Node& formRoot)
{
    Ref rootNode = traverseToRootNode(); // Do not rely on rootNode() because our IsInTreeScope can be outdated.
    if (rootNode.ptr() != &formRoot)
        setForm(nullptr);
}

Ref<HTMLImageElement> HTMLImageElement::createForLegacyFactoryFunction(Document& document, std::optional<unsigned> width, std::optional<unsigned> height)
{
    auto image = adoptRef(*new HTMLImageElement(imgTag, document));
    if (width)
        image->setUnsignedIntegralAttribute(widthAttr, width.value());
    if (height)
        image->setUnsignedIntegralAttribute(heightAttr, height.value());
    return image;
}

void HTMLImageElement::attributeChanged(const QualifiedName& name, const AtomString& oldValue, const AtomString& newValue, AttributeModificationReason attributeModificationReason)
{
    HTMLElement::attributeChanged(name, oldValue, newValue, attributeModificationReason);

    switch (name.nodeName()) {
    case AttributeNames::nameAttr: {
        bool willHaveName = !newValue.isEmpty();
        if (RefPtr document = dynamicDowncast<HTMLDocument>(this->document()); document && m_hadNameBeforeAttributeChanged != willHaveName && isConnected() && !isInShadowTree()) {
            const AtomString& id = getIdAttribute();
            if (!id.isEmpty() && id != getNameAttribute()) {
                if (willHaveName)
                    document->addDocumentNamedItem(id, *this);
                else
                    document->removeDocumentNamedItem(id, *this);
            }
        }
        m_hadNameBeforeAttributeChanged = willHaveName;
        break;
    }
    default:
        break;
    }
}

bool HTMLImageElement::isInteractiveContent() const
{
    return hasAttributeWithoutSynchronization(usemapAttr);
}

Node::NeedsPostConnectionSteps HTMLImageElement::insertionSteps(InsertionType insertionType, ContainerNode& parentOfInsertedTree)
{
    FormAssociatedElement::elementInsertedIntoAncestor(*this, insertionType);
    if (!form())
        resetFormOwner();

    return HTMLElement::insertionSteps(insertionType, parentOfInsertedTree);
}

void HTMLImageElement::removingSteps(RemovalType removalType, ContainerNode& oldParentOfRemovedTree)
{
    HTMLElement::removingSteps(removalType, oldParentOfRemovedTree);
    FormAssociatedElement::elementRemovedFromAncestor(*this, removalType);
}

unsigned HTMLImageElement::width()
{
    return parseHTMLNonNegativeInteger(attributeWithoutSynchronization(widthAttr)).value_or(0);
}

unsigned HTMLImageElement::height()
{
    return parseHTMLNonNegativeInteger(attributeWithoutSynchronization(heightAttr)).value_or(0);
}

bool HTMLImageElement::isURLAttribute(const Attribute& attribute) const
{
    return attribute.name() == srcAttr
        || attribute.name() == lowsrcAttr
        || attribute.name() == longdescAttr
        || (attribute.name() == usemapAttr && attribute.value().string()[0] != '#')
        || HTMLElement::isURLAttribute(attribute);
}

bool HTMLImageElement::complete() const
{
    return attributeWithoutSynchronization(srcAttr).isEmpty();
}

String HTMLImageElement::decoding() const
{
    const AtomString& decodingMode = attributeWithoutSynchronization(decodingAttr);
    if (equalLettersIgnoringASCIICase(decodingMode, "sync"_s))
        return "sync"_s;
    if (equalLettersIgnoringASCIICase(decodingMode, "async"_s))
        return "async"_s;
    return autoAtom();
}

void HTMLImageElement::decode(Ref<DeferredPromise>&& promise)
{
    promise->reject(Exception { ExceptionCode::EncodingError, "Loading error."_s });
}

String HTMLImageElement::crossOrigin() const
{
    return parseCORSSettingsAttribute(attributeWithoutSynchronization(crossoriginAttr));
}

AtomString HTMLImageElement::srcsetForBindings() const
{
    return getAttributeForBindings(srcsetAttr);
}

String HTMLImageElement::referrerPolicyForBindings() const
{
    return referrerPolicyToString(referrerPolicy());
}

ReferrerPolicy HTMLImageElement::referrerPolicy() const
{
    return parseReferrerPolicy(attributeWithoutSynchronization(referrerpolicyAttr), ReferrerPolicySource::ReferrerPolicyAttribute).value_or(ReferrerPolicy::EmptyString);
}

String HTMLImageElement::fetchPriorityForBindings() const
{
    return convertEnumerationToString(fetchPriority());
}

RequestPriority HTMLImageElement::fetchPriority() const
{
    return parseEnumerationFromString<RequestPriority>(attributeWithoutSynchronization(fetchpriorityAttr)).value_or(RequestPriority::Auto);
}

}
