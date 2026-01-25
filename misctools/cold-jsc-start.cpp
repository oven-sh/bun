// print how long each step took
#define VERBOSE

//
// This loads up a JavaScriptCore global object which only has a "write"
// global function and then calls eval
//
//
// Usage:
//  ./cold-jsc-start <file>
//  ./cold-jsc-start -e "write('hey')"
//
#include "root.h"

#include <wtf/FileSystem.h>

#include <JavaScriptCore/JSGlobalObject.h>

#include <JavaScriptCore/JSArrayBufferView.h>
#include <JavaScriptCore/JSArrayBufferViewInlines.h>

#include <JavaScriptCore/Completion.h>
#include <JavaScriptCore/InitializeThreading.h>
#include <unistd.h>
#include <wtf/Stopwatch.h>

using namespace JSC;

JSC_DEFINE_HOST_FUNCTION(jsFunctionWrite, (JSC::JSGlobalObject * globalObject,
                                           JSC::CallFrame *callframe)) {

  if (callframe->argumentCount() < 1)
    return JSValue::encode(jsUndefined());

  JSValue arg1 = callframe->argument(0);
  JSValue toWriteArg = callframe->argument(1);
  auto &vm = globalObject->vm();
  auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);

  int32_t fd = STDOUT_FILENO;
  if (callframe->argumentCount() > 1) {
    fd = arg1.toInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
  } else {
    toWriteArg = arg1;
  }

  if (auto *buffer = jsDynamicCast<JSC::JSArrayBufferView *>(toWriteArg)) {
    auto *data = buffer->vector();
    auto length = buffer->byteLength();
    auto written = write(fd, data, length);
    return JSValue::encode(jsNumber(written));
  }

  auto string = toWriteArg.toWTFString(globalObject);
  RETURN_IF_EXCEPTION(scope, {});
  auto utf8 = string.utf8();
  auto length = utf8.length();
  auto written = write(fd, utf8.data(), length);
  return JSValue::encode(jsNumber(written));
}

int main(int argc, char **argv) {
  if (argc < 2) {
    fprintf(stderr, "Usage: %s <file>\n", argv[0]);
    return 1;
  }
#ifdef VERBOSE
  auto stopwatch = Stopwatch::create();
  stopwatch->start();
#endif

  {
    WTF::initializeMainThread();
    JSC::initialize();
    {
      JSC::Options::AllowUnfinalizedAccessScope scope;

      JSC::Options::useConcurrentJIT() = true;
      // JSC::Options::useSigillCrashAnalyzer() = true;
      JSC::Options::useWebAssembly() = true;
      JSC::Options::useSourceProviderCache() = true;
      // JSC::Options::useUnlinkedCodeBlockJettisoning() = false;
      JSC::Options::exposeInternalModuleLoader() = true;
      JSC::Options::useSharedArrayBuffer() = true;
      JSC::Options::useJIT() = true;
      JSC::Options::useBBQJIT() = true;
      JSC::Options::useJITCage() = false;
      JSC::Options::useShadowRealm() = true;
      JSC::Options::useResizableArrayBuffer() = true;
      JSC::Options::showPrivateScriptsInStackTraces() = true;
      JSC::Options::useSetMethods() = true;
      JSC::Options::assertOptionsAreCoherent();
    }
  }

#ifdef VERBOSE

  fprintf(stderr, "JSC::Initialize took %f ms\n",
          stopwatch->elapsedTime().milliseconds());
  stopwatch->reset();
  stopwatch->start();
#endif

  auto &vm = JSC::VM::create(JSC::HeapType::Large).leakRef();
  vm.heap.acquireAccess();

#ifdef VERBOSE
  fprintf(stderr, "JSC::VM::create took %f ms\n",
          stopwatch->elapsedTime().milliseconds());
  stopwatch->reset();
  stopwatch->start();
#endif

  JSC::JSLockHolder locker(vm);
  auto *globalObject = JSC::JSGlobalObject::create(
      vm, JSC::JSGlobalObject::createStructure(vm, JSC::jsNull()));

#ifdef VERBOSE
  fprintf(stderr, "JSC::JSGlobalObject::create took %f ms\n",
          stopwatch->elapsedTime().milliseconds());
  stopwatch->reset();
  stopwatch->start();
#endif

  JSC::gcProtect(globalObject);
  globalObject->putDirectNativeFunction(
      vm, globalObject,
      PropertyName(JSC::Identifier::fromString(vm, "write"_s)), 0,
      jsFunctionWrite, ImplementationVisibility::Public, JSC::NoIntrinsic,
      JSC::PropertyAttribute::ReadOnly | 0);

  vm.ref();
  if (argc > 2) {
    auto source =
        JSC::makeSource(WTF::String::fromUTF8(argv[argc - 1]),
                        SourceOrigin(WTF::URL("file://eval.js"_s)),
                        JSC::SourceTaintedOrigin::Untainted, "eval.js"_s);

    NakedPtr<Exception> evaluationException;
    JSValue returnValue =
        JSC::profiledEvaluate(globalObject, ProfilingReason::API, source,
                              globalObject, evaluationException);

#ifdef VERBOSE
    fprintf(stderr, "\neval took %f ms\n",
            stopwatch->elapsedTime().milliseconds());
    stopwatch->reset();

#endif

    if (evaluationException) {
      fprintf(
          stderr, "Exception: %s\n",
          evaluationException->value().toWTFString(globalObject).utf8().data());
      return 1;
    } else {
      return 0;
    }
  }

  WTF::String fileURLString = WTF::String::fromUTF8(argv[argc - 1]);

  if (auto contents = WTF::FileSystemImpl::readEntireFile(fileURLString)) {
    auto source =
        JSC::makeSource(WTF::String::fromUTF8(contents.value()),
                        SourceOrigin(WTF::URL(fileURLString)),
                        JSC::SourceTaintedOrigin::Untainted, fileURLString);

    NakedPtr<Exception> evaluationException;
    JSValue returnValue =
        JSC::profiledEvaluate(globalObject, ProfilingReason::API, source,
                              globalObject, evaluationException);

#ifdef VERBOSE
    fprintf(stderr, "eval took %f ms\n",
            stopwatch->elapsedTime().milliseconds());
    stopwatch->reset();
#endif

    if (evaluationException) {
      fprintf(
          stderr, "Exception: %s\n",
          evaluationException->value().toWTFString(globalObject).utf8().data());
      return 1;
    } else {
      return 0;
    }
  } else {
    fprintf(stderr, "Could not read file %s\n", argv[argc - 1]);
    return 1;
  }
}
