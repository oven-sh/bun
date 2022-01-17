#include "BunStream.h"
#include <JavaScriptCore/JSMicrotask.h>
#include <JavaScriptCore/ObjectConstructor.h>

namespace Bun {
using JSGlobalObject = JSC::JSGlobalObject;
using Exception = JSC::Exception;
using JSValue = JSC::JSValue;
using JSString = JSC::JSString;
using JSModuleLoader = JSC::JSModuleLoader;
using JSModuleRecord = JSC::JSModuleRecord;
using Identifier = JSC::Identifier;
using SourceOrigin = JSC::SourceOrigin;
using JSObject = JSC::JSObject;
using JSNonFinalObject = JSC::JSNonFinalObject;
namespace JSCastingHelpers = JSC::JSCastingHelpers;

static ReadableEvent getReadableEvent(const WTF::String &eventName);
static ReadableEvent getReadableEvent(const WTF::String &eventName) {
  if (eventName == "close")
    return ReadableEvent__Close;
  else if (eventName == "data")
    return ReadableEvent__Data;
  else if (eventName == "end")
    return ReadableEvent__End;
  else if (eventName == "error")
    return ReadableEvent__Error;
  else if (eventName == "pause")
    return ReadableEvent__Pause;
  else if (eventName == "readable")
    return ReadableEvent__Readable;
  else if (eventName == "resume")
    return ReadableEvent__Resume;
  else if (eventName == "open")
    return ReadableEvent__Open;
  else
    return ReadableEventUser;
}

static WritableEvent getWritableEvent(const WTF::String &eventName);
static WritableEvent getWritableEvent(const WTF::String &eventName) {
  if (eventName == "close")
    return WritableEvent__Close;
  else if (eventName == "drain")
    return WritableEvent__Drain;
  else if (eventName == "error")
    return WritableEvent__Error;
  else if (eventName == "finish")
    return WritableEvent__Finish;
  else if (eventName == "pipe")
    return WritableEvent__Pipe;
  else if (eventName == "unpipe")
    return WritableEvent__Unpipe;
  else if (eventName == "open")
    return WritableEvent__Open;
  else
    return WritableEventUser;
}

// clang-format off
#define DEFINE_CALLBACK_FUNCTION_BODY(TypeName, ZigFunction) JSC::VM& vm = globalObject->vm(); \
    auto* thisObject = JSC::jsDynamicCast<TypeName*>(vm, callFrame->thisValue()); \
    auto scope = DECLARE_THROW_SCOPE(vm); \
    if (!thisObject) \
        return throwVMTypeError(globalObject, scope); \
    auto argCount = static_cast<uint16_t>(callFrame->argumentCount()); \
    WTF::Vector<JSC::EncodedJSValue, 16> arguments; \
    arguments.reserveInitialCapacity(argCount); \
     if (argCount) { \
        for (uint16_t i = 0; i < argCount; ++i) { \
            arguments.uncheckedAppend(JSC::JSValue::encode(callFrame->uncheckedArgument(i))); \
        } \
     } \
    JSC::JSValue result = JSC::JSValue::decode( \
        ZigFunction(thisObject->state, globalObject, arguments.data(), argCount) \
    ); \
    JSC::JSObject *obj = result.getObject(); \
    if (UNLIKELY(obj != nullptr && obj->isErrorInstance())) { \
        scope.throwException(globalObject, obj); \
        return JSC::JSValue::encode(JSC::jsUndefined()); \
    } \
    if (UNLIKELY(scope.exception())) \
        return JSC::JSValue::encode(JSC::jsUndefined()); \
    return JSC::JSValue::encode(result);

// clang-format on
// static JSC_DECLARE_HOST_FUNCTION(Writable__addEventListener);
// static JSC_DECLARE_HOST_FUNCTION(Readable__addEventListener);
// static JSC_DECLARE_HOST_FUNCTION(Writable__prependListener);
// static JSC_DECLARE_HOST_FUNCTION(Readable__prependListener);
// static JSC_DECLARE_HOST_FUNCTION(Writable__prependOnceListener);
// static JSC_DECLARE_HOST_FUNCTION(Readable__prependOnceListener);
// static JSC_DECLARE_HOST_FUNCTION(Writable__setMaxListeners);
// static JSC_DECLARE_HOST_FUNCTION(Readable__setMaxListeners);
// static JSC_DECLARE_HOST_FUNCTION(Writable__getMaxListeners);
// static JSC_DECLARE_HOST_FUNCTION(Readable__getMaxListeners);
// static JSC_DECLARE_HOST_FUNCTION(Readable__setDefaultEncoding);
static JSC_DECLARE_HOST_FUNCTION(Readable__on);
// static JSC_DECLARE_HOST_FUNCTION(Readable__off);
static JSC_DECLARE_HOST_FUNCTION(Readable__once);
static JSC_DECLARE_HOST_FUNCTION(Readable__pause);
static JSC_DECLARE_HOST_FUNCTION(Readable__pipe);
static JSC_DECLARE_HOST_FUNCTION(Readable__read);
static JSC_DECLARE_HOST_FUNCTION(Readable__resume);
static JSC_DECLARE_HOST_FUNCTION(Readable__unpipe);
static JSC_DECLARE_HOST_FUNCTION(Readable__unshift);

static JSC_DECLARE_HOST_FUNCTION(Writable__close);
// static JSC_DECLARE_HOST_FUNCTION(Writable__off);
static JSC_DECLARE_HOST_FUNCTION(Writable__cork);
static JSC_DECLARE_HOST_FUNCTION(Writable__destroy);
static JSC_DECLARE_HOST_FUNCTION(Writable__end);
static JSC_DECLARE_HOST_FUNCTION(Writable__on);
static JSC_DECLARE_HOST_FUNCTION(Writable__once);
static JSC_DECLARE_HOST_FUNCTION(Writable__uncork);
static JSC_DECLARE_HOST_FUNCTION(Writable__write);

static JSC_DEFINE_HOST_FUNCTION(Readable__on,
                                (JSC::JSGlobalObject * globalObject, JSC::CallFrame *callFrame)) {

  if (callFrame->argumentCount() < 2) { return JSC::JSValue::encode(JSC::jsUndefined()); }
  JSC::VM &vm = globalObject->vm();
  auto scope = DECLARE_THROW_SCOPE(vm);

  auto thisObject = JSC::jsDynamicCast<Bun::Readable *>(vm, callFrame->thisValue());
  if (UNLIKELY(!thisObject)) {
    scope.release();
    JSC::throwVMTypeError(globalObject, scope);
    return JSC::JSValue::encode(JSC::jsUndefined());
  }

  auto eventName = callFrame->argument(0).toStringOrNull(globalObject);
  if (UNLIKELY(!eventName)) {
    scope.release();
    return JSC::JSValue::encode(JSC::jsUndefined());
  }

  ReadableEvent event = getReadableEvent(eventName->value(globalObject));
  if (event == ReadableEventUser) {
    // TODO:
    scope.release();
    return JSC::JSValue::encode(JSC::jsUndefined());
  }

  auto listener = callFrame->argument(1);
  JSC::JSObject *object = listener.getObject();
  if (UNLIKELY(!object) || !listener.isCallable(vm)) {
    scope.release();
    return JSC::JSValue::encode(JSC::jsUndefined());
  }

  Bun__Readable__addEventListener(thisObject->state, globalObject, event,
                                  JSC::JSValue::encode(listener), true);

  scope.release();
  return JSC::JSValue::encode(JSC::jsUndefined());
}

Bun__Readable *JSC__JSValue__getReadableStreamState(JSC__JSValue value, JSC__VM *vm) {
  auto *thisObject = JSC::jsDynamicCast<Bun::Readable *>(*vm, JSC::JSValue::decode(value));
  if (UNLIKELY(!thisObject)) { return nullptr; }
  return thisObject->state;
}
Bun__Writable *JSC__JSValue__getWritableStreamState(JSC__JSValue value, JSC__VM *vm) {
  auto *thisObject = JSC::jsDynamicCast<Bun::Writable *>(*vm, JSC::JSValue::decode(value));
  if (UNLIKELY(!thisObject)) { return nullptr; }
  return thisObject->state;
}

static JSC_DEFINE_HOST_FUNCTION(Readable__once,
                                (JSC::JSGlobalObject * globalObject, JSC::CallFrame *callFrame)) {

  if (callFrame->argumentCount() < 2) { return JSC::JSValue::encode(JSC::jsUndefined()); }
  JSC::VM &vm = globalObject->vm();
  auto scope = DECLARE_THROW_SCOPE(vm);

  auto thisObject = JSC::jsDynamicCast<Bun::Readable *>(vm, callFrame->thisValue());
  if (UNLIKELY(!thisObject)) {
    scope.release();
    JSC::throwVMTypeError(globalObject, scope);
    return JSC::JSValue::encode(JSC::jsUndefined());
  }

  auto eventName = callFrame->argument(0).toStringOrNull(globalObject);
  if (UNLIKELY(!eventName)) {
    scope.release();
    return JSC::JSValue::encode(JSC::jsUndefined());
  }

  ReadableEvent event = getReadableEvent(eventName->value(globalObject));
  if (event == ReadableEventUser) {
    // TODO:
    scope.release();
    return JSC::JSValue::encode(JSC::jsUndefined());
  }

  auto listener = callFrame->argument(1);
  JSC::JSObject *object = listener.getObject();
  if (UNLIKELY(!object) || !listener.isCallable(vm)) {
    scope.release();
    return JSC::JSValue::encode(JSC::jsUndefined());
  }

  Bun__Readable__addEventListener(thisObject->state, globalObject, event,
                                  JSC::JSValue::encode(listener), true);

  scope.release();
  return JSC::JSValue::encode(JSC::jsUndefined());
}

static JSC_DEFINE_HOST_FUNCTION(Writable__on,
                                (JSC::JSGlobalObject * globalObject, JSC::CallFrame *callFrame)) {

  if (callFrame->argumentCount() < 2) { return JSC::JSValue::encode(JSC::jsUndefined()); }
  JSC::VM &vm = globalObject->vm();
  auto scope = DECLARE_THROW_SCOPE(vm);

  auto thisObject = JSC::jsDynamicCast<Bun::Writable *>(vm, callFrame->thisValue());
  if (UNLIKELY(!thisObject)) {
    scope.release();
    JSC::throwVMTypeError(globalObject, scope);
    return JSC::JSValue::encode(JSC::jsUndefined());
  }

  auto eventName = callFrame->argument(0).toStringOrNull(globalObject);
  if (UNLIKELY(!eventName)) {
    scope.release();
    return JSC::JSValue::encode(JSC::jsUndefined());
  }

  WritableEvent event = getWritableEvent(eventName->value(globalObject));
  if (event == WritableEventUser) {
    // TODO:
    scope.release();
    return JSC::JSValue::encode(JSC::jsUndefined());
  }

  auto listener = callFrame->argument(1);
  JSC::JSObject *object = listener.getObject();
  if (UNLIKELY(!object) || !listener.isCallable(vm)) {
    scope.release();
    return JSC::JSValue::encode(JSC::jsUndefined());
  }

  Bun__Writable__addEventListener(thisObject->state, globalObject, event,
                                  JSC::JSValue::encode(listener), false);

  scope.release();
  return JSC::JSValue::encode(JSC::jsUndefined());
}

static JSC_DEFINE_HOST_FUNCTION(Writable__once,
                                (JSC::JSGlobalObject * globalObject, JSC::CallFrame *callFrame)) {

  if (callFrame->argumentCount() < 2) { return JSC::JSValue::encode(JSC::jsUndefined()); }
  JSC::VM &vm = globalObject->vm();
  auto scope = DECLARE_THROW_SCOPE(vm);

  auto thisObject = JSC::jsDynamicCast<Bun::Writable *>(vm, callFrame->thisValue());
  if (UNLIKELY(!thisObject)) {
    scope.release();
    JSC::throwVMTypeError(globalObject, scope);
    return JSC::JSValue::encode(JSC::jsUndefined());
  }

  auto eventName = callFrame->argument(0).toStringOrNull(globalObject);
  if (UNLIKELY(!eventName)) {
    scope.release();
    return JSC::JSValue::encode(JSC::jsUndefined());
  }

  WritableEvent event = getWritableEvent(eventName->value(globalObject));
  if (event == WritableEventUser) {
    // TODO:
    scope.release();
    return JSC::JSValue::encode(JSC::jsUndefined());
  }

  auto listener = callFrame->argument(1);
  JSC::JSObject *object = listener.getObject();
  if (UNLIKELY(!object) || !listener.isCallable(vm)) {
    scope.release();
    return JSC::JSValue::encode(JSC::jsUndefined());
  }

  Bun__Writable__addEventListener(thisObject->state, globalObject, event,
                                  JSC::JSValue::encode(listener), true);

  scope.release();
  return JSC::JSValue::encode(JSC::jsUndefined());
}

static JSC_DEFINE_HOST_FUNCTION(Readable__read,
                                (JSC::JSGlobalObject * globalObject, JSC::CallFrame *callFrame)) {
  DEFINE_CALLBACK_FUNCTION_BODY(Bun::Readable, Bun__Readable__read);
}

static JSC_DEFINE_HOST_FUNCTION(Readable__pipe,
                                (JSC::JSGlobalObject * globalObject, JSC::CallFrame *callFrame)) {
  DEFINE_CALLBACK_FUNCTION_BODY(Bun::Readable, Bun__Readable__pipe);
}

static JSC_DEFINE_HOST_FUNCTION(Readable__resume,
                                (JSC::JSGlobalObject * globalObject, JSC::CallFrame *callFrame)) {
  DEFINE_CALLBACK_FUNCTION_BODY(Bun::Readable, Bun__Readable__resume);
}
static JSC_DEFINE_HOST_FUNCTION(Readable__unpipe,
                                (JSC::JSGlobalObject * globalObject, JSC::CallFrame *callFrame)) {
  DEFINE_CALLBACK_FUNCTION_BODY(Bun::Readable, Bun__Readable__unpipe);
}
static JSC_DEFINE_HOST_FUNCTION(Readable__pause,
                                (JSC::JSGlobalObject * globalObject, JSC::CallFrame *callFrame)) {
  DEFINE_CALLBACK_FUNCTION_BODY(Bun::Readable, Bun__Readable__pause);
}
static JSC_DEFINE_HOST_FUNCTION(Readable__unshift,
                                (JSC::JSGlobalObject * globalObject, JSC::CallFrame *callFrame)) {
  DEFINE_CALLBACK_FUNCTION_BODY(Bun::Readable, Bun__Readable__unshift);
}

// static JSC_DECLARE_HOST_FUNCTION(Readable__isPaused);
// static JSC_DECLARE_HOST_FUNCTION(Writable__setDefaultEncoding);

// static DEFINE_CALLBACK_FUNCTION(Writable__setDefaultEncoding, Bun::Writable,
//                                 Bun__Writable__setDefaultEncoding);

static JSC_DEFINE_HOST_FUNCTION(Writable__write,
                                (JSC::JSGlobalObject * globalObject, JSC::CallFrame *callFrame)) {
  DEFINE_CALLBACK_FUNCTION_BODY(Bun::Writable, Bun__Writable__write);
}
static JSC_DEFINE_HOST_FUNCTION(Writable__end,
                                (JSC::JSGlobalObject * globalObject, JSC::CallFrame *callFrame)) {
  DEFINE_CALLBACK_FUNCTION_BODY(Bun::Writable, Bun__Writable__end);
}
static JSC_DEFINE_HOST_FUNCTION(Writable__close,
                                (JSC::JSGlobalObject * globalObject, JSC::CallFrame *callFrame)) {
  DEFINE_CALLBACK_FUNCTION_BODY(Bun::Writable, Bun__Writable__close);
}
static JSC_DEFINE_HOST_FUNCTION(Writable__destroy,
                                (JSC::JSGlobalObject * globalObject, JSC::CallFrame *callFrame)) {
  DEFINE_CALLBACK_FUNCTION_BODY(Bun::Writable, Bun__Writable__destroy);
}
static JSC_DEFINE_HOST_FUNCTION(Writable__cork,
                                (JSC::JSGlobalObject * globalObject, JSC::CallFrame *callFrame)) {
  DEFINE_CALLBACK_FUNCTION_BODY(Bun::Writable, Bun__Writable__cork);
}
static JSC_DEFINE_HOST_FUNCTION(Writable__uncork,
                                (JSC::JSGlobalObject * globalObject, JSC::CallFrame *callFrame)) {
  DEFINE_CALLBACK_FUNCTION_BODY(Bun::Writable, Bun__Writable__uncork);
}

JSC__JSValue Bun__Readable__create(JSC__JSGlobalObject *globalObject, Bun__Readable *state) {
  JSC::JSValue result = JSC::JSValue(Readable::create(
    globalObject->vm(), state,
    Readable::createStructure(globalObject->vm(), globalObject, globalObject->objectPrototype())));

  return JSC::JSValue::encode(result);
}
JSC__JSValue Bun__Writable__create(JSC__JSGlobalObject *globalObject, Bun__Writable *state) {
  JSC::JSValue result = JSC::JSValue(Writable::create(
    globalObject->vm(), state,
    Writable::createStructure(globalObject->vm(), globalObject, globalObject->objectPrototype())));

  return JSC::JSValue::encode(result);
}

Readable::~Readable() {
  if (this->state) { Bun__Readable__deinit(this->state); }
}

Writable::~Writable() {
  if (this->state) { Bun__Writable__deinit(this->state); }
}

void Readable::finishCreation(JSC::VM &vm) {
  Base::finishCreation(vm);
  auto clientData = Bun::clientData(vm);
  auto *globalObject = this->globalObject();

  putDirect(vm, clientData->builtinNames().onPublicName(),
            JSFunction::create(vm, globalObject, 2,
                               clientData->builtinNames().onPublicName().string(), Readable__on),
            0);
  putDirect(vm, clientData->builtinNames().oncePublicName(),
            JSFunction::create(vm, globalObject, 2,
                               clientData->builtinNames().oncePublicName().string(),
                               Readable__once),
            0);
  putDirect(vm, clientData->builtinNames().pausePublicName(),
            JSFunction::create(vm, globalObject, 2,
                               clientData->builtinNames().pausePublicName().string(),
                               Readable__pause),
            0);
  putDirect(vm, clientData->builtinNames().pipePublicName(),
            JSFunction::create(vm, globalObject, 2,
                               clientData->builtinNames().pipePublicName().string(),
                               Readable__pipe),
            0);
  putDirect(vm, clientData->builtinNames().readPublicName(),
            JSFunction::create(vm, globalObject, 2,
                               clientData->builtinNames().readPublicName().string(),
                               Readable__read),
            0);
  putDirect(vm, clientData->builtinNames().resumePublicName(),
            JSFunction::create(vm, globalObject, 2,
                               clientData->builtinNames().resumePublicName().string(),
                               Readable__resume),
            0);
  putDirect(vm, clientData->builtinNames().unpipePublicName(),
            JSFunction::create(vm, globalObject, 2,
                               clientData->builtinNames().unpipePublicName().string(),
                               Readable__unpipe),
            0);
  putDirect(vm, clientData->builtinNames().unshiftPublicName(),
            JSFunction::create(vm, globalObject, 2,
                               clientData->builtinNames().unshiftPublicName().string(),
                               Readable__unshift),
            0);
}

void Writable::finishCreation(JSC::VM &vm) {
  Base::finishCreation(vm);
  auto clientData = Bun::clientData(vm);

  auto *globalObject = this->globalObject();

  putDirect(vm, clientData->builtinNames().onPublicName(),
            JSFunction::create(vm, globalObject, 2,
                               clientData->builtinNames().onPublicName().string(), Writable__on),
            0);

  putDirect(vm, clientData->builtinNames().oncePublicName(),
            JSFunction::create(vm, globalObject, 2,
                               clientData->builtinNames().oncePublicName().string(),
                               Writable__once),
            0);

  putDirect(vm, clientData->builtinNames().closePublicName(),
            JSFunction::create(vm, globalObject, 2,
                               clientData->builtinNames().closePublicName().string(),
                               Writable__close),
            0);
  putDirect(vm, clientData->builtinNames().corkPublicName(),
            JSFunction::create(vm, globalObject, 2,
                               clientData->builtinNames().corkPublicName().string(),
                               Writable__cork),
            0);
  putDirect(vm, clientData->builtinNames().destroyPublicName(),
            JSFunction::create(vm, globalObject, 2,
                               clientData->builtinNames().destroyPublicName().string(),
                               Writable__destroy),
            0);
  putDirect(vm, clientData->builtinNames().endPublicName(),
            JSFunction::create(vm, globalObject, 2,
                               clientData->builtinNames().endPublicName().string(), Writable__end),
            0);
  putDirect(vm, clientData->builtinNames().onPublicName(),
            JSFunction::create(vm, globalObject, 2,
                               clientData->builtinNames().onPublicName().string(), Writable__on),
            0);
  putDirect(vm, clientData->builtinNames().oncePublicName(),
            JSFunction::create(vm, globalObject, 2,
                               clientData->builtinNames().oncePublicName().string(),
                               Writable__once),
            0);
  putDirect(vm, clientData->builtinNames().uncorkPublicName(),
            JSFunction::create(vm, globalObject, 2,
                               clientData->builtinNames().uncorkPublicName().string(),
                               Writable__uncork),
            0);
  putDirect(vm, clientData->builtinNames().writePublicName(),
            JSFunction::create(vm, globalObject, 2,
                               clientData->builtinNames().writePublicName().string(),
                               Writable__write),
            0);
}

} // namespace Bun