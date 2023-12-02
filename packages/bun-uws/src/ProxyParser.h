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

/* This module implements The PROXY Protocol v2 */

#ifndef UWS_PROXY_PARSER_H
#define UWS_PROXY_PARSER_H

#ifdef UWS_WITH_PROXY

namespace uWS {

struct proxy_hdr_v2 {
    uint8_t sig[12];  /* hex 0D 0A 0D 0A 00 0D 0A 51 55 49 54 0A */
    uint8_t ver_cmd;  /* protocol version and command */
    uint8_t fam;      /* protocol family and address */
    uint16_t len;     /* number of following bytes part of the header */
};

union proxy_addr {
    struct {        /* for TCP/UDP over IPv4, len = 12 */
        uint32_t src_addr;
        uint32_t dst_addr;
        uint16_t src_port;
        uint16_t dst_port;
    } ipv4_addr;
    struct {        /* for TCP/UDP over IPv6, len = 36 */
            uint8_t  src_addr[16];
            uint8_t  dst_addr[16];
            uint16_t src_port;
            uint16_t dst_port;
    } ipv6_addr;
};

/* Byte swap for little-endian systems */
/* Todo: This functions should be shared with the one in WebSocketProtocol.h! */
template <typename T>
T _cond_byte_swap(T value) {
    uint32_t endian_test = 1;
    if (*((char *)&endian_test)) {
        union {
            T i;
            uint8_t b[sizeof(T)];
        } src = { value }, dst;

        for (unsigned int i = 0; i < sizeof(value); i++) {
            dst.b[i] = src.b[sizeof(value) - 1 - i];
        }

        return dst.i;
    }
    return value;
}

struct ProxyParser {
private:
    union proxy_addr addr;

    /* Default family of 0 signals no proxy address */
    uint8_t family = 0;

public:
    /* Returns 4 or 16 bytes source address */
    std::string_view getSourceAddress() {

        // UNSPEC family and protocol
        if (family == 0) {
            return {};
        }

        if ((family & 0xf0) >> 4 == 1) {
            /* Family 1 is INET4 */
            return {(char *) &addr.ipv4_addr.src_addr, 4};
        } else {
            /* Family 2 is INET6 */
            return {(char *) &addr.ipv6_addr.src_addr, 16};
        }
    }

    /* Returns [done, consumed] where done = false on failure */
    std::pair<bool, unsigned int> parse(std::string_view data) {

        /* We require at least four bytes to determine protocol */
        if (data.length() < 4) {
            return {false, 0};
        }

        /* HTTP can never start with "\r\n\r\n", but PROXY always does */
        if (memcmp(data.data(), "\r\n\r\n", 4)) {
            /* This is HTTP, so be done */
            return {true, 0};
        }

        /* We assume we are parsing PROXY V2 here */

        /* We require 16 bytes here */
        if (data.length() < 16) {
            return {false, 0};
        }

        /* Header is 16 bytes */
        struct proxy_hdr_v2 header;
        memcpy(&header, data.data(), 16);

        if (memcmp(header.sig, "\x0D\x0A\x0D\x0A\x00\x0D\x0A\x51\x55\x49\x54\x0A", 12)) {
            /* This is not PROXY protocol at all */
            return {false, 0};
        }

        /* We only support version 2 */
        if ((header.ver_cmd & 0xf0) >> 4 != 2) {
            return {false, 0};
        }

        //printf("Version: %d\n", (header.ver_cmd & 0xf0) >> 4);
        //printf("Command: %d\n", (header.ver_cmd & 0x0f));

        /* We get length in network byte order (todo: share this function with the rest) */
        uint16_t hostLength = _cond_byte_swap<uint16_t>(header.len);

        /* We must have all the data available */
        if (data.length() < 16u + hostLength) {
            return {false, 0};
        }

        /* Payload cannot be more than sizeof proxy_addr */
        if (sizeof(proxy_addr) < hostLength) {
            return {false, 0};
        }

        //printf("Family: %d\n", (header.fam & 0xf0) >> 4);
        //printf("Transport: %d\n", (header.fam & 0x0f));

        /* We have 0 family by default, and UNSPEC is 0 as well */
        family = header.fam;

        /* Copy payload */
        memcpy(&addr, data.data() + 16, hostLength);

        /* We consumed everything */
        return {true, 16 + hostLength};
    }
};

}

#endif

#endif // UWS_PROXY_PARSER_H