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

#include <cstdint>

namespace uWS {

/* RFC 9113 §8.2.2 / RFC 9114 §4.2: connection-specific fields are not
 * allowed in HTTP/2 or HTTP/3 responses. */
static inline bool asciiIEquals(std::string_view a, const char *lower) {
    for (size_t i = 0; i < a.size(); i++) if ((a[i] | 0x20) != lower[i]) return false;
    return true;
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
    char temp[20];
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
