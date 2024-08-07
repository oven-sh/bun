#pragma once

#include "v8/TaggedPointer.h"
#include "v8/Map.h"

namespace v8 {

struct Oddball {
    enum class Kind : int {
        undefined = 4,
        null = 3,
    };

    TaggedPointer map;
    uintptr_t unused[4];
    TaggedPointer kind;

    Oddball(Kind kind_)
        : map(const_cast<Map*>(&Map::oddball_map))
        , kind(TaggedPointer(static_cast<int>(kind_)))
    {
    }
};

}
