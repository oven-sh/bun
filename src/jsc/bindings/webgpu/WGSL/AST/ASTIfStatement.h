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

#include "ASTAttribute.h"
#include "ASTCompoundStatement.h"
#include "ASTExpression.h"

namespace WGSL::AST {

class IfStatement final : public Statement {
    WGSL_AST_BUILDER_NODE(IfStatement);
public:
    NodeKind kind() const override;
    Expression& test() { return m_test.get(); }
    CompoundStatement& trueBody() { return m_trueBody.get(); }
    Statement* maybeFalseBody() { return m_falseBody; }
    Attribute::List& attributes() LIFETIME_BOUND { return m_attributes; }

private:
    IfStatement(SourceSpan span, Expression::Ref&& test, CompoundStatement::Ref&& trueBody, Statement::Ptr falseBody, Attribute::List&& attributes)
        : Statement(span)
        , m_test(WTF::move(test))
        , m_trueBody(WTF::move(trueBody))
        , m_falseBody(falseBody)
        , m_attributes(WTF::move(attributes))
    { }

    Expression::Ref m_test;
    CompoundStatement::Ref m_trueBody;
    Statement::Ptr m_falseBody;
    Attribute::List m_attributes;
};

} // namespace WGSL::AST

SPECIALIZE_TYPE_TRAITS_WGSL_AST(IfStatement)
