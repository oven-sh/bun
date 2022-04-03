/*
 * Copyright 2015 Google Inc.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SkPngChunkReader_DEFINED
#define SkPngChunkReader_DEFINED

#include "include/core/SkRefCnt.h"
#include "include/core/SkTypes.h"

/**
 *  SkPngChunkReader
 *
 *  Base class for optional callbacks to retrieve meta/chunk data out of a PNG
 *  encoded image as it is being decoded.
 *  Used by SkCodec.
 */
class SkPngChunkReader : public SkRefCnt {
public:
    /**
     *  This will be called by the decoder when it sees an unknown chunk.
     *
     *  Use by SkCodec:
     *  Depending on the location of the unknown chunks, this callback may be
     *  called by
     *      - the factory (NewFromStream/NewFromData)
     *      - getPixels
     *      - startScanlineDecode
     *      - the first call to getScanlines/skipScanlines
     *  The callback may be called from a different thread (e.g. if the SkCodec
     *  is passed to another thread), and it may be called multiple times, if
     *  the SkCodec is used multiple times.
     *
     *  @param tag Name for this type of chunk.
     *  @param data Data to be interpreted by the subclass.
     *  @param length Number of bytes of data in the chunk.
     *  @return true to continue decoding, or false to indicate an error, which
     *      will cause the decoder to not return the image.
     */
    virtual bool readChunk(const char tag[], const void* data, size_t length) = 0;
};
#endif // SkPngChunkReader_DEFINED
