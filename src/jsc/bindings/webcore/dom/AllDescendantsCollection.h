/*
 * Copyright (C) 2016 Apple Inc. All rights reserved.
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

class AllDescendantsCollection;

template<>
struct CollectionClassTraits<AllDescendantsCollection> {
    static constexpr CollectionType collectionType = CollectionType::AllDescendants;
};

} // namespace WebCore

#include "CachedHTMLCollection.h"

namespace WebCore {

class AllDescendantsCollection : public CachedHTMLCollection<AllDescendantsCollection> {
    WTF_MAKE_TZONE_ALLOCATED(AllDescendantsCollection);
public:
    static Ref<AllDescendantsCollection> create(ContainerNode& rootNode, CollectionType type)
    {
        ASSERT_UNUSED(type, type == CollectionType::AllDescendants);
        return adoptRef(*new AllDescendantsCollection(rootNode, type));
    }

    bool elementMatches(Element&) const { return true; }

protected:
    AllDescendantsCollection(ContainerNode&, CollectionType);
};

} // namespace WebCore

SPECIALIZE_TYPE_TRAITS_BEGIN(WebCore::AllDescendantsCollection)
    static bool isType(const WebCore::HTMLCollection& collection) { return collection.type() == WebCore::CollectionType::AllDescendants || collection.type() == WebCore::CollectionType::DocAll; }
SPECIALIZE_TYPE_TRAITS_END()
