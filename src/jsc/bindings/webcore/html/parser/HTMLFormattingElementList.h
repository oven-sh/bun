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

#pragma once

#include "HTMLStackItem.h"
#include <wtf/Forward.h>
#include <wtf/RefPtr.h>
#include <wtf/Vector.h>

namespace WebCore {

class Element;

// This may end up merged into HTMLElementStack.
class HTMLFormattingElementList {
    WTF_MAKE_NONCOPYABLE(HTMLFormattingElementList);
public:
    HTMLFormattingElementList();
    ~HTMLFormattingElementList();

    // Ideally Entry would be private, but HTMLTreeBuilder has to coordinate
    // between the HTMLFormattingElementList and HTMLElementStack and needs
    // access to Entry::isMarker() and Entry::replaceElement() to do so.
    class Entry {
    public:
        // Inline because they're hot and Vector<T> uses them.
        explicit Entry(HTMLStackItem&& item)
            : m_item(WTF::move(item))
        {
        }
        enum MarkerEntryType { MarkerEntry };
        Entry(MarkerEntryType)
        {
        }

        bool isMarker() const { return m_item.isNull(); }

        const HTMLStackItem& stackItem() const LIFETIME_BOUND { return m_item; }
        Element& element() const
        {
            // Callers should check isMarker() before calling element().
            return m_item.element();
        }
        void replaceElement(HTMLStackItem&& item) { m_item = WTF::move(item); }

        // Needed for use with Vector. This is super-hot and must be inline.
        bool operator==(Element* element) const { return m_item.elementOrNull() == element; }

    private:
        HTMLStackItem m_item;
    };

    class Bookmark {
    public:
        explicit Bookmark(Entry& entry)
            : m_hasBeenMoved(false)
            , m_mark(&entry)
        {
        }

        void moveToAfter(Entry& before)
        {
            m_hasBeenMoved = true;
            m_mark = &before;
        }

        bool hasBeenMoved() const { return m_hasBeenMoved; }
        Entry& mark() const { ASSERT(m_mark); return *m_mark; }

    private:
        friend class HTMLFormattingElementList;
        bool m_hasBeenMoved;
        Entry* m_mark;
    };

    bool isEmpty() const { return !size(); }
    size_t size() const { return m_entries.size(); }

    Element* LEGACY_NODELETE closestElementInScopeWithName(ElementName);

    Entry* find(Element&) LIFETIME_BOUND;
    bool contains(Element&);
    void append(HTMLStackItem&&);
    void remove(Element&);
    void removeUpdatingBookmark(Element&, Bookmark&);

    Bookmark bookmarkFor(Element&);
    void swapTo(Ref<Element> oldElement, HTMLStackItem&& newItem, const Bookmark&);

    void appendMarker();
    // clearToLastMarker also clears the marker (per the HTML5 spec).
    void clearToLastMarker();

    const Entry& at(size_t i) const LIFETIME_BOUND { return m_entries[i]; }
    Entry& at(size_t i) LIFETIME_BOUND { return m_entries[i]; }

#if ENABLE(TREE_DEBUGGING)
    void show();
#endif

private:
    Entry& first() LIFETIME_BOUND { return at(0); }

    // http://www.whatwg.org/specs/web-apps/current-work/multipage/parsing.html#list-of-active-formatting-elements
    // These functions enforce the "Noah's Ark" condition, which removes redundant mis-nested elements.
    Vector<const HTMLStackItem*> tryToEnsureNoahsArkConditionQuickly(HTMLStackItem&);
    void ensureNoahsArkCondition(HTMLStackItem&);

    Vector<Entry> m_entries;
};

} // namespace WebCore
