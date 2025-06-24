#pragma once

#include "root.h"
#include "JSBuffer.h"
#include "helpers.h"
#include "ncrypto.h"
#include "CryptoUtil.h"
#include <JavaScriptCore/LazyProperty.h>
#include <JavaScriptCore/LazyPropertyInlines.h>

namespace Bun {

// JSC_DECLARE_HOST_FUNCTION(jsSignOneShot);

class JSSign;
class JSSignPrototype;
class JSSignConstructor;

class JSSign final : public JSC::JSDestructibleObject {
public:
    using Base = JSC::JSDestructibleObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSSign* create(JSC::VM& vm, JSC::Structure* structure);
    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype);

    static void destroy(JSC::JSCell* cell);
    ~JSSign();

    template<typename CellType, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm);

    DECLARE_INFO;

    ncrypto::EVPMDCtxPointer m_mdCtx;

private:
    JSSign(JSC::VM& vm, JSC::Structure* structure);
    void finishCreation(JSC::VM& vm);
};

class JSSignPrototype final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSSignPrototype* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure);
    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype);

    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        return &vm.plainObjectSpace();
    }

    DECLARE_INFO;

private:
    JSSignPrototype(JSC::VM& vm, JSC::Structure* structure);
    void finishCreation(JSC::VM& vm);
};

class JSSignConstructor final : public JSC::InternalFunction {
public:
    using Base = JSC::InternalFunction;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSSignConstructor* create(JSC::VM& vm, JSC::Structure* structure, JSC::JSObject* prototype);
    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype);

    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        return &vm.internalFunctionSpace();
    }

    DECLARE_INFO;

private:
    JSSignConstructor(JSC::VM& vm, JSC::Structure* structure);
    void finishCreation(JSC::VM& vm, JSC::JSObject* prototype);
};

void setupJSSignClassStructure(JSC::LazyClassStructure::Initializer& init);

} // namespace Bun
