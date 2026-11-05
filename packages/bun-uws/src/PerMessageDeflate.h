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

#include <algorithm>
#include <cstdint>
#include <cstring>

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
        DEDICATED_COMPRESSOR = 15 << 4 | 8,

        /* Reset a dedicated compressor after every message. This is server_no_context_takeover with a
         * custom window size; the shared compressor also resets but always uses a 32kb window. */
        COMPRESSOR_NO_CONTEXT_TAKEOVER = 1 << 12
    };

    /* Negotiated permessage-deflate parameters (RFC 7692 7.1). The server_ ones configure our compressor, the
     * client_ ones our decompressor. Must match PerMessageDeflateParams in src/uws_sys/Response.rs. */
    struct PerMessageDeflateParams {
        int serverMaxWindowBits = 15;
        int clientMaxWindowBits = 15;
        bool serverNoContextTakeover = false;
        bool clientNoContextTakeover = false;
    };

    static inline CompressOptions compressOptionsFor(const PerMessageDeflateParams &params) {
        /* zlib rejects an 8-bit window for raw deflate. A peer that negotiated 8 bits can still inflate
         * 9-bit output, because zlib's match distances stay <= 512 - MIN_LOOKAHEAD = 250. npm ws on Node
         * does the same. */
        int deflateBits = std::clamp(params.serverMaxWindowBits, 9, 15);
        int compressor = deflateBits << 4 | (deflateBits - 7);
        if (params.serverNoContextTakeover) {
            /* The shared compressor only has a 15-bit window */
            compressor = deflateBits == 15 ? SHARED_COMPRESSOR : compressor | COMPRESSOR_NO_CONTEXT_TAKEOVER;
        }

        /* The shared decompressor's 15-bit window can inflate anything a smaller window produced */
        int decompressor = params.clientNoContextTakeover ? SHARED_DECOMPRESSOR : std::clamp(params.clientMaxWindowBits, 8, 15) << 8;

        return (CompressOptions) (compressor | decompressor);
    }
}

#include <zlib.h>
#include <string>
#include <string_view>
#include "libdeflate.h"
#include "ReceiveBuffer.h"

namespace uWS {

#define LARGE_BUFFER_SIZE 1024 * 16 // todo: fix this

struct ZlibContext {
    /* Any returned data is valid until next same-class call.
     * We need to have two classes to allow inflation followed
     * by many deflations without modifying the inflation */
    std::string dynamicDeflationBuffer;
    ReceiveBuffer dynamicInflationBuffer;
    char *deflationBuffer;
    char *inflationBuffer;
    libdeflate_decompressor *decompressor;

    ZlibContext() {
        deflationBuffer = (char *) malloc(LARGE_BUFFER_SIZE);
        inflationBuffer = (char *) malloc(LARGE_BUFFER_SIZE);
        decompressor = libdeflate_alloc_decompressor();
    }

    ~ZlibContext() {
        free(deflationBuffer);
        free(inflationBuffer);
        libdeflate_free_decompressor(decompressor);
    }
};

struct DeflationStream {
    z_stream deflationStream = {};
    const bool noContextTakeover;

    DeflationStream(CompressOptions compressOptions) : noContextTakeover(compressOptions & COMPRESSOR_NO_CONTEXT_TAKEOVER) {

        /* Sliding inflator should be about 44kb by default, less than compressor */

        /* Memory usage is given by 2 ^ (windowBits + 2) + 2 ^ (memLevel + 9) */
        int windowBits = -(int) ((compressOptions & _COMPRESSOR_MASK) >> 4), memLevel = compressOptions & 0xF;

        //printf("windowBits: %d, memLevel: %d\n", windowBits, memLevel);

        deflateInit2(&deflationStream, Z_DEFAULT_COMPRESSION, Z_DEFLATED, windowBits, memLevel, Z_DEFAULT_STRATEGY);
    }

    /* You must not deflate an empty string. */
    std::string_view deflate(ZlibContext *zlibContext, std::string_view raw) {
        /* Odd place to clear this one, fix */
        zlibContext->dynamicDeflationBuffer.clear();

        deflationStream.next_in = (Bytef *) raw.data();
        deflationStream.avail_in = (unsigned int) raw.length();

        /* This buffer size has to be at least 6 bytes for Z_SYNC_FLUSH to work */
        const int DEFLATE_OUTPUT_CHUNK = LARGE_BUFFER_SIZE;

        int err;
        do {
            deflationStream.next_out = (Bytef *) zlibContext->deflationBuffer;
            deflationStream.avail_out = DEFLATE_OUTPUT_CHUNK;

            err = ::deflate(&deflationStream, Z_SYNC_FLUSH);
            if (Z_OK == err && deflationStream.avail_out == 0) {
                zlibContext->dynamicDeflationBuffer.append(zlibContext->deflationBuffer, DEFLATE_OUTPUT_CHUNK - deflationStream.avail_out);
                continue;
            } else {
                break;
            }
        } while (true);

        /* This must not change avail_out */
        if (noContextTakeover) {
            deflateReset(&deflationStream);
        }

        if (zlibContext->dynamicDeflationBuffer.length()) {
            zlibContext->dynamicDeflationBuffer.append(zlibContext->deflationBuffer, DEFLATE_OUTPUT_CHUNK - deflationStream.avail_out);

            return std::string_view((char *) zlibContext->dynamicDeflationBuffer.data(), zlibContext->dynamicDeflationBuffer.length() - 4);
        }

        /* Note: We will get an interger overflow resulting in heap buffer overflow if Z_BUF_ERROR is returned
         * from passing 0 as avail_in. Therefore we must not deflate an empty string */
        return {
            zlibContext->deflationBuffer,
            DEFLATE_OUTPUT_CHUNK - deflationStream.avail_out - 4
        };
    }

    ~DeflationStream() {
        deflateEnd(&deflationStream);
    }
};

struct InflateResult {
    std::string_view data;
    /* 0 on success, otherwise a WebSocket close code: 1007 (corrupt stream), 1009 (over maxPayloadLength)
     * or 1011 (out of memory) */
    int closeCode;
};

struct InflationStream {
    z_stream inflationStream = {};

    InflationStream(CompressOptions compressOptions) {
        inflateInit2(&inflationStream, -((compressOptions & _DECOMPRESSOR_MASK) >> 8));
    }

    ~InflationStream() {
        inflateEnd(&inflationStream);
    }

    /* Zero length inflates are possible and valid */
    InflateResult inflate(ZlibContext *zlibContext, std::string_view compressed, size_t maxPayloadLength, bool reset) {
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
            libdeflate_result res = libdeflate_deflate_decompress(zlibContext->decompressor, compressed.data(), compressed.length() + 9, zlibContext->inflationBuffer, LARGE_BUFFER_SIZE, &written);
            memcpy((char *) compressed.data() + compressed.length(), tmp, 9);

            if (res == 0) {
                /* Fast path wins */
                if (written > maxPayloadLength) {
                    return {{}, 1009};
                }
                return {{zlibContext->inflationBuffer, written}, 0};
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

        /* We clear this one here, could be done better. clear() keeps the allocation for the next message. */
        zlibContext->dynamicInflationBuffer.clear();

        inflationStream.next_in = (Bytef *) compressed.data();
        inflationStream.avail_in = (unsigned int) compressed.length();

        int err;
        bool outOfMemory = false;
        do {
            inflationStream.next_out = (Bytef *) zlibContext->inflationBuffer;
            inflationStream.avail_out = LARGE_BUFFER_SIZE;

            err = ::inflate(&inflationStream, Z_SYNC_FLUSH);
            if (err == Z_STREAM_END) {
                /* RFC 7692 7.2.3.4: a message may end with a BFINAL=1 block. The next message starts a new stream. */
                inflateReset(&inflationStream);
                inflationStream.avail_in = 0;
                err = Z_OK;
            }
            if (err == Z_OK && inflationStream.avail_out) {
                break;
            }

            /* Don't return here. The shared stream still has to be reset below. */
            if (!zlibContext->dynamicInflationBuffer.tryAppend(zlibContext->inflationBuffer, LARGE_BUFFER_SIZE - inflationStream.avail_out)) {
                outOfMemory = true;
                break;
            }

        } while (inflationStream.avail_out == 0 && zlibContext->dynamicInflationBuffer.length() <= maxPayloadLength);

        if (reset) {
            inflateReset(&inflationStream);
        }

        /* Restore the bytes we used for the tail */
        memcpy(tailLocation, preTailBytes, 4);

        if (outOfMemory) {
            /* Every connection on this loop shares this buffer, so free it. */
            zlibContext->dynamicInflationBuffer.release();
            return {{}, 1011};
        }

        if (err != Z_BUF_ERROR && err != Z_OK) {
            return {{}, 1007};
        }

        if (zlibContext->dynamicInflationBuffer.length() > maxPayloadLength) {
            return {{}, 1009};
        }

        std::string_view inflated(zlibContext->inflationBuffer, LARGE_BUFFER_SIZE - inflationStream.avail_out);
        if (zlibContext->dynamicInflationBuffer.length()) {
            if (!zlibContext->dynamicInflationBuffer.tryAppend(inflated.data(), inflated.length())) {
                zlibContext->dynamicInflationBuffer.release();
                return {{}, 1011};
            }
            inflated = {zlibContext->dynamicInflationBuffer.data(), zlibContext->dynamicInflationBuffer.length()};
        }

        if (inflated.length() > maxPayloadLength) {
            return {{}, 1009};
        }

        return {inflated, 0};
    }

};

}

#endif // UWS_PERMESSAGEDEFLATE_H
