#include "root.h"

#include "JavaScriptCore/SlotVisitorMacros.h"
#include "NodeVMModule.h"
#include "ZigGlobalObject.h"
#include "DOMIsoSubspaces.h"
#include "DOMClientIsoSubspaces.h"
#include <JavaScriptCore/FunctionPrototype.h>
#include <JavaScriptCore/JSString.h>
#include "JavaScriptCore/JSModuleNamespaceObject.h"
#include "JavaScriptCore/JSModuleRecord.h"
#include "JavaScriptCore/JSModuleEnvironment.h"
#include "JavaScriptCore/JSInternalPromise.h"
#include "JavaScriptCore/JSPromise.h"
#include "JavaScriptCore/JSCInlines.h"
#include "JavaScriptCore/JSGlobalObjectInlines.h"
#include "JavaScriptCore/JSCJSValueInlines.h"
#include "JavaScriptCore/CallData.h"
#include "JavaScriptCore/JSWeakMapInlines.h"
#include "ErrorCode.h"
#include <JavaScriptCore/TypedArrayInlines.h>
#include <JavaScriptCore/PropertyNameArray.h>
#include "GCDefferalContext.h"
#include "JavaScriptCore/JSWeakMap.h"
#include "JavaScriptCore/Uint8Array.h"
#include "JavaScriptCore/SourceCode.h"
#include "JavaScriptCore/SourceProvider.h"
#include "JavaScriptCore/TypedArrayInlines.h"
#include "JavaScriptCore/JSArray.h"
#include "JavaScriptCore/ArrayBuffer.h"
#include "JavaScriptCore/JSArrayBuffer.h"
#include "JavaScriptCore/JSTypedArrays.h"
#include "JavaScriptCore/SourceOrigin.h"
#include "wtf/URL.h"
#include "JavaScriptCore/ModuleAnalyzer.h"
#include "JavaScriptCore/JSObject.h"
#include "JavaScriptCore/JSFunction.h"
#include "JavaScriptCore/JSCBuiltins.h"
#include "JavaScriptCore/JSGlobalObject.h"
#include "JavaScriptCore/JSCast.h"
#include "JavaScriptCore/JSObjectInlines.h"
#include "JavaScriptCore/JSModuleLoader.h"
#include "JavaScriptCore/JSWeakMap.h"
namespace Bun {

using namespace JSC;

// Forward declarations
static JSC_DECLARE_HOST_FUNCTION(callNodeVMModule);
static JSC_DECLARE_HOST_FUNCTION(constructNodeVMModule);
static JSC_DECLARE_CUSTOM_GETTER(jsNodeVMModuleGetter_identifier);
static JSC_DECLARE_CUSTOM_GETTER(jsNodeVMModuleGetter_context);
static JSC_DECLARE_CUSTOM_GETTER(jsNodeVMModuleGetter_namespace);
static JSC_DECLARE_CUSTOM_GETTER(jsNodeVMModuleGetter_status);
static JSC_DECLARE_CUSTOM_GETTER(jsNodeVMModuleGetter_error);
static JSC_DECLARE_HOST_FUNCTION(jsNodeVMModuleProtoFuncLink);
static JSC_DECLARE_HOST_FUNCTION(jsNodeVMModuleProtoFuncEvaluate);
static JSC_DECLARE_HOST_FUNCTION(jsNodeVMModuleProtoFuncInspectCustom);

// Property table for prototype
static const HashTableValue NodeVMModulePrototypeTableValues[] = {
    { "identifier"_s, static_cast<unsigned>(PropertyAttribute::CustomAccessor | PropertyAttribute::ReadOnly), NoIntrinsic,
        { HashTableValue::GetterSetterType, jsNodeVMModuleGetter_identifier, 0 } },
    { "context"_s, static_cast<unsigned>(PropertyAttribute::CustomAccessor | PropertyAttribute::ReadOnly), NoIntrinsic,
        { HashTableValue::GetterSetterType, jsNodeVMModuleGetter_context, 0 } },
    { "namespace"_s, static_cast<unsigned>(PropertyAttribute::CustomAccessor | PropertyAttribute::ReadOnly), NoIntrinsic,
        { HashTableValue::GetterSetterType, jsNodeVMModuleGetter_namespace, 0 } },
    { "status"_s, static_cast<unsigned>(PropertyAttribute::CustomAccessor | PropertyAttribute::ReadOnly), NoIntrinsic,
        { HashTableValue::GetterSetterType, jsNodeVMModuleGetter_status, 0 } },
    { "error"_s, static_cast<unsigned>(PropertyAttribute::CustomAccessor | PropertyAttribute::ReadOnly), NoIntrinsic,
        { HashTableValue::GetterSetterType, jsNodeVMModuleGetter_error, 0 } },
    { "link"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic,
        { HashTableValue::NativeFunctionType, jsNodeVMModuleProtoFuncLink, 1 } },
    { "evaluate"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic,
        { HashTableValue::NativeFunctionType, jsNodeVMModuleProtoFuncEvaluate, 0 } },
    { "Symbol(nodejs.util.inspect.custom)"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic,
        { HashTableValue::NativeFunctionType, jsNodeVMModuleProtoFuncInspectCustom, 0 } },
};

// Add at the top of the file after the includes
static uint32_t globalModuleId = 0;

// Main Module class implementation
class NodeVMModule : public JSDestructibleObject {
public:
    using Base = JSDestructibleObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    // For source text based modules
    static NodeVMModule* create(VM& vm, Structure* structure, JSGlobalObject* globalObject, JSObject* context,
        const String& identifier, RefPtr<SourceProvider>&& sourceProvider, JSUint8Array* cachedData, JSObject* importModuleDynamically, JSObject* initializeImportMeta)
    {
        NodeVMModule* module = new (NotNull, allocateCell<NodeVMModule>(vm)) NodeVMModule(vm, structure);
        module->finishCreation(vm, globalObject, context, identifier, WTFMove(sourceProvider), cachedData, importModuleDynamically, initializeImportMeta);
        return module;
    }

    // For synthetic modules
    static NodeVMModule* create(VM& vm, Structure* structure, JSGlobalObject* globalObject, JSObject* context,
        const String& identifier, JSArray* syntheticExportNames, JSObject* syntheticEvaluationSteps)
    {
        NodeVMModule* module = new (NotNull, allocateCell<NodeVMModule>(vm)) NodeVMModule(vm, structure);
        module->finishCreation(vm, globalObject, context, identifier, syntheticExportNames, syntheticEvaluationSteps);
        return module;
    }

    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;
    DECLARE_VISIT_OUTPUT_CONSTRAINTS;

    template<typename Visitor> void visitAdditionalChildren(Visitor&);
    static void analyzeHeap(JSCell*, JSC::HeapAnalyzer&);

    template<typename CellType, SubspaceAccess mode>
    static GCClient::IsoSubspace* subspaceFor(VM& vm)
    {
        if constexpr (mode == SubspaceAccess::Concurrently)
            return nullptr;
        return WebCore::subspaceForImpl<CellType, WebCore::UseCustomHeapCellType::No>(
            vm,
            [](auto& spaces) { return spaces.m_clientSubspaceForNodeVMModule.get(); },
            [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForNodeVMModule = std::forward<decltype(space)>(space); },
            [](auto& spaces) { return spaces.m_subspaceForNodeVMModule.get(); },
            [](auto& spaces, auto&& space) { spaces.m_subspaceForNodeVMModule = std::forward<decltype(space)>(space); });
    }

    static Structure* createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
    {
        return Structure::create(vm, globalObject, prototype, TypeInfo(ObjectType, StructureFlags), info());
    }

    const String& identifier() const { return m_identifier; }
    JSObject* context() const { return m_context.get(); }
    JSObject* syntheticEvaluationSteps() const { return m_syntheticEvaluationSteps.get(); }
    JSArray* syntheticExportNames() const { return m_syntheticExportNames.get(); }
    RefPtr<SourceProvider> sourceProvider() const { return m_sourceProvider; }
    JSModuleEnvironment* moduleEnvironment() const { return m_moduleEnvironment.get(); }
    void setModuleEnvironment(VM& vm, JSModuleEnvironment* environment) { m_moduleEnvironment.set(vm, this, environment); }
    JSObject* importModuleDynamically() const { return m_importModuleDynamically.get(); }
    JSObject* initializeImportMeta() const { return m_initializeImportMeta.get(); }

    // Add link method declaration
    Synchronousness link(JSGlobalObject*, JSValue scriptFetcher);

    Structure* moduleStructure(JSGlobalObject* globalObject) const
    {
        return static_cast<ZigGlobalObject*>(globalObject)->NodeVMModuleStructure();
    }

    JSValue evaluateModule(JSGlobalObject* globalObject, JSValue key, JSValue moduleRecordValue, JSValue scriptFetcher, JSValue sentValue, JSValue resumeMode);
    JSValue importModuleDynamically(JSGlobalObject* globalObject, JSValue key, JSValue moduleRecordValue, JSValue scriptFetcher);

protected:
    mutable WriteBarrier<JSC::AbstractModuleRecord> m_moduleRecord;
    mutable WriteBarrier<JSC::JSObject> m_context;
    mutable WriteBarrier<JSC::JSArray> m_syntheticExportNames;
    mutable WriteBarrier<JSC::JSObject> m_syntheticEvaluationSteps;
    RefPtr<JSC::SourceProvider> m_sourceProvider;
    WriteBarrier<JSC::JSObject> m_importModuleDynamically;
    WriteBarrier<JSC::JSObject> m_initializeImportMeta;

private:
    NodeVMModule(VM& vm, Structure* structure)
        : Base(vm, structure)
    {
    }

    void finishCreation(VM& vm, JSGlobalObject* globalObject, JSObject* context, const String& identifier,
        RefPtr<SourceProvider>&& sourceProvider, JSUint8Array* cachedData, JSObject* importModuleDynamically, JSObject* initializeImportMeta)
    {
        Base::finishCreation(vm);
        m_context.setEarlyValue(vm, this, context);
        m_sourceProvider = WTFMove(sourceProvider);

        m_importModuleDynamically.setEarlyValue(vm, this, importModuleDynamically);
        m_initializeImportMeta.setEarlyValue(vm, this, initializeImportMeta);
        m_moduleRecord.clear();
    }

    void finishCreation(VM& vm, JSGlobalObject* globalObject, JSObject* context, const String& identifier,
        JSArray* syntheticExportNames, JSObject* syntheticEvaluationSteps)
    {
        Base::finishCreation(vm);
        m_context.setEarlyValue(vm, this, context);
        m_syntheticExportNames.setEarlyValue(vm, this, syntheticExportNames);
        m_syntheticEvaluationSteps.setEarlyValue(vm, this, syntheticEvaluationSteps);
        m_moduleRecord.clear();

        // Create a synthetic source provider for this module
        auto generator = [syntheticExportNames = m_syntheticExportNames, syntheticEvaluationSteps = m_syntheticEvaluationSteps](JSGlobalObject* globalObject, Identifier moduleKey, Vector<Identifier, 4>& exportNames, MarkedArgumentBuffer& exportValues) {
            if (syntheticExportNames && syntheticEvaluationSteps) {
                // Get the export names from the synthetic module
                unsigned length = syntheticExportNames->length();
                for (unsigned i = 0; i < length; ++i) {
                    JSValue exportName = syntheticExportNames->get(globalObject, i);
                    if (exportName.isString()) {
                        exportNames.append(Identifier::fromString(globalObject->vm(), exportName.getString(globalObject)));
                    }
                }

                // Call the evaluation steps to get the export values
                MarkedArgumentBuffer args;
                args.append(syntheticExportNames.get());
                JSValue result = call(globalObject, syntheticEvaluationSteps.get(), jsUndefined(), args);

                if (!result.isUndefined()) {
                    exportValues.append(result);
                }
            }
        };

        URL moduleURL = URL::fileURLWithFileSystemPath(identifier);
        m_sourceProvider = SyntheticSourceProvider::create(WTFMove(generator), SourceOrigin(moduleURL), identifier);
    }
};

// Prototype class implementation
class NodeVMModulePrototype final : public JSNonFinalObject {
public:
    using Base = JSNonFinalObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static NodeVMModulePrototype* create(VM& vm, JSGlobalObject* globalObject, Structure* structure)
    {
        NodeVMModulePrototype* prototype = new (NotNull, allocateCell<NodeVMModulePrototype>(vm)) NodeVMModulePrototype(vm, structure);
        prototype->finishCreation(vm);
        return prototype;
    }

    DECLARE_INFO;

    template<typename CellType, SubspaceAccess>
    static GCClient::IsoSubspace* subspaceFor(VM& vm)
    {
        return &vm.plainObjectSpace();
    }

    static Structure* createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
    {
        auto* structure = Structure::create(vm, globalObject, prototype, TypeInfo(ObjectType, StructureFlags), info());
        structure->setMayBePrototype(true);
        return structure;
    }

private:
    NodeVMModulePrototype(VM& vm, Structure* structure)
        : Base(vm, structure)
    {
    }

    void finishCreation(VM& vm);
};

// Constructor class implementation
class NodeVMModuleConstructor final : public InternalFunction {
public:
    using Base = InternalFunction;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static NodeVMModuleConstructor* create(VM& vm, Structure* structure, JSObject* prototype)
    {
        NodeVMModuleConstructor* constructor = new (NotNull, allocateCell<NodeVMModuleConstructor>(vm)) NodeVMModuleConstructor(vm, structure);
        constructor->finishCreation(vm, prototype);
        return constructor;
    }

    DECLARE_INFO;

    template<typename CellType, SubspaceAccess>
    static GCClient::IsoSubspace* subspaceFor(VM& vm)
    {
        return &vm.internalFunctionSpace();
    }

    static Structure* createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
    {
        return Structure::create(vm, globalObject, prototype, TypeInfo(InternalFunctionType, StructureFlags), info());
    }

private:
    NodeVMModuleConstructor(VM& vm, Structure* structure)
        : Base(vm, structure, callNodeVMModule, constructNodeVMModule)
    {
    }

    void finishCreation(VM& vm, JSObject* prototype)
    {
        Base::finishCreation(vm, 1, "Module"_s);
        putDirectWithoutTransition(vm, vm.propertyNames->prototype, prototype, PropertyAttribute::DontEnum | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly);
    }
};

// Class info definitions
const ClassInfo NodeVMModule::s_info = { "Module"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(NodeVMModule) };
const ClassInfo NodeVMModulePrototype::s_info = { "Module"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(NodeVMModulePrototype) };
const ClassInfo NodeVMModuleConstructor::s_info = { "Module"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(NodeVMModuleConstructor) };

void NodeVMModulePrototype::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    reifyStaticProperties(vm, NodeVMModule::info(), NodeVMModulePrototypeTableValues, *this);
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}

// Getter implementations
JSC_DEFINE_CUSTOM_GETTER(jsNodeVMModuleGetter_identifier, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    NodeVMModule* thisObject = jsDynamicCast<NodeVMModule*>(JSValue::decode(thisValue));
    if (UNLIKELY(!thisObject)) {
        throwVMError(globalObject, scope, "Receiver must be a Module instance"_s);
        return {};
    }

    return JSValue::encode(jsString(vm, thisObject->identifier()));
}

JSC_DEFINE_CUSTOM_GETTER(jsNodeVMModuleGetter_context, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    NodeVMModule* thisObject = jsDynamicCast<NodeVMModule*>(JSValue::decode(thisValue));
    if (UNLIKELY(!thisObject)) {
        throwVMError(globalObject, scope, "Receiver must be a Module instance"_s);
        return {};
    }

    return JSValue::encode(thisObject->context());
}

JSC_DEFINE_CUSTOM_GETTER(jsNodeVMModuleGetter_namespace, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    NodeVMModule* thisObject = jsDynamicCast<NodeVMModule*>(JSValue::decode(thisValue));
    if (UNLIKELY(!thisObject)) {
        throwVMError(globalObject, scope, "Receiver must be a Module instance"_s);
        return {};
    }

    // TODO: Return actual namespace
    return JSValue::encode(jsNull());
}

JSC_DEFINE_CUSTOM_GETTER(jsNodeVMModuleGetter_status, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    NodeVMModule* thisObject = jsDynamicCast<NodeVMModule*>(JSValue::decode(thisValue));
    if (UNLIKELY(!thisObject)) {
        throwVMError(globalObject, scope, "Receiver must be a Module instance"_s);
        return {};
    }

    // TODO: Return actual status
    return JSValue::encode(jsString(vm, String("unlinked"_s)));
}

JSC_DEFINE_CUSTOM_GETTER(jsNodeVMModuleGetter_error, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    NodeVMModule* thisObject = jsDynamicCast<NodeVMModule*>(JSValue::decode(thisValue));
    if (UNLIKELY(!thisObject)) {
        throwVMError(globalObject, scope, "Receiver must be a Module instance"_s);
        return {};
    }

    // TODO: Return actual error
    return JSValue::encode(jsUndefined());
}

// Function implementations
JSC_DEFINE_HOST_FUNCTION(jsNodeVMModuleProtoFuncLink, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    NodeVMModule* thisObject = jsDynamicCast<NodeVMModule*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        throwVMError(globalObject, scope, "Receiver must be a Module instance"_s);
        return {};
    }

    // TODO: Implement link functionality
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsNodeVMModuleProtoFuncEvaluate, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    NodeVMModule* thisObject = jsDynamicCast<NodeVMModule*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        throwVMError(globalObject, scope, "Receiver must be a Module instance"_s);
        return {};
    }

    // TODO: Implement evaluate functionality
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsNodeVMModuleProtoFuncInspectCustom, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    NodeVMModule* thisObject = jsDynamicCast<NodeVMModule*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        throwVMError(globalObject, scope, "Receiver must be a Module instance"_s);
        return {};
    }

    // TODO: Implement custom inspect
    return JSValue::encode(jsUndefined());
}

// Constructor function implementations
JSC_DEFINE_HOST_FUNCTION(callNodeVMModule, (JSGlobalObject * globalObject, CallFrame*))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    return throwVMError(globalObject, scope, "Module constructor cannot be called without 'new'"_s);
}

JSC_DEFINE_HOST_FUNCTION(constructNodeVMModule, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    // Must be called with new
    JSValue newTarget = callFrame->newTarget();
    if (!newTarget) {
        throwTypeError(globalObject, scope, "Module is not a constructor"_s);
        return {};
    }

    // Check if we have at least one argument (options object)
    if (callFrame->argumentCount() < 1) {
        return ERR::INVALID_ARG_TYPE(scope, globalObject, "options"_s, "object"_s, callFrame->uncheckedArgument(0));
    }

    JSValue optionsValue = callFrame->uncheckedArgument(0);
    if (!optionsValue.isObject()) {
        return ERR::INVALID_ARG_TYPE(scope, globalObject, "options"_s, "object"_s, optionsValue);
    }

    auto* zigGlobalObject = defaultGlobalObject(globalObject);
    JSObject* options = optionsValue.getObject();

    // Get context option
    JSValue contextValue = options->get(globalObject, JSC::Identifier::fromString(vm, "context"_s));
    RETURN_IF_EXCEPTION(scope, {});

    JSObject* context = nullptr;
    if (!contextValue.isUndefined()) {
        if (!contextValue.isObject()) {
            return ERR::INVALID_ARG_TYPE(scope, globalObject, "options.context"_s, "vm.Context"_s, contextValue);
        }
        context = contextValue.getObject();

        if (!zigGlobalObject->vmModuleContextMap()->has(context)) {
            return ERR::INVALID_ARG_TYPE(scope, globalObject, "options.context"_s, "vm.Context"_s, contextValue);
        }
    }

    // Get identifier option
    JSValue identifierValue = options->get(globalObject, JSC::Identifier::fromString(vm, "identifier"_s));
    RETURN_IF_EXCEPTION(scope, {});

    String identifier;
    if (!identifierValue.isUndefined()) {
        if (!identifierValue.isString()) {
            return ERR::INVALID_ARG_TYPE(scope, globalObject, "options.identifier"_s, "string"_s, identifierValue);
        }
        identifier = identifierValue.getString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
    }

    Structure* structure = zigGlobalObject->NodeVMModuleStructure();

    if (UNLIKELY(zigGlobalObject->NodeVMModuleConstructor() != newTarget)) {
        if (!newTarget) {
            throwTypeError(globalObject, scope, "Class constructor Module cannot be invoked without 'new'"_s);
            return {};
        }

        auto* functionGlobalObject = defaultGlobalObject(getFunctionRealm(globalObject, newTarget.getObject()));
        RETURN_IF_EXCEPTION(scope, {});
        structure = InternalFunction::createSubclassStructure(
            globalObject, newTarget.getObject(), functionGlobalObject->NodeVMModuleStructure());
        RETURN_IF_EXCEPTION(scope, {});
    }

    // Get sourceText and synthetic options
    JSValue sourceTextValue = options->get(globalObject, JSC::Identifier::fromString(vm, "sourceText"_s));
    RETURN_IF_EXCEPTION(scope, {});

    JSValue syntheticExportNamesValue = options->get(globalObject, JSC::Identifier::fromString(vm, "syntheticExportNames"_s));
    RETURN_IF_EXCEPTION(scope, {});

    JSValue syntheticEvaluationStepsValue = options->get(globalObject, JSC::Identifier::fromString(vm, "syntheticEvaluationSteps"_s));
    RETURN_IF_EXCEPTION(scope, {});

    // Handle source text case
    if (!sourceTextValue.isUndefined()) {
        if (!sourceTextValue.isString()) {
            return ERR::INVALID_ARG_TYPE(scope, globalObject, "options.sourceText"_s, "string"_s, sourceTextValue);
        }

        String sourceText = sourceTextValue.getString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});

        // Get line and column offsets
        JSValue lineOffsetValue = options->get(globalObject, JSC::Identifier::fromString(vm, "lineOffset"_s));
        RETURN_IF_EXCEPTION(scope, {});

        JSValue columnOffsetValue = options->get(globalObject, JSC::Identifier::fromString(vm, "columnOffset"_s));
        RETURN_IF_EXCEPTION(scope, {});

        int32_t lineOffset = 0;
        int32_t columnOffset = 0;

        if (!lineOffsetValue.isUndefined()) {

            lineOffset = lineOffsetValue.asInt32();
            RETURN_IF_EXCEPTION(scope, {});
        }

        if (!columnOffsetValue.isUndefined()) {
            if (!columnOffsetValue.isNumber()) {
                return ERR::INVALID_ARG_TYPE(scope, globalObject, "options.columnOffset"_s, "number"_s, columnOffsetValue);
            }
            columnOffset = columnOffsetValue.asInt32();
            RETURN_IF_EXCEPTION(scope, {});
        }

        // Get optional cachedData
        JSValue cachedDataValue = options->get(globalObject, JSC::Identifier::fromString(vm, "cachedData"_s));
        RETURN_IF_EXCEPTION(scope, {});
        UNUSED_PARAM(cachedDataValue);

        // RefPtr<Uint8Array> cachedData;
        // if (!cachedDataValue.isUndefined()) {
        //     if (!cachedDataValue.isObject()) {
        //         return ERR::INVALID_ARG_TYPE(scope, globalObject, "options.cachedData"_s, "Uint8Array"_s, cachedDataValue);
        //     }
        //     JSObject* obj = cachedDataValue.getObject();
        //     auto* uint8Array = jsDynamicCast<JSUint8Array*>(obj);
        //     if (!uint8Array) {
        //         return ERR::INVALID_ARG_TYPE(scope, globalObject, "options.cachedData"_s, "Uint8Array"_s, cachedDataValue);
        //     }
        //     cachedData = jsDynamicCast<JSUint8Array*>(obj);
        // }

        // Get optional importModuleDynamically and initializeImportMeta callbacks
        JSValue importModuleDynamicallyValue = options->get(globalObject, JSC::Identifier::fromString(vm, "importModuleDynamically"_s));
        RETURN_IF_EXCEPTION(scope, {});

        JSValue initializeImportMetaValue = options->get(globalObject, JSC::Identifier::fromString(vm, "initializeImportMeta"_s));
        RETURN_IF_EXCEPTION(scope, {});

        JSObject* importModuleDynamically = nullptr;
        if (!importModuleDynamicallyValue.isUndefined()) {
            if (!importModuleDynamicallyValue.isObject() || !importModuleDynamicallyValue.getObject()->isCallable()) {
                return ERR::INVALID_ARG_TYPE(scope, globalObject, "options.importModuleDynamically"_s, "function"_s, importModuleDynamicallyValue);
            }
            importModuleDynamically = importModuleDynamicallyValue.getObject();
        }

        JSObject* initializeImportMeta = nullptr;
        if (!initializeImportMetaValue.isUndefined()) {
            if (!initializeImportMetaValue.isObject() || !initializeImportMetaValue.getObject()->isCallable()) {
                return ERR::INVALID_ARG_TYPE(scope, globalObject, "options.initializeImportMeta"_s, "function"_s, initializeImportMetaValue);
            }
            initializeImportMeta = initializeImportMetaValue.getObject();
        }

        String moduleId = identifier.isEmpty() ? makeString("vm:module("_s, String::number(globalModuleId++), ")"_s) : identifier;

        // Create source provider
        TextPosition startPosition(OrdinalNumber::fromOneBasedInt(lineOffset + 1), OrdinalNumber::fromZeroBasedInt(columnOffset));
        URL moduleURL = URL::fileURLWithFileSystemPath(moduleId);
        auto sourceProvider = StringSourceProvider::create(sourceText, SourceOrigin(moduleURL), moduleId, SourceTaintedOrigin::Untainted, startPosition, SourceProviderSourceType::Module);

        return JSValue::encode(NodeVMModule::create(vm, structure, globalObject, context,
            moduleId, WTFMove(sourceProvider), nullptr, importModuleDynamically, initializeImportMeta));
    }

    // Handle synthetic module case
    if (!syntheticEvaluationStepsValue.isUndefined()) {
        if (!syntheticExportNamesValue.isObject() || !isJSArray(syntheticExportNamesValue.getObject())) {
            return ERR::INVALID_ARG_TYPE(scope, globalObject, "options.syntheticExportNames"_s, "Array"_s, syntheticExportNamesValue);
        }

        if (!syntheticEvaluationStepsValue.isObject() || !syntheticEvaluationStepsValue.getObject()->isCallable()) {
            return ERR::INVALID_ARG_TYPE(scope, globalObject, "options.syntheticEvaluationSteps"_s, "function"_s, syntheticEvaluationStepsValue);
        }

        JSArray* syntheticExportNames = jsCast<JSArray*>(syntheticExportNamesValue);
        JSObject* syntheticEvaluationSteps = syntheticEvaluationStepsValue.getObject();

        String moduleId = identifier.isEmpty() ? makeString("vm:module("_s, String::number(globalModuleId++), ")"_s) : identifier;

        return JSValue::encode(NodeVMModule::create(vm, structure, globalObject, context,
            moduleId, syntheticExportNames, syntheticEvaluationSteps));
    }

    // If we get here, neither sourceText nor synthetic options were provided
    String moduleId;
    if (identifier.isEmpty()) {
        if (context) {
            JSValue perContextModuleId = context->get(globalObject, JSC::Identifier::fromString(vm, "kPerContextModuleId"_s));
            RETURN_IF_EXCEPTION(scope, {});

            uint32_t id = 0;
            if (perContextModuleId.isUndefined()) {
                context->putDirect(vm, JSC::Identifier::fromString(vm, "kPerContextModuleId"_s), jsNumber(1));
            } else {
                id = static_cast<uint32_t>(perContextModuleId.asNumber());
                RETURN_IF_EXCEPTION(scope, {});
                context->putDirect(vm, JSC::Identifier::fromString(vm, "kPerContextModuleId"_s), jsNumber(id + 1));
            }
            moduleId = makeString("vm:module("_s, String::number(id), ")"_s);
        } else {
            moduleId = makeString("vm:module("_s, String::number(globalModuleId++), ")"_s);
        }
    } else {
        moduleId = identifier;
    }

    // Create empty module with an empty source provider
    URL emptyModuleURL = URL::fileURLWithFileSystemPath(moduleId);
    auto emptySourceProvider = StringSourceProvider::create(""_s, SourceOrigin(emptyModuleURL), moduleId, SourceTaintedOrigin::Untainted, TextPosition(), SourceProviderSourceType::Module);
    return JSValue::encode(NodeVMModule::create(vm, structure, globalObject, context,
        moduleId, WTFMove(emptySourceProvider), nullptr, nullptr, nullptr));
}

template<typename Visitor>
void NodeVMModule::visitAdditionalChildren(Visitor& visitor)
{
    visitor.append(m_context);
    visitor.append(m_syntheticExportNames);
    visitor.append(m_syntheticEvaluationSteps);
    visitor.append(m_moduleRecord);
}

template<typename Visitor>
void NodeVMModule::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* thisObject = jsCast<NodeVMModule*>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    thisObject->visitAdditionalChildren(visitor);
}

DEFINE_VISIT_CHILDREN(NodeVMModule);

template<typename Visitor>
void NodeVMModule::visitOutputConstraintsImpl(JSCell* cell, Visitor& visitor)
{
    auto* thisObject = jsCast<NodeVMModule*>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitOutputConstraints(thisObject, visitor);
    thisObject->visitAdditionalChildren(visitor);
}

DEFINE_VISIT_OUTPUT_CONSTRAINTS(NodeVMModule);

// Setup function for class structure
void setupNodeVMModuleClassStructure(LazyClassStructure::Initializer& init)
{
    auto* prototypeStructure = NodeVMModulePrototype::createStructure(
        init.vm, init.global, init.global->objectPrototype());
    auto* prototype = NodeVMModulePrototype::create(init.vm, init.global, prototypeStructure);

    auto* constructorStructure = NodeVMModuleConstructor::createStructure(
        init.vm, init.global, init.global->functionPrototype());
    auto* constructor = NodeVMModuleConstructor::create(
        init.vm, constructorStructure, prototype);

    auto* structure = NodeVMModule::createStructure(init.vm, init.global, prototype);

    init.setPrototype(prototype);
    init.setStructure(structure);
    init.setConstructor(constructor);
}

// Module evaluation implementation
JSValue NodeVMModule::evaluateModule(JSGlobalObject* globalObject, JSValue key, JSValue moduleRecordValue, JSValue scriptFetcher, JSValue sentValue, JSValue resumeMode)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    // Handle synthetic modules
    if (m_syntheticEvaluationSteps) {
        JSObject* function = m_syntheticEvaluationSteps.get();
        JSC::CallData callData = JSC::getCallData(function);
        if (callData.type == JSC::CallData::Type::None) {
            throwTypeError(globalObject, scope, "Synthetic evaluation steps must be callable"_s);
            return jsUndefined();
        }

        MarkedArgumentBuffer args;
        args.append(m_syntheticExportNames.get());
        ASSERT(!args.hasOverflowed());

        JSValue result = JSC::profiledCall(globalObject, JSC::ProfilingReason::API, function, callData, this, args);
        RETURN_IF_EXCEPTION(scope, {});
        return result;
    }

    // Handle source text modules
    if (auto* moduleRecord = jsDynamicCast<AbstractModuleRecord*>(moduleRecordValue)) {
        auto* moduleLoader = globalObject->moduleLoader();
        if (!moduleLoader) {
            throwTypeError(globalObject, scope, "Module loader not found"_s);
            return jsUndefined();
        }

        moduleLoader->evaluateNonVirtual(globalObject, key, moduleRecordValue, scriptFetcher, sentValue, resumeMode);
        RETURN_IF_EXCEPTION(scope, {});

        JSModuleNamespaceObject* namespaceObject = moduleLoader->getModuleNamespaceObject(globalObject, moduleRecord);
        RETURN_IF_EXCEPTION(scope, {});

        return namespaceObject;
    }

    return jsUndefined();
}

// Dynamic import implementation
JSValue NodeVMModule::importModuleDynamically(JSGlobalObject* globalObject, JSValue key, JSValue moduleRecordValue, JSValue scriptFetcher)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* promise = JSInternalPromise::create(vm, globalObject->internalPromiseStructure());

    if (auto* moduleRecord = jsDynamicCast<AbstractModuleRecord*>(moduleRecordValue)) {
        auto* moduleLoader = globalObject->moduleLoader();
        if (!moduleLoader) {
            throwTypeError(globalObject, scope, "Module loader not found"_s);
            return promise;
        }

        // auto* importPromise = moduleLoader->requestImportModule(globalObject, moduleRecord, key, scriptFetcher, jsUndefined());
        RETURN_IF_EXCEPTION(scope, promise);

        return importPromise;
    }

    return promise;
}

} // namespace Bun
