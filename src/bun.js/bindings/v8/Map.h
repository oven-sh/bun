#pragma once

#include "v8/TaggedPointer.h"

namespace v8 {

enum class InstanceType : uint16_t {
    // "Oddball" in V8 means undefined or null
    Oddball = 0x83,
};

class Map {
    TaggedPointer meta_map;
    uint32_t unused;
    InstanceType instance_type;
};

}
