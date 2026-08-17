/*
 * Copyright (C) 2022 Apple Inc. All rights reserved.
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
 * THIS SOFTWARE IS PROVIDED BY APPLE INC. AND ITS CONTRIBUTORS ``AS IS''
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO,
 * THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL APPLE INC. OR ITS CONTRIBUTORS
 * BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 * CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 * SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
 * INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
 * CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF
 * THE POSSIBILITY OF SUCH DAMAGE.
 */

#include "config.h"
#include "Lexer.h"

#include "ConstantValue.h"
#include "Token.h"
#include <charconv>
#include <wtf/FastFloat.h>
#include <wtf/SortedArrayMap.h>
#include <wtf/dtoa.h>
#include <wtf/text/StringHash.h>
#include <wtf/text/StringToIntegerConversion.h>
#include <wtf/unicode/CharacterNames.h>

namespace WGSL {

static unsigned isIdentifierStart(char16_t character, std::span<const char16_t> code)
{
    if (character == '_')
        return 1;

    unsigned length = 1;
    if (code.size() > 1 && u_charType(character) == U_SURROGATE)
        ++length;
    if (u_stringHasBinaryProperty(code.data(), length, UCHAR_XID_START))
        return length;
    return 0;
}

static unsigned isIdentifierContinue(char16_t character, std::span<const char16_t> code)
{
    if (auto length = isIdentifierStart(character, code))
        return length;

    unsigned length = 1;
    if (code.size() > 1 && u_charType(character) == U_SURROGATE)
        ++length;
    if (u_stringHasBinaryProperty(code.data(), length, UCHAR_XID_CONTINUE))
        return length;
    return 0;
}

static unsigned isIdentifierStart(Latin1Character character, std::span<const Latin1Character>)
{
    if (isASCIIAlpha(character) || character == '_')
        return 1;
    char16_t uChar = character;
    if (u_stringHasBinaryProperty(&uChar, 1, UCHAR_XID_START))
        return 1;
    return 0;
}

static unsigned isIdentifierContinue(Latin1Character character, std::span<const Latin1Character>)
{
    if (isASCIIAlphanumeric(character) || character == '_')
        return 1;
    char16_t uChar = character;
    if (u_stringHasBinaryProperty(&uChar, 1, UCHAR_XID_CONTINUE))
        return 1;
    return 0;

}

template<typename CharacterType>
Token Lexer<CharacterType>::makeToken(TokenType type)
{
    return { type, m_tokenStartingPosition, currentTokenLength() };
}

template<typename CharacterType>
Token Lexer<CharacterType>::makeFloatToken(TokenType type, double floatValue)
{
    return { type, m_tokenStartingPosition, currentTokenLength(), floatValue };
}

template<typename CharacterType>
Token Lexer<CharacterType>::makeIntegerToken(TokenType type, int64_t integerValue)
{
    return { type, m_tokenStartingPosition, currentTokenLength(), integerValue };
}

template<typename CharacterType>
Token Lexer<CharacterType>::makeIdentifierToken(String&& identifier)
{
    return { WGSL::TokenType::Identifier, m_tokenStartingPosition, currentTokenLength(), WTF::move(identifier) };
}

template<typename T>
Vector<Token> Lexer<T>::lex()
{
    Vector<Token> tokens;

    while (true) {
        auto token = nextToken();
        tokens.append(token);
        switch (token.type) {
        case TokenType::GtGtEq:
            tokens.append(makeToken(TokenType::Placeholder));
            [[fallthrough]];
        case TokenType::GtGt:
        case TokenType::GtEq:
        case TokenType::MinusMinus:
            tokens.append(makeToken(TokenType::Placeholder));
            break;
        default:
            break;
        }

        if (token.type == TokenType::EndOfFile || token.type == TokenType::Invalid)
            break;
    }

    return tokens;
}

template <typename T>
Token Lexer<T>::nextToken()
{
    if (!skipWhitespaceAndComments())
        return makeToken(TokenType::Invalid);

    m_tokenStartingPosition = m_currentPosition;

    if (isAtEndOfFile())
        return makeToken(TokenType::EndOfFile);

    switch (m_current) {
    case '!':
        shift();
        if (m_current == '=') {
            shift();
            return makeToken(TokenType::BangEq);
        }
        return makeToken(TokenType::Bang);
    case '%':
        shift();
        switch (m_current) {
        case '=':
            shift();
            return makeToken(TokenType::ModuloEq);
        default:
            return makeToken(TokenType::Modulo);
        }
    case '&':
        shift();
        switch (m_current) {
        case '&':
            shift();
            return makeToken(TokenType::AndAnd);
        case '=':
            shift();
            return makeToken(TokenType::AndEq);
        default:
            return makeToken(TokenType::And);
        }
    case '(':
        shift();
        return makeToken(TokenType::ParenLeft);
    case ')':
        shift();
        return makeToken(TokenType::ParenRight);
    case '{':
        shift();
        return makeToken(TokenType::BraceLeft);
    case '}':
        shift();
        return makeToken(TokenType::BraceRight);
    case '[':
        shift();
        return makeToken(TokenType::BracketLeft);
    case ']':
        shift();
        return makeToken(TokenType::BracketRight);
    case ':':
        shift();
        return makeToken(TokenType::Colon);
    case ',':
        shift();
        return makeToken(TokenType::Comma);
    case ';':
        shift();
        return makeToken(TokenType::Semicolon);
    case '=':
        shift();
        if (m_current == '=') {
            shift();
            return makeToken(TokenType::EqEq);
        }
        return makeToken(TokenType::Equal);
    case '>':
        shift();
        switch (m_current) {
        case '=':
            shift();
            return makeToken(TokenType::GtEq);
        case '>':
            shift();
            switch (m_current) {
            case '=':
                shift();
                return makeToken(TokenType::GtGtEq);
            default:
                return makeToken(TokenType::GtGt);
            }
        default:
            return makeToken(TokenType::Gt);
        }
    case '<':
        shift();
        switch (m_current) {
        case '=':
            shift();
            return makeToken(TokenType::LtEq);
        case '<':
            shift();
            switch (m_current) {
            case '=':
                shift();
                return makeToken(TokenType::LtLtEq);
            default:
                return makeToken(TokenType::LtLt);
            }
        default:
            return makeToken(TokenType::Lt);
        }
    case '@':
        shift();
        return makeToken(TokenType::Attribute);
    case '*':
        shift();
        switch (m_current) {
        case '=':
            shift();
            return makeToken(TokenType::StarEq);
        default:
            return makeToken(TokenType::Star);
        }
    case '/':
        shift();
        switch (m_current) {
        case '=':
            shift();
            return makeToken(TokenType::SlashEq);
        default:
            return makeToken(TokenType::Slash);
        }
    case '-':
        shift();
        switch (m_current) {
        case '>':
            shift();
            return makeToken(TokenType::Arrow);
        case '-':
            shift();
            return makeToken(TokenType::MinusMinus);
        case '=':
            shift();
            return makeToken(TokenType::MinusEq);
        default:
            return makeToken(TokenType::Minus);
        }
    case '+':
        shift();
        switch (m_current) {
        case '+':
            shift();
            return makeToken(TokenType::PlusPlus);
        case '=':
            shift();
            return makeToken(TokenType::PlusEq);
        default:
            return makeToken(TokenType::Plus);
        }
    case '^':
        shift();
        switch (m_current) {
        case '=':
            shift();
            return makeToken(TokenType::XorEq);
        default:
            return makeToken(TokenType::Xor);
        }
    case '|':
        shift();
        switch (m_current) {
        case '|':
            shift();
            return makeToken(TokenType::OrOr);
        case '=':
            shift();
            return makeToken(TokenType::OrEq);
        default:
            return makeToken(TokenType::Or);
        }
    case '~':
        shift();
        return makeToken(TokenType::Tilde);
    default:
        if (isASCIIDigit(m_current) || m_current == '.')
            return lexNumber();
        if (auto consumed = isIdentifierStart(m_current, m_code.span())) {
            unsigned length = consumed;
            auto startOfToken = m_code.span();
            shift(consumed);
            while (!isAtEndOfFile()) {
                auto consumed = isIdentifierContinue(m_current, m_code.span());
                if (!consumed)
                    break;
                length += consumed;
                shift(consumed);
            }

            String view(StringImpl::createWithoutCopying(startOfToken.subspan(0, currentTokenLength())));

            static constexpr SortedArrayMap keywords { WTF::toArray<std::pair<ComparableASCIILiteral, TokenType>>({
                { "_"_s, TokenType::Underbar },

#define MAPPING_ENTRY(lexeme, name)\
                { #lexeme##_s, TokenType::Keyword##name },
FOREACH_KEYWORD(MAPPING_ENTRY)
#undef MAPPING_ENTRY

            }) };

            // https://www.w3.org/TR/WGSL/#reserved-words
            static constexpr SortedArraySet reservedWordSet { WTF::toArray<ComparableASCIILiteral>({
                "NULL"_s,
                "Self"_s,
                "abstract"_s,
                "active"_s,
                "alignas"_s,
                "alignof"_s,
                "as"_s,
                "asm"_s,
                "asm_fragment"_s,
                "async"_s,
                "attribute"_s,
                "auto"_s,
                "await"_s,
                "become"_s,
                "cast"_s,
                "catch"_s,
                "class"_s,
                "co_await"_s,
                "co_return"_s,
                "co_yield"_s,
                "coherent"_s,
                "column_major"_s,
                "common"_s,
                "compile"_s,
                "compile_fragment"_s,
                "concept"_s,
                "const_cast"_s,
                "consteval"_s,
                "constexpr"_s,
                "constinit"_s,
                "crate"_s,
                "debugger"_s,
                "decltype"_s,
                "delete"_s,
                "demote"_s,
                "demote_to_helper"_s,
                "do"_s,
                "dynamic_cast"_s,
                "enum"_s,
                "explicit"_s,
                "export"_s,
                "extends"_s,
                "extern"_s,
                "external"_s,
                "fallthrough"_s,
                "filter"_s,
                "final"_s,
                "finally"_s,
                "friend"_s,
                "from"_s,
                "fxgroup"_s,
                "get"_s,
                "goto"_s,
                "groupshared"_s,
                "highp"_s,
                "impl"_s,
                "implements"_s,
                "import"_s,
                "inline"_s,
                "instanceof"_s,
                "interface"_s,
                "layout"_s,
                "lowp"_s,
                "macro"_s,
                "macro_rules"_s,
                "match"_s,
                "mediump"_s,
                "meta"_s,
                "mod"_s,
                "module"_s,
                "move"_s,
                "mut"_s,
                "mutable"_s,
                "namespace"_s,
                "new"_s,
                "nil"_s,
                "noexcept"_s,
                "noinline"_s,
                "nointerpolation"_s,
                "non_coherent"_s,
                "noncoherent"_s,
                "noperspective"_s,
                "null"_s,
                "nullptr"_s,
                "of"_s,
                "operator"_s,
                "package"_s,
                "packoffset"_s,
                "partition"_s,
                "pass"_s,
                "patch"_s,
                "pixelfragment"_s,
                "precise"_s,
                "precision"_s,
                "premerge"_s,
                "priv"_s,
                "protected"_s,
                "pub"_s,
                "public"_s,
                "readonly"_s,
                "ref"_s,
                "regardless"_s,
                "register"_s,
                "reinterpret_cast"_s,
                "require"_s,
                "resource"_s,
                "restrict"_s,
                "self"_s,
                "set"_s,
                "shared"_s,
                "sizeof"_s,
                "smooth"_s,
                "snorm"_s,
                "static"_s,
                "static_assert"_s,
                "static_cast"_s,
                "std"_s,
                "subroutine"_s,
                "super"_s,
                "target"_s,
                "template"_s,
                "this"_s,
                "thread_local"_s,
                "throw"_s,
                "trait"_s,
                "try"_s,
                "type"_s,
                "typedef"_s,
                "typeid"_s,
                "typename"_s,
                "typeof"_s,
                "union"_s,
                "unless"_s,
                "unorm"_s,
                "unsafe"_s,
                "unsized"_s,
                "use"_s,
                "using"_s,
                "varying"_s,
                "virtual"_s,
                "volatile"_s,
                "wgsl"_s,
                "where"_s,
                "with"_s,
                "writeonly"_s,
                "yield"_s,
            }) };

            auto tokenType = keywords.get(view);
            if (tokenType != TokenType::Invalid)
                return makeToken(tokenType);

            if (reservedWordSet.contains(view)) [[unlikely]]
                return makeToken(TokenType::ReservedWord);


            if (length >= 2 && startOfToken[0] == '_' && startOfToken[1] == '_') [[unlikely]]
                return makeToken(TokenType::Invalid);


            return makeIdentifierToken(WTF::move(view));
        }
        break;
    }
    return makeToken(TokenType::Invalid);
}

template <typename T>
T Lexer<T>::shift(unsigned i)
{
    ASSERT(i <= m_code.lengthRemaining());

    T last = m_current;
    // At one point timing showed that setting m_current to 0 unconditionally was faster than an if-else sequence.
    m_current = 0;
    m_code.advanceBy(i);
    m_currentPosition.offset += i;
    m_currentPosition.lineOffset += i;
    if (m_code.hasCharactersRemaining()) [[likely]]
        m_current = m_code[0];
    return last;
}

template <typename T>
T Lexer<T>::peek(unsigned i)
{
    if (i >= m_code.lengthRemaining()) [[unlikely]]
        return 0;
    return m_code[i];
}

template <typename T>
void Lexer<T>::newLine()
{
    m_currentPosition.line += 1;
    m_currentPosition.lineOffset = 0;
}

template <typename T>
bool Lexer<T>::skipBlockComments()
{
    ASSERT(peek(0) == '/' && peek(1) == '*');
    shift(2);

    T ch = 0;
    unsigned depth = 1u;

    while (!isAtEndOfFile() && (ch = shift())) {
        if (ch == '/' && peek() == '*') {
            shift();
            depth += 1;
        } else if (ch == '*' && peek() == '/') {
            shift();
            depth -= 1;
            if (!depth) {
                // This block comment is closed, so for a construction like "/* */ */"
                // there will be a successfully parsed block comment "/* */"
                // and " */" will be processed separately.
                return true;
            }
        } else if (ch == '\n')
            newLine();
        else if (ch == '\0')
            return false;
    }

    return false;
}

template <typename T>
bool Lexer<T>::skipLineComment()
{
    ASSERT(peek(0) == '/' && peek(1) == '/');
    // Note that in the case of \r\n this makes the comment end on the \r. It is
    // fine, as the \n after that is simple whitespace.
    while (!isAtEndOfFile() && peek() != '\n') {
        if (peek() == '\0')
            return false;
        shift();
    }
    return true;
}

template <typename T>
bool Lexer<T>::skipWhitespaceAndComments()
{
    while (!isAtEndOfFile()) {
        auto isWhitespace = isUnicodeCompatibleASCIIWhitespace(m_current) || m_current == u'\x85';
        if (std::is_same_v<T, char16_t>) {
            isWhitespace = isWhitespace
                || m_current == u'\U0000200E'
                || m_current == u'\U0000200F'
                || m_current == u'\U00002028'
                || m_current == u'\U00002029';
        }
        if (isWhitespace) {
            if (shift() == '\n')
                newLine();
        } else if (peek(0) == '/') {
            if (peek(1) == '/') {
                if (!skipLineComment())
                    return false;
            } else if (peek(1) == '*') {
                if (!skipBlockComments())
                    return false;
            } else
                break;
        } else
            break;
    }
    return true;
}

template <typename T>
bool Lexer<T>::isAtEndOfFile() const
{
    if (m_code.atEnd()) {
        ASSERT(!m_current);
        return true;
    }
    return false;
}

template <typename T>
Token Lexer<T>::lexNumber()
{
    /* Grammar:
    decimal_int_literal:
    | /0[iu]?/
    | /[1-9][0-9]*[iu]?/

    hex_int_literal :
    | /0[xX][0-9a-fA-F]+[iu]?/

    decimal_float_literal:
    | /0[fh]/`
    | /[0-9]*\.[0-9]+([eE][+-]?[0-9]+)?[fh]?/
    | /[0-9]+\.[0-9]*([eE][+-]?[0-9]+)?[fh]?/
    | /[0-9]+[eE][+-]?[0-9]+[fh]?/
    | /[1-9][0-9]*[fh]/

    hex_float_literal:
    | /0[xX][0-9a-fA-F]*\.[0-9a-fA-F]+([pP][+-]?[0-9]+[fh]?)?/
    | /0[xX][0-9a-fA-F]+\.[0-9a-fA-F]*([pP][+-]?[0-9]+[fh]?)?/
    | /0[xX][0-9a-fA-F]+[pP][+-]?[0-9]+[fh]?/
    */

    /* State machine:
    Start -> InitZero (0)
          -> Decimal (1-9)
          -> FloatFractNoIntegral(.)

    InitZero -> End (i, u, f, h, ∅)
             -> Hex (x, X)
             -> Float (0-9)
             -> FloatFract(.)
             -> FloatExponent(e, E)

    Decimal -> End (i, u, f, h, ∅)
            -> Decimal (0-9)
            -> FloatFract(.)
            -> FloatExponent(e, E)

    Float -> Float (0-9)
          -> FloatFract(.)
          -> FloatExponent(e, E)

    FloatFractNoIntegral -> FloatFract (0-9)
                         -> End(∅)

    FloatFract -> FloatFract (0-9)
               -> FloatExponent(e, E)
               -> End(f, h, ∅)

    FloatExponent -> FloatExponentPostSign(+, -)
                  -> FloatExponentNonEmpty(0-9)

    FloatExponentPostSign -> FloatExponentNonEmpty(0-9)

    FloatExponentNonEmpty -> FloatExponentNonEmpty(0-9)
                          -> End(f, h, ∅)

    Hex -> HexNonEmpty(0-9, a-f, A-F)
        -> HexFloatFractNoIntegral(.)

    HexNonEmpty -> HexNonEmpty(0-9, a-f, A-F)
                -> End(i, u, ∅)
                -> HexFloatFract(.)
                -> HexFloatExponentRequireSuffix(p, P)

    HexFloatFractNoIntegral -> HexFloatFract(0-9, a-f, A-F)

    HexFloatFract -> HexFloatFract(0-9, a-f, A-F)
                  -> HexFloatExponent(p, P)
                  -> End(∅)

    HexFloatExponent -> HexFloatExponentNonEmpty(0-9)
                     -> HexFloatExponentPostSign(+, -)

    HexFloatExponentPostSign -> HexFloatExponentNonEmpty(0-9)

    HexFloatExponentNonEmpty -> HexFloatExponentNonEmpty(0-9)
                             -> End(f, h, ∅)

    HexFloatExponentRequireSuffix -> HexFloatExponentRequireSuffixNonEmpty(0-9)
                                  -> HexFloatExponentRequireSuffixPostSign(+, -)

    HexFloatExponentRequireSuffixPostSign -> HexFloatExponentRequireSuffixNonEmpty(0-9)

    HexFloatExponentRequireSuffixNonEmpty -> HexFloatExponentRequireSuffixNonEmpty(0-9)
                                          -> End(f, h)
    */

    enum State : uint8_t {
        Start,

        InitZero,
        Decimal,

        Float,
        FloatFractNoIntegral,
        FloatFract,
        FloatExponent,
        FloatExponentPostSign,
        FloatExponentNonEmpty,

        Hex,
        HexNonEmpty,
        HexFloatFractNoIntegral,
        HexFloatFract,
        HexFloatExponent,
        HexFloatExponentPostSign,
        HexFloatExponentNonEmpty,
        HexFloatExponentRequireSuffix,
        HexFloatExponentRequireSuffixPostSign,
        HexFloatExponentRequireSuffixNonEmpty,

        End,
        EndNoShift,
    };

    auto state = Start;
    char suffix = '\0';
    char exponentSign = '\0';
    bool isHex = false;
    auto start = m_code.span();
    auto integral = m_code.span();
    const T* fract = nullptr;
    const T* exponent = nullptr;

    while (true) {
        switch (state) {
        case Start:
            switch (m_current) {
            case '0':
                state = InitZero;
                break;
            case '.':
                state = FloatFractNoIntegral;
                break;
            default:
                ASSERT(isASCIIDigit(m_current));
                state = Decimal;
                break;
            }
            break;

        case InitZero:
            switch (m_current) {
            case 'i':
            case 'u':
            case 'f':
            case 'h':
                state = End;
                suffix = m_current;
                break;

            case 'x':
            case 'X':
                state = Hex;
                break;

            case '.':
                state = FloatFract;
                break;

            case 'e':
            case 'E':
                state = FloatExponent;
                break;

            default:
                if (isASCIIDigit(m_current))
                    state = Float;
                else
                    state = EndNoShift;
            }
            break;

        case Decimal:
            switch (m_current) {
            case 'i':
            case 'u':
            case 'f':
            case 'h':
                state = End;
                suffix = m_current;
                break;

            case '.':
                state = FloatFract;
                break;

            case 'e':
            case 'E':
                state = FloatExponent;
                break;

            default:
                if (!isASCIIDigit(m_current))
                    state = EndNoShift;
            }
            break;

        case Float:
            switch (m_current) {
            case '.':
                state = FloatFract;
                break;

            case 'e':
            case 'E':
                state = FloatExponent;
                break;

            default:
                if (!isASCIIDigit(m_current))
                    return makeToken(TokenType::Invalid);
            }
            break;
        case FloatFractNoIntegral:
            fract = m_code.position();
            if (!isASCIIDigit(m_current))
                return makeToken(TokenType::Period);
            state = FloatFract;
            break;
        case FloatFract:
            if (!fract)
                fract = m_code.position();
            switch (m_current) {
            case 'f':
            case 'h':
                state = End;
                suffix = m_current;
                break;

            case 'e':
            case 'E':
                state = FloatExponent;
                break;

            default:
                if (!isASCIIDigit(m_current))
                    state = EndNoShift;
            }
            break;
        case FloatExponent:
            exponent = m_code.position();
            switch (m_current) {
            case '+':
            case '-':
                exponentSign = m_current;
                state = FloatExponentPostSign;
                break;
            default:
                if (!isASCIIDigit(m_current))
                    return makeToken(TokenType::Invalid);
                state = FloatExponentNonEmpty;
            }
            break;
        case FloatExponentPostSign:
            if (exponentSign == '+')
                exponent = m_code.position();
            if (!isASCIIDigit(m_current))
                return makeToken(TokenType::Invalid);
            state = FloatExponentNonEmpty;
            break;
        case FloatExponentNonEmpty:
            switch (m_current) {
            case 'f':
            case 'h':
                state = End;
                suffix = m_current;
                break;
            default:
                if (!isASCIIDigit(m_current))
                    state = EndNoShift;
            }
            break;
        case Hex:
            isHex = true;
            integral = m_code.span();
            if (m_current == '.')
                state = HexFloatFractNoIntegral;
            else if (isASCIIHexDigit(m_current))
                state = HexNonEmpty;
            else
                return makeToken(TokenType::Invalid);
            break;
        case HexNonEmpty:
            switch (m_current) {
            case 'i':
            case 'u':
                state = End;
                suffix = m_current;
                break;

            case 'p':
            case 'P':
                state = HexFloatExponentRequireSuffix;
                break;

            case '.':
                state = HexFloatFract;
                break;

            default:
                if (!isASCIIHexDigit(m_current))
                    state = EndNoShift;
            }
            break;
        case HexFloatFractNoIntegral:
            fract = m_code.position();
            if (!isASCIIHexDigit(m_current))
                return makeToken(TokenType::Invalid);
            state = HexFloatFract;
            break;
        case HexFloatFract:
            if (!fract)
                fract = m_code.position();
            if (isASCIIHexDigit(m_current))
                break;
            if (m_current == 'p' || m_current == 'P')
                state = HexFloatExponent;
            else
                state = EndNoShift;
            break;
        case HexFloatExponent:
            exponent = m_code.position();
            if (isASCIIDigit(m_current))
                state = HexFloatExponentNonEmpty;
            else if (m_current == '+' || m_current == '-') {
                exponentSign = m_current;
                state = HexFloatExponentPostSign;
            } else
                return makeToken(TokenType::Invalid);
            break;
        case HexFloatExponentPostSign:
            if (exponentSign == '+')
                exponent = m_code.position();
            if (isASCIIDigit(m_current)) {
                state = HexFloatExponentNonEmpty;
                break;
            }
            return makeToken(TokenType::Invalid);
        case HexFloatExponentNonEmpty:
            if (isASCIIDigit(m_current))
                state = HexFloatExponentNonEmpty;
            else if (m_current == 'f' || m_current == 'h') {
                state = End;
                suffix = m_current;
            } else
                state = EndNoShift;
            break;
        case HexFloatExponentRequireSuffix:
            exponent = m_code.position();
            if (isASCIIDigit(m_current))
                state = HexFloatExponentRequireSuffixNonEmpty;
            else if (m_current == '+' || m_current == '-') {
                exponentSign = m_current;
                state = HexFloatExponentRequireSuffixPostSign;
            } else
                return makeToken(TokenType::Invalid);
            break;
        case HexFloatExponentRequireSuffixPostSign:
            if (exponentSign == '+')
                exponent = m_code.position();
            if (isASCIIDigit(m_current)) {
                state = HexFloatExponentRequireSuffixNonEmpty;
                break;
            }
            return makeToken(TokenType::Invalid);
        case HexFloatExponentRequireSuffixNonEmpty:
            if (isASCIIDigit(m_current))
                state = HexFloatExponentNonEmpty;
            else if (m_current == 'f' || m_current == 'h') {
                state = End;
                suffix = m_current;
            } else
                return makeToken(TokenType::Invalid);
            break;
        case End:
        case EndNoShift:
            RELEASE_ASSERT_NOT_REACHED();
        }

        if (state == EndNoShift)
            break;
        shift();
        if (state == End)
            break;
    }

    const auto& convert = [&](auto value) -> Token {
        switch (suffix) {
        case 'i': {
            if constexpr (std::is_integral_v<decltype(value)>) {
                if (auto result = convertInteger<int>(value))
                    return makeIntegerToken(TokenType::IntegerLiteralSigned, *result);
            }
            break;
        }
        case 'u': {
            if constexpr (std::is_integral_v<decltype(value)>) {
                if (auto result = convertInteger<unsigned>(value))
                    return makeIntegerToken(TokenType::IntegerLiteralUnsigned, *result);
            }
            break;
        }
        case 'f': {
            if (auto result = convertFloat<float>(value))
                return makeFloatToken(TokenType::FloatLiteral, *result);
            break;
        }
        case 'h':
            if (auto result = convertFloat<half>(value))
                return makeFloatToken(TokenType::HalfLiteral, *result);
            break;
        default:
            if constexpr (std::is_floating_point_v<decltype(value)>) {
                if (auto result = convertFloat<double>(value))
                    return makeFloatToken(TokenType::AbstractFloatLiteral, *result);
            } else {
                if (auto result = convertInteger<int64_t>(value))
                    return makeIntegerToken(TokenType::IntegerLiteral, *result);
            }
        }
        return makeToken(TokenType::Invalid);
    };

    if (!fract && !exponent && suffix != 'f' && suffix != 'h') {
        auto base = isHex ? 16 : 10;
        auto result = WTF::parseInteger<int64_t>(integral, base, WTF::TrailingJunkPolicy::Allow);
        if (!result)
            return makeToken(TokenType::Invalid);
        return convert(result.value());
    }

    if (!isHex) {
        size_t parsedLength;
        double result = WTF::parseDouble(integral, parsedLength);
        return convert(result);
    }

    auto length = static_cast<size_t>(m_code.position() - start.data());
    if (suffix)
        length--;
    Vector<char, 256> buffer(length + 1);
    for (unsigned i = 0; i < length; ++i)
        buffer[i] = start[i];
    buffer[length] = '\0';
    size_t parsedLength;
    auto maybeResult = stringToDouble(buffer.span(), parsedLength);
    if (!maybeResult || parsedLength != length)
        return makeToken(TokenType::Invalid);
    return convert(*maybeResult);
}

template class Lexer<Latin1Character>;
template class Lexer<char16_t>;

}
