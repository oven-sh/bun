#pragma once

#include "root.h"
#include "ncrypto.h"

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
std::optional<ncrypto::DataPointer> passphraseFromBufferSource(JSC::JSGlobalObject* globalObject, ThrowScope& scope, JSValue input);
void throwCryptoError(JSGlobalObject* globalObject, ThrowScope& scope, unsigned long err, const char* message = nullptr);

}
