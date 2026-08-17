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

#include "ASTAbstractFloatLiteral.h"
#include "ASTAbstractIntegerLiteral.h"
#include "ASTAlignAttribute.h"
#include "ASTArrayTypeExpression.h"
#include "ASTAssignmentStatement.h"
#include "ASTAttribute.h"
#include "ASTBinaryExpression.h"
#include "ASTBindingAttribute.h"
#include "ASTBoolLiteral.h"
#include "ASTBreakStatement.h"
#include "ASTBuiltinAttribute.h"
#include "ASTCallExpression.h"
#include "ASTCallStatement.h"
#include "ASTCompoundAssignmentStatement.h"
#include "ASTCompoundStatement.h"
#include "ASTConstAssert.h"
#include "ASTConstAssertStatement.h"
#include "ASTConstAttribute.h"
#include "ASTContinueStatement.h"
#include "ASTDecrementIncrementStatement.h"
#include "ASTDiagnosticAttribute.h"
#include "ASTDiagnosticDirective.h"
#include "ASTDirective.h"
#include "ASTDiscardStatement.h"
#include "ASTElaboratedTypeExpression.h"
#include "ASTExpression.h"
#include "ASTFieldAccessExpression.h"
#include "ASTFloat16Literal.h"
#include "ASTFloat32Literal.h"
#include "ASTForStatement.h"
#include "ASTFunction.h"
#include "ASTGroupAttribute.h"
#include "ASTIdAttribute.h"
#include "ASTIdentifier.h"
#include "ASTIdentifierExpression.h"
#include "ASTIdentityExpression.h"
#include "ASTIfStatement.h"
#include "ASTIndexAccessExpression.h"
#include "ASTInterpolateAttribute.h"
#include "ASTInvariantAttribute.h"
#include "ASTLocationAttribute.h"
#include "ASTLoopStatement.h"
#include "ASTMustUseAttribute.h"
#include "ASTNode.h"
#include "ASTParameter.h"
#include "ASTPhonyStatement.h"
#include "ASTPointerDereference.h"
#include "ASTReferenceTypeExpression.h"
#include "ASTReturnStatement.h"
#include "ASTSigned32Literal.h"
#include "ASTSizeAttribute.h"
#include "ASTStageAttribute.h"
#include "ASTStatement.h"
#include "ASTStructure.h"
#include "ASTStructureMember.h"
#include "ASTSwitchStatement.h"
#include "ASTTypeAlias.h"
#include "ASTUnaryExpression.h"
#include "ASTUnsigned32Literal.h"
#include "ASTVariable.h"
#include "ASTVariableQualifier.h"
#include "ASTVariableStatement.h"
#include "ASTWhileStatement.h"
#include "ASTWorkgroupSizeAttribute.h"
