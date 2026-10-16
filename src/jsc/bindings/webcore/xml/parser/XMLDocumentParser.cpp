#include "config.h"
#include "XMLDocumentParser.h"

#include "BunXMLParser.h"
#include "CDATASection.h"
#include "Comment.h"
#include "CommonAtomStrings.h"
#include "ContainerNodeInlines.h"
#include "CustomElementRegistry.h"
#include "Document.h"
#include "DocumentFragment.h"
#include "DocumentType.h"
#include "HTMLEntityParser.h"
#include "HTMLNames.h"
#include "HTMLTemplateElement.h"
#include "NameValidation.h"
#include "ProcessingInstruction.h"
#include "ScriptElement.h"
#include "SegmentedString.h"
#include "Text.h"
#include "XMLErrors.h"
#include "XMLNSNames.h"
#include "XMLNames.h"
#include <wtf/HashMap.h>
#include <wtf/HashSet.h>
#include <wtf/TZoneMallocInlines.h>
#include <wtf/text/AtomStringHash.h>
#include <wtf/text/MakeString.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(XMLDocumentParser);

static constexpr unsigned maxXMLTreeDepth = 5000;

static bool lookUpHTMLEntity(const char16_t* name, size_t nameLength, uint32_t (*codePoints)[2])
{
    std::array<char, 64> nullTerminatedName;
    if (nameLength >= nullTerminatedName.size())
        return false;
    auto characters = unsafeMakeSpan(name, nameLength);
    for (size_t i = 0; i < nameLength; ++i) {
        if (!isASCII(characters[i]))
            return false;
        nullTerminatedName[i] = static_cast<char>(characters[i]);
    }
    nullTerminatedName[nameLength] = '\0';

    auto entity = decodeNamedHTMLEntityForXMLParser(nullTerminatedName.data());
    if (entity.failed())
        return false;

    size_t count = 0;
    (*codePoints)[1] = 0;
    for (char32_t codePoint : StringView { entity.span() }.codePoints()) {
        if (count == 2)
            return false;
        (*codePoints)[count++] = codePoint;
    }
    return true;
}

// What Bun's parser found in a text.
class XMLEvents {
    WTF_MAKE_NONCOPYABLE(XMLEvents);
public:
    explicit XMLEvents(StringView source)
    {
        auto characters = source.upconvertedCharacters();
        auto span = characters.span();
        m_isWellFormed = Bun__XML__DOM__parse(span.data(), span.size(), lookUpHTMLEntity, &m_list);
    }

    ~XMLEvents()
    {
        Bun__XML__DOM__freeEventList(&m_list);
    }

    const BunXMLEventList& list() const LIFETIME_BOUND { return m_list; }
    std::span<const BunXMLEvent> events() const LIFETIME_BOUND { return unsafeMakeSpan(m_list.events, m_list.eventCount); }

    bool isWellFormed() const { return m_isWellFormed; }
    String errorMessage() const { return String::fromUTF8(unsafeMakeSpan(m_list.errorMessage, m_list.errorMessageLength)); }
    size_t errorPosition() const { return m_list.errorPosition; }

    StringView view(BunXMLStringRange range) const LIFETIME_BOUND { return std::span<const char16_t> { unsafeMakeSpan(m_list.strings, m_list.stringsLength).subspan(range.offset, range.length) }; }
    String string(BunXMLStringRange range) const { return StringImpl::create8BitIfPossible(view(range).span16()); }
    AtomString atomString(BunXMLStringRange range) const { return range.length ? view(range).toAtomString() : emptyAtom(); }

private:
    BunXMLEventList m_list;
    bool m_isWellFormed;
};

// Builds the nodes, and does what https://www.w3.org/TR/xml-names/ adds to XML, which Bun's parser leaves out.
class XMLTreeBuilder {
public:
    XMLTreeBuilder(const XMLEvents&, ContainerNode& root, Element* contextElement, OptionSet<ParserContentPolicy>);

    // False at the first error. The nodes before it are in the tree.
    bool build(std::span<const BunXMLEvent>);
    // For a text that ends early.
    void closeOpenElements();

    const String& errorMessage() const LIFETIME_BOUND { return m_errorMessage; }
    size_t errorPosition() const { return m_errorPosition; }

private:
    struct OpenElement {
        Ref<Element> element;
        // Where the children go: the element, or the content of a <template>.
        Ref<ContainerNode> container;
        size_t shadowedBindingCount;
    };

    // What a prefix, or with a null prefix the default namespace, was bound to before an open element declared it.
    struct ShadowedBinding {
        AtomString prefix;
        AtomString namespaceURI;
    };

    ContainerNode& currentNode() { return m_openElements.isEmpty() ? m_root.get() : m_openElements.last().container.get(); }
    void append(Ref<Node>&& node) { protect(currentNode())->parserAppendChild(node); }

    bool fail(String&& message);
    bool startElement(const BunXMLEvent&, std::span<const BunXMLEvent> attributes);
    void endElement();

    bool declareNamespace(const AtomString& prefix, const AtomString& namespaceURI);
    bool declareNamespaces(std::span<const BunXMLEvent> attributes);
    const AtomString& namespaceURIForPrefix(const AtomString& prefix) const;
    std::optional<QualifiedName> qualifiedName(StringView, const AtomString& namespaceURIWithoutPrefix);
    bool hasAttributesWithTheSameExpandedName(const Vector<Attribute>&) const;

    const XMLEvents& m_events;
    const Ref<ContainerNode> m_root;
    const RefPtr<Element> m_contextElement;
    const OptionSet<ParserContentPolicy> m_parserContentPolicy;

    const AtomString m_xmlAtom;
    const AtomString m_xmlnsAtom;
    const AtomString m_xmlNamespaceURI;
    const AtomString m_xmlnsNamespaceURI;

    Vector<OpenElement> m_openElements;
    AtomString m_defaultNamespaceURI;
    HashMap<AtomString, AtomString> m_prefixToNamespaceMap;
    Vector<ShadowedBinding> m_shadowedBindings;

    String m_errorMessage;
    size_t m_errorPosition { 0 };
};

XMLTreeBuilder::XMLTreeBuilder(const XMLEvents& events, ContainerNode& root, Element* contextElement, OptionSet<ParserContentPolicy> parserContentPolicy)
    : m_events(events)
    , m_root(root)
    , m_contextElement(contextElement)
    , m_parserContentPolicy(parserContentPolicy)
    , m_xmlAtom(xmlAtom())
    , m_xmlnsAtom(xmlnsAtom())
    , m_xmlNamespaceURI(XMLNames::xmlNamespaceURI)
    , m_xmlnsNamespaceURI(XMLNSNames::xmlnsNamespaceURI)
{
    if (contextElement)
        m_defaultNamespaceURI = contextElement->lookupNamespaceURI(nullAtom());
}

bool XMLTreeBuilder::fail(String&& message)
{
    m_errorMessage = WTF::move(message);
    return false;
}

bool XMLTreeBuilder::build(std::span<const BunXMLEvent> events)
{
    for (size_t i = 0; i < events.size(); ++i) {
        auto& event = events[i];
        switch (event.kind) {
        case BunXMLEventKind::StartElement: {
            size_t attributesEnd = i + 1;
            while (attributesEnd < events.size() && events[attributesEnd].kind == BunXMLEventKind::Attribute)
                ++attributesEnd;
            if (!startElement(event, events.subspan(i + 1, attributesEnd - i - 1)))
                return false;
            i = attributesEnd - 1;
            break;
        }
        case BunXMLEventKind::Attribute:
            ASSERT_NOT_REACHED();
            break;
        case BunXMLEventKind::EndElement:
            endElement();
            break;
        case BunXMLEventKind::Text:
            append(Text::create(protect(currentNode().document()), m_events.string(event.first)));
            break;
        case BunXMLEventKind::CDATASection:
            append(CDATASection::create(protect(currentNode().document()), m_events.string(event.first)));
            break;
        case BunXMLEventKind::Comment:
            append(Comment::create(protect(currentNode().document()), m_events.string(event.first)));
            break;
        case BunXMLEventKind::ProcessingInstruction:
            append(ProcessingInstruction::create(protect(currentNode().document()), m_events.string(event.first), m_events.string(event.second)));
            break;
        case BunXMLEventKind::DocumentType: {
            auto& list = m_events.list();
            append(DocumentType::create(protect(currentNode().document()), m_events.string(list.doctypeName), m_events.string(list.doctypePublicId), m_events.string(list.doctypeSystemId)));
            break;
        }
        }
    }
    return true;
}

// https://www.w3.org/TR/xml-names/#xmlReserved and https://www.w3.org/TR/xml-names/#nsc-NoPrefixUndecl
bool XMLTreeBuilder::declareNamespace(const AtomString& prefix, const AtomString& namespaceURI)
{
    if (prefix == m_xmlnsAtom)
        return fail("The namespace prefix 'xmlns' cannot be declared"_s);
    if (prefix == m_xmlAtom) {
        if (namespaceURI != m_xmlNamespaceURI)
            return fail("The namespace prefix 'xml' cannot be bound to another namespace"_s);
        return true;
    }
    if (namespaceURI == m_xmlNamespaceURI || namespaceURI == m_xmlnsNamespaceURI)
        return fail(makeString("The namespace '"_s, namespaceURI, prefix.isNull() ? "' cannot be the default namespace"_s : "' cannot be bound to another prefix"_s));

    if (prefix.isNull()) {
        m_shadowedBindings.append({ nullAtom(), std::exchange(m_defaultNamespaceURI, namespaceURI.isEmpty() ? nullAtom() : namespaceURI) });
        return true;
    }
    if (namespaceURI.isEmpty())
        return fail(makeString("The namespace prefix '"_s, prefix, "' cannot be bound to an empty namespace"_s));
    auto result = m_prefixToNamespaceMap.add(prefix, namespaceURI);
    m_shadowedBindings.append({ prefix, result.isNewEntry ? nullAtom() : std::exchange(result.iterator->value, namespaceURI) });
    return true;
}

static bool isNCName(StringView name)
{
    return !name.contains(':') && NameValidation::isValidXMLName(name);
}

bool XMLTreeBuilder::declareNamespaces(std::span<const BunXMLEvent> attributes)
{
    for (auto& attribute : attributes) {
        auto name = m_events.view(attribute.first);
        if (!name.startsWith("xmlns"_s))
            continue;
        if (name.length() == 5) {
            if (!declareNamespace(nullAtom(), m_events.atomString(attribute.second)))
                return false;
        } else if (name[5] == ':') {
            auto prefix = name.substring(6);
            if (!isNCName(prefix))
                return fail(makeString('\'', name, "' does not declare a namespace prefix"_s));
            if (!declareNamespace(prefix.toAtomString(), m_events.atomString(attribute.second)))
                return false;
        }
    }
    return true;
}

const AtomString& XMLTreeBuilder::namespaceURIForPrefix(const AtomString& prefix) const
{
    if (prefix == m_xmlAtom)
        return m_xmlNamespaceURI;
    auto iterator = m_prefixToNamespaceMap.find(prefix);
    if (iterator != m_prefixToNamespaceMap.end())
        return iterator->value;
    if (m_contextElement)
        return m_contextElement->lookupNamespaceURI(prefix);
    return nullAtom();
}

// https://www.w3.org/TR/xml-names/#ns-qualnames and https://www.w3.org/TR/xml-names/#nsc-NSDeclared
std::optional<QualifiedName> XMLTreeBuilder::qualifiedName(StringView name, const AtomString& namespaceURIWithoutPrefix)
{
    size_t colon = name.find(':');
    if (colon == notFound)
        return QualifiedName { nullAtom(), name.toAtomString(), namespaceURIWithoutPrefix };

    auto localName = name.substring(colon + 1);
    if (!colon || !isNCName(localName)) {
        fail(makeString('\'', name, "' is not a qualified name"_s));
        return std::nullopt;
    }

    auto prefix = name.left(colon).toAtomString();
    auto& namespaceURI = namespaceURIForPrefix(prefix);
    if (namespaceURI.isNull()) {
        fail(makeString("The namespace prefix '"_s, prefix, "' is not declared"_s));
        return std::nullopt;
    }
    return QualifiedName { prefix, localName.toAtomString(), namespaceURI };
}

// https://www.w3.org/TR/xml-names/#uniqAttrs. The parser has seen to it that no two have the same qualified name.
bool XMLTreeBuilder::hasAttributesWithTheSameExpandedName(const Vector<Attribute>& attributes) const
{
    HashSet<std::pair<AtomString, AtomString>> expandedNames;
    for (auto& attribute : attributes) {
        if (attribute.prefix().isNull() || attribute.namespaceURI() == m_xmlnsNamespaceURI)
            continue;
        if (!expandedNames.add({ attribute.namespaceURI(), attribute.localName() }).isNewEntry)
            return true;
    }
    return false;
}

bool XMLTreeBuilder::startElement(const BunXMLEvent& startTag, std::span<const BunXMLEvent> attributeEvents)
{
    m_errorPosition = startTag.position;

    if (m_openElements.size() >= maxXMLTreeDepth)
        return fail("Excessive node nesting."_s);

    size_t shadowedBindingCount = m_shadowedBindings.size();
    if (!declareNamespaces(attributeEvents))
        return false;

    auto tagName = qualifiedName(m_events.view(startTag.first), m_defaultNamespaceURI);
    if (!tagName)
        return false;

    bool shouldUseNullCustomElementRegistry = false;
    unsigned prefixedAttributeCount = 0;
    Vector<Attribute> attributes;
    attributes.reserveInitialCapacity(attributeEvents.size());
    for (auto& event : attributeEvents) {
        auto name = m_events.view(event.first);
        if (name == "xmlns"_s) {
            attributes.append(Attribute { XMLNSNames::xmlnsAttr, m_events.atomString(event.second) });
            continue;
        }
        if (name.startsWith("xmlns:"_s)) {
            attributes.append(Attribute { QualifiedName { m_xmlnsAtom, name.substring(6).toAtomString(), m_xmlnsNamespaceURI }, m_events.atomString(event.second) });
            continue;
        }
        auto attributeName = qualifiedName(name, nullAtom());
        if (!attributeName)
            return false;
        if (*attributeName == HTMLNames::customelementregistryAttr)
            shouldUseNullCustomElementRegistry = true;
        prefixedAttributeCount += !attributeName->prefix().isNull();
        attributes.append(Attribute { *attributeName, m_events.atomString(event.second) });
    }
    if (prefixedAttributeCount > 1 && hasAttributesWithTheSameExpandedName(attributes))
        return fail("Two attributes have the same local name and namespace"_s);

    Ref currentNode = this->currentNode();
    Ref document = currentNode->document();
    RefPtr registry = shouldUseNullCustomElementRegistry ? nullptr : CustomElementRegistry::registryForNodeOrTreeScope(currentNode, protect(currentNode->treeScope()));
    Ref element = document->createElement(*tagName, true, registry.get());

    if (!scriptingContentIsAllowed(m_parserContentPolicy))
        element->stripScriptingAttributes(attributes);
    element->parserSetAttributes(attributes.span());

    element->beginParsingChildren();
    currentNode->parserAppendChild(element);

    Ref<ContainerNode> container = element;
    if (RefPtr templateElement = dynamicDowncast<HTMLTemplateElement>(element))
        container = templateElement->content();
    m_openElements.append({ WTF::move(element), WTF::move(container), shadowedBindingCount });
    return true;
}

void XMLTreeBuilder::endElement()
{
    auto [element, container, shadowedBindingCount] = m_openElements.takeLast();

    while (m_shadowedBindings.size() > shadowedBindingCount) {
        auto [prefix, namespaceURI] = m_shadowedBindings.takeLast();
        if (prefix.isNull())
            m_defaultNamespaceURI = WTF::move(namespaceURI);
        else if (namespaceURI.isNull())
            m_prefixToNamespaceMap.remove(prefix);
        else
            m_prefixToNamespaceMap.set(prefix, WTF::move(namespaceURI));
    }

    element->finishParsingChildren();

    if (!scriptingContentIsAllowed(m_parserContentPolicy) && isScriptElement(element)) {
        element->remove();
        return;
    }

    // No script of an XML document runs, and none may start to when it is cloned or adopted into a document that runs scripts.
    if (!m_parserContentPolicy.contains(ParserContentPolicy::DoNotMarkAlreadyStarted)) {
        if (auto* scriptElement = dynamicDowncastScriptElement(element))
            scriptElement->markAlreadyStarted();
    }
}

void XMLTreeBuilder::closeOpenElements()
{
    while (!m_openElements.isEmpty())
        endElement();
}

static TextPosition textPositionAt(StringView source, size_t offset)
{
    unsigned line = 0;
    size_t lineStart = 0;
    offset = std::min<size_t>(offset, source.length());
    for (size_t i = 0; i < offset; ++i) {
        auto character = source[i];
        if (character == '\n' || (character == '\r' && (i + 1 == source.length() || source[i + 1] != '\n'))) {
            ++line;
            lineStart = i + 1;
        }
    }
    return { OrdinalNumber::fromZeroBasedInt(line), OrdinalNumber::fromZeroBasedInt(offset - lineStart) };
}

XMLDocumentParser::XMLDocumentParser(Document& document, OptionSet<ParserContentPolicy> policy)
    : ScriptableDocumentParser(document, policy)
{
}

XMLDocumentParser::~XMLDocumentParser() = default;

void XMLDocumentParser::insert(SegmentedString&&)
{
    ASSERT_NOT_REACHED();
}

void XMLDocumentParser::append(RefPtr<StringImpl>&& inputSource)
{
    if (isStopped())
        return;
    m_source.append(String { WTF::move(inputSource) });
}

TextPosition XMLDocumentParser::textPosition() const
{
    return { };
}

void XMLDocumentParser::parse()
{
    Ref document = *this->document();

    // Lone surrogates are not valid XML characters. Replace them with U+FFFD to do a best-effort parse instead (matching Firefox and Blink).
    auto source = replaceUnpairedSurrogatesWithReplacementCharacter(String { m_source.toString() });
    m_source.clear();

    XMLEvents events { source };

    auto& list = events.list();
    document->setHasXMLDeclaration(list.hasXMLDeclaration);
    if (list.hasXMLDeclaration) {
        document->setXMLVersion(events.string(list.xmlVersion));
        if (list.standalone != BunXMLStandalone::Unspecified)
            document->setXMLStandalone(list.standalone == BunXMLStandalone::Yes);
        if (list.xmlEncoding.length)
            document->setXMLEncoding(events.string(list.xmlEncoding));
    }

    XMLTreeBuilder builder { events, document, nullptr, parserContentPolicy() };
    bool wasBuilt = builder.build(events.events());
    if (wasBuilt && events.isWellFormed())
        return;

    m_sawError = true;
    builder.closeOpenElements();
    XMLErrors errors { document };
    errors.handleError(XMLErrors::Type::Fatal, makeString(wasBuilt ? events.errorMessage() : builder.errorMessage(), '\n'), textPositionAt(source, wasBuilt ? events.errorPosition() : builder.errorPosition()));
    errors.insertErrorMessageBlock();
}

void XMLDocumentParser::finish()
{
    Ref protectedThis { *this };

    if (!isStopped())
        parse();
    if (isDetached())
        return;

    if (isParsing())
        prepareToStopParsing();

    Ref document = *this->document();
    document->setReadyState(Document::ReadyState::Interactive);

    // Setting the ready state above dispatches readystatechange, which can run arbitrary scripts.
    if (isDetached())
        return;

    document->finishedParsing();
}

// https://html.spec.whatwg.org/multipage/xhtml.html#xml-fragment-parsing-algorithm
bool XMLDocumentParser::parseDocumentFragment(const String& chunk, DocumentFragment& fragment, Element* contextElement, OptionSet<ParserContentPolicy> parserContentPolicy)
{
    if (!chunk.length())
        return true;

    // As upstream: the text of a script or a style is not markup.
    if (contextElement && (contextElement->hasLocalName(HTMLNames::scriptTag->localName()) || contextElement->hasLocalName(HTMLNames::styleTag->localName()))) {
        fragment.parserAppendChild(protect(fragment.document())->createTextNode(String { chunk }));
        return true;
    }

    // An end tag in the chunk cannot close the root early: the parser takes no tag after the end of the root, and the last one here is a tag.
    XMLEvents events { makeString("<root>"_s, replaceUnpairedSurrogatesWithReplacementCharacter(String { chunk }), "</root>"_s) };
    if (!events.isWellFormed())
        return false;

    auto content = events.events();
    return XMLTreeBuilder { events, fragment, contextElement, parserContentPolicy }.build(content.subspan(1, content.size() - 2));
}

} // namespace WebCore
