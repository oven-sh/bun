#pragma once

#include "root.h"
#include "ZigGlobalObject.h"
#include "BunGlobalScope.h"

#include <JavaScriptCore/JSFunction.h>
#include <JavaScriptCore/VM.h>

#include "headers-handwritten.h"
#include "BunClientData.h"
#include <JavaScriptCore/CallFrame.h>
#include <JavaScriptCore/Nodes.h>

namespace Bun {

class NodeVMGlobalObject;
class NodeVMContextOptions;
class CompileFunctionOptions;

namespace NodeVM {

RefPtr<JSC::CachedBytecode> getBytecode(JSGlobalObject* globalObject, JSC::ProgramExecutable* executable, const JSC::SourceCode& source);
RefPtr<JSC::CachedBytecode> getBytecode(JSGlobalObject* globalObject, JSC::ModuleProgramExecutable* executable, const JSC::SourceCode& source);
bool extractCachedData(JSValue cachedDataValue, WTF::Vector<uint8_t>& outCachedData);
String stringifyAnonymousFunction(JSGlobalObject* globalObject, const ArgList& args, ThrowScope& scope, int* outOffset);
JSC::EncodedJSValue createCachedData(JSGlobalObject* globalObject, const JSC::SourceCode& source);
bool handleException(JSGlobalObject* globalObject, VM& vm, NakedPtr<JSC::Exception> exception, ThrowScope& throwScope);
std::optional<JSC::EncodedJSValue> getNodeVMContextOptions(JSGlobalObject* globalObject, JSC::VM& vm, JSC::ThrowScope& scope, JSValue optionsArg, NodeVMContextOptions& outOptions, ASCIILiteral codeGenerationKey);
NodeVMGlobalObject* getGlobalObjectFromContext(JSGlobalObject* globalObject, JSValue contextValue, bool canThrow);
JSC::EncodedJSValue INVALID_ARG_VALUE_VM_VARIATION(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, WTF::ASCIILiteral name, JSC::JSValue value);
// For vm.compileFunction we need to return an anonymous function expression. This code is adapted from/inspired by JSC::constructFunction, which is used for function declarations.
JSC::JSFunction* constructAnonymousFunction(JSC::JSGlobalObject* globalObject, const ArgList& args, const SourceOrigin& sourceOrigin, CompileFunctionOptions&& options, JSC::SourceTaintedOrigin sourceTaintOrigin, JSC::JSScope* scope);
JSInternalPromise* importModule(JSGlobalObject* globalObject, JSString* moduleNameValue, JSValue parameters, const SourceOrigin& sourceOrigin);
bool isContext(JSGlobalObject* globalObject, JSValue);
bool getContextArg(JSGlobalObject* globalObject, JSValue& contextArg);
bool isUseMainContextDefaultLoaderConstant(JSValue value);

} // namespace NodeVM

class BaseVMOptions {
public:
    String filename;
    OrdinalNumber lineOffset = OrdinalNumber::fromZeroBasedInt(0);
    OrdinalNumber columnOffset = OrdinalNumber::fromZeroBasedInt(0);
    bool failed = false;

    BaseVMOptions() = default;
    BaseVMOptions(String filename);
    BaseVMOptions(String filename, OrdinalNumber lineOffset, OrdinalNumber columnOffset);

    bool fromJS(JSC::JSGlobalObject* globalObject, JSC::VM& vm, JSC::ThrowScope& scope, JSC::JSValue optionsArg);
    bool validateProduceCachedData(JSC::JSGlobalObject* globalObject, JSC::VM& vm, JSC::ThrowScope& scope, JSObject* options, bool& outProduceCachedData);
    bool validateCachedData(JSC::JSGlobalObject* globalObject, JSC::VM& vm, JSC::ThrowScope& scope, JSObject* options, WTF::Vector<uint8_t>& outCachedData);
    bool validateTimeout(JSC::JSGlobalObject* globalObject, JSC::VM& vm, JSC::ThrowScope& scope, JSObject* options, std::optional<int64_t>& outTimeout);
};

class CompileFunctionOptions : public BaseVMOptions {
public:
    WTF::Vector<uint8_t> cachedData;
    JSGlobalObject* parsingContext = nullptr;
    JSValue contextExtensions {};
    JSValue importer {};
    bool produceCachedData = false;

    using BaseVMOptions::BaseVMOptions;

    bool fromJS(JSC::JSGlobalObject* globalObject, JSC::VM& vm, JSC::ThrowScope& scope, JSC::JSValue optionsArg);
};

class NodeVMContextOptions final {
public:
    bool allowStrings = true;
    bool allowWasm = true;
    bool notContextified = false;
};

class NodeVMGlobalObject;

class NodeVMSpecialSandbox final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;

    static constexpr unsigned StructureFlags = Base::StructureFlags | JSC::OverridesGetOwnPropertySlot;

    static NodeVMSpecialSandbox* create(VM& vm, Structure* structure, NodeVMGlobalObject* globalObject);

    DECLARE_INFO;
    template<typename, JSC::SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm);
    static Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype);

    static bool getOwnPropertySlot(JSObject*, JSGlobalObject*, JSC::PropertyName, JSC::PropertySlot&);

    NodeVMGlobalObject* parentGlobal() const { return m_parentGlobal.get(); }

private:
    WriteBarrier<NodeVMGlobalObject> m_parentGlobal;

    NodeVMSpecialSandbox(VM& vm, Structure* structure, NodeVMGlobalObject* globalObject);

    void finishCreation(VM&);
};

// This class represents a sandboxed global object for vm contexts
class NodeVMGlobalObject final : public Bun::GlobalScope {
public:
    using Base = Bun::GlobalScope;

    static constexpr unsigned StructureFlags = Base::StructureFlags | JSC::OverridesGetOwnPropertySlot | JSC::OverridesPut | JSC::OverridesGetOwnPropertyNames | JSC::GetOwnPropertySlotMayBeWrongAboutDontEnum | JSC::ProhibitsPropertyCaching;
    static constexpr JSC::DestructionMode needsDestruction = NeedsDestruction;

    template<typename, JSC::SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm);
    static NodeVMGlobalObject* create(JSC::VM& vm, JSC::Structure* structure, NodeVMContextOptions options);
    static Structure* createStructure(JSC::VM& vm, JSC::JSValue prototype);
    static const JSC::GlobalObjectMethodTable& globalObjectMethodTable();

    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;

    ~NodeVMGlobalObject();

    void finishCreation(JSC::VM&);
    static void destroy(JSCell* cell);
    void setContextifiedObject(JSC::JSObject* contextifiedObject);
    JSC::JSObject* contextifiedObject() const { return m_sandbox.get(); }
    void clearContextifiedObject();
    void sigintReceived();
    bool isNotContextified() const { return m_contextOptions.notContextified; }
    NodeVMSpecialSandbox* specialSandbox() const { return m_specialSandbox.get(); }
    void setSpecialSandbox(NodeVMSpecialSandbox* sandbox) { m_specialSandbox.set(vm(), this, sandbox); }

    // Override property access to delegate to contextified object
    static bool getOwnPropertySlot(JSObject*, JSGlobalObject*, JSC::PropertyName, JSC::PropertySlot&);
    static bool put(JSCell*, JSGlobalObject*, JSC::PropertyName, JSC::JSValue, JSC::PutPropertySlot&);
    static void getOwnPropertyNames(JSObject*, JSGlobalObject*, JSC::PropertyNameArray&, JSC::DontEnumPropertiesMode);
    static bool defineOwnProperty(JSObject* object, JSGlobalObject* globalObject, PropertyName propertyName, const PropertyDescriptor& descriptor, bool shouldThrow);
    static bool deleteProperty(JSCell* cell, JSGlobalObject* globalObject, PropertyName propertyName, JSC::DeletePropertySlot& slot);
    static JSC::JSInternalPromise* moduleLoaderImportModule(JSGlobalObject*, JSC::JSModuleLoader*, JSC::JSString* moduleNameValue, JSC::JSValue parameters, const JSC::SourceOrigin&);

private:
    // The contextified object that acts as the global proxy
    JSC::WriteBarrier<JSC::JSObject> m_sandbox;
    // A special object used when the context is not contextified.
    JSC::WriteBarrier<NodeVMSpecialSandbox> m_specialSandbox;
    NodeVMContextOptions m_contextOptions {};

    NodeVMGlobalObject(JSC::VM& vm, JSC::Structure* structure, NodeVMContextOptions contextOptions);
};

// Helper functions to create vm contexts and run code
JSC::JSValue createNodeVMBinding(Zig::GlobalObject*);
Structure* createNodeVMGlobalObjectStructure(JSC::VM&);
void configureNodeVM(JSC::VM&, Zig::GlobalObject*);

// VM module functions
JSC_DECLARE_HOST_FUNCTION(vmModule_createContext);
JSC_DECLARE_HOST_FUNCTION(vmModule_isContext);
JSC_DECLARE_HOST_FUNCTION(vmModuleRunInNewContext);
JSC_DECLARE_HOST_FUNCTION(vmModuleRunInThisContext);

} // namespace Bun
