/*
 * Copyright (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 * Copyright (C) 2003, 2004, 2005, 2006, 2007, 2008 Apple Inc. All rights reserved.
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

#pragma once

#include "CollectionType.h"

namespace WebCore {

class HTMLFormControlsCollection;

template<>
struct CollectionClassTraits<HTMLFormControlsCollection> {
    static constexpr CollectionType collectionType = CollectionType::FormControls;
};

} // namespace WebCore

#include "CachedHTMLCollection.h"
#include "HTMLFormElement.h"
#include "RadioNodeList.h"

namespace WebCore {

class FormListedElement;
class HTMLImageElement;

// This class is just a big hack to find form elements even in malformed HTML elements.
// The famous <table><tr><form><td> problem.

class HTMLFormControlsCollection final : public CachedHTMLCollection<HTMLFormControlsCollection> {
    WTF_MAKE_TZONE_ALLOCATED(HTMLFormControlsCollection);
public:
    static Ref<HTMLFormControlsCollection> create(ContainerNode&, CollectionType);
    virtual ~HTMLFormControlsCollection();

    HTMLElement* item(unsigned offset) const override;
    std::optional<Variant<Ref<RadioNodeList>, Ref<Element>>> namedItemOrItems(const AtomString&) const;

    HTMLFormElement& LEGACY_NODELETE ownerNode() const;

    // For CachedHTMLCollection.
    HTMLElement* LEGACY_NODELETE customElementAfter(Element*) const;

private:
    explicit HTMLFormControlsCollection(ContainerNode&);

    void invalidateCacheForDocument(Document&) override;
    void updateNamedElementCache() const override;

    mutable CheckedPtr<Element> m_cachedElement;
    mutable unsigned m_cachedElementOffsetInArray { 0 };
};

} // namespace WebCore

SPECIALIZE_TYPE_TRAITS_HTMLCOLLECTION(HTMLFormControlsCollection)
