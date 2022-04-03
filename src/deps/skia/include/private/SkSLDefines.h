/*
 * Copyright 2019 Google Inc.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SKSL_DEFINES
#define SKSL_DEFINES

#include <cstdint>

#include "include/core/SkTypes.h"
#include "include/private/SkTArray.h"

using SKSL_INT = int64_t;
using SKSL_FLOAT = float;

namespace SkSL {

class Expression;
class Statement;

using ComponentArray = SkSTArray<4, int8_t>; // for Swizzles
using ExpressionArray = SkSTArray<2, std::unique_ptr<Expression>>;
using StatementArray = SkSTArray<2, std::unique_ptr<Statement>>;

// Functions larger than this (measured in IR nodes) will not be inlined. This growth factor
// accounts for the number of calls being inlined--i.e., a function called five times (that is, with
// five inlining opportunities) would be considered 5x larger than if it were called once. This
// default threshold value is arbitrary, but tends to work well in practice.
static constexpr int kDefaultInlineThreshold = 50;

// A hard upper limit on the number of variable slots allowed in a function/global scope.
// This is an arbitrary limit, but is needed to prevent code generation from taking unbounded
// amounts of time or space.
static constexpr int kVariableSlotLimit = 100000;

// The SwizzleComponent namespace is used both by the SkSL::Swizzle expression, and the DSL swizzle.
// This namespace is injected into SkSL::dsl so that `using namespace SkSL::dsl` enables DSL code
// like `Swizzle(var, X, Y, ONE)` to compile without any extra qualifications.
namespace SwizzleComponent {

enum Type : int8_t {
    X  =  0,  Y =  1,  Z =  2,  W =  3,
    R  =  4,  G =  5,  B =  6,  A =  7,
    S  =  8,  T =  9,  P = 10,  Q = 11,
    UL = 12, UT = 13, UR = 14, UB = 15,
    ZERO,
    ONE
};

}  // namespace SwizzleComponent
}  // namespace SkSL

#endif
