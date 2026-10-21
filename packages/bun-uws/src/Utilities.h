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

#include <cstddef>
#include <cstdint>
#include <cstring>
#include <limits>

extern "C" int16_t Bun__HTTPMethod__from(const char *str, size_t len);

namespace uWS {

/* RFC 9113 §8.2.2 / RFC 9114 §4.2: connection-specific fields are not
 * allowed in HTTP/2 or HTTP/3 responses. */
static inline bool asciiIEquals(std::string_view a, const char *lower) {
    for (size_t i = 0; i < a.size(); i++) if ((a[i] | 0x20) != lower[i]) return false;
    return true;
}
/* RFC 9110 §5.6.2 tchar. */
static inline bool isTokenByte(unsigned char c) {
    if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')) return true;
    switch (c) {
    case '!': case '#': case '$': case '%': case '&': case '\'': case '*':
    case '+': case '-': case '.': case '^': case '_': case '`': case '|': case '~':
        return true;
    }
    return false;
}

/* RFC 9110 §9.1: method = token. */
static inline bool isToken(std::string_view s) {
    if (s.empty()) return false;
    for (unsigned char c : s) if (!isTokenByte(c)) return false;
    return true;
}

/* The methods Bun.serve can represent, in their case-sensitive wire form. The lookup also knows each name in lowercase. */
static inline bool isKnownMethod(std::string_view method) {
    return !method.empty() && (unsigned char) (method[0] - 'A') < 26 && Bun__HTTPMethod__from(method.data(), method.size()) != -1;
}

/* One of the 8 bytes of `word` is a control byte or SP. */
constexpr bool wordHasControlOrSpace(uint64_t word) {
    return ((word - 0x2121212121212121ull) & ~word & 0x8080808080808080ull) != 0;
}
static_assert([] {
    for (uint64_t others = 0x2121212121212121ull; others; others = others == ~0ull ? 0 : ~0ull) {
        for (unsigned lane = 0; lane < 64; lane += 8) {
            for (uint64_t b = 0; b < 256; b++) {
                if (wordHasControlOrSpace((others & ~(0xffull << lane)) | (b << lane)) != (b <= 0x20)) return false;
            }
        }
    }
    return true;
}(), "wordHasControlOrSpace() is `byte <= 0x20` for every byte value in every lane");

/* A control byte or SP: what an HTTP/1 request-target cannot carry. */
static inline bool hasControlOrSpace(std::string_view s) {
    const char *p = s.data(), *end = p + s.size();
    for (; end - p >= 8; p += 8) {
        uint64_t word;
        memcpy(&word, p, 8);
        if (wordHasControlOrSpace(word)) return true;
    }
    for (; p != end; p++) if ((unsigned char) *p <= 0x20) return true;
    return false;
}

/* RFC 9113 §8.3.1 / RFC 9114 §4.3.1: :path is origin-form, or "*" for OPTIONS; CONNECT has none. */
static inline bool validPathForMethod(std::string_view method, std::string_view path) {
    if (method == "CONNECT") return path.empty();
    if (!(path.size() && path[0] == '/') && !(path == "*" && method == "OPTIONS")) return false;
    return !hasControlOrSpace(path);
}

/* HTTP/2: also needs an authority that Host does not contradict, with no userinfo. */
static inline bool validPseudoHeaderTarget(std::string_view method, std::string_view path, std::string_view authority, std::string_view host) {
    if (!isToken(method) || !validPathForMethod(method, path)) return false;
    if (authority.empty() && host.empty()) return false;
    if (!authority.empty() && !host.empty() && authority != host) return false;
    if (authority.find('@') != std::string_view::npos) return false;
    return true;
}

/* HTTP/3: the status that answers a request line before the router, or null. `authority` is :authority or Host. */
static inline const char *http3RequestLineRefusal(std::string_view method, std::string_view path, std::string_view authority) {
    bool known = isKnownMethod(method);
    if (!known && !isToken(method)) return "400 Bad Request";
    if (!validPathForMethod(method, path) || authority.empty()) return "400 Bad Request";
    return known ? nullptr : "501 Not Implemented";
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
