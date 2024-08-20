#include "V8Map.h"

namespace v8 {

// TODO give these more appropriate instance types
const Map Map::map_map(InstanceType::Object);
const Map Map::object_map(InstanceType::Object);
const Map Map::raw_ptr_map(InstanceType::Object);
const Map Map::oddball_map(InstanceType::Oddball);
const Map Map::boolean_map(InstanceType::Oddball);
const Map Map::string_map(InstanceType::String);
const Map Map::heap_number_map(InstanceType::HeapNumber);

}
