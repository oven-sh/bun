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
#include "ASTAttribute.h"
#include "ASTDeclaration.h"
#include "ASTExpression.h"
#include "ASTIdentifier.h"
#include "ASTVariableQualifier.h"

namespace WGSL {
class AttributeValidator;
class RewriteGlobalVariables;
class TypeChecker;
struct Type;

namespace AST {

enum class VariableFlavor : uint8_t {
    Const,
    Let,
    Override,
    Var,
};

enum class VariableRole : uint8_t {
    UserDefined,
    PackedResource,
};

class Variable final : public Declaration {
    WGSL_AST_BUILDER_NODE(Variable);
    friend AttributeValidator;
    friend RewriteGlobalVariables;
    friend TypeChecker;

public:
    using Ref = std::reference_wrapper<Variable>;
    using List = ReferenceWrapperVector<Variable>;

    NodeKind kind() const override;
    VariableFlavor flavor() const { return m_flavor; };
    VariableFlavor& flavor() { return m_flavor; };

    VariableRole role() const { return m_role; }
    VariableRole& role() LIFETIME_BOUND { return m_role; }

    Identifier& name() override { return m_name; }
    Identifier& originalName() { return m_originalName; }
    Attribute::List& attributes() LIFETIME_BOUND { return m_attributes; }
    VariableQualifier* maybeQualifier() { return m_qualifier; }
    Expression* maybeTypeName() { return m_type; }
    Expression* maybeInitializer() { return m_initializer; }
    Expression* maybeReferenceType() { return m_referenceType; }
    const Type* storeType() const
    {
        return m_storeType;
    }

    std::optional<AddressSpace> addressSpace() const { return m_addressSpace; }
    std::optional<AccessMode> accessMode() const { return m_accessMode; }
    std::optional<unsigned> binding() const { return m_binding; }
    std::optional<unsigned> group() const { return m_group; }
    std::optional<unsigned> id() const { return m_id; }

private:
    Variable(SourceSpan span, VariableFlavor flavor, Identifier&& name, Expression::Ptr type, Expression::Ptr initializer)
        : Variable(span, flavor, WTF::move(name), { }, type, initializer, { })
    { }

    Variable(SourceSpan span, VariableFlavor flavor, Identifier&& name, VariableQualifier::Ptr qualifier, Expression::Ptr type, Expression::Ptr initializer, Attribute::List&& attributes, VariableRole role = VariableRole::UserDefined)
        : Declaration(span)
        , m_name(WTF::move(name))
        , m_originalName(m_name)
        , m_attributes(WTF::move(attributes))
        , m_qualifier(qualifier)
        , m_type(type)
        , m_initializer(initializer)
        , m_flavor(flavor)
        , m_role(role)
    {
        ASSERT(m_type || m_initializer);
        if (m_type)
            m_storeType = m_type->inferredType();
        else
            m_storeType = m_initializer->inferredType();
    }

    Identifier m_name;
    Identifier m_originalName;
    Attribute::List m_attributes;
    // Each of the following may be null
    // But at least one of type and initializer must be non-null
    VariableQualifier::Ptr m_qualifier;
    Expression::Ptr m_type;
    Expression::Ptr m_initializer;
    VariableFlavor m_flavor;
    VariableRole m_role;
    Expression::Ptr m_referenceType { nullptr };

    // Computed properties
    const Type* m_storeType { nullptr };
    std::optional<AddressSpace> m_addressSpace;
    std::optional<AccessMode> m_accessMode;

    // Attributes
    std::optional<unsigned> m_binding;
    std::optional<unsigned> m_group;
    std::optional<unsigned> m_id;
};

} // namespace AST
} // namespace WGSL

SPECIALIZE_TYPE_TRAITS_WGSL_AST(Variable)
