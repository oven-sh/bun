/*
 * Copyright 2020 Google LLC
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SKSL_DSL_MODIFIERS
#define SKSL_DSL_MODIFIERS

#include "include/core/SkSpan.h"
#include "include/private/SkSLModifiers.h"
#include "include/sksl/DSLLayout.h"

namespace SkSL {

namespace dsl {

class DSLField;
class DSLType;

enum Modifier {
    kNo_Modifier            = SkSL::Modifiers::kNo_Flag,
    kConst_Modifier         = SkSL::Modifiers::kConst_Flag,
    kIn_Modifier            = SkSL::Modifiers::kIn_Flag,
    kOut_Modifier           = SkSL::Modifiers::kOut_Flag,
    kInOut_Modifier         = SkSL::Modifiers::kIn_Flag | SkSL::Modifiers::kOut_Flag,
    kUniform_Modifier       = SkSL::Modifiers::kUniform_Flag,
    kFlat_Modifier          = SkSL::Modifiers::kFlat_Flag,
    kNoPerspective_Modifier = SkSL::Modifiers::kNoPerspective_Flag,
};

class DSLModifiers {
public:
    DSLModifiers(int flags = 0)
        : DSLModifiers(DSLLayout(), flags) {}

    DSLModifiers(DSLLayout layout, int flags = 0)
        : fModifiers(layout.fSkSLLayout, flags) {}

    int flags() const {
        return fModifiers.fFlags;
    }

    DSLLayout layout() const {
        return DSLLayout(fModifiers.fLayout);
    }

private:
    SkSL::Modifiers fModifiers;

    friend DSLType Struct(skstd::string_view name, SkSpan<DSLField> fields, PositionInfo pos);
    friend class DSLCore;
    friend class DSLFunction;
    friend class DSLType;
    friend class DSLVarBase;
    friend class DSLWriter;
};

} // namespace dsl

} // namespace SkSL

#endif
