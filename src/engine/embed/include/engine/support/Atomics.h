#pragma once

#include "engine/support/Platform.h"

#include <atomic>
#include <cstdint>

namespace WTF {

ALWAYS_INLINE void compilerFence()
{
    asm volatile("" ::: "memory");
}

ALWAYS_INLINE void storeStoreFence()
{
#if CPU(ARM64)
    asm volatile("dmb ishst" ::: "memory");
#else
    compilerFence();
#endif
}

// The compiler knows nothing of the result.
template<typename T>
ALWAYS_INLINE T opaque(T value)
{
    asm("" : "+r"(value));
    return value;
}

// Orders a load after the load of a value, by making its address depend on the value.
class Dependency {
public:
    template<typename T>
    static ALWAYS_INLINE Dependency fence([[maybe_unused]] T value)
    {
        uintptr_t zero = 0;
#if CPU(ARM64)
        asm("eor %w[zero], %w[value], %w[value]" : [zero] "=r"(zero) : [value] "r"(static_cast<unsigned>(value)));
#else
        compilerFence();
#endif
        return Dependency { zero };
    }

    template<typename T>
    ALWAYS_INLINE T* consume(T* pointer) const
    {
        return reinterpret_cast<T*>(reinterpret_cast<uintptr_t>(pointer) + m_zero);
    }

private:
    explicit Dependency(uintptr_t zero)
        : m_zero(zero)
    {
    }

    uintptr_t m_zero;
};

}

using WTF::Dependency;
