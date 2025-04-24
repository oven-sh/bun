#pragma once

#include "root.h"
#include "ncrypto.h"
#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/ThrowScope.h>
#include "CryptoAlgorithmRegistry.h"
#include "JSBufferEncodingType.h"

namespace Bun {

using namespace JSC;

enum class DSASigEnc {
    DER,
    P1363,
    Invalid,
};

namespace ExternZigHash {
struct Hasher;

Hasher* getByName(Zig::GlobalObject* globalObject, const StringView& name);
Hasher* getFromOther(Zig::GlobalObject* globalObject, Hasher* hasher);
void destroy(Hasher* hasher);
bool update(Hasher* hasher, std::span<const uint8_t> data);
uint32_t digest(Hasher* hasher, Zig::GlobalObject* globalObject, std::span<uint8_t> out);
uint32_t getDigestSize(Hasher* hasher);

}; // namespace ExternZigHash

namespace StringBytes {
EncodedJSValue encode(JSGlobalObject* lexicalGlobalObject, ThrowScope& scope, std::span<const uint8_t> bytes, BufferEncodingType encoding);
};

// void CheckThrow(JSC::JSGlobalObject* globalObject, SignBase::Error error);
JSC::JSValue unsignedBigIntToBuffer(JSC::JSGlobalObject* lexicalGlobalObject, JSC::ThrowScope& scope, JSValue bigIntValue, ASCIILiteral name);
WebCore::BufferEncodingType getEncodingDefaultBuffer(JSGlobalObject* globalObject, ThrowScope& scope, JSValue encodingValue);
std::optional<ncrypto::EVPKeyPointer> keyFromString(JSGlobalObject* lexicalGlobalObject, JSC::ThrowScope& scope, const WTF::StringView& keyView, JSValue passphraseValue);
ncrypto::EVPKeyPointer::PKFormatType parseKeyFormat(JSC::JSGlobalObject* globalObject, JSValue formatValue, WTF::ASCIILiteral optionName, std::optional<ncrypto::EVPKeyPointer::PKFormatType> defaultFormat = std::nullopt);
std::optional<ncrypto::EVPKeyPointer::PKEncodingType> parseKeyType(JSC::JSGlobalObject* globalObject, JSValue typeValue, bool required, WTF::StringView keyType, std::optional<bool> isPublic, WTF::ASCIILiteral optionName);
bool isArrayBufferOrView(JSValue value);
std::optional<ncrypto::DataPointer> passphraseFromBufferSource(JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope, JSValue input);
JSValue createCryptoError(JSC::JSGlobalObject* globalObject, ThrowScope& scope, uint32_t err, const char* message);
void throwCryptoError(JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope, uint32_t err, const char* message = nullptr);
void throwCryptoOperationFailed(JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope);
std::optional<int32_t> getIntOption(JSC::JSGlobalObject* globalObject, JSC::ThrowScope&, JSValue options, WTF::ASCIILiteral name);
int32_t getPadding(JSC::JSGlobalObject* globalObject, JSC::ThrowScope&, JSValue options, const ncrypto::EVPKeyPointer& pkey);
std::optional<int32_t> getSaltLength(JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope, JSValue options);
DSASigEnc getDSASigEnc(JSC::JSGlobalObject* globalObject, JSC::ThrowScope&, JSValue options);
bool convertP1363ToDER(const ncrypto::Buffer<const unsigned char>& p1363Sig, const ncrypto::EVPKeyPointer& pkey, WTF::Vector<uint8_t>& derBuffer);
GCOwnedDataScope<std::span<const uint8_t>> getArrayBufferOrView2(JSGlobalObject* globalObject, ThrowScope& scope, JSValue dataValue, ASCIILiteral argName, JSValue encodingValue, bool arrayBufferViewOnly = false);
JSC::JSArrayBufferView* getArrayBufferOrView(JSGlobalObject* globalObject, ThrowScope& scope, JSValue value, ASCIILiteral argName, JSValue encodingValue, bool defaultBufferEncoding = false);
JSC::JSArrayBufferView* getArrayBufferOrView(JSGlobalObject* globalObject, ThrowScope& scope, JSValue value, ASCIILiteral argName, BufferEncodingType encoding);
JSValue getStringOption(JSGlobalObject* globalObject, JSValue options, const WTF::ASCIILiteral& name);
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

}
