#pragma once

#include "engine/text/ASCIILiteral.h"

#include <cstdint>

extern "C" {
unsigned engine_text_hash_latin1(const WTF::Latin1Character*, size_t length);
}

namespace WTF {

class StringHasher {
public:
    static unsigned computeHashAndMaskTop8Bits(std::span<const Latin1Character> characters) { return engine_text_hash_latin1(characters.data(), characters.size()); }

    // `bun_engine_text::hash_latin1`, for what the compiler lays out.
    static consteval unsigned computeLiteralHash(std::span<const char> bytes)
    {
        constexpr uint64_t secret[] = { 0x2d358dccaa6c78a5, 0x8bb84b93962eacc9, 0x4b33a62ed433d4a3 };
        auto mix = [](uint64_t a, uint64_t b) {
            auto product = static_cast<unsigned __int128>(a) * b;
            return static_cast<uint64_t>(product) ^ static_cast<uint64_t>(product >> 64);
        };
        auto read = [&](size_t at, size_t count = 8) {
            uint64_t word = 0;
            while (count--)
                word = word << 8 | static_cast<uint8_t>(bytes[at + count]);
            return word;
        };

        size_t length = bytes.size();
        uint64_t seed = mix(secret[0], secret[1]) ^ length;
        uint64_t a = 0;
        uint64_t b = 0;
        if (length > 16) {
            size_t at = 0;
            if (length > 48) {
                uint64_t second = seed;
                uint64_t third = seed;
                for (; length - at >= 48; at += 48) {
                    seed = mix(read(at) ^ secret[0], read(at + 8) ^ seed);
                    second = mix(read(at + 16) ^ secret[1], read(at + 24) ^ second);
                    third = mix(read(at + 32) ^ secret[2], read(at + 40) ^ third);
                }
                seed ^= second ^ third;
            }
            if (length - at > 16)
                seed = mix(read(at) ^ secret[2], read(at + 8) ^ seed ^ secret[1]);
            if (length - at > 32)
                seed = mix(read(at + 16) ^ secret[2], read(at + 24) ^ seed);
            a = read(length - 16);
            b = read(length - 8);
        } else if (length >= 4) {
            size_t delta = length >= 8 ? 4 : 0;
            a = read(0, 4) << 32 | read(length - 4, 4);
            b = read(delta, 4) << 32 | read(length - 4 - delta, 4);
        } else if (length) {
            a = read(0, 1) << 56 | read(length / 2, 1) << 32 | read(length - 1, 1);
        }
        auto product = static_cast<unsigned __int128>(a ^ secret[1]) * (b ^ seed);
        unsigned hash = mix(static_cast<uint64_t>(product) ^ secret[0] ^ length, static_cast<uint64_t>(product >> 64) ^ secret[1]) & 0xFFFFFF;
        return hash ? hash : 0x800000;
    }
};

}

using WTF::StringHasher;
