#include "v8/Map.h"

namespace v8 {

// TODO give this a more appropriate instance type
const Map Map::map_map(InstanceType::Oddball);

}
