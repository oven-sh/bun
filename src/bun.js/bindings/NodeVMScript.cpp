#include "NodeVMScript.h"

#include "ErrorCode.h"

#include "JavaScriptCore/Completion.h"
#include "JavaScriptCore/JIT.h"
#include "JavaScriptCore/JSWeakMap.h"
#include "JavaScriptCore/JSWeakMapInlines.h"
#include "JavaScriptCore/ProgramCodeBlock.h"
#include "JavaScriptCore/SourceCodeKey.h"

#include "../vm/SigintWatcher.h"

#include <bit>

namespace Bun {
using namespace NodeVM;

bool ScriptOptions::fromJS(JSC::JSGlobalObject* globalObject, JSC::VM& vm, JSC::ThrowScope& scope, JSC::JSValue optionsArg)
{
    bool any = BaseVMOptions::fromJS(globalObject, vm, scope, optionsArg);
    RETURN_IF_EXCEPTION(scope, false);

    if (!optionsArg.isUndefined() && !optionsArg.isString()) {
        JSObject* options = asObject(optionsArg);

        // Validate contextName and contextOrigin are strings
        if (JSValue contextNameOpt = options->getIfPropertyExists(globalObject, Identifier::fromString(vm, "contextName"_s))) {
            if (!contextNameOpt.isUndefined() && !contextNameOpt.isString()) {
                ERR::INVALID_ARG_TYPE(scope, globalObject, "options.contextName"_s, "string"_s, contextNameOpt);
                return false;
            }
            any = true;
        }
        RETURN_IF_EXCEPTION(scope, false);

        if (JSValue contextOriginOpt = options->getIfPropertyExists(globalObject, Identifier::fromString(vm, "contextOrigin"_s))) {
            if (!contextOriginOpt.isUndefined() && !contextOriginOpt.isString()) {
                ERR::INVALID_ARG_TYPE(scope, globalObject, "options.contextOrigin"_s, "string"_s, contextOriginOpt);
                return false;
            }
            any = true;
        }
        RETURN_IF_EXCEPTION(scope, false);

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

        if (importModuleDynamicallyValue && importModuleDynamicallyValue.isCallable()) {
            this->importer = importModuleDynamicallyValue;
            any = true;
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
    String sourceString = sourceArg.isUndefined() ? emptyString() : sourceArg.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, encodedJSUndefined());

    JSValue optionsArg = args.at(1);
    ScriptOptions options(""_s);
    if (optionsArg.isString()) {
        options.filename = optionsArg.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
    } else if (!options.fromJS(globalObject, vm, scope, optionsArg)) {
        RETURN_IF_EXCEPTION(scope, JSValue::encode(jsUndefined()));
    }

    auto* zigGlobalObject = defaultGlobalObject(globalObject);
    Structure* structure = zigGlobalObject->NodeVMScriptStructure();
    if (zigGlobalObject->NodeVMScript() != newTarget) [[unlikely]] {
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

    SourceCode source = makeSource(sourceString, JSC::SourceOrigin(WTF::URL::fileURLWithFileSystemPath(options.filename)), JSC::SourceTaintedOrigin::Untainted, options.filename, TextPosition(options.lineOffset, options.columnOffset));
    RETURN_IF_EXCEPTION(scope, {});

    const bool produceCachedData = options.produceCachedData;
    auto filename = options.filename;

    NodeVMScript* script = NodeVMScript::create(vm, globalObject, structure, WTFMove(source), WTFMove(options));

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
        JSC::UnlinkedProgramCodeBlock* unlinkedBlock = JSC::decodeCodeBlock<UnlinkedProgramCodeBlock>(vm, key, WTFMove(cachedBytecode));

        if (!unlinkedBlock) {
            script->cachedDataRejected(TriState::True);
        } else {
            JSC::JSScope* jsScope = globalObject->globalScope();
            JSC::CodeBlock* codeBlock = nullptr;
            {
                // JSC::ProgramCodeBlock::create() requires GC to be deferred.
                DeferGC deferGC(vm);
                codeBlock = JSC::ProgramCodeBlock::create(vm, executable, unlinkedBlock, jsScope);
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
    NodeVMScript* ptr = new (NotNull, allocateCell<NodeVMScript>(vm)) NodeVMScript(vm, structure, WTFMove(source), WTFMove(options));
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

static bool checkForTermination(JSGlobalObject* globalObject, ThrowScope& scope, NodeVMScript* script, std::optional<double> timeout)
{
    VM& vm = JSC::getVM(globalObject);

    if (vm.hasTerminationRequest()) {
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
    } else if (!options.fromJS(globalObject, vm, scope, optionsArg)) {
        RETURN_IF_EXCEPTION(scope, {});
        options = {};
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

    if (options.timeout) {
        vm.watchdog()->setTimeLimit(WTF::Seconds::fromMilliseconds(*oldLimit));
    }

    if (checkForTermination(globalObject, scope, script, newLimit)) {
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

    return JSValue::encode(result);
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

    if (checkForTermination(globalObject, scope, script, newLimit)) {
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
    return JSValue::encode(result);
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

    return JSValue::encode(jsString(vm, url));
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

    if (auto* buffer = script->getBytecodeBuffer()) {
        return JSValue::encode(buffer);
    }

    return JSValue::encode(jsUndefined());
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
        return JSValue::encode(jsBoolean(true));
    case TriState::False:
        return JSValue::encode(jsBoolean(false));
    default:
        return JSValue::encode(jsUndefined());
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
    return createCachedData(globalObject, source);
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

    return runInContext(nodeVmGlobalObject, script, context, args.at(1));
}

JSC_DEFINE_HOST_FUNCTION(scriptRunInNewContext, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = JSC::getVM(globalObject);
    NodeVMScript* script = jsDynamicCast<NodeVMScript*>(callFrame->thisValue());
    JSValue contextObjectValue = callFrame->argument(0);
    // TODO: options
    // JSValue optionsObjectValue = callFrame->argument(1);
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (!script) {
        throwTypeError(globalObject, scope, "this.runInContext is not a function"_s);
        return {};
    }

    if (contextObjectValue.isUndefined()) {
        contextObjectValue = JSC::constructEmptyObject(globalObject);
    }

    if (!contextObjectValue || !contextObjectValue.isObject()) [[unlikely]] {
        throwTypeError(globalObject, scope, "Context must be an object"_s);
        return {};
    }

    // we don't care about options for now
    // TODO: options
    // bool didThrow = false;

    auto* zigGlobal = defaultGlobalObject(globalObject);
    JSObject* context = asObject(contextObjectValue);
    auto* targetContext = NodeVMGlobalObject::create(vm,
        zigGlobal->NodeVMGlobalObjectStructure(),
        {});

    return runInContext(targetContext, script, context, callFrame->argument(1));
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

        if (JSValue displayErrorsOpt = options->getIfPropertyExists(globalObject, Identifier::fromString(vm, "displayErrors"_s))) {
            RETURN_IF_EXCEPTION(scope, false);
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
            RETURN_IF_EXCEPTION(scope, false);
            any = true;
        }

        if (JSValue breakOnSigintOpt = options->getIfPropertyExists(globalObject, Identifier::fromString(vm, "breakOnSigint"_s))) {
            RETURN_IF_EXCEPTION(scope, false);
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
