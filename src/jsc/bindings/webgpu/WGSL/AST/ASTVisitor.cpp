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

#include "config.h"
#include "ASTVisitor.h"

#include "AST.h"
#include "WGSLShaderModule.h"

namespace WGSL::AST {

bool Visitor::hasError() const
{
    return !m_expectedError;
}

Result<void> Visitor::result()
{
    return m_expectedError;
}

// Shader Module

void Visitor::visit(ShaderModule& shaderModule)
{
    for (auto& directive : shaderModule.directives())
        checkErrorAndVisit(directive);
    for (auto& declaration : shaderModule.declarations())
        checkErrorAndVisit(declaration);
}

// Directive

void Visitor::visit(AST::Directive& directive)
{
    switch (directive.kind()) {
    case AST::NodeKind::DiagnosticDirective:
        checkErrorAndVisit(uncheckedDowncast<AST::DiagnosticDirective>(directive));
        break;
    default:
        ASSERT_NOT_REACHED("Unhandled Directive");
    }
}

void Visitor::visit(AST::DiagnosticDirective& directive)
{
    visit(directive.diagnostic());
}


// Diagnostic

void Visitor::visit(AST::Diagnostic&)
{
}

// Declarations

void Visitor::visit(AST::Declaration& declaration)
{
    switch (declaration.kind()) {
    case AST::NodeKind::Function:
        checkErrorAndVisit(uncheckedDowncast<AST::Function>(declaration));
        break;
    case AST::NodeKind::Variable:
        checkErrorAndVisit(uncheckedDowncast<AST::Variable>(declaration));
        break;
    case AST::NodeKind::Structure:
        checkErrorAndVisit(uncheckedDowncast<AST::Structure>(declaration));
        break;
    case AST::NodeKind::TypeAlias:
        checkErrorAndVisit(uncheckedDowncast<AST::TypeAlias>(declaration));
        break;
    case AST::NodeKind::ConstAssert:
        checkErrorAndVisit(uncheckedDowncast<AST::ConstAssert>(declaration));
        break;
    default:
        ASSERT_NOT_REACHED("Unhandled Declaration");
    }
}

void Visitor::visit(AST::TypeAlias& alias)
{
    visit(alias.type());
}

void Visitor::visit(AST::ConstAssert& assertion)
{
    visit(assertion.test());
}

// Attribute

void Visitor::visit(Attribute& attribute)
{
    switch (attribute.kind()) {
    case AST::NodeKind::AlignAttribute:
        checkErrorAndVisit(uncheckedDowncast<AST::AlignAttribute>(attribute));
        break;
    case AST::NodeKind::BindingAttribute:
        checkErrorAndVisit(uncheckedDowncast<AST::BindingAttribute>(attribute));
        break;
    case AST::NodeKind::BuiltinAttribute:
        checkErrorAndVisit(uncheckedDowncast<AST::BuiltinAttribute>(attribute));
        break;
    case AST::NodeKind::ConstAttribute:
        checkErrorAndVisit(uncheckedDowncast<AST::ConstAttribute>(attribute));
        break;
    case AST::NodeKind::DiagnosticAttribute:
        checkErrorAndVisit(uncheckedDowncast<AST::DiagnosticAttribute>(attribute));
        break;
    case AST::NodeKind::GroupAttribute:
        checkErrorAndVisit(uncheckedDowncast<AST::GroupAttribute>(attribute));
        break;
    case AST::NodeKind::IdAttribute:
        checkErrorAndVisit(uncheckedDowncast<AST::IdAttribute>(attribute));
        break;
    case AST::NodeKind::InterpolateAttribute:
        checkErrorAndVisit(uncheckedDowncast<AST::InterpolateAttribute>(attribute));
        break;
    case AST::NodeKind::InvariantAttribute:
        checkErrorAndVisit(uncheckedDowncast<AST::InvariantAttribute>(attribute));
        break;
    case AST::NodeKind::LocationAttribute:
        checkErrorAndVisit(uncheckedDowncast<AST::LocationAttribute>(attribute));
        break;
    case AST::NodeKind::MustUseAttribute:
        checkErrorAndVisit(uncheckedDowncast<AST::MustUseAttribute>(attribute));
        break;
    case AST::NodeKind::SizeAttribute:
        checkErrorAndVisit(uncheckedDowncast<AST::SizeAttribute>(attribute));
        break;
    case AST::NodeKind::StageAttribute:
        checkErrorAndVisit(uncheckedDowncast<AST::StageAttribute>(attribute));
        break;
    case AST::NodeKind::WorkgroupSizeAttribute:
        checkErrorAndVisit(uncheckedDowncast<AST::WorkgroupSizeAttribute>(attribute));
        break;
    default:
        ASSERT_NOT_REACHED("Unhandled Attribute");
    }
}

void Visitor::visit(AST::AlignAttribute& attribute)
{
    visit(attribute.alignment());
}

void Visitor::visit(AST::BindingAttribute& attribute)
{
    visit(attribute.binding());
}

void Visitor::visit(AST::ConstAttribute&)
{
}

void Visitor::visit(AST::DiagnosticAttribute& attribute)
{
    visit(attribute.diagnostic());
}

void Visitor::visit(AST::BuiltinAttribute&)
{
}

void Visitor::visit(GroupAttribute& attribute)
{
    visit(attribute.group());
}

void Visitor::visit(AST::IdAttribute& attribute)
{
    visit(attribute.value());
}

void Visitor::visit(AST::InterpolateAttribute&)
{
}

void Visitor::visit(AST::InvariantAttribute&)
{
}

void Visitor::visit(AST::LocationAttribute& attribute)
{
    visit(attribute.location());
}

void Visitor::visit(AST::MustUseAttribute&)
{
}


void Visitor::visit(AST::SizeAttribute& attribute)
{
    visit(attribute.size());
}

void Visitor::visit(AST::StageAttribute&)
{
}

void Visitor::visit(AST::WorkgroupSizeAttribute& attribute)
{
    checkErrorAndVisit(attribute.x());
    maybeCheckErrorAndVisit(attribute.maybeY());
    maybeCheckErrorAndVisit(attribute.maybeZ());
}

// Expression

void Visitor::visit(Expression& expression)
{
    switch (expression.kind()) {
    case AST::NodeKind::AbstractFloatLiteral:
        checkErrorAndVisit(uncheckedDowncast<AST::AbstractFloatLiteral>(expression));
        break;
    case AST::NodeKind::AbstractIntegerLiteral:
        checkErrorAndVisit(uncheckedDowncast<AST::AbstractIntegerLiteral>(expression));
        break;
    case AST::NodeKind::BinaryExpression:
        checkErrorAndVisit(uncheckedDowncast<AST::BinaryExpression>(expression));
        break;
    case AST::NodeKind::BoolLiteral:
        checkErrorAndVisit(uncheckedDowncast<AST::BoolLiteral>(expression));
        break;
    case AST::NodeKind::CallExpression:
        checkErrorAndVisit(uncheckedDowncast<AST::CallExpression>(expression));
        break;
    case AST::NodeKind::FieldAccessExpression:
        checkErrorAndVisit(uncheckedDowncast<AST::FieldAccessExpression>(expression));
        break;
    case AST::NodeKind::Float32Literal:
        checkErrorAndVisit(uncheckedDowncast<AST::Float32Literal>(expression));
        break;
    case AST::NodeKind::Float16Literal:
        checkErrorAndVisit(uncheckedDowncast<AST::Float16Literal>(expression));
        break;
    case AST::NodeKind::IdentifierExpression:
        checkErrorAndVisit(uncheckedDowncast<AST::IdentifierExpression>(expression));
        break;
    case AST::NodeKind::IdentityExpression:
        checkErrorAndVisit(uncheckedDowncast<IdentityExpression>(expression));
        break;
    case AST::NodeKind::IndexAccessExpression:
        checkErrorAndVisit(uncheckedDowncast<AST::IndexAccessExpression>(expression));
        break;
    case AST::NodeKind::Signed32Literal:
        checkErrorAndVisit(uncheckedDowncast<AST::Signed32Literal>(expression));
        break;
    case AST::NodeKind::UnaryExpression:
        checkErrorAndVisit(uncheckedDowncast<AST::UnaryExpression>(expression));
        break;
    case AST::NodeKind::Unsigned32Literal:
        checkErrorAndVisit(uncheckedDowncast<AST::Unsigned32Literal>(expression));
        break;
    case AST::NodeKind::ArrayTypeExpression:
        checkErrorAndVisit(uncheckedDowncast<AST::ArrayTypeExpression>(expression));
        break;
    case AST::NodeKind::ElaboratedTypeExpression:
        checkErrorAndVisit(uncheckedDowncast<AST::ElaboratedTypeExpression>(expression));
        break;
    case AST::NodeKind::ReferenceTypeExpression:
        checkErrorAndVisit(uncheckedDowncast<AST::ReferenceTypeExpression>(expression));
        break;
    default:
        ASSERT_NOT_REACHED("Unhandled Expression");
    }
}

void Visitor::visit(AbstractFloatLiteral&)
{
}

void Visitor::visit(AST::AbstractIntegerLiteral&)
{
}

void Visitor::visit(AST::BinaryExpression& binaryExpression)
{
    checkErrorAndVisit(binaryExpression.leftExpression());
    checkErrorAndVisit(binaryExpression.rightExpression());
}

void Visitor::visit(BoolLiteral&)
{
}

void Visitor::visit(AST::CallExpression& callExpression)
{
    checkErrorAndVisit(callExpression.target());
    for (auto& argument : callExpression.arguments())
        checkErrorAndVisit(argument);
}

void Visitor::visit(AST::FieldAccessExpression& fieldAccessExpression)
{
    checkErrorAndVisit(fieldAccessExpression.base());
}

void Visitor::visit(AST::Float32Literal&)
{
}

void Visitor::visit(AST::Float16Literal&)
{
}

void Visitor::visit(AST::IdentifierExpression& identifierExpression)
{
    checkErrorAndVisit(identifierExpression.identifier());
}

void Visitor::visit(AST::IndexAccessExpression& indexAccessExpression)
{
    checkErrorAndVisit(indexAccessExpression.base());
    checkErrorAndVisit(indexAccessExpression.index());
}

void Visitor::visit(AST::PointerDereferenceExpression&)
{
}

void Visitor::visit(AST::Signed32Literal&)
{
}

void Visitor::visit(UnaryExpression& unaryExpression)
{
    checkErrorAndVisit(unaryExpression.expression());
}

void Visitor::visit(AST::Unsigned32Literal&)
{
}

// Function

void Visitor::visit(AST::Function& function)
{
    for (auto& attribute : function.attributes())
        checkErrorAndVisit(attribute);
    for (auto& parameter : function.parameters())
        checkErrorAndVisit(parameter);
    for (auto& attribute : function.returnAttributes())
        checkErrorAndVisit(attribute);
    maybeCheckErrorAndVisit(function.maybeReturnType());
    checkErrorAndVisit(function.body());
}

void Visitor::visit(AST::Parameter& parameterValue)
{
    for (auto& attribute : parameterValue.attributes())
        checkErrorAndVisit(attribute);
    checkErrorAndVisit(parameterValue.typeName());
}

// Identifier

void Visitor::visit(AST::Identifier&)
{
}

void Visitor::visit(IdentityExpression& identity)
{
    checkErrorAndVisit(identity.expression());
}

// Statement

void Visitor::visit(Statement& statement)
{
    switch (statement.kind()) {
    case AST::NodeKind::AssignmentStatement:
        checkErrorAndVisit(uncheckedDowncast<AST::AssignmentStatement>(statement));
        break;
    case AST::NodeKind::BreakStatement:
        checkErrorAndVisit(uncheckedDowncast<AST::BreakStatement>(statement));
        break;
    case AST::NodeKind::CallStatement:
        checkErrorAndVisit(uncheckedDowncast<AST::CallStatement>(statement));
        break;
    case AST::NodeKind::CompoundAssignmentStatement:
        checkErrorAndVisit(uncheckedDowncast<AST::CompoundAssignmentStatement>(statement));
        break;
    case AST::NodeKind::CompoundStatement:
        checkErrorAndVisit(uncheckedDowncast<AST::CompoundStatement>(statement));
        break;
    case AST::NodeKind::ConstAssertStatement:
        checkErrorAndVisit(uncheckedDowncast<AST::ConstAssertStatement>(statement));
        break;
    case AST::NodeKind::ContinueStatement:
        checkErrorAndVisit(uncheckedDowncast<AST::ContinueStatement>(statement));
        break;
    case AST::NodeKind::DecrementIncrementStatement:
        checkErrorAndVisit(uncheckedDowncast<AST::DecrementIncrementStatement>(statement));
        break;
    case AST::NodeKind::DiscardStatement:
        checkErrorAndVisit(uncheckedDowncast<AST::DiscardStatement>(statement));
        break;
    case AST::NodeKind::ForStatement:
        checkErrorAndVisit(uncheckedDowncast<AST::ForStatement>(statement));
        break;
    case AST::NodeKind::IfStatement:
        checkErrorAndVisit(uncheckedDowncast<AST::IfStatement>(statement));
        break;
    case AST::NodeKind::LoopStatement:
        checkErrorAndVisit(uncheckedDowncast<AST::LoopStatement>(statement));
        break;
    case AST::NodeKind::PhonyAssignmentStatement:
        checkErrorAndVisit(uncheckedDowncast<AST::PhonyAssignmentStatement>(statement));
        break;
    case AST::NodeKind::ReturnStatement:
        checkErrorAndVisit(uncheckedDowncast<AST::ReturnStatement>(statement));
        break;
    case AST::NodeKind::SwitchStatement:
        checkErrorAndVisit(uncheckedDowncast<AST::SwitchStatement>(statement));
        break;
    case AST::NodeKind::VariableStatement:
        checkErrorAndVisit(uncheckedDowncast<AST::VariableStatement>(statement));
        break;
    case AST::NodeKind::WhileStatement:
        checkErrorAndVisit(uncheckedDowncast<AST::WhileStatement>(statement));
        break;
    default:
        ASSERT_NOT_REACHED("Unhandled Statement");
    }
}

void Visitor::visit(AST::AssignmentStatement& assignmentStatement)
{
    checkErrorAndVisit(assignmentStatement.lhs());
    checkErrorAndVisit(assignmentStatement.rhs());
}

void Visitor::visit(AST::BreakStatement&)
{
}

void Visitor::visit(AST::CallStatement& callStatement)
{
    checkErrorAndVisit(callStatement.call());
}

void Visitor::visit(AST::CompoundAssignmentStatement& compoundAssignmentStatement)
{
    checkErrorAndVisit(compoundAssignmentStatement.leftExpression());
    checkErrorAndVisit(compoundAssignmentStatement.rightExpression());
}

void Visitor::visit(CompoundStatement& compoundStatement)
{
    for (auto& statement : compoundStatement.statements())
        checkErrorAndVisit(statement);
}

void Visitor::visit(AST::ConstAssertStatement& statement)
{
    checkErrorAndVisit(statement.assertion());
}

void Visitor::visit(AST::ContinueStatement&)
{
}

void Visitor::visit(AST::DecrementIncrementStatement& decrementIncrementStatement)
{
    checkErrorAndVisit(decrementIncrementStatement.expression());
}

void Visitor::visit(AST::DiscardStatement&)
{
}

void Visitor::visit(AST::ForStatement& forStatement)
{
    maybeCheckErrorAndVisit(forStatement.maybeInitializer());
    maybeCheckErrorAndVisit(forStatement.maybeTest());
    maybeCheckErrorAndVisit(forStatement.maybeUpdate());
    checkErrorAndVisit(forStatement.body());
}

void Visitor::visit(AST::IfStatement& ifStatement)
{
    for (auto& attribute : ifStatement.attributes())
        checkErrorAndVisit(attribute);
    checkErrorAndVisit(ifStatement.test());
    checkErrorAndVisit(ifStatement.trueBody());
    maybeCheckErrorAndVisit(ifStatement.maybeFalseBody());
}

void Visitor::visit(AST::LoopStatement& loopStatement)
{
    for (auto& attribute : loopStatement.attributes())
        checkErrorAndVisit(attribute);
    for (auto& statement : loopStatement.body())
        checkErrorAndVisit(statement);
    if (auto& continuing = loopStatement.continuing())
        checkErrorAndVisit(*continuing);
}

void Visitor::visit(AST::Continuing& continuing)
{
    for (auto& statement : continuing.body)
        checkErrorAndVisit(statement);
    for (auto& attribute : continuing.attributes)
        checkErrorAndVisit(attribute);
    maybeCheckErrorAndVisit(continuing.breakIf);
}

void Visitor::visit(AST::PhonyAssignmentStatement& phonyAssignmentStatement)
{
    checkErrorAndVisit(phonyAssignmentStatement.rhs());
}

void Visitor::visit(AST::ReturnStatement& returnStatement)
{
    maybeCheckErrorAndVisit(returnStatement.maybeExpression());
}

void Visitor::visit(AST::SwitchStatement& statement)
{
    checkErrorAndVisit(statement.value());
    for (auto& attribute : statement.bodyAttributes())
        checkErrorAndVisit(attribute);
    for (auto& clause : statement.clauses())
        checkErrorAndVisit(clause);
    checkErrorAndVisit(statement.defaultClause());
}

void Visitor::visit(AST::SwitchClause& clause)
{
    for (auto& selector : clause.selectors)
        checkErrorAndVisit(selector);
    checkErrorAndVisit(clause.body);
}

void Visitor::visit(AST::VariableStatement& varStatement)
{
    checkErrorAndVisit(varStatement.variable());
}

void Visitor::visit(AST::WhileStatement& whileStatement)
{
    checkErrorAndVisit(whileStatement.test());
    checkErrorAndVisit(whileStatement.body());
}

// Structure

void Visitor::visit(AST::Structure& structure)
{
    for (auto& member : structure.members())
        checkErrorAndVisit(member);
}

void Visitor::visit(AST::StructureMember& structureMember)
{
    for (auto& attribute : structureMember.attributes())
        checkErrorAndVisit(attribute);
    checkErrorAndVisit(structureMember.type());
}

// Types

void Visitor::visit(AST::ArrayTypeExpression& arrayTypeExpression)
{
    maybeCheckErrorAndVisit(arrayTypeExpression.maybeElementType());
    maybeCheckErrorAndVisit(arrayTypeExpression.maybeElementCount());
}

void Visitor::visit(AST::ElaboratedTypeExpression& elaboratedExpression)
{
    for (auto& argument : elaboratedExpression.arguments())
        checkErrorAndVisit(argument);
}

void Visitor::visit(AST::ReferenceTypeExpression& referenceTypeExpression)
{
    checkErrorAndVisit(referenceTypeExpression.type());
}

// Variable

void Visitor::visit(AST::Variable& variable)
{
    for (auto& attribute : variable.attributes())
        checkErrorAndVisit(attribute);
    maybeCheckErrorAndVisit(variable.maybeQualifier());
    maybeCheckErrorAndVisit(variable.maybeTypeName());
    maybeCheckErrorAndVisit(variable.maybeInitializer());
}

void Visitor::visit(VariableQualifier&)
{
}

} // namespace WGSL::AST
