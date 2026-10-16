/*
 * Copyright (C) 2015-2025 Apple Inc. All rights reserved.
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
 * THIS SOFTWARE IS PROVIDED BY APPLE INC. AND ITS CONTRIBUTORS ``AS IS''
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO,
 * THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL APPLE INC. OR ITS CONTRIBUTORS
 * BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 * CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 * SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
 * INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
 * CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF
 * THE POSSIBILITY OF SUCH DAMAGE.
 */

#include "config.h"
#include "GenericCachedHTMLCollection.h"

#include "CachedHTMLCollectionInlines.h"
#include "HTMLNames.h"
#include "HTMLOptionElement.h"
#include "HTMLSelectElement.h"

namespace WebCore {

using namespace HTMLNames;

template <CollectionTraversalType traversalType>
SharedGenericCachedHTMLCollection<traversalType>::SharedGenericCachedHTMLCollection(ContainerNode& base, CollectionType collectionType)
    : CachedHTMLCollection<SharedGenericCachedHTMLCollection<traversalType>>(base, collectionType)
{ }

template <CollectionType type>
GenericCachedHTMLCollection<type>::GenericCachedHTMLCollection(ContainerNode& base, CollectionType collectionType)
    : GenericCachedHTMLCollectionBase<type>(base, collectionType)
{ }
// Explicit template instantiations for each CollectionType.
template GenericCachedHTMLCollection<CollectionType::NodeChildren>::GenericCachedHTMLCollection(ContainerNode&, CollectionType);
template GenericCachedHTMLCollection<CollectionType::TRCells>::GenericCachedHTMLCollection(ContainerNode&, CollectionType);
template GenericCachedHTMLCollection<CollectionType::TSectionRows>::GenericCachedHTMLCollection(ContainerNode&, CollectionType);
template GenericCachedHTMLCollection<CollectionType::TableTBodies>::GenericCachedHTMLCollection(ContainerNode&, CollectionType);
template GenericCachedHTMLCollection<CollectionType::SelectedOptions>::GenericCachedHTMLCollection(ContainerNode&, CollectionType);
template GenericCachedHTMLCollection<CollectionType::MapAreas>::GenericCachedHTMLCollection(ContainerNode&, CollectionType);
template GenericCachedHTMLCollection<CollectionType::DocImages>::GenericCachedHTMLCollection(ContainerNode&, CollectionType);
template GenericCachedHTMLCollection<CollectionType::DocScripts>::GenericCachedHTMLCollection(ContainerNode&, CollectionType);
template GenericCachedHTMLCollection<CollectionType::DocForms>::GenericCachedHTMLCollection(ContainerNode&, CollectionType);
template GenericCachedHTMLCollection<CollectionType::DocEmbeds>::GenericCachedHTMLCollection(ContainerNode&, CollectionType);
template GenericCachedHTMLCollection<CollectionType::DocLinks>::GenericCachedHTMLCollection(ContainerNode&, CollectionType);
template GenericCachedHTMLCollection<CollectionType::DocAnchors>::GenericCachedHTMLCollection(ContainerNode&, CollectionType);
template GenericCachedHTMLCollection<CollectionType::DataListOptions>::GenericCachedHTMLCollection(ContainerNode&, CollectionType);
template GenericCachedHTMLCollection<CollectionType::FieldSetElements>::GenericCachedHTMLCollection(ContainerNode&, CollectionType);

template <CollectionType type>
GenericCachedHTMLCollection<type>::~GenericCachedHTMLCollection() = default;
template GenericCachedHTMLCollection<CollectionType::NodeChildren>::~GenericCachedHTMLCollection();
template GenericCachedHTMLCollection<CollectionType::TRCells>::~GenericCachedHTMLCollection();
template GenericCachedHTMLCollection<CollectionType::TSectionRows>::~GenericCachedHTMLCollection();
template GenericCachedHTMLCollection<CollectionType::TableTBodies>::~GenericCachedHTMLCollection();
template GenericCachedHTMLCollection<CollectionType::SelectedOptions>::~GenericCachedHTMLCollection();
template GenericCachedHTMLCollection<CollectionType::MapAreas>::~GenericCachedHTMLCollection();
template GenericCachedHTMLCollection<CollectionType::DocImages>::~GenericCachedHTMLCollection();
template GenericCachedHTMLCollection<CollectionType::DocScripts>::~GenericCachedHTMLCollection();
template GenericCachedHTMLCollection<CollectionType::DocForms>::~GenericCachedHTMLCollection();
template GenericCachedHTMLCollection<CollectionType::DocEmbeds>::~GenericCachedHTMLCollection();
template GenericCachedHTMLCollection<CollectionType::DocLinks>::~GenericCachedHTMLCollection();
template GenericCachedHTMLCollection<CollectionType::DocAnchors>::~GenericCachedHTMLCollection();
template GenericCachedHTMLCollection<CollectionType::DataListOptions>::~GenericCachedHTMLCollection();
template GenericCachedHTMLCollection<CollectionType::FieldSetElements>::~GenericCachedHTMLCollection();

static ALWAYS_INLINE bool elementMatchesCollectionType(CollectionType type, const ContainerNode& ownerNode, Element& element)
{
    switch (type) {
    case CollectionType::NodeChildren:
        return true;
    case CollectionType::DocImages:
        return element.hasTagName(imgTag);
    case CollectionType::DocScripts:
        return element.hasTagName(scriptTag);
    case CollectionType::DocForms:
        return element.hasTagName(formTag);
    case CollectionType::TableTBodies:
        return element.hasTagName(tbodyTag);
    case CollectionType::TRCells:
        return element.hasTagName(tdTag) || element.hasTagName(thTag);
    case CollectionType::TSectionRows:
        return element.hasTagName(trTag);
    case CollectionType::SelectedOptions: {
        auto* optionElement = dynamicDowncast<HTMLOptionElement>(element);
        if (!optionElement)
            return false;
        return optionElement->selected() && optionElement->ownerSelectElement() == &ownerNode;
    }
    case CollectionType::DataListOptions:
        return is<HTMLOptionElement>(element);
    case CollectionType::MapAreas:
        return element.hasTagName(areaTag);
    case CollectionType::DocEmbeds:
        return element.hasTagName(embedTag);
    case CollectionType::DocLinks:
        return (element.hasTagName(aTag) || element.hasTagName(areaTag)) && element.hasAttributeWithoutSynchronization(hrefAttr);
    case CollectionType::DocAnchors:
        return element.hasTagName(aTag) && element.hasAttributeWithoutSynchronization(nameAttr);
    case CollectionType::FieldSetElements:
        return element.isFormListedElement();
    case CollectionType::ByClass:
    case CollectionType::ByTag:
    case CollectionType::ByHTMLTag:
    case CollectionType::AllDescendants:
    case CollectionType::DocAll:
    case CollectionType::DocEmpty:
    case CollectionType::DocumentAllNamedItems:
    case CollectionType::DocumentNamedItems:
    case CollectionType::FormControls:
    case CollectionType::SelectOptions:
    case CollectionType::TableRows:
    case CollectionType::WindowNamedItems:
        break;
    }
    // Remaining collection types have their own CachedHTMLCollection subclasses and are not using GenericCachedHTMLCollection.
    ASSERT_NOT_REACHED();
    return false;
}

template <CollectionTraversalType traversalType>
bool SharedGenericCachedHTMLCollection<traversalType>::elementMatches(Element& element) const
{
    return elementMatchesCollectionType(this->type(), this->ownerNode(), element);
}

template class SharedGenericCachedHTMLCollection<CollectionTraversalType::Descendants>;
template class SharedGenericCachedHTMLCollection<CollectionTraversalType::ChildrenOnly>;

template <CollectionType type>
bool GenericCachedHTMLCollection<type>::elementMatches(Element& element) const requires (hasOwnCachedHTMLCollection(type))
{
    return elementMatchesCollectionType(type, this->ownerNode(), element);
}

template bool GenericCachedHTMLCollection<CollectionType::NodeChildren>::elementMatches(Element&) const;
template bool GenericCachedHTMLCollection<CollectionType::DocForms>::elementMatches(Element&) const;
template bool GenericCachedHTMLCollection<CollectionType::DocImages>::elementMatches(Element&) const;
template bool GenericCachedHTMLCollection<CollectionType::DocLinks>::elementMatches(Element&) const;


} // namespace WebCore
