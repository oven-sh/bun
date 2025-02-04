#include "Function.h"

#include "JavaScriptCore/FunctionPrototype.h"

using JSC::Structure;
using JSC::VM;

namespace v8 {
namespace shim {

// for CREATE_METHOD_TABLE
namespace JSCastingHelpers = JSC::JSCastingHelpers;

const JSC::ClassInfo Function::s_info = {
    "Function"_s,
    &Base::s_info,
    nullptr,
    nullptr,
    CREATE_METHOD_TABLE(Function)
};

Structure* Function::createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
{
    return Structure::create(
        vm,
        globalObject,
        globalObject->functionPrototype(),
        JSC::TypeInfo(JSC::InternalFunctionType, StructureFlags),
        info());
}

template<typename Visitor>
void Function::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    Function* fn = jsCast<Function*>(cell);
    ASSERT_GC_OBJECT_INHERITS(fn, info());
    Base::visitChildren(fn, visitor);

    visitor.append(fn->m_functionTemplate);
}

DEFINE_VISIT_CHILDREN(Function);

Function* Function::create(VM& vm, Structure* structure, FunctionTemplate* functionTemplate)
{
    auto* function = new (NotNull, JSC::allocateCell<Function>(vm)) Function(vm, structure);
    function->finishCreation(vm, functionTemplate);
    return function;
}

void Function::finishCreation(VM& vm, FunctionTemplate* functionTemplate)
{
    Base::finishCreation(vm, 0, "Function"_s);
    m_functionTemplate.set(vm, this, functionTemplate);
}

void Function::setName(JSC::JSString* name)
{
    m_originalName.set(globalObject()->vm(), this, name);
}

} // namespace shim
} // namespace v8
