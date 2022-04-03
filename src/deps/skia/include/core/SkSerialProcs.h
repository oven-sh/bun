/*
 * Copyright 2017 Google Inc.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SkSerialProcs_DEFINED
#define SkSerialProcs_DEFINED

#include "include/core/SkImage.h"
#include "include/core/SkPicture.h"
#include "include/core/SkTypeface.h"

/**
 *  A serial-proc is asked to serialize the specified object (e.g. picture or image).
 *  If a data object is returned, it will be used (even if it is zero-length).
 *  If null is returned, then Skia will take its default action.
 *
 *  The default action for pictures is to use Skia's internal format.
 *  The default action for images is to encode either in its native format or PNG.
 *  The default action for typefaces is to use Skia's internal format.
 */

typedef sk_sp<SkData> (*SkSerialPictureProc)(SkPicture*, void* ctx);
typedef sk_sp<SkData> (*SkSerialImageProc)(SkImage*, void* ctx);
typedef sk_sp<SkData> (*SkSerialTypefaceProc)(SkTypeface*, void* ctx);

/**
 *  Called with the encoded form of a picture (previously written with a custom
 *  SkSerialPictureProc proc). Return a picture object, or nullptr indicating failure.
 */
typedef sk_sp<SkPicture> (*SkDeserialPictureProc)(const void* data, size_t length, void* ctx);

/**
 *  Called with the encoded from of an image. The proc can return an image object, or if it
 *  returns nullptr, then Skia will take its default action to try to create an image from the data.
 *
 *  Note that unlike SkDeserialPictureProc and SkDeserialTypefaceProc, return nullptr from this
 *  does not indicate failure, but is a signal for Skia to take its default action.
 */
typedef sk_sp<SkImage> (*SkDeserialImageProc)(const void* data, size_t length, void* ctx);

/**
 *  Called with the encoded form of a typeface (previously written with a custom
 *  SkSerialTypefaceProc proc). Return a typeface object, or nullptr indicating failure.
 */
typedef sk_sp<SkTypeface> (*SkDeserialTypefaceProc)(const void* data, size_t length, void* ctx);

struct SK_API SkSerialProcs {
    SkSerialPictureProc fPictureProc = nullptr;
    void*               fPictureCtx = nullptr;

    SkSerialImageProc   fImageProc = nullptr;
    void*               fImageCtx = nullptr;

    SkSerialTypefaceProc fTypefaceProc = nullptr;
    void*                fTypefaceCtx = nullptr;
};

struct SK_API SkDeserialProcs {
    SkDeserialPictureProc   fPictureProc = nullptr;
    void*                   fPictureCtx = nullptr;

    SkDeserialImageProc     fImageProc = nullptr;
    void*                   fImageCtx = nullptr;

    SkDeserialTypefaceProc  fTypefaceProc = nullptr;
    void*                   fTypefaceCtx = nullptr;
};

#endif

