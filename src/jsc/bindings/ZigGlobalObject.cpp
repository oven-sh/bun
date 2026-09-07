#include "root.h"

#include "ZigGlobalObject.h"
#include "BuiltinModuleKeys.h"
#include "IsolatedModuleCache.h"
#include "MessagePort.h"
#include "helpers.h"
#include "JavaScriptCore/ArgList.h"
#include "JavaScriptCore/JSCellButterfly.h"
#include "wtf/text/Base64.h"
#include "JavaScriptCore/BuiltinNames.h"
#include "JavaScriptCore/CallData.h"
#include "JavaScriptCore/TopExceptionScope.h"
#include "JavaScriptCore/ClassInfo.h"
#include "JavaScriptCore/CodeBlock.h"
#include "JavaScriptCore/Completion.h"
#include "JavaScriptCore/DeferredWorkTimer.h"
#include "JavaScriptCore/Error.h"
#include "JavaScriptCore/ErrorInstance.h"
#include "JavaScriptCore/Exception.h"
#include "JavaScriptCore/ExceptionScope.h"
#include "JavaScriptCore/FunctionConstructor.h"
#include "JavaScriptCore/FunctionPrototype.h"
#include "JavaScriptCore/GetterSetter.h"
#include "JavaScriptCore/GlobalObjectMethodTable.h"
#include "JavaScriptCore/Heap.h"
#include "JavaScriptCore/DeferGCInlines.h"
#include "JavaScriptCore/Identifier.h"
#include "JavaScriptCore/InitializeThreading.h"
#include "JavaScriptCore/InternalFieldTuple.h"
#include "JavaScriptCore/InternalFunction.h"
#include "JavaScriptCore/JSArray.h"
#include "JavaScriptCore/JSCast.h"
#include "JavaScriptCore/JSCJSValue.h"
#include "JavaScriptCore/JSPromise.h"
#include "JavaScriptCore/JSLock.h"
#include "JavaScriptCore/JSMap.h"
#include "JavaScriptCore/JSMicrotask.h"
#include "JavaScriptCore/MicrotaskQueue.h"
#include "JavaScriptCore/JSModuleLoader.h"
#include "JavaScriptCore/CyclicModuleRecord.h"
#include "JavaScriptCore/ModuleRegistryEntry.h"
#include "JavaScriptCore/JSModuleNamespaceObject.h"
#include "JavaScriptCore/JSModuleNamespaceObjectInlines.h"
#include "JavaScriptCore/JSModuleRecord.h"
#include "JavaScriptCore/JSNativeStdFunction.h"
#include "JavaScriptCore/JSIteratorPrototype.h"
#include "JavaScriptCore/JSObject.h"
#include "JavaScriptCore/JSObjectInlines.h"
#include "JavaScriptCore/JSPromise.h"
#include "JavaScriptCore/JSSourceCode.h"
#include "JavaScriptCore/JSString.h"
#include "JavaScriptCore/JSWeakMap.h"
#include "JavaScriptCore/LazyClassStructure.h"
#include "JavaScriptCore/LazyClassStructureInlines.h"
#include "JavaScriptCore/ObjectConstructor.h"
#include "JavaScriptCore/JSBasePrivate.h"
#include "JavaScriptCore/ScriptExecutable.h"
#include "JavaScriptCore/ScriptFetchParameters.h"
#include "JavaScriptCore/SourceOrigin.h"
#include "JavaScriptCore/StackFrame.h"
#include "JavaScriptCore/StackVisitor.h"
#include "JavaScriptCore/VM.h"
#include "AddEventListenerOptions.h"
#include "AsyncContextFrame.h"
#include "BunClientData.h"
#include "BunIDLConvert.h"
#include "BunObject.h"
#include "GeneratedBunObject.h"
#include "BunPlugin.h"
#include "BunProcess.h"
#include "BunSecureContextCache.h"
#include "NodeV8.h"
#include "ProcessIdentifier.h"
#include "GlobalEventScope.h"
#include "CallSite.h"
#include "CallSitePrototype.h"
#include "FormatStackTraceForJS.h"
#include "JSCommonJSModule.h"
#include "JSCommonJSExtensions.h"
#include "ConsoleObject.h"
#include "DOMWrapperWorld-class.h"
#include "ErrorStackTrace.h"
#include "IDLTypes.h"
#include "ImportMetaObject.h"
#include "JS2Native.h"
#include "JSAbortAlgorithm.h"
#include "JSAbortController.h"
#include "JSAbortSignal.h"
#include "streams/JSCompressionStream.h"
#include "streams/JSDecompressionStream.h"
#include "JSBroadcastChannel.h"
#include "JSBuffer.h"
#include "streams/JSByteLengthQueuingStrategy.h"
#include "JSCloseEvent.h"
#include "JSCommonJSExtensions.h"
#include "streams/JSCountQueuingStrategy.h"
#include "JSCustomEvent.h"
#include "JSDOMConvertBase.h"
#include "JSDOMConvertUnion.h"
#include "JSDOMException.h"
#include "JSDOMGuardedObject.h"
#include "JSDOMFile.h"
#include "JSDOMFormData.h"
#include "JSDOMURL.h"
#include "JSEnvironmentVariableMap.h"
#include "JSErrorEvent.h"
#include "JSEvent.h"
#include "JSEventEmitter.h"
#include "JSEventListener.h"
#include "JSEventTarget.h"
#include "JSFetchHeaders.h"
#include "JSFFIFunction.h"
#include "JSFFICString.h"
#include "webcore/JSMIMEParams.h"
#include "webcore/JSMIMEType.h"
#include "JSMessageChannel.h"
#include "JSMessageEvent.h"
#include "JSMessagePort.h"
#include "JSNextTickQueue.h"
#include "JSSocketHandlers.h"
#include "JSPerformance.h"
#include "JSPerformanceEntry.h"
#include "JSPerformanceMark.h"
#include "JSPerformanceMeasure.h"
#include "JSPerformanceObserver.h"
#include "JSPerformanceObserverEntryList.h"
#include "streams/JSReadableByteStreamController.h"
#include "streams/JSReadableStream.h"
#include "streams/JSReadableStreamBYOBReader.h"
#include "streams/JSStreamsRuntime.h"
#include "streams/JSReadableStreamBYOBRequest.h"
#include "streams/JSReadableStreamDefaultController.h"
#include "streams/JSReadableStreamDefaultReader.h"
#include "JSSink.h"
#include "JSSocketAddressDTO.h"
#include "JSReactElement.h"
#include "BunMarkdownMeta.h"
#include "JSSQLStatement.h"
#include "sqlite/NodeSqlite.h"
#include "JSStringDecoder.h"
#include "JSTextEncoder.h"
#include "streams/JSTextEncoderStream.h"
#include "streams/JSTextDecoderStream.h"
#include "streams/JSTransformStream.h"
#include "streams/JSTransformStreamDefaultController.h"
#include "JSURLPattern.h"
#include "JSURLSearchParams.h"
#include "JSWasmStreamingCompiler.h"
#include <JavaScriptCore/WebAssemblyCompileOptions.h>
#include "JSWebSocket.h"
#include "JSWorker.h"
#include "streams/JSWritableStream.h"
#include "streams/JSWritableStreamDefaultController.h"
#include "streams/JSWritableStreamDefaultWriter.h"
#include "libusockets.h"
#include "ModuleLoader.h"
#include "napi_external.h"
#include "napi_handle_scope.h"
#include "napi_type_tag.h"
#include "NativePromiseContext.h"
#include "napi.h"
#include "NodeHTTP.h"
#include "NodeVM.h"
#include "Performance.h"
#include "ProcessBindingConstants.h"
#include "ProcessBindingTTYWrap.h"
#include "streams/BunStreamConsumers.h"
#include "streams/WebStreamsInternals.h"
#include "SerializedScriptValue.h"
#include "StructuredClone.h"
#include "WebCoreJSBuiltins.h"
#include "webcrypto/JSCryptoKey.h"
#include "webcrypto/JSSubtleCrypto.h"
#include "ZigGeneratedClasses.h"
#include "ZigSourceProvider.h"
#include "UtilInspect.h"
#include "Base64Helpers.h"
#include "wtf/text/OrdinalNumber.h"
#include "ErrorCode.h"
#include "v8/shim/GlobalInternals.h"
#include "EventLoopTask.h"
#include "NodeModuleModule.h"
#include <JavaScriptCore/JSCBytecodeCacheVersion.h>
#include "JSPerformanceServerTiming.h"
#include "JSPerformanceResourceTiming.h"
#include "JSPerformanceTiming.h"
#include "JSX509Certificate.h"
#include "JSBakeResponse.h"
#include "JSSign.h"
#include "JSVerify.h"
#include "JSHmac.h"
#include "JSHash.h"
#include "JSDiffieHellman.h"
#include "JSDiffieHellmanGroup.h"
#include "JSECDH.h"
#include "JSCipher.h"
#include "JSKeyObject.h"
#include "JSSecretKeyObject.h"
#include "JSAsymmetricKeyObjectPrototype.h"
#include "JSPublicKeyObject.h"
#include "JSPrivateKeyObject.h"
#include "webcore/JSMIMEParams.h"
#include "JSNodePerformanceHooksHistogram.h"
#include "JSS3File.h"
#include "S3Error.h"
#include "ProcessBindingBuffer.h"
#include "NodeValidator.h"
#include "ProcessBindingFs.h"
#include "ProcessBindingHTTPParser.h"
#include "node/NodeTimers.h"
#include "JSConnectionsList.h"
#include "JSHTTPParser.h"
#include <exception>
#include <mutex>
#include "JSBunRequest.h"
#include "ServerRouteList.h"

#if ENABLE(REMOTE_INSPECTOR)
#include "JavaScriptCore/RemoteInspectorServer.h"
#endif

#include "NodeFSStatBinding.h"
#include "NodeFSStatFSBinding.h"
#include "NodeDirent.h"
#include "../../runtime/webview/JSWebView.h"

#if !OS(WINDOWS)
#include <dlfcn.h>
#endif

#include <wtf/NumberOfCores.h>

using namespace Bun;

BUN_DECLARE_HOST_FUNCTION(Bun__NodeUtil__jsParseArgs);

JSC_DECLARE_HOST_FUNCTION(jsFunctionMakeAbortError);

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
// #include <iostream>

Structure* createMemoryFootprintStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject);

#ifndef BUN_WEBKIT_VERSION
#ifndef ASSERT_ENABLED
#warning "BUN_WEBKIT_VERSION is not defined. WebKit's cmakeconfig.h is supposed to define that. If you're building a release build locally, ignore this warning. If you're seeing this warning in CI, please file an issue."
#endif

#define WEBKIT_BYTECODE_CACHE_HASH_KEY __TIMESTAMP__
#else
#define WEBKIT_BYTECODE_CACHE_HASH_KEY BUN_WEBKIT_VERSION
#endif
static consteval unsigned getWebKitBytecodeCacheVersion()
{
    return WTF::SuperFastHash::computeHash(WEBKIT_BYTECODE_CACHE_HASH_KEY);
}
#undef WEBKIT_BYTECODE_CACHE_HASH_KEY

// Declare fuzzilli function registration from FuzzilliREPRL.cpp
#ifdef FUZZILLI_ENABLED
extern "C" void Bun__REPRL__registerFuzzilliFunctions(Zig::GlobalObject*);
#endif

#if OS(WINDOWS) && (CPU(X86_64) || CPU(ARM64))
#include <JavaScriptCore/ExecutableAllocator.h>
extern "C" long Bun__crashHandlerFromJSCFrame(void*, void*, void*, void*);
#endif

// bun_icu_default_locale.cpp
extern "C" void Bun__ensureICUDefaultLocale();

extern "C" void JSCInitialize(const char* envp[], size_t envc, void (*onCrash)(const char* ptr, size_t length), bool evalMode, bool oneShotStartup, bool shortLivedGlobals)
{
    static std::once_flag jsc_init_flag;
    // NOLINTBEGIN
    std::call_once(jsc_init_flag, [evalMode, oneShotStartup, shortLivedGlobals, envp, envc, onCrash]() {
        Bun__ensureICUDefaultLocale();
        JSC::Config::enableRestrictedOptions();
        // JSC options come from BUN_JSC_* (applied in the callback below), not JSC_*.
        JSC::Config::disableEnvironmentOptions();

        std::set_terminate([]() { Zig__GlobalObject__onCrash(); });
        WTF::initializeMainThread();

        // Use JSC::initialize with a callback to set Options during initialization.
        // The callback runs BEFORE IPInt::initialize() so we can configure WASM options early.
        // Under ASAN+Linux, JSC's notifyOptionsChanged() already disables
        // useWasmFaultSignalHandler/FastMemory when ASAN_OPTIONS lacks
        // allow_user_segv_handler=1, so we don't force it off here.
        JSC::initialize([&] {
            JSC::Options::useWasm() = true;
            JSC::Options::useJIT() = true;
            JSC::Options::useBBQJIT() = true;
            JSC::Options::useConcurrentJIT() = true;
            // JSC::Options::useSigillCrashAnalyzer() = true;
            JSC::Options::useSourceProviderCache() = true;
            // JSC::Options::useUnlinkedCodeBlockJettisoning() = false;
            // JSModuleLoader is now a JSCell (not a JSObject) so exposing it as
            // the global `Loader` would let user code dereference a non-object
            // and trip JSValue::synthesizePrototype's isSymbol() debug assert.
            JSC::Options::exposeInternalModuleLoader() = false;
            JSC::Options::useSharedArrayBuffer() = true;
            JSC::Options::useJITCage() = false;
            JSC::Options::useShadowRealm() = true;
            JSC::Options::useV8DateParser() = true;
            JSC::Options::evalMode() = evalMode;
            JSC::Options::heapGrowthSteepnessFactor() = 1.0;
            JSC::Options::heapGrowthMaxIncrease() = 2.0;
            // JSC's allocation-budgeted pacing is now the primary eden driver; engage it sooner (GarbageCollectionController.rs).
            JSC::Options::largeHeapSize() = 8 * 1024 * 1024;
            JSC::Options::useAsyncStackTrace() = true;
            JSC::Options::useExplicitResourceManagement() = true;
            JSC::Options::useImportDefer() = true;
            JSC::Options::useTemporal() = true;
            // Upstream enabled Wasm Memory64 by default (0d0080ea539d); keep
            // it off in Bun while upstream stabilises it.
            // BUN_JSC_useWasmMemory64=1 re-enables it for opt-in testing.
            JSC::Options::useWasmMemory64() = false;
#if OS(WINDOWS)
            // oven-sh/WebKit#553 starts the MarkedBlock warm-up helper thread from
            // the allocation slow path once the heap has ramped; on Windows that
            // hangs the sampling profiler (@datadog/pprof, test/integration/datadog-pprof).
            // BUN_JSC_useWarmUpMarkedBlocks=1 re-enables it.
            JSC::Options::useWarmUpMarkedBlocks() = false;
#endif
            JSC::dangerouslyOverrideJSCBytecodeCacheVersion(getWebKitBytecodeCacheVersion());

#ifdef BUN_DEBUG
            JSC::Options::showPrivateScriptsInStackTraces() = true;
#endif

            if (oneShotStartup) {
                // One-shot invocations (`bun -e ...` / `bun --print ...`) run a
                // trivial amount of JavaScript and then exit; they never reach a
                // long-running event loop. Creating the JSC worker threads that
                // VM construction otherwise spawns eagerly — the concurrent JIT
                // worklist thread and the Heap parallel-marking helpers — is pure
                // overhead here (clone3 + faulting fresh thread stacks) and none
                // of those threads do useful work before the process exits. Run
                // the DFG/FTL on the executing thread and use a single GC marker.
                // A `BUN_JSC_<option>` environment override below can still flip
                // either knob back on for debugging.
                JSC::Options::useConcurrentJIT() = false;
                JSC::Options::numberOfGCMarkers() = 1;
            }

            // `bun test --isolate`: FTL code dies with each file's global, so only tier up code hot enough to pay that back within one file.
            if (shortLivedGlobals) {
                JSC::Options::thresholdForFTLOptimizeAfterWarmUp() = 1000000;
            }

            if (envc > 0) [[likely]] {
                auto envc_copy = envc;
                while (envc_copy--) {
                    const char* env = (const char*)envp[envc_copy];
                    // need to check for \0 so we might as well make this single pass
                    // strlen would check the end of the string
                    if (!(env[0] == 'B' && env[1] == 'U' && env[2] == 'N' && env[3] == '_' && env[4] == 'J' && env[5] == 'S' && env[6] == 'C' && env[7] == '_')) [[likely]] {
                        continue;
                    }

                    if (!JSC::Options::setOption(env + 8)) [[unlikely]] {
                        onCrash(env, strlen(env));
                    }
                }
            }
            JSC::Options::assertOptionsAreCoherent();
        }); // end JSC::initialize lambda

#if OS(WINDOWS) && (CPU(X86_64) || CPU(ARM64))
        // JSC::initialize() registered unwind info + a language-specific SEH
        // handler for the JIT pool. Route that handler to the crash reporter
        // so a hardware fault under a JIT frame is reported deterministically
        // at the JSC boundary. LLInt is not yet covered (needs build-time
        // offlineasm .seh_* emission).
        JSC::setJITExceptionHandlerWin(&Bun__crashHandlerFromJSCFrame);
#endif
    }); // end std::call_once lambda

    // NOLINTEND
}

extern "C" void* Bun__getVM();

extern "C" void Bun__setDefaultGlobalObject(Zig::GlobalObject* globalObject);

// Declare the native functions for LazyProperty initializers
extern "C" JSC::EncodedJSValue BunObject__createBunStdin(JSC::JSGlobalObject*);
extern "C" JSC::EncodedJSValue BunObject__createBunStderr(JSC::JSGlobalObject*);
extern "C" JSC::EncodedJSValue BunObject__createBunStdout(JSC::JSGlobalObject*);

static void checkIfNextTickWasCalledDuringMicrotask(JSC::VM& vm)
{
    auto* globalObject = defaultGlobalObject();
    if (auto queue = globalObject->m_nextTickQueue.get()) {
        globalObject->resetOnEachMicrotaskTick();
        queue->drain(vm, globalObject);
    }
}

GlobalObject* GlobalObject::create(JSC::VM& vm, JSC::Structure* structure)
{
    GlobalObject* ptr = new (NotNull, JSC::allocateCell<GlobalObject>(vm)) GlobalObject(vm, structure, &globalObjectMethodTable());
    ptr->finishCreation(vm);
    return ptr;
}

GlobalObject* GlobalObject::create(JSC::VM& vm, JSC::Structure* structure, uint32_t scriptExecutionContextId)
{
    GlobalObject* ptr = new (NotNull, JSC::allocateCell<GlobalObject>(vm)) GlobalObject(vm, structure, scriptExecutionContextId, &globalObjectMethodTable());
    ptr->finishCreation(vm);
    return ptr;
}

GlobalObject* GlobalObject::create(JSC::VM& vm, JSC::Structure* structure, const JSC::GlobalObjectMethodTable* methodTable)
{
    GlobalObject* ptr = new (NotNull, JSC::allocateCell<GlobalObject>(vm)) GlobalObject(vm, structure, methodTable);
    ptr->finishCreation(vm);
    return ptr;
}

GlobalObject* GlobalObject::create(JSC::VM& vm, JSC::Structure* structure, uint32_t scriptExecutionContextId, const JSC::GlobalObjectMethodTable* methodTable)
{
    GlobalObject* ptr = new (NotNull, JSC::allocateCell<GlobalObject>(vm)) GlobalObject(vm, structure, scriptExecutionContextId, methodTable);
    ptr->finishCreation(vm);
    return ptr;
}

JSC::Structure* GlobalObject::createStructure(JSC::VM& vm)
{
    auto* structure = JSC::Structure::create(vm, nullptr, jsNull(), JSC::TypeInfo(JSC::GlobalObjectType, StructureFlags & ~IsImmutablePrototypeExoticObject), info());
    structure->setTransitionWatchpointIsLikelyToBeFired(true);
    return structure;
}

void Zig::GlobalObject::resetOnEachMicrotaskTick()
{
    auto& vm = this->vm();
    if (this->m_nextTickQueue) {
        vm.setOnEachMicrotaskTick(nullptr);
    } else {
        vm.setOnEachMicrotaskTick(&checkIfNextTickWasCalledDuringMicrotask);
    }
}

extern "C" size_t Bun__reported_memory_size;

// executionContextId: -1 for main thread
// executionContextId: maxInt32 for macros
// executionContextId: >-1 for workers
extern "C" bool Bun__hasStandaloneModuleGraph();

extern "C" JSC::JSGlobalObject* Zig__GlobalObject__create(void* console_client, int32_t executionContextId, bool miniMode, bool evalMode, void* worker_ptr)
{
    auto heapSize = miniMode ? JSC::HeapType::Small : JSC::HeapType::Large;
    RefPtr<JSC::VM> vmPtr = JSC::VM::tryCreate(heapSize);
    if (!vmPtr) [[unlikely]] {
        BUN_PANIC("Failed to allocate JavaScriptCore Virtual Machine. Did your computer run out of memory? Or maybe you compiled Bun with a mismatching libc++ version or compiler?");
    }
    vmPtr->refSuppressingSaferCPPChecking();
    JSC::VM& vm = *vmPtr;
    // This must happen before JSVMClientData::create
    vm.heap.acquireAccess();
    JSC::JSLockHolder locker(vm);

    {
        const char* disable_stop_if_necessary_timer = getenv("BUN_DISABLE_STOP_IF_NECESSARY_TIMER");
        // Keep stopIfNecessaryTimer enabled by default when either:
        // - `--smol` is passed
        // - The machine has less than 4GB of RAM
        bool shouldDisableStopIfNecessaryTimer = !miniMode;

        if (disable_stop_if_necessary_timer) {
            const char value = disable_stop_if_necessary_timer[0];
            if (value == '0') {
                shouldDisableStopIfNecessaryTimer = false;
            } else if (value == '1') {
                shouldDisableStopIfNecessaryTimer = true;
            }
        }

        if (shouldDisableStopIfNecessaryTimer) {
            vm.heap.disableStopIfNecessaryTimer();
        }

        // This is used to tell us in the crash reporter how much RSS the system has.
        //
        // JSC already calls this inside JSC::VM::tryCreate and it's cached
        // internally, so there's little cost to calling this multiple times.
        Bun__reported_memory_size = WTF::ramSize();
    }

    // Every JS VM's RunLoop should use Bun's RunLoop implementation
    ASSERT(vmPtr->runLoop().kind() == WTF::RunLoop::Kind::Bun);

    WebCore::JSVMClientData::create(&vm, Bun__getVM(), static_cast<WebCore::WorkerMessagingProxy*>(worker_ptr));

    const auto createGlobalObject = [&]() -> Zig::GlobalObject* {
        if (executionContextId == std::numeric_limits<int32_t>::max() || executionContextId > 1) [[unlikely]] {
            auto* structure = Zig::GlobalObject::createStructure(vm);
            if (!structure) [[unlikely]] {
                return nullptr;
            }
            return Zig::GlobalObject::create(
                vm,
                structure,
                static_cast<ScriptExecutionContextIdentifier>(executionContextId),
                Bun__hasStandaloneModuleGraph() ? &Zig::StandaloneGlobalObject::globalObjectMethodTable() : &Zig::GlobalObject::globalObjectMethodTable());
        } else if (evalMode) {
            auto* structure = Zig::EvalGlobalObject::createStructure(vm);
            if (!structure) [[unlikely]] {
                return nullptr;
            }
            return Zig::EvalGlobalObject::create(
                vm,
                structure,
                &Zig::EvalGlobalObject::globalObjectMethodTable());

        } else {
            auto* structure = Zig::GlobalObject::createStructure(vm);
            if (!structure) [[unlikely]] {
                return nullptr;
            }
            if (Bun__hasStandaloneModuleGraph())
                return Zig::GlobalObject::create(vm, structure, &Zig::StandaloneGlobalObject::globalObjectMethodTable());
            return Zig::GlobalObject::create(
                vm,
                structure);
        }
    };

    auto* globalObject = createGlobalObject();
    if (!globalObject) [[unlikely]] {
        BUN_PANIC("Failed to allocate JavaScript global object. Did your computer run out of memory?");
    }

    globalObject->setConsole(console_client);
    globalObject->isThreadLocalDefaultGlobalObject = true;
    Bun__setDefaultGlobalObject(globalObject);
    JSC::gcProtect(globalObject);

#ifdef FUZZILLI_ENABLED
    Bun__REPRL__registerFuzzilliFunctions(static_cast<Zig::GlobalObject*>(globalObject));
#endif

    vm.setOnComputeErrorInfo(computeErrorInfoWrapperToString);
    vm.setOnComputeErrorInfoJSValue(computeErrorInfoWrapperToJSValue);
    vm.setComputeLineColumnWithSourcemap(computeLineColumnWithSourcemap);
    vm.setOnEachMicrotaskTick([](JSC::VM& vm) -> void {
        // if you process.nextTick on a microtask we need this
        auto* globalObject = defaultGlobalObject();
        if (auto queue = globalObject->m_nextTickQueue.get()) {
            globalObject->resetOnEachMicrotaskTick();
            queue->drain(vm, globalObject);
            return;
        }
    });

    if (executionContextId > -1) {
        const auto initializeWorker = [&](WebCore::WorkerMessagingProxy& worker) -> void {
            auto& options = worker.options();

            if (options.env.has_value()) {
                auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
                HashMap<String, String> map = *std::exchange(options.env, std::nullopt);
                auto size = map.size();

                // In theory, a GC could happen before we finish putting all the properties on the object.
                // So we use a MarkedArgumentBuffer to ensure that the strings are not collected and we immediately put them on the object.
                MarkedArgumentBuffer strings;
                strings.ensureCapacity(size);
                for (const auto& value : map.values()) {
                    strings.append(jsString(vm, value));
                }

#if OS(WINDOWS)
                JSC::JSObject* env = size
                    ? JSC::constructEmptyObject(globalObject, globalObject->objectPrototype(), size >= JSFinalObject::maxInlineCapacity ? JSFinalObject::maxInlineCapacity : size)
                    : JSC::constructEmptyObject(globalObject);
#else
                // Same exotic object as the main thread so writes inside the
                // worker coerce to string, reject symbol keys, and validate
                // defineProperty like Node's EnvSetter/EnvDefiner.
                auto* envStructure = Bun::JSEnvironmentVariableMap::createStructure(vm, globalObject, globalObject->objectPrototype());
                JSC::JSObject* env = Bun::JSEnvironmentVariableMap::create(vm, envStructure);
#endif
                size_t i = 0;
                for (auto k : map) {
                    // Numeric env keys hit putDirectIndex → defineOwnProperty (declares a
                    // ThrowScope). Seeded values are JSStrings, so this throws only on OOM
                    // or under a termination already requested for this starting worker.
                    env->putDirectMayBeIndex(globalObject, JSC::Identifier::fromString(vm, WTF::move(k.key)), strings.at(i++));
                    if (scope.exception()) [[unlikely]]
                        break;
                }
                globalObject->m_processEnvObject.set(vm, globalObject, env);
            } else if (options.sharedEnvStore) {
                // worker_threads SHARE_ENV: join the env tree the spawning thread
                // resolved. Consumed like options.env, and published on the context
                // before the view, which resolves its store through the context.
                RefPtr<Bun::SharedEnvStore> store = std::exchange(options.sharedEnvStore, nullptr);
                globalObject->scriptExecutionContext()->setSharedEnvStore(*store);
                globalObject->m_processEnvObject.set(vm, globalObject, Bun::createSharedEnvironmentVariablesMap(globalObject).getObject());
            }

            // Ensure that the TerminationException singleton is constructed. Workers need this so
            // that we can request their termination from another thread. For the main thread, we
            // can delay this until we are actually requesting termination (until and unless we ever
            // do need to request termination from another thread).
            //
            // Execution is forbidden by the exit path (GlobalObject::forbidExecution), not by any
            // TerminationException: node:vm {timeout} and breakOnSigint terminate transiently and the
            // worker keeps running afterwards.
            vm.ensureTerminationException();
        };

        if (auto* worker = static_cast<WebCore::WorkerMessagingProxy*>(worker_ptr)) {
            initializeWorker(*worker);
        }
    }

    return globalObject;
}

// Create a fresh Zig::GlobalObject on the *same* JSC::VM as `oldGlobal`, then unprotect
// the old one so GC can reclaim its module graph. Used by `bun test --isolate` to give
// each test file a clean global without paying for a new JSC::VM.
extern "C" JSC::JSGlobalObject* Zig__GlobalObject__createForTestIsolation(Zig::GlobalObject* oldGlobal, void* console_client)
{
    JSC::VM& vm = oldGlobal->vm();
    JSC::JSLockHolder locker(vm);

    // `JSGlobalObject::finishCreation` → `init()` performs hundreds of allocations
    // before every lazy/write-barrier member of the Bun subclass has been wired up.
    // Unlike the initial VM global (created before any user code can run and
    // therefore before any concurrent GC is in flight), this one is created while
    // the previous global's graph is live and the heap is warm, so the concurrent
    // marker is far more likely to pick the half-initialized object off the stack
    // and walk it. Deferring GC across the swap keeps the marker from observing the
    // new global (or the mid-swap pair) until both are in a consistent state; the
    // deferred collection fires on scope exit, by which point the new global is
    // gcProtect()'d and the old one is cleanly unprotected.
    JSC::DeferGC deferGC(vm);

    // The old global's workers, ports, channels and sockets were stopped by the runtime
    // (Zig__GlobalObject__stopActiveDOMObjectsForTestIsolation) before its sweeps and before this.
    auto* oldContext = oldGlobal->scriptExecutionContext();
    ASSERT(oldContext->activeDOMObjectsAreStopped());

    // The new global must inherit the old one's ScriptExecutionContext identifier so that
    // `Bun.isMainThread` (identifier == 1) and cross-thread task dispatch keep working.
    // Move the old context to a fresh identifier first to free the slot.
    const auto inheritedId = oldContext->identifier();
    oldContext->removeFromContextsMap();
    oldContext->regenerateIdentifier();

    auto* structure = Zig::GlobalObject::createStructure(vm);
    if (!structure) [[unlikely]] {
        BUN_PANIC("Failed to allocate global object structure for test isolation");
    }
    auto* globalObject = Zig::GlobalObject::create(vm, structure, inheritedId);
    if (!globalObject) [[unlikely]] {
        BUN_PANIC("Failed to allocate global object for test isolation");
    }

    globalObject->setConsole(console_client);
    globalObject->isThreadLocalDefaultGlobalObject = true;
    Bun__setDefaultGlobalObject(globalObject);
    JSC::gcProtect(globalObject);

    // NapiEnv holds a raw Zig::GlobalObject*; deferred napi finalizers for
    // the old global's objects run on the next event-loop tick — after this
    // function returns and the old global is collectable — and would write
    // into the dead cell via NapiHandleScope::open. Point those envs at the
    // new global and adopt the refs before unprotecting the old one.
    globalObject->adoptNapiEnvsForTestIsolation(oldGlobal);

    // The swap replaces this thread's ScriptExecutionContext. If the thread had
    // joined a worker_threads SHARE_ENV tree, carry it over (store + the
    // write-through process.env) so it doesn't silently leave the tree.
    if (auto* sharedEnvStore = oldContext->sharedEnvStore()) {
        globalObject->scriptExecutionContext()->setSharedEnvStore(*sharedEnvStore);
        globalObject->m_processEnvObject.set(vm, globalObject, Bun::createSharedEnvironmentVariablesMap(globalObject).getObject());
    }

    // The plugin registries hold Strong<> roots into the old realm; owned by the global itself,
    // they would keep it (and everything it loaded) alive for the rest of the run.
    oldGlobal->onLoadPlugins.clear();
    oldGlobal->onResolvePlugins.clear();
    // Drop the finished file's module registry and require.cache now rather than whenever the
    // old global happens to die. JSC's CodeCache and Bun's RuntimeTranspilerCache are VM/process
    // scoped and survive.
    {
        auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
        oldGlobal->clearModuleRegistry();
        scope.assertNoExceptionExceptTermination();
    }
    oldGlobal->isThreadLocalDefaultGlobalObject = false;
    JSC::gcUnprotect(oldGlobal);

    return globalObject;
}

static bool isModuleEvaluated(JSC::AbstractModuleRecord* record)
{
    if (!record)
        return false;
    if (auto* cyclic = dynamicDowncast<JSC::CyclicModuleRecord>(record))
        return cyclic->status() == JSC::CyclicModuleRecord::Status::Evaluated && !cyclic->evaluationError();
    // SyntheticModuleRecord is "evaluated" once linked (it has an environment).
    return record->moduleEnvironmentMayBeNull() != nullptr;
}

// A non-TLA record that is mid-evaluation: require() re-entered it from
// inside its own evaluation (a require cycle). Its namespace is live —
// hoisted functions callable, bindings not yet initialized in TDZ — the same
// as a static import in that cycle would see.
static bool isModuleEvaluatingSync(JSC::AbstractModuleRecord* record)
{
    auto* cyclic = dynamicDowncast<JSC::CyclicModuleRecord>(record);
    return cyclic && cyclic->status() == JSC::CyclicModuleRecord::Status::Evaluating && !cyclic->hasTLA() && !cyclic->evaluationError();
}

static bool isModuleEvaluating(JSC::AbstractModuleRecord* record)
{
    auto* cyclic = dynamicDowncast<JSC::CyclicModuleRecord>(record);
    return cyclic && cyclic->status() == JSC::CyclicModuleRecord::Status::Evaluating;
}

JSC_DEFINE_HOST_FUNCTION(functionEsmNamespaceForCjs, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue keyValue = callFrame->argument(0);
    if (!keyValue.isString())
        return JSValue::encode(jsUndefined());
    auto key = JSC::Identifier::fromString(vm, asString(keyValue)->value(globalObject));
    RETURN_IF_EXCEPTION(scope, {});
    auto* entry = globalObject->moduleLoader()->registryEntry(key);
    if (!entry || !isModuleEvaluated(entry->record()))
        return JSValue::encode(jsUndefined());
    auto* ns = entry->record()->getModuleNamespace(globalObject, false);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(ns);
}

JSC_DEFINE_HOST_FUNCTION(functionEsmRegistryDelete, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue keyValue = callFrame->argument(0);
    if (!keyValue.isString())
        return JSValue::encode(jsBoolean(false));
    auto key = JSC::Identifier::fromString(vm, asString(keyValue)->value(globalObject));
    RETURN_IF_EXCEPTION(scope, {});
    auto* moduleLoader = globalObject->moduleLoader();
    // JSModuleLoader::visitChildrenImpl iterates these maps on the GC thread
    // under cellLock(); take the same lock so the removal can't race it.
    WTF::Locker locker { moduleLoader->cellLock() };
    return JSValue::encode(jsBoolean(moduleLoader->removeEntry(key)));
}

JSC_DEFINE_HOST_FUNCTION(functionEsmRegistryEvaluatedKeys, (JSC::JSGlobalObject * globalObject, JSC::CallFrame*))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSC::MarkedArgumentBuffer keys;
    for (auto& [key, entry] : globalObject->moduleLoader()->moduleMap()) {
        if (!key.first || !entry || !isModuleEvaluated(entry->record()))
            continue;
        keys.append(jsString(vm, String { key.first }));
    }
    if (keys.hasOverflowed()) [[unlikely]] {
        throwOutOfMemoryError(globalObject, scope);
        return {};
    }
    auto* array = JSC::constructArray(globalObject, static_cast<JSC::ArrayAllocationProfile*>(nullptr), keys);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(array);
}

JSC_DEFINE_HOST_FUNCTION(functionEsmLoadSync, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    Zig::GlobalObject* globalObject = uncheckedDowncast<Zig::GlobalObject>(lexicalGlobalObject);
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue keyValue = callFrame->argument(0);
    auto keyString = keyValue.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    auto key = JSC::Identifier::fromString(vm, keyString);

    auto* loader = globalObject->moduleLoader();
    bool entryExistedBefore = false;
    if (auto* entry = loader->registryEntry(key)) {
        entryExistedBefore = true;
        if (isModuleEvaluated(entry->record()) || isModuleEvaluatingSync(entry->record())) {
            auto* ns = entry->record()->getModuleNamespace(globalObject, false);
            RETURN_IF_EXCEPTION(scope, {});
            return JSValue::encode(ns);
        }
        // Any other Evaluating record (one with top-level await) must not
        // reach loadModuleSync: Link() and Evaluate() reject that status.
        if (isModuleEvaluating(entry->record()))
            return throwVMTypeError(globalObject, scope, makeString("require() async module \""_s, keyString, "\" is unsupported. use \"await import()\" instead."_s));
    }

    JSPromise* promise = loader->loadModuleSync(globalObject, key, nullptr, nullptr);
    RETURN_IF_EXCEPTION(scope, {});

    switch (promise->status()) {
    case JSPromise::Status::Fulfilled:
        break;
    case JSPromise::Status::Rejected: {
        promise->markAsHandled();
        JSValue error = promise->result();
        scope.throwException(globalObject, error);
        return {};
    }
    case JSPromise::Status::Pending: {
        promise->markAsHandled();
        // The load promise stays Pending when this module shares an SCC with an
        // outer module that is still Evaluating (e.g. ESM entry → CJS shim →
        // require(esm) → imports something the entry already loaded). For a
        // non-TLA record whose status is exactly Evaluating, the body already
        // ran synchronously; only the status flip waits on the SCC root. Treat
        // that as success — the namespace is fully populated.
        //
        // Explicitly exclude EvaluatingAsync: a record reaches that state when
        // it OR any dependency has top-level await, in which case bindings can
        // still be in TDZ and we must throw the "async module" error instead
        // of returning a half-initialized namespace.
        if (auto* entry = loader->registryEntry(key)) {
            auto* record = entry->record();
            if (isModuleEvaluatingSync(record))
                break;
            if (auto* cyclic = dynamicDowncast<JSC::CyclicModuleRecord>(record)) {
                if (cyclic->status() == JSC::CyclicModuleRecord::Status::Evaluated && !cyclic->hasTLA() && !cyclic->evaluationError())
                    break;
            }
        }
        // Only drop the entry we created. If the entry already existed (an
        // outer import() is mid-load, or the module is EvaluatingAsync from a
        // prior import), removing it would force a second evaluation and a
        // second namespace object once that outer load completes.
        if (!entryExistedBefore) {
            WTF::Locker locker { loader->cellLock() };
            loader->removeEntry(key);
        }
        return throwVMTypeError(globalObject, scope, makeString("require() async module \""_s, keyString, "\" is unsupported. use \"await import()\" instead."_s));
    }
    }

    auto* entry = loader->registryEntry(key);
    if (!entry || !entry->record()) [[unlikely]]
        return throwVMTypeError(globalObject, scope, makeString("require() failed to evaluate module \""_s, keyString, "\". This is an internal consistentency error."_s));

    // The loadModule promise resolved, so the entire graph linked + evaluated
    // synchronously. We deliberately do NOT gate on CyclicModuleRecord::status()
    // here: when require(esm) is called from inside an outer ESM graph that is
    // itself mid-evaluation (a CJS shim imported by an ESM entry), the inner
    // record's body has already run but its status only flips to Evaluated once
    // the SCC root (the outer module we're currently inside) settles. Returning
    // the namespace in that state matches the old loader's behaviour and Node's
    // require(esm) cycle semantics. evaluationError() still surfaces a real
    // throw from the module body.
    auto* record = entry->record();
    if (auto* cyclic = dynamicDowncast<JSC::CyclicModuleRecord>(record)) {
        if (JSValue err = cyclic->evaluationError()) {
            scope.throwException(globalObject, err);
            return {};
        }
    }

    auto* ns = record->getModuleNamespace(globalObject, false);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(ns);
}

#define WEBCORE_GENERATED_CONSTRUCTOR_GETTER(ConstructorName)                                                                                                            \
    JSValue ConstructorName##ConstructorCallback(VM& vm, JSObject* lexicalGlobalObject)                                                                                  \
    {                                                                                                                                                                    \
        return WebCore::JS##ConstructorName::getConstructor(vm, uncheckedDowncast<Zig::GlobalObject>(lexicalGlobalObject));                                              \
    }                                                                                                                                                                    \
    JSC_DEFINE_CUSTOM_GETTER(ConstructorName##_getter,                                                                                                                   \
        (JSC::JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue,                                                                                       \
            JSC::PropertyName))                                                                                                                                          \
    {                                                                                                                                                                    \
        return JSC::JSValue::encode(WebCore::JS##ConstructorName::getConstructor(lexicalGlobalObject->vm(), uncheckedDowncast<Zig::GlobalObject>(lexicalGlobalObject))); \
    }

String GlobalObject::defaultAgentClusterID()
{
    return makeString(WebCore::Process::identifier().toUInt64(), "-default"_s);
}

String GlobalObject::agentClusterID() const
{
    // TODO: workers
    // if (is<SharedWorkerGlobalScope>(scriptExecutionContext()))
    //     return makeString(WProcess::identifier().toUInt64(), "-sharedworker");
    return defaultAgentClusterID();
}

namespace Zig {

using namespace WebCore;

JSGlobalObject* GlobalObject::deriveShadowRealmGlobalObject(JSGlobalObject* globalObject)
{
    auto& vm = JSC::getVM(globalObject);
    // Same reasoning as Zig__GlobalObject__createForTestIsolation: keep the
    // concurrent marker from walking the new global while finishCreation/init
    // is still populating it.
    JSC::DeferGC deferGC(vm);
    Zig::GlobalObject* shadow = Zig::GlobalObject::create(
        vm,
        Zig::GlobalObject::createStructure(vm),
        ScriptExecutionContext::generateIdentifier());
    shadow->setConsole(shadow);

    return shadow;
}

extern "C" int Bun__VM__scriptExecutionStatus(void*);
JSC::ScriptExecutionStatus Zig::GlobalObject::scriptExecutionStatus(JSC::JSGlobalObject* globalObject, JSC::JSObject*)
{
    switch (Bun__VM__scriptExecutionStatus(uncheckedDowncast<Zig::GlobalObject>(globalObject)->bunVM())) {
    case 0:
        return JSC::ScriptExecutionStatus::Running;
    case 1:
        return JSC::ScriptExecutionStatus::Suspended;
    case 2:
        return JSC::ScriptExecutionStatus::Stopped;
    default: {
        RELEASE_ASSERT_NOT_REACHED();
    }
    }
}

void unsafeEvalNoop(JSGlobalObject*, const WTF::String&) {}

const JSC::GlobalObjectMethodTable& GlobalObject::globalObjectMethodTable()
{
    static const JSC::GlobalObjectMethodTable table = {
        &supportsRichSourceInfo,
        &shouldInterruptScript,
        &javaScriptRuntimeFlags,
        nullptr, // &shouldInterruptScriptBeforeTimeout,
        &moduleLoaderImportModule, // moduleLoaderImportModule
        &moduleLoaderResolve, // moduleLoaderResolve
        &moduleLoaderFetch, // moduleLoaderFetch
        &moduleLoaderCreateImportMetaProperties, // moduleLoaderCreateImportMetaProperties
        &moduleLoaderEvaluate, // moduleLoaderEvaluate
        &promiseRejectionTracker, // promiseRejectionTracker
        &reportUncaughtExceptionAtEventLoop,
        &currentScriptExecutionOwner,
        &scriptExecutionStatus,
        &unsafeEvalNoop, // reportViolationForUnsafeEval
        nullptr, // defaultLanguage
        &compileStreaming,
        &instantiateStreaming,
        &deriveShadowRealmGlobalObject,
        &codeForEval, // codeForEval
        &canCompileStrings, // canCompileStrings
        &trustedScriptStructure, // trustedScriptStructure
    };
    return table;
}

const JSC::GlobalObjectMethodTable& EvalGlobalObject::globalObjectMethodTable()
{
    static const JSC::GlobalObjectMethodTable table = {
        &supportsRichSourceInfo,
        &shouldInterruptScript,
        &javaScriptRuntimeFlags,
        nullptr, // &shouldInterruptScriptBeforeTimeout,
        &moduleLoaderImportModule, // moduleLoaderImportModule
        &moduleLoaderResolve, // moduleLoaderResolve
        &moduleLoaderFetch, // moduleLoaderFetch
        &moduleLoaderCreateImportMetaProperties, // moduleLoaderCreateImportMetaProperties
        &moduleLoaderEvaluate, // moduleLoaderEvaluate
        &promiseRejectionTracker, // promiseRejectionTracker
        &reportUncaughtExceptionAtEventLoop,
        &currentScriptExecutionOwner,
        &scriptExecutionStatus,
        &unsafeEvalNoop, // reportViolationForUnsafeEval
        nullptr, // defaultLanguage
        &compileStreaming,
        &instantiateStreaming,
        &deriveShadowRealmGlobalObject,
        &codeForEval, // codeForEval
        &canCompileStrings, // canCompileStrings
        &trustedScriptStructure, // trustedScriptStructure
    };
    return table;
}

const JSC::GlobalObjectMethodTable& StandaloneGlobalObject::globalObjectMethodTable()
{
    static const JSC::GlobalObjectMethodTable table = {
        &supportsRichSourceInfo,
        &shouldInterruptScript,
        &javaScriptRuntimeFlags,
        nullptr, // &shouldInterruptScriptBeforeTimeout,
        &moduleLoaderImportModule, // moduleLoaderImportModule
        &StandaloneGlobalObject::moduleLoaderResolve,
        &StandaloneGlobalObject::moduleLoaderFetch,
        &moduleLoaderCreateImportMetaProperties, // moduleLoaderCreateImportMetaProperties
        &moduleLoaderEvaluate, // moduleLoaderEvaluate
        &promiseRejectionTracker, // promiseRejectionTracker
        &reportUncaughtExceptionAtEventLoop,
        &currentScriptExecutionOwner,
        &scriptExecutionStatus,
        &unsafeEvalNoop, // reportViolationForUnsafeEval
        nullptr, // defaultLanguage
        &compileStreaming,
        &instantiateStreaming,
        &deriveShadowRealmGlobalObject,
        &codeForEval, // codeForEval
        &canCompileStrings, // canCompileStrings
        &trustedScriptStructure, // trustedScriptStructure
    };
    return table;
}

GlobalObject::GlobalObject(JSC::VM& vm, JSC::Structure* structure, const JSC::GlobalObjectMethodTable* methodTable)
    : Base(vm, structure, methodTable)
    , m_bunVM(Bun__getVM())
    , m_constructors(makeUnique<WebCore::DOMConstructors>())
    , m_world(static_cast<JSVMClientData*>(vm.clientData)->normalWorld())
    , m_builtinInternalFunctions(makeUnique<WebCore::JSBuiltinInternalFunctions>(vm))
    , m_scriptExecutionContext(new WebCore::ScriptExecutionContext(&vm, this))
    , globalEventScope(adoptRef(*new Bun::GlobalEventScope(m_scriptExecutionContext)))
{
    // m_scriptExecutionContext = globalEventScope.m_context;
    mockModule = Bun::JSMockModule::create(this);
    globalEventScope->m_context = m_scriptExecutionContext;
}

GlobalObject::GlobalObject(JSC::VM& vm, JSC::Structure* structure, WebCore::ScriptExecutionContextIdentifier contextId, const JSC::GlobalObjectMethodTable* methodTable)
    : Base(vm, structure, methodTable)
    , m_bunVM(Bun__getVM())
    , m_constructors(makeUnique<WebCore::DOMConstructors>())
    , m_world(static_cast<JSVMClientData*>(vm.clientData)->normalWorld())
    , m_builtinInternalFunctions(makeUnique<WebCore::JSBuiltinInternalFunctions>(vm))
    , m_scriptExecutionContext(new WebCore::ScriptExecutionContext(&vm, this, contextId))
    , globalEventScope(adoptRef(*new Bun::GlobalEventScope(m_scriptExecutionContext)))
{
    // m_scriptExecutionContext = globalEventScope.m_context;
    mockModule = Bun::JSMockModule::create(this);
    globalEventScope->m_context = m_scriptExecutionContext;
}

GlobalObject::~GlobalObject()
{
    m_scriptExecutionContext->globalObjectDestroyed();
    m_scriptExecutionContext->deref();
}

void GlobalObject::destroy(JSCell* cell)
{
    static_cast<GlobalObject*>(cell)->GlobalObject::~GlobalObject();
}

WebCore::ScriptExecutionContext* GlobalObject::scriptExecutionContext() const
{
    return m_scriptExecutionContext;
}

void GlobalObject::reportUncaughtExceptionAtEventLoop(JSGlobalObject* globalObject,
    JSC::Exception* exception)
{
    Bun__reportUnhandledError(globalObject, JSValue::encode(JSValue(exception)));
}

extern "C" void Bun__handleHandledPromise(Zig::GlobalObject* JSGlobalObject, JSC::JSPromise* promise);

void GlobalObject::promiseRejectionTracker(JSGlobalObject* obj, JSC::JSPromise* promise,
    JSC::JSPromiseRejectionOperation operation)
{
    auto* globalObj = static_cast<GlobalObject*>(obj);

    switch (operation) {
    case JSPromiseRejectionOperation::Reject:
        globalObj->m_aboutToBeNotifiedRejectedPromises.append(obj->vm(), globalObj, promise);
        break;
    case JSPromiseRejectionOperation::Handle:
        bool removed = globalObj->m_aboutToBeNotifiedRejectedPromises.removeFirstMatching(globalObj, [&](JSC::WriteBarrier<JSC::JSPromise>& unhandledPromise) {
            return unhandledPromise.get() == promise;
        });
        if (removed) break;
        // handleRejectedPromises() drains the list into a local buffer before
        // running any handler. A handler may .catch() a later still-queued
        // promise; that promise is no longer in m_aboutToBeNotifiedRejectedPromises
        // but has not yet had 'unhandledRejection' fired, so it must not get
        // 'rejectionHandled'. Check every in-flight tail (handlers can re-enter
        // handleRejectedPromises(), so there may be more than one).
        for (auto* inflight = globalObj->m_rejectedPromisesBeingProcessed; inflight; inflight = inflight->outer) {
            for (size_t i = inflight->index, n = inflight->buffer->size(); i < n; ++i) {
                if (inflight->buffer->at(i).asCell() == promise)
                    return;
            }
        }
        // The promise rejection has already been notified, now we need to queue it for the rejectionHandled event
        Bun__handleHandledPromise(globalObj, promise);
        break;
    }
}

void GlobalObject::setConsole(void* console)
{
    this->setConsoleClient(new Bun::ConsoleObject(console));
}

JSC_DEFINE_CUSTOM_GETTER(errorConstructorPrepareStackTraceGetter,
    (JSC::JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue,
        JSC::PropertyName))
{
    Zig::GlobalObject* thisObject = uncheckedDowncast<Zig::GlobalObject>(lexicalGlobalObject);
    if (thisObject->m_errorConstructorPrepareStackTraceValue) {
        return JSValue::encode(thisObject->m_errorConstructorPrepareStackTraceValue.get());
    }

    return JSValue::encode(thisObject->m_errorConstructorPrepareStackTraceInternalValue.get(thisObject));
}

JSC_DEFINE_CUSTOM_SETTER(errorConstructorPrepareStackTraceSetter,
    (JSC::JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue,
        JSC::EncodedJSValue encodedValue, JSC::PropertyName property))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    Zig::GlobalObject* thisObject = uncheckedDowncast<Zig::GlobalObject>(lexicalGlobalObject);
    JSValue value = JSValue::decode(encodedValue);
    if (value == thisObject->m_errorConstructorPrepareStackTraceInternalValue.get(thisObject)) {
        thisObject->m_errorConstructorPrepareStackTraceValue.clear();
    } else {
        thisObject->m_errorConstructorPrepareStackTraceValue.set(vm, thisObject, value);
    }

    return true;
}

#pragma mark - Globals

// onmessage/onerror are CustomValue properties, so JSC invokes these callbacks
// with the property receiver as thisValue, which is not necessarily the global
// object: `new Proxy(globalThis, {}).onmessage = fn` passes the Proxy.
static Zig::GlobalObject* globalObjectForEventHandler(JSC::JSGlobalObject* lexicalGlobalObject, JSC::EncodedJSValue thisValue)
{
    if (auto* globalObject = dynamicDowncast<Zig::GlobalObject>(JSValue::decode(thisValue)))
        return globalObject;
    return defaultGlobalObject(lexicalGlobalObject);
}

JSC_DEFINE_CUSTOM_GETTER(globalOnMessage,
    (JSC::JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue,
        JSC::PropertyName))
{
    Zig::GlobalObject* thisObject = globalObjectForEventHandler(lexicalGlobalObject, thisValue);
    return JSValue::encode(eventHandlerAttribute(thisObject->eventTarget(), eventNames().messageEvent, thisObject->world()));
}

JSC_DEFINE_CUSTOM_GETTER(globalOnError,
    (JSC::JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue,
        JSC::PropertyName))
{
    Zig::GlobalObject* thisObject = globalObjectForEventHandler(lexicalGlobalObject, thisValue);
    return JSValue::encode(eventHandlerAttribute(thisObject->eventTarget(), eventNames().errorEvent, thisObject->world()));
}

JSC_DEFINE_CUSTOM_SETTER(setGlobalOnMessage,
    (JSC::JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue,
        JSC::EncodedJSValue encodedValue, JSC::PropertyName property))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    JSValue value = JSValue::decode(encodedValue);
    auto* thisObject = globalObjectForEventHandler(lexicalGlobalObject, thisValue);
    setEventHandlerAttribute<JSEventListener>(thisObject->eventTarget(), eventNames().messageEvent, value, *thisObject);
    vm.writeBarrier(thisObject, value);
    ensureStillAliveHere(value);
    return true;
}

JSC_DEFINE_CUSTOM_SETTER(setGlobalOnError,
    (JSC::JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue,
        JSC::EncodedJSValue encodedValue, JSC::PropertyName property))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    JSValue value = JSValue::decode(encodedValue);
    auto* thisObject = globalObjectForEventHandler(lexicalGlobalObject, thisValue);
    setEventHandlerAttribute<JSEventListener>(thisObject->eventTarget(), eventNames().errorEvent, value, *thisObject);
    vm.writeBarrier(thisObject, value);
    ensureStillAliveHere(value);
    return true;
}

WebCore::EventTarget& GlobalObject::eventTarget()
{
    return globalEventScope;
}

JSC_DEFINE_CUSTOM_GETTER(JSBuffer_getter,
    (JSC::JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue,
        JSC::PropertyName))
{
    return JSC::JSValue::encode(uncheckedDowncast<Zig::GlobalObject>(lexicalGlobalObject)->JSBufferConstructor());
}

// This macro defines the getter needed for ZigGlobalObject.lut.h
// "<ClassName>ConstructorCallback" is a PropertyCallback
// it also defines "<ClassName>_getter" which is the getter for a JSC::CustomGetterSetter
WEBCORE_GENERATED_CONSTRUCTOR_GETTER(AbortController);
WEBCORE_GENERATED_CONSTRUCTOR_GETTER(AbortSignal);
WEBCORE_GENERATED_CONSTRUCTOR_GETTER(BroadcastChannel);
WEBCORE_GENERATED_CONSTRUCTOR_GETTER(ByteLengthQueuingStrategy)
WEBCORE_GENERATED_CONSTRUCTOR_GETTER(CloseEvent);
WEBCORE_GENERATED_CONSTRUCTOR_GETTER(CompressionStream);
WEBCORE_GENERATED_CONSTRUCTOR_GETTER(CountQueuingStrategy)
WEBCORE_GENERATED_CONSTRUCTOR_GETTER(CryptoKey);
WEBCORE_GENERATED_CONSTRUCTOR_GETTER(CustomEvent);
WEBCORE_GENERATED_CONSTRUCTOR_GETTER(DecompressionStream);
WEBCORE_GENERATED_CONSTRUCTOR_GETTER(DOMException);
WEBCORE_GENERATED_CONSTRUCTOR_GETTER(DOMFormData);
WEBCORE_GENERATED_CONSTRUCTOR_GETTER(DOMURL);
WEBCORE_GENERATED_CONSTRUCTOR_GETTER(ErrorEvent);
WEBCORE_GENERATED_CONSTRUCTOR_GETTER(Event);
WEBCORE_GENERATED_CONSTRUCTOR_GETTER(EventTarget);
WEBCORE_GENERATED_CONSTRUCTOR_GETTER(FetchHeaders);
WEBCORE_GENERATED_CONSTRUCTOR_GETTER(MessageChannel);
WEBCORE_GENERATED_CONSTRUCTOR_GETTER(MessageEvent);
WEBCORE_GENERATED_CONSTRUCTOR_GETTER(MessagePort);
WEBCORE_GENERATED_CONSTRUCTOR_GETTER(Performance);
WEBCORE_GENERATED_CONSTRUCTOR_GETTER(PerformanceEntry);
WEBCORE_GENERATED_CONSTRUCTOR_GETTER(PerformanceMark);
WEBCORE_GENERATED_CONSTRUCTOR_GETTER(PerformanceMeasure);
WEBCORE_GENERATED_CONSTRUCTOR_GETTER(PerformanceObserver);
WEBCORE_GENERATED_CONSTRUCTOR_GETTER(PerformanceObserverEntryList)
WEBCORE_GENERATED_CONSTRUCTOR_GETTER(PerformanceResourceTiming)
WEBCORE_GENERATED_CONSTRUCTOR_GETTER(PerformanceServerTiming)
WEBCORE_GENERATED_CONSTRUCTOR_GETTER(PerformanceTiming)
WEBCORE_GENERATED_CONSTRUCTOR_GETTER(ReadableByteStreamController)
WEBCORE_GENERATED_CONSTRUCTOR_GETTER(ReadableStream)
WEBCORE_GENERATED_CONSTRUCTOR_GETTER(ReadableStreamBYOBReader)
WEBCORE_GENERATED_CONSTRUCTOR_GETTER(ReadableStreamBYOBRequest)
WEBCORE_GENERATED_CONSTRUCTOR_GETTER(ReadableStreamDefaultController)
WEBCORE_GENERATED_CONSTRUCTOR_GETTER(ReadableStreamDefaultReader)
WEBCORE_GENERATED_CONSTRUCTOR_GETTER(SubtleCrypto);
WEBCORE_GENERATED_CONSTRUCTOR_GETTER(TextEncoder);
WEBCORE_GENERATED_CONSTRUCTOR_GETTER(TextEncoderStream);
WEBCORE_GENERATED_CONSTRUCTOR_GETTER(TextDecoderStream);
WEBCORE_GENERATED_CONSTRUCTOR_GETTER(TransformStream)
WEBCORE_GENERATED_CONSTRUCTOR_GETTER(TransformStreamDefaultController)
WEBCORE_GENERATED_CONSTRUCTOR_GETTER(URLPattern);
WEBCORE_GENERATED_CONSTRUCTOR_GETTER(URLSearchParams);
WEBCORE_GENERATED_CONSTRUCTOR_GETTER(WebSocket);
WEBCORE_GENERATED_CONSTRUCTOR_GETTER(Worker);
WEBCORE_GENERATED_CONSTRUCTOR_GETTER(WritableStream);
WEBCORE_GENERATED_CONSTRUCTOR_GETTER(WritableStreamDefaultController);
WEBCORE_GENERATED_CONSTRUCTOR_GETTER(WritableStreamDefaultWriter);

JSC_DEFINE_HOST_FUNCTION(functionGetSelf,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    return JSValue::encode(globalObject->globalThis());
}

JSC_DEFINE_HOST_FUNCTION(functionSetSelf,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    JSC::JSValue value = callFrame->argument(0);
    // Chrome DevTools:
    //   > Object.getOwnPropertyDescriptor(globalThis, "self")
    //   < {enumerable: true, configurable: true, get: ƒ, set: ƒ}
    //   > globalThis.self = 123
    //   < 123
    //   > Object.getOwnPropertyDescriptor(globalThis, "self")
    //   < {value: 123, writable: true, enumerable: true, configurable: true}
    globalObject->putDirect(vm, WebCore::builtinNames(vm).selfPublicName(), value, 0);
    return JSValue::encode(value);
}

JSC_DEFINE_HOST_FUNCTION(functionQueueMicrotask,
    (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue callback = callFrame->argument(0);
    V::validateFunction(scope, lexicalGlobalObject, callback, "callback"_s);
    RETURN_IF_EXCEPTION(scope, {});

    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    JSC::JSValue asyncContext = globalObject->m_asyncContextData.get()->getInternalField(0);
#if ASSERT_ENABLED
    ASSERT_WITH_MESSAGE(!callback.isEmpty(), "Invalid microtask callback");
#endif

    if (asyncContext.isEmpty()) {
        asyncContext = JSC::jsUndefined();
    }

    // BunPerformMicrotaskJob: callback, asyncContext
    JSC::QueuedTask task { nullptr, JSC::InternalMicrotask::BunPerformMicrotaskJob, 0, globalObject, callback, asyncContext };
    globalObject->vm().queueMicrotask(WTF::move(task));

    return JSC::JSValue::encode(JSC::jsUndefined());
}

using MicrotaskCallback = void (*)(void*);

JSC_DEFINE_HOST_FUNCTION(functionNativeMicrotaskTrampoline,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    // Do not use JSCell* here because the GC will try to visit it.
    double cellPtr = callFrame->uncheckedArgument(0).asNumber();
    double callbackPtr = callFrame->uncheckedArgument(1).asNumber();

    void* cell = reinterpret_cast<void*>(std::bit_cast<uintptr_t>(cellPtr));
    auto* callback = reinterpret_cast<MicrotaskCallback>(std::bit_cast<uintptr_t>(callbackPtr));
    callback(cell);
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(functionBTOA,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto throwScope = DECLARE_THROW_SCOPE(globalObject->vm());

    if (callFrame->argumentCount() == 0) {
        JSC::throwTypeError(globalObject, throwScope, "btoa requires 1 argument (a string)"_s);
        return {};
    }

    JSValue arg0 = callFrame->uncheckedArgument(0);
    WTF::String encodedString = arg0.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(throwScope, JSC::JSValue::encode(JSC::JSValue {}));

    if (encodedString.isEmpty()) {
        return JSC::JSValue::encode(JSC::jsEmptyString(vm));
    }

    if (!encodedString.containsOnlyLatin1()) {
        auto exception = createDOMException(globalObject, InvalidCharacterError);
        RETURN_IF_EXCEPTION(throwScope, {});
        throwException(globalObject, throwScope, exception);
        return {};
    }

    // Reminder: btoa() is for Byte Strings
    // Specifically: latin1 byte strings
    // That means even though this looks like the wrong thing to do,
    // we should be converting to latin1, not utf8.
    if (!encodedString.is8Bit()) {
        std::span<Latin1Character> ptr;
        unsigned length = encodedString.length();
        auto dest = WTF::String::tryCreateUninitialized(length, ptr);
        if (dest.isNull()) [[unlikely]] {
            throwOutOfMemoryError(globalObject, throwScope);
            return {};
        }
        WTF::StringImpl::copyCharacters(ptr, encodedString.span16());
        encodedString = WTF::move(dest);
    }

    unsigned length = encodedString.length();
    RELEASE_AND_RETURN(
        throwScope,
        Bun__encoding__toString(
            encodedString.span8().data(),
            length,
            globalObject,
            static_cast<uint8_t>(WebCore::BufferEncodingType::base64)));
}

JSC_DEFINE_HOST_FUNCTION(functionATOB,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto throwScope = DECLARE_THROW_SCOPE(globalObject->vm());

    if (callFrame->argumentCount() == 0) {
        JSC::throwTypeError(globalObject, throwScope, "atob requires 1 argument (a string)"_s);
        return {};
    }

    WTF::String encodedString = callFrame->uncheckedArgument(0).toWTFString(globalObject);
    RETURN_IF_EXCEPTION(throwScope, JSC::JSValue::encode(JSC::JSValue {}));

    auto result = Bun::Base64::atob(encodedString);
    if (result.hasException()) {
        auto exception = createDOMException(*globalObject, result.releaseException());
        RETURN_IF_EXCEPTION(throwScope, {});
        throwException(globalObject, throwScope, exception);
        return {};
    }

    RELEASE_AND_RETURN(throwScope, JSValue::encode(jsString(vm, result.releaseReturnValue())));
}

JSC_DEFINE_HOST_FUNCTION(functionReportError,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    switch (callFrame->argumentCount()) {
    case 0: {
        return JSC::JSValue::encode(JSC::jsUndefined());
    }
    default: {
        Bun__reportError(globalObject, JSC::JSValue::encode(callFrame->argument(0)));
    }
    }

    return JSC::JSValue::encode(JSC::jsUndefined());
}

extern "C" JSC::EncodedJSValue ArrayBuffer__fromSharedMemfd(int64_t fd, JSC::JSGlobalObject* globalObject, size_t byteOffset, size_t byteLength, size_t totalLength, JSC::JSType type)
{

// Windows doesn't have mmap
// This code should pretty much only be called on Linux.
#if !OS(WINDOWS)
    // Empty makes the caller fall back to the copying path, which throws for this length.
    if (byteLength > MAX_ARRAY_BUFFER_SIZE) [[unlikely]] {
        return JSC::JSValue::encode(JSC::JSValue {});
    }

    auto ptr = mmap(nullptr, totalLength, PROT_READ | PROT_WRITE, MAP_PRIVATE, fd, 0);

    if (ptr == MAP_FAILED) {
        return JSC::JSValue::encode(JSC::JSValue {});
    }

    auto buffer = ArrayBuffer::createFromBytes({ reinterpret_cast<const uint8_t*>(reinterpret_cast<char*>(ptr) + byteOffset), byteLength }, createSharedTask<void(void*)>([ptr, totalLength](void* p) {
        munmap(ptr, totalLength);
    }));

    if (type == JSC::Uint8ArrayType) {
        auto uint8array = JSC::JSUint8Array::create(globalObject, globalObject->m_typedArrayUint8.get(globalObject), WTF::move(buffer), 0, byteLength);
        return JSValue::encode(uint8array);
    }

    if (type == JSC::ArrayBufferType) {

        Structure* structure = globalObject->arrayBufferStructure(JSC::ArrayBufferSharingMode::Default);

        if (!structure) [[unlikely]] {
            return JSC::JSValue::encode(JSC::JSValue {});
        }

        return JSValue::encode(JSC::JSArrayBuffer::create(globalObject->vm(), structure, WTF::move(buffer)));
    } else {
        RELEASE_ASSERT_NOT_REACHED();
    }
#else
    return JSC::JSValue::encode(JSC::JSValue {});
#endif
}

extern "C" JSC::EncodedJSValue Bun__createArrayBufferForCopy(JSC::JSGlobalObject* globalObject, const void* ptr, size_t len)
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    auto arrayBuffer = JSC::ArrayBuffer::tryCreateUninitialized(len, 1);

    if (!arrayBuffer) [[unlikely]] {
        JSC::throwOutOfMemoryError(globalObject, scope);
        return {};
    }

    if (len > 0)
        memcpy(arrayBuffer->data(), ptr, len);

    RELEASE_AND_RETURN(scope, JSValue::encode(JSC::JSArrayBuffer::create(globalObject->vm(), globalObject->arrayBufferStructure(JSC::ArrayBufferSharingMode::Default), WTF::move(arrayBuffer))));
}

extern "C" JSC::EncodedJSValue Bun__allocUint8ArrayForCopy(JSC::JSGlobalObject* globalObject, size_t len, void** ptr)
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());

    JSC::JSUint8Array* array = JSC::JSUint8Array::createUninitialized(globalObject, globalObject->m_typedArrayUint8.get(globalObject), len);
    RETURN_IF_EXCEPTION(scope, {});

    *ptr = array->vector();

    return JSValue::encode(array);
}

extern "C" JSC::EncodedJSValue Bun__allocArrayBufferForCopy(JSC::JSGlobalObject* lexicalGlobalObject, size_t len, void** ptr)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);

    auto* subclassStructure = globalObject->JSBufferSubclassStructure();
    auto buf = JSC::JSUint8Array::createUninitialized(lexicalGlobalObject, subclassStructure, len);
    RETURN_IF_EXCEPTION(scope, {});

    *ptr = buf->vector();

    return JSValue::encode(buf);
}

extern "C" JSC::EncodedJSValue Bun__createUint8ArrayForCopy(JSC::JSGlobalObject* globalObject, const void* ptr, size_t len, bool isBuffer)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* subclassStructure = isBuffer ? static_cast<Zig::GlobalObject*>(globalObject)->JSBufferSubclassStructure() : globalObject->typedArrayStructureWithTypedArrayType<TypeUint8>();
    JSC::JSUint8Array* array = JSC::JSUint8Array::createUninitialized(globalObject, subclassStructure, len);
    RETURN_IF_EXCEPTION(scope, {});

    if (len > 0 && ptr != nullptr)
        memcpy(array->vector(), ptr, len);

    RELEASE_AND_RETURN(scope, JSValue::encode(array));
}

extern "C" JSC::EncodedJSValue Bun__makeArrayBufferWithBytesNoCopy(JSC::JSGlobalObject* globalObject, const void* ptr, size_t len, JSTypedArrayBytesDeallocator deallocator, void* deallocatorContext)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (Bun::rejectBytesNoCopyAboveArrayBufferLimit(globalObject, scope, ptr, len, deallocator, deallocatorContext)) [[unlikely]]
        return {};

    auto buffer = ArrayBuffer::createFromBytes({ static_cast<const uint8_t*>(ptr), len }, createSharedTask<void(void*)>([=](void* p) {
        if (deallocator) deallocator(p, deallocatorContext);
    }));

    JSArrayBuffer* jsBuffer = JSArrayBuffer::create(vm, globalObject->arrayBufferStructure(ArrayBufferSharingMode::Default), WTF::move(buffer));
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(jsBuffer);
}

extern "C" JSC::EncodedJSValue Bun__makeTypedArrayWithBytesNoCopy(JSC::JSGlobalObject* globalObject, TypedArrayType ty, const void* ptr, size_t len, JSTypedArrayBytesDeallocator deallocator, void* deallocatorContext)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (Bun::rejectBytesNoCopyAboveArrayBufferLimit(globalObject, scope, ptr, len, deallocator, deallocatorContext)) [[unlikely]]
        return {};

    auto buffer_ = ArrayBuffer::createFromBytes({ static_cast<const uint8_t*>(ptr), len }, createSharedTask<void(void*)>([=](void* p) {
        if (deallocator) deallocator(p, deallocatorContext);
    }));
    RefPtr<ArrayBuffer>&& buffer = WTF::move(buffer_);
    if (!buffer) {
        throwOutOfMemoryError(globalObject, scope);
        return {};
    }

    unsigned elementByteSize = elementSize(ty);
    size_t offset = 0;
    size_t length = len / elementByteSize;
    bool isResizableOrGrowableShared = buffer->isResizableOrGrowableShared();

    switch (ty) {
#define JSC_TYPED_ARRAY_FACTORY(type) \
    case Type##type:                  \
        RELEASE_AND_RETURN(scope, JSValue::encode(JS##type##Array::create(globalObject, globalObject->typedArrayStructure(Type##type, isResizableOrGrowableShared), WTF::move(buffer), offset, length)));
#undef JSC_TYPED_ARRAY_CHECK
        FOR_EACH_TYPED_ARRAY_TYPE_EXCLUDING_DATA_VIEW(JSC_TYPED_ARRAY_FACTORY)
    case NotTypedArray:
    case TypeDataView:
        ASSERT_NOT_REACHED();
    }

    return {};
}

extern "C" JSC::EncodedJSValue Bun__createTypedArrayForCopy(JSC::JSGlobalObject* globalObject, TypedArrayType ty, const void* ptr, size_t byteLength)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    RefPtr<ArrayBuffer> buffer = ArrayBuffer::tryCreateUninitialized(byteLength, 1);
    if (!buffer) [[unlikely]] {
        throwOutOfMemoryError(globalObject, scope);
        return {};
    }
    if (byteLength > 0 && ptr != nullptr)
        memcpy(buffer->data(), ptr, byteLength);

    unsigned elementByteSize = elementSize(ty);
    size_t offset = 0;
    size_t length = byteLength / elementByteSize;
    bool isResizableOrGrowableShared = buffer->isResizableOrGrowableShared();

    switch (ty) {
#define JSC_TYPED_ARRAY_COPY_FACTORY(type) \
    case Type##type:                       \
        RELEASE_AND_RETURN(scope, JSValue::encode(JS##type##Array::create(globalObject, globalObject->typedArrayStructure(Type##type, isResizableOrGrowableShared), WTF::move(buffer), offset, length)));
        FOR_EACH_TYPED_ARRAY_TYPE_EXCLUDING_DATA_VIEW(JSC_TYPED_ARRAY_COPY_FACTORY)
#undef JSC_TYPED_ARRAY_COPY_FACTORY
    case NotTypedArray:
    case TypeDataView:
        ASSERT_NOT_REACHED();
    }

    return {};
}

JSC_DECLARE_HOST_FUNCTION(functionCreateUninitializedArrayBuffer);
JSC_DEFINE_HOST_FUNCTION(functionCreateUninitializedArrayBuffer,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    size_t len = static_cast<size_t>(JSC__JSValue__toInt64(JSC::JSValue::encode(callFrame->argument(0))));
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    auto arrayBuffer = JSC::ArrayBuffer::tryCreateUninitialized(len, 1);

    if (!arrayBuffer) [[unlikely]] {
        JSC::throwOutOfMemoryError(globalObject, scope);
        return {};
    }

    RELEASE_AND_RETURN(scope, JSValue::encode(JSC::JSArrayBuffer::create(globalObject->vm(), globalObject->arrayBufferStructure(JSC::ArrayBufferSharingMode::Default), WTF::move(arrayBuffer))));
}

static inline JSC::EncodedJSValue jsFunctionAddEventListenerBody(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame, Zig::GlobalObject* castedThis)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    UNUSED_PARAM(throwScope);
    UNUSED_PARAM(callFrame);
    auto& impl = castedThis->globalEventScope;
    if (callFrame->argumentCount() < 2) [[unlikely]]
        return throwVMError(lexicalGlobalObject, throwScope, createNotEnoughArgumentsError(lexicalGlobalObject));
    EnsureStillAliveScope argument0 = callFrame->uncheckedArgument(0);
    auto type = convert<IDLAtomStringAdaptor<IDLDOMString>>(*lexicalGlobalObject, argument0.value());
    RETURN_IF_EXCEPTION(throwScope, {});
    EnsureStillAliveScope argument1 = callFrame->uncheckedArgument(1);
    auto listener = convert<IDLNullable<IDLEventListener<JSEventListener>>>(*lexicalGlobalObject, argument1.value(), *castedThis, [](JSC::JSGlobalObject& lexicalGlobalObject, JSC::ThrowScope& scope) { throwArgumentMustBeObjectError(lexicalGlobalObject, scope, 1, "listener"_s, "EventTarget"_s, "addEventListener"_s); });
    RETURN_IF_EXCEPTION(throwScope, {});
    EnsureStillAliveScope argument2 = callFrame->argument(2);
    auto options = argument2.value().isUndefined() ? false : convert<IDLUnion<IDLDictionary<AddEventListenerOptions>, IDLBoolean>>(*lexicalGlobalObject, argument2.value());
    RETURN_IF_EXCEPTION(throwScope, {});
    auto result = JSValue::encode(WebCore::toJS<IDLUndefined>(*lexicalGlobalObject, throwScope, [&]() -> decltype(auto) { return impl->addEventListenerForBindings(WTF::move(type), WTF::move(listener), WTF::move(options)); }));
    RETURN_IF_EXCEPTION(throwScope, {});
    vm.writeBarrier(&static_cast<JSObject&>(*castedThis), argument1.value());
    return result;
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionAddEventListener, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    return jsFunctionAddEventListenerBody(lexicalGlobalObject, callFrame, dynamicDowncast<Zig::GlobalObject>(lexicalGlobalObject));
}

static inline JSC::EncodedJSValue jsFunctionRemoveEventListenerBody(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame, Zig::GlobalObject* castedThis)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    UNUSED_PARAM(throwScope);
    UNUSED_PARAM(callFrame);
    auto& impl = castedThis->globalEventScope;
    if (callFrame->argumentCount() < 2) [[unlikely]]
        return throwVMError(lexicalGlobalObject, throwScope, createNotEnoughArgumentsError(lexicalGlobalObject));
    EnsureStillAliveScope argument0 = callFrame->uncheckedArgument(0);
    auto type = convert<IDLAtomStringAdaptor<IDLDOMString>>(*lexicalGlobalObject, argument0.value());
    RETURN_IF_EXCEPTION(throwScope, {});
    EnsureStillAliveScope argument1 = callFrame->uncheckedArgument(1);
    auto listener = convert<IDLNullable<IDLEventListener<JSEventListener>>>(*lexicalGlobalObject, argument1.value(), *castedThis, [](JSC::JSGlobalObject& lexicalGlobalObject, JSC::ThrowScope& scope) { throwArgumentMustBeObjectError(lexicalGlobalObject, scope, 1, "listener"_s, "EventTarget"_s, "removeEventListener"_s); });
    RETURN_IF_EXCEPTION(throwScope, {});
    EnsureStillAliveScope argument2 = callFrame->argument(2);
    auto options = argument2.value().isUndefined() ? false : convert<IDLUnion<IDLDictionary<EventListenerOptions>, IDLBoolean>>(*lexicalGlobalObject, argument2.value());
    RETURN_IF_EXCEPTION(throwScope, {});
    auto result = JSValue::encode(WebCore::toJS<IDLUndefined>(*lexicalGlobalObject, throwScope, [&]() -> decltype(auto) { return impl->removeEventListenerForBindings(WTF::move(type), WTF::move(listener), WTF::move(options)); }));
    RETURN_IF_EXCEPTION(throwScope, {});
    vm.writeBarrier(&static_cast<JSObject&>(*castedThis), argument1.value());
    return result;
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionRemoveEventListener, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    return jsFunctionRemoveEventListenerBody(lexicalGlobalObject, callFrame, dynamicDowncast<Zig::GlobalObject>(lexicalGlobalObject));
}

static inline JSC::EncodedJSValue jsFunctionDispatchEventBody(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame, Zig::GlobalObject* castedThis)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    UNUSED_PARAM(throwScope);
    UNUSED_PARAM(callFrame);
    auto& impl = castedThis->globalEventScope;
    if (callFrame->argumentCount() < 1) [[unlikely]]
        return throwVMError(lexicalGlobalObject, throwScope, createNotEnoughArgumentsError(lexicalGlobalObject));
    EnsureStillAliveScope argument0 = callFrame->uncheckedArgument(0);
    auto event = convert<IDLInterface<Event>>(*lexicalGlobalObject, argument0.value(), [](JSC::JSGlobalObject& lexicalGlobalObject, JSC::ThrowScope& scope) { throwArgumentTypeError(lexicalGlobalObject, scope, 0, "event"_s, "EventTarget"_s, "dispatchEvent"_s, "Event"_s); });
    RETURN_IF_EXCEPTION(throwScope, {});
    RELEASE_AND_RETURN(throwScope, JSValue::encode(WebCore::toJS<IDLBoolean>(*lexicalGlobalObject, throwScope, impl->dispatchEventForBindings(*event))));
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionDispatchEvent, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    return jsFunctionDispatchEventBody(lexicalGlobalObject, callFrame, dynamicDowncast<Zig::GlobalObject>(lexicalGlobalObject));
}

JSC_DEFINE_CUSTOM_GETTER(getterSubtleCrypto, (JSGlobalObject * lexicalGlobalObject, EncodedJSValue thisValue, PropertyName attributeName))
{
    // Node brand-checks the receiver: Crypto.prototype.subtle on anything but
    // the crypto global throws ERR_INVALID_THIS. Resolve through
    // defaultGlobalObject so vm-context lexical globals still find the singleton.
    auto* global = defaultGlobalObject(lexicalGlobalObject);
    if (JSValue::decode(thisValue) != global->cryptoObject()) [[unlikely]] {
        auto& vm = JSC::getVM(lexicalGlobalObject);
        auto scope = DECLARE_THROW_SCOPE(vm);
        return Bun::throwError(lexicalGlobalObject, scope, Bun::ErrorCode::ERR_INVALID_THIS, "Value of \"this\" must be of type Crypto"_s);
    }
    return JSValue::encode(global->subtleCrypto());
}

extern "C" JSC::EncodedJSValue ExpectMatcherUtils_createSigleton(JSC::JSGlobalObject* lexicalGlobalObject);

// Do nothing.
// This is consistent with Node.js
// This makes libraries polyfilling `globalThis.crypto.subtle` not throw.
JSC_DEFINE_CUSTOM_SETTER(setterSubtleCrypto,
    (JSC::JSGlobalObject*, JSC::EncodedJSValue,
        JSC::EncodedJSValue, JSC::PropertyName))
{
    return true;
}

JSC_DEFINE_HOST_FUNCTION(functionNavigatorGetUserAgent, (JSC::JSGlobalObject * globalObject, JSC::CallFrame*))
{
    auto& vm = JSC::getVM(globalObject);
    return JSValue::encode(JSC::jsString(vm, WTF::String::fromUTF8(Bun__userAgent)));
}

JSC_DEFINE_HOST_FUNCTION(functionNavigatorGetPlatform, (JSC::JSGlobalObject * globalObject, JSC::CallFrame*))
{
    auto& vm = JSC::getVM(globalObject);
// https://developer.mozilla.org/en-US/docs/Web/API/Navigator/platform
// https://github.com/oven-sh/bun/issues/4588
#if OS(DARWIN)
    return JSValue::encode(JSC::jsString(vm, String("MacIntel"_s)));
#elif OS(WINDOWS)
    return JSValue::encode(JSC::jsString(vm, String("Win32"_s)));
#elif OS(LINUX)
    return JSValue::encode(JSC::jsString(vm, String("Linux x86_64"_s)));
#elif OS(FREEBSD)
#if CPU(ARM64)
    return JSValue::encode(JSC::jsString(vm, String("FreeBSD arm64"_s)));
#else
    return JSValue::encode(JSC::jsString(vm, String("FreeBSD amd64"_s)));
#endif
#else
    return JSValue::encode(JSC::jsEmptyString(vm));
#endif
}

JSC_DEFINE_HOST_FUNCTION(functionNavigatorGetHardwareConcurrency, (JSC::JSGlobalObject*, JSC::CallFrame*))
{
    return JSValue::encode(JSC::jsNumber(WTF::numberOfProcessorCores()));
}

JSC_DECLARE_HOST_FUNCTION(makeGetterTypeErrorForBuiltins);
JSC_DECLARE_HOST_FUNCTION(makeDOMExceptionForBuiltins);
JSC_DECLARE_HOST_FUNCTION(isAbortSignal);
JSC_DECLARE_HOST_FUNCTION(jsBunPeekPromiseStatus);
JSC_DECLARE_HOST_FUNCTION(jsBunPeekPromiseSettledValue);
JSC_DECLARE_HOST_FUNCTION(jsBunPokePromiseAsHandled);
JSC_DECLARE_HOST_FUNCTION(jsWebStreamClosedPromise);
JSC_DECLARE_HOST_FUNCTION(jsWebStreamControllerError);

JSC_DEFINE_HOST_FUNCTION(makeGetterTypeErrorForBuiltins, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    ASSERT(callFrame);
    ASSERT(callFrame->argumentCount() == 2);
    VM& vm = globalObject->vm();
    DeferTermination deferScope(vm);
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto interfaceName = callFrame->uncheckedArgument(0).getString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    auto attributeName = callFrame->uncheckedArgument(1).getString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    auto error = static_cast<ErrorInstance*>(createTypeError(globalObject, JSC::makeDOMAttributeGetterTypeErrorMessage(interfaceName.utf8().data(), attributeName)));
    error->setNativeGetterTypeError();
    return JSValue::encode(error);
}

JSC_DEFINE_HOST_FUNCTION(makeDOMExceptionForBuiltins, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    ASSERT(callFrame);
    ASSERT(callFrame->argumentCount() == 2);

    auto& vm = JSC::getVM(globalObject);
    DeferTermination deferScope(vm);
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto codeValue = callFrame->uncheckedArgument(0).getString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    auto message = callFrame->uncheckedArgument(1).getString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    ExceptionCode code { TypeError };
    if (codeValue == "AbortError"_s)
        code = AbortError;
    auto value = createDOMException(globalObject, code, message);

    EXCEPTION_ASSERT(!scope.exception() || vm.hasPendingTerminationException());

    return JSValue::encode(value);
}

JSC_DEFINE_HOST_FUNCTION(addAbortAlgorithmToSignal, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    ASSERT(callFrame);
    ASSERT(callFrame->argumentCount() == 2);

    auto& vm = JSC::getVM(globalObject);
    auto* abortSignal = dynamicDowncast<JSAbortSignal>(callFrame->uncheckedArgument(0));
    if (!abortSignal) [[unlikely]]
        return JSValue::encode(JSValue(JSC::JSValue::JSFalse));

    Ref<AbortAlgorithm> abortAlgorithm = JSAbortAlgorithm::create(vm, callFrame->uncheckedArgument(1).getObject());

    auto algorithmIdentifier = AbortSignal::addAbortAlgorithmToSignal(abortSignal->wrapped(), WTF::move(abortAlgorithm));
    return JSValue::encode(JSC::jsNumber(algorithmIdentifier));
}

JSC_DEFINE_HOST_FUNCTION(removeAbortAlgorithmFromSignal, (JSGlobalObject*, CallFrame* callFrame))
{
    ASSERT(callFrame);
    ASSERT(callFrame->argumentCount() == 2);

    auto* abortSignal = dynamicDowncast<JSAbortSignal>(callFrame->uncheckedArgument(0));
    if (!abortSignal) [[unlikely]]
        return JSValue::encode(JSValue(JSC::JSValue::JSFalse));

    AbortSignal::removeAbortAlgorithmFromSignal(abortSignal->wrapped(), callFrame->uncheckedArgument(1).asUInt32());
    return JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(isAbortSignal, (JSGlobalObject*, CallFrame* callFrame))
{
    ASSERT(callFrame->argumentCount() == 1);
    return JSValue::encode(jsBoolean(callFrame->uncheckedArgument(0).inherits<JSAbortSignal>()));
}

// JSPromise lost its JSInternalFieldObjectImpl<2> layout in WebKit, so the
// @getPromiseInternalField/@putPromiseInternalField bytecode intrinsics that
// our builtins relied on no longer exist. These helpers expose the equivalent
// reads/writes through the new CompactPointerTuple/m_slot representation.

static inline JSC::JSPromise* peekPromiseArgument(CallFrame* callFrame)
{
    ASSERT(callFrame->argumentCount() == 1);
    JSValue arg = callFrame->uncheckedArgument(0);
    if (!arg.inherits<JSC::JSPromise>()) [[unlikely]]
        return nullptr;
    return static_cast<JSC::JSPromise*>(arg.asCell());
}

JSC_DEFINE_HOST_FUNCTION(jsBunPeekPromiseStatus, (JSGlobalObject*, CallFrame* callFrame))
{
    auto* promise = peekPromiseArgument(callFrame);
    if (!promise) [[unlikely]]
        return JSValue::encode(jsNumber(0));
    return JSValue::encode(jsNumber(static_cast<unsigned>(promise->status())));
}

JSC_DEFINE_HOST_FUNCTION(jsBunPeekPromiseSettledValue, (JSGlobalObject*, CallFrame* callFrame))
{
    auto* promise = peekPromiseArgument(callFrame);
    if (!promise || promise->status() == JSC::JSPromise::Status::Pending) [[unlikely]]
        return JSValue::encode(jsUndefined());
    return JSValue::encode(promise->result());
}

JSC_DEFINE_HOST_FUNCTION(jsBunPokePromiseAsHandled, (JSGlobalObject*, CallFrame* callFrame))
{
    if (auto* promise = peekPromiseArgument(callFrame))
        promise->markAsHandled();
    return JSValue::encode(jsUndefined());
}

// node:stream's finished() needs a promise that settles when a WHATWG stream reaches a terminal
// state, without locking it. Callers in internal/streams/end-of-stream.ts gate on
// isReadableStream()/isWritableStream() first, so the argument is always one of the two.
JSC_DEFINE_HOST_FUNCTION(jsWebStreamClosedPromise, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    JSValue streamValue = callFrame->argument(0);
    if (auto* readable = dynamicDowncast<WebCore::JSReadableStream>(streamValue))
        return JSValue::encode(Bun::WebStreams::webStreamClosedPromise(globalObject, readable));
    if (auto* writable = dynamicDowncast<WebCore::JSWritableStream>(streamValue))
        return JSValue::encode(Bun::WebStreams::webStreamClosedPromise(globalObject, writable));

    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    return JSValue::encode(throwTypeError(globalObject, scope, "Expected a ReadableStream or WritableStream"_s));
}

// node:stream's addAbortSignal() errors a WHATWG stream when the signal fires. Its isWebStream()
// gate also admits TransformStream, which has no controller to error — node throws there too (it
// never sets kControllerErrorFunction on one), so the throw below is reachable, not dead code.
JSC_DEFINE_HOST_FUNCTION(jsWebStreamControllerError, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    JSValue streamValue = callFrame->argument(0);
    JSValue error = callFrame->argument(1);
    if (auto* readable = dynamicDowncast<WebCore::JSReadableStream>(streamValue)) {
        Bun::WebStreams::webStreamControllerError(globalObject, readable, error);
        RETURN_IF_EXCEPTION(scope, {});
        return JSValue::encode(jsUndefined());
    }
    if (auto* writable = dynamicDowncast<WebCore::JSWritableStream>(streamValue)) {
        Bun::WebStreams::webStreamControllerError(globalObject, writable, error);
        RETURN_IF_EXCEPTION(scope, {});
        return JSValue::encode(jsUndefined());
    }
    return JSValue::encode(throwTypeError(globalObject, scope, "Expected a ReadableStream or WritableStream"_s));
}

extern "C" JSC::EncodedJSValue Bun__Jest__createTestModuleObject(JSC::JSGlobalObject*);
extern "C" JSC::EncodedJSValue Bun__Jest__testModuleObject(Zig::GlobalObject* globalObject)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSC::JSObject* object = globalObject->lazyTestModuleObject();
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(object);
}

extern "C" napi_env ZigGlobalObject__makeNapiEnvForFFI(Zig::GlobalObject* globalObject)
{
    return globalObject->makeNapiEnvForFFI();
}

extern "C" JSC::EncodedJSValue ZigGlobalObject__processEnvObject(Zig::GlobalObject* globalObject)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSC::JSObject* object = globalObject->processEnvObject();
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(object);
}

extern "C" JSC::EncodedJSValue CryptoObject__create(JSGlobalObject*);
JSC_DEFINE_CUSTOM_GETTER(moduleNamespacePrototypeGetESModuleMarker, (JSGlobalObject * globalObject, JSC::EncodedJSValue encodedThisValue, PropertyName))
{
    JSValue thisValue = JSValue::decode(encodedThisValue);
    JSModuleNamespaceObject* moduleNamespaceObject = dynamicDowncast<JSModuleNamespaceObject>(thisValue);
    if (!moduleNamespaceObject || moduleNamespaceObject->m_hasESModuleMarker != WTF::TriState::True) {
        return JSC::JSValue::encode(jsUndefined());
    }

    return JSC::JSValue::encode(jsBoolean(true));
}

JSC_DEFINE_CUSTOM_SETTER(moduleNamespacePrototypeSetESModuleMarker, (JSGlobalObject * globalObject, JSC::EncodedJSValue encodedThisValue, JSC::EncodedJSValue encodedValue, PropertyName))
{
    auto& vm = JSC::getVM(globalObject);
    JSValue thisValue = JSValue::decode(encodedThisValue);
    JSModuleNamespaceObject* moduleNamespaceObject = dynamicDowncast<JSModuleNamespaceObject>(thisValue);
    if (!moduleNamespaceObject) {
        return false;
    }
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue value = JSValue::decode(encodedValue);
    WTF::TriState triState = value.toBoolean(globalObject) ? WTF::TriState::True : WTF::TriState::False;
    moduleNamespaceObject->m_hasESModuleMarker = triState;
    return true;
}

namespace {

template<typename T> struct LazyPropertyInit {
    size_t offset;
    void (*init)(const typename LazyProperty<JSGlobalObject, T>::Initializer&);
};

struct LazyClassStructureInit {
    size_t offset;
    void (*init)(LazyClassStructure::Initializer&);
};

// The table entry for the lazy member at `member`. The owner a caller passed to
// `get()` is normally the GlobalObject holding the member, but some sites pass
// another realm's global and reach the holder via `defaultGlobalObject()`, so
// try both.
template<const auto& table>
const auto& lazyTableEntry(const void* member, JSGlobalObject* owner)
{
    for (JSGlobalObject* candidate : { owner, static_cast<JSGlobalObject*>(defaultGlobalObject(owner)) }) {
        if (auto* holder = dynamicDowncast<GlobalObject>(candidate)) {
            size_t offset = reinterpret_cast<const uint8_t*>(member) - reinterpret_cast<const uint8_t*>(holder);
            if (offset < sizeof(GlobalObject)) {
                for (auto& entry : table) {
                    if (entry.offset == offset)
                        return entry;
                }
            }
        }
    }
    RELEASE_ASSERT_NOT_REACHED_WITH_MESSAGE("lazy GlobalObject member initialised through an unrelated global object");
}

// One `LazyProperty::callFunc` instantiation per table instead of one per
// member: the shared initializer finds its entry by the member's offset.
template<typename T, const auto& table>
void initLazyProperties(GlobalObject* globalObject)
{
    for (auto& entry : table) {
        auto& property = *reinterpret_cast<LazyProperty<JSGlobalObject, T>*>(reinterpret_cast<uint8_t*>(globalObject) + entry.offset);
        property.initLater([](const typename LazyProperty<JSGlobalObject, T>::Initializer& init) {
            lazyTableEntry<table>(&init.property, init.owner).init(init);
        });
    }
}

template<const auto& table>
void initLazyClassStructures(GlobalObject* globalObject)
{
    for (auto& entry : table) {
        auto& classStructure = *reinterpret_cast<LazyClassStructure*>(reinterpret_cast<uint8_t*>(globalObject) + entry.offset);
        classStructure.initLater([](LazyClassStructure::Initializer& init) {
            lazyTableEntry<table>(&init.classStructure, init.global).init(init);
        });
    }
}

} // namespace

void GlobalObject::finishCreation(VM& vm)
{
    // Node.js defaults to 10. Must run before Base::finishCreation() materializes
    // errorConstructor(), which snapshots this value into Error.stackTraceLimit.
    setStackTraceLimit(DEFAULT_ERROR_STACK_TRACE_LIMIT);

    Base::finishCreation(vm);
    ASSERT(inherits(info()));

    m_bakeAdditions.initialize();
    m_markdownTagStrings.initialize();

    static const LazyClassStructureInit lazyClassStructureInits[] = {
        { OBJECT_OFFSETOF(GlobalObject, m_JSDirentClassStructure), [](LazyClassStructure::Initializer& init) {
             Bun::initJSDirentClassStructure(init);
         } },
        { OBJECT_OFFSETOF(GlobalObject, m_JSX509CertificateClassStructure), [](LazyClassStructure::Initializer& init) {
             setupX509CertificateClassStructure(init);
         } },
        { OBJECT_OFFSETOF(GlobalObject, m_JSWebViewClassStructure), [](LazyClassStructure::Initializer& init) {
             Bun::setupJSWebViewClassStructure(init);
         } },
        { OBJECT_OFFSETOF(GlobalObject, m_JSSignClassStructure), [](LazyClassStructure::Initializer& init) {
             setupJSSignClassStructure(init);
         } },
        { OBJECT_OFFSETOF(GlobalObject, m_JSVerifyClassStructure), [](LazyClassStructure::Initializer& init) {
             setupJSVerifyClassStructure(init);
         } },
        { OBJECT_OFFSETOF(GlobalObject, m_JSDiffieHellmanClassStructure), [](LazyClassStructure::Initializer& init) {
             Bun::setupDiffieHellmanClassStructure(init);
         } },
        { OBJECT_OFFSETOF(GlobalObject, m_JSDiffieHellmanGroupClassStructure), [](LazyClassStructure::Initializer& init) {
             Bun::setupDiffieHellmanGroupClassStructure(init);
         } },
        { OBJECT_OFFSETOF(GlobalObject, m_JSECDHClassStructure), [](LazyClassStructure::Initializer& init) {
             Bun::setupECDHClassStructure(init);
         } },
        { OBJECT_OFFSETOF(GlobalObject, m_JSHmacClassStructure), [](LazyClassStructure::Initializer& init) {
             setupJSHmacClassStructure(init);
         } },
        { OBJECT_OFFSETOF(GlobalObject, m_JSHashClassStructure), [](LazyClassStructure::Initializer& init) {
             setupJSHashClassStructure(init);
         } },
        { OBJECT_OFFSETOF(GlobalObject, m_JSCipherClassStructure), [](LazyClassStructure::Initializer& init) {
             setupCipherClassStructure(init);
         } },
        { OBJECT_OFFSETOF(GlobalObject, m_JSKeyObjectClassStructure), [](LazyClassStructure::Initializer& init) {
             setupKeyObjectClassStructure(init);
         } },
        { OBJECT_OFFSETOF(GlobalObject, m_JSSecretKeyObjectClassStructure), [](LazyClassStructure::Initializer& init) {
             setupSecretKeyObjectClassStructure(init);
         } },
        { OBJECT_OFFSETOF(GlobalObject, m_JSPublicKeyObjectClassStructure), [](LazyClassStructure::Initializer& init) {
             setupPublicKeyObjectClassStructure(init);
         } },
        { OBJECT_OFFSETOF(GlobalObject, m_JSPrivateKeyObjectClassStructure), [](LazyClassStructure::Initializer& init) {
             setupPrivateKeyObjectClassStructure(init);
         } },
        { OBJECT_OFFSETOF(GlobalObject, m_JSMIMEParamsClassStructure), [](LazyClassStructure::Initializer& init) {
             WebCore::setupJSMIMEParamsClassStructure(init);
         } },
        { OBJECT_OFFSETOF(GlobalObject, m_JSMIMETypeClassStructure), [](LazyClassStructure::Initializer& init) {
             WebCore::setupJSMIMETypeClassStructure(init);
         } },
        { OBJECT_OFFSETOF(GlobalObject, m_JSConnectionsListClassStructure), [](LazyClassStructure::Initializer& init) {
             setupConnectionsListClassStructure(init);
         } },
        { OBJECT_OFFSETOF(GlobalObject, m_JSHTTPParserClassStructure), [](LazyClassStructure::Initializer& init) {
             setupHTTPParserClassStructure(init);
         } },
        { OBJECT_OFFSETOF(GlobalObject, m_JSNodePerformanceHooksHistogramClassStructure), [](LazyClassStructure::Initializer& init) {
             Bun::setupJSNodePerformanceHooksHistogramClassStructure(init);
         } },
        { OBJECT_OFFSETOF(GlobalObject, m_JSStatsClassStructure), [](LazyClassStructure::Initializer& init) {
             Bun::initJSStatsClassStructure(init);
         } },
        { OBJECT_OFFSETOF(GlobalObject, m_JSStatsBigIntClassStructure), [](LazyClassStructure::Initializer& init) {
             Bun::initJSBigIntStatsClassStructure(init);
         } },
        { OBJECT_OFFSETOF(GlobalObject, m_JSStatFSClassStructure), [](LazyClassStructure::Initializer& init) {
             Bun::initJSStatFSClassStructure(init);
         } },
        { OBJECT_OFFSETOF(GlobalObject, m_JSStatFSBigIntClassStructure), [](LazyClassStructure::Initializer& init) {
             Bun::initJSBigIntStatFSClassStructure(init);
         } },
        { OBJECT_OFFSETOF(GlobalObject, m_NapiClassStructure), [](LazyClassStructure::Initializer& init) {
             init.setStructure(Zig::NapiClass::createStructure(init.vm, init.global, init.global->functionPrototype()));
         } },
        { OBJECT_OFFSETOF(GlobalObject, m_JSFileSinkClassStructure), [](LazyClassStructure::Initializer& init) {
             auto* prototype = createJSSinkPrototype(init.vm, init.global, WebCore::SinkID::FileSink);
             auto* structure = JSFileSink::createStructure(init.vm, init.global, prototype);
             auto* constructor = JSFileSinkConstructor::create(init.vm, init.global, JSFileSinkConstructor::createStructure(init.vm, init.global, init.global->functionPrototype()), prototype);
             init.setPrototype(prototype);
             init.setStructure(structure);
             init.setConstructor(constructor);
         } },
        { OBJECT_OFFSETOF(GlobalObject, m_JSArrayBufferSinkClassStructure), [](LazyClassStructure::Initializer& init) {
             auto* prototype = createJSSinkPrototype(init.vm, init.global, WebCore::SinkID::ArrayBufferSink);
             auto* structure = JSArrayBufferSink::createStructure(init.vm, init.global, prototype);
             auto* constructor = JSArrayBufferSinkConstructor::create(init.vm, init.global, JSArrayBufferSinkConstructor::createStructure(init.vm, init.global, init.global->functionPrototype()), prototype);
             init.setPrototype(prototype);
             init.setStructure(structure);
             init.setConstructor(constructor);
         } },
        { OBJECT_OFFSETOF(GlobalObject, m_JSHTTPResponseSinkClassStructure), [](LazyClassStructure::Initializer& init) {
             auto* prototype = createJSSinkPrototype(init.vm, init.global, WebCore::SinkID::HTTPResponseSink);
             auto* structure = JSHTTPResponseSink::createStructure(init.vm, init.global, prototype);
             auto* constructor = JSHTTPResponseSinkConstructor::create(init.vm, init.global, JSHTTPResponseSinkConstructor::createStructure(init.vm, init.global, init.global->functionPrototype()), prototype);
             init.setPrototype(prototype);
             init.setStructure(structure);
             init.setConstructor(constructor);
         } },
        { OBJECT_OFFSETOF(GlobalObject, m_JSNetworkSinkClassStructure), [](LazyClassStructure::Initializer& init) {
             auto* prototype = createJSSinkPrototype(init.vm, init.global, WebCore::SinkID::NetworkSink);
             auto* structure = JSNetworkSink::createStructure(init.vm, init.global, prototype);
             auto* constructor = JSNetworkSinkConstructor::create(init.vm, init.global, JSNetworkSinkConstructor::createStructure(init.vm, init.global, init.global->functionPrototype()), prototype);
             init.setPrototype(prototype);
             init.setStructure(structure);
             init.setConstructor(constructor);
         } },
        { OBJECT_OFFSETOF(GlobalObject, m_JSFetchRequestBodySinkClassStructure), [](LazyClassStructure::Initializer& init) {
             auto* prototype = createJSSinkPrototype(init.vm, init.global, WebCore::SinkID::FetchRequestBodySink);
             auto* structure = JSFetchRequestBodySink::createStructure(init.vm, init.global, prototype);
             auto* constructor = JSFetchRequestBodySinkConstructor::create(init.vm, init.global, JSFetchRequestBodySinkConstructor::createStructure(init.vm, init.global, init.global->functionPrototype()), prototype);
             init.setPrototype(prototype);
             init.setStructure(structure);
             init.setConstructor(constructor);
         } },
        { OBJECT_OFFSETOF(GlobalObject, m_JSHTMLRewriterSinkClassStructure), [](LazyClassStructure::Initializer& init) {
             auto* prototype = createJSSinkPrototype(init.vm, init.global, WebCore::SinkID::HTMLRewriterSink);
             auto* structure = JSHTMLRewriterSink::createStructure(init.vm, init.global, prototype);
             auto* constructor = JSHTMLRewriterSinkConstructor::create(init.vm, init.global, JSHTMLRewriterSinkConstructor::createStructure(init.vm, init.global, init.global->functionPrototype()), prototype);
             init.setPrototype(prototype);
             init.setStructure(structure);
             init.setConstructor(constructor);
         } },
        { OBJECT_OFFSETOF(GlobalObject, m_JSBufferClassStructure), [](LazyClassStructure::Initializer& init) {
             auto* prototype = WebCore::createBufferPrototype(init.vm, init.global);
             auto* structure = WebCore::createBufferStructure(init.vm, init.global, JSValue(prototype));
             auto* constructor = WebCore::createBufferConstructor(init.vm, init.global, prototype);
             init.setPrototype(prototype);
             init.setStructure(structure);
             init.setConstructor(constructor);
         } },
        { OBJECT_OFFSETOF(GlobalObject, m_JSHTTPSResponseSinkClassStructure), [](LazyClassStructure::Initializer& init) {
             auto* prototype = createJSSinkPrototype(init.vm, init.global, WebCore::SinkID::HTTPSResponseSink);
             auto* structure = JSHTTPSResponseSink::createStructure(init.vm, init.global, prototype);
             auto* constructor = JSHTTPSResponseSinkConstructor::create(init.vm, init.global, JSHTTPSResponseSinkConstructor::createStructure(init.vm, init.global, init.global->functionPrototype()), prototype);
             init.setPrototype(prototype);
             init.setStructure(structure);
             init.setConstructor(constructor);
         } },
        { OBJECT_OFFSETOF(GlobalObject, m_callSiteStructure), [](LazyClassStructure::Initializer& init) {
             auto* prototype = CallSitePrototype::create(init.vm, CallSitePrototype::createStructure(init.vm, init.global, init.global->objectPrototype()), init.global);
             auto* structure = CallSite::createStructure(init.vm, init.global, prototype);
             init.setPrototype(prototype);
             init.setStructure(structure);
         } },
        { OBJECT_OFFSETOF(GlobalObject, m_JSStringDecoderClassStructure), [](LazyClassStructure::Initializer& init) {
             auto* prototype = JSStringDecoderPrototype::create(
                 init.vm, init.global, JSStringDecoderPrototype::createStructure(init.vm, init.global, init.global->objectPrototype()));
             auto* structure = JSStringDecoder::createStructure(init.vm, init.global, prototype);
             auto* constructor = JSStringDecoderConstructor::create(
                 init.vm, init.global, JSStringDecoderConstructor::createStructure(init.vm, init.global, init.global->functionPrototype()), prototype);
             init.setPrototype(prototype);
             init.setStructure(structure);
             init.setConstructor(constructor);
         } },
        { OBJECT_OFFSETOF(GlobalObject, m_JSDatabaseSyncClassStructure), [](LazyClassStructure::Initializer& init) {
             auto* prototype = Bun::JSDatabaseSyncPrototype::create(
                 init.vm, init.global, Bun::JSDatabaseSyncPrototype::createStructure(init.vm, init.global, init.global->objectPrototype()));
             auto* structure = Bun::JSDatabaseSync::createStructure(init.vm, init.global, prototype);
             auto* constructor = Bun::JSDatabaseSyncConstructor::create(
                 init.vm, init.global, Bun::JSDatabaseSyncConstructor::createStructure(init.vm, init.global, init.global->functionPrototype()), prototype);
             init.setPrototype(prototype);
             init.setStructure(structure);
             init.setConstructor(constructor);
         } },
        { OBJECT_OFFSETOF(GlobalObject, m_JSStatementSyncClassStructure), [](LazyClassStructure::Initializer& init) {
             auto* prototype = Bun::JSStatementSyncPrototype::create(
                 init.vm, init.global, Bun::JSStatementSyncPrototype::createStructure(init.vm, init.global, init.global->objectPrototype()));
             auto* structure = Bun::JSStatementSync::createStructure(init.vm, init.global, prototype);
             auto* constructor = Bun::JSStatementSyncConstructor::create(
                 init.vm, init.global, Bun::JSStatementSyncConstructor::createStructure(init.vm, init.global, init.global->functionPrototype()), prototype);
             init.setPrototype(prototype);
             init.setStructure(structure);
             init.setConstructor(constructor);
         } },
        { OBJECT_OFFSETOF(GlobalObject, m_JSStatementSyncIteratorClassStructure), [](LazyClassStructure::Initializer& init) {
             // Prototype chain: instance → iterator prototype → %IteratorPrototype%
             // so for-of / spread / Iterator helpers all work out of the box.
             auto* prototype = Bun::JSStatementSyncIteratorPrototype::create(
                 init.vm, init.global, Bun::JSStatementSyncIteratorPrototype::createStructure(init.vm, init.global, init.global->iteratorPrototype()));
             auto* structure = Bun::JSStatementSyncIterator::createStructure(init.vm, init.global, prototype);
             init.setPrototype(prototype);
             init.setStructure(structure);
         } },
        { OBJECT_OFFSETOF(GlobalObject, m_JSNodeSqliteSessionClassStructure), [](LazyClassStructure::Initializer& init) {
             auto* prototype = Bun::JSNodeSqliteSessionPrototype::create(
                 init.vm, init.global, Bun::JSNodeSqliteSessionPrototype::createStructure(init.vm, init.global, init.global->objectPrototype()));
             auto* structure = Bun::JSNodeSqliteSession::createStructure(init.vm, init.global, prototype);
             auto* constructor = Bun::JSNodeSqliteSessionConstructor::create(
                 init.vm, init.global, Bun::JSNodeSqliteSessionConstructor::createStructure(init.vm, init.global, init.global->functionPrototype()), prototype);
             init.setPrototype(prototype);
             init.setStructure(structure);
             init.setConstructor(constructor);
         } },
        { OBJECT_OFFSETOF(GlobalObject, m_JSNodeSqliteLimitsClassStructure), [](LazyClassStructure::Initializer& init) {
             // Node's DatabaseSyncLimits is a V8 ObjectTemplate: instances get a
             // per-template prototype whose own [[Prototype]] is Object.prototype.
             // Match the observable chain (limits → {} → Object.prototype).
             auto* prototype = JSC::constructEmptyObject(init.global, init.global->objectPrototype());
             auto* structure = Bun::JSNodeSqliteLimits::createStructure(init.vm, init.global, prototype);
             init.setPrototype(prototype);
             init.setStructure(structure);
         } },
        { OBJECT_OFFSETOF(GlobalObject, m_JSNodeSqliteTagStoreClassStructure), [](LazyClassStructure::Initializer& init) {
             auto* prototype = Bun::JSNodeSqliteTagStorePrototype::create(
                 init.vm, init.global, Bun::JSNodeSqliteTagStorePrototype::createStructure(init.vm, init.global, init.global->objectPrototype()));
             auto* structure = Bun::JSNodeSqliteTagStore::createStructure(init.vm, init.global, prototype);
             auto* constructor = Bun::JSNodeSqliteTagStoreConstructor::create(
                 init.vm, init.global, Bun::JSNodeSqliteTagStoreConstructor::createStructure(init.vm, init.global, init.global->functionPrototype()), prototype);
             init.setPrototype(prototype);
             init.setStructure(structure);
             init.setConstructor(constructor);
         } },
        { OBJECT_OFFSETOF(GlobalObject, m_JSFFIFunctionStructure), [](LazyClassStructure::Initializer& init) {
             init.setStructure(Zig::JSFFIFunction::createStructure(init.vm, init.global, init.global->functionPrototype()));
         } },
    };

    static const LazyPropertyInit<Structure> lazyStructureInits[] = {
        { OBJECT_OFFSETOF(GlobalObject, m_JSNodeHTTPServerSocketStructure), [](const LazyProperty<JSGlobalObject, Structure>::Initializer& init) {
             init.set(Bun::createNodeHTTPServerSocketStructure(init.vm, init.owner));
         } },
        { OBJECT_OFFSETOF(GlobalObject, m_JSS3FileStructure), [](const LazyProperty<JSGlobalObject, Structure>::Initializer& init) {
             init.set(Bun::createJSS3FileStructure(init.vm, init.owner));
         } },
        { OBJECT_OFFSETOF(GlobalObject, m_S3ErrorStructure), [](const LazyProperty<JSGlobalObject, Structure>::Initializer& init) {
             init.set(Bun::createS3ErrorStructure(init.vm, init.owner));
         } },
        { OBJECT_OFFSETOF(GlobalObject, m_commonJSModuleObjectStructure), [](const LazyProperty<JSGlobalObject, Structure>::Initializer& init) {
             init.set(Bun::createCommonJSModuleStructure(static_cast<Zig::GlobalObject*>(init.owner)));
         } },
        { OBJECT_OFFSETOF(GlobalObject, m_JSSocketAddressDTOStructure), [](const LazyProperty<JSGlobalObject, Structure>::Initializer& init) {
             init.set(Bun::JSSocketAddressDTO::createStructure(init.vm, init.owner));
         } },
        { OBJECT_OFFSETOF(GlobalObject, m_JSReactElementStructure), [](const LazyProperty<JSGlobalObject, Structure>::Initializer& init) {
             init.set(Bun::JSReactElement::createStructure(init.vm, init.owner));
         } },
        { OBJECT_OFFSETOF(GlobalObject, m_JSMarkdownListItemMetaStructure), [](const LazyProperty<JSGlobalObject, Structure>::Initializer& init) {
             init.set(Bun::MarkdownMeta::createListItemMetaStructure(init.vm, init.owner));
         } },
        { OBJECT_OFFSETOF(GlobalObject, m_JSMarkdownListMetaStructure), [](const LazyProperty<JSGlobalObject, Structure>::Initializer& init) {
             init.set(Bun::MarkdownMeta::createListMetaStructure(init.vm, init.owner));
         } },
        { OBJECT_OFFSETOF(GlobalObject, m_JSMarkdownCellMetaStructure), [](const LazyProperty<JSGlobalObject, Structure>::Initializer& init) {
             init.set(Bun::MarkdownMeta::createCellMetaStructure(init.vm, init.owner));
         } },
        { OBJECT_OFFSETOF(GlobalObject, m_JSMarkdownLinkMetaStructure), [](const LazyProperty<JSGlobalObject, Structure>::Initializer& init) {
             init.set(Bun::MarkdownMeta::createLinkMetaStructure(init.vm, init.owner));
         } },
        { OBJECT_OFFSETOF(GlobalObject, m_JSSQLStatementStructure), [](const LazyProperty<JSGlobalObject, Structure>::Initializer& init) {
             init.set(WebCore::createJSSQLStatementStructure(init.owner));
         } },
        { OBJECT_OFFSETOF(GlobalObject, m_memoryFootprintStructure), [](const LazyProperty<JSGlobalObject, Structure>::Initializer& init) {
             init.set(
                 createMemoryFootprintStructure(
                     init.vm, static_cast<Zig::GlobalObject*>(init.owner)));
         } },
        { OBJECT_OFFSETOF(GlobalObject, m_moduleNamespaceObjectStructure), [](const LazyProperty<JSGlobalObject, Structure>::Initializer& init) {
             JSObject* moduleNamespacePrototype = JSC::constructEmptyObject(init.vm, init.owner->nullPrototypeObjectStructure());
             moduleNamespacePrototype->putDirectCustomAccessor(init.vm, init.vm.propertyNames->__esModule, CustomGetterSetter::create(init.vm, moduleNamespacePrototypeGetESModuleMarker, moduleNamespacePrototypeSetESModuleMarker), PropertyAttribute::DontEnum | PropertyAttribute::DontDelete | PropertyAttribute::CustomAccessor | 0);
             init.set(JSModuleNamespaceObject::createStructure(init.vm, init.owner, moduleNamespacePrototype));
         } },
        { OBJECT_OFFSETOF(GlobalObject, m_JSBufferSubclassStructure), [](const LazyProperty<JSGlobalObject, Structure>::Initializer& init) {
             auto scope = DECLARE_TOP_EXCEPTION_SCOPE(init.vm);
             auto* globalObject = static_cast<Zig::GlobalObject*>(init.owner);
             auto* baseStructure = globalObject->typedArrayStructureWithTypedArrayType<JSC::TypeUint8>();
             JSC::Structure* subclassStructure = JSC::InternalFunction::createSubclassStructure(globalObject, globalObject->JSBufferConstructor(), baseStructure);
             scope.assertNoExceptionExceptTermination();
             init.set(subclassStructure);
         } },
        { OBJECT_OFFSETOF(GlobalObject, m_JSResizableOrGrowableSharedBufferSubclassStructure), [](const LazyProperty<JSGlobalObject, Structure>::Initializer& init) {
             auto scope = DECLARE_TOP_EXCEPTION_SCOPE(init.vm);
             auto* globalObject = static_cast<Zig::GlobalObject*>(init.owner);
             auto* baseStructure = globalObject->resizableOrGrowableSharedTypedArrayStructureWithTypedArrayType<JSC::TypeUint8>();
             JSC::Structure* subclassStructure = JSC::InternalFunction::createSubclassStructure(globalObject, globalObject->JSBufferConstructor(), baseStructure);
             scope.assertNoExceptionExceptTermination();
             init.set(subclassStructure);
         } },
        { OBJECT_OFFSETOF(GlobalObject, m_utilInspectOptionsStructure), [](const LazyProperty<JSGlobalObject, Structure>::Initializer& init) {
             init.set(Bun::createUtilInspectOptionsStructure(init.vm, init.owner));
         } },
        { OBJECT_OFFSETOF(GlobalObject, m_jsonlParseResultStructure), [](const LazyProperty<JSGlobalObject, Structure>::Initializer& init) {
             // { values, read, done, error } — 4 properties at fixed offsets for fast allocation
             Structure* structure = init.owner->structureCache().emptyObjectStructureForPrototype(init.owner, init.owner->objectPrototype(), 4);
             PropertyOffset offset;
             structure = Structure::addPropertyTransition(init.vm, structure, Identifier::fromString(init.vm, "values"_s), 0, offset);
             RELEASE_ASSERT(offset == 0);
             structure = Structure::addPropertyTransition(init.vm, structure, Identifier::fromString(init.vm, "read"_s), 0, offset);
             RELEASE_ASSERT(offset == 1);
             structure = Structure::addPropertyTransition(init.vm, structure, Identifier::fromString(init.vm, "done"_s), 0, offset);
             RELEASE_ASSERT(offset == 2);
             structure = Structure::addPropertyTransition(init.vm, structure, Identifier::fromString(init.vm, "error"_s), 0, offset);
             RELEASE_ASSERT(offset == 3);
             init.set(structure);
         } },
        { OBJECT_OFFSETOF(GlobalObject, m_pathParsedObjectStructure), [](const LazyProperty<JSGlobalObject, Structure>::Initializer& init) {
             // { root, dir, base, ext, name } — path.parse() result
             Structure* structure = init.owner->structureCache().emptyObjectStructureForPrototype(
                 init.owner, init.owner->objectPrototype(), 5);
             PropertyOffset offset;
             structure = Structure::addPropertyTransition(init.vm, structure,
                 Identifier::fromString(init.vm, "root"_s), 0, offset);
             RELEASE_ASSERT(offset == 0);
             structure = Structure::addPropertyTransition(init.vm, structure,
                 Identifier::fromString(init.vm, "dir"_s), 0, offset);
             RELEASE_ASSERT(offset == 1);
             structure = Structure::addPropertyTransition(init.vm, structure,
                 Identifier::fromString(init.vm, "base"_s), 0, offset);
             RELEASE_ASSERT(offset == 2);
             structure = Structure::addPropertyTransition(init.vm, structure,
                 Identifier::fromString(init.vm, "ext"_s), 0, offset);
             RELEASE_ASSERT(offset == 3);
             structure = Structure::addPropertyTransition(init.vm, structure,
                 init.vm.propertyNames->name, 0, offset);
             RELEASE_ASSERT(offset == 4);
             init.set(structure);
         } },
        { OBJECT_OFFSETOF(GlobalObject, m_pendingVirtualModuleResultStructure), [](const LazyProperty<JSGlobalObject, Structure>::Initializer& init) {
             init.set(Bun::PendingVirtualModuleResult::createStructure(init.vm, init.owner, init.owner->objectPrototype()));
         } },
        { OBJECT_OFFSETOF(GlobalObject, m_JSSocketHandlersStructure), [](const LazyProperty<JSGlobalObject, Structure>::Initializer& init) {
             init.set(Bun::JSSocketHandlers::createStructure(init.vm, init.owner, JSC::jsNull()));
         } },
        { OBJECT_OFFSETOF(GlobalObject, m_NapiExternalStructure), [](const LazyProperty<JSGlobalObject, Structure>::Initializer& init) {
             init.set(
                 Bun::NapiExternal::createStructure(init.vm, init.owner, init.owner->objectPrototype()));
         } },
        { OBJECT_OFFSETOF(GlobalObject, m_NapiPrototypeStructure), [](const LazyProperty<JSGlobalObject, Structure>::Initializer& init) {
             init.set(
                 Bun::NapiPrototype::createStructure(init.vm, init.owner, init.owner->objectPrototype()));
         } },
        { OBJECT_OFFSETOF(GlobalObject, m_ServerRouteListStructure), [](const LazyProperty<JSGlobalObject, Structure>::Initializer& init) {
             init.set(Bun::createServerRouteListStructure(init.vm, static_cast<Zig::GlobalObject*>(init.owner)));
         } },
        { OBJECT_OFFSETOF(GlobalObject, m_JSBunRequestStructure), [](const LazyProperty<JSGlobalObject, Structure>::Initializer& init) {
             init.set(Bun::createJSBunRequestStructure(init.vm, static_cast<Zig::GlobalObject*>(init.owner)));
         } },
        { OBJECT_OFFSETOF(GlobalObject, m_NapiHandleScopeImplStructure), [](const LazyProperty<JSGlobalObject, Structure>::Initializer& init) {
             init.set(Bun::NapiHandleScopeImpl::createStructure(init.vm, init.owner));
         } },
        { OBJECT_OFFSETOF(GlobalObject, m_NapiTypeTagStructure), [](const LazyProperty<JSGlobalObject, Structure>::Initializer& init) {
             init.set(Bun::NapiTypeTag::createStructure(init.vm, init.owner));
         } },
        { OBJECT_OFFSETOF(GlobalObject, m_NativePromiseContextStructure), [](const LazyProperty<JSGlobalObject, Structure>::Initializer& init) {
             init.set(Bun::NativePromiseContext::createStructure(init.vm, init.owner));
         } },
        { OBJECT_OFFSETOF(GlobalObject, m_JSHTTPResponseController), [](const LazyProperty<JSGlobalObject, Structure>::Initializer& init) {
             auto* structure = createJSSinkControllerStructure(init.vm, init.owner, WebCore::SinkID::HTTPResponseSink);
             init.set(structure);
         } },
        { OBJECT_OFFSETOF(GlobalObject, m_importMetaObjectStructure), [](const LazyProperty<JSGlobalObject, Structure>::Initializer& init) {
             init.set(Zig::ImportMetaObject::createStructure(init.vm, init.owner));
         } },
        { OBJECT_OFFSETOF(GlobalObject, m_importMetaBakeObjectStructure), [](const LazyProperty<JSGlobalObject, Structure>::Initializer& init) {
             init.set(Zig::ImportMetaObject::createStructure(init.vm, init.owner, true));
         } },
        { OBJECT_OFFSETOF(GlobalObject, m_asyncBoundFunctionStructure), [](const LazyProperty<JSGlobalObject, Structure>::Initializer& init) {
             init.set(AsyncContextFrame::createStructure(init.vm, init.owner));
         } },
    };

    static const LazyPropertyInit<JSObject> lazyObjectInits[] = {
        { OBJECT_OFFSETOF(GlobalObject, m_JSAsymmetricKeyObjectPrototype), [](const LazyProperty<JSGlobalObject, JSObject>::Initializer& init) {
             setupAsymmetricKeyObjectPrototype(init);
         } },
        { OBJECT_OFFSETOF(GlobalObject, m_JSDOMFileConstructor), [](const LazyProperty<JSGlobalObject, JSObject>::Initializer& init) {
             JSObject* fileConstructor = Bun::createJSDOMFileConstructor(init.vm, init.owner);
             init.set(fileConstructor);
         } },
        { OBJECT_OFFSETOF(GlobalObject, m_cryptoObject), [](const LazyProperty<JSGlobalObject, JSObject>::Initializer& init) {
             JSC::JSGlobalObject* globalObject = init.owner;
             JSObject* crypto = JSValue::decode(CryptoObject__create(globalObject)).getObject();
             // Node defines `subtle` on Crypto.prototype with a brand check, not on
             // the instance; the getter above enforces the brand.
             JSObject* prototype = crypto->getPrototypeDirect().getObject();
             prototype->putDirectCustomAccessor(
                 init.vm,
                 Identifier::fromString(init.vm, "subtle"_s),
                 JSC::CustomGetterSetter::create(init.vm, getterSubtleCrypto, setterSubtleCrypto),
                 PropertyAttribute::DontDelete | PropertyAttribute::CustomAccessor);

             init.set(crypto);
         } },
        { OBJECT_OFFSETOF(GlobalObject, m_lazyTestModuleObject), [](const LazyProperty<JSGlobalObject, JSObject>::Initializer& init) {
             JSC::JSGlobalObject* globalObject = init.owner;

             JSValue result = JSValue::decode(Bun__Jest__createTestModuleObject(globalObject));
             JSObject* object = result.isEmpty() ? nullptr : result.getObject();
             if (!object) [[unlikely]] {
                 // Creation failed and left an exception pending; cache a plain
                 // object so the LazyProperty stays valid instead of crashing on
                 // an empty JSValue.
                 object = JSC::constructEmptyObject(globalObject);
             }
             init.set(object);
         } },
        { OBJECT_OFFSETOF(GlobalObject, m_testMatcherUtilsObject), [](const LazyProperty<JSGlobalObject, JSObject>::Initializer& init) {
             JSValue result = JSValue::decode(ExpectMatcherUtils_createSigleton(init.owner));
             init.set(result.toObject(init.owner));
         } },
        { OBJECT_OFFSETOF(GlobalObject, m_nodeErrorCache), [](const LazyProperty<JSGlobalObject, JSObject>::Initializer& init) {
             auto* structure = ErrorCodeCache::createStructure(
                 init.vm,
                 init.owner);

             init.set(ErrorCodeCache::create(init.vm, structure));
         } },
        { OBJECT_OFFSETOF(GlobalObject, m_navigatorObject), [](const LazyProperty<JSGlobalObject, JSObject>::Initializer& init) {
             JSC::JSGlobalObject* globalObject = init.owner;
             unsigned accessorAttributes = PropertyAttribute::Accessor | 0;

             JSC::JSObject* obj = JSC::constructEmptyObject(globalObject, globalObject->objectPrototype(), 4);

             obj->putDirectNativeIntrinsicGetter(init.vm, globalObject, JSC::Identifier::fromString(init.vm, "userAgent"_s), functionNavigatorGetUserAgent, JSC::NoIntrinsic, accessorAttributes);
             obj->putDirectNativeIntrinsicGetter(init.vm, globalObject, JSC::Identifier::fromString(init.vm, "platform"_s), functionNavigatorGetPlatform, JSC::NoIntrinsic, accessorAttributes);
             obj->putDirectNativeIntrinsicGetter(init.vm, globalObject, JSC::Identifier::fromString(init.vm, "hardwareConcurrency"_s), functionNavigatorGetHardwareConcurrency, JSC::NoIntrinsic, accessorAttributes);

             obj->putDirect(init.vm, init.vm.propertyNames->toStringTagSymbol,
                 jsNontrivialString(init.vm, "Navigator"_s), PropertyAttribute::DontEnum | PropertyAttribute::ReadOnly);

             init.set(obj);
         } },
        { OBJECT_OFFSETOF(GlobalObject, m_bunObject), [](const LazyProperty<JSGlobalObject, JSObject>::Initializer& init) {
             init.set(Bun::createBunObject(init.vm, init.owner));
         } },
        { OBJECT_OFFSETOF(GlobalObject, m_JSBunRequestParamsPrototype), [](const LazyProperty<JSGlobalObject, JSObject>::Initializer& init) {
             init.set(Bun::createJSBunRequestParamsPrototype(init.vm, static_cast<Zig::GlobalObject*>(init.owner)));
         } },
        { OBJECT_OFFSETOF(GlobalObject, m_subtleCryptoObject), [](const LazyProperty<JSGlobalObject, JSObject>::Initializer& init) {
             auto& global = *static_cast<Zig::GlobalObject*>(init.owner);

             if (!global.m_subtleCrypto) {
                 global.m_subtleCrypto = &WebCore::SubtleCrypto::create(global.scriptExecutionContext()).leakRef();
             }

             init.set(toJS<IDLInterface<SubtleCrypto>>(*init.owner, global, global.m_subtleCrypto).getObject());
         } },
        { OBJECT_OFFSETOF(GlobalObject, m_JSArrayBufferControllerPrototype), [](const LazyProperty<JSGlobalObject, JSObject>::Initializer& init) {
             auto* prototype = createJSSinkControllerPrototype(init.vm, init.owner, WebCore::SinkID::ArrayBufferSink);
             init.set(prototype);
         } },
        { OBJECT_OFFSETOF(GlobalObject, m_JSFileSinkControllerPrototype), [](const LazyProperty<JSGlobalObject, JSObject>::Initializer& init) {
             auto* prototype = createJSSinkControllerPrototype(init.vm, init.owner, WebCore::SinkID::FileSink);
             init.set(prototype);
         } },
        { OBJECT_OFFSETOF(GlobalObject, m_JSHTTPSResponseControllerPrototype), [](const LazyProperty<JSGlobalObject, JSObject>::Initializer& init) {
             auto* prototype = createJSSinkControllerPrototype(init.vm, init.owner, WebCore::SinkID::HTTPSResponseSink);
             init.set(prototype);
         } },
        { OBJECT_OFFSETOF(GlobalObject, m_JSFetchTaskletChunkedRequestControllerPrototype), [](const LazyProperty<JSGlobalObject, JSObject>::Initializer& init) {
             auto* prototype = createJSSinkControllerPrototype(init.vm, init.owner, WebCore::SinkID::NetworkSink);
             init.set(prototype);
         } },
        { OBJECT_OFFSETOF(GlobalObject, m_performanceObject), [](const LazyProperty<JSGlobalObject, JSObject>::Initializer& init) {
             auto* globalObject = static_cast<Zig::GlobalObject*>(init.owner);
             init.set(toJS(init.owner, globalObject, globalObject->performance().get()).getObject());
         } },
        { OBJECT_OFFSETOF(GlobalObject, m_processEnvObject), [](const LazyProperty<JSGlobalObject, JSObject>::Initializer& init) {
             init.set(Bun::createEnvironmentVariablesMap(static_cast<Zig::GlobalObject*>(init.owner)).getObject());
         } },
        { OBJECT_OFFSETOF(GlobalObject, m_requireFunctionUnbound), [](const LazyProperty<JSGlobalObject, JSObject>::Initializer& init) {
             init.set(
                 JSFunction::create(
                     init.vm,
                     init.owner,
                     commonJSRequireCodeGenerator(init.vm),
                     init.owner->globalScope(),
                     JSFunction::createStructure(init.vm, init.owner, RequireFunctionPrototype::create(init.owner))));
         } },
        { OBJECT_OFFSETOF(GlobalObject, m_requireResolveFunctionUnbound), [](const LazyProperty<JSGlobalObject, JSObject>::Initializer& init) {
             init.set(
                 JSFunction::create(
                     init.vm,
                     init.owner,
                     commonJSRequireResolveCodeGenerator(init.vm),
                     init.owner->globalScope(),
                     JSFunction::createStructure(init.vm, init.owner, RequireResolveFunctionPrototype::create(init.owner))));
         } },
        { OBJECT_OFFSETOF(GlobalObject, m_processBindingBuffer), [](const LazyProperty<JSGlobalObject, JSObject>::Initializer& init) {
             init.set(
                 ProcessBindingBuffer::create(
                     init.vm,
                     ProcessBindingBuffer::createStructure(init.vm, init.owner)));
         } },
        { OBJECT_OFFSETOF(GlobalObject, m_processBindingConstants), [](const LazyProperty<JSGlobalObject, JSObject>::Initializer& init) {
             init.set(
                 ProcessBindingConstants::create(
                     init.vm,
                     ProcessBindingConstants::createStructure(init.vm, init.owner)));
         } },
        { OBJECT_OFFSETOF(GlobalObject, m_processBindingFs), [](const LazyProperty<JSGlobalObject, JSObject>::Initializer& init) {
             init.set(
                 ProcessBindingFs::create(
                     init.vm,
                     ProcessBindingFs::createStructure(init.vm, init.owner)));
         } },
        { OBJECT_OFFSETOF(GlobalObject, m_processBindingHTTPParser), [](const LazyProperty<JSGlobalObject, JSObject>::Initializer& init) {
             init.set(
                 ProcessBindingHTTPParser::create(
                     init.vm,
                     ProcessBindingHTTPParser::createStructure(init.vm, init.owner)));
         } },
        { OBJECT_OFFSETOF(GlobalObject, m_JSFFICStringConstructor), [](const LazyProperty<JSGlobalObject, JSObject>::Initializer& init) {
             init.set(Bun::JSFFICStringConstructor::create(init.vm, init.owner));
         } },
        { OBJECT_OFFSETOF(GlobalObject, m_bunStdin), [](const LazyProperty<JSGlobalObject, JSObject>::Initializer& init) {
             init.set(JSC::JSValue::decode(BunObject__createBunStdin(init.owner)).getObject());
         } },
        { OBJECT_OFFSETOF(GlobalObject, m_bunStderr), [](const LazyProperty<JSGlobalObject, JSObject>::Initializer& init) {
             init.set(JSC::JSValue::decode(BunObject__createBunStderr(init.owner)).getObject());
         } },
        { OBJECT_OFFSETOF(GlobalObject, m_bunStdout), [](const LazyProperty<JSGlobalObject, JSObject>::Initializer& init) {
             init.set(JSC::JSValue::decode(BunObject__createBunStdout(init.owner)).getObject());
         } },
    };

    static const LazyPropertyInit<JSFunction> lazyFunctionInits[] = {
        { OBJECT_OFFSETOF(GlobalObject, m_errorConstructorPrepareStackTraceInternalValue), [](const LazyProperty<JSGlobalObject, JSFunction>::Initializer& init) {
             init.set(JSFunction::create(init.vm, init.owner, 2, "ErrorPrepareStackTrace"_s, jsFunctionDefaultErrorPrepareStackTrace, ImplementationVisibility::Public));
         } },

        { OBJECT_OFFSETOF(GlobalObject, m_utilInspectFunction), [](const LazyProperty<JSGlobalObject, JSFunction>::Initializer& init) {
             auto scope = DECLARE_THROW_SCOPE(init.vm);
             JSValue nodeUtilValue = uncheckedDowncast<Zig::GlobalObject>(init.owner)->internalModuleRegistry()->requireId(init.owner, init.vm, Bun::InternalModuleRegistry::Field::NodeUtil);
             RETURN_IF_EXCEPTION(scope, );
             RELEASE_ASSERT(nodeUtilValue.isObject());
             auto prop = nodeUtilValue.getObject()->getIfPropertyExists(init.owner, Identifier::fromString(init.vm, "inspect"_s));
             RETURN_IF_EXCEPTION(scope, );
             ASSERT(prop);
             init.set(uncheckedDowncast<JSFunction>(prop));
         } },
        { OBJECT_OFFSETOF(GlobalObject, m_utilInspectStylizeColorFunction), [](const LazyProperty<JSGlobalObject, JSFunction>::Initializer& init) {
             auto scope = DECLARE_THROW_SCOPE(init.vm);
             JSC::MarkedArgumentBuffer args;
             args.append(uncheckedDowncast<Zig::GlobalObject>(init.owner)->utilInspectFunction());
             RETURN_IF_EXCEPTION(scope, );

             JSC::JSFunction* getStylize = JSC::JSFunction::create(init.vm, init.owner, utilInspectGetStylizeWithColorCodeGenerator(init.vm), init.owner);
             RETURN_IF_EXCEPTION(scope, );

             JSC::CallData callData = JSC::getCallData(getStylize);
             NakedPtr<JSC::Exception> returnedException = nullptr;
             auto result = JSC::profiledCall(init.owner, ProfilingReason::API, getStylize, callData, jsNull(), args, returnedException);
             RETURN_IF_EXCEPTION(scope, );

             if (returnedException) {
                 throwException(init.owner, scope, returnedException.get());
             }
             RETURN_IF_EXCEPTION(scope, );
             init.set(uncheckedDowncast<JSFunction>(result));
         } },
        { OBJECT_OFFSETOF(GlobalObject, m_utilInspectStylizeNoColorFunction), [](const LazyProperty<JSGlobalObject, JSFunction>::Initializer& init) {
             init.set(JSC::JSFunction::create(init.vm, init.owner, utilInspectStylizeWithNoColorCodeGenerator(init.vm), init.owner));
         } },
        { OBJECT_OFFSETOF(GlobalObject, m_wasmStreamingConsumeStreamFunction), [](const LazyProperty<JSGlobalObject, JSFunction>::Initializer& init) {
             init.set(JSC::JSFunction::create(init.vm, init.owner, wasmStreamingConsumeStreamCodeGenerator(init.vm), init.owner));
         } },
        { OBJECT_OFFSETOF(GlobalObject, m_nativeMicrotaskTrampoline), [](const LazyProperty<JSGlobalObject, JSFunction>::Initializer& init) {
             init.set(JSFunction::create(init.vm, init.owner, 2, ""_s, functionNativeMicrotaskTrampoline, ImplementationVisibility::Private));
         } },
        { OBJECT_OFFSETOF(GlobalObject, m_ipcParseHandleFunction), [](const LazyProperty<JSGlobalObject, JSFunction>::Initializer& init) {
             init.set(JSC::JSFunction::create(init.vm, init.owner, WebCore::ipcParseHandleCodeGenerator(init.vm), init.owner));
         } },
        { OBJECT_OFFSETOF(GlobalObject, m_ipcSerializeFunction), [](const LazyProperty<JSGlobalObject, JSFunction>::Initializer& init) {
             init.set(JSC::JSFunction::create(init.vm, init.owner, WebCore::ipcSerializeCodeGenerator(init.vm), init.owner));
         } },
        { OBJECT_OFFSETOF(GlobalObject, m_ipcTagAdvancedBuffersFunction), [](const LazyProperty<JSGlobalObject, JSFunction>::Initializer& init) {
             init.set(JSC::JSFunction::create(init.vm, init.owner, WebCore::ipcTagAdvancedBuffersCodeGenerator(init.vm), init.owner));
         } },
        { OBJECT_OFFSETOF(GlobalObject, m_ipcRestoreAdvancedBuffersFunction), [](const LazyProperty<JSGlobalObject, JSFunction>::Initializer& init) {
             init.set(JSC::JSFunction::create(init.vm, init.owner, WebCore::ipcRestoreAdvancedBuffersCodeGenerator(init.vm), init.owner));
         } },
    };

    Bun::addNodeModuleConstructorProperties(vm, this);
    initLazyClassStructures<lazyClassStructureInits>(this);
    initLazyProperties<Structure, lazyStructureInits>(this);
    initLazyProperties<JSObject, lazyObjectInits>(this);
    initLazyProperties<JSFunction, lazyFunctionInits>(this);

    m_lazyStackCustomGetterSetter.initLater(
        [](const Initializer<CustomGetterSetter>& init) {
            init.set(CustomGetterSetter::create(init.vm, errorInstanceLazyStackCustomGetter, errorInstanceLazyStackCustomSetter));
        });

    m_V8GlobalInternals.initLater(
        [](const JSC::LazyProperty<JSC::JSGlobalObject, v8::shim::GlobalInternals>::Initializer& init) {
            init.set(
                v8::shim::GlobalInternals::create(
                    init.vm,
                    v8::shim::GlobalInternals::createStructure(init.vm, init.owner),
                    dynamicDowncast<Zig::GlobalObject>(init.owner)));
        });

    // Change prototype from null to object for synthetic modules.

    m_vmModuleContextMap.initLater(
        [](const Initializer<JSWeakMap>& init) {
            init.set(JSWeakMap::create(init.vm, init.owner->weakMapStructure()));
        });

    this->initGeneratedLazyClasses();

    m_napiTypeTags.initLater([](const JSC::LazyProperty<JSC::JSGlobalObject, JSC::JSWeakMap>::Initializer& init) {
        init.set(JSC::JSWeakMap::create(init.vm, init.owner->weakMapStructure()));
    });

    m_processObject.initLater(
        [](const JSC::LazyProperty<JSC::JSGlobalObject, Bun::Process>::Initializer& init) {
            auto* globalObject = defaultGlobalObject(init.owner);

            auto* process = Bun::Process::create(
                *globalObject, Bun::Process::createStructure(init.vm, init.owner, WebCore::JSEventEmitter::prototype(init.vm, *globalObject)));

            init.set(process);
        });

    m_streamsRuntime.initialize(this);

    m_requireMap.initLater(
        [](const JSC::LazyProperty<JSC::JSGlobalObject, JSC::JSMap>::Initializer& init) {
            auto* map = JSC::JSMap::create(init.vm, init.owner->mapStructure());
            init.set(map);
        });

    m_internalModuleRegistry.initLater(
        [](const JSC::LazyProperty<JSC::JSGlobalObject, Bun::InternalModuleRegistry>::Initializer& init) {
            init.set(
                InternalModuleRegistry::create(
                    init.vm,
                    InternalModuleRegistry::createStructure(init.vm, init.owner)));
        });

    // Initialize LazyProperties for stdin/stderr/stdout

    configureNodeVM(vm, this);

#if ENABLE(REMOTE_INSPECTOR)
    setInspectable(false);
#endif

    addBuiltinGlobals(vm);

    ASSERT(classInfo());
}

// `console.Console` or `import { Console } from 'console';`
JSC_DEFINE_CUSTOM_GETTER(getConsoleConstructor, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName property))
{
    auto& vm = JSC::getVM(globalObject);
    auto console = JSValue::decode(thisValue).getObject();
    JSC::JSFunction* createConsoleConstructor = JSC::JSFunction::create(vm, globalObject, consoleObjectCreateConsoleConstructorCodeGenerator(vm), globalObject);
    JSC::MarkedArgumentBuffer args;
    args.append(console);
    JSC::CallData callData = JSC::getCallData(createConsoleConstructor);
    NakedPtr<JSC::Exception> returnedException = nullptr;
    auto result = JSC::profiledCall(globalObject, ProfilingReason::API, createConsoleConstructor, callData, console, args, returnedException);
    if (returnedException) {
        auto scope = DECLARE_THROW_SCOPE(vm);
        throwException(globalObject, scope, returnedException.get());
        return {};
    }
    console->putDirect(vm, property, result, 0);
    return JSValue::encode(result);
}

// `console._stdout` is equal to `process.stdout`
JSC_DEFINE_CUSTOM_GETTER(getConsoleStdout, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName property))
{
    auto& vm = JSC::getVM(globalObject);
    auto console = JSValue::decode(thisValue).getObject();
    auto global = uncheckedDowncast<Zig::GlobalObject>(globalObject);

    // instead of calling the constructor builtin, go through the process.stdout getter to ensure it's only created once.
    auto stdoutValue = global->processObject()->get(globalObject, Identifier::fromString(vm, "stdout"_s));
    if (!stdoutValue) return {};

    console->putDirect(vm, property, stdoutValue, PropertyAttribute::DontEnum | 0);
    return JSValue::encode(stdoutValue);
}

// `console._stderr` is equal to `process.stderr`
JSC_DEFINE_CUSTOM_GETTER(getConsoleStderr, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName property))
{
    auto& vm = JSC::getVM(globalObject);
    auto console = JSValue::decode(thisValue).getObject();
    auto global = uncheckedDowncast<Zig::GlobalObject>(globalObject);

    // instead of calling the constructor builtin, go through the process.stdout getter to ensure it's only created once.
    auto stderrValue = global->processObject()->get(globalObject, Identifier::fromString(vm, "stderr"_s));
    if (!stderrValue) return {};

    console->putDirect(vm, property, stderrValue, PropertyAttribute::DontEnum | 0);
    return JSValue::encode(stderrValue);
}

// The CommonJS `require()` machinery (`@requireESM`, `@loadEsmIntoCjs`,
// `@internalRequire`) is only ever reached from inside CommonJS modules. A
// process whose entry point is ESM (the common case for short scripts) never
// touches it, so parsing/compiling these builtins during global object setup is
// pure startup overhead. Register lazy custom-value getters instead: the first
// `@`-reference from builtin code materializes the function and replaces the
// accessor with the plain builtin function for subsequent fast access.
//
// Note: these private names are only consumed via `op_get_from_scope` from
// builtin JS (`$requireESM`, `$loadEsmIntoCjs`, `$internalRequire`), never via
// `getDirect`, so a custom accessor is a transparent substitute. (`@create*ReadableStream`
// next to these *do* have `getDirect` callers and must stay eager.)
#define BUN_DEFINE_LAZY_GLOBAL_BUILTIN_GETTER(getterName, codeGenerator, attributes)                                           \
    JSC_DEFINE_CUSTOM_GETTER(getterName, (JSGlobalObject * lexicalGlobalObject, EncodedJSValue, PropertyName name))            \
    {                                                                                                                          \
        auto& vm = JSC::getVM(lexicalGlobalObject);                                                                            \
        auto* globalObject = uncheckedDowncast<Zig::GlobalObject>(lexicalGlobalObject);                                        \
        JSC::JSFunction* fn = globalObject->putDirectBuiltinFunction(vm, globalObject, name, codeGenerator(vm), (attributes)); \
        return JSValue::encode(fn);                                                                                            \
    }
BUN_DEFINE_LAZY_GLOBAL_BUILTIN_GETTER(getRequireESMBuiltin, commonJSRequireESMCodeGenerator, PropertyAttribute::Builtin | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly)
BUN_DEFINE_LAZY_GLOBAL_BUILTIN_GETTER(getLoadEsmIntoCjsBuiltin, commonJSLoadEsmIntoCjsCodeGenerator, PropertyAttribute::Builtin | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly)
BUN_DEFINE_LAZY_GLOBAL_BUILTIN_GETTER(getInternalRequireBuiltin, commonJSInternalRequireCodeGenerator, PropertyAttribute::Builtin | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly)
#undef BUN_DEFINE_LAZY_GLOBAL_BUILTIN_GETTER

JSC_DEFINE_HOST_FUNCTION(jsFunctionToClass, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    // Mimick the behavior of class Foo {} for a regular JSFunction.
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto target = callFrame->argument(0).toObject(globalObject);
    RETURN_IF_EXCEPTION(scope, encodedJSValue());
    auto name = callFrame->argument(1);
    JSObject* base = callFrame->argument(2).getObject();
    JSObject* prototypeBase = nullptr;

    if (!base) {
        base = globalObject->functionPrototype();
    } else {
        auto proto = base->getIfPropertyExists(globalObject, vm.propertyNames->prototype);
        RETURN_IF_EXCEPTION(scope, encodedJSValue());
        if (proto) {
            if (auto protoObject = proto.getObject()) {
                prototypeBase = protoObject;
            }
        } else {
            JSC::throwTypeError(globalObject, scope, "Base class must have a prototype property"_s);
            return encodedJSValue();
        }
    }

    JSObject* prototype = prototypeBase ? JSC::constructEmptyObject(globalObject, prototypeBase) : JSC::constructEmptyObject(globalObject);
    RETURN_IF_EXCEPTION(scope, encodedJSValue());

    prototype->structure()->setMayBePrototype(true);
    prototype->putDirect(vm, vm.propertyNames->constructor, target, PropertyAttribute::DontEnum | 0);

    target->setPrototypeDirect(vm, base);
    target->putDirect(vm, vm.propertyNames->prototype, prototype, PropertyAttribute::DontEnum | 0);
    target->putDirect(vm, vm.propertyNames->name, name, PropertyAttribute::DontEnum | 0);

    return JSValue::encode(jsUndefined());
}

EncodedJSValue GlobalObject::assignToStream(JSValue stream, JSValue controller)
{
    auto& vm = this->vm();
    auto* readableStream = dynamicDowncast<WebCore::JSReadableStream>(stream);
    if (!readableStream) [[unlikely]]
        return JSC::JSValue::encode(JSC::Exception::create(vm, createTypeError(this, "Expected a ReadableStream"_s)));
    // The native caller (JSSinkController__assignToStream) expects any failure returned as the
    // encoded Exception cell, never left pending on the VM.
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    JSValue result = Bun::WebStreams::assignToStream(this, readableStream, controller);
    if (auto* exception = scope.exception()) [[unlikely]] {
        // Hand the Exception cell back to the native caller. A termination that has left script is
        // taken (the caller stands down on the cell); beneath script it stays for JSC to unwind.
        scope.clearExceptionExceptTermination();
        Bun__VM__takeTerminationOutsideScript(this);
        return JSC::JSValue::encode(exception);
    }
    return JSC::JSValue::encode(result);
}

JSC::GCClient::IsoSubspace* GlobalObject::subspaceForImpl(JSC::VM& vm)
{
    return WebCore::subspaceForImpl<GlobalObject, WebCore::UseCustomHeapCellType::Yes>(vm, BUN_SUBSPACE_SLOTS(m_clientSubspaceForWorkerGlobalScope, m_subspaceForWorkerGlobalScope),
        [](auto& server) -> JSC::HeapCellType& { return server.m_heapCellTypeForJSWorkerGlobalScope; });
}

BUN_DECLARE_HOST_FUNCTION(WebCore__alert);
BUN_DECLARE_HOST_FUNCTION(WebCore__prompt);
BUN_DECLARE_HOST_FUNCTION(WebCore__confirm);

JSValue GlobalObject_getGlobalThis(VM& vm, JSObject* globalObject)
{
    return uncheckedDowncast<Zig::GlobalObject>(globalObject)->globalThis();
}

void GlobalObject::addBuiltinGlobals(JSC::VM& vm)
{
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    m_builtinInternalFunctions->initialize(*this);

    auto clientData = WebCore::clientData(vm);
    auto& builtinNames = WebCore::builtinNames(vm);

    // ----- Private/Static Properties -----

    // Private native functions, all `DontDelete | ReadOnly` with no name.
    using BuiltinName = WebCore::BunBuiltinNames::Name;
    struct PrivateFunction {
        BuiltinName name;
        uint8_t length;
        JSC::EncodedJSValue(JSC_HOST_CALL_ATTRIBUTES* function)(JSC::JSGlobalObject*, JSC::CallFrame*);
    };
    static constexpr PrivateFunction privateFunctions[] = {
        { BuiltinName::k_makeGetterTypeError, 2, makeGetterTypeErrorForBuiltins },
        { BuiltinName::k_makeDOMException, 2, makeDOMExceptionForBuiltins },
        { BuiltinName::k_addAbortAlgorithmToSignal, 2, addAbortAlgorithmToSignal },
        { BuiltinName::k_removeAbortAlgorithmFromSignal, 2, removeAbortAlgorithmFromSignal },
        { BuiltinName::k_isAbortSignal, 1, isAbortSignal },
        { BuiltinName::k_peekPromiseStatus, 1, jsBunPeekPromiseStatus },
        { BuiltinName::k_peekPromiseSettledValue, 1, jsBunPeekPromiseSettledValue },
        { BuiltinName::k_pokePromiseAsHandled, 1, jsBunPokePromiseAsHandled },
        { BuiltinName::k_webStreamClosedPromise, 1, jsWebStreamClosedPromise },
        { BuiltinName::k_webStreamControllerError, 2, jsWebStreamControllerError },
        { BuiltinName::k_esmNamespaceForCjs, 1, functionEsmNamespaceForCjs },
        { BuiltinName::k_esmRegistryDelete, 1, functionEsmRegistryDelete },
        { BuiltinName::k_esmRegistryEvaluatedKeys, 0, functionEsmRegistryEvaluatedKeys },
        { BuiltinName::k_esmLoadSync, 1, functionEsmLoadSync },
        { BuiltinName::k_makeErrorWithCode, 2, jsFunctionMakeErrorWithCode },
        { BuiltinName::k_toClass, 1, jsFunctionToClass },
        { BuiltinName::k_inherits, 1, jsFunctionInherits },
        { BuiltinName::k_makeAbortError, 1, jsFunctionMakeAbortError },
    };
    Vector<GlobalPropertyInfo, 32> staticGlobals;
    staticGlobals.append(GlobalPropertyInfo { builtinNames.lazyPrivateName(),
        JSC::JSFunction::create(vm, this, 0, "@lazy"_s, JS2Native::jsDollarLazy, ImplementationVisibility::Public),
        PropertyAttribute::ReadOnly | PropertyAttribute::DontEnum | PropertyAttribute::DontDelete | 0 });
    for (auto& entry : privateFunctions)
        staticGlobals.append(GlobalPropertyInfo(builtinNames.privateName(entry.name), JSFunction::create(vm, this, entry.length, String(), entry.function, ImplementationVisibility::Public), PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly));
    staticGlobals.append(GlobalPropertyInfo(vm.propertyNames->builtinNames().ArrayBufferPrivateName(), arrayBufferConstructor(), PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly));
    staticGlobals.append(GlobalPropertyInfo(builtinNames.internalModuleRegistryPrivateName(), this->internalModuleRegistry(), PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly));
    staticGlobals.append(GlobalPropertyInfo(builtinNames.processBindingConstantsPrivateName(), this->processBindingConstants(), PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly));
    staticGlobals.append(GlobalPropertyInfo(builtinNames.requireMapPrivateName(), this->requireMap(), PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly | 0));
    addStaticGlobals(staticGlobals.mutableSpan());

    // TODO: most/all of these private properties can be made as static globals.
    // i've noticed doing it as is will work somewhat but getDirect() wont be able to find them

    putDirectBuiltinFunction(vm, this, builtinNames.createFIFOPrivateName(), fifoCreateFIFOCodeGenerator(vm), PropertyAttribute::Builtin | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly);
    // These three are CommonJS-only and never reached on an ESM startup path; install
    // lazy getters so their source isn't parsed during global object construction.
    // (See getRequireESMBuiltin / getLoadEsmIntoCjsBuiltin / getInternalRequireBuiltin above.)
    putDirectCustomAccessor(vm, builtinNames.requireESMPrivateName(), JSC::CustomGetterSetter::create(vm, getRequireESMBuiltin, nullptr), PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly | PropertyAttribute::CustomValue);
    putDirectCustomAccessor(vm, builtinNames.loadEsmIntoCjsPrivateName(), JSC::CustomGetterSetter::create(vm, getLoadEsmIntoCjsBuiltin, nullptr), PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly | PropertyAttribute::CustomValue);
    putDirectCustomAccessor(vm, builtinNames.internalRequirePrivateName(), JSC::CustomGetterSetter::create(vm, getInternalRequireBuiltin, nullptr), PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly | PropertyAttribute::CustomValue);

    putDirectBuiltinFunction(vm, this, builtinNames.overridableRequirePrivateName(), commonJSOverridableRequireCodeGenerator(vm), 0);

    putDirectNativeFunction(vm, this, builtinNames.createUninitializedArrayBufferPrivateName(), 1, functionCreateUninitializedArrayBuffer, ImplementationVisibility::Public, NoIntrinsic, PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly);
    putDirectNativeFunction(vm, this, builtinNames.resolveSyncPrivateName(), 1, functionImportMeta__resolveSyncPrivate, ImplementationVisibility::Public, NoIntrinsic, PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly);
    putDirectNativeFunction(vm, this, builtinNames.createInternalModuleByIdPrivateName(), 1, InternalModuleRegistry::jsCreateInternalModuleById, ImplementationVisibility::Public, NoIntrinsic, PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly);

    putDirectNativeFunction(vm, this,
        builtinNames.createCommonJSModulePrivateName(),
        2,
        Bun::jsFunctionCreateCommonJSModule,
        ImplementationVisibility::Public,
        NoIntrinsic,
        PropertyAttribute::ReadOnly | PropertyAttribute::DontDelete | 0);
    putDirectNativeFunction(vm, this,
        builtinNames.evaluateCommonJSModulePrivateName(),
        2,
        Bun::jsFunctionEvaluateCommonJSModule,
        ImplementationVisibility::Public,
        NoIntrinsic,
        PropertyAttribute::ReadOnly | PropertyAttribute::DontDelete | 0);
    putDirectNativeFunction(vm, this,
        builtinNames.evictIsolationSourceProviderCachePrivateName(),
        1,
        jsFunctionEvictIsolationSourceProviderCache,
        ImplementationVisibility::Public,
        NoIntrinsic,
        PropertyAttribute::ReadOnly | PropertyAttribute::DontDelete | 0);

    putDirectCustomAccessor(vm, static_cast<JSVMClientData*>(vm.clientData)->builtinNames().BufferPrivateName(), JSC::CustomGetterSetter::create(vm, JSBuffer_getter, nullptr), PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly | PropertyAttribute::CustomValue);
    putDirectCustomAccessor(vm, builtinNames.TransformStreamPrivateName(), CustomGetterSetter::create(vm, TransformStream_getter, nullptr), attributesForStructure(static_cast<unsigned>(PropertyAttribute::DontEnum)) | PropertyAttribute::CustomValue);
    putDirectCustomAccessor(vm, builtinNames.TransformStreamDefaultControllerPrivateName(), CustomGetterSetter::create(vm, TransformStreamDefaultController_getter, nullptr), attributesForStructure(static_cast<unsigned>(PropertyAttribute::DontEnum)) | PropertyAttribute::CustomValue);
    putDirectCustomAccessor(vm, builtinNames.ReadableByteStreamControllerPrivateName(), CustomGetterSetter::create(vm, ReadableByteStreamController_getter, nullptr), attributesForStructure(PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly) | PropertyAttribute::CustomValue);
    putDirectCustomAccessor(vm, builtinNames.ReadableStreamPrivateName(), CustomGetterSetter::create(vm, ReadableStream_getter, nullptr), attributesForStructure(PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly) | PropertyAttribute::CustomValue);
    putDirectCustomAccessor(vm, builtinNames.ReadableStreamBYOBReaderPrivateName(), CustomGetterSetter::create(vm, ReadableStreamBYOBReader_getter, nullptr), attributesForStructure(PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly) | PropertyAttribute::CustomValue);
    putDirectCustomAccessor(vm, builtinNames.ReadableStreamBYOBRequestPrivateName(), CustomGetterSetter::create(vm, ReadableStreamBYOBRequest_getter, nullptr), attributesForStructure(PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly) | PropertyAttribute::CustomValue);
    putDirectCustomAccessor(vm, builtinNames.ReadableStreamDefaultControllerPrivateName(), CustomGetterSetter::create(vm, ReadableStreamDefaultController_getter, nullptr), attributesForStructure(PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly) | PropertyAttribute::CustomValue);
    putDirectCustomAccessor(vm, builtinNames.ReadableStreamDefaultReaderPrivateName(), CustomGetterSetter::create(vm, ReadableStreamDefaultReader_getter, nullptr), attributesForStructure(PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly) | PropertyAttribute::CustomValue);
    putDirectCustomAccessor(vm, builtinNames.WritableStreamPrivateName(), CustomGetterSetter::create(vm, WritableStream_getter, nullptr), attributesForStructure(PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly) | PropertyAttribute::CustomValue);
    putDirectCustomAccessor(vm, builtinNames.WritableStreamDefaultControllerPrivateName(), CustomGetterSetter::create(vm, WritableStreamDefaultController_getter, nullptr), attributesForStructure(PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly) | PropertyAttribute::CustomValue);
    putDirectCustomAccessor(vm, builtinNames.WritableStreamDefaultWriterPrivateName(), CustomGetterSetter::create(vm, WritableStreamDefaultWriter_getter, nullptr), attributesForStructure(PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly) | PropertyAttribute::CustomValue);
    putDirectCustomAccessor(vm, builtinNames.AbortSignalPrivateName(), CustomGetterSetter::create(vm, AbortSignal_getter, nullptr), PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly | PropertyAttribute::CustomValue);

    // ----- Public Properties -----

    // a direct accessor (uses js functions for get and set) cannot be on the lookup table. i think.
    putDirectAccessor(
        this,
        builtinNames.selfPublicName(),
        JSC::GetterSetter::create(
            vm,
            this,
            JSFunction::create(vm, this, 0, "get"_s, functionGetSelf, ImplementationVisibility::Public),
            JSFunction::create(vm, this, 0, "set"_s, functionSetSelf, ImplementationVisibility::Public)),
        PropertyAttribute::Accessor | 0);

    // TODO: this should be usable on the lookup table. it crashed las time i tried it
    putDirectCustomAccessor(vm, JSC::Identifier::fromString(vm, "onmessage"_s), JSC::CustomGetterSetter::create(vm, globalOnMessage, setGlobalOnMessage), 0);
    putDirectCustomAccessor(vm, JSC::Identifier::fromString(vm, "onerror"_s), JSC::CustomGetterSetter::create(vm, globalOnError, setGlobalOnError), 0);

    // ----- Extensions to Built-in objects -----

    JSC::JSObject* errorConstructor = this->errorConstructor();
    errorConstructor->putDirectNativeFunction(vm, this, JSC::Identifier::fromString(vm, "captureStackTrace"_s), 2, errorConstructorFuncCaptureStackTrace, ImplementationVisibility::Public, JSC::NoIntrinsic, PropertyAttribute::DontEnum | 0);
    errorConstructor->putDirectNativeFunction(vm, this, JSC::Identifier::fromString(vm, "appendStackTrace"_s), 2, errorConstructorFuncAppendStackTrace, ImplementationVisibility::Private, JSC::NoIntrinsic, PropertyAttribute::DontEnum | 0);
    errorConstructor->putDirectCustomAccessor(vm, JSC::Identifier::fromString(vm, "prepareStackTrace"_s), JSC::CustomGetterSetter::create(vm, errorConstructorPrepareStackTraceGetter, errorConstructorPrepareStackTraceSetter), PropertyAttribute::DontEnum | PropertyAttribute::CustomValue);

    JSC::JSObject* consoleObject = this->get(this, JSC::Identifier::fromString(vm, "console"_s)).getObject();
    scope.assertNoExceptionExceptTermination();
    RETURN_IF_EXCEPTION(scope, );
    consoleObject->putDirectBuiltinFunction(vm, this, vm.propertyNames->asyncIteratorSymbol, consoleObjectAsyncIteratorCodeGenerator(vm), PropertyAttribute::Builtin | 0);
    consoleObject->putDirectBuiltinFunction(vm, this, clientData->builtinNames().writePublicName(), consoleObjectWriteCodeGenerator(vm), PropertyAttribute::Builtin | 0);
    consoleObject->putDirectCustomAccessor(vm, Identifier::fromString(vm, "Console"_s), CustomGetterSetter::create(vm, getConsoleConstructor, nullptr), PropertyAttribute::CustomValue | 0);
    consoleObject->putDirectCustomAccessor(vm, Identifier::fromString(vm, "_stdout"_s), CustomGetterSetter::create(vm, getConsoleStdout, nullptr), PropertyAttribute::DontEnum | PropertyAttribute::CustomValue | 0);
    consoleObject->putDirectCustomAccessor(vm, Identifier::fromString(vm, "_stderr"_s), CustomGetterSetter::create(vm, getConsoleStderr, nullptr), PropertyAttribute::DontEnum | PropertyAttribute::CustomValue | 0);
}

// ===================== start conditional builtin globals =====================
// These functions register globals based on runtime conditions (e.g. CLI flags,
// environment variables, etc.). See `add_conditional_globals()` in
// src/runtime/cli/run_command.rs for where these are called.

/// `globalThis.gc()` is an alias for `Bun.gc(true)`
/// Note that `vm` is a `VirtualMachine*`
extern "C" size_t Bun__gc(void* vm, bool sync);
JSC_DEFINE_HOST_FUNCTION(functionJsGc,
    (JSC::JSGlobalObject * global, JSC::CallFrame* callFrame))
{
    Zig::GlobalObject* globalObject = defaultGlobalObject(global);
    Bun__gc(globalObject->bunVM(), true);
    return JSValue::encode(jsUndefined());
}

extern "C" [[ZIG_EXPORT(nothrow)]] void JSC__JSGlobalObject__addGc(JSC::JSGlobalObject* globalObject)
{
    auto& vm = JSC::getVM(globalObject);
    globalObject->putDirectNativeFunction(vm, globalObject, JSC::Identifier::fromString(vm, "gc"_s), 0, functionJsGc, ImplementationVisibility::Public, JSC::NoIntrinsic, PropertyAttribute::DontEnum | 0);
}

extern "C" [[ZIG_EXPORT(nothrow)]] double JSC__JSGlobalObject__jsDateNow(JSC::JSGlobalObject* globalObject)
{
    return globalObject->jsDateNow();
}

// ====================== end conditional builtin globals ======================

uint8_t GlobalObject::drainMicrotasks()
{
    auto& vm = this->vm();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);

    // A stopped VM has no checkpoint to run: whether or not its termination is still pending here (the
    // landing frame may already have taken it), nothing queued may execute any more.
    if (WebCore::clientData(vm)->isStoppingOrStopped(vm)) [[unlikely]] {
        Bun__VM__takeTerminationOutsideScript(this);
        return 1;
    }

    if (auto* exception = scope.exception()) [[unlikely]] {
        if (vm.isTerminationException(exception)) [[unlikely]] {
            Bun__VM__takeTerminationOutsideScript(this);
            return 1;
        }

#if ASSERT_ENABLED
        (void)scope.tryClearException();
        // We should not have an exception here.
        // But it's an easy mistake to make.
        // Let's log it so that we can debug this.
        Bun__reportError(this, JSValue::encode(exception));

        // And re-throw it to preserve the production behavior.
        auto throwScope = DECLARE_THROW_SCOPE(vm);
        throwScope.throwException(this, exception);
        throwScope.release();
#endif
    }
    scope.assertNoExceptionExceptTermination();

    // A checkpoint with no script on the stack ends an event loop callback: an
    // AsyncLocalStorage frame it installed with enterWith() must not leak into
    // the next one (everything queued runs under the frame it captured).
    if (!vm.entryScope)
        m_asyncContextData.get()->putInternalField(vm, 0, jsUndefined());

    if (auto nextTickQueue = this->m_nextTickQueue.get()) {
        nextTickQueue->drain(vm, this);
        if (auto* exception = scope.exception()) {
            if (vm.isTerminationException(exception)) {
                Bun__VM__takeTerminationOutsideScript(this);
                return 1;
            }
            (void)scope.tryClearException();
            this->reportUncaughtExceptionAtEventLoop(this, exception);
            return 0;
        }
    }
    vm.drainMicrotasks();
    if (auto* exception = scope.exception()) {
        if (vm.isTerminationException(exception)) {
            Bun__VM__takeTerminationOutsideScript(this);
            return 1;
        }
        (void)scope.tryClearException();
        this->reportUncaughtExceptionAtEventLoop(this, exception);
    }

    return 0;
}

// The Rust event loop's entry to drainMicrotasks() (`EventLoop::exit()` and the
// drains between queued items): 0 drained, 1 the VM is terminating.
//
// One case is answered here instead: a Rust frame can be leaving through
// `exit()` with a (non-termination) exception pending that the dispatcher above
// it will take and report. For drainMicrotasks() an exception pending on entry
// is a caller bug (its C++ callers are top-level loops); for this caller it only
// means "not a checkpoint yet" - so say so (2) without draining or reporting,
// and the fold checkpoints once it has taken the exception.
extern "C" uint8_t JSC__JSGlobalObject__drainMicrotasks(Zig::GlobalObject* globalObject)
{
    auto& vm = globalObject->vm();
    auto* pending = vm.exceptionForInspection();
    if (pending && !vm.isTerminationException(pending)) [[unlikely]]
        return 2;
    return globalObject->drainMicrotasks();
}

template<class Visitor, class T> static void visitGlobalObjectMember(Visitor& visitor, T& anything)
{
    anything.visit(visitor);
}

// Member kinds whose visit is layout-generic: every LazyProperty<JSGlobalObject, T>
// is one tagged pointer word and every WriteBarrier<T> to a cell is one JSCell*,
// whatever T is, so a (byte offset, kind) pair is enough to visit them.
enum class GlobalObjectGCMemberKind : uint8_t {
    Other,
    LazyProperty,
    LazyClassStructure,
    WriteBarrierCell,
    WriteBarrierValue,
};
template<typename T> static constexpr GlobalObjectGCMemberKind globalObjectGCMemberKind = GlobalObjectGCMemberKind::Other;
template<typename T> static constexpr GlobalObjectGCMemberKind globalObjectGCMemberKind<LazyProperty<JSGlobalObject, T>> = GlobalObjectGCMemberKind::LazyProperty;
template<> constexpr GlobalObjectGCMemberKind globalObjectGCMemberKind<LazyClassStructure> = GlobalObjectGCMemberKind::LazyClassStructure;
template<typename T> static constexpr GlobalObjectGCMemberKind globalObjectGCMemberKind<WriteBarrier<T>> = GlobalObjectGCMemberKind::WriteBarrierCell;
template<> constexpr GlobalObjectGCMemberKind globalObjectGCMemberKind<WriteBarrier<Unknown>> = GlobalObjectGCMemberKind::WriteBarrierValue;

struct GlobalObjectGCMember {
    unsigned offset;
    GlobalObjectGCMemberKind kind;
};

template<class Visitor>
static NEVER_INLINE void visitGlobalObjectTableMembers(GlobalObject* thisObject, Visitor& visitor, std::span<const GlobalObjectGCMember> members)
{
    auto* base = reinterpret_cast<uint8_t*>(thisObject);
    for (auto& member : members) {
        void* slot = base + member.offset;
        switch (member.kind) {
        case GlobalObjectGCMemberKind::LazyProperty:
            static_cast<LazyProperty<JSGlobalObject, JSCell>*>(slot)->visit(visitor);
            break;
        case GlobalObjectGCMemberKind::LazyClassStructure:
            static_cast<LazyClassStructure*>(slot)->visit(visitor);
            break;
        case GlobalObjectGCMemberKind::WriteBarrierCell:
            visitor.append(*static_cast<WriteBarrier<JSCell>*>(slot));
            break;
        case GlobalObjectGCMemberKind::WriteBarrierValue:
            visitor.append(*static_cast<WriteBarrier<Unknown>*>(slot));
            break;
        case GlobalObjectGCMemberKind::Other:
            break;
        }
    }
}

template<class Visitor, class T> static void visitGlobalObjectMember(Visitor& visitor, WriteBarrier<T>& barrier)
{
    visitor.append(barrier);
}

template<class Visitor, class T> static void visitGlobalObjectMember(Visitor& visitor, std::unique_ptr<T>& ptr)
{
    // The two unique_ptr members (m_builtinInternalFunctions, m_constructors) are
    // populated in the constructor initializer list, so in steady state this is
    // never null. The guard exists because the concurrent marker can visit a
    // Zig::GlobalObject picked up via conservative stack scan while its own
    // IsoSubspace slot is being recycled from a previously-destroyed global whose
    // unique_ptr members were reset to null by ~unique_ptr(); until placement-new
    // re-initializes them there is a brief window where the pointer reads as null.
    if (ptr) [[likely]]
        ptr->visit(visitor);
}

template<class Visitor, class T, size_t n> static void visitGlobalObjectMember(Visitor& visitor, std::array<WriteBarrier<T>, n>& barriers)
{
    visitor.append(barriers.begin(), barriers.end());
}

template<typename Visitor>
void GlobalObject::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    GlobalObject* thisObject = uncheckedDowncast<GlobalObject>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);

    for (auto& structure : thisObject->m_domStructures)
        visitor.append(structure);

    {
        // The GC thread has to grab the GC lock even though it is not mutating the containers.
        Locker locker { thisObject->m_gcLock };

        for (auto& guarded : thisObject->m_guardedObjects)
            guarded->visitAggregate(visitor);
    }

    // The LazyProperty / LazyClassStructure / WriteBarrier members (the vast
    // majority) are visited from an offset table by one loop; the handful of
    // other member types keep an explicit call.
    static constexpr GlobalObjectGCMember gcMembers[] = {
#define GLOBALOBJECT_GC_MEMBER_ENTRY(visibility, T, name) \
    { OBJECT_OFFSETOF(GlobalObject, name), globalObjectGCMemberKind<T> },
        FOR_EACH_GLOBALOBJECT_GC_MEMBER(GLOBALOBJECT_GC_MEMBER_ENTRY)
#undef GLOBALOBJECT_GC_MEMBER_ENTRY
    };
    visitGlobalObjectTableMembers(thisObject, visitor, gcMembers);
#define VISIT_GLOBALOBJECT_GC_MEMBER(visibility, T, name)                         \
    if constexpr (globalObjectGCMemberKind<T> == GlobalObjectGCMemberKind::Other) \
        visitGlobalObjectMember(visitor, thisObject->name);
    FOR_EACH_GLOBALOBJECT_GC_MEMBER(VISIT_GLOBALOBJECT_GC_MEMBER)
#undef VISIT_GLOBALOBJECT_GC_MEMBER

    // This runs on a concurrent GC helper thread. Fetch the VM through the
    // visitor (AbstractSlotVisitor::vm() returns m_heap.vm(), guaranteed alive
    // for the duration of marking) rather than thisObject->vm() which
    // dereferences JSGlobalObject::m_vm and can read stale bytes if the cell
    // was picked up via conservative scan mid-recycle (see the
    // visitGlobalObjectMember(unique_ptr) guard above for the same window).
    // A stale m_vm surfaces as a SEGV in TypeCastTraits<JSVMClientData>::isType
    // when downcast<> calls the virtual isWebCoreJSClientData() on garbage.
    WebCore::clientData(visitor.vm())->httpHeaderIdentifiers().template visit<Visitor>(visitor);

    thisObject->visitGeneratedLazyClasses<Visitor>(thisObject, visitor);
    thisObject->visitAdditionalChildrenInGCThread<Visitor>(visitor);
}

extern "C" bool JSGlobalObject__setTimeZone(JSC::JSGlobalObject* globalObject, const EncodedSlice* timeZone)
{
    auto& vm = JSC::getVM(globalObject);

    if (WTF::setTimeZoneOverride(Zig::toString(*timeZone))) {
        Bun::resetDateCachesAfterTimeZoneChange(vm);
        return true;
    }

    return false;
}

extern "C" void JSGlobalObject__clearTerminationException(JSC::JSGlobalObject* globalObject)
{
    auto& vm = JSC::getVM(globalObject);
    // Clear the request for the termination exception to be thrown
    vm.clearHasTerminationRequest();
    // In case it actually has been thrown, clear the exception itself as well.
    // tryClearException() refuses to clear termination exceptions, so use
    // TopExceptionScope::clearException() which clears unconditionally —
    // this function's whole purpose is to clear that specific exception so
    // execution can resume (e.g. for process.on('exit') after terminate()).
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    if (scope.exception() && vm.isTerminationException(scope.exception())) {
        scope.clearException();
    }
}

extern "C" [[ZIG_EXPORT(check_slow)]] void Bun__performTask(Zig::GlobalObject* globalObject, WebCore::EventLoopTask* task)
{
    task->performTask(*globalObject->scriptExecutionContext());
}

extern "C" void Bun__deleteEventLoopTask(WebCore::EventLoopTask* task)
{
    // Free without running. Destroys the captured WTF::Function (and any
    // Ref<> it holds) so queued cross-thread tasks don't pin their owner
    // past VM teardown.
    delete task;
}

RefPtr<Performance> GlobalObject::performance()
{
    if (!m_performance) {
        auto* context = this->scriptExecutionContext();
        double nanoTimeOrigin = Bun__readOriginTimerStart(this->bunVM());
        auto timeOrigin = MonotonicTime::fromRawSeconds(nanoTimeOrigin / 1000.0);
        m_performance = Performance::create(context, timeOrigin);
    }

    return m_performance;
}

extern "C" void Bun__handleRejectedPromise(Zig::GlobalObject* JSGlobalObject, JSC::JSPromise* promise);

void GlobalObject::handleRejectedPromises()
{
    if (m_aboutToBeNotifiedRejectedPromises.isEmpty()) [[likely]]
        return;

    JSC::VM& virtual_machine = vm();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(virtual_machine);
    do {
        // Move the whole list out under one cellLock, then iterate linearly —
        // the same pattern JSC's VM::didExhaustMicrotaskQueue and WebCore's
        // RejectedPromiseTracker use.
        JSC::MarkedArgumentBuffer promises;
        m_aboutToBeNotifiedRejectedPromises.drainTo(this, promises);
        RELEASE_ASSERT(!promises.hasOverflowed());
        // Expose the not-yet-processed tail so promiseRejectionTracker(Handle)
        // can tell "still pending" apart from "already notified". Linked as a
        // stack so a re-entrant handleRejectedPromises() (a handler that ticks
        // the event loop) restores the outer frame instead of nulling it.
        InFlightRejections inflight { &promises, 0, m_rejectedPromisesBeingProcessed };
        WTF::SetForScope inflightScope(m_rejectedPromisesBeingProcessed, &inflight);
        for (size_t i = 0, size = promises.size(); i < size; ++i) {
            auto* promise = static_cast<JSC::JSPromise*>(promises.at(i).asCell());
            if (promise->isHandled())
                continue;
            inflight.index = i + 1;

            Bun__handleRejectedPromise(this, promise);
            if (auto ex = scope.exception()) {
                if (virtual_machine.isTerminationException(ex)) [[unlikely]]
                    return;
                (void)scope.tryClearException();
                this->reportUncaughtExceptionAtEventLoop(this, ex);
            }
        }
        // An unhandledRejection handler may itself reject a promise; loop
        // until the list stays empty.
    } while (!m_aboutToBeNotifiedRejectedPromises.isEmpty());
}

DEFINE_VISIT_CHILDREN(GlobalObject);

template<typename Visitor>
void GlobalObject::visitAdditionalChildrenInGCThread(Visitor& visitor)
{
    GlobalObject* thisObject = this;
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());

    thisObject->globalEventScope->visitJSEventListeners(visitor);

    thisObject->m_aboutToBeNotifiedRejectedPromises.visit(thisObject, visitor);

    ScriptExecutionContext* context = thisObject->scriptExecutionContext();
    visitor.addOpaqueRoot(context);
}

DEFINE_VISIT_ADDITIONAL_CHILDREN_IN_GC_THREAD(GlobalObject);

template<typename Visitor>
void GlobalObject::visitOutputConstraints(JSCell* cell, Visitor& visitor)
{
    auto* thisObject = uncheckedDowncast<GlobalObject>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitOutputConstraints(thisObject, visitor);
    thisObject->visitAdditionalChildrenInGCThread(visitor);
}

template void GlobalObject::visitOutputConstraints(JSCell*, AbstractSlotVisitor&);
template void GlobalObject::visitOutputConstraints(JSCell*, SlotVisitor&);

// void GlobalObject::destroy(JSCell* cell)
// {
//     uncheckedDowncast<Zig::GlobalObject>(cell)->Zig::GlobalObject::~Zig::GlobalObject();
// }

// template<typename Visitor>
// void GlobalObject::visitChildrenImpl(JSCell* cell, Visitor& visitor)
// {
//     Zig::GlobalObject* thisObject = uncheckedDowncast<Zig::GlobalObject>(cell);
//     ASSERT_GC_OBJECT_INHERITS(thisObject, info());
//     Base::visitChildren(thisObject, visitor);

//     {
//         // The GC thread has to grab the GC lock even though it is not mutating the containers.
//         Locker locker { thisObject->m_gcLock };

//         for (auto& structure : thisObject->m_structures.values())
//             visitor.append(structure);

//         for (auto& guarded : thisObject->m_guardedObjects)
//             guarded->visitAggregate(visitor);
//     }

//     for (auto& constructor : thisObject->constructors().array())
//         visitor.append(constructor);

//     thisObject->m_builtinInternalFunctions.visit(visitor);
// }

// DEFINE_VISIT_CHILDREN(Zig::GlobalObject);

void GlobalObject::clearModuleRegistry()
{
    {
        auto* moduleLoader = this->moduleLoader();
        // JSModuleLoader::visitChildrenImpl iterates these maps on the GC thread under cellLock().
        WTF::Locker locker { moduleLoader->cellLock() };
        moduleLoader->clearAll();
    }
    this->requireMap()->clear(this);
}

void GlobalObject::reload()
{
    auto& vm = this->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    this->clearModuleRegistry();
    RETURN_IF_EXCEPTION(scope, );

    // If we run the GC every time, we will never get the SourceProvider cache hit.
    // So we run the GC every other time.
    if ((this->reloadCount++ + 1) % 2 == 0) {
        this->vm().heap.collectSync();
    }
}

extern "C" [[ZIG_EXPORT(check_slow)]] void JSC__JSGlobalObject__reload(JSC::JSGlobalObject* arg0)
{
    Zig::GlobalObject* globalObject = static_cast<Zig::GlobalObject*>(arg0);
    globalObject->reload();
}

extern "C" void JSC__JSGlobalObject__queueMicrotaskCallback(Zig::GlobalObject* globalObject, void* ptr, MicrotaskCallback callback)
{
    JSFunction* function = globalObject->nativeMicrotaskTrampoline();

#if ASSERT_ENABLED
    ASSERT_WITH_MESSAGE(function, "Invalid microtask function");
    ASSERT_WITH_MESSAGE(ptr, "Invalid microtask context");
    ASSERT_WITH_MESSAGE(callback, "Invalid microtask callback");
#endif

    // Do not use JSCell* here because the GC will try to visit it.
    // Use BunInvokeJobWithArguments to pass the two arguments (ptr and callback) to the trampoline function
    JSC::QueuedTask task { nullptr, JSC::InternalMicrotask::BunInvokeJobWithArguments, 0, globalObject, function, JSValue(std::bit_cast<double>(reinterpret_cast<uintptr_t>(ptr))), JSValue(std::bit_cast<double>(reinterpret_cast<uintptr_t>(callback))) };
    globalObject->vm().queueMicrotask(WTF::move(task));
}

extern "C" const Latin1Character* Bun__standaloneModuleKey(const Latin1Character*, size_t, size_t* outLength);
extern "C" bool Bun__standaloneModuleHasModuleInfo(const Latin1Character*, size_t);
extern "C" bool Bun__hasStandaloneModuleGraph();
extern "C" int ModuleLoader__builtinAliasIndex(const Latin1Character*, size_t);
extern "C" bool Bun__hasPluginRunner(void*);
JSC::Identifier GlobalObject::moduleLoaderResolve(JSGlobalObject* jsGlobalObject,
    JSModuleLoader* loader, JSValue key,
    JSValue referrer, RefPtr<JSC::ScriptFetcher>, bool)
{
    Zig::GlobalObject* globalObject = static_cast<Zig::GlobalObject*>(jsGlobalObject);
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    WTF::String keyString;
    if (key.isString()) {
        auto moduleName = uncheckedDowncast<JSString>(key)->value(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        if (!globalObject->onLoadPlugins.hasVirtualModules() && !Bun__hasPluginRunner(globalObject->bunVM())) {
            CString narrowed;
            std::span<const Latin1Character> chars;
            if (moduleName->is8Bit())
                chars = moduleName->span8();
            else if (moduleName->containsOnlyLatin1()) {
                narrowed = moduleName->latin1();
                chars = { std::bit_cast<const Latin1Character*>(narrowed.data()), narrowed.length() };
            }
            if (chars.data()) {
                if (int index = ModuleLoader__builtinAliasIndex(chars.data(), chars.size()); index >= 0)
                    return Identifier::fromString(vm, Bun::builtinModuleKeys[index]);
            }
        }
        if (moduleName->startsWith("file://"_s)) {
            auto url = WTF::URL(moduleName);
            if (url.isValid() && !url.isEmpty()) {
                keyString = url.fileSystemPath();
            } else {
                keyString = moduleName;
            }
        } else {
            keyString = moduleName;
        }
    } else {
        keyString = key.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
    }
    WTF::String referrerString;
    if (referrer && referrer.isString()) {
        referrerString = referrer.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
    }

    if (globalObject->onLoadPlugins.hasVirtualModules()) {
        if (auto resolvedString = globalObject->onLoadPlugins.resolveVirtualModule(keyString, referrerString)) {
            return Identifier::fromString(vm, resolvedString.value());
        }
    } else {
        ASSERT(!globalObject->onLoadPlugins.mustDoExpensiveRelativeLookup);
    }

    // The new C++ loader calls resolve() on keys that moduleLoaderImportModule
    // already resolved through plugin onResolve. If the key already carries a
    // plugin namespace that has an onLoad handler, it is a fully-resolved
    // virtual key — return it unchanged so we don't fall through to the
    // filesystem resolver and fail with "Cannot find module".
    //
    // FIXME(module-loader): this short-circuit ignores the plugin's filter
    // and bypasses any onResolve handler for static imports written directly
    // as "ns:..." in source. The proper fix is for moduleLoaderImportModule
    // to mark keys it already resolved so we can skip only those.
    if (!globalObject->onLoadPlugins.namespaces.isEmpty()) {
        if (auto colon = keyString.find(':'); colon != WTF::notFound && !(colon == 1 && isASCIIAlpha(keyString[0]))) {
            // colon == 1 with a leading ASCII letter is a Windows drive
            // ("C:\\..."), never a plugin namespace.
            auto ns = keyString.left(colon);
            for (const auto& registered : globalObject->onLoadPlugins.namespaces) {
                if (registered == ns) {
                    return Identifier::fromString(vm, keyString);
                }
            }
        }
    }

    ErrorableString res;
    BunString keyZ = Bun::toString(keyString);
    BunString referrerZ = Bun::toString(referrerString);
    BunString queryZ = BunStringEmpty;
    Zig__GlobalObject__resolve(&res, globalObject, &keyZ, &referrerZ, &queryZ);
    RETURN_IF_EXCEPTION(scope, {});
    if (!res.success) {
        throwException(scope, res.result.err, globalObject);
        return {};
    }
    auto resolved = res.result.value.transferToWTFString();
    auto query = queryZ.transferToWTFString();

    if (!query.isEmpty()) {
        return Identifier::fromString(vm, makeString(resolved, query));
    }
    return Identifier::fromString(vm, resolved);
}

JSC::Identifier StandaloneGlobalObject::moduleLoaderResolve(JSGlobalObject* globalObject, JSModuleLoader* loader, JSValue key, JSValue referrer, RefPtr<JSC::ScriptFetcher> fetcher, bool b)
{
    // Embedded modules import each other by their final `/$bunfs/` key; hand it straight back (unless a plugin could claim it).
    auto* zigGlobalObject = static_cast<Zig::GlobalObject*>(globalObject);
    if (key.isString() && !zigGlobalObject->onLoadPlugins.hasVirtualModules() && !Bun__hasPluginRunner(zigGlobalObject->bunVM())) {
        auto* string = uncheckedDowncast<JSString>(key);
        if (!string->isRope()) {
            auto view = string->tryGetValue();
            if (view->is8Bit()) {
                auto span = view->span8();
                size_t canonicalLength = 0;
                if (const Latin1Character* canonical = Bun__standaloneModuleKey(span.data(), span.size(), &canonicalLength)) {
                    // The graph's spelling is the printed specifier's on POSIX; on Windows it fixes the separator form.
                    if (canonicalLength == span.size() && !memcmp(canonical, span.data(), canonicalLength))
                        return Identifier::fromString(globalObject->vm(), string->tryGetValue());
                    return Identifier::fromString(globalObject->vm(), String({ canonical, canonicalLength }));
                }
            }
        }
    }
    return GlobalObject::moduleLoaderResolve(globalObject, loader, key, referrer, WTF::move(fetcher), b);
}

JSC::JSPromise* GlobalObject::moduleLoaderImportModule(JSGlobalObject* jsGlobalObject,
    JSModuleLoader*,
    JSString* moduleNameValue,
    RefPtr<JSC::ScriptFetchParameters> parameters,
    const SourceOrigin& sourceOrigin,
    bool deferred)
{
    UNUSED_PARAM(deferred);
    auto* globalObject = static_cast<Zig::GlobalObject*>(jsGlobalObject);

    VM& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    {
        JSC::JSPromise* result = NodeVM::importModule(globalObject, moduleNameValue, parameters, sourceOrigin);
        RETURN_IF_EXCEPTION(scope, nullptr);
        if (result) {
            return result;
        }
    }

    JSC::Identifier resolvedIdentifier;

    // Not `auto` (GCOwnedDataScope): importModule below can drive moduleLoaderFetch synchronously; see that function for why no scope may be live.
    WTF::String moduleName = moduleNameValue->value(globalObject);
    RETURN_IF_EXCEPTION(scope, nullptr);

    auto sourceURL = sourceOrigin.url();
    String sourceOriginStringHolder;
    int64_t referrerAsyncOrder = -1;
    if (sourceURL.isEmpty()) {
        sourceOriginStringHolder = String("."_s);
    } else if (sourceURL.protocolIsFile()) {
        sourceOriginStringHolder = sourceURL.fileSystemPath();
        auto query = sourceURL.queryWithLeadingQuestionMark();
        auto referrerKey = query.isEmpty()
            ? JSC::Identifier::fromString(vm, sourceOriginStringHolder)
            : JSC::Identifier::fromString(vm, makeString(sourceOriginStringHolder, query));
        referrerAsyncOrder = globalObject->moduleLoader()->asyncEvaluationOrderForKey(referrerKey);
    } else if (sourceURL.protocol() == "builtin"_s) {
        ASSERT(sourceURL.string().startsWith("builtin://"_s));
        sourceOriginStringHolder = sourceURL.string().substringSharingImpl(10 /* builtin:// */);
    } else {
        sourceOriginStringHolder = sourceURL.path().toString();
    }

    if (globalObject->onLoadPlugins.hasVirtualModules()) {
        if (auto resolution = globalObject->onLoadPlugins.resolveVirtualModule(moduleName, sourceURL.protocolIsFile() ? sourceOriginStringHolder : String())) {
            resolvedIdentifier = JSC::Identifier::fromString(vm, resolution.value());

            auto result = JSC::importModule(globalObject, resolvedIdentifier, JSC::Identifier(), parameters, nullptr, /* deferred */ false, referrerAsyncOrder);
            if (scope.exception()) [[unlikely]] {
                return JSC::JSPromise::rejectedPromiseWithCaughtException(globalObject, scope);
            }
            return result;
        }
    }

    {
        if (moduleName.startsWith("file://"_s)) {
            auto url = WTF::URL(moduleName);
            if (url.isValid() && !url.isEmpty()) {
                moduleName = url.fileSystemPath();
            }
        }

        ErrorableString res;
        BunString moduleNameZ = Bun::toString(moduleName);
        BunString sourceOriginZ = Bun::toString(sourceOriginStringHolder);
        BunString queryZ = BunStringEmpty;
        Zig__GlobalObject__resolve(&res, globalObject, &moduleNameZ, &sourceOriginZ, &queryZ);
        RETURN_IF_EXCEPTION(scope, JSC::JSPromise::rejectedPromiseWithCaughtException(globalObject, scope));
        if (!res.success) [[unlikely]] {
            throwException(scope, res.result.err, globalObject);
            return JSC::JSPromise::rejectedPromiseWithCaughtException(globalObject, scope);
        }
        auto resolved = res.result.value.transferToWTFString();
        auto query = queryZ.transferToWTFString();

        if (query.isEmpty()) {
            resolvedIdentifier = JSC::Identifier::fromString(vm, resolved);
        } else {
            resolvedIdentifier = JSC::Identifier::fromString(vm, makeString(resolved, query));
        }
    }

    // The C++ module loader now extracts `with.type` into a
    // ScriptFetchParameters before calling this hook, so `parameters` is
    // already the parsed RefPtr (or null). Just forward it.
    auto result = JSC::importModule(globalObject, resolvedIdentifier,
        JSC::Identifier(), WTF::move(parameters), nullptr, /* deferred */ false, referrerAsyncOrder);
    if (scope.exception()) [[unlikely]] {
        return JSC::JSPromise::rejectedPromiseWithCaughtException(globalObject, scope);
    }

    ASSERT(result);
    return result;
}

static JSC::JSPromise* rejectedInternalPromise(JSC::JSGlobalObject* globalObject, JSC::JSValue value)
{
    auto& vm = JSC::getVM(globalObject);
    JSPromise* promise = JSPromise::create(vm, globalObject->promiseStructure());
    promise->rejectAsHandled(vm, value);
    return promise;
}

static JSC::JSPromise* resolvedInternalPromise(JSC::JSGlobalObject* globalObject, JSC::JSValue value)
{
    auto& vm = JSC::getVM(globalObject);
    JSPromise* promise = JSPromise::create(vm, globalObject->promiseStructure());
    promise->fulfill(vm, value);
    return promise;
}

JSC::JSPromise* GlobalObject::moduleLoaderFetch(JSGlobalObject* globalObject,
    JSModuleLoader* loader, JSValue key, const WTF::String&,
    RefPtr<JSC::ScriptFetchParameters> parameters, RefPtr<JSC::ScriptFetcher>)
{
    auto& vm = JSC::getVM(globalObject);

    auto scope = DECLARE_THROW_SCOPE(vm);

    auto moduleKeyJS = key.toString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    // Not `auto` (GCOwnedDataScope): fetchESMSourceCode can transpile the main entry synchronously and spin the event loop for an async macro, during which IncrementalSweeper asserts no scope is live with entryScope null.
    WTF::String moduleKey = moduleKeyJS->value(globalObject);
    if (scope.exception()) [[unlikely]]
        return rejectedInternalPromise(globalObject, scope.exception()->value());

    if (moduleKey.endsWith(".node"_s)) {
        return rejectedInternalPromise(globalObject, createTypeError(globalObject, "To load Node-API modules, use require() or process.dlopen instead of import."_s));
    }

    auto moduleKeyBun = Bun::toString(moduleKey);
    auto& sourceString = vm.propertyNames->undefinedKeyword.string();
    auto typeAttributeString = String();

    if (parameters) {
        if (parameters->type() == ScriptFetchParameters::Type::HostDefined) {
            typeAttributeString = parameters->hostDefinedImportType();
        } else if (parameters->type() == ScriptFetchParameters::Type::JSON) {
            typeAttributeString = "json"_s;
        } else if (parameters->type() == ScriptFetchParameters::Type::WebAssembly) {
            typeAttributeString = "webassembly"_s;
        }
    }

    auto source = Bun::toString(sourceString);
    auto typeAttribute = Bun::toString(typeAttributeString);
    ErrorableResolvedSource res;

    // require(esm) needs the entire dependency graph to load without yielding
    // to microtasks. The async fetch path goes through the transpiler thread
    // pool; route to the synchronous fetch instead so the returned promise is
    // already fulfilled and the loader keeps draining its private queue (see
    // JSModuleLoader::loadModuleSync / VM::m_synchronousModuleQueue).
    if (vm.m_synchronousModuleQueue) {
        JSValue result = Bun::fetchESMSourceCodeSync(
            static_cast<Zig::GlobalObject*>(globalObject),
            moduleKeyJS,
            &res,
            &moduleKeyBun,
            &source,
            typeAttributeString.isEmpty() ? nullptr : &typeAttribute);
        RETURN_IF_EXCEPTION(scope, rejectedInternalPromise(globalObject, scope.exception()->value()));
        if (auto* promise = dynamicDowncast<JSC::JSPromise>(result))
            return promise;
        if (result && result.inherits<JSC::JSSourceCode>())
            return resolvedInternalPromise(globalObject, result);
        return rejectedInternalPromise(globalObject, result ? result : JSC::jsUndefined());
    }

    JSValue result = Bun::fetchESMSourceCodeAsync(
        static_cast<Zig::GlobalObject*>(globalObject),
        moduleKeyJS,
        &res,
        &moduleKeyBun,
        &source,
        typeAttributeString.isEmpty() ? nullptr : &typeAttribute);

    RETURN_IF_EXCEPTION(scope, rejectedInternalPromise(globalObject, scope.exception()->value()));
    ASSERT(result);
    if (auto* promise = dynamicDowncast<JSC::JSPromise>(result)) {
        return promise;
    }
    return rejectedInternalPromise(globalObject, result);
}

extern "C" JSModuleRecord* zig__ModuleInfoDeserialized__toJSModuleRecord(JSGlobalObject*, VM&, const Identifier&, const SourceCode&, bun_ModuleInfoDeserialized*);
extern "C" void zig__ModuleInfoDeserialized__deinit(bun_ModuleInfoDeserialized*);

// Synchronous fetch through Bun's loader (embedded modules are bytecode-backed and builtins are in-process, so neither
// needs the transpiler thread).
static JSSourceCode* fetchSourceSync(Zig::GlobalObject* globalObject, const Identifier& key)
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    ErrorableResolvedSource res;
    auto keyBun = Bun::toString(key.string());
    auto source = Bun::toString(vm.propertyNames->undefinedKeyword.string());
    JSValue result = Bun::fetchESMSourceCodeSync(globalObject, jsString(vm, key.string()), &res, &keyBun, &source, nullptr);
    RETURN_IF_EXCEPTION(scope, nullptr);
    return result ? dynamicDowncast<JSSourceCode>(result) : nullptr;
}

// The module_info-carrying provider of an embedded ES module, or null (CommonJS wrappers, JSON, etc. take the normal path).
static Zig::SourceProvider* transpiledModuleProvider(JSSourceCode* jsSourceCode)
{
    auto* provider = jsSourceCode->sourceCode().provider();
    if (!provider || provider->sourceType() != JSC::SourceProviderSourceType::BunTranspiledModule)
        return nullptr;
    auto* zigProvider = static_cast<Zig::SourceProvider*>(provider);
    return zigProvider->m_moduleInfo ? zigProvider : nullptr;
}

static void releaseModuleInfo(Zig::GlobalObject* globalObject, JSSourceCode* jsSourceCode)
{
    auto* provider = transpiledModuleProvider(jsSourceCode);
    // Same ownership rule as Bun__analyzeTranspiledModule: a provider shared across globals keeps its module_info.
    if (provider && !Bun::IsolatedModuleCache::canUse(globalObject->vm(), globalObject->bunVM())) {
        zig__ModuleInfoDeserialized__deinit(provider->m_moduleInfo);
        provider->m_moduleInfo = nullptr;
    }
}

namespace {
struct ClosureModule {
    Identifier key;
    JSSourceCode* source { nullptr };
    AbstractModuleRecord* record { nullptr };
    Vector<Identifier> resolvedRequests; // registry key per requestedModules() entry, filled when the closure is complete
};
struct StandaloneClosure {
    Vector<ClosureModule, 64> modules; // modules[0] is the root
    HashMap<RefPtr<UniquedStringImpl>, AbstractModuleRecord*, IdentifierRepHash> records; // every key an edge can point at
    bool complete { true };
};
}

// Build (without registering) the module record of every module statically reachable from the root: embedded ES modules
// from their serialized module_info, Bun's builtin modules through the loader's synchronous fetch + makeModule. Nothing
// here runs user code. Anything else reachable (a CommonJS file, a typed import, a module some other load has in
// flight) marks the closure incomplete and is left entirely to JSC's normal pipeline.
static void collectStandaloneClosure(Zig::GlobalObject* globalObject, JSModuleLoader* loader, StandaloneClosure& closure, MarkedArgumentBuffer& keepAlive)
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    closure.records.add(closure.modules[0].key.impl(), closure.modules[0].record);
    for (size_t index = 0; index < closure.modules.size(); ++index) {
        auto& requests = closure.modules[index].record->requestedModules();
        Vector<Identifier> resolved(requests.size(), [](size_t) { return Identifier(); });
        for (size_t i = 0; i < requests.size(); ++i) {
            auto& request = requests[i];
            if (request.m_attributes && request.m_attributes->type() != ScriptFetchParameters::Type::JavaScript) {
                closure.complete = false;
                continue;
            }
            // Embedded modules import each other by final key, so most edges dedup without a resolve.
            Identifier key = request.m_specifier;
            if (!closure.records.contains(key.impl())) {
                key = StandaloneGlobalObject::moduleLoaderResolve(globalObject, loader, identifierToJSValue(vm, request.m_specifier), identifierToJSValue(vm, closure.modules[index].key), nullptr, false);
                RETURN_IF_EXCEPTION(scope, void());
            }
            resolved[i] = key;
            if (closure.records.contains(key.impl()))
                continue;
            if (auto* entry = loader->registryEntry(key)) {
                // Usable as a loaded dependency only if the loader already finished loading that module's own subgraph.
                if (entry->record() && entry->isLoaded())
                    closure.records.add(key.impl(), entry->record());
                else
                    closure.complete = false;
                continue;
            }

            bool embedded = key.string().is8Bit() && Bun__standaloneModuleHasModuleInfo(key.string().span8().data(), key.length());
            bool builtin = !embedded && key.string().is8Bit() && ModuleLoader__builtinAliasIndex(key.string().span8().data(), key.length()) >= 0;
            if (!embedded && !builtin) {
                closure.complete = false;
                continue;
            }
            JSSourceCode* source = fetchSourceSync(globalObject, key);
            RETURN_IF_EXCEPTION(scope, void());
            if (!source) {
                closure.complete = false;
                continue;
            }
            keepAlive.append(source);
            if (keepAlive.hasOverflowed()) [[unlikely]] {
                closure.complete = false;
                return;
            }

            AbstractModuleRecord* record = nullptr;
            if (auto* provider = embedded ? transpiledModuleProvider(source) : nullptr) {
                record = zig__ModuleInfoDeserialized__toJSModuleRecord(globalObject, vm, key, source->sourceCode(), provider->m_moduleInfo);
                RETURN_IF_EXCEPTION(scope, void());
            } else if (builtin && source->sourceCode().provider()->sourceType() == JSC::SourceProviderSourceType::Synthetic) {
                JSPromise* made = JSModuleLoader::makeModule(globalObject, key, source);
                RETURN_IF_EXCEPTION(scope, void());
                if (made && made->status() == JSPromise::Status::Fulfilled)
                    record = dynamicDowncast<AbstractModuleRecord>(made->result());
            }
            if (!record) {
                closure.complete = false;
                continue;
            }
            keepAlive.append(record);
            if (keepAlive.hasOverflowed()) [[unlikely]] {
                closure.complete = false;
                return;
            }
            closure.records.add(key.impl(), record);
            closure.modules.append({ key, source, record, {} });
        }
        closure.modules[index].resolvedRequests = WTF::move(resolved);
    }
}

// Register the collected modules as fetched. When the closure is complete, every module any of them can reach is in it,
// so they are marked loaded outright — [[LoadedModules]] filled and the entry marked loaded — and JSC's graph walk finishes
// without a HostLoadImportedModule call or microtask per edge. Otherwise they are left the way JSC's own
// fetch -> makeModule chain leaves them and JSC runs one load step per module to finish the job.
static void registerStandaloneClosure(Zig::GlobalObject* globalObject, JSModuleLoader* loader, StandaloneClosure& closure)
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    for (auto& m : closure.modules) {
        auto* entry = loader->ensureRegistered(globalObject, m.key, ScriptFetchParameters::Type::JavaScript);
        RETURN_IF_EXCEPTION(scope, void());
        RELEASE_ASSERT(!entry->record()); // nothing between collect and register can register one of these keys
        entry->provideModule(vm, m.record);
        releaseModuleInfo(globalObject, m.source);
    }
    if (!closure.complete)
        return;
    for (auto& m : closure.modules) {
        auto& requests = m.record->requestedModules();
        for (size_t i = 0; i < requests.size(); ++i) {
            AbstractModuleRecord* target = closure.records.get(m.resolvedRequests[i].impl());
            RELEASE_ASSERT(target);
            m.record->setImportedModule(globalObject, requests[i], target);
            RETURN_IF_EXCEPTION(scope, void());
        }
    }
    for (auto& m : closure.modules)
        loader->registryEntry(m.key)->markLoaded();
}

JSC::JSPromise* StandaloneGlobalObject::moduleLoaderFetch(JSGlobalObject* jsGlobalObject, JSModuleLoader* loader, JSValue key, const WTF::String& referrer, RefPtr<JSC::ScriptFetchParameters> parameters, RefPtr<JSC::ScriptFetcher> fetcher)
{
    auto* globalObject = static_cast<Zig::GlobalObject*>(jsGlobalObject);
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    bool plainJS = !parameters || parameters->type() == ScriptFetchParameters::Type::JavaScript;
    if (!plainJS || globalObject->onLoadPlugins.hasVirtualModules() || Bun__hasPluginRunner(globalObject->bunVM()))
        RELEASE_AND_RETURN(scope, GlobalObject::moduleLoaderFetch(jsGlobalObject, loader, key, referrer, WTF::move(parameters), WTF::move(fetcher)));

    JSString* keyJS = key.toString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    String keyString = keyJS->value(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    if (!keyString.is8Bit() || keyString.endsWith(".node"_s) || !Bun__standaloneModuleHasModuleInfo(keyString.span8().data(), keyString.length()))
        RELEASE_AND_RETURN(scope, GlobalObject::moduleLoaderFetch(jsGlobalObject, loader, key, referrer, WTF::move(parameters), WTF::move(fetcher)));

    Identifier rootKey = Identifier::fromString(vm, keyString);
    JSSourceCode* rootSource = fetchSourceSync(globalObject, rootKey);
    RETURN_IF_EXCEPTION(scope, rejectedInternalPromise(globalObject, scope.exception()->value()));
    if (!rootSource)
        RELEASE_AND_RETURN(scope, GlobalObject::moduleLoaderFetch(jsGlobalObject, loader, key, referrer, WTF::move(parameters), WTF::move(fetcher)));

    auto* provider = transpiledModuleProvider(rootSource);
    if (!provider)
        RELEASE_AND_RETURN(scope, resolvedInternalPromise(globalObject, rootSource));

    MarkedArgumentBuffer keepAlive;
    keepAlive.append(rootSource);
    JSModuleRecord* rootRecord = zig__ModuleInfoDeserialized__toJSModuleRecord(globalObject, vm, rootKey, rootSource->sourceCode(), provider->m_moduleInfo);
    RETURN_IF_EXCEPTION(scope, rejectedInternalPromise(globalObject, scope.exception()->value()));
    if (!rootRecord)
        RELEASE_AND_RETURN(scope, resolvedInternalPromise(globalObject, rootSource));
    keepAlive.append(rootRecord);
    if (keepAlive.hasOverflowed()) [[unlikely]]
        RELEASE_AND_RETURN(scope, resolvedInternalPromise(globalObject, rootSource));

    StandaloneClosure closure;
    closure.modules.append({ rootKey, rootSource, rootRecord, {} });
    collectStandaloneClosure(globalObject, loader, closure, keepAlive);
    RETURN_IF_EXCEPTION(scope, rejectedInternalPromise(globalObject, scope.exception()->value()));
    // When HostLoadImportedModule already created the root's entry it sets the root's status and loadPromise itself
    // once this hook returns, so the root (and therefore anything that can reach it) cannot be marked loaded here.
    if (loader->registryEntry(rootKey))
        closure.complete = false;
    if (!closure.complete) {
        // The root goes through the caller's own fetch -> makeModule pipeline (which reads its module_info again); only
        // the dependencies are registered ahead.
        closure.modules.removeAt(0);
    }
    registerStandaloneClosure(globalObject, loader, closure);
    RETURN_IF_EXCEPTION(scope, rejectedInternalPromise(globalObject, scope.exception()->value()));
    RELEASE_AND_RETURN(scope, resolvedInternalPromise(globalObject, rootSource));
}

JSC::JSObject* GlobalObject::moduleLoaderCreateImportMetaProperties(JSGlobalObject* globalObject,
    JSModuleLoader* loader,
    JSValue key,
    JSModuleRecord* record,
    RefPtr<JSC::ScriptFetcher>)
{
    return Zig::ImportMetaObject::create(globalObject, key);
}

extern "C" bool Bun__VM__entryEvaluationStarted(void*);
extern "C" BunString Bun__VM__entryRootKey(void*);
extern "C" void Bun__VM__noteEntryEvaluationStarted(void*);

// A module body is about to run. That means "the entry's graph is linked and executing" only if it is
// part of the entry root's own evaluation — the root's record is Evaluating (or beyond) from the moment
// linkAndEvaluateModule() enters it, and its dependencies run inside that (post-order). A module that
// evaluates before then is some other root: a preload's un-awaited import() finishing while the entry is
// still fetching.
static void noteModuleEvaluation(Zig::GlobalObject* globalObject, JSModuleLoader* moduleLoader)
{
    void* bunVM = globalObject->bunVM();
    if (Bun__VM__entryEvaluationStarted(bunVM))
        return;
    BunString rootKey = Bun__VM__entryRootKey(bunVM);
    auto* entry = moduleLoader->registryEntry(JSC::Identifier::fromString(globalObject->vm(), rootKey.toWTFString(BunString::ZeroCopy)));
    if (!entry)
        return;
    auto* cyclic = dynamicDowncast<JSC::CyclicModuleRecord>(entry->record());
    if (!cyclic || cyclic->status() < JSC::CyclicModuleRecord::Status::Evaluating)
        return;
    Bun__VM__noteEntryEvaluationStarted(bunVM);
}

JSC::JSValue GlobalObject::moduleLoaderEvaluate(JSGlobalObject* lexicalGlobalObject,
    JSModuleLoader* moduleLoader, JSValue key,
    JSValue moduleRecordValue, RefPtr<JSC::ScriptFetcher> scriptFetcher,
    JSValue sentValue, JSValue resumeMode)
{
    noteModuleEvaluation(defaultGlobalObject(lexicalGlobalObject), moduleLoader);
    return moduleLoader->evaluateNonVirtual(lexicalGlobalObject, key, moduleRecordValue,
        WTF::move(scriptFetcher), sentValue, resumeMode);
}

extern "C" bool Bun__VM__specifierIsEvalEntryPoint(void*, EncodedJSValue);
extern "C" void Bun__VM__setEntryPointEvalResultESM(void*, EncodedJSValue);

JSC::JSValue EvalGlobalObject::moduleLoaderEvaluate(JSGlobalObject* lexicalGlobalObject,
    JSModuleLoader* moduleLoader, JSValue key,
    JSValue moduleRecordValue, RefPtr<JSC::ScriptFetcher> scriptFetcher,
    JSValue sentValue, JSValue resumeMode)
{
    Zig::GlobalObject* globalObject = uncheckedDowncast<Zig::GlobalObject>(lexicalGlobalObject);
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    noteModuleEvaluation(globalObject, moduleLoader);
    JSC::JSValue result = moduleLoader->evaluateNonVirtual(lexicalGlobalObject, key, moduleRecordValue,
        WTF::move(scriptFetcher), sentValue, resumeMode);
    // The new C++ loader propagates the module body's throw out of
    // evaluateNonVirtual; the old JS-side ModuleLoader.js swallowed it before
    // dispatching here. Don't call back into native code (which opens an
    // ExceptionValidationScope) with an exception still pending.
    RETURN_IF_EXCEPTION(scope, result);

    if (Bun__VM__specifierIsEvalEntryPoint(globalObject->bunVM(), JSValue::encode(key))) {
        // For a module with top-level `await`, JSC compiles the body as a
        // generator and the first call into evaluate() yields the awaited
        // value — NOT the module's final completion value. If we captured
        // that yielded value here, `bun -p '(await 1) + 1'` would print `1`
        // instead of `2`. The resume path (asyncModuleExecutionResume in
        // WebKit) calls module->evaluate() directly and bypasses this hook,
        // so we can't rely on a later call to overwrite the captured value.
        //
        // Instead, when the module yielded, capture the async capability's
        // promise. Its resolution value is the module's final completion
        // value; the --print loop in run_command.rs already unwraps promises
        // via asAnyPromise + Bun__onResolveEntryPointResult.
        JSC::JSValue valueToStore = result;
        if (auto* moduleRecord = dynamicDowncast<JSC::AbstractModuleRecord>(moduleRecordValue)) {
            JSC::JSValue state = moduleRecord->internalField(JSC::AbstractModuleRecord::Field::State).get();
            bool moduleYielded = state.isNumber() && state.asNumber() != static_cast<int32_t>(JSC::JSGenerator::State::Executing);
            if (moduleYielded) {
                if (auto* capability = moduleRecord->asyncCapability())
                    valueToStore = capability;
            }
        }
        Bun__VM__setEntryPointEvalResultESM(globalObject->bunVM(), JSValue::encode(valueToStore));
    }

    return result;
}

extern "C" JSC::EncodedJSValue Zig__GlobalObject__getBodyStreamOrBytesForWasmStreaming(JSGlobalObject*, EncodedJSValue response, JSC::Wasm::StreamingCompiler* compiler);

extern "C" void JSC__Wasm__StreamingCompiler__addBytes(JSC::Wasm::StreamingCompiler* compiler, const uint8_t* spanPtr, size_t spanSize)
{
    compiler->addBytes(std::span(spanPtr, spanSize));
}

static void handleResponseOnStreamingAction(JSGlobalObject* lexicalGlobalObject, JSC::JSPromise* promise, JSC::JSValue source, JSC::Wasm::CompilerMode mode, JSC::JSObject* importObject, std::optional<JSC::WebAssemblyCompileOptions>&& compileOptions)
{
    auto globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSC::JSLockHolder locker(vm);

    auto sourceCode = makeSource("[wasm code]"_s, SourceOrigin(), SourceTaintedOrigin::Untainted);
    auto compiler = JSC::Wasm::StreamingCompiler::create(vm, mode, globalObject, promise, importObject, WTF::move(compileOptions), sourceCode);

    // The streaming hook used to return a freshly created promise; the caller
    // (webAssemblyCompileStreamingFunc) was a host function that propagated
    // any pending exception into a rejected promise. Now the caller passes the
    // already-allocated outer promise in and is itself an internal microtask
    // (webAssemblyCompileStreaming in JSMicrotask.cpp) that does NOT catch the
    // exception. If this callback throws, the outer promise is never settled
    // and the awaiting test hangs. Convert any thrown exception into a
    // rejection here.

    auto readableStreamMaybe = JSC::JSValue::decode(Zig__GlobalObject__getBodyStreamOrBytesForWasmStreaming(
        globalObject, JSC::JSValue::encode(source), compiler.ptr()));

    if (scope.exception()) [[unlikely]] {
        promise->rejectWithCaughtException(vm, scope);
        return;
    }

    // We were able to get the slice synchronously.
    if (readableStreamMaybe.isNull()) {
        compiler->finalize(globalObject);
        if (scope.exception()) [[unlikely]]
            promise->rejectWithCaughtException(vm, scope);
        return;
    }

    auto wrapper = WebCore::toJSNewlyCreated(globalObject, globalObject, WTF::move(compiler));
    auto builtin = globalObject->wasmStreamingConsumeStreamFunction();
    auto callData = JSC::getCallData(builtin);
    MarkedArgumentBuffer arguments;

    arguments.append(readableStreamMaybe);
    JSC::call(globalObject, builtin, callData, wrapper, arguments);
    if (scope.exception()) [[unlikely]]
        promise->rejectWithCaughtException(vm, scope);
}

void GlobalObject::compileStreaming(JSGlobalObject* globalObject, JSC::JSPromise* promise, JSC::JSValue source, std::optional<JSC::WebAssemblyCompileOptions>&& compileOptions)
{
    handleResponseOnStreamingAction(globalObject, promise, source, JSC::Wasm::CompilerMode::Validation, nullptr, WTF::move(compileOptions));
}

void GlobalObject::instantiateStreaming(JSGlobalObject* globalObject, JSC::JSPromise* promise, JSC::JSValue source, JSC::JSObject* importObject, std::optional<JSC::WebAssemblyCompileOptions>&& compileOptions)
{
    handleResponseOnStreamingAction(globalObject, promise, source, JSC::Wasm::CompilerMode::FullCompile, importObject, WTF::move(compileOptions));
}

GlobalObject::PromiseFunctions GlobalObject::promiseHandlerID(Zig::FFIFunction handler)
{
    if (handler == BunServe__onResolvePlugins) {
        return GlobalObject::PromiseFunctions::BunServe__Plugins__onResolve;
    } else if (handler == BunServe__onRejectPlugins) {
        return GlobalObject::PromiseFunctions::BunServe__Plugins__onReject;
    } else if (handler == Bun__HTTPRequestContext__onReject) {
        return GlobalObject::PromiseFunctions::Bun__HTTPRequestContext__onReject;
    } else if (handler == Bun__HTTPRequestContext__onRejectStream) {
        return GlobalObject::PromiseFunctions::Bun__HTTPRequestContext__onRejectStream;
    } else if (handler == Bun__HTTPRequestContext__onResolve) {
        return GlobalObject::PromiseFunctions::Bun__HTTPRequestContext__onResolve;
    } else if (handler == Bun__HTTPRequestContext__onResolveStream) {
        return GlobalObject::PromiseFunctions::Bun__HTTPRequestContext__onResolveStream;
    } else if (handler == Bun__HTTPRequestContextTLS__onReject) {
        return GlobalObject::PromiseFunctions::Bun__HTTPRequestContextTLS__onReject;
    } else if (handler == Bun__HTTPRequestContextTLS__onRejectStream) {
        return GlobalObject::PromiseFunctions::Bun__HTTPRequestContextTLS__onRejectStream;
    } else if (handler == Bun__HTTPRequestContextTLS__onResolve) {
        return GlobalObject::PromiseFunctions::Bun__HTTPRequestContextTLS__onResolve;
    } else if (handler == Bun__HTTPRequestContextTLS__onResolveStream) {
        return GlobalObject::PromiseFunctions::Bun__HTTPRequestContextTLS__onResolveStream;
    } else if (handler == Bun__HTTPRequestContextDebug__onReject) {
        return GlobalObject::PromiseFunctions::Bun__HTTPRequestContextDebug__onReject;
    } else if (handler == Bun__HTTPRequestContextDebug__onRejectStream) {
        return GlobalObject::PromiseFunctions::Bun__HTTPRequestContextDebug__onRejectStream;
    } else if (handler == Bun__HTTPRequestContextDebug__onResolve) {
        return GlobalObject::PromiseFunctions::Bun__HTTPRequestContextDebug__onResolve;
    } else if (handler == Bun__HTTPRequestContextDebug__onResolveStream) {
        return GlobalObject::PromiseFunctions::Bun__HTTPRequestContextDebug__onResolveStream;
    } else if (handler == Bun__HTTPRequestContextDebugTLS__onReject) {
        return GlobalObject::PromiseFunctions::Bun__HTTPRequestContextDebugTLS__onReject;
    } else if (handler == Bun__HTTPRequestContextDebugTLS__onRejectStream) {
        return GlobalObject::PromiseFunctions::Bun__HTTPRequestContextDebugTLS__onRejectStream;
    } else if (handler == Bun__HTTPRequestContextDebugTLS__onResolve) {
        return GlobalObject::PromiseFunctions::Bun__HTTPRequestContextDebugTLS__onResolve;
    } else if (handler == Bun__HTTPRequestContextDebugTLS__onResolveStream) {
        return GlobalObject::PromiseFunctions::Bun__HTTPRequestContextDebugTLS__onResolveStream;
    } else if (handler == Bun__HTTPRequestContextDebugTLS__onResolveStream) {
        return GlobalObject::PromiseFunctions::Bun__HTTPRequestContextDebugTLS__onResolveStream;
    } else if (handler == Bun__HTTPRequestContextDebugTLS__onResolveStream) {
        return GlobalObject::PromiseFunctions::Bun__HTTPRequestContextDebugTLS__onResolveStream;
    } else if (handler == jsFunctionOnLoadObjectResultResolve) {
        return GlobalObject::PromiseFunctions::jsFunctionOnLoadObjectResultResolve;
    } else if (handler == jsFunctionOnLoadObjectResultReject) {
        return GlobalObject::PromiseFunctions::jsFunctionOnLoadObjectResultReject;
    } else if (handler == Bun__TestScope__Describe2__bunTestThen) {
        return GlobalObject::PromiseFunctions::Bun__TestScope__Describe2__bunTestThen;
    } else if (handler == Bun__TestScope__Describe2__bunTestCatch) {
        return GlobalObject::PromiseFunctions::Bun__TestScope__Describe2__bunTestCatch;
    } else if (handler == Bun__HTMLRewriter__onHandlerResolve) {
        return GlobalObject::PromiseFunctions::Bun__HTMLRewriter__onHandlerResolve;
    } else if (handler == Bun__HTMLRewriter__onHandlerReject) {
        return GlobalObject::PromiseFunctions::Bun__HTMLRewriter__onHandlerReject;
    } else if (handler == Bun__onResolveEntryPointResult) {
        return GlobalObject::PromiseFunctions::Bun__onResolveEntryPointResult;
    } else if (handler == Bun__onRejectEntryPointResult) {
        return GlobalObject::PromiseFunctions::Bun__onRejectEntryPointResult;
    } else if (handler == Bun__NodeHTTPRequest__onResolve) {
        return GlobalObject::PromiseFunctions::Bun__NodeHTTPRequest__onResolve;
    } else if (handler == Bun__NodeHTTPRequest__onReject) {
        return GlobalObject::PromiseFunctions::Bun__NodeHTTPRequest__onReject;
    } else if (handler == Bun__FileStreamWrapper__onResolveRequestStream) {
        return GlobalObject::PromiseFunctions::Bun__FileStreamWrapper__onResolveRequestStream;
    } else if (handler == Bun__FileStreamWrapper__onRejectRequestStream) {
        return GlobalObject::PromiseFunctions::Bun__FileStreamWrapper__onRejectRequestStream;
    } else if (handler == Bun__FileSink__onResolveStream) {
        return GlobalObject::PromiseFunctions::Bun__FileSink__onResolveStream;
    } else if (handler == Bun__FileSink__onRejectStream) {
        return GlobalObject::PromiseFunctions::Bun__FileSink__onRejectStream;
    } else if (handler == Bun__CronJob__onPromiseResolve) {
        return GlobalObject::PromiseFunctions::Bun__CronJob__onPromiseResolve;
    } else if (handler == Bun__CronJob__onPromiseReject) {
        return GlobalObject::PromiseFunctions::Bun__CronJob__onPromiseReject;
    } else if (handler == Bun__HTTPRequestContextMux__onReject) {
        return GlobalObject::PromiseFunctions::Bun__HTTPRequestContextMux__onReject;
    } else if (handler == Bun__HTTPRequestContextMux__onRejectStream) {
        return GlobalObject::PromiseFunctions::Bun__HTTPRequestContextMux__onRejectStream;
    } else if (handler == Bun__HTTPRequestContextMux__onResolve) {
        return GlobalObject::PromiseFunctions::Bun__HTTPRequestContextMux__onResolve;
    } else if (handler == Bun__HTTPRequestContextMux__onResolveStream) {
        return GlobalObject::PromiseFunctions::Bun__HTTPRequestContextMux__onResolveStream;
    } else if (handler == Bun__HTTPRequestContextMuxTLS__onReject) {
        return GlobalObject::PromiseFunctions::Bun__HTTPRequestContextMuxTLS__onReject;
    } else if (handler == Bun__HTTPRequestContextMuxTLS__onRejectStream) {
        return GlobalObject::PromiseFunctions::Bun__HTTPRequestContextMuxTLS__onRejectStream;
    } else if (handler == Bun__HTTPRequestContextMuxTLS__onResolve) {
        return GlobalObject::PromiseFunctions::Bun__HTTPRequestContextMuxTLS__onResolve;
    } else if (handler == Bun__HTTPRequestContextMuxTLS__onResolveStream) {
        return GlobalObject::PromiseFunctions::Bun__HTTPRequestContextMuxTLS__onResolveStream;
    } else if (handler == Bun__HTTPRequestContextDebugMux__onReject) {
        return GlobalObject::PromiseFunctions::Bun__HTTPRequestContextDebugMux__onReject;
    } else if (handler == Bun__HTTPRequestContextDebugMux__onRejectStream) {
        return GlobalObject::PromiseFunctions::Bun__HTTPRequestContextDebugMux__onRejectStream;
    } else if (handler == Bun__HTTPRequestContextDebugMux__onResolve) {
        return GlobalObject::PromiseFunctions::Bun__HTTPRequestContextDebugMux__onResolve;
    } else if (handler == Bun__HTTPRequestContextDebugMux__onResolveStream) {
        return GlobalObject::PromiseFunctions::Bun__HTTPRequestContextDebugMux__onResolveStream;
    } else if (handler == Bun__HTTPRequestContextDebugMuxTLS__onReject) {
        return GlobalObject::PromiseFunctions::Bun__HTTPRequestContextDebugMuxTLS__onReject;
    } else if (handler == Bun__HTTPRequestContextDebugMuxTLS__onRejectStream) {
        return GlobalObject::PromiseFunctions::Bun__HTTPRequestContextDebugMuxTLS__onRejectStream;
    } else if (handler == Bun__HTTPRequestContextDebugMuxTLS__onResolve) {
        return GlobalObject::PromiseFunctions::Bun__HTTPRequestContextDebugMuxTLS__onResolve;
    } else if (handler == Bun__HTTPRequestContextDebugMuxTLS__onResolveStream) {
        return GlobalObject::PromiseFunctions::Bun__HTTPRequestContextDebugMuxTLS__onResolveStream;
    } else if (handler == Bun__FetchTasklet__onResolveRequestStream) {
        return GlobalObject::PromiseFunctions::Bun__FetchTasklet__onResolveRequestStream;
    } else if (handler == Bun__FetchTasklet__onRejectRequestStream) {
        return GlobalObject::PromiseFunctions::Bun__FetchTasklet__onRejectRequestStream;
    } else if (handler == Bun__S3UploadStream__onResolveStream) {
        return GlobalObject::PromiseFunctions::Bun__S3UploadStream__onResolveStream;
    } else if (handler == Bun__S3UploadStream__onRejectStream) {
        return GlobalObject::PromiseFunctions::Bun__S3UploadStream__onRejectStream;
    } else if (handler == Bun__HTMLRewriter__onResolveInputStream) {
        return GlobalObject::PromiseFunctions::Bun__HTMLRewriter__onResolveInputStream;
    } else if (handler == Bun__HTMLRewriter__onRejectInputStream) {
        return GlobalObject::PromiseFunctions::Bun__HTMLRewriter__onRejectInputStream;
    } else {
        RELEASE_ASSERT_NOT_REACHED();
    }
}

Ref<NapiEnv> GlobalObject::makeNapiEnv(const napi_module& mod)
{
    m_napiEnvs.append(NapiEnv::create(this, mod));
    return m_napiEnvs.last();
}

napi_env GlobalObject::makeNapiEnvForFFI()
{
    auto out = makeNapiEnv(napi_module {
        .nm_version = 9,
        .nm_flags = 0,
        .nm_filename = "ffi://",
        .nm_register_func = nullptr,
        .nm_modname = "[ffi]",
        .nm_priv = nullptr,
        .reserved = {},
    });
    return &out.leakRef();
}

// `bun test --isolate`: the old global is about to be gcUnprotect()'d and
// collected, but its NapiEnvs may outlive it — GC-enqueued NapiFinalizerTasks
// hold Ref<NapiEnv> and run on the event loop while loading the *next* file.
// NapiEnv::m_globalObject is a raw pointer; Finalizer.run opens a
// NapiHandleScope through it, which writes m_currentNapiHandleScopeImpl on the
// dead old global and trips `ASSERT(isMarked(cell))` in
// Heap::addToRememberedSet (release: the concurrent marker later visits it and
// segfaults at offset 0x68/0xD0). Retarget every env to the new global and
// take ownership of the refs so ~GlobalObject on the old one doesn't drop
// them — the envs stay valid for late finalizers and for the process-exit
// cleanup hooks in rare_data.cleanup_hooks (which hold raw NapiEnv* in .ctx).
void GlobalObject::adoptNapiEnvsForTestIsolation(GlobalObject* oldGlobal)
{
    if (oldGlobal->m_napiEnvs.isEmpty())
        return;
    for (auto& env : oldGlobal->m_napiEnvs)
        env->retargetGlobalObject(this);
    // Ref<NapiEnv> is move-only; the rvalue appendVector overload moves each
    // element out, and we make the source explicitly empty afterwards so
    // ~GlobalObject on the old cell is a no-op here.
    m_napiEnvs.appendVector(std::exchange(oldGlobal->m_napiEnvs, {}));
}

void GlobalObject::setNodeWorkerEnvironmentData(JSMap* data) { m_nodeWorkerEnvironmentData.set(vm(), this, data); }
void GlobalObject::setNodeWorkerStdioPorts(JSObject* ports) { m_nodeWorkerStdioPorts.set(vm(), this, ports); }
void GlobalObject::setNodeWorkerEntryEvaluatedHook(JSObject* hook)
{
    if (hook)
        m_nodeWorkerEntryEvaluatedHook.set(vm(), this, hook);
    else
        m_nodeWorkerEntryEvaluatedHook.clear();
}

extern "C" void Bun__InspectorConnection__disconnectAllOnExit(Zig::GlobalObject*);

void GlobalObject::setNodeParentPort(WebCore::MessagePort* port)
{
    m_nodeParentPort = port;
}

void GlobalObject::nodeWorkerEntryDidSettle()
{
    m_nodeWorkerEntrySettled = true;
    if (m_nodeParentPort)
        m_nodeParentPort->entrySettled();
}

void GlobalObject::prepareForDestruction()
{
    auto& vm = this->vm();
    auto* context = m_scriptExecutionContext;

    // Whatever was queued before exit began does not resurrect during teardown: process.exit()
    // runs 'exit' handlers and nothing after them (Node), and a worker's stop phase dispatches
    // close events, not stale microtasks. Anything the stop phase itself queues drains with it.
    vm.defaultMicrotaskQueue().clear();
    if (auto* nextTickQueue = m_nextTickQueue.get())
        nextTickQueue->discard(vm);

    // Tell cross-thread posters not to bother from here (what still lands is queued and released
    // unrun by the teardown, or refused once the VM handle closes). DeferredWorkTimer is fenced
    // separately because finalizers during the final collection and ~VM both reach scheduleWorkSoon().
    context->markTerminating();
    WebCore::clientData(vm)->deferredWorkTimer.markShuttingDown();

    // WorkerOrWorkletGlobalScope::prepareForDestruction(): stop every ActiveDOMObject (workers are
    // asked to terminate, ports/channels/sockets close without dispatching) and strip listeners,
    // while script can still run.
    context->prepareForDestruction();
}

void GlobalObject::clearDOMGuardedObjects()
{
    // No lock: clear() takes the GC lock itself when it removes the entry (JSDOMGlobalObject).
    auto guardedObjectsCopy = m_guardedObjects;
    for (auto& guarded : guardedObjectsCopy)
        guarded->clear();
}

void GlobalObject::forbidExecution()
{
    auto& vm = this->vm();

    // MicrotaskQueue references Heap.
    vm.defaultMicrotaskQueue().clear();

    // Drop the module registry and require() cache so module-level bindings become unreachable
    // for the final collection (their ExternalStringImpl deallocators must run before ~VM).
    {
        auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
        this->clearModuleRegistry();
        scope.clearException();
    }

    // WorkerOrWorkletScriptController::forbidExecution() + scheduleExecutionTermination(): no script
    // past this point. executionForbidden is what the native→JS boundary (Bun__JSValue__call,
    // JSEventListener via isJSExecutionForbidden) and JSC's microtask drain consult; the
    // termination request unwinds anything JSC enters internally, which needs the exception
    // object to exist (a main-thread VM never materialized it before this).
    vm.ensureTerminationException();
    vm.setExecutionForbidden();
    vm.setHasTerminationRequest();
}

extern "C" void Bun__GlobalObject__clearExceptionsForExit(Zig::GlobalObject* globalObject)
{
    // Whatever unwound script to reach the exit sequence — the stop trap (a termination
    // request/exception) or an ordinary exception thrown across process.exit() — is spent;
    // the native teardown that follows must not trip over it (Node's EmitProcessExit runs
    // under a TryCatch for the same reason).
    auto& vm = globalObject->vm();
    vm.clearHasTerminationRequest();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    if (scope.exception())
        scope.clearException();
}

static void destroyVM(JSC::VM& vm)
{
    vm.heap.collectNow(JSC::Sync, JSC::CollectionScope::Full);
    // Every JSLockHolder still on the native stack (process.exit() from inside a JS callback,
    // the worker thread's manual API lock) holds a RefPtr<VM> that will never destruct because
    // this path does not return through them; release on their behalf so ~VM — and with it
    // Heap::lastChanceToFinalize — actually runs here.
    for (uint32_t n = vm.refCount(); n > 1; --n)
        vm.derefSuppressingSaferCPPChecking();
    vm.derefSuppressingSaferCPPChecking();
}

extern "C" void Zig__GlobalObject__prepareForDestruction(Zig::GlobalObject* globalObject)
{
    globalObject->prepareForDestruction();
}

extern "C" void Zig__GlobalObject__forbidExecution(Zig::GlobalObject* globalObject)
{
    globalObject->forbidExecution();
}

// `bun test --isolate`: the file that just finished is being retired on a live VM. Its context's
// workers, ports, channels and sockets are stopped before anything else of the file is swept.
extern "C" void Zig__GlobalObject__stopActiveDOMObjectsForTestIsolation(Zig::GlobalObject* globalObject)
{
    Bun::retireWebViewsForTestIsolation(globalObject);
    globalObject->scriptExecutionContext()->prepareForDestruction();
}

extern "C" void Zig__GlobalObject__destructOnExit(Zig::GlobalObject* globalObject)
{
    auto& vm = JSC::getVM(globalObject);
    ASSERT(globalObject->scriptExecutionContext()->activeDOMObjectsAreStopped());
    vm.entryScope = nullptr;
    Ref context = *globalObject->scriptExecutionContext();
    Ref<WTF::RunLoop> runLoop = vm.runLoop();

    Bun__InspectorConnection__disconnectAllOnExit(globalObject);
    // Deferred promises / callbacks (DOMGuardedObject) hold JSC::Weak handles and observe the
    // context; the context outlives ~VM here, so their handles are cleared now, with the heap
    // alive — WebCore's ~WorkerOrWorkletScriptController does the same right before its VM goes.
    globalObject->clearDOMGuardedObjects();
    gcUnprotect(globalObject);
    globalObject = nullptr;

    destroyVM(vm);
    runLoop->threadWillExit();
    // `context` is released here, after ~VM: contextDestroyed() reaches observers at a defined
    // point on this thread instead of from inside a GC destructor.
}

extern "C" void WebWorker__teardownJSCVM(Zig::GlobalObject* globalObject)
{
    auto& vm = JSC::getVM(globalObject);
    ASSERT(globalObject->scriptExecutionContext()->activeDOMObjectsAreStopped());
    Ref context = *globalObject->scriptExecutionContext();

    vm.deleteAllCode(JSC::DeleteAllCodeEffort::PreventCollectionAndDeleteAllCode);
    // See Zig__GlobalObject__destructOnExit.
    globalObject->clearDOMGuardedObjects();
    gcUnprotect(globalObject);
    globalObject = nullptr;

    destroyVM(vm);
}

#include "ZigGeneratedClasses+lazyStructureImpl.h"
#include "ZigGlobalObject.lut.h"

const JSC::ClassInfo GlobalObject::s_info = { "GlobalObject"_s, &Base::s_info, &bunGlobalObjectTable, nullptr,
    CREATE_METHOD_TABLE(GlobalObject) };

} // namespace Zig
