#pragma once

#include "V8TaggedPointer.h"

namespace v8 {

class GlobalInternals;

// Container for some data that V8 expects to find at certain offsets. Isolate and Context pointers
// actually point to this object. It is a separate struct so that we can use offsetof() to make sure
// the layout is correct.
struct Roots {
    // v8-internal.h:775
    static constexpr int kUndefinedValueRootIndex = 4;
    static constexpr int kTheHoleValueRootIndex = 5;
    static constexpr int kNullValueRootIndex = 6;
    static constexpr int kTrueValueRootIndex = 7;
    static constexpr int kFalseValueRootIndex = 8;

    static constexpr int rootsSize = 9;

    GlobalInternals* parent;

    uintptr_t padding[73];

    TaggedPointer roots[rootsSize];

    Roots(GlobalInternals* parent);
};

// kIsolateRootsOffset at v8-internal.h:744
static_assert(offsetof(Roots, roots) == 592, "Roots does not match V8 layout");

}
