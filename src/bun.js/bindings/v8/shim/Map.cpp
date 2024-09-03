#include "Map.h"

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
