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
#include "ASTIdentifier.h"

namespace WGSL::AST {

class FieldAccessExpression final : public Expression {
    WGSL_AST_BUILDER_NODE(FieldAccessExpression);
public:
    NodeKind kind() const override;

    Expression& base() { return m_base.get(); }
    const Expression& base() const { return m_base.get(); }

    Identifier& fieldName() { return m_fieldName; }
    const Identifier& fieldName() const { return m_fieldName; }

    const Identifier& originalFieldName() const { return m_originalFieldName; }

private:
    FieldAccessExpression(SourceSpan span, Expression::Ref&& base, Identifier&& fieldName)
        : Expression(span)
        , m_base(WTF::move(base))
        , m_fieldName(WTF::move(fieldName))
        , m_originalFieldName(m_fieldName)
    { }

    Expression::Ref m_base;
    Identifier m_fieldName;
    Identifier m_originalFieldName;
};

} // namespace WGSL::AST

SPECIALIZE_TYPE_TRAITS_WGSL_AST(FieldAccessExpression)
