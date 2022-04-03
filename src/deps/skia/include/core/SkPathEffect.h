/*
 * Copyright 2006 The Android Open Source Project
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SkPathEffect_DEFINED
#define SkPathEffect_DEFINED

#include "include/core/SkFlattenable.h"
#include "include/core/SkScalar.h"
// not needed, but some of our clients need it (they don't IWYU)
#include "include/core/SkPath.h"

class SkPath;
struct SkRect;
class SkStrokeRec;

/** \class SkPathEffect

    SkPathEffect is the base class for objects in the SkPaint that affect
    the geometry of a drawing primitive before it is transformed by the
    canvas' matrix and drawn.

    Dashing is implemented as a subclass of SkPathEffect.
*/
class SK_API SkPathEffect : public SkFlattenable {
public:
    /**
     *  Returns a patheffect that apples each effect (first and second) to the original path,
     *  and returns a path with the sum of these.
     *
     *  result = first(path) + second(path)
     *
     */
    static sk_sp<SkPathEffect> MakeSum(sk_sp<SkPathEffect> first, sk_sp<SkPathEffect> second);

    /**
     *  Returns a patheffect that applies the inner effect to the path, and then applies the
     *  outer effect to the result of the inner's.
     *
     *  result = outer(inner(path))
     */
    static sk_sp<SkPathEffect> MakeCompose(sk_sp<SkPathEffect> outer, sk_sp<SkPathEffect> inner);

    static SkFlattenable::Type GetFlattenableType() {
        return kSkPathEffect_Type;
    }

    // move to base?

    enum DashType {
        kNone_DashType, //!< ignores the info parameter
        kDash_DashType, //!< fills in all of the info parameter
    };

    struct DashInfo {
        DashInfo() : fIntervals(nullptr), fCount(0), fPhase(0) {}
        DashInfo(SkScalar* intervals, int32_t count, SkScalar phase)
            : fIntervals(intervals), fCount(count), fPhase(phase) {}

        SkScalar*   fIntervals;         //!< Length of on/off intervals for dashed lines
                                        //   Even values represent ons, and odds offs
        int32_t     fCount;             //!< Number of intervals in the dash. Should be even number
        SkScalar    fPhase;             //!< Offset into the dashed interval pattern
                                        //   mod the sum of all intervals
    };

    DashType asADash(DashInfo* info) const;

    /**
     *  Given a src path (input) and a stroke-rec (input and output), apply
     *  this effect to the src path, returning the new path in dst, and return
     *  true. If this effect cannot be applied, return false and ignore dst
     *  and stroke-rec.
     *
     *  The stroke-rec specifies the initial request for stroking (if any).
     *  The effect can treat this as input only, or it can choose to change
     *  the rec as well. For example, the effect can decide to change the
     *  stroke's width or join, or the effect can change the rec from stroke
     *  to fill (or fill to stroke) in addition to returning a new (dst) path.
     *
     *  If this method returns true, the caller will apply (as needed) the
     *  resulting stroke-rec to dst and then draw.
     */
    bool filterPath(SkPath* dst, const SkPath& src, SkStrokeRec*, const SkRect* cullR) const;

    /** Version of filterPath that can be called when the CTM is known. */
    bool filterPath(SkPath* dst, const SkPath& src, SkStrokeRec*, const SkRect* cullR,
                    const SkMatrix& ctm) const;

    /** True if this path effect requires a valid CTM */
    bool needsCTM() const;

    static sk_sp<SkPathEffect> Deserialize(const void* data, size_t size,
                                           const SkDeserialProcs* procs = nullptr);

private:
    SkPathEffect() = default;
    friend class SkPathEffectBase;

    using INHERITED = SkFlattenable;
};

#endif
