#include "root.h"

#include "VMModuleScript.h"
#include "JavaScriptCore/JSObjectInlines.h"
#include "wtf/text/ExternalStringImpl.h"

#include "JavaScriptCore/FunctionPrototype.h"
#include "JavaScriptCore/HeapAnalyzer.h"

#include "JavaScriptCore/JSDestructibleObjectHeapCellType.h"
#include "JavaScriptCore/SlotVisitorMacros.h"
#include "JavaScriptCore/ObjectConstructor.h"
#include "JavaScriptCore/SubspaceInlines.h"
#include "wtf/GetPtr.h"
#include "wtf/PointerPreparations.h"
#include "wtf/URL.h"
#include "JavaScriptCore/TypedArrayInlines.h"
#include "JavaScriptCore/PropertyNameArray.h"
#include "JavaScriptCore/JSWeakMap.h"
#include "JavaScriptCore/JSWeakMapInlines.h"
#include "JavaScriptCore/JSWithScope.h"
#include "Buffer.h"
#include "GCDefferalContext.h"
#include "Buffer.h"

#include <JavaScriptCore/DOMJITAbstractHeap.h>
#include "DOMJITIDLConvert.h"
#include "DOMJITIDLType.h"
#include "DOMJITIDLTypeFilter.h"
#include "DOMJITHelpers.h"
#include <JavaScriptCore/DFGAbstractHeap.h>

namespace WebCore {
using namespace JSC;

static EncodedJSValue constructScript(JSGlobalObject* globalObject, CallFrame* callFrame, JSValue newTarget = JSValue())
{
    VM& vm = globalObject->vm();
    JSValue callee = callFrame->jsCallee();
    ArgList args(callFrame);
    JSValue sourceArg = args.at(0);
    String source = sourceArg.isUndefined() ? emptyString() : sourceArg.toWTFString(globalObject);

    auto* zigGlobalObject = reinterpret_cast<Zig::GlobalObject*>(globalObject);
    Structure* structure = zigGlobalObject->VMModuleScriptStructure();
    if (zigGlobalObject->VMModuleScript() != newTarget) {
        auto scope = DECLARE_THROW_SCOPE(vm);
        JSObject* targetObj = asObject(newTarget);
        auto* functionGlobalObject = reinterpret_cast<Zig::GlobalObject*>(getFunctionRealm(globalObject, targetObj));
        RETURN_IF_EXCEPTION(scope, {});
        structure = InternalFunction::createSubclassStructure(
            globalObject, targetObj, functionGlobalObject->VMModuleScriptStructure());
        scope.release();
    }
    VMModuleScript* script = VMModuleScript::create(vm, globalObject, structure, source);
    return JSValue::encode(JSValue(script));
}

static EncodedJSValue runInContext(JSGlobalObject* globalObject, VMModuleScript* script, JSObject* globalThis, JSScope* scope, JSValue optionsArg)
{
    auto& vm = globalObject->vm();

    if (!optionsArg.isUndefined()) {
        auto scope = DECLARE_THROW_SCOPE(vm);
        return throwVMError(globalObject, scope, "TODO: options"_s);
    }

    auto* eval = DirectEvalExecutable::create(
        globalObject, script->source(), DerivedContextType::None, NeedsClassFieldInitializer::No, PrivateBrandRequirement::None,
        false, false, EvalContextType::None, nullptr, nullptr, ECMAMode::sloppy());

    return JSValue::encode(vm.interpreter.executeEval(eval, globalThis, scope));
}

JSC_DEFINE_HOST_FUNCTION(scriptConstructorCall, (JSGlobalObject* globalObject, CallFrame* callFrame))
{
    return constructScript(globalObject, callFrame);
}

JSC_DEFINE_HOST_FUNCTION(scriptConstructorConstruct, (JSGlobalObject* globalObject, CallFrame* callFrame))
{
    return constructScript(globalObject, callFrame, callFrame->newTarget());
}

JSC_DEFINE_CUSTOM_GETTER(scriptGetCachedDataRejected, (JSGlobalObject* globalObject, EncodedJSValue thisValue, PropertyName))
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    return throwVMError(globalObject, scope, "TODO"_s);
}
JSC_DEFINE_HOST_FUNCTION(scriptCreateCachedData, (JSGlobalObject* globalObject, CallFrame* callFrame))
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    return throwVMError(globalObject, scope, "TODO"_s);
}

JSC_DEFINE_HOST_FUNCTION(scriptRunInContext, (JSGlobalObject* globalObject, CallFrame* callFrame))
{
    auto& vm = globalObject->vm();

    JSValue thisValue = callFrame->thisValue();
    auto* script = jsDynamicCast<VMModuleScript*>(thisValue);
    if (UNLIKELY(!script)) {
        auto scope = DECLARE_THROW_SCOPE(vm);
        return throwVMTypeError(globalObject, scope, "Script.prototype.runInContext can only be called on a Script object"_s);
    }

    ArgList args(callFrame);

    JSValue contextArg = args.at(0);
    if (!UNLIKELY(contextArg.isObject())) {
        auto scope = DECLARE_THROW_SCOPE(vm);
        return throwVMTypeError(globalObject, scope, "context parameter must be a contextified object"_s);
    }
    JSObject* context = asObject(contextArg);

    auto* zigGlobalObject = reinterpret_cast<Zig::GlobalObject*>(globalObject);
    JSValue scopeVal = zigGlobalObject->vmModuleContextMap()->get(context);
    if (UNLIKELY(scopeVal.isUndefined())) {
        auto scope = DECLARE_THROW_SCOPE(vm);
        return throwVMTypeError(globalObject, scope, "context parameter must be a contextified object"_s);
    }
    JSScope* scope = jsDynamicCast<JSScope*>(scopeVal);
    ASSERT(scope);

    return runInContext(globalObject, script, context, scope, args.at(1));
}
JSC_DEFINE_HOST_FUNCTION(scriptRunInThisContext, (JSGlobalObject* globalObject, CallFrame* callFrame))
{
    auto& vm = globalObject->vm();
    JSValue thisValue = callFrame->thisValue();
    auto* script = jsDynamicCast<VMModuleScript*>(thisValue);
    if (UNLIKELY(!script)) {
        auto scope = DECLARE_THROW_SCOPE(vm);
        return throwVMTypeError(globalObject, scope, "Script.prototype.runInThisContext can only be called on a Script object"_s);
    }

    ArgList args(callFrame);
    return runInContext(globalObject, script, globalObject->globalThis(), globalObject->globalScope(), args.at(0));
}

JSC_DEFINE_CUSTOM_GETTER(scriptGetSourceMapURL, (JSGlobalObject* globalObject, EncodedJSValue thisValue, PropertyName))
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    return throwVMError(globalObject, scope, "TODO"_s);
}

JSC_DEFINE_HOST_FUNCTION(vmModule_createContext, (JSGlobalObject* globalObject, CallFrame* callFrame))
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    ArgList args(callFrame);
    JSValue contextArg = args.at(0);
    if (!contextArg.isObject()) {
        return throwVMTypeError(globalObject, scope, "parameter to createContext must be an object"_s);
    }
    JSObject* context = asObject(contextArg);

    JSScope* contextScope = JSWithScope::create(vm, globalObject, globalObject->globalScope(), context);

    auto* zigGlobalObject = reinterpret_cast<Zig::GlobalObject*>(globalObject);
    zigGlobalObject->vmModuleContextMap()->set(vm, context, contextScope);

    return JSValue::encode(context);
}

JSC_DEFINE_HOST_FUNCTION(vmModule_isContext, (JSGlobalObject* globalObject, CallFrame* callFrame))
{
    ArgList args(callFrame);
    JSValue contextArg = args.at(0);
    bool isContext;
    if (!contextArg.isObject()) {
        isContext = false;
    } else {
        auto* zigGlobalObject = reinterpret_cast<Zig::GlobalObject*>(globalObject);
        isContext = zigGlobalObject->vmModuleContextMap()->has(asObject(contextArg));
    }
    return JSValue::encode(jsBoolean(isContext));
}

class VMModuleScriptPrototype final : public JSNonFinalObject {
public:
    using Base = JSNonFinalObject;

    static VMModuleScriptPrototype* create(VM& vm, JSGlobalObject* globalObject, Structure* structure)
    {
        VMModuleScriptPrototype* ptr = new (NotNull, allocateCell<VMModuleScriptPrototype>(vm)) VMModuleScriptPrototype(vm, structure);
        ptr->finishCreation(vm);
        return ptr;
    }

    DECLARE_INFO;
    template<typename CellType, SubspaceAccess>
    static GCClient::IsoSubspace* subspaceFor(VM& vm)
    {
        return &vm.plainObjectSpace();
    }
    static Structure* createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
    {
        return Structure::create(vm, globalObject, prototype, TypeInfo(ObjectType, StructureFlags), info());
    }

private:
    VMModuleScriptPrototype(VM& vm, Structure* structure)
        : Base(vm, structure)
    {
    }

    void finishCreation(VM&);
};
STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(VMModuleScriptPrototype, VMModuleScriptPrototype::Base);

static const struct HashTableValue scriptPrototypeTableValues[] = {
   { "cachedDataRejected"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly|PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, scriptGetCachedDataRejected, nullptr } },
   { "createCachedData"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly|PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, scriptCreateCachedData, 0 } },
   { "runInContext"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly|PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, scriptRunInContext, 0 } },
   { "runInThisContext"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly|PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, scriptRunInThisContext, 0 } },
   { "sourceMapURL"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly|PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, scriptGetSourceMapURL, nullptr } },
};

const ClassInfo VMModuleScriptPrototype::s_info = { "Script"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(VMModuleScriptPrototype) };
const ClassInfo VMModuleScript::s_info = { "Script"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(VMModuleScript) };
const ClassInfo VMModuleScriptConstructor::s_info = { "Script"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(VMModuleScriptConstructor) };

VMModuleScriptConstructor::VMModuleScriptConstructor(VM& vm, Structure* structure)
    : VMModuleScriptConstructor::Base(vm, structure, scriptConstructorCall, scriptConstructorConstruct)
{
}

VMModuleScriptConstructor* VMModuleScriptConstructor::create(VM& vm, JSGlobalObject* globalObject, Structure* structure, JSObject* prototype)
{
    VMModuleScriptConstructor* ptr = new (NotNull, allocateCell<VMModuleScriptConstructor>(vm)) VMModuleScriptConstructor(vm, structure);
    ptr->finishCreation(vm, prototype);
    return ptr;
}

void VMModuleScriptConstructor::finishCreation(VM& vm, JSObject* prototype)
{
    Base::finishCreation(vm, 1, "Script"_s, PropertyAdditionMode::WithStructureTransition);
    putDirectWithoutTransition(vm, vm.propertyNames->prototype, prototype, PropertyAttribute::DontEnum | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly);
    ASSERT(inherits(info()));
}

void VMModuleScriptPrototype::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    reifyStaticProperties(vm, VMModuleScript::info(), scriptPrototypeTableValues, *this);
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}

JSObject* VMModuleScript::createPrototype(VM& vm, JSGlobalObject* globalObject)
{
    return VMModuleScriptPrototype::create(vm, globalObject, VMModuleScriptPrototype::createStructure(vm, globalObject, globalObject->objectPrototype()));
}

VMModuleScript* VMModuleScript::create(VM& vm, JSGlobalObject* globalObject, Structure* structure, String source)
{
    VMModuleScript* ptr = new (NotNull, allocateCell<VMModuleScript>(vm)) VMModuleScript(vm, structure, source);
    ptr->finishCreation(vm);
    return ptr;
}

void VMModuleScript::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
}

void VMModuleScript::destroy(JSCell* cell)
{
    static_cast<VMModuleScript*>(cell)->VMModuleScript::~VMModuleScript();
}

}
