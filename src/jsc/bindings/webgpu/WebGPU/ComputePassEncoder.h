/*
 * Copyright (c) 2021-2025 Apple Inc. All rights reserved.
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

#import "CommandEncoder.h"
#import "CommandsMixin.h"
#import <WebGPU/WebGPU.h>
#import <WebGPU/WebGPUExt.h>
#import <wtf/FastMalloc.h>
#import <wtf/HashMap.h>
#import <wtf/Ref.h>
#import <wtf/RefCounted.h>
#import <wtf/SwiftBridging.h>
#import <wtf/TZoneMalloc.h>
#import <wtf/Vector.h>
#import <wtf/WeakPtr.h>

struct WGPUComputePassEncoderImpl {
};

namespace WebGPU {

class BindGroup;
class Buffer;
class ComputePipeline;
class Device;
class QuerySet;

struct BindableResources;

// https://gpuweb.github.io/gpuweb/#gpucomputepassencoder
class ComputePassEncoder : public WGPUComputePassEncoderImpl, public RefCounted<ComputePassEncoder>, public CommandsMixin {
    WTF_MAKE_TZONE_ALLOCATED(ComputePassEncoder);
public:
    static Ref<ComputePassEncoder> create(id<MTLComputeCommandEncoder> computeCommandEncoder, const WGPUComputePassDescriptor& descriptor, CommandEncoder& parentEncoder, Device& device)
    {
        return adoptRef(*new ComputePassEncoder(computeCommandEncoder, descriptor, parentEncoder, device));
    }
    static Ref<ComputePassEncoder> createInvalid(CommandEncoder& parentEncoder, Device& device, NSString* errorString)
    {
        return adoptRef(*new ComputePassEncoder(parentEncoder, device, errorString));
    }

    ~ComputePassEncoder();

    void dispatch(uint32_t x, uint32_t y, uint32_t z);
    void dispatchIndirect(const Buffer& indirectBuffer, uint64_t indirectOffset);
    void endPass();
    void insertDebugMarker(String&& markerLabel);
    void popDebugGroup();
    void pushDebugGroup(String&& groupLabel);

    void setBindGroup(uint32_t groupIndex, const BindGroup*, std::optional<Vector<uint32_t>>&& dynamicOffsets);
    void setPipeline(const ComputePipeline&);
    void setLabel(String&&);

    Device& device() const { return m_device; }

    bool NODELETE isValid() const;
    id<MTLComputeCommandEncoder> NODELETE computeCommandEncoder() const;

private:
    ComputePassEncoder(id<MTLComputeCommandEncoder>, const WGPUComputePassDescriptor&, CommandEncoder&, Device&);
    ComputePassEncoder(CommandEncoder&, Device&, NSString*);

    bool NODELETE validatePopDebugGroup() const;

    void makeInvalid(NSString* = nil);
    void executePreDispatchCommands(const Buffer* = nullptr);
    id<MTLBuffer> runPredispatchIndirectCallValidation(const Buffer&, uint64_t);

    id<MTLComputeCommandEncoder> m_computeCommandEncoder { nil };

    uint64_t m_debugGroupStackSize { 0 };

    const Ref<Device> m_device;
    MTLSize m_threadsPerThreadgroup;
    Vector<uint32_t> m_computeDynamicOffsets;
    Vector<uint32_t> m_priorComputeDynamicOffsets;
    RefPtr<const ComputePipeline> m_pipeline;
    const Ref<CommandEncoder> m_parentEncoder;
    HashMap<uint32_t, Vector<uint32_t>, DefaultHash<uint32_t>, WTF::UnsignedWithZeroKeyHashTraits<uint32_t>> m_bindGroupDynamicOffsets;
    HashMap<uint32_t, Vector<const BindableResources*>, DefaultHash<uint32_t>, WTF::UnsignedWithZeroKeyHashTraits<uint32_t>> m_bindGroupResources;
    HashMap<uint32_t, Ref<const BindGroup>, DefaultHash<uint32_t>, WTF::UnsignedWithZeroKeyHashTraits<uint32_t>> m_bindGroups;
    std::array<uint32_t, 32> m_maxDynamicOffsetAtIndex;
    NSString *m_lastErrorString { nil };
    bool m_passEnded { false };
} SWIFT_SHARED_REFERENCE(refComputePassEncoder, derefComputePassEncoder) SWIFT_RETURNED_AS_UNRETAINED_BY_DEFAULT;


} // namespace WebGPU

inline void refComputePassEncoder(WebGPU::ComputePassEncoder* obj)
{
    obj->ref();
}

inline void derefComputePassEncoder(WebGPU::ComputePassEncoder* obj)
{
    obj->deref();
}
