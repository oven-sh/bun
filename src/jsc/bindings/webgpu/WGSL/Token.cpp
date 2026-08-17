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
#include "Token.h"

namespace WGSL {

String toString(TokenType type)
{
    switch (type) {
    case TokenType::Invalid:
        return "Invalid"_s;
    case TokenType::EndOfFile:
        return "EOF"_s;
    case TokenType::AbstractFloatLiteral:
        return "AbstractFloatLiteral"_s;
    case TokenType::IntegerLiteral:
        return "IntegerLiteral"_s;
    case TokenType::IntegerLiteralSigned:
        return "IntegerLiteralSigned"_s;
    case TokenType::IntegerLiteralUnsigned:
        return "IntegerLiteralUnsigned"_s;
    case TokenType::FloatLiteral:
        return "FloatLiteral"_s;
    case TokenType::HalfLiteral:
        return "HalfLiteral"_s;
    case TokenType::Identifier:
        return "Identifier"_s;
    case TokenType::ReservedWord:
        return "ReservedWord"_s;

#define KEYWORD_TO_STRING(lexeme, name) \
    case TokenType::Keyword##name: \
        return #lexeme##_s;
FOREACH_KEYWORD(KEYWORD_TO_STRING)
#undef KEYWORD_TO_STRING

    case TokenType::And:
        return "&"_s;
    case TokenType::AndAnd:
        return "&&"_s;
    case TokenType::AndEq:
        return "&="_s;
    case TokenType::Arrow:
        return "->"_s;
    case TokenType::Attribute:
        return "@"_s;
    case TokenType::Bang:
        return "!"_s;
    case TokenType::BangEq:
        return "!="_s;
    case TokenType::BracketLeft:
        return "["_s;
    case TokenType::BracketRight:
        return "]"_s;
    case TokenType::BraceLeft:
        return "{"_s;
    case TokenType::BraceRight:
        return "}"_s;
    case TokenType::Colon:
        return ":"_s;
    case TokenType::Comma:
        return ","_s;
    case TokenType::Equal:
        return "="_s;
    case TokenType::EqEq:
        return "=="_s;
    case TokenType::TemplateArgsRight:
    case TokenType::Gt:
        return ">"_s;
    case TokenType::GtEq:
        return ">="_s;
    case TokenType::GtGt:
        return ">>"_s;
    case TokenType::GtGtEq:
        return ">>="_s;
    case TokenType::TemplateArgsLeft:
    case TokenType::Lt:
        return "<"_s;
    case TokenType::LtEq:
        return "<="_s;
    case TokenType::LtLt:
        return "<<"_s;
    case TokenType::LtLtEq:
        return "<<="_s;
    case TokenType::Minus:
        return "-"_s;
    case TokenType::MinusMinus:
        return "--"_s;
    case TokenType::MinusEq:
        return "-="_s;
    case TokenType::Modulo:
        return "%"_s;
    case TokenType::ModuloEq:
        return "%="_s;
    case TokenType::Or:
        return "|"_s;
    case TokenType::OrOr:
        return "||"_s;
    case TokenType::OrEq:
        return "|="_s;
    case TokenType::Plus:
        return "+"_s;
    case TokenType::PlusPlus:
        return "++"_s;
    case TokenType::PlusEq:
        return "+="_s;
    case TokenType::Period:
        return "."_s;
    case TokenType::ParenLeft:
        return "("_s;
    case TokenType::ParenRight:
        return ")"_s;
    case TokenType::Semicolon:
        return ";"_s;
    case TokenType::Slash:
        return "/"_s;
    case TokenType::SlashEq:
        return "/="_s;
    case TokenType::Star:
        return "*"_s;
    case TokenType::StarEq:
        return "*="_s;
    case TokenType::Tilde:
        return "~"_s;
    case TokenType::Underbar:
        return "_"_s;
    case TokenType::Xor:
        return "^"_s;
    case TokenType::XorEq:
        return "^="_s;
    case TokenType::Placeholder:
        return "<placeholder>"_s;
    }
}

}
