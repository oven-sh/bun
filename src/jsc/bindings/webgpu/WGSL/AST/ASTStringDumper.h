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

#include "ASTVisitor.h"
#include <wtf/StringPrintStream.h>

namespace WGSL {

class ShaderModule;

namespace AST {

class StringDumper final : public Visitor {
    friend struct Indent;
public:
    using Visitor::visit;

    String toString();

    // Visitor
    void visit(ShaderModule&) override;

    // Directive
    void visit(Diagnostic&) override;

    // Attribute
    void visit(BindingAttribute&) override;
    void visit(BuiltinAttribute&) override;
    void visit(GroupAttribute&) override;
    void visit(LocationAttribute&) override;
    void visit(StageAttribute&) override;
    void visit(WorkgroupSizeAttribute&) override;
    void visit(DiagnosticAttribute&) override;

    // Declaration
    void visit(Function&) override;
    void visit(Structure&) override;
    void visit(Variable&) override;
    void visit(TypeAlias&) override;

    // Expression
    void visit(AbstractFloatLiteral&) override;
    void visit(AbstractIntegerLiteral&) override;
    void visit(BinaryExpression&) override;
    void visit(BoolLiteral&) override;
    void visit(CallExpression&) override;
    void visit(FieldAccessExpression&) override;
    void visit(Float32Literal&) override;
    void visit(Float16Literal&) override;
    void visit(IdentifierExpression&) override;
    void visit(IndexAccessExpression&) override;
    void visit(PointerDereferenceExpression&) override;
    void visit(Signed32Literal&) override;
    void visit(UnaryExpression&) override;
    void visit(Unsigned32Literal&) override;

    // Statement
    void visit(AssignmentStatement&) override;
    void visit(CallStatement&) override;
    void visit(CompoundAssignmentStatement&) override;
    void visit(CompoundStatement&) override;
    void visit(AST::DecrementIncrementStatement&) override;
    void visit(IfStatement&) override;
    void visit(PhonyAssignmentStatement&) override;
    void visit(ReturnStatement&) override;
    void visit(VariableStatement&) override;
    void visit(ForStatement&) override;

    // Types
    void visit(ArrayTypeExpression&) override;
    void visit(ElaboratedTypeExpression&) override;
    void visit(ReferenceTypeExpression&) override;

    // Values
    void visit(Parameter&) override;

    void visit(StructureMember&) override;

    void visit(VariableQualifier&) override;

private:

    template<typename T, typename J>
    void visitVector(T&, J);

    StringPrintStream m_out;
    String m_indent;
};

template<typename T>
void dumpNode(PrintStream& out, T& node)
{
    StringDumper dumper;
    dumper.visit(node);
    out.print(dumper.toString());
}

MAKE_PRINT_ADAPTOR(ShaderModuleDumper, ShaderModule&, dumpNode);

void dumpAST(ShaderModule&);

} // namespace AST
} // namespace WGSL
