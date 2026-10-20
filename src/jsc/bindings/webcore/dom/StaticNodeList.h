/*
 * Copyright (C) 2007-2025 Apple Inc. All rights reserved.
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

#include "Element.h"
#include "NodeList.h"
#include <wtf/Vector.h>

namespace WebCore {

class StaticNodeList final : public NodeList {
    WTF_MAKE_TZONE_ALLOCATED_EXPORT(StaticNodeList, WEBCORE_EXPORT);
public:
    WEBCORE_EXPORT virtual ~StaticNodeList() = default;

    static Ref<StaticNodeList> create(Vector<Ref<Node>>&& nodes = { })
    {
        return adoptRef(*new StaticNodeList(WTF::move(nodes)));
    }

    WEBCORE_EXPORT unsigned length() const override;
    WEBCORE_EXPORT Node* item(unsigned index) const override;
    size_t memoryCost() const override { return m_nodes.capacity() * sizeof(Ref<Node>); }

private:
    WEBCORE_EXPORT StaticNodeList(Vector<Ref<Node>>&& nodes);
    Vector<Ref<Node>> m_nodes;
};

class StaticWrapperNodeList final : public NodeList {
    WTF_MAKE_TZONE_ALLOCATED(StaticWrapperNodeList);
public:
    static Ref<StaticWrapperNodeList> create(NodeList& nodeList)
    {
        return adoptRef(*new StaticWrapperNodeList(nodeList));
    }

    unsigned length() const override;
    Node* item(unsigned index) const override;
    size_t memoryCost() const override { return m_nodeList->memoryCost(); }

private:
    StaticWrapperNodeList(NodeList& nodeList)
        : m_nodeList(nodeList)
    { }

    const Ref<NodeList> m_nodeList;
};

class StaticElementList final : public NodeList {
    WTF_MAKE_TZONE_ALLOCATED(StaticElementList);
public:
    static Ref<StaticElementList> create(Vector<Ref<Element>>&& elements = { })
    {
        return adoptRef(*new StaticElementList(WTF::move(elements)));
    }

    unsigned length() const override;
    Element* item(unsigned index) const override;
    size_t memoryCost() const override { return m_elements.capacity() * sizeof(Ref<Element>); }

private:
    StaticElementList(Vector<Ref<Element>>&& elements)
        : m_elements(WTF::move(elements))
    { }

    const Vector<Ref<Element>> m_elements;
};

} // namespace WebCore
