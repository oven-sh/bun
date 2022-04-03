/*
 * Copyright 2020 Google LLC
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef GrBackendSurfaceMutableState_DEFINED
#define GrBackendSurfaceMutableState_DEFINED

#include "include/gpu/GrTypes.h"

#ifdef SK_VULKAN
#include "include/private/GrVkTypesPriv.h"
#endif

/**
 * Since Skia and clients can both modify gpu textures and their connected state, Skia needs a way
 * for clients to inform us if they have modifiend any of this state. In order to not need setters
 * for every single API and state, we use this class to be a generic wrapper around all the mutable
 * state. This class is used for calls that inform Skia of these texture/image state changes by the
 * client as well as for requesting state changes to be done by Skia. The backend specific state
 * that is wrapped by this class are:
 *
 * Vulkan: VkImageLayout and QueueFamilyIndex
 */
class SK_API GrBackendSurfaceMutableState {
public:
    GrBackendSurfaceMutableState() {}

#ifdef SK_VULKAN
    GrBackendSurfaceMutableState(VkImageLayout layout, uint32_t queueFamilyIndex)
            : fVkState(layout, queueFamilyIndex)
            , fBackend(GrBackend::kVulkan)
            , fIsValid(true) {}
#endif

    GrBackendSurfaceMutableState(const GrBackendSurfaceMutableState& that);
    GrBackendSurfaceMutableState& operator=(const GrBackendSurfaceMutableState& that);

#ifdef SK_VULKAN
    // If this class is not Vulkan backed it will return value of VK_IMAGE_LAYOUT_UNDEFINED.
    // Otherwise it will return the VkImageLayout.
    VkImageLayout getVkImageLayout() const {
        if (this->isValid() && fBackend != GrBackendApi::kVulkan) {
            return VK_IMAGE_LAYOUT_UNDEFINED;
        }
        return fVkState.getImageLayout();
    }

    // If this class is not Vulkan backed it will return value of VK_QUEUE_FAMILY_IGNORED.
    // Otherwise it will return the VkImageLayout.
    uint32_t getQueueFamilyIndex() const {
        if (this->isValid() && fBackend != GrBackendApi::kVulkan) {
            return VK_QUEUE_FAMILY_IGNORED;
        }
        return fVkState.getQueueFamilyIndex();
    }
#endif

    // Returns true if the backend mutable state has been initialized.
    bool isValid() const { return fIsValid; }

    GrBackendApi backend() const { return fBackend; }

private:
    friend class GrBackendSurfaceMutableStateImpl;
    friend class GrVkGpu;

#ifdef SK_VULKAN
    void setVulkanState(VkImageLayout layout, uint32_t queueFamilyIndex) {
        SkASSERT(!this->isValid() || fBackend == GrBackendApi::kVulkan);
        fVkState.setImageLayout(layout);
        fVkState.setQueueFamilyIndex(queueFamilyIndex);
        fBackend = GrBackendApi::kVulkan;
        fIsValid = true;
    }
#endif

    union {
        char fPlaceholder;
#ifdef SK_VULKAN
        GrVkSharedImageInfo fVkState;
#endif
    };

    GrBackend fBackend = GrBackendApi::kMock;
    bool fIsValid = false;
};

#endif
