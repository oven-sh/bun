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

#import "BindableResource.h"
#import <Metal/Metal.h>
#import <WebGPU/WGPUTextureImpl.h>
#import <wtf/FastMalloc.h>
#import <wtf/HashMap.h>
#import <wtf/HashSet.h>
#import <wtf/Ref.h>
#import <wtf/RefCountedAndCanMakeWeakPtr.h>
#import <wtf/SwiftBridging.h>
#import <wtf/TZoneMalloc.h>
#import <wtf/Vector.h>
#import <wtf/WeakHashSet.h>
#import <wtf/WeakPtr.h>

namespace WebGPU {

class CommandEncoder;
class Device;
class TextureView;

// https://gpuweb.github.io/gpuweb/#gputexture
class Texture : public RefCountedAndCanMakeWeakPtr<Texture>, public WGPUTextureImpl, public TrackedResource {
    WTF_MAKE_TZONE_ALLOCATED(Texture);
public:
    static Ref<Texture> create(id<MTLTexture> texture, const WGPUTextureDescriptor& descriptor, Vector<WGPUTextureFormat>&& viewFormats, Device& device)
    {
        return adoptRef(*new Texture(texture, descriptor, WTF::move(viewFormats), device));
    }
    static Ref<Texture> createInvalid(Device& device)
    {
        return adoptRef(*new Texture(device));
    }

    ~Texture();

    Ref<TextureView> createView(const WGPUTextureViewDescriptor&);
    void destroy();
    void setLabel(String&&);

    bool NODELETE isValid() const;

    static uint32_t NODELETE texelBlockWidth(WGPUTextureFormat); // Texels
    static uint32_t NODELETE texelBlockHeight(WGPUTextureFormat); // Texels
    static NSUInteger NODELETE bytesPerRow(WGPUTextureFormat, uint32_t textureWidth, uint32_t sampleCount);
    static WGPUExtent3D NODELETE physicalTextureExtent(WGPUTextureDimension, WGPUTextureFormat, WGPUExtent3D logicalExtent);

    // For depth-stencil textures, the input value to texelBlockSize()
    // needs to be the output of aspectSpecificFormat().
    static Checked<uint32_t> NODELETE texelBlockSize(WGPUTextureFormat); // Bytes
    static bool NODELETE containsDepthAspect(WGPUTextureFormat);
    static bool NODELETE containsStencilAspect(WGPUTextureFormat);
    static bool NODELETE isDepthOrStencilFormat(WGPUTextureFormat);
    static WGPUTextureFormat NODELETE aspectSpecificFormat(WGPUTextureFormat, WGPUTextureAspect);
    static NSString* errorValidatingImageCopyTexture(const WGPUImageCopyTexture&, const WGPUExtent3D&);
    static NSString* errorValidatingTextureCopyRange(const WGPUImageCopyTexture&, const WGPUExtent3D&);
    static bool NODELETE refersToSingleAspect(WGPUTextureFormat, WGPUTextureAspect);
    static bool NODELETE isValidDepthStencilCopySource(WGPUTextureFormat, WGPUTextureAspect);
    static bool NODELETE isValidDepthStencilCopyDestination(WGPUTextureFormat, WGPUTextureAspect);
    static NSString* errorValidatingLinearTextureData(const WGPUTextureDataLayout&, uint64_t, WGPUTextureFormat, WGPUExtent3D);
    static MTLTextureUsage NODELETE usage(WGPUTextureUsageFlags, WGPUTextureFormat);
    static MTLPixelFormat NODELETE pixelFormat(WGPUTextureFormat);
    static WGPUTextureFormat NODELETE textureFormat(MTLPixelFormat);
    static std::optional<MTLPixelFormat> NODELETE depthOnlyAspectMetalFormat(WGPUTextureFormat);
    static std::optional<MTLPixelFormat> NODELETE stencilOnlyAspectMetalFormat(WGPUTextureFormat);
    static WGPUTextureFormat NODELETE removeSRGBSuffix(WGPUTextureFormat);
    static std::optional<WGPUTextureFormat> NODELETE resolveTextureFormat(WGPUTextureFormat, WGPUTextureAspect);
    static bool NODELETE isCompressedFormat(WGPUTextureFormat);
    enum class CompressFormat {
        ASTC, // NOLINT
        BC, // NOLINT
        ETC // NOLINT
    };
    static std::optional<CompressFormat> NODELETE compressedFormatType(WGPUTextureFormat);
    static bool isRenderableFormat(WGPUTextureFormat, const Device&);
    static bool isColorRenderableFormat(WGPUTextureFormat, const Device&);
    static bool NODELETE isDepthStencilRenderableFormat(WGPUTextureFormat, const Device&);
    static uint32_t NODELETE renderTargetPixelByteCost(WGPUTextureFormat);
    static uint32_t NODELETE renderTargetPixelByteAlignment(WGPUTextureFormat);

    WGPUExtent3D logicalMiplevelSpecificTextureExtent(uint32_t mipLevel);
    WGPUExtent3D physicalMiplevelSpecificTextureExtent(uint32_t mipLevel);

    id<MTLTexture> texture() const { return m_texture; }

    uint32_t width() const { return m_width; }
    uint32_t height() const { return m_height; }
    uint32_t depthOrArrayLayers() const { return m_depthOrArrayLayers; }
    uint32_t mipLevelCount() const { return m_mipLevelCount; }
    uint32_t sampleCount() const { return m_sampleCount; }
    WGPUTextureDimension dimension() const { return m_dimension; }
    WGPUTextureFormat format() const { return m_format; }
    WGPUTextureUsageFlags usage() const { return m_usage; }

    Device& device() const { return m_device; }

    bool NODELETE previouslyCleared() const;
    void setPreviouslyCleared();
    bool previouslyCleared(uint32_t mipLevel, uint32_t slice) const;
    void setPreviouslyCleared(uint32_t mipLevel, uint32_t slice, bool = true);
    bool isDestroyed() const { return m_destroyed; }

    static bool hasStorageBindingCapability(WGPUTextureFormat, const Device&, std::optional<WGPUStorageTextureAccess> = std::nullopt);
    static bool supportsMultisampling(WGPUTextureFormat, const Device&);
    static bool supportsResolve(WGPUTextureFormat, const Device&);
    static bool supportsBlending(WGPUTextureFormat, const Device&);
    void NODELETE recreateIfNeeded();
    void NODELETE makeCanvasBacking();
    void setCommandEncoder(CommandEncoder&) const;
    static ASCIILiteral formatToString(WGPUTextureFormat);
    bool isCanvasBacking() const { return m_canvasBacking; }

    bool waitForCommandBufferCompletion();
    void NODELETE updateCompletionEvent(const std::pair<id<MTLSharedEvent>, uint64_t>&);
    id<MTLSharedEvent> NODELETE sharedEvent() const;
    uint64_t NODELETE sharedEventSignalValue() const;
    void setRasterizationRateMaps(std::pair<id<MTLRasterizationRateMap>, id<MTLRasterizationRateMap>>&& rateMaps) { m_leftRightRasterizationMaps = WTF::move(rateMaps); }
    id<MTLRasterizationRateMap> rasterizationMapForSlice(uint32_t slice) const { return slice ? m_leftRightRasterizationMaps.second : m_leftRightRasterizationMaps.first; }
    uint32_t NODELETE arrayLayerCount() const;
    WGPUTextureAspect aspect() const { return WGPUTextureAspect_All; }
    uint32_t baseArrayLayer() const { return 0; }
    uint32_t baseMipLevel() const { return 0; }
    uint32_t parentRelativeSlice() const { return 0; }
    bool is2DTexture() const { return dimension() == WGPUTextureDimension_2D; }
    bool is2DArrayTexture() const { return is2DTexture() && arrayLayerCount() > 1; }
    bool is3DTexture() const { return dimension() == WGPUTextureDimension_3D; }
    id<MTLTexture> parentTexture() const { return texture(); }
    const Texture& apiParentTexture() const { return *this; }

private:
    Texture(id<MTLTexture>, const WGPUTextureDescriptor&, Vector<WGPUTextureFormat>&& viewFormats, Device&);
    Texture(Device&);

    std::optional<WGPUTextureViewDescriptor> resolveTextureViewDescriptorDefaults(const WGPUTextureViewDescriptor&) const;
    NSString* errorValidatingTextureViewCreation(const WGPUTextureViewDescriptor&) const;

    id<MTLTexture> m_texture { nil };

    const uint32_t m_width { 0 };
    const uint32_t m_height { 0 };
    const uint32_t m_depthOrArrayLayers { 0 };
    const uint32_t m_mipLevelCount { 0 };
    const uint32_t m_sampleCount { 0 };
    const WGPUTextureDimension m_dimension { WGPUTextureDimension_2D };
    const WGPUTextureFormat m_format { WGPUTextureFormat_Undefined };
    const WGPUTextureUsageFlags m_usage { WGPUTextureUsage_None };

    const Vector<WGPUTextureFormat> m_viewFormats;

    const Ref<Device> m_device;
    using ClearedToZeroInnerContainer = HashSet<uint32_t, DefaultHash<uint32_t>, WTF::UnsignedWithZeroKeyHashTraits<uint32_t>>;
    using ClearedToZeroContainer = HashMap<uint32_t, ClearedToZeroInnerContainer, DefaultHash<uint32_t>, WTF::UnsignedWithZeroKeyHashTraits<uint32_t>>;
    ClearedToZeroContainer m_clearedToZero;
    Vector<WeakPtr<TextureView>> m_textureViews;
    bool m_destroyed { false };
    bool m_canvasBacking { false };
    id<MTLSharedEvent> m_sharedEvent { nil };
    std::pair<id<MTLRasterizationRateMap>, id<MTLRasterizationRateMap>> m_leftRightRasterizationMaps;

    uint64_t m_sharedEventSignalValue { 0 };
} SWIFT_SHARED_REFERENCE(refTexture, derefTexture) SWIFT_RETURNED_AS_UNRETAINED_BY_DEFAULT;

} // namespace WebGPU

inline void refTexture(WebGPU::Texture* obj)
{
    obj->ref();
}

inline void derefTexture(WebGPU::Texture* obj)
{
    obj->deref();
}
