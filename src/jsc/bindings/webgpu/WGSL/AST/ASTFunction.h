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

#include "ASTAttribute.h"
#include "ASTCompoundStatement.h"
#include "ASTDeclaration.h"
#include "ASTDiagnostic.h"
#include "ASTParameter.h"
#include "ASTWorkgroupSizeAttribute.h"

#include <wtf/UniqueRefVector.h>

namespace WGSL {

class AttributeValidator;

namespace AST {

class Function final : public Declaration, public DiagnosticContainer {
    WGSL_AST_BUILDER_NODE(Function);
    friend AttributeValidator;

public:
    NodeKind kind() const override;
    Identifier& name() override { return m_name; }
    Parameter::List& parameters() LIFETIME_BOUND { return m_parameters; }
    Attribute::List& attributes() LIFETIME_BOUND { return m_attributes; }
    Attribute::List& returnAttributes() LIFETIME_BOUND { return m_returnAttributes; }
    Expression* maybeReturnType() { return m_returnType; }
    CompoundStatement& body() { return m_body.get(); }
    const Identifier& name() const { return m_name; }
    const Parameter::List& parameters() const LIFETIME_BOUND { return m_parameters; }
    const Attribute::List& attributes() const LIFETIME_BOUND { return m_attributes; }
    const Attribute::List& returnAttributes() const LIFETIME_BOUND { return m_returnAttributes; }
    const Expression* maybeReturnType() const { return m_returnType; }
    const CompoundStatement& body() const { return m_body.get(); }

    bool mustUse() const { return m_mustUse; }
    std::optional<ShaderStage> stage() const { return m_stage; }
    const std::optional<WorkgroupSize>& workgroupSize() const LIFETIME_BOUND { return m_workgroupSize; }

    bool returnTypeInvariant() const { return m_returnTypeInvariant; }
    std::optional<Builtin> returnTypeBuiltin() const { return m_returnTypeBuiltin; }
    std::optional<Interpolation> returnTypeInterpolation() const { return m_returnTypeInterpolation; }
    std::optional<unsigned> returnTypeLocation() const { return m_returnTypeLocation; }

    const String& originalName() const { return m_originalName; }

private:
    Function(SourceSpan span, Identifier&& name, Parameter::List&& parameters, Expression::Ptr returnType, CompoundStatement::Ref&& body, Attribute::List&& attributes, Attribute::List&& returnAttributes)
        : Declaration(span)
        , m_name(WTF::move(name))
        , m_originalName(m_name.id())
        , m_parameters(WTF::move(parameters))
        , m_attributes(WTF::move(attributes))
        , m_returnAttributes(WTF::move(returnAttributes))
        , m_returnType(returnType)
        , m_body(WTF::move(body))
    { }

    Identifier m_name;
    String m_originalName;
    Parameter::List m_parameters;
    Attribute::List m_attributes;
    Attribute::List m_returnAttributes;
    Expression::Ptr m_returnType;
    CompoundStatement::Ref m_body;

    // Attributes
    bool m_mustUse { false };
    std::optional<ShaderStage> m_stage;
    std::optional<WorkgroupSize> m_workgroupSize;

    bool m_returnTypeInvariant { false };
    std::optional<Builtin> m_returnTypeBuiltin;
    std::optional<Interpolation> m_returnTypeInterpolation;
    std::optional<unsigned> m_returnTypeLocation;
};

} // namespace AST
} // namespace WGSL

SPECIALIZE_TYPE_TRAITS_WGSL_AST(Function)
