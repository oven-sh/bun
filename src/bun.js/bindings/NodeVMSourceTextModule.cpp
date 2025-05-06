#include "NodeVMSourceTextModule.h"

#include "ErrorCode.h"
#include "JSDOMExceptionHandling.h"
#include "JSModuleRecord.h"
#include "ModuleAnalyzer.h"

#include <print>

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
    NodeVMSourceTextModule* ptr = new (NotNull, allocateCell<NodeVMSourceTextModule>(vm)) NodeVMSourceTextModule(vm, zigGlobalObject->NodeVMSourceTextModuleStructure(), identifierValue.toWTFString(globalObject), WTFMove(sourceCode));
    ptr->finishCreation(vm);
    return ptr;
}

void NodeVMSourceTextModule::destroy(JSCell* cell)
{
    static_cast<NodeVMSourceTextModule*>(cell)->NodeVMSourceTextModule::~NodeVMSourceTextModule();
}

bool NodeVMSourceTextModule::createModuleRecord(JSGlobalObject* globalObject)
{
    if (m_moduleRecord) {
        return false;
    }

    VM& vm = globalObject->vm();

    ModuleAnalyzer analyzer(globalObject, Identifier::fromString(vm, m_identifier), m_sourceCode, {}, {}, AllFeatures);

    JSModuleRecord* moduleRecord = JSModuleRecord::create(globalObject, vm, globalObject->m_moduleRecordStructure.get(globalObject), Identifier::fromString(vm, m_identifier), m_sourceCode, {}, {}, AllFeatures);
    m_moduleRecord.set(vm, this, moduleRecord);

    std::println("link synchronousness: {}", int(moduleRecord->link(globalObject, JSC::jsUndefined())));

    const auto& requests = moduleRecord->requestedModules();

    std::println("requests: {}", requests.size());

    for (const auto& request : requests) {
        std::println("request: {}", request.m_specifier->utf8().data());
    }

    return true;
}

EncodedJSValue NodeVMSourceTextModule::link(JSGlobalObject* globalObject, JSArray* specifiers, JSArray* moduleNatives)
{
    const unsigned length = specifiers->getArrayLength();
    ASSERT(length == moduleNatives->getArrayLength());
    if (length == 0) {
        return JSC::encodedJSUndefined();
    }

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

    return JSC::encodedJSUndefined();
}

// EncodedJSValue NodeVMSourceTextModule::link(JSGlobalObject* globalObject, JSValue linker)
// {
//     VM& vm = globalObject->vm();
//     auto scope = DECLARE_THROW_SCOPE(vm);

//     if (status() != Status::Unlinked) {
//         throwError(globalObject, scope, ErrorCode::ERR_VM_MODULE_ALREADY_LINKED, "Module is already linked"_s);
//         return {};
//     }

//     status(Status::Linking);

//     JSModuleRecord* moduleRecord = JSModuleRecord::create(globalObject, vm, globalObject->m_moduleRecordStructure.get(globalObject), Identifier::fromString(vm, m_identifier), m_sourceCode, {}, {}, AllFeatures);

//     Synchronousness synchronousness = moduleRecord->link(globalObject, linker);

//     std::println("synchronousness: {}", int(synchronousness));

//     if (synchronousness == Synchronousness::Sync) {
//         status(Status::Linked);
//     }

//     m_moduleRecord.set(vm, this, moduleRecord);

//     return JSC::encodedJSUndefined();
// }

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
