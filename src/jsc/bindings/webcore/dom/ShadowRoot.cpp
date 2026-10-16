/*
 * Copyright (C) 2011 Google Inc. All rights reserved.
 * Copyright (C) 2015-2024 Apple Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are
 * met:
 *
 *     * Redistributions of source code must retain the above copyright
 * notice, this list of conditions and the following disclaimer.
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

#include "config.h"
#include "ShadowRoot.h"

#include "ChildListMutationScope.h"
#include "ContainerNodeInlines.h"
#include "CustomElementRegistry.h"
#include "ElementInlines.h"
#include "ElementTraversal.h"
#include "ExceptionCode.h"
#include "GetHTMLOptions.h"
#include "HTMLSlotElement.h"
#include "SlotAssignment.h"
#include "StyleSheetList.h"
#include "Window.h"
#include "markup.h"
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(ShadowRoot);

struct SameSizeAsShadowRoot : public DocumentFragment, public TreeScope {
    uint8_t flagsAndModes[3];
    WeakPtr<Element, WeakPtrImplWithEventTargetData> host;
    void* shadowIncludingRoot;
    void* slotAssignment;
    void* styleSheetList;
};

static_assert(sizeof(ShadowRoot) == sizeof(SameSizeAsShadowRoot), "shadowroot should stay small");
#if !ASSERT_ENABLED && ASSERT_WITH_SECURITY_IMPLICATION_DISABLED
static_assert(sizeof(WeakPtr<Element, WeakPtrImplWithEventTargetData>) == sizeof(void*), "WeakPtr should be same size as raw pointer");
#endif

ShadowRoot::ShadowRoot(Document& document, ShadowRootMode mode, SlotAssignmentMode assignmentMode, ShadowRootDelegatesFocus delegatesFocus, Clonable clonable, ShadowRootSerializable serializable, ShadowRootAvailableToElementInternals availableToElementInternals, RefPtr<CustomElementRegistry>&& registry, ShadowRootScopedCustomElementRegistry scopedRegistry)
    : DocumentFragment(document, TypeFlag::IsShadowRootOrFormControlElement)
    , TreeScope(*this, document, WTF::move(registry))
    , m_delegatesFocus(delegatesFocus == ShadowRootDelegatesFocus::Yes)
    , m_isClonable(clonable == Clonable::Yes)
    , m_serializable(serializable == ShadowRootSerializable::Yes)
    , m_availableToElementInternals(availableToElementInternals == ShadowRootAvailableToElementInternals::Yes)
    , m_hasScopedCustomElementRegistry(scopedRegistry == ShadowRootScopedCustomElementRegistry::Yes)
    , m_mode(mode)
    , m_slotAssignmentMode(assignmentMode)
    , m_shadowIncludingRoot(this)
{
    setEventTargetFlag(EventTargetFlag::IsInShadowTree);
    if (m_mode == ShadowRootMode::UserAgent)
        setEventTargetFlag(EventTargetFlag::HasBeenInUserAgentShadowTree);
}


ShadowRoot::ShadowRoot(Document& document, std::unique_ptr<SlotAssignment>&& slotAssignment)
    : DocumentFragment(document, TypeFlag::IsShadowRootOrFormControlElement)
    , TreeScope(*this, document, nullptr)
    , m_mode(ShadowRootMode::UserAgent)
    , m_slotAssignment(WTF::move(slotAssignment))
{
    setEventTargetFlag(EventTargetFlag::IsInShadowTree);
    setEventTargetFlag(EventTargetFlag::HasBeenInUserAgentShadowTree);
}


ShadowRoot::~ShadowRoot()
{
    if (isConnected())
        document().didRemoveInDocumentShadowRoot(*this);

    ASSERT(!m_hasBegunDeletingDetachedChildren);
    m_hasBegunDeletingDetachedChildren = true;

    // We must remove all of our children first before the TreeScope destructor
    // runs so we don't go through Node::setTreeScopeRecursively for each child with a
    // destructed tree scope in each descendant.
    removeDetachedChildren();
}

StyleSheetList& ShadowRoot::styleSheets()
{
    if (!m_styleSheetList)
        m_styleSheetList = StyleSheetList::create(*this);
    return *m_styleSheetList;
}

Node::NeedsPostConnectionSteps ShadowRoot::insertionSteps(InsertionType insertionType, ContainerNode& parentOfInsertedTree)
{
    DocumentFragment::insertionSteps(insertionType, parentOfInsertedTree);
    if (!m_hasScopedCustomElementRegistry && usesNullCustomElementRegistry() && !parentOfInsertedTree.usesNullCustomElementRegistry()) {
        if (RefPtr registry = CustomElementRegistry::registryForElement(protect(*host()))) {
            clearUsesNullCustomElementRegistry();
            setCustomElementRegistry(WTF::move(registry));
        }
    }
    if (insertionType.connectedToDocument) {
        protect(document())->didInsertInDocumentShadowRoot(*this);
        if (m_hasScopedCustomElementRegistry) {
            if (RefPtr registry = customElementRegistry())
                registry->didAssociateWithDocument(protect(document()));
        }
    }
    return NeedsPostConnectionSteps::No;
}

void ShadowRoot::removingSteps(RemovalType removalType, ContainerNode& oldParentOfRemovedTree)
{
    DocumentFragment::removingSteps(removalType, oldParentOfRemovedTree);
    if (removalType.disconnectedFromDocument)
        protect(document())->didRemoveInDocumentShadowRoot(*this);
}

void ShadowRoot::moveShadowRootToNewParentScope(TreeScope& newScope, Document& newDocument)
{
    Ref oldDocument = documentScope();
    setParentTreeScope(newScope);
    moveShadowRootToNewDocument(oldDocument, newDocument);
}

void ShadowRoot::moveShadowRootToNewDocument(Document&, Document& newDocument)
{
    setDocumentScope(newDocument);
    RELEASE_ASSERT_WITH_SECURITY_IMPLICATION(!parentTreeScope() || &parentTreeScope()->documentScope() == &newDocument);

    if (customElementRegistry() && !customElementRegistry()->isScoped())
        setCustomElementRegistry(newDocument.effectiveGlobalCustomElementRegistry());
}

CustomElementRegistry* ShadowRoot::registryForBindings() const
{
    if (usesNullCustomElementRegistry())
        return nullptr;
    SUPPRESS_UNCOUNTED_LOCAL auto* registry = customElementRegistry();
    if (RefPtr window = document().window(); window && !registry)
        registry = &window->ensureCustomElementRegistry();
    return registry;
}

ExceptionOr<void> ShadowRoot::replaceChildrenWithMarkup(const String& markup, OptionSet<ParserContentPolicy> parserContentPolicy)
{
    auto policy = OptionSet<ParserContentPolicy> { ParserContentPolicy::AllowScriptingContent } | parserContentPolicy;

    if (markup.isEmpty()) {
        ChildListMutationScope mutation(*this);
        removeChildren();
        return { };
    }

    auto fragment = createFragmentForInnerOuterHTML(*protect(host()), markup, policy, protect(customElementRegistry()), usesNullCustomElementRegistry() ? Element::CustomElementRegistryKind::Null : Element::CustomElementRegistryKind::Window);
    if (fragment.hasException())
        return fragment.releaseException();
    bool usedFastPath = fragment.returnValue()->hasWasParsedWithFastPath();
    auto result = replaceChildrenWithFragment(*this, fragment.releaseReturnValue());
    if (!result.hasException() && usedFastPath)
        protect(document())->updateCachedSetInnerHTML(markup, *this, *protect(host()));
    return result;
}

ExceptionOr<void> ShadowRoot::setHTMLUnsafe(String&& html)
{
    return replaceChildrenWithMarkup(WTF::move(html), { ParserContentPolicy::AllowDeclarativeShadowRoots, ParserContentPolicy::AlwaysParseAsHTML });
}

String ShadowRoot::getHTML(GetHTMLOptions&& options) const
{
    return serializeFragment(*this, SerializedNodes::SubtreesOfChildren, nullptr, ResolveURLs::NoExcludingURLsForPrivacy, SerializationSyntax::HTML, options.serializableShadowRoots ? SerializeShadowRoots::Serializable : SerializeShadowRoots::Explicit, WTF::move(options.shadowRoots));
}

String ShadowRoot::innerHTML() const
{
    return serializeFragment(*this, SerializedNodes::SubtreesOfChildren, nullptr, ResolveURLs::NoExcludingURLsForPrivacy);
}

ExceptionOr<void> ShadowRoot::setInnerHTML(String&& html)
{
    return replaceChildrenWithMarkup(WTF::move(html), { });
}

Ref<Node> ShadowRoot::cloneNodeInternal(Document& document, CloningOperation type, CustomElementRegistry*) const
{
    RELEASE_ASSERT(m_mode != ShadowRootMode::UserAgent);
    ASSERT(m_isClonable);
    switch (type) {
    case CloningOperation::SelfWithTemplateContent:
        return create(document, m_mode, m_slotAssignmentMode,
            m_delegatesFocus ? ShadowRootDelegatesFocus::Yes : ShadowRootDelegatesFocus::No,
            Clonable::Yes,
            m_serializable ? ShadowRootSerializable::Yes : ShadowRootSerializable::No,
            m_availableToElementInternals ? ShadowRootAvailableToElementInternals::Yes : ShadowRootAvailableToElementInternals::No,
            nullptr,
            m_hasScopedCustomElementRegistry ? ShadowRootScopedCustomElementRegistry::Yes : ShadowRootScopedCustomElementRegistry::No);
    case CloningOperation::SelfOnly:
    case CloningOperation::Everything:
        break;
    }

    RELEASE_ASSERT_NOT_REACHED(); // ShadowRoot is never cloned directly on its own.
}

void ShadowRoot::removeAllEventListeners()
{
    DocumentFragment::removeAllEventListeners();
    for (RefPtr node = firstChild(); node; node = NodeTraversal::next(*node))
        node->removeAllEventListeners();
}

void ShadowRoot::renameSlotElement(HTMLSlotElement& slot, const AtomString& oldName, const AtomString& newName)
{
    ASSERT(m_slotAssignment);
    return m_slotAssignment->renameSlotElement(slot, oldName, newName, *this);
}

void ShadowRoot::addSlotElementByName(const AtomString& name, HTMLSlotElement& slot)
{
    ASSERT(&slot.rootNode() == this);
    if (!m_slotAssignment) {
        if (m_slotAssignmentMode == SlotAssignmentMode::Named)
            lazyInitialize(m_slotAssignment, makeUnique<NamedSlotAssignment>());
        else
            lazyInitialize(m_slotAssignment, makeUnique<ManualSlotAssignment>());
    }

    return m_slotAssignment->addSlotElementByName(name, slot, *this);
}

void ShadowRoot::removeSlotElementByName(const AtomString& name, HTMLSlotElement& slot, ContainerNode& oldParentOfRemovedTree)
{
    ASSERT(m_slotAssignment);
    return m_slotAssignment->removeSlotElementByName(name, slot, &oldParentOfRemovedTree, *this);
}

void ShadowRoot::slotManualAssignmentDidChange(HTMLSlotElement& slot, Vector<WeakPtr<Node, WeakPtrImplWithEventTargetData>>& previous, Vector<WeakPtr<Node, WeakPtrImplWithEventTargetData>>& current)
{
    ASSERT(m_slotAssignment);
    m_slotAssignment->slotManualAssignmentDidChange(slot, previous, current, *this);
}

void ShadowRoot::didRemoveManuallyAssignedNode(HTMLSlotElement& slot, const Node& node)
{
    ASSERT(m_slotAssignment);
    m_slotAssignment->didRemoveManuallyAssignedNode(slot, node, *this);
}

void ShadowRoot::slotFallbackDidChange(HTMLSlotElement& slot)
{
    ASSERT(&slot.rootNode() == this);
    return m_slotAssignment->slotFallbackDidChange(slot, *this);
}

const Vector<WeakPtr<Node, WeakPtrImplWithEventTargetData>>* ShadowRoot::assignedNodesForSlot(const HTMLSlotElement& slot)
{
    return m_slotAssignment ? m_slotAssignment->assignedNodesForSlot(slot, *this) : nullptr;
}

Vector<Ref<ShadowRoot>> assignedShadowRootsIfSlotted(const Node& node)
{
    Vector<Ref<ShadowRoot>> result;
    for (CheckedPtr slot = node.assignedSlot(); slot; slot = slot->assignedSlot()) {
        ASSERT(slot->containingShadowRoot());
        result.append(protect(*slot->containingShadowRoot()));
    }
    return result;
}

} // namespace WebCore
