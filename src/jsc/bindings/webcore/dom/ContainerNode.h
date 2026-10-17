/*
 * Copyright (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 *           (C) 2001 Dirk Mueller (mueller@kde.org)
 * Copyright (C) 2004-2026 Apple Inc. All rights reserved.
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

#include "DocumentEnums.h"
#include "Node.h"

namespace WebCore {

class HTMLCollection;
class RadioNodeList;

enum class CollectionType : uint8_t;

class ContainerNode : public Node {
    WTF_MAKE_TZONE_ALLOCATED(ContainerNode);
    WTF_OVERRIDE_DELETE_FOR_CHECKED_PTR(ContainerNode);
public:
    WEBCORE_EXPORT virtual ~ContainerNode();

    Node* firstChild() const { return m_firstChild; }
    static constexpr ptrdiff_t firstChildMemoryOffset() { return OBJECT_OFFSETOF(ContainerNode, m_firstChild); }
    Node* lastChild() const { return m_lastChild; }
    static constexpr ptrdiff_t lastChildMemoryOffset() { return OBJECT_OFFSETOF(ContainerNode, m_lastChild); }
    bool hasChildNodes() const { return m_firstChild; }
    bool hasOneChild() const { return m_firstChild && m_firstChild == m_lastChild; }

    WEBCORE_EXPORT unsigned LEGACY_NODELETE countChildNodes() const;
    WEBCORE_EXPORT Node* LEGACY_NODELETE traverseToChildAt(unsigned) const;

    ExceptionOr<void> insertBefore(Node& newChild, RefPtr<Node>&& refChild);
    ExceptionOr<void> replaceChild(Node& newChild, Node& oldChild);
    WEBCORE_EXPORT ExceptionOr<void> removeChild(Node& child);
    WEBCORE_EXPORT ExceptionOr<void> appendChild(Node& newChild);
    void stringReplaceAll(String&&);
    void replaceAll(Node*);

    inline ContainerNode& rootNode() const; // Defined in ContainerNodeInlines.h
    ContainerNode& LEGACY_NODELETE traverseToRootNode() const;

    // These methods are only used during parsing.
    // They don't send DOM mutation events or handle reparenting.
    // However, arbitrary code may be run by beforeload handlers.
    void parserAppendChild(Node&);
    void parserAppendChildIntoIsolatedTree(Node&);
    void parserNotifyChildrenChanged();
    void parserRemoveChild(Node&);
    void parserInsertBefore(Node& newChild, Node& refChild);

    WEBCORE_EXPORT void removeChildren();

    void takeAllChildrenFrom(ContainerNode*);

    void cloneChildNodes(Document&, CustomElementRegistry*, ContainerNode& clone, size_t currentDepth = 0) const;
    void cloneSubtreeForFastParser(Document&, CustomElementRegistry*, ContainerNode& clone, size_t currentDepth = 0) const;

    struct ChildChange {
        enum class Type : uint8_t { ElementInserted, ElementRemoved, ElementMovedInto, ElementMovedFrom, ElementAndTextInserted, TextInserted, TextRemoved, TextChanged, TextMovedFrom, TextMovedInto, AllChildrenRemoved, NonContentsChildRemoved, NonContentsChildInserted, NonContentsChildMovedInto, NonContentsChildMovedFrom, AllChildrenReplaced };
        enum class Source : uint8_t { Parser, API, Clone };
        enum class AffectsElements : uint8_t { Unknown, No, Yes };

        ChildChange::Type type;
        const NodeVector* const insertedChildren;
        // Making these raw pointers RefPtr leads to a Speedometer 3 regression.
        SUPPRESS_UNCOUNTED_MEMBER Element* siblingChanged;
        SUPPRESS_UNCOUNTED_MEMBER Element* previousSiblingElement;
        SUPPRESS_UNCOUNTED_MEMBER Element* nextSiblingElement;
        ChildChange::Source source;
        AffectsElements affectsElements;
        IsMutationBySetInnerHTML isMutationBySetInnerHTML { IsMutationBySetInnerHTML::No };

        bool isInsertion() const
        {
            switch (type) {
            case ChildChange::Type::ElementInserted:
            case ChildChange::Type::ElementAndTextInserted:
            case ChildChange::Type::TextInserted:
            case ChildChange::Type::NonContentsChildInserted:
            case ChildChange::Type::AllChildrenReplaced:
                return true;
            case ChildChange::Type::ElementRemoved:
            case ChildChange::Type::ElementMovedFrom:
            case ChildChange::Type::ElementMovedInto:
            case ChildChange::Type::TextRemoved:
            case ChildChange::Type::TextMovedFrom:
            case ChildChange::Type::TextMovedInto:
            case ChildChange::Type::TextChanged:
            case ChildChange::Type::AllChildrenRemoved:
            case ChildChange::Type::NonContentsChildRemoved:
            case ChildChange::Type::NonContentsChildMovedFrom:
            case ChildChange::Type::NonContentsChildMovedInto:
                return false;
            }
            ASSERT_NOT_REACHED();
            return false;
        }
    };
    virtual void childrenChanged(const ChildChange&);

    ExceptionOr<void> appendChild(ChildChange::Source, Node& newChild);

    WEBCORE_EXPORT ExceptionOr<Element*> querySelector(const String& selectors);
    WEBCORE_EXPORT ExceptionOr<Ref<NodeList>> querySelectorAll(const String& selectors);

    WEBCORE_EXPORT Ref<HTMLCollection> getElementsByTagName(const AtomString&);
    WEBCORE_EXPORT Ref<HTMLCollection> getElementsByTagNameNS(const AtomString& namespaceURI, const AtomString& localName);
    WEBCORE_EXPORT Ref<HTMLCollection> getElementsByClassName(const AtomString& classNames);
    Ref<RadioNodeList> radioNodeList(const AtomString&);

    // From the ParentNode interface - https://dom.spec.whatwg.org/#interface-parentnode
    WEBCORE_EXPORT Ref<HTMLCollection> children();
    WEBCORE_EXPORT Element* LEGACY_NODELETE firstElementChild() const;
    WEBCORE_EXPORT Element* LEGACY_NODELETE lastElementChild() const;
    WEBCORE_EXPORT unsigned childElementCount() const;
    ExceptionOr<void> append(FixedVector<NodeOrString>&&);
    ExceptionOr<void> prepend(FixedVector<NodeOrString>&&);

    ExceptionOr<void> replaceChildren(FixedVector<NodeOrString>&&);
    void replaceChildrenWithoutValidityCheck(NodeVector&&);

    ExceptionOr<void> moveBefore(Node&, RefPtr<Node>&& refChild);

    ExceptionOr<void> ensurePreInsertionValidity(Node& newChild, Node* refChild);
    ExceptionOr<void> ensurePreInsertionValidityForPhantomDocumentFragment(NodeVector& newChildren, Node* refChild = nullptr, AcceptChildOperation = AcceptChildOperation::InsertOrAdd);
    ExceptionOr<void> insertChildrenBeforeWithoutPreInsertionValidityCheck(NodeVector&&, Node* nextChild = nullptr);

protected:
    explicit inline ContainerNode(Document&, NodeType, OptionSet<TypeFlag> = { });

    friend void removeDetachedChildrenInContainer(ContainerNode&);

    void removeDetachedChildren();
    void setFirstChild(Node* child) { m_firstChild = child; }
    void setLastChild(Node* child) { m_lastChild = child; }

    HTMLCollection* cachedHTMLCollection(CollectionType);

private:
    ContainerNode(ClangVTableWorkaroundTag, Document&);
    void executePreparedChildrenRemoval();
    enum class DeferChildrenChanged : bool { No, Yes };
    enum class DidRemoveElements : bool { No, Yes };
    DidRemoveElements removeAllChildrenWithScriptAssertion(ChildChange::Source, NodeVector& children, DeferChildrenChanged = DeferChildrenChanged::No);
    void removeNodeWithScriptAssertion(Node&, ChildChange::Source);
    ExceptionOr<void> removeSelfOrChildNodesForInsertion(Node&, NodeVector&);

    void removeBetween(Node* previousChild, Node* nextChild, Node& oldChild);
    ExceptionOr<void> appendChildWithoutPreInsertionValidityCheck(Node&);

    void LEGACY_NODELETE insertBeforeCommon(Node& nextChild, Node& oldChild);
    void LEGACY_NODELETE appendChildCommon(Node&);

    bool isContainerNode() const = delete;

    CheckedPtr<Node> m_firstChild;
    CheckedPtr<Node> m_lastChild;
};

bool containsIncludingHostElements(const Node& possibleAncestor, const Node&);

} // namespace WebCore

SPECIALIZE_TYPE_TRAITS_BEGIN(WebCore::ContainerNode)
    static bool isType(const WebCore::Node& node) { return node.isContainerNode(); }
SPECIALIZE_TYPE_TRAITS_END()
