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

#pragma once

#include "Element.h"
#include "ElementIteratorAssertions.h"
#include "NodeInlines.h"
#include "Text.h"
#include <wtf/Vector.h>

namespace WebCore {

class ElementAndTextDescendantIterator {
public:
    ElementAndTextDescendantIterator() = default;
    enum FirstChildTag { FirstChild };
    ElementAndTextDescendantIterator(const ContainerNode& root, FirstChildTag);
    ElementAndTextDescendantIterator(const ContainerNode& root, Node* current);

    ElementAndTextDescendantIterator& operator++() { return traverseNext(); }

    Node& operator*();
    Node* operator->();
    const Node& operator*() const;
    const Node* operator->() const;

    bool operator==(const ElementAndTextDescendantIterator& other) const;

    bool operator!() const { return !m_depth; }
    explicit operator bool() const { return m_depth; }

    void dropAssertions();

    ElementAndTextDescendantIterator& traverseNext();
    ElementAndTextDescendantIterator& traverseNextSkippingChildren();
    ElementAndTextDescendantIterator& traverseNextSibling();
    ElementAndTextDescendantIterator& traversePreviousSibling();

    unsigned depth() const { return m_depth; }

private:
    static bool isElementOrText(const Node& node) { return isAnyOf<Element, Text>(node); }
    static Node* firstChild(const Node&);
    static Node* nextSibling(const Node&);
    static Node* previousSibling(const Node&);

    void popAncestorSiblingStack();

    CheckedPtr<Node> m_current;
    struct AncestorSibling {
        CheckedPtr<Node> node;
        unsigned depth;
    };
    Vector<AncestorSibling, 16> m_ancestorSiblingStack;
    unsigned m_depth { 0 };

#if ASSERT_ENABLED
    ElementIteratorAssertions m_assertions;
#endif
};

class ElementAndTextDescendantRange {
public:
    explicit ElementAndTextDescendantRange(const ContainerNode& root);
    ElementAndTextDescendantIterator begin() const;
    ElementAndTextDescendantIterator end() const;

private:
    CheckedRef<const ContainerNode> m_root;
};

ElementAndTextDescendantRange elementAndTextDescendants(ContainerNode&);

// ElementAndTextDescendantIterator

inline ElementAndTextDescendantIterator::ElementAndTextDescendantIterator(const ContainerNode& root, FirstChildTag)
    : m_current(firstChild(root))
#if ASSERT_ENABLED
    , m_assertions(m_current.get())
#endif
{
    if (!m_current)
        return;
    m_ancestorSiblingStack.append({ nullptr, 0 });
    m_depth = 1;
}

inline ElementAndTextDescendantIterator::ElementAndTextDescendantIterator(const ContainerNode& root, Node* current)
    : m_current(current)
#if ASSERT_ENABLED
    , m_assertions(m_current.get())
#endif
{
    if (!m_current)
        return;
    ASSERT(isElementOrText(*m_current));
    if (m_current == &root)
        return;

    Vector<Node*, 20> ancestorStack;
    RefPtr ancestor = m_current->parentNode();
    while (ancestor != &root) {
        ancestorStack.append(ancestor.get());
        ancestor = ancestor->parentNode();
    }

    m_ancestorSiblingStack.append({ nullptr, 0 });
    for (unsigned i = ancestorStack.size(); i; --i) {
        if (RefPtr sibling = nextSibling(*ancestorStack[i - 1]))
            m_ancestorSiblingStack.append({ sibling.get(), i });
    }

    m_depth = ancestorStack.size() + 1;
}

inline void ElementAndTextDescendantIterator::dropAssertions()
{
#if ASSERT_ENABLED
    m_assertions.clear();
#endif
}

inline Node* ElementAndTextDescendantIterator::firstChild(const Node& current)
{
    auto* node = current.firstChild();
    while (node && !isElementOrText(*node))
        node = node->nextSibling();
    return node;
}

inline Node* ElementAndTextDescendantIterator::nextSibling(const Node& current)
{
    auto* node = current.nextSibling();
    while (node && !isElementOrText(*node))
        node = node->nextSibling();
    return node;
}

inline Node* ElementAndTextDescendantIterator::previousSibling(const Node& current)
{
    auto* node = current.previousSibling();
    while (node && !isElementOrText(*node))
        node = node->previousSibling();
    return node;
}

inline void ElementAndTextDescendantIterator::popAncestorSiblingStack()
{
    m_current = m_ancestorSiblingStack.last().node;
    m_depth = m_ancestorSiblingStack.last().depth;
    m_ancestorSiblingStack.removeLast();

#if ASSERT_ENABLED
    // Drop the assertion when the iterator reaches the end.
    if (!m_current)
        m_assertions.dropEventDispatchAssertion();
#endif
}

inline ElementAndTextDescendantIterator& ElementAndTextDescendantIterator::traverseNext()
{
    ASSERT(m_current);
    ASSERT(!m_assertions.domTreeHasMutated());

    RefPtr firstChild = ElementAndTextDescendantIterator::firstChild(*m_current);
    RefPtr nextSibling = ElementAndTextDescendantIterator::nextSibling(*m_current);
    if (firstChild) {
        if (nextSibling)
            m_ancestorSiblingStack.append({ nextSibling.get(), m_depth });
        ++m_depth;
        m_current = firstChild.get();
        return *this;
    }
    if (!nextSibling) {
        popAncestorSiblingStack();
        return *this;
    }

    m_current = nextSibling.get();
    return *this;
}

inline ElementAndTextDescendantIterator& ElementAndTextDescendantIterator::traverseNextSkippingChildren()
{
    ASSERT(m_current);
    ASSERT(!m_assertions.domTreeHasMutated());

    auto* nextSibling = ElementAndTextDescendantIterator::nextSibling(*m_current);
    if (!nextSibling) {
        popAncestorSiblingStack();
        return *this;
    }

    m_current = nextSibling;
    return *this;
}

inline ElementAndTextDescendantIterator& ElementAndTextDescendantIterator::traverseNextSibling()
{
    ASSERT(m_current);
    ASSERT(!m_assertions.domTreeHasMutated());

    m_current = nextSibling(*m_current);

#if ASSERT_ENABLED
    if (!m_current)
        m_assertions.dropEventDispatchAssertion();
#endif
    return *this;
}

inline ElementAndTextDescendantIterator& ElementAndTextDescendantIterator::traversePreviousSibling()
{
    ASSERT(m_current);
    ASSERT(!m_assertions.domTreeHasMutated());

    m_current = previousSibling(*m_current);

#if ASSERT_ENABLED
    if (!m_current)
        m_assertions.dropEventDispatchAssertion();
#endif
    return *this;
}

inline Node& ElementAndTextDescendantIterator::operator*()
{
    ASSERT(m_current);
    ASSERT(isElementOrText(*m_current));
    ASSERT(!m_assertions.domTreeHasMutated());
    return *m_current;
}

inline Node* ElementAndTextDescendantIterator::operator->()
{
    ASSERT(m_current);
    ASSERT(isElementOrText(*m_current));
    ASSERT(!m_assertions.domTreeHasMutated());
    return m_current.get();
}

inline const Node& ElementAndTextDescendantIterator::operator*() const
{
    ASSERT(m_current);
    ASSERT(isElementOrText(*m_current));
    ASSERT(!m_assertions.domTreeHasMutated());
    return *m_current;
}

inline const Node* ElementAndTextDescendantIterator::operator->() const
{
    ASSERT(m_current);
    ASSERT(isElementOrText(*m_current));
    ASSERT(!m_assertions.domTreeHasMutated());
    return m_current.get();
}

inline bool ElementAndTextDescendantIterator::operator==(const ElementAndTextDescendantIterator& other) const
{
    ASSERT(!m_assertions.domTreeHasMutated());
    return m_current == other.m_current || (!m_depth && !other.m_depth);
}

// ElementAndTextDescendantRange

inline ElementAndTextDescendantRange::ElementAndTextDescendantRange(const ContainerNode& root)
    : m_root(root)
{
}

inline ElementAndTextDescendantIterator ElementAndTextDescendantRange::begin() const
{
    return ElementAndTextDescendantIterator(m_root.get(), ElementAndTextDescendantIterator::FirstChild);
}

inline ElementAndTextDescendantIterator ElementAndTextDescendantRange::end() const
{
    return { };
}

// Standalone functions

inline ElementAndTextDescendantRange elementAndTextDescendants(ContainerNode& root)
{
    return ElementAndTextDescendantRange(root);
}

} // namespace WebCore
