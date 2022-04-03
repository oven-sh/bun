/*
 * Copyright 2011 Google Inc.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SkImageEncoder_DEFINED
#define SkImageEncoder_DEFINED

// TODO: update clients so we can remove this include, they should IWYU
#include "include/core/SkBitmap.h"

#include "include/core/SkData.h"
#include "include/core/SkEncodedImageFormat.h"
#include "include/core/SkPixmap.h"
#include "include/core/SkStream.h"

class SkBitmap;

/**
 * Encode SkPixmap in the given binary image format.
 *
 * @param  dst     results are written to this stream.
 * @param  src     source pixels.
 * @param  format  image format, not all formats are supported.
 * @param  quality range from 0-100, this is supported by jpeg and webp.
 *                 higher values correspond to improved visual quality, but less compression.
 *
 * @return false iff input is bad or format is unsupported.
 *
 * Will always return false if Skia is compiled without image
 * encoders.
 *
 * For SkEncodedImageFormat::kWEBP, if quality is 100, it will use lossless compression. Otherwise
 * it will use lossy.
 *
 * For examples of encoding an image to a file or to a block of memory,
 * see tools/ToolUtils.h.
 */
SK_API bool SkEncodeImage(SkWStream* dst, const SkPixmap& src,
                          SkEncodedImageFormat format, int quality);

/**
 * The following helper function wraps SkEncodeImage().
 */
SK_API bool SkEncodeImage(SkWStream* dst, const SkBitmap& src, SkEncodedImageFormat f, int q);

/**
 * Encode SkPixmap in the given binary image format.
 *
 * @param  src     source pixels.
 * @param  format  image format, not all formats are supported.
 * @param  quality range from 0-100, this is supported by jpeg and webp.
 *                 higher values correspond to improved visual quality, but less compression.
 *
 * @return encoded data or nullptr if input is bad or format is unsupported.
 *
 * Will always return nullptr if Skia is compiled without image
 * encoders.
 *
 * For SkEncodedImageFormat::kWEBP, if quality is 100, it will use lossless compression. Otherwise
 * it will use lossy.
 */
SK_API sk_sp<SkData> SkEncodePixmap(const SkPixmap& src, SkEncodedImageFormat format, int quality);

/**
 *  Helper that extracts the pixmap from the bitmap, and then calls SkEncodePixmap()
 */
SK_API sk_sp<SkData> SkEncodeBitmap(const SkBitmap& src, SkEncodedImageFormat format, int quality);

#endif  // SkImageEncoder_DEFINED
