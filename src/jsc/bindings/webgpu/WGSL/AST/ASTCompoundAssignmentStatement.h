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

#include "ASTBinaryExpression.h"
#include "ASTStatement.h"

namespace WGSL::AST {

class CompoundAssignmentStatement : public Statement {
    WGSL_AST_BUILDER_NODE(CompoundAssignmentStatement);
public:
    NodeKind kind() const override;
    Expression& leftExpression() { return m_leftExpression; }
    Expression& rightExpression() { return m_rightExpression; }
    BinaryOperation operation() const { return m_operation; }

private:
    CompoundAssignmentStatement(SourceSpan span, Expression::Ref&& lhs, Expression::Ref&& rhs, BinaryOperation operation)
        : Statement(span)
        , m_leftExpression(WTF::move(lhs))
        , m_rightExpression(WTF::move(rhs))
        , m_operation(operation)
    { }

    Expression::Ref m_leftExpression;
    Expression::Ref m_rightExpression;
    BinaryOperation m_operation;
};

} // namespace WGSL::AST

SPECIALIZE_TYPE_TRAITS_WGSL_AST(CompoundAssignmentStatement)
