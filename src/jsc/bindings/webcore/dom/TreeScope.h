/*
 * Copyright (C) 2011 Google Inc. All rights reserved.
 * Copyright (C) 2012-2025 Apple Inc. All rights reserved.
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

#include <wtf/CheckedRef.h>
#include <wtf/Forward.h>
#include <wtf/NoVirtualDestructorBase.h>
#include <wtf/UniqueRef.h>
#include <wtf/Vector.h>
#include <wtf/WeakHashSet.h>
#include <wtf/text/AtomString.h>

namespace WebCore {

class ContainerNode;
class CustomElementRegistry;
class Document;
class Element;
class HTMLAnchorElement;
class IdTargetObserverRegistry;
class Node;
class QualifiedName;
class RadioButtonGroups;
class ShadowRoot;
class TreeScopeOrderedMap;
class WeakPtrImplWithEventTargetData;

class TreeScope : public NoVirtualDestructorBase {
    friend class Document;

public:
    TreeScope* parentTreeScope() const { return m_parentTreeScope; }
    void setParentTreeScope(TreeScope&);

    WEBCORE_EXPORT void LEGACY_NODELETE ref() const;
    WEBCORE_EXPORT void deref() const;

    Element* LEGACY_NODELETE focusedElementInScope();

    void setCustomElementRegistry(RefPtr<CustomElementRegistry>&&);
    CustomElementRegistry* customElementRegistry() const { return m_customElementRegistry.get(); }

    WEBCORE_EXPORT RefPtr<Element> getElementById(const AtomString&) const;
    WEBCORE_EXPORT RefPtr<Element> getElementById(const String&) const;
    RefPtr<Element> getElementById(StringView) const;
    RefPtr<Element> elementByIdResolvingReferenceTarget(const AtomString&) const;
    const Vector<WeakRef<Element, WeakPtrImplWithEventTargetData>>* getAllElementsById(const AtomString&) const;
    inline bool hasElementWithId(const AtomString&) const; // Defined in TreeScopeInlines.h.
    inline bool containsMultipleElementsWithId(const AtomString& id) const; // Defined in TreeScopeInlines.h.
    void addElementById(const AtomString& elementId, Element&, bool notifyObservers = true);
    void removeElementById(const AtomString& elementId, Element&, bool notifyObservers = true);

    WEBCORE_EXPORT RefPtr<Element> getElementByName(const AtomString&) const;
    inline bool hasElementWithName(const AtomString&) const; // Defined in TreeScopeInlines.h.
    inline bool containsMultipleElementsWithName(const AtomString&) const; // Defined in TreeScopeInlines.h.
    void addElementByName(const AtomString&, Element&);
    void removeElementByName(const AtomString&, Element&);

    Document& LEGACY_NODELETE documentScope() const { return m_documentScope.get(); }
    static constexpr ptrdiff_t documentScopeMemoryOffset() { return OBJECT_OFFSETOF(TreeScope, m_documentScope); }

    // https://dom.spec.whatwg.org/#retarget
    Ref<Node> LEGACY_NODELETE retargetToScope(Node&) const;

    WEBCORE_EXPORT Node* LEGACY_NODELETE ancestorNodeInThisScope(Node*) const;
    WEBCORE_EXPORT Element* LEGACY_NODELETE ancestorElementInThisScope(Element*) const;

    // Find first anchor with the given name.
    // First searches for an element with the given ID, but if that fails, then looks
    // for an anchor with the given name. ID matching is always case sensitive, but
    // Anchor name matching is case sensitive in strict mode and not case sensitive in
    // quirks mode for historical compatibility reasons.
    RefPtr<Element> findAnchor(StringView name);
    bool LEGACY_NODELETE isMatchingAnchor(HTMLAnchorElement&, StringView name);

    inline ContainerNode& rootNode() const; // Defined in TreeScopeInlines.h

    inline IdTargetObserverRegistry& idTargetObserverRegistry();
    IdTargetObserverRegistry* idTargetObserverRegistryIfExists() { return m_idTargetObserverRegistry.get(); }

    RadioButtonGroups& radioButtonGroups();

    // FIXME: Add a ThreadSafetyAnalysis annotated Lock subclass that allows for asserted reads from the mutator
    static ALWAYS_INLINE Lock& treeScopeMutationLock();

protected:
    TreeScope(ShadowRoot&, Document&, RefPtr<CustomElementRegistry>&&);
    explicit TreeScope(Document&);
    ~TreeScope();

    void destroyTreeScopeData();
    inline void setDocumentScope(Document&);

private:
    IdTargetObserverRegistry& ensureIdTargetObserverRegistry();

    const CheckedRef<ContainerNode> m_rootNode;
    std::reference_wrapper<Document> m_documentScope;
    TreeScope* m_parentTreeScope;

    RefPtr<CustomElementRegistry> m_customElementRegistry;

    std::unique_ptr<TreeScopeOrderedMap> m_elementsById;
    std::unique_ptr<TreeScopeOrderedMap> m_elementsByName;

    const std::unique_ptr<IdTargetObserverRegistry> m_idTargetObserverRegistry;

    const std::unique_ptr<RadioButtonGroups> m_radioButtonGroups;
};

TreeScope* LEGACY_NODELETE commonTreeScope(Node*, Node*);

} // namespace WebCore
