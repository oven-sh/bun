/*
 * Authored by Alex Hultman, 2018-2020.
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

#pragma once

#ifndef UWS_HTTP_MAX_HEADERS_COUNT
#define UWS_HTTP_MAX_HEADERS_COUNT 200
#endif

// todo: HttpParser is in need of a few clean-ups and refactorings

/* The HTTP parser is an independent module subject to unit testing / fuzz testing */

#include <string>
#include <cstring>
#include <algorithm>
#include <chrono>
#include <climits>
#include <string_view>
#include <span>
#include <map>
#include "MoveOnlyFunction.h"
#include "ChunkedEncoding.h"

#include "BloomFilter.h"
#include "ProxyParser.h"
#include "QueryParser.h"
#include "HttpErrors.h"

#if defined(_WIN32)
#define strncasecmp _strnicmp
#endif

extern "C" size_t BUN_DEFAULT_MAX_HTTP_HEADER_SIZE;
extern "C" int16_t Bun__HTTPMethod__from(const char *str, size_t len);

namespace uWS
{

/* Declared here (the common include of HttpResponseData.h and HttpContext.h,
 * which include each other) so the IsNodeHttp default is visible exactly once
 * and before either of them. IsNodeHttp=false is the Bun.serve layout; the
 * true specialization adds the node:http-only per-connection state. */
template <bool SSL, bool IsNodeHttp = false>
struct HttpResponseData;


    /* We require at least this much post padding */
    inline constexpr unsigned int MINIMUM_HTTP_POST_PADDING = 32;

    /* Monotonic millisecond clock used for the node:http headers/request
     * timeout tracking (HttpResponseData::lastMessageStartMs). Kept separate
     * from the second-granular us_socket_timeout machinery because Node's
     * timeouts are millisecond-based. */
    static inline uint64_t nodeCompatMonotonicMs() {
        return (uint64_t) std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::steady_clock::now().time_since_epoch()).count();
    }

    enum HttpParserError: uint8_t {
        HTTP_PARSER_ERROR_NONE = 0,
        HTTP_PARSER_ERROR_INVALID_CHUNKED_ENCODING = 1,
        HTTP_PARSER_ERROR_INVALID_CONTENT_LENGTH = 2,
        HTTP_PARSER_ERROR_INVALID_TRANSFER_ENCODING = 3,
        HTTP_PARSER_ERROR_MISSING_HOST_HEADER = 4,
        HTTP_PARSER_ERROR_INVALID_REQUEST = 5,
        HTTP_PARSER_ERROR_REQUEST_HEADER_FIELDS_TOO_LARGE = 6,
        HTTP_PARSER_ERROR_INVALID_HTTP_VERSION = 7,
        HTTP_PARSER_ERROR_INVALID_EOF = 8,
        HTTP_PARSER_ERROR_INVALID_METHOD = 9,
        HTTP_PARSER_ERROR_INVALID_HEADER_TOKEN = 10,
        /* A bare CR (not followed by LF) terminated a header value (llhttp's
         * HPE_LF_EXPECTED). */
        HTTP_PARSER_ERROR_LF_EXPECTED = 11,
        /* The chunk extensions of a single chunk exceeded the 16 KiB limit
         * (Node/llhttp's HPE_CHUNK_EXTENSIONS_OVERFLOW). */
        HTTP_PARSER_ERROR_CHUNK_EXTENSIONS_OVERFLOW = 12,
        /* An HTTP/2 client connection preface was received on an HTTP/1 server
         * (llhttp's HPE_PAUSED_H2_UPGRADE). */
        HTTP_PARSER_ERROR_PAUSED_H2_UPGRADE = 13,
        /* Bytes were received after a request that carried Connection: close
         * (llhttp's HPE_CLOSED_CONNECTION). node:http compat only. */
        HTTP_PARSER_ERROR_CLOSED_CONNECTION = 14,
        /* A captured trailer section exceeded the max-header-size limit
         * (Node/llhttp reports HPE_HEADER_OVERFLOW → 431). */
        HTTP_PARSER_ERROR_TRAILER_FIELDS_TOO_LARGE = 15,
        /* The CRLF that must follow a chunk's data was missing or malformed.
         * llhttp reports this as HPE_STRICT "Expected LF after chunk data",
         * distinct from a malformed chunk-size line (HPE_INVALID_CHUNK_SIZE). */
        HTTP_PARSER_ERROR_CHUNK_TERMINATOR_EXPECTED = 16,
        /* A Content-Length field appeared in the trailer section of a chunked
         * body. llhttp reports HPE_INVALID_CONTENT_LENGTH ("Content-Length can't
         * be present with Transfer-Encoding"). node:http compat only. */
        HTTP_PARSER_ERROR_TRAILER_CONTENT_LENGTH = 17,
    };


    enum HTTPHeaderParserError: uint8_t {
        HTTP_HEADER_PARSER_ERROR_NONE = 0,
        HTTP_HEADER_PARSER_ERROR_INVALID_HTTP_VERSION = 1,
        HTTP_HEADER_PARSER_ERROR_INVALID_REQUEST = 2,
        HTTP_HEADER_PARSER_ERROR_INVALID_METHOD = 3,
        HTTP_HEADER_PARSER_ERROR_REQUEST_HEADER_FIELDS_TOO_LARGE = 4,
        HTTP_HEADER_PARSER_ERROR_PAUSED_H2_UPGRADE = 5,
    };

    struct HttpParserResult {
        HttpParserError parserError = HTTP_PARSER_ERROR_NONE;
        unsigned int errorStatusCodeOrConsumedBytes = 0;
        void* returnedData = nullptr;
    public:
        static HttpParserResult error(unsigned int errorStatusCode, HttpParserError error) {
            return HttpParserResult{.parserError = error, .errorStatusCodeOrConsumedBytes = errorStatusCode, .returnedData = nullptr};
        }

        static HttpParserResult success(unsigned int consumedBytes, void* data = nullptr) {
            return HttpParserResult{.parserError = HTTP_PARSER_ERROR_NONE, .errorStatusCodeOrConsumedBytes = consumedBytes, .returnedData = data};
        }

        static HttpParserResult shortRead() {
            return HttpParserResult{.parserError = HTTP_PARSER_ERROR_NONE, .errorStatusCodeOrConsumedBytes = 0, .returnedData = nullptr};
        }

        /* Returns the number of consumed bytes if there was no error, otherwise 0 */
        unsigned int consumedBytes() {
            if (parserError != HTTP_PARSER_ERROR_NONE) {
                return 0;
            }
            return errorStatusCodeOrConsumedBytes;
        }

        /* Returns the HTTP error status code if there was an error, otherwise 0 */
        unsigned int httpErrorStatusCode() {
            if (parserError != HTTP_PARSER_ERROR_NONE) {
                return errorStatusCodeOrConsumedBytes;
            }
            return 0;
        }

        bool isShortRead() {
            return parserError == HTTP_PARSER_ERROR_NONE && errorStatusCodeOrConsumedBytes == 0;
        }


        /* Returns true if there was an error */
        bool isError() {
            return parserError != HTTP_PARSER_ERROR_NONE;
        }
    };

    struct ConsumeRequestLineResult {
        char *position;
        bool isAncientHTTP;
        bool isConnect;
        HTTPHeaderParserError headerParserError;
        public:
        static ConsumeRequestLineResult error(HTTPHeaderParserError error) {
            return ConsumeRequestLineResult{nullptr, false, false, error};
        }

        static ConsumeRequestLineResult success(char *position, bool isAncientHTTP = false, bool isConnect = false) {
            return ConsumeRequestLineResult{position, isAncientHTTP, isConnect, HTTP_HEADER_PARSER_ERROR_NONE};
        }

        static ConsumeRequestLineResult shortRead(bool isAncientHTTP = false, bool isConnect = false) {
            return ConsumeRequestLineResult{nullptr, isAncientHTTP, isConnect, HTTP_HEADER_PARSER_ERROR_NONE};
        }

        bool isErrorOrShortRead() {
            return headerParserError != HTTP_HEADER_PARSER_ERROR_NONE || position == nullptr;
        }
    };

    struct HttpRequest
    {

        friend struct HttpParser;

    private:
        struct Header
        {
            std::string_view key, value;
        } headers[UWS_HTTP_MAX_HEADERS_COUNT];
        bool ancientHttp;
        bool didYield;
        unsigned int querySeparator;
        BloomFilter bf;
        std::pair<int, std::string_view *> currentParameters;
        std::map<std::string, unsigned short, std::less<>> *currentParameterOffsets = nullptr;

    public:
        /* Any data pipelined after the HTTP headers (before response).
         * Used for Node.js compatibility: 'connect' and 'upgrade' events
         * pass this as the 'head' Buffer parameter.
         * WARNING: This points to data in the receive buffer and may be stack-allocated.
         * Must be cloned before the request handler returns. */
        std::span<const char> head;

        bool isAncient()
        {
            return ancientHttp;
        }

        bool getYield()
        {
            return didYield;
        }

        /* Iteration over headers (key, value) */
        struct HeaderIterator
        {
            Header *ptr;

            bool operator!=(const HeaderIterator &other) const
            {
                /* Comparison with end is a special case */
                if (ptr != other.ptr)
                {
                    return other.ptr || ptr->key.length();
                }
                return false;
            }

            HeaderIterator &operator++()
            {
                ptr++;
                return *this;
            }

            std::pair<std::string_view, std::string_view> operator*() const
            {
                return {ptr->key, ptr->value};
            }
        };

        HeaderIterator begin()
        {
            return {headers + 1};
        }

        HeaderIterator end()
        {
            return {nullptr};
        }

        /* If you do not want to handle this route */
        void setYield(bool yield)
        {
            didYield = yield;
        }

        std::string_view getHeader(std::string_view lowerCasedHeader)
        {
            if (bf.mightHave(lowerCasedHeader))
            {
                for (Header *h = headers; (++h)->key.length();)
                {
                    /* Stored keys keep their wire casing */
                    if (h->key.length() == lowerCasedHeader.length() && !strncasecmp(h->key.data(), lowerCasedHeader.data(), lowerCasedHeader.length()))
                    {
                        return h->value;
                    }
                }
            }
            return std::string_view(nullptr, 0);
        }

        struct TransferEncoding {
            bool has: 1 = false;
            bool chunked: 1 = false;
            bool invalid: 1 = false;
            /* More than one coding token was named across all Transfer-Encoding
             * fields (e.g. "gzip, chunked" or a "gzip" field plus a "chunked"
             * field). Bun.serve implements no transfer coding other than chunked,
             * so when this is set the extra coding would be silently dropped and
             * the still-encoded body handed to the app; Bun.serve rejects it
             * (RFC 9112 6.1). node:http accepts it to match llhttp. */
            bool multipleCodings: 1 = false;
        };

        TransferEncoding getTransferEncoding()
        {
            TransferEncoding te;

            if (!bf.mightHave("transfer-encoding")) {
                return te;
            }

            bool seenAnyCoding = false;
            for (Header *h = headers; (++h)->key.length();) {
                if (h->key.length() == 17 && !strncasecmp(h->key.data(), "transfer-encoding", 17)) {
                    /* An earlier Transfer-Encoding field already named "chunked": any
                     * later TE field (even one with an empty value) is invalid. The
                     * per-token guard below handles the non-empty case too; this catches
                     * the empty one so the change is strictly tightening. */
                    if (te.chunked) [[unlikely]] {
                        te.invalid = true;
                        return te;
                    }

                    // Parse comma-separated values, ensuring "chunked" is last if present
                    const auto value = h->value;
                    size_t pos = 0;

                    while (pos < value.length()) {
                        // Skip leading whitespace
                        while (pos < value.length() && (value[pos] == ' ' || value[pos] == '\t')) {
                            pos++;
                        }

                        // Remember start of this token
                        size_t tokenStart = pos;

                        // Find end of token (until comma or end)
                        while (pos < value.length() && value[pos] != ',') {
                            pos++;
                        }

                        // Trim trailing whitespace from token
                        size_t tokenEnd = pos;
                        while (tokenEnd > tokenStart && (value[tokenEnd - 1] == ' ' || value[tokenEnd - 1] == '\t')) {
                            tokenEnd--;
                        }

                        size_t tokenLen = tokenEnd - tokenStart;
                        if (tokenLen > 0) {
                            /* A prior coding (from this or an earlier TE field) was
                             * "chunked": chunked MUST be the final coding (RFC 9112
                             * 6.1), so any token after it is invalid. llhttp
                             * (s_n_llhttp__internal__n_header_value_te_chunked_last)
                             * rejects here too, for "chunked, chunked" as well. */
                            if (te.chunked) [[unlikely]] {
                                te.invalid = true;
                                return te;
                            }
                            if (seenAnyCoding) {
                                te.multipleCodings = true;
                            }
                            seenAnyCoding = true;
                            te.chunked = tokenLen == 7 && strncasecmp(value.data() + tokenStart, "chunked", 7) == 0;
                        }

                        // Move past comma if present
                        if (pos < value.length() && value[pos] == ',') {
                            pos++;
                        }
                    }

                    /* Present even when the value names no transfer coding: treating
                     * an empty/whitespace-only field as absent would fall back to
                     * Content-Length framing (request smuggling; RFC 9112 6.3). */
                    te.has = true;
                }
            }

            return te;
        }


        std::string_view getUrl()
        {
            return std::string_view(headers->value.data(), querySeparator);
        }

        std::string_view getFullUrl()
        {
            return headers->value;
        }

        std::string_view getUrlForRouting()
        {
            std::string_view url = getUrl();
            if (url.length() && url[0] != '/') {
                size_t schemeLength = 0;
                if (url.length() >= 7 && strncasecmp(url.data(), "http://", 7) == 0) {
                    schemeLength = 7;
                } else if (url.length() >= 8 && strncasecmp(url.data(), "https://", 8) == 0) {
                    schemeLength = 8;
                }
                if (schemeLength) {
                    size_t pathStart = url.find('/', schemeLength);
                    if (pathStart == std::string_view::npos) {
                        return "/";
                    }
                    return url.substr(pathStart);
                }
            }
            return url;
        }

        /* Hack: this should be getMethod */
        std::string_view getCaseSensitiveMethod()
        {
            return headers->key;
        }

        std::string_view getMethod()
        {
            /* Compatibility hack: lower case method (todo: remove when major version bumps) */
            for (unsigned int i = 0; i < headers->key.length(); i++)
            {
                ((char *)headers->key.data())[i] |= 32;
            }

            return headers->key;
        }

        /* Returns the raw querystring as a whole, still encoded */
        std::string_view getQuery()
        {
            if (querySeparator < headers->value.length())
            {
                /* Strip the initial ? */
                return headers->value.substr(querySeparator + 1);
            }
            else
            {
                return std::string_view(nullptr, 0);
            }
        }

        /* Finds and decodes the URI component. */
        std::string_view getQuery(std::string_view key)
        {
            /* Raw querystring including initial '?' sign */
            return getDecodedQueryValue(key, headers->value.substr(querySeparator));
        }

        void setParameters(std::pair<int, std::string_view *> parameters)
        {
            currentParameters = parameters;
        }

        void setParameterOffsets(std::map<std::string, unsigned short, std::less<>> *offsets)
        {
            currentParameterOffsets = offsets;
        }

        std::string_view getParameter(std::string_view name) {
            if (!currentParameterOffsets) {
                return {nullptr, 0};
            }
            auto it = currentParameterOffsets->find(name);
            if (it == currentParameterOffsets->end()) {
                return {nullptr, 0};
            }
            return getParameter(it->second);
        }

        std::string_view getParameter(unsigned short index) {
            if (currentParameters.first < (int)index) {
                return {};
            } else {
                return currentParameters.second[index];
            }
        }
    };

    struct HttpParser
    {
    public:
        /* node:http server compat: whether a partial request head is sitting in
         * the fallback buffer waiting for more bytes (used by the
         * headersTimeout/requestTimeout tracking in HttpContext::onData).
         * Empty lines (CRLF) received before the request-line are ignored
         * (RFC 9112 2.2), matching Node/llhttp: they alone do not start a new
         * request message. */
        bool hasBufferedPartialRequestHeaders() const {
            for (char c : fallback) {
                if (!isNewline((unsigned char) c)) {
                    return true;
                }
            }
            return false;
        }

        /* node:http server compat: whether a message body (Content-Length or
         * chunked) is only partially received. Used by onEnd to surface a
         * mid-body FIN as HPE_INVALID_EOF_STATE like Node's parser.finish(). */
        bool hasIncompleteRequestBody() const {
            return remainingStreamingBytes != 0;
        }

        /* Maximum number of trailer fields surfaced to JS (the section size cap
         * already bounds memory; this matches the regular-header count cap). */
        static constexpr unsigned MAX_TRAILER_FIELDS = UWS_HTTP_MAX_HEADERS_COUNT - 1;

        /* Parse a complete trailer section (the bytes between the 0-size chunk and the
         * final CRLF, as captured into nodeHttpRequestTrailers) into key/value pairs,
         * reusing the same consumeFieldName / tryConsumeFieldValue / OWS-trim primitives
         * that getHeaders uses for the main request header block. Wire casing of
         * field names is preserved (req.rawTrailers). Returns the number of fields
         * written to out[]. The captured section is raw wire bytes (the chunk
         * iterator only size-caps it), so this is also the only gate on NUL /
         * bare-CR/LF in a trailer line: any malformed line makes the call return 0
         * and no trailer is surfaced, where Node's llhttp rejects the message.
         * Consumes the section: it is post-padded in place and the returned
         * string_views point into it, so it must outlive their use.
         * KEEP IN LOCKSTEP with getHeaders' field-line loop below (same
         * consumeFieldName → tryConsumeFieldValue → CRLF/OWS sequence). */
        static unsigned parseTrailerFields(std::string &section, std::pair<std::string_view, std::string_view> *out, bool useInsecureHTTPParser = false, unsigned outCapacity = MAX_TRAILER_FIELDS) {
            if (section.size() < 4) {
                return 0;
            }
            /* tryConsumeFieldValue stops at the 8-byte word CONTAINING the value's
             * '\r', not at it, so its last load can reach 3 bytes past the final
             * CRLF CRLF without this padding (the NULs stay past `end`). */
            size_t length = section.size();
            section.append(MINIMUM_HTTP_POST_PADDING, '\0');
            char *p = section.data();
            char *end = p + length;
            unsigned count = 0;
            while (count < outCapacity) {
                /* Empty line (the section's terminating CRLF) - done. */
                if (p[0] == '\r') {
                    return (p + 1 < end && p[1] == '\n') ? count : 0;
                }
                char *keyStart = p;
                p = consumeFieldName(p);
                std::string_view key(keyStart, (size_t)(p - keyStart));
                if (p[0] != ':' || key.empty()) {
                    return 0;
                }
                p++;
                char *valueStart = p;
                while (true) {
                    p = tryConsumeFieldValue(p);
                    const unsigned char stopByte = (unsigned char) p[0];
                    if (stopByte == '\t') { p++; continue; }
                    /* Same lenient-header-value acceptance as getHeaders. */
                    if (useInsecureHTTPParser && stopByte != '\0' && !isNewline(stopByte)) { p++; continue; }
                    break;
                }
                if (p + 1 >= end || p[0] != '\r' || p[1] != '\n') {
                    return 0;
                }
                std::string_view value(valueStart, (size_t)(p - valueStart));
                p += 2;
                while (value.length() && isHTTPHeaderValueWhitespace(value.back())) {
                    value.remove_suffix(1);
                }
                while (value.length() && isHTTPHeaderValueWhitespace(value.front())) {
                    value.remove_prefix(1);
                }
                out[count] = { key, value };
                count++;
            }
            return count;
        }

        /* node:http compat: validate a captured, complete trailer section before the
         * message is completed. Node's llhttp fails the message on a malformed trailer
         * field line (clientError HPE_INVALID_HEADER_TOKEN) instead of completing it
         * with req.trailers silently dropped; a CTL byte in a value is only accepted
         * under insecureHTTPParser, exactly like a header value. A Content-Length or
         * Transfer-Encoding field in the trailer section is rejected exactly like
         * llhttp does (it runs trailers through the same header state machine, so
         * the already-set F_CHUNKED collides), unless insecureHTTPParser is set
         * (llhttp's LENIENT_CHUNKED_LENGTH / LENIENT_TRANSFER_ENCODING). An empty
         * section (bare CRLF, no trailers) is valid.
         *
         * Known bound: parseTrailerFields stops at MAX_TRAILER_FIELDS, so a section with
         * more valid fields than that followed by a malformed line is accepted where node
         * still errors; reaching it requires a deliberately padded (but size-capped)
         * section, and rejecting it would need a second scanning mode. */
        static HttpParserError validateNodeTrailerSection(const std::string *section, bool useInsecureHTTPParser) {
            if (!section || section->size() <= 2) {
                return HTTP_PARSER_ERROR_NONE;
            }
            /* parseTrailerFields consumes (post-pads) its input, so validate a copy. */
            std::string copy(*section);
            std::pair<std::string_view, std::string_view> scratch[MAX_TRAILER_FIELDS];
            unsigned count = parseTrailerFields(copy, scratch, useInsecureHTTPParser);
            if (count == 0) {
                return HTTP_PARSER_ERROR_INVALID_HEADER_TOKEN;
            }
            if (!useInsecureHTTPParser) {
                for (unsigned i = 0; i < count; i++) {
                    std::string_view name = scratch[i].first;
                    if (name.length() == 14 && !strncasecmp(name.data(), "content-length", 14)) {
                        return HTTP_PARSER_ERROR_TRAILER_CONTENT_LENGTH;
                    }
                    if (name.length() == 17 && !strncasecmp(name.data(), "transfer-encoding", 17)) {
                        return HTTP_PARSER_ERROR_INVALID_TRANSFER_ENCODING;
                    }
                }
            }
            return HTTP_PARSER_ERROR_NONE;
        }

    private:
        std::string fallback;
         /* This guy really has only 30 bits since we reserve two highest bits to chunked encoding parsing state */
        uint64_t remainingStreamingBytes = 0;
        /* node:http compat: a completed request on this connection forbade keep-alive
         * (Connection: close, or HTTP/1.0), so no further message may be dispatched
         * (llhttp parses nothing after such a message: HPE_CLOSED_CONNECTION). */
        bool nodeHttpSawConnectionClose = false;

        const size_t MAX_FALLBACK_SIZE = BUN_DEFAULT_MAX_HTTP_HEADER_SIZE;

        /* Maximum chunk-extension bytes per chunk, matching Node/llhttp's
         * kMaxChunkExtensionsSize (16 KiB). Enforced for every server
         * personality so a client cannot stream unbounded extension bytes. */
        static const uint64_t MAX_CHUNK_EXTENSION_SIZE = 16 * 1024;

        /* Returns UINT64_MAX on error. Maximum 999999999 is allowed. */
        static uint64_t toUnsignedInteger(std::string_view str) {
            /* We assume at least 64-bit integer giving us safely 999999999999999999 (18 number of 9s) */
            if (str.length() > 18) {
                return UINT64_MAX;
            }

            uint64_t unsignedIntegerValue = 0;
            for (char c : str) {
                /* As long as the letter is 0-9 we cannot overflow. */
                if (c < '0' || c > '9') {
                    return UINT64_MAX;
                }
                unsignedIntegerValue = unsignedIntegerValue * 10ull + ((unsigned int) c - (unsigned int) '0');
            }
            return unsignedIntegerValue;
        }

        static inline uint64_t hasLess(uint64_t x, uint64_t n) {
            return (((x)-~0ULL/255*(n))&~(x)&~0ULL/255*128);
        }

        static inline uint64_t hasMore(uint64_t x, uint64_t n) {
            return (( ((x)+~0ULL/255*(127-(n))) |(x))&~0ULL/255*128);
        }

        static inline uint64_t hasBetween(uint64_t x, uint64_t m, uint64_t n) {
            return (( (~0ULL/255*(127+(n))-((x)&~0ULL/255*127)) &~(x)& (((x)&~0ULL/255*127)+~0ULL/255*(127-(m))) )&~0ULL/255*128);
        }

        static inline bool notFieldNameWord(uint64_t x) {
            return hasLess(x, '-') |
            hasBetween(x, '-', '0') |
            hasBetween(x, '9', 'A') |
            hasBetween(x, 'Z', 'a') |
            hasMore(x, 'z');
        }

        /* RFC 9110 5.6.2. Tokens */
        /* Hyphen is not checked here as it is very common */
        static inline bool isUnlikelyFieldNameByte(unsigned char c)
        {
            /* Digits and 14 of the 15 non-alphanum characters (lacking hyphen) */
            return ((c == '~') | (c == '|') | (c == '`') | (c == '_') | (c == '^') | (c == '.') | (c == '+')
                | (c == '*') | (c == '!')) || ((c >= 48) & (c <= 57)) || ((c <= 39) & (c >= 35));
        }

        /* Header names keep their original wire casing; lookups go through
         * the case-insensitive getHeader(). */
        static inline bool isFieldNameByte(unsigned char in) {
            /* Most common is lowercase alpha and hyphen */
            if (((in >= 97) & (in <= 122)) | (in == '-')) [[likely]] {
                return true;
            /* Second is upper case alpha */
            } else if ((in >= 65) & (in <= 90)) [[unlikely]] {
                return true;
            /* These are rarely used but still valid */
            } else if (isUnlikelyFieldNameByte(in)) [[unlikely]] {
                return true;
            }
            return false;
        }

        static inline char *consumeFieldName(char *p) {
            /* Best case fast path (particularly useful with clang) */
            while (true) {
                while ((*p >= 65) & (*p <= 90)) [[likely]] {
                    p++;
                }
                while (((*p >= 97) & (*p <= 122))) [[likely]] {
                    p++;
                }
                if (*p == ':') {
                    return p;
                }
                if (*p == '-') {
                    p++;
                } else if (!((*p >= 65) & (*p <= 90))) {
                    /* Exit fast path parsing */
                    break;
                }
            }

            /* Generic */
            while (isFieldNameByte(*(unsigned char *)p)) {
                p++;
            }
            return p;
        }

        static bool isValidMethod(std::string_view str, bool useStrictMethodValidation) {
            if (str.empty()) return false;

            if (useStrictMethodValidation) {
                return Bun__HTTPMethod__from(str.data(), str.length()) != -1;
            }

            for (char c : str) {
                if (!isValidMethodChar(c))
                    return false;
            }
            return true;
        }

        static inline bool isValidMethodChar(char c) {
            return ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z')) || c == '-';
        }

        /* Strict (node:http) method validation rejects, byte by byte, anything
         * that cannot appear in one of llhttp's method tokens (uppercase letters
         * and '-', e.g. M-SEARCH). llhttp fails as soon as such a byte is seen,
         * without waiting for the request line to complete, and Node surfaces it
         * as HPE_INVALID_METHOD through 'clientError'. */
        static inline bool isStrictMethodChar(char c) {
            return (c >= 'A' && c <= 'Z') || c == '-';
        }

        /* RFC 9110 Section 5.5: optional whitespace (OWS) is SP or HTAB */
        static inline bool isHTTPHeaderValueWhitespace(unsigned char c) {
            return c == ' ' || c == '\t';
        }

        /* A line terminator byte. Line endings are CRLF, but llhttp tolerates a
         * bare CR or LF in the places that call this, so they are tested together. */
        static inline bool isNewline(const unsigned char c) {
            return c == '\r' || c == '\n';
        }

        static inline int isHTTPorHTTPSPrefixForProxies(char *data, char *end) {
            // We can check 8 because:
            // 1. If it's "http://" that's 7 bytes, and it's supposed to at least have a trailing slash.
            // 2. If it's "https://" that's 8 bytes exactly.
            if (data + 8 >= end) [[unlikely]] {
                // if it's not at least 8 bytes, let's try again later
                return -1;
            }

            uint64_t http;
            __builtin_memcpy(&http, data, sizeof(uint64_t));

            uint32_t first_four_bytes = http & static_cast<uint32_t>(0xFFFFFFFF);
            // check if any of the first four bytes are > non-ascii
            if ((first_four_bytes & 0x80808080) != 0) [[unlikely]] {
                return 0;
            }
            first_four_bytes |= 0x20202020; // Lowercase the first four bytes

            static constexpr char http_lowercase_bytes[4] = {'h', 't', 't', 'p'};
            static constexpr uint32_t http_lowercase_bytes_int = __builtin_bit_cast(uint32_t, http_lowercase_bytes);
            if (first_four_bytes == http_lowercase_bytes_int) [[likely]] {
                if (__builtin_memcmp(reinterpret_cast<char *>(&http) + 4, "://", 3) == 0) [[likely]] {
                    return 1;
                }

                static constexpr char s_colon_slash_slash[4] = {'s', ':', '/', '/'};
                static constexpr uint32_t s_colon_slash_slash_int = __builtin_bit_cast(uint32_t, s_colon_slash_slash);

                static constexpr char S_colon_slash_slash[4] = {'S', ':', '/', '/'};
                static constexpr uint32_t S_colon_slash_slash_int = __builtin_bit_cast(uint32_t, S_colon_slash_slash);

                // Extract the last four bytes from the uint64_t
                const uint32_t last_four_bytes = (http >> 32) & static_cast<uint32_t>(0xFFFFFFFF);
                return (last_four_bytes == s_colon_slash_slash_int) || (last_four_bytes == S_colon_slash_slash_int);
            }

            return 0;
        }


        /* Puts method as key, target as value and returns non-null (or nullptr on error). */
        static inline ConsumeRequestLineResult consumeRequestLine(char *data, char *end, HttpRequest::Header &header, bool useStrictMethodValidation, uint64_t maxHeaderSize) {
            /* Scan until single SP, assume next is / (origin request) */
            char *start = data;
            /* This catches the post padded CR and fails */
            while (data[0] > 32) {
                if (!isValidMethodChar(data[0]) ) {
                    return ConsumeRequestLineResult::error(HTTP_HEADER_PARSER_ERROR_INVALID_METHOD);
                }
                /* Strict mode fails fast on bytes no llhttp method contains (e.g.
                 * lowercase letters), even if the request line is incomplete. */
                if (useStrictMethodValidation && !isStrictMethodChar(data[0])) {
                    return ConsumeRequestLineResult::error(HTTP_HEADER_PARSER_ERROR_INVALID_METHOD);
                }
                data++;

            }
            if(start == data)  [[unlikely]] {
                return ConsumeRequestLineResult::error(HTTP_HEADER_PARSER_ERROR_INVALID_METHOD);
            }

            /* RFC 9112 3: exactly one SP separates method and request-target */
            bool isHTTPMethod = (__builtin_expect(data[0] == 32 && data[1] == '/', 1));
            /* HTTP/2 preface ("PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n"): detect it here
             * so it inherits fallback-buffer reassembly and leading-CRLF stripping,
             * matching Node/llhttp which persist n_req_pri_upgrade across execute(). */
            if (!isHTTPMethod && (data - start) == 3 && data[0] == 32 && data[1] == '*'
                && memcmp(start, "PRI", 3) == 0) [[unlikely]] {
                unsigned int have = (unsigned int)(end - start);
                /* Preface is exactly 24 bytes; the method loop consumed "PRI". */
                static constexpr char preface[] = "PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n";
                if (have < 24) {
                    return memcmp(start, preface, have) == 0
                        ? ConsumeRequestLineResult::shortRead()
                        : ConsumeRequestLineResult::error(HTTP_HEADER_PARSER_ERROR_INVALID_REQUEST);
                }
                if (memcmp(start, preface, 24) == 0) {
                    return ConsumeRequestLineResult::error(HTTP_HEADER_PARSER_ERROR_PAUSED_H2_UPGRADE);
                }
                return ConsumeRequestLineResult::error(HTTP_HEADER_PARSER_ERROR_INVALID_REQUEST);
            }
            bool isConnect = !isHTTPMethod && ((data - start) == 7 && data[0] == 32 && memcmp(start, "CONNECT", 7) == 0);
            /* Also accept proxy-style absolute URLs (http://... or https://...) as valid request targets */
            bool isProxyStyleURL = !isHTTPMethod && !isConnect && data[0] == 32 && isHTTPorHTTPSPrefixForProxies(data + 1, end) == 1;
            if (isHTTPMethod || isConnect || isProxyStyleURL) [[likely]] {
                header.key = {start, (size_t) (data - start)};
                data++;
                if(!isValidMethod(header.key, useStrictMethodValidation)) {
                    return ConsumeRequestLineResult::error(HTTP_HEADER_PARSER_ERROR_INVALID_METHOD);
                }
                /* Scan for less than 33 (catches post padded CR and fails) */
                start = data;
                for (; true; data += 8) {
                    uint64_t word;
                    memcpy(&word, data, sizeof(uint64_t));
                    if(maxHeaderSize && (uintptr_t)(data - start) > maxHeaderSize) {
                        return ConsumeRequestLineResult::error(HTTP_HEADER_PARSER_ERROR_REQUEST_HEADER_FIELDS_TOO_LARGE);
                    }
                    if (hasLess(word, 33)) {
                        while (*(unsigned char *)data > 32) data++;
                        if(maxHeaderSize && (uintptr_t)(data - start) > maxHeaderSize) {
                            return ConsumeRequestLineResult::error(HTTP_HEADER_PARSER_ERROR_REQUEST_HEADER_FIELDS_TOO_LARGE);
                        }
                        /* Now we stand on space */
                        header.value = {start, (size_t) (data - start)};
                        auto nextPosition = data + 11;
                        /* Check that the following is http 1.1 */
                        if (nextPosition >= end) {
                            /* Whatever we have must be part of the version string */
                            if (memcmp(" HTTP/1.1\r\n", data, std::min<unsigned int>(11, (unsigned int) (end - data))) == 0) {
                                return ConsumeRequestLineResult::shortRead(false, isConnect);
                            } else if (memcmp(" HTTP/1.0\r\n", data, std::min<unsigned int>(11, (unsigned int) (end - data))) == 0) {
                                /*Indicates that the request line is ancient HTTP*/
                                return ConsumeRequestLineResult::shortRead(true, isConnect);
                            }
                            return ConsumeRequestLineResult::error(HTTP_HEADER_PARSER_ERROR_INVALID_HTTP_VERSION);
                        }
                        if (memcmp(" HTTP/1.1\r\n", data, 11) == 0) {
                            return ConsumeRequestLineResult::success(nextPosition, false, isConnect);
                        } else if (memcmp(" HTTP/1.0\r\n", data, 11) == 0) {
                            /*Indicates that the request line is ancient HTTP*/
                            return ConsumeRequestLineResult::success(nextPosition, true, isConnect);
                        }
                        /* nextPosition < end here, so data < end: any CR is real input, not the
                         * post-padding sentinel. Fall through to the version error. */
                        return ConsumeRequestLineResult::error(HTTP_HEADER_PARSER_ERROR_INVALID_HTTP_VERSION);
                    }
                }
            }

            /* If we stand at the post padded CR, we have fragmented input so try again later.
             * A real CR in the input here means the method was never followed by SP. */
            if (data[0] == '\r') {
                if (data < end) {
                    return ConsumeRequestLineResult::error(HTTP_HEADER_PARSER_ERROR_INVALID_METHOD);
                }
                return ConsumeRequestLineResult::shortRead(false, isConnect);
            }

            if (data[0] == 32) {
                switch (isHTTPorHTTPSPrefixForProxies(data + 1, end)) {
                    // If we haven't received enough data to check if it's http:// or https://, let's try again later
                    case -1: {
                        /* -1 only means fewer than 8 bytes follow the SP. If one of them is a
                         * terminator (<= 32), the target is already complete and can never
                         * become http(s)://, so this is an invalid request, not a fragment. */
                        for (char *p = data + 1; p < end; p++) {
                            if (*(unsigned char *) p <= 32) {
                                return ConsumeRequestLineResult::error(HTTP_HEADER_PARSER_ERROR_INVALID_REQUEST);
                            }
                        }
                        return ConsumeRequestLineResult::shortRead(false, isConnect);
                    }
                    // Otherwise, if it's not http:// or https://, return 400
                    default:
                        return ConsumeRequestLineResult::error(HTTP_HEADER_PARSER_ERROR_INVALID_REQUEST);
                }
            }

            return ConsumeRequestLineResult::error(HTTP_HEADER_PARSER_ERROR_INVALID_HTTP_VERSION);
        }

        /* RFC 9110: 5.5 Field Values (TLDR; anything above 31 is allowed; htab (9) is also allowed)
        * Field values are usually constrained to the range of US-ASCII characters [...]
        * Field values containing CR, LF, or NUL characters are invalid and dangerous [...]
        * Field values containing other CTL characters are also invalid. */
        static inline char * tryConsumeFieldValue(char *p) {
            for (; true; p += 8) {
                uint64_t word;
                memcpy(&word, p, sizeof(uint64_t));
                if (hasLess(word, 32)) {
                    while (*(unsigned char *)p > 31) p++;
                    return p;
                }
            }
        }

        /* End is only used for the proxy parser. The HTTP parser recognizes "\ra" as invalid "\r\n" scan and breaks. */
        static HttpParserResult getHeaders(char *postPaddedBuffer, char *end, struct HttpRequest::Header *headers, void *reserved, bool &isAncientHTTP, bool &isConnectRequest, bool useStrictMethodValidation, bool useInsecureHTTPParser, uint64_t maxHeaderSize) {
            char *preliminaryKey, *preliminaryValue, *start = postPaddedBuffer;
            #ifdef UWS_WITH_PROXY
                /* ProxyParser is passed as reserved parameter */
                ProxyParser *pp = (ProxyParser *) reserved;

                /* Parse PROXY protocol */
                auto [done, offset] = pp->parse({postPaddedBuffer, (size_t) (end - postPaddedBuffer)});
                if (!done) {
                    /* We do not reset the ProxyParser (on filure) since it is tied to this
                    * connection, which is really only supposed to ever get one PROXY frame
                    * anyways. We do however allow multiple PROXY frames to be sent (overwrites former). */
                    return 0;
                } else {
                    /* We have consumed this data so skip it */
                    postPaddedBuffer += offset;
                }
            #else
                /* This one is unused */
                (void) reserved;
                (void) end;
            #endif

            /* It is critical for fallback buffering logic that we only return with success
            * if we managed to parse a complete HTTP request (minus data). Returning success
            * for PROXY means we can end up succeeding, yet leaving bytes in the fallback buffer
            * which is then removed, and our counters to flip due to overflow and we end up with a crash */

            /* The request line is different from the field names / field values */
            auto requestLineResult = consumeRequestLine(postPaddedBuffer, end, headers[0], useStrictMethodValidation, maxHeaderSize);

            if (requestLineResult.isErrorOrShortRead()) {
                /* Error - invalid request line */
                /* Assuming it is 505 HTTP Version Not Supported */
                switch (requestLineResult.headerParserError) {
                    case HTTP_HEADER_PARSER_ERROR_INVALID_HTTP_VERSION:
                        return HttpParserResult::error(HTTP_ERROR_505_HTTP_VERSION_NOT_SUPPORTED, HTTP_PARSER_ERROR_INVALID_HTTP_VERSION);
                    case HTTP_HEADER_PARSER_ERROR_INVALID_REQUEST:
                        return HttpParserResult::error(HTTP_ERROR_400_BAD_REQUEST, HTTP_PARSER_ERROR_INVALID_REQUEST);
                    case HTTP_HEADER_PARSER_ERROR_INVALID_METHOD:
                        return HttpParserResult::error(HTTP_ERROR_400_BAD_REQUEST, HTTP_PARSER_ERROR_INVALID_METHOD);
                    case HTTP_HEADER_PARSER_ERROR_REQUEST_HEADER_FIELDS_TOO_LARGE:
                        return HttpParserResult::error(HTTP_ERROR_431_REQUEST_HEADER_FIELDS_TOO_LARGE, HTTP_PARSER_ERROR_REQUEST_HEADER_FIELDS_TOO_LARGE);
                    case HTTP_HEADER_PARSER_ERROR_PAUSED_H2_UPGRADE:
                        return HttpParserResult::error(HTTP_ERROR_400_BAD_REQUEST, HTTP_PARSER_ERROR_PAUSED_H2_UPGRADE);
                    default: {
                        /* Short read */
                    }
                }
                return HttpParserResult::shortRead();
            }
            postPaddedBuffer = requestLineResult.position;

            if(requestLineResult.isAncientHTTP) {
                isAncientHTTP = true;
            }
            if(requestLineResult.isConnect) {
                isConnectRequest = true;
            }
            /* No request headers found */
            const char * headerStart = (headers[0].key.length() > 0) ? headers[0].key.data() : end;

            /* Check if we can see if headers follow or not */
            if (postPaddedBuffer + 2 > end) {
                /* Not enough data to check for \r\n */
                return HttpParserResult::shortRead();
            }

            /* Check for empty headers (no headers, just \r\n) */
            if (postPaddedBuffer[0] == '\r' && postPaddedBuffer[1] == '\n') {
                /* Valid request with no headers - write null terminator like the normal path */
                headers[1].key = std::string_view(nullptr, 0);
                return HttpParserResult::success((unsigned int) ((postPaddedBuffer + 2) - start));
            }

            headers++;

            for (unsigned int i = 1; i < UWS_HTTP_MAX_HEADERS_COUNT - 1; i++) {
                /* Lower case and consume the field name */
                preliminaryKey = postPaddedBuffer;
                postPaddedBuffer = consumeFieldName(postPaddedBuffer);
                headers->key = std::string_view(preliminaryKey, (size_t) (postPaddedBuffer - preliminaryKey));
                if(maxHeaderSize && (uintptr_t)(postPaddedBuffer - headerStart) > maxHeaderSize) {
                    return HttpParserResult::error(HTTP_ERROR_431_REQUEST_HEADER_FIELDS_TOO_LARGE, HTTP_PARSER_ERROR_REQUEST_HEADER_FIELDS_TOO_LARGE);
                }
                /* We should not accept whitespace between key and colon, so colon must foloow immediately */
                if (postPaddedBuffer[0] != ':') {
                    /* If we stand at the end, we are fragmented */
                    if (postPaddedBuffer == end) {
                        return HttpParserResult::shortRead();
                    }
                    /* Error: invalid chars in field name */
                    return HttpParserResult::error(HTTP_ERROR_400_BAD_REQUEST, HTTP_PARSER_ERROR_INVALID_HEADER_TOKEN);
                }
                /* RFC 9112 5.1: field-name is a non-empty token. An empty name would also
                 * collide with the end-of-headers sentinel and hide later headers from the
                 * Content-Length / Transfer-Encoding request-smuggling checks. */
                if (headers->key.length() == 0) {
                    return HttpParserResult::error(HTTP_ERROR_400_BAD_REQUEST, HTTP_PARSER_ERROR_INVALID_HEADER_TOKEN);
                }
                postPaddedBuffer++;

                preliminaryValue = postPaddedBuffer;
                /* The goal of this call is to find next "\r\n", or any invalid field value chars, fast */
                while (true) {
                    postPaddedBuffer = tryConsumeFieldValue(postPaddedBuffer);
                    const unsigned char stopByte = (unsigned char) postPaddedBuffer[0];
                    /* If this is not CR then we caught some stinky invalid char on the way */
                    if (stopByte != '\r') {
                        /* If TAB then keep searching */
                        if (stopByte == '\t') {
                            postPaddedBuffer++;
                            continue;
                        }
                        /* node:http insecureHTTPParser (llhttp lenient headers): control
                         * bytes other than NUL/CR/LF are accepted in field values. */
                        if (useInsecureHTTPParser && stopByte != '\0' && !isNewline(stopByte)) {
                            postPaddedBuffer++;
                            continue;
                        }
                        /* Error - invalid chars in field value */
                        return HttpParserResult::error(HTTP_ERROR_400_BAD_REQUEST, HTTP_PARSER_ERROR_INVALID_HEADER_TOKEN);
                    }
                    break;
                }
                if(maxHeaderSize && (uintptr_t)(postPaddedBuffer - headerStart) > maxHeaderSize) {
                    return HttpParserResult::error(HTTP_ERROR_431_REQUEST_HEADER_FIELDS_TOO_LARGE, HTTP_PARSER_ERROR_REQUEST_HEADER_FIELDS_TOO_LARGE);
                }
                if (end - postPaddedBuffer < 2) {
                    return HttpParserResult::shortRead();
                }
                /* We fence end[0] with \r, followed by end[1] being something that is "not \n", to signify "not found".
                    * This way we can have this one single check to see if we found \r\n WITHIN our allowed search space. */
                if (postPaddedBuffer[1] == '\n') {
                    /* Store this header, it is valid */
                    headers->value = std::string_view(preliminaryValue, (size_t) (postPaddedBuffer - preliminaryValue));
                    postPaddedBuffer += 2;
                    /* Trim trailing whitespace (SP, HTAB) per RFC 9110 Section 5.5 */
                    while (headers->value.length() && isHTTPHeaderValueWhitespace(headers->value.back())) {
                        headers->value.remove_suffix(1);
                    }

                    /* Trim initial whitespace (SP, HTAB) per RFC 9110 Section 5.5 */
                    while (headers->value.length() && isHTTPHeaderValueWhitespace(headers->value.front())) {
                        headers->value.remove_prefix(1);
                    }

                    if(maxHeaderSize && (uintptr_t)(postPaddedBuffer - headerStart) > maxHeaderSize) {
                        return HttpParserResult::error(HTTP_ERROR_431_REQUEST_HEADER_FIELDS_TOO_LARGE, HTTP_PARSER_ERROR_REQUEST_HEADER_FIELDS_TOO_LARGE);
                    }
                    headers++;

                    /* We definitely have at least one header (or request line), so check if we are done */
                    if (*postPaddedBuffer == '\r') {
                        if (postPaddedBuffer[1] == '\n') {
                            /* This cann take the very last header space */
                            headers->key = std::string_view(nullptr, 0);
                            return HttpParserResult::success((unsigned int) ((postPaddedBuffer + 2) - start));
                        } else {
                            /* \r\n\r plus non-\n letter is malformed request, or simply out of search space */
                            if (postPaddedBuffer + 1 < end) {
                                return HttpParserResult::error(HTTP_ERROR_400_BAD_REQUEST, HTTP_PARSER_ERROR_INVALID_REQUEST);
                            }
                            return HttpParserResult::shortRead();
                        }
                    }
                } else {

                    if(postPaddedBuffer[0] == '\r') {
                        /* A bare CR terminated the field value without a following LF
                         * (llhttp: HPE_LF_EXPECTED, "Missing expected LF after header value"). */
                        return HttpParserResult::error(HTTP_ERROR_400_BAD_REQUEST, HTTP_PARSER_ERROR_LF_EXPECTED);
                    }
                    /* We are either out of search space or this is a malformed request */
                    return HttpParserResult::shortRead();
                }
            }
            /* We ran out of header space, too large request */
            return HttpParserResult::error(HTTP_ERROR_431_REQUEST_HEADER_FIELDS_TOO_LARGE, HTTP_PARSER_ERROR_REQUEST_HEADER_FIELDS_TOO_LARGE);
        }

    /* This is the only caller of getHeaders and is thus the deepest part of the parser. */
    template <bool ConsumeMinimally, bool IsNodeHttp>
    HttpParserResult fenceAndConsumePostPadded(uint64_t maxHeaderSize, bool& isConnectRequest, bool requireHostHeader, bool useStrictMethodValidation, bool useInsecureHTTPParser, std::string *nodeHttpRequestTrailers, uint64_t *chunkedExtensionsByteCount, char *data, unsigned int length, void *user, void *reserved, HttpRequest *req, MoveOnlyFunction<void *(void *, HttpRequest *)> &requestHandler, MoveOnlyFunction<void *(void *, std::string_view, bool)> &dataHandler) {

        /* How much data we CONSUMED (to throw away) */
        unsigned int consumedTotal = 0;

        /* Fence two bytes past end of our buffer (buffer has post padded margins).
         * This is to always catch scan for \r but not for \r\n. */
        data[length] = '\r';
        data[length + 1] = 'a'; /* Anything that is not \n, to trigger "invalid request" */
        req->ancientHttp = false;
        for (;length;) {
            /* node:http server compat: an accepted Upgrade request whose body just
             * finished parsing switched this connection into tunnel mode (the data
             * handler set isConnectRequest when it saw the body fin). Everything
             * after the end of that message is opaque data for the 'upgrade'
             * listener's socket, never a pipelined HTTP request. */
            if (IsNodeHttp && isConnectRequest) [[unlikely]] {
                void *returnedUser = dataHandler(user, std::string_view(data, length), false);
                consumedTotal += length;
                return HttpParserResult::success(consumedTotal, returnedUser);
            }
            /* RFC 9112 2.2: ignore empty lines (CRLF) received prior to the
             * request-line, like Node/llhttp - e.g. a stray "\r\n" sent on an
             * idle keep-alive connection must not be treated as a bad request.
             * llhttp's s_start state loops on '\r' and '\n' independently, so a
             * leading bare LF (or bare CR) is also tolerated. Node-compat only:
             * Bun.serve keeps rejecting a request that does not start with the
             * request-line, so this leniency is not a Bun-native default. */
            if constexpr (IsNodeHttp) {
                if (isNewline((unsigned char) data[0])) [[unlikely]] {
                    /* The enclosing loop only runs while length is non-zero, so the
                     * first byte is known to be one; re-test only after advancing. */
                    do {
                        data += 1;
                        length -= 1;
                        consumedTotal += 1;
                    } while (length && isNewline((unsigned char) data[0]));
                    if (length == 0) {
                        break;
                    }
                }
            }
            auto result = getHeaders(data, data + length, req->headers, reserved, req->ancientHttp, isConnectRequest, useStrictMethodValidation, useInsecureHTTPParser, maxHeaderSize);
            if(result.isError()) {
                return result;
            }
            auto consumed = result.consumedBytes();
            /* Short read */
            if(!consumed) {
                return HttpParserResult::success(consumedTotal, user);
            }
            data += consumed;
            length -= consumed;
            consumedTotal += consumed;

            /* Even if we could parse it, check for length here as well */
            const uint64_t maxBufferedHeaderSize = maxHeaderSize ? maxHeaderSize : MAX_FALLBACK_SIZE;
            if (consumed > maxBufferedHeaderSize) {
                return HttpParserResult::error(HTTP_ERROR_431_REQUEST_HEADER_FIELDS_TOO_LARGE, HTTP_PARSER_ERROR_REQUEST_HEADER_FIELDS_TOO_LARGE);
            }

            /* Add all headers to bloom filter */
            req->bf.reset();

            for (HttpRequest::Header *h = req->headers; (++h)->key.length(); ) {
                req->bf.add(h->key);
            }
            /* node:http compat: a pipelined request behind one that forbade keep-alive is
             * never dispatched - node's parser is closed after that message and raises
             * HPE_CLOSED_CONNECTION ('clientError') on further bytes. The predicate is the
             * same one that marks the connection for close at dispatch (HttpContext). */
            if constexpr (IsNodeHttp) {
                if (nodeHttpSawConnectionClose) {
                    return HttpParserResult::error(HTTP_ERROR_400_BAD_REQUEST, HTTP_PARSER_ERROR_CLOSED_CONNECTION);
                }
                if (req->isAncient() || req->getHeader("connection").length() == 5) {
                    nodeHttpSawConnectionClose = true;
                }
            }
            /* RFC 9112 6.3
            * If a message is received with both a Transfer-Encoding and a Content-Length header field,
            * the Transfer-Encoding overrides the Content-Length. Such a message might indicate an attempt
            * to perform request smuggling (Section 11.2) or response splitting (Section 11.1) and
            * ought to be handled as an error. */
            /* RFC 9110 8.6 + RFC 9112 6.3: locate the Content-Length header and, in the
             * same pass, verify every Content-Length header carries the same non-empty
             * value. A single empty value or multiple differing values are ambiguous and
             * must be rejected to prevent request smuggling. The bloom filter short-circuits
             * the common "no Content-Length" case. */
            std::string_view contentLengthString;
            if (req->bf.mightHave("content-length")) {
                for (HttpRequest::Header *h = req->headers; (++h)->key.length(); ) {
                    if (h->key.length() == 14 && !strncasecmp(h->key.data(), "content-length", 14)) {
                        if (contentLengthString.data() == nullptr) {
                            if (h->value.length() == 0) {
                                return HttpParserResult::error(HTTP_ERROR_400_BAD_REQUEST, HTTP_PARSER_ERROR_INVALID_CONTENT_LENGTH);
                            }
                            contentLengthString = h->value;
                        } else if (h->value.length() != contentLengthString.length() ||
                                   strncmp(h->value.data(), contentLengthString.data(), contentLengthString.length())) {
                            return HttpParserResult::error(HTTP_ERROR_400_BAD_REQUEST, HTTP_PARSER_ERROR_INVALID_CONTENT_LENGTH);
                        }
                    }
                }
            }
            const auto contentLengthStringLen = contentLengthString.length();

            /* Check Transfer-Encoding header validity and conflicts */
            HttpRequest::TransferEncoding transferEncoding = req->getTransferEncoding();

            /* node:http compat: a Transfer-Encoding that names no chunked coding (e.g.
             * "chunkedchunked") and no Content-Length is rejected by llhttp only after
             * the request head completes - Node dispatches the 'request' first and the
             * error then surfaces through 'clientError'. The error is deferred until
             * after the request handler below; no body data is ever emitted. */
            bool deferredTransferEncodingError = IsNodeHttp && transferEncoding.has
                && !transferEncoding.invalid && !transferEncoding.chunked && !contentLengthStringLen;

            /* Bun.serve: no transfer coding other than chunked is implemented, so a
             * list that ends in chunked but also names another coding ("gzip, chunked",
             * "x, chunked", two TE fields) would hand the still-encoded body to the
             * app. Reject it. node:http keeps llhttp's behaviour (accepts the list,
             * body remains un-decoded for the other coding). */
            transferEncoding.invalid = transferEncoding.invalid
                || (transferEncoding.has && (contentLengthStringLen || !transferEncoding.chunked))
                || (!IsNodeHttp && transferEncoding.multipleCodings);

            if (transferEncoding.invalid && !deferredTransferEncodingError) [[unlikely]] {
                /* Invalid Transfer-Encoding (multiple headers or chunked not last - request smuggling attempt) */
                return HttpParserResult::error(HTTP_ERROR_400_BAD_REQUEST, HTTP_PARSER_ERROR_INVALID_TRANSFER_ENCODING);
            }

            /* Break if no host header (but we can have empty string which is different from nullptr).
             * Upgrade and CONNECT requests are exempt: Node.js dispatches them through the
             * 'upgrade'/'connect' events before its Host requirement is enforced.
             * Checked after the Content-Length / Transfer-Encoding smuggling checks: those are
             * detected while llhttp parses the headers, whereas the Host requirement is a
             * post-completion check, so on doubly-invalid input the framing error wins (Node
             * reports e.g. HPE_INVALID_TRANSFER_ENCODING for such requests). */
            if (!req->ancientHttp && requireHostHeader && !req->getHeader("host").data()
                && !isConnectRequest && !req->getHeader("upgrade").data()) {
                return HttpParserResult::error(HTTP_ERROR_400_BAD_REQUEST, HTTP_PARSER_ERROR_MISSING_HOST_HEADER);
            }

            /* Parse query */
            const char *querySeparatorPtr = (const char *) memchr(req->headers->value.data(), '?', req->headers->value.length());
            req->querySeparator = (unsigned int) ((querySeparatorPtr ? querySeparatorPtr : req->headers->value.data() + req->headers->value.length()) - req->headers->value.data());

            // lets check if content len is valid before calling requestHandler
            if(contentLengthStringLen) {
                remainingStreamingBytes = toUnsignedInteger(contentLengthString);
                /* remainingStreamingBytes is overloaded: for Content-Length it holds the raw byte
                 * count, for Transfer-Encoding: chunked it holds the ChunkedEncoding state word.
                 * isParsingChunkedEncoding() distinguishes the two by testing the flag bits, so a
                 * Content-Length value must never reach a flag bit. UINT64_MAX (parse error) is
                 * also caught by this since UINT64_MAX > STATE_SIZE_MASK. */
                if (remainingStreamingBytes > STATE_SIZE_MASK) [[unlikely]] {
                    return HttpParserResult::error(HTTP_ERROR_400_BAD_REQUEST, HTTP_PARSER_ERROR_INVALID_CONTENT_LENGTH);
                }
            }

            /* If returned socket is not what we put in we need
             * to break here as we either have upgraded to
             * WebSockets or otherwise closed the socket. */
            /* Store any remaining data as head for Node.js compat (connect/upgrade events) */
            req->head = std::span<const char>(data, length);
            void *returnedUser = requestHandler(user, req);
            if (returnedUser != user) {
                /* We are upgraded to WebSocket or otherwise broken */
                return HttpParserResult::success(consumedTotal, returnedUser);
            }

            if (deferredTransferEncodingError) [[unlikely]] {
                /* The request was dispatched (like Node) but its body framing is
                 * invalid; fail now without consuming any body bytes. */
                return HttpParserResult::error(HTTP_ERROR_400_BAD_REQUEST, HTTP_PARSER_ERROR_INVALID_TRANSFER_ENCODING);
            }

            /* node:http compat: request-trailer state is per-request. Clear it for
             * every dispatched request (not only chunked ones) so a pipelined GET
             * cannot read the previous chunked request's trailers via
             * takeRequestTrailers() on this same connection. */
            if constexpr (IsNodeHttp) {
                nodeHttpRequestTrailers->clear();
            }

            /* The rules at play here according to RFC 9112 for requests are essentially:
             * If both content-length and transfer-encoding then invalid message; must break.
             * If has transfer-encoding then must be chunked regardless of value.
             * If content-length then fixed length even if 0.
             * If none of the above then fixed length is 0. */

            /* RFC 9112 6.3
             * If a message is received with both a Transfer-Encoding and a Content-Length header field,
             * the Transfer-Encoding overrides the Content-Length. */
            if (isConnectRequest) {
                // This only serves to mark that the connect request read all headers
                // and can start emitting data. Don't try to parse remaining data as HTTP -
                // it's pipelined data that we've already captured in req->head.
                remainingStreamingBytes = STATE_IS_CHUNKED;
                // Mark remaining data as consumed and break - it's not HTTP
                consumedTotal += length;
                break;
            } else if (transferEncoding.has) {
                /* We already validated that chunked is last if present, before calling the handler */
                remainingStreamingBytes = STATE_IS_CHUNKED;
                *chunkedExtensionsByteCount = 0;
                /* If consume minimally, we do not want to consume anything but we want to mark this as being chunked */
                if constexpr (!ConsumeMinimally) {
                    /* Go ahead and parse it (todo: better heuristics for emitting FIN to the app level) */
                    std::string_view dataToConsume(data, length);
                    for (auto chunk : uWS::ChunkIterator(&dataToConsume, &remainingStreamingBytes, false, chunkedExtensionsByteCount, nodeHttpRequestTrailers, maxBufferedHeaderSize)) {
                        /* llhttp errors at the offending extension byte, before any body bytes from
                         * that chunk reach the application; check before every dispatch. */
                        if (*chunkedExtensionsByteCount > MAX_CHUNK_EXTENSION_SIZE) [[unlikely]] {
                            return HttpParserResult::error(HTTP_ERROR_413_PAYLOAD_TOO_LARGE, HTTP_PARSER_ERROR_CHUNK_EXTENSIONS_OVERFLOW);
                        }
                        /* The fin dispatch completes the message: a malformed or
                         * framing-field trailer must fail it first (node: HPE_*). */
                        if (IsNodeHttp && chunk.length() == 0) {
                            if (HttpParserError trailerError = validateNodeTrailerSection(nodeHttpRequestTrailers, useInsecureHTTPParser)) [[unlikely]] {
                                return HttpParserResult::error(HTTP_ERROR_400_BAD_REQUEST, trailerError);
                            }
                        }
                        void *returnedUser = dataHandler(user, chunk, chunk.length() == 0);
                        if (returnedUser != user) {
                            /* The data handler closed or shut down the socket; stop parsing
                             * so we do not dispatch pipelined requests on a dead socket. */
                            return HttpParserResult::success(consumedTotal, returnedUser);
                        }
                    }
                    if (*chunkedExtensionsByteCount > MAX_CHUNK_EXTENSION_SIZE) [[unlikely]] {
                        return HttpParserResult::error(HTTP_ERROR_413_PAYLOAD_TOO_LARGE, HTTP_PARSER_ERROR_CHUNK_EXTENSIONS_OVERFLOW);
                    }
                    if (isParsingInvalidChunkedEncoding(remainingStreamingBytes)) [[unlikely]] {
                        // TODO: what happen if we already responded?
                        if (isTrailerOverflow(remainingStreamingBytes)) {
                            return HttpParserResult::error(HTTP_ERROR_431_REQUEST_HEADER_FIELDS_TOO_LARGE, HTTP_PARSER_ERROR_TRAILER_FIELDS_TOO_LARGE);
                        }
                        if (isChunkTerminatorError(remainingStreamingBytes)) {
                            return HttpParserResult::error(HTTP_ERROR_400_BAD_REQUEST, HTTP_PARSER_ERROR_CHUNK_TERMINATOR_EXPECTED);
                        }
                        return HttpParserResult::error(HTTP_ERROR_400_BAD_REQUEST, HTTP_PARSER_ERROR_INVALID_CHUNKED_ENCODING);
                    }
                    unsigned int consumed = (length - (unsigned int) dataToConsume.length());
                    data = (char *) dataToConsume.data();
                    length = (unsigned int) dataToConsume.length();
                    consumedTotal += consumed;
                }
            } else if (contentLengthStringLen) {
                if constexpr (!ConsumeMinimally) {
                    unsigned int emittable = (unsigned int) std::min<uint64_t>(remainingStreamingBytes, length);
                    void *returnedUser = dataHandler(user, std::string_view(data, emittable), emittable == remainingStreamingBytes);
                    remainingStreamingBytes -= emittable;

                    data += emittable;
                    length -= emittable;
                    consumedTotal += emittable;

                    if (returnedUser != user) {
                        return HttpParserResult::success(consumedTotal, returnedUser);
                    }
                }
            } else {
                /* If we came here without a body; emit an empty data chunk to signal no data */
                void *returnedUser = dataHandler(user, {}, true);
                if (returnedUser != user) {
                    return HttpParserResult::success(consumedTotal, returnedUser);
                }
            }

            /* Consume minimally should break as easrly as possible */
            if constexpr (ConsumeMinimally) {
                break;
            }
        }

        return HttpParserResult::success(consumedTotal, user);
    }

public:
    template <bool IsNodeHttp>
    HttpParserResult consumePostPadded(uint64_t maxHeaderSize, bool& isConnectRequest, bool requireHostHeader, bool useStrictMethodValidation, bool useInsecureHTTPParser, std::string *nodeHttpRequestTrailers, uint64_t *chunkedExtensionsByteCount, char *data, unsigned int length, void *user, void *reserved, MoveOnlyFunction<void *(void *, HttpRequest *)> &&requestHandler, MoveOnlyFunction<void *(void *, std::string_view, bool)> &&dataHandler) {
        /* The fallback buffer may not exceed the configured per-request header
         * limit (per-server maxHeaderSize can raise it above the default). */
        const size_t maxFallbackSize = maxHeaderSize ? (size_t) maxHeaderSize : MAX_FALLBACK_SIZE;
        /* This resets BloomFilter by construction, but later we also reset it again.
        * Optimize this to skip resetting twice (req could be made global) */
        HttpRequest req;
        if (remainingStreamingBytes) {
            if (isConnectRequest) {
                dataHandler(user, std::string_view(data, length), false);
                return HttpParserResult::success(0, user);
            } else if (isParsingChunkedEncoding(remainingStreamingBytes)) {
                 /* It's either chunked or with a content-length */
                std::string_view dataToConsume(data, length);
                for (auto chunk : uWS::ChunkIterator(&dataToConsume, &remainingStreamingBytes, false, chunkedExtensionsByteCount, nodeHttpRequestTrailers, maxFallbackSize)) {
                    if (*chunkedExtensionsByteCount > MAX_CHUNK_EXTENSION_SIZE) [[unlikely]] {
                        return HttpParserResult::error(HTTP_ERROR_413_PAYLOAD_TOO_LARGE, HTTP_PARSER_ERROR_CHUNK_EXTENSIONS_OVERFLOW);
                    }
                    /* The fin dispatch completes the message: a malformed or
                     * framing-field trailer must fail it first (node: HPE_*). */
                    if (IsNodeHttp && chunk.length() == 0) {
                        if (HttpParserError trailerError = validateNodeTrailerSection(nodeHttpRequestTrailers, useInsecureHTTPParser)) [[unlikely]] {
                            return HttpParserResult::error(HTTP_ERROR_400_BAD_REQUEST, trailerError);
                        }
                    }
                    void *returnedUser = dataHandler(user, chunk, chunk.length() == 0);
                    if (returnedUser != user) {
                        return HttpParserResult::success(0, returnedUser);
                    }
                }
                if (*chunkedExtensionsByteCount > MAX_CHUNK_EXTENSION_SIZE) [[unlikely]] {
                    return HttpParserResult::error(HTTP_ERROR_413_PAYLOAD_TOO_LARGE, HTTP_PARSER_ERROR_CHUNK_EXTENSIONS_OVERFLOW);
                }
                if (isParsingInvalidChunkedEncoding(remainingStreamingBytes)) {
                    if (isTrailerOverflow(remainingStreamingBytes)) {
                        return HttpParserResult::error(HTTP_ERROR_431_REQUEST_HEADER_FIELDS_TOO_LARGE, HTTP_PARSER_ERROR_TRAILER_FIELDS_TOO_LARGE);
                    }
                    if (isChunkTerminatorError(remainingStreamingBytes)) {
                        return HttpParserResult::error(HTTP_ERROR_400_BAD_REQUEST, HTTP_PARSER_ERROR_CHUNK_TERMINATOR_EXPECTED);
                    }
                    return HttpParserResult::error(HTTP_ERROR_400_BAD_REQUEST, HTTP_PARSER_ERROR_INVALID_CHUNKED_ENCODING);
                }
                data = (char *) dataToConsume.data();
                length = (unsigned int) dataToConsume.length();
            } else {

                // this is exactly the same as below!
                // todo: refactor this
                if (remainingStreamingBytes >= length) {
                    void *returnedUser = dataHandler(user, std::string_view(data, length), remainingStreamingBytes == length);
                    remainingStreamingBytes -= length;
                    return HttpParserResult::success(0, returnedUser);
                } else {
                    void *returnedUser = dataHandler(user, std::string_view(data, remainingStreamingBytes), true);

                    data += (unsigned int) remainingStreamingBytes;
                    length -= (unsigned int) remainingStreamingBytes;

                    remainingStreamingBytes = 0;

                    if (returnedUser != user) {
                        return HttpParserResult::success(0, returnedUser);
                    }
                }
            }

        } else if (fallback.length()) {
            unsigned int had = (unsigned int) fallback.length();

            size_t maxCopyDistance = std::min<size_t>(maxFallbackSize - fallback.length(), (size_t) length);

            /* We don't want fallback to be short string optimized, since we want to move it */
            fallback.reserve(fallback.length() + maxCopyDistance + std::max<unsigned int>(MINIMUM_HTTP_POST_PADDING, sizeof(std::string)));
            fallback.append(data, maxCopyDistance);

            // break here on break
            HttpParserResult consumed = fenceAndConsumePostPadded<true, IsNodeHttp>(maxHeaderSize, isConnectRequest, requireHostHeader, useStrictMethodValidation, useInsecureHTTPParser, nodeHttpRequestTrailers, chunkedExtensionsByteCount, fallback.data(), (unsigned int) fallback.length(), user, reserved, &req, requestHandler, dataHandler);
            /* Return data will be different than user if we are upgraded to WebSocket or have an error */
            if (consumed.returnedData != user) {
                return consumed;
            }
            /* safe to call consumed.consumedBytes() because consumed.returnedData == user */
            auto consumedBytes = consumed.consumedBytes();
            if (consumedBytes) {

                /* This logic assumes that we consumed everything in fallback buffer.
                * This is critically important, as we will get an integer overflow in case
                * of "had" being larger than what we consumed, and that we would drop data */
                fallback.clear();
                data += consumedBytes - had;
                length -= consumedBytes - had;

                if (remainingStreamingBytes) {
                    if(isConnectRequest) {
                        dataHandler(user, std::string_view(data, length), false);
                        return HttpParserResult::success(0, user);
                    } else if (isParsingChunkedEncoding(remainingStreamingBytes)) {
                        /* It's either chunked or with a content-length */
                        std::string_view dataToConsume(data, length);
                        for (auto chunk : uWS::ChunkIterator(&dataToConsume, &remainingStreamingBytes, false, chunkedExtensionsByteCount, nodeHttpRequestTrailers, maxFallbackSize)) {
                            if (*chunkedExtensionsByteCount > MAX_CHUNK_EXTENSION_SIZE) [[unlikely]] {
                                return HttpParserResult::error(HTTP_ERROR_413_PAYLOAD_TOO_LARGE, HTTP_PARSER_ERROR_CHUNK_EXTENSIONS_OVERFLOW);
                            }
                            /* The fin dispatch completes the message: a malformed or
                             * framing-field trailer must fail it first (node: HPE_*). */
                            if (IsNodeHttp && chunk.length() == 0) {
                                if (HttpParserError trailerError = validateNodeTrailerSection(nodeHttpRequestTrailers, useInsecureHTTPParser)) [[unlikely]] {
                                    return HttpParserResult::error(HTTP_ERROR_400_BAD_REQUEST, trailerError);
                                }
                            }
                            void *returnedUser = dataHandler(user, chunk, chunk.length() == 0);
                            if (returnedUser != user) {
                                return HttpParserResult::success(0, returnedUser);
                            }
                        }
                        if (*chunkedExtensionsByteCount > MAX_CHUNK_EXTENSION_SIZE) [[unlikely]] {
                            return HttpParserResult::error(HTTP_ERROR_413_PAYLOAD_TOO_LARGE, HTTP_PARSER_ERROR_CHUNK_EXTENSIONS_OVERFLOW);
                        }
                        if (isParsingInvalidChunkedEncoding(remainingStreamingBytes)) {
                            if (isTrailerOverflow(remainingStreamingBytes)) {
                                return HttpParserResult::error(HTTP_ERROR_431_REQUEST_HEADER_FIELDS_TOO_LARGE, HTTP_PARSER_ERROR_TRAILER_FIELDS_TOO_LARGE);
                            }
                            if (isChunkTerminatorError(remainingStreamingBytes)) {
                                return HttpParserResult::error(HTTP_ERROR_400_BAD_REQUEST, HTTP_PARSER_ERROR_CHUNK_TERMINATOR_EXPECTED);
                            }
                            return HttpParserResult::error(HTTP_ERROR_400_BAD_REQUEST, HTTP_PARSER_ERROR_INVALID_CHUNKED_ENCODING);
                        }
                        data = (char *) dataToConsume.data();
                        length = (unsigned int) dataToConsume.length();
                    } else {
                        // this is exactly the same as above!
                        if (remainingStreamingBytes >= (unsigned int) length) {
                            void *returnedUser = dataHandler(user, std::string_view(data, length), remainingStreamingBytes == (unsigned int) length);
                            remainingStreamingBytes -= length;
                            return HttpParserResult::success(0, returnedUser);
                        } else {
                            void *returnedUser = dataHandler(user, std::string_view(data, remainingStreamingBytes), true);

                            data += (unsigned int) remainingStreamingBytes;
                            length -= (unsigned int) remainingStreamingBytes;

                            remainingStreamingBytes = 0;

                            if (returnedUser != user) {
                                return HttpParserResult::success(0, returnedUser);
                            }
                        }
                    }
                }

            } else {
                if (fallback.length() == maxFallbackSize) {
                    return HttpParserResult::error(HTTP_ERROR_431_REQUEST_HEADER_FIELDS_TOO_LARGE, HTTP_PARSER_ERROR_REQUEST_HEADER_FIELDS_TOO_LARGE);
                }
                return HttpParserResult::success(0, user);
            }
        }

        HttpParserResult consumed = fenceAndConsumePostPadded<false, IsNodeHttp>(maxHeaderSize, isConnectRequest, requireHostHeader, useStrictMethodValidation, useInsecureHTTPParser, nodeHttpRequestTrailers, chunkedExtensionsByteCount, data, length, user, reserved, &req, requestHandler, dataHandler);
        /* Return data will be different than user if we are upgraded to WebSocket or have an error */
        if (consumed.returnedData != user) {
            return consumed;
        }
        /* safe to call consumed.consumedBytes() because consumed.returnedData == user */
        auto consumedBytes = consumed.consumedBytes();

        data += consumedBytes;
        length -= consumedBytes;

        if (length) {
            if (length < maxFallbackSize) {
                fallback.append(data, length);
            } else {
                return HttpParserResult::error(HTTP_ERROR_431_REQUEST_HEADER_FIELDS_TOO_LARGE, HTTP_PARSER_ERROR_REQUEST_HEADER_FIELDS_TOO_LARGE);
            }
        }

        // added for now
        return HttpParserResult::success(0, user);
    }
};

}
