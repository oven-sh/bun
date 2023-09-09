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

/* Implements the common parser (RFC 822) used in both HTTP and Multipart parsing */

#ifndef UWS_MESSAGE_PARSER_H
#define UWS_MESSAGE_PARSER_H

#include <string_view>
#include <utility>
#include <cstring>

/* For now we have this one here */
#define MAX_HEADERS 10

namespace uWS {

    // should be templated on whether it needs at lest one header (http), or not (multipart)
    static inline unsigned int getHeaders(char *postPaddedBuffer, char *end, std::pair<std::string_view, std::string_view> *headers) {
        char *preliminaryKey, *preliminaryValue, *start = postPaddedBuffer;

        for (unsigned int i = 0; i < MAX_HEADERS; i++) {
            for (preliminaryKey = postPaddedBuffer; (*postPaddedBuffer != ':') & (*(unsigned char *)postPaddedBuffer > 32); *(postPaddedBuffer++) |= 32);
            if (*postPaddedBuffer == '\r') {
                if ((postPaddedBuffer != end) & (postPaddedBuffer[1] == '\n') /* & (i > 0) */) { // multipart does not require any headers like http does
                    headers->first = std::string_view(nullptr, 0);
                    return (unsigned int) ((postPaddedBuffer + 2) - start);
                } else {
                    return 0;
                }
            } else {
                headers->first = std::string_view(preliminaryKey, (size_t) (postPaddedBuffer - preliminaryKey));
                for (postPaddedBuffer++; (*postPaddedBuffer == ':' || *(unsigned char *)postPaddedBuffer < 33) && *postPaddedBuffer != '\r'; postPaddedBuffer++);
                preliminaryValue = postPaddedBuffer;
                postPaddedBuffer = (char *) memchr(postPaddedBuffer, '\r', end - postPaddedBuffer);
                if (postPaddedBuffer && postPaddedBuffer[1] == '\n') {
                    headers->second = std::string_view(preliminaryValue, (size_t) (postPaddedBuffer - preliminaryValue));
                    postPaddedBuffer += 2;
                    headers++;
                } else {
                    return 0;
                }
            }
        }
        return 0;
    }

}

#endif