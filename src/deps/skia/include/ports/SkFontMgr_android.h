/*
 * Copyright 2015 Google Inc.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SkFontMgr_android_DEFINED
#define SkFontMgr_android_DEFINED

#include "include/core/SkRefCnt.h"

class SkFontMgr;

struct SkFontMgr_Android_CustomFonts {
    /** When specifying custom fonts, indicates how to use system fonts. */
    enum SystemFontUse {
        kOnlyCustom, /** Use only custom fonts. NDK compliant. */
        kPreferCustom, /** Use custom fonts before system fonts. */
        kPreferSystem /** Use system fonts before custom fonts. */
    };
    /** Whether or not to use system fonts. */
    SystemFontUse fSystemFontUse;

    /** Base path to resolve relative font file names. If a directory, should end with '/'. */
    const char* fBasePath;

    /** Optional custom configuration file to use. */
    const char* fFontsXml;

    /** Optional custom configuration file for fonts which provide fallback.
     *  In the new style (version > 21) fontsXml format is used, this should be NULL.
     */
    const char* fFallbackFontsXml;

    /** Optional custom flag. If set to true the SkFontMgr will acquire all requisite
     *  system IO resources on initialization.
     */
    bool fIsolated;
};

/** Create a font manager for Android. If 'custom' is NULL, use only system fonts. */
SK_API sk_sp<SkFontMgr> SkFontMgr_New_Android(const SkFontMgr_Android_CustomFonts* custom);

#endif // SkFontMgr_android_DEFINED
