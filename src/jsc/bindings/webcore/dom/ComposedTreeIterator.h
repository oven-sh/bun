/*
 * Copyright (C) 2015-2016 Apple Inc. All rights reserved.
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

#include "ElementAndTextDescendantIterator.h"
#include "HTMLSlotElement.h"
#include "ShadowRoot.h"
#include "SlotAssignment.h"

namespace WebCore {

static constexpr size_t defaultInlineCapacity = 8;

template <size_t ContextInlineCapacity = defaultInlineCapacity>
class ComposedTreeIterator {
public:
    ComposedTreeIterator();
    enum FirstChildTag { FirstChild };
    ComposedTreeIterator(ContainerNode& root, FirstChildTag);
    ComposedTreeIterator(ContainerNode& root, Node& current);

    Node& operator*() { return current(); }
    Node* operator->() { return &current(); }

    bool operator==(const ComposedTreeIterator& other) const { return context().iterator == other.context().iterator; }

    ComposedTreeIterator& operator++() { return traverseNext(); }

    ComposedTreeIterator& traverseNext();
    ComposedTreeIterator& traverseNextSkippingChildren();
    ComposedTreeIterator& traverseNextSibling();
    ComposedTreeIterator& traversePreviousSibling();

    unsigned depth() const;

    void dropAssertions();

private:
    void initializeContextStack(ContainerNode& root, Node& current);
    void traverseNextInShadowTree();
    void traverseNextLeavingContext();
    void traverseShadowRoot(ShadowRoot&);
    bool advanceInSlot(int direction, const HTMLSlotElement&);
    void traverseSiblingInSlot(int direction);

    struct Context {
        Context();
        Context(ContainerNode& root, FirstChildTag);
        Context(ContainerNode& root, Node& node);

        enum SlottedTag { Slotted };
        Context(ContainerNode& root, Node& current, Node& slottedNode, SlottedTag);
        ElementAndTextDescendantIterator iterator;
        ElementAndTextDescendantIterator end;
        size_t slotNodeIndex { notFound };
    };
    Context& context() LIFETIME_BOUND { return m_contextStack.last(); }
    const Context& context() const LIFETIME_BOUND { return m_contextStack.last(); }
    Node& current() { return *context().iterator; }

    bool m_rootIsInShadowTree { false };
    bool m_didDropAssertions { false };
    Vector<Context, ContextInlineCapacity> m_contextStack;
};

template <size_t ContextInlineCapacity>
inline ComposedTreeIterator<ContextInlineCapacity>::ComposedTreeIterator()
    : m_contextStack({ Context { } })
{
}

template <size_t ContextInlineCapacity>
inline ComposedTreeIterator<ContextInlineCapacity>& ComposedTreeIterator<ContextInlineCapacity>::traverseNext()
{
    if (RefPtr<ShadowRoot> shadowRoot = context().iterator->shadowRoot()) {
        traverseShadowRoot(*shadowRoot);
        return *this;
    }

    if (m_contextStack.size() > 1 || m_rootIsInShadowTree) {
        traverseNextInShadowTree();
        return *this;
    }

    context().iterator.traverseNext();
    return *this;
}

template <size_t ContextInlineCapacity>
inline ComposedTreeIterator<ContextInlineCapacity>& ComposedTreeIterator<ContextInlineCapacity>::traverseNextSkippingChildren()
{
    context().iterator.traverseNextSkippingChildren();

    if (context().iterator == context().end)
        traverseNextLeavingContext();
    
    return *this;
}

template <size_t ContextInlineCapacity>
inline ComposedTreeIterator<ContextInlineCapacity>& ComposedTreeIterator<ContextInlineCapacity>::traverseNextSibling()
{
    if (current().parentNode()->shadowRoot()) {
        traverseSiblingInSlot(1);
        return *this;
    }
    context().iterator.traverseNextSibling();
    return *this;
}

template <size_t ContextInlineCapacity>
inline ComposedTreeIterator<ContextInlineCapacity>& ComposedTreeIterator<ContextInlineCapacity>::traversePreviousSibling()
{
    if (current().parentNode()->shadowRoot()) {
        traverseSiblingInSlot(-1);
        return *this;
    }
    context().iterator.traversePreviousSibling();
    return *this;
}

template <size_t ContextInlineCapacity>
inline unsigned ComposedTreeIterator<ContextInlineCapacity>::depth() const
{
    unsigned depth = 0;
    for (auto& context : m_contextStack)
        depth += context.iterator.depth();
    return depth;
}

template <size_t ContextInlineCapacity = defaultInlineCapacity>
class ComposedTreeDescendantAdapter {
public:
    ComposedTreeDescendantAdapter(ContainerNode& parent)
        : m_parent(parent)
    { }

    ComposedTreeIterator<ContextInlineCapacity> begin() { return ComposedTreeIterator<ContextInlineCapacity>(m_parent, ComposedTreeIterator<ContextInlineCapacity>::FirstChild); }
    ComposedTreeIterator<ContextInlineCapacity> end() { return { }; }
    ComposedTreeIterator<ContextInlineCapacity> at(const Node& child) { return ComposedTreeIterator(m_parent, const_cast<Node&>(child)); }

private:
    const CheckedRef<ContainerNode> m_parent;
};

template <size_t ContextInlineCapacity = defaultInlineCapacity>
class ComposedTreeChildAdapter {
public:
    class Iterator : public ComposedTreeIterator<ContextInlineCapacity> {
    public:
        Iterator() = default;
        explicit Iterator(ContainerNode& root)
            : ComposedTreeIterator<ContextInlineCapacity>(root, ComposedTreeIterator<ContextInlineCapacity>::FirstChild)
        { }
        Iterator(ContainerNode& root, Node& current)
            : ComposedTreeIterator<ContextInlineCapacity>(root, current)
        { }

        Iterator& operator++()
        {
            ComposedTreeIterator<ContextInlineCapacity>::traverseNextSibling();
            return *this;
        }
        Iterator& operator--() { return static_cast<Iterator&>(ComposedTreeIterator<ContextInlineCapacity>::traversePreviousSibling()); }
    };

    ComposedTreeChildAdapter(ContainerNode& parent)
        : m_parent(parent)
    { }

    Iterator begin() { return Iterator(m_parent); }
    Iterator end() { return { }; }
    Iterator at(const Node& child) { return Iterator(m_parent, const_cast<Node&>(child)); }

private:
    const CheckedRef<ContainerNode> m_parent;
};

// FIXME: We should have const versions too.
template <size_t ContextInlineCapacity = defaultInlineCapacity>
inline ComposedTreeDescendantAdapter<ContextInlineCapacity> composedTreeDescendants(ContainerNode& parent)
{
    return ComposedTreeDescendantAdapter<ContextInlineCapacity>(parent);
}

template <size_t ContextInlineCapacity = defaultInlineCapacity>
inline ComposedTreeChildAdapter<ContextInlineCapacity> composedTreeChildren(ContainerNode& parent)
{
    return ComposedTreeChildAdapter<ContextInlineCapacity>(parent);
}

enum class ComposedTreeAsTextMode { Normal, WithPointers };
WEBCORE_EXPORT String composedTreeAsText(ContainerNode& root, ComposedTreeAsTextMode = ComposedTreeAsTextMode::Normal);
WEBCORE_EXPORT String composedTreeAsTextFromNode(ContainerNode& root, Node& startNode);


// Helper functions for walking the composed tree.
// FIXME: Use ComposedTreeIterator instead. These functions are more expensive because they might do O(n) work.

inline RefPtr<HTMLSlotElement> assignedSlotIgnoringUserAgentShadow(Node& node)
{
    auto* slot = node.assignedSlot();
    if (!slot || slot->containingShadowRoot()->mode() == ShadowRootMode::UserAgent)
        return nullptr;
    return slot;
}

inline ShadowRoot* shadowRootIgnoringUserAgentShadow(Node& node)
{
    auto* shadowRoot = node.shadowRoot();
    if (!shadowRoot || shadowRoot->mode() == ShadowRootMode::UserAgent)
        return nullptr;
    return shadowRoot;
}

inline Node* firstChildInComposedTreeIgnoringUserAgentShadow(Node& node)
{
    if (auto* shadowRoot = shadowRootIgnoringUserAgentShadow(node))
        return shadowRoot->firstChild();
    if (auto slot = dynamicDowncast<HTMLSlotElement>(node)) {
        if (auto* assignedNodes = slot->assignedNodes())
            return assignedNodes->at(0).get();
    }
    return node.firstChild();
}

inline Node* nextSiblingInComposedTreeIgnoringUserAgentShadow(Node& node)
{
    if (RefPtr slot = assignedSlotIgnoringUserAgentShadow(node)) {
        auto* assignedNodes = slot->assignedNodes();
        ASSERT(assignedNodes);
        auto nodeIndex = assignedNodes->find(&node);
        ASSERT(nodeIndex != notFound);
        if (assignedNodes->size() > nodeIndex + 1)
            return assignedNodes->at(nodeIndex + 1).get();
        return nullptr;
    }
    return node.nextSibling();
}

inline ContainerNode* LEGACY_NODELETE parentInComposedTreeIgnoringUserAgentShadow(Node& node)
{
    if (auto* slot = node.assignedSlot()) {
        if (auto* shadowRoot = slot->containingShadowRoot(); shadowRoot && shadowRoot->mode() != ShadowRootMode::UserAgent)
            return slot;
    }
    return node.parentOrShadowHostNode();
}

inline Node* nextSkippingChildrenInComposedTreeIgnoringUserAgentShadow(Node& node)
{
    if (auto* sibling = nextSiblingInComposedTreeIgnoringUserAgentShadow(node))
        return sibling;
    for (RefPtr ancestor = parentInComposedTreeIgnoringUserAgentShadow(node); ancestor; ancestor = parentInComposedTreeIgnoringUserAgentShadow(*ancestor)) {
        if (auto* sibling = nextSiblingInComposedTreeIgnoringUserAgentShadow(*ancestor))
            return sibling;
    }
    return nullptr;
}

inline Node* nextInComposedTreeIgnoringUserAgentShadow(Node& node)
{
    if (auto* firstChild = firstChildInComposedTreeIgnoringUserAgentShadow(node))
        return firstChild;
    return nextSkippingChildrenInComposedTreeIgnoringUserAgentShadow(node);
}

template <size_t ContextInlineCapacity>
inline ComposedTreeIterator<ContextInlineCapacity>::Context::Context()
{
}

template <size_t ContextInlineCapacity>
inline ComposedTreeIterator<ContextInlineCapacity>::Context::Context(ContainerNode& root, FirstChildTag)
    : iterator(root, ElementAndTextDescendantIterator::FirstChild)
{
}

template <size_t ContextInlineCapacity>
inline ComposedTreeIterator<ContextInlineCapacity>::Context::Context(ContainerNode& root, Node& node)
    : iterator(root, &node)
{
}

template <size_t ContextInlineCapacity>
inline ComposedTreeIterator<ContextInlineCapacity>::Context::Context(ContainerNode& root, Node& current, Node& slottedNode, SlottedTag)
    : iterator(root, &current)
    , end(root, &slottedNode)
{
    end.traverseNextSkippingChildren();
}

template <size_t ContextInlineCapacity>
inline ComposedTreeIterator<ContextInlineCapacity>::ComposedTreeIterator(ContainerNode& root, FirstChildTag)
    : m_rootIsInShadowTree(root.isInShadowTree())
{
    ASSERT(!is<ShadowRoot>(root));

    if (auto* slot = dynamicDowncast<HTMLSlotElement>(root)) {
        if (auto* assignedNodes = slot->assignedNodes()) {
            initializeContextStack(root, *protect(assignedNodes->at(0)));
            return;
        }
    }
    if (RefPtr shadowRoot = root.shadowRoot()) {
        ElementAndTextDescendantIterator firstChild(*shadowRoot, ElementAndTextDescendantIterator::FirstChild);
        initializeContextStack(root, firstChild ? protect(*firstChild).get() : root);
        return;
    }

    m_contextStack.append(Context(root, FirstChild));
}

template <size_t ContextInlineCapacity>
inline ComposedTreeIterator<ContextInlineCapacity>::ComposedTreeIterator(ContainerNode& root, Node& current)
    : m_rootIsInShadowTree(root.isInShadowTree())
{
    ASSERT(!is<ShadowRoot>(root));
    ASSERT(!is<ShadowRoot>(current));

    bool mayNeedShadowStack = root.shadowRoot() || (&current != &root && current.parentNode() != &root);
    if (mayNeedShadowStack)
        initializeContextStack(root, current);
    else
        m_contextStack.append(Context(root, current));
}

template <size_t ContextInlineCapacity>
inline void ComposedTreeIterator<ContextInlineCapacity>::initializeContextStack(ContainerNode& root, Node& current)
{
    // This code sets up the iterator for arbitrary node/root pair. It is not needed in common cases
    // or completes fast because node and root are close (like in composedTreeChildren(*parent).at(node) case).
    RefPtr node = &current;
    RefPtr contextCurrent = node;
    size_t currentSlotNodeIndex = notFound;
    while (node != &root) {
        RefPtr parent = node->parentNode();
        if (!parent) {
            *this = { };
            return;
        }
        if (RefPtr shadowRoot = dynamicDowncast<ShadowRoot>(*parent)) {
            m_contextStack.append(Context(*shadowRoot, *contextCurrent));
            m_contextStack.last().slotNodeIndex = currentSlotNodeIndex;

            node = shadowRoot->host();
            contextCurrent = node;
            currentSlotNodeIndex = notFound;
            continue;
        }
        if (RefPtr shadowRoot = parent->shadowRoot()) {
            m_contextStack.append(Context(*parent, *contextCurrent, *node, Context::Slotted));
            m_contextStack.last().slotNodeIndex = currentSlotNodeIndex;

            RefPtr assignedSlot = shadowRoot->findAssignedSlot(*node);
            if (assignedSlot) {
                currentSlotNodeIndex = assignedSlot->assignedNodes()->find(node.get());
                ASSERT(currentSlotNodeIndex != notFound);
                node = assignedSlot;
                contextCurrent = assignedSlot;
                continue;
            }
            // The node is not part of the composed tree.
            *this = { };
            return;
        }
        node = parent;
    }
    m_contextStack.append(Context(root, *contextCurrent));
    m_contextStack.last().slotNodeIndex = currentSlotNodeIndex;

    m_contextStack.reverse();
}

template <size_t ContextInlineCapacity>
inline void ComposedTreeIterator<ContextInlineCapacity>::dropAssertions()
{
    for (auto& context : m_contextStack)
        context.iterator.dropAssertions();
    m_didDropAssertions = true;
}

template <size_t ContextInlineCapacity>
inline void ComposedTreeIterator<ContextInlineCapacity>::traverseShadowRoot(ShadowRoot& shadowRoot)
{
    Context shadowContext(shadowRoot, FirstChild);
    if (!shadowContext.iterator) {
        // Empty shadow root.
        traverseNextSkippingChildren();
        return;
    }

    if (m_didDropAssertions)
        shadowContext.iterator.dropAssertions();

    m_contextStack.append(WTF::move(shadowContext));
}

template <size_t ContextInlineCapacity>
inline void ComposedTreeIterator<ContextInlineCapacity>::traverseNextInShadowTree()
{
    ASSERT(m_contextStack.size() > 1 || m_rootIsInShadowTree);

    if (RefPtr slot = dynamicDowncast<HTMLSlotElement>(current())) {
        if (auto* assignedNodes = slot->assignedNodes()) {
            context().slotNodeIndex = 0;
            RefPtr assignedNode = assignedNodes->at(0).get();
            ASSERT(assignedNode);
            ASSERT(is<Element>(assignedNode->parentNode()));
            m_contextStack.append(Context(*dynamicDowncast<Element>(assignedNode->parentNode()), *assignedNode, *assignedNode, Context::Slotted));
            return;
        }
    }

    context().iterator.traverseNext();

    if (context().iterator == context().end)
        traverseNextLeavingContext();
}

template <size_t ContextInlineCapacity>
inline void ComposedTreeIterator<ContextInlineCapacity>::traverseNextLeavingContext()
{
    while (context().iterator == context().end && m_contextStack.size() > 1) {
        m_contextStack.removeLast();
        if (RefPtr<HTMLSlotElement> slot = dynamicDowncast<HTMLSlotElement>(current()); slot && advanceInSlot(1, *slot))
            return;
        if (context().iterator == context().end)
            return;
        context().iterator.traverseNextSkippingChildren();
    }
}

template <size_t ContextInlineCapacity>
inline bool ComposedTreeIterator<ContextInlineCapacity>::advanceInSlot(int direction, const HTMLSlotElement& slot)
{
    ASSERT(context().slotNodeIndex != notFound);

    auto& assignedNodes = *slot.assignedNodes();
    // It is fine to underflow this.
    context().slotNodeIndex += direction;
    if (context().slotNodeIndex >= assignedNodes.size())
        return false;

    RefPtr slotNode = assignedNodes.at(context().slotNodeIndex).get();
    ASSERT(slotNode);
    ASSERT(is<Element>(slotNode->parentNode()));
    m_contextStack.append(Context(*dynamicDowncast<Element>(slotNode->parentNode()), *slotNode, *slotNode, Context::Slotted));
    return true;
}

template <size_t ContextInlineCapacity>
inline void ComposedTreeIterator<ContextInlineCapacity>::traverseSiblingInSlot(int direction)
{
    ASSERT(m_contextStack.size() > 1);
    ASSERT(current().parentNode()->shadowRoot());

    m_contextStack.removeLast();

    Ref<HTMLSlotElement> slot = downcast<HTMLSlotElement>(current());
    if (!advanceInSlot(direction, slot))
        *this = { };
}

} // namespace WebCore
