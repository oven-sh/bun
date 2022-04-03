/*
 * Copyright 2018 Google Inc.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SkContourMeasure_DEFINED
#define SkContourMeasure_DEFINED

#include "include/core/SkPath.h"
#include "include/core/SkRefCnt.h"
#include "include/private/SkTDArray.h"

struct SkConic;

class SK_API SkContourMeasure : public SkRefCnt {
public:
    /** Return the length of the contour.
     */
    SkScalar length() const { return fLength; }

    /** Pins distance to 0 <= distance <= length(), and then computes the corresponding
     *  position and tangent.
     */
    bool SK_WARN_UNUSED_RESULT getPosTan(SkScalar distance, SkPoint* position,
                                         SkVector* tangent) const;

    enum MatrixFlags {
        kGetPosition_MatrixFlag     = 0x01,
        kGetTangent_MatrixFlag      = 0x02,
        kGetPosAndTan_MatrixFlag    = kGetPosition_MatrixFlag | kGetTangent_MatrixFlag
    };

    /** Pins distance to 0 <= distance <= getLength(), and then computes
     the corresponding matrix (by calling getPosTan).
     Returns false if there is no path, or a zero-length path was specified, in which case
     matrix is unchanged.
     */
    bool SK_WARN_UNUSED_RESULT getMatrix(SkScalar distance, SkMatrix* matrix,
                                         MatrixFlags flags = kGetPosAndTan_MatrixFlag) const;

    /** Given a start and stop distance, return in dst the intervening segment(s).
     If the segment is zero-length, return false, else return true.
     startD and stopD are pinned to legal values (0..getLength()). If startD > stopD
     then return false (and leave dst untouched).
     Begin the segment with a moveTo if startWithMoveTo is true
     */
    bool SK_WARN_UNUSED_RESULT getSegment(SkScalar startD, SkScalar stopD, SkPath* dst,
                                          bool startWithMoveTo) const;

    /** Return true if the contour is closed()
     */
    bool isClosed() const { return fIsClosed; }

private:
    struct Segment {
        SkScalar    fDistance;  // total distance up to this point
        unsigned    fPtIndex; // index into the fPts array
        unsigned    fTValue : 30;
        unsigned    fType : 2;  // actually the enum SkSegType
        // See SkPathMeasurePriv.h

        SkScalar getScalarT() const;

        static const Segment* Next(const Segment* seg) {
            unsigned ptIndex = seg->fPtIndex;
            do {
                ++seg;
            } while (seg->fPtIndex == ptIndex);
            return seg;
        }

    };

    const SkTDArray<Segment>  fSegments;
    const SkTDArray<SkPoint>  fPts; // Points used to define the segments

    const SkScalar fLength;
    const bool fIsClosed;

    SkContourMeasure(SkTDArray<Segment>&& segs, SkTDArray<SkPoint>&& pts,
                     SkScalar length, bool isClosed);
    ~SkContourMeasure() override {}

    const Segment* distanceToSegment(SkScalar distance, SkScalar* t) const;

    friend class SkContourMeasureIter;
};

class SK_API SkContourMeasureIter {
public:
    SkContourMeasureIter();
    /**
     *  Initialize the Iter with a path.
     *  The parts of the path that are needed are copied, so the client is free to modify/delete
     *  the path after this call.
     *
     *  resScale controls the precision of the measure. values > 1 increase the
     *  precision (and possibly slow down the computation).
     */
    SkContourMeasureIter(const SkPath& path, bool forceClosed, SkScalar resScale = 1);
    ~SkContourMeasureIter();

    /**
     *  Reset the Iter with a path.
     *  The parts of the path that are needed are copied, so the client is free to modify/delete
     *  the path after this call.
     */
    void reset(const SkPath& path, bool forceClosed, SkScalar resScale = 1);

    /**
     *  Iterates through contours in path, returning a contour-measure object for each contour
     *  in the path. Returns null when it is done.
     *
     *  This only returns non-zero length contours, where a contour is the segments between
     *  a kMove_Verb and either ...
     *      - the next kMove_Verb
     *      - kClose_Verb (1 or more)
     *      - kDone_Verb
     *  If it encounters a zero-length contour, it is skipped.
     */
    sk_sp<SkContourMeasure> next();

private:
    class Impl;

    std::unique_ptr<Impl> fImpl;
};

#endif
