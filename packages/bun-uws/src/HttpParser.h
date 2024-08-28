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

#ifndef UWS_HTTPPARSER_H
#define UWS_HTTPPARSER_H

#ifndef UWS_HTTP_MAX_HEADERS_COUNT
#define UWS_HTTP_MAX_HEADERS_COUNT 100
#endif

// todo: HttpParser is in need of a few clean-ups and refactorings

/* The HTTP parser is an independent module subject to unit testing / fuzz testing */

#include <string>
#include <cstring>
#include <algorithm>
#include <climits>
#include <string_view>
#include <map>
#include "MoveOnlyFunction.h"
#include "ChunkedEncoding.h"

#include "BloomFilter.h"
#include "ProxyParser.h"
#include "QueryParser.h"

extern "C" size_t BUN_DEFAULT_MAX_HTTP_HEADER_SIZE;

namespace uWS
{

    /* We require at least this much post padding */
    static const unsigned int MINIMUM_HTTP_POST_PADDING = 32;
    static void *FULLPTR = (void *)~(uintptr_t)0;

    struct HttpRequest
    {

        friend struct HttpParser;

    private:
        struct Header
        {
            std::string_view key, value;
        } headers[UWS_HTTP_MAX_HEADERS_COUNT];
        bool ancientHttp;
        unsigned int querySeparator;
        bool didYield;
        BloomFilter bf;
        std::pair<int, std::string_view *> currentParameters;

    public:
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

        std::string_view getUrl()
        {
            return std::string_view(headers->value.data(), querySeparator);
        }

        std::string_view getFullUrl()
        {
            return std::string_view(headers->value.data(), headers->value.length());
        }

        /* Hack: this should be getMethod */
        std::string_view getCaseSensitiveMethod()
        {
            return std::string_view(headers->key.data(), headers->key.length());
        }

        std::string_view getMethod()
        {
            /* Compatibility hack: lower case method (todo: remove when major version bumps) */
            for (unsigned int i = 0; i < headers->key.length(); i++)
            {
                ((char *)headers->key.data())[i] |= 32;
            }

            return std::string_view(headers->key.data(), headers->key.length());
        }

        /* Returns the raw querystring as a whole, still encoded */
        std::string_view getQuery()
        {
            if (querySeparator < headers->value.length())
            {
                /* Strip the initial ? */
                return std::string_view(headers->value.data() + querySeparator + 1, headers->value.length() - querySeparator - 1);
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
            std::string_view queryString = std::string_view(headers->value.data() + querySeparator, headers->value.length() - querySeparator);

            return getDecodedQueryValue(key, queryString);
        }

        void setParameters(std::pair<int, std::string_view *> parameters)
        {
            currentParameters = parameters;
        }

        std::string_view getParameter(unsigned short index)
        {
            if (currentParameters.first < (int)index)
            {
                return {};
            }
            else
            {
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

        /* Returns UINT_MAX on error. Maximum 999999999 is allowed. */
        static uint64_t toUnsignedInteger(std::string_view str) {
            /* We assume at least 64-bit integer giving us safely 999999999999999999 (18 number of 9s) */
            if (str.length() > 18) {
                return UINT_MAX;
            }

            uint64_t unsignedIntegerValue = 0;
            for (char c : str) {
                /* As long as the letter is 0-9 we cannot overflow. */
                if (c < '0' || c > '9') {
                    return UINT_MAX;
                }
                unsignedIntegerValue = unsignedIntegerValue * 10ull + ((unsigned int) c - (unsigned int) '0');
            }
            return unsignedIntegerValue;
        }

        static inline uint64_t hasLess(uint64_t x, uint64_t n)
        {
            return (((x) - ~0ULL / 255 * (n)) & ~(x) & ~0ULL / 255 * 128);
        }

        static inline uint64_t hasMore(uint64_t x, uint64_t n)
        {
            return ((((x) + ~0ULL / 255 * (127 - (n))) | (x)) & ~0ULL / 255 * 128);
        }

        static inline uint64_t hasBetween(uint64_t x, uint64_t m, uint64_t n)
        {
            return (((~0ULL / 255 * (127 + (n)) - ((x) & ~0ULL / 255 * 127)) & ~(x) & (((x) & ~0ULL / 255 * 127) + ~0ULL / 255 * (127 - (m)))) & ~0ULL / 255 * 128);
        }

        static inline bool notFieldNameWord(uint64_t x)
        {
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
        
        static inline void *consumeFieldName(char *p) {
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
                    return (void *)p;
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
            return (void *)p;
        }

        /* Puts method as key, target as value and returns non-null (or nullptr on error). */
        static inline char *consumeRequestLine(char *data, HttpRequest::Header &header, bool *isAncientHttp)
        {
            /* Scan until single SP, assume next is not SP (origin request) */
            char *start = data;
            /* This catches the post padded CR and fails */
            while (data[0] > 32)
                data++;
            if (data[0] == 32 && data[1] != 32)
            {
                header.key = {start, (size_t)(data - start)};
                data++;
                /* Scan for less than 33 (catches post padded CR and fails) */
                start = data;
                for (; true; data += 8)
                {
                    uint64_t word;
                    memcpy(&word, data, sizeof(uint64_t));
                    if (hasLess(word, 33))
                    {
                        while (*(unsigned char *)data > 32)
                            data++;
                        /* Now we stand on space */
                        header.value = {start, (size_t)(data - start)};
                        /* Check that the following is http 1.1 */
                        if (memcmp(" HTTP/1.1\r\n", data, 11) == 0)
                        {
                            *isAncientHttp = false;
                            return data + 11;
                        }
                        /* Check that the following is ancient http 1.0 */
                        if (memcmp(" HTTP/1.0\r\n", data, 11) == 0)
                        {
                            *isAncientHttp = true;
                            return data + 11;
                        }
                        return nullptr;
                    }
                }
            }
            return nullptr;
        }

        /* RFC 9110: 5.5 Field Values (TLDR; anything above 31 is allowed; htab (9) is also allowed)
         * Field values are usually constrained to the range of US-ASCII characters [...]
         * Field values containing CR, LF, or NUL characters are invalid and dangerous [...]
         * Field values containing other CTL characters are also invalid. */
        static inline void *tryConsumeFieldValue(char *p)
        {
            for (; true; p += 8)
            {
                uint64_t word;
                memcpy(&word, p, sizeof(uint64_t));
                if (hasLess(word, 32))
                {
                    while (*(unsigned char *)p > 31)
                        p++;
                    return (void *)p;
                }
            }
        }


    /* End is only used for the proxy parser. The HTTP parser recognizes "\ra" as invalid "\r\n" scan and breaks. */
    static unsigned int getHeaders(char *postPaddedBuffer, char *end, struct HttpRequest::Header *headers, void *reserved, bool*isAncientHttp) {
        char *preliminaryKey, *preliminaryValue, *start = postPaddedBuffer;

#ifdef UWS_WITH_PROXY
            /* ProxyParser is passed as reserved parameter */
            ProxyParser *pp = (ProxyParser *)reserved;

            /* Parse PROXY protocol */
            auto [done, offset] = pp->parse({start, (size_t)(end - postPaddedBuffer)});
            if (!done)
            {
                /* We do not reset the ProxyParser (on filure) since it is tied to this
                 * connection, which is really only supposed to ever get one PROXY frame
                 * anyways. We do however allow multiple PROXY frames to be sent (overwrites former). */
                return 0;
            }
            else
            {
                /* We have consumed this data so skip it */
                start += offset;
            }
#else
            /* This one is unused */
            (void)reserved;
            (void)end;
#endif

            /* It is critical for fallback buffering logic that we only return with success
             * if we managed to parse a complete HTTP request (minus data). Returning success
             * for PROXY means we can end up succeeding, yet leaving bytes in the fallback buffer
             * which is then removed, and our counters to flip due to overflow and we end up with a crash */

            /* The request line is different from the field names / field values */
            if (!(postPaddedBuffer = consumeRequestLine(postPaddedBuffer, headers[0], isAncientHttp)))
            {
                /* Error - invalid request line */

                return 0;
            }
            headers++;

            for (unsigned int i = 1; i < UWS_HTTP_MAX_HEADERS_COUNT - 1; i++)
            {
                /* Lower case and consume the field name */
                preliminaryKey = postPaddedBuffer;
                postPaddedBuffer = (char *)consumeFieldName(postPaddedBuffer);
                headers->key = std::string_view(preliminaryKey, (size_t)(postPaddedBuffer - preliminaryKey));

                /* We should not accept whitespace between key and colon, so colon must foloow immediately */
                if (postPaddedBuffer[0] != ':')
                {
                    /* Error: invalid chars in field name */
                    return 0;
                }
                postPaddedBuffer++;

                preliminaryValue = postPaddedBuffer;
                /* The goal of this call is to find next "\r\n", or any invalid field value chars, fast */
                while (true)
                {
                    postPaddedBuffer = (char *)tryConsumeFieldValue(postPaddedBuffer);
                    /* If this is not CR then we caught some stinky invalid char on the way */
                    if (postPaddedBuffer[0] != '\r')
                    {
                        /* If TAB then keep searching */
                        if (postPaddedBuffer[0] == '\t')
                        {
                            postPaddedBuffer++;
                            continue;
                        }
                        /* Error - invalid chars in field value */
                        return 0;
                    }
                    break;
                }
                /* We fence end[0] with \r, followed by end[1] being something that is "not \n", to signify "not found".
                 * This way we can have this one single check to see if we found \r\n WITHIN our allowed search space. */
                if (postPaddedBuffer[1] == '\n')
                {
                    /* Store this header, it is valid */
                    headers->value = std::string_view(preliminaryValue, (size_t)(postPaddedBuffer - preliminaryValue));
                    postPaddedBuffer += 2;

                    /* Trim trailing whitespace (SP, HTAB) */
                    while (headers->value.length() && headers->value.back() < 33)
                    {
                        headers->value.remove_suffix(1);
                    }

                    /* Trim initial whitespace (SP, HTAB) */
                    while (headers->value.length() && headers->value.front() < 33)
                    {
                        headers->value.remove_prefix(1);
                    }

                    headers++;

                    /* We definitely have at least one header (or request line), so check if we are done */
                    if (*postPaddedBuffer == '\r')
                    {
                        if (postPaddedBuffer[1] == '\n')
                        {
                            /* This cann take the very last header space */
                            headers->key = std::string_view(nullptr, 0);
                            return (unsigned int)((postPaddedBuffer + 2) - start);
                        }
                        else
                        {
                            /* \r\n\r plus non-\n letter is malformed request, or simply out of search space */
                            return 0;
                        }
                    }
                }
                else
                {
                    /* We are either out of search space or this is a malformed request */
                    return 0;
                }
            }
            /* We ran out of header space, too large request */
            return 0;
        }


        /* This is the only caller of getHeaders and is thus the deepest part of the parser.
         * From here we return either [consumed, user] for "keep going",
         * or [consumed, nullptr] for "break; I am closed or upgraded to websocket"
         * or [whatever, fullptr] for "break and close me, I am a parser error!" */
        template<int CONSUME_MINIMALLY>
        std::pair<unsigned int, void *> fenceAndConsumePostPadded(char *data, unsigned int length, void *user, void *reserved, HttpRequest *req, MoveOnlyFunction<void *(void *, HttpRequest *)> &requestHandler, MoveOnlyFunction<void *(void *, std::string_view, bool)> &dataHandler)
        {

            /* How much data we CONSUMED (to throw away) */
            unsigned int consumedTotal = 0;

            /* Fence two bytes past end of our buffer (buffer has post padded margins).
             * This is to always catch scan for \r but not for \r\n. */
            data[length] = '\r';
            data[length + 1] = 'a'; /* Anything that is not \n, to trigger "invalid request" */
            bool isAncientHttp = false;
            for (unsigned int consumed; length && (consumed = getHeaders(data, data + length, req->headers, reserved, &isAncientHttp));)
            {
                data += consumed;
                length -= consumed;
                consumedTotal += consumed;

                /* Even if we could parse it, check for length here as well */
                if (consumed > MAX_FALLBACK_SIZE) {
                    return {0, FULLPTR};
                }

                /* Store HTTP version (ancient 1.0 or 1.1) */
                req->ancientHttp = isAncientHttp;

                /* Add all headers to bloom filter */
                req->bf.reset();
                for (HttpRequest::Header *h = req->headers; (++h)->key.length();)
                {
                    req->bf.add(h->key);
                }

                /* Break if no host header (but we can have empty string which is different from nullptr) */
                if (!req->getHeader("host").data())
                {
                    return {0, FULLPTR};
                }

                /* RFC 9112 6.3
                 * If a message is received with both a Transfer-Encoding and a Content-Length header field,
                 * the Transfer-Encoding overrides the Content-Length. Such a message might indicate an attempt
                 * to perform request smuggling (Section 11.2) or response splitting (Section 11.1) and
                 * ought to be handled as an error. */
                std::string_view transferEncodingString = req->getHeader("transfer-encoding");
                std::string_view contentLengthString = req->getHeader("content-length");
                if (transferEncodingString.length() && contentLengthString.length())
                {
                    /* Returning fullptr is the same as calling the errorHandler */
                    /* We could be smart and set an error in the context along with this, to indicate what
                     * http error response we might want to return */
                    return {0, FULLPTR};
                }

                /* Parse query */
                const char *querySeparatorPtr = (const char *)memchr(req->headers->value.data(), '?', req->headers->value.length());
                req->querySeparator = (unsigned int)((querySeparatorPtr ? querySeparatorPtr : req->headers->value.data() + req->headers->value.length()) - req->headers->value.data());

                /* If returned socket is not what we put in we need
                 * to break here as we either have upgraded to
                 * WebSockets or otherwise closed the socket. */
                void *returnedUser = requestHandler(user, req);
                if (returnedUser != user)
                {
                    /* We are upgraded to WebSocket or otherwise broken */
                    return {consumedTotal, returnedUser};
                }

                /* The rules at play here according to RFC 9112 for requests are essentially:
                 * If both content-length and transfer-encoding then invalid message; must break.
                 * If has transfer-encoding then must be chunked regardless of value.
                 * If content-length then fixed length even if 0.
                 * If none of the above then fixed length is 0. */

                /* RFC 9112 6.3
                 * If a message is received with both a Transfer-Encoding and a Content-Length header field,
                 * the Transfer-Encoding overrides the Content-Length. */
                if (transferEncodingString.length())
                {

                    /* If a proxy sent us the transfer-encoding header that 100% means it must be chunked or else the proxy is
                     * not RFC 9112 compliant. Therefore it is always better to assume this is the case, since that entirely eliminates
                     * all forms of transfer-encoding obfuscation tricks. We just rely on the header. */

                    /* RFC 9112 6.3
                     * If a Transfer-Encoding header field is present in a request and the chunked transfer coding is not the
                     * final encoding, the message body length cannot be determined reliably; the server MUST respond with the
                     * 400 (Bad Request) status code and then close the connection. */

                    /* In this case we fail later by having the wrong interpretation (assuming chunked).
                     * This could be made stricter but makes no difference either way, unless forwarding the identical message as a proxy. */

                    remainingStreamingBytes = STATE_IS_CHUNKED;
                    /* If consume minimally, we do not want to consume anything but we want to mark this as being chunked */
                    if (!CONSUME_MINIMALLY)
                    {
                        /* Go ahead and parse it (todo: better heuristics for emitting FIN to the app level) */
                        std::string_view dataToConsume(data, length);
                        for (auto chunk : uWS::ChunkIterator(&dataToConsume, &remainingStreamingBytes))
                        {
                            dataHandler(user, chunk, chunk.length() == 0);
                        }
                        if (isParsingInvalidChunkedEncoding(remainingStreamingBytes))
                        {
                            return {0, FULLPTR};
                        }
                        unsigned int consumed = (length - (unsigned int)dataToConsume.length());
                        data = (char *)dataToConsume.data();
                        length = (unsigned int)dataToConsume.length();
                        consumedTotal += consumed;
                    }
                }
                else if (contentLengthString.length())
                {
                    remainingStreamingBytes = toUnsignedInteger(contentLengthString);
                    if (remainingStreamingBytes == UINT_MAX)
                    {
                        /* Parser error */
                        return {0, FULLPTR};
                    }

                    if (!CONSUME_MINIMALLY)
                    {
                        unsigned int emittable = (unsigned int) std::min<uint64_t>(remainingStreamingBytes, length);
                        dataHandler(user, std::string_view(data, emittable), emittable == remainingStreamingBytes);
                        remainingStreamingBytes -= emittable;

                        data += emittable;
                        length -= emittable;
                        consumedTotal += emittable;
                    }
                }
                else
                {
                    /* If we came here without a body; emit an empty data chunk to signal no data */
                    dataHandler(user, {}, true);
                }

                /* Consume minimally should break as easrly as possible */
                if (CONSUME_MINIMALLY)
                {
                    break;
                }
            }
            return {consumedTotal, user};
        }

    public:
        void *consumePostPadded(char *data, unsigned int length, void *user, void *reserved, MoveOnlyFunction<void *(void *, HttpRequest *)> &&requestHandler, MoveOnlyFunction<void *(void *, std::string_view, bool)> &&dataHandler, MoveOnlyFunction<void *(void *)> &&errorHandler)
        {
            /* This resets BloomFilter by construction, but later we also reset it again.
             * Optimize this to skip resetting twice (req could be made global) */
            HttpRequest req;

            if (remainingStreamingBytes)
            {

                /* It's either chunked or with a content-length */
                if (isParsingChunkedEncoding(remainingStreamingBytes))
                {
                    std::string_view dataToConsume(data, length);
                    for (auto chunk : uWS::ChunkIterator(&dataToConsume, &remainingStreamingBytes))
                    {
                        dataHandler(user, chunk, chunk.length() == 0);
                    }
                    if (isParsingInvalidChunkedEncoding(remainingStreamingBytes))
                    {
                        return FULLPTR;
                    }
                    data = (char *)dataToConsume.data();
                    length = (unsigned int)dataToConsume.length();
                }
                else
                {
                    // this is exactly the same as below!
                    // todo: refactor this
                    if (remainingStreamingBytes >= length)
                    {
                        void *returnedUser = dataHandler(user, std::string_view(data, length), remainingStreamingBytes == length);
                        remainingStreamingBytes -= length;
                        return returnedUser;
                    }
                    else
                    {
                        void *returnedUser = dataHandler(user, std::string_view(data, remainingStreamingBytes), true);

                        data += (unsigned int) remainingStreamingBytes;
                        length -= (unsigned int) remainingStreamingBytes;

                        remainingStreamingBytes = 0;

                        if (returnedUser != user)
                        {
                            return returnedUser;
                        } else {
                            void *returnedUser = dataHandler(user, std::string_view(data, remainingStreamingBytes), true);

                            data += (unsigned int) remainingStreamingBytes;
                            length -= (unsigned int) remainingStreamingBytes;

                            remainingStreamingBytes = 0;

                            if (returnedUser != user) {
                                return returnedUser;
                            }
                        }
                    }
                }
            }
            else if (fallback.length())
            {
                unsigned int had = (unsigned int)fallback.length();

                size_t maxCopyDistance = std::min<size_t>(MAX_FALLBACK_SIZE - fallback.length(), (size_t)length);

                /* We don't want fallback to be short string optimized, since we want to move it */
                fallback.reserve(fallback.length() + maxCopyDistance + std::max<unsigned int>(MINIMUM_HTTP_POST_PADDING, sizeof(std::string)));
                fallback.append(data, maxCopyDistance);

                // break here on break
                std::pair<unsigned int, void *> consumed = fenceAndConsumePostPadded<true>(fallback.data(), (unsigned int)fallback.length(), user, reserved, &req, requestHandler, dataHandler);
                if (consumed.second != user)
                {
                    return consumed.second;
                }

                if (consumed.first)
                {

                    /* This logic assumes that we consumed everything in fallback buffer.
                     * This is critically important, as we will get an integer overflow in case
                     * of "had" being larger than what we consumed, and that we would drop data */
                    fallback.clear();
                    data += consumed.first - had;
                    length -= consumed.first - had;

                    if (remainingStreamingBytes)
                    {
                        /* It's either chunked or with a content-length */
                        if (isParsingChunkedEncoding(remainingStreamingBytes))
                        {
                            std::string_view dataToConsume(data, length);
                            for (auto chunk : uWS::ChunkIterator(&dataToConsume, &remainingStreamingBytes))
                            {
                                dataHandler(user, chunk, chunk.length() == 0);
                            }
                            if (isParsingInvalidChunkedEncoding(remainingStreamingBytes))
                            {
                                return FULLPTR;
                            }
                            data = (char *)dataToConsume.data();
                            length = (unsigned int)dataToConsume.length();
                        }
                        else
                        {
                            // this is exactly the same as above!
                            if (remainingStreamingBytes >= (unsigned int)length)
                            {
                                void *returnedUser = dataHandler(user, std::string_view(data, length), remainingStreamingBytes == (unsigned int)length);
                                remainingStreamingBytes -= length;
                                return returnedUser;
                            }
                            else
                            {
                                void *returnedUser = dataHandler(user, std::string_view(data, remainingStreamingBytes), true);

                                data += remainingStreamingBytes;
                                length -= remainingStreamingBytes;

                                remainingStreamingBytes = 0;

                                if (returnedUser != user)
                                {
                                    return returnedUser;
                                }
                            }
                        }
                    }
                }
                else
                {
                    if (fallback.length() == MAX_FALLBACK_SIZE)
                    {
                        // note: you don't really need error handler, just return something strange!
                        // we could have it return a constant pointer to denote error!
                        return errorHandler(user);
                    }
                    return user;
                }
            }

            std::pair<unsigned int, void *> consumed = fenceAndConsumePostPadded<false>(data, length, user, reserved, &req, requestHandler, dataHandler);
            if (consumed.second != user)
            {
                return consumed.second;
            }

            data += consumed.first;
            length -= consumed.first;

            if (length)
            {
                if (length < MAX_FALLBACK_SIZE)
                {
                    fallback.append(data, length);
                }
                else
                {
                    return errorHandler(user);
                }
            }

            // added for now
            return user;
        }
    };

}

#endif // UWS_HTTPPARSER_H
