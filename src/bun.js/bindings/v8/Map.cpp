#include "v8/Map.h"

namespace v8 {

// TODO give these more appropriate instance types
const Map Map::map_map(InstanceType::Oddball);
const Map Map::object_map(InstanceType::Oddball);
const Map Map::raw_ptr_map(InstanceType::Oddball);
const Map Map::oddball_map(InstanceType::Oddball);
const Map Map::boolean_map(InstanceType::Oddball);

}
