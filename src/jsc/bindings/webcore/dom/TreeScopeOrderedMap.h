/*
 * Copyright (C) 2004, 2005, 2006, 2007, 2008, 2009, 2010 Apple Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are
 * met:
 *
 *     * Redistributions of source code must retain the above copyright
 * notice, this list of conditions and the following disclaimer.
 *     * Redistributions in binary form must reproduce the above
 * copyright notice, this list of conditions and the following disclaimer
 * in the documentation and/or other materials provided with the
 * distribution.
 *     * Neither the name of Google Inc. nor the names of its
 * contributors may be used to endorse or promote products derived from
 * this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 * A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
 * OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
 * LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

#pragma once

#include "Element.h"
#include <wtf/HashMap.h>
#include <wtf/HashSet.h>
#include <wtf/TZoneMalloc.h>
#include <wtf/Vector.h>
#include <wtf/WeakPtr.h>
#include <wtf/text/AtomString.h>

namespace WebCore {

class TreeScope;

class TreeScopeOrderedMap {
    WTF_MAKE_TZONE_ALLOCATED(TreeScopeOrderedMap);
public:
    void add(const AtomString&, Element&, const TreeScope&);
    void remove(const AtomString&, Element&);
    void clear();

    bool contains(const AtomString&) const;
    bool containsSingle(const AtomString&) const;
    bool containsMultiple(const AtomString&) const;

    // concrete instantiations of the get<>() method template
    RefPtr<Element> getElementById(const AtomString&, const TreeScope&) const;
    RefPtr<Element> getElementByName(const AtomString&, const TreeScope&) const;
    RefPtr<Element> getElementByWindowNamedItem(const AtomString&, const TreeScope&) const;
    RefPtr<Element> getElementByDocumentNamedItem(const AtomString&, const TreeScope&) const;

    const Vector<WeakRef<Element, WeakPtrImplWithEventTargetData>>* getAllElementsById(const AtomString&, const TreeScope&) const;

    const Vector<AtomString> keys() const;

private:
    template <typename KeyMatchingFunction>
    RefPtr<Element> get(const AtomString&, const TreeScope&, NOESCAPE const KeyMatchingFunction&) const;
    template <typename KeyMatchingFunction>
    Vector<WeakRef<Element, WeakPtrImplWithEventTargetData>>* getAll(const AtomString&, const TreeScope&, NOESCAPE const KeyMatchingFunction&) const;

    struct MapEntry {
        MapEntry() = default;
        explicit MapEntry(Element* firstElement)
            : element(firstElement)
            , count(1)
        { }

        WeakPtr<Element, WeakPtrImplWithEventTargetData> element;
        unsigned count { 0 };
        Vector<WeakRef<Element, WeakPtrImplWithEventTargetData>> orderedList;
#if ASSERT_ENABLED || ENABLE(SECURITY_ASSERTIONS)
        HashSet<WeakRef<Element, WeakPtrImplWithEventTargetData>> registeredElements;
#endif
    };

    using Map = HashMap<AtomString, MapEntry>;

    mutable Map m_map;
};

inline bool TreeScopeOrderedMap::containsSingle(const AtomString& id) const
{
    auto it = m_map.find(id);
    return it != m_map.end() && it->value.count == 1;
}

inline bool TreeScopeOrderedMap::contains(const AtomString& id) const
{
    return m_map.contains(id);
}

inline bool TreeScopeOrderedMap::containsMultiple(const AtomString& id) const
{
    auto it = m_map.find(id);
    return it != m_map.end() && it->value.count > 1;
}

} // namespace WebCore
