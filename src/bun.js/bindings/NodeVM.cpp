#include "root.h"
#include "JavaScriptCore/ExecutableInfo.h"

#include "BunClientData.h"
#include "NodeVM.h"
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
#include "JavaScriptCore/JSGlobalProxyInlines.h"
#include "GCDefferalContext.h"
#include "JSBuffer.h"

#include <JavaScriptCore/DOMJITAbstractHeap.h>
#include <JavaScriptCore/DFGAbstractHeap.h>
#include <JavaScriptCore/Completion.h>

namespace WebCore {
using namespace JSC;

class ScriptOptions {
public:
    String filename = String();
    OrdinalNumber lineOffset;
    OrdinalNumber columnOffset;
    String cachedData = String();
    bool produceCachedData = false;
    bool importModuleDynamically = false;

    static std::optional<ScriptOptions> fromJS(JSC::JSGlobalObject* globalObject, JSC::JSValue optionsArg, bool& failed)
    {
        auto& vm = globalObject->vm();
        ScriptOptions opts;
        JSObject* options;
        bool any = false;
        if (!optionsArg.isUndefined()) {
            if (optionsArg.isObject()) {
                options = asObject(optionsArg);
            } else if (optionsArg.isString()) {
                options = constructEmptyObject(globalObject);
                options->putDirect(vm, Identifier::fromString(vm, "filename"_s), optionsArg);
            } else {
                auto scope = DECLARE_THROW_SCOPE(vm);
                throwVMTypeError(globalObject, scope, "options must be an object or a string"_s);
                failed = true;
                return std::nullopt;
            }

            if (JSValue filenameOpt = options->getIfPropertyExists(globalObject, builtinNames(vm).filenamePublicName())) {
                if (filenameOpt.isString()) {
                    opts.filename = filenameOpt.toWTFString(globalObject);
                    any = true;
                }
            }

            if (JSValue lineOffsetOpt = options->getIfPropertyExists(globalObject, Identifier::fromString(vm, "lineOffset"_s))) {
                if (lineOffsetOpt.isAnyInt()) {
                    opts.lineOffset = OrdinalNumber::fromZeroBasedInt(lineOffsetOpt.asAnyInt());
                    any = true;
                }
            }
            if (JSValue columnOffsetOpt = options->getIfPropertyExists(globalObject, Identifier::fromString(vm, "columnOffset"_s))) {
                if (columnOffsetOpt.isAnyInt()) {
                    opts.columnOffset = OrdinalNumber::fromZeroBasedInt(columnOffsetOpt.asAnyInt());
                    any = true;
                }
            }

            // TODO: cachedData
            // TODO: importModuleDynamically
        }

        if (any)
            return opts;
        return std::nullopt;
    }
};

static EncodedJSValue
constructScript(JSGlobalObject* globalObject, CallFrame* callFrame, JSValue newTarget = JSValue())
{
    VM& vm = globalObject->vm();
    ArgList args(callFrame);
    JSValue sourceArg = args.at(0);
    String sourceString = sourceArg.isUndefined() ? emptyString() : sourceArg.toWTFString(globalObject);

    JSValue optionsArg = args.at(1);
    bool didThrow = false;
    ScriptOptions options;
    if (auto scriptOptions = ScriptOptions::fromJS(globalObject, optionsArg, didThrow)) {
        options = scriptOptions.value();
    }

    if (didThrow)
        return JSValue::encode(jsUndefined());

    auto* zigGlobalObject = reinterpret_cast<Zig::GlobalObject*>(globalObject);
    Structure* structure = zigGlobalObject->NodeVMScriptStructure();
    if (UNLIKELY(zigGlobalObject->NodeVMScript() != newTarget)) {
        auto scope = DECLARE_THROW_SCOPE(vm);
        if (!newTarget) {
            throwTypeError(globalObject, scope, "Class constructor Script cannot be invoked without 'new'"_s);
            return {};
        }

        auto* functionGlobalObject = reinterpret_cast<Zig::GlobalObject*>(getFunctionRealm(globalObject, newTarget.getObject()));
        RETURN_IF_EXCEPTION(scope, {});
        structure = InternalFunction::createSubclassStructure(
            globalObject, newTarget.getObject(), functionGlobalObject->NodeVMScriptStructure());
        scope.release();
    }

    auto scope = DECLARE_THROW_SCOPE(vm);
    SourceCode source(
        JSC::StringSourceProvider::create(sourceString, JSC::SourceOrigin(WTF::URL::fileURLWithFileSystemPath(options.filename)), options.filename, JSC::SourceTaintedOrigin::Untainted, TextPosition(options.lineOffset, options.columnOffset)),
        options.lineOffset.zeroBasedInt(), options.columnOffset.zeroBasedInt());
    RETURN_IF_EXCEPTION(scope, {});
    NodeVMScript* script = NodeVMScript::create(vm, globalObject, structure, source);
    return JSValue::encode(JSValue(script));
}

static JSC::EncodedJSValue runInContext(JSGlobalObject* globalObject, NodeVMScript* script, JSObject* globalThis, JSScope* scope, JSValue optionsArg)
{
    auto& vm = globalObject->vm();

    auto throwScope = DECLARE_THROW_SCOPE(vm);
    JSC::DirectEvalExecutable* executable = nullptr;

    if (JSC::DirectEvalExecutable* existingEval = script->m_cachedDirectExecutable.get()) {
        executable = existingEval;
    }

    if (executable == nullptr) {
        // Note: it accepts a JSGlobalObject, but it just reads stuff from JSC::VM.
        executable = JSC::DirectEvalExecutable::create(
            globalObject, script->source(), NoLexicallyScopedFeatures, DerivedContextType::None, NeedsClassFieldInitializer::No, PrivateBrandRequirement::None,
            false, false, EvalContextType::None, nullptr, nullptr);
        RETURN_IF_EXCEPTION(throwScope, {});
        script->m_cachedDirectExecutable.set(vm, script, executable);
    }

    auto catchScope = DECLARE_CATCH_SCOPE(vm);
    JSValue result = vm.interpreter.executeEval(executable, globalObject, scope);
    if (UNLIKELY(catchScope.exception())) {
        auto returnedException = catchScope.exception();
        catchScope.clearException();
        JSC::throwException(globalObject, throwScope, returnedException);
        return JSValue::encode({});
    }

    return JSValue::encode(result);
}

JSC_DEFINE_HOST_FUNCTION(scriptConstructorCall, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    return constructScript(globalObject, callFrame);
}

JSC_DEFINE_HOST_FUNCTION(scriptConstructorConstruct, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    return constructScript(globalObject, callFrame, callFrame->newTarget());
}

JSC_DEFINE_CUSTOM_GETTER(scriptGetCachedDataRejected, (JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, PropertyName))
{
    return JSValue::encode(jsBoolean(true)); // TODO
}
JSC_DEFINE_HOST_FUNCTION(scriptCreateCachedData, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    return throwVMError(globalObject, scope, "TODO: Script.createCachedData"_s);
}

JSC_DEFINE_HOST_FUNCTION(scriptRunInContext, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = globalObject->vm();

    JSValue thisValue = callFrame->thisValue();
    auto* script = jsDynamicCast<NodeVMScript*>(thisValue);
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (UNLIKELY(!script)) {
        throwVMTypeError(globalObject, scope, "Script.prototype.runInContext can only be called on a Script object"_s);
        return JSValue::encode({});
    }

    ArgList args(callFrame);

    JSValue contextArg = args.at(0);
    if (!UNLIKELY(contextArg.isObject())) {
        throwVMTypeError(globalObject, scope, "context parameter must be a contextified object"_s);
        return JSValue::encode({});
    }
    JSObject* context = asObject(contextArg);

    auto* zigGlobalObject = reinterpret_cast<Zig::GlobalObject*>(globalObject);
    JSValue scopeVal = zigGlobalObject->vmModuleContextMap()->get(context);
    if (UNLIKELY(scopeVal.isUndefined())) {
        throwVMTypeError(globalObject, scope, "context parameter must be a contextified object"_s);
        return JSValue::encode({});
    }
    JSScope* jsScope = jsDynamicCast<JSScope*>(scopeVal);
    if (UNLIKELY(!jsScope)) {
        throwVMTypeError(globalObject, scope, "context parameter must be a contextified object"_s);
        return JSValue::encode({});
    }

    JSGlobalProxy* globalProxy = jsDynamicCast<JSGlobalProxy*>(context->getPrototypeDirect());
    if (!globalProxy) {
        auto scope = DECLARE_THROW_SCOPE(vm);
        throwVMTypeError(globalObject, scope, "context parameter must be a contextified object"_s);
        return JSValue::encode({});
    }

    return runInContext(globalProxy->target(), script, context, jsScope, args.at(1));
}

JSC_DEFINE_HOST_FUNCTION(vmModuleRunInNewContext, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = globalObject->vm();
    auto sourceStringValue = callFrame->argument(0);
    JSValue contextObjectValue = callFrame->argument(1);
    JSValue optionsObjectValue = callFrame->argument(2);
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    if (!sourceStringValue.isString()) {
        throwTypeError(globalObject, throwScope, "Script code must be a string"_s);
        return JSValue::encode({});
    }

    auto sourceString = sourceStringValue.toWTFString(globalObject);

    if (!contextObjectValue || contextObjectValue.isUndefinedOrNull()) {
        contextObjectValue = JSC::constructEmptyObject(globalObject);
    }

    if (UNLIKELY(!contextObjectValue || !contextObjectValue.isObject())) {
        throwTypeError(globalObject, throwScope, "Context must be an object"_s);
        return JSValue::encode({});
    }

    // we don't care about options for now

    ScriptOptions options;
    {
        bool didThrow = false;

        if (auto scriptOptions = ScriptOptions::fromJS(globalObject, optionsObjectValue, didThrow)) {
            options = scriptOptions.value();
        }
        if (UNLIKELY(didThrow)) {
            return JSValue::encode({});
        }
    }
    SourceCode source(
        JSC::StringSourceProvider::create(sourceString, JSC::SourceOrigin(WTF::URL::fileURLWithFileSystemPath(options.filename)), options.filename, JSC::SourceTaintedOrigin::Untainted, TextPosition(options.lineOffset, options.columnOffset)),
        options.lineOffset.zeroBasedInt(), options.columnOffset.zeroBasedInt());

    auto* zigGlobal = reinterpret_cast<Zig::GlobalObject*>(globalObject);
    JSObject* context = asObject(contextObjectValue);
    auto* targetContext = NodeVMGlobalObject::create(
        vm, zigGlobal->NodeVMGlobalObjectStructure());

    auto* executable = JSC::DirectEvalExecutable::create(
        targetContext, source, NoLexicallyScopedFeatures, DerivedContextType::None, NeedsClassFieldInitializer::No, PrivateBrandRequirement::None,
        false, false, EvalContextType::None, nullptr, nullptr);
    RETURN_IF_EXCEPTION(throwScope, {});

    auto proxyStructure = JSGlobalProxy::createStructure(vm, globalObject, JSC::jsNull());
    auto proxy = JSGlobalProxy::create(vm, proxyStructure);
    proxy->setTarget(vm, targetContext);
    context->setPrototypeDirect(vm, proxy);

    JSScope* contextScope = JSWithScope::create(vm, targetContext, targetContext->globalScope(), context);

    auto catchScope = DECLARE_CATCH_SCOPE(vm);
    JSValue result = vm.interpreter.executeEval(executable, targetContext, contextScope);
    if (UNLIKELY(catchScope.exception())) {
        auto returnedException = catchScope.exception();
        catchScope.clearException();
        JSC::throwException(globalObject, throwScope, returnedException);
    }

    RETURN_IF_EXCEPTION(throwScope, {});

    return JSValue::encode(result);
}

JSC_DEFINE_HOST_FUNCTION(vmModuleRunInThisContext, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = globalObject->vm();
    auto sourceStringValue = callFrame->argument(0);
    JSValue optionsObjectValue = callFrame->argument(1);
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    if (!sourceStringValue.isString()) {
        throwTypeError(globalObject, throwScope, "Script code must be a string"_s);
        return JSValue::encode({});
    }

    auto sourceString = sourceStringValue.toWTFString(globalObject);

    ScriptOptions options;
    {
        bool didThrow = false;

        if (auto scriptOptions = ScriptOptions::fromJS(globalObject, optionsObjectValue, didThrow)) {
            options = scriptOptions.value();
        }
        if (UNLIKELY(didThrow)) {
            return JSValue::encode({});
        }
    }
    SourceCode source(
        JSC::StringSourceProvider::create(sourceString, JSC::SourceOrigin(WTF::URL::fileURLWithFileSystemPath(options.filename)), options.filename, JSC::SourceTaintedOrigin::Untainted, TextPosition(options.lineOffset, options.columnOffset)),
        options.lineOffset.zeroBasedInt(), options.columnOffset.zeroBasedInt());

    auto* executable = JSC::DirectEvalExecutable::create(
        globalObject, source, NoLexicallyScopedFeatures, DerivedContextType::None, NeedsClassFieldInitializer::No, PrivateBrandRequirement::None,
        false, false, EvalContextType::None, nullptr, nullptr);
    RETURN_IF_EXCEPTION(throwScope, {});

    JSObject* context = asObject(JSC::constructEmptyObject(globalObject));
    JSScope* contextScope = JSWithScope::create(vm, globalObject, globalObject->globalScope(), context);
    auto catchScope = DECLARE_CATCH_SCOPE(vm);
    JSValue result = vm.interpreter.executeEval(executable, globalObject, contextScope);
    if (UNLIKELY(catchScope.exception())) {
        auto returnedException = catchScope.exception();
        catchScope.clearException();
        JSC::throwException(globalObject, throwScope, returnedException);
    }

    RETURN_IF_EXCEPTION(throwScope, {});

    return JSValue::encode(result);
}

JSC_DEFINE_HOST_FUNCTION(scriptRunInNewContext, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = globalObject->vm();
    NodeVMScript* script = jsDynamicCast<NodeVMScript*>(callFrame->thisValue());
    JSValue contextObjectValue = callFrame->argument(0);
    // TODO: options
    // JSValue optionsObjectValue = callFrame->argument(1);
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (!script) {
        throwTypeError(globalObject, scope, "Script.prototype.runInNewContext can only be called on a Script object"_s);
        return JSValue::encode({});
    }

    if (!contextObjectValue || contextObjectValue.isUndefinedOrNull()) {
        contextObjectValue = JSC::constructEmptyObject(globalObject);
    }

    if (UNLIKELY(!contextObjectValue || !contextObjectValue.isObject())) {
        throwTypeError(globalObject, scope, "Context must be an object"_s);
        return JSValue::encode({});
    }

    // we don't care about options for now
    // TODO: options
    // bool didThrow = false;

    auto* zigGlobal = reinterpret_cast<Zig::GlobalObject*>(globalObject);
    JSObject* context = asObject(contextObjectValue);
    auto* targetContext = NodeVMGlobalObject::create(
        vm, zigGlobal->NodeVMGlobalObjectStructure());

    auto proxyStructure = JSGlobalProxy::createStructure(vm, globalObject, JSC::jsNull());
    auto proxy = JSGlobalProxy::create(vm, proxyStructure);
    proxy->setTarget(vm, targetContext);
    context->setPrototypeDirect(vm, proxy);

    JSScope* contextScope = JSWithScope::create(vm, targetContext, targetContext->globalScope(), context);
    return runInContext(globalObject, script, targetContext, contextScope, callFrame->argument(0));
}
JSC_DEFINE_HOST_FUNCTION(scriptRunInThisContext, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = globalObject->vm();
    JSValue thisValue = callFrame->thisValue();
    auto* script = jsDynamicCast<NodeVMScript*>(thisValue);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    // TODO: options
    // JSValue optionsObjectValue = callFrame->argument(0);

    if (UNLIKELY(!script)) {
        return throwVMTypeError(globalObject, throwScope, "Script.prototype.runInThisContext can only be called on a Script object"_s);
    }

    JSObject* context = asObject(JSC::constructEmptyObject(globalObject));
    JSWithScope* contextScope = JSWithScope::create(vm, globalObject, globalObject->globalScope(), context);

    return runInContext(globalObject, script, globalObject->globalThis(), contextScope, callFrame->argument(1));
}

JSC_DEFINE_CUSTOM_GETTER(scriptGetSourceMapURL, (JSGlobalObject * globalObject, JSC::EncodedJSValue thisValueEncoded, PropertyName))
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

Structure* createNodeVMGlobalObjectStructure(JSC::VM& vm)
{
    return NodeVMGlobalObject::createStructure(vm, jsNull());
}

JSC_DEFINE_HOST_FUNCTION(vmModule_createContext, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue contextArg = callFrame->argument(0);

    if (contextArg.isEmpty() || contextArg.isUndefinedOrNull()) {
        contextArg = JSC::constructEmptyObject(globalObject);
    }

    if (!contextArg.isObject()) {
        return throwVMTypeError(globalObject, scope, "parameter to createContext must be an object"_s);
    }
    JSObject* context = asObject(contextArg);
    auto* zigGlobalObject = reinterpret_cast<Zig::GlobalObject*>(globalObject);
    auto* targetContext = NodeVMGlobalObject::create(
        vm, zigGlobalObject->NodeVMGlobalObjectStructure());

    auto proxyStructure = zigGlobalObject->globalProxyStructure();
    auto proxy = JSGlobalProxy::create(vm, proxyStructure);
    proxy->setTarget(vm, targetContext);
    context->setPrototypeDirect(vm, proxy);

    JSScope* contextScope = JSWithScope::create(vm, targetContext, targetContext->globalScope(), context);

    zigGlobalObject->vmModuleContextMap()->set(vm, context, contextScope);

    return JSValue::encode(context);
}

JSC_DEFINE_HOST_FUNCTION(vmModule_isContext, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    ArgList args(callFrame);
    JSValue contextArg = callFrame->argument(0);
    bool isContext;
    if (!contextArg || !contextArg.isObject()) {
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
        STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(NodeVMScriptPrototype, Base);
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
    { "cachedDataRejected"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, scriptGetCachedDataRejected, nullptr } },
    { "createCachedData"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, scriptCreateCachedData, 1 } },
    { "runInContext"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, scriptRunInContext, 2 } },
    { "runInNewContext"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, scriptRunInNewContext, 2 } },
    { "runInThisContext"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, scriptRunInThisContext, 2 } },
    { "sourceMapURL"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, scriptGetSourceMapURL, nullptr } },
};

const ClassInfo NodeVMScriptPrototype::s_info = { "Script"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(NodeVMScriptPrototype) };
const ClassInfo NodeVMScript::s_info = { "Script"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(NodeVMScript) };
const ClassInfo NodeVMScriptConstructor::s_info = { "Script"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(NodeVMScriptConstructor) };
const ClassInfo NodeVMGlobalObject::s_info = { "NodeVMGlobalObject"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(NodeVMGlobalObject) };

DEFINE_VISIT_CHILDREN(NodeVMScript);

template<typename Visitor>
void NodeVMScript::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    NodeVMScript* thisObject = jsCast<NodeVMScript*>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    visitor.append(thisObject->m_cachedDirectExecutable);
}

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

} // namespace WebCore

namespace Bun {

JSC::JSValue createNodeVMBinding(Zig::GlobalObject* globalObject)
{
    VM& vm = globalObject->vm();
    auto* obj = constructEmptyObject(globalObject);
    obj->putDirect(
        vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "Script"_s)),
        reinterpret_cast<Zig::GlobalObject*>(globalObject)->NodeVMScript(), 0);
    obj->putDirect(
        vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "createContext"_s)),
        JSC::JSFunction::create(vm, globalObject, 0, "createContext"_s, vmModule_createContext, ImplementationVisibility::Public), 0);
    obj->putDirect(
        vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "isContext"_s)),
        JSC::JSFunction::create(vm, globalObject, 0, "isContext"_s, vmModule_isContext, ImplementationVisibility::Public), 0);
    obj->putDirect(
        vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "runInNewContext"_s)),
        JSC::JSFunction::create(vm, globalObject, 0, "runInNewContext"_s, vmModuleRunInNewContext, ImplementationVisibility::Public), 0);
    obj->putDirect(
        vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "runInThisContext"_s)),
        JSC::JSFunction::create(vm, globalObject, 0, "runInThisContext"_s, vmModuleRunInThisContext, ImplementationVisibility::Public), 0);
    return obj;
}

} // namespace Bun
