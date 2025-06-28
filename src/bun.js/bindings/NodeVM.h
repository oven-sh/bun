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
NodeVMGlobalObject* createContextImpl(JSC::VM& vm, JSGlobalObject* globalObject, JSObject* sandbox);
bool handleException(JSGlobalObject* globalObject, VM& vm, NakedPtr<JSC::Exception> exception, ThrowScope& throwScope);
std::optional<JSC::EncodedJSValue> getNodeVMContextOptions(JSGlobalObject* globalObject, JSC::VM& vm, JSC::ThrowScope& scope, JSValue optionsArg, NodeVMContextOptions& outOptions, ASCIILiteral codeGenerationKey);
NodeVMGlobalObject* getGlobalObjectFromContext(JSGlobalObject* globalObject, JSValue contextValue, bool canThrow);
JSC::EncodedJSValue INVALID_ARG_VALUE_VM_VARIATION(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, WTF::ASCIILiteral name, JSC::JSValue value);
// For vm.compileFunction we need to return an anonymous function expression. This code is adapted from/inspired by JSC::constructFunction, which is used for function declarations.
JSC::JSFunction* constructAnonymousFunction(JSC::JSGlobalObject* globalObject, const ArgList& args, const SourceOrigin& sourceOrigin, CompileFunctionOptions&& options, JSC::SourceTaintedOrigin sourceTaintOrigin, JSC::JSScope* scope);
JSInternalPromise* importModule(JSGlobalObject* globalObject, JSString* moduleNameValue, JSValue parameters, const SourceOrigin& sourceOrigin);

} // namespace NodeVM

// This class represents a sandboxed global object for vm contexts
class NodeVMGlobalObject final : public Bun::GlobalScope {
    using Base = Bun::GlobalScope;

public:
    static constexpr unsigned StructureFlags = Base::StructureFlags | JSC::OverridesGetOwnPropertySlot | JSC::OverridesPut | JSC::OverridesGetOwnPropertyNames | JSC::GetOwnPropertySlotMayBeWrongAboutDontEnum | JSC::ProhibitsPropertyCaching;
    static constexpr JSC::DestructionMode needsDestruction = NeedsDestruction;

    template<typename, JSC::SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm);
    static NodeVMGlobalObject* create(JSC::VM& vm, JSC::Structure* structure, NodeVMContextOptions options);
    static Structure* createStructure(JSC::VM& vm, JSC::JSValue prototype);

    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;

    void finishCreation(JSC::VM&, NodeVMContextOptions options);
    static void destroy(JSCell* cell);
    void setContextifiedObject(JSC::JSObject* contextifiedObject);
    JSC::JSObject* contextifiedObject() const { return m_sandbox.get(); }
    void clearContextifiedObject();
    void sigintReceived();

    // Override property access to delegate to contextified object
    static bool getOwnPropertySlot(JSObject*, JSGlobalObject*, JSC::PropertyName, JSC::PropertySlot&);
    static bool put(JSCell*, JSGlobalObject*, JSC::PropertyName, JSC::JSValue, JSC::PutPropertySlot&);
    static void getOwnPropertyNames(JSObject*, JSGlobalObject*, JSC::PropertyNameArray&, JSC::DontEnumPropertiesMode);
    static bool defineOwnProperty(JSObject* object, JSGlobalObject* globalObject, PropertyName propertyName, const PropertyDescriptor& descriptor, bool shouldThrow);
    static bool deleteProperty(JSCell* cell, JSGlobalObject* globalObject, PropertyName propertyName, JSC::DeletePropertySlot& slot);

private:
    NodeVMGlobalObject(JSC::VM& vm, JSC::Structure* structure);
    ~NodeVMGlobalObject();

    // The contextified object that acts as the global proxy
    mutable JSC::WriteBarrier<JSC::JSObject> m_sandbox;
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
};

} // namespace Bun
