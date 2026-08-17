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

#include "ASTExpression.h"

namespace WGSL::AST {

class Continuing : public AST::DiagnosticContainer {
public:
    Continuing(Statement::List&& body, Attribute::List&& attributes, Expression::Ptr breakIf)
        : body(WTF::move(body))
        , attributes(WTF::move(attributes))
        , breakIf(breakIf)
    {
    }

    Statement::List body;
    Attribute::List attributes;
    Expression::Ptr breakIf;
};

class LoopStatement final : public Statement {
    WGSL_AST_BUILDER_NODE(LoopStatement);
public:
    NodeKind kind() const override;
    Attribute::List& attributes() LIFETIME_BOUND { return m_attributes; }
    Attribute::List& bodyAttributes() LIFETIME_BOUND { return m_bodyAttributes; }
    Statement::List& body() LIFETIME_BOUND { return m_body; }
    std::optional<Continuing>& continuing() LIFETIME_BOUND { return m_continuing; }

    void setContainsSwitch() { m_containsSwitch = true; }
    bool containsSwitch() const { return m_containsSwitch; }

    Behaviors bodyBehaviors() const { return m_bodyBehaviors; }
    void setBodyBehaviors(Behaviors behaviors) { m_bodyBehaviors = behaviors; }

    DiagnosticContainer& bodyDiagnostics() { return m_bodyDiagnostics; }

private:
    LoopStatement(SourceSpan span, Attribute::List&& attributes, Attribute::List&& bodyAttributes, Statement::List&& body, std::optional<Continuing>&& continuing)
        : Statement(span)
        , m_attributes(WTF::move(attributes))
        , m_bodyAttributes(WTF::move(bodyAttributes))
        , m_body(WTF::move(body))
        , m_continuing(WTF::move(continuing))
    { }

    Attribute::List m_attributes;
    Attribute::List m_bodyAttributes;
    Statement::List m_body;
    std::optional<Continuing> m_continuing;

    bool m_containsSwitch { false };
    Behaviors m_bodyBehaviors;
    DiagnosticContainer m_bodyDiagnostics;
};

} // namespace WGSL::AST

SPECIALIZE_TYPE_TRAITS_WGSL_AST(LoopStatement)
