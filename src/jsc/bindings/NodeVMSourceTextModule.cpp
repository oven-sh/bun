#include "NodeVMScriptFetcher.h"
#include "NodeVMSourceTextModule.h"
#include "CodeGenerationFromStrings.h"
#include "NodeVMSyntheticModule.h"

#include "ErrorCode.h"
#include "JSDOMExceptionHandling.h"

#include "wtf/HashSet.h"
#include "wtf/Scope.h"

#include "JavaScriptCore/BuiltinNames.h"
#include "JavaScriptCore/CodeCache.h"
#include "JavaScriptCore/JSModuleEnvironment.h"
#include "JavaScriptCore/JSModuleRecord.h"
#include "JavaScriptCore/JSPromise.h"
#include "JavaScriptCore/JSSourceCode.h"
#include "JavaScriptCore/ModuleAnalyzer.h"
#include "JavaScriptCore/ModuleProgramExecutable.h"
#include "JavaScriptCore/Parser.h"
#include "JavaScriptCore/SourceCodeKey.h"

namespace Bun {
using namespace NodeVM;

NodeVMSourceTextModule* NodeVMSourceTextModule::create(VM& vm, JSGlobalObject* globalObject, ArgList args)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    THROW_AND_RETURN_IF_CODE_GENERATION_FROM_STRINGS_IS_STRICT(globalObject, scope, nullptr);

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
        Bun::ERR::INVALID_ARG_INSTANCE(scope, globalObject, "options.cachedData"_s, "Buffer, TypedArray, or DataView"_s, cachedDataValue);
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

    SourceOrigin sourceOrigin { {}, *fetcher };

    WTF::String sourceText = sourceTextValue.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, nullptr);

    TextPosition startPosition = providerStartPosition(
        clampOffsetForSource(OrdinalNumber::fromZeroBasedInt(lineOffset), sourceText.length()),
        clampOffsetForSource(OrdinalNumber::fromZeroBasedInt(columnOffset), sourceText.length()));

    Ref<StringSourceProvider> sourceProvider = StringSourceProvider::create(WTF::move(sourceText), sourceOrigin, String {}, SourceTaintedOrigin::Untainted, startPosition, SourceProviderSourceType::Module);

    SourceCode sourceCode(WTF::move(sourceProvider));

    auto* zigGlobalObject = defaultGlobalObject(globalObject);
    WTF::String identifier = identifierValue.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, nullptr);
    NodeVMSourceTextModule* ptr = new (NotNull, allocateCell<NodeVMSourceTextModule>(vm)) NodeVMSourceTextModule(
        vm, zigGlobalObject->NodeVMSourceTextModuleStructure(), WTF::move(identifier), contextValue,
        WTF::move(sourceCode), moduleWrapper, initializeImportMeta);
    ptr->finishCreation(vm);

    // Like Node, reject an empty cachedData.
    if (cachedDataValue.isUndefined()) {
        return ptr;
    }

    // A syntax error wins over rejected cachedData, as in Node.
    ModuleProgramExecutable* executable = ModuleProgramExecutable::tryCreate(globalObject, ptr->sourceCode());
    RETURN_IF_EXCEPTION(scope, {});
    if (!executable) {
        throwSyntaxError(globalObject, scope, "Failed to create cached executable"_s);
        return nullptr;
    }

    // Decoding checks the format and the source key. Linking would need
    // the module's JSModuleEnvironment, which does not exist yet.
    if (RefPtr<CachedBytecode> cachedBytecode = unwrapCachedData(cachedData.span())) {
        LexicallyScopedFeatures lexicallyScopedFeatures = StrictModeLexicallyScopedFeature;
        SourceCodeKey key(ptr->sourceCode(), {}, SourceCodeType::ModuleType, lexicallyScopedFeatures, JSParserScriptMode::Module, DerivedContextType::None, EvalContextType::None, false, {}, std::nullopt);
        if (decodeCodeBlock<UnlinkedModuleProgramCodeBlock>(vm, key, cachedBytecode.releaseNonNull()))
            return ptr;
    }

    throwError(globalObject, scope, ErrorCode::ERR_VM_MODULE_CACHED_DATA_REJECTED, "cachedData buffer was rejected"_s);
    return nullptr;
}

void NodeVMSourceTextModule::destroy(JSCell* cell)
{
    static_cast<NodeVMSourceTextModule*>(cell)->NodeVMSourceTextModule::~NodeVMSourceTextModule();
}

JSModuleRecord* NodeVMSourceTextModule::analyzeSourceText(JSGlobalObject* globalObject, std::unique_ptr<ModuleProgramNode>& node)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    ParserError parserError;

    node = parseRootNode<ModuleProgramNode>(vm, m_sourceCode,
        ImplementationVisibility::Public,
        JSParserBuiltinMode::NotBuiltin,
        StrictModeLexicallyScopedFeature,
        JSParserScriptMode::Module,
        SourceParseMode::ModuleAnalyzeMode,
        parserError);

    if (parserError.isValid()) {
        throwException(globalObject, scope, parserError.toErrorObject(globalObject, m_sourceCode));
        return nullptr;
    }

    JSModuleLoader* loader = moduleLoader(globalObject);
    RETURN_IF_EXCEPTION(scope, nullptr);
    ModuleAnalyzer analyzer(globalObject, loader, Identifier::fromString(vm, m_identifier), m_sourceCode, AllFeatures);

    RETURN_IF_EXCEPTION(scope, nullptr);
    ASSERT(node != nullptr);

    auto result = analyzer.analyze(*node);
    if (!result) {
        auto [type, message] = result.error();
        throwError(globalObject, scope, ErrorCode::ERR_VM_MODULE_LINK_FAILURE, message);
        return nullptr;
    }
    return *result;
}

JSValue NodeVMSourceTextModule::createModuleRecord(JSGlobalObject* globalObject)
{
    if (m_moduleRequestsArray) {
        return m_moduleRequestsArray.get();
    }

    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    // A module without requests has no array to return again. Its record is still made once: importers link to it.
    if (JSModuleRecord* record = m_moduleRecord.get(); record && record->requestedModules().isEmpty())
        RELEASE_AND_RETURN(scope, constructEmptyArray(globalObject, nullptr, 0));

    std::unique_ptr<ModuleProgramNode> node;
    JSModuleRecord* moduleRecord = analyzeSourceText(globalObject, node);
    RETURN_IF_EXCEPTION(scope, {});

    m_moduleRecord.set(vm, this, moduleRecord);
    m_hasTopLevelAwait = node->features() & AwaitFeature;
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

    // JSC dedupes requests by specifier and type and keeps the first declaration's, so a declaration's position isn't its request's index.
    ModuleMap<ImportAttributesListNode*> attributesLists;
    for (StatementNode* statement = node->statements()->firstStatement(); statement; statement = statement->next()) {
        if (!statement->isModuleDeclarationNode() || !static_cast<ModuleDeclarationNode*>(statement)->isImportDeclarationNode())
            continue;
        auto* importDeclaration = static_cast<ImportDeclarationNode*>(statement);
        ImportAttributesListNode* attributesList = importDeclaration->attributesList();
        auto type = ScriptFetchParameters::Type::JavaScript;
        if (attributesList) {
            for (auto [key, value] : attributesList->attributes()) {
                if (*key == vm.propertyNames->type)
                    type = ScriptFetchParameters::parseType(value->impl()).value_or(type);
            }
        }
        attributesLists.add(ModuleMapKey { importDeclaration->moduleName()->moduleName().impl(), type }, attributesList);
    }

    for (unsigned i = 0; i < requests.size(); ++i) {
        const auto& request = requests[i];

        JSString* specifierValue = JSC::jsString(vm, request.m_specifier.string());

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

        if (ImportAttributesListNode* attributesList = attributesLists.get(ModuleMapKey { request.m_specifier.impl(), request.m_attributes ? request.m_attributes->type() : ScriptFetchParameters::Type::JavaScript })) {
            for (auto [key, value] : attributesList->attributes()) {
                attributeMap.set(key->string(), value->string());
                attributesObject->putDirectMayBeIndex(globalObject, *key, JSC::jsString(vm, value->string()));
                RETURN_IF_EXCEPTION(scope, {});
            }
        }

        requestObject->putDirect(vm, attributesIdentifier, attributesObject);
        addModuleRequest({ request.m_specifier.string(), WTF::move(attributeMap) });
        requestsArray->putDirectIndex(globalObject, i, requestObject);
        RETURN_IF_EXCEPTION(scope, {});
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

// An own element of `array` that is plain data, read without running JS. Empty for a hole and for an accessor.
static JSValue ownDataElement(JSGlobalObject* globalObject, JSArray* array, unsigned index)
{
    if (array->canGetIndexQuickly(index))
        return array->getIndexQuickly(index);

    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    PropertySlot slot(array, PropertySlot::InternalMethodType::GetOwnProperty);
    bool hasSlot = array->methodTable()->getOwnPropertySlotByIndex(array, globalObject, index, slot);
    RETURN_IF_EXCEPTION(scope, {});
    if (!hasSlot || !slot.isValue())
        return {};
    RELEASE_AND_RETURN(scope, slot.getValue(globalObject, index));
}

JSValue NodeVMSourceTextModule::link(JSGlobalObject* globalObject, JSArray* moduleNatives)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    // Only the constructor of SourceTextModule makes the record: the native object of another subclass of vm.Module has none.
    ensureModuleRecord(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    if (m_status != Status::Unlinked) {
        throwError(globalObject, scope, ErrorCode::ERR_VM_MODULE_STATUS, "Module must be unlinked before linking"_s);
        return {};
    }

    JSModuleRecord* record = m_moduleRecord.get();

    // The Link() of an importer already linked this record. It keeps the modules it linked with, as in Node.
    if (record->status() >= JSC::CyclicModuleRecord::Status::Linked) {
        m_linkCalled = true;
        return jsUndefined();
    }

    const auto& requested = record->requestedModules();
    const unsigned length = moduleNatives->getArrayLength();
    if (length != requested.size()) {
        Bun::ERR::INVALID_ARG_VALUE(scope, globalObject, "moduleNatives"_s, moduleNatives, "must have one module for each module request"_str);
        return {};
    }

    // Made at the first module that differs: every importer of a module that is not linked yet links it again with the modules it has.
    JSCellButterfly* linkedModules = nullptr;
    bool hasDeferredRequest = false;
    for (unsigned i = 0; i < length; i++) {
        JSValue moduleNativeValue = ownDataElement(globalObject, moduleNatives, i);
        RETURN_IF_EXCEPTION(scope, {});
        // An empty JSValue passes isCell() with a null cell, so it must be rejected before any use.
        NodeVMModule* moduleNative = moduleNativeValue.isEmpty() ? nullptr : dynamicDowncast<NodeVMModule>(moduleNativeValue);
        if (!moduleNative) {
            Bun::ERR::INVALID_THIS(scope, globalObject, "Module"_s);
            return {};
        }
        hasDeferredRequest |= requested[i].m_phase == AbstractModuleRecord::ModulePhase::Defer;

        if (!linkedModules) {
            if (m_linkedModules && linkedModule(i) == moduleNative)
                continue;
            linkedModules = JSCellButterfly::tryCreate(vm, CopyOnWriteArrayWithContiguous, length);
            if (!linkedModules) [[unlikely]] {
                throwOutOfMemoryError(globalObject, scope);
                return {};
            }
            for (unsigned j = 0; j < i; j++)
                linkedModules->setIndex(vm, j, linkedModule(j));
        }
        linkedModules->setIndex(vm, i, moduleNative);
    }

    // `import defer` and `import` of one specifier are two requests and one imported module of the record.
    if (linkedModules && hasDeferredRequest) [[unlikely]] {
        ModuleMap<unsigned> firstRequestOfKey;
        for (unsigned i = 0; i < length; i++) {
            auto added = firstRequestOfKey.add(ModuleMapKey { requested[i].m_specifier.impl(), requested[i].type() }, i);
            if (added.isNewEntry || linkedModules->get(added.iterator->value) == linkedModules->get(i))
                continue;
            // The specifier comes from the module's source, so from JS.
            MessageBuilder message;
            message.append("Module request '"_s, requested[i].m_specifier.string(), "' at index "_s, i, " must be linked to the same module requested at index "_s, added.iterator->value);
            throwError(globalObject, scope, ErrorCode::ERR_MODULE_LINK_MISMATCH, message);
            return {};
        }
    }

    if (linkedModules)
        m_linkedModules.set(vm, this, linkedModules);

    m_linkCalled = true;
    // Status stays Unlinked: matching Node, only instantiate() flips a
    // SourceTextModule to "linked" (linkRequests() alone must leave the
    // module unlinked, and a failed instantiate() must remain retryable).
    return jsUndefined();
}

// A failed Link() leaves environments, namespace objects and resolved exports on the records that did not link, all made for the modules those records had.
void NodeVMSourceTextModule::renewRecordAfterFailedLink(JSGlobalObject* globalObject)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    // Only bindLinkedModules() moves a record from New to Unlinked, immediately before Link().
    if (m_moduleRecord->status() != JSC::CyclicModuleRecord::Status::Unlinked)
        return;

    std::unique_ptr<ModuleProgramNode> node;
    JSModuleRecord* record = analyzeSourceText(globalObject, node);
    RETURN_IF_EXCEPTION(scope, );
    m_moduleRecord.set(vm, this, record);
}

// Link() reads the imported modules of every record that is not linked yet, and dereferences end() for a request that has none (https://github.com/oven-sh/bun/issues/31623).
bool NodeVMSourceTextModule::bindLinkedModules(JSGlobalObject* globalObject, String& missingSpecifier)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    // Iterative: a chain of imports is as deep as it is long, and Link() has its own stack check with a catchable RangeError.
    WTF::HashSet<NodeVMSourceTextModule*> bound;
    WTF::Vector<NodeVMSourceTextModule*, 16> worklist;

    renewRecordAfterFailedLink(globalObject);
    RETURN_IF_EXCEPTION(scope, false);
    worklist.append(this);

    while (!worklist.isEmpty()) {
        NodeVMSourceTextModule* module = worklist.takeLast();
        JSModuleRecord* record = module->m_moduleRecord.get();
        // Link() does not read the requests of a record that is linked already.
        if (record->status() != JSC::CyclicModuleRecord::Status::New || !bound.add(module).isNewEntry)
            continue;

        const auto& requested = record->requestedModules();
        if (module->linkedModuleCount() != requested.size()) {
            missingSpecifier = requested.first().m_specifier.string();
            return false;
        }

        for (unsigned i = 0; i < requested.size(); ++i) {
            NodeVMModule* dependency = module->linkedModule(i);
            AbstractModuleRecord* dependencyRecord = dependency->moduleRecord(globalObject);
            RETURN_IF_EXCEPTION(scope, false);
            if (auto* sourceTextDependency = dynamicDowncast<NodeVMSourceTextModule>(dependency)) {
                // Before any importer takes the record: the one a module has now is what Node's ResolveModuleCallback returns too.
                sourceTextDependency->renewRecordAfterFailedLink(globalObject);
                RETURN_IF_EXCEPTION(scope, false);
                dependencyRecord = sourceTextDependency->m_moduleRecord.get();
                worklist.append(sourceTextDependency);
            }
            record->setImportedModule(globalObject, requested[i], dependencyRecord);
            RETURN_IF_EXCEPTION(scope, false);
        }
    }

    // Link() asserts that every record it visits is past New. Unlinked from here on means that a Link() has run on the record.
    for (NodeVMSourceTextModule* module : bound)
        module->m_moduleRecord->setStatus(JSC::CyclicModuleRecord::Status::Unlinked);
    return true;
}

JSValue NodeVMSourceTextModule::instantiate(JSGlobalObject* globalObject)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (!m_moduleRecord)
        return jsUndefined();

    if (!m_linkCalled) {
        throwError(globalObject, scope, ErrorCode::ERR_VM_MODULE_LINK_FAILURE, "module is not linked"_s);
        return {};
    }

    JSGlobalObject* callerGlobalObject = globalObject;
    NodeVMGlobalObject* nodeVmGlobalObject = getGlobalObjectFromContext(globalObject, m_context.get(), false);
    RETURN_IF_EXCEPTION(scope, {});
    if (nodeVmGlobalObject)
        globalObject = nodeVmGlobalObject;

    String missingSpecifier;
    bool isBound = bindLinkedModules(callerGlobalObject, missingSpecifier);
    RETURN_IF_EXCEPTION(scope, {});
    if (!isBound) {
        // The specifier comes from the module's source, so from JS.
        MessageBuilder message;
        message.append("request for '"_s, missingSpecifier, "' is not in cache"_s);
        throwError(globalObject, scope, ErrorCode::ERR_VM_MODULE_LINK_FAILURE, message);
        return {};
    }

    m_moduleRecord->link(globalObject, nullptr);
    RETURN_IF_EXCEPTION(scope, {});

    status(Status::Linked);
    propagateLinked();
    return jsUndefined();
}

RefPtr<CachedBytecode> NodeVMSourceTextModule::bytecode(JSGlobalObject* globalObject)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (!m_bytecode) {
        m_bytecode = getBytecode(globalObject, SourceCodeType::ModuleType, m_sourceCode);
        if (!m_bytecode) {
            throwSyntaxError(globalObject, scope, "Failed to create cached data"_s);
            return nullptr;
        }
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
        // getBytecode can return null without throwing (serialization failure).
        if (!cachedBytecode) [[unlikely]] {
            throwVMError(globalObject, scope, "createCachedData failed"_s);
            return nullptr;
        }
        JSUint8Array* buffer = createCachedDataBuffer(globalObject, cachedBytecode->span());
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

    scope.release();
    JSC::call(globalObject, m_initializeImportMeta.get(), callData, jsUndefined(), args);
}

JSObject* NodeVMSourceTextModule::createPrototype(VM& vm, JSGlobalObject* globalObject)
{
    return NodeVMModulePrototype::create(vm, NodeVMModulePrototype::createStructure(vm, globalObject, globalObject->objectPrototype()));
}

template<typename Visitor>
void NodeVMSourceTextModule::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* vmModule = uncheckedDowncast<NodeVMSourceTextModule>(cell);
    ASSERT_GC_OBJECT_INHERITS(vmModule, info());
    Base::visitChildren(vmModule, visitor);

    visitor.append(vmModule->m_moduleRecord);
    visitor.append(vmModule->m_moduleRequestsArray);
    visitor.append(vmModule->m_cachedBytecodeBuffer);
    visitor.append(vmModule->m_initializeImportMeta);
    NodeVMScriptFetcher::visitSource(visitor, vmModule->m_sourceCode);
}

DEFINE_VISIT_CHILDREN(NodeVMSourceTextModule);

const JSC::ClassInfo NodeVMSourceTextModule::s_info = { "NodeVMSourceTextModule"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(NodeVMSourceTextModule) };

} // namespace Bun
