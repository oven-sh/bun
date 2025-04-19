#include "BoundEmitFunction.h"

#include "JavaScriptCore/FunctionPrototype.h"

using namespace JSC;

namespace Bun {

BoundEmitFunction* BoundEmitFunction::create(VM& vm, Zig::GlobalObject* globalObject, WebCore::JSEventEmitter* target, WTF::ASCIILiteral eventName, JSValue event)
{
    auto* structure = globalObject->BoundEmitFunctionStructure();
    auto* function = new (NotNull, allocateCell<BoundEmitFunction>(vm)) BoundEmitFunction(
        vm,
        structure,
        eventName);
    function->finishCreation(vm, target, event);
    return function;
}

BoundEmitFunction::BoundEmitFunction(VM& vm, Structure* structure, WTF::ASCIILiteral eventName)
    : Base(vm, structure, functionCall)
    , m_eventName(eventName)
{
}

void BoundEmitFunction::finishCreation(VM& vm, WebCore::JSEventEmitter* target, JSValue event)
{
    Base::finishCreation(vm, 0, "BoundEmitFunction"_s);
    m_target.set(vm, this, target);
    m_event.set(vm, this, event);
}

JSC_DEFINE_HOST_FUNCTION(BoundEmitFunction::functionCall, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = getVM(globalObject);
    auto* function = jsCast<BoundEmitFunction*>(callFrame->jsCallee());
    MarkedArgumentBuffer args;
    args.append(function->m_event.get());
    function->m_target->wrapped().emit(Identifier::fromString(vm, function->m_eventName), args);
    return JSValue::encode(jsUndefined());
}

// for CREATE_METHOD_TABLE
namespace JSCastingHelpers = JSCastingHelpers;
const ClassInfo BoundEmitFunction::s_info = {
    "BoundEmitFunction"_s,
    &Base::s_info,
    nullptr,
    nullptr,
    CREATE_METHOD_TABLE(BoundEmitFunction)
};

Structure* BoundEmitFunction::createStructure(VM& vm, JSGlobalObject* globalObject)
{
    return Structure::create(
        vm,
        globalObject,
        globalObject->functionPrototype(),
        TypeInfo(InternalFunctionType, StructureFlags),
        info());
}

template<typename Visitor>
void BoundEmitFunction::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* fn = jsCast<BoundEmitFunction*>(cell);
    ASSERT_GC_OBJECT_INHERITS(fn, info());
    Base::visitChildren(fn, visitor);

    visitor.append(fn->m_target);
    visitor.append(fn->m_event);
}

DEFINE_VISIT_CHILDREN(BoundEmitFunction);

} // namespace Bun
