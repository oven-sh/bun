/*
 * Copyright 2017 Google Inc.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SkEncoder_DEFINED
#define SkEncoder_DEFINED

#include "include/core/SkPixmap.h"
#include "include/private/SkNoncopyable.h"
#include "include/private/SkTemplates.h"

class SK_API SkEncoder : SkNoncopyable {
public:

    /**
     *  Encode |numRows| rows of input.  If the caller requests more rows than are remaining
     *  in the src, this will encode all of the remaining rows.  |numRows| must be greater
     *  than zero.
     */
    bool encodeRows(int numRows);

    virtual ~SkEncoder() {}

protected:

    virtual bool onEncodeRows(int numRows) = 0;

    SkEncoder(const SkPixmap& src, size_t storageBytes)
        : fSrc(src)
        , fCurrRow(0)
        , fStorage(storageBytes)
    {}

    const SkPixmap&        fSrc;
    int                    fCurrRow;
    SkAutoTMalloc<uint8_t> fStorage;
};

#endif
