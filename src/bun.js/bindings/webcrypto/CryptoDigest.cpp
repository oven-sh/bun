/*
 * Copyright (C) 2018 Sony Interactive Entertainment Inc.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 * 1. Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY APPLE INC. AND ITS CONTRIBUTORS ``AS IS''
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO,
 * THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL APPLE INC. OR ITS CONTRIBUTORS
 * BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 * CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 * SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
 * INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
 * CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF
 * THE POSSIBILITY OF SUCH DAMAGE.
 */

#include "config.h"
#include "CryptoDigest.h"

#include <array>
#include <cstring>
#include <openssl/sha.h>

namespace {

// Keccak-f[1600] permutation and SHA-3 sponge, used to implement the
// fixed-output SHA3-256/384/512 hashes from FIPS 202.
//
// BoringSSL's internal keccak_* helpers only expose SHA3-256 and SHA3-512,
// so we provide a small self-contained implementation here rather than
// depending on internal BoringSSL headers. The same state machine can be
// extended with SHAKE/cSHAKE/TurboSHAKE domain separators when those
// XOFs land alongside the rest of the WICG "Modern Algorithms" spec.

struct KeccakState {
    uint64_t lanes[25];
};

static constexpr uint64_t kKeccakRoundConstants[24] = {
    0x0000000000000001ULL,
    0x0000000000008082ULL,
    0x800000000000808aULL,
    0x8000000080008000ULL,
    0x000000000000808bULL,
    0x0000000080000001ULL,
    0x8000000080008081ULL,
    0x8000000000008009ULL,
    0x000000000000008aULL,
    0x0000000000000088ULL,
    0x0000000080008009ULL,
    0x000000008000000aULL,
    0x000000008000808bULL,
    0x800000000000008bULL,
    0x8000000000008089ULL,
    0x8000000000008003ULL,
    0x8000000000008002ULL,
    0x8000000000000080ULL,
    0x000000000000800aULL,
    0x800000008000000aULL,
    0x8000000080008081ULL,
    0x8000000000008080ULL,
    0x0000000080000001ULL,
    0x8000000080008008ULL,
};

static inline uint64_t rotl64(uint64_t x, unsigned n)
{
    return (x << n) | (x >> (64 - n));
}

static void keccakF1600(KeccakState& state)
{
    for (unsigned round = 0; round < 24; round++) {
        // θ step
        uint64_t c[5];
        for (unsigned x = 0; x < 5; x++)
            c[x] = state.lanes[x] ^ state.lanes[x + 5] ^ state.lanes[x + 10] ^ state.lanes[x + 15] ^ state.lanes[x + 20];
        uint64_t d[5];
        for (unsigned x = 0; x < 5; x++)
            d[x] = c[(x + 4) % 5] ^ rotl64(c[(x + 1) % 5], 1);
        for (unsigned x = 0; x < 5; x++) {
            for (unsigned y = 0; y < 5; y++)
                state.lanes[y * 5 + x] ^= d[x];
        }

        // ρ and π steps (in-place along the 24-step trail)
        uint64_t prev = state.lanes[1];
        static constexpr std::pair<int, int> piRho[24] = {
            { 10, 1 },
            { 7, 3 },
            { 11, 6 },
            { 17, 10 },
            { 18, 15 },
            { 3, 21 },
            { 5, 28 },
            { 16, 36 },
            { 8, 45 },
            { 21, 55 },
            { 24, 2 },
            { 4, 14 },
            { 15, 27 },
            { 23, 41 },
            { 19, 56 },
            { 13, 8 },
            { 12, 25 },
            { 2, 43 },
            { 20, 62 },
            { 14, 18 },
            { 22, 39 },
            { 9, 61 },
            { 6, 20 },
            { 1, 44 },
        };
        for (const auto& step : piRho) {
            uint64_t rotated = rotl64(prev, static_cast<unsigned>(step.second));
            prev = state.lanes[step.first];
            state.lanes[step.first] = rotated;
        }

        // χ step
        for (unsigned y = 0; y < 5; y++) {
            const unsigned row = 5 * y;
            const uint64_t a0 = state.lanes[row];
            const uint64_t a1 = state.lanes[row + 1];
            state.lanes[row] ^= ~a1 & state.lanes[row + 2];
            state.lanes[row + 1] ^= ~state.lanes[row + 2] & state.lanes[row + 3];
            state.lanes[row + 2] ^= ~state.lanes[row + 3] & state.lanes[row + 4];
            state.lanes[row + 3] ^= ~state.lanes[row + 4] & a0;
            state.lanes[row + 4] ^= ~a0 & a1;
        }

        // ι step
        state.lanes[0] ^= kKeccakRoundConstants[round];
    }
}

static inline uint64_t loadLE64(const uint8_t* bytes)
{
    uint64_t v;
    std::memcpy(&v, bytes, sizeof(v));
#if defined(__BIG_ENDIAN__) || (defined(__BYTE_ORDER__) && __BYTE_ORDER__ == __ORDER_BIG_ENDIAN__)
    v = __builtin_bswap64(v);
#endif
    return v;
}

static inline void storeLE64(uint8_t* bytes, uint64_t v)
{
#if defined(__BIG_ENDIAN__) || (defined(__BYTE_ORDER__) && __BYTE_ORDER__ == __ORDER_BIG_ENDIAN__)
    v = __builtin_bswap64(v);
#endif
    std::memcpy(bytes, &v, sizeof(v));
}

// Streaming SHA-3 sponge for one of the fixed output sizes.
struct Sha3Context {
    KeccakState state {};
    // Input bytes buffered before the next permutation. Sized for the largest
    // fixed-output FIPS 202 rate, which is SHA3-224's 144 bytes (not yet
    // registered); the three variants this file ships only need up to
    // SHA3-256's 136-byte rate. XOF variants are NOT representable with this
    // struct as-is: SHAKE128's rate is 168 bytes (would overflow this
    // buffer), and both SHAKE variants also need a different digestLength
    // model because their output is variable-length. Adding SHAKE support
    // requires resizing this buffer and teaching sha3Final to squeeze across
    // multiple rate-sized blocks.
    uint8_t buffer[144] {};
    size_t bufferLength = 0;
    size_t rateBytes = 0;
    size_t digestLength = 0;
};

static void sha3Init(Sha3Context& ctx, size_t outputBytes)
{
    ctx = {};
    ctx.digestLength = outputBytes;
    // rate = 1600 - 2 * outputBits
    const size_t capacityBytes = 2 * outputBytes;
    ctx.rateBytes = 200 - capacityBytes;
}

static void sha3Update(Sha3Context& ctx, const uint8_t* input, size_t length)
{
    while (length > 0) {
        const size_t space = ctx.rateBytes - ctx.bufferLength;
        const size_t take = length < space ? length : space;
        std::memcpy(ctx.buffer + ctx.bufferLength, input, take);
        ctx.bufferLength += take;
        input += take;
        length -= take;

        if (ctx.bufferLength == ctx.rateBytes) {
            // Absorb one full rate-sized block.
            const size_t rateLanes = ctx.rateBytes / 8;
            for (size_t i = 0; i < rateLanes; i++)
                ctx.state.lanes[i] ^= loadLE64(ctx.buffer + 8 * i);
            keccakF1600(ctx.state);
            ctx.bufferLength = 0;
        }
    }
}

static void sha3Final(Sha3Context& ctx, uint8_t* output)
{
    // This single-block squeeze is only valid when the entire digest fits
    // inside one rate-sized squeeze block. All three currently registered
    // variants satisfy that (SHA3-256: 32 < 136, SHA3-384: 48 < 104,
    // SHA3-512: 64 < 72); see Sha3Context's comment above. When XOF
    // variants (SHAKE / cSHAKE / TurboSHAKE) are added they will need a
    // multi-block squeeze loop — this assert catches anyone accidentally
    // taking this path with a variant that doesn't satisfy the invariant
    // before it silently reads capacity bits out of the state.
    ASSERT(ctx.digestLength <= ctx.rateBytes);

    // Pad10*1 with the SHA-3 domain separator 0x06.
    std::memset(ctx.buffer + ctx.bufferLength, 0, ctx.rateBytes - ctx.bufferLength);
    ctx.buffer[ctx.bufferLength] |= 0x06;
    ctx.buffer[ctx.rateBytes - 1] |= 0x80;

    const size_t rateLanes = ctx.rateBytes / 8;
    for (size_t i = 0; i < rateLanes; i++)
        ctx.state.lanes[i] ^= loadLE64(ctx.buffer + 8 * i);
    keccakF1600(ctx.state);

    // Squeeze. For the fixed-output SHA-3 variants the digest always fits
    // inside a single rate-sized squeeze block: the smallest rate is
    // SHA3-512's 72 bytes and its digest is 64 bytes, so no additional
    // permutation is needed.
    size_t produced = 0;
    uint8_t lane[8];
    while (produced < ctx.digestLength) {
        const size_t laneIndex = produced / 8;
        storeLE64(lane, ctx.state.lanes[laneIndex]);
        const size_t take = std::min<size_t>(8, ctx.digestLength - produced);
        std::memcpy(output + produced, lane, take);
        produced += take;
    }
}

struct SHA3_256Functions {
    static void init(Sha3Context* ctx) { sha3Init(*ctx, 32); }
    static void update(Sha3Context* ctx, const void* data, size_t len) { sha3Update(*ctx, static_cast<const uint8_t*>(data), len); }
    static void final(uint8_t* out, Sha3Context* ctx) { sha3Final(*ctx, out); }
    static constexpr size_t digestLength = 32;
};

struct SHA3_384Functions {
    static void init(Sha3Context* ctx) { sha3Init(*ctx, 48); }
    static void update(Sha3Context* ctx, const void* data, size_t len) { sha3Update(*ctx, static_cast<const uint8_t*>(data), len); }
    static void final(uint8_t* out, Sha3Context* ctx) { sha3Final(*ctx, out); }
    static constexpr size_t digestLength = 48;
};

struct SHA3_512Functions {
    static void init(Sha3Context* ctx) { sha3Init(*ctx, 64); }
    static void update(Sha3Context* ctx, const void* data, size_t len) { sha3Update(*ctx, static_cast<const uint8_t*>(data), len); }
    static void final(uint8_t* out, Sha3Context* ctx) { sha3Final(*ctx, out); }
    static constexpr size_t digestLength = 64;
};

struct SHA1Functions {
    static constexpr auto init = SHA1_Init;
    static constexpr auto update = SHA1_Update;
    static constexpr auto final = SHA1_Final;
    static constexpr size_t digestLength = SHA_DIGEST_LENGTH;
};

struct SHA224Functions {
    static constexpr auto init = SHA224_Init;
    static constexpr auto update = SHA224_Update;
    static constexpr auto final = SHA224_Final;
    static constexpr size_t digestLength = SHA224_DIGEST_LENGTH;
};

struct SHA256Functions {
    static constexpr auto init = SHA256_Init;
    static constexpr auto update = SHA256_Update;
    static constexpr auto final = SHA256_Final;
    static constexpr size_t digestLength = SHA256_DIGEST_LENGTH;
};

struct SHA384Functions {
    static constexpr auto init = SHA384_Init;
    static constexpr auto update = SHA384_Update;
    static constexpr auto final = SHA384_Final;
    static constexpr size_t digestLength = SHA384_DIGEST_LENGTH;
};

struct SHA512Functions {
    static constexpr auto init = SHA512_Init;
    static constexpr auto update = SHA512_Update;
    static constexpr auto final = SHA512_Final;
    static constexpr size_t digestLength = SHA512_DIGEST_LENGTH;
};
}

namespace PAL {

struct CryptoDigestContext {
    virtual ~CryptoDigestContext() = default;
    virtual void addBytes(const void* input, size_t length) = 0;
    virtual Vector<uint8_t> computeHash() = 0;
};

template<typename SHAContext, typename SHAFunctions>
struct CryptoDigestContextImpl : public CryptoDigestContext {
    WTF_DEPRECATED_MAKE_STRUCT_FAST_ALLOCATED(CryptoDigestContextImpl);

    static std::unique_ptr<CryptoDigestContext> create()
    {
        return makeUnique<CryptoDigestContextImpl>();
    }

    CryptoDigestContextImpl()
    {
        SHAFunctions::init(&m_context);
    }

    void addBytes(const void* input, size_t length) override
    {
        SHAFunctions::update(&m_context, input, length);
    }

    Vector<uint8_t> computeHash() override
    {
        Vector<uint8_t> result(SHAFunctions::digestLength);
        SHAFunctions::final(result.begin(), &m_context);
        return result;
    }

private:
    SHAContext m_context;
};

CryptoDigest::CryptoDigest()
{
}

CryptoDigest::~CryptoDigest()
{
}

std::unique_ptr<CryptoDigest> CryptoDigest::create(CryptoDigest::Algorithm algorithm)
{
    std::unique_ptr<CryptoDigest> digest(new CryptoDigest);

    switch (algorithm) {
    case CryptoDigest::Algorithm::SHA_1:
        digest->m_context = CryptoDigestContextImpl<SHA_CTX, SHA1Functions>::create();
        return digest;
    case CryptoDigest::Algorithm::SHA_224:
        digest->m_context = CryptoDigestContextImpl<SHA256_CTX, SHA224Functions>::create();
        return digest;
    case CryptoDigest::Algorithm::SHA_256:
        digest->m_context = CryptoDigestContextImpl<SHA256_CTX, SHA256Functions>::create();
        return digest;
    case CryptoDigest::Algorithm::SHA_384:
        digest->m_context = CryptoDigestContextImpl<SHA512_CTX, SHA384Functions>::create();
        return digest;
    case CryptoDigest::Algorithm::SHA_512:
        digest->m_context = CryptoDigestContextImpl<SHA512_CTX, SHA512Functions>::create();
        return digest;
    case CryptoDigest::Algorithm::SHA3_256:
        digest->m_context = CryptoDigestContextImpl<Sha3Context, SHA3_256Functions>::create();
        return digest;
    case CryptoDigest::Algorithm::SHA3_384:
        digest->m_context = CryptoDigestContextImpl<Sha3Context, SHA3_384Functions>::create();
        return digest;
    case CryptoDigest::Algorithm::SHA3_512:
        digest->m_context = CryptoDigestContextImpl<Sha3Context, SHA3_512Functions>::create();
        return digest;
    }

    return nullptr;
}

void CryptoDigest::addBytes(const void* input, size_t length)
{
    ASSERT(m_context);
    m_context->addBytes(input, length);
}

Vector<uint8_t> CryptoDigest::computeHash()
{
    ASSERT(m_context);
    return m_context->computeHash();
}

} // namespace PAL
