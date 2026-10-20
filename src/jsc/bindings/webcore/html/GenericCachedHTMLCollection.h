/*
 * Copyright (C) 2015-2024 Apple Inc. All rights reserved.
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

#pragma once

#include "CollectionType.h"

namespace WebCore {

template <CollectionType type>
class GenericCachedHTMLCollection;

template<CollectionType type>
struct CollectionClassTraits<GenericCachedHTMLCollection<type>> {
    static constexpr CollectionType collectionType = type;
};

template <CollectionTraversalType>
class SharedGenericCachedHTMLCollection;

// CachedHTMLCollection takes only the kind of traversal from this.
template<>
struct CollectionClassTraits<SharedGenericCachedHTMLCollection<CollectionTraversalType::Descendants>> {
    static constexpr CollectionType collectionType = CollectionType::DocImages;
};

template<>
struct CollectionClassTraits<SharedGenericCachedHTMLCollection<CollectionTraversalType::ChildrenOnly>> {
    static constexpr CollectionType collectionType = CollectionType::TRCells;
};

} // namespace WebCore

#include "CachedHTMLCollection.h"

namespace WebCore {

// Upstream instantiates CachedHTMLCollection, its index cache and its traversal for each collection type. In Bun only these types have them for themselves.
// The other types share one instantiation for each kind of traversal. It looks at type() for every element it visits, which makes a walk over descendants a third slower.
constexpr bool hasOwnCachedHTMLCollection(CollectionType type)
{
    return type == CollectionType::NodeChildren || type == CollectionType::DocForms || type == CollectionType::DocImages || type == CollectionType::DocLinks;
}

template <CollectionTraversalType traversalType>
class SharedGenericCachedHTMLCollection : public CachedHTMLCollection<SharedGenericCachedHTMLCollection<traversalType>> {
    WTF_MAKE_TZONE_NON_HEAP_ALLOCATABLE(SharedGenericCachedHTMLCollection);
public:
    bool elementMatches(Element&) const;

protected:
    SharedGenericCachedHTMLCollection(ContainerNode&, CollectionType);
};

template <CollectionType type>
using GenericCachedHTMLCollectionBase = std::conditional_t<hasOwnCachedHTMLCollection(type),
    CachedHTMLCollection<GenericCachedHTMLCollection<type>>,
    SharedGenericCachedHTMLCollection<CollectionTypeTraits<type>::traversalType>>;

template <CollectionType type>
class GenericCachedHTMLCollection final : public GenericCachedHTMLCollectionBase<type> {
    WTF_MAKE_TZONE_ALLOCATED_TEMPLATE(GenericCachedHTMLCollection);
    static_assert(CollectionTypeTraits<type>::traversalType != CollectionTraversalType::CustomForwardOnly, "CustomForwardOnly should use non GenericCachedHTMLCollection.");
public:
    static Ref<GenericCachedHTMLCollection> create(ContainerNode& base, CollectionType collectionType)
    {
        ASSERT(collectionType == CollectionClassTraits<GenericCachedHTMLCollection>::collectionType); // Verify correct instantiation.
        return adoptRef(*new GenericCachedHTMLCollection(base, collectionType));
    }

    virtual ~GenericCachedHTMLCollection();

    bool elementMatches(Element&) const requires (hasOwnCachedHTMLCollection(type));

private:
    GenericCachedHTMLCollection(ContainerNode&, CollectionType);
};

WTF_MAKE_TZONE_ALLOCATED_TEMPLATE_IMPL(template<CollectionType type>, GenericCachedHTMLCollection<type>);

// Type aliases for GenericCachedHTMLCollection instantiations.
using HTMLNodeChildrenCollection = GenericCachedHTMLCollection<CollectionType::NodeChildren>;
using HTMLTRCellsCollection = GenericCachedHTMLCollection<CollectionType::TRCells>;
using HTMLTSectionRowsCollection = GenericCachedHTMLCollection<CollectionType::TSectionRows>;
using HTMLTableTBodiesCollection = GenericCachedHTMLCollection<CollectionType::TableTBodies>;
using HTMLSelectedOptionsCollection = GenericCachedHTMLCollection<CollectionType::SelectedOptions>;
using HTMLMapAreasCollection = GenericCachedHTMLCollection<CollectionType::MapAreas>;
using HTMLDocImagesCollection = GenericCachedHTMLCollection<CollectionType::DocImages>;
using HTMLDocScriptsCollection = GenericCachedHTMLCollection<CollectionType::DocScripts>;
using HTMLDocFormsCollection = GenericCachedHTMLCollection<CollectionType::DocForms>;
using HTMLDocEmbedsCollection = GenericCachedHTMLCollection<CollectionType::DocEmbeds>;
using HTMLDocLinksCollection = GenericCachedHTMLCollection<CollectionType::DocLinks>;
using HTMLDocAnchorsCollection = GenericCachedHTMLCollection<CollectionType::DocAnchors>;
using HTMLDataListOptionsCollection = GenericCachedHTMLCollection<CollectionType::DataListOptions>;
using HTMLFieldSetElementsCollection = GenericCachedHTMLCollection<CollectionType::FieldSetElements>;

} // namespace WebCore

SPECIALIZE_TYPE_TRAITS_BEGIN(WebCore::SharedGenericCachedHTMLCollection<WebCore::CollectionTraversalType::Descendants>)
    static bool isType(const WebCore::HTMLCollection& collection)
    {
        using enum WebCore::CollectionType;
        auto type = collection.type();
        return type == SelectedOptions || type == MapAreas || type == DocScripts || type == DocEmbeds || type == DocAnchors || type == DataListOptions || type == FieldSetElements;
    }
SPECIALIZE_TYPE_TRAITS_END()

SPECIALIZE_TYPE_TRAITS_BEGIN(WebCore::SharedGenericCachedHTMLCollection<WebCore::CollectionTraversalType::ChildrenOnly>)
    static bool isType(const WebCore::HTMLCollection& collection)
    {
        using enum WebCore::CollectionType;
        auto type = collection.type();
        return type == TRCells || type == TSectionRows || type == TableTBodies;
    }
SPECIALIZE_TYPE_TRAITS_END()

SPECIALIZE_TYPE_TRAITS_HTMLCOLLECTION(HTMLNodeChildrenCollection)
SPECIALIZE_TYPE_TRAITS_HTMLCOLLECTION(HTMLTRCellsCollection)
SPECIALIZE_TYPE_TRAITS_HTMLCOLLECTION(HTMLTSectionRowsCollection)
SPECIALIZE_TYPE_TRAITS_HTMLCOLLECTION(HTMLTableTBodiesCollection)
SPECIALIZE_TYPE_TRAITS_HTMLCOLLECTION(HTMLSelectedOptionsCollection)
SPECIALIZE_TYPE_TRAITS_HTMLCOLLECTION(HTMLMapAreasCollection)
SPECIALIZE_TYPE_TRAITS_HTMLCOLLECTION(HTMLDocImagesCollection)
SPECIALIZE_TYPE_TRAITS_HTMLCOLLECTION(HTMLDocScriptsCollection)
SPECIALIZE_TYPE_TRAITS_HTMLCOLLECTION(HTMLDocFormsCollection)
SPECIALIZE_TYPE_TRAITS_HTMLCOLLECTION(HTMLDocEmbedsCollection)
SPECIALIZE_TYPE_TRAITS_HTMLCOLLECTION(HTMLDocLinksCollection)
SPECIALIZE_TYPE_TRAITS_HTMLCOLLECTION(HTMLDocAnchorsCollection)
SPECIALIZE_TYPE_TRAITS_HTMLCOLLECTION(HTMLDataListOptionsCollection)
SPECIALIZE_TYPE_TRAITS_HTMLCOLLECTION(HTMLFieldSetElementsCollection)
