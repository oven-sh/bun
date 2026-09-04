#include "NodeVMScript.h"
#include "BunClientData.h"

#include "ErrorCode.h"

#include "JavaScriptCore/CodeCache.h"
#include "JavaScriptCore/Completion.h"
#include "JavaScriptCore/JIT.h"
#include "JavaScriptCore/JSWeakMap.h"
#include "JavaScriptCore/JSWeakMapInlines.h"
#include "JavaScriptCore/ProgramCodeBlock.h"
#include "JavaScriptCore/SourceCodeKey.h"

#include "NodeVMScriptFetcher.h"
#include "../vm/NodeVMRunTermination.h"

#include <bit>

namespace Bun {
using namespace NodeVM;

static std::optional<Seconds> timeoutOf(const RunningScriptOptions& options)
{
    return options.timeout ? std::optional { Seconds::fromMilliseconds(*options.timeout) } : std::nullopt;
}

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

        if (validateTimeout(globalObject, vm, scope, options, this->timeout))
            any = true;
        // The validators return false both for "absent" and for "threw".
        RETURN_IF_EXCEPTION(scope, false);

        if (validateProduceCachedData(globalObject, vm, scope, options, this->produceCachedData))
            any = true;
        RETURN_IF_EXCEPTION(scope, false);

        if (validateCachedData(globalObject, vm, scope, options, this->cachedData))
            any = true;
        RETURN_IF_EXCEPTION(scope, false);

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
        // `new Script(src, "name")` is a provided filename, "" included.
        options.filenameProvided = true;
    } else if (!options.fromJS(globalObject, vm, scope, optionsArg, &importer)) {
        RETURN_IF_EXCEPTION(scope, JSValue::encode(jsUndefined()));
    }
    options.lineOffset = clampOffsetForSource(options.lineOffset, sourceString.length());
    options.columnOffset = clampOffsetForSource(options.columnOffset, sourceString.length());

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

    NodeVMScript* script = NodeVMScript::create(vm, globalObject, structure, WTF::move(source), WTF::move(options));
    RETURN_IF_EXCEPTION(scope, {});

    fetcher->owner(vm, script);

    // Node's vm.Script throws SyntaxError at construction; the REPL's
    // recoverable-error flow (and user code) relies on that.
    JSC::ParserError parseError;
    if (!script->unlinkedCodeBlockFor(globalObject, parseError)) {
        auto exception = parseError.toErrorObject(globalObject, script->source(), -1);
        // Building the error materializes its stack, running a user
        // Error.prepareStackTrace that may throw; Node throws the SyntaxError
        // anyway. tryClearException leaves a termination for the check below.
        if (exception)
            (void)scope.tryClearException();
        RETURN_IF_EXCEPTION(scope, {});
        // Node always attaches the arrow header to compile-time SyntaxErrors
        // (node_contextify.cc DecorateErrorStack), independent of displayErrors.
        // An absent filename becomes evalmachine.<anonymous>; an explicitly
        // provided one — including "" — is used verbatim.
        const ScriptOptions& scriptOptions = script->options();
        String url = scriptOptions.filenameProvided ? scriptOptions.filename : "evalmachine.<anonymous>"_s;
        decorateParseErrorStack(globalObject, vm, exception, sourceString, url, parseError, scriptOptions.lineOffset);
        RETURN_IF_EXCEPTION(scope, {});
        throwException(globalObject, scope, exception);
        return {};
    }
    RETURN_IF_EXCEPTION(scope, {});

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
    } else if (script->options().produceCachedData)
        script->cacheBytecode();

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

JSC::UnlinkedProgramCodeBlock* NodeVMScript::unlinkedCodeBlockFor(JSGlobalObject* globalObject, JSC::ParserError& error)
{
    VM& vm = JSC::getVM(globalObject);
    OptionSet<JSC::CodeGenerationMode> codeGenerationMode = globalObject->defaultCodeGenerationMode();

    if (m_unlinkedCodeBlock && m_unlinkedCodeBlock->codeGenerationMode() == codeGenerationMode)
        return m_unlinkedCodeBlock.get();

    // The CodeCache records the parse on the executable it is given (that changes what the executable keys
    // later lookups with, so m_cachedExecutable is not used for this); every run links its own anyway.
    JSC::UnlinkedProgramCodeBlock* block = vm.codeCache()->getUnlinkedProgramCodeBlock(vm, JSC::ProgramExecutable::create(globalObject, m_source), m_source, codeGenerationMode, error);
    if (block)
        m_unlinkedCodeBlock.set(vm, this, block);
    return block;
}

JSValue NodeVMScript::evaluate(JSGlobalObject* globalObject, NakedPtr<JSC::Exception>& exception)
{
    // If the compile fails now (stack overflow, OOM), the block is null and
    // JSC::evaluate reports the failure the way it always has, by compiling itself.
    JSC::ParserError ignoredError;
    return JSC::evaluate(globalObject, m_source, unlinkedCodeBlockFor(globalObject, ignoredError), globalObject, exception);
}

JSC::ProgramExecutable* NodeVMScript::createExecutable()
{
    VM& vm = JSC::getVM(globalObject());
    m_cachedExecutable.set(vm, this, JSC::ProgramExecutable::create(globalObject(), m_source));
    return m_cachedExecutable.get();
}

void NodeVMScript::cacheBytecode()
{
    m_cachedBytecode = getBytecode(globalObject(), JSC::SourceCodeType::ProgramType, m_source);
    m_cachedDataProduced = m_cachedBytecode != nullptr;
}

JSC::JSUint8Array* NodeVMScript::getBytecodeBuffer()
{
    auto scope = DECLARE_THROW_SCOPE(vm());
    if (!m_options.produceCachedData) {
        return nullptr;
    }

    if (!m_cachedBytecodeBuffer) {
        if (!m_cachedBytecode)
            cacheBytecode();
        if (!m_cachedBytecode)
            return nullptr;

        std::span<const uint8_t> bytes = m_cachedBytecode->span();
        m_cachedBytecodeBuffer.set(vm(), this, WebCore::createBuffer(globalObject(), bytes));
        RETURN_IF_EXCEPTION(scope, nullptr);
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
    NodeVMScript* thisObject = uncheckedDowncast<NodeVMScript>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    visitor.append(thisObject->m_cachedExecutable);
    visitor.append(thisObject->m_cachedBytecodeBuffer);
    visitor.append(thisObject->m_unlinkedCodeBlock);
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

static JSC::EncodedJSValue runInContext(NodeVMGlobalObject* globalObject, NodeVMScript* script, JSObject* contextifiedObject, JSValue optionsArg)
{
    VM& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    RunningScriptOptions options;
    auto from = options.fromJS(globalObject, vm, scope, optionsArg);
    RETURN_IF_EXCEPTION(scope, {});
    if (!from) {
        options = {};
    }

    // Set the contextified object before evaluating
    globalObject->setContextifiedObject(contextifiedObject);

    NakedPtr<JSC::Exception> exception;
    JSValue result {};
    {
        NodeVMRunTermination termination(globalObject, timeoutOf(options), options.breakOnSigint);
        result = script->evaluate(globalObject, exception);
        // Node performs the afterEvaluate microtask checkpoint inside the timeout/SIGINT scope, so a
        // `timeout` also bounds microtasks the script scheduled on the context's own queue. A script cut
        // short before its checkpoint keeps what it queued for the next evaluation's, as in Node.
        if (!exception && !vm.hasTerminationRequest() && globalObject->hasOwnMicrotaskQueue())
            globalObject->drainOwnMicrotasks();
        termination.finish(scope);
    }
    RETURN_IF_EXCEPTION(scope, {});

    if (exception) [[unlikely]] {
        // Node only decorates the error stack with the source line when
        // displayErrors is not false (lib/vm.js decorateErrorStack).
        if (options.displayErrors && handleException(globalObject, vm, exception, scope)) {
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
    auto* script = dynamicDowncast<NodeVMScript>(thisValue);
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
    {
        NodeVMRunTermination termination(globalObject, timeoutOf(options), options.breakOnSigint);
        result = script->evaluate(globalObject, exception);
        termination.finish(scope);
    }
    RETURN_IF_EXCEPTION(scope, {});

    if (exception) [[unlikely]] {
        // Node only decorates the error stack with the source line when
        // displayErrors is not false (lib/vm.js decorateErrorStack).
        if (options.displayErrors && handleException(globalObject, vm, exception, scope)) {
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
    auto* script = dynamicDowncast<NodeVMScript>(thisValue);
    if (!script) [[unlikely]] {
        return ERR::INVALID_ARG_VALUE(scope, globalObject, "this"_s, thisValue, "must be a Script"_s);
    }

    // Populated by the compile in the constructor (a CodeCache hit copies it over too).
    String url = script->source().provider()->sourceMappingURLDirective();
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
    auto* script = dynamicDowncast<NodeVMScript>(thisValue);
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
    auto* script = dynamicDowncast<NodeVMScript>(thisValue);
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
    auto* script = dynamicDowncast<NodeVMScript>(thisValue);
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
    auto* script = dynamicDowncast<NodeVMScript>(thisValue);
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
    auto* script = dynamicDowncast<NodeVMScript>(thisValue);
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
    NodeVMScript* script = dynamicDowncast<NodeVMScript>(callFrame->thisValue());
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

    getNodeVMContextOptions(globalObject, vm, scope, contextOptionsArg, contextOptions, "contextCodeGeneration", &importer);
    RETURN_IF_EXCEPTION(scope, {});

    contextOptions.notContextified = notContextified;

    auto* zigGlobalObject = defaultGlobalObject(globalObject);
    JSObject* context = asObject(contextObjectValue);
    auto* targetContext = NodeVMGlobalObject::create(vm,
        zigGlobalObject->NodeVMGlobalObjectStructure(),
        contextOptions, importer);
    RETURN_IF_EXCEPTION(scope, {});

    if (notContextified) {
        auto* specialSandbox = NodeVMSpecialSandbox::create(vm, targetContext);
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
        NodeVMScriptPrototype* ptr = new (NotNull, Bun::allocatePlainObjectCell(vm, sizeof(NodeVMScriptPrototype))) NodeVMScriptPrototype(vm, structure);
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
        return Bun::createClassStructure(vm, globalObject, prototype, JSC::TypeInfo(ObjectType, StructureFlags), info());
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
    Bun::reifyStaticPropertyTable(vm, NodeVMScript::info(), scriptPrototypeTableValues, *this);
    Bun::putToStringTagWithoutTransition(vm, this, info());
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
