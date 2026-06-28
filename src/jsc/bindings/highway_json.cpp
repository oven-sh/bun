// SIMD JSON parser — full simdjson-style stage-1 + stage-2.
//
// Stage 1: 64-byte block → uint64_t bitmask per character class; backslash-run
// parity via the borrow-chain subtraction; in-string regions via prefix-XOR;
// structural-start = (op | scalar-start) & ~string. Emits a flat uint32_t[] of
// byte offsets.
//
// Stage 2: walk the index array as a token stream; emit a tape (uint64_t[]
// of (tag<<56)|payload words) and a string_buf with all string bodies
// unescaped. Container start words are back-patched with child count + tape
// index of the matching end so the consumer can size allocations exactly.
//
// One FFI call (`highway_json_parse`) does both stages. Caller supplies a
// padded input buffer and pre-sized output buffers.

#undef HWY_TARGET_INCLUDE
#define HWY_TARGET_INCLUDE "highway_json.cpp"
#include <hwy/foreach_target.h>

#include <hwy/highway.h>

#include <cstdint>
#include <cstdlib>
#include <cstring>

HWY_BEFORE_NAMESPACE();
namespace bun {
namespace HWY_NAMESPACE {

namespace hn = hwy::HWY_NAMESPACE;

using D8 = hn::CappedTag<uint8_t, 64>;

static constexpr uint64_t ODD_BITS = 0xAAAAAAAAAAAAAAAAULL;

// ─── stage-1 scanning ──────────────────────────────────────────────────────

static HWY_INLINE uint64_t PrefixXor(uint64_t x)
{
    x ^= x << 1;
    x ^= x << 2;
    x ^= x << 4;
    x ^= x << 8;
    x ^= x << 16;
    x ^= x << 32;
    return x;
}

struct BlockMasks {
    uint64_t backslash, quote, op, ws, ctrl, non_ascii;
};

static HWY_INLINE uint64_t MaskBitsU64(D8 d, hn::Mask<D8> m)
{
#if HWY_MAX_BYTES <= 64
    return hn::BitsFromMask(d, m);
#else
    alignas(8) uint8_t bytes[8] = {};
    hn::StoreMaskBits(d, m, bytes);
    uint64_t out;
    std::memcpy(&out, bytes, sizeof(out));
    return out;
#endif
}

static HWY_INLINE BlockMasks ClassifyBlock(D8 d, const uint8_t* HWY_RESTRICT p)
{
    const size_t N = hn::Lanes(d);
    BlockMasks m {};
    const auto vbs = hn::Set(d, uint8_t { '\\' });
    const auto vq = hn::Set(d, uint8_t { '"' });
    const auto vsp = hn::Set(d, uint8_t { ' ' });
    const auto vtab = hn::Set(d, uint8_t { '\t' });
    const auto vlf = hn::Set(d, uint8_t { '\n' });
    const auto vcr = hn::Set(d, uint8_t { '\r' });
    const auto vlb = hn::Set(d, uint8_t { '{' });
    const auto vrb = hn::Set(d, uint8_t { '}' });
    const auto vlk = hn::Set(d, uint8_t { '[' });
    const auto vrk = hn::Set(d, uint8_t { ']' });
    const auto vco = hn::Set(d, uint8_t { ':' });
    const auto vcm = hn::Set(d, uint8_t { ',' });
    const auto v20 = hn::Set(d, uint8_t { 0x20 });
    const auto v7f = hn::Set(d, uint8_t { 0x7F });

    for (size_t i = 0; i < 64; i += N) {
        const auto v = hn::LoadU(d, p + i);
        const auto mws = hn::Or(hn::Or(hn::Eq(v, vsp), hn::Eq(v, vtab)),
            hn::Or(hn::Eq(v, vlf), hn::Eq(v, vcr)));
        const auto mop = hn::Or(
            hn::Or(hn::Or(hn::Eq(v, vlb), hn::Eq(v, vrb)),
                hn::Or(hn::Eq(v, vlk), hn::Eq(v, vrk))),
            hn::Or(hn::Eq(v, vco), hn::Eq(v, vcm)));
        m.backslash |= MaskBitsU64(d, hn::Eq(v, vbs)) << i;
        m.quote |= MaskBitsU64(d, hn::Eq(v, vq)) << i;
        m.op |= MaskBitsU64(d, mop) << i;
        m.ws |= MaskBitsU64(d, mws) << i;
        m.ctrl |= MaskBitsU64(d, hn::Lt(v, v20)) << i;
        m.non_ascii |= MaskBitsU64(d, hn::Gt(v, v7f)) << i;
    }
    return m;
}

struct EscapeState {
    uint64_t next_is_escaped = 0;
    HWY_INLINE uint64_t next(uint64_t backslash)
    {
        if (!backslash) {
            const uint64_t e = next_is_escaped;
            next_is_escaped = 0;
            return e;
        }
        const uint64_t potential = backslash & ~next_is_escaped;
        const uint64_t maybe_escaped = potential << 1;
        const uint64_t escape_and_term = ((maybe_escaped | ODD_BITS) - potential) ^ ODD_BITS;
        const uint64_t escaped = escape_and_term ^ (backslash | next_is_escaped);
        next_is_escaped = (escape_and_term & backslash) >> 63;
        return escaped;
    }
};

static HWY_INLINE size_t WriteIndices(uint32_t* HWY_RESTRICT out, uint32_t base, uint64_t bits)
{
    if (bits == 0) return 0;
    const size_t cnt = static_cast<size_t>(hwy::PopCount(bits));
    size_t i = 0;
    do {
        out[i++] = base + static_cast<uint32_t>(hwy::Num0BitsBelowLS1Bit_Nonzero64(bits));
        bits &= bits - 1;
    } while (bits != 0);
    return cnt;
}

static HWY_INLINE uint64_t Follows(uint64_t match, uint64_t& overflow)
{
    const uint64_t result = (match << 1) | overflow;
    overflow = match >> 63;
    return result;
}

struct Stage1 {
    EscapeState esc {};
    uint64_t prev_in_string = 0, prev_scalar = 0, prev_structurals = 0;
    uint64_t err_ctrl = 0, any_non_ascii = 0;

    HWY_INLINE uint64_t step(D8 d, const uint8_t* HWY_RESTRICT p)
    {
        const BlockMasks bm = ClassifyBlock(d, p);
        any_non_ascii |= bm.non_ascii;
        const uint64_t escaped = esc.next(bm.backslash);
        const uint64_t quote = bm.quote & ~escaped;
        const uint64_t in_string = PrefixXor(quote) ^ prev_in_string;
        prev_in_string = static_cast<uint64_t>(static_cast<int64_t>(in_string) >> 63);
        const uint64_t string_tail = in_string ^ quote;
        const uint64_t scalar = ~(bm.op | bm.ws);
        const uint64_t nq_scalar = scalar & ~quote;
        const uint64_t follows_nq = Follows(nq_scalar, prev_scalar);
        const uint64_t structurals = (bm.op | (scalar & ~follows_nq)) & ~string_tail;
        err_ctrl |= bm.ctrl & in_string;
        const uint64_t out = prev_structurals;
        prev_structurals = structurals;
        return out;
    }
};

// 0 ok, 1 unclosed string, 2 unescaped ctrl in string, 3 capacity, 4 empty.
size_t JsonIndexImpl(const uint8_t* HWY_RESTRICT buf, size_t len,
    uint32_t* HWY_RESTRICT indices, size_t cap,
    uint32_t* HWY_RESTRICT out_count, uint32_t* HWY_RESTRICT out_flags)
{
    *out_count = 0;
    *out_flags = 0;
    if (len == 0) return 4;

    D8 d;
    Stage1 st;
    size_t n = 0, pos = 0;

    for (; pos + 64 <= len; pos += 64) {
        if (HWY_UNLIKELY(n + 64 > cap)) return 3;
        n += WriteIndices(indices + n, static_cast<uint32_t>(pos) - 64, st.step(d, buf + pos));
    }
    {
        uint8_t tail[64];
        std::memset(tail, ' ', 64);
        std::memcpy(tail, buf + pos, len - pos);
        if (HWY_UNLIKELY(n + 64 > cap)) return 3;
        n += WriteIndices(indices + n, static_cast<uint32_t>(pos) - 64, st.step(d, tail));
    }
    if (HWY_UNLIKELY(n + 64 > cap)) return 3;
    n += WriteIndices(indices + n, static_cast<uint32_t>(pos), st.prev_structurals);

    *out_count = static_cast<uint32_t>(n);
    *out_flags = (st.any_non_ascii != 0) ? 1u : 0u;
    if (st.prev_in_string) return 1;
    if (st.err_ctrl) return 2;
    if (n == 0) return 4;
    return 0;
}

size_t JsonStringScanImpl(const uint8_t* HWY_RESTRICT src, size_t len, uint32_t* HWY_RESTRICT out_pos)
{
    D8 d;
    const size_t N = hn::Lanes(d);
    const auto vq = hn::Set(d, uint8_t { '"' });
    const auto vbs = hn::Set(d, uint8_t { '\\' });
    size_t i = 0;
    const size_t simd_len = len - (len % N);
    for (; i < simd_len; i += N) {
        const auto v = hn::LoadU(d, src + i);
        const auto mq = hn::Eq(v, vq);
        const auto mbs = hn::Eq(v, vbs);
        const intptr_t p = hn::FindFirstTrue(d, hn::Or(mq, mbs));
        if (p >= 0) {
            *out_pos = static_cast<uint32_t>(i + static_cast<size_t>(p));
            const uint64_t qb = MaskBitsU64(d, mq);
            const uint64_t bb = MaskBitsU64(d, mbs);
            return (((bb - 1) & qb) != 0) ? 1 : 2;
        }
    }
    for (; i < len; ++i) {
        const uint8_t c = src[i];
        if (c == '"' || c == '\\') {
            *out_pos = static_cast<uint32_t>(i);
            return c == '"' ? 1 : 2;
        }
    }
    *out_pos = static_cast<uint32_t>(len);
    return 0;
}

// ─── stage-2 tape builder ──────────────────────────────────────────────────
//
// Tape word: (tag << 56) | payload.
//   '{' '['   payload bits 0-31 = tape index of matching '}'/']',
//             bits 32-55 = child count (saturated at 0xFFFFFF)
//   '}' ']'   payload = tape index of matching '{'/'['
//   '"'       payload = string_buf offset; next word = (len << 32) | src_loc
//   'd'       next word = raw f64 bits; payload = src_loc
//   't' 'f' 'n'  payload = src_loc
//   'r'       root sentinel pair (start: payload = end index; end: payload = 0)

namespace tape {
enum : uint8_t {
    Root = 'r',
    StartObj = '{',
    EndObj = '}',
    StartArr = '[',
    EndArr = ']',
    Str = '"',
    Dbl = 'd',
    True = 't',
    False = 'f',
    Null = 'n',
};
}

namespace err {
enum : uint32_t {
    Ok = 0,
    UnclosedString = 1,
    UnescapedCtrl = 2,
    Capacity = 3,
    Empty = 4,
    DepthExceeded = 5,
    Tape = 6, // generic structural error; out_err_pos points at the byte
    Number = 7,
    Atom = 8,
    Utf8 = 9,
    StringEscape = 10,
    Trailing = 11,
};
}

static constexpr size_t kMaxDepth = 1024;

static HWY_INLINE uint64_t TapeWord(uint8_t tag, uint64_t payload)
{
    return (static_cast<uint64_t>(tag) << 56) | (payload & 0x00FFFFFFFFFFFFFFULL);
}

static const uint8_t kEscapeMap[256] = {
    // clang-format off
    0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0,
    0,0,'"',0,0,0,0,0, 0,0,0,0,0,0,0,'/', 0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0,
    0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0, 0,0,0,0,'\\',0,0,0,
    0,0,0x08,0,0,0,0x0c,0, 0,0,0,0,0,0,0x0a,0, 0,0,0x0d,0,0x09,0,0,0, 0,0,0,0,0,0,0,0,
    0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0,
    0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0,
    0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0,
    0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0,
    // clang-format on
};

static const uint8_t kStructuralOrWs[256] = {
    // clang-format off
    1,0,0,0,0,0,0,0, 0,1,1,0,0,1,0,0, 0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0,
    1,0,0,0,0,0,0,0, 0,0,0,0,1,0,0,0, 0,0,0,0,0,0,0,0, 0,0,1,0,0,0,0,0,
    0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0, 0,0,0,1,0,1,0,0,
    0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0, 0,0,0,1,0,1,0,0,
    0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0,
    0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0,
    0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0,
    0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0,
    // clang-format on
};

static HWY_INLINE int HexVal(uint8_t c)
{
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
}

static HWY_INLINE size_t Utf8Encode(uint32_t cp, uint8_t* dst)
{
    if (cp < 0x80) {
        dst[0] = static_cast<uint8_t>(cp);
        return 1;
    }
    if (cp < 0x800) {
        dst[0] = static_cast<uint8_t>(0xC0 | (cp >> 6));
        dst[1] = static_cast<uint8_t>(0x80 | (cp & 0x3F));
        return 2;
    }
    if (cp < 0x10000) {
        dst[0] = static_cast<uint8_t>(0xE0 | (cp >> 12));
        dst[1] = static_cast<uint8_t>(0x80 | ((cp >> 6) & 0x3F));
        dst[2] = static_cast<uint8_t>(0x80 | (cp & 0x3F));
        return 3;
    }
    dst[0] = static_cast<uint8_t>(0xF0 | (cp >> 18));
    dst[1] = static_cast<uint8_t>(0x80 | ((cp >> 12) & 0x3F));
    dst[2] = static_cast<uint8_t>(0x80 | ((cp >> 6) & 0x3F));
    dst[3] = static_cast<uint8_t>(0x80 | (cp & 0x3F));
    return 4;
}

struct Stage2 {
    const uint8_t* buf;
    const uint8_t* buf_end; // buf + len
    const uint32_t* idx;
    size_t n_idx;
    size_t next;
    uint64_t* tape;
    size_t tape_n;
    uint8_t* strbuf;
    size_t strbuf_n;
    uint32_t depth;
    uint32_t open_tape[kMaxDepth];
    uint32_t open_count[kMaxDepth];
    bool is_array[kMaxDepth];
    uint32_t err_pos;

    HWY_INLINE uint32_t advance() { return idx[next++]; }
    // Sentinel indices equal `len`; map them to NUL so every dispatch falls
    // into an error arm without reading past the buffer.
    HWY_INLINE uint8_t at(uint32_t i) const
    {
        return HWY_LIKELY(buf + i < buf_end) ? buf[i] : 0;
    }

    HWY_INLINE void emit(uint8_t tag, uint64_t payload) { tape[tape_n++] = TapeWord(tag, payload); }
    HWY_INLINE void emit_raw(uint64_t w) { tape[tape_n++] = w; }

    uint32_t fail(uint32_t e, uint32_t at)
    {
        err_pos = at;
        return e;
    }

    // One copy-and-find round: load up to 32 bytes from `src` (LoadN — lanes
    // past the bound read as 0, which is neither '"' nor '\\'), speculatively
    // store to `dst`, return quote/backslash bitmasks.
    template<class D>
    HWY_INLINE void copy_and_find(D d, const uint8_t* src, size_t avail, uint8_t* dst,
        uint64_t& qbits, uint64_t& bbits)
    {
        const auto vq = hn::Set(d, uint8_t { '"' });
        const auto vbs = hn::Set(d, uint8_t { '\\' });
        const auto v = hn::LoadN(d, src, avail);
        hn::StoreU(v, d, dst);
        alignas(8) uint8_t mb[8] = {};
        hn::StoreMaskBits(d, hn::Eq(v, vq), mb);
        std::memcpy(&qbits, mb, sizeof qbits);
        std::memset(mb, 0, sizeof mb);
        hn::StoreMaskBits(d, hn::Eq(v, vbs), mb);
        std::memcpy(&bbits, mb, sizeof bbits);
    }

    HWY_INLINE bool handle_escape(const uint8_t*& src, uint8_t*& dst)
    {
        // `src` is at the backslash; stage 1 guarantees an escape body exists
        // (an unescaped backslash before end-of-input would have left the
        // following byte escaped → no unclosed-string failure unless past it).
        // We still bound-check via the closing quote: any over-read here would
        // first hit the quote and the qbits branch would have fired.
        const uint8_t* end = buf_end;
        const uint8_t e = (src + 1 < end) ? src[1] : 0;
        if (e == 'u') {
            if (src + 6 > end) return false;
            int h0 = HexVal(src[2]), h1 = HexVal(src[3]);
            int h2 = HexVal(src[4]), h3 = HexVal(src[5]);
            if ((h0 | h1 | h2 | h3) < 0) return false;
            uint32_t cp = static_cast<uint32_t>((h0 << 12) | (h1 << 8) | (h2 << 4) | h3);
            src += 6;
            if (cp >= 0xD800 && cp < 0xDC00 && src + 6 <= end && src[0] == '\\' && src[1] == 'u') {
                int g0 = HexVal(src[2]), g1 = HexVal(src[3]);
                int g2 = HexVal(src[4]), g3 = HexVal(src[5]);
                if ((g0 | g1 | g2 | g3) >= 0) {
                    uint32_t lo = static_cast<uint32_t>((g0 << 12) | (g1 << 8) | (g2 << 4) | g3);
                    if (lo >= 0xDC00 && lo < 0xE000) {
                        cp = 0x10000 + (((cp - 0xD800) << 10) | (lo - 0xDC00));
                        src += 6;
                    }
                }
            }
            dst += Utf8Encode(cp, dst);
            return true;
        }
        const uint8_t r = kEscapeMap[e];
        if (r == 0) return false;
        *dst++ = r;
        src += 2;
        return true;
    }

    // Find the next '"' or '\\' in `[src, buf_end)` without writing.
    template<class D>
    HWY_INLINE void find_only(D d, const uint8_t* src, size_t avail,
        uint64_t& qbits, uint64_t& bbits)
    {
        const auto vq = hn::Set(d, uint8_t { '"' });
        const auto vbs = hn::Set(d, uint8_t { '\\' });
        const auto v = hn::LoadN(d, src, avail);
        alignas(8) uint8_t mb[8] = {};
        hn::StoreMaskBits(d, hn::Eq(v, vq), mb);
        std::memcpy(&qbits, mb, sizeof qbits);
        std::memset(mb, 0, sizeof mb);
        hn::StoreMaskBits(d, hn::Eq(v, vbs), mb);
        std::memcpy(&bbits, mb, sizeof bbits);
    }

    HWY_INLINE uint32_t parse_string(uint32_t pos)
    {
        const hn::CappedTag<uint8_t, 32> d;
        const size_t N = hn::Lanes(d);
        const uint8_t* src = buf + pos + 1;

        // Phase 1: scan-only. If the closing quote arrives before any
        // backslash, emit a borrowed-span tape word — zero copies.
        for (;;) {
            uint64_t qbits, bbits;
            const size_t avail = static_cast<size_t>(buf_end - src);
            find_only(d, src, avail < N ? avail : N, qbits, bbits);
            if (((bbits - 1) & qbits) != 0) {
                const size_t qi = static_cast<size_t>(hwy::Num0BitsBelowLS1Bit_Nonzero64(qbits));
                const uint32_t body = pos + 1;
                const uint32_t slen = static_cast<uint32_t>((src - buf) + qi - body);
                emit(tape::Str, body | (1ull << 55)); // bit 55: borrowed-from-source
                emit_raw((static_cast<uint64_t>(slen) << 32) | pos);
                return err::Ok;
            }
            if (bbits != 0) {
                const size_t bi = static_cast<size_t>(hwy::Num0BitsBelowLS1Bit_Nonzero64(bbits));
                src += bi;
                break; // escape present → phase 2
            }
            if (HWY_UNLIKELY(avail < N)) return fail(err::UnclosedString, pos);
            src += N;
        }

        // Phase 2: copy-and-unescape into strbuf. `src` is at the first
        // backslash; bytes `[pos+1, src)` are escape-free — bulk-copy them.
        uint8_t* dst = strbuf + strbuf_n;
        const uint32_t off0 = static_cast<uint32_t>(strbuf_n);
        const size_t prefix = static_cast<size_t>(src - (buf + pos + 1));
        std::memcpy(dst, buf + pos + 1, prefix);
        dst += prefix;
        if (!handle_escape(src, dst))
            return fail(err::StringEscape, static_cast<uint32_t>(src - buf));

        for (;;) {
            uint64_t qbits, bbits;
            const size_t avail = static_cast<size_t>(buf_end - src);
            copy_and_find(d, src, avail < N ? avail : N, dst, qbits, bbits);
            if (((bbits - 1) & qbits) != 0) {
                const size_t qi = static_cast<size_t>(hwy::Num0BitsBelowLS1Bit_Nonzero64(qbits));
                dst += qi;
                const uint32_t slen = static_cast<uint32_t>(dst - (strbuf + off0));
                strbuf_n = static_cast<size_t>(dst - strbuf);
                emit(tape::Str, off0);
                emit_raw((static_cast<uint64_t>(slen) << 32) | pos);
                return err::Ok;
            }
            if (bbits != 0) {
                const size_t bi = static_cast<size_t>(hwy::Num0BitsBelowLS1Bit_Nonzero64(bbits));
                src += bi;
                dst += bi;
                if (!handle_escape(src, dst))
                    return fail(err::StringEscape, static_cast<uint32_t>(src - buf));
            } else {
                if (HWY_UNLIKELY(avail < N)) return fail(err::UnclosedString, pos);
                src += N;
                dst += N;
            }
        }
    }

    HWY_INLINE uint32_t parse_number(uint32_t pos)
    {
        // `buf[idx[next]]` is the byte after this scalar run — a structural or
        // whitespace char that terminates every digit loop and strtod, so we
        // can read `buf` directly. Only when `idx[next] == len` (last value,
        // sentinel) is that byte out of bounds; then copy to a NUL-terminated
        // local.
        const uint32_t end = idx[next];
        uint8_t local[64];
        const uint8_t* p;
        if (HWY_LIKELY(buf + end < buf_end)) {
            p = buf + pos;
        } else {
            const size_t span = end - pos;
            if (HWY_UNLIKELY(span >= sizeof local)) return parse_number_long(pos, end);
            std::memcpy(local, buf + pos, span);
            local[span] = 0;
            p = local;
        }

        const uint8_t* s = p;
        const bool neg = (*s == '-');
        if (neg) ++s;
        const uint8_t* int_start = s;
        if (*s == '0') {
            ++s;
            if (*s >= '0' && *s <= '9') return fail(err::Number, pos);
        } else if (*s >= '1' && *s <= '9') {
            do {
                ++s;
            } while (*s >= '0' && *s <= '9');
        } else {
            return fail(err::Number, pos);
        }
        bool fexp = false;
        if (*s == '.') {
            fexp = true;
            ++s;
            if (!(*s >= '0' && *s <= '9')) return fail(err::Number, pos);
            do {
                ++s;
            } while (*s >= '0' && *s <= '9');
        }
        if (*s == 'e' || *s == 'E') {
            fexp = true;
            ++s;
            if (*s == '+' || *s == '-') ++s;
            if (!(*s >= '0' && *s <= '9')) return fail(err::Number, pos);
            do {
                ++s;
            } while (*s >= '0' && *s <= '9');
        }
        if (!kStructuralOrWs[*s]) return fail(err::Number, pos + static_cast<uint32_t>(s - p));

        double v;
        const size_t digits = static_cast<size_t>(s - int_start);
        if (!fexp && digits <= 15) {
            uint64_t n = 0;
            for (const uint8_t* q = int_start; q < s; ++q)
                n = n * 10 + (*q - '0');
            v = static_cast<double>(n);
            if (neg) v = -v;
        } else {
            char* unused;
            v = std::strtod(reinterpret_cast<const char*>(p), &unused);
        }
        emit(tape::Dbl, pos);
        uint64_t bits;
        std::memcpy(&bits, &v, sizeof bits);
        emit_raw(bits);
        return err::Ok;
    }

    HWY_NOINLINE uint32_t parse_number_long(uint32_t pos, uint32_t end)
    {
        const uint8_t* p = buf + pos;
        const uint8_t* lim = buf + end;
        auto get = [&](const uint8_t* s) { return s < lim ? *s : uint8_t(0); };
        const uint8_t* s = p;
        if (get(s) == '-') ++s;
        if (get(s) == '0') {
            ++s;
            if (get(s) >= '0' && get(s) <= '9') return fail(err::Number, pos);
        } else if (get(s) >= '1' && get(s) <= '9') {
            do {
                ++s;
            } while (get(s) >= '0' && get(s) <= '9');
        } else {
            return fail(err::Number, pos);
        }
        if (get(s) == '.') {
            ++s;
            if (!(get(s) >= '0' && get(s) <= '9')) return fail(err::Number, pos);
            do {
                ++s;
            } while (get(s) >= '0' && get(s) <= '9');
        }
        if (get(s) == 'e' || get(s) == 'E') {
            ++s;
            if (get(s) == '+' || get(s) == '-') ++s;
            if (!(get(s) >= '0' && get(s) <= '9')) return fail(err::Number, pos);
            do {
                ++s;
            } while (get(s) >= '0' && get(s) <= '9');
        }
        if (!kStructuralOrWs[get(s)]) return fail(err::Number, pos);
        // strtod over a NUL-terminated heap copy.
        const size_t n = static_cast<size_t>(s - p);
        char* tmp = static_cast<char*>(std::malloc(n + 1));
        if (!tmp) return fail(err::Capacity, pos);
        std::memcpy(tmp, p, n);
        tmp[n] = 0;
        char* unused;
        const double v = std::strtod(tmp, &unused);
        std::free(tmp);
        emit(tape::Dbl, pos);
        uint64_t bits;
        std::memcpy(&bits, &v, sizeof bits);
        emit_raw(bits);
        return err::Ok;
    }

    HWY_INLINE uint32_t parse_atom(uint32_t pos, uint8_t c)
    {
        uint8_t a[8] = {};
        const size_t avail = static_cast<size_t>(buf_end - (buf + pos));
        std::memcpy(a, buf + pos, avail < 8 ? avail : 8);
        auto str4 = [](const void* q) {
            uint32_t v;
            std::memcpy(&v, q, 4);
            return v;
        };
        switch (c) {
        case 't':
            if (str4(a) == str4("true") && kStructuralOrWs[a[4]]) {
                emit(tape::True, pos);
                return err::Ok;
            }
            break;
        case 'f':
            if (str4(a + 1) == str4("alse") && kStructuralOrWs[a[5]]) {
                emit(tape::False, pos);
                return err::Ok;
            }
            break;
        case 'n':
            if (str4(a) == str4("null") && kStructuralOrWs[a[4]]) {
                emit(tape::Null, pos);
                return err::Ok;
            }
            break;
        }
        return fail(err::Atom, pos);
    }

    HWY_INLINE uint32_t visit_primitive(uint32_t pos, uint8_t c)
    {
        switch (c) {
        case '"':
            return parse_string(pos);
        case '-':
        case '0':
        case '1':
        case '2':
        case '3':
        case '4':
        case '5':
        case '6':
        case '7':
        case '8':
        case '9':
            return parse_number(pos);
        case 't':
        case 'f':
        case 'n':
            return parse_atom(pos, c);
        default:
            return fail(err::Tape, pos);
        }
    }

    HWY_INLINE uint32_t open_container(uint32_t pos, bool array)
    {
        if (depth >= kMaxDepth) return fail(err::DepthExceeded, pos);
        is_array[depth] = array;
        open_tape[depth] = static_cast<uint32_t>(tape_n);
        open_count[depth] = 0;
        ++depth;
        emit(array ? tape::StartArr : tape::StartObj, 0); // back-patched
        emit_raw(pos);
        return err::Ok;
    }

    HWY_INLINE void close_container(bool array)
    {
        --depth;
        const uint32_t start = open_tape[depth];
        const uint32_t count = open_count[depth] > 0x00FFFFFFu ? 0x00FFFFFFu : open_count[depth];
        const uint32_t end = static_cast<uint32_t>(tape_n);
        emit(array ? tape::EndArr : tape::EndObj, start);
        // Back-patch start: bits 0-31 end index, 32-55 count.
        tape[start] = TapeWord(array ? tape::StartArr : tape::StartObj,
            (static_cast<uint64_t>(count) << 32) | end);
    }

    uint32_t walk()
    {
        emit(tape::Root, 0);
        uint32_t pos = advance();
        uint8_t c = at(pos);
        if (c == '{') {
            if (auto e = open_container(pos, false)) return e;
            goto object_begin;
        }
        if (c == '[') {
            if (auto e = open_container(pos, true)) return e;
            goto array_begin;
        }
        if (auto e = visit_primitive(pos, c)) return e;
        goto document_end;

    object_begin:
        pos = advance();
        if (at(pos) == '}') {
            close_container(false);
            goto scope_end;
        }
        if (at(pos) != '"') return fail(err::Tape, pos);
        goto object_field;

    object_field:
        if (auto e = parse_string(pos)) return e;
        pos = advance();
        if (at(pos) != ':') return fail(err::Tape, pos);
        ++open_count[depth - 1];
        pos = advance();
        c = at(pos);
        if (c == '{') {
            if (auto e = open_container(pos, false)) return e;
            goto object_begin;
        }
        if (c == '[') {
            if (auto e = open_container(pos, true)) return e;
            goto array_begin;
        }
        if (auto e = visit_primitive(pos, c)) return e;
        // fallthrough
    object_continue:
        pos = advance();
        if (at(pos) == ',') {
            pos = advance();
            if (at(pos) != '"') return fail(err::Tape, pos);
            goto object_field;
        }
        if (at(pos) == '}') {
            close_container(false);
            goto scope_end;
        }
        return fail(err::Tape, pos);

    array_begin:
        pos = idx[next];
        if (at(pos) == ']') {
            ++next;
            close_container(true);
            goto scope_end;
        }
        // fallthrough
    array_value:
        ++open_count[depth - 1];
        pos = advance();
        c = at(pos);
        if (c == '{') {
            if (auto e = open_container(pos, false)) return e;
            goto object_begin;
        }
        if (c == '[') {
            if (auto e = open_container(pos, true)) return e;
            goto array_begin;
        }
        if (auto e = visit_primitive(pos, c)) return e;
        // fallthrough
    array_continue:
        pos = advance();
        if (at(pos) == ',') goto array_value;
        if (at(pos) == ']') {
            close_container(true);
            goto scope_end;
        }
        return fail(err::Tape, pos);

    scope_end:
        if (depth == 0) goto document_end;
        if (is_array[depth - 1]) goto array_continue;
        goto object_continue;

    document_end:
        if (next < n_idx) return fail(err::Trailing, idx[next]);
        tape[0] = TapeWord(tape::Root, static_cast<uint64_t>(tape_n));
        emit(tape::Root, 0);
        return err::Ok;
    }
};

// Full parse. Caller contract:
//   - `buf` readable for exactly `len` bytes — no padding required. Stage 1
//     stack-copies the tail block; stage 2 uses LoadN / span-bounded copies
//     so nothing reads `buf[len]`.
//   - `indices` writable for `len + 64 + 4` u32s.
//   - `tape` writable for `len + len/2 + 8` u64s (worst case is `[[[...]]]`:
//     3 words per 2 input bytes, plus root pair).
//   - `strbuf` writable for `len + 32` bytes (unescaped output ≤ input;
//     +32 for the speculative over-store past the closing quote).
//
// Returns err code; on success out_tape_len/out_strbuf_len/out_flags are set.
uint32_t JsonParseImpl(const uint8_t* buf, size_t len,
    uint32_t* indices, size_t indices_cap,
    uint64_t* tape, uint8_t* strbuf,
    uint32_t* out_tape_len, uint32_t* out_strbuf_len,
    uint32_t* out_flags, uint32_t* out_err_pos)
{
    *out_tape_len = 0;
    *out_strbuf_len = 0;
    *out_err_pos = 0;

    uint32_t n = 0, flags = 0;
    const size_t rc = JsonIndexImpl(buf, len, indices, indices_cap, &n, &flags);
    *out_flags = flags;
    if (rc != 0) {
        *out_err_pos = static_cast<uint32_t>(len);
        return static_cast<uint32_t>(rc);
    }
    // Sentinels at `len`: `at(len)` returns NUL, and `parse_number`/
    // `parse_atom` use `idx[next] - pos` as the span so the last value's run
    // is `[pos, len)`.
    indices[n] = static_cast<uint32_t>(len);
    indices[n + 1] = static_cast<uint32_t>(len);
    indices[n + 2] = static_cast<uint32_t>(len);

    Stage2 st {};
    st.buf = buf;
    st.buf_end = buf + len;
    st.idx = indices;
    st.n_idx = n;
    st.next = 0;
    st.tape = tape;
    st.tape_n = 0;
    st.strbuf = strbuf;
    st.strbuf_n = 0;
    st.depth = 0;
    st.err_pos = 0;

    const uint32_t e = st.walk();
    *out_tape_len = static_cast<uint32_t>(st.tape_n);
    *out_strbuf_len = static_cast<uint32_t>(st.strbuf_n);
    *out_err_pos = st.err_pos;
    return e;
}

} // namespace HWY_NAMESPACE
} // namespace bun
HWY_AFTER_NAMESPACE();

#if HWY_ONCE
namespace bun {

HWY_EXPORT(JsonIndexImpl);
HWY_EXPORT(JsonStringScanImpl);
HWY_EXPORT(JsonParseImpl);

extern "C" {

size_t highway_json_index(const uint8_t* buf, size_t len,
    uint32_t* indices, size_t cap,
    uint32_t* out_count, uint32_t* out_flags)
{
    return HWY_DYNAMIC_DISPATCH(JsonIndexImpl)(buf, len, indices, cap, out_count, out_flags);
}

size_t highway_json_string_scan(const uint8_t* src, size_t len, uint32_t* out_pos)
{
    return HWY_DYNAMIC_DISPATCH(JsonStringScanImpl)(src, len, out_pos);
}

uint32_t highway_json_parse(const uint8_t* buf, size_t len,
    uint32_t* indices, size_t indices_cap,
    uint64_t* tape, uint8_t* strbuf,
    uint32_t* out_tape_len, uint32_t* out_strbuf_len,
    uint32_t* out_flags, uint32_t* out_err_pos)
{
    return HWY_DYNAMIC_DISPATCH(JsonParseImpl)(buf, len, indices, indices_cap,
        tape, strbuf, out_tape_len, out_strbuf_len, out_flags, out_err_pos);
}

} // extern "C"
} // namespace bun
#endif // HWY_ONCE
