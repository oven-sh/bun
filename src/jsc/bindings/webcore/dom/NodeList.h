/*
 * Copyright (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 *           (C) 2001 Dirk Mueller (mueller@kde.org)
 * Copyright (C) 2004, 2006, 2007 Apple Inc. All rights reserved.
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

#include <JavaScriptCore/EmbedderArrayLike.h>
#include "ScriptWrappable.h"
#include <wtf/TZoneMalloc.h>

namespace WebCore {

class Node;
class ScriptExecutionContext;

class NodeList : public ScriptWrappable, public JSC::EmbedderArrayLike {
    WTF_MAKE_TZONE_ALLOCATED_EXPORT(NodeList, WEBCORE_EXPORT);
public:
    virtual ~NodeList();

    // DOM methods & attributes for NodeList
    virtual unsigned length() const = 0;
    virtual Node* item(unsigned index) const = 0;
    bool isSupportedPropertyIndex(unsigned index) const { return index < length(); }

    class Iterator {
    public:
        explicit Iterator(NodeList& list) : m_list(list) { }
        Node* next() { return m_list->item(m_index++); }

    private:
        size_t m_index { 0 };
        const Ref<NodeList> m_list;
    };
    Iterator createIterator(ScriptExecutionContext*) { return Iterator(*this); }

    // Other methods (not part of DOM)
    virtual bool isLiveNodeList() const { return false; }
    virtual bool isChildNodeList() const { return false; }
    virtual bool isEmptyNodeList() const { return false; }
    virtual size_t memoryCost() const { return 0; }

    int64_t fastIndexOf(JSC::JSGlobalObject*, JSC::JSValue searchElement, uint64_t startIndex, uint64_t length) override;
};

} // namespace WebCore

SPECIALIZE_TYPE_TRAITS_BEGIN(WebCore::NodeList)
    // NodeList is the only subclass of JSC::EmbedderArrayLike.
    static bool isType(const JSC::EmbedderArrayLike&) { return true; }
SPECIALIZE_TYPE_TRAITS_END()
