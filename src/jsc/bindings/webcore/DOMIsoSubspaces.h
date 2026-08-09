
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
    /*-- BUN --*/
    std::unique_ptr<IsoSubspace> m_subspaceForBunClassConstructor;
    std::unique_ptr<IsoSubspace> m_subspaceForBufferList;
    std::unique_ptr<IsoSubspace> m_subspaceForFFIFunction;
    std::unique_ptr<IsoSubspace> m_subspaceForWrappingFunction;
    std::unique_ptr<IsoSubspace> m_subspaceForNapiClass;
    std::unique_ptr<IsoSubspace> m_subspaceForNapiPrototype;
    std::unique_ptr<IsoSubspace> m_subspaceForJSSQLStatement;
    std::unique_ptr<IsoSubspace> m_subspaceForNodeSqliteDatabaseSync;
    std::unique_ptr<IsoSubspace> m_subspaceForNodeSqliteStatementSync;
    std::unique_ptr<IsoSubspace> m_subspaceForNodeSqliteStatementSyncIterator;
    std::unique_ptr<IsoSubspace> m_subspaceForNodeSqliteSession;
    std::unique_ptr<IsoSubspace> m_subspaceForNodeSqliteLimits;
    std::unique_ptr<IsoSubspace> m_subspaceForNodeSqliteTagStore;
    std::unique_ptr<IsoSubspace> m_subspaceForJSSinkConstructor;
    std::unique_ptr<IsoSubspace> m_subspaceForJSSinkController;
    std::unique_ptr<IsoSubspace> m_subspaceForJSSink;
    std::unique_ptr<IsoSubspace> m_subspaceForStringDecoder;
    std::unique_ptr<IsoSubspace> m_subspaceForReadableState;
    std::unique_ptr<IsoSubspace> m_subspaceForPendingVirtualModuleResult;
    std::unique_ptr<IsoSubspace> m_subspaceForCallSite;
    std::unique_ptr<IsoSubspace> m_subspaceForNapiExternal;
    std::unique_ptr<IsoSubspace> m_subspaceForImportMeta;
    std::unique_ptr<IsoSubspace> m_subspaceForRequireResolveFunction;
    std::unique_ptr<IsoSubspace> m_subspaceForBundlerPlugin;
    std::unique_ptr<IsoSubspace> m_subspaceForNodeVMGlobalObject;
    std::unique_ptr<IsoSubspace> m_subspaceForNodeVMSpecialSandbox;
    std::unique_ptr<IsoSubspace> m_subspaceForNodeVMScript;
    std::unique_ptr<IsoSubspace> m_subspaceForNodeVMSourceTextModule;
    std::unique_ptr<IsoSubspace> m_subspaceForNodeVMSyntheticModule;
    std::unique_ptr<IsoSubspace> m_subspaceForJSCommonJSModule;
    std::unique_ptr<IsoSubspace> m_subspaceForJSCommonJSExtensions;
    std::unique_ptr<IsoSubspace> m_subspaceForJSMockImplementation;
    std::unique_ptr<IsoSubspace> m_subspaceForJSModuleMock;
    std::unique_ptr<IsoSubspace> m_subspaceForJSMockFunction;
    std::unique_ptr<IsoSubspace> m_subspaceForAsyncContextFrame;
    std::unique_ptr<IsoSubspace> m_subspaceForMockWithImplementationCleanupData;
    std::unique_ptr<IsoSubspace> m_subspaceForProcessObject;
    std::unique_ptr<IsoSubspace> m_subspaceForInternalModuleRegistry;
    std::unique_ptr<IsoSubspace> m_subspaceForErrorCodeCache;
    std::unique_ptr<IsoSubspace> m_subspaceForBunInspectorConnection;
    std::unique_ptr<IsoSubspace> m_subspaceForJSNextTickQueue;
    std::unique_ptr<IsoSubspace> m_subspaceForJSSocketHandlers;
    std::unique_ptr<IsoSubspace> m_subspaceForNAPIFunction;
    std::unique_ptr<IsoSubspace> m_subspaceForTTYWrapObject;
    std::unique_ptr<IsoSubspace> m_subspaceForNapiHandleScopeImpl;
    std::unique_ptr<IsoSubspace> m_subspaceForStrongRootBlock;
    std::unique_ptr<IsoSubspace> m_subspaceForNapiTypeTag;
    std::unique_ptr<IsoSubspace> m_subspaceForNativePromiseContext;
    std::unique_ptr<IsoSubspace> m_subspaceForObjectTemplate;
    std::unique_ptr<IsoSubspace> m_subspaceForInternalFieldObject;
    std::unique_ptr<IsoSubspace> m_subspaceForV8GlobalInternals;
    std::unique_ptr<IsoSubspace> m_subspaceForHandleScopeBuffer;
    std::unique_ptr<IsoSubspace> m_subspaceForFunctionTemplate;
    std::unique_ptr<IsoSubspace> m_subspaceForJSMIMEType;
    std::unique_ptr<IsoSubspace> m_subspaceForJSMIMEParams;
    std::unique_ptr<IsoSubspace> m_subspaceForV8Function;
    std::unique_ptr<IsoSubspace> m_subspaceForJSNodeHTTPServerSocket;
    std::unique_ptr<IsoSubspace> m_subspaceForJSS3Bucket;
    std::unique_ptr<IsoSubspace> m_subspaceForJSS3File;
    std::unique_ptr<IsoSubspace> m_subspaceForJSX509Certificate;
    std::unique_ptr<IsoSubspace> m_subspaceForJSNodePerformanceHooksHistogram;
    std::unique_ptr<IsoSubspace> m_subspaceForWasmStreamingCompiler;
    std::unique_ptr<IsoSubspace> m_subspaceForJSWebView;
#include "ZigGeneratedClasses+DOMIsoSubspaces.h"
    /*-- BUN --*/

    std::unique_ptr<IsoSubspace> m_subspaceForFetchHeaders;
    std::unique_ptr<IsoSubspace> m_subspaceForFetchHeadersIterator;
    std::unique_ptr<IsoSubspace> m_subspaceForByteLengthQueuingStrategy;
    std::unique_ptr<IsoSubspace> m_subspaceForCountQueuingStrategy;
    std::unique_ptr<IsoSubspace> m_subspaceForReadableByteStreamController;
    std::unique_ptr<IsoSubspace> m_subspaceForReadableStream;
    std::unique_ptr<IsoSubspace> m_subspaceForReadableStreamConstructor;
    std::unique_ptr<IsoSubspace> m_subspaceForReadableStreamDefaultReaderConstructor;
    std::unique_ptr<IsoSubspace> m_subspaceForReadableStreamBYOBReaderConstructor;
    std::unique_ptr<IsoSubspace> m_subspaceForWritableStreamConstructor;
    std::unique_ptr<IsoSubspace> m_subspaceForWritableStreamDefaultWriterConstructor;
    std::unique_ptr<IsoSubspace> m_subspaceForTransformStreamConstructor;
    std::unique_ptr<IsoSubspace> m_subspaceForByteLengthQueuingStrategyConstructor;
    std::unique_ptr<IsoSubspace> m_subspaceForCountQueuingStrategyConstructor;
    std::unique_ptr<IsoSubspace> m_subspaceForTextEncoderStreamConstructor;
    std::unique_ptr<IsoSubspace> m_subspaceForTextDecoderStreamConstructor;
    std::unique_ptr<IsoSubspace> m_subspaceForCompressionStreamConstructor;
    std::unique_ptr<IsoSubspace> m_subspaceForDecompressionStreamConstructor;
    std::unique_ptr<IsoSubspace> m_subspaceForStreamPipeToOperation;
    std::unique_ptr<IsoSubspace> m_subspaceForReadRequest;
    std::unique_ptr<IsoSubspace> m_subspaceForReadIntoRequest;
    std::unique_ptr<IsoSubspace> m_subspaceForPullIntoDescriptor;
    std::unique_ptr<IsoSubspace> m_subspaceForStreamTeeState;
    std::unique_ptr<IsoSubspace> m_subspaceForCrossRealmTransformState;
    std::unique_ptr<IsoSubspace> m_subspaceForStreamFromIterableContext;
    std::unique_ptr<IsoSubspace> m_subspaceForDirectStreamController;
    std::unique_ptr<IsoSubspace> m_subspaceForNativeStreamSourceAdapter;
    std::unique_ptr<IsoSubspace> m_subspaceForDirectSinkCloseState;
    std::unique_ptr<IsoSubspace> m_subspaceForAsyncIteratorSourceOperation;
    std::unique_ptr<IsoSubspace> m_subspaceForReadStreamIntoSinkOperation;
    std::unique_ptr<IsoSubspace> m_subspaceForBunStandaloneTextSink;
    std::unique_ptr<IsoSubspace> m_subspaceForOneShotDirectSink;
    std::unique_ptr<IsoSubspace> m_subspaceForReadableStreamIntoArrayOperation;
    std::unique_ptr<IsoSubspace> m_subspaceForReadableStreamAsyncIterator;
    std::unique_ptr<IsoSubspace> m_subspaceForReadableStreamReaderBase;
    std::unique_ptr<IsoSubspace> m_subspaceForReadableStreamBYOBReader;
    std::unique_ptr<IsoSubspace> m_subspaceForReadableStreamBYOBRequest;
    std::unique_ptr<IsoSubspace> m_subspaceForReadableStreamDefaultController;
    std::unique_ptr<IsoSubspace> m_subspaceForReadableStreamDefaultReader;
    std::unique_ptr<IsoSubspace> m_subspaceForTransformStream;
    std::unique_ptr<IsoSubspace> m_subspaceForTransformStreamDefaultController;
    std::unique_ptr<IsoSubspace> m_subspaceForCompressionStream;
    std::unique_ptr<IsoSubspace> m_subspaceForDecompressionStream;
    std::unique_ptr<IsoSubspace> m_subspaceForWritableStream;
    std::unique_ptr<IsoSubspace> m_subspaceForWritableStreamDefaultController;
    std::unique_ptr<IsoSubspace> m_subspaceForWritableStreamDefaultWriter;
    std::unique_ptr<IsoSubspace> m_subspaceForCloseEvent;
    std::unique_ptr<IsoSubspace> m_subspaceForWebSocket;
    std::unique_ptr<IsoSubspace> m_subspaceForCryptoKey;
    std::unique_ptr<IsoSubspace> m_subspaceForSubtleCrypto;

    std::unique_ptr<IsoSubspace> m_subspaceForBroadcastChannel;
    std::unique_ptr<IsoSubspace> m_subspaceForCustomEvent;

    std::unique_ptr<IsoSubspace> m_subspaceForMessageChannel;
    std::unique_ptr<IsoSubspace> m_subspaceForMessageEvent;
    std::unique_ptr<IsoSubspace> m_subspaceForMessagePort;
    std::unique_ptr<IsoSubspace> m_subspaceForTextDecoderStream;
    std::unique_ptr<IsoSubspace> m_subspaceForTextEncoder;
    std::unique_ptr<IsoSubspace> m_subspaceForTextEncoderStream;
    std::unique_ptr<IsoSubspace> m_subspaceForDOMFormData;
    std::unique_ptr<IsoSubspace> m_subspaceForDOMFormDataIterator;
    std::unique_ptr<IsoSubspace> m_subspaceForPerformance;
    std::unique_ptr<IsoSubspace> m_subspaceForPerformanceEntry;
    std::unique_ptr<IsoSubspace> m_subspaceForPerformanceMark;
    std::unique_ptr<IsoSubspace> m_subspaceForPerformanceMeasure;
    std::unique_ptr<IsoSubspace> m_subspaceForPerformanceObserver;
    std::unique_ptr<IsoSubspace> m_subspaceForPerformanceObserverEntryList;
    std::unique_ptr<IsoSubspace> m_subspaceForPerformanceResourceTiming;
    std::unique_ptr<IsoSubspace> m_subspaceForPerformanceServerTiming;
    std::unique_ptr<IsoSubspace> m_subspaceForPerformanceTiming;
    std::unique_ptr<IsoSubspace> m_subspaceForWorker;
    std::unique_ptr<IsoSubspace> m_subspaceForWorkerGlobalScope;

    std::unique_ptr<IsoSubspace> m_subspaceForBakeGlobalScope;

    std::unique_ptr<IsoSubspace> m_subspaceForAbortController;
    std::unique_ptr<IsoSubspace> m_subspaceForAbortSignal;
    std::unique_ptr<IsoSubspace> m_subspaceForErrorEvent;
    std::unique_ptr<IsoSubspace> m_subspaceForEvent;
    std::unique_ptr<IsoSubspace> m_subspaceForEventListener;
    std::unique_ptr<IsoSubspace> m_subspaceForEventTarget;
    std::unique_ptr<IsoSubspace> m_subspaceForEventEmitter;

    std::unique_ptr<IsoSubspace> m_subspaceForZigGlobalObject;

    std::unique_ptr<IsoSubspace> m_subspaceForExposedToWorkerAndWindow;
    std::unique_ptr<IsoSubspace> m_subspaceForURLSearchParams;
    std::unique_ptr<IsoSubspace> m_subspaceForURLSearchParamsIterator;

    std::unique_ptr<IsoSubspace> m_subspaceForCookie;
    std::unique_ptr<IsoSubspace> m_subspaceForCookieMap;
    std::unique_ptr<IsoSubspace> m_subspaceForCookieMapIterator;

    std::unique_ptr<IsoSubspace> m_subspaceForDOMException;
    std::unique_ptr<IsoSubspace> m_subspaceForDOMURL;
    std::unique_ptr<IsoSubspace> m_subspaceForURLPattern;
    std::unique_ptr<IsoSubspace> m_subspaceForJSSign;
    std::unique_ptr<IsoSubspace> m_subspaceForJSVerify;
    std::unique_ptr<IsoSubspace> m_subspaceForJSHmac;
    std::unique_ptr<IsoSubspace> m_subspaceForJSHash;
    std::unique_ptr<IsoSubspace> m_subspaceForServerRouteList;
    std::unique_ptr<IsoSubspace> m_subspaceForBunRequest;
    std::unique_ptr<IsoSubspace> m_subspaceForBakeResponse;
    std::unique_ptr<IsoSubspace> m_subspaceForJSDiffieHellman;
    std::unique_ptr<IsoSubspace> m_subspaceForJSDiffieHellmanGroup;
    std::unique_ptr<IsoSubspace> m_subspaceForJSECDH;
    std::unique_ptr<IsoSubspace> m_subspaceForJSCipher;
    std::unique_ptr<IsoSubspace> m_subspaceForJSKeyObject;
    std::unique_ptr<IsoSubspace> m_subspaceForJSSecretKeyObject;
    std::unique_ptr<IsoSubspace> m_subspaceForJSPublicKeyObject;
    std::unique_ptr<IsoSubspace> m_subspaceForJSPrivateKeyObject;

    std::unique_ptr<IsoSubspace> m_subspaceForJSConnectionsList;
    std::unique_ptr<IsoSubspace> m_subspaceForJSHTTPParser;
};
} // namespace WebCore

namespace WebCore {
using DOMIsoSubspaces = WebCore::DOMIsoSubspaces;
}
