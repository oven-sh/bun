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

#include "config.h"
#include "HTMLDocumentParser.h"

#include "CustomElementReactionQueue.h"
#include "CustomElementRegistry.h"
#include "DOMClientData.h"
#include "DocumentFragment.h"
#include "HTMLDocument.h"
#include "HTMLTreeBuilder.h"
#include "JSCustomElementInterface.h"
#include "NestingLevelIncrementer.h"
#include "NodeDocument.h"
#include "ThrowOnDynamicMarkupInsertionCountIncrementer.h"
#include <JavaScriptCore/JSGlobalObject.h>

namespace WebCore {

using namespace HTMLNames;

DEFINE_ALLOCATOR_WITH_HEAP_IDENTIFIER(HTMLDocumentParser);

HTMLDocumentParser::HTMLDocumentParser(HTMLDocument& document, OptionSet<ParserContentPolicy> policy)
    : ScriptableDocumentParser(document, policy)
    , m_tokenizer(m_options)
    , m_treeBuilder(makeUniqueRef<HTMLTreeBuilder>(*this, document, parserContentPolicy(), m_options))
    , m_nameCache(domClientData(document.vm()).htmlNameCache())
{
}

Ref<HTMLDocumentParser> HTMLDocumentParser::create(HTMLDocument& document, OptionSet<ParserContentPolicy> policy)
{
    return adoptRef(*new HTMLDocumentParser(document, policy));
}

inline HTMLDocumentParser::HTMLDocumentParser(DocumentFragment& fragment, Element& contextElement, OptionSet<ParserContentPolicy> rawPolicy, CustomElementRegistry* registry)
    : ScriptableDocumentParser(protect(fragment.document()), rawPolicy)
    , m_tokenizer(m_options)
    , m_treeBuilder(makeUniqueRef<HTMLTreeBuilder>(*this, fragment, contextElement, parserContentPolicy(), m_options, registry))
    , m_nameCache(domClientData(fragment.document().vm()).htmlNameCache())
{
    // https://html.spec.whatwg.org/multipage/syntax.html#parsing-html-fragments
    if (contextElement.isHTMLElement())
        m_tokenizer.updateStateFor(contextElement.elementName());
}

inline Ref<HTMLDocumentParser> HTMLDocumentParser::create(DocumentFragment& fragment, Element& contextElement, OptionSet<ParserContentPolicy> parserContentPolicy, CustomElementRegistry* registry)
{
    return adoptRef(*new HTMLDocumentParser(fragment, contextElement, parserContentPolicy, registry));
}

HTMLDocumentParser::~HTMLDocumentParser()
{
    ASSERT(!m_pumpSessionNestingLevel);
}

// This kicks off "Once the user agent stops parsing" as described by:
// https://html.spec.whatwg.org/multipage/syntax.html#the-end
void HTMLDocumentParser::prepareToStopParsing()
{
    ASSERT(!hasInsertionPoint());

    // pumpTokenizer can cause this parser to be detached from the Document,
    // but we need to ensure it isn't deleted yet.
    Ref<HTMLDocumentParser> protectedThis(*this);

    // NOTE: This pump should only ever emit buffered character tokens.
    pumpTokenizerIfPossible();

    if (isStopped())
        return;

    DocumentParser::prepareToStopParsing();

    if (!isParsingFragment())
        protect(document())->setReadyState(Document::ReadyState::Interactive);

    // Setting the ready state above can fire mutation event and detach us
    // from underneath. In that case, just bail out.
    if (isDetached())
        return;

    end();
}

inline bool HTMLDocumentParser::inPumpSession() const
{
    return m_pumpSessionNestingLevel > 0;
}

inline bool HTMLDocumentParser::shouldDelayEnd() const
{
    return inPumpSession() || isWaitingForScripts();
}

bool HTMLDocumentParser::isParsingFragment() const
{
    return m_treeBuilder->isParsingFragment();
}

bool HTMLDocumentParser::processingData() const
{
    return inPumpSession();
}

void HTMLDocumentParser::pumpTokenizerIfPossible()
{
    if (isStopped() || isWaitingForScripts())
        return;

    pumpTokenizer();
}

void HTMLDocumentParser::runScriptsForPausedTreeBuilder()
{
    ASSERT(scriptingContentIsAllowed(parserContentPolicy()));

    if (std::unique_ptr<CustomElementConstructionData> constructionData = m_treeBuilder->takeCustomElementConstructionData()) {
        ASSERT(!m_treeBuilder->hasParserBlockingScriptWork());

        // https://html.spec.whatwg.org/#create-an-element-for-the-token
        {
            // Prevent document.open/write during reactions by allocating the incrementer before the reactions stack.
            RefPtr document = this->document();
            ThrowOnDynamicMarkupInsertionCountIncrementer incrementer(*document);

            CustomElementReactionStack reactionStack(document->globalObject());
            Ref elementInterface = constructionData->elementInterface.get();
            auto newElement = elementInterface->constructElementWithFallback(*document, constructionData->registry, constructionData->name);
            m_treeBuilder->didCreateCustomOrFallbackElement(WTF::move(newElement), *constructionData);
        }
        return;
    }

    TextPosition scriptStartPosition = TextPosition::belowRangePosition();
    if (auto scriptElement = m_treeBuilder->takeScriptToProcess(scriptStartPosition)) {
        ASSERT(!m_treeBuilder->hasParserBlockingScriptWork());
        scriptElement->prepareScript(scriptStartPosition);
    }
}

void HTMLDocumentParser::pumpTokenizer()
{
    ASSERT(!isStopped());

    // This is an attempt to check that this object is both attached to the Document and protected by something.
    ASSERT(refCount() >= 2);

    NestingLevelIncrementer session(m_pumpSessionNestingLevel);

    do {
        if (isWaitingForScripts()) [[unlikely]] {
            runScriptsForPausedTreeBuilder();
            if (isWaitingForScripts() || isStopped())
                return;
        }

        auto token = m_tokenizer.nextToken(m_input.current());
        if (!token)
            return;

        constructTreeFromHTMLToken(token);
    } while (!isStopped());
}

void HTMLDocumentParser::constructTreeFromHTMLToken(HTMLTokenizer::TokenPtr& rawToken)
{
    AtomHTMLToken token(*rawToken, m_nameCache);

    // We clear the rawToken in case constructTree
    // synchronously re-enters the parser. We don't clear the token immedately
    // for Character tokens because the AtomHTMLToken avoids copying the
    // characters by keeping a pointer to the underlying buffer in the
    // HTMLToken. Fortunately, Character tokens can't cause us to re-enter
    // the parser.
    //
    // FIXME: Stop clearing the rawToken once we start running the parser off
    // the main thread or once we stop allowing synchronous JavaScript
    // execution from parseAttribute.
    if (rawToken->type() != HTMLToken::Type::Character) {
        // Clearing the TokenPtr makes sure we don't clear the HTMLToken a second time
        // later when the TokenPtr is destroyed.
        rawToken.clear();
    }

    m_treeBuilder->constructTree(WTF::move(token));
}

bool HTMLDocumentParser::hasInsertionPoint()
{
    // FIXME: The wasCreatedByScript() branch here might not be fully correct.
    // Our model of the EOF character differs slightly from the one in the spec
    // because our treatment is uniform between network-sourced and script-sourced
    // input streams whereas the spec treats them differently.
    return m_input.hasInsertionPoint() || (wasCreatedByScript() && !m_input.haveSeenEndOfFile());
}

void HTMLDocumentParser::insert(SegmentedString&& source)
{
    if (isStopped())
        return;

    // pumpTokenizer can cause this parser to be detached from the Document,
    // but we need to ensure it isn't deleted yet.
    Ref<HTMLDocumentParser> protectedThis(*this);

    source.setExcludeLineNumbers();
    m_input.insertAtCurrentInsertionPoint(source);
    pumpTokenizerIfPossible();

    endIfDelayed();
}

void HTMLDocumentParser::append(RefPtr<StringImpl>&& inputSource)
{
    if (isStopped())
        return;

    // pumpTokenizer can cause this parser to be detached from the Document,
    // but we need to ensure it isn't deleted yet.
    Ref<HTMLDocumentParser> protectedThis(*this);

    String source { WTF::move(inputSource) };

    m_input.appendToEnd(source);

    if (inPumpSession()) {
        // We've gotten data off the network in a nested write.
        // We don't want to consume any more of the input stream now.  Do
        // not worry.  We'll consume this data in a less-nested write().
        return;
    }

    pumpTokenizerIfPossible();

    endIfDelayed();
}

void HTMLDocumentParser::end()
{
    ASSERT(!isDetached());

    // Informs the rest of WebCore that parsing is really finished (and deletes this).
    m_treeBuilder->finished();
}

void HTMLDocumentParser::attemptToEnd()
{
    // finish() indicates we will not receive any more data.

    if (shouldDelayEnd()) {
        m_endWasDelayed = true;
        return;
    }
    prepareToStopParsing();
}

void HTMLDocumentParser::endIfDelayed()
{
    // If we've already been detached, don't bother ending.
    if (isDetached())
        return;

    if (!m_endWasDelayed || shouldDelayEnd())
        return;

    m_endWasDelayed = false;
    prepareToStopParsing();
}

void HTMLDocumentParser::finish()
{
    // FIXME: We should ASSERT(!m_parserStopped) here, since it does not
    // makes sense to call any methods on DocumentParser once it's been stopped.
    // However, FrameLoader::stop calls DocumentParser::finish unconditionally.

    // We're not going to get any more data off the network, so we tell the
    // input stream we've reached the end of file. finish() can be called more
    // than once, if the first time does not call end().
    if (!m_input.haveSeenEndOfFile())
        m_input.markEndOfFile();

    attemptToEnd();
}

TextPosition HTMLDocumentParser::textPosition() const
{
    auto& currentString = m_input.current();
    return TextPosition(currentString.currentLine(), currentString.currentColumn());
}

bool HTMLDocumentParser::isWaitingForScripts() const
{
    // HTMLTreeBuilder may have a parser blocking script element but we ignore them during fragment parsing.
    if (isParsingFragment())
        return false;
    // When the TreeBuilder encounters a </script> tag or a custom element, it returns to the HTMLDocumentParser,
    // which takes the work from the treebuilder before it asks for the next token.
    return m_treeBuilder->hasParserBlockingScriptWork();
}

void HTMLDocumentParser::parseDocumentFragment(const String& source, DocumentFragment& fragment, Element& contextElement, OptionSet<ParserContentPolicy> parserContentPolicy, CustomElementRegistry* registry)
{
    auto parser = create(fragment, contextElement, parserContentPolicy, registry);
    parser->insert(source); // Use insert() so that the parser will not yield.
    parser->finish();
    ASSERT(!parser->processingData());
    parser->detach();
}

}
