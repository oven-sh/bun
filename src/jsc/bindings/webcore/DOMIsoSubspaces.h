
#pragma once

#include "root.h"

#include <wtf/FastMalloc.h>
#include <wtf/Noncopyable.h>

namespace WebCore {
using namespace JSC;

class DOMIsoSubspaces {
    WTF_MAKE_NONCOPYABLE(DOMIsoSubspaces);
    WTF_DEPRECATED_MAKE_FAST_ALLOCATED(DOMIsoSubspaces);

public:
    DOMIsoSubspaces() = default;
    // Every member is an owned `IsoSubspace*`; one loop instead of ~300 inlined unique_ptr destructors.
    ~DOMIsoSubspaces();
    /*-- BUN --*/
    IsoSubspace* m_subspaceForBunClassConstructor { nullptr };
    IsoSubspace* m_subspaceForFFIFunction { nullptr };
    IsoSubspace* m_subspaceForWrappingFunction { nullptr };
    IsoSubspace* m_subspaceForNapiClass { nullptr };
    IsoSubspace* m_subspaceForJSSQLStatement { nullptr };
    IsoSubspace* m_subspaceForNodeSqliteDatabaseSync { nullptr };
    IsoSubspace* m_subspaceForNodeSqliteStatementSync { nullptr };
    IsoSubspace* m_subspaceForNodeSqliteStatementSyncIterator { nullptr };
    IsoSubspace* m_subspaceForNodeSqliteSession { nullptr };
    IsoSubspace* m_subspaceForNodeSqliteLimits { nullptr };
    IsoSubspace* m_subspaceForNodeSqliteTagStore { nullptr };
    IsoSubspace* m_subspaceForJSSinkConstructor { nullptr };
    IsoSubspace* m_subspaceForJSSinkController { nullptr };
    IsoSubspace* m_subspaceForJSSink { nullptr };
    IsoSubspace* m_subspaceForStringDecoder { nullptr };
    IsoSubspace* m_subspaceForPendingVirtualModuleResult { nullptr };
    IsoSubspace* m_subspaceForCallSite { nullptr };
    IsoSubspace* m_subspaceForNapiExternal { nullptr };
    IsoSubspace* m_subspaceForImportMeta { nullptr };
    IsoSubspace* m_subspaceForBundlerPlugin { nullptr };
    IsoSubspace* m_subspaceForNodeVMGlobalObject { nullptr };
    IsoSubspace* m_subspaceForNodeVMSpecialSandbox { nullptr };
    IsoSubspace* m_subspaceForNodeVMScript { nullptr };
    IsoSubspace* m_subspaceForNodeVMSourceTextModule { nullptr };
    IsoSubspace* m_subspaceForNodeVMSyntheticModule { nullptr };
    IsoSubspace* m_subspaceForJSCommonJSModule { nullptr };
    IsoSubspace* m_subspaceForJSCommonJSExtensions { nullptr };
    IsoSubspace* m_subspaceForJSMockImplementation { nullptr };
    IsoSubspace* m_subspaceForJSModuleMock { nullptr };
    IsoSubspace* m_subspaceForJSMockFunction { nullptr };
    IsoSubspace* m_subspaceForAsyncContextFrame { nullptr };
    IsoSubspace* m_subspaceForMockWithImplementationCleanupData { nullptr };
    IsoSubspace* m_subspaceForProcessObject { nullptr };
    IsoSubspace* m_subspaceForInternalModuleRegistry { nullptr };
    IsoSubspace* m_subspaceForErrorCodeCache { nullptr };
    IsoSubspace* m_subspaceForBunInspectorConnection { nullptr };
    IsoSubspace* m_subspaceForJSNextTickQueue { nullptr };
    IsoSubspace* m_subspaceForJSSocketHandlers { nullptr };
    IsoSubspace* m_subspaceForTTYWrapObject { nullptr };
    IsoSubspace* m_subspaceForNapiHandleScopeImpl { nullptr };
    IsoSubspace* m_subspaceForStrongRootBlock { nullptr };
    IsoSubspace* m_subspaceForNapiTypeTag { nullptr };
    IsoSubspace* m_subspaceForNativePromiseContext { nullptr };
    IsoSubspace* m_subspaceForObjectTemplate { nullptr };
    IsoSubspace* m_subspaceForInternalFieldObject { nullptr };
    IsoSubspace* m_subspaceForV8GlobalInternals { nullptr };
    IsoSubspace* m_subspaceForHandleScopeBuffer { nullptr };
    IsoSubspace* m_subspaceForFunctionTemplate { nullptr };
    IsoSubspace* m_subspaceForJSMIMEType { nullptr };
    IsoSubspace* m_subspaceForJSMIMEParams { nullptr };
    IsoSubspace* m_subspaceForV8Function { nullptr };
    IsoSubspace* m_subspaceForJSNodeHTTPServerSocket { nullptr };
    IsoSubspace* m_subspaceForJSX509Certificate { nullptr };
    IsoSubspace* m_subspaceForJSNodePerformanceHooksHistogram { nullptr };
    IsoSubspace* m_subspaceForWasmStreamingCompiler { nullptr };
    IsoSubspace* m_subspaceForJSWebView { nullptr };
#include "ZigGeneratedClasses+DOMIsoSubspaces.h"
    /*-- BUN --*/

    IsoSubspace* m_subspaceForClipboard { nullptr };
    IsoSubspace* m_subspaceForClipboardItem { nullptr };
    IsoSubspace* m_subspaceForFetchHeaders { nullptr };
    IsoSubspace* m_subspaceForFetchHeadersIterator { nullptr };
    IsoSubspace* m_subspaceForByteLengthQueuingStrategy { nullptr };
    IsoSubspace* m_subspaceForCountQueuingStrategy { nullptr };
    IsoSubspace* m_subspaceForReadableByteStreamController { nullptr };
    IsoSubspace* m_subspaceForReadableStream { nullptr };
    IsoSubspace* m_subspaceForReadableStreamConstructor { nullptr };
    IsoSubspace* m_subspaceForReadableStreamDefaultReaderConstructor { nullptr };
    IsoSubspace* m_subspaceForReadableStreamBYOBReaderConstructor { nullptr };
    IsoSubspace* m_subspaceForWritableStreamConstructor { nullptr };
    IsoSubspace* m_subspaceForWritableStreamDefaultWriterConstructor { nullptr };
    IsoSubspace* m_subspaceForTransformStreamConstructor { nullptr };
    IsoSubspace* m_subspaceForByteLengthQueuingStrategyConstructor { nullptr };
    IsoSubspace* m_subspaceForCountQueuingStrategyConstructor { nullptr };
    IsoSubspace* m_subspaceForTextEncoderStreamConstructor { nullptr };
    IsoSubspace* m_subspaceForTextDecoderStreamConstructor { nullptr };
    IsoSubspace* m_subspaceForCompressionStreamConstructor { nullptr };
    IsoSubspace* m_subspaceForDecompressionStreamConstructor { nullptr };
    IsoSubspace* m_subspaceForStreamPipeToOperation { nullptr };
    IsoSubspace* m_subspaceForReadRequest { nullptr };
    IsoSubspace* m_subspaceForReadIntoRequest { nullptr };
    IsoSubspace* m_subspaceForPullIntoDescriptor { nullptr };
    IsoSubspace* m_subspaceForStreamTeeState { nullptr };
    IsoSubspace* m_subspaceForCrossRealmTransformState { nullptr };
    IsoSubspace* m_subspaceForStreamFromIterableContext { nullptr };
    IsoSubspace* m_subspaceForDirectStreamController { nullptr };
    IsoSubspace* m_subspaceForNativeStreamSourceAdapter { nullptr };
    IsoSubspace* m_subspaceForDirectSinkCloseState { nullptr };
    IsoSubspace* m_subspaceForAsyncIteratorSourceOperation { nullptr };
    IsoSubspace* m_subspaceForReadStreamIntoSinkOperation { nullptr };
    IsoSubspace* m_subspaceForBunStandaloneTextSink { nullptr };
    IsoSubspace* m_subspaceForOneShotDirectSink { nullptr };
    IsoSubspace* m_subspaceForReadableStreamIntoArrayOperation { nullptr };
    IsoSubspace* m_subspaceForReadableStreamAsyncIterator { nullptr };
    IsoSubspace* m_subspaceForReadableStreamBYOBReader { nullptr };
    IsoSubspace* m_subspaceForReadableStreamBYOBRequest { nullptr };
    IsoSubspace* m_subspaceForReadableStreamDefaultController { nullptr };
    IsoSubspace* m_subspaceForReadableStreamDefaultReader { nullptr };
    IsoSubspace* m_subspaceForTransformStream { nullptr };
    IsoSubspace* m_subspaceForTransformStreamDefaultController { nullptr };
    IsoSubspace* m_subspaceForCompressionStream { nullptr };
    IsoSubspace* m_subspaceForDecompressionStream { nullptr };
    IsoSubspace* m_subspaceForWritableStream { nullptr };
    IsoSubspace* m_subspaceForWritableStreamDefaultController { nullptr };
    IsoSubspace* m_subspaceForWritableStreamDefaultWriter { nullptr };
    IsoSubspace* m_subspaceForCloseEvent { nullptr };
    IsoSubspace* m_subspaceForWebSocket { nullptr };
    IsoSubspace* m_subspaceForCryptoKey { nullptr };
    IsoSubspace* m_subspaceForSubtleCrypto { nullptr };

    IsoSubspace* m_subspaceForBroadcastChannel { nullptr };
    IsoSubspace* m_subspaceForClipboardEvent { nullptr };
    IsoSubspace* m_subspaceForCustomEvent { nullptr };

    IsoSubspace* m_subspaceForMessageChannel { nullptr };
    IsoSubspace* m_subspaceForMessageEvent { nullptr };
    IsoSubspace* m_subspaceForMessagePort { nullptr };
    IsoSubspace* m_subspaceForTextDecoderStream { nullptr };
    IsoSubspace* m_subspaceForTextEncoder { nullptr };
    IsoSubspace* m_subspaceForTextEncoderStream { nullptr };
    IsoSubspace* m_subspaceForDOMFormData { nullptr };
    IsoSubspace* m_subspaceForDOMFormDataIterator { nullptr };
    IsoSubspace* m_subspaceForPerformance { nullptr };
    IsoSubspace* m_subspaceForPerformanceEntry { nullptr };
    IsoSubspace* m_subspaceForPerformanceMark { nullptr };
    IsoSubspace* m_subspaceForPerformanceMeasure { nullptr };
    IsoSubspace* m_subspaceForPerformanceObserver { nullptr };
    IsoSubspace* m_subspaceForPerformanceObserverEntryList { nullptr };
    IsoSubspace* m_subspaceForPerformanceResourceTiming { nullptr };
    IsoSubspace* m_subspaceForPerformanceServerTiming { nullptr };
    IsoSubspace* m_subspaceForPerformanceTiming { nullptr };
    IsoSubspace* m_subspaceForWorker { nullptr };
    IsoSubspace* m_subspaceForWorkerGlobalScope { nullptr };

    IsoSubspace* m_subspaceForBakeGlobalScope { nullptr };

    IsoSubspace* m_subspaceForAbortController { nullptr };
    IsoSubspace* m_subspaceForAbortSignal { nullptr };
    IsoSubspace* m_subspaceForErrorEvent { nullptr };
    IsoSubspace* m_subspaceForEvent { nullptr };
    IsoSubspace* m_subspaceForEventTarget { nullptr };
    IsoSubspace* m_subspaceForEventEmitter { nullptr };

    IsoSubspace* m_subspaceForURLSearchParams { nullptr };
    IsoSubspace* m_subspaceForURLSearchParamsIterator { nullptr };

    IsoSubspace* m_subspaceForCookie { nullptr };
    IsoSubspace* m_subspaceForCookieMap { nullptr };
    IsoSubspace* m_subspaceForCookieMapIterator { nullptr };

    IsoSubspace* m_subspaceForDOMException { nullptr };
    IsoSubspace* m_subspaceForDOMURL { nullptr };
    IsoSubspace* m_subspaceForURLPattern { nullptr };
    IsoSubspace* m_subspaceForJSSign { nullptr };
    IsoSubspace* m_subspaceForJSVerify { nullptr };
    IsoSubspace* m_subspaceForJSHmac { nullptr };
    IsoSubspace* m_subspaceForJSHash { nullptr };
    IsoSubspace* m_subspaceForServerRouteList { nullptr };
    IsoSubspace* m_subspaceForBunRequest { nullptr };
    IsoSubspace* m_subspaceForBakeResponse { nullptr };
    IsoSubspace* m_subspaceForJSDiffieHellman { nullptr };
    IsoSubspace* m_subspaceForJSDiffieHellmanGroup { nullptr };
    IsoSubspace* m_subspaceForJSECDH { nullptr };
    IsoSubspace* m_subspaceForJSCipher { nullptr };
    IsoSubspace* m_subspaceForJSSecretKeyObject { nullptr };
    IsoSubspace* m_subspaceForJSPublicKeyObject { nullptr };
    IsoSubspace* m_subspaceForJSPrivateKeyObject { nullptr };

    IsoSubspace* m_subspaceForJSConnectionsList { nullptr };
    IsoSubspace* m_subspaceForJSHTTPParser { nullptr };
};
} // namespace WebCore

namespace WebCore {
using DOMIsoSubspaces = WebCore::DOMIsoSubspaces;
}
