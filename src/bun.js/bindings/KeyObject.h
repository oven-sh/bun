
#pragma once

#include "root.h"
#include "helpers.h"
namespace WebCore {

JSC::EncodedJSValue KeyObject__AsymmetricKeyType(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame);
JSC::EncodedJSValue KeyObject_AsymmetricKeyDetails(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame);
JSC::EncodedJSValue KeyObject__SymmetricKeySize(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame);
JSC::EncodedJSValue KeyObject__Equals(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame);
JSC::EncodedJSValue KeyObject__Exports(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame);
JSC::EncodedJSValue KeyObject__createSecretKey(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame);
JSC::EncodedJSValue KeyObject__createPublicKey(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame);
JSC::EncodedJSValue KeyObject__createPrivateKey(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame);
JSC::EncodedJSValue KeyObject__generateKeySync(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame);
}