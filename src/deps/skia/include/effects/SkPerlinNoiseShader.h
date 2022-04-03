/*
 * Copyright 2013 Google Inc.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SkPerlinNoiseShader_DEFINED
#define SkPerlinNoiseShader_DEFINED

#include "include/core/SkShader.h"

/** \class SkPerlinNoiseShader

    SkPerlinNoiseShader creates an image using the Perlin turbulence function.

    It can produce tileable noise if asked to stitch tiles and provided a tile size.
    In order to fill a large area with repeating noise, set the stitchTiles flag to
    true, and render exactly a single tile of noise. Without this flag, the result
    will contain visible seams between tiles.

    The algorithm used is described here :
    http://www.w3.org/TR/SVG/filters.html#feTurbulenceElement
*/
class SK_API SkPerlinNoiseShader {
public:
    /**
     *  This will construct Perlin noise of the given type (Fractal Noise or Turbulence).
     *
     *  Both base frequencies (X and Y) have a usual range of (0..1) and must be non-negative.
     *
     *  The number of octaves provided should be fairly small, with a limit of 255 enforced.
     *  Each octave doubles the frequency, so 10 octaves would produce noise from
     *  baseFrequency * 1, * 2, * 4, ..., * 512, which quickly yields insignificantly small
     *  periods and resembles regular unstructured noise rather than Perlin noise.
     *
     *  If tileSize isn't NULL or an empty size, the tileSize parameter will be used to modify
     *  the frequencies so that the noise will be tileable for the given tile size. If tileSize
     *  is NULL or an empty size, the frequencies will be used as is without modification.
     */
    static sk_sp<SkShader> MakeFractalNoise(SkScalar baseFrequencyX, SkScalar baseFrequencyY,
                                            int numOctaves, SkScalar seed,
                                            const SkISize* tileSize = nullptr);
    static sk_sp<SkShader> MakeTurbulence(SkScalar baseFrequencyX, SkScalar baseFrequencyY,
                                          int numOctaves, SkScalar seed,
                                          const SkISize* tileSize = nullptr);

    static void RegisterFlattenables();

private:
    SkPerlinNoiseShader() = delete;
};

#endif
