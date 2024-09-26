#pragma once

// This file includes the actual V8 headers, with the namespace renamed from v8 to real_v8. To
// minimize potential conflicts between V8 and Bun's implementation, it should only be included by
// files from Bun's V8 implementation, and it should only be included in source files (not
// header files).

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
