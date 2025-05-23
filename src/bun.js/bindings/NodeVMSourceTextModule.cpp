#include "NodeVMSourceTextModule.h"

#include "ErrorCode.h"
#include "JSDOMExceptionHandling.h"

#include "wtf/Scope.h"

#include "JavaScriptCore/JIT.h"
#include "JavaScriptCore/JSModuleRecord.h"
#include "JavaScriptCore/JSPromise.h"
#include "JavaScriptCore/JSSourceCode.h"
#include "JavaScriptCore/ModuleAnalyzer.h"
#include "JavaScriptCore/ModuleProgramCodeBlock.h"
#include "JavaScriptCore/Parser.h"
#include "JavaScriptCore/SourceCodeKey.h"
#include "JavaScriptCore/Watchdog.h"

#include "../vm/SigintWatcher.h"

namespace Bun {
using namespace NodeVM;

NodeVMSourceTextModule* NodeVMSourceTextModule::create(VM& vm, JSGlobalObject* globalObject, ArgList args)
{
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue identifierValue = args.at(0);
    if (!identifierValue.isString()) {
        throwArgumentTypeError(*globalObject, scope, 0, "identifier"_s, "Module"_s, "Module"_s, "string"_s);
        return nullptr;
    }

    JSValue contextValue = args.at(1);
    if (contextValue.isUndefined()) {
        contextValue = globalObject;
    } else if (!contextValue.isObject()) {
        throwArgumentTypeError(*globalObject, scope, 1, "context"_s, "Module"_s, "Module"_s, "object"_s);
        return nullptr;
    }

    JSValue sourceTextValue = args.at(2);
    if (!sourceTextValue.isString()) {
        throwArgumentTypeError(*globalObject, scope, 2, "sourceText"_s, "Module"_s, "Module"_s, "string"_s);
        return nullptr;
    }

    JSValue lineOffsetValue = args.at(3);
    if (!lineOffsetValue.isUInt32AsAnyInt()) {
        throwArgumentTypeError(*globalObject, scope, 3, "lineOffset"_s, "Module"_s, "Module"_s, "number"_s);
        return nullptr;
    }

    JSValue columnOffsetValue = args.at(4);
    if (!columnOffsetValue.isUInt32AsAnyInt()) {
        throwArgumentTypeError(*globalObject, scope, 4, "columnOffset"_s, "Module"_s, "Module"_s, "number"_s);
        return nullptr;
    }

    JSValue cachedDataValue = args.at(5);
    WTF::Vector<uint8_t> cachedData;
    if (!cachedDataValue.isUndefined() && !extractCachedData(cachedDataValue, cachedData)) {
        Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "options.cachedData"_s, "Buffer, TypedArray, or DataView"_s, cachedDataValue);
        return nullptr;
    }

    uint32_t lineOffset = lineOffsetValue.toUInt32(globalObject);
    uint32_t columnOffset = columnOffsetValue.toUInt32(globalObject);

    Ref<StringSourceProvider> sourceProvider = StringSourceProvider::create(sourceTextValue.toWTFString(globalObject), SourceOrigin {}, String {}, SourceTaintedOrigin::Untainted,
        TextPosition { OrdinalNumber::fromZeroBasedInt(lineOffset), OrdinalNumber::fromZeroBasedInt(columnOffset) }, SourceProviderSourceType::Module);

    SourceCode sourceCode(WTFMove(sourceProvider), lineOffset, columnOffset);

    auto* zigGlobalObject = defaultGlobalObject(globalObject);
    NodeVMSourceTextModule* ptr = new (NotNull, allocateCell<NodeVMSourceTextModule>(vm)) NodeVMSourceTextModule(vm, zigGlobalObject->NodeVMSourceTextModuleStructure(), identifierValue.toWTFString(globalObject), contextValue, WTFMove(sourceCode));
    ptr->finishCreation(vm);

    if (cachedData.isEmpty()) {
        return ptr;
    }

    ModuleProgramExecutable* executable = ModuleProgramExecutable::tryCreate(globalObject, ptr->sourceCode());
    if (!executable) {
        // If an exception is already being thrown, don't throw another one.
        // ModuleProgramExecutable::tryCreate() sometimes throws on failure, but sometimes it doesn't.
        if (!scope.exception()) {
            throwSyntaxError(globalObject, scope, "Failed to create cached executable"_s);
        }
        return nullptr;
    }

    ptr->m_cachedExecutable.set(vm, ptr, executable);
    LexicallyScopedFeatures lexicallyScopedFeatures = globalObject->globalScopeExtension() ? TaintedByWithScopeLexicallyScopedFeature : NoLexicallyScopedFeatures;
    SourceCodeKey key(ptr->sourceCode(), {}, SourceCodeType::ProgramType, lexicallyScopedFeatures, JSParserScriptMode::Classic, DerivedContextType::None, EvalContextType::None, false, {}, std::nullopt);
    Ref<CachedBytecode> cachedBytecode = CachedBytecode::create(std::span(cachedData), nullptr, {});
    UnlinkedModuleProgramCodeBlock* unlinkedBlock = decodeCodeBlock<UnlinkedModuleProgramCodeBlock>(vm, key, WTFMove(cachedBytecode));

    if (unlinkedBlock) {
        JSScope* jsScope = globalObject->globalScope();
        CodeBlock* codeBlock = nullptr;
        {
            // JSC::ProgramCodeBlock::create() requires GC to be deferred.
            DeferGC deferGC(vm);
            codeBlock = ModuleProgramCodeBlock::create(vm, executable, unlinkedBlock, jsScope);
        }
        if (codeBlock) {
            CompilationResult compilationResult = JIT::compileSync(vm, codeBlock, JITCompilationEffort::JITCompilationCanFail);
            if (compilationResult != CompilationResult::CompilationFailed) {
                executable->installCode(codeBlock);
                return ptr;
            }
        }
    }

    throwError(globalObject, scope, ErrorCode::ERR_VM_MODULE_CACHED_DATA_REJECTED, "cachedData buffer was rejected"_s);
    return nullptr;
}

void NodeVMSourceTextModule::destroy(JSCell* cell)
{
    static_cast<NodeVMSourceTextModule*>(cell)->NodeVMSourceTextModule::~NodeVMSourceTextModule();
}

JSValue NodeVMSourceTextModule::createModuleRecord(JSGlobalObject* globalObject)
{
    if (m_moduleRequestsArray) {
        return m_moduleRequestsArray.get();
    }

    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    ParserError parserError;

    std::unique_ptr<ModuleProgramNode> node = parseRootNode<ModuleProgramNode>(vm, m_sourceCode,
        ImplementationVisibility::Public,
        JSParserBuiltinMode::NotBuiltin,
        StrictModeLexicallyScopedFeature,
        JSParserScriptMode::Module,
        SourceParseMode::ModuleAnalyzeMode,
        parserError);

    if (parserError.isValid()) {
        throwException(globalObject, scope, parserError.toErrorObject(globalObject, m_sourceCode));
        return {};
    }

    ModuleAnalyzer analyzer(globalObject, Identifier::fromString(vm, m_identifier), m_sourceCode, node->varDeclarations(), node->lexicalVariables(), AllFeatures);

    RETURN_IF_EXCEPTION(scope, {});
    ASSERT(node != nullptr);

    JSModuleRecord* moduleRecord = nullptr;

    if (auto result = analyzer.analyze(*node)) {
        moduleRecord = *result;
    } else {
        auto [type, message] = result.error();
        throwError(globalObject, scope, ErrorCode::ERR_VM_MODULE_LINK_FAILURE, message);
        return {};
    }

    m_moduleRecord.set(vm, this, moduleRecord);
    m_moduleRequests.clear();

    const auto& requests = moduleRecord->requestedModules();

    if (requests.isEmpty()) {
        return constructEmptyArray(globalObject, nullptr, 0);
    }

    JSArray* requestsArray = constructEmptyArray(globalObject, nullptr, requests.size());

    const auto& builtinNames = WebCore::clientData(vm)->builtinNames();
    const Identifier& specifierIdentifier = builtinNames.specifierPublicName();
    const Identifier& attributesIdentifier = builtinNames.attributesPublicName();
    const Identifier& hostDefinedImportTypeIdentifier = builtinNames.hostDefinedImportTypePublicName();

    WTF::Vector<ImportAttributesListNode*, 8> attributesNodes;
    attributesNodes.reserveInitialCapacity(requests.size());

    for (StatementNode* statement = node->statements()->firstStatement(); statement; statement = statement->next()) {
        // Assumption: module declarations occur here in the same order they occur in `requestedModules`.
        if (statement->isModuleDeclarationNode()) {
            ModuleDeclarationNode* moduleDeclaration = static_cast<ModuleDeclarationNode*>(statement);
            if (moduleDeclaration->isImportDeclarationNode()) {
                ImportDeclarationNode* importDeclaration = static_cast<ImportDeclarationNode*>(moduleDeclaration);
                ASSERT_WITH_MESSAGE(attributesNodes.size() < requests.size(), "More attributes nodes than requests");
                ASSERT_WITH_MESSAGE(importDeclaration->moduleName()->moduleName().string().string() == WTF::String(*requests.at(attributesNodes.size()).m_specifier), "Module name mismatch");
                attributesNodes.append(importDeclaration->attributesList());
            } else if (moduleDeclaration->hasAttributesList()) {
                // Necessary to make the indices of `attributesNodes` and `requests` match up
                attributesNodes.append(nullptr);
            }
        }
    }

    ASSERT_WITH_MESSAGE(attributesNodes.size() == requests.size(), "Attributes node count doesn't match request count (%zu != %zu)", attributesNodes.size(), requests.size());

    for (unsigned i = 0; i < requests.size(); ++i) {
        const auto& request = requests[i];

        JSString* specifierValue = JSC::jsString(vm, WTF::String(*request.m_specifier));

        JSObject* requestObject = constructEmptyObject(globalObject, globalObject->objectPrototype(), 2);
        requestObject->putDirect(vm, specifierIdentifier, specifierValue);

        WTF::String attributesTypeString = "unknown"_str;

        WTF::HashMap<WTF::String, WTF::String> attributeMap;
        JSObject* attributesObject = constructEmptyObject(globalObject);

        if (request.m_attributes) {
            JSValue attributesType {};
            switch (request.m_attributes->type()) {
                using AttributeType = decltype(request.m_attributes->type());
                using enum AttributeType;
            case None:
                attributesTypeString = "none"_str;
                attributesType = JSC::jsString(vm, attributesTypeString);
                break;
            case JavaScript:
                attributesTypeString = "javascript"_str;
                attributesType = JSC::jsString(vm, attributesTypeString);
                break;
            case WebAssembly:
                attributesTypeString = "webassembly"_str;
                attributesType = JSC::jsString(vm, attributesTypeString);
                break;
            case JSON:
                attributesTypeString = "json"_str;
                attributesType = JSC::jsString(vm, attributesTypeString);
                break;
            default:
                attributesType = JSC::jsNumber(static_cast<uint8_t>(request.m_attributes->type()));
                break;
            }

            attributeMap.set("type"_s, WTFMove(attributesTypeString));
            attributesObject->putDirect(vm, JSC::Identifier::fromString(vm, "type"_s), attributesType);

            if (const String& hostDefinedImportType = request.m_attributes->hostDefinedImportType(); !hostDefinedImportType.isEmpty()) {
                attributesObject->putDirect(vm, hostDefinedImportTypeIdentifier, JSC::jsString(vm, hostDefinedImportType));
                attributeMap.set("hostDefinedImportType"_s, hostDefinedImportType);
            }
        }

        if (ImportAttributesListNode* attributesNode = attributesNodes.at(i)) {
            for (auto [key, value] : attributesNode->attributes()) {
                attributeMap.set(key->string(), value->string());
                attributesObject->putDirect(vm, *key, JSC::jsString(vm, value->string()));
            }
        }

        requestObject->putDirect(vm, attributesIdentifier, attributesObject);
        addModuleRequest({ WTF::String(*request.m_specifier), WTFMove(attributeMap) });
        requestsArray->putDirectIndex(globalObject, i, requestObject);
    }

    m_moduleRequestsArray.set(vm, this, requestsArray);
    return requestsArray;
}

void NodeVMSourceTextModule::ensureModuleRecord(JSGlobalObject* globalObject)
{
    if (!m_moduleRecord) {
        createModuleRecord(globalObject);
    }
}

AbstractModuleRecord* NodeVMSourceTextModule::moduleRecord(JSGlobalObject* globalObject)
{
    ensureModuleRecord(globalObject);
    return m_moduleRecord.get();
}

JSValue NodeVMSourceTextModule::link(JSGlobalObject* globalObject, JSArray* specifiers, JSArray* moduleNatives, JSValue scriptFetcher)
{
    const unsigned length = specifiers->getArrayLength();

    ASSERT(length == moduleNatives->getArrayLength());

    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (m_status != Status::Unlinked) {
        throwError(globalObject, scope, ErrorCode::ERR_VM_MODULE_STATUS, "Module must be unlinked before linking"_s);
        return {};
    }

    JSModuleRecord* record = m_moduleRecord.get();

    if (length != 0) {
        for (unsigned i = 0; i < length; i++) {
            JSValue specifierValue = specifiers->getDirectIndex(globalObject, i);
            JSValue moduleNativeValue = moduleNatives->getDirectIndex(globalObject, i);

            ASSERT(specifierValue.isString());
            ASSERT(moduleNativeValue.isObject());

            WTF::String specifier = specifierValue.toWTFString(globalObject);
            JSObject* moduleNative = moduleNativeValue.getObject();
            AbstractModuleRecord* resolvedRecord = jsCast<NodeVMModule*>(moduleNative)->moduleRecord(globalObject);

            record->setImportedModule(globalObject, Identifier::fromString(vm, specifier), resolvedRecord);
            m_resolveCache.set(WTFMove(specifier), WriteBarrier<JSObject> { vm, this, moduleNative });
        }
    }

    if (NodeVMGlobalObject* nodeVmGlobalObject = getGlobalObjectFromContext(globalObject, m_context.get(), false)) {
        globalObject = nodeVmGlobalObject;
    }

    Synchronousness sync = record->link(globalObject, scriptFetcher);

    RETURN_IF_EXCEPTION(scope, {});

    if (sync == Synchronousness::Async) {
        RELEASE_ASSERT_NOT_REACHED_WITH_MESSAGE("TODO(@heimskr): async module linking");
    }

    status(Status::Linked);
    return JSC::jsUndefined();
}

JSValue NodeVMSourceTextModule::evaluate(JSGlobalObject* globalObject, uint32_t timeout, bool breakOnSigint)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (m_status != Status::Linked && m_status != Status::Evaluated && m_status != Status::Errored) {
        throwError(globalObject, scope, ErrorCode::ERR_VM_MODULE_STATUS, "Module must be linked, evaluated or errored before evaluating"_s);
        return {};
    }

    JSModuleRecord* record = m_moduleRecord.get();
    JSValue result {};

    NodeVMGlobalObject* nodeVmGlobalObject = getGlobalObjectFromContext(globalObject, m_context.get(), false);

    if (nodeVmGlobalObject) {
        globalObject = nodeVmGlobalObject;
    }

    auto run = [&] {
        status(Status::Evaluating);

        for (const auto& request : record->requestedModules()) {
            if (auto iter = m_resolveCache.find(WTF::String(*request.m_specifier)); iter != m_resolveCache.end()) {
                if (auto* dependency = jsDynamicCast<NodeVMSourceTextModule*>(iter->value.get())) {
                    if (dependency->status() == Status::Linked) {
                        JSValue dependencyResult = dependency->evaluate(globalObject, timeout, breakOnSigint);
                        RELEASE_ASSERT_WITH_MESSAGE(jsDynamicCast<JSC::JSPromise*>(dependencyResult) == nullptr, "TODO(@heimskr): implement async support for node:vm SourceTextModule dependencies");
                    }
                }
            }
        }

        result = record->evaluate(globalObject, jsUndefined(), jsNumber(static_cast<int32_t>(JSGenerator::ResumeMode::NormalMode)));
    };

    setSigintReceived(false);

    if (timeout != 0) {
        JSC::JSLockHolder locker(vm);
        JSC::Watchdog& dog = vm.ensureWatchdog();
        dog.enteredVM();
        dog.setTimeLimit(WTF::Seconds::fromMilliseconds(timeout));
    }

    if (breakOnSigint) {
        auto holder = SigintWatcher::hold(nodeVmGlobalObject, this);
        run();
    } else {
        run();
    }

    if (timeout != 0) {
        vm.watchdog()->setTimeLimit(JSC::Watchdog::noTimeLimit);
    }

    if (vm.hasPendingTerminationException()) {
        scope.clearException();
        vm.clearHasTerminationRequest();
        if (getSigintReceived()) {
            setSigintReceived(false);
            throwError(globalObject, scope, ErrorCode::ERR_SCRIPT_EXECUTION_INTERRUPTED, "Script execution was interrupted by `SIGINT`"_s);
        } else {
            throwError(globalObject, scope, ErrorCode::ERR_SCRIPT_EXECUTION_TIMEOUT, makeString("Script execution timed out after "_s, timeout, "ms"_s));
        }
    } else {
        setSigintReceived(false);
    }

    if (JSC::Exception* exception = scope.exception()) {
        status(Status::Errored);
        m_evaluationException.set(vm, this, exception);
        return {};
    }

    status(Status::Evaluated);
    return result;
}

RefPtr<CachedBytecode> NodeVMSourceTextModule::bytecode(JSGlobalObject* globalObject)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (!m_bytecode) {
        if (!m_cachedExecutable) {
            ModuleProgramExecutable* executable = ModuleProgramExecutable::tryCreate(globalObject, m_sourceCode);
            if (!executable) {
                if (!scope.exception()) {
                    throwSyntaxError(globalObject, scope, "Failed to create cached executable"_s);
                }
                return nullptr;
            }
            m_cachedExecutable.set(vm, this, executable);
        }
        m_bytecode = getBytecode(globalObject, m_cachedExecutable.get(), m_sourceCode);
    }

    return m_bytecode;
}

JSUint8Array* NodeVMSourceTextModule::cachedData(JSGlobalObject* globalObject)
{
    if (!m_cachedBytecodeBuffer) {
        RefPtr<CachedBytecode> cachedBytecode = bytecode(globalObject);
        std::span<const uint8_t> bytes = cachedBytecode->span();
        m_cachedBytecodeBuffer.set(vm(), this, WebCore::createBuffer(globalObject, bytes));
    }

    return m_cachedBytecodeBuffer.get();
}

JSObject* NodeVMSourceTextModule::createPrototype(VM& vm, JSGlobalObject* globalObject)
{
    return NodeVMModulePrototype::create(vm, NodeVMModulePrototype::createStructure(vm, globalObject, globalObject->objectPrototype()));
}

template<typename Visitor>
void NodeVMSourceTextModule::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* vmModule = jsCast<NodeVMSourceTextModule*>(cell);
    ASSERT_GC_OBJECT_INHERITS(vmModule, info());
    Base::visitChildren(vmModule, visitor);

    visitor.append(vmModule->m_moduleRecord);
    visitor.append(vmModule->m_moduleRequestsArray);
    visitor.append(vmModule->m_cachedExecutable);
    visitor.append(vmModule->m_cachedBytecodeBuffer);
    visitor.append(vmModule->m_evaluationException);
}

DEFINE_VISIT_CHILDREN(NodeVMSourceTextModule);

const JSC::ClassInfo NodeVMSourceTextModule::s_info = { "NodeVMSourceTextModule"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(NodeVMSourceTextModule) };

} // namespace Bun
