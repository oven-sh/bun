/*
 * Copyright 2011 Google Inc.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SkTypeface_win_DEFINED
#define SkTypeface_win_DEFINED

#include "include/core/SkTypeface.h"
#include "include/core/SkTypes.h"

#ifdef SK_BUILD_FOR_WIN

#ifdef UNICODE
typedef struct tagLOGFONTW LOGFONTW;
typedef LOGFONTW LOGFONT;
#else
typedef struct tagLOGFONTA LOGFONTA;
typedef LOGFONTA LOGFONT;
#endif  // UNICODE

/**
 *  Like the other Typeface create methods, this returns a new reference to the
 *  corresponding typeface for the specified logfont. The caller is responsible
 *  for calling unref() when it is finished.
 */
SK_API SkTypeface* SkCreateTypefaceFromLOGFONT(const LOGFONT&);

/**
 *  Copy the LOGFONT associated with this typeface into the lf parameter. Note
 *  that the lfHeight will need to be set afterwards, since the typeface does
 *  not track this (the paint does).
 *  typeface may be NULL, in which case we return the logfont for the default font.
 */
SK_API void SkLOGFONTFromTypeface(const SkTypeface* typeface, LOGFONT* lf);

/**
  *  Set an optional callback to ensure that the data behind a LOGFONT is loaded.
  *  This will get called if Skia tries to access the data but hits a failure.
  *  Normally this is null, and is only required if the font data needs to be
  *  remotely (re)loaded.
  */
SK_API void SkTypeface_SetEnsureLOGFONTAccessibleProc(void (*)(const LOGFONT&));

// Experimental!
//
class SkFontMgr;
class SkRemotableFontMgr;
struct IDWriteFactory;
struct IDWriteFontCollection;
struct IDWriteFontFallback;

SK_API sk_sp<SkFontMgr> SkFontMgr_New_GDI();
SK_API sk_sp<SkFontMgr> SkFontMgr_New_DirectWrite(IDWriteFactory* factory = NULL,
                                                  IDWriteFontCollection* collection = NULL);
SK_API sk_sp<SkFontMgr> SkFontMgr_New_DirectWrite(IDWriteFactory* factory,
                                                  IDWriteFontCollection* collection,
                                                  IDWriteFontFallback* fallback);

/**
 *  Creates an SkFontMgr which renders using DirectWrite and obtains its data
 *  from the SkRemotableFontMgr.
 *
 *  If DirectWrite could not be initialized, will return NULL.
 */
SK_API sk_sp<SkFontMgr> SkFontMgr_New_DirectWriteRenderer(sk_sp<SkRemotableFontMgr>);

/**
 *  Creates an SkRemotableFontMgr backed by DirectWrite using the default
 *  system font collection in the current locale.
 *
 *  If DirectWrite could not be initialized, will return NULL.
 */
SK_API sk_sp<SkRemotableFontMgr> SkRemotableFontMgr_New_DirectWrite();

#endif  // SK_BUILD_FOR_WIN
#endif  // SkTypeface_win_DEFINED
