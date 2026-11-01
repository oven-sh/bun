#pragma once

#include "V8Primitive.h"

namespace v8 {

// Base class for v8::String and v8::Symbol.
class Name : public Primitive {};

} // namespace v8
