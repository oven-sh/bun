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
#if defined(__SSE2__)
#include <emmintrin.h>
#elif defined(__ARM_NEON)
#include <arm_neon.h>
#endif

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
    /* Index of the first '?' or '#', or the target's length when it has
     * neither. The path is everything before it. */
    unsigned int pathEnd;
    /* The path has a byte that can change how the URL parser splits it into
     * segments. */
    bool pathMayNormalize;
};

/* Bit masks over one 16-byte block of a request-target. Each byte owns
 * BITS_PER_BYTE bits, all set when the byte matches: 1 bit from SSE2's
 * movemask, 4 bits from NEON's narrowing shift. */
struct RequestTargetBlock {
#if defined(__ARM_NEON) && !defined(__SSE2__)
    static constexpr unsigned BITS_PER_BYTE = 4;
#else
    static constexpr unsigned BITS_PER_BYTE = 1;
#endif
    uint64_t queryOrHash, slash, dotOrPercent, backslash;

    static RequestTargetBlock load(const char *p) {
#if defined(__SSE2__)
        __m128i v = _mm_loadu_si128((const __m128i *) p);
        auto eq = [&](char c) { return _mm_cmpeq_epi8(v, _mm_set1_epi8(c)); };
        auto mask = [](__m128i m) { return (uint64_t) (unsigned) _mm_movemask_epi8(m); };
        return {
            mask(_mm_or_si128(eq('?'), eq('#'))),
            mask(eq('/')),
            mask(_mm_or_si128(eq('.'), eq('%'))),
            mask(eq('\\')),
        };
#elif defined(__ARM_NEON)
        uint8x16_t v = vld1q_u8((const uint8_t *) p);
        auto eq = [&](char c) { return vceqq_u8(v, vdupq_n_u8((uint8_t) c)); };
        auto mask = [](uint8x16_t m) { return vget_lane_u64(vreinterpret_u64_u8(vshrn_n_u16(vreinterpretq_u16_u8(m), 4)), 0); };
        return {
            mask(vorrq_u8(eq('?'), eq('#'))),
            mask(eq('/')),
            mask(vorrq_u8(eq('.'), eq('%'))),
            mask(eq('\\')),
        };
#else
        RequestTargetBlock b = {};
        for (unsigned i = 0; i < 16; i++) {
            uint64_t bit = 1ULL << i;
            switch (p[i]) {
            case '?': case '#': b.queryOrHash |= bit; break;
            case '/': b.slash |= bit; break;
            case '.': case '%': b.dotOrPercent |= bit; break;
            case '\\': b.backslash |= bit; break;
            default: break;
            }
        }
        return b;
#endif
    }
};

/* One pass over a request-target. The path ends at the first '?' or '#', as
 * it does for the URL parser. pathMayNormalize is the router's reason to ask
 * the URL parser for the pathname instead of matching the raw bytes: it is
 * set for a '\\' (the parser reads it as '/') or a segment that starts with
 * '.' or '%' ("." / ".." / "%2e" / "%2e%2e" collapse). Any other byte keeps
 * its segment. The parser may percent-encode it, but the segment boundaries,
 * and so the matched route, stay the same. */
static inline RequestTargetScan scanRequestTarget(std::string_view target) {
    const char *data = target.data();
    const size_t length = target.length();
    constexpr unsigned BITS = RequestTargetBlock::BITS_PER_BYTE;
    uint64_t marks = 0;
    /* The low bits are set when the byte before the block is '/'. */
    uint64_t previousSlash = 0;
    size_t i = 0;
    bool last = false;
    while (!last) {
        RequestTargetBlock b;
        /* All bits of the bytes this block scans for the first time. */
        uint64_t valid = ~0ULL;
        if (i + 16 <= length) {
            b = RequestTargetBlock::load(data + i);
            last = i + 16 == length;
        } else if (i == length) {
            break;
        } else if (length >= 16) {
            /* The last block overlaps the previous one: the transports do not
             * promise readable bytes past the target. */
            unsigned repeated = (unsigned) (i - (length - 16));
            b = RequestTargetBlock::load(data + length - 16);
            valid <<= repeated * BITS;
            i = length - 16;
            last = true;
        } else {
            last = true;
            /* Shorter than a block: a zero padded copy, no byte of interest is NUL. */
            alignas(16) char copy[16] = {};
            if (length >= 8) {
                memcpy(copy, data, 8);
                memcpy(copy + length - 8, data + length - 8, 8);
            } else if (length >= 4) {
                memcpy(copy, data, 4);
                memcpy(copy + length - 4, data + length - 4, 4);
            } else {
                copy[0] = data[0];
                copy[length - 1] = data[length - 1];
                copy[length / 2] = data[length / 2];
            }
            b = RequestTargetBlock::load(copy);
        }
        uint64_t blockMarks = (b.backslash | (((b.slash << BITS) | previousSlash) & b.dotOrPercent)) & valid;
        uint64_t end = b.queryOrHash & valid;
        if (end) {
            /* Only the bytes before the first '?' or '#' are path. */
            uint64_t first = end & (0 - end);
            marks |= blockMarks & (first - 1);
            return {(unsigned int) (i + __builtin_ctzll(end) / BITS), marks != 0};
        }
        marks |= blockMarks;
        previousSlash = b.slash >> (15 * BITS);
        i += 16;
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
