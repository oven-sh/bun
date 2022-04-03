/*
 * Copyright 2016 Google Inc.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef GrVkBackendContext_DEFINED
#define GrVkBackendContext_DEFINED

#include "include/core/SkRefCnt.h"
#include "include/gpu/vk/GrVkMemoryAllocator.h"
#include "include/gpu/vk/GrVkTypes.h"

class GrVkExtensions;

enum GrVkExtensionFlags {
    kEXT_debug_report_GrVkExtensionFlag    = 0x0001,
    kNV_glsl_shader_GrVkExtensionFlag      = 0x0002,
    kKHR_surface_GrVkExtensionFlag         = 0x0004,
    kKHR_swapchain_GrVkExtensionFlag       = 0x0008,
    kKHR_win32_surface_GrVkExtensionFlag   = 0x0010,
    kKHR_android_surface_GrVkExtensionFlag = 0x0020,
    kKHR_xcb_surface_GrVkExtensionFlag     = 0x0040,
};

enum GrVkFeatureFlags {
    kGeometryShader_GrVkFeatureFlag    = 0x0001,
    kDualSrcBlend_GrVkFeatureFlag      = 0x0002,
    kSampleRateShading_GrVkFeatureFlag = 0x0004,
};

// It is not guarenteed VkPhysicalDeviceProperties2 will be in the client's header so we forward
// declare it here to be safe.
struct VkPhysicalDeviceFeatures2;

// The BackendContext contains all of the base Vulkan objects needed by the GrVkGpu. The assumption
// is that the client will set these up and pass them to the GrVkGpu constructor. The VkDevice
// created must support at least one graphics queue, which is passed in as well.
// The QueueFamilyIndex must match the family of the given queue. It is needed for CommandPool
// creation, and any GrBackendObjects handed to us (e.g., for wrapped textures) needs to be created
// in or transitioned to that family. The refs held by members of this struct must be released
// (either by deleting the struct or manually releasing the refs) before the underlying vulkan
// device and instance are destroyed.
struct SK_API GrVkBackendContext {
    VkInstance                       fInstance;
    VkPhysicalDevice                 fPhysicalDevice;
    VkDevice                         fDevice;
    VkQueue                          fQueue;
    uint32_t                         fGraphicsQueueIndex;
    uint32_t                         fMinAPIVersion; // Deprecated. Set fInstanceVersion instead.
    uint32_t                         fInstanceVersion = 0; // Deprecated. Set fMaxApiVersion instead
    // The max api version set here should match the value set in VkApplicationInfo::apiVersion when
    // then VkInstance was created.
    uint32_t                         fMaxAPIVersion = 0;
    uint32_t                         fExtensions = 0; // Deprecated. Use fVkExtensions instead.
    const GrVkExtensions*            fVkExtensions = nullptr;
    uint32_t                         fFeatures; // Deprecated. Use fDeviceFeatures[2] instead.
    // The client can create their VkDevice with either a VkPhysicalDeviceFeatures or
    // VkPhysicalDeviceFeatures2 struct, thus we have to support taking both. The
    // VkPhysicalDeviceFeatures2 struct is needed so we know if the client enabled any extension
    // specific features. If fDeviceFeatures2 is not null then we ignore fDeviceFeatures. If both
    // fDeviceFeatures and fDeviceFeatures2 are null we will assume no features are enabled.
    const VkPhysicalDeviceFeatures*  fDeviceFeatures = nullptr;
    const VkPhysicalDeviceFeatures2* fDeviceFeatures2 = nullptr;
    sk_sp<GrVkMemoryAllocator>       fMemoryAllocator;
    GrVkGetProc                      fGetProc = nullptr;
    // This is deprecated and should be set to false. The client is responsible for managing the
    // lifetime of the VkInstance and VkDevice objects.
    bool                             fOwnsInstanceAndDevice = false;
    // Indicates that we are working with protected content and all CommandPool and Queue operations
    // should be done in a protected context.
    GrProtected                      fProtectedContext = GrProtected::kNo;
};

#endif
