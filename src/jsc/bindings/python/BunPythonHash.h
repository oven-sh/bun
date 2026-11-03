#pragma once

// The hash functions behind hashlib: those of BoringSSL, and what it does not offer.
// - SHAKE: its Keccak is not in the public headers. What is, EVP_sha3_*(), has digests of a fixed length only. So Keccak is here
//   (after FIPS 202), and since it is, SHA-3 uses it too, which keeps a Hasher something that can be copied as it is.
// - BLAKE2 (after RFC 7693 and the BLAKE2 paper, which has the parameters RFC 7693 leaves out): BLAKE2B256_*() and BLAKE2B512_*()
//   take no key, salt, personalization, digest size or tree parameters, all of which hashlib has, and there is no BLAKE2s.

#include "BunPythonModule.h"

#include <openssl/md5.h>
#include <openssl/ripemd.h>
#include <openssl/sha.h>

namespace Bun {
namespace PythonModules {

struct KeccakState {
    uint64_t lanes[25];
    unsigned rate; // In bytes.
    unsigned position; // In the block being absorbed, or squeezed.
    uint8_t suffix; // The bits that end the message, and the first of the padding.

    void initialize(unsigned rateInBytes, uint8_t domainSuffix);
    void absorb(std::span<const uint8_t>);
    // Ends the message. What is squeezed after that is the digest.
    void finish();
    void squeeze(std::span<uint8_t>);
};

struct Blake2Parameters {
    unsigned digestSize;
    std::span<const uint8_t> key;
    std::span<const uint8_t> salt;
    std::span<const uint8_t> person;
    unsigned fanout { 1 };
    unsigned depth { 1 };
    uint32_t leafSize { 0 };
    uint64_t nodeOffset { 0 };
    unsigned nodeDepth { 0 };
    unsigned innerSize { 0 };
    bool isLastNode { false };
};

template<typename Word>
struct Blake2State {
    static constexpr unsigned blockSize = sizeof(Word) * 16;
    static constexpr unsigned maxDigestSize = sizeof(Word) * 8;
    static constexpr unsigned maxKeySize = sizeof(Word) * 8;
    static constexpr unsigned saltSize = sizeof(Word) * 2;
    static constexpr unsigned personSize = sizeof(Word) * 2;

    Word h[8];
    Word counter[2];
    uint8_t buffer[blockSize];
    unsigned buffered;
    unsigned digestSize;
    bool isLastNode;

    void initialize(const Blake2Parameters&);
    void update(std::span<const uint8_t>);
    void finish(uint8_t* digest);

private:
    void compress(const uint8_t* block, bool isLast);
};

using Blake2bState = Blake2State<uint64_t>;
using Blake2sState = Blake2State<uint32_t>;

enum class HashKind : uint8_t {
    MD5,
    SHA1,
    SHA224,
    SHA256,
    SHA384,
    SHA512,
    SHA512_224,
    SHA512_256,
    SHA3_224,
    SHA3_256,
    SHA3_384,
    SHA3_512,
    SHAKE128,
    SHAKE256,
    Blake2b,
    Blake2s,
    RIPEMD160,
    MD5SHA1, // One after the other, as TLS before 1.2 signs.
};
static constexpr unsigned numberOfHashKinds = static_cast<unsigned>(HashKind::MD5SHA1) + 1;

struct HashInfo {
    ASCIILiteral name;
    unsigned digestSize; // 0: as long as asked for. For BLAKE2, the longest.
    unsigned blockSize;
};

const HashInfo& infoFor(HashKind);
inline bool isExtendable(HashKind kind) { return kind == HashKind::SHAKE128 || kind == HashKind::SHAKE256; }
// By the names hashlib knows them by, and those OpenSSL does.
std::optional<HashKind> hashKindNamed(StringView);

static constexpr unsigned maxHashDigestSize = 64;
static constexpr unsigned maxHashBlockSize = 168;

// A hash in progress. It can be copied as it is.
struct Hasher {
    WTF_MAKE_STRUCT_TZONE_ALLOCATED(Hasher);

    HashKind kind;
    union {
        MD5_CTX md5;
        SHA_CTX sha1;
        SHA256_CTX sha256;
        SHA512_CTX sha512;
        KeccakState keccak;
        Blake2bState blake2b;
        Blake2sState blake2s;
        RIPEMD160_CTX ripemd160;
        struct {
            MD5_CTX md5;
            SHA_CTX sha1;
        } both;
    };

    Hasher() = default;
    explicit Hasher(HashKind kind) { initialize(kind); }

    // BLAKE2 with all its parameters at their defaults.
    void initialize(HashKind);
    void initializeBlake2(HashKind, const Blake2Parameters&);
    void update(std::span<const uint8_t>);
    // 0 for SHAKE.
    unsigned digestSize() const;
    // Of what has been hashed so far: more can follow. `digest` has room for digestSize() bytes.
    void digest(uint8_t* digest) const;
    // For SHAKE: as many bytes as there is room for.
    void digest(std::span<uint8_t>) const;
};

// HMAC with any of them but SHAKE. (RFC 2104)
struct HMACState {
    WTF_MAKE_STRUCT_TZONE_ALLOCATED(HMACState);

    Hasher inner;
    Hasher outer;

    void initialize(HashKind, std::span<const uint8_t> key);
    void update(std::span<const uint8_t> data) { inner.update(data); }
    unsigned digestSize() const { return inner.digestSize(); }
    void digest(uint8_t* digest) const;
};

// ---- For the modules ----

// The argument of update() and of the constructors. False: a TypeError, or a BufferError.
bool getDataToHash(JSGlobalObject*, JSValue, BufferHolder&);
// The `data` and `string` parameters of the constructors, of which one at most is given. False: an exception.
bool dataArgument(JSGlobalObject*, JSValue data, JSValue string, JSValue& result);
JSValue hexStringFrom(JSGlobalObject*, std::span<const uint8_t>);

// The methods and attributes of an HMAC object, a record with an HMACState: _hashlib and _hmac each have a type of them.
JSValue hmacUpdate(JSGlobalObject*, JSValue self, JSValue message);
JSValue hmacDigest(JSGlobalObject*, JSValue self);
JSValue hmacHexdigest(JSGlobalObject*, JSValue self);
JSValue hmacCopy(JSGlobalObject*, JSValue self);
JSValue hmacRepr(JSGlobalObject*, JSValue self);
JSValue hmacName(JSGlobalObject*, JSValue self);
JSValue hmacBlockSize(JSGlobalObject*, JSValue self);
JSValue hmacDigestSize(JSGlobalObject*, JSValue self);
// All at once. The buffers are held by the caller.
JSValue hmacOf(JSGlobalObject*, HashKind, BufferHolder& key, BufferHolder& message);

} // namespace PythonModules
} // namespace Bun
