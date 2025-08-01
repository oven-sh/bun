#pragma once

#include "root.h"
#include "JSDOMWrapper.h" // For JSDOMObject
#include <JavaScriptCore/JSObject.h>
#include <JavaScriptCore/JSMap.h>
#include <JavaScriptCore/InternalFunction.h>
#include <JavaScriptCore/LazyClassStructure.h>
#include <JavaScriptCore/JSGlobalObject.h>

namespace WebCore {

class JSMIMEParams final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    template<typename MyClassT, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return WebCore::subspaceForImpl<MyClassT, WebCore::UseCustomHeapCellType::No>(
            vm,
            [](auto& spaces) { return spaces.m_clientSubspaceForJSMIMEParams.get(); },
            [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForJSMIMEParams = std::forward<decltype(space)>(space); },
            [](auto& spaces) { return spaces.m_subspaceForJSMIMEParams.get(); },
            [](auto& spaces, auto&& space) { spaces.m_subspaceForJSMIMEParams = std::forward<decltype(space)>(space); });
    }

    static JSMIMEParams* create(JSC::VM& vm, JSC::Structure* structure, JSC::JSMap* map);
    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype);

    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;

    JSC::JSMap* jsMap() const { return m_map.get(); }

private:
    JSMIMEParams(JSC::VM& vm, JSC::Structure* structure);
    void finishCreation(JSC::VM& vm, JSC::JSMap* map);

    JSC::WriteBarrier<JSC::JSMap> m_map;
};

class JSMIMEParamsPrototype final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags | JSC::ImplementsDefaultHasInstance;

    static JSMIMEParamsPrototype* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure);

    DECLARE_INFO;

    template<typename, JSC::SubspaceAccess> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        return &vm.plainObjectSpace();
    }

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype);

private:
    JSMIMEParamsPrototype(JSC::VM& vm, JSC::Structure* structure);
    void finishCreation(JSC::VM& vm);
};

class JSMIMEParamsConstructor final : public JSC::InternalFunction {
public:
    using Base = JSC::InternalFunction;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSMIMEParamsConstructor* create(JSC::VM& vm, JSC::Structure* structure, JSC::JSObject* prototype);

    DECLARE_INFO;

    template<typename CellType, JSC::SubspaceAccess> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        return &vm.internalFunctionSpace();
    }

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype);

private:
    JSMIMEParamsConstructor(JSC::VM& vm, JSC::Structure* structure);
    void finishCreation(JSC::VM& vm, JSC::JSObject* prototype);
};

// Function to setup the structures lazily
void setupJSMIMEParamsClassStructure(JSC::LazyClassStructure::Initializer&);

JSC::JSValue createJSMIMEBinding(Zig::GlobalObject* globalObject);
bool parseMIMEParamsString(JSGlobalObject* globalObject, JSMap* map, StringView input);

} // namespace WebCore
