#pragma once

#include "engine/support/FastMalloc.h"
#include "engine/support/Forward.h"
#include "engine/support/Noncopyable.h"

#include <span>

namespace WTF {

// Memory that the derived class gives back. The elements are neither constructed nor destroyed.
template<typename T>
class TRIVIAL_ABI OwnedSpan {
    WTF_MAKE_NONCOPYABLE(OwnedSpan);

public:
    size_t sizeInBytes() const { return m_span.size_bytes(); }
    std::span<const T> span() const LIFETIME_BOUND { return m_span; }
    std::span<T> mutableSpan() LIFETIME_BOUND { return m_span; }
    [[nodiscard]] std::span<T> leakSpan() { return std::exchange(m_span, {}); }

    explicit operator bool() const { return m_span.data(); }
    bool operator!() const { return !m_span.data(); }

protected:
    OwnedSpan() = default;

    OwnedSpan(void* memory, size_t sizeInBytes)
        : m_span(static_cast<T*>(memory), memory ? sizeInBytes / sizeof(T) : 0)
    {
        RELEASE_ASSERT(!(sizeInBytes % sizeof(T)));
    }

    OwnedSpan(OwnedSpan&& other)
        : m_span(other.leakSpan())
    {
    }

    void swap(OwnedSpan& other) { std::swap(m_span, other.m_span); }

private:
    std::span<T> m_span;
};

template<typename T, typename Malloc = FastMalloc> MallocSpan<T, Malloc> adoptMallocSpan(std::span<T>);

template<typename T, typename Malloc>
class TRIVIAL_ABI MallocSpan : public OwnedSpan<T> {
    WTF_MAKE_TZONE_ALLOCATED(MallocSpan);

public:
    static MallocSpan malloc(size_t sizeInBytes) { return { Malloc::malloc(sizeInBytes), sizeInBytes }; }
    static MallocSpan tryMalloc(size_t sizeInBytes) { return { Malloc::tryMalloc(sizeInBytes), sizeInBytes }; }

    MallocSpan() = default;
    MallocSpan(MallocSpan&&) = default;
    ~MallocSpan() { Malloc::free(this->mutableSpan().data()); }

    MallocSpan& operator=(MallocSpan&& other)
    {
        MallocSpan moved { WTF::move(other) };
        this->swap(moved);
        return *this;
    }

private:
    friend MallocSpan adoptMallocSpan<T, Malloc>(std::span<T>);

    MallocSpan(void* memory, size_t sizeInBytes)
        : OwnedSpan<T>(memory, sizeInBytes)
    {
    }
};

template<typename T, typename Malloc>
MallocSpan<T, Malloc> adoptMallocSpan(std::span<T> span)
{
    return { span.data(), span.size_bytes() };
}

}

using WTF::adoptMallocSpan;
using WTF::MallocSpan;
