#pragma once

#include "V8TaggedPointer.h"
#include "V8Map.h"

namespace v8 {

struct Oddball {
    enum class Kind : int {
        kUndefined = 4,
        kNull = 3,
        kInvalid = 255,
        kTrue = 1,
        kFalse = 0,
    };

    TaggedPointer m_map;
    uintptr_t m_unused[4];
    TaggedPointer m_kind;

    Oddball(Kind kind)
        : m_map(const_cast<Map*>(&Map::oddball_map))
        , m_kind(TaggedPointer(static_cast<int>(kind)))
    {
    }
};

}
