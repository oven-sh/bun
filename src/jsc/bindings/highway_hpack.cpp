// SIMD decoder for HPACK's Huffman code (RFC 7541 Appendix B). How it works: src/hpack/huffman_simd.md

#undef HWY_TARGET_INCLUDE
#define HWY_TARGET_INCLUDE "highway_hpack.cpp"
#include <hwy/foreach_target.h> // Must come before highway.h

#include <hwy/highway.h>
#include "highway_dispatch.h"

#include <cstddef>
#include <cstdint>

#ifndef BUN_HWY_HPACK_TABLES_DEFINED
#define BUN_HWY_HPACK_TABLES_DEFINED

namespace bun {
namespace hpack_huffman {

struct Tables {
    // The symbol whose code these 8 bits start with.
    alignas(64) uint8_t symbol[256] = {};
    // Its length, from the first 6 of them. Wrong for 0xfe and 0xff, where a longer code starts.
    alignas(64) uint8_t length[64] = {};
    // Byte k of the 64-bit lane q is input byte q + 7 - k: 8 bytes from q on, the first on top.
    alignas(64) uint8_t lanes[64] = {};
    // How far to rotate such a lane right for its low 8 bits to be those from bit k on.
    alignas(64) uint8_t rotate[64] = {};
};

inline constexpr Tables kTables = [] {
    Tables tables;
    // The code is canonical: in the order of these, shortest first.
    constexpr const char* symbols[] = { "012aceiost", " %-./3456789=A_bdfghlmnpru", ":BCDEFGHIJKLMNOPQRSTUVWYjkqvwxyz", "&*,;XZ" };
    size_t bits = 0;
    for (size_t length = 5; length <= 8; length++) {
        for (const char* symbol = symbols[length - 5]; *symbol; symbol++) {
            for (size_t i = 0; i < (size_t { 1 } << (8 - length)); i++, bits++) {
                tables.symbol[bits] = static_cast<uint8_t>(*symbol);
                tables.length[bits >> 2] = static_cast<uint8_t>(length);
            }
        }
    }
    for (size_t i = 0; i < 64; i++) {
        tables.lanes[i] = static_cast<uint8_t>(i / 8 + 7 - i % 8);
        tables.rotate[i] = static_cast<uint8_t>(56 - i % 8);
    }
    return tables;
}();

} // namespace hpack_huffman
} // namespace bun

#endif // BUN_HWY_HPACK_TABLES_DEFINED

HWY_BEFORE_NAMESPACE();
namespace bun {
namespace HWY_NAMESPACE {

namespace hn = hwy::HWY_NAMESPACE;

#if HWY_TARGET <= HWY_AVX3_DL

bool HpackHuffmanHasKernelImpl()
{
    return true;
}

// Moves `*bit_pos` on to where it stopped and returns how many bytes it wrote.
size_t HpackHuffmanDecodeShortImpl(const uint8_t* HWY_RESTRICT src, size_t src_len, size_t* HWY_RESTRICT bit_pos, uint8_t* HWY_RESTRICT out, size_t out_len)
{
    using bun::hpack_huffman::kTables;
    constexpr size_t kBlockBits = 56;
    constexpr size_t kMaxSymbols = 16;

    const hn::FixedTag<uint8_t, 64> d;
    const hn::FixedTag<uint8_t, 16> d16;
    const hn::FixedTag<uint64_t, 8> d64;
    const auto lookup = [d](auto table, auto index) { return hn::TableLookupLanes(table, hn::IndicesFromVec(d, index)); };
    const auto lookup2 = [d](auto low, auto high, auto index) { return hn::TwoTablesLookupLanes(d, low, high, hn::IndicesFromVec(d, index)); };

    const auto offsets = hn::Iota(d, 0);
    const auto lanes = hn::Load(d, kTables.lanes);
    const auto rotate = hn::Load(d, kTables.rotate);
    const auto lengths = hn::Load(d, kTables.length);
    const auto symbols0 = hn::Load(d, kTables.symbol);
    const auto symbols1 = hn::Load(d, kTables.symbol + 64);
    const auto symbols2 = hn::Load(d, kTables.symbol + 128);
    const auto symbols3 = hn::Load(d, kTables.symbol + 192);
    const auto in_block = hn::FirstN(d, kBlockBits);
    const auto odd1 = hn::TestBit(offsets, hn::Set(d, uint8_t { 1 }));
    const auto odd2 = hn::TestBit(offsets, hn::Set(d, uint8_t { 2 }));
    const auto odd4 = hn::TestBit(offsets, hn::Set(d, uint8_t { 4 }));
    const auto odd8 = hn::TestBit(offsets, hn::Set(d, uint8_t { 8 }));

    size_t base = *bit_pos / 8;
    size_t first = *bit_pos % 8;
    size_t written = 0;
    while (base < src_len && written + kMaxSymbols <= out_len) {
        const size_t left = src_len - base;
        // Ones after the end, like the padding. No short code starts with 8 of them.
        const auto input = left >= 16 ? hn::LoadU(d16, src + base) : hn::MaskedLoadOr(hn::Set(d16, uint8_t { 0xff }), hn::FirstN(d16, left), d16, src + base);
        const auto bits = hn::BitCast(d, hn::MultiRotateRight(hn::BitCast(d64, lookup(hn::ResizeBitCast(d, input), lanes)), rotate));

        const auto is_short = hn::And(in_block, hn::Lt(bits, hn::Set(d, uint8_t { 0xfe })));
        const auto jump1 = hn::Add(offsets, hn::IfThenElseZero(is_short, lookup(lengths, hn::ShiftRight<2>(bits))));
        const auto jump2 = lookup(jump1, jump1);
        const auto jump4 = lookup(jump2, jump2);
        const auto jump8 = lookup(jump4, jump4);
        const auto jump16 = lookup(jump8, jump8);
        const size_t stop = (hn::GetLane(hn::BitCast(d64, jump16)) >> (first * 8)) & 0xff;
        // A code that ends in what was added to the input. That is an error, and not one to report from here.
        if (left < 8 && stop > left * 8)
            break;

        auto starts = hn::Set(d, static_cast<uint8_t>(first));
        starts = hn::IfThenElse(odd1, lookup(jump1, starts), starts);
        starts = hn::IfThenElse(odd2, lookup(jump2, starts), starts);
        starts = hn::IfThenElse(odd4, lookup(jump4, starts), starts);
        starts = hn::IfThenElse(odd8, lookup(jump8, starts), starts);

        const auto low7 = hn::And(bits, hn::Set(d, uint8_t { 0x7f }));
        const auto symbols = hn::IfThenElse(hn::MaskFromVec(bits), lookup2(symbols2, symbols3, low7), lookup2(symbols0, symbols1, low7));
        hn::StoreU(hn::ResizeBitCast(d16, lookup(symbols, starts)), d16, out + written);
        written += hn::CountTrue(d16, hn::Lt(hn::ResizeBitCast(d16, starts), hn::Set(d16, static_cast<uint8_t>(stop))));

        if (stop < kBlockBits) {
            first = stop;
            break;
        }
        base += kBlockBits / 8;
        first = stop - kBlockBits;
    }
    *bit_pos = base * 8 + first;
    return written;
}

#else

bool HpackHuffmanHasKernelImpl()
{
    return false;
}

size_t HpackHuffmanDecodeShortImpl(const uint8_t* HWY_RESTRICT, size_t, size_t* HWY_RESTRICT, uint8_t* HWY_RESTRICT, size_t)
{
    return 0;
}

#endif

} // namespace HWY_NAMESPACE
} // namespace bun
HWY_AFTER_NAMESPACE();

#if HWY_ONCE

namespace bun {

HWY_EXPORT(HpackHuffmanHasKernelImpl);
HWY_EXPORT(HpackHuffmanDecodeShortImpl);

extern "C" {

bool highway_hpack_huffman_has_kernel()
{
    return BUN_HWY_DISPATCH(HpackHuffmanHasKernelImpl)();
}

size_t highway_hpack_huffman_decode_short(const uint8_t* src, size_t src_len, size_t* bit_pos, uint8_t* out, size_t out_len)
{
    return BUN_HWY_DISPATCH(HpackHuffmanDecodeShortImpl)(src, src_len, bit_pos, out, out_len);
}

} // extern "C"

} // namespace bun

#endif // HWY_ONCE
