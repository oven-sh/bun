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
#include "ASTBuilder.h"
#include "ASTExpression.h"
#include "ASTIdentifier.h"
#include "ASTInterpolateAttribute.h"
#include <wtf/ReferenceWrapperVector.h>

namespace WGSL {

class AttributeValidator;
class EntryPointRewriter;

namespace AST {

enum class ParameterRole : uint8_t {
    UserDefined,
    StageIn,
    BindGroup,
    PackedResource,
};

class Parameter final : public Node {
    WGSL_AST_BUILDER_NODE(Parameter);
    friend AttributeValidator;
    friend EntryPointRewriter;

public:
    using List = ReferenceWrapperVector<Parameter>;

    NodeKind kind() const override;
    ParameterRole role() const { return m_role; }

    Identifier& name() { return m_name; }
    Expression& typeName() { return m_typeName.get(); }
    Attribute::List& attributes() LIFETIME_BOUND { return m_attributes; }

    const Identifier& name() const { return m_name; }
    const Expression& typeName() const { return m_typeName.get(); }
    const Attribute::List& attributes() const LIFETIME_BOUND { return m_attributes; }

    bool invariant() const { return m_invariant; }
    std::optional<Builtin> builtin() const { return m_builtin; }
    std::optional<Interpolation> interpolation() const { return m_interpolation; }
    std::optional<unsigned> location() const { return m_location; }

private:
    Parameter(SourceSpan span, Identifier&& name, Expression::Ref&& typeName, Attribute::List&& attributes, ParameterRole role)
        : Node(span)
        , m_role(role)
        , m_name(WTF::move(name))
        , m_typeName(WTF::move(typeName))
        , m_attributes(WTF::move(attributes))
    { }

    ParameterRole m_role;
    Identifier m_name;
    Expression::Ref m_typeName;
    Attribute::List m_attributes;

    // Attributes
    bool m_invariant { false };
    std::optional<Builtin> m_builtin;
    std::optional<Interpolation> m_interpolation;
    std::optional<unsigned> m_location;
};

} // namespace AST
} // namespace WGSL

SPECIALIZE_TYPE_TRAITS_WGSL_AST(Parameter)
