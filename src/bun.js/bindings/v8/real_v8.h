#pragma once

// This file includes the actual V8 headers, with the namespace renamed from v8 to real_v8. To
// minimize potential conflicts between V8 and Bun's implementation, it should only be included by
// files from Bun's V8 implementation, and it should only be included in source files (not
// header files).

#define v8 real_v8
#define private public
#include "node/v8.h"
#undef private
#undef v8
