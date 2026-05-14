#pragma once

#include "root.h"
#include "JSBuffer.h"
#include "helpers.h"
#include "ncrypto.h"
#include <JavaScriptCore/LazyProperty.h>
#include <JavaScriptCore/LazyPropertyInlines.h>

namespace Bun {

class JSVerify;
class JSVerifyPrototype;
class JSVerifyConstructor;

// Function to handle JWK format keys
std::optional<ncrypto::EVPKeyPointer> getKeyObjectHandleFromJwk(JSC::JSGlobalObject* lexicalGlobalObject, JSC::ThrowScope& scope, JSC::JSValue key, bool isPublic);

class JSVerify final : public JSC::JSDestructibleObject {
public:
    using Base = JSC::JSDestructibleObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSVerify* create(JSC::VM& vm, JSC::Structure* structure, JSC::JSGlobalObject* globalObject);
    static void destroy(JSC::JSCell* cell);
    ~JSVerify();
    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype);

    template<typename CellType, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm);

    DECLARE_INFO;

    ncrypto::EVPMDCtxPointer m_mdCtx;

private:
    JSVerify(JSC::VM& vm, JSC::Structure* structure);
    void finishCreation(JSC::VM& vm, JSC::JSGlobalObject* globalObject);
};

class JSVerifyPrototype final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSVerifyPrototype* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure);
    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype);

    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        return &vm.plainObjectSpace();
    }

    DECLARE_INFO;

private:
    JSVerifyPrototype(JSC::VM& vm, JSC::Structure* structure);
    void finishCreation(JSC::VM& vm);
};

class JSVerifyConstructor final : public JSC::InternalFunction {
public:
    using Base = JSC::InternalFunction;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSVerifyConstructor* create(JSC::VM& vm, JSC::Structure* structure, JSC::JSObject* prototype);
    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype);

    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        return &vm.internalFunctionSpace();
    }

    DECLARE_INFO;

private:
    JSVerifyConstructor(JSC::VM& vm, JSC::Structure* structure);
    void finishCreation(JSC::VM& vm, JSC::JSObject* prototype);
};

void setupJSVerifyClassStructure(JSC::LazyClassStructure::Initializer& init);

} // namespace Bun
