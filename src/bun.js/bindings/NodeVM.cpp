
#include "root.h"

#include "JavaScriptCore/PropertySlot.h"
#include "JavaScriptCore/ExecutableInfo.h"
#include "JavaScriptCore/WriteBarrierInlines.h"
#include "ErrorCode.h"
#include <JavaScriptCore/SourceOrigin.h>
#include <JavaScriptCore/SourceProvider.h>

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
#include "JavaScriptCore/LazyClassStructureInlines.h"

#include "JavaScriptCore/JSCInlines.h"

namespace Bun {
using namespace WebCore;

class NodeVMScriptConstructor final : public JSC::InternalFunction {
public:
    using Base = JSC::InternalFunction;

    static NodeVMScriptConstructor* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure, JSC::JSObject* prototype);

    DECLARE_EXPORT_INFO;

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::InternalFunctionType, Base::StructureFlags), info());
    }

private:
    NodeVMScriptConstructor(JSC::VM& vm, JSC::Structure* structure);

    void finishCreation(JSC::VM&, JSC::JSObject* prototype);
};
STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(NodeVMScriptConstructor, JSC::InternalFunction);

class NodeVMScript final : public JSC::JSDestructibleObject {
public:
    using Base = JSC::JSDestructibleObject;

    static NodeVMScript* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure, JSC::SourceCode source);

    DECLARE_EXPORT_INFO;
    template<typename, JSC::SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return WebCore::subspaceForImpl<NodeVMScript, WebCore::UseCustomHeapCellType::No>(
            vm,
            [](auto& spaces) { return spaces.m_clientSubspaceForNodeVMScript.get(); },
            [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForNodeVMScript = std::forward<decltype(space)>(space); },
            [](auto& spaces) { return spaces.m_subspaceForNodeVMScript.get(); },
            [](auto& spaces, auto&& space) { spaces.m_subspaceForNodeVMScript = std::forward<decltype(space)>(space); });
    }

    static void destroy(JSC::JSCell*);
    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

    static JSObject* createPrototype(VM& vm, JSGlobalObject* globalObject);

    const JSC::SourceCode& source() const { return m_source; }

    DECLARE_VISIT_CHILDREN;
    mutable JSC::WriteBarrier<JSC::DirectEvalExecutable> m_cachedDirectExecutable;

private:
    JSC::SourceCode m_source;

    NodeVMScript(JSC::VM& vm, JSC::Structure* structure, JSC::SourceCode source)
        : Base(vm, structure)
        , m_source(source)
    {
    }

    void finishCreation(JSC::VM&);
};

NodeVMGlobalObject::NodeVMGlobalObject(JSC::VM& vm, JSC::Structure* structure)
    : Base(vm, structure)
{
}

template<typename, JSC::SubspaceAccess mode> JSC::GCClient::IsoSubspace* NodeVMGlobalObject::subspaceFor(JSC::VM& vm)
{
    if constexpr (mode == JSC::SubspaceAccess::Concurrently)
        return nullptr;
    return WebCore::subspaceForImpl<NodeVMGlobalObject, WebCore::UseCustomHeapCellType::Yes>(
        vm,
        [](auto& spaces) { return spaces.m_clientSubspaceForNodeVMGlobalObject.get(); },
        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForNodeVMGlobalObject = std::forward<decltype(space)>(space); },
        [](auto& spaces) { return spaces.m_subspaceForNodeVMGlobalObject.get(); },
        [](auto& spaces, auto&& space) { spaces.m_subspaceForNodeVMGlobalObject = std::forward<decltype(space)>(space); },
        [](auto& server) -> JSC::HeapCellType& { return server.m_heapCellTypeForNodeVMGlobalObject; });
}

NodeVMGlobalObject* NodeVMGlobalObject::create(JSC::VM& vm, JSC::Structure* structure)
{
    auto* cell = new (NotNull, JSC::allocateCell<NodeVMGlobalObject>(vm)) NodeVMGlobalObject(vm, structure);
    cell->finishCreation(vm);
    return cell;
}

Structure* NodeVMGlobalObject::createStructure(JSC::VM& vm, JSC::JSValue prototype)
{
    // ~IsImmutablePrototypeExoticObject is necessary for JSDOM to work (it relies on __proto__ = on the GlobalObject).
    return JSC::Structure::create(vm, nullptr, prototype, JSC::TypeInfo(JSC::GlobalObjectType, StructureFlags & ~IsImmutablePrototypeExoticObject), info());
}

void NodeVMGlobalObject::finishCreation(JSC::VM&)
{
    Base::finishCreation(vm());
}

void NodeVMGlobalObject::destroy(JSCell* cell)
{
    static_cast<NodeVMGlobalObject*>(cell)->~NodeVMGlobalObject();
}

NodeVMGlobalObject::~NodeVMGlobalObject()
{
}

void NodeVMGlobalObject::setContextifiedObject(JSC::JSObject* contextifiedObject)
{
    m_sandbox.set(vm(), this, contextifiedObject);
}

void NodeVMGlobalObject::clearContextifiedObject()
{
    m_sandbox.clear();
}

bool NodeVMGlobalObject::put(JSCell* cell, JSGlobalObject* globalObject, PropertyName propertyName, JSValue value, PutPropertySlot& slot)
{
    // if (!propertyName.isSymbol())
    //     printf("put called for %s\n", propertyName.publicName()->utf8().data());
    auto* thisObject = jsCast<NodeVMGlobalObject*>(cell);

    if (!thisObject->m_sandbox) {
        return Base::put(cell, globalObject, propertyName, value, slot);
    }

    auto* sandbox = thisObject->m_sandbox.get();

    auto& vm = JSC::getVM(globalObject);
    JSValue thisValue = slot.thisValue();
    bool isContextualStore = thisValue != JSValue(globalObject);
    (void)isContextualStore;
    bool isDeclaredOnGlobalObject = slot.type() == JSC::PutPropertySlot::NewProperty;
    auto scope = DECLARE_THROW_SCOPE(vm);
    PropertySlot getter(sandbox, PropertySlot::InternalMethodType::Get, nullptr);
    bool isDeclaredOnSandbox = sandbox->getPropertySlot(globalObject, propertyName, getter);
    RETURN_IF_EXCEPTION(scope, false);

    bool isDeclared = isDeclaredOnGlobalObject || isDeclaredOnSandbox;
    bool isFunction = value.isCallable();

    if (slot.isStrictMode() && !isDeclared && isContextualStore && !isFunction) {
        return Base::put(cell, globalObject, propertyName, value, slot);
    }

    if (!isDeclared && value.isSymbol()) {
        return Base::put(cell, globalObject, propertyName, value, slot);
    }

    slot.setThisValue(sandbox);

    if (!sandbox->methodTable()->put(sandbox, globalObject, propertyName, value, slot)) {
        return false;
    }
    RETURN_IF_EXCEPTION(scope, false);

    if (isDeclaredOnSandbox && getter.isAccessor() and (getter.attributes() & PropertyAttribute::DontEnum) == 0) {
        return true;
    }

    slot.setThisValue(thisValue);

    return Base::put(cell, globalObject, propertyName, value, slot);
}

bool NodeVMGlobalObject::getOwnPropertySlot(JSObject* cell, JSGlobalObject* globalObject, PropertyName propertyName, PropertySlot& slot)
{
    // if (!propertyName.isSymbol())
    //     printf("getOwnPropertySlot called for %s\n", propertyName.publicName()->utf8().data());
    auto* thisObject = jsCast<NodeVMGlobalObject*>(cell);
    if (thisObject->m_sandbox) {
        auto* contextifiedObject = thisObject->m_sandbox.get();
        auto& vm = JSC::getVM(globalObject);
        auto scope = DECLARE_THROW_SCOPE(vm);
        slot.setThisValue(contextifiedObject);
        if (contextifiedObject->getPropertySlot(globalObject, propertyName, slot)) {
            return true;
        }

        slot.setThisValue(globalObject);
        RETURN_IF_EXCEPTION(scope, false);
    }

    return Base::getOwnPropertySlot(cell, globalObject, propertyName, slot);
}

bool NodeVMGlobalObject::defineOwnProperty(JSObject* cell, JSGlobalObject* globalObject, PropertyName propertyName, const PropertyDescriptor& descriptor, bool shouldThrow)
{
    // if (!propertyName.isSymbol())
    //     printf("defineOwnProperty called for %s\n", propertyName.publicName()->utf8().data());
    auto* thisObject = jsCast<NodeVMGlobalObject*>(cell);
    if (!thisObject->m_sandbox) {
        return Base::defineOwnProperty(cell, globalObject, propertyName, descriptor, shouldThrow);
    }

    auto* contextifiedObject = thisObject->m_sandbox.get();
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    PropertySlot slot(globalObject, PropertySlot::InternalMethodType::GetOwnProperty, nullptr);
    bool isDeclaredOnGlobalProxy = globalObject->JSC::JSGlobalObject::getOwnPropertySlot(globalObject, globalObject, propertyName, slot);

    // If the property is set on the global as neither writable nor
    // configurable, don't change it on the global or sandbox.
    if (isDeclaredOnGlobalProxy && (slot.attributes() & PropertyAttribute::ReadOnly) != 0 && (slot.attributes() & PropertyAttribute::DontDelete) != 0) {
        return Base::defineOwnProperty(cell, globalObject, propertyName, descriptor, shouldThrow);
    }

    if (descriptor.isAccessorDescriptor()) {
        return contextifiedObject->defineOwnProperty(contextifiedObject, contextifiedObject->globalObject(), propertyName, descriptor, shouldThrow);
    }

    bool isDeclaredOnSandbox = contextifiedObject->getPropertySlot(globalObject, propertyName, slot);
    RETURN_IF_EXCEPTION(scope, false);

    if (isDeclaredOnSandbox && !isDeclaredOnGlobalProxy) {
        return contextifiedObject->defineOwnProperty(contextifiedObject, contextifiedObject->globalObject(), propertyName, descriptor, shouldThrow);
    }

    if (!contextifiedObject->defineOwnProperty(contextifiedObject, contextifiedObject->globalObject(), propertyName, descriptor, shouldThrow)) {
        return false;
    }

    return Base::defineOwnProperty(cell, globalObject, propertyName, descriptor, shouldThrow);
}

DEFINE_VISIT_CHILDREN(NodeVMGlobalObject);

template<typename Visitor>
void NodeVMGlobalObject::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    Base::visitChildren(cell, visitor);
    auto* thisObject = jsCast<NodeVMGlobalObject*>(cell);
    visitor.append(thisObject->m_sandbox);
}

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
        auto& vm = JSC::getVM(globalObject);
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

    auto* zigGlobalObject = defaultGlobalObject(globalObject);
    Structure* structure = zigGlobalObject->NodeVMScriptStructure();
    if (UNLIKELY(zigGlobalObject->NodeVMScript() != newTarget)) {
        auto scope = DECLARE_THROW_SCOPE(vm);
        if (!newTarget) {
            throwTypeError(globalObject, scope, "Class constructor Script cannot be invoked without 'new'"_s);
            return {};
        }

        auto* functionGlobalObject = defaultGlobalObject(getFunctionRealm(globalObject, newTarget.getObject()));
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

static JSC::EncodedJSValue runInContext(NodeVMGlobalObject* globalObject, NodeVMScript* script, JSObject* contextifiedObject, JSValue optionsArg)
{
    auto& vm = JSC::getVM(globalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    // Set the contextified object before evaluating
    globalObject->setContextifiedObject(contextifiedObject);

    NakedPtr<Exception> exception;
    JSValue result = JSC::evaluate(globalObject, script->source(), globalObject, exception);
    if (UNLIKELY(exception)) {
        JSC::throwException(globalObject, throwScope, exception.get());
        return {};
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
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    return throwVMError(globalObject, scope, "TODO: Script.createCachedData"_s);
}

JSC_DEFINE_HOST_FUNCTION(scriptRunInContext, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue thisValue = callFrame->thisValue();
    auto* script = jsDynamicCast<NodeVMScript*>(thisValue);
    if (UNLIKELY(!script)) {
        return ERR::INVALID_ARG_VALUE(scope, globalObject, "this"_s, thisValue, "must be a Script"_s);
    }

    ArgList args(callFrame);
    JSValue contextArg = args.at(0);
    if (contextArg.isUndefined()) {
        contextArg = JSC::constructEmptyObject(globalObject);
    }

    if (!contextArg.isObject()) {
        return ERR::INVALID_ARG_TYPE(scope, globalObject, "context"_s, "object"_s, contextArg);
    }

    JSObject* context = asObject(contextArg);
    auto* zigGlobalObject = defaultGlobalObject(globalObject);
    JSValue scopeValue = zigGlobalObject->vmModuleContextMap()->get(context);
    if (scopeValue.isUndefined()) {
        return ERR::INVALID_ARG_VALUE(scope, globalObject, "context"_s, context, "must be a contextified object"_s);
    }

    NodeVMGlobalObject* nodeVmGlobalObject = jsDynamicCast<NodeVMGlobalObject*>(scopeValue);
    if (!nodeVmGlobalObject) {
        return ERR::INVALID_ARG_VALUE(scope, globalObject, "context"_s, context, "must be a contextified object"_s);
    }

    return runInContext(nodeVmGlobalObject, script, context, args.at(1));
}

JSC_DEFINE_HOST_FUNCTION(scriptRunInThisContext, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    JSValue thisValue = callFrame->thisValue();
    auto* script = jsDynamicCast<NodeVMScript*>(thisValue);
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    if (UNLIKELY(!script)) {
        return ERR::INVALID_ARG_VALUE(throwScope, globalObject, "this"_s, thisValue, "must be a Script"_s);
    }

    JSValue contextArg = callFrame->argument(0);
    if (contextArg.isUndefined()) {
        contextArg = JSC::constructEmptyObject(globalObject);
    }

    if (!contextArg.isObject()) {
        return ERR::INVALID_ARG_TYPE(throwScope, globalObject, "context"_s, "object"_s, contextArg);
    }

    JSObject* context = asObject(contextArg);

    NakedPtr<Exception> exception;
    JSValue result = JSC::evaluateWithScopeExtension(globalObject, script->source(), JSC::JSWithScope::create(vm, globalObject, globalObject->globalScope(), context), exception);

    if (exception)
        JSC::throwException(globalObject, throwScope, exception.get());

    RETURN_IF_EXCEPTION(throwScope, {});
    return JSValue::encode(result);
}

JSC_DEFINE_CUSTOM_GETTER(scriptGetSourceMapURL, (JSGlobalObject * globalObject, JSC::EncodedJSValue thisValueEncoded, PropertyName))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue thisValue = JSValue::decode(thisValueEncoded);
    auto* script = jsDynamicCast<NodeVMScript*>(thisValue);
    if (UNLIKELY(!script)) {
        return ERR::INVALID_ARG_VALUE(scope, globalObject, "this"_s, thisValue, "must be a Script"_s);
    }

    const auto& url = script->source().provider()->sourceMappingURLDirective();
    return JSValue::encode(jsString(vm, url));
}

JSC_DEFINE_HOST_FUNCTION(vmModuleRunInNewContext, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue code = callFrame->argument(0);
    if (!code.isString())
        return ERR::INVALID_ARG_TYPE(scope, globalObject, "code"_s, "string"_s, code);

    JSValue contextArg = callFrame->argument(1);
    if (contextArg.isUndefined()) {
        contextArg = JSC::constructEmptyObject(globalObject);
    }

    if (!contextArg.isObject())
        return ERR::INVALID_ARG_TYPE(scope, globalObject, "context"_s, "object"_s, contextArg);

    JSObject* sandbox = asObject(contextArg);

    // Create context and run code
    auto* context = NodeVMGlobalObject::create(vm,
        defaultGlobalObject(globalObject)->NodeVMGlobalObjectStructure());

    context->setContextifiedObject(sandbox);

    JSValue optionsArg = callFrame->argument(2);
    ScriptOptions options;
    {
        bool didThrow = false;
        if (auto scriptOptions = ScriptOptions::fromJS(globalObject, optionsArg, didThrow)) {
            options = scriptOptions.value();
        }
        if (UNLIKELY(didThrow)) {
            return encodedJSValue();
        }
    }

    auto sourceCode = SourceCode(
        JSC::StringSourceProvider::create(
            code.toString(globalObject)->value(globalObject),
            JSC::SourceOrigin(WTF::URL::fileURLWithFileSystemPath(options.filename)),
            options.filename,
            JSC::SourceTaintedOrigin::Untainted,
            TextPosition(options.lineOffset, options.columnOffset)),
        options.lineOffset.zeroBasedInt(),
        options.columnOffset.zeroBasedInt());

    NakedPtr<Exception> exception;
    JSValue result = JSC::evaluate(context, sourceCode, context, exception);

    if (exception) {
        throwException(globalObject, scope, exception);
        return {};
    }

    return JSValue::encode(result);
}

JSC_DEFINE_HOST_FUNCTION(vmModuleRunInThisContext, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto sourceStringValue = callFrame->argument(0);
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    if (!sourceStringValue.isString()) {
        return ERR::INVALID_ARG_TYPE(throwScope, globalObject, "code"_s, "string"_s, sourceStringValue);
    }

    auto sourceString = sourceStringValue.toWTFString(globalObject);

    ScriptOptions options;
    {
        bool didThrow = false;

        if (auto scriptOptions = ScriptOptions::fromJS(globalObject, callFrame->argument(1), didThrow)) {
            options = scriptOptions.value();
        }
        if (UNLIKELY(didThrow)) {
            return JSValue::encode({});
        }
    }
    SourceCode source(
        JSC::StringSourceProvider::create(sourceString, JSC::SourceOrigin(WTF::URL::fileURLWithFileSystemPath(options.filename)), options.filename, JSC::SourceTaintedOrigin::Untainted, TextPosition(options.lineOffset, options.columnOffset)),
        options.lineOffset.zeroBasedInt(), options.columnOffset.zeroBasedInt());

    WTF::NakedPtr<Exception> exception;
    JSValue result = JSC::evaluate(globalObject, source, globalObject, exception);

    if (exception)
        throwException(globalObject, throwScope, exception);

    return JSValue::encode(result);
}

JSC_DEFINE_HOST_FUNCTION(scriptRunInNewContext, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    NodeVMScript* script = jsDynamicCast<NodeVMScript*>(callFrame->thisValue());
    JSValue contextObjectValue = callFrame->argument(0);
    // TODO: options
    // JSValue optionsObjectValue = callFrame->argument(1);
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (!script) {
        throwTypeError(globalObject, scope, "Script.prototype.runInNewContext can only be called on a Script object"_s);
        return {};
    }

    if (!contextObjectValue || contextObjectValue.isUndefinedOrNull()) {
        contextObjectValue = JSC::constructEmptyObject(globalObject);
    }

    if (UNLIKELY(!contextObjectValue || !contextObjectValue.isObject())) {
        throwTypeError(globalObject, scope, "Context must be an object"_s);
        return {};
    }

    // we don't care about options for now
    // TODO: options
    // bool didThrow = false;

    auto* zigGlobal = defaultGlobalObject(globalObject);
    JSObject* context = asObject(contextObjectValue);
    auto* targetContext = NodeVMGlobalObject::create(
        vm, zigGlobal->NodeVMGlobalObjectStructure());

    return runInContext(targetContext, script, context, callFrame->argument(0));
}

Structure* createNodeVMGlobalObjectStructure(JSC::VM& vm)
{
    return NodeVMGlobalObject::createStructure(vm, jsNull());
}

JSC_DEFINE_HOST_FUNCTION(vmModule_createContext, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue contextArg = callFrame->argument(0);
    if (contextArg.isUndefinedOrNull()) {
        contextArg = JSC::constructEmptyObject(globalObject);
    }

    if (!contextArg.isObject()) {
        return ERR::INVALID_ARG_TYPE(scope, globalObject, "context"_s, "object"_s, contextArg);
    }

    JSObject* sandbox = asObject(contextArg);

    // Create new VM context global object
    auto* targetContext = NodeVMGlobalObject::create(vm,
        defaultGlobalObject(globalObject)->NodeVMGlobalObjectStructure());

    // Set sandbox as contextified object
    targetContext->setContextifiedObject(sandbox);

    // Store context in WeakMap for isContext checks
    auto* zigGlobalObject = defaultGlobalObject(globalObject);
    zigGlobalObject->vmModuleContextMap()->set(vm, sandbox, targetContext);

    return JSValue::encode(sandbox);
}

JSC_DEFINE_HOST_FUNCTION(vmModule_isContext, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    ArgList args(callFrame);
    JSValue contextArg = callFrame->argument(0);
    bool isContext;
    if (!contextArg || !contextArg.isObject()) {
        isContext = false;
    } else {
        auto* zigGlobalObject = defaultGlobalObject(globalObject);
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

// NodeVMGlobalObject* NodeVMGlobalObject::create(JSC::VM& vm, JSC::Structure* structure)
// {
//     auto* obj = new (NotNull, allocateCell<NodeVMGlobalObject>(vm)) NodeVMGlobalObject(vm, structure);
//     obj->finishCreation(vm);
//     return obj;
// }

// void NodeVMGlobalObject::finishCreation(VM& vm, JSObject* context)
// {
//     Base::finishCreation(vm);
//     // We don't need to store the context anymore since we use proxies
// }

// DEFINE_VISIT_CHILDREN(NodeVMGlobalObject);

// template<typename Visitor>
// void NodeVMGlobalObject::visitChildrenImpl(JSCell* cell, Visitor& visitor)
// {
//     Base::visitChildren(cell, visitor);
//     // auto* thisObject = jsCast<NodeVMGlobalObject*>(cell);
//     // visitor.append(thisObject->m_proxyTarget);
// }

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

JSC::JSValue createNodeVMBinding(Zig::GlobalObject* globalObject)
{
    VM& vm = globalObject->vm();
    auto* obj = constructEmptyObject(globalObject);
    obj->putDirect(
        vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "Script"_s)),
        defaultGlobalObject(globalObject)->NodeVMScript(), 0);
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

void configureNodeVM(JSC::VM& vm, Zig::GlobalObject* globalObject)
{
    globalObject->m_NodeVMScriptClassStructure.initLater(
        [](LazyClassStructure::Initializer& init) {
            auto prototype = NodeVMScript::createPrototype(init.vm, init.global);
            auto* structure = NodeVMScript::createStructure(init.vm, init.global, prototype);
            auto* constructorStructure = NodeVMScriptConstructor::createStructure(
                init.vm, init.global, init.global->m_functionPrototype.get());
            auto* constructor = NodeVMScriptConstructor::create(
                init.vm, init.global, constructorStructure, prototype);
            init.setPrototype(prototype);
            init.setStructure(structure);
            init.setConstructor(constructor);
        });

    globalObject->m_cachedNodeVMGlobalObjectStructure.initLater(
        [](const JSC::LazyProperty<JSC::JSGlobalObject, Structure>::Initializer& init) {
            init.set(createNodeVMGlobalObjectStructure(init.vm));
        });
}

bool NodeVMGlobalObject::deleteProperty(JSCell* cell, JSGlobalObject* globalObject, PropertyName propertyName, JSC::DeletePropertySlot& slot)
{

    auto* thisObject = jsCast<NodeVMGlobalObject*>(cell);
    if (UNLIKELY(!thisObject->m_sandbox)) {
        return Base::deleteProperty(cell, globalObject, propertyName, slot);
    }

    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* sandbox = thisObject->m_sandbox.get();
    if (!sandbox->deleteProperty(sandbox, globalObject, propertyName, slot)) {
        return false;
    }

    RETURN_IF_EXCEPTION(scope, false);
    return Base::deleteProperty(cell, globalObject, propertyName, slot);
}

void NodeVMGlobalObject::getOwnPropertyNames(JSObject* cell, JSGlobalObject* globalObject, JSC::PropertyNameArray& propertyNames, JSC::DontEnumPropertiesMode mode)
{
    auto* thisObject = jsCast<NodeVMGlobalObject*>(cell);

    if (thisObject->m_sandbox) {
        thisObject->m_sandbox->getOwnPropertyNames(
            thisObject->m_sandbox.get(),
            globalObject,
            propertyNames,
            mode);
    }

    Base::getOwnPropertyNames(cell, globalObject, propertyNames, mode);
}

} // namespace Bun
