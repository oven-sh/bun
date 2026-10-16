/*
 * Copyright (C) 2009, 2011, 2012 Apple Inc. All rights reserved.
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
 * THIS SOFTWARE IS PROVIDED BY APPLE INC. ``AS IS'' AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL APPLE INC. OR
 * CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
 * EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
 * PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
 * PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY
 * OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE. 
 */

#include "config.h"
#include "HTMLAllCollection.h"

#include "CachedHTMLCollectionInlines.h"
#include "Element.h"
#include "NodeRareDataInlines.h"
#include <JavaScriptCore/Identifier.h>
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(HTMLAllNamedSubCollection);

Ref<HTMLAllCollection> HTMLAllCollection::create(Document& document, CollectionType type)
{
    return adoptRef(*new HTMLAllCollection(document, type));
}

inline HTMLAllCollection::HTMLAllCollection(Document& document, CollectionType type)
    : AllDescendantsCollection(document, type)
{
}

// https://html.spec.whatwg.org/multipage/infrastructure.html#dom-htmlallcollection-item
std::optional<Variant<Ref<HTMLCollection>, Ref<Element>>> HTMLAllCollection::namedOrIndexedItemOrItems(const AtomString& nameOrIndex) const
{
    if (nameOrIndex.isNull())
        return std::nullopt;

    if (auto index = JSC::parseIndex(*nameOrIndex.impl())) {
        if (RefPtr element = item(index.value()))
            return Variant<Ref<HTMLCollection>, Ref<Element>> { element.releaseNonNull() };
        return std::nullopt;
    }

    return namedItemOrItems(nameOrIndex);
}

// https://html.spec.whatwg.org/multipage/infrastructure.html#concept-get-all-named
std::optional<Variant<Ref<HTMLCollection>, Ref<Element>>> HTMLAllCollection::namedItemOrItems(const AtomString& name) const
{
    auto namedItems = this->namedItems(name);

    if (namedItems.isEmpty())
        return std::nullopt;
    if (namedItems.size() == 1)
        return Variant<Ref<HTMLCollection>, Ref<Element>> { Ref<Element> { WTF::move(namedItems[0]) } };

    return Variant<Ref<HTMLCollection>, Ref<Element>> { Ref<HTMLCollection> { downcast<Document>(ownerNode()).allFilteredByName(name) } };
}

HTMLAllNamedSubCollection::HTMLAllNamedSubCollection(Document& document, CollectionType type, const AtomString& name)
    : CachedHTMLCollection(document, type)
    , m_name(name)
{
    ASSERT(type == CollectionType::DocumentAllNamedItems);
}

HTMLAllNamedSubCollection::~HTMLAllNamedSubCollection()
{
    ownerNode().nodeLists()->removeCachedCollection(this, m_name);
}

bool HTMLAllNamedSubCollection::elementMatches(Element& element) const
{
    const auto& id = element.getIdAttribute();
    if (id == m_name)
        return true;

    if (!nameShouldBeVisibleInDocumentAll(element))
        return false;

    const auto& name = element.getNameAttribute();
    if (name == m_name)
        return true;

    return false;
}

} // namespace WebCore
