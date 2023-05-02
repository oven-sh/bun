#include "root.h"

#include "Script.h"
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

    Structure* structure = Script::createStructure(vm, globalObject, Script::createPrototype(vm, globalObject));
    Script* script = Script::create(vm, globalObject, structure, source);
    return JSValue::encode(JSValue(script));
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
    return throwVMTypeError(globalObject, scope, "TODO"_s);
}
JSC_DEFINE_HOST_FUNCTION(scriptCreateCachedData, (JSGlobalObject* globalObject, CallFrame* callFrame))
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    return throwVMTypeError(globalObject, scope, "TODO"_s);
}
JSC_DEFINE_HOST_FUNCTION(scriptRunInContext, (JSGlobalObject* globalObject, CallFrame* callFrame))
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    return throwVMTypeError(globalObject, scope, "TODO"_s);
}
JSC_DEFINE_CUSTOM_GETTER(scriptGetSourceMapURL, (JSGlobalObject* globalObject, EncodedJSValue thisValue, PropertyName))
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    return throwVMTypeError(globalObject, scope, "TODO"_s);
}

class ScriptPrototype final : public JSNonFinalObject {
public:
    using Base = JSNonFinalObject;

    static ScriptPrototype* create(VM& vm, JSGlobalObject* globalObject, Structure* structure)
    {
        ScriptPrototype* ptr = new (NotNull, allocateCell<ScriptPrototype>(vm)) ScriptPrototype(vm, globalObject, structure);
        ptr->finishCreation(vm, globalObject);
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
    ScriptPrototype(VM& vm, JSGlobalObject* globalObject, Structure* structure)
        : Base(vm, structure)
    {
    }

    void finishCreation(VM&, JSGlobalObject*);
};
STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(ScriptPrototype, ScriptPrototype::Base);

static const struct HashTableValue scriptPrototypeTableValues[] = {
   { "cachedDataRejected"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly|PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, scriptGetCachedDataRejected, nullptr } },
   { "createCachedData"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly|PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, scriptCreateCachedData, 0 } },
   { "runInContext"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly|PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, scriptRunInContext, 0 } },
   { "sourceMapURL"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly|PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, scriptGetSourceMapURL, nullptr } },
};

const ClassInfo ScriptPrototype::s_info = { "Script"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(ScriptPrototype) };
const ClassInfo Script::s_info = { "Script"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(Script) };
const ClassInfo ScriptConstructor::s_info = { "Script"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(ScriptConstructor) };

ScriptConstructor::ScriptConstructor(VM& vm, Structure* structure)
    : ScriptConstructor::Base(vm, structure, scriptConstructorCall, scriptConstructorConstruct)
{
}

ScriptConstructor* ScriptConstructor::create(VM& vm, JSGlobalObject* globalObject, Structure* structure, JSObject* prototype)
{
    ScriptConstructor* ptr = new (NotNull, allocateCell<ScriptConstructor>(vm)) ScriptConstructor(vm, structure);
    ptr->finishCreation(vm, globalObject, prototype);
    return ptr;
}

void ScriptConstructor::finishCreation(VM& vm, JSGlobalObject* globalObject, JSObject* prototype)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
    initializeProperties(vm, globalObject, prototype);
}

void ScriptConstructor::initializeProperties(VM& vm, JSGlobalObject* globalObject, JSObject* prototype)
{
    putDirect(vm, vm.propertyNames->length, jsNumber(0), PropertyAttribute::ReadOnly | PropertyAttribute::DontEnum);
    JSString* nameString = jsNontrivialString(vm, "Script"_s);
    m_originalName.set(vm, this, nameString);
    putDirect(vm, vm.propertyNames->name, nameString, PropertyAttribute::ReadOnly | PropertyAttribute::DontEnum);
}

void ScriptPrototype::finishCreation(VM& vm, JSGlobalObject* globalObject)
{
    Base::finishCreation(vm);
    reifyStaticProperties(vm, Script::info(), scriptPrototypeTableValues, *this);
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}

JSObject* Script::createPrototype(VM& vm, JSGlobalObject* globalObject)
{
    return ScriptPrototype::create(vm, globalObject, ScriptPrototype::createStructure(vm, globalObject, globalObject->objectPrototype()));
}

Script* Script::create(VM& vm, JSGlobalObject* globalObject, Structure* structure, String source)
{
    Script* ptr = new (NotNull, allocateCell<Script>(vm)) Script(vm, structure, source);
    ptr->finishCreation(vm);
    return ptr;
}

void Script::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
}

void Script::destroy(JSCell* cell)
{
    static_cast<Script*>(cell)->Script::~Script();
}

}
