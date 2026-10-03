#pragma once

#include "BunClientData.h"
#include <wtf/HashMap.h>
#include <wtf/Vector.h>

#include "../V8Isolate.h"
#include "Oddball.h"

namespace Bun {
class HandleScopeImpl;
}

namespace v8 {

namespace shim {

class HandleScopeBuffer;
struct Handle;

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
        return WebCore::subspaceForImpl<GlobalInternals, WebCore::UseCustomHeapCellType::No>(vm, BUN_SUBSPACE_SLOTS(m_clientSubspaceForV8GlobalInternals, m_subspaceForV8GlobalInternals));
    }

    JSC::Structure* objectTemplateStructure(JSC::JSGlobalObject* globalObject) const
    {
        return m_objectTemplateStructure.getInitializedOnMainThread(globalObject);
    }

    JSC::Structure* functionTemplateStructure(JSC::JSGlobalObject* globalObject) const
    {
        return m_functionTemplateStructure.getInitializedOnMainThread(globalObject);
    }

    JSC::Structure* v8FunctionStructure(JSC::JSGlobalObject* globalObject) const
    {
        return m_v8FunctionStructure.getInitializedOnMainThread(globalObject);
    }

    // Where v8::Global handles live: a scope that is never closed.
    HandleScopeBuffer* globalHandles();

    // The V8 handles of the innermost open scope (GlobalObject::m_currentHandleScopeImpl). Aborts
    // without one, like V8: Bun opens a scope around every native callback it makes.
    HandleScopeBuffer* currentHandleScope();

    // Escape-slot reservations for live EscapableHandleScopes, keyed by the
    // scope's stack address. The slot is reserved at scope construction (so it
    // sits below any handles created inside the scope and survives
    // HandleScope::DeleteExtensions) and consumed by EscapeSlot(). Entries are
    // purged when their owning buffer clears (scope close) — a scope destroyed
    // by V8's inline destructor without calling Escape() has no other hook —
    // and a reused stack address simply overwrites the stale entry.
    struct EscapeReservation {
        Handle* handle { nullptr };
        HandleScopeBuffer* buffer { nullptr };
    };
    WTF::HashMap<void*, EscapeReservation>& escapeReservations() { return m_escapeReservations; }
    void purgeEscapeReservations(HandleScopeBuffer* buffer)
    {
        m_escapeReservations.removeIf([buffer](auto& entry) { return entry.value.buffer == buffer; });
    }

    // Return-value slots of the callback frames currently on the native stack
    // (innermost last). V8's inline ReturnValue::Set stores a Local's Address
    // — for heap values a pointer into some HandleScopeBuffer's storage —
    // into the frame, and V8 guarantees the returned value outlives any inner
    // handle scope (the scope owns only the slot, never the object). Scope
    // teardown consults this list to rescue handles a frame still points at
    // (HandleScopeBuffer::deleteGrantsBack / evacuateActiveReturnValues).
    WTF::Vector<TaggedPointer*>& activeReturnValueSlots() { return m_activeReturnValueSlots; }

    // RAII registration of a callback frame's return-value slot for the
    // duration of the native callback.
    class ActiveReturnValueSlotScope {
        WTF_MAKE_NONCOPYABLE(ActiveReturnValueSlotScope);

    public:
        ActiveReturnValueSlotScope(GlobalInternals* internals, TaggedPointer* slot)
            : m_internals(internals)
        {
            m_internals->activeReturnValueSlots().append(slot);
        }
        ~ActiveReturnValueSlotScope()
        {
            m_internals->activeReturnValueSlots().removeLast();
        }

    private:
        GlobalInternals* m_internals;
    };

    WTF::Vector<std::pair<Isolate::GCCallbackWithData, void*>>& gcPrologueCallbacks() { return m_gcPrologueCallbacks; }
    WTF::Vector<std::pair<Isolate::GCCallbackWithData, void*>>& gcEpilogueCallbacks() { return m_gcEpilogueCallbacks; }
    WTF::Vector<std::pair<NearHeapLimitCallback, void*>>& nearHeapLimitCallbacks() { return m_nearHeapLimitCallbacks; }

    // MakeWeak/ClearWeak bookkeeping: global-handle slot (in globalHandles()) to
    // the parameter passed to MakeWeak.
    WTF::HashMap<uintptr_t*, void*>& weakHandleParameters() { return m_weakHandleParameters; }

    Isolate* isolate() { return &m_isolate; }

    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN_WITH_MODIFIER(JS_EXPORT_PRIVATE);

    friend class ::v8::Isolate;
    friend class ::v8::Context;

private:
    Zig::GlobalObject* m_globalObject;
    JSC::LazyClassStructure m_objectTemplateStructure;
    JSC::LazyClassStructure m_functionTemplateStructure;
    JSC::LazyClassStructure m_v8FunctionStructure;
    WTF::HashMap<void*, EscapeReservation> m_escapeReservations;
    // No inline capacity: in-cell inline Vector storage would leave stale ASAN container
    // annotations behind (this cell is swept without running destructors).
    WTF::Vector<TaggedPointer*> m_activeReturnValueSlots;
    JSC::LazyProperty<GlobalInternals, Bun::HandleScopeImpl> m_globalHandles;

    WTF::Vector<std::pair<Isolate::GCCallbackWithData, void*>> m_gcPrologueCallbacks;
    WTF::Vector<std::pair<Isolate::GCCallbackWithData, void*>> m_gcEpilogueCallbacks;
    WTF::Vector<std::pair<NearHeapLimitCallback, void*>> m_nearHeapLimitCallbacks;
    WTF::HashMap<uintptr_t*, void*> m_weakHandleParameters;

    Oddball m_undefinedValue;
    Oddball m_nullValue;
    Oddball m_trueValue;
    Oddball m_falseValue;

    Isolate m_isolate;

    void finishCreation(JSC::VM& vm);
    GlobalInternals(JSC::VM& vm, JSC::Structure* structure, Zig::GlobalObject* globalObject)
        : Base(vm, structure)
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
