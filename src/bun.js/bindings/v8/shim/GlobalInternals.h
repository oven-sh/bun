#pragma once

#include "BunClientData.h"

#include "../V8Isolate.h"
#include "Oddball.h"

namespace v8 {

class HandleScope;

namespace shim {

class HandleScopeBuffer;

class GlobalInternals : public JSC::JSCell {
public:
    using Base = JSC::JSCell;

    static GlobalInternals* create(JSC::VM& vm, JSC::Structure* structure, Zig::GlobalObject* globalObject);

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
    {
        return JSC::Structure::create(vm, globalObject, JSC::jsNull(), JSC::TypeInfo(JSC::CellType, StructureFlags), info(), 0, 0);
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
        return m_objectTemplateStructure.getInitializedOnMainThread(globalObject);
    }

    JSC::Structure* handleScopeBufferStructure(JSC::JSGlobalObject* globalObject) const
    {
        return m_handleScopeBufferStructure.getInitializedOnMainThread(globalObject);
    }

    JSC::Structure* functionTemplateStructure(JSC::JSGlobalObject* globalObject) const
    {
        return m_functionTemplateStructure.getInitializedOnMainThread(globalObject);
    }

    JSC::Structure* v8FunctionStructure(JSC::JSGlobalObject* globalObject) const
    {
        return m_v8FunctionStructure.getInitializedOnMainThread(globalObject);
    }

    HandleScopeBuffer* globalHandles() const { return m_globalHandles.getInitializedOnMainThread(this); }

    HandleScope* currentHandleScope() const { return m_currentHandleScope; }

    void setCurrentHandleScope(HandleScope* handleScope) { m_currentHandleScope = handleScope; }

    Isolate* isolate() { return &m_isolate; }

    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN_WITH_MODIFIER(JS_EXPORT_PRIVATE);

    friend class ::v8::Isolate;
    friend class ::v8::Context;

private:
    Zig::GlobalObject* m_globalObject;
    JSC::LazyClassStructure m_objectTemplateStructure;
    JSC::LazyClassStructure m_handleScopeBufferStructure;
    JSC::LazyClassStructure m_functionTemplateStructure;
    JSC::LazyClassStructure m_v8FunctionStructure;
    HandleScope* m_currentHandleScope;
    JSC::LazyProperty<GlobalInternals, HandleScopeBuffer> m_globalHandles;

    Oddball m_undefinedValue;
    Oddball m_nullValue;
    Oddball m_trueValue;
    Oddball m_falseValue;

    Isolate m_isolate;

    void finishCreation(JSC::VM& vm);
    GlobalInternals(JSC::VM& vm, JSC::Structure* structure, Zig::GlobalObject* globalObject)
        : Base(vm, structure)
        , m_currentHandleScope(nullptr)
        , m_undefinedValue(Oddball::Kind::kUndefined)
        , m_nullValue(Oddball::Kind::kNull)
        , m_trueValue(Oddball::Kind::kTrue)
        , m_falseValue(Oddball::Kind::kFalse)
        , m_isolate(this)
        , m_globalObject(globalObject)
    {
    }
};

} // namespace shim
} // namespace v8
