#pragma once

#include "engine/support/StdLibExtras.h"

namespace WTF {

// A pointer and up to 16 bits in one word.
template<typename Pointer, typename Type>
class CompactPointerTuple final {
public:
    CompactPointerTuple() = default;

    CompactPointerTuple(Pointer pointer, Type type)
        : m_bits(encodePointer(pointer) | encodeType(type))
    {
    }

    Pointer pointer() const { return reinterpret_cast<Pointer>(m_bits & pointerMask); }
    void setPointer(Pointer pointer) { m_bits = (m_bits & ~pointerMask) | encodePointer(pointer); }

    Type type() const { return static_cast<Type>(m_bits >> pointerBits); }
    void setType(Type type) { m_bits = (m_bits & pointerMask) | encodeType(type); }

private:
    static_assert(std::is_pointer_v<Pointer> && sizeof(Type) <= 2);

    static constexpr unsigned pointerBits = 48;
    static constexpr uintptr_t pointerMask = (uintptr_t { 1 } << pointerBits) - 1;

    static uintptr_t encodePointer(Pointer pointer)
    {
        auto address = reinterpret_cast<uintptr_t>(pointer);
        ASSERT(address <= pointerMask);
        return address;
    }

    static uintptr_t encodeType(Type type) { return static_cast<uintptr_t>(type) << pointerBits; }

    uintptr_t m_bits { 0 };
};

}

using WTF::CompactPointerTuple;
