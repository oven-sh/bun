JSC::Structure* JSBlobStructure() { return m_JSBlob.getInitializedOnMainThread(this); }
        JSC::JSObject* JSBlobConstructor() { return m_JSBlob.constructorInitializedOnMainThread(this); }
        JSC::JSValue JSBlobPrototype() { return m_JSBlob.prototypeInitializedOnMainThread(this); }
  JSC::LazyClassStructure m_JSBlob;
  bool hasJSBlobSetterValue { false };
  mutable JSC::WriteBarrier<JSC::Unknown> m_JSBlobSetterValue;
JSC::Structure* JSBuildArtifactStructure() { return m_JSBuildArtifact.getInitializedOnMainThread(this); }
        JSC::JSObject* JSBuildArtifactConstructor() { return m_JSBuildArtifact.constructorInitializedOnMainThread(this); }
        JSC::JSValue JSBuildArtifactPrototype() { return m_JSBuildArtifact.prototypeInitializedOnMainThread(this); }
  JSC::LazyClassStructure m_JSBuildArtifact;
  bool hasJSBuildArtifactSetterValue { false };
  mutable JSC::WriteBarrier<JSC::Unknown> m_JSBuildArtifactSetterValue;
JSC::Structure* JSBuildMessageStructure() { return m_JSBuildMessage.getInitializedOnMainThread(this); }
        JSC::JSObject* JSBuildMessageConstructor() { return m_JSBuildMessage.constructorInitializedOnMainThread(this); }
        JSC::JSValue JSBuildMessagePrototype() { return m_JSBuildMessage.prototypeInitializedOnMainThread(this); }
  JSC::LazyClassStructure m_JSBuildMessage;
  bool hasJSBuildMessageSetterValue { false };
  mutable JSC::WriteBarrier<JSC::Unknown> m_JSBuildMessageSetterValue;
JSC::Structure* JSCryptoHasherStructure() { return m_JSCryptoHasher.getInitializedOnMainThread(this); }
        JSC::JSObject* JSCryptoHasherConstructor() { return m_JSCryptoHasher.constructorInitializedOnMainThread(this); }
        JSC::JSValue JSCryptoHasherPrototype() { return m_JSCryptoHasher.prototypeInitializedOnMainThread(this); }
  JSC::LazyClassStructure m_JSCryptoHasher;
  bool hasJSCryptoHasherSetterValue { false };
  mutable JSC::WriteBarrier<JSC::Unknown> m_JSCryptoHasherSetterValue;
JSC::Structure* JSDirentStructure() { return m_JSDirent.getInitializedOnMainThread(this); }
        JSC::JSObject* JSDirentConstructor() { return m_JSDirent.constructorInitializedOnMainThread(this); }
        JSC::JSValue JSDirentPrototype() { return m_JSDirent.prototypeInitializedOnMainThread(this); }
  JSC::LazyClassStructure m_JSDirent;
  bool hasJSDirentSetterValue { false };
  mutable JSC::WriteBarrier<JSC::Unknown> m_JSDirentSetterValue;
JSC::Structure* JSExpectStructure() { return m_JSExpect.getInitializedOnMainThread(this); }
        JSC::JSObject* JSExpectConstructor() { return m_JSExpect.constructorInitializedOnMainThread(this); }
        JSC::JSValue JSExpectPrototype() { return m_JSExpect.prototypeInitializedOnMainThread(this); }
  JSC::LazyClassStructure m_JSExpect;
  bool hasJSExpectSetterValue { false };
  mutable JSC::WriteBarrier<JSC::Unknown> m_JSExpectSetterValue;
JSC::Structure* JSExpectAnyStructure() { return m_JSExpectAny.getInitializedOnMainThread(this); }
        JSC::JSObject* JSExpectAnyConstructor() { return m_JSExpectAny.constructorInitializedOnMainThread(this); }
        JSC::JSValue JSExpectAnyPrototype() { return m_JSExpectAny.prototypeInitializedOnMainThread(this); }
  JSC::LazyClassStructure m_JSExpectAny;
  bool hasJSExpectAnySetterValue { false };
  mutable JSC::WriteBarrier<JSC::Unknown> m_JSExpectAnySetterValue;
JSC::Structure* JSExpectAnythingStructure() { return m_JSExpectAnything.getInitializedOnMainThread(this); }
        JSC::JSObject* JSExpectAnythingConstructor() { return m_JSExpectAnything.constructorInitializedOnMainThread(this); }
        JSC::JSValue JSExpectAnythingPrototype() { return m_JSExpectAnything.prototypeInitializedOnMainThread(this); }
  JSC::LazyClassStructure m_JSExpectAnything;
  bool hasJSExpectAnythingSetterValue { false };
  mutable JSC::WriteBarrier<JSC::Unknown> m_JSExpectAnythingSetterValue;
JSC::Structure* JSExpectStringContainingStructure() { return m_JSExpectStringContaining.getInitializedOnMainThread(this); }
        JSC::JSObject* JSExpectStringContainingConstructor() { return m_JSExpectStringContaining.constructorInitializedOnMainThread(this); }
        JSC::JSValue JSExpectStringContainingPrototype() { return m_JSExpectStringContaining.prototypeInitializedOnMainThread(this); }
  JSC::LazyClassStructure m_JSExpectStringContaining;
  bool hasJSExpectStringContainingSetterValue { false };
  mutable JSC::WriteBarrier<JSC::Unknown> m_JSExpectStringContainingSetterValue;
JSC::Structure* JSExpectStringMatchingStructure() { return m_JSExpectStringMatching.getInitializedOnMainThread(this); }
        JSC::JSObject* JSExpectStringMatchingConstructor() { return m_JSExpectStringMatching.constructorInitializedOnMainThread(this); }
        JSC::JSValue JSExpectStringMatchingPrototype() { return m_JSExpectStringMatching.prototypeInitializedOnMainThread(this); }
  JSC::LazyClassStructure m_JSExpectStringMatching;
  bool hasJSExpectStringMatchingSetterValue { false };
  mutable JSC::WriteBarrier<JSC::Unknown> m_JSExpectStringMatchingSetterValue;
JSC::Structure* JSFileSystemRouterStructure() { return m_JSFileSystemRouter.getInitializedOnMainThread(this); }
        JSC::JSObject* JSFileSystemRouterConstructor() { return m_JSFileSystemRouter.constructorInitializedOnMainThread(this); }
        JSC::JSValue JSFileSystemRouterPrototype() { return m_JSFileSystemRouter.prototypeInitializedOnMainThread(this); }
  JSC::LazyClassStructure m_JSFileSystemRouter;
  bool hasJSFileSystemRouterSetterValue { false };
  mutable JSC::WriteBarrier<JSC::Unknown> m_JSFileSystemRouterSetterValue;
JSC::Structure* JSListenerStructure() { return m_JSListener.getInitializedOnMainThread(this); }
        JSC::JSObject* JSListenerConstructor() { return m_JSListener.constructorInitializedOnMainThread(this); }
        JSC::JSValue JSListenerPrototype() { return m_JSListener.prototypeInitializedOnMainThread(this); }
  JSC::LazyClassStructure m_JSListener;
  bool hasJSListenerSetterValue { false };
  mutable JSC::WriteBarrier<JSC::Unknown> m_JSListenerSetterValue;
JSC::Structure* JSMD4Structure() { return m_JSMD4.getInitializedOnMainThread(this); }
        JSC::JSObject* JSMD4Constructor() { return m_JSMD4.constructorInitializedOnMainThread(this); }
        JSC::JSValue JSMD4Prototype() { return m_JSMD4.prototypeInitializedOnMainThread(this); }
  JSC::LazyClassStructure m_JSMD4;
  bool hasJSMD4SetterValue { false };
  mutable JSC::WriteBarrier<JSC::Unknown> m_JSMD4SetterValue;
JSC::Structure* JSMD5Structure() { return m_JSMD5.getInitializedOnMainThread(this); }
        JSC::JSObject* JSMD5Constructor() { return m_JSMD5.constructorInitializedOnMainThread(this); }
        JSC::JSValue JSMD5Prototype() { return m_JSMD5.prototypeInitializedOnMainThread(this); }
  JSC::LazyClassStructure m_JSMD5;
  bool hasJSMD5SetterValue { false };
  mutable JSC::WriteBarrier<JSC::Unknown> m_JSMD5SetterValue;
JSC::Structure* JSMatchedRouteStructure() { return m_JSMatchedRoute.getInitializedOnMainThread(this); }
        JSC::JSObject* JSMatchedRouteConstructor() { return m_JSMatchedRoute.constructorInitializedOnMainThread(this); }
        JSC::JSValue JSMatchedRoutePrototype() { return m_JSMatchedRoute.prototypeInitializedOnMainThread(this); }
  JSC::LazyClassStructure m_JSMatchedRoute;
  bool hasJSMatchedRouteSetterValue { false };
  mutable JSC::WriteBarrier<JSC::Unknown> m_JSMatchedRouteSetterValue;
JSC::Structure* JSNodeJSFSStructure() { return m_JSNodeJSFS.getInitializedOnMainThread(this); }
        JSC::JSObject* JSNodeJSFSConstructor() { return m_JSNodeJSFS.constructorInitializedOnMainThread(this); }
        JSC::JSValue JSNodeJSFSPrototype() { return m_JSNodeJSFS.prototypeInitializedOnMainThread(this); }
  JSC::LazyClassStructure m_JSNodeJSFS;
  bool hasJSNodeJSFSSetterValue { false };
  mutable JSC::WriteBarrier<JSC::Unknown> m_JSNodeJSFSSetterValue;
JSC::Structure* JSRequestStructure() { return m_JSRequest.getInitializedOnMainThread(this); }
        JSC::JSObject* JSRequestConstructor() { return m_JSRequest.constructorInitializedOnMainThread(this); }
        JSC::JSValue JSRequestPrototype() { return m_JSRequest.prototypeInitializedOnMainThread(this); }
  JSC::LazyClassStructure m_JSRequest;
  bool hasJSRequestSetterValue { false };
  mutable JSC::WriteBarrier<JSC::Unknown> m_JSRequestSetterValue;
JSC::Structure* JSResolveMessageStructure() { return m_JSResolveMessage.getInitializedOnMainThread(this); }
        JSC::JSObject* JSResolveMessageConstructor() { return m_JSResolveMessage.constructorInitializedOnMainThread(this); }
        JSC::JSValue JSResolveMessagePrototype() { return m_JSResolveMessage.prototypeInitializedOnMainThread(this); }
  JSC::LazyClassStructure m_JSResolveMessage;
  bool hasJSResolveMessageSetterValue { false };
  mutable JSC::WriteBarrier<JSC::Unknown> m_JSResolveMessageSetterValue;
JSC::Structure* JSResponseStructure() { return m_JSResponse.getInitializedOnMainThread(this); }
        JSC::JSObject* JSResponseConstructor() { return m_JSResponse.constructorInitializedOnMainThread(this); }
        JSC::JSValue JSResponsePrototype() { return m_JSResponse.prototypeInitializedOnMainThread(this); }
  JSC::LazyClassStructure m_JSResponse;
  bool hasJSResponseSetterValue { false };
  mutable JSC::WriteBarrier<JSC::Unknown> m_JSResponseSetterValue;
JSC::Structure* JSSHA1Structure() { return m_JSSHA1.getInitializedOnMainThread(this); }
        JSC::JSObject* JSSHA1Constructor() { return m_JSSHA1.constructorInitializedOnMainThread(this); }
        JSC::JSValue JSSHA1Prototype() { return m_JSSHA1.prototypeInitializedOnMainThread(this); }
  JSC::LazyClassStructure m_JSSHA1;
  bool hasJSSHA1SetterValue { false };
  mutable JSC::WriteBarrier<JSC::Unknown> m_JSSHA1SetterValue;
JSC::Structure* JSSHA224Structure() { return m_JSSHA224.getInitializedOnMainThread(this); }
        JSC::JSObject* JSSHA224Constructor() { return m_JSSHA224.constructorInitializedOnMainThread(this); }
        JSC::JSValue JSSHA224Prototype() { return m_JSSHA224.prototypeInitializedOnMainThread(this); }
  JSC::LazyClassStructure m_JSSHA224;
  bool hasJSSHA224SetterValue { false };
  mutable JSC::WriteBarrier<JSC::Unknown> m_JSSHA224SetterValue;
JSC::Structure* JSSHA256Structure() { return m_JSSHA256.getInitializedOnMainThread(this); }
        JSC::JSObject* JSSHA256Constructor() { return m_JSSHA256.constructorInitializedOnMainThread(this); }
        JSC::JSValue JSSHA256Prototype() { return m_JSSHA256.prototypeInitializedOnMainThread(this); }
  JSC::LazyClassStructure m_JSSHA256;
  bool hasJSSHA256SetterValue { false };
  mutable JSC::WriteBarrier<JSC::Unknown> m_JSSHA256SetterValue;
JSC::Structure* JSSHA384Structure() { return m_JSSHA384.getInitializedOnMainThread(this); }
        JSC::JSObject* JSSHA384Constructor() { return m_JSSHA384.constructorInitializedOnMainThread(this); }
        JSC::JSValue JSSHA384Prototype() { return m_JSSHA384.prototypeInitializedOnMainThread(this); }
  JSC::LazyClassStructure m_JSSHA384;
  bool hasJSSHA384SetterValue { false };
  mutable JSC::WriteBarrier<JSC::Unknown> m_JSSHA384SetterValue;
JSC::Structure* JSSHA512Structure() { return m_JSSHA512.getInitializedOnMainThread(this); }
        JSC::JSObject* JSSHA512Constructor() { return m_JSSHA512.constructorInitializedOnMainThread(this); }
        JSC::JSValue JSSHA512Prototype() { return m_JSSHA512.prototypeInitializedOnMainThread(this); }
  JSC::LazyClassStructure m_JSSHA512;
  bool hasJSSHA512SetterValue { false };
  mutable JSC::WriteBarrier<JSC::Unknown> m_JSSHA512SetterValue;
JSC::Structure* JSSHA512_256Structure() { return m_JSSHA512_256.getInitializedOnMainThread(this); }
        JSC::JSObject* JSSHA512_256Constructor() { return m_JSSHA512_256.constructorInitializedOnMainThread(this); }
        JSC::JSValue JSSHA512_256Prototype() { return m_JSSHA512_256.prototypeInitializedOnMainThread(this); }
  JSC::LazyClassStructure m_JSSHA512_256;
  bool hasJSSHA512_256SetterValue { false };
  mutable JSC::WriteBarrier<JSC::Unknown> m_JSSHA512_256SetterValue;
JSC::Structure* JSServerWebSocketStructure() { return m_JSServerWebSocket.getInitializedOnMainThread(this); }
        JSC::JSObject* JSServerWebSocketConstructor() { return m_JSServerWebSocket.constructorInitializedOnMainThread(this); }
        JSC::JSValue JSServerWebSocketPrototype() { return m_JSServerWebSocket.prototypeInitializedOnMainThread(this); }
  JSC::LazyClassStructure m_JSServerWebSocket;
  bool hasJSServerWebSocketSetterValue { false };
  mutable JSC::WriteBarrier<JSC::Unknown> m_JSServerWebSocketSetterValue;
JSC::Structure* JSStatsStructure() { return m_JSStats.getInitializedOnMainThread(this); }
        JSC::JSObject* JSStatsConstructor() { return m_JSStats.constructorInitializedOnMainThread(this); }
        JSC::JSValue JSStatsPrototype() { return m_JSStats.prototypeInitializedOnMainThread(this); }
  JSC::LazyClassStructure m_JSStats;
  bool hasJSStatsSetterValue { false };
  mutable JSC::WriteBarrier<JSC::Unknown> m_JSStatsSetterValue;
JSC::Structure* JSSubprocessStructure() { return m_JSSubprocess.getInitializedOnMainThread(this); }
        JSC::JSObject* JSSubprocessConstructor() { return m_JSSubprocess.constructorInitializedOnMainThread(this); }
        JSC::JSValue JSSubprocessPrototype() { return m_JSSubprocess.prototypeInitializedOnMainThread(this); }
  JSC::LazyClassStructure m_JSSubprocess;
  bool hasJSSubprocessSetterValue { false };
  mutable JSC::WriteBarrier<JSC::Unknown> m_JSSubprocessSetterValue;
JSC::Structure* JSTCPSocketStructure() { return m_JSTCPSocket.getInitializedOnMainThread(this); }
        JSC::JSObject* JSTCPSocketConstructor() { return m_JSTCPSocket.constructorInitializedOnMainThread(this); }
        JSC::JSValue JSTCPSocketPrototype() { return m_JSTCPSocket.prototypeInitializedOnMainThread(this); }
  JSC::LazyClassStructure m_JSTCPSocket;
  bool hasJSTCPSocketSetterValue { false };
  mutable JSC::WriteBarrier<JSC::Unknown> m_JSTCPSocketSetterValue;
JSC::Structure* JSTLSSocketStructure() { return m_JSTLSSocket.getInitializedOnMainThread(this); }
        JSC::JSObject* JSTLSSocketConstructor() { return m_JSTLSSocket.constructorInitializedOnMainThread(this); }
        JSC::JSValue JSTLSSocketPrototype() { return m_JSTLSSocket.prototypeInitializedOnMainThread(this); }
  JSC::LazyClassStructure m_JSTLSSocket;
  bool hasJSTLSSocketSetterValue { false };
  mutable JSC::WriteBarrier<JSC::Unknown> m_JSTLSSocketSetterValue;
JSC::Structure* JSTextDecoderStructure() { return m_JSTextDecoder.getInitializedOnMainThread(this); }
        JSC::JSObject* JSTextDecoderConstructor() { return m_JSTextDecoder.constructorInitializedOnMainThread(this); }
        JSC::JSValue JSTextDecoderPrototype() { return m_JSTextDecoder.prototypeInitializedOnMainThread(this); }
  JSC::LazyClassStructure m_JSTextDecoder;
  bool hasJSTextDecoderSetterValue { false };
  mutable JSC::WriteBarrier<JSC::Unknown> m_JSTextDecoderSetterValue;
JSC::Structure* JSTimeoutStructure() { return m_JSTimeout.getInitializedOnMainThread(this); }
        JSC::JSObject* JSTimeoutConstructor() { return m_JSTimeout.constructorInitializedOnMainThread(this); }
        JSC::JSValue JSTimeoutPrototype() { return m_JSTimeout.prototypeInitializedOnMainThread(this); }
  JSC::LazyClassStructure m_JSTimeout;
  bool hasJSTimeoutSetterValue { false };
  mutable JSC::WriteBarrier<JSC::Unknown> m_JSTimeoutSetterValue;
JSC::Structure* JSTranspilerStructure() { return m_JSTranspiler.getInitializedOnMainThread(this); }
        JSC::JSObject* JSTranspilerConstructor() { return m_JSTranspiler.constructorInitializedOnMainThread(this); }
        JSC::JSValue JSTranspilerPrototype() { return m_JSTranspiler.prototypeInitializedOnMainThread(this); }
  JSC::LazyClassStructure m_JSTranspiler;
  bool hasJSTranspilerSetterValue { false };
  mutable JSC::WriteBarrier<JSC::Unknown> m_JSTranspilerSetterValue;