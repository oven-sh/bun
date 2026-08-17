/*
 * Copyright (c) 2024 Apple Inc. All rights reserved.
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
#include "BoundsCheck.h"

#include "AST.h"
#include "ASTVisitor.h"
#include "Types.h"
#include "WGSLShaderModule.h"
#include <wtf/text/MakeString.h>

namespace WGSL {

class BoundsCheckVisitor : AST::Visitor {
public:
    BoundsCheckVisitor(ShaderModule& shaderModule)
        : m_shaderModule(shaderModule)
    {
    }

    std::optional<FailedCheck> run()
    {
        AST::Visitor::visit(m_shaderModule);
        return std::nullopt;
    }

    void visit(AST::Variable&) override;
    void visit(AST::IndexAccessExpression&) override;

private:
    ShaderModule& m_shaderModule;
    HashSet<AST::IndexAccessExpression*> m_visited;
};


void BoundsCheckVisitor::visit(AST::Variable& variable)
{
    if (variable.flavor() == AST::VariableFlavor::Override)
        return;
    AST::Visitor::visit(variable);
}

void BoundsCheckVisitor::visit(AST::IndexAccessExpression& access)
{
    if (access.constantValue())
        return;

    if (m_visited.contains(&access))
        return;
    m_visited.add(&access);

    AST::Visitor::visit(access);

    const auto& constant = [&shaderModule = m_shaderModule](unsigned size) -> AST::Expression& {
        auto& sizeExpression =  shaderModule.astBuilder().construct<AST::Unsigned32Literal>(
            SourceSpan::empty(),
            size
        );
        sizeExpression.m_inferredType = shaderModule.types().u32Type();
        sizeExpression.setConstantValue(size);
        return sizeExpression;
    };

    const auto replace = [&shaderModule = m_shaderModule](AST::IndexAccessExpression& access, AST::Expression& size) {
        auto* index = &access.index();
        if (index->inferredType() != shaderModule.types().u32Type()) {
            auto& u32Target = shaderModule.astBuilder().construct<AST::IdentifierExpression>(
                SourceSpan::empty(),
                AST::Identifier::make("u32"_s)
            );
            u32Target.m_inferredType = shaderModule.types().u32Type();

            auto& u32Call = shaderModule.astBuilder().construct<AST::CallExpression>(
                SourceSpan::empty(),
                u32Target,
                AST::Expression::List { *index }
            );
            u32Call.m_inferredType = shaderModule.types().u32Type();
            u32Call.m_isConstructor = true;
            index = &u32Call;
        }

        auto& minTarget = shaderModule.astBuilder().construct<AST::IdentifierExpression>(
            SourceSpan::empty(),
            AST::Identifier::make("__wgslMin"_s)
        );
        minTarget.m_inferredType = shaderModule.types().u32Type();

        auto& one =  shaderModule.astBuilder().construct<AST::Unsigned32Literal>(
            SourceSpan::empty(),
            1
        );
        one.m_inferredType = shaderModule.types().u32Type();
        one.setConstantValue(1u);

        auto& upperBound = shaderModule.astBuilder().construct<AST::BinaryExpression>(
            SourceSpan::empty(),
            size,
            one,
            AST::BinaryOperation::Subtract
        );
        upperBound.m_inferredType = shaderModule.types().u32Type();

        auto& minCall = shaderModule.astBuilder().construct<AST::CallExpression>(
            SourceSpan::empty(),
            minTarget,
            AST::Expression::List { *index, upperBound }
        );
        minCall.m_inferredType = upperBound.inferredType();

        auto& newAccess = shaderModule.astBuilder().construct<AST::IndexAccessExpression>(
            access.span(),
            access.base(),
            minCall
        );
        newAccess.m_inferredType = access.inferredType();

        shaderModule.replace(access, newAccess);
        shaderModule.setUsesMin();
    };

    auto* base = access.base().inferredType();
    if (auto* reference = std::get_if<Types::Reference>(base))
        base = reference->element;
    if (auto* pointer = std::get_if<Types::Pointer>(base))
        base = pointer->element;

    const auto& checkBounds = [&shaderModule = m_shaderModule, &access](AST::Expression& indexExpression, unsigned size) {
        shaderModule.addOverrideValidation([&shaderModule, &access, &indexExpression, size](auto& constantValues) -> std::optional<Error> {
            auto index = evaluate(shaderModule, indexExpression, constantValues);

            if (index && (index->integerValue() < 0 || index->integerValue() >= size)) [[unlikely]]
                return Error(makeString("index "_s, index->integerValue(), " out of bounds[0.."_s, size - 1, "]"_s), access.span());

            return std::nullopt;
        });
    };

    if (auto* vector = std::get_if<Types::Vector>(base)) {
        checkBounds(access.index(), vector->size);
        replace(access, constant(vector->size));
        return;
    }

    if (auto* matrix = std::get_if<Types::Matrix>(base)) {
        checkBounds(access.index(), matrix->columns);
        replace(access, constant(matrix->columns));
        return;
    }

    auto& array = std::get<Types::Array>(*base);
    auto& indexExpression = access.index();
    AST::Expression* sizeExpression = nullptr;
    std::optional<unsigned> sizeConstant;

    WTF::switchOn(array.size,
        [&](unsigned size) {
            sizeConstant = size;
        },
        [&](AST::Expression* size) {
            sizeExpression = size;
        },
        [&](std::monostate) {
            auto& target = m_shaderModule.astBuilder().construct<AST::IdentifierExpression>(
                SourceSpan::empty(),
                AST::Identifier::make("arrayLength"_s)
            );
            target.m_inferredType = m_shaderModule.types().u32Type();


            auto* argument = &access.base();
            if (auto* reference = std::get_if<Types::Reference>(access.base().inferredType())) {
                auto& addressOf = m_shaderModule.astBuilder().construct<AST::UnaryExpression>(
                    SourceSpan::empty(),
                    access.base(),
                    AST::UnaryOperation::AddressOf
                );
                addressOf.m_inferredType = m_shaderModule.types().pointerType(
                    reference->addressSpace,
                    reference->element,
                    reference->accessMode
                );
                argument = &addressOf;
            }

            RELEASE_ASSERT(std::holds_alternative<Types::Pointer>(*argument->inferredType()));
            auto& call = m_shaderModule.astBuilder().construct<AST::CallExpression>(
                SourceSpan::empty(),
                target,
                AST::Expression::List { *argument }
            );
            call.m_inferredType = m_shaderModule.types().u32Type();

            replace(access, call);
        });

        m_shaderModule.addOverrideValidation([&shaderModule = m_shaderModule, &access, &indexExpression, constant, replace, sizeConstant, sizeExpression](auto& constantValues) -> std::optional<Error> {
            auto index = evaluate(shaderModule, indexExpression, constantValues);
            std::optional<int64_t> size;
            if (sizeConstant)
                size = sizeConstant;
            else if (sizeExpression) {
                if (auto maybeSize = evaluate(shaderModule, *sizeExpression, constantValues))
                    size = maybeSize->integerValue();
            }

            if (size && *size < 1) [[unlikely]]
                return Error("array count must be greater than 0"_s, access.span());

            if (index && (index->integerValue() < 0 || (size && index->integerValue() >= *size))) [[unlikely]] {
                String bounds = size ?  makeString(" [0.."_s, *size - 1, "]"_s) : ""_s;
                return Error(makeString("index "_s, index->integerValue(), " out of bounds"_s, bounds), access.span());
            }

            if ((sizeExpression || sizeConstant) && (!index || !size)) {
                auto* expression = sizeExpression ?: &constant(*sizeConstant);

                AST::Expression* updatedAccess = &access;
                if (updatedAccess->kind() == AST::NodeKind::IndexAccessExpression) {
                    replace(access, *expression);
                    return std::nullopt;
                }

                // This is a bit of hack, since global rewriting will run between we
                // bounds check and override validation, this access might have been
                // converted into a __pack call.
                while (auto* identity = dynamicDowncast<AST::IdentityExpression>(*updatedAccess))
                    updatedAccess = &identity->expression();
                RELEASE_ASSERT(updatedAccess->kind() == AST::NodeKind::CallExpression);
                auto& call = uncheckedDowncast<AST::CallExpression>(*updatedAccess);
                RELEASE_ASSERT(call.arguments().size() == 1);
                RELEASE_ASSERT(call.arguments()[0].kind() == AST::NodeKind::IndexAccessExpression);
                auto& newAccess = uncheckedDowncast<AST::IndexAccessExpression>(call.arguments()[0]);
                replace(newAccess, *expression);
            }

            return std::nullopt;
        });
}

std::optional<FailedCheck> insertBoundsChecks(ShaderModule& shaderModule)
{
    return BoundsCheckVisitor(shaderModule).run();
}

} // namespace WGSL
