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
#import "ComputePipeline.h"

#import "APIConversions.h"
#import "BindGroupLayout.h"
#import "Device.h"
#import "IsValidToUseWith.h"
#import "Pipeline.h"
#import "PipelineLayout.h"
#import "ShaderModule.h"
#import "WGSL.h"

namespace WebGPU {

static id<MTLComputePipelineState> createComputePipelineState(id<MTLDevice> device, id<MTLFunction> function, const PipelineLayout& pipelineLayout, const MTLSize& size, NSString *label, GPUShaderValidation validationState, String&& shaderSource)
{
    auto computePipelineDescriptor = [MTLComputePipelineDescriptor new];
#if ENABLE(WEBGPU_BY_DEFAULT)
    computePipelineDescriptor.shaderValidation = validationState;
#else
    UNUSED_PARAM(validationState);
#endif

    computePipelineDescriptor.computeFunction = function;
    UNUSED_PARAM(size);
    for (size_t i = 0; i < pipelineLayout.numberOfBindGroupLayouts(); ++i)
        computePipelineDescriptor.buffers[i].mutability = MTLMutabilityImmutable; // Argument buffers are always immutable in WebGPU.
    computePipelineDescriptor.label = label;
    NSError *error = nil;
#if !defined(NDEBUG) || (defined(ENABLE_LIBFUZZER) && ENABLE_LIBFUZZER && defined(ASAN_ENABLED) && ASAN_ENABLED)
    dumpMetalReproCaseComputePSO(WTF::move(shaderSource), function.name);
#else
    UNUSED_PARAM(shaderSource);
#endif
    // FIXME: Run the asynchronous version of this
    id<MTLComputePipelineState> computePipelineState = [device newComputePipelineStateWithDescriptor:computePipelineDescriptor options:MTLPipelineOptionNone reflection:nil error:&error];
#if !defined(NDEBUG) || (defined(ENABLE_LIBFUZZER) && ENABLE_LIBFUZZER && defined(ASAN_ENABLED) && ASAN_ENABLED)
    clearMetalPSORepro();
#endif
    if (error)
        WTFLogAlways("Pipeline state creation error: %@", error);

    return computePipelineState;
}

static std::optional<MTLSize> metalSize(WGSL::ShaderModule& shaderModule, auto workgroupSize, const HashMap<String, WGSL::ConstantValue>& wgslConstantValues)
{
    auto width = WGSL::evaluate(shaderModule, *workgroupSize.width, wgslConstantValues);
    auto height = workgroupSize.height ? WGSL::evaluate(shaderModule, *workgroupSize.height, wgslConstantValues) : 1;
    auto depth = workgroupSize.depth ? WGSL::evaluate(shaderModule, *workgroupSize.depth, wgslConstantValues) : 1;
    if (!width.has_value() || !height.has_value() || !depth.has_value())
        return std::nullopt;

    return MTLSizeMake(width->integerValue(), height->integerValue(), depth->integerValue());
}

static std::pair<Ref<ComputePipeline>, NSString*> returnInvalidComputePipeline(WebGPU::Device &object, bool isAsync, NSString* error = nil)
{
    if (!isAsync)
        object.generateAValidationError(error ?: @"createComputePipeline failed");
    return std::make_pair(ComputePipeline::createInvalid(object), error);
}

std::pair<Ref<ComputePipeline>, NSString*> Device::createComputePipeline(const WGPUComputePipelineDescriptor& descriptor, bool isAsync)
{
    Ref shaderModule = WebGPU::fromAPI(descriptor.compute.module);
    if (!shaderModule->isValid() || &shaderModule->device() != this || !descriptor.layout)
        return returnInvalidComputePipeline(*this, isAsync);

    Ref pipelineLayout = WebGPU::fromAPI(descriptor.layout);
    if (!isValidToUseWithDevice(pipelineLayout.get(), *this))
        return returnInvalidComputePipeline(*this, isAsync, @"GPUDevice.createComputePipeline: Pipeline layout is invalid");

    auto& deviceLimits = limits();
    auto label = fromAPI(descriptor.label).createNSString();
    auto entryPointName = descriptor.compute.entryPoint ? fromAPI(descriptor.compute.entryPoint) : shaderModule->defaultComputeEntryPoint();
    NSError *error;
    BufferBindingSizesForPipeline minimumBufferSizes;
    String shaderSource;
    auto libraryCreationResult = createLibrary(m_device, shaderModule.get(), &pipelineLayout.get(), entryPointName.createNSString().get(), label.get(), descriptor.compute.constantsSpan(), minimumBufferSizes, &error, shaderSource);
    if (!libraryCreationResult || &pipelineLayout->device() != this)
        return returnInvalidComputePipeline(*this, isAsync, error.localizedDescription ?: @"Compute library failed creation");

    auto library = libraryCreationResult->library;
    const auto& wgslConstantValues = libraryCreationResult->wgslConstantValues;
    const auto& entryPointInformation = libraryCreationResult->entryPointInformation;

    if (!std::holds_alternative<WGSL::Reflection::Compute>(entryPointInformation.typedEntryPoint))
        return returnInvalidComputePipeline(*this, isAsync);
    WGSL::Reflection::Compute computeInformation = std::get<WGSL::Reflection::Compute>(entryPointInformation.typedEntryPoint);

    auto function = createFunction(library, entryPointInformation, label.get());
    if (!function || function.functionType != MTLFunctionTypeKernel || entryPointInformation.specializationConstants.size() != wgslConstantValues.size())
        return returnInvalidComputePipeline(*this, isAsync);

    auto evaluatedSize = metalSize(*shaderModule->ast(), computeInformation.workgroupSize, wgslConstantValues);
    if (!evaluatedSize)
        return returnInvalidComputePipeline(*this, isAsync, @"Failed to evaluate overrides");
    auto size = *evaluatedSize;
    if (entryPointInformation.sizeForWorkgroupVariables > deviceLimits.maxComputeWorkgroupStorageSize)
        return returnInvalidComputePipeline(*this, isAsync);

    if (!size.width || size.width > deviceLimits.maxComputeWorkgroupSizeX || !size.height || size.height > deviceLimits.maxComputeWorkgroupSizeY || !size.depth || size.depth > deviceLimits.maxComputeWorkgroupSizeZ || size.width * size.height * size.depth > deviceLimits.maxComputeInvocationsPerWorkgroup)
        return returnInvalidComputePipeline(*this, isAsync);

    if (m_pipelineId == Device::maxPipelines) {
        loseTheDevice(WGPUDeviceLostReason_Undefined);
        return returnInvalidComputePipeline(*this, isAsync, @"too many compute pipelines");
    }
    auto returnFailedPSOCreation = ^{
        generateAnOutOfMemoryError("Compute pipeline failed compilation likely due to being too complex, please reduce its size"_s);
        return returnInvalidComputePipeline(*this, isAsync, @"GPUCompuePipeline could not compile");
    };

    if (pipelineLayout->isAutoLayout() && entryPointInformation.defaultLayout) {
        Vector<Vector<WGPUBindGroupLayoutEntry>> bindGroupEntries;
        if (NSString* error = addPipelineLayouts(bindGroupEntries, entryPointInformation.defaultLayout))
            return returnInvalidComputePipeline(*this, isAsync, error);

        auto generatedPipelineLayout = generatePipelineLayout(bindGroupEntries);
        if (!generatedPipelineLayout->isValid())
            return returnInvalidComputePipeline(*this, isAsync);
        auto computePipelineState = createComputePipelineState(m_device, function, generatedPipelineLayout, size, label.get(), shaderValidationState(), WTF::move(shaderSource));
        if (!computePipelineState)
            return returnFailedPSOCreation();

        return std::make_pair(ComputePipeline::create(computePipelineState, WTF::move(generatedPipelineLayout), size, WTF::move(minimumBufferSizes), ++m_pipelineId, *this), nil);
    }

    auto computePipelineState = createComputePipelineState(m_device, function, pipelineLayout, size, label.get(), shaderValidationState(), WTF::move(shaderSource));
    if (!computePipelineState)
        return returnFailedPSOCreation();

    return std::make_pair(ComputePipeline::create(computePipelineState, WTF::move(pipelineLayout), size, WTF::move(minimumBufferSizes), ++m_pipelineId, *this), nil);
}

void Device::createComputePipelineAsync(const WGPUComputePipelineDescriptor& descriptor, CompletionHandler<void(WGPUCreatePipelineAsyncStatus, Ref<ComputePipeline>&&, String&& message)>&& callback)
{
    auto pipelineAndError = createComputePipeline(descriptor, true);
    if (auto inst = instance(); inst.get()) {
        inst->scheduleWork([pipeline = WTF::move(pipelineAndError.first), callback = WTF::move(callback), protectedThis = protect(*this), error = WTF::move(pipelineAndError.second)]() mutable {
            callback((pipeline->isValid() || protectedThis->isDestroyed()) ? WGPUCreatePipelineAsyncStatus_Success : WGPUCreatePipelineAsyncStatus_ValidationError, WTF::move(pipeline), WTF::move(error));
        });
    } else
        callback(WGPUCreatePipelineAsyncStatus_ValidationError, WTF::move(pipelineAndError.first), WTF::move(pipelineAndError.second));
}

WTF_MAKE_TZONE_ALLOCATED_IMPL(ComputePipeline);

ComputePipeline::ComputePipeline(id<MTLComputePipelineState> computePipelineState, Ref<PipelineLayout>&& pipelineLayout, MTLSize threadsPerThreadgroup, BufferBindingSizesForPipeline&& minimumBufferSizes, uint64_t uniqueId, Device& device)
    : m_computePipelineState(computePipelineState)
    , m_device(device)
    , m_threadsPerThreadgroup(threadsPerThreadgroup)
    , m_pipelineLayout(WTF::move(pipelineLayout))
    , m_minimumBufferSizes(WTF::move(minimumBufferSizes))
    , m_uniqueId(uniqueId)
{
}

ComputePipeline::ComputePipeline(Device& device)
    : m_device(device)
    , m_threadsPerThreadgroup(MTLSizeMake(0, 0, 0))
    , m_pipelineLayout(PipelineLayout::createInvalid(device))
    , m_minimumBufferSizes({ })
{
}

ComputePipeline::~ComputePipeline() = default;

Ref<BindGroupLayout> ComputePipeline::getBindGroupLayout(uint32_t groupIndex)
{
    Ref device = m_device;
    Ref pipelineLayout = m_pipelineLayout;

    if (!isValid()) {
        device->generateAValidationError("getBindGroupLayout: ComputePipeline is invalid"_s);
        pipelineLayout->makeInvalid();
        return BindGroupLayout::createInvalid(device);
    }

    if (groupIndex >= pipelineLayout->numberOfBindGroupLayouts()) {
        if (groupIndex >= device->limits().maxBindGroups) {
            device->generateAValidationError("getBindGroupLayout: groupIndex is out of range"_s);
            pipelineLayout->makeInvalid();
        }
        return BindGroupLayout::createInvalid(device);
    }

    return pipelineLayout->bindGroupLayout(groupIndex);
}

void ComputePipeline::setLabel(String&&)
{
    // MTLComputePipelineState's labels are read-only.
}

const BufferBindingSizesForBindGroup* ComputePipeline::minimumBufferSizes(uint32_t index) const
{
    auto it = m_minimumBufferSizes.find(index);
    return it == m_minimumBufferSizes.end() ? nullptr : &it->value;
}

} // namespace WebGPU

#pragma mark WGPU Stubs

void NODELETE wgpuComputePipelineReference(WGPUComputePipeline computePipeline)
{
    WebGPU::fromAPI(computePipeline).ref();
}

void wgpuComputePipelineRelease(WGPUComputePipeline computePipeline)
{
    WebGPU::fromAPI(computePipeline).deref();
}

WGPUBindGroupLayout wgpuComputePipelineGetBindGroupLayout(WGPUComputePipeline computePipeline, uint32_t groupIndex)
{
    return WebGPU::releaseToAPI(protect(WebGPU::fromAPI(computePipeline))->getBindGroupLayout(groupIndex));
}

void wgpuComputePipelineSetLabel(WGPUComputePipeline computePipeline, const char* label)
{
    WebGPU::fromAPI(computePipeline).setLabel(WebGPU::fromAPI(label));
}
