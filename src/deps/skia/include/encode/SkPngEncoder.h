/*
 * Copyright 2017 Google Inc.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SkPngEncoder_DEFINED
#define SkPngEncoder_DEFINED

#include "include/core/SkDataTable.h"
#include "include/encode/SkEncoder.h"

class SkPngEncoderMgr;
class SkWStream;

class SK_API SkPngEncoder : public SkEncoder {
public:

    enum class FilterFlag : int {
        kZero  = 0x00,
        kNone  = 0x08,
        kSub   = 0x10,
        kUp    = 0x20,
        kAvg   = 0x40,
        kPaeth = 0x80,
        kAll   = kNone | kSub | kUp | kAvg | kPaeth,
    };

    struct Options {
        /**
         *  Selects which filtering strategies to use.
         *
         *  If a single filter is chosen, libpng will use that filter for every row.
         *
         *  If multiple filters are chosen, libpng will use a heuristic to guess which filter
         *  will encode smallest, then apply that filter.  This happens on a per row basis,
         *  different rows can use different filters.
         *
         *  Using a single filter (or less filters) is typically faster.  Trying all of the
         *  filters may help minimize the output file size.
         *
         *  Our default value matches libpng's default.
         */
        FilterFlag fFilterFlags = FilterFlag::kAll;

        /**
         *  Must be in [0, 9] where 9 corresponds to maximal compression.  This value is passed
         *  directly to zlib.  0 is a special case to skip zlib entirely, creating dramatically
         *  larger pngs.
         *
         *  Our default value matches libpng's default.
         */
        int fZLibLevel = 6;

        /**
         *  Represents comments in the tEXt ancillary chunk of the png.
         *  The 2i-th entry is the keyword for the i-th comment,
         *  and the (2i + 1)-th entry is the text for the i-th comment.
         */
        sk_sp<SkDataTable> fComments;
    };

    /**
     *  Encode the |src| pixels to the |dst| stream.
     *  |options| may be used to control the encoding behavior.
     *
     *  Returns true on success.  Returns false on an invalid or unsupported |src|.
     */
    static bool Encode(SkWStream* dst, const SkPixmap& src, const Options& options);

    /**
     *  Create a png encoder that will encode the |src| pixels to the |dst| stream.
     *  |options| may be used to control the encoding behavior.
     *
     *  |dst| is unowned but must remain valid for the lifetime of the object.
     *
     *  This returns nullptr on an invalid or unsupported |src|.
     */
    static std::unique_ptr<SkEncoder> Make(SkWStream* dst, const SkPixmap& src,
                                           const Options& options);

    ~SkPngEncoder() override;

protected:
    bool onEncodeRows(int numRows) override;

    SkPngEncoder(std::unique_ptr<SkPngEncoderMgr>, const SkPixmap& src);

    std::unique_ptr<SkPngEncoderMgr> fEncoderMgr;
    using INHERITED = SkEncoder;
};

static inline SkPngEncoder::FilterFlag operator|(SkPngEncoder::FilterFlag x,
                                                 SkPngEncoder::FilterFlag y) {
    return (SkPngEncoder::FilterFlag)((int)x | (int)y);
}

#endif
