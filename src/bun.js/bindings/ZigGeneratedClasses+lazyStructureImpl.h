ALWAYS_INLINE void GlobalObject::initGeneratedLazyClasses() {
    m_JSAttributeIterator.initLater(
              [](LazyClassStructure::Initializer& init) {
                 init.setPrototype(WebCore::JSAttributeIterator::createPrototype(init.vm, reinterpret_cast<Zig::GlobalObject*>(init.global)));
                 init.setStructure(WebCore::JSAttributeIterator::createStructure(init.vm, init.global, init.prototype));
                 
              });
    m_JSBigIntStats.initLater(
              [](LazyClassStructure::Initializer& init) {
                 init.setPrototype(WebCore::JSBigIntStats::createPrototype(init.vm, reinterpret_cast<Zig::GlobalObject*>(init.global)));
                 init.setStructure(WebCore::JSBigIntStats::createStructure(init.vm, init.global, init.prototype));
                 init.setConstructor(WebCore::JSBigIntStats::createConstructor(init.vm, init.global, init.prototype));
              });
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
    m_JSComment.initLater(
              [](LazyClassStructure::Initializer& init) {
                 init.setPrototype(WebCore::JSComment::createPrototype(init.vm, reinterpret_cast<Zig::GlobalObject*>(init.global)));
                 init.setStructure(WebCore::JSComment::createStructure(init.vm, init.global, init.prototype));
                 
              });
    m_JSCrypto.initLater(
              [](LazyClassStructure::Initializer& init) {
                 init.setPrototype(WebCore::JSCrypto::createPrototype(init.vm, reinterpret_cast<Zig::GlobalObject*>(init.global)));
                 init.setStructure(WebCore::JSCrypto::createStructure(init.vm, init.global, init.prototype));
                 init.setConstructor(WebCore::JSCrypto::createConstructor(init.vm, init.global, init.prototype));
              });
    m_JSCryptoHasher.initLater(
              [](LazyClassStructure::Initializer& init) {
                 init.setPrototype(WebCore::JSCryptoHasher::createPrototype(init.vm, reinterpret_cast<Zig::GlobalObject*>(init.global)));
                 init.setStructure(WebCore::JSCryptoHasher::createStructure(init.vm, init.global, init.prototype));
                 init.setConstructor(WebCore::JSCryptoHasher::createConstructor(init.vm, init.global, init.prototype));
              });
    m_JSDebugHTTPSServer.initLater(
              [](LazyClassStructure::Initializer& init) {
                 init.setPrototype(WebCore::JSDebugHTTPSServer::createPrototype(init.vm, reinterpret_cast<Zig::GlobalObject*>(init.global)));
                 init.setStructure(WebCore::JSDebugHTTPSServer::createStructure(init.vm, init.global, init.prototype));
                 
              });
    m_JSDebugHTTPServer.initLater(
              [](LazyClassStructure::Initializer& init) {
                 init.setPrototype(WebCore::JSDebugHTTPServer::createPrototype(init.vm, reinterpret_cast<Zig::GlobalObject*>(init.global)));
                 init.setStructure(WebCore::JSDebugHTTPServer::createStructure(init.vm, init.global, init.prototype));
                 
              });
    m_JSDirent.initLater(
              [](LazyClassStructure::Initializer& init) {
                 init.setPrototype(WebCore::JSDirent::createPrototype(init.vm, reinterpret_cast<Zig::GlobalObject*>(init.global)));
                 init.setStructure(WebCore::JSDirent::createStructure(init.vm, init.global, init.prototype));
                 init.setConstructor(WebCore::JSDirent::createConstructor(init.vm, init.global, init.prototype));
              });
    m_JSDocEnd.initLater(
              [](LazyClassStructure::Initializer& init) {
                 init.setPrototype(WebCore::JSDocEnd::createPrototype(init.vm, reinterpret_cast<Zig::GlobalObject*>(init.global)));
                 init.setStructure(WebCore::JSDocEnd::createStructure(init.vm, init.global, init.prototype));
                 
              });
    m_JSDocType.initLater(
              [](LazyClassStructure::Initializer& init) {
                 init.setPrototype(WebCore::JSDocType::createPrototype(init.vm, reinterpret_cast<Zig::GlobalObject*>(init.global)));
                 init.setStructure(WebCore::JSDocType::createStructure(init.vm, init.global, init.prototype));
                 
              });
    m_JSElement.initLater(
              [](LazyClassStructure::Initializer& init) {
                 init.setPrototype(WebCore::JSElement::createPrototype(init.vm, reinterpret_cast<Zig::GlobalObject*>(init.global)));
                 init.setStructure(WebCore::JSElement::createStructure(init.vm, init.global, init.prototype));
                 
              });
    m_JSEndTag.initLater(
              [](LazyClassStructure::Initializer& init) {
                 init.setPrototype(WebCore::JSEndTag::createPrototype(init.vm, reinterpret_cast<Zig::GlobalObject*>(init.global)));
                 init.setStructure(WebCore::JSEndTag::createStructure(init.vm, init.global, init.prototype));
                 
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
    m_JSExpectAnything.initLater(
              [](LazyClassStructure::Initializer& init) {
                 init.setPrototype(WebCore::JSExpectAnything::createPrototype(init.vm, reinterpret_cast<Zig::GlobalObject*>(init.global)));
                 init.setStructure(WebCore::JSExpectAnything::createStructure(init.vm, init.global, init.prototype));
                 
              });
    m_JSExpectArrayContaining.initLater(
              [](LazyClassStructure::Initializer& init) {
                 init.setPrototype(WebCore::JSExpectArrayContaining::createPrototype(init.vm, reinterpret_cast<Zig::GlobalObject*>(init.global)));
                 init.setStructure(WebCore::JSExpectArrayContaining::createStructure(init.vm, init.global, init.prototype));
                 
              });
    m_JSExpectStringContaining.initLater(
              [](LazyClassStructure::Initializer& init) {
                 init.setPrototype(WebCore::JSExpectStringContaining::createPrototype(init.vm, reinterpret_cast<Zig::GlobalObject*>(init.global)));
                 init.setStructure(WebCore::JSExpectStringContaining::createStructure(init.vm, init.global, init.prototype));
                 
              });
    m_JSExpectStringMatching.initLater(
              [](LazyClassStructure::Initializer& init) {
                 init.setPrototype(WebCore::JSExpectStringMatching::createPrototype(init.vm, reinterpret_cast<Zig::GlobalObject*>(init.global)));
                 init.setStructure(WebCore::JSExpectStringMatching::createStructure(init.vm, init.global, init.prototype));
                 
              });
    m_JSFFI.initLater(
              [](LazyClassStructure::Initializer& init) {
                 init.setPrototype(WebCore::JSFFI::createPrototype(init.vm, reinterpret_cast<Zig::GlobalObject*>(init.global)));
                 init.setStructure(WebCore::JSFFI::createStructure(init.vm, init.global, init.prototype));
                 
              });
    m_JSFSWatcher.initLater(
              [](LazyClassStructure::Initializer& init) {
                 init.setPrototype(WebCore::JSFSWatcher::createPrototype(init.vm, reinterpret_cast<Zig::GlobalObject*>(init.global)));
                 init.setStructure(WebCore::JSFSWatcher::createStructure(init.vm, init.global, init.prototype));
                 
              });
    m_JSFileSystemRouter.initLater(
              [](LazyClassStructure::Initializer& init) {
                 init.setPrototype(WebCore::JSFileSystemRouter::createPrototype(init.vm, reinterpret_cast<Zig::GlobalObject*>(init.global)));
                 init.setStructure(WebCore::JSFileSystemRouter::createStructure(init.vm, init.global, init.prototype));
                 init.setConstructor(WebCore::JSFileSystemRouter::createConstructor(init.vm, init.global, init.prototype));
              });
    m_JSHTMLRewriter.initLater(
              [](LazyClassStructure::Initializer& init) {
                 init.setPrototype(WebCore::JSHTMLRewriter::createPrototype(init.vm, reinterpret_cast<Zig::GlobalObject*>(init.global)));
                 init.setStructure(WebCore::JSHTMLRewriter::createStructure(init.vm, init.global, init.prototype));
                 init.setConstructor(WebCore::JSHTMLRewriter::createConstructor(init.vm, init.global, init.prototype));
              });
    m_JSHTTPSServer.initLater(
              [](LazyClassStructure::Initializer& init) {
                 init.setPrototype(WebCore::JSHTTPSServer::createPrototype(init.vm, reinterpret_cast<Zig::GlobalObject*>(init.global)));
                 init.setStructure(WebCore::JSHTTPSServer::createStructure(init.vm, init.global, init.prototype));
                 
              });
    m_JSHTTPServer.initLater(
              [](LazyClassStructure::Initializer& init) {
                 init.setPrototype(WebCore::JSHTTPServer::createPrototype(init.vm, reinterpret_cast<Zig::GlobalObject*>(init.global)));
                 init.setStructure(WebCore::JSHTTPServer::createStructure(init.vm, init.global, init.prototype));
                 
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
    m_JSStatWatcher.initLater(
              [](LazyClassStructure::Initializer& init) {
                 init.setPrototype(WebCore::JSStatWatcher::createPrototype(init.vm, reinterpret_cast<Zig::GlobalObject*>(init.global)));
                 init.setStructure(WebCore::JSStatWatcher::createStructure(init.vm, init.global, init.prototype));
                 
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
    m_JSTextChunk.initLater(
              [](LazyClassStructure::Initializer& init) {
                 init.setPrototype(WebCore::JSTextChunk::createPrototype(init.vm, reinterpret_cast<Zig::GlobalObject*>(init.global)));
                 init.setStructure(WebCore::JSTextChunk::createStructure(init.vm, init.global, init.prototype));
                 
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
      thisObject->m_JSAttributeIterator.visit(visitor);
      thisObject->m_JSBigIntStats.visit(visitor);
      thisObject->m_JSBlob.visit(visitor);
      thisObject->m_JSBuildArtifact.visit(visitor);
      thisObject->m_JSBuildMessage.visit(visitor);
      thisObject->m_JSComment.visit(visitor);
      thisObject->m_JSCrypto.visit(visitor);
      thisObject->m_JSCryptoHasher.visit(visitor);
      thisObject->m_JSDebugHTTPSServer.visit(visitor);
      thisObject->m_JSDebugHTTPServer.visit(visitor);
      thisObject->m_JSDirent.visit(visitor);
      thisObject->m_JSDocEnd.visit(visitor);
      thisObject->m_JSDocType.visit(visitor);
      thisObject->m_JSElement.visit(visitor);
      thisObject->m_JSEndTag.visit(visitor);
      thisObject->m_JSExpect.visit(visitor);
      thisObject->m_JSExpectAny.visit(visitor);
      thisObject->m_JSExpectAnything.visit(visitor);
      thisObject->m_JSExpectArrayContaining.visit(visitor);
      thisObject->m_JSExpectStringContaining.visit(visitor);
      thisObject->m_JSExpectStringMatching.visit(visitor);
      thisObject->m_JSFFI.visit(visitor);
      thisObject->m_JSFSWatcher.visit(visitor);
      thisObject->m_JSFileSystemRouter.visit(visitor);
      thisObject->m_JSHTMLRewriter.visit(visitor);
      thisObject->m_JSHTTPSServer.visit(visitor);
      thisObject->m_JSHTTPServer.visit(visitor);
      thisObject->m_JSListener.visit(visitor);
      thisObject->m_JSMD4.visit(visitor);
      thisObject->m_JSMD5.visit(visitor);
      thisObject->m_JSMatchedRoute.visit(visitor);
      thisObject->m_JSNodeJSFS.visit(visitor);
      thisObject->m_JSRequest.visit(visitor);
      thisObject->m_JSResolveMessage.visit(visitor);
      thisObject->m_JSResponse.visit(visitor);
      thisObject->m_JSSHA1.visit(visitor);
      thisObject->m_JSSHA224.visit(visitor);
      thisObject->m_JSSHA256.visit(visitor);
      thisObject->m_JSSHA384.visit(visitor);
      thisObject->m_JSSHA512.visit(visitor);
      thisObject->m_JSSHA512_256.visit(visitor);
      thisObject->m_JSServerWebSocket.visit(visitor);
      thisObject->m_JSStatWatcher.visit(visitor);
      thisObject->m_JSStats.visit(visitor);
      thisObject->m_JSSubprocess.visit(visitor);
      thisObject->m_JSTCPSocket.visit(visitor);
      thisObject->m_JSTLSSocket.visit(visitor);
      thisObject->m_JSTextChunk.visit(visitor);
      thisObject->m_JSTextDecoder.visit(visitor);
      thisObject->m_JSTimeout.visit(visitor);
      thisObject->m_JSTranspiler.visit(visitor);
}