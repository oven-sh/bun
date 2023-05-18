void GlobalObject::initGeneratedLazyClasses() {
    m_JSBlob.initLater(
              [](LazyClassStructure::Initializer& init) {
                 init.setPrototype(WebCore::JSBlob::createPrototype(init.vm, reinterpret_cast<Zig::GlobalObject*>(init.global)));
                 init.setStructure(WebCore::JSBlob::createStructure(init.vm, init.global, init.prototype));
                 init.setConstructor(WebCore::JSBlob::createConstructor(init.vm, init.global, init.prototype));
              });
    m_JSBuildArtifact.initLater(
              [](LazyClassStructure::Initializer& init) {
                 init.setPrototype(WebCore::JSBuildArtifact::createPrototype(init.vm, reinterpret_cast<Zig::GlobalObject*>(init.global)));
                 init.setStructure(WebCore::JSBuildArtifact::createStructure(init.vm, init.global, init.prototype));
                 
              });
    m_JSBuildMessage.initLater(
              [](LazyClassStructure::Initializer& init) {
                 init.setPrototype(WebCore::JSBuildMessage::createPrototype(init.vm, reinterpret_cast<Zig::GlobalObject*>(init.global)));
                 init.setStructure(WebCore::JSBuildMessage::createStructure(init.vm, init.global, init.prototype));
                 init.setConstructor(WebCore::JSBuildMessage::createConstructor(init.vm, init.global, init.prototype));
              });
    m_JSCryptoHasher.initLater(
              [](LazyClassStructure::Initializer& init) {
                 init.setPrototype(WebCore::JSCryptoHasher::createPrototype(init.vm, reinterpret_cast<Zig::GlobalObject*>(init.global)));
                 init.setStructure(WebCore::JSCryptoHasher::createStructure(init.vm, init.global, init.prototype));
                 init.setConstructor(WebCore::JSCryptoHasher::createConstructor(init.vm, init.global, init.prototype));
              });
    m_JSDirent.initLater(
              [](LazyClassStructure::Initializer& init) {
                 init.setPrototype(WebCore::JSDirent::createPrototype(init.vm, reinterpret_cast<Zig::GlobalObject*>(init.global)));
                 init.setStructure(WebCore::JSDirent::createStructure(init.vm, init.global, init.prototype));
                 init.setConstructor(WebCore::JSDirent::createConstructor(init.vm, init.global, init.prototype));
              });
    m_JSExpect.initLater(
              [](LazyClassStructure::Initializer& init) {
                 init.setPrototype(WebCore::JSExpect::createPrototype(init.vm, reinterpret_cast<Zig::GlobalObject*>(init.global)));
                 init.setStructure(WebCore::JSExpect::createStructure(init.vm, init.global, init.prototype));
                 init.setConstructor(WebCore::JSExpect::createConstructor(init.vm, init.global, init.prototype));
              });
    m_JSExpectAny.initLater(
              [](LazyClassStructure::Initializer& init) {
                 init.setPrototype(WebCore::JSExpectAny::createPrototype(init.vm, reinterpret_cast<Zig::GlobalObject*>(init.global)));
                 init.setStructure(WebCore::JSExpectAny::createStructure(init.vm, init.global, init.prototype));
                 
              });
    m_JSFileSystemRouter.initLater(
              [](LazyClassStructure::Initializer& init) {
                 init.setPrototype(WebCore::JSFileSystemRouter::createPrototype(init.vm, reinterpret_cast<Zig::GlobalObject*>(init.global)));
                 init.setStructure(WebCore::JSFileSystemRouter::createStructure(init.vm, init.global, init.prototype));
                 init.setConstructor(WebCore::JSFileSystemRouter::createConstructor(init.vm, init.global, init.prototype));
              });
    m_JSListener.initLater(
              [](LazyClassStructure::Initializer& init) {
                 init.setPrototype(WebCore::JSListener::createPrototype(init.vm, reinterpret_cast<Zig::GlobalObject*>(init.global)));
                 init.setStructure(WebCore::JSListener::createStructure(init.vm, init.global, init.prototype));
                 
              });
    m_JSMD4.initLater(
              [](LazyClassStructure::Initializer& init) {
                 init.setPrototype(WebCore::JSMD4::createPrototype(init.vm, reinterpret_cast<Zig::GlobalObject*>(init.global)));
                 init.setStructure(WebCore::JSMD4::createStructure(init.vm, init.global, init.prototype));
                 init.setConstructor(WebCore::JSMD4::createConstructor(init.vm, init.global, init.prototype));
              });
    m_JSMD5.initLater(
              [](LazyClassStructure::Initializer& init) {
                 init.setPrototype(WebCore::JSMD5::createPrototype(init.vm, reinterpret_cast<Zig::GlobalObject*>(init.global)));
                 init.setStructure(WebCore::JSMD5::createStructure(init.vm, init.global, init.prototype));
                 init.setConstructor(WebCore::JSMD5::createConstructor(init.vm, init.global, init.prototype));
              });
    m_JSMatchedRoute.initLater(
              [](LazyClassStructure::Initializer& init) {
                 init.setPrototype(WebCore::JSMatchedRoute::createPrototype(init.vm, reinterpret_cast<Zig::GlobalObject*>(init.global)));
                 init.setStructure(WebCore::JSMatchedRoute::createStructure(init.vm, init.global, init.prototype));
                 
              });
    m_JSNodeJSFS.initLater(
              [](LazyClassStructure::Initializer& init) {
                 init.setPrototype(WebCore::JSNodeJSFS::createPrototype(init.vm, reinterpret_cast<Zig::GlobalObject*>(init.global)));
                 init.setStructure(WebCore::JSNodeJSFS::createStructure(init.vm, init.global, init.prototype));
                 init.setConstructor(WebCore::JSNodeJSFS::createConstructor(init.vm, init.global, init.prototype));
              });
    m_JSRequest.initLater(
              [](LazyClassStructure::Initializer& init) {
                 init.setPrototype(WebCore::JSRequest::createPrototype(init.vm, reinterpret_cast<Zig::GlobalObject*>(init.global)));
                 init.setStructure(WebCore::JSRequest::createStructure(init.vm, init.global, init.prototype));
                 init.setConstructor(WebCore::JSRequest::createConstructor(init.vm, init.global, init.prototype));
              });
    m_JSResolveMessage.initLater(
              [](LazyClassStructure::Initializer& init) {
                 init.setPrototype(WebCore::JSResolveMessage::createPrototype(init.vm, reinterpret_cast<Zig::GlobalObject*>(init.global)));
                 init.setStructure(WebCore::JSResolveMessage::createStructure(init.vm, init.global, init.prototype));
                 init.setConstructor(WebCore::JSResolveMessage::createConstructor(init.vm, init.global, init.prototype));
              });
    m_JSResponse.initLater(
              [](LazyClassStructure::Initializer& init) {
                 init.setPrototype(WebCore::JSResponse::createPrototype(init.vm, reinterpret_cast<Zig::GlobalObject*>(init.global)));
                 init.setStructure(WebCore::JSResponse::createStructure(init.vm, init.global, init.prototype));
                 init.setConstructor(WebCore::JSResponse::createConstructor(init.vm, init.global, init.prototype));
              });
    m_JSSHA1.initLater(
              [](LazyClassStructure::Initializer& init) {
                 init.setPrototype(WebCore::JSSHA1::createPrototype(init.vm, reinterpret_cast<Zig::GlobalObject*>(init.global)));
                 init.setStructure(WebCore::JSSHA1::createStructure(init.vm, init.global, init.prototype));
                 init.setConstructor(WebCore::JSSHA1::createConstructor(init.vm, init.global, init.prototype));
              });
    m_JSSHA224.initLater(
              [](LazyClassStructure::Initializer& init) {
                 init.setPrototype(WebCore::JSSHA224::createPrototype(init.vm, reinterpret_cast<Zig::GlobalObject*>(init.global)));
                 init.setStructure(WebCore::JSSHA224::createStructure(init.vm, init.global, init.prototype));
                 init.setConstructor(WebCore::JSSHA224::createConstructor(init.vm, init.global, init.prototype));
              });
    m_JSSHA256.initLater(
              [](LazyClassStructure::Initializer& init) {
                 init.setPrototype(WebCore::JSSHA256::createPrototype(init.vm, reinterpret_cast<Zig::GlobalObject*>(init.global)));
                 init.setStructure(WebCore::JSSHA256::createStructure(init.vm, init.global, init.prototype));
                 init.setConstructor(WebCore::JSSHA256::createConstructor(init.vm, init.global, init.prototype));
              });
    m_JSSHA384.initLater(
              [](LazyClassStructure::Initializer& init) {
                 init.setPrototype(WebCore::JSSHA384::createPrototype(init.vm, reinterpret_cast<Zig::GlobalObject*>(init.global)));
                 init.setStructure(WebCore::JSSHA384::createStructure(init.vm, init.global, init.prototype));
                 init.setConstructor(WebCore::JSSHA384::createConstructor(init.vm, init.global, init.prototype));
              });
    m_JSSHA512.initLater(
              [](LazyClassStructure::Initializer& init) {
                 init.setPrototype(WebCore::JSSHA512::createPrototype(init.vm, reinterpret_cast<Zig::GlobalObject*>(init.global)));
                 init.setStructure(WebCore::JSSHA512::createStructure(init.vm, init.global, init.prototype));
                 init.setConstructor(WebCore::JSSHA512::createConstructor(init.vm, init.global, init.prototype));
              });
    m_JSSHA512_256.initLater(
              [](LazyClassStructure::Initializer& init) {
                 init.setPrototype(WebCore::JSSHA512_256::createPrototype(init.vm, reinterpret_cast<Zig::GlobalObject*>(init.global)));
                 init.setStructure(WebCore::JSSHA512_256::createStructure(init.vm, init.global, init.prototype));
                 init.setConstructor(WebCore::JSSHA512_256::createConstructor(init.vm, init.global, init.prototype));
              });
    m_JSServerWebSocket.initLater(
              [](LazyClassStructure::Initializer& init) {
                 init.setPrototype(WebCore::JSServerWebSocket::createPrototype(init.vm, reinterpret_cast<Zig::GlobalObject*>(init.global)));
                 init.setStructure(WebCore::JSServerWebSocket::createStructure(init.vm, init.global, init.prototype));
                 init.setConstructor(WebCore::JSServerWebSocket::createConstructor(init.vm, init.global, init.prototype));
              });
    m_JSStats.initLater(
              [](LazyClassStructure::Initializer& init) {
                 init.setPrototype(WebCore::JSStats::createPrototype(init.vm, reinterpret_cast<Zig::GlobalObject*>(init.global)));
                 init.setStructure(WebCore::JSStats::createStructure(init.vm, init.global, init.prototype));
                 init.setConstructor(WebCore::JSStats::createConstructor(init.vm, init.global, init.prototype));
              });
    m_JSSubprocess.initLater(
              [](LazyClassStructure::Initializer& init) {
                 init.setPrototype(WebCore::JSSubprocess::createPrototype(init.vm, reinterpret_cast<Zig::GlobalObject*>(init.global)));
                 init.setStructure(WebCore::JSSubprocess::createStructure(init.vm, init.global, init.prototype));
                 
              });
    m_JSTCPSocket.initLater(
              [](LazyClassStructure::Initializer& init) {
                 init.setPrototype(WebCore::JSTCPSocket::createPrototype(init.vm, reinterpret_cast<Zig::GlobalObject*>(init.global)));
                 init.setStructure(WebCore::JSTCPSocket::createStructure(init.vm, init.global, init.prototype));
                 
              });
    m_JSTLSSocket.initLater(
              [](LazyClassStructure::Initializer& init) {
                 init.setPrototype(WebCore::JSTLSSocket::createPrototype(init.vm, reinterpret_cast<Zig::GlobalObject*>(init.global)));
                 init.setStructure(WebCore::JSTLSSocket::createStructure(init.vm, init.global, init.prototype));
                 
              });
    m_JSTextDecoder.initLater(
              [](LazyClassStructure::Initializer& init) {
                 init.setPrototype(WebCore::JSTextDecoder::createPrototype(init.vm, reinterpret_cast<Zig::GlobalObject*>(init.global)));
                 init.setStructure(WebCore::JSTextDecoder::createStructure(init.vm, init.global, init.prototype));
                 init.setConstructor(WebCore::JSTextDecoder::createConstructor(init.vm, init.global, init.prototype));
              });
    m_JSTimeout.initLater(
              [](LazyClassStructure::Initializer& init) {
                 init.setPrototype(WebCore::JSTimeout::createPrototype(init.vm, reinterpret_cast<Zig::GlobalObject*>(init.global)));
                 init.setStructure(WebCore::JSTimeout::createStructure(init.vm, init.global, init.prototype));
                 
              });
    m_JSTranspiler.initLater(
              [](LazyClassStructure::Initializer& init) {
                 init.setPrototype(WebCore::JSTranspiler::createPrototype(init.vm, reinterpret_cast<Zig::GlobalObject*>(init.global)));
                 init.setStructure(WebCore::JSTranspiler::createStructure(init.vm, init.global, init.prototype));
                 init.setConstructor(WebCore::JSTranspiler::createConstructor(init.vm, init.global, init.prototype));
              });
}
template<typename Visitor>
void GlobalObject::visitGeneratedLazyClasses(GlobalObject *thisObject, Visitor& visitor)
{
      thisObject->m_JSBlob.visit(visitor);  visitor.append(thisObject->m_JSBlobSetterValue);
      thisObject->m_JSBuildArtifact.visit(visitor);  visitor.append(thisObject->m_JSBuildArtifactSetterValue);
      thisObject->m_JSBuildMessage.visit(visitor);  visitor.append(thisObject->m_JSBuildMessageSetterValue);
      thisObject->m_JSCryptoHasher.visit(visitor);  visitor.append(thisObject->m_JSCryptoHasherSetterValue);
      thisObject->m_JSDirent.visit(visitor);  visitor.append(thisObject->m_JSDirentSetterValue);
      thisObject->m_JSExpect.visit(visitor);  visitor.append(thisObject->m_JSExpectSetterValue);
      thisObject->m_JSExpectAny.visit(visitor);  visitor.append(thisObject->m_JSExpectAnySetterValue);
      thisObject->m_JSFileSystemRouter.visit(visitor);  visitor.append(thisObject->m_JSFileSystemRouterSetterValue);
      thisObject->m_JSListener.visit(visitor);  visitor.append(thisObject->m_JSListenerSetterValue);
      thisObject->m_JSMD4.visit(visitor);  visitor.append(thisObject->m_JSMD4SetterValue);
      thisObject->m_JSMD5.visit(visitor);  visitor.append(thisObject->m_JSMD5SetterValue);
      thisObject->m_JSMatchedRoute.visit(visitor);  visitor.append(thisObject->m_JSMatchedRouteSetterValue);
      thisObject->m_JSNodeJSFS.visit(visitor);  visitor.append(thisObject->m_JSNodeJSFSSetterValue);
      thisObject->m_JSRequest.visit(visitor);  visitor.append(thisObject->m_JSRequestSetterValue);
      thisObject->m_JSResolveMessage.visit(visitor);  visitor.append(thisObject->m_JSResolveMessageSetterValue);
      thisObject->m_JSResponse.visit(visitor);  visitor.append(thisObject->m_JSResponseSetterValue);
      thisObject->m_JSSHA1.visit(visitor);  visitor.append(thisObject->m_JSSHA1SetterValue);
      thisObject->m_JSSHA224.visit(visitor);  visitor.append(thisObject->m_JSSHA224SetterValue);
      thisObject->m_JSSHA256.visit(visitor);  visitor.append(thisObject->m_JSSHA256SetterValue);
      thisObject->m_JSSHA384.visit(visitor);  visitor.append(thisObject->m_JSSHA384SetterValue);
      thisObject->m_JSSHA512.visit(visitor);  visitor.append(thisObject->m_JSSHA512SetterValue);
      thisObject->m_JSSHA512_256.visit(visitor);  visitor.append(thisObject->m_JSSHA512_256SetterValue);
      thisObject->m_JSServerWebSocket.visit(visitor);  visitor.append(thisObject->m_JSServerWebSocketSetterValue);
      thisObject->m_JSStats.visit(visitor);  visitor.append(thisObject->m_JSStatsSetterValue);
      thisObject->m_JSSubprocess.visit(visitor);  visitor.append(thisObject->m_JSSubprocessSetterValue);
      thisObject->m_JSTCPSocket.visit(visitor);  visitor.append(thisObject->m_JSTCPSocketSetterValue);
      thisObject->m_JSTLSSocket.visit(visitor);  visitor.append(thisObject->m_JSTLSSocketSetterValue);
      thisObject->m_JSTextDecoder.visit(visitor);  visitor.append(thisObject->m_JSTextDecoderSetterValue);
      thisObject->m_JSTimeout.visit(visitor);  visitor.append(thisObject->m_JSTimeoutSetterValue);
      thisObject->m_JSTranspiler.visit(visitor);  visitor.append(thisObject->m_JSTranspilerSetterValue);
}