/*
 * Copyright (C) 2006, 2011, 2012 Apple Inc. All rights reserved.
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
#include "HTMLOptionsCollection.h"

#include "CachedHTMLCollectionInlines.h"
#include "HTMLOptionsCollectionInlines.h"
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(HTMLOptionsCollection);

HTMLOptionsCollection::HTMLOptionsCollection(HTMLSelectElement& select)
    : CachedHTMLCollection(select, CollectionType::SelectOptions)
{
}

Ref<HTMLOptionsCollection> HTMLOptionsCollection::create(HTMLSelectElement& select, CollectionType)
{
    return adoptRef(*new HTMLOptionsCollection(select));
}

ExceptionOr<void> HTMLOptionsCollection::add(const OptionOrOptGroupElement& element, const std::optional<HTMLElementOrInt>& before)
{
    return protect(selectElement())->add(element, before);
}

void HTMLOptionsCollection::remove(int index)
{
    protect(selectElement())->remove(index);
}

int HTMLOptionsCollection::selectedIndex() const
{
    return protect(selectElement())->selectedIndex();
}

void HTMLOptionsCollection::setSelectedIndex(int index)
{
    protect(selectElement())->setSelectedIndex(index);
}

unsigned HTMLOptionsCollection::length() const
{
    return Base::length();
}

ExceptionOr<void> HTMLOptionsCollection::setLength(unsigned length)
{
    return protect(selectElement())->setLength(length);
}

HTMLOptionElement* HTMLOptionsCollection::item(unsigned offset) const
{
    return downcast<HTMLOptionElement>(Base::item(offset));
}

HTMLOptionElement* HTMLOptionsCollection::namedItem(const AtomString& name) const
{
    return downcast<HTMLOptionElement>(Base::namedItem(name));
}

ExceptionOr<void> HTMLOptionsCollection::setItem(unsigned index, HTMLOptionElement* optionElement)
{
    return protect(selectElement())->setItem(index, optionElement);
}

} //namespace
