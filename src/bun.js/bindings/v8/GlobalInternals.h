#pragma once

#include "BunClientData.h"

namespace v8 {

class HandleScope;

class GlobalInternals : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;

    static GlobalInternals* create(JSC::VM& vm, JSC::Structure* structure);

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
    {
        return JSC::Structure::create(vm, globalObject, JSC::jsNull(), JSC::TypeInfo(JSC::ObjectType, StructureFlags), info(), 0, 0);
    }

    template<typename, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return WebCore::subspaceForImpl<GlobalInternals, WebCore::UseCustomHeapCellType::No>(
            vm,
            [](auto& spaces) { return spaces.m_clientSubspaceForV8GlobalInternals.get(); },
            [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForV8GlobalInternals = std::forward<decltype(space)>(space); },
            [](auto& spaces) { return spaces.m_subspaceForV8GlobalInternals.get(); },
            [](auto& spaces, auto&& space) { spaces.m_subspaceForV8GlobalInternals = std::forward<decltype(space)>(space); });
    }

    JSC::Structure* objectTemplateStructure(JSC::JSGlobalObject* globalObject) const
    {
        return m_ObjectTemplateStructure.getInitializedOnMainThread(globalObject);
    }

    // seems we may not need this as each ObjectTemplate creates a structure for its instances
    // JSC::Structure* internalFieldObjectStructure(JSC::JSGlobalObject* globalObject) const
    // {
    //     return m_InternalFieldObjectStructure.getInitializedOnMainThread(globalObject);
    // }

    JSC::Structure* handleScopeBufferStructure(JSC::JSGlobalObject* globalObject) const
    {
        return m_HandleScopeBufferStructure.getInitializedOnMainThread(globalObject);
    }

    JSC::Structure* functionTemplateStructure(JSC::JSGlobalObject* globalObject) const
    {
        return m_FunctionTemplateStructure.getInitializedOnMainThread(globalObject);
    }

    JSC::Structure* v8FunctionStructure(JSC::JSGlobalObject* globalObject) const
    {
        return m_V8FunctionStructure.getInitializedOnMainThread(globalObject);
    }

    HandleScope* currentHandleScope() const { return m_CurrentHandleScope; }

    void setCurrentHandleScope(HandleScope* handleScope) { m_CurrentHandleScope = handleScope; }

    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN_WITH_MODIFIER(JS_EXPORT_PRIVATE);

private:
    JSC::LazyClassStructure m_ObjectTemplateStructure;
    JSC::LazyClassStructure m_InternalFieldObjectStructure;
    JSC::LazyClassStructure m_HandleScopeBufferStructure;
    JSC::LazyClassStructure m_FunctionTemplateStructure;
    JSC::LazyClassStructure m_V8FunctionStructure;
    HandleScope* m_CurrentHandleScope;

    void finishCreation(JSC::VM& vm);
    GlobalInternals(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
        , m_CurrentHandleScope(nullptr)
    {
    }
};

}
