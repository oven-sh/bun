/*
 * Copyright 2015 Google Inc.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SkPixmap_DEFINED
#define SkPixmap_DEFINED

#include "include/core/SkColor.h"
#include "include/core/SkImageInfo.h"
#include "include/core/SkSamplingOptions.h"

class SkData;
struct SkMask;

/** \class SkPixmap
    SkPixmap provides a utility to pair SkImageInfo with pixels and row bytes.
    SkPixmap is a low level class which provides convenience functions to access
    raster destinations. SkCanvas can not draw SkPixmap, nor does SkPixmap provide
    a direct drawing destination.

    Use SkBitmap to draw pixels referenced by SkPixmap; use SkSurface to draw into
    pixels referenced by SkPixmap.

    SkPixmap does not try to manage the lifetime of the pixel memory. Use SkPixelRef
    to manage pixel memory; SkPixelRef is safe across threads.
*/
class SK_API SkPixmap {
public:

    /** Creates an empty SkPixmap without pixels, with kUnknown_SkColorType, with
        kUnknown_SkAlphaType, and with a width and height of zero. Use
        reset() to associate pixels, SkColorType, SkAlphaType, width, and height
        after SkPixmap has been created.

        @return  empty SkPixmap
    */
    SkPixmap()
        : fPixels(nullptr), fRowBytes(0), fInfo(SkImageInfo::MakeUnknown(0, 0))
    {}

    /** Creates SkPixmap from info width, height, SkAlphaType, and SkColorType.
        addr points to pixels, or nullptr. rowBytes should be info.width() times
        info.bytesPerPixel(), or larger.

        No parameter checking is performed; it is up to the caller to ensure that
        addr and rowBytes agree with info.

        The memory lifetime of pixels is managed by the caller. When SkPixmap goes
        out of scope, addr is unaffected.

        SkPixmap may be later modified by reset() to change its size, pixel type, or
        storage.

        @param info      width, height, SkAlphaType, SkColorType of SkImageInfo
        @param addr      pointer to pixels allocated by caller; may be nullptr
        @param rowBytes  size of one row of addr; width times pixel size, or larger
        @return          initialized SkPixmap
    */
    SkPixmap(const SkImageInfo& info, const void* addr, size_t rowBytes)
        : fPixels(addr), fRowBytes(rowBytes), fInfo(info)
    {}

    /** Sets width, height, row bytes to zero; pixel address to nullptr; SkColorType to
        kUnknown_SkColorType; and SkAlphaType to kUnknown_SkAlphaType.

        The prior pixels are unaffected; it is up to the caller to release pixels
        memory if desired.

        example: https://fiddle.skia.org/c/@Pixmap_reset
    */
    void reset();

    /** Sets width, height, SkAlphaType, and SkColorType from info.
        Sets pixel address from addr, which may be nullptr.
        Sets row bytes from rowBytes, which should be info.width() times
        info.bytesPerPixel(), or larger.

        Does not check addr. Asserts if built with SK_DEBUG defined and if rowBytes is
        too small to hold one row of pixels.

        The memory lifetime pixels are managed by the caller. When SkPixmap goes
        out of scope, addr is unaffected.

        @param info      width, height, SkAlphaType, SkColorType of SkImageInfo
        @param addr      pointer to pixels allocated by caller; may be nullptr
        @param rowBytes  size of one row of addr; width times pixel size, or larger

        example: https://fiddle.skia.org/c/@Pixmap_reset_2
    */
    void reset(const SkImageInfo& info, const void* addr, size_t rowBytes);

    /** Changes SkColorSpace in SkImageInfo; preserves width, height, SkAlphaType, and
        SkColorType in SkImage, and leaves pixel address and row bytes unchanged.
        SkColorSpace reference count is incremented.

        @param colorSpace  SkColorSpace moved to SkImageInfo

        example: https://fiddle.skia.org/c/@Pixmap_setColorSpace
    */
    void setColorSpace(sk_sp<SkColorSpace> colorSpace);

    /** Deprecated.
    */
    bool SK_WARN_UNUSED_RESULT reset(const SkMask& mask);

    /** Sets subset width, height, pixel address to intersection of SkPixmap with area,
        if intersection is not empty; and return true. Otherwise, leave subset unchanged
        and return false.

        Failing to read the return value generates a compile time warning.

        @param subset  storage for width, height, pixel address of intersection
        @param area    bounds to intersect with SkPixmap
        @return        true if intersection of SkPixmap and area is not empty
    */
    bool SK_WARN_UNUSED_RESULT extractSubset(SkPixmap* subset, const SkIRect& area) const;

    /** Returns width, height, SkAlphaType, SkColorType, and SkColorSpace.

        @return  reference to SkImageInfo
    */
    const SkImageInfo& info() const { return fInfo; }

    /** Returns row bytes, the interval from one pixel row to the next. Row bytes
        is at least as large as: width() * info().bytesPerPixel().

        Returns zero if colorType() is kUnknown_SkColorType.
        It is up to the SkBitmap creator to ensure that row bytes is a useful value.

        @return  byte length of pixel row
    */
    size_t rowBytes() const { return fRowBytes; }

    /** Returns pixel address, the base address corresponding to the pixel origin.

        It is up to the SkPixmap creator to ensure that pixel address is a useful value.

        @return  pixel address
    */
    const void* addr() const { return fPixels; }

    /** Returns pixel count in each pixel row. Should be equal or less than:
        rowBytes() / info().bytesPerPixel().

        @return  pixel width in SkImageInfo
    */
    int width() const { return fInfo.width(); }

    /** Returns pixel row count.

        @return  pixel height in SkImageInfo
    */
    int height() const { return fInfo.height(); }

    /**
     *  Return the dimensions of the pixmap (from its ImageInfo)
     */
    SkISize dimensions() const { return fInfo.dimensions(); }

    SkColorType colorType() const { return fInfo.colorType(); }

    SkAlphaType alphaType() const { return fInfo.alphaType(); }

    /** Returns SkColorSpace, the range of colors, associated with SkImageInfo. The
        reference count of SkColorSpace is unchanged. The returned SkColorSpace is
        immutable.

        @return  SkColorSpace in SkImageInfo, or nullptr
    */
    SkColorSpace* colorSpace() const { return fInfo.colorSpace(); }

    /** Returns smart pointer to SkColorSpace, the range of colors, associated with
        SkImageInfo. The smart pointer tracks the number of objects sharing this
        SkColorSpace reference so the memory is released when the owners destruct.

        The returned SkColorSpace is immutable.

        @return  SkColorSpace in SkImageInfo wrapped in a smart pointer
    */
    sk_sp<SkColorSpace> refColorSpace() const { return fInfo.refColorSpace(); }

    /** Returns true if SkAlphaType is kOpaque_SkAlphaType.
        Does not check if SkColorType allows alpha, or if any pixel value has
        transparency.

        @return  true if SkImageInfo has opaque SkAlphaType
    */
    bool isOpaque() const { return fInfo.isOpaque(); }

    /** Returns SkIRect { 0, 0, width(), height() }.

        @return  integral rectangle from origin to width() and height()
    */
    SkIRect bounds() const { return SkIRect::MakeWH(this->width(), this->height()); }

    /** Returns number of pixels that fit on row. Should be greater than or equal to
        width().

        @return  maximum pixels per row
    */
    int rowBytesAsPixels() const { return int(fRowBytes >> this->shiftPerPixel()); }

    /** Returns bit shift converting row bytes to row pixels.
        Returns zero for kUnknown_SkColorType.

        @return  one of: 0, 1, 2, 3; left shift to convert pixels to bytes
    */
    int shiftPerPixel() const { return fInfo.shiftPerPixel(); }

    /** Returns minimum memory required for pixel storage.
        Does not include unused memory on last row when rowBytesAsPixels() exceeds width().
        Returns SIZE_MAX if result does not fit in size_t.
        Returns zero if height() or width() is 0.
        Returns height() times rowBytes() if colorType() is kUnknown_SkColorType.

        @return  size in bytes of image buffer
    */
    size_t computeByteSize() const { return fInfo.computeByteSize(fRowBytes); }

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

        @return  true if all pixels have opaque values or SkColorType is opaque

        example: https://fiddle.skia.org/c/@Pixmap_computeIsOpaque
    */
    bool computeIsOpaque() const;

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

        example: https://fiddle.skia.org/c/@Pixmap_getColor
    */
    SkColor getColor(int x, int y) const;

    /** Look up the pixel at (x,y) and return its alpha component, normalized to [0..1].
        This is roughly equivalent to SkGetColorA(getColor()), but can be more efficent
        (and more precise if the pixels store more than 8 bits per component).

        @param x  column index, zero or greater, and less than width()
        @param y  row index, zero or greater, and less than height()
        @return   alpha converted to normalized float
     */
    float getAlphaf(int x, int y) const;

    /** Returns readable pixel address at (x, y). Returns nullptr if SkPixelRef is nullptr.

        Input is not validated: out of bounds values of x or y trigger an assert() if
        built with SK_DEBUG defined. Returns nullptr if SkColorType is kUnknown_SkColorType.

        Performs a lookup of pixel size; for better performance, call
        one of: addr8, addr16, addr32, addr64, or addrF16().

        @param x  column index, zero or greater, and less than width()
        @param y  row index, zero or greater, and less than height()
        @return   readable generic pointer to pixel
    */
    const void* addr(int x, int y) const {
        return (const char*)fPixels + fInfo.computeOffset(x, y, fRowBytes);
    }

    /** Returns readable base pixel address. Result is addressable as unsigned 8-bit bytes.
        Will trigger an assert() if SkColorType is not kAlpha_8_SkColorType or
        kGray_8_SkColorType, and is built with SK_DEBUG defined.

        One byte corresponds to one pixel.

        @return  readable unsigned 8-bit pointer to pixels
    */
    const uint8_t* addr8() const {
        SkASSERT(1 == fInfo.bytesPerPixel());
        return reinterpret_cast<const uint8_t*>(fPixels);
    }

    /** Returns readable base pixel address. Result is addressable as unsigned 16-bit words.
        Will trigger an assert() if SkColorType is not kRGB_565_SkColorType or
        kARGB_4444_SkColorType, and is built with SK_DEBUG defined.

        One word corresponds to one pixel.

        @return  readable unsigned 16-bit pointer to pixels
    */
    const uint16_t* addr16() const {
        SkASSERT(2 == fInfo.bytesPerPixel());
        return reinterpret_cast<const uint16_t*>(fPixels);
    }

    /** Returns readable base pixel address. Result is addressable as unsigned 32-bit words.
        Will trigger an assert() if SkColorType is not kRGBA_8888_SkColorType or
        kBGRA_8888_SkColorType, and is built with SK_DEBUG defined.

        One word corresponds to one pixel.

        @return  readable unsigned 32-bit pointer to pixels
    */
    const uint32_t* addr32() const {
        SkASSERT(4 == fInfo.bytesPerPixel());
        return reinterpret_cast<const uint32_t*>(fPixels);
    }

    /** Returns readable base pixel address. Result is addressable as unsigned 64-bit words.
        Will trigger an assert() if SkColorType is not kRGBA_F16_SkColorType and is built
        with SK_DEBUG defined.

        One word corresponds to one pixel.

        @return  readable unsigned 64-bit pointer to pixels
    */
    const uint64_t* addr64() const {
        SkASSERT(8 == fInfo.bytesPerPixel());
        return reinterpret_cast<const uint64_t*>(fPixels);
    }

    /** Returns readable base pixel address. Result is addressable as unsigned 16-bit words.
        Will trigger an assert() if SkColorType is not kRGBA_F16_SkColorType and is built
        with SK_DEBUG defined.

        Each word represents one color component encoded as a half float.
        Four words correspond to one pixel.

        @return  readable unsigned 16-bit pointer to first component of pixels
    */
    const uint16_t* addrF16() const {
        SkASSERT(8 == fInfo.bytesPerPixel());
        SkASSERT(kRGBA_F16_SkColorType     == fInfo.colorType() ||
                 kRGBA_F16Norm_SkColorType == fInfo.colorType());
        return reinterpret_cast<const uint16_t*>(fPixels);
    }

    /** Returns readable pixel address at (x, y).

        Input is not validated: out of bounds values of x or y trigger an assert() if
        built with SK_DEBUG defined.

        Will trigger an assert() if SkColorType is not kAlpha_8_SkColorType or
        kGray_8_SkColorType, and is built with SK_DEBUG defined.

        @param x  column index, zero or greater, and less than width()
        @param y  row index, zero or greater, and less than height()
        @return   readable unsigned 8-bit pointer to pixel at (x, y)
    */
    const uint8_t* addr8(int x, int y) const {
        SkASSERT((unsigned)x < (unsigned)fInfo.width());
        SkASSERT((unsigned)y < (unsigned)fInfo.height());
        return (const uint8_t*)((const char*)this->addr8() + (size_t)y * fRowBytes + (x << 0));
    }

    /** Returns readable pixel address at (x, y).

        Input is not validated: out of bounds values of x or y trigger an assert() if
        built with SK_DEBUG defined.

        Will trigger an assert() if SkColorType is not kRGB_565_SkColorType or
        kARGB_4444_SkColorType, and is built with SK_DEBUG defined.

        @param x  column index, zero or greater, and less than width()
        @param y  row index, zero or greater, and less than height()
        @return   readable unsigned 16-bit pointer to pixel at (x, y)
    */
    const uint16_t* addr16(int x, int y) const {
        SkASSERT((unsigned)x < (unsigned)fInfo.width());
        SkASSERT((unsigned)y < (unsigned)fInfo.height());
        return (const uint16_t*)((const char*)this->addr16() + (size_t)y * fRowBytes + (x << 1));
    }

    /** Returns readable pixel address at (x, y).

        Input is not validated: out of bounds values of x or y trigger an assert() if
        built with SK_DEBUG defined.

        Will trigger an assert() if SkColorType is not kRGBA_8888_SkColorType or
        kBGRA_8888_SkColorType, and is built with SK_DEBUG defined.

        @param x  column index, zero or greater, and less than width()
        @param y  row index, zero or greater, and less than height()
        @return   readable unsigned 32-bit pointer to pixel at (x, y)
    */
    const uint32_t* addr32(int x, int y) const {
        SkASSERT((unsigned)x < (unsigned)fInfo.width());
        SkASSERT((unsigned)y < (unsigned)fInfo.height());
        return (const uint32_t*)((const char*)this->addr32() + (size_t)y * fRowBytes + (x << 2));
    }

    /** Returns readable pixel address at (x, y).

        Input is not validated: out of bounds values of x or y trigger an assert() if
        built with SK_DEBUG defined.

        Will trigger an assert() if SkColorType is not kRGBA_F16_SkColorType and is built
        with SK_DEBUG defined.

        @param x  column index, zero or greater, and less than width()
        @param y  row index, zero or greater, and less than height()
        @return   readable unsigned 64-bit pointer to pixel at (x, y)
    */
    const uint64_t* addr64(int x, int y) const {
        SkASSERT((unsigned)x < (unsigned)fInfo.width());
        SkASSERT((unsigned)y < (unsigned)fInfo.height());
        return (const uint64_t*)((const char*)this->addr64() + (size_t)y * fRowBytes + (x << 3));
    }

    /** Returns readable pixel address at (x, y).

        Input is not validated: out of bounds values of x or y trigger an assert() if
        built with SK_DEBUG defined.

        Will trigger an assert() if SkColorType is not kRGBA_F16_SkColorType and is built
        with SK_DEBUG defined.

        Each unsigned 16-bit word represents one color component encoded as a half float.
        Four words correspond to one pixel.

        @param x  column index, zero or greater, and less than width()
        @param y  row index, zero or greater, and less than height()
        @return   readable unsigned 16-bit pointer to pixel component at (x, y)
    */
    const uint16_t* addrF16(int x, int y) const {
        SkASSERT(kRGBA_F16_SkColorType     == fInfo.colorType() ||
                 kRGBA_F16Norm_SkColorType == fInfo.colorType());
        return reinterpret_cast<const uint16_t*>(this->addr64(x, y));
    }

    /** Returns writable base pixel address.

        @return  writable generic base pointer to pixels
    */
    void* writable_addr() const { return const_cast<void*>(fPixels); }

    /** Returns writable pixel address at (x, y).

        Input is not validated: out of bounds values of x or y trigger an assert() if
        built with SK_DEBUG defined. Returns zero if SkColorType is kUnknown_SkColorType.

        @param x  column index, zero or greater, and less than width()
        @param y  row index, zero or greater, and less than height()
        @return   writable generic pointer to pixel
    */
    void* writable_addr(int x, int y) const {
        return const_cast<void*>(this->addr(x, y));
    }

    /** Returns writable pixel address at (x, y). Result is addressable as unsigned
        8-bit bytes. Will trigger an assert() if SkColorType is not kAlpha_8_SkColorType
        or kGray_8_SkColorType, and is built with SK_DEBUG defined.

        One byte corresponds to one pixel.

        @param x  column index, zero or greater, and less than width()
        @param y  row index, zero or greater, and less than height()
        @return   writable unsigned 8-bit pointer to pixels
    */
    uint8_t* writable_addr8(int x, int y) const {
        return const_cast<uint8_t*>(this->addr8(x, y));
    }

    /** Returns writable_addr pixel address at (x, y). Result is addressable as unsigned
        16-bit words. Will trigger an assert() if SkColorType is not kRGB_565_SkColorType
        or kARGB_4444_SkColorType, and is built with SK_DEBUG defined.

        One word corresponds to one pixel.

        @param x  column index, zero or greater, and less than width()
        @param y  row index, zero or greater, and less than height()
        @return   writable unsigned 16-bit pointer to pixel
    */
    uint16_t* writable_addr16(int x, int y) const {
        return const_cast<uint16_t*>(this->addr16(x, y));
    }

    /** Returns writable pixel address at (x, y). Result is addressable as unsigned
        32-bit words. Will trigger an assert() if SkColorType is not
        kRGBA_8888_SkColorType or kBGRA_8888_SkColorType, and is built with SK_DEBUG
        defined.

        One word corresponds to one pixel.

        @param x  column index, zero or greater, and less than width()
        @param y  row index, zero or greater, and less than height()
        @return   writable unsigned 32-bit pointer to pixel
    */
    uint32_t* writable_addr32(int x, int y) const {
        return const_cast<uint32_t*>(this->addr32(x, y));
    }

    /** Returns writable pixel address at (x, y). Result is addressable as unsigned
        64-bit words. Will trigger an assert() if SkColorType is not
        kRGBA_F16_SkColorType and is built with SK_DEBUG defined.

        One word corresponds to one pixel.

        @param x  column index, zero or greater, and less than width()
        @param y  row index, zero or greater, and less than height()
        @return   writable unsigned 64-bit pointer to pixel
    */
    uint64_t* writable_addr64(int x, int y) const {
        return const_cast<uint64_t*>(this->addr64(x, y));
    }

    /** Returns writable pixel address at (x, y). Result is addressable as unsigned
        16-bit words. Will trigger an assert() if SkColorType is not
        kRGBA_F16_SkColorType and is built with SK_DEBUG defined.

        Each word represents one color component encoded as a half float.
        Four words correspond to one pixel.

        @param x  column index, zero or greater, and less than width()
        @param y  row index, zero or greater, and less than height()
        @return   writable unsigned 16-bit pointer to first component of pixel
    */
    uint16_t* writable_addrF16(int x, int y) const {
        return reinterpret_cast<uint16_t*>(writable_addr64(x, y));
    }

    /** Copies a SkRect of pixels to dstPixels. Copy starts at (0, 0), and does not
        exceed SkPixmap (width(), height()).

        dstInfo specifies width, height, SkColorType, SkAlphaType, and
        SkColorSpace of destination. dstRowBytes specifics the gap from one destination
        row to the next. Returns true if pixels are copied. Returns false if
        dstInfo address equals nullptr, or dstRowBytes is less than dstInfo.minRowBytes().

        Pixels are copied only if pixel conversion is possible. If SkPixmap colorType() is
        kGray_8_SkColorType, or kAlpha_8_SkColorType; dstInfo.colorType() must match.
        If SkPixmap colorType() is kGray_8_SkColorType, dstInfo.colorSpace() must match.
        If SkPixmap alphaType() is kOpaque_SkAlphaType, dstInfo.alphaType() must
        match. If SkPixmap colorSpace() is nullptr, dstInfo.colorSpace() must match. Returns
        false if pixel conversion is not possible.

        Returns false if SkPixmap width() or height() is zero or negative.

        @param dstInfo      destination width, height, SkColorType, SkAlphaType, SkColorSpace
        @param dstPixels    destination pixel storage
        @param dstRowBytes  destination row length
        @return             true if pixels are copied to dstPixels
    */
    bool readPixels(const SkImageInfo& dstInfo, void* dstPixels, size_t dstRowBytes) const {
        return this->readPixels(dstInfo, dstPixels, dstRowBytes, 0, 0);
    }

    /** Copies a SkRect of pixels to dstPixels. Copy starts at (srcX, srcY), and does not
        exceed SkPixmap (width(), height()).

        dstInfo specifies width, height, SkColorType, SkAlphaType, and
        SkColorSpace of destination. dstRowBytes specifics the gap from one destination
        row to the next. Returns true if pixels are copied. Returns false if
        dstInfo address equals nullptr, or dstRowBytes is less than dstInfo.minRowBytes().

        Pixels are copied only if pixel conversion is possible. If SkPixmap colorType() is
        kGray_8_SkColorType, or kAlpha_8_SkColorType; dstInfo.colorType() must match.
        If SkPixmap colorType() is kGray_8_SkColorType, dstInfo.colorSpace() must match.
        If SkPixmap alphaType() is kOpaque_SkAlphaType, dstInfo.alphaType() must
        match. If SkPixmap colorSpace() is nullptr, dstInfo.colorSpace() must match. Returns
        false if pixel conversion is not possible.

        srcX and srcY may be negative to copy only top or left of source. Returns
        false if SkPixmap width() or height() is zero or negative. Returns false if:
        abs(srcX) >= Pixmap width(), or if abs(srcY) >= Pixmap height().

        @param dstInfo      destination width, height, SkColorType, SkAlphaType, SkColorSpace
        @param dstPixels    destination pixel storage
        @param dstRowBytes  destination row length
        @param srcX         column index whose absolute value is less than width()
        @param srcY         row index whose absolute value is less than height()
        @return             true if pixels are copied to dstPixels
    */
    bool readPixels(const SkImageInfo& dstInfo, void* dstPixels, size_t dstRowBytes, int srcX,
                    int srcY) const;

    /** Copies a SkRect of pixels to dst. Copy starts at (srcX, srcY), and does not
        exceed SkPixmap (width(), height()). dst specifies width, height, SkColorType,
        SkAlphaType, and SkColorSpace of destination.  Returns true if pixels are copied.
        Returns false if dst address equals nullptr, or dst.rowBytes() is less than
        dst SkImageInfo::minRowBytes.

        Pixels are copied only if pixel conversion is possible. If SkPixmap colorType() is
        kGray_8_SkColorType, or kAlpha_8_SkColorType; dst.info().colorType must match.
        If SkPixmap colorType() is kGray_8_SkColorType, dst.info().colorSpace must match.
        If SkPixmap alphaType() is kOpaque_SkAlphaType, dst.info().alphaType must
        match. If SkPixmap colorSpace() is nullptr, dst.info().colorSpace must match. Returns
        false if pixel conversion is not possible.

        srcX and srcY may be negative to copy only top or left of source. Returns
        false SkPixmap width() or height() is zero or negative. Returns false if:
        abs(srcX) >= Pixmap width(), or if abs(srcY) >= Pixmap height().

        @param dst   SkImageInfo and pixel address to write to
        @param srcX  column index whose absolute value is less than width()
        @param srcY  row index whose absolute value is less than height()
        @return      true if pixels are copied to dst
    */
    bool readPixels(const SkPixmap& dst, int srcX, int srcY) const {
        return this->readPixels(dst.info(), dst.writable_addr(), dst.rowBytes(), srcX, srcY);
    }

    /** Copies pixels inside bounds() to dst. dst specifies width, height, SkColorType,
        SkAlphaType, and SkColorSpace of destination.  Returns true if pixels are copied.
        Returns false if dst address equals nullptr, or dst.rowBytes() is less than
        dst SkImageInfo::minRowBytes.

        Pixels are copied only if pixel conversion is possible. If SkPixmap colorType() is
        kGray_8_SkColorType, or kAlpha_8_SkColorType; dst SkColorType must match.
        If SkPixmap colorType() is kGray_8_SkColorType, dst SkColorSpace must match.
        If SkPixmap alphaType() is kOpaque_SkAlphaType, dst SkAlphaType must
        match. If SkPixmap colorSpace() is nullptr, dst SkColorSpace must match. Returns
        false if pixel conversion is not possible.

        Returns false if SkPixmap width() or height() is zero or negative.

        @param dst  SkImageInfo and pixel address to write to
        @return     true if pixels are copied to dst
    */
    bool readPixels(const SkPixmap& dst) const {
        return this->readPixels(dst.info(), dst.writable_addr(), dst.rowBytes(), 0, 0);
    }

    /** Copies SkBitmap to dst, scaling pixels to fit dst.width() and dst.height(), and
        converting pixels to match dst.colorType() and dst.alphaType(). Returns true if
        pixels are copied. Returns false if dst address is nullptr, or dst.rowBytes() is
        less than dst SkImageInfo::minRowBytes.

        Pixels are copied only if pixel conversion is possible. If SkPixmap colorType() is
        kGray_8_SkColorType, or kAlpha_8_SkColorType; dst SkColorType must match.
        If SkPixmap colorType() is kGray_8_SkColorType, dst SkColorSpace must match.
        If SkPixmap alphaType() is kOpaque_SkAlphaType, dst SkAlphaType must
        match. If SkPixmap colorSpace() is nullptr, dst SkColorSpace must match. Returns
        false if pixel conversion is not possible.

        Returns false if SkBitmap width() or height() is zero or negative.

        @param dst            SkImageInfo and pixel address to write to
        @return               true if pixels are scaled to fit dst

        example: https://fiddle.skia.org/c/@Pixmap_scalePixels
    */
    bool scalePixels(const SkPixmap& dst, const SkSamplingOptions&) const;

    /** Writes color to pixels bounded by subset; returns true on success.
        Returns false if colorType() is kUnknown_SkColorType, or if subset does
        not intersect bounds().

        @param color   sRGB unpremultiplied color to write
        @param subset  bounding integer SkRect of written pixels
        @return        true if pixels are changed

        example: https://fiddle.skia.org/c/@Pixmap_erase
    */
    bool erase(SkColor color, const SkIRect& subset) const;

    /** Writes color to pixels inside bounds(); returns true on success.
        Returns false if colorType() is kUnknown_SkColorType, or if bounds()
        is empty.

        @param color  sRGB unpremultiplied color to write
        @return       true if pixels are changed
    */
    bool erase(SkColor color) const { return this->erase(color, this->bounds()); }

    /** Writes color to pixels bounded by subset; returns true on success.
        if subset is nullptr, writes colors pixels inside bounds(). Returns false if
        colorType() is kUnknown_SkColorType, if subset is not nullptr and does
        not intersect bounds(), or if subset is nullptr and bounds() is empty.

        @param color   sRGB unpremultiplied color to write
        @param subset  bounding integer SkRect of pixels to write; may be nullptr
        @return        true if pixels are changed

        example: https://fiddle.skia.org/c/@Pixmap_erase_3
    */
    bool erase(const SkColor4f& color, const SkIRect* subset = nullptr) const {
        return this->erase(color, nullptr, subset);
    }

    /** Writes color to pixels bounded by subset; returns true on success.
        if subset is nullptr, writes colors pixels inside bounds(). Returns false if
        colorType() is kUnknown_SkColorType, if subset is not nullptr and does
        not intersect bounds(), or if subset is nullptr and bounds() is empty.

        @param color   unpremultiplied color to write
        @param cs      SkColorSpace of color
        @param subset  bounding integer SkRect of pixels to write; may be nullptr
        @return        true if pixels are changed
    */
    bool erase(const SkColor4f& color, SkColorSpace* cs, const SkIRect* subset = nullptr) const;

private:
    const void*     fPixels;
    size_t          fRowBytes;
    SkImageInfo     fInfo;

    friend class SkPixmapPriv;
};

#endif
