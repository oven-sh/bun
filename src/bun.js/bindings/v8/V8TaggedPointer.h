#pragma once

#include "v8.h"

namespace v8 {

struct TaggedPointer {
    uintptr_t value;

    enum class Type : uint8_t {
        Smi,
        StrongPointer,
        WeakPointer,
    };

    TaggedPointer()
        : TaggedPointer(nullptr) {};
    TaggedPointer(const TaggedPointer&) = default;
    TaggedPointer& operator=(const TaggedPointer&) = default;
    bool operator==(const TaggedPointer& other) const { return value == other.value; }

    TaggedPointer(void* ptr, bool weak)
        : value(reinterpret_cast<uintptr_t>(ptr) | (weak ? 3 : 1))
    {
        RELEASE_ASSERT((reinterpret_cast<uintptr_t>(ptr) & 3) == 0);
    }

    TaggedPointer(void* ptr)
        : TaggedPointer(ptr, false)
    {
    }

    TaggedPointer(int32_t smi)
        : value(static_cast<uintptr_t>(smi) << 32)
    {
    }

    static TaggedPointer fromRaw(uintptr_t raw)
    {
        TaggedPointer tagged;
        tagged.value = raw;
        return tagged;
    }

    Type type() const
    {
        switch (value & 3) {
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
        return reinterpret_cast<T*>(value & ~3ull);
    }

    bool getSmi(int32_t& smi) const
    {
        if (type() != Type::Smi) {
            return false;
        }
        smi = static_cast<int32_t>(value >> 32);
        return true;
    }

    int32_t getSmiUnchecked() const
    {
        ASSERT(type() == Type::Smi);
        return static_cast<int32_t>(value >> 32);
    }

    JSC::JSValue getJSValue() const
    {
        int32_t smi;
        if (getSmi(smi)) {
            return JSC::jsNumber(smi);
        }
        return getPtr();
    }
};

}
