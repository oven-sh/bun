#pragma once

#include "root.h"
#include "JSDOMWrapper.h" // For JSDOMObject
#include "JSMIMEParams.h" // Need JSMIMEParams
#include <JavaScriptCore/JSObject.h>
#include <JavaScriptCore/InternalFunction.h>
#include <JavaScriptCore/LazyClassStructure.h>
#include <JavaScriptCore/JSGlobalObject.h>
#include <wtf/text/WTFString.h>

namespace WebCore {

class JSMIMEType final : public JSC::JSNonFinalObject {
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
            [](auto& spaces) { return spaces.m_clientSubspaceForJSMIMEType.get(); },
            [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForJSMIMEType = std::forward<decltype(space)>(space); },
            [](auto& spaces) { return spaces.m_subspaceForJSMIMEType.get(); },
            [](auto& spaces, auto&& space) { spaces.m_subspaceForJSMIMEType = std::forward<decltype(space)>(space); });
    }

    static JSMIMEType* create(JSC::VM& vm, JSC::Structure* structure, WTF::String type, WTF::String subtype, JSMIMEParams* params);
    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype);

    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;

    const WTF::String& type() const { return m_type; }
    void setType(WTF::String type) { m_type = WTF::move(type); }

    const WTF::String& subtype() const { return m_subtype; }
    void setSubtype(WTF::String subtype) { m_subtype = WTF::move(subtype); }

    JSMIMEParams* parameters() const { return m_parameters.get(); }

private:
    JSMIMEType(JSC::VM& vm, JSC::Structure* structure);
    void finishCreation(JSC::VM& vm, WTF::String type, WTF::String subtype, JSMIMEParams* params);

    WTF::String m_type;
    WTF::String m_subtype;
    JSC::WriteBarrier<JSMIMEParams> m_parameters;
};

class JSMIMETypePrototype final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags | JSC::ImplementsDefaultHasInstance;

    static JSMIMETypePrototype* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure);

    DECLARE_INFO;

    template<typename, JSC::SubspaceAccess> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        return &vm.plainObjectSpace();
    }

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype);

private:
    JSMIMETypePrototype(JSC::VM& vm, JSC::Structure* structure);
    void finishCreation(JSC::VM& vm);
};

class JSMIMETypeConstructor final : public JSC::InternalFunction {
public:
    using Base = JSC::InternalFunction;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSMIMETypeConstructor* create(JSC::VM& vm, JSC::Structure* structure, JSC::JSObject* prototype);

    DECLARE_INFO;

    template<typename CellType, JSC::SubspaceAccess> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        return &vm.internalFunctionSpace();
    }

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype);

private:
    JSMIMETypeConstructor(JSC::VM& vm, JSC::Structure* structure);
    void finishCreation(JSC::VM& vm, JSC::JSObject* prototype);
};

// Function to setup the structures lazily
void setupJSMIMETypeClassStructure(JSC::LazyClassStructure::Initializer&);

} // namespace WebCore
