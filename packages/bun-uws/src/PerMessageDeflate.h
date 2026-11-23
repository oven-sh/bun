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
        /* There is no 8-bit window for raw deflate. A peer that negotiated 8 bits can still inflate
         * 9-bit output, because match distances stay <= 512 - MIN_LOOKAHEAD = 250. npm ws on Node
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

#include <memory>
#include <optional>
#include <string_view>

namespace uWS {

/* src/http_jsc/permessage_deflate.rs */
namespace zlib {

struct Buffer;
struct Deflater;
struct Inflater;

enum class InflateError : uint8_t { None, Corrupt, TooLarge, OutOfMemory };

struct Output {
    const char *bytes;
    size_t length;
    InflateError error;
};

extern "C" Buffer *Bun__DeflateBuffer__create();
extern "C" void Bun__DeflateBuffer__destroy(Buffer *);
extern "C" Deflater *Bun__Deflater__create(uint8_t windowBits, uint8_t memoryLevel);
extern "C" void Bun__Deflater__destroy(Deflater *);
extern "C" const char *Bun__Deflater__deflateMessage(Deflater *, Buffer *, const char *message, size_t *length, bool reset);
extern "C" Inflater *Bun__Inflater__create(uint8_t windowBits);
extern "C" void Bun__Inflater__destroy(Inflater *);
extern "C" Output Bun__Inflater__inflateMessage(Inflater *, Buffer *, const char *payload, size_t length, size_t maxLength, bool reset);

struct Destroy {
    void operator()(Buffer *buffer) const { Bun__DeflateBuffer__destroy(buffer); }
    void operator()(Deflater *deflater) const { Bun__Deflater__destroy(deflater); }
    void operator()(Inflater *inflater) const { Bun__Inflater__destroy(inflater); }
};

}

struct ZlibContext {
    /* Any returned data is valid until next same-class call.
     * We need to have two classes to allow inflation followed
     * by many deflations without modifying the inflation */
    const std::unique_ptr<zlib::Buffer, zlib::Destroy> deflationBuffer{zlib::Bun__DeflateBuffer__create()};
    const std::unique_ptr<zlib::Buffer, zlib::Destroy> inflationBuffer{zlib::Bun__DeflateBuffer__create()};
};

struct DeflationStream {
    /* Null if compression is disabled, or for want of memory */
    const std::unique_ptr<zlib::Deflater, zlib::Destroy> deflater;
    const bool noContextTakeover;

    DeflationStream(CompressOptions compressOptions)
        : deflater(zlib::Bun__Deflater__create((compressOptions & _COMPRESSOR_MASK) >> 4, compressOptions & 0xF))
        , noContextTakeover(compressOptions & COMPRESSOR_NO_CONTEXT_TAKEOVER) {}

    /* Without a result the message has to be sent as it is. */
    std::optional<std::string_view> deflate(ZlibContext *zlibContext, std::string_view raw) {
        size_t length = raw.length();
        const char *bytes = deflater ? zlib::Bun__Deflater__deflateMessage(deflater.get(), zlibContext->deflationBuffer.get(), raw.data(), &length, noContextTakeover) : nullptr;
        if (!bytes) {
            return std::nullopt;
        }
        return std::string_view(bytes, length);
    }
};

struct InflateResult {
    std::string_view data;
    /* 0 on success, otherwise a WebSocket close code: 1007 (corrupt stream), 1009 (over maxPayloadLength)
     * or 1011 (out of memory) */
    int closeCode;
};

struct InflationStream {
    /* Null if decompression is disabled */
    const std::unique_ptr<zlib::Inflater, zlib::Destroy> inflater;

    InflationStream(CompressOptions compressOptions)
        : inflater(zlib::Bun__Inflater__create((compressOptions & _DECOMPRESSOR_MASK) >> 8)) {}

    /* Zero length inflates are possible and valid */
    InflateResult inflate(ZlibContext *zlibContext, std::string_view compressed, size_t maxPayloadLength, bool reset) {
        if (!inflater) {
            return {{}, 1007};
        }
        zlib::Output output = zlib::Bun__Inflater__inflateMessage(inflater.get(), zlibContext->inflationBuffer.get(), compressed.data(), compressed.length(), maxPayloadLength, reset);
        switch (output.error) {
        case zlib::InflateError::None:
            return {{output.bytes, output.length}, 0};
        case zlib::InflateError::TooLarge:
            return {{}, 1009};
        case zlib::InflateError::OutOfMemory:
            return {{}, 1011};
        case zlib::InflateError::Corrupt:
            break;
        }
        return {{}, 1007};
    }

};

}

#endif // UWS_PERMESSAGEDEFLATE_H
