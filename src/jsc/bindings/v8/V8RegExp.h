#pragma once

#include "v8.h"
#include "V8Object.h"
#include "V8Local.h"

namespace v8 {

class String;

class RegExp : public Object {
public:
    enum Flags {
        kNone = 0,
        kGlobal = 1 << 0,
        kIgnoreCase = 1 << 1,
        kMultiline = 1 << 2,
        kSticky = 1 << 3,
        kUnicode = 1 << 4,
        kDotAll = 1 << 5,
        kLinear = 1 << 6,
        kHasIndices = 1 << 7,
        kUnicodeSets = 1 << 8,
    };

    static constexpr int kFlagCount = 9;

    // The pattern as the `source` getter shows it (an empty pattern is "(?:)").
    BUN_EXPORT Local<String> GetSource() const;
    BUN_EXPORT Flags GetFlags() const;
};

} // namespace v8
