#include "root.h"

#include "NodeVMScript.h"
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
    String sourceString = sourceArg.isUndefined() ? emptyString() : sourceArg.toWTFString(globalObject);

    JSValue optionsArg = args.at(1);
    String filename = ""_s;
    OrdinalNumber lineOffset, columnOffset;
    if (!optionsArg.isUndefined()) {
        if (!optionsArg.isObject()) {
            auto scope = DECLARE_THROW_SCOPE(vm);
            return throwVMTypeError(globalObject, scope, "options must be an object"_s);
        }
        JSObject* options = asObject(optionsArg);

        JSValue filenameOpt = options->get(globalObject, Identifier::fromString(vm, "filename"_s));
        if (filenameOpt.isString()) {
            filename = filenameOpt.toWTFString(globalObject);
        }

        JSValue lineOffsetOpt = options->get(globalObject, Identifier::fromString(vm, "lineOffset"_s));
        if (lineOffsetOpt.isAnyInt()) {
            lineOffset = OrdinalNumber::fromZeroBasedInt(lineOffsetOpt.asAnyInt());
        }
        JSValue columnOffsetOpt = options->get(globalObject, Identifier::fromString(vm, "columnOffset"_s));
        if (columnOffsetOpt.isAnyInt()) {
            columnOffset = OrdinalNumber::fromZeroBasedInt(columnOffsetOpt.asAnyInt());
        }

        // TODO: cachedData
        // TODO: importModuleDynamically
    }

    auto* zigGlobalObject = reinterpret_cast<Zig::GlobalObject*>(globalObject);
    Structure* structure = zigGlobalObject->NodeVMScriptStructure();
    if (zigGlobalObject->NodeVMScript() != newTarget) {
        auto scope = DECLARE_THROW_SCOPE(vm);
        JSObject* targetObj = asObject(newTarget);
        auto* functionGlobalObject = reinterpret_cast<Zig::GlobalObject*>(getFunctionRealm(globalObject, targetObj));
        RETURN_IF_EXCEPTION(scope, {});
        structure = InternalFunction::createSubclassStructure(
            globalObject, targetObj, functionGlobalObject->NodeVMScriptStructure());
        scope.release();
    }

    auto scope = DECLARE_THROW_SCOPE(vm);
    SourceCode source(
        JSC::StringSourceProvider::create(sourceString, JSC::SourceOrigin(), filename, TextPosition(lineOffset, columnOffset)),
        lineOffset.zeroBasedInt(), columnOffset.zeroBasedInt());
    RETURN_IF_EXCEPTION(scope, {});
    NodeVMScript* script = NodeVMScript::create(vm, globalObject, structure, source);
    return JSValue::encode(JSValue(script));
}

static EncodedJSValue runInContext(JSGlobalObject* globalObject, NodeVMScript* script, JSObject* globalThis, JSScope* scope, JSValue optionsArg)
{
    auto& vm = globalObject->vm();

    if (!optionsArg.isUndefined()) {
        if (!optionsArg.isObject()) {
            auto scope = DECLARE_THROW_SCOPE(vm);
            return throwVMTypeError(globalObject, scope, "options must be an object"_s);
        }
        JSObject* options = asObject(optionsArg);
    }

    auto err_scope = DECLARE_THROW_SCOPE(vm);
    auto* eval = DirectEvalExecutable::create(
        globalObject, script->source(), DerivedContextType::None, NeedsClassFieldInitializer::No, PrivateBrandRequirement::None,
        false, false, EvalContextType::None, nullptr, nullptr, ECMAMode::sloppy());
    RETURN_IF_EXCEPTION(err_scope, {});

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
    return JSValue::encode(jsBoolean(true)); // TODO
}
JSC_DEFINE_HOST_FUNCTION(scriptCreateCachedData, (JSGlobalObject* globalObject, CallFrame* callFrame))
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    return throwVMError(globalObject, scope, "TODO: Script.createCachedData"_s);
}

JSC_DEFINE_HOST_FUNCTION(scriptRunInContext, (JSGlobalObject* globalObject, CallFrame* callFrame))
{
    auto& vm = globalObject->vm();

    JSValue thisValue = callFrame->thisValue();
    auto* script = jsDynamicCast<NodeVMScript*>(thisValue);
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
    auto* script = jsDynamicCast<NodeVMScript*>(thisValue);
    if (UNLIKELY(!script)) {
        auto scope = DECLARE_THROW_SCOPE(vm);
        return throwVMTypeError(globalObject, scope, "Script.prototype.runInThisContext can only be called on a Script object"_s);
    }

    ArgList args(callFrame);
    return runInContext(globalObject, script, globalObject->globalThis(), globalObject->globalScope(), args.at(0));
}

JSC_DEFINE_CUSTOM_GETTER(scriptGetSourceMapURL, (JSGlobalObject* globalObject, EncodedJSValue thisValueEncoded, PropertyName))
{
    auto& vm = globalObject->vm();
    JSValue thisValue = JSValue::decode(thisValueEncoded);
    auto* script = jsDynamicCast<NodeVMScript*>(thisValue);
    if (UNLIKELY(!script)) {
        auto scope = DECLARE_THROW_SCOPE(vm);
        return throwVMTypeError(globalObject, scope, "Script.prototype.sourceMapURL getter can only be called on a Script object"_s);
    }

    // FIXME: doesn't seem to work? Just returns undefined
    const auto& url = script->source().provider()->sourceMappingURLDirective();
    return JSValue::encode(jsString(vm, url));
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

    PropertyDescriptor descriptor;
    descriptor.setWritable(false);
    descriptor.setEnumerable(false);
    descriptor.setValue(context);
    JSObject::defineOwnProperty(context, globalObject, Identifier::fromString(vm, "globalThis"_s), descriptor, true);
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

class NodeVMScriptPrototype final : public JSNonFinalObject {
public:
    using Base = JSNonFinalObject;

    static NodeVMScriptPrototype* create(VM& vm, JSGlobalObject* globalObject, Structure* structure)
    {
        NodeVMScriptPrototype* ptr = new (NotNull, allocateCell<NodeVMScriptPrototype>(vm)) NodeVMScriptPrototype(vm, structure);
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
    NodeVMScriptPrototype(VM& vm, Structure* structure)
        : Base(vm, structure)
    {
    }

    void finishCreation(VM&);
};
STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(NodeVMScriptPrototype, NodeVMScriptPrototype::Base);

static const struct HashTableValue scriptPrototypeTableValues[] = {
   { "cachedDataRejected"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly|PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, scriptGetCachedDataRejected, nullptr } },
   { "createCachedData"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly|PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, scriptCreateCachedData, 0 } },
   { "runInContext"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly|PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, scriptRunInContext, 0 } },
   { "runInThisContext"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly|PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, scriptRunInThisContext, 0 } },
   { "sourceMapURL"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly|PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, scriptGetSourceMapURL, nullptr } },
};

const ClassInfo NodeVMScriptPrototype::s_info = { "Script"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(NodeVMScriptPrototype) };
const ClassInfo NodeVMScript::s_info = { "Script"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(NodeVMScript) };
const ClassInfo NodeVMScriptConstructor::s_info = { "Script"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(NodeVMScriptConstructor) };

NodeVMScriptConstructor::NodeVMScriptConstructor(VM& vm, Structure* structure)
    : NodeVMScriptConstructor::Base(vm, structure, scriptConstructorCall, scriptConstructorConstruct)
{
}

NodeVMScriptConstructor* NodeVMScriptConstructor::create(VM& vm, JSGlobalObject* globalObject, Structure* structure, JSObject* prototype)
{
    NodeVMScriptConstructor* ptr = new (NotNull, allocateCell<NodeVMScriptConstructor>(vm)) NodeVMScriptConstructor(vm, structure);
    ptr->finishCreation(vm, prototype);
    return ptr;
}

void NodeVMScriptConstructor::finishCreation(VM& vm, JSObject* prototype)
{
    Base::finishCreation(vm, 1, "Script"_s, PropertyAdditionMode::WithStructureTransition);
    putDirectWithoutTransition(vm, vm.propertyNames->prototype, prototype, PropertyAttribute::DontEnum | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly);
    ASSERT(inherits(info()));
}

void NodeVMScriptPrototype::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    reifyStaticProperties(vm, NodeVMScript::info(), scriptPrototypeTableValues, *this);
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}

JSObject* NodeVMScript::createPrototype(VM& vm, JSGlobalObject* globalObject)
{
    return NodeVMScriptPrototype::create(vm, globalObject, NodeVMScriptPrototype::createStructure(vm, globalObject, globalObject->objectPrototype()));
}

NodeVMScript* NodeVMScript::create(VM& vm, JSGlobalObject* globalObject, Structure* structure, SourceCode source)
{
    NodeVMScript* ptr = new (NotNull, allocateCell<NodeVMScript>(vm)) NodeVMScript(vm, structure, source);
    ptr->finishCreation(vm);
    return ptr;
}

void NodeVMScript::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
}

void NodeVMScript::destroy(JSCell* cell)
{
    static_cast<NodeVMScript*>(cell)->NodeVMScript::~NodeVMScript();
}

}
