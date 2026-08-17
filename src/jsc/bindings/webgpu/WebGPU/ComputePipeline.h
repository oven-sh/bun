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

#pragma once

#import "BindGroupLayout.h"
#import "Pipeline.h"
#import "PipelineLayout.h"

#import <wtf/FastMalloc.h>
#import <wtf/HashMap.h>
#import <wtf/HashTraits.h>
#import <wtf/Ref.h>
#import <wtf/RefCountedAndCanMakeWeakPtr.h>
#import <wtf/TZoneMalloc.h>
#import <wtf/WeakPtr.h>

struct WGPUComputePipelineImpl {
};

namespace WebGPU {

class BindGroupLayout;
class Device;
class PipelineLayout;

// https://gpuweb.github.io/gpuweb/#gpucomputepipeline
class ComputePipeline : public RefCountedAndCanMakeWeakPtr<ComputePipeline>, public WGPUComputePipelineImpl {
    WTF_MAKE_TZONE_ALLOCATED(ComputePipeline);
public:
    static Ref<ComputePipeline> create(id<MTLComputePipelineState> computePipelineState, Ref<PipelineLayout>&& pipelineLayout, MTLSize threadsPerThreadgroup, BufferBindingSizesForPipeline&& minimumBufferSizes, uint64_t uniqueId, Device& device)
    {
        return adoptRef(*new ComputePipeline(computePipelineState, WTF::move(pipelineLayout), threadsPerThreadgroup, WTF::move(minimumBufferSizes), uniqueId, device));
    }
    static Ref<ComputePipeline> createInvalid(Device& device)
    {
        return adoptRef(*new ComputePipeline(device));
    }

    ~ComputePipeline();

    Ref<BindGroupLayout> getBindGroupLayout(uint32_t groupIndex);
    void NODELETE setLabel(String&&);

    bool isValid() const { return m_computePipelineState && m_pipelineLayout->isValid(); }

    id<MTLComputePipelineState> computePipelineState() const { return m_computePipelineState; }

    Device& device() const { return m_device; }
    MTLSize threadsPerThreadgroup() const { return m_threadsPerThreadgroup; }

    PipelineLayout& pipelineLayout() const { return m_pipelineLayout; }

    const BufferBindingSizesForBindGroup* NODELETE minimumBufferSizes(uint32_t) const;
    uint64_t uniqueId() const { return m_uniqueId; }
private:
    ComputePipeline(id<MTLComputePipelineState>, Ref<PipelineLayout>&&, MTLSize, BufferBindingSizesForPipeline&&, uint64_t uniqueId, Device&);
    ComputePipeline(Device&);

    const id<MTLComputePipelineState> m_computePipelineState { nil };

    const Ref<Device> m_device;
    const MTLSize m_threadsPerThreadgroup;
    const Ref<PipelineLayout> m_pipelineLayout;
    const BufferBindingSizesForPipeline m_minimumBufferSizes;
    const uint64_t m_uniqueId { 0 };
};

} // namespace WebGPU
