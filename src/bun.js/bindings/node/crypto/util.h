#pragma once

#include "root.h"
#include "ncrypto.h"
#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/ThrowScope.h>

namespace Bun {

using namespace JSC;

namespace NodeCryptoKeys {
enum class DSASigEnc {
    DER,
    P1363,
    Invalid,
};

}

// void CheckThrow(JSC::JSGlobalObject* globalObject, SignBase::Error error);
std::optional<ncrypto::EVPKeyPointer> keyFromString(JSGlobalObject* lexicalGlobalObject, JSC::ThrowScope& scope, const WTF::StringView& keyView, JSValue passphraseValue);
ncrypto::EVPKeyPointer::PKFormatType parseKeyFormat(JSC::JSGlobalObject* globalObject, JSValue formatValue, WTF::ASCIILiteral optionName, std::optional<ncrypto::EVPKeyPointer::PKFormatType> defaultFormat = std::nullopt);
std::optional<ncrypto::EVPKeyPointer::PKEncodingType> parseKeyType(JSC::JSGlobalObject* globalObject, JSValue typeValue, bool required, WTF::StringView keyType, std::optional<bool> isPublic, WTF::ASCIILiteral optionName);
std::optional<ncrypto::DataPointer> passphraseFromBufferSource(JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope, JSValue input);
void throwCryptoError(JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope, unsigned long err, const char* message = nullptr);
void throwCryptoOperationFailed(JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope);
std::optional<int32_t> getIntOption(JSC::JSGlobalObject* globalObject, JSValue options, WTF::ASCIILiteral name);
int32_t getPadding(JSC::JSGlobalObject* globalObject, JSValue options, const ncrypto::EVPKeyPointer& pkey);
std::optional<int32_t> getSaltLength(JSC::JSGlobalObject* globalObject, JSValue options);
NodeCryptoKeys::DSASigEnc getDSASigEnc(JSC::JSGlobalObject* globalObject, JSValue options);
JSC::JSArrayBufferView* getArrayBufferOrView(JSGlobalObject* globalObject, ThrowScope& scope, JSValue value, ASCIILiteral argName, JSValue encodingValue);

}
