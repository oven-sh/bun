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

#ifndef UWS_UTILITIES_H
#define UWS_UTILITIES_H

#include <string_view>

/* Various common utilities */

#include <array>
#include <cstddef>
#include <cstdint>
#include <limits>

extern "C" int16_t Bun__HTTPMethod__from(const char *str, size_t len);

namespace uWS {

/* RFC 9113 §8.2.2 / RFC 9114 §4.2: connection-specific fields are not
 * allowed in HTTP/2 or HTTP/3 responses. */
static inline bool asciiIEquals(std::string_view a, const char *lower) {
    for (size_t i = 0; i < a.size(); i++) if ((a[i] | 0x20) != lower[i]) return false;
    return true;
}
/* RFC 9110 §10.1.1: the Expect field value is case-insensitive. */
static inline bool isExpect100Continue(std::string_view expect) {
    return expect.size() == 12 && asciiIEquals(expect, "100-continue");
}
/* RFC 9110 §5.6.2 tchar. */
inline constexpr std::array<bool, 256> tokenBytes = [] {
    std::array<bool, 256> table{};
    for (unsigned char c : std::string_view{"!#$%&'*+-.^_`|~0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"}) table[c] = true;
    return table;
}();
static inline bool isTokenByte(unsigned char c) {
    return tokenBytes[c];
}

/* RFC 9110 §9.1: method = token. */
static inline bool isToken(std::string_view s) {
    if (s.empty()) return false;
    for (unsigned char c : s) if (!isTokenByte(c)) return false;
    return true;
}

/* Returns true for the methods Bun.serve can represent, in their case-sensitive wire form (RFC 9110 §9.1). The table also has them in lowercase. */
static inline bool isKnownMethod(std::string_view method) {
    for (unsigned char c : method) if (!((c >= 'A' && c <= 'Z') || c == '-')) return false;
    return Bun__HTTPMethod__from(method.data(), method.size()) != -1;
}

/* RFC 9110 §8.6: 1*DIGIT. Returns UINT64_MAX for anything else, and for more than 18 digits. */
static inline uint64_t parseContentLength(std::string_view value) {
    if (value.empty() || value.length() > 18) return UINT64_MAX;
    uint64_t length = 0;
    for (char c : value) {
        if (c < '0' || c > '9') return UINT64_MAX;
        length = length * 10 + (uint64_t) (c - '0');
    }
    return length;
}

static inline bool isConnectionSpecificResponseField(std::string_view name, std::string_view value) {
    switch (name.size()) {
    case 2: return asciiIEquals(name, "te") && !(value.size() == 8 && asciiIEquals(value, "trailers"));
    case 7: return asciiIEquals(name, "upgrade");
    case 10: return asciiIEquals(name, "connection") || asciiIEquals(name, "keep-alive");
    case 16: return asciiIEquals(name, "proxy-connection");
    case 17: return asciiIEquals(name, "transfer-encoding");
    }
    return false;
}

namespace utils {

/* Decimal digits in the largest uint64_t (18446744073709551615). Sizes the
 * buffers u64toa and std::to_chars write into; neither appends a terminator. */
static constexpr size_t U64_MAX_DIGITS = std::numeric_limits<uint64_t>::digits10 + 1;

inline int u32toaHex(uint32_t value, char *dst) {
    char palette[] = "0123456789abcdef";
    char temp[10];
    char *p = temp;
    do {
        *p++ = palette[value % 16];
        value /= 16;
    } while (value > 0);

    int ret = (int) (p - temp);

    do {
        *dst++ = *--p;
    } while (p != temp);

    return ret;
}

inline int u64toa(uint64_t value, char *dst) {
    char temp[U64_MAX_DIGITS];
    char *p = temp;
    do {
        *p++ = (char) ((value % 10) + '0');
        value /= 10;
    } while (value > 0);

    int ret = (int) (p - temp);

    do {
        *dst++ = *--p;
    } while (p != temp);

    return ret;
}

}
}

#endif // UWS_UTILITIES_H
