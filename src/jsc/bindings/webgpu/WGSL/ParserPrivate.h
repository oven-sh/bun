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

#pragma once

#include "ASTAttribute.h"
#include "ASTBuilder.h"
#include "ASTConstAssert.h"
#include "ASTExpression.h"
#include "ASTForward.h"
#include "ASTFunction.h"
#include "ASTStatement.h"
#include "ASTStructure.h"
#include "ASTTypeAlias.h"
#include "ASTVariable.h"
#include "CompilationMessage.h"
#include "Lexer.h"
#include "Token.h"
#include "WGSLShaderModule.h"
#include <wtf/Ref.h>

namespace WGSL {

class ShaderModule;

template<typename Lexer>
class Parser {
public:
    Parser(ShaderModule& shaderModule, Lexer& lexer)
        : m_shaderModule(shaderModule)
        , m_builder(shaderModule.astBuilder())
        , m_lexer(lexer)
        , m_tokens(m_lexer.lex())
        , m_current(m_tokens[0])
        , m_currentPosition({ m_current.span.line, m_current.span.lineOffset, m_current.span.offset })
    {
    }

    Result<void> parseShader();

    void maybeSplitToken(unsigned index);
    void splitMinusMinus();
    void disambiguateTemplates();
    bool canContinueAdditiveExpression(const Token&);
    bool canBeginUnaryExpression(const Token&);

    // AST::<type>::Ref whenever it can return multiple types.
    Result<AST::Identifier> parseIdentifier();
    Result<void> parseEnableDirective();
    Result<void> parseRequireDirective();
    Result<AST::Declaration::Ref> parseDeclaration();
    Result<AST::ConstAssert::Ref> parseConstAssert();
    Result<AST::Attribute::List> parseAttributes();
    Result<std::optional<AST::Attribute::Ref>> parseAttribute();
    Result<AST::Structure::Ref> parseStructure();
    Result<std::reference_wrapper<AST::StructureMember>> parseStructureMember();
    Result<AST::Expression::Ref> parseTypeName();
    Result<AST::Expression::Ref> parseTypeNameAfterIdentifier(AST::Identifier&&, SourcePosition start);
    Result<AST::Expression::Ref> parseArrayType();
    Result<AST::Variable::Ref> parseVariable();
    Result<AST::Variable::Ref> parseVariableWithAttributes(AST::Attribute::List&&);
    Result<AST::VariableQualifier::Ref> parseVariableQualifier();
    Result<AddressSpace> parseAddressSpace();
    Result<AccessMode> parseAccessMode();
    Result<AST::TypeAlias::Ref> parseTypeAlias();
    Result<AST::Function::Ref> parseFunction(AST::Attribute::List&&);
    Result<std::reference_wrapper<AST::Parameter>> parseParameter();
    Result<AST::Statement::Ref> parseStatement();
    Result<AST::CompoundStatement::Ref> parseCompoundStatement();
    Result<AST::CompoundStatement::Ref> parseCompoundStatement(AST::Attribute::List&&);
    Result<AST::Statement::Ref> parseIfStatement();
    Result<AST::Statement::Ref> parseIfStatementWithAttributes(AST::Attribute::List&&, SourcePosition _startOfElementPosition);
    Result<AST::Statement::Ref> parseForStatement(AST::Attribute::List&&);
    Result<AST::Statement::Ref> parseLoopStatement(AST::Attribute::List&&);
    Result<AST::Statement::Ref> parseSwitchStatement(AST::Attribute::List&&);
    Result<AST::Statement::Ref> parseWhileStatement(AST::Attribute::List&&);
    Result<AST::Statement::Ref> parseReturnStatement();
    Result<AST::Statement::Ref> parseVariableUpdatingStatement();
    Result<AST::Statement::Ref> parseVariableUpdatingStatement(AST::Expression::Ref&&);
    Result<AST::Expression::Ref> parseShortCircuitExpression(AST::Expression::Ref&&, TokenType, AST::BinaryOperation);
    Result<AST::Expression::Ref> parseRelationalExpression();
    Result<AST::Expression::Ref> parseRelationalExpressionPostUnary(AST::Expression::Ref&& lhs);
    Result<AST::Expression::Ref> parseShiftExpression();
    Result<AST::Expression::Ref> parseShiftExpressionPostUnary(AST::Expression::Ref&& lhs);
    Result<AST::Expression::Ref> parseAdditiveExpressionPostUnary(AST::Expression::Ref&& lhs);
    Result<AST::Expression::Ref> parseBitwiseExpressionPostUnary(AST::Expression::Ref&& lhs);
    Result<AST::Expression::Ref> parseMultiplicativeExpressionPostUnary(AST::Expression::Ref&& lhs);
    Result<AST::Expression::Ref> parseUnaryExpression();
    Result<AST::Expression::Ref> parseSingularExpression();
    Result<AST::Expression::Ref> parsePostfixExpression(AST::Expression::Ref&& base, SourcePosition startPosition);
    Result<AST::Expression::Ref> parsePrimaryExpression();
    Result<AST::Expression::Ref> parseExpression();
    Result<AST::Expression::Ref> parseLHSExpression();
    Result<AST::Expression::Ref> parseCoreLHSExpression();
    Result<AST::Expression::List> parseArgumentExpressionList();
    Result<std::optional<AST::Diagnostic>> parseDiagnostic();

    Vector<Warning> takeWarnings() { return WTF::move(m_warnings); }

private:
    Expected<Token, TokenType> consumeType(TokenType);
    template<TokenType... TTs> Expected<Token, TokenType> consumeTypes();

    void consume();

    Token& current() { return m_current; }

    ShaderModule& m_shaderModule;
    AST::Builder& m_builder;
    Lexer& m_lexer;
    Vector<Token> m_tokens;
    Vector<Warning> m_warnings;
    unsigned m_currentTokenIndex { 0 };
    unsigned m_parseDepth { 0 };
    unsigned m_compositeTypeDepth { 0 };
    Token m_current;
    SourcePosition m_currentPosition;
};

} // namespace WGSL
