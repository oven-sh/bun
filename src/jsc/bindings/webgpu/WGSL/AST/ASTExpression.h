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

#include "ASTBuilder.h"
#include "ASTNode.h"
#include "ConstantValue.h"
#include <wtf/ReferenceWrapperVector.h>

namespace WGSL {
class BoundsCheckVisitor;
class ConstantRewriter;
class EntryPointRewriter;
class PointerRewriter;
class RewriteGlobalVariables;
class TypeChecker;
struct Type;

enum class Evaluation : uint8_t {
    Constant = 1,
    Override = 2,
    Runtime = 3,
};

namespace AST {

class Expression : public Node {
    WGSL_AST_BUILDER_NODE(Expression);
    friend BoundsCheckVisitor;
    friend ConstantRewriter;
    friend EntryPointRewriter;
    friend PointerRewriter;
    friend RewriteGlobalVariables;
    friend TypeChecker;

public:
    using Ref = std::reference_wrapper<Expression>;
    using Ptr = Expression*;
    using List = ReferenceWrapperVector<Expression>;

    virtual ~Expression() { }

    const Type* inferredType() const { return m_inferredType; }

    const std::optional<ConstantValue>& constantValue() const LIFETIME_BOUND { return m_constantValue; }
    void setConstantValue(ConstantValue value) { m_constantValue = value; }

    const std::optional<Evaluation>& maybeEvaluation() const LIFETIME_BOUND { return m_evaluation; }
    Evaluation evaluation() const { return *m_evaluation; }

protected:
    Expression(SourceSpan span)
        : Node(span)
    { }

    const Type* m_inferredType { nullptr };

private:
    std::optional<Evaluation> m_evaluation { std::nullopt };
    std::optional<ConstantValue> m_constantValue { std::nullopt };
};

} // namespace AST
} // namespace WGSL

SPECIALIZE_TYPE_TRAITS_BEGIN(WGSL::AST::Expression)
static bool isType(const WGSL::AST::Node& node)
{
    switch (node.kind()) {
        // Expressions
    case WGSL::AST::NodeKind::BinaryExpression:
    case WGSL::AST::NodeKind::IndexAccessExpression:
    case WGSL::AST::NodeKind::CallExpression:
    case WGSL::AST::NodeKind::IdentifierExpression:
    case WGSL::AST::NodeKind::FieldAccessExpression:
    case WGSL::AST::NodeKind::UnaryExpression:
        // Literals
    case WGSL::AST::NodeKind::AbstractFloatLiteral:
    case WGSL::AST::NodeKind::AbstractIntegerLiteral:
    case WGSL::AST::NodeKind::BoolLiteral:
    case WGSL::AST::NodeKind::Float32Literal:
    case WGSL::AST::NodeKind::Float16Literal:
    case WGSL::AST::NodeKind::Signed32Literal:
    case WGSL::AST::NodeKind::Unsigned32Literal:
        return true;
    default:
        return false;
    }
}
SPECIALIZE_TYPE_TRAITS_END()
