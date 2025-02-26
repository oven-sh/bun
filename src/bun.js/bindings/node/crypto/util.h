#pragma once

#include "root.h"
#include "ncrypto.h"

namespace Bun {

using namespace JSC;

// void CheckThrow(JSC::JSGlobalObject* globalObject, SignBase::Error error);
void throwCryptoError(JSGlobalObject* globalObject, ThrowScope& scope, unsigned long err, const char* message = nullptr);

}
