#include "root.h"

#include "ModuleGraph.h"

#include "ErrorCode.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/AbstractModuleRecord.h>
#include <JavaScriptCore/ErrorInstance.h>
#include <JavaScriptCore/Exception.h>
#include <JavaScriptCore/InternalFunction.h>
#include <JavaScriptCore/JSCallee.h>
#include <JavaScriptCore/JSFunction.h>
#include <JavaScriptCore/JSLexicalEnvironmentInlines.h>
#include <JavaScriptCore/JSModuleEnvironment.h>
#include <JavaScriptCore/JSPromise.h>
#include <JavaScriptCore/JSWeakMapInlines.h>
#include <JavaScriptCore/LazyClassStructureInlines.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/PropertyNameArray.h>
#include <JavaScriptCore/StackVisitor.h>
#include <JavaScriptCore/SymbolTable.h>
#include <wtf/SetForScope.h>
#include <wtf/text/StringBuilder.h>

namespace Bun {

using namespace JSC;

static JSC_DECLARE_HOST_FUNCTION(jsModuleGraphProtoFuncImport);
static JSC_DECLARE_HOST_FUNCTION(jsModuleGraphProtoFuncDispose);
static JSC_DECLARE_CUSTOM_GETTER(jsModuleGraphGetter_mainModule);
static JSC_DECLARE_HOST_FUNCTION(callModuleGraph);
static JSC_DECLARE_HOST_FUNCTION(constructModuleGraph);

JSModuleGraph* JSModuleGraph::create(VM& vm, Structure* structure, JSModuleLoader* loader, JSValue onError)
{
    auto* graph = new (NotNull, allocateCell<JSModuleGraph>(vm)) JSModuleGraph(vm, structure, loader, onError);
    graph->finishCreation(vm);
    return graph;
}

JSModuleGraph* JSModuleGraph::forLoader(Zig::GlobalObject* globalObject, JSModuleLoader* loader)
{
    if (loader == globalObject->moduleLoader()) [[likely]]
        return nullptr;
    if (!globalObject->m_moduleGraphsByLoader.isInitialized())
        return nullptr;
    return dynamicDowncast<JSModuleGraph>(globalObject->m_moduleGraphsByLoader.get(globalObject)->get(loader));
}

JSModuleGraph* JSModuleGraph::forCallee(Zig::GlobalObject* globalObject, JSCell* callee)
{
    auto* jsCallee = callee ? dynamicDowncast<JSCallee>(callee) : nullptr;
    if (!jsCallee)
        return nullptr;
    if (auto* function = dynamicDowncast<JSFunction>(jsCallee); function && function->isHostOrBuiltinFunction())
        return nullptr;
    for (JSScope* scope = jsCallee->scope(); scope; scope = scope->next()) {
        if (auto* environment = dynamicDowncast<JSModuleEnvironment>(scope))
            return forLoader(globalObject, environment->moduleRecord()->moduleLoader());
    }
    return nullptr;
}

JSModuleGraph* JSModuleGraph::forStack(Zig::GlobalObject* globalObject, const Vector<StackFrame>& stack)
{
    for (auto& frame : stack) {
        if (auto* graph = forCallee(globalObject, frame.callee()))
            return graph;
    }
    return nullptr;
}

JSModuleGraph* JSModuleGraph::forErrorValue(Zig::GlobalObject* globalObject, JSValue error)
{
    auto* errorInstance = dynamicDowncast<ErrorInstance>(error);
    if (!errorInstance || !errorInstance->stackTrace())
        return nullptr;
    return forStack(globalObject, *errorInstance->stackTrace());
}

// The exception that carried `value`, if it is the one thrown last: whoever caught it may have kept only the value.
// Always forgets it, so that it cannot be matched against an unrelated later report of the same value.
static JSModuleGraph* forLastException(Zig::GlobalObject* globalObject, JSValue value)
{
    VM& vm = globalObject->vm();
    auto* exception = vm.lastException();
    auto* graph = exception && exception->value() == value ? JSModuleGraph::forStack(globalObject, exception->stack()) : nullptr;
    vm.clearLastException();
    return graph;
}

void JSModuleGraph::noteRejection(Zig::GlobalObject* globalObject, JSPromise* promise)
{
    if (!globalObject->m_moduleGraphsByLoader.isInitialized()) [[likely]]
        return;
    // What a graph's code rejects while it runs as an onError is reported process-wide, like what onError throws.
    if (globalObject->m_isReportingModuleGraphError)
        return;
    VM& vm = globalObject->vm();
    JSModuleGraph* graph = nullptr;
    StackVisitor::visit(vm.topCallFrame, vm, [&](StackVisitor& visitor) {
        if (visitor->isNativeCalleeFrame() || !visitor->callee().isCell())
            return IterationStatus::Continue;
        graph = forCallee(globalObject, visitor->callee().asCell());
        return graph ? IterationStatus::Done : IterationStatus::Continue;
    });
    // A module body or async function that threw has unwound by the time its promise is rejected.
    auto* lastExceptionGraph = forLastException(globalObject, promise->result());
    if (!graph)
        graph = lastExceptionGraph;
    if (!graph)
        graph = forErrorValue(globalObject, promise->result());
    if (graph && !graph->onError().isUndefined())
        globalObject->m_moduleGraphsByRejectedPromise.get(globalObject)->set(vm, promise, graph);
}

bool JSModuleGraph::reportRejection(Zig::GlobalObject* globalObject, JSPromise* promise)
{
    if (!globalObject->m_moduleGraphsByRejectedPromise.isInitialized()) [[likely]]
        return false;
    auto* graph = dynamicDowncast<JSModuleGraph>(globalObject->m_moduleGraphsByRejectedPromise.get(globalObject)->get(promise));
    return graph && graph->reportError(globalObject, promise->result());
}

bool JSModuleGraph::forgetReportedRejection(Zig::GlobalObject* globalObject, JSPromise* promise)
{
    if (!globalObject->m_moduleGraphsByRejectedPromise.isInitialized()) [[likely]]
        return false;
    return globalObject->m_moduleGraphsByRejectedPromise.get(globalObject)->remove(promise);
}

bool JSModuleGraph::reportError(Zig::GlobalObject* globalObject, JSValue error)
{
    JSValue onError = m_onError.get();
    if (onError.isUndefined())
        return false;

    VM& vm = globalObject->vm();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    MarkedArgumentBuffer arguments;
    arguments.append(error);
    // What onError throws must not come back to a graph's onError.
    SetForScope reporting(globalObject->m_isReportingModuleGraphError, true);
    JSC::profiledCall(globalObject, ProfilingReason::API, onError, JSC::getCallData(onError), jsUndefined(), arguments);
    if (auto* exception = scope.exception()) {
        if (!vm.isTerminationException(exception)) {
            (void)scope.tryClearException();
            Zig::GlobalObject::reportUncaughtExceptionAtEventLoop(globalObject, exception);
        }
    }
    return true;
}

// For VirtualMachine::uncaught_exception. True when `error` was thrown by a graph's code and
// that graph's onError took it.
extern "C" bool Bun__ModuleGraph__handleUncaughtException(Zig::GlobalObject* globalObject, EncodedJSValue encodedError)
{
    if (!globalObject->m_moduleGraphsByLoader.isInitialized() || globalObject->m_isReportingModuleGraphError) [[likely]]
        return false;
    JSValue error = JSValue::decode(encodedError);
    JSModuleGraph* graph = nullptr;
    if (auto* exception = dynamicDowncast<JSC::Exception>(error)) {
        graph = JSModuleGraph::forStack(globalObject, exception->stack());
        error = exception->value();
    }
    auto* lastExceptionGraph = forLastException(globalObject, error);
    if (!graph)
        graph = lastExceptionGraph;
    if (!graph)
        graph = JSModuleGraph::forErrorValue(globalObject, error);
    return graph && graph->reportError(globalObject, error);
}

void JSModuleGraph::dispose()
{
    if (m_disposed)
        return;
    m_disposed = true;
    m_loader->clearAll(); // takes the loader's cellLock itself
}

template<typename Visitor>
void JSModuleGraph::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* thisObject = uncheckedDowncast<JSModuleGraph>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    visitor.append(thisObject->m_loader);
    visitor.append(thisObject->m_onError);
    visitor.append(thisObject->m_mainModule);
}

DEFINE_VISIT_CHILDREN(JSModuleGraph);

const ClassInfo JSModuleGraph::s_info = { "ModuleGraph"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSModuleGraph) };

SymbolTable* ModuleGraphSymbolTables::getOrCreate(VM& vm, const Vector<Identifier>& sortedNames)
{
    // createModuleScope() relies on name `i` being variable `i`.
    // Length-prefixed, so no name can run into its neighbour whatever characters it holds.
    StringBuilder keyBuilder;
    for (auto& name : sortedNames)
        keyBuilder.append(name.length(), ':', name.string());
    String key = keyBuilder.toString();

    if (auto it = m_tables.find(key); it != m_tables.end()) {
        if (auto* table = it->value.get())
            return table;
    }

    m_tables.removeIf([](auto& entry) { return !entry.value; });

    SymbolTable* table = SymbolTable::create(vm);
    for (auto& name : sortedNames)
        table->add(NoLockingNecessary, name.impl(), SymbolTableEntry(VarOffset(table->takeNextScopeOffset(NoLockingNecessary))));
    m_tables.set(WTF::move(key), Weak<SymbolTable>(table));
    return table;
}

class JSModuleGraphPrototype final : public JSNonFinalObject {
public:
    using Base = JSNonFinalObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSModuleGraphPrototype* create(VM& vm, JSGlobalObject*, Structure* structure)
    {
        auto* prototype = new (NotNull, allocateCell<JSModuleGraphPrototype>(vm)) JSModuleGraphPrototype(vm, structure);
        prototype->finishCreation(vm);
        return prototype;
    }

    template<typename, SubspaceAccess>
    static GCClient::IsoSubspace* subspaceFor(VM& vm)
    {
        STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSModuleGraphPrototype, Base);
        return &vm.plainObjectSpace();
    }

    DECLARE_INFO;

    static Structure* createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
    {
        auto* structure = Structure::create(vm, globalObject, prototype, TypeInfo(ObjectType, StructureFlags), info());
        structure->setMayBePrototype(true);
        return structure;
    }

private:
    JSModuleGraphPrototype(VM& vm, Structure* structure)
        : Base(vm, structure)
    {
    }

    void finishCreation(VM&);
};

static const HashTableValue JSModuleGraphPrototypeTableValues[] = {
    { "import"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsModuleGraphProtoFuncImport, 1 } },
    { "dispose"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsModuleGraphProtoFuncDispose, 0 } },
    { "mainModule"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsModuleGraphGetter_mainModule, 0 } },
};

void JSModuleGraphPrototype::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    reifyStaticProperties(vm, JSModuleGraph::info(), JSModuleGraphPrototypeTableValues, *this);
    putDirectWithoutTransition(vm, vm.propertyNames->disposeSymbol, getDirect(vm, Identifier::fromString(vm, "dispose"_s)), static_cast<unsigned>(PropertyAttribute::DontEnum));
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}

const ClassInfo JSModuleGraphPrototype::s_info = { "ModuleGraph"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSModuleGraphPrototype) };

class JSModuleGraphConstructor final : public InternalFunction {
public:
    using Base = InternalFunction;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSModuleGraphConstructor* create(VM& vm, Structure* structure, JSObject* prototype)
    {
        auto* constructor = new (NotNull, allocateCell<JSModuleGraphConstructor>(vm)) JSModuleGraphConstructor(vm, structure);
        constructor->finishCreation(vm, prototype);
        return constructor;
    }

    DECLARE_INFO;

    template<typename, SubspaceAccess>
    static GCClient::IsoSubspace* subspaceFor(VM& vm) { return &vm.internalFunctionSpace(); }

    static Structure* createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
    {
        return Structure::create(vm, globalObject, prototype, TypeInfo(InternalFunctionType, StructureFlags), info());
    }

private:
    JSModuleGraphConstructor(VM& vm, Structure* structure)
        : Base(vm, structure, callModuleGraph, constructModuleGraph)
    {
    }

    void finishCreation(VM& vm, JSObject* prototype)
    {
        Base::finishCreation(vm, 0, "ModuleGraph"_s);
        putDirectWithoutTransition(vm, vm.propertyNames->prototype, prototype, PropertyAttribute::DontEnum | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly);
    }
};

const ClassInfo JSModuleGraphConstructor::s_info = { "ModuleGraph"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSModuleGraphConstructor) };

JSC_DEFINE_HOST_FUNCTION(callModuleGraph, (JSGlobalObject * globalObject, CallFrame*))
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    throwTypeError(globalObject, scope, "Class constructor ModuleGraph cannot be invoked without 'new'"_s);
    return {};
}

// The scope a graph's module environments are created in: the global lexical environment, or
// for a graph with `globals`, one lexical environment in front of it holding those names.
static JSScope* createModuleScope(Zig::GlobalObject* globalObject, ThrowScope& scope, JSObject* globals)
{
    VM& vm = globalObject->vm();
    JSScope* globalScope = globalObject->globalLexicalEnvironment();
    if (!globals)
        return globalScope;

    PropertyNameArrayBuilder builder(vm, PropertyNameMode::Strings, PrivateSymbolMode::Exclude);
    globals->methodTable()->getOwnPropertyNames(globals, globalObject, builder, DontEnumPropertiesMode::Exclude);
    RETURN_IF_EXCEPTION(scope, nullptr);
    if (!builder.size())
        return globalScope;

    // Values are read in property order, like Object.entries(). The symbol table is in sorted order, so that one set
    // of names is one table whatever order they were written in: variable `i` is the i-th name in sorted order.
    MarkedArgumentBuffer values;
    for (auto& name : builder) {
        // The language treats these three as constants, and so does the transpiler: it folds them and prints them.
        if (name == vm.propertyNames->undefinedKeyword || name == vm.propertyNames->NaN || name == vm.propertyNames->Infinity) {
            ERR::INVALID_ARG_VALUE(scope, globalObject, "options.globals"_s, jsString(vm, name.string()), "cannot be the name of a graph global"_s);
            return nullptr;
        }
        JSValue value = globals->get(globalObject, name);
        RETURN_IF_EXCEPTION(scope, nullptr);
        values.append(value);
    }

    Vector<unsigned> sortedIndices(builder.size(), [](size_t i) { return static_cast<unsigned>(i); });
    std::ranges::sort(sortedIndices, [&](unsigned a, unsigned b) {
        return codePointCompareLessThan(builder[a].string(), builder[b].string());
    });
    Vector<Identifier> sortedNames(builder.size(), [&](size_t i) { return builder[sortedIndices[i]]; });

    if (!globalObject->m_moduleGraphSymbolTables)
        globalObject->m_moduleGraphSymbolTables = makeUnique<ModuleGraphSymbolTables>();
    SymbolTable* symbolTable = globalObject->m_moduleGraphSymbolTables->getOrCreate(vm, sortedNames);

    auto* environment = JSLexicalEnvironment::create(vm, globalObject, globalScope, symbolTable, jsUndefined());
    for (unsigned i = 0; i < sortedIndices.size(); ++i)
        environment->variableAt(ScopeOffset(i)).set(vm, environment, values.at(sortedIndices[i]));
    return environment;
}

JSC_DEFINE_HOST_FUNCTION(constructModuleGraph, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    VM& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);

    Structure* structure = globalObject->m_JSModuleGraphClassStructure.get(globalObject);
    JSValue newTarget = callFrame->newTarget();
    if (globalObject->m_JSModuleGraphClassStructure.constructor(globalObject) != newTarget) [[unlikely]] {
        auto* functionGlobalObject = defaultGlobalObject(getFunctionRealm(lexicalGlobalObject, newTarget.getObject()));
        RETURN_IF_EXCEPTION(scope, {});
        structure = InternalFunction::createSubclassStructure(lexicalGlobalObject, newTarget.getObject(), functionGlobalObject->m_JSModuleGraphClassStructure.get(functionGlobalObject));
        RETURN_IF_EXCEPTION(scope, {});
    }

    JSObject* globals = nullptr;
    JSValue onError = jsUndefined();
    JSValue optionsValue = callFrame->argument(0);
    if (!optionsValue.isUndefined()) {
        JSObject* options = optionsValue.getObject();
        if (!options)
            return ERR::INVALID_ARG_TYPE(scope, lexicalGlobalObject, "options"_s, "object"_s, optionsValue);

        JSValue globalsValue = options->get(lexicalGlobalObject, Identifier::fromString(vm, "globals"_s));
        RETURN_IF_EXCEPTION(scope, {});
        if (!globalsValue.isUndefined()) {
            globals = globalsValue.getObject();
            if (!globals)
                return ERR::INVALID_ARG_TYPE(scope, lexicalGlobalObject, "options.globals"_s, "object"_s, globalsValue);
        }

        onError = options->get(lexicalGlobalObject, Identifier::fromString(vm, "onError"_s));
        RETURN_IF_EXCEPTION(scope, {});
        if (!onError.isUndefined() && !onError.isCallable())
            return ERR::INVALID_ARG_TYPE(scope, lexicalGlobalObject, "options.onError"_s, "function"_s, onError);
    }

    JSScope* moduleScope = createModuleScope(globalObject, scope, globals);
    RETURN_IF_EXCEPTION(scope, {});

    auto* loader = JSModuleLoader::create(globalObject, vm, moduleScope);
    auto* graph = JSModuleGraph::create(vm, structure, loader, onError);
    globalObject->m_moduleGraphsByLoader.get(globalObject)->set(vm, loader, graph);
    return JSValue::encode(graph);
}

JSC_DEFINE_HOST_FUNCTION(jsModuleGraphProtoFuncImport, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    VM& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* graph = dynamicDowncast<JSModuleGraph>(callFrame->thisValue());
    if (!graph) [[unlikely]]
        return throwVMTypeError(lexicalGlobalObject, scope, "ModuleGraph.prototype.import called on an incompatible receiver"_s);

    auto* globalObject = defaultGlobalObject(graph->globalObject());
    // Not a GCOwnedDataScope: requestImportModule below can drive moduleLoaderFetch synchronously; see that function for why no scope may be live.
    String specifier = callFrame->argument(0).toWTFString(lexicalGlobalObject);
    RETURN_IF_EXCEPTION(scope, JSValue::encode(JSPromise::rejectedPromiseWithCaughtException(globalObject, scope)));

    // After the conversion, which runs user code that may dispose the graph.
    if (graph->isDisposed()) {
        ERR::INVALID_STATE(scope, globalObject, "import() from a disposed ModuleGraph"_s);
        return JSValue::encode(JSPromise::rejectedPromiseWithCaughtException(globalObject, scope));
    }

    int64_t referrerAsyncOrder;
    Identifier key = Zig::GlobalObject::resolveImportSpecifier(globalObject, graph->loader(), WTF::move(specifier), callFrame->callerSourceOrigin(vm), referrerAsyncOrder);
    RETURN_IF_EXCEPTION(scope, JSValue::encode(JSPromise::rejectedPromiseWithCaughtException(globalObject, scope)));

    graph->setMainModuleIfUnset(vm, jsString(vm, key.string()));

    // The caller is not one of the graph's modules, so its async evaluation order means nothing to the graph's loader.
    JSPromise* importPromise = graph->loader()->requestImportModule(globalObject, key, Identifier(), nullptr, nullptr);
    RETURN_IF_EXCEPTION(scope, JSValue::encode(JSPromise::rejectedPromiseWithCaughtException(globalObject, scope)));

    // The loader's promise is marked as handled. Like import() (globalFuncImportModule), hand out one that is not,
    // so that a failure nobody handles is an unhandled rejection.
    scope.release();
    auto* promise = JSPromise::create(vm, globalObject->promiseStructure());
    if (importPromise->status() == JSPromise::Status::Fulfilled)
        promise->fulfill(vm, importPromise->result());
    else
        promise->resolve(globalObject, vm, importPromise);
    return JSValue::encode(promise);
}

JSC_DEFINE_HOST_FUNCTION(jsModuleGraphProtoFuncDispose, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto scope = DECLARE_THROW_SCOPE(lexicalGlobalObject->vm());
    auto* graph = dynamicDowncast<JSModuleGraph>(callFrame->thisValue());
    if (!graph) [[unlikely]]
        return throwVMTypeError(lexicalGlobalObject, scope, "ModuleGraph.prototype.dispose called on an incompatible receiver"_s);
    graph->dispose();
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_CUSTOM_GETTER(jsModuleGraphGetter_mainModule, (JSGlobalObject * lexicalGlobalObject, EncodedJSValue thisValue, PropertyName))
{
    auto scope = DECLARE_THROW_SCOPE(lexicalGlobalObject->vm());
    auto* graph = dynamicDowncast<JSModuleGraph>(JSValue::decode(thisValue));
    if (!graph) [[unlikely]]
        return throwVMTypeError(lexicalGlobalObject, scope, "ModuleGraph.prototype.mainModule called on an incompatible receiver"_s);
    auto* mainModule = graph->mainModule();
    return JSValue::encode(mainModule ? JSValue(mainModule) : jsUndefined());
}

void initJSModuleGraphClassStructure(LazyClassStructure::Initializer& init)
{
    auto* prototype = JSModuleGraphPrototype::create(init.vm, init.global, JSModuleGraphPrototype::createStructure(init.vm, init.global, init.global->objectPrototype()));
    auto* structure = JSModuleGraph::createStructure(init.vm, init.global, prototype);
    auto* constructor = JSModuleGraphConstructor::create(init.vm, JSModuleGraphConstructor::createStructure(init.vm, init.global, init.global->functionPrototype()), prototype);
    init.setPrototype(prototype);
    init.setStructure(structure);
    init.setConstructor(constructor);
}

extern "C" EncodedJSValue Bun__ModuleGraph__getConstructor(Zig::GlobalObject* globalObject)
{
    return JSValue::encode(globalObject->m_JSModuleGraphClassStructure.constructor(globalObject));
}

} // namespace Bun
