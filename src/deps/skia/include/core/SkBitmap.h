/*
 * Copyright 2006 The Android Open Source Project
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SkBitmap_DEFINED
#define SkBitmap_DEFINED

#include "include/core/SkColor.h"
#include "include/core/SkImageInfo.h"
#include "include/core/SkMatrix.h"
#include "include/core/SkPixmap.h"
#include "include/core/SkPoint.h"
#include "include/core/SkRefCnt.h"
#include "include/core/SkShader.h"
#include "include/core/SkTileMode.h"

class SkBitmap;
struct SkMask;
class SkMipmap;
struct SkIRect;
struct SkRect;
class SkPaint;
class SkPixelRef;
class SkShader;

/** \class SkBitmap
    SkBitmap describes a two-dimensional raster pixel array. SkBitmap is built on
    SkImageInfo, containing integer width and height, SkColorType and SkAlphaType
    describing the pixel format, and SkColorSpace describing the range of colors.
    SkBitmap points to SkPixelRef, which describes the physical array of pixels.
    SkImageInfo bounds may be located anywhere fully inside SkPixelRef bounds.

    SkBitmap can be drawn using SkCanvas. SkBitmap can be a drawing destination for SkCanvas
    draw member functions. SkBitmap flexibility as a pixel container limits some
    optimizations available to the target platform.

    If pixel array is primarily read-only, use SkImage for better performance.
    If pixel array is primarily written to, use SkSurface for better performance.

    Declaring SkBitmap const prevents altering SkImageInfo: the SkBitmap height, width,
    and so on cannot change. It does not affect SkPixelRef: a caller may write its
    pixels. Declaring SkBitmap const affects SkBitmap configuration, not its contents.

    SkBitmap is not thread safe. Each thread must have its own copy of SkBitmap fields,
    although threads may share the underlying pixel array.
*/
class SK_API SkBitmap {
public:
    class SK_API Allocator;

    /** Creates an empty SkBitmap without pixels, with kUnknown_SkColorType,
        kUnknown_SkAlphaType, and with a width and height of zero. SkPixelRef origin is
        set to (0, 0).

        Use setInfo() to associate SkColorType, SkAlphaType, width, and height
        after SkBitmap has been created.

        @return  empty SkBitmap

        example: https://fiddle.skia.org/c/@Bitmap_empty_constructor
    */
    SkBitmap();

    /** Copies settings from src to returned SkBitmap. Shares pixels if src has pixels
        allocated, so both bitmaps reference the same pixels.

        @param src  SkBitmap to copy SkImageInfo, and share SkPixelRef
        @return     copy of src

        example: https://fiddle.skia.org/c/@Bitmap_copy_const_SkBitmap
    */
    SkBitmap(const SkBitmap& src);

    /** Copies settings from src to returned SkBitmap. Moves ownership of src pixels to
        SkBitmap.

        @param src  SkBitmap to copy SkImageInfo, and reassign SkPixelRef
        @return     copy of src

        example: https://fiddle.skia.org/c/@Bitmap_move_SkBitmap
    */
    SkBitmap(SkBitmap&& src);

    /** Decrements SkPixelRef reference count, if SkPixelRef is not nullptr.
    */
    ~SkBitmap();

    /** Copies settings from src to returned SkBitmap. Shares pixels if src has pixels
        allocated, so both bitmaps reference the same pixels.

        @param src  SkBitmap to copy SkImageInfo, and share SkPixelRef
        @return     copy of src

        example: https://fiddle.skia.org/c/@Bitmap_copy_operator
    */
    SkBitmap& operator=(const SkBitmap& src);

    /** Copies settings from src to returned SkBitmap. Moves ownership of src pixels to
        SkBitmap.

        @param src  SkBitmap to copy SkImageInfo, and reassign SkPixelRef
        @return     copy of src

        example: https://fiddle.skia.org/c/@Bitmap_move_operator
    */
    SkBitmap& operator=(SkBitmap&& src);

    /** Swaps the fields of the two bitmaps.

        @param other  SkBitmap exchanged with original

        example: https://fiddle.skia.org/c/@Bitmap_swap
    */
    void swap(SkBitmap& other);

    /** Returns a constant reference to the SkPixmap holding the SkBitmap pixel
        address, row bytes, and SkImageInfo.

        @return  reference to SkPixmap describing this SkBitmap
    */
    const SkPixmap& pixmap() const { return fPixmap; }

    /** Returns width, height, SkAlphaType, SkColorType, and SkColorSpace.

        @return  reference to SkImageInfo
    */
    const SkImageInfo& info() const { return fPixmap.info(); }

    /** Returns pixel count in each row. Should be equal or less than
        rowBytes() / info().bytesPerPixel().

        May be less than pixelRef().width(). Will not exceed pixelRef().width() less
        pixelRefOrigin().fX.

        @return  pixel width in SkImageInfo
    */
    int width() const { return fPixmap.width(); }

    /** Returns pixel row count.

        Maybe be less than pixelRef().height(). Will not exceed pixelRef().height() less
        pixelRefOrigin().fY.

        @return  pixel height in SkImageInfo
    */
    int height() const { return fPixmap.height(); }

    SkColorType colorType() const { return fPixmap.colorType(); }

    SkAlphaType alphaType() const { return fPixmap.alphaType(); }

    /** Returns SkColorSpace, the range of colors, associated with SkImageInfo. The
        reference count of SkColorSpace is unchanged. The returned SkColorSpace is
        immutable.

        @return  SkColorSpace in SkImageInfo, or nullptr
    */
    SkColorSpace* colorSpace() const { return fPixmap.colorSpace(); }

    /** Returns smart pointer to SkColorSpace, the range of colors, associated with
        SkImageInfo. The smart pointer tracks the number of objects sharing this
        SkColorSpace reference so the memory is released when the owners destruct.

        The returned SkColorSpace is immutable.

        @return  SkColorSpace in SkImageInfo wrapped in a smart pointer
    */
    sk_sp<SkColorSpace> refColorSpace() const { return fPixmap.info().refColorSpace(); }

    /** Returns number of bytes per pixel required by SkColorType.
        Returns zero if colorType( is kUnknown_SkColorType.

        @return  bytes in pixel
    */
    int bytesPerPixel() const { return fPixmap.info().bytesPerPixel(); }

    /** Returns number of pixels that fit on row. Should be greater than or equal to
        width().

        @return  maximum pixels per row
    */
    int rowBytesAsPixels() const { return fPixmap.rowBytesAsPixels(); }

    /** Returns bit shift converting row bytes to row pixels.
        Returns zero for kUnknown_SkColorType.

        @return  one of: 0, 1, 2, 3; left shift to convert pixels to bytes
    */
    int shiftPerPixel() const { return fPixmap.shiftPerPixel(); }

    /** Returns true if either width() or height() are zero.

        Does not check if SkPixelRef is nullptr; call drawsNothing() to check width(),
        height(), and SkPixelRef.

        @return  true if dimensions do not enclose area
    */
    bool empty() const { return fPixmap.info().isEmpty(); }

    /** Returns true if SkPixelRef is nullptr.

        Does not check if width() or height() are zero; call drawsNothing() to check
        width(), height(), and SkPixelRef.

        @return  true if no SkPixelRef is associated
    */
    bool isNull() const { return nullptr == fPixelRef; }

    /** Returns true if width() or height() are zero, or if SkPixelRef is nullptr.
        If true, SkBitmap has no effect when drawn or drawn into.

        @return  true if drawing has no effect
    */
    bool drawsNothing() const {
        return this->empty() || this->isNull();
    }

    /** Returns row bytes, the interval from one pixel row to the next. Row bytes
        is at least as large as: width() * info().bytesPerPixel().

        Returns zero if colorType() is kUnknown_SkColorType, or if row bytes supplied to
        setInfo() is not large enough to hold a row of pixels.

        @return  byte length of pixel row
    */
    size_t rowBytes() const { return fPixmap.rowBytes(); }

    /** Sets SkAlphaType, if alphaType is compatible with SkColorType.
        Returns true unless alphaType is kUnknown_SkAlphaType and current SkAlphaType
        is not kUnknown_SkAlphaType.

        Returns true if SkColorType is kUnknown_SkColorType. alphaType is ignored, and
        SkAlphaType remains kUnknown_SkAlphaType.

        Returns true if SkColorType is kRGB_565_SkColorType or kGray_8_SkColorType.
        alphaType is ignored, and SkAlphaType remains kOpaque_SkAlphaType.

        If SkColorType is kARGB_4444_SkColorType, kRGBA_8888_SkColorType,
        kBGRA_8888_SkColorType, or kRGBA_F16_SkColorType: returns true unless
        alphaType is kUnknown_SkAlphaType and SkAlphaType is not kUnknown_SkAlphaType.
        If SkAlphaType is kUnknown_SkAlphaType, alphaType is ignored.

        If SkColorType is kAlpha_8_SkColorType, returns true unless
        alphaType is kUnknown_SkAlphaType and SkAlphaType is not kUnknown_SkAlphaType.
        If SkAlphaType is kUnknown_SkAlphaType, alphaType is ignored. If alphaType is
        kUnpremul_SkAlphaType, it is treated as kPremul_SkAlphaType.

        This changes SkAlphaType in SkPixelRef; all bitmaps sharing SkPixelRef
        are affected.

        @return           true if SkAlphaType is set

        example: https://fiddle.skia.org/c/@Bitmap_setAlphaType
    */
    bool setAlphaType(SkAlphaType alphaType);

    /** Returns pixel address, the base address corresponding to the pixel origin.

        @return  pixel address
    */
    void* getPixels() const { return fPixmap.writable_addr(); }

    /** Returns minimum memory required for pixel storage.
        Does not include unused memory on last row when rowBytesAsPixels() exceeds width().
        Returns SIZE_MAX if result does not fit in size_t.
        Returns zero if height() or width() is 0.
        Returns height() times rowBytes() if colorType() is kUnknown_SkColorType.

        @return  size in bytes of image buffer
    */
    size_t computeByteSize() const { return fPixmap.computeByteSize(); }

    /** Returns true if pixels can not change.

        Most immutable SkBitmap checks trigger an assert only on debug builds.

        @return  true if pixels are immutable

        example: https://fiddle.skia.org/c/@Bitmap_isImmutable
    */
    bool isImmutable() const;

    /** Sets internal flag to mark SkBitmap as immutable. Once set, pixels can not change.
        Any other bitmap sharing the same SkPixelRef are also marked as immutable.
        Once SkPixelRef is marked immutable, the setting cannot be cleared.

        Writing to immutable SkBitmap pixels triggers an assert on debug builds.

        example: https://fiddle.skia.org/c/@Bitmap_setImmutable
    */
    void setImmutable();

    /** Returns true if SkAlphaType is set to hint that all pixels are opaque; their
        alpha value is implicitly or explicitly 1.0. If true, and all pixels are
        not opaque, Skia may draw incorrectly.

        Does not check if SkColorType allows alpha, or if any pixel value has
        transparency.

        @return  true if SkImageInfo SkAlphaType is kOpaque_SkAlphaType
    */
    bool isOpaque() const {
        return SkAlphaTypeIsOpaque(this->alphaType());
    }

    /** Resets to its initial state; all fields are set to zero, as if SkBitmap had
        been initialized by SkBitmap().

        Sets width, height, row bytes to zero; pixel address to nullptr; SkColorType to
        kUnknown_SkColorType; and SkAlphaType to kUnknown_SkAlphaType.

        If SkPixelRef is allocated, its reference count is decreased by one, releasing
        its memory if SkBitmap is the sole owner.

        example: https://fiddle.skia.org/c/@Bitmap_reset
    */
    void reset();

    /** Returns true if all pixels are opaque. SkColorType determines how pixels
        are encoded, and whether pixel describes alpha. Returns true for SkColorType
        without alpha in each pixel; for other SkColorType, returns true if all
        pixels have alpha values equivalent to 1.0 or greater.

        For SkColorType kRGB_565_SkColorType or kGray_8_SkColorType: always
        returns true. For SkColorType kAlpha_8_SkColorType, kBGRA_8888_SkColorType,
        kRGBA_8888_SkColorType: returns true if all pixel alpha values are 255.
        For SkColorType kARGB_4444_SkColorType: returns true if all pixel alpha values are 15.
        For kRGBA_F16_SkColorType: returns true if all pixel alpha values are 1.0 or
        greater.

        Returns false for kUnknown_SkColorType.

        @param bm  SkBitmap to check
        @return    true if all pixels have opaque values or SkColorType is opaque
    */
    static bool ComputeIsOpaque(const SkBitmap& bm) {
        return bm.pixmap().computeIsOpaque();
    }

    /** Returns SkRect { 0, 0, width(), height() }.

        @param bounds  container for floating point rectangle

        example: https://fiddle.skia.org/c/@Bitmap_getBounds
    */
    void getBounds(SkRect* bounds) const;

    /** Returns SkIRect { 0, 0, width(), height() }.

        @param bounds  container for integral rectangle

        example: https://fiddle.skia.org/c/@Bitmap_getBounds_2
    */
    void getBounds(SkIRect* bounds) const;

    /** Returns SkIRect { 0, 0, width(), height() }.

        @return  integral rectangle from origin to width() and height()
    */
    SkIRect bounds() const { return fPixmap.info().bounds(); }

    /** Returns SkISize { width(), height() }.

        @return  integral size of width() and height()
    */
    SkISize dimensions() const { return fPixmap.info().dimensions(); }

    /** Returns the bounds of this bitmap, offset by its SkPixelRef origin.

        @return  bounds within SkPixelRef bounds
    */
    SkIRect getSubset() const {
        SkIPoint origin = this->pixelRefOrigin();
        return SkIRect::MakeXYWH(origin.x(), origin.y(), this->width(), this->height());
    }

    /** Sets width, height, SkAlphaType, SkColorType, SkColorSpace, and optional
        rowBytes. Frees pixels, and returns true if successful.

        imageInfo.alphaType() may be altered to a value permitted by imageInfo.colorSpace().
        If imageInfo.colorType() is kUnknown_SkColorType, imageInfo.alphaType() is
        set to kUnknown_SkAlphaType.
        If imageInfo.colorType() is kAlpha_8_SkColorType and imageInfo.alphaType() is
        kUnpremul_SkAlphaType, imageInfo.alphaType() is replaced by kPremul_SkAlphaType.
        If imageInfo.colorType() is kRGB_565_SkColorType or kGray_8_SkColorType,
        imageInfo.alphaType() is set to kOpaque_SkAlphaType.
        If imageInfo.colorType() is kARGB_4444_SkColorType, kRGBA_8888_SkColorType,
        kBGRA_8888_SkColorType, or kRGBA_F16_SkColorType: imageInfo.alphaType() remains
        unchanged.

        rowBytes must equal or exceed imageInfo.minRowBytes(). If imageInfo.colorSpace() is
        kUnknown_SkColorType, rowBytes is ignored and treated as zero; for all other
        SkColorSpace values, rowBytes of zero is treated as imageInfo.minRowBytes().

        Calls reset() and returns false if:
        - rowBytes exceeds 31 bits
        - imageInfo.width() is negative
        - imageInfo.height() is negative
        - rowBytes is positive and less than imageInfo.width() times imageInfo.bytesPerPixel()

        @param imageInfo  contains width, height, SkAlphaType, SkColorType, SkColorSpace
        @param rowBytes   imageInfo.minRowBytes() or larger; or zero
        @return           true if SkImageInfo set successfully

        example: https://fiddle.skia.org/c/@Bitmap_setInfo
    */
    bool setInfo(const SkImageInfo& imageInfo, size_t rowBytes = 0);

    /** \enum SkBitmap::AllocFlags
        AllocFlags is obsolete.  We always zero pixel memory when allocated.
    */
    enum AllocFlags {
        kZeroPixels_AllocFlag = 1 << 0, //!< zero pixel memory.  No effect.  This is the default.
    };

    /** Sets SkImageInfo to info following the rules in setInfo() and allocates pixel
        memory. Memory is zeroed.

        Returns false and calls reset() if SkImageInfo could not be set, or memory could
        not be allocated, or memory could not optionally be zeroed.

        On most platforms, allocating pixel memory may succeed even though there is
        not sufficient memory to hold pixels; allocation does not take place
        until the pixels are written to. The actual behavior depends on the platform
        implementation of calloc().

        @param info   contains width, height, SkAlphaType, SkColorType, SkColorSpace
        @param flags  kZeroPixels_AllocFlag, or zero
        @return       true if pixels allocation is successful
    */
    bool SK_WARN_UNUSED_RESULT tryAllocPixelsFlags(const SkImageInfo& info, uint32_t flags);

    /** Sets SkImageInfo to info following the rules in setInfo() and allocates pixel
        memory. Memory is zeroed.

        Aborts execution if SkImageInfo could not be set, or memory could
        not be allocated, or memory could not optionally
        be zeroed. Abort steps may be provided by the user at compile time by defining
        SK_ABORT.

        On most platforms, allocating pixel memory may succeed even though there is
        not sufficient memory to hold pixels; allocation does not take place
        until the pixels are written to. The actual behavior depends on the platform
        implementation of calloc().

        @param info   contains width, height, SkAlphaType, SkColorType, SkColorSpace
        @param flags  kZeroPixels_AllocFlag, or zero

        example: https://fiddle.skia.org/c/@Bitmap_allocPixelsFlags
    */
    void allocPixelsFlags(const SkImageInfo& info, uint32_t flags);

    /** Sets SkImageInfo to info following the rules in setInfo() and allocates pixel
        memory. rowBytes must equal or exceed info.width() times info.bytesPerPixel(),
        or equal zero. Pass in zero for rowBytes to compute the minimum valid value.

        Returns false and calls reset() if SkImageInfo could not be set, or memory could
        not be allocated.

        On most platforms, allocating pixel memory may succeed even though there is
        not sufficient memory to hold pixels; allocation does not take place
        until the pixels are written to. The actual behavior depends on the platform
        implementation of malloc().

        @param info      contains width, height, SkAlphaType, SkColorType, SkColorSpace
        @param rowBytes  size of pixel row or larger; may be zero
        @return          true if pixel storage is allocated
    */
    bool SK_WARN_UNUSED_RESULT tryAllocPixels(const SkImageInfo& info, size_t rowBytes);

    /** Sets SkImageInfo to info following the rules in setInfo() and allocates pixel
        memory. rowBytes must equal or exceed info.width() times info.bytesPerPixel(),
        or equal zero. Pass in zero for rowBytes to compute the minimum valid value.

        Aborts execution if SkImageInfo could not be set, or memory could
        not be allocated. Abort steps may be provided by
        the user at compile time by defining SK_ABORT.

        On most platforms, allocating pixel memory may succeed even though there is
        not sufficient memory to hold pixels; allocation does not take place
        until the pixels are written to. The actual behavior depends on the platform
        implementation of malloc().

        @param info      contains width, height, SkAlphaType, SkColorType, SkColorSpace
        @param rowBytes  size of pixel row or larger; may be zero

        example: https://fiddle.skia.org/c/@Bitmap_allocPixels
    */
    void allocPixels(const SkImageInfo& info, size_t rowBytes);

    /** Sets SkImageInfo to info following the rules in setInfo() and allocates pixel
        memory.

        Returns false and calls reset() if SkImageInfo could not be set, or memory could
        not be allocated.

        On most platforms, allocating pixel memory may succeed even though there is
        not sufficient memory to hold pixels; allocation does not take place
        until the pixels are written to. The actual behavior depends on the platform
        implementation of malloc().

        @param info  contains width, height, SkAlphaType, SkColorType, SkColorSpace
        @return      true if pixel storage is allocated
    */
    bool SK_WARN_UNUSED_RESULT tryAllocPixels(const SkImageInfo& info) {
        return this->tryAllocPixels(info, info.minRowBytes());
    }

    /** Sets SkImageInfo to info following the rules in setInfo() and allocates pixel
        memory.

        Aborts execution if SkImageInfo could not be set, or memory could
        not be allocated. Abort steps may be provided by
        the user at compile time by defining SK_ABORT.

        On most platforms, allocating pixel memory may succeed even though there is
        not sufficient memory to hold pixels; allocation does not take place
        until the pixels are written to. The actual behavior depends on the platform
        implementation of malloc().

        @param info  contains width, height, SkAlphaType, SkColorType, SkColorSpace

        example: https://fiddle.skia.org/c/@Bitmap_allocPixels_2
    */
    void allocPixels(const SkImageInfo& info);

    /** Sets SkImageInfo to width, height, and native color type; and allocates
        pixel memory. If isOpaque is true, sets SkImageInfo to kOpaque_SkAlphaType;
        otherwise, sets to kPremul_SkAlphaType.

        Calls reset() and returns false if width exceeds 29 bits or is negative,
        or height is negative.

        Returns false if allocation fails.

        Use to create SkBitmap that matches SkPMColor, the native pixel arrangement on
        the platform. SkBitmap drawn to output device skips converting its pixel format.

        @param width     pixel column count; must be zero or greater
        @param height    pixel row count; must be zero or greater
        @param isOpaque  true if pixels do not have transparency
        @return          true if pixel storage is allocated
    */
    bool SK_WARN_UNUSED_RESULT tryAllocN32Pixels(int width, int height, bool isOpaque = false);

    /** Sets SkImageInfo to width, height, and the native color type; and allocates
        pixel memory. If isOpaque is true, sets SkImageInfo to kOpaque_SkAlphaType;
        otherwise, sets to kPremul_SkAlphaType.

        Aborts if width exceeds 29 bits or is negative, or height is negative, or
        allocation fails. Abort steps may be provided by the user at compile time by
        defining SK_ABORT.

        Use to create SkBitmap that matches SkPMColor, the native pixel arrangement on
        the platform. SkBitmap drawn to output device skips converting its pixel format.

        @param width     pixel column count; must be zero or greater
        @param height    pixel row count; must be zero or greater
        @param isOpaque  true if pixels do not have transparency

        example: https://fiddle.skia.org/c/@Bitmap_allocN32Pixels
    */
    void allocN32Pixels(int width, int height, bool isOpaque = false);

    /** Sets SkImageInfo to info following the rules in setInfo(), and creates SkPixelRef
        containing pixels and rowBytes. releaseProc, if not nullptr, is called
        immediately on failure or when pixels are no longer referenced. context may be
        nullptr.

        If SkImageInfo could not be set, or rowBytes is less than info.minRowBytes():
        calls releaseProc if present, calls reset(), and returns false.

        Otherwise, if pixels equals nullptr: sets SkImageInfo, calls releaseProc if
        present, returns true.

        If SkImageInfo is set, pixels is not nullptr, and releaseProc is not nullptr:
        when pixels are no longer referenced, calls releaseProc with pixels and context
        as parameters.

        @param info         contains width, height, SkAlphaType, SkColorType, SkColorSpace
        @param pixels       address or pixel storage; may be nullptr
        @param rowBytes     size of pixel row or larger
        @param releaseProc  function called when pixels can be deleted; may be nullptr
        @param context      caller state passed to releaseProc; may be nullptr
        @return             true if SkImageInfo is set to info
    */
    bool installPixels(const SkImageInfo& info, void* pixels, size_t rowBytes,
                       void (*releaseProc)(void* addr, void* context), void* context);

    /** Sets SkImageInfo to info following the rules in setInfo(), and creates SkPixelRef
        containing pixels and rowBytes.

        If SkImageInfo could not be set, or rowBytes is less than info.minRowBytes():
        calls reset(), and returns false.

        Otherwise, if pixels equals nullptr: sets SkImageInfo, returns true.

        Caller must ensure that pixels are valid for the lifetime of SkBitmap and SkPixelRef.

        @param info      contains width, height, SkAlphaType, SkColorType, SkColorSpace
        @param pixels    address or pixel storage; may be nullptr
        @param rowBytes  size of pixel row or larger
        @return          true if SkImageInfo is set to info
    */
    bool installPixels(const SkImageInfo& info, void* pixels, size_t rowBytes) {
        return this->installPixels(info, pixels, rowBytes, nullptr, nullptr);
    }

    /** Sets SkImageInfo to pixmap.info() following the rules in setInfo(), and creates
        SkPixelRef containing pixmap.addr() and pixmap.rowBytes().

        If SkImageInfo could not be set, or pixmap.rowBytes() is less than
        SkImageInfo::minRowBytes(): calls reset(), and returns false.

        Otherwise, if pixmap.addr() equals nullptr: sets SkImageInfo, returns true.

        Caller must ensure that pixmap is valid for the lifetime of SkBitmap and SkPixelRef.

        @param pixmap  SkImageInfo, pixel address, and rowBytes()
        @return        true if SkImageInfo was set to pixmap.info()

        example: https://fiddle.skia.org/c/@Bitmap_installPixels_3
    */
    bool installPixels(const SkPixmap& pixmap);

    /** Deprecated.
    */
    bool installMaskPixels(const SkMask& mask);

    /** Replaces SkPixelRef with pixels, preserving SkImageInfo and rowBytes().
        Sets SkPixelRef origin to (0, 0).

        If pixels is nullptr, or if info().colorType() equals kUnknown_SkColorType;
        release reference to SkPixelRef, and set SkPixelRef to nullptr.

        Caller is responsible for handling ownership pixel memory for the lifetime
        of SkBitmap and SkPixelRef.

        @param pixels  address of pixel storage, managed by caller

        example: https://fiddle.skia.org/c/@Bitmap_setPixels
    */
    void setPixels(void* pixels);

    /** Allocates pixel memory with HeapAllocator, and replaces existing SkPixelRef.
        The allocation size is determined by SkImageInfo width, height, and SkColorType.

        Returns false if info().colorType() is kUnknown_SkColorType, or allocation fails.

        @return  true if the allocation succeeds
    */
    bool SK_WARN_UNUSED_RESULT tryAllocPixels() {
        return this->tryAllocPixels((Allocator*)nullptr);
    }

    /** Allocates pixel memory with HeapAllocator, and replaces existing SkPixelRef.
        The allocation size is determined by SkImageInfo width, height, and SkColorType.

        Aborts if info().colorType() is kUnknown_SkColorType, or allocation fails.
        Abort steps may be provided by the user at compile
        time by defining SK_ABORT.

        example: https://fiddle.skia.org/c/@Bitmap_allocPixels_3
    */
    void allocPixels();

    /** Allocates pixel memory with allocator, and replaces existing SkPixelRef.
        The allocation size is determined by SkImageInfo width, height, and SkColorType.
        If allocator is nullptr, use HeapAllocator instead.

        Returns false if Allocator::allocPixelRef return false.

        @param allocator  instance of SkBitmap::Allocator instantiation
        @return           true if custom allocator reports success
    */
    bool SK_WARN_UNUSED_RESULT tryAllocPixels(Allocator* allocator);

    /** Allocates pixel memory with allocator, and replaces existing SkPixelRef.
        The allocation size is determined by SkImageInfo width, height, and SkColorType.
        If allocator is nullptr, use HeapAllocator instead.

        Aborts if Allocator::allocPixelRef return false. Abort steps may be provided by
        the user at compile time by defining SK_ABORT.

        @param allocator  instance of SkBitmap::Allocator instantiation

        example: https://fiddle.skia.org/c/@Bitmap_allocPixels_4
    */
    void allocPixels(Allocator* allocator);

    /** Returns SkPixelRef, which contains: pixel base address; its dimensions; and
        rowBytes(), the interval from one row to the next. Does not change SkPixelRef
        reference count. SkPixelRef may be shared by multiple bitmaps.
        If SkPixelRef has not been set, returns nullptr.

        @return  SkPixelRef, or nullptr
    */
    SkPixelRef* pixelRef() const { return fPixelRef.get(); }

    /** Returns origin of pixels within SkPixelRef. SkBitmap bounds is always contained
        by SkPixelRef bounds, which may be the same size or larger. Multiple SkBitmap
        can share the same SkPixelRef, where each SkBitmap has different bounds.

        The returned origin added to SkBitmap dimensions equals or is smaller than the
        SkPixelRef dimensions.

        Returns (0, 0) if SkPixelRef is nullptr.

        @return  pixel origin within SkPixelRef

        example: https://fiddle.skia.org/c/@Bitmap_pixelRefOrigin
    */
    SkIPoint pixelRefOrigin() const;

    /** Replaces pixelRef and origin in SkBitmap.  dx and dy specify the offset
        within the SkPixelRef pixels for the top-left corner of the bitmap.

        Asserts in debug builds if dx or dy are out of range. Pins dx and dy
        to legal range in release builds.

        The caller is responsible for ensuring that the pixels match the
        SkColorType and SkAlphaType in SkImageInfo.

        @param pixelRef  SkPixelRef describing pixel address and rowBytes()
        @param dx        column offset in SkPixelRef for bitmap origin
        @param dy        row offset in SkPixelRef for bitmap origin

        example: https://fiddle.skia.org/c/@Bitmap_setPixelRef
    */
    void setPixelRef(sk_sp<SkPixelRef> pixelRef, int dx, int dy);

    /** Returns true if SkBitmap is can be drawn.

        @return  true if getPixels() is not nullptr
    */
    bool readyToDraw() const {
        return this->getPixels() != nullptr;
    }

    /** Returns a unique value corresponding to the pixels in SkPixelRef.
        Returns a different value after notifyPixelsChanged() has been called.
        Returns zero if SkPixelRef is nullptr.

        Determines if pixels have changed since last examined.

        @return  unique value for pixels in SkPixelRef

        example: https://fiddle.skia.org/c/@Bitmap_getGenerationID
    */
    uint32_t getGenerationID() const;

    /** Marks that pixels in SkPixelRef have changed. Subsequent calls to
        getGenerationID() return a different value.

        example: https://fiddle.skia.org/c/@Bitmap_notifyPixelsChanged
    */
    void notifyPixelsChanged() const;

    /** Replaces pixel values with c, interpreted as being in the sRGB SkColorSpace.
        All pixels contained by bounds() are affected. If the colorType() is
        kGray_8_SkColorType or kRGB_565_SkColorType, then alpha is ignored; RGB is
        treated as opaque. If colorType() is kAlpha_8_SkColorType, then RGB is ignored.

        @param c  unpremultiplied color

        example: https://fiddle.skia.org/c/@Bitmap_eraseColor
    */
    void eraseColor(SkColor c) const;

    /** Replaces pixel values with unpremultiplied color built from a, r, g, and b,
        interpreted as being in the sRGB SkColorSpace. All pixels contained by
        bounds() are affected. If the colorType() is kGray_8_SkColorType or
        kRGB_565_SkColorType, then a is ignored; r, g, and b are treated as opaque.
        If colorType() is kAlpha_8_SkColorType, then r, g, and b are ignored.

        @param a  amount of alpha, from fully transparent (0) to fully opaque (255)
        @param r  amount of red, from no red (0) to full red (255)
        @param g  amount of green, from no green (0) to full green (255)
        @param b  amount of blue, from no blue (0) to full blue (255)
    */
    void eraseARGB(U8CPU a, U8CPU r, U8CPU g, U8CPU b) const {
        this->eraseColor(SkColorSetARGB(a, r, g, b));
    }

    /** Replaces pixel values inside area with c. interpreted as being in the sRGB
        SkColorSpace. If area does not intersect bounds(), call has no effect.

        If the colorType() is kGray_8_SkColorType or kRGB_565_SkColorType, then alpha
        is ignored; RGB is treated as opaque. If colorType() is kAlpha_8_SkColorType,
        then RGB is ignored.

        @param c     unpremultiplied color
        @param area  rectangle to fill

        example: https://fiddle.skia.org/c/@Bitmap_erase
    */
    void erase(SkColor c, const SkIRect& area) const;

    /** Deprecated.
    */
    void eraseArea(const SkIRect& area, SkColor c) const {
        this->erase(c, area);
    }

    /** Returns pixel at (x, y) as unpremultiplied color.
        Returns black with alpha if SkColorType is kAlpha_8_SkColorType.

        Input is not validated: out of bounds values of x or y trigger an assert() if
        built with SK_DEBUG defined; and returns undefined values or may crash if
        SK_RELEASE is defined. Fails if SkColorType is kUnknown_SkColorType or
        pixel address is nullptr.

        SkColorSpace in SkImageInfo is ignored. Some color precision may be lost in the
        conversion to unpremultiplied color; original pixel data may have additional
        precision.

        @param x  column index, zero or greater, and less than width()
        @param y  row index, zero or greater, and less than height()
        @return   pixel converted to unpremultiplied color
    */
    SkColor getColor(int x, int y) const {
        return this->pixmap().getColor(x, y);
    }

    /** Look up the pixel at (x,y) and return its alpha component, normalized to [0..1].
        This is roughly equivalent to SkGetColorA(getColor()), but can be more efficent
        (and more precise if the pixels store more than 8 bits per component).

        @param x  column index, zero or greater, and less than width()
        @param y  row index, zero or greater, and less than height()
        @return   alpha converted to normalized float
     */
    float getAlphaf(int x, int y) const {
        return this->pixmap().getAlphaf(x, y);
    }

    /** Returns pixel address at (x, y).

        Input is not validated: out of bounds values of x or y, or kUnknown_SkColorType,
        trigger an assert() if built with SK_DEBUG defined. Returns nullptr if
        SkColorType is kUnknown_SkColorType, or SkPixelRef is nullptr.

        Performs a lookup of pixel size; for better performance, call
        one of: getAddr8(), getAddr16(), or getAddr32().

        @param x  column index, zero or greater, and less than width()
        @param y  row index, zero or greater, and less than height()
        @return   generic pointer to pixel

        example: https://fiddle.skia.org/c/@Bitmap_getAddr
    */
    void* getAddr(int x, int y) const;

    /** Returns address at (x, y).

        Input is not validated. Triggers an assert() if built with SK_DEBUG defined and:
        - SkPixelRef is nullptr
        - bytesPerPixel() is not four
        - x is negative, or not less than width()
        - y is negative, or not less than height()

        @param x  column index, zero or greater, and less than width()
        @param y  row index, zero or greater, and less than height()
        @return   unsigned 32-bit pointer to pixel at (x, y)
    */
    inline uint32_t* getAddr32(int x, int y) const;

    /** Returns address at (x, y).

        Input is not validated. Triggers an assert() if built with SK_DEBUG defined and:
        - SkPixelRef is nullptr
        - bytesPerPixel() is not two
        - x is negative, or not less than width()
        - y is negative, or not less than height()

        @param x  column index, zero or greater, and less than width()
        @param y  row index, zero or greater, and less than height()
        @return   unsigned 16-bit pointer to pixel at (x, y)
    */
    inline uint16_t* getAddr16(int x, int y) const;

    /** Returns address at (x, y).

        Input is not validated. Triggers an assert() if built with SK_DEBUG defined and:
        - SkPixelRef is nullptr
        - bytesPerPixel() is not one
        - x is negative, or not less than width()
        - y is negative, or not less than height()

        @param x  column index, zero or greater, and less than width()
        @param y  row index, zero or greater, and less than height()
        @return   unsigned 8-bit pointer to pixel at (x, y)
    */
    inline uint8_t* getAddr8(int x, int y) const;

    /** Shares SkPixelRef with dst. Pixels are not copied; SkBitmap and dst point
        to the same pixels; dst bounds() are set to the intersection of subset
        and the original bounds().

        subset may be larger than bounds(). Any area outside of bounds() is ignored.

        Any contents of dst are discarded.

        Return false if:
        - dst is nullptr
        - SkPixelRef is nullptr
        - subset does not intersect bounds()

        @param dst     SkBitmap set to subset
        @param subset  rectangle of pixels to reference
        @return        true if dst is replaced by subset

        example: https://fiddle.skia.org/c/@Bitmap_extractSubset
    */
    bool extractSubset(SkBitmap* dst, const SkIRect& subset) const;

    /** Copies a SkRect of pixels from SkBitmap to dstPixels. Copy starts at (srcX, srcY),
        and does not exceed SkBitmap (width(), height()).

        dstInfo specifies width, height, SkColorType, SkAlphaType, and SkColorSpace of
        destination. dstRowBytes specifics the gap from one destination row to the next.
        Returns true if pixels are copied. Returns false if:
        - dstInfo has no address
        - dstRowBytes is less than dstInfo.minRowBytes()
        - SkPixelRef is nullptr

        Pixels are copied only if pixel conversion is possible. If SkBitmap colorType() is
        kGray_8_SkColorType, or kAlpha_8_SkColorType; dstInfo.colorType() must match.
        If SkBitmap colorType() is kGray_8_SkColorType, dstInfo.colorSpace() must match.
        If SkBitmap alphaType() is kOpaque_SkAlphaType, dstInfo.alphaType() must
        match. If SkBitmap colorSpace() is nullptr, dstInfo.colorSpace() must match. Returns
        false if pixel conversion is not possible.

        srcX and srcY may be negative to copy only top or left of source. Returns
        false if width() or height() is zero or negative.
        Returns false if abs(srcX) >= Bitmap width(), or if abs(srcY) >= Bitmap height().

        @param dstInfo      destination width, height, SkColorType, SkAlphaType, SkColorSpace
        @param dstPixels    destination pixel storage
        @param dstRowBytes  destination row length
        @param srcX         column index whose absolute value is less than width()
        @param srcY         row index whose absolute value is less than height()
        @return             true if pixels are copied to dstPixels
    */
    bool readPixels(const SkImageInfo& dstInfo, void* dstPixels, size_t dstRowBytes,
                    int srcX, int srcY) const;

    /** Copies a SkRect of pixels from SkBitmap to dst. Copy starts at (srcX, srcY), and
        does not exceed SkBitmap (width(), height()).

        dst specifies width, height, SkColorType, SkAlphaType, SkColorSpace, pixel storage,
        and row bytes of destination. dst.rowBytes() specifics the gap from one destination
        row to the next. Returns true if pixels are copied. Returns false if:
        - dst pixel storage equals nullptr
        - dst.rowBytes is less than SkImageInfo::minRowBytes()
        - SkPixelRef is nullptr

        Pixels are copied only if pixel conversion is possible. If SkBitmap colorType() is
        kGray_8_SkColorType, or kAlpha_8_SkColorType; dst SkColorType must match.
        If SkBitmap colorType() is kGray_8_SkColorType, dst SkColorSpace must match.
        If SkBitmap alphaType() is kOpaque_SkAlphaType, dst SkAlphaType must
        match. If SkBitmap colorSpace() is nullptr, dst SkColorSpace must match. Returns
        false if pixel conversion is not possible.

        srcX and srcY may be negative to copy only top or left of source. Returns
        false if width() or height() is zero or negative.
        Returns false if abs(srcX) >= Bitmap width(), or if abs(srcY) >= Bitmap height().

        @param dst   destination SkPixmap: SkImageInfo, pixels, row bytes
        @param srcX  column index whose absolute value is less than width()
        @param srcY  row index whose absolute value is less than height()
        @return      true if pixels are copied to dst

        example: https://fiddle.skia.org/c/@Bitmap_readPixels_2
    */
    bool readPixels(const SkPixmap& dst, int srcX, int srcY) const;

    /** Copies a SkRect of pixels from SkBitmap to dst. Copy starts at (0, 0), and
        does not exceed SkBitmap (width(), height()).

        dst specifies width, height, SkColorType, SkAlphaType, SkColorSpace, pixel storage,
        and row bytes of destination. dst.rowBytes() specifics the gap from one destination
        row to the next. Returns true if pixels are copied. Returns false if:
        - dst pixel storage equals nullptr
        - dst.rowBytes is less than SkImageInfo::minRowBytes()
        - SkPixelRef is nullptr

        Pixels are copied only if pixel conversion is possible. If SkBitmap colorType() is
        kGray_8_SkColorType, or kAlpha_8_SkColorType; dst SkColorType must match.
        If SkBitmap colorType() is kGray_8_SkColorType, dst SkColorSpace must match.
        If SkBitmap alphaType() is kOpaque_SkAlphaType, dst SkAlphaType must
        match. If SkBitmap colorSpace() is nullptr, dst SkColorSpace must match. Returns
        false if pixel conversion is not possible.

        @param dst  destination SkPixmap: SkImageInfo, pixels, row bytes
        @return     true if pixels are copied to dst
    */
    bool readPixels(const SkPixmap& dst) const {
        return this->readPixels(dst, 0, 0);
    }

    /** Copies a SkRect of pixels from src. Copy starts at (dstX, dstY), and does not exceed
        (src.width(), src.height()).

        src specifies width, height, SkColorType, SkAlphaType, SkColorSpace, pixel storage,
        and row bytes of source. src.rowBytes() specifics the gap from one source
        row to the next. Returns true if pixels are copied. Returns false if:
        - src pixel storage equals nullptr
        - src.rowBytes is less than SkImageInfo::minRowBytes()
        - SkPixelRef is nullptr

        Pixels are copied only if pixel conversion is possible. If SkBitmap colorType() is
        kGray_8_SkColorType, or kAlpha_8_SkColorType; src SkColorType must match.
        If SkBitmap colorType() is kGray_8_SkColorType, src SkColorSpace must match.
        If SkBitmap alphaType() is kOpaque_SkAlphaType, src SkAlphaType must
        match. If SkBitmap colorSpace() is nullptr, src SkColorSpace must match. Returns
        false if pixel conversion is not possible.

        dstX and dstY may be negative to copy only top or left of source. Returns
        false if width() or height() is zero or negative.
        Returns false if abs(dstX) >= Bitmap width(), or if abs(dstY) >= Bitmap height().

        @param src   source SkPixmap: SkImageInfo, pixels, row bytes
        @param dstX  column index whose absolute value is less than width()
        @param dstY  row index whose absolute value is less than height()
        @return      true if src pixels are copied to SkBitmap

        example: https://fiddle.skia.org/c/@Bitmap_writePixels
    */
    bool writePixels(const SkPixmap& src, int dstX, int dstY);

    /** Copies a SkRect of pixels from src. Copy starts at (0, 0), and does not exceed
        (src.width(), src.height()).

        src specifies width, height, SkColorType, SkAlphaType, SkColorSpace, pixel storage,
        and row bytes of source. src.rowBytes() specifics the gap from one source
        row to the next. Returns true if pixels are copied. Returns false if:
        - src pixel storage equals nullptr
        - src.rowBytes is less than SkImageInfo::minRowBytes()
        - SkPixelRef is nullptr

        Pixels are copied only if pixel conversion is possible. If SkBitmap colorType() is
        kGray_8_SkColorType, or kAlpha_8_SkColorType; src SkColorType must match.
        If SkBitmap colorType() is kGray_8_SkColorType, src SkColorSpace must match.
        If SkBitmap alphaType() is kOpaque_SkAlphaType, src SkAlphaType must
        match. If SkBitmap colorSpace() is nullptr, src SkColorSpace must match. Returns
        false if pixel conversion is not possible.

        @param src  source SkPixmap: SkImageInfo, pixels, row bytes
        @return     true if src pixels are copied to SkBitmap
    */
    bool writePixels(const SkPixmap& src) {
        return this->writePixels(src, 0, 0);
    }

    /** Sets dst to alpha described by pixels. Returns false if dst cannot be written to
        or dst pixels cannot be allocated.

        Uses HeapAllocator to reserve memory for dst SkPixelRef.

        @param dst  holds SkPixelRef to fill with alpha layer
        @return     true if alpha layer was constructed in dst SkPixelRef
    */
    bool extractAlpha(SkBitmap* dst) const {
        return this->extractAlpha(dst, nullptr, nullptr, nullptr);
    }

    /** Sets dst to alpha described by pixels. Returns false if dst cannot be written to
        or dst pixels cannot be allocated.

        If paint is not nullptr and contains SkMaskFilter, SkMaskFilter
        generates mask alpha from SkBitmap. Uses HeapAllocator to reserve memory for dst
        SkPixelRef. Sets offset to top-left position for dst for alignment with SkBitmap;
        (0, 0) unless SkMaskFilter generates mask.

        @param dst     holds SkPixelRef to fill with alpha layer
        @param paint   holds optional SkMaskFilter; may be nullptr
        @param offset  top-left position for dst; may be nullptr
        @return        true if alpha layer was constructed in dst SkPixelRef
    */
    bool extractAlpha(SkBitmap* dst, const SkPaint* paint,
                      SkIPoint* offset) const {
        return this->extractAlpha(dst, paint, nullptr, offset);
    }

    /** Sets dst to alpha described by pixels. Returns false if dst cannot be written to
        or dst pixels cannot be allocated.

        If paint is not nullptr and contains SkMaskFilter, SkMaskFilter
        generates mask alpha from SkBitmap. allocator may reference a custom allocation
        class or be set to nullptr to use HeapAllocator. Sets offset to top-left
        position for dst for alignment with SkBitmap; (0, 0) unless SkMaskFilter generates
        mask.

        @param dst        holds SkPixelRef to fill with alpha layer
        @param paint      holds optional SkMaskFilter; may be nullptr
        @param allocator  function to reserve memory for SkPixelRef; may be nullptr
        @param offset     top-left position for dst; may be nullptr
        @return           true if alpha layer was constructed in dst SkPixelRef
    */
    bool extractAlpha(SkBitmap* dst, const SkPaint* paint, Allocator* allocator,
                      SkIPoint* offset) const;

    /** Copies SkBitmap pixel address, row bytes, and SkImageInfo to pixmap, if address
        is available, and returns true. If pixel address is not available, return
        false and leave pixmap unchanged.

        pixmap contents become invalid on any future change to SkBitmap.

        @param pixmap  storage for pixel state if pixels are readable; otherwise, ignored
        @return        true if SkBitmap has direct access to pixels

        example: https://fiddle.skia.org/c/@Bitmap_peekPixels
    */
    bool peekPixels(SkPixmap* pixmap) const;
    sk_sp<SkShader> makeShader(SkTileMode tmx, SkTileMode tmy, const SkSamplingOptions&,
                               const SkMatrix* = nullptr) const;

    sk_sp<SkShader> makeShader(SkTileMode tmx, SkTileMode tmy, const SkSamplingOptions& sampling,
                               const SkMatrix& localMatrix) const {
        return this->makeShader(tmx, tmy, sampling, &localMatrix);
    }

    sk_sp<SkShader> makeShader(const SkSamplingOptions& sampling,
                               const SkMatrix* localMatrix = nullptr) const {
        return this->makeShader(SkTileMode::kClamp, SkTileMode::kClamp, sampling, localMatrix);
    }

    sk_sp<SkShader> makeShader(const SkSamplingOptions& sampling,
                               const SkMatrix& localMatrix) const {
        return this->makeShader(sampling, &localMatrix);
    }

    /**
     *  Returns a new image from the bitmap. If the bitmap is marked immutable, this will
     *  share the pixel buffer. If not, it will make a copy of the pixels for the image.
     */
    sk_sp<SkImage> asImage() const;

    /** Asserts if internal values are illegal or inconsistent. Only available if
        SK_DEBUG is defined at compile time.
    */
    SkDEBUGCODE(void validate() const;)

    /** \class SkBitmap::Allocator
        Abstract subclass of HeapAllocator.
    */
    class Allocator : public SkRefCnt {
    public:

        /** Allocates the pixel memory for the bitmap, given its dimensions and
            SkColorType. Returns true on success, where success means either setPixels()
            or setPixelRef() was called.

            @param bitmap  SkBitmap containing SkImageInfo as input, and SkPixelRef as output
            @return        true if SkPixelRef was allocated
        */
        virtual bool allocPixelRef(SkBitmap* bitmap) = 0;
    private:
        using INHERITED = SkRefCnt;
    };

    /** \class SkBitmap::HeapAllocator
        Subclass of SkBitmap::Allocator that returns a SkPixelRef that allocates its pixel
        memory from the heap. This is the default SkBitmap::Allocator invoked by
        allocPixels().
    */
    class HeapAllocator : public Allocator {
    public:

        /** Allocates the pixel memory for the bitmap, given its dimensions and
            SkColorType. Returns true on success, where success means either setPixels()
            or setPixelRef() was called.

            @param bitmap  SkBitmap containing SkImageInfo as input, and SkPixelRef as output
            @return        true if pixels are allocated

        example: https://fiddle.skia.org/c/@Bitmap_HeapAllocator_allocPixelRef
        */
        bool allocPixelRef(SkBitmap* bitmap) override;
    };

private:
    sk_sp<SkPixelRef>   fPixelRef;
    SkPixmap            fPixmap;
    sk_sp<SkMipmap>     fMips;

    friend class SkImage_Raster;
    friend class SkReadBuffer;        // unflatten
};

///////////////////////////////////////////////////////////////////////////////

inline uint32_t* SkBitmap::getAddr32(int x, int y) const {
    SkASSERT(fPixmap.addr());
    return fPixmap.writable_addr32(x, y);
}

inline uint16_t* SkBitmap::getAddr16(int x, int y) const {
    SkASSERT(fPixmap.addr());
    return fPixmap.writable_addr16(x, y);
}

inline uint8_t* SkBitmap::getAddr8(int x, int y) const {
    SkASSERT(fPixmap.addr());
    return fPixmap.writable_addr8(x, y);
}

#endif
