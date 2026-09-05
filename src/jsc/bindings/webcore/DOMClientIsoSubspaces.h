#pragma once

#include "root.h"

#include <wtf/FastMalloc.h>
#include <wtf/Noncopyable.h>

namespace WebCore {
using namespace JSC;

class DOMClientIsoSubspaces {
    WTF_MAKE_NONCOPYABLE(DOMClientIsoSubspaces);
    WTF_DEPRECATED_MAKE_FAST_ALLOCATED(DOMClientIsoSubspaces);

public:
    DOMClientIsoSubspaces() = default;
    ~DOMClientIsoSubspaces();

    /* --- bun --- */
    GCClient::IsoSubspace* m_clientSubspaceForBunClassConstructor { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForFFIFunction { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForWrappingFunction { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForNapiClass { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForJSSQLStatement { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForNodeSqliteDatabaseSync { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForNodeSqliteStatementSync { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForNodeSqliteStatementSyncIterator { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForNodeSqliteSession { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForNodeSqliteLimits { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForNodeSqliteTagStore { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForJSSinkConstructor { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForJSSinkController { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForJSSink { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForStringDecoder { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForPendingVirtualModuleResult { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForCallSite { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForImportMeta { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForNapiExternal { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForBundlerPlugin { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForNodeVMGlobalObject { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForNodeVMSpecialSandbox { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForNodeVMScript { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForNodeVMSourceTextModule { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForNodeVMSyntheticModule { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForJSCommonJSModule { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForJSCommonJSExtensions { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForJSMockImplementation { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForJSModuleMock { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForJSMockFunction { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForAsyncContextFrame { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForMockWithImplementationCleanupData { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForProcessObject { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForInternalModuleRegistry { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForErrorCodeCache { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForBunInspectorConnection { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForJSNextTickQueue { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForJSSocketHandlers { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForJSDiffieHellman { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForJSDiffieHellmanGroup { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForJSECDH { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForTTYWrapObject { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForHandleScopeImpl { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForStrongRootBlock { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForNapiTypeTag { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForNativePromiseContext { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForObjectTemplate { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForInternalFieldObject { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForJSMIMEType { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForJSMIMEParams { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForV8GlobalInternals { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForFunctionTemplate { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForV8Function { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForJSNodeHTTPServerSocket { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForJSX509Certificate { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForJSNodePerformanceHooksHistogram { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForWasmStreamingCompiler { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForJSWebView { nullptr };

#include "ZigGeneratedClasses+DOMClientIsoSubspaces.h"
    /* --- bun --- */

    GCClient::IsoSubspace* m_clientSubspaceForDOMException { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForDOMFormData { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForDOMFormDataIterator { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForDOMURL { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForURLPattern { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForURLSearchParams { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForURLSearchParamsIterator { nullptr };

    GCClient::IsoSubspace* m_clientSubspaceForCookie { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForCookieMap { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForCookieMapIterator { nullptr };

    GCClient::IsoSubspace* m_clientSubspaceForFetchHeaders { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForFetchHeadersIterator { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForByteLengthQueuingStrategy { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForCountQueuingStrategy { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForReadableByteStreamController { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForReadableStream { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForReadableStreamConstructor { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForReadableStreamDefaultReaderConstructor { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForReadableStreamBYOBReaderConstructor { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForWritableStreamConstructor { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForWritableStreamDefaultWriterConstructor { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForTransformStreamConstructor { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForByteLengthQueuingStrategyConstructor { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForCountQueuingStrategyConstructor { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForTextEncoderStreamConstructor { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForTextDecoderStreamConstructor { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForCompressionStreamConstructor { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForDecompressionStreamConstructor { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForStreamPipeToOperation { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForReadRequest { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForReadIntoRequest { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForPullIntoDescriptor { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForStreamTeeState { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForCrossRealmTransformState { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForStreamFromIterableContext { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForDirectStreamController { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForNativeStreamSourceAdapter { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForDirectSinkCloseState { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForAsyncIteratorSourceOperation { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForReadStreamIntoSinkOperation { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForBunStandaloneTextSink { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForOneShotDirectSink { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForReadableStreamIntoArrayOperation { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForReadableStreamAsyncIterator { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForReadableStreamBYOBReader { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForReadableStreamBYOBRequest { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForReadableStreamDefaultController { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForReadableStreamDefaultReader { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForTransformStream { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForTransformStreamDefaultController { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForCompressionStream { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForDecompressionStream { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForWritableStream { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForWritableStreamDefaultController { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForWritableStreamDefaultWriter { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForCloseEvent { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForWebSocket { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForCryptoKey { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForSubtleCrypto { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForBroadcastChannel { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForCustomEvent { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForMessageChannel { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForMessageEvent { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForMessagePort { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForTextDecoderStream { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForTextEncoder { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForTextEncoderStream { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForPerformance { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForPerformanceEntry { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForPerformanceMark { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForPerformanceMeasure { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForPerformanceObserver { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForPerformanceObserverEntryList { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForPerformanceTiming { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForPerformanceResourceTiming { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForPerformanceServerTiming { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForWorker { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForWorkerGlobalScope { nullptr };

    GCClient::IsoSubspace* m_clientSubspaceForBakeGlobalScope { nullptr };

    GCClient::IsoSubspace* m_clientSubspaceForAbortController { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForAbortSignal { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForErrorEvent { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForEvent { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForEventTarget { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForEventEmitter { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForJSSign { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForJSVerify { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForJSHmac { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForJSHash { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForJSCipher { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForJSSecretKeyObject { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForJSPublicKeyObject { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForJSPrivateKeyObject { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForServerRouteList { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForBunRequest { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForBakeResponse { nullptr };

    GCClient::IsoSubspace* m_clientSubspaceForJSConnectionsList { nullptr };
    GCClient::IsoSubspace* m_clientSubspaceForJSHTTPParser { nullptr };
};
} // namespace WebCore
