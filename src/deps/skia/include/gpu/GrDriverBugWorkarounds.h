/*
 * Copyright 2018 Google Inc.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef GrDriverBugWorkarounds_DEFINED
#define GrDriverBugWorkarounds_DEFINED

// External embedders of Skia can override this to use their own list
// of workaround names.
#ifdef SK_GPU_WORKAROUNDS_HEADER
#include SK_GPU_WORKAROUNDS_HEADER
#else
// To regenerate this file, set gn arg "skia_generate_workarounds = true".
// This is not rebuilt by default to avoid embedders having to have extra
// build steps.
#include "include/gpu/GrDriverBugWorkaroundsAutogen.h"
#endif

#include "include/core/SkTypes.h"

#include <stdint.h>
#include <vector>

enum GrDriverBugWorkaroundType {
#define GPU_OP(type, name) type,
  GPU_DRIVER_BUG_WORKAROUNDS(GPU_OP)
#undef GPU_OP
  NUMBER_OF_GPU_DRIVER_BUG_WORKAROUND_TYPES
};

class SK_API GrDriverBugWorkarounds {
 public:
  GrDriverBugWorkarounds();
  GrDriverBugWorkarounds(const GrDriverBugWorkarounds&) = default;
  explicit GrDriverBugWorkarounds(const std::vector<int32_t>& workarounds);

  GrDriverBugWorkarounds& operator=(const GrDriverBugWorkarounds&) = default;

  // Turn on any workarounds listed in |workarounds| (but don't turn any off).
  void applyOverrides(const GrDriverBugWorkarounds& workarounds);

  ~GrDriverBugWorkarounds();

#define GPU_OP(type, name) bool name = false;
  GPU_DRIVER_BUG_WORKAROUNDS(GPU_OP)
#undef GPU_OP
};

#endif
