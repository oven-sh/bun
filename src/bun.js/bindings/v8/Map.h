#pragma once

#include "v8/TaggedPointer.h"

namespace v8 {

enum class InstanceType : uint16_t {
    // "Oddball" in V8 means undefined or null
    Oddball = 0x83,
};

// V8's description of the structure of an object
class Map {
    // the structure of the map itself (always points to map_map)
    TaggedPointer meta_map;
    // TBD whether we need to put anything here to please inlined V8 functions
    uint32_t unused;
    // describes which kind of object this is. we shouldn't actually need to create very many
    // instance types -- only ones for primitives, and one to make sure V8 thinks it cannot take the
    // fast path when accessing internal fields
    // (v8::internal::Internals::CanHaveInternalField, in v8-internal.h)
    InstanceType instance_type;

public:
    // the map used by maps
    static const Map map_map;

    Map(InstanceType instance_type_)
        : meta_map(const_cast<Map*>(&map_map))
        , unused(0xaaaaaaaa)
        , instance_type(instance_type_)
    {
    }
};

}
