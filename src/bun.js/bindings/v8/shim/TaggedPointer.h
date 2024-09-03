#pragma once

#include "wtf/Assertions.h"
#include <cstdint>

namespace JSC {
class JSCell;
}

namespace v8 {
namespace shim {

struct TaggedPointer {
    uintptr_t m_value;

    enum class Type : uint8_t {
        Smi,
        StrongPointer,
        WeakPointer,
    };

    TaggedPointer()
        : TaggedPointer(nullptr) {};
    TaggedPointer(const TaggedPointer&) = default;
    TaggedPointer& operator=(const TaggedPointer&) = default;
    bool operator==(const TaggedPointer& other) const { return m_value == other.m_value; }

    TaggedPointer(void* ptr, bool weak = false)
        : m_value(reinterpret_cast<uintptr_t>(ptr) | (weak ? 3 : 1))
    {
        RELEASE_ASSERT((reinterpret_cast<uintptr_t>(ptr) & 3) == 0);
    }

    TaggedPointer(int32_t smi)
        : m_value(static_cast<uintptr_t>(smi) << 32)
    {
    }

    static TaggedPointer fromRaw(uintptr_t raw)
    {
        TaggedPointer tagged;
        tagged.m_value = raw;
        return tagged;
    }

    Type type() const
    {
        switch (m_value & 3) {
        case 0:
            return Type::Smi;
        case 1:
            return Type::StrongPointer;
        case 3:
            return Type::WeakPointer;
        default:
            RELEASE_ASSERT_NOT_REACHED();
        }
    }

    template<typename T = JSC::JSCell> T* getPtr() const
    {
        if (type() == Type::Smi) {
            return nullptr;
        }
        return reinterpret_cast<T*>(m_value & ~3ull);
    }

    bool getSmi(int32_t& smi) const
    {
        if (type() != Type::Smi) {
            return false;
        }
        smi = static_cast<int32_t>(m_value >> 32);
        return true;
    }

    int32_t getSmiUnchecked() const
    {
        ASSERT(type() == Type::Smi);
        return static_cast<int32_t>(m_value >> 32);
    }
};

} // namespace shim

using shim::TaggedPointer;

} // namespace v8
