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

#include "ASTForward.h"
#include "ASTInterpolateAttribute.h"
#include "CompilationMessage.h"

#include <wtf/Expected.h>

namespace WGSL {

class ShaderModule;

namespace AST {

class Visitor {
public:
    virtual ~Visitor() = default;

    // Shader Module
    virtual void visit(ShaderModule&);

    // Directive
    virtual void visit(AST::Directive&);
    virtual void visit(AST::DiagnosticDirective&);

    // Diagnostic
    virtual void visit(AST::Diagnostic&);

    // Declaration
    virtual void visit(AST::Declaration&);
    virtual void visit(AST::Function&);
    virtual void visit(AST::Variable&);
    virtual void visit(AST::Structure&);
    virtual void visit(AST::TypeAlias&);
    virtual void visit(AST::ConstAssert&);

    // Attribute
    virtual void visit(AST::Attribute&);
    virtual void visit(AST::AlignAttribute&);
    virtual void visit(AST::BindingAttribute&);
    virtual void visit(AST::BuiltinAttribute&);
    virtual void visit(AST::ConstAttribute&);
    virtual void visit(AST::DiagnosticAttribute&);
    virtual void visit(AST::GroupAttribute&);
    virtual void visit(AST::IdAttribute&);
    virtual void visit(AST::InterpolateAttribute&);
    virtual void visit(AST::InvariantAttribute&);
    virtual void visit(AST::LocationAttribute&);
    virtual void visit(AST::MustUseAttribute&);
    virtual void visit(AST::SizeAttribute&);
    virtual void visit(AST::StageAttribute&);
    virtual void visit(AST::WorkgroupSizeAttribute&);

    // Expression
    virtual void visit(AST::Expression&);
    virtual void visit(AST::AbstractFloatLiteral&);
    virtual void visit(AST::AbstractIntegerLiteral&);
    virtual void visit(AST::BinaryExpression&);
    virtual void visit(AST::BoolLiteral&);
    virtual void visit(AST::CallExpression&);
    virtual void visit(AST::FieldAccessExpression&);
    virtual void visit(AST::Float32Literal&);
    virtual void visit(AST::Float16Literal&);
    virtual void visit(AST::IdentifierExpression&);
    virtual void visit(AST::IdentityExpression&);
    virtual void visit(AST::IndexAccessExpression&);
    virtual void visit(AST::PointerDereferenceExpression&);
    virtual void visit(AST::Signed32Literal&);
    virtual void visit(AST::UnaryExpression&);
    virtual void visit(AST::Unsigned32Literal&);

    virtual void visit(AST::Parameter&);

    virtual void visit(AST::Identifier&);

    // Statement
    virtual void visit(AST::Statement&);
    virtual void visit(AST::AssignmentStatement&);
    virtual void visit(AST::BreakStatement&);
    virtual void visit(AST::CallStatement&);
    virtual void visit(AST::CompoundAssignmentStatement&);
    virtual void visit(AST::CompoundStatement&);
    virtual void visit(AST::ConstAssertStatement&);
    virtual void visit(AST::ContinueStatement&);
    virtual void visit(AST::DecrementIncrementStatement&);
    virtual void visit(AST::DiscardStatement&);
    virtual void visit(AST::ForStatement&);
    virtual void visit(AST::IfStatement&);
    virtual void visit(AST::LoopStatement&);
    virtual void visit(AST::PhonyAssignmentStatement&);
    virtual void visit(AST::ReturnStatement&);
    virtual void visit(AST::SwitchStatement&);
    virtual void visit(AST::VariableStatement&);
    virtual void visit(AST::WhileStatement&);

    virtual void visit(AST::ArrayTypeExpression&);
    virtual void visit(AST::ElaboratedTypeExpression&);
    virtual void visit(AST::ReferenceTypeExpression&);

    virtual void visit(AST::StructureMember&);
    virtual void visit(AST::VariableQualifier&);
    virtual void visit(AST::SwitchClause&);
    virtual void visit(AST::Continuing&);

    bool NODELETE hasError() const;
    Result<void> NODELETE result();

    template<typename T> void checkErrorAndVisit(T& x)
    {
        if (!hasError())
            visit(x);
    }

    template<typename T> void maybeCheckErrorAndVisit(T* x)
    {
        if (!hasError() && x)
            visit(*x);
    }

protected:
    void setError(Error error)
    {
        ASSERT(!hasError());
        m_expectedError = makeUnexpected(error);
    }

private:
    Result<void> m_expectedError;
};

} // namespace AST
} // namespace WGSL
