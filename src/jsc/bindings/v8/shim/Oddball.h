#pragma once

#include "root.h"
#include "TaggedPointer.h"
#include "Map.h"

namespace v8 {
namespace shim {

struct Oddball {
    enum class Kind : int {
        kUndefined = 4,
        kNull = 3,
        kInvalid = 255,
        kTrue = 99,
        kFalse = 98,
    };

    TaggedPointer m_map;
    uintptr_t m_unused[4];
    TaggedPointer m_kind;

    Oddball(Kind kind)
        : m_map(const_cast<Map*>(&Map::oddball_map()))
        , m_kind(TaggedPointer(static_cast<int>(kind)))
    {
    }

    Kind kind() const
    {
        return (Kind)m_kind.getSmiUnchecked();
    }

    JSC::JSValue toJSValue() const
    {
        switch (kind()) {
        case Kind::kUndefined:
            return JSC::jsUndefined();
        case Kind::kNull:
            return JSC::jsNull();
        case Kind::kTrue:
            return JSC::jsBoolean(true);
        case Kind::kFalse:
            return JSC::jsBoolean(false);
        default:
            RELEASE_ASSERT_NOT_REACHED();
        }
    }
};

} // namespace shim
} // namespace v8
