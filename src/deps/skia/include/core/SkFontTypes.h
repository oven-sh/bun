/*
 * Copyright 2018 Google Inc.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SkFontTypes_DEFINED
#define SkFontTypes_DEFINED

enum class SkTextEncoding {
    kUTF8,      //!< uses bytes to represent UTF-8 or ASCII
    kUTF16,     //!< uses two byte words to represent most of Unicode
    kUTF32,     //!< uses four byte words to represent all of Unicode
    kGlyphID,   //!< uses two byte words to represent glyph indices
};

enum class SkFontHinting {
    kNone,      //!< glyph outlines unchanged
    kSlight,    //!< minimal modification to improve constrast
    kNormal,    //!< glyph outlines modified to improve constrast
    kFull,      //!< modifies glyph outlines for maximum constrast
};

#endif
