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
#include "ASTDeclaration.h"
#include "ASTIdentifier.h"
#include "ASTStructureMember.h"

namespace WGSL {

class AttributeValidator;
class RewriteGlobalVariables;
class TypeChecker;

namespace AST {

enum class StructureRole : uint8_t {
    UserDefined,
    VertexInput,
    FragmentInput,
    ComputeInput,
    VertexOutput,
    VertexOutputWrapper,
    BindGroup,
    UserDefinedResource,
    PackedResource,
    FragmentOutput,
    FragmentOutputWrapper,
};

class Structure final : public Declaration {
    WGSL_AST_BUILDER_NODE(Structure);
    friend AttributeValidator;
    friend RewriteGlobalVariables;
    friend TypeChecker;

public:
    using Ref = std::reference_wrapper<Structure>;
    using List = ReferenceWrapperVector<Structure>;

    NodeKind kind() const override;
    StructureRole role() const { return m_role; }
    StructureRole& role() LIFETIME_BOUND { return m_role; }
    Identifier& name() override { return m_name; }
    StructureMember::List& members() LIFETIME_BOUND { return m_members; }
    Structure* original() const { return m_original; }
    Structure* packed() const { return m_packed; }
    const Type* inferredType() const { return m_inferredType; }

    void setRole(StructureRole role) { m_role = role; }

    bool hasSizeOrAlignmentAttributes() const { return m_hasSizeOrAlignmentAttributes; }
    unsigned size() const { return *m_size; }
    unsigned alignment() const { return *m_alignment; }

private:
    Structure(SourceSpan span, Identifier&& name, StructureMember::List&& members, StructureRole role, Structure* original = nullptr)
        : Declaration(span)
        , m_name(WTF::move(name))
        , m_members(WTF::move(members))
        , m_role(role)
        , m_original(original)
    {
        if (m_original) {
            ASSERT(m_role == StructureRole::PackedResource);
            m_original->m_packed = this;
            m_size = original->m_size;
            m_alignment = original->m_alignment;
        }
    }

    Identifier m_name;
    StructureMember::List m_members;
    StructureRole m_role;
    Structure* m_original;
    Structure* m_packed { nullptr };
    const Type* m_inferredType { nullptr };

    // Computed properties
    bool m_hasSizeOrAlignmentAttributes { false };
    std::optional<unsigned> m_size;
    std::optional<unsigned> m_alignment;
};

} // namespace AST
} // namespace WGSL

SPECIALIZE_TYPE_TRAITS_WGSL_AST(Structure)
