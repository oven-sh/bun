#pragma once

#include "root.h"
#include "ncrypto.h"
#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/ThrowScope.h>
#include "CryptoAlgorithmRegistry.h"
#include "JSBufferEncodingType.h"
#include "BunString.h"
#include "VectorSizeLimit.h"

namespace Bun {

using namespace JSC;

class ByteSource;

enum class DSASigEnc {
    DER,
    P1363,
    Invalid,
};

// ML-DSA / ML-KEM parameter sets, as provided by BoringSSL's EVP_PKEY
// integration. BoringSSL has ML-KEM-768 and ML-KEM-1024 but not ML-KEM-512.
// Each returns 0 / a null literal / nullptr for any other key type.
int pqcKeyTypeToNid(const WTF::StringView& name, bool ignoreCase = false);
ASCIILiteral pqcNidToKeyTypeName(int nid);
bool isMlDsaNid(int nid);
bool isMlKemNid(int nid);

// The seed and raw-public constructors are keyed on EVP_PKEY_ALG, not on NID.
const EVP_PKEY_ALG* pqcNidToAlg(int nid);

namespace ExternZigHash {
struct Hasher;

Hasher* getByName(Zig::GlobalObject* globalObject, const StringView& name);
Hasher* getFromOther(Zig::GlobalObject* globalObject, Hasher* hasher);
void destroy(Hasher* hasher);
bool update(Hasher* hasher, std::span<const uint8_t> data);
uint32_t digest(Hasher* hasher, Zig::GlobalObject* globalObject, std::span<uint8_t> out);
uint32_t getDigestSize(Hasher* hasher);
bool isXof(Hasher* hasher);

}; // namespace ExternZigHash

namespace StringBytes {
EncodedJSValue encode(JSGlobalObject* lexicalGlobalObject, ThrowScope& scope, std::span<const uint8_t> bytes, BufferEncodingType encoding);
};

// void CheckThrow(JSC::JSGlobalObject* globalObject, SignBase::Error error);
JSC::JSValue unsignedBigIntToBuffer(JSC::JSGlobalObject* lexicalGlobalObject, JSC::ThrowScope& scope, JSValue bigIntValue, ASCIILiteral name);
WebCore::BufferEncodingType getEncodingDefaultBuffer(JSGlobalObject* globalObject, ThrowScope& scope, JSValue encodingValue);
ncrypto::EVPKeyPointer::PKFormatType parseKeyFormat(JSC::JSGlobalObject* globalObject, JSValue formatValue, WTF::ASCIILiteral optionName, std::optional<ncrypto::EVPKeyPointer::PKFormatType> defaultFormat = std::nullopt);
std::optional<ncrypto::EVPKeyPointer::PKEncodingType> parseKeyType(JSC::JSGlobalObject* globalObject, JSValue typeValue, bool required, WTF::StringView keyType, std::optional<bool> isPublic, WTF::ASCIILiteral optionName);
bool isArrayBufferOrView(JSValue value);
JSValue createCryptoError(JSC::JSGlobalObject* globalObject, ThrowScope& scope, uint32_t err, const char* message);
void throwCryptoError(JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope, uint32_t err, const char* message = nullptr);
std::optional<int32_t> getIntOption(JSC::JSGlobalObject* globalObject, JSC::ThrowScope&, JSValue options, WTF::ASCIILiteral name);
int32_t getPadding(JSC::JSGlobalObject* globalObject, JSC::ThrowScope&, JSValue options, const ncrypto::EVPKeyPointer& pkey);
std::optional<int32_t> getSaltLength(JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope, JSValue options);
DSASigEnc getDSASigEnc(JSC::JSGlobalObject* globalObject, JSC::ThrowScope&, JSValue options);
bool convertP1363ToDER(const ncrypto::Buffer<const unsigned char>& p1363Sig, const ncrypto::EVPKeyPointer& pkey, ByteSource& derBuffer);
GCOwnedDataScope<std::span<const uint8_t>> getArrayBufferOrView2(JSGlobalObject* globalObject, ThrowScope& scope, JSValue dataValue, ASCIILiteral argName, JSValue encodingValue, bool arrayBufferViewOnly = false);
class BorrowedBytes;
// getArrayBufferOrView2 for a caller that runs user JS before it reads the bytes.
BorrowedBytes borrowArrayBufferOrView(JSGlobalObject* globalObject, ThrowScope& scope, JSValue dataValue, ASCIILiteral argName, JSValue encodingValue, bool arrayBufferViewOnly = false);
// One allocation and one pass. nullopt only when the allocation fails: an empty input gives an empty buffer.
[[nodiscard]] std::optional<ncrypto::DataPointer> tryCopyBytes(std::span<const uint8_t> bytes);
JSC::JSArrayBufferView* getArrayBufferOrView(JSGlobalObject* globalObject, ThrowScope& scope, JSValue value, ASCIILiteral argName, JSValue encodingValue, bool defaultBufferEncoding = false);
JSC::JSArrayBufferView* getArrayBufferOrView(JSGlobalObject* globalObject, ThrowScope& scope, JSValue value, ASCIILiteral argName, BufferEncodingType encoding);
bool isKeyValidForCurve(const EC_GROUP* group, const ncrypto::BignumPointer& privateKey);
std::optional<std::span<const uint8_t>> getBuffer(JSC::JSValue maybeBuffer);

// For output encoding
void parsePublicKeyEncoding(JSGlobalObject*, ThrowScope&, JSObject* enc, JSValue keyTypeValue, WTF::StringView objName, ncrypto::EVPKeyPointer::PublicKeyEncodingConfig&);
void parsePrivateKeyEncoding(JSGlobalObject*, ThrowScope&, JSObject* enc, JSValue keyTypeValue, WTF::StringView objName, ncrypto::EVPKeyPointer::PrivateKeyEncodingConfig&);
void parseKeyEncoding(JSGlobalObject* globalObject, ThrowScope& scope, JSObject* enc, JSValue keyTypeValue, std::optional<bool> isPublic, WTF::StringView objName, ncrypto::EVPKeyPointer::PrivateKeyEncodingConfig& config);

// Modified version of ByteSource from node
//
// https://github.com/nodejs/node/blob/2a6f90813f4802def79f2df1bfe20e95df279abf/src/crypto/crypto_util.h#L168
// A helper class representing a read-only byte array. When deallocated, its
// contents are zeroed.
class ByteSource final {
public:
    ByteSource() = default;
    ByteSource(ByteSource&& other) noexcept;
    ~ByteSource();

    ByteSource& operator=(ByteSource&& other) noexcept;

    ByteSource(const ByteSource&) = delete;
    ByteSource& operator=(const ByteSource&) = delete;

    std::span<const uint8_t> span() const;

    template<typename T = void>
    inline const T* data() const
    {
        return reinterpret_cast<const T*>(data_);
    }

    template<typename T = void>
    operator ncrypto::Buffer<const T>() const
    {
        return ncrypto::Buffer<const T> {
            .data = data<T>(),
            .len = size(),
        };
    }

    inline size_t size() const { return size_; }

    inline bool empty() const { return size_ == 0; }

    inline operator bool() const { return data_ != nullptr; }

    static ByteSource allocated(void* data, size_t size);

    template<typename T>
    static ByteSource allocated(const ncrypto::Buffer<T>& buffer)
    {
        return allocated(buffer.data, buffer.len);
    }

    static ByteSource foreign(const void* data, size_t size);

    static ByteSource fromBIO(const ncrypto::BIOPointer& bio);

private:
    const void* data_ = nullptr;
    void* allocated_data_ = nullptr;
    size_t size_ = 0;

    ByteSource(const void* data, void* allocated_data, size_t size)
        : data_(data)
        , allocated_data_(allocated_data)
        , size_(size)
    {
    }
};

// The bytes of a Buffer, TypedArray, DataView, ArrayBuffer or string argument, read in place
// instead of copied. Stack-only: it keeps the argument alive.
class BorrowedBytes {
    WTF_FORBID_HEAP_ALLOCATION;

public:
    BorrowedBytes() = default;
    BorrowedBytes(JSC::JSArrayBufferView* view)
        : m_owner(view)
        , m_kind(Kind::View)
    {
    }
    BorrowedBytes(JSC::JSArrayBuffer* buffer)
        : m_owner(buffer)
        , m_kind(Kind::Buffer)
    {
    }
    BorrowedBytes(JSC::JSString* string, UTF8View&& utf8)
        : m_owner(string)
        , m_kind(Kind::String)
        , m_utf8(WTF::move(utf8))
    {
    }
    BorrowedBytes(BorrowedBytes&&) = default;
    BorrowedBytes& operator=(BorrowedBytes&&) = default;
    ~BorrowedBytes() { JSC::ensureStillAliveHere(m_owner); }

    // Any call that runs user JS can detach or resize a buffer, so this reads it again on
    // every call. Do not hold the result across such a call.
    std::span<const uint8_t> span() const;
    // Node's CheckSizeInt32(): INT_MAX bytes, which maxVectorSize also is. Tests can lower it.
    bool isTooBig() const { return span().size() > Bun::maxVectorSize<uint8_t>(); }
    [[nodiscard]] std::optional<ncrypto::DataPointer> tryCopy() const { return tryCopyBytes(span()); }
    // For a job context. A job that runs on the work pool owns a copy, and nullopt means the
    // copy could not be allocated. A job that runs before the call returns reads in place.
    [[nodiscard]] std::optional<ByteSource> toByteSource(bool ownedCopy) const;

private:
    enum class Kind : uint8_t {
        None,
        View,
        Buffer,
        String,
    };

    JSC::JSCell* m_owner { nullptr };
    Kind m_kind { Kind::None };
    std::optional<UTF8View> m_utf8;
};

}
