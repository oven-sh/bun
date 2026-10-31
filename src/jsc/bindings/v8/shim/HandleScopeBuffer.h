#pragma once

#include "../v8.h"
#include "../V8Isolate.h"
#include "../V8Local.h"
#include "TaggedPointer.h"
#include "Map.h"
#include "Handle.h"
#include "napi_handle_scope.h"
#include <wtf/HashSet.h>
#include <wtf/SegmentedVector.h>
#include <wtf/TZoneMalloc.h>

namespace v8 {
namespace shim {

// Stores the V8 handles for one Bun::HandleScopeImpl, which owns this and attaches it on the first
// V8 call inside the scope. v8::Locals point to the handles, so a SegmentedVector keeps their
// addresses stable. The owning scope visits the handles, and mutations must lock its cellLock().
class HandleScopeBuffer {
    WTF_MAKE_TZONE_ALLOCATED(HandleScopeBuffer);

public:
    HandleScopeBuffer(Bun::HandleScopeImpl* owner, Isolate* isolate);
    ~HandleScopeBuffer();

    template<typename T> Local<T> createLocal(JSC::VM& vm, JSC::JSValue value)
    {
        if (value.isString()) {
            return Local<T>(createHandle(value.asCell(), &Map::string_map(), vm));
        } else if (value.isCell()) {
            return Local<T>(createHandle(value.asCell(), &Map::object_map(), vm));
        } else if (value.isInt32()) {
            return Local<T>(createSmiHandle(value.asInt32()));
        } else if (value.isNumber()) {
            return Local<T>(createDoubleHandle(value.asNumber()));
        } else if (value.isUndefined()) {
            return Local<T>(m_isolate->undefinedSlot());
        } else if (value.isNull()) {
            return Local<T>(m_isolate->nullSlot());
        } else if (value.isTrue()) {
            return Local<T>(m_isolate->trueSlot());
        } else if (value.isFalse()) {
            return Local<T>(m_isolate->falseSlot());
        } else {
            V8_UNIMPLEMENTED();
            return Local<T>();
        }
    }

    TaggedPointer* createHandle(JSC::JSCell* object, const Map* map, JSC::VM& vm);
    TaggedPointer* createSmiHandle(int32_t smi);
    TaggedPointer* createDoubleHandle(double value);

    // Reserve a slot whose value will be written directly by V8's inline CreateHandle code after
    // HandleScope::Extend returns it. The written value is either a Smi or a pointer to an
    // ObjectLayout owned by some other handle, so the handle backing this slot does not own (or
    // visit) anything itself (see Handle::isCell).
    TaggedPointer* createRawHandleSlot();

    // Free every handle created after the raw slot whose address + 1 equals `limit` (the
    // HandleScopeData::limit value V8's inline ~HandleScope just restored). Called from
    // HandleScope::DeleteExtensions so per-iteration inline v8::HandleScopes inside a single
    // native call reclaim their handles instead of accumulating until the enclosing scope
    // closes. Handles that a live callback return-value slot points at are copied into the
    // surviving region first (see GlobalInternals::activeReturnValueSlots()).
    void deleteGrantsBack(const uintptr_t* limit);

    // Reserve an empty handle for an EscapableHandleScope's escape slot.
    // Called from the scope's constructor so the slot's storage index is below
    // every handle created inside the scope (deleteGrantsBack then can't sweep
    // it); EscapeSlot() fills it via createHandleFromExistingObject(reuseHandle).
    Handle* reserveEscapeHandle();

    // Given a tagged pointer from V8, create a handle around the same object or the same
    // numeric value
    //
    // address:     V8 object pointer or Smi
    // reuseHandle: if nonnull, change this handle instead of creating a new one
    // returns the location of the new handle's V8 object pointer or Smi
    TaggedPointer* createHandleFromExistingObject(TaggedPointer address, Handle* reuseHandle = nullptr);

    // The handles of v8::Globals, which only GlobalInternals::globalHandles() has. V8's inline
    // Local::New(isolate, global) and ReturnValue::Set(global) copy the Global's tagged pointer,
    // which points into its handle, so a disposed handle keeps its value, and is not reused,
    // until no open scope has V8 handles.
    TaggedPointer* createGlobalHandle(TaggedPointer address);
    // Ignores a slot that is not a live handle of this buffer: an isolate root (a Global of
    // undefined, null, true or false), a handle that is already disposed, another isolate's handle.
    void disposeGlobalHandle(TaggedPointer* slot);

    // Called when the owning scope is closing and about to free this. Restores the isolate's
    // HandleScopeData, moves any handle a live callback return value still points to into `parent`,
    // and releases the disposed v8::Global handles if no scope with V8 handles stays open.
    void close(Bun::HandleScopeImpl* parent);

    // Called by the owning scope's visitChildren, which holds the owner's cellLock().
    template<typename Visitor> void visitHandles(Visitor& visitor)
    {
        for (auto& handle : m_storage) {
            if (handle.isCell()) {
                visitor.append(handle.asCell());
            }
        }
    }

private:
    Bun::HandleScopeImpl* m_owner;
    Isolate* m_isolate;
    WTF::SegmentedVector<Handle, 16> m_storage;
    // (slot, index in m_storage) for every createRawHandleSlot grant, in creation order.
    WTF::Vector<std::pair<TaggedPointer*, size_t>> m_rawGrants;
    // HandleScopeData::{next,limit} at the time this was attached. They're the same as when the
    // owning scope was opened, because changing them requires a buffer on the innermost scope.
    // close() restores them so they never point into freed handles.
    uintptr_t* m_savedNext;
    uintptr_t* m_savedLimit;
    // See createGlobalHandle(). A handle is in at most one of these.
    WTF::HashSet<Handle*> m_liveGlobalHandles;
    WTF::Vector<Handle*> m_disposedGlobalHandles;
    WTF::Vector<Handle*> m_freeGlobalHandles;

    JSC::VM& vm() const;
    Handle& createEmptyHandle();
    // Overwrite a handle that the GC may be visiting.
    TaggedPointer* setHandle(Handle& handle, const Handle& value);

    // Requires the owner's cellLock(). Return `value`'s target if it is the ObjectLayout of a
    // handle at index >= begin, else null.
    const ObjectLayout* findLayoutInRangeLocked(TaggedPointer value, size_t begin) const;

    // Append an owning copy of `layout` and return the tagged pointer a frame slot should hold
    // to reference it. Takes the lock itself (do not call while holding it).
    TaggedPointer appendRescuedLayout(const ObjectLayout& layout);

    void evacuateActiveReturnValues(Bun::HandleScopeImpl* parent);

    // Requires the owner's cellLock(). Empty the disposed v8::Global handles for reuse.
    void releaseDisposedGlobalHandles(const WTF::AbstractLocker&);
};

} // namespace shim
} // namespace v8
