// clang-format off
#include "BakeSourceProvider.h"
#include "DevServerSourceProvider.h"
#include "BakeGlobalObject.h"
#include "JavaScriptCore/CallData.h"
#include "JavaScriptCore/Completion.h"
#include "JavaScriptCore/Error.h"
#include "JavaScriptCore/ErrorInstance.h"
#include "JavaScriptCore/Identifier.h"
#include "JavaScriptCore/JSCJSValue.h"
#include "JavaScriptCore/JSCast.h"
#include "JavaScriptCore/JSLock.h"
#include "JavaScriptCore/JSMap.h"
#include "JavaScriptCore/JSModuleLoader.h"
#include "JavaScriptCore/ModuleRegistryEntry.h"
#include "JavaScriptCore/ParserError.h"
#include "JavaScriptCore/SourceProviderCache.h"
#include "JavaScriptCore/JSModuleRecord.h"
#include "JavaScriptCore/JSString.h"
#include "JavaScriptCore/JSModuleNamespaceObject.h"
#include "ImportMetaObject.h"
#include <wtf/text/MakeString.h>

namespace Bake {

  
extern "C" void* BakeSourceProvider__getBunVM(SourceProvider* provider)
{
    return provider->bunVM();
}

extern "C" BunString BakeSourceProvider__getSourceSlice(SourceProvider* provider)
{
    return Bun::toStringView(provider->source());
}

// Rust calls the EncodedJSValue functions below through `from_js_host_call`,
// so they must only return empty when an exception is pending.

// Why server code did not load. `ServerLoadFailure` in server_hmr_ffi.rs decodes it.
enum class ServerLoadFailure : uint8_t {
  // The code threw when it ran.
  Threw = 0,
  // JavaScriptCore did not parse the code, so none of it ran.
  SyntaxError = 1,
  ParserOutOfStackOrMemory = 2,
};

static ServerLoadFailure classifyLoadFailure(JSC::Exception* exception) {
  auto* error = dynamicDowncast<JSC::ErrorInstance>(exception->value());
  if (!error || !error->isParseError()) {
    return ServerLoadFailure::Threw;
  }
  return error->errorType() == JSC::ErrorType::SyntaxError ? ServerLoadFailure::SyntaxError : ServerLoadFailure::ParserOutOfStackOrMemory;
}

// On an exception, `failure` says why the server runtime did not load.
extern "C" JSC::EncodedJSValue BakeLoadInitialServerCode(JSC::JSGlobalObject* global, BunString source, bool separateSSRGraph, ServerLoadFailure* failure) {
  auto& vm = JSC::getVM(global);
  auto scope = DECLARE_THROW_SCOPE(vm);
  *failure = ServerLoadFailure::Threw;

  String string = "bake://server-runtime.js"_s;
  JSC::SourceOrigin origin = JSC::SourceOrigin(WTF::URL(string));
  JSC::SourceCode sourceCode = JSC::SourceCode(SourceProvider::create(
    global,
    source.transferToWTFString(),
    origin,
    WTF::move(string),
    WTF::TextPosition(),
    JSC::SourceProviderSourceType::Program
  ));

  JSC::JSValue fnValue = vm.interpreter.executeProgram(sourceCode, global, global);
  if (JSC::Exception* exception = scope.exception()) [[unlikely]] {
    *failure = classifyLoadFailure(exception);
    return {};
  }

  RELEASE_ASSERT(fnValue);

  JSC::JSFunction* fn = uncheckedDowncast<JSC::JSFunction>(fnValue);
  JSC::CallData callData = JSC::getCallData(fn);

  JSC::MarkedArgumentBuffer args;
  args.append(JSC::jsBoolean(separateSSRGraph)); // separateSSRGraph
  args.append(Zig::ImportMetaObject::create(global, "bake://server-runtime.js"_s)); // importMeta

  // `JSC::call` returns undefined, not empty, when the callee throws.
  JSC::JSValue result = JSC::profiledCall(global, JSC::ProfilingReason::API, fn, callData, JSC::jsUndefined(), args);
  RETURN_IF_EXCEPTION(scope, {});
  return JSC::JSValue::encode(result);
}

extern "C" JSC::EncodedJSValue BakeLoadModuleByKey(JSC::JSGlobalObject* global, JSC::EncodedJSValue keyValue) {
  auto& vm = JSC::getVM(global);
  auto scope = DECLARE_THROW_SCOPE(vm);

  JSC::JSString* key = uncheckedDowncast<JSC::JSString>(JSC::JSValue::decode(keyValue));
  String keyString = key->getString(global);
  RETURN_IF_EXCEPTION(scope, {});

  JSC::JSPromise* promise = JSC::loadAndEvaluateModule(global, keyString, nullptr, nullptr);
  RETURN_IF_EXCEPTION(scope, {});
  ASSERT(promise);
  return JSC::JSValue::encode(promise);
}

// Loads a server patch: one Program that evaluates to the object of its modules. On success the caller owns the ref
// in `provider`. On an exception, `failure` says why the patch did not load.
extern "C" JSC::EncodedJSValue BakeLoadServerHmrPatch(JSC::JSGlobalObject* global, BunString source, DevServerSourceProvider** provider, ServerLoadFailure* failure) {
  auto& vm = JSC::getVM(global);
  auto scope = DECLARE_THROW_SCOPE(vm);

  String string = "bake://server.patch.js"_s;
  JSC::SourceOrigin origin = JSC::SourceOrigin(WTF::URL(string));
  Ref sourceProvider = DevServerSourceProvider::create(
    source.transferToWTFString(),
    origin,
    WTF::move(string),
    WTF::TextPosition(),
    JSC::SourceProviderSourceType::Program
  );
  JSC::SourceCode sourceCode = JSC::SourceCode(sourceProvider.copyRef());

  JSC::JSValue result = vm.interpreter.executeProgram(sourceCode, global, global);
  if (JSC::Exception* exception = scope.exception()) [[unlikely]] {
    *failure = classifyLoadFailure(exception);
    // The parser's cache for a provider keeps the provider, and so its text, until the second full collection.
    vm.sourceProviderCacheMap.remove(sourceProvider.ptr());
    return {};
  }

  RELEASE_ASSERT(result);
  *provider = &sourceProvider.leakRef();
  return JSC::JSValue::encode(result);
}

// What JavaScriptCore's parser reports for a module it rejects. `ParseFailure` in server_hmr_ffi.rs mirrors it.
struct ParseFailure {
  BunString message;
  // The start of the token the parser stopped at, zero-based. The column counts UTF-16 code units.
  int32_t line;
  int32_t column;
  // The token starts the code that the parser rejects. If false, the token is after that code.
  bool atRejectedCode;
};

// Parses one module of a server patch the way BakeLoadServerHmrPatch does, without running it. Returns false and sets
// `failure` if JavaScriptCore rejects it.
extern "C" bool BakeCheckServerHmrModuleSyntax(JSC::JSGlobalObject* global, BunString module, ParseFailure* failure) {
  auto& vm = JSC::getVM(global);
  // A patch is `({` modules `})`. When an expression in parentheses fails, the parser reads a `)` at the failure as
  // the end of that expression, and can then retry the text as the parameters of an arrow function. It then reports
  // another token, or another message. `!{` has neither. The line break keeps the columns of the module's first line.
  JSC::SourceCode sourceCode = JSC::makeSource(makeString("!{\n"_s, module.transferToWTFString(), '}'), JSC::SourceOrigin(), JSC::SourceTaintedOrigin::Untainted);
  JSC::ParserError error;
  bool accepted = JSC::checkSyntax(vm, sourceCode, error);
  // The parser's cache for a provider keeps the provider, and so its text, until the second full collection.
  vm.sourceProviderCacheMap.remove(sourceCode.provider());
  if (accepted) {
    return true;
  }

  // A parser that ran out of stack gives no message.
  failure->message = Bun::toStringRef(error.type() == JSC::ParserError::StackOverflow ? String("Maximum call stack size exceeded"_s) : error.message());
  const JSC::JSToken& token = error.token();
  int start = token.m_startPosition.offset;
  ASSERT(start >= 0);
  JSC::LineColumn position = sourceCode.provider()->lineColumnInTextForOffset(start);
  ASSERT(position.line >= 1);
  failure->line = static_cast<int32_t>(position.line) - 1;
  failure->column = static_cast<int32_t>(position.column);
  // The parser rejects a `with`, `using` or `await using` statement before it reads past the first token of the
  // statement. It reports every other rejection after it read the rejected code.
  failure->atRejectedCode = token.m_type == JSC::WITH
    || token.m_type == JSC::AWAIT
    || (token.m_type == JSC::IDENT && sourceCode.view().substring(start, token.m_endPosition.offset - start) == "using"_s);
  return false;
}

// Only returns nullptr when an exception is pending.
static JSC::JSModuleNamespaceObject* getModuleNamespace(JSC::JSGlobalObject* global, JSC::JSValue keyValue) {
  auto& vm = JSC::getVM(global);
  auto scope = DECLARE_THROW_SCOPE(vm);

  JSC::JSString* key = uncheckedDowncast<JSC::JSString>(keyValue);
  String keyString = key->getString(global);
  RETURN_IF_EXCEPTION(scope, nullptr);

  auto keyIdent = JSC::Identifier::fromString(vm, keyString);
  auto* entry = global->moduleLoader()->registryEntry(keyIdent);
  auto* module = entry ? entry->record() : nullptr;
  if (!module) [[unlikely]] {
    throwTypeError(global, scope, makeString("Module \""_s, keyString, "\" is not in the module registry"_s));
    return nullptr;
  }
  JSC::JSModuleNamespaceObject* namespaceObject = global->moduleLoader()->getModuleNamespaceObject(global, module);
  RETURN_IF_EXCEPTION(scope, nullptr);
  ASSERT(namespaceObject);
  return namespaceObject;
}

extern "C" JSC::EncodedJSValue BakeGetModuleNamespace(
  JSC::JSGlobalObject* global,
  JSC::EncodedJSValue keyValue
) {
  return JSC::JSValue::encode(getModuleNamespace(global, JSC::JSValue::decode(keyValue)));
}

extern "C" JSC::EncodedJSValue BakeGetDefaultExportFromModule(
  JSC::JSGlobalObject* global,
  JSC::EncodedJSValue keyValue
) {
  auto& vm = JSC::getVM(global);
  auto scope = DECLARE_THROW_SCOPE(vm);

  JSC::JSModuleNamespaceObject* namespaceObject = getModuleNamespace(global, JSC::JSValue::decode(keyValue));
  RETURN_IF_EXCEPTION(scope, {});

  JSC::JSValue defaultExport = namespaceObject->get(global, vm.propertyNames->defaultKeyword);
  RETURN_IF_EXCEPTION(scope, {});
  return JSC::JSValue::encode(defaultExport);
}

// There were issues when trying to use JSValue.get from zig
extern "C" JSC::EncodedJSValue BakeGetOnModuleNamespace(
  JSC::JSGlobalObject* global,
  JSC::JSModuleNamespaceObject* moduleNamespace,
  const unsigned char* key,
  size_t keyLength
) {
  auto& vm = JSC::getVM(global);
  auto scope = DECLARE_THROW_SCOPE(vm);
  const auto propertyString = String(StringImpl::createWithoutCopying({ byteCast<Latin1Character>(key), keyLength }));
  const auto identifier = JSC::Identifier::fromString(vm, propertyString);
  const auto property = JSC::PropertyName(identifier);
  JSC::JSValue value = moduleNamespace->get(global, property);
  RETURN_IF_EXCEPTION(scope, {});
  return JSC::JSValue::encode(value);
}

} // namespace Bake
