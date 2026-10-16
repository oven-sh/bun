/*
 * Copyright (C) 2021 Apple Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 * 1.  Redistributions of source code must retain the above copyright
 *     notice, this list of conditions and the following disclaimer.
 * 2.  Redistributions in binary form must reproduce the above copyright
 *     notice, this list of conditions and the following disclaimer in the
 *     documentation and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY APPLE INC. AND ITS CONTRIBUTORS ``AS IS'' AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL APPLE INC. OR ITS CONTRIBUTORS BE LIABLE FOR ANY
 * DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
 * LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON
 * ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
 * SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

#include "config.h"
#include "HasSelectorFilter.h"

#include "ElementChildIteratorInlines.h"
#include "SelectorFilter.h"
#include "TypedElementDescendantIteratorInlines.h"
#include <wtf/TZoneMallocInlines.h>

namespace WebCore::Style {

WTF_MAKE_TZONE_ALLOCATED_IMPL(HasSelectorFilter);

// FIXME: Support additional pseudo-classes.
static constexpr unsigned HoverSalt = 101;

HasSelectorFilter::HasSelectorFilter(const Element& element, Type type)
    : m_type(type)
{
    switch (type) {
    case Type::Descendants:
        for (Ref descendant : descendantsOfType<Element>(element))
            add(descendant);
        break;
    case Type::Children:
        for (Ref child : childrenOfType<Element>(element))
            add(child);
        break;
    }
}

auto HasSelectorFilter::makeKey(const CSSSelector& hasSelector) -> Key
{
    SelectorFilter::CollectedSelectorHashes hashes;
    bool hasHoverInCompound = false;
    for (auto* simpleSelector = &hasSelector; simpleSelector; simpleSelector = simpleSelector->followingInCompound()) {
        if (simpleSelector->match() == CSSSelector::Match::PseudoClass && simpleSelector->pseudoClass() == CSSSelector::PseudoClass::Hover)
            hasHoverInCompound = true;
        SelectorFilter::collectSimpleSelectorHash(hashes, *simpleSelector);
        if (!hashes.ids.isEmpty())
            break;
    }

    auto pickKey = [&](auto& hashVector) -> Key {
        if (hashVector.isEmpty())
            return 0;
        if (hasHoverInCompound)
            return hashVector[0] * HoverSalt;
        return hashVector[0];
    };

    if (auto key = pickKey(hashes.ids))
        return key;
    if (auto key = pickKey(hashes.classes))
        return key;
    if (auto key = pickKey(hashes.attributes))
        return key;
    return pickKey(hashes.tags);
}

void HasSelectorFilter::add(const Element& element)
{
    Vector<unsigned, 4> elementHashes;
    SelectorFilter::collectElementIdentifierHashes(element, elementHashes);

    for (auto hash : elementHashes)
        m_filter.add(hash);

    if (element.hovered()) {
        for (auto hash : elementHashes)
            m_filter.add(hash * HoverSalt);
    }
}

}
