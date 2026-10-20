/*
 * Copyright (C) 2010 Google, Inc. All rights reserved.
 * Copyright (C) 2011-2017 Apple Inc. All rights reserved.
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

#pragma once

#include "HTMLConstructionSite.h"
#include "HTMLDocumentParser.h"
#include "HTMLParserOptions.h"
#include "ScriptElement.h"
#include <wtf/RobinHoodHashMap.h>
#include <wtf/TZoneMalloc.h>
#include <wtf/text/StringBuilder.h>
#include <wtf/text/TextPosition.h>

namespace WebCore {

class JSCustomElementInterface;
class HTMLDocumentParser;

enum class TagName : uint16_t;

struct CustomElementConstructionData {
    WTF_DEPRECATED_MAKE_STRUCT_FAST_ALLOCATED(CustomElementConstructionData);

    CustomElementConstructionData(Ref<JSCustomElementInterface>&&, Ref<CustomElementRegistry>&&, const AtomString& name, Vector<Attribute>&&);
    ~CustomElementConstructionData();

    Ref<JSCustomElementInterface> elementInterface;
    Ref<CustomElementRegistry> registry;
    AtomString name;
    Vector<Attribute> attributes;
};

struct HTMLTreeBuilderAttributeMaps {
    WTF_DEPRECATED_MAKE_STRUCT_FAST_ALLOCATED(HTMLTreeBuilderAttributeMaps);

    HTMLTreeBuilderAttributeMaps();

    const MemoryCompactLookupOnlyRobinHoodHashMap<AtomString, QualifiedName> svgAttributes;
    const MemoryCompactLookupOnlyRobinHoodHashMap<AtomString, QualifiedName> mathMLAttributes;
    const MemoryCompactLookupOnlyRobinHoodHashMap<AtomString, QualifiedName> foreignAttributes;
};

class HTMLTreeBuilder {
    WTF_MAKE_TZONE_ALLOCATED(HTMLTreeBuilder);
public:
    HTMLTreeBuilder(HTMLDocumentParser&, HTMLDocument&, OptionSet<ParserContentPolicy>, const HTMLParserOptions&);
    HTMLTreeBuilder(HTMLDocumentParser&, DocumentFragment&, Element& contextElement, OptionSet<ParserContentPolicy>, const HTMLParserOptions&, CustomElementRegistry*);
    void setShouldSkipLeadingNewline(bool);

    ~HTMLTreeBuilder();

    bool isParsingFragment() const;

    void constructTree(AtomHTMLToken&&);

    bool LEGACY_NODELETE isParsingTemplateContents() const;
    bool hasParserBlockingScriptWork() const;

    // Must be called to take the parser-blocking script before calling the parser again.
    RefPtr<ScriptElement> LEGACY_NODELETE takeScriptToProcess(TextPosition& scriptStartPosition);

    std::unique_ptr<CustomElementConstructionData> takeCustomElementConstructionData() { return WTF::move(m_customElementToConstruct); }
    void didCreateCustomOrFallbackElement(Ref<Element>&&, CustomElementConstructionData&);

    // Done, close any open tags, etc.
    void finished();

private:
    class ExternalCharacterTokenBuffer;

    // Represents HTML5 "insertion mode"
    // http://www.whatwg.org/specs/web-apps/current-work/multipage/parsing.html#insertion-mode
    enum class InsertionMode {
        Initial,
        BeforeHTML,
        BeforeHead,
        InHead,
        InHeadNoscript,
        AfterHead,
        TemplateContents,
        InBody,
        Text,
        InTable,
        InTableText,
        InCaption,
        InColumnGroup,
        InTableBody,
        InRow,
        InCell,
        InSelect,
        InSelectInTable,
        AfterBody,
        InFrameset,
        AfterFrameset,
        AfterAfterBody,
        AfterAfterFrameset,
    };

    bool LEGACY_NODELETE isParsingFragmentOrTemplateContents() const;

    void processToken(AtomHTMLToken&&);

    void processDoctypeToken(AtomHTMLToken&&);
    void processStartTag(AtomHTMLToken&&);
    void processEndTag(AtomHTMLToken&&);
    void processComment(AtomHTMLToken&&);
    void processCharacter(AtomHTMLToken&&);
    void processEndOfFile(AtomHTMLToken&&);

    bool processStartTagForInHead(AtomHTMLToken&&);
    void processStartTagForInBody(AtomHTMLToken&&);
    void processStartTagForInTable(AtomHTMLToken&&);
    void processEndTagForInBody(AtomHTMLToken&&);
    void processEndTagForInTable(AtomHTMLToken&&);
    void processEndTagForInTableBody(AtomHTMLToken&&);
    void processEndTagForInRow(AtomHTMLToken&&);
    void processEndTagForInCell(AtomHTMLToken&&);

    void processHtmlStartTagForInBody(AtomHTMLToken&&);
    bool LEGACY_NODELETE processBodyEndTagForInBody(AtomHTMLToken&&);
    bool processTableEndTagForInTable();
    bool processCaptionEndTagForInCaption();
    bool processColgroupEndTagForInColumnGroup();
    bool processTrEndTagForInRow();

    void processAnyOtherEndTagForInBody(AtomHTMLToken&&);

    inline bool consumeAndInsertWhitespace(ExternalCharacterTokenBuffer&);
    void processCharacterBuffer(ExternalCharacterTokenBuffer&);
    inline void processCharacterBufferForInBody(ExternalCharacterTokenBuffer&);

    void processFakeStartTag(TagName, Vector<Attribute>&& attributes = Vector<Attribute>());
    void processFakeEndTag(TagName);
    void processFakeEndTag(const HTMLStackItem&);
    void processFakeCharacters(const String&);
    void processFakePEndTagIfPInButtonScope();

    void processGenericRCDATAStartTag(AtomHTMLToken&&);
    void processGenericRawTextStartTag(AtomHTMLToken&&);
    void processScriptStartTag(AtomHTMLToken&&);

    // Default processing for the different insertion modes.
    void defaultForInitial();
    void defaultForBeforeHTML();
    void defaultForBeforeHead();
    void defaultForInHead();
    void defaultForInHeadNoscript();
    void defaultForAfterHead();
    void defaultForInTableText();

    bool shouldProcessTokenInForeignContent(const AtomHTMLToken&);
    void processTokenInForeignContent(AtomHTMLToken&&);

    HTMLStackItem& LEGACY_NODELETE adjustedCurrentStackItem() LIFETIME_BOUND;

    ALWAYS_INLINE void updateTokenizerForAdjustedCurrentNode();

    void callTheAdoptionAgency(AtomHTMLToken&);

    void closeTheCell();

    template <bool shouldClose(const HTMLStackItem&)> void processCloseWhenNestedTag(AtomHTMLToken&&);

    void LEGACY_NODELETE parseError(const AtomHTMLToken&);

    void resetInsertionModeAppropriately();

    void insertGenericHTMLElement(AtomHTMLToken&&);

    void processTemplateStartTag(AtomHTMLToken&&);
    bool processTemplateEndTag(AtomHTMLToken&&);
    bool processEndOfFileForInTemplateContents(AtomHTMLToken&&);

    class FragmentParsingContext {
    public:
        FragmentParsingContext();
        FragmentParsingContext(DocumentFragment&, Element& contextElement);

        DocumentFragment* fragment() const;
        Element& LEGACY_NODELETE contextElement();
        HTMLStackItem& LEGACY_NODELETE contextElementStackItem() LIFETIME_BOUND;
        bool contextElementIsTemplate() const;

    private:
        WeakPtr<DocumentFragment, WeakPtrImplWithEventTargetData> m_fragment;
        HTMLStackItem m_contextElementStackItem;
    };

    WeakRef<HTMLDocumentParser> m_parser;
    const HTMLParserOptions m_options;
    FragmentParsingContext m_fragmentContext;

    HTMLConstructionSite m_tree;

    // https://html.spec.whatwg.org/multipage/syntax.html#the-insertion-mode
    InsertionMode m_insertionMode { InsertionMode::Initial };
    InsertionMode m_originalInsertionMode { InsertionMode::Initial };
    Vector<InsertionMode, 1> m_templateInsertionModes;

    // https://html.spec.whatwg.org/multipage/syntax.html#concept-pending-table-char-tokens
    StringBuilder m_pendingTableCharacters;

    RefPtr<ScriptElement> m_scriptToProcess; // <script> tag which needs processing before resuming the parser.
    TextPosition m_scriptToProcessStartPosition; // Starting line number of the script tag needing processing.

    std::unique_ptr<CustomElementConstructionData> m_customElementToConstruct;

    bool m_shouldSkipLeadingNewline { false };

    bool m_framesetOk { true };

#if ASSERT_ENABLED
    bool m_destroyed { false };
    bool m_destructionProhibited { true };
#endif
};

inline HTMLTreeBuilder::~HTMLTreeBuilder()
{
#if ASSERT_ENABLED
    ASSERT(!m_destroyed);
    ASSERT(!m_destructionProhibited);
    m_destroyed = true;
#endif
}

inline void HTMLTreeBuilder::setShouldSkipLeadingNewline(bool shouldSkip)
{
    ASSERT(!m_destroyed);
    m_shouldSkipLeadingNewline = shouldSkip;
}

inline bool HTMLTreeBuilder::isParsingFragment() const
{
    ASSERT(!m_destroyed);
    return !!m_fragmentContext.fragment();
}

inline bool HTMLTreeBuilder::hasParserBlockingScriptWork() const
{
    ASSERT(!m_destroyed);
    ASSERT(!(m_scriptToProcess && m_customElementToConstruct));
    return m_scriptToProcess || m_customElementToConstruct;
}

inline DocumentFragment* HTMLTreeBuilder::FragmentParsingContext::fragment() const
{
    return m_fragment.get();
}

} // namespace WebCore
