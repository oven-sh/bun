/*
 * Copyright (c) 2023 Apple Inc. All rights reserved.
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
#include "PointerRewriter.h"

#include "AST.h"
#include "ASTScopedVisitorInlines.h"
#include "CallGraph.h"
#include "ContextProviderInlines.h"
#include "WGSL.h"
#include "WGSLShaderModule.h"
#include <wtf/SetForScope.h>

namespace WGSL {

class PointerRewriter : AST::ScopedVisitor<AST::Expression*> {
    using Base = AST::ScopedVisitor<AST::Expression*>;
    using Base::visit;

public:
    PointerRewriter(ShaderModule& shaderModule)
        : Base()
        , m_shaderModule(shaderModule)
    {
    }

    void run();

    void visit(AST::CompoundStatement&) override;
    void visit(AST::VariableStatement&) override;
    void visit(AST::PhonyAssignmentStatement&) override;
    void visit(AST::LoopStatement&) override;
    void visit(AST::IdentifierExpression&) override;
    void visit(AST::UnaryExpression&) override;

private:
    void rewrite(AST::Statement::List&);

    ShaderModule& m_shaderModule;
    unsigned m_currentStatementIndex { 0 };
    Vector<unsigned> m_indicesToDelete;
};

void PointerRewriter::run()
{
    Base::visit(m_shaderModule);
}

void PointerRewriter::rewrite(AST::Statement::List& statements)
{
    auto indexScope = SetForScope(m_currentStatementIndex, 0);
    auto insertionScope = SetForScope(m_indicesToDelete, Vector<unsigned>());
    ContextScope blockScope(this);

    for (auto& statement : statements) {
        Base::visit(statement);
        ++m_currentStatementIndex;
    }

    for (int i = m_indicesToDelete.size() - 1; i >= 0; --i)
        m_shaderModule.remove(statements, m_indicesToDelete[i]);
}

void PointerRewriter::visit(AST::CompoundStatement& statement)
{
    ContextScope blockScope(this);
    rewrite(statement.statements());
}

void PointerRewriter::visit(AST::VariableStatement& statement)
{
    Base::visit(statement);

    auto& variable = statement.variable();
    auto* initializer = variable.maybeInitializer();
    if (!initializer) {
        introduceVariable(variable.name(), nullptr);
        return;
    }

    auto* pointerType = std::get_if<Types::Pointer>(initializer->inferredType());
    if (!pointerType) {
        introduceVariable(variable.name(), nullptr);
        return;
    }

    introduceVariable(variable.name(), initializer);
    m_indicesToDelete.append(m_currentStatementIndex);
}

void PointerRewriter::visit(AST::PhonyAssignmentStatement& statement)
{
    auto* pointerType = std::get_if<Types::Pointer>(statement.rhs().inferredType());
    if (!pointerType) {
        AST::Visitor::visit(statement);
        return;
    }
    m_indicesToDelete.append(m_currentStatementIndex);
}

void PointerRewriter::visit(AST::LoopStatement& statement)
{
    ContextScope loopScope(this);
    rewrite(statement.body());

    if (auto& continuing = statement.continuing()) {
        ContextScope continuingScope(this);
        rewrite(continuing->body);
    }
}

void PointerRewriter::visit(AST::IdentifierExpression& identifier)
{
    auto* variable = readVariable(identifier.identifier());
    if (!variable || !*variable)
        return;

    auto& identity = m_shaderModule.astBuilder().construct<AST::IdentityExpression>(
        identifier.span(),
        **variable
    );
    m_shaderModule.replace(identifier, identity);
}

void PointerRewriter::visit(AST::UnaryExpression& unary)
{
    Base::visit(unary);

    if (unary.operation() != AST::UnaryOperation::Dereference)
        return;

    AST::Expression* nested = &unary.expression();
    while (is<AST::IdentityExpression>(*nested))
        nested = &downcast<AST::IdentityExpression>(*nested).expression();

    auto* nestedUnary = dynamicDowncast<AST::UnaryExpression>(*nested);
    if (!nestedUnary || nestedUnary->operation() != AST::UnaryOperation::AddressOf)
        return;

    auto& identity = m_shaderModule.astBuilder().construct<AST::IdentityExpression>(
        unary.span(),
        nestedUnary->expression()
    );
    identity.m_inferredType = unary.m_inferredType;
    m_shaderModule.replace(unary, identity);
}

void rewritePointers(ShaderModule& shaderModule)
{
    PointerRewriter(shaderModule).run();
}

} // namespace WGSL
