#pragma once

#include "root.h"
#include "wtf/text/ASCIIFastPath.h"

extern "C" void WTF__copyLCharsFromUCharSource(LChar* destination, const UChar* source, size_t length);
extern "C" JSC::EncodedJSValue WTF__toBase64URLStringValue(const uint8_t* bytes, size_t length, JSC::JSGlobalObject* globalObject);