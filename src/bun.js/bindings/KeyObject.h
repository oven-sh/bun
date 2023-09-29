
#pragma once

#include "root.h"
#include "helpers.h"
namespace WebCore {

JSC::EncodedJSValue WebCrypto__AsymmetricKeyType(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame);
JSC::EncodedJSValue WebCrypto__SymmetricKeySize(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame);
JSC::EncodedJSValue WebCrypto__Equals(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame);
JSC::EncodedJSValue WebCrypto__Exports(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame);
JSC::EncodedJSValue WebCrypto__createSecretKey(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame);

}