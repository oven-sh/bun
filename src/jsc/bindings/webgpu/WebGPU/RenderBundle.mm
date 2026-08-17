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
#import "RenderBundle.h"

#import "APIConversions.h"
#import "BindGroup.h"
#import "TextureOrTextureView.h"
#import <wtf/TZoneMallocInlines.h>

@implementation ResourceUsageAndRenderStage
- (instancetype)initWithUsage:(MTLResourceUsage)usage renderStages:(MTLRenderStages)renderStages entryUsage:(OptionSet<WebGPU::BindGroupEntryUsage>)entryUsage binding:(uint32_t)binding resource:(WebGPU::BindGroupEntryUsageData::Resource)resource
{
    if (!(self = [super init]))
        return nil;

    _usage = usage;
    _renderStages = renderStages;
    _entryUsage = entryUsage;
    _binding = binding;
    _resource = resource;

    return self;
}
@end

namespace WebGPU {

WTF_MAKE_TZONE_ALLOCATED_IMPL(RenderBundle);

RenderBundle::RenderBundle(NSArray<RenderBundleICBWithResources*> *resources, Vector<WebGPU::BindableResources>&& bindableResources, RefPtr<RenderBundleEncoder> encoder, const WGPURenderBundleEncoderDescriptor& descriptor, uint64_t commandCount, bool makeSubmitInvalid, HashSet<RefPtr<const BindGroup>>&& bindGroups, Device& device)
    : m_device(device)
    , m_renderBundleEncoder(encoder)
    , m_renderBundlesResources(resources)
    , m_resources(WTF::move(bindableResources))
    , m_descriptor(descriptor)
    , m_descriptorColorFormats(descriptor.colorFormatsSpan())
    , m_bindGroups(bindGroups)
    , m_commandCount(commandCount)
    , m_makeSubmitInvalid(makeSubmitInvalid)
{
    m_descriptor.colorFormats = m_descriptorColorFormats.size() ? &m_descriptorColorFormats[0] : nullptr;

    ASSERT(m_renderBundleEncoder || m_renderBundlesResources);
}

RenderBundle::RenderBundle(Device& device, NSString* errorString)
    : m_device(device)
    , m_lastErrorString(errorString)
{
}

RenderBundle::~RenderBundle() = default;

bool RenderBundle::isValid() const
{
    return m_renderBundleEncoder || m_renderBundlesResources;
}

void RenderBundle::setLabel(String&& label)
{
    m_renderBundlesResources.firstObject.indirectCommandBuffer.label = label.createNSString().get();
}

void RenderBundle::replayCommands(RenderPassEncoder& renderPassEncoder) const
{
    if (RefPtr renderBundleEncoder = m_renderBundleEncoder)
        renderBundleEncoder->replayCommands(renderPassEncoder);
}

bool RenderBundle::requiresCommandReplay() const
{
    return !!m_renderBundleEncoder.get();
}

void RenderBundle::updateMinMaxDepths(float minDepth, float maxDepth)
{
    if (m_minDepth == minDepth && m_maxDepth == maxDepth)
        return;

    m_minDepth = minDepth;
    m_maxDepth = maxDepth;
    std::array<float, 2> twoFloats = { m_minDepth, m_maxDepth };
    for (RenderBundleICBWithResources* icb in m_renderBundlesResources)
        m_device->getQueue()->writeBuffer(icb.fragmentDynamicOffsetsBuffer, 0, asWritableBytes(std::span(twoFloats)));
}

uint64_t RenderBundle::drawCount() const
{
    return m_commandCount;
}

bool RenderBundle::validateRenderPass(bool depthReadOnly, bool stencilReadOnly, const WGPURenderPassDescriptor& descriptor, const Vector<TextureOrTextureView>& colorAttachmentViews, const std::optional<TextureOrTextureView>& depthStencilView) const
{
    if (depthReadOnly && !m_descriptor.depthReadOnly)
        return false;

    if (stencilReadOnly && !m_descriptor.stencilReadOnly)
        return false;

    if (m_descriptor.colorFormatCount != descriptor.colorAttachmentCount)
        return false;

    auto descriptorColorFormats = m_descriptor.colorFormatsSpan();

    uint32_t defaultRasterSampleCount = 0;
    for (size_t i = 0, colorFormatCount = std::max(descriptor.colorAttachmentCount, m_descriptor.colorFormatCount); i < colorFormatCount; ++i) {
        auto descriptorColorFormat = i < descriptorColorFormats.size() ? descriptorColorFormats[i] : WGPUTextureFormat_Undefined;
        if (i >= descriptor.colorAttachmentCount) {
            if (descriptorColorFormat == WGPUTextureFormat_Undefined)
                continue;
            return false;
        }
        auto& attachmentView = colorAttachmentViews[i];
        if (!attachmentView) {
            if (descriptorColorFormat == WGPUTextureFormat_Undefined)
                continue;
            return false;
        }
        if (descriptorColorFormat != attachmentView.format())
            return false;
        defaultRasterSampleCount = attachmentView.sampleCount();
    }

    if (descriptor.depthStencilAttachment) {
        if (!depthStencilView || !*depthStencilView) {
            if (m_descriptor.depthStencilFormat != WGPUTextureFormat_Undefined)
                return false;
        } else {
            auto& texture = *depthStencilView;
            if (texture.format() != m_descriptor.depthStencilFormat)
                return false;
            defaultRasterSampleCount = texture.sampleCount();
        }
    } else if (m_descriptor.depthStencilFormat != WGPUTextureFormat_Undefined)
        return false;

    if (m_descriptor.sampleCount != defaultRasterSampleCount)
        return false;

    return true;
}

bool RenderBundle::validatePipeline(const RenderPipeline*)
{
    return true;
}

NSString* RenderBundle::lastError() const
{
    return m_lastErrorString;
}

bool RenderBundle::makeSubmitInvalid() const
{
    return m_makeSubmitInvalid;
}

bool RenderBundle::rebindSamplersIfNeeded() const
{
    bool result = true;
    for (RefPtr bindGroup : m_bindGroups)
        result = bindGroup->rebindSamplersIfNeeded() && result;

    return result;
}

} // namespace WebGPU

#pragma mark WGPU Stubs

void NODELETE wgpuRenderBundleReference(WGPURenderBundle renderBundle)
{
    WebGPU::fromAPI(renderBundle).ref();
}

void wgpuRenderBundleRelease(WGPURenderBundle renderBundle)
{
    WebGPU::fromAPI(renderBundle).deref();
}

void wgpuRenderBundleSetLabel(WGPURenderBundle renderBundle, const char* label)
{
    protect(WebGPU::fromAPI(renderBundle))->setLabel(WebGPU::fromAPI(label));
}
