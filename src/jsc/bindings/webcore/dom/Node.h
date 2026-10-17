/*
 * Copyright (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 *           (C) 2001 Dirk Mueller (mueller@kde.org)
 * Copyright (C) 2004-2020, 2026 Apple Inc. All rights reserved.
 * Copyright (C) 2008, 2009 Torch Mobile Inc. All rights reserved. (http://www.torchmobile.com/)
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

#include "EventTarget.h"
#include "NodeType.h"
#include "WebCoreOpaqueRoot.h"
#include <wtf/CheckedPtr.h>
#include <wtf/CheckedRef.h>
#include <wtf/CompactPointerTuple.h>
#include <wtf/CompactUniquePtrTuple.h>
#include <wtf/FixedVector.h>
#include <wtf/Forward.h>
#include <wtf/OptionSet.h>
#include <wtf/OrderedHashSet.h>
#include <wtf/RobinHoodHashSet.h>
#include <wtf/TZoneMalloc.h>
#include <wtf/TypeCasts.h>
#include <wtf/URLHash.h>

namespace WTF {
class TextStream;
}

namespace WebCore {

class ContainerNode;
class CustomElementRegistry;
class Document;
class Element;
class HTMLQualifiedName;
class SVGQualifiedName;
class HTMLSlotElement;
class MutationObserver;
class MutationObserverRegistration;
class NamedNodeMap;
class Node;
class NodeList;
class NodeListsNodeData;
class NodeRareData;
class QualifiedName;
class ShadowRoot;
class TreeScope;
class WebCoreOpaqueRoot;

enum class TextDirection : bool;

template<typename T> class ExceptionOr;

} // namespace WebCore

WTF_ALLOW_COMPACT_POINTERS_TO_INCOMPLETE_TYPE(WebCore::NodeRareData);

namespace WebCore {

enum class MutationObserverOptionType : uint8_t;
enum class TaskSource : uint8_t;
using MutationObserverOptions = OptionSet<MutationObserverOptionType>;
using MutationRecordDeliveryOptions = OptionSet<MutationObserverOptionType>;

enum class IsMutationBySetInnerHTML : uint8_t { No, Yes };
enum class CloneSubtree : bool { No, Yes };

using NodeOrString = Variant<Ref<Node>, String>;

const int initialNodeVectorSize = 11; // Covers 99.5%. See webkit.org/b/80706
typedef Vector<Ref<Node>, initialNodeVectorSize> NodeVector;

class Node : public EventTarget, public CanMakeCheckedPtr<Node> {
    WTF_MAKE_PREFERABLY_COMPACT_TZONE_ALLOCATED(Node);
    WTF_OVERRIDE_DELETE_FOR_CHECKED_PTR(Node);

    friend class Document;
    friend class TreeScope;
public:
    // This opts the entire Node family tree into being allocated in the BuiltinTypeDescriptor TZone category.
    static constexpr bool usesBuiltinTypeDescriptorTZoneCategory = true;

    enum DocumentPosition {
        DOCUMENT_POSITION_EQUIVALENT = 0x00,
        DOCUMENT_POSITION_DISCONNECTED = 0x01,
        DOCUMENT_POSITION_PRECEDING = 0x02,
        DOCUMENT_POSITION_FOLLOWING = 0x04,
        DOCUMENT_POSITION_CONTAINS = 0x08,
        DOCUMENT_POSITION_CONTAINED_BY = 0x10,
        DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC = 0x20,
    };

    WEBCORE_EXPORT virtual ~Node();

    // DOM methods & attributes for Node

    bool hasTagName(const HTMLQualifiedName&) const;
    inline bool hasTagName(const SVGQualifiedName&) const;
    virtual String nodeName() const = 0;
    virtual String nodeValue() const;
    virtual ExceptionOr<void> setNodeValue(const String&);
    NodeType nodeType() const { return nodeTypeFromBitFields(m_typeBitFields); }
    virtual size_t approximateMemoryCost() const { return sizeof(*this); }
    ContainerNode* parentNode() const;
    static constexpr ptrdiff_t parentNodeMemoryOffset() { return OBJECT_OFFSETOF(Node, m_parentNode); }
    inline Element* parentElement() const;
    Node* previousSibling() const { return m_previousSibling; }
    static constexpr ptrdiff_t previousSiblingMemoryOffset() { return OBJECT_OFFSETOF(Node, m_previousSibling); }
    Node* nextSibling() const { return m_next; }
    static constexpr ptrdiff_t nextSiblingMemoryOffset() { return OBJECT_OFFSETOF(Node, m_next); }
    WEBCORE_EXPORT Ref<NodeList> childNodes();
    inline Node* firstChild() const;
    inline Node* lastChild() const;
    inline bool hasAttributes() const;
    inline NamedNodeMap* attributesMap() const;

    WEBCORE_EXPORT const URL& baseURI() const;

    WEBCORE_EXPORT ExceptionOr<void> insertBefore(Node& newChild, RefPtr<Node>&& refChild);
    WEBCORE_EXPORT ExceptionOr<void> replaceChild(Node& newChild, Node& oldChild);
    WEBCORE_EXPORT ExceptionOr<void> removeChild(Node& child);
    WEBCORE_EXPORT ExceptionOr<void> appendChild(Node& newChild);

    inline bool hasChildNodes() const;

    enum class CloningOperation {
        SelfOnly,
        SelfWithTemplateContent,
        Everything,
    };
    virtual Ref<Node> cloneNodeInternal(Document&, CloningOperation, CustomElementRegistry*) const = 0;
    Ref<Node> cloneNode(CloneSubtree) const;
    WEBCORE_EXPORT ExceptionOr<Ref<Node>> cloneNodeForBindings(bool subtree) const;

    virtual const AtomString& LEGACY_NODELETE localName() const;
    virtual const AtomString& LEGACY_NODELETE namespaceURI() const;
    virtual const AtomString& LEGACY_NODELETE prefix() const;
    WEBCORE_EXPORT ExceptionOr<void> normalize();

    bool isSameNode(Node* other) const { return this == other; }
    WEBCORE_EXPORT bool isEqualNode(Node*) const;
    WEBCORE_EXPORT bool isDefaultNamespace(const AtomString& namespaceURI) const;
    WEBCORE_EXPORT const AtomString& lookupPrefix(const AtomString& namespaceURI) const;
    WEBCORE_EXPORT const AtomString& lookupNamespaceURI(const AtomString& prefix) const;

    WEBCORE_EXPORT String textContent(bool convertBRsToNewlines = false) const;
    WEBCORE_EXPORT ExceptionOr<void> setTextContent(String&&);
    
    Node* LEGACY_NODELETE lastDescendant() const;
    Node* LEGACY_NODELETE firstDescendant() const;

    // From the NonDocumentTypeChildNode - https://dom.spec.whatwg.org/#nondocumenttypechildnode
    WEBCORE_EXPORT Element* LEGACY_NODELETE previousElementSibling() const;
    WEBCORE_EXPORT Element* LEGACY_NODELETE nextElementSibling() const;

    // From the ChildNode - https://dom.spec.whatwg.org/#childnode
    ExceptionOr<void> before(FixedVector<NodeOrString>&&);
    ExceptionOr<void> after(FixedVector<NodeOrString>&&);
    ExceptionOr<void> replaceWith(FixedVector<NodeOrString>&&);
    WEBCORE_EXPORT ExceptionOr<void> remove();

    // Other methods (not part of DOM)

    bool isElementNode() const { return hasTypeFlag(TypeFlag::IsElement); }
    bool isContainerNode() const { return hasTypeFlag(TypeFlag::IsContainerNode); }
    bool isCharacterDataNode() const { return hasTypeFlag(TypeFlag::IsCharacterData); }
    bool isTextNode() const { return hasTypeFlag(TypeFlag::IsText); }
    bool isHTMLElement() const { return hasTypeFlag(TypeFlag::IsHTMLElement); }
    bool isSVGElement() const { return hasTypeFlag(TypeFlag::IsSVGElement); }
    bool isMathMLElement() const { return hasTypeFlag(TypeFlag::IsMathMLElement); }

    bool isUnknownElement() const { return hasTypeFlag(TypeFlag::IsUnknownElement); }
    bool isHTMLUnknownElement() const { return isHTMLElement() && isUnknownElement(); }
    bool isSVGUnknownElement() const { return isSVGElement() && isUnknownElement(); }
    bool isMathMLUnknownElement() const { return isMathMLElement() && isUnknownElement(); }

    bool isFormControlElement() const { return isElementNode() && hasTypeFlag(TypeFlag::IsShadowRootOrFormControlElement); }

    bool isStyledElement() const { return hasTypeFlag(TypeFlag::IsHTMLElement) || hasTypeFlag(TypeFlag::IsSVGElement) || hasTypeFlag(TypeFlag::IsMathMLElement); }

    bool isDocumentNode() const { return nodeType() == NodeType::Document; }
    bool isTreeScope() const { return isDocumentNode() || isShadowRoot(); }
    bool isDocumentFragment() const { return nodeType() == NodeType::DocumentFragment; }
    bool isShadowRoot() const { return isDocumentFragment() && hasTypeFlag(TypeFlag::IsShadowRootOrFormControlElement); }
    inline bool isUserAgentShadowRoot() const; // Defined in NodeInlines.h

    bool hasSyntheticAttrChildNodes() const { return hasEventTargetFlag(EventTargetFlag::HasSyntheticAttrChildNodes); }
    void setHasSyntheticAttrChildNodes(bool flag) { setEventTargetFlag(EventTargetFlag::HasSyntheticAttrChildNodes, flag); }

    bool hasShadowRootContainingSlots() const { return hasEventTargetFlag(EventTargetFlag::HasShadowRootContainingSlots); }
    void setHasShadowRootContainingSlots(bool flag) { setEventTargetFlag(EventTargetFlag::HasShadowRootContainingSlots, flag); }

    // If this node is in a shadow tree, returns its shadow host. Otherwise, returns null.
    WEBCORE_EXPORT Element* LEGACY_NODELETE shadowHost() const;
    ShadowRoot* LEGACY_NODELETE containingShadowRoot() const;
    inline ShadowRoot* shadowRoot() const; // Defined in Element.h.
    bool isClosedShadowHidden(const Node&) const;

    HTMLSlotElement* LEGACY_NODELETE assignedSlot() const;
    HTMLSlotElement* LEGACY_NODELETE assignedSlotForBindings() const;
    HTMLSlotElement* LEGACY_NODELETE manuallyAssignedSlot() const;
    void setManuallyAssignedSlot(HTMLSlotElement*);

    bool isUncustomizedCustomElement() const { return customElementState() == CustomElementState::Uncustomized; }
    bool isCustomElementUpgradeCandidate() const { return customElementState() == CustomElementState::Undefined; }
    bool isDefinedCustomElement() const { return customElementState() == CustomElementState::Custom; }
    bool isFailedCustomElement() const { return customElementState() == CustomElementState::FailedOrPrecustomized && isUnknownElement(); }
    bool isFailedOrPrecustomizedCustomElement() const { return customElementState() == CustomElementState::FailedOrPrecustomized; }
    bool isPrecustomizedCustomElement() const { return customElementState() == CustomElementState::FailedOrPrecustomized && !isUnknownElement(); }
    bool isPrecustomizedOrDefinedCustomElement() const { return isPrecustomizedCustomElement() || isDefinedCustomElement(); }

    bool isInCustomElementReactionQueue() const { return hasStateFlag(StateFlag::IsInCustomElementReactionQueue); }
    void setIsInCustomElementReactionQueue() { setStateFlag(StateFlag::IsInCustomElementReactionQueue); }
    void clearIsInCustomElementReactionQueue() { clearStateFlag(StateFlag::IsInCustomElementReactionQueue); }

    bool usesNullCustomElementRegistry() const { return hasStateFlag(StateFlag::UsesNullCustomElementRegistry); }
    void setUsesNullCustomElementRegistry() const { setStateFlag(StateFlag::UsesNullCustomElementRegistry); }
    void clearUsesNullCustomElementRegistry() const { clearStateFlag(StateFlag::UsesNullCustomElementRegistry); }

    bool usesScopedCustomElementRegistryMap() const { return hasStateFlag(StateFlag::UsesScopedCustomElementRegistryMap); }
    void setUsesScopedCustomElementRegistryMap() { setStateFlag(StateFlag::UsesScopedCustomElementRegistryMap); }
    void clearUsesScopedCustomElementRegistryMap() { clearStateFlag(StateFlag::UsesScopedCustomElementRegistryMap); }

    // Returns null, a child of ShadowRoot, or a legacy shadow root.
    Node* LEGACY_NODELETE nonBoundaryShadowTreeRootNode();

    // Node's parent or shadow tree host.
    inline ContainerNode* LEGACY_NODELETE parentOrShadowHostNode() const; // Defined in NodeInlines.h
    ContainerNode* LEGACY_NODELETE parentInComposedTree() const;
    WEBCORE_EXPORT Element* LEGACY_NODELETE parentElementInComposedTree() const;
    Element* LEGACY_NODELETE parentOrShadowHostElement() const;
    inline void setParentNode(ContainerNode*);
    inline Node& LEGACY_NODELETE rootNode() const;
    WEBCORE_EXPORT Node& LEGACY_NODELETE traverseToRootNode() const;
    Node& shadowIncludingRoot() const { return *m_shadowIncludingRoot; }
    void resetShadowIncludingRoot() { m_shadowIncludingRoot = this; }

    struct GetRootNodeOptions {
        bool composed;
    };
    Node& LEGACY_NODELETE getRootNode(const GetRootNodeOptions&) const;

    inline WebCoreOpaqueRoot opaqueRoot() const final { return WebCoreOpaqueRoot { m_shadowIncludingRoot }; }

    template<typename T, typename Task> static void queueTaskKeepingNodeAlive(T&, TaskSource, Task&&);
    void queueTaskToDispatchEvent(TaskSource, Ref<Event>&&);

    // Use when it's guaranteed to that shadowHost is null.
    inline ContainerNode* parentNodeGuaranteedHostFree() const;
    // Returns the parent node, but null if the parent node is a ShadowRoot.
    ContainerNode* LEGACY_NODELETE nonShadowBoundaryParentNode() const;

    bool selfOrPrecedingNodesAffectDirAuto() const { return hasStateFlag(StateFlag::SelfOrPrecedingNodesAffectDirAuto); }
    void setSelfOrPrecedingNodesAffectDirAuto(bool flag) { setStateFlag(StateFlag::SelfOrPrecedingNodesAffectDirAuto, flag); }

    TextDirection LEGACY_NODELETE effectiveTextDirection() const;
    void LEGACY_NODELETE setEffectiveTextDirection(TextDirection);

    bool usesEffectiveTextDirection() const { return rareDataBitfields().usesEffectiveTextDirection; }
    void LEGACY_NODELETE setUsesEffectiveTextDirection(bool);

    // These low-level calls give the caller responsibility for maintaining the integrity of the tree.
    void setPreviousSibling(Node* previous) { m_previousSibling = previous; }
    void setNextSibling(Node* next) { m_next = next; }

    virtual bool canContainRangeEndPoint() const { return false; }

    bool isUserActionElement() const { return hasStateFlag(StateFlag::IsUserActionElement); }
    void setUserActionElement(bool flag) { setStateFlag(StateFlag::IsUserActionElement, flag); }

    bool isDocumentFragmentForInnerOuterHTML() const { return isDocumentFragment() && hasTypeFlag(TypeFlag::IsPseudoElementOrSpecialInternalNode); }

    bool hasHeldBackChildrenChanged() const { return hasStateFlag(StateFlag::HasHeldBackChildrenChanged); }
    void setHasHeldBackChildrenChanged() { setStateFlag(StateFlag::HasHeldBackChildrenChanged); }
    void clearHasHeldBackChildrenChanged() { clearStateFlag(StateFlag::HasHeldBackChildrenChanged); }

    bool hasDidMutateSubtreeAfterSetInnerHTML() const { return hasStateFlag(StateFlag::DidMutateSubtreeAfterSetInnerHTML); }
    void setDidMutateSubtreeAfterSetInnerHTML() { setStateFlag(StateFlag::DidMutateSubtreeAfterSetInnerHTML); }
    void clearDidMutateSubtreeAfterSetInnerHTML() { clearStateFlag(StateFlag::DidMutateSubtreeAfterSetInnerHTML); }
    void setDidMutateSubtreeAfterSetInnerHTMLOnAncestors();

    bool hasWasParsedWithFastPath() const { return hasStateFlag(StateFlag::WasParsedWithFastPath); }
    void setWasParsedWithFastPath() { setStateFlag(StateFlag::WasParsedWithFastPath); }
    void clearWasParsedWithFastPath() { clearStateFlag(StateFlag::WasParsedWithFastPath); }

    WEBCORE_EXPORT bool isContentEditable() const;
    bool hasEditableStyle() const { return computeEditability() != Editability::ReadOnly; }

    enum class Editability { ReadOnly, CanEditPlainText, CanEditRichly };
    WEBCORE_EXPORT Editability computeEditability() const;

    WEBCORE_EXPORT unsigned LEGACY_NODELETE computeNodeIndex() const;

    // Returns the DOM ownerDocument attribute. This method never returns null, except in the case
    // of a Document node.
    inline Document* ownerDocument() const;

    // Returns the document associated with this node. A document node returns itself.
    inline Document& LEGACY_NODELETE document() const; // Defined in NodeDocument.h

    TreeScope& LEGACY_NODELETE treeScope() const
    {
        ASSERT(m_treeScope);
        return *m_treeScope;
    }
    inline void setTreeScopeRecursively(TreeScope&);
    inline void setTreeScopeRecursivelyToMatch(const Node&);
    inline void setTreeScopeRecursivelyToDocument();
    static constexpr ptrdiff_t treeScopeMemoryOffset() { return OBJECT_OFFSETOF(Node, m_treeScope); }

    // Returns true if this node is associated with a document and is in its associated document's
    // node tree, false otherwise (https://dom.spec.whatwg.org/#connected).
    bool isConnected() const { return hasEventTargetFlag(EventTargetFlag::IsConnected); }
    inline bool isInUserAgentShadowTree() const; // Defined in NodeInlines.h
    bool isInShadowTree() const { return hasEventTargetFlag(EventTargetFlag::IsInShadowTree); }
    bool isInTreeScope() const { return isConnected() || isInShadowTree(); }
    bool hasBeenInUserAgentShadowTree() const { return hasEventTargetFlag(EventTargetFlag::HasBeenInUserAgentShadowTree); }

    // https://dom.spec.whatwg.org/#in-a-document-tree
    bool isInDocumentTree() const { return isConnected() && !isInShadowTree(); }

    bool isDocumentTypeNode() const { return nodeType() == NodeType::DocumentType; }
    virtual bool LEGACY_NODELETE childTypeAllowed(NodeType) const { return false; }
    inline unsigned LEGACY_NODELETE countChildNodes() const;
    inline unsigned LEGACY_NODELETE length() const;
    inline Node* traverseToChildAt(unsigned) const;

    // https://dom.spec.whatwg.org/#concept-tree-descendant
    WEBCORE_EXPORT bool LEGACY_NODELETE isDescendantOf(const Node&) const;
    bool isDescendantOf(const Node* other) const { return other && isDescendantOf(*other); }

    // https://dom.spec.whatwg.org/#concept-tree-inclusive-descendant
    ALWAYS_INLINE bool isInclusiveDescendantOf(const Node& other) const { return this == &other || isDescendantOf(other); }
    ALWAYS_INLINE bool isInclusiveDescendantOf(const Node* other) const { return other && isInclusiveDescendantOf(*other); }

    // https://dom.spec.whatwg.org/#concept-tree-inclusive-ancestor
    ALWAYS_INLINE bool contains(const Node& other) const { return other.isInclusiveDescendantOf(*this); }
    ALWAYS_INLINE bool contains(const Node* other) const { return other && contains(*other); }

    // https://dom.spec.whatwg.org/#concept-shadow-including-descendant
    WEBCORE_EXPORT bool LEGACY_NODELETE isShadowIncludingDescendantOf(const Node&) const;
    ALWAYS_INLINE bool isShadowIncludingDescendantOf(const Node* other) const { return other && isShadowIncludingDescendantOf(*other); }

    // https://dom.spec.whatwg.org/#concept-shadow-including-inclusive-ancestor
    ALWAYS_INLINE bool isShadowIncludingInclusiveAncestorOf(const Node& other) const { return this == &other || other.isShadowIncludingDescendantOf(*this); }
    ALWAYS_INLINE bool isShadowIncludingInclusiveAncestorOf(const Node* other) const { return other && isShadowIncludingInclusiveAncestorOf(*other); }

    WEBCORE_EXPORT bool LEGACY_NODELETE isComposedTreeDescendantOf(const Node&) const;
    ALWAYS_INLINE bool isComposedTreeInclusiveDescendantOf(const Node& other) const { return this == &other || isComposedTreeDescendantOf(other); }
    ALWAYS_INLINE bool isComposedTreeInclusiveAncestorOf(const Node& other) const { return other.isComposedTreeInclusiveDescendantOf(*this); }
    ALWAYS_INLINE bool isComposedTreeInclusiveAncestorOf(const Node* other) const { return other && isComposedTreeInclusiveAncestorOf(*other); }

    enum class NeedsPostConnectionSteps : bool { No, Yes };
    struct InsertionType {
        bool connectedToDocument { false };
        bool treeScopeChanged { false };
    };
    // https://dom.spec.whatwg.org/#concept-node-insert-ext
    // Called *after* this node or its ancestor is inserted into a new LEGACY_NODELETE parent (may or may not be a part of document) by scripts or parser.
    // insertionSteps **MUST NOT** invoke scripts. Return NeedsPostConnectionSteps and implement postConnectionSteps instead to run scripts.
    virtual NeedsPostConnectionSteps insertionSteps(InsertionType, ContainerNode& parentOfInsertedTree);

    // https://dom.spec.whatwg.org/#concept-node-post-connection-ext
    virtual void postConnectionSteps() { }

    struct RemovalType {
        bool disconnectedFromDocument { false };
        bool treeScopeChanged { false };
    };
    // https://dom.spec.whatwg.org/#concept-node-remove-ext
    virtual void removingSteps(RemovalType, ContainerNode& oldParentOfRemovedTree);

    struct MovingType {
        bool isSubtreeRoot { false };
        bool didRemoveFromOldTreeScope { false };
        bool didInsertIntoNewTreeScope { false };
    };
    // https://dom.spec.whatwg.org/#concept-node-move-ext
    virtual void movingSteps(MovingType, ContainerNode& oldParent);

    void updateShadowIncludingRootForSubtree();

    virtual String description() const;
    virtual String debugDescription() const;

#if ENABLE(TREE_DEBUGGING)
    void showNode(ASCIILiteral prefix = ""_s) const;
    WEBCORE_EXPORT void showTreeForThis() const;
    void showNodePathForThis() const;
    void showTreeAndMark(const Node* markedNode1, ASCIILiteral markedLabel1, const Node* markedNode2 = nullptr, ASCIILiteral markedLabel2 = { }) const;
#endif // ENABLE(TREE_DEBUGGING)

    void invalidateNodeListAndCollectionCachesInAncestors();
    void invalidateNodeListCollectionAndInnerHTMLPrefixCachesInAncestorsForAttribute(const QualifiedName&, const IsMutationBySetInnerHTML = IsMutationBySetInnerHTML::No);
    NodeListsNodeData* LEGACY_NODELETE nodeLists();
    void clearNodeLists();

    WEBCORE_EXPORT unsigned short compareDocumentPosition(Node&);

    enum EventTargetInterfaceType eventTargetInterface() const override;
    ScriptExecutionContext* scriptExecutionContext() const final;

    WEBCORE_EXPORT bool addEventListener(const AtomString& eventType, Ref<EventListener>&&, const AddEventListenerOptions&) override;
    using EventTarget::addEventListener;
    bool removeEventListener(const AtomString& eventType, EventListener&, const EventListenerOptions&) override;
    void removeAllEventListeners() override;

    using EventTarget::dispatchEvent;
    void dispatchEvent(Event&) override;

    void dispatchScopedEvent(Event&);

    void dispatchDOMActivateEvent(Event& underlyingClickEvent);

    WEBCORE_EXPORT void dispatchInputEvent();

    // Perform the default action for an event.
    virtual void defaultEventHandler(Event&);

    // Whether this node has activation behavior, per the DOM specification. This determines
    // the event's activation target (the innermost node in the event path with activation behavior).
    // https://dom.spec.whatwg.org/#eventtarget-activation-behavior
    virtual bool hasActivationBehavior() const;

    ALWAYS_INLINE void ref() const;
    ALWAYS_INLINE void deref() const;
    ALWAYS_INLINE bool hasOneRef() const;
    ALWAYS_INLINE unsigned refCount() const;
    void applyRefDuringDestructionCheck() const;

    HashMap<Ref<MutationObserver>, MutationRecordDeliveryOptions> registeredMutationObservers(MutationObserverOptionType, const QualifiedName* attributeName);
    void registerMutationObserver(MutationObserver&, MutationObserverOptions, const MemoryCompactLookupOnlyRobinHoodHashSet<AtomString>& attributeFilter);
    void unregisterMutationObserver(MutationObserverRegistration&);
    void registerTransientMutationObserver(MutationObserverRegistration&);
    void unregisterTransientMutationObserver(MutationObserverRegistration&);
    void notifyMutationObserversNodeWillDetach();

#if ENABLE(JIT)
    static constexpr ptrdiff_t typeFlagsMemoryOffset() { return OBJECT_OFFSETOF(Node, m_typeBitFields); }
    static constexpr ptrdiff_t stateFlagsMemoryOffset() { return OBJECT_OFFSETOF(Node, m_stateFlags); }
    static constexpr ptrdiff_t rareDataMemoryOffset() { return OBJECT_OFFSETOF(Node, m_rareDataWithBitfields); }
#if CPU(ADDRESS64)
    static uint64_t rareDataPointerMask() { return CompactPointerTuple<NodeRareData*, uint16_t>::pointerMask; }
#else
    static uint32_t rareDataPointerMask() { return -1; }
#endif
    static auto flagIsText() { return std::to_underlying(TypeFlag::IsText); }
    static auto flagIsContainer() { return std::to_underlying(TypeFlag::IsContainerNode); }
    static auto flagIsElement() { return std::to_underlying(TypeFlag::IsElement); }
    static auto flagIsHTML() { return std::to_underlying(TypeFlag::IsHTMLElement); }
    static auto flagIsLink() { return std::to_underlying(StateFlag::IsLink); }
    static auto flagIsParsingChildren() { return std::to_underlying(StateFlag::IsParsingChildren); }
#endif // ENABLE(JIT)

#if ASSERT_ENABLED
    bool deletionHasBegun() const { return m_deletionHasBegun; }
#endif

protected:
    enum class TypeFlag : uint16_t {
        IsCharacterData = 1 << 0,
        IsText = 1 << 1,
        IsContainerNode = 1 << 2,
        IsElement = 1 << 3,
        IsHTMLElement = 1 << 4,
        IsSVGElement = 1 << 5,
        IsMathMLElement = 1 << 6,
        IsShadowRootOrFormControlElement = 1 << 7,
        IsUnknownElement = 1 << 8,
        IsPseudoElementOrSpecialInternalNode = 1 << 9,
        HasDidMoveToNewDocument = 1 << 11,
    };
    static constexpr auto typeFlagBitCount = 12;

    static uint16_t constructBitFieldsFromNodeTypeAndFlags(NodeType type, OptionSet<TypeFlag> flags) { return (std::to_underlying(type) << typeFlagBitCount) | flags.toRaw(); }
    static NodeType nodeTypeFromBitFields(uint16_t bitFields) { return static_cast<NodeType>((bitFields >> typeFlagBitCount) & 0xf); }
    // Don't bother masking with (1 << typeFlagBitCount) - 1 since OptionSet tolerates the upper 4-bits being used for other purposes.
    bool hasTypeFlag(TypeFlag flag) const { return OptionSet<TypeFlag>::fromRaw(m_typeBitFields).contains(flag); }

    enum class StateFlag : uint32_t {
        IsLink = 1 << 0,
        IsParsingChildren = 1 << 1,
        SelfOrPrecedingNodesAffectDirAuto = 1 << 2,
        EffectiveLangKnownToMatchDocumentElement = 1 << 3,
        HasHeldBackChildrenChanged = 1 << 9,
        IsUserActionElement = 1 << 12,
        IsInCustomElementReactionQueue = 1 << 13,
        UsesNullCustomElementRegistry = 1 << 14,
        UsesScopedCustomElementRegistryMap = 1 << 15,
        DidMutateSubtreeAfterSetInnerHTML = 1 << 21,
        WasParsedWithFastPath = 1 << 22,
    };

    enum class TabIndexState : uint8_t {
        NotSet = 0,
        Zero = 1,
        NegativeOne = 2,
        InRareData = 3,
    };

    enum class CustomElementState : uint8_t {
        Uncustomized = 0,
        Undefined = 1,
        Custom = 2,
        FailedOrPrecustomized = 3,
    };

    struct RareDataBitFields {
        uint16_t tabIndexState : 2;
        uint16_t customElementState : 2;
        uint16_t usesEffectiveTextDirection : 1;
        uint16_t effectiveTextDirection : 1;
    };

    bool hasStateFlag(StateFlag flag) const { return m_stateFlags.contains(flag); }
    void setStateFlag(StateFlag flag, bool value = true) const { m_stateFlags.set(flag, value); }
    void clearStateFlag(StateFlag flag) const { setStateFlag(flag, false); }

    RareDataBitFields rareDataBitfields() const { return std::bit_cast<RareDataBitFields>(m_rareDataWithBitfields.type()); }
    void setRareDataBitfields(RareDataBitFields bitfields) { m_rareDataWithBitfields.setType(std::bit_cast<uint16_t>(bitfields)); }

    TabIndexState tabIndexState() const { return static_cast<TabIndexState>(rareDataBitfields().tabIndexState); }
    inline void setTabIndexState(TabIndexState);

    CustomElementState customElementState() const { return static_cast<CustomElementState>(rareDataBitfields().customElementState); }
    void setCustomElementState(CustomElementState);

    bool isParsingChildrenFinished() const { return !hasStateFlag(StateFlag::IsParsingChildren); }
    void setIsParsingChildrenFinished() { clearStateFlag(StateFlag::IsParsingChildren); }
    void clearIsParsingChildrenFinished() { setStateFlag(StateFlag::IsParsingChildren); }

    Node(Document&, NodeType, OptionSet<TypeFlag>);

    static constexpr uint32_t s_refCountIncrement = 2;
    static constexpr uint32_t s_refCountMask = ~static_cast<uint32_t>(1);

    bool hasRareData() const { return !!m_rareDataWithBitfields.pointer(); }
    NodeRareData* rareData() const LIFETIME_BOUND { return m_rareDataWithBitfields.pointer(); }
    NodeRareData& ensureRareData();
    void clearRareData();

    void setTreeScope(TreeScope&);

    template<typename NodeClass>
    static NodeClass& traverseToRootNodeInternal(const NodeClass&);

    // FIXME: Replace all uses of convertNodesOrStringsIntoNode by convertNodesOrStringsIntoNodeVector.
    ExceptionOr<RefPtr<Node>> convertNodesOrStringsIntoNode(FixedVector<NodeOrString>&&);
    ExceptionOr<NodeVector> convertNodesOrStringsIntoNodeVector(FixedVector<NodeOrString>&&);

private:
    Node(ClangVTableWorkaroundTag, Document&);

    WEBCORE_EXPORT void removedLastRef();

    void refEventTarget() final;
    void derefEventTarget() final;

#if ASSERT_ENABLED
    WEBCORE_EXPORT bool checkIsInUserAgentShadowTree(bool) const;
#else
    bool checkIsInUserAgentShadowTree(bool value) const { return value; }
#endif

    void updateShadowIncludingRoot();

    void materializeRareData();

    Vector<Ref<MutationObserverRegistration>>* LEGACY_NODELETE mutationObserverRegistry();
    WeakHashSet<MutationObserverRegistration>* LEGACY_NODELETE transientMutationObserverRegistry();

    static unsigned moveShadowTreeToNewDocumentFastCase(ShadowRoot&, Document& oldDocument, Document& newDocument);
    static void moveShadowTreeToNewDocumentSlowCase(ShadowRoot&, Document& oldDocument, Document& newDocument);
    static void moveTreeToNewScope(Node&, TreeScope& oldScope, TreeScope& newScope);
    void moveNodeToNewDocumentFastCase(Document& oldDocument, Document& newDocument);
    void moveNodeToNewDocumentSlowCase(Document& oldDocument, Document& newDocument);
    void adoptCustomElementRegistryIntoScopedRegistryDocument();

#if ASSERT_ENABLED
    mutable bool m_inRemovedLastRefFunction { false };
    bool m_deletionHasBegun { false };
#endif

    mutable uint32_t m_refCountAndParentBit { s_refCountIncrement };
    const uint16_t m_typeBitFields;
    mutable OptionSet<StateFlag> m_stateFlags;

    CheckedPtr<ContainerNode> m_parentNode;
    TreeScope* m_treeScope { nullptr };
    Node* m_shadowIncludingRoot { nullptr };
    CheckedPtr<Node> m_previousSibling;
    CheckedPtr<Node> m_next;
    CompactUniquePtrTuple<NodeRareData, uint16_t> m_rareDataWithBitfields;
};

bool LEGACY_NODELETE connectedInSameTreeScope(const Node*, const Node*);

enum TreeType { Tree, ShadowIncludingTree, ComposedTree };
template<TreeType = Tree> ContainerNode* LEGACY_NODELETE parent(const Node&);
template<TreeType = Tree> Node* commonInclusiveAncestor(const Node&, const Node&);
template<TreeType = Tree> std::partial_ordering treeOrder(const Node&, const Node&);

ALWAYS_INLINE void Node::ref() const
{
    applyRefDuringDestructionCheck();
    m_refCountAndParentBit += s_refCountIncrement;
}

inline void Node::applyRefDuringDestructionCheck() const
{
#if ASSERT_ENABLED
    if (!deletionHasBegun())
        return;
    WTF::RefCountDebuggerBase::logRefDuringDestruction(this);
#endif
}

ALWAYS_INLINE void Node::deref() const
{
    ASSERT_WITH_SECURITY_IMPLICATION(refCount());
    auto updatedRefCount = m_refCountAndParentBit - s_refCountIncrement;
    if (!updatedRefCount) {
        ASSERT(!deletionHasBegun());
#if ASSERT_ENABLED
        m_inRemovedLastRefFunction = true;
#endif
        // FIXME: Remove suppression once rdar://189998365 is fixed.
        SUPPRESS_MEMORY_UNSAFE_CAST const_cast<Node&>(*this).removedLastRef();
        return;
    }
    m_refCountAndParentBit = updatedRefCount;
}

ALWAYS_INLINE unsigned Node::refCount() const
{
    return m_refCountAndParentBit / s_refCountIncrement;
}

inline ContainerNode* Node::parentNode() const
{
    return m_parentNode.get();
}

WEBCORE_EXPORT WTF::TextStream& operator<<(WTF::TextStream&, const Node&);

inline void collectChildNodes(Node&, NodeVector&);

} // namespace WebCore

#if ENABLE(TREE_DEBUGGING)
// Outside the WebCore namespace for ease of invocation from the debugger.
void showTree(const WebCore::Node*);
void showNodePath(const WebCore::Node*);
#endif

SPECIALIZE_TYPE_TRAITS_BEGIN(WebCore::Node)
    static bool isType(const WebCore::EventTarget& target) { return target.isNode(); }
SPECIALIZE_TYPE_TRAITS_END()

extern template class mpark::variant<WTF::Ref<WebCore::Node>, WTF::String>;
