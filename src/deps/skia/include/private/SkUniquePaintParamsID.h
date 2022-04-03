/*
 * Copyright 2022 Google LLC
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SkUniquePaintParamsID_DEFINED
#define SkUniquePaintParamsID_DEFINED

#include "include/core/SkTypes.h"

// This class boils down to a unique uint that can be used instead of a variable length
// key derived from a PaintParams.
class SkUniquePaintParamsID {
public:
    explicit SkUniquePaintParamsID(uint32_t id) : fID(id) {
        SkASSERT(id != SK_InvalidUniqueID);
    }

    static SkUniquePaintParamsID InvalidID() { return SkUniquePaintParamsID(); }

    SkUniquePaintParamsID() : fID(SK_InvalidUniqueID) {}

    bool operator==(const SkUniquePaintParamsID &that) const { return fID == that.fID; }
    bool operator!=(const SkUniquePaintParamsID &that) const { return !(*this == that); }

    bool isValid() const { return fID != SK_InvalidUniqueID; }
    uint32_t asUInt() const { return fID; }

private:
    uint32_t fID;
};

#endif // SkUniquePaintParamsID_DEFINED
