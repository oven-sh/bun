/*
 * Authored by Alex Hultman, 2018-2021.
 * Intellectual property of third-party.

 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at

 *     http://www.apache.org/licenses/LICENSE-2.0

 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/* This standalone module implements deflate / inflate streams */

#ifndef UWS_PERMESSAGEDEFLATE_H
#define UWS_PERMESSAGEDEFLATE_H

#include <cstdint>
#include <cstring>
#include <limits>
#include <memory>

namespace uWS {
    /* Compressor mode is 8 lowest bits where HIGH4(windowBits), LOW4(memLevel).
     * Decompressor mode is 8 highest bits LOW4(windowBits).
     * If compressor or decompressor bits are 1, then they are shared.
     * If everything is just simply 0, then everything is disabled. */
    enum CompressOptions : uint16_t {
        /* These are not actual compression options */
        _COMPRESSOR_MASK = 0x00FF,
        _DECOMPRESSOR_MASK = 0x0F00,
        /* Disabled, shared, shared are "special" values */
        DISABLED = 0,
        SHARED_COMPRESSOR = 1,
        SHARED_DECOMPRESSOR = 1 << 8,
        /* Highest 4 bits describe decompressor */
        DEDICATED_DECOMPRESSOR_32KB = 15 << 8,
        DEDICATED_DECOMPRESSOR_16KB = 14 << 8,
        DEDICATED_DECOMPRESSOR_8KB = 13 << 8,
        DEDICATED_DECOMPRESSOR_4KB = 12 << 8,
        DEDICATED_DECOMPRESSOR_2KB = 11 << 8,
        DEDICATED_DECOMPRESSOR_1KB = 10 << 8,
        DEDICATED_DECOMPRESSOR_512B = 9 << 8,
        /* Same as 32kb */
        DEDICATED_DECOMPRESSOR = 15 << 8,

        /* Lowest 8 bit describe compressor */
        DEDICATED_COMPRESSOR_3KB = 9 << 4 | 1,
        DEDICATED_COMPRESSOR_4KB = 9 << 4 | 2,
        DEDICATED_COMPRESSOR_8KB = 10 << 4 | 3,
        DEDICATED_COMPRESSOR_16KB = 11 << 4 | 4,
        DEDICATED_COMPRESSOR_32KB = 12 << 4 | 5,
        DEDICATED_COMPRESSOR_64KB = 13 << 4 | 6,
        DEDICATED_COMPRESSOR_128KB = 14 << 4 | 7,
        DEDICATED_COMPRESSOR_256KB = 15 << 4 | 8,
        /* Same as 256kb */
        DEDICATED_COMPRESSOR = 15 << 4 | 8
    };
}

#include <zlib.h>
#include <string>
#include <optional>
#include "libdeflate.h"

namespace uWS {

#define LARGE_BUFFER_SIZE 1024 * 16 // todo: fix this

struct ZlibContext {
    /* Any returned data is valid until next same-class call.
     * We need to have two classes to allow inflation followed
     * by many deflations without modifying the inflation */
    std::string dynamicDeflationBuffer;
    std::string dynamicInflationBuffer;
    char *deflationBuffer;
    char *inflationBuffer;
    libdeflate_decompressor *decompressor;
    libdeflate_compressor *compressor;

    ZlibContext() {
        deflationBuffer = (char *) malloc(LARGE_BUFFER_SIZE);
        inflationBuffer = (char *) malloc(LARGE_BUFFER_SIZE);
        decompressor = libdeflate_alloc_decompressor();
        compressor = libdeflate_alloc_compressor(6);
    }

    ~ZlibContext() {
        free(deflationBuffer);
        free(inflationBuffer);
        libdeflate_free_decompressor(decompressor);
        libdeflate_free_compressor(compressor);
    }
};

struct DeflationStream {
    z_stream deflationStream = {};
    unsigned char reset_buffer[4096 + 1];

    DeflationStream(CompressOptions compressOptions) {

        /* Sliding inflator should be about 44kb by default, less than compressor */

        /* Memory usage is given by 2 ^ (windowBits + 2) + 2 ^ (memLevel + 9) */
        int windowBits = -(int) ((compressOptions & _COMPRESSOR_MASK) >> 4), memLevel = compressOptions & 0xF;

        //printf("windowBits: %d, memLevel: %d\n", windowBits, memLevel);

        deflateInit2(&deflationStream, Z_DEFAULT_COMPRESSION, Z_DEFLATED, windowBits, memLevel, Z_DEFAULT_STRATEGY);
    }

    /* Conservative bound for the one Z_SYNC_FLUSH performed by deflate().
     * deflateBound() is parameter-aware but only directly guarantees
     * Z_FINISH/Z_NO_FLUSH. Z_SYNC_FLUSH appends one empty stored block: up to
     * seven alignment bits, a three-bit block header, and four LEN/NLEN bytes,
     * i.e. at most six bytes. The returned permessage-deflate view later
     * removes its four-byte tail, so retaining all six here is conservative. */
    std::optional<size_t> maxSizeForSyncFlush(size_t length) {
        if (length > std::numeric_limits<uLong>::max()) return std::nullopt;
        uLong bound = ::deflateBound(&deflationStream, (uLong) length);
        if ((uint64_t) bound > (uint64_t) std::numeric_limits<size_t>::max() - 6) return std::nullopt;
        return (size_t) bound + 6;
    }

private:
    struct NoInit { };

    explicit DeflationStream(NoInit) { }

    std::string_view deflateWithStream(z_stream& stream, ZlibContext *zlibContext, std::string_view raw, bool reset) {
        /* Run a fast path in case of shared_compressor */
        if (reset) {
            size_t written = 0;
            written = libdeflate_deflate_compress(zlibContext->compressor, raw.data(), raw.length(), reset_buffer, 4096);

            if (written) {
                memcpy(&reset_buffer[written], "\x00", 1);
                return std::string_view((char *) reset_buffer, written + 1);
            }
        }

        /* Odd place to clear this one, fix */
        zlibContext->dynamicDeflationBuffer.clear();

        stream.next_in = (Bytef *) raw.data();
        stream.avail_in = (unsigned int) raw.length();

        /* This buffer size has to be at least 6 bytes for Z_SYNC_FLUSH to work */
        const int DEFLATE_OUTPUT_CHUNK = LARGE_BUFFER_SIZE;

        int err;
        do {
            stream.next_out = (Bytef *) zlibContext->deflationBuffer;
            stream.avail_out = DEFLATE_OUTPUT_CHUNK;

            err = ::deflate(&stream, Z_SYNC_FLUSH);
            if (Z_OK == err && stream.avail_out == 0) {
                zlibContext->dynamicDeflationBuffer.append(zlibContext->deflationBuffer, DEFLATE_OUTPUT_CHUNK - stream.avail_out);
                continue;
            } else {
                break;
            }
        } while (true);

        /* This must not change avail_out */
        if (reset) {
            deflateReset(&stream);
        }

        if (zlibContext->dynamicDeflationBuffer.length()) {
            zlibContext->dynamicDeflationBuffer.append(zlibContext->deflationBuffer, DEFLATE_OUTPUT_CHUNK - stream.avail_out);

            return std::string_view((char *) zlibContext->dynamicDeflationBuffer.data(), zlibContext->dynamicDeflationBuffer.length() - 4);
        }

        /* Note: We will get an interger overflow resulting in heap buffer overflow if Z_BUF_ERROR is returned
         * from passing 0 as avail_in. Therefore we must not deflate an empty string */
        return {
            zlibContext->deflationBuffer,
            DEFLATE_OUTPUT_CHUNK - stream.avail_out - 4
        };
    }

public:
    /* deflateCopy() stores an internal backpointer to the destination z_stream,
     * so the clone is allocated at its final address and must never be moved.
     * zlib-ng copies source pointers into the destination before allocating;
     * clear a failed copy so its destructor cannot release the source state. */
    std::unique_ptr<DeflationStream> clone() {
        auto copy = std::unique_ptr<DeflationStream>(new DeflationStream(NoInit {}));
        if (::deflateCopy(&copy->deflationStream, &deflationStream) != Z_OK) {
            copy->deflationStream = {};
            return nullptr;
        }
        return copy;
    }

    /* Deflate and optionally reset. You must not deflate an empty string. */
    std::string_view deflate(ZlibContext *zlibContext, std::string_view raw, bool reset) {
        return deflateWithStream(deflationStream, zlibContext, raw, reset);
    }

    ~DeflationStream() {
        deflateEnd(&deflationStream);
    }
};

enum class InflationStatus {
    SUCCESS,
    TOO_LARGE,
    INVALID_DATA,
};

struct InflationResult {
    InflationStatus status;
    std::string_view data;
};

struct InflationStream {
    z_stream inflationStream = {};
    char buf[4096];

    InflationStream(CompressOptions compressOptions) {
        /* Inflation windowBits are the top 8 bits of the 16 bit compressOptions */
        inflateInit2(&inflationStream, -(compressOptions >> 8));
    }

    ~InflationStream() {
        inflateEnd(&inflationStream);
    }

    /* Zero length inflates are possible and valid. Keep the detailed result
     * separate from the established optional API so callers that need wire
     * close-code fidelity can distinguish malformed DEFLATE from a payload
     * that expanded past maxPayloadLength without slowing existing callers. */
    InflationResult inflateWithStatus(ZlibContext *zlibContext, std::string_view compressed, size_t maxPayloadLength, bool reset) {
        /* The libdeflate fast path is stateless: it cannot resolve back-references into a
         * previous message's sliding window, and whatever it inflates never reaches the zlib
         * stream's window. Both are only correct without context takeover, i.e. when reset is set. */
        if (reset) {
            /* Try fast path first */
            size_t written = 0;

            /* We have to pad 9 bytes and restore those bytes when done since 9 is more than 6 of next WebSocket message */
            char tmp[9];
            memcpy(tmp, (char *) compressed.data() + compressed.length(), 9);
            memcpy((char *) compressed.data() + compressed.length(), "\x00\x00\xff\xff\x01\x00\x00\xff\xff", 9);
            libdeflate_result res = libdeflate_deflate_decompress(zlibContext->decompressor, compressed.data(), compressed.length() + 9, buf, 4096, &written);
            memcpy((char *) compressed.data() + compressed.length(), tmp, 9);

            if (res == 0) {
                /* Fast path wins */
                if (written > maxPayloadLength) {
                    return { InflationStatus::TOO_LARGE, {} };
                }
                return { InflationStatus::SUCCESS, std::string_view(buf, written) };
            }
        }

        /* Save off the bytes we're about to overwrite */
        char* tailLocation = (char*)compressed.data() + compressed.length();
        char preTailBytes[4];
        memcpy(preTailBytes, tailLocation, 4);

        /* Append tail to chunk */
        unsigned char tail[4] = {0x00, 0x00, 0xff, 0xff};
        memcpy(tailLocation, tail, 4);
        compressed = {compressed.data(), compressed.length() + 4};

        /* We clear this one here, could be done better */
        zlibContext->dynamicInflationBuffer.clear();

        inflationStream.next_in = (Bytef *) compressed.data();
        inflationStream.avail_in = (unsigned int) compressed.length();

        int err;
        do {
            inflationStream.next_out = (Bytef *) zlibContext->inflationBuffer;
            inflationStream.avail_out = LARGE_BUFFER_SIZE;

            err = ::inflate(&inflationStream, Z_SYNC_FLUSH);
            if (err == Z_OK && inflationStream.avail_out) {
                break;
            }

            zlibContext->dynamicInflationBuffer.append(zlibContext->inflationBuffer, LARGE_BUFFER_SIZE - inflationStream.avail_out);


        } while (inflationStream.avail_out == 0 && zlibContext->dynamicInflationBuffer.length() <= maxPayloadLength);

        if (reset) {
            inflateReset(&inflationStream);
        }

        /* Restore the bytes we used for the tail */
        memcpy(tailLocation, preTailBytes, 4);

        size_t finalChunkLength = LARGE_BUFFER_SIZE - inflationStream.avail_out;
        if (zlibContext->dynamicInflationBuffer.length() > maxPayloadLength ||
            finalChunkLength > maxPayloadLength - zlibContext->dynamicInflationBuffer.length()) {
            return { InflationStatus::TOO_LARGE, {} };
        }

        if (err != Z_BUF_ERROR && err != Z_OK) {
            return { InflationStatus::INVALID_DATA, {} };
        }

        if (zlibContext->dynamicInflationBuffer.length()) {
            zlibContext->dynamicInflationBuffer.append(zlibContext->inflationBuffer, finalChunkLength);

            /* Let's be strict about the max size */
            if (zlibContext->dynamicInflationBuffer.length() > maxPayloadLength) {
                return { InflationStatus::TOO_LARGE, {} };
            }

            return { InflationStatus::SUCCESS, std::string_view(zlibContext->dynamicInflationBuffer.data(), zlibContext->dynamicInflationBuffer.length()) };
        }

        /* Let's be strict about the max size */
        if (finalChunkLength > maxPayloadLength) {
            return { InflationStatus::TOO_LARGE, {} };
        }

        return { InflationStatus::SUCCESS, std::string_view(zlibContext->inflationBuffer, finalChunkLength) };
    }

    std::optional<std::string_view> inflate(ZlibContext *zlibContext, std::string_view compressed, size_t maxPayloadLength, bool reset) {
        InflationResult result = inflateWithStatus(zlibContext, compressed, maxPayloadLength, reset);
        if (result.status != InflationStatus::SUCCESS) {
            return std::nullopt;
        }
        return result.data;
    }

};

}

#endif // UWS_PERMESSAGEDEFLATE_H
