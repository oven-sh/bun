/*
 * Copyright (C) 2010 Google, Inc. All rights reserved.
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
 * THIS SOFTWARE IS PROVIDED BY GOOGLE INC. ``AS IS'' AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL GOOGLE INC. OR
 * CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
 * EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
 * PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
 * PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY
 * OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE. 
 */

#include "config.h"
#include "HTMLFormattingElementList.h"

#ifndef NDEBUG
#include <stdio.h>
#endif

namespace WebCore {

// Biblically, Noah's Ark only had room for two of each animal, but in the
// Book of Hixie (aka http://www.whatwg.org/specs/web-apps/current-work/multipage/parsing.html#list-of-active-formatting-elements),
// Noah's Ark of Formatting Elements can fit three of each element.
static const size_t kNoahsArkCapacity = 3;

HTMLFormattingElementList::HTMLFormattingElementList() = default;

HTMLFormattingElementList::~HTMLFormattingElementList() = default;

Element* HTMLFormattingElementList::closestElementInScopeWithName(ElementName targetElement)
{
    for (unsigned i = 1; i <= m_entries.size(); ++i) {
        const Entry& entry = m_entries[m_entries.size() - i];
        if (entry.isMarker())
            return nullptr;
        if (entry.stackItem().elementName() == targetElement)
            return &entry.element();
    }
    return nullptr;
}

bool HTMLFormattingElementList::contains(Element& element)
{
    return !!find(element);
}

auto HTMLFormattingElementList::find(Element& element) -> Entry*
{
    size_t index = m_entries.reverseFind(&element);
    if (index != notFound) {
        // This is somewhat of a hack, and is why this method can't be const.
        return &m_entries[index];
    }
    return nullptr;
}

auto HTMLFormattingElementList::bookmarkFor(Element& element) -> Bookmark
{
    size_t index = m_entries.reverseFind(&element);
    ASSERT(index != notFound);
    return Bookmark(at(index));
}

void HTMLFormattingElementList::swapTo(Ref<Element> oldElement, HTMLStackItem&& newItem, const Bookmark& bookmark)
{
    ASSERT(contains(oldElement));
    ASSERT(!contains(newItem.element()));
    if (!bookmark.hasBeenMoved()) {
        ASSERT(&bookmark.mark().element() == oldElement.ptr());
        bookmark.mark().replaceElement(WTF::move(newItem));
        return;
    }
    size_t index = &bookmark.mark() - &first();
    ASSERT_WITH_SECURITY_IMPLICATION(index <= size());
    m_entries.insert(index, WTF::move(newItem));
    remove(oldElement);
}

void HTMLFormattingElementList::append(HTMLStackItem&& item)
{
    ensureNoahsArkCondition(item);
    m_entries.append(WTF::move(item));
}

void HTMLFormattingElementList::remove(Element& element)
{
    size_t index = m_entries.reverseFind(&element);
    if (index != notFound)
        m_entries.removeAt(index);
}

void HTMLFormattingElementList::removeUpdatingBookmark(Element& element, Bookmark& bookmark)
{
    size_t index = m_entries.reverseFind(&element);
    if (index != notFound) {
        size_t bookmarkIndex = &bookmark.mark() - &first();
        RELEASE_ASSERT_WITH_SECURITY_IMPLICATION(bookmarkIndex <= size());
        m_entries.removeAt(index);
        // Removing an element from the list can change the position of the bookmarked
        // item. Update the address pointed by the bookmark, when needed.
        if (bookmarkIndex > index) {
            auto span = m_entries.mutableSpan();
            bookmark.m_mark = span.subspan(bookmark.m_mark - span.data() - 1).data();
        }
    }
}

void HTMLFormattingElementList::appendMarker()
{
    m_entries.append(Entry::MarkerEntry);
}

void HTMLFormattingElementList::clearToLastMarker()
{
    // http://www.whatwg.org/specs/web-apps/current-work/multipage/parsing.html#clear-the-list-of-active-formatting-elements-up-to-the-last-marker
    while (m_entries.size()) {
        bool shouldStop = m_entries.last().isMarker();
        m_entries.removeLast();
        if (shouldStop)
            break;
    }
}

static bool LEGACY_NODELETE itemsHaveMatchingNames(const HTMLStackItem& a, const HTMLStackItem& b)
{
    if (a.elementName() != b.elementName())
        return false;

    if (a.elementName() != ElementName::Unknown)
        return true;

    return a.localName() == b.localName() && a.namespaceURI() == b.namespaceURI();
}

Vector<const HTMLStackItem*> HTMLFormattingElementList::tryToEnsureNoahsArkConditionQuickly(HTMLStackItem& newItem)
{
    if (m_entries.size() < kNoahsArkCapacity)
        return { };

    // Use a vector with inline capacity to avoid a malloc in the common case of quickly ensuring the condition.
    Vector<const HTMLStackItem*, 10> candidates;

    size_t newItemAttributeCount = newItem.attributes().size();

    for (size_t i = m_entries.size(); i; ) {
        --i;
        Entry& entry = m_entries[i];
        if (entry.isMarker())
            break;

        // Quickly reject obviously non-matching candidates.
        auto& candidate = entry.stackItem();
        if (!itemsHaveMatchingNames(newItem, candidate))
            continue;
        if (candidate.attributes().size() != newItemAttributeCount)
            continue;

        candidates.append(&candidate);
    }

    if (candidates.size() < kNoahsArkCapacity)
        return { }; // There's room for the new element in the ark. There's no need to copy out the remainingCandidates.

    return candidates.span();
}

void HTMLFormattingElementList::ensureNoahsArkCondition(HTMLStackItem& newItem)
{
    auto candidates = tryToEnsureNoahsArkConditionQuickly(newItem);
    if (candidates.isEmpty())
        return;

    // We pre-allocate and re-use this second vector to save one malloc per attribute that we verify.
    Vector<const HTMLStackItem*> remainingCandidates;
    remainingCandidates.reserveInitialCapacity(candidates.size());

    for (auto& attribute : newItem.attributes()) {
        for (auto* candidate : candidates) {
            // These properties should already have been checked by tryToEnsureNoahsArkConditionQuickly.
            ASSERT(newItem.attributes().size() == candidate->attributes().size());
            ASSERT(itemsHaveMatchingNames(newItem, *candidate));

            auto* candidateAttribute = candidate->findAttribute(attribute.name());
            if (candidateAttribute && candidateAttribute->value() == attribute.value())
                remainingCandidates.append(candidate);
        }

        if (remainingCandidates.size() < kNoahsArkCapacity)
            return;

        candidates.swap(remainingCandidates);
        remainingCandidates.shrink(0);
    }

    // Inductively, we shouldn't spin this loop very many times. It's possible,
    // however, that we will spin the loop more than once because of how the
    // formatting element list gets permuted.
    for (size_t i = kNoahsArkCapacity - 1; i < candidates.size(); ++i)
        remove(protect(candidates[i]->element()));
}

#if ENABLE(TREE_DEBUGGING)

void HTMLFormattingElementList::show()
{
    for (unsigned i = 1; i <= m_entries.size(); ++i) {
        const Entry& entry = m_entries[m_entries.size() - i];
        if (entry.isMarker())
            fprintf(stderr, "marker\n");
        else
            entry.element().showNode();
    }
}

#endif

}
