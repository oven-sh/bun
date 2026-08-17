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

#include "ASTStatement.h"

namespace WGSL::AST {

struct SwitchClause {
    Expression::List selectors;
    CompoundStatement::Ref body;
};

class SwitchStatement final : public Statement {
    WGSL_AST_BUILDER_NODE(SwitchStatement);
public:
    NodeKind kind() const final;
    Attribute::List& attributes() { return m_attributes; }
    Expression& value() { return m_value.get(); }
    Attribute::List& bodyAttributes() LIFETIME_BOUND { return m_bodyAttributes; }
    Vector<SwitchClause>& clauses() LIFETIME_BOUND { return m_clauses; }
    SwitchClause& defaultClause() LIFETIME_BOUND { return m_defaultClause; }

    bool isInsideLoop() const { return m_isInsideLoop; }
    void setIsInsideLoop() { m_isInsideLoop = true;; }

    bool isNestedInsideLoop() const { return m_isNestedInsideLoop; }
    void setIsNestedInsideLoop() { m_isNestedInsideLoop = true; }

    DiagnosticContainer& bodyDiagnostics() { return m_bodyDiagnostics; }

private:
    SwitchStatement(SourceSpan span, Attribute::List&& attributes, Expression::Ref&& value, Attribute::List&& bodyAttributes, Vector<SwitchClause>&& clauses, SwitchClause&& defaultClause)
        : Statement(span)
        , m_attributes(WTF::move(attributes))
        , m_value(WTF::move(value))
        , m_bodyAttributes(WTF::move(bodyAttributes))
        , m_clauses(WTF::move(clauses))
        , m_defaultClause(WTF::move(defaultClause))
    { }

    bool m_isInsideLoop { false };
    bool m_isNestedInsideLoop { false };

    Attribute::List m_attributes;
    Expression::Ref m_value;
    Attribute::List m_bodyAttributes;
    Vector<SwitchClause> m_clauses;
    SwitchClause m_defaultClause;
    DiagnosticContainer m_bodyDiagnostics;
};

} // namespace WGSL::AST

SPECIALIZE_TYPE_TRAITS_WGSL_AST(SwitchStatement)
