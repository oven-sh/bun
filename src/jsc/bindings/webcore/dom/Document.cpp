/*
 * Copyright (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 *           (C) 2001 Dirk Mueller (mueller@kde.org)
 *           (C) 2006 Alexey Proskuryakov (ap@webkit.org)
 * Copyright (C) 2004-2026 Apple Inc. All rights reserved.
 * Copyright (C) 2008, 2009 Torch Mobile Inc. All rights reserved. (http://www.torchmobile.com/)
 * Copyright (C) 2008-2014 Google Inc. All rights reserved.
 * Copyright (C) 2010 Nokia Corporation and/or its subsidiary(-ies)
 * Copyright (C) Research In Motion Limited 2010-2011. All rights reserved.
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
 */

#include "config.h"
#include "Document.h"

#include "Attr.h"
#include "BeforeUnloadEvent.h"
#include "CDATASection.h"
#include "Comment.h"
#include "CommonAtomStrings.h"
#include "ComposedTreeAncestorIterator.h"
#include "CompositionEvent.h"
#include "ContainerNodeInlines.h"
#include "Cookie.h"
#include "CustomElementReactionQueue.h"
#include "CustomElementRegistry.h"
#include "CustomEvent.h"
#include "DOMClientData.h"
#include "DOMImplementation.h"
#include "DocumentFragment.h"
#include "DocumentInlines.h"
#include "DocumentSharedObjectPool.h"
#include "DocumentType.h"
#include "DragEvent.h"
#include "ElementChildIteratorInlines.h"
#include "ElementCreationOptions.h"
#include "ElementInlines.h"
#include "ElementRareData.h"
#include "EmptyHTMLCollection.h"
#include "EventNames.h"
#include "EventTargetInlines.h"
#include "FocusEvent.h"
#include "FocusOptions.h"
#include "GenericCachedHTMLCollection.h"
#include "HTMLAllCollection.h"
#include "HTMLBaseElement.h"
#include "HTMLBodyElement.h"
#include "HTMLCollectionInlines.h"
#include "HTMLDialogElement.h"
#include "HTMLDocument.h"
#include "HTMLDocumentParserFastPath.h"
#include "HTMLElementFactory.h"
#include "HTMLFormControlElement.h"
#include "HTMLFrameElement.h"
#include "HTMLFrameElementBase.h"
#include "HTMLHeadElement.h"
#include "HTMLHtmlElement.h"
#include "HTMLIFrameElement.h"
#include "HTMLMaybeFormAssociatedCustomElement.h"
#include "HTMLNameCollection.h"
#include "HTMLTitleElement.h"
#include "HTMLUnknownElement.h"
#include "HashChangeEvent.h"
#include "ImportNodeOptions.h"
#include "JSCustomElementInterface.h"
#include "JSLazyEventListener.h"
#include "KeyboardEvent.h"
#include "MathMLNames.h"
#include "MessageEvent.h"
#include "MouseEvent.h"
#include "NameNodeList.h"
#include "NameValidation.h"
#include "NestingLevelIncrementer.h"
#include "NodeInlines.h"
#include "NodeIterator.h"
#include "NodeRareData.h"
#include "NodeWithIndex.h"
#include "PopoverData.h"
#include "ProcessingInstruction.h"
#include "Range.h"
#include "SVGElement.h"
#include "SVGElementFactory.h"
#include "SVGNames.h"
#include "ScopedEventQueue.h"
#include "ScriptDisallowedScope.h"
#include "ScriptableDocumentParser.h"
#include "SegmentedString.h"
#include "SelectorQuery.h"
#include "ShadowRoot.h"
#include "StorageEvent.h"
#include "StyleSheetList.h"
#include "TextEvent.h"
#include "TouchEvent.h"
#include "TreeScopeInlines.h"
#include "TreeWalker.h"
#include "TypedElementDescendantIteratorInlines.h"
#include "UIEvent.h"
#include "VisibilityState.h"
#include "Window.h"
#include "XMLDocument.h"
#include "XMLDocumentParser.h"
#include <ranges>
#include <wtf/ASCIICType.h>
#include <wtf/HexNumber.h>
#include <wtf/PlainGregorianDateTime.h>
#include <wtf/TZoneMallocInlines.h>
#include <wtf/WeakRandomNumber.h>
#include <wtf/text/MakeString.h>
#include <wtf/text/StringBuilder.h>
#include <wtf/text/TextStream.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(Document);

using namespace HTMLNames;

static const unsigned cMaxWriteRecursionDepth = 21;

Document::Document(ScriptExecutionContext& context, const URL& url, DocumentClasses documentClasses)
    : ContainerNode(*this, NodeType::Document)
    , TreeScope(*this)
    , m_scriptExecutionContext(context)
    , m_parserContentPolicy(DefaultParserContentPolicy)
    , m_xmlVersion("1.0"_s)
    , m_documentClasses(documentClasses)
    , m_latestFocusTrigger { FocusTrigger::Other }
{
    setEventTargetFlag(EventTargetFlag::IsConnected);

    if (!url.isEmpty())
        setURL(URL { url });

    setUsesNullCustomElementRegistry();
}

Ref<Document> Document::create(Document& contextDocument)
{
    return adoptRef(*new Document(contextDocument.m_scriptExecutionContext, URL(), { }));
}

Document::~Document()
{
    ASSERT(!m_parentTreeScope);
    ASSERT(!m_disabledFieldsetElementsCount);
    ASSERT(m_ranges.isEmpty());
    ASSERT(m_inDocumentShadowRoots.isEmptyIgnoringNullReferences());

    if (m_templateDocument)
        m_templateDocument->setTemplateDocumentHost(nullptr); // balanced in templateDocument().

    removeAllEventListeners();

    // Currently we believe that Document can never outlive the parser.
    // Although the Document may be replaced synchronously, DocumentParsers
    // generally keep at least one reference to an Element which would in turn
    // has a reference to the Document.  If you hit this ASSERT, then that
    // assumption is wrong.  DocumentParser::detach() should ensure that even
    // if the DocumentParser outlives the Document it won't cause badness.
    ASSERT(!m_parser || m_parser->refCount() == 1);
    detachParser();

    // We must call clearRareData() here since a Document class inherits TreeScope
    // as well as Node. See a comment on TreeScope.h for the reason.
    if (hasRareData())
        clearRareData();

    RELEASE_ASSERT_WITH_SECURITY_IMPLICATION(m_listsInvalidatedAtDocument.isEmpty());
    RELEASE_ASSERT_WITH_SECURITY_IMPLICATION(m_collectionsInvalidatedAtDocument.isEmpty());

    for (unsigned count : m_nodeListAndCollectionCounts)
        ASSERT_UNUSED(count, !count);

    RELEASE_ASSERT(!m_referencingNodeCount);
}

void Document::removedLastRef()
{
    RELEASE_ASSERT(m_refCountAndParentBit == s_refCountIncrement);

    ScriptDisallowedScope::InMainThread scriptDisallowedScope;
    ASSERT(!deletionHasBegun());
    m_wasRemovedLastRefCalled = true;

    // FIXME: This condition is usually true, and can probably be unconditional.
    if (m_referencingNodeCount) {
        // We must make sure not to be retaining any of our children through
        // these extra pointers or we will create a reference cycle.
        m_focusedElement = nullptr;
        m_titleElement = nullptr;
        m_documentElement = nullptr;
        m_userActionElements.clear();

        detachParser();

        // removeDetachedChildren() doesn't always unregister IDs,
        // so tear down scope information up front to avoid having
        // stale references in the map.

        destroyTreeScopeData();
        clearQuerySelectorResults();
        removeDetachedChildren();
        RELEASE_ASSERT(m_topLayerElements.isEmpty());
    }

    m_documentFragmentForInnerOuterHTML = nullptr;

    RELEASE_ASSERT_WITH_MESSAGE(m_refCountAndParentBit == s_refCountIncrement,
        "Please do not escape new references to the Document from inside removedLastRef(). "
        "Consider using WeakPtr, or enitrely avoiding new work during teardown.");

    if (m_referencingNodeCount) {
        // Document can be resurrected if m_referencingNodeCount is not 0. When
        // that happens, release the final overlooking ref that deref()
        // maintains, so that refCounting can resume from 0.
        m_refCountAndParentBit -= s_refCountIncrement;
        return;
    }

#if ASSERT_ENABLED
    m_deletionHasBegun = true;
#endif
    delete this;
}

void Document::setMarkupUnsafe(const String& markup, OptionSet<ParserContentPolicy> parserContentPolicy)
{
    ASSERT(!hasChildNodes());
    auto policy = OptionSet<ParserContentPolicy> { ParserContentPolicy::AllowScriptingContent } | parserContentPolicy;
    setParserContentPolicy(policy);
    if (this->contentType() == textHTMLContentTypeAtom()) {
        // The fast path gives up at a doctype, so what it parses is in quirks mode. open() below resets this.
        setCompatibilityMode(DocumentCompatibilityMode::QuirksMode);
        auto html = HTMLHtmlElement::create(*this);
        appendChild(html);
        auto body = HTMLBodyElement::create(*this);
        html->appendChild(body);
        body->beginParsingChildren();
        if (tryFastParsingHTMLFragment(StringView { markup }.substring(markup.find(isNotASCIIWhitespace<char16_t>)), *this, body, body, policy)) [[likely]] {
            body->finishParsingChildren();
            auto head = HTMLHeadElement::create(*this);
            html->insertBefore(head, body.ptr());
            return;
        }
        html->remove();
    }
    open();
    protect(parser())->appendSynchronously(markup.impl());
    close();
}

ExceptionOr<Ref<Document>> Document::parseHTMLUnsafe(Document& context, String&& html)
{
    Ref document = HTMLDocument::create(context.m_scriptExecutionContext, URL { });
    document->setMarkupUnsafe(WTF::move(html), { ParserContentPolicy::AllowDeclarativeShadowRoots });
    return { document };
}

struct QuerySelectorResults {
    WTF_DEPRECATED_MAKE_STRUCT_FAST_ALLOCATED(QuerySelectorResults);
public:
    static constexpr unsigned maxSize = 8;

    struct Entry {
        String selector;
        Variant<Ref<NodeList>, RefPtr<Element>> result;
        AtomString classNameToMatch;
    };

    Entry* find(const String& selector)
    {
        auto index = entries.findIf([&](auto& entry) {
            return entry.selector == selector;
        });
        return index == notFound ? nullptr : &entries[index];
    }

    void add(Entry&& entry)
    {
        if (entries.size() >= maxSize)
            entries.removeAt(weakRandomNumber<uint32_t>() % entries.size());
        entries.append(WTF::move(entry));
    }

    Vector<Entry, maxSize> entries;
};

QuerySelectorResults* Document::querySelectorResults(ContainerNode& context)
{
    ASSERT(context.hasValidQuerySelectorResults() == m_querySelectorResults.contains(context));
    if (!context.hasValidQuerySelectorResults())
        return nullptr;
    return m_querySelectorResults.get(context);
}

QuerySelectorResults& Document::ensureQuerySelectorResults(ContainerNode& context)
{
    return *m_querySelectorResults.ensure(context, [&] {
        context.setHasValidQuerySelectorResults(true);
        return makeUnique<QuerySelectorResults>();
    }).iterator->value;
}

RefPtr<NodeList> Document::resultForSelectorAll(ContainerNode& context, const String& selectorString)
{
    auto* results = querySelectorResults(context);
    if (!results)
        return nullptr;
    auto* entry = results->find(selectorString);
    if (!entry)
        return nullptr;
    if (auto* nodeList = std::get_if<Ref<NodeList>>(&entry->result))
        return nodeList->copyRef();
    return nullptr;
}

void Document::addResultForSelectorAll(ContainerNode& context, const String& selectorString, NodeList& nodeList, const AtomString& classNameToMatch)
{
    auto& results = ensureQuerySelectorResults(context);
    if (auto* entry = results.find(selectorString)) {
        entry->result = nodeList;
        return;
    }
    results.add({ selectorString, nodeList, classNameToMatch });
}

std::optional<Element*> Document::resultForSelector(ContainerNode& context, const String& selectorString)
{
    auto* results = querySelectorResults(context);
    if (!results)
        return std::nullopt;
    auto* entry = results->find(selectorString);
    if (!entry)
        return std::nullopt;
    return WTF::switchOn(entry->result, [](const Ref<NodeList>& nodeList) {
        return downcast<Element>(nodeList->item(0));
    }, [](const RefPtr<Element>& firstElement) {
        return firstElement.get();
    });
}

void Document::addResultForSelector(ContainerNode& context, const String& selectorString, Element* firstElement, const AtomString& classNameToMatch)
{
    auto& results = ensureQuerySelectorResults(context);
    ASSERT(!results.find(selectorString));
    results.add({ selectorString, firstElement, classNameToMatch });
}

void Document::invalidateQuerySelectorResults(Node& startingNode)
{
    if (m_querySelectorResults.isEmptyIgnoringNullReferences())
        return;
    for (RefPtr currentNode = startingNode; currentNode; currentNode = currentNode->parentNode()) {
        if (!currentNode->hasValidQuerySelectorResults())
            continue;
        m_querySelectorResults.remove(*currentNode);
        currentNode->setHasValidQuerySelectorResults(false);
    }
}

void Document::invalidateQuerySelectorResultsForClassAttributeChange(Node& startingNode, const SpaceSplitString& oldClasses, const SpaceSplitString& newClasses)
{
    if (m_querySelectorResults.isEmptyIgnoringNullReferences())
        return;
    for (RefPtr currentNode = startingNode; currentNode; currentNode = currentNode->parentNode()) {
        if (!currentNode->hasValidQuerySelectorResults())
            continue;
        auto it = m_querySelectorResults.find(*currentNode);
        ASSERT(it != m_querySelectorResults.end());
        if (it == m_querySelectorResults.end())
            continue;
        auto& entries = it->value->entries;
        unsigned index = 0;
        while (index < entries.size()) {
            auto& entry = entries[index];
            if (!entry.classNameToMatch.isNull() && oldClasses.contains(entry.classNameToMatch) != newClasses.contains(entry.classNameToMatch))
                entries.removeAt(index);
            else
                ++index;
        }
        if (!entries.size()) {
            m_querySelectorResults.remove(it);
            currentNode->setHasValidQuerySelectorResults(false);
        }
    }
}

void Document::clearQuerySelectorResults()
{
    // The map holds only weak references, so its keyed nodes outlive this clear. Reset their per-node flag too, or a
    // surviving node keeps claiming valid cached results after its entry is gone, asserting in the invalidation path
    // (invalidateQuerySelectorResultsForClassAttributeChange) when it looks up an entry the clear already removed.
    for (auto entry : m_querySelectorResults)
        entry.key.setHasValidQuerySelectorResults(false);
    m_querySelectorResults.clear();
}

ExceptionOr<SelectorQuery&> Document::selectorQueryForString(const String& selectorString)
{
    if (selectorString.isEmpty())
        return Exception { ExceptionCode::SyntaxError, makeString('\'', selectorString, "' is not a valid selector."_s) };

    auto* query = domClientData(vm()).selectorQueryCache().add(selectorString, *this);
    if (!query)
        return Exception { ExceptionCode::SyntaxError, makeString('\'', selectorString, "' is not a valid selector."_s) };

    return *query;
}

void Document::setCompatibilityMode(DocumentCompatibilityMode mode)
{
    m_compatibilityMode = mode;
}

String Document::compatMode() const
{
    return inQuirksMode() ? "BackCompat"_s : "CSS1Compat"_s;
}

DOMImplementation& Document::implementation()
{
    if (!m_implementation)
        lazyInitialize(m_implementation, makeUniqueWithoutRefCountedCheck<DOMImplementation>(*this));
    return *m_implementation;
}

StyleSheetList& Document::styleSheets()
{
    if (!m_styleSheetList)
        m_styleSheetList = StyleSheetList::create(*this);
    return *m_styleSheetList;
}

DocumentType* Document::doctype() const
{
    for (Node* node = firstChild(); node; node = node->nextSibling()) {
        if (auto* documentType = dynamicDowncast<DocumentType>(node))
            return documentType;
    }
    return nullptr;
}

void Document::childrenChanged(const ChildChange& change)
{
    ContainerNode::childrenChanged(change);

    RefPtr newDocumentElement = childrenOfType<Element>(*this).first();
    if (newDocumentElement == m_documentElement)
        return;
    m_documentElement = WTF::move(newDocumentElement);
    setDocumentElementLanguage(m_documentElement ? protect(m_documentElement)->langFromAttribute() : nullAtom());
    CheckedPtr htmlDocumentElement = dynamicDowncast<HTMLElement>(m_documentElement.get());
    setDocumentElementTextDirection(htmlDocumentElement && htmlDocumentElement->usesEffectiveTextDirection()
        ? htmlDocumentElement->effectiveTextDirection() : TextDirection::LTR);
}

static ALWAYS_INLINE CustomElementNameValidationStatus validateCustomElementNameWithoutCheckingStandardElementNames(const AtomString&);
static ALWAYS_INLINE bool isStandardElementName(const AtomString& localName);

static ALWAYS_INLINE Ref<HTMLElement> createUpgradeCandidateElement(Document& document, CustomElementRegistry* registry, const QualifiedName& name)
{
    ASSERT(!isStandardElementName(name.localName())); // HTMLTagNames.in lists builtin SVG/MathML elements with "-" in their names explicitly as HTMLUnknownElement.

    if (validateCustomElementNameWithoutCheckingStandardElementNames(name.localName()) != CustomElementNameValidationStatus::Valid) {
        Ref element = HTMLUnknownElement::create(name, document);
        if (!registry && document.usesNullCustomElementRegistry())
            element->setUsesNullCustomElementRegistry();
        return element;
    }

    Ref element = HTMLMaybeFormAssociatedCustomElement::create(name, document);
    element->setIsCustomElementUpgradeCandidate();

    return element;
}

static ALWAYS_INLINE Ref<HTMLElement> createUpgradeCandidateElement(Document& document, CustomElementRegistry* registry, const AtomString& localName)
{
    return createUpgradeCandidateElement(document, registry, QualifiedName { nullAtom(), localName, xhtmlNamespaceURI });
}

template<typename NameType>
static ExceptionOr<Ref<Element>> createHTMLElementWithNameValidation(Document& document, const NameType& name, CustomElementRegistry* registry)
{
    RefPtr element = HTMLElementFactory::createKnownElement(name, document);
    if (element) [[likely]]
        return Ref<Element> { element.releaseNonNull() };

    if (!registry)
        registry = document.customElementRegistry();

    if (registry) {
        if (RefPtr elementInterface = registry->findInterface(name))
            return elementInterface->constructElementWithFallback(document, *registry, name);
    }

    if (!NameValidation::isValidElementName(name)) [[unlikely]]
        return Exception { ExceptionCode::InvalidCharacterError };

    return Ref<Element> { createUpgradeCandidateElement(document, registry, name) };
}

ExceptionOr<Ref<Element>> Document::createElementForBindings(const AtomString& name, Variant<String, ElementCreationOptions>&& argument)
{
    Ref document = *this;
    RefPtr<CustomElementRegistry> registry;
    bool shouldUseNullRegistry = usesNullCustomElementRegistry();
    if (auto* options = std::get_if<ElementCreationOptions>(&argument)) {
        auto optionalRegistry = options->customElementRegistry;
        if (optionalRegistry) [[unlikely]] {
            registry = *optionalRegistry;
            shouldUseNullRegistry = !registry;
            if (registry && !registry->isScoped() && registry != document->customElementRegistry())
                return Exception { ExceptionCode::NotSupportedError };
        }
    }

    auto result = [&]() -> ExceptionOr<Ref<Element>> {
        if (document->isHTMLDocument())
            return createHTMLElementWithNameValidation(document, name.convertToASCIILowercase(), registry.get());

        if (document->isXHTMLDocument())
            return createHTMLElementWithNameValidation(document, name, registry.get());

        if (!NameValidation::isValidElementName(name))
            return Exception { ExceptionCode::InvalidCharacterError, makeString("Invalid qualified name: '"_s, name, '\'') };

        return createElement(QualifiedName(nullAtom(), name, nullAtom()), false, registry.get());
    }();

    if (result.hasException())
        return result;
    Ref element = result.releaseReturnValue();
    if (registry && registry->isScoped()) [[unlikely]] {
        CustomElementRegistry::addToScopedCustomElementRegistryMap(element, *registry);
        return element;
    }
    if (shouldUseNullRegistry) [[unlikely]]
        element->setUsesNullCustomElementRegistry();
    return element;
}

ExceptionOr<Ref<Element>> Document::createElementForBindings(const AtomString& name)
{
    return createElementForBindings(name, { });
}

Ref<DocumentFragment> Document::createDocumentFragment()
{
    return DocumentFragment::create(*this);
}

Ref<Text> Document::createTextNode(String&& data)
{
    return Text::create(*this, WTF::move(data));
}

Ref<Comment> Document::createComment(String&& data)
{
    return Comment::create(*this, WTF::move(data));
}

ExceptionOr<Ref<CDATASection>> Document::createCDATASection(String&& data)
{
    if (isHTMLDocument())
        return Exception { ExceptionCode::NotSupportedError };

    if (data.contains("]]>"_s))
        return Exception { ExceptionCode::InvalidCharacterError };

    return CDATASection::create(*this, WTF::move(data));
}

ExceptionOr<Ref<ProcessingInstruction>> Document::createProcessingInstruction(String&& target, String&& data)
{
    if (!NameValidation::isValidXMLName(target))
        return Exception { ExceptionCode::InvalidCharacterError, makeString("Invalid processing instruction target: '"_s, target, '\'') };

    if (data.contains("?>"_s))
        return Exception { ExceptionCode::InvalidCharacterError };

    return ProcessingInstruction::create(*this, WTF::move(target), WTF::move(data));
}

ExceptionOr<Ref<Node>> Document::importNode(Node& nodeToImport, Variant<bool, ImportNodeOptions>&& argument)
{
    bool subtree = false;
    RefPtr<CustomElementRegistry> registry;
    if (std::holds_alternative<ImportNodeOptions>(argument)) {
        auto options = std::get<ImportNodeOptions>(argument);
        subtree = !options.selfOnly;
        registry = WTF::move(options.customElementRegistry);
        if (registry && !registry->isScoped() && registry != customElementRegistry())
            return Exception { ExceptionCode::NotSupportedError };
    } else if (std::get<bool>(argument))
        subtree = true;
    if (!registry)
        registry = customElementRegistry();
    switch (nodeToImport.nodeType()) {
    case NodeType::DocumentFragment:
        if (nodeToImport.isShadowRoot())
            break;
        [[fallthrough]];
    case NodeType::Element:
    case NodeType::Text:
    case NodeType::CDATASection:
    case NodeType::ProcessingInstruction:
    case NodeType::Comment:
        return nodeToImport.cloneNodeInternal(*this, subtree ? Node::CloningOperation::Everything : Node::CloningOperation::SelfOnly, registry.get());

    case NodeType::Attribute: {
        auto& attribute = uncheckedDowncast<Attr>(nodeToImport);
        return Ref<Node> { Attr::create(protect(documentScope()), attribute.qualifiedName(), attribute.value()) };
    }
    case NodeType::Document: // Can't import a document into another document.
    case NodeType::DocumentType: // FIXME: Support cloning a DocumentType node per DOM4.
        break;
    }
    return Exception { ExceptionCode::NotSupportedError };
}

ExceptionOr<Ref<Node>> Document::adoptNode(Node& source)
{
    EventQueueScope scope;

    switch (source.nodeType()) {
    case NodeType::Document:
        return Exception { ExceptionCode::NotSupportedError };
    case NodeType::Attribute: {
        auto& attr = uncheckedDowncast<Attr>(source);
        if (RefPtr element = attr.ownerElement()) {
            auto result = element->removeAttributeNode(attr);
            if (result.hasException())
                return result.releaseException();
        }
        break;
    }
    default:
        if (source.isShadowRoot()) {
            // ShadowRoot cannot disconnect itself from the host node.
            return Exception { ExceptionCode::HierarchyRequestError };
        }
        auto result = source.remove();
        if (result.hasException())
            return result.releaseException();
        RELEASE_ASSERT(!source.isConnected());
        RELEASE_ASSERT(!source.parentNode());
    }

    source.setTreeScopeRecursively(*this);

    return Ref<Node> { source };
}

static Ref<HTMLElement> createFallbackHTMLElement(Document& document, CustomElementRegistry* registry, const QualifiedName& name)
{
    if (registry) {
        if (RefPtr elementInterface = registry->findInterface(name)) {
            Ref element = elementInterface->createElement(document);
            element->setIsCustomElementUpgradeCandidate();
            element->enqueueToUpgrade(*elementInterface);
            return element;
        }
    }
    // FIXME: Should we also check the equality of prefix between the custom element and name?
    return createUpgradeCandidateElement(document, registry, name);
}

// FIXME: This should really be in a possible ElementFactory class.
Ref<Element> Document::createElement(const QualifiedName& name, bool createdByParser, CustomElementRegistry* registry)
{
    RefPtr<Element> element;

    // FIXME: Use registered namespaces and look up in a hash to find the right factory.
    if (name.namespaceURI() == xhtmlNamespaceURI) {
        element = HTMLElementFactory::createKnownElement(name, *this, createdByParser);
        if (!element) [[unlikely]]
            element = createFallbackHTMLElement(*this, registry, name);
    } else if (name.namespaceURI() == SVGNames::svgNamespaceURI)
        element = SVGElementFactory::createElement(name, *this, createdByParser);
    else
        element = Element::create(name, *this);

    if (registry && registry->isScoped()) [[unlikely]]
        CustomElementRegistry::addToScopedCustomElementRegistryMap(*element, *registry);

    if (!registry && usesNullCustomElementRegistry())
        element->setUsesNullCustomElementRegistry();

    // <image> uses imgTag so we need a special rule.
    ASSERT((name.matches(imageTag) && element->tagQName().matches(imgTag) && element->tagQName().prefix() == name.prefix()) || name == element->tagQName());

    return element.releaseNonNull();
}

// https://html.spec.whatwg.org/#valid-custom-element-name

struct UnicodeCodePointRange {
    char32_t minimum;
    char32_t maximum;
};

#if ASSERT_ENABLED

static inline bool LEGACY_NODELETE operator<(const UnicodeCodePointRange& a, const UnicodeCodePointRange& b)
{
    ASSERT(a.minimum <= a.maximum);
    ASSERT(b.minimum <= b.maximum);
    return a.maximum < b.minimum;
}

#endif // ASSERT_ENABLED

static inline bool LEGACY_NODELETE operator<(const UnicodeCodePointRange& a, char32_t b)
{
    ASSERT(a.minimum <= a.maximum);
    return a.maximum < b;
}

static inline bool LEGACY_NODELETE operator<(char32_t a, const UnicodeCodePointRange& b)
{
    ASSERT(b.minimum <= b.maximum);
    return a < b.minimum;
}

CustomElementRegistry* Document::effectiveGlobalCustomElementRegistry()
{
    if (!customElementRegistry() || customElementRegistry()->isScoped())
        return nullptr;
    return customElementRegistry();
}

static inline bool isPotentialCustomElementNameCharacter(char32_t character)
{
    static constexpr auto ranges = WTF::toArray<UnicodeCodePointRange>({
        { '-', '.' },
        { '0', '9' },
        { '_', '_' },
        { 'a', 'z' },
        { 0xB7, 0xB7 },
        { 0xC0, 0xD6 },
        { 0xD8, 0xF6 },
        { 0xF8, 0x37D },
        { 0x37F, 0x1FFF },
        { 0x200C, 0x200D },
        { 0x203F, 0x2040 },
        { 0x2070, 0x218F },
        { 0x2C00, 0x2FEF },
        { 0x3001, 0xD7FF },
        { 0xF900, 0xFDCF },
        { 0xFDF0, 0xFFFD },
        { 0x10000, 0xEFFFF },
    });

    ASSERT(std::is_sorted(std::begin(ranges), std::end(ranges)));
    return std::binary_search(std::begin(ranges), std::end(ranges), character);
}

enum class CustomElementNameCharacterKind : uint8_t {
    Invalid,
    Valid,
    Hyphen,
    Upper,
};

static ALWAYS_INLINE CustomElementNameCharacterKind LEGACY_NODELETE customElementNameCharacterKind(Latin1Character character)
{
    using Kind = CustomElementNameCharacterKind;
    static constexpr std::array<Kind, 256> table {
        Kind::Invalid, Kind::Invalid, Kind::Invalid, Kind::Invalid, Kind::Invalid, Kind::Invalid, Kind::Invalid, Kind::Invalid,
        Kind::Invalid, Kind::Invalid, Kind::Invalid, Kind::Invalid, Kind::Invalid, Kind::Invalid, Kind::Invalid, Kind::Invalid,
        Kind::Invalid, Kind::Invalid, Kind::Invalid, Kind::Invalid, Kind::Invalid, Kind::Invalid, Kind::Invalid, Kind::Invalid,
        Kind::Invalid, Kind::Invalid, Kind::Invalid, Kind::Invalid, Kind::Invalid, Kind::Invalid, Kind::Invalid, Kind::Invalid,
        Kind::Invalid, Kind::Invalid, Kind::Invalid, Kind::Invalid, Kind::Invalid, Kind::Invalid, Kind::Invalid, Kind::Invalid,
        Kind::Invalid, Kind::Invalid, Kind::Invalid, Kind::Invalid, Kind::Invalid, Kind::Hyphen,  Kind::Valid,   Kind::Invalid, // -, .
        Kind::Valid,   Kind::Valid,   Kind::Valid,   Kind::Valid,   Kind::Valid,   Kind::Valid,   Kind::Valid,   Kind::Valid,   // 0-7
        Kind::Valid,   Kind::Valid,   Kind::Invalid, Kind::Invalid, Kind::Invalid, Kind::Invalid, Kind::Invalid, Kind::Invalid, // 8-9
        Kind::Invalid, Kind::Upper,   Kind::Upper,   Kind::Upper,   Kind::Upper,   Kind::Upper,   Kind::Upper,   Kind::Upper,   // @, A-G
        Kind::Upper,   Kind::Upper,   Kind::Upper,   Kind::Upper,   Kind::Upper,   Kind::Upper,   Kind::Upper,   Kind::Upper,   // H-O
        Kind::Upper,   Kind::Upper,   Kind::Upper,   Kind::Upper,   Kind::Upper,   Kind::Upper,   Kind::Upper,   Kind::Upper,   // P-W
        Kind::Upper,   Kind::Upper,   Kind::Upper,   Kind::Invalid, Kind::Invalid, Kind::Invalid, Kind::Invalid, Kind::Valid,   // X-Z, _
        Kind::Invalid, Kind::Valid,   Kind::Valid,   Kind::Valid,   Kind::Valid,   Kind::Valid,   Kind::Valid,   Kind::Valid,   // a-g
        Kind::Valid,   Kind::Valid,   Kind::Valid,   Kind::Valid,   Kind::Valid,   Kind::Valid,   Kind::Valid,   Kind::Valid,   // h-o
        Kind::Valid,   Kind::Valid,   Kind::Valid,   Kind::Valid,   Kind::Valid,   Kind::Valid,   Kind::Valid,   Kind::Valid,   // p-w
        Kind::Valid,   Kind::Valid,   Kind::Valid,   Kind::Invalid, Kind::Invalid, Kind::Invalid, Kind::Invalid, Kind::Invalid, // x-z
        Kind::Invalid, Kind::Invalid, Kind::Invalid, Kind::Invalid, Kind::Invalid, Kind::Invalid, Kind::Invalid, Kind::Invalid,
        Kind::Invalid, Kind::Invalid, Kind::Invalid, Kind::Invalid, Kind::Invalid, Kind::Invalid, Kind::Invalid, Kind::Invalid,
        Kind::Invalid, Kind::Invalid, Kind::Invalid, Kind::Invalid, Kind::Invalid, Kind::Invalid, Kind::Invalid, Kind::Invalid,
        Kind::Invalid, Kind::Invalid, Kind::Invalid, Kind::Invalid, Kind::Invalid, Kind::Invalid, Kind::Invalid, Kind::Invalid,
        Kind::Invalid, Kind::Invalid, Kind::Invalid, Kind::Invalid, Kind::Invalid, Kind::Invalid, Kind::Invalid, Kind::Invalid,
        Kind::Invalid, Kind::Invalid, Kind::Invalid, Kind::Invalid, Kind::Invalid, Kind::Invalid, Kind::Invalid, Kind::Invalid,
        Kind::Invalid, Kind::Invalid, Kind::Invalid, Kind::Invalid, Kind::Invalid, Kind::Invalid, Kind::Invalid, Kind::Valid,   // xB7
        Kind::Invalid, Kind::Invalid, Kind::Invalid, Kind::Invalid, Kind::Invalid, Kind::Invalid, Kind::Invalid, Kind::Invalid,
        Kind::Valid,   Kind::Valid,   Kind::Valid,   Kind::Valid,   Kind::Valid,   Kind::Valid,   Kind::Valid,   Kind::Valid,   // xC0-xC7
        Kind::Valid,   Kind::Valid,   Kind::Valid,   Kind::Valid,   Kind::Valid,   Kind::Valid,   Kind::Valid,   Kind::Valid,   // xC8-xCF
        Kind::Valid,   Kind::Valid,   Kind::Valid,   Kind::Valid,   Kind::Valid,   Kind::Valid,   Kind::Valid,   Kind::Invalid, // xD0-xD6
        Kind::Valid,   Kind::Valid,   Kind::Valid,   Kind::Valid,   Kind::Valid,   Kind::Valid,   Kind::Valid,   Kind::Valid,   // xD8-xDF
        Kind::Valid,   Kind::Valid,   Kind::Valid,   Kind::Valid,   Kind::Valid,   Kind::Valid,   Kind::Valid,   Kind::Valid,   // xE0-xE7
        Kind::Valid,   Kind::Valid,   Kind::Valid,   Kind::Valid,   Kind::Valid,   Kind::Valid,   Kind::Valid,   Kind::Valid,   // xE8-xEF
        Kind::Valid,   Kind::Valid,   Kind::Valid,   Kind::Valid,   Kind::Valid,   Kind::Valid,   Kind::Valid,   Kind::Invalid, // xF0-xF6
        Kind::Valid,   Kind::Valid,   Kind::Valid,   Kind::Valid,   Kind::Valid,   Kind::Valid,   Kind::Valid,   Kind::Valid,   // xF8-xFF
    };
    return table[character];
}

static ALWAYS_INLINE CustomElementNameValidationStatus validateCustomElementNameWithoutCheckingStandardElementNames(const AtomString& localName)
{
    if (!isASCIILower(localName[0]))
        return CustomElementNameValidationStatus::FirstCharacterIsNotLowercaseASCIILetter;

    bool containsHyphen = false;
    if (localName.is8Bit()) [[likely]] {
        for (auto character : localName.string().span8()) {
            switch (customElementNameCharacterKind(character)) {
            case CustomElementNameCharacterKind::Invalid:
                return CustomElementNameValidationStatus::ContainsDisallowedCharacter;
            case CustomElementNameCharacterKind::Valid:
                break;
            case CustomElementNameCharacterKind::Hyphen:
                containsHyphen = true;
                break;
            case CustomElementNameCharacterKind::Upper:
                return CustomElementNameValidationStatus::ContainsUppercaseASCIILetter;
            }
        }
    } else {
        for (auto character : StringView(localName).codePoints()) {
            if (isASCIIUpper(character))
                return CustomElementNameValidationStatus::ContainsUppercaseASCIILetter;
            if (!isPotentialCustomElementNameCharacter(character))
                return CustomElementNameValidationStatus::ContainsDisallowedCharacter;
            if (character == '-')
                containsHyphen = true;
        }
    }

    if (!containsHyphen)
        return CustomElementNameValidationStatus::ContainsNoHyphen;

    return CustomElementNameValidationStatus::Valid;
}

static ALWAYS_INLINE bool isStandardElementName(const AtomString& localName)
{
    return localName == SVGNames::font_faceTag->localName()
        || localName == SVGNames::font_face_formatTag->localName()
        || localName == SVGNames::font_face_nameTag->localName()
        || localName == SVGNames::font_face_srcTag->localName()
        || localName == SVGNames::font_face_uriTag->localName()
        || localName == SVGNames::missing_glyphTag->localName()
        || localName == MathMLNames::annotation_xmlTag->localName()
        || localName == "color-profile"_s;
}

CustomElementNameValidationStatus Document::validateCustomElementName(const AtomString& localName)
{
    auto result = validateCustomElementNameWithoutCheckingStandardElementNames(localName);
    if (result != CustomElementNameValidationStatus::Valid)
        return result;

    if (isStandardElementName(localName))
        return CustomElementNameValidationStatus::ConflictsWithStandardElementName;

    return CustomElementNameValidationStatus::Valid;
}

CustomElementRegistry* Document::activeCustomElementConstructorRegistry(JSC::JSObject* constructor)
{
    return m_activeCustomElementConstructorMap.get(reinterpret_cast<uintptr_t>(constructor));
}

void Document::addToActiveCustomElementConstructorMap(JSC::JSObject* constructor, CustomElementRegistry& registry)
{
    m_activeCustomElementConstructorMap.set(reinterpret_cast<uintptr_t>(constructor), registry);
}

void Document::removeFromActiveCustomElementConstructorMap(JSC::JSObject* constructor)
{
    m_activeCustomElementConstructorMap.remove(reinterpret_cast<uintptr_t>(constructor));
}

ExceptionOr<Ref<Element>> Document::createElementNS(const AtomString& namespaceURI, const AtomString& qualifiedName, Variant<String, ElementCreationOptions>&& argument)
{
    Ref document = *this;
    RefPtr<CustomElementRegistry> registry;
    bool shouldUseNullRegistry = usesNullCustomElementRegistry();
    if (auto* options = std::get_if<ElementCreationOptions>(&argument)) {
        auto optionalRegistry = options->customElementRegistry;
        if (optionalRegistry) [[unlikely]] {
            registry = *optionalRegistry;
            shouldUseNullRegistry = !registry;
            if (registry && !registry->isScoped() && registry != document->customElementRegistry())
                return Exception { ExceptionCode::NotSupportedError };
        }
    }

    auto opportunisticallyMatchedBuiltinElement = ([&]() -> RefPtr<Element> {
        if (namespaceURI == xhtmlNamespaceURI)
            return HTMLElementFactory::createKnownElement(qualifiedName, document, /* createdByParser */ false);
        return nullptr;
    })();

    auto result = [&]() -> ExceptionOr<Ref<Element>> {
        if (opportunisticallyMatchedBuiltinElement) [[likely]]
            return opportunisticallyMatchedBuiltinElement.releaseNonNull();

        auto parseResult = NameValidation::parseQualifiedElementName(namespaceURI, qualifiedName);
        if (parseResult.hasException())
            return parseResult.releaseException();
        QualifiedName parsedName { parseResult.releaseReturnValue() };
        if (!NameValidation::hasValidNamespaceForElements(parsedName))
            return Exception { ExceptionCode::NamespaceError };

        if (parsedName.namespaceURI() == xhtmlNamespaceURI)
            return createHTMLElementWithNameValidation(document, parsedName, registry.get());

        return createElement(parsedName, false, registry.get());
    }();

    if (result.hasException())
        return result;
    Ref element = result.releaseReturnValue();
    if (registry && registry->isScoped()) [[unlikely]] {
        CustomElementRegistry::addToScopedCustomElementRegistryMap(element, *registry);
        return element;
    }
    if (shouldUseNullRegistry) [[unlikely]]
        element->setUsesNullCustomElementRegistry();
    return element;
}

ExceptionOr<Ref<Element>> Document::createElementNS(const AtomString& namespaceURI, const AtomString& qualifiedName)
{
    return createElementNS(namespaceURI, qualifiedName, { });
}

void Document::setReadyState(ReadyState readyState)
{
    if (readyState == m_readyState)
        return;

    m_readyState = readyState;

    if (m_window)
        dispatchEvent(Event::create(eventNames().readystatechangeEvent, Event::CanBubble::No, Event::IsCancelable::No));
}

void Document::setContentLanguage(const AtomString& language)
{
    m_contentLanguage = language;
}

const AtomString& Document::effectiveDocumentElementLanguage() const
{
    if (!m_documentElementLanguage.isNull())
        return m_documentElementLanguage;
    return m_contentLanguage;
}

void Document::setDocumentElementLanguage(const AtomString& language)
{
    if (m_documentElementLanguage == language)
        return;

    auto oldEffectiveDocumentElementLangauge = effectiveDocumentElementLanguage();
    m_documentElementLanguage = language;

    if (oldEffectiveDocumentElementLangauge != effectiveDocumentElementLanguage()) {
        for (Ref element : std::exchange(m_elementsWithLangAttrMatchingDocumentElement, { }))
            element->updateEffectiveLangStateAndPropagateToDescendants();
    }
}

ExceptionOr<void> Document::setXMLVersion(const String& version)
{
    if (version != "1.0"_s)
        return Exception { ExceptionCode::NotSupportedError };

    m_xmlVersion = version;
    return { };
}

void Document::setXMLStandalone(bool standalone)
{
    m_xmlStandalone = standalone ? StandaloneStatus::Standalone : StandaloneStatus::NotStandalone;
}

String Document::suggestedMIMEType() const
{
    if (isXHTMLDocument())
        return applicationXHTMLContentTypeAtom();
    if (isSVGDocument())
        return imageSVGContentTypeAtom();
    if (xmlStandalone())
        return textXMLContentTypeAtom();
    if (isHTMLDocument())
        return textHTMLContentTypeAtom();
    return String();
}

void Document::overrideMIMEType(const String& mimeType)
{
    m_overriddenMIMEType = mimeType;
}

String Document::contentType() const
{
    if (!m_overriddenMIMEType.isNull())
        return m_overriddenMIMEType;

    String mimeType = suggestedMIMEType();
    if (!mimeType.isNull())
        return mimeType;

    return "application/xml"_s;
}

RefPtr<Element> Document::scrollingElementForAPI()
{
    return scrollingElement();
}

RefPtr<Element> Document::scrollingElement()
{
    // See https://drafts.csswg.org/cssom-view/#dom-document-scrollingelement.
    // The scrollingElement attribute, on getting, must run these steps:
    // 1. If the Document is in quirks mode, follow these substeps:
    if (inQuirksMode()) {
        // 1. If the HTML body element exists, and it is not potentially scrollable, return the
        // HTML body element and abort these steps.
        // 2. Return null and abort these steps.
        return body();
    }

    // 2. If there is a root element, return the root element and abort these steps.
    // 3. Return null.
    return documentElement();
}

static String canonicalizedTitle(const String& title)
{
    // Collapse runs of HTML spaces into single space characters.
    // Strip leading and trailing spaces.

    StringBuilder builder;

    bool previousCharacterWasHTMLSpace = false;
    for (auto character : StringView { title }.codeUnits()) {
        if (isASCIIWhitespace(character))
            previousCharacterWasHTMLSpace = true;
        else {
            if (previousCharacterWasHTMLSpace && !builder.isEmpty())
                builder.append(' ');
            builder.append(character);
            previousCharacterWasHTMLSpace = false;
        }
    }

    return builder == title ? title : builder.toString();
}

void Document::updateTitle(const String& title)
{
    if (m_rawTitle == title)
        return;

    m_rawTitle = title;

    m_title = canonicalizedTitle(title);
}

void Document::updateTitleFromTitleElement()
{
    if (!m_titleElement) {
        updateTitle({ });
        return;
    }

    if (RefPtr htmlTitle = dynamicDowncast<HTMLTitleElement>(*m_titleElement))
        updateTitle(htmlTitle->text());
}

void Document::setTitle(String&& title)
{
    if (is<HTMLElement>(documentElement())) {
        if (!m_titleElement) {
            RefPtr headElement = head();
            if (!headElement)
                return;
            Ref titleElement = HTMLTitleElement::create(HTMLNames::titleTag, *this);
            m_titleElement = titleElement.copyRef();
            headElement->appendChild(titleElement);
        }

        // appendChild above may have run scripts which removed m_titleElement.
        if (!m_titleElement)
            return;

        protect(m_titleElement)->setTextContent(WTF::move(title));
    }
}

template<typename> struct TitleTraits;

template<> struct TitleTraits<HTMLTitleElement> {
    static bool LEGACY_NODELETE isInEligibleLocation(HTMLTitleElement& element) { return element.isConnected() && !element.isInShadowTree(); }
    static HTMLTitleElement* LEGACY_NODELETE findTitleElement(Document& document) { return descendantsOfType<HTMLTitleElement>(document).first(); }
};

template<typename TitleElement> Element* LEGACY_NODELETE selectNewTitleElement(Document& document, Element* oldTitleElement, Element& changingElement)
{
    using Traits = TitleTraits<TitleElement>;

    auto* changingTitleElement = dynamicDowncast<TitleElement>(changingElement);
    if (!changingTitleElement) {
        ASSERT(oldTitleElement == Traits::findTitleElement(document));
        return oldTitleElement;
    }

    if (oldTitleElement)
        return Traits::findTitleElement(document);

    // Optimized common case: We have no title element yet.
    // We can figure out which title element should be used without searching.
    bool isEligible = Traits::isInEligibleLocation(*changingTitleElement);
    auto* newTitleElement = isEligible ? changingTitleElement : nullptr;
    ASSERT(newTitleElement == Traits::findTitleElement(document));
    return newTitleElement;
}

void Document::updateTitleElement(Element& changingTitleElement)
{
    RefPtr newTitleElement = selectNewTitleElement<HTMLTitleElement>(*this, protect(m_titleElement).get(), changingTitleElement);
    if (m_titleElement == newTitleElement)
        return;
    m_titleElement = WTF::move(newTitleElement);
    updateTitleFromTitleElement();
}

void Document::titleElementAdded(Element& titleElement)
{
    if (m_titleElement == &titleElement)
        return;

    updateTitleElement(titleElement);
}

void Document::titleElementRemoved(Element& titleElement)
{
    if (m_titleElement != &titleElement)
        return;

    updateTitleElement(titleElement);
}

void Document::titleElementTextChanged(Element& titleElement)
{
    if (m_titleElement != &titleElement)
        return;

    updateTitleFromTitleElement();
}

VisibilityState Document::visibilityState() const
{
    // https://w3c.github.io/page-visibility/#visibilitystate-attribute
    return m_window ? VisibilityState::Visible : VisibilityState::Hidden;
}

bool Document::hidden() const
{
    return visibilityState() != VisibilityState::Visible;
}

String Document::nodeName() const
{
    return "#document"_s;
}

Ref<Range> Document::createRange()
{
    return Range::create(*this);
}

Ref<NodeIterator> Document::createNodeIterator(Node& root, unsigned long whatToShow, RefPtr<NodeFilter>&& filter, bool)
{
    return NodeIterator::create(root, whatToShow, WTF::move(filter));
}

Ref<TreeWalker> Document::createTreeWalker(Node& root, unsigned long whatToShow, RefPtr<NodeFilter>&& filter, bool)
{
    return TreeWalker::create(root, whatToShow, WTF::move(filter));
}

void Document::removeAllEventListeners()
{
    EventTarget::removeAllEventListeners();

    if (RefPtr window = m_window)
        window->removeAllEventListeners();

    // FIXME: What about disconnected nodes.
    for (RefPtr node = firstChild(); node; node = NodeTraversal::next(*node))
        node->removeAllEventListeners();
}

Ref<DocumentParser> Document::createParser()
{
    return XMLDocumentParser::create(*this, m_parserContentPolicy);
}

ScriptableDocumentParser* Document::scriptableDocumentParser() const
{
    RefPtr parser = this->parser();
    return parser ? parser->asScriptableDocumentParser() : nullptr;
}

HTMLDocumentParser* Document::htmlDocumentParser() const
{
    RefPtr parser = this->parser();
    return parser ? parser->asHTMLDocumentParser() : nullptr;
}

ExceptionOr<Document&> Document::openForBindings(const String&, const String&)
{
    if (!isHTMLDocument() || m_throwOnDynamicMarkupInsertionCount)
        return Exception { ExceptionCode::InvalidStateError };

    auto result = open();
    if (result.hasException()) [[unlikely]]
        return result.releaseException();

    return *this;
}

ExceptionOr<void> Document::open()
{
    if (m_window) {
        if (RefPtr parser = scriptableDocumentParser()) {
            if (parser->isParsing()) {
                // FIXME: HTML5 doesn't tell us to check this, it might not be correct.
                if (parser->isExecutingScript())
                    return { };

                if (!parser->wasCreatedByScript() && parser->hasInsertionPoint())
                    return { };
            }
        }
    }

    removeAllEventListeners();

    implicitOpen();
    if (RefPtr parser = scriptableDocumentParser())
        parser->setWasCreatedByScript(true);

    return { };
}

// https://html.spec.whatwg.org/#fully-active
bool Document::isFullyActive() const
{
    return !!m_window;
}

void Document::detachParser()
{
    if (RefPtr parser = std::exchange(m_parser, nullptr))
        parser->detach();
}

void Document::implicitOpen()
{
    removeChildren();

    setCompatibilityMode(DocumentCompatibilityMode::NoQuirksMode);

    detachParser();
    m_parser = createParser();

    setParsing(true);
    setReadyState(ReadyState::Loading);
}

HTMLBodyElement* Document::body() const
{
    auto* element = documentElement();
    if (!is<HTMLHtmlElement>(element))
        return nullptr;
    return childrenOfType<HTMLBodyElement>(*element).first();
}

HTMLElement* Document::bodyOrFrameset() const
{
    // Return the first body or frameset child of the html element.
    SUPPRESS_UNCHECKED_LOCAL auto* element = documentElement();
    if (!is<HTMLHtmlElement>(element))
        return nullptr;
    for (SUPPRESS_UNCHECKED_LOCAL auto& child : childrenOfType<HTMLElement>(*element)) {
        if (child.hasTagName(bodyTag) || child.hasTagName(framesetTag))
            return &child;
    }
    return nullptr;
}

ExceptionOr<void> Document::setBodyOrFrameset(RefPtr<HTMLElement>&& newBody)
{
    if (!newBody || (!newBody->hasTagName(bodyTag) && !newBody->hasTagName(framesetTag)))
        return Exception { ExceptionCode::HierarchyRequestError };

    RefPtr currentBody = bodyOrFrameset();
    if (newBody == currentBody)
        return { };

    if (!m_documentElement)
        return Exception { ExceptionCode::HierarchyRequestError };

    if (currentBody)
        return protect(documentElement())->replaceChild(*newBody, *currentBody);
    return protect(documentElement())->appendChild(*newBody);
}

HTMLHeadElement* Document::head()
{
    if (auto element = documentElement())
        return childrenOfType<HTMLHeadElement>(*element).first();
    return nullptr;
}

ExceptionOr<void> Document::closeForBindings()
{
    // FIXME: We should follow the specification more closely:
    //        http://www.whatwg.org/specs/web-apps/current-work/#dom-document-close

    if (!isHTMLDocument() || m_throwOnDynamicMarkupInsertionCount)
        return Exception { ExceptionCode::InvalidStateError };

    close();
    return { };
}

void Document::close()
{
    if (!scriptableDocumentParser() || !scriptableDocumentParser()->wasCreatedByScript() || !scriptableDocumentParser()->isParsing())
        return;

    explicitClose();
}

void Document::explicitClose()
{
    if (RefPtr parser = m_parser)
        parser->finish();

    setReadyState(ReadyState::Complete);
    implicitClose();
}

void Document::implicitClose()
{
    bool doload = !parsing() && m_parser && !m_processingLoadEvent;

    if (!doload)
        return;

    // Call to dispatchWindowLoadEvent can blow us from underneath.
    Ref protectedThis { *this };

    m_processingLoadEvent = true;

    RefPtr parser = scriptableDocumentParser();
    m_wellFormed = parser && parser->wellFormed();

    // We have to clear the parser, in case someone document.write()s from the
    // onLoad event handler, as in Radar 3206524.
    detachParser();

    if (RefPtr window = m_window)
        window->scrollToFragment();

    dispatchWindowLoadEvent();

    m_processingLoadEvent = false;
}

void Document::setParsing(bool b)
{
    m_bParsing = b;

    if (m_bParsing && !m_sharedObjectPool)
        m_sharedObjectPool = makeUnique<DocumentSharedObjectPool>();
}

ExceptionOr<void> Document::write(SegmentedString&& text)
{
    if (!isHTMLDocument() || m_throwOnDynamicMarkupInsertionCount)
        return Exception { ExceptionCode::InvalidStateError };

    NestingLevelIncrementer nestingLevelIncrementer(m_writeRecursionDepth);

    m_writeRecursionIsTooDeep = (m_writeRecursionDepth > 1) && m_writeRecursionIsTooDeep;
    m_writeRecursionIsTooDeep = (m_writeRecursionDepth > cMaxWriteRecursionDepth) || m_writeRecursionIsTooDeep;

    if (m_writeRecursionIsTooDeep)
        return { };

    bool hasInsertionPoint = m_parser && m_parser->hasInsertionPoint();
    if (!hasInsertionPoint && m_ignoreDestructiveWriteCount)
        return { };

    if (!hasInsertionPoint) {
        auto result = open();
        if (result.hasException()) [[unlikely]]
            return result.releaseException();
    }

    ASSERT(m_parser);
    protect(parser())->insert(WTF::move(text));
    return { };
}

ExceptionOr<void> Document::write(FixedVector<String>&& strings, ASCIILiteral lineFeed)
{
    SegmentedString text;
    for (auto& string : strings)
        text.append(WTF::move(string));

    text.append(lineFeed);
    return write(WTF::move(text));
}

ExceptionOr<void> Document::write(FixedVector<String>&& strings)
{
    return write(WTF::move(strings), ""_s);
}

ExceptionOr<void> Document::writeln(FixedVector<String>&& strings)
{
    return write(WTF::move(strings), "\n"_s);
}

void Document::setURL(URL&& url)
{
    URL newURL = url.isEmpty() ? aboutBlankURL() : WTF::move(url);
    if (newURL == m_url)
        return;

    m_url = WTF::move(newURL);
    updateBaseURL();
}

const URL& Document::urlForBindings()
{
    return m_url.isEmpty() ? aboutBlankURL() : m_url;
}

// https://html.spec.whatwg.org/#fallback-base-url
URL Document::fallbackBaseURL() const
{
    if (m_url.isAboutSrcDoc()) {
        if (auto* parent = parentDocument())
            return parent->baseURL();
    }

    if (m_url.isAboutBlank()) {
        auto* creator = parentDocument();
        if (!creator && m_window) {
            if (auto* opener = m_window->opener())
                creator = opener->document();
        }
        if (creator)
            return creator->baseURL();
    }

    return m_url;
}

void Document::updateBaseURL()
{
    // DOM 3 Core: When the Document supports the feature "HTML" [DOM Level 2 HTML], the base URI is computed using
    // first the value of the href attribute of the HTML BASE element if any, and the value of the documentURI attribute
    // from the Document interface otherwise.
    if (!m_baseElementURL.isEmpty())
        m_baseURL = m_baseElementURL;
    else
        m_baseURL = fallbackBaseURL();

    if (!m_baseURL.isValid())
        m_baseURL = URL();
}

HTMLBaseElement* Document::firstBaseElement() const
{
    return m_firstBaseElement.get();
}

void Document::processBaseElement()
{
    // Find the first href attribute in a base element and the first target attribute in a base element.
    AtomString href;
    AtomString target;
    RefPtr<HTMLBaseElement> baseElement;
    auto baseDescendants = descendantsOfType<HTMLBaseElement>(*this);
    for (CheckedRef base : baseDescendants) {
        if (!baseElement)
            baseElement = base.get();

        if (href.isNull()) {
            auto& value = base->attributeWithoutSynchronization(hrefAttr);
            if (!value.isNull()) {
                href = value;
                if (!target.isNull())
                    break;
            }
        }
        if (target.isNull()) {
            auto& value = base->attributeWithoutSynchronization(targetAttr);
            if (!value.isNull()) {
                target = value;
                if (!href.isNull())
                    break;
            }
        }
    }

    URL baseElementURL;
    if (!href.isNull())
        baseElementURL = encodingParseURL(href, fallbackBaseURL());
    if (m_baseElementURL != baseElementURL) {
        if (!baseElementURL.isEmpty() && (!baseElementURL.isValid() || baseElementURL.protocolIsData() || baseElementURL.protocolIsJavaScript()))
            m_baseElementURL = { };
        else
            m_baseElementURL = WTF::move(baseElementURL);
        updateBaseURL();
    }

    m_baseTarget = WTF::move(target);
    m_firstBaseElement = WTF::move(baseElement);
}

void Document::processMetaHttpEquiv(const String& equiv, const AtomString& content)
{
    ASSERT(!equiv.isNull());
    ASSERT(!content.isNull());

    if (equalLettersIgnoringASCIICase(equiv, "content-language"_s))
        setContentLanguage(content);
}

// DOM Section 1.1.1
bool Document::childTypeAllowed(NodeType type) const
{
    switch (type) {
    case NodeType::Attribute:
    case NodeType::CDATASection:
    case NodeType::DocumentFragment:
    case NodeType::Document:
    case NodeType::Text:
        return false;
    case NodeType::Comment:
    case NodeType::ProcessingInstruction:
        return true;
    case NodeType::DocumentType:
    case NodeType::Element:
        // Documents may contain no more than one of each of these.
        // (One Element and one DocumentType.)
        for (Node* c = firstChild(); c; c = c->nextSibling())
            if (c->nodeType() == type)
                return false;
        return true;
    }
    return false;
}

bool Document::canAcceptChild(const Node& newChild, const Node* refChild, AcceptChildOperation operation) const
{
    if (operation == AcceptChildOperation::Replace && refChild->parentNode() == this && refChild->nodeType() == newChild.nodeType())
        return true;

    switch (newChild.nodeType()) {
    case NodeType::Attribute:
    case NodeType::CDATASection:
    case NodeType::Document:
    case NodeType::Text:
        return false;
    case NodeType::Comment:
    case NodeType::ProcessingInstruction:
        return true;
    case NodeType::DocumentFragment: {
        bool hasSeenElementChild = false;
        for (auto* node = uncheckedDowncast<DocumentFragment>(newChild).firstChild(); node; node = node->nextSibling()) {
            if (is<Element>(*node)) {
                if (hasSeenElementChild)
                    return false;
                hasSeenElementChild = true;
            }
            if (!canAcceptChild(*node, refChild, operation))
                return false;
        }
        break;
    }
    case NodeType::DocumentType: {
        auto* existingDocType = childrenOfType<DocumentType>(*this).first();
        if (operation == AcceptChildOperation::ReplaceAll)
            break;
        if (operation == AcceptChildOperation::Replace) {
            //  parent has a doctype child that is not child, or an element is preceding child.
            if (existingDocType && existingDocType != refChild)
                return false;
            if (refChild->previousElementSibling())
                return false;
            break;
        }
        ASSERT(operation == AcceptChildOperation::InsertOrAdd);
        if (existingDocType)
            return false;
        if ((refChild && refChild->previousElementSibling()) || (!refChild && firstElementChild()))
            return false;
        break;
    }
    case NodeType::Element: {
        auto* existingElementChild = firstElementChild();
        if (operation == AcceptChildOperation::ReplaceAll)
            break;
        if (operation == AcceptChildOperation::Replace) {
            if (existingElementChild && existingElementChild != refChild)
                return false;
            for (auto* child = refChild->nextSibling(); child; child = child->nextSibling()) {
                if (is<DocumentType>(*child))
                    return false;
            }
            break;
        }
        ASSERT(operation == AcceptChildOperation::InsertOrAdd);
        if (existingElementChild)
            return false;
        for (auto* child = refChild; child; child = child->nextSibling()) {
            if (is<DocumentType>(*child))
                return false;
        }
        break;
    }
    }
    return true;
}

ClonedDocumentType Document::clonedDocumentType() const
{
    if (isXMLDocument()) {
        if (isXHTMLDocument())
            return ClonedDocumentType::XHTMLDocument;
        if (isSVGDocument())
            return ClonedDocumentType::SVGDocument;
        return ClonedDocumentType::XMLDocument;
    }
    if (isHTMLDocument())
        return ClonedDocumentType::HTMLDocument;
    return ClonedDocumentType::Document;
}

Ref<Node> Document::cloneNodeInternal(Document&, CloningOperation type, CustomElementRegistry* registry) const
{
    Ref clone = createCloned(clonedDocumentType(), m_scriptExecutionContext, url(), baseURL(), m_compatibilityMode, m_parserContentPolicy, contentType());
    switch (type) {
    case CloningOperation::SelfOnly:
    case CloningOperation::SelfWithTemplateContent:
        break;
    case CloningOperation::Everything:
        cloneChildNodes(clone, registry, clone);
        break;
    }
    return clone;
}

Ref<Document> Document::createCloned(ClonedDocumentType clonedDocumentType, ScriptExecutionContext& context, const URL& url, const URL& baseURL, DocumentCompatibilityMode compatibilityMode, OptionSet<ParserContentPolicy> parserContentPolicy, const String& contentType)
{
    Ref clone = [&] -> Ref<Document> {
        switch (clonedDocumentType) {
        case ClonedDocumentType::XMLDocument:
            return XMLDocument::create(context, url);
        case ClonedDocumentType::XHTMLDocument:
            return XMLDocument::createXHTML(context, url);
        case ClonedDocumentType::HTMLDocument:
            return HTMLDocument::create(context, url);
        case ClonedDocumentType::SVGDocument:
            return XMLDocument::createSVG(context, url);
        case ClonedDocumentType::Document:
            return create(context, url);
        }
        RELEASE_ASSERT_NOT_REACHED();
    } ();

    ASSERT(clone->m_url == url);
    clone->m_baseURL = baseURL;
    clone->setCompatibilityMode(compatibilityMode);
    clone->setParserContentPolicy(parserContentPolicy);
    clone->overrideMIMEType(contentType);
    return clone;
}

static bool LEGACY_NODELETE isNodeInSubtree(Node& node, Node& container, Document::NodeRemoval nodeRemoval)
{
    if (nodeRemoval == Document::NodeRemoval::ChildrenOfNode)
        return node.isDescendantOf(container);

    return &node == &container || node.isDescendantOf(container);
}

void Document::adjustFocusedNodeOnNodeRemoval(Node& node, NodeRemoval nodeRemoval)
{
    if (!m_focusedElement)
        return;

    RefPtr focusedElement = node.treeScope().focusedElementInScope();
    if (!focusedElement)
        return;

    if (isNodeInSubtree(*focusedElement, node, nodeRemoval))
        setFocusedElement(nullptr, { { }, { }, { }, { }, FocusRemovalEventsMode::DoNotDispatch, { }, { } });
}

bool Document::setFocusedElement(Element* element)
{
    return setFocusedElement(element, { });
}

bool Document::setFocusedElement(Element* newFocusedElement, const FocusOptions& options)
{
    // Make sure newFocusedElement is actually in this document
    if (newFocusedElement && (&newFocusedElement->document() != this))
        return true;

    if (m_focusedElement == newFocusedElement)
        return true;

    RefPtr oldFocusedElement = std::exchange(m_focusedElement, nullptr);

    // Remove focus from the existing focus node (if any)
    if (oldFocusedElement) {
        bool focusChangeBlocked = false;

        oldFocusedElement->setFocus(false);

        if (options.removalEventsMode == FocusRemovalEventsMode::Dispatch) {
            // Dispatch a change event for form control elements that have been edited.
            if (RefPtr formControlElement = dynamicDowncast<HTMLFormControlElement>(*oldFocusedElement)) {
                if (formControlElement->wasChangedSinceLastFormControlChangeEvent())
                    formControlElement->dispatchFormControlChangeEvent();
            }

            // Dispatch the blur event and let the node do any other blur related activities (important for text fields)
            oldFocusedElement->dispatchBlurEvent(newFocusedElement);

            if (m_focusedElement) {
                // handler shifted focus
                focusChangeBlocked = true;
                newFocusedElement = nullptr;
            }

            oldFocusedElement->dispatchFocusOutEventIfNeeded(newFocusedElement); // DOM level 3 bubbling blur event.

            if (m_focusedElement) {
                // handler shifted focus
                focusChangeBlocked = true;
                newFocusedElement = nullptr;
            }
        }

        if (focusChangeBlocked)
            return false;
    }

    auto isNewElementFocusable = [&] {
        if (!newFocusedElement || !newFocusedElement->isConnected())
            return false;
        // Resolving isFocusable() may require matching :focus-within as if the focus was already on the new element.
        newFocusedElement->setHasTentativeFocus(true);
        bool isFocusable = newFocusedElement->isFocusable();
        newFocusedElement->setHasTentativeFocus(false);
        return isFocusable;
    }();

    if (isNewElementFocusable) {
        if (&newFocusedElement->document() != this) {
            // Bluring oldFocusedElement may have moved newFocusedElement across documents.
            return false;
        }
        // The documents above give up their focus, and the frame is their active element.
        for (RefPtr owner = ownerElement(); owner; owner = owner->document().ownerElement()) {
            Ref parent = owner->document();
            parent->setFocusedElement(nullptr);
            parent->m_focusedFrameOwnerElement = owner.get();
        }
        // So do the documents below.
        for (RefPtr frame = dynamicDowncast<HTMLFrameElementBase>(std::exchange(m_focusedFrameOwnerElement, nullptr).get()); frame;) {
            RefPtr content = frame->contentDocument();
            if (!content)
                break;
            frame = dynamicDowncast<HTMLFrameElementBase>(std::exchange(content->m_focusedFrameOwnerElement, nullptr).get());
            content->setFocusedElement(nullptr);
        }
        if (m_focusedElement || &newFocusedElement->document() != this) {
            // handler shifted focus
            return false;
        }

        // Set focus on the new node
        m_focusedElement = newFocusedElement;
        RefPtr focusedElement = m_focusedElement;
        focusedElement->setFocus(true, options.visibility);
        if (options.trigger != FocusTrigger::Bindings)
            m_latestFocusTrigger = options.trigger;

        // The setFocus call triggers a blur and a focus event. Event handlers could cause the focused element to be cleared.
        if (m_focusedElement != focusedElement) {
            // handler shifted focus
            return false;
        }

        // Dispatch the focus event and let the node do any other focus related activities (important for text fields)
        focusedElement->dispatchFocusEvent(oldFocusedElement.copyRef(), options);

        if (m_focusedElement != focusedElement) {
            // handler shifted focus
            return false;
        }

        focusedElement->dispatchFocusInEventIfNeeded(oldFocusedElement.copyRef()); // DOM level 3 bubbling focus event.

        if (m_focusedElement != focusedElement) {
            // handler shifted focus
            return false;
        }
    }

    return true;
}

void Document::setCSSTarget(Element* newTarget)
{
    m_cssTarget = newTarget;
}

void Document::registerNodeListForInvalidation(LiveNodeList& list)
{
    m_nodeListAndCollectionCounts[static_cast<unsigned>(list.invalidationType())]++;
    if (!list.isRootedAtTreeScope())
        return;
    ASSERT(!list.isRegisteredForInvalidationAtDocument());
    list.setRegisteredForInvalidationAtDocument(true);
    m_listsInvalidatedAtDocument.add(&list);
}

void Document::unregisterNodeListForInvalidation(LiveNodeList& list)
{
    m_nodeListAndCollectionCounts[static_cast<unsigned>(list.invalidationType())]--;
    if (!list.isRegisteredForInvalidationAtDocument())
        return;

    list.setRegisteredForInvalidationAtDocument(false);
    ASSERT(m_listsInvalidatedAtDocument.contains(&list));
    m_listsInvalidatedAtDocument.remove(&list);
}

void Document::registerCollection(HTMLCollection& collection)
{
    m_nodeListAndCollectionCounts[static_cast<unsigned>(collection.invalidationType())]++;
    if (collection.isRootedAtTreeScope())
        m_collectionsInvalidatedAtDocument.add(&collection);
}

void Document::unregisterCollection(HTMLCollection& collection)
{
    ASSERT(m_nodeListAndCollectionCounts[static_cast<unsigned>(collection.invalidationType())]);
    m_nodeListAndCollectionCounts[static_cast<unsigned>(collection.invalidationType())]--;
    if (!collection.isRootedAtTreeScope())
        return;

    m_collectionsInvalidatedAtDocument.remove(&collection);
}

void Document::collectionCachedIdNameMap(const HTMLCollection& collection)
{
    ASSERT_UNUSED(collection, collection.hasNamedElementCache());
    m_nodeListAndCollectionCounts[static_cast<unsigned>(NodeListInvalidationType::InvalidateOnIdNameAttrChange)]++;
}

void Document::collectionWillClearIdNameMap(const HTMLCollection& collection)
{
    ASSERT_UNUSED(collection, collection.hasNamedElementCache());
    ASSERT(m_nodeListAndCollectionCounts[static_cast<unsigned>(NodeListInvalidationType::InvalidateOnIdNameAttrChange)]);
    m_nodeListAndCollectionCounts[static_cast<unsigned>(NodeListInvalidationType::InvalidateOnIdNameAttrChange)]--;
}

void Document::attachNodeIterator(NodeIterator& iterator)
{
    m_nodeIterators.add(iterator);
}

void Document::detachNodeIterator(NodeIterator& iterator)
{
    // The node iterator can be detached without having been attached if its root node didn't have a document
    // when the iterator was created, but has it now.
    m_nodeIterators.remove(iterator);
}

void Document::moveNodeIteratorsToNewDocument(Node& node, Document& newDocument)
{
    for (auto& it : copyToVectorOf<Ref<NodeIterator>>(m_nodeIterators)) {
        if (&it->root() == &node) {
            detachNodeIterator(it.get());
            newDocument.attachNodeIterator(it.get());
        }
    }
}

void Document::updateRangesAfterChildrenChanged(ContainerNode& container)
{
    for (auto& range : m_ranges)
        Ref { range.get() }->nodeChildrenChanged(container);
}

void Document::nodeChildrenWillBeRemoved(ContainerNode& container)
{
    ASSERT(ScriptDisallowedScope::InMainThread::hasDisallowedScope());

    adjustFocusedNodeOnNodeRemoval(container, NodeRemoval::ChildrenOfNode);

    for (Ref range : m_ranges)
        range->nodeChildrenWillBeRemoved(container);

    for (Ref it : m_nodeIterators) {
        for (RefPtr n = container.firstChild(); n; n = n->nextSibling())
            it->nodeWillBeRemoved(*n);
    }
}

void Document::nodeWillBeRemoved(Node& node)
{
    ASSERT(ScriptDisallowedScope::InMainThread::hasDisallowedScope());

    adjustFocusedNodeOnNodeRemoval(node);

    for (Ref nodeIterator : m_nodeIterators)
        nodeIterator->nodeWillBeRemoved(node);

    for (auto& range : m_ranges)
        Ref { range.get() }->nodeWillBeRemoved(node);
}

void Document::nodeWillBeMoved(Node& node)
{
    ASSERT(ScriptDisallowedScope::InMainThread::hasDisallowedScope());

    for (Ref nodeIterator : m_nodeIterators)
        nodeIterator->nodeWillBeRemoved(node);

    for (Ref range : m_ranges)
        range->nodeWillBeRemoved(node);
}

void Document::parentlessNodeMovedToNewDocument(Node& node)
{
    Vector<Ref<Range>, 5> rangesAffected;

    for (auto& weakRange : m_ranges) {
        Ref range = weakRange.get();
        if (range->parentlessNodeMovedToNewDocumentAffectsRange(node))
            rangesAffected.append(WTF::move(range));
    }

    for (auto& range : rangesAffected)
        range->updateRangeForParentlessNodeMovedToNewDocument(node);
}

void Document::textInserted(Node& text, unsigned offset, unsigned length)
{
    for (Ref range : m_ranges)
        range->textInserted(text, offset, length);
}

void Document::textRemoved(Node& text, unsigned offset, unsigned length)
{
    for (Ref range : m_ranges)
        range->textRemoved(text, offset, length);
}

void Document::textNodesMerged(Text& oldNode, unsigned offset)
{
    if (!m_ranges.isEmpty()) {
        NodeWithIndex oldNodeWithIndex(oldNode);
        for (auto& range : m_ranges)
            Ref { range.get() }->textNodesMerged(oldNodeWithIndex, offset);
    }
}

void Document::textNodeSplit(Text& oldNode)
{
    for (auto& range : m_ranges)
        Ref { range.get() }->textNodeSplit(oldNode);
}

void Document::setAttributeEventListener(const AtomString& eventType, const QualifiedName& attributeName, const AtomString& attributeValue, DOMWrapperWorld& isolatedWorld)
{
    setAttributeEventListener(eventType, JSLazyEventListener::create(*this, attributeName, attributeValue), isolatedWorld);
}

void Document::setWindowAttributeEventListener(const AtomString& eventType, const QualifiedName& attributeName, const AtomString& attributeValue, DOMWrapperWorld& isolatedWorld)
{
    RefPtr window = m_window;
    if (!window)
        return;
    window->setAttributeEventListener(eventType, JSLazyEventListener::create(*window, attributeName, attributeValue), isolatedWorld);
}

void Document::dispatchWindowEvent(Event& event, EventTarget* target)
{
    ASSERT_WITH_SECURITY_IMPLICATION(ScriptDisallowedScope::InMainThread::isScriptAllowed());
    RefPtr window = m_window;
    if (!window)
        return;

    event.setTarget(target ? target : window.get());
    event.setCurrentTarget(window.get());
    event.setEventPhase(Event::AT_TARGET);
    event.resetBeforeDispatch();
    window->fireEventListeners(event, EventInvokePhase::Capturing);
    window->fireEventListeners(event, EventInvokePhase::Bubbling);
    event.resetAfterDispatch();
}

void Document::dispatchWindowLoadEvent()
{
    ASSERT_WITH_SECURITY_IMPLICATION(ScriptDisallowedScope::InMainThread::isScriptAllowed());
    dispatchWindowEvent(Event::create(eventNames().loadEvent, Event::CanBubble::No, Event::IsCancelable::No), this);

    // Send a separate load event to the element that owns this frame.
    if (RefPtr owner = ownerElement())
        owner->dispatchEvent(Event::create(eventNames().loadEvent, Event::CanBubble::No, Event::IsCancelable::No));
}

ExceptionOr<Ref<Event>> Document::createEvent(const String& type)
{
    // Please do *not* add new event classes to this function unless they are required
    // for compatibility with the DOM specification or some actual legacy web content.

    // This mechanism is superseded by use of event constructors.
    // That is what we should use for any new event classes.

    // The following strings are the ones from the DOM specification
    // <https://dom.spec.whatwg.org/#dom-document-createevent>.

    if (equalLettersIgnoringASCIICase(type, "beforeunloadevent"_s))
        return Ref<Event> { BeforeUnloadEvent::createForBindings() };
    if (equalLettersIgnoringASCIICase(type, "compositionevent"_s))
        return Ref<Event> { CompositionEvent::createForBindings() };
    if (equalLettersIgnoringASCIICase(type, "customevent"_s))
        return Ref<Event> { CustomEvent::create() };
    if (equalLettersIgnoringASCIICase(type, "dragevent"_s))
        return Ref<Event> { DragEvent::createForBindings() };
    if (equalLettersIgnoringASCIICase(type, "event"_s) || equalLettersIgnoringASCIICase(type, "events"_s) || equalLettersIgnoringASCIICase(type, "htmlevents"_s) || equalLettersIgnoringASCIICase(type, "svgevents"_s))
        return Event::createForBindings();
    if (equalLettersIgnoringASCIICase(type, "focusevent"_s))
        return Ref<Event> { FocusEvent::createForBindings() };
    if (equalLettersIgnoringASCIICase(type, "hashchangeevent"_s))
        return Ref<Event> { HashChangeEvent::createForBindings() };
    if (equalLettersIgnoringASCIICase(type, "keyboardevent"_s))
        return Ref<Event> { KeyboardEvent::createForBindings() };
    if (equalLettersIgnoringASCIICase(type, "messageevent"_s))
        return Ref<Event> { MessageEvent::createForBindings() };
    if (equalLettersIgnoringASCIICase(type, "mouseevent"_s) || equalLettersIgnoringASCIICase(type, "mouseevents"_s))
        return Ref<Event> { MouseEvent::createForBindings() };
    if (equalLettersIgnoringASCIICase(type, "storageevent"_s))
        return Ref<Event> { StorageEvent::createForBindings() };
    if (equalLettersIgnoringASCIICase(type, "textevent"_s))
        return Ref<Event> { TextEvent::createForBindings() }; // FIXME: HTML specification says this should create a CompositionEvent, not a TextEvent.
    if (equalLettersIgnoringASCIICase(type, "touchevent"_s))
        return Ref<Event> { TouchEvent::createForBindings() };
    if (equalLettersIgnoringASCIICase(type, "uievent"_s) || equalLettersIgnoringASCIICase(type, "uievents"_s))
        return Ref<Event> { UIEvent::createForBindings() };

    // FIXME: Add support for "dragevent", which the DOM specification calls for.

    // The following strings are not part of the DOM specification and we would like to eliminate them.
    // However, we currently include them until we resolve any issues with backward compatibility.
    // FIXME: For each of the strings below, confirm that there is no content depending on it and remove
    // the string, remove the createForBindings function, and also consider removing the corresponding
    // init function for that class.

    if (equalLettersIgnoringASCIICase(type, "keyboardevents"_s))
        return Ref<Event> { KeyboardEvent::createForBindings() };

    return Exception { ExceptionCode::NotSupportedError };
}

void Document::addListenerTypeIfNeeded(const AtomString& eventType)
{
    auto& eventNames = WebCore::eventNames();
    auto typeInfo = eventNames.typeInfoForEvent(eventType);
    switch (typeInfo.type()) {
    case EventType::focusin:
        addListenerType(ListenerType::FocusIn);
        break;
    case EventType::focusout:
        addListenerType(ListenerType::FocusOut);
        break;
    default:
        break;
    }
}

void Document::didAddEventListenersOfType(const AtomString& eventType, IsCapture isCapture, uint16_t count)
{
    ASSERT(count);
    addListenerTypeIfNeeded(eventType);
    auto& counts = m_eventListenerCounts.ensure(eventType, [] { return EventListenerCounts { }; }).iterator->value;
    auto& field = isCapture == IsCapture::Yes ? counts.capturing : counts.bubbling;
    field = std::min<uint32_t>(field + count, std::numeric_limits<uint16_t>::max());
}

void Document::didRemoveEventListenersOfType(const AtomString& eventType, IsCapture isCapture, uint16_t count)
{
    ASSERT(count);
    ASSERT(m_eventListenerCounts.contains(eventType));
    auto it = m_eventListenerCounts.find(eventType);
    auto& field = isCapture == IsCapture::Yes ? it->value.capturing : it->value.bubbling;
    if (field != std::numeric_limits<uint16_t>::max()) [[likely]] {
        ASSERT(field >= count);
        field -= count;
    }
}

// https://html.spec.whatwg.org/#cookie-averse-document-object
bool Document::isCookieAverse() const
{
    // A Document that has no browsing context is cookie-averse.
    if (!m_window)
        return true;

    // This is not part of the specification but we have historically allowed cookies over file protocol
    // and some developers rely on this for testing.
    if (m_url.protocolIsFile())
        return false;

    // A Document whose URL's scheme is not a network scheme is cookie-averse (https://fetch.spec.whatwg.org/#network-scheme).
    return !m_url.protocolIsInHTTPFamily() && !m_url.protocolIs("ftp"_s);
}

// https://datatracker.ietf.org/doc/html/rfc6265#section-5.1.4
static bool cookiePathMatches(StringView requestPath, const String& cookiePath)
{
    if (!requestPath.startsWith(cookiePath))
        return false;
    return requestPath.length() == cookiePath.length() || cookiePath.endsWith('/') || requestPath[cookiePath.length()] == '/';
}

ExceptionOr<String> Document::cookie()
{
    if (isCookieAverse())
        return String();

    m_cookies.removeAllMatching([](auto& cookie) {
        return cookie->isExpired();
    });

    StringBuilder builder;
    for (auto& cookie : m_cookies) {
        if (cookie->secure() && !m_url.protocolIs("https"_s))
            continue;
        if (!cookiePathMatches(m_url.path(), cookie->path()))
            continue;
        if (!builder.isEmpty())
            builder.append("; "_s);
        builder.append(cookie->name(), '=', cookie->value());
    }
    return String { builder.toString() };
}

ExceptionOr<void> Document::setCookie(const String& value)
{
    if (isCookieAverse())
        return { };

    auto parsed = Cookie::parse(value);
    if (parsed.hasException())
        return { };

    Ref cookie = parsed.releaseReturnValue();
    if (cookie->httpOnly())
        return { };

    auto host = m_url.host();
    if (auto& domain = cookie->domain(); !domain.isEmpty()) {
        auto suffix = StringView { domain }.substring(domain.startsWith('.'));
        if (host != suffix && !(host.endsWith(suffix) && host[host.length() - suffix.length() - 1] == '.'))
            return { };
    }

    if (auto maxAge = cookie->maxAge(); maxAge > 0) {
        cookie->setExpires(static_cast<int64_t>((WallTime::now().secondsSinceEpoch().seconds() + maxAge) * 1000));
        cookie->setMaxAge(std::numeric_limits<double>::quiet_NaN());
    }

    auto index = m_cookies.findIf([&](auto& existing) {
        return existing->name() == cookie->name() && existing->domain() == cookie->domain() && existing->path() == cookie->path();
    });
    if (cookie->isExpired()) {
        if (index != notFound)
            m_cookies.removeAt(index);
    } else if (index != notFound)
        m_cookies[index] = WTF::move(cookie);
    else
        m_cookies.append(WTF::move(cookie));
    return { };
}

// https://html.spec.whatwg.org/multipage/origin.html#dom-document-domain
String Document::domain() const
{
    return m_url.host().toString();
}

// http://www.whatwg.org/specs/web-apps/current-work/#dom-document-lastmodified
String Document::lastModified() const
{
    auto localDateTime = PlainGregorianDateTime::currentLocalTime();
    return makeString(pad('0', 2, localDateTime.month() + 1), '/',
        pad('0', 2, localDateTime.monthDay()), '/',
        pad('0', 4, localDateTime.year()), ' ',
        pad('0', 2, localDateTime.hour()), ':',
        pad('0', 2, localDateTime.minute()), ':',
        pad('0', 2, localDateTime.second()));
}

// https://html.spec.whatwg.org/multipage/webappapis.html#encoding-parsing-a-url
URL Document::encodingParseURL(const String& url, const URL& baseURLOverride) const
{
    // Always return a null URL when passed a null string.
    // FIXME: Should we change the URL constructor to have this behavior?
    if (url.isNull())
        return URL();

    return URL(baseURLOverride, url);
}

// https://html.spec.whatwg.org/multipage/webappapis.html#encoding-parsing-a-url
URL Document::encodingParseURL(const String& url) const
{
    return encodingParseURL(url, m_baseURL);
}

// https://html.spec.whatwg.org/multipage/webappapis.html#parse-a-url
URL Document::parseURL(const String& url) const
{
    if (url.isNull())
        return URL();
    return URL(m_baseURL, url);
}

void Document::pushCurrentScript(Element* newCurrentScript)
{
    m_currentScriptStack.append(newCurrentScript);
}

void Document::popCurrentScript()
{
    ASSERT(!m_currentScriptStack.isEmpty());
    m_currentScriptStack.removeLast();
}

String Document::designMode() const
{
    return inDesignMode() ? onAtom() : offAtom();
}

void Document::setDesignMode(const String& value)
{
    DesignMode mode = equalLettersIgnoringASCIICase(value, "on"_s) ? DesignMode::On : DesignMode::Off;
    m_designMode = mode;
}

ExceptionOr<Ref<Attr>> Document::createAttribute(const AtomString& localName)
{
    if (!NameValidation::isValidAttributeName(localName))
        return Exception { ExceptionCode::InvalidCharacterError, makeString("Invalid attribute name: '"_s, localName, '\'') };
    return Attr::create(*this, QualifiedName { nullAtom(), isHTMLDocument() ? localName.convertToASCIILowercase() : localName, nullAtom() }, emptyAtom());
}

ExceptionOr<Ref<Attr>> Document::createAttributeNS(const AtomString& namespaceURI, const AtomString& qualifiedName, bool shouldIgnoreNamespaceChecks)
{
    auto parseResult = NameValidation::parseQualifiedAttributeName(namespaceURI, qualifiedName);
    if (parseResult.hasException())
        return parseResult.releaseException();
    QualifiedName parsedName { parseResult.releaseReturnValue() };
    if (!shouldIgnoreNamespaceChecks && !NameValidation::hasValidNamespaceForAttributes(parsedName))
        return Exception { ExceptionCode::NamespaceError };
    return Attr::create(*this, parsedName, emptyAtom());
}

template <CollectionType collectionType>
Ref<HTMLCollection> Document::ensureCachedCollection()
{
    return ensureRareData().ensureNodeLists().addCachedCollection<GenericCachedHTMLCollection<collectionType>>(*this);
}

Ref<HTMLCollection> Document::images()
{
    return ensureCachedCollection<CollectionType::DocImages>();
}

Ref<HTMLCollection> Document::applets()
{
    return ensureRareData().ensureNodeLists().addCachedCollection<EmptyHTMLCollection>(*this);
}

Ref<HTMLCollection> Document::embeds()
{
    return ensureCachedCollection<CollectionType::DocEmbeds>();
}

Ref<HTMLCollection> Document::scripts()
{
    return ensureCachedCollection<CollectionType::DocScripts>();
}

Ref<HTMLCollection> Document::links()
{
    return ensureCachedCollection<CollectionType::DocLinks>();
}

Ref<HTMLCollection> Document::forms()
{
    return ensureCachedCollection<CollectionType::DocForms>();
}

Ref<HTMLCollection> Document::anchors()
{
    return ensureCachedCollection<CollectionType::DocAnchors>();
}

Ref<HTMLAllCollection> Document::all()
{
    return ensureRareData().ensureNodeLists().addCachedCollection<HTMLAllCollection>(*this);
}

Ref<HTMLCollection> Document::allFilteredByName(const AtomString& name)
{
    return ensureRareData().ensureNodeLists().addCachedCollection<HTMLAllNamedSubCollection>(*this, name);
}

Ref<HTMLCollection> Document::windowNamedItems(const AtomString& name)
{
    return ensureRareData().ensureNodeLists().addCachedCollection<WindowNameCollection>(*this, name);
}

Ref<HTMLCollection> Document::documentNamedItems(const AtomString& name)
{
    return ensureRareData().ensureNodeLists().addCachedCollection<DocumentNameCollection>(*this, name);
}

Ref<NodeList> Document::getElementsByName(const AtomString& elementName)
{
    return ensureRareData().ensureNodeLists().addCacheWithAtomName<NameNodeList>(*this, elementName);
}

void Document::finishedParsing()
{
    ASSERT(!scriptableDocumentParser() || !m_parser->isParsing());
    ASSERT(!scriptableDocumentParser() || m_readyState != ReadyState::Loading);
    setParsing(false);

    Ref protectedThis { *this };

    dispatchEvent(Event::create(eventNames().DOMContentLoadedEvent, Event::CanBubble::Yes, Event::IsCancelable::No));

    m_sharedObjectPool = nullptr;
}

void Document::attachRange(Range& range)
{
    ASSERT(!m_ranges.contains(range));
    m_ranges.add(range);
}

void Document::detachRange(Range& range)
{
    // We don't ASSERT m_ranges.contains(&range) to allow us to call this
    // unconditionally to fix: https://bugs.webkit.org/show_bug.cgi?id=26044
    m_ranges.remove(range);
}

Document& Document::ensureTemplateDocument()
{
    if (const Document* document = templateDocument())
        return const_cast<Document&>(*document);

    Ref templateDocument = [&]() -> Ref<Document> {
        if (isHTMLDocument())
            return HTMLDocument::create(m_scriptExecutionContext, aboutBlankURL());
        return create(m_scriptExecutionContext, aboutBlankURL());
    }();
    lazyInitialize(m_templateDocument, templateDocument.copyRef());
    templateDocument->setTemplateDocumentHost(this); // balanced in dtor.

    return *m_templateDocument;
}

Ref<DocumentFragment> Document::documentFragmentForInnerOuterHTML()
{
    if (!m_documentFragmentForInnerOuterHTML) [[unlikely]]
        m_documentFragmentForInnerOuterHTML = DocumentFragment::createForInnerOuterHTML(*this);
    else if (m_documentFragmentForInnerOuterHTML->hasChildNodes()) [[unlikely]]
        Ref { *m_documentFragmentForInnerOuterHTML }->removeChildren();
    return *m_documentFragmentForInnerOuterHTML;
}

Element* Document::activeElement()
{
    if (Element* element = treeScope().focusedElementInScope())
        return element;
    if (Element* body = bodyOrFrameset())
        return body;
    return documentElement();
}

bool Document::hasFocus() const
{
    return !!m_window;
}

const AtomString& Document::dir() const
{
    CheckedPtr documentElement = dynamicDowncast<HTMLHtmlElement>(this->documentElement());
    return documentElement ? documentElement->dir() : nullAtom();
}

void Document::setDir(const AtomString& value)
{
    if (RefPtr documentElement = dynamicDowncast<HTMLHtmlElement>(this->documentElement()))
        documentElement->setAttributeWithoutSynchronization(dirAttr, value);
}

void Document::didInsertInDocumentShadowRoot(ShadowRoot& shadowRoot)
{
    ASSERT(shadowRoot.isConnected());
    ASSERT(!m_inDocumentShadowRoots.contains(shadowRoot));
    m_inDocumentShadowRoots.add(shadowRoot);
}

void Document::didRemoveInDocumentShadowRoot(ShadowRoot& shadowRoot)
{
    ASSERT(m_inDocumentShadowRoots.contains(shadowRoot));
    m_inDocumentShadowRoots.remove(shadowRoot);
}

const AtomString& Document::bgColor() const
{
    auto* bodyElement = body();
    if (!bodyElement)
        return emptyAtom();
    return bodyElement->attributeWithoutSynchronization(bgcolorAttr);
}

void Document::setBgColor(const AtomString& value)
{
    if (RefPtr bodyElement = body())
        bodyElement->setAttributeWithoutSynchronization(bgcolorAttr, value);
}

const AtomString& Document::fgColor() const
{
    auto* bodyElement = body();
    return bodyElement ? bodyElement->attributeWithoutSynchronization(textAttr) : emptyAtom();
}

void Document::setFgColor(const AtomString& value)
{
    if (RefPtr bodyElement = body())
        bodyElement->setAttributeWithoutSynchronization(textAttr, value);
}

const AtomString& Document::alinkColor() const
{
    auto* bodyElement = body();
    return bodyElement ? bodyElement->attributeWithoutSynchronization(alinkAttr) : emptyAtom();
}

void Document::setAlinkColor(const AtomString& value)
{
    if (RefPtr bodyElement = body())
        bodyElement->setAttributeWithoutSynchronization(alinkAttr, value);
}

const AtomString& Document::linkColorForBindings() const
{
    auto* bodyElement = body();
    return bodyElement ? bodyElement->attributeWithoutSynchronization(linkAttr) : emptyAtom();
}

void Document::setLinkColorForBindings(const AtomString& value)
{
    if (RefPtr bodyElement = body())
        bodyElement->setAttributeWithoutSynchronization(linkAttr, value);
}

const AtomString& Document::vlinkColor() const
{
    auto* bodyElement = body();
    return bodyElement ? bodyElement->attributeWithoutSynchronization(vlinkAttr) : emptyAtom();
}

void Document::setVlinkColor(const AtomString& value)
{
    if (RefPtr bodyElement = body())
        bodyElement->setAttributeWithoutSynchronization(vlinkAttr, value);
}

void Document::addPopoverToList(PopoverListType listType, HTMLElement& popover)
{
    auto& list = listType == PopoverListType::Auto ? m_autoPopoverList : m_hintPopoverList;
    auto result = list.add(popover);
    RELEASE_ASSERT(result.isNewEntry);
}

void Document::removePopoverFromList(PopoverListType listType, HTMLElement& popover)
{
    auto& list = listType == PopoverListType::Auto ? m_autoPopoverList : m_hintPopoverList;
    list.remove(popover);
}

void Document::addTopLayerElement(Element& element)
{
    RELEASE_ASSERT(&element.document() == this && !element.isInTopLayer());
    auto result = m_topLayerElements.add(element);
    RELEASE_ASSERT(result.isNewEntry);
    RefPtr candidatePopover = dynamicDowncast<HTMLElement>(element);
    if (!candidatePopover)
        return;

    RefPtr dialogElement = dynamicDowncast<HTMLDialogElement>(*candidatePopover);
    if (dialogElement && dialogElement->isModal())
        return;

    if (candidatePopover->popoverState() == PopoverState::Auto || candidatePopover->popoverState() == PopoverState::Hint) {
        bool asHint = candidatePopover->popoverData() && candidatePopover->popoverData()->showingAsHint();
        addPopoverToList(asHint ? PopoverListType::Hint : PopoverListType::Auto, *candidatePopover);
    }
}

void Document::removeTopLayerElement(Element& element)
{
    RELEASE_ASSERT(&element.document() == this && element.isInTopLayer());
    auto didRemove = m_topLayerElements.remove(element);
    RELEASE_ASSERT(didRemove);
    if (RefPtr candidatePopover = dynamicDowncast<HTMLElement>(element); candidatePopover && candidatePopover->isPopoverShowing()) {
        if (candidatePopover->popoverState() == PopoverState::Auto || candidatePopover->popoverState() == PopoverState::Hint) {
            bool asHint = candidatePopover->popoverData() && candidatePopover->popoverData()->showingAsHint();
            removePopoverFromList(asHint ? PopoverListType::Hint : PopoverListType::Auto, *candidatePopover);
        }
    }
}

HTMLDialogElement* Document::activeModalDialog() const
{
    for (auto& element : m_topLayerElements | std::views::reverse) {
        if (auto* dialog = dynamicDowncast<HTMLDialogElement>(element.get()); dialog && dialog->isModal())
            return dialog;
    }

    return nullptr;
}

HTMLElement* Document::topmostAutoPopover() const
{
    if (m_autoPopoverList.isEmpty())
        return nullptr;
    return m_autoPopoverList.last().ptr();
}

HTMLElement* Document::topmostHintPopover() const
{
    if (m_hintPopoverList.isEmpty())
        return nullptr;
    return m_hintPopoverList.last().ptr();
}

// Popover ancestor relationships are defined over the flat/composed tree, so a hint popover
// slotted into shadow content is still considered nested inside its host's popover. See the
// "nearest inclusive open popover" definition: https://html.spec.whatwg.org/#nearest-inclusive-open-popover
HTMLElement* Document::nearestOpenHintAncestor(Element& element) const
{
    for (auto& ancestor : composedTreeLineage(element)) {
        auto* htmlElement = dynamicDowncast<HTMLElement>(ancestor);
        if (htmlElement && htmlElement->popoverData()
            && htmlElement->popoverData()->showingAsHint()
            && htmlElement->popoverData()->visibilityState() == PopoverVisibilityState::Showing)
            return htmlElement;
    }
    return nullptr;
}

void Document::closeAllHintPopovers(FocusPreviousElement focusPreviousElement, FireEvents fireEvents)
{
    while (RefPtr popover = topmostHintPopover())
        popover->hidePopoverInternal(focusPreviousElement, fireEvents);
}

void Document::closeHintPopoversUntil(const HTMLElement* endpoint, FocusPreviousElement focusPreviousElement, FireEvents fireEvents)
{
    if (!endpoint)
        return closeAllHintPopovers(focusPreviousElement, fireEvents);

    while (RefPtr topHint = topmostHintPopover()) {
        if (topHint == endpoint)
            break;
        topHint->hidePopoverInternal(focusPreviousElement, fireEvents);
    }
}

// Used when a dialog is shown or an element enters fullscreen. Such an element joins the top layer
// and must light-dismiss every popover that is not one of its ancestors: auto popovers up to the
// nearest ancestor auto, and hint popovers up to the nearest ancestor hint. Both are dismissed
// unconditionally — an unrelated auto must still be hidden even when the element is nested inside a
// hint (in which case there is no ancestor auto and every auto is hidden).
void Document::hidePopoversForTopLayerElement(Element& element, FireEvents fireEvents)
{
    RefPtr hideUntil = element.topmostPopoverAncestor(Element::TopLayerElementType::Other);
    RefPtr hintAncestor = nearestOpenHintAncestor(element);
    hideAutoPopoversUntil(hideUntil.get(), FocusPreviousElement::No, fireEvents);
    closeHintPopoversUntil(hintAncestor.get(), FocusPreviousElement::No, fireEvents);
}

// https://html.spec.whatwg.org/#hide-all-popovers-until
void Document::hideAutoPopoversUntil(HTMLElement* endpoint, FocusPreviousElement focusPreviousElement, FireEvents fireEvents)
{
    auto closeAllAutoPopovers = [&]() {
        while (RefPtr popover = topmostAutoPopover())
            popover->hidePopoverInternal(focusPreviousElement, fireEvents);
    };

    if (!endpoint) {
        closeAllAutoPopovers();
        return;
    }

    bool repeatingHide = false;
    do {
        RefPtr<Element> lastToHide;
        bool foundEndPoint = false;
        for (auto& popover : autoPopoverList()) {
            if (popover.ptr() == endpoint)
                foundEndPoint = true;
            else if (foundEndPoint) {
                lastToHide = popover.ptr();
                break;
            }
        }
        if (!foundEndPoint) {
            closeAllAutoPopovers();
            return;
        }
        while (lastToHide && lastToHide->isPopoverShowing()) {
            RefPtr topmostAutoPopover = this->topmostAutoPopover();
            if (!topmostAutoPopover)
                break;
            topmostAutoPopover->hidePopoverInternal(focusPreviousElement, fireEvents);
        }
        repeatingHide = m_autoPopoverList.contains(*endpoint) && topmostAutoPopover() != endpoint;
        if (repeatingHide)
            fireEvents = FireEvents::No;
    } while (repeatingHide);
}

Location* Document::location() const
{
    return m_window ? &m_window->location() : nullptr;
}

DOMSelection* Document::getSelection()
{
    return m_window ? &m_window->getSelection() : nullptr;
}

Element* Document::focusedFrameOwnerElement() const
{
    auto* owner = m_focusedFrameOwnerElement.get();
    return owner && owner->isConnected() && &owner->document() == this ? owner : nullptr;
}

Element* Document::ownerElement() const
{
    return m_window ? m_window->frameElement() : nullptr;
}

Document* Document::parentDocument() const
{
    auto* owner = ownerElement();
    return owner ? &owner->document() : nullptr;
}

String Document::referrerForBindings() const
{
    auto* parent = parentDocument();
    return parent ? parent->url().string() : emptyString();
}

void Document::setWindow(Window* window)
{
    m_window = window;
    if (!window)
        return;

    clearUsesNullCustomElementRegistry();
    setCustomElementRegistry(window->customElementRegistry());
}

CustomElementQueue& Document::backupElementQueue()
{
    if (!m_processingBackupElementQueue) {
        m_processingBackupElementQueue = true;
        queueMicrotask([protectedThis = Ref { *this }] {
            protectedThis->m_processingBackupElementQueue = false;
            ASSERT(protectedThis->m_backupElementQueue);
            CustomElementReactionQueue::processBackupQueue(*protectedThis->m_backupElementQueue);
        });
    }
    if (!m_backupElementQueue)
        lazyInitialize(m_backupElementQueue, makeUnique<CustomElementQueue>());
    return *m_backupElementQueue;
}

String Document::debugDescription() const
{
    StringBuilder builder;

    builder.append("Document 0x"_s, hex(reinterpret_cast<uintptr_t>(this), Lowercase));
    builder.append(' ', m_url.string());
    return builder.toString();
}

TextStream& operator<<(TextStream& ts, const Document& document)
{
    ts << document.debugDescription();
    return ts;
}

void Document::addElementWithLangAttrMatchingDocumentElement(Element& element)
{
    m_elementsWithLangAttrMatchingDocumentElement.add(element);
}

void Document::removeElementWithLangAttrMatchingDocumentElement(Element& element)
{
    m_elementsWithLangAttrMatchingDocumentElement.remove(element);
}

Element* Document::cachedFirstElementWithAttribute(const QualifiedName& attribute) const
{
    if (m_cachedFirstElementWithAttribute && m_cachedFirstElementWithAttribute->first == attribute)
        return m_cachedFirstElementWithAttribute->second.get();
    return nullptr;
}

void Document::setCachedFirstElementWithAttribute(const QualifiedName& attribute, Element& element)
{
    m_cachedFirstElementWithAttribute = std::make_pair(attribute, &element);
}

void Document::attributeAddedToElement(const QualifiedName& attribute)
{
    if (m_cachedFirstElementWithAttribute && m_cachedFirstElementWithAttribute->first == attribute)
        m_cachedFirstElementWithAttribute = std::nullopt;
}

void Document::elementDisconnectedFromDocument(const Element& element)
{
    if (m_cachedFirstElementWithAttribute && m_cachedFirstElementWithAttribute->second == &element)
        m_cachedFirstElementWithAttribute = std::nullopt;
}

void Document::invalidateCachedSetInnerHTML()
{
    auto& cache = cachedSetInnerHTML();
    if (cache.cachedContainer)
        cache.cachedContainer->setDidMutateSubtreeAfterSetInnerHTML();
    cache.source = String();
}

void Document::updateCachedSetInnerHTML(const String& sourceString, ContainerNode& container, Element& contextElement)
{
    auto& cache = cachedSetInnerHTML();

    if (sourceString.length() < cache.source.length() || sourceString.length() > maxCachedSetInnerHTMLStringSize())
        return;

    cache.source = sourceString;
    cache.cachedContainer = &container;
    cache.contextElementName = contextElement.elementName();
    container.clearDidMutateSubtreeAfterSetInnerHTML();
}

} // namespace WebCore
