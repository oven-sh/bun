/*
 * Copyright (C) 2007, 2014, 2015 Apple Inc. All rights reserved.
 * Copyright (C) 2007 David Smith (catfish.man@gmail.com)
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 *
 * 1.  Redistributions of source code must retain the above copyright
 *     notice, this list of conditions and the following disclaimer.
 * 2.  Redistributions in binary form must reproduce the above copyright
 *     notice, this list of conditions and the following disclaimer in the
 *     documentation and/or other materials provided with the distribution.
 * 3.  Neither the name of Apple Inc. ("Apple") nor the names of
 *     its contributors may be used to endorse or promote products derived
 *     from this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY APPLE AND ITS CONTRIBUTORS "AS IS" AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL APPLE OR ITS CONTRIBUTORS BE LIABLE FOR ANY
 * DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
 * LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
 * ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
 * THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

#pragma once

#include "CollectionType.h"

namespace WebCore {

class ClassCollection;

template<>
struct CollectionClassTraits<ClassCollection> {
    static constexpr CollectionType collectionType = CollectionType::ByClass;
};

} // namespace WebCore

#include "CachedHTMLCollection.h"
#include "Document.h"
#include "ElementInlines.h"
#include "SpaceSplitString.h"

namespace WebCore {

class ClassCollection final : public CachedHTMLCollection<ClassCollection> {
    WTF_MAKE_TZONE_ALLOCATED(ClassCollection);
public:
    static Ref<ClassCollection> create(ContainerNode&, CollectionType, const AtomString& classNames);

    virtual ~ClassCollection();

    bool elementMatches(Element&) const;

private:
    ClassCollection(ContainerNode& rootNode, CollectionType, const AtomString& classNames);

    SpaceSplitString m_classNames;
    AtomString m_originalClassNames;
};

inline ClassCollection::ClassCollection(ContainerNode& rootNode, CollectionType type, const AtomString& classNames)
    : CachedHTMLCollection(rootNode, type)
    , m_classNames(classNames, rootNode.document().inQuirksMode() ? SpaceSplitString::ShouldFoldCase::Yes : SpaceSplitString::ShouldFoldCase::No)
    , m_originalClassNames(classNames)
{
}

inline bool ClassCollection::elementMatches(Element& element) const
{
    if (!element.hasClass())
        return false;
    if (m_classNames.isEmpty())
        return false;
    return element.classNames().containsAll(m_classNames);
}

} // namespace WebCore

SPECIALIZE_TYPE_TRAITS_HTMLCOLLECTION(ClassCollection)
