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
#include "VisibilityValidator.h"

#include "AST.h"
#include "ASTVisitor.h"
#include "WGSLEnums.h"
#include "WGSLShaderModule.h"
#include <wtf/text/MakeString.h>

namespace WGSL {

class VisibilityValidator : public AST::Visitor {
public:
    VisibilityValidator(ShaderModule&);

    std::optional<FailedCheck> validate();

    void visit(AST::Function&) override;
    void visit(AST::CallExpression&) override;

private:
    template<typename... Arguments>
    void error(const SourceSpan&, Arguments&&...);

    ShaderModule& m_shaderModule;
    ShaderStage m_stage { ShaderStage::Vertex };
};

VisibilityValidator::VisibilityValidator(ShaderModule& shaderModule)
    : m_shaderModule(shaderModule)
{
}

std::optional<FailedCheck> VisibilityValidator::validate()
{
    for (auto& entryPoint : m_shaderModule.callGraph().entrypoints()) {
        m_stage = entryPoint.stage;
        visit(entryPoint.function);

    }

    if (!hasError())
        return std::nullopt;
    return FailedCheck { Vector<Error> { result().error() }, { } };
}

void VisibilityValidator::visit(AST::Function& function)
{
    AST::Visitor::visit(function);

    for (auto& callee : m_shaderModule.callGraph().callees(function))
        checkErrorAndVisit(*callee.target);
}

void VisibilityValidator::visit(AST::CallExpression& call)
{
    AST::Visitor::visit(call);
    if (!call.visibility().contains(m_stage))
        error(call.span(), "built-in cannot be used by "_s, toString(m_stage), " pipeline stage"_s);
}

template<typename... Arguments>
void VisibilityValidator::error(const SourceSpan& span, Arguments&&... arguments)
{
    setError({ makeString(std::forward<Arguments>(arguments)...), span });
}

std::optional<FailedCheck> validateVisibility(ShaderModule& shaderModule)
{
    return VisibilityValidator(shaderModule).validate();
}

} // namespace WGSL
