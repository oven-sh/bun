#include "TaggedPointer.h"
#include "../real_v8.h"

static_assert(sizeof(v8::shim::TaggedPointer) == sizeof(real_v8::internal::Address),
    "TaggedPointer has wrong size");

static_assert(alignof(v8::shim::TaggedPointer) == alignof(real_v8::internal::Address),
    "TaggedPointer has wrong alignment");
