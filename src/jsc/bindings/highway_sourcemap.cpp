// SIMD source-map "mappings" VLQ decoder, runtime-dispatched via Google
// Highway (same mechanism as highway_strings.cpp / xxhash3.cpp).
//
// Replaces the byte-at-a-time VLQ decode in bun_sourcemap::mapping::parse for
// large inputs. The scalar decode walks one base64 character per iteration
// with a table lookup and a data-dependent branch; real-world mappings are a
// stream of tiny fixed-ish records (measured on a 68 MB bundle map: 12.9M
// segments, 93% of VLQs are a single character, 99.9% are at most two, 76.6%
// of segments are exactly four one-char VLQs followed by a delimiter). That
// shape makes the input amenable to wide classification:
//
//   1. Per block, map every byte to its 6-bit base64 value with two
//      TableLookupBytes (Muła low/high-nibble LUT). ',' ';' and any non-
//      base64 byte land on a 0xFF sentinel so one comparison yields the
//      delimiter/invalid bitmap.
//   2. Three 64-bit bitmaps per block: delimiter, ';' and VLQ-continuation
//      (sextet bit 5). Segment ends are tzcnt on the delimiter map.
//   3. Per segment, VLQ boundaries are the 0 bits of the continuation map;
//      field count is seg_len - popcount(seg_cont). The common seg_cont==0
//      (all one-char VLQs) case reads the sextets directly.
//
// The kernel accumulates the running (generated/original/source/name) state
// and writes one row of ABSOLUTE values per 4- or 5-field segment. 1-field
// segments advance the generated-column accumulator without emitting a row
// (matching the scalar parser, which skips them). On any anomaly (invalid
// byte, unsupported field count, out-of-range accumulated value, a segment
// that doesn't fit in one block, capacity exhausted, < one block of input
// remaining) the kernel writes *err_at = byte-offset-of-that-segment and
// returns: the Rust caller resumes the existing scalar loop from that offset
// with the returned state, so error messages and offsets are byte-identical
// to the pure-scalar path.
//
// References:
//   Muła, "SIMD base64 decoding"  http://0x80.pl/notesen/2016-01-17-sse-base64-decoding.html
//   Lemire & Boytsov, "Masked VByte"  https://arxiv.org/abs/1503.07387

#undef HWY_TARGET_INCLUDE
#define HWY_TARGET_INCLUDE "highway_sourcemap.cpp"
#include <hwy/foreach_target.h> // Must come before highway.h

#include <hwy/highway.h>

#include <cstddef>
#include <cstdint>
#include <cstring>

// ---------------------------------------------------------------------------
// Target-independent tables and scalar helpers.
// Guarded so foreach_target.h (which re-includes this file once per ISA) only
// expands them on the first pass.
// ---------------------------------------------------------------------------
#ifndef BUN_HWY_SOURCEMAP_SCALAR_DEFINED
#define BUN_HWY_SOURCEMAP_SCALAR_DEFINED

namespace bun {
namespace sourcemap_vlq {

// Muła's two-nibble base64 decode LUT. Index by the low nibble of the input
// byte, add the high-nibble correction, then any lane whose result has bit 6
// or 7 set is NOT a valid base64 character (which for us includes ',' ';'
// and every byte outside the standard alphabet). Standard base64 alphabet:
//   'A'..'Z' -> 0..25   'a'..'z' -> 26..51   '0'..'9' -> 52..61   '+' -> 62   '/' -> 63
//
// kLutLo[b & 0x0F] gives a base value assuming the *upper-case* letter row
// ('A'..'O' are 0x41..0x4F, low nibbles 1..15; 'P'..'Z' are 0x50..0x5A, low
// nibbles 0..10). kLutHi[b >> 4] then shifts it into the correct row.
// Invalid (row,col) pairs land on values >= 0x40; the caller masks those to
// 0xFF via a compare so one mask covers delimiter+invalid.
//
// Derivation is the same as simdutf/aklomp base64 decoders; the table is
// reproduced verbatim (the magic constants are fixed by the alphabet).
alignas(16) static constexpr uint8_t kLutLo[16] = {
    /*  0 */ 0x15, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11,
    /*  8 */ 0x11, 0x11, 0x13, 0x1A, 0x1B, 0x1B, 0x1B, 0x1A,
};
alignas(16) static constexpr uint8_t kLutHi[16] = {
    /*  0 */ 0x10, 0x10, 0x01, 0x02, 0x04, 0x08, 0x04, 0x08,
    /*  8 */ 0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x10,
};
alignas(16) static constexpr uint8_t kLutRoll[16] = {
    /*  0 */ 0x00, 0x10, 0x13, 0x04, 0xBF, 0xBF, 0xB9, 0xB9,
    /*  8 */ 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
};

// Indices into the in/out state[10] array (mirrors the Rust-side ParseState).
enum : size_t {
    kStGenLine = 0,
    kStGenCol = 1,
    kStOrigLine = 2,
    kStOrigCol = 3,
    kStSrcIdx = 4,
    kStNameIdx = 5,
    kStNeedsSort = 6,
    kStHasNames = 7,
    kStFastBlocks = 8,
    kStSlowBlocks = 9,
};

// VLQ sign recovery. Source-map VLQ is sign-magnitude (NOT zigzag): bit 0 is
// the sign flag, bits 1.. are the magnitude. Written branch-free as
// `(mag ^ s) - s` with `s = -(v & 1)`: s is 0 or -1, so XOR+SUB is either
// identity or two's-complement negation. Sign-magnitude encodes -0
// distinctly from +0; both decode to integer 0 under this formula.
static inline int32_t SignMag(uint32_t v)
{
    const int32_t s = -static_cast<int32_t>(v & 1u);
    const int32_t mag = static_cast<int32_t>(v >> 1);
    return (mag ^ s) - s;
}

// Decode one VLQ starting at sextets[p] using the continuation bitmap (bit k
// set iff sextets[k] has bit 5 set). Returns the sign-magnitude value and
// advances p past the VLQ. Caller guarantees the VLQ terminates before
// `end` (i.e. cont has a 0 bit in [p, end)).
static inline int32_t DecodeVlqSextets(const uint8_t* sextets, uint64_t cont,
    size_t& p, size_t end)
{
    uint32_t vlq = 0;
    uint32_t shift = 0;
    for (;;) {
        const uint32_t s = sextets[p];
        vlq |= (s & 31u) << shift;
        const bool more = (cont >> p) & 1;
        p += 1;
        if (!more || p >= end)
            break;
        shift += 5;
    }
    return SignMag(vlq);
}

} // namespace sourcemap_vlq
} // namespace bun

#endif // BUN_HWY_SOURCEMAP_SCALAR_DEFINED

HWY_BEFORE_NAMESPACE();
namespace bun {
namespace HWY_NAMESPACE {

namespace hn = hwy::HWY_NAMESPACE;

// Bits [0, k) set; tolerates k == 64.
static HWY_INLINE uint64_t MaskBelow(size_t k)
{
    return k >= 64 ? ~uint64_t { 0 } : ((uint64_t { 1 } << k) - 1);
}

// One block of classification: decode base64 -> sextets[], compute the
// four bitmaps. `d` is CappedTag<u8, 64> so the bitmaps fit in a uint64_t.
template<class D>
static HWY_INLINE void ClassifyBlock(D d, const uint8_t* bytes,
    uint8_t* HWY_RESTRICT sextets,
    uint64_t& delim_bits, uint64_t& semi_bits, uint64_t& cont_bits,
    uint64_t& invalid_bits)
{
    using bun::sourcemap_vlq::kLutHi;
    using bun::sourcemap_vlq::kLutLo;
    using bun::sourcemap_vlq::kLutRoll;

    const auto lo_nib = hn::Set(d, uint8_t { 0x0F });
    const auto cont_bit = hn::Set(d, uint8_t { 0x20 });
    const auto all_ones = hn::Set(d, uint8_t { 0xFF });
    const auto comma = hn::Set(d, uint8_t { ',' });
    const auto semi = hn::Set(d, uint8_t { ';' });
    const auto slash = hn::Set(d, uint8_t { '/' });

    const auto lut_lo = hn::LoadDup128(d, kLutLo);
    const auto lut_hi = hn::LoadDup128(d, kLutHi);
    const auto lut_roll = hn::LoadDup128(d, kLutRoll);

    const auto in = hn::LoadU(d, bytes);

    // Muła classify: a byte is valid base64 iff
    // (kLutLo[b & 0xF] & kLutHi[b >> 4]) == 0. The roll table is indexed by
    // the high nibble with one wrinkle: '+' (0x2B) and '/' (0x2F) share
    // hi=2 but need different offsets (+19 vs +16), so '/' is bumped to
    // index 1 via `hi + (in == '/' ? 0xFF : 0)` (wraps to hi-1). Invalid
    // bytes' roll result is overwritten with 0xFF below.
    const auto hi = hn::And(hn::ShiftRight<4>(in), lo_nib);
    const auto lo = hn::And(in, lo_nib);
    const auto cls = hn::And(hn::TableLookupBytes(lut_lo, lo), hn::TableLookupBytes(lut_hi, hi));
    const auto not_b64 = hn::Ne(cls, hn::Zero(d));

    const auto eq_slash = hn::VecFromMask(d, hn::Eq(in, slash));
    const auto roll_idx = hn::Add(hi, eq_slash);
    const auto roll = hn::TableLookupBytes(lut_roll, roll_idx);
    auto sx = hn::Add(in, roll);
    sx = hn::IfThenElse(not_b64, all_ones, sx);

    const auto is_comma = hn::Eq(in, comma);
    const auto is_semi = hn::Eq(in, semi);
    const auto is_delim = hn::Or(is_comma, is_semi);
    const auto is_invalid = hn::AndNot(is_delim, not_b64);
    // Continuation bit is only meaningful on valid base64 bytes; delimiter
    // and invalid lanes have sx==0xFF so bit 5 is spuriously set there.
    const auto has_cont = hn::AndNot(not_b64, hn::Ne(hn::And(sx, cont_bit), hn::Zero(d)));

    hn::StoreU(sx, d, sextets);

    alignas(8) uint8_t mbuf[8];
    const auto toBits = [&](auto m) HWY_ATTR -> uint64_t {
        std::memset(mbuf, 0, sizeof(mbuf));
        hn::StoreMaskBits(d, m, mbuf);
        uint64_t bits;
        std::memcpy(&bits, mbuf, sizeof(bits));
        return bits;
    };

    delim_bits = toBits(is_delim);
    semi_bits = toBits(is_semi);
    invalid_bits = toBits(is_invalid);
    cont_bits = toBits(has_cont);
}

// Sign-magnitude decode of every sextet in a u8 vector into i8 lanes.
// Valid only for 1-char VLQs (value range [-15, 15], fits i8).
template<class D>
static HWY_INLINE hn::Vec<hn::RebindToSigned<D>> SignMagI8(D d, hn::Vec<D> sx)
{
    const hn::RebindToSigned<D> di;
    const auto one = hn::Set(d, uint8_t { 1 });
    // s = 0 - (sx & 1) : 0x00 or 0xFF per lane
    const auto s = hn::BitCast(di, hn::Sub(hn::Zero(d), hn::And(sx, one)));
    const auto mag = hn::BitCast(di, hn::ShiftRight<1>(sx));
    return hn::Sub(hn::Xor(mag, s), s);
}

// Output columns match the `MultiArrayList<Mapping>` SoA layout so the Rust
// caller can bulk-copy each into the corresponding column:
//   out_generated[i] = { gen_line, gen_col }   (LineColumnOffset, repr(C))
//   out_original[i]  = { orig_line, orig_col } (LineColumnOffset, repr(C))
//   out_src_idx[i], out_name_idx[i]            (i32)
size_t ParseMappingsImpl(const uint8_t* HWY_RESTRICT bytes, size_t len,
    int32_t* HWY_RESTRICT out_generated, int32_t* HWY_RESTRICT out_original,
    int32_t* HWY_RESTRICT out_src_idx, int32_t* HWY_RESTRICT out_name_idx,
    size_t cap, int32_t sources_count,
    int32_t* HWY_RESTRICT state, size_t* HWY_RESTRICT err_at)
{
    using namespace bun::sourcemap_vlq;

    // Cap at 64 lanes so every per-block bitmap fits a uint64_t. On SSE/NEON
    // this is 16 lanes, on AVX2 32, on AVX-512 64.
    const hn::CappedTag<uint8_t, 64> d;
    const size_t N = hn::Lanes(d);

    int32_t gen_line = state[kStGenLine];
    int32_t gen_col = state[kStGenCol];
    int32_t orig_line = state[kStOrigLine];
    int32_t orig_col = state[kStOrigCol];
    int32_t src_idx = state[kStSrcIdx];
    int32_t name_idx = state[kStNameIdx];
    int32_t needs_sort = state[kStNeedsSort];
    int32_t has_names = state[kStHasNames];

    alignas(64) uint8_t sextets[64];
    alignas(64) int8_t deltas[64];

    // A block that is wall-to-wall "XXXX," (4 one-char fields + comma) has
    // its delimiter bits at positions 4,9,14,.. and no other structure.
    // `kComma5` precomputes that pattern; matching it lets the whole block
    // be processed as `N/5` segments in a tight loop with no per-segment
    // branches. Only the first kSeg5*5 bytes are constrained; the trailing
    // N mod 5 bytes belong to the next segment and are reloaded.
    const size_t kSeg5 = N / 5;
    uint64_t comma5 = 0;
    for (size_t i = 4; i < kSeg5 * 5; i += 5)
        comma5 |= (uint64_t { 1 } << i);
    const uint64_t kComma5 = comma5;
    const uint64_t kMask5 = MaskBelow(kSeg5 * 5);

    size_t rows = 0;
    size_t pos = 0;

    // A segment that starts inside a block but whose delimiter hasn't been
    // seen yet is left for the next block (pos is set to its start, the
    // next LoadU reads from there). A segment longer than one block, or the
    // final < N-byte tail, bails to the scalar path.
    while (pos + N <= len) {
        uint64_t delim_bits, semi_bits, cont_bits, invalid_bits;
        ClassifyBlock(d, bytes + pos, sextets, delim_bits, semi_bits, cont_bits, invalid_bits);

        // Uniform-block fast path: every segment is a 4-field, all-1-char
        // "XXXX," and the block starts on a segment boundary. This is the
        // measured 76% case on bundler output, and large maps have long
        // runs of it. Sign-magnitude decode of every sextet happens in SIMD
        // (values fit i8), then the serial accumulate is a straight
        // dependency chain of adds with one fused range check at the end.
        if (((cont_bits | semi_bits | invalid_bits | (delim_bits ^ kComma5)) & kMask5) == 0
            && HWY_LIKELY(rows + kSeg5 <= cap)) {
            const auto sx = hn::Load(d, sextets);
            hn::Store(SignMagI8(d, sx), hn::RebindToSigned<decltype(d)>(), deltas);

            const int32_t s_gc = gen_col, s_si = src_idx,
                          s_ol = orig_line, s_oc = orig_col;
            int32_t sort = 0, range = 0;
            const int8_t* dp = deltas;
            int32_t* og = out_generated + 2 * rows;
            int32_t* oo = out_original + 2 * rows;
            int32_t* os = out_src_idx + rows;
            int32_t* on = out_name_idx + rows;
            // 4-field rows carry the previous 5-field segment's name, or
            // -1 if none seen yet (matches the scalar parser: rows appended
            // before `ensure_with_names` get name_index = -1 via to_named).
            const int32_t nv = has_names ? name_idx : -1;
            for (size_t k = 0; k < kSeg5; ++k) {
                const int32_t d0 = dp[0];
                gen_col += d0;
                sort |= d0;
                src_idx += dp[1];
                orig_line += dp[2];
                orig_col += dp[3];
                range |= gen_col | src_idx | (sources_count - 1 - src_idx)
                    | orig_line | orig_col;
                og[2 * k] = gen_line;
                og[2 * k + 1] = gen_col;
                oo[2 * k] = orig_line;
                oo[2 * k + 1] = orig_col;
                os[k] = src_idx;
                on[k] = nv;
                dp += 5;
            }
            if (HWY_UNLIKELY(range < 0)) {
                // One of the accumulators went out of range somewhere in
                // this block. Restore block-entry state and hand the block
                // to the general per-segment loop, which bails at the exact
                // segment so scalar reports the right byte offset.
                gen_col = s_gc;
                src_idx = s_si;
                orig_line = s_ol;
                orig_col = s_oc;
                goto general;
            }
            needs_sort |= (sort < 0) ? 1 : 0;
            rows += kSeg5;
            pos += kSeg5 * 5;
            state[kStFastBlocks] += 1;
            continue;
        }

    general:;
        state[kStSlowBlocks] += 1;
        // An invalid (non-base64, non-delimiter) byte anywhere in the block:
        // process whole segments that end before it, then bail at the start
        // of the segment that contains it. `first_invalid` is N when none.
        const size_t first_invalid = invalid_bits
            ? static_cast<size_t>(hwy::Num0BitsBelowLS1Bit_Nonzero64(invalid_bits))
            : N;

        // The general per-segment loop keeps the four bitmaps shifted so
        // that bit 0 is always the current position; `p` accumulates the
        // bytes consumed so far within this block.
        uint64_t delim = delim_bits;
        uint64_t semi = semi_bits;
        uint64_t cont = cont_bits;
        size_t p = 0;

        for (;;) {
            // Leading ';' run.
            if (HWY_UNLIKELY(semi & 1)) {
                // semi's bits >= N are always 0 (StoreMaskBits writes only
                // N bits into a zeroed buffer), so ~semi is nonzero for any
                // N < 64; for N == 64 an all-';' block makes ~semi == 0.
                const uint64_t ns = ~semi;
                if (HWY_UNLIKELY(ns == 0)) {
                    gen_line += static_cast<int32_t>(N);
                    gen_col = 0;
                    p = N;
                    break;
                }
                const size_t run = static_cast<size_t>(hwy::Num0BitsBelowLS1Bit_Nonzero64(ns));
                gen_line += static_cast<int32_t>(run);
                gen_col = 0;
                delim >>= run;
                semi >>= run;
                cont >>= run;
                p += run;
            }
            if (p >= N)
                break;

            // A ',' with no preceding segment never occurs in well-formed
            // maps; let the scalar path classify it.
            if (HWY_UNLIKELY(delim & 1))
                goto bail;

            if (delim == 0) {
                // Segment straddles the block boundary. Reload with this
                // segment at the start of the next block; if the segment
                // is itself >= N bytes it still straddles and we bail.
                if (p == 0)
                    goto bail;
                break;
            }
            const size_t seg_len = static_cast<size_t>(hwy::Num0BitsBelowLS1Bit_Nonzero64(delim));

            // Invalid byte inside this segment → bail so scalar re-decodes it.
            if (HWY_UNLIKELY(p + seg_len > first_invalid))
                goto bail;

            // The LAST sextet of a VLQ has cont==0, so a VLQ whose final
            // byte still has cont set is truncated by the delimiter.
            if (HWY_UNLIKELY((cont >> (seg_len - 1)) & 1))
                goto bail;
            const uint64_t seg_cont = cont & ((uint64_t { 1 } << seg_len) - 1);
            const size_t field_count = seg_len - static_cast<size_t>(hwy::PopCount(seg_cont));

            int32_t d_gen, d_src = 0, d_ol = 0, d_oc = 0, d_name = 0;
            const uint8_t* sp = sextets + p;
            if (HWY_LIKELY(field_count == 4 && seg_cont == 0)) {
                // Hot path: 4 one-char fields.
                if (HWY_UNLIKELY(rows >= cap))
                    goto bail;
                d_gen = SignMag(sp[0]);
                d_src = SignMag(sp[1]);
                d_ol = SignMag(sp[2]);
                d_oc = SignMag(sp[3]);
            } else {
                if (field_count != 4 && field_count != 5 && field_count != 1)
                    goto bail;
                if (field_count != 1 && HWY_UNLIKELY(rows >= cap))
                    goto bail;
                if (seg_cont == 0) {
                    d_gen = SignMag(sp[0]);
                    if (field_count >= 4) {
                        d_src = SignMag(sp[1]);
                        d_ol = SignMag(sp[2]);
                        d_oc = SignMag(sp[3]);
                        if (field_count == 5)
                            d_name = SignMag(sp[4]);
                    }
                } else {
                    size_t q = p;
                    d_gen = DecodeVlqSextets(sextets, cont_bits, q, p + seg_len);
                    if (field_count >= 4) {
                        d_src = DecodeVlqSextets(sextets, cont_bits, q, p + seg_len);
                        d_ol = DecodeVlqSextets(sextets, cont_bits, q, p + seg_len);
                        d_oc = DecodeVlqSextets(sextets, cont_bits, q, p + seg_len);
                        if (field_count == 5)
                            d_name = DecodeVlqSextets(sextets, cont_bits, q, p + seg_len);
                    }
                }
            }

            // Accumulate and range-check. On any out-of-range value, bail at
            // this segment's start WITHOUT committing: scalar re-decodes it
            // and reports the exact same ParseResult::Fail as before.
            const int32_t n_gen_col = gen_col + d_gen;
            if (HWY_UNLIKELY(n_gen_col < 0))
                goto bail;

            if (HWY_UNLIKELY(field_count == 1)) {
                needs_sort |= (d_gen < 0) ? 1 : 0;
                gen_col = n_gen_col;
                const size_t adv = seg_len + ((semi >> seg_len) & 1 ? 0 : 1);
                delim >>= adv;
                semi >>= adv;
                cont >>= adv;
                p += adv;
                continue;
            }

            const int32_t n_src_idx = src_idx + d_src;
            const int32_t n_orig_line = orig_line + d_ol;
            const int32_t n_orig_col = orig_col + d_oc;
            if (HWY_UNLIKELY((n_src_idx | (sources_count - 1 - n_src_idx)
                    | n_orig_line | n_orig_col)
                    < 0))
                goto bail;

            // Commit.
            needs_sort |= (d_gen < 0) ? 1 : 0;
            gen_col = n_gen_col;
            src_idx = n_src_idx;
            orig_line = n_orig_line;
            orig_col = n_orig_col;
            if (field_count == 5) {
                name_idx += d_name;
                has_names = 1;
            }

            out_generated[2 * rows] = gen_line;
            out_generated[2 * rows + 1] = gen_col;
            out_original[2 * rows] = orig_line;
            out_original[2 * rows + 1] = orig_col;
            out_src_idx[rows] = src_idx;
            out_name_idx[rows] = has_names ? name_idx : -1;
            rows += 1;

            const size_t adv = seg_len + ((semi >> seg_len) & 1 ? 0 : 1);
            delim >>= adv;
            semi >>= adv;
            cont >>= adv;
            p += adv;
        }

        pos += p;
        continue;

    bail:
        pos += p;
        goto done;
    }

done:
    // Reached on bail, or when fewer than N bytes remain. Either way, hand
    // the remainder (if any) to the scalar path with state as of the last
    // fully-committed segment.
    *err_at = pos;
    state[kStGenLine] = gen_line;
    state[kStGenCol] = gen_col;
    state[kStOrigLine] = orig_line;
    state[kStOrigCol] = orig_col;
    state[kStSrcIdx] = src_idx;
    state[kStNameIdx] = name_idx;
    state[kStNeedsSort] = needs_sort;
    state[kStHasNames] = has_names;
    return rows;
}

} // namespace HWY_NAMESPACE
} // namespace bun
HWY_AFTER_NAMESPACE();

#if HWY_ONCE

namespace bun {

HWY_EXPORT(ParseMappingsImpl);

extern "C" {

size_t highway_parse_mappings(const uint8_t* bytes, size_t len,
    int32_t* out_generated, int32_t* out_original,
    int32_t* out_src_idx, int32_t* out_name_idx,
    size_t cap, int32_t sources_count,
    int32_t* state, size_t* err_at)
{
    return HWY_DYNAMIC_DISPATCH(ParseMappingsImpl)(bytes, len,
        out_generated, out_original, out_src_idx, out_name_idx,
        cap, sources_count, state, err_at);
}

} // extern "C"

} // namespace bun

#endif // HWY_ONCE
