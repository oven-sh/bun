#include "GlobalInternals.h"

#include "../V8ObjectTemplate.h"
#include "InternalFieldObject.h"
#include "HandleScopeBuffer.h"
#include "../V8FunctionTemplate.h"
#include "../V8Function.h"
#include "ZigGlobalObject.h"
#include "napi_handle_scope.h"

#include "JavaScriptCore/FunctionPrototype.h"
#include "JavaScriptCore/LazyClassStructureInlines.h"
#include "JavaScriptCore/LazyPropertyInlines.h"
#include "JavaScriptCore/VMTrapsInlines.h"

using JSC::ClassInfo;
using JSC::LazyClassStructure;
using JSC::LazyProperty;
using JSC::Structure;
using JSC::VM;

namespace v8 {
namespace shim {

// for CREATE_METHOD_TABLE
namespace JSCastingHelpers = JSC::JSCastingHelpers;

const ClassInfo GlobalInternals::s_info = { "GlobalInternals"_s, nullptr, nullptr, nullptr, CREATE_METHOD_TABLE(GlobalInternals) };

GlobalInternals* GlobalInternals::create(VM& vm, Structure* structure, Zig::GlobalObject* globalObject)
{
    GlobalInternals* internals = new (NotNull, JSC::allocateCell<GlobalInternals>(vm)) GlobalInternals(vm, structure, globalObject);
    internals->finishCreation(vm);
    return internals;
}

void GlobalInternals::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    m_objectTemplateStructure.initLater([](LazyClassStructure::Initializer& init) {
        init.setStructure(ObjectTemplate::createStructure(init.vm, init.global, init.global->functionPrototype()));
    });
    m_functionTemplateStructure.initLater([](LazyClassStructure::Initializer& init) {
        init.setStructure(FunctionTemplate::createStructure(init.vm, init.global));
    });
    m_v8FunctionStructure.initLater([](LazyClassStructure::Initializer& init) {
        init.setStructure(Function::createStructure(init.vm, init.global));
    });
    m_globalHandles.initLater([](const LazyProperty<GlobalInternals, Bun::HandleScopeImpl>::Initializer& init) {
        init.set(Bun::HandleScopeImpl::create(init.vm, init.owner->m_globalObject->HandleScopeImplStructure(), nullptr));
    });
}

template<typename Visitor>
void GlobalInternals::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    GlobalInternals* thisObject = uncheckedDowncast<GlobalInternals>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);

    thisObject->m_objectTemplateStructure.visit(visitor);
    thisObject->m_functionTemplateStructure.visit(visitor);
    thisObject->m_v8FunctionStructure.visit(visitor);
    thisObject->m_globalHandles.visit(visitor);
}

DEFINE_VISIT_CHILDREN_WITH_MODIFIER(JS_EXPORT_PRIVATE, GlobalInternals);

HandleScopeBuffer* GlobalInternals::globalHandles()
{
    return &m_globalHandles.getInitializedOnMainThread(this)->ensureV8Handles(&m_isolate);
}

HandleScopeBuffer* GlobalInternals::currentHandleScope()
{
    auto* scope = m_globalObject->m_currentHandleScopeImpl.get();
    RELEASE_ASSERT_WITH_MESSAGE(scope, "Cannot create a V8 handle without an open handle scope");
    return &scope->ensureV8Handles(&m_isolate);
}

} // namespace shim
} // namespace v8
