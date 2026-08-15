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

    /* --- bun --- */
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForBunClassConstructor;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForBufferList;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForFFIFunction;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForWrappingFunction;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForNapiClass;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForJSSQLStatement;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForNodeSqliteDatabaseSync;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForNodeSqliteStatementSync;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForNodeSqliteStatementSyncIterator;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForNodeSqliteSession;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForNodeSqliteLimits;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForNodeSqliteTagStore;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForJSSinkConstructor;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForJSSinkController;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForJSSink;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForStringDecoder;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForPendingVirtualModuleResult;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForCallSite;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForImportMeta;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForNapiExternal;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForBundlerPlugin;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForNodeVMGlobalObject;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForNodeVMSpecialSandbox;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForNodeVMScript;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForNodeVMSourceTextModule;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForNodeVMSyntheticModule;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForJSCommonJSModule;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForJSCommonJSExtensions;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForJSMockImplementation;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForJSModuleMock;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForJSMockFunction;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForAsyncContextFrame;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForMockWithImplementationCleanupData;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForProcessObject;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForInternalModuleRegistry;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForErrorCodeCache;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForBunInspectorConnection;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForJSNextTickQueue;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForJSSocketHandlers;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForJSDiffieHellman;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForJSDiffieHellmanGroup;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForJSECDH;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForTTYWrapObject;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForNapiHandleScopeImpl;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForStrongRootBlock;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForNapiTypeTag;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForNativePromiseContext;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForObjectTemplate;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForInternalFieldObject;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForJSMIMEType;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForJSMIMEParams;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForV8GlobalInternals;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForHandleScopeBuffer;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForFunctionTemplate;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForV8Function;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForJSNodeHTTPServerSocket;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForJSX509Certificate;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForJSNodePerformanceHooksHistogram;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForWasmStreamingCompiler;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForJSWebView;

#include "ZigGeneratedClasses+DOMClientIsoSubspaces.h"
    /* --- bun --- */

    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForDOMException;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForDOMFormData;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForDOMFormDataIterator;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForDOMURL;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForURLPattern;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForURLSearchParams;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForURLSearchParamsIterator;

    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForCookie;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForCookieMap;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForCookieMapIterator;

    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForFetchHeaders;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForFetchHeadersIterator;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForByteLengthQueuingStrategy;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForCountQueuingStrategy;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForReadableByteStreamController;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForReadableStream;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForReadableStreamConstructor;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForReadableStreamDefaultReaderConstructor;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForReadableStreamBYOBReaderConstructor;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForWritableStreamConstructor;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForWritableStreamDefaultWriterConstructor;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForTransformStreamConstructor;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForByteLengthQueuingStrategyConstructor;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForCountQueuingStrategyConstructor;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForTextEncoderStreamConstructor;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForTextDecoderStreamConstructor;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForCompressionStreamConstructor;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForDecompressionStreamConstructor;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForStreamPipeToOperation;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForReadRequest;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForReadIntoRequest;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForPullIntoDescriptor;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForStreamTeeState;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForCrossRealmTransformState;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForStreamFromIterableContext;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForDirectStreamController;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForNativeStreamSourceAdapter;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForDirectSinkCloseState;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForAsyncIteratorSourceOperation;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForReadStreamIntoSinkOperation;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForBunStandaloneTextSink;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForOneShotDirectSink;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForReadableStreamIntoArrayOperation;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForReadableStreamAsyncIterator;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForReadableStreamBYOBReader;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForReadableStreamBYOBRequest;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForReadableStreamDefaultController;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForReadableStreamDefaultReader;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForTransformStream;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForTransformStreamDefaultController;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForCompressionStream;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForDecompressionStream;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForWritableStream;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForWritableStreamDefaultController;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForWritableStreamDefaultWriter;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForCloseEvent;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForWebSocket;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForCryptoKey;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForSubtleCrypto;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForBroadcastChannel;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForCustomEvent;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForMessageChannel;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForMessageEvent;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForMessagePort;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForTextDecoderStream;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForTextEncoder;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForTextEncoderStream;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForPerformance;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForPerformanceEntry;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForPerformanceMark;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForPerformanceMeasure;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForPerformanceObserver;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForPerformanceObserverEntryList;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForPerformanceTiming;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForPerformanceResourceTiming;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForPerformanceServerTiming;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForWorker;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForWorkerGlobalScope;

    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForBakeGlobalScope;

    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForAbortController;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForAbortSignal;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForErrorEvent;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForEvent;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForEventTarget;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForEventEmitter;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForJSSign;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForJSVerify;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForJSHmac;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForJSHash;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForJSCipher;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForJSSecretKeyObject;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForJSPublicKeyObject;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForJSPrivateKeyObject;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForServerRouteList;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForBunRequest;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForBakeResponse;

    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForJSConnectionsList;
    std::unique_ptr<GCClient::IsoSubspace> m_clientSubspaceForJSHTTPParser;
};
} // namespace WebCore
