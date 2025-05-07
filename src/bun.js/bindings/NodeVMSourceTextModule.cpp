#include "NodeVMSourceTextModule.h"

#include "ErrorCode.h"
#include "JSDOMExceptionHandling.h"
#include "JSModuleRecord.h"
#include "ModuleAnalyzer.h"
#include "Parser.h"

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
        throwArgumentTypeError(*globalObject, scope, 5, "cachedData"_s, "Module"_s, "Module"_s, "Buffer, TypedArray, or DataView"_s);
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
    return ptr;
}

void NodeVMSourceTextModule::destroy(JSCell* cell)
{
    static_cast<NodeVMSourceTextModule*>(cell)->NodeVMSourceTextModule::~NodeVMSourceTextModule();
}

JSValue NodeVMSourceTextModule::createModuleRecord(JSGlobalObject* globalObject)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (m_moduleRecord) {
        throwError(globalObject, scope, ErrorCode::ERR_VM_MODULE_ALREADY_LINKED, "Module record already present"_s);
        return {};
    }

    ModuleAnalyzer analyzer(globalObject, Identifier::fromString(vm, m_identifier), m_sourceCode, {}, {}, AllFeatures);

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
        return JSC::constructEmptyArray(globalObject, nullptr, 0);
    }

    JSArray* requestsArray = JSC::constructEmptyArray(globalObject, nullptr, requests.size());

    const auto& builtinNames = WebCore::clientData(vm)->builtinNames();
    const JSC::Identifier& specifierIdentifier = builtinNames.specifierPublicName();
    const JSC::Identifier& attributesIdentifier = builtinNames.attributesPublicName();
    const JSC::Identifier& hostDefinedImportTypeIdentifier = builtinNames.hostDefinedImportTypePublicName();

    for (unsigned i = 0; i < requests.size(); ++i) {
        const auto& request = requests[i];

        JSString* specifierValue = JSC::jsString(vm, WTF::String(*request.m_specifier));

        JSObject* requestObject = constructEmptyObject(globalObject, globalObject->objectPrototype(), 2);
        requestObject->putDirect(vm, specifierIdentifier, specifierValue);

        WTF::String attributesTypeString = "unknown"_str;

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

            WTF::HashMap<WTF::String, WTF::String> attributeMap {
                { "type"_s, attributesTypeString },
            };

            JSObject* attributesObject = constructEmptyObject(globalObject, globalObject->objectPrototype(), 1);
            attributesObject->putDirect(vm, JSC::Identifier::fromString(vm, "type"_s), attributesType);
            if (const String& hostDefinedImportType = request.m_attributes->hostDefinedImportType(); !hostDefinedImportType.isEmpty()) {
                attributesObject->putDirect(vm, hostDefinedImportTypeIdentifier, JSC::jsString(vm, hostDefinedImportType));
                attributeMap.set("hostDefinedImportType"_s, hostDefinedImportType);
            }
            requestObject->putDirect(vm, attributesIdentifier, attributesObject);
            addModuleRequest({ WTF::String(*request.m_specifier), WTFMove(attributeMap) });
        } else {
            addModuleRequest({ WTF::String(*request.m_specifier), {} });
            requestObject->putDirect(vm, attributesIdentifier, JSC::jsNull());
        }

        requestsArray->putDirectIndex(globalObject, i, requestObject);
    }

    return requestsArray;
}

JSValue NodeVMSourceTextModule::link(JSGlobalObject* globalObject, JSArray* specifiers, JSArray* moduleNatives)
{
    const unsigned length = specifiers->getArrayLength();
    ASSERT(length == moduleNatives->getArrayLength());

    if (length != 0) {
        VM& vm = globalObject->vm();
        auto scope = DECLARE_THROW_SCOPE(vm);

        for (unsigned i = 0; i < length; i++) {
            JSValue specifierValue = specifiers->getDirectIndex(globalObject, i);
            JSValue moduleNativeValue = moduleNatives->getDirectIndex(globalObject, i);

            ASSERT(specifierValue.isString());
            ASSERT(moduleNativeValue.isObject());

            WTF::String specifier = specifierValue.toWTFString(globalObject);
            JSObject* moduleNative = moduleNativeValue.getObject();

            m_resolveCache.set(WTFMove(specifier), WriteBarrier<JSObject> { vm, this, moduleNative });
        }
    }

    if (NodeVMGlobalObject* nodeVmGlobalObject = getGlobalObjectFromContext(globalObject, m_context.get(), false)) {
        globalObject = nodeVmGlobalObject;
    }

    JSModuleRecord* record = m_moduleRecord.get();
    Synchronousness sync = record->link(globalObject, jsUndefined());

    if (sync == Synchronousness::Async) {
        ASSERT_NOT_REACHED_WITH_MESSAGE("TODO(@heimskr): async module linking");
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
        // TODO(@heimskr): top-level await support
        result = record->evaluate(globalObject, jsUndefined(), jsNumber(static_cast<int32_t>(JSGenerator::ResumeMode::NormalMode)));
    };

    if (timeout != 0 && breakOnSigint) {
        // TODO(@heimskr): timeout support
        auto holder = SigintWatcher::hold(nodeVmGlobalObject);
        run();
    } else if (timeout != 0) {
        // TODO(@heimskr): timeout support
        run();
    } else if (breakOnSigint) {
        auto holder = SigintWatcher::hold(nodeVmGlobalObject);
        run();
    } else {
        run();
    }

    RETURN_IF_EXCEPTION(scope, (status(Status::Errored), JSValue {}));
    status(Status::Evaluated);
    return result;
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
}

DEFINE_VISIT_CHILDREN(NodeVMSourceTextModule);

const JSC::ClassInfo NodeVMSourceTextModule::s_info = { "NodeVMSourceTextModule"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(NodeVMSourceTextModule) };

} // namespace Bun
