/*
 * Copyright 2016 Google Inc.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SKSL_LAYOUT
#define SKSL_LAYOUT

#include "include/private/SkSLString.h"

namespace SkSL {

/**
 * Represents a layout block appearing before a variable declaration, as in:
 *
 * layout (location = 0) int x;
 */
struct Layout {
    enum Flag {
        kOriginUpperLeft_Flag            = 1 <<  0,
        kPushConstant_Flag               = 1 <<  1,
        kBlendSupportAllEquations_Flag   = 1 <<  2,
        kColor_Flag                      = 1 <<  3,

        // These flags indicate if the qualifier appeared, regardless of the accompanying value.
        kLocation_Flag                   = 1 <<  4,
        kOffset_Flag                     = 1 <<  5,
        kBinding_Flag                    = 1 <<  6,
        kIndex_Flag                      = 1 <<  7,
        kSet_Flag                        = 1 <<  8,
        kBuiltin_Flag                    = 1 <<  9,
        kInputAttachmentIndex_Flag       = 1 << 10,
    };

    Layout(int flags, int location, int offset, int binding, int index, int set, int builtin,
           int inputAttachmentIndex)
    : fFlags(flags)
    , fLocation(location)
    , fOffset(offset)
    , fBinding(binding)
    , fIndex(index)
    , fSet(set)
    , fBuiltin(builtin)
    , fInputAttachmentIndex(inputAttachmentIndex) {}

    Layout()
    : fFlags(0)
    , fLocation(-1)
    , fOffset(-1)
    , fBinding(-1)
    , fIndex(-1)
    , fSet(-1)
    , fBuiltin(-1)
    , fInputAttachmentIndex(-1) {}

    static Layout builtin(int builtin) {
        Layout result;
        result.fBuiltin = builtin;
        return result;
    }

    String description() const {
        String result;
        auto separator = [firstSeparator = true]() mutable -> String {
            if (firstSeparator) {
                firstSeparator = false;
                return "";
            } else {
                return ", ";
            }};
        if (fLocation >= 0) {
            result += separator() + "location = " + to_string(fLocation);
        }
        if (fOffset >= 0) {
            result += separator() + "offset = " + to_string(fOffset);
        }
        if (fBinding >= 0) {
            result += separator() + "binding = " + to_string(fBinding);
        }
        if (fIndex >= 0) {
            result += separator() + "index = " + to_string(fIndex);
        }
        if (fSet >= 0) {
            result += separator() + "set = " + to_string(fSet);
        }
        if (fBuiltin >= 0) {
            result += separator() + "builtin = " + to_string(fBuiltin);
        }
        if (fInputAttachmentIndex >= 0) {
            result += separator() + "input_attachment_index = " + to_string(fInputAttachmentIndex);
        }
        if (fFlags & kOriginUpperLeft_Flag) {
            result += separator() + "origin_upper_left";
        }
        if (fFlags & kBlendSupportAllEquations_Flag) {
            result += separator() + "blend_support_all_equations";
        }
        if (fFlags & kPushConstant_Flag) {
            result += separator() + "push_constant";
        }
        if (fFlags & kColor_Flag) {
            result += separator() + "color";
        }
        if (result.size() > 0) {
            result = "layout (" + result + ")";
        }
        return result;
    }

    bool operator==(const Layout& other) const {
        return fFlags                == other.fFlags &&
               fLocation             == other.fLocation &&
               fOffset               == other.fOffset &&
               fBinding              == other.fBinding &&
               fIndex                == other.fIndex &&
               fSet                  == other.fSet &&
               fBuiltin              == other.fBuiltin &&
               fInputAttachmentIndex == other.fInputAttachmentIndex;
    }

    bool operator!=(const Layout& other) const {
        return !(*this == other);
    }

    int fFlags;
    int fLocation;
    int fOffset;
    int fBinding;
    int fIndex;
    int fSet;
    // builtin comes from SPIR-V and identifies which particular builtin value this object
    // represents.
    int fBuiltin;
    // input_attachment_index comes from Vulkan/SPIR-V to connect a shader variable to the a
    // corresponding attachment on the subpass in which the shader is being used.
    int fInputAttachmentIndex;
};

}  // namespace SkSL

#endif
