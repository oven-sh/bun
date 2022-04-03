/*
 * Copyright 2018 Google Inc.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SkFontMetrics_DEFINED
#define SkFontMetrics_DEFINED

#include "include/core/SkScalar.h"

/** \class SkFontMetrics
    The metrics of an SkFont.
    The metric values are consistent with the Skia y-down coordinate system.
 */
struct SK_API SkFontMetrics {
    bool operator==(const SkFontMetrics& that) {
        return
        this->fFlags == that.fFlags &&
        this->fTop == that.fTop &&
        this->fAscent == that.fAscent &&
        this->fDescent == that.fDescent &&
        this->fBottom == that.fBottom &&
        this->fLeading == that.fLeading &&
        this->fAvgCharWidth == that.fAvgCharWidth &&
        this->fMaxCharWidth == that.fMaxCharWidth &&
        this->fXMin == that.fXMin &&
        this->fXMax == that.fXMax &&
        this->fXHeight == that.fXHeight &&
        this->fCapHeight == that.fCapHeight &&
        this->fUnderlineThickness == that.fUnderlineThickness &&
        this->fUnderlinePosition == that.fUnderlinePosition &&
        this->fStrikeoutThickness == that.fStrikeoutThickness &&
        this->fStrikeoutPosition == that.fStrikeoutPosition;
    }

    /** \enum FontMetricsFlags
     FontMetricsFlags indicate when certain metrics are valid;
     the underline or strikeout metrics may be valid and zero.
     Fonts with embedded bitmaps may not have valid underline or strikeout metrics.
     */
    enum FontMetricsFlags {
        kUnderlineThicknessIsValid_Flag = 1 << 0, //!< set if fUnderlineThickness is valid
        kUnderlinePositionIsValid_Flag  = 1 << 1, //!< set if fUnderlinePosition is valid
        kStrikeoutThicknessIsValid_Flag = 1 << 2, //!< set if fStrikeoutThickness is valid
        kStrikeoutPositionIsValid_Flag  = 1 << 3, //!< set if fStrikeoutPosition is valid
        kBoundsInvalid_Flag             = 1 << 4, //!< set if fTop, fBottom, fXMin, fXMax invalid
    };

    uint32_t fFlags;              //!< FontMetricsFlags indicating which metrics are valid
    SkScalar fTop;                //!< greatest extent above origin of any glyph bounding box, typically negative; deprecated with variable fonts
    SkScalar fAscent;             //!< distance to reserve above baseline, typically negative
    SkScalar fDescent;            //!< distance to reserve below baseline, typically positive
    SkScalar fBottom;             //!< greatest extent below origin of any glyph bounding box, typically positive; deprecated with variable fonts
    SkScalar fLeading;            //!< distance to add between lines, typically positive or zero
    SkScalar fAvgCharWidth;       //!< average character width, zero if unknown
    SkScalar fMaxCharWidth;       //!< maximum character width, zero if unknown
    SkScalar fXMin;               //!< greatest extent to left of origin of any glyph bounding box, typically negative; deprecated with variable fonts
    SkScalar fXMax;               //!< greatest extent to right of origin of any glyph bounding box, typically positive; deprecated with variable fonts
    SkScalar fXHeight;            //!< height of lower-case 'x', zero if unknown, typically negative
    SkScalar fCapHeight;          //!< height of an upper-case letter, zero if unknown, typically negative
    SkScalar fUnderlineThickness; //!< underline thickness
    SkScalar fUnderlinePosition;  //!< distance from baseline to top of stroke, typically positive
    SkScalar fStrikeoutThickness; //!< strikeout thickness
    SkScalar fStrikeoutPosition;  //!< distance from baseline to bottom of stroke, typically negative

    /** Returns true if SkFontMetrics has a valid underline thickness, and sets
     thickness to that value. If the underline thickness is not valid,
     return false, and ignore thickness.

     @param thickness  storage for underline width
     @return           true if font specifies underline width
     */
    bool hasUnderlineThickness(SkScalar* thickness) const {
        if (SkToBool(fFlags & kUnderlineThicknessIsValid_Flag)) {
            *thickness = fUnderlineThickness;
            return true;
        }
        return false;
    }

    /** Returns true if SkFontMetrics has a valid underline position, and sets
     position to that value. If the underline position is not valid,
     return false, and ignore position.

     @param position  storage for underline position
     @return          true if font specifies underline position
     */
    bool hasUnderlinePosition(SkScalar* position) const {
        if (SkToBool(fFlags & kUnderlinePositionIsValid_Flag)) {
            *position = fUnderlinePosition;
            return true;
        }
        return false;
    }

    /** Returns true if SkFontMetrics has a valid strikeout thickness, and sets
     thickness to that value. If the underline thickness is not valid,
     return false, and ignore thickness.

     @param thickness  storage for strikeout width
     @return           true if font specifies strikeout width
     */
    bool hasStrikeoutThickness(SkScalar* thickness) const {
        if (SkToBool(fFlags & kStrikeoutThicknessIsValid_Flag)) {
            *thickness = fStrikeoutThickness;
            return true;
        }
        return false;
    }

    /** Returns true if SkFontMetrics has a valid strikeout position, and sets
     position to that value. If the underline position is not valid,
     return false, and ignore position.

     @param position  storage for strikeout position
     @return          true if font specifies strikeout position
     */
    bool hasStrikeoutPosition(SkScalar* position) const {
        if (SkToBool(fFlags & kStrikeoutPositionIsValid_Flag)) {
            *position = fStrikeoutPosition;
            return true;
        }
        return false;
    }

    /** Returns true if SkFontMetrics has a valid fTop, fBottom, fXMin, and fXMax.
     If the bounds are not valid, return false.

     @return        true if font specifies maximum glyph bounds
     */
    bool hasBounds() const {
        return !SkToBool(fFlags & kBoundsInvalid_Flag);
    }
};

#endif
