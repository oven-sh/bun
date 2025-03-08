#pragma once

// This file includes the actual V8 headers, with the namespace renamed from v8 to real_v8. To
// minimize potential conflicts between V8 and Bun's implementation, it should only be included by
// files from Bun's V8 implementation, and it should only be included in source files (not
// header files).

// Microsoft's C++ headers cause a compiler error if `private` has been redefined, like we do below.
// These are all the standard library headers included by V8. We include them here so that they
// are included while `private` is not redefined yet, and then when V8 includes them they will get
// skipped by include guards.

#include <array>
#include <atomic>
#include <bit>
#include <cassert>
#include <climits>
#include <cstddef>
#include <cstdint>
#include <fstream>
#include <functional>
#include <iosfwd>
#include <iterator>
#include <limits>
#include <memory>
#include <new>
#include <optional>
#include <ostream>
#include <string>
#include <tuple>
#include <utility>
#include <vector>

#define v8 real_v8
#define private public
#include "node/v8.h"
#undef private
#undef v8
