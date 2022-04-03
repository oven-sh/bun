/*
 * Copyright 2020 Google LLC
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SkImageGeneratorNDK_DEFINED
#define SkImageGeneratorNDK_DEFINED

#include "include/core/SkTypes.h"
#ifdef SK_ENABLE_NDK_IMAGES

#include "include/core/SkData.h"
#include "include/core/SkImageGenerator.h"

#include <memory>

namespace SkImageGeneratorNDK {
/**
 *  Create a generator that uses the Android NDK's APIs for decoding images.
 *
 *  Only supported on devices where __ANDROID_API__ >= 30.
 *
 *  As with SkCodec, the SkColorSpace passed to getPixels() determines the
 *  type of color space transformations to apply. A null SkColorSpace means to
 *  apply none.
 *
 *  A note on scaling: Calling getPixels() on the resulting SkImageGenerator
 *  with dimensions that do not match getInfo() requests a scale. For WebP
 *  files, dimensions smaller than those of getInfo are supported. For Jpeg
 *  files, dimensions of 1/2, 1/4, and 1/8 are supported. TODO: Provide an
 *  API like SkCodecImageGenerator::getScaledDimensions() to report which
 *  dimensions are supported?
 */
SK_API std::unique_ptr<SkImageGenerator> MakeFromEncodedNDK(sk_sp<SkData>);
}

#endif // SK_ENABLE_NDK_IMAGES
#endif // SkImageGeneratorNDK_DEFINED
