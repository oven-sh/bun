#pragma once

#include "BunClientData.h"

#include "V8Roots.h"
#include "V8Oddball.h"

namespace v8 {

class HandleScope;
class HandleScopeBuffer;

class GlobalInternals : public JSC::JSCell {
public:
    using Base = JSC::JSCell;

    static GlobalInternals* create(JSC::VM& vm, JSC::Structure* structure, Zig::GlobalObject* globalObject);

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

    HandleScopeBuffer* globalHandles() const { return m_GlobalHandles.getInitializedOnMainThread(this); }

    HandleScope* currentHandleScope() const { return m_CurrentHandleScope; }

    void setCurrentHandleScope(HandleScope* handleScope) { m_CurrentHandleScope = handleScope; }

    TaggedPointer* undefinedSlot() { return &roots.roots[Roots::kUndefinedValueRootIndex]; }

    TaggedPointer* nullSlot() { return &roots.roots[Roots::kNullValueRootIndex]; }

    TaggedPointer* trueSlot() { return &roots.roots[Roots::kTrueValueRootIndex]; }

    TaggedPointer* falseSlot() { return &roots.roots[Roots::kFalseValueRootIndex]; }

    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN_WITH_MODIFIER(JS_EXPORT_PRIVATE);

    friend struct Roots;
    friend class Isolate;
    friend class Context;

private:
    Zig::GlobalObject* globalObject;
    JSC::LazyClassStructure m_ObjectTemplateStructure;
    JSC::LazyClassStructure m_HandleScopeBufferStructure;
    JSC::LazyClassStructure m_FunctionTemplateStructure;
    JSC::LazyClassStructure m_V8FunctionStructure;
    HandleScope* m_CurrentHandleScope;
    JSC::LazyProperty<GlobalInternals, HandleScopeBuffer> m_GlobalHandles;

    Oddball undefinedValue;
    Oddball nullValue;
    Oddball trueValue;
    Oddball falseValue;

    Roots roots;

    void finishCreation(JSC::VM& vm);
    GlobalInternals(JSC::VM& vm, JSC::Structure* structure, Zig::GlobalObject* globalObject_)
        : Base(vm, structure)
        , m_CurrentHandleScope(nullptr)
        , undefinedValue(Oddball::Kind::kUndefined)
        , nullValue(Oddball::Kind::kNull)
        , trueValue(Oddball::Kind::kTrue, &Map::boolean_map)
        , falseValue(Oddball::Kind::kFalse, &Map::boolean_map)
        , roots(this)
        , globalObject(globalObject_)
    {
    }
};

}
