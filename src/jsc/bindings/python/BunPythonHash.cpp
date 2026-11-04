#include "BunPythonHash.h"

#include <wtf/HexNumber.h>

namespace Bun {
namespace PythonModules {

WTF_MAKE_STRUCT_TZONE_ALLOCATED_IMPL(Hasher);
WTF_MAKE_STRUCT_TZONE_ALLOCATED_IMPL(HMACState);

template<typename Word>
static inline Word loadLittleEndian(const uint8_t* bytes)
{
    Word word = 0;
    for (unsigned i = 0; i < sizeof(Word); ++i)
        word |= static_cast<Word>(bytes[i]) << (8 * i);
    return word;
}

template<typename Word>
static inline void storeLittleEndian(uint8_t* bytes, Word word)
{
    for (unsigned i = 0; i < sizeof(Word); ++i)
        bytes[i] = static_cast<uint8_t>(word >> (8 * i));
}

// ---- Keccak (FIPS 202) ----

static void keccakPermute(uint64_t (&a)[25])
{
    // Section 3.2.5: the outputs of rc(t), gathered into one word for each round.
    static constexpr uint64_t roundConstants[24] = {
        0x0000000000000001ULL, 0x0000000000008082ULL, 0x800000000000808aULL, 0x8000000080008000ULL,
        0x000000000000808bULL, 0x0000000080000001ULL, 0x8000000080008081ULL, 0x8000000000008009ULL,
        0x000000000000008aULL, 0x0000000000000088ULL, 0x0000000080008009ULL, 0x000000008000000aULL,
        0x000000008000808bULL, 0x800000000000008bULL, 0x8000000000008089ULL, 0x8000000000008003ULL,
        0x8000000000008002ULL, 0x8000000000000080ULL, 0x000000000000800aULL, 0x800000008000000aULL,
        0x8000000080008081ULL, 0x8000000000008080ULL, 0x0000000080000001ULL, 0x8000000080008008ULL
    };
    // Table 2, for the lane (x, y) at index x + 5y.
    static constexpr unsigned rotations[25] = {
        0, 1, 62, 28, 27,
        36, 44, 6, 55, 20,
        3, 10, 43, 25, 39,
        41, 45, 15, 21, 8,
        18, 2, 61, 56, 14
    };

    for (unsigned round = 0; round < 24; ++round) {
        // theta
        uint64_t c[5];
        for (unsigned x = 0; x < 5; ++x)
            c[x] = a[x] ^ a[x + 5] ^ a[x + 10] ^ a[x + 15] ^ a[x + 20];
        for (unsigned x = 0; x < 5; ++x) {
            uint64_t d = c[(x + 4) % 5] ^ std::rotl(c[(x + 1) % 5], 1);
            for (unsigned y = 0; y < 25; y += 5)
                a[x + y] ^= d;
        }
        // rho and pi: the lane (x, y) goes to (y, 2x + 3y).
        uint64_t b[25];
        for (unsigned y = 0; y < 5; ++y) {
            for (unsigned x = 0; x < 5; ++x)
                b[y + 5 * ((2 * x + 3 * y) % 5)] = std::rotl(a[x + 5 * y], rotations[x + 5 * y]);
        }
        // chi
        for (unsigned y = 0; y < 25; y += 5) {
            for (unsigned x = 0; x < 5; ++x)
                a[x + y] = b[x + y] ^ (~b[(x + 1) % 5 + y] & b[(x + 2) % 5 + y]);
        }
        // iota
        a[0] ^= roundConstants[round];
    }
}

void KeccakState::initialize(unsigned rateInBytes, uint8_t domainSuffix)
{
    memset(lanes, 0, sizeof(lanes));
    rate = rateInBytes;
    position = 0;
    suffix = domainSuffix;
}

void KeccakState::absorb(std::span<const uint8_t> data)
{
    for (size_t i = 0; i < data.size();) {
        if (!(position % 8) && data.size() - i >= 8 && rate - position >= 8) {
            lanes[position / 8] ^= loadLittleEndian<uint64_t>(data.data() + i);
            position += 8;
            i += 8;
        } else {
            lanes[position / 8] ^= static_cast<uint64_t>(data[i]) << (8 * (position % 8));
            ++position;
            ++i;
        }
        if (position == rate) {
            keccakPermute(lanes);
            position = 0;
        }
    }
}

void KeccakState::finish()
{
    // pad10*1, after the bits of the suffix.
    lanes[position / 8] ^= static_cast<uint64_t>(suffix) << (8 * (position % 8));
    lanes[(rate - 1) / 8] ^= static_cast<uint64_t>(0x80) << (8 * ((rate - 1) % 8));
    keccakPermute(lanes);
    position = 0;
}

void KeccakState::squeeze(std::span<uint8_t> output)
{
    for (auto& byte : output) {
        if (position == rate) {
            keccakPermute(lanes);
            position = 0;
        }
        byte = static_cast<uint8_t>(lanes[position / 8] >> (8 * (position % 8)));
        ++position;
    }
}

// ---- BLAKE2 (RFC 7693) ----

template<typename Word> struct Blake2Constants;

template<> struct Blake2Constants<uint64_t> {
    static constexpr uint64_t iv[8] = {
        0x6a09e667f3bcc908ULL, 0xbb67ae8584caa73bULL, 0x3c6ef372fe94f82bULL, 0xa54ff53a5f1d36f1ULL,
        0x510e527fade682d1ULL, 0x9b05688c2b3e6c1fULL, 0x1f83d9abfb41bd6bULL, 0x5be0cd19137e2179ULL
    };
    static constexpr unsigned rounds = 12;
    static constexpr int rotations[4] = { 32, 24, 16, 63 };
};

template<> struct Blake2Constants<uint32_t> {
    static constexpr uint32_t iv[8] = {
        0x6a09e667U, 0xbb67ae85U, 0x3c6ef372U, 0xa54ff53aU, 0x510e527fU, 0x9b05688cU, 0x1f83d9abU, 0x5be0cd19U
    };
    static constexpr unsigned rounds = 10;
    static constexpr int rotations[4] = { 16, 12, 8, 7 };
};

static constexpr uint8_t blake2Sigma[10][16] = {
    { 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15 },
    { 14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3 },
    { 11, 8, 12, 0, 5, 2, 15, 13, 10, 14, 3, 6, 7, 1, 9, 4 },
    { 7, 9, 3, 1, 13, 12, 11, 14, 2, 6, 5, 10, 4, 0, 15, 8 },
    { 9, 0, 5, 7, 2, 4, 10, 15, 14, 1, 11, 12, 6, 8, 3, 13 },
    { 2, 12, 6, 10, 0, 11, 8, 3, 4, 13, 7, 5, 15, 14, 1, 9 },
    { 12, 5, 1, 15, 14, 13, 4, 10, 0, 7, 6, 3, 9, 2, 8, 11 },
    { 13, 11, 7, 14, 12, 1, 3, 9, 5, 0, 15, 4, 8, 6, 2, 10 },
    { 6, 15, 14, 9, 11, 3, 0, 8, 12, 2, 13, 7, 1, 4, 10, 5 },
    { 10, 2, 8, 4, 7, 6, 1, 5, 15, 11, 9, 14, 3, 12, 13, 0 },
};

template<typename Word>
void Blake2State<Word>::compress(const uint8_t* block, bool isLast)
{
    using Constants = Blake2Constants<Word>;
    Word m[16];
    for (unsigned i = 0; i < 16; ++i)
        m[i] = loadLittleEndian<Word>(block + i * sizeof(Word));
    Word v[16];
    for (unsigned i = 0; i < 8; ++i) {
        v[i] = h[i];
        v[i + 8] = Constants::iv[i];
    }
    v[12] ^= counter[0];
    v[13] ^= counter[1];
    if (isLast) {
        v[14] = ~v[14];
        if (isLastNode)
            v[15] = ~v[15];
    }

    auto mix = [&](unsigned a, unsigned b, unsigned c, unsigned d, Word x, Word y) {
        v[a] = v[a] + v[b] + x;
        v[d] = std::rotr(static_cast<Word>(v[d] ^ v[a]), Constants::rotations[0]);
        v[c] = v[c] + v[d];
        v[b] = std::rotr(static_cast<Word>(v[b] ^ v[c]), Constants::rotations[1]);
        v[a] = v[a] + v[b] + y;
        v[d] = std::rotr(static_cast<Word>(v[d] ^ v[a]), Constants::rotations[2]);
        v[c] = v[c] + v[d];
        v[b] = std::rotr(static_cast<Word>(v[b] ^ v[c]), Constants::rotations[3]);
    };
    for (unsigned round = 0; round < Constants::rounds; ++round) {
        const uint8_t* s = blake2Sigma[round % 10];
        mix(0, 4, 8, 12, m[s[0]], m[s[1]]);
        mix(1, 5, 9, 13, m[s[2]], m[s[3]]);
        mix(2, 6, 10, 14, m[s[4]], m[s[5]]);
        mix(3, 7, 11, 15, m[s[6]], m[s[7]]);
        mix(0, 5, 10, 15, m[s[8]], m[s[9]]);
        mix(1, 6, 11, 12, m[s[10]], m[s[11]]);
        mix(2, 7, 8, 13, m[s[12]], m[s[13]]);
        mix(3, 4, 9, 14, m[s[14]], m[s[15]]);
    }
    for (unsigned i = 0; i < 8; ++i)
        h[i] ^= v[i] ^ v[i + 8];
}

template<typename Word>
void Blake2State<Word>::initialize(const Blake2Parameters& parameters)
{
    // The parameter block (section 2.8 of the BLAKE2 paper): as many bytes as h has.
    uint8_t block[sizeof(Word) * 8] = {};
    block[0] = static_cast<uint8_t>(parameters.digestSize);
    block[1] = static_cast<uint8_t>(parameters.key.size());
    block[2] = static_cast<uint8_t>(parameters.fanout);
    block[3] = static_cast<uint8_t>(parameters.depth);
    storeLittleEndian<uint32_t>(block + 4, parameters.leafSize);
    unsigned offset;
    if constexpr (sizeof(Word) == 8) {
        storeLittleEndian<uint64_t>(block + 8, parameters.nodeOffset);
        offset = 16;
    } else {
        // 48 bits of it.
        for (unsigned i = 0; i < 6; ++i)
            block[8 + i] = static_cast<uint8_t>(parameters.nodeOffset >> (8 * i));
        offset = 14;
    }
    block[offset] = static_cast<uint8_t>(parameters.nodeDepth);
    block[offset + 1] = static_cast<uint8_t>(parameters.innerSize);
    memcpySpan(std::span { block }.subspan(sizeof(block) - saltSize - personSize), parameters.salt);
    memcpySpan(std::span { block }.subspan(sizeof(block) - personSize), parameters.person);

    for (unsigned i = 0; i < 8; ++i)
        h[i] = Blake2Constants<Word>::iv[i] ^ loadLittleEndian<Word>(block + i * sizeof(Word));
    counter[0] = counter[1] = 0;
    memset(buffer, 0, sizeof(buffer));
    buffered = 0;
    digestSize = parameters.digestSize;
    isLastNode = parameters.isLastNode;

    // The key, filled up with zeros, is the first block of the message.
    if (!parameters.key.empty()) {
        memcpySpan(std::span { buffer }, parameters.key);
        buffered = blockSize;
    }
}

template<typename Word>
void Blake2State<Word>::update(std::span<const uint8_t> data)
{
    // A full buffer waits until there is more, because the last block is compressed differently.
    while (!data.empty()) {
        if (buffered == blockSize) {
            counter[0] += blockSize;
            if (counter[0] < blockSize)
                ++counter[1];
            compress(buffer, false);
            buffered = 0;
        }
        size_t taken = std::min<size_t>(blockSize - buffered, data.size());
        memcpy(buffer + buffered, data.data(), taken);
        buffered += taken;
        data = data.subspan(taken);
    }
}

template<typename Word>
void Blake2State<Word>::finish(uint8_t* digest)
{
    counter[0] += buffered;
    if (counter[0] < buffered)
        ++counter[1];
    memset(buffer + buffered, 0, blockSize - buffered);
    compress(buffer, true);
    uint8_t all[maxDigestSize];
    for (unsigned i = 0; i < 8; ++i)
        storeLittleEndian<Word>(all + i * sizeof(Word), h[i]);
    memcpy(digest, all, digestSize);
}

template struct Blake2State<uint64_t>;
template struct Blake2State<uint32_t>;

// ---- All of them ----

static constexpr HashInfo hashInfos[numberOfHashKinds] = {
    { "md5"_s, 16, 64 },
    { "sha1"_s, 20, 64 },
    { "sha224"_s, 28, 64 },
    { "sha256"_s, 32, 64 },
    { "sha384"_s, 48, 128 },
    { "sha512"_s, 64, 128 },
    { "sha512_224"_s, 28, 128 },
    { "sha512_256"_s, 32, 128 },
    { "sha3_224"_s, 28, 144 },
    { "sha3_256"_s, 32, 136 },
    { "sha3_384"_s, 48, 104 },
    { "sha3_512"_s, 64, 72 },
    { "shake_128"_s, 0, 168 },
    { "shake_256"_s, 0, 136 },
    { "blake2b"_s, 64, 128 },
    { "blake2s"_s, 32, 64 },
    { "ripemd160"_s, 20, 64 },
    { "md5-sha1"_s, 36, 64 },
};

const HashInfo& infoFor(HashKind kind) { return hashInfos[static_cast<unsigned>(kind)]; }

std::optional<HashKind> hashKindNamed(StringView name)
{
    // hashlib's names are matched exactly, OpenSSL's whatever the case.
    static constexpr std::pair<ASCIILiteral, HashKind> namesOfOpenSSL[] = {
        { "md5"_s, HashKind::MD5 },
        { "ssl3-md5"_s, HashKind::MD5 },
        { "sha1"_s, HashKind::SHA1 },
        { "ssl3-sha1"_s, HashKind::SHA1 },
        { "sha224"_s, HashKind::SHA224 },
        { "sha256"_s, HashKind::SHA256 },
        { "sha384"_s, HashKind::SHA384 },
        { "sha512"_s, HashKind::SHA512 },
        { "ripemd160"_s, HashKind::RIPEMD160 },
        { "md5-sha1"_s, HashKind::MD5SHA1 },
        { "sha-1"_s, HashKind::SHA1 },
        { "sha-224"_s, HashKind::SHA224 },
        { "sha2-224"_s, HashKind::SHA224 },
        { "sha-256"_s, HashKind::SHA256 },
        { "sha2-256"_s, HashKind::SHA256 },
        { "sha-384"_s, HashKind::SHA384 },
        { "sha2-384"_s, HashKind::SHA384 },
        { "sha-512"_s, HashKind::SHA512 },
        { "sha2-512"_s, HashKind::SHA512 },
        { "sha512-224"_s, HashKind::SHA512_224 },
        { "sha-512/224"_s, HashKind::SHA512_224 },
        { "sha2-512/224"_s, HashKind::SHA512_224 },
        { "sha512-256"_s, HashKind::SHA512_256 },
        { "sha-512/256"_s, HashKind::SHA512_256 },
        { "sha2-512/256"_s, HashKind::SHA512_256 },
        { "sha3-224"_s, HashKind::SHA3_224 },
        { "sha3-256"_s, HashKind::SHA3_256 },
        { "sha3-384"_s, HashKind::SHA3_384 },
        { "sha3-512"_s, HashKind::SHA3_512 },
        { "shake128"_s, HashKind::SHAKE128 },
        { "shake-128"_s, HashKind::SHAKE128 },
        { "shake256"_s, HashKind::SHAKE256 },
        { "shake-256"_s, HashKind::SHAKE256 },
        { "blake2b512"_s, HashKind::Blake2b },
        { "blake2b-512"_s, HashKind::Blake2b },
        { "blake2s256"_s, HashKind::Blake2s },
        { "blake2s-256"_s, HashKind::Blake2s },
        { "ripemd"_s, HashKind::RIPEMD160 },
        { "ripemd-160"_s, HashKind::RIPEMD160 },
        { "rmd160"_s, HashKind::RIPEMD160 },
    };
    for (unsigned i = 0; i < numberOfHashKinds; ++i) {
        if (name == hashInfos[i].name)
            return static_cast<HashKind>(i);
    }
    if (name == "SHA512_224"_s)
        return HashKind::SHA512_224;
    if (name == "SHA512_256"_s)
        return HashKind::SHA512_256;
    for (auto& [itsName, kind] : namesOfOpenSSL) {
        if (equalIgnoringASCIICase(name, itsName))
            return kind;
    }
    return std::nullopt;
}

void Hasher::initialize(HashKind newKind)
{
    kind = newKind;
    switch (kind) {
    case HashKind::MD5:
        MD5_Init(&md5);
        return;
    case HashKind::SHA1:
        SHA1_Init(&sha1);
        return;
    case HashKind::SHA224:
        SHA224_Init(&sha256);
        return;
    case HashKind::SHA256:
        SHA256_Init(&sha256);
        return;
    case HashKind::SHA384:
        SHA384_Init(&sha512);
        return;
    case HashKind::SHA512:
        SHA512_Init(&sha512);
        return;
    case HashKind::SHA512_224:
        SHA512_224_Init(&sha512);
        return;
    case HashKind::SHA512_256:
        SHA512_256_Init(&sha512);
        return;
    case HashKind::SHA3_224:
    case HashKind::SHA3_256:
    case HashKind::SHA3_384:
    case HashKind::SHA3_512:
        keccak.initialize(infoFor(kind).blockSize, 0x06);
        return;
    case HashKind::SHAKE128:
    case HashKind::SHAKE256:
        keccak.initialize(infoFor(kind).blockSize, 0x1f);
        return;
    case HashKind::Blake2b:
    case HashKind::Blake2s:
        initializeBlake2(kind, { .digestSize = infoFor(kind).digestSize, .key = {}, .salt = {}, .person = {} });
        return;
    case HashKind::RIPEMD160:
        RIPEMD160_Init(&ripemd160);
        return;
    case HashKind::MD5SHA1:
        MD5_Init(&both.md5);
        SHA1_Init(&both.sha1);
        return;
    }
}

void Hasher::initializeBlake2(HashKind newKind, const Blake2Parameters& parameters)
{
    kind = newKind;
    if (kind == HashKind::Blake2b)
        blake2b.initialize(parameters);
    else
        blake2s.initialize(parameters);
}

void Hasher::update(std::span<const uint8_t> data)
{
    if (data.empty())
        return;
    switch (kind) {
    case HashKind::MD5:
        MD5_Update(&md5, data.data(), data.size());
        return;
    case HashKind::SHA1:
        SHA1_Update(&sha1, data.data(), data.size());
        return;
    case HashKind::SHA224:
    case HashKind::SHA256:
        SHA256_Update(&sha256, data.data(), data.size());
        return;
    case HashKind::SHA384:
    case HashKind::SHA512:
    case HashKind::SHA512_224:
    case HashKind::SHA512_256:
        SHA512_Update(&sha512, data.data(), data.size());
        return;
    case HashKind::SHA3_224:
    case HashKind::SHA3_256:
    case HashKind::SHA3_384:
    case HashKind::SHA3_512:
    case HashKind::SHAKE128:
    case HashKind::SHAKE256:
        keccak.absorb(data);
        return;
    case HashKind::Blake2b:
        blake2b.update(data);
        return;
    case HashKind::Blake2s:
        blake2s.update(data);
        return;
    case HashKind::RIPEMD160:
        RIPEMD160_Update(&ripemd160, data.data(), data.size());
        return;
    case HashKind::MD5SHA1:
        MD5_Update(&both.md5, data.data(), data.size());
        SHA1_Update(&both.sha1, data.data(), data.size());
        return;
    }
}

unsigned Hasher::digestSize() const
{
    if (kind == HashKind::Blake2b)
        return blake2b.digestSize;
    if (kind == HashKind::Blake2s)
        return blake2s.digestSize;
    return infoFor(kind).digestSize;
}

void Hasher::digest(uint8_t* result) const
{
    Hasher copy = *this;
    switch (kind) {
    case HashKind::MD5:
        MD5_Final(result, &copy.md5);
        return;
    case HashKind::SHA1:
        SHA1_Final(result, &copy.sha1);
        return;
    case HashKind::SHA224:
        SHA224_Final(result, &copy.sha256);
        return;
    case HashKind::SHA256:
        SHA256_Final(result, &copy.sha256);
        return;
    case HashKind::SHA384:
        SHA384_Final(result, &copy.sha512);
        return;
    case HashKind::SHA512:
        SHA512_Final(result, &copy.sha512);
        return;
    case HashKind::SHA512_224: {
        uint8_t whole[SHA512_224_DIGEST_BUFFER_LENGTH];
        SHA512_224_Final(whole, &copy.sha512);
        memcpy(result, whole, SHA512_224_DIGEST_LENGTH);
        return;
    }
    case HashKind::SHA512_256:
        SHA512_256_Final(result, &copy.sha512);
        return;
    case HashKind::SHA3_224:
    case HashKind::SHA3_256:
    case HashKind::SHA3_384:
    case HashKind::SHA3_512:
        copy.keccak.finish();
        copy.keccak.squeeze({ result, infoFor(kind).digestSize });
        return;
    case HashKind::SHAKE128:
    case HashKind::SHAKE256:
        // digestSize() bytes: none.
        return;
    case HashKind::Blake2b:
        copy.blake2b.finish(result);
        return;
    case HashKind::Blake2s:
        copy.blake2s.finish(result);
        return;
    case HashKind::RIPEMD160:
        RIPEMD160_Final(result, &copy.ripemd160);
        return;
    case HashKind::MD5SHA1:
        MD5_Final(result, &copy.both.md5);
        SHA1_Final(result + MD5_DIGEST_LENGTH, &copy.both.sha1);
        return;
    }
}

void Hasher::digest(std::span<uint8_t> result) const
{
    ASSERT(isExtendable(kind));
    KeccakState copy = keccak;
    copy.finish();
    copy.squeeze(result);
}

void HMACState::initialize(HashKind kind, std::span<const uint8_t> key)
{
    ASSERT(!isExtendable(kind));
    unsigned blockSize = infoFor(kind).blockSize;
    uint8_t block[maxHashBlockSize] = {};
    if (key.size() > blockSize) {
        Hasher hasher(kind);
        hasher.update(key);
        hasher.digest(block);
    } else
        memcpySpan(std::span { block }, key);

    uint8_t pad[maxHashBlockSize];
    for (unsigned i = 0; i < blockSize; ++i)
        pad[i] = block[i] ^ 0x36;
    inner.initialize(kind);
    inner.update({ pad, blockSize });
    for (unsigned i = 0; i < blockSize; ++i)
        pad[i] = block[i] ^ 0x5c;
    outer.initialize(kind);
    outer.update({ pad, blockSize });
}

void HMACState::digest(uint8_t* result) const
{
    uint8_t innerDigest[maxHashDigestSize];
    inner.digest(innerDigest);
    Hasher hasher = outer;
    hasher.update({ innerDigest, inner.digestSize() });
    hasher.digest(result);
}

// ---- For the modules ----

bool getDataToHash(JSGlobalObject* globalObject, JSValue value, BufferHolder& holder)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (isStr(value)) {
        raiseTypeError(globalObject, scope, "Strings must be encoded before hashing"_s);
        return false;
    }
    if (!hasBuffer(value)) {
        raiseTypeError(globalObject, scope, "object supporting the buffer API required"_s);
        return false;
    }
    RELEASE_AND_RETURN(scope, holder.get(value));
}

bool dataArgument(JSGlobalObject* globalObject, JSValue data, JSValue string, JSValue& result)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    result = data;
    if (!string)
        return true;
    if (data) {
        raiseTypeError(globalObject, scope, "'data' and 'string' are mutually exclusive and support for 'string' keyword parameter is slated for removal in a future version."_s);
        return false;
    }
    result = string;
    RELEASE_AND_RETURN(scope, warn(globalObject, runtime(globalObject).DeprecationWarning(), "the 'string' keyword parameter is deprecated since Python 3.15 and slated for removal in Python 3.19; use the 'data' keyword parameter or pass the data to hash as a positional argument instead"_s));
}

JSValue hexStringFrom(JSGlobalObject* globalObject, std::span<const uint8_t> bytes)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    std::span<Latin1Character> characters;
    String string = String::tryCreateUninitialized(bytes.size() * 2, characters);
    if (string.isNull())
        return raiseMemoryError(globalObject, scope, String());
    static constexpr char digits[] = "0123456789abcdef";
    for (size_t i = 0; i < bytes.size(); ++i) {
        characters[2 * i] = digits[bytes[i] >> 4];
        characters[2 * i + 1] = digits[bytes[i] & 15];
    }
    return makeStr(vm, WTF::move(string));
}

static HMACState& hmacStateOf(JSValue self) { return *stateOf<HMACState>(self); }

JSValue hmacUpdate(JSGlobalObject* globalObject, JSValue self, JSValue message)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    BufferHolder input(globalObject);
    if (failed(scope, getDataToHash(globalObject, message, input)))
        return {};
    hmacStateOf(self).update(input.buffer.span());
    return jsUndefined();
}

JSValue hmacDigest(JSGlobalObject* globalObject, JSValue self)
{
    uint8_t result[maxHashDigestSize];
    HMACState& state = hmacStateOf(self);
    state.digest(result);
    return bytesFrom(globalObject, { result, state.digestSize() });
}

JSValue hmacHexdigest(JSGlobalObject* globalObject, JSValue self)
{
    uint8_t result[maxHashDigestSize];
    HMACState& state = hmacStateOf(self);
    state.digest(result);
    return hexStringFrom(globalObject, { result, state.digestSize() });
}

JSValue hmacCopy(JSGlobalObject* globalObject, JSValue self)
{
    return createRecordWithState(globalObject, typeOf(globalObject, self), 0, makeUnique<HMACState>(hmacStateOf(self)));
}

JSValue hmacRepr(JSGlobalObject* globalObject, JSValue self)
{
    return makeStr(getVM(globalObject), makeString('<', infoFor(hmacStateOf(self).inner.kind).name, " HMAC object @ "_s, addressForRepr(globalObject, self), '>'));
}

JSValue hmacName(JSGlobalObject* globalObject, JSValue self) { return makeStr(getVM(globalObject), makeString("hmac-"_s, infoFor(hmacStateOf(self).inner.kind).name)); }
JSValue hmacBlockSize(JSGlobalObject*, JSValue self) { return jsNumber(infoFor(hmacStateOf(self).inner.kind).blockSize); }
JSValue hmacDigestSize(JSGlobalObject*, JSValue self) { return jsNumber(hmacStateOf(self).digestSize()); }

JSValue hmacOf(JSGlobalObject* globalObject, HashKind kind, BufferHolder& key, BufferHolder& message)
{
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    if (failed(scope, refreshBuffers(globalObject, key, message)))
        return {};
    HMACState state;
    state.initialize(kind, key.buffer.span());
    state.update(message.buffer.span());
    uint8_t result[maxHashDigestSize];
    state.digest(result);
    RELEASE_AND_RETURN(scope, bytesFrom(globalObject, { result, state.digestSize() }));
}

} // namespace PythonModules
} // namespace Bun
