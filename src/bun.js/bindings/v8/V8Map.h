#pragma once

#include "V8TaggedPointer.h"

namespace v8 {

enum class InstanceType : uint16_t {
    // v8-internal.h:787, kFirstNonstringType is 0x80
    String = 0x7f,
    // "Oddball" in V8 means undefined or null
    // v8-internal.h:788
    Oddball = 0x83,
    // v8-internal.h:1016 kFirstNonstringType
    // this cannot be kJSObjectType (or anything in the range [kJSObjectType, kLastJSApiObjectType])
    // because then V8 will try to access internal fields directly instead of calling
    // SlowGetInternalField
    Object = 0x80,
    // a number that doesn't fit in int32_t and is stored on the heap (for us, in the
    // HandleScopeBuffer)
    HeapNumber = 0x82,
};

// V8's description of the structure of an object
struct Map {
    // the structure of the map itself (always points to map_map)
    TaggedPointer meta_map;
    // TBD whether we need to put anything here to please inlined V8 functions
    uint32_t unused;
    // describes which kind of object this is. we shouldn't actually need to create very many
    // instance types -- only ones for primitives, and one to make sure V8 thinks it cannot take the
    // fast path when accessing internal fields
    // (v8::internal::Internals::CanHaveInternalField, in v8-internal.h)
    InstanceType instance_type;

    // the map used by maps
    static const Map map_map;
    // the map used by objects inheriting JSCell
    static const Map object_map;
    // the map used by pointers to non-JSCell objects stored in handles
    static const Map raw_ptr_map;
    // the map used by oddballs (null, undefined)
    static const Map oddball_map;
    // the map used by booleans
    static const Map boolean_map;
    // the map used by strings
    static const Map string_map;
    // the map used by heap numbers
    static const Map heap_number_map;

    Map(InstanceType instance_type_)
        : meta_map(const_cast<Map*>(&map_map))
        , unused(0xaaaaaaaa)
        , instance_type(instance_type_)
    {
    }
};

static_assert(sizeof(Map) == 16, "Map has wrong layout");

}
