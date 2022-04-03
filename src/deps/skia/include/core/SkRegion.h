/*
 * Copyright 2005 The Android Open Source Project
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SkRegion_DEFINED
#define SkRegion_DEFINED

#include "include/core/SkRect.h"

class SkPath;
class SkRgnBuilder;

/** \class SkRegion
    SkRegion describes the set of pixels used to clip SkCanvas. SkRegion is compact,
    efficiently storing a single integer rectangle, or a run length encoded array
    of rectangles. SkRegion may reduce the current SkCanvas clip, or may be drawn as
    one or more integer rectangles. SkRegion iterator returns the scan lines or
    rectangles contained by it, optionally intersecting a bounding rectangle.
*/
class SK_API SkRegion {
    typedef int32_t RunType;
public:

    /** Constructs an empty SkRegion. SkRegion is set to empty bounds
        at (0, 0) with zero width and height.

        @return  empty SkRegion

        example: https://fiddle.skia.org/c/@Region_empty_constructor
    */
    SkRegion();

    /** Constructs a copy of an existing region.
        Copy constructor makes two regions identical by value. Internally, region and
        the returned result share pointer values. The underlying SkRect array is
        copied when modified.

        Creating a SkRegion copy is very efficient and never allocates memory.
        SkRegion are always copied by value from the interface; the underlying shared
        pointers are not exposed.

        @param region  SkRegion to copy by value
        @return        copy of SkRegion

        example: https://fiddle.skia.org/c/@Region_copy_const_SkRegion
    */
    SkRegion(const SkRegion& region);

    /** Constructs a rectangular SkRegion matching the bounds of rect.

        @param rect  bounds of constructed SkRegion
        @return      rectangular SkRegion

        example: https://fiddle.skia.org/c/@Region_copy_const_SkIRect
    */
    explicit SkRegion(const SkIRect& rect);

    /** Releases ownership of any shared data and deletes data if SkRegion is sole owner.

        example: https://fiddle.skia.org/c/@Region_destructor
    */
    ~SkRegion();

    /** Constructs a copy of an existing region.
        Makes two regions identical by value. Internally, region and
        the returned result share pointer values. The underlying SkRect array is
        copied when modified.

        Creating a SkRegion copy is very efficient and never allocates memory.
        SkRegion are always copied by value from the interface; the underlying shared
        pointers are not exposed.

        @param region  SkRegion to copy by value
        @return        SkRegion to copy by value

        example: https://fiddle.skia.org/c/@Region_copy_operator
    */
    SkRegion& operator=(const SkRegion& region);

    /** Compares SkRegion and other; returns true if they enclose exactly
        the same area.

        @param other  SkRegion to compare
        @return       true if SkRegion pair are equivalent

        example: https://fiddle.skia.org/c/@Region_equal1_operator
    */
    bool operator==(const SkRegion& other) const;

    /** Compares SkRegion and other; returns true if they do not enclose the same area.

        @param other  SkRegion to compare
        @return       true if SkRegion pair are not equivalent
    */
    bool operator!=(const SkRegion& other) const {
        return !(*this == other);
    }

    /** Sets SkRegion to src, and returns true if src bounds is not empty.
        This makes SkRegion and src identical by value. Internally,
        SkRegion and src share pointer values. The underlying SkRect array is
        copied when modified.

        Creating a SkRegion copy is very efficient and never allocates memory.
        SkRegion are always copied by value from the interface; the underlying shared
        pointers are not exposed.

        @param src  SkRegion to copy
        @return     copy of src
    */
    bool set(const SkRegion& src) {
        *this = src;
        return !this->isEmpty();
    }

    /** Exchanges SkIRect array of SkRegion and other. swap() internally exchanges pointers,
        so it is lightweight and does not allocate memory.

        swap() usage has largely been replaced by operator=(const SkRegion& region).
        SkPath do not copy their content on assignment until they are written to,
        making assignment as efficient as swap().

        @param other  operator=(const SkRegion& region) set

        example: https://fiddle.skia.org/c/@Region_swap
    */
    void swap(SkRegion& other);

    /** Returns true if SkRegion is empty.
        Empty SkRegion has bounds width or height less than or equal to zero.
        SkRegion() constructs empty SkRegion; setEmpty()
        and setRect() with dimensionless data make SkRegion empty.

        @return  true if bounds has no width or height
    */
    bool isEmpty() const { return fRunHead == emptyRunHeadPtr(); }

    /** Returns true if SkRegion is one SkIRect with positive dimensions.

        @return  true if SkRegion contains one SkIRect
    */
    bool isRect() const { return fRunHead == kRectRunHeadPtr; }

    /** Returns true if SkRegion is described by more than one rectangle.

        @return  true if SkRegion contains more than one SkIRect
    */
    bool isComplex() const { return !this->isEmpty() && !this->isRect(); }

    /** Returns minimum and maximum axes values of SkIRect array.
        Returns (0, 0, 0, 0) if SkRegion is empty.

        @return  combined bounds of all SkIRect elements
    */
    const SkIRect& getBounds() const { return fBounds; }

    /** Returns a value that increases with the number of
        elements in SkRegion. Returns zero if SkRegion is empty.
        Returns one if SkRegion equals SkIRect; otherwise, returns
        value greater than one indicating that SkRegion is complex.

        Call to compare SkRegion for relative complexity.

        @return  relative complexity

        example: https://fiddle.skia.org/c/@Region_computeRegionComplexity
    */
    int computeRegionComplexity() const;

    /** Appends outline of SkRegion to path.
        Returns true if SkRegion is not empty; otherwise, returns false, and leaves path
        unmodified.

        @param path  SkPath to append to
        @return      true if path changed

        example: https://fiddle.skia.org/c/@Region_getBoundaryPath
    */
    bool getBoundaryPath(SkPath* path) const;

    /** Constructs an empty SkRegion. SkRegion is set to empty bounds
        at (0, 0) with zero width and height. Always returns false.

        @return  false

        example: https://fiddle.skia.org/c/@Region_setEmpty
    */
    bool setEmpty();

    /** Constructs a rectangular SkRegion matching the bounds of rect.
        If rect is empty, constructs empty and returns false.

        @param rect  bounds of constructed SkRegion
        @return      true if rect is not empty

        example: https://fiddle.skia.org/c/@Region_setRect
    */
    bool setRect(const SkIRect& rect);

    /** Constructs SkRegion as the union of SkIRect in rects array. If count is
        zero, constructs empty SkRegion. Returns false if constructed SkRegion is empty.

        May be faster than repeated calls to op().

        @param rects  array of SkIRect
        @param count  array size
        @return       true if constructed SkRegion is not empty

        example: https://fiddle.skia.org/c/@Region_setRects
    */
    bool setRects(const SkIRect rects[], int count);

    /** Constructs a copy of an existing region.
        Makes two regions identical by value. Internally, region and
        the returned result share pointer values. The underlying SkRect array is
        copied when modified.

        Creating a SkRegion copy is very efficient and never allocates memory.
        SkRegion are always copied by value from the interface; the underlying shared
        pointers are not exposed.

        @param region  SkRegion to copy by value
        @return        SkRegion to copy by value

        example: https://fiddle.skia.org/c/@Region_setRegion
    */
    bool setRegion(const SkRegion& region);

    /** Constructs SkRegion to match outline of path within clip.
        Returns false if constructed SkRegion is empty.

        Constructed SkRegion draws the same pixels as path through clip when
        anti-aliasing is disabled.

        @param path  SkPath providing outline
        @param clip  SkRegion containing path
        @return      true if constructed SkRegion is not empty

        example: https://fiddle.skia.org/c/@Region_setPath
    */
    bool setPath(const SkPath& path, const SkRegion& clip);

    /** Returns true if SkRegion intersects rect.
        Returns false if either rect or SkRegion is empty, or do not intersect.

        @param rect  SkIRect to intersect
        @return      true if rect and SkRegion have area in common

        example: https://fiddle.skia.org/c/@Region_intersects
    */
    bool intersects(const SkIRect& rect) const;

    /** Returns true if SkRegion intersects other.
        Returns false if either other or SkRegion is empty, or do not intersect.

        @param other  SkRegion to intersect
        @return       true if other and SkRegion have area in common

        example: https://fiddle.skia.org/c/@Region_intersects_2
    */
    bool intersects(const SkRegion& other) const;

    /** Returns true if SkIPoint (x, y) is inside SkRegion.
        Returns false if SkRegion is empty.

        @param x  test SkIPoint x-coordinate
        @param y  test SkIPoint y-coordinate
        @return   true if (x, y) is inside SkRegion

        example: https://fiddle.skia.org/c/@Region_contains
    */
    bool contains(int32_t x, int32_t y) const;

    /** Returns true if other is completely inside SkRegion.
        Returns false if SkRegion or other is empty.

        @param other  SkIRect to contain
        @return       true if other is inside SkRegion

        example: https://fiddle.skia.org/c/@Region_contains_2
    */
    bool contains(const SkIRect& other) const;

    /** Returns true if other is completely inside SkRegion.
        Returns false if SkRegion or other is empty.

        @param other  SkRegion to contain
        @return       true if other is inside SkRegion

        example: https://fiddle.skia.org/c/@Region_contains_3
    */
    bool contains(const SkRegion& other) const;

    /** Returns true if SkRegion is a single rectangle and contains r.
        May return false even though SkRegion contains r.

        @param r  SkIRect to contain
        @return   true quickly if r points are equal or inside
    */
    bool quickContains(const SkIRect& r) const {
        SkASSERT(this->isEmpty() == fBounds.isEmpty()); // valid region

        return  r.fLeft < r.fRight && r.fTop < r.fBottom &&
                fRunHead == kRectRunHeadPtr &&  // this->isRect()
                /* fBounds.contains(left, top, right, bottom); */
                fBounds.fLeft <= r.fLeft   && fBounds.fTop <= r.fTop &&
                fBounds.fRight >= r.fRight && fBounds.fBottom >= r.fBottom;
    }

    /** Returns true if SkRegion does not intersect rect.
        Returns true if rect is empty or SkRegion is empty.
        May return false even though SkRegion does not intersect rect.

        @param rect  SkIRect to intersect
        @return      true if rect does not intersect
    */
    bool quickReject(const SkIRect& rect) const {
        return this->isEmpty() || rect.isEmpty() ||
                !SkIRect::Intersects(fBounds, rect);
    }

    /** Returns true if SkRegion does not intersect rgn.
        Returns true if rgn is empty or SkRegion is empty.
        May return false even though SkRegion does not intersect rgn.

        @param rgn  SkRegion to intersect
        @return     true if rgn does not intersect
    */
    bool quickReject(const SkRegion& rgn) const {
        return this->isEmpty() || rgn.isEmpty() ||
               !SkIRect::Intersects(fBounds, rgn.fBounds);
    }

    /** Offsets SkRegion by ivector (dx, dy). Has no effect if SkRegion is empty.

        @param dx  x-axis offset
        @param dy  y-axis offset
    */
    void translate(int dx, int dy) { this->translate(dx, dy, this); }

    /** Offsets SkRegion by ivector (dx, dy), writing result to dst. SkRegion may be passed
        as dst parameter, translating SkRegion in place. Has no effect if dst is nullptr.
        If SkRegion is empty, sets dst to empty.

        @param dx   x-axis offset
        @param dy   y-axis offset
        @param dst  translated result

        example: https://fiddle.skia.org/c/@Region_translate_2
    */
    void translate(int dx, int dy, SkRegion* dst) const;

    /** \enum SkRegion::Op
        The logical operations that can be performed when combining two SkRegion.
    */
    enum Op {
        kDifference_Op,                      //!< target minus operand
        kIntersect_Op,                       //!< target intersected with operand
        kUnion_Op,                           //!< target unioned with operand
        kXOR_Op,                             //!< target exclusive or with operand
        kReverseDifference_Op,               //!< operand minus target
        kReplace_Op,                         //!< replace target with operand
        kLastOp               = kReplace_Op, //!< last operator
    };

    static const int kOpCnt = kLastOp + 1;

    /** Replaces SkRegion with the result of SkRegion op rect.
        Returns true if replaced SkRegion is not empty.

        @param rect  SkIRect operand
        @return      false if result is empty
    */
    bool op(const SkIRect& rect, Op op) {
        if (this->isRect() && kIntersect_Op == op) {
            if (!fBounds.intersect(rect)) {
                return this->setEmpty();
            }
            return true;
        }
        return this->op(*this, rect, op);
    }

    /** Replaces SkRegion with the result of SkRegion op rgn.
        Returns true if replaced SkRegion is not empty.

        @param rgn  SkRegion operand
        @return     false if result is empty
    */
    bool op(const SkRegion& rgn, Op op) { return this->op(*this, rgn, op); }

    /** Replaces SkRegion with the result of rect op rgn.
        Returns true if replaced SkRegion is not empty.

        @param rect  SkIRect operand
        @param rgn   SkRegion operand
        @return      false if result is empty

        example: https://fiddle.skia.org/c/@Region_op_4
    */
    bool op(const SkIRect& rect, const SkRegion& rgn, Op op);

    /** Replaces SkRegion with the result of rgn op rect.
        Returns true if replaced SkRegion is not empty.

        @param rgn   SkRegion operand
        @param rect  SkIRect operand
        @return      false if result is empty

        example: https://fiddle.skia.org/c/@Region_op_5
    */
    bool op(const SkRegion& rgn, const SkIRect& rect, Op op);

    /** Replaces SkRegion with the result of rgna op rgnb.
        Returns true if replaced SkRegion is not empty.

        @param rgna  SkRegion operand
        @param rgnb  SkRegion operand
        @return      false if result is empty

        example: https://fiddle.skia.org/c/@Region_op_6
    */
    bool op(const SkRegion& rgna, const SkRegion& rgnb, Op op);

#ifdef SK_BUILD_FOR_ANDROID_FRAMEWORK
    /** Private. Android framework only.

        @return  string representation of SkRegion
    */
    char* toString();
#endif

    /** \class SkRegion::Iterator
        Returns sequence of rectangles, sorted along y-axis, then x-axis, that make
        up SkRegion.
    */
    class SK_API Iterator {
    public:

        /** Initializes SkRegion::Iterator with an empty SkRegion. done() on SkRegion::Iterator
            returns true.
            Call reset() to initialized SkRegion::Iterator at a later time.

            @return  empty SkRegion iterator
        */
        Iterator() : fRgn(nullptr), fDone(true) {}

        /** Sets SkRegion::Iterator to return elements of SkIRect array in region.

            @param region  SkRegion to iterate
            @return        SkRegion iterator

        example: https://fiddle.skia.org/c/@Region_Iterator_copy_const_SkRegion
        */
        Iterator(const SkRegion& region);

        /** SkPoint SkRegion::Iterator to start of SkRegion.
            Returns true if SkRegion was set; otherwise, returns false.

            @return  true if SkRegion was set

        example: https://fiddle.skia.org/c/@Region_Iterator_rewind
        */
        bool rewind();

        /** Resets iterator, using the new SkRegion.

            @param region  SkRegion to iterate

        example: https://fiddle.skia.org/c/@Region_Iterator_reset
        */
        void reset(const SkRegion& region);

        /** Returns true if SkRegion::Iterator is pointing to final SkIRect in SkRegion.

            @return  true if data parsing is complete
        */
        bool done() const { return fDone; }

        /** Advances SkRegion::Iterator to next SkIRect in SkRegion if it is not done.

        example: https://fiddle.skia.org/c/@Region_Iterator_next
        */
        void next();

        /** Returns SkIRect element in SkRegion. Does not return predictable results if SkRegion
            is empty.

            @return  part of SkRegion as SkIRect
        */
        const SkIRect& rect() const { return fRect; }

        /** Returns SkRegion if set; otherwise, returns nullptr.

            @return  iterated SkRegion
        */
        const SkRegion* rgn() const { return fRgn; }

    private:
        const SkRegion* fRgn;
        const SkRegion::RunType*  fRuns;
        SkIRect         fRect = {0, 0, 0, 0};
        bool            fDone;
    };

    /** \class SkRegion::Cliperator
        Returns the sequence of rectangles, sorted along y-axis, then x-axis, that make
        up SkRegion intersected with the specified clip rectangle.
    */
    class SK_API Cliperator {
    public:

        /** Sets SkRegion::Cliperator to return elements of SkIRect array in SkRegion within clip.

            @param region  SkRegion to iterate
            @param clip    bounds of iteration
            @return        SkRegion iterator

        example: https://fiddle.skia.org/c/@Region_Cliperator_const_SkRegion_const_SkIRect
        */
        Cliperator(const SkRegion& region, const SkIRect& clip);

        /** Returns true if SkRegion::Cliperator is pointing to final SkIRect in SkRegion.

            @return  true if data parsing is complete
        */
        bool done() { return fDone; }

        /** Advances iterator to next SkIRect in SkRegion contained by clip.

        example: https://fiddle.skia.org/c/@Region_Cliperator_next
        */
        void  next();

        /** Returns SkIRect element in SkRegion, intersected with clip passed to
            SkRegion::Cliperator constructor. Does not return predictable results if SkRegion
            is empty.

            @return  part of SkRegion inside clip as SkIRect
        */
        const SkIRect& rect() const { return fRect; }

    private:
        Iterator    fIter;
        SkIRect     fClip;
        SkIRect     fRect = {0, 0, 0, 0};
        bool        fDone;
    };

    /** \class SkRegion::Spanerator
        Returns the line segment ends within SkRegion that intersect a horizontal line.
    */
    class Spanerator {
    public:

        /** Sets SkRegion::Spanerator to return line segments in SkRegion on scan line.

            @param region  SkRegion to iterate
            @param y       horizontal line to intersect
            @param left    bounds of iteration
            @param right   bounds of iteration
            @return        SkRegion iterator

        example: https://fiddle.skia.org/c/@Region_Spanerator_const_SkRegion_int_int_int
        */
        Spanerator(const SkRegion& region, int y, int left, int right);

        /** Advances iterator to next span intersecting SkRegion within line segment provided
            in constructor. Returns true if interval was found.

            @param left   pointer to span start; may be nullptr
            @param right  pointer to span end; may be nullptr
            @return       true if interval was found

        example: https://fiddle.skia.org/c/@Region_Spanerator_next
        */
        bool next(int* left, int* right);

    private:
        const SkRegion::RunType* fRuns;
        int     fLeft, fRight;
        bool    fDone;
    };

    /** Writes SkRegion to buffer, and returns number of bytes written.
        If buffer is nullptr, returns number number of bytes that would be written.

        @param buffer  storage for binary data
        @return        size of SkRegion

        example: https://fiddle.skia.org/c/@Region_writeToMemory
    */
    size_t writeToMemory(void* buffer) const;

    /** Constructs SkRegion from buffer of size length. Returns bytes read.
        Returned value will be multiple of four or zero if length was too small.

        @param buffer  storage for binary data
        @param length  size of buffer
        @return        bytes read

        example: https://fiddle.skia.org/c/@Region_readFromMemory
    */
    size_t readFromMemory(const void* buffer, size_t length);

private:
    static constexpr int kOpCount = kReplace_Op + 1;

    // T
    // [B N L R S]
    // S
    static constexpr int kRectRegionRuns = 7;

    struct RunHead;

    static RunHead* emptyRunHeadPtr() { return (SkRegion::RunHead*) -1; }
    static constexpr RunHead* kRectRunHeadPtr = nullptr;

    // allocate space for count runs
    void allocateRuns(int count);
    void allocateRuns(int count, int ySpanCount, int intervalCount);
    void allocateRuns(const RunHead& src);

    SkDEBUGCODE(void dump() const;)

    SkIRect     fBounds;
    RunHead*    fRunHead;

    void freeRuns();

    /**
     *  Return the runs from this region, consing up fake runs if the region
     *  is empty or a rect. In those 2 cases, we use tmpStorage to hold the
     *  run data.
     */
    const RunType*  getRuns(RunType tmpStorage[], int* intervals) const;

    // This is called with runs[] that do not yet have their interval-count
    // field set on each scanline. That is computed as part of this call
    // (inside ComputeRunBounds).
    bool setRuns(RunType runs[], int count);

    int count_runtype_values(int* itop, int* ibot) const;

    bool isValid() const;

    static void BuildRectRuns(const SkIRect& bounds,
                              RunType runs[kRectRegionRuns]);

    // If the runs define a simple rect, return true and set bounds to that
    // rect. If not, return false and ignore bounds.
    static bool RunsAreARect(const SkRegion::RunType runs[], int count,
                             SkIRect* bounds);

    /**
     *  If the last arg is null, just return if the result is non-empty,
     *  else store the result in the last arg.
     */
    static bool Oper(const SkRegion&, const SkRegion&, SkRegion::Op, SkRegion*);

    friend struct RunHead;
    friend class Iterator;
    friend class Spanerator;
    friend class SkRegionPriv;
    friend class SkRgnBuilder;
    friend class SkFlatRegion;
};

#endif
