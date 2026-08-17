/*
 * Copyright (C) 2023 Apple Inc. All rights reserved.
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

#include "ASTCompoundStatement.h"
#include "ASTExpression.h"

namespace WGSL::AST {

class ForStatement final : public Statement {
    WGSL_AST_BUILDER_NODE(ForStatement);
public:
    NodeKind kind() const override;
    Statement* maybeInitializer() { return m_initializer; }
    Expression* maybeTest() { return m_test; }
    Statement* maybeUpdate() { return m_update; }
    Attribute::List& attributes() { return m_attributes; }
    CompoundStatement& body() { return m_body; }
    bool isInternallyGenerated() const { return m_isInternallyGenerated; }
    void setInternallyGenerated() { m_isInternallyGenerated = true; }

private:
    ForStatement(SourceSpan span, Attribute::List&& attributes, Statement::Ptr initializer, Expression::Ptr test, Statement::Ptr update, CompoundStatement::Ref&& body)
        : Statement(span)
        , m_attributes(WTF::move(attributes))
        , m_initializer(initializer)
        , m_test(test)
        , m_update(update)
        , m_body(WTF::move(body))
    { }

    Attribute::List m_attributes;
    Statement::Ptr m_initializer;
    Expression::Ptr m_test;
    Statement::Ptr m_update;
    CompoundStatement::Ref m_body;
    bool m_isInternallyGenerated { false };
};

} // namespace WGSL::AST

SPECIALIZE_TYPE_TRAITS_WGSL_AST(ForStatement)
