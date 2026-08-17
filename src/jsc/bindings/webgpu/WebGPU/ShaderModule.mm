/*
 * Copyright (c) 2021-2023 Apple Inc. All rights reserved.
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

#import "config.h"
#import "ShaderModule.h"

#import "APIConversions.h"
#import "ASTBuiltinAttribute.h"
#import "ASTFunction.h"
#import "ASTStructure.h"
#import "ASTStructureMember.h"
#import "Device.h"
#import "PipelineLayout.h"
#import "Types.h"
#import "WGSLShaderModule.h"

#import <WebGPU/WebGPU.h>
#import <wtf/DataLog.h>
#import <wtf/StringPrintStream.h>
#import <wtf/TZoneMallocInlines.h>

namespace WebGPU {

struct ShaderModuleParameters {
    String wgslCode;
    const WGPUShaderModuleCompilationHint* hints;
};

static std::optional<ShaderModuleParameters> NODELETE findShaderModuleParameters(const WGPUShaderModuleDescriptor& descriptor)
{
    const auto& wgslCode = descriptor.wgslDescriptor;
    const WGPUShaderModuleCompilationHint* hints = descriptor.hints;

    if (!wgslCode)
        return std::nullopt;

    return { { wgslCode, hints } };
}

id<MTLLibrary> ShaderModule::createLibrary(id<MTLDevice> device, const String& msl, String&& label, NSError** error, WGSL::DeviceState&& deviceState)
{
    static bool requireSafeMath = false;
    auto options = [MTLCompileOptions new];
    options.preprocessorMacros = @{ @"__wgslMetalAppleGPUFamily" : [NSString stringWithFormat:@"%u", deviceState.appleGPUFamily] };
#if ENABLE(WEBGPU_BY_DEFAULT)
    static auto mathMode = MTLMathModeRelaxed;
    static auto mathFunctions = MTLMathFloatingPointFunctionsFast;
    static std::once_flag onceFlag;
    std::call_once(onceFlag, [&] {
        requireSafeMath = [[NSUserDefaults standardUserDefaults] boolForKey:@"WebKitWebGPUEnableSafeMath"];
        mathMode = requireSafeMath || [[NSUserDefaults standardUserDefaults] boolForKey:@"WebKitWebGPUEnableSafeMathMode"] ? MTLMathModeSafe : MTLMathModeRelaxed;
        mathFunctions = requireSafeMath || [[NSUserDefaults standardUserDefaults] boolForKey:@"WebKitWebGPUEnablePrecisionMathFunctions"] ? MTLMathFloatingPointFunctionsPrecise : MTLMathFloatingPointFunctionsFast;
    });
    options.mathMode = mathMode;
    options.mathFloatingPointFunctions = mathFunctions;
#else
ALLOW_DEPRECATED_DECLARATIONS_BEGIN
    options.fastMathEnabled = !requireSafeMath;
ALLOW_DEPRECATED_DECLARATIONS_END
#endif

    if (deviceState.usesInvariant)
        options.preserveInvariance = true;

    // FIXME(PERFORMANCE): Run the asynchronous version of this
    id<MTLLibrary> library = [device newLibraryWithSource:msl.createNSString().get() options:options error:error];
    if (error && *error) {
        // FIXME: https://bugs.webkit.org/show_bug.cgi?id=250442
        WTFLogAlways("MSL compilation error: %@", [*error localizedDescription]);
        *error = [NSError errorWithDomain:@"WebGPU" code:1 userInfo:@{ NSLocalizedDescriptionKey: adoptNS([[NSString alloc] initWithFormat:@"Failed to compile the shader source, generated metal:\n%@ - error %@", msl.createNSString().get(), [*error localizedDescription]]).get() }];
        return nil;
    }
    library.label = label.createNSString().get();
    return library;
}

static RefPtr<ShaderModule> earlyCompileShaderModule(Device& device, Variant<WGSL::SuccessfulCheck, WGSL::FailedCheck>&& checkResult, const WGPUShaderModuleDescriptor& suppliedHints, String&& label)
{
    HashMap<String, Ref<PipelineLayout>> hints;
    HashMap<String, WGSL::PipelineLayout*> wgslHints;
    Vector<WGSL::PipelineLayout> wgslPipelineLayouts;
    wgslPipelineLayouts.reserveCapacity(suppliedHints.hintCount);
    for (const auto& hint : suppliedHints.hintsSpan()) {
        auto hintKey = fromAPI(hint.entryPoint);
        Ref layout = WebGPU::fromAPI(hint.layout);
        hints.add(hintKey, layout);
        WGSL::PipelineLayout* convertedPipelineLayout = nullptr;
        if (layout->numberOfBindGroupLayouts()) {
            wgslPipelineLayouts.append(ShaderModule::convertPipelineLayout(layout));
            convertedPipelineLayout = &wgslPipelineLayouts.last();
        }
        wgslHints.add(hintKey, WTF::move(convertedPipelineLayout));
    }

    auto& shaderModule = std::get<WGSL::SuccessfulCheck>(checkResult).ast;
    auto prepareResult = WGSL::prepare(shaderModule, wgslHints);
    if (std::holds_alternative<WGSL::Error>(prepareResult))
        return nullptr;
    auto& result = std::get<WGSL::PrepareResult>(prepareResult);
    HashMap<String, WGSL::ConstantValue> wgslConstantValues;
    auto generationResult = WGSL::generate(shaderModule, result, wgslConstantValues, WGSL::DeviceState {
        .appleGPUFamily = device.appleGPUFamily(),
        .shaderValidationEnabled = device.isShaderValidationEnabled()
    });
    if (std::holds_alternative<WGSL::Error>(generationResult))
        return nullptr;
    auto& msl = std::get<String>(generationResult);
    NSError *error = nil;
    auto library = ShaderModule::createLibrary(device.device(), msl, WTF::move(label), &error, WGSL::DeviceState {
        .appleGPUFamily = device.appleGPUFamily(),
        .shaderValidationEnabled = device.isShaderValidationEnabled()
    });
    if (!library)
        return nullptr;
    return ShaderModule::create(WTF::move(checkResult), WTF::move(hints), WTF::move(result.entryPoints), library, device);
}

static const HashSet<String> buildFeatureSet(const Vector<WGPUFeatureName>& features)
{
    HashSet<String> result;
    for (auto feature : features)
        result.add(wgpuAdapterFeatureName(feature));

    return result;
}

static Ref<ShaderModule> handleShaderSuccessOrFailure(WebGPU::Device &object, Variant<WGSL::SuccessfulCheck, WGSL::FailedCheck> &checkResult, const WGPUShaderModuleDescriptor &descriptor, std::optional<ShaderModuleParameters> &shaderModuleParameters)
{
    if (std::holds_alternative<WGSL::SuccessfulCheck>(checkResult)) {
        if (shaderModuleParameters->hints && descriptor.hintCount) {
            // FIXME: re-enable early compilation later on once deferred compilation is fully implemented
            // https://bugs.webkit.org/show_bug.cgi?id=254258
            UNUSED_PARAM(earlyCompileShaderModule);
        }

        return ShaderModule::create(WTF::move(checkResult), { }, { }, nil, object);
    }

    auto& failedCheck = std::get<WGSL::FailedCheck>(checkResult);
    StringPrintStream message;
    message.print(String::number(failedCheck.errors.size()), " error", failedCheck.errors.size() != 1 ? "s" : "", " generated while compiling the shader:"_s);
    for (const auto& error : failedCheck.errors)
        message.print("\n"_s, error);

    object.generateAValidationError(message.toString());
    return ShaderModule::createInvalid(object, failedCheck);
}

Ref<ShaderModule> Device::createShaderModule(const WGPUShaderModuleDescriptor& descriptor)
{
    if (!isValid())
        return ShaderModule::createInvalid(*this);

    auto shaderModuleParameters = findShaderModuleParameters(descriptor);
    if (!shaderModuleParameters)
        return ShaderModule::createInvalid(*this);

    auto supportedFeatures = buildFeatureSet(m_capabilities.features);
    auto checkResult = WGSL::staticCheck(shaderModuleParameters->wgslCode, std::nullopt, WGSL::Configuration {
        .maxBuffersPlusVertexBuffersForVertexStage = maxBuffersPlusVertexBuffersForVertexStage(),
        .maxBuffersForFragmentStage = maxBuffersForFragmentStage(),
        .maxBuffersForComputeStage = maxBuffersForComputeStage(),
        .maximumCombinedWorkgroupVariablesSize = limits().maxComputeWorkgroupStorageSize,
        .supportedFeatures = WTF::move(supportedFeatures)
    });

    return handleShaderSuccessOrFailure(*this, checkResult, descriptor, shaderModuleParameters);
}

WTF_MAKE_TZONE_ALLOCATED_IMPL(ShaderModule);

auto ShaderModule::convertCheckResult(Variant<WGSL::SuccessfulCheck, WGSL::FailedCheck>&& checkResult) -> CheckResult
{
    return WTF::switchOn(WTF::move(checkResult), [](auto&& check) -> CheckResult {
        return std::forward<decltype(check)>(check);
    });
}

static MTLDataType NODELETE metalDataTypeFromPrimitive(const WGSL::Types::Primitive *primitiveType, int vectorSize = 1)
{
    switch (vectorSize) {
    case 1:
        switch (primitiveType->kind) {
        case WGSL::Types::Primitive::I32:
            return MTLDataTypeInt;
        case WGSL::Types::Primitive::U32:
            return MTLDataTypeUInt;
        case WGSL::Types::Primitive::F16:
            return MTLDataTypeHalf;
        case WGSL::Types::Primitive::F32:
            return MTLDataTypeFloat;
        case WGSL::Types::Primitive::Bool:
            return MTLDataTypeBool;
        default:
            RELEASE_ASSERT_NOT_REACHED();
        }
    case 2:
        switch (primitiveType->kind) {
        case WGSL::Types::Primitive::I32:
            return MTLDataTypeInt2;
        case WGSL::Types::Primitive::U32:
            return MTLDataTypeUInt2;
        case WGSL::Types::Primitive::F16:
            return MTLDataTypeHalf2;
        case WGSL::Types::Primitive::F32:
            return MTLDataTypeFloat2;
        case WGSL::Types::Primitive::Bool:
            return MTLDataTypeBool2;
        default:
            RELEASE_ASSERT_NOT_REACHED();
        }
    case 3:
        switch (primitiveType->kind) {
        case WGSL::Types::Primitive::I32:
            return MTLDataTypeInt3;
        case WGSL::Types::Primitive::U32:
            return MTLDataTypeUInt3;
        case WGSL::Types::Primitive::F16:
            return MTLDataTypeHalf3;
        case WGSL::Types::Primitive::F32:
            return MTLDataTypeFloat3;
        case WGSL::Types::Primitive::Bool:
            return MTLDataTypeBool3;
        default:
            RELEASE_ASSERT_NOT_REACHED();
        }
    case 4:
        switch (primitiveType->kind) {
        case WGSL::Types::Primitive::I32:
            return MTLDataTypeInt4;
        case WGSL::Types::Primitive::U32:
            return MTLDataTypeUInt4;
        case WGSL::Types::Primitive::F16:
            return MTLDataTypeHalf4;
        case WGSL::Types::Primitive::F32:
            return MTLDataTypeFloat4;
        case WGSL::Types::Primitive::Bool:
            return MTLDataTypeBool4;
        default:
            RELEASE_ASSERT_NOT_REACHED();
        }
    default:
        RELEASE_ASSERT_NOT_REACHED();
    }
}

static WGPUVertexFormat NODELETE vertexFormatTypeFromPrimitive(const WGSL::Types::Primitive *primitiveType, int vectorSize)
{
    switch (vectorSize) {
    case 1:
        switch (primitiveType->kind) {
        case WGSL::Types::Primitive::I32:
            return WGPUVertexFormat_Sint32;
        case WGSL::Types::Primitive::U32:
            return WGPUVertexFormat_Uint32;
        case WGSL::Types::Primitive::F16:
            return WGPUVertexFormat_Float32;
        case WGSL::Types::Primitive::F32:
            return WGPUVertexFormat_Float32;
        default:
            RELEASE_ASSERT_NOT_REACHED();
        }
    case 2:
        switch (primitiveType->kind) {
        case WGSL::Types::Primitive::I32:
            return WGPUVertexFormat_Sint32x2;
        case WGSL::Types::Primitive::U32:
            return WGPUVertexFormat_Uint32x2;
        case WGSL::Types::Primitive::F16:
            return WGPUVertexFormat_Float16x2;
        case WGSL::Types::Primitive::F32:
            return WGPUVertexFormat_Float32x2;
        default:
            RELEASE_ASSERT_NOT_REACHED();
        }
    case 3:
        switch (primitiveType->kind) {
        case WGSL::Types::Primitive::I32:
            return WGPUVertexFormat_Sint32x3;
        case WGSL::Types::Primitive::U32:
            return WGPUVertexFormat_Uint32x3;
        case WGSL::Types::Primitive::F16:
            return WGPUVertexFormat_Float16x4;
        case WGSL::Types::Primitive::F32:
            return WGPUVertexFormat_Float32x3;
        default:
            RELEASE_ASSERT_NOT_REACHED();
        }
    case 4:
        switch (primitiveType->kind) {
        case WGSL::Types::Primitive::I32:
            return WGPUVertexFormat_Sint32x4;
        case WGSL::Types::Primitive::U32:
            return WGPUVertexFormat_Uint32x4;
        case WGSL::Types::Primitive::F16:
            return WGPUVertexFormat_Float16x4;
        case WGSL::Types::Primitive::F32:
            return WGPUVertexFormat_Float32x4;
        default:
            RELEASE_ASSERT_NOT_REACHED();
        }
    default:
        RELEASE_ASSERT_NOT_REACHED();
    }
}

static MTLDataType metalDataTypeForStructMember(const WGSL::Type* type)
{
    if (!type)
        return MTLDataTypeNone;

    auto* vectorType = std::get_if<WGSL::Types::Vector>(type);
    auto* primitiveType = std::get_if<WGSL::Types::Primitive>(vectorType ? vectorType->element : type);
    if (!primitiveType)
        return MTLDataTypeNone;

    auto vectorSize = vectorType ? vectorType->size : 1;
    return metalDataTypeFromPrimitive(primitiveType, vectorSize);
}

static WGPUVertexFormat vertexFormatTypeForStructMember(const WGSL::Type* type)
{
    if (!type) {
        RELEASE_ASSERT_NOT_REACHED();
        return WGPUVertexFormat_Undefined;
    }

    auto* vectorType = std::get_if<WGSL::Types::Vector>(type);
    auto* primitiveType = std::get_if<WGSL::Types::Primitive>(vectorType ? vectorType->element : type);
    if (!primitiveType) {
        RELEASE_ASSERT_NOT_REACHED();
        return WGPUVertexFormat_Undefined;
    }

    auto vectorSize = vectorType ? vectorType->size : 1;
    return vertexFormatTypeFromPrimitive(primitiveType, vectorSize);
}

void ShaderModule::populateOutputState(const String& entryPoint, WGSL::Builtin builtIn)
{
    switch (builtIn) {
    case WGSL::Builtin::SampleMask:
        populateShaderModuleState(entryPoint).usesSampleMaskInOutput = true;
        break;
    case WGSL::Builtin::FragDepth:
        populateShaderModuleState(entryPoint).usesFragDepth = true;
        break;
    default:
        break;
    }
}

ShaderModule::FragmentOutputs ShaderModule::parseFragmentReturnType(const WGSL::Type& type, const WGSL::CallGraph::EntryPoint& entryPoint)
{
    ShaderModule::FragmentOutputs fragmentOutputs;
    if (auto* returnPrimitive = std::get_if<WGSL::Types::Primitive>(&type)) {
        fragmentOutputs.add(entryPoint.function.returnTypeLocation().value_or(0), metalDataTypeFromPrimitive(returnPrimitive));
        return fragmentOutputs;
    }
    if (std::get_if<WGSL::Types::Vector>(&type)) {
        fragmentOutputs.add(entryPoint.function.returnTypeLocation().value_or(0), metalDataTypeForStructMember(&type));
        return fragmentOutputs;
    }
    auto* returnStruct = std::get_if<WGSL::Types::Struct>(&type);
    if (!returnStruct)
        return fragmentOutputs;

    for (auto& member : returnStruct->structure.members()) {
        if (member.builtin())
            populateOutputState(entryPoint.originalName, *member.builtin());

        for (auto& attribute : member.attributes()) {
            auto* builtinAttribute = dynamicDowncast<WGSL::AST::BuiltinAttribute>(attribute);
            if (!builtinAttribute)
                continue;
            populateOutputState(entryPoint.originalName, builtinAttribute->builtin());
        }

        if (!member.location() || member.builtin())
            continue;

        auto location = *member.location();
        fragmentOutputs.add(location, metalDataTypeForStructMember(member.type().inferredType()));
    }

    return fragmentOutputs;
}

static ShaderModule::VertexOutputs parseVertexReturnType(const WGSL::Type& type)
{
    ShaderModule::VertexOutputs vertexOutputs;
    if (auto* returnPrimitive = std::get_if<WGSL::Types::Primitive>(&type)) {
        vertexOutputs.add(0, ShaderModule::VertexOutputFragmentInput {
            .dataType = metalDataTypeFromPrimitive(returnPrimitive),
            .interpolation = std::nullopt
        });
        return vertexOutputs;
    }
    if (std::get_if<WGSL::Types::Vector>(&type)) {
        vertexOutputs.add(0, ShaderModule::VertexOutputFragmentInput {
            .dataType = metalDataTypeForStructMember(&type),
            .interpolation = std::nullopt
        });
        return vertexOutputs;
    }
    auto* returnStruct = std::get_if<WGSL::Types::Struct>(&type);
    if (!returnStruct)
        return vertexOutputs;

    for (auto& member : returnStruct->structure.members()) {
        if (!member.location() || member.builtin())
            continue;

        auto location = *member.location();
        vertexOutputs.add(location, ShaderModule::VertexOutputFragmentInput {
            .dataType = metalDataTypeForStructMember(member.type().inferredType()),
            .interpolation = member.interpolation()
        });
    }

    return vertexOutputs;
}

static void populateStageInMap(const WGSL::Type& type, ShaderModule::VertexStageIn& vertexStageIn, const std::optional<unsigned>& optionalLocation)
{
    auto* inputStruct = std::get_if<WGSL::Types::Struct>(&type);
    if (!inputStruct) {
        if (optionalLocation)
            vertexStageIn.add(*optionalLocation, vertexFormatTypeForStructMember(&type));
        return;
    }

    for (auto& member : inputStruct->structure.members()) {
        if (!member.location())
            continue;
        auto location = *member.location();
        auto dataType = vertexFormatTypeForStructMember(member.type().inferredType());
        vertexStageIn.add(location, dataType);
    }
}

const ShaderModule::ShaderModuleState* ShaderModule::shaderModuleState(const String& entryPoint) const
{
    if (auto it = m_usageInformationPerEntryPoint.find(entryPoint); it != m_usageInformationPerEntryPoint.end())
        return &it->value;

    return nullptr;
}

ShaderModule::ShaderModuleState& ShaderModule::populateShaderModuleState(const String& entryPoint)
{
    if (auto it = m_usageInformationPerEntryPoint.find(entryPoint); it != m_usageInformationPerEntryPoint.end())
        return it->value;

    return m_usageInformationPerEntryPoint.add(entryPoint, ShaderModule::ShaderModuleState()).iterator->value;
}

bool ShaderModule::usesFrontFacingInInput(const String& entryPoint) const
{
    if (auto state = shaderModuleState(entryPoint))
        return state->usesFrontFacingInInput;
    return false;
}
bool ShaderModule::usesSampleIndexInInput(const String& entryPoint) const
{
    if (auto state = shaderModuleState(entryPoint))
        return state->usesSampleIndexInInput;
    return false;
}
bool ShaderModule::usesSampleMaskInInput(const String& entryPoint) const
{
    if (auto state = shaderModuleState(entryPoint))
        return state->usesSampleMaskInInput;
    return false;
}

bool ShaderModule::usesSampleMaskInOutput(const String& entryPoint) const
{
    if (auto state = shaderModuleState(entryPoint))
        return state->usesSampleMaskInOutput;
    return false;
}

bool ShaderModule::usesFragDepth(const String& entryPoint) const
{
    if (auto state = shaderModuleState(entryPoint))
        return state->usesFragDepth;
    return false;
}

bool ShaderModule::usesPrimitiveIndexInInput(const String& entryPoint) const
{
    if (auto state = shaderModuleState(entryPoint))
        return state->usesPrimitiveIndexInInput;
    return false;
}

bool ShaderModule::usesSubgroupInvocationIdInInput(const String& entryPoint) const
{
    if (auto state = shaderModuleState(entryPoint))
        return state->usesSubgroupInvocationIdInInput;
    return false;
}

bool ShaderModule::usesSubgroupSizeInInput(const String& entryPoint) const
{
    if (auto state = shaderModuleState(entryPoint))
        return state->usesSubgroupSizeInInput;
    return false;
}

uint32_t ShaderModule::clipDistancesCount(const String& entryPoint) const
{
    if (auto state = shaderModuleState(entryPoint))
        return state->clipDistancesCount;
    return 0;
}

void ShaderModule::populateFragmentInputs(const WGSL::Type& type, ShaderModule::FragmentInputs& fragmentInputs, const String& entryPointName)
{
    auto* inputStruct = std::get_if<WGSL::Types::Struct>(&type);
    if (!inputStruct)
        return;

    for (auto& member : inputStruct->structure.members()) {
        if (member.builtin()) {
            using enum WGSL::Builtin;
            switch (*member.builtin()) {
            case ClipDistances:
                break;
            case FragDepth:
                populateShaderModuleState(entryPointName).usesFragDepth = true;
                break;
            case FrontFacing:
                populateShaderModuleState(entryPointName).usesFrontFacingInInput = true;
                break;
            case GlobalInvocationId:
                break;
            case InstanceIndex:
                break;
            case LocalInvocationId:
                break;
            case LocalInvocationIndex:
                break;
            case NumWorkgroups:
                break;
            case Position:
                break;
            case PrimitiveIndex:
                populateShaderModuleState(entryPointName).usesPrimitiveIndexInInput = true;
                break;
            case SampleIndex:
                populateShaderModuleState(entryPointName).usesSampleIndexInInput = true;
                break;
            case SampleMask:
                populateShaderModuleState(entryPointName).usesSampleMaskInInput = true;
                break;
            case SubgroupInvocationId:
                populateShaderModuleState(entryPointName).usesSubgroupInvocationIdInInput = true;
                break;
            case SubgroupSize:
                populateShaderModuleState(entryPointName).usesSubgroupSizeInInput = true;
                break;
            case SubgroupId:
                break;
            case NumSubgroups:
                break;
            case VertexIndex:
                break;
            case WorkgroupId:
                break;
            }
        }
        if (!member.location())
            continue;
        auto location = *member.location();
        auto dataType = metalDataTypeForStructMember(member.type().inferredType());
        fragmentInputs.add(location, ShaderModule::VertexOutputFragmentInput {
            .dataType = dataType,
            .interpolation = member.interpolation()
        });
    }
}

static ShaderModule::VertexStageIn parseStageIn(const WGSL::AST::Function& function)
{
    ShaderModule::VertexStageIn result;
    for (auto& parameter : function.parameters()) {
        if (parameter.role() != WGSL::AST::ParameterRole::UserDefined)
            continue;

        if (auto* inferredType = parameter.typeName().inferredType())
            populateStageInMap(*inferredType, result, parameter.location());
    }

    return result;
}

ShaderModule::FragmentInputs ShaderModule::parseFragmentInputs(const WGSL::AST::Function& function, const String& entryPointName)
{
    ShaderModule::FragmentInputs result;
    for (auto& parameter : function.parameters()) {
        if (parameter.role() != WGSL::AST::ParameterRole::UserDefined)
            continue;

        if (auto* inferredType = parameter.typeName().inferredType())
            populateFragmentInputs(*inferredType, result, entryPointName);
    }

    return result;
}

ShaderModule::ShaderModule(Variant<WGSL::SuccessfulCheck, WGSL::FailedCheck>&& checkResult, HashMap<String, Ref<PipelineLayout>>&& pipelineLayoutHints, HashMap<String, WGSL::Reflection::EntryPointInformation>&& entryPointInformation, id<MTLLibrary> library, Device& device)
    : m_checkResult(convertCheckResult(WTF::move(checkResult)))
    , m_pipelineLayoutHints(WTF::move(pipelineLayoutHints))
    , m_entryPointInformation(WTF::move(entryPointInformation))
    , m_library(library)
    , m_device(device)
{
    bool allowVertexDefault = true, allowFragmentDefault = true, allowComputeDefault = true;
    if (std::holds_alternative<WGSL::SuccessfulCheck>(m_checkResult)) {
        auto& check = std::get<WGSL::SuccessfulCheck>(m_checkResult);
        for (auto& entryPoint : check.ast->callGraph().entrypoints()) {
            switch (entryPoint.stage) {
            case WGSL::ShaderStage::Vertex: {
                m_stageInTypesForEntryPoint.add(entryPoint.originalName, parseStageIn(entryPoint.function));
                if (auto expression = entryPoint.function.maybeReturnType()) {
                    if (auto* inferredType = expression->inferredType()) {
                        m_vertexReturnTypeForEntryPoint.add(entryPoint.originalName, parseVertexReturnType(*inferredType));

                        // Check for @builtin(clip_distances) in vertex output
                        if (auto* returnStruct = std::get_if<WGSL::Types::Struct>(inferredType)) {
                            for (auto& member : returnStruct->structure.members()) {
                                if (member.builtin() && *member.builtin() == WGSL::Builtin::ClipDistances) {
                                    // Extract the array size from array<f32, N>
                                    if (auto* arrayType = std::get_if<WGSL::Types::Array>(member.type().inferredType())) {
                                        if (auto* size = std::get_if<unsigned>(&arrayType->size))
                                            populateShaderModuleState(entryPoint.originalName).clipDistancesCount = *size;
                                    }
                                    break;
                                }
                            }
                        }
                    }
                }
                if (!allowVertexDefault || m_defaultVertexEntryPoint.length()) {
                    allowVertexDefault = false;
                    m_defaultVertexEntryPoint = emptyString();
                    continue;
                }
                m_defaultVertexEntryPoint = entryPoint.originalName;
            } break;
            case WGSL::ShaderStage::Fragment: {
                m_fragmentInputsForEntryPoint.add(entryPoint.originalName, parseFragmentInputs(entryPoint.function, entryPoint.originalName));
                if (auto expression = entryPoint.function.maybeReturnType()) {
                    if (auto* inferredType = expression->inferredType())
                        m_fragmentReturnTypeForEntryPoint.add(entryPoint.originalName, parseFragmentReturnType(*inferredType, entryPoint));
                }
                if (!allowFragmentDefault || m_defaultFragmentEntryPoint.length()) {
                    allowFragmentDefault = false;
                    m_defaultFragmentEntryPoint = emptyString();
                    continue;
                }
                m_defaultFragmentEntryPoint = entryPoint.originalName;
            } break;
            case WGSL::ShaderStage::Compute: {
                if (!allowComputeDefault || m_defaultComputeEntryPoint.length()) {
                    allowComputeDefault = false;
                    m_defaultComputeEntryPoint = emptyString();
                    continue;
                }
                m_defaultComputeEntryPoint = entryPoint.originalName;
            } break;
            default:
                ASSERT_NOT_REACHED();
                break;
            }
        }
    }
}

const ShaderModule::FragmentInputs* ShaderModule::fragmentInputsForEntryPoint(const String& entryPoint) const
{
    if (auto it = m_fragmentInputsForEntryPoint.find(entryPoint); it != m_fragmentInputsForEntryPoint.end())
        return &it->value;

    return nullptr;
}

const ShaderModule::FragmentOutputs* ShaderModule::fragmentReturnTypeForEntryPoint(const String& entryPoint) const
{
    if (auto it = m_fragmentReturnTypeForEntryPoint.find(entryPoint); it != m_fragmentReturnTypeForEntryPoint.end())
        return &it->value;

    return nullptr;
}

const ShaderModule::VertexOutputs* ShaderModule::vertexReturnTypeForEntryPoint(const String& entryPoint) const
{
    if (auto it = m_vertexReturnTypeForEntryPoint.find(entryPoint); it != m_vertexReturnTypeForEntryPoint.end())
        return &it->value;

    return nullptr;
}

const ShaderModule::VertexStageIn* ShaderModule::stageInTypesForEntryPoint(const String& entryPoint) const
{
    if (!entryPoint.length())
        return nullptr;

    if (auto it = m_stageInTypesForEntryPoint.find(entryPoint); it != m_stageInTypesForEntryPoint.end())
        return &it->value;

    return nullptr;
}

ShaderModule::ShaderModule(Device& device, CheckResult&& checkResult)
    : m_checkResult(WTF::move(checkResult))
    , m_device(device)
{
}

ShaderModule::~ShaderModule() = default;

struct Messages {
    const Vector<WGSL::CompilationMessage>& messages;
    WGPUCompilationMessageType type;
};

struct CompilationMessageData {
    CompilationMessageData(Vector<WGPUCompilationMessage>&& compilationMessages, Vector<String>&& messages)
        : compilationMessages(WTF::move(compilationMessages))
        , messages(WTF::move(messages))
    {
    }

    CompilationMessageData(const CompilationMessageData&) = delete;
    CompilationMessageData(CompilationMessageData&&) = default;

    Vector<WGPUCompilationMessage> compilationMessages;
    Vector<String> messages;
};

static CompilationMessageData convertMessages(const Messages& messages1, const std::optional<Messages>& messages2 = std::nullopt)
{
    Vector<WGPUCompilationMessage> flattenedCompilationMessages;
    Vector<String> flattenedMessages;

    auto populateMessages = [&](const Messages& compilationMessages) {
        for (const auto& compilationMessage : compilationMessages.messages)
            flattenedMessages.append(compilationMessage.message());
    };

    populateMessages(messages1);
    if (messages2)
        populateMessages(*messages2);

    auto populateCompilationMessages = [&](const Messages& compilationMessages, size_t base) {
        for (size_t i = 0; i < compilationMessages.messages.size(); ++i) {
            const auto& compilationMessage = compilationMessages.messages[i];
            flattenedCompilationMessages.append({
                .message = flattenedMessages[i + base],
                .type = compilationMessages.type,
                .lineNum = compilationMessage.lineNumber(),
                .linePos = compilationMessage.lineOffset(),
                .offset = compilationMessage.offset(),
                .length = compilationMessage.length(),
                .utf16LinePos = compilationMessage.lineOffset(),
                .utf16Offset = compilationMessage.offset(),
                .utf16Length = compilationMessage.length(),
            });
        }
    };

    populateCompilationMessages(messages1, 0);
    if (messages2)
        populateCompilationMessages(*messages2, messages1.messages.size());

    return { WTF::move(flattenedCompilationMessages), WTF::move(flattenedMessages) };
}

void ShaderModule::getCompilationInfo(CompletionHandler<void(WGPUCompilationInfoRequestStatus, const WGPUCompilationInfo&)>&& callback)
{
    WTF::switchOn(m_checkResult, [&](const WGSL::SuccessfulCheck& successfulCheck) {
        auto compilationMessageData(convertMessages({ successfulCheck.warnings, WGPUCompilationMessageType_Warning }));
        WGPUCompilationInfo compilationInfo {
            .messageCount = static_cast<uint32_t>(compilationMessageData.compilationMessages.size()),
            .messages = compilationMessageData.compilationMessages.span().data(),
        };
        callback(WGPUCompilationInfoRequestStatus_Success, compilationInfo);
    }, [&](const WGSL::FailedCheck& failedCheck) {
        auto compilationMessageData(convertMessages(
            { failedCheck.errors, WGPUCompilationMessageType_Error },
            { { failedCheck.warnings, WGPUCompilationMessageType_Warning } }));
        WGPUCompilationInfo compilationInfo {
            .messageCount = static_cast<uint32_t>(compilationMessageData.compilationMessages.size()),
            .messages = compilationMessageData.compilationMessages.span().data(),
        };
        callback(WGPUCompilationInfoRequestStatus_Error, compilationInfo);
    }, [&](std::monostate) {
        WGPUCompilationInfo compilationInfo {
            .messageCount = 0u,
            .messages = nullptr,
        };
        callback(WGPUCompilationInfoRequestStatus_Error, compilationInfo);
    });
}

void ShaderModule::setLabel(String&& label)
{
    if (m_library)
        m_library.label = label.createNSString().get();
}

static auto NODELETE wgslBindingType(WGPUBufferBindingType bindingType)
{
    switch (bindingType) {
    case WGPUBufferBindingType_Uniform:
        return WGSL::BufferBindingType::Uniform;
    case WGPUBufferBindingType_Storage:
        return WGSL::BufferBindingType::Storage;
    case WGPUBufferBindingType_ReadOnlyStorage:
        return WGSL::BufferBindingType::ReadOnlyStorage;
    case WGPUBufferBindingType_Undefined:
    case WGPUBufferBindingType_Force32:
        ASSERT_NOT_REACHED("Unexpected buffer bindingType");
        return WGSL::BufferBindingType::Uniform;
    }
}

static auto NODELETE wgslSamplerType(WGPUSamplerBindingType bindingType)
{
    switch (bindingType) {
    case WGPUSamplerBindingType_Filtering:
        return WGSL::SamplerBindingType::Filtering;
    case WGPUSamplerBindingType_Comparison:
        return WGSL::SamplerBindingType::Comparison;
    case WGPUSamplerBindingType_NonFiltering:
        return WGSL::SamplerBindingType::NonFiltering;
    case WGPUSamplerBindingType_Force32:
    case WGPUSamplerBindingType_Undefined:
        ASSERT_NOT_REACHED("Unexpected sampler bindingType");
        return WGSL::SamplerBindingType::Filtering;
    }
}

static auto NODELETE wgslSampleType(WGPUTextureSampleType sampleType)
{
    switch (sampleType) {
    case WGPUTextureSampleType_Sint:
        return WGSL::TextureSampleType::SignedInt;
    case WGPUTextureSampleType_Uint:
        return WGSL::TextureSampleType::UnsignedInt;
    case WGPUTextureSampleType_Depth:
        return WGSL::TextureSampleType::Depth;
    case WGPUTextureSampleType_Float:
        return WGSL::TextureSampleType::Float;
    case WGPUTextureSampleType_UnfilterableFloat:
        return WGSL::TextureSampleType::UnfilterableFloat;
    case WGPUTextureSampleType_Force32:
    case WGPUTextureSampleType_Undefined:
        ASSERT_NOT_REACHED("Unexpected sampleType");
        return WGSL::TextureSampleType::Float;
    }
}

static auto NODELETE wgslViewDimension(WGPUTextureViewDimension viewDimension)
{
    switch (viewDimension) {
    case WGPUTextureViewDimension_Cube:
        return WGSL::TextureViewDimension::Cube;
    case WGPUTextureViewDimension_1D:
        return WGSL::TextureViewDimension::OneDimensional;
    case WGPUTextureViewDimension_2D:
        return WGSL::TextureViewDimension::TwoDimensional;
    case WGPUTextureViewDimension_3D:
        return WGSL::TextureViewDimension::ThreeDimensional;
    case WGPUTextureViewDimension_CubeArray:
        return WGSL::TextureViewDimension::CubeArray;
    case WGPUTextureViewDimension_2DArray:
        return WGSL::TextureViewDimension::TwoDimensionalArray;
    case WGPUTextureViewDimension_Force32:
    case WGPUTextureViewDimension_Undefined:
        ASSERT_NOT_REACHED("Unexpected viewDimension");
        return WGSL::TextureViewDimension::TwoDimensional;
    }
}

static WGSL::StorageTextureAccess NODELETE wgslAccess(WGPUStorageTextureAccess access)
{
    switch (access) {
    case WGPUStorageTextureAccess_WriteOnly:
        return WGSL::StorageTextureAccess::WriteOnly;
    case WGPUStorageTextureAccess_ReadOnly:
        return WGSL::StorageTextureAccess::ReadOnly;
    case WGPUStorageTextureAccess_ReadWrite:
        return WGSL::StorageTextureAccess::ReadWrite;
    case WGPUStorageTextureAccess_Undefined:
    case WGPUStorageTextureAccess_Force32:
        RELEASE_ASSERT_NOT_REACHED();
    }
}

static WGSL::TexelFormat NODELETE wgslFormat(WGPUTextureFormat format)
{
    switch (format) {
    case WGPUTextureFormat_BGRA8Unorm:
        return WGSL::TexelFormat::BGRA8unorm;
    case WGPUTextureFormat_R16Float:
        return WGSL::TexelFormat::R16float;
    case WGPUTextureFormat_R16Sint:
        return WGSL::TexelFormat::R16sint;
    case WGPUTextureFormat_R16Snorm:
        return WGSL::TexelFormat::R16snorm;
    case WGPUTextureFormat_R16Uint:
        return WGSL::TexelFormat::R16uint;
    case WGPUTextureFormat_R16Unorm:
        return WGSL::TexelFormat::R16unorm;
    case WGPUTextureFormat_R32Float:
        return WGSL::TexelFormat::R32float;
    case WGPUTextureFormat_R32Sint:
        return WGSL::TexelFormat::R32sint;
    case WGPUTextureFormat_R32Uint:
        return WGSL::TexelFormat::R32uint;
    case WGPUTextureFormat_R8Sint:
        return WGSL::TexelFormat::R8sint;
    case WGPUTextureFormat_R8Snorm:
        return WGSL::TexelFormat::R8snorm;
    case WGPUTextureFormat_R8Uint:
        return WGSL::TexelFormat::R8uint;
    case WGPUTextureFormat_R8Unorm:
        return WGSL::TexelFormat::R8unorm;
    case WGPUTextureFormat_RG11B10Ufloat:
        return WGSL::TexelFormat::RG11B10ufloat;
    case WGPUTextureFormat_RG16Float:
        return WGSL::TexelFormat::RG16float;
    case WGPUTextureFormat_RG16Sint:
        return WGSL::TexelFormat::RG16sint;
    case WGPUTextureFormat_RG16Snorm:
        return WGSL::TexelFormat::RG16snorm;
    case WGPUTextureFormat_RG16Uint:
        return WGSL::TexelFormat::RG16uint;
    case WGPUTextureFormat_RG16Unorm:
        return WGSL::TexelFormat::RG16unorm;
    case WGPUTextureFormat_RG32Float:
        return WGSL::TexelFormat::RG32float;
    case WGPUTextureFormat_RG32Sint:
        return WGSL::TexelFormat::RG32sint;
    case WGPUTextureFormat_RG32Uint:
        return WGSL::TexelFormat::RG32uint;
    case WGPUTextureFormat_RG8Sint:
        return WGSL::TexelFormat::RG8sint;
    case WGPUTextureFormat_RG8Snorm:
        return WGSL::TexelFormat::RG8snorm;
    case WGPUTextureFormat_RG8Uint:
        return WGSL::TexelFormat::RG8uint;
    case WGPUTextureFormat_RG8Unorm:
        return WGSL::TexelFormat::RG8unorm;
    case WGPUTextureFormat_RGB10A2Uint:
        return WGSL::TexelFormat::RGB10A2uint;
    case WGPUTextureFormat_RGB10A2Unorm:
        return WGSL::TexelFormat::RGB10A2unorm;
    case WGPUTextureFormat_RGBA16Float:
        return WGSL::TexelFormat::RGBA16float;
    case WGPUTextureFormat_RGBA16Sint:
        return WGSL::TexelFormat::RGBA16sint;
    case WGPUTextureFormat_RGBA16Snorm:
        return WGSL::TexelFormat::RGBA16snorm;
    case WGPUTextureFormat_RGBA16Uint:
        return WGSL::TexelFormat::RGBA16uint;
    case WGPUTextureFormat_RGBA16Unorm:
        return WGSL::TexelFormat::RGBA16unorm;
    case WGPUTextureFormat_RGBA32Float:
        return WGSL::TexelFormat::RGBA32float;
    case WGPUTextureFormat_RGBA32Sint:
        return WGSL::TexelFormat::RGBA32sint;
    case WGPUTextureFormat_RGBA32Uint:
        return WGSL::TexelFormat::RGBA32uint;
    case WGPUTextureFormat_RGBA8Sint:
        return WGSL::TexelFormat::RGBA8sint;
    case WGPUTextureFormat_RGBA8Snorm:
        return WGSL::TexelFormat::RGBA8snorm;
    case WGPUTextureFormat_RGBA8Uint:
        return WGSL::TexelFormat::RGBA8uint;
    case WGPUTextureFormat_RGBA8Unorm:
        return WGSL::TexelFormat::RGBA8unorm;
    default:
        ASSERT_NOT_REACHED();
        return WGSL::TexelFormat::BGRA8unorm;
    }
}

static WGSL::BindGroupLayoutEntry::BindingMember convertBindingLayout(const BindGroupLayout::Entry::BindingLayout& bindingLayout)
{
    return WTF::switchOn(bindingLayout, [](const WGPUBufferBindingLayout& bindingLayout) -> WGSL::BindGroupLayoutEntry::BindingMember {
        return WGSL::BufferBindingLayout {
            .type = wgslBindingType(bindingLayout.type),
            .hasDynamicOffset = !!bindingLayout.hasDynamicOffset,
            .minBindingSize = bindingLayout.minBindingSize
        };
    }, [](const WGPUSamplerBindingLayout& bindingLayout) -> WGSL::BindGroupLayoutEntry::BindingMember {
        return WGSL::SamplerBindingLayout {
            .type = wgslSamplerType(bindingLayout.type)
        };
    }, [](const WGPUTextureBindingLayout& bindingLayout) -> WGSL::BindGroupLayoutEntry::BindingMember {
        return WGSL::TextureBindingLayout {
            .sampleType = wgslSampleType(bindingLayout.sampleType),
            .viewDimension = wgslViewDimension(bindingLayout.viewDimension),
            .multisampled = !!bindingLayout.multisampled
        };
    }, [](const WGPUStorageTextureBindingLayout& bindingLayout) -> WGSL::BindGroupLayoutEntry::BindingMember {
        return WGSL::StorageTextureBindingLayout {
            .access = wgslAccess(bindingLayout.access),
            .format = wgslFormat(bindingLayout.format),
            .viewDimension = wgslViewDimension(bindingLayout.viewDimension)
        };
    }, [](const WGPUExternalTextureBindingLayout&) -> WGSL::BindGroupLayoutEntry::BindingMember {
        return WGSL::ExternalTextureBindingLayout {
        };
    });
}

WGSL::PipelineLayout ShaderModule::convertPipelineLayout(const PipelineLayout& pipelineLayout)
{
    Vector<WGSL::BindGroupLayout> bindGroupLayouts;

    uint32_t maxVertexOffset = 0, maxFragmentOffset = 0, maxComputeOffset = 0;
    for (size_t i = 0; i < pipelineLayout.numberOfBindGroupLayouts(); ++i) {
        Ref bindGroupLayout = pipelineLayout.bindGroupLayout(i);
        WGSL::BindGroupLayout wgslBindGroupLayout;
        auto vertexOffset = maxVertexOffset, fragmentOffset = maxFragmentOffset, computeOffset = maxComputeOffset;
        for (auto& entry : bindGroupLayout->entries()) {
            WGSL::BindGroupLayoutEntry wgslEntry;
            wgslEntry.binding = entry.value.binding;
            wgslEntry.visibility = wgslEntry.visibility.fromRaw(entry.value.visibility);
            wgslEntry.bindingMember = convertBindingLayout(entry.value.bindingLayout);
            wgslEntry.vertexArgumentBufferIndex = entry.value.argumentBufferIndices[WebGPU::ShaderStage::Vertex];
            wgslEntry.vertexArgumentBufferSizeIndex = entry.value.bufferSizeArgumentBufferIndices[WebGPU::ShaderStage::Vertex];
            if (entry.value.vertexDynamicOffset) {
                RELEASE_ASSERT(!(entry.value.vertexDynamicOffset.value() % sizeof(uint32_t)));
                wgslEntry.vertexBufferDynamicOffset = (vertexOffset + *entry.value.vertexDynamicOffset) / sizeof(uint32_t);
                maxVertexOffset = std::max<size_t>(maxVertexOffset, *entry.value.vertexDynamicOffset + sizeof(uint32_t) + vertexOffset);
            }
            wgslEntry.fragmentArgumentBufferIndex = entry.value.argumentBufferIndices[WebGPU::ShaderStage::Fragment];
            wgslEntry.fragmentArgumentBufferSizeIndex = entry.value.bufferSizeArgumentBufferIndices[WebGPU::ShaderStage::Fragment];
            if (entry.value.fragmentDynamicOffset) {
                RELEASE_ASSERT(!(entry.value.fragmentDynamicOffset.value() % sizeof(uint32_t)));
                wgslEntry.fragmentBufferDynamicOffset = (fragmentOffset + *entry.value.fragmentDynamicOffset) / sizeof(uint32_t) + RenderBundleEncoder::startIndexForFragmentDynamicOffsets;
                maxFragmentOffset = std::max<size_t>(maxFragmentOffset, *entry.value.fragmentDynamicOffset + sizeof(uint32_t) + fragmentOffset);
            }
            wgslEntry.computeArgumentBufferIndex = entry.value.argumentBufferIndices[WebGPU::ShaderStage::Compute];
            wgslEntry.computeArgumentBufferSizeIndex = entry.value.bufferSizeArgumentBufferIndices[WebGPU::ShaderStage::Compute];
            if (entry.value.computeDynamicOffset) {
                RELEASE_ASSERT(!(entry.value.computeDynamicOffset.value() % sizeof(uint32_t)));
                wgslEntry.computeBufferDynamicOffset = (computeOffset + *entry.value.computeDynamicOffset) / sizeof(uint32_t);
                maxComputeOffset = std::max<size_t>(maxComputeOffset, *entry.value.computeDynamicOffset + sizeof(uint32_t) + computeOffset);
            }
            wgslBindGroupLayout.entries.append(wgslEntry);
        }

        bindGroupLayouts.append(wgslBindGroupLayout);
    }

    return { .bindGroupLayouts = bindGroupLayouts };
}

WGSL::ShaderModule* ShaderModule::ast() const
{
    return WTF::switchOn(m_checkResult, [&](const WGSL::SuccessfulCheck& successfulCheck) -> WGSL::ShaderModule* {
        return successfulCheck.ast.ptr();
    }, [&](const WGSL::FailedCheck&) -> WGSL::ShaderModule* {
        return nullptr;
    }, [](std::monostate) -> WGSL::ShaderModule* {
        ASSERT_NOT_REACHED();
        return nullptr;
    });
}

const PipelineLayout* ShaderModule::pipelineLayoutHint(const String& name) const
{
    auto iterator = m_pipelineLayoutHints.find(name);
    if (iterator == m_pipelineLayoutHints.end())
        return nullptr;
    return iterator->value.ptr();
}

const WGSL::Reflection::EntryPointInformation* ShaderModule::entryPointInformation(const String& name) const
{
    auto iterator = m_entryPointInformation.find(name);
    if (iterator != m_entryPointInformation.end())
        return &iterator->value;

    return nullptr;
}

const String& ShaderModule::defaultVertexEntryPoint() const
{
    return m_defaultVertexEntryPoint;
}

const String& ShaderModule::defaultFragmentEntryPoint() const
{
    return m_defaultFragmentEntryPoint;
}

const String& ShaderModule::defaultComputeEntryPoint() const
{
    return m_defaultComputeEntryPoint;
}

} // namespace WebGPU

#pragma mark WGPU Stubs

void NODELETE wgpuShaderModuleReference(WGPUShaderModule shaderModule)
{
    WebGPU::fromAPI(shaderModule).ref();
}

void wgpuShaderModuleRelease(WGPUShaderModule shaderModule)
{
    WebGPU::fromAPI(shaderModule).deref();
}

void wgpuShaderModuleGetCompilationInfo(WGPUShaderModule shaderModule, WGPUCompilationInfoCallback callback, void * userdata)
{
    protect(WebGPU::fromAPI(shaderModule))->getCompilationInfo([callback, userdata](WGPUCompilationInfoRequestStatus status, const WGPUCompilationInfo& compilationInfo) {
        callback(status, &compilationInfo, userdata);
    });
}

void wgpuShaderModuleGetCompilationInfoWithBlock(WGPUShaderModule shaderModule, WGPUCompilationInfoBlockCallback callback)
{
    protect(WebGPU::fromAPI(shaderModule))->getCompilationInfo([callback = WebGPU::fromAPI(WTF::move(callback))](WGPUCompilationInfoRequestStatus status, const WGPUCompilationInfo& compilationInfo) {
        callback(status, &compilationInfo);
    });
}

void wgpuShaderModuleSetLabel(WGPUShaderModule shaderModule, const char* label)
{
    protect(WebGPU::fromAPI(shaderModule))->setLabel(WebGPU::fromAPI(label));
}

String wgpuAdapterFeatureName(WGPUFeatureName feature)
{
    switch (feature) {
    case WGPUFeatureName_Undefined:
        return emptyString();
    case WGPUFeatureName_DepthClipControl:
        return "depth-clip-control"_s;
    case WGPUFeatureName_Depth32FloatStencil8:
        return "depth32float-stencil8"_s;
    case WGPUFeatureName_TimestampQuery:
        return "timestamp-query"_s;
    case WGPUFeatureName_TextureCompressionBC:
        return "texture-compression-bc"_s;
    case WGPUFeatureName_TextureCompressionBCSliced3D:
        return "texture-compression-bc-sliced-3d"_s;
    case WGPUFeatureName_TextureCompressionETC2:
        return "texture-compression-etc2"_s;
    case WGPUFeatureName_TextureCompressionASTC:
        return "texture-compression-astc"_s;
    case WGPUFeatureName_TextureCompressionASTCSliced3D:
        return "texture-compression-astc-sliced-3d"_s;
    case WGPUFeatureName_IndirectFirstInstance:
        return "indirect-first-instance"_s;
    case WGPUFeatureName_ShaderF16:
        return "shader-f16"_s;
    case WGPUFeatureName_RG11B10UfloatRenderable:
        return "rg11b10ufloat-renderable"_s;
    case WGPUFeatureName_BGRA8UnormStorage:
        return "bgra8unorm-storage"_s;
    case WGPUFeatureName_Float32Filterable:
        return "float32-filterable"_s;
    case WGPUFeatureName_Float32Blendable:
        return "float32-blendable"_s;
    case WGPUFeatureName_ClipDistances:
        return "clip-distances"_s;
    case WGPUFeatureName_PrimitiveIndex:
        return "primitive-index"_s;
    case WGPUFeatureName_DualSourceBlending:
        return "dual-source-blending"_s;
    case WGPUFeatureName_Float16Renderable:
        return "float16-renderable"_s;
    case WGPUFeatureName_Float32Renderable:
        return "float32-renderable"_s;
    case WGPUFeatureName_CoreFeaturesAndLimits:
        return "core-features-and-limits"_s;
    case WGPUFeatureName_TextureFormatsTier1:
        return "texture-formats-tier1"_s;
    case WGPUFeatureName_TextureFormatsTier2:
        return "texture-formats-tier2"_s;
    case WGPUFeatureName_Subgroups:
        return "subgroups"_s;
    case WGPUFeatureName_Force32:
        return emptyString();
    }
}
