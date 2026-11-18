#pragma once

#include "engine/support/MallocSpan.h"

#if !OS(WINDOWS)

#include <sys/mman.h>

namespace WTF {

template<typename T>
class MmapSpan : public OwnedSpan<T> {
public:
    static MmapSpan mmap(void* address, size_t sizeInBytes, int protection, int flags, int fileDescriptor)
    {
        void* memory = ::mmap(address, sizeInBytes, protection, flags, fileDescriptor, 0);
        if (memory == MAP_FAILED)
            return {};
        return { memory, sizeInBytes };
    }

    MmapSpan() = default;
    MmapSpan(MmapSpan&&) = default;

    ~MmapSpan()
    {
        if (*this)
            munmap(this->mutableSpan().data(), this->sizeInBytes());
    }

    MmapSpan& operator=(MmapSpan&& other)
    {
        MmapSpan moved { WTF::move(other) };
        this->swap(moved);
        return *this;
    }

private:
    MmapSpan(void* memory, size_t sizeInBytes)
        : OwnedSpan<T>(memory, sizeInBytes)
    {
    }
};

}

using WTF::MmapSpan;

#endif
