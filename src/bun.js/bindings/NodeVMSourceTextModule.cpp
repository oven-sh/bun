#include "NodeVMScriptFetcher.h"
#include "NodeVMSourceTextModule.h"
#include "NodeVMSyntheticModule.h"

#include "ErrorCode.h"
#include "JSDOMExceptionHandling.h"

#include "wtf/Scope.h"

#include "JavaScriptCore/BuiltinNames.h"
#include "JavaScriptCore/JIT.h"
#include "JavaScriptCore/JSModuleEnvironment.h"
#include "JavaScriptCore/JSModuleRecord.h"
#include "JavaScriptCore/JSPromise.h"
#include "JavaScriptCore/JSSourceCode.h"
#include "JavaScriptCore/ModuleAnalyzer.h"
#include "JavaScriptCore/ModuleProgramCodeBlock.h"
#include "JavaScriptCore/Parser.h"
#include "JavaScriptCore/SourceCodeKey.h"

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

    JSValue initializeImportMeta = args.at(6);
    if (!initializeImportMeta.isUndefined() && !initializeImportMeta.isCallable()) {
        throwArgumentTypeError(*globalObject, scope, 6, "options.initializeImportMeta"_s, "Module"_s, "Module"_s, "function"_s);
        return nullptr;
    }

    JSValue moduleWrapper = args.at(7);
    if (!moduleWrapper.isUndefined() && !moduleWrapper.isObject()) {
        throwArgumentTypeError(*globalObject, scope, 7, "moduleWrapper"_s, "Module"_s, "Module"_s, "object"_s);
        return nullptr;
    }

    JSValue dynamicImportCallback = args.at(8);
    if (!dynamicImportCallback.isUndefined() && !dynamicImportCallback.isCallable()) {
        throwArgumentTypeError(*globalObject, scope, 8, "dynamicImportCallback"_s, "Module"_s, "Module"_s, "function"_s);
        return nullptr;
    }

    uint32_t lineOffset = lineOffsetValue.toUInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, nullptr);
    uint32_t columnOffset = columnOffsetValue.toUInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, nullptr);

    RefPtr fetcher(NodeVMScriptFetcher::create(vm, dynamicImportCallback, moduleWrapper));
    RETURN_IF_EXCEPTION(scope, nullptr);

    SourceOrigin sourceOrigin { {}, *fetcher };

    WTF::String sourceText = sourceTextValue.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, nullptr);

    Ref<StringSourceProvider> sourceProvider = StringSourceProvider::create(WTF::move(sourceText), sourceOrigin, String {}, SourceTaintedOrigin::Untainted,
        TextPosition { OrdinalNumber::fromZeroBasedInt(lineOffset), OrdinalNumber::fromZeroBasedInt(columnOffset) }, SourceProviderSourceType::Module);

    SourceCode sourceCode(WTF::move(sourceProvider), lineOffset, columnOffset);

    auto* zigGlobalObject = defaultGlobalObject(globalObject);
    WTF::String identifier = identifierValue.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, nullptr);
    NodeVMSourceTextModule* ptr = new (NotNull, allocateCell<NodeVMSourceTextModule>(vm)) NodeVMSourceTextModule(
        vm, zigGlobalObject->NodeVMSourceTextModuleStructure(), WTF::move(identifier), contextValue,
        WTF::move(sourceCode), moduleWrapper, initializeImportMeta);
    RETURN_IF_EXCEPTION(scope, nullptr);
    ptr->finishCreation(vm);

    if (cachedData.isEmpty()) {
        return ptr;
    }

    ModuleProgramExecutable* executable = ModuleProgramExecutable::tryCreate(globalObject, ptr->sourceCode());
    RETURN_IF_EXCEPTION(scope, {});
    if (!executable) {
        throwSyntaxError(globalObject, scope, "Failed to create cached executable"_s);
        return nullptr;
    }

    ptr->m_cachedExecutable.set(vm, ptr, executable);
    LexicallyScopedFeatures lexicallyScopedFeatures = globalObject->globalScopeExtension() ? TaintedByWithScopeLexicallyScopedFeature : NoLexicallyScopedFeatures;
    SourceCodeKey key(ptr->sourceCode(), {}, SourceCodeType::ProgramType, lexicallyScopedFeatures, JSParserScriptMode::Classic, DerivedContextType::None, EvalContextType::None, false, {}, std::nullopt);
    Ref<CachedBytecode> cachedBytecode = CachedBytecode::create(std::span(cachedData), nullptr, {});
    RETURN_IF_EXCEPTION(scope, nullptr);
    UnlinkedModuleProgramCodeBlock* unlinkedBlock = decodeCodeBlock<UnlinkedModuleProgramCodeBlock>(vm, key, WTF::move(cachedBytecode));
    RETURN_IF_EXCEPTION(scope, nullptr);

    if (unlinkedBlock) {
        JSScope* jsScope = globalObject->globalScope();
        CodeBlock* codeBlock = nullptr;
        {
            // JSC::ProgramCodeBlock::create() requires GC to be deferred.
            DeferGC deferGC(vm);
            codeBlock = ModuleProgramCodeBlock::create(vm, executable, unlinkedBlock, jsScope);
            RETURN_IF_EXCEPTION(scope, nullptr);
        }
        if (codeBlock) {
            CompilationResult compilationResult = JIT::compileSync(vm, codeBlock, JITCompilationEffort::JITCompilationCanFail);
            RETURN_IF_EXCEPTION(scope, nullptr);
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
        RELEASE_AND_RETURN(scope, constructEmptyArray(globalObject, nullptr, 0));
    }

    JSArray* requestsArray = constructEmptyArray(globalObject, nullptr, requests.size());
    RETURN_IF_EXCEPTION(scope, {});

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

    ASSERT_WITH_MESSAGE(attributesNodes.size() >= requests.size(), "Attributes node count doesn't match request count (%zu < %zu)", attributesNodes.size(), requests.size());

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

            attributeMap.set("type"_s, WTF::move(attributesTypeString));
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
        addModuleRequest({ WTF::String(*request.m_specifier), WTF::move(attributeMap) });
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
            RETURN_IF_EXCEPTION(scope, {});
            JSValue moduleNativeValue = moduleNatives->getDirectIndex(globalObject, i);
            RETURN_IF_EXCEPTION(scope, {});

            ASSERT(specifierValue.isString());
            ASSERT(moduleNativeValue.isObject());

            WTF::String specifier = specifierValue.toWTFString(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
            JSObject* moduleNative = moduleNativeValue.getObject();
            RETURN_IF_EXCEPTION(scope, {});
            AbstractModuleRecord* resolvedRecord = jsCast<NodeVMModule*>(moduleNative)->moduleRecord(globalObject);
            RETURN_IF_EXCEPTION(scope, {});

            record->setImportedModule(globalObject, Identifier::fromString(vm, specifier), resolvedRecord);
            RETURN_IF_EXCEPTION(scope, {});
            m_resolveCache.set(WTF::move(specifier), WriteBarrier<JSObject> { vm, this, moduleNative });
            RETURN_IF_EXCEPTION(scope, {});
        }
    }

    NodeVMGlobalObject* nodeVmGlobalObject = getGlobalObjectFromContext(globalObject, m_context.get(), false);
    RETURN_IF_EXCEPTION(scope, {});
    if (nodeVmGlobalObject) {
        globalObject = nodeVmGlobalObject;
    }

    Synchronousness sync = record->link(globalObject, scriptFetcher);
    RETURN_IF_EXCEPTION(scope, {});

    if (sync == Synchronousness::Async) {
        RELEASE_ASSERT_NOT_REACHED_WITH_MESSAGE("TODO(@heimskr): async SourceTextModule linking");
    }

    status(Status::Linked);
    return jsUndefined();
}

JSValue NodeVMSourceTextModule::instantiate(JSGlobalObject* globalObject)
{
    return jsUndefined();
}

RefPtr<CachedBytecode> NodeVMSourceTextModule::bytecode(JSGlobalObject* globalObject)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (!m_bytecode) {
        if (!m_cachedExecutable) {
            ModuleProgramExecutable* executable = ModuleProgramExecutable::tryCreate(globalObject, m_sourceCode);
            RETURN_IF_EXCEPTION(scope, nullptr);
            if (!executable) {
                throwSyntaxError(globalObject, scope, "Failed to create cached executable"_s);
                return nullptr;
            }
            m_cachedExecutable.set(vm, this, executable);
        }
        m_bytecode = getBytecode(globalObject, m_cachedExecutable.get(), m_sourceCode);
        RETURN_IF_EXCEPTION(scope, nullptr);
    }

    return m_bytecode;
}

JSUint8Array* NodeVMSourceTextModule::cachedData(JSGlobalObject* globalObject)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (!m_cachedBytecodeBuffer) {
        RefPtr<CachedBytecode> cachedBytecode = bytecode(globalObject);
        RETURN_IF_EXCEPTION(scope, nullptr);
        std::span<const uint8_t> bytes = cachedBytecode->span();
        JSUint8Array* buffer = WebCore::createBuffer(globalObject, bytes);
        RETURN_IF_EXCEPTION(scope, nullptr);
        m_cachedBytecodeBuffer.set(vm, this, buffer);
    }

    return m_cachedBytecodeBuffer.get();
}

void NodeVMSourceTextModule::initializeImportMeta(JSGlobalObject* globalObject)
{
    if (!m_initializeImportMeta || !m_initializeImportMeta.get().isCallable()) {
        return;
    }

    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSModuleEnvironment* moduleEnvironment = m_moduleRecord->moduleEnvironmentMayBeNull();
    ASSERT(moduleEnvironment != nullptr);

    JSValue metaValue = moduleEnvironment->get(globalObject, globalObject->vm().propertyNames->builtinNames().metaPrivateName());
    scope.assertNoExceptionExceptTermination();
    RETURN_IF_EXCEPTION(scope, );
    if (!metaValue || !metaValue.isObject()) {
        return;
    }

    CallData callData = JSC::getCallData(m_initializeImportMeta.get());

    MarkedArgumentBuffer args;
    args.append(metaValue);
    args.append(m_moduleWrapper.get());

    JSC::call(globalObject, m_initializeImportMeta.get(), callData, jsUndefined(), args);
    scope.release();
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
    visitor.append(vmModule->m_initializeImportMeta);
}

DEFINE_VISIT_CHILDREN(NodeVMSourceTextModule);

const JSC::ClassInfo NodeVMSourceTextModule::s_info = { "NodeVMSourceTextModule"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(NodeVMSourceTextModule) };

} // namespace Bun
