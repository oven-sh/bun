/*
 * Copyright (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 *           (C) 2001 Dirk Mueller (mueller@kde.org)
 *           (C) 2006 Alexey Proskuryakov (ap@webkit.org)
 * Copyright (C) 2004-2026 Apple Inc. All rights reserved.
 * Copyright (C) 2008, 2009 Torch Mobile Inc. All rights reserved. (http://www.torchmobile.com/)
 * Copyright (C) 2010 Nokia Corporation and/or its subsidiary(-ies)
 * Copyright (C) 2011 Google Inc. All rights reserved.
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

#include "ContainerNode.h"
#include "ContextDestructionObserver.h"
#include "DocumentClasses.h"
#include "DocumentEnums.h"
#include "Element.h"
#include "ExceptionOr.h"
#include "MutationObserverOptions.h"
#include "QualifiedName.h"
#include "ScriptExecutionContext.h"
#include "TaskSource.h"
#include "TreeScope.h"
#include "UserActionElementSet.h"
#include "WritingMode.h"
#include <wtf/HashSet.h>
#include <wtf/OrderedHashSet.h>
#include <wtf/RobinHoodHashMap.h>
#include <wtf/TZoneMalloc.h>
#include <wtf/WeakHashMap.h>
#include <wtf/WeakHashSet.h>
#include <wtf/WeakListHashSet.h>
#include <wtf/text/AtomStringHash.h>

namespace JSC {
class JSObject;
}

namespace WTF {
class TextStream;
}

namespace WebCore {

class Attr;
class CDATASection;
class Comment;
class Cookie;
class CustomElementQueue;
class CustomElementRegistry;
class DOMImplementation;
class DOMSelection;
class DOMWrapperWorld;
class DocumentFragment;
class DocumentParser;
class DocumentSharedObjectPool;
class DocumentType;
class HTMLAllCollection;
class HTMLBaseElement;
class HTMLBodyElement;
class HTMLCollection;
class HTMLDialogElement;
class HTMLDocument;
class HTMLDocumentParser;
class HTMLElement;
class HTMLHeadElement;
class LiveNodeList;
class Location;
class NodeFilter;
class NodeIterator;
class NodeList;
class ProcessingInstruction;
class QualifiedName;
class Range;
class ScriptableDocumentParser;
class SegmentedString;
class SelectorQuery;
class SpaceSplitString;
class StyleSheetList;
class Text;
class TreeWalker;
class Window;

struct ElementCreationOptions;
struct FocusOptions;
struct ImportNodeOptions;
struct QuerySelectorResults;

enum class CollectionType : uint8_t;
enum class FireEvents : bool;
enum class FocusPreviousElement : bool;
enum class FocusTrigger : uint8_t;
enum class MutationObserverOptionType : uint8_t;
enum class ParserContentPolicy : uint8_t;
enum class VisibilityState : bool;

struct CachedSetInnerHTML {
    String source;
    WeakPtr<ContainerNode, WeakPtrImplWithEventTargetData> cachedContainer;
    ElementName contextElementName;
};

enum class CustomElementNameValidationStatus : uint8_t {
    Valid,
    FirstCharacterIsNotLowercaseASCIILetter,
    ContainsNoHyphen,
    ContainsUppercaseASCIILetter,
    ContainsDisallowedCharacter,
    ConflictsWithStandardElementName
};

enum class ClonedDocumentType : uint8_t { XMLDocument, XHTMLDocument, HTMLDocument, SVGDocument, Document };

class Document
    : public ContainerNode
    , public TreeScope {
    WTF_MAKE_TZONE_ALLOCATED_EXPORT(Document, WEBCORE_EXPORT);
    WTF_OVERRIDE_DELETE_FOR_CHECKED_PTR(Document);
public:
    USING_CAN_MAKE_WEAKPTR(EventTarget);

    inline static Ref<Document> create(ScriptExecutionContext&, const URL&);
    static Ref<Document> create(Document&);
    static Ref<Document> createCloned(ClonedDocumentType, ScriptExecutionContext&, const URL&, const URL& baseURL, DocumentCompatibilityMode, OptionSet<ParserContentPolicy>, const String& contentType);

    virtual ~Document();

    // Nodes belonging to this document increase referencingNodeCount -
    // these are enough to keep the document from being destroyed, but
    // not enough to keep it from removing its children. This allows a
    // node that outlives its document to still have a valid document
    // pointer without introducing reference cycles.
    ALWAYS_INLINE void incrementReferencingNodeCount(unsigned count = 1)
    {
        ASSERT(!deletionHasBegun());
        m_referencingNodeCount += count;
    }

    ALWAYS_INLINE void decrementReferencingNodeCount(unsigned count = 1)
    {
        ASSERT_WITH_SECURITY_IMPLICATION(m_referencingNodeCount >= count);

        m_referencingNodeCount -= count;
        if (!m_referencingNodeCount && !refCount()) {
            // Restore the the final overlooking ref that deref() maintains.
            m_refCountAndParentBit = s_refCountIncrement;

#if ASSERT_ENABLED
            m_deletionHasBegun = true;
#endif
            delete this;
        }
    }

    unsigned referencingNodeCount() const { return m_referencingNodeCount; }

    void removedLastRef();

    using ContainerNode::ref;
    using ContainerNode::deref;
    using TreeScope::rootNode;

    void setMarkupUnsafe(const String&, OptionSet<ParserContentPolicy>);
    static ExceptionOr<Ref<Document>> parseHTMLUnsafe(Document&, String&&);

    RefPtr<NodeList> resultForSelectorAll(ContainerNode&, const String&);
    void addResultForSelectorAll(ContainerNode&, const String&, NodeList&, const AtomString& classNameToMatch);
    std::optional<Element*> resultForSelector(ContainerNode&, const String&);
    void addResultForSelector(ContainerNode&, const String&, Element*, const AtomString& classNameToMatch);
    void invalidateQuerySelectorResults(Node&);
    void invalidateQuerySelectorResultsForClassAttributeChange(Node&, const SpaceSplitString& oldClasses, const SpaceSplitString& newClasses);
    void clearQuerySelectorResults();

    ExceptionOr<SelectorQuery&> selectorQueryForString(const String&);

    WEBCORE_EXPORT DocumentType* LEGACY_NODELETE doctype() const;

    WEBCORE_EXPORT DOMImplementation& implementation();
    WEBCORE_EXPORT StyleSheetList& styleSheets();
    
    Element* documentElement() const { return m_documentElement.get(); }
    static constexpr ptrdiff_t documentElementMemoryOffset() { return OBJECT_OFFSETOF(Document, m_documentElement); }

    WEBCORE_EXPORT Element* LEGACY_NODELETE activeElement();
    WEBCORE_EXPORT bool hasFocus() const;

    WEBCORE_EXPORT ExceptionOr<Ref<Element>> createElementForBindings(const AtomString& tagName);
    ExceptionOr<Ref<Element>> createElementForBindings(const AtomString& tagName, Variant<String, ElementCreationOptions>&&);
    WEBCORE_EXPORT Ref<DocumentFragment> createDocumentFragment();
    WEBCORE_EXPORT Ref<Text> createTextNode(String&& data);
    WEBCORE_EXPORT Ref<Comment> createComment(String&& data);
    WEBCORE_EXPORT ExceptionOr<Ref<CDATASection>> createCDATASection(String&& data);
    WEBCORE_EXPORT ExceptionOr<Ref<ProcessingInstruction>> createProcessingInstruction(String&& target, String&& data);
    WEBCORE_EXPORT ExceptionOr<Ref<Attr>> createAttribute(const AtomString& name);
    WEBCORE_EXPORT ExceptionOr<Ref<Attr>> createAttributeNS(const AtomString& namespaceURI, const AtomString& qualifiedName, bool shouldIgnoreNamespaceChecks = false);
    WEBCORE_EXPORT ExceptionOr<Ref<Node>> importNode(Node& nodeToImport, Variant<bool, ImportNodeOptions>&&);
    WEBCORE_EXPORT ExceptionOr<Ref<Element>> createElementNS(const AtomString& namespaceURI, const AtomString& qualifiedName);
    ExceptionOr<Ref<Element>> createElementNS(const AtomString& namespaceURI, const AtomString& qualifiedName, Variant<String, ElementCreationOptions>&&);

    WEBCORE_EXPORT Ref<Element> createElement(const QualifiedName&, bool createdByParser, CustomElementRegistry* = nullptr);

    CustomElementRegistry* LEGACY_NODELETE effectiveGlobalCustomElementRegistry();
    static CustomElementNameValidationStatus validateCustomElementName(const AtomString&);
    CustomElementRegistry* activeCustomElementConstructorRegistry(JSC::JSObject* constructor);
    void addToActiveCustomElementConstructorMap(JSC::JSObject* constructor, CustomElementRegistry&);
    void removeFromActiveCustomElementConstructorMap(JSC::JSObject* constructor);
    void addCustomElementUpgradeCandidateLocalName(const AtomString& localName) { m_customElementUpgradeCandidateLocalNames.add(localName); }
    void removeCustomElementUpgradeCandidateLocalName(const AtomString& localName) { m_customElementUpgradeCandidateLocalNames.remove(localName); }
    bool mayHaveCustomElementUpgradeCandidate(const AtomString& localName) const { return m_customElementUpgradeCandidateLocalNames.contains(localName); }

    WEBCORE_EXPORT RefPtr<Element> scrollingElementForAPI();
    WEBCORE_EXPORT RefPtr<Element> scrollingElement();

    enum class ReadyState : uint8_t { Loading, Interactive, Complete };
    ReadyState readyState() const { return m_readyState; }

    ASCIILiteral characterSetWithUTF8Fallback() const { return "UTF-8"_s; }
    ASCIILiteral encoding() const { return "UTF-8"_s; }

    WEBCORE_EXPORT String suggestedMIMEType() const;

    void overrideMIMEType(const String&);
    WEBCORE_EXPORT String contentType() const;

    const AtomString& contentLanguage() const LIFETIME_BOUND { return m_contentLanguage; }
    void setContentLanguage(const AtomString&);

    const AtomString& LEGACY_NODELETE effectiveDocumentElementLanguage() const;
    void setDocumentElementLanguage(const AtomString&);
    TextDirection documentElementTextDirection() const { return m_documentElementTextDirection; }
    void setDocumentElementTextDirection(TextDirection textDirection) { m_documentElementTextDirection = textDirection; }

    void addElementWithLangAttrMatchingDocumentElement(Element&);
    void removeElementWithLangAttrMatchingDocumentElement(Element&);

    String xmlEncoding() const { return m_xmlEncoding; }
    String xmlVersion() const { return m_xmlVersion; }
    enum class StandaloneStatus : uint8_t { Unspecified, Standalone, NotStandalone };
    bool xmlStandalone() const { return m_xmlStandalone == StandaloneStatus::Standalone; }
    StandaloneStatus xmlStandaloneStatus() const { return m_xmlStandalone; }
    bool hasXMLDeclaration() const { return m_hasXMLDeclaration; }

    void setXMLEncoding(const String& encoding) { m_xmlEncoding = encoding; } // read-only property, only to be set from XMLDocumentParser
    WEBCORE_EXPORT ExceptionOr<void> setXMLVersion(const String&);
    WEBCORE_EXPORT void LEGACY_NODELETE setXMLStandalone(bool);
    void setHasXMLDeclaration(bool hasXMLDeclaration) { m_hasXMLDeclaration = hasXMLDeclaration; }

    WEBCORE_EXPORT VisibilityState visibilityState() const;
    WEBCORE_EXPORT bool hidden() const;

    WEBCORE_EXPORT ExceptionOr<Ref<Node>> adoptNode(Node& source);

    WEBCORE_EXPORT Ref<HTMLCollection> images();
    WEBCORE_EXPORT Ref<HTMLCollection> embeds();
    WEBCORE_EXPORT Ref<HTMLCollection> applets();
    WEBCORE_EXPORT Ref<HTMLCollection> links();
    WEBCORE_EXPORT Ref<HTMLCollection> forms();
    WEBCORE_EXPORT Ref<HTMLCollection> anchors();
    WEBCORE_EXPORT Ref<HTMLCollection> scripts();
    Ref<HTMLAllCollection> all();
    Ref<HTMLCollection> allFilteredByName(const AtomString&);

    Ref<HTMLCollection> windowNamedItems(const AtomString&);
    Ref<HTMLCollection> documentNamedItems(const AtomString&);

    WEBCORE_EXPORT Ref<NodeList> getElementsByName(const AtomString& elementName);

    // Other methods (not part of DOM)
    bool isHTMLDocument() const { return m_documentClasses.contains(DocumentClass::HTML); }
    bool isXHTMLDocument() const { return m_documentClasses.contains(DocumentClass::XHTML); }
    bool isXMLDocument() const { return m_documentClasses.contains(DocumentClass::XML); }
    bool isSVGDocument() const { return m_documentClasses.contains(DocumentClass::SVG); }

    bool wasRemovedLastRefCalled() const { return m_wasRemovedLastRefCalled; }

    bool isDirAttributeDirty() const { return m_isDirAttributeDirty; }
    void setIsDirAttributeDirty() { m_isDirAttributeDirty = true; }

    WEBCORE_EXPORT Ref<Range> createRange();

    // The last bool parameter is for ObjC bindings.
    WEBCORE_EXPORT Ref<NodeIterator> createNodeIterator(Node& root, unsigned long whatToShow = 0xFFFFFFFF, RefPtr<NodeFilter>&& = nullptr, bool = false);

    // The last bool parameter is for ObjC bindings.
    WEBCORE_EXPORT Ref<TreeWalker> createTreeWalker(Node& root, unsigned long whatToShow = 0xFFFFFFFF, RefPtr<NodeFilter>&& = nullptr, bool = false);

    WEBCORE_EXPORT ExceptionOr<Document&> openForBindings(const String&, const String&);

    // FIXME: We should rename this at some point and give back the name 'open' to the HTML specified ones.
    WEBCORE_EXPORT ExceptionOr<void> open();
    void implicitOpen();

    WEBCORE_EXPORT ExceptionOr<void> closeForBindings();

    // FIXME: We should rename this at some point and give back the name 'close' to the HTML specified one.
    WEBCORE_EXPORT void close();
    // In some situations (see the code), we ignore document.close().
    // explicitClose() bypass these checks and actually tries to close the
    // input stream.
    void explicitClose();
    // implicitClose() actually does the work of closing the input stream.
    void implicitClose();

    ExceptionOr<void> write(SegmentedString&&);
    ExceptionOr<void> write(FixedVector<String>&&);
    ExceptionOr<void> writeln(FixedVector<String>&&);

    bool wellFormed() const { return m_wellFormed; }

    const URL& LEGACY_NODELETE url() const LIFETIME_BOUND { return m_url; }
    bool isSrcdocDocument() const { return m_url.isAboutSrcDoc(); }
    WEBCORE_EXPORT void setURL(URL&&);
    WEBCORE_EXPORT const URL& urlForBindings();

    // To understand how these concepts relate to one another, please see the
    // comments surrounding their declaration.
    const URL& baseURL() const LIFETIME_BOUND { return m_baseURL; }
    const AtomString& baseTarget() const LIFETIME_BOUND { return m_baseTarget; }
    HTMLBaseElement* LEGACY_NODELETE firstBaseElement() const;
    void processBaseElement();

    WEBCORE_EXPORT URL parseURL(const String&) const;
    WEBCORE_EXPORT URL encodingParseURL(const String&) const;
    URL encodingParseURL(const String&, const URL& baseURLOverride) const;

    virtual Ref<DocumentParser> createParser();
    DocumentParser* parser() const { return m_parser.get(); }
    ScriptableDocumentParser* scriptableDocumentParser() const;
    HTMLDocumentParser* htmlDocumentParser() const;

    void setCompatibilityMode(DocumentCompatibilityMode);

    WEBCORE_EXPORT String compatMode() const;

    bool inQuirksMode() const { return m_compatibilityMode == DocumentCompatibilityMode::QuirksMode; }
    bool inLimitedQuirksMode() const { return m_compatibilityMode == DocumentCompatibilityMode::LimitedQuirksMode; }
    bool inNoQuirksMode() const { return m_compatibilityMode == DocumentCompatibilityMode::NoQuirksMode; }
    DocumentCompatibilityMode compatibilityMode() const { return m_compatibilityMode; }

    void setReadyState(ReadyState);
    void setParsing(bool);
    bool parsing() const { return m_bParsing; }

    // Returns whether focus was blocked. A true value does not necessarily mean the element was focused.
    // The element could have already been focused or may not be focusable (e.g. <input disabled>).
    WEBCORE_EXPORT bool setFocusedElement(Element*);
    WEBCORE_EXPORT bool setFocusedElement(Element*, const FocusOptions&);
    Element* focusedElement() const { return m_focusedElement.get(); }
    Element* focusedFrameOwnerElement() const;
    inline bool wasLastFocusByClick() const;
    UserActionElementSet& userActionElements() LIFETIME_BOUND  { return m_userActionElements; }
    const UserActionElementSet& userActionElements() const LIFETIME_BOUND { return m_userActionElements; }

    enum class NodeRemoval : bool { Node, ChildrenOfNode };
    void adjustFocusedNodeOnNodeRemoval(Node&, NodeRemoval = NodeRemoval::Node);

    // Updates for :target (CSS3 selector).
    void setCSSTarget(Element*);
    inline Element* cssTarget() const; // Defined in ElementInlines.h.

    void registerNodeListForInvalidation(LiveNodeList&);
    void unregisterNodeListForInvalidation(LiveNodeList&);
    WEBCORE_EXPORT void registerCollection(HTMLCollection&);
    WEBCORE_EXPORT void unregisterCollection(HTMLCollection&);
    void LEGACY_NODELETE collectionCachedIdNameMap(const HTMLCollection&);
    void LEGACY_NODELETE collectionWillClearIdNameMap(const HTMLCollection&);
    bool LEGACY_NODELETE shouldInvalidateNodeListAndCollectionCaches() const;
    bool LEGACY_NODELETE shouldInvalidateNodeListAndCollectionCachesForAttribute(const QualifiedName& attrName) const;

    template <typename InvalidationFunction>
    void invalidateNodeListAndCollectionCaches(InvalidationFunction);

    void attachNodeIterator(NodeIterator&);
    void detachNodeIterator(NodeIterator&);
    inline bool hasNodeIterators() const;
    void moveNodeIteratorsToNewDocument(Node&, Document&);

    void attachRange(Range&);
    void detachRange(Range&);
    bool hasRanges() { return !m_ranges.isEmpty(); }

    void updateRangesAfterChildrenChanged(ContainerNode&);
    // nodeChildrenWillBeRemoved is used when removing all node children at once.
    void nodeChildrenWillBeRemoved(ContainerNode&);
    // nodeWillBeRemoved is only safe when removing one node at a time.
    void nodeWillBeRemoved(Node&);
    void nodeWillBeMoved(Node&);
    void parentlessNodeMovedToNewDocument(Node&);

    bool LEGACY_NODELETE canAcceptChild(const Node& newChild, const Node* refChild, AcceptChildOperation) const;

    void textInserted(Node&, unsigned offset, unsigned length);
    void textRemoved(Node&, unsigned offset, unsigned length);
    void textNodesMerged(Text& oldNode, unsigned offset);
    void textNodeSplit(Text& oldNode);

    Window* window() const { return m_window; }
    Element* ownerElement() const;
    Document* parentDocument() const;
    Location* location() const;
    DOMSelection* getSelection();
    void setWindow(Window*);

    inline bool hasBrowsingContext() const; // Defined in DocumentInlines.h.

    OptionSet<ParserContentPolicy> parserContentPolicy() const { return m_parserContentPolicy; }
    void setParserContentPolicy(OptionSet<ParserContentPolicy> policy) { m_parserContentPolicy = policy; }

    // Helper functions for forwarding Window event related tasks to the Window if it exists.
    void setWindowAttributeEventListener(const AtomString& eventType, const QualifiedName& attributeName, const AtomString& value, DOMWrapperWorld&);
    WEBCORE_EXPORT void dispatchWindowEvent(Event&, EventTarget* = nullptr);
    void dispatchWindowLoadEvent();

    WEBCORE_EXPORT ExceptionOr<Ref<Event>> createEvent(const String& eventType);

    // keep track of what types of event listeners are registered, so we don't
    // dispatch events unnecessarily
    // FIXME: Consider using OptionSet.
    enum class ListenerType : uint16_t {
        FocusIn = 1 << 11,
        FocusOut = 1 << 12,
    };

    bool hasListenerType(ListenerType listenerType) const { return m_listenerTypes.contains(listenerType); }
    void addListenerTypeIfNeeded(const AtomString& eventType);

    enum class IsCapture : bool { No, Yes };

    struct EventListenerCounts {
        uint16_t capturing { 0 };
        uint16_t bubbling { 0 };

        bool hasAny() const { return capturing || bubbling; }
        bool hasCapturing() const { return capturing; }
    };

    void didAddEventListenersOfType(const AtomString&, IsCapture, uint16_t count = 1);
    void LEGACY_NODELETE didRemoveEventListenersOfType(const AtomString&, IsCapture, uint16_t count = 1);
    bool hasNodeWithEventListeners() const { return !m_eventListenerCounts.isEmpty(); }
    EventListenerCounts eventListenerCountsOfType(const AtomString& type) const { return m_eventListenerCounts.inlineGet(type); }

    bool hasMutationObserversOfType(MutationObserverOptionType type) const { return m_mutationObserverTypes.containsAny(type); }
    bool hasMutationObservers() const { return !m_mutationObserverTypes.isEmpty(); }
    void addMutationObserverTypes(MutationObserverOptions types) { m_mutationObserverTypes.add(types); }

    void processMetaHttpEquiv(const String& equiv, const AtomString& content);

    // Used by DOM bindings; no direction known.
    const String& title() const LIFETIME_BOUND { return m_title; }
    WEBCORE_EXPORT void setTitle(String&&);

    WEBCORE_EXPORT const AtomString& dir() const;
    WEBCORE_EXPORT void setDir(const AtomString&);

    void titleElementAdded(Element& titleElement);
    void titleElementRemoved(Element& titleElement);
    void titleElementTextChanged(Element& titleElement);

    WEBCORE_EXPORT ExceptionOr<String> cookie();
    WEBCORE_EXPORT ExceptionOr<void> setCookie(const String&);

    String referrerForBindings() const;

    WEBCORE_EXPORT String domain() const;

    WEBCORE_EXPORT String lastModified() const;

    WEBCORE_EXPORT bool isFullyActive() const;

    // This is the "HTML body element" as defined by CSSOM View spec, the first body child of the
    // document element. See http://dev.w3.org/csswg/cssom-view/#the-html-body-element.
    WEBCORE_EXPORT HTMLBodyElement* LEGACY_NODELETE body() const;

    // This is the "body element" as defined by HTML5, the first body or frameset child of the
    // document element. See https://html.spec.whatwg.org/multipage/dom.html#the-body-element-2.
    WEBCORE_EXPORT HTMLElement* LEGACY_NODELETE bodyOrFrameset() const;
    WEBCORE_EXPORT ExceptionOr<void> setBodyOrFrameset(RefPtr<HTMLElement>&&);

    WEBCORE_EXPORT HTMLHeadElement* LEGACY_NODELETE head();

    // designMode support
    enum class DesignMode : bool { Off, On };
    bool inDesignMode() const { return m_designMode == DesignMode::On; }
    WEBCORE_EXPORT String LEGACY_NODELETE designMode() const;
    WEBCORE_EXPORT void setDesignMode(const String&);

    Element* currentScript() const { return !m_currentScriptStack.isEmpty() ? m_currentScriptStack.last().get() : nullptr; }
    void pushCurrentScript(Element*);
    void popCurrentScript();

    void incDOMTreeVersion() { ++m_domTreeVersion; }
    uint64_t domTreeVersion() const { return m_domTreeVersion; }

    void finishedParsing();

    void removeAllEventListeners() final;

    DocumentSharedObjectPool* sharedObjectPool() LIFETIME_BOUND { return m_sharedObjectPool.get(); }

    const Document* templateDocument() const;
    Document& ensureTemplateDocument();
    void setTemplateDocumentHost(Document* templateDocumentHost) { m_templateDocumentHost = templateDocumentHost; }
    Document* templateDocumentHost() { return m_templateDocumentHost.get(); }
    bool isTemplateDocument() const { return !!m_templateDocumentHost; }

    Ref<DocumentFragment> documentFragmentForInnerOuterHTML();

    bool hasDisabledFieldsetElement() const { return m_disabledFieldsetElementsCount; }
    void addDisabledFieldsetElement() { m_disabledFieldsetElementsCount++; }
    void removeDisabledFieldsetElement() { ASSERT(m_disabledFieldsetElementsCount); m_disabledFieldsetElementsCount--; }

    bool hasDataListElements() const { return m_dataListElementCount; }
    void incrementDataListElementCount() { ++m_dataListElementCount; }
    void decrementDataListElementCount() { ASSERT(m_dataListElementCount); --m_dataListElementCount; }

    using ContainerNode::setAttributeEventListener;
    void setAttributeEventListener(const AtomString& eventType, const QualifiedName& attributeName, const AtomString& value, DOMWrapperWorld& isolatedWorld);

    void didInsertInDocumentShadowRoot(ShadowRoot&);
    void didRemoveInDocumentShadowRoot(ShadowRoot&);
    const WeakListHashSet<ShadowRoot, WeakPtrImplWithEventTargetData>& inDocumentShadowRoots() const LIFETIME_BOUND { return m_inDocumentShadowRoots; }

    WEBCORE_EXPORT const AtomString& LEGACY_NODELETE bgColor() const;
    WEBCORE_EXPORT void setBgColor(const AtomString&);
    WEBCORE_EXPORT const AtomString& LEGACY_NODELETE fgColor() const;
    WEBCORE_EXPORT void setFgColor(const AtomString&);
    WEBCORE_EXPORT const AtomString& LEGACY_NODELETE alinkColor() const;
    WEBCORE_EXPORT void setAlinkColor(const AtomString&);
    WEBCORE_EXPORT const AtomString& LEGACY_NODELETE linkColorForBindings() const;
    WEBCORE_EXPORT void setLinkColorForBindings(const AtomString&);
    WEBCORE_EXPORT const AtomString& LEGACY_NODELETE vlinkColor() const;
    WEBCORE_EXPORT void setVlinkColor(const AtomString&);

    // Per https://html.spec.whatwg.org/multipage/obsolete.html#dom-document-clear, this method does nothing.
    void clear() { }
    // Per https://html.spec.whatwg.org/multipage/obsolete.html#dom-document-captureevents, this method does nothing.
    void captureEvents() { }
    // Per https://html.spec.whatwg.org/multipage/obsolete.html#dom-document-releaseevents, this method does nothing.
    void releaseEvents() { }

    void addTopLayerElement(Element&);
    void removeTopLayerElement(Element&);
    const OrderedHashSet<Ref<Element>>& topLayerElements() const LIFETIME_BOUND { return m_topLayerElements; }
    bool hasTopLayerElement() const { return !m_topLayerElements.isEmpty(); }

    const OrderedHashSet<Ref<HTMLElement>>& autoPopoverList() const LIFETIME_BOUND { return m_autoPopoverList; }
    const OrderedHashSet<Ref<HTMLElement>>& hintPopoverList() const LIFETIME_BOUND { return m_hintPopoverList; }

    HTMLDialogElement* activeModalDialog() const;
    HTMLElement* LEGACY_NODELETE topmostAutoPopover() const;
    HTMLElement* LEGACY_NODELETE topmostHintPopover() const;
    HTMLElement* LEGACY_NODELETE nearestOpenHintAncestor(Element&) const;

    void hideAutoPopoversUntil(HTMLElement*, FocusPreviousElement, FireEvents);
    void closeAllHintPopovers(FocusPreviousElement, FireEvents);
    void closeHintPopoversUntil(const HTMLElement* endpoint, FocusPreviousElement, FireEvents);
    void hidePopoversForTopLayerElement(Element&, FireEvents);

    // True while a popover show or hide algorithm is running (including during the beforetoggle
    // event it dispatches). Showing a popover reentrantly during this window must throw.
    bool isRunningPopoverShowOrHide() const { return m_popoverShowOrHideDepth; }
    class PopoverShowOrHideScope {
    public:
        explicit PopoverShowOrHideScope(Document& document)
            : m_document(document) { ++m_document->m_popoverShowOrHideDepth; }
        ~PopoverShowOrHideScope() { ASSERT(m_document->m_popoverShowOrHideDepth); --m_document->m_popoverShowOrHideDepth; }
    private:
        const Ref<Document> m_document;
    };

    bool contains(const Node& node) const { return this == &node.treeScope() && node.isConnected(); }
    bool contains(const Node* node) const { return node && contains(*node); }

    JSC::VM& vm() const { return m_scriptExecutionContext->vm(); }
    JSC::JSGlobalObject* globalObject() const { return m_scriptExecutionContext->globalObject(); }

    void queueTask(TaskSource, Function<void()>&&);
    void queueMicrotask(Function<void()>&&);
    void performMicrotaskCheckpoint();

    CustomElementQueue& backupElementQueue();

    String debugDescription() const override;

    URL fallbackBaseURL() const;

    bool usesHeadingOffsetAttribute() const { return m_usesHeadingOffsetAttribute; }
    void setUsesHeadingOffsetAttribute() { m_usesHeadingOffsetAttribute = true; }

    // Cache of the first (in tree order) Element with 'attribute'.
    Element* LEGACY_NODELETE cachedFirstElementWithAttribute(const QualifiedName& attribute) const;
    void setCachedFirstElementWithAttribute(const QualifiedName& attribute, Element&);
    void attributeAddedToElement(const QualifiedName& attribute);
    void elementDisconnectedFromDocument(const Element&);

    CachedSetInnerHTML& cachedSetInnerHTML() LIFETIME_BOUND { return m_cachedSetInnerHTML; }
    void updateCachedSetInnerHTML(const String& sourceString, ContainerNode&, Element& contextElement);
    void invalidateCachedSetInnerHTML();

protected:
    WEBCORE_EXPORT Document(ScriptExecutionContext&, const URL&, DocumentClasses = { });

    void clearXMLVersion() { m_xmlVersion = String(); }

private:
    enum class PopoverListType : bool { Auto, Hint };
    void addPopoverToList(PopoverListType, HTMLElement&);
    void removePopoverFromList(PopoverListType, HTMLElement&);

    friend class IgnoreDestructiveWriteCountIncrementer;
    friend class Node;
    friend class ThrowOnDynamicMarkupInsertionCountIncrementer;

    void updateTitleElement(Element& changingTitleElement);

    ExceptionOr<void> write(FixedVector<String>&&, ASCIILiteral lineFeed);

    void detachParser();

    void childrenChanged(const ChildChange&) final;

    String nodeName() const final;
    bool LEGACY_NODELETE childTypeAllowed(NodeType) const final;
    Ref<Node> cloneNodeInternal(Document&, CloningOperation, CustomElementRegistry*) const final;
    ClonedDocumentType LEGACY_NODELETE clonedDocumentType() const;

    void updateTitleFromTitleElement();
    void updateTitle(const String&);
    void updateBaseURL();

    QuerySelectorResults* querySelectorResults(ContainerNode&);
    QuerySelectorResults& ensureQuerySelectorResults(ContainerNode&);

    bool isCookieAverse() const;

    template<CollectionType> Ref<HTMLCollection> ensureCachedCollection();

    void addListenerType(ListenerType listenerType) { m_listenerTypes.add(listenerType); }

    void parentOrShadowHostNode() const = delete; // Call parentNode() instead.

    const Ref<ScriptExecutionContext> m_scriptExecutionContext;
    Window* m_window { nullptr };
    OptionSet<ParserContentPolicy> m_parserContentPolicy;
    RefPtr<DocumentParser> m_parser;

    // Document URLs.
    URL m_url; // Document.URL: The URL from which this document was retrieved.
    URL m_baseURL; // Node.baseURI: The URL to use when resolving relative URLs.
    URL m_baseElementURL; // The URL set by the <base> element.

    AtomString m_baseTarget;

    WeakPtr<HTMLBaseElement, WeakPtrImplWithEventTargetData> m_firstBaseElement;

    // MIME type of the document in case it was cloned or created by XHR.
    String m_overriddenMIMEType;

    const std::unique_ptr<DOMImplementation> m_implementation;
    RefPtr<StyleSheetList> m_styleSheetList;

    RefPtr<Element> m_focusedElement;
    WeakPtr<Element, WeakPtrImplWithEventTargetData> m_focusedFrameOwnerElement; // The frame in this document that has the focus somewhere inside.
    RefPtr<Element> m_documentElement;
    UserActionElementSet m_userActionElements;

    uint64_t m_domTreeVersion { 0 };

    WeakHashSet<NodeIterator> m_nodeIterators;
    HashSet<SingleThreadWeakRef<Range>> m_ranges;

    String m_title;
    String m_rawTitle;
    RefPtr<Element> m_titleElement;

    Vector<Ref<Cookie>> m_cookies;

    WeakPtr<Element, WeakPtrImplWithEventTargetData> m_cssTarget;

    Vector<RefPtr<Element>> m_currentScriptStack;

    String m_xmlEncoding;
    String m_xmlVersion;

    AtomString m_contentLanguage;
    AtomString m_documentElementLanguage;

    WeakHashSet<Element, WeakPtrImplWithEventTargetData> m_elementsWithLangAttrMatchingDocumentElement;

    HashSet<LiveNodeList*> m_listsInvalidatedAtDocument;
    HashSet<HTMLCollection*> m_collectionsInvalidatedAtDocument;
    std::array<unsigned, numNodeListInvalidationTypes> m_nodeListAndCollectionCounts = { };

    std::optional<std::pair<QualifiedName, WeakPtr<Element, WeakPtrImplWithEventTargetData>>> m_cachedFirstElementWithAttribute;

    WeakHashMap<Node, std::unique_ptr<QuerySelectorResults>, WeakPtrImplWithEventTargetData> m_querySelectorResults;

    std::unique_ptr<DocumentSharedObjectPool> m_sharedObjectPool;

    const RefPtr<Document> m_templateDocument;
    WeakPtr<Document, WeakPtrImplWithEventTargetData> m_templateDocumentHost; // Manually managed weakref (backpointer from m_templateDocument).

    RefPtr<DocumentFragment> m_documentFragmentForInnerOuterHTML;

    WeakListHashSet<ShadowRoot, WeakPtrImplWithEventTargetData> m_inDocumentShadowRoots;

    HashMap<uintptr_t, RefPtr<CustomElementRegistry>> m_activeCustomElementConstructorMap;
    HashSet<AtomString> m_customElementUpgradeCandidateLocalNames;

    const std::unique_ptr<CustomElementQueue> m_backupElementQueue;

    OrderedHashSet<Ref<Element>> m_topLayerElements;
    OrderedHashSet<Ref<HTMLElement>> m_autoPopoverList;
    OrderedHashSet<Ref<HTMLElement>> m_hintPopoverList;
    unsigned m_popoverShowOrHideDepth { 0 };

    unsigned m_writeRecursionDepth { 0 };

    unsigned m_disabledFieldsetElementsCount { 0 };
    unsigned m_dataListElementCount { 0 };

    OptionSet<ListenerType> m_listenerTypes;
    MemoryCompactRobinHoodHashMap<AtomString, EventListenerCounts> m_eventListenerCounts;

    unsigned m_referencingNodeCount { 0 };

    // https://html.spec.whatwg.org/multipage/dynamic-markup-insertion.html#throw-on-dynamic-markup-insertion-counter
    unsigned m_throwOnDynamicMarkupInsertionCount { 0 };

    // https://html.spec.whatwg.org/multipage/dynamic-markup-insertion.html#ignore-destructive-writes-counter
    unsigned m_ignoreDestructiveWriteCount { 0 };

    DocumentClasses m_documentClasses;

    TextDirection m_documentElementTextDirection { TextDirection::LTR };

    DesignMode m_designMode { DesignMode::Off };
    ReadyState m_readyState { ReadyState::Complete };

    MutationObserverOptions m_mutationObserverTypes;

    FocusTrigger m_latestFocusTrigger { };

    StandaloneStatus m_xmlStandalone { StandaloneStatus::Unspecified };

    DocumentCompatibilityMode m_compatibilityMode { DocumentCompatibilityMode::NoQuirksMode };

    // Consolidated boolean flags. Keep these together so the compiler packs them into a few
    // bytes instead of one byte-plus-padding each.
    bool m_hasXMLDeclaration : 1 { false };
    bool m_writeRecursionIsTooDeep : 1 { false };
    bool m_wellFormed : 1 { false };
    bool m_processingLoadEvent : 1 { false };
    bool m_bParsing : 1 { false }; // FIXME: rename
    bool m_isDirAttributeDirty : 1 { false };
    bool m_usesHeadingOffsetAttribute : 1 { false };
    bool m_wasRemovedLastRefCalled : 1 { false };
    bool m_processingBackupElementQueue : 1 { false };

    CachedSetInnerHTML m_cachedSetInnerHTML;
}; // class Document

inline bool Document::hasBrowsingContext() const
{
    return !!m_window;
}

WTF::TextStream& operator<<(WTF::TextStream&, const Document&);

} // namespace WebCore

SPECIALIZE_TYPE_TRAITS_BEGIN(WebCore::Document)
    static bool isType(const WebCore::Node& node) { return node.isDocumentNode(); }
    static bool isType(const WebCore::EventTarget& target)
    {
        auto* node = dynamicDowncast<WebCore::Node>(target);
        return node && isType(*node);
    }
SPECIALIZE_TYPE_TRAITS_END()
