#include "helpers.h"
#include "root.h"
#include <JavaScriptCore/Completion.h>
#include <JavaScriptCore/ErrorInstance.h>
#include <JavaScriptCore/ExceptionScope.h>
#include <JavaScriptCore/FunctionConstructor.h>
#include <JavaScriptCore/Identifier.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/JSCallbackObject.h>
#include <JavaScriptCore/JSClassRef.h>
#include <JavaScriptCore/JSInternalPromise.h>
#include <JavaScriptCore/JSMap.h>
#include <JavaScriptCore/JSModuleRecord.h>
#include <JavaScriptCore/JSNativeStdFunction.h>
#include <JavaScriptCore/JSObject.h>
#include <JavaScriptCore/JSSet.h>
#include <JavaScriptCore/JSString.h>
#include <JavaScriptCore/ParserError.h>
#include <JavaScriptCore/StackFrame.h>
#include <JavaScriptCore/VM.h>
#include <JavaScriptCore/WasmFaultSignalHandler.h>
#include <wtf/text/ExternalStringImpl.h>
#include <wtf/text/StringCommon.h>
#include <wtf/text/StringImpl.h>
#include <wtf/text/StringView.h>
#include <wtf/text/WTFString.h>

extern "C" {

//     #pragma mark - JSC::PropertyNameArray

// CPP_DECL size_t JSC__PropertyNameArray__length(JSC__PropertyNameArray* arg0);
// CPP_DECL const JSC__PropertyName*
// JSC__PropertyNameArray__next(JSC__PropertyNameArray* arg0, size_t arg1);
// CPP_DECL void JSC__PropertyNameArray__release(JSC__PropertyNameArray* arg0);

#pragma mark - JSC::JSCell

JSC__JSObject *JSC__JSCell__getObject(JSC__JSCell *arg0) { return arg0->getObject(); }
bWTF__String JSC__JSCell__getString(JSC__JSCell *arg0, JSC__JSGlobalObject *arg1) {
  return Wrap<WTF__String, bWTF__String>::wrap(arg0->getString(arg1));
}
unsigned char JSC__JSCell__getType(JSC__JSCell *arg0) { return arg0->type(); }

#pragma mark - JSC::JSString

JSC__JSString *JSC__JSString__createFromOwnedString(JSC__VM *arg0, const WTF__String *arg1) {
  return JSC::jsOwnedString(reinterpret_cast<JSC__VM &>(arg0),
                            reinterpret_cast<const WTF__String &>(arg1));
}
JSC__JSString *JSC__JSString__createFromString(JSC__VM *arg0, const WTF__String *arg1) {
  return JSC::jsString(reinterpret_cast<JSC__VM &>(arg0),
                       reinterpret_cast<const WTF__String &>(arg1));
}
bool JSC__JSString__eql(const JSC__JSString *arg0, JSC__JSGlobalObject *obj, JSC__JSString *arg2) {
  return arg0->equal(obj, arg2);
}
bool JSC__JSString__is8Bit(const JSC__JSString *arg0) { return arg0->is8Bit(); };
size_t JSC__JSString__length(const JSC__JSString *arg0) { return arg0->length(); }
JSC__JSObject *JSC__JSString__toObject(JSC__JSString *arg0, JSC__JSGlobalObject *arg1) {
  return arg0->toObject(arg1);
}
bWTF__String JSC__JSString__value(JSC__JSString *arg0, JSC__JSGlobalObject *arg1) {
  return Wrap<WTF__String, bWTF__String>::wrap(arg0->value(arg1));
}

#pragma mark - JSC::JSModuleLoader

// JSC__JSValue
// JSC__JSModuleLoader__dependencyKeysIfEvaluated(JSC__JSModuleLoader* arg0,
// JSC__JSGlobalObject* arg1, JSC__JSModuleRecord* arg2) {
//     arg2->depen
// }

bool JSC__JSModuleLoader__checkSyntax(JSC__JSGlobalObject *arg0, const JSC__SourceCode *arg1,
                                      bool arg2) {
  JSC::ParserError error;
  bool result = false;
  if (arg2) {
    result = JSC::checkModuleSyntax(arg0, reinterpret_cast<const JSC::SourceCode &>(arg1), error);
  } else {
    result = JSC::checkSyntax(reinterpret_cast<JSC__VM &>(arg0->vm()),
                              reinterpret_cast<const JSC::SourceCode &>(arg1), error);
  }

  return result;
}
JSC__JSValue JSC__JSModuleLoader__evaluate(JSC__JSGlobalObject *arg0, const unsigned char *arg1,
                                           size_t arg2, const unsigned char *arg3, size_t arg4,
                                           JSC__JSValue JSValue5, JSC__JSValue *arg6) {
  WTF::String src = WTF::String(WTF::StringImpl::createWithoutCopying(arg1, arg2));
  WTF::URL origin = WTF::URL::fileURLWithFileSystemPath(WTF::StringView(arg3, arg4));

  JSC::VM &vm = arg0->vm();
  JSC::JSLockHolder locker(vm);

  JSC::SourceCode sourceCode = JSC::makeSource(
    src, JSC::SourceOrigin{origin}, origin.lastPathComponent().toStringWithoutCopying(),
    WTF::TextPosition(), JSC::SourceProviderSourceType::Module);
  WTF::NakedPtr<JSC::Exception> exception;
  auto val = JSC::evaluate(arg0, sourceCode, JSC::JSValue(), exception);
  if (exception.get()) { *arg6 = JSC::JSValue::encode(JSC::JSValue(exception.get())); }

  vm.drainMicrotasks();
  return JSC::JSValue::encode(val);
}
JSC__JSInternalPromise *JSC__JSModuleLoader__importModule(JSC__JSGlobalObject *arg0,
                                                          const JSC__Identifier *arg1) {
  return JSC::importModule(arg0, *arg1, JSC::JSValue{}, JSC::JSValue{});
}
JSC__JSValue JSC__JSModuleLoader__linkAndEvaluateModule(JSC__JSGlobalObject *arg0,
                                                        const JSC__Identifier *arg1) {
  return JSC::JSValue::encode(JSC::linkAndEvaluateModule(arg0, *arg1, JSC::JSValue{}));
}

static JSC::Identifier jsValueToModuleKey(JSC::JSGlobalObject *lexicalGlobalObject,
                                          JSC::JSValue value) {
  if (value.isSymbol())
    return JSC::Identifier::fromUid(JSC::jsCast<JSC::Symbol *>(value)->privateName());
  return JSC::asString(value)->toIdentifier(lexicalGlobalObject);
}

static JSC::JSValue doLink(JSC__JSGlobalObject *globalObject, JSC::JSValue moduleKeyValue) {
  JSC::VM &vm = globalObject->vm();
  JSC::JSLockHolder lock{vm};
  if (!(moduleKeyValue.isString() || moduleKeyValue.isSymbol())) { return JSC::jsUndefined(); }
  auto scope = DECLARE_THROW_SCOPE(vm);
  JSC::Identifier moduleKey = jsValueToModuleKey(globalObject, moduleKeyValue);
  RETURN_IF_EXCEPTION(scope, {});

  return JSC::linkAndEvaluateModule(globalObject, moduleKey, JSC::JSValue());
}

// static JSC::JSNativeStdFunction* resolverFunction;
// static JSC::JSNativeStdFunction* rejecterFunction;
// static bool resolverFunctionInitialized = false;

static JSC::EncodedJSValue resolverFunctionCallback(JSC::JSGlobalObject *globalObject,
                                                    JSC::CallFrame *callFrame) {
  return JSC::JSValue::encode(doLink(globalObject, callFrame->argument(0)));
}

static JSC::EncodedJSValue rejecterFunctionCallback(JSC::JSGlobalObject *globalObject,
                                                    JSC::CallFrame *callFrame) {
  return JSC::JSValue::encode(callFrame->argument(0));
}

JSC__JSInternalPromise *
JSC__JSModuleLoader__loadAndEvaluateModule(JSC__JSGlobalObject *globalObject, ZigString arg1) {
  globalObject->vm().drainMicrotasks();
  auto name = Zig::toString(arg1);
  name.impl()->ref();

  auto *promise =
    JSC::loadAndEvaluateModule(globalObject, name, JSC::jsUndefined(), JSC::jsUndefined());

  JSC::JSNativeStdFunction *resolverFunction = JSC::JSNativeStdFunction::create(
    globalObject->vm(), globalObject, 1, String(), resolverFunctionCallback);
  JSC::JSNativeStdFunction *rejecterFunction = JSC::JSNativeStdFunction::create(
    globalObject->vm(), globalObject, 1, String(), rejecterFunctionCallback);
  globalObject->vm().drainMicrotasks();
  auto result = promise->then(globalObject, resolverFunction, nullptr);
  globalObject->vm().drainMicrotasks();

  // if (promise->status(globalObject->vm()) ==
  // JSC::JSPromise::Status::Fulfilled) {
  //     return reinterpret_cast<JSC::JSInternalPromise*>(
  //         JSC::JSInternalPromise::resolvedPromise(
  //             globalObject,
  //             doLink(globalObject, promise->result(globalObject->vm()))
  //         )
  //     );
  // }

  return result;
}
JSC__JSInternalPromise *
JSC__JSModuleLoader__loadAndEvaluateModuleEntryPoint(JSC__JSGlobalObject *arg0,
                                                     const JSC__SourceCode *arg1) {
  return JSC::loadAndEvaluateModule(arg0, *arg1, JSC::JSValue{});
}

#pragma mark - JSC::JSModuleRecord

bJSC__SourceCode JSC__JSModuleRecord__sourceCode(JSC__JSModuleRecord *arg0) {
  Wrap<JSC::SourceCode, bJSC__SourceCode> wrapped =
    Wrap<JSC::SourceCode, bJSC__SourceCode>(arg0->sourceCode());
  return wrapped.result;
}

#pragma mark - JSC::JSPromise

void JSC__JSPromise__reject(JSC__JSPromise *arg0, JSC__JSGlobalObject *arg1,
                            JSC__JSValue JSValue2) {
  arg0->reject(arg1, JSC::JSValue::decode(JSValue2));
}
void JSC__JSPromise__rejectAsHandled(JSC__JSPromise *arg0, JSC__JSGlobalObject *arg1,
                                     JSC__JSValue JSValue2) {
  arg0->rejectAsHandled(arg1, JSC::JSValue::decode(JSValue2));
}
void JSC__JSPromise__rejectAsHandledException(JSC__JSPromise *arg0, JSC__JSGlobalObject *arg1,
                                              JSC__Exception *arg2) {
  arg0->rejectAsHandled(arg1, arg2);
}
JSC__JSPromise *JSC__JSPromise__rejectedPromise(JSC__JSGlobalObject *arg0, JSC__JSValue JSValue1) {
  return JSC::JSPromise::rejectedPromise(arg0, JSC::JSValue::decode(JSValue1));
}

void JSC__JSPromise__rejectWithCaughtException(JSC__JSPromise *arg0, JSC__JSGlobalObject *arg1,
                                               bJSC__ThrowScope arg2) {
  Wrap<JSC::ThrowScope, bJSC__ThrowScope> wrapped = Wrap<JSC::ThrowScope, bJSC__ThrowScope>(arg2);

  arg0->rejectWithCaughtException(arg1, *wrapped.cpp);
}
void JSC__JSPromise__resolve(JSC__JSPromise *arg0, JSC__JSGlobalObject *arg1,
                             JSC__JSValue JSValue2) {
  arg0->resolve(arg1, JSC::JSValue::decode(JSValue2));
}
JSC__JSPromise *JSC__JSPromise__resolvedPromise(JSC__JSGlobalObject *arg0, JSC__JSValue JSValue1) {
  return JSC::JSPromise::resolvedPromise(arg0, JSC::JSValue::decode(JSValue1));
}

JSC__JSValue JSC__JSPromise__result(const JSC__JSPromise *arg0, JSC__VM *arg1) {
  return JSC::JSValue::encode(arg0->result(reinterpret_cast<JSC::VM &>(arg1)));
}
uint32_t JSC__JSPromise__status(const JSC__JSPromise *arg0, JSC__VM *arg1) {
  switch (arg0->status(reinterpret_cast<JSC::VM &>(arg1))) {
    case JSC::JSPromise::Status::Pending: return 0;
    case JSC::JSPromise::Status::Fulfilled: return 1;
    case JSC::JSPromise::Status::Rejected: return 2;
    default: return 255;
  }
}
bool JSC__JSPromise__isHandled(const JSC__JSPromise *arg0, JSC__VM *arg1) {
  return arg0->isHandled(reinterpret_cast<JSC::VM &>(arg1));
}

#pragma mark - JSC::JSInternalPromise

JSC__JSInternalPromise *JSC__JSInternalPromise__create(JSC__JSGlobalObject *globalObject) {
  JSC::VM &vm = globalObject->vm();
  return JSC::JSInternalPromise::create(vm, globalObject->internalPromiseStructure());
}

void JSC__JSInternalPromise__reject(JSC__JSInternalPromise *arg0, JSC__JSGlobalObject *arg1,
                                    JSC__JSValue JSValue2) {
  arg0->reject(arg1, JSC::JSValue::decode(JSValue2));
}
void JSC__JSInternalPromise__rejectAsHandled(JSC__JSInternalPromise *arg0,
                                             JSC__JSGlobalObject *arg1, JSC__JSValue JSValue2) {
  arg0->rejectAsHandled(arg1, JSC::JSValue::decode(JSValue2));
}
void JSC__JSInternalPromise__rejectAsHandledException(JSC__JSInternalPromise *arg0,
                                                      JSC__JSGlobalObject *arg1,
                                                      JSC__Exception *arg2) {
  arg0->rejectAsHandled(arg1, arg2);
}
JSC__JSInternalPromise *JSC__JSInternalPromise__rejectedPromise(JSC__JSGlobalObject *arg0,
                                                                JSC__JSValue JSValue1) {
  return reinterpret_cast<JSC::JSInternalPromise *>(
    JSC::JSInternalPromise::rejectedPromise(arg0, JSC::JSValue::decode(JSValue1)));
}

void JSC__JSInternalPromise__rejectWithCaughtException(JSC__JSInternalPromise *arg0,
                                                       JSC__JSGlobalObject *arg1,
                                                       bJSC__ThrowScope arg2) {
  Wrap<JSC::ThrowScope, bJSC__ThrowScope> wrapped = Wrap<JSC::ThrowScope, bJSC__ThrowScope>(arg2);

  arg0->rejectWithCaughtException(arg1, *wrapped.cpp);
}
void JSC__JSInternalPromise__resolve(JSC__JSInternalPromise *arg0, JSC__JSGlobalObject *arg1,
                                     JSC__JSValue JSValue2) {
  arg0->resolve(arg1, JSC::JSValue::decode(JSValue2));
}
JSC__JSInternalPromise *JSC__JSInternalPromise__resolvedPromise(JSC__JSGlobalObject *arg0,
                                                                JSC__JSValue JSValue1) {
  return reinterpret_cast<JSC::JSInternalPromise *>(
    JSC::JSInternalPromise::resolvedPromise(arg0, JSC::JSValue::decode(JSValue1)));
}

JSC__JSValue JSC__JSInternalPromise__result(const JSC__JSInternalPromise *arg0, JSC__VM *arg1) {
  return JSC::JSValue::encode(arg0->result(reinterpret_cast<JSC::VM &>(arg1)));
}
uint32_t JSC__JSInternalPromise__status(const JSC__JSInternalPromise *arg0, JSC__VM *arg1) {
  switch (arg0->status(reinterpret_cast<JSC::VM &>(arg1))) {
    case JSC::JSInternalPromise::Status::Pending: return 0;
    case JSC::JSInternalPromise::Status::Fulfilled: return 1;
    case JSC::JSInternalPromise::Status::Rejected: return 2;
    default: return 255;
  }
}
bool JSC__JSInternalPromise__isHandled(const JSC__JSInternalPromise *arg0, JSC__VM *arg1) {
  return arg0->isHandled(reinterpret_cast<JSC::VM &>(arg1));
}

JSC__JSInternalPromise *JSC__JSInternalPromise__then(JSC__JSInternalPromise *arg0,
                                                     JSC__JSGlobalObject *arg1,
                                                     JSC__JSFunction *arg2, JSC__JSFunction *arg3) {
  return arg0->then(arg1, arg2, arg3);
}

// bool JSC__JSPromise__isInternal(JSC__JSPromise* arg0, JSC__VM* arg1) {
//     return arg0->inf
// }

#pragma mark - JSC::SourceOrigin

bJSC__SourceOrigin JSC__SourceOrigin__fromURL(const WTF__URL *arg0) {

  Wrap<JSC::SourceOrigin, bJSC__SourceOrigin> wrap;
  wrap.cpp = new (&wrap.result.bytes) JSC::SourceOrigin(WTF::URL(*arg0));
  return wrap.result;
}

#pragma mark - JSC::SourceCode

// class StringSourceProvider : public JSC::SourceProvider {
//     public:
//         unsigned hash() const override
//         {
//             return m_source->hash();
//         }

//         StringView source() const override
//         {
//             return WTF::StringView(m_source);
//         }

//         ~StringSourceProvider() {

//         }
//         WTF::StringImpl *m_source;

//         StringSourceProvider(const WTF::String& source, const
//         JSC::SourceOrigin& sourceOrigin, WTF::String&& sourceURL, const
//         WTF::TextPosition& startPosition, JSC::SourceProviderSourceType
//         sourceType)
//             : JSC::SourceProvider(sourceOrigin, WTFMove(sourceURL),
//             startPosition, sourceType) , m_source(source.isNull() ?
//             WTF::StringImpl::empty() : source.impl())
//         {
//         }
// };

void JSC__SourceCode__fromString(JSC__SourceCode *arg0, const WTF__String *arg1,
                                 const JSC__SourceOrigin *arg2, WTF__String *arg3,
                                 unsigned char SourceType4) {}

#pragma mark - JSC::JSFunction

JSC__JSValue JSC__JSFunction__callWithArguments(JSC__JSValue JSValue0, JSC__JSGlobalObject *arg1,
                                                JSC__JSValue *arg2, size_t arg3,
                                                JSC__Exception **arg4, const char *arg5) {
  auto args = makeArgs(arg2, arg3);
  return JSC::JSValue::encode(
    JSC::call(arg1, JSC::JSValue::decode(JSValue0), JSC::JSValue::decode(JSValue0), args, arg5));
}
JSC__JSValue JSC__JSFunction__callWithArgumentsAndThis(JSC__JSValue JSValue0, JSC__JSValue JSValue1,
                                                       JSC__JSGlobalObject *arg2,
                                                       JSC__JSValue *arg3, size_t arg4,
                                                       JSC__Exception **arg5, const char *arg6) {
  auto args = makeArgs(arg3, arg4);
  return JSC::JSValue::encode(
    JSC::call(arg2, JSC::JSValue::decode(JSValue0), JSC::JSValue::decode(JSValue1), args, arg6));
}
JSC__JSValue JSC__JSFunction__callWithoutAnyArgumentsOrThis(JSC__JSValue JSValue0,
                                                            JSC__JSGlobalObject *arg1,
                                                            JSC__Exception **arg2,
                                                            const char *arg3) {
  return JSC::JSValue::encode(JSC::call(arg1, JSC::JSValue::decode(JSValue0),
                                        JSC::JSValue::decode(JSValue0), JSC::ArgList(), arg3));
}
JSC__JSValue JSC__JSFunction__callWithThis(JSC__JSValue JSValue0, JSC__JSGlobalObject *arg1,
                                           JSC__JSValue JSValue2, JSC__Exception **arg3,
                                           const char *arg4) {
  return JSC::JSValue::encode(JSC::call(arg1, JSC::JSValue::decode(JSValue0),
                                        JSC::JSValue::decode(JSValue2), JSC::ArgList(), arg4));
}
JSC__JSValue JSC__JSFunction__constructWithArguments(JSC__JSValue JSValue0,
                                                     JSC__JSGlobalObject *arg1, JSC__JSValue *arg2,
                                                     size_t arg3, JSC__Exception **arg4,
                                                     const char *arg5) {
  auto args = makeArgs(arg2, arg3);
  return JSC::JSValue::encode(JSC::construct(arg1, JSC::JSValue::decode(JSValue0), args, arg5));
}

JSC__JSValue JSC__JSFunction__constructWithArgumentsAndNewTarget(
  JSC__JSValue JSValue0, JSC__JSValue JSValue1, JSC__JSGlobalObject *arg2, JSC__JSValue *arg3,
  size_t arg4, JSC__Exception **arg5, const char *arg6) {
  auto args = makeArgs(arg3, arg4);
  return JSC::JSValue::encode(JSC::construct(arg2, JSC::JSValue::decode(JSValue0),
                                             JSC::JSValue::decode(JSValue0), args, arg6));
}
JSC__JSValue JSC__JSFunction__constructWithNewTarget(JSC__JSValue JSValue0,
                                                     JSC__JSGlobalObject *arg1,
                                                     JSC__JSValue JSValue2, JSC__Exception **arg3,
                                                     const char *arg4) {
  return JSC::JSValue::encode(JSC::construct(arg1, JSC::JSValue::decode(JSValue0),
                                             JSC::JSValue::decode(JSValue2), JSC::ArgList(), arg4));
}
JSC__JSValue JSC__JSFunction__constructWithoutAnyArgumentsOrNewTarget(JSC__JSValue JSValue0,
                                                                      JSC__JSGlobalObject *arg1,
                                                                      JSC__Exception **arg2,
                                                                      const char *arg3) {
  return JSC::JSValue::encode(
    JSC::construct(arg1, JSC::JSValue::decode(JSValue0), JSC::ArgList(), arg3));
}

JSC__JSFunction *JSC__JSFunction__createFromNative(JSC__JSGlobalObject *arg0, uint16_t arg1,
                                                   const WTF__String *arg2, void *ctx,
                                                   NativeCallbackFunction callback) {
  return JSC::JSNativeStdFunction::create(
    reinterpret_cast<JSC::VM &>(arg0->vm()), arg0, arg1, arg2 != nullptr ? *arg2 : WTF::String(),
    [ctx, callback](JSC::JSGlobalObject *globalObject, JSC::CallFrame *callFrame)
      -> JSC::EncodedJSValue { return callback(ctx, globalObject, callFrame); });
}
// JSC__JSFunction* JSC__JSFunction__createFromSourceCode(
//     JSC__JSGlobalObject* arg0,
//     const unsigned char* arg1,
//     uint16_t arg2,
//     JSC__JSValue arg3,
//     uint16_t arg4,
//     const JSC__SourceCode* source,
//     JSC__SourceOrigin* origin,
//     JSC__JSObject** exception
// ) {
//     JSC::VM& vm = reinterpret_cast<JSC::VM&>(arg0->vm());
//     JSC::Identifier functionName = JSC::Identifier::fromString(vm, arg2 &&
//     arg1 != nullptr ? WTF::StringImpl(static_cast<const LChar*>(arg1), arg2)
//     : vm->propertyNames->anonymous.impl());

//     JSC::FunctionExecutable* function =
//     JSC::FunctionExecutable::fromGlobalCode(
//         functionName,
//         arg0,
//         source,
//         exception,
//         0,
//         nullptr,
//     );

// }

bWTF__String JSC__JSFunction__displayName(JSC__JSFunction *arg0, JSC__VM *arg1) {
  auto wrap = Wrap<WTF::String, bWTF__String>(arg0->displayName(reinterpret_cast<JSC::VM &>(arg1)));
  return wrap.result;
};
bWTF__String JSC__JSFunction__getName(JSC__JSFunction *arg0, JSC__VM *arg1) {
  auto wrap = Wrap<WTF::String, bWTF__String>(arg0->name(reinterpret_cast<JSC::VM &>(arg1)));
  return wrap.result;
};
bWTF__String JSC__JSFunction__calculatedDisplayName(JSC__JSFunction *arg0, JSC__VM *arg1) {
  auto wrap =
    Wrap<WTF::String, bWTF__String>(arg0->calculatedDisplayName(reinterpret_cast<JSC::VM &>(arg1)));
  return wrap.result;
};
#pragma mark - JSC::JSGlobalObject

JSC__ArrayIteratorPrototype *
JSC__JSGlobalObject__arrayIteratorPrototype(JSC__JSGlobalObject *arg0) {
  return arg0->arrayIteratorPrototype();
};
JSC__ArrayPrototype *JSC__JSGlobalObject__arrayPrototype(JSC__JSGlobalObject *arg0) {
  return arg0->arrayPrototype();
};
JSC__AsyncFunctionPrototype *
JSC__JSGlobalObject__asyncFunctionPrototype(JSC__JSGlobalObject *arg0) {
  return arg0->asyncFunctionPrototype();
};
JSC__AsyncGeneratorFunctionPrototype *
JSC__JSGlobalObject__asyncGeneratorFunctionPrototype(JSC__JSGlobalObject *arg0) {
  return arg0->asyncGeneratorFunctionPrototype();
};
JSC__AsyncGeneratorPrototype *
JSC__JSGlobalObject__asyncGeneratorPrototype(JSC__JSGlobalObject *arg0) {
  return arg0->asyncGeneratorPrototype();
};
JSC__AsyncIteratorPrototype *
JSC__JSGlobalObject__asyncIteratorPrototype(JSC__JSGlobalObject *arg0) {
  return arg0->asyncIteratorPrototype();
};
JSC__BigIntPrototype *JSC__JSGlobalObject__bigIntPrototype(JSC__JSGlobalObject *arg0) {
  return arg0->bigIntPrototype();
};
JSC__JSObject *JSC__JSGlobalObject__booleanPrototype(JSC__JSGlobalObject *arg0) {
  return arg0->booleanPrototype();
};
JSC__JSObject *JSC__JSGlobalObject__datePrototype(JSC__JSGlobalObject *arg0) {
  return arg0->datePrototype();
};
JSC__JSObject *JSC__JSGlobalObject__errorPrototype(JSC__JSGlobalObject *arg0) {
  return arg0->errorPrototype();
};
JSC__FunctionPrototype *JSC__JSGlobalObject__functionPrototype(JSC__JSGlobalObject *arg0) {
  return arg0->functionPrototype();
};
JSC__GeneratorFunctionPrototype *
JSC__JSGlobalObject__generatorFunctionPrototype(JSC__JSGlobalObject *arg0) {
  return arg0->generatorFunctionPrototype();
};
JSC__GeneratorPrototype *JSC__JSGlobalObject__generatorPrototype(JSC__JSGlobalObject *arg0) {
  return arg0->generatorPrototype();
};
JSC__IteratorPrototype *JSC__JSGlobalObject__iteratorPrototype(JSC__JSGlobalObject *arg0) {
  return arg0->iteratorPrototype();
};
JSC__JSObject *JSC__JSGlobalObject__jsSetPrototype(JSC__JSGlobalObject *arg0) {
  return arg0->jsSetPrototype();
};
JSC__MapIteratorPrototype *JSC__JSGlobalObject__mapIteratorPrototype(JSC__JSGlobalObject *arg0) {
  return arg0->mapIteratorPrototype();
};
JSC__JSObject *JSC__JSGlobalObject__mapPrototype(JSC__JSGlobalObject *arg0) {
  return arg0->mapPrototype();
};
JSC__JSObject *JSC__JSGlobalObject__numberPrototype(JSC__JSGlobalObject *arg0) {
  return arg0->numberPrototype();
};
JSC__ObjectPrototype *JSC__JSGlobalObject__objectPrototype(JSC__JSGlobalObject *arg0) {
  return arg0->objectPrototype();
};
JSC__JSPromisePrototype *JSC__JSGlobalObject__promisePrototype(JSC__JSGlobalObject *arg0) {
  return arg0->promisePrototype();
};
JSC__RegExpPrototype *JSC__JSGlobalObject__regExpPrototype(JSC__JSGlobalObject *arg0) {
  return arg0->regExpPrototype();
};
JSC__SetIteratorPrototype *JSC__JSGlobalObject__setIteratorPrototype(JSC__JSGlobalObject *arg0) {
  return arg0->setIteratorPrototype();
};
JSC__StringPrototype *JSC__JSGlobalObject__stringPrototype(JSC__JSGlobalObject *arg0) {
  return arg0->stringPrototype();
};
JSC__JSObject *JSC__JSGlobalObject__symbolPrototype(JSC__JSGlobalObject *arg0) {
  return arg0->symbolPrototype();
};

JSC__VM *JSC__JSGlobalObject__vm(JSC__JSGlobalObject *arg0) { return &arg0->vm(); };
  // JSC__JSObject* JSC__JSGlobalObject__createError(JSC__JSGlobalObject* arg0,
  // unsigned char ErrorType1, WTF__String* arg2) {}; JSC__JSObject*
  // JSC__JSGlobalObject__throwError(JSC__JSGlobalObject* arg0, JSC__JSObject*
  // arg1) {};

#pragma mark - JSC::JSValue

JSC__JSCell *JSC__JSValue__asCell(JSC__JSValue JSValue0) {
  auto value = JSC::JSValue::decode(JSValue0);
  return value.asCell();
}
double JSC__JSValue__asNumber(JSC__JSValue JSValue0) {
  auto value = JSC::JSValue::decode(JSValue0);
  return value.asNumber();
};
bJSC__JSObject JSC__JSValue__asObject(JSC__JSValue JSValue0) {
  auto value = JSC::JSValue::decode(JSValue0);
  auto obj = JSC::asObject(value);
  return cast<bJSC__JSObject>(&obj);
};
JSC__JSString *JSC__JSValue__asString(JSC__JSValue JSValue0) {
  auto value = JSC::JSValue::decode(JSValue0);
  return JSC::asString(value);
};
// uint64_t JSC__JSValue__encode(JSC__JSValue JSValue0) {

// }
bool JSC__JSValue__eqlCell(JSC__JSValue JSValue0, JSC__JSCell *arg1) {
  return JSC::JSValue::decode(JSValue0) == arg1;
};
bool JSC__JSValue__eqlValue(JSC__JSValue JSValue0, JSC__JSValue JSValue1) {
  return JSC::JSValue::decode(JSValue0) == JSC::JSValue::decode(JSValue1);
};
JSC__JSValue JSC__JSValue__getPrototype(JSC__JSValue JSValue0, JSC__JSGlobalObject *arg1) {
  auto value = JSC::JSValue::decode(JSValue0);
  return JSC::JSValue::encode(value.getPrototype(arg1));
}
bool JSC__JSValue__isException(JSC__JSValue JSValue0, JSC__VM *arg1) {
  return JSC::jsDynamicCast<JSC::Exception *>(*arg1, JSC::JSValue::decode(JSValue0)) != nullptr;
}
bool JSC__JSValue__isAnyInt(JSC__JSValue JSValue0) {
  return JSC::JSValue::decode(JSValue0).isAnyInt();
}
bool JSC__JSValue__isBigInt(JSC__JSValue JSValue0) {
  return JSC::JSValue::decode(JSValue0).isBigInt();
}
bool JSC__JSValue__isBigInt32(JSC__JSValue JSValue0) {
  return JSC::JSValue::decode(JSValue0).isBigInt32();
}
bool JSC__JSValue__isBoolean(JSC__JSValue JSValue0) {
  return JSC::JSValue::decode(JSValue0).isBoolean();
}
bool JSC__JSValue__isCell(JSC__JSValue JSValue0) { return JSC::JSValue::decode(JSValue0).isCell(); }
bool JSC__JSValue__isCustomGetterSetter(JSC__JSValue JSValue0) {
  return JSC::JSValue::decode(JSValue0).isCustomGetterSetter();
}
bool JSC__JSValue__isError(JSC__JSValue JSValue0) {
  JSC::JSObject *obj = JSC::JSValue::decode(JSValue0).getObject();
  return obj != nullptr && obj->isErrorInstance();
}
bool JSC__JSValue__isCallable(JSC__JSValue JSValue0, JSC__VM *arg1) {
  return JSC::JSValue::decode(JSValue0).isCallable(reinterpret_cast<JSC::VM &>(arg1));
}
bool JSC__JSValue__isGetterSetter(JSC__JSValue JSValue0) {
  return JSC::JSValue::decode(JSValue0).isGetterSetter();
}
bool JSC__JSValue__isHeapBigInt(JSC__JSValue JSValue0) {
  return JSC::JSValue::decode(JSValue0).isHeapBigInt();
}
bool JSC__JSValue__isInt32AsAnyInt(JSC__JSValue JSValue0) {
  return JSC::JSValue::decode(JSValue0).isInt32AsAnyInt();
}
bool JSC__JSValue__isNull(JSC__JSValue JSValue0) { return JSC::JSValue::decode(JSValue0).isNull(); }
bool JSC__JSValue__isNumber(JSC__JSValue JSValue0) {
  return JSC::JSValue::decode(JSValue0).isNumber();
}
bool JSC__JSValue__isObject(JSC__JSValue JSValue0) {
  return JSC::JSValue::decode(JSValue0).isObject();
}
bool JSC__JSValue__isPrimitive(JSC__JSValue JSValue0) {
  return JSC::JSValue::decode(JSValue0).isPrimitive();
}
bool JSC__JSValue__isString(JSC__JSValue JSValue0) {
  return JSC::JSValue::decode(JSValue0).isString();
}
bool JSC__JSValue__isSymbol(JSC__JSValue JSValue0) {
  return JSC::JSValue::decode(JSValue0).isSymbol();
}
bool JSC__JSValue__isUInt32AsAnyInt(JSC__JSValue JSValue0) {
  return JSC::JSValue::decode(JSValue0).isUInt32AsAnyInt();
}
bool JSC__JSValue__isUndefined(JSC__JSValue JSValue0) {
  return JSC::JSValue::decode(JSValue0).isUndefined();
}
bool JSC__JSValue__isUndefinedOrNull(JSC__JSValue JSValue0) {
  return JSC::JSValue::decode(JSValue0).isUndefinedOrNull();
}
JSC__JSValue JSC__JSValue__jsBoolean(bool arg0) {
  return JSC::JSValue::encode(JSC::jsBoolean(arg0));
};
JSC__JSValue JSC__JSValue__jsDoubleNumber(double arg0) {
  return JSC::JSValue::encode(JSC::jsNumber(arg0));
}
JSC__JSValue JSC__JSValue__jsNull() { return JSC::JSValue::encode(JSC::jsNull()); };
JSC__JSValue JSC__JSValue__jsNumberFromChar(unsigned char arg0) {
  return JSC::JSValue::encode(JSC::jsNumber(arg0));
};
JSC__JSValue JSC__JSValue__jsNumberFromDouble(double arg0) {
  return JSC::JSValue::encode(JSC::jsNumber(arg0));
};
JSC__JSValue JSC__JSValue__jsNumberFromInt32(int32_t arg0) {
  return JSC::JSValue::encode(JSC::jsNumber(arg0));
};
JSC__JSValue JSC__JSValue__jsNumberFromInt64(int64_t arg0) {
  return JSC::JSValue::encode(JSC::jsNumber(arg0));
};
JSC__JSValue JSC__JSValue__jsNumberFromU16(uint16_t arg0) {
  return JSC::JSValue::encode(JSC::jsNumber(arg0));
};
JSC__JSValue JSC__JSValue__jsNumberFromUint64(uint64_t arg0) {
  return JSC::JSValue::encode(JSC::jsNumber(arg0));
};
JSC__JSValue JSC__JSValue__jsTDZValue() { return JSC::JSValue::encode(JSC::jsTDZValue()); };
JSC__JSValue JSC__JSValue__jsUndefined() { return JSC::JSValue::encode(JSC::jsUndefined()); };
JSC__JSObject *JSC__JSValue__toObject(JSC__JSValue JSValue0, JSC__JSGlobalObject *arg1) {
  JSC::JSValue value = JSC::JSValue::decode(JSValue0);
  return value.toObject(arg1);
}

bJSC__Identifier JSC__JSValue__toPropertyKey(JSC__JSValue JSValue0, JSC__JSGlobalObject *arg1) {
  JSC::JSValue value = JSC::JSValue::decode(JSValue0);
  auto ident = value.toPropertyKey(arg1);
  return cast<bJSC__Identifier>(&ident);
}
JSC__JSValue JSC__JSValue__toPropertyKeyValue(JSC__JSValue JSValue0, JSC__JSGlobalObject *arg1) {
  JSC::JSValue value = JSC::JSValue::decode(JSValue0);
  return JSC::JSValue::encode(value.toPropertyKeyValue(arg1));
}
JSC__JSString *JSC__JSValue__toString(JSC__JSValue JSValue0, JSC__JSGlobalObject *arg1) {
  JSC::JSValue value = JSC::JSValue::decode(JSValue0);
  return value.toString(arg1);
};
JSC__JSString *JSC__JSValue__toStringOrNull(JSC__JSValue JSValue0, JSC__JSGlobalObject *arg1) {
  JSC::JSValue value = JSC::JSValue::decode(JSValue0);
  return value.toStringOrNull(arg1);
}
bWTF__String JSC__JSValue__toWTFString(JSC__JSValue JSValue0, JSC__JSGlobalObject *arg1) {
  JSC::JSValue value = JSC::JSValue::decode(JSValue0);
  return Wrap<WTF::String, bWTF__String>::wrap(value.toWTFString(arg1));
};

static ZigException fromErrorInstance(JSC::JSGlobalObject *global, JSC::ErrorInstance *err,
                                      JSC::JSValue val) {
  ZigException except = Zig::ZigExceptionNone;
  JSC::JSObject *obj = JSC::jsDynamicCast<JSC::JSObject *>(global->vm(), val);
  if (err->stackTrace() != nullptr && err->stackTrace()->size() > 0) {
    JSC::StackFrame *stack = &err->stackTrace()->first();
    except.sourceURL = Zig::toZigString(stack->sourceURL());

    if (stack->hasLineAndColumnInfo()) {
      unsigned lineNumber;
      unsigned column;
      stack->computeLineAndColumn(lineNumber, column);
      except.line = lineNumber;
      except.column = column;
    }
  } else {
    // JSC::ErrorInstance marks these as protected.
    // To work around that, we cast as a JSC::JSObject
    // This code path triggers when there was an exception before the code was executed
    // For example, ParserError becomes one of these
    auto source_url_value = obj->getDirect(global->vm(), global->vm().propertyNames->sourceURL);
    auto str = source_url_value.toWTFString(global);
    except.sourceURL = Zig::toZigString(str);
    except.line = obj->getDirect(global->vm(), global->vm().propertyNames->line).toInt32(global);
    except.column =
      obj->getDirect(global->vm(), global->vm().propertyNames->column).toInt32(global);
  }

  if (obj->hasProperty(global, global->vm().propertyNames->stack)) {
    except.stack = Zig::toZigString(
      obj->getDirect(global->vm(), global->vm().propertyNames->stack).toWTFString(global));
  }

  except.code = (unsigned char)err->errorType();
  if (err->isStackOverflowError()) { except.code = 253; }
  if (err->isOutOfMemoryError()) { except.code = 8; }

  if (obj->hasProperty(global, global->vm().propertyNames->message)) {
    except.message = Zig::toZigString(
      obj->getDirect(global->vm(), global->vm().propertyNames->message).toWTFString(global));

  } else {
    except.message = Zig::toZigString(err->sanitizedMessageString(global));
  }
  except.name = Zig::toZigString(err->sanitizedNameString(global));
  except.runtime_type = err->runtimeTypeForCause();

  except.exception = err;

  return except;
}

static ZigException exceptionFromString(WTF::String &str) {
  ZigException except = Zig::ZigExceptionNone;
  auto ref = OpaqueJSString::tryCreate(str);
  except.message = ZigString{ref->characters8(), ref->length()};
  ref->ref();

  return except;
}

static ZigException exceptionFromString(JSC::JSValue value, JSC::JSGlobalObject *global) {
  auto scope = DECLARE_THROW_SCOPE(global->vm());
  auto str = value.toWTFString(global);
  if (scope.exception()) {
    scope.clearException();
    scope.release();
    return Zig::ZigExceptionNone;
  }
  scope.release();

  ZigException except = Zig::ZigExceptionNone;
  auto ref = OpaqueJSString::tryCreate(str);
  except.message = ZigString{ref->characters8(), ref->length()};
  ref->ref();

  return except;
}

ZigException JSC__JSValue__toZigException(JSC__JSValue JSValue0, JSC__JSGlobalObject *arg1) {
  JSC::JSValue value = JSC::JSValue::decode(JSValue0);

  if (JSC::ErrorInstance *error = JSC::jsDynamicCast<JSC::ErrorInstance *>(arg1->vm(), value)) {
    return fromErrorInstance(arg1, error, value);
  }

  if (JSC::Exception *exception = JSC::jsDynamicCast<JSC::Exception *>(arg1->vm(), value)) {
    if (JSC::ErrorInstance *error =
          JSC::jsDynamicCast<JSC::ErrorInstance *>(arg1->vm(), exception->value())) {
      return fromErrorInstance(arg1, error, value);
    }
  }

  return exceptionFromString(value, arg1);
}
#pragma mark - JSC::PropertyName

bool JSC__PropertyName__eqlToIdentifier(JSC__PropertyName *arg0, const JSC__Identifier *arg1) {
  return (*arg0) == (*arg1);
};
bool JSC__PropertyName__eqlToPropertyName(JSC__PropertyName *arg0, const JSC__PropertyName *arg1) {
  return (*arg0) == (*arg1);
};
const WTF__StringImpl *JSC__PropertyName__publicName(JSC__PropertyName *arg0) {
  return arg0->publicName();
};
const WTF__StringImpl *JSC__PropertyName__uid(JSC__PropertyName *arg0) { return arg0->uid(); };

#pragma mark - JSC::VM

JSC__JSLock *JSC__VM__apiLock(JSC__VM *arg0) { return makeRefPtr((*arg0).apiLock()).leakRef(); }
JSC__VM *JSC__VM__create(unsigned char HeapType0) {
  JSC::VM *vm =
    &JSC::VM::create(HeapType0 == JSC::SmallHeap ? JSC::SmallHeap : JSC::LargeHeap).leakRef();
#if ENABLE(WEBASSEMBLY)
  JSC::Wasm::enableFastMemory();
#endif

  return vm;
}
void JSC__VM__deinit(JSC__VM *arg1, JSC__JSGlobalObject *globalObject) {
  JSC::VM &vm = reinterpret_cast<JSC::VM &>(arg1);
  bool protectCountIsZero = vm.heap.unprotect(globalObject);

  if (protectCountIsZero) vm.heap.reportAbandonedObjectGraph();

  vm.deref();
}
void JSC__VM__drainMicrotasks(JSC__VM *arg0) { arg0->drainMicrotasks(); }

bool JSC__VM__executionForbidden(JSC__VM *arg0) { return (*arg0).executionForbidden(); }

bool JSC__VM__isEntered(JSC__VM *arg0) { return (*arg0).isEntered(); }

void JSC__VM__setExecutionForbidden(JSC__VM *arg0, bool arg1) { (*arg0).setExecutionForbidden(); }

bool JSC__VM__throwError(JSC__VM *arg0, JSC__JSGlobalObject *arg1, JSC__ThrowScope *arg2,
                         const unsigned char *arg3, size_t arg4) {
  auto scope = arg2;
  auto global = arg1;
  const String &message = WTF::String(arg3, arg4);
  return JSC::throwException(global, (*scope), createError(global, message));
}

#pragma mark - JSC::ThrowScope

void JSC__ThrowScope__clearException(JSC__ThrowScope *arg0) { arg0->clearException(); };
bJSC__ThrowScope JSC__ThrowScope__declare(JSC__VM *arg0, unsigned char *arg1, unsigned char *arg2,
                                          size_t arg3) {
  Wrap<JSC::ThrowScope, bJSC__ThrowScope> wrapped = Wrap<JSC::ThrowScope, bJSC__ThrowScope>();
  wrapped.cpp = new (wrapped.alignedBuffer()) JSC::ThrowScope(reinterpret_cast<JSC::VM &>(arg0));
  return wrapped.result;
};
JSC__Exception *JSC__ThrowScope__exception(JSC__ThrowScope *arg0) { return arg0->exception(); }
void JSC__ThrowScope__release(JSC__ThrowScope *arg0) { arg0->release(); }

#pragma mark - JSC::CatchScope

void JSC__CatchScope__clearException(JSC__CatchScope *arg0) { arg0->clearException(); }
bJSC__CatchScope JSC__CatchScope__declare(JSC__VM *arg0, unsigned char *arg1, unsigned char *arg2,
                                          size_t arg3) {
  JSC::CatchScope scope = JSC::CatchScope(reinterpret_cast<JSC::VM &>(arg0));
  return cast<bJSC__CatchScope>(&scope);
}
JSC__Exception *JSC__CatchScope__exception(JSC__CatchScope *arg0) { return arg0->exception(); }

#pragma mark - JSC::CallFrame

JSC__JSValue JSC__CallFrame__argument(const JSC__CallFrame *arg0, uint16_t arg1) {
  return JSC::JSValue::encode(arg0->argument(arg1));
};
size_t JSC__CallFrame__argumentsCount(const JSC__CallFrame *arg0) { return arg0->argumentCount(); }
JSC__JSObject *JSC__CallFrame__jsCallee(const JSC__CallFrame *arg0) { return arg0->jsCallee(); }
JSC__JSValue JSC__CallFrame__newTarget(const JSC__CallFrame *arg0) {
  return JSC::JSValue::encode(arg0->newTarget());
};
JSC__JSValue JSC__CallFrame__thisValue(const JSC__CallFrame *arg0) {
  return JSC::JSValue::encode(arg0->thisValue());
}
JSC__JSValue JSC__CallFrame__uncheckedArgument(const JSC__CallFrame *arg0, uint16_t arg1) {
  return JSC::JSValue::encode(arg0->uncheckedArgument(arg1));
}

#pragma mark - JSC::Identifier

void JSC__Identifier__deinit(const JSC__Identifier *arg0) {}

bool JSC__Identifier__eqlIdent(const JSC__Identifier *arg0, const JSC__Identifier *arg1) {
  return arg0 == arg1;
};
bool JSC__Identifier__eqlStringImpl(const JSC__Identifier *arg0, const WTF__StringImpl *arg1) {
  return JSC::Identifier::equal(arg0->string().impl(), arg1);
};
bool JSC__Identifier__eqlUTF8(const JSC__Identifier *arg0, const unsigned char *arg1, size_t arg2) {
  return JSC::Identifier::equal(arg0->string().impl(), reinterpret_cast<const LChar *>(arg1), arg2);
};
bool JSC__Identifier__neqlIdent(const JSC__Identifier *arg0, const JSC__Identifier *arg1) {
  return arg0 != arg1;
}
bool JSC__Identifier__neqlStringImpl(const JSC__Identifier *arg0, const WTF__StringImpl *arg1) {
  return !JSC::Identifier::equal(arg0->string().impl(), arg1);
};

bJSC__Identifier JSC__Identifier__fromSlice(JSC__VM *arg0, const unsigned char *arg1, size_t arg2) {
  JSC::Identifier ident =
    JSC::Identifier::fromString(reinterpret_cast<JSC__VM &>(arg0),
                                reinterpret_cast<const LChar *>(arg1), static_cast<int>(arg2));
  return cast<bJSC__Identifier>(&ident);
};
bJSC__Identifier JSC__Identifier__fromString(JSC__VM *arg0, const WTF__String *arg1) {
  JSC::Identifier ident = JSC::Identifier::fromString(reinterpret_cast<JSC__VM &>(arg0),
                                                      reinterpret_cast<const WTF__String &>(arg1));
  return cast<bJSC__Identifier>(&ident);
};
// bJSC__Identifier JSC__Identifier__fromUid(JSC__VM* arg0, const
// WTF__StringImpl* arg1) {
//     auto ident = JSC::Identifier::fromUid(&arg0, &arg1);
//     return *cast<bJSC__Identifier>(&ident);
// };
bool JSC__Identifier__isEmpty(const JSC__Identifier *arg0) { return arg0->isEmpty(); };
bool JSC__Identifier__isNull(const JSC__Identifier *arg0) { return arg0->isNull(); };
bool JSC__Identifier__isPrivateName(const JSC__Identifier *arg0) { return arg0->isPrivateName(); };
bool JSC__Identifier__isSymbol(const JSC__Identifier *arg0) { return arg0->isSymbol(); };
size_t JSC__Identifier__length(const JSC__Identifier *arg0) { return arg0->length(); };

bWTF__String JSC__Identifier__toString(const JSC__Identifier *arg0) {
  auto string = arg0->string();
  return cast<bWTF__String>(&string);
};

#pragma mark - WTF::StringView

const uint16_t *WTF__StringView__characters16(const WTF__StringView *arg0) {
  WTF::StringView *view = (WTF::StringView *)arg0;
  return reinterpret_cast<const uint16_t *>(view->characters16());
}
const unsigned char *WTF__StringView__characters8(const WTF__StringView *arg0) {
  return reinterpret_cast<const unsigned char *>(arg0->characters8());
};

bool WTF__StringView__is16Bit(const WTF__StringView *arg0) { return !arg0->is8Bit(); };
bool WTF__StringView__is8Bit(const WTF__StringView *arg0) { return arg0->is8Bit(); };
bool WTF__StringView__isEmpty(const WTF__StringView *arg0) { return arg0->isEmpty(); };
size_t WTF__StringView__length(const WTF__StringView *arg0) { return arg0->length(); };

#pragma mark - WTF::StringImpl

const uint16_t *WTF__StringImpl__characters16(const WTF__StringImpl *arg0) {
  return reinterpret_cast<const uint16_t *>(arg0->characters16());
}
const unsigned char *WTF__StringImpl__characters8(const WTF__StringImpl *arg0) {
  return reinterpret_cast<const unsigned char *>(arg0->characters8());
}

void WTF__StringView__from8Bit(WTF__StringView *arg0, const unsigned char *arg1, size_t arg2) {
  *arg0 = WTF::StringView(arg1, arg2);
}

bool WTF__StringImpl__is16Bit(const WTF__StringImpl *arg0) { return !arg0->is8Bit(); }
bool WTF__StringImpl__is8Bit(const WTF__StringImpl *arg0) { return arg0->is8Bit(); }
bool WTF__StringImpl__isEmpty(const WTF__StringImpl *arg0) { return arg0->isEmpty(); }
bool WTF__StringImpl__isExternal(const WTF__StringImpl *arg0) { return arg0->isExternal(); }
bool WTF__StringImpl__isStatic(const WTF__StringImpl *arg0) { return arg0->isStatic(); }
size_t WTF__StringImpl__length(const WTF__StringImpl *arg0) { return arg0->length(); }

#pragma mark - WTF::ExternalStringImpl

const uint16_t *WTF__ExternalStringImpl__characters16(const WTF__ExternalStringImpl *arg0) {
  return reinterpret_cast<const uint16_t *>(arg0->characters16());
}
const unsigned char *WTF__ExternalStringImpl__characters8(const WTF__ExternalStringImpl *arg0) {
  return reinterpret_cast<const unsigned char *>(arg0->characters8());
}

bool WTF__ExternalStringImpl__is16Bit(const WTF__ExternalStringImpl *arg0) {
  return !arg0->is8Bit();
}
bool WTF__ExternalStringImpl__is8Bit(const WTF__ExternalStringImpl *arg0) { return arg0->is8Bit(); }
bool WTF__ExternalStringImpl__isEmpty(const WTF__ExternalStringImpl *arg0) {
  return arg0->isEmpty();
}
bool WTF__ExternalStringImpl__isExternal(const WTF__ExternalStringImpl *arg0) {
  return arg0->isExternal();
}
bool WTF__ExternalStringImpl__isStatic(const WTF__ExternalStringImpl *arg0) {
  return arg0->isStatic();
}
size_t WTF__ExternalStringImpl__length(const WTF__ExternalStringImpl *arg0) {
  return arg0->length();
}

#pragma mark - WTF::String

const uint16_t *WTF__String__characters16(WTF__String *arg0) {
  return reinterpret_cast<const uint16_t *>(arg0->characters16());
};
const unsigned char *WTF__String__characters8(WTF__String *arg0) {
  return reinterpret_cast<const unsigned char *>(arg0->characters8());
};

bool WTF__String__eqlSlice(WTF__String *arg0, const unsigned char *arg1, size_t arg2) {
  return WTF::equal(arg0->impl(), reinterpret_cast<const LChar *>(arg1), arg2);
}
bool WTF__String__eqlString(WTF__String *arg0, const WTF__String *arg1) { return arg0 == arg1; }
const WTF__StringImpl *WTF__String__impl(WTF__String *arg0) { return arg0->impl(); }

bool WTF__String__is16Bit(WTF__String *arg0) { return !arg0->is8Bit(); }
bool WTF__String__is8Bit(WTF__String *arg0) { return arg0->is8Bit(); }
bool WTF__String__isEmpty(WTF__String *arg0) { return arg0->isEmpty(); }
bool WTF__String__isExternal(WTF__String *arg0) { return arg0->impl()->isExternal(); }
bool WTF__String__isStatic(WTF__String *arg0) { return arg0->impl()->isStatic(); }
size_t WTF__String__length(WTF__String *arg0) { return arg0->length(); }

bWTF__String WTF__String__createFromExternalString(bWTF__ExternalStringImpl arg0) {
  auto external = Wrap<WTF::ExternalStringImpl, bWTF__ExternalStringImpl>(arg0);
  return Wrap<WTF::String, bWTF__String>(WTF::String(external.cpp)).result;
};

void WTF__String__createWithoutCopyingFromPtr(WTF__String *str, const unsigned char *arg0,
                                              size_t arg1) {
  auto new_str = new (reinterpret_cast<char *>(str)) WTF::String(arg0, arg1);
  new_str->impl()->ref();
}

#pragma mark - WTF::URL

bWTF__StringView WTF__URL__encodedPassword(WTF__URL *arg0) {
  auto result = arg0->encodedPassword();
  return cast<bWTF__StringView>(&result);
};
bWTF__StringView WTF__URL__encodedUser(WTF__URL *arg0) {
  auto result = arg0->encodedUser();
  return cast<bWTF__StringView>(&result);
};
bWTF__String WTF__URL__fileSystemPath(WTF__URL *arg0) {
  auto result = arg0->fileSystemPath();
  return cast<bWTF__String>(&result);
};
bWTF__StringView WTF__URL__fragmentIdentifier(WTF__URL *arg0) {
  auto result = arg0->fragmentIdentifier();
  return cast<bWTF__StringView>(&result);
};
bWTF__StringView WTF__URL__fragmentIdentifierWithLeadingNumberSign(WTF__URL *arg0) {
  auto result = arg0->fragmentIdentifierWithLeadingNumberSign();
  return cast<bWTF__StringView>(&result);
};
void WTF__URL__fromFileSystemPath(WTF::URL *result, bWTF__StringView arg0) {
  Wrap<WTF::StringView, bWTF__StringView> fsPath = Wrap<WTF::StringView, bWTF__StringView>(&arg0);
  *result = WTF::URL::fileURLWithFileSystemPath(*fsPath.cpp);
  result->string().impl()->ref();
};
bWTF__URL WTF__URL__fromString(bWTF__String arg0, bWTF__String arg1) {
  WTF::URL url = WTF::URL(WTF::URL(), cast<WTF::String>(&arg1));
  return cast<bWTF__URL>(&url);
};
bWTF__StringView WTF__URL__host(WTF__URL *arg0) {
  auto result = arg0->host();
  return cast<bWTF__StringView>(&result);
};
bWTF__String WTF__URL__hostAndPort(WTF__URL *arg0) {
  auto result = arg0->hostAndPort();
  return cast<bWTF__String>(&result);
};
bool WTF__URL__isEmpty(const WTF__URL *arg0) { return arg0->isEmpty(); };
bool WTF__URL__isValid(const WTF__URL *arg0) { return arg0->isValid(); };
bWTF__StringView WTF__URL__lastPathComponent(WTF__URL *arg0) {
  auto result = arg0->lastPathComponent();
  return cast<bWTF__StringView>(&result);
};
bWTF__String WTF__URL__password(WTF__URL *arg0) {
  auto result = arg0->password();
  return cast<bWTF__String>(&result);
};
bWTF__StringView WTF__URL__path(WTF__URL *arg0) {
  auto wrap = Wrap<WTF::StringView, bWTF__StringView>(arg0->path());
  return wrap.result;
};
bWTF__StringView WTF__URL__protocol(WTF__URL *arg0) {
  auto result = arg0->protocol();
  return cast<bWTF__StringView>(&result);
};
bWTF__String WTF__URL__protocolHostAndPort(WTF__URL *arg0) {
  auto result = arg0->protocolHostAndPort();
  return cast<bWTF__String>(&result);
};
bWTF__StringView WTF__URL__query(WTF__URL *arg0) {
  auto result = arg0->query();
  return cast<bWTF__StringView>(&result);
};
bWTF__StringView WTF__URL__queryWithLeadingQuestionMark(WTF__URL *arg0) {
  auto result = arg0->queryWithLeadingQuestionMark();
  return cast<bWTF__StringView>(&result);
};
bWTF__String WTF__URL__stringWithoutFragmentIdentifier(WTF__URL *arg0) {
  auto result = arg0->stringWithoutFragmentIdentifier();
  return cast<bWTF__String>(&result);
};
bWTF__StringView WTF__URL__stringWithoutQueryOrFragmentIdentifier(WTF__URL *arg0) {
  auto result = arg0->stringWithoutQueryOrFragmentIdentifier();
  return cast<bWTF__StringView>(&result);
};
bWTF__URL WTF__URL__truncatedForUseAsBase(WTF__URL *arg0) {
  auto result = arg0->truncatedForUseAsBase();
  return cast<bWTF__URL>(&result);
};
bWTF__String WTF__URL__user(WTF__URL *arg0) {
  auto result = arg0->user();
  return cast<bWTF__String>(&result);
};

void WTF__URL__setHost(WTF__URL *arg0, bWTF__StringView arg1) {
  arg0->setHost(*Wrap<WTF::StringView, bWTF__StringView>::unwrap(&arg1));
};
void WTF__URL__setHostAndPort(WTF__URL *arg0, bWTF__StringView arg1) {
  arg0->setHostAndPort(*Wrap<WTF::StringView, bWTF__StringView>::unwrap(&arg1));
};
void WTF__URL__setPassword(WTF__URL *arg0, bWTF__StringView arg1) {
  arg0->setPassword(*Wrap<WTF::StringView, bWTF__StringView>::unwrap(&arg1));
};
void WTF__URL__setPath(WTF__URL *arg0, bWTF__StringView arg1) {
  arg0->setPath(*Wrap<WTF::StringView, bWTF__StringView>::unwrap(&arg1));
};
void WTF__URL__setProtocol(WTF__URL *arg0, bWTF__StringView arg1) {
  arg0->setProtocol(*Wrap<WTF::StringView, bWTF__StringView>::unwrap(&arg1));
};
void WTF__URL__setQuery(WTF__URL *arg0, bWTF__StringView arg1) {
  arg0->setQuery(*Wrap<WTF::StringView, bWTF__StringView>::unwrap(&arg1));
};
void WTF__URL__setUser(WTF__URL *arg0, bWTF__StringView arg1) {
  arg0->setUser(*Wrap<WTF::StringView, bWTF__StringView>::unwrap(&arg1));
};
}
