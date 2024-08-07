#include "v8/GlobalInternals.h"

#include "v8/ObjectTemplate.h"
#include "v8/InternalFieldObject.h"
#include "v8/HandleScopeBuffer.h"
#include "v8/FunctionTemplate.h"
#include "v8/Function.h"

#include "JavaScriptCore/FunctionPrototype.h"
#include "JavaScriptCore/LazyClassStructureInlines.h"
#include "JavaScriptCore/VMTrapsInlines.h"

using JSC::ClassInfo;
using JSC::LazyClassStructure;
using JSC::Structure;
using JSC::VM;

namespace v8 {

Roots::Roots(GlobalInternals* parent_)
    : parent(parent_)
{
    roots[kUndefinedValueRootIndex] = TaggedPointer(&parent->undefinedValue);
    roots[kNullValueRootIndex] = TaggedPointer(&parent->nullValue);
}

// for CREATE_METHOD_TABLE
namespace JSCastingHelpers = JSC::JSCastingHelpers;

const ClassInfo GlobalInternals::s_info = { "GlobalInternals"_s, nullptr, nullptr, nullptr, CREATE_METHOD_TABLE(GlobalInternals) };

GlobalInternals* GlobalInternals::create(VM& vm, Structure* structure)
{
    GlobalInternals* internals = new (NotNull, JSC::allocateCell<GlobalInternals>(vm)) GlobalInternals(vm, structure);
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
}

DEFINE_VISIT_CHILDREN_WITH_MODIFIER(JS_EXPORT_PRIVATE, GlobalInternals);

}
