/*
 * Copyright (c) 2022 Apple Inc. All rights reserved.
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

#import <Metal/Metal.h>
#import <limits>
#import <type_traits>
#import <utility>
#import <wtf/GenericHashKey.h>
#import <wtf/HashFunctions.h>
#import <wtf/HashMap.h>
#import <wtf/HashSet.h>
#import <wtf/Hasher.h>
#import <wtf/OptionSet.h>
#import <wtf/RefPtr.h>
#import <wtf/Variant.h>
#import <wtf/Vector.h>
#import <wtf/WeakPtr.h>

namespace WebGPU {

class Buffer;
class ExternalTexture;
class Texture;
class TextureView;

enum class BindGroupEntryUsage {
    Undefined = 0,
    Input = 1 << 0,
    Constant = 1 << 1,
    Storage = 1 << 2,
    StorageRead = 1 << 3,
    Attachment = 1 << 4,
    AttachmentRead = 1 << 5,
    ConstantTexture = 1 << 6,
    StorageTextureWriteOnly = 1 << 7,
    StorageTextureRead = 1 << 8,
    StorageTextureReadWrite = 1 << 9,
};

static constexpr auto isTextureBindGroupEntryUsage(OptionSet<BindGroupEntryUsage> usage)
{
    return usage.toRaw() >= static_cast<std::underlying_type<BindGroupEntryUsage>::type>(BindGroupEntryUsage::Attachment);
}

struct BindGroupEntryUsageData {
    OptionSet<BindGroupEntryUsage> usage { BindGroupEntryUsage::Undefined };
    uint32_t binding { 0 };
    using Resource = Variant<RefPtr<Buffer>, RefPtr<const Texture>, RefPtr<const TextureView>, RefPtr<const ExternalTexture>>;
    Resource resource;
    uint64_t entryOffset { 0 };
    uint64_t entrySize { 0 };
    static constexpr uint32_t invalidBindingIndex = INT_MAX;
    static constexpr BindGroupEntryUsage invalidBindGroupUsage = static_cast<BindGroupEntryUsage>(std::numeric_limits<std::underlying_type<BindGroupEntryUsage>::type>::max());
};

struct BindableResources {
    Vector<id<MTLResource>> mtlResources;
    Vector<BindGroupEntryUsageData> resourceUsages;
    MTLResourceUsage usage;
    MTLRenderStages renderStages;
};

struct IndexData {
    uint64_t renderCommand { 0 };
    uint32_t minVertexCount { UINT32_MAX };
    uint32_t minInstanceCount { UINT32_MAX };
    uint64_t bufferGpuAddress { 0 };
    uint32_t indexBufferElementCountMinusOne { 0 };
    uint32_t indexCount { 0 };
    uint32_t instanceCount { 0 };
    uint32_t firstIndex { 0 };
    int32_t baseVertex { 0 };
    uint32_t firstInstance { 0 };
    uint32_t primitiveType { MTLPrimitiveTypeTriangle };
};

struct IndexBufferAndIndexData {
    RefPtr<Buffer> indexBuffer;
    MTLIndexType indexType { MTLIndexTypeUInt16 };
    NSUInteger indexBufferOffsetInBytes { 0 };
    IndexData indexData;
};

using DrawIndexCacheContainerKey = std::array<uint32_t, 5>;
inline void add(Hasher& hasher, const DrawIndexCacheContainerKey& input)
{
    for (auto value : input)
        WTF::add(hasher, value);
}

struct DrawIndexCacheContainerValue {
    uint32_t firstIndex { 0 };
    uint32_t indexCount { 0 };
    uint32_t primitiveOffsetWithIndexType { 0 };
    union {
        uint64_t icb { 0 };
        struct {
            uint32_t icb1;
            uint32_t icb2;
        };
    };
    DrawIndexCacheContainerValue() { }
    DrawIndexCacheContainerValue(const DrawIndexCacheContainerKey& key)
        : firstIndex(key[0])
        , indexCount(key[1])
        , primitiveOffsetWithIndexType(key[2])
        , icb1(key[3])
        , icb2(key[4])
    {
    }
    uint32_t primitiveOffset() { return static_cast<MTLIndexType>(primitiveOffsetWithIndexType & 0x1); }
    MTLIndexType indexType() { return static_cast<MTLIndexType>(primitiveOffsetWithIndexType & 0x2); }
};

using DrawIndexCacheContainer = HashMap<GenericHashKey<DrawIndexCacheContainerKey>, uint32_t>;
using DrawIndexCacheContainerIterator = DrawIndexCacheContainer::const_iterator;

using TrackedResourceContainer = HashSet<uint64_t, DefaultHash<uint64_t>, WTF::UnsignedWithZeroKeyHashTraits<uint64_t>>;
struct TrackedResource {
    mutable TrackedResourceContainer m_commandEncoders;
    void removeEncoder(uint64_t identifier) const
    {
        m_commandEncoders.remove(identifier);
    }
};

} // namespace WebGPU
