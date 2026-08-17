/*
 * Copyright (C) 2022-2023 Apple Inc. All rights reserved.
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
#include "ASTIdentifier.h"
#include "ASTNode.h"
#include <wtf/ReferenceWrapperVector.h>
#include <wtf/TypeCasts.h>

namespace WGSL::AST {

class Declaration : public Node {
    WGSL_AST_BUILDER_NODE(Declaration);
public:
    using Ref = std::reference_wrapper<Declaration>;
    using List = ReferenceWrapperVector<Declaration>;

    virtual Identifier& name() = 0;

protected:
    Declaration(SourceSpan span)
        : Node(span)
    { }
};

} // namespace WGSL::AST

SPECIALIZE_TYPE_TRAITS_BEGIN(WGSL::AST::Declaration)
static bool isType(const WGSL::AST::Node& node)
{
    switch (node.kind()) {
    case WGSL::AST::NodeKind::Function:
    case WGSL::AST::NodeKind::Structure:
    case WGSL::AST::NodeKind::Variable:
        return true;
    default:
        return false;
    }
}
SPECIALIZE_TYPE_TRAITS_END()
