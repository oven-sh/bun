/*
 * Copyright 2021 Google LLC.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SKSL_DSL_RUNTIME_EFFECTS
#define SKSL_DSL_RUNTIME_EFFECTS

#include "include/effects/SkRuntimeEffect.h"
#include "include/sksl/DSL.h"

namespace SkSL {

class Compiler;

namespace dsl {

#ifndef SKSL_STANDALONE

void StartRuntimeShader(SkSL::Compiler* compiler);

sk_sp<SkRuntimeEffect> EndRuntimeShader(SkRuntimeEffect::Options options = {});

#endif

} // namespace dsl

} // namespace SkSL

#endif
