/*
 * Copyright 2020 Google Inc.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SkOpts_spi_DEFINED
#define SkOpts_spi_DEFINED

#include "include/core/SkTypes.h"

// These are exposed as SK_SPI (e.g. SkParagraph), the rest of SkOpts is
// declared in src/core

namespace SkOpts {
    // The fastest high quality 32-bit hash we can provide on this platform.
    extern uint32_t SK_SPI (*hash_fn)(const void* data, size_t bytes, uint32_t seed);
} // namespace SkOpts

#endif
