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

#include "ASTExpression.h"
#include <array>
#include <wtf/EnumTraits.h>
#include <wtf/Forward.h>
#include <wtf/text/ASCIILiteral.h>

namespace WGSL::AST {

#define WGSL_AST_BINOP_IMPL \
    WGSL_AST_BINOP(Add, "+") \
    WGSL_AST_BINOP(Subtract, "-") \
    WGSL_AST_BINOP(Multiply, "*") \
    WGSL_AST_BINOP(Divide, "/") \
    WGSL_AST_BINOP(Modulo, "%") \
    WGSL_AST_BINOP(And, "&") \
    WGSL_AST_BINOP(Or, "|") \
    WGSL_AST_BINOP(Xor, "^") \
    WGSL_AST_BINOP(LeftShift, "<<") \
    WGSL_AST_BINOP(RightShift, ">>") \
    WGSL_AST_BINOP(Equal, "==") \
    WGSL_AST_BINOP(NotEqual, "!=") \
    WGSL_AST_BINOP(GreaterThan, ">") \
    WGSL_AST_BINOP(GreaterEqual, ">=") \
    WGSL_AST_BINOP(LessThan, "<") \
    WGSL_AST_BINOP(LessEqual, "<=") \
    WGSL_AST_BINOP(ShortCircuitAnd, "&&") \
    WGSL_AST_BINOP(ShortCircuitOr, "||")

enum class BinaryOperation : uint8_t {
#define WGSL_AST_BINOP(x, y) x,
    WGSL_AST_BINOP_IMPL
#undef WGSL_AST_BINOP
};

constexpr ASCIILiteral toASCIILiteral(BinaryOperation op)
{
    constexpr auto binaryOperationNames = WTF::toArray<ASCIILiteral>({
#define WGSL_AST_BINOP(x, y) y##_s,
        WGSL_AST_BINOP_IMPL
#undef WGSL_AST_BINOP
    });

    return binaryOperationNames[std::to_underlying(op)];
}

void printInternal(PrintStream&, BinaryOperation);

class BinaryExpression : public Expression {
    WGSL_AST_BUILDER_NODE(BinaryExpression);
public:
    NodeKind kind() const override;
    BinaryOperation operation() const { return m_operation; }
    Expression& leftExpression() { return m_lhs.get(); }
    const Expression& leftExpression() const { return m_lhs.get(); }
    Expression& rightExpression() { return m_rhs.get(); }
    const Expression& rightExpression() const { return m_rhs.get(); }

private:
    BinaryExpression(SourceSpan span, Expression::Ref&& lhs, Expression::Ref&& rhs, BinaryOperation operation)
        : Expression(span)
        , m_lhs(WTF::move(lhs))
        , m_rhs(WTF::move(rhs))
        , m_operation(operation)
    { }

    Expression::Ref m_lhs;
    Expression::Ref m_rhs;
    BinaryOperation m_operation;
};

} // namespace WGSL::AST

SPECIALIZE_TYPE_TRAITS_WGSL_AST(BinaryExpression)
