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
    /* RFC 7230 4.1: chunk-size = 1*HEXDIG. Tracks that at least one hex digit has
     * been consumed for the current chunk-size line, across packet boundaries.
     * Without this a bare "\r\n" or ";ext\r\n" would parse as size 0. */
    constexpr uint64_t STATE_HAS_HEXDIG = 1ull << (sizeof(uint64_t) * 8 - 5);//0x0800000000000000;
    constexpr uint64_t STATE_SIZE_MASK = ~(STATE_HAS_SIZE | STATE_IS_CHUNKED | STATE_IS_CHUNKED_EXTENSION | STATE_WAITING_FOR_LF | STATE_HAS_HEXDIG);//0x07FFFFFFFFFFFFFF;
    constexpr uint64_t STATE_IS_ERROR = ~0ull;//0xFFFFFFFFFFFFFFFF;
    /* Overflow guard: if any of bits 54-58 are set before the next *16, one more
     * hex digit (plus the +2 for the trailing CRLF of chunk-data) would carry into
     * STATE_HAS_HEXDIG at bit 59. Limits chunk size to 14 hex digits (~72 PB). */
    constexpr uint64_t STATE_SIZE_OVERFLOW = 0x1Full << (sizeof(uint64_t) * 8 - 10);//0x07C0000000000000;

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
    /* chunkExtensionsConsumed (optional): incremented for every chunk-extension
     * byte consumed on the current chunk-size line; reset to 0 when the line
     * completes (STATE_HAS_SIZE), matching llhttp/Node's on_chunk_header which
     * resets chunk_extensions_nread_ per chunk (not per message). */
    inline uint64_t consumeHexNumber(std::string_view &data, uint64_t state, uint64_t *chunkExtensionsConsumed = nullptr) {
        /* Resume: '\r' was the last byte of the previous segment. Rare path,
         * use data directly to avoid the p/len load on the hot path. */
        if (state & STATE_WAITING_FOR_LF) [[unlikely]] {
            if (!data.length()) return state;
            if (data[0] != '\n') return STATE_IS_ERROR;
            if (!(state & STATE_HAS_HEXDIG)) return STATE_IS_ERROR;
            data.remove_prefix(1);
            return ((state & ~(STATE_WAITING_FOR_LF | STATE_IS_CHUNKED_EXTENSION | STATE_HAS_HEXDIG)) + 2)
                   | STATE_HAS_SIZE | STATE_IS_CHUNKED;
        }

        /* Fresh chunk-size line (not a resume): reset the per-chunk extension
         * counter, mirroring Node's on_chunk_header. The caller's overflow check
         * runs after the previous chunk's data is emitted, so it has already seen
         * that chunk's count by the time this reset fires. */
        if (chunkExtensionsConsumed && !(state & (STATE_IS_CHUNKED_EXTENSION | STATE_HAS_HEXDIG))) {
            *chunkExtensionsConsumed = 0;
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
                state = ((state & STATE_SIZE_MASK) * 16ull + n) | STATE_IS_CHUNKED | STATE_HAS_HEXDIG;
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
                if (!(state & STATE_HAS_HEXDIG)) return STATE_IS_ERROR;
                ++p; --len;
                data = std::string_view(p, len);
                return ((state & ~(STATE_IS_CHUNKED_EXTENSION | STATE_HAS_HEXDIG)) + 2)
                       | STATE_HAS_SIZE | STATE_IS_CHUNKED;
            }
            if (c <= 32) return STATE_IS_ERROR;
            state |= STATE_IS_CHUNKED_EXTENSION;
            if (chunkExtensionsConsumed) {
                ++*chunkExtensionsConsumed;
            }
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

    /* Distinct error sentinel: the captured trailer section exceeded the
     * max-header-size limit. isParsingInvalidChunkedEncoding() still matches;
     * the caller can then map this to HPE_HEADER_OVERFLOW / 431 like Node. */
    constexpr uint64_t STATE_IS_TRAILER_OVERFLOW = ~STATE_IS_CHUNKED_EXTENSION;

    inline bool isTrailerOverflow(uint64_t state) {
        return state == STATE_IS_TRAILER_OVERFLOW;
    }

    /* Distinct error sentinel: the CRLF that must follow a chunk's data was not
     * there. llhttp reports that as HPE_STRICT "Expected LF after chunk data",
     * separately from a malformed chunk-size line (HPE_INVALID_CHUNK_SIZE), so
     * the two have to be told apart. isParsingInvalidChunkedEncoding() still
     * matches, so every existing caller keeps rejecting the message. */
    constexpr uint64_t STATE_IS_CHUNK_TERMINATOR_ERROR = ~STATE_WAITING_FOR_LF;

    inline bool isChunkTerminatorError(uint64_t state) {
        return state == STATE_IS_CHUNK_TERMINATOR_ERROR;
    }

    inline bool isParsingInvalidChunkedEncoding(uint64_t state) {
        return state == STATE_IS_ERROR || state == STATE_IS_TRAILER_OVERFLOW ||
               state == STATE_IS_CHUNK_TERMINATOR_ERROR;
    }

    /* node:http compat: parser state for "consuming the trailer section after the
     * final 0-size chunk" (RFC 9112 7.1.2). The flag combinations cannot occur in
     * any other state: STATE_WAITING_FOR_LF is only ever set while the chunk-size
     * line is incomplete, i.e. before STATE_HAS_SIZE is set. _DONE means the
     * section (and thus the message) completed and the fin chunk was emitted; the
     * next call resets the state without touching the remaining bytes. The
     * sub-state must not be derived from the captured section's contents: the fin
     * delivery can synchronously run JS that consumes (and clears) the capture. */
    constexpr uint64_t STATE_IS_TRAILERS = STATE_HAS_SIZE | STATE_IS_CHUNKED | STATE_WAITING_FOR_LF;
    constexpr uint64_t STATE_IS_TRAILERS_DONE = STATE_HAS_SIZE | STATE_WAITING_FOR_LF;

    /* Framing-only trailer-part scan (Bun.serve path, no trailerSection buffer
     * supplied): the bytes are counted against maxTrailerSectionSize and
     * discarded. STATE_HAS_HEXDIG and STATE_IS_CHUNKED_EXTENSION are dead once
     * STATE_HAS_SIZE is set, so they carry the two sub-state flags and the
     * size field carries the byte counter. */
    constexpr uint64_t STATE_TRAILER_SCAN       = STATE_HAS_SIZE | STATE_WAITING_FOR_LF | STATE_IS_CHUNKED_EXTENSION;
    constexpr uint64_t STATE_TRAILER_LINE_START = STATE_HAS_HEXDIG;
    constexpr uint64_t STATE_TRAILER_AFTER_CR   = STATE_IS_CHUNKED;

    /* Default cap on the raw size of a captured trailer section. Node counts
     * trailer bytes against the same max-header-size budget as request headers
     * in llhttp, so node:http callers thread the per-server maxHeaderSize
     * through (already normalized to a nonzero default); this constant is the
     * fallback for callers that do not. */
    constexpr uint64_t MAX_TRAILER_SECTION_SIZE = 16 * 1024;

    /* The trailer section is complete once the empty line terminating it has been
     * consumed: either the section is empty ("\r\n") or it ends with "\r\n\r\n". */
    inline bool isCompleteTrailerSection(const std::string &section) {
        size_t n = section.size();
        if (n == 2) {
            return section[0] == '\r' && section[1] == '\n';
        }
        return n >= 4 && memcmp(section.data() + n - 4, "\r\n\r\n", 4) == 0;
    }

    /* Returns next chunk (empty or not), or if all data was consumed, nullopt is returned. */
    static std::optional<std::string_view> getNextChunk(std::string_view &data, uint64_t &state, uint64_t *chunkExtensionsConsumed = nullptr, std::string *trailerSection = nullptr, uint64_t maxTrailerSectionSize = MAX_TRAILER_SECTION_SIZE) {
        /* The previous call emitted the fin chunk for a message whose trailer
         * section completed; this call only resets the state and leaves the
         * remaining bytes (the next request, or tunnel data) untouched. */
        if (state == STATE_IS_TRAILERS_DONE) [[unlikely]] {
            state = 0;
            return std::nullopt;
        }
        while (data.length()) {

            /* Trailer-part parsing (RFC 9112 7.1.2): entered after the
             * last-chunk "0\r\n". The fin chunk is emitted only once the
             * terminating empty line is seen. STATE_HAS_SIZE |
             * STATE_WAITING_FOR_LF matches both trailer families
             * (STATE_IS_TRAILERS, STATE_TRAILER_SCAN) and nothing else,
             * since STATE_WAITING_FOR_LF is only ever set while the
             * chunk-size line is incomplete, i.e. before STATE_HAS_SIZE is
             * set. */
            if ((state & (STATE_HAS_SIZE | STATE_WAITING_FOR_LF)) == (STATE_HAS_SIZE | STATE_WAITING_FOR_LF)) [[unlikely]] {
                /* Capture path (node:http): raw bytes are appended to the
                 * buffer so the server can populate req.trailers. */
                if (trailerSection) {
                    while (data.length()) {
                        char c = data[0];
                        trailerSection->push_back(c);
                        data.remove_prefix(1);
                        if (trailerSection->size() > maxTrailerSectionSize) [[unlikely]] {
                            state = STATE_IS_TRAILER_OVERFLOW;
                            return std::nullopt;
                        }
                        if (c == '\n') {
                            /* Bare LF (no preceding CR captured) is a fatal parse error like
                             * llhttp's HPE_CR_EXPECTED / HPE_INVALID_HEADER_TOKEN — otherwise
                             * "0\r\n\n" waits for bytes forever. Strict CRLF matches
                             * consumeHexNumber's own bare-LF rejection above. */
                            size_t n = trailerSection->size();
                            if (n < 2 || (*trailerSection)[n - 2] != '\r') {
                                state = STATE_IS_ERROR;
                                return std::nullopt;
                            }
                            if (isCompleteTrailerSection(*trailerSection)) {
                                /* Message complete: emit the fin chunk. The next call sees
                                 * STATE_IS_TRAILERS_DONE and resets to 0. */
                                state = STATE_IS_TRAILERS_DONE;
                                return std::string_view(nullptr, 0);
                            }
                        }
                    }
                    return std::nullopt;
                }

                /* Framing-only scan (Bun.serve, no trailerSection buffer):
                 * bytes are discarded, counted against maxTrailerSectionSize,
                 * and only CRLF framing is validated. CR not followed by LF
                 * and bare LF are rejected so the end of the section cannot
                 * desync with a stricter front-end. */
                while (data.length()) {
                    unsigned char c = (unsigned char) data[0];
                    data.remove_prefix(1);
                    uint64_t count = chunkSize(state) + 1;
                    if (count > maxTrailerSectionSize) [[unlikely]] {
                        state = STATE_IS_TRAILER_OVERFLOW;
                        return std::nullopt;
                    }
                    if (state & STATE_TRAILER_AFTER_CR) {
                        if (c != '\n') {
                            state = STATE_IS_ERROR;
                            return std::nullopt;
                        }
                        if (state & STATE_TRAILER_LINE_START) {
                            /* Empty line: trailer-part complete. Emit fin. */
                            state = STATE_IS_TRAILERS_DONE;
                            return std::string_view(nullptr, 0);
                        }
                        state = STATE_TRAILER_SCAN | STATE_TRAILER_LINE_START | count;
                        continue;
                    }
                    if (c == '\r') {
                        state = (state & ~STATE_SIZE_MASK) | STATE_TRAILER_AFTER_CR | count;
                        continue;
                    }
                    if (c == '\n') {
                        state = STATE_IS_ERROR;
                        return std::nullopt;
                    }
                    state = STATE_TRAILER_SCAN | count;
                }
                return std::nullopt;
            }

            if (!hasChunkSize(state)) {
                state = consumeHexNumber(data, state, chunkExtensionsConsumed);
                if (isParsingInvalidChunkedEncoding(state)) [[unlikely]] {
                    return std::nullopt;
                }
                if (hasChunkSize(state) && chunkSize(state) == 2) {
                    /* last-chunk ("0" [chunk-ext] CRLF) consumed. The message
                     * is not complete until the trailer-part is consumed; fin
                     * is emitted from the matching branch above once the
                     * terminating CRLF is seen. With a trailerSection buffer
                     * the bytes are captured for req.trailers; without one
                     * (Bun.serve) they are scanned and discarded. */
                    state = trailerSection ? STATE_IS_TRAILERS : (STATE_TRAILER_SCAN | STATE_TRAILER_LINE_START);
                    continue;
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
                            state = STATE_IS_CHUNK_TERMINATOR_ERROR;
                            return std::nullopt;
                        }
                        break;
                    case 1:
                        // remaining == 1: only \n left to validate
                        if (data[0] != '\n') {
                            state = STATE_IS_CHUNK_TERMINATOR_ERROR;
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
                            state = STATE_IS_CHUNK_TERMINATOR_ERROR;
                            return std::nullopt;
                        }
                        if (terminatorBytesConsumed >= 2 && data[maximalAppEmit + 1] != '\n') {
                            state = STATE_IS_CHUNK_TERMINATOR_ERROR;
                            return std::nullopt;
                        }
                    } else {
                        emitSoon = data;
                    }
                } else if (size == 2) {
                    // Only terminator bytes remain, validate what we have
                    if (len >= 1 && data[0] != '\r') {
                        state = STATE_IS_CHUNK_TERMINATOR_ERROR;
                        return std::nullopt;
                    }
                    if (len >= 2 && data[1] != '\n') {
                        state = STATE_IS_CHUNK_TERMINATOR_ERROR;
                        return std::nullopt;
                    }
                } else if (size == 1) {
                    // Only \n remains
                    if (data[0] != '\n') {
                        state = STATE_IS_CHUNK_TERMINATOR_ERROR;
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
        uint64_t *chunkExtensionsConsumed;
        std::string *trailerSection;
        uint64_t maxTrailerSectionSize;

        ChunkIterator(std::string_view *data, uint64_t *state, uint64_t *chunkExtensionsConsumed = nullptr, std::string *trailerSection = nullptr, uint64_t maxTrailerSectionSize = MAX_TRAILER_SECTION_SIZE) : data(data), state(state), chunkExtensionsConsumed(chunkExtensionsConsumed), trailerSection(trailerSection), maxTrailerSectionSize(maxTrailerSectionSize) {
            chunk = uWS::getNextChunk(*data, *state, chunkExtensionsConsumed, trailerSection, maxTrailerSectionSize);
        }

        ChunkIterator() : data(nullptr), state(nullptr), chunkExtensionsConsumed(nullptr), trailerSection(nullptr), maxTrailerSectionSize(MAX_TRAILER_SECTION_SIZE) {

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
            chunk = uWS::getNextChunk(*data, *state, chunkExtensionsConsumed, trailerSection, maxTrailerSectionSize);
            return *this;
        }

    };
}

#endif // UWS_CHUNKEDENCODING_H
