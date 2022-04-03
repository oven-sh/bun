/*
 * Copyright 2020 Google LLC
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SKSL_DSL
#define SKSL_DSL

#include "include/sksl/DSLCore.h"

namespace SkSL {

namespace dsl {

using Block = DSLBlock;
using Case = DSLCase;
using Expression = DSLExpression;
using Field = DSLField;
using Function = DSLFunction;
using GlobalVar = DSLGlobalVar;
using Layout = DSLLayout;
using Modifiers = DSLModifiers;
using Parameter = DSLParameter;
using Statement = DSLStatement;
using Var = DSLVar;
template<typename T> using Wrapper = DSLWrapper<T>;

} // namespace dsl

} // namespace SkSL

#endif
