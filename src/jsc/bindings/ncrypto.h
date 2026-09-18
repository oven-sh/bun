#pragma once

#include "root.h"

#ifdef ASSERT_ENABLED
#define NCRYPTO_DEVELOPMENT_CHECKS 1
#endif

#include <wtf/text/WTFString.h>
#include <wtf/text/StringView.h>
#include <wtf/Function.h>

#include <openssl/bio.h>
#include <openssl/bn.h>
#include <openssl/dh.h>
#include <openssl/dsa.h>
#include <openssl/ec.h>
#include <openssl/err.h>
#include <openssl/evp.h>
#include <openssl/hmac.h>
#include <openssl/kdf.h>
#include <openssl/rsa.h>
#include <openssl/ssl.h>
#include <openssl/x509.h>
#include <cstddef>
#include <functional>
#include <list>
#include <memory>
#include <optional>
#include <string>
#include <string_view>
// The FIPS-related functions are only available
// when the OpenSSL itself was compiled with FIPS support.
#if defined(OPENSSL_FIPS) && OPENSSL_VERSION_MAJOR < 3
#include <openssl/fips.h>
#endif // OPENSSL_FIPS

#if OPENSSL_VERSION_MAJOR >= 3
#define OSSL3_CONST const
#else
#define OSSL3_CONST
#endif

#ifdef __GNUC__
#define NCRYPTO_MUST_USE_RESULT __attribute__((warn_unused_result))
#else
#define NCRYPTO_MUST_USE_RESULT
#endif

#ifdef OPENSSL_IS_BORINGSSL
// Boringssl has opted to use size_t for some size related
// APIs while Openssl is still using ints
using OPENSSL_SIZE_T = size_t;
#else
using OPENSSL_SIZE_T = int;
#endif

namespace ncrypto {

// ============================================================================
// Utility macros

#if NCRYPTO_DEVELOPMENT_CHECKS
#define NCRYPTO_STR(x) #x
#define NCRYPTO_FAIL(MESSAGE) ASSERT_WITH_MESSAGE(false, MESSAGE)
#define NCRYPTO_ASSERT_EQUAL(LHS, RHS, MESSAGE) \
    ASSERT_WITH_MESSAGE(LHS == RHS, MESSAGE)
#define NCRYPTO_ASSERT_TRUE(COND) ASSERT_WITH_MESSAGE(COND, NCRYPTO_STR(COND))
#else
#define NCRYPTO_FAIL(MESSAGE)
#define NCRYPTO_ASSERT_EQUAL(LHS, RHS, MESSAGE)
#define NCRYPTO_ASSERT_TRUE(COND)
#endif

#define NCRYPTO_DISALLOW_COPY(Name) \
    Name(const Name&) = delete;     \
    Name& operator=(const Name&) = delete;
#define NCRYPTO_DISALLOW_MOVE(Name) \
    Name(Name&&) = delete;          \
    Name& operator=(Name&&) = delete;
#define NCRYPTO_DISALLOW_COPY_AND_MOVE(Name) \
    NCRYPTO_DISALLOW_COPY(Name)              \
    NCRYPTO_DISALLOW_MOVE(Name)
#define NCRYPTO_DISALLOW_NEW_DELETE()    \
    void* operator new(size_t) = delete; \
    void operator delete(void*) = delete;

[[noreturn]] inline void unreachable()
{
#ifdef __GNUC__
    __builtin_unreachable();
#elif defined(_MSC_VER)
    __assume(false);
#else
#endif
}

static constexpr int kX509NameFlagsMultiline = ASN1_STRFLGS_ESC_2253 | ASN1_STRFLGS_ESC_CTRL | ASN1_STRFLGS_UTF8_CONVERT | XN_FLAG_SEP_MULTILINE | XN_FLAG_FN_SN;

// ============================================================================
// Error handling utilities

// Capture the current OpenSSL Error Stack. The stack will be ordered such
// that the error currently at the top of the stack is at the end of the
// list and the error at the bottom of the stack is at the beginning.
class CryptoErrorList final {
public:
    enum class Option { NONE,
        CAPTURE_ON_CONSTRUCT };
    CryptoErrorList(Option option = Option::CAPTURE_ON_CONSTRUCT);

    void capture();

    inline size_t size() const { return errors_.size(); }
    inline bool empty() const { return errors_.empty(); }

    inline auto begin() const noexcept { return errors_.begin(); }
    inline auto end() const noexcept { return errors_.end(); }
    inline auto rbegin() const noexcept { return errors_.rbegin(); }
    inline auto rend() const noexcept { return errors_.rend(); }

    std::optional<WTF::String> pop_back();

private:
    std::list<WTF::String> errors_;
};

// Forcibly clears the error stack on destruction. This stops stale errors
// from popping up later in the lifecycle of crypto operations where they
// would cause spurious failures. It is a rather blunt method, though, and
// ERR_clear_error() isn't necessarily cheap.
//
// If created with a pointer to a CryptoErrorList, the current OpenSSL error
// stack will be captured before clearing the error.
class ClearErrorOnReturn final {
public:
    ClearErrorOnReturn(CryptoErrorList* errors = nullptr);
    ~ClearErrorOnReturn();
    NCRYPTO_DISALLOW_COPY_AND_MOVE(ClearErrorOnReturn)
    NCRYPTO_DISALLOW_NEW_DELETE()

private:
    CryptoErrorList* errors_;
};

// Pop errors from OpenSSL's error stack that were added between when this
// was constructed and destructed.
//
// If created with a pointer to a CryptoErrorList, the current OpenSSL error
// stack will be captured before resetting the error to the mark.
class MarkPopErrorOnReturn final {
public:
    MarkPopErrorOnReturn(CryptoErrorList* errors = nullptr);
    ~MarkPopErrorOnReturn();
    NCRYPTO_DISALLOW_COPY_AND_MOVE(MarkPopErrorOnReturn)
    NCRYPTO_DISALLOW_NEW_DELETE()

    int peekError();

private:
    CryptoErrorList* errors_;
};

// TODO(@jasnell): Eventually replace with std::expected when we are able to
// bump up to c++23.
template<typename T, typename E>
struct Result final {
    const bool has_value;
    T value;
    std::optional<E> error = std::nullopt;
    std::optional<int> openssl_error = std::nullopt;
    Result(T&& value)
        : has_value(true)
        , value(WTF::move(value))
    {
    }
    Result(E&& error, std::optional<int> openssl_error = std::nullopt)
        : has_value(false)
        , error(WTF::move(error))
        , openssl_error(WTF::move(openssl_error))
    {
    }
    inline operator bool() const { return has_value; }
};

// ============================================================================
// Various smart pointer aliases for OpenSSL types.

template<typename T, void (*function)(T*)>
struct FunctionDeleter {
    void operator()(T* pointer) const { function(pointer); }
    typedef std::unique_ptr<T, FunctionDeleter> Pointer;
};

template<typename T, void (*function)(T*)>
using DeleteFnPtr = typename FunctionDeleter<T, function>::Pointer;

using PKCS8Pointer = DeleteFnPtr<PKCS8_PRIV_KEY_INFO, PKCS8_PRIV_KEY_INFO_free>;
using RSAPointer = DeleteFnPtr<RSA, RSA_free>;

class BIOPointer;
class BignumPointer;
class CipherCtxPointer;
class DataPointer;
class DHPointer;
class ECKeyPointer;
class EVPKeyPointer;
class EVPMDCtxPointer;
class X509View;
class X509Pointer;
class ECDSASigPointer;
class ECGroupPointer;
class ECPointPointer;
class ECKeyPointer;
class Dsa;
class Rsa;
class Ec;

struct StackOfXASN1Deleter {
    void operator()(STACK_OF(ASN1_OBJECT) * p) const
    {
        sk_ASN1_OBJECT_pop_free(p, ASN1_OBJECT_free);
    }
};
using StackOfASN1 = std::unique_ptr<STACK_OF(ASN1_OBJECT), StackOfXASN1Deleter>;

// An unowned, unmanaged pointer to a buffer of data.
template<typename T>
struct Buffer {
    T* data = nullptr;
    size_t len = 0;

    static Buffer from(std::span<T> input)
    {
        return { input.data(), input.size() };
    }
};

class Digest final {
public:
    static constexpr size_t MAX_SIZE = EVP_MAX_MD_SIZE;
    Digest() = default;
    Digest(const EVP_MD* md)
        : md_(md)
    {
    }
    Digest(const Digest&) = default;
    Digest& operator=(const Digest&) = default;
    inline Digest& operator=(const EVP_MD* md)
    {
        md_ = md;
        return *this;
    }
    NCRYPTO_DISALLOW_MOVE(Digest)

    size_t size() const;

    inline const EVP_MD* get() const { return md_; }
    inline operator const EVP_MD*() const { return md_; }
    inline operator bool() const { return md_ != nullptr; }

    static const Digest FromName(WTF::StringView name);

private:
    const EVP_MD* md_ = nullptr;
};

class Cipher final {
public:
    static constexpr size_t MAX_KEY_LENGTH = EVP_MAX_KEY_LENGTH;
    static constexpr size_t MAX_IV_LENGTH = EVP_MAX_IV_LENGTH;

    Cipher() = default;
    Cipher(const EVP_CIPHER* cipher)
        : cipher_(cipher)
    {
    }
    Cipher(const Cipher&) = default;
    Cipher& operator=(const Cipher&) = default;
    inline Cipher& operator=(const EVP_CIPHER* cipher)
    {
        cipher_ = cipher;
        return *this;
    }
    NCRYPTO_DISALLOW_MOVE(Cipher)

    inline const EVP_CIPHER* get() const { return cipher_; }
    inline operator const EVP_CIPHER*() const { return cipher_; }
    inline operator bool() const { return cipher_ != nullptr; }

    int getNid() const;
    int getMode() const;
    int getIvLength() const;
    int getKeyLength() const;
    int getBlockSize() const;
    WTF::ASCIILiteral getModeLabel() const;
    WTF::String getName() const;

    bool isGcmMode() const;
    bool isWrapMode() const;
    bool isCcmMode() const;
    bool isOcbMode() const;
    bool isStreamMode() const;
    bool isChaCha20Poly1305() const;

    bool isSupportedAuthenticatedMode() const;

    static const Cipher FromName(WTF::StringView name);
    static const Cipher FromNid(int nid);
    static const Cipher FromCtx(const CipherCtxPointer& ctx);

    // Utilities to get various ciphers by type. If the underlying
    // implementation does not support the requested cipher, then
    // the result will be an empty Cipher object whose bool operator
    // will return false.

    static const Cipher& AES_128_CBC();
    static const Cipher& AES_192_CBC();
    static const Cipher& AES_256_CBC();

    struct CipherParams {
        int padding;
        Digest digest;
        const Buffer<const void> label;
    };

    static DataPointer encrypt(const EVPKeyPointer& key,
        const CipherParams& params,
        const Buffer<const void> in);
    static DataPointer decrypt(const EVPKeyPointer& key,
        const CipherParams& params,
        const Buffer<const void> in);

    static DataPointer sign(const EVPKeyPointer& key,
        const CipherParams& params,
        const Buffer<const void> in);

    static DataPointer recover(const EVPKeyPointer& key,
        const CipherParams& params,
        const Buffer<const void> in);

    static constexpr bool IsValidGCMTagLength(unsigned int tag_len)
    {
        return tag_len == 4 || tag_len == 8 || (tag_len >= 12 && tag_len <= 16);
    }

private:
    const EVP_CIPHER* cipher_ = nullptr;
};

// ============================================================================
// DSA

class Dsa final {
public:
    Dsa();
    Dsa(OSSL3_CONST DSA* dsa);
    NCRYPTO_DISALLOW_COPY_AND_MOVE(Dsa)

    inline operator bool() const { return dsa_ != nullptr; }
    inline operator OSSL3_CONST DSA*() const { return dsa_; }

    const BIGNUM* getP() const;
    const BIGNUM* getQ() const;
    size_t getModulusLength() const;
    size_t getDivisorLength() const;

private:
    OSSL3_CONST DSA* dsa_;
};

// ============================================================================
// RSA

class Rsa final {
public:
    Rsa();
    Rsa(OSSL3_CONST RSA* rsa);
    NCRYPTO_DISALLOW_COPY_AND_MOVE(Rsa)

    inline operator bool() const { return rsa_ != nullptr; }
    inline operator OSSL3_CONST RSA*() const { return rsa_; }

    struct PublicKey {
        const BIGNUM* n;
        const BIGNUM* e;
        const BIGNUM* d;
    };
    struct PrivateKey {
        const BIGNUM* p;
        const BIGNUM* q;
        const BIGNUM* dp;
        const BIGNUM* dq;
        const BIGNUM* qi;
    };
    struct PssParams {
        WTF::StringView digest = "sha1"_s;
        std::optional<WTF::StringView> mgf1_digest = "sha1"_s;
        int64_t salt_length = 20;
    };

    const PublicKey getPublicKey() const;
    const PrivateKey getPrivateKey() const;
    const std::optional<PssParams> getPssParams() const;

    bool setPublicKey(BignumPointer&& n, BignumPointer&& e);
    bool setPrivateKey(BignumPointer&& d,
        BignumPointer&& q,
        BignumPointer&& p,
        BignumPointer&& dp,
        BignumPointer&& dq,
        BignumPointer&& qi);

    using CipherParams = Cipher::CipherParams;

private:
    OSSL3_CONST RSA* rsa_;
};

class Ec final {
public:
    static int GetCurveIdFromName(const char* name);
};

// A managed pointer to a buffer of data. When destroyed the underlying
// buffer will be freed.
class DataPointer final {
public:
    static DataPointer Alloc(size_t len);
    static DataPointer Copy(const Buffer<const void>& buffer);

    static DataPointer FromSpan(std::span<const uint8_t> span)
    {
        if (span.empty()) return {};
        if (auto dp = Alloc(span.size())) {
            memcpy(dp.get(), span.data(), span.size());
            return dp;
        }
        return {};
    }

    DataPointer() = default;
    explicit DataPointer(void* data, size_t len);
    explicit DataPointer(const Buffer<void>& buffer);
    DataPointer(DataPointer&& other) noexcept;
    DataPointer& operator=(DataPointer&& other) noexcept;
    NCRYPTO_DISALLOW_COPY(DataPointer)
    ~DataPointer();

    inline bool operator==(std::nullptr_t) noexcept { return data_ == nullptr; }
    inline operator bool() const { return data_ != nullptr; }

    template<typename T = void>
    inline T* get() const noexcept
    {
        return static_cast<T*>(data_);
    }

    inline std::span<const uint8_t> span() const { return { get<const uint8_t>(), len_ }; }
    inline size_t size() const noexcept { return len_; }
    void reset(void* data = nullptr, size_t len = 0);
    void reset(const Buffer<void>& buffer);

    // Sets the underlying data buffer to all zeros.
    void zero();

    DataPointer resize(size_t len);

    // Releases ownership of the underlying data buffer. It is the caller's
    // responsibility to ensure the buffer is appropriately freed.
    Buffer<void> release();

    // Returns a Buffer struct that is a view of the underlying data.
    template<typename T = void>
    inline operator const Buffer<T>() const
    {
        return {
            .data = static_cast<T*>(data_),
            .len = len_,
        };
    }

private:
    void* data_ = nullptr;
    size_t len_ = 0;
};

class BIOPointer final {
    WTF_MAKE_TZONE_ALLOCATED(BIOPointer);

public:
    static BIOPointer NewMem();
    static BIOPointer New(const void* data, size_t len);
    static BIOPointer New(const BIGNUM* bn);
    template<typename T>
    static BIOPointer New(const Buffer<T>& buf)
    {
        return New(buf.data, buf.len);
    }

    BIOPointer() = default;
    BIOPointer(std::nullptr_t)
        : bio_(nullptr)
    {
    }
    explicit BIOPointer(BIO* bio);
    BIOPointer(BIOPointer&& other) noexcept;
    NCRYPTO_DISALLOW_COPY(BIOPointer)
    ~BIOPointer();

    inline bool operator==(std::nullptr_t) noexcept { return bio_ == nullptr; }
    inline operator bool() const { return bio_ != nullptr; }
    inline BIO* get() const noexcept { return bio_.get(); }

    inline operator BUF_MEM*() const
    {
        BUF_MEM* mem = nullptr;
        if (!bio_) return mem;
        BIO_get_mem_ptr(bio_.get(), &mem);
        return mem;
    }

    inline operator BIO*() const { return bio_.get(); }

    void reset(BIO* bio = nullptr);
    BIO* release();

    bool resetBio() const;

private:
    mutable DeleteFnPtr<BIO, BIO_free_all> bio_;
};

class BignumPointer final {
    WTF_MAKE_TZONE_ALLOCATED(BignumPointer);

public:
    BignumPointer() = default;
    explicit BignumPointer(BIGNUM* bignum);
    explicit BignumPointer(const unsigned char* data, size_t len);
    BignumPointer(BignumPointer&& other) noexcept;
    BignumPointer& operator=(BignumPointer&& other) noexcept;
    NCRYPTO_DISALLOW_COPY(BignumPointer)
    ~BignumPointer();

    int operator<=>(const BignumPointer& other) const noexcept;
    int operator<=>(const BIGNUM* other) const noexcept;
    inline operator bool() const { return bn_ != nullptr; }
    inline BIGNUM* get() const noexcept { return bn_.get(); }
    void reset(BIGNUM* bn = nullptr);
    void reset(const unsigned char* data, size_t len);
    BIGNUM* release();

    bool setWord(unsigned long w); // NOLINT(runtime/int)
    // std::nullopt when the value does not fit in a single BN_ULONG, which
    // BN_get_word reports as the all-ones word (otherwise a real value).
    // BN_ULONG, not unsigned long: the latter is only 32 bits on LLP64.
    std::optional<BN_ULONG> getWord() const;

    size_t byteLength() const;

    static DataPointer toHex(const BIGNUM* bn);
    DataPointer toHex() const;

    using PrimeCheckCallback = WTF::Function<bool(int, int)>;
    int isPrime(int checks,
        PrimeCheckCallback&& cb = defaultPrimeCheckCallback) const;
    struct PrimeConfig {
        int bits;
        bool safe = false;
        const BignumPointer& add;
        const BignumPointer& rem;
    };

    bool generate(const PrimeConfig& params,
        PrimeCheckCallback cb = defaultPrimeCheckCallback) const;

    static BignumPointer New();
    static BignumPointer NewSecure();

    static DataPointer Encode(const BIGNUM* bn);
    static DataPointer EncodePadded(const BIGNUM* bn, size_t size);
    static size_t EncodePaddedInto(const BIGNUM* bn,
        unsigned char* out,
        size_t size);
    static int GetBitCount(const BIGNUM* bn);
    static int GetByteCount(const BIGNUM* bn);
    static std::optional<BN_ULONG> GetWord(const BIGNUM* bn);
    static const BIGNUM* One();

    BignumPointer clone();

private:
    DeleteFnPtr<BIGNUM, BN_clear_free> bn_;

    static bool defaultPrimeCheckCallback(int, int) { return 1; }
};

class CipherCtxPointer final {
public:
    static CipherCtxPointer New();

    CipherCtxPointer() = default;
    explicit CipherCtxPointer(EVP_CIPHER_CTX* ctx);
    CipherCtxPointer(CipherCtxPointer&& other) noexcept;
    NCRYPTO_DISALLOW_COPY(CipherCtxPointer)
    ~CipherCtxPointer();

    inline bool operator==(std::nullptr_t) const noexcept
    {
        return ctx_ == nullptr;
    }
    inline operator bool() const { return ctx_ != nullptr; }
    inline EVP_CIPHER_CTX* get() const { return ctx_.get(); }
    inline operator EVP_CIPHER_CTX*() const { return ctx_.get(); }
    void reset(EVP_CIPHER_CTX* ctx = nullptr);
    EVP_CIPHER_CTX* release();

    void setAllowWrap();

    bool setKeyLength(size_t length);
    bool setIvLength(size_t length);
    bool setAeadTag(const Buffer<const char>& tag);
    bool setAeadTagLength(size_t length);
    bool setPadding(bool padding);
    bool init(const Cipher& cipher,
        bool encrypt,
        const unsigned char* key = nullptr,
        const unsigned char* iv = nullptr);

    int getBlockSize() const;
    int getMode() const;
    int getNid() const;

    bool isGcmMode() const;
    bool isCcmMode() const;
    bool isWrapMode() const;
    bool isChaCha20Poly1305() const;

    bool update(const Buffer<const unsigned char>& in,
        unsigned char* out,
        int* out_len,
        bool finalize = false);
    bool getAeadTag(size_t len, unsigned char* out);

private:
    DeleteFnPtr<EVP_CIPHER_CTX, EVP_CIPHER_CTX_free> ctx_;
};

class EVPKeyCtxPointer final {
    WTF_MAKE_TZONE_ALLOCATED(EVPKeyCtxPointer);

public:
    EVPKeyCtxPointer();
    explicit EVPKeyCtxPointer(EVP_PKEY_CTX* ctx);
    EVPKeyCtxPointer(EVPKeyCtxPointer&& other) noexcept;
    EVPKeyCtxPointer& operator=(EVPKeyCtxPointer&& other) noexcept;
    NCRYPTO_DISALLOW_COPY(EVPKeyCtxPointer)
    ~EVPKeyCtxPointer();

    inline bool operator==(std::nullptr_t) const noexcept
    {
        return ctx_ == nullptr;
    }
    inline operator bool() const { return ctx_ != nullptr; }
    inline EVP_PKEY_CTX* get() const { return ctx_.get(); }
    void reset(EVP_PKEY_CTX* ctx = nullptr);
    EVP_PKEY_CTX* release();

    bool initForParamgen();
    bool setDhParameters(int prime_size, uint32_t generator);
    bool setDsaParameters(uint32_t bits, std::optional<int> q_bits);
    bool setEcParameters(int curve, int encoding);

    bool setRsaOaepMd(const Digest& md);
    bool setRsaPadding(int padding);
    bool setRsaKeygenPubExp(BignumPointer&& e);
    bool setRsaKeygenBits(int bits);
    bool setRsaPssKeygenMd(const Digest& md);
    bool setRsaPssKeygenMgf1Md(const Digest& md);
    bool setRsaPssSaltlen(int salt_len);
    bool setRsaOaepLabel(DataPointer&& data);

    bool setSignatureMd(const EVPMDCtxPointer& md);

    bool verify(const Buffer<const unsigned char>& sig,
        const Buffer<const unsigned char>& data);
    bool signInto(const Buffer<const unsigned char>& data,
        Buffer<unsigned char>* sig);

    static constexpr int kDefaultRsaExponent = 0x10001;

    static bool setRsaPadding(EVP_PKEY_CTX* ctx,
        int padding,
        std::optional<int> salt_len = std::nullopt);

    EVPKeyPointer paramgen() const;

    bool initForDecrypt();
    bool initForKeygen();
    int initForVerify();
    int initForSign();

    static EVPKeyCtxPointer New(const EVPKeyPointer& key);
    static EVPKeyCtxPointer NewFromID(int id);

private:
    DeleteFnPtr<EVP_PKEY_CTX, EVP_PKEY_CTX_free> ctx_;
};

class EVPKeyPointer final {
    WTF_MAKE_TZONE_ALLOCATED(EVPKeyPointer);

public:
    static EVPKeyPointer New();
    static EVPKeyPointer NewRawPublic(int id,
        const Buffer<const unsigned char>& data);
    static EVPKeyPointer NewRawPrivate(int id,
        const Buffer<const unsigned char>& data);
    static EVPKeyPointer NewDH(DHPointer&& dh);
    static EVPKeyPointer NewRSA(RSAPointer&& rsa);

    enum class PKEncodingType {
        // RSAPublicKey / RSAPrivateKey according to PKCS#1.
        PKCS1,
        // PrivateKeyInfo or EncryptedPrivateKeyInfo according to PKCS#8.
        PKCS8,
        // SubjectPublicKeyInfo according to X.509.
        SPKI,
        // ECPrivateKey according to SEC1.
        SEC1,
    };

    static WTF::ASCIILiteral EncodingName(PKEncodingType type)
    {
        switch (type) {
        case PKEncodingType::PKCS1:
            return "pkcs1"_s;
        case PKEncodingType::PKCS8:
            return "pkcs8"_s;
        case PKEncodingType::SPKI:
            return "spki"_s;
        case PKEncodingType::SEC1:
            return "sec1"_s;
        }
    }

    enum class PKFormatType {
        DER,
        PEM,
        JWK,
        RawPublic,
        RawPrivate,
        RawSeed,
    };

    enum class PKParseError { NOT_RECOGNIZED,
        NEED_PASSPHRASE,
        FAILED };
    using ParseKeyResult = Result<EVPKeyPointer, PKParseError>;

    struct AsymmetricKeyEncodingConfig {
        bool output_key_object = false;
        PKFormatType format = PKFormatType::DER;
        PKEncodingType type = PKEncodingType::PKCS8;
        int ec_point_form = POINT_CONVERSION_UNCOMPRESSED;
        AsymmetricKeyEncodingConfig() = default;
        AsymmetricKeyEncodingConfig(const AsymmetricKeyEncodingConfig&) = default;
        AsymmetricKeyEncodingConfig& operator=(const AsymmetricKeyEncodingConfig&) = default;
    };
    using PublicKeyEncodingConfig = AsymmetricKeyEncodingConfig;

    struct PrivateKeyEncodingConfig : public AsymmetricKeyEncodingConfig {
        const EVP_CIPHER* cipher = nullptr;
        std::optional<DataPointer> passphrase = std::nullopt;
        PrivateKeyEncodingConfig() = default;
        PrivateKeyEncodingConfig(const PrivateKeyEncodingConfig&);
    };

    static ParseKeyResult TryParsePublicKey(
        const PublicKeyEncodingConfig& config,
        const Buffer<const unsigned char>& buffer);

    static ParseKeyResult TryParsePublicKeyPEM(
        const Buffer<const unsigned char>& buffer);

    static ParseKeyResult TryParsePrivateKey(
        const PrivateKeyEncodingConfig& config,
        const Buffer<const unsigned char>& buffer);

    // ML-DSA / ML-KEM PKCS#8 private keys encode a CHOICE of {seed [0],
    // expandedKey, both SEQUENCE{seed, expandedKey}} (RFC 9881 / 9935).
    // BoringSSL's EVP decoder only accepts the seed arm. When the inner
    // privateKey is the "both" form, extract the seed and build the key from
    // it so OpenSSL-3.5-default keys load. Returns nullptr for any other
    // structure, including the seed-less expandedKey arm.
    static EVPKeyPointer TryParsePqcBothFormPkcs8(
        const Buffer<const unsigned char>& der);

    EVPKeyPointer() = default;
    explicit EVPKeyPointer(EVP_PKEY* pkey);
    EVPKeyPointer(EVPKeyPointer&& other) noexcept;
    EVPKeyPointer& operator=(EVPKeyPointer&& other) noexcept;
    NCRYPTO_DISALLOW_COPY(EVPKeyPointer)
    ~EVPKeyPointer();

    bool assign(const ECKeyPointer& eckey);
    bool set(const ECKeyPointer& eckey);
    operator const EC_KEY*() const;

    inline bool operator==(std::nullptr_t) const noexcept
    {
        return pkey_ == nullptr;
    }
    inline operator bool() const { return pkey_ != nullptr; }
    inline EVP_PKEY* get() const { return pkey_.get(); }
    void reset(EVP_PKEY* pkey = nullptr);
    EVP_PKEY* release();

    static int id(const EVP_PKEY* key);
    static int base_id(const EVP_PKEY* key);

    int id() const;
    int base_id() const;
    size_t size() const;

    size_t rawPublicKeySize() const;
    size_t rawPrivateKeySize() const;
    DataPointer rawPublicKey() const;
    DataPointer rawPrivateKey() const;

    Result<BIOPointer, bool> writePrivateKey(
        const PrivateKeyEncodingConfig& config) const;
    Result<BIOPointer, bool> writePublicKey(
        const PublicKeyEncodingConfig& config) const;

    EVPKeyCtxPointer newCtx() const;

    static bool IsRSAPrivateKey(const Buffer<const unsigned char>& buffer);

    std::optional<uint32_t> getBytesOfRS() const;
    int getDefaultSignPadding() const;
    operator Rsa() const;
    operator Dsa() const;

    bool isRsaVariant() const;
    bool isOneShotVariant() const;
    bool isSigVariant() const;
    bool validateDsaParameters() const;

private:
    DeleteFnPtr<EVP_PKEY, EVP_PKEY_free> pkey_;
};

class DHPointer final {
    WTF_MAKE_TZONE_ALLOCATED(DHPointer);

public:
    enum class FindGroupOption {
        NONE,
        // There are known and documented security issues with prime groups smaller
        // than 2048 bits. When the NO_SMALL_PRIMES option is set, these small prime
        // groups will not be supported.
        NO_SMALL_PRIMES,
    };

    static BignumPointer GetStandardGenerator();

    static BignumPointer FindGroup(
        const WTF::StringView name,
        FindGroupOption option = FindGroupOption::NONE);
    static DHPointer FromGroup(const WTF::StringView name,
        FindGroupOption option = FindGroupOption::NONE);

    static DHPointer New(BignumPointer&& p, BignumPointer&& g);
    static DHPointer New(size_t bits, unsigned int generator);

    DHPointer() = default;
    explicit DHPointer(DH* dh);
    DHPointer(DHPointer&& other) noexcept;
    DHPointer& operator=(DHPointer&& other) noexcept;
    NCRYPTO_DISALLOW_COPY(DHPointer)
    ~DHPointer();

    inline bool operator==(std::nullptr_t) noexcept { return dh_ == nullptr; }
    inline operator bool() const { return dh_ != nullptr; }
    inline DH* get() const { return dh_.get(); }
    void reset(DH* dh = nullptr);
    DH* release();

    enum class CheckResult {
        NONE,
        P_NOT_PRIME = DH_CHECK_P_NOT_PRIME,
        P_NOT_SAFE_PRIME = DH_CHECK_P_NOT_SAFE_PRIME,
        UNABLE_TO_CHECK_GENERATOR = DH_UNABLE_TO_CHECK_GENERATOR,
        NOT_SUITABLE_GENERATOR = DH_NOT_SUITABLE_GENERATOR,
        Q_NOT_PRIME = DH_CHECK_Q_NOT_PRIME,
#ifndef OPENSSL_IS_BORINGSSL
        // Boringssl does not define the DH_CHECK_INVALID_[Q or J]_VALUE
        INVALID_Q = DH_CHECK_INVALID_Q_VALUE,
        INVALID_J = DH_CHECK_INVALID_J_VALUE,
#endif
        CHECK_FAILED = 512,
    };
    CheckResult check();

    enum class CheckPublicKeyResult {
        NONE,
#ifndef OPENSSL_IS_BORINGSSL
        // Boringssl does not define DH_R_CHECK_PUBKEY_TOO_SMALL or TOO_LARGE
        TOO_SMALL = DH_R_CHECK_PUBKEY_TOO_SMALL,
        TOO_LARGE = DH_R_CHECK_PUBKEY_TOO_LARGE,
        INVALID = DH_R_CHECK_PUBKEY_INVALID,
#else
        INVALID = DH_R_INVALID_PUBKEY,
#endif
        CHECK_FAILED = 512,
    };
    // Check to see if the given public key is suitable for this DH instance.
    CheckPublicKeyResult checkPublicKey(const BignumPointer& pub_key);

    DataPointer getPrime() const;
    DataPointer getGenerator() const;
    DataPointer getPublicKey() const;
    DataPointer getPrivateKey() const;
    DataPointer generateKeys() const;
    DataPointer computeSecret(const BignumPointer& peer) const;

    bool setPublicKey(BignumPointer&& key);
    bool setPrivateKey(BignumPointer&& key);

    size_t size() const;

    static DataPointer stateless(const EVPKeyPointer& ourKey,
        const EVPKeyPointer& theirKey);

private:
    DeleteFnPtr<DH, DH_free> dh_;
};

class X509View final {
public:
    X509View() = default;
    inline explicit X509View(const X509* cert)
        : cert_(cert)
    {
    }
    X509View(const X509View& other) = default;
    X509View& operator=(const X509View& other) = default;
    NCRYPTO_DISALLOW_MOVE(X509View)

    inline X509* get() const { return const_cast<X509*>(cert_); }
    inline operator X509*() const { return const_cast<X509*>(cert_); }
    inline operator const X509*() const { return cert_; }

    inline bool operator==(std::nullptr_t) noexcept { return cert_ == nullptr; }
    inline operator bool() const { return cert_ != nullptr; }

    BIOPointer toPEM() const;
    BIOPointer toDER() const;

    BIOPointer getSubject() const;
    BIOPointer getSubjectAltName() const;
    BIOPointer getIssuer() const;
    BIOPointer getInfoAccess() const;
    BIOPointer getValidFrom() const;
    BIOPointer getValidTo() const;
    std::optional<std::string_view> getSignatureAlgorithm() const;
    std::optional<std::string> getSignatureAlgorithmOID() const;
    DataPointer getSerialNumber() const;
    Result<EVPKeyPointer, int> getPublicKey() const;
    StackOfASN1 getKeyUsage() const;

    bool isCA() const;
    bool isIssuedBy(const X509View& other) const;
    bool checkPrivateKey(const EVPKeyPointer& pkey) const;
    bool checkPublicKey(const EVPKeyPointer& pkey) const;

    std::optional<WTF::String> getFingerprint(const Digest& method) const;

    enum class CheckMatch {
        NO_MATCH,
        MATCH,
        INVALID_NAME,
        OPERATION_FAILED,
    };
    // OpenSSL X509_CHECK_FLAG_* values. BoringSSL defines four of these as 0,
    // so checkHost() carries its own copy and calls the shared Rust matcher
    // (Bun__X509__checkHost) instead of X509_check_host.
    struct CheckFlags {
        static constexpr uint32_t ALWAYS_CHECK_SUBJECT = 0x01;
        static constexpr uint32_t NO_WILDCARDS = 0x02;
        static constexpr uint32_t NO_PARTIAL_WILDCARDS = 0x04;
        static constexpr uint32_t MULTI_LABEL_WILDCARDS = 0x08;
        static constexpr uint32_t SINGLE_LABEL_SUBDOMAINS = 0x10;
        static constexpr uint32_t NEVER_CHECK_SUBJECT = 0x20;
    };
    CheckMatch checkHost(const std::span<const char> host,
        int flags,
        DataPointer* peerName = nullptr) const;
    CheckMatch checkEmail(const std::span<const char> email, int flags) const;
    CheckMatch checkIp(const char* ip, int flags) const;

private:
    const X509* cert_ = nullptr;
};

class X509Pointer final {
    WTF_MAKE_TZONE_ALLOCATED(X509Pointer);

public:
    static Result<X509Pointer, int> Parse(Buffer<const unsigned char> buffer);

    X509Pointer() = default;
    explicit X509Pointer(X509* cert);
    X509Pointer(X509Pointer&& other) noexcept;
    X509Pointer& operator=(X509Pointer&& other) noexcept;
    NCRYPTO_DISALLOW_COPY(X509Pointer)
    ~X509Pointer();

    inline bool operator==(std::nullptr_t) noexcept { return cert_ == nullptr; }
    inline operator bool() const { return cert_ != nullptr; }
    inline X509* get() const { return cert_.get(); }
    inline operator X509*() const { return cert_.get(); }
    inline operator const X509*() const { return cert_.get(); }
    void reset(X509* cert = nullptr);
    X509* release();

    X509View view() const;
    operator X509View() const { return view(); }

    static WTF::ASCIILiteral ErrorCode(int32_t err);

private:
    DeleteFnPtr<X509, X509_free> cert_;
};

class ECDSASigPointer final {
    WTF_MAKE_TZONE_ALLOCATED(ECDSASigPointer);

public:
    explicit ECDSASigPointer();
    explicit ECDSASigPointer(ECDSA_SIG* sig);
    ECDSASigPointer(ECDSASigPointer&& other) noexcept;
    NCRYPTO_DISALLOW_COPY(ECDSASigPointer)
    ~ECDSASigPointer();

    inline bool operator==(std::nullptr_t) noexcept { return sig_ == nullptr; }
    inline operator bool() const { return sig_ != nullptr; }
    inline ECDSA_SIG* get() const { return sig_.get(); }
    inline operator ECDSA_SIG*() const { return sig_.get(); }
    void reset(ECDSA_SIG* sig = nullptr);
    ECDSA_SIG* release();

    static ECDSASigPointer New();
    static ECDSASigPointer Parse(const Buffer<const unsigned char>& buffer);

    inline const BIGNUM* r() const { return pr_; }
    inline const BIGNUM* s() const { return ps_; }

    bool setParams(BignumPointer&& r, BignumPointer&& s);

    Buffer<unsigned char> encode() const;

private:
    DeleteFnPtr<ECDSA_SIG, ECDSA_SIG_free> sig_;
    const BIGNUM* pr_ = nullptr;
    const BIGNUM* ps_ = nullptr;
};

class ECGroupPointer final {
    WTF_MAKE_TZONE_ALLOCATED(ECGroupPointer);

public:
    explicit ECGroupPointer();
    explicit ECGroupPointer(EC_GROUP* group);
    ECGroupPointer(ECGroupPointer&& other) noexcept;
    NCRYPTO_DISALLOW_COPY(ECGroupPointer)
    ~ECGroupPointer();

    inline bool operator==(std::nullptr_t) noexcept { return group_ == nullptr; }
    inline operator bool() const { return group_ != nullptr; }
    inline EC_GROUP* get() const { return group_.get(); }
    inline operator EC_GROUP*() const { return group_.get(); }
    void reset(EC_GROUP* group = nullptr);
    EC_GROUP* release();

    static ECGroupPointer NewByCurveName(int nid);

private:
    DeleteFnPtr<EC_GROUP, EC_GROUP_free> group_;
};

class ECPointPointer final {
    WTF_MAKE_TZONE_ALLOCATED(ECPointPointer);

public:
    ECPointPointer();
    explicit ECPointPointer(EC_POINT* point);
    ECPointPointer(ECPointPointer&& other) noexcept;
    NCRYPTO_DISALLOW_COPY(ECPointPointer)
    ~ECPointPointer();

    inline bool operator==(std::nullptr_t) noexcept { return point_ == nullptr; }
    inline operator bool() const { return point_ != nullptr; }
    inline EC_POINT* get() const { return point_.get(); }
    inline operator EC_POINT*() const { return point_.get(); }
    void reset(EC_POINT* point = nullptr);
    EC_POINT* release();

    bool setFromBuffer(const Buffer<const unsigned char>& buffer,
        const EC_GROUP* group);
    bool mul(const EC_GROUP* group, const BIGNUM* priv_key);

    static ECPointPointer New(const EC_GROUP* group);

private:
    DeleteFnPtr<EC_POINT, EC_POINT_free> point_;
};

class ECKeyPointer final {
    WTF_MAKE_TZONE_ALLOCATED(ECKeyPointer);

public:
    ECKeyPointer();
    explicit ECKeyPointer(EC_KEY* key);
    ECKeyPointer(ECKeyPointer&& other) noexcept;
    ECKeyPointer& operator=(ECKeyPointer&& other) noexcept;
    NCRYPTO_DISALLOW_COPY(ECKeyPointer)
    ~ECKeyPointer();

    inline bool operator==(std::nullptr_t) noexcept { return key_ == nullptr; }
    inline operator bool() const { return key_ != nullptr; }
    inline EC_KEY* get() const { return key_.get(); }
    inline operator EC_KEY*() const { return key_.get(); }
    void reset(EC_KEY* key = nullptr);
    EC_KEY* release();

    ECKeyPointer clone() const;
    bool setPrivateKey(const BignumPointer& priv);
    bool setPublicKey(const ECPointPointer& pub);
    bool setPublicKeyRaw(const BignumPointer& x, const BignumPointer& y);
    bool generate();
    bool checkKey() const;

    const EC_GROUP* getGroup() const;
    const BIGNUM* getPrivateKey() const;
    const EC_POINT* getPublicKey() const;

    static ECKeyPointer NewByCurveName(int nid);

    static const EC_POINT* GetPublicKey(const EC_KEY* key);
    static const BIGNUM* GetPrivateKey(const EC_KEY* key);
    static const EC_GROUP* GetGroup(const EC_KEY* key);
    static bool Check(const EC_KEY* key);

private:
    DeleteFnPtr<EC_KEY, EC_KEY_free> key_;
};

class EVPMDCtxPointer final {
    WTF_MAKE_TZONE_ALLOCATED(EVPMDCtxPointer);

public:
    EVPMDCtxPointer();
    explicit EVPMDCtxPointer(EVP_MD_CTX* ctx);
    EVPMDCtxPointer(EVPMDCtxPointer&& other) noexcept;
    EVPMDCtxPointer& operator=(EVPMDCtxPointer&& other) noexcept;
    NCRYPTO_DISALLOW_COPY(EVPMDCtxPointer)
    ~EVPMDCtxPointer();

    inline bool operator==(std::nullptr_t) noexcept { return ctx_ == nullptr; }
    inline operator bool() const { return ctx_ != nullptr; }
    inline EVP_MD_CTX* get() const { return ctx_.get(); }
    inline operator EVP_MD_CTX*() const { return ctx_.get(); }
    void reset(EVP_MD_CTX* ctx = nullptr);
    EVP_MD_CTX* release();

    bool digestInit(const Digest& digest);
    bool digestUpdate(const Buffer<const void>& in);
    DataPointer digestFinal(size_t length);
    bool digestFinalInto(Buffer<void>* buf);
    size_t getExpectedSize();

    std::optional<EVP_PKEY_CTX*> signInit(const EVPKeyPointer& key,
        const Digest& digest);
    std::optional<EVP_PKEY_CTX*> verifyInit(const EVPKeyPointer& key,
        const Digest& digest);

    DataPointer signOneShot(const Buffer<const unsigned char>& buf) const;
    DataPointer sign(const Buffer<const unsigned char>& buf) const;
    bool verify(const Buffer<const unsigned char>& buf,
        const Buffer<const unsigned char>& sig) const;

    const EVP_MD* getDigest() const;
    size_t getDigestSize() const;
    bool hasXofFlag() const;

    bool copyTo(const EVPMDCtxPointer& other) const;

    static EVPMDCtxPointer New();

private:
    DeleteFnPtr<EVP_MD_CTX, EVP_MD_CTX_free> ctx_;
};

class HMACCtxPointer final {
    WTF_MAKE_TZONE_ALLOCATED(HMACCtxPointer);

public:
    HMACCtxPointer();
    explicit HMACCtxPointer(HMAC_CTX* ctx);
    HMACCtxPointer(HMACCtxPointer&& other) noexcept;
    HMACCtxPointer& operator=(HMACCtxPointer&& other) noexcept;
    NCRYPTO_DISALLOW_COPY(HMACCtxPointer)
    ~HMACCtxPointer();

    inline bool operator==(std::nullptr_t) noexcept { return ctx_ == nullptr; }
    inline operator bool() const { return ctx_ != nullptr; }
    inline HMAC_CTX* get() const { return ctx_.get(); }
    inline operator HMAC_CTX*() const { return ctx_.get(); }
    void reset(HMAC_CTX* ctx = nullptr);
    HMAC_CTX* release();

    bool init(const Buffer<const void>& buf, const Digest& md);
    bool update(const Buffer<const void>& buf);
    bool digestInto(Buffer<void>* buf);

    static HMACCtxPointer New();

private:
    DeleteFnPtr<HMAC_CTX, HMAC_CTX_free> ctx_;
};

// ============================================================================
// FIPS
bool isFipsEnabled();

// ============================================================================
// Various utilities

bool CSPRNG(void* buffer, size_t length) NCRYPTO_MUST_USE_RESULT;

// This callback is used to avoid the default passphrase callback in OpenSSL
// which will typically prompt for the passphrase. The prompting is designed
// for the OpenSSL CLI, but works poorly for some environments like Node.js
// because it involves synchronous interaction with the controlling terminal,
// something we never want, and use this function to avoid it.
int NoPasswordCallback(char* buf, int size, int rwflag, void* u);

int PasswordCallback(char* buf, int size, int rwflag, void* u);

bool SafeX509SubjectAltNamePrint(const BIOPointer& out, X509_EXTENSION* ext);
bool SafeX509InfoAccessPrint(const BIOPointer& out, X509_EXTENSION* ext);

// ============================================================================
// SPKAC

bool VerifySpkac(const char* input, size_t length);
BIOPointer ExportPublicKey(const char* input, size_t length);

// The caller takes ownership of the returned Buffer<char>
Buffer<char> ExportChallenge(const char* input, size_t length);

// ============================================================================
// KDF

const EVP_MD* getDigestByName(const WTF::StringView name);
const EVP_CIPHER* getCipherByName(const WTF::StringView name);

// Verify that the specified HKDF output length is valid for the given digest.
// The maximum length for HKDF output for a given digest is 255 times the
// hash size for the given digest algorithm.
bool checkHkdfLength(const Digest& digest, size_t length);

bool extractP1363(const Buffer<const unsigned char>& buf,
    unsigned char* dest,
    size_t n);

DataPointer hkdf(const Digest& md,
    const Buffer<const unsigned char>& key,
    const Buffer<const unsigned char>& info,
    const Buffer<const unsigned char>& salt,
    size_t length);

} // namespace ncrypto
