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

// ML-DSA / ML-KEM parameter sets, as provided by BoringSSL's EVP_PKEY
// integration. BoringSSL has ML-KEM-768 and ML-KEM-1024 but not ML-KEM-512.
// Each returns 0 / a null literal / nullptr for any other key type.
int pqcKeyTypeToNid(const WTF::StringView& name);
ASCIILiteral pqcNidToKeyTypeName(int nid);
bool isMlDsaNid(int nid);
bool isMlKemNid(int nid);

// The seed and raw-public constructors are keyed on EVP_PKEY_ALG, not on NID.
const EVP_PKEY_ALG* pqcNidToAlg(int nid);

namespace ExternZigHash {
struct Hasher;

extern "C" void Bun__CryptoHasherExtern__destroy(Hasher* hasher);
using HasherPointer = ncrypto::DeleteFnPtr<Hasher, Bun__CryptoHasherExtern__destroy>;

HasherPointer getByName(const StringView& name);
HasherPointer getFromOther(Hasher* hasher);
bool update(Hasher* hasher, std::span<const uint8_t> data);
uint32_t digest(Hasher* hasher, std::span<uint8_t> out);
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
bool convertP1363ToDER(const ncrypto::Buffer<const unsigned char>& p1363Sig, const ncrypto::EVPKeyPointer& pkey, WTF::Vector<uint8_t>& derBuffer);
std::optional<WebCore::BufferEncodingType> getInputEncoding(JSGlobalObject* globalObject, ThrowScope& scope, JSValue encodingValue);
GCOwnedDataScope<std::span<const uint8_t>> getArrayBufferOrView2(JSGlobalObject* globalObject, ThrowScope& scope, JSValue dataValue, ASCIILiteral argName, JSValue encodingValue);
JSC::JSArrayBufferView* getArrayBufferOrView(JSGlobalObject* globalObject, ThrowScope& scope, JSValue value, ASCIILiteral argName, JSValue encodingValue, bool defaultBufferEncoding = false);
JSC::JSArrayBufferView* getArrayBufferOrView(JSGlobalObject* globalObject, ThrowScope& scope, JSValue value, ASCIILiteral argName, BufferEncodingType encoding);
bool isKeyValidForCurve(const EC_GROUP* group, const ncrypto::BignumPointer& privateKey);
std::optional<std::span<const uint8_t>> getBuffer(JSC::JSValue maybeBuffer);
// Like Node, throws ERR_OUT_OF_RANGE "<argName> is too big" if `bytes` is longer than INT32_MAX.
std::optional<WTF::Vector<uint8_t>> copyArgumentBytes(JSGlobalObject* globalObject, ThrowScope& scope, std::span<const uint8_t> bytes, ASCIILiteral argName);

// For output encoding
void parsePublicKeyEncoding(JSGlobalObject*, ThrowScope&, JSObject* enc, JSValue keyTypeValue, WTF::StringView objName, ncrypto::EVPKeyPointer::PublicKeyEncodingConfig&);
void parsePrivateKeyEncoding(JSGlobalObject*, ThrowScope&, JSObject* enc, JSValue keyTypeValue, WTF::StringView objName, ncrypto::EVPKeyPointer::PrivateKeyEncodingConfig&);
void parseKeyEncoding(JSGlobalObject* globalObject, ThrowScope& scope, JSObject* enc, JSValue keyTypeValue, std::optional<bool> isPublic, WTF::StringView objName, ncrypto::EVPKeyPointer::PrivateKeyEncodingConfig& config);

}
