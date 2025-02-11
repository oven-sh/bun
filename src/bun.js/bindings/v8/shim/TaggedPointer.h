#pragma once

#include "wtf/Assertions.h"
#include <cstdint>

namespace JSC {
class JSCell;
}

namespace v8 {
namespace shim {

struct TaggedPointer {
private:
    uintptr_t m_value;

public:
    enum class Tag : uint8_t {
        Smi = 0,
        StrongPointer = 1,
        WeakPointer = 3,
    };

    static constexpr uintptr_t TagMask = 0b11;

    // empty
    TaggedPointer()
        : TaggedPointer(nullptr) {};
    TaggedPointer(const TaggedPointer&) = default;
    TaggedPointer& operator=(const TaggedPointer&) = default;
    bool operator==(const TaggedPointer& other) const { return m_value == other.m_value; }

    TaggedPointer(void* ptr, bool weak = false)
        : m_value(reinterpret_cast<uintptr_t>(ptr) | static_cast<uintptr_t>(weak ? Tag::WeakPointer : Tag::StrongPointer))
    {
        // check original pointer was aligned
        RELEASE_ASSERT((reinterpret_cast<uintptr_t>(ptr) & TagMask) == 0);
    }

    TaggedPointer(int32_t smi)
        : m_value((static_cast<uintptr_t>(smi) << 32) | static_cast<uintptr_t>(Tag::Smi))
    {
    }

    // Convert the raw integer representation of a tagged pointer into a TaggedPointer struct
    static TaggedPointer fromRaw(uintptr_t raw)
    {
        TaggedPointer tagged;
        tagged.m_value = raw;
        return tagged;
    }

    bool isEmpty() const
    {
        return *this == TaggedPointer();
    }

    // Get a pointer to where this TaggedPointer is located (use ->asRawPtrLocation() to reinterpret
    // TaggedPointer* as uintptr_t*)
    uintptr_t* asRawPtrLocation()
    {
        return &m_value;
    }

    Tag tag() const
    {
        return static_cast<Tag>(m_value & TagMask);
    }

    template<typename T = JSC::JSCell> T* getPtr() const
    {
        if (tag() == Tag::Smi) {
            return nullptr;
        }
        return reinterpret_cast<T*>(m_value & ~TagMask);
    }

    bool getSmi(int32_t& smi) const
    {
        if (tag() != Tag::Smi) {
            return false;
        }
        smi = static_cast<int32_t>(m_value >> 32);
        return true;
    }

    int32_t getSmiUnchecked() const
    {
        ASSERT(tag() == Tag::Smi);
        return static_cast<int32_t>(m_value >> 32);
    }
};

} // namespace shim

using shim::TaggedPointer;

} // namespace v8
