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

#include "ASTBuilder.h"
#include "ASTDiagnostic.h"
#include "ASTNode.h"
#include <wtf/OptionSet.h>
#include <wtf/ReferenceWrapperVector.h>

namespace WGSL::AST {

enum class Behavior : uint8_t {
    Return = 1 << 0,
    Break = 1 << 1,
    Continue = 1 << 2,
    Next = 1 << 3,
};
using Behaviors = OptionSet<Behavior>;

class Statement : public Node, public DiagnosticContainer {
    WGSL_AST_BUILDER_NODE(Statement);
public:
    using Ref = std::reference_wrapper<Statement>;
    using Ptr = Statement*;
    using List = ReferenceWrapperVector<Statement>;

    Behaviors behaviors() const { return m_behaviors; }
    void setBehaviors(Behaviors behaviors) { m_behaviors = behaviors; }

protected:
    Statement(SourceSpan span)
        : Node(span)
    { }

private:
    Behaviors m_behaviors;
};

} // namespace WGSL::AST

SPECIALIZE_TYPE_TRAITS_BEGIN(WGSL::AST::Statement)
static bool isType(const WGSL::AST::Node& node)
{
    switch (node.kind()) {
    case WGSL::AST::NodeKind::AssignmentStatement:
    case WGSL::AST::NodeKind::BreakStatement:
    case WGSL::AST::NodeKind::CallStatement:
    case WGSL::AST::NodeKind::CompoundAssignmentStatement:
    case WGSL::AST::NodeKind::CompoundStatement:
    case WGSL::AST::NodeKind::ContinueStatement:
    case WGSL::AST::NodeKind::DecrementIncrementStatement:
    case WGSL::AST::NodeKind::DiscardStatement:
    case WGSL::AST::NodeKind::ForStatement:
    case WGSL::AST::NodeKind::IfStatement:
    case WGSL::AST::NodeKind::LoopStatement:
    case WGSL::AST::NodeKind::PhonyAssignmentStatement:
    case WGSL::AST::NodeKind::ReturnStatement:
    case WGSL::AST::NodeKind::SwitchStatement:
    case WGSL::AST::NodeKind::VariableStatement:
    case WGSL::AST::NodeKind::WhileStatement:
        return true;
    default:
        return false;
    }
}
SPECIALIZE_TYPE_TRAITS_END()
