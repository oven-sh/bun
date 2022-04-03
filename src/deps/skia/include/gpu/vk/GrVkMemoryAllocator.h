/*
 * Copyright 2018 Google Inc.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef GrVkMemoryAllocator_DEFINED
#define GrVkMemoryAllocator_DEFINED

#include "include/core/SkRefCnt.h"
#include "include/gpu/GrTypes.h"
#include "include/gpu/vk/GrVkTypes.h"

class GrVkMemoryAllocator : public SkRefCnt {
public:
    enum class AllocationPropertyFlags {
        kNone                = 0,
        // Allocation will be placed in its own VkDeviceMemory and not suballocated from some larger
        // block.
        kDedicatedAllocation = 0x1,
        // Says that the backing memory can only be accessed by the device. Additionally the device
        // may lazily allocate the memory. This cannot be used with buffers that will be host
        // visible. Setting this flag does not guarantee that we will allocate memory that respects
        // it, but we will try to prefer memory that can respect it.
        kLazyAllocation      = 0x2,
        // The allocation will be mapped immediately and stay mapped until it is destroyed. This
        // flag is only valid for buffers which are host visible (i.e. must have a usage other than
        // BufferUsage::kGpuOnly).
        kPersistentlyMapped  = 0x4,
        // Allocation can only be accessed by the device using a protected context.
        kProtected  = 0x8,
    };

    GR_DECL_BITFIELD_CLASS_OPS_FRIENDS(AllocationPropertyFlags);

    enum class BufferUsage {
        // Buffers that will only be accessed from the device (large const buffers). Will always be
        // in device local memory.
        kGpuOnly,
        // Buffers that typically will be updated multiple times by the host and read on the gpu
        // (e.g. uniform or vertex buffers). CPU writes will generally be sequential in the buffer
        // and will try to take advantage of the write-combined nature of the gpu buffers. Thus this
        // will always be mappable and coherent memory, and it will prefer to be in device local
        // memory.
        kCpuWritesGpuReads,
        // Buffers that will be accessed on the host and copied to another GPU resource (transfer
        // buffers). Will always be mappable and coherent memory.
        kTransfersFromCpuToGpu,
        // Buffers which are typically writted to by the GPU and then read on the host. Will always
        // be mappable memory, and will prefer cached memory.
        kTransfersFromGpuToCpu,
    };

    // DEPRECATED: Use and implement allocateImageMemory instead
    virtual bool allocateMemoryForImage(VkImage, AllocationPropertyFlags, GrVkBackendMemory*) {
        // The default implementation here is so clients can delete this virtual as the switch to
        // the new one which returns a VkResult.
        return false;
    }

    virtual VkResult allocateImageMemory(VkImage image, AllocationPropertyFlags flags,
                                         GrVkBackendMemory* memory) {
        bool result = this->allocateMemoryForImage(image, flags, memory);
        // VK_ERROR_INITIALIZATION_FAILED is a bogus result to return from this function, but it is
        // just something to return that is not VK_SUCCESS and can't be interpreted by a caller to
        // mean something specific happened like device lost or oom. This will be removed once we
        // update clients to implement this virtual.
        return result ? VK_SUCCESS : VK_ERROR_INITIALIZATION_FAILED;
    }

    // DEPRECATED: Use and implement allocateBufferMemory instead
    virtual bool allocateMemoryForBuffer(VkBuffer, BufferUsage,  AllocationPropertyFlags,
                                         GrVkBackendMemory*) {
        // The default implementation here is so clients can delete this virtual as the switch to
        // the new one which returns a VkResult.
        return false;
    }

    virtual VkResult allocateBufferMemory(VkBuffer buffer,
                                          BufferUsage usage,
                                          AllocationPropertyFlags flags,
                                          GrVkBackendMemory* memory) {
        bool result = this->allocateMemoryForBuffer(buffer, usage, flags, memory);
        // VK_ERROR_INITIALIZATION_FAILED is a bogus result to return from this function, but it is
        // just something to return that is not VK_SUCCESS and can't be interpreted by a caller to
        // mean something specific happened like device lost or oom. This will be removed once we
        // update clients to implement this virtual.
        return result ? VK_SUCCESS : VK_ERROR_INITIALIZATION_FAILED;
    }


    // Fills out the passed in GrVkAlloc struct for the passed in GrVkBackendMemory.
    virtual void getAllocInfo(const GrVkBackendMemory&, GrVkAlloc*) const = 0;

    // Maps the entire allocation and returns a pointer to the start of the allocation. The
    // implementation may map more memory than just the allocation, but the returned pointer must
    // point at the start of the memory for the requested allocation.
    virtual void* mapMemory(const GrVkBackendMemory&) { return nullptr; }
    virtual VkResult mapMemory(const GrVkBackendMemory& memory, void** data) {
        *data = this->mapMemory(memory);
        // VK_ERROR_INITIALIZATION_FAILED is a bogus result to return from this function, but it is
        // just something to return that is not VK_SUCCESS and can't be interpreted by a caller to
        // mean something specific happened like device lost or oom. This will be removed once we
        // update clients to implement this virtual.
        return *data ? VK_SUCCESS : VK_ERROR_INITIALIZATION_FAILED;
    }
    virtual void unmapMemory(const GrVkBackendMemory&) = 0;

    // The following two calls are used for managing non-coherent memory. The offset is relative to
    // the start of the allocation and not the underlying VkDeviceMemory. Additionaly the client
    // must make sure that the offset + size passed in is less that or equal to the allocation size.
    // It is the responsibility of the implementation to make sure all alignment requirements are
    // followed. The client should not have to deal with any sort of alignment issues.
    virtual void flushMappedMemory(const GrVkBackendMemory&, VkDeviceSize, VkDeviceSize) {}
    virtual VkResult flushMemory(const GrVkBackendMemory& memory,  VkDeviceSize offset,
                                 VkDeviceSize size) {
        this->flushMappedMemory(memory, offset, size);
        return VK_SUCCESS;
    }
    virtual void invalidateMappedMemory(const GrVkBackendMemory&, VkDeviceSize, VkDeviceSize) {}
    virtual VkResult invalidateMemory(const GrVkBackendMemory& memory,  VkDeviceSize offset,
                                 VkDeviceSize size) {
        this->invalidateMappedMemory(memory, offset, size);
        return VK_SUCCESS;
    }

    virtual void freeMemory(const GrVkBackendMemory&) = 0;

    // Returns the total amount of memory that is allocated and in use by an allocation for this
    // allocator.
    virtual uint64_t totalUsedMemory() const = 0;

    // Returns the total amount of memory that is allocated by this allocator.
    virtual uint64_t totalAllocatedMemory() const = 0;
};

GR_MAKE_BITFIELD_CLASS_OPS(GrVkMemoryAllocator::AllocationPropertyFlags)

#endif
