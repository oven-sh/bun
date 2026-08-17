/*
 * Copyright (c) 2021-2024 Apple Inc. All rights reserved.
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
 * THIS SOFTWARE IS PROVIDED BY APPLE INC. ``AS IS'' AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL APPLE INC. OR
 * CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
 * EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
 * PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
 * PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY
 * OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

#include "config.h"
#include "WGSL.h"

#include "AST.h"
#include "AliasAnalysis.h"
#include "AttributeValidator.h"
#include "BoundsCheck.h"
#include "CallGraph.h"
#include "EntryPointRewriter.h"
#include "GlobalSorting.h"
#include "GlobalVariableRewriter.h"
#include "IOValidator.h"
#include "MangleNames.h"
#include "Metal/MetalCodeGenerator.h"
#include "Parser.h"
#include "PhaseTimer.h"
#include "PointerRewriter.h"
#include "TypeCheck.h"
#include "UniformityAnalysis.h"
#include "VisibilityValidator.h"
#include "WGSLShaderModule.h"
#include <wtf/text/MakeString.h>

namespace WGSL {

#define CHECK_PASS(pass, ...) \
    dumpASTBetweenEachPassIfNeeded(shaderModule, "AST before " # pass); \
    auto maybe##pass##Failure = [&]() { \
        PhaseTimer phaseTimer(#pass, phaseTimes); \
        return pass(__VA_ARGS__); \
    }(); \
    if (maybe##pass##Failure) { \
        if (!maybe##pass##Failure->errors.isEmpty()) \
            return { *maybe##pass##Failure }; \
        warnings.appendVector(WTF::move(maybe##pass##Failure->warnings)); \
    }

#define RUN_PASS(pass, ...) \
    do { \
        PhaseTimer phaseTimer(#pass, phaseTimes); \
        dumpASTBetweenEachPassIfNeeded(shaderModule, "AST before " # pass); \
        pass(__VA_ARGS__); \
    } while (0)

#define RUN_PASS_WITH_RESULT(name, pass, ...) \
    dumpASTBetweenEachPassIfNeeded(shaderModule, "AST before " # pass); \
    auto name = [&]() { \
        PhaseTimer phaseTimer(#pass, phaseTimes); \
        return pass(__VA_ARGS__); \
    }();

static ASCIILiteral wgslExtensionToWebGPUFeatureName(Extension extension)
{
    // Map WGSL extension names to WebGPU feature names
    // WGSL uses underscores, WebGPU uses hyphens
    switch (extension) {
    case Extension::ClipDistances:
        return "clip-distances"_s;
    case Extension::F16:
        return "shader-f16"_s;
    case Extension::PrimitiveIndex:
        return "primitive-index"_s;
    case Extension::Subgroups:
        return "subgroups"_s;
    }
}

Variant<SuccessfulCheck, FailedCheck> staticCheck(const String& wgsl, const std::optional<SourceMap>&, const Configuration& configuration)
{
    PhaseTimes phaseTimes;
    auto shaderModule = makeUniqueRef<ShaderModule>(wgsl, configuration);
    Vector<Warning> warnings;

    CHECK_PASS(parse, shaderModule);
    CHECK_PASS(reorderGlobals, shaderModule);
    CHECK_PASS(typeCheck, shaderModule);
    CHECK_PASS(validateAttributes, shaderModule);
    RUN_PASS(buildCallGraph, shaderModule);
    CHECK_PASS(validateIO, shaderModule);
    CHECK_PASS(validateVisibility, shaderModule);
    RUN_PASS(mangleNames, shaderModule);
    RUN_PASS(rewritePointers, shaderModule);
    CHECK_PASS(aliasAnalysis, shaderModule);
    CHECK_PASS(uniformityAnalysis, shaderModule);

    // Validate that all enabled extensions are supported by the device
    for (auto extension : shaderModule->enabledExtensions()) {
        auto featureName = wgslExtensionToWebGPUFeatureName(extension);
        if (!shaderModule->hasFeature(featureName))
            return Variant<SuccessfulCheck, FailedCheck>(WTF::InPlaceType<FailedCheck>, Vector<Error> { Error { makeString("Extension '"_s, toString(extension), "' requires feature '"_s, featureName, "' which is not enabled on this device"_s), SourceSpan::empty() } }, Vector<Warning> { });
    }

    return Variant<SuccessfulCheck, FailedCheck>(WTF::InPlaceType<SuccessfulCheck>, WTF::move(warnings), WTF::move(shaderModule));
}

SuccessfulCheck::SuccessfulCheck(SuccessfulCheck&&) = default;

SuccessfulCheck::SuccessfulCheck(Vector<Warning>&& messages, UniqueRef<ShaderModule>&& shader)
    : warnings(WTF::move(messages))
    , ast(WTF::move(shader))
{
}

SuccessfulCheck::~SuccessfulCheck() = default;

inline Variant<PrepareResult, Error> prepareImpl(ShaderModule& shaderModule, const HashMap<String, PipelineLayout*>& pipelineLayouts)
{
    CompilationScope compilationScope(shaderModule);

    PhaseTimes phaseTimes;
    auto result = [&]() -> Variant<PrepareResult, Error> {
        PhaseTimer phaseTimer("prepare total", phaseTimes);

        HashMap<String, Reflection::EntryPointInformation> entryPoints;

        RUN_PASS(insertBoundsChecks, shaderModule);
        RUN_PASS(rewriteEntryPoints, shaderModule, pipelineLayouts);
        if (auto error = rewriteGlobalVariables(shaderModule, pipelineLayouts, entryPoints))
            return { *error };

        dumpASTAtEndIfNeeded(shaderModule);

        return { PrepareResult { WTF::move(entryPoints), WTF::move(compilationScope) } };
    }();

    logPhaseTimes(phaseTimes);

    return result;
}

Variant<String, Error> generate(ShaderModule& shaderModule, PrepareResult& prepareResult, HashMap<String, ConstantValue>& constantValues, DeviceState&& deviceState)
{
    CompilationScope generationScope(shaderModule);

    PhaseTimes phaseTimes;
    String result;
    if (auto maybeError = shaderModule.validateOverrides(prepareResult, constantValues))
        return { *maybeError };
    {
        PhaseTimer phaseTimer("generateMetalCode", phaseTimes);
        result = Metal::generateMetalCode(shaderModule, prepareResult, constantValues, WTF::move(deviceState));
    }
    logPhaseTimes(phaseTimes);
    return { result };
}

Variant<PrepareResult, Error> prepare(ShaderModule& ast, const HashMap<String, PipelineLayout*>& pipelineLayouts)
{
    return prepareImpl(ast, pipelineLayouts);
}

Variant<PrepareResult, Error> prepare(ShaderModule& ast, const String& entryPointName, PipelineLayout* pipelineLayout)
{
    HashMap<String, PipelineLayout*> pipelineLayouts;
    pipelineLayouts.add(entryPointName, pipelineLayout);
    return prepareImpl(ast, pipelineLayouts);
}

std::optional<ConstantValue> evaluate(const ShaderModule& module, const AST::Expression& expression, const HashMap<String, ConstantValue>& overrideValues)
{
    std::optional<ConstantValue> result;
    if (auto constantValue = expression.constantValue())
        result = *constantValue;

    auto call = [&](const String& function, auto&& callArguments) -> std::optional<ConstantValue> {
        unsigned argumentCount = callArguments.size();
        FixedVector<ConstantValue> arguments(argumentCount);
        for (unsigned i = 0; i < argumentCount; ++i) {
            auto& argument = callArguments[i];
            auto value = evaluate(module, argument, overrideValues);
            if (!value)
                return std::nullopt;

            arguments[i] = *value;
        }

        if (function == "array"_s)
            return ConstantArray(WTF::move(arguments));

        if (!function) {
            if (auto* structType = std::get_if<Types::Struct>(expression.inferredType())) {
                HashMap<String, ConstantValue> constantFields;
                for (unsigned i = 0; i < argumentCount; ++i) {
                    auto& argument = arguments[i];
                    auto& member = structType->structure.members()[i];
                    constantFields.set(member.originalName(), argument);
                }
                return ConstantStruct { WTF::move(constantFields) };
            }
            return std::nullopt;
        }

        auto* overload = module.lookupOverload(function);
        if (!overload || !overload->constantFunction)
            return std::nullopt;

        auto result = overload->constantFunction(expression.inferredType(), WTF::move(arguments));
        if (!result)
            return std::nullopt;
        return *result;
    };

    switch (expression.kind()) {
    case AST::NodeKind::BinaryExpression: {
        auto& binary = uncheckedDowncast<AST::BinaryExpression>(expression);
        if (binary.operation() == AST::BinaryOperation::ShortCircuitAnd) {
            auto lhsValue = evaluate(module, binary.leftExpression(), overrideValues);
            if (lhsValue && !std::get<bool>(*lhsValue))
                result = false;
            else {
                auto rhsValue = evaluate(module, binary.rightExpression(), overrideValues);
                if (lhsValue && rhsValue)
                    result = std::get<bool>(*lhsValue) && std::get<bool>(*rhsValue);
            }
        } else if (binary.operation() == AST::BinaryOperation::ShortCircuitOr) {
            auto lhsValue = evaluate(module, binary.leftExpression(), overrideValues);
            if (lhsValue && std::get<bool>(*lhsValue))
                result = true;
            else {
                auto rhsValue = evaluate(module, binary.rightExpression(), overrideValues);
                if (lhsValue && rhsValue)
                    result = std::get<bool>(*lhsValue) || std::get<bool>(*rhsValue);
            }
        } else {
            auto operation = toASCIILiteral(binary.operation());
            result = call(operation, ReferenceWrapperVector<const AST::Expression, 2> { binary.leftExpression(), binary.rightExpression() });
        }
        break;
    }

    case AST::NodeKind::UnaryExpression: {
        auto& unary = uncheckedDowncast<AST::UnaryExpression>(expression);
        auto operation = toASCIILiteral(unary.operation());
        result = call(operation, ReferenceWrapperVector<const AST::Expression, 1> { unary.expression() });
        break;
    }

    case AST::NodeKind::IdentifierExpression: {
        auto it = overrideValues.find(uncheckedDowncast<AST::IdentifierExpression>(expression).identifier());
        if (it != overrideValues.end())
            result = it->value;
        break;
    }

    case AST::NodeKind::CallExpression: {
        auto& callExpression = uncheckedDowncast<AST::CallExpression>(expression);
        result = call(callExpression.resolvedTarget(), callExpression.arguments());
        break;
    }

    case AST::NodeKind::IndexAccessExpression: {
        auto& access = uncheckedDowncast<AST::IndexAccessExpression>(expression);
        auto baseValue = evaluate(module, access.base(), overrideValues);
        auto indexValue = evaluate(module, access.index(), overrideValues);

        if (!baseValue || !indexValue)
            return std::nullopt;

        auto size = baseValue->upperBound();
        auto index = indexValue->integerValue();
        if (index < 0 || static_cast<size_t>(index) >= size) [[unlikely]]
            return std::nullopt;

        result = baseValue.value()[index];
        break;
    }

    case AST::NodeKind::FieldAccessExpression: {
        auto& access = uncheckedDowncast<AST::FieldAccessExpression>(expression);
        auto base = evaluate(module, access.base(), overrideValues);
        const auto& fieldName = access.originalFieldName().id();
        auto length = fieldName.length();

        if (!base)
            break;

        if (auto* constantStruct = std::get_if<ConstantStruct>(&*base)) {
            result = constantStruct->fields.get(fieldName);
            break;
        }

        auto constantVector = std::get<ConstantVector>(*base);
        const auto& constAccess = [&](const ConstantVector& vector, char field) -> ConstantValue {
            switch (field) {
            case 'r':
            case 'x':
                return vector.elements[0];
            case 'g':
            case 'y':
                return vector.elements[1];
            case 'b':
            case 'z':
                return vector.elements[2];
            case 'a':
            case 'w':
                return vector.elements[3];
            default:
                RELEASE_ASSERT_NOT_REACHED();
            };
        };

        if (length == 1) {
            result = constAccess(constantVector, fieldName[0]);
            break;
        }

        ConstantVector resultVector(length);
        for (unsigned i = 0; i < length; ++i)
            resultVector.elements[i] = constAccess(constantVector, fieldName[i]);
        result = resultVector;
        break;
    }

    // Literals
    case AST::NodeKind::AbstractFloatLiteral:
    case AST::NodeKind::AbstractIntegerLiteral:
    case AST::NodeKind::BoolLiteral:
    case AST::NodeKind::Float32Literal:
    case AST::NodeKind::Float16Literal:
    case AST::NodeKind::Signed32Literal:
    case AST::NodeKind::Unsigned32Literal:
        RELEASE_ASSERT(result);
        break;

    default:
        return std::nullopt;
    }

    if (result) {
        if (!convertValueImpl(expression.span(), expression.inferredType(), *result))
            return std::nullopt;
        const_cast<AST::Expression&>(expression).setConstantValue(*result);
    }
    return result;
}

}

#undef CHECK_PASS
#undef RUN_PASS
#undef RUN_PASS_WITH_RESULT
