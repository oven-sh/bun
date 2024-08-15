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

    TaggedPointer map;
    uintptr_t unused[4];
    TaggedPointer kind;

    Oddball(Kind kind_, const Map* map_ = &Map::oddball_map)
        : map(const_cast<Map*>(map_))
        , kind(TaggedPointer(static_cast<int>(kind_)))
    {
    }
};

}
