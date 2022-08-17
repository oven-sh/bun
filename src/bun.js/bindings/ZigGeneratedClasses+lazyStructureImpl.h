void GlobalObject::initGeneratedLazyClasses() {
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
}
template<typename Visitor>
void GlobalObject::visitGeneratedLazyClasses(GlobalObject *thisObject, Visitor& visitor)
{
      thisObject->m_JSRequest.visit(visitor);
      thisObject->m_JSResponse.visit(visitor);
}