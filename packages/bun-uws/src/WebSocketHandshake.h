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

#ifndef UWS_WEBSOCKETHANDSHAKE_H
#define UWS_WEBSOCKETHANDSHAKE_H

#include <cstdint>
#include <cstring>

#include <openssl/base64.h>
#include <openssl/sha.h>

namespace uWS {

struct WebSocketHandshake {
    /* Writes the Sec-WebSocket-Accept value for a Sec-WebSocket-Key (RFC 6455 4.2.2). Doesn't NUL-terminate output. */
    static inline void generate(const char input[24], char output[28]) {
        uint8_t keyAndGuid[24 + 36];
        memcpy(keyAndGuid, input, 24);
        memcpy(keyAndGuid + 24, "258EAFA5-E914-47DA-95CA-C5AB0DC85B11", 36);

        uint8_t digest[SHA_DIGEST_LENGTH];
        ::SHA1(keyAndGuid, sizeof(keyAndGuid), digest);

        /* EVP_EncodeBlock appends a NUL, which doesn't fit in output */
        uint8_t encoded[28 + 1];
        ::EVP_EncodeBlock(encoded, digest, sizeof(digest));
        memcpy(output, encoded, 28);
    }
};

}

#endif // UWS_WEBSOCKETHANDSHAKE_H
