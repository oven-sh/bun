#pragma once

#include "TaggedPointer.h"

namespace v8 {
namespace shim {

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
    TaggedPointer m_metaMap;
    // TBD whether we need to put anything here to please inlined V8 functions
    uint32_t m_unused;
    // describes which kind of object this is. we shouldn't actually need to create very many
    // instance types -- only ones for primitives, and one to make sure V8 thinks it cannot take the
    // fast path when accessing internal fields
    // (v8::internal::Internals::CanHaveInternalField, in v8-internal.h)
    InstanceType m_instanceType;

    // Since maps are V8 objects, they each also have a map pointer at the start, which is this one
    static const Map& map_map();
    // All V8 values not covered by a more specific map use this one
    static const Map& object_map();
    // The map used by null, undefined, true, and false. Required since V8 checks these values'
    // instance type in the inline QuickIs* functions
    static const Map& oddball_map();
    // All strings use this map. Required since V8's inline QuickIsString() checks the instance
    // type.
    static const Map& string_map();
    // Handles containing a double instead of a JSCell pointer use this map so that we can tell they
    // are numbers.
    static const Map& heap_number_map();

    Map(InstanceType instance_type)
        : m_metaMap(const_cast<Map*>(&map_map()))
        , m_unused(0xaaaaaaaa)
        , m_instanceType(instance_type)
    {
    }

    // Separate constructor for map_map (the Map used by maps). We need this because map_map's
    // metaMap needs to point to itself, and we can't call map_map() while initializing map_map()
    // because that would recurse infinitely.
    enum class MapMapTag {
        MapMap
    };

    Map(MapMapTag)
        : m_metaMap(this)
        , m_unused(0xaaaaaaaa)
        , m_instanceType(InstanceType::Object)
    {
    }
};

static_assert(sizeof(Map) == 16, "Map has wrong layout");
static_assert(offsetof(Map, m_metaMap) == 0, "Map has wrong layout");
static_assert(offsetof(Map, m_instanceType) == 12, "Map has wrong layout");

} // namespace shim
} // namespace v8
