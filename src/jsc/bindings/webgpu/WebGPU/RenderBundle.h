/*
 * Copyright (c) 2021-2022 Apple Inc. All rights reserved.
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

#pragma once

#import "BindableResource.h"
#import <wtf/FastMalloc.h>
#import <wtf/HashSet.h>
#import <wtf/Ref.h>
#import <wtf/RefCounted.h>
#import <wtf/TZoneMalloc.h>
#import <wtf/Vector.h>

struct WGPURenderBundleImpl {
};

@interface ResourceUsageAndRenderStage : NSObject
- (instancetype)initWithUsage:(MTLResourceUsage)usage renderStages:(MTLRenderStages)renderStages entryUsage:(OptionSet<WebGPU::BindGroupEntryUsage>)entryUsage binding:(uint32_t)binding resource:(WebGPU::BindGroupEntryUsageData::Resource)resource;

@property (nonatomic) MTLResourceUsage usage;
@property (nonatomic) MTLRenderStages renderStages;
@property (nonatomic) OptionSet<WebGPU::BindGroupEntryUsage> entryUsage;
@property (nonatomic) uint32_t binding;
@property (nonatomic) WebGPU::BindGroupEntryUsageData::Resource resource;
@end

@class RenderBundleICBWithResources;

namespace WebGPU {

class BindGroup;
class Buffer;
class CommandEncoder;
class Device;
class RenderBundleEncoder;
class RenderPassEncoder;
class RenderPipeline;
class TextureOrTextureView;
class TextureView;

// https://gpuweb.github.io/gpuweb/#gpurenderbundle
class RenderBundle : public WGPURenderBundleImpl, public RefCounted<RenderBundle> {
    WTF_MAKE_TZONE_ALLOCATED(RenderBundle);
public:
    using MinVertexCountsContainer = HashMap<uint64_t, IndexBufferAndIndexData, DefaultHash<uint64_t>, WTF::UnsignedWithZeroKeyHashTraits<uint64_t>>;
    using ResourcesContainer = NSMapTable<id<MTLResource>, ResourceUsageAndRenderStage*>;
    static Ref<RenderBundle> create(NSArray<RenderBundleICBWithResources*> *resources, Vector<WebGPU::BindableResources>&& bindableResources, RefPtr<WebGPU::RenderBundleEncoder> encoder, const WGPURenderBundleEncoderDescriptor& descriptor, uint64_t commandCount, bool makeSubmitInvalid, HashSet<RefPtr<const BindGroup>>&& bindGroups, Device& device)
    {
        return adoptRef(*new RenderBundle(resources, WTF::move(bindableResources), encoder, descriptor, commandCount, makeSubmitInvalid, WTF::move(bindGroups), device));
    }
    static Ref<RenderBundle> createInvalid(Device& device, NSString* errorString)
    {
        return adoptRef(*new RenderBundle(device, errorString));
    }

    ~RenderBundle();

    void setLabel(String&&);

    bool NODELETE isValid() const;

    Device& device() const { return m_device; }
    NSArray<RenderBundleICBWithResources*> *renderBundlesResources() const { return m_renderBundlesResources; }

    void replayCommands(RenderPassEncoder&) const;
    void updateMinMaxDepths(float minDepth, float maxDepth);
    bool validateRenderPass(bool depthReadOnly, bool stencilReadOnly, const WGPURenderPassDescriptor&, const Vector<TextureOrTextureView>&, const std::optional<TextureOrTextureView>&) const;
    bool NODELETE validatePipeline(const RenderPipeline*);
    uint64_t NODELETE drawCount() const;
    NSString* NODELETE lastError() const;
    bool NODELETE requiresCommandReplay() const;
    bool NODELETE makeSubmitInvalid() const;
    bool rebindSamplersIfNeeded() const;
    const Vector<WebGPU::BindableResources>& resources() LIFETIME_BOUND { return m_resources; }

private:
    RenderBundle(NSArray<RenderBundleICBWithResources*> *, Vector<WebGPU::BindableResources>&&, RefPtr<RenderBundleEncoder>, const WGPURenderBundleEncoderDescriptor&, uint64_t, bool makeSubmitInvalid, HashSet<RefPtr<const BindGroup>>&&, Device&);
    RenderBundle(Device&, NSString*);

    const Ref<Device> m_device;
    RefPtr<RenderBundleEncoder> m_renderBundleEncoder;
    NSArray<RenderBundleICBWithResources*> *m_renderBundlesResources;
    Vector<WebGPU::BindableResources> m_resources;
    WGPURenderBundleEncoderDescriptor m_descriptor;
    const Vector<WGPUTextureFormat> m_descriptorColorFormats;
    HashSet<RefPtr<const BindGroup>> m_bindGroups;

    NSString* m_lastErrorString { nil };
    uint64_t m_commandCount { 0 };
    float m_minDepth { 0.f };
    float m_maxDepth { 1.f };
    bool m_makeSubmitInvalid { false };
};

} // namespace WebGPU
