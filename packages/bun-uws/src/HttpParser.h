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

    /* We require at least this much post padding */
    static const unsigned int MINIMUM_HTTP_POST_PADDING = 32;

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
    };


    enum HTTPHeaderParserError: uint8_t {
        HTTP_HEADER_PARSER_ERROR_NONE = 0,
        HTTP_HEADER_PARSER_ERROR_INVALID_HTTP_VERSION = 1,
        HTTP_HEADER_PARSER_ERROR_INVALID_REQUEST = 2,
        HTTP_HEADER_PARSER_ERROR_INVALID_METHOD = 3,
        HTTP_HEADER_PARSER_ERROR_REQUEST_HEADER_FIELDS_TOO_LARGE = 4,
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
                    if (h->key.length() == lowerCasedHeader.length() && !strncmp(h->key.data(), lowerCasedHeader.data(), lowerCasedHeader.length()))
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
        };

        TransferEncoding getTransferEncoding()
        {
            TransferEncoding te;

            if (!bf.mightHave("transfer-encoding")) {
                return te;
            }

            for (Header *h = headers; (++h)->key.length();) {
                if (h->key.length() == 17 && !strncmp(h->key.data(), "transfer-encoding", 17)) {
                    // Parse comma-separated values, ensuring "chunked" is last if present
                    const auto value = h->value;
                    size_t pos = 0;
                    size_t lastTokenStart = 0;
                    size_t lastTokenLen = 0;

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
                            lastTokenStart = tokenStart;
                            lastTokenLen = tokenLen;
                        }

                        // Move past comma if present
                        if (pos < value.length() && value[pos] == ',') {
                            pos++;
                        }
                    }

                    if (te.chunked) [[unlikely]] {
                        te.invalid = true;
                        return te;
                    }

                    te.has = lastTokenLen > 0;

                    // Check if the last token is "chunked"
                    if (lastTokenLen == 7 && strncasecmp(value.data() + lastTokenStart, "chunked", 7) == 0) [[likely]] {
                        te.chunked = true;
                    }
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

    private:
        std::string fallback;
         /* This guy really has only 30 bits since we reserve two highest bits to chunked encoding parsing state */
        uint64_t remainingStreamingBytes = 0;

        const size_t MAX_FALLBACK_SIZE = BUN_DEFAULT_MAX_HTTP_HEADER_SIZE;

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

        static inline bool isFieldNameByteFastLowercased(unsigned char &in) {
            /* Most common is lowercase alpha and hyphen */
            if (((in >= 97) & (in <= 122)) | (in == '-')) [[likely]] {
                return true;
            /* Second is upper case alpha */
            } else if ((in >= 65) & (in <= 90)) [[unlikely]] {
                in |= 32;
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
                    *p |= 32;
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
            while (isFieldNameByteFastLowercased(*(unsigned char *)p)) {
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
                data++;

            }
            if(start == data)  [[unlikely]] {
                return ConsumeRequestLineResult::error(HTTP_HEADER_PARSER_ERROR_INVALID_METHOD);
            }
            if (data - start < 2) [[unlikely]] {
                return ConsumeRequestLineResult::shortRead();
            }


            bool isHTTPMethod = (__builtin_expect(data[1] == '/', 1));
            bool isConnect = !isHTTPMethod && (isHTTPorHTTPSPrefixForProxies(data + 1, end) == 1 || ((data - start) == 7 && memcmp(start, "CONNECT", 7) == 0));
            if (isHTTPMethod || isConnect) [[likely]] {
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
                        /* If we stand at the post padded CR, we have fragmented input so try again later */
                        if (data[0] == '\r') {
                            return ConsumeRequestLineResult::shortRead(false, isConnect);
                        }
                        /* This is an error */
                        return ConsumeRequestLineResult::error(HTTP_HEADER_PARSER_ERROR_INVALID_HTTP_VERSION);
                    }
                }
            }

            /* If we stand at the post padded CR, we have fragmented input so try again later */
            if (data[0] == '\r') {
                return ConsumeRequestLineResult::shortRead(false, isConnect);
            }

            if (data[0] == 32) {
                switch (isHTTPorHTTPSPrefixForProxies(data + 1, end)) {
                    // If we haven't received enough data to check if it's http:// or https://, let's try again later
                    case -1:
                        return ConsumeRequestLineResult::shortRead(false, isConnect);
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
        static HttpParserResult getHeaders(char *postPaddedBuffer, char *end, struct HttpRequest::Header *headers, void *reserved, bool &isAncientHTTP, bool &isConnectRequest, bool useStrictMethodValidation, uint64_t maxHeaderSize) {
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
                /* Valid request with no headers */
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
                postPaddedBuffer++;

                preliminaryValue = postPaddedBuffer;
                /* The goal of this call is to find next "\r\n", or any invalid field value chars, fast */
                while (true) {
                    postPaddedBuffer = tryConsumeFieldValue(postPaddedBuffer);
                    /* If this is not CR then we caught some stinky invalid char on the way */
                    if (postPaddedBuffer[0] != '\r') {
                        /* If TAB then keep searching */
                        if (postPaddedBuffer[0] == '\t') {
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
                    /* Trim trailing whitespace (SP, HTAB) */
                    while (headers->value.length() && headers->value.back() < 33) {
                        headers->value.remove_suffix(1);
                    }

                    /* Trim initial whitespace (SP, HTAB) */
                    while (headers->value.length() && headers->value.front() < 33) {
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
                        // invalid char after \r
                        return HttpParserResult::error(HTTP_ERROR_400_BAD_REQUEST, HTTP_PARSER_ERROR_INVALID_REQUEST);
                    }
                    /* We are either out of search space or this is a malformed request */
                    return HttpParserResult::shortRead();
                }
            }
            /* We ran out of header space, too large request */
            return HttpParserResult::error(HTTP_ERROR_431_REQUEST_HEADER_FIELDS_TOO_LARGE, HTTP_PARSER_ERROR_REQUEST_HEADER_FIELDS_TOO_LARGE);
        }

    /* This is the only caller of getHeaders and is thus the deepest part of the parser. */
    template <bool ConsumeMinimally>
    HttpParserResult fenceAndConsumePostPadded(uint64_t maxHeaderSize, bool& isConnectRequest, bool requireHostHeader, bool useStrictMethodValidation, char *data, unsigned int length, void *user, void *reserved, HttpRequest *req, MoveOnlyFunction<void *(void *, HttpRequest *)> &requestHandler, MoveOnlyFunction<void *(void *, std::string_view, bool)> &dataHandler) {

        /* How much data we CONSUMED (to throw away) */
        unsigned int consumedTotal = 0;

        /* Fence two bytes past end of our buffer (buffer has post padded margins).
         * This is to always catch scan for \r but not for \r\n. */
        data[length] = '\r';
        data[length + 1] = 'a'; /* Anything that is not \n, to trigger "invalid request" */
        req->ancientHttp = false;
        for (;length;) {
            auto result = getHeaders(data, data + length, req->headers, reserved, req->ancientHttp, isConnectRequest, useStrictMethodValidation, maxHeaderSize);
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
            if (consumed > MAX_FALLBACK_SIZE) {
                return HttpParserResult::error(HTTP_ERROR_431_REQUEST_HEADER_FIELDS_TOO_LARGE, HTTP_PARSER_ERROR_REQUEST_HEADER_FIELDS_TOO_LARGE);
            }

            /* Add all headers to bloom filter */
            req->bf.reset();

            for (HttpRequest::Header *h = req->headers; (++h)->key.length(); ) {
                req->bf.add(h->key);
            }
            /* Break if no host header (but we can have empty string which is different from nullptr) */
            if (!req->ancientHttp && requireHostHeader && !req->getHeader("host").data()) {
                return HttpParserResult::error(HTTP_ERROR_400_BAD_REQUEST, HTTP_PARSER_ERROR_MISSING_HOST_HEADER);
            }

            /* RFC 9112 6.3
            * If a message is received with both a Transfer-Encoding and a Content-Length header field,
            * the Transfer-Encoding overrides the Content-Length. Such a message might indicate an attempt
            * to perform request smuggling (Section 11.2) or response splitting (Section 11.1) and
            * ought to be handled as an error. */
            const std::string_view contentLengthString = req->getHeader("content-length");
            const auto contentLengthStringLen = contentLengthString.length();

            /* Check Transfer-Encoding header validity and conflicts */
            HttpRequest::TransferEncoding transferEncoding = req->getTransferEncoding();

            transferEncoding.invalid = transferEncoding.invalid || (transferEncoding.has && (contentLengthStringLen || !transferEncoding.chunked));

            if (transferEncoding.invalid) [[unlikely]] {
                /* Invalid Transfer-Encoding (multiple headers or chunked not last - request smuggling attempt) */
                return HttpParserResult::error(HTTP_ERROR_400_BAD_REQUEST, HTTP_PARSER_ERROR_INVALID_TRANSFER_ENCODING);
            }

            /* Parse query */
            const char *querySeparatorPtr = (const char *) memchr(req->headers->value.data(), '?', req->headers->value.length());
            req->querySeparator = (unsigned int) ((querySeparatorPtr ? querySeparatorPtr : req->headers->value.data() + req->headers->value.length()) - req->headers->value.data());

            // lets check if content len is valid before calling requestHandler
            if(contentLengthStringLen) {
                remainingStreamingBytes = toUnsignedInteger(contentLengthString);
                if (remainingStreamingBytes == UINT64_MAX) [[unlikely]] {
                    /* Parser error */
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

            /* The rules at play here according to RFC 9112 for requests are essentially:
             * If both content-length and transfer-encoding then invalid message; must break.
             * If has transfer-encoding then must be chunked regardless of value.
             * If content-length then fixed length even if 0.
             * If none of the above then fixed length is 0. */

            /* RFC 9112 6.3
             * If a message is received with both a Transfer-Encoding and a Content-Length header field,
             * the Transfer-Encoding overrides the Content-Length. */
            if (transferEncoding.has) {
                /* We already validated that chunked is last if present, before calling the handler */
                remainingStreamingBytes = STATE_IS_CHUNKED;
                /* If consume minimally, we do not want to consume anything but we want to mark this as being chunked */
                if constexpr (!ConsumeMinimally) {
                    /* Go ahead and parse it (todo: better heuristics for emitting FIN to the app level) */
                    std::string_view dataToConsume(data, length);
                    for (auto chunk : uWS::ChunkIterator(&dataToConsume, &remainingStreamingBytes)) {
                        dataHandler(user, chunk, chunk.length() == 0);
                    }
                    if (isParsingInvalidChunkedEncoding(remainingStreamingBytes)) [[unlikely]] {
                        // TODO: what happen if we already responded?
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
                    dataHandler(user, std::string_view(data, emittable), emittable == remainingStreamingBytes);
                    remainingStreamingBytes -= emittable;

                    data += emittable;
                    length -= emittable;
                    consumedTotal += emittable;
                }
            } else if(isConnectRequest) {
                // This only serves to mark that the connect request read all headers
                // and can start emitting data. Don't try to parse remaining data as HTTP -
                // it's pipelined data that we've already captured in req->head.
                remainingStreamingBytes = STATE_IS_CHUNKED;
                // Mark remaining data as consumed and break - it's not HTTP
                consumedTotal += length;
                break;
            } else {
                /* If we came here without a body; emit an empty data chunk to signal no data */
                dataHandler(user, {}, true);
            }

            /* Consume minimally should break as easrly as possible */
            if constexpr (ConsumeMinimally) {
                break;
            }
        }

        return HttpParserResult::success(consumedTotal, user);
    }

public:
    HttpParserResult consumePostPadded(uint64_t maxHeaderSize, bool& isConnectRequest, bool requireHostHeader, bool useStrictMethodValidation, char *data, unsigned int length, void *user, void *reserved, MoveOnlyFunction<void *(void *, HttpRequest *)> &&requestHandler, MoveOnlyFunction<void *(void *, std::string_view, bool)> &&dataHandler) {
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
                for (auto chunk : uWS::ChunkIterator(&dataToConsume, &remainingStreamingBytes)) {
                    dataHandler(user, chunk, chunk.length() == 0);
                }
                if (isParsingInvalidChunkedEncoding(remainingStreamingBytes)) {
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

            size_t maxCopyDistance = std::min<size_t>(MAX_FALLBACK_SIZE - fallback.length(), (size_t) length);

            /* We don't want fallback to be short string optimized, since we want to move it */
            fallback.reserve(fallback.length() + maxCopyDistance + std::max<unsigned int>(MINIMUM_HTTP_POST_PADDING, sizeof(std::string)));
            fallback.append(data, maxCopyDistance);

            // break here on break
            HttpParserResult consumed = fenceAndConsumePostPadded<true>(maxHeaderSize, isConnectRequest, requireHostHeader, useStrictMethodValidation, fallback.data(), (unsigned int) fallback.length(), user, reserved, &req, requestHandler, dataHandler);
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
                        for (auto chunk : uWS::ChunkIterator(&dataToConsume, &remainingStreamingBytes)) {
                            dataHandler(user, chunk, chunk.length() == 0);
                        }
                        if (isParsingInvalidChunkedEncoding(remainingStreamingBytes)) {
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
                if (fallback.length() == MAX_FALLBACK_SIZE) {
                    return HttpParserResult::error(HTTP_ERROR_431_REQUEST_HEADER_FIELDS_TOO_LARGE, HTTP_PARSER_ERROR_REQUEST_HEADER_FIELDS_TOO_LARGE);
                }
                return HttpParserResult::success(0, user);
            }
        }

        HttpParserResult consumed = fenceAndConsumePostPadded<false>(maxHeaderSize, isConnectRequest, requireHostHeader, useStrictMethodValidation, data, length, user, reserved, &req, requestHandler, dataHandler);
        /* Return data will be different than user if we are upgraded to WebSocket or have an error */
        if (consumed.returnedData != user) {
            return consumed;
        }
        /* safe to call consumed.consumedBytes() because consumed.returnedData == user */
        auto consumedBytes = consumed.consumedBytes();

        data += consumedBytes;
        length -= consumedBytes;

        if (length) {
            if (length < MAX_FALLBACK_SIZE) {
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
