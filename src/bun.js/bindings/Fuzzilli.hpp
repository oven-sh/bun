#ifndef BUN_FUZZILLI_HPP
#define BUN_FUZZILLI_HPP

#include "ZigGlobalObject.h"

namespace Bun::Fuzzilli {

namespace Js {

/// @brief Register the Fuzzilli-specific runtime functions on the provided global object.
void Register(Zig::GlobalObject* go);

} // namespace Js

} // namespace Bun::Fuzzilli

#endif // BUN_FUZZILLI_HPP
