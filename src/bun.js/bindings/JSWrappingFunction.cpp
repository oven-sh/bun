#include "root.h"
#include "ZigGlobalObject.h"

#include "JSWrappingFunction.h"
#include <JavaScriptCore/JSObjectInlines.h>
#include <wtf/text/ExternalStringImpl.h>

#include <JavaScriptCore/FunctionPrototype.h>
#include <JavaScriptCore/HeapAnalyzer.h>

#include <JavaScriptCore/SlotVisitorMacros.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/SubspaceInlines.h>

namespace Zig {
using namespace JSC;

const ClassInfo JSWrappingFunction::s_info = { "Function"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSWrappingFunction) };

JS_EXPORT_PRIVATE JSWrappingFunction* JSWrappingFunction::create(
    VM& vm,
    Zig::GlobalObject* globalObject,
    const BunString* symbolName,
    Zig::NativeFunctionPtr functionPointer,
    JSC::JSValue wrappedFnValue)
{
    JSC::JSObject* wrappedFn = wrappedFnValue.getObject();
    ASSERT(wrappedFn != nullptr);

    auto nameStr = symbolName->tag == BunStringTag::Empty ? WTF::emptyString() : symbolName->toWTFString();
    auto name = Identifier::fromString(vm, nameStr);
    NativeExecutable* executable = vm.getHostFunction(functionPointer, ImplementationVisibility::Public, nullptr, nameStr);

    // Structure* structure = globalObject->FFIFunctionStructure();
    Structure* structure = JSWrappingFunction::createStructure(vm, globalObject, globalObject->objectPrototype());
    JSWrappingFunction* function = new (NotNull, allocateCell<JSWrappingFunction>(vm)) JSWrappingFunction(vm, executable, globalObject, structure, wrappedFn);
    ASSERT(function->structure()->globalObject());
    function->finishCreation(vm, executable, 0, nameStr);

    return function;
}

void JSWrappingFunction::finishCreation(VM& vm, NativeExecutable* executable, unsigned length, const String& name)
{
    Base::finishCreation(vm, executable, length, name);
    ASSERT(inherits(info()));
}

template<typename Visitor>
void JSWrappingFunction::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    JSWrappingFunction* thisObject = jsCast<JSWrappingFunction*>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);

    visitor.append(thisObject->m_wrappedFn);
}

DEFINE_VISIT_CHILDREN(JSWrappingFunction);

extern "C" JSC::EncodedJSValue Bun__JSWrappingFunction__create(
    Zig::GlobalObject* globalObject,
    const BunString* symbolName,
    Bun::NativeFunctionPtr functionPointer,
    JSC::EncodedJSValue wrappedFnEncoded)
{
    auto& vm = JSC::getVM(globalObject);
    JSC::JSValue wrappedFn = JSC::JSValue::decode(wrappedFnEncoded);
    auto function = JSWrappingFunction::create(vm, globalObject, symbolName, functionPointer, wrappedFn);
    return JSC::JSValue::encode(function);
}

extern "C" JSC::EncodedJSValue Bun__JSWrappingFunction__getWrappedFunction(
    JSC::EncodedJSValue thisValueEncoded,
    Zig::GlobalObject* globalObject)
{
    JSC::JSValue thisValue = JSC::JSValue::decode(thisValueEncoded);
    JSWrappingFunction* thisObject = jsDynamicCast<JSWrappingFunction*>(thisValue.asCell());
    if (thisObject != nullptr) {
        JSC::JSObject* wrappedFn = thisObject->m_wrappedFn.get();
        return JSC::JSValue::encode(wrappedFn);
    }
    return {};
}

}
