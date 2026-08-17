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
#include "Overload.h"
#include "Types.h"
#include <wtf/OptionSet.h>

namespace WGSL {
class BoundsCheckVisitor;
class RewriteGlobalVariables;
class TypeChecker;

namespace AST {

// A CallExpression expresses a "function" call, which consists of a target to be called,
// and a list of arguments. The target does not necesserily have to be a function identifier,
// but can also be a type, in which the whole call is a type conversion expression. The exact
// kind of expression can only be resolved during semantic analysis.
class CallExpression final : public Expression {
    WGSL_AST_BUILDER_NODE(CallExpression);

    friend BoundsCheckVisitor;
    friend RewriteGlobalVariables;
    friend TypeChecker;

public:
    using Ref = std::reference_wrapper<CallExpression>;

    NodeKind kind() const override;

    Expression& target() { return m_target.get(); }
    const Expression& target() const { return m_target.get(); }

    Expression::List& arguments() LIFETIME_BOUND { return m_arguments; }
    const Expression::List& arguments() const LIFETIME_BOUND { return m_arguments; }

    bool isConstructor() const { return m_isConstructor; }

    bool isFloatToIntConversion(const Type* result = nullptr) const
    {
        const auto& getPrimitiveType = [&](const Type* type) -> const Types::Primitive* {
            if (auto* reference = std::get_if<Types::Reference>(type))
                type = reference->element;
            if (auto* vector = std::get_if<Types::Vector>(type))
                type = vector->element;
            return std::get_if<Types::Primitive>(type);
        };

        if (!m_isConstructor)
            return false;

        auto* resultPrimitive = getPrimitiveType(result ?: m_inferredType);
        if (!resultPrimitive)
            return false;
        if (resultPrimitive->kind != Types::Primitive::I32 && resultPrimitive->kind != Types::Primitive::U32)
            return false;

        if (m_arguments.size() != 1)
            return false;

        auto& argument = m_arguments[0];
        auto* argumentPrimitive = getPrimitiveType(argument.inferredType());
        if (!argumentPrimitive)
            return false;
        if (argumentPrimitive->kind != Types::Primitive::F32 && argumentPrimitive->kind != Types::Primitive::F16 && argumentPrimitive->kind != Types::Primitive::AbstractFloat)
            return false;

        return true;
    }

    const OptionSet<ShaderStage>& visibility() const LIFETIME_BOUND { return m_visibility; }

    const String& resolvedTarget() const LIFETIME_BOUND { return m_resolvedTarget; }

    ValidationFunction validationFunction() const { return m_validationFunction; }

private:
    CallExpression(SourceSpan span, Expression::Ref&& target, Expression::List&& arguments)
        : Expression(span)
        , m_target(WTF::move(target))
        , m_arguments(WTF::move(arguments))
    { }

    // If m_target is a NamedType, it could either be a:
    //   * Type that does not accept parameters (bool, i32, u32, ...)
    //   * Identifier that refers to a type alias.
    //   * Identifier that refers to a function.
    Expression::Ref m_target;
    Expression::List m_arguments;
    String m_resolvedTarget;

    bool m_isConstructor { false };
    OptionSet<ShaderStage> m_visibility { ShaderStage::Compute, ShaderStage::Vertex, ShaderStage::Fragment };
    ValidationFunction m_validationFunction { nullptr };
};

} // namespace AST
} // namespace WGSL

SPECIALIZE_TYPE_TRAITS_WGSL_AST(CallExpression)
