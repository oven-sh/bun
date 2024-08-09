#include "KitSourceProvider.h"
#include "JavaScriptCore/Completion.h"
#include "JavaScriptCore/Identifier.h"
#include "JavaScriptCore/JSCJSValue.h"
#include "JavaScriptCore/JSLock.h"
#include "JavaScriptCore/JSModuleLoader.h"
#include "JavaScriptCore/JSModuleNamespaceObject.h"
#include "JavaScriptCore/JSString.h"
#include "KitDevGlobalObject.h"

namespace Kit {

extern "C" JSC::JSInternalPromise* KitLoadServerCode(DevGlobalObject* global, BunString source) {
  JSC::JSLockHolder locker(global);
  
  String string = "kit://server/0/index.js"_s;
  JSC::SourceOrigin origin = JSC::SourceOrigin(WTF::URL(string));
  JSC::SourceCode sourceCode = JSC::SourceCode(KitSourceProvider::create(
    source.toWTFString(),
    origin,
    WTFMove(string),
    WTF::TextPosition(),
    JSC::SourceProviderSourceType::Module
  ));
  JSC::JSValue key = JSC::jsString(global->vm(), string);
  global->moduleLoader()->provideFetch(global, key, sourceCode);
  return global->moduleLoader()->loadAndEvaluateModule(global, key, JSC::jsUndefined(), JSC::jsUndefined());
}

extern "C" JSC::EncodedJSValue KitGetRequestHandlerFromModule(
  DevGlobalObject* global,
  JSC::EncodedJSValue encodedKey
) {

}

} // namespace Kit
