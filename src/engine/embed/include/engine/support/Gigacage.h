#pragma once

#include "engine/support/FastMalloc.h"

// Memory for the contents of array buffers.
namespace Gigacage {

enum Kind { Primitive };

inline void* tryMalloc(Kind, size_t size) { return FastMalloc::tryMalloc(size); }
inline void* tryRealloc(Kind, void* pointer, size_t size) { return FastMalloc::tryRealloc(pointer, size); }
inline void free(Kind, void* pointer) { FastMalloc::free(pointer); }

}
