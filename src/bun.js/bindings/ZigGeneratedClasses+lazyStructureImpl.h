void GlobalObject::initGeneratedLazyClasses() {
    m_JSSubprocess.initLater(
              [](LazyClassStructure::Initializer& init) {
                 init.setPrototype(WebCore::JSSubprocess::createPrototype(init.vm, reinterpret_cast<Zig::GlobalObject*>(init.global)));
                 init.setStructure(WebCore::JSSubprocess::createStructure(init.vm, init.global, init.prototype));
                 init.setConstructor(WebCore::JSSubprocessConstructor::create(init.vm, init.global, WebCore::JSSubprocessConstructor::createStructure(init.vm, init.global, init.global->functionPrototype()), jsCast<WebCore::JSSubprocessPrototype*>(init.prototype)));
              });
    m_JSSHA1.initLater(
              [](LazyClassStructure::Initializer& init) {
                 init.setPrototype(WebCore::JSSHA1::createPrototype(init.vm, reinterpret_cast<Zig::GlobalObject*>(init.global)));
                 init.setStructure(WebCore::JSSHA1::createStructure(init.vm, init.global, init.prototype));
                 init.setConstructor(WebCore::JSSHA1Constructor::create(init.vm, init.global, WebCore::JSSHA1Constructor::createStructure(init.vm, init.global, init.global->functionPrototype()), jsCast<WebCore::JSSHA1Prototype*>(init.prototype)));
              });
    m_JSMD5.initLater(
              [](LazyClassStructure::Initializer& init) {
                 init.setPrototype(WebCore::JSMD5::createPrototype(init.vm, reinterpret_cast<Zig::GlobalObject*>(init.global)));
                 init.setStructure(WebCore::JSMD5::createStructure(init.vm, init.global, init.prototype));
                 init.setConstructor(WebCore::JSMD5Constructor::create(init.vm, init.global, WebCore::JSMD5Constructor::createStructure(init.vm, init.global, init.global->functionPrototype()), jsCast<WebCore::JSMD5Prototype*>(init.prototype)));
              });
    m_JSMD4.initLater(
              [](LazyClassStructure::Initializer& init) {
                 init.setPrototype(WebCore::JSMD4::createPrototype(init.vm, reinterpret_cast<Zig::GlobalObject*>(init.global)));
                 init.setStructure(WebCore::JSMD4::createStructure(init.vm, init.global, init.prototype));
                 init.setConstructor(WebCore::JSMD4Constructor::create(init.vm, init.global, WebCore::JSMD4Constructor::createStructure(init.vm, init.global, init.global->functionPrototype()), jsCast<WebCore::JSMD4Prototype*>(init.prototype)));
              });
    m_JSSHA224.initLater(
              [](LazyClassStructure::Initializer& init) {
                 init.setPrototype(WebCore::JSSHA224::createPrototype(init.vm, reinterpret_cast<Zig::GlobalObject*>(init.global)));
                 init.setStructure(WebCore::JSSHA224::createStructure(init.vm, init.global, init.prototype));
                 init.setConstructor(WebCore::JSSHA224Constructor::create(init.vm, init.global, WebCore::JSSHA224Constructor::createStructure(init.vm, init.global, init.global->functionPrototype()), jsCast<WebCore::JSSHA224Prototype*>(init.prototype)));
              });
    m_JSSHA512.initLater(
              [](LazyClassStructure::Initializer& init) {
                 init.setPrototype(WebCore::JSSHA512::createPrototype(init.vm, reinterpret_cast<Zig::GlobalObject*>(init.global)));
                 init.setStructure(WebCore::JSSHA512::createStructure(init.vm, init.global, init.prototype));
                 init.setConstructor(WebCore::JSSHA512Constructor::create(init.vm, init.global, WebCore::JSSHA512Constructor::createStructure(init.vm, init.global, init.global->functionPrototype()), jsCast<WebCore::JSSHA512Prototype*>(init.prototype)));
              });
    m_JSSHA384.initLater(
              [](LazyClassStructure::Initializer& init) {
                 init.setPrototype(WebCore::JSSHA384::createPrototype(init.vm, reinterpret_cast<Zig::GlobalObject*>(init.global)));
                 init.setStructure(WebCore::JSSHA384::createStructure(init.vm, init.global, init.prototype));
                 init.setConstructor(WebCore::JSSHA384Constructor::create(init.vm, init.global, WebCore::JSSHA384Constructor::createStructure(init.vm, init.global, init.global->functionPrototype()), jsCast<WebCore::JSSHA384Prototype*>(init.prototype)));
              });
    m_JSSHA256.initLater(
              [](LazyClassStructure::Initializer& init) {
                 init.setPrototype(WebCore::JSSHA256::createPrototype(init.vm, reinterpret_cast<Zig::GlobalObject*>(init.global)));
                 init.setStructure(WebCore::JSSHA256::createStructure(init.vm, init.global, init.prototype));
                 init.setConstructor(WebCore::JSSHA256Constructor::create(init.vm, init.global, WebCore::JSSHA256Constructor::createStructure(init.vm, init.global, init.global->functionPrototype()), jsCast<WebCore::JSSHA256Prototype*>(init.prototype)));
              });
    m_JSSHA512_256.initLater(
              [](LazyClassStructure::Initializer& init) {
                 init.setPrototype(WebCore::JSSHA512_256::createPrototype(init.vm, reinterpret_cast<Zig::GlobalObject*>(init.global)));
                 init.setStructure(WebCore::JSSHA512_256::createStructure(init.vm, init.global, init.prototype));
                 init.setConstructor(WebCore::JSSHA512_256Constructor::create(init.vm, init.global, WebCore::JSSHA512_256Constructor::createStructure(init.vm, init.global, init.global->functionPrototype()), jsCast<WebCore::JSSHA512_256Prototype*>(init.prototype)));
              });
    m_JSTextDecoder.initLater(
              [](LazyClassStructure::Initializer& init) {
                 init.setPrototype(WebCore::JSTextDecoder::createPrototype(init.vm, reinterpret_cast<Zig::GlobalObject*>(init.global)));
                 init.setStructure(WebCore::JSTextDecoder::createStructure(init.vm, init.global, init.prototype));
                 init.setConstructor(WebCore::JSTextDecoderConstructor::create(init.vm, init.global, WebCore::JSTextDecoderConstructor::createStructure(init.vm, init.global, init.global->functionPrototype()), jsCast<WebCore::JSTextDecoderPrototype*>(init.prototype)));
              });
    m_JSRequest.initLater(
              [](LazyClassStructure::Initializer& init) {
                 init.setPrototype(WebCore::JSRequest::createPrototype(init.vm, reinterpret_cast<Zig::GlobalObject*>(init.global)));
                 init.setStructure(WebCore::JSRequest::createStructure(init.vm, init.global, init.prototype));
                 init.setConstructor(WebCore::JSRequestConstructor::create(init.vm, init.global, WebCore::JSRequestConstructor::createStructure(init.vm, init.global, init.global->functionPrototype()), jsCast<WebCore::JSRequestPrototype*>(init.prototype)));
              });
    m_JSResponse.initLater(
              [](LazyClassStructure::Initializer& init) {
                 init.setPrototype(WebCore::JSResponse::createPrototype(init.vm, reinterpret_cast<Zig::GlobalObject*>(init.global)));
                 init.setStructure(WebCore::JSResponse::createStructure(init.vm, init.global, init.prototype));
                 init.setConstructor(WebCore::JSResponseConstructor::create(init.vm, init.global, WebCore::JSResponseConstructor::createStructure(init.vm, init.global, init.global->functionPrototype()), jsCast<WebCore::JSResponsePrototype*>(init.prototype)));
              });
    m_JSBlob.initLater(
              [](LazyClassStructure::Initializer& init) {
                 init.setPrototype(WebCore::JSBlob::createPrototype(init.vm, reinterpret_cast<Zig::GlobalObject*>(init.global)));
                 init.setStructure(WebCore::JSBlob::createStructure(init.vm, init.global, init.prototype));
                 init.setConstructor(WebCore::JSBlobConstructor::create(init.vm, init.global, WebCore::JSBlobConstructor::createStructure(init.vm, init.global, init.global->functionPrototype()), jsCast<WebCore::JSBlobPrototype*>(init.prototype)));
              });
}
template<typename Visitor>
void GlobalObject::visitGeneratedLazyClasses(GlobalObject *thisObject, Visitor& visitor)
{
      thisObject->m_JSSubprocess.visit(visitor);  visitor.append(thisObject->m_JSSubprocessSetterValue);
      thisObject->m_JSSHA1.visit(visitor);  visitor.append(thisObject->m_JSSHA1SetterValue);
      thisObject->m_JSMD5.visit(visitor);  visitor.append(thisObject->m_JSMD5SetterValue);
      thisObject->m_JSMD4.visit(visitor);  visitor.append(thisObject->m_JSMD4SetterValue);
      thisObject->m_JSSHA224.visit(visitor);  visitor.append(thisObject->m_JSSHA224SetterValue);
      thisObject->m_JSSHA512.visit(visitor);  visitor.append(thisObject->m_JSSHA512SetterValue);
      thisObject->m_JSSHA384.visit(visitor);  visitor.append(thisObject->m_JSSHA384SetterValue);
      thisObject->m_JSSHA256.visit(visitor);  visitor.append(thisObject->m_JSSHA256SetterValue);
      thisObject->m_JSSHA512_256.visit(visitor);  visitor.append(thisObject->m_JSSHA512_256SetterValue);
      thisObject->m_JSTextDecoder.visit(visitor);  visitor.append(thisObject->m_JSTextDecoderSetterValue);
      thisObject->m_JSRequest.visit(visitor);  visitor.append(thisObject->m_JSRequestSetterValue);
      thisObject->m_JSResponse.visit(visitor);  visitor.append(thisObject->m_JSResponseSetterValue);
      thisObject->m_JSBlob.visit(visitor);  visitor.append(thisObject->m_JSBlobSetterValue);
}