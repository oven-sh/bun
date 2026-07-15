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

/* Various common utilities */

#include <cstdint>
#include <string_view>

namespace uWS {
namespace utils {

/* ASCII case-insensitive equality for header token matching (RFC 7230 §3.2.6).
 * Only the 26 ASCII letters are folded; all other bytes compare as-is. */
inline bool asciiIEquals(std::string_view a, std::string_view b) {
    if (a.size() != b.size()) return false;
    for (size_t i = 0; i < a.size(); i++) {
        unsigned char ca = (unsigned char) a[i];
        unsigned char cb = (unsigned char) b[i];
        if (ca >= 'A' && ca <= 'Z') ca = (unsigned char) (ca + ('a' - 'A'));
        if (cb >= 'A' && cb <= 'Z') cb = (unsigned char) (cb + ('a' - 'A'));
        if (ca != cb) return false;
    }
    return true;
}

/* RFC 9110 §10.1.1: Expect is a list of case-insensitive tokens with optional
 * parameters. Mirrors Node's continueExpression /(?:^|\W)100-continue(?:$|\W)/i
 * so "100-Continue", "100-continue; p=1" and list members all match. */
inline bool hasExpect100Continue(std::string_view expect) {
    constexpr std::string_view needle = "100-continue";
    if (expect.length() < needle.length()) return false;
    auto isWord = [](unsigned char c) {
        return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_';
    };
    for (size_t i = 0; i + needle.length() <= expect.length(); i++) {
        if (!asciiIEquals(expect.substr(i, needle.length()), needle)) continue;
        if (i > 0 && isWord((unsigned char) expect[i - 1])) continue;
        size_t end = i + needle.length();
        if (end < expect.length() && isWord((unsigned char) expect[end])) continue;
        return true;
    }
    return false;
}

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
