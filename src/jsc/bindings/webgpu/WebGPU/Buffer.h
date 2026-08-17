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
#import "Device.h"
#import "Instance.h"
#import <Metal/Metal.h>
#import <WebGPU/WGPUBufferImpl.h>
#import <WebGPU/WebGPU.h>
#import <WebGPU/WebGPUExt.h>
#import <utility>
#import <wtf/CanBorrow.h>
#import <wtf/Compiler.h>
#import <wtf/CompletionHandler.h>
#import <wtf/FastMalloc.h>
#import <wtf/HashMap.h>
#import <wtf/Range.h>
#import <wtf/RangeSet.h>
#import <wtf/Ref.h>
#import <wtf/RefCountedAndCanMakeWeakPtr.h>
#import <wtf/SwiftBridging.h>
#import <wtf/SwiftCXXThunk.h>
#import <wtf/TZoneMalloc.h>
#import <wtf/WeakPtr.h>

IGNORE_CLANG_WARNINGS_BEGIN("nullability-completeness")

namespace WebGPU {

class CommandBuffer;
class CommandEncoder;
class Device;

// https://gpuweb.github.io/gpuweb/#gpubuffer
class Buffer : public WGPUBufferImpl, public ThreadSafeRefCountedAndCanMakeThreadSafeWeakPtr<Buffer>, public CanBorrow, public TrackedResource {
    WTF_MAKE_TZONE_ALLOCATED(Buffer);
public:
    enum class State : uint8_t;
    struct MappingRange {
        size_t beginOffset; // Inclusive
        size_t endOffset; // Exclusive
    };

    static Ref<Buffer> create(id<MTLBuffer> buffer, uint64_t initialSize, WGPUBufferUsageFlags usage, State initialState, MappingRange initialMappingRange, Device& device)
    {
        return adoptRef(*new Buffer(buffer, initialSize, usage, initialState, initialMappingRange, device));
    }
    static Ref<Buffer> createInvalid(Device& device)
    {
        return adoptRef(*new Buffer(device));
    }

    ~Buffer();

    void destroy();
    std::span<uint8_t> getMappedRange(size_t offset, size_t) HAS_SWIFTCXX_THUNK;
    void bufferCopy(std::span<const uint8_t>, size_t offset);
    void mapAsync(WGPUMapModeFlags, size_t offset, size_t, CompletionHandler<void(WGPUBufferMapAsyncStatus)>&& callback);
    void unmap();
    void setLabel(String&&);
    void generateAValidationError(String&&);

    bool NODELETE isValid() const;

    // https://gpuweb.github.io/gpuweb/#buffer-state
    enum class State : uint8_t {
        Mapped,
        MappedAtCreation,
        MappingPending,
        Unmapped,
        Destroyed,
    };

    id<MTLBuffer> buffer() const { return m_buffer; }
    id<MTLBuffer> NODELETE indirectBuffer() const;
    id<MTLBuffer> indirectIndexedBuffer() const { return m_indirectIndexedBuffer; }

    uint64_t NODELETE initialSize() const;
    uint64_t currentSize() const;
    WGPUBufferUsageFlags usage() const { return m_usage; }
    State state() const { return m_state; }

    Device& device() const { return m_device; }
    bool isDestroyed() const { return state() == State::Destroyed; }

    void setCommandEncoder(CommandEncoder&, bool mayModifyBuffer = false) const;
    std::span<uint8_t> getBufferContents();

    bool NODELETE indirectIndexedBufferRequiresRecomputation(MTLIndexType, NSUInteger indexBufferOffsetInBytes, uint64_t indirectOffset, uint32_t minVertexCount, uint32_t minInstanceCount) const;
    bool NODELETE indirectBufferRequiresRecomputation(uint64_t indirectOffset, uint32_t minVertexCount, uint32_t minInstanceCount) const;

    void NODELETE indirectBufferRecomputed(uint64_t indirectOffset, uint32_t minVertexCount, uint32_t minInstanceCount);
    void NODELETE indirectIndexedBufferRecomputed(MTLIndexType, NSUInteger indexBufferOffsetInBytes, uint64_t indirectOffset, uint32_t minVertexCount, uint32_t minInstanceCount);

    std::optional<DrawIndexCacheContainerIterator> canSkipDrawIndexedValidation(uint32_t firstIndex, uint32_t indexCount, uint32_t vertexCount, MTLIndexType, uint32_t primitiveOffset, id<MTLIndirectCommandBuffer> = nil) const;
    void drawIndexedValidated(uint32_t firstIndex, uint32_t indexCount, uint32_t vertexCount, MTLIndexType, uint32_t primitiveOffset, id<MTLIndirectCommandBuffer> = nil);
    void skippedDrawIndexedValidation(CommandEncoder&, DrawIndexCacheContainerIterator);
    void skippedDrawIndirectIndexedValidation(CommandEncoder&, Buffer*, MTLIndexType, uint32_t indexBufferOffsetInBytes, uint64_t indirectOffset, uint32_t minVertexCount, uint32_t minInstanceCount, MTLPrimitiveType);
    void skippedDrawIndirectValidation(CommandEncoder&, uint64_t indirectOffset, uint32_t minVertexCount, uint32_t minInstanceCount);

    bool didReadOOB(id<MTLIndirectCommandBuffer> = nil) const;
    void didReadOOB(uint32_t v, id<MTLIndirectCommandBuffer> = nil);

    void indirectBufferInvalidated(CommandEncoder* = nullptr);
    void indirectBufferInvalidated(CommandEncoder&);
    void removeSkippedValidationCommandEncoder(uint64_t);
    bool mustTakeSlowIndexValidationPath() const { return m_mustTakeSlowIndexValidationPath; }
    void clearMustTakeSlowIndexValidationPath();
    void takeSlowIndexValidationPath(CommandBuffer&, uint32_t firstIndex, uint32_t indexCount, MTLIndexType, uint32_t primitiveOffset, uint32_t vertexCount);
    bool needsIndexValidation(uint32_t, uint16_t);

private:
    Buffer(id<MTLBuffer>, uint64_t initialSize, WGPUBufferUsageFlags, State initialState, MappingRange initialMappingRange, Device&);
    Buffer(Device&);

    bool validateGetMappedRange(size_t offset, size_t rangeSize) const;
    NSString * _Nullable errorValidatingMapAsync(WGPUMapModeFlags, size_t offset, size_t rangeSize) const;
    bool NODELETE validateUnmap() const;
    void NODELETE setState(State);
    void incrementBufferMapCount();
    void decrementBufferMapCount();
    void takeSlowIndirectIndexValidationPath(CommandBuffer&, Buffer&, MTLIndexType, uint32_t indexBufferOffsetInBytes, uint32_t indirectOffset, uint32_t minVertexCount, MTLPrimitiveType);
    void takeSlowIndirectValidationPath(CommandBuffer&, uint64_t indirectOffset, uint32_t minVertexCount, uint32_t minInstanceCount);

    id<MTLBuffer> m_buffer { nil };
    id<MTLBuffer> _Nullable m_indirectBuffer { nil };
    id<MTLBuffer> _Nullable m_indirectIndexedBuffer { nil };

    // https://gpuweb.github.io/gpuweb/#buffer-interface

    const uint64_t m_initialSize { 0 };
    const WGPUBufferUsageFlags m_usage { 0 };
    State m_state { State::Unmapped };
    // [[mapping]] is unnecessary; we can just use m_device.contents.
    MappingRange m_mappingRange { 0, 0 };
    using MappedRanges = RangeSet<Range<size_t>>;
    MappedRanges m_mappedRanges;
    WGPUMapModeFlags m_mapMode { WGPUMapMode_None };
    uint32_t m_maxUnsignedIndex { 0 };
    uint16_t m_maxUshortIndex { 0 };

    struct IndirectArgsCache {
        uint64_t indirectOffset { UINT64_MAX };
        uint64_t indexBufferOffsetInBytes { UINT64_MAX };
        uint32_t minVertexCount { 0 };
        uint32_t minInstanceCount { 0 };
        MTLIndexType indexType { MTLIndexTypeUInt16 };
        enum {
            NoDraw,
            IndirectDraw,
            IndirectIndexedDraw
        } drawType { NoDraw };
    } m_indirectCache;

    DrawIndexCacheContainer m_drawIndexedCache;

    const Ref<Device> m_device;
    mutable HashMap<uint64_t, uint32_t, DefaultHash<uint64_t>, WTF::UnsignedWithZeroKeyHashTraits<uint64_t>> m_gpuResourceMap;
    HashSet<uint64_t, DefaultHash<uint64_t>, WTF::UnsignedWithZeroKeyHashTraits<uint64_t>> m_skippedValidationCommandEncoders;
    bool m_mustTakeSlowIndexValidationPath { false };
#if CPU(X86_64) && (1 /* PLATFORM(MAC) */ || 0 /* PLATFORM(MACCATALYST) */)
    bool m_mappedAtCreation { false };
#endif
    HashMap<uint64_t, bool, DefaultHash<uint64_t>, WTF::UnsignedWithZeroKeyHashTraits<uint64_t>> m_didReadOOB;
} SWIFT_SHARED_REFERENCE(refBuffer, derefBuffer) SWIFT_PRIVATE_FILEID("WebGPU/Buffer.swift") SWIFT_RETURNED_AS_UNRETAINED_BY_DEFAULT;

} // namespace WebGPU

inline void refBuffer(WebGPU::Buffer* obj)
{
    obj->ref();
}

inline void derefBuffer(WebGPU::Buffer* obj)
{
    obj->deref();
}

IGNORE_CLANG_WARNINGS_END
