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
    constexpr uint64_t STATE_SIZE_MASK = ~(STATE_HAS_SIZE | STATE_IS_CHUNKED | STATE_IS_CHUNKED_EXTENSION);//0x1FFFFFFFFFFFFFFF;
    constexpr uint64_t STATE_IS_ERROR = ~0ull;//0xFFFFFFFFFFFFFFFF;
    constexpr uint64_t STATE_SIZE_OVERFLOW = 0x0Full << (sizeof(uint64_t) * 8 - 8);//0x0F00000000000000;

    inline unsigned int chunkSize(uint64_t state) {
        return state & STATE_SIZE_MASK;
    }

    inline bool isParsingChunkedExtension(uint64_t state) {
        return (state & STATE_IS_CHUNKED_EXTENSION) != 0;
    }

    /* Reads hex number until CR or out of data to consume. Updates state. Returns bytes consumed. */
    inline void consumeHexNumber(std::string_view &data, uint64_t &state) {

        /* RFC 9110: 5.5 Field Values (TLDR; anything above 31 is allowed \r, \n ; depending on context)*/

        if(!isParsingChunkedExtension(state)){
            /* Consume everything higher than 32 and not ; (extension)*/
            while (data.length() && data[0] > 32 && data[0] != ';') {

                unsigned char digit = (unsigned char)data[0];
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
        }

        auto len = data.length();
        if(len) {
            // consume extension
            if(data[0] == ';' || isParsingChunkedExtension(state)) {
                // mark that we are parsing chunked extension
                state |= STATE_IS_CHUNKED_EXTENSION;
                /* we got chunk extension lets remove it*/
                while(data.length()) {
                    if(data[0] == '\r') {
                        // we are done parsing extension
                        state &= ~STATE_IS_CHUNKED_EXTENSION;
                        break;
                    }
                    /* RFC 9110: Token format (TLDR; anything bellow 32 is not allowed)
                    * TODO: add support for quoted-strings values (RFC 9110: 3.2.6. Quoted-String)
                    * Example of chunked encoding with extensions:
                    *
                    * 4;key=value\r\n
                    * Wiki\r\n
                    * 5;foo=bar;baz=quux\r\n
                    * pedia\r\n
                    * 0\r\n
                    * \r\n
                    *
                    * The chunk size is in hex (4, 5, 0), followed by optional
                    * semicolon-separated extensions. Extensions consist of a key
                    * (token) and optional value. The value may be a token or a
                    * quoted string. The chunk data follows the CRLF after the
                    * extensions and must be exactly the size specified.
                    *
                    * RFC 7230 Section 4.1.1 defines chunk extensions as:
                    * chunk-ext = *( ";" chunk-ext-name [ "=" chunk-ext-val ] )
                    * chunk-ext-name = token
                    * chunk-ext-val = token / quoted-string
                    */
                    if(data[0] <= 32) {
                        state = STATE_IS_ERROR;
                        return;
                    }

                    data.remove_prefix(1);
                }
            }
            if(data.length() >= 2) {
                /* Consume \r\n */
                if((data[0] != '\r' || data[1] != '\n')) {
                    state = STATE_IS_ERROR;
                    return;
                }
                state += 2; // include the two last /r/n
                state |= STATE_HAS_SIZE | STATE_IS_CHUNKED;

                data.remove_prefix(2);
            }
        }
        // short read
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
                // Validate that the chunk terminator is \r\n to prevent request smuggling
                // The last 2 bytes of the chunk must be exactly \r\n
                // Note: chunkSize always includes +2 for the terminator (added in consumeHexNumber),
                // and chunks with size 0 (chunkSize == 2) are handled earlier at line 190.
                // Therefore chunkSize >= 3 here, so no underflow is possible.
                size_t terminatorOffset = chunkSize(state) - 2;
                if (data[terminatorOffset] != '\r' || data[terminatorOffset + 1] != '\n') {
                    state = STATE_IS_ERROR;
                    return std::nullopt;
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
