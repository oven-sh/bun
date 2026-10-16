/*
 * Copyright (C) 2008, 2015 Apple Inc. All rights reserved.
 * Copyright (C) 2010 Google, Inc. All rights reserved.
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

#include "HTMLParserOptions.h"
#include "HTMLToken.h"
#include "InputStreamPreprocessor.h"
#include "NodeName.h"

namespace WebCore {

class SegmentedString;

class HTMLTokenizer {
public:
    explicit HTMLTokenizer(const HTMLParserOptions& = HTMLParserOptions());

    // If we can't parse a whole token, this returns null.
    class TokenPtr;
    TokenPtr nextToken(SegmentedString&);

    // Returns a copy of any characters buffered internally by the tokenizer.
    // The tokenizer buffers characters when searching for the </script> token that terminates a script element.
    String bufferedCharacters() const;
    size_t numberOfBufferedCharacters() const;

    // Updates the tokenizer's state according to the given tag name. This is an approximation of how the tree
    // builder would update the tokenizer's state. This method is useful for approximating HTML tokenization.
    // To get exactly the correct tokenization, you need the real tree builder.
    //
    // The main failures in the approximation are as follows:
    //
    //  * The first set of character tokens emitted for a <pre> element might contain an extra leading newline.
    //  * The replacement of U+0000 with U+FFFD will not be sensitive to the tree builder's insertion mode.
    //  * CDATA sections in foreign content will be tokenized as bogus comments instead of as character tokens.
    //
    // This approximation is also the algorithm called for when parsing an HTML fragment.
    // https://html.spec.whatwg.org/multipage/syntax.html#parsing-html-fragments
    void LEGACY_NODELETE updateStateFor(ElementName);

    void setForceNullCharacterReplacement(bool);

    bool shouldAllowCDATA() const;
    void setShouldAllowCDATA(bool);

    bool isInDataState() const;

    void setDataState();
    void setPLAINTEXTState();
    void setRAWTEXTState();
    void setRCDATAState();
    void setScriptDataState();

private:
    enum State {
        DataState,
        CharacterReferenceInDataState,
        RCDATAState,
        CharacterReferenceInRCDATAState,
        RAWTEXTState,
        ScriptDataState,
        PLAINTEXTState,
        TagOpenState,
        EndTagOpenState,
        TagNameState,
        RCDATALessThanSignState,
        RCDATAEndTagOpenState,
        RCDATAEndTagNameState,
        RAWTEXTLessThanSignState,
        RAWTEXTEndTagOpenState,
        RAWTEXTEndTagNameState,
        ScriptDataLessThanSignState,
        ScriptDataEndTagOpenState,
        ScriptDataEndTagNameState,
        ScriptDataEscapeStartState,
        ScriptDataEscapeStartDashState,
        ScriptDataEscapedState,
        ScriptDataEscapedDashState,
        ScriptDataEscapedDashDashState,
        ScriptDataEscapedLessThanSignState,
        ScriptDataEscapedEndTagOpenState,
        ScriptDataEscapedEndTagNameState,
        ScriptDataDoubleEscapeStartState,
        ScriptDataDoubleEscapedState,
        ScriptDataDoubleEscapedDashState,
        ScriptDataDoubleEscapedDashDashState,
        ScriptDataDoubleEscapedLessThanSignState,
        ScriptDataDoubleEscapeEndState,
        BeforeAttributeNameState,
        AttributeNameState,
        AfterAttributeNameState,
        BeforeAttributeValueState,
        AttributeValueDoubleQuotedState,
        AttributeValueSingleQuotedState,
        AttributeValueUnquotedState,
        CharacterReferenceInAttributeValueState,
        AfterAttributeValueQuotedState,
        SelfClosingStartTagState,
        BogusCommentState,
        ContinueBogusCommentState, // Not in the HTML spec, used internally to track whether we started the bogus comment token.
        MarkupDeclarationOpenState,
        CommentStartState,
        CommentStartDashState,
        CommentState,
        CommentEndDashState,
        CommentEndState,
        CommentEndBangState,
        DOCTYPEState,
        BeforeDOCTYPENameState,
        DOCTYPENameState,
        AfterDOCTYPENameState,
        AfterDOCTYPEPublicKeywordState,
        BeforeDOCTYPEPublicIdentifierState,
        DOCTYPEPublicIdentifierDoubleQuotedState,
        DOCTYPEPublicIdentifierSingleQuotedState,
        AfterDOCTYPEPublicIdentifierState,
        BetweenDOCTYPEPublicAndSystemIdentifiersState,
        AfterDOCTYPESystemKeywordState,
        BeforeDOCTYPESystemIdentifierState,
        DOCTYPESystemIdentifierDoubleQuotedState,
        DOCTYPESystemIdentifierSingleQuotedState,
        AfterDOCTYPESystemIdentifierState,
        BogusDOCTYPEState,
        CDATASectionState,
        // These CDATA states are not in the HTML5 spec, but we use them internally.
        CDATASectionRightSquareBracketState,
        CDATASectionDoubleRightSquareBracketState,
    };

    bool processToken(SegmentedString&);
    bool processEntity(SegmentedString&);

    void LEGACY_NODELETE parseError();

    void bufferASCIICharacter(char16_t);
    void bufferCharacter(char16_t);
    template<typename CharacterType> void bufferCharacters(std::span<const CharacterType>);
    void bufferCharacters(ASCIILiteral literal) { bufferCharacters(literal.span8()); }

    bool emitAndResumeInDataState(SegmentedString&);
    bool emitAndReconsumeInDataState();
    bool emitEndOfFile(SegmentedString&);

    // Return true if we wil emit a character token before dealing with the buffered end tag.
    void flushBufferedEndTag();
    bool commitToPartialEndTag(SegmentedString&, char16_t, State);
    bool commitToCompleteEndTag(SegmentedString&);

    void appendToTemporaryBuffer(char16_t);
    bool LEGACY_NODELETE temporaryBufferIs(ASCIILiteral);

    // Sometimes we speculatively consume input characters and we don't know whether they represent
    // end tags or RCDATA, etc. These functions help manage these state.
    bool LEGACY_NODELETE inEndTagBufferingState() const;
    void appendToPossibleEndTag(char16_t);
    void saveEndTagNameIfNeeded();
    bool LEGACY_NODELETE isAppropriateEndTag() const;

    bool LEGACY_NODELETE haveBufferedCharacterToken() const;

    bool LEGACY_NODELETE shouldSkipNullCharacters(State) const;

    State m_state { DataState };
    bool m_forceNullCharacterReplacement { false };
    bool m_shouldAllowCDATA { false };

    mutable HTMLToken m_token;

    // https://html.spec.whatwg.org/#additional-allowed-character
    char16_t m_additionalAllowedCharacter { 0 };

    // https://html.spec.whatwg.org/#preprocessing-the-input-stream
    InputStreamPreprocessor m_preprocessor;

    Vector<char16_t, 32> m_appropriateEndTagName;

    // https://html.spec.whatwg.org/#temporary-buffer
    Vector<Latin1Character, 32> m_temporaryBuffer;

    // We occasionally want to emit both a character token and an end tag
    // token (e.g., when lexing script). We buffer the name of the end tag
    // token here so we remember it next time we re-enter the tokenizer.
    Vector<Latin1Character, 32> m_bufferedEndTagName;

    const HTMLParserOptions m_options;
};

class HTMLTokenizer::TokenPtr {
public:
    TokenPtr();
    ~TokenPtr();

    TokenPtr(TokenPtr&&);
    TokenPtr& operator=(TokenPtr&&) = delete;

    void clear();

    operator bool() const;

    HTMLToken& operator*() const LIFETIME_BOUND;
    HTMLToken* operator->() const LIFETIME_BOUND;

private:
    friend class HTMLTokenizer;
    explicit TokenPtr(HTMLToken*);

    HTMLToken* m_token { nullptr };
};

inline HTMLTokenizer::TokenPtr::TokenPtr()
{
}

inline HTMLTokenizer::TokenPtr::TokenPtr(HTMLToken* token)
    : m_token(token)
{
}

inline HTMLTokenizer::TokenPtr::~TokenPtr()
{
    if (m_token)
        m_token->clear();
}

inline HTMLTokenizer::TokenPtr::TokenPtr(TokenPtr&& other)
    : m_token(other.m_token)
{
    other.m_token = nullptr;
}

inline void HTMLTokenizer::TokenPtr::clear()
{
    if (m_token) {
        m_token->clear();
        m_token = nullptr;
    }
}

inline HTMLTokenizer::TokenPtr::operator bool() const
{
    return m_token;
}

inline HTMLToken& HTMLTokenizer::TokenPtr::operator*() const
{
    ASSERT(m_token);
    return *m_token;
}

inline HTMLToken* HTMLTokenizer::TokenPtr::operator->() const
{
    ASSERT(m_token);
    return m_token;
}

inline HTMLTokenizer::TokenPtr HTMLTokenizer::nextToken(SegmentedString& source)
{
    return TokenPtr(processToken(source) ? &m_token : nullptr);
}

inline size_t HTMLTokenizer::numberOfBufferedCharacters() const
{
    // Notice that we add 2 to the length of the m_temporaryBuffer to
    // account for the "</" characters, which are effecitvely buffered in
    // the tokenizer's state machine.
    return m_temporaryBuffer.size() ? m_temporaryBuffer.size() + 2 : 0;
}

inline void HTMLTokenizer::setForceNullCharacterReplacement(bool value)
{
    m_forceNullCharacterReplacement = value;
}

inline bool HTMLTokenizer::shouldAllowCDATA() const
{
    return m_shouldAllowCDATA;
}

inline void HTMLTokenizer::setShouldAllowCDATA(bool value)
{
    m_shouldAllowCDATA = value;
}

inline bool HTMLTokenizer::isInDataState() const
{
    return m_state == DataState;
}

inline void HTMLTokenizer::setDataState()
{
    m_state = DataState;
}

inline void HTMLTokenizer::setPLAINTEXTState()
{
    m_state = PLAINTEXTState;
}

inline void HTMLTokenizer::setRAWTEXTState()
{
    m_state = RAWTEXTState;
}

inline void HTMLTokenizer::setRCDATAState()
{
    m_state = RCDATAState;
}

inline void HTMLTokenizer::setScriptDataState()
{
    m_state = ScriptDataState;
}

inline bool HTMLTokenizer::shouldSkipNullCharacters(State state) const
{
    return state == DataState && !m_forceNullCharacterReplacement;
}

} // namespace WebCore
