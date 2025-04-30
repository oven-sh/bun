#include "Map.h"
#include "real_v8.h"

static_assert(offsetof(v8::shim::Map, m_metaMap) == real_v8::internal::Internals::kHeapObjectMapOffset,
    "v8::Map map pointer is at wrong offset");
static_assert(offsetof(v8::shim::Map, m_instanceType) == real_v8::internal::Internals::kMapInstanceTypeOffset,
    "v8::Map instance type is at wrong offset");

static_assert((int)v8::shim::InstanceType::String < real_v8::internal::Internals::kFirstNonstringType,
    "String instance type is not a string");
static_assert((int)v8::shim::InstanceType::Oddball == real_v8::internal::Internals::kOddballType,
    "Oddball instance type does not match V8");
static_assert((int)v8::shim::InstanceType::Object >= real_v8::internal::Internals::kFirstNonstringType,
    "Objects are strings");
static_assert((int)v8::shim::InstanceType::HeapNumber >= real_v8::internal::Internals::kFirstNonstringType,
    "HeapNumbers are strings");

static_assert(real_v8::internal::Internals::CanHaveInternalField((int)v8::shim::InstanceType::Object) == false,
    "Object instance type appears compatible with internal fields"
    "(so V8 will use direct pointer offsets instead of calling the slow path)");

namespace v8 {
namespace shim {

// TODO give these more appropriate instance types
const Map Map::map_map(InstanceType::Object);
const Map Map::object_map(InstanceType::Object);
const Map Map::oddball_map(InstanceType::Oddball);
const Map Map::string_map(InstanceType::String);
const Map Map::heap_number_map(InstanceType::HeapNumber);

} // namespace shim
} // namespace v8
