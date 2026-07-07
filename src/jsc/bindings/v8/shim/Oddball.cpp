#include "Oddball.h"
#include "real_v8.h"

#define CHECK_ODDBALL_KIND(KIND)                                                                         \
    static_assert((int)v8::shim::Oddball::Kind::KIND == real_v8::internal::Internals::KIND##OddballKind, \
        "Oddball kind " #KIND " does not match V8");

// true and false are unchecked, as those are only defined by class v8::internal::Oddball in
// src/objects/oddball.h which is not included in the API headers. I haven't seen a case where an
// inline function relies on those values. For now, we intentionally *don't* match V8's kind values
// for true and false so that an error will be apparent if V8 ever does rely on them.
CHECK_ODDBALL_KIND(kNull)
CHECK_ODDBALL_KIND(kUndefined)

static_assert(offsetof(v8::shim::Oddball, m_map) == real_v8::internal::Internals::kHeapObjectMapOffset,
    "Oddball map field is at wrong offset");

static_assert(offsetof(v8::shim::Oddball, m_kind) == real_v8::internal::Internals::kOddballKindOffset);
