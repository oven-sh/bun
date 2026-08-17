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
#import "ComputePassEncoder.h"

#import "APIConversions.h"
#import "BindGroup.h"
#import "BindableResource.h"
#import "Buffer.h"
#import "CommandEncoder.h"
#import "ComputePipeline.h"
#import "IsValidToUseWith.h"
#import "Pipeline.h"
#import "QuerySet.h"
#import <wtf/TZoneMallocInlines.h>

namespace WebGPU {

#define RETURN_IF_FINISHED() \
if (!m_parentEncoder->isLocked() || m_parentEncoder->isFinished()) { \
    protect(m_device)->generateAValidationError([NSString stringWithFormat:@"%s: failed as encoding has finished", __PRETTY_FUNCTION__]); \
    m_computeCommandEncoder = nil; \
    return; \
} \
if (!m_computeCommandEncoder || !m_parentEncoder->isValid() || !protect(m_parentEncoder)->encoderIsCurrent(m_computeCommandEncoder)) { \
    m_computeCommandEncoder = nil; \
    return; \
}

WTF_MAKE_TZONE_ALLOCATED_IMPL(ComputePassEncoder);

ComputePassEncoder::ComputePassEncoder(id<MTLComputeCommandEncoder> computeCommandEncoder, const WGPUComputePassDescriptor&, CommandEncoder& parentEncoder, Device& device)
    : m_computeCommandEncoder(computeCommandEncoder)
    , m_device(device)
    , m_parentEncoder(parentEncoder)
{
    protect(m_parentEncoder)->lock(true);
    RELEASE_ASSERT(m_maxDynamicOffsetAtIndex.size() >= m_device->limits().maxBindGroups);
}

ComputePassEncoder::ComputePassEncoder(CommandEncoder& parentEncoder, Device& device, NSString* errorString)
    : m_device(device)
    , m_parentEncoder(parentEncoder)
    , m_lastErrorString(errorString)
{
    protect(m_parentEncoder)->lock(true);
    m_parentEncoder->setLastError(errorString);
    RELEASE_ASSERT(m_maxDynamicOffsetAtIndex.size() >= m_device->limits().maxBindGroups);
}

ComputePassEncoder::~ComputePassEncoder()
{
    if (m_computeCommandEncoder)
        protect(m_parentEncoder)->makeInvalid(@"GPUComputePassEncoder.finish was never called");
    m_computeCommandEncoder = nil;
}

using EntryUsage = OptionSet<BindGroupEntryUsage>;
struct EntryUsageData {
    EntryUsage usage;
    uint32_t bindGroup;
};
using EntryMap = HashMap<uint64_t, EntryUsageData, DefaultHash<uint64_t>, WTF::UnsignedWithZeroKeyHashTraits<uint64_t>>;
using TextureEntryMapContainer = HashMap<const void*, EntryMap>;
using EntryMapContainer = HashMap<const void*, EntryUsage>;
struct BindGroupId {
    uint32_t bindGroup { 0 };
};
static bool addTextureToActiveResources(const void* resourceAddress, id<MTLResource> mtlResource, OptionSet<BindGroupEntryUsage> initialUsage, TextureEntryMapContainer& usagesForResource, BindGroupId bindGroup, uint32_t baseMipLevel, uint32_t baseArrayLayer, WGPUTextureAspect aspect)
{
    UNUSED_PARAM(mtlResource);

    auto mapKey = BindGroup::makeEntryMapKey(baseMipLevel, baseArrayLayer, aspect);
    EntryUsage resourceUsage = initialUsage;
    EntryMap* entryMap = nullptr;
    if (auto it = usagesForResource.find(resourceAddress); it != usagesForResource.end()) {
        entryMap = &it->value;
        if (auto innerIt = it->value.find(mapKey); innerIt != it->value.end()) {
            auto existingUsage = innerIt->value.usage;
            resourceUsage.add(existingUsage);
            if (innerIt->value.bindGroup != bindGroup.bindGroup) {
                if ((initialUsage == BindGroupEntryUsage::StorageTextureWriteOnly && existingUsage == BindGroupEntryUsage::StorageTextureWriteOnly) || (initialUsage == BindGroupEntryUsage::StorageTextureReadWrite && existingUsage == BindGroupEntryUsage::StorageTextureReadWrite))
                    return false;
            }
        } else
            entryMap->set(mapKey, EntryUsageData { .usage = resourceUsage, .bindGroup = bindGroup.bindGroup });
    }

    if (!BindGroup::allowedUsage(resourceUsage))
        return false;

    if (!entryMap) {
        EntryMap entryMap;
        entryMap.set(mapKey, EntryUsageData { .usage = resourceUsage, .bindGroup = bindGroup.bindGroup });
        usagesForResource.set(resourceAddress, entryMap);
    }

    return true;
}
static bool addResourceToActiveResources(const void* resourceAddress, OptionSet<BindGroupEntryUsage> initialUsage, EntryMapContainer& usagesForResource)
{
    EntryUsage resourceUsage = initialUsage;
    if (auto it = usagesForResource.find(resourceAddress); it != usagesForResource.end())
        resourceUsage.add(it->value);

    if (!BindGroup::allowedUsage(resourceUsage))
        return false;

    usagesForResource.set(resourceAddress, resourceUsage);

    return true;
}

static bool addResourceToActiveResources(const TextureView& texture, OptionSet<BindGroupEntryUsage> resourceUsage, BindGroupId bindGroup, auto& usagesForResource)
{
    WGPUTextureAspect textureAspect = texture.aspect();
    if (textureAspect != WGPUTextureAspect_All)
        return addTextureToActiveResources(&texture.apiParentTexture(), texture.parentTexture(), resourceUsage, usagesForResource, bindGroup, texture.baseMipLevel(), texture.baseArrayLayer(), textureAspect);

    return addTextureToActiveResources(&texture.apiParentTexture(), texture.parentTexture(), resourceUsage, usagesForResource, bindGroup, texture.baseMipLevel(), texture.baseArrayLayer(), WGPUTextureAspect_DepthOnly) && addTextureToActiveResources(&texture.apiParentTexture(), texture.parentTexture(), resourceUsage, usagesForResource, bindGroup, texture.baseMipLevel(), texture.baseArrayLayer(), WGPUTextureAspect_StencilOnly);
}

static bool addResourceToActiveResources(const Texture& texture, OptionSet<BindGroupEntryUsage> resourceUsage, BindGroupId bindGroup, auto& usagesForResource)
{
    constexpr uint32_t baseMipLevel = 0;
    constexpr uint32_t baseArrayLayer = 0;
    return addTextureToActiveResources(&texture, texture.texture(), resourceUsage, usagesForResource, bindGroup, baseMipLevel, baseArrayLayer, WGPUTextureAspect_DepthOnly) && addTextureToActiveResources(&texture, texture.texture(), resourceUsage, usagesForResource, bindGroup, baseMipLevel, baseArrayLayer, WGPUTextureAspect_StencilOnly);
}

static bool addResourceToActiveResources(const BindGroupEntryUsageData::Resource& resource, OptionSet<BindGroupEntryUsage> resourceUsage, BindGroupId bindGroup, EntryMapContainer& usagesForResource, TextureEntryMapContainer& textureUsagesForResource, CommandEncoder& parentEncoder)
{
    return WTF::switchOn(resource, [&](const RefPtr<Buffer>& buffer) {
        if (buffer.get()) {
            if (resourceUsage.contains(BindGroupEntryUsage::Storage))
                buffer->indirectBufferInvalidated(parentEncoder);
            return addResourceToActiveResources(buffer.get(), resourceUsage, usagesForResource);
        }
        return true;
    }, [&](const RefPtr<const Texture>& texture) {
        if (texture.get())
            return addResourceToActiveResources(*texture.get(), resourceUsage, bindGroup, textureUsagesForResource);
        return true;
    }, [&](const RefPtr<const TextureView>& textureView) {
        if (textureView.get())
            return addResourceToActiveResources(*textureView.get(), resourceUsage, bindGroup, textureUsagesForResource);
        return true;
    }, [&](const RefPtr<const ExternalTexture>& externalTexture) {
        return addResourceToActiveResources(externalTexture.get(), resourceUsage, usagesForResource);
    });
}

void ComputePassEncoder::executePreDispatchCommands(const Buffer* indirectBuffer)
{
    auto pipeline = m_pipeline;
    if (!pipeline) {
        makeInvalid(@"pipeline is not set prior to dispatch");
        return;
    }

    if (!pipeline->isValid()) {
        makeInvalid(@"pipeline is not valid prior to dispatch");
        return;
    }

    if (NSString *error = protect(pipeline->pipelineLayout())->errorValidatingBindGroupCompatibility(m_bindGroups)) {
        makeInvalid(error);
        return;
    }
    [computeCommandEncoder() setComputePipelineState:pipeline->computePipelineState()];

    EntryMapContainer usagesForResource;
    TextureEntryMapContainer textureUsagesForResource;
    if (indirectBuffer)
        addResourceToActiveResources(indirectBuffer, BindGroupEntryUsage::Input, usagesForResource);

    Ref pipelineLayout = pipeline->pipelineLayout();
    auto pipelineLayoutCount = pipelineLayout->numberOfBindGroupLayouts();
    auto pipelineIdentifier = pipeline->uniqueId();
    for (auto& kvp : m_bindGroups) {
        auto bindGroupIndex = kvp.key;
        Ref group = kvp.value;
        if (group->hasSamplers())
            protect(m_parentEncoder)->rebindSamplersPreCommit(group);

        if (!group->previouslyValidatedBindGroup(bindGroupIndex, pipelineIdentifier, m_maxDynamicOffsetAtIndex[bindGroupIndex])) {
            if (group->makeSubmitInvalid(ShaderStage::Compute, protect(pipelineLayout->optionalBindGroupLayout(bindGroupIndex)).get())) {
                protect(m_parentEncoder)->makeSubmitInvalid();
                return;
            }

            const Vector<uint32_t>* dynamicOffsets = nullptr;
            if (auto it = m_bindGroupDynamicOffsets.find(bindGroupIndex); it != m_bindGroupDynamicOffsets.end())
                dynamicOffsets = &it->value;
            if (NSString* error = errorValidatingBindGroup(group, pipeline->minimumBufferSizes(bindGroupIndex), dynamicOffsets)) {
                makeInvalid(error);
                return;
            }
            group->validatedSuccessfully(bindGroupIndex, pipelineIdentifier, m_maxDynamicOffsetAtIndex[bindGroupIndex]);
        }
        [computeCommandEncoder() setBuffer:group->computeArgumentBuffer() offset:0 atIndex:bindGroupIndex];
    }

    for (auto& kvp : m_bindGroupResources) {
        auto bindGroupIndex = kvp.key;
        if (bindGroupIndex >= pipelineLayoutCount)
            continue;

        Ref bindGroupLayout = pipelineLayout->bindGroupLayout(bindGroupIndex);
        for (auto* bindGroupResources : kvp.value) {
            for (size_t i = 0, sz = bindGroupResources->mtlResources.size(); i < sz; ++i) {
                auto& usageData = bindGroupResources->resourceUsages[i];
                constexpr ShaderStage shaderStages[] = { ShaderStage::Vertex, ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Undefined };
                std::optional<BindGroupLayout::StageMapValue> bindingAccess;
                for (auto shaderStage : shaderStages) {
                    bindingAccess = bindGroupLayout->bindingAccessForBindingIndex(usageData.binding, shaderStage);
                    if (bindingAccess)
                        break;
                }
                if (!bindingAccess)
                    continue;

                if (!addResourceToActiveResources(usageData.resource, usageData.usage, BindGroupId { bindGroupIndex }, usagesForResource, textureUsagesForResource, protect(m_parentEncoder))) {
                    makeInvalid(@"GPUComputePassEncoder.executePreDispatchCommands - could not track resource");
                    return;
                }
            }
        }
    }

    m_bindGroupResources.clear();

    if (!m_computeDynamicOffsets.size())
        return;

    for (auto& kvp : m_bindGroupDynamicOffsets) {
        Ref pipelineLayout = pipeline->pipelineLayout();
        auto bindGroupIndex = kvp.key;
        if (!pipelineLayout->updateComputeOffsets(bindGroupIndex, kvp.value, m_computeDynamicOffsets)) {
            makeInvalid(@"Invalid offset calculation");
            return;
        }
    }

    if (m_computeDynamicOffsets != m_priorComputeDynamicOffsets) {
        [computeCommandEncoder() setBytes:&m_computeDynamicOffsets[0] length:m_computeDynamicOffsets.size() * sizeof(m_computeDynamicOffsets[0]) atIndex:m_device->maxBuffersForComputeStage()];
        m_priorComputeDynamicOffsets = m_computeDynamicOffsets;
    }
}

void ComputePassEncoder::dispatch(uint32_t x, uint32_t y, uint32_t z)
{
    RETURN_IF_FINISHED();
    executePreDispatchCommands();
    auto dimensionMax = m_device->limits().maxComputeWorkgroupsPerDimension;
    if (x > dimensionMax || y > dimensionMax || z > dimensionMax) {
        makeInvalid([NSString stringWithFormat:@"x(%u) > dimensionMax(%u) || y(%u) > dimensionMax(%u) || z(%u) > dimensionMax(%u)", x, dimensionMax, y, dimensionMax, z, dimensionMax]);
        return;
    }

    if (!(x * y * z))
        return;

    [computeCommandEncoder() dispatchThreadgroups:MTLSizeMake(x, y, z) threadsPerThreadgroup:m_threadsPerThreadgroup];
}

id<MTLBuffer> ComputePassEncoder::runPredispatchIndirectCallValidation(const Buffer& indirectBuffer, uint64_t indirectOffset)
{
    static id<MTLFunction> function = [this] {
        id<MTLDevice> mtlDevice = m_device->device();
        auto dimensionMax = m_device->limits().maxComputeWorkgroupsPerDimension;
        MTLCompileOptions* options = [MTLCompileOptions new];
        ALLOW_DEPRECATED_DECLARATIONS_BEGIN
        options.fastMathEnabled = YES;
        ALLOW_DEPRECATED_DECLARATIONS_END
        NSError *error = nil;
        id<MTLLibrary> library = [mtlDevice newLibraryWithSource:[NSString stringWithFormat:@"[[kernel]] void csDispatchClamp(device const uint* indirectBuffer, device uint* dispatchCallBuffer, uint index [[thread_position_in_grid]]) { dispatchCallBuffer[index] = metal::select(indirectBuffer[index], 0u, indirectBuffer[index] > %u); }", dimensionMax] options:options error:&error];
        if (error)
            WTFLogAlways("%@", error); // NOLINT

        return [library newFunctionWithName:@"csDispatchClamp"];
    }();
    RELEASE_ASSERT(function);

    auto device = m_device;
    id<MTLComputePipelineState> computePipelineState = device->dispatchCallPipelineState(function);
    id<MTLBuffer> dispatchCallBuffer = device->dispatchCallBuffer();
    [computeCommandEncoder() setComputePipelineState:computePipelineState];
    [computeCommandEncoder() setBuffer:indirectBuffer.buffer() offset:indirectOffset atIndex:0];
    [computeCommandEncoder() setBuffer:dispatchCallBuffer offset:0 atIndex:1];
    [computeCommandEncoder() dispatchThreads:MTLSizeMake(3, 1, 1) threadsPerThreadgroup:MTLSizeMake(3, 1, 1)];
    return dispatchCallBuffer;
}

void ComputePassEncoder::dispatchIndirect(const Buffer& indirectBuffer, uint64_t indirectOffset)
{
    RETURN_IF_FINISHED();
    if (!isValidToUseWith(indirectBuffer, *this)) {
        makeInvalid(@"GPUComputePassEncoder.dispatchIndirect: indirectBuffer is not valid to use with this GPUComputePassEncoder");
        return;
    }

    auto indirectOffsetSum = checkedSum<uint64_t>(indirectOffset, 3 * sizeof(uint32_t));
    if ((indirectOffset % 4) || !(indirectBuffer.usage() & WGPUBufferUsage_Indirect) || indirectOffsetSum.hasOverflowed() || (indirectOffsetSum.value() > indirectBuffer.initialSize())) {
        makeInvalid([NSString stringWithFormat:@"GPUComputePassEncoder.dispatchIndirect: (indirectOffset(%llu) mod 4) || !(indirectBuffer.usage(%u) & WGPUBufferUsage_Indirect(%u)) || indirectOffsetSum.hasOverflowed(%d) || (indirectOffsetSum(%llu) > indirectBuffer.initialSize(%llu))", indirectOffset, indirectBuffer.usage(), WGPUBufferUsage_Indirect, indirectOffsetSum.hasOverflowed(), indirectOffsetSum.hasOverflowed() ? 0 : indirectOffsetSum.value(), indirectBuffer.initialSize()]);
        return;
    }

    indirectBuffer.setCommandEncoder(m_parentEncoder);
    if (indirectBuffer.isDestroyed())
        return;

    if (id<MTLBuffer> dispatchBuffer = runPredispatchIndirectCallValidation(indirectBuffer, indirectOffset)) {
        executePreDispatchCommands(&indirectBuffer);
        [computeCommandEncoder() dispatchThreadgroupsWithIndirectBuffer:dispatchBuffer indirectBufferOffset:0 threadsPerThreadgroup:m_threadsPerThreadgroup];
    } else
        makeInvalid(@"GPUComputePassEncoder.dispatchWorkgroupsIndirect: Unable to validate dispatch size");
}

void ComputePassEncoder::endPass()
{
    if (m_passEnded) {
        protect(m_device)->generateAValidationError([NSString stringWithFormat:@"%s: failed as pass is already ended", __PRETTY_FUNCTION__]);
        return;
    }
    m_passEnded = true;

    RETURN_IF_FINISHED();

    auto parentEncoder = m_parentEncoder;

    auto passIsValid = isValid();
    if (m_debugGroupStackSize || !passIsValid) {
        parentEncoder->endEncoding(m_computeCommandEncoder);
        m_computeCommandEncoder = nil;
        parentEncoder->makeInvalid([NSString stringWithFormat:@"ComputePassEncoder.endPass failure, m_debugGroupStackSize = %llu, isValid = %d, error = %@", m_debugGroupStackSize, passIsValid, m_lastErrorString]);
        return;
    }

    parentEncoder->endEncoding(m_computeCommandEncoder);
    m_computeCommandEncoder = nil;
    parentEncoder->lock(false);
}

void ComputePassEncoder::insertDebugMarker(String&& markerLabel)
{
    RETURN_IF_FINISHED();
    // https://gpuweb.github.io/gpuweb/#dom-gpudebugcommandsmixin-insertdebugmarker

    if (!prepareTheEncoderState())
        return;

    [m_computeCommandEncoder insertDebugSignpost:markerLabel.createNSString().get()];
}

bool ComputePassEncoder::validatePopDebugGroup() const
{
    if (!m_parentEncoder->isLocked())
        return false;

    if (!m_debugGroupStackSize)
        return false;

    return true;
}

void ComputePassEncoder::makeInvalid(NSString* errorString)
{
    m_lastErrorString = errorString;

    auto parentEncoder = m_parentEncoder;

    if (!m_computeCommandEncoder) {
        parentEncoder->makeInvalid(@"RenderPassEncoder.makeInvalid");
        return;
    }

    parentEncoder->setLastError(errorString);
    parentEncoder->endEncoding(m_computeCommandEncoder);
    m_computeCommandEncoder = nil;
}

void ComputePassEncoder::popDebugGroup()
{
    RETURN_IF_FINISHED();
    // https://gpuweb.github.io/gpuweb/#dom-gpudebugcommandsmixin-popdebuggroup

    if (!prepareTheEncoderState())
        return;

    if (!validatePopDebugGroup()) {
        makeInvalid();
        return;
    }

    --m_debugGroupStackSize;
    [m_computeCommandEncoder popDebugGroup];
}

void ComputePassEncoder::pushDebugGroup(String&& groupLabel)
{
    RETURN_IF_FINISHED();
    // https://gpuweb.github.io/gpuweb/#dom-gpudebugcommandsmixin-pushdebuggroup

    if (!prepareTheEncoderState())
        return;

    ++m_debugGroupStackSize;
    [m_computeCommandEncoder pushDebugGroup:groupLabel.createNSString().get()];
}

static void setCommandEncoder(const BindGroupEntryUsageData::Resource& resource, CommandEncoder& parentEncoder)
{
    WTF::switchOn(resource, [&](const RefPtr<Buffer>& buffer) {
        if (buffer)
            buffer->setCommandEncoder(parentEncoder);
        }, [&](const RefPtr<const Texture>& texture) {
            if (texture)
                texture->setCommandEncoder(parentEncoder);
        }, [&](const RefPtr<const TextureView>& textureView) {
            if (textureView)
                textureView->setCommandEncoder(parentEncoder);
        }, [&](const RefPtr<const ExternalTexture>& externalTexture) {
            if (externalTexture)
                externalTexture->setCommandEncoder(parentEncoder);
    });
}

void ComputePassEncoder::setBindGroup(uint32_t groupIndex, const BindGroup* groupPtr, std::optional<Vector<uint32_t>>&& dynamicOffsets)
{
    RETURN_IF_FINISHED();

    auto dynamicOffsetCount = (groupPtr && groupPtr->bindGroupLayout()) ? groupPtr->bindGroupLayout()->dynamicBufferCount() : 0;
    if (groupIndex >= m_device->limits().maxBindGroups || (dynamicOffsets && dynamicOffsetCount != dynamicOffsets->size())) {
        makeInvalid(@"GPUComputePassEncoder.setBindGroup: groupIndex >= limits.maxBindGroups");
        return;
    }

    if (!groupPtr) {
        m_bindGroups.remove(groupIndex);
        m_bindGroupResources.remove(groupIndex);
        m_bindGroupDynamicOffsets.remove(groupIndex);
        m_maxDynamicOffsetAtIndex[groupIndex] = 0;
        return;
    }

    auto& group = *groupPtr;
    if (!isValidToUseWith(group, *this)) {
        makeInvalid(@"GPUComputePassEncoder.setBindGroup: invalid bind group");
        return;
    }

    RefPtr bindGroupLayout = group.bindGroupLayout();
    if (!bindGroupLayout) {
        makeInvalid(@"GPUComputePassEncoder.setBindGroup: bind group is nil");
        return;
    }
    if (NSString* error = bindGroupLayout->errorValidatingDynamicOffsets(dynamicOffsets ? dynamicOffsets->span() : std::span<const uint32_t> { }, group, m_maxDynamicOffsetAtIndex[groupIndex])) {
        makeInvalid([NSString stringWithFormat:@"GPUComputePassEncoder.setBindGroup: %@", error]);
        return;
    }

    if (dynamicOffsets && dynamicOffsets->size()) {
        m_bindGroupDynamicOffsets.set(groupIndex, WTF::move(*dynamicOffsets));
        m_maxDynamicOffsetAtIndex[groupIndex] = 0;
    } else if (m_bindGroupDynamicOffsets.remove(groupIndex))
        m_maxDynamicOffsetAtIndex[groupIndex] = 0;

    Vector<const BindableResources*> resourceList;
    for (const auto& resource : group.resources()) {
        if (resource.renderStages == BindGroup::MTLRenderStageCompute && resource.mtlResources.size())
            [computeCommandEncoder() useResources:&resource.mtlResources[0] count:resource.mtlResources.size() usage:resource.usage];

        ASSERT(resource.mtlResources.size() == resource.resourceUsages.size());
        resourceList.append(&resource);
        ASSERT(resource.mtlResources.size() == resource.resourceUsages.size());
        for (size_t i = 0, sz = resource.mtlResources.size(); i < sz; ++i) {
            auto& resourceUsage = resource.resourceUsages[i];
            setCommandEncoder(resourceUsage.resource, m_parentEncoder);
        }
    }

    m_bindGroupResources.set(groupIndex, resourceList);
    m_bindGroups.set(groupIndex, group);
}

void ComputePassEncoder::setPipeline(const ComputePipeline& pipeline)
{
    RETURN_IF_FINISHED();
    if (!isValidToUseWith(pipeline, *this)) {
        makeInvalid(@"GPUComputePipeline is invalid to use with this GPUComputePassEncoder");
        return;
    }

    m_pipeline = pipeline;
    m_computeDynamicOffsets.fill(0, protect(m_pipeline->pipelineLayout())->sizeOfComputeDynamicOffsets());
    m_maxDynamicOffsetAtIndex.fill(0);

    ASSERT(pipeline.computePipelineState());
    m_threadsPerThreadgroup = pipeline.threadsPerThreadgroup();
}

void ComputePassEncoder::setLabel(String&& label)
{
    m_computeCommandEncoder.label = label.createNSString().get();
}

bool ComputePassEncoder::isValid() const
{
    return m_computeCommandEncoder;
}

id<MTLComputeCommandEncoder> ComputePassEncoder::computeCommandEncoder() const
{
    return m_parentEncoder->submitWillBeInvalid() ? nil : m_computeCommandEncoder;
}

#undef RETURN_IF_FINISHED

} // namespace WebGPU

#pragma mark WGPU Stubs

void NODELETE wgpuComputePassEncoderReference(WGPUComputePassEncoder computePassEncoder)
{
    WebGPU::fromAPI(computePassEncoder).ref();
}

void wgpuComputePassEncoderRelease(WGPUComputePassEncoder computePassEncoder)
{
    WebGPU::fromAPI(computePassEncoder).deref();
}

void wgpuComputePassEncoderDispatchWorkgroups(WGPUComputePassEncoder computePassEncoder, uint32_t x, uint32_t y, uint32_t z)
{
    protect(WebGPU::fromAPI(computePassEncoder))->dispatch(x, y, z);
}

void wgpuComputePassEncoderDispatchWorkgroupsIndirect(WGPUComputePassEncoder computePassEncoder, WGPUBuffer indirectBuffer, uint64_t indirectOffset)
{
    protect(WebGPU::fromAPI(computePassEncoder))->dispatchIndirect(protect(WebGPU::fromAPI(indirectBuffer)), indirectOffset);
}

void wgpuComputePassEncoderEnd(WGPUComputePassEncoder computePassEncoder)
{
    protect(WebGPU::fromAPI(computePassEncoder))->endPass();
}

void wgpuComputePassEncoderInsertDebugMarker(WGPUComputePassEncoder computePassEncoder, const char* markerLabel)
{
    protect(WebGPU::fromAPI(computePassEncoder))->insertDebugMarker(WebGPU::fromAPI(markerLabel));
}

void wgpuComputePassEncoderPopDebugGroup(WGPUComputePassEncoder computePassEncoder)
{
    protect(WebGPU::fromAPI(computePassEncoder))->popDebugGroup();
}

void wgpuComputePassEncoderPushDebugGroup(WGPUComputePassEncoder computePassEncoder, const char* groupLabel)
{
    protect(WebGPU::fromAPI(computePassEncoder))->pushDebugGroup(WebGPU::fromAPI(groupLabel));
}

void wgpuComputePassEncoderSetBindGroup(WGPUComputePassEncoder computePassEncoder, uint32_t groupIndex, WGPUBindGroup group, std::optional<Vector<uint32_t>>&& dynamicOffsets)
{
    protect(WebGPU::fromAPI(computePassEncoder))->setBindGroup(groupIndex, group ? protect(WebGPU::fromAPI(group)).ptr() : nullptr, WTF::move(dynamicOffsets));
}

void wgpuComputePassEncoderSetPipeline(WGPUComputePassEncoder computePassEncoder, WGPUComputePipeline pipeline)
{
    protect(WebGPU::fromAPI(computePassEncoder))->setPipeline(protect(WebGPU::fromAPI(pipeline)));
}

void wgpuComputePassEncoderSetLabel(WGPUComputePassEncoder computePassEncoder, const char* label)
{
    protect(WebGPU::fromAPI(computePassEncoder))->setLabel(WebGPU::fromAPI(label));
}
