#include "NodeVMScript.h"

#include "ErrorCode.h"

#include "JavaScriptCore/Completion.h"
#include "JavaScriptCore/JIT.h"
#include "JavaScriptCore/JSWeakMap.h"
#include "JavaScriptCore/JSWeakMapInlines.h"
#include "JavaScriptCore/ProgramCodeBlock.h"
#include "JavaScriptCore/SourceCodeKey.h"

#include "NodeVMScriptFetcher.h"
#include "../vm/SigintWatcher.h"

#include <bit>

namespace Bun {
using namespace NodeVM;

bool ScriptOptions::fromJS(JSC::JSGlobalObject* globalObject, JSC::VM& vm, JSC::ThrowScope& scope, JSC::JSValue optionsArg, JSValue* importer)
{
    if (importer) {
        *importer = jsUndefined();
    }

    bool any = BaseVMOptions::fromJS(globalObject, vm, scope, optionsArg);
    RETURN_IF_EXCEPTION(scope, false);

    if (!optionsArg.isUndefined() && !optionsArg.isString()) {
        JSObject* options = asObject(optionsArg);

        // Validate contextName and contextOrigin are strings
        auto contextNameOpt = options->getIfPropertyExists(globalObject, Identifier::fromString(vm, "contextName"_s));
        RETURN_IF_EXCEPTION(scope, false);
        if (contextNameOpt) {
            if (!contextNameOpt.isUndefined() && !contextNameOpt.isString()) {
                ERR::INVALID_ARG_TYPE(scope, globalObject, "options.contextName"_s, "string"_s, contextNameOpt);
                return false;
            }
            any = true;
        }

        auto contextOriginOpt = options->getIfPropertyExists(globalObject, Identifier::fromString(vm, "contextOrigin"_s));
        RETURN_IF_EXCEPTION(scope, false);
        if (contextOriginOpt) {
            if (!contextOriginOpt.isUndefined() && !contextOriginOpt.isString()) {
                ERR::INVALID_ARG_TYPE(scope, globalObject, "options.contextOrigin"_s, "string"_s, contextOriginOpt);
                return false;
            }
            any = true;
        }

        if (validateTimeout(globalObject, vm, scope, options, this->timeout)) {
            RETURN_IF_EXCEPTION(scope, false);
            any = true;
        }

        if (validateProduceCachedData(globalObject, vm, scope, options, this->produceCachedData)) {
            RETURN_IF_EXCEPTION(scope, false);
            any = true;
        }

        if (validateCachedData(globalObject, vm, scope, options, this->cachedData)) {
            RETURN_IF_EXCEPTION(scope, false);
            any = true;
        }

        // Handle importModuleDynamically option
        JSValue importModuleDynamicallyValue = options->getIfPropertyExists(globalObject, Identifier::fromString(vm, "importModuleDynamically"_s));
        RETURN_IF_EXCEPTION(scope, {});

        if (importModuleDynamicallyValue) {
            if ((importModuleDynamicallyValue.isCallable() || isUseMainContextDefaultLoaderConstant(globalObject, importModuleDynamicallyValue))) {
                if (importer) {
                    *importer = importModuleDynamicallyValue;
                }
                any = true;
            } else if (!importModuleDynamicallyValue.isUndefined()) {
                ERR::INVALID_ARG_TYPE(scope, globalObject, "options.importModuleDynamically"_s, "function"_s, importModuleDynamicallyValue);
                return false;
            }
        }
    }

    return any;
}

static EncodedJSValue
constructScript(JSGlobalObject* globalObject, CallFrame* callFrame, JSValue newTarget = {})
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    ArgList args(callFrame);
    JSValue sourceArg = args.at(0);
    String sourceString;
    if (sourceArg.isUndefined()) {
        sourceString = emptyString();
    } else {
        sourceString = sourceArg.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, encodedJSUndefined());
    }

    JSValue optionsArg = args.at(1);
    ScriptOptions options(""_s);
    JSValue importer;

    if (optionsArg.isString()) {
        options.filename = optionsArg.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
    } else if (!options.fromJS(globalObject, vm, scope, optionsArg, &importer)) {
        RETURN_IF_EXCEPTION(scope, JSValue::encode(jsUndefined()));
    }

    auto* zigGlobalObject = defaultGlobalObject(globalObject);
    Structure* structure = zigGlobalObject->NodeVMScriptStructure();
    if (zigGlobalObject->NodeVMScript() != newTarget) [[unlikely]] {
        if (!newTarget) {
            throwTypeError(globalObject, scope, "Class constructor Script cannot be invoked without 'new'"_s);
            return {};
        }

        auto* functionGlobalObject = defaultGlobalObject(getFunctionRealm(globalObject, newTarget.getObject()));
        RETURN_IF_EXCEPTION(scope, {});
        structure = InternalFunction::createSubclassStructure(globalObject, newTarget.getObject(), functionGlobalObject->NodeVMScriptStructure());
        RETURN_IF_EXCEPTION(scope, {});
    }

    RefPtr fetcher(NodeVMScriptFetcher::create(vm, importer, jsUndefined()));

    SourceCode source = makeSource(sourceString, JSC::SourceOrigin(WTF::URL::fileURLWithFileSystemPath(options.filename), *fetcher), JSC::SourceTaintedOrigin::Untainted, options.filename, TextPosition(options.lineOffset, options.columnOffset));
    RETURN_IF_EXCEPTION(scope, {});

    const bool produceCachedData = options.produceCachedData;
    auto filename = options.filename;

    NodeVMScript* script = NodeVMScript::create(vm, globalObject, structure, WTF::move(source), WTF::move(options));
    RETURN_IF_EXCEPTION(scope, {});

    fetcher->owner(vm, script);

    WTF::Vector<uint8_t>& cachedData = script->cachedData();

    if (!cachedData.isEmpty()) {
        JSC::ProgramExecutable* executable = script->cachedExecutable();
        if (!executable) {
            executable = script->createExecutable();
        }
        ASSERT(executable);

        JSC::LexicallyScopedFeatures lexicallyScopedFeatures = globalObject->globalScopeExtension() ? JSC::TaintedByWithScopeLexicallyScopedFeature : JSC::NoLexicallyScopedFeatures;
        JSC::SourceCodeKey key(script->source(), {}, JSC::SourceCodeType::ProgramType, lexicallyScopedFeatures, JSC::JSParserScriptMode::Classic, JSC::DerivedContextType::None, JSC::EvalContextType::None, false, {}, std::nullopt);
        Ref<JSC::CachedBytecode> cachedBytecode = JSC::CachedBytecode::create(std::span(cachedData), nullptr, {});
        JSC::UnlinkedProgramCodeBlock* unlinkedBlock = JSC::decodeCodeBlock<UnlinkedProgramCodeBlock>(vm, key, WTF::move(cachedBytecode));

        if (!unlinkedBlock) {
            script->cachedDataRejected(TriState::True);
        } else {
            JSC::JSScope* jsScope = globalObject->globalScope();
            JSC::CodeBlock* codeBlock = nullptr;
            {
                // JSC::ProgramCodeBlock::create() requires GC to be deferred.
                DeferGC deferGC(vm);
                codeBlock = JSC::ProgramCodeBlock::create(vm, executable, unlinkedBlock, jsScope);
                RETURN_IF_EXCEPTION(scope, {});
            }
            JSC::CompilationResult compilationResult = JIT::compileSync(vm, codeBlock, JITCompilationEffort::JITCompilationCanFail);
            if (compilationResult != JSC::CompilationResult::CompilationFailed) {
                executable->installCode(codeBlock);
                script->cachedDataRejected(TriState::False);
            } else {
                script->cachedDataRejected(TriState::True);
            }
        }
    } else if (produceCachedData) {
        script->cacheBytecode();
        // TODO(@heimskr): is there ever a case where bytecode production fails?
        script->cachedDataProduced(true);
    }

    return JSValue::encode(script);
}

JSC_DEFINE_HOST_FUNCTION(scriptConstructorCall, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    return constructScript(globalObject, callFrame);
}

JSC_DEFINE_HOST_FUNCTION(scriptConstructorConstruct, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    return constructScript(globalObject, callFrame, callFrame->newTarget());
}

JSC::ProgramExecutable* NodeVMScript::createExecutable()
{
    VM& vm = JSC::getVM(globalObject());
    m_cachedExecutable.set(vm, this, JSC::ProgramExecutable::create(globalObject(), m_source));
    return m_cachedExecutable.get();
}

void NodeVMScript::cacheBytecode()
{
    if (!m_cachedExecutable) {
        createExecutable();
    }

    m_cachedBytecode = getBytecode(globalObject(), m_cachedExecutable.get(), m_source);
    m_cachedDataProduced = m_cachedBytecode != nullptr;
}

JSC::JSUint8Array* NodeVMScript::getBytecodeBuffer()
{
    if (!m_options.produceCachedData) {
        return nullptr;
    }

    if (!m_cachedBytecodeBuffer) {
        if (!m_cachedBytecode) {
            cacheBytecode();
        }

        ASSERT(m_cachedBytecode);

        std::span<const uint8_t> bytes = m_cachedBytecode->span();
        m_cachedBytecodeBuffer.set(vm(), this, WebCore::createBuffer(globalObject(), bytes));
        if (!m_cachedBytecodeBuffer) {
            return nullptr;
        }
    }

    ASSERT(m_cachedBytecodeBuffer);
    return m_cachedBytecodeBuffer.get();
}

DEFINE_VISIT_CHILDREN(NodeVMScript);

template<typename Visitor>
void NodeVMScript::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    NodeVMScript* thisObject = jsCast<NodeVMScript*>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    visitor.append(thisObject->m_cachedExecutable);
    visitor.append(thisObject->m_cachedBytecodeBuffer);
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

NodeVMScript* NodeVMScript::create(VM& vm, JSGlobalObject* globalObject, Structure* structure, SourceCode source, ScriptOptions options)
{
    NodeVMScript* ptr = new (NotNull, allocateCell<NodeVMScript>(vm)) NodeVMScript(vm, structure, WTF::move(source), WTF::move(options));
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

static bool checkForTermination(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope, NodeVMScript* script, std::optional<double> timeout)
{
    if (vm.hasTerminationRequest()) {
        vm.drainMicrotasksForGlobalObject(globalObject);
        vm.clearHasTerminationRequest();
        if (script->getSigintReceived()) {
            script->setSigintReceived(false);
            throwError(globalObject, scope, ErrorCode::ERR_SCRIPT_EXECUTION_INTERRUPTED, "Script execution was interrupted by `SIGINT`"_s);
        } else if (timeout) {
            throwError(globalObject, scope, ErrorCode::ERR_SCRIPT_EXECUTION_TIMEOUT, makeString("Script execution timed out after "_s, *timeout, "ms"_s));
        } else {
            RELEASE_ASSERT_NOT_REACHED_WITH_MESSAGE("vm.Script terminated due neither to SIGINT nor to timeout");
        }
        return true;
    }

    return false;
}

void setupWatchdog(VM& vm, double timeout, double* oldTimeout, double* newTimeout)
{
    JSC::JSLockHolder locker(vm);
    JSC::Watchdog& dog = vm.ensureWatchdog();
    dog.enteredVM();

    Seconds oldLimit = dog.getTimeLimit();

    if (oldTimeout) {
        *oldTimeout = oldLimit.milliseconds();
    }

    if (oldLimit.isInfinity() || timeout < oldLimit.milliseconds()) {
        dog.setTimeLimit(WTF::Seconds::fromMilliseconds(timeout));
    } else {
        timeout = oldLimit.milliseconds();
    }

    if (newTimeout) {
        *newTimeout = timeout;
    }
}

static JSC::EncodedJSValue runInContext(NodeVMGlobalObject* globalObject, NodeVMScript* script, JSObject* contextifiedObject, JSValue optionsArg, bool allowStringInPlaceOfOptions = false)
{
    VM& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    RunningScriptOptions options;
    if (allowStringInPlaceOfOptions && optionsArg.isString()) {
        options.filename = optionsArg.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
    } else {
        auto from = options.fromJS(globalObject, vm, scope, optionsArg);
        RETURN_IF_EXCEPTION(scope, {});
        if (!from) {
            options = {};
        }
    }

    // Set the contextified object before evaluating
    globalObject->setContextifiedObject(contextifiedObject);

    NakedPtr<JSC::Exception> exception;
    JSValue result {};
    auto run = [&] {
        result = JSC::evaluate(globalObject, script->source(), globalObject, exception);
    };

    std::optional<double> oldLimit, newLimit;

    if (options.timeout) {
        setupWatchdog(vm, *options.timeout, &oldLimit.emplace(), &newLimit.emplace());
    }

    script->setSigintReceived(false);

    if (options.breakOnSigint) {
        auto holder = SigintWatcher::hold(globalObject, script);
        run();
    } else {
        run();
    }

    RETURN_IF_EXCEPTION(scope, {});

    if (options.timeout) {
        vm.watchdog()->setTimeLimit(WTF::Seconds::fromMilliseconds(*oldLimit));
    }

    if (checkForTermination(vm, globalObject, scope, script, newLimit)) {
        return {};
    }

    script->setSigintReceived(false);

    if (exception) [[unlikely]] {
        if (handleException(globalObject, vm, exception, scope)) {
            return {};
        }
        JSC::throwException(globalObject, scope, exception.get());
        return {};
    }

    RETURN_IF_EXCEPTION(scope, {});
    RELEASE_AND_RETURN(scope, JSValue::encode(result));
}

JSC_DEFINE_HOST_FUNCTION(scriptRunInThisContext, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue thisValue = callFrame->thisValue();
    auto* script = jsDynamicCast<NodeVMScript*>(thisValue);
    if (!script) [[unlikely]] {
        return ERR::INVALID_ARG_VALUE(scope, globalObject, "this"_s, thisValue, "must be a Script"_s);
    }

    JSValue optionsArg = callFrame->argument(0);

    RunningScriptOptions options;
    if (!options.fromJS(globalObject, vm, scope, optionsArg)) {
        RETURN_IF_EXCEPTION(scope, {});
        options = {};
    }

    NakedPtr<JSC::Exception> exception;
    JSValue result {};
    auto run = [&] {
        result = JSC::evaluate(globalObject, script->source(), globalObject, exception);
    };

    std::optional<double> oldLimit, newLimit;

    if (options.timeout) {
        setupWatchdog(vm, *options.timeout, &oldLimit.emplace(), &newLimit.emplace());
    }

    script->setSigintReceived(false);

    if (options.breakOnSigint) {
        auto holder = SigintWatcher::hold(globalObject, script);
        vm.ensureTerminationException();
        run();
    } else {
        run();
    }

    if (options.timeout) {
        vm.watchdog()->setTimeLimit(WTF::Seconds::fromMilliseconds(*oldLimit));
    }

    if (checkForTermination(vm, globalObject, scope, script, newLimit)) {
        return {};
    }

    script->setSigintReceived(false);

    if (exception) [[unlikely]] {
        if (handleException(globalObject, vm, exception, scope)) {
            return {};
        }
        JSC::throwException(globalObject, scope, exception.get());
        return {};
    }

    RETURN_IF_EXCEPTION(scope, {});
    RELEASE_AND_RETURN(scope, JSValue::encode(result));
}

JSC_DEFINE_CUSTOM_GETTER(scriptGetSourceMapURL, (JSGlobalObject * globalObject, JSC::EncodedJSValue thisValueEncoded, PropertyName))
{
    VM& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue thisValue = JSValue::decode(thisValueEncoded);
    auto* script = jsDynamicCast<NodeVMScript*>(thisValue);
    if (!script) [[unlikely]] {
        return ERR::INVALID_ARG_VALUE(scope, globalObject, "this"_s, thisValue, "must be a Script"_s);
    }

    const String& url = script->source().provider()->sourceMappingURLDirective();

    if (!url) {
        return encodedJSUndefined();
    }

    RELEASE_AND_RETURN(scope, JSValue::encode(jsString(vm, url)));
}

JSC_DEFINE_CUSTOM_GETTER(scriptGetCachedData, (JSGlobalObject * globalObject, JSC::EncodedJSValue thisValueEncoded, PropertyName))
{
    VM& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue thisValue = JSValue::decode(thisValueEncoded);
    auto* script = jsDynamicCast<NodeVMScript*>(thisValue);
    if (!script) [[unlikely]] {
        return ERR::INVALID_ARG_VALUE(scope, globalObject, "this"_s, thisValue, "must be a Script"_s);
    }

    scope.assertNoExceptionExceptTermination();
    auto* buffer = script->getBytecodeBuffer();
    RETURN_IF_EXCEPTION(scope, {});
    if (!buffer) return JSValue::encode(jsUndefined());
    return JSValue::encode(buffer);
}

JSC_DEFINE_CUSTOM_GETTER(scriptGetCachedDataProduced, (JSGlobalObject * globalObject, JSC::EncodedJSValue thisValueEncoded, PropertyName))
{
    VM& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue thisValue = JSValue::decode(thisValueEncoded);
    auto* script = jsDynamicCast<NodeVMScript*>(thisValue);
    if (!script) [[unlikely]] {
        return ERR::INVALID_ARG_VALUE(scope, globalObject, "this"_s, thisValue, "must be a Script"_s);
    }

    scope.assertNoExceptionExceptTermination();
    return JSValue::encode(jsBoolean(script->cachedDataProduced()));
}

JSC_DEFINE_CUSTOM_GETTER(scriptGetCachedDataRejected, (JSGlobalObject * globalObject, JSC::EncodedJSValue thisValueEncoded, PropertyName))
{
    VM& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue thisValue = JSValue::decode(thisValueEncoded);
    auto* script = jsDynamicCast<NodeVMScript*>(thisValue);
    if (!script) [[unlikely]] {
        return ERR::INVALID_ARG_VALUE(scope, globalObject, "this"_s, thisValue, "must be a Script"_s);
    }

    switch (script->cachedDataRejected()) {
    case TriState::True:
        RELEASE_AND_RETURN(scope, JSValue::encode(jsBoolean(true)));
    case TriState::False:
        RELEASE_AND_RETURN(scope, JSValue::encode(jsBoolean(false)));
    default:
        RELEASE_AND_RETURN(scope, encodedJSUndefined());
    }
}

JSC_DEFINE_HOST_FUNCTION(scriptCreateCachedData, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue thisValue = callFrame->thisValue();
    auto* script = jsDynamicCast<NodeVMScript*>(thisValue);
    if (!script) [[unlikely]] {
        return ERR::INVALID_ARG_VALUE(scope, globalObject, "this"_s, thisValue, "must be a Script"_s);
    }

    const JSC::SourceCode& source = script->source();
    RELEASE_AND_RETURN(scope, createCachedData(globalObject, source));
}

JSC_DEFINE_HOST_FUNCTION(scriptRunInContext, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue thisValue = callFrame->thisValue();
    auto* script = jsDynamicCast<NodeVMScript*>(thisValue);
    if (!script) [[unlikely]] {
        return ERR::INVALID_ARG_VALUE(scope, globalObject, "this"_s, thisValue, "must be a Script"_s);
    }

    ArgList args(callFrame);
    JSValue contextArg = args.at(0);
    NodeVMGlobalObject* nodeVmGlobalObject = getGlobalObjectFromContext(globalObject, contextArg, true);
    RETURN_IF_EXCEPTION(scope, {});
    JSObject* context = asObject(contextArg);
    ASSERT(nodeVmGlobalObject != nullptr);

    RELEASE_AND_RETURN(scope, runInContext(nodeVmGlobalObject, script, context, args.at(1)));
}

JSC_DEFINE_HOST_FUNCTION(scriptRunInNewContext, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = JSC::getVM(globalObject);
    NodeVMScript* script = jsDynamicCast<NodeVMScript*>(callFrame->thisValue());
    JSValue contextObjectValue = callFrame->argument(0);
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (!script) {
        throwTypeError(globalObject, scope, "this.runInContext is not a function"_s);
        return {};
    }

    bool notContextified = NodeVM::getContextArg(globalObject, contextObjectValue);

    if (!contextObjectValue || !contextObjectValue.isObject()) [[unlikely]] {
        throwTypeError(globalObject, scope, "Context must be an object"_s);
        return {};
    }

    JSValue contextOptionsArg = callFrame->argument(1);
    NodeVMContextOptions contextOptions {};
    JSValue importer;

    if (auto encodedException = getNodeVMContextOptions(globalObject, vm, scope, contextOptionsArg, contextOptions, "contextCodeGeneration", &importer)) {
        return *encodedException;
    }

    contextOptions.notContextified = notContextified;

    auto* zigGlobalObject = defaultGlobalObject(globalObject);
    JSObject* context = asObject(contextObjectValue);
    auto* targetContext = NodeVMGlobalObject::create(vm,
        zigGlobalObject->NodeVMGlobalObjectStructure(),
        contextOptions, importer);
    RETURN_IF_EXCEPTION(scope, {});

    if (notContextified) {
        auto* specialSandbox = NodeVMSpecialSandbox::create(vm, zigGlobalObject->NodeVMSpecialSandboxStructure(), targetContext);
        RETURN_IF_EXCEPTION(scope, {});
        targetContext->setSpecialSandbox(specialSandbox);
        RELEASE_AND_RETURN(scope, runInContext(targetContext, script, targetContext->specialSandbox(), callFrame->argument(1)));
    }

    RELEASE_AND_RETURN(scope, runInContext(targetContext, script, context, callFrame->argument(1)));
}

class NodeVMScriptPrototype final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;

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
    { "createCachedData"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, scriptCreateCachedData, 1 } },
    { "runInContext"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, scriptRunInContext, 2 } },
    { "runInNewContext"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, scriptRunInNewContext, 2 } },
    { "runInThisContext"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, scriptRunInThisContext, 2 } },
    { "sourceMapURL"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, scriptGetSourceMapURL, nullptr } },
    { "cachedData"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, scriptGetCachedData, nullptr } },
    { "cachedDataProduced"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, scriptGetCachedDataProduced, nullptr } },
    { "cachedDataRejected"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, scriptGetCachedDataRejected, nullptr } },
};

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

const ClassInfo NodeVMScript::s_info = { "Script"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(NodeVMScript) };
const ClassInfo NodeVMScriptPrototype::s_info = { "Script"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(NodeVMScriptPrototype) };
const ClassInfo NodeVMScriptConstructor::s_info = { "Script"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(NodeVMScriptConstructor) };

bool RunningScriptOptions::fromJS(JSC::JSGlobalObject* globalObject, JSC::VM& vm, JSC::ThrowScope& scope, JSC::JSValue optionsArg)
{
    bool any = BaseVMOptions::fromJS(globalObject, vm, scope, optionsArg);
    RETURN_IF_EXCEPTION(scope, false);

    if (!optionsArg.isUndefined() && !optionsArg.isString()) {
        JSObject* options = asObject(optionsArg);

        auto displayErrorsOpt = options->getIfPropertyExists(globalObject, Identifier::fromString(vm, "displayErrors"_s));
        RETURN_IF_EXCEPTION(scope, false);
        if (displayErrorsOpt) {
            if (!displayErrorsOpt.isUndefined()) {
                if (!displayErrorsOpt.isBoolean()) {
                    ERR::INVALID_ARG_TYPE(scope, globalObject, "options.displayErrors"_s, "boolean"_s, displayErrorsOpt);
                    return false;
                }
                this->displayErrors = displayErrorsOpt.asBoolean();
                any = true;
            }
        }

        if (validateTimeout(globalObject, vm, scope, options, this->timeout)) {
            any = true;
        }
        RETURN_IF_EXCEPTION(scope, {});

        auto breakOnSigintOpt = options->getIfPropertyExists(globalObject, Identifier::fromString(vm, "breakOnSigint"_s));
        RETURN_IF_EXCEPTION(scope, false);
        if (breakOnSigintOpt) {
            if (!breakOnSigintOpt.isUndefined()) {
                if (!breakOnSigintOpt.isBoolean()) {
                    ERR::INVALID_ARG_TYPE(scope, globalObject, "options.breakOnSigint"_s, "boolean"_s, breakOnSigintOpt);
                    return false;
                }
                this->breakOnSigint = breakOnSigintOpt.asBoolean();
                any = true;
            }
        }
    }

    return any;
}

} // namespace Bun
