/*
 * Copyright (C) 2004-2025 Apple Inc. All rights reserved.
 * Copyright (C) 2009-2022 Google Inc. All rights reserved.
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
#include "MarkupAccumulator.h"

#include "Attr.h"
#include "CDATASection.h"
#include "Comment.h"
#include "CommonAtomStrings.h"
#include "CustomElementRegistry.h"
#include "DocumentFragment.h"
#include "DocumentType.h"
#include "ElementInlines.h"
#include "ElementRareData.h"
#include "HTMLElement.h"
#include "HTMLNames.h"
#include "HTMLTemplateElement.h"
#include "NodeName.h"
#include "ProcessingInstruction.h"
#include "ShadowRoot.h"
#include "TemplateContentDocumentFragment.h"
#include "XLinkNames.h"
#include "XMLNSNames.h"
#include "XMLNames.h"
#include <algorithm>
#include <memory>
#include <wtf/URL.h>
#include <wtf/unicode/CharacterNames.h>

namespace WebCore {

using namespace HTMLNames;

struct EntityDescription {
    ASCIILiteral characters;
    std::optional<EntityMask> mask;
};

constexpr std::array entitySubstitutionList {
    EntityDescription { ""_s, std::nullopt },
    EntityDescription { "&amp;"_s, EntityMask::Amp },
    EntityDescription { "&lt;"_s, EntityMask::Lt },
    EntityDescription { "&gt;"_s, EntityMask::Gt },
    EntityDescription { "&quot;"_s, EntityMask::Quot },
    EntityDescription { "&nbsp;"_s, EntityMask::Nbsp },
    EntityDescription { "&#9;"_s, EntityMask::Tab },
    EntityDescription { "&#10;"_s, EntityMask::LineFeed },
    EntityDescription { "&#13;"_s, EntityMask::CarriageReturn },
};

namespace EntitySubstitutionIndex {
constexpr uint8_t Null = 0;
constexpr uint8_t Amp = 1;
constexpr uint8_t Lt = 2;
constexpr uint8_t Gt = 3;
constexpr uint8_t Quot = 4;
constexpr uint8_t Nbsp = 5;
constexpr uint8_t Tab = 6;
constexpr uint8_t LineFeed = 7;
constexpr uint8_t CarriageReturn = 8;
};

static constexpr unsigned maximumEscapedentityCharacter = noBreakSpace;
static constexpr std::array<uint8_t, maximumEscapedentityCharacter + 1> entityMap {
    0, 0, 0, 0, 0, 0, 0, 0, 0,
    EntitySubstitutionIndex::Tab, // '\t'.
    EntitySubstitutionIndex::LineFeed, // '\n'.
    0, 0,
    EntitySubstitutionIndex::CarriageReturn, // '\r'.
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    EntitySubstitutionIndex::Quot, // '"'.
    0, 0, 0,
    EntitySubstitutionIndex::Amp, // '&'.
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    EntitySubstitutionIndex::Lt, // '<'.
    0,
    EntitySubstitutionIndex::Gt, // '>'.
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    EntitySubstitutionIndex::Nbsp // noBreakSpace.
};

static bool LEGACY_NODELETE elementCannotHaveEndTag(const Node& node)
{
    using namespace ElementNames;
    auto* element = dynamicDowncast<Element>(node);
    if (!element)
        return false;

    switch (element->elementName()) {
        // https://html.spec.whatwg.org/#void-elements
    case HTML::area:
    case HTML::base:
    case HTML::br:
    case HTML::col:
    case HTML::embed:
    case HTML::hr:
    case HTML::img:
    case HTML::input:
    case HTML::link:
    case HTML::meta:
    case HTML::source:
    case HTML::track:
    case HTML::wbr:
        // https://html.spec.whatwg.org/#serializes-as-void
    case HTML::basefont:
    case HTML::bgsound:
    case HTML::frame:
    case HTML::keygen:
    case HTML::param:
        return true;
    default:
        break;
    }

    return false;
}

// Rules of self-closure
// 1. No elements in HTML documents use the self-closing syntax.
// 2. Elements w/ children never self-close because they use a separate end tag.
// 3. HTML elements which do not have a "forbidden" end tag will close with a separate end tag.
// 4. Other elements self-close.
static bool LEGACY_NODELETE shouldSelfClose(const Element& element, SerializationSyntax syntax)
{
    if (syntax != SerializationSyntax::XML)
        return false;
    if (element.hasChildNodes())
        return false;
    if (element.isHTMLElement() && !elementCannotHaveEndTag(element))
        return false;
    return true;
}

template<typename CharacterType>
static inline void appendCharactersReplacingEntitiesInternal(StringBuilder& result, const String& source, OptionSet<EntityMask> entityMask)
{
    unsigned length = source.length();
    size_t positionAfterLastEntity = 0;
    for (size_t i = 0; i < length; ++i) {
        CharacterType character = source[i];
        uint8_t substitution = character < std::size(entityMap) ? entityMap[character] : static_cast<uint8_t>(EntitySubstitutionIndex::Null);
        if (substitution != EntitySubstitutionIndex::Null) [[unlikely]] {
            if (entityMask.contains(*entitySubstitutionList[substitution].mask)) {
                result.appendSubstring(source, positionAfterLastEntity, i - positionAfterLastEntity);
                result.append(entitySubstitutionList[substitution].characters);
                positionAfterLastEntity = i + 1;
            }
        }
    }
    result.appendSubstring(source, positionAfterLastEntity, length - positionAfterLastEntity);
}

void MarkupAccumulator::appendCharactersReplacingEntities(StringBuilder& result, const String& source, OptionSet<EntityMask> entityMask)
{
    if (!source.length())
        return;

    if (source.is8Bit())
        appendCharactersReplacingEntitiesInternal<Latin1Character>(result, source, entityMask);
    else
        appendCharactersReplacingEntitiesInternal<char16_t>(result, source, entityMask);
}

MarkupAccumulator::MarkupAccumulator(Vector<Ref<Node>>* nodes, ResolveURLs resolveURLs, SerializationSyntax serializationSyntax, SerializeShadowRoots serializeShadowRoots, Vector<Ref<ShadowRoot>>&& explicitShadowRoots)
    : m_nodes(nodes)
    , m_resolveURLs(resolveURLs)
    , m_serializationSyntax(serializationSyntax)
    , m_serializeShadowRoots(serializeShadowRoots)
    , m_explicitShadowRoots(WTF::move(explicitShadowRoots))
{
}

MarkupAccumulator::~MarkupAccumulator() = default;

String MarkupAccumulator::serializeNodes(Node& targetNode, SerializedNodes root)
{
    serializeNodesWithNamespaces(targetNode, root, 0);
    return m_markup.toString();
}

bool MarkupAccumulator::shouldIncludeShadowRoots() const
{
    return m_serializeShadowRoots != SerializeShadowRoots::Explicit || !m_explicitShadowRoots.isEmpty();
}

bool MarkupAccumulator::includeShadowRoot(const ShadowRoot& shadowRoot) const
{
    if (shadowRoot.mode() == ShadowRootMode::UserAgent)
        return false;

    if (m_serializeShadowRoots == SerializeShadowRoots::Serializable && shadowRoot.serializable())
        return true;

    if (m_explicitShadowRoots.containsIf([&shadowRoot](const auto& item) { return item.ptr() == &shadowRoot; }))
        return true;

    return false;
}

void MarkupAccumulator::serializeNodesWithNamespaces(Node& targetNode, SerializedNodes root, const Namespaces* namespaces)
{
    WTF::Vector<Namespaces> namespaceStack;
    if (namespaces)
        namespaceStack.append(*namespaces);
    else if (inXMLFragmentSerialization()) {
        // Make sure xml prefix and namespace are always known to uphold the constraints listed at http://www.w3.org/TR/xml-names11/#xmlReserved.
        Namespaces namespaceHash;
        namespaceHash.set(xmlAtom().impl(), XMLNames::xmlNamespaceURI->impl());
        namespaceHash.set(XMLNames::xmlNamespaceURI->impl(), xmlAtom().impl());
        namespaceStack.append(WTF::move(namespaceHash));
    } else
        namespaceStack.constructAndAppend();

    auto firstChild = [&](auto& current) -> Node* {
        RefPtr currentTemplate = dynamicDowncast<HTMLTemplateElement>(current);
        return currentTemplate ? currentTemplate->content().firstChild() : current.firstChild();
    };

    RefPtr<const Node> current = targetNode;
    do {
        bool shouldAppendNode = !(current == &targetNode && root != SerializedNodes::SubtreeIncludingNode);
        if (shouldAppendNode)
            startAppendingNode(*current, &namespaceStack.last());

        bool shouldEmitCloseTag = m_serializationSyntax == SerializationSyntax::XML || !(targetNode.document().isHTMLDocument() && elementCannotHaveEndTag(*current));
        if (shouldEmitCloseTag) {
            if (shouldIncludeShadowRoots()) {
                RefPtr shadowRoot = current->shadowRoot();
                if (shadowRoot && includeShadowRoot(*shadowRoot)) {
                    current = shadowRoot;
                    namespaceStack.append(namespaceStack.last());
                    continue;
                }
            }

            if (RefPtr child = firstChild(*current)) {
                current = child;
                namespaceStack.append(namespaceStack.last());
                continue;
            }
        }

        if (shouldAppendNode && shouldEmitCloseTag)
            endAppendingNode(*current);

        while (current != &targetNode) {
            if (RefPtr nextSibling = current->nextSibling()) {
                current = WTF::move(nextSibling);
                namespaceStack.removeLast();
                namespaceStack.append(namespaceStack.last());
                break;
            }

            if (shouldIncludeShadowRoots() && current->isShadowRoot()) {
                current = current->shadowHost();
                if (RefPtr child = firstChild(*current)) {
                    current = child;
                    namespaceStack.append(namespaceStack.last());
                    break;
                }
            } else
                current = current->parentNode();

            namespaceStack.removeLast();
            if (RefPtr fragment = dynamicDowncast<TemplateContentDocumentFragment>(current.get())) {
                if (current != &targetNode)
                    current = fragment->host();
            }

            ASSERT(current);
            if (!current)
                break;

            shouldAppendNode = !(current == &targetNode && root != SerializedNodes::SubtreeIncludingNode);
            shouldEmitCloseTag = m_serializationSyntax == SerializationSyntax::XML || !(targetNode.document().isHTMLDocument() && elementCannotHaveEndTag(*current));
            if (shouldAppendNode && shouldEmitCloseTag)
                endAppendingNode(*current);
        }
    } while (current != &targetNode);
}

RefPtr<const ShadowRoot> MarkupAccumulator::suitableShadowRoot(const Node& node)
{
    if (!shouldIncludeShadowRoots())
        return nullptr;

    RefPtr shadowRoot = dynamicDowncast<ShadowRoot>(node);
    if (!shadowRoot || !includeShadowRoot(*shadowRoot))
        return nullptr;
    return shadowRoot;
}

void MarkupAccumulator::startAppendingNode(const Node& node, Namespaces* namespaces)
{
    if (RefPtr element = dynamicDowncast<Element>(node))
        appendStartTag(m_markup, *element, namespaces);
    else if (RefPtr shadowRoot = suitableShadowRoot(node)) {
        m_markup.append("<template shadowrootmode=\""_s, serializeShadowRootMode(shadowRoot->mode()), '"');
        if (shadowRoot->delegatesFocus())
            m_markup.append(" shadowrootdelegatesfocus=\"\""_s);
        if (shadowRoot->serializable())
            m_markup.append(" shadowrootserializable=\"\""_s);
        if (shadowRoot->slotAssignmentMode() == SlotAssignmentMode::Manual)
            m_markup.append(" shadowrootslotassignment=\"manual\""_s);
        if (shadowRoot->isClonable())
            m_markup.append(" shadowrootclonable=\"\""_s);
        bool shouldAppendRegistryAttribute = [&] {
            auto& document = shadowRoot->document();
            if (document.usesNullCustomElementRegistry() && shadowRoot->usesNullCustomElementRegistry())
                return false;

            auto* documentRegistry = document.customElementRegistry();
            auto* shadowRegistry = shadowRoot->customElementRegistry();
            bool documentHasGlobalRegistry = (documentRegistry && !documentRegistry->isScoped()) || document.window();
            bool shadowHasGlobalRegistry = (shadowRegistry && !shadowRegistry->isScoped())
                || (!shadowRegistry && !shadowRoot->usesNullCustomElementRegistry() && document.window());
            return !(documentHasGlobalRegistry && shadowHasGlobalRegistry);
        }();
        if (shouldAppendRegistryAttribute)
            m_markup.append(" shadowrootcustomelementregistry=\"\""_s);
        m_markup.append('>');
    } else
        appendNonElementNode(m_markup, node, namespaces);

    if (m_nodes)
        m_nodes->append(const_cast<Node&>(node));
}

void MarkupAccumulator::appendEndTag(StringBuilder& result, const Element& element)
{
    AtomString resolvedQualifiedName;
    if (!m_resolvedElementQualifiedNameStack.isEmpty() && m_resolvedElementQualifiedNameStack.last().first.ptr() == &element)
        resolvedQualifiedName = m_resolvedElementQualifiedNameStack.takeLast().second;

    if (shouldSelfClose(element, m_serializationSyntax) || (!element.hasChildNodes() && elementCannotHaveEndTag(element)))
        return;

    if (!resolvedQualifiedName.isNull())
        result.append("</"_s, resolvedQualifiedName, '>');
    else
        result.append("</"_s, element.tagQName().toString(), '>');
}

void MarkupAccumulator::appendAttributeValue(StringBuilder& result, const String& attribute)
{
    auto entityMask = [&] -> OptionSet<EntityMask> {
        switch (m_serializationSyntax) {
        case SerializationSyntax::XML:
            return EntityMaskInAttributeValue;
        case SerializationSyntax::HTML:
            return EntityMaskInHTMLAttributeValue;
        }
        ASSERT_NOT_REACHED();
        return EntityMaskInAttributeValue;
    }();
    appendCharactersReplacingEntities(result, attribute, entityMask);
}

static bool shouldAddNamespaceElement(const Element& element)
{
    // Don't add namespace attribute if it is already defined for this elem.
    auto& prefix = element.prefix();
    if (prefix.isEmpty())
        return !element.hasAttribute(xmlnsAtom());
    return !element.hasAttribute(makeAtomString("xmlns:"_s, prefix));
}

static bool shouldAddNamespaceAttribute(const Attribute& attribute, Namespaces& namespaces)
{
    namespaces.checkConsistency();

    // Don't add namespace attributes twice
    // HTML Parser will create xmlns attributes without namespace for HTML elements, allow those as well.
    if (attribute.name().localName() == xmlnsAtom() && (attribute.namespaceURI().isEmpty() || attribute.namespaceURI() == XMLNSNames::xmlnsNamespaceURI)) {
        namespaces.set(emptyAtom().impl(), attribute.value().impl());
        return false;
    }

    QualifiedName xmlnsPrefixAttr(xmlnsAtom(), attribute.localName(), XMLNSNames::xmlnsNamespaceURI);
    if (attribute.name() == xmlnsPrefixAttr) {
        namespaces.set(attribute.localName().impl(), attribute.value().impl());
        namespaces.set(attribute.value().impl(), attribute.localName().impl());
        return false;
    }

    return true;
}

void MarkupAccumulator::appendNamespace(StringBuilder& result, const AtomString& prefix, const AtomString& namespaceURI, Namespaces& namespaces, bool allowEmptyDefaultNS)
{
    namespaces.checkConsistency();
    if (namespaceURI.isEmpty()) {
        // https://html.spec.whatwg.org/multipage/xhtml.html#xml-fragment-serialisation-algorithm
        if (allowEmptyDefaultNS) {
            RefPtr currentDefaultNamespace = namespaces.get(emptyAtom().impl());
            if (currentDefaultNamespace && !currentDefaultNamespace->isEmpty())
                result.append(' ', xmlnsAtom(), "=\"\""_s);
        }
        return;
    }

    // Use emptyAtom()s's impl() for null strings since this HashMap can't handle nullptr as a key
    auto addResult = namespaces.add(prefix.isNull() ? emptyAtom().impl() : prefix.impl(), namespaceURI.impl());
    if (!addResult.isNewEntry) {
        if (addResult.iterator->value == namespaceURI.impl())
            return;
        addResult.iterator->value = namespaceURI.impl();
    }

    // Add namespace to prefix pair so we can do constraint checking later.
    if (inXMLFragmentSerialization() && !prefix.isEmpty())
        namespaces.set(namespaceURI.impl(), prefix.impl());

    // Make sure xml prefix and namespace are always known to uphold the constraints listed at http://www.w3.org/TR/xml-names11/#xmlReserved.
    if (namespaceURI == XMLNames::xmlNamespaceURI)
        return;

    result.append(' ', xmlnsAtom(), prefix.isEmpty() ? ""_s : ":"_s, prefix, "=\""_s);
    appendAttributeValue(result, namespaceURI);
    result.append('"');
}

OptionSet<EntityMask> MarkupAccumulator::entityMaskForText(const Text& text) const
{
    using namespace ElementNames;

    if (inXMLFragmentSerialization())
        return EntityMaskInPCDATA;

    if (RefPtr element = text.parentElement()) {
        switch (element->elementName()) {
        case HTML::iframe:
        case HTML::noembed:
        case HTML::noframes:
        case HTML::plaintext:
        case HTML::script:
        case HTML::style:
        case HTML::xmp:
            return EntityMaskInCDATA;
        default:
            break;
        }
    }
    return EntityMaskInHTMLPCDATA;
}

void MarkupAccumulator::appendText(StringBuilder& result, const Text& text)
{
    appendCharactersReplacingEntities(result, text.data(), entityMaskForText(text));
}

static void appendXMLDeclaration(StringBuilder& result, const Document& document)
{
    if (!document.hasXMLDeclaration())
        return;

    auto encoding = document.xmlEncoding();
    bool isStandaloneSpecified = document.xmlStandaloneStatus() != Document::StandaloneStatus::Unspecified;

    result.append("<?xml version=\""_s,
        document.xmlVersion(),
        encoding.isEmpty() ? ""_s : "\" encoding=\""_s,
        encoding,
        isStandaloneSpecified ? (document.xmlStandalone() ? "\" standalone=\"yes"_s : "\" standalone=\"no"_s) : ""_s,
        "\"?>"_s);
}

static void appendDocumentType(StringBuilder& result, const DocumentType& documentType)
{
    if (documentType.name().isEmpty())
        return;

    result.append(
        "<!DOCTYPE "_s,
        documentType.name(),
        documentType.publicId().isEmpty() ? ""_s : " PUBLIC \""_s,
        documentType.publicId(),
        documentType.publicId().isEmpty() ? ""_s : "\""_s,
        documentType.systemId().isEmpty() ? ""_s : (documentType.publicId().isEmpty() ? " SYSTEM \""_s : " \""_s),
        documentType.systemId(),
        documentType.systemId().isEmpty() ? ">"_s : "\">"_s
    );
}

void MarkupAccumulator::appendStartTag(StringBuilder& result, const Element& element, Namespaces* namespaces)
{
    appendOpenTag(result, element, namespaces);

    if (element.hasAttributes()) {
        // This records the declarations: one counts for the attributes in front of it too.
        if (namespaces && inXMLFragmentSerialization()) {
            for (auto& attribute : element.attributes())
                shouldAddNamespaceAttribute(attribute, *namespaces);
        }
        for (auto& attribute : element.attributes())
            appendAttribute(result, element, attribute, namespaces);
    }

    appendCloseTag(result, element);
}

void MarkupAccumulator::appendOpenTag(StringBuilder& result, const Element& element, Namespaces* namespaces)
{
    result.append('<');
    if (inXMLFragmentSerialization() && namespaces && element.prefix().isEmpty()) {
        // According to http://www.w3.org/TR/DOM-Level-3-Core/namespaces-algorithms.html#normalizeDocumentAlgo we now should create
        // a default namespace declaration to make this namespace well-formed. However, http://www.w3.org/TR/xml-names11/#xmlReserved states
        // "The prefix xml MUST NOT be declared as the default namespace.", so use the xml prefix explicitly.
        if (element.namespaceURI() == XMLNames::xmlNamespaceURI) {
            auto qualifiedName = makeAtomString(xmlAtom(), ':', element.localName());
            result.append(qualifiedName);
            m_resolvedElementQualifiedNameStack.append({ element, WTF::move(qualifiedName) });
            return;
        } else if (!element.namespaceURI().isEmpty() && !element.hasAttribute(xmlnsAtom())) {
            // If the element doesn't carry its own default namespace declaration,
            // look for an existing prefix mapped to this namespace URI in an ancestor
            // and use it instead of emitting a new default namespace declaration.
            AtomString inheritedDefaultNS = namespaces->get(emptyAtom().impl());
            if (inheritedDefaultNS.isNull() || inheritedDefaultNS != element.namespaceURI()) {
                AtomString existingPrefix = namespaces->get(element.namespaceURI().impl());
                if (!existingPrefix.isEmpty()) {
                    auto qualifiedName = makeAtomString(existingPrefix, ':', element.localName());
                    result.append(qualifiedName);
                    m_resolvedElementQualifiedNameStack.append({ element, WTF::move(qualifiedName) });
                    return;
                }
            }
        }
    }
    result.append(element.tagQName().toString());
    if (inXMLFragmentSerialization() && namespaces && shouldAddNamespaceElement(element))
        appendNamespace(result, element.prefix(), element.namespaceURI(), *namespaces, inXMLFragmentSerialization());
}

void MarkupAccumulator::appendCloseTag(StringBuilder& result, const Element& element)
{
    if (shouldSelfClose(element, m_serializationSyntax)) {
        if (element.isHTMLElement())
            result.append(' '); // XHTML 1.0 <-> HTML compatibility.
        result.append('/');
    }
    result.append('>');
}

void MarkupAccumulator::generateUniquePrefix(QualifiedName& prefixedName, const Namespaces& namespaces)
{
    // http://www.w3.org/TR/DOM-Level-3-Core/namespaces-algorithms.html#normalizeDocumentAlgo
    // Find a prefix following the pattern "NS" + index (starting at 1) and make sure this
    // prefix is not declared in the current scope.
    AtomString name;
    do {
        // FIXME: We should create makeAtomString, which would be more efficient.
        name = makeAtomString("ns"_s, ++m_prefixLevel);
    } while (namespaces.get(name.impl()));
    prefixedName.setPrefix(name);
}

// https://html.spec.whatwg.org/#attribute's-serialised-name
static String htmlAttributeSerialization(const Attribute& attribute)
{
    if (attribute.namespaceURI().isEmpty())
        return attribute.name().localName();

    QualifiedName prefixedName = attribute.name();
    if (attribute.namespaceURI() == XMLNames::xmlNamespaceURI)
        prefixedName.setPrefix(xmlAtom());
    else if (attribute.namespaceURI() == XMLNSNames::xmlnsNamespaceURI) {
        if (prefixedName.localName() == xmlnsAtom())
            return xmlnsAtom();
        prefixedName.setPrefix(xmlnsAtom());
    } else if (attribute.namespaceURI() == XLinkNames::xlinkNamespaceURI)
        prefixedName.setPrefix(AtomString("xlink"_s));
    return prefixedName.toString();
}

// https://w3c.github.io/DOM-Parsing/#dfn-xml-serialization-of-the-attributes
QualifiedName MarkupAccumulator::xmlAttributeSerialization(const Attribute& attribute, Namespaces* namespaces)
{
    QualifiedName prefixedName = attribute.name();
    if (!attribute.namespaceURI().isEmpty()) {
        if (attribute.namespaceURI() == XMLNames::xmlNamespaceURI) {
            // Always use xml as prefix if the namespace is the XML namespace.
            prefixedName.setPrefix(xmlAtom());
        } else {
            RefPtr foundNS = namespaces && attribute.prefix().impl() ? namespaces->get(attribute.prefix().impl()) : nullptr;
            bool prefixIsAlreadyMappedToOtherNS = foundNS && foundNS != attribute.namespaceURI().impl();
            if (attribute.prefix().isEmpty() || !foundNS || prefixIsAlreadyMappedToOtherNS) {
                if (RefPtr prefix = namespaces ? namespaces->get(attribute.namespaceURI().impl()) : nullptr)
                    prefixedName.setPrefix(AtomString(WTF::move(prefix)));
                else {
                    bool shouldBeDeclaredUsingAppendNamespace = !attribute.prefix().isEmpty() && !foundNS;
                    if (!shouldBeDeclaredUsingAppendNamespace && attribute.localName() != xmlnsAtom() && namespaces)
                        generateUniquePrefix(prefixedName, *namespaces);
                }
            }
        }
    }
    return prefixedName;
}

void MarkupAccumulator::appendAttribute(StringBuilder& result, const Element& element, const Attribute& attribute, Namespaces* namespaces)
{
    bool isSerializingHTML = !inXMLFragmentSerialization();

    std::optional<QualifiedName> effectiveXMLPrefixedName;

    // Per https://w3c.github.io/DOM-Parsing/#dfn-xml-serialization-of-the-attributes the xmlns attribute is serialized first
    if (!isSerializingHTML) {
        effectiveXMLPrefixedName = xmlAttributeSerialization(attribute, namespaces);
        if (namespaces && shouldAddNamespaceAttribute(attribute, *namespaces))
            appendNamespace(result, effectiveXMLPrefixedName->prefix(), effectiveXMLPrefixedName->namespaceURI(), *namespaces);
    }

    result.append(' ');

    if (isSerializingHTML)
        result.append(htmlAttributeSerialization(attribute));
    else
        result.append(effectiveXMLPrefixedName->toString());

    result.append('=');

    result.append('"');
    if (element.isURLAttribute(attribute)) {
        // FIXME: This does not fully match other browsers. Firefox percent-escapes
        // non-ASCII characters for innerHTML.
        appendAttributeValue(result, element.resolveURLStringIfNeeded(attribute.value(), m_resolveURLs));
    } else
        appendAttributeValue(result, attribute.value());
    result.append('"');
}

void MarkupAccumulator::appendNonElementNode(StringBuilder& result, const Node& node, Namespaces* namespaces)
{
    if (namespaces)
        namespaces->checkConsistency();

    switch (node.nodeType()) {
    case NodeType::Text:
        appendText(result, uncheckedDowncast<Text>(node));
        break;
    case NodeType::Comment:
        // FIXME: Comment content is not escaped, but that may be OK because XMLSerializer (and possibly other callers) should raise an exception if it includes "-->".
        result.append("<!--"_s, uncheckedDowncast<Comment>(node).data(), "-->"_s);
        break;
    case NodeType::Document:
        appendXMLDeclaration(result, uncheckedDowncast<Document>(node));
        break;
    case NodeType::DocumentFragment:
        break;
    case NodeType::DocumentType:
        appendDocumentType(result, uncheckedDowncast<DocumentType>(node));
        break;
    case NodeType::ProcessingInstruction: {
        auto& instruction = uncheckedDowncast<ProcessingInstruction>(node);
        // FIXME: PI data is not escaped, but XMLSerializer (and possibly other callers) this should raise an exception if it includes "?>".
        result.append("<?"_s, instruction.target(), ' ', instruction.data(), "?>"_s);
        break;
    }
    case NodeType::Element:
        ASSERT_NOT_REACHED();
        break;
    case NodeType::CDATASection:
        if (inXMLFragmentSerialization()) {
            // FIXME: CDATA content is not escaped, but XMLSerializer (and possibly other callers) should raise an exception if it includes "]]>".
            result.append("<![CDATA["_s, uncheckedDowncast<CDATASection>(node).data(), "]]>"_s);
        } else
            appendText(result, uncheckedDowncast<Text>(node));
        break;
    case NodeType::Attribute:
        appendAttributeValue(result, uncheckedDowncast<Attr>(node).value());
        break;
    }
}

SerializationSyntax MarkupAccumulator::serializationSyntax(Document& document)
{
    return document.isHTMLDocument() ? SerializationSyntax::HTML : SerializationSyntax::XML;
}

}
