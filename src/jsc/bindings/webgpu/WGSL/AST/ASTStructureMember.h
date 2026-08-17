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

namespace AST {

class StructureMember final : public Node {
    WGSL_AST_BUILDER_NODE(StructureMember);
    friend AttributeValidator;

public:
    using List = ReferenceWrapperVector<StructureMember>;

    NodeKind kind() const final;
    Identifier& name() { return m_name; }
    Identifier& originalName() { return m_originalName; }
    Expression& type() { return m_type; }
    Attribute::List& attributes() LIFETIME_BOUND { return m_attributes; }

    bool invariant() const { return m_invariant; }
    std::optional<Builtin> builtin() const { return m_builtin; }
    std::optional<unsigned> location() const { return m_location; }
    std::optional<Interpolation> interpolation() const { return m_interpolation; }

    unsigned offset() const { return m_offset; }
    unsigned padding() const { return m_padding; }

    unsigned alignment() const { return *m_alignment; }
    unsigned size() const { return *m_size; }

private:
    StructureMember(SourceSpan span, Identifier&& name, Expression::Ref&& type, Attribute::List&& attributes)
        : Node(span)
        , m_name(WTF::move(name))
        , m_originalName(m_name)
        , m_attributes(WTF::move(attributes))
        , m_type(WTF::move(type))
    { }

    Identifier m_name;
    Identifier m_originalName;
    Attribute::List m_attributes;
    Expression::Ref m_type;

    // Compute
    unsigned m_offset { 0 };
    unsigned m_padding { 0 };

    // Attributes
    bool m_invariant { false };
    std::optional<unsigned> m_alignment;
    std::optional<unsigned> m_size;
    std::optional<Builtin> m_builtin;
    std::optional<unsigned> m_location;
    std::optional<Interpolation> m_interpolation;
};

} // namespace AST
} // namespace WGSL

SPECIALIZE_TYPE_TRAITS_WGSL_AST(StructureMember)
