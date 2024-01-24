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

    constexpr uint64_t STATE_HAS_SIZE = 1ull << (sizeof(uint64_t) * 8 - 1);//0x80000000;
    constexpr uint64_t STATE_IS_CHUNKED = 1ull << (sizeof(uint64_t) * 8 - 2);//0x40000000;
    constexpr uint64_t STATE_SIZE_MASK = ~(3ull << (sizeof(uint64_t) * 8 - 2));//0x3FFFFFFF;
    constexpr uint64_t STATE_IS_ERROR = ~0ull;//0xFFFFFFFF;
    constexpr uint64_t STATE_SIZE_OVERFLOW = 0x0Full << (sizeof(uint64_t) * 8 - 8);//0x0F000000;

    inline unsigned int chunkSize(uint64_t state) {
        return state & STATE_SIZE_MASK;
    }

    /* Reads hex number until CR or out of data to consume. Updates state. Returns bytes consumed. */
    inline void consumeHexNumber(std::string_view &data, uint64_t &state) {
        /* Consume everything higher than 32 */
        while (data.length() && data.data()[0] > 32) {

            unsigned char digit = (unsigned char)data.data()[0];
            if (digit >= 'a') {
                digit = (unsigned char) (digit - ('a' - ':'));
            } else if (digit >= 'A') {
                digit = (unsigned char) (digit - ('A' - ':'));
            }

            unsigned int number = ((unsigned int) digit - (unsigned int) '0');

            if (number > 16 || (chunkSize(state) & STATE_SIZE_OVERFLOW)) {
                state = STATE_IS_ERROR;
                return;
            }

            // extract state bits
            uint64_t bits = /*state &*/ STATE_IS_CHUNKED;

            state = (state & STATE_SIZE_MASK) * 16ull + number;

            state |= bits;
            data.remove_prefix(1);
        }
        /* Consume everything not /n */
        while (data.length() && data.data()[0] != '\n') {
            data.remove_prefix(1);
        }
        /* Now we stand on \n so consume it and enable size */
        if (data.length()) {
            state += 2; // include the two last /r/n
            state |= STATE_HAS_SIZE | STATE_IS_CHUNKED;
            data.remove_prefix(1);
        }
    }

    inline void decChunkSize(uint64_t &state, unsigned int by) {

        //unsigned int bits = state & STATE_IS_CHUNKED;

        state = (state & ~STATE_SIZE_MASK) | (chunkSize(state) - by);

        //state |= bits;
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
                consumeHexNumber(data, state);
                if (isParsingInvalidChunkedEncoding(state)) {
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
                continue;
            }

            // do we have data to emit all?
            if (data.length() >= chunkSize(state)) {
                // emit all but 2 bytes then reset state to 0 and goto beginning
                // not fin
                std::string_view emitSoon;
                bool shouldEmit = false;
                if (chunkSize(state) > 2) {
                    emitSoon = std::string_view(data.data(), chunkSize(state) - 2);
                    shouldEmit = true;
                }
                data.remove_prefix(chunkSize(state));
                state = STATE_IS_CHUNKED;
                if (shouldEmit) {
                    return emitSoon;
                }
                continue;
            } else {
                /* We will consume all our input data */
                std::string_view emitSoon;
                if (chunkSize(state) > 2) {
                    uint64_t maximalAppEmit = chunkSize(state) - 2;
                    if (data.length() > maximalAppEmit) {
                        emitSoon = data.substr(0, maximalAppEmit);
                    } else {
                        //cb(data);
                        emitSoon = data;
                    }
                }
                decChunkSize(state, (unsigned int) data.length());
                state |= STATE_IS_CHUNKED;
                // new: decrease data by its size (bug)
                data.remove_prefix(data.length()); // ny bug fix för getNextChunk
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
