/*
 * Copyright 2018 Google Inc.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SkAnimCodecPlayer_DEFINED
#define SkAnimCodecPlayer_DEFINED

#include "include/codec/SkCodec.h"

class SkImage;

class SkAnimCodecPlayer {
public:
    SkAnimCodecPlayer(std::unique_ptr<SkCodec> codec);
    ~SkAnimCodecPlayer();

    /**
     *  Returns the current frame of the animation. This defaults to the first frame for
     *  animated codecs (i.e. msec = 0). Calling this multiple times (without calling seek())
     *  will always return the same image object (or null if there was an error).
     */
    sk_sp<SkImage> getFrame();

    /**
     *  Return the size of the image(s) that will be returned by getFrame().
     */
    SkISize dimensions() const;

    /**
     *  Returns the total duration of the animation in milliseconds. Returns 0 for a single-frame
     *  image.
     */
    uint32_t duration() const { return fTotalDuration; }

    /**
     *  Finds the closest frame associated with the time code (in milliseconds) and sets that
     *  to be the current frame (call getFrame() to retrieve that image).
     *  Returns true iff this call to seek() changed the "current frame" for the animation.
     *  Thus if seek() returns false, then getFrame() will return the same image as it did
     *  before this call to seek().
     */
    bool seek(uint32_t msec);


private:
    std::unique_ptr<SkCodec>        fCodec;
    SkImageInfo                     fImageInfo;
    std::vector<SkCodec::FrameInfo> fFrameInfos;
    std::vector<sk_sp<SkImage> >    fImages;
    int                             fCurrIndex = 0;
    uint32_t                        fTotalDuration;

    sk_sp<SkImage> getFrameAt(int index);
};

#endif

