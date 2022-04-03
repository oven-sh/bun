/*
 * Copyright 2013 Google Inc.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SkFontStyle_DEFINED
#define SkFontStyle_DEFINED

#include "include/core/SkTypes.h"
#include "include/private/SkTPin.h"

class SK_API SkFontStyle {
public:
    enum Weight {
        kInvisible_Weight   =    0,
        kThin_Weight        =  100,
        kExtraLight_Weight  =  200,
        kLight_Weight       =  300,
        kNormal_Weight      =  400,
        kMedium_Weight      =  500,
        kSemiBold_Weight    =  600,
        kBold_Weight        =  700,
        kExtraBold_Weight   =  800,
        kBlack_Weight       =  900,
        kExtraBlack_Weight  = 1000,
    };

    enum Width {
        kUltraCondensed_Width   = 1,
        kExtraCondensed_Width   = 2,
        kCondensed_Width        = 3,
        kSemiCondensed_Width    = 4,
        kNormal_Width           = 5,
        kSemiExpanded_Width     = 6,
        kExpanded_Width         = 7,
        kExtraExpanded_Width    = 8,
        kUltraExpanded_Width    = 9,
    };

    enum Slant {
        kUpright_Slant,
        kItalic_Slant,
        kOblique_Slant,
    };

    constexpr SkFontStyle(int weight, int width, Slant slant) : fValue(
        (SkTPin<int>(weight, kInvisible_Weight, kExtraBlack_Weight)) +
        (SkTPin<int>(width, kUltraCondensed_Width, kUltraExpanded_Width) << 16) +
        (SkTPin<int>(slant, kUpright_Slant, kOblique_Slant) << 24)
     ) { }

    constexpr SkFontStyle() : SkFontStyle{kNormal_Weight, kNormal_Width, kUpright_Slant} { }

    bool operator==(const SkFontStyle& rhs) const {
        return fValue == rhs.fValue;
    }

    int weight() const { return fValue & 0xFFFF; }
    int width() const { return (fValue >> 16) & 0xFF; }
    Slant slant() const { return (Slant)((fValue >> 24) & 0xFF); }

    static constexpr SkFontStyle Normal() {
        return SkFontStyle(kNormal_Weight, kNormal_Width, kUpright_Slant);
    }
    static constexpr SkFontStyle Bold() {
        return SkFontStyle(kBold_Weight,   kNormal_Width, kUpright_Slant);
    }
    static constexpr SkFontStyle Italic() {
        return SkFontStyle(kNormal_Weight, kNormal_Width, kItalic_Slant );
    }
    static constexpr SkFontStyle BoldItalic() {
        return SkFontStyle(kBold_Weight,   kNormal_Width, kItalic_Slant );
    }

private:
    int32_t fValue;
};

#endif
