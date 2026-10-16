/*
 * Copyright (C) 2010-2016 Google, Inc. All rights reserved.
 * Copyright (C) 2011-2023 Apple Inc. All rights reserved.
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
 * THIS SOFTWARE IS PROVIDED BY GOOGLE INC. ``AS IS'' AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL GOOGLE INC. OR
 * CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
 * EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
 * PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
 * PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY
 * OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

#include "config.h"
#include "HTMLTreeBuilder.h"

#include "CommonAtomStrings.h"
#include "ContainerNodeInlines.h"
#include "CustomElementRegistry.h"
#include "DOMClientData.h"
#include "DocumentFragment.h"
#include "HTMLDocument.h"
#include "HTMLDocumentParser.h"
#include "HTMLFormElement.h"
#include "HTMLParserIdioms.h"
#include "HTMLScriptElement.h"
#include "HTMLTemplateElement.h"
#include "JSCustomElementInterface.h"
#include "MathMLNames.h"
#include "SVGNames.h"
#include "XLinkNames.h"
#include "XMLNSNames.h"
#include "XMLNames.h"
#include <wtf/TZoneMallocInlines.h>
#include <wtf/text/MakeString.h>
#include <wtf/text/ParsingUtilities.h>
#include <wtf/unicode/CharacterNames.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(HTMLTreeBuilder);

using namespace ElementNames;
using namespace HTMLNames;

CustomElementConstructionData::CustomElementConstructionData(Ref<JSCustomElementInterface>&& customElementInterface, Ref<CustomElementRegistry>&& registry, const AtomString& name, Vector<Attribute>&& attributes)
    : elementInterface(WTF::move(customElementInterface))
    , registry(WTF::move(registry))
    , name(name)
    , attributes(WTF::move(attributes))
{
}

CustomElementConstructionData::~CustomElementConstructionData() = default;

namespace {

inline bool LEGACY_NODELETE isASCIIWhitespaceOrReplacementCharacter(char16_t character)
{
    return isASCIIWhitespace(character) || character == replacementCharacter;
}

}

static inline TextPosition LEGACY_NODELETE uninitializedPositionValue1()
{
    return TextPosition(OrdinalNumber::fromOneBasedInt(-1), OrdinalNumber());
}

#if ASSERT_ENABLED
static bool isTableBodyContextTag(TagName tagName)
{
    return tagName == TagName::tbody
        || tagName == TagName::tfoot
        || tagName == TagName::thead;
}

static bool isTableBodyContextElement(ElementName elementName)
{
    return elementName == HTML::tbody
        || elementName == HTML::tfoot
        || elementName == HTML::thead;
}
#endif

static bool LEGACY_NODELETE isNonAnchorNonNobrFormattingTag(TagName tagName)
{
    return tagName == TagName::b
        || tagName == TagName::big
        || tagName == TagName::code
        || tagName == TagName::em
        || tagName == TagName::font
        || tagName == TagName::i
        || tagName == TagName::s
        || tagName == TagName::small_
        || tagName == TagName::strike
        || tagName == TagName::strong
        || tagName == TagName::tt
        || tagName == TagName::u;
}

static bool LEGACY_NODELETE isNonAnchorFormattingTag(TagName tagName)
{
    return tagName == TagName::nobr || isNonAnchorNonNobrFormattingTag(tagName);
}

// https://html.spec.whatwg.org/multipage/syntax.html#formatting
bool LEGACY_NODELETE HTMLConstructionSite::isFormattingTag(TagName tagName)
{
    return tagName == TagName::a || isNonAnchorFormattingTag(tagName);
}

class HTMLTreeBuilder::ExternalCharacterTokenBuffer {
public:
    explicit ExternalCharacterTokenBuffer(AtomHTMLToken& token)
        : m_text(token.characters())
        , m_isAll8BitData(token.charactersIsAll8BitData())
    {
        ASSERT(!isEmpty());
    }

    explicit ExternalCharacterTokenBuffer(const String& string)
        : m_text(string)
        , m_isAll8BitData(m_text.is8Bit())
    {
        ASSERT(!isEmpty());
    }

    ~ExternalCharacterTokenBuffer()
    {
        ASSERT(isEmpty());
    }

    bool LEGACY_NODELETE isEmpty() const { return m_text.isEmpty(); }

    bool LEGACY_NODELETE isAll8BitData() const { return m_isAll8BitData; }

    void LEGACY_NODELETE skipAtMostOneLeadingNewline()
    {
        ASSERT(!isEmpty());
        if (m_text[0] == '\n')
            m_text = m_text.substring(1);
    }

    void LEGACY_NODELETE skipLeadingWhitespace()
    {
        skipLeading<isASCIIWhitespace>();
    }

    String takeLeadingWhitespace()
    {
        return takeLeading<isASCIIWhitespace>();
    }

    void LEGACY_NODELETE skipLeadingNonWhitespace()
    {
        skipLeading<isNotASCIIWhitespace>();
    }

    String takeRemaining()
    {
        auto result = makeString(m_text);
        m_text = StringView();
        return result;
    }

    void giveRemainingTo(StringBuilder& recipient)
    {
        recipient.append(m_text);
        m_text = StringView();
    }

    String takeRemainingWhitespace()
    {
        ASSERT(!isEmpty());
        Vector<Latin1Character, 8> whitespace;
        do {
            char16_t character = m_text[0];
            if (isASCIIWhitespace(character))
                whitespace.append(character);
            m_text = m_text.substring(1);
        } while (!m_text.isEmpty());

        // Returning the null string when there aren't any whitespace
        // characters is slightly cleaner semantically because we don't want
        // to insert a text node (as opposed to inserting an empty text node).
        if (whitespace.isEmpty())
            return String();

        return String::adopt(WTF::move(whitespace));
    }

private:
    template<bool characterPredicate(char16_t)> void LEGACY_NODELETE skipLeading()
    {
        ASSERT(!isEmpty());
        while (characterPredicate(m_text[0])) {
            m_text = m_text.substring(1);
            if (m_text.isEmpty())
                return;
        }
    }

    template<bool characterPredicate(char16_t)> String takeLeading()
    {
        ASSERT(!isEmpty());
        StringView start = m_text;
        skipLeading<characterPredicate>();
        if (start.length() == m_text.length())
            return String();
        return makeString(start.left(start.length() - m_text.length()));
    }

    String makeString(StringView stringView) const
    {
        if (stringView.is8Bit() || !isAll8BitData())
            return stringView.toString();
        return String::make8Bit(stringView.span16());
    }

    StringView m_text;
    bool m_isAll8BitData;
};

inline bool HTMLTreeBuilder::isParsingTemplateContents() const
{
    if (m_tree.openElements().containsTemplateElement() && m_tree.openElements().hasTemplateInHTMLScope())
        return true;
    return m_fragmentContext.contextElementIsTemplate();
}

inline bool HTMLTreeBuilder::isParsingFragmentOrTemplateContents() const
{
    return isParsingFragment() || isParsingTemplateContents();
}

HTMLTreeBuilder::HTMLTreeBuilder(HTMLDocumentParser& parser, HTMLDocument& document, OptionSet<ParserContentPolicy> parserContentPolicy, const HTMLParserOptions& options)
    : m_parser(parser)
    , m_options(options)
    , m_tree(document, parserContentPolicy, options.maximumDOMTreeDepth)
    , m_scriptToProcessStartPosition(uninitializedPositionValue1())
{
#if ASSERT_ENABLED
    m_destructionProhibited = false;
#endif
}

HTMLTreeBuilder::HTMLTreeBuilder(HTMLDocumentParser& parser, DocumentFragment& fragment, Element& contextElement, OptionSet<ParserContentPolicy> parserContentPolicy, const HTMLParserOptions& options, CustomElementRegistry* registry)
    : m_parser(parser)
    , m_options(options)
    , m_fragmentContext(fragment, contextElement)
    , m_tree(fragment, parserContentPolicy, options.maximumDOMTreeDepth, registry)
    , m_scriptToProcessStartPosition(uninitializedPositionValue1())
{
    // https://html.spec.whatwg.org/multipage/syntax.html#parsing-html-fragments
    // For efficiency, we skip step 5 ("Let root be a new html element with no attributes") and instead use the DocumentFragment as a root node.
    m_tree.openElements().pushRootNode(HTMLStackItem(fragment));

    if (contextElement.elementName() == HTML::template_)
        m_templateInsertionModes.append(InsertionMode::TemplateContents);

    resetInsertionModeAppropriately();

    auto* formElement = dynamicDowncast<HTMLFormElement>(contextElement);
    m_tree.setForm(protect(formElement ? formElement : HTMLFormElement::findClosestFormAncestor(contextElement)));

    // Characters are tokenized before any token reaches the tree builder, so the tokenizer flags
    // implied by the context element have to be set up front rather than after the first token.
    updateTokenizerForAdjustedCurrentNode();

#if ASSERT_ENABLED
    m_destructionProhibited = false;
#endif
}

HTMLTreeBuilder::FragmentParsingContext::FragmentParsingContext() = default;

HTMLTreeBuilder::FragmentParsingContext::FragmentParsingContext(DocumentFragment& fragment, Element& contextElement)
    : m_fragment(&fragment)
    , m_contextElementStackItem(contextElement)
{
    ASSERT(!fragment.hasChildNodes());
}

inline Element& HTMLTreeBuilder::FragmentParsingContext::contextElement()
{
    return contextElementStackItem().element();
}

inline HTMLStackItem& HTMLTreeBuilder::FragmentParsingContext::contextElementStackItem()
{
    ASSERT(m_fragment);
    return m_contextElementStackItem;
}

inline bool HTMLTreeBuilder::FragmentParsingContext::contextElementIsTemplate() const
{
    return m_fragment && m_contextElementStackItem.elementName() == HTML::template_;
}

RefPtr<ScriptElement> HTMLTreeBuilder::takeScriptToProcess(TextPosition& scriptStartPosition)
{
    ASSERT(!m_destroyed);

    if (!m_scriptToProcess)
        return nullptr;

    // Unpause ourselves, callers may pause us again when processing the script.
    // The HTML5 spec is written as though scripts are executed inside the tree builder.
    // We pause the parser to exit the tree builder, and then resume before running scripts.
    scriptStartPosition = m_scriptToProcessStartPosition;
    m_scriptToProcessStartPosition = uninitializedPositionValue1();
    return WTF::move(m_scriptToProcess);
}

void HTMLTreeBuilder::constructTree(AtomHTMLToken&& token)
{
#if ASSERT_ENABLED
    ASSERT(!m_destroyed);
    ASSERT(!m_destructionProhibited);
    m_destructionProhibited = true;
#endif

    if (shouldProcessTokenInForeignContent(token))
        processTokenInForeignContent(WTF::move(token));
    else
        processToken(WTF::move(token));

    updateTokenizerForAdjustedCurrentNode();

#if ASSERT_ENABLED
    m_destructionProhibited = false;
#endif

    m_tree.executeQueuedTasks();
    // The tree builder might have been destroyed as an indirect result of executing the queued tasks.
}

void HTMLTreeBuilder::updateTokenizerForAdjustedCurrentNode()
{
    // Both flags are computed from the adjusted current node, matching the tree construction
    // dispatcher. When fragment-parsing with only one element on the stack, the adjusted current
    // node is the context element, not the DocumentFragment.
    //
    // These two flags use different conditions:
    // - shouldAllowCDATA follows the tokenizer's markup declaration open state, which switches to
    //   the CDATA section state whenever there is an adjusted current node and it is not an element
    //   in the HTML namespace. Integration points are NOT a consideration there, so CDATA sections
    //   are allowed even when the adjusted current node is an integration point.
    //   https://html.spec.whatwg.org/multipage/parsing.html#markup-declaration-open-state
    // - forceNullCharacterReplacement follows the dispatcher's notion of foreign content (used to
    //   replace U+0000 NULL with U+FFFD), which treats integration points as HTML content and thus
    //   excludes them.
    //   https://html.spec.whatwg.org/multipage/parsing.html#tree-construction
    bool adjustedCurrentNodeIsForeign = !m_tree.isEmpty() && !isInHTMLNamespace(adjustedCurrentStackItem());
    bool inForeignContent = adjustedCurrentNodeIsForeign
        && !HTMLElementStack::isHTMLIntegrationPoint(adjustedCurrentStackItem())
        && !HTMLElementStack::isMathMLTextIntegrationPoint(adjustedCurrentStackItem());

    m_parser->tokenizer().setForceNullCharacterReplacement(inForeignContent);
    m_parser->tokenizer().setShouldAllowCDATA(adjustedCurrentNodeIsForeign);
}

void HTMLTreeBuilder::processToken(AtomHTMLToken&& token)
{
    switch (token.type()) {
    case HTMLToken::Type::Uninitialized:
        ASSERT_NOT_REACHED();
        break;
    case HTMLToken::Type::DOCTYPE:
        m_shouldSkipLeadingNewline = false;
        processDoctypeToken(WTF::move(token));
        break;
    case HTMLToken::Type::StartTag:
        m_shouldSkipLeadingNewline = false;
        processStartTag(WTF::move(token));
        break;
    case HTMLToken::Type::EndTag:
        m_shouldSkipLeadingNewline = false;
        processEndTag(WTF::move(token));
        break;
    case HTMLToken::Type::Comment:
        m_shouldSkipLeadingNewline = false;
        processComment(WTF::move(token));
        return;
    case HTMLToken::Type::Character:
        processCharacter(WTF::move(token));
        break;
    case HTMLToken::Type::EndOfFile:
        m_shouldSkipLeadingNewline = false;
        processEndOfFile(WTF::move(token));
        break;
    }
}

void HTMLTreeBuilder::processDoctypeToken(AtomHTMLToken&& token)
{
    ASSERT(token.type() == HTMLToken::Type::DOCTYPE);
    if (m_insertionMode == InsertionMode::Initial) {
        m_tree.insertDoctype(WTF::move(token));
        m_insertionMode = InsertionMode::BeforeHTML;
        return;
    }
    if (m_insertionMode == InsertionMode::InTableText) {
        defaultForInTableText();
        processDoctypeToken(WTF::move(token));
        return;
    }
    parseError(token);
}

void HTMLTreeBuilder::processFakeStartTag(TagName tagName, Vector<Attribute>&& attributes)
{
    // FIXME: We'll need a fancier conversion than just "localName" for SVG/MathML tags.
    AtomHTMLToken fakeToken(HTMLToken::Type::StartTag, tagName, WTF::move(attributes));
    processStartTag(WTF::move(fakeToken));
}

void HTMLTreeBuilder::processFakeEndTag(TagName tagName)
{
    AtomHTMLToken fakeToken(HTMLToken::Type::EndTag, tagName);
    processEndTag(WTF::move(fakeToken));
}

void HTMLTreeBuilder::processFakeEndTag(const HTMLStackItem& item)
{
    AtomHTMLToken fakeToken(HTMLToken::Type::EndTag, tagNameForElementName(item.elementName()), item.localName());
    processEndTag(WTF::move(fakeToken));
}

void HTMLTreeBuilder::processFakeCharacters(const String& characters)
{
    ASSERT(!characters.isEmpty());
    ExternalCharacterTokenBuffer buffer(characters);
    processCharacterBuffer(buffer);
}

void HTMLTreeBuilder::processFakePEndTagIfPInButtonScope()
{
    if (!m_tree.openElements().inButtonScope(HTML::p))
        return;
    AtomHTMLToken endP(HTMLToken::Type::EndTag, TagName::p);
    processEndTag(WTF::move(endP));
}

namespace {

bool LEGACY_NODELETE isLi(const HTMLStackItem& item)
{
    return item.elementName() == HTML::li;
}

bool LEGACY_NODELETE isDdOrDt(const HTMLStackItem& item)
{
    return item.elementName() == HTML::dd || item.elementName() == HTML::dt;
}

}

template <bool shouldClose(const HTMLStackItem&)> void HTMLTreeBuilder::processCloseWhenNestedTag(AtomHTMLToken&& token)
{
    m_framesetOk = false;
    for (auto* nodeRecord = &m_tree.openElements().topRecord(); ; nodeRecord = nodeRecord->next()) {
        HTMLStackItem& item = nodeRecord->stackItem();
        if (shouldClose(item)) {
            ASSERT(item.isElement());
            processFakeEndTag(item);
            break;
        }
        if (isSpecialNode(item) && item.elementName() != HTML::address && item.elementName() != HTML::div && item.elementName() != HTML::p)
            break;
    }
    processFakePEndTagIfPInButtonScope();
    m_tree.insertHTMLElement(WTF::move(token));
}

static void LEGACY_NODELETE adjustSVGTagNameCase(AtomHTMLToken& token)
{
    if (auto currentTagName = token.tagName(); currentTagName != TagName::Unknown)
        token.setTagName(adjustSVGTagName(currentTagName));
}

static inline void adjustAttributes(const MemoryCompactLookupOnlyRobinHoodHashMap<AtomString, QualifiedName>& map, AtomHTMLToken& token)
{
    for (auto& attribute : token.attributes()) {
        const QualifiedName& casedName = map.get(attribute.localName());
        if (!casedName.localName().isNull())
            attribute.parserSetName(casedName);
    }
}

// https://html.spec.whatwg.org/multipage/parsing.html#adjust-svg-attributes
static MemoryCompactLookupOnlyRobinHoodHashMap<AtomString, QualifiedName> createSVGAttributesMap()
{
    MemoryCompactLookupOnlyRobinHoodHashMap<AtomString, QualifiedName> map;

    const auto svgAttrs = WTF::toArray<QualifiedName>({
        SVGNames::attributeNameAttr,
        SVGNames::attributeTypeAttr,
        SVGNames::baseFrequencyAttr,
        SVGNames::baseProfileAttr,
        SVGNames::calcModeAttr,
        SVGNames::clipPathUnitsAttr,
        SVGNames::diffuseConstantAttr,
        SVGNames::edgeModeAttr,
        SVGNames::filterUnitsAttr,
        SVGNames::glyphRefAttr,
        SVGNames::gradientTransformAttr,
        SVGNames::gradientUnitsAttr,
        SVGNames::kernelMatrixAttr,
        SVGNames::kernelUnitLengthAttr,
        SVGNames::keyPointsAttr,
        SVGNames::keySplinesAttr,
        SVGNames::keyTimesAttr,
        SVGNames::lengthAdjustAttr,
        SVGNames::limitingConeAngleAttr,
        SVGNames::markerHeightAttr,
        SVGNames::markerUnitsAttr,
        SVGNames::markerWidthAttr,
        SVGNames::maskContentUnitsAttr,
        SVGNames::maskUnitsAttr,
        SVGNames::numOctavesAttr,
        SVGNames::pathLengthAttr,
        SVGNames::patternContentUnitsAttr,
        SVGNames::patternTransformAttr,
        SVGNames::patternUnitsAttr,
        SVGNames::pointsAtXAttr,
        SVGNames::pointsAtYAttr,
        SVGNames::pointsAtZAttr,
        SVGNames::preserveAlphaAttr,
        SVGNames::preserveAspectRatioAttr,
        SVGNames::primitiveUnitsAttr,
        SVGNames::refXAttr,
        SVGNames::refYAttr,
        SVGNames::repeatCountAttr,
        SVGNames::repeatDurAttr,
        SVGNames::requiredExtensionsAttr,
        SVGNames::requiredFeaturesAttr,
        SVGNames::specularConstantAttr,
        SVGNames::specularExponentAttr,
        SVGNames::spreadMethodAttr,
        SVGNames::startOffsetAttr,
        SVGNames::stdDeviationAttr,
        SVGNames::stitchTilesAttr,
        SVGNames::surfaceScaleAttr,
        SVGNames::systemLanguageAttr,
        SVGNames::tableValuesAttr,
        SVGNames::targetXAttr,
        SVGNames::targetYAttr,
        SVGNames::textLengthAttr,
        SVGNames::viewBoxAttr,
        SVGNames::viewTargetAttr,
        SVGNames::xChannelSelectorAttr,
        SVGNames::yChannelSelectorAttr,
        SVGNames::zoomAndPanAttr,
    });

    for (auto name : svgAttrs)
        map.add(name.localNameLowercase(), name);

    return map;
}

static inline void adjustSVGAttributes(AtomHTMLToken& token)
{
    adjustAttributes(domClientData().treeBuilderAttributeMaps().svgAttributes, token);
}

// https://html.spec.whatwg.org/multipage/parsing.html#adjust-mathml-attributes
static MemoryCompactLookupOnlyRobinHoodHashMap<AtomString, QualifiedName> createMathMLAttributesMap()
{
    MemoryCompactLookupOnlyRobinHoodHashMap<AtomString, QualifiedName> map;

    map.add("definitionurl"_s, MathMLNames::definitionURLAttr);

    return map;
}

static inline void adjustMathMLAttributes(AtomHTMLToken& token)
{
    adjustAttributes(domClientData().treeBuilderAttributeMaps().mathMLAttributes, token);
}

// https://html.spec.whatwg.org/multipage/parsing.html#adjust-foreign-attributes
static MemoryCompactLookupOnlyRobinHoodHashMap<AtomString, QualifiedName> createForeignAttributesMap()
{
    MemoryCompactLookupOnlyRobinHoodHashMap<AtomString, QualifiedName> map;

    auto addNameWithPrefix = [](MemoryCompactLookupOnlyRobinHoodHashMap<AtomString, QualifiedName>& map, const QualifiedName name, const AtomString& prefix) {
        const AtomString& localName = name.localName();
        map.add(makeAtomString(prefix, ':', localName), QualifiedName(prefix, localName, name.namespaceURI()));
    };

    AtomString xlinkName("xlink"_s);
    const auto xLinkAttrs = WTF::toArray<QualifiedName>({
        XLinkNames::actuateAttr,
        XLinkNames::arcroleAttr,
        XLinkNames::hrefAttr,
        XLinkNames::roleAttr,
        XLinkNames::showAttr,
        XLinkNames::titleAttr,
        XLinkNames::typeAttr,
    });
    for (auto name : xLinkAttrs)
        addNameWithPrefix(map, name, xlinkName);

    const auto xmlAttrs = WTF::toArray<QualifiedName>({
        XMLNames::langAttr,
        XMLNames::spaceAttr,
    });
    for (auto name : xmlAttrs)
        addNameWithPrefix(map, name, xmlAtom());

    map.add(xmlnsAtom(), XMLNSNames::xmlnsAttr);
    map.add("xmlns:xlink"_s, QualifiedName(xmlnsAtom(), xlinkName, XMLNSNames::xmlnsNamespaceURI));

    return map;
}

HTMLTreeBuilderAttributeMaps::HTMLTreeBuilderAttributeMaps()
    : svgAttributes(createSVGAttributesMap())
    , mathMLAttributes(createMathMLAttributesMap())
    , foreignAttributes(createForeignAttributesMap())
{
}

static void adjustForeignAttributes(AtomHTMLToken& token)
{
    adjustAttributes(domClientData().treeBuilderAttributeMaps().foreignAttributes, token);
}

void HTMLTreeBuilder::processStartTagForInBody(AtomHTMLToken&& token)
{
    ASSERT(token.type() == HTMLToken::Type::StartTag);
    switch (token.tagName()) {
    case TagName::html:
        processHtmlStartTagForInBody(WTF::move(token));
        return;
    case TagName::base:
    case TagName::basefont:
    case TagName::bgsound:
    case TagName::link:
    case TagName::meta:
    case TagName::noframes:
    case TagName::script:
    case TagName::style:
        if (m_options.enhancedSelectQuirk && m_tree.openElements().inScope(HTML::select)) {
            parseError(token);
            return;
        }
        [[fallthrough]];
    case TagName::title: {
        bool didProcess = processStartTagForInHead(WTF::move(token));
        ASSERT_UNUSED(didProcess, didProcess);
        return;
    }
    case TagName::body: {
        parseError(token);
        bool fragmentOrTemplateCase = !m_tree.openElements().secondElementIsHTMLBodyElement() || m_tree.openElements().hasOnlyOneElement()
            || m_tree.openElements().hasTemplateInHTMLScope();
        if (fragmentOrTemplateCase) {
            ASSERT(isParsingFragmentOrTemplateContents());
            return;
        }
        m_framesetOk = false;
        m_tree.insertHTMLBodyStartTagInBody(WTF::move(token));
        return;
    }
    case TagName::frameset:
        parseError(token);
        if (!m_tree.openElements().secondElementIsHTMLBodyElement() || m_tree.openElements().hasOnlyOneElement()) {
            ASSERT(isParsingFragmentOrTemplateContents());
            return;
        }
        if (!m_framesetOk)
            return;
        protect(m_tree.openElements().bodyElement())->remove();
        m_tree.openElements().popUntil(protect(m_tree.openElements().bodyElement()));
        m_tree.openElements().popHTMLBodyElement();
        // Note: in the fragment case the root is a DocumentFragment instead of a proper html element which is a quirk / optimization in WebKit.
        ASSERT(!isParsingFragment() || is<DocumentFragment>(m_tree.openElements().topNode()));
        ASSERT(isParsingFragment() || &m_tree.openElements().top() == &m_tree.openElements().htmlElement());
        m_tree.insertHTMLElement(WTF::move(token));
        m_insertionMode = InsertionMode::InFrameset;
        return;
    case TagName::address:
    case TagName::article:
    case TagName::aside:
    case TagName::blockquote:
    case TagName::center:
    case TagName::details:
    case TagName::dialog:
    case TagName::dir:
    case TagName::div:
    case TagName::dl:
    case TagName::fieldset:
    case TagName::figcaption:
    case TagName::figure:
    case TagName::footer:
    case TagName::header:
    case TagName::hgroup:
    case TagName::main:
    case TagName::menu:
    case TagName::nav:
    case TagName::ol:
    case TagName::p:
    case TagName::search:
    case TagName::section:
    case TagName::summary:
    case TagName::ul:
        processFakePEndTagIfPInButtonScope();
        m_tree.insertHTMLElement(WTF::move(token));
        return;
    case TagName::h1:
    case TagName::h2:
    case TagName::h3:
    case TagName::h4:
    case TagName::h5:
    case TagName::h6:
        processFakePEndTagIfPInButtonScope();
        if (isNumberedHeaderElement(m_tree.currentStackItem())) {
            parseError(token);
            m_tree.openElements().pop();
        }
        m_tree.insertHTMLElement(WTF::move(token));
        return;
    case TagName::pre:
    case TagName::listing:
        processFakePEndTagIfPInButtonScope();
        m_tree.insertHTMLElement(WTF::move(token));
        m_shouldSkipLeadingNewline = true;
        m_framesetOk = false;
        return;
    case TagName::form:
        if (m_tree.form() && !isParsingTemplateContents()) {
            parseError(token);
            return;
        }
        processFakePEndTagIfPInButtonScope();
        m_tree.insertHTMLFormElement(WTF::move(token), isParsingTemplateContents());
        return;
    case TagName::li:
        processCloseWhenNestedTag<isLi>(WTF::move(token));
        return;
    case TagName::dd:
    case TagName::dt:
        processCloseWhenNestedTag<isDdOrDt>(WTF::move(token));
        return;
    case TagName::plaintext:
        processFakePEndTagIfPInButtonScope();
        m_tree.insertHTMLElement(WTF::move(token));
        m_parser->tokenizer().setPLAINTEXTState();
        return;
    case TagName::button:
        if (m_tree.openElements().inScope(HTML::button)) {
            parseError(token);
            processFakeEndTag(TagName::button);
            processStartTag(WTF::move(token)); // FIXME: Could we just fall through here?
            return;
        }
        m_tree.reconstructTheActiveFormattingElements();
        m_tree.insertHTMLElement(WTF::move(token));
        m_framesetOk = false;
        return;
    case TagName::a: {
        RefPtr<Element> activeATag = m_tree.activeFormattingElements().closestElementInScopeWithName(HTML::a);
        if (activeATag) {
            parseError(token);
            processFakeEndTag(TagName::a);
            m_tree.activeFormattingElements().remove(*activeATag);
            if (m_tree.openElements().contains(*activeATag))
                m_tree.openElements().remove(*activeATag);
        }
        m_tree.reconstructTheActiveFormattingElements();
        m_tree.insertFormattingElement(WTF::move(token));
        return;
    }
    case TagName::b:
    case TagName::big:
    case TagName::code:
    case TagName::em:
    case TagName::font:
    case TagName::i:
    case TagName::s:
    case TagName::small_:
    case TagName::strike:
    case TagName::strong:
    case TagName::tt:
    case TagName::u:
        m_tree.reconstructTheActiveFormattingElements();
        m_tree.insertFormattingElement(WTF::move(token));
        return;
    case TagName::nobr:
        m_tree.reconstructTheActiveFormattingElements();
        if (m_tree.openElements().inScope(HTML::nobr)) {
            parseError(token);
            processFakeEndTag(TagName::nobr);
            m_tree.reconstructTheActiveFormattingElements();
        }
        m_tree.insertFormattingElement(WTF::move(token));
        return;
    case TagName::applet:
    case TagName::object:
    case TagName::marquee:
        m_tree.reconstructTheActiveFormattingElements();
        m_tree.insertHTMLElement(WTF::move(token));
        m_tree.activeFormattingElements().appendMarker();
        m_framesetOk = false;
        return;
    case TagName::table:
        if (!m_tree.inQuirksMode() && m_tree.openElements().inButtonScope(HTML::p))
            processFakeEndTag(TagName::p);
        m_tree.insertHTMLElement(WTF::move(token));
        m_framesetOk = false;
        m_insertionMode = InsertionMode::InTable;
        if (m_tree.hasReachedMaxDOMTreeDepth())
            resetInsertionModeAppropriately();
        return;
    case TagName::image:
        parseError(token);
        // Apparently we're not supposed to ask.
        token.setTagName(TagName::img);
        [[fallthrough]];
    case TagName::area:
    case TagName::br:
    case TagName::embed:
    case TagName::img:
    case TagName::keygen:
    case TagName::wbr:
        m_tree.reconstructTheActiveFormattingElements();
        m_tree.insertSelfClosingHTMLElement(WTF::move(token));
        m_framesetOk = false;
        return;
    case TagName::input: {
        if (m_options.enhancedSelect) {
            if (isParsingFragment() && m_fragmentContext.contextElement().elementName() == HTML::select) [[unlikely]] {
                parseError(token);
                return;
            }
            if (m_tree.openElements().inScope(HTML::select)) {
                parseError(token);
                m_tree.openElements().popUntilPopped(HTML::select);
            }
        }
        m_tree.reconstructTheActiveFormattingElements();
        auto* typeAttribute = findAttribute(token.attributes(), typeAttr);
        bool shouldClearFramesetOK = !typeAttribute || !equalLettersIgnoringASCIICase(typeAttribute->value(), "hidden"_s);
        m_tree.insertSelfClosingHTMLElement(WTF::move(token));
        if (shouldClearFramesetOK)
            m_framesetOk = false;
        return;
    }
    case TagName::param:
    case TagName::source:
    case TagName::track:
        m_tree.insertSelfClosingHTMLElement(WTF::move(token));
        return;
    case TagName::hr:
        processFakePEndTagIfPInButtonScope();
        if (m_options.enhancedSelect) {
            if (m_tree.openElements().inScope(HTML::select)) {
                m_tree.generateImpliedEndTags();
                if (m_tree.openElements().inScope(HTML::option) || m_tree.openElements().inScope(HTML::optgroup))
                    parseError(token);
            }
        }
        m_tree.insertSelfClosingHTMLElement(WTF::move(token));
        m_framesetOk = false;
        return;
    case TagName::textarea:
        m_tree.insertHTMLElement(WTF::move(token));
        m_shouldSkipLeadingNewline = true;
        m_parser->tokenizer().setRCDATAState();
        m_originalInsertionMode = m_insertionMode;
        m_framesetOk = false;
        m_insertionMode = InsertionMode::Text;
        return;
    case TagName::xmp:
        processFakePEndTagIfPInButtonScope();
        m_tree.reconstructTheActiveFormattingElements();
        m_framesetOk = false;
        processGenericRawTextStartTag(WTF::move(token));
        return;
    case TagName::iframe:
        m_framesetOk = false;
        processGenericRawTextStartTag(WTF::move(token));
        return;
    case TagName::noembed:
        processGenericRawTextStartTag(WTF::move(token));
        return;
    case TagName::noscript:
        if (m_options.scriptingFlag) {
            processGenericRawTextStartTag(WTF::move(token));
            return;
        }
        break;
    case TagName::select:
        if (m_options.enhancedSelect) {
            if (isParsingFragment() && m_fragmentContext.contextElement().elementName() == HTML::select) [[unlikely]] {
                parseError(token);
                return;
            }
            if (m_tree.openElements().inScope(HTML::select)) {
                parseError(token);
                m_tree.openElements().popUntilPopped(HTML::select);
                return;
            }
        }

        m_tree.reconstructTheActiveFormattingElements();
        m_tree.insertHTMLElement(WTF::move(token));
        m_framesetOk = false;

        if (m_options.enhancedSelect)
            return;

        if (m_insertionMode == InsertionMode::InTable
            || m_insertionMode == InsertionMode::InCaption
            || m_insertionMode == InsertionMode::InColumnGroup
            || m_insertionMode == InsertionMode::InTableBody
            || m_insertionMode == InsertionMode::InRow
            || m_insertionMode == InsertionMode::InCell)
            m_insertionMode = InsertionMode::InSelectInTable;
        else
            m_insertionMode = InsertionMode::InSelect;
        return;

    case TagName::optgroup:
        if (m_options.enhancedSelect && m_tree.openElements().inScope(HTML::select)) {
            m_tree.generateImpliedEndTags();
            if (m_tree.openElements().inScope(HTML::option) || m_tree.openElements().inScope(HTML::optgroup))
                parseError(token);
        } else if (m_tree.currentStackItem().elementName() == HTML::option)
            processFakeEndTag(TagName::option);

        m_tree.reconstructTheActiveFormattingElements();
        m_tree.insertHTMLElement(WTF::move(token));
        return;
    case TagName::option:
        if (m_options.enhancedSelect && m_tree.openElements().inScope(HTML::select)) {
            m_tree.generateImpliedEndTagsWithExclusion(HTML::optgroup);
            if (m_tree.openElements().inScope(HTML::option))
                parseError(token);
        } else if (m_tree.currentStackItem().elementName() == HTML::option)
            processFakeEndTag(TagName::option);

        m_tree.reconstructTheActiveFormattingElements();
        m_tree.insertHTMLElement(WTF::move(token));
        return;
    case TagName::rb:
    case TagName::rtc:
        if (m_tree.openElements().inScope(HTML::ruby)) {
            m_tree.generateImpliedEndTags();
            if (m_tree.currentStackItem().elementName() != HTML::ruby)
                parseError(token);
        }
        m_tree.insertHTMLElement(WTF::move(token));
        return;
    case TagName::rt:
    case TagName::rp:
        if (m_tree.openElements().inScope(HTML::ruby)) {
            m_tree.generateImpliedEndTagsWithExclusion(HTML::rtc);
            if (m_tree.currentStackItem().elementName() != HTML::ruby && m_tree.currentStackItem().elementName() != HTML::rtc)
                parseError(token);
        }
        m_tree.insertHTMLElement(WTF::move(token));
        return;
    case TagName::math:
        m_tree.reconstructTheActiveFormattingElements();
        adjustMathMLAttributes(token);
        adjustForeignAttributes(token);
        m_tree.insertForeignElement(WTF::move(token), MathMLNames::mathmlNamespaceURI);
        return;
    case TagName::svg:
        m_tree.reconstructTheActiveFormattingElements();
        adjustSVGAttributes(token);
        adjustForeignAttributes(token);
        m_tree.insertForeignElement(WTF::move(token), SVGNames::svgNamespaceURI);
        return;
    case TagName::caption:
    case TagName::col:
    case TagName::colgroup:
    case TagName::frame:
    case TagName::head:
    case TagName::tbody:
    case TagName::tfoot:
    case TagName::thead:
    case TagName::th:
    case TagName::td:
    case TagName::tr:
        parseError(token);
        return;
    case TagName::template_:
        m_framesetOk = false;
        processTemplateStartTag(WTF::move(token));
        return;
    default:
        break;
    }
    m_tree.reconstructTheActiveFormattingElements();
    insertGenericHTMLElement(WTF::move(token));
}

inline void HTMLTreeBuilder::insertGenericHTMLElement(AtomHTMLToken&& token)
{
    m_customElementToConstruct = m_tree.insertHTMLElementOrFindCustomElementInterface(WTF::move(token));
}

void HTMLTreeBuilder::didCreateCustomOrFallbackElement(Ref<Element>&& element, CustomElementConstructionData& data)
{
    m_tree.insertCustomElement(WTF::move(element), WTF::move(data.attributes));
}

void HTMLTreeBuilder::processTemplateStartTag(AtomHTMLToken&& token)
{
    m_tree.activeFormattingElements().appendMarker();
    m_tree.insertHTMLTemplateElement(WTF::move(token));
    m_framesetOk = false;
    m_templateInsertionModes.append(InsertionMode::TemplateContents);
    m_insertionMode = InsertionMode::TemplateContents;
}

bool HTMLTreeBuilder::processTemplateEndTag(AtomHTMLToken&& token)
{
    ASSERT(token.tagName() == TagName::template_);
    if (!m_tree.openElements().hasTemplateInHTMLScope()) {
        ASSERT(m_templateInsertionModes.isEmpty() || (m_templateInsertionModes.size() == 1 && m_fragmentContext.contextElement().elementName() == HTML::template_));
        parseError(token);
        return false;
    }
    m_tree.generateImpliedEndTags();
    if (m_tree.currentStackItem().elementName() != HTML::template_)
        parseError(token);
    m_tree.openElements().popUntil(HTML::template_);
    Ref templateElement = downcast<HTMLTemplateElement>(m_tree.openElements().top());
    m_tree.openElements().pop();

    m_tree.activeFormattingElements().clearToLastMarker();
    m_templateInsertionModes.removeLast();
    resetInsertionModeAppropriately();

    return true;
}

bool HTMLTreeBuilder::processEndOfFileForInTemplateContents(AtomHTMLToken&& token)
{
    AtomHTMLToken endTemplate(HTMLToken::Type::EndTag, TagName::template_);
    if (!processTemplateEndTag(WTF::move(endTemplate)))
        return false;

    processEndOfFile(WTF::move(token));
    return true;
}

bool HTMLTreeBuilder::processColgroupEndTagForInColumnGroup()
{
    bool ignoreFakeEndTag = m_tree.currentIsRootNode() || m_tree.currentElementName() == HTML::template_;

    if (ignoreFakeEndTag) {
        ASSERT(isParsingFragmentOrTemplateContents());
        // FIXME: parse error
        return false;
    }
    m_tree.openElements().pop();
    m_insertionMode = InsertionMode::InTable;
    return true;
}

// http://www.whatwg.org/specs/web-apps/current-work/multipage/tokenization.html#close-the-cell
void HTMLTreeBuilder::closeTheCell()
{
    ASSERT(m_insertionMode == InsertionMode::InCell);
    if (m_tree.openElements().inTableScope(HTML::td)) {
        ASSERT(!m_tree.openElements().inTableScope(HTML::th));
        processFakeEndTag(TagName::td);
        return;
    }
    ASSERT(m_tree.openElements().inTableScope(HTML::th));
    processFakeEndTag(TagName::th);
    ASSERT(m_insertionMode == InsertionMode::InRow);
}

void HTMLTreeBuilder::processStartTagForInTable(AtomHTMLToken&& token)
{
    ASSERT(token.type() == HTMLToken::Type::StartTag);
    switch (token.tagName()) {
    case TagName::caption:
        m_tree.openElements().popUntilTableScopeMarker();
        m_tree.activeFormattingElements().appendMarker();
        m_tree.insertHTMLElement(WTF::move(token));
        m_insertionMode = InsertionMode::InCaption;
        if (m_tree.hasReachedMaxDOMTreeDepth())
            resetInsertionModeAppropriately();
        return;
    case TagName::colgroup:
        m_tree.openElements().popUntilTableScopeMarker();
        m_tree.insertHTMLElement(WTF::move(token));
        m_insertionMode = InsertionMode::InColumnGroup;
        if (m_tree.hasReachedMaxDOMTreeDepth())
            resetInsertionModeAppropriately();
        return;
    case TagName::col:
        processFakeStartTag(TagName::colgroup);
        ASSERT(m_insertionMode == InsertionMode::InColumnGroup);
        processStartTag(WTF::move(token));
        return;
    case TagName::tbody:
    case TagName::tfoot:
    case TagName::thead:
        m_tree.openElements().popUntilTableScopeMarker();
        m_tree.insertHTMLElement(WTF::move(token));
        m_insertionMode = InsertionMode::InTableBody;
        if (m_tree.hasReachedMaxDOMTreeDepth())
            resetInsertionModeAppropriately();
        return;
    case TagName::th:
    case TagName::td:
    case TagName::tr:
        processFakeStartTag(TagName::tbody);
        ASSERT(m_insertionMode == InsertionMode::InTableBody || m_tree.hasReachedMaxDOMTreeDepth());
        processStartTag(WTF::move(token));
        return;
    case TagName::table:
        parseError(token);
        if (!processTableEndTagForInTable()) {
            ASSERT(isParsingFragmentOrTemplateContents() || m_tree.hasReachedMaxDOMTreeDepth());
            return;
        }
        processStartTag(WTF::move(token));
        return;
    case TagName::style:
    case TagName::script:
        processStartTagForInHead(WTF::move(token));
        return;
    case TagName::input: {
        auto* typeAttribute = findAttribute(token.attributes(), typeAttr);
        if (typeAttribute && equalLettersIgnoringASCIICase(typeAttribute->value(), "hidden"_s)) {
            parseError(token);
            m_tree.insertSelfClosingHTMLElement(WTF::move(token));
            return;
        }
        // Break out to "anything else" case.
        break;
    }
    case TagName::form:
        parseError(token);
        if (m_tree.form() && !isParsingTemplateContents())
            return;
        m_tree.insertHTMLFormElement(WTF::move(token), isParsingTemplateContents());
        m_tree.openElements().pop();
        return;
    case TagName::template_:
        processTemplateStartTag(WTF::move(token));
        return;
    default:
        break;
    }
    parseError(token);
    HTMLConstructionSite::RedirectToFosterParentGuard redirecter(m_tree);
    processStartTagForInBody(WTF::move(token));
}

void HTMLTreeBuilder::processStartTag(AtomHTMLToken&& token)
{
    ASSERT(token.type() == HTMLToken::Type::StartTag);
    switch (m_insertionMode) {
    case InsertionMode::Initial:
        defaultForInitial();
        ASSERT(m_insertionMode == InsertionMode::BeforeHTML);
        [[fallthrough]];
    case InsertionMode::BeforeHTML:
        if (token.tagName() == TagName::html) {
            m_tree.insertHTMLHtmlStartTagBeforeHTML(WTF::move(token));
            m_insertionMode = InsertionMode::BeforeHead;
            return;
        }
        defaultForBeforeHTML();
        ASSERT(m_insertionMode == InsertionMode::BeforeHead);
        [[fallthrough]];
    case InsertionMode::BeforeHead:
        if (token.tagName() == TagName::html) {
            processHtmlStartTagForInBody(WTF::move(token));
            return;
        }
        if (token.tagName() == TagName::head) {
            m_tree.insertHTMLHeadElement(WTF::move(token));
            m_insertionMode = InsertionMode::InHead;
            return;
        }
        defaultForBeforeHead();
        ASSERT(m_insertionMode == InsertionMode::InHead);
        [[fallthrough]];
    case InsertionMode::InHead:
        if (processStartTagForInHead(WTF::move(token)))
            return;
        defaultForInHead();
        ASSERT(m_insertionMode == InsertionMode::AfterHead);
        [[fallthrough]];
    case InsertionMode::AfterHead:
        switch (token.tagName()) {
        case TagName::html:
            processHtmlStartTagForInBody(WTF::move(token));
            return;
        case TagName::body:
            m_framesetOk = false;
            m_tree.insertHTMLBodyElement(WTF::move(token));
            m_insertionMode = InsertionMode::InBody;
            return;
        case TagName::frameset:
            m_tree.insertHTMLElement(WTF::move(token));
            m_insertionMode = InsertionMode::InFrameset;
            return;
        case TagName::base:
        case TagName::basefont:
        case TagName::bgsound:
        case TagName::link:
        case TagName::meta:
        case TagName::noframes:
        case TagName::script:
        case TagName::style:
        case TagName::template_:
        case TagName::title:
            parseError(token);
            ASSERT(!m_tree.headStackItem().isNull());
            m_tree.openElements().pushHTMLHeadElement(HTMLStackItem(m_tree.headStackItem()));
            processStartTagForInHead(WTF::move(token));
            m_tree.openElements().removeHTMLHeadElement(protect(m_tree.head()));
            return;
        case TagName::head:
            parseError(token);
            return;
        default:
            break;
        }
        defaultForAfterHead();
        ASSERT(m_insertionMode == InsertionMode::InBody);
        [[fallthrough]];
    case InsertionMode::InBody:
        processStartTagForInBody(WTF::move(token));
        break;
    case InsertionMode::InTable:
        processStartTagForInTable(WTF::move(token));
        break;
    case InsertionMode::InCaption:
        switch (token.tagName()) {
        case TagName::caption:
        case TagName::col:
        case TagName::colgroup:
        case TagName::tbody:
        case TagName::tfoot:
        case TagName::thead:
        case TagName::th:
        case TagName::td:
        case TagName::tr:
            parseError(token);
            if (!processCaptionEndTagForInCaption()) {
                ASSERT(isParsingFragment());
                return;
            }
            processStartTag(WTF::move(token));
            return;
        default:
            break;
        }
        processStartTagForInBody(WTF::move(token));
        break;
    case InsertionMode::InColumnGroup:
        switch (token.tagName()) {
        case TagName::html:
            processHtmlStartTagForInBody(WTF::move(token));
            return;
        case TagName::col:
            m_tree.insertSelfClosingHTMLElement(WTF::move(token));
            return;
        case TagName::template_:
            processTemplateStartTag(WTF::move(token));
            return;
        default:
            break;
        }
        if (!processColgroupEndTagForInColumnGroup()) {
            ASSERT(isParsingFragmentOrTemplateContents());
            return;
        }
        processStartTag(WTF::move(token));
        break;
    case InsertionMode::InTableBody:
        switch (token.tagName()) {
        case TagName::tr:
            m_tree.openElements().popUntilTableBodyScopeMarker(); // How is there ever anything to pop?
            m_tree.insertHTMLElement(WTF::move(token));
            m_insertionMode = InsertionMode::InRow;
            if (m_tree.hasReachedMaxDOMTreeDepth())
                resetInsertionModeAppropriately();
            return;
        case TagName::th:
        case TagName::td:
            parseError(token);
            processFakeStartTag(TagName::tr);
            ASSERT(m_insertionMode == InsertionMode::InRow || m_tree.hasReachedMaxDOMTreeDepth());
            processStartTag(WTF::move(token));
            return;
        case TagName::caption:
        case TagName::col:
        case TagName::colgroup:
        case TagName::tbody:
        case TagName::tfoot:
        case TagName::thead:
            if (!m_tree.openElements().hasAnyInTableScope({ HTML::tbody, HTML::thead, HTML::tfoot })) {
                ASSERT(isParsingFragmentOrTemplateContents() || m_tree.hasReachedMaxDOMTreeDepth());
                parseError(token);
                return;
            }
            m_tree.openElements().popUntilTableBodyScopeMarker();
            ASSERT(isTableBodyContextElement(m_tree.currentStackItem().elementName()));
            processFakeEndTag(m_tree.currentStackItem());
            processStartTag(WTF::move(token));
            return;
        default:
            break;
        }
        processStartTagForInTable(WTF::move(token));
        break;
    case InsertionMode::InRow:
        switch (token.tagName()) {
        case TagName::th:
        case TagName::td:
            m_tree.openElements().popUntilTableRowScopeMarker();
            m_tree.insertHTMLElement(WTF::move(token));
            m_insertionMode = InsertionMode::InCell;
            if (m_tree.hasReachedMaxDOMTreeDepth())
                resetInsertionModeAppropriately();
            m_tree.activeFormattingElements().appendMarker();
            return;
        case TagName::tr:
        case TagName::caption:
        case TagName::col:
        case TagName::colgroup:
        case TagName::tbody:
        case TagName::tfoot:
        case TagName::thead:
            if (!processTrEndTagForInRow()) {
                ASSERT(isParsingFragmentOrTemplateContents() || m_tree.hasReachedMaxDOMTreeDepth());
                return;
            }
            ASSERT(m_insertionMode == InsertionMode::InTableBody || m_tree.hasReachedMaxDOMTreeDepth());
            processStartTag(WTF::move(token));
            return;
        default:
            break;
        }
        processStartTagForInTable(WTF::move(token));
        break;
    case InsertionMode::InCell:
        switch (token.tagName()) {
        case TagName::caption:
        case TagName::col:
        case TagName::colgroup:
        case TagName::th:
        case TagName::td:
        case TagName::tr:
        case TagName::tbody:
        case TagName::tfoot:
        case TagName::thead:
            if (!m_tree.openElements().hasAnyInTableScope({ HTML::td, HTML::th })) {
                ASSERT(isParsingFragment());
                parseError(token);
                return;
            }
            closeTheCell();
            processStartTag(WTF::move(token));
            return;
        default:
            break;
        }
        processStartTagForInBody(WTF::move(token));
        if (m_insertionMode == InsertionMode::InCell && m_tree.hasReachedMaxDOMTreeDepth()
            && !m_tree.openElements().hasAnyInTableScope({ HTML::td, HTML::th }))
            resetInsertionModeAppropriately();
        break;
    case InsertionMode::AfterBody:
    case InsertionMode::AfterAfterBody:
        if (token.tagName() == TagName::html) {
            processHtmlStartTagForInBody(WTF::move(token));
            return;
        }
        m_insertionMode = InsertionMode::InBody;
        processStartTag(WTF::move(token));
        break;
    case InsertionMode::InHeadNoscript:
        switch (token.tagName()) {
        case TagName::html:
            processHtmlStartTagForInBody(WTF::move(token));
            return;
        case TagName::basefont:
        case TagName::bgsound:
        case TagName::link:
        case TagName::meta:
        case TagName::noframes:
        case TagName::style: {
            bool didProcess = processStartTagForInHead(WTF::move(token));
            ASSERT_UNUSED(didProcess, didProcess);
            return;
        }
        case TagName::head:
        case TagName::noscript:
            parseError(token);
            return;
        default:
            break;
        }
        defaultForInHeadNoscript();
        processToken(WTF::move(token));
        break;
    case InsertionMode::InFrameset:
        switch (token.tagName()) {
        case TagName::html:
            processHtmlStartTagForInBody(WTF::move(token));
            return;
        case TagName::frameset:
            m_tree.insertHTMLElement(WTF::move(token));
            return;
        case TagName::frame:
            m_tree.insertSelfClosingHTMLElement(WTF::move(token));
            return;
        case TagName::noframes:
            processStartTagForInHead(WTF::move(token));
            return;
        default:
            break;
        }
        parseError(token);
        break;
    case InsertionMode::AfterFrameset:
    case InsertionMode::AfterAfterFrameset:
        switch (token.tagName()) {
        case TagName::html:
            processHtmlStartTagForInBody(WTF::move(token));
            return;
        case TagName::noframes:
            processStartTagForInHead(WTF::move(token));
            return;
        default:
            break;
        }
        parseError(token);
        break;
    case InsertionMode::InSelectInTable:
        ASSERT(!m_options.enhancedSelect);
        switch (token.tagName()) {
        case TagName::caption:
        case TagName::table:
        case TagName::tbody:
        case TagName::tfoot:
        case TagName::thead:
        case TagName::tr:
        case TagName::th:
        case TagName::td: {
            parseError(token);
            AtomHTMLToken endSelect(HTMLToken::Type::EndTag, TagName::select);
            processEndTag(WTF::move(endSelect));
            processStartTag(WTF::move(token));
            return;
        }
        default:
            break;
        }
        [[fallthrough]];
    case InsertionMode::InSelect:
        ASSERT(!m_options.enhancedSelect);
        switch (token.tagName()) {
        case TagName::html:
            processHtmlStartTagForInBody(WTF::move(token));
            return;
        case TagName::option:
            if (m_tree.currentStackItem().elementName() == HTML::option)
                processFakeEndTag(TagName::option);
            m_tree.insertHTMLElement(WTF::move(token));
            return;
        case TagName::optgroup:
            if (m_tree.currentStackItem().elementName() == HTML::option)
                processFakeEndTag(TagName::option);
            if (m_tree.currentStackItem().elementName() == HTML::optgroup)
                processFakeEndTag(TagName::optgroup);
            m_tree.insertHTMLElement(WTF::move(token));
            return;
        case TagName::hr:
            if (m_tree.currentStackItem().elementName() == HTML::option)
                processFakeEndTag(TagName::option);
            if (m_tree.currentStackItem().elementName() == HTML::optgroup)
                processFakeEndTag(TagName::optgroup);
            m_tree.insertSelfClosingHTMLElement(WTF::move(token));
            return;
        case TagName::select: {
            parseError(token);
            AtomHTMLToken endSelect(HTMLToken::Type::EndTag, TagName::select);
            processEndTag(WTF::move(endSelect));
            return;
        }
        case TagName::input:
        case TagName::keygen:
        case TagName::textarea: {
            parseError(token);
            if (!m_tree.openElements().inSelectScope(HTML::select)) {
                ASSERT(isParsingFragment());
                return;
            }
            AtomHTMLToken endSelect(HTMLToken::Type::EndTag, TagName::select);
            processEndTag(WTF::move(endSelect));
            processStartTag(WTF::move(token));
            return;
        }
        case TagName::script: {
            bool didProcess = processStartTagForInHead(WTF::move(token));
            ASSERT_UNUSED(didProcess, didProcess);
            return;
        }
        case TagName::template_:
            processTemplateStartTag(WTF::move(token));
            return;
        default:
            break;
        }
        break;
    case InsertionMode::InTableText:
        defaultForInTableText();
        processStartTag(WTF::move(token));
        break;
    case InsertionMode::Text:
        ASSERT_NOT_REACHED();
        break;
    case InsertionMode::TemplateContents: {
        InsertionMode insertionMode = InsertionMode::TemplateContents;
        switch (token.tagName()) {
        case TagName::template_:
            processTemplateStartTag(WTF::move(token));
            return;
        case TagName::link:
        case TagName::meta:
        case TagName::script:
        case TagName::style:
            processStartTagForInHead(WTF::move(token));
            return;
        case TagName::caption:
        case TagName::colgroup:
        case TagName::tbody:
        case TagName::tfoot:
        case TagName::thead:
            insertionMode = InsertionMode::InTable;
            break;
        case TagName::col:
            insertionMode = InsertionMode::InColumnGroup;
            break;
        case TagName::tr:
            insertionMode = InsertionMode::InTableBody;
            break;
        case TagName::td:
        case TagName::th:
            insertionMode = InsertionMode::InRow;
            break;
        default:
            insertionMode = InsertionMode::InBody;
            break;
        }
        ASSERT(insertionMode != InsertionMode::TemplateContents);
        ASSERT(m_templateInsertionModes.last() == InsertionMode::TemplateContents);
        m_templateInsertionModes.last() = insertionMode;
        m_insertionMode = insertionMode;
        processStartTag(WTF::move(token));
        break;
    }
    }
}

void HTMLTreeBuilder::processHtmlStartTagForInBody(AtomHTMLToken&& token)
{
    parseError(token);
    if (m_tree.openElements().hasTemplateInHTMLScope()) {
        ASSERT(isParsingTemplateContents());
        return;
    }
    m_tree.insertHTMLHtmlStartTagInBody(WTF::move(token));
}

bool HTMLTreeBuilder::processBodyEndTagForInBody(AtomHTMLToken&& token)
{
    ASSERT(token.type() == HTMLToken::Type::EndTag);
    ASSERT(token.tagName() == TagName::body);
    if (!m_tree.openElements().inScope(HTML::body)) {
        parseError(token);
        return false;
    }
    m_insertionMode = InsertionMode::AfterBody;
    return true;
}

static bool LEGACY_NODELETE itemMatchesName(const HTMLStackItem& item, ElementName elementName)
{
    ASSERT(elementName != ElementName::Unknown);
    return item.elementName() == elementName;
}

static bool LEGACY_NODELETE itemMatchesName(const HTMLStackItem& item, const AtomString& tagName)
{
    return item.matchesHTMLTag(tagName);
}

void HTMLTreeBuilder::processAnyOtherEndTagForInBody(AtomHTMLToken&& token)
{
    ASSERT(token.type() == HTMLToken::Type::EndTag);

    auto popOpenElements = [&](const auto& name) {
        for (auto* record = &m_tree.openElements().topRecord(); ; record = record->next()) {
            HTMLStackItem& item = record->stackItem();
            if (itemMatchesName(item, name)) {
                m_tree.generateImpliedEndTagsWithExclusion(name);
                if (!itemMatchesName(m_tree.currentStackItem(), name))
                    parseError(token);
                m_tree.openElements().popUntilPopped(protect(item.element()));
                return;
            }
            if (isSpecialNode(item)) {
                parseError(token);
                return;
            }
        }
    };

    if (auto elementName = elementNameForTag(Namespace::HTML, token.tagName()); elementName != ElementName::Unknown) [[likely]]
        popOpenElements(elementName);
    else
        popOpenElements(token.name());
}

// http://www.whatwg.org/specs/web-apps/current-work/multipage/tokenization.html#parsing-main-inbody
void HTMLTreeBuilder::callTheAdoptionAgency(AtomHTMLToken& token)
{
    ASSERT(token.tagName() != TagName::Unknown);

    // The adoption agency algorithm is N^2. We limit the number of iterations to stop from hanging the whole browser.
    // This limit is specified in the adoption agency algorithm:
    // https://html.spec.whatwg.org/multipage/parsing.html#adoption-agency-algorithm
    static const int outerIterationLimit = 8;
    static const int innerIterationLimit = 3;

    // 2. If the current node is an HTML element whose tag name is subject,
    // and the current node is not in the list of active formatting elements,
    // then pop the current node off the stack of open elements and return.
    if (!m_tree.isEmpty() && m_tree.currentStackItem().isElement()
        && m_tree.currentElement().elementName() == elementNameForTag(Namespace::HTML, token.tagName())
        && !m_tree.activeFormattingElements().contains(protect(m_tree.currentElement()))) {
        m_tree.openElements().pop();
        return;
    }

    // 4 is covered by the for() loop.
    for (int i = 0; i < outerIterationLimit; ++i) {
        // 4.3.
        RefPtr<Element> formattingElement = m_tree.activeFormattingElements().closestElementInScopeWithName(elementNameForTag(Namespace::HTML, token.tagName()));
        if (!formattingElement)
            return processAnyOtherEndTagForInBody(WTF::move(token));
        // 4.5.
        if ((m_tree.openElements().contains(*formattingElement)) && !m_tree.openElements().inScope(*formattingElement)) {
            parseError(token);
            return;
        }
        // 4.4.
        auto* formattingElementRecord = m_tree.openElements().find(*formattingElement);
        if (!formattingElementRecord) {
            parseError(token);
            m_tree.activeFormattingElements().remove(*formattingElement);
            return;
        }
        // 4.6.
        if (formattingElement != &m_tree.currentElement())
            parseError(token);
        // 4.7.
        auto* furthestBlock = m_tree.openElements().furthestBlockForFormattingElement(*formattingElement);
        // 4.8.
        if (!furthestBlock) {
            m_tree.openElements().popUntilPopped(*formattingElement);
            m_tree.activeFormattingElements().remove(*formattingElement);
            return;
        }
        // 4.9.
        ASSERT(furthestBlock->isAbove(*formattingElementRecord));
        auto& commonAncestor = formattingElementRecord->next()->stackItem();
        // 4.10.
        HTMLFormattingElementList::Bookmark bookmark = m_tree.activeFormattingElements().bookmarkFor(*formattingElement);
        // 4.11.
        auto* node = furthestBlock;
        auto* lastNode = furthestBlock;
        auto* nextNode = node->next();
        // 4.13.
        unsigned innerLoopCounter = 0;
        while (true) {
            ++innerLoopCounter;
            // 4.13.2.
            node = nextNode;
            ASSERT(node);
            nextNode = node->next(); // Save node->next() for the next iteration in case node is deleted in the next step.
            // 4.13.3.
            if (node == formattingElementRecord)
                break;
            // 4.13.4.
            bool nodeIsInListOfActiveFormattingElements = m_tree.activeFormattingElements().contains(protect(node->element()));
            if (innerLoopCounter > innerIterationLimit && nodeIsInListOfActiveFormattingElements)
                m_tree.activeFormattingElements().removeUpdatingBookmark(protect(node->element()), bookmark);
            // 4.13.5.
            auto* nodeEntry = m_tree.activeFormattingElements().find(protect(node->element()));
            if (!nodeEntry) {
                m_tree.openElements().remove(protect(node->element()));
                node = nullptr;
                continue;
            }
            // 4.13.6.
            auto newItem = m_tree.createElementFromSavedToken(node->stackItem());

            nodeEntry->replaceElement(HTMLStackItem(newItem));
            node->replaceElement(WTF::move(newItem));

            // 4.13.7.
            if (lastNode == furthestBlock)
                bookmark.moveToAfter(*nodeEntry);
            // 4.13.8.
            m_tree.reparent(*node, *lastNode);
            // 4.13.9.
            lastNode = node;
        }
        // 14.
        m_tree.insertAlreadyParsedChild(commonAncestor, *lastNode);
        // 15.
        auto newItem = m_tree.createElementFromSavedToken(formattingElementRecord->stackItem());
        // 16.
        m_tree.takeAllChildrenAndReparent(newItem, *furthestBlock);
        m_tree.openElements().insertAbove(HTMLStackItem(newItem), *furthestBlock);
        // 18.
        m_tree.activeFormattingElements().swapTo(*formattingElement, WTF::move(newItem), bookmark);
        // 19.
        m_tree.openElements().remove(*formattingElement);
    }
}

void HTMLTreeBuilder::resetInsertionModeAppropriately()
{
    // http://www.whatwg.org/specs/web-apps/current-work/multipage/parsing.html#reset-the-insertion-mode-appropriately
    bool last = false;
    for (auto* record = &m_tree.openElements().topRecord(); ; record = record->next()) {
        auto* item = &record->stackItem();

        if (&item->node() == &m_tree.openElements().rootNode()) {
            last = true;
            bool shouldCreateItem = isParsingFragment();
            if (shouldCreateItem)
                item = &m_fragmentContext.contextElementStackItem();
        }

        switch (item->elementName()) {
        case HTML::template_:
            m_insertionMode = m_templateInsertionModes.last();
            return;
        case HTML::td:
        case HTML::th:
            m_insertionMode = InsertionMode::InCell;
            return;
        case HTML::tr:
            m_insertionMode = InsertionMode::InRow;
            return;
        case HTML::tbody:
        case HTML::thead:
        case HTML::tfoot:
            m_insertionMode = InsertionMode::InTableBody;
            return;
        case HTML::caption:
            m_insertionMode = InsertionMode::InCaption;
            return;
        case HTML::colgroup:
            m_insertionMode = InsertionMode::InColumnGroup;
            return;
        case HTML::table:
            m_insertionMode = InsertionMode::InTable;
            return;
        case HTML::head:
            if (!m_fragmentContext.fragment() || &m_fragmentContext.contextElement() != &item->node()) {
                m_insertionMode = InsertionMode::InHead;
                return;
            }
            m_insertionMode = InsertionMode::InBody;
            return;
        case HTML::body:
            m_insertionMode = InsertionMode::InBody;
            return;
        case HTML::frameset:
            m_insertionMode = InsertionMode::InFrameset;
            return;
        case HTML::html:
            if (!m_tree.headStackItem().isNull()) {
                m_insertionMode = InsertionMode::AfterHead;
                return;
            }
            ASSERT(isParsingFragment());
            m_insertionMode = InsertionMode::BeforeHead;
            return;
        case HTML::select:
            if (!m_options.enhancedSelect) {
                if (!last) {
                    while (&item->node() != &m_tree.openElements().rootNode() && item->elementName() != HTML::template_) {
                        record = record->next();
                        item = &record->stackItem();
                        if (item->elementName() == HTML::table) {
                            m_insertionMode = InsertionMode::InSelectInTable;
                            return;
                        }
                    }
                }
                m_insertionMode = InsertionMode::InSelect;
                return;
            }
            [[fallthrough]];
        default:
            if (last) {
                ASSERT(isParsingFragment());
                m_insertionMode = InsertionMode::InBody;
                return;
            }
            break;
        }
    }
}

void HTMLTreeBuilder::processEndTagForInTableBody(AtomHTMLToken&& token)
{
    ASSERT(token.type() == HTMLToken::Type::EndTag);
    switch (token.tagName()) {
    case TagName::tbody:
    case TagName::tfoot:
    case TagName::thead:
        if (!m_tree.openElements().inTableScope(elementNameForTag(Namespace::HTML, token.tagName()))) {
            parseError(token);
            return;
        }
        m_tree.openElements().popUntilTableBodyScopeMarker();
        m_tree.openElements().pop();
        m_insertionMode = InsertionMode::InTable;
        return;
    case TagName::table:
        if (!m_tree.openElements().hasAnyInTableScope({ HTML::tbody, HTML::thead, HTML::tfoot })) {
            if (!isParsingFragmentOrTemplateContents())
                resetInsertionModeAppropriately();
            parseError(token);
            return;
        }
        m_tree.openElements().popUntilTableBodyScopeMarker();
        ASSERT(isTableBodyContextElement(m_tree.currentStackItem().elementName()));
        processFakeEndTag(m_tree.currentStackItem());
        processEndTag(WTF::move(token));
        return;
    case TagName::body:
    case TagName::caption:
    case TagName::col:
    case TagName::colgroup:
    case TagName::html:
    case TagName::th:
    case TagName::td:
    case TagName::tr:
        parseError(token);
        return;
    default:
        break;
    }
    processEndTagForInTable(WTF::move(token));
}

void HTMLTreeBuilder::processEndTagForInRow(AtomHTMLToken&& token)
{
    ASSERT(token.type() == HTMLToken::Type::EndTag);
    switch (token.tagName()) {
    case TagName::tr:
        processTrEndTagForInRow();
        return;
    case TagName::table:
        if (!processTrEndTagForInRow()) {
            ASSERT(isParsingFragmentOrTemplateContents() || m_tree.hasReachedMaxDOMTreeDepth());
            return;
        }
        ASSERT(m_insertionMode == InsertionMode::InTableBody || m_tree.hasReachedMaxDOMTreeDepth());
        processEndTag(WTF::move(token));
        return;
    case TagName::tbody:
    case TagName::tfoot:
    case TagName::thead:
        if (!m_tree.openElements().inTableScope(elementNameForTag(Namespace::HTML, token.tagName()))) {
            parseError(token);
            return;
        }
        processFakeEndTag(TagName::tr);
        ASSERT(m_insertionMode == InsertionMode::InTableBody || m_tree.hasReachedMaxDOMTreeDepth());
        processEndTag(WTF::move(token));
        return;
    case TagName::body:
    case TagName::caption:
    case TagName::col:
    case TagName::colgroup:
    case TagName::html:
    case TagName::th:
    case TagName::td:
        parseError(token);
        return;
    default:
        break;
    }
    processEndTagForInTable(WTF::move(token));
}

void HTMLTreeBuilder::processEndTagForInCell(AtomHTMLToken&& token)
{
    ASSERT(token.type() == HTMLToken::Type::EndTag);
    switch (token.tagName()) {
    case TagName::th:
    case TagName::td: {
        auto elementName = elementNameForTag(Namespace::HTML, token.tagName());
        if (!m_tree.openElements().inTableScope(elementName)) {
            parseError(token);
            return;
        }
        m_tree.generateImpliedEndTags();
        if (m_tree.currentStackItem().elementName() != elementName)
            parseError(token);
        m_tree.openElements().popUntilPopped(elementName);
        m_tree.activeFormattingElements().clearToLastMarker();
        m_insertionMode = InsertionMode::InRow;
        return;
    }
    case TagName::body:
    case TagName::caption:
    case TagName::col:
    case TagName::colgroup:
    case TagName::html:
        parseError(token);
        return;
    case TagName::table:
    case TagName::tr:
    case TagName::tbody:
    case TagName::tfoot:
    case TagName::thead:
        if (!m_tree.openElements().inTableScope(elementNameForTag(Namespace::HTML, token.tagName()))) {
            ASSERT(isTableBodyContextTag(token.tagName()) || m_tree.openElements().inTableScope(HTML::template_) || isParsingFragment());
            parseError(token);
            return;
        }
        closeTheCell();
        processEndTag(WTF::move(token));
        return;
    default:
        break;
    }
    processEndTagForInBody(WTF::move(token));
}

void HTMLTreeBuilder::processEndTagForInBody(AtomHTMLToken&& token)
{
    ASSERT(token.type() == HTMLToken::Type::EndTag);
    switch (token.tagName()) {
    case TagName::body:
        processBodyEndTagForInBody(WTF::move(token));
        return;
    case TagName::html: {
        AtomHTMLToken endBody(HTMLToken::Type::EndTag, TagName::body);
        if (processBodyEndTagForInBody(WTF::move(endBody)))
            processEndTag(WTF::move(token));
        return;
    }
    case TagName::select:
        if (!m_options.enhancedSelect) {
            processAnyOtherEndTagForInBody(WTF::move(token));
            return;
        }
        [[fallthrough]];
    case TagName::address:
    case TagName::article:
    case TagName::aside:
    case TagName::blockquote:
    case TagName::button:
    case TagName::center:
    case TagName::details:
    case TagName::dialog:
    case TagName::dir:
    case TagName::div:
    case TagName::dl:
    case TagName::fieldset:
    case TagName::figcaption:
    case TagName::figure:
    case TagName::footer:
    case TagName::header:
    case TagName::hgroup:
    case TagName::listing:
    case TagName::main:
    case TagName::menu:
    case TagName::nav:
    case TagName::ol:
    case TagName::pre:
    case TagName::search:
    case TagName::section:
    case TagName::summary:
    case TagName::ul: {
        auto elementName = elementNameForTag(Namespace::HTML, token.tagName());
        if (!m_tree.openElements().inScope(elementName)) {
            parseError(token);
            return;
        }
        m_tree.generateImpliedEndTags();
        if (m_tree.currentStackItem().elementName() != elementName)
            parseError(token);
        m_tree.openElements().popUntilPopped(elementName);
        return;
    }
    case TagName::form:
        if (!isParsingTemplateContents()) {
            RefPtr<Element> formElement = m_tree.takeForm();
            if (!formElement || !m_tree.openElements().inScope(*formElement)) {
                parseError(token);
                return;
            }
            m_tree.generateImpliedEndTags();
            if (&m_tree.currentNode() != formElement.get())
                parseError(token);
            m_tree.openElements().remove(*formElement);
        } else {
            if (!m_tree.openElements().inScope(HTML::form)) {
                parseError(token);
                return;
            }
            m_tree.generateImpliedEndTags();
            if (m_tree.currentElementName() != HTML::form)
                parseError(token);
            m_tree.openElements().popUntilPopped(HTML::form);
        }
        return;
    case TagName::p:
        if (!m_tree.openElements().inButtonScope(HTML::p)) {
            parseError(token);
            processFakeStartTag(TagName::p);
            ASSERT(m_tree.openElements().inScope(HTML::p));
            processEndTag(WTF::move(token));
            return;
        }
        m_tree.generateImpliedEndTagsWithExclusion(HTML::p);
        if (m_tree.currentStackItem().elementName() != HTML::p)
            parseError(token);
        m_tree.openElements().popUntilPopped(HTML::p);
        return;
    case TagName::li:
        if (!m_tree.openElements().inListItemScope(HTML::li)) {
            parseError(token);
            return;
        }
        m_tree.generateImpliedEndTagsWithExclusion(HTML::li);
        if (m_tree.currentStackItem().elementName() != HTML::li)
            parseError(token);
        m_tree.openElements().popUntilPopped(HTML::li);
        return;
    case TagName::dd:
    case TagName::dt: {
        auto elementName = elementNameForTag(Namespace::HTML, token.tagName());
        if (!m_tree.openElements().inScope(elementName)) {
            parseError(token);
            return;
        }
        m_tree.generateImpliedEndTagsWithExclusion(elementName);
        if (m_tree.currentStackItem().elementName() != elementName)
            parseError(token);
        m_tree.openElements().popUntilPopped(elementName);
        return;
    }
    case TagName::h1:
    case TagName::h2:
    case TagName::h3:
    case TagName::h4:
    case TagName::h5:
    case TagName::h6:
        if (!m_tree.openElements().hasNumberedHeaderElementInScope()) {
            parseError(token);
            return;
        }
        m_tree.generateImpliedEndTags();
        if (m_tree.currentStackItem().elementName() != elementNameForTag(Namespace::HTML, token.tagName()))
            parseError(token);
        m_tree.openElements().popUntilNumberedHeaderElementPopped();
        return;
    case TagName::a:
    case TagName::b:
    case TagName::big:
    case TagName::code:
    case TagName::em:
    case TagName::font:
    case TagName::i:
    case TagName::nobr:
    case TagName::s:
    case TagName::small_:
    case TagName::strike:
    case TagName::strong:
    case TagName::tt:
    case TagName::u:
        callTheAdoptionAgency(token);
        return;
    case TagName::applet:
    case TagName::marquee:
    case TagName::object: {
        auto elementName = elementNameForTag(Namespace::HTML, token.tagName());
        if (!m_tree.openElements().inScope(elementName)) {
            parseError(token);
            return;
        }
        m_tree.generateImpliedEndTags();
        if (m_tree.currentStackItem().elementName() != elementName)
            parseError(token);
        m_tree.openElements().popUntilPopped(elementName);
        m_tree.activeFormattingElements().clearToLastMarker();
        return;
    }
    case TagName::br:
        parseError(token);
        processFakeStartTag(TagName::br);
        return;
    case TagName::template_:
        processTemplateEndTag(WTF::move(token));
        return;
    default:
        break;
    }
    processAnyOtherEndTagForInBody(WTF::move(token));
}

bool HTMLTreeBuilder::processCaptionEndTagForInCaption()
{
    if (!m_tree.openElements().inTableScope(HTML::caption)) {
        ASSERT(isParsingFragment());
        // FIXME: parse error
        return false;
    }
    m_tree.generateImpliedEndTags();
    // FIXME: parse error if (m_tree.currentStackItem().elementName() != HTML::caption)
    m_tree.openElements().popUntilPopped(HTML::caption);
    m_tree.activeFormattingElements().clearToLastMarker();
    m_insertionMode = InsertionMode::InTable;
    return true;
}

bool HTMLTreeBuilder::processTrEndTagForInRow()
{
    if (!m_tree.openElements().inTableScope(HTML::tr)) {
        if (!isParsingFragmentOrTemplateContents())
            resetInsertionModeAppropriately();
        // FIXME: parse error
        return false;
    }
    m_tree.openElements().popUntilTableRowScopeMarker();
    ASSERT(m_tree.currentStackItem().elementName() == HTML::tr);
    m_tree.openElements().pop();
    m_insertionMode = InsertionMode::InTableBody;
    return true;
}

bool HTMLTreeBuilder::processTableEndTagForInTable()
{
    if (!m_tree.openElements().inTableScope(HTML::table)) {
        if (!isParsingFragmentOrTemplateContents())
            resetInsertionModeAppropriately();
        // FIXME: parse error.
        return false;
    }
    m_tree.openElements().popUntilPopped(HTML::table);
    resetInsertionModeAppropriately();
    return true;
}

void HTMLTreeBuilder::processEndTagForInTable(AtomHTMLToken&& token)
{
    ASSERT(token.type() == HTMLToken::Type::EndTag);
    switch (token.tagName()) {
    case TagName::table:
        processTableEndTagForInTable();
        return;
    case TagName::body:
    case TagName::caption:
    case TagName::col:
    case TagName::colgroup:
    case TagName::html:
    case TagName::tbody:
    case TagName::tfoot:
    case TagName::thead:
    case TagName::th:
    case TagName::td:
    case TagName::tr:
        parseError(token);
        return;
    default:
        break;
    }
    parseError(token);
    // Is this redirection necessary here?
    HTMLConstructionSite::RedirectToFosterParentGuard redirecter(m_tree);
    processEndTagForInBody(WTF::move(token));
}

void HTMLTreeBuilder::processEndTag(AtomHTMLToken&& token)
{
    ASSERT(token.type() == HTMLToken::Type::EndTag);
    switch (m_insertionMode) {
    case InsertionMode::Initial:
        defaultForInitial();
        ASSERT(m_insertionMode == InsertionMode::BeforeHTML);
        [[fallthrough]];
    case InsertionMode::BeforeHTML:
        switch (token.tagName()) {
        case TagName::head:
        case TagName::body:
        case TagName::html:
        case TagName::br:
            break;
        default:
            parseError(token);
            return;
        }
        defaultForBeforeHTML();
        ASSERT(m_insertionMode == InsertionMode::BeforeHead);
        [[fallthrough]];
    case InsertionMode::BeforeHead:
        switch (token.tagName()) {
        case TagName::head:
        case TagName::body:
        case TagName::html:
        case TagName::br:
            break;
        default:
            parseError(token);
            return;
        }
        defaultForBeforeHead();
        ASSERT(m_insertionMode == InsertionMode::InHead);
        [[fallthrough]];
    case InsertionMode::InHead:
        // FIXME: This case should be broken out into processEndTagForInHead,
        // because other end tag cases now refer to it ("process the token for using the rules of the "in head" insertion mode").
        // but because the logic falls through to InsertionMode::AfterHead, that gets a little messy.
        switch (token.tagName()) {
        case TagName::template_:
            processTemplateEndTag(WTF::move(token));
            return;
        case TagName::head:
            m_tree.openElements().popHTMLHeadElement();
            m_insertionMode = InsertionMode::AfterHead;
            return;
        case TagName::body:
        case TagName::html:
        case TagName::br:
            break;
        default:
            parseError(token);
            return;
        }
        defaultForInHead();
        ASSERT(m_insertionMode == InsertionMode::AfterHead);
        [[fallthrough]];
    case InsertionMode::AfterHead:
        switch (token.tagName()) {
        case TagName::body:
        case TagName::html:
        case TagName::br:
            break;
        default:
            parseError(token);
            return;
        }
        defaultForAfterHead();
        ASSERT(m_insertionMode == InsertionMode::InBody);
        [[fallthrough]];
    case InsertionMode::InBody:
        processEndTagForInBody(WTF::move(token));
        break;
    case InsertionMode::InTable:
        processEndTagForInTable(WTF::move(token));
        break;
    case InsertionMode::InCaption:
        switch (token.tagName()) {
        case TagName::caption:
            processCaptionEndTagForInCaption();
            return;
        case TagName::table:
            parseError(token);
            if (!processCaptionEndTagForInCaption()) {
                ASSERT(isParsingFragment());
                return;
            }
            processEndTag(WTF::move(token));
            return;
        case TagName::body:
        case TagName::col:
        case TagName::colgroup:
        case TagName::html:
        case TagName::tbody:
        case TagName::thead:
        case TagName::tfoot:
        case TagName::th:
        case TagName::td:
        case TagName::tr:
            parseError(token);
            return;
        default:
            break;
        }
        processEndTagForInBody(WTF::move(token));
        break;
    case InsertionMode::InColumnGroup:
        switch (token.tagName()) {
        case TagName::colgroup:
            processColgroupEndTagForInColumnGroup();
            return;
        case TagName::col:
            parseError(token);
            return;
        case TagName::template_:
            processTemplateEndTag(WTF::move(token));
            return;
        default:
            break;
        }
        if (!processColgroupEndTagForInColumnGroup()) {
            ASSERT(isParsingFragmentOrTemplateContents());
            return;
        }
        processEndTag(WTF::move(token));
        break;
    case InsertionMode::InRow:
        processEndTagForInRow(WTF::move(token));
        break;
    case InsertionMode::InCell:
        processEndTagForInCell(WTF::move(token));
        break;
    case InsertionMode::InTableBody:
        processEndTagForInTableBody(WTF::move(token));
        break;
    case InsertionMode::AfterBody:
        if (token.tagName() == TagName::html) {
            if (isParsingFragment()) {
                parseError(token);
                return;
            }
            m_insertionMode = InsertionMode::AfterAfterBody;
            return;
        }
        [[fallthrough]];
    case InsertionMode::AfterAfterBody:
        ASSERT(m_insertionMode == InsertionMode::AfterBody || m_insertionMode == InsertionMode::AfterAfterBody);
        parseError(token);
        m_insertionMode = InsertionMode::InBody;
        processEndTag(WTF::move(token));
        break;
    case InsertionMode::InHeadNoscript:
        switch (token.tagName()) {
        case TagName::noscript:
            ASSERT(m_tree.currentStackItem().elementName() == HTML::noscript);
            m_tree.openElements().pop();
            ASSERT(m_tree.currentStackItem().elementName() == HTML::head);
            m_insertionMode = InsertionMode::InHead;
            return;
        case TagName::br:
            break;
        default:
            parseError(token);
            return;
        }
        defaultForInHeadNoscript();
        processToken(WTF::move(token));
        break;
    case InsertionMode::Text:
        if (token.tagName() == TagName::script) {
            // Pause ourselves so that parsing stops until the script can be processed by the caller.
            ASSERT(m_tree.currentStackItem().elementName() == HTML::script);
            if (scriptingContentIsAllowed(m_tree.parserContentPolicy()))
                m_scriptToProcess = downcast<HTMLScriptElement>(m_tree.currentElement());
            m_tree.openElements().pop();
            m_insertionMode = m_originalInsertionMode;

            // This token will not have been created by the tokenizer if a
            // self-closing script tag was encountered and pre-HTML5 parser
            // quirks are enabled. We must set the tokenizer's state to
            // DataState explicitly if the tokenizer didn't have a chance to.
            ASSERT(m_parser->tokenizer().isInDataState() || m_options.usePreHTML5ParserQuirks);
            m_parser->tokenizer().setDataState();
            return;
        }
        m_tree.openElements().pop();
        m_insertionMode = m_originalInsertionMode;
        break;
    case InsertionMode::InFrameset:
        if (token.tagName() == TagName::frameset) {
            bool ignoreFramesetForFragmentParsing  = m_tree.currentIsRootNode() || m_tree.openElements().hasTemplateInHTMLScope();
            if (ignoreFramesetForFragmentParsing) {
                ASSERT(isParsingFragmentOrTemplateContents());
                parseError(token);
                return;
            }
            m_tree.openElements().pop();
            if (!isParsingFragment() && m_tree.currentStackItem().elementName() != HTML::frameset)
                m_insertionMode = InsertionMode::AfterFrameset;
            return;
        }
        break;
    case InsertionMode::AfterFrameset:
        if (token.tagName() == TagName::html) {
            m_insertionMode = InsertionMode::AfterAfterFrameset;
            return;
        }
        [[fallthrough]];
    case InsertionMode::AfterAfterFrameset:
        ASSERT(m_insertionMode == InsertionMode::AfterFrameset || m_insertionMode == InsertionMode::AfterAfterFrameset);
        parseError(token);
        break;
    case InsertionMode::InSelectInTable:
        ASSERT(!m_options.enhancedSelect);
        switch (token.tagName()) {
        case TagName::caption:
        case TagName::table:
        case TagName::tbody:
        case TagName::thead:
        case TagName::tfoot:
        case TagName::tr:
        case TagName::th:
        case TagName::td:
            parseError(token);
            if (m_tree.openElements().inTableScope(elementNameForTag(Namespace::HTML, token.tagName()))) {
                AtomHTMLToken endSelect(HTMLToken::Type::EndTag, TagName::select);
                processEndTag(WTF::move(endSelect));
                processEndTag(WTF::move(token));
            }
            return;
        default:
            break;
        }
        [[fallthrough]];
    case InsertionMode::InSelect:
        ASSERT(!m_options.enhancedSelect);
        ASSERT(m_insertionMode == InsertionMode::InSelect || m_insertionMode == InsertionMode::InSelectInTable);
        switch (token.tagName()) {
        case TagName::optgroup:
            if (m_tree.currentStackItem().elementName() == HTML::option && m_tree.oneBelowTop() && m_tree.oneBelowTop()->elementName() == HTML::optgroup)
                processFakeEndTag(TagName::option);
            if (m_tree.currentStackItem().elementName() == HTML::optgroup) {
                m_tree.openElements().pop();
                return;
            }
            parseError(token);
            return;
        case TagName::option:
            if (m_tree.currentStackItem().elementName() == HTML::option) {
                m_tree.openElements().pop();
                return;
            }
            parseError(token);
            return;
        case TagName::select:
            if (!m_tree.openElements().inSelectScope(HTML::select)) {
                ASSERT(isParsingFragment());
                parseError(token);
                return;
            }
            m_tree.openElements().popUntilPopped(HTML::select);
            resetInsertionModeAppropriately();
            return;
        case TagName::template_:
            processTemplateEndTag(WTF::move(token));
            return;
        default:
            break;
        }
        break;
    case InsertionMode::InTableText:
        defaultForInTableText();
        processEndTag(WTF::move(token));
        break;
    case InsertionMode::TemplateContents:
        if (token.tagName() == TagName::template_) {
            processTemplateEndTag(WTF::move(token));
            return;
        }
        break;
    }
}

void HTMLTreeBuilder::processComment(AtomHTMLToken&& token)
{
    ASSERT(token.type() == HTMLToken::Type::Comment);
    if (m_insertionMode == InsertionMode::Initial
        || m_insertionMode == InsertionMode::BeforeHTML
        || m_insertionMode == InsertionMode::AfterAfterBody
        || m_insertionMode == InsertionMode::AfterAfterFrameset) {
        m_tree.insertCommentOnDocument(WTF::move(token));
        return;
    }
    if (m_insertionMode == InsertionMode::AfterBody) {
        m_tree.insertCommentOnHTMLHtmlElement(WTF::move(token));
        return;
    }
    if (m_insertionMode == InsertionMode::InTableText) {
        defaultForInTableText();
        processComment(WTF::move(token));
        return;
    }
    m_tree.insertComment(WTF::move(token));
}

void HTMLTreeBuilder::processCharacter(AtomHTMLToken&& token)
{
    ASSERT(token.type() == HTMLToken::Type::Character);
    ExternalCharacterTokenBuffer buffer(token);
    processCharacterBuffer(buffer);
}

inline bool HTMLTreeBuilder::consumeAndInsertWhitespace(ExternalCharacterTokenBuffer& buffer)
{
    auto leadingWhitespace = buffer.takeLeadingWhitespace();
    if (!leadingWhitespace.isEmpty())
        m_tree.insertTextNode(leadingWhitespace);
    if (buffer.isEmpty())
        return true;
    return false;
}

void HTMLTreeBuilder::processCharacterBuffer(ExternalCharacterTokenBuffer& buffer)
{
ReprocessBuffer:
    // http://www.whatwg.org/specs/web-apps/current-work/multipage/tokenization.html#parsing-main-inbody
    // Note that this logic is different than the generic \r\n collapsing
    // handled in the input stream preprocessor. This logic is here as an
    // "authoring convenience" so folks can write:
    //
    // <pre>
    // lorem ipsum
    // lorem ipsum
    // </pre>
    //
    // without getting an extra newline at the start of their <pre> element.
    if (m_shouldSkipLeadingNewline) {
        m_shouldSkipLeadingNewline = false;
        buffer.skipAtMostOneLeadingNewline();
        if (buffer.isEmpty())
            return;
    }

    switch (m_insertionMode) {
    case InsertionMode::Initial:
        buffer.skipLeadingWhitespace();
        if (buffer.isEmpty())
            return;
        defaultForInitial();
        ASSERT(m_insertionMode == InsertionMode::BeforeHTML);
        [[fallthrough]];
    case InsertionMode::BeforeHTML:
        buffer.skipLeadingWhitespace();
        if (buffer.isEmpty())
            return;
        defaultForBeforeHTML();
        ASSERT(m_insertionMode == InsertionMode::BeforeHead);
        [[fallthrough]];
    case InsertionMode::BeforeHead:
        buffer.skipLeadingWhitespace();
        if (buffer.isEmpty())
            return;
        defaultForBeforeHead();
        ASSERT(m_insertionMode == InsertionMode::InHead);
        [[fallthrough]];
    case InsertionMode::InHead: {
        if (consumeAndInsertWhitespace(buffer))
            return;
        defaultForInHead();
        ASSERT(m_insertionMode == InsertionMode::AfterHead);
        [[fallthrough]];
    }
    case InsertionMode::AfterHead: {
        if (consumeAndInsertWhitespace(buffer))
            return;
        defaultForAfterHead();
        ASSERT(m_insertionMode == InsertionMode::InBody);
        [[fallthrough]];
    }
    case InsertionMode::InBody:
    case InsertionMode::InCaption:
    case InsertionMode::InCell:
    case InsertionMode::TemplateContents:
        processCharacterBufferForInBody(buffer);
        break;
    case InsertionMode::InTable:
    case InsertionMode::InTableBody:
    case InsertionMode::InRow:
        ASSERT(m_pendingTableCharacters.isEmpty());
        if (m_tree.currentStackItem().elementName() == HTML::table
            || m_tree.currentStackItem().elementName() == HTML::tbody
            || m_tree.currentStackItem().elementName() == HTML::tfoot
            || m_tree.currentStackItem().elementName() == HTML::thead
            || m_tree.currentStackItem().elementName() == HTML::tr) {

            m_originalInsertionMode = m_insertionMode;
            m_insertionMode = InsertionMode::InTableText;
            // Note that we fall through to the InsertionMode::InTableText case below.
        } else {
            HTMLConstructionSite::RedirectToFosterParentGuard redirecter(m_tree);
            processCharacterBufferForInBody(buffer);
            break;
        }
        [[fallthrough]];
    case InsertionMode::InTableText:
        buffer.giveRemainingTo(m_pendingTableCharacters);
        break;
    case InsertionMode::InColumnGroup: {
        if (consumeAndInsertWhitespace(buffer))
            return;
        if (!processColgroupEndTagForInColumnGroup()) {
            ASSERT(isParsingFragmentOrTemplateContents());
            // The spec tells us to drop these characters on the floor.
            buffer.skipLeadingNonWhitespace();
            if (buffer.isEmpty())
                return;
        }
        goto ReprocessBuffer;
    }
    case InsertionMode::AfterBody:
    case InsertionMode::AfterAfterBody: {
        if (consumeAndInsertWhitespace(buffer))
            return;
        // FIXME: parse error
        m_insertionMode = InsertionMode::InBody;
        goto ReprocessBuffer;
    }
    case InsertionMode::Text:
        m_tree.insertTextNode(buffer.takeRemaining());
        break;
    case InsertionMode::InHeadNoscript: {
        if (consumeAndInsertWhitespace(buffer))
            return;
        defaultForInHeadNoscript();
        goto ReprocessBuffer;
    }
    case InsertionMode::InFrameset:
    case InsertionMode::AfterFrameset: {
        auto leadingWhitespace = buffer.takeRemainingWhitespace();
        if (!leadingWhitespace.isEmpty())
            m_tree.insertTextNode(leadingWhitespace);
        // FIXME: We should generate a parse error if we skipped over any
        // non-whitespace characters.
        break;
    }
    case InsertionMode::InSelectInTable:
    case InsertionMode::InSelect:
        ASSERT(!m_options.enhancedSelect);
        m_tree.insertTextNode(buffer.takeRemaining());
        break;
    case InsertionMode::AfterAfterFrameset: {
        auto leadingWhitespace = buffer.takeRemainingWhitespace();
        if (!leadingWhitespace.isEmpty()) {
            m_tree.reconstructTheActiveFormattingElements();
            m_tree.insertTextNode(leadingWhitespace);
        }
        // FIXME: We should generate a parse error if we skipped over any
        // non-whitespace characters.
        break;
    }
    }
}

void HTMLTreeBuilder::processCharacterBufferForInBody(ExternalCharacterTokenBuffer& buffer)
{
    m_tree.reconstructTheActiveFormattingElements();
    String characters = buffer.takeRemaining();
    m_tree.insertTextNode(characters);
    if (m_framesetOk && !characters.containsOnly<isASCIIWhitespaceOrReplacementCharacter>())
        m_framesetOk = false;
}

void HTMLTreeBuilder::processEndOfFile(AtomHTMLToken&& token)
{
    ASSERT(token.type() == HTMLToken::Type::EndOfFile);
    switch (m_insertionMode) {
    case InsertionMode::Initial:
        defaultForInitial();
        ASSERT(m_insertionMode == InsertionMode::BeforeHTML);
        [[fallthrough]];
    case InsertionMode::BeforeHTML:
        defaultForBeforeHTML();
        ASSERT(m_insertionMode == InsertionMode::BeforeHead);
        [[fallthrough]];
    case InsertionMode::BeforeHead:
        defaultForBeforeHead();
        ASSERT(m_insertionMode == InsertionMode::InHead);
        [[fallthrough]];
    case InsertionMode::InHead:
        defaultForInHead();
        ASSERT(m_insertionMode == InsertionMode::AfterHead);
        [[fallthrough]];
    case InsertionMode::AfterHead:
        defaultForAfterHead();
        ASSERT(m_insertionMode == InsertionMode::InBody);
        [[fallthrough]];
    case InsertionMode::InBody:
    case InsertionMode::InCell:
    case InsertionMode::InCaption:
    case InsertionMode::InRow:
        if (!m_templateInsertionModes.isEmpty()) {
            if (processEndOfFileForInTemplateContents(WTF::move(token)))
                return;
        }
        break;
    case InsertionMode::AfterBody:
    case InsertionMode::AfterAfterBody:
        break;
    case InsertionMode::InHeadNoscript:
        defaultForInHeadNoscript();
        processEndOfFile(WTF::move(token));
        return;
    case InsertionMode::AfterFrameset:
    case InsertionMode::AfterAfterFrameset:
        break;
    case InsertionMode::InColumnGroup:
        if (m_tree.currentIsRootNode()) {
            ASSERT(isParsingFragment());
            return; // FIXME: Should we break here instead of returning?
        }
        ASSERT(m_tree.currentElementName() == HTML::colgroup || m_tree.currentElementName() == HTML::template_);
        processColgroupEndTagForInColumnGroup();
        [[fallthrough]];
    case InsertionMode::InFrameset:
    case InsertionMode::InTable:
    case InsertionMode::InTableBody:
    case InsertionMode::InSelectInTable:
    case InsertionMode::InSelect:
        ASSERT(!m_options.enhancedSelect || (m_insertionMode != InsertionMode::InSelect && m_insertionMode != InsertionMode::InSelectInTable));
        ASSERT(m_insertionMode == InsertionMode::InSelect || m_insertionMode == InsertionMode::InSelectInTable || m_insertionMode == InsertionMode::InTable || m_insertionMode == InsertionMode::InFrameset || m_insertionMode == InsertionMode::InTableBody || m_insertionMode == InsertionMode::InColumnGroup);
        if (&m_tree.currentNode() != &m_tree.openElements().rootNode())
            parseError(token);
        if (!m_templateInsertionModes.isEmpty()) {
            if (processEndOfFileForInTemplateContents(WTF::move(token)))
                return;
        }
        break;
    case InsertionMode::InTableText:
        defaultForInTableText();
        processEndOfFile(WTF::move(token));
        return;
    case InsertionMode::Text:
        parseError(token);
        if (m_tree.currentStackItem().elementName() == HTML::script)
            downcast<HTMLScriptElement>(m_tree.currentElement()).markAlreadyStarted();
        m_tree.openElements().pop();
        ASSERT(m_originalInsertionMode != InsertionMode::Text);
        m_insertionMode = m_originalInsertionMode;
        processEndOfFile(WTF::move(token));
        return;
    case InsertionMode::TemplateContents:
        if (processEndOfFileForInTemplateContents(WTF::move(token)))
            return;
        break;
    }
    m_tree.openElements().popAll();
}

void HTMLTreeBuilder::defaultForInitial()
{
    m_tree.setDefaultCompatibilityMode();
    // FIXME: parse error
    m_insertionMode = InsertionMode::BeforeHTML;
}

void HTMLTreeBuilder::defaultForBeforeHTML()
{
    AtomHTMLToken startHTML(HTMLToken::Type::StartTag, TagName::html);
    m_tree.insertHTMLHtmlStartTagBeforeHTML(WTF::move(startHTML));
    m_insertionMode = InsertionMode::BeforeHead;
}

void HTMLTreeBuilder::defaultForBeforeHead()
{
    AtomHTMLToken startHead(HTMLToken::Type::StartTag, TagName::head);
    processStartTag(WTF::move(startHead));
}

void HTMLTreeBuilder::defaultForInHead()
{
    AtomHTMLToken endHead(HTMLToken::Type::EndTag, TagName::head);
    processEndTag(WTF::move(endHead));
}

void HTMLTreeBuilder::defaultForInHeadNoscript()
{
    AtomHTMLToken endNoscript(HTMLToken::Type::EndTag, TagName::noscript);
    processEndTag(WTF::move(endNoscript));
}

void HTMLTreeBuilder::defaultForAfterHead()
{
    AtomHTMLToken startBody(HTMLToken::Type::StartTag, TagName::body);
    processStartTag(WTF::move(startBody));
    m_framesetOk = true;
}

void HTMLTreeBuilder::defaultForInTableText()
{
    String characters = m_pendingTableCharacters.toString();
    m_pendingTableCharacters.clear();
    if (!characters.containsOnly<isASCIIWhitespace>()) {
        // FIXME: parse error
        HTMLConstructionSite::RedirectToFosterParentGuard redirecter(m_tree);
        m_tree.reconstructTheActiveFormattingElements();
        m_tree.insertTextNode(characters);
        m_framesetOk = false;
        m_insertionMode = m_originalInsertionMode;
        return;
    }
    m_tree.insertTextNode(characters);
    m_insertionMode = m_originalInsertionMode;
}

bool HTMLTreeBuilder::processStartTagForInHead(AtomHTMLToken&& token)
{
    ASSERT(token.type() == HTMLToken::Type::StartTag);
    switch (token.tagName()) {
    case TagName::html:
        processHtmlStartTagForInBody(WTF::move(token));
        return true;
    case TagName::base:
    case TagName::basefont:
    case TagName::bgsound:
    case TagName::link:
    case TagName::meta:
        m_tree.insertSelfClosingHTMLElement(WTF::move(token));
        // Note: The custom processing for the <meta> tag is done in HTMLMetaElement::process().
        return true;
    case TagName::title:
        processGenericRCDATAStartTag(WTF::move(token));
        return true;
    case TagName::noscript:
        if (m_options.scriptingFlag) {
            processGenericRawTextStartTag(WTF::move(token));
            return true;
        }
        m_tree.insertHTMLElement(WTF::move(token));
        m_insertionMode = InsertionMode::InHeadNoscript;
        return true;
    case TagName::noframes:
    case TagName::style:
        processGenericRawTextStartTag(WTF::move(token));
        return true;
    case TagName::script: {
        bool isSelfClosing = token.selfClosing();
        processScriptStartTag(WTF::move(token));
        if (m_options.usePreHTML5ParserQuirks && isSelfClosing)
            processFakeEndTag(TagName::script);
        return true;
    }
    case TagName::template_:
        m_framesetOk = false;
        processTemplateStartTag(WTF::move(token));
        return true;
    case TagName::head:
        parseError(token);
        return true;
    default:
        break;
    }
    return false;
}

void HTMLTreeBuilder::processGenericRCDATAStartTag(AtomHTMLToken&& token)
{
    ASSERT(token.type() == HTMLToken::Type::StartTag);
    m_tree.insertHTMLElement(WTF::move(token));
    m_parser->tokenizer().setRCDATAState();
    m_originalInsertionMode = m_insertionMode;
    m_insertionMode = InsertionMode::Text;
}

void HTMLTreeBuilder::processGenericRawTextStartTag(AtomHTMLToken&& token)
{
    ASSERT(token.type() == HTMLToken::Type::StartTag);
    m_tree.insertHTMLElement(WTF::move(token));
    m_parser->tokenizer().setRAWTEXTState();
    m_originalInsertionMode = m_insertionMode;
    m_insertionMode = InsertionMode::Text;
}

void HTMLTreeBuilder::processScriptStartTag(AtomHTMLToken&& token)
{
    ASSERT(token.type() == HTMLToken::Type::StartTag);
    m_tree.insertScriptElement(WTF::move(token));
    m_parser->tokenizer().setScriptDataState();
    m_originalInsertionMode = m_insertionMode;

    TextPosition position = protect(m_parser.get())->textPosition();

    m_scriptToProcessStartPosition = position;

    m_insertionMode = InsertionMode::Text;
}

// http://www.whatwg.org/specs/web-apps/current-work/#adjusted-current-node
HTMLStackItem& HTMLTreeBuilder::adjustedCurrentStackItem()
{
    ASSERT(!m_tree.isEmpty());
    if (isParsingFragment() && m_tree.openElements().hasOnlyOneElement())
        return m_fragmentContext.contextElementStackItem();

    return m_tree.currentStackItem();
}

// http://www.whatwg.org/specs/web-apps/current-work/multipage/tree-construction.html#tree-construction
bool HTMLTreeBuilder::shouldProcessTokenInForeignContent(const AtomHTMLToken& token)
{
    if (m_tree.isEmpty())
        return false;
    HTMLStackItem& adjustedCurrentNode = adjustedCurrentStackItem();
    if (isInHTMLNamespace(adjustedCurrentNode))
        return false;
    if (HTMLElementStack::isMathMLTextIntegrationPoint(adjustedCurrentNode)) {
        if (token.type() == HTMLToken::Type::StartTag
            && token.tagName() != TagName::mglyph
            && token.tagName() != TagName::malignmark)
            return false;
        if (token.type() == HTMLToken::Type::Character)
            return false;
    }
    if (adjustedCurrentNode.elementName() == MathML::annotation_xml
        && token.type() == HTMLToken::Type::StartTag
        && token.tagName() == TagName::svg)
        return false;
    if (HTMLElementStack::isHTMLIntegrationPoint(adjustedCurrentNode)) {
        if (token.type() == HTMLToken::Type::StartTag)
            return false;
        if (token.type() == HTMLToken::Type::Character)
            return false;
    }
    if (token.type() == HTMLToken::Type::EndOfFile)
        return false;
    return true;
}

static bool LEGACY_NODELETE hasAttribute(const AtomHTMLToken& token, const QualifiedName& name)
{
    return findAttribute(token.attributes(), name);
}

void HTMLTreeBuilder::processTokenInForeignContent(AtomHTMLToken&& token)
{
    HTMLStackItem& adjustedCurrentNode = adjustedCurrentStackItem();

    switch (token.type()) {
    case HTMLToken::Type::Uninitialized:
        ASSERT_NOT_REACHED();
        break;
    case HTMLToken::Type::DOCTYPE:
        parseError(token);
        break;
    case HTMLToken::Type::StartTag: {
        switch (token.tagName()) {
        case TagName::font:
            if (!(hasAttribute(token, colorAttr) || hasAttribute(token, faceAttr) || hasAttribute(token, sizeAttr)))
                break;
            [[fallthrough]];
        case TagName::b:
        case TagName::big:
        case TagName::blockquote:
        case TagName::body:
        case TagName::br:
        case TagName::center:
        case TagName::code:
        case TagName::dd:
        case TagName::div:
        case TagName::dl:
        case TagName::dt:
        case TagName::em:
        case TagName::embed:
        case TagName::h1:
        case TagName::h2:
        case TagName::h3:
        case TagName::h4:
        case TagName::h5:
        case TagName::h6:
        case TagName::head:
        case TagName::hr:
        case TagName::i:
        case TagName::img:
        case TagName::li:
        case TagName::listing:
        case TagName::menu:
        case TagName::meta:
        case TagName::nobr:
        case TagName::ol:
        case TagName::p:
        case TagName::pre:
        case TagName::ruby:
        case TagName::s:
        case TagName::small_:
        case TagName::span:
        case TagName::strong:
        case TagName::strike:
        case TagName::sub:
        case TagName::sup:
        case TagName::table:
        case TagName::tt:
        case TagName::u:
        case TagName::ul:
        case TagName::var:
            parseError(token);
            m_tree.openElements().popUntilForeignContentScopeMarker();
            processStartTag(WTF::move(token));
            return;
        default:
            break;
        }
        auto& currentNamespace = adjustedCurrentNode.namespaceURI();
        if (currentNamespace == MathMLNames::mathmlNamespaceURI)
            adjustMathMLAttributes(token);
        if (currentNamespace == SVGNames::svgNamespaceURI) {
            adjustSVGTagNameCase(token);
            adjustSVGAttributes(token);
        }
        adjustForeignAttributes(token);

        if (token.tagName() == TagName::script && token.selfClosing() && currentNamespace == SVGNames::svgNamespaceURI) {
            token.setSelfClosingToFalse();
            m_tree.insertForeignElement(WTF::move(token), currentNamespace);
            AtomHTMLToken fakeToken(HTMLToken::Type::EndTag, TagName::script);
            processTokenInForeignContent(WTF::move(fakeToken));
            return;
        }

        m_tree.insertForeignElement(WTF::move(token), currentNamespace);
        break;
    }
    case HTMLToken::Type::EndTag: {
        if (adjustedCurrentNode.namespaceURI() == SVGNames::svgNamespaceURI)
            adjustSVGTagNameCase(token);

        if (token.tagName() == TagName::script && m_tree.currentStackItem().elementName() == SVG::script) {
            m_tree.openElements().pop();
            return;
        }
        if (token.tagName() == TagName::br || token.tagName() == TagName::p) {
            parseError(token);
            m_tree.openElements().popUntilForeignContentScopeMarker();
            processEndTag(WTF::move(token));
            return;
        }
        if (!isInHTMLNamespace(m_tree.currentStackItem())) {
            // FIXME: This code just wants an Element* iterator, instead of an ElementRecord*
            auto* nodeRecord = &m_tree.openElements().topRecord();
            if (nodeRecord->stackItem().localName() != token.name())
                parseError(token);
            while (1) {
                if (nodeRecord->stackItem().localName() == token.name()) {
                    m_tree.openElements().popUntilPopped(protect(nodeRecord->element()));
                    return;
                }
                nodeRecord = nodeRecord->next();

                if (isInHTMLNamespace(nodeRecord->stackItem()))
                    break;
            }
        }
        // Otherwise, process the token according to the rules given in the section corresponding to the current insertion mode in HTML content.
        processEndTag(WTF::move(token));
        break;
    }
    case HTMLToken::Type::Comment:
        m_tree.insertComment(WTF::move(token));
        return;
    case HTMLToken::Type::Character: {
        String characters = token.characters();
        m_tree.insertTextNode(characters);
        if (m_framesetOk && !characters.containsOnly<isASCIIWhitespaceOrReplacementCharacter>())
            m_framesetOk = false;
        break;
    }
    case HTMLToken::Type::EndOfFile:
        ASSERT_NOT_REACHED();
        break;
    }
}

void HTMLTreeBuilder::finished()
{
    ASSERT(!m_destroyed);

    if (isParsingFragment())
        return;

    ASSERT(m_templateInsertionModes.isEmpty());

    m_tree.finishedParsing();
    // The tree builder might have been destroyed as an indirect result of finishing the parsing.
}

inline void HTMLTreeBuilder::parseError(const AtomHTMLToken&)
{
}

}
