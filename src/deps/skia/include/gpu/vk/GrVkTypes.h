
/*
 * Copyright 2016 Google Inc.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef GrVkTypes_DEFINED
#define GrVkTypes_DEFINED

#include "include/core/SkTypes.h"
#include "include/gpu/vk/GrVkVulkan.h"

#ifndef VK_VERSION_1_1
#error Skia requires the use of Vulkan 1.1 headers
#endif

#include <functional>
#include "include/gpu/GrTypes.h"

typedef intptr_t GrVkBackendMemory;

/**
 * Types for interacting with Vulkan resources created externally to Skia. GrBackendObjects for
 * Vulkan textures are really const GrVkImageInfo*
 */
struct GrVkAlloc {
    // can be VK_NULL_HANDLE iff is an RT and is borrowed
    VkDeviceMemory    fMemory = VK_NULL_HANDLE;
    VkDeviceSize      fOffset = 0;
    VkDeviceSize      fSize = 0;  // this can be indeterminate iff Tex uses borrow semantics
    uint32_t          fFlags = 0;
    GrVkBackendMemory fBackendMemory = 0; // handle to memory allocated via GrVkMemoryAllocator.

    enum Flag {
        kNoncoherent_Flag     = 0x1,   // memory must be flushed to device after mapping
        kMappable_Flag        = 0x2,   // memory is able to be mapped.
        kLazilyAllocated_Flag = 0x4,   // memory was created with lazy allocation
    };

    bool operator==(const GrVkAlloc& that) const {
        return fMemory == that.fMemory && fOffset == that.fOffset && fSize == that.fSize &&
               fFlags == that.fFlags && fUsesSystemHeap == that.fUsesSystemHeap;
    }

private:
    friend class GrVkHeap; // For access to usesSystemHeap
    bool fUsesSystemHeap = false;
};

// This struct is used to pass in the necessary information to create a VkSamplerYcbcrConversion
// object for an VkExternalFormatANDROID.
struct GrVkYcbcrConversionInfo {
    bool operator==(const GrVkYcbcrConversionInfo& that) const {
        // Invalid objects are not required to have all other fields initialized or matching.
        if (!this->isValid() && !that.isValid()) {
            return true;
        }
        return this->fFormat == that.fFormat &&
               this->fExternalFormat == that.fExternalFormat &&
               this->fYcbcrModel == that.fYcbcrModel &&
               this->fYcbcrRange == that.fYcbcrRange &&
               this->fXChromaOffset == that.fXChromaOffset &&
               this->fYChromaOffset == that.fYChromaOffset &&
               this->fChromaFilter == that.fChromaFilter &&
               this->fForceExplicitReconstruction == that.fForceExplicitReconstruction;
    }
    bool operator!=(const GrVkYcbcrConversionInfo& that) const { return !(*this == that); }

    bool isValid() const { return fYcbcrModel != VK_SAMPLER_YCBCR_MODEL_CONVERSION_RGB_IDENTITY; }

    // Format of the source image. Must be set to VK_FORMAT_UNDEFINED for external images or
    // a valid image format otherwise.
    VkFormat fFormat = VK_FORMAT_UNDEFINED;

    // The external format. Must be non-zero for external images, zero otherwise.
    // Should be compatible to be used in a VkExternalFormatANDROID struct.
    uint64_t fExternalFormat = 0;

    VkSamplerYcbcrModelConversion fYcbcrModel = VK_SAMPLER_YCBCR_MODEL_CONVERSION_RGB_IDENTITY;
    VkSamplerYcbcrRange fYcbcrRange = VK_SAMPLER_YCBCR_RANGE_ITU_FULL;
    VkChromaLocation fXChromaOffset = VK_CHROMA_LOCATION_COSITED_EVEN;
    VkChromaLocation fYChromaOffset = VK_CHROMA_LOCATION_COSITED_EVEN;
    VkFilter fChromaFilter = VK_FILTER_NEAREST;
    VkBool32 fForceExplicitReconstruction = false;

    // For external images format features here should be those returned by a call to
    // vkAndroidHardwareBufferFormatPropertiesANDROID
    VkFormatFeatureFlags fFormatFeatures = 0;
};

/*
 * When wrapping a GrBackendTexture or GrBackendRendenderTarget, the fCurrentQueueFamily should
 * either be VK_QUEUE_FAMILY_IGNORED, VK_QUEUE_FAMILY_EXTERNAL, or VK_QUEUE_FAMILY_FOREIGN_EXT. If
 * fSharingMode is VK_SHARING_MODE_EXCLUSIVE then fCurrentQueueFamily can also be the graphics
 * queue index passed into Skia.
 */
struct GrVkImageInfo {
    VkImage                  fImage = VK_NULL_HANDLE;
    GrVkAlloc                fAlloc;
    VkImageTiling            fImageTiling = VK_IMAGE_TILING_OPTIMAL;
    VkImageLayout            fImageLayout = VK_IMAGE_LAYOUT_UNDEFINED;
    VkFormat                 fFormat = VK_FORMAT_UNDEFINED;
    VkImageUsageFlags        fImageUsageFlags = 0;
    uint32_t                 fSampleCount = 1;
    uint32_t                 fLevelCount = 0;
    uint32_t                 fCurrentQueueFamily = VK_QUEUE_FAMILY_IGNORED;
    GrProtected              fProtected = GrProtected::kNo;
    GrVkYcbcrConversionInfo  fYcbcrConversionInfo;
    VkSharingMode            fSharingMode = VK_SHARING_MODE_EXCLUSIVE;
#ifdef SK_BUILD_FOR_ANDROID_FRAMEWORK
    bool                     fPartOfSwapchainOrAndroidWindow = false;
#endif

#if GR_TEST_UTILS
    bool operator==(const GrVkImageInfo& that) const {
        bool equal = fImage == that.fImage && fAlloc == that.fAlloc &&
                     fImageTiling == that.fImageTiling &&
                     fImageLayout == that.fImageLayout &&
                     fFormat == that.fFormat &&
                     fImageUsageFlags == that.fImageUsageFlags &&
                     fSampleCount == that.fSampleCount &&
                     fLevelCount == that.fLevelCount &&
                     fCurrentQueueFamily == that.fCurrentQueueFamily &&
                     fProtected == that.fProtected &&
                     fYcbcrConversionInfo == that.fYcbcrConversionInfo &&
                     fSharingMode == that.fSharingMode;
#ifdef SK_BUILD_FOR_ANDROID_FRAMEWORK
        equal = equal && (fPartOfSwapchainOrAndroidWindow == that.fPartOfSwapchainOrAndroidWindow);
#endif
        return equal;
    }
#endif
};

using GrVkGetProc = std::function<PFN_vkVoidFunction(
        const char*, // function name
        VkInstance,  // instance or VK_NULL_HANDLE
        VkDevice     // device or VK_NULL_HANDLE
        )>;

/**
 * This object is wrapped in a GrBackendDrawableInfo and passed in as an argument to
 * drawBackendGpu() calls on an SkDrawable. The drawable will use this info to inject direct
 * Vulkan calls into our stream of GPU draws.
 *
 * The SkDrawable is given a secondary VkCommandBuffer in which to record draws. The GPU backend
 * will then execute that command buffer within a render pass it is using for its own draws. The
 * drawable is also given the attachment of the color index, a compatible VkRenderPass, and the
 * VkFormat of the color attachment so that it can make VkPipeline objects for the draws. The
 * SkDrawable must not alter the state of the VkRenderpass or sub pass.
 *
 * Additionally, the SkDrawable may fill in the passed in fDrawBounds with the bounds of the draws
 * that it submits to the command buffer. This will be used by the GPU backend for setting the
 * bounds in vkCmdBeginRenderPass. If fDrawBounds is not updated, we will assume that the entire
 * attachment may have been written to.
 *
 * The SkDrawable is always allowed to create its own command buffers and submit them to the queue
 * to render offscreen textures which will be sampled in draws added to the passed in
 * VkCommandBuffer. If this is done the SkDrawable is in charge of adding the required memory
 * barriers to the queue for the sampled images since the Skia backend will not do this.
 */
struct GrVkDrawableInfo {
    VkCommandBuffer fSecondaryCommandBuffer;
    uint32_t        fColorAttachmentIndex;
    VkRenderPass    fCompatibleRenderPass;
    VkFormat        fFormat;
    VkRect2D*       fDrawBounds;
#ifdef SK_BUILD_FOR_ANDROID_FRAMEWORK
    bool            fFromSwapchainOrAndroidWindow;
#endif
};

struct GrVkSurfaceInfo {
    uint32_t fSampleCount = 1;
    uint32_t fLevelCount = 0;
    GrProtected fProtected = GrProtected::kNo;

    VkImageTiling fImageTiling = VK_IMAGE_TILING_OPTIMAL;
    VkFormat fFormat = VK_FORMAT_UNDEFINED;
    VkImageUsageFlags fImageUsageFlags = 0;
    GrVkYcbcrConversionInfo fYcbcrConversionInfo;
    VkSharingMode fSharingMode = VK_SHARING_MODE_EXCLUSIVE;
};

#endif
