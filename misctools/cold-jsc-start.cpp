// print how long each step took
#define VERBOSE

//
// This loads up a JavaScriptCore global object which only has a "write"
// global function and then calls eval
//
// Usage:
//  ./cold-jsc-start <file>
//  ./cold-jsc-start -e "write('hey')"
//
// Build with: cmake --build build/debug --target cold-jsc-start
//

// Fix WebCore feature mismatches - must be set before root.h
#define ENABLE_COCOA_WEBM_PLAYER 0

#include "root.h"

#include <wtf/FileSystem.h>
#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/JSArrayBufferView.h>
#include <JavaScriptCore/JSArrayBufferViewInlines.h>
#include <JavaScriptCore/Completion.h>
#include <JavaScriptCore/InitializeThreading.h>
#include <JavaScriptCore/JSCConfig.h>
#include <unistd.h>
#include <wtf/Stopwatch.h>
#include <wtf/Threading.h>

using namespace JSC;

// Minimal VM::ClientData
class MinimalClientData : public JSC::VM::ClientData {
public:
    MinimalClientData() = default;
    virtual ~MinimalClientData() = default;

    WTF::String overrideSourceURL(const JSC::StackFrame&, const WTF::String& originalSourceURL) const override
    {
        return originalSourceURL;
    }
};

// Stub implementations for Bun-specific WebKit hooks
extern "C" {
void Bun__errorInstance__finalize(void*) {}

// Minimal timer stub - returns a dummy non-null pointer
static char dummyTimer = 0;
void* WTFTimer__create(void*, void*, void*) { return &dummyTimer; }
void WTFTimer__deinit(void*) {}
void WTFTimer__cancel(void*) {}
void WTFTimer__update(void*, double, bool) {}
bool WTFTimer__isActive(void*) { return false; }
double WTFTimer__secondsUntilTimer(void*) { return 0.0; }

// Stub for Bun's VM - returns null since we don't have a real Bun VM
void* Bun__getVM() { return nullptr; }
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionWrite, (JSC::JSGlobalObject * globalObject,
                                           JSC::CallFrame *callframe)) {

  if (callframe->argumentCount() < 1)
    return JSValue::encode(jsUndefined());

  JSValue arg1 = callframe->argument(0);
  JSValue toWriteArg = callframe->argument(1);
  auto &vm = globalObject->vm();
  auto scope = DECLARE_CATCH_SCOPE(vm);

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

  // Check for --benchmark-vm flag
  bool benchmarkVM = false;
  for (int i = 1; i < argc; i++) {
    if (strcmp(argv[i], "--benchmark-vm") == 0) {
      benchmarkVM = true;
      break;
    }
  }

  // Must call WTF::initialize() first, before anything else
  WTF::initialize();

#ifdef VERBOSE
  auto stopwatch = Stopwatch::create();
  stopwatch->start();
#endif

  {
    JSC::Config::enableRestrictedOptions();
    WTF::initializeMainThread();
    JSC::initialize();
    {
      JSC::Options::AllowUnfinalizedAccessScope scope;

      JSC::Options::useConcurrentJIT() = true;
      JSC::Options::useSourceProviderCache() = true;
      JSC::Options::exposeInternalModuleLoader() = true;
      JSC::Options::useSharedArrayBuffer() = true;
      JSC::Options::useJIT() = true;
      JSC::Options::useBBQJIT() = true;
      JSC::Options::useJITCage() = false;
      JSC::Options::useShadowRealm() = true;
      JSC::Options::useWasm() = true;
      JSC::Options::assertOptionsAreCoherent();
    }
  }

#ifdef VERBOSE
  fprintf(stderr, "JSC::Initialize took %f ms\n",
          stopwatch->elapsedTime().milliseconds());
  stopwatch->reset();
  stopwatch->start();
#endif

  // Benchmark mode: create 100 VMs, then 100 GlobalObjects
  if (benchmarkVM) {
    constexpr int NUM_VMS = 100;
    JSC::VM* vms[NUM_VMS];
    JSC::JSGlobalObject* globalObjects[NUM_VMS];

    // First benchmark: Create 100 VMs
    auto benchStart = Stopwatch::create();
    benchStart->start();

    for (int i = 0; i < NUM_VMS; i++) {
      auto vmPtr = JSC::VM::tryCreate(JSC::HeapType::Large);
      if (!vmPtr) {
        fprintf(stderr, "Failed to create VM %d\n", i);
        return 1;
      }
      vmPtr->refSuppressingSaferCPPChecking();
      vms[i] = vmPtr.get();
      vms[i]->heap.acquireAccess();
    }

    double vmTime = benchStart->elapsedTime().milliseconds();
    fprintf(stderr, "Created %d VMs in %f ms (%f ms per VM)\n",
            NUM_VMS, vmTime, vmTime / NUM_VMS);

    // Second benchmark: Create 100 GlobalObjects on existing VMs
    benchStart->reset();
    benchStart->start();

    for (int i = 0; i < NUM_VMS; i++) {
      JSC::JSLockHolder locker(*vms[i]);
      vms[i]->clientData = new MinimalClientData();
      auto* structure = JSC::JSGlobalObject::createStructure(*vms[i], JSC::jsNull());
      globalObjects[i] = JSC::JSGlobalObject::create(*vms[i], structure);
      JSC::gcProtect(globalObjects[i]);
    }

    double globalObjectTime = benchStart->elapsedTime().milliseconds();
    fprintf(stderr, "Created %d GlobalObjects in %f ms (%f ms per GlobalObject)\n",
            NUM_VMS, globalObjectTime, globalObjectTime / NUM_VMS);

    fprintf(stderr, "Total: %f ms (%f ms per VM+GlobalObject)\n",
            vmTime + globalObjectTime, (vmTime + globalObjectTime) / NUM_VMS);

    // Keep VMs alive - don't destruct
    return 0;
  }

  // 1. Create VM
  auto vmPtr = JSC::VM::tryCreate(JSC::HeapType::Large);
  if (!vmPtr) {
    fprintf(stderr, "Failed to create VM\n");
    return 1;
  }
  vmPtr->refSuppressingSaferCPPChecking();
  auto &vm = *vmPtr;

  // 2. Acquire heap access (must happen before JSVMClientData::create per Bun)
  vm.heap.acquireAccess();

  // 3. Lock
  JSC::JSLockHolder locker(vm);

  // 4. Set up client data
  vm.clientData = new MinimalClientData();

#ifdef VERBOSE
  fprintf(stderr, "JSC::VM::create took %f ms\n",
          stopwatch->elapsedTime().milliseconds());
  stopwatch->reset();
  stopwatch->start();
#endif

  // 5. Create structure
  auto* structure = JSC::JSGlobalObject::createStructure(vm, JSC::jsNull());

  // 6. Create GlobalObject
  auto *globalObject = JSC::JSGlobalObject::create(vm, structure);

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
