/*
 * Authored by Alex Hultman, 2018-2022.
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

#ifndef UWS_CHUNKEDENCODING_H
#define UWS_CHUNKEDENCODING_H

/* Independent chunked encoding parser, used by HttpParser. */

#include <string>
#include <cstring>
#include <algorithm>
#include <string_view>
#include "MoveOnlyFunction.h"
#include <optional>

namespace uWS {

    constexpr uint64_t STATE_HAS_SIZE = 1ull << (sizeof(uint64_t) * 8 - 1);//0x8000000000000000;
    constexpr uint64_t STATE_IS_CHUNKED = 1ull << (sizeof(uint64_t) * 8 - 2);//0x4000000000000000;
    constexpr uint64_t STATE_IS_CHUNKED_EXTENSION = 1ull << (sizeof(uint64_t) * 8 - 3);//0x2000000000000000;
    constexpr uint64_t STATE_WAITING_FOR_LF = 1ull << (sizeof(uint64_t) * 8 - 4);//0x1000000000000000;
    constexpr uint64_t STATE_SIZE_MASK = ~(STATE_HAS_SIZE | STATE_IS_CHUNKED | STATE_IS_CHUNKED_EXTENSION | STATE_WAITING_FOR_LF);//0x0FFFFFFFFFFFFFFF;
    constexpr uint64_t STATE_IS_ERROR = ~0ull;//0xFFFFFFFFFFFFFFFF;
    /* Overflow guard: if any of bits 55-59 are set before the next *16, one more
     * hex digit (plus the +2 for the trailing CRLF of chunk-data) would carry into
     * STATE_WAITING_FOR_LF at bit 60. Limits chunk size to 14 hex digits (~72 PB). */
    constexpr uint64_t STATE_SIZE_OVERFLOW = 0x1Full << (sizeof(uint64_t) * 8 - 9);//0x0F80000000000000;

    inline uint64_t chunkSize(uint64_t state) {
        return state & STATE_SIZE_MASK;
    }

    /* Parses the chunk-size line: HEXDIG+ [;ext...] CRLF
     *
     * Returns the new state. On return, exactly one of:
     *   - state has STATE_HAS_SIZE set (success, data advanced past LF)
     *   - state == STATE_IS_ERROR     (malformed input)
     *   - data is empty                (short read; flags persist for resume)
     *
     * Resume flags:
     *   STATE_WAITING_FOR_LF       -> saw '\r' on previous call, need '\n'
     *   STATE_IS_CHUNKED_EXTENSION -> mid-extension, skip hex parsing on resume
     *
     * Structure follows upstream uWS (scan-for-LF) with strict CRLF validation
     * added. Every byte is consumed in a forward scan so TCP segment boundaries
     * splitting the line at any point are handled by construction.
     *
     * RFC 7230 4.1.1:
     *   chunk          = chunk-size [ chunk-ext ] CRLF chunk-data CRLF
     *   chunk-size     = 1*HEXDIG
     *   chunk-ext      = *( ";" chunk-ext-name [ "=" chunk-ext-val ] )
     *   chunk-ext-name = token
     *   chunk-ext-val  = token / quoted-string  (TODO: quoted-string unsupported)
     */
    inline uint64_t consumeHexNumber(std::string_view &data, uint64_t state) {
        /* Resume: '\r' was the last byte of the previous segment. Rare path,
         * use data directly to avoid the p/len load on the hot path. */
        if (state & STATE_WAITING_FOR_LF) [[unlikely]] {
            if (!data.length()) return state;
            if (data[0] != '\n') return STATE_IS_ERROR;
            data.remove_prefix(1);
            return ((state & ~(STATE_WAITING_FOR_LF | STATE_IS_CHUNKED_EXTENSION)) + 2)
                   | STATE_HAS_SIZE | STATE_IS_CHUNKED;
        }

        /* Load pointer+length into locals so the loops operate in registers.
         * Without this, Clang writes back to the string_view on every iteration.
         * Error paths skip the writeback: HttpParser returns immediately on
         * STATE_IS_ERROR and never reads data. */
        const char *p = data.data();
        size_t len = data.length();

        /* Hex digits. Skipped when resuming mid-extension so that extension bytes
         * like 'a' aren't misparsed as hex. */
        if (!(state & STATE_IS_CHUNKED_EXTENSION)) {
            while (len) {
                unsigned char c = (unsigned char) *p;
                if (c <= 32 || c == ';') break; /* fall through to drain loop */
                unsigned int d = c | 0x20; /* fold A-F -> a-f; '0'..'9' unchanged */
                unsigned int n;
                if      ((unsigned)(d - '0') < 10) [[likely]] n = d - '0';
                else if ((unsigned)(d - 'a') < 6)            n = d - 'a' + 10;
                else return STATE_IS_ERROR;
                if (chunkSize(state) & STATE_SIZE_OVERFLOW) [[unlikely]] return STATE_IS_ERROR;
                state = ((state & STATE_SIZE_MASK) * 16ull + n) | STATE_IS_CHUNKED;
                ++p; --len;
            }
        }

        /* Drain [;ext...] \r \n. Upstream-style forward scan for LF, with strict
         * validation: only >32 bytes (extension) and exactly one '\r' immediately
         * before '\n' are allowed. */
        while (len) {
            unsigned char c = (unsigned char) *p;
            if (c == '\n') return STATE_IS_ERROR; /* bare LF */
            ++p; --len;
            if (c == '\r') {
                if (!len) {
                    data = std::string_view(p, len);
                    return state | STATE_WAITING_FOR_LF;
                }
                if (*p != '\n') return STATE_IS_ERROR;
                ++p; --len;
                data = std::string_view(p, len);
                return ((state & ~STATE_IS_CHUNKED_EXTENSION) + 2)
                       | STATE_HAS_SIZE | STATE_IS_CHUNKED;
            }
            if (c <= 32) return STATE_IS_ERROR;
            state |= STATE_IS_CHUNKED_EXTENSION;
        }
        data = std::string_view(p, len);
        return state; /* short read */
    }

    inline void decChunkSize(uint64_t &state, uint64_t by) {
        state = (state & ~STATE_SIZE_MASK) | (chunkSize(state) - by);
    }

    inline bool hasChunkSize(uint64_t state) {
        return state & STATE_HAS_SIZE;
    }

    /* Are we in the middle of parsing chunked encoding? */
    inline bool isParsingChunkedEncoding(uint64_t state) {
        return state & ~STATE_SIZE_MASK;
    }

    inline bool isParsingInvalidChunkedEncoding(uint64_t state) {
        return state == STATE_IS_ERROR;
    }

    /* Returns next chunk (empty or not), or if all data was consumed, nullopt is returned. */
    static std::optional<std::string_view> getNextChunk(std::string_view &data, uint64_t &state, bool trailer = false) {
        while (data.length()) {

            // if in "drop trailer mode", just drop up to what we have as size
            if (((state & STATE_IS_CHUNKED) == 0) && hasChunkSize(state) && chunkSize(state)) {

                //printf("Parsing trailer now\n");

                while(data.length() && chunkSize(state)) {
                    data.remove_prefix(1);
                    decChunkSize(state, 1);

                    if (chunkSize(state) == 0) {

                        /* This is an actual place where we need 0 as state */
                        state = 0;

                        /* The parser MUST stop consuming here */
                        return std::nullopt;
                    }
                }
                continue;
            }

            if (!hasChunkSize(state)) {
                state = consumeHexNumber(data, state);
                if (isParsingInvalidChunkedEncoding(state)) [[unlikely]] {
                    return std::nullopt;
                }
                if (hasChunkSize(state) && chunkSize(state) == 2) {

                    //printf("Setting state to trailer-parsing and emitting empty chunk\n");

                    // set trailer state and increase size to 4
                    if (trailer) {
                        state = 4 /*| STATE_IS_CHUNKED*/ | STATE_HAS_SIZE;
                    } else {
                        state = 2 /*| STATE_IS_CHUNKED*/ | STATE_HAS_SIZE;
                    }

                    return std::string_view(nullptr, 0);
                }
                if (!hasChunkSize(state)) [[unlikely]] {
                    /* Incomplete chunk-size line — need more data from the network. */
                    return std::nullopt;
                }
                continue;
            }

            // do we have data to emit all?
            uint64_t remaining = chunkSize(state);
            if (data.length() >= remaining) {
                // emit all but 2 bytes then reset state to 0 and goto beginning
                // not fin
                std::string_view emitSoon;
                bool shouldEmit = false;
                // Validate the chunk terminator (\r\n) accounting for partial reads
                switch (remaining) {
                    default:
                        // remaining > 2: emit data and validate full terminator
                        emitSoon = std::string_view(data.data(), remaining - 2);
                        shouldEmit = true;
                        [[fallthrough]];
                    case 2:
                        // remaining >= 2: validate both \r and \n
                        if (data[remaining - 2] != '\r' || data[remaining - 1] != '\n') {
                            state = STATE_IS_ERROR;
                            return std::nullopt;
                        }
                        break;
                    case 1:
                        // remaining == 1: only \n left to validate
                        if (data[0] != '\n') {
                            state = STATE_IS_ERROR;
                            return std::nullopt;
                        }
                        break;
                    case 0:
                        // remaining == 0: terminator already consumed
                        break;
                }
                data.remove_prefix(remaining);
                state = STATE_IS_CHUNKED;
                if (shouldEmit) {
                    return emitSoon;
                }
                continue;
            } else {
                /* We will consume all our input data */
                std::string_view emitSoon;
                uint64_t size = chunkSize(state);
                size_t len = data.length();
                if (size > 2) {
                    uint64_t maximalAppEmit = size - 2;
                    if (len > maximalAppEmit) {
                        emitSoon = data.substr(0, maximalAppEmit);
                        // Validate terminator bytes being consumed
                        size_t terminatorBytesConsumed = len - maximalAppEmit;
                        if (terminatorBytesConsumed >= 1 && data[maximalAppEmit] != '\r') {
                            state = STATE_IS_ERROR;
                            return std::nullopt;
                        }
                        if (terminatorBytesConsumed >= 2 && data[maximalAppEmit + 1] != '\n') {
                            state = STATE_IS_ERROR;
                            return std::nullopt;
                        }
                    } else {
                        emitSoon = data;
                    }
                } else if (size == 2) {
                    // Only terminator bytes remain, validate what we have
                    if (len >= 1 && data[0] != '\r') {
                        state = STATE_IS_ERROR;
                        return std::nullopt;
                    }
                    if (len >= 2 && data[1] != '\n') {
                        state = STATE_IS_ERROR;
                        return std::nullopt;
                    }
                } else if (size == 1) {
                    // Only \n remains
                    if (data[0] != '\n') {
                        state = STATE_IS_ERROR;
                        return std::nullopt;
                    }
                }
                decChunkSize(state, (uint64_t) len);
                state |= STATE_IS_CHUNKED;
                data.remove_prefix(len);
                if (emitSoon.length()) {
                    return emitSoon;
                } else {
                    return std::nullopt;
                }
            }
        }

        return std::nullopt;
    }

    /* This is really just a wrapper for convenience */
    struct ChunkIterator {

        std::string_view *data;
        std::optional<std::string_view> chunk;
        uint64_t *state;
        bool trailer;

        ChunkIterator(std::string_view *data, uint64_t *state, bool trailer = false) : data(data), state(state), trailer(trailer) {
            chunk = uWS::getNextChunk(*data, *state, trailer);
        }

        ChunkIterator() {

        }

        ChunkIterator begin() {
            return *this;
        }

        ChunkIterator end() {
            return ChunkIterator();
        }

        std::string_view operator*() {
            if (!chunk.has_value()) {
                std::abort();
            }
            return chunk.value();
        }

        bool operator!=(const ChunkIterator &other) const {
            return other.chunk.has_value() != chunk.has_value();
        }

        ChunkIterator &operator++() {
            chunk = uWS::getNextChunk(*data, *state, trailer);
            return *this;
        }

    };
}

#endif // UWS_CHUNKEDENCODING_H
