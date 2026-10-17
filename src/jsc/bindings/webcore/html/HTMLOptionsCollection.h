/*
 * Copyright (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 *           (C) 2000 Dirk Mueller (mueller@kde.org)
 * Copyright (C) 2004-2016 Apple Inc. All rights reserved.
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

class HTMLOptionsCollection;

template<>
struct CollectionClassTraits<HTMLOptionsCollection> {
    static constexpr CollectionType collectionType = CollectionType::SelectOptions;
};

} // namespace WebCore

#include "CachedHTMLCollection.h"
#include "HTMLOptionElement.h"
#include "HTMLSelectElement.h"

namespace WebCore {

class HTMLOptionsCollection final : public CachedHTMLCollection<HTMLOptionsCollection> {
    WTF_MAKE_TZONE_ALLOCATED_EXPORT(HTMLOptionsCollection, WEBCORE_EXPORT);
public:
    using Base = CachedHTMLCollection<HTMLOptionsCollection>;

    static Ref<HTMLOptionsCollection> create(HTMLSelectElement&, CollectionType);

    inline HTMLSelectElement& selectElement();
    inline const HTMLSelectElement& selectElement() const;

    WEBCORE_EXPORT unsigned length() const final;
    WEBCORE_EXPORT HTMLOptionElement* item(unsigned offset) const final;
    WEBCORE_EXPORT HTMLOptionElement* namedItem(const AtomString& name) const final;
    
    ExceptionOr<void> setItem(unsigned index, HTMLOptionElement*);
    
    using OptionOrOptGroupElement = Variant<Ref<HTMLOptionElement>, Ref<HTMLOptGroupElement>>;
    using HTMLElementOrInt = Variant<Ref<HTMLElement>, int>;
    WEBCORE_EXPORT ExceptionOr<void> add(const OptionOrOptGroupElement&, const std::optional<HTMLElementOrInt>& before);
    WEBCORE_EXPORT void remove(int index);

    WEBCORE_EXPORT int selectedIndex() const;
    WEBCORE_EXPORT void setSelectedIndex(int);

    WEBCORE_EXPORT ExceptionOr<void> setLength(unsigned);

    // For CachedHTMLCollection.
    inline bool elementMatches(Element&) const;

private:
    explicit HTMLOptionsCollection(HTMLSelectElement&);
};

} // namespace WebCore

SPECIALIZE_TYPE_TRAITS_HTMLCOLLECTION(HTMLOptionsCollection)

#include "HTMLOptionsCollectionInlines.h"
