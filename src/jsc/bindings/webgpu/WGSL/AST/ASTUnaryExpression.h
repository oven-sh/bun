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

#include "ASTExpression.h"
#include <array>
#include <wtf/EnumTraits.h>
#include <wtf/Forward.h>
#include <wtf/text/ASCIILiteral.h>

#define WGSL_AST_UNARYOP_IMPL \
    WGSL_AST_UNARYOP(AddressOf, "&") \
    WGSL_AST_UNARYOP(Complement, "~") \
    WGSL_AST_UNARYOP(Dereference, "*") \
    WGSL_AST_UNARYOP(Negate, "-") \
    WGSL_AST_UNARYOP(Not, "!")

namespace WGSL::AST {

enum class UnaryOperation : uint8_t {
#define WGSL_AST_UNARYOP(x, y) x,
WGSL_AST_UNARYOP_IMPL
#undef WGSL_AST_UNARYOP
};

constexpr ASCIILiteral toASCIILiteral(UnaryOperation op)
{
    constexpr auto unaryOperationNames = WTF::toArray<ASCIILiteral>({
#define WGSL_AST_UNARYOP(x, y) y##_s,
WGSL_AST_UNARYOP_IMPL
#undef WGSL_AST_UNARYOP
    });

    return unaryOperationNames[std::to_underlying(op)];
}

void printInternal(PrintStream&, UnaryOperation);

class UnaryExpression final : public Expression {
    WGSL_AST_BUILDER_NODE(UnaryExpression);
public:
    NodeKind kind() const final;
    UnaryOperation operation() const { return m_operation; }
    Expression& expression() { return m_expression.get(); }
    const Expression& expression() const { return m_expression.get(); }

private:
    UnaryExpression(SourceSpan span, Expression::Ref&& expression, UnaryOperation operation)
        : Expression(span)
        , m_expression(WTF::move(expression))
        , m_operation(operation)
    { }

    Expression::Ref m_expression;
    UnaryOperation m_operation;
};


} // namespace WGSL::AST

SPECIALIZE_TYPE_TRAITS_WGSL_AST(UnaryExpression)
