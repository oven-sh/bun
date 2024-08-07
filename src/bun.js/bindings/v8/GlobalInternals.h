#pragma once

#include "BunClientData.h"

#include "v8/TaggedPointer.h"

namespace v8 {

class HandleScope;

// Container for some data that V8 expects to find at certain offsets. Isolate and Context pointers
// actually point to this object. It is a separate struct so that we can use offsetof() to make sure
// the layout is correct.
struct Roots {
    // v8-internal.h:775
    static const int kUndefinedValueRootIndex = 4;
    static const int kTheHoleValueRootIndex = 5;
    static const int kNullValueRootIndex = 6;
    static const int kTrueValueRootIndex = 7;
    static const int kFalseValueRootIndex = 8;

    GlobalInternals* parent;

    uintptr_t padding[73];

    TaggedPointer roots[9];

    Roots(GlobalInternals* parent);
};

// kIsolateRootsOffset at v8-internal.h:744
static_assert(offsetof(Roots, roots) == 592, "Roots does not match V8 layout");

class GlobalInternals : public JSC::JSCell {
public:
    using Base = JSC::JSCell;

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

    friend struct Roots;

private:
    JSC::LazyClassStructure m_ObjectTemplateStructure;
    JSC::LazyClassStructure m_HandleScopeBufferStructure;
    JSC::LazyClassStructure m_FunctionTemplateStructure;
    JSC::LazyClassStructure m_V8FunctionStructure;
    HandleScope* m_CurrentHandleScope;

    struct V8Oddball {
        enum class Kind : int {
            undefined = 4,
            null = 3,
        };

        TaggedPointer map;
        uintptr_t unused[4];
        TaggedPointer kind;

        V8Oddball(Kind kind_)
            // TODO oddball map
            : map(nullptr)
            , kind(TaggedPointer(static_cast<int>(kind_)))
        {
        }
    };

    V8Oddball undefinedValue;
    V8Oddball nullValue;

    Roots roots;

    void finishCreation(JSC::VM& vm);
    GlobalInternals(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
        , m_CurrentHandleScope(nullptr)
        , undefinedValue(V8Oddball::Kind::undefined)
        , nullValue(V8Oddball::Kind::null)
        , roots(this)
    {
    }
};

}
