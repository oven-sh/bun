/*
 * Copyright 2016 Google Inc.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SKSL_MODIFIERS
#define SKSL_MODIFIERS

#include "include/private/SkSLLayout.h"

#include <vector>

namespace SkSL {

class Context;

/**
 * A set of modifier keywords (in, out, uniform, etc.) appearing before a declaration.
 */
struct Modifiers {
    /**
     * OpenGL requires modifiers to be in a strict order:
     * - invariant-qualifier:     (invariant)
     * - interpolation-qualifier: flat, noperspective, (smooth)
     * - storage-qualifier:       const, uniform
     * - parameter-qualifier:     in, out, inout
     * - precision-qualifier:     highp, mediump, lowp
     *
     * SkSL does not have `invariant` or `smooth`.
     */

    enum Flag {
        kNo_Flag             =       0,
        // Real GLSL modifiers
        kFlat_Flag           = 1 <<  0,
        kNoPerspective_Flag  = 1 <<  1,
        kConst_Flag          = 1 <<  2,
        kUniform_Flag        = 1 <<  3,
        kIn_Flag             = 1 <<  4,
        kOut_Flag            = 1 <<  5,
        kHighp_Flag          = 1 <<  6,
        kMediump_Flag        = 1 <<  7,
        kLowp_Flag           = 1 <<  8,
        // SkSL extensions, not present in GLSL
        kES3_Flag            = 1 <<  9,
        kHasSideEffects_Flag = 1 <<  10,
        kInline_Flag         = 1 <<  11,
        kNoInline_Flag       = 1 <<  12,
    };

    Modifiers()
    : fLayout(Layout())
    , fFlags(0) {}

    Modifiers(const Layout& layout, int flags)
    : fLayout(layout)
    , fFlags(flags) {}

    String description() const {
        String result = fLayout.description();

        // SkSL extensions
        if (fFlags & kES3_Flag) {
            result += "$es3 ";
        }
        if (fFlags & kHasSideEffects_Flag) {
            result += "sk_has_side_effects ";
        }
        if (fFlags & kNoInline_Flag) {
            result += "noinline ";
        }

        // Real GLSL qualifiers (must be specified in order in GLSL 4.1 and below)
        if (fFlags & kFlat_Flag) {
            result += "flat ";
        }
        if (fFlags & kNoPerspective_Flag) {
            result += "noperspective ";
        }
        if (fFlags & kConst_Flag) {
            result += "const ";
        }
        if (fFlags & kUniform_Flag) {
            result += "uniform ";
        }
        if ((fFlags & kIn_Flag) && (fFlags & kOut_Flag)) {
            result += "inout ";
        } else if (fFlags & kIn_Flag) {
            result += "in ";
        } else if (fFlags & kOut_Flag) {
            result += "out ";
        }
        if (fFlags & kHighp_Flag) {
            result += "highp ";
        }
        if (fFlags & kMediump_Flag) {
            result += "mediump ";
        }
        if (fFlags & kLowp_Flag) {
            result += "lowp ";
        }

        return result;
    }

    bool operator==(const Modifiers& other) const {
        return fLayout == other.fLayout && fFlags == other.fFlags;
    }

    bool operator!=(const Modifiers& other) const {
        return !(*this == other);
    }

    /**
     * Verifies that only permitted modifiers and layout flags are included. Reports errors and
     * returns false in the event of a violation.
     */
    bool checkPermitted(const Context& context, int line, int permittedModifierFlags,
            int permittedLayoutFlags) const;

    Layout fLayout;
    int fFlags;
};

} // namespace SkSL

namespace std {

template <>
struct hash<SkSL::Modifiers> {
    size_t operator()(const SkSL::Modifiers& key) const {
        return (size_t) key.fFlags ^ ((size_t) key.fLayout.fFlags << 8) ^
               ((size_t) key.fLayout.fBuiltin << 16);
    }
};

} // namespace std

#endif
