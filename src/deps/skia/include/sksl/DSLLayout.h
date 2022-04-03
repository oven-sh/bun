/*
 * Copyright 2021 Google LLC.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SKSL_DSL_LAYOUT
#define SKSL_DSL_LAYOUT

#include "include/sksl/DSLLayout.h"

#include "include/private/SkSLLayout.h"
#include "include/sksl/SkSLErrorReporter.h"

namespace SkSL {

namespace dsl {

class DSLLayout {
public:
    DSLLayout() {}

    DSLLayout& originUpperLeft(PositionInfo pos = PositionInfo::Capture()) {
        return this->flag(SkSL::Layout::kOriginUpperLeft_Flag, "origin_upper_left", pos);
    }

    DSLLayout& pushConstant(PositionInfo pos = PositionInfo::Capture()) {
        return this->flag(SkSL::Layout::kPushConstant_Flag, "push_constant", pos);
    }

    DSLLayout& blendSupportAllEquations(PositionInfo pos = PositionInfo::Capture()) {
        return this->flag(SkSL::Layout::kBlendSupportAllEquations_Flag,
                          "blend_support_all_equations", pos);
    }

    DSLLayout& color(PositionInfo pos = PositionInfo::Capture()) {
        return this->flag(SkSL::Layout::kColor_Flag, "color", pos);
    }

    DSLLayout& location(int location, PositionInfo pos = PositionInfo::Capture()) {
        return this->intValue(&fSkSLLayout.fLocation, location, SkSL::Layout::kLocation_Flag,
                              "location", pos);
    }

    DSLLayout& offset(int offset, PositionInfo pos = PositionInfo::Capture()) {
        return this->intValue(&fSkSLLayout.fOffset, offset, SkSL::Layout::kOffset_Flag, "offset",
                              pos);
    }

    DSLLayout& binding(int binding, PositionInfo pos = PositionInfo::Capture()) {
        return this->intValue(&fSkSLLayout.fBinding, binding, SkSL::Layout::kBinding_Flag,
                              "binding", pos);
    }

    DSLLayout& index(int index, PositionInfo pos = PositionInfo::Capture()) {
        return this->intValue(&fSkSLLayout.fIndex, index, SkSL::Layout::kIndex_Flag, "index", pos);
    }

    DSLLayout& set(int set, PositionInfo pos = PositionInfo::Capture()) {
        return this->intValue(&fSkSLLayout.fSet, set, SkSL::Layout::kSet_Flag, "set", pos);
    }

    DSLLayout& builtin(int builtin, PositionInfo pos = PositionInfo::Capture()) {
        return this->intValue(&fSkSLLayout.fBuiltin, builtin, SkSL::Layout::kBuiltin_Flag,
                              "builtin", pos);
    }

    DSLLayout& inputAttachmentIndex(int inputAttachmentIndex,
                                    PositionInfo pos = PositionInfo::Capture()) {
        return this->intValue(&fSkSLLayout.fInputAttachmentIndex, inputAttachmentIndex,
                              SkSL::Layout::kInputAttachmentIndex_Flag, "input_attachment_index",
                              pos);
    }

private:
    explicit DSLLayout(SkSL::Layout skslLayout)
        : fSkSLLayout(skslLayout) {}

    DSLLayout& flag(SkSL::Layout::Flag mask, const char* name, PositionInfo pos);

    DSLLayout& intValue(int* target, int value, SkSL::Layout::Flag flag, const char* name,
                        PositionInfo pos);

    SkSL::Layout fSkSLLayout;

    friend class DSLModifiers;
};

} // namespace dsl

} // namespace SkSL

#endif
