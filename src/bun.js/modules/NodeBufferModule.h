#pragma once

#include "root.h"

#include "../bindings/JSBuffer.h"
#include "_NativeModule.h"
#include "simdutf.h"

namespace Zig {
using namespace WebCore;
using namespace JSC;

// TODO: Add DOMJIT fast path
JSC_DEFINE_HOST_FUNCTION(jsBufferConstructorFunction_isUtf8,
                         (JSC::JSGlobalObject * lexicalGlobalObject,
                          JSC::CallFrame *callframe)) {
  auto throwScope = DECLARE_THROW_SCOPE(lexicalGlobalObject->vm());

  auto buffer = callframe->argument(0);
  auto *bufferView = JSC::jsDynamicCast<JSC::JSArrayBufferView *>(buffer);
  const char *ptr = nullptr;
  size_t byteLength = 0;
  if (bufferView) {
    if (UNLIKELY(bufferView->isDetached())) {
      throwTypeError(lexicalGlobalObject, throwScope,
                     "ArrayBufferView is detached"_s);
      return JSValue::encode({});
    }

    byteLength = bufferView->byteLength();

    if (byteLength == 0) {
      return JSValue::encode(jsBoolean(true));
    }

    ptr = reinterpret_cast<const char *>(bufferView->vector());
  } else if (auto *arrayBuffer =
                 JSC::jsDynamicCast<JSC::JSArrayBuffer *>(buffer)) {
    auto *impl = arrayBuffer->impl();

    if (!impl) {
      return JSValue::encode(jsBoolean(true));
    }

    if (UNLIKELY(impl->isDetached())) {
      throwTypeError(lexicalGlobalObject, throwScope,
                     "ArrayBuffer is detached"_s);
      return JSValue::encode({});
    }

    byteLength = impl->byteLength();

    if (byteLength == 0) {
      return JSValue::encode(jsBoolean(true));
    }

    ptr = reinterpret_cast<const char *>(impl->data());
  } else {
    throwVMError(
        lexicalGlobalObject, throwScope,
        createTypeError(lexicalGlobalObject,
                        "First argument must be an ArrayBufferView"_s));
    return JSValue::encode({});
  }

  RELEASE_AND_RETURN(throwScope, JSValue::encode(jsBoolean(
                                     simdutf::validate_utf8(ptr, byteLength))));
}

// TODO: Add DOMJIT fast path
JSC_DEFINE_HOST_FUNCTION(jsBufferConstructorFunction_isAscii,
                         (JSC::JSGlobalObject * lexicalGlobalObject,
                          JSC::CallFrame *callframe)) {
  auto throwScope = DECLARE_THROW_SCOPE(lexicalGlobalObject->vm());

  auto buffer = callframe->argument(0);
  auto *bufferView = JSC::jsDynamicCast<JSC::JSArrayBufferView *>(buffer);
  const char *ptr = nullptr;
  size_t byteLength = 0;
  if (bufferView) {

    if (UNLIKELY(bufferView->isDetached())) {
      throwTypeError(lexicalGlobalObject, throwScope,
                     "ArrayBufferView is detached"_s);
      return JSValue::encode({});
    }

    byteLength = bufferView->byteLength();

    if (byteLength == 0) {
      return JSValue::encode(jsBoolean(true));
    }

    ptr = reinterpret_cast<const char *>(bufferView->vector());
  } else if (auto *arrayBuffer =
                 JSC::jsDynamicCast<JSC::JSArrayBuffer *>(buffer)) {
    auto *impl = arrayBuffer->impl();
    if (UNLIKELY(impl->isDetached())) {
      throwTypeError(lexicalGlobalObject, throwScope,
                     "ArrayBuffer is detached"_s);
      return JSValue::encode({});
    }

    if (!impl) {
      return JSValue::encode(jsBoolean(true));
    }

    byteLength = impl->byteLength();

    if (byteLength == 0) {
      return JSValue::encode(jsBoolean(true));
    }

    ptr = reinterpret_cast<const char *>(impl->data());
  } else {
    throwVMError(
        lexicalGlobalObject, throwScope,
        createTypeError(lexicalGlobalObject,
                        "First argument must be an ArrayBufferView"_s));
    return JSValue::encode({});
  }

  RELEASE_AND_RETURN(
      throwScope,
      JSValue::encode(jsBoolean(simdutf::validate_ascii(ptr, byteLength))));
}

BUN_DECLARE_HOST_FUNCTION(jsFunctionResolveObjectURL);

JSC_DEFINE_HOST_FUNCTION(jsFunctionNotImplemented,
                         (JSGlobalObject * globalObject,
                          CallFrame *callFrame)) {
  VM &vm = globalObject->vm();
  auto scope = DECLARE_THROW_SCOPE(vm);

  throwException(globalObject, scope,
                 createError(globalObject, "Not implemented"_s));
  return JSValue::encode(jsUndefined());
}

DEFINE_NATIVE_MODULE(NodeBuffer) {
  INIT_NATIVE_MODULE(12);

  put(JSC::Identifier::fromString(vm, "Buffer"_s),
      globalObject->JSBufferConstructor());

  auto *slowBuffer = JSC::JSFunction::create(
      vm, globalObject, 0, "SlowBuffer"_s, WebCore::constructSlowBuffer,
      ImplementationVisibility::Public, NoIntrinsic,
      WebCore::constructSlowBuffer);
  slowBuffer->putDirect(
      vm, vm.propertyNames->prototype, globalObject->JSBufferPrototype(),
      JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontEnum |
          JSC::PropertyAttribute::DontDelete);
  put(JSC::Identifier::fromString(vm, "SlowBuffer"_s), slowBuffer);
  auto blobIdent = JSC::Identifier::fromString(vm, "Blob"_s);

  JSValue blobValue = globalObject->JSBlobConstructor();
  put(blobIdent, blobValue);

  put(JSC::Identifier::fromString(vm, "File"_s),
      globalObject->JSDOMFileConstructor());

  put(JSC::Identifier::fromString(vm, "INSPECT_MAX_BYTES"_s),
      JSC::jsNumber(50));

  put(JSC::Identifier::fromString(vm, "kMaxLength"_s),
      JSC::jsNumber(4294967296LL));

  put(JSC::Identifier::fromString(vm, "kStringMaxLength"_s),
      JSC::jsNumber(536870888));

  JSC::JSObject *constants = JSC::constructEmptyObject(
      lexicalGlobalObject, globalObject->objectPrototype(), 2);
  constants->putDirect(vm, JSC::Identifier::fromString(vm, "MAX_LENGTH"_s),
                       JSC::jsNumber(4294967296LL));
  constants->putDirect(vm,
                       JSC::Identifier::fromString(vm, "MAX_STRING_LENGTH"_s),
                       JSC::jsNumber(536870888));

  put(JSC::Identifier::fromString(vm, "constants"_s), constants);

  JSC::Identifier atobI = JSC::Identifier::fromString(vm, "atob"_s);
  JSC::JSValue atobV =
      lexicalGlobalObject->get(globalObject, PropertyName(atobI));

  JSC::Identifier btoaI = JSC::Identifier::fromString(vm, "btoa"_s);
  JSC::JSValue btoaV =
      lexicalGlobalObject->get(globalObject, PropertyName(btoaI));

  put(atobI, atobV);
  put(btoaI, btoaV);

  auto *transcode = InternalFunction::createFunctionThatMasqueradesAsUndefined(
      vm, globalObject, 1, "transcode"_s, jsFunctionNotImplemented);

  put(JSC::Identifier::fromString(vm, "transcode"_s), transcode);

  auto *resolveObjectURL =
      InternalFunction::createFunctionThatMasqueradesAsUndefined(
          vm, globalObject, 1, "resolveObjectURL"_s,
          jsFunctionResolveObjectURL);

  put(JSC::Identifier::fromString(vm, "resolveObjectURL"_s), resolveObjectURL);

  put(JSC::Identifier::fromString(vm, "isAscii"_s),
      JSC::JSFunction::create(vm, globalObject, 1, "isAscii"_s,
                              jsBufferConstructorFunction_isAscii,
                              ImplementationVisibility::Public, NoIntrinsic,
                              jsBufferConstructorFunction_isUtf8));

  put(JSC::Identifier::fromString(vm, "isUtf8"_s),
      JSC::JSFunction::create(vm, globalObject, 1, "isUtf8"_s,
                              jsBufferConstructorFunction_isUtf8,
                              ImplementationVisibility::Public, NoIntrinsic,
                              jsBufferConstructorFunction_isUtf8));
}

} // namespace Zig
