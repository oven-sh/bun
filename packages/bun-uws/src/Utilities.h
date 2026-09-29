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

/* RFC 9113 §8.3.1 / RFC 9114 §4.3.1 request-target rules shared by the h2
 * and h3 request validators: :method is a token; :path is origin-form (or
 * "*" for OPTIONS) and carries no byte the HTTP/1 request line could not
 * (controls, SP); CONNECT carries no :path; there is an authority, Host
 * doesn't contradict :authority, and :authority has no userinfo. */
static inline bool validPseudoHeaderTarget(std::string_view method, std::string_view path, std::string_view authority, std::string_view host) {
    if (method.empty()) return false;
    for (unsigned char c : method) if (!isTokenByte(c)) return false;
    bool isConnect = method == "CONNECT";
    if (!isConnect) {
        if (!(path.size() && path[0] == '/') && !(path == "*" && method == "OPTIONS")) return false;
        for (unsigned char c : path) if (c <= 0x20) return false;
    }
    if (authority.empty() && host.empty()) return false;
    if (!authority.empty() && !host.empty() && authority != host) return false;
    if (authority.find('@') != std::string_view::npos) return false;
    return true;
}

struct RequestTargetScan {
    /* Index of the first '?', or the target's length when it has none. */
    unsigned int querySeparator;
    /* The path before the query has a byte that can change how the URL parser
     * splits it into segments. */
    bool pathMayNormalize;
};

/* One pass over a request-target, eight bytes at a time. The query separator
 * is what every request needs. pathMayNormalize is the router's reason to ask
 * the URL parser for the pathname instead of matching the raw bytes: it is set
 * for a '#' (ends the path), a '\\' (the parser reads it as '/'), or a segment
 * that starts with '.' or '%' ("." / ".." / "%2e" / "%2e%2e" collapse). Any
 * other byte keeps its segment. The parser may percent-encode it, but the
 * segment boundaries, and so the matched route, stay the same. */
static inline RequestTargetScan scanRequestTarget(std::string_view target) {
    constexpr uint64_t ONES = 0x0101010101010101ULL;
    constexpr uint64_t LOW7 = 0x7f7f7f7f7f7f7f7fULL;
    /* 0x80 in every byte of `w` that is zero, and nowhere else. */
    auto zeroBytes = [](uint64_t w) { return ~(((w & LOW7) + LOW7) | w | LOW7); };

    const char *data = target.data();
    const size_t length = target.length();
    uint64_t marks = 0;
    /* Bit 7 is set when the previous word ended with '/'. */
    uint64_t previousSlash = 0;
    for (size_t i = 0; i < length; i += 8) {
        uint64_t word = 0;
        /* The tail is zero padded: no byte this scan looks for is NUL, and
         * neither transport delivers a NUL inside the target. */
        memcpy(&word, data + i, length - i < 8 ? length - i : 8);
        uint64_t slash = zeroBytes(word ^ (ONES * '/'));
        uint64_t wordMarks = zeroBytes(word ^ (ONES * '#'))
            | zeroBytes(word ^ (ONES * '\\'))
            | (((slash << 8) | previousSlash) & (zeroBytes(word ^ (ONES * '.')) | zeroBytes(word ^ (ONES * '%'))));
        uint64_t query = zeroBytes(word ^ (ONES * '?'));
        if (query) {
            /* Only the bytes before the first '?' are path. */
            uint64_t firstQuery = query & (0 - query);
            marks |= wordMarks & (firstQuery - 1);
            return {(unsigned int) (i + (__builtin_ctzll(query) >> 3)), marks != 0};
        }
        marks |= wordMarks;
        previousSlash = slash >> 56;
    }
    return {(unsigned int) length, marks != 0};
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
