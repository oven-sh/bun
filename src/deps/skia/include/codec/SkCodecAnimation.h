/*
 * Copyright 2016 Google Inc.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SkCodecAnimation_DEFINED
#define SkCodecAnimation_DEFINED

namespace SkCodecAnimation {
    /**
     *  This specifies how the next frame is based on this frame.
     *
     *  Names are based on the GIF 89a spec.
     *
     *  The numbers correspond to values in a GIF.
     */
    enum class DisposalMethod {
        /**
         *  The next frame should be drawn on top of this one.
         *
         *  In a GIF, a value of 0 (not specified) is also treated as Keep.
         */
        kKeep               = 1,

        /**
         *  Similar to Keep, except the area inside this frame's rectangle
         *  should be cleared to the BackGround color (transparent) before
         *  drawing the next frame.
         */
        kRestoreBGColor     = 2,

        /**
         *  The next frame should be drawn on top of the previous frame - i.e.
         *  disregarding this one.
         *
         *  In a GIF, a value of 4 is also treated as RestorePrevious.
         */
        kRestorePrevious    = 3,
    };

    /**
     * How to blend the current frame.
     */
    enum class Blend {
        /**
         *  Blend with the prior frame as if using SkBlendMode::kSrcOver.
         */
        kSrcOver,

        /**
         *  Blend with the prior frame as if using SkBlendMode::kSrc.
         *
         *  This frame's pixels replace the destination pixels.
         */
        kSrc,
    };

} // namespace SkCodecAnimation
#endif // SkCodecAnimation_DEFINED
