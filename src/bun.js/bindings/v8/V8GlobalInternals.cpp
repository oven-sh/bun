#include "V8GlobalInternals.h"

#include "V8ObjectTemplate.h"
#include "V8InternalFieldObject.h"
#include "V8HandleScopeBuffer.h"
#include "V8FunctionTemplate.h"
#include "V8Function.h"

#include "JavaScriptCore/FunctionPrototype.h"
#include "JavaScriptCore/LazyClassStructureInlines.h"
#include "JavaScriptCore/VMTrapsInlines.h"

using JSC::ClassInfo;
using JSC::LazyClassStructure;
using JSC::LazyProperty;
using JSC::Structure;
using JSC::VM;

namespace v8 {

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
    m_ObjectTemplateStructure.initLater([](LazyClassStructure::Initializer& init) {
        init.setStructure(ObjectTemplate::createStructure(init.vm, init.global, init.global->functionPrototype()));
    });
    m_HandleScopeBufferStructure.initLater([](LazyClassStructure::Initializer& init) {
        init.setStructure(HandleScopeBuffer::createStructure(init.vm, init.global));
    });
    m_FunctionTemplateStructure.initLater([](LazyClassStructure::Initializer& init) {
        init.setStructure(FunctionTemplate::createStructure(init.vm, init.global));
    });
    m_V8FunctionStructure.initLater([](LazyClassStructure::Initializer& init) {
        init.setStructure(Function::createStructure(init.vm, init.global));
    });
    m_GlobalHandles.initLater([](const LazyProperty<GlobalInternals, HandleScopeBuffer>::Initializer& init) {
        init.set(HandleScopeBuffer::create(init.vm,
            init.owner->handleScopeBufferStructure(init.owner->globalObject)));
    });
}

template<typename Visitor>
void GlobalInternals::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    GlobalInternals* thisObject = jsCast<GlobalInternals*>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);

    thisObject->m_ObjectTemplateStructure.visit(visitor);
    thisObject->m_HandleScopeBufferStructure.visit(visitor);
    thisObject->m_FunctionTemplateStructure.visit(visitor);
    thisObject->m_V8FunctionStructure.visit(visitor);
    thisObject->m_GlobalHandles.visit(visitor);
}

DEFINE_VISIT_CHILDREN_WITH_MODIFIER(JS_EXPORT_PRIVATE, GlobalInternals);

}
