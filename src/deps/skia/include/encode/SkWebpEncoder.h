/*
 * Copyright 2017 Google Inc.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SkWebpEncoder_DEFINED
#define SkWebpEncoder_DEFINED

#include "include/encode/SkEncoder.h"

class SkWStream;

namespace SkWebpEncoder {

    enum class Compression {
        kLossy,
        kLossless,
    };

    struct SK_API Options {
        /**
         *  |fCompression| determines whether we will use webp lossy or lossless compression.
         *
         *  |fQuality| must be in [0.0f, 100.0f].
         *  If |fCompression| is kLossy, |fQuality| corresponds to the visual quality of the
         *  encoding.  Decreasing the quality will result in a smaller encoded image.
         *  If |fCompression| is kLossless, |fQuality| corresponds to the amount of effort
         *  put into the encoding.  Lower values will compress faster into larger files,
         *  while larger values will compress slower into smaller files.
         *
         *  This scheme is designed to match the libwebp API.
         */
        Compression fCompression = Compression::kLossy;
        float fQuality = 100.0f;
    };

    /**
     *  Encode the |src| pixels to the |dst| stream.
     *  |options| may be used to control the encoding behavior.
     *
     *  Returns true on success.  Returns false on an invalid or unsupported |src|.
     */
    SK_API bool Encode(SkWStream* dst, const SkPixmap& src, const Options& options);
} // namespace SkWebpEncoder

#endif
