/*
 * Copyright (C) 2010 Google, Inc. All rights reserved.
 * Copyright (C) 2015-2021 Apple Inc. All rights reserved.
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

#include "HTMLInputStream.h"
#include "HTMLTokenizer.h"
#include "ScriptableDocumentParser.h"

namespace WebCore {

class CustomElementRegistry;
class DocumentFragment;
class Element;
class HTMLDocument;
class HTMLNameCache;
class HTMLTreeBuilder;

DECLARE_ALLOCATOR_WITH_HEAP_IDENTIFIER(HTMLDocumentParser);
class HTMLDocumentParser : public ScriptableDocumentParser {
    WTF_DEPRECATED_MAKE_FAST_ALLOCATED_WITH_HEAP_IDENTIFIER(HTMLDocumentParser, HTMLDocumentParser);
public:
    static Ref<HTMLDocumentParser> create(HTMLDocument&, OptionSet<ParserContentPolicy> = DefaultParserContentPolicy);
    virtual ~HTMLDocumentParser();

    HTMLDocumentParser* asHTMLDocumentParser() final { return this; }

    static void parseDocumentFragment(const String&, DocumentFragment&, Element& contextElement, OptionSet<ParserContentPolicy> = { ParserContentPolicy::AllowScriptingContent }, CustomElementRegistry* = nullptr);

    // For HTMLTreeBuilder.
    HTMLTokenizer& tokenizer() LIFETIME_BOUND;
    TextPosition textPosition() const final;

protected:
    explicit HTMLDocumentParser(HTMLDocument&, OptionSet<ParserContentPolicy> = DefaultParserContentPolicy);

    void insert(SegmentedString&&) final;
    void append(RefPtr<StringImpl>&&) override;
    void finish() override;

    HTMLTreeBuilder& treeBuilder() LIFETIME_BOUND { return m_treeBuilder; }

private:
    HTMLDocumentParser(DocumentFragment&, Element& contextElement, OptionSet<ParserContentPolicy>, CustomElementRegistry*);
    static Ref<HTMLDocumentParser> create(DocumentFragment&, Element& contextElement, OptionSet<ParserContentPolicy>, CustomElementRegistry* = nullptr);

    // DocumentParser
    bool LEGACY_NODELETE hasInsertionPoint() final;
    bool processingData() const final;
    void prepareToStopParsing() final;
    bool LEGACY_NODELETE isWaitingForScripts() const;

    void pumpTokenizer();
    void pumpTokenizerIfPossible();
    void constructTreeFromHTMLToken(HTMLTokenizer::TokenPtr&);

    void runScriptsForPausedTreeBuilder();

    void attemptToEnd();
    void endIfDelayed();
    void end();

    bool LEGACY_NODELETE isParsingFragment() const;
    bool LEGACY_NODELETE inPumpSession() const;
    bool shouldDelayEnd() const;

    HTMLParserOptions m_options;
    HTMLInputStream m_input;

    HTMLTokenizer m_tokenizer;
    const UniqueRef<HTMLTreeBuilder> m_treeBuilder;
    HTMLNameCache& m_nameCache;

    bool m_endWasDelayed { false };
    unsigned m_pumpSessionNestingLevel { 0 };
};

inline HTMLTokenizer& HTMLDocumentParser::tokenizer()
{
    return m_tokenizer;
}

} // namespace WebCore
